// Twitch: Emote-Listen (7TV/BTTV/FFZ), Emotes im Chat, Kanalpunkte nur auf Wunsch
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { Emotes } = require('../lib/emotes');

const API = {
  'https://api.frankerfacez.com/v1/set/global': { default_sets: [3], sets: { 3: { emoticons: [{ name: 'ZrehplaR', urls: { 1: '//cdn.frankerfacez.com/emote/1/1' } }, { name: 'KEKW', urls: { 1: '//cdn.frankerfacez.com/emote/9/1' } }] } } },
  'https://api.betterttv.net/3/cached/emotes/global': [{ id: 'b1', code: 'catJAM' }],
  'https://7tv.io/v3/emote-sets/global': { emotes: [{ id: 's1', name: 'EZ', data: { host: { url: '//cdn.7tv.app/emote/s1', files: [{ name: '1x.webp' }, { name: '2x.webp' }] } } }] },
  'https://api.frankerfacez.com/v1/room/papaplatte': { room: { twitch_id: 50985620 }, sets: { 77: { emoticons: [{ name: 'papaHi', urls: { 1: 'https://cdn.frankerfacez.com/emote/77/1' } }] } } },
  'https://7tv.io/v3/users/twitch/50985620': { emote_set: { emotes: [{ name: 'KEKW', data: { host: { url: '//cdn.7tv.app/emote/s2', files: [{ name: '1x.webp' }] } } }] } },
  'https://api.betterttv.net/3/cached/users/twitch/50985620': { channelEmotes: [{ id: 'b2', code: 'pepeD' }], sharedEmotes: [{ id: 'b3', code: 'EZ' }] }
};
let calls = 0;
const fetchFn = async url => { calls++; return API[url] ? { ok: true, json: async () => API[url] } : { ok: false, status: 404, json: async () => ({}) }; };

(async () => {
  const em = new Emotes(fetchFn);
  const m = await em.forChannel('Papaplatte');
  assert.equal(m.ZrehplaR.url, 'https://cdn.frankerfacez.com/emote/1/1');
  assert.deepEqual(m.catJAM, { url: 'https://cdn.betterttv.net/emote/b1/1x', src: 'bttv' });
  assert.deepEqual(m.KEKW, { url: 'https://cdn.7tv.app/emote/s2/1x.webp', src: '7tv' }, 'Kanal-7TV vor globalem FFZ');
  assert.equal(m.EZ.url, 'https://cdn.betterttv.net/emote/b3/1x', 'Kanal-Emote überschreibt globales');
  assert(m.papaHi && m.pepeD);
  const n = calls; await em.forChannel('papaplatte'); assert.equal(calls, n, 'Zwischenspeicher');
  assert.deepEqual(await em.channel('../evil'), {}, 'ungültiger Name');
  const off = new Emotes(async () => { throw new Error('offline'); });
  assert.deepEqual(await off.forChannel('papaplatte'), {});

  let chromium;
  try { ({ chromium } = require('playwright')); } catch { console.log('Twitch ok (Browser-Test übersprungen)'); return; }
  const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'twitch.js'), 'utf8');
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.route('https://www.twitch.tv/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: `<div class="community-points-summary"><button aria-label="Bonus abholen" id="bonus" onclick="window.claimed=(window.claimed||0)+1"><span class="claimable-bonus__icon"></span></button></div><div id="chat"></div>` }));
  await pg.goto('https://www.twitch.tv/papaplatte');
  await pg.evaluate(m => { window.sakuraTwitch = { emotes: async login => login === 'papaplatte' ? m : {} }; window.__sakuraTwitchConfig = { emotes: true, points: false }; }, m);
  await pg.evaluate(code);
  await pg.waitForTimeout(100);
  await pg.evaluate(() => {
    document.getElementById('chat').insertAdjacentHTML('beforeend',
      '<div class="chat-line__message"><span class="text-fragment">so gut KEKW catJAM ok</span><span class="text-fragment">link <a href="https://x.de">KEKW</a></span></div>');
  });
  await pg.waitForTimeout(100);
  const r = await pg.evaluate(() => ({ imgs: [...document.querySelectorAll('img.sakura-emote')].map(i => i.alt), text: document.querySelector('.text-fragment').textContent, link: !!document.querySelector('a[href="https://x.de"]') }));
  assert.deepEqual(r.imgs, ['KEKW', 'catJAM']); assert.equal(r.text, 'so gut   ok'); assert(r.link, 'Links bleiben heil');
  await pg.waitForTimeout(2600);
  assert.equal(await pg.evaluate(() => window.claimed), undefined, 'Kanalpunkte aus: nichts klicken');
  await pg.evaluate(() => { window.__sakuraTwitchConfig.points = true; });
  await pg.waitForTimeout(4500);
  assert.equal(await pg.evaluate(() => window.claimed), 1, 'Kanalpunkte an: Bonus abgeholt');
  await b.close();
  console.log('Twitch ok');
})().catch(e => { console.error(e.stack); process.exit(1); });
