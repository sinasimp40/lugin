'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('denfiVoicePlayer', {
  onAudio: handler => ipcRenderer.on('denfi-voice-audio', (_event, packet) => handler(packet)),
  acknowledge: (token, state, error) => ipcRenderer.send('denfi-voice-ack', {
    token, state, error: typeof error === 'string' ? error.slice(0, 240) : ''
  })
});