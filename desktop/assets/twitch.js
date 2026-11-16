/* Sakura – Twitch: Emotes von 7TV/BTTV/FFZ im Chat anzeigen, Kanalpunkte-Bonus automatisch abholen (nur wenn eingeschaltet).
 * Einstellungen über window.__sakuraTwitchConfig = { emotes, points }. Emote-Listen liefert window.sakuraTwitch.emotes(login). */
(function () {
  if (window.__sakuraTwitch) { window.__sakuraTwitch.refresh(); return; }
  const cfg = () => window.__sakuraTwitchConfig || { emotes: true, points: false };
  const NOT_CHANNEL = /^(directory|videos|settings|subscriptions|inventory|drops|wallet|search|p|u|downloads|jobs|turbo|prime|friends|messages|payments|following|moderator|team|store|login|signup)$/i;

  function channelLogin() {
    const parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'popout' && parts[1]) return parts[1].toLowerCase();
    if (parts[0] === 'embed' && parts[1]) return parts[1].toLowerCase();
    if (parts[0] && !NOT_CHANNEL.test(parts[0]) && /^[a-z0-9_]{2,25}$/i.test(parts[0])) return parts[0].toLowerCase();
    return null;
  }

  // ---------- Emotes im Chat
  let emotes = {}, loadedFor = null, loading = null;
  async function loadEmotes() {
    const login = channelLogin();
    if (!cfg().emotes || !login || login === loadedFor || !window.sakuraTwitch) return;
    loadedFor = login;
    const p = loading = window.sakuraTwitch.emotes(login).catch(() => ({}));
    const map = await p;
    if (loading !== p) return;
    emotes = map || {};
    for (const el of document.querySelectorAll('[data-sakura-emotes]')) el.removeAttribute('data-sakura-emotes');
    scan(document);
  }
  const TEXT_SEL = '.text-fragment, [data-a-target="chat-message-text"], .chat-line__message .message span:not([class]), .seventv-chat-message-body span';
  function render(span) {
    if (span.dataset.sakuraEmotes || !span.textContent || span.children.length) return; // nur reiner Text, keine Links/Erwähnungen
    span.dataset.sakuraEmotes = '1';
    const words = span.textContent.split(/(\s+)/);
    if (!words.some(w => emotes[w])) return;
    const frag = document.createDocumentFragment();
    for (const w of words) {
      const e = emotes[w];
      if (!e) { frag.appendChild(document.createTextNode(w)); continue; }
      const img = document.createElement('img');
      img.src = e.url; img.alt = w; img.title = `${w} (${e.src === '7tv' ? '7TV' : e.src === 'bttv' ? 'BTTV' : 'FFZ'})`;
      img.className = 'sakura-emote';
      img.setAttribute('style', 'height:28px;width:auto;vertical-align:middle;margin:-4px 1px;display:inline-block');
      frag.appendChild(img);
    }
    span.textContent = '';
    span.appendChild(frag);
  }
  function scan(root) {
    if (!cfg().emotes || !Object.keys(emotes).length) return;
    if (root.matches && root.matches(TEXT_SEL)) render(root);
    if (root.querySelectorAll) for (const s of root.querySelectorAll(TEXT_SEL)) render(s);
  }
  const obs = new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // ---------- Kanalpunkte: Bonus-Truhe automatisch anklicken
  let lastClaim = 0;
  function claim() {
    if (!cfg().points || Date.now() - lastClaim < 5000) return;
    const icon = document.querySelector('.community-points-summary .claimable-bonus__icon, [data-test-selector="community-points-summary"] .claimable-bonus__icon');
    const btn = (icon && icon.closest('button')) ||
      [...document.querySelectorAll('.community-points-summary button, [data-test-selector="community-points-summary"] button')]
        .find(b => /bonus/i.test(b.getAttribute('aria-label') || ''));
    if (!btn) return;
    lastClaim = Date.now();
    // kurze, zufällige Pause – wie ein Mensch
    setTimeout(() => { try { btn.click(); } catch (e) {} }, 400 + Math.random() * 1600);
  }

  // Twitch wechselt Kanäle ohne Seitenwechsel
  let lastPath = location.pathname;
  setInterval(() => {
    if (location.pathname !== lastPath) { lastPath = location.pathname; loadEmotes(); }
    claim();
  }, 2000);
  window.__sakuraTwitch = { refresh: () => { loadedFor = null; loadEmotes(); } };
  loadEmotes();
})();
