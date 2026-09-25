const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const http = require('http');
const settings = require('./src/settings-store');
const coinLogs = require('./src/coin-log-store');
const orderStore = require('./src/order-store');
const attendance = require('./src/attendance-store');
const { defaultWheel, parseWheel, oddsToken } = require('./src/wheel-config');

const appRoleInit = process.env.DENFI_APP_ROLE || 'auto-shutdown';
settings.setAppRole(appRoleInit);

const app = express();
const PORT = process.env.PORT || 5000;

const HOTSPOT_DNS = 'pisonet.app';
const VENDO_IP = '10.0.0.5:8989';

const activeCoinSessions = new Map();
const recentOrderRequests = new Map();
let monthlyReportAttemptedPeriod = '';
const COIN_SESSION_TTL = 600000;
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of activeCoinSessions) {
    if (now - session.startTime > COIN_SESSION_TTL) {
      activeCoinSessions.delete(key);
    }
  }
}, 60000);

const adminTokens = new Map();
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 300000;

function generateToken() {
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.set(token, Date.now() + 3600000);
  return token;
}
function invalidateAllTokens() {
  adminTokens.clear();
}
function checkRateLimit(ip) {
  const entry = loginAttempts.get(ip);
  if (!entry) return true;
  if (entry.lockedUntil > 0 && Date.now() < entry.lockedUntil) return false;
  if (entry.lockedUntil > 0 && Date.now() >= entry.lockedUntil) { loginAttempts.delete(ip); return true; }
  return true;
}
function recordFailedAttempt(ip) {
  const entry = loginAttempts.get(ip) || { count: 0, lockedUntil: 0 };
  entry.count++;
  if (entry.count >= MAX_ATTEMPTS) { entry.lockedUntil = Date.now() + LOCKOUT_MS; entry.count = 0; }
  loginAttempts.set(ip, entry);
}
function clearAttempts(ip) { loginAttempts.delete(ip); }
function verifyToken(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!token || !adminTokens.has(token) || adminTokens.get(token) < Date.now()) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

app.get('/uploads/:filename', (req, res) => {
  const basename = path.basename(req.params.filename);
  if (!basename || basename.startsWith('.')) return res.status(400).end();
  const filepath = path.join(settings.getUploadsDir(), basename);
  const resolved = path.resolve(filepath);
  if (!resolved.startsWith(path.resolve(settings.getUploadsDir()))) return res.status(403).end();
  if (!fs.existsSync(resolved)) return res.status(404).end();
  if (req.query.v) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=300');
  }
  res.sendFile(resolved);
});

function extractChapBytes(buffer, fieldName, nextFieldName) {
  const startMarkers = [
    Buffer.from(`"${fieldName}": "`),
    Buffer.from(`"${fieldName}":"`),
  ];

  let startIdx = -1;
  for (const m of startMarkers) {
    const idx = buffer.indexOf(m);
    if (idx !== -1) { startIdx = idx + m.length; break; }
  }
  if (startIdx === -1) return Buffer.alloc(0);

  const endSeparators = [
    Buffer.from(`",\r\n\t"${nextFieldName}"`),
    Buffer.from(`",\n\t"${nextFieldName}"`),
    Buffer.from(`",\r\n        "${nextFieldName}"`),
    Buffer.from(`",\n        "${nextFieldName}"`),
    Buffer.from(`",\r\n"${nextFieldName}"`),
    Buffer.from(`",\n"${nextFieldName}"`),
  ];

  for (const sep of endSeparators) {
    const idx = buffer.indexOf(sep, startIdx);
    if (idx !== -1) {
      return buffer.slice(startIdx, idx);
    }
  }

  return Buffer.alloc(0);
}

function cleanJsonForParsing(buffer) {
  let latin1 = buffer.toString('latin1');

  const chapFields = [
    { field: 'chapId', next: 'chapChallenge' },
    { field: 'chapChallenge', next: 'isLogin' },
  ];

  for (const { field, next } of chapFields) {
    const startMarkers = [`"${field}": "`, `"${field}":"`];
    for (const marker of startMarkers) {
      const idx = latin1.indexOf(marker);
      if (idx === -1) continue;
      const start = idx + marker.length;

      const endPatterns = [
        `",\r\n\t"${next}"`,
        `",\n\t"${next}"`,
        `",\r\n        "${next}"`,
        `",\n        "${next}"`,
        `",\r\n"${next}"`,
        `",\n"${next}"`,
      ];

      for (const ep of endPatterns) {
        const endIdx = latin1.indexOf(ep, start);
        if (endIdx !== -1) {
          latin1 = latin1.substring(0, start) + latin1.substring(endIdx);
          break;
        }
      }
      break;
    }
  }

  return latin1;
}

function parseHotspotResponse(buffer) {
  const chapIdBytes = extractChapBytes(buffer, 'chapId', 'chapChallenge');
  const chapChallengeBytes = extractChapBytes(buffer, 'chapChallenge', 'isLogin');

  let data = {};
  try {
    const cleaned = cleanJsonForParsing(buffer);
    data = JSON.parse(cleaned);
  } catch (e) {
    const latin1 = buffer.toString('latin1');
    data = manualExtract(latin1);
  }

  data.chapIdHex = chapIdBytes.toString('hex');
  data.chapChallengeHex = chapChallengeBytes.toString('hex');
  delete data.chapId;
  delete data.chapChallenge;

  return data;
}

function manualExtract(str) {
  const data = {};
  const fields = ['loginLink', 'mac', 'ip', 'interfaceName', 'serverAddress', 'error',
                  'logoutLink', 'username', 'sessionTimeLeft', 'uptime'];
  for (const f of fields) {
    const regex = new RegExp(`"${f}"\\s*:\\s*"([^"]*)"`);
    const match = str.match(regex);
    if (match) data[f] = match[1];
  }
  data.isLogin = str.includes('"isLogin": true') || str.includes('"isLogin":true');
  const unitsMatch = str.match(/"units"\s*:\s*(\{[^}]*\})/);
  if (unitsMatch) {
    try { data.units = JSON.parse(unitsMatch[1]); } catch (_) {}
  }
  return data;
}

async function fetchLoginData() {
  const resp = await fetch(`http://${HOTSPOT_DNS}/login`, {
    signal: AbortSignal.timeout(5000),
    headers: { 'Cache-Control': 'no-cache' },
  });
  const buffer = Buffer.from(await resp.arrayBuffer());
  return parseHotspotResponse(buffer);
}

let hotspotReadQueue = Promise.resolve();
function queueHotspotRead(readOperation) {
  const pending = hotspotReadQueue.then(readOperation, readOperation);
  hotspotReadQueue = pending.catch(() => {});
  return pending;
}

let loginDataReadInFlight = null;
function fetchLoginDataForRead() {
  if (loginDataReadInFlight) return loginDataReadInFlight;
  loginDataReadInFlight = queueHotspotRead(fetchLoginData).finally(() => {
    loginDataReadInFlight = null;
  });
  return loginDataReadInFlight;
}

app.get('/api/hotspot/login-data', async (req, res) => {
  try {
    const data = await fetchLoginDataForRead();
    const chapAvailable = data.chapIdHex && data.chapIdHex.length > 0;
    console.log('[Login Data] CHAP:', chapAvailable, 'loginLink:', data.loginLink, 'error:', data.error);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: `Cannot reach ${HOTSPOT_DNS}: ${err.message}` });
  }
});

app.post('/api/hotspot/login', async (req, res) => {
  if (settings.isWithinCurfew()) {
    const s = settings.getSettings();
    return res.json({ success: false, error: 'Curfew active', code: 'CURFEW_ACTIVE', curfew: { start: s.curfewStart, end: s.curfewEnd } });
  }
  const { username, password } = req.body;
  if (!username || !password) return res.json({ success: false, error: 'Username and password required' });

  try {
    const freshData = await fetchLoginData();
    const chapAvailable = freshData.chapIdHex && freshData.chapIdHex.length > 0 && freshData.chapChallengeHex && freshData.chapChallengeHex.length > 0;

    let loginPassword;
    if (chapAvailable) {
      const chapIdBuf = Buffer.from(freshData.chapIdHex, 'hex');
      const challengeBuf = Buffer.from(freshData.chapChallengeHex, 'hex');
      const passwordBuf = Buffer.from(password, 'latin1');
      const combined = Buffer.concat([chapIdBuf, passwordBuf, challengeBuf]);
      loginPassword = crypto.createHash('md5').update(combined).digest('hex');
      console.log('[Login] Using CHAP');
    } else {
      loginPassword = password;
      console.log('[Login] Using PAP (plaintext)');
    }

    const loginLink = freshData.loginLink || `http://${HOTSPOT_DNS}/login`;
    const postData = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(loginPassword)}&dst=&popup=true`;

    const loginResp = await fetch(loginLink, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });

    const respBuffer = Buffer.from(await loginResp.arrayBuffer());

    try {
      const data = parseHotspotResponse(respBuffer);

      if (data.isLogin) return res.json({ success: true, data });

      if (data.error && data.error !== '') {
        if (chapAvailable) {
          const papResp = await tryPapLogin(username, password, loginLink);
          if (papResp.success) return res.json(papResp);
        } else {
          const chapResp = await tryChapLogin(username, password);
          if (chapResp.success) return res.json(chapResp);
        }
        return res.json({ success: false, error: data.error });
      }

      return res.json({ success: false, error: 'Login failed', data });
    } catch (_) {
      return res.json({ success: false, error: 'Unexpected response' });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

async function tryPapLogin(username, password, loginLink) {
  try {
    const freshData = await fetchLoginData();
    const link = freshData.loginLink || loginLink;
    const postData = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}&dst=&popup=true`;
    const resp = await fetch(link, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const buffer = Buffer.from(await resp.arrayBuffer());
    const data = parseHotspotResponse(buffer);
    if (data.isLogin) return { success: true, data };
    return { success: false, error: data.error || 'PAP login failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function tryChapLogin(username, password) {
  try {
    const freshData = await fetchLoginData();
    if (!freshData.chapIdHex || !freshData.chapChallengeHex) {
      return { success: false, error: 'No CHAP data' };
    }
    const chapIdBuf = Buffer.from(freshData.chapIdHex, 'hex');
    const challengeBuf = Buffer.from(freshData.chapChallengeHex, 'hex');
    const passwordBuf = Buffer.from(password, 'latin1');
    const combined = Buffer.concat([chapIdBuf, passwordBuf, challengeBuf]);
    const chapPassword = crypto.createHash('md5').update(combined).digest('hex');

    const link = freshData.loginLink || `http://${HOTSPOT_DNS}/login`;
    const postData = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(chapPassword)}&dst=&popup=true`;
    const resp = await fetch(link, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    const buffer = Buffer.from(await resp.arrayBuffer());
    const data = parseHotspotResponse(buffer);
    if (data.isLogin) return { success: true, data };
    return { success: false, error: data.error || 'CHAP login failed' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

let statusReadInFlight = null;
function fetchStatusForRead() {
  if (statusReadInFlight) return statusReadInFlight;
  statusReadInFlight = queueHotspotRead(async () => {
    const resp = await fetch(`http://${HOTSPOT_DNS}/status`, { signal: AbortSignal.timeout(5000) });
    const buffer = Buffer.from(await resp.arrayBuffer());
    return parseHotspotResponse(buffer);
  }).finally(() => {
    statusReadInFlight = null;
  });
  return statusReadInFlight;
}

app.get('/api/hotspot/status', async (req, res) => {
  try {
    const data = await fetchStatusForRead();
    if (data.isLogin && data.username && data.username.startsWith('mem-')) {
      data.memberPoints = await getMemberPointsAuto(data.username);
    }
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/hotspot/logout', async (req, res) => {
  let { logoutLink } = req.body;
  try {
    if (!logoutLink) {
      try {
        const statusResp = await fetch(`http://${HOTSPOT_DNS}/status`, { signal: AbortSignal.timeout(5000) });
        const buffer = Buffer.from(await statusResp.arrayBuffer());
        const statusData = parseHotspotResponse(buffer);
        logoutLink = statusData.logoutLink;
        console.log('[Logout] Got link from status:', logoutLink);
      } catch (_) {}
    }
    if (!logoutLink) {
      logoutLink = `http://${HOTSPOT_DNS}/logout`;
    }

    const eraseUrl = logoutLink + (logoutLink.includes('?') ? '&' : '?') + 'erase-cookie=on';
    console.log('[Logout] Step 1 - POST with erase-cookie:', eraseUrl);
    const resp1 = await fetch(eraseUrl, { method: 'POST', signal: AbortSignal.timeout(5000) });
    const text1 = await resp1.text();
    console.log('[Logout] Step 1 response:', resp1.status, 'length:', text1.length);

    console.log('[Logout] Step 2 - GET logoutLink:', logoutLink);
    const resp2 = await fetch(logoutLink, { signal: AbortSignal.timeout(5000) });
    const text2 = await resp2.text();
    console.log('[Logout] Step 2 response:', resp2.status, 'length:', text2.length);

    console.log('[Logout] Step 3 - Verify status');
    try {
      const verifyResp = await fetch(`http://${HOTSPOT_DNS}/status`, { signal: AbortSignal.timeout(3000) });
      const verifyBuf = Buffer.from(await verifyResp.arrayBuffer());
      const verifyData = parseHotspotResponse(verifyBuf);
      console.log('[Logout] Verify - isLogin:', verifyData.isLogin, 'username:', verifyData.username);
    } catch (_) { console.log('[Logout] Verify failed'); }

    res.json({ success: true });
  } catch (err) {
    console.log('[Logout] Error:', err.message);
    res.json({ success: false, error: err.message });
  }
});


app.post('/api/hotspot/check-user', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ exists: false });

  try {
    const freshData = await fetchLoginData();
    const loginLink = freshData.loginLink || `http://${HOTSPOT_DNS}/login`;

    let loginPassword = username;
    const chapAvailable = freshData.chapIdHex && freshData.chapIdHex.length > 0 && freshData.chapChallengeHex && freshData.chapChallengeHex.length > 0;
    if (chapAvailable) {
      const chapIdBuf = Buffer.from(freshData.chapIdHex, 'hex');
      const challengeBuf = Buffer.from(freshData.chapChallengeHex, 'hex');
      const passwordBuf = Buffer.from(username, 'latin1');
      const combined = Buffer.concat([chapIdBuf, passwordBuf, challengeBuf]);
      loginPassword = crypto.createHash('md5').update(combined).digest('hex');
    }

    const postData = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(loginPassword)}&dst=&popup=true`;
    const loginResp = await fetch(loginLink, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: postData,
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });

    const respBuffer = Buffer.from(await loginResp.arrayBuffer());
    const data = parseHotspotResponse(respBuffer);
    console.log('[Check User]', username, '→ isLogin:', data.isLogin, 'error:', data.error);

    if (data.isLogin) {
      if (data.logoutLink) {
        try { await fetch(data.logoutLink, { signal: AbortSignal.timeout(3000) }); } catch (_) {}
      }
      return res.json({ exists: true });
    }

    const err = (data.error || '').toLowerCase();
    if (err.includes('already logged in') || err.includes('has reached') || err.includes('limit')) {
      return res.json({ exists: true });
    }

    res.json({ exists: false });
  } catch (err) {
    console.log('[Check User] Error:', err.message);
    res.json({ exists: false, checkFailed: true, error: 'Cannot reach hotspot to verify username' });
  }
});

app.post('/api/pisonet/check-member', async (req, res) => {
  const { username } = req.body;
  if (!username) return res.json({ exists: false, error: 'Username required' });
  try {
    const url = `http://${VENDO_IP}/pisonet/member?username=${encodeURIComponent(username)}`;
    console.log('[Pisonet] check-member:', url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await resp.text();
    console.log('[Pisonet] check-member response:', resp.status, text);
    let data;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    if (resp.ok && data && typeof data === 'object') {
      const hasUser = data.username || data.name || data.member;
      res.json({ exists: !!hasUser, data });
    } else if (resp.status === 404) {
      res.json({ exists: false });
    } else {
      res.json({ exists: false, checkFailed: true, raw: text });
    }
  } catch (err) {
    console.log('[Pisonet] check-member error:', err.message);
    res.json({ exists: false, checkFailed: true, error: 'Cannot reach vendo: ' + err.message });
  }
});

