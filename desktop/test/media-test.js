// Video und Ton: Kino-Modus, Helligkeit, Equalizer/Bass, Schutz vor stummem Ton, Sleep-Timer „Ende der Folge“
const assert = require('assert');
const fs = require('fs'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'media.js'), 'utf8');
assert.equal(fs.readFileSync(path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'assets', 'media.js'), 'utf8'), code, 'media.js nach Android kopieren!');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Video und Ton ok (Browser-Test übersprungen, Playwright fehlt)'); process.exit(0); }

// 1 Sekunde Stille als WAV (gleiche Herkunft → Ton darf bearbeitet werden)
const wav = (() => { const n = 8000, b = Buffer.alloc(44 + n); b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(8000, 24); b.writeUInt32LE(8000, 28); b.writeUInt16LE(1, 32); b.writeUInt16LE(8, 34);
  b.write('data', 36); b.writeUInt32LE(n, 40); b.fill(128, 44); return b; })();
(async () => {
  const b = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const pg = await b.newPage();
  await pg.route('https://kino.example/**', r => r.request().url().endsWith('.wav') ? r.fulfill({ contentType: 'audio/wav', body: wav })
    : r.fulfill({ contentType: 'text/html; charset=utf-8', body: '<p id="txt">Text</p><video id="v" style="width:400px;height:200px"></video><audio id="a" src="/ton.wav"></audio><video id="fremd" src="https://cdn.anders.example/x.mp4" style="width:10px;height:10px"></video>' }));
  await pg.goto('https://kino.example/film');
  await pg.evaluate(() => new Promise(r => { const a = document.getElementById('a'); a.readyState > 0 ? r() : a.addEventListener('loadedmetadata', r); }));
  await pg.evaluate(code);
  let r = await pg.evaluate(() => window.__sakuraMedia.apply({ cinema: true, brightness: 80 }));
  assert.equal(r.hasVideo, true);
  r = await pg.evaluate(() => ({ css: document.getElementById('sakura-media-style').textContent, mark: document.getElementById('v').hasAttribute('data-sakura-cinema') }));
  assert(r.css.includes('brightness(0.8)') && r.css.includes('200vmax') && r.mark, 'Kino-Modus und Helligkeit');
  // Ton: eigenes Element wird bearbeitet, fremdes nicht (sonst wäre es stumm)
  r = await pg.evaluate(() => window.__sakuraMedia.apply({ bass: 8, eq: [3, 0, 0, -2, 5] }));
  assert.deepEqual(r.notes, ['Der Ton kommt von einer anderen Seite und lässt sich hier nicht bearbeiten.']);
  // Geschütztes Video (DRM)
  r = await pg.evaluate(() => { Object.defineProperty(document.getElementById('fremd'), 'mediaKeys', { get: () => ({}) }); return window.__sakuraMedia.apply({ bass: 9 }); });
  assert(r.notes[0].startsWith('Geschützte Videos'));
  // Zurück auf neutral, Kino aus
  r = await pg.evaluate(() => window.__sakuraMedia.apply({ cinema: false, brightness: 100, bass: 0, eq: [0, 0, 0, 0, 0] }));
  assert.deepEqual(r.notes, []);
  assert.equal(await pg.evaluate(() => document.getElementById('sakura-media-style').textContent), '');
  // Sleep-Timer „Ende der Folge“
  await pg.evaluate(() => { window.__sakuraMedia.sleepAtEnd(true); window.paused = 0; HTMLMediaElement.prototype.pause = function () { window.paused++; }; document.getElementById('v').dispatchEvent(new Event('ended')); });
  r = await pg.evaluate(() => ({ paused: window.paused, noNext: window.__sakuraNoNext }));
  assert(r.paused >= 3 && r.noNext === true, 'am Ende alles angehalten, keine nächste Folge');
  await pg.evaluate(() => { window.paused = 0; document.getElementById('v').dispatchEvent(new Event('play')); });
  assert.equal(await pg.evaluate(() => window.paused), 1, 'nächste Folge startet von selbst → gleich wieder angehalten');
  await b.close();
  console.log('Video und Ton ok');
})().catch(e => { console.error(e.stack || e.message); process.exit(1); });
