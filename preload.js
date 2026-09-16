const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setSessionState: (state) => ipcRenderer.send('session-state', state),
  resizeSessionOverlay: (expanded) => ipcRenderer.send('session-overlay-size', expanded ? 'expanded' : 'collapsed'),
  getSessionOverlayPlacement: () => ipcRenderer.invoke('session-overlay-placement'),
  triggerShutdown: () => ipcRenderer.send('trigger-shutdown'),
});
