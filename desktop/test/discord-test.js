// Discord-Anzeige: Handshake mit Client-ID, dann SET_ACTIVITY; ohne Discord kein Fehler
const assert = require('assert');
const net = require('net'), fs = require('fs'), os = require('os'), path = require('path');
const { DiscordPresence, pipePaths, frame } = require('../lib/discord');
assert(pipePaths('win32')[0].endsWith('discord-ipc-0'));
assert(pipePaths('linux', { XDG_RUNTIME_DIR: '/run/user/1000' })[0] === '/run/user/1000/discord-ipc-0');
const f = frame(1, { a: 1 }); assert.equal(f.readInt32LE(0), 1); assert.equal(f.readInt32LE(4), 7);
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dc')); const sockPath = path.join(dir, 'discord-ipc-0');
  const got = [];
  const srv = net.createServer(s => {
    let buf = Buffer.alloc(0);
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 8 && buf.length >= 8 + buf.readInt32LE(4)) {
        const op = buf.readInt32LE(0), len = buf.readInt32LE(4), msg = JSON.parse(buf.subarray(8, 8 + len)); buf = buf.subarray(8 + len);
        got.push([op, msg]);
        if (op === 0) s.write(frame(1, { cmd: 'DISPATCH', evt: 'READY' }));
      }
    });
  }).listen(sockPath);
  await new Promise(r => srv.once('listening', r));
  const none = new DiscordPresence({ clientId: '123', paths: [path.join(dir, 'gibtsnicht')] });
  await none.set({ details: 'x' }); assert.equal(none.ready, false, 'ohne Discord: still nichts');
  const d = new DiscordPresence({ clientId: '123', paths: [path.join(dir, 'gibtsnicht'), sockPath] });
  await d.set({ details: 'Surft mit Sakura', state: 'Schaut YouTube', start: 1700000000000 });
  await new Promise(r => setTimeout(r, 150));
  assert.deepEqual(got[0], [0, { v: 1, client_id: '123' }]);
  const act = got.find(g => g[0] === 1)[1];
  assert.equal(act.cmd, 'SET_ACTIVITY'); assert.equal(act.args.activity.state, 'Schaut YouTube'); assert.equal(act.args.activity.timestamps.start, 1700000000);
  await d.set(null); await new Promise(r => setTimeout(r, 100));
  assert.equal(got.at(-1)[1].args.activity, null, 'Anzeige löschen');
  d.close(); srv.close();
  console.log('Discord-Anzeige ok');
})().catch(e => { console.error(e); process.exit(1); });
