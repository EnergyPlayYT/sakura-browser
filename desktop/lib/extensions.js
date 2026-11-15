// Chrome-Erweiterungen: Installation aus dem Chrome Web Store, Verwaltung, Updates
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { extractCrx, compareVersions } = require('./crx');

const STORE_RE = /^https:\/\/(?:chromewebstore\.google\.com\/detail\/(?:[^/?#]+\/)?|chrome\.google\.com\/webstore\/detail\/(?:[^/?#]+\/)?)([a-p]{32})(?:[/?#]|$)/;

const PERMISSION_TEXT = {
  tabs: 'Deinen Browserverlauf lesen',
  history: 'Deinen Browserverlauf lesen und ändern',
  bookmarks: 'Deine Lesezeichen lesen und ändern',
  cookies: 'Cookies lesen und ändern',
  downloads: 'Deine Downloads verwalten',
  clipboardRead: 'Daten aus der Zwischenablage lesen',
  clipboardWrite: 'Daten in die Zwischenablage schreiben',
  notifications: 'Benachrichtigungen anzeigen',
  geolocation: 'Deinen Standort ermitteln',
  management: 'Deine anderen Erweiterungen verwalten',
  proxy: 'Deine Netzwerkverbindung umleiten',
  privacy: 'Datenschutzeinstellungen ändern',
  webRequest: 'Netzwerkanfragen mitlesen',
  declarativeNetRequest: 'Inhalte auf Webseiten blockieren',
  nativeMessaging: 'Mit anderen Programmen auf dem PC kommunizieren',
  debugger: 'Webseiten untersuchen und steuern',
  topSites: 'Deine meistbesuchten Seiten lesen'
};

function webstoreIdFromUrl(url) {
  const m = STORE_RE.exec(String(url || ''));
  return m ? m[1] : null;
}

function crxUrl(id, chromeVersion) {
  return 'https://clients2.google.com/service/update2/crx?response=redirect&acceptformat=crx2,crx3' +
    `&prodversion=${encodeURIComponent(chromeVersion)}&x=id%3D${id}%26installsource%3Dondemand%26uc`;
}

/** __MSG_name__ → übersetzter Text (bevorzugt Deutsch) */
function localize(dir, manifest, text) {
  const m = /^__MSG_(.+)__$/.exec(String(text || ''));
  if (!m) return text || '';
  const key = m[1].toLowerCase();
  for (const lang of ['de', manifest.default_locale, 'en', 'en_US']) {
    if (!lang) continue;
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(dir, '_locales', lang, 'messages.json'), 'utf8').replace(/^﻿/, ''));
      for (const [k, v] of Object.entries(msgs)) if (k.toLowerCase() === key && v && v.message) return v.message;
    } catch {}
  }
  return text;
}

function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8').replace(/^﻿/, ''));
}

