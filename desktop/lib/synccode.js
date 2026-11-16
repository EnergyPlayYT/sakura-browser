// Sync-Code: Abgleich ohne Konto. Ein zufälliger Code (z. B. „K7QM4-ZX92A-LUNAB-8P3RT“) ist Zugang und Schlüssel zugleich.
// Gleiches Verfahren wie SyncClient.kt auf Android:
//   id    = hex(SHA-256("sakura-id:" + Code))        → Speicher-Nummer auf dem Server
//   write = hex(SHA-256("sakura-write:" + Code))     → Schreibberechtigung
//   salt  = Base64(SHA-256("sakura-salt:" + Code)[0..16])
//   Schlüssel = crypto.deriveKey(Code, salt)          → wie beim Sync-Passwort (PBKDF2, AES-256-GCM)
const crypto = require('crypto');

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford-Base32: ohne I, L, O, U
const DEFAULT_SERVER = 'https://sakura-sync.netlify.app';

/** Neuer Code: 20 Zeichen = 100 Bit Zufall, in Fünfergruppen */
function newCode() {
  const bytes = crypto.randomBytes(20);
  let s = '';
  for (let i = 0; i < 20; i++) s += ALPHABET[bytes[i] & 31];
  return format(s);
}

/** Eingabe säubern: Groß/klein egal, Leerzeichen/Striche egal, O→0, I/L→1 */
function normalize(input) {
  const s = String(input || '').toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  return /^[0-9A-HJKMNP-TV-Z]{20}$/.test(s) ? s : null;
}
const format = s => s.match(/.{5}/g).join('-');

const sha = s => crypto.createHash('sha256').update(s).digest();
function derive(code) {
  const c = normalize(code);
  if (!c) return null;
  return {
    code: format(c),
    id: sha('sakura-id:' + c).toString('hex'),
    write: sha('sakura-write:' + c).toString('hex'),
    salt: sha('sakura-salt:' + c).subarray(0, 16).toString('base64'),
    secret: c
  };
}

module.exports = { newCode, normalize, derive, DEFAULT_SERVER };
