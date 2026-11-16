// Passwortmanager: Zugangsdaten verschlüsselt speichern (Windows: an das Benutzerkonto gebunden über safeStorage/DPAPI),
// CSV-Import aus Chrome/Edge/Firefox und Leck-Prüfung über Have I Been Pwned (k-Anonymität: nur 5 Zeichen des SHA-1).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const M = require('./model');

const MAX_ENTRIES = 5000;

/** Seite eines Eintrags: https://host[:port] – Passwörter gelten nur genau dort */
function originOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.origin;
  } catch { return null; }
}
const hostOf = origin => { try { return new URL(origin).hostname.replace(/^www\./, ''); } catch { return origin; } };

class Vault {
  /** safeStorage: Electrons safeStorage (oder ein Nachbau in Tests) */
  constructor({ dir, safeStorage }) {
    this.file = path.join(dir, 'passwoerter.bin');
    this.safe = safeStorage;
    this.entries = null; // erst bei Bedarf entschlüsseln
    this.never = null;
  }

  get available() {
    try {
      if (!this.safe || !this.safe.isEncryptionAvailable()) return false;
      // Unter Linux ohne Schlüsselbund wäre es nur Klartext – dann lieber gar nicht speichern
      if (typeof this.safe.getSelectedStorageBackend === 'function' && this.safe.getSelectedStorageBackend() === 'basic_text') return false;
      return true;
    } catch { return false; }
  }

  load() {
    if (this.entries) return;
    this.entries = []; this.never = [];
    let buf;
    try { buf = fs.readFileSync(this.file); } catch { return; }
    try {
      const j = JSON.parse(this.safe.decryptString(buf));
      this.entries = Array.isArray(j.entries) ? j.entries : [];
      this.never = Array.isArray(j.never) ? j.never : [];
    } catch (e) {
      // Nicht entschlüsselbar (anderes Windows-Konto?) – Datei nicht überschreiben
      this.broken = true;
    }
  }

  save() {
    if (this.broken) throw new Error('Die Passwörter dieses Windows-Kontos lassen sich nicht öffnen.');
    if (!this.available) throw new Error('Sicherer Speicher ist auf diesem System nicht verfügbar.');
    const data = this.safe.encryptString(JSON.stringify({ v: 1, entries: this.entries, never: this.never }));
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, this.file);
  }

  /** Liste ohne Passwörter (für die Oberfläche) */
  list() {
    this.load();
    return this.entries
      .map(e => ({ id: e.id, origin: e.origin, host: hostOf(e.origin), username: e.username, updatedAt: e.updatedAt, lastUsed: e.lastUsed || 0, leaked: e.leaked || 0 }))
      .sort((a, b) => a.host.localeCompare(b.host, 'de') || a.username.localeCompare(b.username, 'de'));
  }

  /** Konten für eine Seite – nur Benutzernamen */
  accountsFor(url) {
    this.load();
    const o = originOf(url);
    return o ? this.entries.filter(e => e.origin === o).map(e => ({ id: e.id, username: e.username })) : [];
  }

  /** Passwort eines Eintrags – nur wenn die Seite genau passt (oder ohne Seite für die Verwaltung) */
  reveal(id, url) {
    this.load();
    const e = this.entries.find(x => x.id === id);
    if (!e) return null;
    if (url !== undefined && originOf(url) !== e.origin) return null;
    return e;
  }

  isNever(url) { this.load(); const o = originOf(url); return !!o && this.never.includes(o); }
  addNever(url) { this.load(); const o = originOf(url); if (o && !this.never.includes(o)) { this.never.push(o); this.save(); } }

  /** Was würde ein Speichern bewirken? 'new' | 'update' | 'same' | null */
  check(url, username, password) {
    this.load();
    const o = originOf(url);
    if (!o || !password) return null;
    const e = this.entries.find(x => x.origin === o && x.username === String(username || ''));
    if (!e) return 'new';
    return e.password === password ? 'same' : 'update';
  }

  upsert(url, username, password) {
    this.load();
    const o = originOf(url);
    if (!o || !password) throw new Error('Ungültige Angaben.');
    username = String(username || '').slice(0, 300);
    password = String(password).slice(0, 1000);
    const now = Date.now();
    const e = this.entries.find(x => x.origin === o && x.username === username);
    if (e) Object.assign(e, { password, updatedAt: now, leaked: 0 });
    else {
      if (this.entries.length >= MAX_ENTRIES) throw new Error('Zu viele Passwörter gespeichert.');
      this.entries.push({ id: M.newId(), origin: o, username, password, createdAt: now, updatedAt: now });
    }
    this.save();
  }

  update(id, patch) {
    this.load();
    const e = this.entries.find(x => x.id === id);
    if (!e) return;
    if (typeof patch.username === 'string') e.username = patch.username.slice(0, 300);
    if (typeof patch.password === 'string' && patch.password) { e.password = patch.password.slice(0, 1000); e.leaked = 0; }
    e.updatedAt = Date.now();
    this.save();
  }

  /** Alle gespeicherten Passwörter löschen (die Liste „Nie speichern“ bleibt) */
  clear() { this.load(); this.entries = []; this.save(); }

  remove(id) { this.load(); this.entries = this.entries.filter(e => e.id !== id); this.save(); }
  used(id) { this.load(); const e = this.entries.find(x => x.id === id); if (e) { e.lastUsed = Date.now(); this.save(); } }

  /** Viele Einträge auf einmal (CSV-Import). Ergebnis: { added, updated, skipped } */
  importMany(rows) {
    this.load();
    const r = { added: 0, updated: 0, skipped: 0 };
    const now = Date.now();
    for (const row of rows) {
      const o = originOf(row.url);
      if (!o || !row.password) { r.skipped++; continue; }
      const username = String(row.username || '').slice(0, 300);
      const e = this.entries.find(x => x.origin === o && x.username === username);
      if (e) { if (e.password !== row.password) { e.password = String(row.password).slice(0, 1000); e.updatedAt = now; r.updated++; } else r.skipped++; continue; }
      if (this.entries.length >= MAX_ENTRIES) { r.skipped++; continue; }
      this.entries.push({ id: M.newId(), origin: o, username, password: String(row.password).slice(0, 1000), createdAt: now, updatedAt: now });
      r.added++;
    }
    if (r.added || r.updated) this.save();
    return r;
  }
}

