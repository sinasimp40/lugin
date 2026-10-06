const test = require('node:test');
const assert = require('node:assert/strict');
const { createKioskAdminAccess, GRANT_TTL } = require('../src/withdrawal-kiosk-access');

function fixture(t) {
  let clock = 1000, trusted = true;
  const access = createKioskAdminAccess({
    now: () => clock,
    verifyToken: (req, res, next) => req.headers['x-admin-token'] === 'points-local-admin'
      ? next() : res.status(401).json({ success: false }),
    authorizeKioskMission: (req, res, next) => trusted
      ? next() : res.status(403).json({ success: false }),
  });
  t.after(access.close);
  function response() {
    return { statusCode: 200, body: null, passed: false,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; } };
  }
  const request = (headers = {}, ip = '10.10.10.2') => ({ headers, socket: { remoteAddress: ip } });
  async function issue() {
    const res = response();
    await access.issue(request({ 'x-denfi-kiosk-server': 'auto-shutdown' }), res);
    return res.body;
  }
  function check(headers, ip) {
    const res = response();
    access.verify(request(headers, ip), res, () => { res.passed = true; });
    return res;
  }
  return { issue, check, advance: () => { clock += GRANT_TTL; }, untrust: () => { trusted = false; } };
}

test('upstream kiosk access is peer-bound, server-only, short-lived, and renewed without Points password', async t => {
  const f = fixture(t);
  const issued = await f.issue();
  assert.match(issued.token, /^[a-f0-9]{64}$/);
  assert.equal(f.check({ 'x-admin-token': issued.token }).passed, true);
  assert.equal(f.check({ 'x-admin-token': issued.token }, '10.10.10.3').statusCode, 401);
  assert.equal(f.check({ 'x-admin-token': issued.token, origin: 'http://kiosk' }).statusCode, 401);
  assert.equal(f.check({ 'x-admin-token': issued.token, 'sec-fetch-site': 'same-origin' }).statusCode, 401);
  assert.equal(f.check({ 'x-admin-token': 'points-local-admin' }).passed, true);
  f.advance();
  assert.equal(f.check({ 'x-admin-token': issued.token }).statusCode, 401);
  const renewed = await f.issue();
  assert.notEqual(renewed.token, issued.token);
  assert.equal(f.check({ 'x-admin-token': renewed.token }).passed, true);
  f.untrust();
  assert.equal(f.check({ 'x-admin-token': renewed.token }).statusCode, 403);
});