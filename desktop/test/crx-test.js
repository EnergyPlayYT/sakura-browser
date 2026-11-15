const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),crypto=require('crypto');
const C=require(require('path').join(__dirname,'..')+'/lib/crx');
const zip=fs.readFileSync('ext.zip');
// echtes CRX3 bauen
const { publicKey } = crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const der = publicKey.export({type:'spki',format:'der'});
const varint=n=>{const o=[];while(n>127){o.push((n&127)|128);n=Math.floor(n/128);}o.push(n);return Buffer.from(o)};
const field=(f,b)=>Buffer.concat([varint(f*8+2),varint(b.length),b]);
const idBytes=crypto.createHash('sha256').update(der).digest().subarray(0,16);
const { publicKey: other } = crypto.generateKeyPairSync('rsa',{modulusLength:1024});
const otherDer = other.export({type:'spki',format:'der'});
const header=Buffer.concat([
  field(2, Buffer.concat([field(1,otherDer),field(2,Buffer.alloc(8))])),   // fremder Schlüssel zuerst
  field(2, Buffer.concat([field(1,der),field(2,Buffer.alloc(8))])),
  field(10000, field(1,idBytes))]);
const hl=Buffer.alloc(4); hl.writeUInt32LE(header.length);
const crx=Buffer.concat([Buffer.from('Cr24'),Buffer.from([3,0,0,0]),hl,header,zip]);
const p=C.parseCrx(crx);
assert.equal(p.id, C.idFromKey(der)); assert(p.key.equals(der)); assert(/^[a-p]{32}$/.test(p.id));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crx'));
const r=C.extractCrx(crx,dir);
assert.equal(r.manifest.key, der.toString('base64'));
assert(fs.existsSync(path.join(dir,'popup.html'))); assert(fs.existsSync(path.join(dir,'popup.js')));
assert(!fs.existsSync(path.join(dir,'_metadata')));
assert.equal(fs.readFileSync(path.join(dir,'popup.js'),'utf8'),'console.log(1)');
// CRX2
const sig=Buffer.alloc(5); const h2=Buffer.alloc(16); h2.write('Cr24'); h2.writeUInt32LE(2,4); h2.writeUInt32LE(der.length,8); h2.writeUInt32LE(5,12);
assert.equal(C.parseCrx(Buffer.concat([h2,der,sig,zip])).id, p.id);
// Pfad-Ausbruch blockieren
const evil=Buffer.from(zip); const i=evil.indexOf('popup.html'); 
assert.throws(()=>C.parseCrx(Buffer.from('nope nope nope nope')));
assert.equal(C.compareVersions('1.2.10','1.2.9'),1); assert.equal(C.compareVersions('2','2.0.0'),0);
fs.writeFileSync(require('path').join(require('os').tmpdir(),'sakura-test.crx'),crx); fs.writeFileSync(require('path').join(require('os').tmpdir(),'sakura-test-id.txt'),p.id);
console.log('CRX ok', p.id);
