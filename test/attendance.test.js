const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const attendance = require('../src/attendance-store');
const connectionHint = require('../src/connection-hint');
const coins = require('../src/coin-log-store');
const settings = require('../src/settings-store');

test('daily progress accumulates confirmed time across sessions but not gaps or the next day', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-attendance-'));
  attendance.setDataDir(dir);
  try {
    const start = new Date(2026, 8, 24, 10, 0).getTime();
    attendance.record('mem-alice', true, start);
    attendance.record('mem-alice', true, start + 2000);
    attendance.record('', true, start + 3000);
    attendance.record('mem-alice', true, start + 3600000);
    attendance.record('mem-alice', true, start + 3603000);
    assert.equal(attendance.status('mem-alice', attendance.dayKey(start)).seconds, 5);
    const pending = attendance.pendingSamples();
    assert.equal(pending.length, 1);
    attendance.markSynced(pending[0]);
    assert.equal(attendance.pendingSamples().length, 0);
    attendance.record('mem-alice', true, start + 86400000);
    assert.equal(attendance.status('mem-alice', attendance.dayKey(start + 86400000)).seconds, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('daily reward is unique and survives point-rate recalculation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-award-'));
  coins.setDataDir(dir);
  try {
    const day = attendance.dayKey();
    assert.equal(coins.appendAttendanceAward('mem-alice', day, 5), true);
    assert.equal(coins.appendAttendanceAward('mem-alice', day, 5), false);
    coins.recalcAllPoints([{ pesos: 1, points: 10 }]);
    const logs = coins.getLogs({}, [{ pesos: 1, points: 10 }]).logs;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].source, 'attendance');
    assert.equal(logs[0].points, 5);
    assert.equal(coins.getMemberPoints('mem-alice', [{ pesos: 1, points: 10 }]), 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('multiple devices combine without counting retries twice, and completion persists', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-merge-'));
  attendance.setDataDir(dir);
  try {
    const day = attendance.dayKey();
    const first = { deviceId: '00000000-0000-4000-8000-000000000001', day, username: 'mem-alice', seconds: 90 };
    const second = { ...first, deviceId: '00000000-0000-4000-8000-000000000002', seconds: 45 };
    attendance.merge(first);
    attendance.merge(first);
    attendance.merge({ ...first, seconds: 30 });
    attendance.merge(second);
    assert.equal(attendance.status(first.username).seconds, 135);
    attendance.markAwarded(first.username, day);
    attendance.setDataDir(dir);
    assert.equal(attendance.status(first.username).awarded, true);
    attendance.markAwarded(first.username, day, 4);
    assert.equal(attendance.status(first.username).awardedPoints, 4);
    assert.throws(() => attendance.merge({ ...first, day: '2000-01-01' }), /Invalid attendance/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sync acknowledgement saves both the progress receipt and award together', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-ack-'));
  attendance.setDataDir(dir);
  try {
    const sample = { deviceId: '00000000-0000-4000-8000-000000000003',
      day: attendance.dayKey(), username: 'mem-alice', seconds: 60 };
    attendance.merge(sample);
    attendance.acknowledge(sample, { awarded: true, points: 2.5 });
    attendance.setDataDir(dir);
    assert.equal(attendance.pendingSamples().length, 0);
    assert.equal(attendance.status('mem-alice').awardedPoints, 2.5);
    assert.equal(attendance.status('mem-alice').awarded, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy login mission converts to play time without assigning old days a new goal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-policy-'));
  settings.setAppRole('points');
  settings.setDataDir(dir);
  try {
    const now = new Date();
    const yesterday = attendance.dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime());
    const tomorrow = attendance.dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime());
    settings.updateSettings({ attendanceEnabled: true, attendanceMode: 'login',
      attendanceMinutes: 30, attendancePoints: 7 });
    assert.equal(settings.getAttendancePolicy(yesterday).enabled, false);
    assert.equal(settings.ensurePlaytimeMission(), true);
    assert.equal(settings.ensurePlaytimeMission(), false);
    assert.equal(settings.getAttendancePolicy(tomorrow).points, 7);
    settings.setDataDir(dir);
    assert.equal(settings.getAttendancePolicy(tomorrow).mode, 'minutes');
    assert.equal(settings.getAttendancePolicy(yesterday).enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('one daily play-time target is shared, stable across restarts, and stays within the saved range', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-random-mission-'));
  settings.setAppRole('points');
  settings.setDataDir(dir);
  try {
    const now = new Date();
    const today = attendance.dayKey(now.getTime());
    const tomorrow = attendance.dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime());
    const yesterday = attendance.dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime());
    const saved = settings.updateSettings({
      attendanceEnabled: true, attendanceMode: 'minutes',
      attendanceMinMinutes: 30, attendanceMaxMinutes: 60, attendancePoints: 2
    });
    assert.ok(saved.attendanceMinutes >= 30 && saved.attendanceMinutes <= 60);
    assert.match(saved.attendanceTargetSeed, /^[0-9a-f]{32}$/);
    const firstTarget = settings.getAttendancePolicy(today).minutes;
    const nextTarget = settings.getAttendancePolicy(tomorrow).minutes;
    assert.ok(nextTarget >= 30 && nextTarget <= 60);
    assert.equal(settings.getAttendancePolicy(yesterday).enabled, false);
    settings.setDataDir(dir);
    assert.equal(settings.getSettings().attendanceMinutes, firstTarget);
    assert.equal(settings.getAttendancePolicy(tomorrow).minutes, nextTarget);
    settings.updateSettings({ attendancePoints: 3 });
    assert.equal(settings.getAttendancePolicy(today).minutes, firstTarget,
      'saving points alone must not reroll the mission time');
    assert.equal(settings.getAttendancePolicy(tomorrow).minutes, nextTarget);
    settings.updateSettings({ attendanceMinMinutes: 45, attendanceMaxMinutes: 45 });
    assert.equal(settings.getAttendancePolicy(today).minutes, 45);
    assert.equal(settings.getAttendancePolicy(tomorrow).minutes, 45);
    assert.equal(settings.getAttendancePolicy(yesterday).enabled, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('connected kiosk derives the shared daily target from the saved seed during an outage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-remote-target-'));
  settings.setAppRole('auto-shutdown', true);
  settings.setDataDir(dir);
  try {
    const seed = 'a'.repeat(32);
    const standalone = settings.updateSettings({
      attendanceEnabled: true, attendanceMode: 'minutes',
      attendanceMinMinutes: 30, attendanceMaxMinutes: 60,
      attendanceTargetSeed: seed, attendancePoints: 2
    });
    const staleCachedTarget = standalone.attendanceMinutes === 30 ? 31 : 30;
    settings.updateSettings({
      attendanceMinMinutes: 30, attendanceMaxMinutes: 60,
      attendanceMinutes: staleCachedTarget, attendanceTargetSeed: seed,
      syncServerUrl: 'http://127.0.0.1:5000'
    });
    assert.equal(settings.getSettings().attendanceMinutes, standalone.attendanceMinutes);
    settings.setDataDir(dir);
    assert.equal(settings.getSettings().attendanceMinutes, standalone.attendanceMinutes,
      'yesterday’s cached target cannot override today’s shared selection');
    const tomorrow = attendance.dayKey(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() + 1).getTime());
    assert.ok(settings.getAttendancePolicy(tomorrow).minutes >= 30);
    assert.ok(settings.getAttendancePolicy(tomorrow).minutes <= 60);
    settings.updateSettings({ syncServerUrl: '' });
    assert.equal(settings.getSettings().attendanceMinutes, standalone.attendanceMinutes,
      'standalone kiosk uses its stable local daily selection');
  } finally {
    settings.setAppRole('points', true);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Denfi Points address survives local reinstall separately from kiosk data and clears on disconnect', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-connection-hint-'));
  try {
    assert.equal(connectionHint.readHint(dir), '');
    connectionHint.writeHint('http://10.10.10.29:5000', dir);
    assert.equal(connectionHint.readHint(dir), 'http://10.10.10.29:5000');
    connectionHint.writeHint('http://MY-POINTS-PC:5000', dir);
    assert.equal(connectionHint.readHint(dir), 'http://MY-POINTS-PC:5000');
    assert.throws(() => connectionHint.writeHint('http://user:password@10.10.10.29:5000', dir));
    connectionHint.writeHint('', dir);
    assert.equal(connectionHint.readHint(dir), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('attendance admin offers only play-time settings', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.ok(html.includes('id="admin-attendance-min"'));
  assert.ok(html.includes('id="admin-attendance-max"'));
  assert.ok(!html.includes('id="admin-attendance-mode"'));
  assert.ok(!html.includes('updateAttendanceInputs()'));
});