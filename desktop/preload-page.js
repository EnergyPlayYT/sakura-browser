// Nur die eigenen sakura://-Seiten bekommen Zugriff auf den Browser
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'sakura:') {
  contextBridge.exposeInMainWorld('sakura', {
    call: (cmd, arg) => ipcRenderer.invoke('page', cmd, arg === undefined ? null : arg),
    onTheme: fn => ipcRenderer.on('sakura-theme', () => fn()) // Design wurde geändert
  });
}

// YouTube: Sponsor-Abschnitte (SponsorBlock) holt der Hauptprozess – nur die Abfrage, sonst nichts
if (/(^|\.)youtube\.com$/.test(location.hostname) && location.protocol === 'https:') {
  contextBridge.exposeInMainWorld('sakuraYT', {
    segments: id => ipcRenderer.invoke('yt-segments', String(id || '').slice(0, 20))
  });
}

// Steam-Shop: Spielinfos holt der Hauptprozess
if (location.hostname === 'store.steampowered.com' && location.protocol === 'https:') {
  contextBridge.exposeInMainWorld('sakuraSteam', { info: appid => ipcRenderer.invoke('steam-info', String(appid || '').slice(0, 12)) });
}

// Twitch: Emote-Listen (7TV/BTTV/FFZ) holt der Hauptprozess
if (/(^|\.)twitch\.tv$/.test(location.hostname) && location.protocol === 'https:') {
  contextBridge.exposeInMainWorld('sakuraTwitch', {
    emotes: login => ipcRenderer.invoke('twitch-emotes', String(login || '').slice(0, 30))
  });
}

// Lesemodus: geänderte Schriftgröße/Farben an Sakura melden
if (/^https?:$/.test(location.protocol)) {
  document.addEventListener('sakura-reader-prefs', e => { if (typeof e.detail === 'string' && e.detail.length < 200) ipcRenderer.send('reader-prefs', e.detail); });
}

// Videos: Sakura merkt sich, wo du warst – die Seite kann nur ihre eigene Stelle lesen und schreiben
if (/^https?:$/.test(location.protocol)) {
  contextBridge.exposeInMainWorld('sakuraVideo', {
    get: () => ipcRenderer.invoke('video-pos', 'get'),
    set: (t, d) => ipcRenderer.invoke('video-pos', 'set', { t: t == null ? null : Number(t), d: Number(d) || 0 })
  });
}

// Popup-Blocker: Sakura erfährt, ob du auf einen Link/Knopf geklickt hast oder auf eine leere Fläche
// (Klickfallen öffnen Werbefenster bei Klicks irgendwohin auf die Seite)
if (/^https?:$/.test(location.protocol)) {
  const INTERACTIVE = 'a[href], button, input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [contenteditable=""], [contenteditable="true"]';
  const report = e => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const a = e.target.closest('a[href]');
    ipcRenderer.send('click-intent', { href: a ? a.href : null, interactive: !!e.target.closest(INTERACTIVE) });
  };
  window.addEventListener('mousedown', report, true);
  window.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') report(e); }, true);
}

