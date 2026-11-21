// Werbe- und Trackerblocker auf Domain-Ebene
const fs = require('fs');
const path = require('path');

const EXTENDED_URL = 'https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts';

function parseList(text, set) {
  for (let line of text.split(/\r?\n/)) {
    line = line.replace(/#.*$/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const dom = (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();
    if (dom && dom.includes('.') && dom !== 'localhost' && dom !== '0.0.0.0') set.add(dom);
  }
}

class AdBlocker {
  constructor({ store, baseDir, userDir }) {
    this.store = store;
    this.userDir = userDir;
    this.base = new Set();
    this.extended = new Set();
    this.counts = new Map(); // webContentsId → Anzahl
    this.hosts = new Map();  // webContentsId → Map(Domain → Anzahl) für die Tracker-Übersicht
    this.total = Number(store.data && store.data.blockedTotal) || 0; // insgesamt, bleibt erhalten
    this.onCount = () => {};
    this.phish = null; this.onPhish = () => {}; // Phishing-Schutz (lib/phishing.js)
    parseList(fs.readFileSync(path.join(baseDir, 'blocklist.txt'), 'utf8'), this.base);
    // Eigene Ergänzungen: %APPDATA%/Sakura/eigene-filter.txt
    try { parseList(fs.readFileSync(path.join(userDir, 'eigene-filter.txt'), 'utf8'), this.base); } catch {}
    this.extendedFile = path.join(userDir, 'filter-erweitert.txt');
    try { parseList(fs.readFileSync(this.extendedFile, 'utf8'), this.extended); } catch {}
  }

  /** Lädt die große Liste (ca. 80.000 Domains) herunter; einmal pro Woche. */
  async refreshExtended(force = false) {
    if (!this.store.prefs().adblockExtended) return;
    try {
      const st = fs.statSync(this.extendedFile);
      if (!force && Date.now() - st.mtimeMs < 7 * 864e5 && this.extended.size) return;
    } catch {}
    const res = await fetch(EXTENDED_URL);
    if (!res.ok) throw new Error('Filterliste nicht erreichbar (' + res.status + ')');
    const text = await res.text();
    const set = new Set();
    parseList(text, set);
    this.extended = set;
    fs.writeFileSync(this.extendedFile, text);
  }

  get size() { return this.base.size + (this.store.prefs().adblockExtended ? this.extended.size : 0); }

  isBlocked(host) {
    const ext = this.store.prefs().adblockExtended;
    let h = host.toLowerCase();
    while (h.includes('.')) {
      if (this.base.has(h) || (ext && this.extended.has(h))) return true;
      h = h.slice(h.indexOf('.') + 1);
    }
    return false;
  }

  attach(ses, getPageUrl) {
    ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
      const p = this.store.prefs();
      if (d.resourceType === 'mainFrame') {
        // Betrugsseiten: Laden abbrechen, Sakura zeigt dann die Warnseite
        if (this.phish && p.phishWarn !== false) {
          let h = '';
          try { h = new URL(d.url).hostname; } catch {}
          if (h && this.phish.isPhishing(h)) { this.onPhish(d.webContentsId, d.url); return cb({ cancel: true }); }
        }
        return cb({});
      }
      if (!p.adblock) return cb({});
      let host;
      try { host = new URL(d.url).hostname; } catch { return cb({}); }
      if (!this.isBlocked(host)) return cb({});
      const page = getPageUrl(d.webContentsId);
      if (page) {
        try {
          const ph = new URL(page).hostname.replace(/^www\./, '');
          if ((p.adblockAllow || []).includes(ph)) return cb({});
        } catch {}
      }
      if (d.webContentsId) {
        this.counts.set(d.webContentsId, (this.counts.get(d.webContentsId) || 0) + 1);
        let hm = this.hosts.get(d.webContentsId);
        if (!hm) this.hosts.set(d.webContentsId, hm = new Map());
        if (hm.size < 500 || hm.has(host)) hm.set(host, (hm.get(host) || 0) + 1);
        this.onCount(d.webContentsId);
      }
      this.total++;
      if (this.store.data) this.store.data.blockedTotal = this.total;
      cb({ cancel: true });
    });
  }

  reset(id) { this.counts.set(id, 0); this.hosts.delete(id); }
  forget(id) { this.counts.delete(id); this.hosts.delete(id); }
  /** Blockierte Domains einer Seite, häufigste zuerst */
  details(id, max = 12) {
    const hm = this.hosts.get(id);
    return hm ? [...hm].sort((a, b) => b[1] - a[1]).slice(0, max).map(([host, n]) => ({ host, n })) : [];
  }
  count(id) { return this.counts.get(id) || 0; }
}

module.exports = AdBlocker;