app.post('/api/pisonet/register', async (req, res) => {
  if (settings.isWithinCurfew()) {
    const s = settings.getSettings();
    return res.json({ success: false, error: 'Curfew active', code: 'CURFEW_ACTIVE', curfew: { start: s.curfewStart, end: s.curfewEnd } });
  }
  const { username, password, ip, mac } = req.body;
  if (!username) return res.json({ success: false, error: 'Username required' });
  try {
    const url = `http://${VENDO_IP}/pisonet/register`;
    const body = { macAddress: mac || '', ip: ip || '', username, password: password || username };
    console.log('[Pisonet] register:', url, JSON.stringify({ macAddress: body.macAddress, ip: body.ip, username: body.username }));
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await resp.text();
    console.log('[Pisonet] register response:', resp.status, text.substring(0, 500));
    let data;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    if (!resp.ok) {
      const fullText = (typeof data === 'object' && data !== null) ? JSON.stringify(data) : text;
      const errMsg = (typeof data === 'object' && data !== null) ? (data.message || data.error || data.errorCode || data.status || JSON.stringify(data)) : (text || 'Registration failed');
      console.log('[Pisonet] register FAILED - HTTP', resp.status, '- full data:', fullText);
      res.json({ success: false, error: errMsg, data });
    } else {
      const fullText = (typeof data === 'object' && data !== null) ? JSON.stringify(data) : text;

      if (typeof data === 'object' && data !== null) {
        if ((data.success === true || data.success === 'true') && !data.errorCode) {
          console.log('[Pisonet] register SUCCESS (vendo confirmed):', fullText);
          if (username && username.startsWith('mem-')) {
            recentRegistrations.set(username, { timestamp: Date.now(), ip: ip || '', mac: mac || '' });
            console.log('[Register] Tracking new registration for points:', username);
          }
          res.json({ success: true, data });
          return;
        }

        const errMsg = data.message || data.error || data.errorCode || '';
        const errStr = (typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)).toLowerCase();
        if (errMsg && errStr !== 'null') {
          console.log('[Pisonet] register HTTP 200 but vendo indicates failure:', fullText);
          res.json({ success: false, error: errMsg, data });
          return;
        }

        const dataValues = Object.values(data).map(v => (typeof v === 'string' ? v : '')).join(' ').toLowerCase();
        if (dataValues.includes('exist') || dataValues.includes('already') || dataValues.includes('duplicate') || dataValues.includes('registered') || dataValues.includes('fail')) {
          const msg = data.message || data.error || data.errorCode || JSON.stringify(data);
          console.log('[Pisonet] register HTTP 200 but response values indicate failure:', fullText);
          res.json({ success: false, error: msg || 'Registration failed', data });
          return;
        }
      }

      console.log('[Pisonet] register SUCCESS:', fullText);
      res.json({ success: true, data });
    }
  } catch (err) {
    console.log('[Pisonet] register error:', err.message);
    res.json({ success: false, error: 'Cannot reach vendo: ' + err.message });
  }
});

app.post('/api/vendo/test', async (req, res) => {
  const { method, endpoint, body } = req.body;
  try {
    const url = `http://${VENDO_IP}${endpoint}`;
    console.log(`[VendoTest] ${method} ${url}`, body ? JSON.stringify(body) : '');
    const opts = {
      method: method || 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
    };
    if (body && method !== 'GET') opts.body = JSON.stringify(body);
    const resp = await fetch(url, opts);
    const text = await resp.text();
    console.log(`[VendoTest] response ${resp.status}:`, text.substring(0, 2000));
    res.json({ status: resp.status, headers: Object.fromEntries(resp.headers), body: text });
  } catch (err) {
    console.log('[VendoTest] error:', err.message);
    res.json({ status: 0, error: err.message });
  }
});

