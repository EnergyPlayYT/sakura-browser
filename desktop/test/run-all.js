// Startet alle Tests nacheinander: npm test (im Ordner desktop)
// Die Tests laufen ohne Electron – ein Nachbau (electron-mock.js) ersetzt es.
const { execFileSync } = require('child_process');
const order = ['test', 'ab', 'crx-test', 'ext-test', 'dl-test', 'upd-test', 'fav-test', 'main-test', 'restore-test',
  'group-test', 'group-restore', 'bg-test', 'bar-test', 'drag-test', 'import-test', 'theme-test', 'cookie-test', 'youtube-test', 'sleep-test', 'cookie-import-test', 'gaming-test', 'video-test', 'media-test', 'popup-test', 'synccode-test', 'password-test', 'watch-test', 'twitch-test', 'steam-test', 'reader-test', 'gesture-test', 'twitch-audio-test', 'live-test', 'phish-test', 'pin-test', 'sendtab-test', 'focus-test', 'screentime-test', 'pip-test', 'tempmail-test', 'clip-test', 'space-restore-test', 'highlight-test', 'webapps-test', 'discord-test', 'perm-test', 'garden-test', 'overlay-test'];
let failed = 0;
for (const name of order) {
  try {
    const out = execFileSync(process.execPath, ['--no-warnings', name + '.js'], { cwd: __dirname, encoding: 'utf8', timeout: 60000 });
    console.log('✓ ' + name.padEnd(14) + (out.trim().split('\n').pop() || ''));
  } catch (e) {
    failed++;
    console.log('✗ ' + name.padEnd(14) + ((e.stderr || e.stdout || e.message) + '').trim().split('\n').slice(0, 6).join('\n    '));
  }
}
console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nAlle Tests bestanden');
process.exit(failed ? 1 : 0);
