// Denfi Points owns this file. Kiosks continue to use their local JSON stores
// and the existing HTTP API; they must never open the server's database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const FILE_NAME = 'denfi-points.db';
const VERSION = '1';
const LEGACY_FILES = ['coin-logs.json', 'attendance.json'];
let active = null;
let activePath = null;

function digest(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function readSource(dir, name) {
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) return { file, hash: null, data: null };
  const bytes = fs.readFileSync(file);
  let data;
  try {
    data = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${name} is not valid JSON; no database was activated: ${error.message}`);
  }
  return { file, hash: digest(bytes), data };
}

function validateSources(coins, attendance) {
  if (coins !== null && (!coins || !Array.isArray(coins.logs) ||
      !coins.logs.every(log => log && typeof log.id === 'string' &&
        typeof log.username === 'string' && Number.isFinite(log.timestamp) &&
        Number.isFinite(Number(log.points)) &&
        (log.source === undefined || typeof log.source === 'string')))) {
    throw new Error('coin-logs.json has an unexpected shape; no data was converted.');
  }
  if (attendance !== null && (!attendance || !attendance.days ||
      typeof attendance.days !== 'object' || Array.isArray(attendance.days))) {
    throw new Error('attendance.json has an unexpected shape; no data was converted.');
  }
  if (coins?.memberPoints !== undefined && (!coins.memberPoints ||
      typeof coins.memberPoints !== 'object' || Array.isArray(coins.memberPoints) ||
      Object.values(coins.memberPoints).some(value => !Number.isFinite(Number(value))))) {
    throw new Error('coin-logs.json has invalid memberPoints metadata; no data was converted.');
  }
  for (const [day, members] of Object.entries(attendance?.days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !members || typeof members !== 'object' ||
        Array.isArray(members)) throw new Error(`Invalid attendance day: ${day}`);
    for (const [username, entry] of Object.entries(members)) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error(`Invalid attendance record for ${username}`);
      }
    }
  }
}

function createSchema(db) {
  db.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE coin_logs (
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
    CREATE INDEX coin_member_time ON coin_logs(username, timestamp);
    CREATE INDEX coin_source_time ON coin_logs(source, timestamp);
    CREATE UNIQUE INDEX coin_wheel_request ON coin_logs(request_id)
      WHERE source = 'wheel' AND request_id IS NOT NULL;
    CREATE UNIQUE INDEX coin_attendance_day ON coin_logs(username, attendance_day)
      WHERE source = 'attendance' AND attendance_day IS NOT NULL;
    CREATE TABLE attendance_entries (
      day TEXT NOT NULL,
      username TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY(day, username)
    );
  `);
}

function backupSources(dir, sources) {
  const existing = fs.readdirSync(dir).filter(name => name.endsWith('.json') &&
    fs.statSync(path.join(dir, name)).isFile());
  if (!existing.length) return null;
  const folder = path.join(dir, 'legacy-json-backups',
    new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomUUID());
  fs.mkdirSync(folder, { recursive: true });
  for (const name of existing) {
    const source = path.join(dir, name);
    const target = path.join(folder, name);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    if (digest(fs.readFileSync(source)) !== digest(fs.readFileSync(target))) {
      throw new Error(`Backup verification failed for ${name}`);
    }
  }
  for (const source of sources) {
    if (source.hash !== null && digest(fs.readFileSync(source.file)) !== source.hash) {
      throw new Error(`Source changed during backup: ${path.basename(source.file)}`);
    }
  }
  return folder;
}

function verify(db, coins, attendance) {
  const logs = coins?.logs || [];
  const count = db.prepare('SELECT COUNT(*) AS n FROM coin_logs').get().n;
  if (count !== logs.length) throw new Error('Coin log count does not match after import');
  const perMember = new Map();
  for (const log of logs) {
    const row = db.prepare('SELECT payload FROM coin_logs WHERE id = ?').get(log.id);
    if (!row || JSON.stringify(JSON.parse(row.payload)) !== JSON.stringify(log)) {
      throw new Error(`Coin log verification failed for ${log.id}`);
    }
    const key = `${log.username}\0${new Date(log.timestamp).getFullYear()}-${new Date(log.timestamp).getMonth()}`;
    perMember.set(key, (perMember.get(key) || 0) + Math.round(Number(log.points) * 100));
  }
  // Check the same monthly sums the member balance and leaderboard display.
  const sqlSums = new Map();
  for (const row of db.prepare('SELECT username, timestamp, points FROM coin_logs').all()) {
    const key = `${row.username}\0${new Date(row.timestamp).getFullYear()}-${new Date(row.timestamp).getMonth()}`;
    sqlSums.set(key, (sqlSums.get(key) || 0) + Math.round(row.points * 100));
  }
  if (JSON.stringify([...perMember].sort()) !== JSON.stringify([...sqlSums].sort())) {
    throw new Error('Monthly member points do not match after import');
  }
  for (const [username, total] of Object.entries(coins?.memberPoints || {})) {
    const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get(`memberPoints:${username}`);
    if (!row || Number(JSON.parse(row.value)) !== Number(total)) {
      throw new Error(`Legacy member points do not match after import for ${username}`);
    }
  }
  const entries = Object.entries(attendance?.days || {}).flatMap(([day, members]) =>
    Object.entries(members).map(([username, entry]) => ({ day, username, entry })));
  if (db.prepare('SELECT COUNT(*) AS n FROM attendance_entries').get().n !== entries.length) {
    throw new Error('Attendance record count does not match after import');
  }
  for (const { day, username, entry } of entries) {
    const row = db.prepare('SELECT payload FROM attendance_entries WHERE day = ? AND username = ?').get(day, username);
    if (!row || JSON.stringify(JSON.parse(row.payload)) !== JSON.stringify(entry)) {
      throw new Error(`Attendance verification failed for ${username} on ${day}`);
    }
  }
}

