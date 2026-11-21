/* Sakura – Leseliste: Artikeltext für das Offline-Lesen herausziehen (nur reiner Text, keine Skripte/Bilder).
 * Läuft in der abgeschotteten Welt der Seite nach Readability. Ergebnis: { title, byline, site, blocks: [{ t: 'p'|'h'|'q'|'li', x: Text }] } */
(function () {
  const R = window.__sakuraReadability;
  let art = null;
  try { art = R ? new R(document.cloneNode(true), { charThreshold: 250, serializer: el => el }).parse() : null; } catch (e) { art = null; }
  const blocks = [];
  if (art && art.content) {
    for (const n of art.content.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, pre')) {
      if (n.closest('li') && n.tagName !== 'LI') continue;
      const x = n.textContent.replace(/\s+/g, ' ').trim();
      if (!x) continue;
      const t = /^H/.test(n.tagName) ? 'h' : n.tagName === 'LI' ? 'li' : n.tagName === 'BLOCKQUOTE' ? 'q' : 'p';
      blocks.push({ t, x: x.slice(0, 5000) });
      if (blocks.length >= 800) break;
    }
  }
  return {
    title: String((art && art.title) || document.title || '').slice(0, 300),
    byline: String((art && art.byline) || '').slice(0, 200),
    site: String((art && art.siteName) || location.hostname.replace(/^www\./, '')).slice(0, 100),
    blocks
  };
})()
