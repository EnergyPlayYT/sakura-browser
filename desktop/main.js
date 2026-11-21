// Sakura – Hauptprozess
const {
  app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, session, protocol, Menu, clipboard, net,
  dialog, webContents, shell, nativeTheme, screen, webFrameMain, globalShortcut, Notification, safeStorage, nativeImage
} = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const Store = require('./lib/store');
const AdBlocker = require('./lib/adblock');
const Sync = require('./lib/sync');
const M = require('./lib/model');
const { Extensions } = require('./lib/extensions');
const { Downloads } = require('./lib/downloads');
const Updater = require('./lib/updater');
const { Favicons } = require('./lib/favicons');
const Importer = require('./lib/importer');
const CookieImport = require('./lib/cookie-import');
const Themes = require('./pages/themes');
const SB = require('./lib/sponsorblock');
const { pickTabsToSleep } = require('./lib/sleeper');
const Gaming = require('./lib/gaming');
const Popups = require('./lib/popups');
const Passwords = require('./lib/passwords');
const { Watcher } = require('./lib/watch');
const { Emotes } = require('./lib/emotes');
const { Steam } = require('./lib/steam');
let autoUpdater = null;
try { ({ autoUpdater } = require('electron-updater')); } catch { /* beim Entwickeln ohne npm install */ }

