const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const settings = require('../src/settings-store');
const { createStore } = require('../src/coin-log-sqlite-store');
const { createWithdrawalService, withdrawalMessage } = require('../src/withdrawal-service');
const { ReleaseError } = require('../src/pisonet-withdrawal-client');

function fixture(t, overrides = {}, serviceOptions = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-withdraw-service-'));
  const db = new DatabaseSync(':memory:');
  const coinLogs = createStore(db);
  settings.setAppRole('points', true);
  settings.setDataDir(dir);
  const pointRates = [{ pesos: 1, points: 1 }];
  settings.updateSettings({ pointRates });
  settings.updateTelegramSettings({ botToken: '123456789:' + 'A'.repeat(32), channelId: '-1001234567890' });
  settings.updateWithdrawalSettings({ enabled: true, min: 1, max: 100, loginUrl: 'http://127.0.0.1:8989/admin/api/login',
    username: 'fake-user', password: 'fake-test-password' });
  coinLogs.appendLog({ username: 'mem-alice', amount: 12.75, ip: 'a', mac: 'a' }, pointRates);
  coinLogs.appendLog({ username: 'mem-bob', amount: 20, ip: 'b', mac: 'b' }, pointRates);
  const messages = [];
  let releases = 0;
  const client = { login: async () => 'fake-token', release: async () => { releases++; }, ...overrides };
  const service = createWithdrawalService({ settings, coinLogs, client,
    sendTelegramMessage: async text => { messages.push(text); return { sent: true }; }, ...serviceOptions });
  t.after(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const input = (username = 'mem-alice', amount = 5, requestId = crypto.randomUUID()) =>
    ({ username, amount, requestId, station: 'PC 1' });
  return { service, coinLogs, pointRates, messages, input, dir, releases: () => releases };
}

test('central withdrawal settles once, retains fractional points, and preserves monthly ranking', async t => {
  const f = fixture(t);
  const before = f.coinLogs.getLeaderboard(5, f.pointRates);
  const request = f.input();
  const result = await f.service.withdraw(request);
  assert.equal(result.status, 'success');
  assert.equal(result.balance, 7.75);
  assert.equal((await f.service.withdraw(request)).status, 'success');
  assert.equal(f.releases(), 1);
  assert.deepEqual(f.coinLogs.getLeaderboard(5, f.pointRates), before);
  assert.equal(f.coinLogs.getMemberPoints('mem-alice', f.pointRates), 7.75);
  assert.ok(f.messages.some(text => /WITHDRAWAL SUCCESS/.test(text) && /Username: mem-alice/.test(text) &&
    /₱5/.test(text) && /Date:/.test(text) && /Time:/.test(text) && text.includes(request.requestId)));
});

test('ten-second cooldown is global, durable, no-debit, and duplicate-safe at its exact expiry', async t => {
  let clock = Date.now();
  const f = fixture(t, {}, { now: () => clock });
  const first = f.input();
  assert.equal((await f.service.withdraw(first)).status, 'success');
  clock = f.coinLogs.getLastConfirmedWithdrawalAt();
  assert.equal(f.service.machineState().state, 'cooldown');
  assert.equal(f.service.machineState().cooldownRemainingMs, 10000);
  assert.equal((await f.service.withdraw(first)).status, 'success');
  assert.equal(f.releases(), 1);
  const blocked = await f.service.withdraw(f.input('mem-bob', 1));
  assert.equal(blocked.status, 'failed');
  assert.match(blocked.reason, /cooling down/);
  assert.equal(blocked.balance, 20);
  const restarted = createWithdrawalService({ settings, coinLogs: f.coinLogs,
    now: () => clock, client: { login: async () => 'fake', release: async () => {} },
    sendTelegramMessage: async () => ({ sent: true }) });
  assert.equal(restarted.machineState().cooldownRemainingMs, 10000);
  clock += 9999;
  assert.equal(restarted.machineState().cooldownRemainingMs, 1);
  assert.equal((await restarted.withdraw(f.input('mem-bob', 1))).balance, 20);
  clock += 1;
  assert.equal(restarted.machineState().state, 'idle');
  const results = await Promise.all([
    f.service.withdraw(f.input('mem-bob', 1)),
    f.service.withdraw(f.input('mem-alice', 1)),
  ]);
  assert.deepEqual(results.map(r => r.status), ['success', 'failed']);
  assert.equal(f.releases(), 2);
});

test('definite login failure has no cooldown; uncertain payout stays paused until operator resolution', async t => {
  let clock = Date.now();
  const f = fixture(t, { login: async () => { throw new ReleaseError('Login failed', false); } },
    { now: () => clock });
  assert.equal((await f.service.withdraw(f.input())).status, 'failed');
  assert.equal(f.service.machineState().state, 'idle');
  const input = f.input('mem-bob', 1);
  f.coinLogs.reserveWithdrawal({ ...input, min: 1, max: 100, pointRates: f.pointRates });
  f.coinLogs.markWithdrawalSending(input.requestId);
  f.coinLogs.finishWithdrawal(input.requestId, { status: 'unconfirmed', reason: 'Unknown payout' });
  clock += 60000;
  assert.equal(f.service.machineState().state, 'unconfirmed');
  f.service.resolve(input.requestId, { released: true, reason: 'Machine confirms cash paid' });
  clock = f.coinLogs.getLastConfirmedWithdrawalAt();
  assert.equal(f.service.machineState().cooldownRemainingMs, 10000);
});

test('saved login probe never releases coins, creates a withdrawal or changes balances', async t => {
  let options;
  const f = fixture(t, { login: async (_config, value) => {
    options = value;
    value.onResponse({ httpStatus: 200, bodyFormat: 'json-object', tokenSource: 'JSON' });
    return 'fake-private-token';
  } });
  const result = await f.service.testLogin();
  assert.equal(options.force, true);
  assert.equal(result.authenticated, true);
  assert.equal(result.coinsRequested, false);
  assert.equal(f.releases(), 0);
  assert.equal(f.coinLogs.listWithdrawals(50).length, 0);
  assert.equal(f.coinLogs.getMemberPoints('mem-alice', f.pointRates), 12.75);
  assert.ok(!JSON.stringify(result).includes('fake-private-token'));
  assert.equal(f.service.machineState().busy, false);
});

test('login probe serializes with payouts and rejects overlapping probes without debiting points', async t => {
  let finish, started;
  const gate = new Promise(resolve => { finish = resolve; });
  const signal = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { login: async () => { started(); await gate; return 'fake-token'; } });
  const probe = f.service.testLogin();
  await signal;
  try {
    assert.equal((await f.service.testLogin()).authenticated, false);
    const withdrawal = await f.service.withdraw(f.input());
    assert.equal(withdrawal.status, 'failed');
    assert.equal(withdrawal.balance, 12.75);
    assert.equal(f.releases(), 0);
  } finally { finish(); }
  assert.equal((await probe).authenticated, true);
  assert.equal(f.service.machineState().busy, false);
});

