// Bildschirmzeit: pro Tag und Seite zählen, Woche zusammenfassen, alte Tage löschen
const assert = require('assert');
const { ScreenTime } = require('../lib/screentime');
const store = { data: {} };
const st = new ScreenTime(store);
const now = new Date(2026, 10, 27, 15, 0).getTime();
st.add('www.youtube.com', 600, now); st.add('youtube.com', 300, now); st.add('wikipedia.org', 120, now);
st.add('youtube.com', 1000, now - 864e5);
st.add('alt.example', 50, now - 40 * 864e5); st.add('neu.example', 1, now);
const s = st.summary(now);
assert.equal(s.sites[0].host, 'youtube.com'); assert.equal(s.sites[0].seconds, 900);
assert.equal(s.total, 1021); assert.equal(s.week.length, 7); assert.equal(s.week[6].today, true); assert.equal(s.week[5].seconds, 1000);
assert(!Object.keys(store.data.screenTime).some(k => k < '2026-10-28'), 'alte Tage gelöscht');
st.add('', 10, now); st.add('x.de', -5, now); assert.equal(st.summary(now).total, 1021);
console.log('Bildschirmzeit ok');
