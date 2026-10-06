const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const { createStore } = require('../src/coin-log-sqlite-store');
const { registerManualPointsRoutes } = require('../src/manual-points-routes');

async function fixture(t) {
  const db = new DatabaseSync(':memory:');
  const store = createStore(db);
  const rates = [{ pesos: 1, points: 1 }];
  const old = new Date();
  old.setMonth(old.getMonth() - 1);
  store.appendLog({ username: 'mem-admin-test', amount: 40,
    timestamp: old.getTime(), ip: 'older', mac: 'older' }, rates);
  store.appendLog({ username: 'mem-admin-test', amount: 10, ip: 'today', mac: 'today' }, rates);
  store.appendLog({ username: 'mem-other-test', amount: 10, ip: 'other', mac: 'other' }, rates);
  const servers = [];
  async function serve(readOnly) {
    const app = express();
    app.use(express.json());
    registerManualPointsRoutes(app, {
      coinLogs: store, settings: { getSettings: () => ({ pointRates: rates }) },
      verifyToken: (req, res, next) => req.headers['x-admin-token'] === 'fixture-admin'
        ? next() : res.status(401).json({ success: false, error: 'Not authorized' }),
      blockIfReadOnly: (req, res, next) => readOnly
        ? res.status(403).json({ success: false, error: 'Use Denfi Points.' }) : next(),
    });
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    servers.push(server);
    return 'http://127.0.0.1:' + server.address().port;
  }
  const url = await serve(false);
  const readOnlyUrl = await serve(true);
  t.after(async () => {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
    db.close();
  });
  async function call(path, body, token = 'fixture-admin', origin = url) {
    const response = await fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-admin-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, data: await response.json() };
  }
  return { store, rates, call, url, readOnlyUrl };
}

test('admin can select a member and append signed points to their balance and current ranking', async t => {
  const f = await fixture(t);
  const members = await f.call('/api/admin/point-adjustments/members');
  assert.deepEqual(members.data.members, ['mem-admin-test', 'mem-other-test']);
  const before = await f.call('/api/admin/point-adjustments/member/mem-admin-test');
  assert.equal(before.data.member.balance, 50);
  assert.equal(before.data.member.monthlyPoints, 10);
  const input = { username: 'mem-admin-test', delta: 12.75, reason: 'Operator bonus',
    requestId: crypto.randomUUID(), timestamp: 1, source: 'app', balance: 9999 };
  const added = await f.call('/api/admin/point-adjustments', input);
  assert.equal(added.status, 200);
  assert.equal(added.data.log.amount, 0);
  assert.equal(added.data.log.source, 'manual-adjustment');
  assert.equal(added.data.log.reason, input.reason);
  assert.ok(added.data.log.timestamp > Date.now() - 10000, 'timestamp is server owned');
  assert.equal(added.data.member.balance, 62.75);
  assert.equal(added.data.member.monthlyPoints, 22.75);
  const deducted = await f.call('/api/admin/point-adjustments', {
    username: input.username, delta: -7.25, reason: 'Operator correction', requestId: crypto.randomUUID(),
  });
  assert.equal(deducted.data.member.balance, 55.5);
  assert.equal(deducted.data.member.monthlyPoints, 15.5);
  assert.equal(f.store.getMemberPoints('mem-other-test', f.rates), 10);
  const unknown = await f.call('/api/admin/point-adjustments/member/mem-new-test');
  assert.equal(unknown.data.member.hasHistory, false);
  assert.equal(unknown.data.member.balance, 0);
  const created = await f.call('/api/admin/point-adjustments', {
    username: 'mem-new-test', delta: 2.5, reason: 'Verified first credit', requestId: crypto.randomUUID(),
  });
  assert.equal(created.data.member.hasHistory, true);
  assert.equal(created.data.member.balance, 2.5);
});

test('duplicate requests and response-loss retries apply once; changed requests, overdrafts and holds are rejected', async t => {
  const f = await fixture(t);
  const input = { username: 'mem-admin-test', delta: -5.5, reason: 'Duplicate-safe deduction',
    requestId: crypto.randomUUID() };
  const responses = await Promise.all([
    f.call('/api/admin/point-adjustments', input), f.call('/api/admin/point-adjustments', input),
  ]);
  assert.ok(responses.every(response => response.status === 200));
  assert.deepEqual(responses.map(response => response.data.replayed).sort(), [false, true]);
  assert.equal(f.store.getMemberPoints(input.username, f.rates), 44.5);
  assert.equal(f.store.getLogs().logs.filter(row => row.requestId === input.requestId).length, 1);
  assert.equal((await f.call('/api/admin/point-adjustments', { ...input, delta: 5.5 })).status, 409);
  assert.equal((await f.call('/api/admin/point-adjustments', {
    ...input, requestId: crypto.randomUUID(), delta: -100,
  })).status, 409);
  f.store.reserveWithdrawal({ username: input.username, requestId: crypto.randomUUID(),
    amount: 1, station: 'PC 10', min: 1, max: 100, pointRates: f.rates });
  assert.equal((await f.call('/api/admin/point-adjustments/member/' + input.username)).data.member.blocked, true);
  assert.equal((await f.call('/api/admin/point-adjustments', {
    ...input, requestId: crypto.randomUUID(), delta: 1,
  })).status, 409);
  assert.equal((await f.call('/api/admin/point-adjustments', input)).data.replayed, true,
    'confirming an already-applied adjustment is safe even during a later hold');
});

test('manual adjustments require Points admin authorization and reject invalid values without changing balances', async t => {
  const f = await fixture(t);
  const input = { username: 'mem-admin-test', delta: 1, reason: 'Test adjustment',
    requestId: crypto.randomUUID() };
  for (const endpoint of ['/api/admin/point-adjustments/members',
    '/api/admin/point-adjustments/member/mem-admin-test', '/api/admin/point-adjustments']) {
    const body = endpoint === '/api/admin/point-adjustments' ? input : undefined;
    assert.equal((await f.call(endpoint, body, '')).status, 401);
    assert.equal((await f.call(endpoint, body, 'fixture-admin', f.readOnlyUrl)).status, 403);
  }
  for (const invalid of [{ delta: 0 }, { delta: '2' }, { delta: 0.001 },
    { reason: 'no' }, { username: 'voucher-user' }, { requestId: 'invalid' }]) {
    assert.equal((await f.call('/api/admin/point-adjustments', { ...input, ...invalid })).status, 400);
  }
  assert.equal(f.store.getMemberPoints(input.username, f.rates), 50);
  assert.equal(f.store.getLogs().logs.filter(row => row.source === 'manual-adjustment').length, 0);
});