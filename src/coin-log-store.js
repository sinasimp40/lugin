const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDailyUsage } = require('./withdrawal-day');

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
  const signed = { logs: data.logs || [], memberPoints: data.memberPoints || {} };
  if (Array.isArray(data.withdrawals)) signed.withdrawals = data.withdrawals;
  const payload = JSON.stringify(signed);
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
    return { logs: [], memberPoints: {}, withdrawals: [] };
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
  return log.source === 'attendance' || log.source === 'wheel' ||
    log.source === 'withdrawal' || log.source === 'withdrawal-refund' ||
    log.source === 'manual-adjustment'
    ? Number(log.points) || 0 : calcPoints(log.amount, pointRates);
}

const MEMBER_RE = /^mem-[a-z0-9._-]{1,80}$/i;
const FINAL_WITHDRAWAL_STATES = new Set(['success', 'failed', 'unconfirmed']);
function withdrawalRows(data) {
  if (!Array.isArray(data.withdrawals)) data.withdrawals = [];
  return data.withdrawals;
}
function publicWithdrawal(record) {
  if (!record) return null;
  const { notificationLeaseToken, notificationLeaseUntil, notificationLeaseVersion, ...row } = record;
  return row;
}
function withdrawalBalance(data, username) {
  return Math.round((data.logs || []).filter(log => log.username === username)
    .reduce((sum, log) => sum + (Number(log.points) || 0), 0) * 100) / 100;
}
function appendWithdrawalPoints(data, record, source, points, timeAdded) {
  const now = Date.now();
  const log = {
    id: crypto.randomUUID(), username: record.username, amount: 0, withdrawalAmount: record.amount,
    timeAdded, points, timestamp: now, date: new Date(now).toISOString(),
    ip: '', mac: '', source, requestId: record.requestId
  };
  data.logs.push(log);
  data.memberPoints ||= {};
  data.memberPoints[record.username] = parseFloat(((data.memberPoints[record.username] || 0) + points).toFixed(2));
}
function validateWithdrawal({ username, requestId, amount, min, max }) {
  if (typeof username !== 'string' || !MEMBER_RE.test(username)) throw new Error('Invalid member username.');
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) throw new Error('Invalid withdrawal request ID.');
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000) throw new Error('Withdrawal amount must be a whole number from 1 to 1000.');
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max > 1000 || min > max ||
      amount < min || amount > max) throw new Error('Withdrawal amount is outside the configured limits.');
}
function touchWithdrawal(record) {
  record.updatedAt = Date.now();
  record.timestamp = record.createdAt;
}

function manualAdjustmentError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function validateManualAdjustment(params) {
  const { username, delta, reason, requestId } = params && typeof params === 'object' ? params : {};
  if (typeof username !== 'string' || !MEMBER_RE.test(username)) {
    throw manualAdjustmentError('Invalid member username.', 400);
  }
  if (typeof requestId !== 'string' ||
      !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(requestId)) {
    throw manualAdjustmentError('Invalid manual adjustment request ID.', 400);
  }
  if (typeof delta !== 'number' || !Number.isFinite(delta) || delta === 0 ||
      Math.abs(delta) > 1000000 || Number(delta.toFixed(2)) !== delta) {
    throw manualAdjustmentError('Point adjustment must be a nonzero amount up to 1,000,000 with at most two decimal places.', 400);
  }
  if (typeof reason !== 'string') {
    throw manualAdjustmentError('Reason must be a string between 3 and 300 characters.', 400);
  }
  const normalizedReason = reason.replace(/\r\n/g, ' ').trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 300 ||
      /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(normalizedReason)) {
    throw manualAdjustmentError('Reason must be 3 to 300 characters and contain no control characters.', 400);
  }
  return {
    username,
    deltaCents: Math.round(delta * 100),
    reason: normalizedReason,
    requestId: requestId.toLowerCase()
  };
}

function manualAdjustmentBalanceCents(data, username) {
  return (data.logs || []).filter(log => log.username === username)
    .reduce((sum, log) => sum + Math.round((Number(log.points) || 0) * 100), 0);
}

