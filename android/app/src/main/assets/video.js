/* Sakura – Videos und Serien: weiterschauen, wo man war; Intro/Rückblick überspringen; nächste Folge automatisch.
 * Läuft auf allen Webseiten (auch in eingebetteten Rahmen). Einstellungen über window.__sakuraVideoConfig.
 * Positionen speichert Sakura selbst (window.sakuraVideo, nur im Hauptrahmen am PC) – sonst im Speicher der Seite.
 * Gemeinsame Datei: nach android/app/src/main/assets/ kopieren! */
(function () {
  if (window.__sakuraVideo) { window.__sakuraVideo.refresh(); return; }
  const cfg = () => window.__sakuraVideoConfig || { resume: true, intro: true, next: true };
  const MIN_LEN = 120;      // nur Videos ab 2 Minuten merken
  const MIN_POS = 30;       // erst ab 30 Sekunden lohnt sich das Weiterschauen
  const END_GAP = 60;       // in der letzten Minute gilt das Video als fertig geschaut

  const INTRO = [
    '[data-uia="player-skip-intro"]', '[data-uia="player-skip-recap"]', '[data-uia="player-skip-preplay"]',   // Netflix
    '.atvwebplayersdk-skipelement-button',                                                                      // Prime Video
    '.skip__button', 'button[data-testid="skip-intro-button"]', 'button[data-testid="skip-recap-button"]',     // Disney+
    '[data-testid="skipIntroButton"]', '.skip-intro-button', '.skip-recap-button', '.skipButton'
  ].join(',');
  const NEXT = [
    '[data-uia="next-episode-seamless-button"]', '[data-uia="next-episode-seamless-button-draining"]',          // Netflix
    '.atvwebplayersdk-nextupcard-button',                                                                       // Prime Video
    'button[data-testid="up-next-play-button"]', '[data-testid="next-episode-button"]', '.up-next__button'
  ].join(',');
  const INTRO_TEXT = /^(intro|vorspann|rückblick|recap|opening|abspann|credits) (überspringen|skip)|^skip (intro|recap|opening|credits)$/i;
  const NEXT_TEXT = /^(nächste (folge|episode)( (ansehen|abspielen))?|next episode|play next( episode)?|weiter zur nächsten folge)$/i;

  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().replace(/[.!…]+$/, '');
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  };
  const fmt = s => {
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  };

  // ---------- Speicher: bei Sakura (PC) oder im Speicher der Seite
  const LS = '__sakura_video_pos';
  const store = {
    async get() {
      if (window.sakuraVideo) return window.sakuraVideo.get();
      try { return (JSON.parse(localStorage.getItem(LS) || '{}'))[location.pathname + location.search] || null; } catch (e) { return null; }
    },
    set(t, d) {
      if (window.sakuraVideo) return window.sakuraVideo.set(t, d);
      try {
        const all = JSON.parse(localStorage.getItem(LS) || '{}');
        const k = location.pathname + location.search;
        if (t == null) delete all[k]; else all[k] = { t, d, at: Date.now() };
        const keys = Object.keys(all);
        if (keys.length > 100) keys.sort((a, b) => all[a].at - all[b].at).slice(0, keys.length - 100).forEach(x => delete all[x]);
        localStorage.setItem(LS, JSON.stringify(all));
      } catch (e) {}
    }
  };

  // ---------- Hinweis „Weiter bei …“ mit „Von vorn“
  function toast(text, action, onAction) {
    const old = document.getElementById('sakura-video-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.id = 'sakura-video-toast';
    el.setAttribute('style', 'position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:2147483647;display:flex;gap:14px;align-items:center;' +
      'padding:9px 10px 9px 16px;border-radius:10px;background:rgba(28,26,51,.92);color:#EEE7E2;font:500 14px/1.3 "Segoe UI",Roboto,sans-serif;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.35);transition:opacity .3s');
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.textContent = action;
      b.setAttribute('style', 'all:unset;cursor:pointer;padding:5px 10px;border-radius:7px;background:#F2B3C5;color:#16142A;font-weight:600');
      b.addEventListener('click', e => { e.stopPropagation(); onAction(); el.remove(); });
      el.appendChild(b);
    }
    (document.fullscreenElement || document.body || document.documentElement).appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 400); }, 6000);
  }

  // ---------- Weiterschauen
  const hooked = new WeakSet();
  function mainVideo() {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area) { area = a; best = v; }
    }
    return best;
  }
  function hook(v) {
    if (!v || hooked.has(v)) return;
    hooked.add(v);
    let lastSave = 0, resumedFor = null;
    const long = () => isFinite(v.duration) && v.duration >= MIN_LEN;
    const tryResume = async () => {
      if (!cfg().resume || !long() || resumedFor === v.currentSrc) return;
      resumedFor = v.currentSrc;
      if (/[?&#](t|start|time_continue)=/.test(location.href) || v.currentTime > MIN_POS) return; // Seite springt schon selbst
      const pos = await store.get();
      if (!pos || !(pos.t > MIN_POS) || pos.t > v.duration - END_GAP || (pos.d && Math.abs(pos.d - v.duration) > 5)) return;
      v.currentTime = pos.t;
      toast('Weiter bei ' + fmt(pos.t), 'Von vorn', () => { v.currentTime = 0; store.set(null); });
    };
    v.addEventListener('loadedmetadata', tryResume);
    v.addEventListener('playing', tryResume);
    v.addEventListener('timeupdate', () => {
      if (!cfg().resume || !long() || Date.now() - lastSave < 5000) return;
      lastSave = Date.now();
      if (v.currentTime > v.duration - END_GAP) store.set(null);
      else if (v.currentTime > MIN_POS) store.set(Math.floor(v.currentTime), Math.round(v.duration));
    });
    v.addEventListener('ended', () => { if (long()) store.set(null); });
    if (v.readyState > 0) tryResume();
  }

  // ---------- Intro überspringen / nächste Folge
  let lastClick = 0;
  function clickFirst(selector, textRe) {
    if (Date.now() - lastClick < 2500) return false;
    let el = selector ? [...document.querySelectorAll(selector)].find(visible) : null;
    if (!el && textRe) {
      for (const b of document.querySelectorAll('button, [role="button"]')) {
        const t = norm(b.innerText || b.getAttribute('aria-label'));
        if (t.length < 40 && textRe.test(t) && visible(b)) { el = b; break; }
      }
    }
    if (!el) return false;
    lastClick = Date.now();
    try { el.click(); } catch (e) {}
    return true;
  }
  function tick() {
    const v = mainVideo();
    hook(v);
    if (!v || v.paused && !v.ended) return;
    const c = cfg();
    if (c.intro !== false && clickFirst(INTRO, INTRO_TEXT)) toast('Intro übersprungen');
    // Nächste Folge nur kurz vor Schluss – sonst könnte ein Link auf der Seite zu früh weiterschalten
    const nearEnd = v.ended || (isFinite(v.duration) && v.duration >= MIN_LEN && v.currentTime > v.duration - 90);
    if (c.next !== false && nearEnd && clickFirst(NEXT, NEXT_TEXT)) toast('Nächste Folge');
  }
  const timer = setInterval(tick, 1000);
  document.addEventListener('play', e => { if (e.target instanceof HTMLVideoElement) hook(e.target); }, true);
  window.__sakuraVideo = { refresh: tick, stop: () => clearInterval(timer) };
  tick();
})();
