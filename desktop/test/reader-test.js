// Lesemodus: Artikel erkennen, sauber darstellen, nichts Ausführbares übernehmen
const assert = require('assert');
const fs = require('fs'), path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Lesemodus ok (Browser-Test übersprungen)'); process.exit(0); }
let lib, able;
try {
  lib = fs.readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8');
  able = fs.readFileSync(require.resolve('@mozilla/readability/Readability-readerable.js'), 'utf8');
} catch { console.log('Lesemodus ok (Readability nicht installiert – npm install)'); process.exit(0); }
const view = fs.readFileSync(path.join(__dirname, '..', 'assets', 'reader.js'), 'utf8');
const para = i => `<p>Absatz ${i}: Die Kirschblüte in Japan beginnt meist Ende März im Süden und zieht dann langsam nach Norden. Viele Menschen feiern Hanami unter den Bäumen, mit Picknick und Freunden, und genießen die kurze Zeit der Blüte.</p>`;
const ARTICLE = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Kirschblüte 2026</title><style>body{background:red}</style></head><body>
  <nav>Menü Startseite Kontakt Impressum</nav><div class="ad">Werbung kaufen</div>
  <article><h1>Wann blühen die Kirschen?</h1><p class="byline">Von Aiko Tanaka</p>${[1, 2, 3, 4, 5, 6, 7, 8].map(para).join('')}
  <p>Mehr dazu <a href="https://example.org/mehr" onclick="window.bad=1">hier</a>.</p><script>window.bad=2</script><iframe src="https://ads.example/"></iframe>
  <img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" onerror="window.bad=3"></article><footer>© Zeitung</footer></body></html>`;
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage();
  await pg.route('https://zeitung.example/**', r => r.fulfill({ contentType: 'text/html; charset=utf-8', body: r.request().url().endsWith('/start') ? '<title>Start</title><a href="/a">A</a><a href="/b">B</a>' : ARTICLE }));
  await pg.goto('https://zeitung.example/artikel');
  const readable = await pg.evaluate(`(function(){${able};return isProbablyReaderable(document,{minContentLength:180,minScore:30})})()`);
  assert.equal(readable, true, 'Artikel erkannt');
  await pg.evaluate(`(function(){${lib};window.__sakuraReadability=Readability})()`);
  const badBefore = await pg.evaluate(() => { const b = window.bad; window.bad = 'vorher'; return b; });
  assert(badBefore, 'die alte Seite selbst hat beim Laden etwas ausgeführt');
  await pg.evaluate(() => { window.__sakuraReaderPrefs = { size: 22, theme: 'dunkel' }; window.saved = []; document.addEventListener('sakura-reader-prefs', e => window.saved.push(JSON.parse(e.detail))); });
  assert.equal(await pg.evaluate(view), true);
  const r = await pg.evaluate(() => ({
    title: document.querySelector('.sr-title').textContent, meta: document.querySelector('.sr-meta').textContent,
    nav: !!document.querySelector('nav, .ad, footer'), scripts: document.querySelectorAll('.sr-content script, .sr-content iframe').length,
    onclick: !!document.querySelector('.sr-content [onclick], .sr-content [onerror]'), link: document.querySelector('.sr-content a').target,
    styles: document.querySelectorAll('style').length, theme: document.documentElement.getAttribute('data-sr-theme'), bad: window.bad
  }));
  assert.equal(r.title, 'Wann blühen die Kirschen?'); assert.equal(await pg.evaluate(() => document.querySelectorAll('.sr-content h1').length), 0, 'nicht doppelt'); assert(/Aiko Tanaka/.test(r.meta) && /Min\. Lesezeit/.test(r.meta), r.meta);
  assert.equal(r.nav, false, 'Menü, Werbung, Fußzeile weg'); assert.equal(r.scripts, 0); assert.equal(r.onclick, false); assert.equal(r.link, '_blank');
  assert.equal(r.styles, 0, 'Stile der Seite entfernt'); assert.equal(r.theme, 'dunkel'); await pg.waitForTimeout(300); assert.equal(await pg.evaluate(() => window.bad), 'vorher', 'nichts aus dem Artikel ausgeführt');
  await pg.click('text=A+'); await pg.click('text=Hell');
  assert.deepEqual(await pg.evaluate(() => window.saved), [{ size: 24, theme: 'dunkel' }, { size: 24, theme: 'hell' }]);
  assert.equal(await pg.evaluate(view), 'schon');
  // Keine Artikelseite
  await pg.goto('https://zeitung.example/start');
  assert.equal(await pg.evaluate(`(function(){${able};return isProbablyReaderable(document,{minContentLength:180,minScore:30})})()`), false);
  await pg.evaluate(`(function(){${lib};window.__sakuraReadability=Readability})()`);
  assert.equal(await pg.evaluate(view), false, 'zu wenig Text');
  await b.close();
  console.log('Lesemodus ok');
})().catch(e => { console.error(e.stack); process.exit(1); });
