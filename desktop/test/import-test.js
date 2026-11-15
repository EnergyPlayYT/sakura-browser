// Import aus anderen Browsern: nachgebaute Profile von Chrome, Edge, Opera und Firefox
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { DatabaseSync } = require('node:sqlite');
const D = path.join(__dirname, '..', 'lib') + '/';
const I = require(D + 'importer');
const Store = require(D + 'store');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'imp'));
const env = { LOCALAPPDATA: path.join(root, 'Local'), APPDATA: path.join(root, 'Roaming') };
const mk = (...p) => { const d = path.join(...p); fs.mkdirSync(d, { recursive: true }); return d; };
const now = Date.now();
const chromeTime = ms => BigInt(ms) * 1000n + 11644473600000000n;

// ---------- Chrome mit zwei Profilen
const chromeBase = mk(env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data');
fs.writeFileSync(path.join(chromeBase, 'Local State'), JSON.stringify({ profile: { info_cache: { Default: { name: 'Ali' }, 'Profile 1': { name: 'Arbeit' } } } }));
const def = mk(chromeBase, 'Default');
fs.writeFileSync(path.join(def, 'Bookmarks'), JSON.stringify({
  roots: {
    bookmark_bar: { type: 'folder', children: [
      { type: 'url', name: 'YouTube', url: 'https://www.youtube.com/' },
      { type: 'folder', name: 'Ordner', children: [{ type: 'url', name: 'Wiki', url: 'https://de.wikipedia.org/' }] },
      { type: 'url', name: 'Skript', url: 'javascript:alert(1)' }
    ] },
    other: { type: 'folder', children: [{ type: 'url', name: 'Andere', url: 'https://example.org/' }, { type: 'url', name: 'Doppelt', url: 'https://www.youtube.com/' }] },
    synced: { type: 'folder', children: [{ type: 'url', name: 'Handy', url: 'https://m.example.com/' }] }
  }
}));
{
  const db = new DatabaseSync(path.join(def, 'History'));
  db.exec('CREATE TABLE urls (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0)');
  const ins = db.prepare('INSERT INTO urls (url, title, last_visit_time) VALUES (?, ?, ?)');
  ins.run('https://github.com/', 'GitHub', chromeTime(now - 3600e3));
  ins.run('https://alt.example/', 'Zu alt', chromeTime(now - 100 * 864e5));
  ins.run('chrome://settings/', 'Einstellungen', chromeTime(now - 60e3));
  ins.run('https://news.example/', 'News', chromeTime(now - 2 * 864e5));
  db.close();
}
mk(chromeBase, 'Profile 1'); fs.writeFileSync(path.join(chromeBase, 'Profile 1', 'Bookmarks'), JSON.stringify({ roots: {} }));
mk(chromeBase, 'System Profile'); // kein echtes Profil

// ---------- Edge ohne Local State
const edgeDef = mk(env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data', 'Default');
fs.writeFileSync(path.join(edgeDef, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Bing', url: 'https://www.bing.com/' }] } } }));

// ---------- Opera GX (Profil direkt im Ordner)
const gx = mk(env.APPDATA, 'Opera Software', 'Opera GX Stable');
fs.writeFileSync(path.join(gx, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { children: [{ type: 'url', name: 'Twitch', url: 'https://www.twitch.tv/' }] } } }));

// ---------- Firefox
const ffBase = mk(env.APPDATA, 'Mozilla', 'Firefox');
const ffProf = mk(ffBase, 'Profiles', 'abcd.default-release');
fs.writeFileSync(path.join(ffBase, 'profiles.ini'), '[General]\r\nStartWithLastProfile=1\r\n\r\n[Profile0]\r\nName=default-release\r\nIsRelative=1\r\nPath=Profiles/abcd.default-release\r\nDefault=1\r\n\r\n[Profile1]\r\nName=leer\r\nIsRelative=1\r\nPath=Profiles/fehlt\r\n');
{
  const db = new DatabaseSync(path.join(ffProf, 'places.sqlite'));
  db.exec('PRAGMA journal_mode=WAL');
  db.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, last_visit_date INTEGER, hidden INTEGER DEFAULT 0);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, guid TEXT)`);
  const pl = db.prepare('INSERT INTO moz_places (id, url, title, last_visit_date) VALUES (?, ?, ?, ?)');
  pl.run(1, 'https://mozilla.org/', 'Mozilla', (now - 5 * 864e5) * 1000);
  pl.run(2, 'https://toolbar.example/', 'Leiste', null);
  pl.run(3, 'place:sort=8', 'Zuletzt', null);
  pl.run(4, 'https://menu.example/', 'Menü', (now - 200 * 864e5) * 1000);
  const bm = db.prepare('INSERT INTO moz_bookmarks (id, type, fk, parent, position, title, guid) VALUES (?, ?, ?, ?, ?, ?, ?)');
  bm.run(1, 2, null, 0, 0, '', 'root________');
  bm.run(2, 2, null, 1, 0, 'menu', 'menu________');
  bm.run(3, 2, null, 1, 1, 'toolbar', 'toolbar_____');
  bm.run(10, 1, 4, 2, 0, 'Menü-Eintrag', 'a1');
  bm.run(11, 1, 2, 3, 1, 'In der Leiste', 'a2');
  bm.run(12, 2, null, 3, 0, 'Unterordner', 'a3');
  bm.run(13, 1, 1, 12, 0, 'Mozilla', 'a4');
  bm.run(14, 1, 3, 3, 2, 'Zuletzt', 'a5');
  // offen lassen: die Daten stehen dann (wie bei laufendem Firefox) noch in der -wal-Datei
  global.ffDb = db;
}

// ---------- Profile finden
const profiles = I.findProfiles(env);
assert.deepEqual(profiles.map(p => p.label), ['Chrome – Ali', 'Chrome – Arbeit', 'Edge', 'Opera GX', 'Firefox']);
assert(profiles.every((p, i) => p.id === String(i)));
assert.deepEqual(I.findProfiles({}), []);

// ---------- Chrome lesen
const chrome = I.readProfile(profiles[0], {}, now);
assert.deepEqual(chrome.bookmarks.map(b => [b.title, b.bar]), [['YouTube', true], ['Wiki', true], ['Andere', false], ['Doppelt', false], ['Handy', false]]);
assert.deepEqual(chrome.history.map(h => h.url), ['https://github.com/', 'https://news.example/']);
assert(Math.abs(chrome.history[0].visitedAt - (now - 3600e3)) < 5, 'Zeit seit 1601 richtig umgerechnet');

// ---------- Firefox lesen (inkl. -wal)
const ff = I.readProfile(profiles[4], {}, now);
assert.deepEqual(ff.bookmarks.map(b => [b.title, b.bar]), [['Mozilla', true], ['In der Leiste', true], ['Menü-Eintrag', false]]);
assert.deepEqual(ff.history.map(h => h.url), ['https://mozilla.org/']);
assert(Math.abs(ff.history[0].visitedAt - (now - 5 * 864e5)) < 5);
global.ffDb.close();

// ---------- In Sakura übernehmen
const s = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'impst')));
s.toggleBookmark('https://example.org/', 'Schon da');
assert.equal(s.importBookmarks(chrome.bookmarks), 3, 'doppelte Adressen werden übersprungen');
const bar = s.barBookmarks().map(b => b.url);
assert.deepEqual(bar, ['https://example.org/', 'https://www.youtube.com/', 'https://de.wikipedia.org/', 'https://m.example.com/']);
assert.equal(s.importBookmarks(chrome.bookmarks), 0, 'zweiter Import ändert nichts');
s.visit('https://github.com/', 'GitHub jetzt');
assert.equal(s.importHistory(chrome.history), 2);
assert.equal(s.history().length, 2);
assert.equal(s.history()[0].title, 'GitHub jetzt', 'neuerer Besuch bleibt erhalten');
assert.equal(I.summary({ bookmarks: 87, history: 1240 }, 'Chrome'), '87 Lesezeichen und 1.240 Verlaufseinträge aus Chrome übernommen.');
assert.equal(I.summary({ bookmarks: 1 }, 'der Datei'), 'Ein Lesezeichen aus der Datei übernommen.');
assert.equal(I.summary({ bookmarks: 0, history: 0 }, 'Edge'), 'Aus Edge gab es nichts Neues zu übernehmen.');

// ---------- Gesperrte Datei → klare Meldung
const locked = { ...profiles[0], dir: path.join(root, 'gesperrt') };
mk(locked.dir); fs.writeFileSync(path.join(locked.dir, 'Bookmarks'), '{}');
fs.writeFileSync(path.join(locked.dir, 'History'), '');
const origCopy = fs.copyFileSync;
fs.copyFileSync = () => { const e = new Error('busy'); e.code = 'EBUSY'; throw e; };
assert.throws(() => I.readProfile(locked, { bookmarks: false }), /Schließ Chrome und versuch es noch einmal\./);
fs.copyFileSync = origCopy;

// ---------- HTML-Lesezeichendatei (Netscape-Format)
const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><H3 ADD_DATE="1" PERSONAL_TOOLBAR_FOLDER="true">Favoritenleiste</H3>
    <DL><p>
        <DT><A HREF="https://a.example/?x=1&amp;y=2" ADD_DATE="1">A &amp; B</A>
        <DT><H3>Unterordner</H3>
        <DL><p>
            <DT><A HREF="https://b.example/">B &#252;ber &#x263A;</A>
        </DL><p>
    </DL><p>
    <DT><H3>Andere</H3>
    <DL><p>
        <DT><A HREF="https://c.example/" ICON="data:image/png;base64,xx">C</A>
        <DT><A HREF="javascript:void(0)">Böse</A>
        <DT><A HREF="https://d.example/"></A>
    </DL><p>
</DL><p>`;
const parsed = I.parseBookmarksHtml(html);
assert.deepEqual(parsed, [
  { title: 'A & B', url: 'https://a.example/?x=1&y=2', bar: true },
  { title: 'B über ☺', url: 'https://b.example/', bar: true },
  { title: 'C', url: 'https://c.example/', bar: false },
  { title: 'https://d.example/', url: 'https://d.example/', bar: false }
]);
console.log('Import aus anderen Browsern bestanden');