test('simultaneous PCs and duplicate requests release once, never queue, and do not charge waiting members', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  let allowLogin;
  const gate = new Promise(resolve => { allowLogin = resolve; });
  const f = fixture(t, { login: async () => { await gate; return 'fake-token'; } });
  assert.deepEqual(f.service.machineState(), { busy: false, state: 'idle', message: '' });
  const first = f.input();
  const active = f.service.withdraw(first);
  assert.equal(f.service.machineState().state, 'processing');
  const rejected = Array.from({ length: 20 }, () => f.input('mem-bob', 5));
  const results = await Promise.all([
    ...Array.from({ length: 20 }, () => f.service.withdraw(first)),
    ...rejected.map(input => f.service.withdraw(input)),
  ]);
  assert.ok(results.slice(0, 20).every(record => record.status === 'reserved'));
  assert.ok(results.slice(20).every(record => record.status === 'failed' && /Nothing is queued/.test(record.reason)));
  assert.equal(f.coinLogs.getMemberPoints('mem-alice', f.pointRates), 7.75);
  assert.equal(f.coinLogs.getMemberPoints('mem-bob', f.pointRates), 20);
  assert.equal(f.releases(), 0);
  assert.equal(f.coinLogs.getLogs().logs.filter(log => log.source === 'withdrawal').length, 1);
  allowLogin();
  assert.equal((await active).status, 'success');
  assert.equal(f.releases(), 1);
  assert.equal(f.service.machineState().state, 'cooldown');
  for (const request of rejected) assert.equal((await f.service.withdraw(request)).status, 'failed');
  assert.equal(f.releases(), 1, 'previously rejected requests must never execute later');
  t.mock.timers.tick(10000);
  assert.equal(f.service.machineState().busy, false);
  assert.equal((await f.service.withdraw(f.input('mem-bob', 5))).status, 'success');
  assert.equal(f.releases(), 2, 'only a new, explicit request may run after the machine becomes idle');
  assert.equal(f.coinLogs.getMemberPoints('mem-bob', f.pointRates), 15);
});