app.setName('Sakura');
protocol.registerSchemesAsPrivileged([
  { scheme: 'sakura', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

const NEWTAB = 'sakura://newtab/';
const TABBAR_H = 40;
const TOOLBAR_H = 46;
const FINDBAR_H = 44;
const BOOKMARKBAR_H = 32;
const barVisible = () => store.prefs().bookmarksBar !== false;
const ICON = path.join(__dirname, 'assets', 'icon.png');
const BG = { normal: '#1C1A33', private: '#141022' };
const WEBSTORE = 'https://chromewebstore.google.com/category/extensions?hl=de';
const GROUP_COLORS = ['sakura', 'sora', 'matcha', 'yamabuki', 'fuji', 'momiji', 'sumi'];
let groupCounter = 0;
const PANEL_URLS = /^(?:chrome|sakura|about):\/?\/?(extensions|downloads|history|bookmarks|settings|scripts)\b/i;

// Die Daten werden schon vor dem Start gelesen, weil „Webseiten immer dunkel“ ein Startschalter ist
const store = new Store(app.getPath('userData'));
const startTheme = store.prefs().siteTheme;
// Medientasten (Play/Pause, Weiter, Zurück) steuern das gerade spielende Video – auch über die Windows-Medienanzeige
// Weiches Scrollen auf Webseiten (Einstellung „Animationen“, wirkt nach einem Neustart)
if (store.prefs().animations !== false) app.commandLine.appendSwitch('enable-smooth-scrolling');
app.commandLine.appendSwitch('enable-features', ['HardwareMediaKeyHandling', ...(startTheme === 'force' ? ['WebContentsForceDark'] : [])].join(','));

let blocker, sync, extensions, downloads, updater, favicons, gameWatch, vault, watcher;
const windows = new Set();
let tabCounter = 0;
let privateCounter = 0;
let quitting = false;
const preparedSessions = new WeakSet();
const closedTabs = [];
let importProfiles = []; // zuletzt gefundene Browserprofile (für den Import)

// Google & Co. blockieren Electron-Kennungen beim Anmelden → wie normales Chrome auftreten
app.userAgentFallback = app.userAgentFallback
  .split(' ')
  .filter(t => !/^(Electron|Sakura|sakura-browser)\//i.test(t))
  .join(' ');

/** Aktuelles Design (Farben) aus den Einstellungen */
function theme() { return Themes.resolve(store.prefs()); }

function applySiteTheme() {
  nativeTheme.themeSource = store.prefs().siteTheme === 'system' ? 'system' : 'dark';
}

const BG_FILE = /^[\w .()-]+\.(jpe?g|png|webp)$/i;
/** Mitgelieferte Hintergrundbilder (Ordner backgrounds/) */
function builtinBackgrounds() {
  try { return fs.readdirSync(path.join(__dirname, 'backgrounds')).filter(f => BG_FILE.test(f)).sort((a, b) => a.localeCompare(b, 'de', { numeric: true })); }
  catch { return []; }
}

// ---------------------------------------------------------------- Sitzungen
function prepareSession(ses, isPrivate) {
  if (preparedSessions.has(ses)) return;
  preparedSessions.add(ses);
  ses.protocol.handle('sakura', req => {
    const u = new URL(req.url);
    if (u.hostname === 'favicon') return favicons.respond(u.searchParams.get('u') || '');
    if (u.pathname === '/themes.js' || (u.hostname === 'settings' && u.pathname === '/settings.js')) {
      return net.fetch(pathToFileURL(path.join(__dirname, 'pages', u.pathname.slice(1))).toString());
    }
    // Mitgelieferte Hintergrundbilder: sakura://newtab/backgrounds/<datei>
    const bg = /^\/backgrounds\/([^/]+)$/.exec(u.pathname);
    if (bg) {
      const name = decodeURIComponent(bg[1]);
      if (!BG_FILE.test(name)) return new Response('Nicht gefunden', { status: 404 });
      return net.fetch(pathToFileURL(path.join(__dirname, 'backgrounds', name)).toString());
    }
    const name = { newtab: 'newtab.html', error: 'error.html', settings: 'settings.html', multistream: 'multistream.html', readlist: 'readlist.html' }[u.hostname];
    const file = name ? path.join(__dirname, 'pages', name) : path.join(__dirname, 'pages', u.hostname, u.pathname);
    if (!file.startsWith(path.join(__dirname, 'pages'))) return new Response('Nicht gefunden', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  blocker.attach(ses, id => {
    const wc = webContents.fromId(id);
    return wc && !wc.isDestroyed() ? wc.getURL() : '';
  });
  downloads.attach(ses, isPrivate);

  // Berechtigungen: Unbedenkliches erlauben, Kamera/Mikrofon/Standort/Benachrichtigungen nachfragen
  const decisions = new Map();
  const SAFE = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'window-management']);
  const LABEL = {
    media: 'Kamera oder Mikrofon verwenden', geolocation: 'deinen Standort sehen',
    notifications: 'Benachrichtigungen anzeigen', 'clipboard-read': 'die Zwischenablage lesen',
    midi: 'MIDI-Geräte verwenden', midiSysex: 'MIDI-Geräte verwenden'
  };
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    if (SAFE.has(permission)) return cb(true);
    let origin = '';
    try { origin = new URL(details.requestingUrl || wc.getURL()).host; } catch {}
    // Erweiterungen bekommen, was sie im Manifest angemeldet haben
    if (String(details.requestingUrl || '').startsWith('chrome-extension://')) return cb(true);
    if (!LABEL[permission]) return cb(false);
    const key = origin + '|' + permission;
    if (decisions.has(key)) return cb(decisions.get(key));
    const w = [...windows].find(x => x.tabs.some(t => t.view.webContents === wc));
    dialog.showMessageBox(w ? w.win : undefined, {
      type: 'question', buttons: ['Erlauben', 'Blockieren'], defaultId: 1, cancelId: 1,
      title: 'Berechtigung', message: `${origin} möchte ${LABEL[permission]}.`,
      checkboxLabel: 'Für diese Sitzung merken', checkboxChecked: true
    }).then(r => {
      const ok = r.response === 0;
      if (r.checkboxChecked) decisions.set(key, ok);
      cb(ok);
    }).catch(() => cb(false));
  });
}

// ---------------------------------------------------------------- Konto-Tabs
// Bis zu 5 getrennte Konten gleichzeitig: jeder Konto-Tab hat eine eigene, dauerhafte Sitzung.
const CONTAINERS = 5;
const CONTAINER_COLORS = ['sakura', 'sora', 'matcha', 'yamabuki', 'fuji'];
function containerSession(n) {
  const ses = session.fromPartition('persist:sakura-konto-' + n);
  prepareSession(ses, false);
  return ses;
}
function containerName(n) {
  const names = store.prefs().containerNames || [];
  return String(names[n - 1] || '').trim().slice(0, 30) || 'Konto ' + n;
}

// ---------------------------------------------------------------- Fenster
class SakuraWindow {
  constructor({ isPrivate = false, url, restore, adopt, bounds, ses } = {}) {
    this.isPrivate = isPrivate;
    // Ein herausgezogener privater Tab nimmt seine private Sitzung mit
    this.ses = ses || (isPrivate ? session.fromPartition('sakura-private-' + (++privateCounter)) : session.defaultSession);
    prepareSession(this.ses, isPrivate);
    this.tabs = [];
    this.activeId = null;
    this.overlay = false;
    this.findOpen = false;
    this.htmlFullscreen = false;
    this.popup = null;
    this.groups = new Map(); // id → { id, name, color, collapsed }

    this.win = new BaseWindow({
      width: 1300, height: 840, minWidth: 560, minHeight: 400, show: false, icon: ICON, ...(bounds || {}),
      title: isPrivate ? 'Sakura – Privat' : 'Sakura',
      backgroundColor: this.bgColor(),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: this.bgColor(), symbolColor: this.isPrivate ? '#EEE7E2' : theme().colors.washi, height: TABBAR_H }
    });

    this.ui = new WebContentsView({
      webPreferences: { preload: path.join(__dirname, 'preload-ui.js'), contextIsolation: true, sandbox: true }
    });
    this.ui.setBackgroundColor('#00000000');
    this.win.contentView.addChildView(this.ui);
    this.ui.webContents.loadFile(path.join(__dirname, 'ui', 'index.html'), { query: { private: isPrivate ? '1' : '0' } });
    this.ui.webContents.once('did-finish-load', () => { this.win.show(); this.sendState(); });
    attachShortcuts(this.ui.webContents, this);

    this.win.on('resize', () => this.layout());
    this.win.on('enter-full-screen', () => this.layout());
    this.win.on('leave-full-screen', () => { this.htmlFullscreen = false; this.layout(); });
    this.win.on('closed', () => {
      this.closePopup();
      if (floating && floating.tab.w === this) dropFloat();
      for (const t of this.tabs) if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
      if (!this.ui.webContents.isDestroyed()) this.ui.webContents.close();
      windows.delete(this);
      // Private Daten erst löschen, wenn kein anderes Fenster dieselbe private Sitzung nutzt
      if (this.isPrivate && ![...windows].some(x => x.ses === this.ses)) this.ses.clearStorageData().catch(() => {});
      else if (!quitting && windows.size) saveSession();
    });

    windows.add(this);
    if (restore && restore.tabs && restore.tabs.length) {
      const act = Math.min(restore.active || 0, restore.tabs.length - 1);
      for (const g of restore.groups || []) {
        const id = 'g' + (++groupCounter);
        this.groups.set(id, { id, name: g.name || '', color: GROUP_COLORS.includes(g.color) ? g.color : 'sakura', collapsed: !!g.collapsed, old: g.id });
      }
      const gid = old => { for (const g of this.groups.values()) if (g.old === old) return g.id; return null; };
      this.restoring = true;
      restore.tabs.forEach((t, i) => this.newTab(t.url, { background: true, lazy: i !== act, title: t.title, pinned: t.pinned, group: t.group ? gid(t.group) : null, container: t.container }));
      for (const g of this.groups.values()) delete g.old;
      this.restoring = false;
      this.normalize();
      this.activate(this.tabs[act].id);
    } else if (adopt) this.adoptTab(adopt);
    else this.newTab(url || NEWTAB);
    this.layout();
  }

  // ---------- Tabs zwischen Fenstern verschieben
  /** Nimmt einen Tab aus einem anderen Fenster auf – die Seite lädt dabei nicht neu */
  adoptTab(tab, index) {
    tab.w = this;
    tab.group = null;
    tab.pinned = false;
    const i = typeof index === 'number' ? Math.max(this.pinnedCount, Math.min(index, this.tabs.length)) : this.tabs.length;
    this.tabs.splice(i, 0, tab);
    this.win.contentView.addChildView(tab.view, 0);
    this.normalize();
    this.activate(tab.id);
    this.win.focus();
  }

  /** Löst einen Tab aus diesem Fenster, ohne seine Seite zu schließen */
  releaseTab(id) {
    const i = this.tabs.findIndex(t => t.id === id);
    if (i < 0) return null;
    const [t] = this.tabs.splice(i, 1);
    this.win.contentView.removeChildView(t.view);
    if (!this.tabs.length) { setImmediate(() => { if (!this.win.isDestroyed()) this.win.close(); }); return t; }
    this.normalize();
    if (this.activeId === id) this.activate(this.tabs[Math.min(i, this.tabs.length - 1)].id);
    else this.sendState();
    return t;
  }

  /** Tab wurde losgelassen: bei point (Bildschirmkoordinaten) prüfen, wohin er gehört */
  dropTab(id, point) {
    const t = this.tabs.find(x => x.id === id);
    if (!t || t.floating) return 'none';
    const inStrip = (w, p) => {
      const b = w.win.getContentBounds();
      return p.x >= b.x && p.x <= b.x + b.width && p.y >= b.y - 8 && p.y <= b.y + TABBAR_H + 16;
    };
    // Über der eigenen Tableiste losgelassen → normales Sortieren, nichts weiter
    if (inStrip(this, point)) return 'none';
    // Über der Tableiste eines anderen Fensters → dorthin verschieben
    const target = [...windows].find(w => w !== this && !w.win.isDestroyed() && !w.win.isMinimized() &&
      w.isPrivate === this.isPrivate && w.ses === this.ses && inStrip(w, point));
    if (target) {
      const b = target.win.getContentBounds();
      const per = Math.max(60, Math.min(220, (b.width - 230) / Math.max(1, target.tabs.length)));
      const index = Math.round((point.x - b.x - 40) / per);
      const moved = this.releaseTab(id);
      if (moved) target.adoptTab(moved, index);
      return 'merged';
    }
    // Einziger Tab → einfach das Fenster dorthin schieben
    if (this.tabs.length === 1) {
      const wb = this.win.getBounds();
      this.win.setBounds({ x: point.x - 120, y: point.y - 16, width: wb.width, height: wb.height });
      return 'moved';
    }
    // Sonst: neues Fenster an der Mausposition
    const wb = this.win.getBounds();
    const area = screen.getDisplayNearestPoint(point).workArea;
    const width = Math.min(wb.width, area.width), height = Math.min(wb.height, area.height);
    const x = Math.max(area.x, Math.min(point.x - 120, area.x + area.width - width));
    const y = Math.max(area.y, Math.min(point.y - 16, area.y + area.height - height));
    if (this.win.isMaximized()) this.win.unmaximize();
    const moved = this.releaseTab(id);
    if (moved) new SakuraWindow({ isPrivate: this.isPrivate, ses: this.ses, adopt: moved, bounds: { x, y, width, height } });
    return 'detached';
  }

  /** Grundfarbe des Fensters: privat immer dunkel, sonst aus dem Design */
  bgColor() { return this.isPrivate ? BG.private : theme().colors.yoru; }

  /** Design geändert → Titelleiste und Hintergrund anpassen */
  applyTheme() {
    if (this.win.isDestroyed() || this.isPrivate) return;
    try {
      this.win.setBackgroundColor(this.bgColor());
      if (this.win.setTitleBarOverlay) this.win.setTitleBarOverlay({ color: this.bgColor(), symbolColor: theme().colors.washi, height: TABBAR_H });
    } catch { /* nicht jedes System kennt das Overlay */ }
    for (const t of this.tabs) {
      const u = t.pending || t.url;
      if (String(u).startsWith('sakura:')) {
        t.view.setBackgroundColor(this.bgColor());
        if (!t.pending && !t.view.webContents.isDestroyed()) t.view.webContents.send('sakura-theme');
      }
    }
  }

  /** Tab schlafen legen: Seite entladen (spart RAM und CPU), beim Anklicken lädt sie neu */
  sleepTab(id) {
    const t = this.tabs.find(x => x.id === id);
    if (!t || t.id === this.activeId || t.pending) return false;
    const url = t.url;
    if (!/^https?:/i.test(url)) return false;
    t.pending = url; t.sleeping = true; t.audible = false; t.loading = false;
    t.view.webContents.loadURL('about:blank').catch(() => {});
    this.sendState();
    return true;
  }

  get active() { return this.tabs.find(t => t.id === this.activeId); }
  get pinnedCount() { return this.tabs.filter(t => t.pinned).length; }
  topHeight() {
    if (this.htmlFullscreen) return 0;
    return TABBAR_H + TOOLBAR_H + (barVisible() ? BOOKMARKBAR_H : 0) + (this.findOpen ? FINDBAR_H : 0);
  }

  layout() {
    if (this.win.isDestroyed()) return;
    const { width: w, height: h } = this.win.getContentBounds();
    const top = this.topHeight();
    this.ui.setVisible(!this.htmlFullscreen);
    this.ui.setBounds({ x: 0, y: 0, width: w, height: this.overlay ? h : top });
    for (const t of this.tabs) {
      if (t.floating) continue; // steckt gerade im schwebenden Fenster
      const on = t.id === this.activeId;
      t.view.setVisible(on);
      if (on) t.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
    }
  }

  newTab(url, { background = false, index, lazy = false, title, pinned = false, group = null, container = null } = {}) {
    const id = ++tabCounter;
    // Konto-Tab: eigene, dauerhafte Sitzung (eigene Cookies und Anmeldungen) – nicht in privaten Fenstern
    const box = !this.isPrivate && Number.isInteger(container) && container >= 1 && container <= CONTAINERS ? container : null;
    const tabSes = box ? containerSession(box) : this.ses;
    const view = new WebContentsView({
      webPreferences: {
        session: tabSes, preload: path.join(__dirname, 'preload-page.js'),
        contextIsolation: true, sandbox: true, spellcheck: true
      }
    });
    // Eigene Sakura-Seiten dunkel, alle anderen Webseiten mit dem üblichen weißen Grund –
    // viele Seiten (z. B. Googles Cookie-Hinweis) setzen keinen eigenen Hintergrund.
    const isPriv = this.isPrivate; // privat bleibt privat, auch in einem anderen Fenster
    const setBg = u => view.setBackgroundColor(String(u || '').startsWith('sakura:') ? (isPriv ? BG.private : theme().colors.yoru) : '#FFFFFF');
    setBg(url || NEWTAB);
    const tab = {
      container: box,
      id, view, title: title || 'Neuer Tab', url: url || NEWTAB, favicon: null,
      loading: false, audible: false, muted: false, pinned: !!pinned, pending: lazy ? (url || NEWTAB) : null,
      group: !pinned && group && this.groups.has(group) ? group : null,
      lastActive: Date.now(),
      w: this // Fenster, in dem der Tab gerade steckt (ändert sich beim Herausziehen)
    };
    let i = typeof index === 'number' ? index : this.tabs.length;
    i = tab.pinned ? Math.min(i, this.pinnedCount) : Math.max(i, this.pinnedCount);
    this.tabs.splice(i, 0, tab);
    this.win.contentView.addChildView(view, 0); // unter der Oberfläche
    const wc = view.webContents;

    // Klicks und Tastendrücke merken – der Popup-Blocker erlaubt neue Fenster nur kurz danach
    const INPUT = new Set(['mouseDown', 'keyDown', 'rawKeyDown', 'touchStart', 'gestureTap']);
    wc.on('input-event', (e, ie) => { if (INPUT.has(ie.type)) tab.lastInput = Date.now(); });
    wc.setWindowOpenHandler(({ url: u, disposition, features }) => {
      const verdict = popupVerdict(tab, u, features);
      if (!verdict.allow) {
        tab.popups = [...(tab.popups || []), { url: u, reason: verdict.reason }].slice(-20);
        tab.w.sendState();
        return { action: 'deny' };
      }
      const at = tab.w.tabs.indexOf(tab) + 1;
      tab.w.newTab(u, { background: disposition === 'background-tab', index: at, group: tab.group, container: tab.container });
      return { action: 'deny' };
    });
    const upd = () => tab.w.sendState();
    wc.on('page-title-updated', (e, t) => {
      if (tab.sleeping) return; // schlafender Tab zeigt leere Seite – Titel behalten
      tab.title = t;
      if (!tab.w.isPrivate) store.updateTitle(wc.getURL(), t);
      upd();
    });
    wc.on('page-favicon-updated', (e, icons) => {
      if (tab.sleeping) return;
      tab.favicon = icons[0] || null;
      if (!tab.w.isPrivate && tab.favicon) favicons.remember(wc.getURL(), tab.favicon);
      upd();
    });
    const wcId = wc.id;
    wc.once('destroyed', () => blocker.forget(wcId));
    wc.on('did-start-loading', () => { tab.loading = true; upd(); });
    wc.on('did-stop-loading', () => { tab.loading = false; upd(); checkReadable(tab); });
    wc.on('did-start-navigation', (d) => {
      if (d.isMainFrame && !d.isSameDocument) { blocker.reset(wc.id); setBg(d.url); tab.popups = []; }
    });
    wc.on('did-navigate', (e, u) => {
      if (tab.sleeping) return;
      tab.url = u; tab.favicon = null; tab.reader = false; tab.readable = false;
      if (!tab.w.isPrivate && !u.startsWith('sakura:')) store.visit(u, wc.getTitle());
      upd();
      const note = !tab.w.isPrivate && noteFor(u);
      if (note && tab.id === tab.w.activeId) tab.w.ui.webContents.send('toast', 'Deine Notiz: ' + (note.text.length > 90 ? note.text.slice(0, 90) + ' …' : note.text));
    });
    wc.on('did-navigate-in-page', (e, u, isMain) => {
      if (!isMain) return;
      tab.url = u;
      if (!tab.w.isPrivate) store.visit(u, wc.getTitle());
      upd();
    });
    wc.on('dom-ready', () => { tab.hadMedia = false; tab.media = null; runCookieReject(wc); runYouTube(wc); runTwitch(wc); runSteam(wc); runVideoHelper(wc); applySiteMedia(tab); runUserScripts(wc); });
    // Zustimmungs-Banner und Video-Player stecken oft in eingebetteten Rahmen
    wc.on('did-frame-finish-load', (e, isMain, pid, rid) => { if (!isMain) { runCookieReject(wc, pid, rid); runVideoHelper(wc, pid, rid); } });
    wc.on('did-fail-load', (e, code, desc, failedUrl, isMain) => {
      if (!isMain || code === -3 || failedUrl.startsWith('sakura:')) return; // -3 = abgebrochen
      wc.loadURL('sakura://error/?u=' + encodeURIComponent(failedUrl) + '&d=' + encodeURIComponent(desc) + '&c=' + code);
    });
    wc.on('audio-state-changed', e => { tab.audible = !!e.audible; upd(); });
    wc.on('media-started-playing', () => { tab.audible = true; tab.hadMedia = true; upd(); });
    wc.on('media-paused', () => { tab.audible = false; upd(); });
    wc.on('found-in-page', (e, r) => tab.w.ui.webContents.send('find-result', { active: r.activeMatchOrdinal, total: r.matches }));
    wc.on('context-menu', (e, p) => tab.w.pageMenu(tab, p));
    wc.on('enter-html-full-screen', () => { tab.w.htmlFullscreen = true; tab.w.win.setFullScreen(true); tab.w.layout(); });
    wc.on('leave-html-full-screen', () => { tab.w.htmlFullscreen = false; tab.w.win.setFullScreen(false); tab.w.layout(); });
    attachShortcuts(wc, () => tab.w);

    if (!lazy) wc.loadURL(url || NEWTAB).catch(() => {});
    this.normalize();
    if (!background) this.activate(id); else this.sendState();
    return tab;
  }

  activate(id) {
    const t = this.tabs.find(x => x.id === id);
    if (!t) return;
    if (t.floating) { unfloat(); return; } // Klick auf den Tab holt das Video zurück
    const prev = this.active;
    if (prev) prev.lastActive = Date.now(); // zuletzt benutzt = als er verlassen wurde
    t.lastActive = Date.now();
    this.activeId = id;
    if (t.group && this.groups.get(t.group) && this.groups.get(t.group).collapsed) this.groups.get(t.group).collapsed = false;
    if (t.pending) { const u = t.pending; t.pending = null; t.sleeping = false; t.view.webContents.loadURL(u).catch(() => {}); }
    this.layout();
    if (!t.url.startsWith('sakura://newtab')) t.view.webContents.focus();
    this.sendState();
    if (this.findOpen) this.closeFind();
  }

  closeTab(id) {
    const i = this.tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    if (this.tabs[i].floating) dropFloat();
    const [t] = this.tabs.splice(i, 1);
    if (!this.isPrivate && !t.url.startsWith('sakura:')) { closedTabs.push({ url: t.pending || t.url, title: t.title }); if (closedTabs.length > 50) closedTabs.shift(); }
    this.win.contentView.removeChildView(t.view);
    t.view.webContents.close();
    if (!this.tabs.length) { this.win.close(); return; }
    this.normalize();
    if (this.activeId === id) {
      const visible = this.tabs.filter(x => !x.group || !this.groups.get(x.group).collapsed);
      const next = this.tabs[Math.min(i, this.tabs.length - 1)];
      this.activate((visible.includes(next) ? next : visible[0] || next).id);
    } else this.sendState();
  }

  // ---------- Tab-Gruppen
  /** Hält Gruppen zusammenhängend, angeheftete Tabs vorne und entfernt leere Gruppen */
  normalize() {
    if (this.restoring) return;
    const pinned = this.tabs.filter(t => t.pinned);
    for (const t of pinned) t.group = null;
    const rest = this.tabs.filter(t => !t.pinned);
    const out = [], seen = new Set();
    for (const t of rest) {
      if (t.group && !this.groups.has(t.group)) t.group = null;
      if (!t.group) { out.push(t); continue; }
      if (seen.has(t.group)) continue;
      seen.add(t.group);
      out.push(...rest.filter(x => x.group === t.group));
    }
    this.tabs = [...pinned, ...out];
    for (const id of [...this.groups.keys()]) if (!seen.has(id)) this.groups.delete(id);
  }

  newGroup(tabId) {
    const t = this.tabs.find(x => x.id === tabId);
    if (!t) return null;
    const id = 'g' + (++groupCounter);
    const used = [...this.groups.values()].map(g => g.color);
    const color = GROUP_COLORS.find(c => !used.includes(c)) || GROUP_COLORS[this.groups.size % GROUP_COLORS.length];
    this.groups.set(id, { id, name: '', color, collapsed: false });
    t.pinned = false;
    this.addToGroup(tabId, id);
    this.ui.webContents.send('edit-group', id);
    return id;
  }

  addToGroup(tabId, groupId) {
    const t = this.tabs.find(x => x.id === tabId);
    if (!t || !this.groups.has(groupId)) return;
    t.pinned = false;
    t.group = groupId;
    // ans Ende der Gruppe verschieben (eine neue Gruppe bleibt, wo der Tab war)
    const from = this.tabs.indexOf(t);
    this.tabs.splice(from, 1);
    let last = -1;
    this.tabs.forEach((x, i) => { if (x.group === groupId) last = i; });
    this.tabs.splice(last < 0 ? from : last + 1, 0, t);
    this.normalize();
    this.sendState();
  }

  removeFromGroup(tabId) {
    const t = this.tabs.find(x => x.id === tabId);
    if (!t || !t.group) return;
    const g = t.group;
    // hinter die Gruppe setzen
    this.tabs.splice(this.tabs.indexOf(t), 1);
    let last = -1;
    this.tabs.forEach((x, i) => { if (x.group === g) last = i; });
    t.group = null;
    this.tabs.splice(last < 0 ? this.tabs.length : last + 1, 0, t);
    this.normalize();
    this.sendState();
  }

  updateGroup(id, patch) {
    const g = this.groups.get(id);
    if (!g) return;
    if (typeof patch.name === 'string') g.name = patch.name.slice(0, 40);
    if (GROUP_COLORS.includes(patch.color)) g.color = patch.color;
    this.sendState();
  }

  toggleGroup(id) {
    const g = this.groups.get(id);
    if (!g) return;
    if (!g.collapsed) {
      const a = this.active;
      if (a && a.group === id) {
        const members = this.tabs.filter(t => t.group === id);
        const lastIdx = this.tabs.indexOf(members[members.length - 1]);
        const outside = this.tabs.slice(lastIdx + 1).find(t => !t.group || !this.groups.get(t.group).collapsed) ||
          [...this.tabs.slice(0, this.tabs.indexOf(members[0]))].reverse().find(t => !t.group || !this.groups.get(t.group).collapsed);
        g.collapsed = true;
        if (outside) this.activate(outside.id);
        else { this.newTab(NEWTAB); }
        return;
      }
    }
    g.collapsed = !g.collapsed;
    this.sendState();
  }

  ungroup(id) {
    for (const t of this.tabs) if (t.group === id) t.group = null;
    this.groups.delete(id);
    this.sendState();
  }

  closeGroup(id) {
    const members = this.tabs.filter(t => t.group === id);
    if (members.length === this.tabs.length) this.newTab(NEWTAB, { background: true });
    for (const t of members) this.closeTab(t.id);
  }

  moveTab(id, toIndex) {
    const i = this.tabs.findIndex(t => t.id === id);
    if (i < 0) return;
    const [t] = this.tabs.splice(i, 1);
    const pc = this.pinnedCount;
    const to = t.pinned ? Math.max(0, Math.min(toIndex, pc)) : Math.max(pc, Math.min(toIndex, this.tabs.length));
    this.tabs.splice(to, 0, t);
    if (!t.pinned) {
      // Zwischen zwei Tabs derselben Gruppe abgelegt → gehört jetzt dazu; aus der eigenen Gruppe herausgezogen → keine Gruppe mehr
      const left = this.tabs[to - 1], right = this.tabs[to + 1];
      if (left && right && left.group && left.group === right.group) t.group = left.group;
      else if (t.group && !(left && left.group === t.group) && !(right && right.group === t.group)) t.group = null;
    }
    this.normalize();
    this.sendState();
  }

  togglePin(id) {
    const t = this.tabs.find(x => x.id === id);
    if (!t) return;
    const pcBefore = this.pinnedCount;
    t.pinned = !t.pinned;
    if (t.pinned) t.group = null;
    this.moveTab(id, t.pinned ? pcBefore : pcBefore - 1);
  }

  toggleMute(id) {
    const t = this.tabs.find(x => x.id === id);
    if (!t) return;
    t.muted = !t.view.webContents.isAudioMuted();
    t.view.webContents.setAudioMuted(t.muted);
    this.sendState();
  }

  cycle(dir) {
    const i = this.tabs.findIndex(t => t.id === this.activeId);
    const n = this.tabs.length;
    this.activate(this.tabs[(i + dir + n) % n].id);
  }

  navigate(input) {
    const raw = String(input || '').trim();
    const panel = PANEL_URLS.exec(raw);
    if (panel) { this.ui.webContents.send('open-panel', panel[1].toLowerCase()); return; }
    const url = M.toUrl(raw, store.prefs().searchEngine);
    const t = this.active;
    if (url && t) { t.view.webContents.loadURL(url).catch(() => {}); t.view.webContents.focus(); }
  }

  openFind() { this.findOpen = true; this.layout(); this.ui.webContents.send('find-open'); this.ui.webContents.focus(); }
  closeFind() {
    this.findOpen = false;
    const t = this.active;
    if (t) t.view.webContents.stopFindInPage('clearSelection');
    this.layout();
    this.ui.webContents.send('find-close');
  }

  zoom(step) {
    const wc = this.active && this.active.view.webContents;
    if (!wc) return;
    wc.setZoomLevel(step === 0 ? 0 : Math.max(-5, Math.min(5, wc.getZoomLevel() + step)));
    this.sendState();
  }

  displayUrl(u) {
    if (!u || u.startsWith('sakura://newtab')) return '';
    if (u.startsWith('sakura://error')) { try { return new URL(u).searchParams.get('u') || ''; } catch { return ''; } }
    return u;
  }

  state() {
    const a = this.active;
    const wc = a && a.view.webContents;
    const realUrl = a ? this.displayUrl(a.pending || a.url) : '';
    let host = '';
    try { host = new URL(realUrl).hostname.replace(/^www\./, ''); } catch {}
    return {
      private: this.isPrivate,
      theme: this.isPrivate ? null : { vars: theme().vars, dark: theme().dark },
      activeId: this.activeId,
      groups: [...this.groups.values()].map(g => ({ ...g, count: this.tabs.filter(t => t.group === g.id).length })),
      tabs: this.tabs.map(t => ({
        id: t.id, title: t.title || this.displayUrl(t.url) || 'Neuer Tab', favicon: t.favicon,
        loading: t.loading, audible: t.audible, muted: t.muted, pinned: t.pinned, group: t.group,
        newtab: (t.pending || t.url).startsWith('sakura://newtab'),
        floating: !!t.floating,
        container: t.container ? { n: t.container, name: containerName(t.container), color: CONTAINER_COLORS[t.container - 1] } : null,
        sleeping: !!t.pending && t.id !== this.activeId
      })),
      url: realUrl,
      secure: realUrl.startsWith('https://'),
      canBack: !!(wc && wc.navigationHistory.canGoBack()),
      canForward: !!(wc && wc.navigationHistory.canGoForward()),
      loading: !!(a && a.loading),
      bookmarked: !!(realUrl && store.findBookmark(realUrl)),
      blocked: wc ? blocker.count(wc.id) : 0,
      host,
      adblock: store.prefs().adblock,
      allowed: !!(host && (store.prefs().adblockAllow || []).includes(host)),
      cookieReject: store.prefs().cookieReject !== false,
      popups: a && a.popups ? a.popups.length : 0,
      popupBlock: store.prefs().popupBlock !== false,
      popupAllowed: !!(host && (store.prefs().popupAllow || []).includes(host)),
      cookieAllowed: !!(host && (store.prefs().cookieAllow || []).includes(host)),
      zoom: wc ? Math.round(Math.pow(1.2, wc.getZoomLevel()) * 100) : 100,
      extActions: this.isPrivate ? [] : extensions.actions(),
      downloads: downloads.summary(),
      gaming: gameWatch && gameWatch.game ? gameWatch.game : null,
      animations: store.prefs().animations !== false,
      readable: !!(a && (a.readable || a.reader)), reader: !!(a && a.reader),
      note: !this.isPrivate && !!noteFor(realUrl), canNote: !this.isPrivate && !!noteKey(realUrl),
      streamer: streamerActive() ? { app: streamerApp, manual: (store.prefs().streamerMode || 'auto') === 'on' } : null,
      media: !!(a && (a.hadMedia || a.audible)),
      sleep: sleepTimer ? { mode: sleepTimer.mode, until: sleepTimer.until || null, minutes: sleepTimer.minutes || null } : null,
      update: updater ? { state: updater.state.state, version: updater.state.version, percent: updater.state.percent } : null,
      scripts: realUrl ? M.scriptsFor(store.data.scripts, realUrl).length : 0,
      bar: barVisible() ? barItems() : null
    };
  }

  sendState() {
    clearTimeout(this._st);
    this._st = setTimeout(() => {
      if (this.win.isDestroyed() || this.ui.webContents.isDestroyed()) return;
      this.ui.webContents.send('state', this.state());
      const a = this.active;
      this.win.setTitle((a && a.title ? a.title + ' – ' : '') + (this.isPrivate ? 'Sakura Privat' : 'Sakura'));
      if (!this.isPrivate) saveSession();
    }, 16);
  }

  // ---------- Erweiterungs-Popup unter dem Symbol
  closePopup() {
    if (this.popup && !this.popup.isDestroyed()) this.popup.close();
    this.popup = null;
  }

  openPopup(id, rect) {
    this.closePopup();
    const url = extensions.pageUrl(id, 'popup');
    if (!url) {
      const opt = extensions.pageUrl(id, 'options');
      if (opt) this.newTab(opt);
      else dialog.showMessageBox(this.win, { type: 'info', message: 'Diese Erweiterung hat kein eigenes Fenster.', detail: 'Sie arbeitet direkt auf den Webseiten.' });
      return;
    }
    const cb = this.win.getContentBounds();
    const anchorRight = cb.x + Math.round(rect.x + rect.width);
    const top = cb.y + Math.round(rect.y + rect.height + 4);
    const opts = {
      width: 320, height: 200, x: anchorRight - 320, y: top, show: false, frame: false, resizable: false,
      skipTaskbar: true, minimizable: false, maximizable: false, fullscreenable: false, backgroundColor: '#FFFFFF',
      webPreferences: { session: this.ses, enablePreferredSizeMode: true, sandbox: true, contextIsolation: true }
    };
    let pop;
    try { pop = new BrowserWindow({ ...opts, parent: this.win }); } catch { pop = new BrowserWindow(opts); }
    this.popup = pop;
    const wc = pop.webContents;
    wc.on('preferred-size-changed', (e, size) => {
      if (pop.isDestroyed()) return;
      const w = Math.max(25, Math.min(800, size.width)), h = Math.max(25, Math.min(600, size.height));
      pop.setBounds({ x: anchorRight - w, y: top, width: w, height: h });
    });
    wc.setWindowOpenHandler(({ url: u }) => { this.newTab(u); this.closePopup(); return { action: 'deny' }; });
    wc.once('did-finish-load', () => { if (!pop.isDestroyed()) { pop.show(); pop.focus(); } });
    wc.on('before-input-event', (e, i) => { if (i.type === 'keyDown' && i.key === 'Escape') this.closePopup(); });
    pop.on('blur', () => setTimeout(() => { if (this.popup === pop && !pop.isDestroyed() && !pop.webContents.isDevToolsOpened()) this.closePopup(); }, 50));
    pop.on('closed', () => { if (this.popup === pop) this.popup = null; });
    wc.loadURL(url).catch(() => this.closePopup());
  }

  extMenu(id) {
    const info = extensions.list().find(x => x.id === id);
    if (!info) return;
    const opt = extensions.pageUrl(id, 'options');
    Menu.buildFromTemplate([
      { label: info.name, enabled: false },
      { type: 'separator' },
      { label: 'Optionen', enabled: !!opt, click: () => this.newTab(opt) },
      { label: 'Popup untersuchen', enabled: !!info.popup, click: () => { if (this.popup) this.popup.webContents.openDevTools({ mode: 'detach' }); } },
      { label: 'Alle Erweiterungen verwalten', click: () => this.ui.webContents.send('open-panel', 'extensions') },
      { type: 'separator' },
      { label: 'Ausschalten', click: () => extensions.setEnabled(id, false) },
      { label: 'Entfernen …', click: () => confirmRemoveExtension(this, info) }
    ]).popup();
  }

  tabMenu(id) {
    const t = this.tabs.find(x => x.id === id);
    if (!t) return;
    const i = this.tabs.indexOf(t);
    const others = this.tabs.filter(x => x !== t && !x.pinned);
    const right = this.tabs.slice(i + 1).filter(x => !x.pinned);
    Menu.buildFromTemplate([
      { label: 'Neuer Tab rechts', click: () => this.newTab(NEWTAB, { index: i + 1 }) },
      { type: 'separator' },
      { label: 'Neu laden', click: () => t.view.webContents.reload() },
      { label: 'Duplizieren', click: () => this.newTab(this.displayUrl(t.pending || t.url) || NEWTAB, { index: i + 1, container: t.container }) },
      ...(this.isPrivate ? [] : [{
        label: 'In Konto-Tab öffnen',
        submenu: [...Array(CONTAINERS)].map((_, k) => ({
          label: containerName(k + 1), type: 'radio', checked: t.container === k + 1,
          click: () => this.newTab(this.displayUrl(t.pending || t.url) || NEWTAB, { index: i + 1, container: k + 1 })
        })).concat(t.container ? [{ type: 'separator' }, { label: 'Als normalen Tab öffnen', click: () => this.newTab(this.displayUrl(t.pending || t.url) || NEWTAB, { index: i + 1 }) }] : [])
      }]),
      { label: 'In neues Fenster verschieben', enabled: this.tabs.length > 1, click: () => uiCommands.tabToNewWindow(this, id) },
      { label: t.pinned ? 'Loslösen' : 'Anheften', click: () => this.togglePin(id) },
      { label: t.floating ? 'Video zurück in den Tab' : 'Video schweben lassen', accelerator: 'CmdOrCtrl+Alt+P', click: () => t.floating ? unfloat() : floatVideo(this, id) },
      { label: 'Tab schlafen legen', enabled: t.id !== this.activeId && !t.pending && /^https?:/i.test(t.url), click: () => this.sleepTab(id) },
      { type: 'separator' },
      { label: 'Zu neuer Gruppe hinzufügen', click: () => this.newGroup(id) },
      ...(this.groups.size ? [{
        label: 'Zu Gruppe hinzufügen',
        submenu: [...this.groups.values()].filter(g => g.id !== t.group).map(g => ({
          label: g.name || 'Unbenannte Gruppe (' + this.tabs.filter(x => x.group === g.id).length + ' Tabs)', click: () => this.addToGroup(id, g.id)
        }))
      }] : []),
      ...(t.group ? [{ label: 'Aus Gruppe entfernen', click: () => this.removeFromGroup(id) }] : []),
      { type: 'separator' },
      { label: t.muted ? 'Ton einschalten' : 'Stummschalten', click: () => this.toggleMute(id) },
      { type: 'separator' },
      { label: 'Tab schließen', accelerator: 'CmdOrCtrl+W', click: () => this.closeTab(id) },
      { label: 'Andere Tabs schließen', enabled: others.length > 0, click: () => others.forEach(x => this.closeTab(x.id)) },
      { label: 'Tabs rechts schließen', enabled: right.length > 0, click: () => right.forEach(x => this.closeTab(x.id)) },
      { type: 'separator' },
      { label: 'Geschlossenen Tab wieder öffnen', enabled: closedTabs.length > 0, click: () => reopenClosed(this) }
    ]).popup();
  }

  pageMenu(tab, p) {
    if (tab.floating) return floatMenu();
    const wc = tab.view.webContents;
    const items = [];
    if (p.linkURL) {
      items.push(
        { label: 'Link in neuem Tab öffnen', click: () => this.newTab(p.linkURL, { background: true, index: this.tabs.indexOf(tab) + 1 }) },
        { label: 'Link in privatem Fenster öffnen', click: () => new SakuraWindow({ isPrivate: true, url: p.linkURL }) },
        { label: 'Link-Adresse kopieren', click: () => clipboard.writeText(p.linkURL) },
        { type: 'separator' }
      );
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push(
        { label: 'Bild in neuem Tab öffnen', click: () => this.newTab(p.srcURL, { index: this.tabs.indexOf(tab) + 1 }) },
        { label: 'Bild speichern unter …', click: () => wc.downloadURL(p.srcURL) },
        { label: 'Bild kopieren', click: () => wc.copyImageAt(p.x, p.y) },
        { label: 'Bildadresse kopieren', click: () => clipboard.writeText(p.srcURL) },
        { type: 'separator' }
      );
    }
    if (p.isEditable) {
      if (p.misspelledWord && p.dictionarySuggestions.length) {
        for (const s of p.dictionarySuggestions.slice(0, 4)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
        items.push({ type: 'separator' });
      }
      items.push(
        { label: 'Ausschneiden', role: 'cut', enabled: p.editFlags.canCut },
        { label: 'Kopieren', role: 'copy', enabled: p.editFlags.canCopy },
        { label: 'Einfügen', role: 'paste', enabled: p.editFlags.canPaste },
        { label: 'Alles auswählen', role: 'selectAll' }
      );
    } else if (p.selectionText) {
      const sel = p.selectionText.trim().slice(0, 60);
      items.push(
        { label: 'Kopieren', role: 'copy' },
        { label: `Suchen nach „${sel.length > 30 ? sel.slice(0, 30) + '…' : sel}“`, click: () => this.newTab(M.toUrl(sel, store.prefs().searchEngine), { index: this.tabs.indexOf(tab) + 1 }) },
        { label: 'Auswahl übersetzen', click: () => this.newTab('https://translate.google.com/?sl=auto&tl=de&op=translate&text=' + encodeURIComponent(p.selectionText.slice(0, 4000)), { index: this.tabs.indexOf(tab) + 1 }) }
      );
    } else if (!p.linkURL && p.mediaType === 'none') {
      items.push(
        { label: 'Zurück', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Vorwärts', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Neu laden', click: () => wc.reload() },
        { type: 'separator' },
        { label: 'Seite übersetzen', click: () => translatePage(this) },
        { label: 'Seite überwachen (Preis, Verfügbarkeit)', click: () => uiCommands.watchPage(this) },
        { label: 'Als PDF speichern …', click: () => savePdf(this) },
        { label: 'Bildschirmfoto speichern …', click: () => screenshot(this) },
        { label: 'Ganze Seite als Bild …', click: () => screenshot(this, true) },
        { label: 'Drucken …', click: () => wc.print() }
      );
    }
    items.push({ type: 'separator' }, { label: 'Untersuchen', click: () => wc.inspectElement(p.x, p.y) });
    Menu.buildFromTemplate(items).popup();
  }
}

// ---------------------------------------------------------------- Seitenwerkzeuge
function stamp() {
  const d = new Date(), z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}.${z(d.getSeconds())}`;
}
function safeName(s) { return String(s || 'Seite').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Seite'; }

function translatePage(w) {
  const a = w.active;
  const u = a && w.displayUrl(a.url);
  if (u && /^https?:/.test(u)) a.view.webContents.loadURL('https://translate.google.com/translate?sl=auto&tl=de&u=' + encodeURIComponent(u));
}

async function savePdf(w) {
  const a = w.active;
  if (!a) return;
  const r = await dialog.showSaveDialog(w.win, {
    title: 'Als PDF speichern', defaultPath: path.join(app.getPath('downloads'), safeName(a.title) + '.pdf'),
    filters: [{ name: 'PDF-Dokument', extensions: ['pdf'] }]
  });
  if (r.canceled || !r.filePath) return;
  try {
    const data = await a.view.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    fs.writeFileSync(r.filePath, data);
    shell.showItemInFolder(r.filePath);
  } catch (e) {
    dialog.showMessageBox(w.win, { type: 'error', message: 'Die PDF konnte nicht gespeichert werden.', detail: e.message });
  }
}

// Ganze Seite über das DevTools-Protokoll (auch der Teil unterhalb des Fensters)
async function captureFullPage(wc) {
  const dbg = wc.debugger;
  let attached = false;
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true; }
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize;
    const width = Math.max(1, Math.ceil(size.width)), height = Math.max(1, Math.min(Math.ceil(size.height), 16000));
    const r = await dbg.sendCommand('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height, scale: 1 } });
    return nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
  } finally {
    if (attached) try { dbg.detach(); } catch {}
  }
}

async function screenshot(w, full = false) {
  const a = w.active;
  if (!a) return;
  let img = null;
  if (full) try { img = await captureFullPage(a.view.webContents); } catch { img = null; }
  if (!img || img.isEmpty()) img = await a.view.webContents.capturePage();
  const r = await dialog.showSaveDialog(w.win, {
    title: 'Bildschirmfoto speichern', defaultPath: path.join(app.getPath('pictures'), 'Sakura ' + stamp() + '.png'),
    filters: [{ name: 'PNG-Bild', extensions: ['png'] }]
  });
  if (r.canceled || !r.filePath) { clipboard.writeImage(img); return; }
  fs.writeFileSync(r.filePath, img.toPNG());
}

// Cookie-Banner automatisch ablehnen (assets/cookie-reject.js)
let cookieScript = null;
function cookieRejectOn(url) {
  const p = store.prefs();
  if (p.cookieReject === false) return false;
  let host = '';
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return false; }
  return /^https?:/.test(url) && !(p.cookieAllow || []).includes(host);
}
function runCookieReject(wc, pid, rid) {
  if (wc.isDestroyed() || !cookieRejectOn(wc.getURL())) return;
  if (cookieScript == null) { try { cookieScript = fs.readFileSync(path.join(__dirname, 'assets', 'cookie-reject.js'), 'utf8'); } catch { cookieScript = ''; } }
  if (!cookieScript) return;
  try {
    const target = pid != null && webFrameMain ? webFrameMain.fromId(pid, rid) : wc;
    if (target) target.executeJavaScript(cookieScript, false).catch(() => {});
  } catch { /* Rahmen schon weg */ }
}

// Videos und Serien: weiterschauen, Intro überspringen, nächste Folge (assets/video.js)
let videoScript = null;
function runVideoHelper(wc, pid, rid) {
  const p = store.prefs();
  if (wc.isDestroyed() || (p.videoResume === false && p.skipIntro === false && p.autoNext === false)) return;
  if (!/^https?:/i.test(wc.getURL())) return;
  if (videoScript == null) { try { videoScript = fs.readFileSync(path.join(__dirname, 'assets', 'video.js'), 'utf8'); } catch { videoScript = ''; } }
  if (!videoScript) return;
  const cfg = JSON.stringify({ resume: p.videoResume !== false, intro: p.skipIntro !== false, next: p.autoNext !== false });
  try {
    const target = pid != null && webFrameMain ? webFrameMain.fromId(pid, rid) : wc;
    if (target) target.executeJavaScript(`window.__sakuraVideoConfig = ${cfg};\n${videoScript}`, false).catch(() => {});
  } catch { /* Rahmen schon weg */ }
}
/** Schlüssel für die gemerkte Videostelle: Adresse ohne Sprungmarke und ohne Zeit-Angaben */
function videoKey(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    for (const k of ['t', 'start', 'time_continue', 'si', 'pp']) u.searchParams.delete(k);
    return u.toString();
  } catch { return null; }
}

// ---------------------------------------------------------------- Passwortmanager
function tabOfSender(sender) {
  for (const w of windows) { const t = w.tabs.find(x => x.view.webContents === sender); if (t) return { w, t }; }
  return null;
}
const pwPrompting = new Set();
async function offerSavePassword(sender, url, d) {
  const f = tabOfSender(sender);
  if (!f || f.w.isPrivate || store.prefs().passwordManager === false || store.prefs().passwordSave === false || !vault.available || vault.isNever(url)) return;
  if (!d || typeof d.password !== 'string' || !d.password) return;
  const st = vault.check(url, d.username, d.password);
  if (!st || st === 'same' || pwPrompting.has(f.t.id)) return;
  pwPrompting.add(f.t.id);
  try {
    const host = Passwords.originOf(url).replace(/^https?:\/\/(www\.)?/, '');
    const r = await dialog.showMessageBox(f.w.win, {
      type: 'question', title: 'Passwort speichern',
      message: st === 'new' ? `Passwort für ${host} speichern?` : `Neues Passwort für ${host} übernehmen?`,
      detail: `Benutzer: ${String(d.username || '') || '(ohne Benutzername)'}\nDas Passwort wird mit deinem Windows-Konto verschlüsselt gespeichert.`,
      buttons: [st === 'new' ? 'Speichern' : 'Aktualisieren', 'Nicht jetzt', 'Nie für diese Seite'], defaultId: 0, cancelId: 1, noLink: true
    });
    if (r.response === 0) vault.upsert(url, d.username, d.password);
    if (r.response === 2) vault.addNever(url);
  } catch (e) { console.error('Passwort speichern:', e.message); }
  finally { pwPrompting.delete(f.t.id); }
}

// ---------------------------------------------------------------- Multistream
/** Kacheln für 1–4 Streams: eins groß, zwei nebeneinander, drei/vier im 2×2-Raster */
function multistreamLayout(n, w, h) {
  if (n <= 1) return [{ x: 0, y: 0, width: w, height: h }];
  if (n === 2) return [0, 1].map(i => ({ x: Math.round(i * w / 2), y: 0, width: Math.round(w / 2), height: h }));
  return [0, 1, 2, 3].slice(0, n).map(i => ({ x: (i % 2) * Math.round(w / 2), y: Math.floor(i / 2) * Math.round(h / 2), width: Math.round(w / 2), height: Math.round(h / 2) }));
}
function openMultistream(channels) {
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const win = new BaseWindow({
    width: Math.min(1600, area.width), height: Math.min(920, area.height), title: 'Multistream – ' + channels.join(', '),
    backgroundColor: '#000000', icon: ICON, autoHideMenuBar: true
  });
  const views = channels.map((c, i) => {
    const v = new WebContentsView({ webPreferences: { session: session.defaultSession, sandbox: true, contextIsolation: true } });
    v.setBackgroundColor('#000000');
    win.contentView.addChildView(v);
    const wc = v.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      const w = [...windows].find(x => !x.isPrivate) || new SakuraWindow();
      if (/^https:\/\//.test(url)) w.newTab(url);
      return { action: 'deny' };
    });
    // Ton nur beim zuletzt angeklickten Stream
    wc.on('input-event', (e, ie) => { if (ie.type === 'mouseDown') views.forEach(x => x.webContents.setAudioMuted(x !== v)); });
    wc.setAudioMuted(i > 0);
    wc.loadURL(`https://player.twitch.tv/?channel=${encodeURIComponent(c)}&parent=twitch.tv&player=popout&muted=false`).catch(() => {});
    return v;
  });
  const fit = () => {
    if (win.isDestroyed()) return;
    const b = win.getContentBounds();
    multistreamLayout(views.length, b.width, b.height).forEach((r, i) => views[i].setBounds(r));
  };
  win.on('resize', fit);
  win.on('closed', () => views.forEach(v => { if (!v.webContents.isDestroyed()) v.webContents.close(); }));
  fit();
  return win;
}

