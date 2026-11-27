/* Sakura – Bild-in-Bild per Knopf: Fährt die Maus über ein Video, erscheint oben rechts ein kleiner Knopf.
 * Ein Klick legt das Video in das kleine Bild-in-Bild-Fenster (nie automatisch). */
(function () {
  if (window.__sakuraPip || !document.pictureInPictureEnabled) return;
  window.__sakuraPip = true;
  let host = null, btn = null, current = null, hideT = null, lastMove = 0;

  function ensure() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;display:none;';
    const sr = host.attachShadow({ mode: 'closed' });
    sr.innerHTML = `<style>
      button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:6px;height:32px;padding:0 12px 0 10px;border-radius:16px;cursor:pointer;
        font:600 12px "Segoe UI",system-ui,sans-serif;color:#EEE7E2;background:rgba(28,26,51,.72);backdrop-filter:blur(12px);
        box-shadow:inset 0 1px 0 rgba(238,231,226,.18),0 0 0 1px rgba(238,231,226,.12),0 6px 18px rgba(0,0,0,.35);transition:transform .3s cubic-bezier(.34,1.36,.64,1),background .2s}
      button:hover{background:rgba(242,179,197,.85);color:#16142A} button:active{transform:scale(.94)}
      svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}</style>
      <button title="Bild-in-Bild"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12" y="11" width="7" height="6" rx="1" fill="currentColor"/></svg><span>Bild-in-Bild</span></button>`;
    btn = sr.querySelector('button');
    btn.addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      if (!e.isTrusted || !current) return;
      try {
        if (document.pictureInPictureElement === current) await document.exitPictureInPicture();
        else { current.disablePictureInPicture = false; await current.requestPictureInPicture(); }
      } catch (err) { /* manche Seiten sperren es */ }
      hide();
    });
    host.addEventListener('mouseenter', () => clearTimeout(hideT));
    document.documentElement.appendChild(host);
  }
  function hide() { if (host) host.style.display = 'none'; current = null; }
  function videoAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el instanceof HTMLVideoElement) return el;
      if (el === host) return current;
    }
    return null;
  }
  document.addEventListener('mousemove', e => {
    const now = Date.now();
    if (now - lastMove < 120) return;
    lastMove = now;
    const v = videoAt(e.clientX, e.clientY);
    if (!v) { clearTimeout(hideT); hideT = setTimeout(hide, 900); return; }
    const r = v.getBoundingClientRect();
    if (r.width < 200 || r.height < 110 || v.readyState < 1) return; // keine winzigen/leeren Videos
    clearTimeout(hideT);
    ensure();
    current = v;
    host.style.display = 'block';
    host.style.left = Math.round(Math.min(innerWidth - 140, r.right - 136)) + 'px';
    host.style.top = Math.round(Math.max(8, r.top + 10)) + 'px';
    btn.lastElementChild.textContent = document.pictureInPictureElement === v ? 'Zurückholen' : 'Bild-in-Bild';
    hideT = setTimeout(hide, 2500);
  }, { passive: true, capture: true });
  document.addEventListener('scroll', hide, true);
})();
