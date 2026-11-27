// Clip-Knopf: zwei versetzte Aufnahmen, Speichern liefert eine vollständige Datei als Download
const assert = require('assert');
const fs = require('fs'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'clip.js'), 'utf8');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Clip ok (übersprungen)'); process.exit(0); }
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ acceptDownloads: true });
  const p = await ctx.newPage();
  await p.setContent('<canvas id="c" width="320" height="180"></canvas><video id="v" muted autoplay style="width:320px;height:180px"></video>');
  // Testvideo: bewegte Zeichnung auf einer Leinwand als Videoquelle
  await p.evaluate(() => {
    const c = document.getElementById('c'), g = c.getContext('2d'); let n = 0;
    setInterval(() => { g.fillStyle = `hsl(${n++ * 7 % 360},70%,60%)`; g.fillRect(0, 0, 320, 180); }, 40);
    const v = document.getElementById('v'); v.srcObject = c.captureStream(25); return v.play();
  });
  await p.addScriptTag({ content: code });
  assert.match((await p.evaluate(() => window.__sakuraClip.save())).error, /Clip bereit/);
  assert.deepEqual(await p.evaluate(() => window.__sakuraClip.arm(true)), { armed: true });
  await p.waitForTimeout(2500);
  const [dl, r] = await Promise.all([p.waitForEvent('download'), p.evaluate(() => window.__sakuraClip.save())]);
  assert.equal(r.ok, true); assert(r.seconds >= 2);
  assert.match(dl.suggestedFilename(), /^Sakura-Clip .+\.webm$/);
  const file = await dl.path(); assert(fs.statSync(file).size > 1000, 'Datei hat Inhalt');
  assert.equal((await p.evaluate(() => window.__sakuraClip.status())).armed, true, 'bleibt bereit');
  await p.evaluate(() => window.__sakuraClip.arm(false));
  assert.equal((await p.evaluate(() => window.__sakuraClip.status())).armed, false);
  await b.close();
  console.log('Clip ok');
})().catch(e => { console.error(e); process.exit(1); });
