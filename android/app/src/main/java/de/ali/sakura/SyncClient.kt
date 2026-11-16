package de.ali.sakura

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.concurrent.Executors

/**
 * Synchronisation – zwei Wege, gleiches verschlüsseltes Format wie der Windows-Browser:
 *  1. Sync-Code (ohne Konto): Daten liegen verschlüsselt beim Sakura-Sync-Dienst (sync-server/, Netlify)
 *  2. Eigenes Firebase-Projekt: Firestore-Dokument users/{uid}/sync/main mit dem Feld „payload“
 */
class SyncClient(ctx: Context, private val store: Store) {
    private val sp = ctx.getSharedPreferences("sync", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val net = Executors.newSingleThreadExecutor()
    private var idToken: String? = null
    private var exp = 0L
    private var busy = false
    private var again = false
    private val debounce = Runnable { syncNow() }

    var state = if (!configured) "off" else if (sp.getString("key", null) != null) "idle" else "needkey"; private set
    var message = ""; private set
    var onStatus: (() -> Unit)? = null
    /** Wird nach dem Zusammenführen aufgerufen, damit offene Startseiten neu laden */
    var onMerged: (() -> Unit)? = null
    /** Liefert Gerätename und offene Tabs dieses Handys für „Tabs auf anderen Geräten“ */
    var tabsProvider: (() -> Pair<String, org.json.JSONArray>)? = null

    val isCode get() = sp.getString("mode", "") == "code"
    val configured get() = if (isCode) sp.getString("id", null) != null && sp.getString("write", null) != null
        else sp.getString("refreshToken", null) != null && sp.getString("uid", null) != null
    val email get() = sp.getString("email", "") ?: ""

    /** Von der Activity bei jeder Datenänderung aufgerufen */
    fun noteChange(kind: String, synced: Boolean) {
        if (synced && configured) {
            main.removeCallbacks(debounce)
            main.postDelayed(debounce, when (kind) { "tabs" -> 60_000L; "history" -> 15_000L; else -> 3_000L })
        }
    }

    fun info(): JSONObject = JSONObject()
        .put("state", state).put("message", message).put("email", email)
        .put("lastSync", sp.getLong("lastSync", 0))
        .put("apiKey", sp.getString("apiKey", "")).put("projectId", sp.getString("projectId", ""))
        .put("encrypted", sp.getString("key", null) != null)
        .put("mode", if (isCode) "code" else if (sp.getString("apiKey", null) != null) "firebase" else "")
        .put("code", if (isCode) sp.getString("code", "") else "")

    private fun setStatus(s: String, m: String = "") {
        state = s; message = m
        main.post { onStatus?.invoke() }
    }

    private class HttpResult(val code: Int, val body: String)

    private fun http(method: String, url: String, body: String? = null, type: String = "application/json", token: String? = null,
                     headers: Map<String, String> = emptyMap()): HttpResult {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15000; c.readTimeout = 20000
        c.requestMethod = if (method == "PATCH") "POST" else method
        if (method == "PATCH") c.setRequestProperty("X-HTTP-Method-Override", "PATCH")
        if (token != null) c.setRequestProperty("Authorization", "Bearer $token")
        for ((k, v) in headers) c.setRequestProperty(k, v)
        if (body != null) {
            c.doOutput = true
            c.setRequestProperty("Content-Type", "$type; charset=utf-8")
            c.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        val code = c.responseCode
        val stream = if (code in 200..299) c.inputStream else c.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        c.disconnect()
        return HttpResult(code, text)
    }

    private val ERRORS = mapOf(
        "EMAIL_NOT_FOUND" to "Kein Konto mit dieser E-Mail. Wähle „Konto anlegen“.",
        "INVALID_PASSWORD" to "Falsches Passwort.",
        "INVALID_LOGIN_CREDENTIALS" to "E-Mail oder Passwort stimmt nicht.",
        "EMAIL_EXISTS" to "Diese E-Mail hat schon ein Konto. Wähle „Anmelden“.",
        "WEAK_PASSWORD" to "Das Passwort braucht mindestens 6 Zeichen.",
        "INVALID_EMAIL" to "Die E-Mail-Adresse ist ungültig.",
        "OPERATION_NOT_ALLOWED" to "In Firebase ist die Anmeldung per E-Mail/Passwort noch nicht aktiviert.",
        "CONFIGURATION_NOT_FOUND" to "In Firebase ist Authentication noch nicht eingerichtet.",
        "TOO_MANY_ATTEMPTS_TRY_LATER" to "Zu viele Versuche. Probier es in ein paar Minuten noch mal.",
        "PERMISSION_DENIED" to "Firestore lehnt den Zugriff ab. Prüfe die Sicherheitsregeln (firestore.rules).",
        "NOT_FOUND" to "Firestore-Datenbank nicht gefunden. Prüfe die Projekt-ID und ob Firestore angelegt ist."
    )

    private fun errorText(body: String, fallback: String): String {
        if (body.contains("API key not valid")) return "Der API-Schlüssel ist ungültig."
        val e = try { JSONObject(body).optJSONObject("error") } catch (_: Exception) { null } ?: return fallback
        val keys = listOf(
            e.optString("message").substringBefore(':').substringBefore(' ').trim(),
            e.optString("status")
        )
        return keys.firstNotNullOfOrNull { ERRORS[it] } ?: fallback
    }

    /** cb bekommt null bei Erfolg, sonst eine Fehlermeldung. Läuft auf dem UI-Thread zurück. */
    private fun lengthError() = "Das Sync-Passwort braucht mindestens ${SyncCrypto.MIN_LENGTH} Zeichen."
    private fun netError(e: Exception) = e.message?.takeIf { e is IllegalStateException } ?: "Keine Internetverbindung – versuche es später erneut."

    /** cb(null) = angemeldet (auch wenn das Sync-Passwort noch nicht passt – dann steht der Status auf „needkey“). */
    fun login(apiKey: String, projectId: String, email: String, password: String, create: Boolean, syncPassword: String, cb: (String?) -> Unit) {
        val key = apiKey.trim(); val pid = projectId.trim()
        if (key.isEmpty() || pid.isEmpty()) { cb("API-Schlüssel und Projekt-ID werden gebraucht."); return }
        if (syncPassword.length < SyncCrypto.MIN_LENGTH) { cb(lengthError()); return }
        net.execute {
            try {
                val ep = if (create) "signUp" else "signInWithPassword"
                val body = JSONObject().put("email", email.trim()).put("password", password).put("returnSecureToken", true).toString()
                val r = http("POST", "https://identitytoolkit.googleapis.com/v1/accounts:$ep?key=${enc(key)}", body)
                if (r.code !in 200..299) { main.post { cb(errorText(r.body, "Anmeldung fehlgeschlagen.")) }; return@execute }
                val j = JSONObject(r.body)
                sp.edit().clear().putString("apiKey", key).putString("projectId", pid).putString("email", j.optString("email"))
                    .putString("uid", j.optString("localId")).putString("refreshToken", j.optString("refreshToken")).putLong("lastSync", 0).apply()
                idToken = j.optString("idToken")
                exp = System.currentTimeMillis() + j.optString("expiresIn", "3600").toLong() * 1000 - 60_000
                main.post { unlock(syncPassword, false) { cb(null) } }
            } catch (e: Exception) {
                main.post { cb("Keine Verbindung zum Server. Prüf deine Internetverbindung.") }
            }
        }
    }

    /** Mit Sync-Code verbinden (cb auf dem UI-Thread: null = verbunden) – danach gleicht Sakura automatisch ab */
    fun connectCode(input: String, cb: (String?) -> Unit) {
        val d = SyncCode.derive(input)
        if (d == null) { cb("Der Sync-Code stimmt nicht. Er hat 20 Zeichen, z. B. K7QM4-ZX92A-1VNAB-8P3RT."); return }
        setStatus("syncing", "Schlüssel wird berechnet …")
        net.execute {
            val key = SyncCrypto.deriveKey(d.secret, d.salt)
            sp.edit().clear().putString("mode", "code").putString("code", d.code).putString("id", d.id).putString("write", d.write)
                .putString("salt", d.salt).putString("key", key).putString("server", SyncCode.DEFAULT_SERVER).putLong("lastSync", 0).apply()
            main.post { cb(null); syncNow() }
        }
    }

    /** Neuen Sync-Code erzeugen und die Daten dieses Handys hochladen */
    fun createCode(cb: (String?) -> Unit) = connectCode(SyncCode.newCode(), cb)

    private fun codeUrl() = (sp.getString("server", SyncCode.DEFAULT_SERVER) ?: SyncCode.DEFAULT_SERVER) + "/api/sync/" + sp.getString("id", "")
    private fun codeHeaders() = mapOf("X-Sakura-Write" to (sp.getString("write", "") ?: ""))

    fun logout() {
        sp.edit().clear().apply()
        idToken = null
        setStatus("off")
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

    private fun token(): String {
        if (isCode) return "" // Sync-Code braucht keine Anmeldung
        val t = idToken
        if (t != null && System.currentTimeMillis() < exp) return t
        val key = sp.getString("apiKey", "")!!
        val r = http("POST", "https://securetoken.googleapis.com/v1/token?key=${enc(key)}",
            "grant_type=refresh_token&refresh_token=" + enc(sp.getString("refreshToken", "")!!), "application/x-www-form-urlencoded")
        if (r.code !in 200..299) throw IllegalStateException(errorText(r.body, "Sitzung abgelaufen – bitte neu anmelden."))
        val j = JSONObject(r.body)
        idToken = j.optString("id_token")
        exp = System.currentTimeMillis() + j.optString("expires_in", "3600").toLong() * 1000 - 60_000
        j.optString("refresh_token").takeIf { it.isNotEmpty() }?.let { sp.edit().putString("refreshToken", it).apply() }
        return idToken!!
    }

    private fun docUrl(): String {
        val pid = enc(sp.getString("projectId", "")!!)
        val uid = enc(sp.getString("uid", "")!!)
        return "https://firestore.googleapis.com/v1/projects/$pid/databases/(default)/documents/users/$uid/sync/main"
    }

    private class Doc(val payload: String, val salt: String)

    /** Liest das Server-Dokument (Hintergrund-Thread). */
    private fun readDoc(tok: String): Doc {
        if (isCode) {
            val r = http("GET", codeUrl(), headers = codeHeaders())
            if (r.code == 404) return Doc("", "")
            if (r.code != 200) throw IllegalStateException("Der Sync-Dienst antwortet nicht (${r.code}).")
            val j = JSONObject(r.body)
            return Doc(j.optString("payload"), j.optString("salt"))
        }
        val get = http("GET", docUrl(), token = tok)
        if (get.code == 404) return Doc("", "")
        if (get.code != 200) throw IllegalStateException(errorText(get.body, "Server antwortet nicht (${get.code})."))
        val f = JSONObject(get.body).optJSONObject("fields") ?: return Doc("", "")
        return Doc(
            f.optJSONObject("payload")?.optString("stringValue") ?: "",
            f.optJSONObject("salt")?.optString("stringValue") ?: ""
        )
    }

    /**
     * Sync-Passwort eingeben (Hintergrundarbeit, cb auf dem UI-Thread mit Fehlermeldung oder null).
     * reset = true legt die Server-Daten mit neuem Passwort neu an.
     */
    fun unlock(password: String, reset: Boolean, cb: (String?) -> Unit) {
        if (!configured) { cb("Nicht angemeldet."); return }
        if (password.length < SyncCrypto.MIN_LENGTH) { cb(lengthError()); return }
        setStatus("syncing", "Schlüssel wird berechnet …")
        net.execute {
            try {
                val doc = readDoc(token())
                if (!reset && doc.salt.isNotEmpty() && SyncCrypto.isEncrypted(doc.payload)) {
                    val key = SyncCrypto.deriveKey(password, doc.salt)
                    try { SyncCrypto.decrypt(key, doc.payload) } catch (e: Exception) { throw IllegalStateException("Das Sync-Passwort stimmt nicht.") }
                    sp.edit().putString("salt", doc.salt).putString("key", key).apply()
                    main.post { cb(null); syncNow() }
                } else {
                    val salt = SyncCrypto.newSalt()
                    val key = SyncCrypto.deriveKey(password, salt)
                    sp.edit().putString("salt", salt).putString("key", key).apply()
                    main.post { cb(null); syncNow(ignoreRemote = reset) }
                }
            } catch (e: Exception) {
                val msg = netError(e)
                main.post {
                    setStatus(if (sp.getString("key", null) == null) "needkey" else "error", msg)
                    cb(msg)
                }
            }
        }
    }

    /** Sync-Passwort ändern: Server-Daten mit dem alten Schlüssel einlesen, dann alles neu verschlüsseln. */
    fun changePassword(password: String, cb: (String?) -> Unit) {
        val oldKey = sp.getString("key", null)
        if (!configured || oldKey == null) { cb("Entsperre den Abgleich zuerst."); return }
        if (password.length < SyncCrypto.MIN_LENGTH) { cb(lengthError()); return }
        setStatus("syncing", "Schlüssel wird berechnet …")
        net.execute {
            try {
                val doc = readDoc(token())
                val remote = if (SyncCrypto.isEncrypted(doc.payload) && doc.salt == sp.getString("salt", ""))
                    JSONObject(SyncCrypto.decrypt(oldKey, doc.payload)) else JSONObject()
                val salt = SyncCrypto.newSalt()
                val key = SyncCrypto.deriveKey(password, salt)
                main.post {
                    store.applySynced(SyncModel.mergeData(store.syncedPart(), remote))
                    sp.edit().putString("salt", salt).putString("key", key).apply()
                    cb(null)
                    syncNow(ignoreRemote = true)
                }
            } catch (e: Exception) {
                val msg = netError(e)
                main.post { setStatus("error", msg); cb(msg) }
            }
        }
    }

    private fun needKey(msg: String) {
        // Beim Sync-Code ist der Schlüssel der Code selbst – nichts zu entsperren
        if (isCode) { finish("error", "Die Daten beim Sync-Dienst passen nicht zu diesem Sync-Code."); return }
        sp.edit().remove("key").apply()
        finish("needkey", msg)
    }

    /** Muss auf dem UI-Thread aufgerufen werden. */
    fun syncNow(ignoreRemote: Boolean = false) {
        if (!configured) return
        val key = sp.getString("key", null)
        if (key == null) { setStatus("needkey", if (state == "needkey") message else ""); return }
        if (busy) { again = true; return }
        busy = true
        setStatus("syncing")
        net.execute {
            try {
                val tok = token()
                var remote = JSONObject()
                if (!ignoreRemote) {
                    val doc = readDoc(tok)
                    if (SyncCrypto.isEncrypted(doc.payload)) {
                        if (doc.salt != sp.getString("salt", "")) {
                            needKey("Das Sync-Passwort wurde auf einem anderen Gerät geändert. Gib das neue ein."); return@execute
                        }
                        remote = try { JSONObject(SyncCrypto.decrypt(key, doc.payload)) } catch (e: Exception) {
                            needKey("Das Sync-Passwort passt nicht zu den Daten auf dem Server."); return@execute
                        }
                    } else if (doc.payload.isNotEmpty()) {
                        remote = JSONObject(doc.payload) // alte, unverschlüsselte Daten → werden jetzt verschlüsselt
                    }
                }
                val r = remote
                // Zusammenführen auf dem UI-Thread, danach verschlüsselt hochladen
                main.post {
                    tabsProvider?.invoke()?.let { (name, tabs) -> store.setDeviceTabs(name, tabs) }
                    val merged = SyncModel.mergeData(store.syncedPart(), r)
                    store.applySynced(merged)
                    onMerged?.invoke()
                    val text = SyncModel.payload(merged).toString()
                    net.execute { upload(tok, key, text) }
                }
            } catch (e: Exception) {
                finish("error", netError(e))
            }
        }
    }

    private fun upload(tok: String, key: String, text: String) {
        try {
            if (isCode) {
                val body = JSONObject().put("payload", SyncCrypto.encrypt(key, text)).put("salt", sp.getString("salt", "")).toString()
                val r = http("PUT", codeUrl(), body, headers = codeHeaders())
                if (r.code !in 200..299) throw IllegalStateException(if (r.code == 403) "Der Sync-Dienst lehnt das Schreiben ab." else "Hochladen fehlgeschlagen (${r.code}).")
                sp.edit().putLong("lastSync", System.currentTimeMillis()).apply()
                finish("ok", "")
                return
            }
            val body = JSONObject().put("fields", JSONObject()
                .put("payload", JSONObject().put("stringValue", SyncCrypto.encrypt(key, text)))
                .put("salt", JSONObject().put("stringValue", sp.getString("salt", "")))
                .put("enc", JSONObject().put("integerValue", "1"))
                .put("updatedAt", JSONObject().put("integerValue", System.currentTimeMillis().toString()))).toString()
            val r = http("PATCH", docUrl(), body, token = tok)
            if (r.code !in 200..299) throw IllegalStateException(errorText(r.body, "Hochladen fehlgeschlagen (${r.code})."))
            sp.edit().putLong("lastSync", System.currentTimeMillis()).apply()
            finish("ok", "")
        } catch (e: Exception) {
            finish("error", netError(e))
        }
    }

    private fun finish(s: String, m: String) {
        main.post {
            busy = false
            setStatus(s, m)
            if (again) { again = false; main.postDelayed({ syncNow() }, 500) }
        }
    }
}
