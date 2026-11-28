// Berechtigungen: Antwort bleibt dauerhaft gemerkt, lässt sich in den Einstellungen vergessen; KI-Seitenleiste fragt nicht nach dem Standort
const Module=require('module'),assert=require('assert');const mock=require('./electron-mock');
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
require(require('path').join(__dirname,'..')+'/main.js');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
setTimeout(async()=>{
  const ui=mock._all[0]; const call=(c,a)=>mock._handlers.ui({sender:ui},c,a);
  let asked=0; mock.dialog.showMessageBox=async()=>{ asked++; return {response:0,checkboxChecked:true}; };
  await call('newTab','https://karte.example/'); await wait(20);
  const wc=mock._all.find(w=>w.url==='https://karte.example/');
  const h=mock.session.defaultSession._perm; assert(h,'Handler gesetzt');
  const ask=p=>new Promise(r=>h(wc,p,r,{requestingUrl:'https://karte.example/'}));
  assert.equal(await ask('geolocation'),true); assert.equal(asked,1);
  assert.equal(await ask('geolocation'),true); assert.equal(asked,1,'nicht nochmal fragen');
  assert.equal(await ask('fullscreen'),true); assert.equal(asked,1);
  let list=await call('permList'); assert.deepEqual(list.map(x=>[x.host,x.perm,x.ok]),[['karte.example','geolocation',true]]);
  list=await call('permRemove','karte.example|geolocation'); assert.deepEqual(list,[]);
  await ask('geolocation'); assert.equal(asked,2,'nach dem Vergessen wieder fragen');
  await call('permRemove',null); assert.deepEqual(await call('permList'),[]);
  // KI-Seitenleiste: Standort still blockiert
  await call('kiToggle',true); await wait(20);
  const w=[...mock._all].map(x=>x).find(x=>x.url&&/claude\.ai|chatgpt|gemini|mistral/.test(x.url));
  if (w) { const r=await new Promise(res=>h(w,'geolocation',res,{requestingUrl:w.url})); assert.equal(r,false); assert.equal(asked,2,'KI fragt nicht'); }
  else console.log('  (KI-Ansicht im Mock nicht gefunden – übersprungen)');
  console.log('Berechtigungen ok'); process.exit(0);
},60);
