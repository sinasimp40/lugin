const express = require('express');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { WebSocketServer } = require('ws');
const http = require('http');
const settings = require('./src/settings-store');

const app = express();
const PORT = process.env.PORT || 5000;

const HOTSPOT_DNS = 'pisonet.app';
const VENDO_IP = '10.0.0.5:8989';

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
app.use(express.static(path.join(__dirname, 'public')));

app.get('/uploads/:filename', (req, res) => {
  const basename = path.basename(req.params.filename);
  if (!basename || basename.startsWith('.')) return res.status(400).end();
  const filepath = path.join(settings.getUploadsDir(), basename);
  const resolved = path.resolve(filepath);
  if (!resolved.startsWith(path.resolve(settings.getUploadsDir()))) return res.status(403).end();
  if (!fs.existsSync(resolved)) return res.status(404).end();
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

app.get('/api/hotspot/login-data', async (req, res) => {
  try {
    const data = await fetchLoginData();
    const chapAvailable = data.chapIdHex && data.chapIdHex.length > 0;
    console.log('[Login Data] CHAP:', chapAvailable, 'loginLink:', data.loginLink, 'error:', data.error);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: `Cannot reach ${HOTSPOT_DNS}: ${err.message}` });
  }
});

app.post('/api/hotspot/login', async (req, res) => {
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

app.get('/api/hotspot/status', async (req, res) => {
  try {
    const resp = await fetch(`http://${HOTSPOT_DNS}/status`, { signal: AbortSignal.timeout(5000) });
    const buffer = Buffer.from(await resp.arrayBuffer());
    const data = parseHotspotResponse(buffer);
    res.json({ success: true, data });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/hotspot/logout', async (req, res) => {
  let { logoutLink } = req.body;
  try {
    if (!logoutLink) {
      const statusResp = await fetch(`http://${HOTSPOT_DNS}/status`, { signal: AbortSignal.timeout(5000) });
      const buffer = Buffer.from(await statusResp.arrayBuffer());
      const statusData = parseHotspotResponse(buffer);
      logoutLink = statusData.logoutLink;
    }
    if (!logoutLink) {
      logoutLink = `http://${HOTSPOT_DNS}/logout`;
    }
    console.log('[Logout] Calling:', logoutLink);
    await fetch(logoutLink, { signal: AbortSignal.timeout(5000) });
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

app.post('/api/vendo/topup', async (req, res) => {
  const { voucher, ip, mac, type } = req.body;
  try {
    const extendTime = type === 'E' ? '1' : '0';
    const url = `http://${VENDO_IP}/topUp?voucher=${encodeURIComponent(voucher || '')}&ipAddress=${encodeURIComponent(ip || '')}&mac=${encodeURIComponent(mac || '')}&extendTime=${extendTime}`;
    console.log('[Vendo] topUp:', url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await resp.text();
    console.log('[Vendo] topUp response:', text);
    try {
      const data = JSON.parse(text);
      const vendoOk = data.status === 'true' || data.status === true || data.status === 'success';
      if (vendoOk) {
        const coinProof = issueCoinProof(voucher);
        res.json({ success: true, data, coinProof });
      } else {
        res.json({ success: false, error: data.errorCode || data.message || 'Vendo rejected request', data });
      }
    } catch (_) {
      res.json({ success: true, data: text });
    }
  } catch (err) {
    res.json({ success: false, error: `Cannot reach vendo: ${err.message}` });
  }
});

app.get('/api/vendo/check-coin', async (req, res) => {
  const { voucher } = req.query;
  try {
    const url = `http://${VENDO_IP}/checkCoin?voucher=${encodeURIComponent(voucher || '')}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(3000) });
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

app.post('/api/vendo/use-voucher', async (req, res) => {
  const { voucher } = req.body;
  try {
    const url = `http://${VENDO_IP}/useVoucher?voucher=${encodeURIComponent(voucher || '')}`;
    console.log('[Vendo] useVoucher:', url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await resp.text();
    console.log('[Vendo] useVoucher response:', text);
    res.json({ success: true, data: text });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/vendo/cancel', async (req, res) => {
  const { voucher } = req.body;
  try {
    const url = `http://${VENDO_IP}/cancelTopUp?voucher=${encodeURIComponent(voucher || '')}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await resp.text();
    res.json({ success: true, data: text });
  } catch (err) {
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

async function createRouterUser(username, password, limitUptime) {
  const cfg = settings.getSettings();
  if (!cfg.routerIp || !cfg.routerUser) {
    throw new Error('Router not configured. Set Router IP and credentials in Admin Panel.');
  }
  const baseUrl = `http://${cfg.routerIp}/rest`;
  const authHeader = 'Basic ' + Buffer.from(`${cfg.routerUser}:${cfg.routerPassword}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', 'Authorization': authHeader };

  const checkResp = await fetch(`${baseUrl}/ip/hotspot/user?name=${encodeURIComponent(username)}`, {
    headers, signal: AbortSignal.timeout(5000),
  });
  if (!checkResp.ok) throw new Error('Cannot connect to router: ' + checkResp.status + ' ' + checkResp.statusText);
  const existing = await checkResp.json();
  if (Array.isArray(existing) && existing.length > 0) {
    const user = existing[0];
    const patchBody = {};
    if (user.server !== cfg.hotspotServer) patchBody.server = cfg.hotspotServer;
    if (user.profile !== cfg.hotspotProfile) patchBody.profile = cfg.hotspotProfile;
    if (password) patchBody.password = password;
    if (limitUptime) patchBody['limit-uptime'] = limitUptime;

    if (Object.keys(patchBody).length > 0) {
      const patchResp = await fetch(`${baseUrl}/ip/hotspot/user/${user['.id']}`, {
        method: 'PATCH', headers, body: JSON.stringify(patchBody), signal: AbortSignal.timeout(5000),
      });
      if (!patchResp.ok) throw new Error('Failed to update user: ' + (await patchResp.text()));
    }
    return { action: 'updated', username };
  }

  const body = {
    name: username,
    password: password || username,
    server: cfg.hotspotServer,
    profile: cfg.hotspotProfile,
  };
  if (limitUptime) body['limit-uptime'] = limitUptime;

  const createResp = await fetch(`${baseUrl}/ip/hotspot/user`, {
    method: 'PUT', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000),
  });
  if (!createResp.ok) {
    const errText = await createResp.text();
    throw new Error('Failed to create user: ' + errText);
  }
  return { action: 'created', username };
}

const coinProofTokens = new Map();
function issueCoinProof(username) {
  const token = crypto.randomBytes(16).toString('hex');
  coinProofTokens.set(token, { username, issued: Date.now() });
  for (const [k, v] of coinProofTokens) {
    if (Date.now() - v.issued > 120000) coinProofTokens.delete(k);
  }
  return token;
}

app.post('/api/router/create-user', async (req, res) => {
  const { username, password, coinProof } = req.body;
  if (!username) return res.json({ success: false, error: 'Username required' });
  if (!coinProof) return res.json({ success: false, error: 'Payment proof required' });
  const proof = coinProofTokens.get(coinProof);
  if (!proof || proof.username !== username || Date.now() - proof.issued > 120000) {
    return res.json({ success: false, error: 'Invalid or expired payment proof' });
  }
  coinProofTokens.delete(coinProof);
  try {
    const result = await createRouterUser(username, password || username);
    console.log('[Router] User', result.action, ':', username);
    res.json({ success: true, ...result });
  } catch (err) {
    console.log('[Router] Create user error:', err.message);
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

app.get('/api/admin/status', (req, res) => {
  const s = settings.getPublicSettings();
  res.json({ registered: settings.isAdminRegistered(), settings: s });
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

app.post('/api/admin/settings', verifyToken, (req, res) => {
  const updated = settings.updateSettings(req.body);
  broadcastSettings();
  res.json({ success: true, settings: updated });
});

app.post('/api/admin/background', verifyToken, (req, res) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.startsWith('application/octet-stream') && !contentType.startsWith('image/')) {
    return res.status(400).json({ success: false, error: 'Invalid content type' });
  }
  const filename = req.headers['x-filename'] || 'background.png';
  const mime = req.headers['x-mime-type'] || 'image/png';
  const allowed = ['image/png', 'image/jpeg', 'image/gif'];
  if (!allowed.includes(mime)) return res.status(400).json({ success: false, error: 'Only PNG, JPEG, GIF allowed' });

  const chunks = [];
  let totalSize = 0;
  req.on('data', (chunk) => {
    totalSize += chunk.length;
    if (totalSize > 10 * 1024 * 1024) {
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (totalSize > 10 * 1024 * 1024) return res.status(400).json({ success: false, error: 'File too large (max 10MB)' });
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

app.post('/api/admin/stop-app', verifyToken, (req, res) => {
  res.json({ success: true });
  setTimeout(() => {
    if (typeof process.send === 'function') process.send('admin-stop');
    process.exit(0);
  }, 500);
});

function broadcastSettings() {
  const s = settings.getPublicSettings();
  const msg = JSON.stringify({ type: 'settings', data: s });
  for (const ws of wsClients) {
    try { if (ws.readyState === 1) ws.send(msg); } catch (e) {}
  }
}

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

async function pollHotspotForWs() {
  try {
    const resp = await fetch(`http://${HOTSPOT_DNS}/status`, { signal: AbortSignal.timeout(5000) });
    const buffer = Buffer.from(await resp.arrayBuffer());
    const data = parseHotspotResponse(buffer);

    const wasLoggedIn = lastSessionData?.isLogin;
    const prevTime = lastSessionData?.sessionTimeLeft;
    const newTime = parseInt(data.sessionTimeLeft) || 0;

    lastSessionData = data;

    if (prevTime !== undefined && newTime > parseInt(prevTime)) {
      console.log('[WS] Time increased:', prevTime, '->', newTime);
    }

    broadcast({ type: 'status', data });

    if (wasLoggedIn && !data.isLogin) {
      broadcast({ type: 'logged-out' });
    }
  } catch (err) {
    broadcast({ type: 'error', error: err.message });
  }
}

function startWsPolling() {
  if (wsPollingInterval) return;
  console.log('[WS] Starting server-side polling');
  pollHotspotForWs();
  wsPollingInterval = setInterval(pollHotspotForWs, 5000);
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
    console.error('[Server] Port', PORT, 'is already in use');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pisonet App running at http://0.0.0.0:${PORT}`);
  if (typeof process.send === 'function') process.send('server-ready');
});
