package de.ali.sakura

import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder

/** Gleiche Zusammenführungslogik wie desktop/lib/model.js – beide Seiten müssen identisch rechnen. */
object SyncModel {
    const val HISTORY_LOCAL = 3000
    const val HISTORY_SYNC = 500
    private const val TOMBSTONE_MS = 60L * 86_400_000L
    private const val DEVICE_MS = 30L * 86_400_000L

    val ENGINES = linkedMapOf(
        "google" to "https://www.google.com/search?q=%s",
        "duckduckgo" to "https://duckduckgo.com/?q=%s",
        "ecosia" to "https://www.ecosia.org/search?q=%s",
        "startpage" to "https://www.startpage.com/do/search?query=%s",
        "bing" to "https://www.bing.com/search?q=%s"
    )

    fun defaultPrefs(updatedAt: Long = 0): JSONObject = JSONObject()
        .put("searchEngine", "google")
        .put("adblock", true)
        .put("adblockExtended", false)
        .put("adblockAllow", JSONArray())
        .put("backgrounds", JSONArray())
        .put("bgMinutes", 1)
        .put("bgBuiltin", true)
        .put("restoreSession", true)
        .put("siteTheme", "system")
        .put("downloadAsk", false)
        .put("cookieReject", true)
        .put("cookieAllow", JSONArray())
        .put("animations", true)
        .put("mouseGestures", true)
        .put("linkPreview", true)
        .put("pipButton", true)
        .put("verticalTabs", false)
        .put("batterySaver", "auto")
        .put("tabGarden", true)
        .put("archiveDays", 14)
        .put("phishWarn", true)
        .put("ntWidgets", true)
        .put("weatherCity", "")
        .put("readerSize", 20)
        .put("readerTheme", "sepia")
        .put("steamInfo", true)
        .put("twitchEmotes", true)
        .put("twitchBgAudio", false)
        .put("twitchPoints", false)
        .put("youtube", true)
        .put("ytSponsor", true)
        .put("ytQuality", "hd1080")
        .put("sleepAfter", 30)
        .put("ramLimit", 0)
        .put("cpuLimit", 0)
        .put("streamerMode", "auto")
        .put("watchHours", 3)
        .put("containerNames", JSONArray())
        .put("passwordManager", true)
        .put("passwordSave", true)
        .put("passwordFill", true)
        .put("popupBlock", true)
        .put("popupAllow", JSONArray())
        .put("videoResume", true)
        .put("skipIntro", true)
        .put("autoNext", true)
        .put("gaming", true)
        .put("gamingSleep", true)
        .put("gamingExtra", JSONArray())
        .put("theme", "sakura")
        .put("accent", "")
        .put("updatedAt", updatedAt)

    fun emptyData(): JSONObject {
        val shortcuts = JSONArray() // keine vorgegebenen Kacheln – jeder legt seine eigenen an
        return JSONObject()
            .put("bookmarks", JSONArray())
            .put("shortcuts", shortcuts)
            .put("history", JSONArray())
            .put("historyClearedAt", 0)
            .put("scripts", JSONArray())
            .put("devices", JSONObject())
            .put("prefs", defaultPrefs(1))
    }

