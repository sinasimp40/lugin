(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const form = $('admin-withdrawal-form');
  if (!form) return;
  let readyToSave = false, pointsConnected = false, compatibleVersion = false, dailyLimitSupported = false, writeAuthorized = false;
  let loginTestSupported = false, testingLogin = false;
  let savedLoginUrl = '', savedUsername = '';
  const testButton = $('admin-withdrawal-test-login');
  const token = () => window.getDenfiAdminToken && window.getDenfiAdminToken();
  function status(id, text, kind) {
    const el = $(id);
    el.textContent = text || '';
    el.dataset.state = kind || '';
  }
  async function api(path, options) {
    const adminToken = token();
    if (!adminToken) throw Object.assign(new Error('Auto Shutdown admin session expired. Sign in again.'), { status: 401 });
    const config = Object.assign({
      credentials: 'include',
      headers: { 'x-admin-token': adminToken }
    }, options || {});
    config.headers = Object.assign({ 'x-admin-token': adminToken }, (options && options.headers) || {});
    const response = await fetch(path, config);
    let body = {};
    try { body = await response.json(); } catch (_) {}
    if (!response.ok || body.success !== true) {
      const error = new Error(body.error || 'Request failed (' + response.status + ')');
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  }
  function setSaveReady(value) {
    readyToSave = Boolean(value && pointsConnected && compatibleVersion && dailyLimitSupported && writeAuthorized);
    $('admin-withdrawal-save').disabled = !readyToSave || testingLogin;
    if (testButton) testButton.disabled = !readyToSave || !loginTestSupported || testingLogin;
  }
  function setPolicyFieldsEnabled(enabled) {
    ['admin-withdrawal-enabled', 'admin-withdrawal-min', 'admin-withdrawal-max',
      'admin-withdrawal-daily-limit', 'admin-withdrawal-url', 'admin-withdrawal-username', 'admin-withdrawal-password']
      .forEach((id) => { $(id).disabled = !enabled; });
  }
  function clearPrivateFields() {
    $('admin-withdrawal-url').value = '';
    $('admin-withdrawal-username').value = '';
    $('admin-withdrawal-password').value = '';
  }
  function expireAuthorization(message) {
    writeAuthorized = false;
    if ($('admin-withdrawal-test-status')) status('admin-withdrawal-test-status', '');
    setSaveReady(false);
    setPolicyFieldsEnabled(false);
    clearPrivateFields();
    $('admin-withdrawal-password').value = '';
    status('admin-withdrawal-connection', message || 'Auto Shutdown admin session expired. Sign in again.', 'error');
    $('admin-withdrawals-refresh').disabled = true;
    renderRows([]);
    status('admin-withdrawals-status', 'Sign in to Auto Shutdown admin again to view withdrawal history.');
  }
  function handleWriteUnauthorized(error) {
    if (error && error.status === 401) {
      expireAuthorization('Auto Shutdown admin session expired. Sign in again.');
      return true;
    }
    return false;
  }
  function fill(config, authorized) {
    savedLoginUrl = authorized ? (config.loginUrl || '') : '';
    savedUsername = authorized ? (config.username || '') : '';
    $('admin-withdrawal-enabled').checked = config.enabled === true;
    $('admin-withdrawal-min').value = Number.isInteger(Number(config.min)) ? config.min : 1;
    $('admin-withdrawal-max').value = Number.isInteger(Number(config.max)) ? config.max : 1000;
    $('admin-withdrawal-daily-limit').value = Number.isInteger(Number(config.dailyLimit)) &&
      Number(config.dailyLimit) >= 0 && Number(config.dailyLimit) <= 1000 ? config.dailyLimit : 0;
    $('admin-withdrawal-url').value = authorized ? (config.loginUrl || '') : '';
    $('admin-withdrawal-username').value = authorized ? (config.username || '') : '';
    $('admin-withdrawal-password').value = '';
    $('admin-withdrawal-secret-state').textContent = !authorized
      ? 'Pisonet credentials and password status are hidden until authorized.'
      : config.passwordConfigured === true
      ? 'An encrypted password is already configured. A blank password keeps it unchanged.'
      : config.passwordConfigured === false ? 'No Pisonet API password is configured.'
        : 'Pisonet credential status is hidden until authorized.';
  }
  async function load() {
    setSaveReady(false);
    pointsConnected = false;
    compatibleVersion = false;
    dailyLimitSupported = false;
    loginTestSupported = false;
    if (testButton) testButton.disabled = true;
    setPolicyFieldsEnabled(writeAuthorized);
    status('admin-withdrawal-connection', 'Checking Denfi Points connection…');
    status('admin-withdrawal-save-status', '');
    try {
      const body = await api('/api/admin/withdrawal');
      if (!body.connected || !body.withdrawal) throw new Error(body.error || 'Denfi Points connection is unavailable.');
      pointsConnected = true;
      compatibleVersion = body.version === 1;
      dailyLimitSupported = body.dailyLimitSupported === true;
      writeAuthorized = body.writeAuthorized === true;
      loginTestSupported = body.loginTestSupported === true;
      if (testButton) status('admin-withdrawal-test-status', loginTestSupported ? '' :
        'Update Denfi Points on the server to enable the no-coins login test.');
      fill(body.withdrawal, writeAuthorized);
      setPolicyFieldsEnabled(writeAuthorized && compatibleVersion && dailyLimitSupported);
      $('admin-withdrawal-password').value = '';
      if (writeAuthorized) {
        $('admin-withdrawals-refresh').disabled = false;
        status('admin-withdrawal-connection', 'CONNECTED' + (body.pointsServer ? ' — ' + body.pointsServer : '') +
          ' · Shared policy v' + body.version + (body.adminProtocol ? ' · Admin access ' + body.adminProtocol + ' (no callback)' : '') +
          (body.withdrawal.telegramConfigured ? ' · Telegram configured' : ' · Telegram not configured'), 'success');
      } else {
        clearPrivateFields();
        status('admin-withdrawal-connection', 'CONNECTED — update both apps to use your Auto Shutdown admin login for withdrawal settings.', 'error');
      }
      if (!compatibleVersion) status('admin-withdrawal-connection', 'CONNECTED — this Denfi Points build does not support withdrawal policy version 1. Save is disabled.', 'error');
      if (!dailyLimitSupported) status('admin-withdrawal-connection', 'CONNECTED — update Denfi Points to support the daily withdrawal limit before saving. Save is disabled.', 'error');
      setSaveReady(writeAuthorized && compatibleVersion && dailyLimitSupported);
    } catch (error) {
      if (handleWriteUnauthorized(error)) {
        compatibleVersion = false;
      } else {
        pointsConnected = error.body?.connected === true;
        compatibleVersion = false;
        writeAuthorized = false;
        setPolicyFieldsEnabled(false);
        clearPrivateFields();
        status('admin-withdrawal-connection', error.message + ' Save is disabled until shared withdrawal settings can be loaded.', 'error');
      }
      setSaveReady(false);
    }
    await loadHistory();
  }
  function rawWhole(value) {
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 1000;
  }
  function rawDailyLimit(value) {
    return /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 1000;
  }
  async function testSavedLogin() {
    if (!readyToSave || !loginTestSupported || testingLogin) return;
    if ($('admin-withdrawal-password').value ||
        $('admin-withdrawal-url').value.trim() !== savedLoginUrl ||
        $('admin-withdrawal-username').value.trim() !== savedUsername) {
      status('admin-withdrawal-test-status', 'Save the changed credentials first. This test uses the saved settings on Denfi Points.', 'error');
      return;
    }
    testingLogin = true;
    const requestToken = token();
    setSaveReady(readyToSave);
    status('admin-withdrawal-test-status', 'Checking saved Pisonet login. No coins will be requested…');
    try {
      const body = await api('/api/admin/withdrawal/test-login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
      });
      if (token() !== requestToken || !writeAuthorized) return;
      const info = body.diagnostics || {};
      const details = [
        info.httpStatus ? 'HTTP ' + info.httpStatus : '',
        info.bodyFormat ? 'Response: ' + info.bodyFormat : '',
        info.tokenSource ? 'Token from: ' + info.tokenSource : '',
        typeof info.reportedSuccess === 'boolean' ? 'Controller success: ' + info.reportedSuccess : '',
        Array.isArray(info.responseFields) && info.responseFields.length ? 'Fields: ' + info.responseFields.join(', ') : ''
      ].filter(Boolean).join(' · ');
      status('admin-withdrawal-test-status', body.message + (details ? ' ' + details : ''),
        body.authenticated ? 'success' : 'error');
    } catch (error) {
      if (!handleWriteUnauthorized(error)) status('admin-withdrawal-test-status', 'Login check failed: ' + error.message, 'error');
    } finally {
      testingLogin = false;
      setSaveReady(readyToSave);
    }
  }
  async function save(event) {
    event.preventDefault();
    if (!readyToSave || testingLogin) return;
    const minimum = $('admin-withdrawal-min').value;
    const maximum = $('admin-withdrawal-max').value;
    if (!rawWhole(minimum) || !rawWhole(maximum) || Number(minimum) > Number(maximum)) {
      status('admin-withdrawal-save-status', 'Minimum and maximum must be whole pesos from 1 to 1000, with minimum no greater than maximum.', 'error');
      return;
    }
    const dailyLimit = $('admin-withdrawal-daily-limit').value;
    if (!dailyLimitSupported) {
      status('admin-withdrawal-save-status', 'Update Denfi Points to support the daily withdrawal limit before saving. The setting was not sent.', 'error');
      return;
    }
    if (!rawDailyLimit(dailyLimit)) {
      status('admin-withdrawal-save-status', 'Daily withdrawal limit must be a whole number from 0 to 1000.', 'error');
      return;
    }
    const payload = {
      enabled: $('admin-withdrawal-enabled').checked,
      min: Number(minimum),
      max: Number(maximum),
      dailyLimit: Number(dailyLimit),
      loginUrl: $('admin-withdrawal-url').value.trim(),
      username: $('admin-withdrawal-username').value.trim()
    };
    const password = $('admin-withdrawal-password').value;
    if (password) payload.password = password;
    if (!payload.loginUrl || !payload.username) {
      status('admin-withdrawal-save-status', 'Pisonet login URL and username are required.', 'error');
      return;
    }
    const button = $('admin-withdrawal-save');
    button.disabled = true;
    status('admin-withdrawal-save-status', 'Publishing shared policy to Denfi Points…');
    try {
      const body = await api('/api/admin/withdrawal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (body.writeAuthorized === false) {
        expireAuthorization('Auto Shutdown admin session expired. Sign in again.');
        throw new Error('Write authorization expired; the policy was not confirmed.');
      }
      if (!body.connected || body.version !== 1 || !body.withdrawal) throw new Error(body.error || 'Policy was not confirmed by Denfi Points.');
      if (body.dailyLimitSupported !== true) {
        dailyLimitSupported = false;
        setPolicyFieldsEnabled(false);
        throw new Error('Update Denfi Points to support the daily withdrawal limit. The setting was not confirmed.');
      }
      if (Number(body.withdrawal.dailyLimit) !== Number(payload.dailyLimit)) {
        throw new Error('Denfi Points did not confirm the saved daily withdrawal limit. Expected ' + payload.dailyLimit + '.');
      }
      fill(body.withdrawal, true);
      dailyLimitSupported = true;
      loginTestSupported = body.loginTestSupported === true;
      status('admin-withdrawal-connection', 'CONNECTED — shared withdrawal policy v' + body.version + (body.withdrawal.telegramConfigured ? ' · Telegram configured' : ' · Telegram not configured'), 'success');
      status('admin-withdrawal-save-status', 'Published successfully to shared Denfi Points settings.', 'success');
      setSaveReady(true);
    } catch (error) {
      status('admin-withdrawal-save-status', 'Publish failed. No success is assumed: ' + error.message, 'error');
      if (!handleWriteUnauthorized(error)) setSaveReady(false);
    }
  }
  function dateText(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  }
  function cell(row, value) {
    const td = document.createElement('td');
    if (value instanceof Node) td.appendChild(value);
    else td.textContent = value == null || value === '' ? '—' : String(value);
    row.appendChild(td);
    return td;
  }
  function renderRows(records) {
    const list = $('admin-withdrawals-list');
    list.replaceChildren();
    if (!Array.isArray(records) || records.length === 0) {
      const row = document.createElement('tr'), empty = document.createElement('td');
      empty.colSpan = 8;
      empty.textContent = 'No withdrawal records to display.';
      row.appendChild(empty);
      list.appendChild(row);
      return;
    }
    records.forEach((record) => {
      const row = document.createElement('tr');
      const id = document.createElement('div');
      id.textContent = record.requestId || '—';
      const member = document.createElement('div');
      member.textContent = record.username || '—';
      cell(row, id).appendChild(member);
      cell(row, record.station);
      cell(row, '\u20b1' + (Number.isFinite(Number(record.amount)) ? Number(record.amount).toLocaleString() : '—'));
      cell(row, Number.isFinite(Number(record.balance)) ? '\u20b1' + Number(record.balance).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—');
      const badge = document.createElement('span');
      badge.className = 'withdrawal-status-tag';
      badge.dataset.status = String(record.status || '').toLowerCase();
      badge.textContent = String(record.status || 'unknown').toUpperCase();
      cell(row, badge);
      cell(row, record.reason);
      cell(row, 'Created: ' + dateText(record.createdAt) + '\nUpdated: ' + dateText(record.updatedAt));
      const actions = document.createElement('td');
      if (record.status === 'unconfirmed') {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'withdrawal-resolve';
        button.textContent = 'Reconcile';
        button.addEventListener('click', () => resolve(record, button));
        actions.appendChild(button);
        row.classList.add('withdrawal-row-unconfirmed');
      } else actions.textContent = '—';
      row.appendChild(actions);
      list.appendChild(row);
    });
  }
  async function loadHistory() {
    if (!pointsConnected || !writeAuthorized) {
      $('admin-withdrawals-refresh').disabled = !pointsConnected || !writeAuthorized;
      renderRows([]);
      status('admin-withdrawals-status', !pointsConnected
        ? 'History unavailable while Denfi Points is disconnected.'
        : 'Sign in to Auto Shutdown admin and connect Denfi Points to view withdrawal history.');
      return;
    }
    try {
      const body = await api('/api/admin/withdrawals');
      if (body.writeAuthorized === false) {
        expireAuthorization('Auto Shutdown admin session expired. Sign in again.');
        return;
      }
      renderRows(body.withdrawals);
      status('admin-withdrawals-status', 'History refreshed · ' + (body.withdrawals || []).length + ' record(s).', 'success');
    } catch (error) {
      renderRows([]);
      if (!handleWriteUnauthorized(error)) status('admin-withdrawals-status', 'Could not load history: ' + error.message, 'error');
    }
  }
  async function resolve(record, button) {
    if (button.disabled || !pointsConnected || !writeAuthorized) return;
    const outcome = window.prompt('Check the coin machine payment record for ' + record.requestId + ' (' + '\u20b1' + record.amount + ').\n\nType PAID if cash was paid (do not refund points), or NOT PAID if cash was not paid (release/refund reserved points). Cancel to abort.');
    if (outcome === null) return;
    const paid = outcome.trim().toLowerCase() === 'paid';
    const notPaid = outcome.trim().toLowerCase() === 'not paid';
    if (!paid && !notPaid) {
      status('admin-withdrawals-status', 'Reconciliation cancelled — enter exactly PAID or NOT PAID.', 'error');
      return;
    }
    const released = paid;
    const reason = window.prompt('Required reconciliation note: identify the coin machine payment record and confirm ' + (paid ? 'cash was paid; no refund' : 'cash was not paid; refund/release points') + '.');
    if (reason === null || !reason.trim()) {
      status('admin-withdrawals-status', 'Reconciliation cancelled — a non-empty reason is required.', 'error');
      return;
    }
    if (!window.confirm('Confirm irreversible reconciliation?\n' + (released
      ? 'This records coins as PAID (released=true) and does not refund points.'
      : 'This marks the withdrawal FAILED (released=false) and refunds points. If cash was actually paid, the member may receive duplicate value.')
      + '\n\nReason: ' + reason.trim())) return;
    button.disabled = true;
    try {
      const body = await api('/api/admin/withdrawals/' + encodeURIComponent(record.requestId) + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ released, reason: reason.trim() })
      });
      if (body.writeAuthorized === false) {
        expireAuthorization('Auto Shutdown admin session expired. Sign in again.');
        return;
      }
      if (!body.withdrawal) throw new Error('Server did not return the reconciled record.');
      status('admin-withdrawals-status', 'Reconciliation recorded. Refreshing history…', 'success');
      await loadHistory();
    } catch (error) {
      button.disabled = false;
      if (!handleWriteUnauthorized(error)) status('admin-withdrawals-status', 'Reconciliation was not confirmed: ' + error.message, 'error');
    }
  }
  form.addEventListener('submit', save);
  $('admin-withdrawal-reload').addEventListener('click', load);
  $('admin-withdrawals-refresh').addEventListener('click', loadHistory);
  if (testButton) testButton.addEventListener('click', testSavedLogin);
  window.DenfiWithdrawalAdmin = { load, loadHistory };
})();