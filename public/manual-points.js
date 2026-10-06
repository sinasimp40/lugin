(function () {
  'use strict';
  const savedKey = 'denfi-manual-points-pending';
  const form = document.getElementById('manual-points-form');
  const panel = document.getElementById('manual-points-panel');
  const username = document.getElementById('manual-points-username');
  const action = document.getElementById('manual-points-action');
  const amount = document.getElementById('manual-points-amount');
  const reason = document.getElementById('manual-points-reason');
  const submit = document.getElementById('manual-points-submit');
  const state = document.getElementById('manual-points-member-state');
  const message = document.getElementById('manual-points-message');
  let pending = null;
  let busy = false;
  let memberGeneration = 0;

  function fmt(value) { return Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function note(text, type) {
    message.textContent = text;
    message.className = 'manual-points-message ' + (type || '');
  }
  function lock(value) {
    busy = value;
    [username, action, amount, reason].forEach(el => { el.disabled = busy || !!pending; });
    submit.disabled = busy;
    submit.textContent = busy ? 'Checking…' : pending ? 'Check / retry same adjustment' : 'Review adjustment';
  }
  function forgetPending() {
    sessionStorage.removeItem(savedKey);
    pending = null;
  }
  function restore() {
    try {
      const record = JSON.parse(sessionStorage.getItem(savedKey));
      if (!record) return;
      if (!/^mem-[a-z0-9._-]{1,80}$/i.test(record.username || '') ||
          !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(record.requestId || '') ||
          typeof record.delta !== 'number' || !Number.isFinite(record.delta) || !record.delta ||
          typeof record.reason !== 'string') {
        note('The saved adjustment request is invalid. Check the coin history before entering another adjustment.', 'error');
        submit.disabled = true;
        return;
      }
      pending = record;
      username.value = record.username;
      action.value = record.delta < 0 ? 'deduct' : 'add';
      amount.value = Math.abs(record.delta);
      reason.value = record.reason;
      panel.open = true;
      note('A previous response was not confirmed. Sign in and check the same adjustment; do not enter a new one.', 'error');
      lock(false);
    } catch (_) {
      note('Saved adjustment recovery is unavailable. Check the coin history before making another adjustment.', 'error');
      submit.disabled = true;
    }
  }
  async function request(path, body) {
    const token = coinLogsToken;
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'x-admin-token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok || data.success !== true) {
      const error = new Error(data.error || 'Denfi Points did not confirm this request.');
      // Only explicit validation/conflict/read-only rejections confirm no
      // adjustment happened. Network/server/auth errors retain the same UUID.
      error.definite = [400, 403, 409].includes(response.status) && data.success === false;
      throw error;
    }
    return data;
  }
  async function refreshMember() {
    if (!coinLogsToken || coinLogsReadOnly) return;
    const name = username.value.trim();
    const generation = ++memberGeneration;
    if (!/^mem-[a-z0-9._-]{1,80}$/i.test(name)) {
      state.textContent = 'Select a member or enter their full username.';
      return;
    }
    try {
      const data = await request('/api/admin/point-adjustments/member/' + encodeURIComponent(name));
      if (generation !== memberGeneration || name !== username.value.trim()) return;
      const member = data.member;
      state.textContent = 'Balance: ' + fmt(member.balance) + ' pts · Monthly score (' + member.period + '): ' +
        fmt(member.monthlyPoints) + ' pts' +
        (!member.hasHistory ? ' · No points history found. Verify the exact username before its first credit.' : '') +
        (member.blocked ? ' · Withdrawal unresolved: resolve it before adjusting points.' : '');
    } catch (error) {
      if (generation === memberGeneration) state.textContent = error.message;
    }
  }
  async function refresh() {
    if (!coinLogsToken || coinLogsReadOnly) return;
    try {
      const data = await request('/api/admin/point-adjustments/members');
      const list = document.getElementById('manual-points-members');
      list.replaceChildren();
      data.members.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        list.appendChild(option);
      });
      await refreshMember();
    } catch (error) { note(error.message, 'error'); }
  }
  function select(name) {
    panel.open = true;
    if (!pending && !busy) {
      username.value = name;
      refreshMember();
      amount.focus();
    }
    panel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  async function sendPending() {
    try {
      const data = await request('/api/admin/point-adjustments', pending);
      const log = data.log;
      if (!log || log.requestId !== pending.requestId || log.username !== pending.username ||
          log.points !== pending.delta || log.reason !== pending.reason) {
        throw new Error('The returned adjustment did not match. Check the same request; do not enter a new adjustment.');
      }
      const change = pending.delta;
      forgetPending();
      note((data.replayed ? 'Previously saved adjustment confirmed. ' : 'Adjustment saved. ') +
        log.username + ': ' + (change > 0 ? '+' : '') + fmt(change) + ' pts. Balance: ' +
        fmt(data.member.balance) + ' pts; monthly score: ' + fmt(data.member.monthlyPoints) + ' pts.', 'success');
      amount.value = '';
      reason.value = '';
      // A date/username filter can conceal the new row. Show the member's
      // complete history so the successful adjustment is always visible.
      document.getElementById('coin-log-filter-user').value = log.username;
      document.getElementById('coin-log-filter-from').value = '';
      document.getElementById('coin-log-filter-to').value = '';
      await loadCoinLogs();
      await refresh();
    } catch (error) {
      if (error.definite) {
        forgetPending();
        note(error.message + ' No new adjustment was applied.', 'error');
      } else {
        note((error.message || 'The response could not be confirmed.') +
          ' Check / retry this same adjustment. Do not submit a new one.', 'error');
      }
    }
  }
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (busy || coinLogsReadOnly || !coinLogsToken) return;
    lock(true);
    try {
      if (pending) { await sendPending(); return; }
      const name = username.value.trim();
      const points = Number(amount.value);
      const detail = reason.value.trim();
      if (!/^mem-[a-z0-9._-]{1,80}$/i.test(name) || !Number.isFinite(points) ||
          points <= 0 || points > 1000000 ||
          Math.abs(points * 100 - Math.round(points * 100)) > 1e-8 ||
          detail.length < 3 || detail.length > 300 || /[\x00-\x1f\x7f]/.test(detail)) {
        note('Enter a full member username, positive points (up to 2 decimals), and a one-line reason of 3–300 characters.', 'error');
        return;
      }
      const delta = action.value === 'deduct' ? -points : points;
      const data = await request('/api/admin/point-adjustments/member/' + encodeURIComponent(name));
      const member = data.member;
      if (member.blocked) {
        note('This member has an unresolved withdrawal. Resolve it before adjusting points.', 'error');
        return;
      }
      if (Math.round((member.balance + delta) * 100) < 0) {
        note('Insufficient balance. This member has ' + fmt(member.balance) + ' pts.', 'error');
        return;
      }
      const approved = await customConfirm(delta < 0 ? 'Deduct member points?' : 'Add member points?',
        'Member: ' + name + '\nChange: ' + (delta > 0 ? '+' : '') + fmt(delta) + ' pts\n' +
        'Balance: ' + fmt(member.balance) + ' → ' + fmt(Math.round((member.balance + delta) * 100) / 100) + ' pts\n' +
        'Monthly score (' + member.period + '): ' + fmt(member.monthlyPoints) + ' → ' +
        fmt(Math.round((member.monthlyPoints + delta) * 100) / 100) + ' pts\nReason: ' + detail +
        (!member.hasHistory ? '\n\nNo points history exists for this username. Confirm its spelling before adding points.' : ''),
        delta < 0, delta < 0 ? 'Deduct points' : 'Add points');
      if (!approved) return;
      const record = { username: name, delta, reason: detail, requestId: crypto.randomUUID() };
      // Persist before dispatch. If storage fails, do not change the balance.
      sessionStorage.setItem(savedKey, JSON.stringify(record));
      pending = record;
      await sendPending();
    } catch (error) {
      note(error.message || 'Unable to prepare this adjustment. No new request was sent.', 'error');
    } finally { lock(false); }
  });
  let debounce;
  username.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(refreshMember, 250);
  });
  panel.addEventListener('toggle', () => { if (panel.open) refresh(); });
  window.manualPoints = { refresh, refreshMember, select };
  restore();
})();