test('unconfirmed payout pauses all PCs without exposing another member and only admin reconciliation unblocks', async t => {
  const f = fixture(t, { release: async () => { throw new ReleaseError('Fake uncertain reply', true); } });
  const request = f.input();
  assert.equal((await f.service.withdraw(request)).status, 'unconfirmed');
  f.service.recover();
  const machine = f.service.machineState();
  assert.equal(machine.busy, true);
  assert.equal(machine.state, 'unconfirmed');
  assert.ok(!JSON.stringify(machine).includes('mem-alice'));
  assert.equal((await f.service.withdraw(f.input('mem-bob', 5))).status, 'failed');
  assert.equal(f.coinLogs.getMemberPoints('mem-bob', f.pointRates), 20);
  f.service.resolve(request.requestId, { released: false, reason: 'Fake operator verified no cash paid.' });
  assert.equal(f.service.machineState().state, 'idle');
  assert.equal(f.coinLogs.getMemberPoints('mem-alice', f.pointRates), 12.75);
});

test('central machine lock rejects another PC while releasing and disables before dispatch', async t => {
  let completeLogin;
  const f = fixture(t, { login: () => new Promise(resolve => { completeLogin = resolve; }) });
  const first = f.service.withdraw(f.input());
  const second = await f.service.withdraw(f.input('mem-bob'));
  assert.equal(second.status, 'failed');
  assert.equal(second.balance, 20);
  settings.updateWithdrawalSettings({ ...settings.getWithdrawalSettings(), enabled: false });
  completeLogin('fake-token');
  const stopped = await first;
  assert.equal(stopped.status, 'failed');
  assert.equal(stopped.balance, 12.75);
  assert.equal(f.releases(), 0);
});

test('login failures restore points; unknown dispatched result holds points until explicit reconciliation', async t => {
  const f = fixture(t, { release: async () => { throw new ReleaseError('fake timeout after dispatch', true); } });
  const request = f.input();
  const result = await f.service.withdraw(request);
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.balance, 7.75);
  assert.equal((await f.service.withdraw(request)).status, 'unconfirmed');
  const blocked = await f.service.withdraw(f.input('mem-bob'));
  assert.equal(blocked.status, 'failed');
  assert.equal(blocked.balance, 20);
  const reconciled = f.service.resolve(request.requestId, { released: false, reason: 'Operator checked: no payout.' });
  assert.equal(reconciled.status, 'failed');
  assert.equal(reconciled.balance, 12.75);
  assert.equal(f.service.resolve(request.requestId, { released: false, reason: 'Repeated click' }), false);
  assert.equal(f.coinLogs.getMemberPoints('mem-alice', f.pointRates), 12.75);
});

