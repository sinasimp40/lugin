const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const pointsDb = require('../src/points-database');
const { createStore: createCoins } = require('../src/coin-log-sqlite-store');
const { createStore: createAttendance } = require('../src/attendance-sqlite-store');

afterEach(() => pointsDb.close());

function tempData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-points-migration-'));
}

function write(dir, name, value) {
  fs.writeFileSync(path.join(dir, name), typeof value === 'string' ? value : JSON.stringify(value));
}

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

test('a malformed JSON source stops migration, preserves it, and does not activate a database', () => {
  const dir = tempData();
  write(dir, 'coin-logs.json', '{broken');
  assert.throws(() => pointsDb.initialize(dir), /not valid JSON/);
  assert.equal(fs.readFileSync(path.join(dir, 'coin-logs.json'), 'utf8'), '{broken');
  assert.equal(fs.existsSync(path.join(dir, 'denfi-points.db')), false);
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
  assert.equal(coins.getMemberPoints('mem-alice'), 2, 'monthly balance is based on logs');
  assert.equal(coins.getLogs().memberPoints['mem-alice'], 3, 'original admin total is retained');
});