/* Sakura – Browseroberfläche (Tabs, Adressleiste, Menüs, Seitenleiste) */
const api = window.chrome2;
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isPrivate = new URLSearchParams(location.search).get('private') === '1';
// Vertikale Tabs: dieselbe Oberfläche läuft zusätzlich als Seitenleiste links und zeigt dort nur die Tabs
const isSide = new URLSearchParams(location.search).get('side') === '1';
if (isSide) document.body.classList.add('side');
if (isPrivate) { document.body.classList.add('private'); $('#private-tag').hidden = false; }

let S = { tabs: [], activeId: null };
let addrTabId = null; // zu welchem Tab der Text in der Adressleiste gehört
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
  document.body.classList.toggle('no-anim', S.animations === false);
  document.body.classList.toggle('loading', !!S.loading);
  document.body.classList.toggle('vertical', !!S.vertical && !isSide);
  renderTabs();
  $('#back').disabled = !S.canBack;
  $('#forward').disabled = !S.canForward;
  $('#reload').innerHTML = `<svg><use href="#i-${S.loading ? 'stop' : 'reload'}"/></svg>`;
  $('#reload').title = S.loading ? 'Laden stoppen' : 'Neu laden (F5)';
  const addr = $('#address');
  // Anderer Tab als beim letzten Mal (z. B. gerade neu geöffnet): Adresse immer übernehmen,
  // auch wenn das Feld schon den Fokus hat – sonst bliebe die Adresse des vorigen Tabs stehen
  const tabChanged = S.activeId !== addrTabId;
  addrTabId = S.activeId;
  if (document.activeElement !== addr || tabChanged) {
    addr.value = prettyUrl(S.url);
    if (tabChanged && document.activeElement === addr) addr.select();
  }
  const lead = $('#secure');
  lead.className = 'lead' + (S.url ? (S.secure ? ' secure' : (S.url.startsWith('http:') ? ' insecure' : '')) : '');
  lead.innerHTML = `<svg><use href="#i-${!S.url ? 'search' : S.secure ? 'lock' : S.url.startsWith('http:') ? 'warn' : 'search'}"/></svg>`;
  lead.title = !S.url ? '' : S.secure ? 'Verbindung ist verschlüsselt' : 'Verbindung ist nicht verschlüsselt';
  $('#star').classList.toggle('on', !!S.bookmarked);
  $('#star').hidden = !S.url;
  $('#star').title = S.bookmarked ? 'Lesezeichen entfernen (Strg+D)' : 'Lesezeichen setzen (Strg+D)';
  const shieldOff = !S.adblock || S.allowed;
  $('#shield').classList.toggle('off', shieldOff);
  const nBlocked = (S.blocked || 0) + (S.popups || 0);
  $('#blocked').textContent = !shieldOff && nBlocked ? (nBlocked > 99 ? '99+' : nBlocked) : '';
  $('#zoom').hidden = !S.zoom || S.zoom === 100;
  $('#zoom').textContent = S.zoom + ' %';
  $('#zoom-val').textContent = S.zoom + ' %';
  $('#scripts-ind').hidden = !S.scripts;
  $('#reader-btn').hidden = !S.readable;
  $('#note-btn').hidden = !S.note;
  // Übersetzen-Leiste
  const tr = S.translate;
  $('#translatebar').hidden = !tr;
  document.body.classList.toggle('has-tbar', !!tr);
  if (tr) {
    $('#tb-text').textContent = `Diese Seite ist auf ${tr.name}.`;
    $('#tb-never').textContent = `Nie für ${tr.name}`;
    const sel = $('#tb-lang');
    if (sel.dataset.filled !== tr.target) {
      sel.innerHTML = Object.entries(tr.langs).sort((a, b) => a[1].localeCompare(b[1], 'de')).map(([k, n]) => `<option value="${esc(k)}"${k === tr.target ? ' selected' : ''}>${esc(n)}</option>`).join('');
      sel.dataset.filled = tr.target;
    }
  }
  $('#dark-btn').hidden = !/^https?:/.test(S.url || '');
  $('#dark-btn').classList.toggle('on', !!S.darkSite);
  $('#dark-btn').title = S.darkSite ? 'Dunkelmodus für diese Seite ausschalten' : 'Diese Seite dunkel anzeigen';
  $('#ki-btn').classList.toggle('on', !!S.kiOpen);
  const sp = (S.spaces || []).find(x => x.id === S.spaceId);
  if (sp) {
    $('#space-btn span').textContent = sp.name;
    $('#space-btn').style.setProperty('--sc', `var(--g-${sp.color})`);
    if ((S.spaces || []).length > 1) document.body.style.setProperty('--space', `var(--g-${sp.color})`); else document.body.style.removeProperty('--space');
  }
  if (overlay === 'space') paintSpacePop();
  const mb = S.mediaBar;
  $('#mbar').hidden = !mb || (mb.private && !S.private);
  if (mb) {
    $('#mb-title b').textContent = mb.title;
    $('#mb-title small').textContent = mb.host;
    $('#mb-play use').setAttribute('href', mb.playing ? '#i-pause' : '#i-play');
    $('#mb-play').title = mb.playing ? 'Pause' : 'Weiter';
  }
  $('#remote-tag').hidden = !S.remote;
  $('#focus-tag').hidden = !S.focusUntil;
  $('#saver-tag').hidden = !S.saver;
  if (S.focusUntil) $('#focus-tag').textContent = 'Fokus bis ' + new Date(S.focusUntil).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  $('#reader-btn').classList.toggle('on', !!S.reader);
  $('#reader-btn').title = S.reader ? 'Lesemodus beenden (F9)' : 'Lesemodus (F9)';
  $('#gaming-ind').hidden = !S.gaming;
  document.body.classList.toggle('streamer', !!S.streamer);
  $('#streamer-ind').hidden = !S.streamer;
  $('#streamer-ind').title = S.streamer ? (S.streamer.app ? `${S.streamer.app} läuft – private Daten sind unscharf. Klicken zum Ausschalten.` : 'Private Daten sind unscharf. Klicken zum Ausschalten.') : '';
  $('#menu-live').textContent = S.liveOn ? 'Keine Live-Meldungen mehr' : 'Bei Livegang benachrichtigen';
  $('#menu-split').textContent = S.splitOn ? 'Geteilte Ansicht beenden' : 'Geteilter Bildschirm';
  $('#menu-streamer').firstChild.textContent = S.streamer ? 'Streamer-Modus ausschalten' : 'Streamer-Modus einschalten';
  $('#media-btn').hidden = !S.media && !S.sleep;
  $('#sleep-ind').hidden = !S.sleep;
  $('#sleep-ind').textContent = S.sleep ? (S.sleep.mode === 'episode' ? 'E' : Math.max(1, Math.ceil((S.sleep.until - Date.now()) / 60000))) : '';
  $('#gaming-ind').title = S.gaming ? `Gaming-Modus: ${S.gaming} läuft – Sakura hält sich zurück` : '';
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
    if (b.folder) {
      const f = document.createElement('button');
      f.className = 'bm folder';
      f.title = `Ordner „${b.folder}“`;
      f.dataset.id = b.id;
      f.innerHTML = `<svg><use href="#i-folder"/></svg><span>${esc(b.folder)}</span>`;
      f.addEventListener('click', () => api.call('bmFolderMenu', b.folder));
      box.appendChild(f);
      continue;
    }
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