function adjustMemberPoints(params, pointRates) {
  const input = validateManualAdjustment(params);
  ensurePointsSync(pointRates);
  let result;
  loadModifySave(data => {
    data.logs ||= [];
    const existing = data.logs.find(log => log.source === 'manual-adjustment' &&
      String(log.requestId || '').toLowerCase() === input.requestId);
    if (existing) {
      if (existing.username !== input.username ||
          Math.round((Number(existing.points) || 0) * 100) !== input.deltaCents ||
          existing.reason !== input.reason) {
        throw manualAdjustmentError('This request ID was already used for a different point adjustment.', 409);
      }
      result = {
        log: existing,
        balance: Math.round(manualAdjustmentBalanceCents(data, input.username)) / 100,
        replayed: true
      };
      return;
    }
    const blocked = withdrawalRows(data).some(record => record.username === input.username &&
      ['reserved', 'sending', 'unconfirmed'].includes(record.status));
    if (blocked) {
      throw manualAdjustmentError('Cannot adjust points while this member has an unresolved withdrawal.', 409);
    }
    const balanceCents = manualAdjustmentBalanceCents(data, input.username);
    const nextBalanceCents = balanceCents + input.deltaCents;
    if (!Number.isSafeInteger(balanceCents) || !Number.isSafeInteger(nextBalanceCents)) {
      throw manualAdjustmentError('Member point balance is too large to adjust safely.', 409);
    }
    if (nextBalanceCents < 0) {
      throw manualAdjustmentError('Point adjustment would make the member balance negative.', 409);
    }
    const now = Date.now();
    const log = {
      id: crypto.randomUUID(), username: input.username, amount: 0,
      timeAdded: `Manual point adjustment: ${input.deltaCents > 0 ? 'credit' : 'debit'}`,
      points: input.deltaCents / 100, timestamp: now, date: new Date(now).toISOString(),
      ip: '', mac: '', source: 'manual-adjustment', requestId: input.requestId,
      reason: input.reason
    };
    data.logs.push(log);
    data.memberPoints ||= {};
    data.memberPoints[input.username] = nextBalanceCents / 100;
    result = { log, balance: nextBalanceCents / 100, replayed: false };
  });
  return result;
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

function getCalendarDayKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return getCalendarDayKey(Date.now());
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getDailyWheelStatus(username, maxSpinsPerDay = 1, now = Date.now()) {
  const max = Number.isInteger(maxSpinsPerDay) && maxSpinsPerDay >= 1 && maxSpinsPerDay <= 100
    ? maxSpinsPerDay : 1;
  const user = String(username || '').toLowerCase();
  const day = getCalendarDayKey(now);
  const spinsUsed = (load().logs || []).filter(log =>
    log.source === 'wheel' &&
    String(log.username || '').toLowerCase() === user &&
    getCalendarDayKey(log.timestamp) === day
  ).length;
  return {
    spinsUsed,
    spinsRemaining: Math.max(0, max - spinsUsed),
    maxSpinsPerDay: max
  };
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
    const log = data.logs[idx];
    if (log.source === 'withdrawal' && withdrawalRows(data).some(w =>
      w.requestId === log.requestId && ['reserved', 'sending', 'unconfirmed'].includes(w.status))) {
      throw new Error('Cannot delete a withdrawal with an unresolved hold.');
    }
    found = true;
    data.logs.splice(idx, 1);
    recalcPoints(data);
  });
  return found;
}

function clearAllLogs() {
  const data = load();
  if (withdrawalRows(data).some(w => ['reserved', 'sending', 'unconfirmed'].includes(w.status))) {
    throw new Error('Cannot clear logs while a withdrawal hold is unresolved.');
  }
  data.logs = [];
  data.memberPoints = {};
  data.withdrawals = [];
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
  logs = logs.map(({ notificationLeaseToken, notificationLeaseUntil, ...log }) => log);

  return {
    logs,
    memberPoints: data.memberPoints || {}
  };
}

function getMemberPoints(username, pointRates) {
  if (pointRates) ensurePointsSync(pointRates);
  const data = load();
  const total = (data.logs || [])
    .filter(log => log.username === username)
    .reduce((sum, log) => sum + (Number(log.points) || 0), 0);
  return Math.round(total * 100) / 100;
}

