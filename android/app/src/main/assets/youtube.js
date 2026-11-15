/* Sakura – YouTube: Werbung überspringen, Sponsor-Abschnitte überspringen (SponsorBlock), Qualität festlegen.
 * Läuft auf youtube.com im Seitenkontext. Einstellungen kommen über window.__sakuraYTConfig.
 * Sponsor-Abschnitte liefert window.sakuraYT.segments(id) (PC) – sonst direkt von der SponsorBlock-API (Android).
 * Gemeinsame Datei: nach android/app/src/main/assets/ kopieren! */
(function () {
  if (window.__sakuraYT) { window.__sakuraYT.refresh(); return; }
  const cfg = () => window.__sakuraYTConfig || { quality: 'hd1080' };
  const ORDER = ['highres', 'hd2880', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];

  const SKIP_BUTTONS = [
    '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern', '.ytp-skip-ad-button', 'button.ytp-ad-skip-button-container',
    '.ytp-ad-overlay-close-button', '.ytm-skip-ad-button', 'button[id^="skip-button"]', '.videoAdUiSkipButton'
  ].join(',');

  const player = () => document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  const video = () => {
    const p = player();
    return (p && p.querySelector('video')) || document.querySelector('video.html5-main-video') || document.querySelector('video');
  };
  const videoId = () => {
    const u = new URL(location.href);
    const v = u.searchParams.get('v');
    if (v) return v;
    const m = /^\/(?:shorts|live|embed)\/([A-Za-z0-9_-]{11})/.exec(u.pathname);
    return m ? m[1] : null;
  };

  // ---------- Hinweis unten im Video („Sponsor übersprungen“)
  let toastEl = null, toastT = null;
  function toast(text) {
    const p = player() || document.body;
    if (!toastEl || !toastEl.isConnected) {
      toastEl = document.createElement('div');
      toastEl.setAttribute('style', 'position:absolute;left:50%;bottom:72px;transform:translateX(-50%);z-index:70;padding:7px 14px;border-radius:8px;' +
        'background:rgba(28,26,51,.88);color:#EEE7E2;font:500 13px/1.3 Roboto,"Segoe UI",sans-serif;pointer-events:none;transition:opacity .3s;opacity:0');
      p.appendChild(toastEl);
    }
    toastEl.textContent = text;
    toastEl.style.opacity = '1';
    clearTimeout(toastT);
    toastT = setTimeout(() => { if (toastEl) toastEl.style.opacity = '0'; }, 2200);
  }

  // ---------- Werbung
  let inAd = false, wasMuted = false, rateBefore = 1;
  function handleAds() {
    const p = player();
    const v = video();
    const ad = !!(p && (p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting')));
    for (const b of document.querySelectorAll(SKIP_BUTTONS)) { try { b.click(); } catch (e) {} }
    if (ad && v) {
      if (!inAd) { inAd = true; wasMuted = v.muted; rateBefore = v.playbackRate || 1; }
      v.muted = true;
      if (isFinite(v.duration) && v.duration > 0 && v.currentTime < v.duration - 0.2) {
        try { v.currentTime = v.duration - 0.1; } catch (e) {}
      }
      try { v.playbackRate = 16; } catch (e) {}
      if (v.paused) v.play && v.play().catch(() => {});
    } else if (!ad && inAd) {
      inAd = false; // Werbung vorbei → Ton und Tempo wie vorher
      if (v) { v.muted = wasMuted; try { v.playbackRate = rateBefore; } catch (e) {} }
    }
  }

  // ---------- Sponsor-Abschnitte
  let segs = [], segsFor = null, lastSkip = 0;
  async function loadSegments() {
    const id = videoId();
    if (!id || id === segsFor) return;
    segsFor = id; segs = [];
    if (cfg().sponsorblock === false) return;
    try {
      let list;
      if (window.sakuraYT && window.sakuraYT.segments) list = await window.sakuraYT.segments(id);
      else list = await fetchSegments(id);
      if (segsFor === id) segs = Array.isArray(list) ? list : [];
    } catch (e) { segs = []; }
  }
  async function fetchSegments(id) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
    const prefix = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 4);
    const cats = encodeURIComponent(JSON.stringify(['sponsor', 'selfpromo', 'interaction']));
    const r = await fetch('https://sponsor.ajay.app/api/skipSegments/' + prefix + '?categories=' + cats, { credentials: 'omit' });
    if (!r.ok) return [];
    const v = (await r.json()).find(x => x.videoID === id);
    const names = { sponsor: 'Sponsor', selfpromo: 'Eigenwerbung', interaction: 'Abo-Erinnerung' };
    return v ? v.segments.filter(s => (s.actionType || 'skip') === 'skip').map(s => ({ start: s.segment[0], end: s.segment[1], label: names[s.category] || 'Abschnitt' })) : [];
  }
  function handleSponsor() {
    const v = video();
    const p = player();
    if (!v || !segs.length || (p && p.classList.contains('ad-showing'))) return;
    const t = v.currentTime;
    for (const s of segs) {
      if (t >= s.start && t < s.end - 0.5 && Date.now() - lastSkip > 800) {
        lastSkip = Date.now();
        v.currentTime = s.end;
        toast((s.label || 'Sponsor') + ' übersprungen');
        return;
      }
    }
  }

  // ---------- Qualität
  let qualityFor = null;
  function setQuality() {
    const want = cfg().quality;
    const id = videoId();
    if (!want || want === 'auto' || !id || qualityFor === id) return;
    const p = player();
    if (!p || typeof p.getAvailableQualityLevels !== 'function' || (p.classList && p.classList.contains('ad-showing'))) return;
    const levels = p.getAvailableQualityLevels() || [];
    if (!levels.length) return;
    const wi = want === 'max' ? 0 : ORDER.indexOf(want);
    const q = levels.find(l => ORDER.indexOf(l) >= wi && l !== 'auto') || levels[0];
    try {
      if (typeof p.setPlaybackQualityRange === 'function') p.setPlaybackQualityRange(q, q);
      if (typeof p.setPlaybackQuality === 'function') p.setPlaybackQuality(q);
      qualityFor = id;
    } catch (e) {}
  }

  // ---------- Ablauf
  let hooked = null;
  function hookVideo() {
    const v = video();
    if (!v || v === hooked) return;
    hooked = v;
    v.addEventListener('timeupdate', () => { handleSponsor(); if (inAd || (player() && player().classList.contains('ad-showing'))) handleAds(); });
    v.addEventListener('loadedmetadata', () => { handleAds(); setTimeout(setQuality, 300); });
    v.addEventListener('playing', setQuality);
  }
  function refresh() {
    hookVideo();
    handleAds();
    loadSegments();
    setQuality();
  }
  // YouTube wechselt Videos ohne Seitenwechsel
  document.addEventListener('yt-navigate-finish', () => { qualityFor = null; refresh(); });
  document.addEventListener('yt-page-data-updated', refresh);
  window.addEventListener('state-navigateend', refresh); // m.youtube.com
  const obs = new MutationObserver(() => { hookVideo(); handleAds(); });
  let watched = null;
  const watch = () => { const p = player(); if (p && p !== watched) { watched = p; obs.observe(p, { attributes: true, attributeFilter: ['class'] }); } };
  setInterval(() => { watch(); hookVideo(); handleAds(); }, 1000);
  watch();
  window.__sakuraYT = { refresh: () => { watch(); refresh(); } };
  refresh();
})();
