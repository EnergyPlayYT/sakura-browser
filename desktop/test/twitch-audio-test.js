// Twitch „Nur Ton“: Player über React-Fiber finden, Audio-Spur wählen, Bild ausblenden
const assert = require('assert');
const fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'twitch-audio.js'), 'utf8');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  await p.setContent('<div data-a-target="video-player" style="position:relative;width:300px;height:170px"><video></video></div>');
  await p.evaluate(() => {
    const qs = [{ name: '1080p60', group: 'chunked', bitrate: 8e6 }, { name: '160p', group: '160p30', bitrate: 2e5 }, { name: 'Audio Only', group: 'audio_only', bitrate: 1e5 }];
    window.__q = qs[0];
    const player = { getQualities: () => qs, getQuality: () => window.__q, setQuality: q => { window.__q = q; }, setAutoSwitchQuality: v => { window.__auto = v; } };
    const el = document.querySelector('[data-a-target="video-player"]');
    el['__reactFiber$abc'] = { memoizedProps: {}, return: { memoizedProps: { mediaPlayerInstance: { core: player } }, return: null } };
  });
  await p.addScriptTag({ content: code });
  assert.equal(await p.evaluate(() => window.__sakuraTwitchAudio(true)), 'audio');
  assert.equal(await p.evaluate(() => window.__q.group), 'audio_only');
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('video')).opacity), '0');
  assert(await p.evaluate(() => !!document.getElementById('sakura-audio-only')));
  assert.equal(await p.evaluate(() => window.__sakuraTwitchAudio(false)), 'aus');
  assert.equal(await p.evaluate(() => window.__auto), true);
  assert.equal(await p.evaluate(() => getComputedStyle(document.querySelector('video')).opacity), '1');
  // ohne Audio-Spur: kleinste Qualität
  await p.evaluate(() => { const pl = document.querySelector('[data-a-target="video-player"]')['__reactFiber$abc'].return.memoizedProps.mediaPlayerInstance.core; const qs = pl.getQualities().slice(0, 2); pl.getQualities = () => qs; });
  assert.equal(await p.evaluate(() => window.__sakuraTwitchAudio(true)), 'klein');
  assert.equal(await p.evaluate(() => window.__q.name), '160p');
  await p.setContent('<p>kein Stream</p>'); await p.addScriptTag({ content: code });
  assert.equal(await p.evaluate(() => window.__sakuraTwitchAudio(true)), 'kein-player');
  await b.close();
  console.log('Twitch Nur Ton ok');
})().catch(e => { console.error(e); process.exit(1); });
