// Cookies aus anderen Browsern: Chromium (AES-GCM, Schlüssel über DPAPI) und Firefox
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const CI = require('../lib/cookie-import');
const I = require('../lib/importer');

const now = Date.now(), nowS = Math.floor(now / 1000);
const KEY = crypto.randomBytes(32);
const fakeDpapi = async b => { assert.equal(b.toString(), 'geschützt'); return KEY; }; // „Windows“ gibt den Schlüssel zurück
const enc = (text, domain, ver = 'v10') => {
  const nonce = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, nonce);
  const plain = Buffer.concat([domain ? crypto.createHash('sha256').update(domain).digest() : Buffer.alloc(0), Buffer.from(text)]);
  const data = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from(ver), nonce, data, c.getAuthTag()]);
};
const chromeTime = s => BigInt(s + 11644473600) * 1000000n;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ck'));
const base = path.join(root, 'User Data'), prof = path.join(base, 'Default');
fs.mkdirSync(path.join(prof, 'Network'), { recursive: true });
fs.writeFileSync(path.join(base, 'Local State'), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from('geschützt')]).toString('base64') } }));
{
  const db = new DatabaseSync(path.join(prof, 'Network', 'Cookies'));
  db.exec(`CREATE TABLE meta (key TEXT, value TEXT); INSERT INTO meta VALUES ('version', '24');
    CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER)`);
  const ins = db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('.google.com', 'SID', '', enc('geheim123', '.google.com'), '/', chromeTime(nowS + 86400), 1, 1, 0);
  ins.run('github.com', 'user_session', '', enc('abc', 'github.com'), '/', 0, 1, 1, 1);
  ins.run('.youtube.com', 'LOGIN', '', enc('x', '', 'v20'), '/', chromeTime(nowS + 86400), 1, 1, 0);
  ins.run('alt.de', 'weg', '', enc('x', 'alt.de'), '/', chromeTime(nowS - 10), 0, 0, -1);
  ins.run('klar.de', 'plain', 'offen', Buffer.alloc(0), '/a', chromeTime(nowS + 99), 0, 0, -1);
  db.close();
}
const ffDir = path.join(root, 'ff');
fs.mkdirSync(ffDir);
{
  const db = new DatabaseSync(path.join(ffDir, 'cookies.sqlite'));
  db.exec('CREATE TABLE moz_cookies (host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER)');
  const ins = db.prepare('INSERT INTO moz_cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  ins.run('.mozilla.org', 'a', '1', '/', nowS + 1000, 1, 0, 1);
  ins.run('ms.de', 'b', '2', '/', (nowS + 1000) * 1000, 0, 0, 0); // Millisekunden
  ins.run('alt.de', 'c', '3', '/', nowS - 5, 0, 0, 0);
  db.close();
}

(async () => {
  const ch = await CI.readChromiumCookies({ dir: prof, base }, I.withDatabase, { now, unprotect: fakeDpapi });
  assert.deepEqual(ch.cookies.map(c => [c.domain, c.name, c.value]), [['.google.com', 'SID', 'geheim123'], ['github.com', 'user_session', 'abc'], ['klar.de', 'plain', 'offen']]);
  assert.equal(ch.protected, 1, 'v20-Cookie gezählt und übersprungen');
  assert.equal(ch.cookies[1].expires, null, 'Sitzungs-Cookie');
  assert(Math.abs(ch.cookies[0].expires - (nowS + 86400)) < 2);
  // Ohne Windows-Schlüssel: verschlüsselte Werte sind nicht lesbar, Klartext schon
  const nokey = await CI.readChromiumCookies({ dir: prof, base }, I.withDatabase, { now, unprotect: async () => { throw new Error('x'); } });
  assert.equal(nokey.cookies.length, 1); assert.equal(nokey.unreadable, 2);

  const ff = CI.readFirefoxCookies({ dir: ffDir }, I.withDatabase, { now });
  assert.deepEqual(ff.cookies.map(c => c.name), ['a', 'b']);
  assert(Math.abs(ff.cookies[1].expires - (nowS + 1000)) < 2, 'Millisekunden erkannt');

  assert.deepEqual(CI.toElectron(ch.cookies[0]), { url: 'https://google.com/', name: 'SID', value: 'geheim123', path: '/', secure: true, httpOnly: true, sameSite: 'no_restriction', domain: '.google.com', expirationDate: ch.cookies[0].expires });
  assert.equal(CI.toElectron(ch.cookies[1]).domain, undefined, 'Host-Cookie ohne domain');
  assert.equal(CI.toElectron({ domain: 'x.de', name: 'n', value: '', sameSite: 'no_restriction', secure: false }).sameSite, 'lax');
  const jar = [];
  assert.equal(await CI.applyCookies([...ch.cookies, { domain: '', name: 'kaputt' }], { set: async c => jar.push(c) }), 3);

  assert.equal(I.summary({ bookmarks: 2, history: 5, cookies: 312, protectedCookies: 40 }, 'Chrome'),
    '2 Lesezeichen, 5 Verlaufseinträge und 312 Cookies aus Chrome übernommen. 40 Cookies schützt Chrome so, dass kein anderes Programm sie lesen kann – auf diesen Seiten meldest du dich in Sakura einmal neu an.');
  // Falscher Schlüssel → nicht lesbar statt Absturz
  assert.equal(CI.decryptValue(enc('x', ''), crypto.randomBytes(32), 0), null);
  console.log('Cookie-Import ok');
})().catch(e => { console.error(e.stack); process.exit(1); });