// ---------------------------------------------------------------- Streamer-Modus
let streamerApp = null; // laufendes Streaming-Programm (OBS …)
/** Ist der Streamer-Modus gerade aktiv? Einstellung streamerMode: 'auto' (wenn OBS läuft) | 'on' | 'off' */
function streamerActive() {
  const m = store.prefs().streamerMode || 'auto';
  return m === 'on' || (m === 'auto' && !!streamerApp);
}

// ---------------------------------------------------------------- Seitenüberwachung
let watchScript = null;
const readWatchScript = () => {
  if (watchScript == null) { try { watchScript = fs.readFileSync(path.join(__dirname, 'assets', 'watch.js'), 'utf8'); } catch { watchScript = ''; } }
  return watchScript;
};
/** Seite unsichtbar laden und Preis/Verfügbarkeit auslesen */
async function extractPage(url) {
  const win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { session: session.defaultSession, sandbox: true, contextIsolation: true } });
  try {
    const wc = win.webContents;
    wc.setAudioMuted(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    await Promise.race([wc.loadURL(url), new Promise((_, rej) => setTimeout(() => rej(new Error('Zeitüberschreitung')), 30000))]);
    await new Promise(r => setTimeout(r, 2500)); // Shops laden Preise oft nach
    return await wc.executeJavaScript(readWatchScript(), true);
  } finally {
    if (!win.isDestroyed()) win.destroy ? win.destroy() : win.close();
  }
}
function watchNotify(w, change) {
  try {
    if (!Notification || !Notification.isSupported()) return;
    const n = new Notification({ title: change.text, body: w.title, icon: ICON });
    n.on('click', () => {
      const win = [...windows].find(x => !x.isPrivate) || new SakuraWindow();
      win.newTab(w.url); win.win.focus();
    });
    n.show();
  } catch {}
}
async function watchActive(w) {
  const t = w.active;
  const url = t && w.displayUrl(t.url);
  if (!url || !/^https?:/i.test(url)) return { error: 'Öffne zuerst die Seite, die du überwachen willst.' };
  let r = null;
  try { r = await t.view.webContents.executeJavaScript(readWatchScript(), true); } catch {}
  try {
    const entry = watcher.add(url, r);
    broadcast('watches-changed');
    const what = entry.price != null ? `Aktueller Preis: ${require('./lib/watch').fmtPrice(entry.price, entry.currency)}.` : entry.available === false ? 'Gerade nicht verfügbar.' : 'Gerade verfügbar.';
    return { ok: true, message: `Sakura überwacht jetzt „${entry.title}“. ${what} Du bekommst eine Nachricht, wenn sich der Preis ändert oder es wieder verfügbar ist.` };
  } catch (e) { return { error: e.message }; }
}

