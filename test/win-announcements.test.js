const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

test('Points exposes only recent, revealed, positive wheel wins without financial details', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-win-feed-'));
  try {
    const logs = require('../src/coin-log-store');
    logs.setDataDir(dir);
    const now = Date.now();
    fs.writeFileSync(path.join(dir, 'coin-logs.json'), JSON.stringify({ logs:[
      { id:'old', source:'wheel', username:'mem-old', multiplier:5, timestamp:now - 150000 },
      { id:'loss', source:'wheel', username:'mem-loss', multiplier:0, timestamp:now - 9000 },
      { id:'even', source:'wheel', username:'mem-even', multiplier:1, timestamp:now - 9000 },
      { id:'pending', source:'wheel', username:'mem-pending', multiplier:3, timestamp:now - 3000 },
      { id:'win', source:'wheel', username:'mem-winner', station:'PC 04',
        multiplier:2, timestamp:now - 7000, stake:10, balance:20 }
    ] }));
    assert.deepEqual(logs.getRecentWheelWins(now - 30000, now), [{
      id:'win', username:'mem-winner', station:'PC 04', multiplier:2, createdAt:now - 7000
    }]);
    assert.deepEqual(logs.getRecentWheelWins(0, now), [{
      id:'win', username:'mem-winner', station:'PC 04', multiplier:2, createdAt:now - 7000
    }]);
    assert.deepEqual(logs.getRecentWheelWins(now - 5000, now), []);
  } finally {
    fs.rmSync(dir, { recursive:true, force:true });
  }
});

test('session notifications deduplicate wins and hold the spinning member until reveal', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'session.html'), 'utf8');
  const start = page.indexOf('    const seenWinNoticeIds = new Set();');
  const end = page.indexOf('    function wheelPendingKey(', start);
  assert.ok(start >= 0 && end > start);
  const winner = { textContent:'' };
  const multiplier = { textContent:'' };
  const queue = { hidden:true };
  const count = { textContent:'' };
  const nodes = { 'win-user':winner, 'win-multiplier':multiplier, 'win-queue':queue, 'win-queue-count':count };
  let pending = false;
  const state = new Function('document', 'readPendingWheel', `
    let sessionUsername = 'mem-current', timeLeft = 100, wheelRequestId = 'spin-one';
    let activeDrawer = null;
    const previewMode = false;
    function openDrawer(view) { activeDrawer = view; updateWinQueueIndicator(); }
    function closeDrawer() {
      if (activeDrawer === 'wins') {
        displayedWinNotice = null;
        queuedWinNotices.length = 0;
      }
      activeDrawer = null;
      updateWinQueueIndicator();
      showNextWinNotice();
    }
    ${page.slice(start, end)}
    return {
      receiveWinNotice, releaseDeferredWinNotices, ready:finishInitialSessionStatus,
      done:() => { wheelRequestId = null; },
      close:closeDrawer, next:advanceWinNotice,
      setDrawer:view => { activeDrawer = view; },
      current:() => ({
        drawer:activeDrawer,
        winner:document.getElementById('win-user').textContent,
        multiplier:document.getElementById('win-multiplier').textContent,
        queued:document.getElementById('win-queue').hidden ? 0 : Number(document.getElementById('win-queue-count').textContent.slice(1))
      })
    };
  `)({ getElementById:id => nodes[id] }, () => pending ? {} : null);
  state.receiveWinNotice({ id:'early', username:'mem-other', multiplier:2 });
  assert.equal(state.current().drawer, null, 'events received before the first session status are held');
  state.ready();
  assert.equal(state.current().drawer, 'wins');
  assert.equal(state.current().winner, 'mem-other');
  state.close();
  assert.equal(state.current().drawer, null);
  const own = { id:'own', username:'mem-current', multiplier:5 };
  state.receiveWinNotice(own);
  assert.equal(state.current().drawer, null, 'the active spinner must not see the win early');
  state.receiveWinNotice(own);
  state.receiveWinNotice({ id:'lose', username:'mem-loss', multiplier:0 });
  assert.equal(state.current().drawer, null);
  state.done();
  state.releaseDeferredWinNotices('mem-current');
  assert.deepEqual(state.current(), { drawer:'wins', winner:'mem-current', multiplier:'5×', queued:0 });
  state.close();
  assert.equal(state.current().drawer, null);
  state.setDrawer('shop');
  state.receiveWinNotice({ id:'other', username:'mem-other', multiplier:2 });
  assert.equal(state.current().drawer, 'shop', 'a new win does not interrupt an open Order panel');
  state.close();
  assert.equal(state.current().drawer, 'wins', 'the queued announcement opens when Order closes');
  assert.equal(state.current().winner, 'mem-other', 'another PC displays the winner and multiplier');
  state.receiveWinNotice({ id:'other', username:'mem-other', multiplier:2 });
  state.receiveWinNotice({ id:'next', username:'mem-diana', multiplier:3 });
  assert.deepEqual(state.current(), { drawer:'wins', winner:'mem-other', multiplier:'2×', queued:1 },
    'a second win is indicated without covering the first');
  state.next();
  assert.deepEqual(state.current(), { drawer:'wins', winner:'mem-diana', multiplier:'3×', queued:0 },
    'NEXT swaps results in the existing popup');
  state.close();
  assert.equal(state.current().drawer, null, 'one event cannot reopen the popup twice');
  state.receiveWinNotice({ id:'third', username:'mem-third', multiplier:5 });
  state.receiveWinNotice({ id:'fourth', username:'mem-fourth', multiplier:2 });
  assert.equal(state.current().queued, 1);
  state.close();
  assert.equal(state.current().drawer, null, 'X dismisses the entire pending stack');
  pending = true;
  state.receiveWinNotice({ id:'stored', username:'mem-current', multiplier:3 });
  assert.equal(state.current().drawer, null, 'a persisted retry must not reveal the result');
});

