/* Sakura – Browseroberfläche (Tabs, Adressleiste, Menüs, Seitenleiste) */
const api = window.chrome2;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPrivate = new URLSearchParams(location.search).get('private') === '1';
if (isPrivate) { document.body.classList.add('private'); $('#private-tag').hidden = false; }

let S = { tabs: [], activeId: null };
let overlay = null; // 'menu' | 'shield' | 'panel' | 'suggest'
let panelKind = null;

const letterOf = t => (String(t || '?').replace(/^https?:\/\/(www\.)?/, '').trim()[0] || '?').toUpperCase();
const prettyUrl = u => { if (!u) return ''; try { return decodeURI(u); } catch { return u; } };
// Logo einer Webseite (aus Sakuras Zwischenspeicher); fehlt es, bleibt der Buchstabe stehen
const iconUrl = u => /^https?:/i.test(String(u || '')) ? 'sakura://favicon/?u=' + encodeURIComponent(u) : null;
function iconImg(url, label, cls = '') {
  const src = iconUrl(url);
  const letter = esc(letterOf(label || url));
  return src ? `<img class="ficon ${cls}" src="${esc(src)}" alt="" data-letter="${letter}">` : `<i class="ficon-l ${cls}">${letter}</i>`;
}
// Kein Logo gefunden → Buchstabe statt kaputtem Bild
document.addEventListener('error', e => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('ficon')) return;
  const i = document.createElement('i');
  i.className = 'ficon-l';
  i.textContent = img.dataset.letter || '?';
  img.replaceWith(i);
}, true);
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

// ------------------------------------------------------------ Zustand anzeigen
api.on('state', s => { S = s; render(); });
api.call('state').then(s => { if (s) { S = s; render(); } });

// Design: Farben kommen fertig aus dem Hauptprozess (pages/themes.js)
let themeKey = '';
function applyTheme(t) {
  const key = JSON.stringify(t || null);
  if (key === themeKey) return;
  themeKey = key;
  const root = document.documentElement;
  for (const k of [...root.style]) if (k.startsWith('--')) root.style.removeProperty(k);
  if (t) for (const [k, v] of Object.entries(t.vars)) root.style.setProperty(k, v);
  document.body.classList.toggle('light', !!(t && !t.dark));
}

function render() {
  applyTheme(S.theme);
  renderTabs();
  $('#back').disabled = !S.canBack;
  $('#forward').disabled = !S.canForward;
  $('#reload').innerHTML = `<svg><use href="#i-${S.loading ? 'stop' : 'reload'}"/></svg>`;
  $('#reload').title = S.loading ? 'Laden stoppen' : 'Neu laden (F5)';
  const addr = $('#address');
  if (document.activeElement !== addr) addr.value = prettyUrl(S.url);
  const lead = $('#secure');
  lead.className = 'lead' + (S.url ? (S.secure ? ' secure' : (S.url.startsWith('http:') ? ' insecure' : '')) : '');
  lead.innerHTML = `<svg><use href="#i-${!S.url ? 'search' : S.secure ? 'lock' : S.url.startsWith('http:') ? 'warn' : 'search'}"/></svg>`;
  lead.title = !S.url ? '' : S.secure ? 'Verbindung ist verschlüsselt' : 'Verbindung ist nicht verschlüsselt';
  $('#star').classList.toggle('on', !!S.bookmarked);
  $('#star').hidden = !S.url;
  $('#star').title = S.bookmarked ? 'Lesezeichen entfernen (Strg+D)' : 'Lesezeichen setzen (Strg+D)';
  const shieldOff = !S.adblock || S.allowed;
  $('#shield').classList.toggle('off', shieldOff);
  $('#blocked').textContent = !shieldOff && S.blocked ? (S.blocked > 99 ? '99+' : S.blocked) : '';
  $('#zoom').hidden = !S.zoom || S.zoom === 100;
  $('#zoom').textContent = S.zoom + ' %';
  $('#zoom-val').textContent = S.zoom + ' %';
  $('#scripts-ind').hidden = !S.scripts;
  $('#scripts-ind').title = S.scripts === 1 ? 'Ein eigenes Skript läuft auf dieser Seite' : `${S.scripts} eigene Skripte laufen auf dieser Seite`;
  renderExtActions();
  renderUpdateBtn();
  renderBar();
  renderDownloadsBtn();
  if (overlay === 'shield') fillShield();
}

// ---------- Favoritenleiste
let barKey = '';
function renderBar() {
  const show = !!S.bar;
  document.body.classList.toggle('has-bar', show);
  $('#bookmarkbar').hidden = !show;
  $('#menu-bar').firstChild.textContent = show ? 'Favoritenleiste ausblenden' : 'Favoritenleiste anzeigen';
  if (!show) { barKey = ''; return; }
  const key = JSON.stringify(S.bar);
  if (key === barKey) return;
  barKey = key;
  const box = $('#bm-items');
  box.innerHTML = '';
  if (!S.bar.length) {
    box.innerHTML = '<span class="bm-empty">Leg hier Lesezeichen ab: Klick in der Adressleiste auf den Stern oder drück Strg+D.</span>';
  }
  for (const b of S.bar) {
    const el = document.createElement('button');
    el.className = 'bm';
    el.title = `${b.title}\n${b.url}`;
    el.draggable = true;
    el.dataset.id = b.id;
    const label = b.title && b.title !== b.url ? b.title : hostOf(b.url);
    el.innerHTML = `<img src="${esc(iconUrl(b.url) || b.favicon || '')}" alt=""><span>${esc(label)}</span>`;
    const img = el.querySelector('img');
    img.onerror = () => {
      // erst das gespeicherte Logo der Seite versuchen, dann den Buchstaben
      if (b.favicon && img.src !== b.favicon) { img.src = b.favicon; return; }
      img.replaceWith(Object.assign(document.createElement('i'), { textContent: letterOf(label) }));
    };
    el.addEventListener('click', e => api.call('bmOpen', { url: b.url, newTab: e.ctrlKey || e.shiftKey, background: e.ctrlKey && !e.shiftKey }));
    el.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); api.call('bmOpen', { url: b.url, newTab: true, background: true }); } });
    el.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
    el.addEventListener('contextmenu', e => { e.preventDefault(); api.call('bmMenu', b.id); });
    el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/sakura-bm', b.id); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/sakura-bm')) { e.preventDefault(); el.classList.add('drop-before'); } });
    el.addEventListener('dragleave', () => el.classList.remove('drop-before'));
    el.addEventListener('drop', e => {
      e.preventDefault(); el.classList.remove('drop-before');
      const id = e.dataTransfer.getData('text/sakura-bm');
      if (id && id !== b.id) {
        const order = S.bar.map(x => x.id).filter(x => x !== id);
        api.call('bmMove', { id, index: order.indexOf(b.id) });
      }
    });
    box.appendChild(el);
  }
  requestAnimationFrame(fitBar);
}
// Was nicht in die Leiste passt, kommt ins »-Menü
function fitBar() {
  const box = $('#bm-items');
  const items = [...box.querySelectorAll('.bm')];
  items.forEach(el => { el.style.display = ''; });
  const limit = box.getBoundingClientRect().right;
  const hidden = items.filter(el => el.getBoundingClientRect().right > limit + 1);
  hidden.forEach(el => { el.style.display = 'none'; });
  $('#bm-more').hidden = !hidden.length;
  $('#bm-more').dataset.ids = JSON.stringify(hidden.map(el => el.dataset.id));
}
window.addEventListener('resize', () => { if (S.bar) fitBar(); });
$('#bm-more').onclick = () => api.call('bmOverflow', JSON.parse($('#bm-more').dataset.ids || '[]'));
$('#bookmarkbar').addEventListener('contextmenu', e => { if (e.target.closest('.bm')) return; e.preventDefault(); openPanel('bookmarks'); });
api.on('edit-bookmark', async id => {
  openPanel('bookmarks');
  await new Promise(r => setTimeout(r, 120));
  const row = document.querySelector(`#panel-body .p-item[data-id="${id}"] [data-act=edit]`);
  if (row) row.click();
});

