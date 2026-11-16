// Sync-Code: zwei Geräte gleichen über den echten Dienst-Code (sync-server) ab – Speicher im Arbeitsspeicher nachgebaut
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const SC = require('../lib/synccode');
const Store = require('../lib/store');
const Sync = require('../lib/sync');
const C = require('../lib/crypto');

// Codes
const code = SC.newCode();
assert(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/.test(code), code);
assert.equal(SC.normalize(code.toLowerCase().replace(/-/g, ' ')), code.replace(/-/g, ''));
assert.equal(SC.normalize('OOOOO-IIIII-LLLLL-00000'), '00000111111111100000', 'O→0, I/L→1');
assert.equal(SC.normalize('zu kurz'), null);
const d = SC.derive(code);
assert(/^[0-9a-f]{64}$/.test(d.id) && d.id !== d.write && Buffer.from(d.salt, 'base64').length === 16);
assert.deepEqual(SC.derive(code.toLowerCase()), d, 'gleicher Code → gleiche Werte');
// Fester Prüfwert – muss mit SyncClient.kt (Android) übereinstimmen
const fixed = SC.derive('K7QM4-ZX92A-1VNAB-8P3RT');
assert.equal(fixed.id, require('crypto').createHash('sha256').update('sakura-id:K7QM4ZX92A1VNAB8P3RT').digest('hex'));

(async () => {
  const { handle } = await import(path.join(__dirname, '..', '..', 'sync-server', 'netlify', 'functions', 'sync.mjs'));
  const blobs = new Map();
  const store = { async get(k) { return blobs.has(k) ? JSON.parse(blobs.get(k)) : null; }, async setJSON(k, v) { blobs.set(k, JSON.stringify(v)); }, async delete(k) { blobs.delete(k); } };
  const calls = [];
  global.fetch = async (url, opt = {}) => {
    calls.push(url);
    const m = /^https:\/\/sakura-sync\.netlify\.app\/api\/sync\/([^/?]+)$/.exec(url);
    if (!m) throw new Error('unerwartete Adresse ' + url);
    return handle(new Request(url, { method: opt.method || 'GET', headers: opt.headers, body: opt.body }), m[1], store);
  };
  const mk = () => new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'sc')));
  const pcStore = mk(), phoneStore = mk();
  pcStore.toggleBookmark('https://vom-pc.de/', 'PC');
  phoneStore.toggleBookmark('https://vom-handy.de/', 'Handy');
  const pc = new Sync(pcStore), phone = new Sync(phoneStore);

  const i1 = await pc.createCode();
  assert.equal(i1.state, 'ok', i1.message); assert.equal(i1.mode, 'code'); assert(SC.normalize(i1.code));
  // Server speichert nur Verschlüsseltes, nie den Code
  const saved = [...blobs.values()][0];
  assert(saved.includes('enc1:') && !saved.includes('vom-pc.de') && !saved.includes(i1.code.replace(/-/g, '')));
  assert(!calls.some(u => u.includes(i1.code.replace(/-/g, ''))), 'Code wird nie gesendet');

  const i2 = await phone.connectCode({ code: i1.code.toLowerCase() });
  assert.equal(i2.state, 'ok', i2.message);
  assert.deepEqual(phoneStore.bookmarks().map(b => b.url).sort(), ['https://vom-handy.de/', 'https://vom-pc.de/']);
  await pc.syncNow();
  assert.deepEqual(pcStore.bookmarks().map(b => b.url).sort(), ['https://vom-handy.de/', 'https://vom-pc.de/'], 'beide Geräte haben alles');

  // Falscher Code → leerer Speicher, aber kein Zugriff auf fremde Daten; ungültiger Code → Fehlermeldung
  await assert.rejects(() => phone.connectCode({ code: 'kaputt' }), /Sync-Code stimmt nicht/);
  // Fremder Schreibversuch ohne Berechtigung
  const id = [...blobs.keys()][0];
  const r = await handle(new Request('https://x/api/sync/' + id, { method: 'PUT', headers: { 'x-sakura-write': 'a'.repeat(64) }, body: JSON.stringify({ payload: 'enc1:xx' }) }), id, store);
  assert.equal(r.status, 403);
  const r2 = await handle(new Request('https://x/', { method: 'PUT', headers: { 'x-sakura-write': 'b'.repeat(64) }, body: JSON.stringify({ payload: 'klartext' }) }), 'c'.repeat(64), store);
  assert.equal(r2.status, 400, 'nur verschlüsselte Daten');
  assert.equal((await handle(new Request('https://x/'), '../etc', store)).status, 400);
  // Abmelden
  pc.logout(); assert.equal(pc.info().state, 'off'); assert.equal(pc.info().mode, '');
  clearInterval(pc._interval); clearInterval(phone._interval);
  console.log('Sync-Code ok');
  process.exit(0);
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
