/* Sakura – Twitch „Nur Ton“: schaltet den Player auf die reine Audio-Spur (oder die kleinste
 * Qualität) und blendet das Bild aus. Aufruf: window.__sakuraTwitchAudio(true|false) → Zustand */
(function () {
  if (window.__sakuraTwitchAudio) return;
  function player() {
    const el = document.querySelector('[data-a-target="video-player"]') || document.querySelector('.video-player');
    if (!el) return null;
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
    let f = key && el[key];
    for (let i = 0; f && i < 100; i++) {
      const p = f.memoizedProps;
      if (p && p.mediaPlayerInstance) return p.mediaPlayerInstance.core || p.mediaPlayerInstance;
      f = f.return;
    }
    return null;
  }
  function badge(on) {
    let b = document.getElementById('sakura-audio-only');
    if (!on) { if (b) b.remove(); document.documentElement.classList.remove('sakura-audio-only'); return; }
    document.documentElement.classList.add('sakura-audio-only');
    if (!document.getElementById('sakura-audio-style')) {
      const st = document.createElement('style');
      st.id = 'sakura-audio-style';
      st.textContent = 'html.sakura-audio-only [data-a-target="video-player"] video{opacity:0!important}' +
        '#sakura-audio-only{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:1;' +
        'font:600 15px/1.4 system-ui,sans-serif;letter-spacing:.04em;color:#F2B3C5;background:radial-gradient(circle,rgba(242,179,197,.12),rgba(28,26,51,.9))}';
      document.head.appendChild(st);
    }
    const host = document.querySelector('[data-a-target="video-player"]');
    if (host && !b) { b = document.createElement('div'); b.id = 'sakura-audio-only'; b.textContent = 'Nur Ton – Sakura spart Daten und Leistung'; host.appendChild(b); }
  }
  window.__sakuraTwitchAudio = function (on) {
    const pl = player();
    if (!pl && !document.querySelector('video')) return 'kein-player';
    let mode = 'versteckt';
    if (pl && typeof pl.getQualities === 'function') {
      try {
        const qs = pl.getQualities() || [];
        if (on) {
          if (!window.__sakuraPrevQuality && pl.getQuality) window.__sakuraPrevQuality = pl.getQuality();
          const audio = qs.find(q => q && (q.group === 'audio_only' || /audio/i.test(q.name || '')));
          const low = qs.filter(q => q && q.bitrate).sort((a, b) => a.bitrate - b.bitrate)[0];
          const pick = audio || low;
          if (pick) { pl.setQuality(pick); mode = audio ? 'audio' : 'klein'; }
        } else {
          const prev = window.__sakuraPrevQuality;
          window.__sakuraPrevQuality = null;
          if (typeof pl.setAutoSwitchQuality === 'function') pl.setAutoSwitchQuality(true);
          else if (prev) pl.setQuality(prev);
          mode = 'aus';
        }
      } catch {}
    }
    badge(on);
    return on ? mode : 'aus';
  };
})();
