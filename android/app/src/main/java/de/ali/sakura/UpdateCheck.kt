package de.ali.sakura

import android.content.Context
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Prüft alle paar Stunden, ob es auf GitHub eine neuere Sakura-Version gibt.
 * Die Webseiten-Engine (Android System WebView) aktualisiert der Play Store ohnehin selbst –
 * hier geht es nur um die Sakura-App.
 */
class UpdateCheck(private val ctx: Context) {
    data class Release(val version: String, val apkUrl: String, val pageUrl: String)

    private val sp = ctx.getSharedPreferences("update", Context.MODE_PRIVATE)
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()

    val repo: String get() = BuildConfig.UPDATE_REPO

    /** found wird auf dem UI-Thread aufgerufen – nur wenn es eine neuere, noch nicht abgelehnte Version gibt. */
    fun checkDaily(found: (Release) -> Unit) {
        if (repo.isEmpty()) return
        if (System.currentTimeMillis() - sp.getLong("lastCheck", 0) < 6 * 3_600_000L) return
        check(force = false, found = found, done = {})
    }

    fun check(force: Boolean, found: (Release) -> Unit, done: (String?) -> Unit) {
        if (repo.isEmpty()) { done("Diese Version wurde nicht über GitHub gebaut und sucht deshalb nicht nach Updates."); return }
        io.execute {
            try {
                val c = URL("https://api.github.com/repos/$repo/releases/latest").openConnection() as HttpURLConnection
                c.setRequestProperty("Accept", "application/vnd.github+json")
                c.connectTimeout = 15000; c.readTimeout = 20000
                if (c.responseCode != 200) { main.post { done("Es gibt noch keine veröffentlichte Version.") }; return@execute }
                val j = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                val version = j.optString("tag_name").removePrefix("v")
                val assets = j.optJSONArray("assets")
                var apk = ""
                if (assets != null) for (i in 0 until assets.length()) {
                    val a = assets.optJSONObject(i) ?: continue
                    if (a.optString("name").endsWith(".apk")) { apk = a.optString("browser_download_url"); break }
                }
                val newer = isNewer(version, BuildConfig.VERSION_NAME)
                // Neue Version ohne APK = wird gerade noch gebaut → nicht als „geprüft“ merken, beim nächsten Start erneut fragen
                if (!newer || apk.isNotEmpty()) sp.edit().putLong("lastCheck", System.currentTimeMillis()).apply()
                val skipped = !force && sp.getString("skipped", "") == version
                main.post {
                    if (newer && apk.isNotEmpty() && !skipped) found(Release(version, apk, j.optString("html_url")))
                    done(if (newer && apk.isNotEmpty()) null else "Sakura ist auf dem neuesten Stand (${BuildConfig.VERSION_NAME}).")
                }
            } catch (e: Exception) {
                main.post { done("Keine Verbindung zu GitHub.") }
            }
        }
    }

    fun skip(version: String) = sp.edit().putString("skipped", version).apply()

    companion object {
        fun isNewer(a: String, b: String): Boolean {
            val x = a.split(".").map { it.toIntOrNull() ?: 0 }
            val y = b.split(".").map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(x.size, y.size)) {
                val d = x.getOrElse(i) { 0 } - y.getOrElse(i) { 0 }
                if (d != 0) return d > 0
            }
            return false
        }
    }
}
