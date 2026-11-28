// Designs: Farben, eigene Akzentfarbe, gleiche Datei auf PC und Android
const assert = require('assert');
const fs = require('fs'), path = require('path');
const T = require('../pages/themes');
assert(T.list.length >= 8, 'mindestens 8 Designs');
assert.equal(T.list[0].id, 'sakura');
const d = T.resolve({});
assert.equal(d.id, 'sakura'); assert.equal(d.vars['--yoru'], '#1C1A33'); assert.equal(d.vars['--sakura'], '#F2B3C5');
assert.equal(d.vars['--washi-rgb'], '238, 231, 226');
assert.equal(T.resolve({ theme: 'gibtsnicht' }).id, 'sakura');
const w = T.resolve({ theme: 'washi' }); assert.equal(w.dark, false);
const a = T.resolve({ theme: 'matcha', accent: '#40c0ff' });
assert.equal(a.vars['--sakura'], '#40C0FF'); assert.equal(a.scene.petals[0], '#40C0FF');
assert.equal(T.resolve({ accent: 'red;}' }).accent, '#F2B3C5', 'ungültige Farbe wird ignoriert');
for (const t of T.list) {
  const r = T.resolve({ theme: t.id });
  for (const v of Object.values(r.vars)) assert(/^#[0-9A-F]{6}$/i.test(v) || /^\d+, \d+, \d+$/.test(v), t.id + ': ' + v);
  assert.equal(r.scene.sky.length, 3);
}
// Android nutzt dieselben Dateien
const A = path.join(__dirname, '..', '..', 'android', 'app', 'src', 'main', 'assets');
for (const f of ['themes.js', 'newtab.html']) {
  const src = f === 'themes.js' ? path.join(__dirname, '..', 'pages', f) : path.join(__dirname, '..', 'pages', f);
  assert.equal(fs.readFileSync(path.join(A, f), 'utf8'), fs.readFileSync(src, 'utf8'), f + ' nach Android kopieren!');
}
console.log('Designs ok, ' + T.list.length + ' Stück');
// Jahreszeiten-Design
{
  const at = (m, h) => new Date(2026, m - 1, 15, h, 0).getTime();
  const r = (m, h) => T.resolve({ theme: 'jahreszeit' }, at(m, h));
  assert.equal(r(4, 12).colors.yoru, '#1C1A33'); assert.equal(r(4, 12).scene.fall, 'petals');
  assert.equal(r(7, 12).scene.fall, 'fireflies'); assert.equal(r(10, 12).scene.fall, 'leaves'); assert.equal(r(1, 12).scene.fall, 'snow');
  assert.equal(r(10, 12).accent, '#F0905F', 'Herbst = Momiji');
  assert(r(4, 23).scene.night && r(4, 23).colors.yoru !== '#1C1A33', 'nachts dunkler');
  assert.equal(r(4, 12).id, 'jahreszeit'); assert.equal(T.list[1].id, 'jahreszeit');
  assert.equal(T.resolve({ theme: 'yuki' }).scene.fall, 'snow');
  console.log('Jahreszeiten ok');
}
