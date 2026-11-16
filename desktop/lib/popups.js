// Popup-Blocker: entscheidet, ob ein neues Fenster/Tab von einer Webseite geöffnet werden darf.
// Blockiert werden
//  - Fenster ohne vorherigen Klick oder Tastendruck (Werbefenster beim Laden oder per Zeitschalter),
//  - Fenster zu bekannten Werbe-Adressen (Sperrliste des Werbeblockers),
//  - Klickfallen: ein Klick auf eine leere Fläche oder ein Video öffnet eine fremde Seite.
// Erlaubt bleiben Links, Knöpfe, Anmeldefenster und alles, was auf derselben Seite bleibt.

const GESTURE_MS = 1500;

const site = u => {
  try {
    const h = new URL(u).hostname.replace(/^www\./, '');
    const p = h.split('.');
    // grobe „Seite“: letzte zwei Teile (bei z. B. co.uk drei)
    return p.length > 2 && p[p.length - 2].length <= 3 && p[p.length - 1].length === 2 ? p.slice(-3).join('.') : p.slice(-2).join('.');
  } catch { return ''; }
};
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const sameUrl = (a, b) => { try { const x = new URL(a), y = new URL(b); x.hash = y.hash = ''; return x.href === y.href; } catch { return false; } };

/**
 * d: { url, opener, features, now, lastInput, intent: { at, href, interactive } | null, isAd(host) }
 * Ergebnis: { allow: true } oder { allow: false, reason: 'ohne-klick' | 'werbung' | 'klickfalle' }
 */
function decidePopup(d) {
  const now = d.now || Date.now();
  const host = hostOf(d.url);
  if (host && d.isAd && d.isAd(host)) return { allow: false, reason: 'werbung' };
  if (!(d.lastInput && now - d.lastInput <= GESTURE_MS)) return { allow: false, reason: 'ohne-klick' };
  if (!/^https?:/i.test(d.url)) return { allow: true }; // about:blank u. ä. – z. B. Druck- oder Anmeldefenster
  if (site(d.url) === site(d.opener)) return { allow: true };
  const intent = d.intent && now - d.intent.at <= GESTURE_MS ? d.intent : null;
  if (!intent) return { allow: true }; // Klick in einem eingebetteten Rahmen – keine Angaben, lieber erlauben
  if (intent.href && sameUrl(intent.href, d.url)) return { allow: true }; // genau der angeklickte Link
  if (/(^|,)\s*(width|height|popup)\b/i.test(d.features || '')) return { allow: true }; // kleines Fenster, z. B. Anmeldung
  if (intent.interactive) return { allow: true }; // Klick auf Knopf/Link
  return { allow: false, reason: 'klickfalle' };
}

const REASONS = {
  'ohne-klick': 'öffnete sich ohne deinen Klick',
  werbung: 'führt zu einer Werbe-Adresse',
  klickfalle: 'war eine Klickfalle'
};

module.exports = { decidePopup, REASONS, site, GESTURE_MS };
