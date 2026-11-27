// Wegwerf-E-Mail über mail.tm (kostenlos, ohne Anmeldung): Adresse erzeugen, Posteingang lesen.
// Zugangsdaten der Adresse bleiben nur auf diesem PC (store.data.tempMail).
const API = 'https://api.mail.tm';
const crypto = require('crypto');
const rnd = (n, abc) => Array.from(crypto.randomBytes(n), b => abc[b % abc.length]).join('');

class TempMail {
  constructor({ store, fetch }) { this.store = store; this.fetch = fetch; }
  get acc() { const a = this.store.data.tempMail; return a && a.address ? a : null; }
  async json(path, opt = {}) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...(opt.token ? { Authorization: 'Bearer ' + opt.token } : {}) };
    const r = await this.fetch(API + path, { method: opt.method || 'GET', headers, body: opt.body ? JSON.stringify(opt.body) : undefined });
    if (r.status === 401 && opt.retry !== false && this.acc) { await this.login(); return this.json(path, { ...opt, token: this.acc.token, retry: false }); }
    if (!r.ok) throw new Error(r.status === 429 ? 'Zu viele Anfragen – warte kurz und versuch es noch einmal.' : 'Der E-Mail-Dienst antwortet gerade nicht (' + r.status + ').');
    return r.status === 204 ? null : r.json();
  }
  async login() {
    const a = this.acc;
    const t = await this.json('/token', { method: 'POST', body: { address: a.address, password: a.password }, retry: false });
    a.token = t.token;
    this.store.save();
  }
  /** Neue Adresse anlegen (ersetzt die alte) */
  async create() {
    const d = await this.json('/domains');
    const list = (d && (d['hydra:member'] || d.member || d)) || [];
    const domain = (Array.isArray(list) ? list : []).map(x => x && x.domain).find(Boolean);
    if (!domain) throw new Error('Der E-Mail-Dienst hat gerade keine Adressen frei.');
    const address = `sakura.${rnd(10, 'abcdefghijkmnpqrstuvwxyz23456789')}@${domain}`;
    const password = rnd(24, 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789');
    await this.json('/accounts', { method: 'POST', body: { address, password }, retry: false });
    this.store.data.tempMail = { address, password, token: '', createdAt: Date.now() };
    await this.login();
    return this.info();
  }
  info() { const a = this.acc; return a ? { address: a.address, createdAt: a.createdAt } : null; }
  async inbox() {
    const a = this.acc;
    if (!a) return [];
    if (!a.token) await this.login();
    const d = await this.json('/messages', { token: this.acc.token });
    const list = (d && (d['hydra:member'] || d.member || d)) || [];
    return (Array.isArray(list) ? list : []).slice(0, 50).map(m => ({
      id: String(m.id || ''), from: String((m.from && (m.from.name || m.from.address)) || ''), subject: String(m.subject || '(ohne Betreff)'),
      intro: String(m.intro || ''), at: Date.parse(m.createdAt) || 0, seen: !!m.seen
    }));
  }
  async message(id) {
    if (!this.acc || !/^[\w-]{1,64}$/.test(String(id))) return null;
    const m = await this.json('/messages/' + id, { token: this.acc.token });
    // nur Text – HTML-Mails werden nicht als Seite angezeigt
    const text = String(m.text || '').trim() || String((m.html && m.html.join ? m.html.join('\n') : m.html) || '').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').trim();
    const html = String((m.html && m.html.join ? m.html.join('\n') : m.html) || '');
    const hrefs = [...html.matchAll(/href="(https?:\/\/[^"]+)"/gi)].map(x => x[1].replace(/&amp;/g, '&'));
    const links = [...new Set([...hrefs, ...(text.match(/https?:\/\/[^\s<>"')\]]+/g) || [])])].slice(0, 20);
    return { id: String(m.id), from: String((m.from && m.from.address) || ''), subject: String(m.subject || ''), text: text.slice(0, 20000), links };
  }
  forget() { delete this.store.data.tempMail; this.store.save(); }
}

module.exports = { TempMail };
