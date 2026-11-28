/* Sakura – Designs (Farben für Oberfläche, Startseite und Titelleiste)
 * Gemeinsame Datei für PC (main.js, sakura://newtab) und Android (newtab.html, manage.html).
 * Nach Änderungen nach android/app/src/main/assets/ kopieren! */
(function (root) {
  // yoru = Grundfläche, kasumi = Leisten, fukai = Eingabefelder, washi = Text, usuzumi = Nebentext,
  // accent = Akzent, pop = Menüs, panel = Seitenleiste, sky = Himmel der Startseite (oben, Mitte, unten)
  const THEMES = [
    { id: 'sakura', label: 'Sakura', dark: true, yoru: '#1C1A33', kasumi: '#28254A', fukai: '#16142A', washi: '#EEE7E2', usuzumi: '#A59EB8', accent: '#F2B3C5', pop: '#2C2950', panel: '#221F3E', sky: ['#16142C', '#25214A', '#3A2B55'], moon: '#F1E6DC', hill: '#100E22', branch: '#0E0C1D' },
    { id: 'yoru', label: 'Yoru – Mitternacht', dark: true, yoru: '#10152A', kasumi: '#1A2142', fukai: '#0B0F20', washi: '#E6EAF4', usuzumi: '#8F99B8', accent: '#8FB8F2', pop: '#212A50', panel: '#181F3C', sky: ['#060914', '#111A38', '#22305A'], moon: '#E8EEF8', hill: '#070A18', branch: '#05070F' },
    { id: 'momiji', label: 'Momiji – Herbst', dark: true, yoru: '#271815', kasumi: '#382320', fukai: '#1E110E', washi: '#F3E7DD', usuzumi: '#BBA195', accent: '#F0905F', pop: '#45291F', panel: '#321E1A', sky: ['#1C100D', '#3A1F19', '#62301F'], moon: '#F6DFC4', hill: '#160C0A', branch: '#120806' },
    { id: 'matcha', label: 'Matcha', dark: true, yoru: '#17221B', kasumi: '#213127', fukai: '#111A14', washi: '#EAF0E4', usuzumi: '#9CB09E', accent: '#A9D68C', pop: '#2A3D30', panel: '#1D2B22', sky: ['#0E1812', '#1B2D21', '#304A35'], moon: '#EEF2DC', hill: '#0B140E', branch: '#08100A' },
    { id: 'fuji', label: 'Fuji – Lila', dark: true, yoru: '#211A35', kasumi: '#30264B', fukai: '#19132A', washi: '#F0E9F6', usuzumi: '#ADA1C4', accent: '#C6A8F4', pop: '#3A2E5C', panel: '#2A2143', sky: ['#160F2A', '#2B2052', '#4A366C'], moon: '#F1EAF8', hill: '#120C22', branch: '#0D0918' },
    { id: 'sumi', label: 'Sumi – Schwarz-Weiß', dark: true, yoru: '#151515', kasumi: '#232323', fukai: '#0D0D0D', washi: '#EDEDED', usuzumi: '#9B9B9B', accent: '#E6E6E6', pop: '#2B2B2B', panel: '#1E1E1E', sky: ['#0A0A0A', '#191919', '#2C2C2C'], moon: '#F2F2F2', hill: '#080808', branch: '#050505' },
    { id: 'washi', label: 'Washi – Hell', dark: false, yoru: '#EAE2D8', kasumi: '#F8F4EE', fukai: '#FFFFFF', washi: '#2B2433', usuzumi: '#6F6678', accent: '#C94A6E', pop: '#FFFFFF', panel: '#F8F4EE', sky: ['#F7EDE6', '#F3DDE2', '#E9C9D5'], moon: '#FFFFFF', hill: '#D9C4CC', branch: '#4A3A40' },
    { id: 'yuki', label: 'Yuki – Winter', dark: true, yoru: '#151C2B', kasumi: '#1F293D', fukai: '#0F1520', washi: '#EEF3F8', usuzumi: '#9AA8BD', accent: '#BFDDF5', pop: '#26324A', panel: '#1A2334', sky: ['#0C111C', '#1A2438', '#2E3D58'], moon: '#F4F8FC', hill: '#0A0E17', branch: '#070A11' },
    { id: 'natsu', label: 'Natsu – Sommer', dark: true, yoru: '#12202A', kasumi: '#1B2E3A', fukai: '#0D1820', washi: '#EAF3F2', usuzumi: '#93ADB0', accent: '#7FD6C2', pop: '#223845', panel: '#172832', sky: ['#0A1620', '#163042', '#2B5060'], moon: '#FFF1C9', hill: '#08121A', branch: '#050D12' },
    { id: 'neon', label: 'Neon – Synthwave', dark: true, yoru: '#150B28', kasumi: '#231042', fukai: '#0D061A', washi: '#F6EAFF', usuzumi: '#A992CB', accent: '#FF4FD8', pop: '#2E1656', panel: '#1E0E3A', sky: ['#0A0320', '#2A0B4C', '#7A1C72'], moon: '#FFD36E', hill: '#0B0418', branch: '#07020F' }
  ];
  const BY_ID = Object.fromEntries(THEMES.map(t => [t.id, t]));
  // „Jahreszeiten“: Frühling Sakura, Sommer Natsu, Herbst Momiji, Winter Yuki – nachts etwas dunkler
  const SEASONS = { spring: 'sakura', summer: 'natsu', autumn: 'momiji', winter: 'yuki' };
  function seasonOf(now) {
    const m = new Date(now == null ? Date.now() : now).getMonth() + 1;
    return m >= 3 && m <= 5 ? 'spring' : m >= 6 && m <= 8 ? 'summer' : m >= 9 && m <= 11 ? 'autumn' : 'winter';
  }
  function isNight(now) { const h = new Date(now == null ? Date.now() : now).getHours(); return h >= 21 || h < 6; }

  const isHex = c => /^#[0-9a-f]{6}$/i.test(String(c || ''));
  const rgb = c => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const hex = a => '#' + a.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const mix = (a, b, t) => { const x = rgb(a), y = rgb(b); return hex(x.map((v, i) => v + (y[i] - v) * t)); };
  const rgbStr = c => rgb(c).join(', ');

  /** Fertiges Design aus den Einstellungen: { id, dark, colors, vars, scene } */
  function resolve(prefs, now) {
    prefs = prefs || {};
    const auto = prefs.theme === 'jahreszeit';
    const season = auto ? seasonOf(now) : prefs.theme === 'momiji' ? 'autumn' : prefs.theme === 'yuki' ? 'winter' : prefs.theme === 'natsu' ? 'summer' : 'spring';
    let t = auto ? BY_ID[SEASONS[season]] : (BY_ID[prefs.theme] || BY_ID.sakura);
    if (auto && isNight(now)) { // Nacht: Flächen und Himmel dunkler, wärmerer Mond
      const d = c => mix(c, '#000000', .28);
      t = { ...t, yoru: d(t.yoru), kasumi: d(t.kasumi), fukai: d(t.fukai), pop: d(t.pop), panel: d(t.panel), sky: t.sky.map(d), moon: mix(t.moon, '#FFD9A0', .35) };
    }
    const accent = isHex(prefs.accent) ? prefs.accent.toUpperCase() : t.accent;
    const err = t.dark ? '#FFB4C0' : '#B3263F';
    const vars = {
      '--yoru': t.yoru, '--kasumi': t.kasumi, '--fukai': t.fukai, '--washi': t.washi, '--usuzumi': t.usuzumi,
      '--sakura': accent, '--pop': t.pop, '--panel': t.panel, '--err': err,
      '--washi-rgb': rgbStr(t.washi), '--sakura-rgb': rgbStr(accent), '--fukai-rgb': rgbStr(t.fukai), '--yoru-rgb': rgbStr(t.yoru),
      '--kasumi-rgb': rgbStr(t.kasumi), '--pop-rgb': rgbStr(t.pop), '--panel-rgb': rgbStr(t.panel)
    };
    // Blütenfarben: Akzent, heller und dunkler
    const scene = {
      sky: t.sky, moon: t.moon, hill: t.hill, branch: t.branch, star: t.dark ? '#EEE7E2' : '#FFFFFF',
      petals: [accent, mix(accent, '#FFFFFF', .45), mix(accent, t.dark ? '#7A1E3C' : '#5A1028', .35)],
      center: mix(accent, '#5A1028', .55),
      // Was auf der Startseite fällt: Blüten, Glühwürmchen, Ahornblätter oder Schnee
      fall: season === 'summer' ? 'fireflies' : season === 'autumn' ? 'leaves' : season === 'winter' ? 'snow' : 'petals',
      night: auto && isNight(now)
    };
    return { id: auto ? 'jahreszeit' : t.id, label: t.label, dark: t.dark, accent, colors: { ...t, accent }, vars, scene };
  }

  /** Setzt die Farben als CSS-Variablen (z. B. auf document.documentElement) */
  function apply(el, prefs) {
    const r = resolve(prefs);
    for (const [k, v] of Object.entries(r.vars)) el.style.setProperty(k, v);
    el.style.colorScheme = r.dark ? 'dark' : 'light';
    return r;
  }

  const list = THEMES.map(t => ({ id: t.id, label: t.label, accent: t.accent, yoru: t.yoru }));
  list.splice(1, 0, { id: 'jahreszeit', label: 'Jahreszeiten – wechselt von selbst', accent: BY_ID[SEASONS[seasonOf()]].accent, yoru: BY_ID[SEASONS[seasonOf()]].yoru });
  const api = { list, resolve, apply, isHex, seasonOf };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SakuraThemes = api;
})(this);
