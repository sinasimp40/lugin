const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let dataDir = path.join(__dirname, '..', 'data');
let settingsPath = path.join(dataDir, 'settings.json');
let uploadsDir = path.join(dataDir, 'uploads');

function setDataDir(dir) {
  dataDir = dir;
  settingsPath = path.join(dataDir, 'settings.json');
  uploadsDir = path.join(dataDir, 'uploads');
  ensureDirs();
}

function ensureDirs() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

function load() {
  ensureDirs();
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch (e) {
    return {};
  }
}

function save(data) {
  ensureDirs();
  const tmp = settingsPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, settingsPath);
}

function hashPassword(password, salt) {
  if (!salt) salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  const result = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(result, 'hex'), Buffer.from(hash, 'hex'));
}

function isAdminRegistered() {
  const s = load();
  return !!(s.adminPasswordHash && s.adminSalt);
}

function registerAdmin(password) {
  const s = load();
  const { hash, salt } = hashPassword(password);
  s.adminPasswordHash = hash;
  s.adminSalt = salt;
  save(s);
  return true;
}

function verifyAdmin(password) {
  const s = load();
  if (!s.adminPasswordHash || !s.adminSalt) return false;
  return verifyPassword(password, s.adminPasswordHash, s.adminSalt);
}

function changeAdminPassword(oldPassword, newPassword) {
  if (!verifyAdmin(oldPassword)) return false;
  const { hash, salt } = hashPassword(newPassword);
  const s = load();
  s.adminPasswordHash = hash;
  s.adminSalt = salt;
  save(s);
  return true;
}

function getSettings() {
  const s = load();
  return {
    computerName: s.computerName !== undefined ? s.computerName : 'COMPUTER SHOP',
    autoShutdownSeconds: s.autoShutdownSeconds !== undefined ? s.autoShutdownSeconds : 180,
    backgroundImage: s.backgroundImage || null,
  };
}

function updateSettings(updates) {
  const s = load();
  if (updates.computerName !== undefined) s.computerName = updates.computerName;
  if (updates.autoShutdownSeconds !== undefined) s.autoShutdownSeconds = parseInt(updates.autoShutdownSeconds) || 0;
  if (updates.backgroundImage !== undefined) s.backgroundImage = updates.backgroundImage;
  save(s);
  return getSettings();
}

function saveBackgroundImage(fileBuffer, originalName, mimeType) {
  ensureDirs();
  const ext = path.extname(originalName).toLowerCase() || '.png';
  const filename = 'background' + ext;
  const filepath = path.join(uploadsDir, filename);

  const existingFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('background'));
  for (const f of existingFiles) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
  }

  fs.writeFileSync(filepath, fileBuffer);

  const s = load();
  s.backgroundImage = { filename, mimeType, size: fileBuffer.length };
  save(s);

  return s.backgroundImage;
}

function removeBackgroundImage() {
  ensureDirs();
  const existingFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('background'));
  for (const f of existingFiles) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
  }
  const s = load();
  s.backgroundImage = null;
  save(s);
}

function getBackgroundImagePath() {
  const s = load();
  if (!s.backgroundImage) return null;
  const filepath = path.join(uploadsDir, s.backgroundImage.filename);
  if (!fs.existsSync(filepath)) return null;
  return filepath;
}

function getUploadsDir() {
  return uploadsDir;
}

module.exports = {
  setDataDir,
  isAdminRegistered,
  registerAdmin,
  verifyAdmin,
  changeAdminPassword,
  getSettings,
  updateSettings,
  saveBackgroundImage,
  removeBackgroundImage,
  getBackgroundImagePath,
  getUploadsDir,
};