// ---------------------------------------------------------------- Lesemodus (Mozilla Readability)
// Läuft in einer abgeschotteten Welt der Seite (READER_WORLD): Die Webseite kann nicht hineinpfuschen,
// und fremder Inhalt kommt nie in eine sakura://-Seite mit Sonderrechten.
const READER_WORLD = 1001;
const readerSrc = {};
function readerFile(key) {
  if (readerSrc[key] != null) return readerSrc[key];
  try {
    if (key === 'readability') {
      const src = fs.readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8');
      readerSrc[key] = `(function(){\n${src}\n;window.__sakuraReadability = Readability;})();`;
    } else if (key === 'readerable') {
      const src = fs.readFileSync(require.resolve('@mozilla/readability/Readability-readerable.js'), 'utf8');
      readerSrc[key] = `(function(){\n${src}\n;try { return isProbablyReaderable(document, { minContentLength: 180, minScore: 30 }); } catch (e) { return false; }})()`;
    } else readerSrc[key] = fs.readFileSync(path.join(__dirname, 'assets', key), 'utf8');
  } catch { readerSrc[key] = ''; }
  return readerSrc[key];
}
async function checkReadable(tab) {
  const wc = tab.view.webContents;
  if (wc.isDestroyed() || tab.reader || !/^https?:/i.test(wc.getURL()) || !wc.executeJavaScriptInIsolatedWorld) return;
  const code = readerFile('readerable');
  if (!code) return;
  try {
    const ok = !!(await wc.executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code }]));
    if (ok !== !!tab.readable) { tab.readable = ok; tab.w.sendState(); }
  } catch {}
}
// ---------- Leseliste: Artikel als reinen Text für später speichern (nur lokal)
async function addToReadlist(w) {
  const t = w.active;
  const url = t && w.displayUrl(t.url);
  if (!url || !/^https?:/i.test(url)) return { error: 'Öffne zuerst den Artikel, den du dir merken willst.' };
  if (!Array.isArray(store.data.readlist)) store.data.readlist = [];
  if (store.data.readlist.some(x => x.url === url)) return { ok: true, message: 'Schon in deiner Leseliste.' };
  let r = null;
  const wc = t.view.webContents;
  try {
    const lib = readerFile('readability'), grab = readerFile('readlist-grab.js');
    if (lib && grab && wc.executeJavaScriptInIsolatedWorld) r = await wc.executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code: `${lib}\n${grab}` }]);
  } catch {}
  const blocks = (r && Array.isArray(r.blocks) ? r.blocks : []).filter(b => b && typeof b.x === 'string' && ['p', 'h', 'q', 'li'].includes(b.t))
    .slice(0, 800).map(b => ({ t: b.t, x: b.x.slice(0, 5000) }));
  store.data.readlist.unshift({
    id: M.newId(), url, title: String((r && r.title) || t.title || url).slice(0, 300), byline: String((r && r.byline) || '').slice(0, 200),
    site: String((r && r.site) || '').slice(0, 100), blocks, savedAt: Date.now(), read: false
  });
  store.data.readlist = store.data.readlist.slice(0, 300);
  store.save();
  broadcast('readlist-changed');
  return { ok: true, message: blocks.length ? 'Zur Leseliste hinzugefügt – auch offline lesbar.' : 'Zur Leseliste hinzugefügt (ohne Offline-Text).' };
}

async function toggleReader(w) {
  const t = w.active;
  if (!t) return false;
  const wc = t.view.webContents;
  if (t.reader) { t.reader = false; wc.reload(); w.sendState(); return false; }
  const lib = readerFile('readability'), view = readerFile('reader.js'), css = readerFile('reader.css');
  if (!lib || !view || !wc.executeJavaScriptInIsolatedWorld) return false;
  const p = store.prefs();
  const prefs = JSON.stringify({ size: Math.max(14, Math.min(32, Number(p.readerSize) || 20)), theme: ['hell', 'sepia', 'dunkel'].includes(p.readerTheme) ? p.readerTheme : 'sepia' });
  try {
    if (css) await wc.insertCSS(css);
    // Ein einziges Skript: bei mehreren liefert Electron das Ergebnis des letzten nicht zurück
    const ok = await wc.executeJavaScriptInIsolatedWorld(READER_WORLD, [{ code: `${lib}\nwindow.__sakuraReaderPrefs = ${prefs};\n${view}` }], true);
    t.reader = ok === true || ok === 'schon';
  } catch { t.reader = false; }
  if (!t.reader) dialog.showMessageBox(w.win, { type: 'info', message: 'Diese Seite lässt sich nicht im Lesemodus anzeigen.', detail: 'Der Lesemodus funktioniert bei Artikeln und Berichten mit genug Text.' });
  w.sendState();
  return t.reader;
}

// ---------------------------------------------------------------- Popup-Blocker
const clickIntents = new Map(); // webContents-ID → letzter Klick auf der Seite { at, href, interactive }
function popupVerdict(tab, url, features) {
  const p = store.prefs();
  const opener = tab.view.webContents.getURL();
  const host = hostOfUrl(opener);
  if (p.popupBlock === false || (host && (p.popupAllow || []).includes(host)) || /^sakura:/.test(opener)) return { allow: true };
  const adsOn = p.adblock !== false && !(host && (p.adblockAllow || []).includes(host));
  return Popups.decidePopup({
    url, opener, features, lastInput: tab.lastInput, intent: clickIntents.get(tab.view.webContents.id) || null,
    isAd: adsOn ? h => blocker.isBlocked(h) : null
  });
}

// ---------------------------------------------------------------- Video und Ton
// Kino-Modus, Helligkeit, Bass/Dialog, Equalizer (assets/media.js). Helligkeit und Ton gelten pro Seite und
// werden gemerkt (nur lokal), der Kino-Modus nur für den Tab.
const MEDIA_DEFAULT = { brightness: 100, bass: 0, dialog: false, eq: [0, 0, 0, 0, 0] };
let mediaScript = null;
const hostOfUrl = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
function siteMedia(host) {
  const s = (store.data.mediaSites || {})[host];
  return { ...MEDIA_DEFAULT, ...(s || {}), eq: (s && Array.isArray(s.eq) ? s.eq : MEDIA_DEFAULT.eq).slice(0, 5) };
}
function cleanMedia(p) {
  const out = {};
  if ('brightness' in p) out.brightness = Math.max(30, Math.min(200, Math.round(Number(p.brightness) || 100)));
  if ('bass' in p) out.bass = Math.max(0, Math.min(12, Math.round(Number(p.bass) || 0)));
  if ('dialog' in p) out.dialog = !!p.dialog;
  if ('eq' in p && Array.isArray(p.eq)) out.eq = [0, 1, 2, 3, 4].map(i => Math.max(-12, Math.min(12, Math.round(Number(p.eq[i]) || 0))));
  if ('cinema' in p) out.cinema = !!p.cinema;
  return out;
}
async function mediaCall(wc, expr) {
  if (!wc || wc.isDestroyed() || !/^https?:/i.test(wc.getURL())) return null;
  if (mediaScript == null) { try { mediaScript = fs.readFileSync(path.join(__dirname, 'assets', 'media.js'), 'utf8'); } catch { mediaScript = ''; } }
  if (!mediaScript) return null;
  try { return await wc.executeJavaScript(`${mediaScript}\n;(${expr})`, true); } catch { return null; }
}
function applyTabMedia(tab) {
  const host = hostOfUrl(tab.url);
  const st = { ...siteMedia(host), cinema: !!(tab.media && tab.media.cinema) };
  return mediaCall(tab.view.webContents, `window.__sakuraMedia.apply(${JSON.stringify(st)})`);
}
/** Beim Laden: gemerkte Einstellungen der Seite anwenden (nur wenn nicht Standard) */
function applySiteMedia(tab) {
  const host = hostOfUrl(tab.view.webContents.getURL());
  if (!host || !(store.data.mediaSites || {})[host]) return;
  applyTabMedia(tab);
}