app.post('/api/pisonet/logout', async (req, res) => {
  const { ip, mac, username } = req.body;
  try {
    const url = `http://${VENDO_IP}/pisonet/logout`;
    const body = { macAddress: mac || '', ip: ip || '', username: username || '' };
    console.log('[Pisonet] logout:', url, JSON.stringify(body));
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await resp.text();
    console.log('[Pisonet] logout response:', resp.status, text);
    try { res.json({ success: true, data: JSON.parse(text) }); }
    catch (_) { res.json({ success: true, data: text }); }
  } catch (err) {
    console.log('[Pisonet] logout error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/pisonet/avail', async (req, res) => {
  const { ip, mac, username } = req.body;
  try {
    const url = `http://${VENDO_IP}/pisonet/avail`;
    const body = { macAddress: mac || '', ip: ip || '' };
    console.log('[Pisonet] avail:', url, JSON.stringify(body));
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await resp.text();
    console.log('[Pisonet] avail response:', resp.status, text);

    if (username && username.startsWith('mem-')) {
      const key = `${ip || ''}|${mac || ''}`;
      activeCoinSessions.set(key, { username, ip, mac, startTime: Date.now(), totalCoin: 0, timeAdded: '' });
    }

    try {
      res.json({ success: true, data: JSON.parse(text) });
    } catch (_) {
      res.json({ success: true, data: text });
    }
  } catch (err) {
    console.log('[Pisonet] avail error:', err.message);
    res.json({ success: false, error: 'Cannot reach vendo: ' + err.message });
  }
});

app.post('/api/pisonet/done', async (req, res) => {
  const { ip, mac } = req.body;
  try {
    const url = `http://${VENDO_IP}/pisonet/done`;
    const body = { macAddress: mac || '', ip: ip || '' };
    console.log('[Pisonet] done:', url, JSON.stringify(body));
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await resp.text();
    console.log('[Pisonet] done response:', resp.status, text);

    const key = `${ip || ''}|${mac || ''}`;
    const session = activeCoinSessions.get(key);
    if (session && session.username && session.totalCoin > 0) {
      const now = Date.now();
      const cooldown = autoLogCooldowns.get(session.username) || 0;
      if (now > cooldown) {
        try {
          const s = settings.getSettings();
          const log = coinLogs.appendLog({
            username: session.username,
            amount: session.totalCoin,
            timeAdded: session.timeAdded,
            ip: session.ip,
            mac: session.mac,
            source: 'app'
          }, s.pointRates || []);
          console.log('[CoinLog] Recorded:', session.username, 'amount:', session.totalCoin, 'points:', log.points);
          syncCoinLog({ username: session.username, amount: session.totalCoin, timeAdded: session.timeAdded, ip: session.ip, mac: session.mac, source: 'app' });
          autoLogCooldowns.set(session.username, now + 20000);
          if (lastSessionData && lastSessionData.sessionTimeLeft) {
            lastAutoLoggedTime.set(session.username, parseInt(lastSessionData.sessionTimeLeft) || 0);
          }
          if (wsClients.size > 0) {
            scheduleImmediatePoll();
          }
        } catch (e) {
          console.log('[CoinLog] Error saving log:', e.message);
        }
      } else {
        console.log('[CoinLog] Skipped (cooldown active, already logged by auto-detection):', session.username);
      }
    }
    activeCoinSessions.delete(key);

    try {
      res.json({ success: true, data: JSON.parse(text) });
    } catch (_) {
      res.json({ success: true, data: text });
    }
  } catch (err) {
    console.log('[Pisonet] done error:', err.message);
    res.json({ success: false, error: 'Cannot reach vendo: ' + err.message });
  }
});

app.get('/api/vendo/check-coin', async (req, res) => {
  const { voucher, ip, mac } = req.query;
  try {
    const url = `http://${VENDO_IP}/checkCoin?voucher=${encodeURIComponent(voucher || '')}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const text = await resp.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      parsed = null;
    }

    if (parsed && ip && mac) {
      const key = `${ip}|${mac}`;
      const session = activeCoinSessions.get(key);
      if (session) {
        const coins = parseInt(parsed.totalCoinReceived, 10);
        if (!isNaN(coins) && coins > 0) session.totalCoin = coins;
        if (parsed.timeAdded) session.timeAdded = parsed.timeAdded;
      }
    }

    res.json({ success: true, data: parsed || text });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/vendo/topup', async (req, res) => {
  const { voucher, ip, mac, extendTime } = req.query;
  try {
    const params = new URLSearchParams();
    params.set('voucher', voucher || '');
    params.set('ipAddress', ip || '');
    params.set('mac', mac || '');
    params.set('extendTime', extendTime || '0');
    const url = `http://${VENDO_IP}/topUp?${params.toString()}`;
    console.log('[Vendo] topUp:', url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await resp.text();
    console.log('[Vendo] topUp response:', resp.status, text);
    let data;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    res.json({ success: true, data });
  } catch (err) {
    console.log('[Vendo] topUp error:', err.message);
    res.json({ success: false, error: 'Cannot reach vendo: ' + err.message });
  }
});

app.get('/api/vendo/use-voucher', async (req, res) => {
  const { voucher } = req.query;
  try {
    const url = `http://${VENDO_IP}/useVoucher?voucher=${encodeURIComponent(voucher || '')}`;
    console.log('[Vendo] useVoucher:', url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await resp.text();
    console.log('[Vendo] useVoucher response:', resp.status, text);
    let data;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    res.json({ success: true, data });
  } catch (err) {
    console.log('[Vendo] useVoucher error:', err.message);
    res.json({ success: false, error: 'Cannot reach vendo: ' + err.message });
  }
});

app.get('/api/vendo/cancel-topup', async (req, res) => {
  const { voucher, mac } = req.query;
  try {
    const url = `http://${VENDO_IP}/cancelTopUp?voucher=${encodeURIComponent(voucher || '')}&mac=${encodeURIComponent(mac || '')}`;
    console.log('[Vendo] cancelTopUp:', url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await resp.text();
    console.log('[Vendo] cancelTopUp response:', resp.status, text);
    let data;
    try { data = JSON.parse(text); } catch (_) { data = text; }
    res.json({ success: true, data });
  } catch (err) {
    console.log('[Vendo] cancelTopUp error:', err.message);
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/vendo/rates', async (req, res) => {
  try {
    const resp = await fetch(`http://${VENDO_IP}/getRates`, { signal: AbortSignal.timeout(5000) });
    const text = await resp.text();
    try {
      res.json({ success: true, data: JSON.parse(text) });
    } catch (_) {
      res.json({ success: true, data: text });
    }
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

let sessionEvent = null;

app.post('/api/session/trigger', (req, res) => {
  const { action } = req.body;
  console.log('[Session] Trigger received:', action);
  sessionEvent = action || null;
  res.json({ success: true });
});

app.get('/api/session/poll', (req, res) => {
  const evt = sessionEvent;
  if (evt) {
    console.log('[Session] Poll returning event:', evt);
    sessionEvent = null;
  }
  res.json({ event: evt });
});

const appRole = process.env.DENFI_APP_ROLE || 'auto-shutdown';
const coinLogsReadOnly = appRole !== 'points';

app.get('/api/admin/status', (req, res) => {
  const s = settings.getPublicSettings();
  res.json({ registered: settings.isAdminRegistered(), settings: s, appRole, coinLogsReadOnly });
});

app.get('/api/admin/settings-public', (req, res) => {
  const s = settings.getPublicSettings();
  res.json(s);
});

app.post('/api/admin/register', (req, res) => {
  if (settings.isAdminRegistered()) return res.json({ success: false, error: 'Already registered' });
  const { password } = req.body;
  if (!password || password.length < 4) return res.json({ success: false, error: 'Password must be at least 4 characters' });
  settings.registerAdmin(password);
  const token = generateToken();
  res.json({ success: true, token });
});

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) return res.status(429).json({ success: false, error: 'Too many attempts. Try again in 5 minutes.' });
  const { password } = req.body;
  if (!settings.verifyAdmin(password)) {
    recordFailedAttempt(ip);
    return res.json({ success: false, error: 'Wrong password' });
  }
  clearAttempts(ip);
  const token = generateToken();
  res.json({ success: true, token });
});

app.post('/api/admin/change-password', verifyToken, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 4) return res.json({ success: false, error: 'Password must be at least 4 characters' });
  if (!settings.changeAdminPassword(oldPassword, newPassword)) return res.json({ success: false, error: 'Wrong current password' });
  invalidateAllTokens();
  const token = generateToken();
  res.json({ success: true, token });
});

app.get('/api/admin/settings', verifyToken, (req, res) => {
  res.json({ success: true, settings: settings.getSettings() });
});

app.get('/api/admin/attendance-current', verifyToken, async (req, res) => {
  if (syncServerUrl && !(await syncAttendanceConfigFromServer())) {
    return res.status(503).json({ success: false, error: 'Could not load the current mission from Denfi Points. Try again when connected.' });
  }
  res.json({ success: true, settings: settings.getSettings() });
});

app.post('/api/admin/settings', verifyToken, (req, res) => {
  const body = req.body;
  delete body.attendanceEnabled;
  delete body.attendanceMode;
  delete body.attendanceMinutes;
  delete body.attendanceMinMinutes;
  delete body.attendanceMaxMinutes;
  delete body.attendanceTargetSeed;
  delete body.attendancePoints;
  delete body.wheel;
  if (coinLogsReadOnly) {
    delete body.coinRates;
    delete body.pointRates;
  }
  const updated = settings.updateSettings(body);
  broadcastSettings();
  res.json({ success: true, settings: updated });
});

function parseAttendanceInput(body) {
  const { enabled, mode, points } = body;
  const ranged = body.minMinutes !== undefined || body.maxMinutes !== undefined;
  const minMinutes = ranged ? body.minMinutes : body.minutes;
  const maxMinutes = ranged ? body.maxMinutes : body.minutes;
  if (typeof enabled !== 'boolean' || mode !== 'minutes' ||
      !Number.isInteger(minMinutes) || minMinutes < 1 || minMinutes > 1440 ||
      !Number.isInteger(maxMinutes) || maxMinutes < minMinutes || maxMinutes > 1440 ||
      !Number.isFinite(points) || points < 0 || points > 10000 ||
      Math.abs(Math.round(points * 100) - points * 100) > 1e-8) {
    return null;
  }
  return { enabled, mode, minMinutes, maxMinutes, points };
}

function attendanceUpdates(input) {
  return {
    attendanceEnabled: input.enabled, attendanceMode: input.mode,
    attendanceMinMinutes: input.minMinutes, attendanceMaxMinutes: input.maxMinutes,
    attendancePoints: input.points
  };
}

function missionMatches(expected, actual) {
  return expected && typeof expected === 'object' &&
    expected.enabled === actual.enabled && expected.mode === actual.mode &&
    expected.minMinutes === actual.minMinutes && expected.maxMinutes === actual.maxMinutes &&
    expected.minutes === actual.minutes && expected.points === actual.points &&
    expected.targetSeed === actual.targetSeed;
}

function authorizeKioskMission(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token && adminTokens.has(token) && adminTokens.get(token) >= Date.now()) return next();
  const localTest = process.env.NODE_ENV === 'test' && process.env.DENFI_TEST_DATA_DIR &&
    process.env.DENFI_LISTEN_HOST === '127.0.0.1';
  if ((isElectron || localTest) &&
      require('./src/trusted-lan').trustedLanPeer(req.socket.remoteAddress, undefined, {
        localAddress: req.socket.localAddress,
        subnet: process.env.DENFI_TRUSTED_KIOSK_SUBNET,
        // The two desktop apps can share a PC: their local IPC is loopback.
        allowLoopback: isElectron || localTest
      })) return next();
  return res.status(403).json({ success: false, error: 'This request requires the Denfi Points desktop server on the trusted shop network.' });
}

function requireLocalWheelPlayer(req, res, next) {
  const address = String(req.socket.remoteAddress || '');
  if (address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')) return next();
  return res.status(403).json({ success: false, error: 'The wheel can only be played at this kiosk.' });
}

async function fetchPointsWheel(route, options) {
  if (!syncServerUrl) throw new Error('Denfi Points is not connected. Betting is unavailable.');
  const response = await fetch(syncServerUrl + route, { ...options, signal: AbortSignal.timeout(8000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.success) {
    const error = new Error(data.error || 'Denfi Points is unavailable.');
    error.status = response.status;
    throw error;
  }
  return data;
}

function wheelErrorResponse(res, error, ambiguous = false) {
  const status = [400, 403, 404, 409, 429].includes(error.status) ? error.status : 503;
  return res.status(status).json({ success: false, error: error.status ? error.message :
    ambiguous
      ? 'Could not confirm the result from Denfi Points. Retry using the same spin request; do not start another spin.'
      : 'Denfi Points is unavailable. Reconnect and try again.' });
}

app.get('/api/admin/wheel', verifyToken, async (req, res) => {
  if (appRole === 'points') return res.json({ success: true, wheel: settings.getSettings().wheel,
    activeWheel: settings.getSettings().wheel, readOnly: true, connected: true });
  const saved = settings.getSettings();
  try {
    const remote = await fetchPointsWheel('/api/sync/wheel-config');
    const wheel = parseWheel(remote.wheel);
    if (!wheel) throw new Error('Denfi Points returned invalid betting settings.');
    // Never discard an explicitly saved offline draft when the server reconnects.
    res.json({ success: true, wheel: saved.wheelDraft || wheel, activeWheel:wheel,
      pointsSupportsPolicy: Number.isInteger(remote.wheel?.maxSpinsPerDay) &&
        typeof remote.wheel?.allowCustomStake === 'boolean',
      draft: !!saved.wheelDraft, connected: true });
  } catch (error) {
    res.json({ success: true, wheel: saved.wheelDraft || saved.wheel || defaultWheel(),
      activeWheel:null, draft: !!saved.wheelDraft, connected: false });
  }
});

app.post('/api/admin/kiosk-wheel', authorizeKioskMission, (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  const wheel = parseWheel(req.body);
  if (!wheel) return res.status(400).json({ success: false, error: 'Enter 1–12 distinct multipliers (0–100x), positive percentages and a total of exactly 100%.' });
  try {
    settings.updateSettings({ wheel });
    res.json({ success: true, wheel });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Denfi Points could not save the wheel.' });
  }
});

app.post('/api/admin/wheel', verifyToken, async (req, res) => {
  if (appRole !== 'auto-shutdown') return res.status(403).json({ success: false, error: 'Configure the wheel in Auto Shutdown.' });
  const wheel = parseWheel(req.body);
  if (!wheel) return res.status(400).json({ success: false, error: 'Enter 1–12 distinct multipliers (0–100x), positive percentages and a total of exactly 100%.' });
  if (req.body.mode === 'draft') {
    try {
      settings.updateSettings({ wheelDraft: wheel });
      return res.json({ success: true, wheel, draft: true, connected: false });
    } catch (error) {
      return res.status(500).json({ success: false, error: 'Could not save the local betting draft.' });
    }
  }
  try {
    // Older Points builds silently discard maxSpinsPerDay and allowCustomStake.
    // Check before writing so a successful-looking response cannot activate
    // odds while leaving the operator's stake policy at its defaults.
    const before = await fetchPointsWheel('/api/sync/wheel-config');
    if (!Number.isInteger(before.wheel?.maxSpinsPerDay) ||
        typeof before.wheel?.allowCustomStake !== 'boolean') {
      const error = new Error('Denfi Points is an older build. Update the Denfi Points .exe, reconnect it, then publish these betting settings again.');
      error.status = 409;
      throw error;
    }
    const data = await fetchPointsWheel('/api/admin/kiosk-wheel', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(wheel)
    });
    const confirmed = await fetchPointsWheel('/api/sync/wheel-config');
    const saved = parseWheel(confirmed.wheel);
    if (!saved || JSON.stringify(saved) !== JSON.stringify(wheel) ||
        JSON.stringify(data.wheel) !== JSON.stringify(wheel)) {
      const error = new Error('Denfi Points did not retain the new spin limit and stake policy. Update both .exe builds and publish again.');
      error.status = 409;
      throw error;
    }
    settings.updateSettings({ wheel: saved, wheelDraft: null });
    res.json({ success: true, wheel: saved, activeWheel:saved, draft: false, connected: true });
  } catch (error) {
    wheelErrorResponse(res, error);
  }
});

app.post('/api/admin/kiosk-attendance', authorizeKioskMission, (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  const input = parseAttendanceInput(req.body);
  if (!input) return res.status(400).json({ success: false, error: 'Use a 1–1440 minute range (minimum ≤ maximum) and 0–10000 points (up to 2 decimals).' });
  if (!missionMatches(req.body.expectedMission, attendanceConfig())) {
    return res.status(409).json({ success: false, error: 'The shared mission changed. Reload Attendance to review the latest settings before saving.' });
  }
  try {
    const updated = settings.updateSettings(attendanceUpdates(input));
    broadcastSettings();
    return res.json({ success: true, settings: updated });
  } catch (err) {
    console.error('[Attendance] Denfi Points mission save failed:', err.message);
    return res.status(500).json({ success: false, error: 'Denfi Points could not save the mission.' });
  }
});

app.post('/api/admin/attendance', verifyToken, async (req, res) => {
  if (appRole === 'points') {
    return res.status(403).json({ success: false, error: 'Change the shared mission in the Auto Shutdown admin panel.' });
  }
  const input = parseAttendanceInput(req.body);
  if (!input) return res.status(400).json({ success: false, error: 'Use a 1–1440 minute range (minimum ≤ maximum) and 0–10000 points (up to 2 decimals).' });
  const { enabled, mode, minMinutes, maxMinutes, points } = input;
  const expectedMission = req.body.expectedMission || attendanceConfig();
  if (!missionMatches(expectedMission, attendanceConfig())) {
    return res.status(409).json({ success: false, error: 'The shared mission changed on this kiosk. Reload Attendance before saving.' });
  }
  if (syncServerUrl) {
    const url = syncServerUrl;
    let attemptedRemoteSave = false;
    const mirrorSavedMission = (source) => {
      const saved = source.settings || source;
      const remote = {
        enabled: saved.attendanceEnabled ?? saved.enabled,
        mode: saved.attendanceMode ?? saved.mode,
        minMinutes: saved.attendanceMinMinutes ?? saved.minMinutes,
        maxMinutes: saved.attendanceMaxMinutes ?? saved.maxMinutes,
        minutes: saved.attendanceMinutes ?? saved.minutes,
        points: saved.attendancePoints ?? saved.points,
        targetSeed: saved.attendanceTargetSeed ?? saved.targetSeed
      };
      if (remote.enabled !== enabled || remote.mode !== mode ||
          remote.minMinutes !== minMinutes || remote.maxMinutes !== maxMinutes ||
          remote.points !== points || !Number.isInteger(remote.minutes) ||
          remote.minutes < minMinutes || remote.minutes > maxMinutes ||
          typeof remote.targetSeed !== 'string' ||
          (remote.targetSeed !== '' && !/^[0-9a-f]{32}$/.test(remote.targetSeed))) {
        return res.status(502).json({ success: false, error: 'Could not verify the mission saved on Denfi Points. Check the server before retrying.' });
      }
      attendanceConfigRevision++;
      try {
        const updated = settings.updateSettings({
          ...attendanceUpdates(input),
          attendanceMinutes: remote.minutes,
          attendanceTargetSeed: remote.targetSeed
        });
        broadcastSettings();
        return res.json({ success: true, settings: updated });
      } catch (err) {
        console.error('[Attendance] Denfi Points saved the mission but the kiosk cache failed:', err.message);
        return res.status(500).json({ success: false, error: 'Saved on Denfi Points, but this kiosk could not save its copy. Check local storage permissions.' });
      }
    };
    const reconcileRemoteSave = async () => {
      if (url !== syncServerUrl) {
        return res.status(409).json({ success: false, error: 'Connection changed; save outcome on the previous Denfi Points server is unknown. Check there before retrying.' });
      }
      try {
        const check = await fetch(url + '/api/sync/attendance-config', { signal: AbortSignal.timeout(3000) });
        if (!check.ok) throw new Error('Could not read back the mission');
        const saved = await check.json();
        if (saved.enabled === enabled && saved.mode === mode &&
            saved.minMinutes === minMinutes && saved.maxMinutes === maxMinutes &&
            saved.points === points) {
          return mirrorSavedMission(saved);
        }
      } catch (_) {
        return res.status(503).json({ success: false, error: 'Save outcome unknown. Check the mission on Denfi Points before retrying.' });
      }
      return res.status(503).json({ success: false, error: 'Could not verify the save; the mission on Denfi Points differs. Check it before retrying.' });
    };
    try {
      if (url !== syncServerUrl) {
        return res.status(409).json({ success: false, error: 'Denfi Points connection changed. Try again.' });
      }
      attemptedRemoteSave = true;
      const remoteResponse = await fetch(url + '/api/admin/kiosk-attendance', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, expectedMission }),
        signal: AbortSignal.timeout(5000)
      });
      if ([401, 403, 404].includes(remoteResponse.status)) {
        return res.status(502).json({ success: false, error: 'Denfi Points did not allow automatic mission changes. Update its desktop server and check that both computers are on the same trusted local network.' });
      }
      if (remoteResponse.status >= 500) return reconcileRemoteSave();
      const remote = await remoteResponse.json();
      if (!remoteResponse.ok || !remote.success) {
        return res.status(remoteResponse.status === 409 ? 409 : 502).json({
          success: false, error: remote.error || 'Denfi Points could not save attendance.'
        });
      }
      if (url !== syncServerUrl) {
        return res.status(409).json({ success: false, error: 'Saved on the previous Denfi Points server, but the connection changed. Check the current server.' });
      }
      return mirrorSavedMission(remote);
    } catch (err) {
      console.error('[Attendance] Could not save shared mission:', err.message);
      if (attemptedRemoteSave) return reconcileRemoteSave();
      return res.status(503).json({ success: false, error: 'Could not reach Denfi Points. Nothing was saved on this kiosk.' });
    }
  }
  const updated = settings.updateSettings(attendanceUpdates(input));
  broadcastSettings();
  res.json({ success: true, settings: updated });
});

app.post('/api/admin/products', verifyToken, (req, res) => {
  const name = String(req.body.name || '').trim();
  const price = Math.round(Number(req.body.price) * 100) / 100;
  if (!name || name.length > 60) return res.status(400).json({ success: false, error: 'Product name is required (max 60 characters)' });
  if (!Number.isFinite(price) || price <= 0 || price > 100000) return res.status(400).json({ success: false, error: 'Enter a valid price' });
  const current = settings.getSettings().products || [];
  if (current.length >= 50) return res.status(400).json({ success: false, error: 'Maximum 50 products' });
  const product = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name, price };
  const updated = settings.updateSettings({ products: [...current, product] });
  broadcastSettings();
  res.json({ success: true, products: updated.products });
});

app.delete('/api/admin/products/:id', verifyToken, (req, res) => {
  const current = settings.getSettings().products || [];
  const products = current.filter(product => product.id !== req.params.id);
  if (products.length === current.length) return res.status(404).json({ success: false, error: 'Product not found' });
  const updated = settings.updateSettings({ products });
  broadcastSettings();
  res.json({ success: true, products: updated.products });
});

app.get('/api/admin/telegram', verifyToken, (req, res) => {
  res.json({ success: true, telegram: settings.getTelegramAdminSettings() });
});

app.post('/api/admin/telegram', verifyToken, (req, res) => {
  try {
    const telegram = settings.updateTelegramSettings({
      botToken: req.body.botToken,
      channelId: req.body.channelId,
      clearToken: !!req.body.clearToken,
    });
    monthlyReportAttemptedPeriod = '';
    ensureMonthlyLeaderboardReport();
    void flushWheelNotifications();
    res.json({ success: true, telegram });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
});

app.post('/api/admin/telegram/test', verifyToken, async (req, res) => {
  const result = await sendTelegramMessage([
    'DENFI TELEGRAM TEST',
    '',
    'Your kiosk order notifications are configured.',
    `TIME: ${new Date().toLocaleString()}`,
  ].join('\n'));
  if (!result.sent) return res.status(400).json({ success: false, error: result.error });
  res.json({ success: true });
});

app.get('/api/admin/orders', verifyToken, (req, res) => {
  res.json({ success: true, orders: orderStore.getOrders() });
});

app.patch('/api/admin/orders/:id', verifyToken, (req, res) => {
  const status = String(req.body.status || '');
  if (!['pending', 'served', 'cancelled'].includes(status)) return res.status(400).json({ success: false, error: 'Invalid order status' });
  const order = orderStore.updateOrderStatus(req.params.id, status);
  if (!order) return res.status(404).json({ success: false, error: 'Order not found' });
  res.json({ success: true, order });
});

app.delete('/api/admin/orders/:id', verifyToken, (req, res) => {
  if (!orderStore.deleteOrder(req.params.id)) return res.status(404).json({ success: false, error: 'Order not found' });
  res.json({ success: true });
});

app.get('/api/session/store', (req, res) => {
  res.json({ success: true, products: settings.getSettings().products || [] });
});

app.post('/api/session/orders', (req, res) => {
  const remoteAddress = String(req.socket.remoteAddress || '');
  const isLoopback = remoteAddress === '::1' || remoteAddress === '127.0.0.1' ||
    remoteAddress.startsWith('127.') || remoteAddress.startsWith('::ffff:127.');
  if (!isLoopback) return res.status(403).json({ success: false, error: 'Orders can only be placed from this kiosk' });
  const requestKey = remoteAddress;
  const now = Date.now();
  if ((recentOrderRequests.get(requestKey) || 0) > now - 5000) {
    return res.status(429).json({ success: false, error: 'Please wait before placing another order' });
  }
  recentOrderRequests.set(requestKey, now);
  setTimeout(() => recentOrderRequests.delete(requestKey), 6000).unref();
  resolveActiveHotspotSession().then(async session => {
    if (!session || !session.username) return res.status(401).json({ success: false, error: 'No active paid session found' });
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
  const productMap = new Map((settings.getSettings().products || []).map(product => [product.id, product]));
  const items = [];
  let totalQuantity = 0;
  for (const requested of requestedItems.slice(0, 20)) {
    const product = productMap.get(String(requested.id || ''));
    const quantity = Math.max(1, Math.min(10, parseInt(requested.quantity, 10) || 1));
    if (!product) continue;
    if (totalQuantity + quantity > 20) return res.status(400).json({ success: false, error: 'Maximum 20 items per order' });
    totalQuantity += quantity;
    items.push({ id: product.id, name: product.name, price: product.price, quantity });
  }
  if (!items.length) return res.status(400).json({ success: false, error: 'Your order is empty' });
  const total = Math.round(items.reduce((sum, item) => sum + item.price * item.quantity, 0) * 100) / 100;
  const order = orderStore.createOrder({
    username: session.username,
    station: session.pc || settings.getSettings().computerName || 'PC',
    items,
    total,
  });
  const telegramSent = await sendTelegramOrderNotification(order, session);
  res.json({ success: true, order, telegramSent });
  }).catch(error => {
    console.log('[Orders] Session validation failed:', error.message);
    if (!res.headersSent) res.status(503).json({ success: false, error: 'Could not verify the active session' });
  });
});

async function resolveActiveHotspotSession() {
  const response = await fetch(`http://${HOTSPOT_DNS}/status`, { signal: AbortSignal.timeout(5000) });
  const data = parseHotspotResponse(Buffer.from(await response.arrayBuffer()));
  if (!data.isLogin) return null;
  const settingsNow = settings.getSettings();
  const pc = data.units && data.ip && data.units[data.ip]
    ? data.units[data.ip]
    : settingsNow.pisonetUnitName || settingsNow.computerName || 'PC';
  return {
    username: String(data.username || '').trim().slice(0, 80),
    timeLeft: Math.max(0, parseInt(data.sessionTimeLeft, 10) || 0),
    pc: String(pc).slice(0, 80),
  };
}

function formatSessionTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const secs = value % 60;
  return [hours, minutes, secs].map(part => String(part).padStart(2, '0')).join(':');
}

async function sendTelegramOrderNotification(order, session) {
  const itemLines = order.items.map(item =>
    `- ${item.name} x${item.quantity} — ₱${(item.price * item.quantity).toFixed(2)}`
  );
  const text = [
    'NEW KIOSK ORDER',
    '',
    `PC: ${order.station}`,
    `USERNAME: ${order.username}`,
    `TIME LEFT: ${formatSessionTime(session.timeLeft)}`,
    `ORDER TIME: ${new Date(order.createdAt).toLocaleString()}`,
    '',
    ...itemLines,
    '',
    `TOTAL: ₱${Number(order.total).toFixed(2)}`,
  ].join('\n');
  const result = await sendTelegramMessage(text);
  return result.sent;
}

async function sendTelegramMessage(text) {
  const telegram = settings.getTelegramSettings();
  if (!telegram.botToken || !telegram.channelId) {
    return { sent: false, error: 'Telegram bot token and channel ID are not configured' };
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: telegram.channelId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      let detail = `Telegram returned HTTP ${response.status}`;
      try {
        const failure = await response.json();
        if (failure.description) detail += `: ${failure.description}`;
      } catch (_) {}
      console.log('[Telegram] Message failed:', detail);
      return { sent: false, error: detail };
    }
    const result = await response.json();
    if (!result.ok) {
      console.log('[Telegram] Order notification rejected:', result.description || 'unknown error');
      return { sent: false, error: result.description || 'Telegram rejected the message' };
    }
    console.log('[Telegram] Message sent');
    return { sent: true };
  } catch (error) {
    console.log('[Telegram] Order notification error:', error.message);
    return { sent: false, error: 'Could not reach Telegram: ' + error.message };
  }
}

let wheelNotificationInFlight = false;
async function flushWheelNotifications() {
  if (wheelNotificationInFlight || appRole !== 'auto-shutdown' || !syncServerUrl) return null;
  const telegram = settings.getTelegramSettings();
  if (!telegram.botToken || !telegram.channelId) return null;
  wheelNotificationInFlight = true;
  try {
    const { claim } = await fetchPointsWheel('/api/sync/wheel/claim-notification', { method: 'POST' });
    if (!claim) return null;
    const { spin, leaseToken } = claim;
    const value = amount => Number(amount).toFixed(2) + ' pts';
    const lines = [
      'DENFI POINTS  /  BETTING GAMES',
      '━━━━━━━━━━━━━━━━━━━━',
      Number(spin.multiplier) === 0 ? 'RESULT  ·  LOSE' : `RESULT  ·  ${spin.multiplier}×`,
      '',
      `Member       ${spin.username}`,
      `Station      ${spin.station || 'PC'}`,
      `Stake        ${value(spin.stake)}`,
      `Payout       ${value(spin.payout)}`,
      `Net          ${spin.net >= 0 ? '+' : ''}${value(spin.net)}`,
      `New balance  ${value(spin.balance)}`,
      `Played       ${new Date(spin.createdAt).toLocaleString()}`,
      '━━━━━━━━━━━━━━━━━━━━',
      'Stake follows the saved Betting Games policy on Denfi Points.'
    ];
    const result = await sendTelegramMessage(lines.join('\n'));
    if (!result.sent) {
      console.log('[Wheel] Telegram delivery pending:', result.error);
      return null;
    }
    await fetchPointsWheel('/api/sync/wheel/ack-notification', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestId: spin.requestId, leaseToken })
    });
    return spin.requestId;
  } catch (error) {
    console.log('[Wheel] Notification retry pending:', error.message);
    return null;
  } finally {
    wheelNotificationInFlight = false;
  }
}
setInterval(() => { void flushWheelNotifications(); }, 15000).unref();

