const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const pointsDb = require('../src/points-database');
const jsonCoins = require('../src/coin-log-store');
const { createStore: createCoins } = require('../src/coin-log-sqlite-store');
const { createStore: createAttendance } = require('../src/attendance-sqlite-store');

afterEach(() => pointsDb.close());

function tempData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-points-migration-'));
}

function write(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
}

test('rejected whole-number amounts outside the payout range remain auditable after migration', () => {
  const dir = tempData();
  const withdrawals = [0, -5, 1001].map((amount, index) => ({
    id: 'rejected-' + index, requestId: 'rejected-request-' + index,
    username: 'mem-a', station: 'PC', amount, status: 'failed',
    createdAt: 1000, timestamp: 1000, updatedAt: 1000,
    reason: 'Invalid amount; no points deducted.', balance: 0,
    notificationVersion: 1, notificationSentVersion: 0,
  }));
  write(dir, 'coin-logs.json', { logs: [], withdrawals });
  const db = pointsDb.initialize(dir);
  const store = createCoins(db);
  assert.equal(store.listWithdrawals(50).length, 3);
  for (const record of withdrawals) {
    assert.equal(store.getWithdrawal(record.requestId).amount, record.amount);
    assert.equal(store.getWithdrawal(record.requestId).status, 'failed');
  }
  assert.equal(store.getMemberPoints('mem-a', []), 0);
  assert.equal(store.getUnresolvedWithdrawal(), null);
});

test('imports existing records exactly, retains JSON and settings, and resumes from SQLite on restart', () => {
  const dir = tempData();
  const now = Date.now();
  const day = new Date(now).toLocaleDateString('en-CA');
  const logs = [
    { id: 'old-coin', username: 'mem-alice', amount: 10, points: 2.5, timestamp: now,
      ip: '10.0.0.2', mac: 'abc' }, // Older Points files did not always include source.
    { id: 'old-award', username: 'mem-alice', amount: 0, points: 3, timestamp: now,
      attendanceDay: day, source: 'attendance' },
    { id: 'old-spin', username: 'mem-alice', amount: 0, points: -1, timestamp: now,
      source: 'wheel', requestId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      multiplier: 0, stake: 1, payout: 0, notificationSent: true }
  ];
  const originalCoins = { logs, memberPoints: { 'mem-alice': 4.5 }, _ratesHash: 'old-rates' };
  const originalAttendance = { deviceId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', days: {
    [day]: { 'mem-alice': { devices: { 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb': 42 },
      awarded: true, awardedPoints: 3 } }
  } };
  write(dir, 'coin-logs.json', originalCoins);
  write(dir, 'attendance.json', originalAttendance);
  write(dir, 'settings-server.json', { testSetting: 'untouched' });
  const before = ['coin-logs.json', 'attendance.json', 'settings-server.json']
    .map(name => fs.readFileSync(path.join(dir, name), 'utf8'));

  let db = pointsDb.initialize(dir);
  let coins = createCoins(db);
  let attendance = createAttendance(db);
  assert.equal(coins.getLogs().logs.length, 3);
  assert.deepEqual(coins.getLogs().logs.map(log => log.id).sort(), logs.map(log => log.id).sort());
  assert.equal(coins.getMemberPoints('mem-alice'), 4.5);
  assert.equal(coins.getLogs().memberPoints['mem-alice'], 4.5);
  assert.equal(attendance.status('mem-alice', day).seconds, 42);
  assert.equal(attendance.status('mem-alice', day).awardedPoints, 3);
  assert.equal(attendance.onlineSample('mem-alice', true).deviceId, originalAttendance.deviceId);
  assert.equal(coins.getWheelSpin(logs[2].requestId).id, 'old-spin');
  assert.equal(coins.appendAttendanceAward('mem-alice', day, 3), false);
  assert.equal(fs.readdirSync(path.join(dir, 'legacy-json-backups')).length, 1);
  const backup = path.join(dir, 'legacy-json-backups',
    fs.readdirSync(path.join(dir, 'legacy-json-backups'))[0]);
  for (const [i, name] of ['coin-logs.json', 'attendance.json', 'settings-server.json'].entries()) {
    assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), before[i]);
    assert.equal(fs.readFileSync(path.join(backup, name), 'utf8'), before[i]);
  }
  coins.clearAllLogs();
  assert.equal(coins.getMemberPoints('mem-alice'), 0);
  assert.equal(attendance.status('mem-alice', day).seconds, 42);
  pointsDb.close();
  db = pointsDb.initialize(dir);
  coins = createCoins(db);
  attendance = createAttendance(db);
  assert.equal(coins.getLogs().logs.length, 0, 'cleared logs must not be re-imported');
  assert.equal(attendance.status('mem-alice', day).seconds, 42);
  assert.equal(fs.readdirSync(path.join(dir, 'legacy-json-backups')).length, 1);
});

