const fs = require('fs');
const path = require('path');

function machineHintDir() {
  return process.platform === 'win32' && process.env.ProgramData
    ? path.join(process.env.ProgramData, 'Denfi Auto Shutdown') : null;
}

function validAddress(value) {
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return value === value.trim() && ['http:', 'https:'].includes(url.protocol) &&
      !!url.hostname && !url.username && !url.password &&
      !url.search && !url.hash;
  } catch (_) {
    return false;
  }
}

function readHint(dir = machineHintDir()) {
  if (!dir) return '';
  try {
    const data = JSON.parse(fs.readFileSync(path.join(dir, 'points-connection.json'), 'utf8'));
    return validAddress(data.url) ? data.url : '';
  } catch (_) {
    return '';
  }
}

function writeHint(url, dir = machineHintDir()) {
  if (!dir) return false;
  const filename = path.join(dir, 'points-connection.json');
  if (!url) {
    try { fs.unlinkSync(filename); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    return true;
  }
  if (!validAddress(url)) throw new Error('Invalid Denfi Points address');
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filename + '.' + process.pid + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify({ url }));
    fs.renameSync(tmp, filename);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw err;
  }
  return true;
}

module.exports = { machineHintDir, readHint, writeHint };