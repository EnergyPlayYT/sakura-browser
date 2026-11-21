package de.ali.sakura

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors

/** Lokale Daten. Wird nur vom UI-Thread benutzt. */
class Store(ctx: Context) {
    private val file = File(ctx.filesDir, "sakura-data.json")
    private val io = Executors.newSingleThreadExecutor()
    var data: JSONObject = try { JSONObject(file.readText()) } catch (e: Exception) { SyncModel.emptyData() }
    /** (Art der Änderung, soll synchronisiert werden) */
    var onChange: ((String, Boolean) -> Unit)? = null

    init {
        val empty = SyncModel.emptyData()
        for (k in empty.keys()) if (!data.has(k)) data.put(k, empty.get(k))
        if (data.optString("deviceId").isEmpty()) data.put("deviceId", "android-" + SyncModel.newId())
        val p = SyncModel.defaultPrefs()
        val cur = data.getJSONObject("prefs")
        for (k in p.keys()) if (!cur.has(k)) cur.put(k, p.get(k))
        // Einmalig: Hintergrundbilder wechseln jetzt standardmäßig jede Minute statt alle 10 Minuten
        // (ohne updatedAt zu ändern, damit neuere Einstellungen anderer Geräte nicht überschrieben werden)
        if (!data.optBoolean("bgMinutesMigrated")) {
            if (cur.optInt("bgMinutes") == 10) cur.put("bgMinutes", 1)
            data.put("bgMinutesMigrated", true)
        }
    }

    fun save() {
        val snapshot = data.toString()
        io.execute {
            try {
                val tmp = File(file.path + ".tmp")
                tmp.writeText(snapshot)
                tmp.renameTo(file)
            } catch (_: Exception) { }
        }
    }

    private fun changed(kind: String, synced: Boolean = true) {
        save()
        onChange?.invoke(kind, synced)
    }

    private fun list(key: String) = data.getJSONArray(key)
    private fun find(key: String, id: String) = SyncModel.objects(list(key)).firstOrNull { it.optString("id") == id }
    private fun now() = System.currentTimeMillis()

    // ---------- Lesezeichen
    fun bookmarks(): JSONArray = JSONArray(SyncModel.objects(list("bookmarks"))
        .filter { !it.optBoolean("deleted") }.sortedByDescending { it.optLong("createdAt") })

    fun findBookmark(url: String) = SyncModel.objects(list("bookmarks")).firstOrNull { !it.optBoolean("deleted") && it.optString("url") == url }

    fun toggleBookmark(url: String, title: String): Boolean {
        val b = findBookmark(url)
        if (b != null) { removeBookmark(b.optString("id")); return false }
        val t = now()
        list("bookmarks").put(JSONObject().put("id", SyncModel.newId()).put("url", url).put("title", title.ifBlank { url })
            .put("createdAt", t).put("updatedAt", t))
        changed("bookmarks")
        return true
    }

    fun updateBookmark(id: String, title: String?, url: String?) {
        val b = find("bookmarks", id) ?: return
        if (title != null) b.put("title", title.take(300))
        if (!url.isNullOrBlank()) b.put("url", url.trim())
        b.put("updatedAt", now())
        changed("bookmarks")
    }

    fun removeBookmark(id: String) {
        val b = find("bookmarks", id) ?: return
        b.put("deleted", true).put("updatedAt", now())
        changed("bookmarks")
    }

    // ---------- Schnellzugriffe
    fun shortcuts(): JSONArray = JSONArray(SyncModel.objects(list("shortcuts"))
        .filter { !it.optBoolean("deleted") }.sortedBy { it.optInt("order") })

    fun saveShortcut(id: String?, title: String, url: String) {
        val t = now()
        val s = if (id.isNullOrEmpty()) null else find("shortcuts", id)
        if (s != null) {
            s.put("title", title).put("url", url).put("updatedAt", t)
        } else {
            val max = SyncModel.objects(shortcuts()).maxOfOrNull { it.optInt("order") } ?: 0
            list("shortcuts").put(JSONObject().put("id", SyncModel.newId()).put("title", title).put("url", url).put("order", max + 1).put("updatedAt", t))
        }
        changed("shortcuts")
    }

