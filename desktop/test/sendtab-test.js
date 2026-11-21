// Tab an anderes Gerät senden: Ausgang im eigenen Geräte-Eintrag, Zielgerät öffnet jeden Tab genau einmal
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const Store = require('../lib/store');
const M = require('../lib/model');
const pc = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'st1')));
const pc2 = new Store(fs.mkdtempSync(path.join(os.tmpdir(), 'st2')));
const sync = (a, b) => { // wie ein Abgleich über den Server
  a.setDeviceTabs([]); b.setDeviceTabs([]);
  const j = x => JSON.parse(JSON.stringify(x)); // wie über das Netz
  const server = j(M.mergeData(a.syncedPart(), {}));
  b.applySynced(j(M.mergeData(b.syncedPart(), server)));
  a.applySynced(j(M.mergeData(a.syncedPart(), b.syncedPart())));
};
sync(pc, pc2);
assert.equal(pc.otherDevices()[0].id, pc2.data.deviceId);
let synced = 0; pc.on('change', (k, s) => { if (k === 'sent' && s) synced++; });
assert.equal(pc.sendTab(pc2.data.deviceId, 'https://wiki.example/artikel', 'Artikel'), true);
assert.equal(synced, 1, 'löst einen Abgleich aus');
assert.equal(pc.sendTab(pc2.data.deviceId, 'javascript:alert(1)', 'x'), false);
assert.equal(pc.sendTab(pc.data.deviceId, 'https://a.example/', 'x'), false, 'nicht an sich selbst');
assert.deepEqual(pc2.takeInbox(), [], 'vor dem Abgleich noch nichts da');
sync(pc, pc2);
const inbox = pc2.takeInbox();
assert.equal(inbox.length, 1); assert.equal(inbox[0].url, 'https://wiki.example/artikel'); assert.equal(inbox[0].from, os.hostname() || 'Windows-PC');
sync(pc, pc2);
assert.deepEqual(pc2.takeInbox(), [], 'nur einmal öffnen');
assert.deepEqual(pc.takeInbox(), [], 'Absender bekommt nichts');
console.log('Tab senden ok');