// Passwortmanager: Anmeldungen erkennen und beim Klick ins Anmeldefeld gespeicherte Konten anbieten.
// Passwörter kommen nur nach einem Klick des Nutzers auf ein Konto auf die Seite – nie automatisch beim Laden.
if (/^https?:$/.test(location.protocol)) {
  const isPw = el => el instanceof HTMLInputElement && el.type === 'password';
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const USER_HINT = /user|mail|login|konto|account|benutzer|name|phone|tel/i;
  function userField(pw) {
    const scope = (pw && pw.form) || document;
    const inputs = [...scope.querySelectorAll('input')].filter(i => ['text', 'email', 'tel', ''].includes(i.type) && visible(i) && !i.readOnly);
    const auto = inputs.find(i => /username|email/.test(i.autocomplete || ''));
    if (auto) return auto;
    const before = pw ? inputs.filter(i => i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING) : inputs;
    return before.reverse().find(i => USER_HINT.test(i.name + ' ' + i.id + ' ' + (i.placeholder || ''))) || before[0] || null;
  }
  const pwFields = () => [...document.querySelectorAll('input[type="password"]')].filter(visible);

  // ---------- Anmeldung erkannt → Sakura fragt „Passwort speichern?“
  let lastSent = '';
  function capture(from) {
    const pw = (isPw(from) && from.value ? from : null) || pwFields().find(p => p.value && (!from || !from.form || p.form === from.form));
    if (!pw || !pw.value) return;
    const pws = pwFields().filter(p => p.value);
    if (pws.length >= 3) return; // Passwort ändern: alt/neu/neu – nicht speichern
    const user = userField(pw);
    const key = (user ? user.value : '') + '\n' + pw.value;
    if (key === lastSent) return;
    lastSent = key;
    setTimeout(() => { if (lastSent === key) lastSent = ''; }, 5000);
    ipcRenderer.send('pw-submit', { username: user ? user.value.slice(0, 300) : '', password: pw.value.slice(0, 1000) });
  }
  window.addEventListener('submit', e => { if (e.isTrusted && e.target.querySelector && e.target.querySelector('input[type="password"]')) capture(e.target.querySelector('input[type="password"]')); }, true);
  window.addEventListener('click', e => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
    const b = e.target.closest('button, input[type="submit"], [role="button"]');
    if (b && pwFields().some(p => p.value)) capture(b.form ? b : null);
  }, true);
  window.addEventListener('keydown', e => { if (e.isTrusted && e.key === 'Enter' && isPw(e.target)) capture(e.target); }, true);

  // ---------- Auswahl gespeicherter Konten unter dem Anmeldefeld
  let box = null;
  const closeBox = () => { if (box) { box.remove(); box = null; } };
  function setValue(el, v) {
    if (!el) return;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  async function offer(field) {
    const pw = isPw(field) ? field : pwFields().find(p => !p.form || p.form === field.form);
    if (!pw || (!isPw(field) && userField(pw) !== field)) return;
    const list = await ipcRenderer.invoke('pw-accounts');
    if (!list || !list.length || document.activeElement !== field) return;
    closeBox();
    const host = document.createElement('div');
    const r = field.getBoundingClientRect();
    host.style.cssText = `position:fixed;left:${Math.round(r.left)}px;top:${Math.round(r.bottom + 4)}px;z-index:2147483647;`;
    const sr = host.attachShadow({ mode: 'closed' });
    sr.innerHTML = `<style>
      .b{min-width:${Math.max(220, Math.round(r.width))}px;max-width:360px;background:#2C2950;color:#EEE7E2;border-radius:10px;padding:6px;
        box-shadow:0 0 0 1px rgba(238,231,226,.1),0 12px 30px rgba(4,2,12,.5);font:13px "Segoe UI",Roboto,sans-serif}
      .h{padding:4px 8px 6px;color:#A59EB8;font-size:11.5px} button{all:unset;display:block;box-sizing:border-box;width:100%;padding:8px 10px;border-radius:7px;cursor:pointer;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis} button:hover,button:focus{background:rgba(242,179,197,.16)}</style>
      <div class="b"><div class="h">Gespeichert in Sakura</div></div>`;
    const b = sr.querySelector('.b');
    for (const a of list) {
      const btn = document.createElement('button');
      btn.textContent = a.username || '(ohne Benutzername)';
      btn.addEventListener('mousedown', async e => {
        e.preventDefault();
        if (!e.isTrusted) return;
        const d = await ipcRenderer.invoke('pw-fill', a.id);
        closeBox();
        if (!d) return;
        setValue(userField(pw), d.username);
        setValue(pw, d.password);
      });
      b.appendChild(btn);
    }
    box = host;
    document.documentElement.appendChild(host);
  }
  window.addEventListener('focusin', e => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement) || !e.isTrusted) return;
    if (isPw(t) || pwFields().length) offer(t); else closeBox();
  }, true);
  window.addEventListener('focusout', () => setTimeout(() => { if (box && !box.matches(':focus-within')) closeBox(); }, 150), true);
  window.addEventListener('scroll', closeBox, true);
}

