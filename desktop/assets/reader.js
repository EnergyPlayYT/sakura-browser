/* Sakura – Lesemodus: macht aus der Seite einen ruhigen Artikel (Mozilla Readability).
 * Läuft in einer abgeschotteten Welt der Seite; Readability muss vorher geladen sein (window.__sakuraReadability).
 * Einstellungen: window.__sakuraReaderPrefs = { size, theme }  ·  Änderungen meldet die Seite per Ereignis „sakura-reader-prefs“. */
(function () {
  if (document.documentElement.hasAttribute('data-sakura-reader')) return 'schon';
  const R = window.__sakuraReadability;
  if (!R) return false;
  let art = null;
  try { art = new R(document.cloneNode(true), { charThreshold: 250, serializer: el => el }).parse(); } catch (e) { art = null; }
  if (!art || !art.content || (art.textContent || '').trim().length < 250) return false;

  const prefs = Object.assign({ size: 20, theme: 'sepia' }, window.__sakuraReaderPrefs || {});
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const save = () => document.dispatchEvent(new CustomEvent('sakura-reader-prefs', { detail: JSON.stringify(prefs) }));

  // Alte Seite ausräumen: Stile und Inhalte weg, Text bleibt im Artikel
  for (const n of document.querySelectorAll('link[rel~="stylesheet"], style')) n.remove();
  const body = el('body');
  const bar = el('div', 'sr-bar');
  const btn = (label, title, fn) => { const b = el('button', '', label); b.title = title; b.addEventListener('click', fn); bar.appendChild(b); return b; };
  btn('A−', 'Kleinere Schrift', () => { prefs.size = Math.max(14, prefs.size - 2); apply(); save(); });
  btn('A+', 'Größere Schrift', () => { prefs.size = Math.min(32, prefs.size + 2); apply(); save(); });
  for (const [t, label] of [['hell', 'Hell'], ['sepia', 'Sepia'], ['dunkel', 'Dunkel']]) btn(label, 'Farben: ' + label, () => { prefs.theme = t; apply(); save(); }).dataset.theme = t;
  let speaking = false;
  const speak = btn('Vorlesen', 'Artikel vorlesen', () => {
    if (!window.speechSynthesis) return;
    if (speaking) { speechSynthesis.cancel(); speaking = false; speak.textContent = 'Vorlesen'; return; }
    const u = new SpeechSynthesisUtterance((art.title ? art.title + '. ' : '') + art.textContent.replace(/\s+/g, ' ').slice(0, 30000));
    u.lang = document.documentElement.lang || 'de-DE';
    u.onend = () => { speaking = false; speak.textContent = 'Vorlesen'; };
    speechSynthesis.speak(u); speaking = true; speak.textContent = 'Stopp';
  });
  const close = btn('Lesemodus beenden', 'Zur normalen Seite zurück', () => { if (window.speechSynthesis) speechSynthesis.cancel(); location.reload(); });
  close.className = 'sr-close';
  body.appendChild(bar);

  const main = el('main', 'sr-main');
  const site = el('div', 'sr-site', art.siteName || location.hostname.replace(/^www\./, ''));
  main.appendChild(site);
  // Beginnt der Artikel selbst mit einer Überschrift, diese als Titel nehmen (sonst stünde er doppelt da)
  const firstText = [...art.content.querySelectorAll('*')].find(n => n.children.length === 0 && n.textContent.trim());
  const ownHead = firstText && firstText.closest('h1, h2');
  const titleText = ownHead ? ownHead.textContent.trim() : (art.title || document.title);
  if (ownHead) ownHead.remove();
  main.appendChild(el('h1', 'sr-title', titleText));
  const minutes = Math.max(1, Math.round((art.textContent || '').split(/\s+/).length / 220));
  main.appendChild(el('div', 'sr-meta', [art.byline, `${minutes} Min. Lesezeit`].filter(Boolean).join(' · ')));
  // Erst im losgelösten Dokument aufräumen (dort lädt und läuft nichts), dann übernehmen:
  // nichts Ausführbares, keine Formulare, keine Ereignis-Attribute, keine javascript:-Links
  const raw = art.content;
  for (const n of raw.querySelectorAll('script, iframe, object, embed, form, input, button, textarea, select, link, meta, style')) n.remove();
  for (const n of [raw, ...raw.querySelectorAll('*')]) for (const a of [...n.attributes]) {
    if (/^on/i.test(a.name) || (/^(href|src|action|formaction|xlink:href)$/i.test(a.name) && /^\s*javascript:/i.test(a.value))) n.removeAttribute(a.name);
  }
  const content = document.importNode(raw, true);
  content.classList.add('sr-content');
  for (const a of content.querySelectorAll('a[href]')) { a.target = '_blank'; a.rel = 'noopener'; }
  main.appendChild(content);
  body.appendChild(main);
  document.body.replaceWith(body);
  document.documentElement.setAttribute('data-sakura-reader', '');
  window.scrollTo(0, 0);

  function apply() {
    document.documentElement.setAttribute('data-sr-theme', prefs.theme);
    document.documentElement.style.setProperty('--sr-size', prefs.size + 'px');
    for (const b of bar.querySelectorAll('[data-theme]')) b.classList.toggle('on', b.dataset.theme === prefs.theme);
  }
  apply();
  return true;
})()
