// Fokus-Modus: Zeiten, Wochentage, über Mitternacht, spontane Fokus-Zeit, Seiten-Liste
const assert = require('assert');
const F = require('../lib/focus');
const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime();
const mon10 = at(2026, 11, 23, 10, 0), sat10 = at(2026, 11, 28, 10, 0);
assert.equal(F.cleanSite('https://www.TikTok.com/@x'), 'tiktok.com'); assert.equal(F.cleanSite('kein text'), '');
const cfg = { scheduled: true, days: [1, 2, 3, 4, 5], from: '08:00', to: '15:00', sites: ['tiktok.com', 'reddit.com'] };
assert(F.blocks('www.tiktok.com', cfg, mon10)); assert(F.blocks('m.reddit.com', cfg, mon10), 'Subdomain');
assert(!F.blocks('wikipedia.org', cfg, mon10)); assert(!F.blocks('tiktok.com', cfg, sat10), 'Wochenende frei');
assert(!F.blocks('tiktok.com', cfg, at(2026, 11, 23, 15, 0)), 'ab 15 Uhr frei');
assert.equal(F.activeUntil(cfg, mon10), at(2026, 11, 23, 15, 0));
const night = { scheduled: true, days: [5], from: '22:00', to: '06:00', sites: ['x.com'] };
assert(F.blocks('x.com', night, at(2026, 11, 27, 23, 0)), 'Freitag 23 Uhr');
assert(F.blocks('x.com', night, at(2026, 11, 28, 5, 0)), 'Samstag 5 Uhr gehört noch zum Freitag');
assert(!F.blocks('x.com', night, at(2026, 11, 29, 5, 0)), 'Sonntag 5 Uhr nicht');
const spont = { until: sat10 + 25 * 60e3 };
assert(F.blocks('instagram.com', spont, sat10), 'Standardliste'); assert(!F.blocks('instagram.com', spont, sat10 + 26 * 60e3));
assert.deepEqual(F.normalize({}).sites, F.DEFAULT_SITES);
console.log('Fokus-Modus ok');
