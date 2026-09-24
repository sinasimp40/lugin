const crypto = require('crypto');

const MAX_AGE_MS = 5 * 60 * 1000;
const seen = new Map();

function keyDigest(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function mac(digest, text) {
  return crypto.createHmac('sha256', Buffer.from(digest, 'hex')).update(text).digest('hex');
}

function equal(a, b) {
  if (!/^[a-f0-9]{64}$/i.test(a || '') || !/^[a-f0-9]{64}$/i.test(b || '')) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function signRequest(key, method, route, body = '') {
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString('hex');
  return {
    nonce,
    headers: {
      'x-attendance-time': timestamp,
      'x-attendance-nonce': nonce,
      'x-attendance-sig': mac(keyDigest(key), `${timestamp}\n${nonce}\n${method}\n${route}\n${body}`)
    }
  };
}

function verifyRequest(req, digest) {
  const timestamp = req.get('x-attendance-time');
  const nonce = req.get('x-attendance-nonce');
  if (!/^\d{13}$/.test(timestamp || '') || !/^[a-f0-9]{32}$/i.test(nonce || '') ||
      Math.abs(Date.now() - Number(timestamp)) > MAX_AGE_MS || !/^[a-f0-9]{64}$/i.test(digest || '')) return false;
  const body = req.method === 'POST' ? JSON.stringify(req.body) : '';
  const expected = mac(digest, `${timestamp}\n${nonce}\n${req.method}\n${req.path}\n${body}`);
  if (!equal(req.get('x-attendance-sig'), expected)) return false;
  for (const [oldNonce, time] of seen) if (Date.now() - time > MAX_AGE_MS) seen.delete(oldNonce);
  if (seen.has(nonce)) return false;
  seen.set(nonce, Date.now());
  if (seen.size > 5000) seen.delete(seen.keys().next().value);
  return true;
}

function signResponse(digest, nonce, data) {
  return mac(digest, `${nonce}\n${JSON.stringify(data)}`);
}

function verifyResponse(key, nonce, rawBody, signature) {
  return equal(signature, mac(keyDigest(key), `${nonce}\n${rawBody}`));
}

module.exports = { signRequest, verifyRequest, signResponse, verifyResponse };