test('one Points win reaches two separate connected kiosks exactly once', { timeout:20000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-two-kiosks-'));
  const children = [];
  const sockets = [];
  async function freePort() {
    const socket = net.createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    return port;
  }
  async function start(role, name, port, pointsUrl = '') {
    const dataDir = path.join(dir, name);
    const child = spawn(process.execPath, ['-e', `
      const settings = require('./src/settings-store');
      settings.setAppRole(${JSON.stringify(role)});
      settings.setDataDir(process.env.DENFI_TEST_DATA_DIR);
      if (process.env.TEST_POINTS_URL) settings.updateSettings({ syncServerUrl:process.env.TEST_POINTS_URL });
      require('./src/coin-log-store').setDataDir(process.env.DENFI_TEST_DATA_DIR);
      require('./src/attendance-store').setDataDir(process.env.DENFI_TEST_DATA_DIR);
      require('./src/order-store').setDataDir(process.env.DENFI_TEST_DATA_DIR);
      require('./server');
    `], {
      cwd:path.join(__dirname, '..'),
      env:{ ...process.env, PORT:String(port), NODE_ENV:'test', DENFI_APP_ROLE:role,
        DENFI_LISTEN_HOST:'127.0.0.1', DENFI_TEST_DATA_DIR:dataDir, TEST_POINTS_URL:pointsUrl },
      stdio:'ignore'
    });
    children.push(child);
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error(name + ' exited unexpectedly');
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/admin/status`);
        if ((await res.json()).appRole === role) return dataDir;
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(name + ' did not start');
  }
  try {
    const pointsPort = await freePort();
    const kioskPorts = [await freePort(), await freePort()];
    const pointsUrl = `http://127.0.0.1:${pointsPort}`;
    const pointsDir = await start('points', 'points', pointsPort);
    await Promise.all(kioskPorts.map((port, i) => start('auto-shutdown', 'kiosk-' + i, port, pointsUrl)));
    const received = [[], []];
    const connected = kioskPorts.map((port, i) => new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/session`);
      sockets.push(socket);
      socket.on('open', resolve);
      socket.on('error', reject);
      socket.on('message', raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'wheel-win') received[i].push(msg.data);
      });
    }));
    await Promise.all(connected);
    const now = Date.now();
    fs.writeFileSync(path.join(pointsDir, 'coin-logs.json'), JSON.stringify({ logs:[
      { id:'test-loss', source:'wheel', username:'mem-unlucky', multiplier:0, timestamp:now },
      { id:'test-win', source:'wheel', username:'mem-winner', station:'PC 04', multiplier:5, timestamp:now }
    ], memberPoints:{} }));
    const deadline = Date.now() + 11500;
    while (received.some(list => list.length === 0) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.deepEqual(received.map(list => list.map(win => [win.id, win.username, win.multiplier])),
      [[['test-win','mem-winner',5]], [['test-win','mem-winner',5]]]);
    const replayed = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${kioskPorts[0]}/ws/session`);
      sockets.push(socket);
      const timeout = setTimeout(() => reject(new Error('recent win not replayed to a reconnecting viewer')), 2000);
      socket.on('error', reject);
      socket.on('message', raw => {
        const msg = JSON.parse(raw);
        if (msg.type === 'wheel-win') {
          clearTimeout(timeout);
          resolve(msg.data);
        }
      });
    });
    assert.equal(replayed.id, 'test-win', 'a viewer connecting just after settlement still receives the alert');
    await new Promise(resolve => setTimeout(resolve, 2200));
    assert.deepEqual(received.map(list => list.length), [1, 1], 'polling does not replay the same win');
  } finally {
    for (const socket of sockets) socket.close();
    for (const child of children) child.kill();
    fs.rmSync(dir, { recursive:true, force:true });
  }
});