// Cookies aus anderen Browsern übernehmen (damit man auf Webseiten angemeldet bleibt).
//  - Firefox: cookies.sqlite, Werte unverschlüsselt.
//  - Chromium (Chrome, Edge, Brave, Vivaldi, Opera): „Network/Cookies“, Werte mit AES-256-GCM verschlüsselt („v10“).
//    Der Schlüssel steht in „Local State“ und ist mit Windows-DPAPI an das Benutzerkonto gebunden –
//    Windows entschlüsselt ihn für uns (PowerShell, kein Zusatzmodul nötig).
//  - „v20“-Werte (App-gebundene Verschlüsselung, Chrome ab Version 127) kann außer Chrome niemand lesen.
//    Diese Cookies werden gezählt und übersprungen.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const CHROME_EPOCH_S = 11644473600; // Sekunden von 1601 bis 1970
const MAX_COOKIES = 20000;
const SAMESITE_CHROME = { '-1': 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' };
const SAMESITE_FIREFOX = { 0: 'no_restriction', 1: 'lax', 2: 'strict' };

/** Windows-DPAPI: entschlüsselt Daten des angemeldeten Benutzers (Buffer → Buffer) */
function dpapiUnprotect(buf) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('Nur unter Windows möglich'));
    const script = 'Add-Type -AssemblyName System.Security;' +
      '$b=[Convert]::FromBase64String($env:SAKURA_DPAPI);' +
      '[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { env: { ...process.env, SAKURA_DPAPI: buf.toString('base64') }, windowsHide: true, timeout: 20000 },
      (err, out) => {
        if (err) return reject(err);
        const b = Buffer.from(String(out).trim(), 'base64');
        b.length ? resolve(b) : reject(new Error('Leere Antwort'));
      });
  });
}

/** AES-Schlüssel eines Chromium-Browsers aus „Local State“ holen */
async function chromiumKey(localStateFile, unprotect = dpapiUnprotect) {
  let ls;
  try { ls = JSON.parse(fs.readFileSync(localStateFile, 'utf8')); } catch { return null; }
  const enc = ls && ls.os_crypt && ls.os_crypt.encrypted_key;
  if (!enc) return null;
  const raw = Buffer.from(enc, 'base64');
  if (raw.slice(0, 5).toString() !== 'DPAPI') return null;
  try {
    const key = await unprotect(raw.slice(5));
    return key.length === 32 ? key : null;
  } catch { return null; }
}

/** Einen verschlüsselten Cookie-Wert entschlüsseln. Ergebnis: Text, oder null (nicht lesbar), oder 'v20' */
function decryptValue(buf, key, dbVersion) {
  if (!buf || !buf.length) return '';
  const tag = buf.slice(0, 3).toString();
  if (tag === 'v20') return 'v20';
  if ((tag !== 'v10' && tag !== 'v11') || !key) return null;
  try {
    const nonce = buf.slice(3, 15), data = buf.slice(15, buf.length - 16), authTag = buf.slice(buf.length - 16);
    const d = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    d.setAuthTag(authTag);
    let plain = Buffer.concat([d.update(data), d.final()]);
    // Ab Datenbank-Version 24 steht vor dem Wert ein SHA-256 der Domain (32 Bytes)
    if (dbVersion >= 24 && plain.length >= 32) plain = plain.slice(32);
    return plain.toString('utf8');
  } catch { return null; }
}