test('migration preserves withdrawal holds and recovery refunds only an undispatched reservation', () => {
  const dir = tempData();
  const now = Date.now();
  const username = 'mem-withdraw-migrate';
  const logs = [
    { id: 'wd-earned', username, timestamp: now - 5000, source: 'app', amount: 100, points: 100 },
    { id: 'wd-unconfirmed-debit', username, timestamp: now - 4000, source: 'withdrawal',
      requestId: 'wd-unconfirmed', amount: 0, withdrawalAmount: 5, points: -5 },
    { id: 'wd-reserved-debit', username, timestamp: now - 3000, source: 'withdrawal',
      requestId: 'wd-reserved', amount: 0, withdrawalAmount: 10, points: -10 },
    { id: 'wd-success-debit', username, timestamp: now - 2000, source: 'withdrawal',
      requestId: 'wd-success', amount: 0, withdrawalAmount: 7, points: -7 },
    { id: 'wd-failed-debit', username, timestamp: now - 1000, source: 'withdrawal',
      requestId: 'wd-failed', amount: 0, withdrawalAmount: 3, points: -3 },
    { id: 'wd-failed-refund', username, timestamp: now, source: 'withdrawal-refund',
      requestId: 'wd-failed', amount: 0, withdrawalAmount: 3, points: 3 }
  ];
  const base = {
    username, station: 'PC 7', timestamp: now, updatedAt: now,
    reason: null, notificationSentVersion: 0
  };
  const withdrawals = [
    { ...base, id: 'record-unconfirmed', requestId: 'wd-unconfirmed', amount: 5,
      status: 'unconfirmed', createdAt: now - 4000, balance: 95, notificationVersion: 1,
      notificationLeaseToken: 'existing-lease', notificationLeaseUntil: now + 100000,
      notificationLeaseVersion: 1 },
    { ...base, id: 'record-reserved', requestId: 'wd-reserved', amount: 10,
      status: 'reserved', createdAt: now - 3000, balance: 85, notificationVersion: 0 },
    { ...base, id: 'record-success', requestId: 'wd-success', amount: 7,
      status: 'success', createdAt: now - 2000, balance: 78, notificationVersion: 1 },
    { ...base, id: 'record-failed', requestId: 'wd-failed', amount: 3,
      status: 'failed', createdAt: now - 1000, balance: 78, notificationVersion: 1,
      refunded: true }
  ];
  write(dir, 'coin-logs.json', {
    logs, withdrawals, memberPoints: { [username]: 78 }, _ratesHash: 'test-rates'
  });
  const original = fs.readFileSync(path.join(dir, 'coin-logs.json'), 'utf8');

  const db = pointsDb.initialize(dir);
  const coins = createCoins(db);
  assert.equal(coins.getMemberPoints(username), 78, 'import preserves the original lifetime wallet');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM withdrawals').get().n, withdrawals.length);
  for (const record of withdrawals) {
    const payload = db.prepare('SELECT payload FROM withdrawals WHERE request_id = ?').get(record.requestId);
    assert.deepEqual(JSON.parse(payload.payload), record, 'identity, timestamps, balance, notification version and lease are preserved');
    const publicRecord = coins.getWithdrawal(record.requestId);
    assert.equal(publicRecord.id, record.id);
    assert.equal(publicRecord.createdAt, record.createdAt);
    assert.equal(publicRecord.updatedAt, record.updatedAt);
    assert.equal(publicRecord.amount, record.amount);
    assert.equal(Number.isSafeInteger(publicRecord.amount), true);
    assert.equal(publicRecord.balance, record.balance);
    assert.equal(publicRecord.notificationLeaseToken, undefined, 'public rows never expose lease tokens');
  }
  assert.equal(fs.readFileSync(path.join(dir, 'coin-logs.json'), 'utf8'), original,
    'migration keeps the legacy source unchanged');
  const backupDir = path.join(dir, 'legacy-json-backups');
  assert.equal(fs.readdirSync(backupDir).length, 1);
  const backup = path.join(backupDir, fs.readdirSync(backupDir)[0], 'coin-logs.json');
  assert.equal(fs.readFileSync(backup, 'utf8'), original);

  assert.equal(coins.reserveWithdrawal({
    username, requestId: 'wd-reserved', amount: 10, station: 'PC 7',
    pointRates: [{ pesos: 1, points: 1 }], min: 1, max: 1000
  }).id, 'record-reserved', 'retrying an imported request does not insert another debit');
  assert.equal(coins.recoverWithdrawals(), 1);
  assert.equal(coins.getWithdrawal('wd-unconfirmed').status, 'unconfirmed');
  assert.equal(coins.getWithdrawal('wd-reserved').status, 'failed');
  assert.equal(coins.getWithdrawal('wd-success').status, 'success');
  assert.equal(coins.getWithdrawal('wd-failed').status, 'failed');
  assert.equal(coins.getMemberPoints(username), 88, 'recovery refunds the single undispatched hold');
  assert.equal(coins.getLogs().logs.filter(log =>
    log.source === 'withdrawal-refund' && log.requestId === 'wd-reserved').length, 1);
  const logCount = coins.getLogs().logs.length;
  assert.equal(coins.recoverWithdrawals(), 0, 'repeated recovery does not refund twice');
  assert.equal(coins.getLogs().logs.length, logCount);
  assert.equal(coins.getMemberPoints(username), 88);
  assert.equal(coins.getLogs().logs.filter(log => log.source === 'withdrawal' &&
    log.requestId === 'wd-reserved').length, 1);
});

