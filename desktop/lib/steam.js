// Steam: Infos für Spielseiten im Steam-Shop
//  - Spieler gerade online: offizielle Steam-Schnittstelle (GetNumberOfCurrentPlayers, ohne Schlüssel)
//  - Durchschnittliche Spielzeit: SteamSpy (freier Statistikdienst)
//  - Preisvergleich: offizielle API von IsThereAnyDeal – nur mit eigenem Schlüssel (Einstellungen)
const isAppId = id => /^\d{1,9}$/.test(String(id || ''));

class Steam {
  constructor(fetchFn) { this.fetch = fetchFn; this.cache = new Map(); }

  async json(url, opt) {
    const r = await this.fetch(url, { headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, ...(opt || {}) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  async cached(key, ms, fn) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.data;
    let data = null;
    try { data = await fn(); } catch { data = null; }
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  players(appid) {
    return this.cached('p' + appid, 5 * 60e3, async () => {
      const j = await this.json(`https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appid}`);
      return j.response && j.response.result === 1 ? Number(j.response.player_count) : null;
    });
  }

  playtime(appid) {
    return this.cached('t' + appid, 24 * 3600e3, async () => {
      const j = await this.json(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`);
      const avg = Number(j.average_forever) || 0, med = Number(j.median_forever) || 0; // Minuten
      return avg || med ? { average: avg, median: med } : null;
    });
  }

  /** Günstigste Angebote (bis zu 4 Shops) und Bestpreis bisher */
  prices(appid, key, country = 'DE') {
    if (!key) return Promise.resolve(null);
    return this.cached('pr' + appid + country, 3600e3, async () => {
      const k = encodeURIComponent(key);
      const look = await this.json(`https://api.isthereanydeal.com/games/lookup/v1?key=${k}&appid=${appid}`);
      const id = look && look.found && look.game && look.game.id;
      if (!id) return null;
      const res = await this.json(`https://api.isthereanydeal.com/games/prices/v3?key=${k}&country=${country}&deals=1`, { method: 'POST', body: JSON.stringify([id]) });
      const g = Array.isArray(res) ? res[0] : null;
      if (!g) return null;
      const deals = (g.deals || []).filter(d => d && d.price && d.shop)
        .map(d => ({ shop: String(d.shop.name || ''), price: Number(d.price.amount), currency: d.price.currency || 'EUR', cut: Number(d.cut) || 0, url: /^https:\/\//.test(d.url || '') ? d.url : null }))
        .sort((a, b) => a.price - b.price).slice(0, 4);
      const low = g.historyLow && (g.historyLow.all || g.historyLow);
      return { deals, low: low && low.amount != null ? { price: Number(low.amount), currency: low.currency || 'EUR' } : null, itad: `https://isthereanydeal.com/game/id:${id}/info/` };
    });
  }

  async info(appid, key) {
    if (!isAppId(appid)) return null;
    const [players, playtime, prices] = await Promise.all([this.players(appid), this.playtime(appid), this.prices(appid, key)]);
    return { players, playtime, prices, hasKey: !!key };
  }
}

module.exports = { Steam, isAppId };
