// Live-Benachrichtigungen: prüft gemerkte Twitch-Kanäle und YouTube-Kanäle, ob sie gerade live sind.
// Ohne Konto und ohne Schlüssel: Sakura liest die öffentliche Kanalseite.
const TWITCH_LOGIN = /^[a-z0-9_]{3,25}$/;
const YT_ID = /^UC[\w-]{22}$/;
const YT_HANDLE = /^@[\w.-]{3,40}$/;
const NOT_CHANNEL = new Set(['directory', 'videos', 'settings', 'downloads', 'jobs', 'p', 'search', 'subscriptions', 'inventory', 'wallet', 'drops', 'turbo', 'friends', 'messages', 'moderator', 'popout', 'embed']);

/** Kanal aus einer Adresse ableiten (Twitch-Kanal, YouTube-Kanal per @Name oder /channel/UC…) */
function channelFromUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  if (/(^|\.)twitch\.tv$/.test(u.hostname)) {
    const login = (parts[0] || '').toLowerCase();
    if (!TWITCH_LOGIN.test(login) || NOT_CHANNEL.has(login)) return null;
    return { kind: 'twitch', key: 'twitch:' + login, name: login, url: 'https://www.twitch.tv/' + login };
  }
  if (/(^|\.)youtube\.com$/.test(u.hostname)) {
    if (YT_HANDLE.test(parts[0] || '')) return { kind: 'youtube', key: 'youtube:' + parts[0].toLowerCase(), name: parts[0], url: 'https://www.youtube.com/' + parts[0] };
    if (parts[0] === 'channel' && YT_ID.test(parts[1] || '')) return { kind: 'youtube', key: 'youtube:' + parts[1], name: parts[1], url: 'https://www.youtube.com/channel/' + parts[1] };
  }
  return null;
}
function youtubeChannel(id, name) {
  if (!YT_ID.test(String(id || ''))) return null;
  return { kind: 'youtube', key: 'youtube:' + id, name: String(name || id).slice(0, 80), url: 'https://www.youtube.com/channel/' + id };
}

/** Ist der Kanal laut HTML der öffentlichen Seite live? Liefert { live, title } */
function parseLive(kind, html) {
  html = String(html || '');
  if (kind === 'twitch') {
    const live = /"isLiveBroadcast"\s*:\s*true/.test(html);
    const m = /<meta[^>]+property="og:description"[^>]+content="([^"]*)"/i.exec(html);
    return { live, title: live && m ? decode(m[1]) : '' };
  }
  const live = /"isLiveNow"\s*:\s*true/.test(html) || /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}"/.test(html) && /"isLive"\s*:\s*true/.test(html);
  const m = /<meta name="title" content="([^"]*)"/i.exec(html) || /<title>([^<]*)<\/title>/i.exec(html);
  return { live, title: live && m ? decode(m[1]).replace(/ - YouTube$/, '') : '' };
}
const decode = s => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').slice(0, 140);

class LiveWatch {
  constructor({ store, fetch, notify }) { this.store = store; this.fetch = fetch; this.notify = notify; this.busy = false; }
  list() { return Array.isArray(this.store.data.liveChannels) ? this.store.data.liveChannels : (this.store.data.liveChannels = []); }
  has(key) { return this.list().some(c => c.key === key); }
  add(ch) {
    if (!ch || this.has(ch.key)) return false;
    if (this.list().length >= 50) return false;
    this.list().push({ ...ch, live: false, title: '', checked: 0 });
    this.store.save();
    return true;
  }
  remove(key) { this.store.data.liveChannels = this.list().filter(c => c.key !== key); this.store.save(); }
  liveUrl(c) { return c.kind === 'twitch' ? c.url : c.url + '/live'; }
  async check() {
    if (this.busy) return;
    this.busy = true;
    try {
      for (const c of this.list()) {
        let r;
        try {
          const res = await this.fetch(this.liveUrl(c), { headers: c.kind === 'youtube' ? { 'Accept-Language': 'de-DE,de;q=0.9', Cookie: 'SOCS=CAI' } : { 'Accept-Language': 'de-DE,de;q=0.9' } });
          if (!res.ok) continue;
          r = parseLive(c.kind, await res.text());
        } catch { continue; }
        const wasLive = c.live;
        c.live = r.live; c.title = r.title; c.checked = Date.now();
        if (r.live && !wasLive && c.notifiedAt !== undefined) this.notify(c);
        if (r.live && !wasLive) c.notifiedAt = Date.now();
        if (c.notifiedAt === undefined) c.notifiedAt = 0; // erste Prüfung: nur merken, nicht melden
      }
      this.store.save();
    } finally { this.busy = false; }
  }
}

module.exports = { LiveWatch, channelFromUrl, youtubeChannel, parseLive };
