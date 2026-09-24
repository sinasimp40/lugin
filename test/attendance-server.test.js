const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const attendanceAuth = require('../src/attendance-auth');

async function freePort() {
  const socket = net.createServer();
  await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  return port;
}

test('points server grants daily login or play-time reward once, with saved settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-attendance-api-'));
  const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-attendance-client-'));
  const port = await freePort();
  const clientPort = await freePort();
  const bootstrap = `
    const dir = process.env.DENFI_TEST_DATA_DIR;
    require('./src/settings-store').setAppRole('points');
    require('./src/settings-store').setDataDir(dir);
    require('./src/coin-log-store').setDataDir(dir);
    require('./src/attendance-store').setDataDir(dir);
    require('./src/order-store').setDataDir(dir);
    require('./server');
  `;
  const child = spawn(process.execPath, ['-e', bootstrap], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DENFI_APP_ROLE: 'points', DENFI_TEST_DATA_DIR: dir },
    stdio: 'ignore'
  });
  const url = `http://127.0.0.1:${port}`;
  let client;
  async function request(endpoint, method = 'GET', body, token, attendanceKey) {
    const payload = body ? JSON.stringify(body) : '';
    const signed = attendanceKey
      ? attendanceAuth.signRequest(attendanceKey, method, endpoint, payload) : null;
    const response = await fetch(url + endpoint, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-admin-token': token } : {}),
        ...(signed ? signed.headers : {})
      },
      body: body ? payload : undefined
    });
    const raw = await response.text();
    if (signed && response.ok) {
      assert.ok(attendanceAuth.verifyResponse(attendanceKey, signed.nonce, raw,
        response.headers.get('x-attendance-response-sig')), 'points response is authenticated');
    }
    return { code: response.status, data: JSON.parse(raw) };
  }
  try {
    let ready = false;
    for (let n = 0; n < 60; n++) {
      if (child.exitCode !== null) throw new Error('Points server exited before ready');
      try {
        const status = await request('/api/admin/status');
        if (status.data.appRole === 'points') { ready = true; break; }
      } catch (_) {}
      await delay(100);
    }
    assert.ok(ready, 'points server started');
    const register = await request('/api/admin/register', 'POST', { password: 'test-password' });
    assert.equal(register.data.success, true);
    const token = register.data.token;
    const configure = await request('/api/admin/attendance', 'POST',
      { enabled: true, mode: 'login', minutes: 1, points: 3 }, token);
    assert.equal(configure.data.success, true);
    const attendanceKey = 'test-kiosk-shared-key-123456789';
    const unauthorized = await request('/api/sync/attendance', 'POST',
      { deviceId: '00000000-0000-4000-8000-000000000001', day: '2000-01-01', username: 'mem-alice', seconds: 0 });
    assert.equal(unauthorized.code, 403);
    assert.equal((await request('/api/admin/attendance-pair', 'POST', { key: attendanceKey }, token)).data.success, true);
    assert.equal((await request('/api/sync/attendance-auth', 'GET', undefined, undefined, attendanceKey)).code, 200);
    assert.equal((await request('/api/sync/attendance-auth')).code, 403);
    assert.equal((await request('/api/sync/attendance-config')).code, 403);
    assert.equal((await request('/api/sync/attendance-config', 'GET',
      undefined, undefined, attendanceKey)).data.mode, 'login');
    const day = new Date();
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const sample = { deviceId: '00000000-0000-4000-8000-000000000001', day: key, username: 'mem-alice', seconds: 0 };
    const first = await request('/api/sync/attendance', 'POST', sample, undefined, attendanceKey);
    const retry = await request('/api/sync/attendance', 'POST', sample, undefined, attendanceKey);
    assert.equal(first.data.attendance.awarded, true);
    assert.equal(retry.data.attendance.awarded, true);
    assert.equal((await request('/api/sync/member-points/mem-alice')).data.points, 3);
    assert.equal((await request('/api/sync/coin-logs')).data.logs.length, 1);

    const configureMinutes = await request('/api/admin/attendance', 'POST',
      { enabled: true, mode: 'minutes', minutes: 1, points: 4 }, token);
    assert.equal(configureMinutes.data.success, true);
    const bob = { ...sample, username: 'mem-bob', seconds: 30 };
    const partial = await request('/api/sync/attendance', 'POST', bob, undefined, attendanceKey);
    assert.equal(partial.data.attendance.awarded, false);
    const complete = await request('/api/sync/attendance', 'POST', {
      ...bob, deviceId: '00000000-0000-4000-8000-000000000002', seconds: 30
    }, undefined, attendanceKey);
    assert.equal(complete.data.attendance.awarded, true);
    await request('/api/sync/attendance', 'POST', { ...bob, seconds: 60 }, undefined, attendanceKey);
    assert.equal((await request('/api/sync/member-points/mem-bob')).data.points, 4);
    assert.equal((await request('/api/sync/member-points/mem-alice')).data.points, 3);
    assert.equal((await request('/api/sync/coin-logs')).data.logs.length, 2);
    const yesterday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
    const previousKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const late = await request('/api/sync/attendance', 'POST',
      { ...sample, day: previousKey, username: 'mem-carol', seconds: 60 }, undefined, attendanceKey);
    assert.equal(late.data.attendance.awarded, false, 'yesterday had no mission configured');
    assert.equal((await request('/api/sync/coin-logs')).data.logs.length, 2);

    const clientBootstrap = `
      const dir = process.env.DENFI_TEST_DATA_DIR;
      require('./src/settings-store').setAppRole('auto-shutdown');
      require('./src/settings-store').setDataDir(dir);
      require('./src/coin-log-store').setDataDir(dir);
      require('./src/attendance-store').setDataDir(dir);
      require('./src/order-store').setDataDir(dir);
      require('./server');
    `;
    client = spawn(process.execPath, ['-e', clientBootstrap], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(clientPort), DENFI_APP_ROLE: 'auto-shutdown',
        DENFI_TEST_DATA_DIR: clientDir },
      stdio: 'ignore'
    });
    async function clientRequest(endpoint, method = 'GET', body, adminToken) {
      const response = await fetch(`http://127.0.0.1:${clientPort}${endpoint}`, {
        method,
        headers: { ...(body ? { 'content-type': 'application/json' } : {}),
          ...(adminToken ? { 'x-admin-token': adminToken } : {}) },
        body: body ? JSON.stringify(body) : undefined
      });
      return { code: response.status, data: await response.json() };
    }
    let clientReady = false;
    for (let n = 0; n < 60; n++) {
      if (client.exitCode !== null) throw new Error('Kiosk server exited before ready');
      try {
        const status = await clientRequest('/api/admin/status');
        if (status.data.appRole === 'auto-shutdown') { clientReady = true; break; }
      } catch (_) {}
      await delay(100);
    }
    assert.ok(clientReady, 'kiosk server started');
    const kioskToken = (await clientRequest('/api/admin/register', 'POST',
      { password: 'test-password' })).data.token;
    assert.equal((await clientRequest('/api/admin/sync-server', 'POST',
      { url }, kioskToken)).data.connected, true);
    assert.equal((await clientRequest('/api/admin/attendance-pair', 'POST',
      { key: 'wrong-test-shared-key-1234567' }, kioskToken)).code, 403);
    assert.equal((await clientRequest('/api/admin/attendance-pair', 'POST',
      { key: attendanceKey }, kioskToken)).data.success, true);
    assert.equal((await clientRequest('/api/admin/attendance-pair', 'GET',
      undefined, kioskToken)).data.configured, true);
    const clientSettings = (await clientRequest('/api/admin/settings', 'GET',
      undefined, kioskToken)).data.settings;
    assert.equal(clientSettings.attendanceMode, 'minutes');
    assert.equal(clientSettings.attendancePoints, 4);
    assert.ok(!JSON.stringify(clientSettings).includes(attendanceKey), 'pair key must not leak in settings');
  } finally {
    if (client && client.exitCode === null) {
      client.kill();
      await new Promise(resolve => client.once('exit', resolve));
    }
    if (child.exitCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(clientDir, { recursive: true, force: true });
  }
});