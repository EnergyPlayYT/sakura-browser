// Webseiten-Logos (Favicons): merken, einmal laden, auf der Festplatte zwischenspeichern.
// Es wird nur die jeweilige Webseite selbst gefragt – kein fremder Dienst.
const fs = require('fs');
const path = require('path');

const MAX_BYTES = 300 * 1024;
const RETRY_AFTER = 24 * 3600 * 1000;

/** Erkennt das Bildformat am Inhalt; HTML-Fehlerseiten u. Ä. werden abgelehnt */
function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  const b = buf;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return 'image/x-icon';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b.toString('latin1', 0, 3) === 'GIF') return 'image/gif';
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  const head = b.toString('utf8', 0, Math.min(b.length, 512)).trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

class Favicons {
  constructor({ dir, store, fetchFn }) {
    this.dir = dir;
    this.store = store;
    this.fetch = fetchFn;
    this.mem = new Map();     // host → { buf, type }
    this.failed = new Map();  // host → Zeitpunkt des letzten Fehlversuchs
    this.pending = new Map(); // host → Promise
    fs.mkdirSync(dir, { recursive: true });
    if (!store.data.faviconUrls || typeof store.data.faviconUrls !== 'object') store.data.faviconUrls = {};
  }

  hostOf(u) {
    try {
      const x = new URL(u);
      return /^https?:$/.test(x.protocol) ? x.hostname.toLowerCase() : null;
    } catch { return null; }
  }

  file(host) { return path.join(this.dir, host.replace(/[^a-z0-9.-]/g, '_')); }

  /** Eine Seite hat ihr Logo gemeldet (page-favicon-updated) */
  remember(pageUrl, iconUrl) {
    const host = this.hostOf(pageUrl);
    if (!host || !/^https?:/i.test(String(iconUrl || ''))) return;
    if (this.store.data.faviconUrls[host] === iconUrl && this.mem.has(host)) return;
    this.store.data.faviconUrls[host] = iconUrl;
    this.store.save();
    this.failed.delete(host);
    this.load(host, true).catch(() => {});
  }

  async download(url) {
    const res = await this.fetch(url, { redirect: 'follow' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('zu groß');
    const type = sniff(buf);
    if (!type) throw new Error('kein Bild');
    return { buf, type };
  }

  async load(host, force = false) {
    if (!force) {
      if (this.mem.has(host)) return this.mem.get(host);
      try {
        const buf = fs.readFileSync(this.file(host));
        const type = sniff(buf);
        if (type) { const v = { buf, type }; this.mem.set(host, v); return v; }
      } catch {}
      const f = this.failed.get(host);
      if (f && Date.now() - f < RETRY_AFTER) return null;
    }
    if (this.pending.has(host)) return this.pending.get(host);
    const job = (async () => {
      const candidates = [this.store.data.faviconUrls[host], `https://${host}/favicon.ico`].filter(Boolean);
      for (const url of [...new Set(candidates)]) {
        try {
          const v = await this.download(url);
          this.mem.set(host, v);
          fs.writeFile(this.file(host), v.buf, () => {});
          this.failed.delete(host);
          return v;
        } catch {}
      }
      this.failed.set(host, Date.now());
      return null;
    })();
    this.pending.set(host, job);
    try { return await job; } finally { this.pending.delete(host); }
  }

  /** Antwort für sakura://favicon/?u=<Adresse der Seite> */
  async respond(pageUrl) {
    const host = this.hostOf(pageUrl);
    const v = host ? await this.load(host).catch(() => null) : null;
    if (!v) return new Response('', { status: 404 });
    return new Response(v.buf, { headers: { 'Content-Type': v.type, 'Cache-Control': 'max-age=86400' } });
  }
}

module.exports = { Favicons, sniff };
