// Lokale Datenablage (JSON-Datei im Benutzerordner der App)
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const os = require('os');
const M = require('./model');

class Store extends EventEmitter {
  constructor(dir) {
    super();
    this.file = path.join(dir, 'sakura-data.json');
    this.data = M.emptyData();
    this.data.sync = null; // nur lokal: { apiKey, projectId, email, uid, refreshToken, lastSync }
    // nur lokal: extensions, downloads, session
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = { ...this.data, ...raw, prefs: { ...M.DEFAULT_PREFS, ...(raw.prefs || {}) } };
    } catch { /* erste Nutzung */ }
    if (!this.data.deviceId) this.data.deviceId = 'pc-' + M.newId();
    if (!Array.isArray(this.data.scripts)) this.data.scripts = [];
    if (!this.data.devices || typeof this.data.devices !== 'object') this.data.devices = {};
    if (!Array.isArray(this.data.extensions)) this.data.extensions = [];
    if (!Array.isArray(this.data.downloads)) this.data.downloads = [];
    // Einmalig: Hintergrundbilder wechseln jetzt standardmäßig jede Minute statt alle 10 Minuten
    // (ohne updatedAt zu ändern, damit neuere Einstellungen anderer Geräte nicht überschrieben werden)
    if (!this.data.bgMinutesMigrated) {
      if (this.data.prefs.bgMinutes === 10) this.data.prefs.bgMinutes = 1;
      this.data.bgMinutesMigrated = true;
    }
    this._timer = null;
  }

  save() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this._timer);
    try {
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) { console.error('Speichern fehlgeschlagen', e); }
  }

  /** synced = true → Änderung soll synchronisiert werden */
  changed(kind, synced = true) {
    this.save();
    this.emit('change', kind, synced);
  }

  // ---------- Lesezeichen ----------
  bookmarks() {
    return this.data.bookmarks.filter(b => !b.deleted).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  findBookmark(url) {
    return this.data.bookmarks.find(b => !b.deleted && b.url === url);
  }
  addBookmark(url, title, favicon) {
    if (!url || this.findBookmark(url)) return;
    const now = Date.now();
    const order = Math.max(-1, ...this.barBookmarks().map(b => b.order)) + 1;
    const icon = typeof favicon === 'string' && /^https?:/.test(favicon) && favicon.length < 500 ? favicon : undefined;
    this.data.bookmarks.push({ id: M.newId(), url, title: title || url, favicon: icon, order, createdAt: now, updatedAt: now });
    this.changed('bookmarks');
  }
  updateBookmark(id, patch) {
    const b = this.data.bookmarks.find(x => x.id === id);
    if (!b) return;
    if (typeof patch.title === 'string') b.title = patch.title.slice(0, 300);
    if (typeof patch.url === 'string' && patch.url.trim()) b.url = patch.url.trim();
    b.updatedAt = Date.now();
    this.changed('bookmarks');
  }
  removeBookmark(id) {
    const b = this.data.bookmarks.find(x => x.id === id);
    if (!b) return;
    b.deleted = true; b.updatedAt = Date.now();
    this.changed('bookmarks');
  }
  /** Reihenfolge für die Favoritenleiste (älteste zuerst, per Ziehen änderbar) */
  barBookmarks() {
    return this.data.bookmarks.filter(b => !b.deleted)
      .map(b => ({ ...b, order: typeof b.order === 'number' ? b.order : (b.createdAt || 0) / 1e13 }))
      .sort((a, b) => a.order - b.order || (a.createdAt || 0) - (b.createdAt || 0));
  }
  moveBookmark(id, toIndex) {
    const list = this.barBookmarks();
    const from = list.findIndex(b => b.id === id);
    if (from < 0) return;
    const [item] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(toIndex, list.length)), 0, item);
    const now = Date.now();
    list.forEach((b, i) => {
      const real = this.data.bookmarks.find(x => x.id === b.id);
      if (real && real.order !== i) { real.order = i; real.updatedAt = now; }
    });
    this.changed('bookmarks');
  }
  /** Übernimmt viele Lesezeichen auf einmal (Import). Leisten-Lesezeichen zuerst, doppelte Adressen werden übersprungen. */
  importBookmarks(items) {
    const have = new Set(this.data.bookmarks.filter(b => !b.deleted).map(b => b.url));
    const list = [...items.filter(i => i.bar), ...items.filter(i => !i.bar)];
    let order = Math.max(-1, ...this.barBookmarks().map(b => b.order)) + 1;
    const now = Date.now();
    let added = 0;
    for (const it of list) {
      const url = String(it.url || '').trim();
      if (!/^https?:\/\//i.test(url) || url.length > 4000 || have.has(url)) continue;
      have.add(url);
      this.data.bookmarks.push({
        id: M.newId(), url, title: String(it.title || url).slice(0, 300), order: order++,
        createdAt: now - added, updatedAt: now
      });
      added++;
    }
    if (added) this.changed('bookmarks');
    return added;
  }
  toggleBookmark(url, title, favicon) {
    const b = this.findBookmark(url);
    if (b) this.removeBookmark(b.id); else this.addBookmark(url, title, favicon);
    return !b;
  }

  // ---------- Schnellzugriffe (Startseite) ----------
  shortcuts() {
    return this.data.shortcuts.filter(s => !s.deleted).sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  saveShortcut(item) {
    const now = Date.now();
    if (item.id) {
      const s = this.data.shortcuts.find(x => x.id === item.id);
      if (s) { s.title = item.title; s.url = item.url; s.updatedAt = now; }
    } else {
      const max = Math.max(0, ...this.shortcuts().map(s => s.order || 0));
      this.data.shortcuts.push({ id: M.newId(), title: item.title, url: item.url, order: max + 1, updatedAt: now });
    }
    this.changed('shortcuts');
  }
  deleteShortcut(id) {
    const s = this.data.shortcuts.find(x => x.id === id);
    if (!s) return;
    s.deleted = true; s.updatedAt = Date.now();
    this.changed('shortcuts');
  }
  orderShortcuts(ids) {
    const now = Date.now();
    ids.forEach((id, i) => {
      const s = this.data.shortcuts.find(x => x.id === id);
      if (s && s.order !== i) { s.order = i; s.updatedAt = now; }
    });
    this.changed('shortcuts');
  }

  // ---------- Verlauf ----------
  visit(url, title) {
    if (!/^https?:/i.test(url)) return;
    const now = Date.now();
    const h = this.data.history.find(x => x.id === url);
    if (h) { h.visitedAt = now; h.updatedAt = now; if (title) h.title = title; h.deleted = false; }
    else this.data.history.push({ id: url, url, title: title || url, visitedAt: now, updatedAt: now });
    if (this.data.history.length > M.HISTORY_LIMIT_LOCAL + 200) {
      this.data.history = M.trimHistory(this.data.history, this.data.historyClearedAt, M.HISTORY_LIMIT_LOCAL);
    }
    this.changed('history');
  }
  /** Übernimmt Verlauf aus einem anderen Browser. Vorhandene Einträge behalten den neueren Besuch. */
  importHistory(items) {
    const byId = new Map(this.data.history.map(h => [h.id, h]));
    const cleared = this.data.historyClearedAt || 0;
    let count = 0;
    for (const it of items) {
      const url = String(it.url || '');
      const at = Number(it.visitedAt) || 0;
      if (!/^https?:\/\//i.test(url) || url.length > 4000 || at <= cleared || at > Date.now() + 864e5) continue;
      const h = byId.get(url);
      if (h) {
        if (h.deleted || at > (h.visitedAt || 0)) {
          Object.assign(h, { visitedAt: Math.max(at, h.deleted ? 0 : h.visitedAt || 0), updatedAt: Date.now(), deleted: false });
          if (it.title && (!h.title || h.title === url)) h.title = String(it.title).slice(0, 300);
        }
      } else {
        const e = { id: url, url, title: String(it.title || url).slice(0, 300), visitedAt: at, updatedAt: at };
        this.data.history.push(e);
        byId.set(url, e);
      }
      count++;
    }
    this.data.history = M.trimHistory(this.data.history, cleared, M.HISTORY_LIMIT_LOCAL);
    if (count) this.changed('history');
    return count;
  }
  updateTitle(url, title) {
    const h = this.data.history.find(x => x.id === url);
    if (h && title && h.title !== title) { h.title = title; this.save(); }
  }
  history(query = '', limit = 300) {
    const q = query.toLowerCase();
    return this.data.history
      .filter(h => !h.deleted && (!q || (h.title || '').toLowerCase().includes(q) || h.url.toLowerCase().includes(q)))
      .sort((a, b) => b.visitedAt - a.visitedAt)
      .slice(0, limit);
  }
  removeHistory(id) {
    const h = this.data.history.find(x => x.id === id);
    if (!h) return;
    h.deleted = true; h.updatedAt = Date.now();
    this.changed('history');
  }
  clearHistory() {
    this.data.historyClearedAt = Date.now();
    this.data.history = [];
    this.changed('history');
  }

  // ---------- Vorschläge für die Adressleiste ----------
  suggest(input, limit = 7) {
    const q = String(input || '').toLowerCase().trim();
    if (!q) return [];
    const out = [];
    const seen = new Set();
    const score = (item, base) => {
      const u = item.url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '');
      const t = (item.title || '').toLowerCase();
      if (u.startsWith(q)) return base + 3;
      if (t.startsWith(q)) return base + 2;
      if (u.includes(q) || t.includes(q)) return base + 1;
      return -1;
    };
    const cands = [];
    for (const b of this.bookmarks()) { const s = score(b, 10); if (s >= 0) cands.push({ s, url: b.url, title: b.title, kind: 'bookmark' }); }
    for (const h of this.history(q, 200)) { const s = score(h, 0) + Math.min(5, (h.visitedAt / 864e5) - (Date.now() / 864e5 - 5)); if (s >= 0) cands.push({ s, url: h.url, title: h.title, kind: 'history' }); }
    cands.sort((a, b) => b.s - a.s);
    for (const c of cands) {
      if (seen.has(c.url)) continue;
      seen.add(c.url); out.push(c);
      if (out.length >= limit) break;
    }
    return out;
  }

  // ---------- Einstellungen ----------
  prefs() { return this.data.prefs; }
  setPrefs(patch) {
    this.data.prefs = { ...this.data.prefs, ...patch, updatedAt: Date.now() };
    this.changed('prefs');
  }

  // ---------- Benutzerskripte ----------
  scripts() {
    return this.data.scripts.filter(s => !s.deleted).sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de'));
  }
  saveScript(item) {
    const now = Date.now();
    const clean = {
      name: String(item.name || '').trim().slice(0, 120) || 'Unbenanntes Skript',
      match: (Array.isArray(item.match) ? item.match : String(item.match || '').split(/\n/)).map(x => String(x).trim()).filter(Boolean).slice(0, 50),
      code: String(item.code || '').slice(0, 200000),
      enabled: item.enabled !== false
    };
    const s = item.id && this.data.scripts.find(x => x.id === item.id);
    if (s) Object.assign(s, clean, { updatedAt: now, deleted: false });
    else this.data.scripts.push({ id: M.newId(), ...clean, createdAt: now, updatedAt: now });
    this.changed('scripts');
    return this.scripts();
  }
  setScriptEnabled(id, on) {
    const s = this.data.scripts.find(x => x.id === id);
    if (!s) return;
    s.enabled = !!on; s.updatedAt = Date.now();
    this.changed('scripts');
  }
  deleteScript(id) {
    const s = this.data.scripts.find(x => x.id === id);
    if (!s) return;
    s.deleted = true; s.updatedAt = Date.now();
    this.changed('scripts');
  }

  // ---------- Geräte ----------
  setDeviceTabs(tabs) {
    this.data.devices[this.data.deviceId] = {
      name: os.hostname() || 'Windows-PC', platform: 'windows',
      tabs: tabs.slice(0, 60), updatedAt: Date.now()
    };
  }
  otherDevices() {
    return Object.entries(this.data.devices)
      .filter(([id]) => id !== this.data.deviceId)
      .map(([id, d]) => ({ id, ...d }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  // ---------- Sync ----------
  syncedPart() {
    const { bookmarks, shortcuts, history, historyClearedAt, scripts, devices, prefs } = this.data;
    return { bookmarks, shortcuts, history, historyClearedAt, scripts, devices, prefs };
  }
  applySynced(merged) {
    Object.assign(this.data, merged);
    this.save();
    this.emit('change', 'all', false);
  }
}

module.exports = Store;
