'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { startElectronVoice } = require('../src/electron-voice');

class FakeSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];
  constructor(url, options) {
    super();
    this.url = url;
    this.options = options;
    this.readyState = FakeSocket.OPEN;
    this.terminated = false;
    FakeSocket.instances.push(this);
  }
  terminate() {
    this.terminated = true;
    this.readyState = 3;
  }
  message(message) {
    this.emit('message', Buffer.from(JSON.stringify(message)));
  }
}

class FakeWebContents extends EventEmitter {
  constructor() {
    super();
    this.mainFrame = { name: 'main-frame' };
    this.sent = [];
    this.setWindowOpenHandler = handler => { this.windowOpenHandler = handler; };
    this.send = (channel, data) => this.sent.push({ channel, data });
  }
}

class FakeWindow extends EventEmitter {
  static instances = [];
  constructor(options) {
    super();
    this.options = options;
    this.webContents = new FakeWebContents();
    this.destroyed = false;
    this.loadedFile = null;
    FakeWindow.instances.push(this);
  }
  loadFile(file) {
    this.loadedFile = file;
    return Promise.resolve();
  }
  isDestroyed() { return this.destroyed; }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('closed');
  }
}

function harness({ engine: providedEngine, onUnavailable, fastVoice = false } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-voice-test-'));
  const ipcMain = new EventEmitter();
  const generated = [];
  const logs = [];
  let session = makeSessionWindow();
  const engine = providedEngine || {
    ready: Promise.resolve(),
    async generate(text) {
      generated.push(text);
      return validWav();
    },
    async close() { this.closed = true; }
  };
  FakeSocket.instances = [];
  FakeWindow.instances = [];
  const voice = startElectronVoice({
    app: { isPackaged: false, getPath: () => userData },
    BrowserWindow: FakeWindow,
    ipcMain,
    url: 'http://localhost:3000',
    sessionWindow: () => session,
    engineFactory: () => engine,
    Socket: FakeSocket,
    log: message => logs.push(message),
    onUnavailable,
    fastVoice
  });
  return {
    voice, ipcMain, generated, logs, engine, userData,
    socket: FakeSocket.instances[0],
    currentSession: () => session,
    replaceSession() { session = makeSessionWindow(); return session; },
    cleanup: async () => {
      await voice.close();
      fs.rmSync(userData, { recursive: true, force: true });
    }
  };
}

function makeSessionWindow() {
  return {
    destroyed: false,
    webContents: { mainFrame: { name: 'session-main' } },
    isDestroyed() { return this.destroyed; }
  };
}

