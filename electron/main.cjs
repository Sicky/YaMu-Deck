const { app, BrowserWindow, ipcMain, safeStorage, shell, powerSaveBlocker } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const syncFs = require('node:fs');
const {launchSettings,createCredentialStore} = require('./startup.cjs');
const launch = launchSettings();
if(launch.ozone)app.commandLine.appendSwitch('ozone-platform',launch.ozone);
if(launch.software)app.disableHardwareAcceleration();
if(launch.inProcessGpu)app.commandLine.appendSwitch('in-process-gpu');
const credentials = createCredentialStore(safeStorage);
const diagnosticPath=()=>path.join(app.getPath('userData'),'startup.log');
function diagnostic(event,data={}){try{syncFs.mkdirSync(app.getPath('userData'),{recursive:true,mode:0o700});syncFs.appendFileSync(diagnosticPath(),JSON.stringify({time:new Date().toISOString(),event,...data})+'\n',{mode:0o600});}catch{}}
// Fixed stages/codes only: no errors, arguments, URLs, environment dumps or tokens.
try{syncFs.writeFileSync(diagnosticPath(),'',{mode:0o600});}catch{}
diagnostic('main-start',{version:app.getVersion(),platform:process.platform,electron:process.versions.electron,gaming:launch.gaming,ozone:launch.ozone||'auto',software:launch.software,inProcessGpu:launch.inProcessGpu});
const { MusicAPI, publicMessage, PublicError } = require('./api.cjs');
const api = new MusicAPI();
const {createMpris} = require('./mpris.cjs');
let mediaControls = {update(){},close(){},getStatus:()=>process.platform==='linux'?'starting':'unsupported'}, lastMediaState;
let win, blocker;
const tokenPath = () => path.join(app.getPath('userData'), 'session.enc');
const asyncTokenPath = () => path.join(app.getPath('userData'), 'session-v2.enc');
let storageQueue = Promise.resolve();
function storageTask(task) { const pending = storageQueue.then(task); storageQueue = pending.catch(() => {}); return pending; }
function store() { const token = api.token, epoch = api.epoch; return storageTask(async () => { api.checkEpoch(epoch); const encrypted=token?await credentials.encrypt(token):null;api.checkEpoch(epoch);if(!encrypted){diagnostic('credential-store-unavailable');return false;}await fs.writeFile(asyncTokenPath(),encrypted,{mode:0o600});return true; }); }
function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Доступ запрещён');
  try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: publicMessage(e) }; }
}); }
app.whenReady().then(async () => {
  diagnostic('app-ready');
  win = new BrowserWindow({ width: 1280, height: 800, minWidth: 800, minHeight: 600, backgroundColor: '#101011', autoHideMenuBar: true, fullscreen: launch.fullscreen, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: process.platform !== 'linux' } });
  diagnostic('window-created');
  win.webContents.on('did-finish-load',()=>diagnostic('ui-loaded'));
  win.webContents.on('did-fail-load',(_event,code)=>diagnostic('ui-load-failed',{code}));
  win.webContents.on('render-process-gone',(_event,details)=>diagnostic('renderer-exited',{reason:details.reason,code:details.exitCode}));
  win.on('unresponsive',()=>diagnostic('window-unresponsive'));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  handle('session', async () => {const epoch=api.epoch;diagnostic('session-start');for(const file of [asyncTokenPath(),tokenPath()]){try{const encrypted=await fs.readFile(file);const token=await credentials.decrypt(encrypted);if(!token){diagnostic('session-storage-unavailable');return {error:'Хранилище входа недоступно. Войдите через код Яндекса; приложение продолжит работу.'};}const account=await api.login(token,epoch);diagnostic('session-restored');return {account,saved:true};}catch(e){if(e.code!=='ENOENT'){diagnostic('session-restore-failed');return {error:'Не удалось восстановить вход. Подключитесь к сети или войдите снова.'};}}}diagnostic('session-empty');return {};});
  handle('login', async token => ({ account: await api.login(token), saved: await store() }));
  handle('device-start', () => api.deviceStart());
  handle('device-poll', async () => { const result = await api.devicePoll(); if (result.account) result.saved = await store(); return result; });
  handle('device-cancel', () => api.cancelAuth());
  handle('logout', async () => { api.logout(); await storageTask(async()=>{for(const file of [tokenPath(),asyncTokenPath()])await fs.rm(file,{force:true});}); });
  for (const method of ['search', 'library', 'likes', 'playlists', 'playlist', 'stream', 'playback', 'wave', 'waveFeedback', 'like']) handle(method, (...args) => { if (!api.token) throw new PublicError('Войдите в аккаунт'); return api[method](...args); });
  handle('open-auth', async () => { await shell.openExternal('https://oauth.yandex.ru/device'); });
  handle('fullscreen', () => { win.setFullScreen(!win.isFullScreen()); });
  handle('playing', value => { if (value && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension'); else if (!value && blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; } });
  handle('quit', () => app.quit());
  handle('media-state', state => { lastMediaState = state; mediaControls.update(state,state?.seeked===true); });
  handle('media-status', () => mediaControls.getStatus());
  await win.loadFile(path.join(__dirname, '../ui/index.html'));
  createMpris({send:command=>{if(!win.isDestroyed())win.webContents.send('media-command',command);},raise:()=>{win.show();win.focus();},quit:()=>app.quit()}).then(controls=>{mediaControls=controls;if(lastMediaState)controls.update(lastMediaState);});
}).catch(()=>{diagnostic('startup-failed');app.exit(1);});
app.on('child-process-gone',(_event,details)=>diagnostic('child-exited',{type:details.type,reason:details.reason,code:details.exitCode}));
app.on('before-quit',()=>mediaControls.close());
app.on('window-all-closed', () => app.quit());
