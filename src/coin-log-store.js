const fs = require('fs');
const path = require('path');

let dataDir = path.join(__dirname, '..', 'data');
let logsPath = path.join(dataDir, 'coin-logs.json');

function setDataDir(dir) {
  dataDir = dir;
  logsPath = path.join(dataDir, 'coin-logs.json');
  ensureDir();
}

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function load() {
  ensureDir();
  try {
    return JSON.parse(fs.readFileSync(logsPath, 'utf8'));
  } catch (e) {
    return { logs: [], memberPoints: {} };
  }
}

function save(data) {
  ensureDir();
  const tmp = logsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, logsPath);
}

function appendLog(entry) {
  const data = load();
  const log = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    username: entry.username || '',
    amount: entry.amount || 0,
    timeAdded: entry.timeAdded || '',
    points: Math.floor((entry.amount || 0) / 10),
    timestamp: Date.now(),
    date: new Date().toISOString(),
    ip: entry.ip || '',
    mac: entry.mac || ''
  };
  data.logs.push(log);

  if (!data.memberPoints) data.memberPoints = {};
  const user = log.username;
  if (user) {
    data.memberPoints[user] = (data.memberPoints[user] || 0) + log.points;
  }

  save(data);
  return log;
}

function getLogs(filters) {
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

function getMemberPoints(username) {
  const data = load();
  return (data.memberPoints || {})[username] || 0;
}

module.exports = { setDataDir, appendLog, getLogs, getMemberPoints };