function validWav() {
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(22050, 24);
  wav.writeUInt32LE(44100, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(0, 40);
  return wav;
}

async function waitFor(predicate, message) {
  const deadline = Date.now() + 1500;
  while (!predicate() && Date.now() < deadline) {
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.ok(predicate(), message);
}

function status(socket, username = 'mem-alice') {
  socket.message({
    type: 'status',
    data: { isLogin: true, username, sessionTimeLeft: 120 }
  });
}

function sentAudio() {
  return FakeWindow.instances.flatMap(window => window.webContents.sent)
    .filter(item => item.channel === 'denfi-voice-audio');
}

test('production fast voice starts before model readiness and follows with prepared details', async () => {
  let resolveBody;
  const body = new Promise(resolve => { resolveBody = resolve; });
  const engine = {
    ready: new Promise(() => {}),
    generate: () => body,
    async close() { this.closed = true; }
  };
  const h = harness({ engine, fastVoice: true });
  const acknowledgeLast = () => {
    const target = FakeWindow.instances.at(-1).webContents;
    const audio = sentAudio().at(-1).data;
    h.ipcMain.emit('denfi-voice-ack', { sender: target, senderFrame: target.mainFrame },
      { token: audio.token, state: 'ended' });
  };
  try {
    status(h.socket);
    const event = { id: 'instant-login', type: 'welcome', username: 'mem-alice', expiresAt: Date.now() + 30000 };
    h.socket.message({ type: 'voice-session-event', data: event });
    await waitFor(() => sentAudio().length === 1, 'the ready-made welcome plays while model is still warming');
    resolveBody(validWav());
    acknowledgeLast();
    await waitFor(() => sentAudio().length === 2, 'personal greeting follows only after the opening ends');
    acknowledgeLast();
    await waitFor(() => !h.voice.coordinator.draining, 'greeting completes');
    h.socket.message({ type: 'voice-session-event', data: event });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(sentAudio().length, 2, 'duplicate login cannot replay either clip');
    h.socket.message({ type: 'status', data: { isLogin: false, sessionTimeLeft: 0 } });
    h.socket.message({ type: 'voice-session-event', data: {
      id: 'instant-logout', type: 'logout', username: 'mem-alice', expiresAt: Date.now() + 30000
    } });
    await waitFor(() => sentAudio().length === 3, 'logout opening plays despite locked session');
    acknowledgeLast();
    await waitFor(() => sentAudio().length === 4, 'logout details were prepared during the session');
    acknowledgeLast();
  } finally {
    resolveBody(validWav());
    await h.cleanup();
  }
});

test('the coordinator owns its session WebSocket and plays a welcome after the kiosk session window is destroyed', async () => {
  const h = harness();
  try {
    assert.equal(h.socket.url, 'ws://localhost:3000/ws/session');
    assert.equal(h.socket.options.maxPayload, 1024 * 1024);
    status(h.socket);
    h.currentSession().destroyed = true;
    h.socket.message({
      type: 'voice-session-event',
      data: { id: 'welcome-one', type: 'welcome', username: 'mem-alice', expiresAt: Date.now() + 30000 }
    });
    await waitFor(() => sentAudio().length === 1, 'welcome audio should be sent to the hidden background player');
    const [packet] = sentAudio();
    assert.ok(packet.data.wav instanceof Uint8Array);
    assert.equal(Buffer.from(packet.data.wav).toString('ascii', 0, 4), 'RIFF');
    assert.equal(h.generated.length, 1);

    const player = FakeWindow.instances[0];
    h.ipcMain.emit('denfi-voice-ack', {
      sender: player.webContents, senderFrame: player.webContents.mainFrame
    }, { token: packet.data.token, state: 'ended' });
    await waitFor(() => h.voice.coordinator.draining === false, 'the acknowledged announcement should drain');
  } finally {
    await h.cleanup();
  }
});

test('background audio acknowledgement requires the player main frame and active playback token', async () => {
  const h = harness();
  try {
    status(h.socket);
    h.socket.message({
      type: 'voice-session-event',
      data: { id: 'welcome-ack', type: 'welcome', username: 'mem-alice', expiresAt: Date.now() + 30000 }
    });
    await waitFor(() => sentAudio().length === 1, 'audio packet should arrive');
    const player = FakeWindow.instances[0];
    const packet = sentAudio()[0];
    const ended = { token: packet.data.token, state: 'ended' };
    h.ipcMain.emit('denfi-voice-ack', {
      sender: player.webContents, senderFrame: {}
    }, ended);
    h.ipcMain.emit('denfi-voice-ack', {
      sender: {}, senderFrame: player.webContents.mainFrame
    }, ended);
    h.ipcMain.emit('denfi-voice-ack', {
      sender: player.webContents, senderFrame: player.webContents.mainFrame
    }, { token: 'wrong-token', state: 'ended' });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.voice.coordinator.draining, true, 'untrusted and stale acknowledgements cannot finish playback');
    h.ipcMain.emit('denfi-voice-ack', {
      sender: player.webContents, senderFrame: player.webContents.mainFrame
    }, ended);
    await waitFor(() => h.voice.coordinator.draining === false, 'trusted matching acknowledgement should finish');
  } finally {
    await h.cleanup();
  }
});

test('betting IPC accepts only the current session main frame; replayed and renderer-spoofed wins are ignored', async () => {
  const h = harness();
  try {
    status(h.socket);
    const oldSession = h.currentSession();
    const current = h.replaceSession();
    const payload = { phase: 'begin', username: 'mem-alice', requestId: 'trusted-request' };
    h.ipcMain.emit('betting-voice-state', {
      sender: oldSession.webContents, senderFrame: oldSession.webContents.mainFrame
    }, payload);
    h.ipcMain.emit('betting-voice-state', {
      sender: current.webContents, senderFrame: {}
    }, payload);
    h.ipcMain.emit('betting-voice-state', {
      sender: {}, senderFrame: current.webContents.mainFrame
    }, payload);
    assert.equal(h.voice.coordinator.pendingSpin, null);

    h.ipcMain.emit('betting-voice-state', {
      sender: current.webContents, senderFrame: current.webContents.mainFrame
    }, payload);
    assert.equal(h.voice.coordinator.pendingSpin.requestId, 'trusted-request');
    h.ipcMain.emit('betting-voice-state', {
      sender: current.webContents, senderFrame: current.webContents.mainFrame
    }, {
      phase: 'revealed', username: 'mem-alice', requestId: 'trusted-request',
      spinId: 'forged-win', multiplier: 5, net: 40, balance: 100
    });
    h.socket.message({
      type: 'wheel-win', replay: true,
      data: { id: 'old-win', username: 'mem-bob', multiplier: 5, createdAt: Date.now() }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.generated.length, 0, 'IPC cannot originate public wins and replayed history is not announced');

    h.socket.message({
      type: 'wheel-win',
      data: { id: 'live-win', username: 'mem-bob', multiplier: 5, createdAt: Date.now() }
    });
    await waitFor(() => sentAudio().length === 1, 'a live WebSocket win should be announced');
    assert.match(h.generated[0], /bob.*5 times multiplier/i);
  } finally {
    await h.cleanup();
  }
});

test('audio remains serialized over session-window replacement and a background renderer crash does not escape or stop kiosk cleanup', async () => {
  const h = harness();
  try {
    status(h.socket);
    h.socket.message({
      type: 'voice-session-event',
      data: { id: 'first', type: 'welcome', username: 'mem-alice', expiresAt: Date.now() + 30000 }
    });
    await waitFor(() => sentAudio().length === 1, 'first announcement should start playback');
    const oldPlayer = FakeWindow.instances[0];
    h.replaceSession();
    h.socket.message({
      type: 'voice-session-event',
      data: { id: 'second', type: 'logout', username: 'mem-alice', expiresAt: Date.now() + 30000 }
    });
    assert.equal(h.generated.length, 1, 'the second event must wait for serial playback');
    assert.doesNotThrow(() => oldPlayer.webContents.emit('render-process-gone', {}, { reason: 'crashed' }));
    await waitFor(() => sentAudio().length === 2, 'queued speech should resume in a replacement background player');
    assert.equal(FakeWindow.instances.length, 2);
    assert.equal(h.generated.length, 2);
    await h.cleanup();
    assert.equal(h.socket.terminated, true);
    assert.equal(h.engine.closed, true);
    assert.equal(h.ipcMain.listenerCount('denfi-voice-ack'), 0);
    assert.equal(h.ipcMain.listenerCount('betting-voice-state'), 0);
    assert.equal(h.voice.coordinator.closed, true);
  } finally {
    if (!h.engine.closed) await h.cleanup();
  }
});

test('the voice service keeps ownership of destroyed audio renderers and resumes on the next queued clip after an audio-service failure', async () => {
  const h = harness();
  try {
    status(h.socket);
    h.socket.message({
      type: 'voice-session-event',
      data: { id: 'audio-service-first', type: 'welcome', username: 'mem-alice', expiresAt: Date.now() + 30000 }
    });
    await waitFor(() => sentAudio().length === 1, 'first clip should be playing');
    const failedContents = FakeWindow.instances[0].webContents;
    assert.equal(h.voice.ownsRenderer(failedContents), true);
    assert.equal(h.voice.ownsRenderer({}), false);

    h.socket.message({
      type: 'voice-session-event',
      data: { id: 'audio-service-next', type: 'logout', username: 'mem-alice', expiresAt: Date.now() + 30000 }
    });
    assert.doesNotThrow(() => h.voice.audioServiceFailed());
    assert.equal(FakeWindow.instances[0].isDestroyed(), true);
    assert.equal(h.voice.ownsRenderer(failedContents), true,
      'renderer ownership remains recognizable after its WebContents has been destroyed');

    await waitFor(() => sentAudio().length === 2, 'the next queued clip should create a replacement player');
    assert.equal(FakeWindow.instances.length, 2, 'service failure should recover at the next clip, not spin up repeated players');
    const nextPlayer = FakeWindow.instances[1];
    assert.equal(h.voice.ownsRenderer(nextPlayer.webContents), true);
    const packet = sentAudio()[1];
    h.ipcMain.emit('denfi-voice-ack', {
      sender: nextPlayer.webContents, senderFrame: nextPlayer.webContents.mainFrame
    }, { token: packet.data.token, state: 'ended' });
    await waitFor(() => h.voice.coordinator.draining === false, 'the next clip should complete normally');
    assert.equal(h.generated.length, 2);
  } finally {
    await h.cleanup();
  }
});

test('global Electron recovery handlers exempt owned audio renderers and Audio Service but retain window and GPU relaunches', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const start = main.indexOf('let isSelfHealing = false;');
  const end = main.indexOf('app.whenReady().then(async () =>', start);
  assert.ok(start >= 0 && end > start, 'global renderer and child-process recovery handlers should exist');
  const recoverySource = main.slice(start, end);

  function runRecovery(eventName, ...args) {
    const app = new EventEmitter();
    const calls = { relaunched: 0, exited: 0, audioFailures: 0 };
    app.relaunch = () => { calls.relaunched++; };
    app.exit = () => { calls.exited++; };
    const owned = new Set(['owned-audio-renderer']);
    const voiceSystem = {
      ownsRenderer(contents) { return owned.has(contents); },
      audioServiceFailed() { calls.audioFailures++; }
    };
    vm.runInNewContext(recoverySource, {
      app, voiceSystem, isQuitting: false, console: { error() {} }
    });
    app.emit(eventName, {}, ...args);
    return calls;
  }

  assert.deepEqual(
    runRecovery('render-process-gone', 'owned-audio-renderer', { reason: 'crashed' }),
    { relaunched: 0, exited: 0, audioFailures: 0 },
    'the hidden audio renderer crash is handled locally, without relaunching the kiosk'
  );
  assert.deepEqual(
    runRecovery('render-process-gone', 'critical-session-renderer', { reason: 'crashed' }),
    { relaunched: 1, exited: 1, audioFailures: 0 },
    'a protected window renderer crash still relaunches the app'
  );
  assert.deepEqual(
    runRecovery('child-process-gone', { type: 'GPU', name: 'GPU Process', reason: 'crashed' }),
    { relaunched: 1, exited: 1, audioFailures: 0 },
    'GPU process failures still relaunch the app'
  );
  assert.deepEqual(
    runRecovery('child-process-gone', { type: 'Utility', name: 'Audio Service', reason: 'crashed' }),
    { relaunched: 0, exited: 0, audioFailures: 1 },
    'the audio utility failure delegates to the bounded voice recovery'
  );
  assert.deepEqual(
    runRecovery('child-process-gone', {
      type: 'Utility', name: 'Other Utility', serviceName: 'audio.mojom.AudioService', reason: 'crashed'
    }),
    { relaunched: 0, exited: 0, audioFailures: 1 },
    'the audio service-name variant also avoids kiosk relaunch'
  );
});

test('warmup and synthesis failures report offline voice exactly once without an unhandled rejection', async () => {
  const warmupError = new Error('model warmup failed');
  const generationError = new Error('model generation failed');
  const unavailable = [];
  const unhandled = [];
  let generationAttempts = 0;
  const engine = {
    ready: Promise.reject(warmupError),
    async generate() {
      generationAttempts++;
      throw generationError;
    },
    async close() { this.closed = true; }
  };
  const onUnhandled = error => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  const h = harness({
    engine,
    onUnavailable: error => unavailable.push(error)
  });
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(unavailable, [warmupError], 'the rejected readiness promise reports the initial outage');

    status(h.socket);
    h.socket.message({
      type: 'voice-session-event',
      data: { id: 'offline-voice', type: 'welcome', username: 'mem-alice', expiresAt: Date.now() + 30000 }
    });
    await waitFor(() => h.voice.coordinator.draining === false, 'failed synthesis should finish its bounded coordinator retry');
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(generationAttempts, 2, 'the coordinator retains its single synthesis retry');
    assert.deepEqual(unavailable, [warmupError], 'warmup and generation failures invoke the outage callback only once');
    assert.deepEqual(unhandled, [], 'both warmup and generation rejections are handled');
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
    await h.cleanup();
  }
});