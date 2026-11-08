const { app, BrowserWindow, ipcMain, safeStorage, shell, powerSaveBlocker } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { MusicAPI, publicMessage, PublicError } = require('./api.cjs');
const api = new MusicAPI();
const {createMpris} = require('./mpris.cjs');
let mediaControls = {update(){},close(){},getStatus:()=>process.platform==='linux'?'starting':'unsupported'}, lastMediaState;
let win, blocker;
const tokenPath = () => path.join(app.getPath('userData'), 'session.enc');
function canStore() { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'); }
let storageQueue = Promise.resolve();
function storageTask(task) { const pending = storageQueue.then(task); storageQueue = pending.catch(() => {}); return pending; }
function store() { const token = api.token, epoch = api.epoch; return storageTask(async () => { api.checkEpoch(epoch); if (token && canStore()) { await fs.writeFile(tokenPath(), safeStorage.encryptString(token), { mode: 0o600 }); return true; } return false; }); }
function handle(name, fn) { ipcMain.handle(name, async (event, ...args) => {
  if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('Доступ запрещён');
  try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: publicMessage(e) }; }
}); }
app.whenReady().then(async () => {
  win = new BrowserWindow({ width: 1280, height: 800, minWidth: 800, minHeight: 600, backgroundColor: '#101011', autoHideMenuBar: true, fullscreen: process.argv.includes('--fullscreen'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: process.platform !== 'linux' } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  handle('session', async () => { const epoch = api.epoch; try { if (canStore()) { const token = safeStorage.decryptString(await fs.readFile(tokenPath())); return { account: await api.login(token, epoch), saved: true }; } } catch (e) { if (e.code !== 'ENOENT') return { error: 'Не удалось восстановить вход. Подключитесь к сети или войдите снова.' }; } return {}; });
  handle('login', async token => ({ account: await api.login(token), saved: await store() }));
  handle('device-start', () => api.deviceStart());
  handle('device-poll', async () => { const result = await api.devicePoll(); if (result.account) result.saved = await store(); return result; });
  handle('device-cancel', () => api.cancelAuth());
  handle('logout', async () => { api.logout(); await storageTask(() => fs.rm(tokenPath(), { force: true })); });
  for (const method of ['search', 'library', 'likes', 'playlists', 'playlist', 'stream', 'playback', 'wave', 'waveFeedback', 'like']) handle(method, (...args) => { if (!api.token) throw new PublicError('Войдите в аккаунт'); return api[method](...args); });
  handle('open-auth', async () => { await shell.openExternal('https://oauth.yandex.ru/device'); });
  handle('fullscreen', () => { win.setFullScreen(!win.isFullScreen()); });
  handle('playing', value => { if (value && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension'); else if (!value && blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; } });
  handle('quit', () => app.quit());
  handle('media-state', state => { lastMediaState = state; mediaControls.update(state,state?.seeked===true); });
  handle('media-status', () => mediaControls.getStatus());
  await win.loadFile(path.join(__dirname, '../ui/index.html'));
  createMpris({send:command=>{if(!win.isDestroyed())win.webContents.send('media-command',command);},raise:()=>{win.show();win.focus();},quit:()=>app.quit()}).then(controls=>{mediaControls=controls;if(lastMediaState)controls.update(lastMediaState);});
});
app.on('before-quit',()=>mediaControls.close());
app.on('window-all-closed', () => app.quit());
