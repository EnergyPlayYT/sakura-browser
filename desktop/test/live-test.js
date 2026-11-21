// Live-Benachrichtigungen: Kanal erkennen, live-Status lesen, nur beim Wechsel melden
const assert = require('assert');
const { LiveWatch, channelFromUrl, youtubeChannel, parseLive } = require('../lib/live');
assert.deepEqual(channelFromUrl('https://www.twitch.tv/Papaplatte?x=1'), { kind: 'twitch', key: 'twitch:papaplatte', name: 'papaplatte', url: 'https://www.twitch.tv/papaplatte' });
assert.equal(channelFromUrl('https://www.twitch.tv/directory'), null);
assert.equal(channelFromUrl('http://www.twitch.tv/papaplatte'), null);
assert.equal(channelFromUrl('https://www.youtube.com/@MrBeast/videos').key, 'youtube:@mrbeast');
assert.equal(channelFromUrl('https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA').url, 'https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA');
assert.equal(channelFromUrl('https://www.youtube.com/watch?v=abc'), null);
assert.equal(youtubeChannel('UCX6OQ3DkcsbYNE6H8uQQuVA', 'MrBeast').name, 'MrBeast');
assert.equal(youtubeChannel('<script>', 'x'), null);
assert.deepEqual(parseLive('twitch', '<meta property="og:description" content="Heute Minecraft &amp; Chat"><script>{"isLiveBroadcast":true}</script>'), { live: true, title: 'Heute Minecraft & Chat' });
assert.equal(parseLive('twitch', '<html>offline</html>').live, false);
assert.equal(parseLive('youtube', '<meta name="title" content="Großer Stream"> "isLiveNow":true').title, 'Großer Stream');
assert.equal(parseLive('youtube', '"isLiveNow":false').live, false);

(async () => {
  const pages = { 'https://www.twitch.tv/papaplatte': 'offline' };
  const store = { data: {}, save() { this.saved = (this.saved || 0) + 1; } };
  const told = [];
  const lw = new LiveWatch({ store, fetch: async url => ({ ok: true, text: async () => pages[url] || '' }), notify: c => told.push(c.name) });
  assert.equal(lw.add(channelFromUrl('https://www.twitch.tv/papaplatte')), true);
  assert.equal(lw.add(channelFromUrl('https://www.twitch.tv/papaplatte')), false, 'nicht doppelt');
  await lw.check(); assert.deepEqual(told, []);
  pages['https://www.twitch.tv/papaplatte'] = '"isLiveBroadcast":true';
  await lw.check(); assert.deepEqual(told, ['papaplatte'], 'Livegang gemeldet');
  await lw.check(); assert.deepEqual(told, ['papaplatte'], 'nur einmal');
  // schon live beim ersten Prüfen: nicht melden (sonst Flut beim Start)
  lw.add(channelFromUrl('https://www.youtube.com/@kanal')); pages['https://www.youtube.com/@kanal/live'] = '"isLiveNow":true';
  await lw.check(); assert.deepEqual(told, ['papaplatte']); assert.equal(lw.list()[1].live, true);
  lw.remove('twitch:papaplatte'); assert.equal(lw.list().length, 1);
  console.log('Live-Benachrichtigungen ok');
})().catch(e => { console.error(e); process.exit(1); });
