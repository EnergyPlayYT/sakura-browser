// Mausgesten: Richtungen erkennen
const assert = require('assert');
const { GestureTracker } = require('../lib/gestures');
const g = new GestureTracker();
const draw = pts => { g.down(...pts[0]); for (const p of pts.slice(1)) g.move(...p); return g.up(); };
assert.equal(draw([[100, 100], [60, 102], [20, 98]]).cmd, 'back');
assert.equal(draw([[100, 100], [180, 105]]).cmd, 'forward');
assert.equal(draw([[100, 100], [102, 160], [170, 165]]).cmd, 'closeTab');
assert.equal(draw([[100, 100], [100, 40], [100, 110]]).cmd, 'reload');
assert.equal(draw([[100, 100], [110, 110]]), null, 'kleine Bewegung = normales Kontextmenü');
assert.equal(draw([[100, 100], [60, 100], [60, 40], [120, 40]]).cmd, null, 'unbekannte Geste');
assert.equal(g.up(), null);
console.log('Mausgesten ok');