function describe(dir) {
  const mf = readManifest(dir);
  const action = mf.action || mf.browser_action || mf.page_action || null;
  const pickIcon = icons => {
    if (!icons) return null;
    if (typeof icons === 'string') return icons;
    const sizes = Object.keys(icons).map(Number).sort((a, b) => a - b);
    const best = sizes.find(s => s >= 32) || sizes[sizes.length - 1];
    return best ? icons[best] : null;
  };
  const iconPath = pickIcon(action && action.default_icon) || pickIcon(mf.icons);
  let icon = null;
  if (iconPath) {
    try {
      const file = path.join(dir, iconPath.replace(/^\//, ''));
      const ext = path.extname(file).slice(1).toLowerCase();
      const mime = ext === 'svg' ? 'image/svg+xml' : 'image/' + (ext === 'jpg' ? 'jpeg' : ext || 'png');
      icon = `data:${mime};base64,` + fs.readFileSync(file).toString('base64');
    } catch {}
  }
  return {
    name: localize(dir, mf, mf.name),
    description: localize(dir, mf, mf.description),
    version: mf.version,
    manifestVersion: mf.manifest_version,
    icon,
    popup: action && action.default_popup ? String(action.default_popup).replace(/^\//, '') : null,
    hasAction: !!action,
    options: (mf.options_ui && mf.options_ui.page) || mf.options_page || null,
    permissions: permissionList(mf)
  };
}

function permissionList(mf) {
  const out = new Set();
  const hosts = [
    ...(mf.host_permissions || []),
    ...(mf.permissions || []).filter(p => typeof p === 'string' && (p.includes('://') || p === '<all_urls>')),
    ...((mf.content_scripts || []).flatMap(c => c.matches || []))
  ];
  if (hosts.some(h => h === '<all_urls>' || /^(\*|https?):\/\/\*\//.test(h))) out.add('Alle Daten auf allen Websites lesen und ändern');
  else if (hosts.length) {
    const names = [...new Set(hosts.map(h => h.replace(/^[^:]+:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')))];
    out.add('Daten auf ' + (names.length > 3 ? names.length + ' Websites' : names.join(', ')) + ' lesen und ändern');
  }
  for (const p of mf.permissions || []) if (PERMISSION_TEXT[p]) out.add(PERMISSION_TEXT[p]);
  return [...out];
}

class Extensions extends EventEmitter {
  /**
   * @param ses       Electron-Sitzung (muss dauerhaft sein, nicht privat)
   * @param store     Datenablage (store.data.extensions = [{ id, path, enabled, source }])
   * @param dir       Ordner für installierte Erweiterungen
   * @param fetchFn   Download-Funktion (net.fetch)
   * @param confirm   async (info) → true/false, fragt vor der Installation
   * @param chromeVersion  z. B. process.versions.chrome
   */
  constructor({ ses, store, dir, fetchFn, confirm, chromeVersion }) {
    super();
    this.ses = ses;
    this.api = ses.extensions || ses; // Electron ≥ 36: ses.extensions
    this.store = store;
    this.dir = dir;
    this.fetch = fetchFn;
    this.confirm = confirm;
    this.chromeVersion = chromeVersion || '140.0.0.0';
    this.loaded = new Map(); // id → Electron-Extension
    this.errors = new Map(); // id → Fehlermeldung
    this.busy = new Set();
  }

  get entries() { return this.store.data.extensions; }
  entry(id) { return this.entries.find(e => e.id === id); }

  async init() {
    fs.mkdirSync(this.dir, { recursive: true });
    for (const e of this.entries) if (e.enabled) await this._load(e);
    this.emit('change');
  }

  async _load(e) {
    try {
      const ext = await this.api.loadExtension(e.path, { allowFileAccess: true });
      // Bei entpackten Erweiterungen ohne Schlüssel vergibt Electron die ID selbst
      if (ext.id !== e.id) {
        this.loaded.delete(e.id);
        e.id = ext.id;
      }
      this.loaded.set(ext.id, ext);
      this.errors.delete(e.id);
      return ext;
    } catch (err) {
      this.errors.set(e.id, String(err.message || err).replace(/^Error:\s*/, ''));
      return null;
    }
  }

  _unload(id) {
    if (!this.loaded.has(id)) return;
    try { this.api.removeExtension(id); } catch {}
    this.loaded.delete(id);
  }

  list() {
    return this.entries.map(e => {
      let info = {};
      try { info = describe(e.path); } catch { info = { name: e.name || e.id, permissions: [] }; }
      return {
        id: e.id, source: e.source, enabled: !!e.enabled, running: this.loaded.has(e.id),
        error: this.errors.get(e.id) || null, busy: this.busy.has(e.id), ...info
      };
    }).sort((a, b) => String(a.name).localeCompare(String(b.name), 'de'));
  }

  /** Für die Werkzeugleiste: nur laufende Erweiterungen mit Symbol */
  actions() {
    return this.list().filter(x => x.running && x.hasAction).map(x => ({ id: x.id, name: x.name, icon: x.icon, popup: !!x.popup }));
  }

  isInstalled(id) { return !!this.entry(id); }

  async _download(id) {
    const res = await this.fetch(crxUrl(id, this.chromeVersion));
    if (!res.ok) throw new Error(res.status === 204 || res.status === 404
      ? 'Diese Erweiterung gibt es im Chrome Web Store nicht (mehr).'
      : 'Download fehlgeschlagen (Fehler ' + res.status + ').');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) throw new Error('Diese Erweiterung kann nicht heruntergeladen werden (eventuell kostenpflichtig oder in deinem Land nicht verfügbar).');
    return buf;
  }

  _unpack(buf, id) {
    const tmp = path.join(this.dir, '_tmp-' + id + '-' + Date.now());
    try {
      const r = extractCrx(buf, tmp);
      if (r.id && r.id !== id) throw new Error('Die heruntergeladene Datei passt nicht zur Erweiterung.');
      return { tmp, manifest: r.manifest };
    } catch (e) {
      fs.rmSync(tmp, { recursive: true, force: true });
      throw e;
    }
  }

  _place(id, tmp, version) {
    const base = path.join(this.dir, id);
    fs.mkdirSync(base, { recursive: true });
    let target = path.join(base, String(version || '0'));
    if (fs.existsSync(target)) target += '_' + Date.now().toString(36);
    fs.renameSync(tmp, target);
    return target;
  }

  _cleanup(id, keep) {
    const base = path.join(this.dir, id);
    try {
      for (const d of fs.readdirSync(base)) {
        const full = path.join(base, d);
        if (full !== keep) { try { fs.rmSync(full, { recursive: true, force: true }); } catch {} }
      }
    } catch {}
  }

  /** Installiert eine Erweiterung aus dem Chrome Web Store */
  async installFromStore(id) {
    if (!/^[a-p]{32}$/.test(id)) throw new Error('Ungültige Erweiterungs-ID.');
    if (this.isInstalled(id)) return { already: true };
    if (this.busy.has(id)) return { busy: true };
    this.busy.add(id);
    this.emit('change');
    let tmp;
    try {
      const buf = await this._download(id);
      const u = this._unpack(buf, id);
      tmp = u.tmp;
      const info = describe(tmp);
      if (!(await this.confirm(info))) return { cancelled: true };
      const target = this._place(id, tmp, info.version);
      tmp = null;
      const e = { id, path: target, enabled: true, source: 'webstore', installedAt: Date.now() };
      this.entries.push(e);
      await this._load(e);
      this.store.save();
      return { ok: true, name: info.name, error: this.errors.get(e.id) || null };
    } finally {
      if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      this.busy.delete(id);
      this.emit('change');
    }
  }

  /** Lädt einen entpackten Erweiterungsordner (für Entwickler oder heruntergeladene Zip-Dateien) */
  async loadUnpacked(dir) {
    if (!fs.existsSync(path.join(dir, 'manifest.json'))) throw new Error('In diesem Ordner liegt keine manifest.json.');
    const info = describe(dir);
    if (!(await this.confirm(info))) return { cancelled: true };
    const known = this.entries.find(e => path.resolve(e.path) === path.resolve(dir));
    if (known) { known.enabled = true; this._unload(known.id); await this._load(known); }
    else {
      const e = { id: 'unpacked-' + Date.now(), path: dir, enabled: true, source: 'unpacked', installedAt: Date.now() };
      this.entries.push(e);
      await this._load(e);
    }
    this.store.save();
    this.emit('change');
    return { ok: true, name: info.name };
  }

  async setEnabled(id, on) {
    const e = this.entry(id);
    if (!e) return;
    e.enabled = !!on;
    if (on) await this._load(e); else { this._unload(id); this.errors.delete(id); }
    this.store.save();
    this.emit('change');
  }

  async remove(id) {
    const e = this.entry(id);
    if (!e) return;
    this._unload(id);
    this.store.data.extensions = this.entries.filter(x => x !== e);
    if (e.source === 'webstore') {
      // Dateien können unter Windows kurz gesperrt sein → später erneut versuchen
      const base = path.join(this.dir, id);
      const tryRemove = (n = 0) => {
        try { fs.rmSync(base, { recursive: true, force: true }); } catch { if (n < 5) setTimeout(() => tryRemove(n + 1), 1500); }
      };
      tryRemove();
    }
    this.store.save();
    this.emit('change');
  }

  async reload(id) {
    const e = this.entry(id);
    if (!e || !e.enabled) return;
    this._unload(id);
    await this._load(e);
    this.emit('change');
  }

  /** Sucht für alle Web-Store-Erweiterungen nach neuen Versionen. Gibt die Namen der aktualisierten zurück. */
  async checkUpdates() {
    const updated = [], failed = [];
    for (const e of this.entries.filter(x => x.source === 'webstore')) {
      let tmp;
      try {
        const current = readManifest(e.path).version;
        const buf = await this._download(e.id);
        const u = this._unpack(buf, e.id);
        tmp = u.tmp;
        if (compareVersions(u.manifest.version, current) <= 0) continue;
        const target = this._place(e.id, tmp, u.manifest.version);
        tmp = null;
        this._unload(e.id);
        e.path = target;
        if (e.enabled) await this._load(e);
        this._cleanup(e.id, target);
        updated.push(describe(target).name);
      } catch (err) {
        failed.push(e.id);
      } finally {
        if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
      }
    }
    this.store.data.extensionsCheckedAt = Date.now();
    this.store.save();
    this.emit('change');
    return { updated, failed: failed.length };
  }

  /** Adresse des Popups bzw. der Optionsseite */
  pageUrl(id, kind) {
    const ext = this.loaded.get(id);
    if (!ext) return null;
    const info = describe(ext.path);
    const p = kind === 'options' ? info.options : info.popup;
    return p ? `chrome-extension://${ext.id}/${p}` : null;
  }
}

module.exports = { Extensions, webstoreIdFromUrl, describe, permissionList, crxUrl };