function appendWheelSpin({
  username, requestId, station, outcomes, pointRates, expectedStake, expectedBalance,
  allowCustomStake = false, maxSpinsPerDay = 1, game = 'wheel', dice, choice
}) {
  ensurePointsSync(pointRates);
  let spin;
  loadModifySave(data => {
    const existing = (data.logs || []).find(log => log.source === 'wheel' && log.requestId === requestId);
    if (existing) {
      if (existing.username !== username) throw new Error('This spin belongs to a different member.');
      if ((existing.game || 'wheel') !== game || (game === 'dice' && existing.choice !== choice)) {
        throw new Error('This request belongs to a different game or dice choice.');
      }
      spin = existing;
      return;
    }
    const now = Date.now();
    const today = getCalendarDayKey(now);
    const maxSpins = Number.isInteger(maxSpinsPerDay) && maxSpinsPerDay >= 1 && maxSpinsPerDay <= 100
      ? maxSpinsPerDay : 1;
    const dailySpins = (data.logs || []).filter(log =>
      log.source === 'wheel' &&
      String(log.username || '').toLowerCase() === String(username || '').toLowerCase() &&
      getCalendarDayKey(log.timestamp) === today
    ).length;
    if (dailySpins >= maxSpins) {
      const error = new Error('You have reached the daily spin limit.');
      error.status = 429;
      throw error;
    }
    const balanceCents = (data.logs || [])
      .filter(log => log.username === username)
      .reduce((sum, log) => sum + Math.round((Number(log.points) || 0) * 100), 0);
    const balanceSnapshot = expectedBalance === undefined ? expectedStake : expectedBalance;
    if (balanceSnapshot !== undefined && balanceCents !== Math.round(balanceSnapshot * 100)) {
      throw new Error('Balance changed. Reload Betting Games and review the new stake before spinning.');
    }
    if (!Number.isSafeInteger(balanceCents) || balanceCents <= 0) {
      throw new Error('No points available to spin.');
    }
    if (allowCustomStake && expectedBalance === undefined) {
      throw new Error('The current balance snapshot is required for a custom stake.');
    }
    const stakeCents = expectedStake === undefined ? balanceCents : Math.round(expectedStake * 100);
    if (!Number.isSafeInteger(stakeCents) || stakeCents <= 0 || stakeCents > balanceCents) {
      throw new Error('Stake must be positive and no greater than your current balance.');
    }
    if (!allowCustomStake && stakeCents !== balanceCents) {
      throw new Error('This game requires staking your full balance.');
    }
    if (!['wheel', 'dice'].includes(game)) throw new Error('Invalid betting game.');
    const rolled = game === 'dice' ? require('./dice-game').rollDice(choice, dice) : null;
    const multiplier = rolled ? rolled.multiplier : require('./wheel-config').pickOutcome(outcomes);
    const payoutCents = Math.round(stakeCents * multiplier);
    if (!Number.isSafeInteger(payoutCents)) throw new Error('Points balance is too large to spin safely.');
    const netCents = payoutCents - stakeCents;
    const newBalanceCents = balanceCents + netCents;
    if (!Number.isSafeInteger(newBalanceCents)) throw new Error('Points balance is too large to spin safely.');
    spin = {
      id: crypto.randomUUID(), requestId, source: 'wheel', username,
      station: String(station || 'PC').slice(0, 60), amount: 0,
      timeAdded: `${game === 'dice' ? 'HIGH / LOW DICE' : 'Wheel'} ${multiplier}x`, timestamp: now, date: new Date(now).toISOString(),
      game, ...(rolled || {}),
      period: getCurrentPeriodKey(), multiplier, outcomes: outcomes.map(item => ({ ...item })),
      stake: stakeCents / 100, payout: payoutCents / 100,
      points: netCents / 100, net: netCents / 100, balance: newBalanceCents / 100,
      notificationSent: false
    };
    data.logs.push(spin);
    if (!data.memberPoints) data.memberPoints = {};
    data.memberPoints[username] = Math.round(((data.memberPoints[username] || 0) + spin.net) * 100) / 100;
  });
  return publicWheelSpin(spin);
}

function publicWheelSpin(log) {
  const { notificationLeaseToken, notificationLeaseUntil, ...spin } = log;
  return { ...spin, createdAt: spin.timestamp };
}

function getWheelSpin(requestId) {
  const log = (load().logs || []).find(entry => entry.source === 'wheel' && entry.requestId === requestId);
  return log ? publicWheelSpin(log) : null;
}

function getRecentWheelWins(since, now = Date.now()) {
  const earliest = Math.max(now - 120000, since);
  return (load().logs || [])
    .filter(log => log.source === 'wheel' && Number(log.multiplier) > 1 &&
      Number(log.timestamp) >= earliest && Number(log.timestamp) <= now - 6000)
    .slice(-30)
    .map(log => ({
      id: log.id, username: log.username, station: log.station,
      multiplier: log.multiplier, game: log.game || 'wheel',
      ...(log.game === 'dice' ? { choice: log.choice } : {}), createdAt: log.timestamp
    }));
}