async function ensureMonthlyLeaderboardReport() {
  const currentPeriod = coinLogs.getCurrentPeriodKey();
  const currentSettings = settings.getSettings();
  if (currentSettings.monthlyLeaderboardReportedPeriod === currentPeriod) {
    monthlyReportAttemptedPeriod = currentPeriod;
    return;
  }
  if (monthlyReportAttemptedPeriod === currentPeriod) return;
  monthlyReportAttemptedPeriod = currentPeriod;

  const previousPeriod = coinLogs.getPreviousPeriodKey(currentPeriod);
  const topFive = coinLogs.getLeaderboard(5, currentSettings.pointRates || [], previousPeriod);
  if (!topFive.length) {
    settings.updateSettings({ monthlyLeaderboardReportedPeriod: currentPeriod });
    return;
  }

  const lines = topFive.map((member, index) =>
    `${index + 1}. ${member.username} — ${Number(member.points).toFixed(2)} POINTS`
  );
  const text = [
    'DENFI MONTHLY POINTS RESET',
    '',
    `FINAL TOP 5 — ${previousPeriod}`,
    ...lines,
    '',
    `NEW MONTH STARTED — ${currentPeriod}`,
    `RESET TIME: ${new Date().toLocaleString()}`,
  ].join('\n');
  const result = await sendTelegramMessage(text);
  if (result.sent) {
    settings.updateSettings({ monthlyLeaderboardReportedPeriod: currentPeriod });
    console.log('[Telegram] Monthly points report sent for', previousPeriod);
  } else {
    console.log('[Telegram] Monthly points report pending:', result.error);
  }
}