/** CSV lesen (RFC 4180: Anführungszeichen, Kommas und Zeilenumbrüche in Feldern) */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(x => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(x => x !== '')) rows.push(row);
  return rows;
}

/** Passwort-Export von Chrome/Edge (name,url,username,password,note) oder Firefox (url,username,password,…) */
function parsePasswordCsv(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const head = rows[0].map(h => h.trim().toLowerCase());
  const col = names => head.findIndex(h => names.includes(h));
  const iu = col(['url', 'origin', 'website', 'login_uri']), in_ = col(['username', 'login', 'login_username', 'user']), ip = col(['password', 'login_password']);
  if (iu < 0 || ip < 0) throw new Error('Diese Datei sieht nicht wie ein Passwort-Export aus.');
  return rows.slice(1).map(r => ({ url: (r[iu] || '').trim(), username: in_ >= 0 ? r[in_] || '' : '', password: r[ip] || '' }));
}

/**
 * Have I Been Pwned (Pwned Passwords): Wie oft taucht das Passwort in Datenlecks auf?
 * Gesendet werden nur die ersten 5 Zeichen des SHA-1-Werts; die Antwort enthält Hunderte Treffer, die wir lokal vergleichen.
 */
async function pwnedCount(password, fetchFn, cache = new Map()) {
  const sha = crypto.createHash('sha1').update(String(password), 'utf8').digest('hex').toUpperCase();
  const prefix = sha.slice(0, 5), suffix = sha.slice(5);
  let body = cache.get(prefix);
  if (body == null) {
    const r = await fetchFn('https://api.pwnedpasswords.com/range/' + prefix, { headers: { 'Add-Padding': 'true' } });
    if (!r.ok) throw new Error('Die Leck-Prüfung ist gerade nicht erreichbar.');
    body = await r.text();
    cache.set(prefix, body);
  }
  for (const line of body.split(/\r?\n/)) {
    const [s, n] = line.split(':');
    if (s === suffix) return Number(n) || 0;
  }
  return 0;
}

/** Alle gespeicherten Passwörter prüfen. Ergebnis: { checked, leaked } (Einträge werden markiert) */
async function checkLeaks(vault, fetchFn) {
  vault.load();
  const cache = new Map();
  let leaked = 0;
  for (const e of vault.entries) {
    e.leaked = await pwnedCount(e.password, fetchFn, cache);
    if (e.leaked) leaked++;
  }
  vault.save();
  return { checked: vault.entries.length, leaked };
}

module.exports = { Vault, parseCsv, parsePasswordCsv, pwnedCount, checkLeaks, originOf };
