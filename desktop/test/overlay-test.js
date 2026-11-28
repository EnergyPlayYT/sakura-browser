// Spiele-Overlay: Tab wandert ins Overlay-Fenster, Tasten registriert, Deckkraft gemerkt, zurück in den Tab
const Module=require('module'),assert=require('assert');const mock=require('./electron-mock');
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
require(require('path').join(__dirname,'..')+'/main.js');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(async()=>{
  const ui=mock._all[0]; const call=(c,a)=>mock._handlers.ui({sender:ui},c,a);
  await call('newTab','https://chat.example/'); await wait(20);
  let st=await call('state'); const id=st.activeId;
  const r=await call('gameOverlay'); assert.deepEqual(r,{ok:true});
  st=await call('state'); assert(st.tabs.find(t=>t.id===id).floating,'Tab schwebt'); assert.notEqual(st.activeId,id);
  assert(mock.globalShortcut.keys.has('CommandOrControl+Alt+O') && mock.globalShortcut.keys.has('CommandOrControl+Alt+L'));
  const head=mock._all.find(w=>/overlay\.html$/.test(w.url||w.file||''));
  const hcall=(c,a)=>mock._handlers.ui({sender:head},c,a);
  if (head) { const s=await hcall('overlayState'); assert.equal(s.opacity,90); await hcall('overlayCmd',{act:'opacity',value:60}); assert.equal((await hcall('overlayState')).opacity,60); }
  else { await call('overlayCmd',{act:'opacity',value:60}); }
  await call('overlayCmd',{act:'through'});
  await call('overlayCmd',{act:'back'}); await wait(20);
  st=await call('state'); assert(!st.tabs.find(t=>t.id===id).floating); assert.equal(st.activeId,id,'wieder aktiv');
  assert(!mock.globalShortcut.keys.has('CommandOrControl+Alt+O'),'Tasten wieder frei');
  console.log('Spiele-Overlay ok'+(head?'':' (ohne Kopfleisten-Prüfung)')); process.exit(0);
},60);
