const crypto = require('node:crypto');

const DEDUP_WINDOW_MS = 10000;

function createStore(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new TypeError('createStore requires a synchronous SQLite database.');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS coin_logs (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      source TEXT NOT NULL,
      points REAL NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      request_id TEXT,
      attendance_day TEXT,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS coin_logs_username_timestamp_idx ON coin_logs(username, timestamp);
    CREATE INDEX IF NOT EXISTS coin_logs_timestamp_idx ON coin_logs(timestamp);
    CREATE INDEX IF NOT EXISTS coin_logs_source_timestamp_idx ON coin_logs(source, timestamp);
    CREATE UNIQUE INDEX IF NOT EXISTS coin_logs_wheel_request_id_uq
      ON coin_logs(request_id) WHERE source = 'wheel' AND request_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS coin_logs_attendance_username_day_uq
      ON coin_logs(username, attendance_day)
      WHERE source = 'attendance' AND attendance_day IS NOT NULL;
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const statements = {
    insert: db.prepare(`INSERT INTO coin_logs
      (id, username, timestamp, source, points, amount, request_id, attendance_day, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    getById: db.prepare('SELECT rowid, payload FROM coin_logs WHERE id = ?'),
    all: db.prepare('SELECT rowid, payload FROM coin_logs ORDER BY rowid ASC'),
    meta: db.prepare('SELECT value FROM metadata WHERE key = ?'),
    setMeta: db.prepare(`INSERT INTO metadata(key, value) VALUES(?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`),
    memberMeta: db.prepare(`SELECT key, value FROM metadata WHERE substr(key, 1, 13) = 'memberPoints:'`),
    deleteMemberMeta: db.prepare(`DELETE FROM metadata WHERE substr(key, 1, 13) = 'memberPoints:'`),
    deleteId: db.prepare('DELETE FROM coin_logs WHERE id = ?'),
    deleteUsername: db.prepare('DELETE FROM coin_logs WHERE username = ?'),
    dailyWheels: db.prepare(`SELECT payload FROM coin_logs
      WHERE source = 'wheel' AND timestamp >= ? AND timestamp < ?`),
    recentWheelWins: db.prepare(`SELECT rowid, payload FROM coin_logs
      WHERE source = 'wheel' AND timestamp >= ? AND timestamp <= ?
      ORDER BY rowid ASC`),
    wheelByRequest: db.prepare(`SELECT rowid, payload FROM coin_logs
      WHERE source = 'wheel' AND request_id = ?`),
    amountDedupCandidates: db.prepare(`SELECT payload FROM coin_logs
      WHERE username = ? AND amount = ? AND timestamp > ? AND timestamp < ?`),
    claimableWheel: db.prepare(`SELECT rowid, payload FROM coin_logs
      WHERE source = 'wheel'
        AND (
          json_type(payload, '$.notificationSent') IS NULL
          OR json_type(payload, '$.notificationSent') IN ('null', 'false')
          OR (
            json_type(payload, '$.notificationSent') IN ('integer', 'real')
            AND json_extract(payload, '$.notificationSent') = 0
          )
          OR (
            json_type(payload, '$.notificationSent') = 'text'
            AND json_extract(payload, '$.notificationSent') = ''
          )
        )
        AND (
          COALESCE(json_extract(payload, '$.notificationLeaseUntil'), 0) = 0
          OR json_type(payload, '$.notificationLeaseUntil') = 'false'
          OR (
            json_type(payload, '$.notificationLeaseUntil') = 'text'
            AND json_extract(payload, '$.notificationLeaseUntil') = ''
          )
          OR json_extract(payload, '$.notificationLeaseUntil') < ?
        )
      ORDER BY rowid ASC LIMIT 1`),
  };

  db.function('coinlog_js_lower', value => String(value).toLowerCase());

  function transaction(fn) {
    // A Points attendance award may include this write in a wider transaction
    // that also updates the attendance entry.
    if (db.isTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) {}
      throw error;
    }
  }

  function readMeta(key, fallback) {
    const row = statements.meta.get(key);
    return row ? JSON.parse(row.value) : fallback;
  }

  function writeMeta(key, value) {
    statements.setMeta.run(key, JSON.stringify(value));
  }

  function updateMemberPoints(username, points) {
    if (!username) return;
    const key = `memberPoints:${username}`;
    const previous = readMeta(key, 0);
    writeMeta(key, parseFloat(((previous || 0) + points).toFixed(2)));
  }

  function getMemberPointsMap() {
    const memberPoints = {};
    for (const row of statements.memberMeta.all()) {
      memberPoints[row.key.slice(13)] = JSON.parse(row.value);
    }
    return memberPoints;
  }

  function parseLog(row) {
    return JSON.parse(row.payload);
  }

  function saveLog(log) {
    statements.insert.run(
      log.id,
      log.username || '',
      log.timestamp,
      log.source || 'app',
      Number(log.points) || 0,
      log.amount || 0,
      log.requestId == null ? null : log.requestId,
      log.attendanceDay == null ? null : log.attendanceDay,
      JSON.stringify(log)
    );
  }

  function updateLog(rowid, log) {
    db.prepare('UPDATE coin_logs SET points = ?, payload = ? WHERE rowid = ?')
      .run(Number(log.points) || 0, JSON.stringify(log), rowid);
  }

  function calcPoints(amount, pointRates) {
    if (!Array.isArray(pointRates) || pointRates.length === 0 || !amount || amount <= 0) return 0;
    let best = 0;
    for (const rate of pointRates) {
      const pesos = rate.pesos || 0;
      const ratePoints = rate.points || 0;
      if (pesos > 0 && ratePoints > 0) {
        const points = parseFloat(((amount / pesos) * ratePoints).toFixed(2));
        if (points > best) best = points;
      }
    }
    return best;
  }

  function logPoints(log, pointRates) {
    return log.source === 'attendance' || log.source === 'wheel'
      ? Number(log.points) || 0 : calcPoints(log.amount, pointRates);
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

  function periodBounds(periodKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(periodKey));
    if (!match) return periodBounds(getCurrentPeriodKey());
    const start = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    const end = new Date(Number(match[1]), Number(match[2]), 1);
    return [start.getTime(), end.getTime()];
  }

  function dayBounds(dayKey) {
    const [year, month, day] = dayKey.split('-').map(Number);
    const start = new Date(year, month - 1, day);
    const end = new Date(year, month - 1, day + 1);
    return [start.getTime(), end.getTime()];
  }

  function ratesHash(rates) {
    const canonical = (rates || []).map(rate => ({ pesos: rate.pesos, points: rate.points }))
      .sort((a, b) => a.pesos - b.pesos || a.points - b.points);
    return crypto.createHash('md5').update(JSON.stringify(canonical)).digest('hex');
  }

  function recalculateMemberPoints() {
    const memberPoints = {};
    for (const row of statements.all.all()) {
      const log = parseLog(row);
      if (log.username) {
        memberPoints[log.username] = parseFloat(((memberPoints[log.username] || 0) +
          (log.points || 0)).toFixed(2));
      }
    }
    statements.deleteMemberMeta.run();
    for (const [username, points] of Object.entries(memberPoints)) {
      writeMeta(`memberPoints:${username}`, points);
    }
    return memberPoints;
  }

  function recalculateRates(pointRates) {
    const rows = statements.all.all();
    for (const row of rows) {
      const log = parseLog(row);
      log.points = logPoints(log, pointRates);
      updateLog(row.rowid, log);
    }
    const memberPoints = recalculateMemberPoints();
    const hash = ratesHash(pointRates);
    writeMeta('ratesHash', hash);
    return { logs: rows.map(row => {
      const log = parseLog(row);
      log.points = logPoints(log, pointRates);
      return log;
    }), memberPoints, _ratesHash: hash };
  }

  function ensurePointsSync(pointRates) {
    const hash = ratesHash(pointRates);
    if (readMeta('ratesHash', null) === hash) return;
    transaction(() => { recalculateRates(pointRates); });
  }

  function recalcAllPoints(pointRates) {
    let result;
    transaction(() => { result = recalculateRates(pointRates); });
    return result;
  }

  function appendLog(entry, pointRates) {
    const points = calcPoints(entry.amount, pointRates);
    const timestamp = entry.timestamp || Date.now();
    const log = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      username: entry.username || '',
      amount: entry.amount || 0,
      timeAdded: entry.timeAdded || '',
      points,
      timestamp,
      date: new Date().toISOString(),
      ip: entry.ip || '',
      mac: entry.mac || '',
      source: entry.source || 'app'
    };
    transaction(() => {
      const candidates = statements.amountDedupCandidates.all(
        log.username, log.amount, Number(log.timestamp) - DEDUP_WINDOW_MS,
        Number(log.timestamp) + DEDUP_WINDOW_MS
      );
      const duplicate = candidates.some(row => {
        const existing = parseLog(row);
        return existing.username === log.username &&
          existing.amount === log.amount &&
          existing.ip === log.ip &&
          existing.mac === log.mac &&
          Math.abs(existing.timestamp - log.timestamp) < DEDUP_WINDOW_MS;
      });
      if (duplicate) return;
      saveLog(log);
      updateMemberPoints(log.username, log.points);
    });
    return log;
  }

  function appendAttendanceAward(username, day, points) {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const backdated = day === today ? Date.now()
      : new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1,
        Number(day.slice(8, 10)), 23, 59, 59).getTime();
    const log = {
      id: crypto.randomUUID(), username, attendanceDay: day, amount: 0,
      timeAdded: 'Daily attendance', points, timestamp: backdated,
      date: new Date(backdated).toISOString(), ip: '', mac: '', source: 'attendance'
    };
    try {
      return transaction(() => {
        saveLog(log);
        updateMemberPoints(username, points);
        return true;
      });
    } catch (error) {
      if (/UNIQUE constraint failed/.test(error.message)) return false;
      throw error;
    }
  }

  function deleteLog(logId) {
    return transaction(() => {
      const found = statements.getById.get(logId);
      if (!found) return false;
      statements.deleteId.run(logId);
      recalculateMemberPoints();
      return true;
    });
  }

  function deleteMemberLogs(username) {
    return transaction(() => {
      const result = statements.deleteUsername.run(username);
      if (!result.changes) return false;
      recalculateMemberPoints();
      return true;
    });
  }

  function clearAllLogs() {
    transaction(() => {
      db.exec('DELETE FROM coin_logs');
      statements.deleteMemberMeta.run();
    });
    return true;
  }

  function getDailyWheelStatus(username, maxSpinsPerDay = 1, now = Date.now()) {
    const max = Number.isInteger(maxSpinsPerDay) && maxSpinsPerDay >= 1 && maxSpinsPerDay <= 100
      ? maxSpinsPerDay : 1;
    const user = String(username || '').toLowerCase();
    const [from, to] = dayBounds(getCalendarDayKey(now));
    const spinsUsed = statements.dailyWheels.all(from, to).filter(row =>
      String(parseLog(row).username || '').toLowerCase() === user).length;
    return { spinsUsed, spinsRemaining: Math.max(0, max - spinsUsed), maxSpinsPerDay: max };
  }

  function getPreviousPeriodKey(periodKey) {
    const match = /^(\d{4})-(\d{2})$/.exec(String(periodKey || getCurrentPeriodKey()));
    if (!match) return getPreviousPeriodKey(getCurrentPeriodKey());
    return getPeriodKey(new Date(Number(match[1]), Number(match[2]) - 2, 1));
  }

  function getLogs(filters, pointRates) {
    if (pointRates) ensurePointsSync(pointRates);
    const clauses = [];
    const params = [];
    if (filters && filters.from) {
      clauses.push('timestamp >= ?');
      params.push(new Date(filters.from).getTime());
    }
    if (filters && filters.to) {
      clauses.push('timestamp < ?');
      params.push(new Date(filters.to).getTime() + 86400000);
    }
    if (filters && filters.username) {
      filters.username.toLowerCase();
      clauses.push('instr(coinlog_js_lower(username), coinlog_js_lower(?)) > 0');
      params.push(filters.username);
    }
    const rows = db.prepare(`SELECT rowid, payload FROM coin_logs${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''}
      ORDER BY timestamp DESC, rowid ASC`).all(...params);
    const logs = rows.map(parseLog)
      .map(({ notificationLeaseToken, notificationLeaseUntil, ...log }) => log);
    return { logs, memberPoints: getMemberPointsMap() };
  }

  function getMemberPoints(username, pointRates, periodKey) {
    if (pointRates) ensurePointsSync(pointRates);
    const [from, to] = periodBounds(periodKey || getCurrentPeriodKey());
    let total = 0;
    const rows = db.prepare(`SELECT points FROM coin_logs
      WHERE username = ? AND timestamp >= ? AND timestamp < ?`).all(username, from, to);
    for (const row of rows) total += Number(row.points) || 0;
    return Math.round(total * 100) / 100;
  }

  function publicWheelSpin(log) {
    const { notificationLeaseToken, notificationLeaseUntil, ...spin } = log;
    return { ...spin, createdAt: spin.timestamp };
  }

  function appendWheelSpin({
    username, requestId, station, outcomes, pointRates, expectedStake, expectedBalance,
    allowCustomStake = false, maxSpinsPerDay = 1
  }) {
    ensurePointsSync(pointRates);
    let spin;
    transaction(() => {
      const existingRow = statements.wheelByRequest.get(requestId);
      if (existingRow) {
        const existing = parseLog(existingRow);
        if (existing.username !== username) throw new Error('This spin belongs to a different member.');
        spin = existing;
        return;
      }
      const now = Date.now();
      const [todayStart, tomorrowStart] = dayBounds(getCalendarDayKey(now));
      const maxSpins = Number.isInteger(maxSpinsPerDay) && maxSpinsPerDay >= 1 && maxSpinsPerDay <= 100
        ? maxSpinsPerDay : 1;
      const dailySpins = statements.dailyWheels.all(todayStart, tomorrowStart).filter(row =>
        String(parseLog(row).username || '').toLowerCase() === String(username || '').toLowerCase()).length;
      if (dailySpins >= maxSpins) {
        const error = new Error('You have reached the daily spin limit.');
        error.status = 429;
        throw error;
      }
      const [from, to] = periodBounds(getCurrentPeriodKey());
      const balanceRows = db.prepare(`SELECT points FROM coin_logs
        WHERE username = ? AND timestamp >= ? AND timestamp < ?`).all(username, from, to);
      const balanceCents = balanceRows.reduce((sum, row) => sum +
        Math.round((Number(row.points) || 0) * 100), 0);
      const balanceSnapshot = expectedBalance === undefined ? expectedStake : expectedBalance;
      if (balanceSnapshot !== undefined && balanceCents !== Math.round(balanceSnapshot * 100)) {
        throw new Error('Balance changed. Reload Betting Games and review the new stake before spinning.');
      }
      if (!Number.isSafeInteger(balanceCents) || balanceCents <= 0) {
        throw new Error('No points available to spin this month.');
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
      const multiplier = require('./wheel-config').pickOutcome(outcomes);
      const payoutCents = Math.round(stakeCents * multiplier);
      if (!Number.isSafeInteger(payoutCents)) throw new Error('Points balance is too large to spin safely.');
      const netCents = payoutCents - stakeCents;
      const newBalanceCents = balanceCents + netCents;
      if (!Number.isSafeInteger(newBalanceCents)) throw new Error('Points balance is too large to spin safely.');
      spin = {
        id: crypto.randomUUID(), requestId, source: 'wheel', username,
        station: String(station || 'PC').slice(0, 60), amount: 0,
        timeAdded: `Wheel ${multiplier}x`, timestamp: now, date: new Date(now).toISOString(),
        period: getCurrentPeriodKey(), multiplier, outcomes: outcomes.map(item => ({ ...item })),
        stake: stakeCents / 100, payout: payoutCents / 100,
        points: netCents / 100, net: netCents / 100, balance: newBalanceCents / 100,
        notificationSent: false
      };
      saveLog(spin);
      updateMemberPoints(username, spin.net);
    });
    return publicWheelSpin(spin);
  }

  function getWheelSpin(requestId) {
    const row = statements.wheelByRequest.get(requestId);
    return row ? publicWheelSpin(parseLog(row)) : null;
  }

  function getRecentWheelWins(since, now = Date.now()) {
    const earliest = Math.max(now - 120000, since);
    const logs = statements.recentWheelWins.all(earliest, now - 6000).map(parseLog)
      .filter(log => Number(log.multiplier) > 1 &&
        Number(log.timestamp) >= earliest && Number(log.timestamp) <= now - 6000);
    return logs.slice(-30)
      .map(log => ({
        id: log.id, username: log.username, station: log.station,
        multiplier: log.multiplier, createdAt: log.timestamp
      }));
  }

  function claimWheelNotification() {
    const now = Date.now();
    return transaction(() => {
      const row = statements.claimableWheel.get(now);
      if (!row) return null;
      const log = parseLog(row);
      if (log.notificationSent || (log.notificationLeaseUntil && log.notificationLeaseUntil >= now)) return null;
      const leaseToken = crypto.randomBytes(16).toString('hex');
      log.notificationLeaseUntil = now + 30000;
      log.notificationLeaseToken = leaseToken;
      updateLog(row.rowid, log);
      return { spin: { ...log, createdAt: log.timestamp }, leaseToken };
    });
  }

  function acknowledgeWheelNotification(requestId, leaseToken) {
    return transaction(() => {
      const row = statements.wheelByRequest.get(requestId);
      if (!row) return false;
      const log = parseLog(row);
      if (log.notificationLeaseToken !== leaseToken) return false;
      log.notificationSent = true;
      delete log.notificationLeaseToken;
      delete log.notificationLeaseUntil;
      updateLog(row.rowid, log);
      return true;
    });
  }

  function getLeaderboard(limit, pointRates, periodKey) {
    if (pointRates) ensurePointsSync(pointRates);
    const [from, to] = periodBounds(periodKey || getCurrentPeriodKey());
    const totals = {};
    const rows = db.prepare(`SELECT username, points FROM coin_logs
      WHERE timestamp >= ? AND timestamp < ?`).all(from, to);
    for (const row of rows) {
      const username = String(row.username || '').trim();
      const points = Number(row.points) || 0;
      if (username) totals[username] = (totals[username] || 0) + points;
    }
    return Object.entries(totals)
      .map(([username, points]) => ({ username, points: Math.round(points * 100) / 100 }))
      .filter(member => member.points > 0)
      .sort((a, b) => b.points - a.points || a.username.localeCompare(b.username))
      .slice(0, Math.max(1, Math.min(20, Number(limit) || 5)));
  }

  return {
    appendLog,
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
    getLeaderboard,
    getPeriodKey,
    getCurrentPeriodKey,
    getPreviousPeriodKey,
    getCalendarDayKey,
    getDailyWheelStatus
  };
}

module.exports = { createStore };