function leaderboardFromLogs(logs, limit, periodKey) {
  const totals = {};
  for (const log of Array.isArray(logs) ? logs : []) {
    const username = String(log.username || '').trim();
    const points = Number(log.points) || 0;
    if (!username || coinLogs.getPeriodKey(log.timestamp) !== periodKey) continue;
    totals[username] = (totals[username] || 0) + points;
  }
  return Object.entries(totals)
    .map(([username, points]) => ({ username, points: Math.round(points * 100) / 100 }))
    .filter(member => member.points > 0)
    .sort((a, b) => b.points - a.points || a.username.localeCompare(b.username))
    .slice(0, limit);
}

async function getSessionLeaderboard() {
  const period = coinLogs.getCurrentPeriodKey();
  let syncError = '';
  if (syncServerUrl) {
    try {
      const response = await fetch(syncServerUrl + '/api/sync/leaderboard', { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.leaderboard) &&
            data.leaderboard.every(entry => entry && entry.points !== undefined)) {
          return { leaderboard: data.leaderboard.slice(0, 5), source: 'denfi-points', period };
        }
        syncError = 'Denfi Points returned a leaderboard without converted points';
      } else {
        syncError = `Denfi Points returned HTTP ${response.status}`;
      }
    } catch (error) {
      syncError = error.message;
      console.log('[Sync] Failed to fetch leaderboard:', error.message);
    }

    // Support older Denfi Points builds that expose the raw coin log endpoint
    // but do not yet expose /api/sync/leaderboard.
    try {
      const response = await fetch(syncServerUrl + '/api/sync/coin-logs', { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.logs)) {
           return { leaderboard: leaderboardFromLogs(data.logs, 5, period), source: 'denfi-points-coin-logs', period };
        }
      }
    } catch (error) {
      console.log('[Sync] Failed to fetch remote coin logs for ranking:', error.message);
    }
  }
  return {
    leaderboard: [],
    source: 'unavailable',
    period,
    syncConnected: false,
    syncError
  };
}

app.get('/api/session/leaderboard', async (req, res) => {
  const result = await getSessionLeaderboard();
  res.json({ success: true, ...result });
});

app.post('/api/admin/background', verifyToken, (req, res) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('application/octet-stream') && !contentType.startsWith('image/') && !contentType.startsWith('video/')) {
    return res.status(400).json({ success: false, error: 'Invalid content type' });
  }
  const filename = req.headers['x-filename'] || 'background.png';
  const mime = req.headers['x-mime-type'] || 'image/png';
  const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'video/mp4', 'video/webm'];
  if (!allowed.includes(mime)) return res.status(400).json({ success: false, error: 'Only PNG, JPEG, GIF, WebP, MP4, WebM allowed' });

  const chunks = [];
  let totalSize = 0;
  req.on('data', (chunk) => {
    totalSize += chunk.length;
    if (totalSize > 50 * 1024 * 1024) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (totalSize > 50 * 1024 * 1024) return res.status(400).json({ success: false, error: 'File too large (max 50MB)' });
    const buffer = Buffer.concat(chunks);
    const meta = settings.saveBackgroundImage(buffer, filename, mime);
    broadcastSettings();
    res.json({ success: true, background: meta });
  });
});

app.delete('/api/admin/background', verifyToken, (req, res) => {
  settings.removeBackgroundImage();
  broadcastSettings();
  res.json({ success: true });
});

app.post('/api/admin/login-image', verifyToken, (req, res) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('application/octet-stream') && !contentType.startsWith('image/')) {
    return res.status(400).json({ success: false, error: 'Invalid content type' });
  }
  const filename = req.headers['x-filename'] || 'loginimage.png';
  const mime = req.headers['x-mime-type'] || 'image/png';
  const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  if (!allowed.includes(mime)) return res.status(400).json({ success: false, error: 'Only PNG, JPEG, GIF, WebP allowed' });

  const chunks = [];
  let totalSize = 0;
  req.on('data', (chunk) => {
    totalSize += chunk.length;
    if (totalSize > 50 * 1024 * 1024) { req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (totalSize > 50 * 1024 * 1024) return res.status(400).json({ success: false, error: 'File too large (max 50MB)' });
    const buffer = Buffer.concat(chunks);
    const meta = settings.saveLoginImage(buffer, filename, mime);
    broadcastSettings();
    res.json({ success: true, loginImage: meta });
  });
});

app.delete('/api/admin/login-image', verifyToken, (req, res) => {
  settings.removeLoginImage();
  broadcastSettings();
  res.json({ success: true });
});

app.post('/api/admin/register-image', verifyToken, (req, res) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('application/octet-stream') && !contentType.startsWith('image/')) {
    return res.status(400).json({ success: false, error: 'Invalid content type' });
  }
  const filename = req.headers['x-filename'] || 'registerimage.png';
  const mime = req.headers['x-mime-type'] || 'image/png';
  const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  if (!allowed.includes(mime)) return res.status(400).json({ success: false, error: 'Only PNG, JPEG, GIF, WebP allowed' });

  const chunks = [];
  let totalSize = 0;
  req.on('data', (chunk) => {
    totalSize += chunk.length;
    if (totalSize > 50 * 1024 * 1024) { req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (totalSize > 50 * 1024 * 1024) return res.status(400).json({ success: false, error: 'File too large (max 50MB)' });
    const buffer = Buffer.concat(chunks);
    const meta = settings.saveRegisterImage(buffer, filename, mime);
    broadcastSettings();
    res.json({ success: true, registerImage: meta });
  });
});

app.delete('/api/admin/register-image', verifyToken, (req, res) => {
  settings.removeRegisterImage();
  broadcastSettings();
  res.json({ success: true });
});

app.post('/api/admin/swap-panel-images', verifyToken, (req, res) => {
  const result = settings.swapPanelImages();
  if (!result) return res.json({ success: false, error: 'No images to swap' });
  broadcastSettings();
  res.json({ success: true, loginImage: result.loginImage, registerImage: result.registerImage });
});

app.get('/api/admin/ads', verifyToken, (req, res) => {
  res.json({ success: true, ads: settings.getAds() });
});

app.post('/api/admin/ads', verifyToken, (req, res) => {
  const { content } = req.body;
  const ad = settings.addAd(content || '', null);
  broadcastSettings();
  res.json({ success: true, ad });
});

app.put('/api/admin/ads/:id', verifyToken, (req, res) => {
  const { content } = req.body;
  const ad = settings.updateAd(req.params.id, { content });
  if (!ad) return res.status(404).json({ success: false, error: 'Ad not found' });
  broadcastSettings();
  res.json({ success: true, ad });
});

app.delete('/api/admin/ads/:id', verifyToken, (req, res) => {
  const ok = settings.removeAd(req.params.id);
  if (!ok) return res.status(404).json({ success: false, error: 'Ad not found' });
  broadcastSettings();
  res.json({ success: true });
});

app.post('/api/admin/ads/reorder', verifyToken, (req, res) => {
  const { orderedIds } = req.body;
  if (!Array.isArray(orderedIds)) return res.status(400).json({ success: false, error: 'orderedIds required' });
  const ads = settings.reorderAds(orderedIds);
  broadcastSettings();
  res.json({ success: true, ads });
});

app.post('/api/admin/ads/:id/image', verifyToken, (req, res) => {
  const adId = req.params.id;
  if (!settings.adExists(adId)) return res.status(404).json({ success: false, error: 'Ad not found' });
  const filename = req.headers['x-filename'] || 'ad.png';
  const mime = req.headers['x-mime-type'] || 'image/png';
  const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  if (!allowed.includes(mime)) return res.status(400).json({ success: false, error: 'Only PNG, JPEG, GIF, WebP allowed' });

  const chunks = [];
  let totalSize = 0;
  req.on('data', (chunk) => {
    totalSize += chunk.length;
    if (totalSize > 50 * 1024 * 1024) { req.destroy(); return; }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (totalSize > 50 * 1024 * 1024) return res.status(400).json({ success: false, error: 'File too large (max 50MB)' });
    const buffer = Buffer.concat(chunks);
    const imageInfo = settings.saveAdImage(adId, buffer, filename, mime);
    const ad = settings.updateAd(adId, { image: imageInfo });
    if (!ad) return res.status(404).json({ success: false, error: 'Ad not found' });
    broadcastSettings();
    res.json({ success: true, ad });
  });
});

app.post('/api/admin/stop-app', verifyToken, (req, res) => {
  res.json({ success: true });
  setTimeout(() => {
    process.emit('admin-stop-app');
    setTimeout(() => {
      try { process.exit(0); } catch (e) {}
    }, 5000);
  }, 500);
});

app.get('/api/admin/coin-logs', verifyToken, async (req, res) => {
  if (syncServerUrl) {
    try {
      const params = new URLSearchParams();
      if (req.query.username) params.set('username', req.query.username);
      if (req.query.from) params.set('from', req.query.from);
      if (req.query.to) params.set('to', req.query.to);
      const qs = params.toString() ? '?' + params.toString() : '';
      const resp = await fetch(syncServerUrl + '/api/sync/coin-logs' + qs, {
        signal: AbortSignal.timeout(5000)
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data.coinRates) || Array.isArray(data.pointRates)) {
          const rateUpdates = {};
          if (Array.isArray(data.coinRates)) rateUpdates.coinRates = data.coinRates;
          if (Array.isArray(data.pointRates)) rateUpdates.pointRates = data.pointRates;
          settings.updateSettings(rateUpdates);
        }
        return res.json(data);
      }
    } catch (e) {
      console.log('[Sync] Failed to fetch coin logs from server:', e.message);
    }
  }
  const { username, from, to } = req.query;
  const s = settings.getSettings();
  const currentRates = s.pointRates || [];
  const result = coinLogs.getLogs({ username, from, to }, currentRates);
  const hasFilters = username || from || to;
  let filteredPoints = result.memberPoints;
  if (hasFilters) {
    filteredPoints = {};
    (result.logs || []).forEach(l => {
      if (l.username) filteredPoints[l.username] = parseFloat(((filteredPoints[l.username] || 0) + (l.points || 0)).toFixed(2));
    });
  }
  res.json({
    success: true,
    logs: result.logs,
    memberPoints: filteredPoints,
    coinRates: s.coinRates || [],
    pointRates: currentRates
  });
});

function blockIfReadOnly(req, res, next) {
  if (coinLogsReadOnly) return res.status(403).json({ success: false, error: 'Read-only mode. Use Denfi Points to manage coin logs.' });
  next();
}

app.delete('/api/admin/coin-logs/:id', verifyToken, blockIfReadOnly, (req, res) => {
  const deleted = coinLogs.deleteLog(req.params.id);
  if (!deleted) return res.status(404).json({ success: false, error: 'Log not found' });
  res.json({ success: true });
});

app.delete('/api/admin/coin-logs/member/:username', verifyToken, blockIfReadOnly, (req, res) => {
  const username = decodeURIComponent(req.params.username);
  const deleted = coinLogs.deleteMemberLogs(username);
  if (!deleted) return res.status(404).json({ success: false, error: 'No logs found for member' });
  res.json({ success: true });
});

app.delete('/api/admin/coin-logs', verifyToken, blockIfReadOnly, (req, res) => {
  coinLogs.clearAllLogs();
  res.json({ success: true });
});

app.post('/api/admin/coin-rates', verifyToken, blockIfReadOnly, (req, res) => {
  const { pesos, minutes } = req.body;
  const p = parseInt(pesos);
  const m = parseInt(minutes);
  if (!p || p < 1 || !m || m < 1) return res.json({ success: false, error: 'Invalid pesos or minutes' });
  const s = settings.getSettings();
  const rates = s.coinRates || [];
  rates.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), pesos: p, minutes: m });
  settings.updateSettings({ coinRates: rates });
  res.json({ success: true, coinRates: rates });
});

