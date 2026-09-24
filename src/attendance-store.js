const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let filePath = path.join(__dirname, '..', 'data', 'attendance.json');
let observation = null;

function setDataDir(dir) {
  filePath = path.join(dir, 'attendance.json');
  observation = null;
}

function dayKey(now = Date.now()) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return { deviceId: crypto.randomUUID(), days: {} };
    throw err;
  }
}

function save(data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
}

function record(username, enabled, now = Date.now()) {
  const day = dayKey(now);
  const valid = enabled && /^mem-[a-z0-9._-]{1,80}$/i.test(username || '');
  if (!valid) {
    observation = null;
    return null;
  }
  const data = load();
  const previous = observation;
  const delta = previous && previous.username === username && previous.day === day
    ? Math.max(0, Math.min(5, Math.floor((now - previous.at) / 1000)))
    : 0;
  observation = { username, day, at: now };
  const days = data.days || (data.days = {});
  const users = days[day] || (days[day] = {});
  const entry = users[username] || (users[username] = { devices: {} });
  const oldSeconds = entry.devices[data.deviceId] || 0;
  if (delta || !fs.existsSync(filePath)) {
    entry.devices[data.deviceId] = oldSeconds + delta;
    save(data);
  }
  return { deviceId: data.deviceId, day, username, seconds: oldSeconds + delta };
}

function merge({ deviceId, day, username, seconds }) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day || '') ? new Date(`${day}T12:00:00`) : new Date(NaN);
  const age = Date.now() - date.getTime();
  if (!/^[a-f0-9-]{36}$/i.test(deviceId || '') ||
      !/^mem-[a-z0-9._-]{1,80}$/i.test(username || '') ||
      !Number.isFinite(age) || dayKey(date.getTime()) !== day ||
      age < -86400000 || age > 30 * 86400000 ||
      !Number.isSafeInteger(seconds) || seconds < 0 || seconds > 86400) {
    throw new Error('Invalid attendance update');
  }
  const data = load();
  const users = data.days[day] || (data.days[day] = {});
  const isNew = !users[username];
  const entry = users[username] || (users[username] = { devices: {} });
  if (isNew || !(deviceId in entry.devices) || seconds > (entry.devices[deviceId] || 0)) {
    entry.devices[deviceId] = seconds;
    save(data);
  }
  return status(username, day);
}

function pendingSamples() {
  const data = load();
  const now = Date.now();
  const samples = [];
  for (const [day, users] of Object.entries(data.days || {})) {
    const date = new Date(`${day}T12:00:00`).getTime();
    if (!Number.isFinite(date) || now - date > 30 * 86400000) continue;
    for (const [username, entry] of Object.entries(users)) {
      const seconds = entry.devices?.[data.deviceId];
      if (seconds !== undefined && seconds !== entry.synced?.[data.deviceId]) {
        samples.push({ deviceId: data.deviceId, day, username, seconds });
      }
    }
  }
  return samples.sort((a, b) => a.day.localeCompare(b.day));
}

function markSynced(sample) {
  const data = load();
  const entry = data.days?.[sample.day]?.[sample.username];
  if (!entry || !entry.devices || entry.devices[sample.deviceId] === undefined) return;
  entry.synced = entry.synced || {};
  entry.synced[sample.deviceId] = Math.max(entry.synced[sample.deviceId] || 0, sample.seconds);
  save(data);
}

function acknowledge(sample, result) {
  const data = load();
  const entry = data.days?.[sample.day]?.[sample.username];
  if (!entry || entry.devices?.[sample.deviceId] === undefined) return;
  entry.synced = entry.synced || {};
  entry.synced[sample.deviceId] = Math.max(entry.synced[sample.deviceId] || 0, sample.seconds);
  if (result.awarded) {
    entry.awarded = true;
    entry.awardedPoints = result.points;
  }
  save(data);
}

function status(username, day = dayKey()) {
  const entry = load().days?.[day]?.[username];
  return {
    day,
    seconds: Object.values(entry?.devices || {}).reduce((sum, n) => sum + (Number(n) || 0), 0),
    awarded: !!entry?.awarded,
    awardedPoints: entry?.awardedPoints
  };
}

function yearEntries(username, year) {
  const result = {};
  const days = load().days || {};
  const prefix = `${year}-`;
  for (const [day, users] of Object.entries(days)) {
    if (!day.startsWith(prefix)) continue;
    const entry = users?.[username];
    if (!entry) continue;
    result[day] = {
      seconds: Object.values(entry.devices || {}).reduce((sum, n) => sum + (Number(n) || 0), 0),
      awarded: !!entry.awarded,
      awardedPoints: entry.awardedPoints
    };
  }
  return result;
}

function markAwarded(username, day, points) {
  const data = load();
  const entry = data.days?.[day]?.[username];
  if (entry && (!entry.awarded || entry.awardedPoints === undefined)) {
    entry.awarded = true;
    entry.awardedPoints = points;
    save(data);
  }
}

module.exports = { setDataDir, dayKey, record, merge, status, yearEntries, markAwarded, pendingSamples, markSynced, acknowledge };