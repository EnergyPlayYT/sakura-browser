// Seitenüberwachung: Preis/Verfügbarkeit erkennen, Änderungen melden
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Watcher, compare } = require('../lib/watch');
const Store = require('../lib/store');

assert.equal(compare({ price: 49.99, currency: '€' }, { price: 39.99 }).text, 'Preis gesunken: 49,99 € → 39,99 € (−20 %)');
assert.equal(compare({ price: 10 }, { price: 12 }).kind, 'up');
assert.equal(compare({ available: false, price: 5, currency: '€' }, { available: true, price: 5 }).text, 'Wieder verfügbar – 5,00 €');
assert.equal(compare({ available: true }, { available: false }).kind, 'gone');
assert.equal(compare({ price: 10, available: true }, { price: 10, available: true }), null);

(async () => {
  const store = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'wt')));
  let next = { title: 'Kopfhörer', price: 59.9, currency: '€', available: true };
  const w = new Watcher({ store, extract: async () => next });
  assert.throws(() => w.add('https://shop.de/x', { title: 'Nix', price: null, available: null }), /kein Preis/);
  const e = w.add('https://shop.de/kopfhoerer', next);
  assert.equal(w.add('https://shop.de/kopfhoerer', next).id, e.id, 'nicht doppelt');
  const events = [];
  w.on('change', (x, c) => events.push(c.kind));
  assert.equal(await w.checkDue(3), 0, 'gerade erst geprüft');
  next = { price: 49.9, available: true };
  assert.equal(await w.checkDue(0, true), 1);
  next = { price: null, available: false };
  await w.checkDue(0, true);
  next = { price: 49.9, available: true };
  await w.checkDue(0, true);
  assert.deepEqual(events, ['down', 'gone', 'back']);
  assert.equal(w.list()[0].priceText, '49,90 €');
  w.extract = async () => { throw new Error('offline'); };
  await w.checkDue(0, true); assert.equal(w.list()[0].error, 'Seite nicht erreichbar');
  w.remove(e.id); assert.equal(w.list().length, 0);

  // Auslesen echter Seitenarten in Chromium
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { console.log('Seitenüberwachung ok (Browser-Test übersprungen)'); return; }
  const code = fs.readFileSync(path.join(__dirname, '..', 'assets', 'watch.js'), 'utf8');
  const PAGES = {
    jsonld: `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Laufschuh X","offers":{"@type":"Offer","price":"89.95","priceCurrency":"EUR","availability":"https://schema.org/InStock"}}]}</script>`,
    meta: `<title>Lampe</title><meta property="product:price:amount" content="24,99"><meta property="product:price:currency" content="EUR"><p>Ausverkauft</p>`,
    micro: `<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Buch</span><span itemprop="price" content="12.50">12,50 €</span><link itemprop="availability" href="https://schema.org/OutOfStock"></div>`,
    amazon: `<title>Tastatur</title><div id="corePrice_feature_div"><span class="a-price"><span class="a-offscreen">1.299,00 €</span></span></div><button>In den Einkaufswagen</button>`,
    aggregate: `<script type="application/ld+json">[{"@type":"Product","name":"Handy","offers":{"@type":"AggregateOffer","lowPrice":199,"priceCurrency":"EUR"}}]</script>`,
    nix: `<title>Blog</title><p>Hallo</p>`
  };
  const b = await chromium.launch(); const pg = await b.newPage();
  const res = {};
  for (const [k, html] of Object.entries(PAGES)) { await pg.setContent(`<!doctype html><meta charset="utf-8">${html}`); res[k] = await pg.evaluate(code); }
  await b.close();
  const pick = r => [r.title, r.price, r.currency, r.available];
  assert.deepEqual(pick(res.jsonld), ['Laufschuh X', 89.95, '€', true]);
  assert.deepEqual(pick(res.meta), ['Lampe', 24.99, '€', false]);
  assert.deepEqual(pick(res.micro), ['', 12.5, '€', false].map((x, i) => i === 0 ? res.micro.title : x));
  assert.deepEqual(pick(res.amazon), ['Tastatur', 1299, '€', true]);
  assert.deepEqual(pick(res.aggregate), ['Handy', 199, '€', null]);
  assert.deepEqual([res.nix.price, res.nix.available], [null, null]);
  console.log('Seitenüberwachung ok');
})().catch(e => { console.error(e.stack); process.exit(1); });
