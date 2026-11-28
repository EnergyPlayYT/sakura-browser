// Tab-Garten: alte Tabs welken in Stufen, Aufräumen schließt ab „verblüht“ und legt sie ins Tab-Archiv
const Module=require('module'),assert=require('assert');const mock=require('./electron-mock');
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
require(require('path').join(__dirname,'..')+'/main.js');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const realNow=Date.now; let off=0; Date.now=()=>realNow()+off;
setTimeout(async()=>{
  const ui=mock._all[0]; const call=(c,a)=>mock._handlers.ui({sender:ui},c,a);
  await call('newTab','https://alt.example/'); await wait(15);
  await call('newTab','https://mittel.example/'); await wait(15);   // „alt“ zuletzt benutzt: jetzt
  off=6*864e5;
  await call('newTab','https://frisch.example/'); await wait(15);   // „mittel“ zuletzt benutzt: vor 13 Std. (s. u.)
  off=6*864e5+13*36e5;
  let st=await call('state');
  const by=u=>st.tabs.find(t=>t.title.includes(u)||(t.url||'').includes(u));
  const tabs=Object.fromEntries(st.tabs.map(t=>[t.title,t]));
  const w=st.tabs.map(t=>t.wilt||0);
  assert.equal(w[w.length-1],0,'aktiver Tab frisch');
  assert.equal(w[w.length-2],1,'13 Std. = welkt');
  assert.equal(w[w.length-3],3,'über 5 Tage = vertrocknet');
  const before=st.tabs.length;
  const n=await call('gardenTidy'); assert(n>=1);
  st=await call('state'); assert.equal(st.tabs.length,before-n); assert(!st.tabs.some(t=>t.wilt>=2));
  assert((await call('archive')).some(a=>/alt\.example/.test(a.url)),'im Archiv');
  await call('setPrefs',{tabGarden:false}); st=await call('state'); assert(!st.tabs.some(t=>t.wilt),'abschaltbar');
  console.log('Tab-Garten ok'); process.exit(0);
},60);
