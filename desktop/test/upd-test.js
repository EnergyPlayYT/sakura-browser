const assert=require('assert'),{EventEmitter}=require('events');
const Updater=require(require('path').join(__dirname,'..')+'/lib/updater');
const app={isPackaged:true,getVersion:()=>'1.0.3'};
const au=new EventEmitter(); let installed=false;
au.checkForUpdates=async()=>{au.emit('checking-for-update');au.emit('update-available',{version:'1.0.4'});au.emit('download-progress',{percent:42.4});au.emit('update-downloaded',{version:'1.0.4'});};
au.quitAndInstall=()=>{installed=true};
const u=new Updater({app,autoUpdater:au}); const seen=[]; u.on('change',i=>seen.push(i.state));
(async()=>{
  await u.check(); assert.deepEqual(seen,['checking','downloading','downloading','ready']); assert.equal(u.info().version,'1.0.4');
  u.installNow(); assert(installed);
  au.emit('error',new Error('getaddrinfo ENOTFOUND github.com')); assert(/Keine Verbindung/.test(u.info().message));
  const dev=new Updater({app:{isPackaged:false,getVersion:()=>'1'},autoUpdater:au}); assert.equal(dev.info().state,'unsupported');
  process.env.PORTABLE_EXECUTABLE_DIR='C:\\x'; const port=new Updater({app,autoUpdater:au}); assert(/portable/.test(port.info().message)); delete process.env.PORTABLE_EXECUTABLE_DIR;
  console.log('Updater ok');
})();