function renderUpdateBtn() {
  const u = S.update || {};
  const b = $('#update-btn');
  b.hidden = u.state !== 'ready';
  b.textContent = 'Neu starten und aktualisieren';
  $('#menu-about').textContent = u.state === 'ready' ? `Update auf ${u.version} bereit – neu starten` : 'Über Sakura und Updates';
}
$('#update-btn').onclick = () => api.call('updateInstall');

let extKey = '';
function renderExtActions() {
  const list = S.extActions || [];
  const key = JSON.stringify(list.map(x => [x.id, x.name, !!x.icon]));
  $('#ext-btn').hidden = S.private;
  if (key === extKey) return;
  extKey = key;
  const box = $('#ext-actions');
  box.innerHTML = '';
  for (const x of list.slice(0, 8)) {
    const b = document.createElement('button');
    b.className = 'icon';
    b.title = x.name;
    b.innerHTML = x.icon ? `<img src="${esc(x.icon)}" alt="">` : `<span class="ph">${esc(letterOf(x.name))}</span>`;
    b.onclick = () => { const r = b.getBoundingClientRect(); api.call('extPopup', { id: x.id, rect: { x: r.left, y: r.top, width: r.width, height: r.height } }); };
    b.oncontextmenu = e => { e.preventDefault(); api.call('extMenu', x.id); };
    box.appendChild(b);
  }
}
$('#ext-btn').onclick = () => openPanel('extensions');

function renderDownloadsBtn() {
  const d = S.downloads || {};
  const b = $('#dl-btn');
  b.hidden = !d.any;
  b.classList.toggle('active', d.active > 0);
  b.querySelector('.ring circle').style.strokeDashoffset = 62.8 * (1 - (d.progress == null ? 0.15 : d.progress));
  b.title = d.active ? `${d.active} Download${d.active === 1 ? '' : 's'} läuft` : 'Downloads (Strg+J)';
}
$('#dl-btn').onclick = () => openPanel('downloads');
api.on('download-started', () => {
  const b = $('#dl-btn');
  b.classList.remove('flash'); void b.offsetWidth; b.classList.add('flash');
});

const GROUP_COLORS = { sakura: 'Rosa', sora: 'Blau', matcha: 'Grün', yamabuki: 'Gelb', fuji: 'Lila', momiji: 'Rot', sumi: 'Grau' };
let pendingGroupEdit = null;

function renderTabs() {
  const box = $('#tabs');
  const groups = new Map((S.groups || []).map(g => [g.id, g]));
  const shown = S.tabs.filter(t => !t.group || !groups.get(t.group) || !groups.get(t.group).collapsed);
  const pinned = shown.filter(t => t.pinned).length;
  const avail = box.parentElement.clientWidth - 150 - 80 - pinned * 45 - groups.size * 60;
  const narrow = avail / Math.max(1, shown.length - pinned) < 90;
  box.innerHTML = '';
  let prevGroup = null;
  S.tabs.forEach((t, i) => {
    const g = t.group && groups.get(t.group);
    if (g && prevGroup !== g.id) box.appendChild(groupChip(g));
    prevGroup = g ? g.id : null;
    if (g && g.collapsed) return;
    const el = document.createElement('div');
    const next = S.tabs[i + 1];
    el.className = 'tab' + (t.id === S.activeId ? ' active' : '') + (t.pinned ? ' pinned' : narrow ? ' narrow' : '') +
      (g ? ' grouped' + (S.tabs[i - 1] && S.tabs[i - 1].group === g.id ? '' : ' first') + (next && next.group === g.id ? '' : ' last') : '');
    if (g) el.style.setProperty('--gc', `var(--g-${g.color})`);
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', t.id === S.activeId);
    el.title = t.title + (g && g.name ? ` – Gruppe „${g.name}“` : '');
    el.draggable = true;
    el.dataset.id = t.id;
    let fav;
    if (t.loading) fav = '<span class="fav spin"></span>';
    else if (t.newtab) fav = '<span class="fav letter">桜</span>';
    else if (t.favicon) fav = `<span class="fav"><img src="${esc(t.favicon)}" alt=""></span>`;
    else if (t.url && iconUrl(t.url)) fav = `<span class="fav"><img src="${esc(iconUrl(t.url))}" alt=""></span>`;
    else fav = `<span class="fav letter">${esc(letterOf(t.title))}</span>`;
    el.innerHTML = `${fav}<span class="title">${esc(t.title)}</span>${t.muted ? '<svg class="snd muted" data-mute><title>Ton einschalten</title><use href="#i-muted"/></svg>' : t.audible ? '<svg class="snd" data-mute><title>Stummschalten</title><use href="#i-sound"/></svg>' : ''}<button class="close" title="Tab schließen (Strg+W)"><svg><use href="#i-x"/></svg></button>${g ? '<span class="gline"></span>' : ''}`;
    const img = el.querySelector('img');
    if (img) img.onerror = () => { img.parentElement.className = 'fav letter'; img.parentElement.textContent = letterOf(t.title); };
    el.addEventListener('mousedown', e => {
      if (e.button === 1) { e.preventDefault(); if (!t.pinned) api.call('closeTab', t.id); }
      else if (e.button === 0 && e.target.closest('[data-mute]')) { e.stopPropagation(); api.call('toggleMute', t.id); }
      else if (e.button === 0 && !e.target.closest('.close')) api.call('activate', t.id);
    });
    el.addEventListener('contextmenu', e => { e.preventDefault(); api.call('tabMenu', t.id); });
    el.querySelector('.close').addEventListener('click', e => { e.stopPropagation(); api.call('closeTab', t.id); });
    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('text/sakura-tab', String(t.id));
      e.dataTransfer.effectAllowed = 'move';
      el.classList.add('dragging');
    });
    // Losgelassen: Sakura prüft anhand der Mausposition, ob der Tab in ein neues oder anderes Fenster soll
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); api.call('tabDragEnd', t.id); });
    el.addEventListener('dragover', e => e.preventDefault());
    el.addEventListener('drop', e => {
      e.preventDefault();
      const id = Number(e.dataTransfer.getData('text/sakura-tab'));
      if (id && id !== t.id) api.call('moveTab', { id, index: S.tabs.findIndex(x => x.id === t.id) });
    });
    box.appendChild(el);
  });
  if (pendingGroupEdit && groups.has(pendingGroupEdit)) {
    const id = pendingGroupEdit;
    pendingGroupEdit = null;
    openGroupPop(id);
  }
}

function groupChip(g) {
  const c = document.createElement('div');
  c.className = 'gchip' + (g.name ? '' : ' empty') + (g.collapsed ? ' collapsed' : '');
  c.style.setProperty('--gc', `var(--g-${g.color})`);
  c.dataset.group = g.id;
  c.tabIndex = 0;
  c.setAttribute('role', 'button');
  c.setAttribute('aria-expanded', !g.collapsed);
  c.title = (g.name || 'Gruppe') + ` – ${g.count} Tab${g.count === 1 ? '' : 's'}. Klicken zum ${g.collapsed ? 'Aufklappen' : 'Einklappen'}, Rechtsklick zum Bearbeiten`;
  c.innerHTML = g.name ? `<span>${esc(g.name)}</span>${g.collapsed ? `<span class="cnt">${g.count}</span>` : ''}` : '';
  c.onclick = () => api.call('groupToggle', g.id);
  c.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); api.call('groupToggle', g.id); } };
  c.oncontextmenu = e => { e.preventDefault(); openGroupPop(g.id); };
  c.ondblclick = e => { e.preventDefault(); openGroupPop(g.id); };
  c.ondragover = e => { e.preventDefault(); c.classList.add('drop'); };
  c.ondragleave = () => c.classList.remove('drop');
  c.ondrop = e => {
    e.preventDefault(); c.classList.remove('drop');
    const id = Number(e.dataTransfer.getData('text/sakura-tab'));
    if (id) api.call('groupAdd', { tabId: id, groupId: g.id });
  };
  return c;
}

