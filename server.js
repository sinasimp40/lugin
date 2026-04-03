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
  const { ip, mac } = req.body;
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

app.get('/api/admin/status', (req, res) => {
  const s = settings.getPublicSettings();
  res.json({ registered: settings.isAdminRegistered(), settings: s });
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
  const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
  if (!allowed.includes(mime)) return res.status(400).json({ success: false, error: 'Only PNG, JPEG, GIF, WebP allowed' });

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
      process.exit(0);
    }, 2000);
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

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Denfi Auto Shutdown running at http://127.0.0.1:${PORT}`);
  if (typeof process.send === 'function') process.send('server-ready');
});
