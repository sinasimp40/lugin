(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const demo = params.get('preview') === '1' && params.get('withdraw') === '1';
  const demoResult = ['success', 'failed', 'unconfirmed'].includes(params.get('result')) ? params.get('result') : 'success';
  const demoDelay = Math.max(250, Math.min(10000, Number(params.get('delay')) || 1100));
  const $ = (id) => document.getElementById(id);
  let policy = null, policyOwner = '', transportBusy = false, refreshBusy = false, nextPollAt = 0, lastStatus = '', retryConfirmedId = null;
  let currentUsername = '';
  const clock = () => typeof performance !== 'undefined' ? performance.now() : Date.now();
  let cooldownDeadline = 0, cooldownRefreshAt = 0;
  let demoCooldownDeadline = demo && params.get('cooldown') === '1' ? clock() + 10000 : 0;
  function demoCountParam(name) {
    const raw = params.get(name) || '';
    const value = Number(raw);
    return /^\d+$/.test(raw) && Number.isSafeInteger(value) ? Math.min(1000, value) : 0;
  }
  const demoDailyLimit = demoCountParam('dailyLimit');
  let demoDailyUsed = demoCountParam('used');

  function demoDailyState() {
    const now = new Date();
    const manilaNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const dayKey = manilaNow.toISOString().slice(0, 10);
    const nextMidnight = Date.UTC(manilaNow.getUTCFullYear(), manilaNow.getUTCMonth(), manilaNow.getUTCDate() + 1) - 8 * 60 * 60 * 1000;
    return {
      dayKey,
      used: demoDailyUsed,
      limit: demoDailyLimit,
      remaining: demoDailyLimit === 0 ? null : Math.max(0, demoDailyLimit - demoDailyUsed),
      resetAt: new Date(nextMidnight).toISOString(),
      timeZone: 'Asia/Manila',
      allowed: demoDailyLimit === 0 || demoDailyUsed < demoDailyLimit
    };
  }

  function acceptMachine(machine) {
    if (policy) policy.machine = machine;
    cooldownDeadline = machine?.state === 'cooldown'
      ? clock() + Math.max(0, Number(machine.cooldownRemainingMs) || 0) : 0;
  }

  function stateFor(username) {
    try { return JSON.parse(localStorage.getItem('denfi.withdrawal.pending:' + username) || 'null'); } catch (_) { return null; }
  }
  function saveFor(username, state) {
    try {
      const key = 'denfi.withdrawal.pending:' + username;
      if (state) localStorage.setItem(key, JSON.stringify(state));
      else localStorage.removeItem(key);
      const stored = localStorage.getItem(key);
      return state ? stored === JSON.stringify(state) : stored === null;
    } catch (_) { return false; }
  }
  function owns(owner) {
    return Boolean(owner && window.DenfiWithdrawalBridge &&
      window.DenfiWithdrawalBridge.context().username === owner);
  }
  function show(message, state, owner) {
    if (owner && !owns(owner)) return false;
    const el = $('withdrawal-status');
    if (!el) return false;
    el.textContent = message;
    el.dataset.state = state || '';
    lastStatus = message;
    if (window.DenfiWithdrawalBridge) window.DenfiWithdrawalBridge.resize();
    return true;
  }
  function cash(value) {
    const n = Number(value);
    return Number.isFinite(n) ? '\u20b1' + n.toLocaleString('en-PH', { maximumFractionDigits: 2 }) : '\u20b1—';
  }
  function dailyExhausted() {
    const daily = policy?.daily;
    return Boolean(daily && (daily.allowed === false ||
      (Number(daily.limit) > 0 && Number.isFinite(Number(daily.remaining)) && Number(daily.remaining) <= 0)));
  }
  function resetText(daily) {
    if (!daily?.resetAt) return '';
    const reset = new Date(daily.resetAt);
    if (Number.isNaN(reset.getTime())) return '';
    return ' Resets ' + new Intl.DateTimeFormat('en-PH', {
      timeZone: daily.timeZone || 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short'
    }).format(reset) + ' (' + (daily.timeZone || 'Asia/Manila') + ').';
  }
  function updateDailyUI(owner) {
    if (owner && !owns(owner)) return;
    const el = $('withdrawal-daily');
    const daily = policy?.daily;
    if (!daily || !Number.isFinite(Number(daily.used)) || !Number.isFinite(Number(daily.limit))) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    const used = Math.max(0, Number(daily.used));
    const limit = Math.max(0, Number(daily.limit));
    const remaining = Math.max(0, Number(daily.remaining) || 0);
    el.textContent = limit === 0
      ? 'Daily allowance: ' + used + ' successful withdrawal' + (used === 1 ? '' : 's') + ' today. No daily limit.'
      : 'Daily allowance: ' + used + ' of ' + limit + ' successful withdrawals used; ' +
        remaining + ' remaining today.' + resetText(daily);
  }
  function setButtonVisible() {
    const bridge = window.DenfiWithdrawalBridge;
    if (!bridge) return;
    const c = bridge.context();
    const hasSavedRequest = Boolean(c.username && stateFor(c.username));
    const visible = Boolean(c.member && (policy?.enabled || hasSavedRequest) && $('points-zone').classList.contains('active'));
    $('withdraw-btn').classList.toggle('member-visible', visible);
  }
  function machineReady() {
    return policy?.machine?.busy === false && policy.machine.state === 'idle';
  }
  function updateMachineUI(owner) {
    if (!owns(owner)) return;
    const machine = policy?.machine;
    const state = machineReady() ? 'idle'
      : machine?.state === 'unconfirmed' ? 'unconfirmed'
        : machine?.state === 'cooldown' ? 'cooldown'
        : machine?.busy === true ? 'processing' : 'checking';
    const seconds = Math.max(0, Math.ceil((cooldownDeadline - clock()) / 1000));
    const saved = stateFor(owner);
    const unresolved = ['reserved', 'sending', 'unconfirmed'].includes($('withdrawal-form').dataset.recordStatus);
    const blocked = transportBusy || unresolved || Boolean(saved && retryConfirmedId !== saved.requestId) ||
      policyOwner !== owner || !policy?.enabled || !machineReady() || (dailyExhausted() && !saved);
    $('withdrawal-submit').disabled = blocked;
    $('withdrawal-amount').disabled = blocked || (dailyExhausted() && !saved);
    updateDailyUI(owner);
    $('withdrawal-submit').title = dailyExhausted() ? 'Daily withdrawal limit reached.' + resetText(policy?.daily) : '';
    const notice = $('withdrawal-machine');
    notice.hidden = state === 'idle';
    notice.dataset.state = state;
    notice.textContent = state === 'checking'
      ? 'Shared machine availability is not confirmed. Requests are disabled until Denfi Points confirms it. Update Denfi Points if this message persists.'
      : state === 'cooldown'
        ? (seconds ? 'Shared cooldown — wait ' + seconds + ' seconds before another withdrawal. Nothing is queued; no points are deducted while you wait.'
          : 'Cooldown finished — checking shared machine availability…')
      : state === 'processing' && saved
        ? 'Your saved request is being checked. Please wait—do not submit another withdrawal.'
        : machine?.message || 'Coin machine busy — please wait. Nothing is queued.';
    $('withdraw-btn').dataset.machineState = state;
    $('withdraw-btn').title = dailyExhausted()
      ? 'Daily withdrawal limit reached.' + resetText(policy?.daily)
      : state === 'idle' ? 'Withdraw cash · 1 point = ₱1' : notice.textContent;
    if (!saved && !unresolved && !transportBusy) {
      $('withdrawal-submit').textContent = dailyExhausted() ? 'DAILY LIMIT'
        : state === 'unconfirmed' ? 'ADMIN CHECK'
        : state === 'cooldown' ? (seconds ? 'WAIT ' + seconds + 's' : 'CHECKING…')
        : state !== 'idle' ? 'PLEASE WAIT' : 'REQUEST';
    }
  }
  async function request(path, options) {
    const response = await fetch(path, Object.assign({ credentials: 'include' }, options || {}));
    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok || body.success !== true) {
      const error = new Error(body.error || ('Request failed (' + response.status + ')'));
      error.status = response.status;
      error.notFound = body.notFound === true;
      throw error;
    }
    return body;
  }
  function setActiveRecord(record, balance, owner) {
    if (!owns(owner) || (record?.username && record.username !== owner)) return false;
    const saved = stateFor(owner);
    if (saved && record?.requestId && saved.requestId !== record.requestId) return false;
    if (balance !== undefined && window.DenfiWithdrawalBridge) window.DenfiWithdrawalBridge.setPoints(balance);
    if (balance !== undefined && policyOwner === owner && policy) policy.balance = balance;
    if (!record) return;
    const receivedStatus = String(record.status || '').toLowerCase();
    const status = ['reserved', 'sending', 'success', 'failed', 'unconfirmed'].includes(receivedStatus)
      ? receivedStatus : 'unconfirmed';
    const amount = cash(record.amount);
    const info = record.reason ? ' Detail: ' + String(record.reason) : '';
    if (status === 'reserved' || status === 'sending') {
      show('Request ' + status + ' — ' + amount + ' is reserved. Checking for a confirmed result…', '', owner);
      $('withdrawal-submit').disabled = true;
      $('withdrawal-check-wrap').style.display = '';
      nextPollAt = Date.now() + 4000;
    } else if (status === 'unconfirmed') {
      show('UNCONFIRMED — ' + amount + ' remains reserved. An operator must check the coin machine. Do not submit another request.' + info, 'error', owner);
      $('withdrawal-submit').disabled = true;
      $('withdrawal-check-wrap').style.display = '';
      nextPollAt = Date.now() + 4000;
    } else if (status === 'success') {
      show('Paid: ' + amount + '. Request ' + String(record.requestId || '') + ' completed.', 'success', owner);
      $('withdrawal-submit').disabled = false;
      $('withdrawal-check-wrap').style.display = 'none';
      saveFor(owner, null);
    } else if (status === 'failed') {
      show('Withdrawal failed. ' + (record.reason ? String(record.reason) : 'No further detail was provided.'), 'error', owner);
      $('withdrawal-submit').disabled = false;
      $('withdrawal-check-wrap').style.display = 'none';
      saveFor(owner, null);
    }
    $('withdrawal-form').dataset.recordStatus = status;
    updateMachineUI(owner);
    return true;
  }
  async function loadPolicy(owner) {
    if (demo) {
      if (owns(owner)) {
        const balance = Number(window.DenfiWithdrawalBridge.context().balance);
        const busy = params.get('busy') === '1', paused = params.get('busy') === 'unconfirmed';
        policy = { enabled: true, min: 1, max: 1000, balance: Number.isFinite(balance) ? balance : 86.5,
          daily: demoDailyState(),
          machine: { busy: busy || paused, state: paused ? 'unconfirmed' : busy ? 'processing' : 'idle',
            message: paused ? 'DEMO — Coin machine paused. An admin must check an uncertain payout. Nothing is queued.'
              : busy ? 'DEMO — Coin machine busy — please wait. Nothing is queued; no points are deducted.' : '' } };
        policyOwner = owner;
        const remaining = Math.max(0, demoCooldownDeadline - clock());
        if (remaining) acceptMachine({ busy: true, state: 'cooldown', cooldownRemainingMs: remaining });
        else acceptMachine(policy.machine);
        updateMachineUI(owner);
      }
      return;
    }
    const body = await request('/api/session/withdrawal');
    if (!owns(owner)) {
      policy = { enabled: body.enabled === true, min: body.min, max: body.max };
      policyOwner = '';
      return;
    }
    if (body.withdrawal?.username && body.withdrawal.username !== owner) return;
    policy = body;
    acceptMachine(body.machine);
    policyOwner = owner;
    if (body.withdrawal) setActiveRecord(body.withdrawal, body.balance, owner);
    updateMachineUI(owner);
  }
  function validateAmount(raw) {
    if (dailyExhausted()) return 'Daily withdrawal limit reached.' + resetText(policy?.daily);
    if (!/^\d+$/.test(raw)) return 'Enter a whole-peso amount using digits only. Decimals and exponents are not accepted.';
    const amount = Number(raw);
    if (!Number.isSafeInteger(amount)) return 'Amount is outside the supported range.';
    const context = window.DenfiWithdrawalBridge.context();
    if (!Number.isFinite(Number(context.balance))) return 'Balance is unavailable. Check Denfi Points before requesting a withdrawal.';
    const min = Number(policy?.min), max = Number(policy?.max);
    const exactBalance = Number(policy?.balance ?? context.balance);
    if (!Number.isFinite(exactBalance)) return 'Balance is unavailable. Check Denfi Points before requesting a withdrawal.';
    const available = Math.floor(exactBalance);
    if (amount < min || amount > max) return 'Enter an amount from ' + min + ' to ' + max + ' pesos.';
    if (amount > available) return 'Insufficient whole-peso balance. Available: ' + available + ' pesos.';
    if (!context.canStart) return 'Wait for the current points game to finish before requesting a withdrawal.';
    return '';
  }
  async function submit() {
    const bridge = window.DenfiWithdrawalBridge, c = bridge.context();
    const owner = c.username;
    if (transportBusy || !c.member || !owner || policyOwner !== owner || !policy?.enabled ||
        ['reserved', 'sending', 'unconfirmed'].includes($('withdrawal-form').dataset.recordStatus)) return;
    if (!machineReady()) { updateMachineUI(owner); return; }
    const saved = stateFor(owner);
    let pending;
    if (saved) {
      pending = saved;
      if (pending.username !== owner || retryConfirmedId !== pending.requestId) return;
    } else {
      const raw = $('withdrawal-amount').value;
      const error = validateAmount(raw);
      if (error) { show(error, 'error', owner); return; }
      pending = { requestId: crypto.randomUUID(), amount: Number(raw), username: owner };
    }
    if (!bridge.context().canStart) {
      show('Wait for the current points game or pending result to finish before requesting a withdrawal.', 'error', owner);
      return;
    }
    if (!saveFor(owner, pending)) {
      show('This device could not safely save the request ID. Nothing was submitted; check browser storage and try again.', 'error', owner);
      return;
    }
    if (!owns(owner)) return;
    transportBusy = true;
    retryConfirmedId = null;
    $('withdrawal-submit').disabled = true;
    updateMachineUI(owner);
    show(demo ? 'DEMO — simulating a withdrawal; no cash API is called…' : 'Recording withdrawal request…', '', owner);
    try {
      let body;
      if (demo) {
        await new Promise((resolve) => setTimeout(resolve, demoDelay));
        if (!owns(owner)) return;
        const demoRecord = { requestId: pending.requestId, amount: pending.amount, status: demoResult, reason: demoResult === 'failed' ? 'DEMO — simulated payout failed.' : demoResult === 'unconfirmed' ? 'DEMO — verify the coin machine payment record with an operator.' : '', createdAt: new Date().toISOString() };
        if (demoResult === 'success') {
          demoDailyUsed = Math.min(1000, demoDailyUsed + 1);
          if (policy) policy.daily = demoDailyState();
          demoCooldownDeadline = clock() + 10000;
          acceptMachine({ busy: true, state: 'cooldown', cooldownRemainingMs: 10000 });
        }
        setActiveRecord(demoRecord, demoResult === 'success' ? Number(c.balance) - pending.amount : c.balance, owner);
        show('DEMO — ' + lastStatus + ' No real withdrawal request or cash payout was made.', demoResult === 'success' ? 'success' : 'error', owner);
      } else {
        body = await request('/api/session/withdrawal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: pending.requestId, amount: pending.amount }) });
        if (!owns(owner)) return;
        if (body.withdrawal?.username && body.withdrawal.username !== owner) {
          policy = null;
          policyOwner = '';
          show('The session identity changed before the request result arrived. The saved request was retained; check status after confirming this member session.', 'error', owner);
          return;
        }
        if (policy && policyOwner === owner && body.machine) acceptMachine(body.machine);
        if (policy && policyOwner === owner && body.daily) policy.daily = body.daily;
        setActiveRecord(body.withdrawal, body.balance, owner);
      }
      if (owns(owner)) $('withdrawal-amount').value = '';
    } catch (error) {
      if (owns(owner)) {
        show('Could not confirm request delivery. The same request ID and amount are saved; check status before retrying. ' + error.message, 'error', owner);
        $('withdrawal-check-wrap').style.display = '';
        $('withdrawal-check').textContent = 'CHECK STATUS';
        $('withdrawal-submit').textContent = 'AWAITING STATUS';
        $('withdrawal-submit').disabled = true;
      }
    } finally {
      transportBusy = false;
      if (owns(owner)) { updateMachineUI(owner); bridge.resize(); }
    }
  }
  async function checkStatus(expectedOwner) {
    const bridge = window.DenfiWithdrawalBridge;
    const c = bridge.context();
    const owner = expectedOwner || c.username;
    if (!owns(owner)) return;
    const pending = stateFor(owner);
    if (!pending || pending.username !== owner || transportBusy) return;
    transportBusy = true;
    $('withdrawal-check').disabled = true;
    try {
      if (demo) {
        show('DEMO — there is no real request to check.', 'error', owner);
        return;
      }
      const body = await request('/api/session/withdrawal/' + encodeURIComponent(pending.requestId));
      if (!owns(owner)) return;
      if (body.withdrawal?.username && body.withdrawal.username !== owner) {
        show('This request status belongs to a different session identity. The saved request is retained and was not applied here.', 'error', owner);
        return;
      }
      if (policyOwner === owner && policy && body.machine) acceptMachine(body.machine);
      if (policyOwner === owner && policy && body.daily) policy.daily = body.daily;
      setActiveRecord(body.withdrawal, body.balance, owner);
    } catch (error) {
      if (!owns(owner)) return;
      if (error.status === 404 && error.notFound === true) {
        show('No record was found for this saved request ID. You may retry only this same amount and ID.', 'error', owner);
        retryConfirmedId = pending.requestId;
        $('withdrawal-form').dataset.recordStatus = '';
        $('withdrawal-submit').textContent = 'RETRY SAME REQUEST';
        $('withdrawal-submit').disabled = false;
        $('withdrawal-check-wrap').style.display = 'none';
      } else {
        show('Status could not be checked. Saved request retained; do not create another request. ' + error.message, 'error', owner);
        $('withdrawal-check-wrap').style.display = '';
      }
    } finally {
      transportBusy = false;
      if (owns(owner)) {
        $('withdrawal-check').disabled = false;
        updateMachineUI(owner);
        bridge.resize();
      }
    }
  }
  async function refresh() {
    const bridge = window.DenfiWithdrawalBridge;
    if (!bridge || !document.getElementById('withdrawal-view')) return;
    const context = bridge.context(), owner = context.username;
    if (currentUsername !== owner) {
      currentUsername = owner || '';
      policy = null;
      policyOwner = '';
      retryConfirmedId = null;
      nextPollAt = 0;
      lastStatus = '';
      $('withdrawal-check-wrap').style.display = 'none';
      $('withdrawal-submit').disabled = false;
      $('withdrawal-submit').textContent = 'REQUEST';
      $('withdrawal-form').dataset.recordStatus = '';
      const savedForOwner = owner && stateFor(owner);
      if (savedForOwner) {
        $('withdrawal-check-wrap').style.display = '';
        $('withdrawal-submit').disabled = true;
        $('withdrawal-submit').textContent = 'AWAITING STATUS';
        show('Saved request found. Checking its status before allowing another request…', '', owner);
      } else if (owner) show('Checking withdrawal availability…', '', owner);
    }
    setButtonVisible();
    if (!context.member || !owner) return;
    if (refreshBusy) return;
    refreshBusy = true;
    try {
      if (demo) {
        await loadPolicy(owner);
        if (!owns(owner)) return;
        const saved = stateFor(owner);
        if (saved && transportBusy) return;
        if (saved) setActiveRecord({ requestId: saved.requestId, amount: saved.amount, status: demoResult, reason: 'DEMO — no real payout was attempted.' }, context.balance, owner);
        else if (!lastStatus || lastStatus.startsWith('Checking withdrawal')) show('DEMO — simulated flow only. Choose an integer-peso amount; no server or cash payout will be called.', '', owner);
        setButtonVisible();
        updateMachineUI(owner);
        return;
      }
      const body = await request('/api/session/withdrawal');
      if (!owns(owner)) return;
      if (body.withdrawal?.username && body.withdrawal.username !== owner) {
        policy = null;
        policyOwner = '';
        show('A withdrawal status for another session was returned. It was not applied to this member.', 'error', owner);
        return;
      }
      policy = body;
      acceptMachine(body.machine);
      policyOwner = owner;
      updateMachineUI(owner);
      setButtonVisible();
      updateMachineUI(owner);
      const saved = stateFor(owner);
      // A reloaded overlay can still show its previous balance even though
      // Points returned a newer one. Apply idle status to the visible balance
      // only when no saved cash request or hidden wheel result is pending.
      if (!saved && !body.withdrawal && context.canStart &&
          typeof body.balance === 'number' && Number.isFinite(body.balance)) {
        bridge.setPoints(body.balance);
      }
      if (saved) {
        if (Date.now() >= nextPollAt) await checkStatus(owner);
        else if (body.withdrawal && body.withdrawal.requestId === saved.requestId && !lastStatus) setActiveRecord(body.withdrawal, body.balance, owner);
      } else if (body.withdrawal) {
        const persisted = Boolean(body.withdrawal.requestId) &&
          saveFor(owner, { requestId: body.withdrawal.requestId, amount: body.withdrawal.amount, username: owner });
        setActiveRecord(body.withdrawal, body.balance, owner);
        if (!persisted) show('An existing withdrawal is active, but this device could not persist its request ID. Do not start another request; check browser storage.', 'error', owner);
      } else if (!lastStatus || lastStatus.startsWith('Checking withdrawal')) {
        show(body.enabled ? 'Available: ' + Number(body.min) + '–' + Number(body.max) + ' pesos. Current balance: ' + cash(body.balance) + '.' : 'Withdrawals are currently unavailable.', '', owner);
      }
      setButtonVisible();
      if (!body.enabled && !saved) $('withdraw-btn').classList.remove('member-visible');
    } catch (error) {
      if (owns(owner)) {
        policy = null;
        updateMachineUI(owner);
        setButtonVisible();
        const saved = stateFor(owner);
        if (!saved) show('Denfi Points is unavailable. New withdrawal requests are disabled; try again shortly.', 'error', owner);
      }
    } finally {
      refreshBusy = false;
      if (bridge.context().username !== owner) queueMicrotask(refresh);
    }
  }
  function install() {
    $('withdraw-btn').addEventListener('click', () => window.DenfiWithdrawalBridge?.open());
    $('withdrawal-form').addEventListener('submit', (event) => { event.preventDefault(); submit(); });
    $('withdrawal-check').addEventListener('click', () => checkStatus());
    $('withdrawal-amount').addEventListener('input', () => {
      $('withdrawal-submit').textContent = 'REQUEST';
      if ($('withdrawal-status').dataset.state === 'error' && lastStatus.includes('whole-peso')) show('1 point = \u20b11. Enter a whole-peso amount only.');
    });
    refresh();
    setInterval(() => {
      const owner = window.DenfiWithdrawalBridge?.context().username;
      if (owner && policyOwner === owner && policy?.machine?.state === 'cooldown') {
        updateMachineUI(owner);
        // Never unlock from a local clock alone; obtain an authoritative idle
        // response once the visual timer ends. Poll failure keeps it blocked.
        if (clock() >= cooldownDeadline && clock() >= cooldownRefreshAt && !refreshBusy) {
          cooldownRefreshAt = clock() + 1000;
          refresh();
        }
      }
    }, 250);
    if (demo && params.get('drawer') === '1') window.DenfiWithdrawalBridge?.open();
    setInterval(() => {
      const bridge = window.DenfiWithdrawalBridge;
      if (!bridge) return;
      const c = bridge.context();
      const pending = c.username && stateFor(c.username);
      if (c.member || pending || document.getElementById('withdrawal-view').style.display !== 'none') refresh();
    }, 4000);
  }
  window.DenfiWithdrawalSession = { refresh, submit, checkStatus };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install);
  else install();
})();