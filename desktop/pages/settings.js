/* Sakura – Einstellungsseite (sakura://settings): Kategorien links, Suche oben, Inhalte rechts.
 * Spricht über window.sakura.call('settings', …) mit dem Browser; erlaubt sind nur bestimmte Befehle (main.js). */
const api = { call: (cmd, arg) => window.sakura.call('settings', { cmd, arg: arg === undefined ? null : arg }) };
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const openPanel = kind => api.call('openPanel', kind);
function timeAgo(ts) {
  if (!ts) return 'noch nie';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'gerade eben';
  if (m < 60) return `vor ${m} Min.`;
  return new Date(ts).toLocaleString('de-DE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const ENGINE_NAMES = { google: 'Google', duckduckgo: 'DuckDuckGo', ecosia: 'Ecosia', startpage: 'Startpage', bing: 'Bing' };
async function renderSettings() {
  const body = $('#content');
  const p = await api.call('prefs');
  const si = await api.call('syncInfo');
  body.innerHTML = `
  <section class="set">
    <h3>Suche</h3>
    <label class="field">Suchmaschine für die Adressleiste
      <select id="engine">${p.engines.map(e => `<option value="${e}"${e === p.searchEngine ? ' selected' : ''}>${ENGINE_NAMES[e] || e}</option>`).join('')}</select>
    </label>
  </section>
  <section class="set" id="design-section">
    <h3>Design</h3>
    <div class="themes" role="radiogroup" aria-label="Design">${p.themes.map(t => `
      <button class="theme${t.id === (p.theme || 'sakura') ? ' on' : ''}" role="radio" aria-checked="${t.id === (p.theme || 'sakura')}" data-theme="${esc(t.id)}"
        style="--t-bg:${esc(t.yoru)};--t-ac:${esc(t.accent)}"><i></i><span>${esc(t.label)}</span></button>`).join('')}
    </div>
    <div class="row accent-row">
      <label class="accent">Eigene Akzentfarbe <input type="color" id="accent" value="${esc(p.accent || (p.themes.find(t => t.id === (p.theme || 'sakura')) || p.themes[0]).accent)}"></label>
      <button class="btn" id="accent-reset"${p.accent ? '' : ' hidden'}>Farbe des Designs verwenden</button>
    </div>
  </section>
  <section class="set">
    <h3>Darstellung und Start</h3>
    <label class="field">Webseiten
      <select id="theme">
        <option value="system"${p.siteTheme === 'system' ? ' selected' : ''}>Wie Windows (hell oder dunkel)</option>
        <option value="dark"${p.siteTheme === 'dark' ? ' selected' : ''}>Dunkel, wenn die Seite es anbietet</option>
        <option value="force"${p.siteTheme === 'force' ? ' selected' : ''}>Immer dunkel (auch Seiten ohne Dunkelmodus)</option>
      </select>
    </label>
    <div id="restart-row" class="row" hidden><p style="margin:0;flex:1">Wird nach einem Neustart aktiv.</p><button class="btn primary" id="restart">Jetzt neu starten</button></div>
    <label class="switch"><input type="checkbox" id="anim"${p.animations !== false ? ' checked' : ''}><span>Animationen und weiches Scrollen</span></label>
    <label class="switch"><input type="checkbox" id="gestures"${p.mouseGestures !== false ? ' checked' : ''}><span>Mausgesten: rechte Maustaste halten und ziehen</span></label>
    <p class="hint">Links = zurück, rechts = vor, hoch = neuer Tab, runter und rechts = Tab schließen, hoch und runter = neu laden, runter und hoch = geschlossenen Tab wieder öffnen.</p>
    <label class="switch"><input type="checkbox" id="garden"${p.tabGarden !== false ? ' checked' : ''}><span>Tab-Garten – lange nicht genutzte Tabs verblühen langsam</span></label>
    <label class="switch"><input type="checkbox" id="vtabs"${p.verticalTabs ? ' checked' : ''}><span>Tabs links untereinander (vertikale Tabs)</span></label>
    <label class="switch"><input type="checkbox" id="lpv"${p.linkPreview !== false ? ' checked' : ''}><span>Link-Vorschau: Link lange gedrückt halten</span></label>
    <label class="switch"><input type="checkbox" id="restore"${p.restoreSession ? ' checked' : ''}><span>Beim Start die Tabs vom letzten Mal öffnen</span></label>
    <label class="switch"><input type="checkbox" id="dlask"${p.downloadAsk ? ' checked' : ''}><span>Vor jedem Download fragen, wo gespeichert wird</span></label>
  </section>
  <section class="set">
    <h3>Leistung</h3>
    <label class="field">Akku-Sparmodus
      <select id="saver">${[['auto', 'Automatisch, wenn der Laptop ohne Ladekabel läuft'], ['on', 'Immer an'], ['off', 'Aus']].map(([v, l]) => `<option value="${v}"${(p.batterySaver || 'auto') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    <p class="hint" style="margin-left:0">Im Sparmodus schlafen Hintergrund-Tabs nach 5 Minuten, Glas-Effekte und Animationen werden abgeschaltet.</p>
    <label class="field">Hintergrund-Tabs schlafen legen nach
      <select id="sl-after">${[[0, 'Nie'],[10, '10 Minuten'],[30, '30 Minuten'],[60, '1 Stunde'],[120, '2 Stunden']].map(([v, l]) => `<option value="${v}"${Number(p.sleepAfter || 0) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    <label class="field">RAM-Grenze für Sakura
      <select id="sl-ram">${[[0, 'Keine'],[1024, '1 GB'],[2048, '2 GB'],[4096, '4 GB'],[8192, '8 GB']].map(([v, l]) => `<option value="${v}"${Number(p.ramLimit || 0) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    <label class="field">CPU-Grenze pro Hintergrund-Tab
      <select id="sl-cpu">${[[0, 'Keine'],[10, '10 %'],[25, '25 %'],[50, '50 %']].map(([v, l]) => `<option value="${v}"${Number(p.cpuLimit || 0) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    <p>Wird eine Grenze überschritten, schlafen die am längsten unbenutzten Hintergrund-Tabs. Tabs mit Ton schlafen nie.</p>
    <label class="switch"><input type="checkbox" id="gm-on"${p.gaming !== false ? ' checked' : ''}><span>Gaming-Modus: Läuft ein Spiel, bremst Sakura sich selbst</span></label>
    <label class="switch"><input type="checkbox" id="gm-sleep"${p.gamingSleep !== false ? ' checked' : ''}><span>Beim Spielstart Hintergrund-Tabs schlafen legen</span></label>
    <label class="field">Weitere Spiele (Programmname, eins pro Zeile, z. B. meinspiel.exe)
      <textarea id="gm-extra" spellcheck="false">${esc((p.gamingExtra || []).join('\n'))}</textarea>
    </label>
  </section>
  <section class="set">
    <h3>Werbeblocker</h3>
    <label class="switch"><input type="checkbox" id="ab-on"${p.adblock ? ' checked' : ''}><span>Werbung und Tracker blockieren</span></label>
    <label class="switch"><input type="checkbox" id="phish"${p.phishWarn !== false ? ' checked' : ''}><span>Vor bekannten Betrugs- und Phishing-Seiten warnen</span></label>
    <label class="switch"><input type="checkbox" id="ab-ext"${p.adblockExtended ? ' checked' : ''}><span>Erweiterte Liste verwenden (rund 80.000 Domains, wird wöchentlich geladen)</span></label>
    <p id="ab-info">${p.blocklistSize.toLocaleString('de-DE')} Domains auf der Sperrliste.</p>
    <label class="field">Ausnahmen – auf diesen Seiten nichts blockieren (eine pro Zeile)
      <textarea id="ab-allow" spellcheck="false">${esc((p.adblockAllow || []).join('\n'))}</textarea>
    </label>
  </section>
  <section class="set">
    <h3>YouTube</h3>
    <label class="switch"><input type="checkbox" id="yt-on"${p.youtube !== false ? ' checked' : ''}><span>Werbung in Videos überspringen und ausblenden</span></label>
    <label class="switch"><input type="checkbox" id="yt-sb"${p.ytSponsor !== false ? ' checked' : ''}><span>Sponsor-Abschnitte überspringen (SponsorBlock)</span></label>
    <label class="field">Videoqualität
      <select id="yt-q">${[['hd1080', '1080p (Full HD)'], ['hd720', '720p'], ['hd1440', '1440p'], ['hd2160', '2160p (4K)'], ['max', 'Höchste verfügbare'], ['auto', 'Wie YouTube es wählt']]
        .map(([v, l]) => `<option value="${v}"${(p.ytQuality || 'hd1080') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </label>
    <p>Sponsor-Abschnitte kommen von der freien SponsorBlock-Datenbank. Dabei wird nur ein Teil eines verschlüsselten Werts gesendet, nicht welches Video du schaust.</p>
  </section>
  <section class="set">
    <h3>Twitch</h3>
    <label class="switch"><input type="checkbox" id="tw-emotes"${p.twitchEmotes !== false ? ' checked' : ''}><span>Emotes von 7TV, BTTV und FFZ im Chat anzeigen</span></label>
    <label class="switch"><input type="checkbox" id="tw-bgaudio"${p.twitchBgAudio ? ' checked' : ''}><span>Streams im Hintergrund-Tab nur als Ton abspielen (spart Daten)</span></label>
    <label class="switch"><input type="checkbox" id="tw-points"${p.twitchPoints ? ' checked' : ''}><span>Kanalpunkte-Bonus automatisch abholen</span></label>
    <p class="msg-error">Achtung: Automatisches Abholen verstößt gegen die Regeln von Twitch. Twitch kann dein Konto dafür sperren. Nutzung auf eigenes Risiko.</p>
  </section>
  <section class="set">
    <h3>Steam</h3>
    <label class="switch"><input type="checkbox" id="st-info"${p.steamInfo !== false ? ' checked' : ''}><span>Auf Spielseiten Spieler online, Spielzeit und Preise zeigen</span></label>
    <label class="field">IsThereAnyDeal-Schlüssel für den Preisvergleich (optional)
      <input id="itad" type="password" spellcheck="false" autocomplete="off" placeholder="Schlüssel einfügen">
    </label>
    <p id="itad-msg">Kostenlos auf isthereanydeal.com unter „Apps“ → „Register app“. Der Schlüssel bleibt nur auf diesem PC.</p>
  </section>
  <section class="set">
    <h3>Videos und Serien</h3>
    <label class="switch"><input type="checkbox" id="vd-pip"${p.pipButton !== false ? ' checked' : ''}><span>Knopf „Bild-in-Bild“ über Videos zeigen</span></label>
    <label class="switch"><input type="checkbox" id="vd-resume"${p.videoResume !== false ? ' checked' : ''}><span>Dort weiterschauen, wo du aufgehört hast</span></label>
    <label class="switch"><input type="checkbox" id="vd-intro"${p.skipIntro !== false ? ' checked' : ''}><span>Intro und Rückblick überspringen</span></label>
    <label class="switch"><input type="checkbox" id="vd-next"${p.autoNext !== false ? ' checked' : ''}><span>Nächste Folge automatisch starten</span></label>
    <p>Funktioniert auf jeder Seite mit Videos, z. B. Netflix, Prime Video, Disney+. In privaten Fenstern merkt sich Sakura nichts.</p>
  </section>
  <section class="set">
    <h3>Streamer-Modus</h3>
    <label class="field">Private Daten unscharf machen (Adressleiste, Verlauf, Lesezeichen, Passwörter, Downloads)
      <select id="st-mode">${[['auto', 'Automatisch, wenn OBS oder Streamlabs läuft'], ['on', 'Immer'], ['off', 'Nie']].map(([v, l]) => `<option value="${v}"${(p.streamerMode || 'auto') === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </label>
  </section>
  <section class="set">
    <h3>Seitenüberwachung</h3>
    <label class="field">Überwachte Seiten prüfen alle
      <select id="w-hours">${[[1, '1 Stunde'], [3, '3 Stunden'], [6, '6 Stunden'], [12, '12 Stunden'], [24, '24 Stunden']].map(([v, l]) => `<option value="${v}"${Number(p.watchHours || 3) === v ? ' selected' : ''}>${l}</option>`).join('')}</select>
    </label>
  </section>
  <section class="set" id="konto-section">
    <h3>Konto-Tabs</h3>
    <p>Bis zu fünf Konten gleichzeitig, z. B. zwei Google-Konten: Jeder Konto-Tab hat eigene Cookies und Anmeldungen. Öffnen per Rechtsklick auf einen Tab oder auf das Plus.</p>
    <div class="konto-list"></div>
  </section>
  <section class="set">
    <h3>Passwörter</h3>
    <label class="switch"><input type="checkbox" id="pw-on"${p.passwordManager !== false ? ' checked' : ''}><span>Passwortmanager verwenden</span></label>
    <label class="switch"><input type="checkbox" id="pw-save"${p.passwordSave !== false ? ' checked' : ''}${p.passwordManager === false ? ' disabled' : ''}><span>Anbieten, Passwörter zu speichern</span></label>
    <label class="switch"><input type="checkbox" id="pw-fill"${p.passwordFill !== false ? ' checked' : ''}${p.passwordManager === false ? ' disabled' : ''}><span>Gespeicherte Konten beim Klick ins Anmeldefeld anbieten</span></label>
    <div class="row"><button class="btn" id="pw-open">Passwörter verwalten</button></div>
  </section>
  <section class="set" id="pin-sec"></section>
  <section class="set" id="remote-sec"></section>
  <section class="set" id="focus-sec"><h3>Fokus-Modus</h3></section>
  <section class="set" id="apps-sec"><h3>Web-Apps</h3></section>
  <section class="set" id="discord-sec"><h3>Discord-Anzeige</h3></section>
  <section class="set">
    <h3>Popups</h3>
    <label class="switch"><input type="checkbox" id="pp-on"${p.popupBlock !== false ? ' checked' : ''}><span>Werbefenster und Klickfallen blockieren</span></label>
    <p>Neue Fenster dürfen sich nur nach deinem Klick auf einen Link oder Knopf öffnen. Blockierte Fenster zeigt das Schild – dort kannst du sie trotzdem öffnen.</p>
    <label class="field">Ausnahmen – hier Popups erlauben (eine Seite pro Zeile)
      <textarea id="pp-allow" spellcheck="false">${esc((p.popupAllow || []).join('\n'))}</textarea>
    </label>
  </section>
  <section class="set">
    <h3>Cookie-Banner</h3>
    <label class="switch"><input type="checkbox" id="ck-on"${p.cookieReject !== false ? ' checked' : ''}><span>Cookie-Banner automatisch ablehnen</span></label>
    <p>Sakura klickt bei Zustimmungsfenstern auf „Alle ablehnen“ oder „Nur notwendige“. Ausnahmen setzt du über das Schild in der Adressleiste.</p>
    <label class="field">Ausnahmen – hier nichts ablehnen (eine Seite pro Zeile)
      <textarea id="ck-allow" spellcheck="false">${esc((p.cookieAllow || []).join('\n'))}</textarea>
    </label>
  </section>
  <section class="set">
    <h3>Startseite</h3>
    <label class="switch"><input type="checkbox" id="nt-widgets"${p.ntWidgets !== false ? ' checked' : ''}><span>Widgets zeigen: Uhrzeit in Japan, Wetter, Tageszitat</span></label>
    <label class="field">Ort für das Wetter
      <input id="nt-city" type="text" maxlength="60" placeholder="z. B. Berlin" value="${esc(p.weatherCity || '')}">
    </label>
    <label class="switch"><input type="checkbox" id="bg-builtin"${p.bgBuiltin !== false ? ' checked' : ''}><span>Sakura-Hintergrundbilder zeigen</span></label>
    <p>Die Bilder wechseln automatisch mit einem weichen Übergang. Ohne Bilder zeigt die Startseite die gezeichnete Nachtszene mit Kirschblüten.</p>
    <label class="field">Eigene Hintergrundbilder (Bild-Adressen, eine pro Zeile)
      <textarea id="bgs" spellcheck="false" placeholder="https://…/bild.jpg">${esc((p.backgrounds || []).join('\n'))}</textarea>
    </label>
    <label class="field">Bild wechseln alle … Minuten
      <input id="bgmin" type="number" min="1" max="1440" value="${p.bgMinutes || 1}">
    </label>
  </section>
  <section class="set" id="import-section">
    <h3>Daten importieren</h3>
    <p>Übernimm Lesezeichen, Verlauf und Anmeldungen aus einem anderen Browser. Doppelte Lesezeichen werden übersprungen. Schließ den anderen Browser vorher.</p>
    <label class="field">Browser
      <select id="imp-src"><option value="">Suche Browser …</option></select>
    </label>
    <label class="switch"><input type="checkbox" id="imp-bm" checked><span>Lesezeichen</span></label>
    <label class="switch"><input type="checkbox" id="imp-hist" checked><span>Verlauf der letzten 90 Tage</span></label>
    <label class="switch"><input type="checkbox" id="imp-ck" checked><span>Cookies – damit du auf Webseiten angemeldet bleibst</span></label>
    <p id="imp-msg" hidden></p>
    <div class="row"><button class="btn primary" id="imp-go" disabled>Importieren</button><button class="btn" id="imp-html">Aus HTML-Datei importieren …</button></div>
  </section>
  <section class="set" id="sync-section">${syncHtml(si)}</section>
  <section class="set" id="data-section">
    <h3>Daten</h3>
    <label class="switch"><input type="checkbox" id="clr-cookies"><span>Auch Cookies und Anmeldungen löschen</span></label>
    <div class="row"><button class="btn danger" id="clr">Verlauf und Cache löschen</button><button class="btn" id="datadir">Datenordner öffnen</button></div>
    <p class="perm-title"><b>Gemerkte Berechtigungen</b> – Standort, Kamera, Mikrofon, Benachrichtigungen</p>
    <div id="perms"></div>
  </section>`;

  $('#engine').onchange = e => api.call('setPrefs', { searchEngine: e.target.value });
  bindDesign(p);
  const showRestart = r => { $('#restart-row').hidden = !(r && r.restart); };
  showRestart({ restart: (p.siteTheme === 'force') !== (p.startTheme === 'force') });
  $('#theme').onchange = async e => showRestart(await api.call('setPrefs', { siteTheme: e.target.value }));
  $('#restart').onclick = () => api.call('relaunch');
  $('#garden').onchange = e => api.call('setPrefs', { tabGarden: e.target.checked });
  $('#vtabs').onchange = e => api.call('setPrefs', { verticalTabs: e.target.checked });
  $('#lpv').onchange = e => api.call('setPrefs', { linkPreview: e.target.checked });
  $('#gestures').onchange = e => api.call('setPrefs', { mouseGestures: e.target.checked });
  $('#anim').onchange = async e => { await api.call('setPrefs', { animations: e.target.checked }); $('#restart-row').hidden = false; };
  $('#restore').onchange = e => api.call('setPrefs', { restoreSession: e.target.checked });
  $('#dlask').onchange = e => api.call('setPrefs', { downloadAsk: e.target.checked });
  $('#gm-on').onchange = e => api.call('setPrefs', { gaming: e.target.checked });
  $('#gm-sleep').onchange = e => api.call('setPrefs', { gamingSleep: e.target.checked });
  $('#gm-extra').onchange = e => api.call('setPrefs', { gamingExtra: lines(e.target.value).map(x => x.replace(/^.*[\\/]/, '')).slice(0, 50) });
  for (const [id, key] of [['#sl-after', 'sleepAfter'], ['#sl-ram', 'ramLimit'], ['#sl-cpu', 'cpuLimit']]) $(id).onchange = e => api.call('setPrefs', { [key]: Number(e.target.value) });
  $('#ab-on').onchange = e => api.call('setPrefs', { adblock: e.target.checked });
  $('#ab-ext').onchange = async e => {
    $('#ab-info').textContent = e.target.checked ? 'Liste wird geladen …' : '';
    const r = await api.call('setPrefs', { adblockExtended: e.target.checked });
    $('#ab-info').textContent = r.error ? r.error : `${r.blocklistSize.toLocaleString('de-DE')} Domains auf der Sperrliste.`;
  };
  const lines = v => v.split(/\n/).map(x => x.trim()).filter(Boolean);
  $('#ab-allow').onchange = e => api.call('setPrefs', { adblockAllow: lines(e.target.value).map(hostOf) });
  $('#yt-on').onchange = e => api.call('setPrefs', { youtube: e.target.checked });
  $('#yt-sb').onchange = e => api.call('setPrefs', { ytSponsor: e.target.checked });
  $('#yt-q').onchange = e => api.call('setPrefs', { ytQuality: e.target.value });
  $('#st-info').onchange = e => api.call('setPrefs', { steamInfo: e.target.checked });
  api.call('itadKey').then(k => { if (k && k.set) $('#itad').placeholder = 'Schlüssel gespeichert – zum Ändern neu einfügen'; });
  $('#itad').onchange = async e => {
    const r = await api.call('setItadKey', e.target.value);
    $('#itad-msg').textContent = r.error || (r.set ? 'Schlüssel gespeichert. Der Preisvergleich erscheint auf Steam-Spielseiten.' : 'Schlüssel entfernt.');
    $('#itad-msg').className = r.error ? 'msg-error' : 'msg-ok';
    e.target.value = '';
  };
  $('#tw-emotes').onchange = e => api.call('setPrefs', { twitchEmotes: e.target.checked });
  $('#tw-bgaudio').onchange = e => api.call('setPrefs', { twitchBgAudio: e.target.checked });
  $('#tw-points').onchange = e => {
    if (e.target.checked && !confirm('Automatisches Abholen von Kanalpunkten verstößt gegen die Regeln von Twitch und kann zu einer Kontosperre führen. Trotzdem einschalten?')) { e.target.checked = false; return; }
    api.call('setPrefs', { twitchPoints: e.target.checked });
  };
  $('#vd-resume').onchange = e => api.call('setPrefs', { videoResume: e.target.checked });
  $('#vd-pip').onchange = e => api.call('setPrefs', { pipButton: e.target.checked });
  $('#vd-intro').onchange = e => api.call('setPrefs', { skipIntro: e.target.checked });
  $('#vd-next').onchange = e => api.call('setPrefs', { autoNext: e.target.checked });
  bindContainers(p);
  bindPin();
  bindRemote();
  bindFocus();
  bindApps();
  bindDiscord();
  $('#st-mode').onchange = e => api.call('setPrefs', { streamerMode: e.target.value });
  $('#w-hours').onchange = e => api.call('setPrefs', { watchHours: Number(e.target.value) });
  $('#pw-on').onchange = e => {
    api.call('setPrefs', { passwordManager: e.target.checked });
    $('#pw-save').disabled = $('#pw-fill').disabled = !e.target.checked;
  };
  $('#pw-save').onchange = e => api.call('setPrefs', { passwordSave: e.target.checked });
  $('#pw-fill').onchange = e => api.call('setPrefs', { passwordFill: e.target.checked });
  $('#pw-open').onclick = () => openPanel('passwords');
  $('#pp-on').onchange = e => api.call('setPrefs', { popupBlock: e.target.checked });
  $('#pp-allow').onchange = e => api.call('setPrefs', { popupAllow: lines(e.target.value).map(u => hostOf(/^https?:/.test(u) ? u : 'https://' + u)) });
  $('#saver').onchange = e => api.call('setPrefs', { batterySaver: e.target.value });
  $('#nt-widgets').onchange = e => api.call('setPrefs', { ntWidgets: e.target.checked });
  $('#nt-city').onchange = e => api.call('setPrefs', { weatherCity: e.target.value.trim().slice(0, 60) });
  $('#phish').onchange = e => api.call('setPrefs', { phishWarn: e.target.checked });
  $('#ck-on').onchange = e => api.call('setPrefs', { cookieReject: e.target.checked });
  $('#ck-allow').onchange = e => api.call('setPrefs', { cookieAllow: lines(e.target.value).map(u => hostOf(/^https?:/.test(u) ? u : 'https://' + u)) });
  $('#bgs').onchange = e => api.call('setPrefs', { backgrounds: lines(e.target.value) });
  $('#bgmin').onchange = e => api.call('setPrefs', { bgMinutes: Math.max(1, Number(e.target.value) || 1) });
  $('#bg-builtin').onchange = e => api.call('setPrefs', { bgBuiltin: e.target.checked });
  $('#clr').onclick = async () => {
    $('#clr').disabled = true;
    await api.call('clearHistory', { cookies: $('#clr-cookies').checked });
    $('#clr').textContent = 'Gelöscht';
  };
  $('#datadir').onclick = () => api.call('openDataFolder');
  renderPerms(await api.call('permList'));
  bindSync();
  bindImport();
}

const PERM_LABEL = { media: 'Kamera/Mikrofon', geolocation: 'Standort', notifications: 'Benachrichtigungen', 'clipboard-read': 'Zwischenablage', midi: 'MIDI', midiSysex: 'MIDI' };
function renderPerms(list) {
  const box = $('#perms');
  if (!box) return;
  list = list || [];
  box.innerHTML = !list.length ? '<p class="hint">Noch keine. Wenn eine Seite nach Standort, Kamera oder Benachrichtigungen fragt, merkt sich Sakura deine Antwort.</p>'
    : list.map(x => `<div class="row perm"><span><b>${esc(x.host)}</b> · ${esc(PERM_LABEL[x.perm] || x.perm)} · ${x.ok ? 'erlaubt' : 'blockiert'}</span><button class="btn" data-perm="${esc(x.key)}">Vergessen</button></div>`).join('')
      + '<div class="row"><button class="btn" id="perm-all">Alle vergessen</button></div>';
  box.querySelectorAll('[data-perm]').forEach(b => b.onclick = async () => renderPerms(await api.call('permRemove', b.dataset.perm)));
  if ($('#perm-all')) $('#perm-all').onclick = async () => renderPerms(await api.call('permRemove', null));
}

function bindDesign(p) {
  const box = $('#design-section');
  const accentOf = id => (p.themes.find(t => t.id === id) || p.themes[0]).accent;
  box.querySelectorAll('[data-theme]').forEach(b => {
    b.onclick = async () => {
      box.querySelectorAll('[data-theme]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); });
      p.theme = b.dataset.theme;
      if (!p.accent) $('#accent').value = accentOf(p.theme);
      await api.call('setPrefs', { theme: p.theme });
    };
  });
  // „input“ feuert beim Ziehen im Farbwähler sehr oft → kurz warten
  let t = null;
  $('#accent').oninput = e => {
    clearTimeout(t);
    t = setTimeout(() => { p.accent = e.target.value; $('#accent-reset').hidden = false; api.call('setPrefs', { accent: p.accent }); }, 150);
  };
  $('#accent-reset').onclick = () => {
    p.accent = '';
    $('#accent').value = accentOf(p.theme || 'sakura');
    $('#accent-reset').hidden = true;
    api.call('setPrefs', { accent: '' });
  };
}

// Update direkt aus den Einstellungen: suchen, laden (mit Fortschritt), installieren
let updTimer = null;
function showUpdate(u) {
  const msg = $('#upd-msg'), bar = $('#upd-bar'), go = $('#upd-go');
  if (!msg || !u) return;
  clearTimeout(updTimer);
  const st = u.state;
  const text = st === 'checking' ? 'Suche nach Updates …'
    : st === 'downloading' ? `Lade Version ${u.version || ''} … ${u.percent || 0} %`
    : st === 'ready' ? `Version ${u.version} ist bereit.`
    : st === 'current' ? 'Du hast schon die neueste Version.'
    : st === 'error' || st === 'unsupported' ? u.message : '';
  msg.textContent = text; msg.hidden = !text;
  msg.className = st === 'error' || st === 'unsupported' ? 'msg-error' : st === 'ready' || st === 'current' ? 'msg-ok' : '';
  bar.hidden = st !== 'downloading';
  bar.firstElementChild.style.width = (u.percent || 0) + '%';
  go.disabled = st === 'checking' || st === 'downloading' || st === 'unsupported';
  go.textContent = st === 'ready' ? 'Jetzt neu starten und installieren' : st === 'checking' ? 'Suche …' : st === 'downloading' ? 'Wird geladen …' : 'Nach Updates suchen';
  if (st === 'checking' || st === 'downloading') updTimer = setTimeout(async () => showUpdate(await api.call('updateInfo')), 800);
}
function bindUpdate(info) {
  const go = $('#upd-go');
  if (!go) return;
  go.onclick = async () => {
    const u = await api.call('updateInfo');
    if (u && u.state === 'ready') { go.disabled = true; go.textContent = 'Startet neu …'; api.call('updateInstall'); return; }
    showUpdate({ ...(u || {}), state: 'checking' });
    showUpdate(await api.call('updateCheck'));
  };
  if (info && info.state !== 'idle') showUpdate(info);
}

// Discord-Anzeige: „Surft mit Sakura“ im Discord-Profil
async function bindDiscord() {
  const sec = $('#discord-sec');
  if (!sec) return;
  const c = await api.call('discordGet');
  sec.innerHTML = `<h3>Discord-Anzeige</h3>
    <label class="switch"><input type="checkbox" id="dc-on"${c.on ? ' checked' : ''}${c.available ? '' : ' disabled'}><span>In meinem Discord-Profil „Surft mit Sakura“ zeigen</span></label>
    <label class="switch"><input type="checkbox" id="dc-site"${c.showSite ? ' checked' : ''}${c.available && c.on ? '' : ' disabled'}><span>Auch die Seite bzw. das Video zeigen (z. B. „Schaut: …“)</span></label>
    <p>${c.available ? 'Läuft nur, wenn die Discord-App auf diesem PC geöffnet ist. Private Fenster werden nie angezeigt.' : 'Diese Funktion ist noch nicht eingerichtet.'}</p>`;
  $('#dc-on').onchange = async e => { await api.call('discordSet', { on: e.target.checked }); bindDiscord(); };
  $('#dc-site').onchange = e => api.call('discordSet', { showSite: e.target.checked });
}

// Web-Apps: Seiten, die als eigenes Fenster mit Startmenü-Verknüpfung installiert sind
async function bindApps() {
  const sec = $('#apps-sec');
  if (!sec) return;
  const list = (await api.call('webApps')) || [];
  sec.innerHTML = `<h3>Web-Apps</h3>
    <p>Öffne eine Seite und wähle im Menü „Diese Seite → Als App installieren“. Sie bekommt ein eigenes Fenster ohne Tabs und eine Verknüpfung im Startmenü.</p>
    ${list.length ? list.map(a => `<div class="row app-row" data-id="${esc(a.id)}"><span style="flex:1;min-width:0"><b>${esc(a.title)}</b><br><small style="color:var(--usuzumi)">${esc(hostOf(a.url))}</small></span>
      <button class="btn" data-act="open">Öffnen</button><button class="btn danger" data-act="del">Entfernen</button></div>`).join('') : ''}`;
  sec.onclick = async e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    if (b.dataset.act === 'open') api.call('webAppOpen', id);
    else { await api.call('webAppRemove', id); bindApps(); }
  };
}

// Fokus-Modus: ablenkende Seiten sperren (feste Zeiten oder spontan)
const DAY_NAMES = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
async function bindFocus(note = '') {
  const sec = $('#focus-sec');
  if (!sec) return;
  const { cfg, until } = await api.call('focusGet');
  const t = ts => new Date(ts).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  sec.innerHTML = `<h3>Fokus-Modus</h3>
    <p>Sperrt ablenkende Seiten, damit du dich konzentrieren kannst – etwa beim Lernen oder Arbeiten.</p>
    <div class="status${until ? ' ok' : ''}"><i></i><span>${until ? `Fokus läuft bis ${esc(t(until))} Uhr.` : 'Gerade kein Fokus.'}</span></div>
    <div class="row">${until && cfg.until > Date.now() ? '<button class="btn" id="f-stop">Fokus beenden</button>' : '<button class="btn primary" data-min="25">25 Min. fokussieren</button><button class="btn" data-min="60">1 Stunde</button><button class="btn" data-min="120">2 Stunden</button>'}</div>
    <label class="switch"><input type="checkbox" id="f-sched"${cfg.scheduled ? ' checked' : ''}><span>Zu festen Zeiten automatisch</span></label>
    <div class="f-days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" data-day="${d}"${cfg.days.includes(d) ? ' checked' : ''}><span>${DAY_NAMES[d]}</span></label>`).join('')}</div>
    <div class="row f-times"><label class="field">Von<input type="time" id="f-from" value="${esc(cfg.from)}"></label><label class="field">Bis<input type="time" id="f-to" value="${esc(cfg.to)}"></label></div>
    <label class="field">Gesperrte Seiten (eine pro Zeile)<textarea id="f-sites" spellcheck="false">${esc(cfg.sites.join('\n'))}</textarea></label>
    ${note ? `<p class="msg-ok">${esc(note)}</p>` : ''}`;
  const save = async () => {
    const days = [...sec.querySelectorAll('[data-day]')].filter(x => x.checked).map(x => Number(x.dataset.day));
    await api.call('focusSet', { scheduled: $('#f-sched').checked, days, from: $('#f-from').value, to: $('#f-to').value, sites: $('#f-sites').value.split(/\n/) });
    bindFocus('Gespeichert.');
  };
  sec.querySelectorAll('[data-min]').forEach(b => b.onclick = async () => { await api.call('focusStart', Number(b.dataset.min)); bindFocus(); });
  if ($('#f-stop')) $('#f-stop').onclick = async () => { await api.call('focusStop'); bindFocus(); };
  $('#f-sched').onchange = save;
  sec.querySelectorAll('[data-day]').forEach(x => x.onchange = save);
  $('#f-from').onchange = save; $('#f-to').onchange = save; $('#f-sites').onchange = save;
}

// Fernsteuerung: Programme auf diesem PC (z. B. Claude über „Chrome DevTools MCP“) dürfen Sakura bedienen
async function bindRemote() {
  const sec = $('#remote-sec');
  if (!sec) return;
  const st = await api.call('remoteStatus');
  const url = `http://127.0.0.1:${st.port}`;
  const cfg = JSON.stringify({ mcpServers: { sakura: { command: 'npx', args: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl=' + url] } } });
  sec.innerHTML = `<h3>Fernsteuerung</h3>
    <label class="switch"><input type="checkbox" id="remote-on"${st.enabled ? ' checked' : ''}><span>Programme auf diesem PC dürfen Sakura steuern</span></label>
    <p class="msg-error">Achtung: Solange das an ist, kann jedes Programm auf deinem PC Sakura bedienen – auch deine eingeloggten Konten, Cookies und Seiten. Aus dem Internet geht das nicht. Schalte es nur ein, wenn du es gerade brauchst.</p>
    <p>${st.active ? `Die Fernsteuerung ist offen unter <code>${esc(url)}</code>. Oben in der Tab-Leiste steht dann „Fernsteuerung an“.` : 'Die Fernsteuerung ist geschlossen.'}</p>
    <div class="row" id="remote-restart"${st.enabled !== st.active ? '' : ' hidden'}><p style="margin:0;flex:1">Wird nach einem Neustart aktiv.</p><button class="btn primary" id="remote-relaunch">Jetzt neu starten</button></div>
    <details><summary>So steuert Claude Sakura</summary>
      <p>1. Schalter oben einschalten und Sakura neu starten.<br>2. In der Claude-Desktop-App: Einstellungen → Entwickler → Konfiguration bearbeiten, und diesen Text in die Datei einfügen (Node.js muss installiert sein):</p>
      <pre class="cfg">${esc(cfg)}</pre>
      <div class="row"><button class="btn" id="remote-copy">Text kopieren</button></div>
      <p>3. Claude-Desktop neu starten. Danach kann Claude Seiten in Sakura öffnen, klicken, tippen und Bildschirmfotos machen.</p>
    </details>`;
  $('#remote-on').onchange = async e => {
    const r = await api.call('remoteSet', e.target.checked);
    $('#remote-restart').hidden = !(r && r.restart);
  };
  $('#remote-relaunch').onclick = () => api.call('relaunch');
  $('#remote-copy').onclick = async () => { await api.call('copyText', cfg); $('#remote-copy').textContent = 'Kopiert'; };
}

// PIN-Sperre für Verlauf und Passwörter
async function bindPin(msg = '', ok = false) {
  const sec = $('#pin-sec');
  if (!sec) return;
  const st = await api.call('pinStatus');
  const field = (id, label) => `<label class="field">${label}<input id="${id}" type="password" inputmode="numeric" maxlength="8" autocomplete="off"></label>`;
  sec.innerHTML = `<h3>PIN-Sperre</h3>
    <p>${st.enabled ? 'Verlauf und Passwörter sind mit einer PIN geschützt. Nach dem Entsperren bleiben sie 5 Minuten offen.' : 'Schütze deinen Verlauf und deine Passwörter mit einer PIN (4 bis 8 Ziffern). Praktisch, wenn andere an deinem PC sitzen.'}</p>
    ${msg ? `<p class="${ok ? 'msg-ok' : 'msg-error'}">${esc(msg)}</p>` : ''}
    ${st.enabled ? field('pin-old', 'Bisherige PIN') : ''}
    ${field('pin-new', st.enabled ? 'Neue PIN' : 'PIN')}
    <div class="row"><button class="btn primary" id="pin-save">${st.enabled ? 'PIN ändern' : 'PIN festlegen'}</button>${st.enabled ? '<button class="btn" id="pin-del">PIN entfernen</button>' : ''}</div>`;
  $('#pin-save').onclick = async () => {
    const r = await api.call('pinSet', { pin: $('#pin-new').value, old: $('#pin-old') ? $('#pin-old').value : '' });
    bindPin(r && r.ok ? (st.enabled ? 'PIN geändert.' : 'PIN festgelegt – Verlauf und Passwörter sind jetzt geschützt.') : (r && r.error) || 'Das hat nicht geklappt.', !!(r && r.ok));
  };
  if ($('#pin-del')) $('#pin-del').onclick = async () => {
    const r = await api.call('pinRemove', $('#pin-old').value);
    bindPin(r && r.ok ? 'PIN entfernt.' : (r && r.error) || 'Das hat nicht geklappt.', !!(r && r.ok));
  };
}

async function bindContainers(p) {
  const box = $('#konto-section .konto-list');
  if (!box) return;
  const list = (await api.call('containers')) || [];
  box.innerHTML = list.map(c => `<div class="konto-row" style="--kc:var(--g-${esc(c.color)})"><i></i>
      <input data-n="${c.n}" value="${esc((p.containerNames || [])[c.n - 1] || '')}" placeholder="${esc('Konto ' + c.n)}" maxlength="30" spellcheck="false" aria-label="Name von Konto ${c.n}">
      <button class="btn" data-clear="${c.n}" title="Abmelden: Cookies und Anmeldungen dieses Kontos löschen">Daten löschen</button></div>`).join('');
  box.querySelectorAll('input[data-n]').forEach(inp => inp.onchange = () => {
    const names = [...box.querySelectorAll('input[data-n]')].map(x => x.value.trim().slice(0, 30));
    api.call('setPrefs', { containerNames: names });
  });
  box.querySelectorAll('[data-clear]').forEach(b => b.onclick = async () => {
    if (!confirm('Alle Cookies und Anmeldungen dieses Kontos löschen?')) return;
    await api.call('clearContainer', Number(b.dataset.clear));
    b.textContent = 'Gelöscht'; b.disabled = true;
  });
}

async function bindImport() {
  const sel = $('#imp-src'), go = $('#imp-go'), msg = $('#imp-msg');
  const show = (text, bad) => { msg.textContent = text; msg.className = bad ? 'msg-error' : 'msg-ok'; msg.hidden = !text; };
  const list = (await api.call('importSources')) || [];
  if (!sel.isConnected) return;
  sel.innerHTML = list.length
    ? list.map(p => `<option value="${esc(p.id)}">${esc(p.label)}</option>`).join('')
    : '<option value="">Kein anderer Browser gefunden</option>';
  sel.disabled = !list.length;
  go.disabled = !list.length;
  go.onclick = async () => {
    const b = $('#imp-bm').checked, h = $('#imp-hist').checked, c = $('#imp-ck').checked;
    go.disabled = true;
    show('Importiere …');
    const r = await api.call('importRun', { id: sel.value, bookmarks: b, history: h, cookies: c });
    go.disabled = false;
    show(r && (r.message || r.error), !r || !!r.error);
  };
  $('#imp-html').onclick = async () => {
    const r = await api.call('importHtml');
    if (r) show(r.message || r.error, !!r.error);
  };
}
const SYNC_PW_HINT = 'Mit dem Sync-Passwort werden deine Daten verschlüsselt, bevor sie den PC verlassen – auch Google kann sie nicht lesen. Gib auf allen Geräten dasselbe ein. Vergisst du es, sind die Daten auf dem Server verloren; deine Geräte behalten ihre eigenen Daten.';

function syncHtml(si) {
  if (si.mode === 'code') {
    const label = { ok: `Synchronisiert ${timeAgo(si.lastSync)}`, syncing: si.message || 'Synchronisiere …', error: si.message || 'Fehler', idle: `Zuletzt ${timeAgo(si.lastSync)}` }[si.state] || '';
    return `<h3>Synchronisation</h3>
      <div class="status ${esc(si.state)}"><i></i><span>${esc(label)}</span></div>
      <p>Alle Geräte mit diesem Sync-Code gleichen sich automatisch ab: Lesezeichen, Kacheln, Verlauf, offene Tabs, Skripte und Einstellungen – Ende-zu-Ende-verschlüsselt.</p>
      <div class="sync-code"><small>Dein Sync-Code</small><code id="s-code" class="blur" title="Klicken zum Anzeigen">${esc(si.code)}</code>
        <button class="btn" id="s-copy">Kopieren</button></div>
      <p>Gib diesen Code auf dem Handy in der Sakura-App unter Einstellungen → Synchronisation ein. Behandle ihn wie ein Passwort.</p>
      <div id="s-devices"></div>
      <p class="msg-error" id="s-err" hidden></p>
      <div class="row"><button class="btn primary" id="sync-now">Jetzt synchronisieren</button><button class="btn" id="sync-out">Trennen</button></div>`;
  }
  if (!si.email && si.state === 'off') {
    return `<h3>Synchronisation</h3>
      <p>Verbinde deinen PC und dein Handy mit einem Sync-Code. Danach gleichen sie sich automatisch ab – ohne Konto, Ende-zu-Ende-verschlüsselt.</p>
      ${si.message ? `<p class="msg-error">${esc(si.message)}</p>` : ''}
      <div class="row"><button class="btn primary" id="s-newcode">Sync-Code erstellen</button></div>
      <label class="field" style="margin-top:12px">Oder Code von einem anderen Gerät eingeben
        <input id="s-codein" spellcheck="false" autocomplete="off" placeholder="XXXXX-XXXXX-XXXXX-XXXXX"></label>
      <p class="msg-error" id="s-err" hidden></p>
      <div class="row"><button class="btn" id="s-connect">Verbinden</button></div>
      <details><summary>Stattdessen ein eigenes Firebase-Projekt verwenden</summary>${firebaseHtml(si)}</details>`;
  }
  if (si.email && si.state === 'needkey') {
    return `<h3>Synchronisation</h3>
      <div class="status error"><i></i><span>${esc(si.message || 'Sync-Passwort fehlt – der Abgleich ist pausiert.')}</span></div>
      <p>Angemeldet als ${esc(si.email)}. Gib dein Sync-Passwort ein, um den Abgleich zu entsperren.</p>
      <label class="field">Sync-Passwort<input id="s-sync" type="password" autocomplete="off"></label>
      <p class="msg-error" id="s-err" hidden></p>
      <div class="row"><button class="btn primary" id="s-unlock">Entsperren</button><button class="btn" id="sync-out">Abmelden</button></div>
      <details><summary>Sync-Passwort vergessen?</summary>
        <p>Dann kannst du die Daten auf dem Server mit einem neuen Passwort neu anlegen. Sie werden durch die Daten dieses PCs ersetzt; andere Geräte entsperrst du danach mit dem neuen Passwort.</p>
        <div class="row"><button class="btn danger" id="s-reset">Mit neuem Passwort neu anlegen</button></div>
      </details>`;
  }
  if (si.email && si.state !== 'off') {
    const label = { ok: `Synchronisiert ${timeAgo(si.lastSync)}`, syncing: si.message || 'Synchronisiere …', error: si.message || 'Fehler', idle: `Zuletzt ${timeAgo(si.lastSync)}` }[si.state] || '';
    return `<h3>Synchronisation</h3>
      <div class="status ${esc(si.state)}"><i></i><span>${esc(label)}</span></div>
      <p>Angemeldet als ${esc(si.email)}. Ende-zu-Ende-verschlüsselt: Lesezeichen, Kacheln, Verlauf, offene Tabs, Skripte und Einstellungen sind nur auf deinen Geräten lesbar.</p>
      <div class="row"><button class="btn primary" id="sync-now">Jetzt synchronisieren</button><button class="btn" id="s-change">Sync-Passwort ändern</button><button class="btn" id="sync-out">Abmelden</button></div>
      <div id="s-change-box" hidden>
        <label class="field" style="margin-top:12px">Neues Sync-Passwort<input id="s-new" type="password" autocomplete="new-password"></label>
        <label class="field">Neues Sync-Passwort wiederholen<input id="s-new2" type="password" autocomplete="new-password"></label>
        <p class="msg-error" id="s-err" hidden></p>
        <div class="row"><button class="btn primary" id="s-change-go">Ändern</button></div>
      </div>`;
  }
  return `<h3>Synchronisation</h3>${firebaseHtml(si)}`;
}

function firebaseHtml(si) {
  return `
    <p>Melde dich auf dem PC und in der Android-App mit demselben Konto an. Dafür brauchst du ein kostenloses Firebase-Projekt.</p>
    <details><summary>So richtest du Firebase ein</summary><ol>
      <li>In der Firebase-Konsole ein Projekt anlegen.</li>
      <li>Authentication → Anmeldemethode → <code>E-Mail/Passwort</code> aktivieren.</li>
      <li>Firestore Database erstellen und die Regeln aus <code>firebase/firestore.rules</code> einfügen.</li>
      <li>Projekteinstellungen → Allgemein: „Web-API-Schlüssel“ und „Projekt-ID“ hier eintragen.</li>
    </ol></details>
    ${si.state === 'error' && si.message ? `<p class="msg-error">${esc(si.message)}</p>` : ''}
    <label class="field">Web-API-Schlüssel<input id="s-key" spellcheck="false" value="${esc(si.apiKey || '')}"></label>
    <label class="field">Projekt-ID<input id="s-pid" spellcheck="false" value="${esc(si.projectId || '')}"></label>
    <label class="field">E-Mail<input id="s-mail" type="email" spellcheck="false" value="${esc(si.email || '')}"></label>
    <label class="field">Konto-Passwort<input id="s-pw" type="password"></label>
    <label class="field">Sync-Passwort (für die Verschlüsselung, mind. 8 Zeichen)<input id="s-sync" type="password" autocomplete="new-password"></label>
    <p>${SYNC_PW_HINT}</p>
    <p class="msg-error" id="s-err" hidden></p>
    <div class="row"><button class="btn primary" id="s-login">Anmelden</button><button class="btn" id="s-create">Konto anlegen</button></div>`;
}

function bindSync() {
  const sec = $('#sync-section');
  const showErr = m => { const e = $('#s-err'); if (e) { e.textContent = m; e.hidden = !m; } };
  const busy = on => { for (const b of sec.querySelectorAll('button')) b.disabled = on; };
  const redraw = r => { sec.innerHTML = syncHtml(r); bindSync(); };
  const now = $('#sync-now'), out = $('#sync-out');
  if (now) now.onclick = async () => { now.disabled = true; await api.call('syncNow'); };
  if (out) out.onclick = async () => redraw(await api.call('syncLogout'));
  if ($('#s-change')) $('#s-change').onclick = () => { $('#s-change-box').hidden = false; $('#s-new').focus(); };
  if ($('#s-change-go')) $('#s-change-go').onclick = async () => {
    if ($('#s-new').value !== $('#s-new2').value) return showErr('Die beiden Passwörter stimmen nicht überein.');
    busy(true);
    const r = await api.call('syncChangePassword', $('#s-new').value);
    if (r.failed) { busy(false); return showErr(r.message); }
    redraw(r);
  };
  const unlock = reset => async () => {
    const pw = $('#s-sync').value;
    if (reset && !confirm('Die Daten auf dem Server werden durch die Daten dieses PCs ersetzt und mit dem eingegebenen Passwort neu verschlüsselt. Fortfahren?')) return;
    if (reset && !pw) return showErr('Gib oben das neue Sync-Passwort ein.');
    busy(true);
    const r = await api.call('syncUnlock', { password: pw, reset });
    if (r.failed) { busy(false); return showErr(r.message); }
    redraw(r);
  };
  if ($('#s-unlock')) {
    $('#s-unlock').onclick = unlock(false);
    $('#s-reset').onclick = unlock(true);
    $('#s-sync').onkeydown = e => { if (e.key === 'Enter') unlock(false)(); };
  }
  const go = create => async () => {
    showErr('');
    busy(true);
    const r = await api.call('syncLogin', {
      apiKey: $('#s-key').value, projectId: $('#s-pid').value, email: $('#s-mail').value,
      password: $('#s-pw').value, syncPassword: $('#s-sync').value, create
    });
    if (r && r.state === 'error' && !r.email) { busy(false); return showErr(r.message); }
    redraw(r);
  };
  if ($('#s-login')) { $('#s-login').onclick = go(false); $('#s-create').onclick = go(true); }
  // Sync-Code
  const codeDone = r => { if (r && r.failed && r.mode !== 'code') { busy(false); return showErr(r.message); } redraw(r); };
  if ($('#s-newcode')) $('#s-newcode').onclick = async () => { showErr(''); busy(true); codeDone(await api.call('syncCreateCode')); };
  if ($('#s-connect')) {
    const connect = async () => { showErr(''); busy(true); codeDone(await api.call('syncConnectCode', $('#s-codein').value)); };
    $('#s-connect').onclick = connect;
    $('#s-codein').onkeydown = e => { if (e.key === 'Enter') connect(); };
  }
  if ($('#s-code')) $('#s-code').onclick = e => e.target.classList.toggle('blur');
  if ($('#s-copy')) $('#s-copy').onclick = async () => { await api.call('copyText', $('#s-code').textContent); $('#s-copy').textContent = 'Kopiert'; };
  if ($('#s-devices')) api.call('devices').then(list => {
    const box = $('#s-devices');
    if (!box || !list || !list.length) return;
    box.innerHTML = `<p>Verbundene Geräte: ${list.map(d => `<b>${esc(d.name || 'Gerät')}</b> (${esc(timeAgo(d.updatedAt))})`).join(', ')}</p>`;
  });
}

// ------------------------------------------------------------ Aufbau: Kategorien und Suche
const CATS = [
  ['sync', 'Synchronisation', ['Synchronisation']],
  ['start', 'Startseite', ['Startseite']],
  ['search', 'Suche', ['Suche']],
  ['look', 'Erscheinungsbild', ['Design', 'Darstellung und Start']],
  ['privacy', 'Datenschutz & Sicherheit', ['Werbeblocker', 'Cookie-Banner', 'Popups', 'Streamer-Modus', 'Daten']],
  ['passwords', 'Passwörter', ['Passwörter']],
  ['tabs', 'Tabs und Surfen', ['Konto-Tabs', 'Seitenüberwachung', 'Fokus-Modus', 'Web-Apps']],
  ['video', 'Videos und YouTube', ['YouTube', 'Videos und Serien']],
  ['twitch', 'Twitch und Steam', ['Twitch', 'Multistream', 'Steam', 'Discord-Anzeige']],
  ['perf', 'Leistung und Gaming', ['Leistung']],
  ['import', 'Daten importieren', ['Daten importieren']],
  ['about', 'Über Sakura', ['Über Sakura']]
];
const ICONS = {
  sync: '<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M17.5 3.5v3.6h-3.6M6.5 20.5v-3.6h3.6"/>',
  start: '<path d="M4 11.5L12 5l8 6.5"/><path d="M6.5 10v8.5h11V10"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="M15 15l4.5 4.5"/>',
  look: '<circle cx="12" cy="12" r="7.5"/><path d="M12 4.5a7.5 7.5 0 0 0 0 15z" fill="currentColor"/>',
  privacy: '<path d="M12 3.5l7 2.6v5.4c0 4.4-3 7.6-7 9-4-1.4-7-4.6-7-9V6.1z"/>',
  passwords: '<circle cx="8.5" cy="12" r="3.5"/><path d="M12 12h8M17 12v3M20 12v2"/>',
  tabs: '<rect x="4" y="7" width="16" height="12" rx="1.5"/><path d="M4 10.5h16M9 7V5h6v2"/>',
  twitch: '<path d="M5 4.5h14.5v9.5l-4 4h-3.5l-3 3v-3H5z"/><path d="M11 8.5v4M15 8.5v4"/>',
  video: '<rect x="4" y="6" width="16" height="12" rx="2"/><path d="M10.5 9.5v5l4-2.5z"/>',
  perf: '<path d="M5 17a8 8 0 1 1 14 0"/><path d="M12 13l3.5-4"/>',
  import: '<path d="M12 4.5v10M7.5 10.5L12 15l4.5-4.5M5.5 19.5h13"/>',
  about: '<circle cx="12" cy="12" r="7.5"/><path d="M12 11v5M12 8v.2"/>'
};

let current = 'sync';
function buildNav() {
  $('#nav').innerHTML = CATS.map(([id, label]) => `<a href="#${id}" data-cat="${id}"><svg viewBox="0 0 24 24">${ICONS[id]}</svg><span>${esc(label)}</span></a>`).join('');
}
function tagSections() {
  for (const sec of document.querySelectorAll('#content section.set')) {
    const h = sec.querySelector('h3');
    const title = h ? h.textContent.trim() : '';
    const cat = CATS.find(c => c[2].includes(title));
    sec.dataset.cat = cat ? cat[0] : 'privacy';
  }
}
function showCat(id) {
  if (id === 'focus') { showCat('tabs'); setTimeout(() => { const s = $('#focus-sec'); if (s) s.scrollIntoView({ block: 'start' }); }, 120); return; }
  if (id === 'remote') { showCat('privacy'); setTimeout(() => { const s = $('#remote-sec'); if (s) s.scrollIntoView({ block: 'start' }); }, 120); return; }
  if (!CATS.some(c => c[0] === id)) id = 'sync';
  current = id;
  $('#q').value = '';
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.cat === id));
  document.querySelectorAll('#content section.set').forEach(s => { s.hidden = s.dataset.cat !== id; s.classList.remove('hit'); });
  const c = CATS.find(x => x[0] === id);
  $('#cat-title').innerHTML = `<svg viewBox="0 0 24 24">${ICONS[id]}</svg>${esc(c[1])}`;
  $('#none').hidden = true;
  window.scrollTo(0, 0);
}
function search(q) {
  q = q.trim().toLowerCase();
  if (!q) return showCat(current);
  document.querySelectorAll('#nav a').forEach(a => a.classList.remove('on'));
  let n = 0;
  for (const s of document.querySelectorAll('#content section.set')) {
    const hit = s.textContent.toLowerCase().includes(q) ||
      [...s.querySelectorAll('option, input[placeholder]')].some(o => (o.textContent || o.placeholder || '').toLowerCase().includes(q));
    s.hidden = !hit; s.classList.toggle('hit', hit);
    if (hit) n++;
  }
  $('#cat-title').textContent = `Suchergebnisse für „${q}“`;
  $('#none').hidden = !!n;
}

async function render() {
  await renderSettings();
  // „Über Sakura“ als eigene Kategorie
  const info = await api.call('updateInfo').catch(() => null);
  $('#content').insertAdjacentHTML('beforeend', `<section class="set"><h3>Über Sakura</h3>
    <p>Version ${esc(info && info.current || '')}. Sakura aktualisiert sich von selbst.</p>
    <p id="upd-msg" hidden></p>
    <div class="upd-bar" id="upd-bar" hidden><i></i></div>
    <div class="row"><button class="btn primary" id="upd-go">Nach Updates suchen</button><button class="btn" id="about-open">Mehr Infos</button><button class="btn" id="welcome-open">Willkommens-Tour</button></div></section>`);
  $('#welcome-open').onclick = () => api.call('welcomeOpen');
  $('#about-open').onclick = () => openPanel('about');
  bindUpdate(info);
  tagSections();
  showCat(location.hash.slice(1) || 'sync');
}

buildNav();
$('#q').addEventListener('input', e => search(e.target.value));
window.addEventListener('hashchange', () => showCat(location.hash.slice(1)));
// Design der Seite = gewähltes Sakura-Design
const applyLook = () => api.call('prefs').then(p => { if (window.SakuraThemes) SakuraThemes.apply(document.documentElement, p || {}); });
applyLook();
if (window.sakura.onTheme) window.sakura.onTheme(applyLook);
render();
// Synchronisationsstatus aktuell halten (nicht während einer Eingabe)
setInterval(async () => {
  const sec = $('#sync-section');
  if (!sec || sec.hidden || document.querySelector('#s-pw, #s-sync, #s-new, #s-codein')) return;
  const si = await api.call('syncInfo');
  const html = syncHtml(si);
  if (sec.dataset.last !== html) { sec.dataset.last = html; sec.innerHTML = html; bindSync(); }
}, 3000);