function claimWheelNotification() {
  let claim = null;
  const now = Date.now();
  if (!(load().logs || []).some(entry => entry.source === 'wheel' && !entry.notificationSent &&
    (!entry.notificationLeaseUntil || entry.notificationLeaseUntil < now))) return null;
  loadModifySave(data => {
    const now = Date.now();
    const log = (data.logs || []).find(entry => entry.source === 'wheel' && !entry.notificationSent &&
      (!entry.notificationLeaseUntil || entry.notificationLeaseUntil < now));
    if (!log) return;
    const leaseToken = crypto.randomBytes(16).toString('hex');
    log.notificationLeaseUntil = now + 30000;
    log.notificationLeaseToken = leaseToken;
    claim = { spin: { ...log, createdAt: log.timestamp }, leaseToken };
  });
  return claim;
}

function acknowledgeWheelNotification(requestId, leaseToken, uncertain = false) {
  let acknowledged = false;
  loadModifySave(data => {
    const log = (data.logs || []).find(entry => entry.source === 'wheel' && entry.requestId === requestId);
    if (!log || log.notificationLeaseToken !== leaseToken) return;
    if (uncertain) {
      log.notificationLeaseUntil = Number.MAX_SAFE_INTEGER;
      log.notificationReview = true;
      acknowledged = true;
      return;
    }
    log.notificationSent = true;
    delete log.notificationLeaseToken;
    delete log.notificationLeaseUntil;
    acknowledged = true;
  });
  return acknowledged;
}

function validateDailyLimit(dailyLimit) {
  if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1000) {
    throw new Error('Daily withdrawal limit must be a whole number from 0 to 1000.');
  }
}

function getDailyWithdrawalUsage(username, timestamp = Date.now()) {
  return getDailyUsage(withdrawalRows(load()), username, timestamp);
}

function throwDailyLimitError(usage) {
  const reset = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short'
  }).format(new Date(usage.resetAt));
  throw new Error(`Daily withdrawal limit reached; it resets at midnight (UTC+8) (${reset}). No points were deducted.`);
}

function reserveWithdrawal({
  username, requestId, amount, station, pointRates, min, max,
  dailyLimit = 0, timestamp = Date.now()
}) {
  validateWithdrawal({ username, requestId, amount, min, max });
  ensurePointsSync(pointRates);
  let result;
  loadModifySave(data => {
    const withdrawals = withdrawalRows(data);
    const existing = withdrawals.find(item => item.requestId === requestId);
    if (existing) {
      if (existing.username !== username) throw new Error('This withdrawal belongs to a different member.');
      if (existing.amount !== amount) throw new Error('This withdrawal request ID was already used for another amount.');
      result = publicWithdrawal(existing);
      return;
    }
    validateDailyLimit(dailyLimit);
    if (withdrawals.some(item =>
        ['reserved', 'sending', 'unconfirmed'].includes(item.status))) {
      throw new Error('Another withdrawal is unresolved.');
    }
    if (dailyLimit > 0) {
      const usage = getDailyUsage(withdrawals, username, timestamp);
      if (usage.used >= dailyLimit) throwDailyLimitError(usage);
    }
    const balance = withdrawalBalance(data, username);
    if (balance < amount) throw new Error('Insufficient points balance.');
    const now = timestamp;
    const record = {
      id: crypto.randomUUID(), requestId, username,
      station: String(station || 'PC').slice(0, 60), amount,
      status: 'reserved', createdAt: now, timestamp: now, updatedAt: now,
      reason: null, balance: Math.round((balance - amount) * 100) / 100,
      notificationVersion: 0, notificationSentVersion: 0
    };
    withdrawals.push(record);
    appendWithdrawalPoints(data, record, 'withdrawal', -amount, 'Cash withdrawal');
    result = publicWithdrawal(record);
  });
  return result;
}

function getWithdrawal(requestId) {
  return publicWithdrawal(withdrawalRows(load()).find(item => item.requestId === requestId));
}

function getUnresolvedWithdrawal(username) {
  const rows = withdrawalRows(load()).filter(item =>
    (!username || item.username === username) &&
    ['reserved', 'sending', 'unconfirmed'].includes(item.status));
  rows.sort((a, b) => a.createdAt - b.createdAt);
  return publicWithdrawal(rows[0]);
}