// Sleep-Timer: nach einer Zeit oder am Ende der Folge alles anhalten
let sleepTimer = null; // { mode: 'time' | 'episode', until, timer, tabId }
function pauseEverything() {
  for (const w of windows) for (const t of w.tabs) {
    const wc = t.view.webContents;
    if (wc.isDestroyed() || t.pending) continue;
    const js = 'document.querySelectorAll("video, audio").forEach(m => { try { m.pause(); } catch (e) {} })';
    try { for (const f of wc.mainFrame ? wc.mainFrame.framesInSubtree : []) f.executeJavaScript(js).catch(() => {}); } catch {}
    if (!wc.mainFrame) wc.executeJavaScript(js).catch(() => {});
  }
}
function notify(title, body) {
  try { if (Notification && Notification.isSupported()) new Notification({ title, body, icon: ICON, silent: true }).show(); } catch {}
}
function clearSleep() {
  if (!sleepTimer) return;
  clearTimeout(sleepTimer.timer);
  if (sleepTimer.mode === 'episode') { const f = findTab(sleepTimer.tabId); if (f) mediaCall(f.t.view.webContents, 'window.__sakuraMedia.sleepAtEnd(false)'); }
  sleepTimer = null;
}
async function setSleep(w, { minutes, episode } = {}) {
  clearSleep();
  if (episode) {
    const t = w.active;
    const ok = t && await mediaCall(t.view.webContents, 'window.__sakuraMedia.sleepAtEnd(true)');
    if (!ok) { broadcastState(); return { error: 'Auf diesem Tab läuft kein Video.' }; }
    sleepTimer = { mode: 'episode', tabId: t.id };
  } else if (Number(minutes) > 0) {
    const ms = Math.min(600, Number(minutes)) * 60000;
    sleepTimer = { mode: 'time', until: Date.now() + ms, minutes: Number(minutes) };
    sleepTimer.timer = setTimeout(() => {
      sleepTimer = null;
      pauseEverything();
      notify('Sleep-Timer', 'Die Wiedergabe wurde angehalten. Gute Nacht.');
      broadcastState();
    }, ms);
  }
  broadcastState();
  return { ok: true };
}

// Twitch: Emotes (7TV/BTTV/FFZ) und Kanalpunkte (assets/twitch.js)
const isTwitch = url => { try { const u = new URL(url); return u.protocol === 'https:' && /(^|\.)twitch\.tv$/.test(u.hostname); } catch { return false; } };
let twitchScript = null;
function runTwitch(wc) {
  const p = store.prefs();
  if ((p.twitchEmotes === false && !p.twitchPoints) || !isTwitch(wc.getURL())) return;
  if (twitchScript == null) { try { twitchScript = fs.readFileSync(path.join(__dirname, 'assets', 'twitch.js'), 'utf8'); } catch { twitchScript = ''; } }
  if (!twitchScript) return;
  const cfg = JSON.stringify({ emotes: p.twitchEmotes !== false, points: !!p.twitchPoints });
  wc.executeJavaScript(`window.__sakuraTwitchConfig = ${cfg};\n${twitchScript}`, false).catch(() => {});
}

// Steam-Shop: Spieler online, Spielzeit, Preisvergleich (assets/steam.js)
const isSteamStore = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'store.steampowered.com'; } catch { return false; } };
let steamScript = null;
function runSteam(wc) {
  if (store.prefs().steamInfo === false || !isSteamStore(wc.getURL()) || !/\/app\/\d+/.test(wc.getURL())) return;
  if (steamScript == null) { try { steamScript = fs.readFileSync(path.join(__dirname, 'assets', 'steam.js'), 'utf8'); } catch { steamScript = ''; } }
  if (steamScript) wc.executeJavaScript(steamScript, false).catch(() => {});
}

// YouTube: Werbung und Sponsoren überspringen, Qualität (assets/youtube.js)
let ytScript = null, ytCss = null;
function runYouTube(wc) {
  const url = wc.getURL();
  if (store.prefs().youtube === false || !SB.isYouTube(url)) return;
  if (ytScript == null) {
    try { ytScript = fs.readFileSync(path.join(__dirname, 'assets', 'youtube.js'), 'utf8'); } catch { ytScript = ''; }
    try { ytCss = fs.readFileSync(path.join(__dirname, 'assets', 'youtube.css'), 'utf8'); } catch { ytCss = ''; }
  }
  if (!ytScript) return;
  const p = store.prefs();
  const cfg = JSON.stringify({ quality: p.ytQuality || 'hd1080', sponsorblock: p.ytSponsor !== false });
  if (ytCss) wc.insertCSS(ytCss).catch(() => {});
  wc.executeJavaScript(`window.__sakuraYTConfig = ${cfg};\n${ytScript}`, false).catch(() => {});
}

function runUserScripts(wc) {
  const url = wc.getURL();
  if (!/^https?:/i.test(url)) return;
  for (const s of M.scriptsFor(store.data.scripts, url)) {
    const label = JSON.stringify('[Sakura-Skript] ' + (s.name || ''));
    wc.executeJavaScript(`(function(){try{\n${s.code}\n}catch(e){console.error(${label}, e)}})();`, false).catch(() => {});
  }
}

// ---------------------------------------------------------------- Schwebendes Video
// Der Tab wandert in ein kleines Fenster, das über allem bleibt (auch über Spielen). Auf der Seite ist dann
// nur noch das Video zu sehen. Schließen holt den Tab ohne Neuladen zurück.
const FLOAT_CSS = `html, body { background: #000 !important; overflow: hidden !important; }
body * { visibility: hidden !important; }
[data-sakura-float] { visibility: visible !important; position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
  max-width: none !important; max-height: none !important; margin: 0 !important; transform: none !important; z-index: 2147483647 !important;
  object-fit: contain !important; background: #000 !important; }`;
// Größtes (bevorzugt laufendes) Video markieren und ihm eigene Steuerelemente geben
const FLOAT_PICK = `(function () {
  const vs = [...document.querySelectorAll('video')].filter(v => v.readyState > 0 || v.currentSrc);
  const score = v => (v.paused ? 0 : 1e9) + v.clientWidth * v.clientHeight;
  vs.sort((a, b) => score(b) - score(a));
  const v = vs[0];
  if (!v) return false;
  v.setAttribute('data-sakura-float', '');
  if (!v.controls) { v.controls = true; v.setAttribute('data-sakura-controls', ''); }
  return true;
})()`;
const FLOAT_UNDO = `(function () {
  for (const v of document.querySelectorAll('[data-sakura-float]')) {
    v.removeAttribute('data-sakura-float');
    if (v.hasAttribute('data-sakura-controls')) { v.controls = false; v.removeAttribute('data-sakura-controls'); }
  }
})()`;
const FLOAT_KEY = 'CommandOrControl+Alt+K';
let floating = null; // { tab, win, cssKey, through }

async function floatVideo(w, tabId) {
  const t = tabId ? w.tabs.find(x => x.id === tabId) : w.active;
  if (!t || t.pending || t.floating) return { error: 'Kein Tab' };
  if (floating) await unfloat();
  const wc = t.view.webContents;
  let ok = false;
  try { ok = await wc.executeJavaScript(FLOAT_PICK, true); } catch {}
  if (!ok) {
    dialog.showMessageBox(w.win, { type: 'info', message: 'Auf dieser Seite läuft kein Video.', detail: 'Starte ein Video und versuch es noch einmal.' });
    return { error: 'Kein Video' };
  }
  const cssKey = await wc.insertCSS(FLOAT_CSS).catch(() => null);
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const fw = new BaseWindow({
    width: 480, height: 290, x: area.x + area.width - 504, y: area.y + area.height - 314, minWidth: 200, minHeight: 120,
    alwaysOnTop: true, minimizable: false, maximizable: false, fullscreenable: false, autoHideMenuBar: true,
    title: 'Schwebendes Video – Sakura', backgroundColor: '#000000', icon: ICON
  });
  try { fw.setAlwaysOnTop(true, 'screen-saver'); fw.setVisibleOnAllWorkspaces(true); } catch {}
  w.win.contentView.removeChildView(t.view);
  fw.contentView.addChildView(t.view);
  t.floating = true;
  floating = { tab: t, win: fw, cssKey, through: false };
  const fit = () => {
    if (fw.isDestroyed()) return;
    const b = fw.getContentBounds();
    t.view.setVisible(true);
    t.view.setBounds({ x: 0, y: 0, width: b.width, height: b.height });
  };
  fw.on('resize', fit);
  fit();
  fw.on('closed', () => { if (floating && floating.win === fw) unfloat(true); });
  try { globalShortcut.register(FLOAT_KEY, toggleFloatThrough); } catch {}
  // Im Hauptfenster einen anderen Tab zeigen
  if (w.activeId === t.id) {
    const other = w.tabs.find(x => x !== t && !x.floating);
    if (other) w.activate(other.id); else w.newTab(NEWTAB);
  }
  w.sendState();
  return { ok: true };
}

/** Video zurück in den Tab holen. closed = das schwebende Fenster ist schon zu */
async function unfloat(closed = false) {
  const f = floating;
  if (!f) return;
  floating = null;
  try { globalShortcut.unregister(FLOAT_KEY); } catch {}
  const t = f.tab, wc = t.view.webContents;
  t.floating = false;
  if (!f.win.isDestroyed()) f.win.contentView.removeChildView(t.view);
  if (!closed && !f.win.isDestroyed()) f.win.close();
  if (wc.isDestroyed()) return;
  if (f.cssKey) wc.removeInsertedCSS(f.cssKey).catch(() => {});
  wc.executeJavaScript(FLOAT_UNDO).catch(() => {});
  const w = t.w;
  if (w.win.isDestroyed() || !w.tabs.includes(t)) return;
  w.win.contentView.addChildView(t.view, 0);
  w.activate(t.id);
  w.win.focus();
}

/** Tab wird geschlossen, während er schwebt: Fenster einfach zumachen */
function dropFloat() {
  const f = floating;
  if (!f) return;
  floating = null;
  f.tab.floating = false;
  try { globalShortcut.unregister(FLOAT_KEY); } catch {}
  if (!f.win.isDestroyed()) { f.win.contentView.removeChildView(f.tab.view); f.win.close(); }
}

/** Durchklicken an/aus: Fenster wird halb durchsichtig, Klicks gehen an das darunter (z. B. ein Spiel) */
function toggleFloatThrough() {
  const f = floating;
  if (!f || f.win.isDestroyed()) return;
  f.through = !f.through;
  try {
    f.win.setIgnoreMouseEvents(f.through);
    f.win.setOpacity(f.through ? 0.7 : 1);
    f.win.setTitle(f.through ? 'Schwebendes Video – durchklickbar (Strg+Alt+K)' : 'Schwebendes Video – Sakura');
  } catch {}
}

function floatMenu() {
  const f = floating;
  if (!f) return;
  Menu.buildFromTemplate([
    { label: 'Zurück in den Tab', click: () => unfloat() },
    { label: 'Durchklickbar machen', type: 'checkbox', checked: f.through, accelerator: 'CmdOrCtrl+Alt+K', click: () => toggleFloatThrough() },
    { label: 'Deckkraft', submenu: [100, 85, 70, 50].map(v => ({ label: v + ' %', click: () => { if (!f.win.isDestroyed()) f.win.setOpacity(v / 100); } })) }
  ]).popup();
}

// ---------------------------------------------------------------- Leistung
let lastCpuTimes = null, ping = { at: 0, ms: null };
/** CPU-Auslastung des ganzen PCs seit dem letzten Aufruf (0–100) */
function systemCpu() {
  const now = os.cpus().reduce((a, c) => { for (const k in c.times) a[k === 'idle' ? 'idle' : 'busy'] += c.times[k]; return a; }, { idle: 0, busy: 0 });
  const prev = lastCpuTimes;
  lastCpuTimes = now;
  if (!prev) return null;
  const busy = now.busy - prev.busy, total = busy + now.idle - prev.idle;
  return total > 0 ? Math.round(busy / total * 100) : null;
}
/** Ping: Antwortzeit einer winzigen Google-Adresse (echtes ICMP-Ping braucht Admin-Rechte) */
async function measurePing() {
  if (Date.now() - ping.at < 4000) return ping.ms;
  ping.at = Date.now();
  const t0 = Date.now();
  try {
    const r = await net.fetch('https://www.gstatic.com/generate_204', { method: 'HEAD', cache: 'no-store', signal: AbortSignal.timeout(4000) });
    ping.ms = r.status < 500 ? Date.now() - t0 : null;
  } catch { ping.ms = null; }
  return ping.ms;
}
async function perfInfo(viewer) {
  const metrics = typeof app.getAppMetrics === 'function' ? app.getAppMetrics() : [];
  const byPid = new Map(metrics.map(m => [m.pid, m]));
  const tabs = [];
  for (const w of windows) for (const t of w.tabs) {
    let pid = null;
    try { if (!t.pending && t.view.webContents.getOSProcessId) pid = t.view.webContents.getOSProcessId(); } catch {}
    tabs.push({ t, w, pid });
  }
  const share = {};
  for (const x of tabs) if (x.pid) share[x.pid] = (share[x.pid] || 0) + 1;
  const kb = m => (m && m.memory ? m.memory.workingSetSize : 0);
  const cpu = m => (m && m.cpu ? m.cpu.percentCPUUsage : 0);
  const rows = tabs.map(({ t, w, pid }) => {
    const m = pid && byPid.get(pid), n = pid ? share[pid] : 1;
    const hide = w.isPrivate && !(viewer && viewer.isPrivate); // private Tabs nicht in normalen Fenstern verraten
    return {
      id: t.id, title: hide ? 'Privater Tab' : t.title || w.displayUrl(t.pending || t.url) || 'Neuer Tab', url: hide ? '' : w.displayUrl(t.pending || t.url),
      active: w.activeId === t.id, sleeping: !!t.pending, private: w.isPrivate, audible: t.audible,
      cpu: m ? cpu(m) / n : 0, mem: m ? kb(m) * 1024 / n : 0, shared: n > 1
    };
  });
  return {
    tabs: rows,
    sakura: { cpu: metrics.reduce((a, m) => a + cpu(m), 0), mem: metrics.reduce((a, m) => a + kb(m), 0) * 1024, processes: metrics.length },
    system: { cpu: systemCpu(), memTotal: os.totalmem(), memFree: os.freemem() },
    online: typeof net.isOnline === 'function' ? net.isOnline() : true,
    gaming: { supported: process.platform === 'win32', on: store.prefs().gaming !== false, active: !!(gameWatch && gameWatch.active), game: gameWatch ? gameWatch.game : null },
    ping: await measurePing()
  };
}
// Automatisch schlafen legen (Einstellungen: sleepAfter, ramLimit, cpuLimit)
const cpuStrikes = new Map();
async function autoSleepTick() {
  const p = store.prefs();
  if (!Number(p.sleepAfter) && !Number(p.ramLimit) && !Number(p.cpuLimit)) return [];
  const info = await perfInfo();
  const byId = new Map(info.tabs.map(r => [r.id, r]));
  const list = [];
  for (const w of windows) for (const t of w.tabs) {
    const r = byId.get(t.id) || {};
    list.push({ id: t.id, active: w.activeId === t.id, audible: t.audible, sleeping: !!t.pending, web: /^https?:/i.test(t.url), lastActive: t.lastActive, mem: r.mem || 0, cpu: r.cpu || 0 });
  }
  const picked = pickTabsToSleep(list, p, Date.now(), info.sakura.mem, cpuStrikes);
  for (const x of picked) { const f = findTab(x.id); if (f) f.w.sleepTab(x.id); }
  return picked;
}

function findTab(id) {
  for (const w of windows) { const t = w.tabs.find(x => x.id === id); if (t) return { w, t }; }
  return null;
}

// ---------------------------------------------------------------- Sitzung merken
let lastSession = '';
// Notizen zur Seite: Schlüssel = Domain (ohne www) + Pfad, ohne Parameter
function noteKey(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.hostname.replace(/^www\./, '') + (u.pathname.replace(/\/+$/, '') || '');
  } catch { return null; }
}
function noteFor(url) { const k = noteKey(url); return k && store.data.notes && store.data.notes[k] || null; }

function windowSnapshot(w) {
  return {
    active: Math.max(0, w.tabs.findIndex(t => t.id === w.activeId)),
    tabs: w.tabs.map(t => ({ url: w.displayUrl(t.pending || t.url) || NEWTAB, title: t.title, pinned: t.pinned || undefined, group: t.group || undefined, container: t.container || undefined })),
    groups: [...w.groups.values()]
  };
}

