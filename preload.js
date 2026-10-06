const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setSessionState: (state) => ipcRenderer.send('session-state', state),
  resizeSessionOverlay: (expanded) => ipcRenderer.send('session-overlay-size', expanded ? 'expanded' : 'collapsed'),
  resizeSessionOverlayHeight: (height) => ipcRenderer.send('session-overlay-size', { height }),
  resizeSessionOverlayWidth: (width) => ipcRenderer.send('session-overlay-size', { width }),
  getSessionOverlayPlacement: () => ipcRenderer.invoke('session-overlay-placement'),
  triggerShutdown: () => ipcRenderer.send('trigger-shutdown'),
  setIdleShutdownConfig: (seconds) => ipcRenderer.send('idle-shutdown-config', seconds),
  chooseAdminMedia: (token, accept) => ipcRenderer.invoke('choose-admin-media', token, accept),
  notifyBettingVoice: (state) => ipcRenderer.send('betting-voice-state', state),
  onOrderVoiceFinished: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('order-voice-finished', listener);
    return () => ipcRenderer.removeListener('order-voice-finished', listener);
  },
});
