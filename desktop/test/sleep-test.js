// Automatisch schlafen legen: Regeln für Zeit, RAM und CPU
const assert = require('assert');
const { pickTabsToSleep, CPU_STRIKES } = require('../lib/sleeper');
const MB = 1024 * 1024, now = 10_000_000;
const tab = (id, o = {}) => ({ id, active: false, audible: false, sleeping: false, web: true, lastActive: now - 60e3, mem: 100 * MB, cpu: 0, ...o });
const ids = r => r.map(x => x.id + ':' + x.reason);
// Zeit
let tabs = [tab(1, { active: true, lastActive: 0 }), tab(2, { lastActive: now - 31 * 60e3 }), tab(3, { lastActive: now - 31 * 60e3, audible: true }),
  tab(4, { lastActive: now - 31 * 60e3, web: false }), tab(5, { lastActive: now - 31 * 60e3, sleeping: true }), tab(6)];
assert.deepEqual(ids(pickTabsToSleep(tabs, { sleepAfter: 30 }, now)), ['2:idle']);
assert.deepEqual(ids(pickTabsToSleep(tabs, { sleepAfter: 0 }, now)), []);
// RAM: am längsten unbenutzte zuerst, bis es passt
tabs = [tab(1, { active: true }), tab(2, { lastActive: now - 5e3, mem: 300 * MB }), tab(3, { lastActive: now - 50e3, mem: 200 * MB }), tab(4, { lastActive: now - 9e3, mem: 100 * MB })];
assert.deepEqual(ids(pickTabsToSleep(tabs, { ramLimit: 1000 }, now, 1250 * MB)), ['3:ram', '4:ram']);
assert.deepEqual(ids(pickTabsToSleep(tabs, { ramLimit: 1000 }, now, 900 * MB)), []);
// CPU: erst nach mehreren Messungen hintereinander
const strikes = new Map();
tabs = [tab(1, { cpu: 80 }), tab(2, { cpu: 5 })];
for (let i = 1; i < CPU_STRIKES; i++) assert.deepEqual(pickTabsToSleep(tabs, { cpuLimit: 25 }, now, 0, strikes), []);
assert.deepEqual(ids(pickTabsToSleep(tabs, { cpuLimit: 25 }, now, 0, strikes)), ['1:cpu']);
tabs[0].cpu = 3; pickTabsToSleep(tabs, { cpuLimit: 25 }, now, 0, strikes); assert(!strikes.has(1), 'Zähler zurückgesetzt');
// Ein Tab wird nur einmal gewählt
tabs = [tab(1, { lastActive: 0, cpu: 99 })];
assert.equal(pickTabsToSleep(tabs, { sleepAfter: 1, ramLimit: 1 }, now, 999 * MB).length, 1);
console.log('Automatisch schlafen ok');
