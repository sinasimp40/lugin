const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const settings = require('../src/settings-store');
const { createStore } = require('../src/coin-log-sqlite-store');
const { registerWithdrawalRoutes } = require('../src/withdrawal-routes');
const { ReleaseError } = require('../src/pisonet-withdrawal-client');
const { createPisonetWithdrawalClient } = require('../src/pisonet-withdrawal-client');
const pointsToken = 'b'.repeat(64), kioskToken = 'a'.repeat(64);

async function fixture(t, ambiguous = false, { releaseWait, onRelease, blockReverse = false, legacyPoints = false, pisonetClient } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-withdraw-routes-'));
  settings.setAppRole('points', true);
  settings.setDataDir(dir);
  const rates = [{ pesos: 1, points: 1 }];
  settings.updateSettings({ pointRates: rates });
  settings.updateTelegramSettings({ botToken: '123456789:' + 'A'.repeat(32), channelId: '-1001234567890' });
  settings.updateWithdrawalSettings({ enabled: true, min: 1, max: 50,
    loginUrl: 'http://127.0.0.1:8989/admin/api/login', username: 'fake-user', password: 'fake-password' });
  const db = new DatabaseSync(':memory:');
  const coinLogs = createStore(db);
  for (const username of ['mem-alice', 'mem-bob']) coinLogs.appendLog({
    username, amount: 20.75, ip: username, mac: username,
  }, rates);
  const servers = [];
  let releases = 0, pointsLogins = 0, reverseCalls = 0;
  const auth = token => (req, res, next) =>
    req.headers['x-admin-token'] === token ? next() : res.status(401).json({ success: false, error: 'Not authorized' });
  const gate = (req, res, next) => req.headers['x-deny-lan'] === '1'
    ? res.status(403).json({ success: false, error: 'Untrusted network' }) : next();
  async function serve(app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    servers.push(server);
    return 'http://127.0.0.1:' + server.address().port;
  }
  const pointsApp = express();
  pointsApp.use(express.json());
  if (legacyPoints) {
    pointsApp.get('/api/sync/withdrawal/policy', (req, res) =>
      res.json({ success: true, version: 1, enabled: true, min: 1, max: 50 }));
    pointsApp.post('/api/sync/withdrawal/admin-session', (req, res) => {
      reverseCalls++;
      res.status(403).json({ success: false, error: 'Old reverse verification failed' });
    });
  }
  pointsApp.post('/api/admin/login', (req, res) => {
    pointsLogins++;
    res.status(401).json({ success: false, error: 'No Points admin account exists in this fixture' });
  });
  registerWithdrawalRoutes(pointsApp, {
    settings, coinLogs, appRole: 'points', verifyToken: auth(pointsToken),
    authorizeKioskMission: gate, requireLocalPlayer: gate, activeMember: async () => null,
    getPointsUrl: () => '', sendTelegramMessage: async () => ({ sent: true }),
    pisonetClient: pisonetClient || { login: async () => 'fake-token', release: async () => {
      releases++;
      if (onRelease) onRelease();
      if (releaseWait) await releaseWait;
      if (ambiguous) throw new ReleaseError('fake release timeout', true);
    } },
  });
  const pointsUrl = await serve(pointsApp);
  async function kiosk(username) {
    const app = express();
    app.use(express.json());
    if (blockReverse) app.post('/api/admin/withdrawal/access', (req, res) => {
      reverseCalls++;
      res.status(503).json({ success: false, error: 'Reverse connections blocked in this fixture' });
    });
    registerWithdrawalRoutes(app, {
      settings: { getTelegramSettings: () => ({}) }, coinLogs,
      appRole: 'auto-shutdown', verifyToken: auth(kioskToken), authorizeKioskMission: gate,
      requireLocalPlayer: gate, activeMember: async () => ({ username, station: 'PC ' + username }),
      getPointsUrl: () => pointsUrl, sendTelegramMessage: async () => ({ sent: false }),
    });
    return serve(app);
  }
  const alice = await kiosk('mem-alice'), bob = await kiosk('mem-bob');
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  async function call(url, route, body, token) {
    const response = await fetch(url + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  }
  return { pointsUrl, alice, bob, call, coinLogs, kiosk, releases: () => releases,
    pointsLogins: () => pointsLogins, reverseCalls: () => reverseCalls };
}

test('another PC sees shared busy state, then ten-second cooldown, without charging or queueing', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let allowRelease, signalStarted;
  const releaseWait = new Promise(resolve => { allowRelease = resolve; });
  const started = new Promise(resolve => { signalStarted = resolve; });
  const f = await fixture(t, false, { releaseWait, onRelease: signalStarted });
  const active = f.call(f.alice, '/api/session/withdrawal', { requestId: crypto.randomUUID(), amount: 5 });
  await started;
  try {
    const other = await f.call(f.bob, '/api/session/withdrawal');
    assert.equal(other.data.machine.busy, true);
    assert.equal(other.data.machine.state, 'processing');
    assert.equal(other.data.withdrawal, null);
    assert.equal(other.data.balance, 20.75);
    assert.ok(!JSON.stringify(other.data.machine).includes('mem-alice'));
    const rejected = await f.call(f.bob, '/api/session/withdrawal', { requestId: crypto.randomUUID(), amount: 5 });
    assert.equal(rejected.data.withdrawal.status, 'failed');
    assert.equal(rejected.data.machine.busy, true);
    assert.equal(rejected.data.balance, 20.75);
    assert.equal(f.releases(), 1);
  } finally { allowRelease(); }
  assert.equal((await active).data.withdrawal.status, 'success');
  const cooldown = await f.call(f.bob, '/api/session/withdrawal');
  assert.equal(cooldown.data.machine.state, 'cooldown');
  assert.equal(cooldown.data.machine.cooldownRemainingMs, 10000);
  const denied = await f.call(f.bob, '/api/session/withdrawal', { requestId: crypto.randomUUID(), amount: 1 });
  assert.equal(denied.data.withdrawal.status, 'failed');
  assert.equal(denied.data.balance, 20.75);
  assert.equal(f.releases(), 1);
  t.mock.timers.tick(10000);
  const nowIdle = await f.call(f.bob, '/api/session/withdrawal');
  assert.equal(nowIdle.data.machine.busy, false);
  assert.equal(nowIdle.data.machine.state, 'idle');
  assert.equal(nowIdle.data.balance, 20.75);
  assert.equal(f.releases(), 1, 'the rejected second PC request never runs later');
});

