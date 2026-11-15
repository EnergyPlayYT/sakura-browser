// Gaming-Modus: erkennt laufende Spiele und senkt dann Sakuras Priorität (und legt auf Wunsch Tabs schlafen).
// Erkennung: bekannte Programmnamen oder Programme aus typischen Spiele-Ordnern (Steam, Epic, Riot, Xbox …).
const { execFile } = require('child_process');
const os = require('os');
const { EventEmitter } = require('events');

const GAME_FOLDERS = /\\(steamapps\\common|Epic Games|Riot Games|XboxGames|GOG Galaxy\\Games|GOG Games|Ubisoft Game Launcher\\games|EA Games|Battle\.net\\.+\\_retail_|Rockstar Games)\\/i;
// Hilfsprogramme in diesen Ordnern, die keine Spiele sind
const NOT_GAMES = /^(unitycrashhandler(64)?|crashreport(er|client)|easyanticheat(_eos)?|beservice|vc_redist.*|dxsetup|uninst.*|launcher|epicgameslauncher|riotclientservices|riotclientux.*|steamwebhelper|steamservice|vgc|vgtray|eadesktop|eabackgroundservice|upc|uplaywebcore|ubisoftconnect|battle\.net|agent|bootstrapper|redprelauncher|rockstarservice|socialclubhelper|playgtav)$/i;
const KNOWN = [
  'cs2', 'csgo', 'valorant-win64-shipping', 'league of legends', 'fortniteclient-win64-shipping', 'r5apex', 'r5apex_dx12', 'gta5', 'gta5_enhanced',
  'eldenring', 'rocketleague', 'overwatch', 'dota2', 'cod', 'bo6', 'modernwarfare', 'robloxplayerbeta', 'eurotrucks2', 'amtrucks', 'witcher3',
  'cyberpunk2077', 'rainbowsix', 'rainbowsix_vulkan', 'destiny2', 'tslgame', 'fc25', 'fc26', 'genshinimpact', 'starrail', 'zenlesszonezero', 'bf2042',
  'rdr2', 'minecraft.windows', 'javaw-minecraft', 'thefinals', 'marvel-win64-shipping', 'deadlock', 'helldivers2', 'baldursgate3', 'bg3', 'bg3_dx11',
  'palworld-win64-shipping', 'forzahorizon5', 'forza horizon 5', 'acshadows', 'eafc25', 'eafc26', 'pathofexile', 'pathofexile_x64', 'pathofexile2', 'wow', 'diablo iv', 'hearthstone'
];

const base = n => String(n || '').replace(/\.exe$/i, '').toLowerCase();

/** Aus der Prozessliste das (erste) Spiel heraussuchen. procs: [{ name, path }], extra: weitere Programmnamen */
function findGame(procs, extra = []) {
  const known = new Set([...KNOWN, ...extra.map(base)].filter(Boolean));
  for (const p of procs || []) {
    const n = base(p.name);
    if (!n || NOT_GAMES.test(n)) continue;
    if (known.has(n) || (p.path && GAME_FOLDERS.test(p.path))) return p.name.replace(/\.exe$/i, '');
  }
  return null;
}

/** Laufende Programme unter Windows (Name + Pfad) – eine kurze PowerShell-Abfrage */
function listProcesses() {
  return new Promise(resolve => {
    if (process.platform !== 'win32') return resolve([]);
    const cmd = 'Get-Process | Where-Object { $_.Path } | Select-Object @{n="name";e={$_.ProcessName}},@{n="path";e={$_.Path}} | ConvertTo-Json -Compress';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, timeout: 15000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve([]);
      try { const j = JSON.parse(out); resolve(Array.isArray(j) ? j : [j]); } catch { resolve([]); }
    });
  });
}

/**
 * Beobachtet alle 20 Sekunden die laufenden Programme.
 * Ereignis 'change' mit { active, game }. setPriority(low: boolean) wird beim Wechsel aufgerufen.
 */
class GameWatch extends EventEmitter {
  constructor({ getPrefs, setPriority, lister = listProcesses, interval = 20000 }) {
    super();
    this.getPrefs = getPrefs; this.setPriority = setPriority; this.lister = lister; this.interval = interval;
    this.game = null; this.timer = null; this.busy = false;
  }
  start() { if (!this.timer) { this.timer = setInterval(() => this.check(), this.interval); this.check(); } }
  stop() { clearInterval(this.timer); this.timer = null; }
  get active() { return !!this.game; }

  async check() {
    if (this.busy) return;
    this.busy = true;
    try {
      const p = this.getPrefs();
      const game = p.gaming === false ? null : findGame(await this.lister(), p.gamingExtra || []);
      const was = this.game;
      this.game = game;
      // Beim Spielen jedes Mal setzen: neue Tabs bekommen neue Prozesse mit normaler Priorität
      if (game || was) { try { this.setPriority(!!game); } catch {} }
      if (game !== was) this.emit('change', { active: !!game, game, started: !was && !!game });
    } finally { this.busy = false; }
  }
}

/** Priorität aller Sakura-Prozesse setzen (niedriger beim Spielen) */
function setProcessPriority(pids, low) {
  const prio = low ? os.constants.priority.PRIORITY_BELOW_NORMAL : os.constants.priority.PRIORITY_NORMAL;
  let n = 0;
  for (const pid of pids) { try { os.setPriority(pid, prio); n++; } catch { /* Prozess schon beendet */ } }
  return n;
}

module.exports = { findGame, listProcesses, GameWatch, setProcessPriority, KNOWN };
