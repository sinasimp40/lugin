const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const attendance = require('../src/attendance-store');
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

test('historical mission policy never borrows a newly enabled mission', () => {
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
    assert.equal(settings.getAttendancePolicy(tomorrow).points, 7);
    settings.setDataDir(dir);
    assert.equal(settings.getAttendancePolicy(tomorrow).mode, 'login');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});