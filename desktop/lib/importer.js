// Import von Lesezeichen und Verlauf aus anderen Browsern (Chrome, Edge, Brave, Vivaldi, Opera, Firefox)
// und aus HTML-Lesezeichendateien (Netscape-Format, das jeder Browser exportieren kann).
const fs = require('fs');
const path = require('path');
const os = require('os');
const CI = require('./cookie-import');

const HISTORY_DAYS = 90;
const HISTORY_MAX = 3000;
const BOOKMARKS_MAX = 20000;

// Chromium-Browser: Ordner unter %LOCALAPPDATA% mit mehreren Profilen
const CHROMIUM = [
  { key: 'chrome', name: 'Chrome', dir: ['Google', 'Chrome', 'User Data'] },
  { key: 'edge', name: 'Edge', dir: ['Microsoft', 'Edge', 'User Data'] },
  { key: 'brave', name: 'Brave', dir: ['BraveSoftware', 'Brave-Browser', 'User Data'] },
  { key: 'vivaldi', name: 'Vivaldi', dir: ['Vivaldi', 'User Data'] }
];
// Opera: ein Profil direkt unter %APPDATA%
const OPERA = [
  { key: 'opera', name: 'Opera', dir: ['Opera Software', 'Opera Stable'] },
  { key: 'operagx', name: 'Opera GX', dir: ['Opera Software', 'Opera GX Stable'] }
];

const isWeb = u => /^https?:\/\//i.test(String(u || ''));
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

/** Sucht alle Browserprofile auf diesem PC. env = process.env (für Tests austauschbar) */
function findProfiles(env = process.env) {
  const out = [];
  const local = env.LOCALAPPDATA, roaming = env.APPDATA;
  const usable = dir => exists(path.join(dir, 'Bookmarks')) || exists(path.join(dir, 'History'));

  if (local) {
    for (const b of CHROMIUM) {
      const base = path.join(local, ...b.dir);
      if (!exists(base)) continue;
      const info = ((readJson(path.join(base, 'Local State')) || {}).profile || {}).info_cache || {};
      let dirs = Object.keys(info);
      if (!dirs.length) {
        try { dirs = fs.readdirSync(base).filter(d => d === 'Default' || /^Profile \d+$/.test(d)); } catch { dirs = []; }
      }
      const found = dirs.filter(d => usable(path.join(base, d))).sort((a, b) => (a === 'Default' ? -1 : b === 'Default' ? 1 : a.localeCompare(b, 'de', { numeric: true })));
      for (const d of found) {
        const pname = (info[d] && (info[d].name || info[d].gaia_name)) || (d === 'Default' ? 'Standardprofil' : d);
        out.push({ browser: b.name, profile: pname, kind: 'chromium', dir: path.join(base, d), base });
      }
    }
  }
  if (roaming) {
    for (const b of OPERA) {
      const base = path.join(roaming, ...b.dir);
      const dir = usable(base) ? base : usable(path.join(base, 'Default')) ? path.join(base, 'Default') : null;
      if (dir) out.push({ browser: b.name, profile: '', kind: 'chromium', dir, base });
    }
    const ffBase = path.join(roaming, 'Mozilla', 'Firefox');
    for (const p of firefoxProfiles(ffBase)) out.push(p);
  }
  // Mehrere Profile desselben Browsers → Profilname anzeigen
  const count = {};
  for (const p of out) count[p.browser] = (count[p.browser] || 0) + 1;
  return out.map((p, i) => ({ ...p, id: String(i), label: count[p.browser] > 1 && p.profile ? `${p.browser} – ${p.profile}` : p.browser }));
}

function firefoxProfiles(base) {
  let ini;
  try { ini = fs.readFileSync(path.join(base, 'profiles.ini'), 'utf8'); } catch { return []; }
  const sections = [];
  let cur = null;
  for (const raw of ini.split(/\r?\n/)) {
    const line = raw.trim();
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) { cur = { _name: sec[1] }; sections.push(cur); continue; }
    const kv = /^([^=]+)=(.*)$/.exec(line);
    if (kv && cur) cur[kv[1].trim()] = kv[2].trim();
  }
  const out = [];
  const seen = new Set();
  for (const s of sections) {
    if (!/^Profile\d+$/.test(s._name) || !s.Path) continue;
    const dir = s.IsRelative === '0' ? s.Path : path.join(base, ...s.Path.split(/[\\/]/));
    if (seen.has(dir) || !exists(path.join(dir, 'places.sqlite'))) continue;
    seen.add(dir);
    out.push({ browser: 'Firefox', profile: s.Name || path.basename(dir), kind: 'firefox', dir });
  }
  return out;
}

