// Automatische Updates für Sakura selbst (und damit für die eingebaute Chromium-Engine).
// Quelle: GitHub-Releases des Repos, aus dem Sakura gebaut wurde (siehe .github/workflows).
const { EventEmitter } = require('events');

const CHECK_EVERY = 4 * 60 * 60 * 1000; // alle 4 Stunden

class Updater extends EventEmitter {
  constructor({ app, autoUpdater }) {
    super();
    this.app = app;
    this.au = autoUpdater || null;
    this.state = { state: 'idle', version: null, percent: null, message: '' };
    this.lastCheck = 0;
    // Nur die installierte Version (Installer) kann sich selbst aktualisieren – nicht „npm start“ und nicht die portable .exe
    this.supported = !!(this.au && app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR);
    if (!this.supported) {
      this.state = { state: 'unsupported', version: null, percent: null, message: !app.isPackaged
        ? 'Im Entwicklungsmodus gibt es keine automatischen Updates.'
        : 'Die portable Version aktualisiert sich nicht selbst. Lade neue Versionen bei GitHub herunter oder nutze den Installer.' };
      return;
    }
    const au = this.au;
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    au.on('checking-for-update', () => this.set({ state: 'checking', message: '' }));
    au.on('update-not-available', () => this.set({ state: 'current', version: null, percent: null }));
    au.on('update-available', info => this.set({ state: 'downloading', version: info.version, percent: 0 }));
    au.on('download-progress', p => this.set({ state: 'downloading', percent: Math.round(p.percent || 0) }));
    au.on('update-downloaded', info => this.set({ state: 'ready', version: info.version, percent: 100 }));
    au.on('error', err => this.set({ state: 'error', message: this.describe(err) }));
  }

  describe(err) {
    const m = String((err && err.message) || err || '');
    if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR/i.test(m)) return 'Keine Verbindung zu GitHub. Sakura versucht es später erneut.';
    if (/404|latest\.yml|No published versions/i.test(m)) return 'Es gibt noch keine veröffentlichte Version bei GitHub.';
    return 'Update fehlgeschlagen: ' + m.split('\n')[0].slice(0, 200);
  }

  set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('change', this.info());
  }

  info() {
    return {
      ...this.state,
      current: this.app.getVersion(),
      chromium: process.versions.chrome,
      electron: process.versions.electron,
      supported: this.supported,
      lastCheck: this.lastCheck
    };
  }

  async check() {
    if (!this.supported || this.state.state === 'downloading' || this.state.state === 'ready') return this.info();
    this.lastCheck = Date.now();
    try { await this.au.checkForUpdates(); } catch (e) { this.set({ state: 'error', message: this.describe(e) }); }
    return this.info();
  }

  start() {
    if (!this.supported) return;
    setTimeout(() => this.check(), 15000);
    this._t = setInterval(() => this.check(), CHECK_EVERY);
  }

  /** Beendet Sakura, installiert das Update und startet neu */
  installNow() {
    if (this.state.state !== 'ready') return;
    this.au.quitAndInstall(true, true);
  }
}

module.exports = Updater;
