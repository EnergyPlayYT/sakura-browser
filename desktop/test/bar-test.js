const Module=require('module'),assert=require('assert');const mock=require('./electron-mock');
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
require(require('path').join(__dirname,'..')+'/main.js');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(async()=>{
  const ui=mock._all[0]; const call=(c,a)=>mock._handlers.ui({sender:ui},c,a);
  for (const u of ['https://a.de/','https://b.de/','https://c.de/']) { await call('newTab',u); await wait(15); await call('toggleBookmark'); }
  let st=await call('state'); assert.deepEqual(st.bar.map(b=>b.url),['https://a.de/','https://b.de/','https://c.de/'],'älteste zuerst');
  const tab=mock._all.find(w=>w.url==='https://c.de/'); assert.equal(tab.view.bounds.y, 40+46+32, 'Seite beginnt unter der Leiste');
  await call('bmMove',{id:st.bar[2].id,index:0}); st=await call('state'); assert.equal(st.bar[0].url,'https://c.de/');
  await call('bmOpen',{url:'https://b.de/',newTab:true}); await call('bmOpen',{url:'javascript:alert(1)'});
  await call('toggleBar'); await wait(30); st=await call('state'); assert.equal(st.bar,null);
  const act=mock._all.filter(w=>w.view&&w.view.visible).pop(); assert.equal(act.view.bounds.y, 86, 'ohne Leiste wieder oben');
  await call('toggleBar'); st=await call('state'); assert(st.bar.length===3);
  await call('bmMenu', st.bar[0].id);
  console.log('Favoritenleiste ok'); process.exit(0);
},60);
