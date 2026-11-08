const { contextBridge, ipcRenderer } = require('electron');
const channels = ['session', 'login', 'device-start', 'device-poll', 'device-cancel', 'logout', 'search', 'library', 'likes', 'playlists', 'playlist', 'stream', 'playback', 'wave', 'waveFeedback', 'like', 'open-auth', 'fullscreen', 'playing', 'quit'];
channels.push('media-state','media-status');
contextBridge.exposeInMainWorld('yamu', { ...Object.fromEntries(channels.map(channel => [channel, (...args) => ipcRenderer.invoke(channel, ...args)])),
  onMediaCommand:callback=>{
    if(typeof callback !== 'function')return;
    const listener=(_event,command)=>callback(command);
    ipcRenderer.on('media-command',listener);
    return ()=>ipcRenderer.removeListener('media-command',listener);
  }
});
