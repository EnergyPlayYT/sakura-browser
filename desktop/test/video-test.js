// Videos und Serien: weiterschauen, Intro überspringen, nächste Folge (nachgebauter Player in echtem Chromium)
const assert = require('assert');
const fs = require('fs'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'video.js'), 'utf8');
assert.equal(fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'assets', 'video.js'), 'utf8'), code, 'video.js nach Android kopieren!');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Videos ok (Browser-Test übersprungen, Playwright fehlt)'); process.exit(0); }

const PAGE = `<video id="v" style="width:640px;height:360px;display:block"></video>
  <button data-uia="player-skip-intro" id="intro" style="display:none" onclick="window.introClicked=(window.introClicked||0)+1;this.style.display='none'">Intro überspringen</button>
  <a href="#" id="weiter">Nächste Folge</a>
  <button id="next" style="display:none" onclick="window.nextClicked=(window.nextClicked||0)+1">Nächste Folge</button>`;
async function setup(pg, saved) {
  await pg.evaluate(saved => {
    const v = document.getElementById('v');
    let t = 0, paused = true;
    Object.defineProperty(v, 'duration', { get: () => 1500 });
    Object.defineProperty(v, 'currentTime', { get: () => t, set: x => { t = x; } });
    Object.defineProperty(v, 'readyState', { get: () => 4 });
    Object.defineProperty(v, 'currentSrc', { get: () => 'blob:folge1' });
    Object.defineProperty(v, 'paused', { get: () => paused });
    v.play = () => { paused = false; v.dispatchEvent(new Event('playing')); return Promise.resolve(); };
    window.saved = saved; window.sets = [];
    window.sakuraVideo = { get: async () => window.saved, set: async (t, d) => { window.sets.push([t, d]); } };
    window.__sakuraVideoConfig = { resume: true, intro: true, next: true };
  }, saved);
}
(async () => {
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.route('https://serien.example/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }));
  await pg.goto('https://serien.example/watch/123');
  await setup(pg, { t: 600, d: 1500 });
  await pg.evaluate(code);
  await pg.evaluate(() => document.getElementById('v').play());
  await pg.waitForTimeout(150);
  let r = await pg.evaluate(() => ({ t: document.getElementById('v').currentTime, toast: document.getElementById('sakura-video-toast') && document.getElementById('sakura-video-toast').textContent }));
  assert.equal(r.t, 600, 'springt zur gemerkten Stelle'); assert.equal(r.toast, 'Weiter bei 10:00Von vorn');
  // „Von vorn“
  await pg.click('#sakura-video-toast button');
  r = await pg.evaluate(() => ({ t: document.getElementById('v').currentTime, sets: window.sets }));
  assert.equal(r.t, 0); assert.deepEqual(r.sets, [[null, undefined]], 'Stelle vergessen');
  // Stelle merken beim Abspielen
  await pg.evaluate(() => { const v = document.getElementById('v'); v.currentTime = 754.6; v.dispatchEvent(new Event('timeupdate')); });
  assert.deepEqual((await pg.evaluate(() => window.sets)).pop(), [754, 1500]);
  // Intro-Knopf erscheint → wird geklickt
  await pg.evaluate(() => { document.getElementById('intro').style.display = 'block'; });
  await pg.waitForTimeout(1300);
  assert.equal(await pg.evaluate(() => window.introClicked), 1, 'Intro übersprungen');
  // „Nächste Folge“ mitten im Video: nicht klicken (auch nicht den Link)
  await pg.evaluate(() => { document.getElementById('next').style.display = 'block'; });
  await pg.waitForTimeout(2800);
  assert.equal(await pg.evaluate(() => window.nextClicked), undefined, 'nicht zu früh');
  assert.equal(pg.url(), 'https://serien.example/watch/123');
  // Kurz vor Schluss: klicken
  await pg.evaluate(() => { document.getElementById('v').currentTime = 1450; });
  await pg.waitForTimeout(1300);
  assert.equal(await pg.evaluate(() => window.nextClicked), 1, 'nächste Folge');
  // Fast fertig geschaut → Stelle löschen
  await pg.evaluate(() => { window.sets = []; const v = document.getElementById('v'); v.currentTime = 1460; v.dispatchEvent(new Event('timeupdate')); });
  await pg.waitForTimeout(5200);
  await pg.evaluate(() => document.getElementById('v').dispatchEvent(new Event('timeupdate')));
  const sets = await pg.evaluate(() => window.sets);
  assert(sets.length && sets.every(x => x[0] === null), 'fertig geschaut → Stelle vergessen');
  // Kurze Videos (unter 2 Minuten) und Adressen mit Zeitangabe: kein Weiterschauen
  const pg2 = await b.newPage();
  await pg2.route('https://serien.example/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }));
  await pg2.goto('https://serien.example/watch/123?t=42');
  await setup(pg2, { t: 600, d: 1500 });
  await pg2.evaluate(code); await pg2.evaluate(() => document.getElementById('v').play()); await pg2.waitForTimeout(150);
  assert.equal(await pg2.evaluate(() => document.getElementById('v').currentTime), 0, 'Zeitangabe in der Adresse hat Vorrang');
  await b.close();
  console.log('Videos ok');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
