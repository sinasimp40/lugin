const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let dataDir = path.join(__dirname, '..', 'data');
let logsPath = path.join(dataDir, 'coin-logs.json');

const HMAC_KEY = 'denfi-coinlog-integrity-v1';

function setDataDir(dir) {
  dataDir = dir;
  logsPath = path.join(dataDir, 'coin-logs.json');
  ensureDir();
}

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function computeHmac(data) {
  const payload = JSON.stringify({ logs: data.logs || [], memberPoints: data.memberPoints || {} });
  return crypto.createHmac('sha256', HMAC_KEY).update(payload).digest('hex');
}

function load() {
  ensureDir();
  try {
    const raw = JSON.parse(fs.readFileSync(logsPath, 'utf8'));
    if (raw._sig) {
      const expected = computeHmac(raw);
      if (raw._sig !== expected) {
        console.log('[CoinLog] WARNING: Data integrity mismatch — re-signing file (data preserved).');
        raw._sig = computeHmac(raw);
        try { save(raw); } catch (_) {}
      }
    }
    return raw;
  } catch (e) {
    const backupPath = logsPath + '.corrupted.' + Date.now();
    try {
      if (fs.existsSync(logsPath)) {
        fs.copyFileSync(logsPath, backupPath);
        console.log('[CoinLog] Corrupted file backed up to:', backupPath);
      }
    } catch (_) {}
    return { logs: [], memberPoints: {} };
  }
}

function getFileMtime() {
  try { return fs.statSync(logsPath).mtimeMs; } catch (_) { return 0; }
}

function save(data) {
  ensureDir();
  data._sig = computeHmac(data);
  const tmp = logsPath + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, logsPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
}

function loadModifySave(modifyFn, maxRetries) {
  maxRetries = maxRetries || 3;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const mtimeBefore = getFileMtime();
    const data = load();
    const result = modifyFn(data);
    const mtimeAfter = getFileMtime();
    if (mtimeBefore !== mtimeAfter && attempt < maxRetries - 1) {
      continue;
    }
    save(data);
    return result;
  }
}

function calcPoints(amount, pointRates) {
  if (!Array.isArray(pointRates) || pointRates.length === 0 || !amount || amount <= 0) return 0;
  let best = 0;
  for (const rate of pointRates) {
    const rp = rate.pesos || 0;
    const rPts = rate.points || 0;
    if (rp > 0 && rPts > 0) {
      const pts = parseFloat(((amount / rp) * rPts).toFixed(2));
      if (pts > best) best = pts;
    }
  }
  return best;
}

function logPoints(log, pointRates) {
  return log.source === 'attendance' ? Number(log.points) || 0 : calcPoints(log.amount, pointRates);
}

function appendAttendanceAward(username, day, points) {
  let awarded = false;
  loadModifySave(data => {
    if ((data.logs || []).some(l => l.source === 'attendance' && l.username === username && l.attendanceDay === day)) return;
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const backdated = day === today ? Date.now()
      : new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)), 23, 59, 59).getTime();
    const log = {
      id: crypto.randomUUID(), username, attendanceDay: day, amount: 0,
      timeAdded: 'Daily attendance', points, timestamp: backdated,
      date: new Date(backdated).toISOString(), ip: '', mac: '', source: 'attendance'
    };
    data.logs.push(log);
    if (!data.memberPoints) data.memberPoints = {};
    data.memberPoints[username] = Math.round(((data.memberPoints[username] || 0) + points) * 100) / 100;
    awarded = true;
  });
  return awarded;
}

function getPeriodKey(value) {
  const date = value instanceof Date
    ? value
    : (typeof value === 'number' || /^\d+$/.test(String(value || '')))
      ? new Date(Number(value))
      : new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) return getPeriodKey(Date.now());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getCurrentPeriodKey() {
  return getPeriodKey(Date.now());
}

function getPreviousPeriodKey(periodKey) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(periodKey || getCurrentPeriodKey()));
  if (!match) return getPreviousPeriodKey(getCurrentPeriodKey());
  const date = new Date(Number(match[1]), Number(match[2]) - 2, 1);
  return getPeriodKey(date);
}

const DEDUP_WINDOW_MS = 10000;

function appendLog(entry, pointRates) {
  const pts = calcPoints(entry.amount, pointRates);
  const now = entry.timestamp || Date.now();
  const log = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    username: entry.username || '',
    amount: entry.amount || 0,
    timeAdded: entry.timeAdded || '',
    points: pts,
    timestamp: now,
    date: new Date().toISOString(),
    ip: entry.ip || '',
    mac: entry.mac || '',
    source: entry.source || 'app'
  };
  loadModifySave(function(data) {
    const dupeCheck = (data.logs || []).some(l =>
      l.username === log.username &&
      l.amount === log.amount &&
      l.ip === log.ip &&
      l.mac === log.mac &&
      Math.abs(l.timestamp - log.timestamp) < DEDUP_WINDOW_MS
    );
    if (dupeCheck) {
      console.log('[CoinLog] Duplicate entry blocked:', log.username, log.amount, log.source);
      return;
    }
    data.logs.push(log);
    if (!data.memberPoints) data.memberPoints = {};
    const user = log.username;
    if (user) {
      data.memberPoints[user] = parseFloat(((data.memberPoints[user] || 0) + log.points).toFixed(2));
    }
  });
  return log;
}