const seenTabs = new Set(), freshAt = new Map();
// Tab schließen: erst schrumpfen und ausblenden, dann wirklich schließen
const closingAt = new Map();
function closeTabAnimated(id) {
  if (closingAt.has(id)) return;
  if (document.body.classList.contains('no-anim') || matchMedia('(prefers-reduced-motion: reduce)').matches) { api.call('closeTab', id); return; }
  hideTabPreview();
  closingAt.set(id, Date.now());
  renderTabs();
  setTimeout(() => api.call('closeTab', id), 200);
  setTimeout(() => closingAt.delete(id), 1500);
} // neue Tabs gleiten herein – nur beim ersten Erscheinen
function renderTabs() {
  const box = $('#tabs');
  const firstRender = !seenTabs.size;
  const groups = new Map((S.groups || []).map(g => [g.id, g]));
  const shown = S.tabs.filter(t => !t.group || !groups.get(t.group) || !groups.get(t.group).collapsed);
  const pinned = shown.filter(t => t.pinned).length;
  const avail = box.parentElement.clientWidth - 150 - 80 - pinned * 45 - groups.size * 60;
  const narrow = !isSide && avail / Math.max(1, shown.length - pinned) < 90;
  box.innerHTML = '';
  let prevGroup = null;
  S.tabs.forEach((t, i) => {
    const g = t.group && groups.get(t.group);
    if (g && prevGroup !== g.id) box.appendChild(groupChip(g));
    prevGroup = g ? g.id : null;
    if (g && g.collapsed) return;
    const el = document.createElement('div');
    const next = S.tabs[i + 1];
    if (!seenTabs.has(t.id)) { seenTabs.add(t.id); if (!firstRender) freshAt.set(t.id, Date.now()); }
    const born = freshAt.get(t.id);
    if (born && Date.now() - born < 260) {
      el.classList.add('fresh');
      el.style.animationDelay = -(Date.now() - born) + 'ms'; // beim Neuzeichnen dort weitermachen, wo die Animation war
    } else if (born) freshAt.delete(t.id);
    const closing = closingAt.get(t.id);
    if (closing) { el.classList.add('closing'); el.style.animationDelay = -(Date.now() - closing) + 'ms'; }
    el.className = el.className + ' tab' + (t.id === S.activeId ? ' active' : '') + (t.sleeping ? ' sleeping' : '') + (t.floating ? ' floating' : '') + (t.split && S.splitOn ? ' split' : '') + (t.pinned ? ' pinned' : narrow ? ' narrow' : '') +
      (g ? ' grouped' + (S.tabs[i - 1] && S.tabs[i - 1].group === g.id ? '' : ' first') + (next && next.group === g.id ? '' : ' last') : '');
    if (g) el.style.setProperty('--gc', `var(--g-${g.color})`);
    if (t.container) { el.classList.add('konto'); el.style.setProperty('--kc', `var(--g-${t.container.color})`); }
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', t.id === S.activeId);
    el.title = t.title + (g && g.name ? ` – Gruppe „${g.name}“` : '') + (t.sleeping ? ' – schläft (lädt beim Anklicken)' : '') + (t.floating ? ' – schwebt (Klick holt das Video zurück)' : '') + (t.container ? ` – Konto-Tab „${t.container.name}“` : '') + (t.split ? ' – geteilte Ansicht' : '');
    el.draggable = true;
    el.dataset.id = t.id;
    let fav;
    if (t.loading) fav = '<span class="fav spin"></span>';
    else if (t.newtab) fav = '<span class="fav letter">桜</span>';
    else if (t.favicon) fav = `<span class="fav"><img src="${esc(t.favicon)}" alt=""></span>`;
    else if (t.url && iconUrl(t.url)) fav = `<span class="fav"><img src="${esc(iconUrl(t.url))}" alt=""></span>`;
    else fav = `<span class="fav letter">${esc(letterOf(t.title))}</span>`;
    el.innerHTML = `${fav}<span class="title">${esc(t.title)}</span>${t.muted ? '<svg class="snd muted" data-mute><title>Ton einschalten</title><use href="#i-muted"/></svg>' : t.audible ? '<svg class="snd" data-mute><title>Stummschalten</title><use href="#i-sound"/></svg>' : ''}${t.volume != null && !t.muted ? `<small class="vol" title="Lautstärke dieses Tabs">${Number(t.volume)} %</small>` : ''}<button class="close" title="Tab schließen (Strg+W)"><svg><use href="#i-x"/></svg></button>${g ? '<span class="gline"></span>' : ''}`;
    const img = el.querySelector('img');
    if (img) img.onerror = () => { img.parentElement.className = 'fav letter'; img.parentElement.textContent = letterOf(t.title); };
    el.addEventListener('mousedown', e => {
      if (e.button === 1) { e.preventDefault(); if (!t.pinned) closeTabAnimated(t.id); }
      else if (e.button === 0 && e.target.closest('[data-mute]')) { e.stopPropagation(); api.call('toggleMute', t.id); }
      else if (e.button === 0 && !e.target.closest('.close')) api.call('activate', t.id);
    });
    el.addEventListener('contextmenu', e => { e.preventDefault(); api.call('tabMenu', t.id); });
    el.querySelector('.close').addEventListener('click', e => { e.stopPropagation(); closeTabAnimated(t.id); });
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
  // In der Seitenleiste öffnet die Hauptoberfläche das Bearbeiten-Fenster (dort ist Platz dafür)
  const edit = () => isSide ? api.call('editGroup', g.id) : openGroupPop(g.id);
  c.oncontextmenu = e => { e.preventDefault(); edit(); };
  c.ondblclick = e => { e.preventDefault(); edit(); };
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
  const hiddenStrip = !r.width; // vertikale Tabs: die Chips stehen in der Seitenleiste
  pop.style.left = (hiddenStrip ? 252 : Math.max(8, Math.min(r.left, innerWidth - 296))) + 'px';
  pop.style.right = 'auto';
  pop.style.top = (hiddenStrip ? $('#toolbar').getBoundingClientRect().bottom + 8 : r.bottom + 6) + 'px';
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
$('#newtab').addEventListener('contextmenu', e => { e.preventDefault(); api.call('containerMenu'); });

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
  if (closingT) finishClose(false);
  closeOverlay(true);
  overlay = kind;
  $('#backdrop').hidden = false;
  $('#backdrop').classList.toggle('clear', kind === 'qr' || kind === 'note' || kind === 'suggest' || kind === 'menu' || kind === 'shield' || kind === 'group' || kind === 'media');
  api.call('overlay', true);
}
// Liquid Glass: Bild der Seite für die verschwommenen Flächen
api.on('glass', url => {
  if (!overlay || typeof url !== 'string' || !url.startsWith('data:image/jpeg;base64,')) return;
  document.body.style.setProperty('--snap', `url("${url}")`);
  document.body.classList.add('has-snap');
});
// Schließen mit Animation: Flächen gleiten weich weg, erst danach schrumpft die Oberfläche wieder
const OVERLAY_ELS = ['#space-pop', '#qr-pop', '#note-pop', '#menu', '#shield-pop', '#panel', '#suggest', '#group-pop', '#media-pop', '#tabsearch'];
let closingT = null, closingEls = [];
function finishClose(shrink) {
  clearTimeout(closingT); closingT = null;
  for (const el of closingEls) { el.hidden = true; el.classList.remove('leaving'); }
  closingEls = [];
  $('#backdrop').classList.remove('leaving');
  if (!overlay) { $('#backdrop').hidden = true; document.body.classList.remove('has-snap'); }
  if (shrink && !overlay) api.call('overlay', false);
}
function closeOverlay(keep) {
  if (closingT) finishClose(false); // vorige Schließ-Animation sofort beenden
  clearTimeout(tmTimer);
  if (overlay === 'linkpreview') { $('#lp-bar').hidden = true; if (!lpClosing) api.call('linkPreviewClose'); }
  if (overlay === 'note') saveNote();
  clearTimeout(mediaTick);
  editingGroup = null;
  const open = OVERLAY_ELS.map(s => $(s)).filter(el => !el.hidden);
  overlay = null; panelKind = null;
  const animate = !keep && open.length && !document.body.classList.contains('no-anim') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!animate) {
    for (const el of open) el.hidden = true;
    $('#backdrop').hidden = true;
    document.body.classList.remove('has-snap');
    if (!keep) api.call('overlay', false);
    return;
  }
  closingEls = open;
  for (const el of open) el.classList.add('leaving');
  $('#backdrop').classList.add('leaving');
  closingT = setTimeout(() => finishClose(true), 190);
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
  menuPage('main', 0);
};
// Menü in Seiten: Hauptseite mit Gruppen, jede Gruppe gleitet als eigene Seite herein
function menuPage(name, dir = 1) {
  for (const pg of document.querySelectorAll('#menu .mpage')) {
    const on = pg.dataset.page === name;
    pg.hidden = !on;
    pg.classList.remove('in-fwd', 'in-back');
    if (on && dir) { void pg.offsetWidth; pg.classList.add(dir > 0 ? 'in-fwd' : 'in-back'); }
  }
  const first = $(`#menu .mpage[data-page="${name}"] button`);
  if (first) first.focus({ preventScroll: true });
}
$('#menu').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sub) { menuPage(b.dataset.sub, 1); return; }
  if ('back' in b.dataset) { menuPage('main', -1); return; }
  if (b.dataset.zoom) { api.call('zoom', Number(b.dataset.zoom)); return; }
  if (b.dataset.panel) { openPanel(b.dataset.panel); return; }
  if (b.dataset.panelPop === 'media') { openMedia(); return; }
  if ('tabsearch' in b.dataset) { openTabSearch(); return; }
  if ('palette' in b.dataset) { openTabSearch('all'); return; }
  if (b.dataset.settings) { closeOverlay(); api.call('openSettings', b.dataset.settings); return; }
  if (b.dataset.cmd === 'noteOpen') { openNote(); return; }
  if (b.dataset.cmd === 'spaceOpenPop') { openSpacePop(); return; }
  if (b.dataset.cmd === 'qrOpen') { openQr(); return; }
  if (b.dataset.cmd === 'liveToggle') { closeOverlay(); api.call('liveToggle').then(r => r && showToast(r.error || r.message)); return; }
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
async function fillShieldDetails() {
  const d = await api.call('shieldDetails');
  if (!d || overlay !== 'shield') return;
  const ul = $('#shield-hosts');
  const on = S.adblock && !S.allowed && d.hosts.length;
  ul.hidden = !on;
  ul.innerHTML = on ? d.hosts.map(h => `<li><span>${esc(h.host)}</span><b>${h.n}</b></li>`).join('') : '';
  $('#shield-total').textContent = d.total ? `Insgesamt hat Sakura schon ${d.total.toLocaleString('de-DE')} Werbe- und Tracker-Anfragen blockiert.` : '';
}
function fillShield() {
  fillShieldDetails();
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
  $('#shield-popup').checked = S.popupBlock && !S.popupAllowed;
  $('#shield-popup').disabled = !S.popupBlock || !S.host;
  $('#shield-popups').hidden = !S.popups;
  $('#shield-popups-text').textContent = S.popups === 1 ? 'Ein Werbefenster wurde blockiert.' : `${S.popups} Werbefenster wurden blockiert.`;
}
$('#shield-cookie').onchange = () => api.call('toggleCookieAllow');
$('#shield-popup').onchange = () => api.call('togglePopupAllow');
$('#shield-popup-open').onclick = () => { api.call('popupOpenLast'); closeOverlay(); };
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
const TITLES = { highlights: 'Markierungen', tempmail: 'Wegwerf-E-Mail', archive: 'Tab-Archiv', screentime: 'Bildschirmzeit', live: 'Live-Kanäle', notes: 'Notizen', sessions: 'Sitzungen', readlist: 'Leseliste', watches: 'Überwachte Seiten', passwords: 'Passwörter', performance: 'Leistung', about: 'Über Sakura', bookmarks: 'Lesezeichen', history: 'Verlauf', settings: 'Einstellungen', downloads: 'Downloads', extensions: 'Erweiterungen', scripts: 'Eigene Skripte' };
const RENDER = () => ({ highlights: renderHighlights, tempmail: renderTempMail, archive: renderArchive, screentime: renderScreenTime, live: renderLive, notes: renderNotes, sessions: renderSessions, readlist: renderReadlist, watches: renderWatches, passwords: renderPasswords, performance: renderPerformance, about: renderAbout, bookmarks: renderBookmarks, history: renderHistory, downloads: renderDownloads, extensions: renderExtensions, scripts: renderScripts });
function openPanel(kind) {
  if (kind === 'settings') { closeOverlay(); api.call('openSettings'); return; }
  // Zweiter Klick auf denselben Knopf (z. B. Controller-Symbol) schließt die Seitenleiste wieder
  if (overlay === 'panel' && panelKind === kind) { closeOverlay(); return; }
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
  const acts = `<button class="icon small" data-act="edit" title="Bearbeiten"><svg><use href="#i-edit"/></svg></button>
       <button class="icon small" data-act="del" title="Löschen"><svg><use href="#i-trash"/></svg></button>`;
  // Ohne Ordner zuerst, dann jeder Ordner als Gruppe
  const groups = new Map([['', []]]);
  for (const b of list) { const f = b.folder || ''; if (!groups.has(f)) groups.set(f, []); groups.get(f).push(b); }
  const folders = [...groups.keys()].filter(Boolean).sort((a, b) => a.localeCompare(b, 'de'));
  const html = groups.get('').map(b => itemHtml(b, acts)).join('') +
    folders.map(f => `<details class="bm-folder" open><summary><svg><use href="#i-folder"/></svg>${esc(f)} <small>${groups.get(f).length}</small></summary>${groups.get(f).map(b => itemHtml(b, acts)).join('')}</details>`).join('');
  body.innerHTML = `<input class="p-search" placeholder="Lesezeichen durchsuchen" value="${esc(filter)}">` +
    (list.length ? html
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
      const folderOpts = [...new Set(all.map(x => x.folder).filter(Boolean))].map(f => `<option value="${esc(f)}">`).join('');
      form.innerHTML = `<input name="title" value="${esc(bm.title)}" aria-label="Name"><input name="url" value="${esc(bm.url)}" aria-label="Adresse">
        <input name="folder" value="${esc(bm.folder || '')}" placeholder="Ordner (leer = kein Ordner)" aria-label="Ordner" list="bm-folder-list"><datalist id="bm-folder-list">${folderOpts}</datalist>
        <div class="row"><button class="btn" data-x="cancel">Abbrechen</button><button class="btn primary" data-x="save">Speichern</button></div>`;
      row.replaceWith(form);
      form.querySelector('input').focus();
      form.onclick = ev => {
        const x = ev.target.dataset.x;
        ev.stopPropagation();
        if (x === 'cancel') renderBookmarks(s.value);
        if (x === 'save') api.call('updateBookmark', { id: bm.id, patch: { title: form.querySelector('[name=title]').value, url: form.querySelector('[name=url]').value, folder: form.querySelector('[name=folder]').value } }).then(() => renderBookmarks(s.value));
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
// PIN-Sperre: statt des Inhalts ein Eingabefeld zeigen
function pinGate(kind, what) {
  const body = $('#panel-body');
  body.innerHTML = `<form class="pin-gate" autocomplete="off">
    <svg class="pin-lock"><use href="#i-key"/></svg>
    <p>${esc(what)} ${what === 'Deine Passwörter' ? 'sind' : 'ist'} mit einer PIN geschützt.</p>
    <input id="pin-in" type="password" inputmode="numeric" maxlength="8" placeholder="PIN" aria-label="PIN">
    <button class="btn primary" type="submit">Entsperren</button>
    <p class="msg-error" id="pin-err" hidden></p></form>`;
  body.onclick = null;
  const f = body.querySelector('form');
  f.onsubmit = async e => {
    e.preventDefault();
    const r = await api.call('pinUnlock', $('#pin-in').value);
    if (r && r.ok) { RENDER()[kind](); return; }
    $('#pin-err').textContent = (r && r.error) || 'Falsche PIN.'; $('#pin-err').hidden = false;
    $('#pin-in').value = ''; $('#pin-in').focus();
  };
  setTimeout(() => $('#pin-in') && $('#pin-in').focus(), 30);
}

async function renderHistory(filter = '') {
  const body = $('#panel-body');
  const list = await api.call('history', filter);
  if (list && list.locked) { if (panelKind === 'history') pinGate('history', 'Dein Verlauf'); return; }
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
    if (e.target.id === 'clear-hist') { closeOverlay(); api.call('openSettings', 'privacy'); return; }
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

// Einstellungen: eigene Seite sakura://settings (pages/settings.html + settings.js)
api.on('open-import', () => api.call('openSettings', 'import'));

// ------------------------------------------------------------ Leseliste
async function renderReadlist() {
  const body = $('#panel-body');
  const list = (await api.call('readlist')) || [];
  if (panelKind !== 'readlist') return;
  body.innerHTML = list.length ? list.map(it => `<div class="p-item rl${it.read ? ' read' : ''}" data-id="${esc(it.id)}">
      <span class="fav">${iconImg(it.url, it.title)}</span>
      <div class="txt rl-open" title="${esc(it.url)}"><div>${esc(it.title)}</div><small>${esc(it.site || hostOf(it.url))}${it.offline ? ' · offline lesbar' : ''}${it.read ? ' · gelesen' : ''}</small></div>
      <button class="icon small" data-act="del" title="Aus der Leseliste entfernen"><svg><use href="#i-trash"/></svg></button></div>`).join('')
    : '<p class="p-empty">Deine Leseliste ist leer. Öffne einen Artikel und wähle im Menü „Zur Leseliste“ – Sakura speichert den Text, damit du ihn auch ohne Internet lesen kannst.</p>';
  body.onclick = async e => {
    const row = e.target.closest('.p-item');
    if (!row) return;
    if (e.target.closest('[data-act="del"]')) { await api.call('readlistRemove', row.dataset.id); renderReadlist(); return; }
    if (e.target.closest('.rl-open')) { api.call('readlistOpen', row.dataset.id); closeOverlay(); }
  };
}
// ------------------------------------------------------------ Markierungen (Textmarker)
async function renderHighlights() {
  const body = $('#panel-body');
  const list = (await api.call('highlights')) || [];
  if (panelKind !== 'highlights') return;
  body.innerHTML = list.length ? list.map(h => `<div class="p-item hl" data-id="${esc(h.id)}">
      <div class="txt" data-url="${esc(h.url)}" title="${esc(h.url)}"><div class="hl-text hl-${esc(h.color)}">${esc(h.text)}</div><small>${esc(h.title)} · ${esc(timeAgo(h.at))}</small></div>
      <button class="icon small" data-act="del" title="Markierung entfernen"><svg><use href="#i-trash"/></svg></button></div>`).join('')
    : '<p class="p-empty">Noch keine Markierungen. Wähle auf einer Seite Text aus, Rechtsklick → „Markieren“ – Sakura zeigt die Markierung beim nächsten Besuch wieder.</p>';
  body.onclick = async e => {
    if (openFromPanel(e)) return;
    const b = e.target.closest('button[data-act="del"]');
    if (b) { await api.call('highlightRemove', b.closest('.p-item').dataset.id); renderHighlights(); }
  };
}
api.on('highlights-changed', () => { if (panelKind === 'highlights') renderHighlights(); });

// ------------------------------------------------------------ Wegwerf-E-Mail
let tmTimer = null;
async function renderTempMail(note = '') {
  clearTimeout(tmTimer);
  const body = $('#panel-body');
  const info = await api.call('tempMail');
  if (panelKind !== 'tempmail') return;
  if (!info) {
    body.innerHTML = `<p class="p-note">Eine Wegwerf-Adresse schützt deine echte E-Mail vor Spam – ideal für Anmeldungen, Gewinnspiele oder Testkonten. Die Post kommt hier an. Dienst: mail.tm (kostenlos, ohne Anmeldung).</p>
      ${note ? `<p class="msg-error" style="margin:0 8px 10px">${esc(note)}</p>` : ''}
      <div class="row pw-actions"><button class="btn primary" id="tm-new">Adresse erzeugen</button></div>`;
    $('#tm-new').onclick = async () => { $('#tm-new').disabled = true; const r = await api.call('tempMailCreate'); renderTempMail(r && r.error ? r.error : ''); };
    return;
  }
  body.innerHTML = `<div class="tm-addr"><small>Deine Wegwerf-Adresse</small><b>${esc(info.address)}</b>
      <div class="row"><button class="btn primary" id="tm-copy">Kopieren</button><button class="btn" id="tm-renew">Neue Adresse</button></div></div>
    <p class="p-note">Tipp: Rechtsklick in ein E-Mail-Feld → „Wegwerf-E-Mail einfügen“.</p>
    <div class="p-day">Posteingang</div><div id="tm-list"><p class="p-empty">Lade …</p></div>
    ${note ? `<p class="msg-error" style="margin:0 8px">${esc(note)}</p>` : ''}`;
  $('#tm-copy').onclick = async () => { await api.call('tempMailCopy'); $('#tm-copy').textContent = 'Kopiert'; };
  $('#tm-renew').onclick = async () => { await api.call('tempMailForget'); const r = await api.call('tempMailCreate'); renderTempMail(r && r.error ? r.error : ''); };
  const load = async () => {
    const list = await api.call('tempMailInbox');
    const box = $('#tm-list');
    if (panelKind !== 'tempmail' || !box) return;
    if (list && list.error) box.innerHTML = `<p class="p-empty">${esc(list.error)}</p>`;
    else box.innerHTML = (list || []).length ? list.map(m => `<div class="p-item tm-mail${m.seen ? '' : ' new'}" data-id="${esc(m.id)}"><span class="fav">${esc(letterOf(m.from))}</span>
        <div class="txt"><div>${esc(m.subject)}</div><small>${esc(m.from)} · ${esc(timeAgo(m.at))}</small></div></div>`).join('')
      : '<p class="p-empty">Noch keine Post. Sakura schaut alle paar Sekunden nach.</p>';
    tmTimer = setTimeout(load, 8000);
  };
  body.onclick = async e => {
    const row = e.target.closest('.tm-mail');
    if (!row) return;
    clearTimeout(tmTimer);
    const m = await api.call('tempMailMessage', row.dataset.id);
    if (panelKind !== 'tempmail') return;
    if (!m || m.error) { renderTempMail((m && m.error) || 'Nachricht nicht gefunden.'); return; }
    body.innerHTML = `<button class="btn" id="tm-back">Zurück zum Posteingang</button>
      <h3 class="tm-subj"></h3><p class="tm-from"></p><pre class="tm-text"></pre><div class="tm-links"></div>`;
    body.querySelector('.tm-subj').textContent = m.subject;
    body.querySelector('.tm-from').textContent = 'Von ' + m.from;
    body.querySelector('.tm-text').textContent = m.text;
    const lk = body.querySelector('.tm-links');
    for (const u of m.links) { const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Öffnen: ' + hostOf(u); b.title = u; b.onclick = () => api.call('openUrlInNewTab', u); lk.appendChild(b); }
    $('#tm-back').onclick = () => renderTempMail();
  };
  load();
}

// ------------------------------------------------------------ Tab-Archiv
async function renderArchive() {
  const body = $('#panel-body');
  const list = (await api.call('archive')) || [];
  const p = (await api.call('prefs')) || {};
  if (panelKind !== 'archive') return;
  const days = Number(p.archiveDays) || 0;
  body.innerHTML = `<p class="p-note">${days ? `Tabs, die du ${days} Tage nicht benutzt hast, räumt Sakura hierher auf (angeheftete Tabs und Tabs mit Ton nie).` : 'Das automatische Aufräumen ist aus.'} Einträge bleiben 30 Tage.</p>
    <label class="sel-row">Aufräumen nach <select id="ar-days">${[[0, 'nie'], [3, '3 Tagen'], [7, '7 Tagen'], [14, '14 Tagen'], [30, '30 Tagen']].map(([v, l]) => `<option value="${v}"${v === days ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` +
    (list.length ? list.map(it => `<div class="p-item" data-id="${esc(it.id)}"><span class="fav">${iconImg(it.url, it.title)}</span>
      <div class="txt ar-open" title="Wieder öffnen"><div>${esc(it.title)}</div><small>${esc(hostOf(it.url))} · ${esc(timeAgo(it.at))}</small></div>
      <button class="icon small" data-act="del" title="Aus dem Archiv löschen"><svg><use href="#i-trash"/></svg></button></div>`).join('')
      : '<p class="p-empty">Das Archiv ist leer.</p>');
  $('#ar-days').onchange = async e => { await api.call('setPrefs', { archiveDays: Number(e.target.value) }); renderArchive(); };
  body.onclick = async e => {
    const row = e.target.closest('.p-item');
    if (!row) return;
    if (e.target.closest('[data-act="del"]')) { await api.call('archiveRemove', row.dataset.id); renderArchive(); return; }
    if (e.target.closest('.ar-open')) { await api.call('archiveOpen', row.dataset.id); renderArchive(); }
  };
}
api.on('archive-changed', () => { if (panelKind === 'archive') renderArchive(); });

// ------------------------------------------------------------ Bildschirmzeit
const fmtDur = s => { const m = Math.round(s / 60); return m < 1 ? 'unter 1 Min.' : m < 60 ? m + ' Min.' : Math.floor(m / 60) + ' Std.' + (m % 60 ? ' ' + (m % 60) + ' Min.' : ''); };
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
async function renderScreenTime() {
  const body = $('#panel-body');
  const d = await api.call('screenTime');
  if (panelKind !== 'screentime' || !d) return;
  const maxDay = Math.max(1, ...d.week.map(x => x.seconds)), maxSite = Math.max(1, ...d.sites.map(x => x.seconds));
  body.innerHTML = `<div class="st-total"><small>Heute</small><b>${esc(fmtDur(d.total))}</b></div>
    <div class="st-week">${d.week.map(x => `<div class="st-col${x.today ? ' today' : ''}" title="${esc(fmtDur(x.seconds))}"><i style="height:${Math.round(x.seconds / maxDay * 100)}%"></i><small>${WD[x.day]}</small></div>`).join('')}</div>
    ${d.sites.length ? `<div class="p-day">Heute am längsten</div>` + d.sites.map(s => `<div class="p-item st-site"><span class="fav">${iconImg('https://' + s.host, s.host)}</span>
      <div class="txt"><div>${esc(s.host)}</div><div class="st-bar"><i style="width:${Math.max(2, Math.round(s.seconds / maxSite * 100))}%"></i></div></div><time>${esc(fmtDur(s.seconds))}</time></div>`).join('')
      : '<p class="p-empty">Heute noch nichts gezählt. Sakura zählt, wie lange eine Seite im Vordergrund ist, während du Sakura benutzt.</p>'}
    <p class="p-note">Bleibt nur auf diesem PC, wird nicht synchronisiert. Private Fenster zählen nicht.</p>
    <label class="switch" style="margin:0 8px"><input type="checkbox" id="st-on"${d.off ? '' : ' checked'}><span>Bildschirmzeit aufzeichnen</span></label>
    <div class="row pw-actions"><button class="btn danger" id="st-clear">Daten löschen</button></div>`;
  $('#st-on').onchange = e => api.call('screenTimeOff', !e.target.checked);
  $('#st-clear').onclick = async () => { await api.call('screenTimeClear'); renderScreenTime(); };
}

// ------------------------------------------------------------ Live-Kanäle
async function renderLive() {
  const body = $('#panel-body');
  const list = (await api.call('liveList')) || [];
  if (panelKind !== 'live') return;
  body.innerHTML = `<div class="row pw-actions"><button class="btn" id="live-now"${list.length ? '' : ' disabled'}>Jetzt prüfen</button></div>` +
    (list.length ? list.map(c => `<div class="p-item live${c.live ? ' on' : ''}" data-key="${esc(c.key)}">
      <span class="fav">${iconImg(c.url, c.name)}</span>
      <div class="txt" data-url="${esc(c.url)}" title="${esc(c.url)}"><div>${c.live ? '<span class="live-dot">LIVE</span>' : ''}${esc(c.name)}</div>
        <small>${c.kind === 'twitch' ? 'Twitch' : 'YouTube'} · ${c.live ? esc(c.title || 'gerade live') : 'offline'}${c.checked ? ' · geprüft ' + esc(timeAgo(c.checked)) : ''}</small></div>
      <button class="icon small" data-act="del" title="Nicht mehr melden"><svg><use href="#i-trash"/></svg></button></div>`).join('')
    : '<p class="p-empty">Noch keine Kanäle. Öffne einen Twitch-Kanal, einen YouTube-Kanal oder ein YouTube-Video und wähle im Menü „Bei Livegang benachrichtigen“. Sakura prüft alle 3 Minuten.</p>');
  const now = $('#live-now');
  now.onclick = async () => { now.disabled = true; now.textContent = 'Prüfe …'; await api.call('liveCheckNow'); renderLive(); };
  body.onclick = async e => {
    if (openFromPanel(e)) return;
    const b = e.target.closest('button[data-act="del"]');
    if (b) { await api.call('liveRemove', b.closest('.p-item').dataset.key); renderLive(); }
  };
}

// ------------------------------------------------------------ Notizen
async function renderNotes() {
  const body = $('#panel-body');
  const list = (await api.call('notes')) || [];
  if (panelKind !== 'notes') return;
  body.innerHTML = list.length ? list.map(n => `<div class="p-item note" data-key="${esc(n.key)}">
      <span class="fav">${iconImg(n.url, n.title)}</span>
      <div class="txt" data-url="${esc(n.url)}" title="${esc(n.url)}"><div>${esc(n.title)}</div><small class="note-txt">${esc(n.text)}</small><small>${esc(hostOf(n.url))} · ${esc(timeAgo(n.at))}</small></div>
      <button class="icon small" data-act="del" title="Notiz löschen"><svg><use href="#i-trash"/></svg></button></div>`).join('')
    : '<p class="p-empty">Noch keine Notizen. Öffne eine Seite und wähle im Menü „Notiz zur Seite …“ – beim nächsten Besuch erinnert dich Sakura daran.</p>';
  body.onclick = async e => {
    if (openFromPanel(e)) return;
    const b = e.target.closest('button[data-act="del"]');
    if (b) { await api.call('noteRemove', b.closest('.p-item').dataset.key); renderNotes(); }
  };
}
api.on('notes-changed', () => { if (panelKind === 'notes') renderNotes(); });

// ------------------------------------------------------------ Sitzungen
async function renderSessions(note = '') {
  const body = $('#panel-body');
  const list = (await api.call('sessions')) || [];
  if (panelKind !== 'sessions') return;
  body.innerHTML = `<div class="row sess-new"><input id="sess-name" type="text" maxlength="80" placeholder="Name, z. B. Hausaufgaben" aria-label="Name der Sitzung"><button class="btn primary" id="sess-save">Offene Tabs speichern</button></div>` +
    (note ? `<p class="p-note">${esc(note)}</p>` : '') +
    (list.length ? list.map(x => `<div class="p-item sess" data-id="${esc(x.id)}">
      <div class="txt sess-open" title="In neuem Fenster öffnen"><div>${esc(x.name)}</div><small>${x.count === 1 ? '1 Tab' : x.count + ' Tabs'} · ${esc(timeAgo(x.at))} · ${esc(x.titles.join(', '))}</small></div>
      <button class="icon small" data-act="del" title="Sitzung löschen"><svg><use href="#i-trash"/></svg></button></div>`).join('')
    : '<p class="p-empty">Noch keine Sitzung gespeichert. Gib oben einen Namen ein und speichere alle offenen Tabs dieses Fensters – später öffnest du sie mit einem Klick wieder.</p>');
  const save = async () => {
    const r = await api.call('sessionSave', $('#sess-name').value);
    renderSessions(r && r.ok ? `„${r.name}“ gespeichert (${r.count === 1 ? '1 Tab' : r.count + ' Tabs'}).` : (r && r.error) || '');
  };
  $('#sess-save').onclick = save;
  $('#sess-name').onkeydown = e => { if (e.key === 'Enter') save(); };
  body.onclick = async e => {
    const row = e.target.closest('.p-item');
    if (!row) return;
    if (e.target.closest('[data-act="del"]')) { await api.call('sessionRemove', row.dataset.id); renderSessions(); return; }
    if (e.target.closest('.sess-open')) { api.call('sessionOpen', row.dataset.id); closeOverlay(); }
  };
}
api.on('readlist-changed', () => { if (panelKind === 'readlist') renderReadlist(); });
// Kurze Meldung unten
let toastT = null;
function showToast(text) {
  const t = $('#toast');
  t.textContent = text; t.hidden = false;
  t.classList.remove('leaving');
  clearTimeout(toastT); toastT = setTimeout(() => { t.classList.add('leaving'); toastT = setTimeout(() => { t.hidden = true; t.classList.remove('leaving'); }, 200); }, Math.min(7000, 2600 + String(text).length * 30));
}
api.on('toast', showToast);

// ------------------------------------------------------------ Überwachte Seiten
const WATCH_LABEL = { down: 'Preis gesunken', up: 'Preis gestiegen', back: 'Wieder verfügbar', gone: 'Nicht mehr verfügbar' };
async function renderWatches() {
  const body = $('#panel-body');
  const list = (await api.call('watches')) || [];
  if (panelKind !== 'watches') return;
  body.innerHTML = `<div class="row pw-actions"><button class="btn" id="w-now"${list.length ? '' : ' disabled'}>Jetzt alle prüfen</button></div>` +
    (list.length ? list.map(w => `<div class="p-item watch" data-id="${esc(w.id)}">
      <span class="fav">${iconImg(w.url, w.title)}</span>
      <div class="txt" data-url="${esc(w.url)}" title="${esc(w.url)}"><div>${esc(w.title)}</div>
        <small>${esc(w.priceText || (w.available === false ? 'Nicht verfügbar' : w.available ? 'Verfügbar' : ''))}${w.available === false && w.priceText ? ' · nicht verfügbar' : ''} · geprüft ${esc(timeAgo(w.lastCheck))}${w.error ? ' · ' + esc(w.error) : ''}</small>
        ${w.last ? `<small class="w-last ${esc(w.last.kind)}">${esc(w.last.text)} · ${esc(timeAgo(w.lastChange))}</small>` : ''}</div>
      <button class="icon small" data-act="del" title="Nicht mehr überwachen"><svg><use href="#i-trash"/></svg></button></div>`).join('')
    : `<p class="p-empty">Noch nichts überwacht. Öffne eine Produktseite und wähle im Menü „Seite überwachen“ – Sakura meldet sich, wenn der Preis sinkt oder das Produkt wieder verfügbar ist.</p>`);
  const now = $('#w-now');
  now.onclick = async () => { now.disabled = true; now.textContent = 'Prüfe …'; await api.call('watchCheckNow'); renderWatches(); };
  body.onclick = async e => {
    if (openFromPanel(e)) return;
    const b = e.target.closest('button[data-act="del"]');
    if (b) { await api.call('watchRemove', b.closest('.p-item').dataset.id); renderWatches(); }
  };
}
api.on('watches-changed', () => { if (panelKind === 'watches') renderWatches(); });

// ------------------------------------------------------------ Passwörter
async function renderPasswords(filter = '', note = null) {
  const body = $('#panel-body');
  const d = await api.call('pwList');
  if (panelKind !== 'passwords') return;
  if (d && d.locked) { pinGate('passwords', 'Deine Passwörter'); return; }
  const q = filter.toLowerCase();
  const list = d.entries.filter(e => !q || e.host.toLowerCase().includes(q) || e.username.toLowerCase().includes(q));
  const leaked = d.entries.filter(e => e.leaked).length;
  if (!d.enabled) {
    body.innerHTML = `<p class="p-empty">Der Passwortmanager ist ausgeschaltet. Sakura fragt nicht nach dem Speichern und füllt nichts aus.${d.entries.length ? ' Deine gespeicherten Passwörter sind noch da.' : ''}</p>
      <div class="row"><button class="btn primary" id="pw-enable">Einschalten</button>${d.entries.length ? '<button class="btn danger" id="pw-clear">Alle Passwörter löschen</button>' : ''}</div>`;
    $('#pw-enable').onclick = async () => { await api.call('setPrefs', { passwordManager: true }); renderPasswords(); };
    if ($('#pw-clear')) $('#pw-clear').onclick = async () => { if (confirm('Alle gespeicherten Passwörter endgültig löschen?')) { await api.call('pwClear'); renderPasswords(); } };
    return;
  }
  body.innerHTML = !d.available
    ? `<p class="p-empty">${d.broken ? 'Die gespeicherten Passwörter gehören zu einem anderen Windows-Konto und lassen sich hier nicht öffnen.' : 'Der sichere Speicher ist auf diesem System nicht verfügbar – Passwörter werden deshalb nicht gespeichert.'}</p>`
    : `<input class="p-search" placeholder="Passwörter durchsuchen" value="${esc(filter)}">
    <div class="row pw-actions"><button class="btn" id="pw-import">Aus Chrome/Firefox importieren …</button><button class="btn" id="pw-check">Auf Datenlecks prüfen</button></div>
    <p class="${note && note.error ? 'msg-error' : 'msg-ok'}" id="pw-note"${note ? '' : ' hidden'}>${esc(note ? note.message || note.error : '')}</p>
    ${leaked && !note ? `<p class="msg-error">${leaked === 1 ? 'Ein Passwort taucht' : leaked + ' Passwörter tauchen'} in bekannten Datenlecks auf.</p>` : ''}
    ${list.length ? list.map(e => `<div class="p-item pw" data-id="${esc(e.id)}">
        <span class="fav">${iconImg(e.origin, e.host)}</span>
        <div class="txt"><div>${esc(e.host)}${e.leaked ? ' <b class="leak" title="In Datenlecks gefunden">Leck</b>' : ''}</div><small>${esc(e.username || '(ohne Benutzername)')}</small>
          <small class="pw-val" hidden></small></div>
        <button class="icon small" data-act="show" title="Passwort anzeigen"><svg><use href="#i-eye"/></svg></button>
        <button class="icon small" data-act="copy" title="Passwort kopieren"><svg><use href="#i-copy"/></svg></button>
        <button class="icon small" data-act="edit" title="Bearbeiten"><svg><use href="#i-edit"/></svg></button>
        <button class="icon small" data-act="del" title="Löschen"><svg><use href="#i-trash"/></svg></button></div>`).join('')
      : `<p class="p-empty">${d.entries.length ? 'Keine Treffer.' : 'Noch keine Passwörter. Melde dich auf einer Seite an – Sakura fragt dann, ob es das Passwort speichern soll. Oder importiere sie aus Chrome, Edge oder Firefox.'}</p>`}
    <p class="pw-hint">Deine Passwörter sind mit deinem Windows-Konto verschlüsselt und bleiben auf diesem PC.</p>
    <div class="row"><button class="btn" id="pw-off">Passwortmanager ausschalten</button>${d.entries.length ? '<button class="btn danger" id="pw-clear">Alle Passwörter löschen</button>' : ''}</div>`;
  if (!d.available) return;
  const s = body.querySelector('.p-search');
  s.oninput = () => { const pos = s.selectionStart; renderPasswords(s.value).then(() => { const n = $('#panel-body .p-search'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }); };
  $('#pw-off').onclick = async () => { await api.call('setPrefs', { passwordManager: false }); renderPasswords(); };
  if ($('#pw-clear')) $('#pw-clear').onclick = async () => { if (confirm('Alle gespeicherten Passwörter endgültig löschen?')) { await api.call('pwClear'); renderPasswords(s.value); } };
  $('#pw-import').onclick = async () => { const r = await api.call('pwImport'); if (r) renderPasswords(s.value, r); };
  $('#pw-check').onclick = async () => {
    $('#pw-check').disabled = true; $('#pw-check').textContent = 'Prüfe …';
    renderPasswords(s.value, await api.call('pwCheck'));
  };
  body.onclick = async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const row = b.closest('.p-item'), id = row.dataset.id;
    if (b.dataset.act === 'show') {
      const v = row.querySelector('.pw-val');
      if (v.hidden) { v.textContent = await api.call('pwReveal', id) || ''; v.hidden = false; } else { v.hidden = true; v.textContent = ''; }
    }
    if (b.dataset.act === 'copy') { await api.call('pwCopy', id); b.title = 'Kopiert – wird nach 30 Sekunden gelöscht'; b.classList.add('done'); }
    if (b.dataset.act === 'del') { if (confirm('Dieses Passwort löschen?')) { await api.call('pwDelete', id); renderPasswords(s.value); } }
    if (b.dataset.act === 'edit') {
      const entry = d.entries.find(x => x.id === id);
      const form = document.createElement('div');
      form.className = 'p-edit';
      form.innerHTML = `<input name="u" value="${esc(entry.username)}" aria-label="Benutzername" placeholder="Benutzername">
        <input name="p" type="password" placeholder="Neues Passwort (leer lassen = unverändert)" aria-label="Neues Passwort">
        <div class="row"><button class="btn" data-x="cancel">Abbrechen</button><button class="btn primary" data-x="save">Speichern</button></div>`;
      row.replaceWith(form);
      form.querySelector('input').focus();
      form.onclick = async ev => {
        const x = ev.target.dataset.x;
        ev.stopPropagation();
        if (x === 'cancel') renderPasswords(s.value);
        if (x === 'save') { await api.call('pwUpdate', { id, patch: { username: form.querySelector('[name=u]').value, password: form.querySelector('[name=p]').value } }); renderPasswords(s.value); }
      };
    }
  };
}

// ------------------------------------------------------------ Tab-Suche (Strg+Umschalt+A)
let tsData = { open: [], closed: [], bookmarks: [] }, tsItems = [], tsSel = 0, tsMode = 'tabs', tsHist = [], tsHistQ = '', tsHistT = null;
// Befehlssuche (Strg+K): Befehle aus dem Menü, Einstellungen, Tabs, Lesezeichen und Verlauf in einem Feld
const SETTINGS_CATS = [['sync', 'Synchronisation'], ['start', 'Startseite und Hintergrund'], ['search', 'Suchmaschine'], ['look', 'Design und Erscheinungsbild'],
  ['privacy', 'Datenschutz und Sicherheit'], ['passwords', 'Passwort-Einstellungen'], ['tabs', 'Tabs und Surfen'], ['video', 'Videos und YouTube'],
  ['twitch', 'Twitch und Steam'], ['perf', 'Leistung und Gaming'], ['import', 'Daten importieren'], ['about', 'Über Sakura und Updates'], ['remote', 'Fernsteuerung']];
function menuCommands() {
  const out = [];
  for (const b of document.querySelectorAll('#menu .mpage > button, #menu .mquick button')) {
    if (b.classList.contains('mback') || b.classList.contains('mgroup') || 'palette' in b.dataset) continue;
    const label = (b.querySelector('span') || b.firstChild || b).textContent.trim();
    const kbd = b.querySelector('kbd');
    if (label) out.push({ kind: 'cmd', title: label, hint: kbd ? kbd.textContent : (b.title || ''), btn: b });
  }
  for (const [cat, label] of SETTINGS_CATS) out.push({ kind: 'set', title: 'Einstellungen: ' + label, cat });
  return out;
}
const norm = s => String(s || '').toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
async function openTabSearch(mode = 'tabs') {
  if (overlay === 'tabsearch' && tsMode === mode) return closeOverlay();
  openOverlay('tabsearch');
  tsMode = mode;
  $('#tabsearch').hidden = false;
  $('#tabsearch').classList.toggle('palette', mode === 'all');
  tsData = (await api.call('tabSearch')) || { open: [], closed: [] };
  tsData.bookmarks = mode === 'all' ? ((await api.call('bookmarks')) || []) : [];
  tsHist = []; tsHistQ = '';
  const q = $('#ts-q'); q.value = ''; q.placeholder = mode === 'all' ? 'Befehle, Tabs, Lesezeichen, Verlauf, Einstellungen …' : 'Tabs durchsuchen'; q.focus();
  tsSel = 0;
  paintTabSearch();
}
function paintTabSearch() {
  const raw = $('#ts-q').value.trim();
  const words = norm(raw).split(/\s+/).filter(Boolean);
  const hit = (...fields) => { const h = norm(fields.join(' ')); return words.every(w => h.includes(w)); };
  const open = tsData.open.filter(t => hit(t.title, t.url)), closed = tsData.closed.filter(t => hit(t.title, t.url));
  const groups = [];
  if (tsMode === 'all') {
    const cmds = menuCommands().filter(c => hit(c.title));
    if (cmds.length) groups.push(['Befehle', raw ? cmds.slice(0, 8) : cmds.slice(0, 6)]);
    if (open.length) groups.push([`Offene Tabs (${open.length})`, open.slice(0, raw ? 6 : 5).map(t => ({ kind: 'open', ...t }))]);
    if (raw) {
      const bms = tsData.bookmarks.filter(b => hit(b.title, b.url, b.folder)).slice(0, 5);
      if (bms.length) groups.push(['Lesezeichen', bms.map(b => ({ kind: 'bm', title: b.title || b.url, url: b.url }))]);
      if (tsHist.length) groups.push(['Verlauf', tsHist.slice(0, 5).map(h => ({ kind: 'hist', title: h.title || h.url, url: h.url }))]);
      if (closed.length) groups.push(['Zuletzt geschlossen', closed.slice(0, 3).map(t => ({ kind: 'closed', ...t }))]);
      // Verlauf nachladen (kurz verzögert, nicht bei jedem Tastendruck)
      if (tsHistQ !== raw) {
        clearTimeout(tsHistT);
        tsHistT = setTimeout(async () => {
          const h = await api.call('history', raw);
          if ($('#ts-q').value.trim() !== raw) return;
          tsHistQ = raw; tsHist = Array.isArray(h) ? h : [];
          paintTabSearch();
        }, 160);
      }
    }
  } else {
    if (open.length) groups.push([`Offene Tabs (${open.length})`, open.map(t => ({ kind: 'open', ...t }))]);
    if (closed.length) groups.push(['Zuletzt geschlossen', closed.map(t => ({ kind: 'closed', ...t }))]);
  }
  tsItems = groups.flatMap(g => g[1]);
  tsSel = Math.min(tsSel, Math.max(0, tsItems.length - 1));
  const sub = t => t.kind === 'cmd' ? (t.hint || '') : t.kind === 'set' ? '' : t.kind === 'closed' ? 'geschlossen' : t.kind === 'bm' ? hostOf(t.url)
    : t.kind === 'hist' ? hostOf(t.url) : t.active ? 'aktueller Tab' : t.sleeping ? 'schläft' : t.here ? hostOf(t.url) : 'anderes Fenster';
  const icon = t => t.kind === 'cmd' || t.kind === 'set' ? `<svg><use href="#${t.kind === 'set' ? 'i-menu' : 'i-chev'}"/></svg>`
    : t.url ? iconImg(t.url, t.title) : '<i class="ficon-l">桜</i>';
  let html = '', i = 0;
  for (const [head, items] of groups) {
    html += `<li class="ts-head">${esc(head)}</li>`;
    for (const t of items) { html += `<li data-i="${i}" class="${i === tsSel ? 'sel' : ''}${t.active ? ' cur' : ''}"><span class="sfav${t.kind === 'cmd' || t.kind === 'set' ? ' cmd' : ''}">${icon(t)}</span>
      <span class="t">${esc(t.title)}</span><small>${esc(sub(t))}</small></li>`; i++; }
  }
  $('#ts-list').innerHTML = html || '<li class="ts-head">Keine Treffer</li>';
  const sel = $('#ts-list li.sel');
  if (sel) sel.scrollIntoView({ block: 'nearest' });
}
function pickTabSearch(i) {
  const t = tsItems[i];
  if (!t) return;
  closeOverlay();
  if (t.kind === 'open') api.call('focusTab', t.id);
  else if (t.kind === 'closed') api.call('reopenClosedAt', t.index);
  else if (t.kind === 'cmd') t.btn.click();
  else if (t.kind === 'set') api.call('openSettings', t.cat);
  else if (t.url) api.call('navigate', t.url);
}
$('#ts-q').addEventListener('input', () => { tsSel = 0; paintTabSearch(); });
$('#ts-q').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); tsSel = (tsSel + (e.key === 'ArrowDown' ? 1 : -1) + tsItems.length) % Math.max(1, tsItems.length); paintTabSearch(); }
  if (e.key === 'Enter') { e.preventDefault(); pickTabSearch(tsSel); }
});
$('#ts-list').addEventListener('mousedown', e => { const l = e.target.closest('li[data-i]'); if (l) { e.preventDefault(); pickTabSearch(Number(l.dataset.i)); } });
api.on('tab-search', () => openTabSearch('tabs'));
api.on('palette', () => openTabSearch('all'));
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); openTabSearch('tabs'); }
  else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); openTabSearch('all'); }
});

// ------------------------------------------------------------ Video und Ton
let mediaTick = null;
const EQ_LABELS = ['Tief', 'Bass', 'Mitten', 'Höhen', 'Brillanz'];
$('#media-btn').onclick = () => overlay === 'media' ? closeOverlay() : openMedia();
async function openMedia() {
  openOverlay('media');
  const pop = $('#media-pop');
  pop.hidden = false;
  const m = await api.call('mediaState');
  if (overlay !== 'media') return;
  if (!m || !m.host) { pop.innerHTML = '<h3>Video und Ton</h3><p>Öffne eine Seite mit Video oder Musik.</p>'; return; }
  const sleepLabel = () => !m.sleep ? 'Aus' : m.sleep.mode === 'episode' ? 'Hält am Ende der Folge an' : `Hält in ${Math.max(1, Math.ceil((m.sleep.until - Date.now()) / 60000))} Min. an`;
  const range = (id, min, max, val, label, unit) => `<label class="m-range"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" value="${val}"><output>${val}${unit}</output></label>`;
  pop.innerHTML = `
    <h3>Video und Ton</h3>
    <p class="m-sub">Einstellungen für ${esc(m.host)} werden gemerkt.</p>
    <div class="m-sec"><b>Sleep-Timer</b> <span id="m-sleep-txt">${esc(sleepLabel())}</span>
      <div class="m-chips">${[['0', 'Aus'], ['15', '15 Min.'], ['30', '30 Min.'], ['60', '1 Std.'], ['ep', 'Ende der Folge']].map(([v, l]) =>
        `<button data-sleep="${v}" class="${(v === '0' && !m.sleep) || (m.sleep && (m.sleep.mode === 'episode' ? v === 'ep' : String(m.sleep.minutes) === v)) ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="m-sec">
      <label class="switch"><input type="checkbox" id="m-clip"${m.clip ? ' checked' : ''}><span>Clip bereit – merkt sich laufend die letzten 30 Sek.</span></label>
      <div class="row"><button class="btn primary" id="m-clip-save"${m.clip ? '' : ' disabled'}>Clip speichern</button><small class="m-hint">Alt+C</small></div>
    </div>
    ${m.twitch ? `<div class="m-sec">
      <label class="switch"><input type="checkbox" id="m-audio"${m.audioOnly ? ' checked' : ''}><span>Nur Ton – Bild aus, spart Daten und Leistung</span></label>
    </div>` : ''}
    <div class="m-sec">
      ${range('m-vol', 0, 200, m.volume == null ? 100 : m.volume, 'Lautstärke dieses Tabs', ' %')}
    </div>
    <div class="m-sec">
      <label class="switch"><input type="checkbox" id="m-cinema"${m.cinema ? ' checked' : ''}><span>Kino-Modus – alles außer dem Video abdunkeln</span></label>
      ${range('m-bright', 50, 150, m.brightness, 'Helligkeit', ' %')}
    </div>
    <div class="m-sec">
      ${range('m-bass', 0, 12, m.bass, 'Bass-Verstärker', ' dB')}
      <label class="switch"><input type="checkbox" id="m-dialog"${m.dialog ? ' checked' : ''}><span>Dialog-Verstärker – Stimmen deutlicher</span></label>
      <div class="m-eq">${m.eq.map((g, i) => `<label><input type="range" min="-12" max="12" value="${g}" data-eq="${i}" orient="vertical"><small>${EQ_LABELS[i]}</small></label>`).join('')}</div>
    </div>
    <p class="msg-error" id="m-note" hidden></p>
    <div class="row"><button class="btn" id="m-reset">Zurücksetzen</button></div>`;
  const note = r => { const n = $('#m-note'); const t = r && (r.error || (r.notes || [])[0]); n.textContent = t || ''; n.hidden = !t; };
  let t = null;
  const send = patch => { clearTimeout(t); t = setTimeout(async () => note(await api.call('mediaSet', patch)), 120); };
  pop.querySelectorAll('input[type=range]').forEach(r => r.addEventListener('input', () => {
    const out = r.parentElement.querySelector('output');
    if (out) out.textContent = r.value + (r.id === 'm-bright' || r.id === 'm-vol' ? ' %' : ' dB');
    if (r.dataset.eq) send({ eq: [...pop.querySelectorAll('[data-eq]')].map(x => Number(x.value)) });
    else send(r.id === 'm-bright' ? { brightness: Number(r.value) } : r.id === 'm-vol' ? { volume: Number(r.value) } : { bass: Number(r.value) });
  }));
  if ($('#m-audio')) $('#m-audio').onchange = async e => {
    const r = await api.call('twitchAudio', e.target.checked);
    if (r && r.error) { e.target.checked = !e.target.checked; note(r); }
    else note({ notes: r && r.mode === 'klein' ? ['Twitch bietet hier keine reine Tonspur – Sakura nutzt die kleinste Qualität und blendet das Bild aus.'] : [] });
  };
  $('#m-clip').onchange = async e => {
    const r = await api.call('clipArm', e.target.checked);
    if (r && r.error) { e.target.checked = false; note(r); }
    $('#m-clip-save').disabled = !(r && r.armed);
  };
  $('#m-clip-save').onclick = async () => { const r = await api.call('clipSave'); if (r && r.error) note(r); };
  $('#m-cinema').onchange = async e => note(await api.call('mediaSet', { cinema: e.target.checked }));
  $('#m-dialog').onchange = async e => note(await api.call('mediaSet', { dialog: e.target.checked }));
  $('#m-reset').onclick = async () => { await api.call('mediaReset'); openMedia(); };
  pop.querySelectorAll('[data-sleep]').forEach(b => b.onclick = async () => {
    const v = b.dataset.sleep;
    const r = await api.call('sleepSet', v === 'ep' ? { episode: true } : { minutes: Number(v) });
    if (r && r.error) note(r); else openMedia();
  });
  clearTimeout(mediaTick);
  if (m.sleep && m.sleep.mode === 'time') mediaTick = setTimeout(() => { const s = $('#m-sleep-txt'); if (s && overlay === 'media') s.textContent = sleepLabel(); }, 30000);
}

// ------------------------------------------------------------ Leistung
const fmtMB = b => b >= 1024 ** 3 ? (b / 1024 ** 3).toLocaleString('de-DE', { maximumFractionDigits: 1 }) + ' GB' : Math.round(b / 1024 ** 2).toLocaleString('de-DE') + ' MB';
const fmtPct = v => v == null ? '–' : Math.round(v).toLocaleString('de-DE') + ' %';
let perfTimer = null;
async function renderPerformance() {
  clearTimeout(perfTimer);
  if (panelKind !== 'performance') return;
  const d = await api.call('perf');
  if (panelKind !== 'performance' || !d) return;
  const body = $('#panel-body');
  const used = d.system.memTotal - d.system.memFree;
  const maxMem = Math.max(1, ...d.tabs.map(t => t.mem));
  const net = !d.online ? '<b class="bad">Keine Verbindung</b>' : d.ping == null ? 'Verbunden, Ping nicht messbar' : `Verbunden, Ping <b class="${d.ping > 150 ? 'bad' : d.ping > 60 ? 'mid' : 'good'}">${d.ping} ms</b>`;
  const awake = d.tabs.filter(t => !t.sleeping && !t.active && /^https?:/.test(t.url)).length;
  const scroll = body.scrollTop;
  body.innerHTML = `
    <div class="perf-cards">
      <div class="perf-card"><small>Sakura</small><strong>${fmtMB(d.sakura.mem)}</strong><span>CPU ${fmtPct(d.sakura.cpu)}</span></div>
      <div class="perf-card"><small>Dein PC</small><strong>${fmtPct(used / d.system.memTotal * 100)} RAM</strong><span>CPU ${fmtPct(d.system.cpu)}</span></div>
      <div class="perf-card wide"><small>Internet</small><span>${net}</span></div>
      ${d.gaming.supported ? `<div class="perf-card wide${d.gaming.active ? ' gaming' : ''}"><small>Gaming-Modus</small><span>${!d.gaming.on ? 'Ausgeschaltet' : d.gaming.active ? `<b>Aktiv</b> – ${esc(d.gaming.game)} läuft, Sakura hält sich zurück` : 'Bereit – startet von selbst, wenn du ein Spiel öffnest'}</span></div>` : ''}
    </div>
    <div class="row perf-actions"><button class="btn" id="perf-sleep-all"${awake ? '' : ' disabled'}>Alle Hintergrund-Tabs schlafen legen</button></div>
    <p class="perf-hint">Ein schlafender Tab braucht fast keinen Speicher. Beim Anklicken lädt er neu.</p>
    ${d.tabs.map(t => `
      <div class="perf-row${t.sleeping ? ' sleeping' : ''}${t.active ? ' active' : ''}" data-id="${t.id}">
        <span class="fav">${t.url ? iconImg(t.url, t.title) : `<i class="ficon-l">${esc(letterOf(t.title))}</i>`}</span>
        <div class="txt" data-tab="${t.id}"><div>${esc(t.title)}</div>
          <small>${t.sleeping ? 'Schläft' : t.active ? 'Aktiver Tab' : t.audible ? 'Spielt Ton ab' : esc(hostOf(t.url) || '')}</small>
          ${t.sleeping ? '' : `<span class="bar"><i style="width:${Math.max(2, t.mem / maxMem * 100).toFixed(0)}%"></i></span>`}</div>
        <div class="nums">${t.sleeping ? '' : `${t.shared ? 'ca. ' : ''}${fmtMB(t.mem)}<small>CPU ${fmtPct(t.cpu)}</small>`}</div>
        <button class="icon small" data-sleep="${t.id}" title="Schlafen legen"${t.sleeping || t.active || !/^https?:/.test(t.url) ? ' disabled' : ''}><svg><use href="#i-moon"/></svg></button>
      </div>`).join('')}`;
  body.scrollTop = scroll;
  body.onclick = async e => {
    const s = e.target.closest('[data-sleep]');
    if (s) { await api.call('sleepTab', Number(s.dataset.sleep)); renderPerformance(); return; }
    if (e.target.closest('#perf-sleep-all')) { await api.call('sleepBackground'); renderPerformance(); return; }
    const t = e.target.closest('[data-tab]');
    if (t) { api.call('focusTab', Number(t.dataset.tab)); closeOverlay(); }
  };
  perfTimer = setTimeout(renderPerformance, 2000);
}
$('#gaming-ind').onclick = () => openPanel('performance');
$('#reader-btn').onclick = () => api.call('reader');

// ------------------------------------------------------------ Notiz zur Seite
let noteLoaded = null, noteT = null;
async function openNote() {
  const n = await api.call('noteGet');
  if (!n) { closeOverlay(); showToast('Notizen gehen nur auf normalen Webseiten.'); return; }
  openOverlay('note');
  $('#note-pop').hidden = false;
  noteLoaded = n.text;
  $('#note-text').value = n.text;
  $('#note-info').textContent = n.at ? 'Gespeichert ' + timeAgo(n.at) : '';
  $('#note-del').hidden = !n.text;
  $('#note-text').focus();
}
function saveNote() {
  clearTimeout(noteT);
  const v = $('#note-text').value;
  if (noteLoaded === null || v === noteLoaded) return;
  noteLoaded = v;
  api.call('noteSet', v);
}
$('#note-btn').onclick = openNote;
$('#tb-go').onclick = () => api.call('translateDo', $('#tb-lang').value);
$('#tb-never').onclick = () => api.call('translateNever');
$('#tb-close').onclick = () => api.call('translateClose');
$('#dark-btn').onclick = async () => { const on = await api.call('darkSite'); if (on != null) showToast(on ? 'Diese Seite wird jetzt dunkel angezeigt.' : 'Dunkelmodus für diese Seite aus.'); };
$('#ki-btn').onclick = () => api.call('kiToggle');
// Medien-Leiste
$('#mb-play').onclick = () => api.call('mediaBar', 'toggle');
$('#mb-next').onclick = () => api.call('mediaBar', 'next');
$('#mb-prev').onclick = () => api.call('mediaBar', 'prev');
$('#mb-title').onclick = () => api.call('mediaBar', 'focus');

// ------------------------------------------------------------ Link-Vorschau (langes Drücken auf einen Link)
let lpClosing = false;
api.on('link-preview', d => {
  if (!d || !d.open) { if (overlay === 'linkpreview') { lpClosing = true; closeOverlay(); lpClosing = false; } return; }
  if (overlay !== 'linkpreview') { hideTabPreview(); openOverlay('linkpreview'); }
  const bar = $('#lp-bar');
  bar.hidden = false;
  bar.querySelector('b').textContent = d.title || d.url;
  bar.querySelector('small').textContent = hostOf(d.url);
  if (d.rect) { bar.style.left = d.rect.x + 'px'; bar.style.width = d.rect.width + 'px'; bar.style.top = (d.rect.y - 50) + 'px'; }
});
$('#lp-x').onclick = () => closeOverlay();
$('#lp-tab').onclick = () => { lpClosing = true; closeOverlay(); lpClosing = false; api.call('linkPreviewOpenTab'); };

// ------------------------------------------------------------ Arbeitsbereiche
function openSpacePop() {
  if (isSide) { api.call('spaceMenu'); return; } // in der Seitenleiste: Hauptoberfläche zeigt das Fenster
  if (overlay === 'space') return closeOverlay();
  hideTabPreview();
  openOverlay('space');
  const pop = $('#space-pop');
  const r = $('#space-btn').getBoundingClientRect();
  pop.style.left = (r.width ? Math.max(8, r.left) : (S.vertical ? 252 : 8)) + 'px';
  pop.style.right = 'auto';
  pop.style.top = (r.width ? r.bottom + 6 : $('#toolbar').getBoundingClientRect().bottom + 8) + 'px';
  pop.hidden = false;
  paintSpacePop();
}
function paintSpacePop() {
  const cur = (S.spaces || []).find(x => x.id === S.spaceId) || {};
  $('#space-list').innerHTML = (S.spaces || []).map((s, i) => `<button data-space="${esc(s.id)}" class="${s.id === S.spaceId ? 'on' : ''}" style="--sc:var(--g-${esc(s.color)})"><i></i><span>${esc(s.name)}</span><small>${s.count} Tab${s.count === 1 ? '' : 's'} · Alt+${i + 1}</small></button>`).join('');
  if (document.activeElement !== $('#space-name')) $('#space-name').value = cur.name || '';
  $('#space-colors').innerHTML = Object.entries(GROUP_COLORS).map(([k, label]) =>
    `<button data-color="${k}" role="radio" aria-checked="${k === cur.color}" title="${label}" style="--c:var(--g-${k})"><svg viewBox="0 0 24 24"><path d="M5 12l5 5 9-10"/></svg></button>`).join('');
  $('#space-del').disabled = (S.spaces || []).length <= 1;
}
$('#space-btn').onclick = openSpacePop;
api.on('space-pop', openSpacePop);
$('#space-list').addEventListener('click', e => { const b = e.target.closest('[data-space]'); if (b) { api.call('spaceSwitch', b.dataset.space); closeOverlay(); } });
$('#space-name').addEventListener('input', e => api.call('spaceUpdate', { id: S.spaceId, patch: { name: e.target.value } }));
$('#space-colors').addEventListener('click', e => { const b = e.target.closest('[data-color]'); if (b) api.call('spaceUpdate', { id: S.spaceId, patch: { color: b.dataset.color } }); });
$('#space-new').onclick = async () => { await api.call('spaceNew', {}); setTimeout(() => { $('#space-name').focus(); $('#space-name').select(); }, 60); };
$('#space-del').onclick = () => { if (confirm('Diesen Arbeitsbereich mit allen seinen Tabs schließen?')) { api.call('spaceRemove', S.spaceId); closeOverlay(); } };

// ------------------------------------------------------------ Tab-Vorschau
let tpTimer = null, tpFor = null, tpShown = false;
function hideTabPreview() {
  clearTimeout(tpTimer); tpFor = null;
  if (!tpShown) return;
  tpShown = false;
  $('#tab-preview').hidden = true;
  if (!overlay) api.call('overlay', false);
}
async function showTabPreview(el) {
  const id = Number(el.dataset.id);
  const d = await api.call('tabPreview', id);
  if (tpFor !== el || !d || overlay) return;
  const box = $('#tab-preview');
  const img = box.querySelector('img');
  img.hidden = !(d.img && d.img.startsWith('data:image/jpeg;base64,'));
  if (!img.hidden) img.src = d.img;
  box.querySelector('b').textContent = d.title;
  box.querySelector('small').textContent = [d.host, d.sleeping ? 'schläft' : '', d.audible ? 'spielt Ton' : ''].filter(Boolean).join(' · ');
  const r = el.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(r.left, innerWidth - 300)) + 'px';
  if (!tpShown) api.call('overlay', true); // Oberfläche kurz über die Seite ausdehnen, damit die Karte Platz hat
  tpShown = true;
  box.hidden = false;
}
$('#tabs').addEventListener('mouseover', e => {
  if (isSide || S.vertical) return; // in der Seitenleiste sind die Titel ohnehin sichtbar
  const el = e.target.closest('.tab');
  if (!el || el === tpFor || el.classList.contains('dragging')) return;
  clearTimeout(tpTimer);
  tpFor = el;
  tpTimer = setTimeout(() => showTabPreview(el), tpShown ? 60 : 550);
});
// Beim Vergrößern der Oberfläche meldet Chromium ein falsches „Verlassen“ – daher selbst anhand der Mausposition prüfen
document.addEventListener('mousemove', e => {
  if (!tpFor && !tpShown) return;
  const r = $('#tabs').getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) hideTabPreview();
});
window.addEventListener('blur', hideTabPreview);
$('#tabs').addEventListener('mousedown', hideTabPreview);
$('#tabs').addEventListener('dragstart', hideTabPreview);

// QR-Code der Seite
async function openQr() {
  const r = await api.call('qr');
  if (!r || r.error) { closeOverlay(); showToast((r && r.error) || 'Kein QR-Code möglich.'); return; }
  openOverlay('qr');
  $('#qr-pop').hidden = false;
  if (/^data:image\/gif;base64,/.test(r.img)) $('#qr-img').src = r.img;
  $('#qr-url').textContent = r.url;
  $('#qr-copy').textContent = 'Link kopieren';
}
$('#qr-copy').onclick = async () => { await api.call('copyUrl'); $('#qr-copy').textContent = 'Kopiert'; };
$('#qr-ok').onclick = () => closeOverlay();
$('#remote-tag').onclick = () => api.call('openSettings', 'remote');
$('#focus-tag').onclick = () => api.call('openSettings', 'focus');
$('#note-text').oninput = () => { clearTimeout(noteT); noteT = setTimeout(saveNote, 600); $('#note-del').hidden = !$('#note-text').value; };
$('#note-ok').onclick = () => closeOverlay();
$('#note-del').onclick = () => { $('#note-text').value = ''; closeOverlay(); };
$('#streamer-ind').onclick = () => api.call('streamerToggle');
document.addEventListener('keydown', e => { if (e.key === 'Escape' && e.shiftKey) { e.preventDefault(); openPanel('performance'); } });

function timeAgo(ts) {
  if (!ts) return 'noch nie';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  return new Date(ts).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}


