// Popup-Blocker: Regeln für neue Fenster
const assert = require('assert');
const { decidePopup, site } = require('../lib/popups');
const now = 1_000_000;
const base = { opener: 'https://serien.example/folge/1', now, lastInput: now - 200, intent: { at: now - 200, href: null, interactive: false }, isAd: h => h.endsWith('adserver.example') };
const D = o => decidePopup({ ...base, ...o });
assert.equal(site('https://www.shop.co.uk/x'), 'shop.co.uk'); assert.equal(site('https://a.b.example.com/'), 'example.com');
// ohne Klick
assert.deepEqual(D({ url: 'https://serien.example/x', lastInput: now - 5000 }), { allow: false, reason: 'ohne-klick' });
assert.deepEqual(D({ url: 'https://serien.example/x', lastInput: null }), { allow: false, reason: 'ohne-klick' });
// Werbe-Adresse – auch mit Klick auf einen Link
assert.deepEqual(D({ url: 'https://track.adserver.example/go', intent: { at: now, href: 'https://track.adserver.example/go', interactive: true } }), { allow: false, reason: 'werbung' });
// gleiche Seite: erlaubt
assert.equal(D({ url: 'https://cdn.serien.example/hilfe' }).allow, true);
// Klickfalle: Klick auf leere Fläche/Video öffnet fremde Seite
assert.deepEqual(D({ url: 'https://casino.example/' }), { allow: false, reason: 'klickfalle' });
// Link angeklickt, Knopf angeklickt, Anmeldefenster
assert.equal(D({ url: 'https://wiki.example/a#x', intent: { at: now, href: 'https://wiki.example/a', interactive: true } }).allow, true);
assert.equal(D({ url: 'https://accounts.google.com/o/oauth2', intent: { at: now, href: null, interactive: true } }).allow, true);
assert.equal(D({ url: 'https://accounts.google.com/o/oauth2', features: 'width=500,height=600' }).allow, true);
// Klick in einem eingebetteten Rahmen (keine Angaben) → erlauben; about:blank nach Klick erlauben
assert.equal(D({ url: 'https://fremd.example/', intent: null }).allow, true);
assert.equal(D({ url: 'about:blank' }).allow, true);
// alter Klick zählt nicht als Absicht
assert.equal(D({ url: 'https://casino.example/', intent: { at: now - 9000, href: null, interactive: true } }).allow, true, 'ohne frische Klick-Angabe: wie Rahmen-Klick');
console.log('Popup-Blocker ok');
