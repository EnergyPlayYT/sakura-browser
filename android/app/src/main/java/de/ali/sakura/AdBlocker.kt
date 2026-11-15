package de.ali.sakura

import android.content.Context
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Blockiert Anfragen an bekannte Werbe- und Tracker-Domains (auch alle Subdomains). */
class AdBlocker(private val ctx: Context, private val store: Store) {
    @Volatile private var base: Set<String> = emptySet()
    @Volatile private var extended: Set<String> = emptySet()
    private val extFile = File(ctx.filesDir, "filter-erweitert.txt")
    private val io = Executors.newSingleThreadExecutor()

    // Werte, die der Hintergrund-Thread von WebView lesen darf (werden vom UI-Thread aktualisiert)
    @Volatile var enabled = true
    @Volatile var useExtended = false
    @Volatile var allow: Set<String> = emptySet()

    init {
        syncPrefs()
        io.execute {
            base = parse(ctx.assets.open("blocklist.txt").bufferedReader().use { it.readText() })
            if (extFile.exists()) extended = parse(extFile.readText())
        }
    }

    fun syncPrefs() {
        val p = store.prefs()
        enabled = p.optBoolean("adblock", true)
        useExtended = p.optBoolean("adblockExtended", false)
        val a = p.optJSONArray("adblockAllow")
        allow = if (a == null) emptySet() else (0 until a.length()).map { a.optString(it) }.toSet()
    }

    val size get() = base.size + if (useExtended) extended.size else 0

    private fun parse(text: String): Set<String> {
        val set = HashSet<String>()
        for (raw in text.lineSequence()) {
            val line = raw.substringBefore('#').trim()
            if (line.isEmpty()) continue
            val parts = line.split(Regex("\\s+"))
            val d = (if (parts.size > 1) parts[1] else parts[0]).lowercase()
            if (d.contains('.') && d != "0.0.0.0" && d != "localhost") set.add(d)
        }
        return set
    }

    /** Lädt die große Liste neu, wenn sie älter als eine Woche ist. done(Fehlermeldung oder null) auf Hintergrund-Thread. */
    fun refreshExtended(force: Boolean, done: (String?) -> Unit = {}) {
        if (!useExtended) { done(null); return }
        io.execute {
            try {
                if (!force && extFile.exists() && System.currentTimeMillis() - extFile.lastModified() < 7 * 86_400_000L && extended.isNotEmpty()) {
                    done(null); return@execute
                }
                val c = URL("https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts").openConnection() as HttpURLConnection
                c.connectTimeout = 15000; c.readTimeout = 30000
                val text = c.inputStream.bufferedReader().use { it.readText() }
                extFile.writeText(text)
                extended = parse(text)
                done(null)
            } catch (e: Exception) {
                done("Die erweiterte Liste konnte nicht geladen werden.")
            }
        }
    }

    fun isBlocked(host: String): Boolean {
        var h = host.lowercase()
        val ext = useExtended
        while (h.contains('.')) {
            if (base.contains(h) || (ext && extended.contains(h))) return true
            h = h.substring(h.indexOf('.') + 1)
        }
        return false
    }

    /** pageHost = Seite, auf der der Tab gerade ist (für Ausnahmen) */
    fun check(host: String?, pageHost: String?): Boolean {
        if (!enabled || host == null) return false
        if (pageHost != null && allow.contains(pageHost.removePrefix("www."))) return false
        return isBlocked(host)
    }

    fun emptyResponse() = WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
}