// Chrome Web Store: „Zu Chrome hinzufügen“ wird zu „Zu Sakura hinzufügen“
if (location.hostname === 'chromewebstore.google.com') {
  const ID_RE = /\/detail\/(?:[^/?#]+\/)?([a-p]{32})(?:[/?#]|$)/;
  const CHROME_BTN = /(zu chrome hinzufügen|aus chrome entfernen|add to chrome|remove from chrome|in chrome verfügbar|switch to chrome|zu chrome wechseln)/i;
  const call = (cmd, id) => ipcRenderer.invoke('webstore', cmd, id);
  let state = null, stateId = null, ours = null, timer = null;

  const currentId = () => (ID_RE.exec(location.pathname + '/') || [])[1] || null;

  function style(el, floating) {
    el.setAttribute('style', [
      'all:unset', 'box-sizing:border-box', 'display:inline-flex', 'align-items:center', 'gap:8px', 'cursor:pointer',
      'height:40px', 'padding:0 22px 0 14px', 'border-radius:20px', 'white-space:nowrap',
      'font:500 14px/1 "Google Sans",Roboto,"Segoe UI",sans-serif', 'letter-spacing:.01em',
      'background:#D9566F', 'color:#fff', 'box-shadow:0 1px 2px rgba(0,0,0,.2)',
      floating ? 'position:fixed;right:24px;bottom:24px;z-index:2147483647;height:48px;box-shadow:0 6px 24px rgba(0,0,0,.25)' : ''
    ].join(';'));
  }

  function label() {
    if (!state) return 'Zu Sakura hinzufügen';
    if (state.unavailable) return 'In privaten Fenstern nicht verfügbar';
    if (state.busy) return 'Wird installiert …';
    if (state.installed) return 'Aus Sakura entfernen';
    return 'Zu Sakura hinzufügen';
  }

  function paint() {
    if (!ours) return;
    ours.querySelector('[data-t]').textContent = label();
    const off = !!(state && (state.busy || state.unavailable));
    ours.style.opacity = off ? '.65' : '1';
    ours.style.cursor = off ? 'default' : 'pointer';
    ours.style.background = state && state.installed ? '#5F5873' : '#D9566F';
  }

  function makeButton(floating) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.sakura = '1';
    style(b, floating);
    b.innerHTML = '<span style="all:unset;display:inline-grid;place-items:center;width:22px;height:22px;border-radius:3px;background:#fff;color:#D9566F;font:600 14px/1 \'Yu Mincho\',\'Noto Serif JP\',serif;transform:rotate(-4deg)">桜</span><span data-t></span>';
    b.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      const id = currentId();
      if (!id || !state || state.busy || state.unavailable) return;
      state = { ...state, busy: !state.installed };
      paint();
      state = await call(state.installed ? 'remove' : 'install', id);
      paint();
    });
    return b;
  }

  function findChromeButton() {
    for (const el of document.querySelectorAll('button, [role="button"]')) {
      if (el.dataset.sakura) continue;
      if (CHROME_BTN.test((el.textContent || '').trim())) return el;
    }
    return null;
  }

  function place() {
    const id = currentId();
    if (!id) { if (ours) { ours.remove(); ours = null; } return; }
    const original = findChromeButton();
    if (original) {
      if (original.style.display !== 'none') original.style.display = 'none';
      if (!ours || ours.isConnected === false || ours.previousElementSibling !== original || ours.dataset.floating) {
        if (ours) ours.remove();
        ours = makeButton(false);
        original.insertAdjacentElement('afterend', ours);
      }
    } else if (!ours || !ours.isConnected) {
      // Knopf (noch) nicht gefunden → schwebender Knopf unten rechts
      ours = makeButton(true);
      ours.dataset.floating = '1';
      document.documentElement.appendChild(ours);
    }
    paint();
  }

  async function refresh() {
    const id = currentId();
    if (id !== stateId) { state = null; stateId = id; }
    if (id) { state = await call('status', id).catch(() => null); }
    place();
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(() => { place(); }, 120);
  }

  window.addEventListener('DOMContentLoaded', () => {
    refresh();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    // Der Store ist eine Single-Page-App: Adresse und Status regelmäßig prüfen
    let last = location.href;
    setInterval(() => {
      if (location.href !== last) { last = location.href; refresh(); }
      else if (state && state.busy) refresh();
    }, 700);
    setInterval(refresh, 4000);
  });
}
