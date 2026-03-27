const express = require('express');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 5000;

const HOTSPOT_DNS = 'pisonet.app';
const VENDO_IP = '10.0.0.5:8989';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

app.post('/api/vendo/topup', async (req, res) => {
  const { voucher, ip, mac, type } = req.body;
  try {
    const vendoType = type === 'E' ? '&type=E' : '&type=N';
    const url = `http://${VENDO_IP}/topUp?voucher=${encodeURIComponent(voucher || '')}&ip=${encodeURIComponent(ip || '')}&mac=${encodeURIComponent(mac || '')}${vendoType}`;
    console.log('[Vendo] topUp:', url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const text = await resp.text();
    console.log('[Vendo] topUp response:', text);
    try {
      res.json({ success: true, data: JSON.parse(text) });
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pisonet App running at http://0.0.0.0:${PORT}`);
});