test('connected kiosk admin manages shared credentials and limits without a second Points password', async t => {
  const f = await fixture(t);
  const original = settings.getWithdrawalAdminSettings();
  const attack = { ...original, loginUrl: 'http://127.0.0.1:9999/admin/api/login' };
  assert.equal((await f.call(f.pointsUrl, '/api/sync/withdrawal/settings', attack)).status, 401);
  assert.equal(settings.getWithdrawalAdminSettings().loginUrl, original.loginUrl);
  assert.equal((await f.call(f.alice, '/api/admin/withdrawal', attack)).status, 401);
  assert.equal((await f.call(f.alice, '/api/admin/withdrawals')).status, 401);
  assert.equal((await f.call(f.pointsUrl, '/api/sync/withdrawal/history')).status, 401);
  const connected = await f.call(f.alice, '/api/admin/withdrawal', undefined, kioskToken);
  assert.equal(connected.data.connected, true);
  assert.equal(connected.data.writeAuthorized, true);
  assert.equal(connected.data.adminProtocol, 2);
  assert.equal(connected.data.pointsServer, f.pointsUrl);
  const view = await f.call(f.alice, '/api/admin/withdrawal', undefined, kioskToken);
  assert.equal(view.data.writeAuthorized, true);
  assert.equal(view.data.withdrawal.passwordConfigured, true);
  assert.ok(!JSON.stringify(view.data).includes('fake-password'));
  assert.equal(view.data.token, undefined, 'upstream server credential must never reach the UI');
  const saved = await f.call(f.alice, '/api/admin/withdrawal', { ...original, min: 3, max: 40, enabled: false }, kioskToken);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.withdrawal.enabled, false);
  const secondPC = await f.call(f.bob, '/api/session/withdrawal');
  assert.equal(secondPC.data.enabled, false);
  assert.equal(secondPC.data.min, 3);
  assert.equal(secondPC.data.max, 40);
  assert.ok(!JSON.stringify(secondPC.data).includes('loginUrl'));
  const secondAdmin = await f.call(f.bob, '/api/admin/withdrawal', undefined, kioskToken);
  assert.equal(secondAdmin.status, 200);
  assert.equal(secondAdmin.data.withdrawal.min, 3);
  assert.equal(secondAdmin.data.withdrawal.max, 40);
  assert.equal(f.pointsLogins(), 0, 'connected admins do not sign into Points or need a Points admin account');
});

