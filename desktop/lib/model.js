// Gemeinsames Datenmodell + Zusammenführung (gleiche Logik wie SyncModel.kt auf Android)

const HISTORY_LIMIT_LOCAL = 3000;
const HISTORY_LIMIT_SYNC = 500;
const TOMBSTONE_DAYS = 60;
const DEVICE_DAYS = 30;

const ENGINES = {
  google: 'https://www.google.com/search?q=%s',
  duckduckgo: 'https://duckduckgo.com/?q=%s',
  ecosia: 'https://www.ecosia.org/search?q=%s',
  startpage: 'https://www.startpage.com/do/search?query=%s',
  bing: 'https://www.bing.com/search?q=%s'
};

const DEFAULT_PREFS = {
  searchEngine: 'google',
  adblock: true,
  adblockExtended: false,
  adblockAllow: [],
  backgrounds: [],
  bgMinutes: 1,
  bgBuiltin: true, // mitgelieferte Hintergrundbilder zeigen
  restoreSession: true,
  siteTheme: 'system', // 'system' | 'dark' | 'force'
  downloadAsk: false,
  cookieReject: true, // Cookie-Banner automatisch ablehnen
  cookieAllow: [],    // Seiten, auf denen Banner nicht abgelehnt werden
  youtube: true,      // YouTube: Werbung überspringen
  ytSponsor: true,    // Sponsor-Abschnitte überspringen (SponsorBlock)
  ytQuality: 'hd1080',
  sleepAfter: 30,     // Hintergrund-Tabs nach so vielen Minuten schlafen legen (0 = nie)
  ramLimit: 0,        // RAM-Grenze für Sakura in MB (0 = keine)
  cpuLimit: 0,        // CPU-Grenze pro Hintergrund-Tab in % (0 = keine)
  videoResume: true,  // Videos dort weiterschauen, wo man war
  skipIntro: true,    // Intro/Rückblick überspringen
  autoNext: true,     // nächste Folge automatisch
  gaming: true,       // Gaming-Modus: Spiele erkennen, Sakura bremst sich
  gamingSleep: true,  // beim Spielstart Hintergrund-Tabs schlafen legen
  gamingExtra: [],    // weitere Spiele (Programmnamen)
  theme: 'sakura', // Design (pages/themes.js)
  accent: '',      // eigene Akzentfarbe (#RRGGBB) oder leer = Farbe des Designs
  updatedAt: 0
};

const DEFAULT_SHORTCUTS = [
  ['YouTube', 'https://www.youtube.com'],
  ['Gmail', 'https://mail.google.com'],
  ['Wikipedia', 'https://de.wikipedia.org'],
  ['GitHub', 'https://github.com'],
  ['Netlify', 'https://app.netlify.com'],
  ['Firebase', 'https://console.firebase.google.com']
];

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyData() {
  const now = Date.now();
  return {
    bookmarks: [],
    shortcuts: DEFAULT_SHORTCUTS.map(([title, url], i) => ({ id: 'd' + i, title, url, order: i, updatedAt: 1 })),
    history: [],
    historyClearedAt: 0,
    scripts: [],
    devices: {},
    prefs: { ...DEFAULT_PREFS, updatedAt: 1 },
    createdAt: now
  };
}

/** Nimmt pro id den neuesten Eintrag. Gelöschte Einträge bleiben als Grabstein, bis sie alt genug sind. */
function mergeList(a = [], b = []) {
  const m = new Map();
  for (const it of [...a, ...b]) {
    if (!it || !it.id) continue;
    const cur = m.get(it.id);
    if (!cur || (it.updatedAt || 0) > (cur.updatedAt || 0)) m.set(it.id, it);
  }
  const cutoff = Date.now() - TOMBSTONE_DAYS * 864e5;
  return [...m.values()].filter(i => !(i.deleted && (i.updatedAt || 0) < cutoff));
}

function trimHistory(list, clearedAt, limit) {
  return list
    .filter(h => (h.visitedAt || 0) > clearedAt)
    .sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0))
    .slice(0, limit);
}

/** Geräte mit ihren offenen Tabs: pro Gerät gewinnt der neueste Stand, alte Geräte fallen raus. */
function mergeDevices(a, b) {
  const out = {};
  const cutoff = Date.now() - DEVICE_DAYS * 864e5;
  for (const src of [a || {}, b || {}]) {
    for (const [id, d] of Object.entries(src)) {
      if (!d || (d.updatedAt || 0) < cutoff) continue;
      if (!out[id] || (d.updatedAt || 0) > (out[id].updatedAt || 0)) out[id] = d;
    }
  }
  return out;
}

