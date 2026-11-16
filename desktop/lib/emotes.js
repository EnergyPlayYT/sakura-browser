// Twitch-Emotes von 7TV, BetterTTV (BTTV) und FrankerFaceZ (FFZ): global und pro Kanal.
// Ergebnis für einen Kanal: { "KEKW": { url, src: '7tv' | 'bttv' | 'ffz' }, … } – Kanal-Emotes gewinnen vor globalen.
const LOGIN = /^[a-z0-9_]{2,25}$/;

const SEVEN = e => {
  const host = e.data && e.data.host;
  if (!host || !host.url) return null;
  const file = (host.files || []).find(f => f.name === '1x.webp') || (host.files || [])[0];
  return { url: 'https:' + host.url + '/' + (file ? file.name : '1x.webp'), src: '7tv' };
};
const BTTV = e => ({ url: `https://cdn.betterttv.net/emote/${e.id}/1x`, src: 'bttv' });
const FFZ = e => {
  const u = e.urls && (e.urls['1'] || e.urls['2']);
  return u ? { url: u.startsWith('//') ? 'https:' + u : u, src: 'ffz' } : null;
};

class Emotes {
  constructor(fetchFn) {
    this.fetch = fetchFn;
    this.cache = new Map(); // Schlüssel → { at, data }
  }

  async json(url) {
    const r = await this.fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }

  async cached(key, ms, fn) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.data;
    let data = {};
    try { data = await fn(); } catch { data = hit ? hit.data : {}; }
    this.cache.set(key, { at: Date.now(), data });
    return data;
  }

  /** Globale Emotes aller drei Dienste */
  global() {
    return this.cached('global', 6 * 3600e3, async () => {
      const out = {};
      const add = (name, v) => { if (name && v && !out[name]) out[name] = v; };
      const [ffz, bttv, seven] = await Promise.allSettled([
        this.json('https://api.frankerfacez.com/v1/set/global'),
        this.json('https://api.betterttv.net/3/cached/emotes/global'),
        this.json('https://7tv.io/v3/emote-sets/global')
      ]);
      if (seven.status === 'fulfilled') for (const e of seven.value.emotes || []) add(e.name, SEVEN(e));
      if (bttv.status === 'fulfilled') for (const e of bttv.value || []) add(e.code, BTTV(e));
      if (ffz.status === 'fulfilled') {
        const sets = ffz.value.sets || {};
        for (const id of ffz.value.default_sets || Object.keys(sets)) for (const e of (sets[id] || {}).emoticons || []) add(e.name, FFZ(e));
      }
      return out;
    });
  }

  /** Emotes eines Kanals (Login-Name aus der Adresse) */
  channel(login) {
    login = String(login || '').toLowerCase();
    if (!LOGIN.test(login)) return Promise.resolve({});
    return this.cached('ch:' + login, 3600e3, async () => {
      const out = {};
      const add = (name, v) => { if (name && v && !out[name]) out[name] = v; };
      // FFZ liefert nebenbei die Twitch-ID, die 7TV und BTTV brauchen
      let id = null;
      try {
        const ffz = await this.json('https://api.frankerfacez.com/v1/room/' + login);
        id = ffz.room && ffz.room.twitch_id;
        for (const set of Object.values(ffz.sets || {})) for (const e of set.emoticons || []) add(e.name, FFZ(e));
      } catch {}
      if (!id) {
        try { const u = await this.json('https://api.ivr.fi/v2/twitch/user?login=' + login); id = u && u[0] && u[0].id; } catch {}
      }
      if (id && /^\d+$/.test(String(id))) {
        const [seven, bttv] = await Promise.allSettled([
          this.json('https://7tv.io/v3/users/twitch/' + id),
          this.json('https://api.betterttv.net/3/cached/users/twitch/' + id)
        ]);
        // Reihenfolge: 7TV vor BTTV vor FFZ (wie die meisten Erweiterungen)
        const first = {};
        if (seven.status === 'fulfilled') for (const e of (seven.value.emote_set || {}).emotes || []) { const v = SEVEN(e); if (e.name && v) first[e.name] = v; }
        if (bttv.status === 'fulfilled') for (const e of [...(bttv.value.channelEmotes || []), ...(bttv.value.sharedEmotes || [])]) if (e.code && !first[e.code]) first[e.code] = BTTV(e);
        Object.assign(out, first, Object.fromEntries(Object.entries(out).filter(([k]) => !first[k])));
      }
      return out;
    });
  }

  /** Alles für einen Kanal: Kanal-Emotes überschreiben globale */
  async forChannel(login) {
    const [g, c] = await Promise.all([this.global(), this.channel(login)]);
    return { ...g, ...c };
  }
}

module.exports = { Emotes };
