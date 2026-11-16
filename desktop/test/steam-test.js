// Steam: Spieler online (offiziell), Spielzeit (SteamSpy), Preisvergleich (IsThereAnyDeal, nur mit Schlüssel)
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { Steam, isAppId } = require('../lib/steam');
const KEY = 'abcdef0123456789abcdef0123456789';
const urls = [];
const fetchFn = async (url, opt = {}) => {
  urls.push(url);
  const ok = j => ({ ok: true, json: async () => j });
  if (url.includes('GetNumberOfCurrentPlayers')) return ok({ response: { player_count: 812345, result: 1 } });
  if (url.includes('steamspy.com')) return ok({ average_forever: 1500, median_forever: 600 });
  if (url.includes('/games/lookup/v1')) return ok({ found: true, game: { id: 'game-uuid' } });
  if (url.includes('/games/prices/v3')) { assert.deepEqual(JSON.parse(opt.body), ['game-uuid']); return ok([{ id: 'game-uuid', historyLow: { all: { amount: 9.99, currency: 'EUR' } },
    deals: [{ shop: { name: 'Steam' }, price: { amount: 29.99, currency: 'EUR' }, cut: 0, url: 'https://store.steampowered.com/app/1' }, { shop: { name: 'GOG' }, price: { amount: 19.99, currency: 'EUR' }, cut: 33, url: 'https://gog.com/x' }, { shop: { name: 'Böse' }, price: { amount: 1, currency: 'EUR' }, url: 'javascript:alert(1)' }] }]); }
  return { ok: false, status: 404, json: async () => ({}) };
};
(async () => {
  assert(isAppId('730') && !isAppId('7a') && !isAppId(''));
  const st = new Steam(fetchFn);
  const noKey = await st.info('730', '');
  assert.deepEqual(noKey, { players: 812345, playtime: { average: 1500, median: 600 }, prices: null, hasKey: false });
  assert(!urls.some(u => u.includes('isthereanydeal')), 'ohne Schlüssel keine Preisabfrage');
  const withKey = await st.info('730', KEY);
  assert.deepEqual(withKey.prices.deals.map(d => [d.shop, d.price, d.url]), [['Böse', 1, null], ['GOG', 19.99, 'https://gog.com/x'], ['Steam', 29.99, 'https://store.steampowered.com/app/1']]);
  assert.deepEqual(withKey.prices.low, { price: 9.99, currency: 'EUR' });
  assert.equal(await st.info('../x', KEY), null);
  const off = new Steam(async () => { throw new Error('offline'); });
  assert.deepEqual(await off.info('730', ''), { players: null, playtime: null, prices: null, hasKey: false });

  let chromium;
  try { ({ chromium } = require('playwright')); } catch { console.log('Steam ok (Browser-Test übersprungen)'); return; }
  const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'steam.js'), 'utf8');
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.route('https://store.steampowered.com/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<div class="rightcol game_meta_data"><div>Tags</div></div>' }));
  await pg.goto('https://store.steampowered.com/app/730/CounterStrike_2/');
  await pg.evaluate(d => { window.sakuraSteam = { info: async id => id === '730' ? d : null }; }, withKey);
  await pg.evaluate(code); await pg.waitForTimeout(100);
  const text = await pg.evaluate(() => document.querySelector('.rightcol #sakura-steam').innerText);
  assert(/Spieler gerade online\s+812\.345/.test(text) && /25 Std\./.test(text) && /GOG\s+19,99\s*€\s+−33 %/.test(text) && /Bestpreis bisher/.test(text), text);
  await b.close();
  console.log('Steam ok');
})().catch(e => { console.error(e.stack); process.exit(1); });
