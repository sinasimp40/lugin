const MEMBER_RE = /^mem-[a-z0-9._-]{1,80}$/i;

function registerManualPointsRoutes(app, { coinLogs, settings, verifyToken, blockIfReadOnly }) {
  function memberName(value) {
    if (typeof value !== 'string' || !MEMBER_RE.test(value.trim())) {
      throw Object.assign(new Error('Enter the full member username, such as mem-player.'), { status: 400 });
    }
    return value.trim();
  }

  function guarded(handler) {
    return (req, res) => {
      try { handler(req, res); }
      catch (error) {
        const status = [400, 409].includes(error.status) ? error.status : 503;
        res.status(status).json({ success: false, error: error.status ? error.message :
          'The adjustment could not be confirmed. Retry the same request; do not submit a new adjustment.' });
      }
    };
  }

  function snapshot() {
    const rates = settings.getSettings().pointRates || [];
    return { rates, logs: coinLogs.getLogs({}, rates).logs, period: coinLogs.getCurrentPeriodKey() };
  }

  function memberSummary(username, { rates, logs, period }) {
    const rows = logs.filter(log => log.username === username);
    const monthlyPoints = rows.reduce((sum, log) =>
      !['withdrawal', 'withdrawal-refund'].includes(log.source) &&
      coinLogs.getPeriodKey(log.timestamp) === period ? sum + (Number(log.points) || 0) : sum, 0);
    return {
      username, balance: coinLogs.getMemberPoints(username, rates),
      monthlyPoints: Math.round(monthlyPoints * 100) / 100, period,
      hasHistory: rows.length > 0,
      blocked: !!coinLogs.getUnresolvedWithdrawal(username),
    };
  }

  app.get('/api/admin/point-adjustments/members', verifyToken, blockIfReadOnly, guarded((req, res) => {
    const { logs } = snapshot();
    const members = [...new Set(logs.map(log => log.username).filter(name =>
      typeof name === 'string' && MEMBER_RE.test(name)))].sort();
    res.json({ success: true, members });
  }));

  app.get('/api/admin/point-adjustments/member/:username', verifyToken, blockIfReadOnly,
    guarded((req, res) => res.json({ success: true,
      member: memberSummary(memberName(req.params.username), snapshot()) })));

  app.post('/api/admin/point-adjustments', verifyToken, blockIfReadOnly, guarded((req, res) => {
    const username = memberName(req.body?.username);
    const rates = settings.getSettings().pointRates || [];
    const result = coinLogs.adjustMemberPoints({ username, delta: req.body?.delta,
      reason: req.body?.reason, requestId: req.body?.requestId }, rates);
    res.json({ success: true, ...result, member: memberSummary(username, snapshot()) });
  }));
}

module.exports = { registerManualPointsRoutes };