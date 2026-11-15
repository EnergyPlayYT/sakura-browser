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
