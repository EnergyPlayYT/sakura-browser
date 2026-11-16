// Synchronisation – zwei Wege, gleiches verschlüsseltes Format wie die Android-App:
//  1. Sync-Code (einfach, ohne Konto): Daten liegen verschlüsselt beim Sakura-Sync-Dienst (sync-server/, Netlify)
//  2. Eigenes Firebase-Projekt: users/{uid}/sync/main  →  { payload: "<JSON>", salt, updatedAt }
const { EventEmitter } = require('events');
const M = require('./model');
const C = require('./crypto');
const SC = require('./synccode');

const ERRORS = {
  EMAIL_NOT_FOUND: 'Kein Konto mit dieser E-Mail. Wähle „Konto anlegen“.',
  INVALID_PASSWORD: 'Falsches Passwort.',
  INVALID_LOGIN_CREDENTIALS: 'E-Mail oder Passwort stimmt nicht.',
  EMAIL_EXISTS: 'Diese E-Mail hat schon ein Konto. Wähle „Anmelden“.',
  WEAK_PASSWORD: 'Das Passwort braucht mindestens 6 Zeichen.',
  INVALID_EMAIL: 'Die E-Mail-Adresse ist ungültig.',
  OPERATION_NOT_ALLOWED: 'In Firebase ist die Anmeldung per E-Mail/Passwort noch nicht aktiviert.',
  CONFIGURATION_NOT_FOUND: 'In Firebase ist Authentication noch nicht eingerichtet.',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Zu viele Versuche. Probier es in ein paar Minuten noch mal.',
  PERMISSION_DENIED: 'Firestore lehnt den Zugriff ab. Prüfe die Sicherheitsregeln (firestore.rules).',
  API_KEY_INVALID: 'Der API-Schlüssel ist ungültig.',
  NOT_FOUND: 'Firestore-Datenbank nicht gefunden. Prüfe die Projekt-ID und ob Firestore angelegt ist.'
};

function niceError(code, fallback) {
  const key = String(code || '').split(':')[0].trim();
  if (/API key not valid/i.test(code)) return ERRORS.API_KEY_INVALID;
  return ERRORS[key] || fallback || String(code);
}

async function postJson(url, body) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(niceError(j.error && j.error.message, 'Anmeldung fehlgeschlagen'));
  return j;
}