function listWithdrawals(limit = 50) {
  const count = Number.isSafeInteger(limit) ? Math.max(0, Math.min(500, limit)) : 50;
  return withdrawalRows(load()).slice().sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, count).map(publicWithdrawal);
}

function getLastConfirmedWithdrawalAt() {
  return withdrawalRows(load()).reduce((latest, record) =>
    record.status === 'success' ? Math.max(latest, Number(record.updatedAt) || 0) : latest, 0);
}

function markWithdrawalSending(requestId) {
  let changed = false;
  loadModifySave(data => {
    const record = withdrawalRows(data).find(item => item.requestId === requestId);
    if (!record || record.status !== 'reserved') return;
    record.status = 'sending';
    touchWithdrawal(record);
    changed = true;
  });
  return changed;
}

function setWithdrawalFinal(data, record, status, reason) {
  const oldStatus = record.status;
  record.status = status;
  record.reason = reason == null ? null : String(reason).slice(0, 500);
  touchWithdrawal(record);
  if (status === 'failed' && oldStatus !== 'failed' && !record.refunded) {
    appendWithdrawalPoints(data, record, 'withdrawal-refund', record.amount, 'Withdrawal refund');
    record.refunded = true;
  }
  if (oldStatus !== status) {
    record.notificationVersion = (record.notificationVersion || 0) + 1;
    delete record.notificationLeaseToken;
    delete record.notificationLeaseUntil;
    delete record.notificationLeaseVersion;
  }
  record.balance = withdrawalBalance(data, record.username);
}

function finishWithdrawal(requestId, { status, reason } = {}) {
  if (!FINAL_WITHDRAWAL_STATES.has(status)) throw new Error('Invalid withdrawal final status.');
  let result = false;
  loadModifySave(data => {
    const record = withdrawalRows(data).find(item => item.requestId === requestId);
    if (!record || !(record.status === 'sending' || (record.status === 'reserved' && status === 'failed'))) return;
    setWithdrawalFinal(data, record, status, reason);
    result = publicWithdrawal(record);
  });
  return result;
}

function resolveWithdrawal(requestId, { released, reason } = {}) {
  if (typeof released !== 'boolean') throw new Error('A release decision is required.');
  let result = false;
  loadModifySave(data => {
    const record = withdrawalRows(data).find(item => item.requestId === requestId);
    if (!record || record.status !== 'unconfirmed') return;
    setWithdrawalFinal(data, record, released ? 'success' : 'failed', reason);
    result = publicWithdrawal(record);
  });
  return result;
}

function recoverWithdrawals() {
  let recovered = 0;
  loadModifySave(data => {
    for (const record of withdrawalRows(data)) {
      if (record.status === 'reserved') {
        setWithdrawalFinal(data, record, 'failed', 'Recovered before dispatch; withdrawal was not sent.');
        recovered++;
      } else if (record.status === 'sending') {
        setWithdrawalFinal(data, record, 'unconfirmed', 'Dispatch outcome unknown after restart.');
        recovered++;
      }
    }
  });
  return recovered;
}

function recordRejectedWithdrawal({ username, requestId, amount, station, reason }) {
  if (typeof username !== 'string' || !MEMBER_RE.test(username)) throw new Error('Invalid member username.');
  if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) throw new Error('Invalid withdrawal request ID.');
  let result;
  loadModifySave(data => {
    const withdrawals = withdrawalRows(data);
    const existing = withdrawals.find(item => item.requestId === requestId);
    if (existing) {
      result = publicWithdrawal(existing);
      return;
    }
    const now = Date.now();
    const record = {
      id: crypto.randomUUID(), requestId, username,
      station: String(station || 'PC').slice(0, 60),
      amount: Number.isSafeInteger(amount) && amount >= 1 && amount <= 1000 ? amount : null,
      status: 'failed', createdAt: now, timestamp: now, updatedAt: now,
      reason: String(reason || 'Withdrawal rejected.').slice(0, 500),
      balance: withdrawalBalance(data, username), notificationVersion: 1,
      notificationSentVersion: 0
    };
    withdrawals.push(record);
    result = publicWithdrawal(record);
  });
  return result;
}

