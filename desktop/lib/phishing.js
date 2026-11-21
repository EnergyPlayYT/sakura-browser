// Warnung vor bekannten Betrugs- und Phishing-Seiten.
// Liste: phishing-filter von malware-filter (CC0, aus OpenPhish/PhishTank/PhishStats), täglich neu geladen.
const fs = require('fs'), path = require('path');
const URLS = [
  'https://malware-filter.gitlab.io/malware-filter/phishing-filter-domains.txt',
  'https://curbengh.github.io/phishing-filter/phishing-filter-domains.txt'
];

function parse(text) {
  const set = new Set();
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim().toLowerCase();
    if (!line || line[0] === '#' || line[0] === '!') continue;
    if (/^[a-z0-9.-]+\.[a-z0-9-]+$/.test(line)) set.add(line);
  }
  return set;
}

class PhishGuard {
  constructor({ userDir, fetch }) {
    this.file = path.join(userDir, 'phishing-liste.txt');
    this.fetch = fetch;
    this.set = new Set();
    this.allowed = new Set(); // „Trotzdem öffnen“ – nur bis zum Neustart
    try { this.set = parse(fs.readFileSync(this.file, 'utf8')); } catch {}
  }
  get size() { return this.set.size; }
  /** Domain oder eine ihrer übergeordneten Domains steht auf der Liste */
  isPhishing(host) {
    host = String(host || '').toLowerCase().replace(/\.$/, '');
    if (!host || this.allowed.has(host)) return false;
    for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) if (this.set.has(h)) return true;
    return false;
  }
  allow(host) { this.allowed.add(String(host || '').toLowerCase()); }
  async refresh(force = false) {
    try { if (!force && this.set.size && Date.now() - fs.statSync(this.file).mtimeMs < 864e5) return false; } catch {}
    for (const url of URLS) {
      try {
        const res = await this.fetch(url);
        if (!res.ok) continue;
        const text = await res.text();
        const set = parse(text);
        if (set.size < 100) continue; // offensichtlich kaputt
        this.set = set;
        fs.writeFileSync(this.file, text);
        return true;
      } catch {}
    }
    return false;
  }
}

module.exports = { PhishGuard, parse };
