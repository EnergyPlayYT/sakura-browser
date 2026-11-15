const assert=require('assert'),os=require('os'),fs=require('fs'),path=require('path');
const AB=require(require('path').join(__dirname,'..')+'/lib/adblock');
const prefs={adblock:true,adblockExtended:false,adblockAllow:['spiegel.de']};
const b=new AB({store:{prefs:()=>prefs},baseDir:require('path').join(__dirname,'..')+'/assets',userDir:fs.mkdtempSync(path.join(os.tmpdir(),'ab'))});
assert(b.isBlocked('securepubads.g.doubleclick.net')); assert(b.isBlocked('www.google-analytics.com'));
assert(!b.isBlocked('www.google.com')); assert(!b.isBlocked('youtube.com')); assert(!b.isBlocked('net'));
let handler; const ses={webRequest:{onBeforeRequest:(f,h)=>handler=h}};
b.attach(ses, id=>id===1?'https://www.spiegel.de/':'https://web.de/');
const run=(d)=>new Promise(r=>handler(d,r));
(async()=>{
 assert.deepEqual(await run({url:'https://ad.doubleclick.net/x',resourceType:'script',webContentsId:2}),{cancel:true});
 assert.deepEqual(await run({url:'https://ad.doubleclick.net/x',resourceType:'script',webContentsId:1}),{});
 assert.deepEqual(await run({url:'https://ad.doubleclick.net/x',resourceType:'mainFrame',webContentsId:2}),{});
 assert.equal(b.count(2),1); console.log('Werbeblocker ok,', b.size, 'Domains');
})();