test('daily cap publishes across PCs and cannot be bypassed by switching PCs or retrying requests', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-02T04:00:00Z') });
  const f = await fixture(t);
  const original = await f.call(f.alice, '/api/admin/withdrawal', undefined, kioskToken);
  assert.equal(original.data.dailyLimitSupported, true);
  const saved = await f.call(f.alice, '/api/admin/withdrawal',
    { ...original.data.withdrawal, dailyLimit: 1 }, kioskToken);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.withdrawal.dailyLimit, 1);
  const secondAlicePC = await f.kiosk('mem-alice');
  const status = await f.call(secondAlicePC, '/api/session/withdrawal');
  assert.equal(status.data.dailyLimit, 1);
  assert.equal(status.data.daily.used, 0);
  assert.equal(status.data.daily.remaining, 1);
  const id = crypto.randomUUID();
  const paid = await f.call(f.alice, '/api/session/withdrawal', { requestId: id, amount: 1 });
  assert.equal(paid.data.withdrawal.status, 'success');
  assert.equal(paid.data.daily.remaining, 0);
  assert.equal(paid.data.daily.allowed, false);
  const replay = await f.call(secondAlicePC, '/api/session/withdrawal', { requestId: id, amount: 1 });
  assert.equal(replay.data.withdrawal.status, 'success');
  assert.equal(replay.data.daily.used, 1);
  assert.equal(f.releases(), 1);
  t.mock.timers.tick(10000);
  const rejected = await f.call(secondAlicePC, '/api/session/withdrawal', { requestId: crypto.randomUUID(), amount: 1 });
  assert.equal(rejected.data.withdrawal.status, 'failed');
  assert.match(rejected.data.withdrawal.reason, /Daily withdrawal limit/);
  assert.equal(rejected.data.balance, 19.75);
  assert.equal(f.releases(), 1);
  const bob = await f.call(f.bob, '/api/session/withdrawal', { requestId: crypto.randomUUID(), amount: 1 });
  assert.equal(bob.data.withdrawal.status, 'success');
  assert.equal(f.releases(), 2);
  const recordCheck = await f.call(secondAlicePC, '/api/session/withdrawal/' + id);
  assert.equal(recordCheck.data.daily.used, 1);
});