app.delete('/api/admin/coin-rates/:id', verifyToken, blockIfReadOnly, (req, res) => {
  const s = settings.getSettings();
  const rates = (s.coinRates || []).filter(r => r.id !== req.params.id);
  settings.updateSettings({ coinRates: rates });
  res.json({ success: true, coinRates: rates });
});

app.post('/api/admin/point-rates', verifyToken, blockIfReadOnly, (req, res) => {
  const { pesos, points } = req.body;
  const p = parseInt(pesos);
  const pts = parseInt(points);
  if (!p || p < 1 || !pts || pts < 1) return res.json({ success: false, error: 'Invalid pesos or points' });
  const s = settings.getSettings();
  const rates = s.pointRates || [];
  rates.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), pesos: p, points: pts });
  settings.updateSettings({ pointRates: rates });
  coinLogs.recalcAllPoints(rates);
  res.json({ success: true, pointRates: rates });
});

app.delete('/api/admin/point-rates/:id', verifyToken, blockIfReadOnly, (req, res) => {
  const s = settings.getSettings();
  const rates = (s.pointRates || []).filter(r => r.id !== req.params.id);
  settings.updateSettings({ pointRates: rates });
  coinLogs.recalcAllPoints(rates);
  res.json({ success: true, pointRates: rates });
});

function broadcastSettings() {
  const s = settings.getPublicSettings();
  const msg = JSON.stringify({ type: 'settings', data: s });
  for (const ws of wsClients) {
    try { if (ws.readyState === 1) ws.send(msg); } catch (e) {}
  }
}

let syncServerUrl = '';
let syncRatesInterval = null;
let attendanceConfigInterval = null;
let attendanceConfigRevision = 0;
let attendanceConfigReady = false;

function setSyncServer(url, persist) {
  attendanceConfigRevision++;
  attendanceConfigReady = false;
  syncServerUrl = (url || '').trim().replace(/\/+$/, '');
  if (syncRatesInterval) { clearInterval(syncRatesInterval); syncRatesInterval = null; }
  if (attendanceConfigInterval) { clearInterval(attendanceConfigInterval); attendanceConfigInterval = null; }
  if (persist) {
    settings.updateSettings({ syncServerUrl });
    if (isElectron && appRole === 'auto-shutdown') {
      try { require('./src/connection-hint').writeHint(syncServerUrl); }
      catch (err) { console.log('[Sync] Could not preserve Points address across reinstall:', err.message); }
    }
  }
  if (syncServerUrl) {
    console.log('[Sync] Data server URL:', syncServerUrl);
    syncRatesFromServer();
    syncRatesInterval = setInterval(syncRatesFromServer, 5 * 60 * 1000);
    const attendanceReady = syncAttendanceConfigFromServer();
    attendanceConfigInterval = setInterval(syncAttendanceConfigFromServer, 3000);
    return attendanceReady;
  }
}

async function syncAttendanceConfigFromServer() {
  if (!syncServerUrl) return false;
  const revision = attendanceConfigRevision;
  try {
    const remote = await fetchAttendance('/api/sync/attendance-config');
    if (revision !== attendanceConfigRevision || !syncServerUrl) return false;
    if (typeof remote.enabled !== 'boolean' || remote.mode !== 'minutes' ||
        !Number.isInteger(remote.minutes) || remote.minutes < 1 || remote.minutes > 1440 ||
        !Number.isInteger(remote.minMinutes) || remote.minMinutes < 1 ||
        !Number.isInteger(remote.maxMinutes) || remote.maxMinutes < remote.minMinutes || remote.maxMinutes > 1440 ||
        remote.minutes < remote.minMinutes || remote.minutes > remote.maxMinutes ||
        typeof remote.targetSeed !== 'string' ||
        (remote.targetSeed !== '' && !/^[0-9a-f]{32}$/.test(remote.targetSeed)) ||
        !Number.isFinite(remote.points) || remote.points < 0 || remote.points > 10000 ||
        Math.abs(Math.round(remote.points * 100) - remote.points * 100) > 1e-8) {
      throw new Error('Invalid attendance mission from Denfi Points');
    }
    const current = settings.getSettings();
    if (current.attendanceEnabled !== remote.enabled || current.attendanceMode !== remote.mode ||
        current.attendanceMinutes !== remote.minutes ||
        current.attendanceMinMinutes !== remote.minMinutes ||
        current.attendanceMaxMinutes !== remote.maxMinutes ||
        current.attendanceTargetSeed !== remote.targetSeed ||
        current.attendancePoints !== remote.points) {
      settings.updateSettings({
        attendanceEnabled: remote.enabled, attendanceMode: remote.mode,
        attendanceMinutes: remote.minutes, attendanceMinMinutes: remote.minMinutes,
        attendanceMaxMinutes: remote.maxMinutes, attendanceTargetSeed: remote.targetSeed,
        attendancePoints: remote.points
      });
      broadcastSettings();
    }
    attendanceConfigReady = true;
    return true;
  } catch (err) {
    if (revision === attendanceConfigRevision) attendanceConfigReady = false;
    console.log('[Attendance] Config sync unavailable:', err.message);
    return false;
  }
}

async function fetchAttendance(route, sample = null) {
  const method = sample === null ? 'GET' : 'POST';
  const resp = await fetch(syncServerUrl + route, {
    method,
    headers: sample === null ? undefined : { 'Content-Type': 'application/json' },
    body: sample === null ? undefined : JSON.stringify(sample),
    signal: AbortSignal.timeout(3000)
  });
  if (!resp.ok) throw new Error(`Denfi Points returned ${resp.status}`);
  return resp.json();
}

async function getDefaultGateway() {
  const { exec } = require('child_process');
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? 'route print 0.0.0.0 | findstr /R "0\\.0\\.0\\.0.*[0-9]"'
      : "ip route show default 2>/dev/null || route -n 2>/dev/null | grep '^0.0.0.0'";
    exec(cmd, { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) return resolve(null);
      const ipMatch = stdout.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g);
      if (isWin && ipMatch && ipMatch.length >= 3) {
        return resolve(ipMatch[2]);
      }
      if (!isWin && ipMatch && ipMatch.length >= 1) {
        for (const ip of ipMatch) {
          if (ip !== '0.0.0.0') return resolve(ip);
        }
      }
      resolve(null);
    });
  });
}

async function probePointsServer(ip) {
  const url = `http://${ip}:5000`;
  try {
    const resp = await fetch(url + '/api/admin/status', { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data.appRole === 'points') return url;
    }
  } catch (e) {}
  return null;
}

function isLoopbackPointsUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch (_) {
    return false;
  }
}

async function findLocalPointsServer() {
  const os = require('os');
  const networks = os.networkInterfaces();
  const { trustedLanPeer } = require('./src/trusted-lan');
  for (const net of Object.values(networks).flat()) {
    if (!net || net.family !== 'IPv4' || net.internal ||
        !trustedLanPeer(net.address, networks, {
          localAddress: net.address,
          subnet: process.env.DENFI_TRUSTED_KIOSK_SUBNET
        })) continue;
    const found = await probePointsServer(net.address);
    if (found) return found;
  }
  return null;
}

async function discoverPointsServer() {
  const savedUrl = settings.getSettings().syncServerUrl;
  if (savedUrl) {
    if (isElectron && isLoopbackPointsUrl(savedUrl)) {
      const localAddress = await findLocalPointsServer();
      if (localAddress) return localAddress;
    } else {
      const ok = await probePointsServer(new URL(savedUrl).hostname);
      if (ok) return savedUrl;
    }
  }

  if (isElectron) {
    const localAddress = await findLocalPointsServer();
    if (localAddress) return localAddress;
  }

  const gateway = await getDefaultGateway();
  if (gateway) {
    console.log('[Sync] Trying gateway:', gateway);
    const found = await probePointsServer(gateway);
    if (found) return found;
  }

  const os = require('os');
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        const parts = net.address.split('.');
        const baseIp = parts.slice(0, 3).join('.');
        const myLast = parseInt(parts[3]);
        const candidates = [1, 254, 2, 100];
        for (const c of candidates) {
          if (c === myLast) continue;
          const ip = baseIp + '.' + c;
          if (gateway && ip === gateway) continue;
          const found = await probePointsServer(ip);
          if (found) return found;
        }
      }
    }
  }

  if (!isElectron) {
    const localhost = await probePointsServer('127.0.0.1');
    if (localhost) return localhost;
  }

  return null;
}

app.get('/api/admin/sync-server', verifyToken, (req, res) => {
  res.json({
    success: true,
    syncServerUrl: syncServerUrl || '',
    saved: settings.getSettings().syncServerUrl || '',
    connected: !!syncServerUrl
  });
});

app.post('/api/admin/sync-server', verifyToken, express.json(), async (req, res) => {
  let url = (req.body.url || '').trim().replace(/\/+$/, '');
  if (!url) {
    setSyncServer('', true);
    return res.json({ success: true, syncServerUrl: '', connected: false });
  }
  if (!/^https?:\/\//i.test(url)) url = 'http://' + url;
  try {
    if (isElectron && isLoopbackPointsUrl(url)) {
      const localAddress = await findLocalPointsServer();
      if (!localAddress) return res.json({ success: false, error: 'Use the Denfi Points computer’s private LAN address. A localhost connection cannot securely save the shared mission.' });
      url = localAddress;
    }
    const resp = await fetch(url + '/api/admin/status', { signal: AbortSignal.timeout(3000) });
    if (resp.ok) {
      const data = await resp.json();
      if (data.appRole === 'points') {
        await setSyncServer(url, true);
        return res.json({ success: true, syncServerUrl: url, connected: true });
      }
      return res.json({ success: false, error: 'Server found but it is not Denfi Points (appRole: ' + data.appRole + ')' });
    }
    return res.json({ success: false, error: 'Server responded with status ' + resp.status });
  } catch (e) {
    return res.json({ success: false, error: 'Cannot connect: ' + e.message });
  }
});

app.post('/api/admin/sync-server/detect', verifyToken, async (req, res) => {
  try {
    const found = await discoverPointsServer();
    if (found) {
      await setSyncServer(found, true);
      return res.json({ success: true, syncServerUrl: found, connected: true });
    }
    return res.json({ success: false, error: 'No Denfi Points server found on network' });
  } catch (e) {
    return res.json({ success: false, error: e.message });
  }
});

async function syncRatesFromServer() {
  if (!syncServerUrl) return;
  try {
    const resp = await fetch(syncServerUrl + '/api/sync/rates', {
      signal: AbortSignal.timeout(5000)
    });
    if (resp.ok) {
      const data = await resp.json();
      const updates = {};
      if (Array.isArray(data.coinRates)) updates.coinRates = data.coinRates;
      if (Array.isArray(data.pointRates)) updates.pointRates = data.pointRates;
      if (Object.keys(updates).length > 0) {
        settings.updateSettings(updates);
        console.log('[Sync] Rates synced from server — coinRates:', (updates.coinRates || []).length, 'pointRates:', (updates.pointRates || []).length);
      }
    }
  } catch (e) {
    console.log('[Sync] Failed to sync rates:', e.message);
  }
}

async function fetchRemotePoints(username) {
  if (!syncServerUrl) return null;
  try {
    const resp = await fetch(syncServerUrl + '/api/sync/member-points/' + encodeURIComponent(username), {
      signal: AbortSignal.timeout(3000)
    });
    if (resp.ok) {
      const data = await resp.json();
      return data.points !== undefined ? data.points : null;
    }
  } catch (e) {
    console.log('[Sync] Failed to fetch points for', username, ':', e.message);
  }
  return null;
}

async function getMemberPointsAuto(username) {
  return fetchRemotePoints(username);
}

async function syncCoinLog(logEntry) {
  if (!syncServerUrl) return;
  try {
    const resp = await fetch(syncServerUrl + '/api/sync/coin-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(logEntry),
      signal: AbortSignal.timeout(5000)
    });
    if (resp.ok) {
      console.log('[Sync] Coin log sent to server:', logEntry.username, logEntry.amount);
    } else {
      console.log('[Sync] Server returned:', resp.status);
    }
  } catch (e) {
    console.log('[Sync] Failed to send coin log:', e.message);
  }
}

