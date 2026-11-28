// Webseite als App: eigene Verknüpfung (Windows-Startmenü bzw. Linux-Anwendungsmenü), die Sakura mit --sakura-app=<id> startet.
const fs = require('fs');
const path = require('path');

/** .ico aus einem PNG bauen (ICO darf seit Windows Vista PNG-Daten enthalten) */
function pngToIco(png, size = 256) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4); // Typ Symbol, 1 Bild
  head.writeUInt8(size >= 256 ? 0 : size, 6); head.writeUInt8(size >= 256 ? 0 : size, 7);
  head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(png.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, png]);
}
/** Name, der als Dateiname taugt */
const fileName = s => String(s || 'Web-App').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Web-App';

/**
 * Verknüpfung anlegen. env: { platform, shell, execPath, appImage, startMenuDir, appsDir, iconDir }
 * Ergebnis: Pfad der Verknüpfung (zum späteren Entfernen) oder null.
 */
function createShortcut(env, appInfo, iconPng) {
  const name = fileName(appInfo.title);
  fs.mkdirSync(env.iconDir, { recursive: true });
  if (env.platform === 'win32') {
    let icon = '';
    if (iconPng) { icon = path.join(env.iconDir, appInfo.id + '.ico'); fs.writeFileSync(icon, pngToIco(iconPng)); }
    const lnk = path.join(env.startMenuDir, name + '.lnk');
    const ok = env.shell.writeShortcutLink(lnk, 'create', {
      target: env.execPath, args: `--sakura-app=${appInfo.id}`, description: `${appInfo.title} (Sakura-App)`,
      ...(icon ? { icon, iconIndex: 0 } : {}), appUserModelId: 'de.ali.sakura.app.' + appInfo.id
    });
    return ok ? lnk : null;
  }
  if (env.platform === 'linux') {
    let icon = 'sakura';
    if (iconPng) { icon = path.join(env.iconDir, appInfo.id + '.png'); fs.writeFileSync(icon, iconPng); }
    fs.mkdirSync(env.appsDir, { recursive: true });
    const file = path.join(env.appsDir, `sakura-app-${appInfo.id}.desktop`);
    const exec = (env.appImage || env.execPath).replace(/"/g, '');
    fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=${name}\nComment=Sakura-App\nExec="${exec}" --sakura-app=${appInfo.id}\nIcon=${icon}\nTerminal=false\nCategories=Network;\n`);
    return file;
  }
  return null;
}

function removeShortcut(appInfo) {
  for (const f of [appInfo.shortcut, appInfo.icon]) if (f) { try { fs.unlinkSync(f); } catch {} }
}

const appIdFromArgv = argv => { const a = (argv || []).find(x => /^--sakura-app=[a-z0-9]+$/.test(x)); return a ? a.split('=')[1] : null; };

module.exports = { pngToIco, createShortcut, removeShortcut, appIdFromArgv, fileName };
