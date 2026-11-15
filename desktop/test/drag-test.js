const Module=require('module'),assert=require('assert');const mock=require('./electron-mock');
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
require(require('path').join(__dirname,'..')+'/main.js');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(async()=>{
  const ui1=mock._all[0]; const call=(ui,c,a)=>mock._handlers.ui({sender:ui},c,a);
  await call(ui1,'newTab','https://video.de/'); await wait(20);
  let st=await call(ui1,'state'); const vid=st.tabs[1].id; assert.equal(st.tabs.length,2);
  const vidWc=mock._all.find(w=>w.url==='https://video.de/');
  // über der eigenen Tableiste losgelassen → nichts
  mock.screen.cursor={x:400,y:120}; assert.equal(await call(ui1,'tabDragEnd',vid),'none');
  // mitten auf den Bildschirm gezogen → neues Fenster
  mock.screen.cursor={x:900,y:600}; assert.equal(await call(ui1,'tabDragEnd',vid),'detached'); await wait(40);
  st=await call(ui1,'state'); assert.equal(st.tabs.length,1);
  const ui2=mock._all.filter(w=>w.view&&w.view.opts.webPreferences.preload.endsWith('preload-ui.js')).pop();
  let st2=await call(ui2,'state'); assert.deepEqual(st2.tabs.map(t=>t.id),[vid],'Tab im neuen Fenster');
  assert(!vidWc.destroyed,'Seite wurde nicht geschlossen'); assert.equal(vidWc.url,'https://video.de/','nicht neu geladen');
  // Titeländerung landet jetzt beim neuen Fenster
  vidWc.emit('page-title-updated',{},'Video läuft'); await wait(30); st2=await call(ui2,'state'); assert.equal(st2.tabs[0].title,'Video läuft');
  // zurück auf die Tableiste von Fenster 1 ziehen → zusammenführen, Fenster 2 schließt sich
  mock.screen.cursor={x:300,y:115}; assert.equal(await call(ui2,'tabDragEnd',vid),'merged'); await wait(40);
  st=await call(ui1,'state'); assert.equal(st.tabs.length,2); assert.equal(st.activeId,vid);
  // einziger Tab rausgezogen → Fenster wird verschoben
  const one=st.tabs.find(t=>t.id!==vid).id; await call(ui1,'closeTab',vid); await wait(10);
  mock.screen.cursor={x:700,y:500}; assert.equal(await call(ui1,'tabDragEnd',one),'moved');
  // per Menü
  await call(ui1,'newTab','https://x.de/'); await wait(10); st=await call(ui1,'state');
  await call(ui1,'tabToNewWindow',st.tabs[1].id); await wait(30); st=await call(ui1,'state'); assert.equal(st.tabs.length,1);
  console.log('Tabs herausziehen ok'); process.exit(0);
},60);
