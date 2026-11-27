// Fokus-Modus: ablenkende Seiten sperren – zu festen Zeiten (Wochentage + Uhrzeit) oder spontan für X Minuten.
const DEFAULT_SITES = ['tiktok.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com', 'reddit.com', 'snapchat.com'];

function normalize(cfg) {
  cfg = cfg && typeof cfg === 'object' ? cfg : {};
  const time = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(v || '') ? v : null;
  return {
    sites: Array.isArray(cfg.sites) ? cfg.sites.map(cleanSite).filter(Boolean).slice(0, 200) : DEFAULT_SITES.slice(),
    scheduled: cfg.scheduled === true,
    days: Array.isArray(cfg.days) ? cfg.days.filter(d => Number.isInteger(d) && d >= 0 && d <= 6) : [1, 2, 3, 4, 5],
    from: time(cfg.from) || '08:00',
    to: time(cfg.to) || '15:00',
    until: Number(cfg.until) || 0 // spontane Fokus-Zeit bis (Zeitstempel)
  };
}
/** „https://www.TikTok.com/foo“ → „tiktok.com“ */
function cleanSite(s) {
  s = String(s || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : '';
}
const minutes = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

/** Bis wann ist der Fokus gerade aktiv? 0 = nicht aktiv */
function activeUntil(cfg, now = Date.now()) {
  cfg = normalize(cfg);
  let until = cfg.until > now ? cfg.until : 0;
  if (cfg.scheduled) {
    const d = new Date(now), cur = d.getHours() * 60 + d.getMinutes();
    const a = minutes(cfg.from), b = minutes(cfg.to);
    const inRange = a < b ? cur >= a && cur < b : cur >= a || cur < b; // auch über Mitternacht
    // bei Zeiten über Mitternacht zählt der Wochentag des Beginns
    const day = a < b || cur >= a ? d.getDay() : (d.getDay() + 6) % 7;
    if (inRange && cfg.days.includes(day)) {
      const end = new Date(d); end.setHours(Math.floor(b / 60), b % 60, 0, 0);
      if (end.getTime() <= now) end.setDate(end.getDate() + 1);
      until = Math.max(until, end.getTime());
    }
  }
  return until;
}

function blocks(host, cfg, now = Date.now()) {
  host = String(host || '').toLowerCase().replace(/^www\./, '');
  if (!host || !activeUntil(cfg, now)) return false;
  return normalize(cfg).sites.some(s => host === s || host.endsWith('.' + s));
}

module.exports = { normalize, cleanSite, activeUntil, blocks, DEFAULT_SITES };