test('credentials persist encrypted and never appear in public policies, settings or notifications', t => {
  const f = fixture(t);
  const raw = fs.readFileSync(path.join(f.dir, 'settings-server.json'), 'utf8');
  assert.ok(!raw.includes('fake-test-password'));
  assert.equal(settings.getWithdrawalSettings().password, 'fake-test-password');
  settings.updateWithdrawalSettings({ ...settings.getWithdrawalAdminSettings(), password: '' });
  assert.equal(settings.getWithdrawalSettings().password, 'fake-test-password');
  const visible = JSON.stringify([settings.getSettings(), settings.getPublicSettings(),
    settings.getWithdrawalAdminSettings(), settings.getWithdrawalPolicy()]);
  assert.ok(!visible.includes('fake-test-password'));
  assert.ok(!visible.includes('withdrawalPasswordEncrypted'));
  assert.ok(!visible.includes('withdrawal-key'));
  assert.ok(!withdrawalMessage({ username: 'mem-alice', station: 'PC 1', requestId: 'fake-id',
    amount: 1, status: 'failed', createdAt: Date.now(), reason: 'Login failed', balance: 12.75 }).includes('fake-test-password'));
});

test('decimal attempts, insufficient funds, and wrong owner/amount cannot release coins', async t => {
  const f = fixture(t);
  const invalid = await f.service.withdraw(f.input('mem-alice', 1.5));
  assert.equal(invalid.status, 'failed');
  assert.equal(f.releases(), 0);
  const insufficient = await f.service.withdraw(f.input('mem-alice', 13));
  assert.equal(insufficient.status, 'failed');
  assert.equal(insufficient.balance, 12.75);
  const request = f.input();
  await f.service.withdraw(request);
  await assert.rejects(f.service.withdraw({ ...request, username: 'mem-bob' }), /another member/);
  await assert.rejects(f.service.withdraw({ ...request, amount: 6 }), /another member or amount/);
  assert.equal(f.releases(), 1);
});

test('login failure and explicit release failure refund exactly once and send failed reports', async t => {
  const f = fixture(t, { login: async () => { throw new ReleaseError('Fake login rejected. No release sent.'); } });
  const request = f.input();
  const result = await f.service.withdraw(request);
  assert.equal(result.status, 'failed');
  assert.equal(result.balance, 12.75);
  await f.service.withdraw(request);
  assert.equal(f.releases(), 0);
  assert.equal(f.coinLogs.getMemberPoints('mem-alice', f.pointRates), 12.75);
  assert.ok(f.messages.some(text => /WITHDRAWAL FAILED/.test(text)));
});

test('daily cap is per member, centrally enforced without debit, and retries consume no extra allowance', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-02T04:00:00Z') });
  const f = fixture(t);
  settings.updateWithdrawalSettings({ ...settings.getWithdrawalSettings(), dailyLimit: 1 });
  const first = f.input('mem-alice', 1);
  assert.equal((await f.service.withdraw(first)).status, 'success');
  assert.equal(f.service.dailyState('mem-alice').remaining, 0);
  assert.equal(f.service.dailyState('mem-alice').allowed, false);
  assert.equal((await f.service.withdraw(first)).status, 'success');
  assert.equal(f.service.dailyState('mem-alice').used, 1);
  t.mock.timers.tick(10000);
  const denied = await f.service.withdraw(f.input('mem-alice', 1));
  assert.equal(denied.status, 'failed');
  assert.match(denied.reason, /Daily withdrawal limit/);
  assert.equal(denied.balance, 11.75);
  assert.equal(f.releases(), 1);
  assert.equal((await f.service.withdraw(f.input('mem-bob', 1))).status, 'success');
  assert.equal(f.releases(), 2);
  assert.equal(f.service.dailyState('mem-bob').used, 1);
});

