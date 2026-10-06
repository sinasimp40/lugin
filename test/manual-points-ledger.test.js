const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const jsonStore = require('../src/coin-log-store');
const { createStore } = require('../src/coin-log-sqlite-store');

const rates = [{ pesos: 1, points: 1 }];
const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function makeStore(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-manual-points-'));
  if (name === 'JSON') {
    jsonStore.setDataDir(dir);
    return { store: jsonStore, dir };
  }
  const db = new DatabaseSync(path.join(dir, 'ledger.sqlite'));
  return { store: createStore(db), db, dir };
}

function adjustment(store, values = {}) {
  return store.adjustMemberPoints({
    username: 'mem-manual', delta: 1.25, reason: 'Admin correction',
    requestId, ...values
  }, rates);
}

function assertStatus(status, fn) {
  assert.throws(fn, error => error.status === status);
}

for (const name of ['JSON', 'SQLite']) {
  test(`${name} manual adjustments validate, append signed ledger entries, and replay idempotently`, t => {
    const { store, dir, db } = makeStore(name);
    t.after(() => {
      if (db) db.close();
      if (name === 'JSON') jsonStore.setDataDir(path.join(__dirname, '..', 'data'));
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const first = adjustment(store, {
      username: 'mem-New.Admin_1', delta: 2.35,
      reason: '  first credit\r\napproved  ', requestId: requestId.toUpperCase()
    });
    assert.equal(first.replayed, false);
    assert.equal(first.balance, 2.35);
    assert.equal(first.log.source, 'manual-adjustment');
    assert.equal(first.log.amount, 0);
    assert.equal(first.log.points, 2.35);
    assert.equal(first.log.username, 'mem-New.Admin_1');
    assert.equal(first.log.reason, 'first credit approved');
    assert.equal(first.log.requestId, requestId);
    assert.match(first.log.timeAdded, /manual point adjustment/i);
    assert.ok(first.log.id);
    assert.ok(first.log.timestamp > 0);
    assert.ok(first.log.date);

    const replay = adjustment(store, {
      username: 'mem-New.Admin_1', delta: 2.35,
      reason: 'first credit approved', requestId
    });
    assert.equal(replay.replayed, true);
    assert.equal(replay.log.id, first.log.id);
    assert.equal(replay.balance, 2.35);

    assertStatus(409, () => adjustment(store, {
      username: 'mem-New.Admin_1', delta: 2.34,
      reason: 'first credit approved', requestId
    }));
    assertStatus(409, () => adjustment(store, {
      username: 'mem-other', delta: 2.35,
      reason: 'first credit approved', requestId
    }));
    assertStatus(409, () => adjustment(store, {
      username: 'mem-New.Admin_1', delta: 2.35,
      reason: 'another reason', requestId
    }));

    const debit = adjustment(store, {
      username: 'mem-New.Admin_1', delta: -0.35,
      reason: 'Cash correction', requestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    });
    assert.equal(debit.log.points, -0.35);
    assert.equal(debit.balance, 2);
    assert.equal(store.getMemberPoints('mem-New.Admin_1', rates), 2);
    assert.equal(store.getLogs().logs.filter(log => log.source === 'manual-adjustment').length, 2);
  });

  test(`${name} manual adjustments reject malformed input, overdrafts, and unresolved withdrawals`, t => {
    const { store, dir, db } = makeStore(name);
    t.after(() => {
      if (db) db.close();
      if (name === 'JSON') jsonStore.setDataDir(path.join(__dirname, '..', 'data'));
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const valid = {
      username: 'mem-manual', delta: 1, reason: 'Valid reason', requestId
    };
    const invalidInputs = [
      { username: 'mem-' }, { username: 'x'.repeat(100) }, { username: 'mem-space user' },
      { delta: 0 }, { delta: 1000000.01 }, { delta: 1.001 }, { delta: Infinity },
      { delta: '1' }, { reason: '  ' }, { reason: 'no' }, { reason: 'x'.repeat(301) },
      { reason: 'bad\tcontrol' }, { requestId: 'not-a-uuid' }
    ];
    for (const invalid of invalidInputs) {
      assertStatus(400, () => store.adjustMemberPoints({ ...valid, ...invalid }, rates));
    }
    assert.equal(store.getLogs().logs.length, 0, 'invalid requests never append ledger rows');
    assertStatus(409, () => adjustment(store, { delta: -0.01 }));
    assert.equal(store.getMemberPoints('mem-manual', rates), 0);

    store.appendLog({ username: 'mem-manual', amount: 10, ip: 'admin-test', mac: 'admin-test' }, rates);
    store.reserveWithdrawal({
      username: 'mem-manual', requestId: 'hold-manual', amount: 1,
      station: 'PC', min: 1, max: 1000, pointRates: rates
    });
    assertStatus(409, () => adjustment(store, { delta: 1 }));
    assert.equal(store.getMemberPoints('mem-manual', rates), 9);
    assert.equal(store.getLogs().logs.filter(log => log.source === 'manual-adjustment').length, 0);
  });

  test(`${name} manual ledger points survive rate recalculation and affect only their own month ranking`, t => {
    const { store, dir, db } = makeStore(name);
    const realNow = Date.now;
    const january = new Date(2025, 0, 15, 12).getTime();
    const february = new Date(2025, 1, 15, 12).getTime();
    t.after(() => {
      Date.now = realNow;
      if (db) db.close();
      if (name === 'JSON') jsonStore.setDataDir(path.join(__dirname, '..', 'data'));
      fs.rmSync(dir, { recursive: true, force: true });
    });
    Date.now = () => february;
    store.appendLog({
      username: 'mem-manual', amount: 10, timestamp: january, ip: 'old', mac: 'old'
    }, rates);
    adjustment(store, { delta: 2, reason: 'February credit' });
    adjustment(store, {
      delta: -0.5, reason: 'February debit',
      requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    });

    assert.equal(store.getMemberPoints('mem-manual', rates), 11.5);
    assert.deepEqual(store.getLeaderboard(5, rates), [{ username: 'mem-manual', points: 1.5 }]);
    assert.deepEqual(store.getLeaderboard(5, rates, '2025-01'),
      [{ username: 'mem-manual', points: 10 }]);

    const changedRates = [{ pesos: 2, points: 1 }];
    store.recalcAllPoints(changedRates);
    assert.equal(store.getMemberPoints('mem-manual', changedRates), 6.5);
    assert.deepEqual(store.getLeaderboard(5, changedRates),
      [{ username: 'mem-manual', points: 1.5 }]);
    assert.deepEqual(store.getLeaderboard(5, changedRates, '2025-01'),
      [{ username: 'mem-manual', points: 5 }]);
    const adjustmentLogs = store.getLogs().logs.filter(log => log.source === 'manual-adjustment');
    assert.deepEqual(adjustmentLogs.map(log => log.points).sort((a, b) => a - b), [-0.5, 2]);
  });

  test(`${name} manual adjustments synchronize changed rates before balance checks and replay`, t => {
    const { store, dir, db } = makeStore(name);
    t.after(() => {
      if (db) db.close();
      if (name === 'JSON') jsonStore.setDataDir(path.join(__dirname, '..', 'data'));
      fs.rmSync(dir, { recursive: true, force: true });
    });
    store.appendLog({ username: 'mem-rate-down', amount: 10, ip: 'down', mac: 'down' }, rates);
    const lowerRates = [{ pesos: 2, points: 1 }];
    const debit = {
      username: 'mem-rate-down', reason: 'Rate-aware debit',
      requestId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    };
    assertStatus(409, () => store.adjustMemberPoints({ ...debit, delta: -6 }, lowerRates));
    assert.equal(store.getMemberPoints('mem-rate-down'), 5,
      'the rate synchronization remains durable even when the adjustment is rejected');
    assert.equal(store.getMemberPoints('mem-rate-down', lowerRates), 5);
    assert.equal(store.getLogs().logs.filter(log => log.source === 'manual-adjustment').length, 0);
    const acceptedDebit = store.adjustMemberPoints({ ...debit, delta: -4 }, lowerRates);
    assert.equal(acceptedDebit.balance, 1);

    store.appendLog({ username: 'mem-rate-up', amount: 10, ip: 'up', mac: 'up' }, rates);
    const higherRates = [{ pesos: 1, points: 2 }];
    const credit = {
      username: 'mem-rate-up', delta: 1, reason: 'Rate-aware credit',
      requestId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    };
    const acceptedCredit = store.adjustMemberPoints(credit, higherRates);
    assert.equal(acceptedCredit.balance, 21);
    store.appendLog({ username: 'mem-rate-up', amount: 1, ip: 'up-2', mac: 'up-2' }, higherRates);
    const replay = store.adjustMemberPoints(credit, higherRates);
    assert.equal(replay.replayed, true);
    assert.equal(replay.log.id, acceptedCredit.log.id);
    assert.equal(replay.balance, 23, 'replay reports the current recalculated ledger balance');
  });
}