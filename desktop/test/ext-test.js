const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const {Extensions,webstoreIdFromUrl,crxUrl}=require(require('path').join(__dirname,'..')+'/lib/extensions');
const ID=fs.readFileSync(require('path').join(require('os').tmpdir(),'sakura-test-id.txt'),'utf8'); const CRX=fs.readFileSync(require('path').join(require('os').tmpdir(),'sakura-test.crx'));
assert.equal(webstoreIdFromUrl('https://chromewebstore.google.com/detail/ublock-origin-lite/ddkjiahejlhfcafbddmgiahcphecmpfh?hl=de'),'ddkjiahejlhfcafbddmgiahcphecmpfh');
assert.equal(webstoreIdFromUrl('https://chromewebstore.google.com/detail/ddkjiahejlhfcafbddmgiahcphecmpfh'),'ddkjiahejlhfcafbddmgiahcphecmpfh');
assert.equal(webstoreIdFromUrl('https://chrome.google.com/webstore/detail/x/ddkjiahejlhfcafbddmgiahcphecmpfh'),'ddkjiahejlhfcafbddmgiahcphecmpfh');
assert.equal(webstoreIdFromUrl('https://chromewebstore.google.com/category/extensions'),null);
assert(crxUrl(ID,'140.0.1').includes('id%3D'+ID));
const loaded=new Map();
const ses={extensions:{loadExtension:async(p)=>{const mf=JSON.parse(fs.readFileSync(path.join(p,'manifest.json')));const e={id:ID,path:p,manifest:mf,name:mf.name};loaded.set(ID,e);return e},removeExtension:id=>loaded.delete(id)}};
const store={data:{extensions:[]},save(){}};
let version='1.4.2', asked=[];
const fetchFn=async url=>{ let buf=CRX; return {ok:true,status:200,arrayBuffer:async()=>buf}; };
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'exts'));
const ex=new Extensions({ses,store,dir,fetchFn,confirm:async i=>{asked.push(i);return true}});
(async()=>{
  await ex.init();
  const r=await ex.installFromStore(ID); assert(r.ok, JSON.stringify(r));
  assert.equal(asked[0].name,'Testerweiterung'); assert.deepEqual(asked[0].permissions,['Alle Daten auf allen Websites lesen und ändern','Deinen Browserverlauf lesen']);
  const l=ex.list(); assert.equal(l.length,1); assert.equal(l[0].version,'1.4.2'); assert(l[0].icon.startsWith('data:image/png;base64,')); assert.equal(l[0].popup,'popup.html');
  assert.equal(ex.actions().length,1); assert.equal(ex.pageUrl(ID,'popup'),`chrome-extension://${ID}/popup.html`); assert.equal(ex.pageUrl(ID,'options'),`chrome-extension://${ID}/options.html`);
  assert((await ex.installFromStore(ID)).already);
  await ex.setEnabled(ID,false); assert(!loaded.has(ID)); assert.equal(ex.actions().length,0);
  await ex.setEnabled(ID,true); assert(loaded.has(ID));
  const u=await ex.checkUpdates(); assert.deepEqual(u.updated,[]); // gleiche Version
  // Abbruch durch Nutzer
  const ex2=new Extensions({ses,store:{data:{extensions:[]},save(){}},dir:fs.mkdtempSync(path.join(os.tmpdir(),'e2')),fetchFn,confirm:async()=>false});
  assert((await ex2.installFromStore(ID)).cancelled); assert.equal(fs.readdirSync(ex2.dir).length,0);
  // falsche Datei
  const ex3=new Extensions({ses,store:{data:{extensions:[]},save(){}},dir:fs.mkdtempSync(path.join(os.tmpdir(),'e3')),fetchFn,confirm:async()=>true});
  await assert.rejects(ex3.installFromStore('a'.repeat(32)), /passt nicht/);
  await ex.remove(ID); assert.equal(ex.list().length,0);
  console.log('Erweiterungen ok');
})().catch(e=>{console.error(e);process.exit(1)});