// ------------------------------------------------------------ Chromium
/** Lesezeichen aus der JSON-Datei „Bookmarks“. Favoritenleiste zuerst, Ordner werden flach übernommen. */
function readChromiumBookmarks(file) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return []; }
  const roots = (data && data.roots) || {};
  const out = [];
  const walk = (node, bar) => {
    if (!node || out.length >= BOOKMARKS_MAX) return;
    if (node.type === 'url') { if (isWeb(node.url)) out.push({ title: String(node.name || '').trim() || node.url, url: node.url, bar }); return; }
    for (const c of node.children || []) walk(c, bar);
  };
  walk(roots.bookmark_bar, true);
  for (const [k, v] of Object.entries(roots)) if (k !== 'bookmark_bar' && v && typeof v === 'object') walk(v, false);
  return out;
}

const CHROME_EPOCH_US = 11644473600000000n; // Mikrosekunden von 1601 bis 1970

function readChromiumHistory(file, now = Date.now()) {
  const since = BigInt(now - HISTORY_DAYS * 864e5) * 1000n + CHROME_EPOCH_US;
  // Die Umrechnung passiert in SQLite – die Rohwerte sind zu groß für JavaScript-Zahlen
  return withDatabase(file, db => db.prepare(
    `SELECT url, title, (last_visit_time - ${CHROME_EPOCH_US}) / 1000 AS t FROM urls
     WHERE last_visit_time > ? AND hidden = 0 ORDER BY last_visit_time DESC LIMIT ?`
  ).all(since, HISTORY_MAX * 2)
    .map(r => ({ url: r.url, title: r.title || '', visitedAt: Number(r.t) }))
    .filter(h => isWeb(h.url)).slice(0, HISTORY_MAX));
}

// ------------------------------------------------------------ Firefox
function readFirefoxBookmarks(file) {
  return withDatabase(file, db => {
    const rows = db.prepare(
      'SELECT b.id, b.parent, b.type, b.guid, b.position, b.title, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk'
    ).all();
    const byId = new Map(rows.map(r => [Number(r.id), r]));
    const children = new Map();
    for (const r of rows) {
      const k = Number(r.parent);
      if (!children.has(k)) children.set(k, []);
      children.get(k).push(r);
    }
    for (const list of children.values()) list.sort((a, b) => Number(a.position) - Number(b.position));
    const out = [];
    const walk = (id, bar, depth) => {
      if (depth > 50) return;
      for (const c of children.get(id) || []) {
        if (out.length >= BOOKMARKS_MAX) return;
        if (Number(c.type) === 1) { if (isWeb(c.url)) out.push({ title: String(c.title || '').trim() || c.url, url: c.url, bar }); }
        else if (Number(c.type) === 2) walk(Number(c.id), bar, depth + 1);
      }
    };
    const root = id => [...byId.values()].find(r => r.guid === id);
    const toolbar = root('toolbar_____');
    if (toolbar) walk(Number(toolbar.id), true, 0);
    for (const g of ['menu________', 'unfiled_____', 'mobile______']) {
      const r = root(g);
      if (r) walk(Number(r.id), false, 0);
    }
    return out;
  });
}

function readFirefoxHistory(file, now = Date.now()) {
  const since = (now - HISTORY_DAYS * 864e5) * 1000;
  return withDatabase(file, db => db.prepare(
    'SELECT url, title, last_visit_date AS t FROM moz_places WHERE last_visit_date > ? AND hidden = 0 ORDER BY last_visit_date DESC LIMIT ?'
  ).all(since, HISTORY_MAX * 2)
    .map(r => ({ url: r.url, title: r.title || '', visitedAt: Math.round(Number(r.t) / 1000) }))
    .filter(h => isWeb(h.url)).slice(0, HISTORY_MAX));
}

// ------------------------------------------------------------ SQLite
class LockedError extends Error {}

/** Kopiert die Datenbank (samt -wal/-shm) in einen Temp-Ordner und öffnet die Kopie nur zum Lesen. */
function withDatabase(file, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sakura-import-'));
  const copy = path.join(tmp, path.basename(file));
  try {
    try {
      fs.copyFileSync(file, copy);
      for (const ext of ['-wal', '-shm']) if (exists(file + ext)) fs.copyFileSync(file + ext, copy + ext);
    } catch (e) {
      if (['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw new LockedError('gesperrt');
      throw e;
    }
    const { DatabaseSync } = require('node:sqlite');
    let db;
    try {
      // Nicht readOnly, wenn eine -wal-Datei dabei ist: SQLite muss sie sonst ignorieren und liest alte Daten
      db = new DatabaseSync(copy, { readOnly: !exists(copy + '-wal') });
      return fn(db);
    } catch (e) {
      if (/locked|busy/i.test(e.message)) throw new LockedError('gesperrt');
      throw e;
    } finally {
      try { db && db.close(); } catch {}
    }
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

// ------------------------------------------------------------ HTML-Lesezeichen
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return m; }
    }
    return ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : m;
  });
}