    fun objects(arr: JSONArray?): List<JSONObject> {
        if (arr == null) return emptyList()
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }
    }

    fun mergeList(a: JSONArray?, b: JSONArray?): JSONArray {
        val m = LinkedHashMap<String, JSONObject>()
        for (it in objects(a) + objects(b)) {
            val id = it.optString("id")
            if (id.isEmpty()) continue
            val cur = m[id]
            if (cur == null || it.optLong("updatedAt") > cur.optLong("updatedAt")) m[id] = it
        }
        val cutoff = System.currentTimeMillis() - TOMBSTONE_MS
        return JSONArray(m.values.filter { !(it.optBoolean("deleted") && it.optLong("updatedAt") < cutoff) })
    }

    fun trimHistory(list: JSONArray?, clearedAt: Long, limit: Int): JSONArray =
        JSONArray(objects(list)
            .filter { it.optLong("visitedAt") > clearedAt }
            .sortedByDescending { it.optLong("updatedAt") }
            .take(limit))

    private fun withDefaults(p: JSONObject?): JSONObject {
        val out = defaultPrefs()
        if (p != null) for (k in p.keys()) out.put(k, p.get(k))
        return out
    }

    fun mergeDevices(a: JSONObject?, b: JSONObject?): JSONObject {
        val out = JSONObject()
        val cutoff = System.currentTimeMillis() - DEVICE_MS
        for (src in listOf(a, b)) {
            if (src == null) continue
            for (id in src.keys()) {
                val d = src.optJSONObject(id) ?: continue
                if (d.optLong("updatedAt") < cutoff) continue
                val cur = out.optJSONObject(id)
                if (cur == null || d.optLong("updatedAt") > cur.optLong("updatedAt")) out.put(id, d)
            }
        }
        return out
    }

    fun mergeData(local: JSONObject, remote: JSONObject): JSONObject {
        val clearedAt = maxOf(local.optLong("historyClearedAt"), remote.optLong("historyClearedAt"))
        val lp = local.optJSONObject("prefs")
        val rp = remote.optJSONObject("prefs")
        val prefs = if (rp != null && rp.optLong("updatedAt") > (lp?.optLong("updatedAt") ?: 0)) withDefaults(rp) else withDefaults(lp)
        return JSONObject()
            .put("bookmarks", mergeList(local.optJSONArray("bookmarks"), remote.optJSONArray("bookmarks")))
            .put("shortcuts", mergeList(local.optJSONArray("shortcuts"), remote.optJSONArray("shortcuts")))
            .put("history", trimHistory(mergeList(local.optJSONArray("history"), remote.optJSONArray("history")), clearedAt, HISTORY_LOCAL))
            .put("historyClearedAt", clearedAt)
            .put("scripts", mergeList(local.optJSONArray("scripts"), remote.optJSONArray("scripts")))
            .put("devices", mergeDevices(local.optJSONObject("devices"), remote.optJSONObject("devices")))
            .put("prefs", prefs)
    }

    fun payload(data: JSONObject): JSONObject = JSONObject()
        .put("v", 1)
        .put("bookmarks", data.optJSONArray("bookmarks") ?: JSONArray())
        .put("shortcuts", data.optJSONArray("shortcuts") ?: JSONArray())
        .put("history", trimHistory(data.optJSONArray("history"), data.optLong("historyClearedAt"), HISTORY_SYNC))
        .put("historyClearedAt", data.optLong("historyClearedAt"))
        .put("scripts", data.optJSONArray("scripts") ?: JSONArray())
        .put("devices", data.optJSONObject("devices") ?: JSONObject())
        .put("prefs", data.optJSONObject("prefs") ?: defaultPrefs())

    private val SCHEME = Regex("^(https?|file|about|view-source|intent|mailto|tel):", RegexOption.IGNORE_CASE)
    private val LOCAL = Regex("^localhost(:\\d+)?(/|$)", RegexOption.IGNORE_CASE)
    private val IP = Regex("^\\d{1,3}(\\.\\d{1,3}){3}(:\\d+)?(/|$)")
    private val DOMAIN = Regex("^[^\\s/]+\\.[a-z][a-z0-9-]+(:\\d+)?(/.*)?$", RegexOption.IGNORE_CASE)

    fun toUrl(input: String?, engine: String?): String? {
        val s = input?.trim().orEmpty()
        if (s.isEmpty()) return null
        if (SCHEME.containsMatchIn(s)) return s
        if (LOCAL.containsMatchIn(s) || IP.containsMatchIn(s)) return "http://$s"
        if (!s.contains(Regex("\\s")) && DOMAIN.matches(s)) return "https://$s"
        val tpl = ENGINES[engine] ?: ENGINES.getValue("google")
        return tpl.replace("%s", URLEncoder.encode(s, "UTF-8").replace("+", "%20"))
    }

    // ---------- Adressmuster für eigene Skripte (gleiche Regeln wie matchPattern in model.js)
    private fun glob(s: String): Regex {
        val sb = StringBuilder("^")
        for (c in s) sb.append(if (c == '*') ".*" else Regex.escape(c.toString()))
        sb.append("$")
        return Regex(sb.toString(), RegexOption.IGNORE_CASE)
    }

    private val STRICT = Regex("^(\\*|https?)://([^/]+)(/.*)?$", RegexOption.IGNORE_CASE)

    fun matchPattern(pattern: String?, url: String): Boolean {
        val p = pattern?.trim().orEmpty()
        if (p.isEmpty()) return false
        val uri = try { java.net.URI(url) } catch (_: Exception) { return false }
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme != "http" && scheme != "https") return false
        if (p == "<all_urls>" || p == "*") return true
        val h = (uri.host ?: return false).lowercase()
        val pathQuery = (uri.rawPath?.ifEmpty { "/" } ?: "/") + (uri.rawQuery?.let { "?$it" } ?: "")
        var pScheme = "*"
        var host: String
        var path: String
        val m = STRICT.find(p)
        if (m != null) {
            pScheme = m.groupValues[1].lowercase(); host = m.groupValues[2]; path = m.groupValues[3].ifEmpty { "/*" }
        } else if (!Regex("^[a-z]+:", RegexOption.IGNORE_CASE).containsMatchIn(p)) {
            val i = p.indexOf('/')
            host = if (i < 0) p else p.substring(0, i)
            path = if (i < 0) "/*" else p.substring(i) + (if (p.endsWith("*")) "" else "*")
            if (!host.contains('*')) host = "*.$host"
        } else return glob(p).matches(url)
        host = host.lowercase().replace(Regex(":\\d+$"), "")
        val inner = if (host.startsWith("*.")) host.substring(2) else host
        if (inner.contains('*')) return glob(if (p.contains("://")) p else "*://$p").matches(url)
        if (pScheme != "*" && scheme != pScheme) return false
        if (host != "*") {
            if (host.startsWith("*.")) { val base = host.substring(2); if (h != base && !h.endsWith(".$base")) return false }
            else if (h != host) return false
        }
        return glob(path).matches(pathQuery)
    }

    fun scriptsFor(scripts: JSONArray?, url: String): List<JSONObject> = objects(scripts).filter { s ->
        !s.optBoolean("deleted") && s.optBoolean("enabled", true) &&
            s.optJSONArray("match")?.let { arr -> (0 until arr.length()).any { matchPattern(arr.optString(it), url) } } == true
    }

    fun newId(): String =
        java.lang.Long.toString(System.currentTimeMillis(), 36) + java.lang.Long.toString((Math.random() * 2_000_000_000L).toLong(), 36).take(6)
}