test('a malformed JSON source stops migration, preserves it, and does not activate a database', () => {
  const dir = tempData();
  write(dir, 'coin-logs.json', '{broken');
  assert.throws(() => pointsDb.initialize(dir), /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'coin-logs.json'), 'utf8'), '{broken');
  assert.equal(fs.existsSync(path.join(dir, 'denfi-points.db')), false);
});

test('an unknown withdrawal status refuses migration without altering the JSON source', () => {
  const dir = tempData();
  const original = {
    logs: [], withdrawals: [{
      id: 'unknown-record', requestId: 'unknown-request', username: 'mem-hold',
      station: 'PC', amount: 5, status: 'pending', createdAt: Date.now(),
      timestamp: Date.now(), updatedAt: Date.now(), reason: null, balance: 10,
      notificationVersion: 0, notificationSentVersion: 0
    }]
  };
  write(dir, 'coin-logs.json', original);
  const source = fs.readFileSync(path.join(dir, 'coin-logs.json'), 'utf8');
  assert.throws(() => pointsDb.initialize(dir), /withdrawal 0 has invalid fields/);
  assert.equal(pointsDb.isActive(), false);
  assert.equal(fs.existsSync(path.join(dir, 'denfi-points.db')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'coin-logs.json'), 'utf8'), source);
});

test('duplicate IDs stop import without changing either JSON file', () => {
  const dir = tempData();
  const source = { logs: [
    { id: 'repeated', username: 'mem-a', timestamp: Date.now(), points: 1 },
    { id: 'repeated', username: 'mem-b', timestamp: Date.now(), points: 1 }
  ] };
  write(dir, 'coin-logs.json', source);
  assert.throws(() => pointsDb.initialize(dir), /migration stopped/);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'coin-logs.json'), 'utf8')), source);
  assert.equal(fs.existsSync(path.join(dir, 'denfi-points.db')), false);
});

test('changed legacy JSON after migration blocks startup rather than silently losing new records', () => {
  const dir = tempData();
  write(dir, 'coin-logs.json', { logs: [] });
  pointsDb.initialize(dir);
  pointsDb.close();
  write(dir, 'coin-logs.json', { logs: [{ id: 'later' }] });
  assert.throws(() => pointsDb.initialize(dir), /changed since import/);
  const db = new DatabaseSync(path.join(dir, 'denfi-points.db'));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM coin_logs').get().count, 0);
  db.close();
});

