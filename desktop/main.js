// Sakura – Hauptprozess
const {
  app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, session, protocol, Menu, clipboard, net,
  dialog, webContents, shell, nativeTheme, screen, webFrameMain
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
if (startTheme === 'force') app.commandLine.appendSwitch('enable-features', 'WebContentsForceDark');

let blocker, sync, extensions, downloads, updater, favicons;
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
    if (u.pathname === '/themes.js') return net.fetch(pathToFileURL(path.join(__dirname, 'pages', 'themes.js')).toString());
    // Mitgelieferte Hintergrundbilder: sakura://newtab/backgrounds/<datei>
    const bg = /^\/backgrounds\/([^/]+)$/.exec(u.pathname);
    if (bg) {
      const name = decodeURIComponent(bg[1]);
      if (!BG_FILE.test(name)) return new Response('Nicht gefunden', { status: 404 });
      return net.fetch(pathToFileURL(path.join(__dirname, 'backgrounds', name)).toString());
    }
    const name = { newtab: 'newtab.html', error: 'error.html' }[u.hostname];
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
      restore.tabs.forEach((t, i) => this.newTab(t.url, { background: true, lazy: i !== act, title: t.title, pinned: t.pinned, group: t.group ? gid(t.group) : null }));
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
    if (!t) return 'none';
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
      const on = t.id === this.activeId;
      t.view.setVisible(on);
      if (on) t.view.setBounds({ x: 0, y: top, width: w, height: Math.max(0, h - top) });
    }
  }

  newTab(url, { background = false, index, lazy = false, title, pinned = false, group = null } = {}) {
    const id = ++tabCounter;
    const view = new WebContentsView({
      webPreferences: {
        session: this.ses, preload: path.join(__dirname, 'preload-page.js'),
        contextIsolation: true, sandbox: true, spellcheck: true
      }
    });
    // Eigene Sakura-Seiten dunkel, alle anderen Webseiten mit dem üblichen weißen Grund –
    // viele Seiten (z. B. Googles Cookie-Hinweis) setzen keinen eigenen Hintergrund.
    const isPriv = this.isPrivate; // privat bleibt privat, auch in einem anderen Fenster
    const setBg = u => view.setBackgroundColor(String(u || '').startsWith('sakura:') ? (isPriv ? BG.private : theme().colors.yoru) : '#FFFFFF');
    setBg(url || NEWTAB);
    const tab = {
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

    wc.setWindowOpenHandler(({ url: u, disposition }) => {
      const at = tab.w.tabs.indexOf(tab) + 1;
      tab.w.newTab(u, { background: disposition === 'background-tab', index: at, group: tab.group });
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
    wc.on('did-start-loading', () => { tab.loading = true; upd(); });
    wc.on('did-stop-loading', () => { tab.loading = false; upd(); });
    wc.on('did-start-navigation', (d) => {
      if (d.isMainFrame && !d.isSameDocument) { blocker.reset(wc.id); setBg(d.url); }
    });
    wc.on('did-navigate', (e, u) => {
      if (tab.sleeping) return;
      tab.url = u; tab.favicon = null;
      if (!tab.w.isPrivate && !u.startsWith('sakura:')) store.visit(u, wc.getTitle());
      upd();
    });
    wc.on('did-navigate-in-page', (e, u, isMain) => {
      if (!isMain) return;
      tab.url = u;
      if (!tab.w.isPrivate) store.visit(u, wc.getTitle());
      upd();
    });
    wc.on('dom-ready', () => { runCookieReject(wc); runYouTube(wc); runUserScripts(wc); });
    // Zustimmungs-Banner stecken oft in eingebetteten Rahmen
    wc.on('did-frame-finish-load', (e, isMain, pid, rid) => { if (!isMain) runCookieReject(wc, pid, rid); });
    wc.on('did-fail-load', (e, code, desc, failedUrl, isMain) => {
      if (!isMain || code === -3 || failedUrl.startsWith('sakura:')) return; // -3 = abgebrochen
      wc.loadURL('sakura://error/?u=' + encodeURIComponent(failedUrl) + '&d=' + encodeURIComponent(desc) + '&c=' + code);
    });
    wc.on('audio-state-changed', e => { tab.audible = !!e.audible; upd(); });
    wc.on('media-started-playing', () => { tab.audible = true; upd(); });
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
    const [t] = this.tabs.splice(i, 1);
    if (!this.isPrivate && !t.url.startsWith('sakura:')) closedTabs.push(t.url);
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
      cookieAllowed: !!(host && (store.prefs().cookieAllow || []).includes(host)),
      zoom: wc ? Math.round(Math.pow(1.2, wc.getZoomLevel()) * 100) : 100,
      extActions: this.isPrivate ? [] : extensions.actions(),
      downloads: downloads.summary(),
      update: updater ? { state: updater.state.state, version: updater.state.version, percent: updater.state.percent } : null,
      scripts: realUrl ? M.scriptsFor(store.data.scripts, realUrl).length : 0,
      bar: barVisible() ? store.barBookmarks().slice(0, 100).map(b => ({ id: b.id, title: b.title, url: b.url, favicon: b.favicon || null })) : null
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
      { label: 'Duplizieren', click: () => this.newTab(this.displayUrl(t.pending || t.url) || NEWTAB, { index: i + 1 }) },
      { label: 'In neues Fenster verschieben', enabled: this.tabs.length > 1, click: () => uiCommands.tabToNewWindow(this, id) },
      { label: t.pinned ? 'Loslösen' : 'Anheften', click: () => this.togglePin(id) },
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
        { label: 'Als PDF speichern …', click: () => savePdf(this) },
        { label: 'Bildschirmfoto speichern …', click: () => screenshot(this) },
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

async function screenshot(w) {
  const a = w.active;
  if (!a) return;
  const img = await a.view.webContents.capturePage();
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
function saveSession() {
  const snap = [...windows].filter(w => !w.isPrivate && !w.win.isDestroyed()).map(w => ({
    active: Math.max(0, w.tabs.findIndex(t => t.id === w.activeId)),
    tabs: w.tabs.map(t => ({ url: w.displayUrl(t.pending || t.url) || NEWTAB, title: t.title, pinned: t.pinned || undefined, group: t.group || undefined })),
    groups: [...w.groups.values()]
  })).filter(x => x.tabs.length);
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
    else if (c && k === 'p') act && act.print();
    else if (c && k === 's') savePdf(w);
    else if (c && (k === '+' || k === '=')) w.zoom(0.5);
    else if (c && k === '-') w.zoom(-0.5);
    else if (c && k === '0') w.zoom(0);
    else if (i.alt && k === 'arrowleft') act && act.navigationHistory.goBack();
    else if (i.alt && k === 'arrowright') act && act.navigationHistory.goForward();
    else if (c && i.shift && k === 'm') w.toggleMute(w.activeId);
    else if (k === 'f11') w.win.setFullScreen(!w.win.isFullScreen());
    else if (k === 'f12' || (c && i.shift && k === 'i')) act && act.toggleDevTools();
    else if (k === 'escape' && i.shift) w.ui.webContents.send('open-panel', 'performance');
    else if (k === 'escape' && w.findOpen) w.closeFind();
    else hit = false;
    if (hit) e.preventDefault();
  });
}

function reopenClosed(w) {
  const u = closedTabs.pop();
  if (u) w.newTab(u);
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
    if (!t || w.tabs.length < 2) return;
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
  bmMove: (w, { id, index }) => { store.moveBookmark(id, index); broadcastState(); },
  bmOverflow: (w, ids) => {
    const all = store.bookmarks();
    const items = ids.map(id => all.find(b => b.id === id)).filter(Boolean);
    Menu.buildFromTemplate(items.map(b => ({ label: (b.title || b.url).slice(0, 60), click: () => w.navigate(b.url) }))).popup();
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
  // Leistung
  perf: w => perfInfo(w),
  sleepTab: (w, id) => { const f = findTab(id); return f ? f.w.sleepTab(id) : false; },
  autoSleepNow: () => autoSleepTick(),
  sleepBackground: () => { let n = 0; for (const x of windows) for (const t of [...x.tabs]) if (x.sleepTab(t.id)) n++; return n; },
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
  platform: () => 'desktop'
};

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
  // Sponsor-Abschnitte für YouTube (preload-page.js → window.sakuraYT)
  const sponsorBlock = new SB.SponsorBlock((u, o) => net.fetch(u, o));
  ipcMain.handle('yt-segments', async (e, id) => {
    if (!SB.isYouTube(e.senderFrame ? e.senderFrame.url : '') || store.prefs().youtube === false || store.prefs().ytSponsor === false) return [];
    return sponsorBlock.segments(id);
  });
  ipcMain.handle('page', async (e, cmd, arg) => {
    const fn = pageCommands[cmd];
    const url = e.senderFrame ? e.senderFrame.url : '';
    if (!fn || !url.startsWith('sakura://')) return null;
    return fn(e.sender, arg);
  });

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
  // Einmal pro Woche Erweiterungen aktualisieren
  if (Date.now() - (store.data.extensionsCheckedAt || 0) > 7 * 864e5) {
    setTimeout(() => extensions.checkUpdates().catch(() => {}), 30000);
  }
});

app.on('before-quit', () => {
  saveSession();
  quitting = true;
  store.flush();
});
app.on('window-all-closed', () => {
  store.flush();
  app.quit();
});
