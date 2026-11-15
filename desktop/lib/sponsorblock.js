// SponsorBlock: Sponsor-Abschnitte von YouTube-Videos abfragen.
// Datenschutz: Es wird nur der Anfang des SHA-256-Werts der Video-ID gesendet (k-Anonymität);
// der Server antwortet mit allen Videos, deren Wert so beginnt, und wir suchen unseres heraus.
const crypto = require('crypto');

const API = 'https://sponsor.ajay.app/api/skipSegments/';
const CATEGORIES = ['sponsor', 'selfpromo', 'interaction'];
const CATEGORY_NAMES = { sponsor: 'Sponsor', selfpromo: 'Eigenwerbung', interaction: 'Abo-Erinnerung' };
const isVideoId = id => /^[A-Za-z0-9_-]{11}$/.test(String(id || ''));

function hashPrefix(id) {
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 4);
}

/** Aus der Server-Antwort die Abschnitte genau dieses Videos holen */
function pickSegments(list, id) {
  const v = Array.isArray(list) ? list.find(x => x && x.videoID === id) : null;
  if (!v || !Array.isArray(v.segments)) return [];
  return v.segments
    .filter(s => s && Array.isArray(s.segment) && CATEGORIES.includes(s.category) && (s.actionType || 'skip') === 'skip')
    .map(s => ({ start: Number(s.segment[0]), end: Number(s.segment[1]), category: s.category, label: CATEGORY_NAMES[s.category] }))
    .filter(s => isFinite(s.start) && isFinite(s.end) && s.end - s.start >= 1)
    .sort((a, b) => a.start - b.start);
}

class SponsorBlock {
  constructor(fetchFn) {
    this.fetch = fetchFn;
    this.cache = new Map(); // id → { at, segments }
  }

  async segments(id) {
    if (!isVideoId(id)) return [];
    const hit = this.cache.get(id);
    if (hit && Date.now() - hit.at < 30 * 60e3) return hit.segments;
    let segments = [];
    try {
      const url = API + hashPrefix(id) + '?categories=' + encodeURIComponent(JSON.stringify(CATEGORIES));
      const r = await this.fetch(url, { headers: { Accept: 'application/json' } });
      if (r.ok) segments = pickSegments(await r.json(), id);
      // 404 = für diese Videos gibt es keine Abschnitte
    } catch { return []; } // offline → einfach nichts überspringen, später neu versuchen
    this.cache.set(id, { at: Date.now(), segments });
    if (this.cache.size > 300) this.cache.delete(this.cache.keys().next().value);
    return segments;
  }
}

const isYouTube = url => {
  try { return /(^|\.)youtube\.com$/.test(new URL(url).hostname) && /^https:$/.test(new URL(url).protocol); } catch { return false; }
};

module.exports = { SponsorBlock, hashPrefix, pickSegments, isVideoId, isYouTube, CATEGORIES };
