// Gaming-Modus: Spiele erkennen, Priorität senken und wiederherstellen
const assert = require('assert');
const G = require('../lib/gaming');
const P = (name, path) => ({ name, path });
assert.equal(G.findGame([P('chrome', 'C:\\Program Files\\Google\\chrome.exe'), P('explorer', 'C:\\Windows\\explorer.exe')]), null);
assert.equal(G.findGame([P('cs2', 'D:\\Spiele\\cs2.exe')]), 'cs2', 'bekannter Name');
assert.equal(G.findGame([P('Hades', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Hades\\x64\\Hades.exe')]), 'Hades', 'Steam-Ordner');
assert.equal(G.findGame([P('UnityCrashHandler64', 'C:\\Steam\\steamapps\\common\\X\\UnityCrashHandler64.exe')]), null, 'Hilfsprogramm ist kein Spiel');
assert.equal(G.findGame([P('EpicGamesLauncher', 'C:\\Program Files\\Epic Games\\Launcher\\EpicGamesLauncher.exe')]), null, 'Launcher ist kein Spiel');
assert.equal(G.findGame([P('meinspiel', 'C:\\x\\meinspiel.exe')], ['MeinSpiel.exe']), 'meinspiel', 'eigene Spiele');

(async () => {
  let procs = [], prio = [], prefs = { gaming: true };
  const events = [];
  const w = new G.GameWatch({ getPrefs: () => prefs, setPriority: low => prio.push(low), lister: async () => procs });
  w.on('change', e => events.push(e));
  await w.check(); assert.deepEqual(prio, []); assert.equal(w.active, false);
  procs = [P('r5apex', 'C:\\x\\r5apex.exe')];
  await w.check(); await w.check();
  assert.equal(w.game, 'r5apex'); assert.deepEqual(prio, [true, true], 'niedrig, bei jeder Prüfung erneut');
  assert.equal(events.length, 1); assert.equal(events[0].started, true);
  procs = [];
  await w.check(); assert.deepEqual(prio, [true, true, false], 'Spiel beendet → wieder normal'); assert.equal(events[1].active, false);
  await w.check(); assert.equal(prio.length, 3);
  procs = [P('cs2', '')]; prefs = { gaming: false };
  await w.check(); assert.equal(w.active, false, 'ausgeschaltet');
  // Echte Priorität für den eigenen Prozess (unter Linux/Windows erlaubt: niedriger setzen)
  assert.equal(G.setProcessPriority([process.pid], true), 1);
  console.log('Gaming-Modus ok');
})().catch(e => { console.error(e.stack); process.exit(1); });