test('daily policy resets at midnight, validates input, and older admin writes retain the cap', async t => {
  const midnight = Date.parse('2026-10-02T16:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: midnight - 30000 });
  const f = await fixture(t);
  const original = (await f.call(f.alice, '/api/admin/withdrawal', undefined, kioskToken)).data.withdrawal;
  assert.equal((await f.call(f.alice, '/api/admin/withdrawal', { ...original, dailyLimit: 1 }, kioskToken)).status, 200);
  for (const dailyLimit of [null, -1, 1.1, '2', 1001]) {
    assert.equal((await f.call(f.alice, '/api/admin/withdrawal', { ...original, dailyLimit }, kioskToken)).status, 400);
  }
  const legacy = { ...original, min: 2 };
  delete legacy.dailyLimit;
  const oldSave = await f.call(f.alice, '/api/admin/withdrawal', legacy, kioskToken);
  assert.equal(oldSave.data.withdrawal.dailyLimit, 1);
  assert.equal((await f.call(f.alice, '/api/session/withdrawal',
    { requestId: crypto.randomUUID(), amount: 2 })).data.withdrawal.status, 'success');
  assert.equal((await f.call(f.alice, '/api/session/withdrawal')).data.daily.allowed, false);
  t.mock.timers.tick(30000);
  const reset = await f.call(f.alice, '/api/session/withdrawal');
  assert.equal(reset.data.daily.used, 0);
  assert.equal(reset.data.daily.remaining, 1);
  assert.equal(reset.data.daily.dayKey, '2026-10-03');
  assert.equal(reset.data.daily.resetAt, midnight + 86400000);
  assert.equal(reset.data.balance, 18.75);
  assert.equal(f.releases(), 1, 'reset does not send a payout or restore spent balances');
});

test('stale diskless deployment reports connected older Points module instead of trying reverse verification', async t => {
  const f = await fixture(t, false, { legacyPoints: true });
  const view = await f.call(f.alice, '/api/admin/withdrawal', undefined, kioskToken);
  assert.equal(view.status, 409);
  assert.equal(view.data.connected, true);
  assert.equal(view.data.pointsServer, f.pointsUrl);
  assert.match(view.data.error, /older withdrawal admin module/);
  assert.match(view.data.error, /diskless/i);
  assert.equal(f.reverseCalls(), 0);
});

test('saved login test is admin-only, forwards to Points, and never dispenses or leaks a token', async t => {
  const f = await fixture(t);
  const route = '/api/admin/withdrawal/test-login';
  assert.equal((await f.call(f.alice, route, {})).status, 401);
  assert.equal((await f.call(f.pointsUrl, '/api/sync/withdrawal/test-login', {})).status, 401);
  const view = await f.call(f.alice, '/api/admin/withdrawal', undefined, kioskToken);
  assert.equal(view.data.loginTestSupported, true);
  const checked = await f.call(f.alice, route, {}, kioskToken);
  assert.equal(checked.status, 200);
  assert.equal(checked.data.authenticated, true);
  assert.equal(checked.data.coinsRequested, false);
  assert.equal(f.releases(), 0);
  assert.equal(f.coinLogs.listWithdrawals(50).length, 0);
  assert.ok(!JSON.stringify(checked.data).includes('fake-token'));
  assert.ok(!JSON.stringify(checked.data).includes('fake-password'));
});

test('real HTTP login header matches supplied controller, then pays exactly once through kiosk and Points', async t => {
  const controller = express();
  controller.use(express.json());
  let logins = 0, releases = 0, origin;
  controller.post('/admin/api/login', (req, res) => {
    logins++;
    assert.deepEqual(req.body, { username: 'fake-user', password: 'fake-password' });
    assert.equal(req.headers.origin, origin);
    assert.equal(req.headers.referer, origin + '/admin/');
    res.set('Authorization', 'Bearer fake-controller-private-token')
      .json({ success: false, data: [] });
  });
  controller.post('/admin/api/changer/releaseCoin', (req, res) => {
    releases++;
    assert.equal(req.headers.authorization, 'Bearer fake-controller-private-token');
    assert.equal(req.headers.referer, origin + '/admin/coin-changer/');
    assert.deepEqual(req.body, { amount: '2' });
    res.json(true);
  });
  const server = controller.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  origin = 'http://127.0.0.1:' + server.address().port;
  t.after(() => new Promise(resolve => server.close(resolve)));
  const f = await fixture(t, false, { pisonetClient: createPisonetWithdrawalClient() });
  settings.updateWithdrawalSettings({ ...settings.getWithdrawalSettings(), loginUrl: origin + '/admin/api/login' });
  const probe = await f.call(f.alice, '/api/admin/withdrawal/test-login', {}, kioskToken);
  assert.equal(probe.data.authenticated, true);
  assert.equal(probe.data.diagnostics.tokenSource, 'Authorization header');
  assert.equal(releases, 0);
  assert.ok(!JSON.stringify(probe.data).includes('fake-controller-private-token'));
  const request = { requestId: crypto.randomUUID(), amount: 2 };
  const paid = await f.call(f.alice, '/api/session/withdrawal', request);
  assert.equal(paid.data.withdrawal.status, 'success');
  assert.equal(paid.data.balance, 18.75);
  assert.equal(logins, 1, 'reuse the token from the safe login test');
  assert.equal(releases, 1);
  await f.call(f.alice, '/api/session/withdrawal', request);
  assert.equal(releases, 1, 'duplicate request never dispatches more coins');
});

test('player browsers and untrusted network peers cannot acquire upstream withdrawal admin access', async t => {
  const f = await fixture(t);
  for (const extra of [{ Origin: f.pointsUrl }, { Referer: f.pointsUrl + '/' },
    { 'sec-fetch-site': 'same-origin' }, { 'x-deny-lan': '1' }]) {
    const response = await fetch(f.pointsUrl + '/api/sync/withdrawal/admin-session', {
      method: 'POST', headers: { 'x-denfi-kiosk-server': 'auto-shutdown', ...extra },
    });
    assert.equal(response.status, 403);
  }
  assert.equal((await f.call(f.pointsUrl, '/api/sync/withdrawal/admin-session', {})).status, 403);
  assert.equal((await f.call(f.alice, '/api/admin/withdrawal', undefined, '0'.repeat(64))).status, 401);
});

test('connected kiosk admin can load, save, view history and reconcile when reverse connections are blocked', async t => {
  const f = await fixture(t, true, { blockReverse: true });
  const view = await f.call(f.alice, '/api/admin/withdrawal', undefined, kioskToken);
  assert.equal(view.status, 200);
  assert.equal(view.data.writeAuthorized, true);
  const saved = await f.call(f.alice, '/api/admin/withdrawal',
    { ...view.data.withdrawal, min: 2, max: 40 }, kioskToken);
  assert.equal(saved.status, 200);
  const other = await f.call(f.bob, '/api/session/withdrawal');
  assert.equal(other.data.min, 2);
  assert.equal(other.data.max, 40);
  const requestId = crypto.randomUUID();
  const payout = await f.call(f.alice, '/api/session/withdrawal', { requestId, amount: 5 });
  assert.equal(payout.data.withdrawal.status, 'unconfirmed');
  const history = await f.call(f.alice, '/api/admin/withdrawals', undefined, kioskToken);
  assert.equal(history.status, 200);
  assert.ok(history.data.withdrawals.some(record => record.requestId === requestId));
  const resolved = await f.call(f.alice, '/api/admin/withdrawals/' + requestId + '/resolve',
    { released: false, reason: 'Fixture operator verified no payout.' }, kioskToken);
  assert.equal(resolved.status, 200);
  assert.equal(resolved.data.balance, 20.75);
  assert.equal(f.reverseCalls(), 0, 'Points must never call back to a kiosk to authorize admin operations');
  assert.equal(f.pointsLogins(), 0);
  assert.equal((await f.call(f.alice, '/api/admin/withdrawals')).status, 401);
});

test('kiosk derives member identity, retains same-ID result, and permits only explicit owned not-found retry', async t => {
  const f = await fixture(t);
  const requestId = crypto.randomUUID();
  const body = { requestId, amount: 5, username: 'mem-bob' };
  const first = await f.call(f.alice, '/api/session/withdrawal', body);
  assert.equal(first.data.withdrawal.username, 'mem-alice', 'body identity must not override active session');
  assert.equal(first.data.withdrawal.status, 'success');
  assert.equal(first.data.balance, 15.75);
  assert.equal((await f.call(f.alice, '/api/session/withdrawal', body)).data.balance, 15.75);
  assert.equal(f.releases(), 1);
  assert.equal((await f.call(f.bob, '/api/session/withdrawal/' + requestId)).status, 403);
  const absent = await f.call(f.alice, '/api/session/withdrawal/' + crypto.randomUUID());
  assert.equal(absent.status, 404);
  assert.equal(absent.data.notFound, true);
});

test('admin paid reconciliation keeps the debit; unpaid reconciliation refunds exactly once', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const f = await fixture(t, true);
  const paidId = crypto.randomUUID();
  const paid = await f.call(f.alice, '/api/session/withdrawal', { requestId: paidId, amount: 5 });
  assert.equal(paid.data.withdrawal.status, 'unconfirmed');
  assert.equal((await f.call(f.pointsUrl, '/api/sync/withdrawal/' + paidId + '/resolve',
    { released: false, reason: 'Unauthenticated attempt' })).status, 401);
  const confirmedPaid = await f.call(f.alice, '/api/admin/withdrawals/' + paidId + '/resolve',
    { released: true, reason: 'Operator physically confirmed all coins were paid.' }, kioskToken);
  assert.equal(confirmedPaid.data.withdrawal.status, 'success');
  assert.equal(confirmedPaid.data.balance, 15.75);
  assert.equal((await f.call(f.alice, '/api/admin/withdrawals/' + paidId + '/resolve',
    { released: false, reason: 'Repeated conflicting decision' }, kioskToken)).status, 409);
  t.mock.timers.tick(10000);
  const unpaidId = crypto.randomUUID();
  await f.call(f.alice, '/api/session/withdrawal', { requestId: unpaidId, amount: 5 });
  const refunded = await f.call(f.alice, '/api/admin/withdrawals/' + unpaidId + '/resolve',
    { released: false, reason: 'Operator checked: no coins dispensed.' }, kioskToken);
  assert.equal(refunded.data.withdrawal.status, 'failed');
  assert.equal(refunded.data.balance, 15.75);
  assert.equal((await f.call(f.alice, '/api/admin/withdrawals/' + unpaidId + '/resolve',
    { released: false, reason: 'Duplicate refund attempt' }, kioskToken)).status, 409);
  assert.equal(f.releases(), 2);
});