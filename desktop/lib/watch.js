// Seitenüberwachung: Produktseiten regelmäßig prüfen und bei Preisänderung oder „wieder verfügbar“ melden.
// Das Auslesen (assets/watch.js in einer unsichtbaren Seite) übernimmt main.js über extract(url).
const { EventEmitter } = require('events');
const M = require('./model');

const MAX_WATCHES = 100;
const HISTORY = 30;

const fmtPrice = (p, cur) => p == null ? '' : p.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (cur ? ' ' + cur : '');

/** Was hat sich geändert? Ergebnis: { kind: 'down' | 'up' | 'back' | 'gone', text } oder null */
function compare(old, now) {
  if (old.available === false && now.available === true) return { kind: 'back', text: 'Wieder verfügbar' + (now.price != null ? ' – ' + fmtPrice(now.price, now.currency || old.currency) : '') };
  if (old.price != null && now.price != null && Math.abs(old.price - now.price) >= 0.01) {
    const down = now.price < old.price;
    const pct = Math.round(Math.abs(now.price - old.price) / old.price * 100);
    return { kind: down ? 'down' : 'up', text: `Preis ${down ? 'gesunken' : 'gestiegen'}: ${fmtPrice(old.price, old.currency)} → ${fmtPrice(now.price, now.currency || old.currency)}${pct ? ` (${down ? '−' : '+'}${pct} %)` : ''}` };
  }
  if (old.available === true && now.available === false) return { kind: 'gone', text: 'Nicht mehr verfügbar' };
  return null;
}

class Watcher extends EventEmitter {
  /** store: Sakura-Store, extract(url): Promise<{ title, price, currency, available }> */
  constructor({ store, extract }) {
    super();
    this.store = store; this.extract = extract; this.busy = false;
    if (!Array.isArray(store.data.watches)) store.data.watches = [];
  }
  get all() { return this.store.data.watches; }
  list() { return this.all.map(w => ({ ...w, history: undefined, priceText: fmtPrice(w.price, w.currency) })); }

  /** Neue Überwachung aus einem bereits ausgelesenen Ergebnis */
  add(url, r) {
    if (!/^https?:\/\//i.test(url)) throw new Error('Nur Webseiten lassen sich überwachen.');
    if (!r || (r.price == null && r.available == null)) throw new Error('Auf dieser Seite wurde kein Preis und keine Verfügbarkeit gefunden.');
    const old = this.all.find(w => w.url === url);
    if (old) return old;
    if (this.all.length >= MAX_WATCHES) throw new Error('Du überwachst schon ' + MAX_WATCHES + ' Seiten.');
    const now = Date.now();
    const w = { id: M.newId(), url, title: r.title || url, price: r.price, currency: r.currency || '', available: r.available, addedAt: now, lastCheck: now, lastChange: 0, last: null, history: [{ at: now, price: r.price, available: r.available }] };
    this.all.push(w);
    this.store.save();
    return w;
  }
  remove(id) { this.store.data.watches = this.all.filter(w => w.id !== id); this.store.save(); }

  async checkOne(w) {
    let r;
    try { r = await this.extract(w.url); } catch (e) { w.error = 'Seite nicht erreichbar'; w.lastCheck = Date.now(); this.store.save(); return null; }
    w.lastCheck = Date.now();
    if (!r || (r.price == null && r.available == null)) { w.error = 'Preis nicht mehr gefunden'; this.store.save(); return null; }
    w.error = '';
    const change = compare(w, r);
    if (r.price != null) w.price = r.price;
    if (r.currency) w.currency = r.currency;
    if (r.available != null) w.available = r.available;
    if (r.title && (!w.title || w.title === w.url)) w.title = r.title;
    if (change) {
      w.lastChange = Date.now(); w.last = change;
      w.history = [...(w.history || []), { at: Date.now(), price: w.price, available: w.available }].slice(-HISTORY);
      this.emit('change', w, change);
    }
    this.store.save();
    return change;
  }

  /** Alle fälligen Seiten nacheinander prüfen (hours = Abstand zwischen zwei Prüfungen) */
  async checkDue(hours = 3, force = false) {
    if (this.busy) return 0;
    this.busy = true;
    let n = 0;
    try {
      for (const w of [...this.all]) {
        if (!force && Date.now() - (w.lastCheck || 0) < hours * 3600e3) continue;
        if (!this.all.includes(w)) continue;
        await this.checkOne(w);
        n++;
      }
    } finally { this.busy = false; }
    return n;
  }
}

module.exports = { Watcher, compare, fmtPrice };
