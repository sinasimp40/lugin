const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const attendance = require('../src/attendance-store');

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
  let responseLossProxy;
  async function request(endpoint, method = 'GET', body, token) {
    const payload = body ? JSON.stringify(body) : '';
    const response = await fetch(url + endpoint, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { 'x-admin-token': token } : {})
      },
      body: body ? payload : undefined
    });
    return { code: response.status, data: await response.json() };
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
    async function kioskWriteOnPoints(input) {
      const expectedMission = (await request('/api/sync/attendance-config')).data;
      return request('/api/admin/kiosk-attendance', 'POST', { ...input, expectedMission }, token);
    }
    function missionFromSettings(s) {
      return {
        enabled: s.attendanceEnabled, mode: s.attendanceMode,
        minMinutes: s.attendanceMinMinutes, maxMinutes: s.attendanceMaxMinutes,
        minutes: s.attendanceMinutes, points: s.attendancePoints,
        targetSeed: s.attendanceTargetSeed
      };
    }
    const deniedPointsEdit = await request('/api/admin/attendance', 'POST',
      { enabled: true, mode: 'login', minutes: 1, points: 3 }, token);
    assert.equal(deniedPointsEdit.code, 403, 'Points admin cannot change the shared mission');
    assert.equal((await request('/api/sync/attendance-config')).data.enabled, false);
    const genericEdit = await request('/api/admin/settings', 'POST',
      { attendanceEnabled: true, attendanceMinMinutes: 2, attendanceMaxMinutes: 4,
        attendanceTargetSeed: '0'.repeat(32) }, token);
    assert.equal(genericEdit.data.settings.attendanceEnabled, false, 'generic settings cannot bypass mission ownership');
    const configure = await kioskWriteOnPoints(
      { enabled: true, mode: 'login', minMinutes: 1, maxMinutes: 1, points: 3 });
    assert.equal(configure.data.success, true);
    assert.equal((await request('/api/sync/attendance-config')).data.mode, 'login');
    const invalid = await request('/api/sync/attendance', 'POST',
      { deviceId: '00000000-0000-4000-8000-000000000001', day: '2000-01-01', username: 'mem-alice', seconds: 0 });
    assert.equal(invalid.code, 400);
    const day = new Date();
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
    const sample = { deviceId: '00000000-0000-4000-8000-000000000001', day: key, username: 'mem-alice', seconds: 0 };
    const first = await request('/api/sync/attendance', 'POST', sample);
    const retry = await request('/api/sync/attendance', 'POST', sample);
    assert.equal(first.data.attendance.awarded, true);
    assert.equal(retry.data.attendance.awarded, true);
    assert.equal((await request('/api/sync/member-points/mem-alice')).data.points, 3);
    assert.equal((await request('/api/sync/coin-logs')).data.logs.length, 1);

    const configureMinutes = await kioskWriteOnPoints(
      { enabled: true, mode: 'minutes', minMinutes: 1, maxMinutes: 1, points: 4 });
    assert.equal(configureMinutes.data.success, true);
    const bob = { ...sample, username: 'mem-bob', seconds: 30 };
    const partial = await request('/api/sync/attendance', 'POST', bob);
    assert.equal(partial.data.attendance.awarded, false);
    const partialYear = await request(`/api/sync/attendance-year/mem-bob?year=${day.getFullYear()}`);
    assert.equal(partialYear.data.days[key].status, 'incomplete');
    const complete = await request('/api/sync/attendance', 'POST', {
      ...bob, deviceId: '00000000-0000-4000-8000-000000000002', seconds: 30
    });
    assert.equal(complete.data.attendance.awarded, true);
    await request('/api/sync/attendance', 'POST', { ...bob, seconds: 60 });
    assert.equal((await request('/api/sync/member-points/mem-bob')).data.points, 4);
    assert.equal((await request('/api/sync/member-points/mem-alice')).data.points, 3);
    assert.equal((await request('/api/sync/coin-logs')).data.logs.length, 2);
    const bobYear = await request(`/api/sync/attendance-year/mem-bob?year=${day.getFullYear()}`);
    assert.equal(bobYear.data.days[key].status, 'completed');
    assert.equal(bobYear.data.days[key].points, 4);
    const absentYear = await request(`/api/sync/attendance-year/mem-nobody?year=${day.getFullYear()}`);
    assert.equal(absentYear.data.days[key].status, 'absent');
    assert.equal(Object.keys(absentYear.data.days).length,
      new Date(day.getFullYear(), 1, 29).getMonth() === 1 ? 366 : 365);
    const yesterday = new Date(day.getFullYear(), day.getMonth(), day.getDate() - 1);
    const previousKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    const late = await request('/api/sync/attendance', 'POST',
      { ...sample, day: previousKey, username: 'mem-carol', seconds: 60 });
    assert.equal(late.data.attendance.awarded, false, 'yesterday had no mission configured');
    assert.equal((await request('/api/sync/coin-logs')).data.logs.length, 2);
    const carolYear = await request(`/api/sync/attendance-year/mem-carol?year=${yesterday.getFullYear()}`);
    assert.equal(carolYear.data.days[previousKey].status, 'attended-no-mission');
    const noMissionYear = await request(`/api/sync/attendance-year/mem-nobody?year=${yesterday.getFullYear()}`);
    assert.equal(noMissionYear.data.days[previousKey].status, 'no-mission');

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
      { password: 'kiosk-password' })).data.token;
    assert.equal((await clientRequest('/api/admin/sync-server', 'POST',
      { url }, kioskToken)).data.connected, true);
    let clientSettings;
    for (let n = 0; n < 30; n++) {
      clientSettings = (await clientRequest('/api/admin/settings', 'GET',
        undefined, kioskToken)).data.settings;
      if (clientSettings.attendanceMode === 'minutes' && clientSettings.attendancePoints === 4) break;
      await delay(100);
    }
    assert.equal(clientSettings.attendanceMode, 'minutes');
    assert.equal(clientSettings.attendancePoints, 4);

    const sharedMission = { enabled: true, mode: 'login', minMinutes: 8, maxMinutes: 8, points: 2.75 };
    const missingPassword = await clientRequest('/api/admin/attendance', 'POST', sharedMission, kioskToken);
    assert.equal(missingPassword.code, 400, 'changing all kiosks requires Points admin authentication');
    const wrongPassword = await clientRequest('/api/admin/attendance', 'POST',
      { ...sharedMission, pointsAdminPassword: 'wrong-password', confirmedServerUrl: url }, kioskToken);
    assert.equal(wrongPassword.code, 403);
    const wrongServer = await clientRequest('/api/admin/attendance', 'POST',
      { ...sharedMission, pointsAdminPassword: 'test-password', confirmedServerUrl: 'http://wrong-server' }, kioskToken);
    assert.equal(wrongServer.code, 409, 'do not send an admin password to an unconfirmed server address');
    assert.equal((await request('/api/sync/attendance-config')).data.mode, 'minutes');
    assert.equal((await clientRequest('/api/admin/settings', 'GET', undefined, kioskToken)).data.settings.attendancePoints, 4);

    const saveFromKiosk = await clientRequest('/api/admin/attendance', 'POST',
      { ...sharedMission, expectedMission: missionFromSettings(clientSettings),
        pointsAdminPassword: 'test-password', confirmedServerUrl: url }, kioskToken);
    assert.equal(saveFromKiosk.code, 200);
    assert.equal(saveFromKiosk.data.settings.attendanceEnabled, true);
    assert.equal(saveFromKiosk.data.settings.attendanceMode, 'login');
    assert.equal(saveFromKiosk.data.settings.attendanceMinutes, 8);
    assert.equal(saveFromKiosk.data.settings.attendanceMinMinutes, 8);
    assert.equal(saveFromKiosk.data.settings.attendanceMaxMinutes, 8);
    assert.equal(saveFromKiosk.data.settings.attendancePoints, 2.75);
    const pointsSettings = (await request('/api/admin/settings', 'GET', undefined, token)).data.settings;
    assert.equal(pointsSettings.attendanceEnabled, true);
    assert.equal(pointsSettings.attendanceMode, 'login');
    assert.equal(pointsSettings.attendanceMinutes, 8);
    assert.equal(pointsSettings.attendancePoints, 2.75);
    assert.equal((await clientRequest('/api/admin/settings', 'GET', undefined, kioskToken)).data.settings.attendanceMode, 'login');
    assert.equal((await request('/api/sync/attendance-config')).data.points, 2.75);

    const pointsChanged = await request('/api/admin/attendance', 'POST',
      { enabled: false, mode: 'minutes', minutes: 3, points: 5.5 }, token);
    assert.equal(pointsChanged.code, 403);
    assert.equal((await request('/api/sync/attendance-config')).data.mode, 'login');
    const oldMission = (await request('/api/sync/attendance-config')).data;
    const otherKioskChanged = await kioskWriteOnPoints(
      { enabled: false, mode: 'minutes', minMinutes: 3, maxMinutes: 3, points: 5.5 });
    assert.equal(otherKioskChanged.data.success, true);
    const staleEdit = await request('/api/admin/kiosk-attendance', 'POST',
      { enabled: true, mode: 'login', minMinutes: 8, maxMinutes: 8, points: 2.75,
        expectedMission: oldMission }, token);
    assert.equal(staleEdit.code, 409, 'stale save cannot overwrite another kiosk');
    let mirrored;
    for (let n = 0; n < 50; n++) {
      mirrored = (await clientRequest('/api/admin/settings', 'GET', undefined, kioskToken)).data.settings;
      if (!mirrored.attendanceEnabled && mirrored.attendanceMinutes === 3 && mirrored.attendancePoints === 5.5) break;
      await delay(100);
    }
    assert.equal(mirrored.attendanceEnabled, false, 'Points changes propagate to another kiosk');
    assert.equal(mirrored.attendanceMode, 'minutes');
    assert.equal(mirrored.attendanceMinutes, 3);
    assert.equal(mirrored.attendancePoints, 5.5);
    const staleFormSave = await clientRequest('/api/admin/attendance', 'POST',
      { ...sharedMission, expectedMission: oldMission,
        pointsAdminPassword: 'test-password', confirmedServerUrl: url }, kioskToken);
    assert.equal(staleFormSave.code, 409, 'open kiosk form must be reloaded after the mission changes');
    const refreshed = await clientRequest('/api/admin/attendance-current', 'GET', undefined, kioskToken);
    assert.equal(refreshed.data.settings.attendancePoints, 5.5);

    const sharedMinutes = await clientRequest('/api/admin/attendance', 'POST',
      { enabled: true, mode: 'minutes', minMinutes: 2, maxMinutes: 4, points: 1.25,
        expectedMission: missionFromSettings(mirrored),
        pointsAdminPassword: 'test-password', confirmedServerUrl: url }, kioskToken);
    assert.equal(sharedMinutes.code, 200);
    const randomConfig = (await request('/api/sync/attendance-config')).data;
    assert.ok(randomConfig.minutes >= 2 && randomConfig.minutes <= 4);
    assert.equal(randomConfig.minMinutes, 2);
    assert.equal(randomConfig.maxMinutes, 4);
    assert.equal((await request('/api/sync/attendance-config')).data.minutes, randomConfig.minutes,
      'shared daily target does not reroll on refresh');
    assert.equal(sharedMinutes.data.settings.attendanceMinutes, randomConfig.minutes);
    assert.equal((await clientRequest('/api/admin/settings', 'GET', undefined, kioskToken)).data.settings.attendanceMinutes, randomConfig.minutes);
    assert.equal((await clientRequest('/api/admin/settings', 'GET', undefined, kioskToken)).data.settings.attendancePoints, 1.25);
    const targetSeconds = randomConfig.minutes * 60;
    const dana = { ...sample, username: 'mem-dana', seconds: targetSeconds - 1 };
    assert.equal((await request('/api/sync/attendance', 'POST', dana)).data.attendance.awarded, false);
    assert.equal((await request('/api/sync/attendance', 'POST', { ...dana, seconds: targetSeconds })).data.attendance.awarded, true);
    const centralDay = (await request(`/api/sync/attendance-year/mem-dana?year=${day.getFullYear()}`)).data.days[key];
    assert.equal(centralDay.status, 'completed');
    assert.equal(centralDay.seconds, targetSeconds);
    assert.equal(centralDay.goalSeconds, targetSeconds);
    assert.equal(centralDay.points, 1.25);
    attendance.setDataDir(dir);
    assert.equal(attendance.status('mem-dana', key).seconds, targetSeconds, 'progress is persisted by Denfi Points');
    assert.equal(attendance.status('mem-dana', key).awardedPoints, 1.25);

    const proxyPort = await freePort();
    responseLossProxy = http.createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const upstream = await fetch(url + req.url, {
          method: req.method,
          headers: {
            'content-type': 'application/json',
            ...(req.headers['x-admin-token'] ? { 'x-admin-token': req.headers['x-admin-token'] } : {})
          },
          body: chunks.length ? Buffer.concat(chunks) : undefined
        });
        const body = await upstream.text();
        if (req.method === 'POST' && req.url === '/api/admin/kiosk-attendance') {
          res.destroy(); // Points committed the mission, but its reply was lost.
          return;
        }
        res.writeHead(upstream.status, { 'content-type': 'application/json' });
        res.end(body);
      } catch (_) {
        if (!res.destroyed) res.writeHead(502).end();
      }
    });
    await new Promise(resolve => responseLossProxy.listen(proxyPort, '127.0.0.1', resolve));
    const proxyUrl = `http://127.0.0.1:${proxyPort}`;
    assert.equal((await clientRequest('/api/admin/sync-server', 'POST',
      { url: proxyUrl }, kioskToken)).data.connected, true);
    const lostReply = await clientRequest('/api/admin/attendance', 'POST',
      { enabled: true, mode: 'minutes', minMinutes: 4, maxMinutes: 4, points: 6.75,
        expectedMission: missionFromSettings((await clientRequest('/api/admin/settings', 'GET', undefined, kioskToken)).data.settings),
        pointsAdminPassword: 'test-password', confirmedServerUrl: proxyUrl }, kioskToken);
    assert.equal(lostReply.data.success, true, 'read back a mission committed before response loss');
    assert.equal((await request('/api/sync/attendance-config')).data.minutes, 4);
    assert.equal((await clientRequest('/api/admin/settings', 'GET', undefined, kioskToken)).data.settings.attendancePoints, 6.75);
    assert.equal((await clientRequest('/api/admin/sync-server', 'POST',
      { url }, kioskToken)).data.connected, true);
    responseLossProxy.closeAllConnections();
    await new Promise(resolve => responseLossProxy.close(resolve));
    responseLossProxy = null;

    const withoutMember = await clientRequest(`/api/session/attendance?year=${day.getFullYear()}`);
    assert.equal(withoutMember.code, 503, 'year view requires a confirmed active hotspot session');

    child.kill();
    await new Promise(resolve => child.once('exit', resolve));
    const offline = await clientRequest('/api/admin/attendance', 'POST',
      { ...sharedMission, pointsAdminPassword: 'test-password', confirmedServerUrl: url }, kioskToken);
    assert.equal(offline.code, 503, 'no silent local save when Denfi Points is unavailable');
    assert.equal((await clientRequest('/api/admin/attendance-current', 'GET', undefined, kioskToken)).code, 503,
      'reload does not pretend an offline cached mission is current');
    assert.equal((await clientRequest('/api/admin/settings', 'GET', undefined, kioskToken)).data.settings.attendanceMode, 'minutes');
    assert.equal((await clientRequest('/api/admin/sync-server', 'POST', { url: '' }, kioskToken)).data.connected, false);
    const localSave = await clientRequest('/api/admin/attendance', 'POST',
      { enabled: false, mode: 'login', minMinutes: 12, maxMinutes: 12, points: 0 }, kioskToken);
    assert.equal(localSave.data.success, true, 'standalone kiosk can still save all attendance fields');
    const localSettings = (await clientRequest('/api/admin/settings', 'GET', undefined, kioskToken)).data.settings;
    assert.equal(localSettings.attendanceEnabled, false);
    assert.equal(localSettings.attendanceMode, 'login');
    assert.equal(localSettings.attendanceMinutes, 12);
    assert.equal(localSettings.attendanceMinMinutes, 12);
    assert.equal(localSettings.attendanceMaxMinutes, 12);
    assert.equal(localSettings.attendancePoints, 0);
  } finally {
    if (responseLossProxy) {
      responseLossProxy.closeAllConnections();
      await new Promise(resolve => responseLossProxy.close(resolve));
    }
    if (client && client.exitCode === null) {
      client.kill();
      await new Promise(resolve => client.once('exit', resolve));
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill();
      await new Promise(resolve => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(clientDir, { recursive: true, force: true });
  }
});