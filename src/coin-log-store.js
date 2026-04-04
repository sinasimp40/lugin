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
        console.log('[CoinLog] WARNING: Data integrity check failed — file may have been tampered with. Resetting.');
        const fresh = { logs: [], memberPoints: {}, _sig: '' };
        fresh._sig = computeHmac(fresh);
        save(fresh);
        return fresh;
      }
    }
    return raw;
  } catch (e) {
    return { logs: [], memberPoints: {} };
  }
}

function save(data) {
  ensureDir();
  data._sig = computeHmac(data);
  const tmp = logsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, logsPath);
}

function calcPoints(amount, pointRates) {
  if (!Array.isArray(pointRates) || pointRates.length === 0 || !amount || amount <= 0) return 0;
  let best = 0;
  for (const rate of pointRates) {
    const rp = rate.pesos || 0;
    const rPts = rate.points || 0;
    if (rp > 0 && rPts > 0 && amount >= rp) {
      const pts = Math.floor(amount / rp) * rPts;
      if (pts > best) best = pts;
    }
  }
  return best;
}

function appendLog(entry, pointRates) {
  const data = load();
  const log = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    username: entry.username || '',
    amount: entry.amount || 0,
    timeAdded: entry.timeAdded || '',
    timestamp: entry.timestamp || Date.now(),
    date: new Date().toISOString(),
    ip: entry.ip || '',
    mac: entry.mac || ''
  };
  data.logs.push(log);
  recalcPoints(data, pointRates);
  save(data);
  return log;
}

function deleteLog(logId, pointRates) {
  const data = load();
  const idx = (data.logs || []).findIndex(l => l.id === logId);
  if (idx === -1) return false;

  data.logs.splice(idx, 1);
  recalcPoints(data, pointRates);
  save(data);
  return true;
}

function clearAllLogs() {
  const data = { logs: [], memberPoints: {} };
  save(data);
  return true;
}

function recalcPoints(data, pointRates) {
  const memberSpending = {};
  (data.logs || []).forEach(l => {
    if (l.username) {
      memberSpending[l.username] = (memberSpending[l.username] || 0) + (l.amount || 0);
    }
  });
  data.memberPoints = {};
  for (const [username, totalSpent] of Object.entries(memberSpending)) {
    data.memberPoints[username] = calcPoints(totalSpent, pointRates);
  }
}

function ratesHash(rates) {
  const canonical = (rates || []).map(r => ({ pesos: r.pesos, points: r.points })).sort((a, b) => a.pesos - b.pesos || a.points - b.points);
  return crypto.createHash('md5').update(JSON.stringify(canonical)).digest('hex');
}

function ensurePointsSync(pointRates) {
  const data = load();
  const currentHash = ratesHash(pointRates);
  if (data._ratesHash === currentHash) return;
  recalcPoints(data, pointRates);
  data._ratesHash = currentHash;
  save(data);
}

function recalcAllPoints(pointRates) {
  const data = load();
  recalcPoints(data, pointRates);
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

  const memberSpending = {};
  (data.logs || []).forEach(l => {
    if (l.username) memberSpending[l.username] = (memberSpending[l.username] || 0) + (l.amount || 0);
  });

  return {
    logs,
    memberPoints: data.memberPoints || {},
    memberSpending
  };
}

function getMemberPoints(username, pointRates) {
  if (pointRates) ensurePointsSync(pointRates);
  const data = load();
  return (data.memberPoints || {})[username] || 0;
}

module.exports = { setDataDir, appendLog, deleteLog, clearAllLogs, recalcAllPoints, ensurePointsSync, getLogs, getMemberPoints };
