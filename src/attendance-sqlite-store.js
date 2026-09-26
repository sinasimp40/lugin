const crypto = require('crypto');

function createStore(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance_entries (
      day TEXT NOT NULL,
      username TEXT NOT NULL,
      payload TEXT NOT NULL,
      PRIMARY KEY (day, username)
    );
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS attendance_entries_username_day
      ON attendance_entries (username, day);
  `);

  let observation = null;

  function dayKey(now = Date.now()) {
    const d = new Date(now);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const getEntry = db.prepare(
    'SELECT payload FROM attendance_entries WHERE day = ? AND username = ?'
  );
  const saveEntry = db.prepare(`
    INSERT INTO attendance_entries (day, username, payload) VALUES (?, ?, ?)
    ON CONFLICT(day, username) DO UPDATE SET payload = excluded.payload
  `);
  const getDeviceId = db.prepare('SELECT value FROM metadata WHERE key = ?');
  const saveDeviceId = db.prepare(
    'INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)'
  );

  function transaction(fn) {
    if (db.isTransaction) return fn();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch (_) {}
      throw err;
    }
  }

  function deviceId() {
    let row = getDeviceId.get('attendanceDeviceId');
    if (!row) {
      saveDeviceId.run('attendanceDeviceId', crypto.randomUUID());
      row = getDeviceId.get('attendanceDeviceId');
    }
    return row.value;
  }

  function readEntry(day, username) {
    const row = getEntry.get(day, username);
    return row ? JSON.parse(row.payload) : null;
  }

  function writeEntry(day, username, entry) {
    saveEntry.run(day, username, JSON.stringify(entry));
  }

  const onlineSample = (username, enabled) => {
    if (!enabled || !/^mem-[a-z0-9._-]{1,80}$/i.test(username || '')) return null;
    return { deviceId: deviceId(), day: dayKey(), username };
  };

  function recordOnline({ deviceId: checkinDeviceId, day, username }, now = Date.now()) {
    if (!/^[a-f0-9-]{36}$/i.test(checkinDeviceId || '') ||
        !/^mem-[a-z0-9._-]{1,80}$/i.test(username || '') ||
        day !== dayKey(now)) throw new Error('Invalid live attendance check-in');
    return transaction(() => {
      const entry = readEntry(day, username) || { devices: {} };
      const elapsed = now - (entry.onlineLastSeenAt || 0);
      const delta = entry.onlineLastSeenDeviceId === checkinDeviceId && elapsed >= 1000 && elapsed <= 10000
        ? Math.min(5, Math.floor(elapsed / 1000)) : 0;
      entry.devices[checkinDeviceId] = (entry.devices[checkinDeviceId] || 0) + delta;
      entry.onlineLastSeenAt = now;
      entry.onlineLastSeenDeviceId = checkinDeviceId;
      writeEntry(day, username, entry);
      return { day, username, entry };
    });
  }

  function record(username, enabled, now = Date.now()) {
    const day = dayKey(now);
    const valid = enabled && /^mem-[a-z0-9._-]{1,80}$/i.test(username || '');
    if (!valid) {
      observation = null;
      return null;
    }
    const previous = observation;
    const delta = previous && previous.username === username && previous.day === day
      ? Math.max(0, Math.min(5, Math.floor((now - previous.at) / 1000)))
      : 0;
    observation = { username, day, at: now };

    const result = transaction(() => {
      const currentDeviceId = deviceId();
      const existingRow = getEntry.get(day, username);
      const entry = existingRow ? JSON.parse(existingRow.payload) : { devices: {} };
      const oldSeconds = entry.devices[currentDeviceId] || 0;
      if (delta || !existingRow) {
        entry.devices[currentDeviceId] = oldSeconds + delta;
        writeEntry(day, username, entry);
      }
      return { deviceId: currentDeviceId, day, username, seconds: oldSeconds + delta };
    });
    return result;
  }

  function merge({ deviceId: updateDeviceId, day, username, seconds }) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? new Date(`${day}T12:00:00`) : new Date(NaN);
    const age = Date.now() - date.getTime();
    if (!/^[a-f0-9-]{36}$/i.test(updateDeviceId || '') ||
        !/^mem-[a-z0-9._-]{1,80}$/i.test(username || '') ||
        !Number.isFinite(age) || dayKey(date.getTime()) !== day ||
        age < -86400000 || age > 30 * 86400000 ||
        !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86400) {
      throw new Error('Invalid attendance update');
    }
    transaction(() => {
      const entry = readEntry(day, username) || { devices: {} };
      const isNew = !getEntry.get(day, username);
      if (isNew || !(updateDeviceId in entry.devices) || seconds > (entry.devices[updateDeviceId] || 0)) {
        entry.devices[updateDeviceId] = seconds;
        writeEntry(day, username, entry);
      }
    });
    return status(username, day);
  }

  function status(username, day = dayKey()) {
    const entry = readEntry(day, username);
    return {
      day,
      seconds: Object.values(entry?.devices || {}).reduce((sum, n) => sum + (Number(n) || 0), 0),
      awarded: !!entry?.awarded,
      awardedPoints: entry?.awardedPoints
    };
  }

  function yearEntries(username, year) {
    const result = {};
    const prefix = `${year}-`;
    const rows = db.prepare(
      'SELECT day, payload FROM attendance_entries WHERE username = ? AND day >= ? AND day < ? ORDER BY day'
    ).all(username, prefix, `${Number(year) + 1}-`);
    for (const row of rows) {
      const entry = JSON.parse(row.payload);
      result[row.day] = {
        seconds: Object.values(entry.devices || {}).reduce((sum, n) => sum + (Number(n) || 0), 0),
        awarded: !!entry.awarded,
        awardedPoints: entry.awardedPoints
      };
    }
    return result;
  }

  function markSynced(sample) {
    transaction(() => {
      const entry = readEntry(sample.day, sample.username);
      if (!entry || !entry.devices || entry.devices[sample.deviceId] === undefined) return;
      entry.synced = entry.synced || {};
      entry.synced[sample.deviceId] = Math.max(entry.synced[sample.deviceId] || 0, sample.seconds);
      writeEntry(sample.day, sample.username, entry);
    });
  }

  function acknowledge(sample, result) {
    transaction(() => {
      const entry = readEntry(sample.day, sample.username);
      if (!entry || !entry.devices || entry.devices[sample.deviceId] === undefined) return;
      entry.synced = entry.synced || {};
      entry.synced[sample.deviceId] = Math.max(entry.synced[sample.deviceId] || 0, sample.seconds);
      if (result.awarded) {
        entry.awarded = true;
        entry.awardedPoints = result.points;
      }
      writeEntry(sample.day, sample.username, entry);
    });
  }

  function pendingSamples() {
    const row = getDeviceId.get('attendanceDeviceId');
    if (!row) return [];
    const now = Date.now();
    const samples = [];
    const rows = db.prepare('SELECT day, username, payload FROM attendance_entries').all();
    for (const item of rows) {
      const date = new Date(`${item.day}T12:00:00`).getTime();
      if (!Number.isFinite(date) || now - date > 30 * 86400000) continue;
      const entry = JSON.parse(item.payload);
      const seconds = entry.devices?.[row.value];
      if (seconds !== undefined && seconds !== entry.synced?.[row.value]) {
        samples.push({ deviceId: row.value, day: item.day, username: item.username, seconds });
      }
    }
    return samples.sort((a, b) => a.day.localeCompare(b.day));
  }

  function markAwarded(username, day, points) {
    transaction(() => {
      const entry = readEntry(day, username);
      if (entry && (!entry.awarded || entry.awardedPoints === undefined)) {
        entry.awarded = true;
        entry.awardedPoints = points;
        writeEntry(day, username, entry);
      }
    });
  }

  return {
    dayKey,
    onlineSample,
    recordOnline: (sample, now = Date.now()) => {
      const result = recordOnline(sample, now);
      return status(result.username, result.day);
    },
    record,
    merge,
    status,
    yearEntries,
    markAwarded,
    pendingSamples,
    markSynced,
    acknowledge
  };
}

module.exports = { createStore };