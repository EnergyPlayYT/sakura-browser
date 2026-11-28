// Arbeitsbereiche über einen Neustart: Bereiche, Namen, Farben und Tabs kommen wieder; nur der aktive Bereich lädt
const Module = require('module'), assert = require('assert'), fs = require('fs'), path = require('path');
const mock = require('./electron-mock');
fs.writeFileSync(path.join(mock.app.getPath('userData'), 'sakura-data.json'), JSON.stringify({ prefs: { restoreSession: true, updatedAt: 1 },
  session: [{ active: 0, tabs: [{ url: 'https://b1.de/', title: 'B1' }], space: 1, spaces: [
    { name: 'Allgemein', color: 'sakura', active: 0, tabs: [{ url: 'https://a1.de/', title: 'A1' }, { url: 'https://a2.de/', title: 'A2' }] },
    { name: 'Schule', color: 'matcha', active: 0, tabs: [{ url: 'https://b1.de/', title: 'B1' }] }] }] }));
const orig = Module._load; Module._load = function (r, ...a) { return r === 'electron' ? mock : orig.call(this, r, ...a); };
require(path.join(__dirname, '..', 'main.js'));
setTimeout(async () => {
  const uiWc = mock._all[0];
  const call = (c, a) => mock._handlers.ui({ sender: uiWc }, c, a);
  let st = await call('state');
  assert.deepEqual(st.spaces.map(s => [s.name, s.color, s.count]), [['Allgemein', 'sakura', 2], ['Schule', 'matcha', 1]]);
  assert.equal(st.spaces.find(s => s.id === st.spaceId).name, 'Schule', 'zuletzt benutzter Bereich');
  assert.equal(st.tabs.length, 1); assert.equal(st.url, 'https://b1.de/');
  assert(!mock._all.some(w => w.url === 'https://a1.de/' || w.url === 'https://a2.de/'), 'andere Bereiche laden erst beim Wechseln');
  await call('spaceSwitch', st.spaces[0].id); st = await call('state');
  assert.equal(st.tabs.length, 2); assert.equal(st.url, 'https://a1.de/');
  assert(mock._all.some(w => w.url === 'https://a1.de/'));
  console.log('Arbeitsbereiche nach Neustart ok'); process.exit(0);
}, 80);
