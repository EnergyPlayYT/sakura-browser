// Chrome-Erweiterungen (.crx) entpacken – ohne zusätzliche Bibliotheken
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

/** Erweiterungs-ID aus dem öffentlichen Schlüssel (so rechnet Chrome): SHA-256, erste 16 Bytes, 0–f → a–p */
function idFromKey(der) {
  const hex = crypto.createHash('sha256').update(der).digest('hex').slice(0, 32);
  return [...hex].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}
function idFromBytes(buf) {
  return [...buf.toString('hex')].map(c => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

// ---- winziger Protobuf-Leser für den CRX3-Kopf
function readVarint(buf, pos) {
  let result = 0, shift = 0, b;
  do {
    if (pos >= buf.length) throw new Error('Defekte Erweiterungsdatei');
    b = buf[pos++];
    result += (b & 0x7f) * Math.pow(2, shift);
    shift += 7;
  } while (b & 0x80);
  return [result, pos];
}
function readFields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let tag; [tag, pos] = readVarint(buf, pos);
    const field = Math.floor(tag / 8), type = tag & 7;
    if (type === 2) {
      let len; [len, pos] = readVarint(buf, pos);
      out.push({ field, value: buf.subarray(pos, pos + len) });
      pos += len;
    } else if (type === 0) { let v; [v, pos] = readVarint(buf, pos); out.push({ field, value: v }); }
    else if (type === 1) pos += 8;
    else if (type === 5) pos += 4;
    else throw new Error('Defekte Erweiterungsdatei');
  }
  return out;
}

/** Zerlegt eine .crx-Datei in Zip-Inhalt und öffentlichen Schlüssel */
function parseCrx(buf) {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'Cr24') {
    if (buf.readUInt32LE(0) === 0x04034b50) return { zip: buf, key: null, id: null }; // schon eine Zip-Datei
    throw new Error('Das ist keine Chrome-Erweiterung.');
  }
  const version = buf.readUInt32LE(4);
  if (version === 2) {
    const pkLen = buf.readUInt32LE(8), sigLen = buf.readUInt32LE(12);
    const key = buf.subarray(16, 16 + pkLen);
    return { zip: buf.subarray(16 + pkLen + sigLen), key, id: idFromKey(key) };
  }
  if (version === 3) {
    const headerLen = buf.readUInt32LE(8);
    const header = buf.subarray(12, 12 + headerLen);
    const fields = readFields(header);
    const keys = [];
    let crxId = null;
    for (const f of fields) {
      if (f.field === 2 || f.field === 3) {
        const proof = readFields(f.value).find(x => x.field === 1);
        if (proof) keys.push({ key: Buffer.from(proof.value), rsa: f.field === 2 });
      } else if (f.field === 10000) {
        const sd = readFields(f.value).find(x => x.field === 1);
        if (sd) crxId = idFromBytes(Buffer.from(sd.value));
      }
    }
    const match = keys.find(k => idFromKey(k.key) === crxId) || keys.find(k => k.rsa) || keys[0];
    return { zip: buf.subarray(12 + headerLen), key: match ? match.key : null, id: crxId || (match ? idFromKey(match.key) : null) };
  }
  throw new Error('Unbekanntes Erweiterungsformat (Version ' + version + ').');
}

/** Entpackt eine Zip-Datei sicher in einen Ordner */
function unzip(zip, dest) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Defekte Erweiterungsdatei (Zip-Ende fehlt).');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Defekte Erweiterungsdatei (Verzeichnis).');
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28), extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;

    // Chrome lehnt entpackte Erweiterungen mit _metadata ab → überspringen
    if (!name || name.startsWith('_metadata/') || name.startsWith('__MACOSX/')) continue;
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep) && target !== root) throw new Error('Unsichere Datei in der Erweiterung: ' + name);
    if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }

    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('Defekte Erweiterungsdatei (Eintrag).');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compSize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = zlib.inflateRawSync(raw);
    else throw new Error('Nicht unterstützte Komprimierung in der Erweiterung.');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}

/** Entpackt eine .crx und trägt den Schlüssel ein, damit die Erweiterung ihre echte ID behält */
function extractCrx(buf, dest) {
  const { zip, key, id } = parseCrx(buf);
  unzip(zip, dest);
  const mf = path.join(dest, 'manifest.json');
  if (!fs.existsSync(mf)) throw new Error('Die Erweiterung hat keine manifest.json.');
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8').replace(/^﻿/, ''));
  if (key && !manifest.key) {
    manifest.key = key.toString('base64');
    fs.writeFileSync(mf, JSON.stringify(manifest, null, 2));
  }
  return { id, manifest };
}

/** Versionen vergleichen: 1.2.10 > 1.2.9 */
function compareVersions(a, b) {
  const x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

module.exports = { parseCrx, unzip, extractCrx, idFromKey, compareVersions };