app.post('/api/sync/coin-log', authorizeKioskMission, (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  try {
    const entry = req.body;
    if (!entry || typeof entry.username !== 'string' || !/^mem-[a-z0-9._-]{1,80}$/i.test(entry.username) ||
        typeof entry.amount !== 'number' || !Number.isFinite(entry.amount) ||
        entry.amount <= 0 || entry.amount > 10000 || !['app', 'vendo'].includes(entry.source)) {
      return res.status(400).json({ error: 'Invalid coin event' });
    }
    const s = settings.getSettings();
    const log = coinLogs.appendLog({
      username: entry.username,
      amount: entry.amount,
      timeAdded: entry.timeAdded || '',
      ip: entry.ip || '',
      mac: entry.mac || '',
      source: entry.source || 'vendo'
    }, s.pointRates || []);
    console.log('[Sync] Received coin log from client:', entry.username, 'amount:', entry.amount, 'points:', log.points);
    res.json({ ok: true, log });
  } catch (e) {
    console.log('[Sync] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function attendanceConfig() {
  const s = settings.getSettings();
  return {
    enabled: s.attendanceEnabled, mode: s.attendanceMode,
    minutes: s.attendanceMinutes, minMinutes: s.attendanceMinMinutes,
    maxMinutes: s.attendanceMaxMinutes, targetSeed: s.attendanceTargetSeed,
    points: s.attendancePoints
  };
}

function attendanceResult(username, day) {
  const config = settings.getAttendancePolicy(day);
  const progress = attendance.status(username, day);
  if (config.enabled && (config.mode === 'login' || progress.seconds >= config.minutes * 60) && !progress.awarded) {
    coinLogs.appendAttendanceAward(username, day, config.points);
    attendance.markAwarded(username, day, config.points);
    progress.awarded = true;
    progress.awardedPoints = config.points;
  }
  return { ...progress, ...config, points: progress.awardedPoints ?? config.points };
}

app.get('/api/sync/attendance-config', (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  res.json(attendanceConfig());
});

app.post('/api/sync/attendance', authorizeKioskMission, (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  if (!settings.getSettings().attendanceEnabled) {
    return res.status(403).json({ success: false, error: 'Attendance mission is disabled.' });
  }
  try {
    const sample = req.body;
    if (!sample || Object.hasOwn(sample, 'seconds')) {
      return res.status(400).json({ success: false, error: 'Offline attendance progress cannot earn points.' });
    }
    attendance.recordOnline(sample);
    res.json({ success: true, attendance: attendanceResult(sample.username, sample.day) });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

function attendanceYear(username, year) {
  const entries = attendance.yearEntries(username, year);
  const policies = settings.getAttendancePoliciesForYear(year);
  const today = attendance.dayKey();
  const days = {};
  for (const [day, policy] of Object.entries(policies)) {
    const record = entries[day];
    const status = day > today ? 'upcoming'
      : record?.awarded ? 'completed'
      : record && !policy.enabled ? 'attended-no-mission'
      : record ? 'incomplete'
      : policy.enabled ? 'absent' : 'no-mission';
    days[day] = {
      status, seconds: record?.seconds || 0,
      goalSeconds: policy.mode === 'minutes' && policy.enabled ? policy.minutes * 60 : 0,
      points: record?.awardedPoints ?? policy.points
    };
  }
  return { success: true, year, days };
}

function parseAttendanceYear(raw) {
  if (!/^\d{4}$/.test(String(raw || ''))) return null;
  const year = Number(raw);
  return year >= 2000 && year <= new Date().getFullYear() ? year : null;
}

app.get('/api/sync/attendance-year/:username', (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  if (!/^mem-[a-z0-9._-]{1,80}$/i.test(req.params.username)) {
    return res.status(400).json({ success: false, error: 'Invalid member.' });
  }
  const year = parseAttendanceYear(req.query.year);
  if (!year) return res.status(400).json({ success: false, error: 'Invalid year.' });
  res.json(attendanceYear(req.params.username, year));
});

app.get('/api/session/attendance', async (req, res) => {
  const year = parseAttendanceYear(req.query.year);
  if (!year) return res.status(400).json({ success: false, error: 'Invalid year.' });
  if (appRole !== 'auto-shutdown') return res.status(404).end();
  let active;
  try {
    active = await fetchStatusForRead();
  } catch (_) {
    return res.status(503).json({ success: false, error: 'Could not confirm the active member session.' });
  }
  if (!active.isLogin || Number(active.sessionTimeLeft) <= 0 ||
      !/^mem-[a-z0-9._-]{1,80}$/i.test(active.username || '')) {
    return res.status(401).json({ success: false, error: 'Log in as a member to view attendance.' });
  }
  const username = active.username;
  if (syncServerUrl) {
    try {
      const remote = await fetch(syncServerUrl + '/api/sync/attendance-year/' +
        encodeURIComponent(username) + '?year=' + year, { signal: AbortSignal.timeout(5000) });
      if (!remote.ok) throw new Error('Denfi Points unavailable');
      const result = await remote.json();
      if (!result.success || result.year !== year || !result.days) throw new Error('Invalid attendance history');
      return res.json({ ...result, username, source: 'denfi-points' });
    } catch (_) {
      return res.status(503).json({ success: false, error: 'Denfi Points attendance history is unavailable. Try again later.' });
    }
  }
  return res.status(503).json({ success: false, error: 'Denfi Points attendance history is unavailable. Try again later.' });
});

async function activeWheelMember(req, res) {
  if (appRole !== 'auto-shutdown') {
    res.status(404).end();
    return null;
  }
  try {
    const active = await fetchStatusForRead();
    if (active.isLogin && Number(active.sessionTimeLeft) > 0 &&
        /^mem-[a-z0-9._-]{1,80}$/i.test(active.username || '')) {
      return { username: active.username, station: settings.getSettings().pisonetUnitName || 'PC' };
    }
    res.status(401).json({ success: false, error: 'Log in as a member with an active session to play.' });
  } catch (_) {
    res.status(503).json({ success: false, error: 'Could not confirm the active member session.' });
  }
  return null;
}

app.get('/api/session/wheel', requireLocalWheelPlayer, async (req, res) => {
  const member = await activeWheelMember(req, res);
  if (!member) return;
  try {
    const data = await fetchPointsWheel('/api/sync/wheel/status/' + encodeURIComponent(member.username));
    res.json({
      success: true, enabled: data.enabled,
      allowCustomStake: data.allowCustomStake,
      maxSpinsPerDay: data.maxSpinsPerDay,
      spinsUsed: data.spinsUsed,
      spinsRemaining: data.spinsRemaining,
      multipliers: data.multipliers, oddsToken: data.oddsToken, balance: data.balance
    });
  } catch (error) {
    wheelErrorResponse(res, error);
  }
});

app.post('/api/session/wheel/spin', requireLocalWheelPlayer, async (req, res) => {
  const member = await activeWheelMember(req, res);
  if (!member) return;
  const requestId = req.body && req.body.requestId;
  const expectedStake = req.body && req.body.expectedStake;
  const expectedBalance = req.body && req.body.expectedBalance;
  const reviewedOddsToken = req.body && req.body.oddsToken;
  const legacyReplay = req.body && req.body.legacyReplay === true;
  if (typeof requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requestId)) {
    return res.status(400).json({ success: false, error: 'Invalid spin request ID.' });
  }
  if (typeof expectedStake !== 'number' || !Number.isFinite(expectedStake) || expectedStake <= 0 ||
      !Number.isSafeInteger(Math.round(expectedStake * 100)) ||
      Math.abs(Math.round(expectedStake * 100) - expectedStake * 100) > 1e-8 ||
      (expectedBalance !== undefined && (typeof expectedBalance !== 'number' || !Number.isFinite(expectedBalance) ||
        expectedBalance <= 0 || !Number.isSafeInteger(Math.round(expectedBalance * 100)) ||
        Math.abs(Math.round(expectedBalance * 100) - expectedBalance * 100) > 1e-8)) ||
      (!legacyReplay && (typeof reviewedOddsToken !== 'string' || !/^[a-f0-9]{64}$/.test(reviewedOddsToken)))) {
    return res.status(400).json({ success: false, error: 'Invalid reviewed stake or game version.' });
  }
  try {
    const data = await fetchPointsWheel('/api/sync/wheel/spin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: member.username, station: member.station, requestId, expectedStake, expectedBalance, oddsToken: reviewedOddsToken, legacyReplay })
    });
    if (data.spin.username !== member.username || data.spin.requestId !== requestId) throw new Error('Denfi Points returned an invalid spin.');
    // An unsent result is retained on Denfi Points until a kiosk with the configured bot delivers it.
    if (!data.spin.notificationSent && await flushWheelNotifications() === requestId) {
      data.spin.notificationSent = true;
    }
    const { outcomes, ...playerSpin } = data.spin;
    res.json({ success: true, spin: playerSpin });
  } catch (error) {
    wheelErrorResponse(res, error, true);
  }
});

async function updateAttendanceFromSession(data) {
  const config = attendanceConfig();
  const sample = attendance.onlineSample(
    data.isLogin && Number(data.sessionTimeLeft) > 0 ? data.username : '', config.enabled
  );
  if (!sample) return null;
  if (!syncServerUrl || !attendanceConfigReady) {
    return { ...config, seconds: 0, awarded: false, unavailable: true };
  }
  try {
    const body = await fetchAttendance('/api/sync/attendance', sample);
    if (!body.success || !body.attendance) throw new Error('Invalid Denfi Points attendance response');
    return body.attendance;
  } catch (err) {
    console.log('[Attendance] Points unavailable; attendance time not counted:', err.message);
    return { ...config, seconds: 0, awarded: false, unavailable: true };
  }
}

app.get('/api/sync/rates', (req, res) => {
  try {
    const s = settings.getSettings();
    res.json({ coinRates: s.coinRates || [], pointRates: s.pointRates || [] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sync/coin-logs', (req, res) => {
  try {
    const { username, from, to } = req.query;
    const s = settings.getSettings();
    const currentRates = s.pointRates || [];
    const result = coinLogs.getLogs({ username, from, to }, currentRates);
    const hasFilters = username || from || to;
    let filteredPoints = result.memberPoints;
    if (hasFilters) {
      filteredPoints = {};
      (result.logs || []).forEach(l => {
        if (l.username) filteredPoints[l.username] = parseFloat(((filteredPoints[l.username] || 0) + (l.points || 0)).toFixed(2));
      });
    }
    res.json({
      success: true,
      logs: result.logs,
      memberPoints: filteredPoints,
      coinRates: s.coinRates || [],
      pointRates: currentRates
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sync/member-points/:username', (req, res) => {
  try {
    const s = settings.getSettings();
    const period = coinLogs.getCurrentPeriodKey();
    const points = coinLogs.getMemberPoints(req.params.username, s.pointRates || [], period);
    res.json({ points, period });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/sync/wheel-config', (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  res.json({ success: true, wheel: settings.getSettings().wheel });
});

app.get('/api/sync/wheel/status/:username', authorizeKioskMission, (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  if (!/^mem-[a-z0-9._-]{1,80}$/i.test(req.params.username)) return res.status(400).json({ success: false, error: 'Invalid member.' });
  try {
    const s = settings.getSettings();
    const daily = coinLogs.getDailyWheelStatus(req.params.username, s.wheel.maxSpinsPerDay);
    res.json({
      success: true, enabled: s.wheel.enabled,
      allowCustomStake: s.wheel.allowCustomStake,
      ...daily,
      multipliers: s.wheel.outcomes.map(item => item.multiplier),
      oddsToken: oddsToken(s.wheel),
      balance: coinLogs.getMemberPoints(req.params.username, s.pointRates || [])
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Could not read the Points balance.' });
  }
});

app.post('/api/sync/wheel/spin', authorizeKioskMission, (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  const { username, requestId, station, expectedStake, expectedBalance, oddsToken: reviewedOddsToken, legacyReplay } = req.body || {};
  if (typeof username !== 'string' || !/^mem-[a-z0-9._-]{1,80}$/i.test(username) ||
      typeof requestId !== 'string' || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requestId) ||
      typeof expectedStake !== 'number' || !Number.isFinite(expectedStake) || expectedStake <= 0 ||
      !Number.isSafeInteger(Math.round(expectedStake * 100)) ||
      Math.abs(Math.round(expectedStake * 100) - expectedStake * 100) > 1e-8 ||
      (expectedBalance !== undefined && (typeof expectedBalance !== 'number' || !Number.isFinite(expectedBalance) ||
        expectedBalance <= 0 || !Number.isSafeInteger(Math.round(expectedBalance * 100)) ||
        Math.abs(Math.round(expectedBalance * 100) - expectedBalance * 100) > 1e-8)) ||
      (legacyReplay !== true && (typeof reviewedOddsToken !== 'string' || !/^[a-f0-9]{64}$/.test(reviewedOddsToken)))) {
    return res.status(400).json({ success: false, error: 'Invalid member, request ID, stake or game version.' });
  }
  const previous = coinLogs.getWheelSpin(requestId);
  if (previous && previous.username !== username) return res.status(409).json({ success: false, error: 'Spin request belongs to another member.' });
  if (legacyReplay === true && !previous) return res.status(409).json({ success: false, error: 'Game settings changed. Review before trying again.' });
  const s = settings.getSettings();
  if (!previous && s.wheel.allowCustomStake && expectedBalance === undefined) {
    return res.status(400).json({ success: false, error: 'The current balance snapshot is required for a custom stake.' });
  }
  if (!previous && !s.wheel.enabled) return res.status(403).json({ success: false, error: 'Betting Games is disabled.' });
  if (!previous && reviewedOddsToken !== oddsToken(s.wheel)) {
    return res.status(409).json({ success: false, error: 'Game settings changed. Reload Betting Games and review before spinning.' });
  }
  try {
    const spin = previous || coinLogs.appendWheelSpin({
      username, requestId, station, expectedStake, expectedBalance,
      allowCustomStake: s.wheel.allowCustomStake, maxSpinsPerDay: s.wheel.maxSpinsPerDay,
      outcomes: s.wheel.outcomes, pointRates: s.pointRates || []
    });
    const daily = coinLogs.getDailyWheelStatus(username, s.wheel.maxSpinsPerDay);
    res.json({ success: true, spin: { ...spin, ...daily, allowCustomStake: s.wheel.allowCustomStake } });
  } catch (error) {
    const staleBalance = /Balance changed/.test(error.message);
    const badRequest = staleBalance || /No points available|different member|too large|Stake must be positive|full balance|balance snapshot/.test(error.message);
    const status = error.status || (staleBalance ? 409 : badRequest ? 400 : 500);
    res.status(status).json({ success: false, error: (error.status || badRequest) ? error.message : 'The spin could not be recorded. Retry with the same request ID.' });
  }
});

app.post('/api/sync/wheel/claim-notification', authorizeKioskMission, (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  try {
    res.json({ success: true, claim: coinLogs.claimWheelNotification() });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Could not claim a wheel notification.' });
  }
});

app.post('/api/sync/wheel/ack-notification', authorizeKioskMission, (req, res) => {
  if (appRole !== 'points') return res.status(404).end();
  if (typeof req.body?.requestId !== 'string' || !/^[a-f0-9]{32}$/.test(req.body?.leaseToken || '')) {
    return res.status(400).json({ success: false, error: 'Invalid notification receipt.' });
  }
  try {
    const acknowledged = coinLogs.acknowledgeWheelNotification(req.body.requestId, req.body.leaseToken);
    res.status(acknowledged ? 200 : 409).json({ success: acknowledged, error: acknowledged ? undefined : 'Notification lease expired.' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Could not record the Telegram receipt.' });
  }
});

app.get('/api/sync/leaderboard', (req, res) => {
  try {
    const s = settings.getSettings();
    const period = coinLogs.getCurrentPeriodKey();
    res.json({ success: true, leaderboard: coinLogs.getLeaderboard(5, s.pointRates || [], period), period });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/session' });

let lastSessionData = null;
let wsPollingInterval = null;
let wsClients = new Set();

wss.on('connection', (ws) => {
  wsClients.add(ws);
  console.log('[WS] Client connected, total:', wsClients.size);

  if (lastSessionData) {
    ws.send(JSON.stringify({ type: 'status', data: lastSessionData }));
  }

  ws.on('close', () => {
    wsClients.delete(ws);
    console.log('[WS] Client disconnected, total:', wsClients.size);
    if (wsClients.size === 0) stopWsPolling();
  });

  ws.on('error', () => {
    wsClients.delete(ws);
    if (wsClients.size === 0) stopWsPolling();
  });

  if (wsClients.size === 1) startWsPolling();
});

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of wsClients) {
    try {
      if (ws.readyState === 1) {
        ws.send(data);
      } else {
        wsClients.delete(ws);
      }
    } catch (e) {
      wsClients.delete(ws);
    }
  }
  if (wsClients.size === 0) stopWsPolling();
}

function reverseCalcPesos(secondsAdded, coinRates) {
  if (!Array.isArray(coinRates) || coinRates.length === 0 || secondsAdded <= 0) return 0;
  const minutesAdded = secondsAdded / 60;
  const valid = coinRates.filter(r => r.pesos > 0 && r.minutes > 0);
  if (valid.length === 0) return 0;

  let bestPesos = 0;
  let bestError = Infinity;

  for (const rate of valid) {
    const units = Math.round(minutesAdded / rate.minutes);
    if (units <= 0) continue;
    const expectedMinutes = units * rate.minutes;
    const error = Math.abs(minutesAdded - expectedMinutes);
    const tolerance = rate.minutes * 0.15;
    if (error <= tolerance && error < bestError) {
      bestPesos = units * rate.pesos;
      bestError = error;
    }
  }

  return bestPesos;
}

function hasActiveCoinSessionForUser(username) {
  for (const [, session] of activeCoinSessions) {
    if (session.username === username) return true;
  }
  return false;
}

const autoLogCooldowns = new Map();
const recentRegistrations = new Map();
const lastAutoLoggedTime = new Map();
let pollInFlight = false;
let pollQueued = false;
let confirmedLoggedOutSamples = 0;
const LOGOUT_CONFIRMATION_SAMPLES = 3;

function scheduleImmediatePoll() {
  if (pollInFlight) {
    pollQueued = true;
  } else {
    setTimeout(() => pollHotspotForWs(), 300);
  }
}

async function pollHotspotForWs() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    const data = await fetchStatusForRead();

    const wasLoggedIn = lastSessionData?.isLogin;
    const prevTime = lastSessionData?.sessionTimeLeft;
    const newTime = parseInt(data.sessionTimeLeft) || 0;
    const prevUser = lastSessionData?.username;

    if (data.isLogin) {
      confirmedLoggedOutSamples = 0;
    } else if (wasLoggedIn) {
      confirmedLoggedOutSamples++;
      if (confirmedLoggedOutSamples < LOGOUT_CONFIRMATION_SAMPLES) {
        console.log(`[WS] Ignoring temporary logged-out sample (${confirmedLoggedOutSamples}/${LOGOUT_CONFIRMATION_SAMPLES})`);
        broadcast({ type: 'status-check-pending' });
        return;
      }
    } else {
      confirmedLoggedOutSamples = 0;
    }

    if (appRole === 'auto-shutdown') {
      data.attendance = await updateAttendanceFromSession(data);
    }

    if (data.isLogin && data.username && data.username.startsWith('mem-')) {
      const s = settings.getSettings();

      const regEntry = recentRegistrations.get(data.username);
      let regHandled = false;
      if (regEntry && newTime > 5) {
        const now = Date.now();
        const userCooldown = autoLogCooldowns.get(data.username) || 0;
        if (now > userCooldown) {
          const pesos = reverseCalcPesos(newTime, s.coinRates || []);
          if (pesos > 0) {
            const minutesAdded = Math.round(newTime / 60);
            try {
              const log = coinLogs.appendLog({
                username: data.username,
                amount: pesos,
                timeAdded: minutesAdded + ' min',
                ip: data.ip || regEntry.ip || '',
                mac: data.mac || regEntry.mac || '',
                source: 'vendo'
              }, s.pointRates || []);
              console.log('[AutoLog-NewReg] First login for', data.username, '- seconds:', newTime, 'pesos:', pesos, 'points:', log.points);
              syncCoinLog({ username: data.username, amount: pesos, timeAdded: minutesAdded + ' min', ip: data.ip || regEntry.ip || '', mac: data.mac || regEntry.mac || '', source: 'vendo' });
              autoLogCooldowns.set(data.username, now + 20000);
              lastAutoLoggedTime.set(data.username, newTime);
              recentRegistrations.delete(data.username);
              for (const [key, sess] of activeCoinSessions) {
                if (sess.username === data.username) {
                  activeCoinSessions.delete(key);
                  console.log('[AutoLog-NewReg] Cleared stale coin session for', data.username);
                  break;
                }
              }
              regHandled = true;
            } catch (e) {
              console.log('[AutoLog-NewReg] Error:', e.message);
            }
          }
        }
      }
      if (regEntry && !regHandled && (Date.now() - regEntry.timestamp > 300000)) {
        recentRegistrations.delete(data.username);
      }
      if (!regEntry && prevTime !== undefined && data.username === prevUser) {
        const baseline = lastAutoLoggedTime.has(data.username) ? lastAutoLoggedTime.get(data.username) : parseInt(prevTime);
        if (newTime > baseline + 5) {
          const secondsAdded = newTime - baseline;
          const now = Date.now();
          const userCooldownKey = data.username;
          const userCooldown = autoLogCooldowns.get(userCooldownKey) || 0;
          if (now > userCooldown && !hasActiveCoinSessionForUser(data.username)) {
            const pesos = reverseCalcPesos(secondsAdded, s.coinRates || []);
            if (pesos > 0) {
              const minutesAdded = Math.round(secondsAdded / 60);
              try {
                const log = coinLogs.appendLog({
                  username: data.username,
                  amount: pesos,
                  timeAdded: minutesAdded + ' min',
                  ip: data.ip || '',
                  mac: data.mac || '',
                  source: 'vendo'
                }, s.pointRates || []);
                console.log('[AutoLog] Detected time increase for', data.username, '- seconds:', secondsAdded, 'pesos:', pesos, 'points:', log.points);
                syncCoinLog({ username: data.username, amount: pesos, timeAdded: minutesAdded + ' min', ip: data.ip || '', mac: data.mac || '', source: 'vendo' });
                autoLogCooldowns.set(userCooldownKey, now + 15000);
                lastAutoLoggedTime.set(data.username, newTime);
              } catch (e) {
                console.log('[AutoLog] Error:', e.message);
              }
            }
          }
        } else if (!lastAutoLoggedTime.has(data.username)) {
          lastAutoLoggedTime.set(data.username, newTime);
        }
      }

      if (recentRegistrations.size > 0) {
        const now = Date.now();
        for (const [key, entry] of recentRegistrations) {
          if (now - entry.timestamp > 300000) recentRegistrations.delete(key);
        }
      }

      data.memberPoints = await getMemberPointsAuto(data.username);
    }

    lastSessionData = data;

    if (prevTime !== undefined && newTime > parseInt(prevTime)) {
      console.log('[WS] Time increased:', prevTime, '->', newTime);
    }

    broadcast({ type: 'status', data });

    if (wasLoggedIn && !data.isLogin) {
      confirmedLoggedOutSamples = 0;
      if (prevUser) lastAutoLoggedTime.delete(prevUser);
      broadcast({ type: 'logged-out' });
    }

    if (autoLogCooldowns.size > 50) {
      const now = Date.now();
      for (const [key, expiry] of autoLogCooldowns) {
        if (now > expiry) autoLogCooldowns.delete(key);
      }
    }
  } catch (err) {
    broadcast({ type: 'error', error: err.message });
  } finally {
    pollInFlight = false;
    if (pollQueued) {
      pollQueued = false;
      setTimeout(() => pollHotspotForWs(), 300);
    }
  }
}

function startWsPolling() {
  if (wsPollingInterval) return;
  console.log('[WS] Starting server-side polling');
  pollHotspotForWs();
  wsPollingInterval = setInterval(pollHotspotForWs, 2000);
}

function stopWsPolling() {
  if (wsPollingInterval) {
    clearInterval(wsPollingInterval);
    wsPollingInterval = null;
    lastSessionData = null;
    console.log('[WS] Stopped server-side polling');
  }
}

server.on('error', (err) => {
  console.error('[Server] Listen error:', err.message);
  if (err.code === 'EADDRINUSE') {
    console.error('[Server] Port', PORT, 'is already in use. Exiting.');
    process.exit(1);
  }
});

const isElectron = typeof process.versions.electron !== 'undefined';
const LISTEN_HOST = process.env.DENFI_LISTEN_HOST || (isElectron ? '127.0.0.1' : '0.0.0.0');
server.listen(PORT, LISTEN_HOST, () => {
  console.log(`Denfi Auto Shutdown running at http://${LISTEN_HOST}:${PORT}`);
  if (typeof process.send === 'function') process.send('server-ready');
  ensureMonthlyLeaderboardReport();
  if (settings.ensurePlaytimeMission()) console.log('[Attendance] Switched legacy login mission to play time');

  if (appRole === 'auto-shutdown') {
    const savedSync = settings.getSettings().syncServerUrl;
    if (!syncServerUrl && savedSync) {
      console.log('[Sync] Loading saved server URL:', savedSync);
      setSyncServer(savedSync);
    }
    if (isElectron && syncServerUrl && isLoopbackPointsUrl(syncServerUrl)) {
      void findLocalPointsServer().then(found => {
        if (found && isLoopbackPointsUrl(syncServerUrl)) setSyncServer(found, true);
      }).catch(err => console.log('[Sync] Could not resolve the local Points LAN address:', err.message));
    }
    if (isElectron) {
      setInterval(() => {
        if (syncServerUrl && !isLoopbackPointsUrl(syncServerUrl)) return;
        void findLocalPointsServer().then(found => {
          if (found && (!syncServerUrl || isLoopbackPointsUrl(syncServerUrl))) {
            console.log('[Sync] Found Denfi Points on this computer:', found);
            setSyncServer(found, true);
          }
        }).catch(err => console.log('[Sync] Local Points discovery failed:', err.message));
      }, 15000).unref();
    }
    if (!syncServerUrl) {
      (async () => {
        const found = await discoverPointsServer();
        if (found) {
          console.log('[Sync] Auto-detected Denfi Points on', found);
          setSyncServer(found, true);
        } else {
          console.log('[Sync] No Denfi Points server found on network');
        }
      })();
    }
  }
});

setInterval(() => {
  ensureMonthlyLeaderboardReport().catch(error => {
    console.log('[Telegram] Monthly points report check failed:', error.message);
  });
}, 60000).unref();

module.exports = { setSyncServer };
