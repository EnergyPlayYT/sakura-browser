// Entscheidet, welche Hintergrund-Tabs automatisch schlafen gelegt werden.
// Regeln (Einstellungen):
//  sleepAfter  – Minuten ohne Benutzung, danach schläft ein Hintergrund-Tab (0 = nie)
//  ramLimit    – MB, die Sakura insgesamt höchstens belegen soll (0 = keine Grenze);
//                darüber schlafen die am längsten unbenutzten Tabs, bis es passt
//  cpuLimit    – Prozent CPU, die ein Hintergrund-Tab dauerhaft höchstens nutzen darf (0 = keine Grenze)
// Nie schlafen: der aktive Tab jedes Fensters, Tabs mit Ton, Tabs ohne Webseite.

const CPU_STRIKES = 3; // so oft hintereinander zu viel CPU, dann schläft der Tab

/**
 * tabs: [{ id, active, audible, sleeping, web, lastActive, mem (Bytes), cpu (%) }]
 * strikes: Map id → Anzahl Messungen über der CPU-Grenze (wird angepasst)
 * Ergebnis: [{ id, reason }]
 */
function pickTabsToSleep(tabs, prefs, now = Date.now(), totalMem = 0, strikes = new Map()) {
  const out = [];
  const chosen = new Set();
  const can = t => !t.active && !t.audible && !t.sleeping && t.web && !chosen.has(t.id);
  const take = (t, reason) => { chosen.add(t.id); out.push({ id: t.id, reason }); };

  const after = Number(prefs.sleepAfter) || 0;
  if (after > 0) {
    for (const t of tabs) if (can(t) && now - (t.lastActive || 0) >= after * 60e3) take(t, 'idle');
  }

  const cpuLimit = Number(prefs.cpuLimit) || 0;
  for (const t of tabs) {
    if (!cpuLimit || !can(t) || !(t.cpu > cpuLimit)) { strikes.delete(t.id); continue; }
    const n = (strikes.get(t.id) || 0) + 1;
    strikes.set(t.id, n);
    if (n >= CPU_STRIKES) { strikes.delete(t.id); take(t, 'cpu'); }
  }

  const ramLimit = (Number(prefs.ramLimit) || 0) * 1024 * 1024;
  if (ramLimit && totalMem > ramLimit) {
    let over = totalMem - ramLimit;
    const lru = tabs.filter(can).sort((a, b) => (a.lastActive || 0) - (b.lastActive || 0));
    for (const t of lru) {
      if (over <= 0) break;
      take(t, 'ram');
      over -= t.mem || 0;
    }
  }
  return out;
}

module.exports = { pickTabsToSleep, CPU_STRIKES };