let editingGroup = null;
function openGroupPop(id) {
  const g = (S.groups || []).find(x => x.id === id);
  const chip = document.querySelector(`.gchip[data-group="${id}"]`);
  if (!g || !chip) return;
  openOverlay('group');
  editingGroup = id;
  const pop = $('#group-pop');
  const r = chip.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - 296)) + 'px';
  pop.style.right = 'auto';
  pop.style.top = (r.bottom + 6) + 'px';
  pop.hidden = false;
  $('#group-name').value = g.name || '';
  $('#group-colors').innerHTML = Object.entries(GROUP_COLORS).map(([k, label]) =>
    `<button role="radio" aria-checked="${k === g.color}" title="${label}" data-color="${k}" style="--c:var(--g-${k})"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></button>`).join('');
  setTimeout(() => { $('#group-name').focus(); $('#group-name').select(); }, 20);
}
$('#group-name').addEventListener('input', e => api.call('groupUpdate', { id: editingGroup, name: e.target.value }));
$('#group-name').addEventListener('keydown', e => { if (e.key === 'Enter') { closeOverlay(); api.call('focusPage'); } });
$('#group-colors').addEventListener('click', e => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  for (const x of $('#group-colors').children) x.setAttribute('aria-checked', x === b);
  api.call('groupUpdate', { id: editingGroup, color: b.dataset.color });
});
$('#group-pop').addEventListener('click', e => {
  const b = e.target.closest('[data-g]');
  if (!b) return;
  const id = editingGroup;
  closeOverlay();
  api.call({ newtab: 'groupNewTab', ungroup: 'groupUngroup', close: 'groupClose' }[b.dataset.g], id);
});
api.on('edit-group', id => { pendingGroupEdit = id; });
window.addEventListener('resize', renderTabs);
$('#tabbar .drag-fill').addEventListener('dblclick', () => api.call('newTab'));
$('#newtab').onclick = () => { api.call('newTab'); focusAddress(); };

// ------------------------------------------------------------ Werkzeugleiste
$('#back').onclick = () => api.call('back');
$('#forward').onclick = () => api.call('forward');
$('#reload').onclick = () => api.call(S.loading ? 'stop' : 'reload');
$('#home').onclick = () => api.call('home');
$('#star').onclick = () => api.call('toggleBookmark');

function focusAddress() {
  const a = $('#address');
  setTimeout(() => { a.focus(); a.select(); }, 30);
}
api.on('focus-address', focusAddress);

// ------------------------------------------------------------ Overlays
function openOverlay(kind) {
  closeOverlay(true);
  overlay = kind;
  $('#backdrop').hidden = false;
  $('#backdrop').classList.toggle('clear', kind === 'suggest' || kind === 'menu' || kind === 'shield' || kind === 'group');
  api.call('overlay', true);
}
function closeOverlay(keep) {
  for (const s of ['#menu', '#shield-pop', '#panel', '#suggest', '#group-pop']) $(s).hidden = true;
  editingGroup = null;
  $('#backdrop').hidden = true;
  overlay = null; panelKind = null;
  if (!keep) api.call('overlay', false);
}
$('#backdrop').addEventListener('mousedown', () => closeOverlay());
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && overlay && overlay !== 'suggest') { closeOverlay(); api.call('focusPage'); }
});

// Menü
$('#menu-btn').onclick = () => {
  if (overlay === 'menu') return closeOverlay();
  openOverlay('menu');
  $('#menu').hidden = false;
  $('#menu button').focus();
};
$('#menu').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.zoom) { api.call('zoom', Number(b.dataset.zoom)); return; }
  if (b.dataset.panel) { openPanel(b.dataset.panel); return; }
  closeOverlay();
  api.call(b.dataset.cmd);
});
api.on('open-panel', kind => openPanel(kind));

// Werbeblocker
$('#shield').onclick = () => {
  if (overlay === 'shield') return closeOverlay();
  openOverlay('shield');
  $('#shield-pop').hidden = false;
  fillShield();
};
function fillShield() {
  const n = S.blocked || 0;
  $('#shield-text').textContent = !S.adblock ? 'Der Werbeblocker ist ausgeschaltet.'
    : S.allowed ? `Auf ${S.host} ist der Werbeblocker pausiert.`
    : n ? `${n} Werbe- und Tracker-Anfrage${n === 1 ? '' : 'n'} auf ${S.host || 'dieser Seite'} blockiert.`
    : `Auf ${S.host || 'dieser Seite'} wurde noch nichts blockiert.`;
  $('#shield-site').checked = !S.allowed;
  $('#shield-site').disabled = !S.adblock || !S.host;
  $('#shield-global').checked = !!S.adblock;
  $('#shield-cookie').checked = S.cookieReject && !S.cookieAllowed;
  $('#shield-cookie').disabled = !S.cookieReject || !S.host;
  $('#shield-cookie').parentElement.title = S.cookieReject ? '' : 'In den Einstellungen ausgeschaltet';
}
$('#shield-cookie').onchange = () => api.call('toggleCookieAllow');
$('#shield-site').onchange = () => api.call('toggleAllow');
$('#shield-global').onchange = e => api.call('setPrefs', { adblock: e.target.checked });

// ------------------------------------------------------------ Adressleiste mit Vorschlägen
let sugg = [], sel = -1, typed = '';
const addr = $('#address');
addr.addEventListener('focus', () => addr.select());
addr.addEventListener('input', async () => {
  typed = addr.value;
  if (!typed.trim()) { hideSuggest(); return; }
  const list = await api.call('suggest', typed);
  if (addr.value !== typed) return;
  sugg = [{ kind: 'typed', url: typed, title: typed }, ...(list || [])];
  sel = 0;
  showSuggest();
});
addr.addEventListener('keydown', e => {
  if (overlay === 'suggest' && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault();
    sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + sugg.length) % sugg.length;
    addr.value = sugg[sel].kind === 'typed' ? typed : sugg[sel].url;
    paintSuggest();
  } else if (e.key === 'Escape') {
    hideSuggest();
    addr.value = prettyUrl(S.url);
    addr.blur();
    api.call('focusPage');
  }
});
$('#omnibox').addEventListener('submit', e => {
  e.preventDefault();
  const v = addr.value.trim();
  hideSuggest();
  if (!v) return;
  addr.blur();
  api.call('navigate', v);
});
addr.addEventListener('blur', () => setTimeout(() => { if (overlay === 'suggest') hideSuggest(); }, 150));

function showSuggest() {
  if (overlay !== 'suggest') { openOverlay('suggest'); }
  const r = $('#omnibox').getBoundingClientRect();
  const box = $('#suggest');
  box.style.left = r.left + 'px';
  box.style.width = r.width + 'px';
  box.hidden = false;
  paintSuggest();
}
function paintSuggest() {
  $('#suggest').innerHTML = sugg.map((s, i) => {
    const icon = s.kind === 'bookmark' ? 'star' : s.kind === 'history' ? 'clock' : 'search';
    const title = s.kind === 'typed' ? esc(s.title) : esc(s.title || s.url);
    const sub = s.kind === 'typed' ? '' : ` <span class="u">— ${esc(s.url.replace(/^https?:\/\/(www\.)?/, ''))}</span>`;
    const lead = s.kind === 'typed' ? `<svg><use href="#i-${icon}"/></svg>` : `<span class="sfav">${iconImg(s.url, s.title)}</span>`;
    return `<li role="option" data-i="${i}" class="${s.kind}${i === sel ? ' sel' : ''}">${lead}<span class="t">${title}</span>${sub}${s.kind === 'bookmark' ? '<svg class="bmk"><use href="#i-star"/></svg>' : ''}</li>`;
  }).join('');
}
$('#suggest').addEventListener('mousedown', e => {
  const li = e.target.closest('li');
  if (!li) return;
  e.preventDefault();
  const s = sugg[Number(li.dataset.i)];
  hideSuggest();
  addr.blur();
  api.call('navigate', s.kind === 'typed' ? typed : s.url);
});
function hideSuggest() { if (overlay === 'suggest') closeOverlay(); sugg = []; sel = -1; }