function claimWithdrawalNotification() {
  let claim = null;
  loadModifySave(data => {
    const now = Date.now();
    const record = withdrawalRows(data).find(item =>
      FINAL_WITHDRAWAL_STATES.has(item.status) &&
      (item.notificationSentVersion || 0) < (item.notificationVersion || 0) &&
      (!item.notificationLeaseUntil || item.notificationLeaseUntil < now));
    if (!record) return;
    const leaseToken = crypto.randomBytes(16).toString('hex');
    record.notificationLeaseUntil = now + 30000;
    record.notificationLeaseToken = leaseToken;
    record.notificationLeaseVersion = record.notificationVersion;
    claim = { withdrawal: publicWithdrawal(record), leaseToken };
  });
  return claim;
}

function acknowledgeWithdrawalNotification(requestId, leaseToken, uncertain = false) {
  let acknowledged = false;
  loadModifySave(data => {
    const record = withdrawalRows(data).find(item => item.requestId === requestId);
    if (!record || record.notificationLeaseToken !== leaseToken ||
        record.notificationLeaseVersion !== record.notificationVersion) return;
    if (uncertain) {
      record.notificationLeaseUntil = Number.MAX_SAFE_INTEGER;
      record.notificationReview = true;
      acknowledged = true;
      return;
    }
    record.notificationSentVersion = record.notificationLeaseVersion;
    delete record.notificationLeaseToken;
    delete record.notificationLeaseUntil;
    delete record.notificationLeaseVersion;
    acknowledged = true;
  });
  return acknowledged;
}

function getLeaderboard(limit, pointRates, periodKey) {
  if (pointRates) ensurePointsSync(pointRates);
  const targetPeriod = periodKey || getCurrentPeriodKey();
  const totals = {};
  for (const log of load().logs || []) {
    const username = String(log.username || '').trim();
    const points = Number(log.points) || 0;
    if (!username || ['withdrawal', 'withdrawal-refund'].includes(log.source) ||
        getPeriodKey(log.timestamp) !== targetPeriod) continue;
    totals[username] = (totals[username] || 0) + points;
  }
  return Object.entries(totals)
    .map(([username, points]) => ({ username, points: Math.round(points * 100) / 100 }))
    .filter(member => member.points > 0)
    .sort((a, b) => b.points - a.points || a.username.localeCompare(b.username))
    .slice(0, Math.max(1, Math.min(20, Number(limit) || 5)));
}

function deleteMemberLogs(username) {
  let found = false;
  loadModifySave(function(data) {
    if (withdrawalRows(data).some(w => w.username === username &&
      ['reserved', 'sending', 'unconfirmed'].includes(w.status))) {
      throw new Error('Cannot delete member logs while a withdrawal hold is unresolved.');
    }
    const before = (data.logs || []).length;
    const withdrawalCount = withdrawalRows(data).length;
    data.logs = (data.logs || []).filter(l => l.username !== username);
    data.withdrawals = data.withdrawals.filter(w => w.username !== username);
    if (data.logs.length === before && data.withdrawals.length === withdrawalCount) return;
    found = true;
    recalcPoints(data);
  });
  return found;
}

module.exports = {
  setDataDir,
  appendLog,
  adjustMemberPoints,
  appendAttendanceAward,
  deleteLog,
  deleteMemberLogs,
  clearAllLogs,
  recalcAllPoints,
  ensurePointsSync,
  getLogs,
  getMemberPoints,
  appendWheelSpin,
  getWheelSpin,
  getRecentWheelWins,
  claimWheelNotification,
  acknowledgeWheelNotification,
  reserveWithdrawal,
  getDailyWithdrawalUsage,
  getWithdrawal,
  getUnresolvedWithdrawal,
  listWithdrawals,
  getLastConfirmedWithdrawalAt,
  markWithdrawalSending,
  finishWithdrawal,
  resolveWithdrawal,
  recoverWithdrawals,
  recordRejectedWithdrawal,
  claimWithdrawalNotification,
  acknowledgeWithdrawalNotification,
  getLeaderboard,
  getPeriodKey,
  getCurrentPeriodKey,
  getPreviousPeriodKey,
  getCalendarDayKey,
  getDailyWheelStatus,
  useSqlite(db) {
    const store = require('./coin-log-sqlite-store').createStore(db);
    for (const name of Object.keys(module.exports)) {
      if (name === 'setDataDir' || name === 'useSqlite') continue;
      if (typeof store[name] !== 'function') throw new Error(`SQLite coin store missing ${name}`);
    }
    for (const [name, fn] of Object.entries(store)) module.exports[name] = fn;
  }
};
