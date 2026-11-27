process.env.SAKURA_NO_WELCOME = process.env.SAKURA_NO_WELCOME || "1"; // Tests: keine Willkommens-Tour
const { EventEmitter } = require('events');
const os=require('os'),fs=require('fs'),path=require('path');
const userData=fs.mkdtempSync(path.join(os.tmpdir(),'ud'));
let wcId=0; const all=[];
class WC extends EventEmitter {
  constructor(){super(); this.id=++wcId; this.url=''; this.title=''; this.zoom=0; this.destroyed=false; all.push(this);
    this.navigationHistory={canGoBack:()=>false,canGoForward:()=>false,goBack(){},goForward(){}}; this.sent=[]; }
  loadURL(u){ this.url=u; setImmediate(()=>{ this.emit('did-start-loading'); this.emit('did-navigate',{},u); this.emit('page-title-updated',{},'T '+u); this.emit('did-stop-loading');}); return Promise.resolve(); }
  loadFile(){ setImmediate(()=>this.emit('did-finish-load')); }
  getURL(){return this.url} getTitle(){return this.title} isDestroyed(){return this.destroyed} close(){this.destroyed=true}
  focus(){} send(c,d){this.sent.push([c,d])} isAudioMuted(){return !!this.muted} setAudioMuted(m){this.muted=m} executeJavaScript(c){this.executed=(this.executed||[]).concat(c);return Promise.resolve(this.jsResult)} removeInsertedCSS(){return Promise.resolve()} executeJavaScriptInIsolatedWorld(id,scripts){this.isolated=(this.isolated||[]).concat(scripts.map(x=>x.code));return Promise.resolve(this.isoResult)} insertCSS(c){this.css=(this.css||[]).concat(c);return Promise.resolve()} isDevToolsOpened(){return false} setWindowOpenHandler(f){this.openHandler=f}
  getZoomLevel(){return this.zoom} setZoomLevel(z){this.zoom=z} stopFindInPage(){} findInPage(){} reload(){} stop(){} print(){} toggleDevTools(){}
}
class WebContentsView { constructor(o){this.webContents=new WC(); this.webContents.view=this; this.opts=o;} setBackgroundColor(c){this.bg=c} setBounds(b){this.bounds=b} setVisible(v){this.visible=v} }
class BaseWindow extends EventEmitter { constructor(o){super(); this.o=o; this.b=o&&o.x!=null?{x:o.x,y:o.y,width:o.width,height:o.height}:null; this.children=[]; const self=this; this.contentView={addChildView(v,i){ if(i===0) self.children.unshift(v); else self.children.push(v);}, removeChildView(v){ self.children=self.children.filter(x=>x!==v);} }; this.destroyed=false; (BaseWindow.all||(BaseWindow.all=[])).push(this); }
  getContentBounds(){const b=this.b||{x:100,y:100,width:1200,height:800};return {x:b.x,y:b.y,width:b.width||1200,height:b.height||800}} getBounds(){return this.getContentBounds()} setBounds(b){this.b=b} isMaximized(){return false} unmaximize(){} isFocused(){return false} isDestroyed(){return this.destroyed} show(){} setTitle(t){this.title=t} close(){this.destroyed=true; this.emit('closed')} setFullScreen(){} isFullScreen(){return false} isMinimized(){return false} focus(){} restore(){} setAlwaysOnTop(){} setVisibleOnAllWorkspaces(){} setIgnoreMouseEvents(v){this.ignore=v} setOpacity(o){this.opacity=o} }
const handlers={};
const loadedExt=[];
const ses={ on(){}, cookies:{ jar:[], async set(c){ if(!c.url) throw new Error('url'); this.jar.push(c); }, async flushStore(){} }, extensions:{loadExtension:async p=>{loadedExt.push(p);return {id:'x',path:p}},removeExtension(){}}, protocol:{handle(){}}, webRequest:{onBeforeRequest(){}}, setPermissionRequestHandler(){}, clearStorageData:async()=>{}, clearCache:async()=>{} };
const app=new EventEmitter();
Object.assign(app,{ commandLine:{appendSwitch(){}}, relaunch(){}, setName(){}, userAgentFallback:'Mozilla/5.0 Chrome/140 Electron/45.2.1 Safari/537.36 sakura-browser/1.0.0', getPath:()=>userData,
  requestSingleInstanceLock:()=>true, whenReady:()=>Promise.resolve(), quit(){} });
class BrowserWindow extends BaseWindow { constructor(o){super(o); this.webContents=new WC();} }
const screen={cursor:{x:0,y:0},getCursorScreenPoint(){return this.cursor},getDisplayNearestPoint(){return {workArea:{x:0,y:0,width:1920,height:1040}}}};
const globalShortcut={keys:new Set(),register(k){this.keys.add(k);return true},unregister(k){this.keys.delete(k)},unregisterAll(){this.keys.clear()}};
const safeStorage={isEncryptionAvailable:()=>true,encryptString:t=>Buffer.from('X'+Buffer.from(t).toString('base64')),decryptString:b=>Buffer.from(b.toString().slice(1),'base64').toString()};
module.exports = { nativeImage:{createFromBuffer:b=>({isEmpty:()=>!b.length,toPNG:()=>b})}, safeStorage, globalShortcut, screen, BrowserWindow, nativeTheme:{themeSource:'system'}, app, BaseWindow, WebContentsView, ipcMain:{handle:(c,f)=>handlers[c]=f, on:(c,f)=>handlers['on:'+c]=f}, session:{defaultSession:ses, fromPartition:()=>({...ses})},
  protocol:{registerSchemesAsPrivileged(){}}, Menu:{buildFromTemplate:()=>({popup(){}})}, clipboard:{writeText(){}}, net:{fetch(){}}, dialog:{showMessageBox:async()=>({response:1})},
  webContents:{fromId:id=>all.find(w=>w.id===id)}, shell:{openPath(){}}, _handlers:handlers, _all:all };
