// Cookie-Banner ablehnen: nachgebaute Banner in einem echten Chromium (wird übersprungen, wenn Playwright fehlt)
const assert = require('assert');
const fs = require('fs'), path = require('path');
const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'cookie-reject.js'), 'utf8');
const A = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'assets', 'cookie-reject.js');
assert.equal(fs.readFileSync(A, 'utf8'), code, 'cookie-reject.js nach Android kopieren!');
let chromium;
try { ({ chromium } = require('playwright')); } catch { console.log('Cookie-Banner: Playwright fehlt, Browser-Test übersprungen'); process.exit(0); }

const CASES = [
  ['OneTrust', `<div id="onetrust-banner-sdk"><button id="onetrust-accept-btn-handler" onclick="r='accept'">Alle akzeptieren</button><button id="onetrust-reject-all-handler" onclick="r='reject'">Alle ablehnen</button></div>`, 'reject'],
  ['Text in Cookie-Box', `<div class="cookie-notice"><a href="/x" onclick="r='nav';return false">Alle ablehnen</a><button onclick="r='accept'">Akzeptieren</button><button onclick="r='reject'">Nur notwendige Cookies</button></div>`, 'reject'],
  ['Fremder Ablehnen-Knopf', `<div class="comments"><button onclick="r='wrong'">Ablehnen</button></div>`, undefined],
  ['Unsichtbar', `<div class="consent" style="display:none"><button onclick="r='hidden'">Reject all</button></div>`, undefined],
  ['Später eingeblendet', `<script>setTimeout(()=>{document.body.insertAdjacentHTML('beforeend','<div id="cmp-box"><button onclick="r=\\'reject\\'">Reject all</button></div>')},600)</script>`, 'reject'],
  ['Shadow-DOM', `<div id="usercentrics-root"></div><script>const s=document.querySelector('#usercentrics-root').attachShadow({mode:'open'});s.innerHTML='<div class="banner"><button onclick="window.r=\\'accept\\'">OK</button><button data-testid="uc-deny-all-button" onclick="window.r=\\'reject\\'">Ablehnen</button></div>'</script>`, 'reject'],
  ['Borlabs 2', `<div id="BorlabsCookieBox"><div class="_brlbs-bar"><a class="_brlbs-btn" href="#" onclick="r='accept';return false">Alle akzeptieren</a><p class="_brlbs-refuse"><a href="#" data-cookie-refuse onclick="r='reject';return false">Ablehnen</a></p></div></div>`, 'reject'],
  ['Dialog ohne Namen', `<div role="dialog" aria-modal="true" class="x1"><h2>Privatsphäre-Einstellungen</h2><p>Wir nutzen Cookies.</p><button onclick="r='accept'">Alle akzeptieren</button><button onclick="r='reject'">Ablehnen</button></div>`, 'reject'],
  ['Fremder Dialog', `<div role="dialog" class="x1"><p>Freundschaftsanfrage</p><button onclick="r='wrong'">Ablehnen</button></div>`, undefined],
  ['Unbekanntes Shadow-DOM', `<div id="xyz"></div><script>const t=document.querySelector('#xyz').attachShadow({mode:'open'});t.innerHTML='<div class="brlbs-cmpnt-dialog"><button onclick="window.r=\\'accept\\'">Alle akzeptieren</button><button onclick="window.r=\\'reject\\'">Ablehnen</button></div>'</script>`, 'reject']
];
(async () => {
  const b = await chromium.launch();
  for (const [name, html, want] of CASES) {
    const pg = await b.newPage();
    await pg.setContent(`<body>${html}<script>var r;</script></body>`);
    await pg.evaluate(code);
    await pg.waitForTimeout(want === 'reject' && /Später/.test(name) ? 1200 : 400);
    assert.equal(await pg.evaluate(() => window.r), want, name);
    await pg.close();
  }
  await b.close();
  console.log('Cookie-Banner ok, ' + CASES.length + ' Fälle');
})().catch(e => { console.error(e.message); process.exit(1); });
