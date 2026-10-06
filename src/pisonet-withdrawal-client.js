class ReleaseError extends Error {
  constructor(message, ambiguous = false) {
    super(message);
    this.ambiguous = ambiguous;
  }
}

function normalizeToken(value) {
  if (typeof value !== 'string') return '';
  const token = value.replace(/^\s*Bearer(?:\s+|$)/i, '').trim();
  return /[\r\n]/.test(token) ? '' : token;
}

function extractToken(value) {
  const pending = [value], seen = new WeakSet();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const key of ['accessToken', 'access_token', 'token', 'authorization']) {
      const token = normalizeToken(current[key]);
      if (token) return token;
    }
    pending.push(...Object.values(current).reverse());
  }
  return '';
}

function createPisonetWithdrawalClient({ fetchImpl = fetch, timeout = 20000 } = {}) {
  let cached = null;
  async function login(config, { force = false, onResponse } = {}) {
    if (!force && cached && cached.loginUrl === config.loginUrl &&
        cached.username === config.username && cached.password === config.password) {
      onResponse?.({ ...cached.diagnostics, cached: true });
      return cached.token;
    }
    cached = null;
    const url = new URL(config.loginUrl);
    let response;
    try {
      response = await fetchImpl(url.href, {
        method: 'POST', redirect: 'error',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json',
          Origin: url.origin, Referer: url.origin + '/admin/' },
        body: JSON.stringify({ username: config.username, password: config.password }),
        signal: AbortSignal.timeout(timeout),
      });
    } catch (_) {
      throw new ReleaseError('Could not reach the Pisonet login API. No coin-release request was sent.');
    }
    const mediaType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const diagnostics = { httpStatus: response.status,
      contentType: /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mediaType) ? mediaType : 'unknown',
      bodyFormat: 'unreadable', tokenSource: null };
    if (!response.ok) {
      onResponse?.(diagnostics);
      throw new ReleaseError(`Pisonet login failed (HTTP ${response.status}). No coins were requested.`);
    }
    let data;
    let body;
    try { body = await response.text(); }
    catch (_) {
      onResponse?.(diagnostics);
      throw new ReleaseError('The Pisonet login response could not be read. No coins were requested.');
    }
    try {
      data = JSON.parse(body);
      diagnostics.bodyFormat = Array.isArray(data) ? 'json-array' : 'json-' + (data === null ? 'null' : typeof data);
    } catch (_) {
      diagnostics.bodyFormat = !body.trim() ? 'empty' :
        mediaType === 'text/html' || /^\s*<(?:!doctype|html|head|body)\b/i.test(body) ? 'html' : 'text';
    }
    const jsonToken = extractToken(data);
    const token = jsonToken || normalizeToken(response.headers.get('authorization'));
    diagnostics.tokenSource = token ? (jsonToken ? 'JSON' : 'Authorization header') : null;
    if (typeof data?.success === 'boolean') diagnostics.reportedSuccess = data.success;
    // Return only fixed, known field names, never response values or arbitrary
    // keys that could themselves contain credentials.
    diagnostics.responseFields = data && typeof data === 'object'
      ? ['success', 'data', 'accessToken', 'access_token', 'token', 'authorization', 'message', 'error', 'code', 'result']
        .filter(key => Object.hasOwn(data, key)) : [];
    onResponse?.(diagnostics);
    if (!token) {
      throw new ReleaseError(diagnostics.bodyFormat === 'html'
        ? 'Pisonet login returned a webpage, not an API token. Ask the admin to check the Pisonet API login URL. No coins were requested.'
        : 'Pisonet login returned no token in the JSON response or Authorization header. Ask the admin to test the saved API URL and credentials. No coins were requested.');
    }
    // Match login_pisonet(): a returned token is the authority, even when a
    // separate success field is false. The release endpoint validates it.
    cached = { loginUrl: config.loginUrl, username: config.username, password: config.password, token, diagnostics };
    return token;
  }

  async function release(config, amount, token, canDispatch = () => true) {
    const origin = new URL(config.loginUrl).origin;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!canDispatch()) {
        throw new ReleaseError('Withdrawal settings changed before release. No coins were released; points have been restored.');
      }
      let response;
      try {
        response = await fetchImpl(origin + '/admin/api/changer/releaseCoin', {
          method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json',
            Authorization: 'Bearer ' + token, Origin: origin,
            Referer: origin + '/admin/coin-changer/' },
          body: JSON.stringify({ amount: String(amount) }),
          signal: AbortSignal.timeout(timeout),
        });
      } catch (_) {
        throw new ReleaseError('Coin release could not be confirmed. Check the machine before retrying or refunding.', true);
      }
      // Like the supplied controller, refresh authentication only after an
      // explicit auth rejection. Never replay a release after timeout/5xx.
      if ([401, 403].includes(response.status)) {
        cached = null;
        if (attempt === 0) { token = await login(config, { force: true }); continue; }
        throw new ReleaseError('Pisonet rejected coin-release authentication. Points have been restored.');
      }
      if (!response.ok) {
        const rejected = [400, 404, 405, 422, 429].includes(response.status);
        throw new ReleaseError(rejected
          ? `Pisonet rejected the release (HTTP ${response.status}). Points have been restored.`
          : `Pisonet returned HTTP ${response.status}; coin release is unconfirmed. An admin must check the machine.`,
        !rejected);
      }
      let data;
      try { data = await response.json(); } catch (_) {}
      if (data?.success === false || data === false || data?.data === false) {
        throw new ReleaseError('Pisonet reported that the release failed. Points have been restored.');
      }
      if (data === true || (data?.success === true && data.data !== false)) return;
      throw new ReleaseError('Pisonet returned no explicit release confirmation. An admin must check the machine.', true);
    }
  }

  return { login, release };
}

module.exports = { createPisonetWithdrawalClient, ReleaseError, extractToken };