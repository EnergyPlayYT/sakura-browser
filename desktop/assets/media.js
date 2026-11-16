/* Sakura – Video und Ton: Kino-Modus, Helligkeit, Bass-/Dialog-Verstärker, Equalizer, Sleep-Timer „Ende der Folge“.
 * Wird bei Bedarf in die Seite geladen. Sakura ruft window.__sakuraMedia.apply({...}) auf.
 * Gemeinsame Datei: nach android/app/src/main/assets/ kopieren! */
(function () {
  if (window.__sakuraMedia) return;
  const EQ_FREQ = [60, 250, 1000, 4000, 12000];
  const audio = new WeakMap(); // Medien-Element → { ctx, bass, dialog, eq[] }
  let state = { cinema: false, brightness: 100, bass: 0, dialog: false, eq: [0, 0, 0, 0, 0] };

  const mainVideo = () => {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area) { area = a; best = v; }
    }
    return best;
  };
  const media = () => [...document.querySelectorAll('video, audio')];

  // ---------- Kino-Modus und Helligkeit (nur Darstellung)
  let styleEl = null;
  function applyLook() {
    const v = mainVideo();
    for (const el of document.querySelectorAll('[data-sakura-cinema]')) if (el !== v) el.removeAttribute('data-sakura-cinema');
    if (!styleEl || !styleEl.isConnected) {
      styleEl = document.createElement('style');
      styleEl.id = 'sakura-media-style';
      (document.head || document.documentElement).appendChild(styleEl);
    }
    const b = Math.max(30, Math.min(200, Number(state.brightness) || 100)) / 100;
    styleEl.textContent =
      (b !== 1 ? `video { filter: brightness(${b}) !important; }\n` : '') +
      (state.cinema ? `[data-sakura-cinema] { position: relative; z-index: 2147483646 !important; box-shadow: 0 0 0 200vmax rgba(0, 0, 0, .9) !important; }\n` : '');
    if (v && state.cinema) v.setAttribute('data-sakura-cinema', '');
  }

  // ---------- Ton (Web Audio)
  const audioActive = () => state.bass || state.dialog || state.eq.some(g => g);
  /** Kann der Ton dieses Elements bearbeitet werden, ohne dass er verstummt? */
  function audioBlocked(m) {
    if (m.mediaKeys) return 'Geschützte Videos (z. B. Netflix) lassen keine Ton-Bearbeitung zu.';
    const src = m.currentSrc || '';
    if (!src || src.startsWith('blob:') || src.startsWith('data:')) return null;
    try {
      const u = new URL(src, location.href);
      if (u.origin !== location.origin && !m.crossOrigin) return 'Der Ton kommt von einer anderen Seite und lässt sich hier nicht bearbeiten.';
    } catch (e) {}
    return null;
  }
  function chain(m) {
    let a = audio.get(m);
    if (a) return a;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const src = ctx.createMediaElementSource(m);
    const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 120;
    const dialog = ctx.createBiquadFilter(); dialog.type = 'peaking'; dialog.frequency.value = 2500; dialog.Q.value = 0.8;
    const eq = EQ_FREQ.map((f, i) => {
      const n = ctx.createBiquadFilter();
      n.type = i === 0 ? 'lowshelf' : i === EQ_FREQ.length - 1 ? 'highshelf' : 'peaking';
      n.frequency.value = f; n.Q.value = 1;
      return n;
    });
    // Dialog: Stimmen hervorheben, Bassdröhnen etwas zurück
    const dialogLow = ctx.createBiquadFilter(); dialogLow.type = 'lowshelf'; dialogLow.frequency.value = 200;
    let node = src;
    for (const n of [bass, dialogLow, dialog, ...eq]) { node.connect(n); node = n; }
    node.connect(ctx.destination);
    a = { ctx, bass, dialog, dialogLow, eq };
    audio.set(m, a);
    m.addEventListener('play', () => { if (ctx.state === 'suspended') ctx.resume(); });
    return a;
  }
  function applyAudio() {
    const notes = [];
    if (!audioActive()) {
      // Bereits verbundene Elemente auf neutral stellen (trennen geht nicht)
      for (const m of media()) { const a = audio.get(m); if (a) setGains(a); }
      return notes;
    }
    for (const m of media()) {
      const why = audio.get(m) ? null : audioBlocked(m);
      if (why) { notes.push(why); continue; }
      try { setGains(chain(m)); } catch (e) { notes.push('Der Ton lässt sich hier nicht bearbeiten.'); }
    }
    return [...new Set(notes)];
  }
  function setGains(a) {
    const t = a.ctx.currentTime;
    a.bass.gain.setTargetAtTime(Number(state.bass) || 0, t, 0.05);
    a.dialog.gain.setTargetAtTime(state.dialog ? 6 : 0, t, 0.05);
    a.dialogLow.gain.setTargetAtTime(state.dialog ? -4 : 0, t, 0.05);
    a.eq.forEach((n, i) => n.gain.setTargetAtTime(Number(state.eq[i]) || 0, t, 0.05));
    if (a.ctx.state === 'suspended') a.ctx.resume().catch(() => {});
  }

  // ---------- Sleep-Timer „Ende der Folge“
  let sleepEnd = false, sleptAt = 0;
  function pauseAll() { for (const m of media()) { try { m.pause(); } catch (e) {} } }
  document.addEventListener('ended', e => {
    if (!sleepEnd || !(e.target instanceof HTMLMediaElement)) return;
    sleepEnd = false; sleptAt = Date.now();
    window.__sakuraNoNext = true; // video.js startet keine nächste Folge
    pauseAll();
  }, true);
  // Startet die Seite selbst die nächste Folge, gleich wieder anhalten
  document.addEventListener('play', e => {
    if (sleptAt && Date.now() - sleptAt < 120000 && e.target instanceof HTMLMediaElement) e.target.pause();
  }, true);

  // Neue Videos (z. B. nächste Folge) bekommen dieselben Einstellungen
  document.addEventListener('play', () => { if (audioActive()) applyAudio(); if (state.cinema) applyLook(); }, true);

  window.__sakuraMedia = {
    apply(next) {
      state = { ...state, ...next, eq: (next && Array.isArray(next.eq) ? next.eq : state.eq).slice(0, 5) };
      applyLook();
      const notes = applyAudio();
      return { hasVideo: !!mainVideo(), hasMedia: media().length > 0, notes };
    },
    sleepAtEnd(on) { sleepEnd = !!on; if (!on) { sleptAt = 0; window.__sakuraNoNext = false; } return true; },
    pauseAll() { pauseAll(); return true; },
    info() { return { hasVideo: !!mainVideo(), hasMedia: media().length > 0 }; }
  };
})();
