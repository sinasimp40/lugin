'use strict';
const { createBingoService, parseConfig } = require('./bingo-service');
function registerBingoRoutes(app, { appRole, coinLogs, settings, verifyToken, authorizeKioskMission,
  requireLocalPlayer, activeMember, fetchPoints, broadcast }) {
  const service = appRole === 'points' ? createBingoService({
    getDb: () => require('./points-database').getActive(),
    coinLogs, getRates: () => settings.getSettings().pointRates || []
  }) : null;
  function error(res, err) {
    const status = [400, 401, 403, 404, 409, 429].includes(err.status) ? err.status : 503;
    res.status(status).json({ success: false, error: err.status ? err.message :
      'Could not confirm Bingo with Denfi Points. Retry the same request; do not place a new bet.' });
  }
  const central = fn => (req, res) => {
    if (!service) return res.status(404).json({ success: false, error: 'Update Denfi Points to enable Bingo.' });
    try { res.json(fn(req)); } catch (err) { error(res, err); }
  };
  // Same trusted-desktop boundary as shared themes: player browser requests
  // must not impersonate a kiosk to publish policy, cancel, or debit a member.
  const kioskWriteHeaders = { 'Content-Type': 'application/json', 'x-denfi-kiosk-server': 'auto-shutdown' };
  function desktopWrite(req, res, next) {
    if (req.headers.origin || req.headers.referer || req.headers['sec-fetch-site'] ||
        req.headers['x-denfi-kiosk-server'] !== 'auto-shutdown') {
      return res.status(403).json({ success: false, error: 'Bingo changes require the trusted Auto Shutdown server.' });
    }
    next();
  }
  app.get('/api/sync/bingo', authorizeKioskMission, central(() => service.state()));
  app.get('/api/sync/bingo/member/:username', authorizeKioskMission,
    central(req => service.state(req.params.username, Number(req.query.cardOffset || 0))));
  app.post('/api/sync/bingo/join', authorizeKioskMission, desktopWrite, central(req => service.join(req.body || {})));
  app.post('/api/admin/kiosk-bingo', authorizeKioskMission, desktopWrite,
    central(req => service.configure(req.body?.config, req.body?.expectedVersion)));
  app.post('/api/admin/kiosk-bingo/cancel', authorizeKioskMission, desktopWrite,
    central(req => service.cancel(req.body?.eventId)));
  app.get('/api/admin/bingo', verifyToken, async (req, res) => {
    try { res.json(service ? service.state() : await fetchPoints('/api/sync/bingo')); }
    catch (err) { error(res, err); }
  });
  app.post('/api/admin/bingo', verifyToken, async (req, res) => {
    if (appRole !== 'auto-shutdown') return res.status(403).json({ success: false,
      error: 'Configure Bingo from the Auto Shutdown operator panel.' });
    try {
      const config = parseConfig(req.body?.config);
      const before = await fetchPoints('/api/sync/bingo');
      if (before.bingoVersion !== 1 || before.supportsCustomStake !== true)
        throw Object.assign(new Error('Update both desktop apps before publishing Bingo and its custom-card policy.'), { status: 409 });
      const result = await fetchPoints('/api/admin/kiosk-bingo', {
        method: 'POST', headers: kioskWriteHeaders,
        body: JSON.stringify({ config, expectedVersion: req.body.expectedVersion })
      });
      const confirmed = await fetchPoints('/api/sync/bingo');
      if (JSON.stringify(confirmed.config) !== JSON.stringify(config) || confirmed.version !== result.version)
        throw Object.assign(new Error('Bingo settings changed again on another PC. Reload to see the live settings.'), { status: 409 });
      res.json(confirmed);
    } catch (err) { error(res, err); }
  });
  app.post('/api/admin/bingo/cancel', verifyToken, async (req, res) => {
    if (appRole !== 'auto-shutdown') return res.status(403).json({ success: false,
      error: 'Cancel Bingo from the Auto Shutdown operator panel.' });
    try {
      res.json(await fetchPoints('/api/admin/kiosk-bingo/cancel', { method: 'POST',
        headers: kioskWriteHeaders, body: JSON.stringify({ eventId: req.body?.eventId }) }));
    } catch (err) { error(res, err); }
  });
  const spoken = new Map();
  let publicResult = null;
  function publishResult(event) {
    if (!event || event.phase !== 'finished' || Date.now()-Number(event.finishedAt)>90000) {
      publicResult = null;
      return;
    }
    const already = publicResult?.id === event.id;
    publicResult = {id:event.id,phase:event.phase,finishedAt:event.finishedAt,
      winners:(event.winners || []).map(w=>({username:w.username,station:w.station,winningCards:w.winningCards,payout:w.payout}))};
    if (!already) broadcast({type:'bingo-result',data:publicResult});
    for (const winner of publicResult.winners) voice({
      type:'bingo-win',...winner,id:`bingo-win:${event.id}:${winner.username}`
    });
  }
  // Public winner notices do not depend on somebody being logged in or keeping
  // a Bingo popup open. Private cards and balances never enter this feed.
  app.get('/api/bingo/result', (_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.json({success:true,event:publicResult && Date.now()-Number(publicResult.finishedAt)<90000 ? publicResult : null});
  });
  function voice(event) {
    if (spoken.has(event.id)) return;
    spoken.set(event.id, Date.now());
    for (const [id, time] of spoken) if (Date.now() - time > 6 * 3600000) spoken.delete(id);
    broadcast({ type: 'bingo-voice-event', data: { ...event, expiresAt: Date.now() + 30000 } });
  }
  function announce(data, username) {
    const event = data.event;
    if (!event) return;
    const participating = !!data.participant &&
      String(data.participant.username || '').toLowerCase() === String(username).toLowerCase();
    if (event.phase === 'joining') {
      voice({ type: 'bingo-start', username, id: `bingo-start:${event.id}:${username}` });
      if (!data.participant && data.balance < 1) voice({ type: 'bingo-failed', username, insufficient: true,
        id: `bingo-insufficient:${event.id}:${username}` });
    }
    if (participating && ['joining', 'drawing'].includes(event.phase)) voice({
      type: 'bingo-joined', username, eventId:event.id, cardCount: data.participant.cardCount,
      id: `bingo-joined:${event.id}:${username}`
    });
    if (participating && event.phase === 'drawing' && event.latestCall) voice({ type: 'bingo-call', username,
      eventId:event.id,callIndex:event.called.length,joined:true,
      id: `bingo-call:${event.id}:${event.latestCall.number}:${username}`, ...event.latestCall });
    if (['finished', 'cancelled'].includes(event.phase) && Date.now() - event.finishedAt < 90000) {
      if (event.phase === 'cancelled' && data.participant) voice({ type: 'bingo-cancelled', username,
        refundedPoints:data.participant.stake,insufficientParticipants:/not enough participants/i.test(event.reason || ''),
        id: `bingo-cancelled:${event.id}:${username}` });
      for (const winner of event.winners || []) voice({
        type: 'bingo-win', username: winner.username, payout: winner.payout,
        winningCards: winner.winningCards, id: `bingo-win:${event.id}:${winner.username}`
      });
    }
  }
  app.get('/api/session/bingo', requireLocalPlayer, async (req, res) => {
    const member = await activeMember(req, res);
    if (!member) return;
    try {
      const data = await fetchPoints('/api/sync/bingo/member/' + encodeURIComponent(member.username) +
        '?cardOffset=' + encodeURIComponent(req.query.cardOffset || '0'));
      announce(data, member.username);
      res.json(data);
    } catch (err) { error(res, err); }
  });
  app.post('/api/session/bingo/join', requireLocalPlayer, async (req, res) => {
    const member = await activeMember(req, res);
    if (!member) return;
    const body = req.body || {};
    try {
      const data = await fetchPoints('/api/sync/bingo/join', {
        method: 'POST', headers: kioskWriteHeaders,
        body: JSON.stringify({ eventId: body.eventId, amount: body.amount, requestId: body.requestId, ...member })
      });
      voice({ type: 'bingo-joined', username: member.username, eventId:body.eventId,cardCount: data.participant.cardCount,
        id: `bingo-joined:${body.eventId}:${member.username}` });
      res.json(data);
    } catch (err) {
      if ([400, 409].includes(err.status) && /^[a-z0-9:_-]{8,120}$/i.test(body.requestId || '')) {
        voice({ type: 'bingo-failed', username: member.username,
          insufficient: /not enough points/i.test(err.message),
          id: `bingo-failed:${body.eventId}:${body.requestId}:${member.username}` });
      }
      error(res, err);
    }
  });
  if (service) {
    setInterval(() => {
      if (!require('./points-database').isActive()) return;
      try { publishResult(service.advance()); }
      catch (err) { console.error('[Bingo] Event paused; no unconfirmed payout:', err.message); }
    }, 500).unref();
  } else {
    let resultBusy = false, retryAfter = 0;
    setInterval(async()=>{
      if (resultBusy || Date.now()<retryAfter) return;
      resultBusy = true;
      try {
        const data = await fetchPoints('/api/sync/bingo');
        if (!data.success || !data.supportsBingo) throw new Error('Bingo result feed unavailable.');
        publishResult(data.event);
      } catch (_) { retryAfter=Date.now()+30000; }
      finally { resultBusy=false; }
    },3000).unref();
  }
  return service;
}
module.exports = { registerBingoRoutes };
