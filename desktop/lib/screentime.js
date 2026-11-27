// Bildschirmzeit: wie lange war welche Seite im Vordergrund (nur lokal, nie synchronisiert).
const KEEP_DAYS = 30;
const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

class ScreenTime {
  constructor(store) { this.store = store; }
  get data() {
    const d = this.store.data.screenTime;
    return d && typeof d === 'object' ? d : (this.store.data.screenTime = {});
  }
  /** seconds Sekunden für host gutschreiben */
  add(host, seconds, now = Date.now()) {
    host = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!host || !(seconds > 0)) return;
    const k = dayKey(now);
    const day = this.data[k] || (this.data[k] = {});
    day[host] = Math.round((day[host] || 0) + seconds);
    if (Object.keys(day).length > 400) { // sehr viele Seiten: die kleinsten verwerfen
      for (const [h] of Object.entries(day).sort((a, b) => a[1] - b[1]).slice(0, 100)) delete day[h];
    }
    const cut = dayKey(now - KEEP_DAYS * 864e5);
    for (const key of Object.keys(this.data)) if (key < cut) delete this.data[key];
  }
  /** Übersicht: heute (Seiten sortiert) und die letzten 7 Tage (Summe pro Tag) */
  summary(now = Date.now()) {
    const today = this.data[dayKey(now)] || {};
    const sites = Object.entries(today).map(([host, s]) => ({ host, seconds: s })).sort((a, b) => b.seconds - a.seconds);
    const week = [];
    for (let i = 6; i >= 0; i--) {
      const ts = now - i * 864e5, day = this.data[dayKey(ts)] || {};
      week.push({ day: new Date(ts).getDay(), seconds: Object.values(day).reduce((a, b) => a + b, 0), today: i === 0 });
    }
    return { total: sites.reduce((a, b) => a + b.seconds, 0), sites: sites.slice(0, 15), week };
  }
  clear() { this.store.data.screenTime = {}; }
}

module.exports = { ScreenTime, dayKey };
