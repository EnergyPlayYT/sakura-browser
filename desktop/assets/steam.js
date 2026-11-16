/* Sakura – Steam-Shop: Kasten mit Spielern online, durchschnittlicher Spielzeit und Preisvergleich auf Spielseiten.
 * Daten liefert window.sakuraSteam.info(appid) (Hauptprozess). */
(function () {
  if (window.__sakuraSteam) return;
  window.__sakuraSteam = true;
  const m = /\/app\/(\d+)/.exec(location.pathname);
  if (!m || !window.sakuraSteam) return;
  const appid = m[1];
  const n = x => Number(x).toLocaleString('de-DE');
  const money = (v, c) => Number(v).toLocaleString('de-DE', { style: 'currency', currency: c || 'EUR' });
  const hours = min => { const h = min / 60; return h >= 10 ? Math.round(h) + ' Std.' : (Math.round(h * 10) / 10).toLocaleString('de-DE') + ' Std.'; };

  function el(tag, style, text) { const e = document.createElement(tag); if (style) e.setAttribute('style', style); if (text != null) e.textContent = text; return e; }
  function row(label, value, sub) {
    const r = el('div', 'display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-top:1px solid rgba(255,255,255,.07)');
    r.appendChild(el('span', 'color:#8f98a0', label));
    const v = el('span', 'color:#fff;text-align:right', value);
    if (sub) { v.appendChild(el('br')); v.appendChild(el('small', 'color:#8f98a0', sub)); }
    r.appendChild(v);
    return r;
  }

  window.sakuraSteam.info(appid).then(d => {
    if (!d) return;
    const box = el('div', 'margin:0 0 12px;padding:12px 14px;border-radius:6px;background:linear-gradient(135deg,rgba(242,179,197,.12),rgba(28,26,51,.6));' +
      'box-shadow:inset 0 0 0 1px rgba(242,179,197,.35);font:13px/1.4 "Motiva Sans",Arial,sans-serif;color:#c6d4df');
    box.id = 'sakura-steam';
    box.appendChild(el('div', 'font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#F2B3C5;margin-bottom:6px', 'Sakura · Spielinfos'));
    if (d.players != null) box.appendChild(row('Spieler gerade online', n(d.players)));
    if (d.playtime) box.appendChild(row('Spielzeit im Schnitt', hours(d.playtime.average || d.playtime.median), 'Median ' + hours(d.playtime.median || d.playtime.average) + ' · SteamSpy'));
    if (d.prices && d.prices.deals && d.prices.deals.length) {
      for (const deal of d.prices.deals) {
        const r = row(deal.shop, money(deal.price, deal.currency) + (deal.cut ? `  −${deal.cut} %` : ''));
        if (deal.url) { r.style.cursor = 'pointer'; r.title = 'Angebot öffnen'; r.addEventListener('click', () => window.open(deal.url, '_blank')); }
        box.appendChild(r);
      }
      if (d.prices.low) box.appendChild(row('Bestpreis bisher', money(d.prices.low.price, d.prices.low.currency), 'IsThereAnyDeal'));
    } else if (!d.hasKey) {
      box.appendChild(el('div', 'padding-top:6px;color:#8f98a0;font-size:12px', 'Preisvergleich: in den Sakura-Einstellungen einen IsThereAnyDeal-Schlüssel eintragen.'));
    }
    const target = document.querySelector('.rightcol.game_meta_data') || document.querySelector('.glance_ctn') || document.querySelector('#game_area_purchase');
    if (target) target.insertBefore(box, target.firstChild);
  });
})();