// ------------------------------------------------------------ Suche auf der Seite
const findInput = $('#find-input');
api.on('find-open', () => { $('#findbar').hidden = false; findInput.focus(); findInput.select(); if (findInput.value) doFind(false); });
api.on('find-close', () => { $('#findbar').hidden = true; $('#find-count').textContent = ''; });
api.on('find-result', r => { $('#find-count').textContent = r.total ? `${r.active} von ${r.total}` : 'Keine Treffer'; });
const doFind = (next, forward = true) => api.call('find', { text: findInput.value, next, forward });
findInput.addEventListener('input', () => { if (!findInput.value) $('#find-count').textContent = ''; doFind(false); });
findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') doFind(true, !e.shiftKey);
  if (e.key === 'Escape') api.call('closeFind');
});
$('#find-next').onclick = () => doFind(true, true);
$('#find-prev').onclick = () => doFind(true, false);
$('#find-close').onclick = () => api.call('closeFind');

// ------------------------------------------------------------ Seitenleiste
const TITLES = { about: 'Über Sakura', bookmarks: 'Lesezeichen', history: 'Verlauf', settings: 'Einstellungen', downloads: 'Downloads', extensions: 'Erweiterungen', scripts: 'Eigene Skripte' };
const RENDER = () => ({ about: renderAbout, bookmarks: renderBookmarks, history: renderHistory, settings: renderSettings, downloads: renderDownloads, extensions: renderExtensions, scripts: renderScripts });
function openPanel(kind) {
  if (!TITLES[kind]) return;
  if (kind === 'extensions' && S.private) kind = 'settings';
  openOverlay('panel');
  panelKind = kind;
  $('#panel').hidden = false;
  $('#panel').classList.toggle('wide', kind === 'scripts');
  $('#panel-title').textContent = TITLES[kind];
  RENDER()[kind]();
}
api.on('downloads-changed', () => { if (panelKind === 'downloads') renderDownloads(); });
api.on('extensions-changed', () => { if (panelKind === 'extensions') renderExtensions(); });
$('#panel-close').onclick = () => closeOverlay();

function itemHtml(it, extra = '') {
  return `<div class="p-item" data-id="${esc(it.id)}">
    <span class="fav">${iconImg(it.url, it.title)}</span>
    <div class="txt" data-url="${esc(it.url)}" title="${esc(it.url)}"><div>${esc(it.title || it.url)}</div><small>${esc(hostOf(it.url))}</small></div>
    ${extra}</div>`;
}
function openFromPanel(e) {
  const t = e.target.closest('.txt');
  if (!t) return false;
  if (e.ctrlKey || e.button === 1) api.call('openUrlInNewTab', t.dataset.url);
  else { api.call('navigate', t.dataset.url); closeOverlay(); }
  return true;
}