function saveSession() {
  const snap = [...windows].filter(w => !w.isPrivate && !w.win.isDestroyed()).map(windowSnapshot).filter(x => x.tabs.length);
  if (!snap.length) return;
  const json = JSON.stringify(snap);
  if (json === lastSession) return;
  lastSession = json;
  store.data.session = snap;
  store.save();
  store.emit('change', 'tabs', true); // für „Tabs auf anderen Geräten“
}

function openTabsForSync() {
  const out = [];
  for (const w of windows) {
    if (w.isPrivate) continue;
    for (const t of w.tabs) {
      const u = w.displayUrl(t.pending || t.url);
      if (/^https?:/.test(u)) out.push({ url: u, title: t.title || u });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Erweiterungen
async function confirmInstall(info) {
  const w = [...windows].find(x => x.win.isFocused()) || [...windows][0];
  const detail = (info.permissions.length
    ? 'Die Erweiterung kann:\n' + info.permissions.map(p => '•  ' + p).join('\n')
    : 'Die Erweiterung braucht keine besonderen Berechtigungen.') +
    '\n\nInstalliere nur Erweiterungen, denen du vertraust.';
  const r = await dialog.showMessageBox(w ? w.win : undefined, {
    type: 'question', buttons: ['Erweiterung hinzufügen', 'Abbrechen'], defaultId: 0, cancelId: 1,
    title: 'Erweiterung hinzufügen', message: `„${info.name}“ hinzufügen?`, detail
  });
  return r.response === 0;
}

async function confirmRemoveExtension(w, info) {
  const r = await dialog.showMessageBox(w.win, {
    type: 'question', buttons: ['Entfernen', 'Abbrechen'], defaultId: 1, cancelId: 1,
    message: `„${info.name}“ entfernen?`, detail: 'Die Einstellungen der Erweiterung gehen dabei verloren.'
  });
  if (r.response === 0) await extensions.remove(info.id);
}

async function installFromStore(w, id) {
  try {
    const r = await extensions.installFromStore(id);
    if (r.ok && r.error) {
      dialog.showMessageBox(w.win, { type: 'warning', message: `„${r.name}“ wurde installiert, startet aber nicht.`, detail: r.error });
    }
    return r;
  } catch (e) {
    dialog.showMessageBox(w.win, { type: 'error', message: 'Die Erweiterung konnte nicht installiert werden.', detail: e.message });
    return { error: e.message };
  }
}

// ---------------------------------------------------------------- Tastenkürzel (in jedem Tab und in der Oberfläche)
function attachShortcuts(wc, winOrGetter) {
  const getW = typeof winOrGetter === 'function' ? winOrGetter : () => winOrGetter;
  wc.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    const w = getW();
    const c = i.control || i.meta;
    const k = i.key.toLowerCase();
    const act = w.active && w.active.view.webContents;
    let hit = true;
    if (c && i.shift && k === 'n') new SakuraWindow({ isPrivate: true });
    else if (c && i.shift && k === 't') reopenClosed(w);
    else if (c && k === 't') { w.newTab(NEWTAB); w.ui.webContents.send('focus-address'); }
    else if (c && k === 'n') new SakuraWindow();
    else if (c && k === 'w') w.closeTab(w.activeId);
    else if (c && k === 'tab') w.cycle(i.shift ? -1 : 1);
    else if (c && /^[1-8]$/.test(k)) { const t = w.tabs[Number(k) - 1]; if (t) w.activate(t.id); }
    else if (c && k === '9') w.activate(w.tabs[w.tabs.length - 1].id);
    else if ((c && k === 'l') || (i.alt && k === 'd') || k === 'f6') { w.ui.webContents.focus(); w.ui.webContents.send('focus-address'); }
    else if ((c && k === 'r') || k === 'f5') act && (i.shift ? act.reloadIgnoringCache() : act.reload());
    else if (c && k === 'd') toggleBookmarkActive(w);
    else if (c && k === 'h') w.ui.webContents.send('open-panel', 'history');
    else if (c && i.shift && k === 'o') w.ui.webContents.send('open-panel', 'bookmarks');
    else if (c && i.shift && k === 'b') toggleBar();
    else if (c && k === 'j') w.ui.webContents.send('open-panel', 'downloads');
    else if (c && k === 'f') w.openFind();
    else if (c && i.alt && k === 'p') floating ? unfloat() : floatVideo(w);
    else if (k === 'f9') toggleReader(w);
    else if (c && k === 'p') act && act.print();
    else if (c && k === 's') savePdf(w);
    else if (c && (k === '+' || k === '=')) w.zoom(0.5);
    else if (c && k === '-') w.zoom(-0.5);
    else if (c && k === '0') w.zoom(0);
    else if (i.alt && k === 'arrowleft') act && act.navigationHistory.goBack();
    else if (i.alt && k === 'arrowright') act && act.navigationHistory.goForward();
    else if (c && i.shift && k === 'm') w.toggleMute(w.activeId);
    else if (c && i.shift && k === 'a') { w.ui.webContents.focus(); w.ui.webContents.send('tab-search'); }
    else if (k === 'f11') w.win.setFullScreen(!w.win.isFullScreen());
    else if (k === 'f12' || (c && i.shift && k === 'i')) act && act.toggleDevTools();
    else if (k === 'escape' && i.shift) w.ui.webContents.send('open-panel', 'performance');
    else if (k === 'escape' && w.findOpen) w.closeFind();
    else hit = false;
    if (hit) e.preventDefault();
  });
}

function reopenClosed(w, index) {
  const i = Number.isInteger(index) && index >= 0 && index < closedTabs.length ? index : closedTabs.length - 1;
  const [c] = i >= 0 ? closedTabs.splice(i, 1) : [];
  if (c) w.newTab(c.url);
}

function toggleBookmarkActive(w) {
  const a = w.active;
  if (!a) return;
  const url = w.displayUrl(a.url);
  if (!url) return;
  store.toggleBookmark(url, a.title, a.favicon);
  broadcastState();
}

function broadcastState() { for (const w of windows) w.sendState(); }

function toggleBar() {
  store.setPrefs({ bookmarksBar: !barVisible() });
  for (const w of windows) w.layout();
  broadcastState();
}

/** Favoritenleiste: Lesezeichen ohne Ordner direkt, jeder Ordner als ein Knopf (an der Stelle seines ersten Lesezeichens) */
function barItems() {
  const out = [], seen = new Set();
  for (const b of store.barBookmarks()) {
    if (!b.folder) { out.push({ id: b.id, title: b.title, url: b.url, favicon: b.favicon || null }); continue; }
    const top = b.folder.split(' / ')[0];
    if (seen.has(top)) continue;
    seen.add(top);
    out.push({ id: 'ordner:' + top, folder: top });
    if (out.length >= 100) break;
  }
  return out.slice(0, 100);
}
function folderMenu(w, top) {
  const list = store.barBookmarks().filter(b => b.folder && (b.folder === top || b.folder.startsWith(top + ' / ')));
  if (!list.length) return;
  // Unterordner als Untermenüs
  const build = prefix => {
    const items = [], subs = new Set();
    for (const b of list) {
      if (b.folder === prefix) items.push({ label: (b.title || b.url).slice(0, 60), click: () => w.navigate(b.url) });
      else if (b.folder.startsWith(prefix + ' / ')) subs.add(prefix + ' / ' + b.folder.slice(prefix.length + 3).split(' / ')[0]);
    }
    return [...[...subs].map(sub => ({ label: sub.split(' / ').pop(), submenu: build(sub) })), ...items];
  };
  const mine = list.filter(b => b.folder === top);
  Menu.buildFromTemplate([
    ...build(top),
    { type: 'separator' },
    { label: `Alle ${mine.length} in Tabs öffnen`, enabled: mine.length > 0 && mine.length <= 30, click: () => mine.forEach(b => w.newTab(b.url, { background: true })) }
  ]).popup();
}

function bookmarkMenu(w, id) {
  const b = store.bookmarks().find(x => x.id === id);
  if (!b) return;
  Menu.buildFromTemplate([
    { label: 'Öffnen', click: () => w.navigate(b.url) },
    { label: 'In neuem Tab öffnen', click: () => w.newTab(b.url) },
    { label: 'In neuem Fenster öffnen', click: () => new SakuraWindow({ url: b.url }) },
    { label: 'In privatem Fenster öffnen', click: () => new SakuraWindow({ isPrivate: true, url: b.url }) },
    { type: 'separator' },
    { label: 'Bearbeiten …', click: () => w.ui.webContents.send('edit-bookmark', id) },
    { label: 'Adresse kopieren', click: () => clipboard.writeText(b.url) },
    { label: 'Löschen', click: () => { store.removeBookmark(id); broadcastState(); } },
    { type: 'separator' },
    { label: 'Favoritenleiste ausblenden', click: () => toggleBar() }
  ]).popup();
}
function broadcast(channel, data) { for (const w of windows) if (!w.ui.webContents.isDestroyed()) w.ui.webContents.send(channel, data); }
function winOf(sender) { return [...windows].find(w => w.ui.webContents === sender); }

// ---------------------------------------------------------------- Befehle aus der Oberfläche
const uiCommands = {
  newTab: (w, url) => w.newTab(url || NEWTAB),
  closeTab: (w, id) => w.closeTab(id),
  activate: (w, id) => w.activate(id),
  moveTab: (w, { id, index }) => w.moveTab(id, index),
  tabDragEnd: (w, id) => w.dropTab(id, screen.getCursorScreenPoint()),
  tabToNewWindow: (w, id) => {
    const t = w.tabs.find(x => x.id === id);
    if (!t || t.floating || w.tabs.length < 2) return;
    const wb = w.win.getBounds();
    const moved = w.releaseTab(id);
    if (moved) new SakuraWindow({ isPrivate: w.isPrivate, ses: w.ses, adopt: moved, bounds: { x: wb.x + 40, y: wb.y + 40, width: wb.width, height: wb.height } });
  },
  tabMenu: (w, id) => w.tabMenu(id),
  toggleMute: (w, id) => w.toggleMute(id),
  groupNew: (w, tabId) => w.newGroup(tabId),
  groupAdd: (w, { tabId, groupId }) => w.addToGroup(tabId, groupId),
  groupRemoveTab: (w, tabId) => w.removeFromGroup(tabId),
  groupUpdate: (w, { id, ...patch }) => w.updateGroup(id, patch),
  groupToggle: (w, id) => w.toggleGroup(id),
  groupUngroup: (w, id) => w.ungroup(id),
  groupClose: (w, id) => w.closeGroup(id),
  groupNewTab: (w, id) => {
    const members = w.tabs.filter(t => t.group === id);
    if (!members.length) return;
    w.newTab(NEWTAB, { index: w.tabs.indexOf(members[members.length - 1]) + 1, group: id });
  },
  navigate: (w, input) => w.navigate(input),
  back: w => w.active && w.active.view.webContents.navigationHistory.goBack(),
  forward: w => w.active && w.active.view.webContents.navigationHistory.goForward(),
  reload: w => w.active && w.active.view.webContents.reload(),
  stop: w => w.active && w.active.view.webContents.stop(),
  home: w => w.active && w.active.view.webContents.loadURL(NEWTAB),
  focusPage: w => w.active && w.active.view.webContents.focus(),
  overlay: (w, on) => { w.overlay = !!on; w.layout(); },
  state: w => w.state(),
  toggleBookmark: w => toggleBookmarkActive(w),
  newWindow: () => new SakuraWindow(),
  newPrivateWindow: () => new SakuraWindow({ isPrivate: true }),
  reopenClosed: w => reopenClosed(w),
  find: (w, { text, forward = true, next = false }) => {
    const wc = w.active && w.active.view.webContents;
    if (!wc) return;
    if (!text) { wc.stopFindInPage('clearSelection'); return; }
    wc.findInPage(text, { forward, findNext: next });
  },
  openFind: w => w.openFind(),
  closeFind: w => w.closeFind(),
  zoom: (w, step) => w.zoom(step),
  print: w => w.active && w.active.view.webContents.print(),
  savePdf: w => savePdf(w),
  screenshot: w => screenshot(w),
  screenshotFull: w => screenshot(w, true),
  translate: w => translatePage(w),
  devtools: w => w.active && w.active.view.webContents.toggleDevTools(),
  suggest: (w, q) => store.suggest(q),
  bookmarks: () => store.bookmarks(),
  bmOpen: (w, { url, newTab, background }) => {
    if (!/^(https?|sakura|chrome-extension):/i.test(String(url))) return;
    if (newTab) w.newTab(url, { background: !!background, index: w.tabs.indexOf(w.active) + 1 });
    else w.navigate(url);
  },
  bmMenu: (w, id) => bookmarkMenu(w, id),
  bmFolderMenu: (w, name) => folderMenu(w, String(name || '')),
  bookmarkFolders: () => store.bookmarkFolders(),
  bmMove: (w, { id, index }) => { store.moveBookmark(id, index); broadcastState(); },
  bmOverflow: (w, ids) => {
    const all = store.bookmarks();
    const items = ids.map(id => String(id).startsWith('ordner:') ? { folder: String(id).slice(7) } : all.find(b => b.id === id)).filter(Boolean);
    Menu.buildFromTemplate(items.map(b => b.folder
      ? { label: b.folder, submenu: all.filter(x => x.folder && (x.folder === b.folder || x.folder.startsWith(b.folder + ' / '))).slice(0, 60).map(x => ({ label: (x.title || x.url).slice(0, 60), click: () => w.navigate(x.url) })) }
      : { label: (b.title || b.url).slice(0, 60), click: () => w.navigate(b.url) })).popup();
  },
  toggleBar: () => toggleBar(),
  updateBookmark: (w, { id, patch }) => { store.updateBookmark(id, patch); broadcastState(); },
  removeBookmark: (w, id) => { store.removeBookmark(id); broadcastState(); },
  history: (w, q) => store.history(q || ''),
  removeHistory: (w, id) => store.removeHistory(id),
  clearHistory: async (w, { cookies } = {}) => {
    store.clearHistory();
    await session.defaultSession.clearCache();
    if (cookies) await session.defaultSession.clearStorageData();
  },
  devices: () => store.otherDevices(),
  prefs: () => ({ ...store.prefs(), engines: Object.keys(M.ENGINES), blocklistSize: blocker.size, startTheme, themes: Themes.list }),
  setPrefs: async (w, patch) => {
    if ('theme' in patch && !Themes.list.some(t => t.id === patch.theme)) delete patch.theme;
    if ('accent' in patch && patch.accent !== '' && !Themes.isHex(patch.accent)) delete patch.accent;
    store.setPrefs(patch);
    if ('siteTheme' in patch) applySiteTheme();
    if (patch.adblockExtended) { try { await blocker.refreshExtended(true); } catch (e) { return { error: e.message }; } }
    broadcastState();
    return { ok: true, blocklistSize: blocker.size, restart: (store.prefs().siteTheme === 'force') !== (startTheme === 'force') };
  },
  relaunch: () => { app.relaunch(); app.quit(); },
  updateInfo: () => updater.info(),
  updateCheck: () => updater.check(),
  updateInstall: () => { saveSession(); quitting = true; store.flush(); updater.installNow(); },
  // Passwörter (Verwaltung)
  pwClear: () => { vault.clear(); return true; },
  pwList: () => ({ enabled: store.prefs().passwordManager !== false, available: !!(vault && vault.available), broken: !!(vault && vault.broken), entries: vault && vault.available ? vault.list() : [] }),
  pwReveal: (w, id) => { const e = vault.reveal(String(id)); return e ? e.password : null; },
  pwCopy: (w, id) => {
    const e = vault.reveal(String(id));
    if (!e) return false;
    clipboard.writeText(e.password);
    // nach 30 Sekunden wieder aus der Zwischenablage nehmen
    setTimeout(() => { if (clipboard.readText() === e.password) clipboard.writeText(''); }, 30000);
    return true;
  },
  pwUpdate: (w, { id, patch }) => { try { vault.update(String(id), patch || {}); return { ok: true }; } catch (e) { return { error: e.message }; } },
  pwDelete: (w, id) => { vault.remove(String(id)); return true; },
  pwImport: async w => {
    const r = await dialog.showOpenDialog(w.win, { title: 'Passwort-Export wählen (CSV)', properties: ['openFile'], filters: [{ name: 'CSV-Datei', extensions: ['csv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      if (!vault.available) throw new Error('Sicherer Speicher ist auf diesem System nicht verfügbar.');
      if (fs.statSync(r.filePaths[0]).size > 20 * 1024 * 1024) throw new Error('Die Datei ist zu groß.');
      const rows = Passwords.parsePasswordCsv(fs.readFileSync(r.filePaths[0], 'utf8'));
      const res = vault.importMany(rows);
      const n = x => x === 1 ? 'ein Passwort' : `${x} Passwörter`;
      let msg = res.added || res.updated ? `${n(res.added)} übernommen${res.updated ? `, ${n(res.updated)} aktualisiert` : ''}.` : 'Keine neuen Passwörter gefunden.';
      msg = msg[0].toUpperCase() + msg.slice(1) + ' Lösch die CSV-Datei jetzt – darin stehen deine Passwörter unverschlüsselt.';
      return { ok: true, ...res, message: msg };
    } catch (e) { return { error: e.message }; }
  },
  pwCheck: async () => {
    try {
      const r = await Passwords.checkLeaks(vault, (u, o) => net.fetch(u, o));
      return { ok: true, ...r, message: !r.checked ? 'Noch keine Passwörter gespeichert.' : r.leaked
        ? `${r.leaked === 1 ? 'Ein Passwort taucht' : r.leaked + ' Passwörter tauchen'} in bekannten Datenlecks auf. Ändere ${r.leaked === 1 ? 'es' : 'sie'} am besten bald.`
        : `Alle ${r.checked} Passwörter geprüft – keins taucht in bekannten Datenlecks auf.` };
    } catch (e) { return { error: e.message }; }
  },
  popupOpenLast: w => {
    const t = w.active;
    const last = t && t.popups && t.popups.pop();
    if (last && /^https?:/i.test(last.url)) w.newTab(last.url, { index: w.tabs.indexOf(t) + 1 });
    w.sendState();
  },
  togglePopupAllow: w => {
    const s = w.state();
    if (!s.host) return;
    const list = new Set(store.prefs().popupAllow || []);
    if (list.has(s.host)) list.delete(s.host); else list.add(s.host);
    store.setPrefs({ popupAllow: [...list] });
  },
  toggleCookieAllow: w => {
    const s = w.state();
    if (!s.host) return;
    const list = new Set(store.prefs().cookieAllow || []);
    if (list.has(s.host)) list.delete(s.host); else list.add(s.host);
    store.setPrefs({ cookieAllow: [...list] });
    w.active.view.webContents.reload();
  },
  toggleAllow: w => {
    const s = w.state();
    if (!s.host) return;
    const list = new Set(store.prefs().adblockAllow || []);
    if (list.has(s.host)) list.delete(s.host); else list.add(s.host);
    store.setPrefs({ adblockAllow: [...list] });
    w.active.view.webContents.reload();
  },
  // Skripte
  scripts: () => store.scripts(),
  saveScript: (w, item) => { const r = store.saveScript(item); broadcastState(); return r; },
  setScriptEnabled: (w, { id, enabled }) => { store.setScriptEnabled(id, enabled); broadcastState(); },
  deleteScript: (w, id) => { store.deleteScript(id); broadcastState(); },
  // Erweiterungen
  extensions: () => extensions.list(),
  extPopup: (w, { id, rect }) => w.openPopup(id, rect),
  extMenu: (w, id) => w.extMenu(id),
  extOptions: (w, id) => { const u = extensions.pageUrl(id, 'options'); if (u) w.newTab(u); },
  extSetEnabled: (w, { id, enabled }) => extensions.setEnabled(id, enabled),
  extRemove: (w, id) => { const info = extensions.list().find(x => x.id === id); if (info) return confirmRemoveExtension(w, info); },
  extReload: (w, id) => extensions.reload(id),
  extInstall: (w, id) => installFromStore(w, id),
  extUpdate: () => extensions.checkUpdates(),
  extLoadUnpacked: async w => {
    const r = await dialog.showOpenDialog(w.win, { title: 'Ordner der entpackten Erweiterung wählen', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    try { return await extensions.loadUnpacked(r.filePaths[0]); }
    catch (e) { dialog.showMessageBox(w.win, { type: 'error', message: 'Die Erweiterung konnte nicht geladen werden.', detail: e.message }); return null; }
  },
  openWebstore: w => w.newTab(WEBSTORE),
  // Video und Ton
  mediaState: async w => {
    const t = w.active;
    if (!t) return null;
    const host = hostOfUrl(t.url);
    const info = await mediaCall(t.view.webContents, 'window.__sakuraMedia.info()');
    return { host, ...siteMedia(host), cinema: !!(t.media && t.media.cinema), info, sleep: sleepTimer ? { mode: sleepTimer.mode, until: sleepTimer.until || null, minutes: sleepTimer.minutes || null } : null };
  },
  mediaSet: async (w, patch) => {
    const t = w.active;
    const host = t && hostOfUrl(t.url);
    if (!host) return { error: 'Auf dieser Seite nicht möglich.' };
    const p = cleanMedia(patch || {});
    if ('cinema' in p) { t.media = { ...(t.media || {}), cinema: p.cinema }; delete p.cinema; }
    if (Object.keys(p).length) {
      if (!store.data.mediaSites || typeof store.data.mediaSites !== 'object') store.data.mediaSites = {};
      const next = { ...siteMedia(host), ...p };
      const isDefault = next.brightness === 100 && !next.bass && !next.dialog && next.eq.every(g => !g);
      if (isDefault) delete store.data.mediaSites[host]; else store.data.mediaSites[host] = next;
      store.save();
    }
    return (await applyTabMedia(t)) || { error: 'Auf dieser Seite nicht möglich.' };
  },
  mediaReset: async w => { const t = w.active; const host = t && hostOfUrl(t.url); if (store.data.mediaSites) delete store.data.mediaSites[host]; store.save(); if (t) { t.media = null; await applyTabMedia(t); } return true; },
  sleepSet: (w, opts) => setSleep(w, opts),
  // Schwebendes Video
  floatVideo: w => floatVideo(w),
  unfloat: () => unfloat(),
  floatThrough: () => toggleFloatThrough(),
  itadKey: () => ({ set: !!store.data.itadKey }),
  setItadKey: (w, key) => {
    key = String(key || '').trim();
    if (key && !/^[A-Za-z0-9-]{20,80}$/.test(key)) return { error: 'Das sieht nicht wie ein IsThereAnyDeal-Schlüssel aus.' };
    store.data.itadKey = key || undefined; store.save();
    return { ok: true, set: !!key };
  },
  openMultistream: w => {
    const t = w.active;
    let pre = '';
    try { const u = new URL(t.url); if (/(^|\.)twitch\.tv$/.test(u.hostname)) pre = (u.pathname.split('/').filter(Boolean)[0] || '').toLowerCase(); } catch {}
    w.newTab('sakura://multistream/' + (/^[a-z0-9_]{2,25}$/.test(pre) ? '#' + pre : ''), { index: w.tabs.indexOf(t) + 1 });
  },
  reader: w => toggleReader(w),
  // Gespeicherte Sitzungen: alle Tabs eines Fensters unter einem Namen
  sessions: () => (store.data.savedSessions || []).map(x => ({ id: x.id, name: x.name, at: x.at, count: x.snap.tabs.length, titles: x.snap.tabs.slice(0, 4).map(t => t.title || t.url) })),
  sessionSave: (w, name) => {
    if (w.isPrivate) return { error: 'In privaten Fenstern speichert Sakura keine Sitzungen.' };
    const snap = windowSnapshot(w);
    if (!snap.tabs.length) return { error: 'Keine Tabs zum Speichern.' };
    const d = new Date();
    name = String(name || '').trim().slice(0, 80) || `Sitzung vom ${d.toLocaleDateString('de-DE')}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
    if (!Array.isArray(store.data.savedSessions)) store.data.savedSessions = [];
    store.data.savedSessions.unshift({ id: M.newId(), name, at: Date.now(), snap });
    store.data.savedSessions = store.data.savedSessions.slice(0, 50);
    store.save();
    return { ok: true, name, count: snap.tabs.length };
  },
  sessionOpen: (w, id) => {
    const x = (store.data.savedSessions || []).find(s => s.id === id);
    if (!x) return false;
    new SakuraWindow({ restore: x.snap });
    return true;
  },
  sessionRemove: (w, id) => { store.data.savedSessions = (store.data.savedSessions || []).filter(x => x.id !== id); store.save(); return true; },
  // Notizen zur Seite
  noteGet: w => {
    const a = w.active, url = a ? w.displayUrl(a.url) : '';
    if (w.isPrivate || !noteKey(url)) return null;
    const n = noteFor(url);
    return { text: n ? n.text : '', at: n ? n.at : 0 };
  },
  noteSet: (w, text) => {
    const a = w.active, url = a ? w.displayUrl(a.url) : '', k = noteKey(url);
    if (w.isPrivate || !k) return false;
    text = String(text || '').slice(0, 5000);
    if (!store.data.notes || typeof store.data.notes !== 'object') store.data.notes = {};
    if (text.trim()) store.data.notes[k] = { text, url, title: a.title || url, at: Date.now() };
    else delete store.data.notes[k];
    store.save();
    w.sendState();
    broadcast('notes-changed');
    return true;
  },
  notes: () => Object.entries(store.data.notes || {}).map(([key, n]) => ({ key, url: n.url, title: n.title, text: n.text, at: n.at })).sort((a, b) => b.at - a.at),
  noteRemove: (w, key) => { if (store.data.notes) delete store.data.notes[key]; store.save(); broadcastState(); return true; },
  // Tracker-Übersicht: welche Domains auf dieser Seite blockiert wurden
  shieldDetails: w => {
    const wc = w.active && !w.active.view.webContents.isDestroyed() ? w.active.view.webContents : null;
    return { hosts: wc ? blocker.details(wc.id) : [], total: blocker.total };
  },
  readlistAdd: async w => { const r = await addToReadlist(w); w.ui.webContents.send('toast', r.error || r.message); return r; },
  readlist: () => (store.data.readlist || []).map(({ blocks, ...x }) => ({ ...x, offline: !!(blocks && blocks.length) })),
  readlistOpen: (w, id) => { if (/^[a-z0-9]+$/.test(String(id))) w.newTab('sakura://readlist/#' + id, { index: w.tabs.indexOf(w.active) + 1 }); },
  readlistRemove: (w, id) => { store.data.readlist = (store.data.readlist || []).filter(x => x.id !== id); store.save(); return true; },
  // Einstellungen als eigene Seite
  openSettings: (w, section) => {
    const target = 'sakura://settings/' + (/^[a-z]+$/.test(section || '') ? '#' + section : '');
    const t = w.tabs.find(x => String(x.pending || x.url).startsWith('sakura://settings'));
    if (t) { w.activate(t.id); t.view.webContents.loadURL(target).catch(() => {}); }
    else w.newTab(target, { index: w.tabs.indexOf(w.active) + 1 });
  },
  openPanel: (w, kind) => { if (/^[a-z]+$/.test(String(kind))) { w.ui.webContents.send('open-panel', kind); w.ui.webContents.focus(); } },
  // Streamer-Modus
  streamerToggle: () => {
    const on = streamerActive();
    store.setPrefs({ streamerMode: on ? (streamerApp ? 'off' : 'auto') : 'on' });
    broadcastState();
    return streamerActive();
  },
  // Seitenüberwachung
  watchPage: async w => {
    const r = await watchActive(w);
    dialog.showMessageBox(w.win, { type: r.error ? 'info' : 'none', title: 'Seite überwachen', message: r.error || 'Seite wird überwacht', detail: r.message || '', buttons: ['OK'] });
    return r;
  },
  watches: () => watcher.list(),
  watchRemove: (w, id) => { watcher.remove(String(id)); return watcher.list(); },
  watchCheckNow: async () => { await watcher.checkDue(0, true); return watcher.list(); },
  // Konto-Tabs
  containers: () => [...Array(CONTAINERS)].map((_, k) => ({ n: k + 1, name: containerName(k + 1), color: CONTAINER_COLORS[k] })),
  containerMenu: w => {
    if (w.isPrivate) return;
    Menu.buildFromTemplate([
      { label: 'Neuer Konto-Tab', enabled: false },
      ...[...Array(CONTAINERS)].map((_, k) => ({ label: containerName(k + 1), click: () => uiCommands.newContainerTab(w, k + 1) }))
    ]).popup();
  },
  newContainerTab: (w, n) => { if (!w.isPrivate) w.newTab(NEWTAB, { container: Number(n), index: w.tabs.indexOf(w.active) + 1 }); },
  clearContainer: async (w, n) => {
    n = Number(n);
    if (!(n >= 1 && n <= CONTAINERS)) return false;
    await session.fromPartition('persist:sakura-konto-' + n).clearStorageData().catch(() => {});
    return true;
  },
  // Leistung
  perf: w => perfInfo(w),
  sleepTab: (w, id) => { const f = findTab(id); return f ? f.w.sleepTab(id) : false; },
  autoSleepNow: () => autoSleepTick(),
  sleepBackground: () => { let n = 0; for (const x of windows) for (const t of [...x.tabs]) if (x.sleepTab(t.id)) n++; return n; },
  // Tab-Suche: alle offenen Tabs aller Fenster und die zuletzt geschlossenen
  tabSearch: w => {
    const open = [];
    for (const x of windows) {
      const hide = x.isPrivate && !w.isPrivate; // private Tabs nicht in normalen Fenstern zeigen
      if (hide) continue;
      for (const t of x.tabs) {
        const url = x.displayUrl(t.pending || t.url);
        open.push({ id: t.id, title: t.title || url || 'Neuer Tab', url, here: x === w, active: x.activeId === t.id && x === w, sleeping: !!t.pending, private: x.isPrivate, audible: t.audible });
      }
    }
    const closed = closedTabs.map((c, i) => ({ index: i, title: c.title || c.url, url: c.url })).reverse().slice(0, 10);
    return { open, closed };
  },
  reopenClosedAt: (w, index) => reopenClosed(w, Number(index)),
  focusTab: (w, id) => { const f = findTab(id); if (f) { f.w.activate(id); f.w.win.focus(); } },
  // Downloads
  downloads: () => downloads.list(),
  dlOpen: (w, id) => downloads.open(id),
  dlShow: (w, id) => downloads.show(id),
  dlCancel: (w, id) => downloads.cancel(id),
  dlPause: (w, id) => downloads.pause(id),
  dlRemove: (w, id) => downloads.remove(id),
  dlClear: () => downloads.clear(),
  dlFolder: () => shell.openPath(app.getPath('downloads')),
  // Sync
  syncInfo: () => sync.info(),
  syncLogin: (w, cfg) => sync.login(cfg).catch(e => ({ ...sync.info(), state: 'error', message: e.message })),
  syncLogout: () => { sync.logout(); return sync.info(); },
  syncCreateCode: () => sync.createCode().catch(e => ({ ...sync.info(), state: 'error', message: e.message, failed: true })),
  syncConnectCode: (w, code) => sync.connectCode({ code }).catch(e => ({ ...sync.info(), state: 'error', message: e.message, failed: true })),
  copyText: (w, text) => { clipboard.writeText(String(text || '').slice(0, 200)); return true; },
  syncUnlock: (w, { password, reset }) => sync.unlock({ password, reset }).then(() => sync.info()).catch(e => ({ ...sync.info(), message: e.message, failed: true })),
  syncChangePassword: (w, password) => sync.changePassword(password).then(() => sync.info()).catch(e => ({ ...sync.info(), message: e.message, failed: true })),
  syncNow: () => sync.syncNow(),
  openUrlInNewTab: (w, url) => w.newTab(url),
  openDataFolder: () => shell.openPath(app.getPath('userData')),
  // Import aus anderen Browsern – die Oberfläche bekommt nur Nummern, nie Pfade
  openImport: w => w.ui.webContents.send('open-import'),
  importSources: () => {
    importProfiles = Importer.findProfiles(process.env);
    return importProfiles.map(p => ({ id: p.id, label: p.label, browser: p.browser }));
  },
  importRun: async (w, { id, bookmarks = true, history = true, cookies = false } = {}) => {
    const p = importProfiles.find(x => x.id === String(id));
    if (!p) return { error: 'Dieses Profil wurde nicht gefunden.' };
    if (!bookmarks && !history && !cookies) return { error: 'Wähle aus, was übernommen werden soll.' };
    try {
      const r = Importer.readProfile(p, { bookmarks, history });
      // Cookies zuerst lesen: ist der Browser offen, bricht alles ab, bevor etwas übernommen wurde
      const ck = cookies ? await Importer.readCookies(p) : null;
      const res = {
        bookmarks: bookmarks ? store.importBookmarks(r.bookmarks) : null,
        history: history ? store.importHistory(r.history) : null,
        cookies: ck ? await CookieImport.applyCookies(ck.cookies, session.defaultSession.cookies) : null,
        protectedCookies: ck ? ck.protected : 0
      };
      if (ck) await session.defaultSession.cookies.flushStore().catch(() => {});
      broadcastState();
      return { ok: true, ...res, message: Importer.summary(res, p.browser) };
    } catch (e) { return { error: e.message }; }
  },
  importHtml: async w => {
    const r = await dialog.showOpenDialog(w.win, {
      title: 'Lesezeichen-Datei wählen', properties: ['openFile'],
      filters: [{ name: 'Lesezeichen (HTML)', extensions: ['html', 'htm'] }]
    });
    if (r.canceled || !r.filePaths[0]) return null;
    try {
      const st = fs.statSync(r.filePaths[0]);
      if (st.size > 50 * 1024 * 1024) return { error: 'Die Datei ist zu groß.' };
      const items = Importer.parseBookmarksHtml(fs.readFileSync(r.filePaths[0], 'utf8'));
      if (!items.length) return { error: 'In dieser Datei wurden keine Lesezeichen gefunden.' };
      const n = store.importBookmarks(items);
      broadcastState();
      return { ok: true, bookmarks: n, message: Importer.summary({ bookmarks: n }, 'der Datei') };
    } catch (e) { return { error: 'Die Datei konnte nicht gelesen werden.' }; }
  }
};

// Befehle der Startseite (nur von sakura:// erlaubt)
const pageCommands = {
  shortcuts: () => store.shortcuts(),
  saveShortcut: (wc, item) => {
    const url = M.toUrl(item.url, 'google');
    if (!url || !/^https?:/.test(url) || url.startsWith('https://www.google.com/search?q=')) return { error: 'Bitte eine gültige Adresse eingeben, z. B. youtube.com' };
    store.saveShortcut({ id: item.id, title: String(item.title || '').trim() || new URL(url).hostname.replace(/^www\./, ''), url });
    return store.shortcuts();
  },
  deleteShortcut: (wc, id) => { store.deleteShortcut(id); return store.shortcuts(); },
  orderShortcuts: (wc, ids) => { store.orderShortcuts(ids); return store.shortcuts(); },
  prefs: () => store.prefs(),
  navigate: (wc, input) => {
    const url = M.toUrl(input, store.prefs().searchEngine);
    if (url) wc.loadURL(url);
  },
  suggest: (wc, q) => store.suggest(q, 6),
  builtinBackgrounds: () => builtinBackgrounds(),
  isPrivate: wc => [...windows].some(w => w.isPrivate && w.tabs.some(t => t.view.webContents === wc)),
  platform: () => 'desktop',
  // Leseliste: Offline-Ansicht (nur von sakura://readlist)
  readlistItem: (wc, id, from = {}) => {
    if (!from.top || !/^sakura:\/\/readlist\//.test(from.url || '')) return null;
    return (store.data.readlist || []).find(x => x.id === String(id)) || null;
  },
  readlistMark: (wc, { id, read } = {}, from = {}) => {
    if (!from.top || !/^sakura:\/\/readlist\//.test(from.url || '')) return null;
    const it = (store.data.readlist || []).find(x => x.id === String(id));
    if (it && it.read !== !!read) { it.read = !!read; store.save(); broadcast('readlist-changed'); }
    return true;
  },
  // Multistream: Fenster mit bis zu vier Twitch-Streams (nur von sakura://multistream)
  multistream: (wc, list, from = {}) => {
    if (!from.top || !/^sakura:\/\/multistream\//.test(from.url || '')) return null;
    const ch = (Array.isArray(list) ? list : []).map(x => String(x || '').toLowerCase().trim()).filter(x => /^[a-z0-9_]{2,25}$/.test(x)).slice(0, 4);
    if (!ch.length) return { error: 'Gib mindestens einen Kanalnamen ein, z. B. papaplatte.' };
    openMultistream(ch);
    return { ok: true };
  },
  // Einstellungsseite sakura://settings: nur diese Befehle, nur aus dem obersten Rahmen der Seite selbst
  settings: (wc, { cmd, arg } = {}, from = {}) => {
    if (!from.top || !/^sakura:\/\/settings\//.test(from.url || '') || !SETTINGS_COMMANDS.has(cmd)) return null;
    const w = [...windows].find(x => x.tabs.some(t => t.view.webContents === wc));
    return w ? uiCommands[cmd](w, arg) : null;
  }
};
const SETTINGS_COMMANDS = new Set([
  'prefs', 'setPrefs', 'relaunch', 'clearHistory', 'openDataFolder', 'devices', 'copyText', 'openPanel', 'updateInfo',
  'syncInfo', 'syncLogin', 'syncLogout', 'syncUnlock', 'syncChangePassword', 'syncNow', 'syncCreateCode', 'syncConnectCode',
  'importSources', 'importRun', 'importHtml', 'containers', 'clearContainer', 'itadKey', 'setItadKey'
]);

// ---------------------------------------------------------------- Start
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

function urlsFromArgv(argv) { return argv.filter(a => /^https?:\/\//i.test(a)); }

app.on('second-instance', (e, argv) => {
  const urls = urlsFromArgv(argv);
  const w = [...windows].find(x => !x.isPrivate) || new SakuraWindow();
  for (const u of urls) w.newTab(u);
  if (w.win.isMinimized()) w.win.restore();
  w.win.focus();
});

app.whenReady().then(async () => {
  const userDir = app.getPath('userData');
  applySiteTheme();
  blocker = new AdBlocker({ store, baseDir: path.join(__dirname, 'assets'), userDir });
  blocker.onCount = (() => {
    let t = null;
    return () => { clearTimeout(t); t = setTimeout(broadcastState, 250); };
  })();
  blocker.refreshExtended().catch(() => {});

  favicons = new Favicons({ dir: path.join(userDir, 'Favicons'), store, fetchFn: (u, o) => net.fetch(u, o) });
  downloads = new Downloads({ store, dir: app.getPath('downloads'), shell });
  downloads.on('change', () => { broadcastState(); broadcast('downloads-changed'); });
  downloads.on('started', () => broadcast('download-started'));

  extensions = new Extensions({
    ses: session.defaultSession, store, dir: path.join(userDir, 'Erweiterungen'),
    fetchFn: (u, o) => net.fetch(u, o), confirm: confirmInstall, chromeVersion: process.versions.chrome
  });
  extensions.on('change', () => { broadcastState(); broadcast('extensions-changed'); });

  updater = new Updater({ app, autoUpdater });
  updater.on('change', info => { broadcastState(); broadcast('update-status', info); });
  updater.start();

  sync = new Sync(store);
  sync.tabsProvider = openTabsForSync;
  sync.on('status', s => broadcast('sync-status', s));
  store.on('change', (kind) => {
    if (kind === 'prefs' || kind === 'all') for (const w of windows) { w.layout(); w.applyTheme(); } // Favoritenleiste, Design (auch per Abgleich)
    if (kind !== 'tabs') broadcastState();
  });

  ipcMain.handle('ui', async (e, cmd, arg) => {
    const w = winOf(e.sender);
    const fn = uiCommands[cmd];
    if (!w || !fn) return null;
    return fn(w, arg);
  });
  // Knopf „Zu Sakura hinzufügen“ auf der Web-Store-Seite (preload-page.js)
  ipcMain.handle('webstore', async (e, cmd, id) => {
    let host = '';
    try { host = new URL(e.senderFrame ? e.senderFrame.url : '').hostname; } catch {}
    if (host !== 'chromewebstore.google.com' || !/^[a-p]{32}$/.test(String(id))) return null;
    const w = [...windows].find(x => x.tabs.some(t => t.view.webContents === e.sender));
    if (!w) return null;
    const status = () => ({ installed: extensions.isInstalled(id), busy: extensions.busy.has(id), unavailable: w.isPrivate });
    if (w.isPrivate) return status();
    if (cmd === 'install' && !extensions.isInstalled(id)) await installFromStore(w, id);
    if (cmd === 'remove') {
      const info = extensions.list().find(x => x.id === id);
      if (info) await confirmRemoveExtension(w, info);
    }
    return status();
  });
  // Steam-Infos (preload-page.js → window.sakuraSteam)
  const steam = new Steam((u, o) => net.fetch(u, o));
  ipcMain.handle('steam-info', async (e, appid) => {
    if (!isSteamStore(e.senderFrame ? e.senderFrame.url : '') || store.prefs().steamInfo === false) return null;
    return steam.info(String(appid || ''), store.data.itadKey || '');
  });
  // Emote-Listen für Twitch (preload-page.js → window.sakuraTwitch)
  const emotes = new Emotes((u, o) => net.fetch(u, o));
  ipcMain.handle('twitch-emotes', async (e, login) => {
    if (!isTwitch(e.senderFrame ? e.senderFrame.url : '') || store.prefs().twitchEmotes === false) return {};
    return emotes.forChannel(String(login || ''));
  });
  // Sponsor-Abschnitte für YouTube (preload-page.js → window.sakuraYT)
  const sponsorBlock = new SB.SponsorBlock((u, o) => net.fetch(u, o));
  ipcMain.handle('yt-segments', async (e, id) => {
    if (!SB.isYouTube(e.senderFrame ? e.senderFrame.url : '') || store.prefs().youtube === false || store.prefs().ytSponsor === false) return [];
    return sponsorBlock.segments(id);
  });
  // Lesemodus: Schriftgröße und Farben merken (die Seite meldet sie über preload-page.js)
  ipcMain.on('reader-prefs', (e, d) => {
    let v = null;
    try { v = JSON.parse(String(d || '')); } catch { return; }
    if (!v || typeof v !== 'object') return;
    const patch = {};
    if (Number(v.size) >= 14 && Number(v.size) <= 32) patch.readerSize = Math.round(Number(v.size));
    if (['hell', 'sepia', 'dunkel'].includes(v.theme)) patch.readerTheme = v.theme;
    if (Object.keys(patch).length) store.setPrefs(patch);
  });
  // Passwortmanager: Anmeldung erkannt / Konten anbieten / nach Klick ausfüllen
  ipcMain.on('pw-submit', (e, d) => offerSavePassword(e.sender, e.senderFrame ? e.senderFrame.url : '', d));
  ipcMain.handle('pw-accounts', e => {
    // Im Streamer-Modus keine Benutzernamen unter Anmeldefeldern einblenden
    if (store.prefs().passwordManager === false || store.prefs().passwordFill === false || streamerActive() || !tabOfSender(e.sender)) return [];
    return vault.available ? vault.accountsFor(e.senderFrame ? e.senderFrame.url : '') : [];
  });
  ipcMain.handle('pw-fill', (e, id) => {
    const f = tabOfSender(e.sender);
    // Nur direkt nach einem echten Klick – eine Seite kann Passwörter nicht selbst abrufen
    if (!f || store.prefs().passwordManager === false || !(f.t.lastInput && Date.now() - f.t.lastInput < 3000) || !vault.available) return null;
    const entry = vault.reveal(String(id), e.senderFrame ? e.senderFrame.url : '');
    if (!entry) return null;
    vault.used(entry.id);
    return { username: entry.username, password: entry.password };
  });
  // Popup-Blocker: Was wurde zuletzt angeklickt? (preload-page.js, nur Angaben zum eigenen Klick)
  ipcMain.on('click-intent', (e, d) => {
    if (!d || typeof d !== 'object') return;
    clickIntents.set(e.sender.id, { at: Date.now(), href: typeof d.href === 'string' ? d.href.slice(0, 2000) : null, interactive: !!d.interactive });
  });
  // Videostellen: jede Seite kann nur ihre eigene Adresse lesen und schreiben; privat wird nichts gemerkt
  ipcMain.handle('video-pos', async (e, cmd, arg) => {
    const key = videoKey(e.senderFrame ? e.senderFrame.url : '');
    const w = [...windows].find(x => x.tabs.some(t => t.view.webContents === e.sender));
    if (!key || !w || w.isPrivate || store.prefs().videoResume === false) return null;
    if (cmd === 'get') return store.videoPos(key);
    if (cmd === 'set') store.setVideoPos(key, arg && arg.t, arg && arg.d);
    return null;
  });
  ipcMain.handle('page', async (e, cmd, arg) => {
    const fn = pageCommands[cmd];
    const url = e.senderFrame ? e.senderFrame.url : '';
    if (!fn || !url.startsWith('sakura://')) return null;
    return fn(e.sender, arg, { url, top: !e.senderFrame || !e.senderFrame.parent });
  });

  vault = new Passwords.Vault({ dir: userDir, safeStorage });
  watcher = new Watcher({ store, extract: extractPage });
  watcher.on('change', (w, change) => { watchNotify(w, change); broadcast('watches-changed'); });
  // Alle 10 Minuten nachsehen, welche Seiten wieder dran sind
  const watchTick = () => watcher.checkDue(Number(store.prefs().watchHours) || 3).then(n => { if (n) broadcast('watches-changed'); }).catch(() => {});
  setTimeout(watchTick, 60000);
  setInterval(watchTick, 10 * 60000);

  // Erweiterungen vor den ersten Tabs laden, damit ihre Skripte sofort greifen
  prepareSession(session.defaultSession, false);
  await extensions.init().catch(err => console.error('Erweiterungen:', err));

  const first = urlsFromArgv(process.argv);
  const saved = store.prefs().restoreSession && Array.isArray(store.data.session) ? store.data.session : [];
  if (saved.length) for (const s of saved) new SakuraWindow({ restore: s });
  if (!saved.length || first.length) {
    const w = [...windows][0] || new SakuraWindow({ url: first[0] });
    const rest = saved.length ? first : first.slice(1);
    for (const u of rest) w.newTab(u);
  }

  if (sync.configured) setTimeout(() => sync.syncNow(), 1500);
  setInterval(() => autoSleepTick().catch(() => {}), 30000);

  // Gaming-Modus: läuft ein Spiel, arbeitet Sakura mit niedrigerer Priorität
  gameWatch = new Gaming.GameWatch({
    getPrefs: () => store.prefs(),
    setPriority: low => Gaming.setProcessPriority([process.pid, ...(app.getAppMetrics ? app.getAppMetrics().map(m => m.pid) : [])], low)
  });
  // Streamer-Modus: läuft OBS & Co., werden private Daten unscharf
  gameWatch.onProcs = procs => {
    const name = Gaming.findStreamer(procs);
    if (name !== streamerApp) { streamerApp = name; broadcastState(); }
  };
  gameWatch.on('change', ({ started }) => {
    if (started && store.prefs().gamingSleep !== false) for (const w of windows) for (const t of [...w.tabs]) w.sleepTab(t.id);
    broadcastState();
  });
  if (process.platform === 'win32') gameWatch.start();
  // Einmal pro Woche Erweiterungen aktualisieren
  if (Date.now() - (store.data.extensionsCheckedAt || 0) > 7 * 864e5) {
    setTimeout(() => extensions.checkUpdates().catch(() => {}), 30000);
  }
});

app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch {} });
app.on('before-quit', () => {
  saveSession();
  quitting = true;
  store.flush();
});
app.on('window-all-closed', () => {
  store.flush();
  app.quit();
});