class Sync extends EventEmitter {
  constructor(store) {
    super();
    this.store = store;
    this.idToken = null;
    this.exp = 0;
    this.busy = false;
    this.again = false;
    this.status = {
      state: !this.configured ? 'off' : store.data.sync.key ? 'idle' : 'needkey',
      message: '', lastSync: store.data.sync ? store.data.sync.lastSync : 0
    };
    this._debounce = null;
    this.tabsProvider = null; // liefert die offenen Tabs dieses Geräts
    store.on('change', (kind, synced) => {
      if (synced && this.configured) {
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this.syncNow(), kind === 'tabs' ? 60000 : kind === 'history' ? 15000 : 3000);
      }
    });
    this._interval = setInterval(() => this.configured && this.syncNow(), 5 * 60 * 1000);
  }

  get cfg() { return this.store.data.sync; }
  get isCode() { const c = this.cfg; return !!(c && c.mode === 'code'); }
  get configured() {
    const c = this.cfg;
    if (!c) return false;
    if (c.mode === 'code') return !!(c.id && c.write);
    return !!(c.apiKey && c.projectId && c.refreshToken && c.uid);
  }

  setStatus(state, message = '') {
    this.status = { state, message, lastSync: this.cfg ? this.cfg.lastSync || 0 : 0, email: this.cfg ? this.cfg.email : '' };
    this.emit('status', this.status);
  }

  info() {
    const c = this.cfg || {};
    return {
      ...this.status, email: c.email || '', projectId: c.projectId || '', apiKey: c.apiKey || '', encrypted: !!c.key,
      mode: c.mode === 'code' ? 'code' : c.apiKey ? 'firebase' : '', code: c.mode === 'code' ? c.code : ''
    };
  }

  /** Mit Sync-Code verbinden (Code von einem anderen Gerät) – danach gleicht Sakura automatisch ab */
  async connectCode({ code, server } = {}) {
    const d = SC.derive(code);
    if (!d) throw new Error('Der Sync-Code stimmt nicht. Er hat 20 Zeichen, z. B. K7QM4-ZX92A-1VNAB-8P3RT.');
    this.setStatus('syncing', 'Schlüssel wird berechnet …');
    const key = await C.deriveKey(d.secret, d.salt);
    this.store.data.sync = { mode: 'code', code: d.code, id: d.id, write: d.write, salt: d.salt, key, server: server || SC.DEFAULT_SERVER, lastSync: 0 };
    this.store.flush();
    return this.syncNow();
  }

  /** Neuen Sync-Code erzeugen und die Daten dieses Geräts hochladen */
  createCode(opts = {}) { return this.connectCode({ ...opts, code: SC.newCode() }); }

  async codeFetch(method, body) {
    const c = this.cfg;
    const res = await fetch(`${c.server}/api/sync/${c.id}`, {
      method, headers: { 'Content-Type': 'application/json', 'X-Sakura-Write': c.write }, body: body ? JSON.stringify(body) : undefined
    });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, j };
  }

  async login({ apiKey, projectId, email, password, create, syncPassword }) {
    apiKey = String(apiKey || '').trim();
    projectId = String(projectId || '').trim();
    if (!apiKey || !projectId) throw new Error('API-Schlüssel und Projekt-ID werden gebraucht.');
    if (String(syncPassword || '').length < C.MIN_LENGTH) throw new Error(`Das Sync-Passwort braucht mindestens ${C.MIN_LENGTH} Zeichen.`);
    const ep = create ? 'signUp' : 'signInWithPassword';
    const r = await postJson(`https://identitytoolkit.googleapis.com/v1/accounts:${ep}?key=${encodeURIComponent(apiKey)}`,
      { email: String(email || '').trim(), password, returnSecureToken: true });
    this.store.data.sync = { apiKey, projectId, email: r.email, uid: r.localId, refreshToken: r.refreshToken, lastSync: 0 };
    this.idToken = r.idToken;
    this.exp = Date.now() + Number(r.expiresIn || 3600) * 1000 - 60000;
    this.store.flush();
    // Angemeldet. Falls das Sync-Passwort nicht passt, bleibt die Anmeldung bestehen und Sakura fragt erneut.
    await this.unlock({ password: syncPassword }).catch(() => {});
    return this.info();
  }

  logout() {
    this.store.data.sync = null;
    this.idToken = null;
    this.store.flush();
    this.setStatus('off');
  }

  async token() {
    if (this.isCode) return null; // Sync-Code braucht keine Anmeldung
    if (this.idToken && Date.now() < this.exp) return this.idToken;
    const c = this.cfg;
    const res = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(c.apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(c.refreshToken)
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(niceError(j.error && j.error.message, 'Sitzung abgelaufen – bitte neu anmelden.'));
    this.idToken = j.id_token;
    this.exp = Date.now() + Number(j.expires_in || 3600) * 1000 - 60000;
    if (j.refresh_token) c.refreshToken = j.refresh_token;
    return this.idToken;
  }

  docUrl() {
    const c = this.cfg;
    return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(c.projectId)}/databases/(default)/documents/users/${encodeURIComponent(c.uid)}/sync/main`;
  }

  /** Liest das Server-Dokument: { exists, payload, salt } */
  async readDoc(tok) {
    if (this.isCode) {
      const r = await this.codeFetch('GET');
      if (r.status === 404) return { exists: false, payload: '', salt: '' };
      if (!r.ok) throw new Error('Der Sync-Dienst antwortet nicht (' + r.status + ').');
      return { exists: true, payload: r.j.payload || '', salt: r.j.salt || '' };
    }
    const get = await fetch(this.docUrl(), { headers: { Authorization: 'Bearer ' + tok } });
    if (get.status === 404) return { exists: false, payload: '', salt: '' };
    if (get.status !== 200) {
      const j = await get.json().catch(() => ({}));
      throw new Error(niceError(j.error && j.error.status, 'Server antwortet nicht (' + get.status + ')'));
    }
    const f = (await get.json()).fields || {};
    return {
      exists: true,
      payload: (f.payload && f.payload.stringValue) || '',
      salt: (f.salt && f.salt.stringValue) || ''
    };
  }

  async writeDoc(tok, data) {
    const c = this.cfg;
    if (this.isCode) {
      const r = await this.codeFetch('PUT', { payload: C.encrypt(c.key, JSON.stringify(M.syncPayload(data))), salt: c.salt });
      if (!r.ok) throw new Error(r.status === 403 ? 'Der Sync-Dienst lehnt das Schreiben ab.' : 'Hochladen fehlgeschlagen (' + r.status + ').');
      return;
    }
    const body = {
      fields: {
        payload: { stringValue: C.encrypt(c.key, JSON.stringify(M.syncPayload(data))) },
        salt: { stringValue: c.salt },
        enc: { integerValue: '1' },
        updatedAt: { integerValue: String(Date.now()) }
      }
    };
    const put = await fetch(this.docUrl(), {
      method: 'PATCH', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    if (!put.ok) {
      const j = await put.json().catch(() => ({}));
      throw new Error(niceError(j.error && j.error.status, 'Hochladen fehlgeschlagen (' + put.status + ')'));
    }
  }

  needKey(message) {
    // Beim Sync-Code ist der Schlüssel der Code selbst – nichts zu entsperren
    if (this.isCode) { this.setStatus('error', 'Die Daten beim Sync-Dienst passen nicht zu diesem Sync-Code.'); return; }
    if (this.cfg) { delete this.cfg.key; this.store.flush(); }
    this.setStatus('needkey', message);
  }

  /**
   * Sync-Passwort eingeben.
   *  - Gibt es auf dem Server schon verschlüsselte Daten, muss das Passwort dazu passen.
   *  - reset: true legt die Server-Daten mit neuem Passwort neu an (Daten dieses Geräts bleiben erhalten).
   */
  async unlock({ password, reset = false }) {
    if (!this.configured) throw new Error('Nicht angemeldet.');
    password = String(password || '');
    if (password.length < C.MIN_LENGTH) throw new Error(`Das Sync-Passwort braucht mindestens ${C.MIN_LENGTH} Zeichen.`);
    this.setStatus('syncing', 'Schlüssel wird berechnet …');
    try {
      const tok = await this.token();
      const doc = await this.readDoc(tok);
      const c = this.cfg;
      if (!reset && doc.salt && C.isEncrypted(doc.payload)) {
        const key = await C.deriveKey(password, doc.salt);
        try { C.decrypt(key, doc.payload); } catch { throw new Error('Das Sync-Passwort stimmt nicht.'); }
        c.salt = doc.salt; c.key = key;
        this.store.flush();
        return this.syncNow();
      }
      // Noch keine verschlüsselten Daten (oder bewusst neu anlegen) → neues Salz
      c.salt = C.newSalt();
      c.key = await C.deriveKey(password, c.salt);
      this.store.flush();
      return this.syncNow({ ignoreRemote: reset });
    } catch (e) {
      if (this.cfg && !this.cfg.key) this.setStatus('needkey', e.message);
      else this.setStatus('error', e.message);
      throw e;
    }
  }

  /** Sync-Passwort ändern: erst mit dem alten abgleichen, dann alles mit dem neuen verschlüsseln. */
  async changePassword(password) {
    if (String(password || '').length < C.MIN_LENGTH) throw new Error(`Das Sync-Passwort braucht mindestens ${C.MIN_LENGTH} Zeichen.`);
    await this.syncNow();
    if (this.status.state !== 'ok') throw new Error(this.status.message || 'Abgleich fehlgeschlagen.');
    return this.unlock({ password, reset: true });
  }

  async syncNow({ ignoreRemote = false } = {}) {
    if (!this.configured) return this.info();
    if (!this.cfg.key) { this.setStatus('needkey', this.status.state === 'needkey' ? this.status.message : ''); return this.info(); }
    if (this.busy) { this.again = true; return this.info(); }
    this.busy = true;
    this.setStatus('syncing');
    try {
      const tok = await this.token();
      let remote = {};
      if (!ignoreRemote) {
        const doc = await this.readDoc(tok);
        if (C.isEncrypted(doc.payload)) {
          if (doc.salt !== this.cfg.salt) {
            this.needKey('Das Sync-Passwort wurde auf einem anderen Gerät geändert. Gib das neue ein.');
            return this.info();
          }
          try { remote = JSON.parse(C.decrypt(this.cfg.key, doc.payload)); }
          catch { this.needKey('Das Sync-Passwort passt nicht zu den Daten auf dem Server.'); return this.info(); }
        } else if (doc.payload) {
          remote = JSON.parse(doc.payload); // alte, unverschlüsselte Daten → werden jetzt verschlüsselt hochgeladen
        }
      }
      if (this.tabsProvider) this.store.setDeviceTabs(this.tabsProvider());
      const merged = M.mergeData(this.store.syncedPart(), remote);
      this.store.applySynced(merged);
      await this.writeDoc(tok, merged);
      this.cfg.lastSync = Date.now();
      this.store.flush();
      this.setStatus('ok');
    } catch (e) {
      const offline = /fetch failed|ENOTFOUND|ECONN|network/i.test(String(e.message));
      this.setStatus('error', offline ? 'Keine Internetverbindung – versuche es später erneut.' : e.message);
    } finally {
      this.busy = false;
      if (this.again) { this.again = false; setTimeout(() => this.syncNow(), 500); }
    }
    return this.info();
  }
}

module.exports = Sync;
