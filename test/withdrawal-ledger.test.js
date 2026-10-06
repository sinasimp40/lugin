const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const jsonStore = require('../src/coin-log-store');
const { createStore } = require('../src/coin-log-sqlite-store');

const rates = [{ pesos: 1, points: 1 }];
const request = (username, requestId, amount, more = {}) => ({
  username, requestId, amount, station: 'PC 1', min: 1, max: 1000, pointRates: rates, ...more
});

function withNow(timestamp, callback) {
  const realNow = Date.now;
  Date.now = () => timestamp;
  try { return callback(); }
  finally { Date.now = realNow; }
}

function makeStore(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denfi-withdraw-ledger-'));
  if (name === 'JSON') {
    jsonStore.setDataDir(dir);
    return { store: jsonStore, dir };
  }
  const databasePath = path.join(dir, 'ledger.sqlite');
  const db = new DatabaseSync(databasePath);
  return { store: createStore(db), db, databasePath, dir };
}

for (const name of ['JSON', 'SQLite']) {
  test(`${name} pauses an uncertain Telegram notice without claiming delivery or blocking newer withdrawals`, t => {
    const f = makeStore(name);
    t.after(() => { f.db?.close(); fs.rmSync(f.dir, { recursive: true, force: true }); });
    const store = f.store;
    store.recordRejectedWithdrawal({ username: 'mem-alice', requestId: 'uncertain',
      amount: 1, station: 'PC 1', reason: 'Insufficient balance' });
    const first = store.claimWithdrawalNotification();
    assert.equal(first.withdrawal.requestId, 'uncertain');
    assert.equal(store.acknowledgeWithdrawalNotification('uncertain', first.leaseToken, true), true);
    assert.equal(store.claimWithdrawalNotification(), null, 'paused notice is not reclaimed');
    store.recordRejectedWithdrawal({ username: 'mem-alice', requestId: 'new-notice',
      amount: 1, station: 'PC 2', reason: 'Another attempt' });
    assert.equal(store.claimWithdrawalNotification().withdrawal.requestId, 'new-notice');
    assert.equal(store.getWithdrawal('uncertain').status, 'failed', 'notification handling cannot alter cash outcome');
    assert.equal(store.getMemberPoints('mem-alice', rates), 0, 'notification handling cannot change points');
  });

  test(`${name} retains the confirmed payout time independently of failures and notification delivery`, t => {
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
    const f = makeStore(name);
    t.after(() => { f.db?.close(); fs.rmSync(f.dir, { recursive: true, force: true }); });
    const store = f.store;
    assert.equal(store.getLastConfirmedWithdrawalAt(), 0);
    store.appendLog({ username: 'mem-alice', amount: 10, ip: 'fake', mac: 'fake' }, rates);
    store.reserveWithdrawal(request('mem-alice', 'confirmed', 1));
    store.markWithdrawalSending('confirmed');
    store.finishWithdrawal('confirmed', { status: 'success', reason: 'Confirmed cash' });
    const confirmedAt = Date.now();
    assert.equal(store.getLastConfirmedWithdrawalAt(), confirmedAt);
    t.mock.timers.tick(5000);
    store.recordRejectedWithdrawal({ username: 'mem-alice', requestId: 'rejected',
      amount: 1, station: 'PC 2', reason: 'Cooldown, no debit' });
    const notification = store.claimWithdrawalNotification();
    if (notification) store.acknowledgeWithdrawalNotification(notification.withdrawal.requestId, notification.leaseToken);
    assert.equal(store.getLastConfirmedWithdrawalAt(), confirmedAt, 'notifications/failures must not restart the countdown');
    if (f.db) {
      const reopened = new DatabaseSync(f.databasePath);
      try { assert.equal(createStore(reopened).getLastConfirmedWithdrawalAt(), confirmedAt); }
      finally { reopened.close(); }
    } else {
      store.setDataDir(f.dir);
      assert.equal(store.getLastConfirmedWithdrawalAt(), confirmedAt);
    }
  });

  test(`${name} enforces one unresolved cash withdrawal globally with idempotent retries`, t => {
    const { store, dir, db } = makeStore(name);
    t.after(() => {
      if (db) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    for (const username of ['mem-global-a', 'mem-global-b', 'mem-global-c']) {
      store.appendLog({ username, amount: 20, ip: username, mac: username }, rates);
    }

    const first = store.reserveWithdrawal(request('mem-global-a', 'global-a', 5));
    assert.equal(store.reserveWithdrawal(request('mem-global-a', 'global-a', 5)).id, first.id);
    assert.equal(store.getMemberPoints('mem-global-a', rates), 15, 'same-ID retry never debits twice');
    assert.equal(store.getLogs().logs.filter(log => log.source === 'withdrawal').length, 1);
    assert.throws(() => store.reserveWithdrawal(request('mem-global-b', 'global-b-early', 5)), /unresolved/);
    assert.equal(store.getMemberPoints('mem-global-b', rates), 20, 'blocked reservation leaves another wallet untouched');

    assert.equal(store.markWithdrawalSending('global-a'), true);
    assert.throws(() => store.reserveWithdrawal(request('mem-global-b', 'global-b-sending', 5)), /unresolved/);
    assert.equal(store.finishWithdrawal('global-a', { status: 'unconfirmed', reason: 'outcome unknown' }).status,
      'unconfirmed');
    assert.throws(() => store.reserveWithdrawal(request('mem-global-b', 'global-b-uncertain', 5)), /unresolved/);
    assert.equal(store.resolveWithdrawal('global-a', { released: true }).status, 'success');
    const second = store.reserveWithdrawal(request('mem-global-b', 'global-b-released', 5));
    assert.equal(second.status, 'reserved', 'a confirmed release of the global hold permits the next member');
    assert.equal(store.getMemberPoints('mem-global-a', rates), 15);
    assert.equal(store.getMemberPoints('mem-global-b', rates), 15);

    assert.equal(store.markWithdrawalSending('global-b-released'), true);
    store.finishWithdrawal('global-b-released', { status: 'unconfirmed', reason: 'operator review' });
    assert.throws(() => store.reserveWithdrawal(request('mem-global-c', 'global-c-uncertain', 5)), /unresolved/);
    assert.equal(store.getMemberPoints('mem-global-c', rates), 20);
    assert.equal(store.resolveWithdrawal('global-b-released', { released: false }).status, 'failed');
    assert.equal(store.getMemberPoints('mem-global-b', rates), 20, 'released withdrawal refunds its debit');
    assert.equal(store.reserveWithdrawal(request('mem-global-c', 'global-c-released', 5)).status, 'reserved',
      'a failed/released reconciliation unlocks the shared machine');
    assert.equal(store.getMemberPoints('mem-global-c', rates), 15);
  });

  test(`${name} unresolved lookup is independent of withdrawal history limits`, t => {
    const { store, dir, db } = makeStore(name);
    t.after(() => {
      if (db) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    store.appendLog({ username: 'mem-hold', amount: 10, ip: 'hold', mac: 'hold' }, rates);
    assert.equal(store.reserveWithdrawal(request('mem-hold', 'old-hold', 2)).amount, 2);
    assert.equal(store.finishWithdrawal('old-hold', { status: 'success' }), false,
      'a reserved withdrawal cannot finish as success');
    assert.equal(store.resolveWithdrawal('old-hold', { released: true }), false,
      'a reserved withdrawal cannot be reconciled');
    assert.equal(store.markWithdrawalSending('old-hold'), true);
    assert.equal(store.markWithdrawalSending('old-hold'), false,
      'a sending withdrawal cannot transition to sending again');

    const realNow = Date.now;
    let now = realNow();
    try {
      Date.now = () => ++now;
      for (let i = 0; i < 60; i++) {
        store.recordRejectedWithdrawal({
          username: 'mem-spam', requestId: `rejected-${i}`, amount: null, reason: 'invalid'
        });
      }
    } finally {
      Date.now = realNow;
    }
    assert.equal(store.listWithdrawals(50).some(row => row.requestId === 'old-hold'), false,
      'the unresolved record is older than the bounded public history');
    assert.equal(store.getUnresolvedWithdrawal('mem-hold').requestId, 'old-hold');
    assert.equal(store.getUnresolvedWithdrawal('mem-other'), null);
    assert.equal(store.getUnresolvedWithdrawal(null).requestId, 'old-hold');
    assert.equal(Number.isSafeInteger(store.getUnresolvedWithdrawal('mem-hold').amount), true);
  });

  test(`${name} withdrawal validates, reserves atomically, and retains fractional wallet points`, t => {
    const { store, dir, db } = makeStore(name);
    t.after(() => {
      if (db) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    store.appendLog({ username: 'mem-alice', amount: 10.5, ip: 'earned', mac: 'earned' }, rates);
    assert.throws(() => store.reserveWithdrawal(request('mem-alice', 'fraction', 1.5)), /whole number/);
    assert.throws(() => store.reserveWithdrawal(request('alice', 'bad-user', 1)), /username/);
    assert.throws(() => store.reserveWithdrawal(request('mem-alice', 'bounds', 7, { min: 8, max: 9 })), /limits/);
    assert.throws(() => store.reserveWithdrawal(request('mem-alice', 'too-much', 11)), /Insufficient/);

    const baseline = store.getLeaderboard(5, rates);
    const first = store.reserveWithdrawal(request('mem-alice', 'cash-1', 6));
    assert.equal(first.status, 'reserved');
    assert.equal(first.amount, 6);
    assert.equal(first.balance, 4.5);
    assert.equal(first.timestamp, first.createdAt);
    assert.equal(store.getMemberPoints('mem-alice', rates), 4.5);
    assert.deepEqual(store.getLeaderboard(5, rates), baseline, 'cash debits do not alter earned monthly ranking');
    assert.equal(store.reserveWithdrawal(request('mem-alice', 'cash-1', 6, { min: 1, max: 10 })).id, first.id,
      'an existing request is idempotent even when supplied limits now differ');
    assert.throws(() => store.reserveWithdrawal(request('mem-bob', 'cash-1', 6)), /different member/);
    assert.throws(() => store.reserveWithdrawal(request('mem-alice', 'cash-1', 5)), /another amount/);
    assert.throws(() => store.reserveWithdrawal(request('mem-alice', 'cash-2', 1)), /unresolved/);
    assert.throws(() => store.appendWheelSpin({
      username: 'mem-alice', requestId: 'wheel-overdraw', station: 'PC',
      expectedStake: 5, expectedBalance: 4.5, allowCustomStake: true,
      outcomes: [{ multiplier: 0, weight: 100 }], pointRates: rates
    }), /Balance changed|Stake must/);
    assert.equal(store.getLogs().logs.find(log => log.source === 'withdrawal').amount, 0);
    assert.equal(store.getLogs().logs.some(log => log.notificationLeaseToken), false);
    assert.equal(store.getWithdrawal('cash-1').notificationLeaseToken, undefined);
  });

  test(`${name} withdrawal failure refunds once and notification leases are versioned`, t => {
    const { store, dir, db } = makeStore(name);
    t.after(() => {
      if (db) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    store.appendLog({ username: 'mem-refund', amount: 20, ip: 'r', mac: 'r' }, rates);
    store.reserveWithdrawal(request('mem-refund', 'refund-1', 5));
    assert.equal(store.markWithdrawalSending('refund-1'), true);
    assert.equal(store.markWithdrawalSending('refund-1'), false);
    assert.equal(store.finishWithdrawal('refund-1', { status: 'failed', reason: 'declined' }).status, 'failed');
    assert.equal(store.finishWithdrawal('refund-1', { status: 'failed' }), false);
    assert.equal(store.getMemberPoints('mem-refund', rates), 20);
    assert.equal(store.getLogs().logs.filter(log => log.source === 'withdrawal-refund').length, 1);
    assert.deepEqual(store.getLeaderboard(5, rates), [{ username: 'mem-refund', points: 20 }]);

    const claim = store.claimWithdrawalNotification();
    assert.equal(claim.withdrawal.requestId, 'refund-1');
    assert.equal(claim.withdrawal.notificationLeaseToken, undefined);
    assert.equal(store.claimWithdrawalNotification(), null, 'live notification lease prevents duplicate claim');
    assert.equal(store.acknowledgeWithdrawalNotification('refund-1', 'wrong'), false);
    const realNow = Date.now;
    let retry;
    try {
      Date.now = () => realNow() + 31000;
      retry = store.claimWithdrawalNotification();
    } finally {
      Date.now = realNow;
    }
    assert.equal(retry.withdrawal.requestId, 'refund-1', 'expired notification leases can be retried');
    assert.equal(store.acknowledgeWithdrawalNotification('refund-1', claim.leaseToken), false);
    assert.equal(store.acknowledgeWithdrawalNotification('refund-1', retry.leaseToken), true);
    assert.equal(store.claimWithdrawalNotification(), null, 'acknowledged version is not re-enqueued');

    store.reserveWithdrawal(request('mem-refund', 'uncertain-1', 3));
    store.markWithdrawalSending('uncertain-1');
    store.finishWithdrawal('uncertain-1', { status: 'unconfirmed', reason: 'timeout' });
    const oldClaim = store.claimWithdrawalNotification();
    assert.equal(oldClaim.withdrawal.requestId, 'uncertain-1');
    assert.equal(store.resolveWithdrawal('uncertain-1', { released: true, reason: 'confirmed paid' }).status, 'success');
    assert.equal(store.resolveWithdrawal('uncertain-1', { released: false }), false);
    assert.equal(store.acknowledgeWithdrawalNotification('uncertain-1', oldClaim.leaseToken), false,
      'old-version acknowledgement cannot drop the reconciliation notification');
    const updatedClaim = store.claimWithdrawalNotification();
    assert.equal(updatedClaim.withdrawal.status, 'success');
    assert.equal(store.acknowledgeWithdrawalNotification('uncertain-1', updatedClaim.leaseToken), true);
    assert.equal(store.getMemberPoints('mem-refund', rates), 17);
  });

  test(`${name} startup recovery never resends, and holds block administrative deletion`, t => {
    let { store, dir, db, databasePath } = makeStore(name);
    t.after(() => {
      if (db) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    store.appendLog({ username: 'mem-restart', amount: 12.25, ip: 's', mac: 's' }, rates);
    store.reserveWithdrawal(request('mem-restart', 'reserved-restart', 2));
    assert.throws(() => store.deleteMemberLogs('mem-restart'), /unresolved/);
    const debitLog = store.getLogs().logs.find(log =>
      log.source === 'withdrawal' && log.requestId === 'reserved-restart');
    assert.ok(debitLog);
    assert.throws(() => store.deleteLog(debitLog.id), /unresolved/);
    assert.throws(() => store.clearAllLogs(), /unresolved/);
    if (name === 'JSON') {
      jsonStore.setDataDir(dir);
    } else {
      db.close();
      db = new DatabaseSync(databasePath);
      store = createStore(db);
    }
    assert.equal(store.recoverWithdrawals(), 1);
    assert.equal(store.getWithdrawal('reserved-restart').status, 'failed');
    assert.equal(store.getMemberPoints('mem-restart', rates), 12.25);

    store.appendLog({ username: 'mem-dispatch', amount: 8, ip: 'd', mac: 'd' }, rates);
    store.reserveWithdrawal(request('mem-dispatch', 'sending-restart', 2));
    store.markWithdrawalSending('sending-restart');
    assert.throws(() => store.deleteMemberLogs('mem-dispatch'), /unresolved/);
    assert.throws(() => store.clearAllLogs(), /unresolved/);
    if (name === 'JSON') {
      jsonStore.setDataDir(dir);
    } else {
      db.close();
      db = new DatabaseSync(databasePath);
      store = createStore(db);
    }
    assert.equal(store.recoverWithdrawals(), 1);
    assert.equal(store.getWithdrawal('sending-restart').status, 'unconfirmed');
    assert.equal(store.markWithdrawalSending('sending-restart'), false, 'uncertain dispatch is never resent');
    assert.equal(store.resolveWithdrawal('sending-restart', { released: false }).status, 'failed');
    assert.equal(store.getMemberPoints('mem-dispatch', rates), 8);

    store.reserveWithdrawal(request('mem-restart', 'never-sent', 1));
    assert.equal(store.finishWithdrawal('never-sent', { status: 'failed', reason: 'not sent' }).status, 'failed');
    assert.equal(store.getMemberPoints('mem-restart', rates), 12.25);
    assert.equal(store.listWithdrawals(1).length, 1);
    assert.equal(store.recordRejectedWithdrawal({
      username: 'mem-restart', requestId: 'bad-amount', amount: 1.5, reason: 'invalid'
    }).amount, null);
    assert.equal(store.getMemberPoints('mem-restart', rates), 12.25, 'rejections do not debit or refund');
  });

  test(`${name} daily withdrawal limits count confirmed updatedAt usage durably and exclude failures`, t => {
    const f = makeStore(name);
    let { store, dir, db, databasePath } = f;
    t.after(() => {
      if (db) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const username = 'mem-daily';
    const dayStart = Date.UTC(2025, 0, 2, 16); // Midnight in Asia/Manila.
    const confirmAt = dayStart + 10 * 60 * 1000;
    const oldCreatedAt = dayStart - 86400000;
    store.appendLog({
      username, amount: 30, timestamp: oldCreatedAt, ip: 'daily', mac: 'daily'
    }, rates);

    store.reserveWithdrawal(request(username, 'daily-paid', 5, {
      timestamp: oldCreatedAt, dailyLimit: 1
    }));
    withNow(confirmAt - 2, () => {
      store.markWithdrawalSending('daily-paid');
      store.finishWithdrawal('daily-paid', { status: 'unconfirmed', reason: 'provider timeout' });
    });
    withNow(confirmAt, () => {
      assert.equal(store.resolveWithdrawal('daily-paid', {
        released: true, reason: 'operator confirmed PAID'
      }).status, 'success');
    });
    assert.ok(store.getWithdrawal('daily-paid').createdAt < dayStart,
      'a request created on an earlier day is counted by its confirmation time');

    store.reserveWithdrawal(request(username, 'daily-failed', 4, {
      timestamp: confirmAt, dailyLimit: 0
    }));
    withNow(confirmAt + 1, () => {
      assert.equal(store.finishWithdrawal('daily-failed', { status: 'failed', reason: 'declined' }).status, 'failed');
    });
    const usage = store.getDailyWithdrawalUsage(username, confirmAt);
    assert.equal(usage.used, 1, 'only successful withdrawals count; refunded failures do not');
    assert.equal(usage.timeZone, 'Asia/Manila');
    assert.equal(usage.resetAt, dayStart + 86400000);

    const balanceBeforeRetry = store.getMemberPoints(username, rates);
    assert.equal(store.reserveWithdrawal(request(username, 'daily-paid', 5, {
      dailyLimit: 1, timestamp: confirmAt
    })).status, 'success', 'idempotent retries bypass a subsequently lowered daily limit');
    assert.throws(() => store.reserveWithdrawal(request(username, 'daily-over-limit', 1, {
      dailyLimit: 1, timestamp: confirmAt
    })), /Daily withdrawal limit reached.*midnight \(UTC\+8\).*No points were deducted/i);
    assert.equal(store.getMemberPoints(username, rates), balanceBeforeRetry,
      'a limit rejection does not debit points');
    assert.throws(() => store.reserveWithdrawal(request(username, 'daily-invalid-limit', 1, {
      dailyLimit: 1001, timestamp: confirmAt
    })), /Daily withdrawal limit/);

    if (name === 'JSON') {
      store.setDataDir(dir);
    } else {
      db.close();
      db = new DatabaseSync(databasePath);
      store = createStore(db);
    }
    assert.equal(store.getDailyWithdrawalUsage(username, confirmAt).used, 1,
      'daily usage survives reopening the durable store');
  });

  test(`${name} daily usage uses the Manila [start,end) day boundary`, t => {
    const { store, dir, db } = makeStore(name);
    t.after(() => {
      if (db) db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    const username = 'mem-boundary';
    const midnight = Date.UTC(2025, 0, 2, 16);
    const createdAt = midnight - 1000;
    store.appendLog({ username, amount: 20, timestamp: createdAt, ip: 'boundary', mac: 'boundary' }, rates);

    store.reserveWithdrawal(request(username, 'boundary-before', 2, { timestamp: createdAt }));
    withNow(midnight - 1, () => {
      store.markWithdrawalSending('boundary-before');
      store.finishWithdrawal('boundary-before', { status: 'success' });
    });
    store.reserveWithdrawal(request(username, 'boundary-at', 3, { timestamp: midnight }));
    withNow(midnight, () => {
      store.markWithdrawalSending('boundary-at');
      store.finishWithdrawal('boundary-at', { status: 'success' });
    });

    assert.equal(store.getDailyWithdrawalUsage(username, midnight - 1).used, 1,
      'the instant before Manila midnight belongs to the preceding day');
    assert.equal(store.getDailyWithdrawalUsage(username, midnight).used, 1,
      'the exact midnight boundary belongs to the new day');
  });
}