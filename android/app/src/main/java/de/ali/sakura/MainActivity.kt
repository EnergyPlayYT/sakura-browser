package de.ali.sakura

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.Dialog
import android.app.DownloadManager
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.net.http.SslError
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Message
import android.text.Editable
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.webkit.*
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ProfileStore
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewCompat
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import org.json.JSONArray
import org.json.JSONObject

class Tab(val id: Int, val web: WebView, val isPrivate: Boolean, val openerId: Int?) {
    var title = "Neuer Tab"
    var url = MainActivity.NEWTAB
    @Volatile var pageHost: String? = null
    var blocked = 0
    var progress = 100
    var desktop = false
    var pendingUrl: String? = null
    var group: String? = null
}

class TabGroup(val id: String, var name: String, var color: String, var collapsed: Boolean = false)

@SuppressLint("RequiresFeature")
class MainActivity : ComponentActivity() {
    companion object {
        const val ORIGIN = "https://appassets.androidplatform.net"
        const val ASSETS = "$ORIGIN/assets/"
        const val NEWTAB = "${ASSETS}newtab.html"
        const val MANAGE = "${ASSETS}manage.html"
        const val PRIVATE_PROFILE = "sakura_privat"
    }

    private lateinit var store: Store
    private lateinit var sync: SyncClient
    private lateinit var blocker: AdBlocker
    private lateinit var assetLoader: WebViewAssetLoader
    private lateinit var updates: UpdateCheck

    private val tabs = mutableListOf<Tab>()
    private val groups = LinkedHashMap<String, TabGroup>()
    private var groupCounter = 0
    private val groupColors = linkedMapOf(
        "sakura" to ("Rosa" to 0xFFF2B3C5.toInt()), "sora" to ("Blau" to 0xFF8CB8E8.toInt()),
        "matcha" to ("Grün" to 0xFF9CCB8F.toInt()), "yamabuki" to ("Gelb" to 0xFFE9C46A.toInt()),
        "fuji" to ("Lila" to 0xFFB9A3E3.toInt()), "momiji" to ("Rot" to 0xFFE5677F.toInt()), "sumi" to ("Grau" to 0xFFA59EB8.toInt())
    )
    private var active: Tab? = null
    private var tabCounter = 0