test('imports the checked-in older log format without rewriting its source', () => {
  const dir = tempData();
  fs.copyFileSync(path.join(__dirname, '..', 'data', 'coin-logs.json'), path.join(dir, 'coin-logs.json'));
  const original = JSON.parse(fs.readFileSync(path.join(dir, 'coin-logs.json'), 'utf8'));
  const db = pointsDb.initialize(dir);
  const coins = createCoins(db);
  assert.equal(coins.getLogs().logs.length, original.logs.length);
  assert.deepEqual(coins.getLogs().logs.find(log => log.id === original.logs[0].id), original.logs[0]);
});

test('live coin, attendance and wheel writes remain in SQLite and survive restart', () => {
  const dir = tempData();
  write(dir, 'coin-logs.json', { logs: [] });
  write(dir, 'attendance.json', { deviceId: '00000000-0000-4000-8000-000000000001', days: {} });
  let db = pointsDb.initialize(dir);
  let coins = createCoins(db);
  let attendance = createAttendance(db);
  const rates = [{ pesos: 1, points: 1 }];
  const day = attendance.dayKey();
  const inserted = coins.appendLog({ username: 'mem-alice', amount: 10, ip: 'a', mac: 'b' }, rates);
  coins.appendLog({ username: 'mem-alice', amount: 10, ip: 'a', mac: 'b' }, rates);
  assert.equal(coins.getLogs().logs.length, 1, 'replayed coin event must not double credit');
  assert.equal(coins.getMemberPoints('mem-alice', rates), 10);
  const sample = { deviceId: '00000000-0000-4000-8000-000000000001',
    day, username: 'mem-alice', seconds: 60 };
  attendance.merge(sample);
  assert.equal(attendance.status('mem-alice').seconds, 60);
  assert.equal(coins.appendAttendanceAward('mem-alice', day, 2), true);
  assert.equal(coins.appendAttendanceAward('mem-alice', day, 2), false);
  attendance.markAwarded('mem-alice', day, 2);
  assert.equal(attendance.status('mem-alice').awardedPoints, 2);
  assert.equal(coins.getMemberPoints('mem-alice', rates), 12);
  const requestId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const outcomes = [{ multiplier: 0, weight: 100 }];
  const spin = coins.appendWheelSpin({ username: 'mem-alice', requestId, station: 'PC1',
    outcomes, pointRates: rates, expectedStake: 12 });
  assert.equal(spin.net, -12);
  assert.equal(coins.getMemberPoints('mem-alice', rates), 0);
  assert.equal(coins.appendWheelSpin({ username: 'mem-alice', requestId, station: 'PC1',
    outcomes, pointRates: rates, expectedStake: 12 }).id, spin.id);
  assert.equal(coins.getDailyWheelStatus('mem-alice').spinsUsed, 1);
  assert.equal(coins.getWheelSpin(requestId).id, spin.id);
  assert.equal(coins.getLeaderboard(5, rates).length, 0);
  assert.equal(coins.deleteLog(inserted.id), true);
  assert.equal(coins.getMemberPoints('mem-alice', rates), -10);
  pointsDb.close();
  db = pointsDb.initialize(dir);
  coins = createCoins(db);
  attendance = createAttendance(db);
  assert.equal(coins.getMemberPoints('mem-alice', rates), -10);
  assert.equal(attendance.status('mem-alice').seconds, 60);
  assert.equal(coins.getLogs().logs.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'coin-logs.json'), 'utf8')), { logs: [] });
});

test('attendance award and ledger roll back together on failure', () => {
  const dir = tempData();
  const db = pointsDb.initialize(dir);
  const coins = createCoins(db);
  const attendance = createAttendance(db);
  const day = attendance.dayKey();
  attendance.merge({ deviceId: '00000000-0000-4000-8000-000000000001',
    day, username: 'mem-alice', seconds: 60 });
  assert.throws(() => pointsDb.transaction(() => {
    coins.appendAttendanceAward('mem-alice', day, 2);
    attendance.markAwarded('mem-alice', day, 2);
    throw new Error('simulated failure');
  }), /simulated failure/);
  assert.equal(coins.getLogs().logs.length, 0);
  assert.equal(attendance.status('mem-alice', day).awarded, false);
  pointsDb.transaction(() => {
    coins.appendAttendanceAward('mem-alice', day, 2);
    attendance.markAwarded('mem-alice', day, 2);
  });
  assert.equal(coins.getLogs().logs.length, 1);
  assert.equal(attendance.status('mem-alice', day).awardedPoints, 2);
});

