const Module=require('module'),assert=require('assert'),fs=require('fs'),path=require('path');
const mock=require('./electron-mock');
fs.writeFileSync(path.join(mock.app.getPath('userData'),'sakura-data.json'),JSON.stringify({prefs:{restoreSession:true,updatedAt:1},
 session:[{active:1,tabs:[{url:'https://a.de/',title:'A',pinned:true},{url:'https://b.de/',title:'B'},{url:'https://c.de/',title:'C'}]}]}));
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
process.argv.push('https://neu.de/');
require(require('path').join(__dirname,'..')+'/main.js');
setTimeout(async()=>{
  const ui=mock._all.find(w=>w.sent!==undefined && w.opts===undefined) ;
  const uiWc = mock._all[0];
  const st = await mock._handlers.ui({sender:uiWc},'state');
  assert.deepEqual(st.tabs.map(t=>t.title),['A','T https://b.de/','C','T https://neu.de/']);
  assert(st.tabs[0].pinned);
  const loaded = mock._all.filter(w=>w.url).map(w=>w.url);
  assert(!loaded.includes('https://a.de/') && !loaded.includes('https://c.de/'), 'Hintergrund-Tabs laden erst beim Öffnen');
  assert(loaded.includes('https://b.de/'));
  await mock._handlers.ui({sender:uiWc},'activate', st.tabs[2].id);
  assert(mock._all.some(w=>w.url==='https://c.de/'));
  console.log('Sitzung wiederherstellen ok'); process.exit(0);
},80);
