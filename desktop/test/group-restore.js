const Module=require('module'),assert=require('assert'),fs=require('fs'),path=require('path');
const mock=require('./electron-mock');
fs.writeFileSync(path.join(mock.app.getPath('userData'),'sakura-data.json'),JSON.stringify({prefs:{restoreSession:true,updatedAt:1},
 session:[{active:0,groups:[{id:'g7',name:'Rezepte',color:'matcha',collapsed:true}],tabs:[{url:'https://x.de/',title:'X'},{url:'https://r1.de/',title:'R1',group:'g7'},{url:'https://r2.de/',title:'R2',group:'g7'}]}]}));
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
require(require('path').join(__dirname,'..')+'/main.js');
setTimeout(async()=>{
  const st=await mock._handlers.ui({sender:mock._all[0]},'state');
  assert.equal(st.groups.length,1); assert.equal(st.groups[0].name,'Rezepte'); assert(st.groups[0].collapsed); assert.equal(st.groups[0].count,2);
  assert.deepEqual(st.tabs.map(t=>!!t.group),[false,true,true]);
  console.log('Gruppen nach Neustart ok'); process.exit(0);
},80);
