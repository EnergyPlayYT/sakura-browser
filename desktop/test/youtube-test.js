// YouTube: SponsorBlock-Abfrage (Datenschutz) und Seitenskript mit nachgebautem Player
const assert = require('assert');
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const SB = require('../lib/sponsorblock');
const ID = 'dQw4w9WgXcQ';
assert.equal(SB.hashPrefix(ID), crypto.createHash('sha256').update(ID).digest('hex').slice(0, 4));
assert(SB.isVideoId(ID) && !SB.isVideoId('../etc') && !SB.isVideoId(''));
assert(SB.isYouTube('https://www.youtube.com/watch?v=x') && SB.isYouTube('https://m.youtube.com/') && !SB.isYouTube('https://youtube.com.evil.de/') && !SB.isYouTube('http://www.youtube.com/'));
const answer = [
  { videoID: 'andere-id00', segments: [{ segment: [1, 50], category: 'sponsor' }] },
  { videoID: ID, segments: [
    { segment: [60, 90], category: 'sponsor', actionType: 'skip' },
    { segment: [10, 20], category: 'selfpromo' },
    { segment: [0, 30], category: 'intro' },
    { segment: [100, 100.5], category: 'sponsor' },
    { segment: [120, 130], category: 'sponsor', actionType: 'mute' }
  ] }
];
assert.deepEqual(SB.pickSegments(answer, ID).map(s => [s.start, s.end, s.label]), [[10, 20, 'Eigenwerbung'], [60, 90, 'Sponsor']]);
const asked = [];
const sb = new SB.SponsorBlock(async u => { asked.push(u); return { ok: true, json: async () => answer }; });

(async () => {
  assert.equal((await sb.segments(ID)).length, 2);
  await sb.segments(ID);
  assert.equal(asked.length, 1, 'zweite Abfrage aus dem Zwischenspeicher');
  assert(!asked[0].includes(ID), 'die Video-ID selbst wird nie gesendet');
  assert(asked[0].startsWith('https://sponsor.ajay.app/api/skipSegments/' + SB.hashPrefix(ID) + '?'));
  assert.deepEqual(await sb.segments('kaputt'), []);
  const off = new SB.SponsorBlock(async () => { throw new Error('offline'); });
  assert.deepEqual(await off.segments(ID), []);

  // Seitenskript
  const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'youtube.js'), 'utf8');
  assert.equal(fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'assets', 'youtube.js'), 'utf8'), code, 'youtube.js nach Android kopieren!');
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { console.log('YouTube ok (Browser-Test übersprungen, Playwright fehlt)'); return; }
  const b = await chromium.launch();
  const pg = await b.newPage();
  await pg.route('https://www.youtube.com/**', r => r.fulfill({ contentType: 'text/html', body: `<div id="movie_player" class="html5-video-player ad-showing"><video class="html5-main-video"></video>
    <button class="ytp-ad-skip-button-modern" onclick="window.skipped=(window.skipped||0)+1">Überspringen</button></div>` }));
  await pg.goto('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  await pg.evaluate(() => {
    const v = document.querySelector('video');
    let t = 0;
    Object.defineProperty(v, 'duration', { get: () => 100 });
    Object.defineProperty(v, 'currentTime', { get: () => t, set: x => { t = x; } });
    Object.defineProperty(v, 'paused', { get: () => false });
    const p = document.getElementById('movie_player');
    p.getAvailableQualityLevels = () => ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'auto'];
    p.setPlaybackQualityRange = (a, b2) => { window.quality = a; };
    p.setPlaybackQuality = () => {};
    window.sakuraYT = { segments: async id => id === 'dQw4w9WgXcQ' ? [{ start: 60, end: 90, label: 'Sponsor' }] : [] };
    window.__sakuraYTConfig = { quality: 'hd1080', sponsorblock: true };
  });
  await pg.evaluate(code);
  await pg.waitForTimeout(100);
  let r = await pg.evaluate(() => { const v = document.querySelector('video'); return { t: v.currentTime, muted: v.muted, rate: v.playbackRate, skipped: window.skipped, q: window.quality }; });
  assert.equal(r.t, 99.9, 'Werbung wird ans Ende gespult'); assert.equal(r.muted, true); assert.equal(r.rate, 16); assert(r.skipped >= 1, 'Überspringen-Knopf geklickt');
  assert.equal(r.q, undefined, 'während der Werbung keine Qualität setzen');
  // Werbung vorbei → Ton und Tempo zurück, Qualität 1080p
  await pg.evaluate(() => { document.getElementById('movie_player').classList.remove('ad-showing'); });
  await pg.waitForTimeout(100);
  await pg.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 10; window.__sakuraYT.refresh(); });
  await pg.waitForTimeout(100);
  r = await pg.evaluate(() => { const v = document.querySelector('video'); return { muted: v.muted, rate: v.playbackRate, q: window.quality }; });
  assert.deepEqual(r, { muted: false, rate: 1, q: 'hd1080' });
  // Sponsor-Abschnitt
  await pg.evaluate(() => { const v = document.querySelector('video'); v.currentTime = 61; v.dispatchEvent(new Event('timeupdate')); });
  r = await pg.evaluate(() => ({ t: document.querySelector('video').currentTime, toast: document.querySelector('#movie_player > div') && document.querySelector('#movie_player > div').textContent }));
  assert.deepEqual(r, { t: 90, toast: 'Sponsor übersprungen' });
  // Video ohne 1080p → nächstniedrigere Stufe; Wechsel per yt-navigate-finish
  await pg.evaluate(() => { document.getElementById('movie_player').getAvailableQualityLevels = () => ['hd720', 'large', 'auto']; history.replaceState(null, '', '?v=abcdefghijk'); document.dispatchEvent(new Event('yt-navigate-finish')); });
  await pg.waitForTimeout(50);
  assert.equal(await pg.evaluate(() => window.quality), 'hd720');
  await b.close();
  console.log('YouTube ok');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
