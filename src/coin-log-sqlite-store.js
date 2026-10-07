const crypto = require('node:crypto');
const { getDailyUsage } = require('./withdrawal-day');

const DEDUP_WINDOW_MS = 10000;
const MEMBER_RE = /^mem-[a-z0-9._-]{1,80}$/i;
const FINAL_WITHDRAWAL_STATES = new Set(['success', 'failed', 'unconfirmed']);

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
    CREATE TABLE IF NOT EXISTS withdrawals (
      request_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS withdrawals_request_id_uq ON withdrawals(request_id);
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
    deleteWithdrawalsByUsername: db.prepare('DELETE FROM withdrawals WHERE username = ?'),
    getWithdrawal: db.prepare('SELECT rowid, payload FROM withdrawals WHERE request_id = ?'),
    allWithdrawals: db.prepare('SELECT rowid, payload FROM withdrawals ORDER BY rowid ASC'),
    unresolvedAny: db.prepare(`SELECT request_id FROM withdrawals
      WHERE status IN ('reserved', 'sending', 'unconfirmed') LIMIT 1`),
    unresolvedMember: db.prepare(`SELECT request_id FROM withdrawals
      WHERE username = ? AND status IN ('reserved', 'sending', 'unconfirmed') LIMIT 1`),
    insertWithdrawal: db.prepare(`INSERT INTO withdrawals(request_id, username, status, created_at, payload)
      VALUES (?, ?, ?, ?, ?)`),
    updateWithdrawal: db.prepare(`UPDATE withdrawals SET status = ?, payload = ? WHERE rowid = ?`),
    deleteWithdrawals: db.prepare('DELETE FROM withdrawals'),
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

  function publicWithdrawal(record) {
    if (!record) return null;
    const { notificationLeaseToken, notificationLeaseUntil, notificationLeaseVersion, ...row } = record;
    return row;
  }

  function withdrawalBalance(username) {
    const rows = db.prepare('SELECT points FROM coin_logs WHERE username = ?').all(username);
    return Math.round(rows.reduce((sum, row) => sum + (Number(row.points) || 0), 0) * 100) / 100;
  }

  function findWithdrawal(requestId) {
    const row = statements.getWithdrawal.get(requestId);
    return row ? { rowid: row.rowid, record: JSON.parse(row.payload) } : null;
  }

  function saveWithdrawal(record, rowid) {
    if (rowid) statements.updateWithdrawal.run(record.status, JSON.stringify(record), rowid);
    else statements.insertWithdrawal.run(record.requestId, record.username, record.status,
      record.createdAt, JSON.stringify(record));
  }

  function addWithdrawalPoints(record, source, points, timeAdded) {
    const now = Date.now();
    saveLog({
      id: crypto.randomUUID(), username: record.username, amount: 0,
      withdrawalAmount: record.amount, timeAdded, points, timestamp: now,
      date: new Date(now).toISOString(), ip: '', mac: '', source, requestId: record.requestId
    });
    updateMemberPoints(record.username, points);
  }

  function validateWithdrawal({ username, requestId, amount, min, max }) {
    if (typeof username !== 'string' || !MEMBER_RE.test(username)) throw new Error('Invalid member username.');
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) throw new Error('Invalid withdrawal request ID.');
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000) throw new Error('Withdrawal amount must be a whole number from 1 to 1000.');
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max > 1000 || min > max ||
        amount < min || amount > max) throw new Error('Withdrawal amount is outside the configured limits.');
  }

  function validateDailyLimit(dailyLimit) {
    if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1000) {
      throw new Error('Daily withdrawal limit must be a whole number from 0 to 1000.');
    }
  }

  function getDailyWithdrawalUsage(username, timestamp = Date.now()) {
    const withdrawals = statements.allWithdrawals.all().map(row => JSON.parse(row.payload));
    return getDailyUsage(withdrawals, username, timestamp);
  }

  function throwDailyLimitError(usage) {
    const reset = new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short'
    }).format(new Date(usage.resetAt));
    throw new Error(`Daily withdrawal limit reached; it resets at midnight (UTC+8) (${reset}). No points were deducted.`);
  }

  function touchWithdrawal(record) {
    record.updatedAt = Date.now();
    record.timestamp = record.createdAt;
  }

  function finalizeWithdrawal(record, status, reason) {
    const oldStatus = record.status;
    record.status = status;
    record.reason = reason == null ? null : String(reason).slice(0, 500);
    touchWithdrawal(record);
    if (status === 'failed' && oldStatus !== 'failed' && !record.refunded) {
      addWithdrawalPoints(record, 'withdrawal-refund', record.amount, 'Withdrawal refund');
      record.refunded = true;
    }
    if (oldStatus !== status) {
      record.notificationVersion = (record.notificationVersion || 0) + 1;
      delete record.notificationLeaseToken;
      delete record.notificationLeaseUntil;
      delete record.notificationLeaseVersion;
    }
    record.balance = withdrawalBalance(record.username);
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
    return log.source === 'attendance' || log.source === 'wheel' ||
      log.source === 'withdrawal' || log.source === 'withdrawal-refund' ||
      log.source === 'manual-adjustment'
      ? Number(log.points) || 0 : calcPoints(log.amount, pointRates);
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

  function manualAdjustmentBalanceCents(username) {
    const rows = db.prepare('SELECT points FROM coin_logs WHERE username = ?').all(username);
    return rows.reduce((sum, row) => sum + Math.round((Number(row.points) || 0) * 100), 0);
  }

  function adjustMemberPoints(params, pointRates) {
    const input = validateManualAdjustment(params);
    ensurePointsSync(pointRates);
    return transaction(() => {
      const existingRow = db.prepare(`SELECT rowid, payload FROM coin_logs
        WHERE source = 'manual-adjustment' AND lower(request_id) = ?
        ORDER BY rowid ASC LIMIT 1`).get(input.requestId);
      if (existingRow) {
        const existing = parseLog(existingRow);
        if (existing.username !== input.username ||
            Math.round((Number(existing.points) || 0) * 100) !== input.deltaCents ||
            existing.reason !== input.reason) {
          throw manualAdjustmentError('This request ID was already used for a different point adjustment.', 409);
        }
        return {
          log: existing,
          balance: manualAdjustmentBalanceCents(input.username) / 100,
          replayed: true
        };
      }
      if (statements.unresolvedMember.get(input.username)) {
        throw manualAdjustmentError('Cannot adjust points while this member has an unresolved withdrawal.', 409);
      }
      const balanceCents = manualAdjustmentBalanceCents(input.username);
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
      saveLog(log);
      writeMeta(`memberPoints:${input.username}`, nextBalanceCents / 100);
      return { log, balance: nextBalanceCents / 100, replayed: false };
    });
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
    return require('./daily-betting-game').dayKey(value);
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
      const log = parseLog(found);
      if (log.source === 'withdrawal' && statements.unresolvedMember.get(log.username) &&
          findWithdrawal(log.requestId) && ['reserved', 'sending', 'unconfirmed'].includes(findWithdrawal(log.requestId).record.status)) {
        throw new Error('Cannot delete a withdrawal with an unresolved hold.');
      }
      statements.deleteId.run(logId);
      recalculateMemberPoints();
      return true;
    });
  }

  function deleteMemberLogs(username) {
    return transaction(() => {
      if (statements.unresolvedMember.get(username)) {
        throw new Error('Cannot delete member logs while a withdrawal hold is unresolved.');
      }
      const result = statements.deleteUsername.run(username);
      const withdrawals = statements.deleteWithdrawalsByUsername.run(username);
      if (!result.changes && !withdrawals.changes) return false;
      recalculateMemberPoints();
      return true;
    });
  }

  function clearAllLogs() {
    transaction(() => {
      if (statements.unresolvedAny.get()) throw new Error('Cannot clear logs while a withdrawal hold is unresolved.');
      db.exec('DELETE FROM coin_logs');
      statements.deleteWithdrawals.run();
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

  function getMemberPoints(username, pointRates) {
    if (pointRates) ensurePointsSync(pointRates);
    let total = 0;
    const rows = db.prepare('SELECT points FROM coin_logs WHERE username = ?').all(username);
    for (const row of rows) total += Number(row.points) || 0;
    return Math.round(total * 100) / 100;
  }

  function publicWheelSpin(log) {
    const { notificationLeaseToken, notificationLeaseUntil, ...spin } = log;
    return { ...spin, createdAt: spin.timestamp };
  }

  function appendWheelSpin({
    username, requestId, station, outcomes, pointRates, expectedStake, expectedBalance,
    allowCustomStake = false, maxSpinsPerDay = 1, game = 'wheel', dice, choice, settlementTime
  }) {
    ensurePointsSync(pointRates);
    let spin;
    transaction(() => {
      const existingRow = statements.wheelByRequest.get(requestId);
      if (existingRow) {
        const existing = parseLog(existingRow);
        if (existing.username !== username) throw new Error('This spin belongs to a different member.');
        if ((existing.game || 'wheel') !== game || (game === 'dice' && existing.choice !== choice)) {
          throw new Error('This request belongs to a different game or dice choice.');
        }
        spin = existing;
        return;
      }
      const now = settlementTime === undefined ? Date.now() : settlementTime;
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
      const balanceRows = db.prepare('SELECT points FROM coin_logs WHERE username = ?').all(username);
      const balanceCents = balanceRows.reduce((sum, row) => sum +
        Math.round((Number(row.points) || 0) * 100), 0);
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
        multiplier: log.multiplier, game: log.game || 'wheel',
        ...(log.game === 'dice' ? { choice: log.choice } : {}), createdAt: log.timestamp
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

  function acknowledgeWheelNotification(requestId, leaseToken, uncertain = false) {
    return transaction(() => {
      const row = statements.wheelByRequest.get(requestId);
      if (!row) return false;
      const log = parseLog(row);
      if (log.notificationLeaseToken !== leaseToken) return false;
      if (uncertain) {
        log.notificationLeaseUntil = Number.MAX_SAFE_INTEGER;
        log.notificationReview = true;
        updateLog(row.rowid, log);
        return true;
      }
      log.notificationSent = true;
      delete log.notificationLeaseToken;
      delete log.notificationLeaseUntil;
      updateLog(row.rowid, log);
      return true;
    });
  }

  function reserveWithdrawal({
    username, requestId, amount, station, pointRates, min, max,
    dailyLimit = 0, timestamp = Date.now()
  }) {
    validateWithdrawal({ username, requestId, amount, min, max });
    ensurePointsSync(pointRates);
    return transaction(() => {
      const existing = findWithdrawal(requestId);
      if (existing) {
        if (existing.record.username !== username) throw new Error('This withdrawal belongs to a different member.');
        if (existing.record.amount !== amount) throw new Error('This withdrawal request ID was already used for another amount.');
        return publicWithdrawal(existing.record);
      }
      validateDailyLimit(dailyLimit);
      if (statements.unresolvedAny.get()) throw new Error('Another withdrawal is unresolved.');
      if (dailyLimit > 0) {
        const withdrawals = statements.allWithdrawals.all().map(row => JSON.parse(row.payload));
        const usage = getDailyUsage(withdrawals, username, timestamp);
        if (usage.used >= dailyLimit) throwDailyLimitError(usage);
      }
      const balance = withdrawalBalance(username);
      if (balance < amount) throw new Error('Insufficient points balance.');
      const now = timestamp;
      const record = {
        id: crypto.randomUUID(), requestId, username,
        station: String(station || 'PC').slice(0, 60), amount,
        status: 'reserved', createdAt: now, timestamp: now, updatedAt: now,
        reason: null, balance: Math.round((balance - amount) * 100) / 100,
        notificationVersion: 0, notificationSentVersion: 0
      };
      saveWithdrawal(record);
      addWithdrawalPoints(record, 'withdrawal', -amount, 'Cash withdrawal');
      return publicWithdrawal(record);
    });
  }

  function getWithdrawal(requestId) {
    const row = findWithdrawal(requestId);
    return row ? publicWithdrawal(row.record) : null;
  }

  function getUnresolvedWithdrawal(username) {
    const hasUsername = username != null && username !== '';
    const usernameClause = hasUsername ? ' AND username = ?' : '';
    const row = db.prepare(`SELECT payload FROM withdrawals
      WHERE json_extract(payload, '$.status') IN ('reserved', 'sending', 'unconfirmed')
      ${usernameClause}
      ORDER BY created_at ASC, rowid ASC LIMIT 1`).get(...(hasUsername ? [username] : []));
    return row ? publicWithdrawal(JSON.parse(row.payload)) : null;
  }

  function listWithdrawals(limit = 50) {
    const count = Number.isSafeInteger(limit) ? Math.max(0, Math.min(500, limit)) : 50;
    return statements.allWithdrawals.all().map(row => JSON.parse(row.payload))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, count).map(publicWithdrawal);
  }

  function getLastConfirmedWithdrawalAt() {
    const row = db.prepare(`SELECT MAX(CAST(json_extract(payload, '$.updatedAt') AS INTEGER)) AS latest
      FROM withdrawals WHERE json_extract(payload, '$.status') = 'success'`).get();
    return Number(row.latest) || 0;
  }

  function markWithdrawalSending(requestId) {
    return transaction(() => {
      const found = findWithdrawal(requestId);
      if (!found || found.record.status !== 'reserved') return false;
      found.record.status = 'sending';
      touchWithdrawal(found.record);
      saveWithdrawal(found.record, found.rowid);
      return true;
    });
  }

  function finishWithdrawal(requestId, { status, reason } = {}) {
    if (!FINAL_WITHDRAWAL_STATES.has(status)) throw new Error('Invalid withdrawal final status.');
    return transaction(() => {
      const found = findWithdrawal(requestId);
      if (!found || !(found.record.status === 'sending' ||
          (found.record.status === 'reserved' && status === 'failed'))) return false;
      finalizeWithdrawal(found.record, status, reason);
      saveWithdrawal(found.record, found.rowid);
      return publicWithdrawal(found.record);
    });
  }

  function resolveWithdrawal(requestId, { released, reason } = {}) {
    if (typeof released !== 'boolean') throw new Error('A release decision is required.');
    return transaction(() => {
      const found = findWithdrawal(requestId);
      if (!found || found.record.status !== 'unconfirmed') return false;
      finalizeWithdrawal(found.record, released ? 'success' : 'failed', reason);
      saveWithdrawal(found.record, found.rowid);
      return publicWithdrawal(found.record);
    });
  }

  function recoverWithdrawals() {
    return transaction(() => {
      let recovered = 0;
      for (const row of statements.allWithdrawals.all()) {
        const record = JSON.parse(row.payload);
        if (record.status === 'reserved') {
          finalizeWithdrawal(record, 'failed', 'Recovered before dispatch; withdrawal was not sent.');
        } else if (record.status === 'sending') {
          finalizeWithdrawal(record, 'unconfirmed', 'Dispatch outcome unknown after restart.');
        } else continue;
        saveWithdrawal(record, row.rowid);
        recovered++;
      }
      return recovered;
    });
  }

  function recordRejectedWithdrawal({ username, requestId, amount, station, reason }) {
    if (typeof username !== 'string' || !MEMBER_RE.test(username)) throw new Error('Invalid member username.');
    if (typeof requestId !== 'string' || !requestId.trim() || requestId.length > 200) throw new Error('Invalid withdrawal request ID.');
    return transaction(() => {
      const existing = findWithdrawal(requestId);
      if (existing) return publicWithdrawal(existing.record);
      const now = Date.now();
      const record = {
        id: crypto.randomUUID(), requestId, username,
        station: String(station || 'PC').slice(0, 60),
        amount: Number.isSafeInteger(amount) && amount >= 1 && amount <= 1000 ? amount : null,
        status: 'failed', createdAt: now, timestamp: now, updatedAt: now,
        reason: String(reason || 'Withdrawal rejected.').slice(0, 500),
        balance: withdrawalBalance(username), notificationVersion: 1, notificationSentVersion: 0
      };
      saveWithdrawal(record);
      return publicWithdrawal(record);
    });
  }

  function claimWithdrawalNotification() {
    return transaction(() => {
      const now = Date.now();
      const eligible = statements.allWithdrawals.all().find(row => {
        const record = JSON.parse(row.payload);
        return FINAL_WITHDRAWAL_STATES.has(record.status) &&
          (record.notificationSentVersion || 0) < (record.notificationVersion || 0) &&
          (!record.notificationLeaseUntil || record.notificationLeaseUntil < now);
      });
      if (!eligible) return null;
      const record = JSON.parse(eligible.payload);
      const leaseToken = crypto.randomBytes(16).toString('hex');
      record.notificationLeaseUntil = now + 30000;
      record.notificationLeaseToken = leaseToken;
      record.notificationLeaseVersion = record.notificationVersion;
      saveWithdrawal(record, eligible.rowid);
      return { withdrawal: publicWithdrawal(record), leaseToken };
    });
  }

  function acknowledgeWithdrawalNotification(requestId, leaseToken, uncertain = false) {
    return transaction(() => {
      const found = findWithdrawal(requestId);
      if (!found || found.record.notificationLeaseToken !== leaseToken ||
          found.record.notificationLeaseVersion !== found.record.notificationVersion) return false;
      if (uncertain) {
        found.record.notificationLeaseUntil = Number.MAX_SAFE_INTEGER;
        found.record.notificationReview = true;
        saveWithdrawal(found.record, found.rowid);
        return true;
      }
      found.record.notificationSentVersion = found.record.notificationLeaseVersion;
      delete found.record.notificationLeaseToken;
      delete found.record.notificationLeaseUntil;
      delete found.record.notificationLeaseVersion;
      saveWithdrawal(found.record, found.rowid);
      return true;
    });
  }

  function getLeaderboard(limit, pointRates, periodKey) {
    if (pointRates) ensurePointsSync(pointRates);
    const [from, to] = periodBounds(periodKey || getCurrentPeriodKey());
    const totals = {};
    const rows = db.prepare(`SELECT username, points FROM coin_logs
      WHERE timestamp >= ? AND timestamp < ?
        AND source NOT IN ('withdrawal', 'withdrawal-refund')`).all(from, to);
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
    getDailyWheelStatus
  };
}

module.exports = { createStore };