    private lateinit var content: FrameLayout
    private lateinit var address: EditText
    private lateinit var btnStar: ImageButton
    private lateinit var btnReload: ImageButton
    private lateinit var btnBack: ImageButton
    private lateinit var btnForward: ImageButton
    private lateinit var shieldBadge: TextView
    private lateinit var shieldIcon: ImageView
    private lateinit var tabCount: TextView
    private lateinit var progress: ProgressBar
    private lateinit var topBar: View
    private lateinit var bottomBar: View
    private lateinit var fullscreen: FrameLayout
    private lateinit var findBar: View
    private lateinit var findInput: EditText
    private lateinit var findCount: TextView

    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val profilesSupported by lazy { WebViewFeature.isFeatureSupported(WebViewFeature.MULTI_PROFILE) }

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res.resultCode, res.data))
        fileCallback = null
    }

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private val yoru get() = getColor(R.color.yoru)

    // ================================================================ Start
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(SystemBarStyle.dark(Color.TRANSPARENT), SystemBarStyle.dark(Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        store = Store(this)
        sync = SyncClient(this, store)
        blocker = AdBlocker(this, store)
        store.onChange = { kind, synced ->
            sync.noteChange(kind, synced)
            if (kind == "prefs" || kind == "all") { blocker.syncPrefs(); applyDarkAll(); refreshStartPages() } // Design auf der Startseite übernehmen
            updateUi()
        }
        sync.onMerged = { refreshStartPages(); deliverInbox() }
        sync.tabsProvider = { Pair(deviceName(), openTabsForSync()) }
        blocker.refreshExtended(false)
        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        if (profilesSupported) {
            try { ProfileStore.getInstance().deleteProfile(PRIVATE_PROFILE) } catch (_: Exception) { }
        }

        updates = UpdateCheck(this)
        bindViews()
        applyInsets()

        val start = intentUrl(intent)
        if (!restoreTabs()) newTab(start ?: NEWTAB)
        else if (start != null) newTab(start)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = goBackOrLeave()
        })
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        intentUrl(intent)?.let { newTab(it) }
    }

    override fun onResume() {
        super.onResume()
        active?.web?.onResume()
        if (sync.configured) sync.syncNow()
        updates.checkDaily { offerUpdate(it) }
    }

    override fun onPause() {
        super.onPause()
        active?.web?.onPause()
        saveTabs()
        store.save()
        CookieManager.getInstance().flush()
    }

    private fun intentUrl(i: Intent?): String? {
        if (i == null) return null
        if (i.action == Intent.ACTION_WEB_SEARCH) {
            val q = i.getStringExtra("query") ?: return null
            return SyncModel.toUrl(q, store.prefs().optString("searchEngine"))
        }
        if (i.action == Intent.ACTION_VIEW) return i.dataString
        return null
    }

    private fun bindViews() {
        content = findViewById(R.id.content)
        address = findViewById(R.id.address)
        btnStar = findViewById(R.id.btnStar)
        btnReload = findViewById(R.id.btnReload)
        btnBack = findViewById(R.id.btnBack)
        btnForward = findViewById(R.id.btnForward)
        shieldBadge = findViewById(R.id.shieldBadge)
        shieldIcon = findViewById(R.id.shieldIcon)
        tabCount = findViewById(R.id.tabCount)
        progress = findViewById(R.id.progress)
        topBar = findViewById(R.id.topBar)
        bottomBar = findViewById(R.id.bottomBar)
        fullscreen = findViewById(R.id.fullscreen)
        findBar = findViewById(R.id.findBar)
        findInput = findViewById(R.id.findInput)
        findCount = findViewById(R.id.findCount)
        findInput.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) {}
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {}
            override fun afterTextChanged(s: Editable?) {
                val q = s?.toString().orEmpty()
                if (q.isEmpty()) { active?.web?.clearMatches(); findCount.text = "" } else active?.web?.findAllAsync(q)
            }
        })
        findInput.setOnEditorActionListener { _, _, _ -> active?.web?.findNext(true); true }
        findViewById<View>(R.id.findNext).setOnClickListener { active?.web?.findNext(true) }
        findViewById<View>(R.id.findPrev).setOnClickListener { active?.web?.findNext(false) }
        findViewById<View>(R.id.findClose).setOnClickListener { closeFind() }

        address.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO || action == EditorInfo.IME_ACTION_DONE) {
                navigate(address.text.toString()); true
            } else false
        }
        address.setOnFocusChangeListener { _, has ->
            if (!has) active?.let { address.setText(displayUrl(it.url)) }
        }
        btnStar.setOnClickListener {
            val t = active ?: return@setOnClickListener
            val u = realUrl(t)
            if (u.isNotEmpty()) {
                val added = store.toggleBookmark(u, t.title)
                toast(if (added) "Lesezeichen gespeichert" else "Lesezeichen entfernt")
            }
        }
        btnReload.setOnClickListener {
            val t = active ?: return@setOnClickListener
            if (t.progress < 100) t.web.stopLoading() else t.web.reload()
        }
        btnBack.setOnClickListener { active?.web?.let { if (it.canGoBack()) it.goBack() } }
        btnForward.setOnClickListener { active?.web?.let { if (it.canGoForward()) it.goForward() } }
        findViewById<View>(R.id.btnHome).setOnClickListener { active?.web?.loadUrl(NEWTAB) }
        findViewById<View>(R.id.btnTabs).setOnClickListener { showTabs() }
        findViewById<View>(R.id.btnMenu).setOnClickListener { showMenu(it) }
        findViewById<View>(R.id.btnShield).setOnClickListener { showShield() }
    }

    private fun applyInsets() {
        val column = findViewById<View>(R.id.column)
        ViewCompat.setOnApplyWindowInsetsListener(column) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            // Bei offener Tastatur die untere Leiste ausblenden, damit mehr Platz bleibt
            bottomBar.visibility = if (ime.bottom > 0) View.GONE else View.VISIBLE
            WindowInsetsCompat.CONSUMED
        }
    }

    // ================================================================ Tabs
    @SuppressLint("SetJavaScriptEnabled")
    private fun newTab(url: String?, isPrivate: Boolean = false, background: Boolean = false, opener: Tab? = null, lazy: Boolean = false, load: Boolean = true): Tab {
        val web = WebView(this)
        if (isPrivate && profilesSupported) {
            try {
                ProfileStore.getInstance().getOrCreateProfile(PRIVATE_PROFILE)
                WebViewCompat.setProfile(web, PRIVATE_PROFILE)
            } catch (_: Exception) { }
        }
        web.setBackgroundColor(if (url == null || url.startsWith(ASSETS)) yoru else Color.WHITE)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            loadWithOverviewMode = true
            useWideViewPort = true
            builtInZoomControls = true
            displayZoomControls = false
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = false
            mediaPlaybackRequiresUserGesture = true
            mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
            if (isPrivate) cacheMode = WebSettings.LOAD_NO_CACHE
            // Ohne „wv“-Kennung, damit z. B. Google-Anmeldungen funktionieren
            userAgentString = userAgentString.replace("; wv)", ")").replace(Regex("Version/\\d+\\.\\d+ "), "")
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, !isPrivate)
        applyDark(web)

        val tab = Tab(++tabCounter, web, isPrivate, opener?.id)
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "sakuraNative", setOf(ORIGIN)) { _, message, _, isMainFrame, reply ->
                if (isMainFrame) handleBridge(tab, message.data ?: "", reply)
            }
        }
        web.webViewClient = PageClient(tab)
        web.webChromeClient = ChromeClient(tab)
        web.setDownloadListener { dlUrl, ua, disposition, mime, _ -> download(dlUrl, ua, disposition, mime) }
        web.setFindListener { activeMatch, total, done ->
            if (tab === active && done) findCount.text = if (total == 0) "0 Treffer" else "${activeMatch + 1}/$total"
        }

        val index = if (opener != null) tabs.indexOf(opener) + 1 else tabs.size
        tab.group = opener?.group?.takeIf { groups.containsKey(it) && opener.isPrivate == isPrivate }
        tabs.add(index.coerceIn(0, tabs.size), tab)
        normalizeGroups()
        val target = url ?: NEWTAB
        if (!load) tab.url = "about:blank"
        else if (lazy) { tab.pendingUrl = target; tab.url = target } else web.loadUrl(target)
        if (!background || active == null) activate(tab) else updateUi()
        if (!isPrivate) sync.noteChange("tabs", true)
        return tab
    }

    private fun activate(tab: Tab) {
        if (findBar.visibility == View.VISIBLE) closeFind()
        tab.group?.let { groups[it]?.collapsed = false }
        active?.let { if (it !== tab) it.web.onPause() }
        active = tab
        content.removeAllViews()
        (tab.web.parent as? ViewGroup)?.removeView(tab.web)
        content.addView(tab.web, FrameLayout.LayoutParams(-1, -1))
        tab.web.onResume()
        tab.pendingUrl?.let { tab.pendingUrl = null; tab.web.loadUrl(it) }
        address.clearFocus()
        address.setText(displayUrl(tab.url))
        updateUi()
    }

    private fun closeTab(tab: Tab) {
        val i = tabs.indexOf(tab)
        if (i < 0) return
        tabs.removeAt(i)
        if (active === tab) {
            content.removeAllViews()
            active = null
        }
        tab.web.stopLoading()
        tab.web.destroy()
        if (!tab.isPrivate) sync.noteChange("tabs", true)
        if (tab.isPrivate && tabs.none { it.isPrivate } && profilesSupported) {
            // Letzter privater Tab zu → alle privaten Cookies und Daten löschen
            content.postDelayed({
                try { ProfileStore.getInstance().deleteProfile(PRIVATE_PROFILE) } catch (_: Exception) { }
            }, 500)
        }
        normalizeGroups()
        if (tabs.isEmpty()) { newTab(NEWTAB); return }
        if (active == null) {
            val opener = tabs.firstOrNull { it.id == tab.openerId }
            activate(opener ?: tabs[minOf(i, tabs.size - 1)])
        } else updateUi()
    }

    private fun goBackOrLeave() {
        when {
            customView != null -> customCallback?.onCustomViewHidden()
            findBar.visibility == View.VISIBLE -> closeFind()
            address.hasFocus() -> { address.clearFocus(); hideKeyboard() }
            active?.web?.canGoBack() == true -> active!!.web.goBack()
            active?.openerId != null -> closeTab(active!!)
            else -> moveTaskToBack(true)
        }
    }

    private fun saveTabs() {
        val list = tabs.filter { !it.isPrivate }
        val arr = JSONArray()
        val tabGroups = JSONArray()
        list.forEach { arr.put(it.web.url ?: it.pendingUrl ?: it.url); tabGroups.put(it.group ?: "") }
        val gs = JSONArray()
        for (g in groups.values) gs.put(JSONObject().put("id", g.id).put("name", g.name).put("color", g.color).put("collapsed", g.collapsed))
        getSharedPreferences("tabs", MODE_PRIVATE).edit()
            .putString("urls", arr.toString())
            .putString("tabGroups", tabGroups.toString())
            .putString("groups", gs.toString())
            .putInt("active", list.indexOf(active).coerceAtLeast(0))
            .apply()
    }

    private fun restoreTabs(): Boolean {
        val sp = getSharedPreferences("tabs", MODE_PRIVATE)
        val arr = try { JSONArray(sp.getString("urls", "[]")) } catch (_: Exception) { JSONArray() }
        if (arr.length() == 0) return false
        val act = sp.getInt("active", 0)
        val gs = try { JSONArray(sp.getString("groups", "[]")) } catch (_: Exception) { JSONArray() }
        for (g in SyncModel.objects(gs)) {
            val id = g.optString("id")
            if (id.isEmpty()) continue
            groups[id] = TabGroup(id, g.optString("name"), g.optString("color", "sakura"), g.optBoolean("collapsed"))
            id.removePrefix("g").toIntOrNull()?.let { groupCounter = maxOf(groupCounter, it) }
        }
        val tg = try { JSONArray(sp.getString("tabGroups", "[]")) } catch (_: Exception) { JSONArray() }
        val created = (0 until arr.length()).map { i ->
            newTab(arr.optString(i), background = true, lazy = true).also { t ->
                t.group = tg.optString(i).takeIf { it.isNotEmpty() && groups.containsKey(it) }
            }
        }
        normalizeGroups()
        activate(created[act.coerceIn(0, created.size - 1)])
        return true
    }

    private fun navigate(input: String) {
        val url = SyncModel.toUrl(input, store.prefs().optString("searchEngine")) ?: return
        address.clearFocus()
        hideKeyboard()
        active?.web?.loadUrl(url)
    }

    // ---------- Suchen auf der Seite
    private fun openFind() {
        findBar.visibility = View.VISIBLE
        findInput.requestFocus()
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(findInput, 0)
        if (findInput.text.isNotEmpty()) active?.web?.findAllAsync(findInput.text.toString())
    }

    private fun closeFind() {
        findBar.visibility = View.GONE
        active?.web?.clearMatches()
        findCount.text = ""
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(findInput.windowToken, 0)
    }

    // ---------- Webseiten abdunkeln
    private fun applyDark(web: WebView) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
            WebSettingsCompat.setAlgorithmicDarkeningAllowed(web.settings, store.prefs().optString("siteTheme") == "force")
        }
    }

    private fun applyDarkAll() = tabs.forEach { applyDark(it.web) }

    // ---------- Cookie-Banner automatisch ablehnen (assets/cookie-reject.js, gleiche Datei wie am PC)
    private val cookieScript: String by lazy {
        try { assets.open("cookie-reject.js").bufferedReader().use { it.readText() } } catch (_: Exception) { "" }
    }

    private fun cookieAllowList(): Set<String> {
        val a = store.prefs().optJSONArray("cookieAllow") ?: return emptySet()
        return (0 until a.length()).map { a.optString(it) }.toSet()
    }

    private fun runCookieReject(view: WebView, url: String) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        if (!store.prefs().optBoolean("cookieReject", true) || cookieScript.isEmpty()) return
        val host = hostOf(url) ?: return
        if (host in cookieAllowList()) return
        view.evaluateJavascript(cookieScript, null)
    }

    // ---------- YouTube: Werbung und Sponsoren überspringen, Qualität (assets/youtube.js + youtube.css, wie am PC)
    private val ytScript: String by lazy {
        try { assets.open("youtube.js").bufferedReader().use { it.readText() } } catch (_: Exception) { "" }
    }
    private val ytCss: String by lazy {
        try { assets.open("youtube.css").bufferedReader().use { it.readText() } } catch (_: Exception) { "" }
    }

    private fun runYouTube(view: WebView, url: String) {
        val host = hostOf(url) ?: return
        if (!url.startsWith("https://") || !(host == "youtube.com" || host.endsWith(".youtube.com"))) return
        val p = store.prefs()
        if (!p.optBoolean("youtube", true) || ytScript.isEmpty()) return
        val cfg = JSONObject().put("quality", p.optString("ytQuality", "hd1080")).put("sponsorblock", p.optBoolean("ytSponsor", true))
        val css = JSONObject.quote(ytCss)
        view.evaluateJavascript(
            "(function(){if(!document.getElementById('sakura-yt-css')){var s=document.createElement('style');s.id='sakura-yt-css';" +
                "s.textContent=$css;(document.head||document.documentElement).appendChild(s);}})();\n" +
                "window.__sakuraYTConfig = $cfg;\n$ytScript", null)
    }

    // ---------- Videos und Serien: weiterschauen, Intro überspringen, nächste Folge (assets/video.js, wie am PC)
    private val videoScript: String by lazy {
        try { assets.open("video.js").bufferedReader().use { it.readText() } } catch (_: Exception) { "" }
    }

    private fun runVideoHelper(view: WebView, url: String) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        val p = store.prefs()
        val resume = p.optBoolean("videoResume", true)
        val intro = p.optBoolean("skipIntro", true)
        val next = p.optBoolean("autoNext", true)
        if ((!resume && !intro && !next) || videoScript.isEmpty()) return
        // Private Tabs merken sich keine Stellen
        val priv = tabs.firstOrNull { it.web === view }?.isPrivate == true
        val cfg = JSONObject().put("resume", resume && !priv).put("intro", intro).put("next", next)
        view.evaluateJavascript("window.__sakuraVideoConfig = $cfg;\n$videoScript", null)
    }

    // ---------- Eigene Skripte
    private fun runUserScripts(view: WebView, url: String) {
        if (!url.startsWith("http://") && !url.startsWith("https://")) return
        for (s in SyncModel.scriptsFor(store.data.optJSONArray("scripts"), url)) {
            val label = JSONObject.quote("[Sakura-Skript] " + s.optString("name"))
            view.evaluateJavascript("(function(){try{\n" + s.optString("code") + "\n}catch(e){console.error($label, e)}})();", null)
        }
    }

    // ---------- Geräte
    private fun deviceName(): String {
        val m = Build.MODEL ?: "Android"
        val man = Build.MANUFACTURER ?: ""
        return if (m.lowercase().startsWith(man.lowercase())) m else "$man $m".trim()
    }

    private fun openTabsForSync(): JSONArray {
        val arr = JSONArray()
        for (t in tabs) {
            if (t.isPrivate) continue
            val u = realUrl(t)
            if (u.startsWith("http")) arr.put(JSONObject().put("url", u).put("title", t.title))
        }
        return arr
    }

    private fun translate(t: Tab) {
        val u = realUrl(t)
        if (u.startsWith("http")) t.web.loadUrl("https://translate.google.com/translate?sl=auto&tl=de&u=" + Uri.encode(u))
    }

    /** Tabs, die andere Geräte hierher geschickt haben, im Hintergrund öffnen */
    private fun deliverInbox() {
        val items = store.takeInbox()
        if (items.isEmpty()) return
        for ((url, _, _) in items) newTab(url, background = true)
        val (_, title, from) = items.last()
        toast(if (items.size == 1) "Tab von $from: ${title.take(60)}" else "${items.size} Tabs von anderen Geräten geöffnet")
        updateUi()
    }

    /** Liste der anderen Geräte zum Senden des aktuellen Tabs */
    private fun sendToDevice(t: Tab) {
        val devs = SyncModel.objects(store.otherDevices())
        if (devs.isEmpty()) { toast("Keine anderen Geräte – richte zuerst den Sync ein"); return }
        val names = devs.map { it.optString("name").ifBlank { "Gerät" } + if (it.optString("platform") == "windows") " (PC)" else "" }
        AlertDialog.Builder(this).setTitle("An Gerät senden")
            .setItems(names.toTypedArray()) { _, i ->
                val d = devs[i]
                if (store.sendTab(d.optString("id"), realUrl(t), t.title)) toast("An ${d.optString("name").ifBlank { "das Gerät" }} gesendet")
                else toast("Diese Seite kann nicht gesendet werden")
            }
            .setNegativeButton("Abbrechen", null).show()
    }

    private fun refreshStartPages() {
        for (t in tabs) if (t.url.startsWith(NEWTAB)) t.web.evaluateJavascript("window.sakuraRefresh && sakuraRefresh()", null)
    }

    // ================================================================ Anzeige
    private fun displayUrl(u: String?): String {
        if (u == null) return ""
        if (u.startsWith(NEWTAB) || u.startsWith(MANAGE) || u == "about:blank") return ""
        if (u.startsWith("${ASSETS}error.html")) return Uri.parse(u).getQueryParameter("u") ?: ""
        return try { Uri.decode(u) } catch (_: Exception) { u }
    }

    /** Echte (nicht dekodierte) Adresse der Seite – so wird sie gespeichert, wie auf dem PC */
    private fun realUrl(t: Tab): String {
        val u = t.url
        if (u.startsWith(NEWTAB) || u.startsWith(MANAGE) || u == "about:blank") return ""
        if (u.startsWith("${ASSETS}error.html")) return Uri.parse(u).getQueryParameter("u") ?: ""
        return u
    }

    private fun hostOf(u: String?): String? = try { Uri.parse(u).host?.removePrefix("www.") } catch (_: Exception) { null }

    private fun updateUi() {
        val t = active ?: return
        val shown = displayUrl(t.url)
        if (!address.hasFocus()) address.setText(shown)
        btnBack.isEnabled = t.web.canGoBack(); btnBack.alpha = if (btnBack.isEnabled) 1f else .3f
        btnForward.isEnabled = t.web.canGoForward(); btnForward.alpha = if (btnForward.isEnabled) 1f else .3f
        btnStar.visibility = if (shown.isEmpty()) View.GONE else View.VISIBLE
        val real = realUrl(t)
        btnStar.setImageResource(if (real.isNotEmpty() && store.findBookmark(real) != null) R.drawable.ic_star_filled else R.drawable.ic_star)
        btnReload.setImageResource(if (t.progress < 100) R.drawable.ic_close else R.drawable.ic_reload)
        progress.visibility = if (t.progress < 100) View.VISIBLE else View.INVISIBLE
        progress.progress = t.progress
        val host = hostOf(shown)
        val paused = !blocker.enabled || (host != null && blocker.allow.contains(host))
        shieldIcon.alpha = if (paused) .35f else 1f
        shieldBadge.visibility = if (!paused && t.blocked > 0) View.VISIBLE else View.GONE
        shieldBadge.text = if (t.blocked > 99) "99+" else t.blocked.toString()
        tabCount.text = if (tabs.size > 99) ":D" else tabs.size.toString()
        val bar = if (t.isPrivate) getColor(R.color.private_bar) else yoru
        topBar.setBackgroundColor(bar)
        bottomBar.setBackgroundColor(bar)
        address.hint = if (t.isPrivate) "Privat suchen oder Adresse eingeben" else "Suchen oder Adresse eingeben"
    }

    private fun toast(s: String) = Toast.makeText(this, s, Toast.LENGTH_SHORT).show()

    private fun hideKeyboard() {
        (getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).hideSoftInputFromWindow(address.windowToken, 0)
    }

    // ================================================================ Seiten-Client
    private inner class PageClient(val tab: Tab) : WebViewClient() {
        override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
            assetLoader.shouldInterceptRequest(request.url)?.let { return it }
            if (!request.isForMainFrame && blocker.check(request.url.host, tab.pageHost)) {
                content.post { tab.blocked++; if (tab === active) updateUi() }
                return blocker.emptyResponse()
            }
            return null
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            val scheme = uri.scheme?.lowercase() ?: return false
            if (scheme == "http" || scheme == "https" || scheme == "about" || scheme == "data" || scheme == "blob") return false
            try {
                val intent = if (scheme == "intent") Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME)
                    .apply { addCategory(Intent.CATEGORY_BROWSABLE); component = null; selector = null }
                else Intent(Intent.ACTION_VIEW, uri)
                startActivity(intent)
            } catch (e: ActivityNotFoundException) {
                if (scheme == "intent") {
                    val fallback = try { Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME).getStringExtra("browser_fallback_url") } catch (_: Exception) { null }
                    if (fallback != null && fallback.startsWith("http")) view.loadUrl(fallback) else toast("Keine App für diesen Link gefunden")
                } else toast("Keine App für diesen Link gefunden")
            } catch (_: Exception) { }
            return true
        }

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            // Eigene Sakura-Seiten dunkel, alle anderen Webseiten mit weißem Grund (viele setzen keinen eigenen)
            view.setBackgroundColor(if (url.startsWith(ASSETS)) yoru else Color.WHITE)
            val host = hostOf(url)
            if (host != tab.pageHost) tab.blocked = 0
            tab.pageHost = host
            tab.url = url
            tab.progress = 5
            if (tab === active) updateUi()
        }

        override fun onPageFinished(view: WebView, url: String) {
            runCookieReject(view, url)
            runYouTube(view, url)
            runVideoHelper(view, url)
            runUserScripts(view, url)
            tab.progress = 100
            view.title?.let { if (it.isNotBlank()) tab.title = it }
            if (tab === active) updateUi()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
            tab.url = url
            tab.pageHost = hostOf(url)
            if (!tab.isPrivate && !isReload) store.visit(url, view.title)
            if (tab === active) updateUi()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (!request.isForMainFrame) return
            val code = when (error.errorCode) {
                ERROR_HOST_LOOKUP -> -105
                ERROR_CONNECT -> -102
                ERROR_TIMEOUT -> -7
                else -> 0
            }
            showError(view, request.url.toString(), error.description?.toString() ?: "", code)
        }

        override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
            handler.cancel()
            val code = if (error.primaryError == SslError.SSL_EXPIRED || error.primaryError == SslError.SSL_DATE_INVALID) -201 else -200
            showError(view, error.url, "Zertifikatsfehler", code)
        }

        private fun showError(view: WebView, url: String, desc: String, code: Int) {
            view.loadUrl("${ASSETS}error.html?u=${Uri.encode(url)}&d=${Uri.encode(desc)}&c=$code")
        }
    }

    // ================================================================ Chrome-Client (Fenster, Vollbild, Dateien)
    private inner class ChromeClient(val tab: Tab) : WebChromeClient() {
        override fun onProgressChanged(view: WebView, p: Int) {
            tab.progress = p
            if (tab === active) updateUi()
        }

        override fun onReceivedTitle(view: WebView, title: String?) {
            if (!title.isNullOrBlank()) {
                tab.title = title
                if (!tab.isPrivate) view.url?.let { store.updateTitle(it, title) }
            }
        }

        override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message): Boolean {
            if (!isUserGesture) return false // Pop-ups ohne Klick werden blockiert
            val t = newTab(null, isPrivate = tab.isPrivate, opener = tab, load = false)
            (resultMsg.obj as WebView.WebViewTransport).webView = t.web
            resultMsg.sendToTarget()
            return true
        }

        override fun onCloseWindow(window: WebView) {
            tabs.firstOrNull { it.web === window }?.let { closeTab(it) }
        }

        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (customView != null) { callback.onCustomViewHidden(); return }
            customView = view
            customCallback = callback
            fullscreen.addView(view, FrameLayout.LayoutParams(-1, -1))
            fullscreen.visibility = View.VISIBLE
            WindowCompat.getInsetsController(window, fullscreen).apply {
                hide(WindowInsetsCompat.Type.systemBars())
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }

        override fun onHideCustomView() {
            fullscreen.removeAllViews()
            fullscreen.visibility = View.GONE
            customView = null
            customCallback = null
            WindowCompat.getInsetsController(window, fullscreen).show(WindowInsetsCompat.Type.systemBars())
        }

        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try { fileChooser.launch(params.createIntent()); true } catch (_: Exception) { fileCallback = null; false }
        }

        override fun onPermissionRequest(request: PermissionRequest) {
            // Nur geschützte Medien (z. B. Streaming-Dienste) erlauben; Kamera und Mikrofon bleiben aus
            val ok = request.resources.filter { it == PermissionRequest.RESOURCE_PROTECTED_MEDIA_ID }
            if (ok.isNotEmpty()) request.grant(ok.toTypedArray()) else request.deny()
        }

        override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) {
            callback.invoke(origin, false, false)
        }
    }

    private fun download(url: String, ua: String, disposition: String?, mime: String?) {
        if (!url.startsWith("http")) { toast("Dieser Download wird nicht unterstützt"); return }
        try {
            val name = URLUtil.guessFileName(url, disposition, mime)
            val req = DownloadManager.Request(Uri.parse(url))
                .setMimeType(mime)
                .addRequestHeader("User-Agent", ua)
                .setTitle(name)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name)
            CookieManager.getInstance().getCookie(url)?.let { req.addRequestHeader("Cookie", it) }
            (getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(req)
            toast("Download gestartet: $name")
        } catch (e: Exception) {
            toast("Download nicht möglich")
        }
    }

    // ================================================================ Brücke zu den eigenen Seiten (Startseite, Verwaltung)
    private fun handleBridge(tab: Tab, data: String, reply: JavaScriptReplyProxy) {
        val msg = try { JSONObject(data) } catch (_: Exception) { return }
        val id = msg.opt("id")
        val arg = msg.opt("arg")
        fun send(result: Any?) {
            try { reply.postMessage(JSONObject().put("id", id).put("result", result ?: JSONObject.NULL).toString()) } catch (_: Exception) { }
        }
        val obj = arg as? JSONObject ?: JSONObject()
        val str = (arg as? String) ?: ""
        when (msg.optString("cmd")) {
            "platform" -> send("android")
            "isPrivate" -> send(tab.isPrivate)
            "shortcuts" -> send(store.shortcuts())
            "builtinBackgrounds" -> send(JSONArray((assets.list("backgrounds") ?: emptyArray())
                .filter { Regex("(?i)^[\\w .()-]+\\.(jpe?g|png|webp)$").matches(it) }.sorted()))
            "saveShortcut" -> {
                val url = SyncModel.toUrl(obj.optString("url"), "google")
                if (url == null || !url.startsWith("http") || url.startsWith("https://www.google.com/search?q=")) {
                    send(JSONObject().put("error", "Bitte eine gültige Adresse eingeben, z. B. youtube.com")); return
                }
                val title = obj.optString("title").trim().ifEmpty { hostOf(url) ?: url }
                store.saveShortcut(obj.optString("id").takeIf { it.isNotEmpty() && it != "null" }, title, url)
                send(store.shortcuts())
            }
            "deleteShortcut" -> { store.deleteShortcut(str); send(store.shortcuts()) }
            "orderShortcuts" -> { (arg as? JSONArray)?.let { store.orderShortcuts(it) }; send(store.shortcuts()) }
            "prefs" -> {
                val p = JSONObject(store.prefs().toString())
                p.put("engines", JSONArray(SyncModel.ENGINES.keys.toList())).put("blocklistSize", blocker.size)
                    .put("privateProfiles", profilesSupported)
                send(p)
            }
            "setPrefs" -> {
                store.setPrefs(obj)
                blocker.syncPrefs()
                if (obj.optBoolean("adblockExtended", false)) {
                    blocker.refreshExtended(true) { err ->
                        runOnUiThread { send(JSONObject().put("ok", err == null).put("error", err ?: JSONObject.NULL).put("blocklistSize", blocker.size)) }
                    }
                } else send(JSONObject().put("ok", true).put("blocklistSize", blocker.size))
            }
            "setWidgetPrefs" -> {
                // Startseite darf nur die eigenen Widget-Einstellungen ändern
                val p = JSONObject()
                if (obj.has("weatherCity")) p.put("weatherCity", obj.optString("weatherCity").trim().take(60))
                if (obj.has("ntWidgets")) p.put("ntWidgets", obj.optBoolean("ntWidgets"))
                store.setPrefs(p)
                send(JSONObject().put("ok", true))
            }
            "navigate" -> {
                SyncModel.toUrl(str, store.prefs().optString("searchEngine"))?.let { tab.web.loadUrl(it) }
                send(null)
            }
            "openUrl" -> { if (str.startsWith("http")) tab.web.loadUrl(str); send(null) }
            "openUrlInNewTab" -> { if (str.startsWith("http")) newTab(str, isPrivate = tab.isPrivate); send(null) }
            "bookmarks" -> send(store.bookmarks())
            "updateBookmark" -> {
                val patch = obj.optJSONObject("patch") ?: JSONObject()
                store.updateBookmark(obj.optString("id"), patch.optString("title", null), patch.optString("url", null))
                send(null)
            }
            "removeBookmark" -> { store.removeBookmark(str); send(null) }
            "history" -> send(store.history(str))
            "removeHistory" -> { store.removeHistory(str); send(null) }
            "clearHistory" -> {
                store.clearHistory()
                tabs.forEach { it.web.clearHistory(); it.web.clearCache(true) }
                if (obj.optBoolean("cookies")) {
                    CookieManager.getInstance().removeAllCookies(null)
                    WebStorage.getInstance().deleteAllData()
                }
                send(null)
            }
            "scripts" -> send(store.scripts())
            "saveScript" -> { store.saveScript(obj); send(store.scripts()) }
            "setScriptEnabled" -> { store.setScriptEnabled(obj.optString("id"), obj.optBoolean("enabled", true)); send(null) }
            "deleteScript" -> { store.deleteScript(str); send(null) }
            "devices" -> send(store.otherDevices())
            "currentHost" -> send(lastHost)
            "updateInfo" -> send(JSONObject().put("current", BuildConfig.VERSION_NAME).put("repo", updates.repo)
                .put("webview", WebViewCompat.getCurrentWebViewPackage(this)?.versionName ?: ""))
            "updateCheck" -> updates.check(true, { offerUpdate(it) }) { msg -> send(JSONObject().put("message", msg ?: JSONObject.NULL)) }
            "syncInfo" -> send(sync.info())
            "syncLogin" -> sync.login(obj.optString("apiKey"), obj.optString("projectId"), obj.optString("email"),
                obj.optString("password"), obj.optBoolean("create"), obj.optString("syncPassword")) { err ->
                send(if (err == null) sync.info() else sync.info().put("state", "error").put("message", err).put("email", ""))
            }
            "syncUnlock" -> sync.unlock(obj.optString("password"), obj.optBoolean("reset")) { err ->
                send(if (err == null) sync.info() else sync.info().put("message", err).put("failed", true))
            }
            "syncChangePassword" -> sync.changePassword(str) { err ->
                send(if (err == null) sync.info() else sync.info().put("message", err).put("failed", true))
            }
            "syncLogout" -> { sync.logout(); send(sync.info()) }
            "syncCreateCode" -> sync.createCode { err -> send(if (err == null) sync.info() else sync.info().put("message", err).put("failed", true)) }
            "syncConnectCode" -> sync.connectCode(str) { err -> send(if (err == null) sync.info() else sync.info().put("message", err).put("failed", true)) }
            "syncNow" -> { sync.syncNow(); send(sync.info()) }
            else -> send(null)
        }
    }

    // ================================================================ Dialoge
    private fun showShield() {
        val t = active ?: return
        val host = hostOf(displayUrl(t.url))
        val allowed = host != null && blocker.allow.contains(host)
        val text = when {
            !blocker.enabled -> "Der Werbeblocker ist ausgeschaltet."
            host == null -> "Auf dieser Seite gibt es nichts zu blockieren."
            allowed -> "Auf $host ist der Werbeblocker pausiert."
            t.blocked == 0 -> "Auf $host wurde noch nichts blockiert."
            else -> "${t.blocked} Werbe- und Tracker-Anfragen auf $host blockiert."
        }
        val b = AlertDialog.Builder(this).setTitle("Werbeblocker").setMessage(text)
            .setNegativeButton("Schließen", null)
        if (!blocker.enabled) {
            b.setPositiveButton("Einschalten") { _, _ -> store.setPrefs(JSONObject().put("adblock", true)); blocker.syncPrefs(); t.web.reload() }
        } else if (host != null) {
            b.setPositiveButton(if (allowed) "Hier wieder blockieren" else "Auf dieser Seite pausieren") { _, _ ->
                val set = blocker.allow.toMutableSet()
                if (allowed) set.remove(host) else set.add(host)
                store.setPrefs(JSONObject().put("adblockAllow", JSONArray(set.toList())))
                blocker.syncPrefs()
                t.web.reload()
            }
        }
        // Ausnahme für Cookie-Banner auf dieser Seite
        if (host != null && store.prefs().optBoolean("cookieReject", true)) {
            val ckAllowed = host in cookieAllowList()
            b.setNeutralButton(if (ckAllowed) "Cookie-Banner wieder ablehnen" else "Cookie-Banner hier zeigen") { _, _ ->
                val set = cookieAllowList().toMutableSet()
                if (ckAllowed) set.remove(host) else set.add(host)
                store.setPrefs(JSONObject().put("cookieAllow", JSONArray(set.toList())))
                t.web.reload()
            }
        }
        b.show()
    }

    private fun showMenu(anchor: View) {
        val t = active
        val m = PopupMenu(this, anchor)
        m.menu.add(0, 1, 0, "Neuer Tab")
        m.menu.add(0, 2, 1, "Neuer privater Tab")
        m.menu.add(0, 3, 2, "Lesezeichen")
        m.menu.add(0, 4, 3, "Verlauf")
        if (t != null && realUrl(t).isNotEmpty()) {
            m.menu.add(0, 9, 4, "Auf der Seite suchen")
            m.menu.add(0, 10, 5, "Seite übersetzen")
            m.menu.add(0, 5, 6, "Zur Startseite hinzufügen")
            m.menu.add(0, 6, 7, "Teilen …")
            if (!t.isPrivate) m.menu.add(0, 12, 7, "An Gerät senden …")
            m.menu.add(0, 7, 8, "Desktop-Version").apply { isCheckable = true; isChecked = t.desktop }
        }
        m.menu.add(0, 11, 9, "Eigene Skripte")
        m.menu.add(0, 8, 10, "Einstellungen und Synchronisation")
        m.setOnMenuItemClickListener { item ->
            when (item.itemId) {
                1 -> { newTab(NEWTAB); address.requestFocus() }
                2 -> newTab(NEWTAB, isPrivate = true)
                3 -> openManage("bookmarks")
                4 -> openManage("history")
                9 -> openFind()
                10 -> t?.let { translate(it) }
                11 -> openManage("scripts")
                5 -> t?.let {
                    val u = realUrl(it)
                    store.saveShortcut(null, it.title.take(40).ifBlank { hostOf(u) ?: u }, u)
                    toast("Zur Startseite hinzugefügt")
                }
                6 -> t?.let {
                    startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).setType("text/plain")
                        .putExtra(Intent.EXTRA_SUBJECT, it.title).putExtra(Intent.EXTRA_TEXT, realUrl(it)), "Teilen"))
                }
                7 -> t?.let { toggleDesktop(it) }
                12 -> t?.let { sendToDevice(it) }
                8 -> openManage("settings")
            }
            true
        }
        m.show()
    }

    /** Merkt sich die aktuelle Seite (für „Skript für diese Seite“) und öffnet die Verwaltung */
    private var lastHost: String? = null
    private fun openManage(section: String) {
        val t = active ?: return
        lastHost = hostOf(realUrl(t))
        t.web.loadUrl("$MANAGE#$section")
    }

    // ---------- Updates der Sakura-App
    private fun offerUpdate(r: UpdateCheck.Release) {
        AlertDialog.Builder(this)
            .setTitle("Sakura ${r.version} ist da")
            .setMessage("Die neue Version wird heruntergeladen. Tipp danach auf die Download-Benachrichtigung, um sie zu installieren – deine Tabs, Lesezeichen und Einstellungen bleiben erhalten.\n\nBeim ersten Mal fragt Android, ob Sakura Apps installieren darf.")
            .setPositiveButton("Herunterladen") { _, _ -> download(r.apkUrl, WebSettings.getDefaultUserAgent(this), "attachment; filename=\"Sakura-${r.version}.apk\"", "application/vnd.android.package-archive") }
            .setNegativeButton("Später", null)
            .setNeutralButton("Diese Version überspringen") { _, _ -> updates.skip(r.version) }
            .show()
    }

    private fun toggleDesktop(t: Tab) {
        t.desktop = !t.desktop
        val s = t.web.settings
        s.userAgentString = if (t.desktop)
            s.userAgentString.replace(Regex("\\(Linux; Android[^)]*\\)"), "(X11; Linux x86_64)").replace(" Mobile", "")
        else null
        if (!t.desktop) s.userAgentString = s.userAgentString.replace("; wv)", ")").replace(Regex("Version/\\d+\\.\\d+ "), "")
        s.loadWithOverviewMode = true
        t.web.reload()
    }

    // ================================================================ Tab-Gruppen
    /** Hält die Tabs einer Gruppe zusammen und entfernt leere Gruppen */
    private fun normalizeGroups() {
        val out = mutableListOf<Tab>()
        val seen = mutableSetOf<String>()
        for (t in tabs) {
            val g = t.group?.takeIf { groups.containsKey(it) }
            t.group = g
            if (g == null) { out.add(t); continue }
            if (!seen.add(g)) continue
            out.addAll(tabs.filter { it.group == g })
        }
        tabs.clear(); tabs.addAll(out)
        groups.keys.retainAll(seen)
    }

    private fun newGroup(t: Tab, name: String) {
        val used = groups.values.map { it.color }
        val color = groupColors.keys.firstOrNull { it !in used } ?: groupColors.keys.elementAt(groups.size % groupColors.size)
        val g = TabGroup("g" + (++groupCounter), name.trim().take(40), color)
        groups[g.id] = g
        t.group = g.id
        normalizeGroups()
    }

    private fun addToGroup(t: Tab, id: String) {
        tabs.remove(t)
        val last = tabs.indexOfLast { it.group == id }
        t.group = id
        tabs.add(if (last < 0) tabs.size else last + 1, t)
        normalizeGroups()
    }

    private fun removeFromGroup(t: Tab) {
        val id = t.group ?: return
        tabs.remove(t)
        val last = tabs.indexOfLast { it.group == id }
        t.group = null
        tabs.add(if (last < 0) tabs.size else last + 1, t)
        normalizeGroups()
    }

    private fun askText(title: String, initial: String, ok: (String) -> Unit) {
        val input = EditText(this).apply {
            setText(initial); setSelection(initial.length); setSingleLine()
            hint = "Name der Gruppe"
            setTextColor(getColor(R.color.washi)); setHintTextColor(getColor(R.color.usuzumi))
        }
        val box = FrameLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(input) }
        AlertDialog.Builder(this).setTitle(title).setView(box)
            .setNegativeButton("Abbrechen", null)
            .setPositiveButton("OK") { _, _ -> ok(input.text.toString()) }
            .show()
        input.requestFocus()
    }

    /** Langes Drücken auf einen Tab */
    private fun tabGroupMenu(t: Tab, refresh: () -> Unit) {
        val others = groups.values.filter { it.id != t.group && tabs.any { x -> x.group == it.id && x.isPrivate == t.isPrivate } }
        val labels = mutableListOf("Zu neuer Gruppe hinzufügen …")
        others.forEach { labels.add("Zu „" + it.name.ifEmpty { "Unbenannte Gruppe" } + "“ hinzufügen") }
        if (t.group != null) labels.add("Aus Gruppe entfernen")
        AlertDialog.Builder(this).setTitle(t.title.take(60))
            .setItems(labels.toTypedArray()) { _, i ->
                when {
                    i == 0 -> askText("Neue Gruppe", "") { name -> newGroup(t, name); saveTabs(); refresh() }
                    i <= others.size -> { addToGroup(t, others[i - 1].id); saveTabs(); refresh() }
                    else -> { removeFromGroup(t); saveTabs(); refresh() }
                }
            }.show()
    }

    /** Langes Drücken auf eine Gruppen-Überschrift */
    private fun groupMenu(g: TabGroup, refresh: () -> Unit, dismiss: () -> Unit) {
        AlertDialog.Builder(this).setTitle(g.name.ifEmpty { "Gruppe" })
            .setItems(arrayOf("Umbenennen …", "Farbe ändern …", "Neuer Tab in dieser Gruppe", "Gruppierung aufheben", "Gruppe schließen")) { _, i ->
                when (i) {
                    0 -> askText("Gruppe umbenennen", g.name) { g.name = it.trim().take(40); saveTabs(); refresh() }
                    1 -> {
                        val keys = groupColors.keys.toList()
                        AlertDialog.Builder(this).setTitle("Farbe")
                            .setSingleChoiceItems(keys.map { groupColors.getValue(it).first }.toTypedArray(), keys.indexOf(g.color)) { d, k ->
                                g.color = keys[k]; saveTabs(); refresh(); d.dismiss()
                            }.show()
                    }
                    2 -> {
                        val members = tabs.filter { it.group == g.id }
                        val last = members.lastOrNull()
                        val t = newTab(NEWTAB, isPrivate = last?.isPrivate == true, opener = last)
                        t.group = g.id; normalizeGroups(); saveTabs(); dismiss()
                    }
                    3 -> { tabs.filter { it.group == g.id }.forEach { it.group = null }; groups.remove(g.id); saveTabs(); refresh() }
                    4 -> {
                        tabs.filter { it.group == g.id }.toList().forEach { closeTab(it) }
                        saveTabs(); if (tabs.isEmpty()) dismiss() else refresh()
                    }
                }
            }.show()
    }

    /** Tab-Übersicht als dunkles Blatt von unten */
    private fun showTabs() {
        val dlg = Dialog(this)
        val wrap = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(getColor(R.color.kasumi))
            setPadding(dp(12), dp(16), dp(12), dp(12))
        }
        val head = TextView(this).apply {
            text = "Tabs"
            contentDescription = "Tabs. Lange auf einen Tab drücken, um ihn zu gruppieren"
            textSize = 22f
            typeface = Typeface.SERIF
            setTextColor(getColor(R.color.washi))
            setPadding(dp(8), 0, 0, dp(8))
        }
        wrap.addView(head)
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val scroll = ScrollView(this).apply { addView(list) }
        wrap.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f))

        lateinit var fill: () -> Unit
        fill = {
            list.removeAllViews()
            var prev: String? = null
            for (t in tabs) {
                val g = t.group?.let { groups[it] }
                if (g != null && prev != g.id) {
                    val color = groupColors[g.color]?.second ?: getColor(R.color.sakura)
                    val count = tabs.count { it.group == g.id }
                    val header = LinearLayout(this).apply {
                        orientation = LinearLayout.HORIZONTAL
                        gravity = Gravity.CENTER_VERTICAL
                        setPadding(dp(10), dp(12), dp(10), dp(6))
                        contentDescription = "Gruppe " + g.name + ", " + count + " Tabs, " + (if (g.collapsed) "eingeklappt" else "aufgeklappt")
                    }
                    header.addView(View(this).apply { setBackgroundColor(color) }, LinearLayout.LayoutParams(dp(12), dp(12)).apply { marginEnd = dp(10) })
                    header.addView(TextView(this).apply {
                        text = g.name.ifEmpty { "Unbenannte Gruppe" }
                        setTextColor(color); textSize = 15f; typeface = Typeface.SERIF
                    }, LinearLayout.LayoutParams(0, -2, 1f))
                    header.addView(TextView(this).apply {
                        text = (if (g.collapsed) "▸ " else "▾ ") + count
                        setTextColor(getColor(R.color.usuzumi)); textSize = 13f
                    })
                    header.setOnClickListener { g.collapsed = !g.collapsed; saveTabs(); fill() }
                    header.setOnLongClickListener { groupMenu(g, fill) { dlg.dismiss() }; true }
                    list.addView(header, LinearLayout.LayoutParams(-1, -2))
                }
                prev = g?.id
                if (g != null && g.collapsed) continue
                val groupColor = g?.let { groupColors[it.color]?.second }
                val row = LinearLayout(this).apply {
                    orientation = LinearLayout.HORIZONTAL
                    gravity = Gravity.CENTER_VERTICAL
                    setPadding(dp(10), dp(6), dp(4), dp(6))
                    if (t === active) setBackgroundColor(0x22F2B3C5)
                }
                val seal = TextView(this).apply {
                    val shownUrl = displayUrl(t.url)
                    text = if (shownUrl.isEmpty()) "桜" else (t.title.trim().firstOrNull()?.uppercase() ?: "?")
                    gravity = Gravity.CENTER
                    textSize = 14f
                    typeface = Typeface.SERIF
                    setTextColor(if (t.isPrivate) Color.WHITE else getColor(R.color.sakura))
                    setBackgroundColor(if (t.isPrivate) getColor(R.color.beni) else 0x29F2B3C5)
                }
                row.addView(seal, LinearLayout.LayoutParams(dp(30), dp(30)))
                val texts = LinearLayout(this).apply {
                    orientation = LinearLayout.VERTICAL
                    setPadding(dp(12), 0, dp(8), 0)
                }
                texts.addView(TextView(this).apply {
                    text = if (displayUrl(t.url).isEmpty()) "Neuer Tab" else t.title
                    setTextColor(getColor(R.color.washi)); textSize = 15f; maxLines = 1
                    ellipsize = android.text.TextUtils.TruncateAt.END
                })
                texts.addView(TextView(this).apply {
                    text = (if (t.isPrivate) "Privat – " else "") + (hostOf(displayUrl(t.url)) ?: "Startseite")
                    setTextColor(getColor(R.color.usuzumi)); textSize = 12.5f; maxLines = 1
                })
                row.addView(texts, LinearLayout.LayoutParams(0, -2, 1f))
                val close = ImageButton(this).apply {
                    setImageResource(R.drawable.ic_close)
                    setBackgroundResource(R.drawable.ripple)
                    contentDescription = "Tab schließen"
                    setOnClickListener { closeTab(t); if (tabs.isEmpty()) dlg.dismiss() else fill() }
                }
                row.addView(close, LinearLayout.LayoutParams(dp(44), dp(44)))
                row.setOnClickListener { activate(t); dlg.dismiss() }
                row.setOnLongClickListener { tabGroupMenu(t, fill); true }
                if (groupColor != null) {
                    val line = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                    line.addView(View(this).apply { setBackgroundColor(groupColor) }, LinearLayout.LayoutParams(dp(3), -1).apply { marginEnd = dp(4) })
                    line.addView(row, LinearLayout.LayoutParams(0, -2, 1f))
                    list.addView(line, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(2) })
                } else list.addView(row, LinearLayout.LayoutParams(-1, -2).apply { bottomMargin = dp(2) })
            }
        }
        fill()

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(10), 0, 0) }
        fun button(label: String, primary: Boolean, onClick: () -> Unit) = Button(this).apply {
            text = label
            isAllCaps = false
            setTextColor(if (primary) getColor(R.color.fukai) else getColor(R.color.washi))
            setBackgroundColor(if (primary) getColor(R.color.sakura) else 0x22EEE7E2)
            setOnClickListener { onClick(); dlg.dismiss() }
        }
        buttons.addView(button("Privater Tab", false) { newTab(NEWTAB, isPrivate = true) }, LinearLayout.LayoutParams(0, dp(46), 1f).apply { marginEnd = dp(8) })
        buttons.addView(button("Neuer Tab", true) { newTab(NEWTAB) }, LinearLayout.LayoutParams(0, dp(46), 1f))
        wrap.addView(buttons)

        dlg.setContentView(wrap)
        dlg.window?.apply {
            setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            setLayout(ViewGroup.LayoutParams.MATCH_PARENT, (resources.displayMetrics.heightPixels * 0.7).toInt())
            setGravity(Gravity.BOTTOM)
        }
        dlg.show()
    }
}
