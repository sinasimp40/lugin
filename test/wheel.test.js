const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const logs = require('../src/coin-log-store');
const { defaultWheel, parseWheel } = require('../src/wheel-config');

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
  assert.equal(parseWheel(defaultWheel()).enabled, true);
  assert.equal(parseWheel({ enabled: true, outcomes: [{ multiplier: 0, weight: 40 }, { multiplier: 2, weight: 50 }] }), null);
  assert.equal(parseWheel({ enabled: true, outcomes: [{ multiplier: 2, weight: 40 }, { multiplier: 2, weight: 60 }] }), null);
  assert.equal(parseWheel({ enabled: true, outcomes: [{ multiplier: 0, weight: 33.333 }, { multiplier: 1, weight: 66.667 }] }), null);
  assert.equal(parseWheel({ enabled: true, outcomes: [{ multiplier: 0, weight: 0 }, { multiplier: 1, weight: 100 }] }), null);
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
    assert.deepEqual(status.multipliers, [0, 0.5, 1, 2, 5]);
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