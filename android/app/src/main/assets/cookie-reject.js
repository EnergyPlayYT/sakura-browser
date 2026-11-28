/* Sakura – Cookie-Banner automatisch ablehnen
 * Läuft nach dem Laden in jeder Seite (und in eingebetteten Rahmen). Klickt bei bekannten
 * Zustimmungs-Bannern auf „Alle ablehnen“ bzw. „Nur notwendige“. Sucht 10 Sekunden lang.
 * Gemeinsame Datei: nach android/app/src/main/assets/ kopieren! */
(function () {
  if (window.__sakuraCookieReject) return;
  window.__sakuraCookieReject = true;

  // Feste Knöpfe bekannter Anbieter
  const KNOWN = [
    '#onetrust-reject-all-handler',                                  // OneTrust
    '.ot-pc-refuse-all-handler',
    '#CybotCookiebotDialogBodyButtonDecline',                        // Cookiebot
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
    '#didomi-notice-disagree-button',                                // Didomi
    '.didomi-continue-without-agreeing',
    '.qc-cmp2-summary-buttons button[mode="secondary"]',            // Quantcast
    '[data-testid="uc-deny-all-button"]',                            // Usercentrics (alt)
    'button.sp_choice_type_REJECT_ALL',                              // Sourcepoint
    'button.fc-cta-do-not-consent',                                  // Google Funding Choices
    '.cmpboxbtnno',                                                  // consentmanager
    '#truste-consent-required',                                      // TrustArc
    '.cc-btn.cc-deny',                                               // Cookie Consent (Osano)
    '[data-cookiefirst-action="reject"]',
    '.cky-btn-reject',                                               // CookieYes
    '#cmplz-deny, .cmplz-deny',                                      // Complianz
    'button[data-cookiebanner="accept_only_essential_button"]',      // Facebook/Instagram
    '#BorlabsCookieBox [data-cookie-refuse]',                        // Borlabs Cookie 2 (WordPress)
    '#BorlabsCookieBox ._brlbs-refuse-btn a',
    '.brlbs-btn-accept-only-essential',                              // Borlabs Cookie 3
    '[data-borlabs-cookie-actions="accept-only-essential"]'
  ];
  // Shadow-DOM-Banner (Usercentrics u. a.)
  const SHADOW_HOSTS = ['#usercentrics-root', '#usercentrics-cmp-ui', 'aside#usercentrics-cmp-ui', '#cmpwrapper', 'div#__tealiumGDPRecModal'];

  const REJECT = new RegExp('^(' + [
    'alle ablehnen', 'ablehnen', 'alles ablehnen', 'alle cookies ablehnen', 'cookies ablehnen', 'optionale cookies ablehnen',
    'nur (notwendige|erforderliche|essenzielle|essentielle|technisch notwendige|funktionale)( cookies)?( (akzeptieren|zulassen|erlauben|verwenden|nutzen))?',
    'weiter ohne (einwilligung|zustimmung|akzeptieren)', 'ohne zustimmung fortfahren', 'nicht zustimmen', 'nicht einverstanden', 'zustimmung verweigern',
    'reject all', 'reject all cookies', 'reject', 'reject cookies', 'reject optional cookies', 'reject non-essential( cookies)?',
    'decline', 'decline all', 'decline cookies', 'deny', 'deny all', 'refuse', 'refuse all', 'disagree',
    'only (necessary|essential|required)( cookies)?', '(use|allow|accept) (only )?(necessary|essential|required) cookies( only)?', 'necessary cookies only', 'essential cookies only',
    'continue without (accepting|agreeing|consent)', 'do not consent',
    'tout refuser', 'refuser', 'continuer sans accepter', 'rifiuta tutto', 'rifiuta', 'rechazar todo', 'rechazar todas', 'rechazar',
    'alles weigeren', 'weigeren', 'odrzuć wszystkie', 'reddet', 'tümünü reddet'
  ].join('|') + ')$', 'i');

  const CONTAINER = /cookie|consent|gdpr|cmp|privacy|privatsph|datenschutz|brlbs|borlabs|onetrust|didomi|usercentrics|cookiebot|truste|sp_message|banner/i;
  const host = location.hostname;
  // Eigene Zustimmungsseiten (Google, YouTube) und eingebettete Zustimmungs-Rahmen: die ganze Seite ist der Banner
  const wholePage = /^consent\.(google|youtube)\./.test(host) || (window.top !== window && /consent|cmp|privacy|sourcepoint|cookie|sp-prod/.test(host));

  const norm = s => String(s || '').replace(/\s+/g, ' ').trim().replace(/[.!…]+$/, '').toLowerCase();
  const visible = el => {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) > 0.05;
  };
  // Links nur, wenn sie nicht wegnavigieren
  const clickable = el => el.tagName !== 'A' || !el.getAttribute('href') || /^(#|javascript:)/i.test(el.getAttribute('href'));
  const inBanner = el => {
    if (wholePage) return true;
    for (let p = el, i = 0; p && i < 12; i++) {
      if (p.nodeType === 1 && CONTAINER.test((p.id || '') + ' ' + (typeof p.className === 'string' ? p.className : '') + ' ' + (p.getAttribute('aria-label') || ''))) return true;
      if (p.nodeType === 1 && /^(ytd-consent-bump|tp-yt-paper-dialog)/i.test(p.tagName)) return true;
      // Dialoge ohne sprechende Namen: zählt, wenn darin von Cookies oder Datenschutz die Rede ist
      if (p.nodeType === 1 && (p.getAttribute('role') === 'dialog' || p.getAttribute('aria-modal') === 'true' || p.tagName === 'DIALOG')
        && /cookie|datenschutz|privatsph|privacy|consent|einwilligung/i.test(String(p.textContent).slice(0, 4000))) return true;
      p = p.parentNode && p.parentNode.nodeType === 11 ? p.parentNode.host : p.parentNode; // aus Shadow-DOM heraus
    }
    return false;
  };

  function byText(root) {
    const els = root.querySelectorAll('button, [role="button"], a, input[type="button"], input[type="submit"]');
    for (const el of els) {
      const t = norm(el.innerText || el.value || el.textContent);
      const label = norm(el.getAttribute('aria-label'));
      if ((REJECT.test(t) || REJECT.test(label)) && t.length < 60 && clickable(el) && visible(el) && inBanner(el)) return el;
    }
    return null;
  }

  function find() {
    for (const sel of KNOWN) {
      const el = document.querySelector(sel);
      if (el && visible(el)) return el;
    }
    for (const sel of SHADOW_HOSTS) {
      const h = document.querySelector(sel);
      const sr = h && h.shadowRoot;
      if (!sr) continue;
      const el = sr.querySelector('[data-testid="uc-deny-all-button"], button[data-action="deny"]') || byText(sr);
      if (el && visible(el)) return el;
    }
    const el = byText(document);
    if (el) return el;
    // Banner in unbekannten (offenen) Shadow-DOMs
    for (const h of document.querySelectorAll('body *')) {
      if (!h.shadowRoot) continue;
      const x = byText(h.shadowRoot);
      if (x) return x;
    }
    return null;
  }

  let done = false, timer = null, observer = null;
  function attempt() {
    timer = null;
    if (done) return;
    const el = find();
    if (!el) return;
    done = true;
    try { el.click(); } catch (e) {}
    if (observer) observer.disconnect();
  }
  attempt();
  if (done || !document.documentElement) return;
  observer = new MutationObserver(() => { if (!timer) timer = setTimeout(attempt, 250); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
  setTimeout(() => { if (observer) observer.disconnect(); clearTimeout(timer); }, 10000);
})();