/** Führt die synchronisierten Teile von lokal und Server zusammen. */
function mergeData(local, remote) {
  remote = remote || {};
  const clearedAt = Math.max(local.historyClearedAt || 0, remote.historyClearedAt || 0);
  const lp = local.prefs || DEFAULT_PREFS;
  const rp = remote.prefs;
  return {
    bookmarks: mergeList(local.bookmarks, remote.bookmarks),
    shortcuts: mergeList(local.shortcuts, remote.shortcuts),
    history: trimHistory(mergeList(local.history, remote.history), clearedAt, HISTORY_LIMIT_LOCAL),
    historyClearedAt: clearedAt,
    scripts: mergeList(local.scripts, remote.scripts),
    devices: mergeDevices(local.devices, remote.devices),
    prefs: rp && (rp.updatedAt || 0) > (lp.updatedAt || 0) ? { ...DEFAULT_PREFS, ...rp } : { ...DEFAULT_PREFS, ...lp }
  };
}

/** Was tatsächlich hochgeladen wird (Verlauf gekürzt). */
function syncPayload(data) {
  return {
    v: 1,
    bookmarks: data.bookmarks,
    shortcuts: data.shortcuts,
    history: trimHistory(data.history, data.historyClearedAt || 0, HISTORY_LIMIT_SYNC),
    historyClearedAt: data.historyClearedAt || 0,
    scripts: data.scripts || [],
    devices: data.devices || {},
    prefs: data.prefs
  };
}

/** Eingabe aus Adressleiste/Suche → URL */
function toUrl(input, engine) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^(https?|file|sakura|about|view-source|chrome-extension|data):/i.test(s)) return s;
  if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
  if (!/\s/.test(s) && /^[^\s/]+\.[a-z][a-z0-9-]{1,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
  return (ENGINES[engine] || ENGINES.google).replace('%s', encodeURIComponent(s));
}

// Prüft, ob eine Adresse zu einem Muster passt. Erlaubt:
//  - Chrome-Muster:  *://*.youtube.com/*   https://example.com/pfad*
//  - einfache Angaben: youtube.com (inkl. Subdomains), youtube.com/watch
//  - Platzhalter wie bei @include: *://*.google.*/*
//  - <all_urls> oder * für alle Seiten
function matchPattern(pattern, url) {
  const p = String(pattern || '').trim();
  if (!p) return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (p === '<all_urls>' || p === '*') return true;
  const glob = s => new RegExp('^' + s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$', 'i');
  let scheme = '*', host, path;
  const m = p.match(/^(\*|https?):\/\/([^/]+)(\/.*)?$/i);
  if (m) { scheme = m[1].toLowerCase(); host = m[2]; path = m[3] || '/*'; }
  else if (!/^[a-z]+:/i.test(p)) {
    const i = p.indexOf('/');
    host = i < 0 ? p : p.slice(0, i);
    path = i < 0 ? '/*' : p.slice(i) + (p.endsWith('*') ? '' : '*');
    if (!host.includes('*')) host = '*.' + host;
  } else return glob(p).test(url);
  host = host.toLowerCase().replace(/:\d+$/, '');
  // Platzhalter mitten im Host (z. B. google.*) → einfacher Vergleich der ganzen Adresse
  if (host.slice(host.startsWith('*.') ? 2 : 0).includes('*')) return glob(p.includes('://') ? p : '*://' + p).test(url);
  if (scheme !== '*' && u.protocol !== scheme + ':') return false;
  const h = u.hostname.toLowerCase();
  if (host !== '*') {
    if (host.startsWith('*.')) { const base = host.slice(2); if (h !== base && !h.endsWith('.' + base)) return false; }
    else if (h !== host) return false;
  }
  return glob(path).test(u.pathname + u.search);
}

/** Welche Benutzerskripte laufen auf dieser Adresse? */
function scriptsFor(scripts, url) {
  return (scripts || []).filter(s => !s.deleted && s.enabled !== false && (s.match || []).some(p => matchPattern(p, url)));
}

module.exports = {
  ENGINES, DEFAULT_PREFS, newId, emptyData, mergeList, mergeData, mergeDevices, syncPayload, toUrl, trimHistory,
  matchPattern, scriptsFor, HISTORY_LIMIT_LOCAL
};
