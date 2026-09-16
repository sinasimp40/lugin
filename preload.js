const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setSessionState: (state) => ipcRenderer.send('session-state', state),
  resizeSessionOverlay: (expanded) => ipcRenderer.send('session-overlay-size', expanded ? 'expanded' : 'collapsed'),
  triggerShutdown: () => ipcRenderer.send('trigger-shutdown'),
});
