const Module=require('module'); const assert=require('assert'); const fs=require('fs'),path=require('path');
const mock=require('./electron-mock');
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
require(require('path').join(__dirname,'..')+'/main.js');
assert(!/Electron|sakura-browser/.test(mock.app.userAgentFallback));
setTimeout(async()=>{
  const ui = mock._all[0]; // erste Oberfläche
  const call=(c,a)=>mock._handlers.ui({sender:ui},c,a);
  let st = await call('state'); assert.equal(st.tabs.length,1); assert.equal(st.url,'');
  await call('navigate','github.com');
  await new Promise(r=>setTimeout(r,30));
  st = await call('state'); assert.equal(st.url,'https://github.com'); assert.equal(st.secure,true);
  await call('toggleBookmark'); await new Promise(r=>setTimeout(r,5));
  st = await call('state'); assert.equal(st.bookmarked,true);
  await call('newTab'); await call('newTab','https://example.org');
  await new Promise(r=>setTimeout(r,30));
  st = await call('state'); assert.equal(st.tabs.length,3); assert.equal(st.url,'https://example.org');
  await call('moveTab',{id:st.tabs[2].id,index:0}); st=await call('state'); assert.equal(st.activeId, st.tabs[0].id);
  await call('closeTab', st.activeId); st=await call('state'); assert.equal(st.tabs.length,2);
  const h = await call('history',''); assert(h.some(x=>x.url==='https://github.com'));
  const sug = await call('suggest','git'); assert.equal(sug[0].url,'https://github.com');
  await call('zoom',0.5); st=await call('state'); assert.equal(st.zoom,110);
  await call('overlay',true);
  // newtab page api
  const tabWc = mock._all.find(w=>w.url.startsWith('sakura://newtab'));
  const page=(c,a)=>mock._handlers.page({sender:tabWc,senderFrame:{url:'sakura://newtab/'}},c,a);
  let sc = await page('saveShortcut',{title:'',url:'netflix.com'}); assert(sc.some(s=>s.title==='netflix.com'));
  const bad = await page('saveShortcut',{title:'x',url:'kein link'}); assert(bad.error);
  assert(Array.isArray(await page('builtinBackgrounds')), 'Liste der mitgelieferten Hintergrundbilder');
  // Multistream: nur von sakura://multistream, Kanalnamen werden geprüft
  { const mp=(url, list)=>mock._handlers.page({sender:tabWc,senderFrame:{url, parent:null}},'multistream',list);
    assert.equal(await mp('sakura://newtab/', ['a1']), null);
    assert(/mindestens/.test((await mp('sakura://multistream/', ['../böse', ''])).error));
    const before = mock._all.length;
    assert.deepEqual(await mp('sakura://multistream/', ['Papaplatte', 'gronkh', 'x', 'trymacs', 'zu_viel', 'fuenfter']), {ok:true});
    const players = mock._all.slice(before).map(w=>w.url).filter(u=>u.startsWith('https://player.twitch.tv'));
    assert.deepEqual(players.map(u=>new URL(u).searchParams.get('channel')), ['papaplatte','gronkh','trymacs','zu_viel'], 'max. 4, ungültige raus'); }
  // Einstellungsseite: nur sakura://settings (oberster Rahmen), nur erlaubte Befehle
  { const sp=(url, cmd, arg, parent=null)=>mock._handlers.page({sender:tabWc,senderFrame:{url, parent}},'settings',{cmd,arg});
    assert.equal((await sp('sakura://settings/','prefs')).searchEngine,'google');
    assert.equal(await sp('sakura://newtab/','prefs'), null, 'Startseite darf das nicht');
    assert.equal(await sp('sakura://settings/','pwReveal','x'), null, 'Passwörter nicht über die Einstellungsseite');
    assert.equal(await sp('sakura://settings/','prefs',null,{url:'https://evil.com'}), null, 'nicht im eingebetteten Rahmen'); }
  const denied = await mock._handlers.page({sender:tabWc,senderFrame:{url:'https://evil.com'}},'shortcuts'); assert.equal(denied,null);
  // Neue Funktionen
  await call('saveScript',{name:'T',match:['github.com'],code:'window.x=1'});
  assert.equal((await call('scripts')).length,1);
  const gh = mock._all.find(w=>w.url==='https://github.com');
  gh.emit('dom-ready'); assert(gh.executed && gh.executed.some(c=>c.includes('window.x=1')));
  assert(gh.executed.some(c=>c.includes('__sakuraCookieReject')), 'Cookie-Banner-Skript läuft');
  await call('toggleCookieAllow');
  // Twitch-Skript nur auf twitch.tv
  { await call('newTab','https://www.twitch.tv/papaplatte'); await new Promise(r=>setTimeout(r,30));
    const tw = mock._all.find(w=>w.url==='https://www.twitch.tv/papaplatte'); tw.emit('dom-ready');
    assert(tw.executed.some(c=>c.includes('__sakuraTwitchConfig = {"emotes":true,"points":false}')));
    assert.deepEqual(await mock._handlers['twitch-emotes']({senderFrame:{url:'https://evil.com/'}}, 'papaplatte'), {}); }
  // YouTube-Skript nur auf youtube.com, Sponsor-Abfrage nur von dort
  await call('newTab','https://www.youtube.com/watch?v=dQw4w9WgXcQ'); await new Promise(r=>setTimeout(r,30));
  const yt = mock._all.find(w=>w.url.startsWith('https://www.youtube.com'));
  yt.emit('dom-ready'); assert(yt.executed.some(c=>c.includes('__sakuraYTConfig = {"quality":"hd1080","sponsorblock":true}')) && yt.css && yt.css[0].includes('ytd-ad-slot-renderer'));
  assert(!gh.executed.some(c=>c.includes('__sakuraYTConfig')), 'nicht auf anderen Seiten');
  assert.deepEqual(await mock._handlers['yt-segments']({senderFrame:{url:'https://evil.com/'}},'dQw4w9WgXcQ'), []);
  await call('setPrefs',{youtube:false}); yt.executed=[]; yt.emit('dom-ready'); assert(!yt.executed.some(c=>c.includes('__sakuraYTConfig'))); await call('setPrefs',{youtube:true}); gh.executed=[]; gh.emit('dom-ready'); assert(!gh.executed.some(c=>c.includes('__sakuraCookieReject')), 'Ausnahme gilt');
  await call('toggleCookieAllow');
  st = await call('state'); 
  const t0 = st.tabs[0].id; await call('tabMenu', t0);
  await call('toggleMute', st.activeId); st = await call('state'); assert(st.tabs.find(t=>t.id===st.activeId).muted);
  const w0 = [...require('module')._cache[require.resolve(require('path').join(__dirname,'..')+'/main.js')] ? [] : []];
  await call('newTab','https://chromewebstore.google.com/detail/ublock/ddkjiahejlhfcafbddmgiahcphecmpfh'); await new Promise(r=>setTimeout(r,30));
  const storeWc = mock._all.find(w=>w.url.startsWith('https://chromewebstore'));
  const ws = await mock._handlers.webstore({sender:storeWc,senderFrame:{url:storeWc.url}},'status','ddkjiahejlhfcafbddmgiahcphecmpfh');
  assert.deepEqual(ws,{installed:false,busy:false,unavailable:false});
  assert.equal(await mock._handlers.webstore({sender:storeWc,senderFrame:{url:'https://evil.com/'}},'install','ddkjiahejlhfcafbddmgiahcphecmpfh'), null);
  st = await call('state');
  assert.deepEqual(st.extActions,[]); assert.equal(st.downloads.any,false);
  await call('navigate','chrome://extensions'); assert(ui.sent.some(([c,d])=>c==='open-panel'&&d==='extensions'));
  const r = await call('setPrefs',{siteTheme:'force'}); assert.equal(r.restart,true);
  await call('setPrefs',{siteTheme:'system'});
  // Design wechseln: Farben kommen im Zustand mit, ungültige Werte werden ignoriert
  await call('setPrefs',{theme:'neon',accent:'#123456'}); st=await call('state'); assert.equal(st.theme.vars['--sakura'],'#123456'); assert.equal(st.theme.vars['--yoru'],'#150B28');
  await call('setPrefs',{theme:'<x>',accent:'rot'}); assert.equal((await call('prefs')).theme,'neon');
  await call('setPrefs',{theme:'sakura',accent:''});
  assert(await call('devices'));
  // Videostellen: Schlüssel ist die eigene Adresse (ohne Zeitangabe), privat wird nichts gemerkt
  { const vp = mock._handlers['video-pos']; const ghTab = mock._all.find(w=>w.url==='https://github.com');
    await vp({sender:ghTab, senderFrame:{url:'https://github.com/?t=99#x'}}, 'set', {t:321, d:1200});
    assert.deepEqual(await vp({sender:ghTab, senderFrame:{url:'https://github.com/'}}, 'get'), {t:321, d:1200});
    assert.equal(await vp({sender:ghTab, senderFrame:{url:'https://andere.de/'}}, 'get'), null);
    assert.equal(await vp({sender:{}, senderFrame:{url:'https://github.com/'}}, 'get'), null, 'fremder Absender');
    ghTab.executed=[]; ghTab.emit('dom-ready'); assert(ghTab.executed.some(c=>c.includes('__sakuraVideoConfig = {"resume":true,"intro":true,"next":true}')), 'Video-Skript läuft'); }
  // Popup-Blocker
  { st = await call('state'); const opener = mock._all.find(w=>w.url==='https://github.com'); const n0 = (await call('state')).tabs.length;
    await call('activate', st.tabs.find(t=>t.title.includes('github.com')).id);
    assert.equal(opener.openHandler({url:'https://werbung.example/', disposition:'foreground-tab', features:''}).action, 'deny');
    st = await call('state'); assert.equal(st.tabs.length, n0, 'ohne Klick blockiert'); assert.equal(st.popups, 1);
    opener.emit('input-event', {}, {type:'mouseDown'});
    opener.openHandler({url:'https://github.com/neu', disposition:'foreground-tab', features:''}); await new Promise(r=>setTimeout(r,20));
    st = await call('state'); assert.equal(st.tabs.length, n0+1, 'nach Klick erlaubt');
    await call('activate', st.tabs.find(t=>t.title.includes('https://github.com') && !t.title.includes('neu')).id);
    await call('popupOpenLast'); await new Promise(r=>setTimeout(r,20)); st = await call('state'); assert.equal(st.tabs.length, n0+2, 'trotzdem öffnen');
    st = await call('state'); await call('activate', st.tabs.find(t=>t.title==='T https://github.com').id);
    await call('togglePopupAllow'); assert((await call('prefs')).popupAllow.includes('github.com'));
    assert.equal(opener.openHandler({url:'https://werbung.example/2', disposition:'foreground-tab', features:''}).action, 'deny'); // geht als Tab auf
    st = await call('state'); assert.equal(st.tabs.length, n0+3, 'Ausnahme: erlaubt'); await call('togglePopupAllow');
  }
  // Streamer-Modus von Hand: Zustand für die Oberfläche
  { assert.equal((await call('state')).streamer, null);
    assert.equal(await call('streamerToggle'), true); st = await call('state'); assert.deepEqual(st.streamer, {app:null, manual:true});
    assert.equal(await call('streamerToggle'), false); assert.equal((await call('prefs')).streamerMode, 'auto'); }
  // Seitenüberwachung
  { st = await call('state'); const awc = mock._all.find(x=>x.view && x.url===st.url && !x.destroyed);
    awc.jsResult = { title:'Kopfhörer', price: 59.9, currency:'€', available:true };
    const r = await call('watchPage'); assert(r.ok, r.error); awc.jsResult = undefined;
    let wl = await call('watches'); assert.equal(wl.length, 1); assert.equal(wl[0].priceText, '59,90 €');
    wl = await call('watchCheckNow'); assert.equal(wl[0].error, 'Preis nicht mehr gefunden', 'unsichtbare Seite ohne Preis');
    await call('watchRemove', wl[0].id); assert.equal((await call('watches')).length, 0); }
  // Konto-Tabs: eigene Sitzung, Links bleiben im Konto, Name und Neustart
  { const parts=[]; const origFP = mock.session.fromPartition; mock.session.fromPartition = p => { parts.push(p); return origFP(p); };
    await call('newContainerTab', 2); await new Promise(r=>setTimeout(r,20));
    st = await call('state'); const kt = st.tabs.find(t=>t.id===st.activeId);
    assert.deepEqual(kt.container, {n:2, name:'Konto 2', color:'sora'}); assert(parts.includes('persist:sakura-konto-2'));
    await call('setPrefs',{containerNames:['','Arbeit']}); st = await call('state'); assert.equal(st.tabs.find(t=>t.id===kt.id).container.name, 'Arbeit');
    const kwc = mock._all.filter(w=>w.view && w.view.opts && w.view.opts.webPreferences && w.view.opts.webPreferences.preload).pop();
    kwc.emit('input-event',{}, {type:'mouseDown'}); kwc.url='https://mail.example/'; kwc.openHandler({url:'https://mail.example/2', disposition:'foreground-tab'}); await new Promise(r=>setTimeout(r,20));
    st = await call('state'); assert.equal(st.tabs.find(t=>t.id===st.activeId).container.n, 2, 'Link bleibt im Konto-Tab');
    mock.session.fromPartition = origFP; await call('setPrefs',{containerNames:[]});
    assert.equal(await call('clearContainer', 9), false); }
  // Passwortmanager
  { const pwc = mock._all.find(w=>w.url==='https://github.com'); const fr={url:'https://github.com/login'};
    const orig = mock.dialog.showMessageBox; let asked = 0; mock.dialog.showMessageBox = async () => { asked++; return { response: 0 }; };
    mock._handlers['on:pw-submit']({sender:pwc, senderFrame:fr}, {username:'ali', password:'geheim'}); await new Promise(r=>setTimeout(r,20));
    assert.equal(asked, 1, 'fragt „Passwort speichern?“');
    mock._handlers['on:pw-submit']({sender:pwc, senderFrame:fr}, {username:'ali', password:'geheim'}); await new Promise(r=>setTimeout(r,20));
    assert.equal(asked, 1, 'gleiches Passwort: nicht noch einmal fragen');
    mock.dialog.showMessageBox = orig;
    const acc = await mock._handlers['pw-accounts']({sender:pwc, senderFrame:fr}); assert.deepEqual(acc.map(a=>a.username), ['ali']);
    assert.deepEqual(await mock._handlers['pw-accounts']({sender:pwc, senderFrame:{url:'https://evil.com/'}}), []);
    pwc.emit('input-event', {}, {type:'mouseDown'});
    assert.deepEqual(await mock._handlers['pw-fill']({sender:pwc, senderFrame:fr}, acc[0].id), {username:'ali', password:'geheim'});
    assert.equal(await mock._handlers['pw-fill']({sender:pwc, senderFrame:{url:'https://evil.com/'}}, acc[0].id), null, 'fremde Seite');
    const list = await call('pwList'); assert(list.available && list.entries.length===1 && !('password' in list.entries[0]));
    assert.equal(await call('pwReveal', acc[0].id), 'geheim');
    const raw = fs.readFileSync(path.join(mock.app.getPath('userData'),'passwoerter.bin'),'utf8'); assert(!raw.includes('geheim'));
    // Ausgeschaltet: keine Konten, kein Ausfüllen, keine Frage – gespeicherte Passwörter bleiben
    await call('setPrefs',{passwordManager:false});
    assert.deepEqual(await mock._handlers['pw-accounts']({sender:pwc, senderFrame:fr}), []);
    pwc.emit('input-event', {}, {type:'mouseDown'}); assert.equal(await mock._handlers['pw-fill']({sender:pwc, senderFrame:fr}, acc[0].id), null);
    let asked2 = 0; mock.dialog.showMessageBox = async () => { asked2++; return { response: 0 }; };
    mock._handlers['on:pw-submit']({sender:pwc, senderFrame:fr}, {username:'neu', password:'x'}); await new Promise(r=>setTimeout(r,20));
    assert.equal(asked2, 0); mock.dialog.showMessageBox = orig;
    const off = await call('pwList'); assert.equal(off.enabled, false); assert.equal(off.entries.length, 1);
    await call('setPrefs',{passwordManager:true});
    await call('pwClear'); assert.equal((await call('pwList')).entries.length, 0); }
  // Video und Ton
  { await call('navigate','https://kino.example/film'); await new Promise(r=>setTimeout(r,30));
    const kwc = mock._all.find(w=>w.url==='https://kino.example/film'); kwc.jsResult = { hasVideo:true, notes:[] };
    assert.deepEqual(await call('mediaSet',{bass:99, eq:[20,-30,1,2,'x'], brightness:5}), { hasVideo:true, notes:[] });
    const ms = await call('mediaState'); assert.equal(ms.host,'kino.example'); assert.equal(ms.bass,12); assert.deepEqual(ms.eq,[12,-12,1,2,0]); assert.equal(ms.brightness,30);
    assert(kwc.executed.some(c=>c.includes('__sakuraMedia.apply({"brightness":30,"bass":12')), 'Einstellungen an die Seite');
    kwc.executed=[]; kwc.emit('dom-ready'); assert(kwc.executed.some(c=>c.includes('__sakuraMedia.apply')), 'beim nächsten Laden automatisch');
    await call('mediaReset'); assert.equal((await call('mediaState')).bass, 0);
    await call('sleepSet',{minutes:30}); st = await call('state'); assert.equal(st.sleep.mode,'time'); assert(st.sleep.until > Date.now()+29*60e3);
    await call('sleepSet',{episode:true}); st = await call('state'); assert.equal(st.sleep.mode,'episode');
    await call('sleepSet',{minutes:0}); st = await call('state'); assert.equal(st.sleep, null);
    kwc.jsResult = undefined; }
  // Schwebendes Video
  { st = await call('state'); const act = st.activeId; const awc = mock._all.find(x=>x.view && ui && x.url===st.url && !x.destroyed);
    const win0 = mock._all.length; awc.jsResult = true;
    const r = await call('floatVideo'); assert.deepEqual(r, {ok:true});
    st = await call('state'); assert(st.tabs.find(t=>t.id===act).floating, 'Tab schwebt'); assert.notEqual(st.activeId, act, 'Hauptfenster zeigt anderen Tab');
    assert(mock.globalShortcut.keys.has('CommandOrControl+Alt+K'));
    assert(awc.css.some(c=>c.includes('data-sakura-float')));
    await call('floatThrough');
    await call('activate', act); await new Promise(r=>setTimeout(r,5));
    st = await call('state'); assert(!st.tabs.find(t=>t.id===act).floating); assert.equal(st.activeId, act, 'Video zurück im Tab');
    assert(!mock.globalShortcut.keys.has('CommandOrControl+Alt+K'));
    assert(awc.executed.some(c=>c.includes('removeAttribute(\'data-sakura-float\')')));
    awc.jsResult = undefined;
  }
  // Leistung: Tabs schlafen legen
  { st = await call('state'); const bg = st.tabs.find(t=>t.id!==st.activeId);
    const perf = await call('perf'); assert(perf.tabs.length===st.tabs.length && 'ping' in perf && perf.system.memTotal>0);
    assert.equal(await call('sleepTab', st.activeId), false, 'aktiver Tab schläft nicht');
    const awake = perf.tabs.filter(t=>!t.active && !t.sleeping && /^https?:/.test(t.url));
    if (awake.length) {
      assert.equal(await call('sleepTab', awake[0].id), true); await new Promise(r=>setTimeout(r,30));
      st = await call('state'); const t = st.tabs.find(x=>x.id===awake[0].id); assert(t.sleeping, 'Tab schläft');
      assert.notEqual(t.title, 'T about:blank', 'Titel bleibt'); await call('activate', t.id); await new Promise(r=>setTimeout(r,30));
      st = await call('state'); assert(!st.tabs.find(x=>x.id===t.id).sleeping); assert.equal(st.url, awake[0].url, 'lädt beim Anklicken wieder');
    } else assert.fail('kein Hintergrund-Tab zum Testen');
    await call('setPrefs',{sleepAfter:0,ramLimit:0,cpuLimit:0}); assert.deepEqual(await call('autoSleepNow'), []);
    await call('setPrefs',{ramLimit:1}); const picked = await call('autoSleepNow'); assert(Array.isArray(picked));
    await call('setPrefs',{ramLimit:0,sleepAfter:30});
  }
  // Import: nachgebautes Edge-Profil
  { const L=fs.mkdtempSync(path.join(require('os').tmpdir(),'la')), d=path.join(L,'Microsoft','Edge','User Data','Default');
    fs.mkdirSync(d,{recursive:true}); fs.writeFileSync(path.join(d,'Bookmarks'),JSON.stringify({roots:{bookmark_bar:{children:[{type:'url',name:'Bing',url:'https://www.bing.com/'}]}}}));
    process.env.LOCALAPPDATA=L; delete process.env.APPDATA;
    const src=await call('importSources'); assert.deepEqual(src.map(x=>x.label),['Edge']);
    const r=await call('importRun',{id:src[0].id}); assert.equal(r.message,'Ein Lesezeichen aus Edge übernommen.');
    assert((await call('importRun',{id:'99'})).error);
    fs.mkdirSync(path.join(d,'Network')); const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync(path.join(d,'Network','Cookies'));
    db.exec("CREATE TABLE cookies (host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_secure INTEGER, is_httponly INTEGER, samesite INTEGER); INSERT INTO cookies VALUES ('.bing.com','MUID','123',x'','/',0,1,0,-1)"); db.close();
    const rc=await call('importRun',{id:src[0].id,bookmarks:false,history:false,cookies:true}); assert.equal(rc.message,'Ein Cookie aus Edge übernommen.');
    assert(mock.session.defaultSession.cookies.jar.some(c=>c.name==='MUID'&&c.domain==='.bing.com'&&c.url==='https://bing.com/')); }
  await new Promise(r=>setTimeout(r,40));
  // Sitzung wurde gemerkt
  await call('newPrivateWindow'); await new Promise(r=>setTimeout(r,30));
  const pui = mock._all.filter(w=>w.opts && w.opts.webPreferences && w.opts.webPreferences.preload && w.opts.webPreferences.preload.endsWith('preload-ui.js'));
  await new Promise(r=>setTimeout(r,30));
  mock.app.emit('before-quit');
  const data = JSON.parse(fs.readFileSync(path.join(mock.app.getPath('userData'),'sakura-data.json'),'utf8'));
  assert(data.session && data.session.length===1, 'nur das normale Fenster wird gemerkt');
  assert(data.session[0].tabs.some(t=>t.container===2), 'Konto-Tabs werden gemerkt'); assert(data.session[0].tabs.some(t=>t.url==='https://github.com'));
  console.log('main.js Rauchtest bestanden');
  process.exit(0);
},50);
