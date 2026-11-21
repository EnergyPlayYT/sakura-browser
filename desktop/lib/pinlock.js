// PIN-Sperre für Verlauf und Passwörter. Gespeichert wird nur ein scrypt-Hash, nie die PIN selbst.
const crypto = require('crypto');
const UNLOCK_MS = 5 * 60e3; // nach dem Entsperren 5 Minuten offen
const validPin = pin => /^\d{4,8}$/.test(String(pin || ''));

class PinLock {
  constructor(store, now = () => Date.now()) { this.store = store; this.now = now; this.until = 0; this.fails = 0; this.blockedUntil = 0; }
  get cfg() { return this.store.data.pinLock || null; }
  get enabled() { return !!(this.cfg && this.cfg.hash); }
  locked() { return this.enabled && this.now() >= this.until; }
  hash(pin, salt) { return crypto.scryptSync(String(pin), Buffer.from(salt, 'hex'), 32).toString('hex'); }
  check(pin) {
    const c = this.cfg;
    if (!c || !validPin(pin)) return false;
    const a = Buffer.from(this.hash(pin, c.salt), 'hex'), b = Buffer.from(c.hash, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  /** Mit Wartezeit nach zu vielen Fehlversuchen */
  unlock(pin) {
    if (!this.enabled) return { ok: true };
    const wait = this.blockedUntil - this.now();
    if (wait > 0) return { error: `Zu viele falsche Versuche. Warte ${Math.ceil(wait / 1000)} Sekunden.` };
    if (this.check(pin)) { this.fails = 0; this.until = this.now() + UNLOCK_MS; return { ok: true }; }
    this.fails++;
    if (this.fails >= 5) this.blockedUntil = this.now() + Math.min(600e3, 30e3 * 2 ** (this.fails - 5));
    return { error: 'Falsche PIN.' };
  }
  lock() { this.until = 0; }
  set(pin, oldPin) {
    if (!validPin(pin)) return { error: 'Die PIN muss aus 4 bis 8 Ziffern bestehen.' };
    if (this.enabled) { const r = this.unlock(oldPin); if (r.error) return { error: r.error === 'Falsche PIN.' ? 'Die bisherige PIN stimmt nicht.' : r.error }; }
    const salt = crypto.randomBytes(16).toString('hex');
    this.store.data.pinLock = { salt, hash: this.hash(pin, salt) };
    this.store.save();
    this.until = 0;
    return { ok: true };
  }
  remove(pin) {
    if (!this.enabled) return { ok: true };
    const r = this.unlock(pin);
    if (r.error) return r;
    delete this.store.data.pinLock;
    this.store.save();
    return { ok: true };
  }
}

module.exports = { PinLock, UNLOCK_MS };
