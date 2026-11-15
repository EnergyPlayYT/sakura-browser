// Ende-zu-Ende-Verschlüsselung für den Abgleich.
// Gleiches Verfahren wie SyncCrypto.kt auf Android:
//   Schlüssel = PBKDF2-HMAC-SHA256(Sync-Passwort, Salz, 310.000 Runden, 32 Byte)
//   Daten     = "enc1:" + Base64( IV[12] | AES-256-GCM-Chiffretext | Tag[16] )
const crypto = require('crypto');
const { promisify } = require('util');
const pbkdf2 = promisify(crypto.pbkdf2);

const ITERATIONS = 310000;
const PREFIX = 'enc1:';
const MIN_LENGTH = 8;

function newSalt() { return crypto.randomBytes(16).toString('base64'); }

async function deriveKey(password, saltB64) {
  const key = await pbkdf2(String(password).normalize('NFC'), Buffer.from(saltB64, 'base64'), ITERATIONS, 32, 'sha256');
  return key.toString('base64');
}

function encrypt(keyB64, text) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), iv);
  const ct = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return PREFIX + Buffer.concat([iv, ct, c.getAuthTag()]).toString('base64');
}

/** Wirft einen Fehler, wenn der Schlüssel nicht passt oder die Daten verändert wurden. */
function decrypt(keyB64, data) {
  if (!isEncrypted(data)) throw new Error('Nicht verschlüsselt');
  const buf = Buffer.from(data.slice(PREFIX.length), 'base64');
  if (buf.length < 28) throw new Error('Defekte Daten');
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyB64, 'base64'), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return Buffer.concat([d.update(buf.subarray(12, buf.length - 16)), d.final()]).toString('utf8');
}

function isEncrypted(s) { return typeof s === 'string' && s.startsWith(PREFIX); }

module.exports = { ITERATIONS, MIN_LENGTH, newSalt, deriveKey, encrypt, decrypt, isEncrypted };
