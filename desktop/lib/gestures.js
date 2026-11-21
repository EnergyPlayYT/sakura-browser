// Mausgesten: rechte Maustaste halten und ziehen. Erkennt eine Folge von Richtungen (L, R, U, D).
const STEP = 28; // Pixel, ab denen eine Bewegung als Richtung zählt

const ACTIONS = {
  L: { cmd: 'back', label: 'Zurück' },
  R: { cmd: 'forward', label: 'Vor' },
  U: { cmd: 'newTab', label: 'Neuer Tab' },
  DR: { cmd: 'closeTab', label: 'Tab schließen' },
  UD: { cmd: 'reload', label: 'Neu laden' },
  DU: { cmd: 'reopen', label: 'Geschlossenen Tab öffnen' }
};

class GestureTracker {
  constructor() { this.g = null; }
  down(x, y) { this.g = { ax: x, ay: y, path: '' }; }
  get active() { return !!this.g; }
  move(x, y) {
    const g = this.g;
    if (!g) return;
    const dx = x - g.ax, dy = y - g.ay;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < STEP) return;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'L' : 'R') : (dy < 0 ? 'U' : 'D');
    if (g.path.slice(-1) !== dir && g.path.length < 6) g.path += dir;
    g.ax = x; g.ay = y;
  }
  /** Ende der Geste: liefert die Aktion oder null (dann normales Kontextmenü) */
  up() {
    const g = this.g;
    this.g = null;
    if (!g || !g.path) return null;
    return ACTIONS[g.path] || { cmd: null, path: g.path };
  }
  cancel() { this.g = null; }
}

module.exports = { GestureTracker, ACTIONS };
