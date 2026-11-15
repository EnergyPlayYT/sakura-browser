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
  const denied = await mock._handlers.page({sender:tabWc,senderFrame:{url:'https://evil.com'}},'shortcuts'); assert.equal(denied,null);
  // Neue Funktionen
  await call('saveScript',{name:'T',match:['github.com'],code:'window.x=1'});
  assert.equal((await call('scripts')).length,1);
  const gh = mock._all.find(w=>w.url==='https://github.com');
  gh.emit('dom-ready'); assert(gh.executed && gh.executed.some(c=>c.includes('window.x=1')));
  assert(gh.executed.some(c=>c.includes('__sakuraCookieReject')), 'Cookie-Banner-Skript läuft');
  await call('toggleCookieAllow');
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
    assert((await call('importRun',{id:'99'})).error); }
  await new Promise(r=>setTimeout(r,40));
  // Sitzung wurde gemerkt
  await call('newPrivateWindow'); await new Promise(r=>setTimeout(r,30));
  const pui = mock._all.filter(w=>w.opts && w.opts.webPreferences && w.opts.webPreferences.preload && w.opts.webPreferences.preload.endsWith('preload-ui.js'));
  await new Promise(r=>setTimeout(r,30));
  mock.app.emit('before-quit');
  const data = JSON.parse(fs.readFileSync(path.join(mock.app.getPath('userData'),'sakura-data.json'),'utf8'));
  assert(data.session && data.session.length===1, 'nur das normale Fenster wird gemerkt'); assert(data.session[0].tabs.some(t=>t.url==='https://github.com'));
  console.log('main.js Rauchtest bestanden');
  process.exit(0);
},50);