test('configured count of three permits three successes, and midnight grants a new allowance without altering history', async t => {
  const midnight = Date.parse('2026-10-02T16:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: midnight - 60000 });
  const f = fixture(t);
  settings.updateWithdrawalSettings({ ...settings.getWithdrawalSettings(), dailyLimit: 3 });
  for (let n = 0; n < 3; n++) {
    assert.equal((await f.service.withdraw(f.input('mem-alice', 1))).status, 'success');
    t.mock.timers.tick(10000);
  }
  assert.equal(f.service.dailyState('mem-alice').remaining, 0);
  assert.equal((await f.service.withdraw(f.input('mem-alice', 1))).status, 'failed');
  assert.equal(f.releases(), 3);
  t.mock.timers.tick(30000);
  assert.equal(Date.now(), midnight);
  assert.equal(f.service.dailyState('mem-alice').used, 0);
  assert.equal((await f.service.withdraw(f.input('mem-alice', 1))).status, 'success');
  assert.equal(f.releases(), 4);
  assert.equal(f.coinLogs.listWithdrawals(50).filter(r => r.status === 'success').length, 4);
  assert.equal(f.coinLogs.getMemberPoints('mem-alice', f.pointRates), 8.75);
});

test('lowering daily cap during login cancels before dispatch and restores the reserved points', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-02T04:00:00Z') });
  let finishLogin;
  let logins = 0;
  const f = fixture(t, { login: () => ++logins === 1 ? Promise.resolve('fake-token')
    : new Promise(resolve => { finishLogin = resolve; }) });
  settings.updateWithdrawalSettings({ ...settings.getWithdrawalSettings(), dailyLimit: 3 });
  assert.equal((await f.service.withdraw(f.input('mem-alice', 1))).status, 'success');
  t.mock.timers.tick(10000);
  const pending = f.service.withdraw(f.input('mem-alice', 1));
  settings.updateWithdrawalSettings({ ...settings.getWithdrawalSettings(), dailyLimit: 1 });
  finishLogin('fake-token');
  const cancelled = await pending;
  assert.equal(cancelled.status, 'failed');
  assert.match(cancelled.reason, /Daily withdrawal limit/);
  assert.equal(cancelled.balance, 11.75);
  assert.equal(f.releases(), 1);
  assert.equal(f.service.dailyState('mem-alice').used, 1);
});

test('failed payouts consume no daily allowance; PAID reconciliation counts on the confirmation day', async t => {
  const midnight = Date.parse('2026-10-02T16:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: midnight - 1000 });
  const f = fixture(t, { release: async () => { throw new ReleaseError('Unknown outcome', true); } });
  settings.updateWithdrawalSettings({ ...settings.getWithdrawalSettings(), dailyLimit: 1 });
  const pending = f.input('mem-alice', 1);
  assert.equal((await f.service.withdraw(pending)).status, 'unconfirmed');
  assert.equal(f.service.dailyState('mem-alice').used, 0);
  t.mock.timers.tick(1000);
  assert.equal(f.service.resolve(pending.requestId, { released: true, reason: 'Operator verified cash paid' }).status, 'success');
  assert.equal(f.service.dailyState('mem-alice').used, 1);
  assert.equal(f.service.dailyState('mem-alice').allowed, false);
  assert.equal(f.service.machineState().state, 'cooldown');
});

test('old settings writes preserve an existing daily cap; explicit zero removes it', t => {
  fixture(t);
  settings.updateWithdrawalSettings({ ...settings.getWithdrawalSettings(), dailyLimit: 3 });
  const old = settings.getWithdrawalSettings();
  delete old.dailyLimit;
  settings.updateWithdrawalSettings(old);
  assert.equal(settings.getWithdrawalSettings().dailyLimit, 3);
  assert.throws(() => settings.updateWithdrawalSettings({ ...old, dailyLimit: null }), /per member per day/);
  assert.equal(settings.getWithdrawalSettings().dailyLimit, 3);
  settings.updateWithdrawalSettings({ ...old, dailyLimit: 0 });
  assert.equal(settings.getWithdrawalSettings().dailyLimit, 0);
});