/** Liest eine Lesezeichen-HTML-Datei. Der Ordner „Favoritenleiste“ (PERSONAL_TOOLBAR_FOLDER) kommt in die Leiste. */
function parseBookmarksHtml(html) {
  const out = [];
  const stack = []; // pro offenem <DL>: gehört es zur Favoritenleiste?
  let nextIsBar = false;
  const re = /<(\/?)(dl|h3|a)\b([^>]*)>(?:([^<]*)<\/\2>)?/gi;
  let m;
  while ((m = re.exec(html)) && out.length < BOOKMARKS_MAX) {
    const closing = m[1] === '/', tag = m[2].toLowerCase(), attrs = m[3] || '';
    const inBar = stack.length ? stack[stack.length - 1] : false;
    if (tag === 'dl') {
      if (closing) stack.pop();
      else { stack.push(inBar || nextIsBar); nextIsBar = false; }
    } else if (tag === 'h3' && !closing) {
      nextIsBar = /PERSONAL_TOOLBAR_FOLDER\s*=\s*"?true/i.test(attrs);
    } else if (tag === 'a' && !closing) {
      const href = /\bHREF\s*=\s*"([^"]*)"/i.exec(attrs) || /\bHREF\s*=\s*'([^']*)'/i.exec(attrs);
      const url = href && decode(href[1]).trim();
      if (isWeb(url)) out.push({ title: decode(m[4] || '').trim() || url, url, bar: inBar });
    }
  }
  return out;
}

// ------------------------------------------------------------ Gesamtablauf
/** Liest Lesezeichen und/oder Verlauf eines gefundenen Profils. */
function readProfile(p, { bookmarks = true, history = true } = {}, now = Date.now()) {
  const res = { bookmarks: [], history: [] };
  try {
    if (p.kind === 'chromium') {
      if (bookmarks) res.bookmarks = readChromiumBookmarks(path.join(p.dir, 'Bookmarks'));
      if (history && exists(path.join(p.dir, 'History'))) res.history = readChromiumHistory(path.join(p.dir, 'History'), now);
    } else if (p.kind === 'firefox') {
      const places = path.join(p.dir, 'places.sqlite');
      if (bookmarks) res.bookmarks = readFirefoxBookmarks(places);
      if (history) res.history = readFirefoxHistory(places, now);
    }
  } catch (e) {
    if (e instanceof LockedError) throw new Error(`Schließ ${p.browser} und versuch es noch einmal.`);
    throw new Error(`Die Daten aus ${p.browser} konnten nicht gelesen werden (${e.message}).`);
  }
  return res;
}

/** Cookies eines Profils lesen (async: der Chromium-Schlüssel kommt von Windows) */
async function readCookies(p, opts = {}) {
  try {
    if (p.kind === 'chromium') return await CI.readChromiumCookies(p, withDatabase, opts);
    if (p.kind === 'firefox') return CI.readFirefoxCookies(p, withDatabase, opts);
  } catch (e) {
    if (e instanceof LockedError) throw new Error(`Schließ ${p.browser} und versuch es noch einmal.`);
    throw new Error(`Die Cookies aus ${p.browser} konnten nicht gelesen werden (${e.message}).`);
  }
  return { cookies: [], protected: 0, unreadable: 0 };
}

/** „87 Lesezeichen, 1.240 Verlaufseinträge und 312 Cookies aus Chrome übernommen.“ */
function summary({ bookmarks, history, cookies, protectedCookies }, from) {
  const n = x => x.toLocaleString('de-DE');
  const parts = [];
  if (bookmarks) parts.push(bookmarks === 1 ? 'ein Lesezeichen' : `${n(bookmarks)} Lesezeichen`);
  if (history) parts.push(history === 1 ? 'ein Verlaufseintrag' : `${n(history)} Verlaufseinträge`);
  if (cookies) parts.push(cookies === 1 ? 'ein Cookie' : `${n(cookies)} Cookies`);
  const what = parts.length > 1 ? parts.slice(0, -1).join(', ') + ' und ' + parts[parts.length - 1] : parts[0];
  let text = !parts.length ? `Aus ${from} gab es nichts Neues zu übernehmen.` : `${what} aus ${from} übernommen.`;
  if (protectedCookies) text += ` ${n(protectedCookies)} Cookies schützt ${from} so, dass kein anderes Programm sie lesen kann – auf diesen Seiten meldest du dich in Sakura einmal neu an.`;
  return text[0].toUpperCase() + text.slice(1);
}

module.exports = {
  findProfiles, readProfile, readChromiumBookmarks, readChromiumHistory, readFirefoxBookmarks, readFirefoxHistory,
  parseBookmarksHtml, summary, readCookies, withDatabase, HISTORY_DAYS, HISTORY_MAX
};
