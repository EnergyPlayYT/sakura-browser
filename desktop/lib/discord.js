// Discord-Anzeige (Rich Presence): zeigt in deinem Discord-Profil „Surft mit Sakura“.
// Spricht über die lokale Discord-Schnittstelle (Named Pipe/Unix-Socket) – nichts geht ins Internet.
const net = require('net');
const path = require('path');
const crypto = require('crypto');

function pipePaths(platform = process.platform, env = process.env) {
  if (platform === 'win32') return Array.from({ length: 10 }, (_, i) => `\\\\?\\pipe\\discord-ipc-${i}`);
  const base = (env.XDG_RUNTIME_DIR || env.TMPDIR || env.TMP || env.TEMP || '/tmp').replace(/\/$/, '');
  const dirs = [base, path.join(base, 'app', 'com.discordapp.Discord'), path.join(base, 'snap.discord')];
  return dirs.flatMap(d => Array.from({ length: 10 }, (_, i) => path.join(d, `discord-ipc-${i}`)));
}
function frame(op, data) {
  const json = Buffer.from(JSON.stringify(data));
  const h = Buffer.alloc(8);
  h.writeInt32LE(op, 0); h.writeInt32LE(json.length, 4);
  return Buffer.concat([h, json]);
}

class DiscordPresence {
  constructor({ clientId, paths, connect } = {}) {
    this.clientId = clientId; this.paths = paths || pipePaths(); this.connect = connect || (p => net.createConnection(p));
    this.sock = null; this.ready = false; this.last = null; this.connecting = null;
  }
  async open() {
    if (this.ready) return true;
    if (!this.clientId) return false;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      for (const p of this.paths) {
        const ok = await new Promise(res => {
          const s = this.connect(p);
          const fail = () => { s.destroy(); res(false); };
          s.once('error', fail);
          s.once('connect', () => {
            s.removeListener('error', fail);
            s.on('error', () => this.close());
            s.on('close', () => this.close());
            s.on('data', () => { if (!this.ready) { this.ready = true; this.flush(); } }); // Antwort auf den Handshake
            this.sock = s;
            s.write(frame(0, { v: 1, client_id: this.clientId }));
            res(true);
          });
        });
        if (ok) return true;
      }
      return false;
    })();
    try { return await this.connecting; } finally { this.connecting = null; }
  }
  close() { this.ready = false; if (this.sock) { try { this.sock.destroy(); } catch {} } this.sock = null; }
  /** activity: { details, state, start } oder null zum Löschen */
  async set(activity) {
    const key = JSON.stringify(activity);
    if (key === this.lastKey && this.ready) return;
    this.lastKey = key; this.last = activity;
    if (!(await this.open())) return;
    if (this.ready) this.flush();
  }
  flush() {
    if (!this.sock || !this.ready) return;
    const a = this.last;
    const act = a ? {
      details: String(a.details || 'Surft mit Sakura').slice(0, 120),
      ...(a.state ? { state: String(a.state).slice(0, 120) } : {}),
      ...(a.start ? { timestamps: { start: Math.floor(a.start / 1000) } } : {}),
      assets: { large_image: 'sakura', large_text: 'Sakura Browser' },
      buttons: [{ label: 'Sakura herunterladen', url: 'https://sakura-browser.netlify.app' }]
    } : null;
    try { this.sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: act }, nonce: crypto.randomUUID() })); } catch {}
  }
}

module.exports = { DiscordPresence, pipePaths, frame };