test('existing cumulative admin totals are kept even if they differ from the log sum', () => {
  const dir = tempData();
  write(dir, 'coin-logs.json', { logs: [
    { id: 'log', username: 'mem-alice', timestamp: Date.now(), amount: 1,
      points: 2, source: 'app' }
  ], memberPoints: { 'mem-alice': 3 }, _ratesHash: 'existing' });
  const coins = createCoins(pointsDb.initialize(dir));
  assert.equal(coins.getMemberPoints('mem-alice'), 2, 'wallet balance is based on the ledger');
  assert.equal(coins.getLogs().memberPoints['mem-alice'], 3, 'original admin total is retained');
});

test('wallet balances carry across months in JSON and SQLite while rankings stay monthly', () => {
  const dir = tempData();
  const jsonDir = tempData();
  const originalNow = Date.now;
  const january = new Date(2025, 0, 31, 12).getTime();
  const february = new Date(2025, 1, 1, 12).getTime();
  const rates = [{ pesos: 1, points: 1 }];
  const logs = [
    { id: 'jan-credit', username: 'mem-carry', timestamp: january, source: 'app',
      amount: 20, points: 20 },
    { id: 'jan-bet-debit', username: 'mem-carry', timestamp: january + 1000,
      source: 'wheel', amount: 0, points: -5 }
  ];
  const source = { logs, memberPoints: { 'mem-carry': 15 } };
  try {
    Date.now = () => february;
    write(dir, 'coin-logs.json', source);
    write(jsonDir, 'coin-logs.json', source);
    const sqlite = createCoins(pointsDb.initialize(dir));
    jsonCoins.setDataDir(jsonDir);

    for (const store of [sqlite, jsonCoins]) {
      assert.equal(store.getMemberPoints('mem-carry', rates), 15,
        'January credits and bet debits remain in the available wallet');
      assert.deepEqual(store.getLeaderboard(5, rates), [],
        'the new month starts with an empty ranking');
      assert.deepEqual(store.getLeaderboard(5, rates, '2025-01'),
        [{ username: 'mem-carry', points: 15 }],
        'historical monthly ranking remains available');

      store.appendLog({ username: 'mem-carry', amount: 2, ip: 'feb', mac: 'feb' }, rates);
      assert.equal(store.getMemberPoints('mem-carry', rates), 17);
      assert.deepEqual(store.getLeaderboard(5, rates),
        [{ username: 'mem-carry', points: 2 }],
        'February ranking includes only February ledger activity');
    }

    const spinOptions = {
      username: 'mem-carry',
      requestId: '00000000-0000-4000-8000-000000000099',
      station: 'PC 1',
      expectedStake: 5,
      expectedBalance: 17,
      allowCustomStake: true,
      maxSpinsPerDay: 2,
      outcomes: [{ multiplier: 0, weight: 100 }],
      pointRates: rates
    };
    const sqliteSpin = sqlite.appendWheelSpin(spinOptions);
    const jsonSpin = jsonCoins.appendWheelSpin(spinOptions);
    assert.equal(sqliteSpin.balance, 12, 'SQLite permits spending carried-over wallet points');
    assert.equal(jsonSpin.balance, sqliteSpin.balance, 'JSON and SQLite settle identically');
    assert.equal(sqlite.getMemberPoints('mem-carry', rates), 12);
    assert.equal(jsonCoins.getMemberPoints('mem-carry', rates), 12);
    assert.deepEqual(sqlite.getLeaderboard(5, rates), [],
      'current-month ranking remains independent of carried-over wallet balance');
    assert.deepEqual(jsonCoins.getLeaderboard(5, rates), []);
    assert.equal(sqlite.getLogs().logs.length, 4, 'historical credit and bet debit logs remain intact');
    assert.equal(jsonCoins.getLogs().logs.length, 4);
  } finally {
    Date.now = originalNow;
    pointsDb.close();
    jsonCoins.setDataDir(path.join(__dirname, '..', 'data'));
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(jsonDir, { recursive: true, force: true });
  }
});