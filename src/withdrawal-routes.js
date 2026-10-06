const { createWithdrawalService, memberPattern, requestIdPattern } = require('./withdrawal-service');
const { parseWithdrawal } = require('./withdrawal-config');
const { createKioskAdminAccess, ADMIN_ACCESS_PROTOCOL } = require('./withdrawal-kiosk-access');

function registerWithdrawalRoutes(app, {
  settings, coinLogs, appRole, verifyToken, authorizeKioskMission,
  requireLocalPlayer, activeMember, getPointsUrl, sendTelegramMessage, pisonetClient,
}) {
  const points = appRole === 'points';
  const service = points ? createWithdrawalService({
    settings, coinLogs, sendTelegramMessage, ...(pisonetClient ? { client: pisonetClient } : {}),
  }) : null;
  // Local operator login remains mandatory. Connected kiosk servers acquire
  // upstream access automatically, without collecting a second password.
  const delegations = new Map();
  const kioskAccess = points ? createKioskAdminAccess({ verifyToken, authorizeKioskMission }) : null;

  function guarded(handler) {
    return async (req, res) => {
      try { await handler(req, res); }
      catch (error) {
        if (res.headersSent) return;
        const status = [400, 401, 403, 404, 409, 429, 503].includes(error.status) ? error.status : 503;
        res.status(status).json({ success: false, ...(error.notFound ? { notFound: true } : {}),
          ...(error.connected ? { connected: true, pointsServer: error.pointsServer } : {}),
          error: error.status ? error.message :
          'Could not confirm the withdrawal with Denfi Points. Check the same request; do not start a new withdrawal.' });
      }
    };
  }

  function problem(message, status = 400) {
    return Object.assign(new Error(message), { status });
  }

  function pointsOnly(req, res, next) {
    if (!points) return res.status(404).json({ success: false, error: 'This operation requires Denfi Points.' });
    next();
  }

  async function remote(route, options = {}) {
    const url = getPointsUrl();
    if (!url) throw problem('Denfi Points is not connected. Withdrawals are unavailable.', 503);
    let response, data;
    try {
      response = await fetch(url + route, { ...options, signal: AbortSignal.timeout(45000), redirect: 'error' });
    } catch (_) {
      throw problem('Could not confirm the response from Denfi Points. Check the same withdrawal request; do not start another.', 503);
    }
    try { data = await response.json(); } catch (_) {}
    if (response.status === 404) {
      const error = problem(data?.notFound ? 'No withdrawal is recorded with this request ID.' :
        'Update Denfi Points before using withdrawals. This server does not support the withdrawal feature.', 404);
      if (data?.notFound === true) error.notFound = true;
      throw error;
    }
    if (!response.ok || data?.success !== true) {
      throw problem(data?.error || 'Denfi Points could not process the withdrawal.',
        [400, 401, 403, 409, 429].includes(response.status) ? response.status : 503);
    }
    return data;
  }

  const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });

  function delegation(req) {
    const key = req.headers['x-admin-token'];
    const saved = delegations.get(key);
    if (!saved || saved.url !== getPointsUrl() || saved.expires <= Date.now()) {
      delegations.delete(key);
      return null;
    }
    return saved;
  }

  async function remoteAdmin(req, route, options = {}) {
    let saved = delegation(req);
    async function connectAdmin() {
      const url = getPointsUrl();
      const policy = await remote('/api/sync/withdrawal/policy');
      if (policy.adminProtocol !== ADMIN_ACCESS_PROTOCOL) {
        const origin = new URL(url).origin;
        throw Object.assign(problem('Connected to Denfi Points at ' + origin +
          ', but that server is running an older withdrawal admin module. Update and restart Denfi Points on the server. ' +
          'For diskless PCs, update and save the shared Auto Shutdown boot image as well. Your Runtime connection is not the problem.', 409),
        { connected: true, pointsServer: origin });
      }
      const access = await remote('/api/sync/withdrawal/admin-session', {
        ...post({}), headers: {
          'Content-Type': 'application/json', 'x-denfi-kiosk-server': 'auto-shutdown',
        },
      });
      if (url !== getPointsUrl() || access.version !== 1 || access.adminProtocol !== ADMIN_ACCESS_PROTOCOL ||
          !/^[a-f0-9]{64}$/.test(access.token || '') ||
          !Number.isSafeInteger(access.expiresAt) || access.expiresAt <= Date.now()) {
        throw problem('Denfi Points did not confirm this connected kiosk’s admin access. Reload or update both apps.', 409);
      }
      saved = { url, token: access.token, expires: Math.min(access.expiresAt, Date.now() + 45 * 60000) };
      delegations.set(req.headers['x-admin-token'], saved);
    }
    if (!saved) await connectAdmin();
    const send = async () => ({ ...await remote(route, { ...options,
      headers: { ...options.headers, 'x-admin-token': saved.token } }), pointsServer: new URL(saved.url).origin });
    try {
      return await send();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        delegations.delete(req.headers['x-admin-token']);
        // A 401 is rejected before the admin handler executes, so this single
        // renewal cannot replay a saved policy or a reconciliation.
        if (error.status === 401) { await connectAdmin(); return send(); }
        throw problem('Denfi Points denied this kiosk. Check the trusted shop network connection.', 403);
      }
      throw error;
    }
  }

  function publicResult(record) {
    const withdrawal = service.view(record);
    return { success: true, withdrawal, balance: withdrawal.balance,
      daily: service.dailyState(record.username), machine: service.machineState() };
  }

  function checkedRequestId(value) {
    if (typeof value !== 'string' || !requestIdPattern.test(value)) throw problem('Invalid withdrawal request ID.');
    return value.toLowerCase();
  }

  function checkedMember(value) {
    if (typeof value !== 'string' || !memberPattern.test(value)) throw problem('Invalid member.');
    return value;
  }

  function adminView() {
    return { success: true, connected: true, version: 1, writeAuthorized: true,
      adminProtocol: ADMIN_ACCESS_PROTOCOL,
      loginTestSupported: true,
      dailyLimitSupported: true,
      withdrawal: settings.getWithdrawalAdminSettings() };
  }

  function savePolicy(input) {
    let policy;
    const previous = settings.getWithdrawalSettings();
    try { policy = parseWithdrawal({ ...input,
      dailyLimit: input.dailyLimit === undefined ? previous.dailyLimit : input.dailyLimit }); }
    catch (error) { throw problem(error.message); }
    if (policy.enabled && !input.password && !previous.password) {
      throw problem('Save the Pisonet password before enabling withdrawals.');
    }
    if (policy.enabled && !settings.getTelegramAdminSettings().configured &&
        !(input.telegram?.botToken && input.telegram?.channelId)) {
      throw problem('Configure the Telegram bot and channel in Auto Shutdown before enabling withdrawals.');
    }
    // Only the admin publishing route forwards these server-to-server. They
    // are never part of a policy response, history row or session broadcast.
    if (input.telegram?.botToken && input.telegram?.channelId) {
      try { settings.updateTelegramSettings(input.telegram); }
      catch (_) { throw problem('The saved Telegram configuration is invalid. Check bot and channel settings.'); }
    }
    try { settings.updateWithdrawalSettings({ ...policy, password: input.password }); }
    catch (_) { throw problem('The encrypted Pisonet credentials could not be saved. Check the data folder.', 503); }
    void service.flushNotifications();
    return adminView();
  }

  app.get('/api/sync/withdrawal/policy', authorizeKioskMission, pointsOnly, (req, res) => {
    res.json({ success: true, ...settings.getWithdrawalPolicy(), adminProtocol: ADMIN_ACCESS_PROTOCOL });
  });
  app.post('/api/sync/withdrawal/admin-session', authorizeKioskMission, pointsOnly,
    guarded((req, res) => kioskAccess.issue(req, res)));
  const sharedAdmin = (req, res, next) => points
    ? kioskAccess.verify(req, res, next) : pointsOnly(req, res, next);
  app.get('/api/sync/withdrawal/settings', sharedAdmin, pointsOnly, (req, res) => res.json(adminView()));
  app.post('/api/sync/withdrawal/settings', sharedAdmin, pointsOnly,
    guarded((req, res) => res.json(savePolicy(req.body || {}))));
  app.post('/api/sync/withdrawal/test-login', sharedAdmin, pointsOnly,
    guarded(async (req, res) => res.json({ success: true, ...await service.testLogin() })));
  app.post('/api/admin/withdrawal/test-login', verifyToken, guarded(async (req, res) => {
    res.json(points ? { success: true, ...await service.testLogin() } :
      await remoteAdmin(req, '/api/sync/withdrawal/test-login', post({})));
  }));

  app.get('/api/admin/withdrawal', verifyToken, guarded(async (req, res) => {
    if (points) return res.json(adminView());
    res.json(await remoteAdmin(req, '/api/sync/withdrawal/settings'));
  }));
  app.post('/api/admin/withdrawal', verifyToken, guarded(async (req, res) => {
    if (points) return res.json(savePolicy(req.body || {}));
    let policy;
    try { policy = parseWithdrawal(req.body); } catch (error) { throw problem(error.message); }
    const before = await remoteAdmin(req, '/api/sync/withdrawal/settings');
    if (before.version !== 1 || before.dailyLimitSupported !== true) {
      throw problem('Update and restart Denfi Points to support daily withdrawal limits before publishing.', 409);
    }
    if (req.body.dailyLimit === undefined) policy.dailyLimit = before.withdrawal.dailyLimit;
    const telegram = settings.getTelegramSettings();
    const payload = { ...policy, password: req.body.password };
    if (telegram.botToken && telegram.channelId) payload.telegram = telegram;
    await remoteAdmin(req, '/api/sync/withdrawal/settings', post(payload));
    const after = await remoteAdmin(req, '/api/sync/withdrawal/settings');
    if (after.version !== 1 || after.dailyLimitSupported !== true ||
        Object.entries(policy).some(([key, value]) => after.withdrawal?.[key] !== value) ||
        (policy.enabled && (!after.withdrawal?.passwordConfigured || !after.withdrawal?.telegramConfigured))) {
      throw problem('Denfi Points did not confirm the saved withdrawal settings. Reload and check the active policy.', 409);
    }
    res.json(after);
  }));

  app.get('/api/sync/withdrawal/history', sharedAdmin, pointsOnly, (req, res) => {
    const withdrawals = coinLogs.listWithdrawals(50);
    const pending = coinLogs.getUnresolvedWithdrawal();
    if (pending && !withdrawals.some(record => record.requestId === pending.requestId)) withdrawals.unshift(pending);
    res.json({ success: true, withdrawals });
  });
  app.get('/api/admin/withdrawals', verifyToken, guarded(async (req, res) => {
    if (!points) return res.json(await remoteAdmin(req, '/api/sync/withdrawal/history'));
    const withdrawals = coinLogs.listWithdrawals(50);
    const pending = coinLogs.getUnresolvedWithdrawal();
    if (pending && !withdrawals.some(record => record.requestId === pending.requestId)) withdrawals.unshift(pending);
    res.json({ success: true, withdrawals });
  }));

  function resolveInput(body) {
    if (typeof body?.released !== 'boolean' || typeof body.reason !== 'string' ||
        body.reason.trim().length < 3 || body.reason.length > 300) {
      throw problem('Confirm whether coins were released and enter a short verification note.');
    }
    return { released: body.released, reason: body.reason.trim() };
  }
  const resolve = guarded((req, res) => {
    const id = checkedRequestId(req.params.requestId);
    const input = resolveInput(req.body);
    const record = service.resolve(id, input);
    if (!record) throw problem('Only unconfirmed withdrawals can be reconciled. Reload the history.', 409);
    res.json(publicResult(record));
  });
  app.post('/api/sync/withdrawal/:requestId/resolve', sharedAdmin, pointsOnly, resolve);
  app.post('/api/admin/withdrawals/:requestId/resolve', verifyToken, guarded(async (req, res) => {
    if (points) return resolve(req, res);
    const id = checkedRequestId(req.params.requestId);
    res.json(await remoteAdmin(req, '/api/sync/withdrawal/' + id + '/resolve', post(resolveInput(req.body))));
  }));

  app.get('/api/sync/withdrawal/status/:username', authorizeKioskMission, pointsOnly, guarded((req, res) => {
    const username = checkedMember(req.params.username);
    const pending = coinLogs.getUnresolvedWithdrawal(username);
    res.json({ success: true, ...settings.getWithdrawalPolicy(),
      machine: service.machineState(),
      daily: service.dailyState(username),
      balance: coinLogs.getMemberPoints(username, settings.getSettings().pointRates || []),
      withdrawal: pending ? service.view(pending) : null });
  }));
  app.post('/api/sync/withdrawal', authorizeKioskMission, pointsOnly, guarded(async (req, res) => {
    const username = checkedMember(req.body?.username);
    const requestId = checkedRequestId(req.body?.requestId);
    const record = await service.withdraw({ username, requestId, amount: req.body.amount,
      station: String(req.body.station || 'PC').replace(/[\r\n]/g, ' ').slice(0, 60) });
    res.json(publicResult(record));
  }));
  app.get('/api/sync/withdrawal/:requestId', authorizeKioskMission, pointsOnly, guarded((req, res) => {
    const id = checkedRequestId(req.params.requestId);
    const username = checkedMember(req.query.username);
    const record = coinLogs.getWithdrawal(id);
    if (!record) return res.status(404).json({ success: false, notFound: true, error: 'No withdrawal is recorded with this request ID.' });
    if (record.username !== username) throw problem('This withdrawal belongs to another member.', 403);
    res.json(publicResult(record));
  }));

  app.get('/api/session/withdrawal', requireLocalPlayer, guarded(async (req, res) => {
    const member = await activeMember(req, res);
    if (!member) return;
    res.json(await remote('/api/sync/withdrawal/status/' + encodeURIComponent(member.username)));
  }));
  app.post('/api/session/withdrawal', requireLocalPlayer, guarded(async (req, res) => {
    const member = await activeMember(req, res);
    if (!member) return;
    const requestId = checkedRequestId(req.body?.requestId);
    res.json(await remote('/api/sync/withdrawal', post({
      username: member.username, station: member.station, amount: req.body.amount, requestId,
    })));
  }));
  app.get('/api/session/withdrawal/:requestId', requireLocalPlayer, guarded(async (req, res) => {
    const member = await activeMember(req, res);
    if (!member) return;
    const id = checkedRequestId(req.params.requestId);
    res.json(await remote('/api/sync/withdrawal/' + id + '?username=' + encodeURIComponent(member.username)));
  }));

  if (service) {
    service.recover();
    setInterval(() => void service.flushNotifications(), 15000).unref();
  }
  if (!points) setInterval(() => {
    for (const [token, entry] of delegations) if (entry.expires <= Date.now()) delegations.delete(token);
  }, 60000).unref();
  return service;
}

module.exports = { registerWithdrawalRoutes };