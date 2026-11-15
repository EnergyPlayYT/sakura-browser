const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{EventEmitter}=require('events');
const {Downloads,uniquePath}=require(require('path').join(__dirname,'..')+'/lib/downloads');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dl'));
fs.writeFileSync(path.join(dir,'a.pdf'),'x');
assert.equal(path.basename(uniquePath(dir,'a.pdf')),'a (1).pdf');
assert.equal(path.basename(uniquePath(dir,'b:c?.txt')),'b_c_.txt');
const store={data:{downloads:[]},prefs:()=>({downloadAsk:false}),save(){}};
const opened=[]; const d=new Downloads({store,dir,shell:{openPath:p=>opened.push(p),showItemInFolder(){}}});
const ses=new EventEmitter(); d.attach(ses,false);
class Item extends EventEmitter{constructor(){super();this.p='';this.r=0}getURL(){return 'https://x.de/a.pdf'}getFilename(){return 'a.pdf'}setSavePath(p){this.p=p}getSavePath(){return this.p}getTotalBytes(){return 100}getReceivedBytes(){return this.r}isPaused(){return false}cancel(){}}
const it=new Item(); ses.emit('will-download',{},it);
assert.equal(path.basename(it.p),'a (1).pdf');
it.r=40; it.emit('updated',{},'progressing');
let s=d.summary(); assert.equal(s.active,1); assert.equal(s.progress,0.4);
it.r=100; fs.writeFileSync(it.p,'y'); it.emit('done',{},'completed');
s=d.summary(); assert.equal(s.active,0); assert(s.any);
assert.equal(store.data.downloads.length,1); const id=d.list()[0].id; d.open(id); assert.equal(opened[0],it.p);
// private downloads not persisted
const ses2=new EventEmitter(); d.attach(ses2,true); const it2=new Item(); ses2.emit('will-download',{},it2); it2.emit('done',{},'completed');
assert.equal(store.data.downloads.length,1);
d.clear(); assert.equal(d.list().length,0);
console.log('Downloads ok');