    fun deleteShortcut(id: String) {
        val s = find("shortcuts", id) ?: return
        s.put("deleted", true).put("updatedAt", now())
        changed("shortcuts")
    }

    fun orderShortcuts(ids: JSONArray) {
        val t = now()
        for (i in 0 until ids.length()) {
            val s = find("shortcuts", ids.optString(i)) ?: continue
            if (s.optInt("order") != i) s.put("order", i).put("updatedAt", t)
        }
        changed("shortcuts")
    }

    // ---------- Verlauf
    fun visit(url: String, title: String?) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        val t = now()
        val h = find("history", url)
        if (h != null) {
            h.put("visitedAt", t).put("updatedAt", t).put("deleted", false)
            if (!title.isNullOrBlank()) h.put("title", title)
        } else {
            list("history").put(JSONObject().put("id", url).put("url", url).put("title", title?.ifBlank { url } ?: url)
                .put("visitedAt", t).put("updatedAt", t))
        }
        if (list("history").length() > SyncModel.HISTORY_LOCAL + 200) {
            data.put("history", SyncModel.trimHistory(list("history"), data.optLong("historyClearedAt"), SyncModel.HISTORY_LOCAL))
        }
        changed("history")
    }

    fun updateTitle(url: String, title: String?) {
        val h = find("history", url) ?: return
        if (!title.isNullOrBlank() && h.optString("title") != title) { h.put("title", title); save() }
    }

    fun history(query: String, limit: Int = 300): JSONArray {
        val q = query.lowercase()
        return JSONArray(SyncModel.objects(list("history"))
            .filter { !it.optBoolean("deleted") && (q.isEmpty() || it.optString("title").lowercase().contains(q) || it.optString("url").lowercase().contains(q)) }
            .sortedByDescending { it.optLong("visitedAt") }
            .take(limit))
    }

    fun removeHistory(id: String) {
        val h = find("history", id) ?: return
        h.put("deleted", true).put("updatedAt", now())
        changed("history")
    }

    fun clearHistory() {
        data.put("historyClearedAt", now())
        data.put("history", JSONArray())
        changed("history")
    }

    // ---------- Einstellungen
    fun prefs(): JSONObject = data.getJSONObject("prefs")

    fun setPrefs(patch: JSONObject) {
        val p = prefs()
        for (k in patch.keys()) p.put(k, patch.get(k))
        p.put("updatedAt", now())
        changed("prefs")
    }

    // ---------- Eigene Skripte
    fun scripts(): JSONArray = JSONArray(SyncModel.objects(list("scripts"))
        .filter { !it.optBoolean("deleted") }.sortedBy { it.optString("name").lowercase() })

    fun saveScript(item: JSONObject) {
        val t = now()
        val match = JSONArray()
        item.optJSONArray("match")?.let { a -> for (i in 0 until minOf(a.length(), 50)) a.optString(i).trim().takeIf { it.isNotEmpty() }?.let { match.put(it) } }
        val id = item.optString("id").takeIf { it.isNotEmpty() && it != "null" }
        val s = id?.let { find("scripts", it) }
        val target = s ?: JSONObject().put("id", SyncModel.newId()).put("createdAt", t).also { list("scripts").put(it) }
        target.put("name", item.optString("name").trim().take(120).ifEmpty { "Unbenanntes Skript" })
            .put("match", match)
            .put("code", item.optString("code").take(200_000))
            .put("enabled", item.optBoolean("enabled", true))
            .put("deleted", false)
            .put("updatedAt", t)
        changed("scripts")
    }

    fun setScriptEnabled(id: String, on: Boolean) {
        val s = find("scripts", id) ?: return
        s.put("enabled", on).put("updatedAt", now())
        changed("scripts")
    }

    fun deleteScript(id: String) {
        val s = find("scripts", id) ?: return
        s.put("deleted", true).put("updatedAt", now())
        changed("scripts")
    }

    // ---------- Geräte
    val deviceId: String get() = data.optString("deviceId")

    fun setDeviceTabs(name: String, tabs: JSONArray) {
        val devices = data.optJSONObject("devices") ?: JSONObject().also { data.put("devices", it) }
        val limited = JSONArray(SyncModel.objects(tabs).take(60))
        devices.put(deviceId, JSONObject().put("name", name).put("platform", "android").put("tabs", limited)
            .put("sent", outbox()).put("updatedAt", now()))
    }

    // ---------- Tabs an andere Geräte senden (gleiches Verfahren wie am PC: Ausgang im eigenen Geräte-Eintrag)
    private fun outbox(): JSONArray {
        val cutoff = now() - 7 * 86_400_000L
        val keep = SyncModel.objects(data.optJSONArray("sentTabs") ?: JSONArray()).filter { it.optLong("at") > cutoff }.takeLast(20)
        val arr = JSONArray(keep)
        data.put("sentTabs", arr)
        return arr
    }

    fun sendTab(to: String, url: String, title: String): Boolean {
        if (to.isEmpty() || to == deviceId || !Regex("(?i)^https?://").containsMatchIn(url)) return false
        val list = SyncModel.objects(outbox()).toMutableList()
        list.add(JSONObject().put("id", SyncModel.newId()).put("to", to).put("url", url.take(4000))
            .put("title", title.ifBlank { url }.take(200)).put("at", now()))
        val arr = JSONArray(list.takeLast(20))
        data.put("sentTabs", arr)
        data.optJSONObject("devices")?.optJSONObject(deviceId)?.put("sent", arr)
        changed("sent")
        return true
    }

    /** Neue Tabs von anderen Geräten (jeder nur einmal): Liste aus (Adresse, Titel, Absender) */
    fun takeInbox(): List<Triple<String, String, String>> {
        val seenArr = data.optJSONArray("seenSent") ?: JSONArray()
        val seen = LinkedHashSet<String>()
        for (i in 0 until seenArr.length()) seen.add(seenArr.optString(i))
        val cutoff = now() - 7 * 86_400_000L
        val out = mutableListOf<Triple<String, String, String>>()
        val devices = data.optJSONObject("devices") ?: return out
        for (id in devices.keys()) {
            if (id == deviceId) continue
            val d = devices.optJSONObject(id) ?: continue
            val sent = d.optJSONArray("sent") ?: continue
            for (s in SyncModel.objects(sent)) {
                val sid = s.optString("id")
                val url = s.optString("url")
                if (s.optString("to") != deviceId || sid.isEmpty() || seen.contains(sid) || s.optLong("at") <= cutoff) continue
                if (!Regex("(?i)^https?://").containsMatchIn(url)) continue
                seen.add(sid)
                out.add(Triple(url, s.optString("title").ifBlank { url }, d.optString("name").ifBlank { "Anderes Gerät" }))
            }
        }
        if (out.isNotEmpty()) { data.put("seenSent", JSONArray(seen.toList().takeLast(300))); save() }
        return out
    }

    fun otherDevices(): JSONArray {
        val devices = data.optJSONObject("devices") ?: return JSONArray()
        val out = mutableListOf<JSONObject>()
        for (id in devices.keys()) {
            if (id == deviceId) continue
            val d = devices.optJSONObject(id) ?: continue
            out.add(JSONObject(d.toString()).put("id", id))
        }
        return JSONArray(out.sortedByDescending { it.optLong("updatedAt") })
    }

    // ---------- Sync
    fun syncedPart(): JSONObject = JSONObject()
        .put("bookmarks", list("bookmarks"))
        .put("shortcuts", list("shortcuts"))
        .put("history", list("history"))
        .put("historyClearedAt", data.optLong("historyClearedAt"))
        .put("scripts", list("scripts"))
        .put("devices", data.optJSONObject("devices") ?: JSONObject())
        .put("prefs", prefs())

    fun applySynced(merged: JSONObject) {
        for (k in merged.keys()) data.put(k, merged.get(k))
        save()
        onChange?.invoke("all", false)
    }
}
