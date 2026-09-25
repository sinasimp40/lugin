const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const logs = require('../src/coin-log-store');
const { defaultWheel, currentWheel, parseWheel, pickOutcome } = require('../src/wheel-config');

test('full-balance settlement is idempotent, rate-proof and decreases ranking', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-wheel-ledger-'));
  try {
    logs.setDataDir(dir);
    const rates = [{ pesos: 1, points: 1 }];
    logs.appendLog({ username: 'mem-lose', amount: 10, ip: 'a', mac: 'a' }, rates);
    logs.appendLog({ username: 'mem-win', amount: 4, ip: 'b', mac: 'b' }, rates);
    const lostId = '00000000-0000-4000-8000-000000000001';
    const loss = logs.appendWheelSpin({
      username: 'mem-lose', requestId: lostId, station: 'PC 1', expectedStake: 10,
      outcomes: [{ multiplier: 0, weight: 100 }], pointRates: rates
    });
    assert.deepEqual([loss.stake, loss.payout, loss.net, loss.balance], [10, 0, -10, 0]);
    assert.equal(logs.getMemberPoints('mem-lose', rates), 0);
    assert.equal(logs.getLeaderboard(5, rates).some(row => row.username === 'mem-lose'), false);
    assert.equal(logs.appendWheelSpin({
      username: 'mem-lose', requestId: lostId, station: 'PC 1',
      outcomes: [{ multiplier: 5, weight: 100 }], pointRates: rates
    }).id, loss.id);
    assert.throws(() => logs.appendWheelSpin({
      username: 'mem-win', requestId: lostId, outcomes: [{ multiplier: 5, weight: 100 }], pointRates: rates
    }), /different member/);
    assert.throws(() => logs.appendWheelSpin({
      username: 'mem-lose', requestId: '00000000-0000-4000-8000-000000000002',
      outcomes: [{ multiplier: 2, weight: 100 }], pointRates: rates
    }), /No points available/);
    const win = logs.appendWheelSpin({
      username: 'mem-win', requestId: '00000000-0000-4000-8000-000000000003', expectedStake: 4,
      outcomes: [{ multiplier: 2, weight: 100 }], pointRates: rates
    });
    assert.equal(win.balance, 8);
    logs.recalcAllPoints([{ pesos: 1, points: 2 }]);
    assert.equal(logs.getMemberPoints('mem-lose'), 10, 'only the earned coins changed, not the 10 point loss');
    assert.equal(logs.getWheelSpin(lostId).net, -10);
    assert.equal(logs.getWheelSpin(win.requestId).net, 4);
    const claim = logs.claimWheelNotification();
    assert.equal(claim.spin.id, loss.id);
    assert.equal(logs.getLogs().logs.find(item => item.id === loss.id).notificationLeaseToken, undefined);
    assert.equal(logs.getWheelSpin(lostId).notificationLeaseToken, undefined);
    assert.equal(logs.acknowledgeWheelNotification(claim.spin.requestId, 'wrong'), false);
    assert.equal(logs.acknowledgeWheelNotification(claim.spin.requestId, claim.leaseToken), true);
    assert.equal(logs.getWheelSpin(lostId).notificationSent, true);
    assert.equal(logs.claimWheelNotification().spin.id, win.id);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('wheel configuration rejects invalid odds, duplicates and non-cent precision', () => {
  assert.equal(defaultWheel().outcomes.reduce((sum, item) => sum + item.weight, 0), 100);
  assert.deepEqual(defaultWheel().outcomes, [
    { multiplier: 0, weight: 35 }, { multiplier: 1.5, weight: 20 },
    { multiplier: 1.8, weight: 20 }, { multiplier: 2, weight: 15 }, { multiplier: 5, weight: 10 }
  ]);
  assert.equal(parseWheel(defaultWheel()).enabled, true);
  const legacy = { enabled: false, outcomes: [
    { multiplier: 0, weight: 35 }, { multiplier: 0.5, weight: 20 },
    { multiplier: 1, weight: 20 }, { multiplier: 2, weight: 15 }, { multiplier: 5, weight: 10 }
  ] };
  assert.deepEqual(currentWheel(legacy), { enabled: false, outcomes: defaultWheel().outcomes });
  const customized = { ...legacy, outcomes: legacy.outcomes.map((item, index) =>
    ({ ...item, weight: index === 0 ? 30 : index === 1 ? 25 : item.weight })) };
  assert.deepEqual(currentWheel(customized), customized, 'customized rates must not be replaced');
  assert.equal(parseWheel({ enabled: true, outcomes: [{ multiplier: 0, weight: 40 }, { multiplier: 2, weight: 50 }] }), null);
  assert.equal(parseWheel({ enabled: true, outcomes: [{ multiplier: 2, weight: 40 }, { multiplier: 2, weight: 60 }] }), null);
  assert.equal(parseWheel({ enabled: true, outcomes: [{ multiplier: 0, weight: 33.333 }, { multiplier: 1, weight: 66.667 }] }), null);
  assert.equal(parseWheel({ enabled: true, outcomes: [{ multiplier: 0, weight: 0 }, { multiplier: 1, weight: 100 }] }), null);
});

test('the Auto Shutdown editor derives LOSE from winning chances', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const start = page.indexOf('    function editableWheel(wheel) {');
  const end = page.indexOf('    function renderAdminWheel() {', start);
  assert.ok(start >= 0 && end > start);
  const editor = new Function('adminWheel', `${page.slice(start, end)}
    return { editableWheel, wheelEditorState };`);
  const { editableWheel } = editor(defaultWheel());
  const current = editableWheel(defaultWheel());
  assert.equal(current.outcomes.some(item => item.multiplier === 0), false);
  assert.deepEqual(editor(current).wheelEditorState(), {
    wins: defaultWheel().outcomes.slice(1), winCents: 6500, lossCents: 3500, valid: true,
    outcomes: defaultWheel().outcomes
  });
  const edited = editor({ ...current, outcomes: current.outcomes.map(item =>
    item.multiplier === 1.8 ? { ...item, weight: 18 } : item) }).wheelEditorState();
  assert.equal(edited.lossCents, 3700);
  assert.deepEqual(parseWheel({ enabled:true, outcomes:edited.outcomes }).outcomes[0], { multiplier:0, weight:37 });
  const fullWins = editor({ enabled:true, outcomes:[
    { multiplier:1.5, weight:60 }, { multiplier:2, weight:40 }
  ] }).wheelEditorState();
  assert.equal(fullWins.valid, true);
  assert.equal(fullWins.lossCents, 0);
  assert.equal(fullWins.outcomes.some(item => item.multiplier === 0), false);
  assert.equal(editor({ enabled:true, outcomes:[{ multiplier:1.5, weight:101 }] }).wheelEditorState().valid, false);
  assert.equal(editor({ enabled:true, outcomes:[{ multiplier:0, weight:20 }, { multiplier:2, weight:20 }] }).wheelEditorState().valid, false);
});

test('a configured 30% multiplier wins exactly 30% of the possible tickets on each roll', t => {
  const outcomes = [
    { multiplier: 0, weight: 50 },
    { multiplier: 1.5, weight: 30 },
    { multiplier: 2, weight: 20 }
  ];
  let ticket = 0;
  t.mock.method(crypto, 'randomInt', () => ticket);
  const counts = new Map();
  for (ticket = 0; ticket < 10000; ticket++) {
    const result = pickOutcome(outcomes);
    counts.set(result, (counts.get(result) || 0) + 1);
  }
  assert.deepEqual([...counts.entries()], [[0, 5000], [1.5, 3000], [2, 2000]]);
});

test('2× pays twice the exact staked balance, including the original stake', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-wheel-math-'));
  try {
    logs.setDataDir(dir);
    const rates = [{ pesos: 1, points: 1 }];
    for (const [username, stake] of [['mem-large', 86.5], ['mem-small', 6.5]]) {
      logs.appendLog({ username, amount: stake, ip: username, mac: username }, rates);
      const spin = logs.appendWheelSpin({
        username, requestId: username === 'mem-large' ? '00000000-0000-4000-8000-000000000031' : '00000000-0000-4000-8000-000000000032',
        station: 'PC', expectedStake: stake, outcomes: [{ multiplier: 2, weight: 100 }], pointRates: rates
      });
      assert.equal(spin.stake, stake);
      assert.equal(spin.payout, stake * 2);
      assert.equal(spin.balance, stake * 2);
      assert.equal(spin.net, stake);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Auto Shutdown offers editable defaults offline but keeps drafts off Denfi Points', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-wheel-draft-'));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['-e', `
    const dir=process.env.DENFI_TEST_DATA_DIR;
    const settings=require('./src/settings-store'); settings.setAppRole('auto-shutdown'); settings.setDataDir(dir);
    require('./src/coin-log-store').setDataDir(dir);
    require('./src/attendance-store').setDataDir(dir);
    require('./src/order-store').setDataDir(dir);
    require('./server');
  `], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DENFI_APP_ROLE: 'auto-shutdown', DENFI_TEST_DATA_DIR: dir,
      NODE_ENV: 'test', DENFI_LISTEN_HOST: '127.0.0.1' },
    stdio: 'ignore'
  });
  const request = async (route, method = 'GET', body, token) => {
    const response = await fetch(`http://127.0.0.1:${port}${route}`, {
      method, headers: { ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-admin-token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error('Auto Shutdown process exited');
      try {
        if ((await request('/api/admin/status')).data.appRole === 'auto-shutdown') { ready = true; break; }
      } catch (_) {}
      await delay(100);
    }
    assert.equal(ready, true);
    const token = (await request('/api/admin/register', 'POST', { password: 'test-password' })).data.token;
    const initial = await request('/api/admin/wheel', 'GET', null, token);
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.data.wheel.outcomes, defaultWheel().outcomes);
    assert.equal(initial.data.connected, false);
    assert.equal(initial.data.draft, false);
    const edited = { enabled: true, outcomes: [
      { multiplier: 0, weight: 45 }, { multiplier: 1.5, weight: 10 },
      { multiplier: 1.8, weight: 20 }, { multiplier: 2, weight: 15 }, { multiplier: 5, weight: 10 }
    ] };
    const saved = await request('/api/admin/wheel', 'POST', { ...edited, mode: 'draft' }, token);
    assert.equal(saved.status, 200);
    assert.equal(saved.data.draft, true);
    assert.deepEqual((await request('/api/admin/wheel', 'GET', null, token)).data.wheel, edited);
    assert.equal((await request('/api/admin/wheel', 'POST', { ...edited, mode: 'publish' }, token)).status, 503);
    assert.deepEqual((await request('/api/admin/wheel', 'GET', null, token)).data.wheel, edited);
    assert.notEqual((await request('/api/session/wheel')).status, 200, 'offline drafts cannot enable real spins');
    const pointsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-wheel-draft-points-'));
    const pointsSocket = net.createServer();
    await new Promise(resolve => pointsSocket.listen(0, '127.0.0.1', resolve));
    const pointsPort = pointsSocket.address().port;
    await new Promise(resolve => pointsSocket.close(resolve));
    const points = spawn(process.execPath, ['-e', `
      const dir=process.env.DENFI_TEST_DATA_DIR;
      const settings=require('./src/settings-store'); settings.setAppRole('points'); settings.setDataDir(dir);
      const logs=require('./src/coin-log-store'); logs.setDataDir(dir);
      require('./src/attendance-store').setDataDir(dir);
      require('./src/order-store').setDataDir(dir);
      logs.appendLog({username:'mem-configured',amount:10,ip:'a',mac:'b'},[{pesos:1,points:1}]);
      settings.updateSettings({pointRates:[{pesos:1,points:1}]});
      require('./server');
    `], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(pointsPort), DENFI_APP_ROLE: 'points', DENFI_TEST_DATA_DIR: pointsDir,
        NODE_ENV: 'test', DENFI_LISTEN_HOST: '127.0.0.1' },
      stdio: 'ignore'
    });
    try {
      const pointsUrl = `http://127.0.0.1:${pointsPort}`;
      let pointsReady = false;
      for (let i = 0; i < 60; i++) {
        if (points.exitCode !== null) throw new Error('Denfi Points process exited');
        try {
          const status = await fetch(pointsUrl + '/api/admin/status').then(r => r.json());
          if (status.appRole === 'points') { pointsReady = true; break; }
        } catch (_) {}
        await delay(100);
      }
      assert.equal(pointsReady, true);
      const oldStatus = await fetch(pointsUrl + '/api/sync/wheel/status/mem-configured').then(r => r.json());
      assert.equal((await request('/api/admin/sync-server', 'POST', { url: pointsUrl }, token)).data.success, true);
      const pending = (await request('/api/admin/wheel', 'GET', null, token)).data;
      assert.equal(pending.connected, true);
      assert.equal(pending.draft, true);
      assert.deepEqual(pending.wheel, edited, 'reconnecting keeps the offline draft visible');
      assert.deepEqual((await fetch(pointsUrl + '/api/sync/wheel-config').then(r => r.json())).wheel.outcomes,
        defaultWheel().outcomes, 'reconnecting must not silently publish the draft');
      const published = await request('/api/admin/wheel', 'POST', { ...edited, mode: 'publish' }, token);
      assert.equal(published.status, 200);
      assert.equal(published.data.draft, false);
      assert.deepEqual((await fetch(pointsUrl + '/api/sync/wheel-config').then(r => r.json())).wheel, edited);
      assert.equal((await request('/api/admin/wheel', 'GET', null, token)).data.draft, false);
      const updatedStatus = await fetch(pointsUrl + '/api/sync/wheel/status/mem-configured').then(r => r.json());
      assert.deepEqual(updatedStatus.multipliers, edited.outcomes.map(item => item.multiplier));
      assert.notEqual(updatedStatus.oddsToken, oldStatus.oddsToken);
      const attempt = { username:'mem-configured', station:'PC', requestId:'00000000-0000-4000-8000-000000000041', expectedStake:10 };
      const spinRequest = oddsToken => fetch(pointsUrl + '/api/sync/wheel/spin', {
        method:'POST', headers:{'content-type':'application/json'},
        body:JSON.stringify({ ...attempt, oddsToken })
      });
      assert.equal((await spinRequest(oldStatus.oddsToken)).status, 409, 'old odds must be reviewed again');
      const spun = await spinRequest(updatedStatus.oddsToken).then(r => r.json());
      assert.deepEqual(spun.spin.outcomes, edited.outcomes, 'new odds apply to the next spin');
    } finally {
      points.kill();
      fs.rmSync(pointsDir, { recursive: true, force: true });
    }
  } finally {
    child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Points API settles once and keeps pending Telegram notifications for retry', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-wheel-api-'));
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const child = spawn(process.execPath, ['-e', `
    const dir=process.env.DENFI_TEST_DATA_DIR;
    const s=require('./src/settings-store'); s.setAppRole('points'); s.setDataDir(dir);
    const logs=require('./src/coin-log-store'); logs.setDataDir(dir);
    require('./src/attendance-store').setDataDir(dir);
    require('./src/order-store').setDataDir(dir);
    logs.appendLog({username:'mem-player',amount:12,ip:'a',mac:'b'},[{pesos:1,points:1}]);
    s.updateSettings({pointRates:[{pesos:1,points:1}]});
    require('./server');
  `], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DENFI_APP_ROLE: 'points', DENFI_TEST_DATA_DIR: dir,
      NODE_ENV: 'test', DENFI_LISTEN_HOST: '127.0.0.1' },
    stdio: 'ignore'
  });
  const url = `http://127.0.0.1:${port}`;
  async function request(route, method = 'GET', body, token) {
    const response = await fetch(url + route, {
      method, headers: { ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-admin-token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  }
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (child.exitCode !== null) throw new Error('Points process exited');
      try {
        if ((await request('/api/admin/status')).data.appRole === 'points') { ready = true; break; }
      } catch (_) {}
      await delay(100);
    }
    assert.equal(ready, true);
    const token = (await request('/api/admin/register', 'POST', { password: 'test-password' })).data.token;
    assert.equal((await request('/api/sync/wheel-config')).data.wheel.outcomes[0].weight, 35);
    const status = (await request('/api/sync/wheel/status/mem-player')).data;
    assert.equal(status.balance, 12);
    assert.deepEqual(status.multipliers, [0, 1.5, 1.8, 2, 5]);
    assert.equal(status.outcomes, undefined, 'player status must not disclose winning rates');
    assert.match(status.oddsToken, /^[a-f0-9]{64}$/);
    assert.equal((await request('/api/admin/wheel', 'POST', defaultWheel(), token)).status, 403);
    const updateGeneric = await request('/api/admin/settings', 'POST', { wheel: { enabled: false, outcomes: defaultWheel().outcomes } }, token);
    assert.equal(updateGeneric.data.settings.wheel.enabled, true);
    assert.equal((await request('/api/admin/kiosk-wheel', 'POST',
      { enabled: true, outcomes: [{ multiplier: 0, weight: 40 }, { multiplier: 2, weight: 40 }] })).status, 400);
    const requestId = '00000000-0000-4000-8000-000000000009';
    assert.equal((await request('/api/sync/wheel/spin', 'POST', {
      username: 'mem-player', requestId, expectedStake: 13, oddsToken: status.oddsToken
    })).status, 409, 'stale reviewed balances must not wager extra points');
    assert.equal((await request('/api/sync/wheel/spin', 'POST', {
      username: 'mem-player', requestId, expectedStake: 12, oddsToken: '0'.repeat(64)
    })).status, 409, 'changed odds must not settle against different chances');
    const first = await request('/api/sync/wheel/spin', 'POST', {
      username: 'mem-player', requestId, station: 'PC 1', expectedStake: 12, oddsToken: status.oddsToken
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.spin.stake, 12);
    assert.ok(defaultWheel().outcomes.some(item => item.multiplier === first.data.spin.multiplier));
    assert.deepEqual(first.data.spin.outcomes, defaultWheel().outcomes);
    const disabled = await request('/api/admin/kiosk-wheel', 'POST', { enabled: false, outcomes: defaultWheel().outcomes });
    assert.equal(disabled.data.wheel.enabled, false);
    const again = await request('/api/sync/wheel/spin', 'POST', {
      username: 'mem-player', requestId, expectedStake: 12, oddsToken: status.oddsToken
    });
    assert.equal(again.data.spin.id, first.data.spin.id);
    const legacyReplay = await request('/api/sync/wheel/spin', 'POST', {
      username: 'mem-player', requestId, expectedStake: 12, legacyReplay: true
    });
    assert.equal(legacyReplay.data.spin.id, first.data.spin.id, 'older pending clients can recover a settled request');
    assert.equal((await request('/api/sync/wheel/spin', 'POST', {
      username: 'mem-player', requestId: '00000000-0000-4000-8000-000000000011',
      expectedStake: 12, legacyReplay: true
    })).status, 409, 'an older pending request must not become a new wager');
    assert.equal((await request('/api/sync/wheel/spin', 'POST', {
      username: 'mem-player', requestId: '00000000-0000-4000-8000-000000000010', expectedStake: 12, oddsToken: status.oddsToken
    })).status, 403);
    assert.equal((await request('/api/sync/coin-logs')).data.logs.filter(item => item.source === 'wheel').length, 1);
    assert.equal((await request('/api/sync/member-points/mem-player')).data.points, first.data.spin.balance);
    const claimed = (await request('/api/sync/wheel/claim-notification', 'POST')).data.claim;
    assert.equal(claimed.spin.requestId, requestId);
    assert.equal((await request('/api/sync/wheel/claim-notification', 'POST')).data.claim, null);
    assert.equal((await request('/api/sync/wheel/ack-notification', 'POST',
      { requestId, leaseToken: claimed.leaseToken })).data.success, true);
    assert.equal((await request('/api/sync/wheel/claim-notification', 'POST')).data.claim, null);
  } finally {
    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});