/** Liest die Cookies eines Chromium-Profils. withDatabase kommt aus importer.js (Kopie, nur lesen). */
async function readChromiumCookies(profile, withDatabase, { now = Date.now(), unprotect = dpapiUnprotect } = {}) {
  const file = [path.join(profile.dir, 'Network', 'Cookies'), path.join(profile.dir, 'Cookies')].find(f => fs.existsSync(f));
  const res = { cookies: [], protected: 0, unreadable: 0 };
  if (!file) return res;
  const rows = withDatabase(file, db => {
    let version = 0;
    try { version = Number((db.prepare("SELECT value FROM meta WHERE key = 'version'").get() || {}).value) || 0; } catch {}
    const list = db.prepare(
      `SELECT host_key, name, value, encrypted_value, path, is_secure, is_httponly, samesite,
         CASE WHEN expires_utc = 0 THEN 0 ELSE expires_utc / 1000000 - ${CHROME_EPOCH_S} END AS expires
       FROM cookies LIMIT ${MAX_COOKIES}`
    ).all();
    return { version, list };
  });
  const nowS = now / 1000;
  const needsKey = rows.list.some(r => !r.value && r.encrypted_value && r.encrypted_value.length);
  const key = needsKey ? await chromiumKey(path.join(profile.base || path.dirname(profile.dir), 'Local State'), unprotect) : null;
  for (const r of rows.list) {
    const expires = Number(r.expires) || 0;
    if (expires && expires < nowS) continue; // abgelaufen
    let value = r.value;
    if (!value && r.encrypted_value && r.encrypted_value.length) {
      value = decryptValue(Buffer.from(r.encrypted_value), key, rows.version);
      if (value === 'v20') { res.protected++; continue; }
      if (value == null) { res.unreadable++; continue; }
    }
    res.cookies.push({
      domain: r.host_key, name: r.name, value: value || '', path: r.path || '/', secure: !!r.is_secure, httpOnly: !!r.is_httponly,
      sameSite: SAMESITE_CHROME[r.samesite] || 'unspecified', expires: expires || null
    });
  }
  return res;
}

function readFirefoxCookies(profile, withDatabase, { now = Date.now() } = {}) {
  const file = path.join(profile.dir, 'cookies.sqlite');
  const res = { cookies: [], protected: 0, unreadable: 0 };
  if (!fs.existsSync(file)) return res;
  const list = withDatabase(file, db => db.prepare(
    `SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies LIMIT ${MAX_COOKIES}`
  ).all());
  const nowS = now / 1000;
  for (const r of list) {
    let exp = Number(r.expiry) || 0;
    if (exp > 1e11) exp = exp / 1000; // neuere Firefox-Versionen speichern Millisekunden
    if (exp && exp < nowS) continue;
    res.cookies.push({
      domain: r.host, name: r.name, value: r.value || '', path: r.path || '/', secure: !!r.isSecure, httpOnly: !!r.isHttpOnly,
      sameSite: SAMESITE_FIREFOX[r.sameSite] || 'unspecified', expires: exp || null
    });
  }
  return res;
}

/** Gelesenes Cookie → Angaben für Electrons session.cookies.set() */
function toElectron(c) {
  const host = String(c.domain || '').replace(/^\./, '');
  if (!host || !c.name) return null;
  const hostOnly = !String(c.domain).startsWith('.') || c.name.startsWith('__Host-');
  const out = {
    url: (c.secure ? 'https://' : 'http://') + host + (c.path || '/'),
    name: c.name, value: c.value, path: c.path || '/', secure: !!c.secure, httpOnly: !!c.httpOnly, sameSite: c.sameSite || 'unspecified'
  };
  if (!hostOnly) out.domain = c.domain;
  if (c.expires) out.expirationDate = c.expires;
  // „SameSite=None“ geht nur zusammen mit „secure“
  if (out.sameSite === 'no_restriction' && !out.secure) out.sameSite = 'lax';
  return out;
}

/** Schreibt die Cookies in eine Electron-Sitzung. Ergebnis: Anzahl übernommener Cookies */
async function applyCookies(cookies, sessionCookies) {
  let n = 0;
  for (const c of cookies) {
    const d = toElectron(c);
    if (!d) continue;
    try { await sessionCookies.set(d); n++; } catch { /* ungültiges Cookie überspringen */ }
  }
  return n;
}

module.exports = { readChromiumCookies, readFirefoxCookies, decryptValue, chromiumKey, toElectron, applyCookies, dpapiUnprotect };
