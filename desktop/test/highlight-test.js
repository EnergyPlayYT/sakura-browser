// Textmarker: Auswahl markieren, gespeichert wiederfinden (auch bei gleichem Wort mehrfach), Seite bleibt unverändert
const assert = require('assert');
const fs = require('fs'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'highlight.js'), 'utf8');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Textmarker ok (übersprungen)'); process.exit(0); }
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.setContent('<p id="a">Die Kirschblüte beginnt im März.</p><p id="b">Im <b>Süden</b> blüht die Kirschblüte zuerst.</p>');
  await p.addScriptTag({ content: code });
  const html0 = await p.evaluate(() => document.body.innerHTML);
  // zweites Vorkommen von „Kirschblüte“ auswählen
  const saved = await p.evaluate(() => { const t = document.getElementById('b').lastChild; const r = document.createRange(); r.setStart(t, 11); r.setEnd(t, 22);
    getSelection().removeAllRanges(); getSelection().addRange(r); return window.__sakuraHL.addSelection('rosa'); });
  assert.equal(saved.text, 'Kirschblüte'); assert(saved.prefix.endsWith('blüht die '), saved.prefix);
  assert.equal(await p.evaluate(() => CSS.highlights.get('sakura-rosa').size), 1);
  assert.equal(await p.evaluate(() => document.body.innerHTML), html0, 'Seite unverändert');
  // nach „Neuladen“: wiederfinden – und zwar das zweite Vorkommen
  await p.setContent('<p id="a">Die Kirschblüte beginnt im März.</p><p id="b">Im <b>Süden</b> blüht die Kirschblüte zuerst.</p>');
  await p.addScriptTag({ content: code });
  const n = await p.evaluate(s => window.__sakuraHL.paint([{ ...s, color: 'rosa' }, { text: 'gibt es nicht', color: 'gelb' }]), saved);
  assert.equal(n, 1);
  const where = await p.evaluate(() => { const r = [...CSS.highlights.get('sakura-rosa')][0]; return r.startContainer.parentElement.id; });
  assert.equal(where, 'b', 'richtige Stelle');
  await b.close(); console.log('Textmarker ok');
})().catch(e => { console.error(e); process.exit(1); });
