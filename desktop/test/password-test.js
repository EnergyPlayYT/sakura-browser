// Passwortmanager: verschlüsselter Speicher, CSV-Import, Leck-Prüfung (k-Anonymität)
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const P = require('../lib/passwords');

// Nachbau von safeStorage: echte Verschlüsselung mit festem Schlüssel
const K = crypto.randomBytes(32);
const safe = {
  isEncryptionAvailable: () => true,
  encryptString: t => { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', K, iv); const d = Buffer.concat([c.update(t, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), d]); },
  decryptString: b => { const d = crypto.createDecipheriv('aes-256-gcm', K, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'); }
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw'));
const v = new P.Vault({ dir, safeStorage: safe });
assert.equal(v.available, true);
assert.equal(new P.Vault({ dir, safeStorage: { ...safe, getSelectedStorageBackend: () => 'basic_text' } }).available, false, 'Linux ohne Schlüsselbund: nicht speichern');
assert.equal(new P.Vault({ dir }).available, false);

assert.equal(v.check('https://login.example.com/anmelden?x=1', 'ali', 'geheim1'), 'new');
v.upsert('https://login.example.com/anmelden?x=1', 'ali', 'geheim1');
assert.equal(v.check('https://login.example.com/', 'ali', 'geheim1'), 'same');
assert.equal(v.check('https://login.example.com/', 'ali', 'neu'), 'update');
v.upsert('https://login.example.com/', 'zweit@example.com', 'pw2');
// Datei ist verschlüsselt
const raw = fs.readFileSync(path.join(dir, 'passwoerter.bin'));
assert(!raw.includes(Buffer.from('geheim1')) && !raw.includes(Buffer.from('ali')), 'nichts im Klartext');
// Neu laden
const v2 = new P.Vault({ dir, safeStorage: safe });
assert.deepEqual(v2.accountsFor('https://login.example.com/irgendwo').map(a => a.username).sort(), ['ali', 'zweit@example.com']);
assert.deepEqual(v2.accountsFor('http://login.example.com/'), [], 'http ist eine andere Seite');
assert.deepEqual(v2.accountsFor('https://evil.example.com/'), [], 'fremde Seite bekommt nichts');
const id = v2.accountsFor('https://login.example.com/').find(a => a.username === 'ali').id;
assert.equal(v2.reveal(id, 'https://login.example.com/x').password, 'geheim1');
assert.equal(v2.reveal(id, 'https://evil.example.com/'), null, 'Passwort nur für die eigene Seite');
assert.equal(v2.list()[0].password, undefined, 'Liste ohne Passwörter');
v2.addNever('https://nie.example/'); assert(v2.isNever('https://nie.example/login'));
v2.remove(id); assert.equal(v2.accountsFor('https://login.example.com/').length, 1);
// Falsches Windows-Konto → nicht überschreiben
const fremd = new P.Vault({ dir, safeStorage: { ...safe, decryptString: () => { throw new Error('x'); } } });
assert.deepEqual(fremd.list(), []); assert.throws(() => fremd.upsert('https://a.de/', 'a', 'b'), /anderen|nicht öffnen/);

// CSV
assert.deepEqual(P.parseCsv('a,"b ""x"", c",d\r\n"mehr\nzeilen",2,3\n\n'), [['a', 'b "x", c', 'd'], ['mehr\nzeilen', '2', '3']]);
const chrome = '﻿name,url,username,password,note\nGitHub,https://github.com/login,ali,"pa,ss",\nKaputt,kein-link,x,y,\nLeer,https://leer.de/,x,,\n';
const firefox = '"url","username","password","httpRealm","formActionOrigin","guid","timeCreated","timeLastUsed","timePasswordChanged"\n"https://www.mozilla.org","fox","feuer",,"https://www.mozilla.org","{1}","1","1","1"\n';
assert.deepEqual(P.parsePasswordCsv(chrome)[0], { url: 'https://github.com/login', username: 'ali', password: 'pa,ss' });
assert.equal(P.parsePasswordCsv(firefox)[0].password, 'feuer');
assert.throws(() => P.parsePasswordCsv('a,b\n1,2'), /Passwort-Export/);
const r = v2.importMany([...P.parsePasswordCsv(chrome), ...P.parsePasswordCsv(firefox)]);
assert.deepEqual(r, { added: 2, updated: 0, skipped: 2 });
assert.equal(v2.importMany(P.parsePasswordCsv(chrome)).added, 0, 'doppelt importieren ändert nichts');

(async () => {
  // Leck-Prüfung: nur 5 Zeichen des SHA-1 werden gesendet
  const sha = crypto.createHash('sha1').update('feuer').digest('hex').toUpperCase();
  const asked = [];
  const fetchFn = async (url, opt) => {
    asked.push(url); assert.equal(opt.headers['Add-Padding'], 'true');
    const prefix = url.slice(-5);
    return { ok: true, text: async () => prefix === sha.slice(0, 5) ? `0000000000000000000000000000000000A:1\r\n${sha.slice(5)}:4711\r\n` : 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:3' };
  };
  assert.equal(await P.pwnedCount('feuer', fetchFn), 4711);
  assert(asked.every(u => /\/range\/[0-9A-F]{5}$/.test(u)) && !asked.some(u => u.includes('feuer')));
  const res = await P.checkLeaks(v2, fetchFn);
  assert.deepEqual(res, { checked: 3, leaked: 1 });
  assert.equal(v2.list().find(e => e.username === 'fox').leaked, 4711);
  console.log('Passwortmanager ok');
})().catch(e => { console.error(e.stack); process.exit(1); });
