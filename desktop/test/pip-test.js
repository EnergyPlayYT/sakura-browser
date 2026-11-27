// Bild-in-Bild-Knopf: erscheint über großen Videos, Klick ruft requestPictureInPicture auf (nie automatisch)
const assert = require('assert');
const fs = require('fs'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'pip.js'), 'utf8');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Bild-in-Bild ok (übersprungen)'); process.exit(0); }
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 600 } });
  await p.setContent('<video id="v" style="position:absolute;left:50px;top:60px;width:480px;height:270px;background:#000"></video><video id="klein" style="position:absolute;left:600px;top:60px;width:80px;height:50px"></video>');
  await p.evaluate(() => {
    Object.defineProperty(document, 'pictureInPictureEnabled', { value: true });
    for (const v of document.querySelectorAll('video')) Object.defineProperty(v, 'readyState', { value: 4 });
    window.__pipCalls = 0;
    HTMLVideoElement.prototype.requestPictureInPicture = function () { window.__pipCalls++; window.__pipId = this.id; return Promise.resolve(); };
  });
  await p.addScriptTag({ content: code });
  assert.equal(await p.evaluate(() => window.__pipCalls), 0, 'nicht automatisch');
  await p.mouse.move(300, 200); await p.mouse.move(310, 205); await p.waitForTimeout(200);
  const pos = await p.evaluate(() => { const h = [...document.documentElement.children].find(e => e.style.position === 'fixed'); return h && h.style.display !== 'none' ? { x: parseInt(h.style.left) + 40, y: parseInt(h.style.top) + 14 } : null; });
  assert(pos, 'Knopf erscheint über dem großen Video');
  await p.mouse.move(pos.x, pos.y); await p.mouse.click(pos.x, pos.y); await p.waitForTimeout(100);
  assert.equal(await p.evaluate(() => window.__pipCalls), 1); assert.equal(await p.evaluate(() => window.__pipId), 'v');
  await p.mouse.move(640, 85); await p.waitForTimeout(1200);
  assert.equal(await p.evaluate(() => [...document.documentElement.children].find(e => e.style.position === 'fixed').style.display), 'none', 'nicht über winzigen Videos');
  await b.close();
  console.log('Bild-in-Bild ok');
})().catch(e => { console.error(e); process.exit(1); });
