const crypto = require('node:crypto');

const GRANT_TTL = 45 * 60000;
const ADMIN_ACCESS_PROTOCOL = 2;

// Connected desktop servers are trusted by the shop's existing LAN policy.
// Their upstream credential stays in server memory; player browsers never
// receive it. Every kiosk admin request still requires its local admin login.
function createKioskAdminAccess({ verifyToken, authorizeKioskMission, now = Date.now }) {
  const grants = new Map();
  const browserRequest = req => Boolean(req.headers.origin || req.headers.referer ||
    req.headers['sec-fetch-site']);
  const peer = req => req.socket.remoteAddress;

  function issue(req, res) {
    if (browserRequest(req) || req.headers['x-denfi-kiosk-server'] !== 'auto-shutdown') {
      return res.status(403).json({ success: false,
        error: 'Withdrawal admin access is for connected kiosk servers, not player browsers.' });
    }
    // The kiosk validates its own operator login before requesting this grant.
    // Points trusts connected desktop servers on the shop LAN; requiring a
    // reverse HTTP connection breaks kiosks with inbound firewall restrictions.
    let grant = grants.get(peer(req));
    if (!grant || grant.expires <= now()) {
      grant = { token: crypto.randomBytes(32).toString('hex'), expires: now() + GRANT_TTL };
      grants.set(peer(req), grant);
    }
    res.json({ success: true, version: 1, adminProtocol: ADMIN_ACCESS_PROTOCOL,
      token: grant.token, expiresAt: grant.expires });
  }

  function verify(req, res, next) {
    const grant = grants.get(peer(req));
    if (grant?.expires <= now()) grants.delete(peer(req));
    if (grant && grant.expires > now() && !browserRequest(req) &&
        req.headers['x-admin-token'] === grant.token) {
      return authorizeKioskMission(req, res, next);
    }
    // The Points computer can still use its own normal local admin login.
    return verifyToken(req, res, next);
  }

  const cleanup = setInterval(() => {
    for (const [address, grant] of grants) if (grant.expires <= now()) grants.delete(address);
  }, 60000);
  cleanup.unref();
  return { issue, verify, close: () => clearInterval(cleanup) };
}

module.exports = { createKioskAdminAccess, GRANT_TTL, ADMIN_ACCESS_PROTOCOL };