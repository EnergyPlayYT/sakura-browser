// Webseite als App: Symbol-Datei, Verknüpfungen für Windows und Linux, Start-Argument
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const W = require('../lib/webapps');
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001', 'hex');
const ico = W.pngToIco(png);
assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt32LE(14), png.length); assert(ico.subarray(22).equals(png));
assert.equal(W.fileName('YouTube: Musik / Charts?'), 'YouTube Musik Charts');
assert.equal(W.appIdFromArgv(['sakura.exe', '--sakura-app=abc123']), 'abc123');
assert.equal(W.appIdFromArgv(['sakura.exe', '--sakura-app=../böse']), null);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa'));
let written = null;
const env = { platform: 'win32', execPath: 'C:\\Sakura\\Sakura.exe', startMenuDir: path.join(dir, 'start'), iconDir: path.join(dir, 'icons'),
  shell: { writeShortcutLink: (p, op, o) => { written = { p, op, o }; return true; } } };
const lnk = W.createShortcut(env, { id: 'a1', title: 'YouTube Music' }, png);
assert.equal(path.basename(lnk), 'YouTube Music.lnk'); assert.equal(written.o.args, '--sakura-app=a1'); assert(fs.existsSync(written.o.icon));
const desk = W.createShortcut({ platform: 'linux', execPath: '/opt/sakura', appImage: '/home/a/Sakura.AppImage', appsDir: path.join(dir, 'apps'), iconDir: path.join(dir, 'icons') }, { id: 'b2', title: 'Discord' }, png);
const txt = fs.readFileSync(desk, 'utf8'); assert(txt.includes('Exec="/home/a/Sakura.AppImage" --sakura-app=b2') && txt.includes('Name=Discord'));
W.removeShortcut({ shortcut: desk, icon: path.join(dir, 'icons', 'b2.png') }); assert(!fs.existsSync(desk));
console.log('Web-Apps ok');
