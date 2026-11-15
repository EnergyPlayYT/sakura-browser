const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {Favicons,sniff}=require(require('path').join(__dirname,'..')+'/lib/favicons');
const png=Buffer.from('89504e470d0a1a0a0000000d49484452','hex'); const ico=Buffer.from([0,0,1,0,1,0]);
assert.equal(sniff(png),'image/png'); assert.equal(sniff(ico),'image/x-icon'); assert.equal(sniff(Buffer.from('<!doctype html><html>')),null); assert.equal(sniff(Buffer.from('<svg xmlns="x"></svg>')),'image/svg+xml');
const calls=[]; const store={data:{},save(){}};
const fetchFn=async u=>{ calls.push(u); if(u==='https://site.de/logo.png') return {ok:true,arrayBuffer:async()=>png}; if(u==='https://other.de/favicon.ico') return {ok:true,arrayBuffer:async()=>ico}; if(u==='https://html.de/favicon.ico') return {ok:true,arrayBuffer:async()=>Buffer.from('<html>404</html>')}; return {ok:false,status:404}; };
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fav')); const f=new Favicons({dir,store,fetchFn});
(async()=>{
  f.remember('https://site.de/seite','https://site.de/logo.png'); await new Promise(r=>setTimeout(r,20));
  let r=await f.respond('https://site.de/andere'); assert.equal(r.status,200); assert.equal(r.headers.get('content-type'),'image/png');
  r=await f.respond('https://other.de/'); assert.equal(r.status,200); assert.equal(r.headers.get('content-type'),'image/x-icon');
  r=await f.respond('https://html.de/'); assert.equal(r.status,404,'HTML ist kein Logo');
  const n=calls.length; await f.respond('https://html.de/'); assert.equal(calls.length,n,'Fehlschlag wird nicht sofort wiederholt');
  await new Promise(r=>setTimeout(r,30));
  const f2=new Favicons({dir,store,fetchFn}); const c=calls.length; r=await f2.respond('https://site.de/'); assert.equal(r.status,200); assert.equal(calls.length,c,'von der Festplatte');
  assert.equal((await f.respond('file:///c:/x')).status,404);
  console.log('Logos ok');
})().catch(e=>{console.error(e);process.exit(1)});
