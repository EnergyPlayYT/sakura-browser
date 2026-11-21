// Phishing-Schutz: Liste lesen, Subdomains erkennen, Hauptseite blockieren, Freigabe
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { PhishGuard, parse } = require('../lib/phishing');
const AB = require('../lib/adblock');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph'));
const list = '# Kommentar\nevil-bank-login.example\nPAYPAL-sicher.test\n\nnot a domain\n' + Array.from({ length: 150 }, (_, i) => `fake${i}.test`).join('\n');
assert.equal(parse(list).size, 152);
(async () => {
  let calls = 0;
  const g = new PhishGuard({ userDir: dir, fetch: async url => { calls++; return url.includes('gitlab') ? { ok: false } : { ok: true, text: async () => list }; } });
  assert.equal(await g.refresh(), true, 'Ersatzadresse genutzt'); assert.equal(calls, 2);
  assert(g.isPhishing('evil-bank-login.example')); assert(g.isPhishing('login.evil-bank-login.example'), 'Subdomain');
  assert(g.isPhishing('paypal-sicher.test')); assert(!g.isPhishing('paypal.com')); assert(!g.isPhishing('example'));
  assert.equal(await g.refresh(), false, 'heute schon geladen');
  assert.equal(new PhishGuard({ userDir: dir, fetch: null }).size, 152, 'Liste bleibt gespeichert');
  // im Werbeblocker: Hauptseite abbrechen und melden
  const prefs = { adblock: true, adblockAllow: [] };
  const b = new AB({ store: { prefs: () => prefs }, baseDir: path.join(__dirname, '..', 'assets'), userDir: dir });
  let handler; b.attach({ webRequest: { onBeforeRequest: (f, h) => handler = h } }, () => '');
  const run = d => new Promise(r => handler(d, r));
  const told = []; b.phish = g; b.onPhish = (id, url) => told.push([id, url]);
  assert.deepEqual(await run({ url: 'https://evil-bank-login.example/login', resourceType: 'mainFrame', webContentsId: 7 }), { cancel: true });
  assert.deepEqual(told, [[7, 'https://evil-bank-login.example/login']]);
  assert.deepEqual(await run({ url: 'https://www.wikipedia.org/', resourceType: 'mainFrame', webContentsId: 7 }), {});
  prefs.phishWarn = false;
  assert.deepEqual(await run({ url: 'https://evil-bank-login.example/', resourceType: 'mainFrame', webContentsId: 7 }), {}, 'abschaltbar');
  prefs.phishWarn = true; g.allow('evil-bank-login.example');
  assert.deepEqual(await run({ url: 'https://evil-bank-login.example/', resourceType: 'mainFrame', webContentsId: 7 }), {}, '„Trotzdem öffnen“');
  console.log('Phishing-Schutz ok');
})().catch(e => { console.error(e); process.exit(1); });