async function renderBookmarks(filter = '') {
  const body = $('#panel-body');
  const all = await api.call('bookmarks');
  const q = filter.toLowerCase();
  const list = all.filter(b => !q || (b.title || '').toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
  body.innerHTML = `<input class="p-search" placeholder="Lesezeichen durchsuchen" value="${esc(filter)}">` +
    (list.length ? list.map(b => itemHtml(b,
      `<button class="icon small" data-act="edit" title="Bearbeiten"><svg><use href="#i-edit"/></svg></button>
       <button class="icon small" data-act="del" title="Löschen"><svg><use href="#i-trash"/></svg></button>`)).join('')
      : `<p class="p-empty">${all.length ? 'Keine Treffer.' : 'Noch keine Lesezeichen. Klick in der Adressleiste auf den Stern oder drück Strg+D, um die aktuelle Seite zu speichern.'}</p>`);
  const s = body.querySelector('.p-search');
  s.oninput = () => { const pos = s.selectionStart; renderBookmarks(s.value).then(() => { const n = $('#panel-body .p-search'); n.focus(); n.setSelectionRange(pos, pos); }); };
  if (!filter) s.focus();
  body.onclick = e => {
    if (openFromPanel(e)) return;
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const row = b.closest('.p-item');
    const bm = all.find(x => x.id === row.dataset.id);
    if (b.dataset.act === 'del') { api.call('removeBookmark', bm.id).then(() => renderBookmarks(s.value)); }
    if (b.dataset.act === 'edit') {
      const form = document.createElement('div');
      form.className = 'p-edit';
      form.innerHTML = `<input name="title" value="${esc(bm.title)}" aria-label="Name"><input name="url" value="${esc(bm.url)}" aria-label="Adresse">
        <div class="row"><button class="btn" data-x="cancel">Abbrechen</button><button class="btn primary" data-x="save">Speichern</button></div>`;
      row.replaceWith(form);
      form.querySelector('input').focus();
      form.onclick = ev => {
        const x = ev.target.dataset.x;
        ev.stopPropagation();
        if (x === 'cancel') renderBookmarks(s.value);
        if (x === 'save') api.call('updateBookmark', { id: bm.id, patch: { title: form.querySelector('[name=title]').value, url: form.querySelector('[name=url]').value } }).then(() => renderBookmarks(s.value));
      };
    }
  };
  body.onauxclick = openFromPanel;
}

function dayLabel(ts) {
  const d = new Date(ts); const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Gestern';
  return d.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
}
async function renderHistory(filter = '') {
  const body = $('#panel-body');
  const list = await api.call('history', filter);
  let html = `<input class="p-search" placeholder="Verlauf durchsuchen" value="${esc(filter)}">`;
  if (!filter) html += await devicesHtml();
  let last = '';
  for (const h of list) {
    const day = dayLabel(h.visitedAt);
    if (day !== last) { html += `<div class="p-day">${esc(day)}</div>`; last = day; }
    const time = new Date(h.visitedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    html += itemHtml(h, `<time>${time}</time><button class="icon small" data-act="del" title="Aus dem Verlauf entfernen"><svg><use href="#i-x"/></svg></button>`);
  }
  if (!list.length) html += `<p class="p-empty">${filter ? 'Keine Treffer.' : 'Der Verlauf ist leer.'}</p>`;
  if (!filter && list.length) html += `<div class="set"><button class="btn danger" id="clear-hist">Gesamten Verlauf löschen</button></div>`;
  body.innerHTML = html;
  const s = body.querySelector('.p-search');
  s.oninput = () => { const pos = s.selectionStart; renderHistory(s.value).then(() => { const n = $('#panel-body .p-search'); n.focus(); n.setSelectionRange(pos, pos); }); };
  if (!filter) s.focus();
  body.onclick = e => {
    if (openFromPanel(e)) return;
    if (e.target.id === 'clear-hist') { openPanel('settings'); setTimeout(() => $('#data-section').scrollIntoView(), 50); return; }
    const b = e.target.closest('button[data-act=del]');
    if (b) api.call('removeHistory', b.closest('.p-item').dataset.id).then(() => b.closest('.p-item').remove());
  };
  body.onauxclick = openFromPanel;
}

async function devicesHtml() {
  const devs = (await api.call('devices')) || [];
  const withTabs = devs.filter(d => d.tabs && d.tabs.length);
  if (!withTabs.length) return '';
  return withTabs.map(d => `<div class="device"><h4>${esc(d.name || 'Gerät')}<small>${d.platform === 'android' ? 'Handy' : 'PC'} – ${esc(timeAgo(d.updatedAt))}</small></h4>` +
    d.tabs.slice(0, 15).map(t => itemHtml({ id: '', url: t.url, title: t.title })).join('') + '</div>').join('') +
    '<div class="p-day">Verlauf auf diesem Gerät</div>';
}

// ---------- Über Sakura / Updates
async function renderAbout() {
  const u = await api.call('updateInfo');
  const body = $('#panel-body');
  const status = {
    idle: 'Noch nicht geprüft.', checking: 'Suche nach Updates …', current: 'Sakura ist auf dem neuesten Stand.',
    downloading: `Update auf ${u.version} wird geladen${u.percent != null ? ` (${u.percent} %)` : ''} …`,
    ready: `Version ${u.version} ist bereit. Sakura startet neu und deine Tabs bleiben erhalten.`,
    error: u.message, unsupported: u.message
  }[u.state] || '';
  const cls = { current: 'ok', ready: 'ok', downloading: 'syncing', checking: 'syncing', error: 'error' }[u.state] || '';
  body.innerHTML = `<section class="set">
      <h3>Sakura ${esc(u.current)}</h3>
      <p>Chromium ${esc(u.chromium)} · Electron ${esc(u.electron)}</p>
      <div class="status ${cls}"><i></i><span>${esc(status)}</span></div>
      <div class="row">${u.state === 'ready' ? '<button class="btn primary" id="up-go">Jetzt neu starten</button>' : ''}${u.supported && u.state !== 'ready' ? '<button class="btn" id="up-check">Nach Updates suchen</button>' : ''}</div>
    </section>
    <section class="set">
      <h3>Wie Sakura aktuell bleibt</h3>
      <p>Sakura bringt seine eigene Chromium-Engine mit. Jede Woche prüft GitHub, ob es für sie Sicherheitskorrekturen gibt, und baut dann automatisch eine neue Sakura-Version. Sakura lädt sie im Hintergrund und installiert sie beim nächsten Neustart – so wie Chrome.</p>
    </section>`;
  if ($('#up-go')) $('#up-go').onclick = () => api.call('updateInstall');
  if ($('#up-check')) $('#up-check').onclick = async () => { $('#up-check').disabled = true; await api.call('updateCheck'); };
}
api.on('update-status', () => { if (panelKind === 'about') renderAbout(); });

// ---------- Downloads
const fmtBytes = n => n >= 1e9 ? (n / 1e9).toFixed(1).replace('.', ',') + ' GB' : n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' kB' : (n || 0) + ' B';
async function renderDownloads() {
  const body = $('#panel-body');
  const list = (await api.call('downloads')) || [];
  let html = `<div class="p-bar"><button class="btn" data-a="folder">Download-Ordner öffnen</button>${list.some(d => d.state !== 'progressing') ? '<button class="btn" data-a="clear">Liste leeren</button>' : ''}</div>`;
  if (!list.length) html += '<p class="p-empty">Noch keine Downloads.</p>';
  for (const d of list) {
    const gone = d.state === 'completed' && d.exists === false;
    let sub;
    if (d.state === 'progressing') sub = d.paused ? 'Pausiert' : `${fmtBytes(d.received)}${d.total ? ' von ' + fmtBytes(d.total) : ''}`;
    else if (d.state === 'completed') sub = gone ? 'Gelöscht' : fmtBytes(d.received) + ' – ' + hostOf(d.url);
    else if (d.state === 'cancelled') sub = 'Abgebrochen';
    else sub = 'Fehlgeschlagen';
    const acts = d.state === 'progressing'
      ? `<button class="icon small" data-a="pause" title="${d.paused ? 'Fortsetzen' : 'Pausieren'}"><svg><use href="#i-${d.paused ? 'play' : 'pause'}"/></svg></button><button class="icon small" data-a="cancel" title="Abbrechen"><svg><use href="#i-x"/></svg></button>`
      : `${d.state === 'completed' && !gone ? '<button class="icon small" data-a="show" title="Im Ordner anzeigen"><svg><use href="#i-folder"/></svg></button>' : ''}<button class="icon small" data-a="remove" title="Aus der Liste entfernen"><svg><use href="#i-x"/></svg></button>`;
    html += `<div class="dl${gone ? ' gone' : ''}" data-id="${esc(d.id)}"><span class="name" title="${esc(d.path || d.filename)}">${esc(d.filename)}</span><span class="acts">${acts}</span>
      ${d.state === 'progressing' ? `<progress max="1" value="${d.total ? d.received / d.total : 0}"></progress>` : ''}<small>${esc(sub)}</small></div>`;
  }
  body.innerHTML = html;
  body.onclick = e => {
    const b = e.target.closest('[data-a]');
    const row = e.target.closest('.dl');
    if (!b && row && e.target.closest('.name')) return api.call('dlOpen', row.dataset.id);
    if (!b) return;
    const map = { folder: 'dlFolder', clear: 'dlClear', pause: 'dlPause', cancel: 'dlCancel', show: 'dlShow', remove: 'dlRemove' };
    api.call(map[b.dataset.a], row ? row.dataset.id : undefined);
  };
}

// ---------- Erweiterungen
async function renderExtensions() {
  const body = $('#panel-body');
  const list = (await api.call('extensions')) || [];
  let html = `<div class="p-bar"><button class="btn primary" data-a="store">Chrome Web Store öffnen</button><button class="btn" data-a="update">Nach Updates suchen</button><button class="btn" data-a="unpacked">Entpackte laden …</button></div>
    <p class="p-note">Öffne im Web Store eine Erweiterung und klick auf der Seite auf „Zu Sakura hinzufügen“. Viele Erweiterungen laufen, manche nutzen aber Chrome-Funktionen, die Sakura nicht hat. In privaten Fenstern sind Erweiterungen aus.</p>`;
  if (!list.length) html += '<p class="p-empty">Noch keine Erweiterungen installiert.</p>';
  for (const x of list) {
    html += `<div class="ext" data-id="${esc(x.id)}">
      <span class="ico">${x.icon ? `<img src="${esc(x.icon)}" alt="">` : esc(letterOf(x.name))}</span>
      <div><h4>${esc(x.name)}<small>${esc(x.version || '')}${x.source === 'unpacked' ? ' – entpackt' : ''}</small></h4>
        ${x.error ? `<p class="err">Startet nicht: ${esc(x.error)}</p>` : x.description ? `<p>${esc(x.description)}</p>` : ''}
        <div class="links">${x.options && x.running ? '<button data-a="options">Optionen</button>' : ''}${x.running ? '<button data-a="reload">Neu laden</button>' : ''}<button data-a="remove">Entfernen</button></div></div>
      <label class="switch" title="${x.enabled ? 'Ausschalten' : 'Einschalten'}"><input type="checkbox" data-a="toggle"${x.enabled ? ' checked' : ''}${x.busy ? ' disabled' : ''}></label>
    </div>`;
  }
  body.innerHTML = html;
  body.onclick = async e => {
    const b = e.target.closest('button[data-a]');
    if (!b) return;
    const id = b.closest('.ext') && b.closest('.ext').dataset.id;
    const a = b.dataset.a;
    if (a === 'store') { api.call('openWebstore'); closeOverlay(); }
    if (a === 'unpacked') api.call('extLoadUnpacked');
    if (a === 'options') { api.call('extOptions', id); closeOverlay(); }
    if (a === 'reload') api.call('extReload', id);
    if (a === 'remove') api.call('extRemove', id);
    if (a === 'update') {
      b.disabled = true; b.textContent = 'Suche Updates …';
      const r = await api.call('extUpdate');
      b.textContent = r.updated.length ? `Aktualisiert: ${r.updated.join(', ')}` : r.failed ? 'Update-Prüfung teilweise fehlgeschlagen' : 'Alles aktuell';
    }
  };
  body.onchange = e => {
    const t = e.target.closest('input[data-a=toggle]');
    if (t) api.call('extSetEnabled', { id: t.closest('.ext').dataset.id, enabled: t.checked });
  };
}

// ---------- Eigene Skripte
function parseMeta(code) {
  const m = /==UserScript==([\s\S]*?)==\/UserScript==/.exec(code);
  if (!m) return null;
  const out = { name: '', match: [] };
  for (const line of m[1].split('\n')) {
    const r = /@(\w+)\s+(.+)/.exec(line);
    if (!r) continue;
    if (r[1] === 'name' && !out.name) out.name = r[2].trim();
    if (r[1] === 'match' || r[1] === 'include') out.match.push(r[2].trim());
  }
  return out;
}
async function renderScripts() {
  const body = $('#panel-body');
  const list = (await api.call('scripts')) || [];
  let html = `<div class="p-bar"><button class="btn primary" data-a="new">Neues Skript</button></div>
    <p class="p-note">Skripte sind kleine JavaScript-Programme, die auf bestimmten Seiten automatisch laufen – zum Beispiel um Elemente auszublenden. Sie werden auch auf dein Handy übertragen. Benutzerskripte (Tampermonkey) kannst du einfügen; deren GM_-Funktionen gibt es hier aber nicht.</p>`;
  if (!list.length) html += '<p class="p-empty">Noch keine Skripte.</p>';
  for (const sc of list) {
    html += `<div class="script" data-id="${esc(sc.id)}"><div class="txt" data-a="edit"><div>${esc(sc.name)}</div><small>${esc((sc.match || []).join('  ') || 'Keine Seiten angegeben')}</small></div>
      <label class="switch"><input type="checkbox" data-a="toggle"${sc.enabled !== false ? ' checked' : ''}></label></div>`;
  }
  body.innerHTML = html;
  body.onclick = e => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    if (b.dataset.a === 'new') editScript(null);
    if (b.dataset.a === 'edit') editScript(list.find(x => x.id === b.closest('.script').dataset.id));
  };
  body.onchange = e => {
    const t = e.target.closest('input[data-a=toggle]');
    if (t) api.call('setScriptEnabled', { id: t.closest('.script').dataset.id, enabled: t.checked });
  };
}
function editScript(sc) {
  const body = $('#panel-body');
  const host = S.host ? `*://*.${S.host}/*` : '';
  body.innerHTML = `<div class="editor">
    <label>Name<input id="sc-name" value="${esc(sc ? sc.name : '')}" placeholder="z. B. YouTube aufräumen"></label>
    <label>Seiten (ein Muster pro Zeile, z. B. youtube.com oder *://*.youtube.com/*)<textarea id="sc-match" class="matches" spellcheck="false">${esc(sc ? (sc.match || []).join('\n') : host)}</textarea></label>
    <label>Code (JavaScript, läuft, sobald die Seite geladen ist)<textarea id="sc-code" class="code" spellcheck="false" placeholder="document.querySelector('#werbung')?.remove();">${esc(sc ? sc.code : '')}</textarea></label>
    <p class="msg-error" id="sc-err" hidden></p>
    <div class="row">${sc ? '<button class="btn danger" data-a="del">Löschen</button>' : ''}<span style="flex:1"></span><button class="btn" data-a="back">Abbrechen</button><button class="btn primary" data-a="save">Speichern</button></div>
  </div>`;
  const code = $('#sc-code');
  code.addEventListener('keydown', e => {
    if (e.key === 'Tab') { e.preventDefault(); document.execCommand('insertText', false, '  '); }
  });
  code.addEventListener('input', () => {
    const meta = parseMeta(code.value);
    if (!meta) return;
    if (!$('#sc-name').value.trim() && meta.name) $('#sc-name').value = meta.name;
    if ((!$('#sc-match').value.trim() || $('#sc-match').value === host) && meta.match.length) $('#sc-match').value = meta.match.join('\n');
  });
  $('#sc-name').focus();
  body.onchange = null;
  body.onclick = async e => {
    const a = e.target.dataset && e.target.dataset.a;
    if (a === 'back') renderScripts();
    if (a === 'del') { await api.call('deleteScript', sc.id); renderScripts(); }
    if (a === 'save') {
      const match = $('#sc-match').value.split('\n').map(x => x.trim()).filter(Boolean);
      const err = $('#sc-err');
      if (!code.value.trim()) { err.textContent = 'Der Code ist leer.'; err.hidden = false; return; }
      if (!match.length) { err.textContent = 'Gib mindestens eine Seite an, auf der das Skript laufen soll.'; err.hidden = false; return; }
      await api.call('saveScript', { id: sc && sc.id, name: $('#sc-name').value, match, code: code.value, enabled: sc ? sc.enabled !== false : true });
      renderScripts();
    }
  };
}

const ENGINE_NAMES = { google: 'Google', duckduckgo: 'DuckDuckGo', ecosia: 'Ecosia', startpage: 'Startpage', bing: 'Bing' };
async function renderSettings() {
  const body = $('#panel-body');
  const p = await api.call('prefs');
  const si = await api.call('syncInfo');
  body.innerHTML = `
  <section class="set">
    <h3>Suche</h3>
    <label class="field">Suchmaschine für die Adressleiste
      <select id="engine">${p.engines.map(e => `<option value="${e}"${e === p.searchEngine ? ' selected' : ''}>${ENGINE_NAMES[e] || e}</option>`).join('')}</select>
    </label>
  </section>
  <section class="set" id="design-section">
    <h3>Design</h3>
    <div class="themes" role="radiogroup" aria-label="Design">${p.themes.map(t => `
      <button class="theme${t.id === (p.theme || 'sakura') ? ' on' : ''}" role="radio" aria-checked="${t.id === (p.theme || 'sakura')}" data-theme="${esc(t.id)}"
        style="--t-bg:${esc(t.yoru)};--t-ac:${esc(t.accent)}"><i></i><span>${esc(t.label)}</span></button>`).join('')}
    </div>
    <div class="row accent-row">
      <label class="accent">Eigene Akzentfarbe <input type="color" id="accent" value="${esc(p.accent || (p.themes.find(t => t.id === (p.theme || 'sakura')) || p.themes[0]).accent)}"></label>
      <button class="btn" id="accent-reset"${p.accent ? '' : ' hidden'}>Farbe des Designs verwenden</button>
    </div>
  </section>
  <section class="set">
    <h3>Darstellung und Start</h3>
    <label class="field">Webseiten
      <select id="theme">
        <option value="system"${p.siteTheme === 'system' ? ' selected' : ''}>Wie Windows (hell oder dunkel)</option>
        <option value="dark"${p.siteTheme === 'dark' ? ' selected' : ''}>Dunkel, wenn die Seite es anbietet</option>
        <option value="force"${p.siteTheme === 'force' ? ' selected' : ''}>Immer dunkel (auch Seiten ohne Dunkelmodus)</option>
      </select>
    </label>
    <div id="restart-row" class="row" hidden><p style="margin:0;flex:1">Wird nach einem Neustart aktiv.</p><button class="btn primary" id="restart">Jetzt neu starten</button></div>
    <label class="switch"><input type="checkbox" id="restore"${p.restoreSession ? ' checked' : ''}><span>Beim Start die Tabs vom letzten Mal öffnen</span></label>
    <label class="switch"><input type="checkbox" id="dlask"${p.downloadAsk ? ' checked' : ''}><span>Vor jedem Download fragen, wo gespeichert wird</span></label>
  </section>
  <section class="set">
    <h3>Werbeblocker</h3>
    <label class="switch"><input type="checkbox" id="ab-on"${p.adblock ? ' checked' : ''}><span>Werbung und Tracker blockieren</span></label>
    <label class="switch"><input type="checkbox" id="ab-ext"${p.adblockExtended ? ' checked' : ''}><span>Erweiterte Liste verwenden (rund 80.000 Domains, wird wöchentlich geladen)</span></label>
    <p id="ab-info">${p.blocklistSize.toLocaleString('de-DE')} Domains auf der Sperrliste.</p>
    <label class="field">Ausnahmen – auf diesen Seiten nichts blockieren (eine pro Zeile)
      <textarea id="ab-allow" spellcheck="false">${esc((p.adblockAllow || []).join('\n'))}</textarea>
    </label>
  </section>
  <section class="set">
    <h3>YouTube</h3>
    <label class="switch"><input type="checkbox" id="yt-on"${p.youtube !== false ? ' checked' : ''}><span>Werbung in Videos überspringen und ausblenden</span></label>
    <label class="switch"><input type="checkbox" id="yt-sb"${p.ytSponsor !== false ? ' checked' : ''}><span>Sponsor-Abschnitte überspringen (SponsorBlock)</span></label>
    <label class="field">Videoqualität
      <select id="yt-q">${[['hd1080', '1080p (Full HD)'], ['hd720', '720p'], ['hd1440', '1440p'], ['hd2160', '2160p (4K)'], ['max', 'Höchste verfügbare'], ['auto', 'Wie YouTube es wählt']]
        .map(([v, l]) => `<option value="${v}"${(p.ytQuality || 'hd1080') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    <p>Sponsor-Abschnitte kommen von der freien SponsorBlock-Datenbank. Dabei wird nur ein Teil eines verschlüsselten Werts gesendet, nicht welches Video du schaust.</p>
  </section>
  <section class="set">
    <h3>Cookie-Banner</h3>
    <label class="switch"><input type="checkbox" id="ck-on"${p.cookieReject !== false ? ' checked' : ''}><span>Cookie-Banner automatisch ablehnen</span></label>
    <p>Sakura klickt bei Zustimmungsfenstern auf „Alle ablehnen“ oder „Nur notwendige“. Ausnahmen setzt du über das Schild in der Adressleiste.</p>
    <label class="field">Ausnahmen – hier nichts ablehnen (eine Seite pro Zeile)
      <textarea id="ck-allow" spellcheck="false">${esc((p.cookieAllow || []).join('\n'))}</textarea>
    </label>
  </section>
  <section class="set">
    <h3>Startseite</h3>
    <p>Ohne eigene Bilder zeigt die Startseite eine gezeichnete Nachtszene mit Kirschblüten.</p>
    <label class="field">Eigene Hintergrundbilder (Bild-Adressen, eine pro Zeile)
      <textarea id="bgs" spellcheck="false" placeholder="https://…/bild.jpg">${esc((p.backgrounds || []).join('\n'))}</textarea>
    </label>
    <label class="field">Bild wechseln alle … Minuten
      <input id="bgmin" type="number" min="1" max="1440" value="${p.bgMinutes || 10}">
    </label>
  </section>
  <section class="set" id="import-section">
    <h3>Daten importieren</h3>
    <p>Übernimm Lesezeichen und Verlauf aus einem anderen Browser. Doppelte Lesezeichen werden übersprungen.</p>
    <label class="field">Browser
      <select id="imp-src"><option value="">Suche Browser …</option></select>
    </label>
    <label class="switch"><input type="checkbox" id="imp-bm" checked><span>Lesezeichen</span></label>
    <label class="switch"><input type="checkbox" id="imp-hist" checked><span>Verlauf der letzten 90 Tage</span></label>
    <p id="imp-msg" hidden></p>
    <div class="row"><button class="btn primary" id="imp-go" disabled>Importieren</button><button class="btn" id="imp-html">Aus HTML-Datei importieren …</button></div>
  </section>
  <section class="set" id="sync-section">${syncHtml(si)}</section>
  <section class="set" id="data-section">
    <h3>Daten</h3>
    <label class="switch"><input type="checkbox" id="clr-cookies"><span>Auch Cookies und Anmeldungen löschen</span></label>
    <div class="row"><button class="btn danger" id="clr">Verlauf und Cache löschen</button><button class="btn" id="datadir">Datenordner öffnen</button></div>
  </section>`;

  $('#engine').onchange = e => api.call('setPrefs', { searchEngine: e.target.value });
  bindDesign(p);
  const showRestart = r => { $('#restart-row').hidden = !(r && r.restart); };
  showRestart({ restart: (p.siteTheme === 'force') !== (p.startTheme === 'force') });
  $('#theme').onchange = async e => showRestart(await api.call('setPrefs', { siteTheme: e.target.value }));
  $('#restart').onclick = () => api.call('relaunch');
  $('#restore').onchange = e => api.call('setPrefs', { restoreSession: e.target.checked });
  $('#dlask').onchange = e => api.call('setPrefs', { downloadAsk: e.target.checked });
  $('#ab-on').onchange = e => api.call('setPrefs', { adblock: e.target.checked });
  $('#ab-ext').onchange = async e => {
    $('#ab-info').textContent = e.target.checked ? 'Liste wird geladen …' : '';
    const r = await api.call('setPrefs', { adblockExtended: e.target.checked });
    $('#ab-info').textContent = r.error ? r.error : `${r.blocklistSize.toLocaleString('de-DE')} Domains auf der Sperrliste.`;
  };
  const lines = v => v.split(/\n/).map(x => x.trim()).filter(Boolean);
  $('#ab-allow').onchange = e => api.call('setPrefs', { adblockAllow: lines(e.target.value).map(hostOf) });
  $('#yt-on').onchange = e => api.call('setPrefs', { youtube: e.target.checked });
  $('#yt-sb').onchange = e => api.call('setPrefs', { ytSponsor: e.target.checked });
  $('#yt-q').onchange = e => api.call('setPrefs', { ytQuality: e.target.value });
  $('#ck-on').onchange = e => api.call('setPrefs', { cookieReject: e.target.checked });
  $('#ck-allow').onchange = e => api.call('setPrefs', { cookieAllow: lines(e.target.value).map(u => hostOf(/^https?:/.test(u) ? u : 'https://' + u)) });
  $('#bgs').onchange = e => api.call('setPrefs', { backgrounds: lines(e.target.value) });
  $('#bgmin').onchange = e => api.call('setPrefs', { bgMinutes: Math.max(1, Number(e.target.value) || 10) });
  $('#clr').onclick = async () => {
    $('#clr').disabled = true;
    await api.call('clearHistory', { cookies: $('#clr-cookies').checked });
    $('#clr').textContent = 'Gelöscht';
  };
  $('#datadir').onclick = () => api.call('openDataFolder');
  bindSync();
  bindImport();
}

function bindDesign(p) {
  const box = $('#design-section');
  const accentOf = id => (p.themes.find(t => t.id === id) || p.themes[0]).accent;
  box.querySelectorAll('[data-theme]').forEach(b => {
    b.onclick = async () => {
      box.querySelectorAll('[data-theme]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      p.theme = b.dataset.theme;
      if (!p.accent) $('#accent').value = accentOf(p.theme);
      await api.call('setPrefs', { theme: p.theme });
    };
  });
  // „input“ feuert beim Ziehen im Farbwähler sehr oft → kurz warten
  let t = null;
  $('#accent').oninput = e => {
    clearTimeout(t);
    t = setTimeout(() => { p.accent = e.target.value; $('#accent-reset').hidden = false; api.call('setPrefs', { accent: p.accent }); }, 150);
  };
  $('#accent-reset').onclick = () => {
    p.accent = '';
    $('#accent').value = accentOf(p.theme || 'sakura');
    $('#accent-reset').hidden = true;
    api.call('setPrefs', { accent: '' });
  };
}

async function bindImport() {
  const sel = $('#imp-src'), go = $('#imp-go'), msg = $('#imp-msg');
  const show = (text, bad) => { msg.textContent = text; msg.className = bad ? 'msg-error' : 'msg-ok'; msg.hidden = !text; };
  const list = (await api.call('importSources')) || [];
  if (!sel.isConnected) return;
  sel.innerHTML = list.length
    ? list.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')
    : '<option value="">Kein anderer Browser gefunden</option>';
  sel.disabled = !list.length;
  go.disabled = !list.length;
  go.onclick = async () => {
    const b = $('#imp-bm').checked, h = $('#imp-hist').checked;
    go.disabled = true;
    show('Importiere …');
    const r = await api.call('importRun', { id: sel.value, bookmarks: b, history: h });
    go.disabled = false;
    show(r && (r.message || r.error), !r || !!r.error);
  };
  $('#imp-html').onclick = async () => {
    const r = await api.call('importHtml');
    if (r) show(r.message || r.error, !!r.error);
  };
}
api.on('open-import', () => {
  openPanel('settings');
  const go = () => { const s = $('#import-section'); if (s) s.scrollIntoView(); else setTimeout(go, 30); };
  setTimeout(go, 30);
});

function timeAgo(ts) {
  if (!ts) return 'noch nie';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  return new Date(ts).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const SYNC_PW_HINT = 'Mit dem Sync-Passwort werden deine Daten verschlüsselt, bevor sie den PC verlassen – auch Google kann sie nicht lesen. Gib auf allen Geräten dasselbe ein. Vergisst du es, sind die Daten auf dem Server verloren; deine Geräte behalten ihre eigenen Daten.';

function syncHtml(si) {
  if (si.email && si.state === 'needkey') {
    return `<h3>Synchronisation</h3>
      <div class="status error"><i></i><span>${esc(si.message || 'Sync-Passwort fehlt – der Abgleich ist pausiert.')}</span></div>
      <p>Angemeldet als ${esc(si.email)}. Gib dein Sync-Passwort ein, um den Abgleich zu entsperren.</p>
      <label class="field">Sync-Passwort<input id="s-sync" type="password" autocomplete="off"></label>
      <p class="msg-error" id="s-err" hidden></p>
      <div class="row"><button class="btn primary" id="s-unlock">Entsperren</button><button class="btn" id="sync-out">Abmelden</button></div>
      <details><summary>Sync-Passwort vergessen?</summary>
        <p>Dann kannst du die Daten auf dem Server mit einem neuen Passwort neu anlegen. Sie werden durch die Daten dieses PCs ersetzt; andere Geräte entsperrst du danach mit dem neuen Passwort.</p>
        <div class="row"><button class="btn danger" id="s-reset">Mit neuem Passwort neu anlegen</button></div>
      </details>`;
  }
  if (si.email && si.state !== 'off') {
    const label = { ok: `Synchronisiert ${timeAgo(si.lastSync)}`, syncing: si.message || 'Synchronisiere …', error: si.message || 'Fehler', idle: `Zuletzt ${timeAgo(si.lastSync)}` }[si.state] || '';
    return `<h3>Synchronisation</h3>
      <div class="status ${esc(si.state)}"><i></i><span>${esc(label)}</span></div>
      <p>Angemeldet als ${esc(si.email)}. Ende-zu-Ende-verschlüsselt: Lesezeichen, Kacheln, Verlauf, offene Tabs, Skripte und Einstellungen sind nur auf deinen Geräten lesbar.</p>
      <div class="row"><button class="btn primary" id="sync-now">Jetzt synchronisieren</button><button class="btn" id="s-change">Sync-Passwort ändern</button><button class="btn" id="sync-out">Abmelden</button></div>
      <div id="s-change-box" hidden>
        <label class="field" style="margin-top:12px">Neues Sync-Passwort<input id="s-new" type="password" autocomplete="new-password"></label>
        <label class="field">Neues Sync-Passwort wiederholen<input id="s-new2" type="password" autocomplete="new-password"></label>
        <p class="msg-error" id="s-err" hidden></p>
        <div class="row"><button class="btn primary" id="s-change-go">Ändern</button></div>
      </div>`;
  }
  return `<h3>Synchronisation</h3>
    <p>Melde dich auf dem PC und in der Android-App mit demselben Konto an. Dafür brauchst du ein kostenloses Firebase-Projekt.</p>
    <details><summary>So richtest du Firebase ein</summary><ol>
      <li>In der Firebase-Konsole ein Projekt anlegen.</li>
      <li>Authentication → Anmeldemethode → <code>E-Mail/Passwort</code> aktivieren.</li>
      <li>Firestore Database erstellen und die Regeln aus <code>firebase/firestore.rules</code> einfügen.</li>
      <li>Projekteinstellungen → Allgemein: „Web-API-Schlüssel“ und „Projekt-ID“ hier eintragen.</li>
    </ol></details>
    ${si.state === 'error' && si.message ? `<p class="msg-error">${esc(si.message)}</p>` : ''}
    <label class="field">Web-API-Schlüssel<input id="s-key" spellcheck="false" value="${esc(si.apiKey || '')}"></label>
    <label class="field">Projekt-ID<input id="s-pid" spellcheck="false" value="${esc(si.projectId || '')}"></label>
    <label class="field">E-Mail<input id="s-mail" type="email" spellcheck="false" value="${esc(si.email || '')}"></label>
    <label class="field">Konto-Passwort<input id="s-pw" type="password"></label>
    <label class="field">Sync-Passwort (für die Verschlüsselung, mind. 8 Zeichen)<input id="s-sync" type="password" autocomplete="new-password"></label>
    <p>${SYNC_PW_HINT}</p>
    <p class="msg-error" id="s-err" hidden></p>
    <div class="row"><button class="btn primary" id="s-login">Anmelden</button><button class="btn" id="s-create">Konto anlegen</button></div>`;
}

function bindSync() {
  const sec = $('#sync-section');
  const showErr = m => { const e = $('#s-err'); if (e) { e.textContent = m; e.hidden = !m; } };
  const busy = on => { for (const b of sec.querySelectorAll('button')) b.disabled = on; };
  const redraw = r => { sec.innerHTML = syncHtml(r); bindSync(); };
  const now = $('#sync-now'), out = $('#sync-out');
  if (now) now.onclick = async () => { now.disabled = true; await api.call('syncNow'); };
  if (out) out.onclick = async () => redraw(await api.call('syncLogout'));
  if ($('#s-change')) $('#s-change').onclick = () => { $('#s-change-box').hidden = false; $('#s-new').focus(); };
  if ($('#s-change-go')) $('#s-change-go').onclick = async () => {
    if ($('#s-new').value !== $('#s-new2').value) return showErr('Die beiden Passwörter stimmen nicht überein.');
    busy(true);
    const r = await api.call('syncChangePassword', $('#s-new').value);
    if (r.failed) { busy(false); return showErr(r.message); }
    redraw(r);
  };
  const unlock = reset => async () => {
    const pw = $('#s-sync').value;
    if (reset && !confirm('Die Daten auf dem Server werden durch die Daten dieses PCs ersetzt und mit dem eingegebenen Passwort neu verschlüsselt. Fortfahren?')) return;
    if (reset && !pw) return showErr('Gib oben das neue Sync-Passwort ein.');
    busy(true);
    const r = await api.call('syncUnlock', { password: pw, reset });
    if (r.failed) { busy(false); return showErr(r.message); }
    redraw(r);
  };
  if ($('#s-unlock')) {
    $('#s-unlock').onclick = unlock(false);
    $('#s-reset').onclick = unlock(true);
    $('#s-sync').onkeydown = e => { if (e.key === 'Enter') unlock(false)(); };
  }
  const go = create => async () => {
    showErr('');
    busy(true);
    const r = await api.call('syncLogin', {
      apiKey: $('#s-key').value, projectId: $('#s-pid').value, email: $('#s-mail').value,
      password: $('#s-pw').value, syncPassword: $('#s-sync').value, create
    });
    if (r && r.state === 'error' && !r.email) { busy(false); return showErr(r.message); }
    redraw(r);
  };
  if ($('#s-login')) { $('#s-login').onclick = go(false); $('#s-create').onclick = go(true); }
}
api.on('sync-status', async () => {
  if (panelKind === 'settings' && !document.querySelector('#s-pw, #s-sync, #s-new')) {
    const sec = $('#sync-section');
    if (sec) { sec.innerHTML = syncHtml(await api.call('syncInfo')); bindSync(); }
  }
});
