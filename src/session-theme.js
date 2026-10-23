const { randomUUID } = require('node:crypto');

const THEMES = ['default', 'halloween'];
const PROTOCOL = 1;
const validPolicy = p => p && THEMES.includes(p.theme) &&
  typeof p.revision === 'string' && /^(initial|[a-f0-9-]{36})$/.test(p.revision);

// Points is authoritative. Kiosks retain only their last confirmed copy.
function registerSessionTheme(app, {
  settings, appRole, verifyToken, authorizeKioskMission, getPointsUrl,
  broadcastSettings, fetchImpl = fetch, pollMs = 5000,
}) {
  const points = appRole === 'points';
  let generation = 0, polling = false, publishing = false;
  function policy() {
    const s = settings.getSettings();
    return { theme: THEMES.includes(s.sessionTheme) ? s.sessionTheme : 'default',
      revision: s.sessionThemeRevision || 'initial' };
  }
  function apply(value) {
    if (!validPolicy(value)) throw Object.assign(new Error('Invalid theme policy from Denfi Points.'), { status: 503 });
    const previous = policy();
    if (previous.theme !== value.theme || previous.revision !== value.revision) {
      settings.updateSettings({ sessionTheme: value.theme, sessionThemeRevision: value.revision });
      const stored = policy();
      if (stored.theme !== value.theme || stored.revision !== value.revision) {
        throw new Error('Could not persist the shared theme.');
      }
      broadcastSettings();
    }
    return policy();
  }
  function fail(message, status = 503) { return Object.assign(new Error(message), { status }); }
  async function remote(url, route, options = {}) {
    if (!url) throw fail('Denfi Points is disconnected. Connect in Runtime before saving a shared theme.');
    const response = await fetchImpl(url + route, { ...options,
      signal: AbortSignal.timeout(6000), redirect: 'error' });
    if (response.status === 404) throw fail('Update and restart Denfi Points to support Theme Settings.', 409);
    const data = await response.json();
    if (!response.ok || !data.success) throw fail(data.error || 'Denfi Points could not confirm the theme.',
      [400, 401, 403, 409].includes(response.status) ? response.status : 503);
    if (data.protocol !== PROTOCOL || !validPolicy(data.policy)) {
      throw fail('Denfi Points returned an unsupported theme policy. Update both apps.', 409);
    }
    return data.policy;
  }
  async function refresh() {
    const url = getPointsUrl(), sequence = ++generation;
    const value = points ? policy() : await remote(url, '/api/sync/session-theme');
    if (sequence !== generation || (!points && url !== getPointsUrl())) {
      throw fail('The theme connection changed. Reload Theme Settings.', 409);
    }
    if (!points) apply(value);
    return value;
  }
  const guarded = fn => async (req, res) => {
    try { await fn(req, res); }
    catch (error) {
      res.status(error.status || 503).json({ success: false, error: error.status ? error.message :
        'Could not confirm the theme with Denfi Points. The last confirmed theme is unchanged.' });
    }
  };
  function save(req) {
    const { theme, expectedRevision } = req.body || {};
    if (!THEMES.includes(theme)) throw fail('Choose Default or Halloween.', 400);
    if (expectedRevision !== policy().revision) throw fail('Another admin changed the theme. Reload before saving.', 409);
    return apply({ theme, revision: randomUUID() });
  }
  const result = value => ({ success: true, protocol: PROTOCOL, policy: value });
  app.get('/api/sync/session-theme', authorizeKioskMission, (req, res) => {
    if (!points) return res.status(404).json({ success: false });
    res.json(result(policy()));
  });
  app.post('/api/admin/kiosk-session-theme', authorizeKioskMission, guarded((req, res) => {
    if (!points) return res.status(404).json({ success: false });
    // No player/browser can use the trusted desktop-server publishing route.
    if (req.headers.origin || req.headers.referer || req.headers['sec-fetch-site'] ||
        req.headers['x-denfi-kiosk-server'] !== 'auto-shutdown') {
      throw fail('Theme publishing requires the connected kiosk admin panel.', 403);
    }
    res.json(result(save(req)));
  }));
  app.get('/api/admin/session-theme', verifyToken, guarded(async (req, res) => {
    if (publishing) throw fail('A theme save is in progress. Reload in a moment.', 409);
    res.json(result(await refresh()));
  }));
  app.post('/api/admin/session-theme', verifyToken, guarded(async (req, res) => {
    if (!THEMES.includes(req.body?.theme)) throw fail('Choose Default or Halloween.', 400);
    if (publishing) throw fail('A theme save is already in progress.', 409);
    const sequence = ++generation, url = getPointsUrl();
    if (points) return res.json(result(save(req)));
    publishing = true;
    try {
      const value = await remote(url, '/api/admin/kiosk-session-theme', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-denfi-kiosk-server': 'auto-shutdown' },
      body: JSON.stringify({ theme: req.body.theme, expectedRevision: req.body.expectedRevision }),
    });
    // Read-back catches older/mismatched servers and concurrent operator saves.
    const confirmed = await remote(url, '/api/sync/session-theme');
    if (url !== getPointsUrl() || sequence !== generation ||
        value.theme !== confirmed.theme || value.revision !== confirmed.revision) {
      throw fail('The shared theme changed while saving. Reload to see the active selection.', 409);
    }
    apply(confirmed);
      res.json(result(confirmed));
    } finally { publishing = false; }
  }));
  // Public renderer endpoint exposes only the locally confirmed theme, never admin access.
  app.get('/api/session-theme', (req, res) => res.json(result(policy())));
  async function poll() {
    if (points || polling || publishing || !getPointsUrl()) return;
    polling = true;
    try { await refresh(); } catch (_) { /* Offline: preserve the last confirmed theme. */ }
    finally { polling = false; }
  }
  const timer = setInterval(poll, pollMs);
  timer.unref();
  void poll();
  return { close: () => clearInterval(timer), poll };
}

module.exports = { registerSessionTheme, THEMES, validPolicy };
