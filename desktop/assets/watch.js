/* Sakura – Seitenüberwachung: Preis und Verfügbarkeit einer Produktseite auslesen.
 * Ergebnis: { title, price (Zahl oder null), currency, available (true/false/null), text (Kurzfassung als Rückfall) } */
(function () {
  const out = { title: document.title, price: null, currency: '', available: null, text: '' };

  // Preis aus Text wie „1.299,99 €“, „€ 39,90“, „$1,299.99“, „39.-“, „1.299 €“
  function parsePrice(s) {
    const m = String(s == null ? '' : s).replace(/[\s\u00a0']/g, '').match(/\d[\d.,]*/);
    if (!m) return null;
    let n = m[0].replace(/[.,]+$/, '');
    const seps = n.match(/[.,]/g) || [];
    if (seps.length) {
      const last = Math.max(n.lastIndexOf(','), n.lastIndexOf('.'));
      const after = n.length - last - 1;
      const mixed = n.includes(',') && n.includes('.');
      // Dezimaltrenner: das letzte Zeichen, wenn beide vorkommen oder danach 1–2 Ziffern folgen
      if (mixed || (seps.length === 1 && after <= 2)) n = n.slice(0, last).replace(/[.,]/g, '') + '.' + n.slice(last + 1);
      else n = n.replace(/[.,]/g, ''); // nur Tausenderpunkte
    }
    const v = parseFloat(n);
    return isFinite(v) && v > 0 && v < 1e8 ? Math.round(v * 100) / 100 : null;
  }
  const curOf = s => (String(s || '').match(/€|EUR|\$|USD|£|GBP|CHF|zł|PLN|TRY|₺/i) || [''])[0].replace('EUR', '€').replace('USD', '$').replace('GBP', '£');
  const availOf = v => {
    const s = String(v || '').toLowerCase();
    if (/outofstock|soldout|discontinued|backorder/.test(s)) return false;
    if (/instock|limitedavailability|onlineonly|preorder|presale/.test(s)) return true;
    return null;
  };

  // 1. Strukturierte Daten (schema.org Product → offers)
  const nodes = [];
  const walk = x => { if (!x || typeof x !== 'object') return; if (Array.isArray(x)) return x.forEach(walk); nodes.push(x); if (x['@graph']) walk(x['@graph']); };
  for (const s of document.querySelectorAll('script[type="application/ld+json"]')) { try { walk(JSON.parse(s.textContent)); } catch (e) {} }
  const isType = (n, t) => [].concat(n['@type'] || []).some(x => String(x).toLowerCase() === t);
  const product = nodes.find(n => isType(n, 'product'));
  if (product) {
    if (product.name) out.title = String(product.name).slice(0, 200);
    const offers = [].concat(product.offers || []).flatMap(o => (o && o.offers ? [].concat(o.offers) : [o])).filter(Boolean);
    const o = offers[0];
    if (o) {
      const p = o.price != null ? o.price : o.lowPrice != null ? o.lowPrice : (o.priceSpecification && o.priceSpecification.price);
      if (p != null) out.price = typeof p === 'number' ? p : parsePrice(p);
      out.currency = o.priceCurrency === 'EUR' ? '€' : o.priceCurrency === 'USD' ? '$' : o.priceCurrency === 'GBP' ? '£' : (o.priceCurrency || '');
      out.available = availOf(o.availability);
    }
  }
  // 2. Meta-Angaben und Mikrodaten
  const meta = n => { const m = document.querySelector(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`); return m ? m.getAttribute('content') : null; };
  if (out.price == null) {
    const p = meta('product:price:amount') || meta('og:price:amount') || meta('price');
    if (p) { out.price = parsePrice(p); out.currency = out.currency || curOf(meta('product:price:currency') || meta('og:price:currency')) || meta('product:price:currency') || ''; }
  }
  if (out.price == null) {
    const el = document.querySelector('[itemprop="price"]');
    if (el) { out.price = parsePrice(el.getAttribute('content') || el.textContent); const c = document.querySelector('[itemprop="priceCurrency"]'); out.currency = out.currency || curOf(c ? c.getAttribute('content') || c.textContent : el.textContent); }
  }
  if (out.available == null) {
    const a = document.querySelector('[itemprop="availability"]');
    if (a) out.available = availOf(a.getAttribute('href') || a.getAttribute('content') || a.textContent);
  }
  // 3. Bekannte Shops und übliche Preisfelder
  if (out.price == null) {
    const sel = ['#corePrice_feature_div .a-offscreen', '#corePriceDisplay_desktop_feature_div .a-offscreen', '.a-price .a-offscreen', '#priceblock_ourprice',
      '[data-testid="price"]', '[data-test="product-price"]', '.product-price', '.price--main', '.price .amount', '.price'];
    for (const s of sel) {
      const el = document.querySelector(s);
      const v = el && parsePrice(el.textContent);
      if (v) { out.price = v; out.currency = out.currency || curOf(el.textContent); break; }
    }
  }
  // 4. Verfügbarkeit aus dem Text
  if (out.available == null) {
    const body = (document.body ? document.body.innerText : '').slice(0, 200000).toLowerCase();
    if (/derzeit nicht verfügbar|nicht lieferbar|ausverkauft|vergriffen|currently unavailable|out of stock|sold out/.test(body)) out.available = false;
    else if (/in den (einkaufswagen|warenkorb)|jetzt kaufen|add to (cart|basket)|buy now|auf lager|sofort lieferbar|in stock/.test(body)) out.available = true;
  }
  out.text = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').trim().slice(0, 2000);
  out.title = String(out.title || '').trim().slice(0, 200);
  return out;
})()
