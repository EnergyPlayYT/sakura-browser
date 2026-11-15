const assert = require('assert');
const os = require('os'), fs = require('fs'), path = require('path');
const D = require('path').join(__dirname,'..')+'/lib/';
const M = require(D + 'model'); const Store = require(D + 'store'); const Sync = require(D + 'sync');
// toUrl
const e='google';
assert.equal(M.toUrl('github.com', e), 'https://github.com');
assert.equal(M.toUrl('de.wikipedia.org/wiki/Test', e), 'https://de.wikipedia.org/wiki/Test');
assert.equal(M.toUrl('localhost:3000', e), 'http://localhost:3000');
assert.equal(M.toUrl('192.168.0.1', e), 'http://192.168.0.1');
assert.equal(M.toUrl('wetter morgen', e), 'https://www.google.com/search?q=wetter%20morgen');
assert.equal(M.toUrl('node.js', 'duckduckgo'), 'https://node.js');
assert.equal(M.toUrl('was ist 2.5', e).startsWith('https://www.google.com'), true);
assert.equal(M.toUrl('https://x.de', e), 'https://x.de');
// merge
const now = Date.now();
const L = { bookmarks:[{id:'a',url:'u1',updatedAt:now-10},{id:'b',url:'u2',updatedAt:now}], shortcuts:[], history:[{id:'h1',url:'h1',visitedAt:now-5,updatedAt:now-5}], historyClearedAt:0, prefs:{searchEngine:'google',updatedAt:5}};
const R = { bookmarks:[{id:'a',url:'u1',deleted:true,updatedAt:now-1},{id:'c',url:'u3',updatedAt:now}], shortcuts:[{id:'s',url:'x',updatedAt:1}], history:[{id:'h0',url:'h0',visitedAt:1000,updatedAt:1000}], historyClearedAt:2000, prefs:{searchEngine:'ecosia',updatedAt:9}};
const m = M.mergeData(L,R);
assert.deepEqual(m.bookmarks.map(b=>b.id+(b.deleted?'x':'')).sort(), ['ax','b','c']);
assert.equal(m.prefs.searchEngine,'ecosia'); assert.equal(m.prefs.adblock,true);
assert.deepEqual(m.history.map(h=>h.id), ['h1']);
assert.equal(m.historyClearedAt, 2000);
// old tombstones dropped
assert.equal(M.mergeList([{id:'z',deleted:true,updatedAt:1}],[]).length,0);
// idempotent
assert.deepEqual(M.mergeData(m, m), m);
// store
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'sk'));
const s = new Store(dir);
let changes=[]; s.on('change',(k,sy)=>changes.push(k+sy));
assert.equal(s.toggleBookmark('https://a.de','A'), true);
assert.equal(s.bookmarks().length,1);
assert.equal(s.toggleBookmark('https://a.de','A'), false);
assert.equal(s.bookmarks().length,0);
s.visit('https://a.de/x','X'); s.visit('https://a.de/x','X2');
assert.equal(s.history().length,1); assert.equal(s.history()[0].title,'X2');
assert.equal(s.suggest('a.de')[0].url,'https://a.de/x');
s.saveShortcut({title:'T',url:'https://t.de'}); assert.equal(s.shortcuts().length,7);
const ids=s.shortcuts().map(x=>x.id).reverse(); s.orderShortcuts(ids); assert.equal(s.shortcuts()[0].title,'T');
s.clearHistory(); assert.equal(s.history().length,0);
s.flush(); const s2=new Store(dir); assert.equal(s2.shortcuts()[0].title,'T');
// sync with fake Firebase
let serverDoc=null;
global.fetch = async (url, opt={}) => {
  const ok=(j,st=200)=>({ok:st<300,status:st,json:async()=>j});
  if (url.includes('signInWithPassword')) { const b=JSON.parse(opt.body); return b.password==='pw'?ok({localId:'U1',idToken:'T',refreshToken:'R',expiresIn:'3600',email:b.email}):ok({error:{message:'INVALID_LOGIN_CREDENTIALS'}},400); }
  if (url.includes('firestore')) {
    assert.equal(opt.headers.Authorization,'Bearer T');
    assert(url.includes('/users/U1/sync/main'));
    if (opt.method==='PATCH') { serverDoc=JSON.parse(opt.body); return ok(serverDoc); }
    return serverDoc?ok(serverDoc):ok({error:{status:'NOT_FOUND'}},404);
  }
  throw new Error('unexpected '+url);
};
(async()=>{
  const C=require(D+'crypto');
  const sy = new Sync(s2);
  let r = await sy.login({apiKey:'k',projectId:'p',email:'a@b.de',password:'falsch',syncPassword:'geheim123'}).catch(e=>e.message);
  assert.equal(r,'E-Mail oder Passwort stimmt nicht.');
  r = await sy.login({apiKey:'k',projectId:'p',email:'a@b.de',password:'pw',syncPassword:'kurz'}).catch(e=>e.message);
  assert.equal(r,'Das Sync-Passwort braucht mindestens 8 Zeichen.');
  // alte, unverschlüsselte Daten liegen schon auf dem Server
  serverDoc={fields:{payload:{stringValue:JSON.stringify({bookmarks:[{id:'alt',url:'https://alt.de',title:'Alt',updatedAt:Date.now()}]})}}};
  r = await sy.login({apiKey:'k',projectId:'p',email:'a@b.de',password:'pw',syncPassword:'Kirschblüte'});
  assert.equal(r.state,'ok', JSON.stringify(r)); assert.equal(r.encrypted,true);
  assert(s2.bookmarks().some(b=>b.id==='alt'), 'alte Daten übernommen');
  const enc = serverDoc.fields.payload.stringValue;
  assert(C.isEncrypted(enc), 'Server-Daten verschlüsselt'); assert(!enc.includes('alt.de'));
  const salt = serverDoc.fields.salt.stringValue;
  const key = await C.deriveKey('Kirschblüte', salt);
  const payload = JSON.parse(C.decrypt(key, enc));
  assert.equal(payload.shortcuts.filter(x=>!x.deleted).length,7);
  // zweites Gerät fügt Lesezeichen hinzu
  payload.bookmarks.push({id:'remote1',url:'https://remote.de',title:'R',createdAt:Date.now(),updatedAt:Date.now()});
  serverDoc.fields.payload.stringValue = C.encrypt(key, JSON.stringify(payload));
  await sy.syncNow(); assert(s2.bookmarks().some(b=>b.id==='remote1'));
  // anderes Gerät mit falschem Passwort
  const dir3 = fs.mkdtempSync(path.join(os.tmpdir(),'sk3')); const s3=new Store(dir3); const sy3=new Sync(s3);
  r = await sy3.login({apiKey:'k',projectId:'p',email:'a@b.de',password:'pw',syncPassword:'falsches-pw'});
  assert.equal(r.state,'needkey'); assert.equal(r.message,'Das Sync-Passwort stimmt nicht.');
  assert(!s3.bookmarks().some(b=>b.id==='remote1'));
  await sy3.unlock({password:'Kirschblüte'}); assert.equal(sy3.info().state,'ok'); assert(s3.bookmarks().some(b=>b.id==='remote1'));
  // Passwort auf Gerät 3 ändern → Gerät 2 muss neu entsperren
  await sy3.changePassword('Neues-Passwort-1');
  assert.notEqual(serverDoc.fields.salt.stringValue, salt);
  await sy.syncNow(); assert.equal(sy.info().state,'needkey'); assert(/anderen Gerät geändert/.test(sy.info().message));
  await assert.rejects(sy.unlock({password:'Kirschblüte'}), /stimmt nicht/);
  await sy.unlock({password:'Neues-Passwort-1'}); assert.equal(sy.info().state,'ok');
  // Vergessen → neu anlegen
  await sy.unlock({password:'GanzNeu-2026', reset:true}); assert.equal(sy.info().state,'ok');
  await sy3.syncNow(); assert.equal(sy3.info().state,'needkey');
  for (const x of [sy,sy3]) { clearInterval(x._interval); clearTimeout(x._debounce); }
  console.log('Alle Tests bestanden (inkl. Verschlüsselung)');
  process.exit(0);
})().catch(e=>{console.error(e);process.exit(1)});