function ensureExisting(db, dir) {
  const meta = db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get();
  if (meta?.value !== VERSION) throw new Error('Database has no completed, supported migration marker');
  if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
    throw new Error('Database integrity check failed');
  }
  for (const name of LEGACY_FILES) {
    const stored = db.prepare('SELECT value FROM metadata WHERE key = ?').get(`source:${name}`);
    if (!stored) throw new Error(`Missing import marker for ${name}`);
    const current = readSource(dir, name).hash;
    if (current !== JSON.parse(stored.value)) {
      throw new Error(`${name} changed since import. Database was not opened; preserve both versions and reconcile before restarting.`);
    }
  }
}

function initialize(dir) {
  const file = path.join(dir, FILE_NAME);
  if (active) {
    if (activePath !== file) throw new Error('Points database is already open in another data folder');
    return active;
  }
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(file)) {
    const db = new DatabaseSync(file);
    try {
      ensureExisting(db, dir);
      active = db;
      activePath = file;
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }

  const [coinSource, attendanceSource] = LEGACY_FILES.map(name => readSource(dir, name));
  validateSources(coinSource.data, attendanceSource.data);
  const backup = backupSources(dir, [coinSource, attendanceSource]);
  const temporary = `${file}.${crypto.randomUUID()}.migrating`;
  let db;
  try {
    db = new DatabaseSync(temporary);
    db.exec('PRAGMA journal_mode = DELETE');
    createSchema(db);
    db.exec('BEGIN IMMEDIATE');
    const insertLog = db.prepare(`INSERT INTO coin_logs
      (id, username, timestamp, source, points, amount, request_id, attendance_day, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const log of coinSource.data?.logs || []) {
      insertLog.run(log.id, log.username, log.timestamp, log.source || 'app', Number(log.points),
        Number(log.amount) || 0, log.requestId || null, log.attendanceDay || null, JSON.stringify(log));
    }
    const insertAttendance = db.prepare('INSERT INTO attendance_entries(day, username, payload) VALUES (?, ?, ?)');
    for (const [day, members] of Object.entries(attendanceSource.data?.days || {})) {
      for (const [username, entry] of Object.entries(members)) {
        insertAttendance.run(day, username, JSON.stringify(entry));
      }
    }
    const meta = db.prepare('INSERT INTO metadata(key, value) VALUES (?, ?)');
    meta.run('ratesHash', JSON.stringify(coinSource.data?._ratesHash || ''));
    meta.run('attendanceDeviceId', String(attendanceSource.data?.deviceId || crypto.randomUUID()));
    const memberTotals = new Map();
    for (const log of coinSource.data?.logs || []) {
      if (!log.username) continue;
      memberTotals.set(log.username, parseFloat(((memberTotals.get(log.username) || 0) +
        (Number(log.points) || 0)).toFixed(2)));
    }
    for (const [username, points] of Object.entries(coinSource.data?.memberPoints || Object.fromEntries(memberTotals))) {
      meta.run(`memberPoints:${username}`, JSON.stringify(points));
    }
    for (const source of [coinSource, attendanceSource]) {
      meta.run(`source:${path.basename(source.file)}`, JSON.stringify(source.hash));
    }
    meta.run('schema_version', VERSION);
    verify(db, coinSource.data, attendanceSource.data);
    for (const source of [coinSource, attendanceSource]) {
      if (readSource(dir, path.basename(source.file)).hash !== source.hash) {
        throw new Error(`${path.basename(source.file)} changed during migration`);
      }
    }
    db.exec('COMMIT');
    if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok') {
      throw new Error('Database integrity check failed after import');
    }
    db.close();
    db = null;
    fs.renameSync(temporary, file);
    const opened = new DatabaseSync(file);
    ensureExisting(opened, dir);
    active = opened;
    activePath = file;
    console.log('[Points DB] SQLite migration complete.', { logs: coinSource.data?.logs?.length || 0,
      attendanceDays: Object.keys(attendanceSource.data?.days || {}).length, backup });
    return opened;
  } catch (error) {
    if (db) { try { db.exec('ROLLBACK'); } catch (_) {} db.close(); }
    try { fs.unlinkSync(temporary); } catch (_) {}
    throw new Error(`Points database migration stopped without changing JSON: ${error.message}`);
  }
}

function close() {
  if (active) active.close();
  active = null;
  activePath = null;
}

function isActive() {
  return !!active;
}

function transaction(fn) {
  if (!active) throw new Error('Denfi Points database is not initialized');
  active.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    active.exec('COMMIT');
    return result;
  } catch (error) {
    try { active.exec('ROLLBACK'); } catch (_) {}
    throw error;
  }
}

module.exports = { initialize, close, isActive, transaction };