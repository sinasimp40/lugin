const { createPisonetWithdrawalClient } = require('./pisonet-withdrawal-client');
const { MAX_WITHDRAWAL } = require('./withdrawal-config');

const requestIdPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const memberPattern = /^mem-[a-z0-9._-]{1,80}$/i;
const COOLDOWN_MS = 10000;

function withdrawalMessage(record) {
  const date = new Date(record.createdAt || record.timestamp);
  const zone = { timeZone: 'Asia/Manila' };
  return [
    'WITHDRAWAL ' + record.status.toUpperCase(),
    'Username: ' + record.username,
    'PC: ' + (record.station || 'PC'),
    'Amount: ' + (Number.isSafeInteger(record.amount) ? `₱${record.amount}` : 'Invalid amount'),
    'Conversion: 1 point = ₱1',
    'Date: ' + date.toLocaleDateString('en-CA', zone),
    'Time: ' + date.toLocaleTimeString('en-GB', { ...zone, hour12: false }) + ' (UTC+08:00)',
    'Status: ' + record.status.toUpperCase(),
    'Details: ' + (record.reason || (record.status === 'success' ? 'Pisonet confirmed the release.' : '')),
    'Balance: ' + Number(record.balance || 0).toFixed(2) + ' points',
    'Request ID: ' + record.requestId,
    ...(record.status === 'unconfirmed'
      ? ['ACTION REQUIRED: Verify the coin machine in the admin Withdrawal history. Do not retry the release.']
      : []),
  ].join('\n');
}

