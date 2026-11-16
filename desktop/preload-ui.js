const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chrome2', {
  call: (cmd, arg) => ipcRenderer.invoke('ui', cmd, arg),
  on: (channel, fn) => {
    const ok = ['state', 'sync-status', 'find-result', 'find-open', 'find-close', 'focus-address', 'open-panel', 'edit-group', 'downloads-changed', 'extensions-changed', 'download-started', 'update-status', 'edit-bookmark', 'open-import', 'watches-changed', 'tab-search'];
    if (ok.includes(channel)) ipcRenderer.on(channel, (e, data) => fn(data));
  }
});
