const test = require('node:test');
const assert = require('node:assert/strict');
const { withdrawalDayBounds, getDailyUsage } = require('../src/withdrawal-day');
const { parseWithdrawal, defaultWithdrawal } = require('../src/withdrawal-config');

test('withdrawal day resets exactly at UTC+8 midnight regardless of host timezone', () => {
  const midnight = Date.parse('2026-10-02T16:00:00Z');
  const before = withdrawalDayBounds(midnight - 1);
  const after = withdrawalDayBounds(midnight);
  assert.equal(before.dayKey, '2026-10-02');
  assert.equal(before.end, midnight);
  assert.equal(after.dayKey, '2026-10-03');
  assert.equal(after.start, midnight);
  assert.equal(after.resetAt, midnight + 86400000);
  assert.equal(after.timeZone, 'Asia/Manila');
  const records = [
    { username: 'mem-a', status: 'success', createdAt: midnight - 1000, updatedAt: midnight },
    { username: 'mem-a', status: 'success', updatedAt: midnight - 1 },
    { username: 'mem-a', status: 'unconfirmed', updatedAt: midnight },
    { username: 'mem-a', status: 'failed', updatedAt: midnight },
    { username: 'mem-b', status: 'success', updatedAt: midnight },
  ];
  assert.equal(getDailyUsage(records, 'mem-a', midnight - 1).used, 1);
  assert.equal(getDailyUsage(records, 'mem-a', midnight).used, 1);
  assert.throws(() => withdrawalDayBounds(NaN), /clock/);
});

test('daily count validation accepts zero/unlimited and whole counts only', () => {
  const policy = defaultWithdrawal();
  assert.equal(parseWithdrawal(policy).dailyLimit, 0);
  for (const dailyLimit of [0, 1, 3, 1000]) {
    assert.equal(parseWithdrawal({ ...policy, dailyLimit }).dailyLimit, dailyLimit);
  }
  for (const dailyLimit of [null, -1, 1.5, '1', 1001, Infinity, NaN]) {
    assert.throws(() => parseWithdrawal({ ...policy, dailyLimit }), /per member per day/);
  }
  delete policy.dailyLimit;
  assert.equal(parseWithdrawal(policy).dailyLimit, 0, 'old stored policy loads with no new restriction');
});