function deleteLog(logId) {
  let found = false;
  loadModifySave(function(data) {
    const idx = (data.logs || []).findIndex(l => l.id === logId);
    if (idx === -1) return;
    found = true;
    data.logs.splice(idx, 1);
    recalcPoints(data);
  });
  return found;
}

function clearAllLogs() {
  const data = { logs: [], memberPoints: {} };
  save(data);
  return true;
}

function recalcPoints(data) {
  data.memberPoints = {};
  (data.logs || []).forEach(l => {
    if (l.username) {
      data.memberPoints[l.username] = parseFloat(((data.memberPoints[l.username] || 0) + (l.points || 0)).toFixed(2));
    }
  });
}

function ratesHash(rates) {
  const canonical = (rates || []).map(r => ({ pesos: r.pesos, points: r.points })).sort((a, b) => a.pesos - b.pesos || a.points - b.points);
  return crypto.createHash('md5').update(JSON.stringify(canonical)).digest('hex');
}

function ensurePointsSync(pointRates) {
  const data = load();
  const currentHash = ratesHash(pointRates);
  if (data._ratesHash === currentHash) return;
  (data.logs || []).forEach(l => {
    l.points = logPoints(l, pointRates);
  });
  recalcPoints(data);
  data._ratesHash = currentHash;
  save(data);
}

function recalcAllPoints(pointRates) {
  const data = load();
  (data.logs || []).forEach(l => {
    l.points = logPoints(l, pointRates);
  });
  recalcPoints(data);
  data._ratesHash = ratesHash(pointRates);
  save(data);
  return data;
}

function getLogs(filters, pointRates) {
  if (pointRates) ensurePointsSync(pointRates);
  const data = load();
  let logs = data.logs || [];

  if (filters) {
    if (filters.username) {
      const q = filters.username.toLowerCase();
      logs = logs.filter(l => l.username.toLowerCase().includes(q));
    }
    if (filters.from) {
      const fromTs = new Date(filters.from).getTime();
      logs = logs.filter(l => l.timestamp >= fromTs);
    }
    if (filters.to) {
      const toTs = new Date(filters.to).getTime() + 86400000;
      logs = logs.filter(l => l.timestamp < toTs);
    }
  }

  logs.sort((a, b) => b.timestamp - a.timestamp);

  return {
    logs,
    memberPoints: data.memberPoints || {}
  };
}

function getMemberPoints(username, pointRates, periodKey) {
  if (pointRates) ensurePointsSync(pointRates);
  const data = load();
  const targetPeriod = periodKey || getCurrentPeriodKey();
  const total = (data.logs || [])
    .filter(log => getPeriodKey(log.timestamp) === targetPeriod && log.username === username)
    .reduce((sum, log) => sum + (Number(log.points) || 0), 0);
  return Math.round(total * 100) / 100;
}

function getLeaderboard(limit, pointRates, periodKey) {
  if (pointRates) ensurePointsSync(pointRates);
  const targetPeriod = periodKey || getCurrentPeriodKey();
  const totals = {};
  for (const log of load().logs || []) {
    const username = String(log.username || '').trim();
    const points = Number(log.points) || 0;
    if (!username || points <= 0 || getPeriodKey(log.timestamp) !== targetPeriod) continue;
    totals[username] = (totals[username] || 0) + points;
  }
  return Object.entries(totals)
    .map(([username, points]) => ({ username, points: Math.round(points * 100) / 100 }))
    .sort((a, b) => b.points - a.points || a.username.localeCompare(b.username))
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 5)));
}

function deleteMemberLogs(username) {
  let found = false;
  loadModifySave(function(data) {
    const before = (data.logs || []).length;
    data.logs = (data.logs || []).filter(l => l.username !== username);
    if (data.logs.length === before) return;
    found = true;
    recalcPoints(data);
  });
  return found;
}

module.exports = {
  setDataDir,
  appendLog,
  appendAttendanceAward,
  deleteLog,
  deleteMemberLogs,
  clearAllLogs,
  recalcAllPoints,
  ensurePointsSync,
  getLogs,
  getMemberPoints,
  getLeaderboard,
  getPeriodKey,
  getCurrentPeriodKey,
  getPreviousPeriodKey
};