function createWithdrawalService({ settings, coinLogs, sendTelegramMessage,
  client = createPisonetWithdrawalClient(), now = Date.now }) {
  let machineBusy = false;
  let notifying = false;

  function currentBalance(username) {
    return coinLogs.getMemberPoints(username, settings.getSettings().pointRates || []);
  }

  function dailyState(username) {
    const limit = settings.getWithdrawalSettings().dailyLimit ?? 0;
    const usage = coinLogs.getDailyWithdrawalUsage(username, now());
    return { ...usage, limit, remaining: limit ? Math.max(0, limit - usage.used) : null,
      allowed: limit === 0 || usage.used < limit };
  }

  function view(record) {
    return { ...record, balance: currentBalance(record.username) };
  }

  function machineState() {
    const pending = coinLogs.getUnresolvedWithdrawal();
    if (pending?.status === 'unconfirmed') {
      return { busy: true, state: 'unconfirmed',
        message: 'Coin machine paused. An admin must check an uncertain payout before anyone can withdraw. Nothing is queued.' };
    }
    if (machineBusy || pending) {
      return { busy: true, state: 'processing',
        message: 'Coin machine busy — please wait. Another withdrawal is processing. Nothing is queued; no points will be deducted while you wait.' };
    }
    // Derive from the durable ledger, not an in-memory timer: restarting Points
    // or changing member/PC must not bypass the shared post-payout cooldown.
    const cooldownRemainingMs = Math.max(0, coinLogs.getLastConfirmedWithdrawalAt() + COOLDOWN_MS - now());
    if (cooldownRemainingMs > 0) {
      return { busy: true, state: 'cooldown', cooldownRemainingMs,
        message: `Coin machine cooling down — wait ${Math.ceil(cooldownRemainingMs / 1000)} seconds. Nothing is queued; no points will be deducted while you wait.` };
    }
    return { busy: false, state: 'idle', message: '' };
  }

  async function flushNotifications() {
    if (notifying || !settings.getTelegramAdminSettings().configured) return;
    notifying = true;
    try {
      for (let i = 0; i < 20; i++) {
        const claim = coinLogs.claimWithdrawalNotification();
        if (!claim) break;
        const withdrawal = claim.withdrawal;
        const receipt = await sendTelegramMessage(withdrawalMessage(withdrawal), undefined,
          { key: `withdrawal:${withdrawal.requestId}:${withdrawal.status}`, kind: 'withdrawal',
            id: `${withdrawal.requestId}:${withdrawal.status}` });
        if (!receipt?.sent && !receipt?.uncertain) break;
        coinLogs.acknowledgeWithdrawalNotification(withdrawal.requestId, claim.leaseToken, !!receipt.uncertain);
      }
    } catch (_) {
      // The lease expires and is retried. Notification failures never replay
      // coin release or change the ledger.
      console.log('[Withdrawal] Telegram delivery pending; will retry.');
    } finally { notifying = false; }
  }

  function reject(input, reason) {
    const record = coinLogs.recordRejectedWithdrawal({
      ...input, amount: Number.isSafeInteger(input.amount) ? input.amount : null, reason,
    });
    void flushNotifications();
    return view(record);
  }

  async function withdraw(input) {
    if (!memberPattern.test(input.username || '') || !requestIdPattern.test(input.requestId || '')) {
      const error = new Error('Invalid member or withdrawal request ID.');
      error.status = 400;
      throw error;
    }
    const previous = coinLogs.getWithdrawal(input.requestId);
    if (previous) {
      if (previous.username !== input.username || previous.amount !== input.amount) {
        const error = new Error('This withdrawal request belongs to another member or amount.');
        error.status = 409;
        throw error;
      }
      return view(previous);
    }
    const config = settings.getWithdrawalSettings();
    if (!Number.isSafeInteger(input.amount) || input.amount < 1 || input.amount > MAX_WITHDRAWAL) {
      return reject(input, 'Withdrawals must be whole numbers from 1 to 1000. No coins were requested.');
    }
    if (!config.enabled) return reject(input, 'Withdrawals are disabled. No points were deducted.');
    if (input.amount < config.min || input.amount > config.max) {
      return reject(input, `Withdrawal must be between ₱${config.min} and ₱${config.max}. No points were deducted.`);
    }
    if (!settings.getTelegramAdminSettings().configured) {
      return reject(input, 'Withdrawal notifications are not configured. Ask the operator to check Telegram settings.');
    }
    const machine = machineState();
    if (machine.busy) {
      return reject(input, machine.message + ' This request was not sent and no points were deducted.');
    }
    // Acquire before the first await; only one release can use this physical
    // coin machine at a time, even when requests come from different PCs.
    machineBusy = true;
    let reserved = false;
    try {
      try {
        coinLogs.reserveWithdrawal({ ...input, min: config.min, max: config.max,
          dailyLimit: config.dailyLimit ?? 0, timestamp: now(),
          pointRates: settings.getSettings().pointRates || [] });
        reserved = true;
      } catch (error) {
        return reject(input, /balance|points|amount|pending|limit|integer/i.test(error.message)
          ? error.message : 'The withdrawal could not be reserved. No coins were requested.');
      }
      const token = await client.login(config);
      // Recheck immediately before dispatch: login may have crossed midnight,
      // or an operator may have lowered limits or changed credentials.
      const current = settings.getWithdrawalSettings();
      const daily = dailyState(input.username);
      const releaseAllowed = current.enabled && input.amount >= current.min && input.amount <= current.max &&
        current.loginUrl === config.loginUrl && current.username === config.username &&
        current.password === config.password && daily.allowed;
      if (!releaseAllowed) {
        coinLogs.finishWithdrawal(input.requestId, { status: 'failed',
          reason: !daily.allowed
            ? 'Daily withdrawal limit reached before release. Resets at midnight (UTC+8). Points have been restored.'
            : 'Withdrawal settings changed or withdrawals were disabled before release. Points have been restored.' });
      } else {
        if (!coinLogs.markWithdrawalSending(input.requestId)) {
          throw new Error('Could not reserve the release state.');
        }
        await client.release(config, input.amount, token, () => {
          const current = settings.getWithdrawalSettings();
          return current.enabled && input.amount >= current.min && input.amount <= current.max &&
            current.loginUrl === config.loginUrl && current.username === config.username &&
            current.password === config.password && dailyState(input.username).allowed;
        });
        const finished = coinLogs.finishWithdrawal(input.requestId, { status: 'success',
          reason: 'Pisonet confirmed the coin release.' });
        if (!finished) throw new Error('Could not persist the confirmed release state.');
      }
    } catch (error) {
      if (!reserved) throw error;
      const state = coinLogs.getWithdrawal(input.requestId)?.status;
      // An unexpected error after dispatch is also ambiguous. Never refund a
      // potentially paid request just because recording its result failed.
      const ambiguous = state === 'sending' && (error.ambiguous !== false);
      coinLogs.finishWithdrawal(input.requestId, {
        status: ambiguous ? 'unconfirmed' : 'failed',
        reason: error.ambiguous !== undefined ? error.message :
          ambiguous ? 'Release state is unconfirmed. An admin must check the coin machine.'
            : 'The release was not sent. Points have been restored.',
      });
    } finally {
      machineBusy = false;
      void flushNotifications();
    }
    return view(coinLogs.getWithdrawal(input.requestId));
  }

  async function testLogin() {
    if (machineState().busy) {
      return { authenticated: false, coinsRequested: false,
        message: 'Wait until the cash machine is idle before testing login. No coins were requested.' };
    }
    // A login can invalidate a previous controller session. Serialize the
    // probe with real withdrawals without reserving or debiting any points.
    machineBusy = true;
    let diagnostics;
    try {
      const config = settings.getWithdrawalSettings();
      if (!config.loginUrl || !config.username || !config.password) {
        return { authenticated: false, coinsRequested: false,
          message: 'Save the Pisonet API login URL, username and password first. No coins were requested.' };
      }
      await client.login(config, { force: true, onResponse: value => { diagnostics = value; } });
      const current = settings.getWithdrawalSettings();
      if (current.loginUrl !== config.loginUrl || current.username !== config.username || current.password !== config.password) {
        return { authenticated: false, coinsRequested: false,
          message: 'Saved Pisonet credentials changed during the check. Test the new settings again. No coins were requested.' };
      }
      return { authenticated: true, coinsRequested: false, diagnostics,
        message: 'Pisonet returned an authentication token. No coins were requested and no points were deducted.' };
    } catch (error) {
      return { authenticated: false, coinsRequested: false, diagnostics,
        message: typeof error.ambiguous === 'boolean' ? error.message :
          'Could not complete the Pisonet login check. No coins were requested.' };
    } finally { machineBusy = false; }
  }

  function recover() {
    coinLogs.recoverWithdrawals();
    void flushNotifications();
  }

  function resolve(requestId, { released, reason }) {
    const record = coinLogs.resolveWithdrawal(requestId, { released, reason });
    if (!record) return false;
    void flushNotifications();
    return view(record);
  }

  return { withdraw, recover, resolve, view, flushNotifications, machineState, testLogin, dailyState };
}

module.exports = { createWithdrawalService, withdrawalMessage, memberPattern, requestIdPattern, COOLDOWN_MS };