const Module=require('module'),assert=require('assert'),fs=require('fs'),path=require('path');
const mock=require('./electron-mock');
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
require(require('path').join(__dirname,'..')+'/main.js');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(async()=>{
  const ui=mock._all[0]; const call=(c,a)=>mock._handlers.ui({sender:ui},c,a);
  for (const u of ['https://a.de/','https://b.de/','https://c.de/','https://d.de/']) await call('newTab',u);
  await wait(30);
  let st=await call('state'); const [n0,a,b,c,d]=st.tabs.map(t=>t.id);
  const g=await call('groupNew',b); await wait(20);
  assert(ui.sent.some(([ch,x])=>ch==='edit-group'&&x===g));
  await call('groupAdd',{tabId:d,groupId:g}); st=await call('state');
  assert.deepEqual(st.tabs.map(t=>t.id),[n0,a,b,d,c],'d springt ans Ende der Gruppe');
  assert.deepEqual(st.tabs.map(t=>t.group||null),[null,null,g,g,null]);
  await call('groupUpdate',{id:g,name:'Arbeit',color:'matcha'}); st=await call('state'); assert.equal(st.groups[0].name,'Arbeit'); assert.equal(st.groups[0].color,'matcha');
  // neuer Tab aus einem Gruppen-Tab (Link) erbt die Gruppe
  const wcB=mock._all.find(w=>w.url==='https://b.de/'); wcB.openHandler({url:'https://link.de/',disposition:'foreground-tab'}); await wait(20);
  st=await call('state'); const link=st.tabs.find(t=>t.title.includes('link.de')||t.id===Math.max(...st.tabs.map(x=>x.id)));
  assert.equal(link.group,g);
  // a zwischen zwei Gruppen-Tabs ziehen → gehört dazu
  await call('moveTab',{id:a,index:2}); st=await call('state'); assert.equal(st.tabs.find(t=>t.id===a).group,g);
  // aus der Gruppe ganz nach hinten ziehen → keine Gruppe mehr
  await call('moveTab',{id:a,index:99}); st=await call('state'); assert.equal(st.tabs.find(t=>t.id===a).group,null);
  // Einklappen, während ein Gruppen-Tab aktiv ist → anderer Tab wird aktiv
  await call('activate',b); await call('groupToggle',g); st=await call('state');
  assert(st.groups[0].collapsed); assert.notEqual(st.tabs.find(t=>t.id===st.activeId).group,g);
  // Aktivieren eines Tabs in eingeklappter Gruppe klappt sie auf
  await call('activate',d); st=await call('state'); assert(!st.groups[0].collapsed);
  // Anheften entfernt aus Gruppe
  await call('tabMenu', d);
  // Sitzung merken
  await wait(40); mock.app.emit('before-quit');
  const data=JSON.parse(fs.readFileSync(path.join(mock.app.getPath('userData'),'sakura-data.json'),'utf8'));
  assert.equal(data.session[0].groups[0].name,'Arbeit'); assert(data.session[0].tabs.filter(t=>t.group).length>=3);
  // Gruppe schließen
  await call('groupClose',g); st=await call('state'); assert.equal(st.groups.length,0); assert(st.tabs.every(t=>!t.group));
  // Gruppe aufheben
  const g2=await call('groupNew',a); await call('groupUngroup',g2); st=await call('state'); assert.equal(st.groups.length,0); assert(st.tabs.some(t=>t.id===a));
  console.log('Tab-Gruppen ok'); process.exit(0);
},60);
