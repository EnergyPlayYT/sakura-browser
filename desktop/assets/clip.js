/* Sakura – Clip-Knopf: speichert die letzten 30 Sekunden eines Videos/Streams.
 * Solange „Clip bereit“ an ist, laufen zwei Aufnahmen versetzt (je 60 Sek., um 30 Sek. verschoben).
 * So gibt es immer eine vollständige Aufnahme, die mindestens die letzten 30 Sekunden enthält.
 * Gespeichert wird als .webm über den normalen Download (landet im Download-Ordner). */
(function () {
  if (window.__sakuraClip) return;
  const CYCLE = 60000, OFFSET = 30000;
  let video = null, slots = [], timer = null, armedAt = 0;

  const mainVideo = () => {
    let best = null, area = 0;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect(), a = r.width * r.height;
      if (a > area && !v.paused) { area = a; best = v; }
    }
    if (best) return best;
    for (const v of document.querySelectorAll('video')) { const r = v.getBoundingClientRect(); if (r.width * r.height > area) { area = r.width * r.height; best = v; } }
    return best;
  };
  const mime = () => ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';

  function startSlot(i) {
    let stream;
    try { stream = (video.captureStream || video.mozCaptureStream).call(video); } catch (e) { return false; }
    const rec = new MediaRecorder(stream, { mimeType: mime(), videoBitsPerSecond: 3000000 });
    const slot = { rec, chunks: [], startedAt: Date.now(), keep: false };
    rec.ondataavailable = e => { if (e.data && e.data.size) slot.chunks.push(e.data); };
    rec.onstop = () => { if (slot.onDone) slot.onDone(slot); };
    rec.start(1000);
    slots[i] = slot;
    return true;
  }
  function stopSlot(i, cb) {
    const s = slots[i];
    if (!s) return;
    slots[i] = null;
    s.onDone = cb || null;
    try { if (s.rec.state !== 'inactive') s.rec.stop(); else if (cb) cb(s); } catch (e) {}
  }
  function tick() {
    if (!video || !video.isConnected) { disarm(); return; }
    const now = Date.now();
    // zweite Aufnahme 30 Sek. nach der ersten starten, danach jede nach 60 Sek. erneuern
    if (!slots[1] && now - armedAt >= OFFSET) startSlot(1);
    for (const i of [0, 1]) if (slots[i] && now - slots[i].startedAt >= CYCLE) { stopSlot(i); startSlot(i); }
  }
  function disarm() {
    clearInterval(timer); timer = null;
    for (const i of [0, 1]) stopSlot(i);
    slots = []; video = null;
  }
  function download(blob, seconds) {
    const d = new Date(), z = n => String(n).padStart(2, '0');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Sakura-Clip ${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())} ${z(d.getHours())}.${z(d.getMinutes())}.${z(d.getSeconds())}.webm`;
    document.documentElement.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  window.__sakuraClip = {
    arm(on) {
      if (!on) { disarm(); return { armed: false }; }
      if (timer) return { armed: true };
      if (!window.MediaRecorder) return { error: 'Aufnehmen wird hier nicht unterstützt.' };
      video = mainVideo();
      if (!video) return { error: 'Auf dieser Seite läuft kein Video.' };
      if (video.mediaKeys) { video = null; return { error: 'Geschützte Videos (z. B. Netflix) lassen sich nicht aufnehmen.' }; }
      armedAt = Date.now();
      if (!startSlot(0)) { video = null; return { error: 'Dieses Video lässt sich nicht aufnehmen (es kommt von einer anderen Seite).' }; }
      timer = setInterval(tick, 1000);
      return { armed: true };
    },
    status() { return { armed: !!timer, seconds: timer ? Math.round((Date.now() - armedAt) / 1000) : 0 }; },
    save() {
      if (!timer) return Promise.resolve({ error: 'Schalte zuerst „Clip bereit“ ein.' });
      // die am längsten laufende Aufnahme enthält die letzten 30 (bis 60) Sekunden
      const i = [0, 1].filter(k => slots[k]).sort((a, b) => slots[a].startedAt - slots[b].startedAt)[0];
      if (i == null) return Promise.resolve({ error: 'Gerade läuft keine Aufnahme.' });
      const secs = Math.round((Date.now() - slots[i].startedAt) / 1000);
      return new Promise(res => {
        stopSlot(i, s => {
          const blob = new Blob(s.chunks, { type: (s.rec.mimeType || 'video/webm').split(';')[0] });
          if (blob.size < 1000) { res({ error: 'Die Aufnahme ist leer – läuft das Video?' }); return; }
          download(blob, secs);
          res({ ok: true, seconds: secs });
        });
        startSlot(i); // weiter bereit für den nächsten Clip
      });
    }
  };
})();
