// Wegwerf-E-Mail: Adresse anlegen, Anmelde-Token, Posteingang, Nachricht nur als Text, Token erneuern
const assert = require('assert');
const { TempMail } = require('../lib/tempmail');
const store = { data: {}, save() {} };
const calls = [];
let tokenOk = true;
const res = (status, body) => ({ ok: status < 300, status, json: async () => body });
const fetch = async (url, o) => {
  const path = url.replace('https://api.mail.tm', ''); calls.push(o.method + ' ' + path);
  if (path === '/domains') return res(200, { 'hydra:member': [{ domain: 'mail.example' }] });
  if (path === '/accounts') return res(201, { id: 'acc' });
  if (path === '/token') { tokenOk = true; return res(200, { token: 'T1' }); }
  if (!tokenOk) return res(401, {});
  assert.equal(o.headers.Authorization, 'Bearer T1');
  if (path === '/messages') return res(200, { 'hydra:member': [{ id: 'm1', from: { address: 'shop@x.de' }, subject: 'Bestätige deine Adresse', intro: 'Hallo', createdAt: '2026-11-27T10:00:00Z' }] });
  if (path === '/messages/m1') return res(200, { id: 'm1', from: { address: 'shop@x.de' }, subject: 'Bestätige', html: ['<p>Klick <a href="https://x.de/ok?t=1">hier</a></p><script>böse()</script>'] });
  return res(404, {});
};
(async () => {
  const tm = new TempMail({ store, fetch });
  const info = await tm.create();
  assert.match(info.address, /^sakura\.[a-z0-9]{10}@mail\.example$/);
  assert(store.data.tempMail.password.length === 24);
  const inbox = await tm.inbox(); assert.equal(inbox[0].subject, 'Bestätige deine Adresse');
  const m = await tm.message('m1'); assert(!m.text.includes('<') && !m.text.includes('böse'), 'nur Text'); assert.deepEqual(m.links, ['https://x.de/ok?t=1']);
  assert.equal(await tm.message('../böse'), null);
  tokenOk = false; const again = await tm.inbox(); assert.equal(again.length, 1, 'Token wird erneuert');
  tm.forget(); assert.equal(tm.info(), null); assert.deepEqual(await tm.inbox(), []);
  console.log('Wegwerf-E-Mail ok');
})().catch(e => { console.error(e); process.exit(1); });
