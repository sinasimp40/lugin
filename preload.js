const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setSessionState: (state) => ipcRenderer.send('session-state', state),
  triggerShutdown: () => ipcRenderer.send('trigger-shutdown'),
});
