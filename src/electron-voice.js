'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const WebSocket = require('ws');
const { KioskVoiceCoordinator } = require('./voice-announcements');

function startElectronVoice({ app, BrowserWindow, ipcMain, url, sessionWindow, log = console.log, engineFactory, Socket = WebSocket, onUnavailable, fastVoice = true }) {
  const createKokoroEngine = engineFactory || require('./kokoro-engine.cjs').createKokoroEngine;
  const engine = createKokoroEngine({
    modelDir: app.isPackaged ? path.join(process.resourcesPath, 'kokoro') : path.join(__dirname, '..', 'assets', 'kokoro'),
    cacheDir: path.join(app.getPath('userData'), 'voice-cache'),
    log
  });
  let player = null;
  const audioContents = new WeakSet();
  let playerLoading = null;
  let playback = null;
  let socket = null;
  let reconnect = null;
  let stopping = false;
  let generation = 0;
  let lastSocketMessage = 0;
  let heartbeat = null;
  let unavailableReported = false;
  function reportUnavailable(error) {
    if (stopping || unavailableReported) return;
    unavailableReported = true;
    log(`[Voice] Offline announcements unavailable: ${error.message}`);
    try { onUnavailable?.(error); }
    catch (warningError) { log(`[Voice] Could not display warning: ${warningError.message}`); }
  }
  const root = path.join(__dirname, '..');
  const generate = text => engine.generate(text).catch(error => {
    reportUnavailable(error);
    throw error;
  });
  const instant = fastVoice ? new (require('./instant-voice').InstantVoice)({
    cueDir: app.isPackaged ? path.join(process.resourcesPath, 'voice-cues') : path.join(root, 'assets', 'voice-cues'),
    generate, play: playAudio, onUnavailable: reportUnavailable
  }) : null;
  const coordinator = new KioskVoiceCoordinator({
    generate,
    play: playAudio,
    prepare: instant ? event => instant.prepare(event) : undefined,
    announce: instant ? (event, relevant) => instant.announce(event, relevant) : undefined,
    onFinished: event => {
      const current = sessionWindow();
      if (current && !current.isDestroyed()) current.webContents.send('order-voice-finished', {
        id: event.orderId, username: event.username
      });
    },
    interrupt: () => {
      instant?.interrupt();
      failPlayback('Session changed; stopped obsolete private announcement');
      if (player && !player.isDestroyed()) player.destroy();
    },
    seenFile: path.join(app.getPath('userData'), 'voice-event-ids.json'),
    log
  });
  function failPlayback(message) {
    if (!playback) return;
    clearTimeout(playback.timer);
    const pending = playback;
    playback = null;
    pending.reject(new Error(message));
  }
  async function ensurePlayer() {
    if (player && !player.isDestroyed() && !playerLoading) return player;
    if (playerLoading) return playerLoading;
    const window = new BrowserWindow({
      show: false, width: 1, height: 1, skipTaskbar: true,
      webPreferences: {
        preload: path.join(__dirname, 'voice-player-preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        backgroundThrottling: false
      }
    });
    player = window;
    audioContents.add(window.webContents);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('render-process-gone', () => {
      if (player === window) failPlayback('Background audio renderer exited');
      if (!window.isDestroyed()) window.destroy();
    });
    window.on('closed', () => {
      if (player === window) {
        player = null;
        failPlayback('Background audio window closed');
      }
    });
    let timer;
    const loaded = Promise.race([
      window.loadFile(path.join(root, 'public', 'voice-player.html')),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          if (!window.isDestroyed()) window.destroy();
          reject(new Error('Background audio player did not load within 10 seconds'));
        }, 10000);
      })
    ]);
    playerLoading = loaded.then(() => {
      if (stopping || window.isDestroyed()) throw new Error('Voice player stopped');
      return window;
    }).finally(() => { clearTimeout(timer); playerLoading = null; });
    return playerLoading;
  }
  async function playAudio(wav) {
    if (stopping) throw new Error('Voice player is stopping');
    const bytes = Buffer.from(wav);
    if (bytes.length < 44 || bytes.length > 10 * 1024 * 1024 ||
        bytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Invalid generated WAV');
    const target = await ensurePlayer();
    if (stopping) throw new Error('Voice player stopped');
    return new Promise((resolve, reject) => {
      const token = randomUUID();
      const timer = setTimeout(() => {
        failPlayback('Audio playback did not complete within 45 seconds');
        // No partial clip may overlap the next queued event.
        if (player && !player.isDestroyed()) player.destroy();
      }, 45000);
      playback = { token, resolve, reject, timer };
      try { target.webContents.send('denfi-voice-audio', { token, wav: new Uint8Array(bytes) }); }
      catch (error) { failPlayback(error.message); }
    });
  }
  function acknowledge(event, data) {
    if (!player || player.isDestroyed() || event.sender !== player.webContents ||
        event.senderFrame !== player.webContents.mainFrame ||
        !playback || data?.token !== playback.token) return;
    if (data.state === 'playing') return;
    if (data.state === 'error') { failPlayback(data.error || 'Audio playback failed'); return; }
    if (data.state !== 'ended') return;
    clearTimeout(playback.timer);
    const pending = playback;
    playback = null;
    pending.resolve();
  }
  function betting(event, payload) {
    const current = sessionWindow();
    if (!current || current.isDestroyed() || event.sender !== current.webContents ||
        event.senderFrame !== current.webContents.mainFrame) return;
    coordinator.bettingState(payload);
  }
  ipcMain.on('denfi-voice-ack', acknowledge);
  ipcMain.on('betting-voice-state', betting);
  function connect() {
    if (stopping) return;
    const own = ++generation;
    const target = new Socket(url.replace(/^http/, 'ws') + '/ws/session', {
      handshakeTimeout: 5000, maxPayload: 1024 * 1024
    });
    socket = target;
    target.on('open', () => { lastSocketMessage = Date.now(); });
    target.on('message', raw => {
      if (stopping || own !== generation || target !== socket) return;
      lastSocketMessage = Date.now();
      try {
        const message = JSON.parse(String(raw));
        if (message.type === 'status') coordinator.observeStatus(message.data);
        else if (message.type === 'voice-session-event') coordinator.sessionEvent(message.data);
        else if (message.type === 'bingo-voice-event') {
          coordinator.bingoEvent(message.data);
          if (['bingo-joined','bingo-call'].includes(message.data?.type) &&
              coordinator.activeUsername &&
              coordinator.bingoMemberships.get(message.data.eventId || message.data.id?.split(':')[1]) === coordinator.activeUsername)
            instant?.warmBingoCalls(()=>!!coordinator.currentEvent || coordinator.queue.length>0 ||
              !Array.from(coordinator.bingoMemberships).some(([round,user])=>
                user === coordinator.activeUsername && !coordinator.finishedBingoRounds.has(round))).catch(reportUnavailable);
        }
        else if (message.type === 'order-prepare') coordinator.prepareOrder(message.data);
        else if (message.type === 'order-status') coordinator.orderStatus(message.data);
        else if (message.type === 'wheel-win') coordinator.publicWin(message.data, { replay: message.replay === true });
      } catch (error) { log(`[Voice] Ignored invalid session event: ${error.message}`); }
    });
    target.on('error', error => { log(`[Voice] Event connection: ${error.message}`); });
    target.on('close', () => {
      if (stopping || own !== generation) return;
      socket = null;
      reconnect = setTimeout(connect, 2000);
    });
  }
  connect();
  // Load the audio renderer before an event, without waiting for model startup.
  void ensurePlayer().catch(reportUnavailable);
  heartbeat = setInterval(() => {
    if (socket?.readyState === Socket.OPEN && Date.now() - lastSocketMessage > 20000) socket.terminate();
  }, 5000);
  heartbeat.unref();
  // Start model initialization without blocking kiosk startup or the desktop lock.
  if (engine.ready && typeof engine.ready.then === 'function') {
    engine.ready.catch(reportUnavailable);
  }
  return {
    coordinator,
    ownsRenderer: contents => audioContents.has(contents),
    audioServiceFailed() {
      failPlayback('Windows audio service exited');
      if (player && !player.isDestroyed()) player.destroy();
    },
    async close() {
      if (stopping) return;
      stopping = true;
      generation++;
      clearTimeout(reconnect);
      clearInterval(heartbeat);
      socket?.terminate();
      coordinator.close();
      instant?.close();
      failPlayback('Application is closing');
      if (player && !player.isDestroyed()) player.destroy();
      ipcMain.removeListener('denfi-voice-ack', acknowledge);
      ipcMain.removeListener('betting-voice-state', betting);
      await engine.close();
    }
  };
}
module.exports = { startElectronVoice };