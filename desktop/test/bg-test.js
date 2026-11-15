const Module=require('module'),assert=require('assert');const mock=require('./electron-mock');
const orig=Module._load; Module._load=function(r,...a){ return r==='electron'?mock:orig.call(this,r,...a); };
require(require('path').join(__dirname,'..')+'/main.js');
setTimeout(async()=>{
  const ui=mock._all[0]; const call=(c,a)=>mock._handlers.ui({sender:ui},c,a);
  const nt=mock._all.find(w=>w.url.startsWith('sakura://newtab')); assert.equal(nt.view.bg,'#1C1A33','Startseite dunkel');
  await call('newTab','https://consent.google.com/'); await new Promise(r=>setTimeout(r,20));
  const g=mock._all.find(w=>w.url==='https://consent.google.com/'); assert.equal(g.view.bg,'#FFFFFF','Webseite weiß');
  nt.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false,url:'https://example.com/'}); assert.equal(nt.view.bg,'#FFFFFF');
  nt.emit('did-start-navigation',{isMainFrame:true,isSameDocument:false,url:'sakura://newtab/'}); assert.equal(nt.view.bg,'#1C1A33');
  console.log('Hintergrund ok'); process.exit(0);
},60);
