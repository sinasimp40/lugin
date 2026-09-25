const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let dataDir = path.join(__dirname, '..', 'data');
let settingsFilename = 'settings.json';
let settingsPath = path.join(dataDir, settingsFilename);
let uploadsDir = path.join(dataDir, 'uploads');

const HMAC_KEY = 'denfi-settings-integrity-v1';

let appRoleSet = false;
function setAppRole(role, force) {
  if (appRoleSet && !force) return;
  appRoleSet = true;
  if (role === 'points') {
    settingsFilename = 'settings-server.json';
  } else {
    settingsFilename = 'settings-client.json';
  }
  settingsPath = path.join(dataDir, settingsFilename);
  console.log('[Settings] App role:', role, '→', settingsFilename);
}

function setDataDir(dir) {
  dataDir = dir;
  settingsPath = path.join(dataDir, settingsFilename);
  uploadsDir = path.join(dataDir, 'uploads');
  ensureDirs();
}

function ensureDirs() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
}

function computeHmac(data) {
  const copy = { ...data };
  delete copy._sig;
  return crypto.createHmac('sha256', HMAC_KEY).update(JSON.stringify(copy)).digest('hex');
}

function load() {
  ensureDirs();
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (raw._sig) {
      const expected = computeHmac(raw);
      if (raw._sig !== expected) {
        console.log('[Settings] WARNING: Data integrity mismatch — re-signing file (data preserved).');
        raw._sig = computeHmac(raw);
        try { save(raw); } catch (_) {}
      }
    }
    if ('attendancePairHash' in raw || 'attendanceClientKey' in raw || 'attendancePairRejected' in raw) {
      delete raw.attendancePairHash;
      delete raw.attendanceClientKey;
      delete raw.attendancePairRejected;
      save(raw);
    }
    return raw;
  } catch (e) {
    const backupPath = settingsPath + '.corrupted.' + Date.now();
    try {
      if (fs.existsSync(settingsPath)) {
        fs.copyFileSync(settingsPath, backupPath);
        console.log('[Settings] Corrupted file backed up to:', backupPath);
      }
    } catch (_) {}
    return {};
  }
}

function save(data) {
  ensureDirs();
  data._sig = computeHmac(data);
  const tmp = settingsPath + '.' + process.pid + '.' + Date.now() + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, settingsPath);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw e;
  }
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

function telegramSecretKey() {
  return crypto.createHash('sha256')
    .update(process.env.SESSION_SECRET || HMAC_KEY)
    .digest();
}

function encryptTelegramToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', telegramSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':');
}

function decryptTelegramToken(value) {
  if (!value) return '';
  try {
    const [, ivHex, tagHex, encryptedHex] = String(value).split(':');
    if (!ivHex || !tagHex || !encryptedHex) return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', telegramSecretKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]).toString('utf8');
  } catch (_) {
    return '';
  }
}

function getTelegramSettings() {
  const s = load();
  return {
    botToken: decryptTelegramToken(s.telegramBotTokenEncrypted),
    channelId: String(s.telegramChannelId || ''),
  };
}

function getTelegramAdminSettings() {
  const { botToken, channelId } = getTelegramSettings();
  return {
    configured: !!(botToken && channelId),
    channelId,
    tokenPreview: botToken ? '••••••••' + botToken.slice(-4) : '',
  };
}

function updateTelegramSettings({ botToken, channelId, clearToken } = {}) {
  const s = load();
  if (clearToken) {
    delete s.telegramBotTokenEncrypted;
  } else if (botToken !== undefined && String(botToken).trim()) {
    const token = String(botToken).trim();
    if (!/^\d{6,20}:[A-Za-z0-9_-]{20,200}$/.test(token)) {
      throw new Error('Invalid Telegram bot token format');
    }
    s.telegramBotTokenEncrypted = encryptTelegramToken(token);
  }
  if (channelId !== undefined) {
    const value = String(channelId).trim();
    if (value && !/^(?:-?\d{3,30}|@[A-Za-z0-9_]{5,64})$/.test(value)) {
      throw new Error('Enter a Telegram channel ID such as -1001234567890 or @channelname');
    }
    if (value) s.telegramChannelId = value;
    else delete s.telegramChannelId;
  }
  save(s);
  return getTelegramAdminSettings();
}

function getSharedRates() {
  if (settingsFilename === 'settings-server.json') return null;
  const serverSettingsPath = path.join(dataDir, 'settings-server.json');
  try {
    if (fs.existsSync(serverSettingsPath)) {
      const raw = JSON.parse(fs.readFileSync(serverSettingsPath, 'utf8'));
      return {
        coinRates: Array.isArray(raw.coinRates) ? raw.coinRates : null,
        pointRates: Array.isArray(raw.pointRates) ? raw.pointRates : null,
      };
    }
  } catch (e) {}
  return null;
}

function attendanceDayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function attendanceBounds(raw) {
  const legacy = Number.isInteger(raw.minutes ?? raw.attendanceMinutes) &&
    (raw.minutes ?? raw.attendanceMinutes) >= 1 && (raw.minutes ?? raw.attendanceMinutes) <= 1440
    ? (raw.minutes ?? raw.attendanceMinutes) : 60;
  const minValue = raw.minMinutes ?? raw.attendanceMinMinutes;
  const maxValue = raw.maxMinutes ?? raw.attendanceMaxMinutes;
  const min = Number.isInteger(minValue) && minValue >= 1 && minValue <= 1440 ? minValue : legacy;
  const max = Number.isInteger(maxValue) && maxValue >= min && maxValue <= 1440 ? maxValue : min;
  return { min, max };
}

function attendanceTargetForDay(raw, day) {
  const { min, max } = attendanceBounds(raw);
  const seed = raw.targetSeed ?? raw.attendanceTargetSeed;
  if (min === max || typeof seed !== 'string' || !/^[0-9a-f]{32}$/.test(seed)) return min;
  const value = crypto.createHash('sha256').update(`${seed}:${day}`).digest().readUInt32BE(0);
  return min + value % (max - min + 1);
}

function attendancePolicyForDay(raw, day) {
  return {
    enabled: !!raw.enabled,
    mode: raw.mode === 'login' ? 'login' : 'minutes',
    minutes: attendanceTargetForDay(raw, day),
    points: Number.isFinite(raw.points) && raw.points >= 0 ? raw.points : 1
  };
}

function getSettings() {
  const s = load();
  const shared = getSharedRates();
  const attendanceRange = attendanceBounds(s);
  let coinRates = Array.isArray(s.coinRates) && s.coinRates.length > 0 ? s.coinRates : [];
  let pointRates = Array.isArray(s.pointRates) && s.pointRates.length > 0 ? s.pointRates : [];
  if (shared) {
    if (shared.coinRates && shared.coinRates.length > 0) coinRates = shared.coinRates;
    if (shared.pointRates && shared.pointRates.length > 0) pointRates = shared.pointRates;
  }
  return {
    computerName: s.computerName !== undefined ? s.computerName : 'COMPUTER SHOP',
    autoShutdownSeconds: s.autoShutdownSeconds !== undefined ? s.autoShutdownSeconds : 180,
    backgroundImage: s.backgroundImage || null,
    loginImage: s.loginImage || null,
    registerImage: s.registerImage || null,
    loginColor: s.loginColor || '#ff8c00',
    registerColor: s.registerColor || '#ffd700',
    pisonetUnitName: s.pisonetUnitName || 'PC 1',
    ads: s.ads || [],
    adSlideSeconds: s.adSlideSeconds !== undefined ? s.adSlideSeconds : 5,
    fullscreenBypass: s.fullscreenBypass || ['valorant.exe', 'league of legends.exe', 'leagueclient.exe'],
    closeOnLock: Array.isArray(s.closeOnLock) ? s.closeOnLock : [],
    products: Array.isArray(s.products) ? s.products : [],
    curfewEnabled: !!s.curfewEnabled,
    curfewStart: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.curfewStart) ? s.curfewStart : '22:00',
    curfewEnd: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.curfewEnd) ? s.curfewEnd : '06:00',
    coinRates,
    pointRates,
    attendanceEnabled: !!s.attendanceEnabled,
    attendanceMode: s.attendanceMode === 'login' ? 'login' : 'minutes',
    attendanceMinutes: attendanceTargetForDay(s, attendanceDayKey()),
    attendanceMinMinutes: attendanceRange.min,
    attendanceMaxMinutes: attendanceRange.max,
    attendanceTargetSeed: typeof s.attendanceTargetSeed === 'string' && /^[0-9a-f]{32}$/.test(s.attendanceTargetSeed)
      ? s.attendanceTargetSeed : '',
    attendancePoints: Number.isFinite(s.attendancePoints) && s.attendancePoints >= 0 ? s.attendancePoints : 1,
    wheel: require('./wheel-config').parseWheel(s.wheel) || require('./wheel-config').defaultWheel(),
    wheelDraft: require('./wheel-config').parseWheel(s.wheelDraft) || null,
    monthlyLeaderboardReportedPeriod: String(s.monthlyLeaderboardReportedPeriod || ''),
    syncServerUrl: s.syncServerUrl || '',
  };
}

function getPublicSettings() {
  const s = getSettings();
  return {
    computerName: s.computerName,
    autoShutdownSeconds: s.autoShutdownSeconds,
    backgroundImage: s.backgroundImage,
    loginImage: s.loginImage,
    registerImage: s.registerImage,
    loginColor: s.loginColor,
    registerColor: s.registerColor,
    ads: s.ads || [],
    adSlideSeconds: s.adSlideSeconds !== undefined ? s.adSlideSeconds : 5,
    fullscreenBypass: s.fullscreenBypass,
    closeOnLock: s.closeOnLock,
    products: s.products,
    curfewEnabled: s.curfewEnabled,
    curfewStart: s.curfewStart,
    curfewEnd: s.curfewEnd,
    attendanceEnabled: s.attendanceEnabled,
    attendanceMode: s.attendanceMode,
    attendanceMinutes: s.attendanceMinutes,
    attendanceMinMinutes: s.attendanceMinMinutes,
    attendanceMaxMinutes: s.attendanceMaxMinutes,
    attendanceTargetSeed: s.attendanceTargetSeed,
    attendancePoints: s.attendancePoints,
  };
}

function isWithinCurfew() {
  const s = getSettings();
  if (!s.curfewEnabled) return false;
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [sh, sm] = s.curfewStart.split(':').map(Number);
  const [eh, em] = s.curfewEnd.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  if (startMin <= endMin) {
    return nowMin >= startMin && nowMin < endMin;
  } else {
    return nowMin >= startMin || nowMin < endMin;
  }
}

function updateSettings(updates) {
  const s = load();
  if (updates.computerName !== undefined) s.computerName = updates.computerName;
  if (updates.autoShutdownSeconds !== undefined) s.autoShutdownSeconds = parseInt(updates.autoShutdownSeconds) || 0;
  if (updates.backgroundImage !== undefined) s.backgroundImage = updates.backgroundImage;
  if (updates.pisonetUnitName !== undefined) s.pisonetUnitName = updates.pisonetUnitName;
  if (updates.adSlideSeconds !== undefined) s.adSlideSeconds = Math.max(1, Math.min(60, parseInt(updates.adSlideSeconds) || 5));
  if (updates.loginColor !== undefined && /^#[0-9A-Fa-f]{6}$/.test(updates.loginColor)) s.loginColor = updates.loginColor;
  if (updates.registerColor !== undefined && /^#[0-9A-Fa-f]{6}$/.test(updates.registerColor)) s.registerColor = updates.registerColor;
  if (updates.fullscreenBypass !== undefined) {
    if (Array.isArray(updates.fullscreenBypass)) {
      s.fullscreenBypass = updates.fullscreenBypass
        .map(g => g.trim().toLowerCase())
        .filter(g => g.length > 0 && g.endsWith('.exe'));
    }
  }
  if (updates.closeOnLock !== undefined && Array.isArray(updates.closeOnLock)) {
    s.closeOnLock = [...new Set(updates.closeOnLock
      .map(name => String(name).trim().toLowerCase())
      .filter(name => /^[a-z0-9][a-z0-9._ -]{0,199}\.exe$/i.test(name)))];
  }
  if (updates.products !== undefined && Array.isArray(updates.products)) {
    s.products = updates.products.slice(0, 50).map(product => ({
      id: String(product.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40),
      name: String(product.name || '').trim().slice(0, 60),
      price: Math.round(Number(product.price) * 100) / 100,
    })).filter(product => product.id && product.name && Number.isFinite(product.price) && product.price > 0 && product.price <= 100000);
  }
  if (updates.curfewEnabled !== undefined) s.curfewEnabled = !!updates.curfewEnabled;
  if (updates.curfewStart !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(updates.curfewStart)) s.curfewStart = updates.curfewStart;
  if (updates.curfewEnd !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(updates.curfewEnd)) s.curfewEnd = updates.curfewEnd;
  if (updates.coinRates !== undefined && Array.isArray(updates.coinRates)) s.coinRates = updates.coinRates;
  if (updates.pointRates !== undefined && Array.isArray(updates.pointRates)) s.pointRates = updates.pointRates;
  if (updates.attendanceEnabled !== undefined) s.attendanceEnabled = !!updates.attendanceEnabled;
  if (updates.attendanceMode === 'login' || updates.attendanceMode === 'minutes') s.attendanceMode = updates.attendanceMode;
  const beforeRange = attendanceBounds(s);
  const ranged = updates.attendanceMinMinutes !== undefined || updates.attendanceMaxMinutes !== undefined;
  if (updates.attendanceMinutes !== undefined) s.attendanceMinutes = updates.attendanceMinutes;
  if (ranged) {
    s.attendanceMinMinutes = updates.attendanceMinMinutes;
    s.attendanceMaxMinutes = updates.attendanceMaxMinutes;
  } else if (updates.attendanceMinutes !== undefined) {
    // Older clients that send one value still configure a fixed target.
    s.attendanceMinMinutes = updates.attendanceMinutes;
    s.attendanceMaxMinutes = updates.attendanceMinutes;
  }
  const afterRange = attendanceBounds(s);
  if (updates.attendanceTargetSeed !== undefined) {
    if (updates.attendanceTargetSeed === '' || /^[0-9a-f]{32}$/.test(updates.attendanceTargetSeed)) {
      s.attendanceTargetSeed = updates.attendanceTargetSeed;
    }
  } else if (beforeRange.min !== afterRange.min || beforeRange.max !== afterRange.max) {
    s.attendanceTargetSeed = crypto.randomBytes(16).toString('hex');
  }
  if (updates.attendancePoints !== undefined) s.attendancePoints = updates.attendancePoints;
  if (updates.wheel !== undefined) {
    const wheel = require('./wheel-config').parseWheel(updates.wheel);
    if (!wheel) throw new Error('Wheel requires 2–12 distinct multipliers and winning percentages totaling exactly 100%.');
    s.wheel = wheel;
  }
  if (updates.wheelDraft !== undefined) {
    const draft = updates.wheelDraft === null ? null : require('./wheel-config').parseWheel(updates.wheelDraft);
    if (updates.wheelDraft !== null && !draft) throw new Error('Wheel draft requires valid multipliers and percentages totaling 100%.');
    s.wheelDraft = draft;
  }
  if (updates.attendanceEnabled !== undefined || updates.attendanceMode !== undefined ||
      updates.attendanceMinutes !== undefined || ranged || updates.attendanceTargetSeed !== undefined ||
      updates.attendancePoints !== undefined) {
    const day = attendanceDayKey();
    s.attendancePolicies = s.attendancePolicies || {};
    s.attendancePolicies[day] = {
      enabled: !!s.attendanceEnabled,
      mode: s.attendanceMode === 'login' ? 'login' : 'minutes',
      minutes: attendanceTargetForDay(s, day),
      minMinutes: afterRange.min,
      maxMinutes: afterRange.max,
      targetSeed: s.attendanceTargetSeed || '',
      points: s.attendancePoints ?? 1
    };
  }
  if (updates.monthlyLeaderboardReportedPeriod !== undefined) {
    s.monthlyLeaderboardReportedPeriod = String(updates.monthlyLeaderboardReportedPeriod || '').slice(0, 7);
  }
  if (updates.syncServerUrl !== undefined) s.syncServerUrl = updates.syncServerUrl;
  save(s);
  return getSettings();
}

function ensurePlaytimeMission() {
  if (load().attendanceMode !== 'login') return false;
  // Only today's policy changes; earlier attendance days retain their rules.
  updateSettings({ attendanceMode: 'minutes' });
  return true;
}

function getAttendancePolicy(day) {
  const raw = load();
  if (day === attendanceDayKey()) {
    const s = getSettings();
    return { enabled: s.attendanceEnabled, mode: s.attendanceMode, minutes: s.attendanceMinutes, points: s.attendancePoints };
  }
  const latest = Object.keys(raw.attendancePolicies || {}).filter(key => key <= day).sort().pop();
  return latest ? attendancePolicyForDay(raw.attendancePolicies[latest], day)
    : { enabled: false, mode: 'minutes', minutes: 60, points: 1 };
}

function getAttendancePoliciesForYear(year) {
  const raw = load();
  const keys = Object.keys(raw.attendancePolicies || {}).sort();
  const current = getSettings();
  const todayKey = attendanceDayKey();
  const policies = {};
  let latest = 0;
  let policy = { enabled: false, mode: 'minutes', minutes: 60, points: 1 };
  const cursor = new Date(year, 0, 1);
  while (cursor.getFullYear() === year) {
    const day = `${year}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
    while (latest < keys.length && keys[latest] <= day) {
      policy = raw.attendancePolicies[keys[latest++]];
    }
    policies[day] = day === todayKey
      ? { enabled: current.attendanceEnabled, mode: current.attendanceMode,
        minutes: current.attendanceMinutes, points: current.attendancePoints }
      : attendancePolicyForDay(policy, day);
    cursor.setDate(cursor.getDate() + 1);
  }
  return policies;
}

function saveBackgroundImage(fileBuffer, originalName, mimeType) {
  ensureDirs();
  const extMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' };
  const ext = extMap[mimeType] || '.png';
  const filename = 'background' + ext;
  const filepath = path.join(uploadsDir, filename);

  const existingFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('background'));
  for (const f of existingFiles) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
  }

  fs.writeFileSync(filepath, fileBuffer);

  const s = load();
  s.backgroundImage = { filename, mimeType, size: fileBuffer.length, version: Date.now() };
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

function saveLoginImage(fileBuffer, originalName, mimeType) {
  ensureDirs();
  const ext = path.extname(originalName).toLowerCase() || '.png';
  const filename = 'loginimage' + ext;
  const filepath = path.join(uploadsDir, filename);
  const existingFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('loginimage'));
  for (const f of existingFiles) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
  }
  fs.writeFileSync(filepath, fileBuffer);
  const s = load();
  s.loginImage = { filename, mimeType, size: fileBuffer.length, version: Date.now() };
  save(s);
  return s.loginImage;
}

function removeLoginImage() {
  ensureDirs();
  const existingFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('loginimage'));
  for (const f of existingFiles) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
  }
  const s = load();
  s.loginImage = null;
  save(s);
}

function saveRegisterImage(fileBuffer, originalName, mimeType) {
  ensureDirs();
  const ext = path.extname(originalName).toLowerCase() || '.png';
  const filename = 'registerimage' + ext;
  const filepath = path.join(uploadsDir, filename);
  const existingFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('registerimage'));
  for (const f of existingFiles) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
  }
  fs.writeFileSync(filepath, fileBuffer);
  const s = load();
  s.registerImage = { filename, mimeType, size: fileBuffer.length, version: Date.now() };
  save(s);
  return s.registerImage;
}

function removeRegisterImage() {
  ensureDirs();
  const existingFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('registerimage'));
  for (const f of existingFiles) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
  }
  const s = load();
  s.registerImage = null;
  save(s);
}

function swapPanelImages() {
  ensureDirs();
  const s = load();
  const loginMeta = s.loginImage;
  const registerMeta = s.registerImage;
  if (!loginMeta && !registerMeta) return null;

  const loginFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('loginimage'));
  const registerFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('registerimage'));

  for (const f of loginFiles) {
    const src = path.join(uploadsDir, f);
    const dst = path.join(uploadsDir, '_swap_' + f);
    fs.renameSync(src, dst);
  }
  for (const f of registerFiles) {
    const src = path.join(uploadsDir, f);
    const newName = f.replace('registerimage', 'loginimage');
    fs.renameSync(src, path.join(uploadsDir, newName));
  }
  const swapFiles = fs.readdirSync(uploadsDir).filter(f => f.startsWith('_swap_loginimage'));
  for (const f of swapFiles) {
    const src = path.join(uploadsDir, f);
    const newName = f.replace('_swap_loginimage', 'registerimage');
    fs.renameSync(src, path.join(uploadsDir, newName));
  }

  if (loginMeta && registerMeta) {
    const swapVersion = Date.now();
    const newLoginFilename = registerMeta.filename.replace('registerimage', 'loginimage');
    const newRegisterFilename = loginMeta.filename.replace('loginimage', 'registerimage');
    s.loginImage = { filename: newLoginFilename, mimeType: registerMeta.mimeType, size: registerMeta.size, version: swapVersion };
    s.registerImage = { filename: newRegisterFilename, mimeType: loginMeta.mimeType, size: loginMeta.size, version: swapVersion };
  } else if (loginMeta && !registerMeta) {
    const newRegisterFilename = loginMeta.filename.replace('loginimage', 'registerimage');
    s.registerImage = { filename: newRegisterFilename, mimeType: loginMeta.mimeType, size: loginMeta.size, version: Date.now() };
    s.loginImage = null;
  } else if (!loginMeta && registerMeta) {
    const newLoginFilename = registerMeta.filename.replace('registerimage', 'loginimage');
    s.loginImage = { filename: newLoginFilename, mimeType: registerMeta.mimeType, size: registerMeta.size, version: Date.now() };
    s.registerImage = null;
  }

  save(s);
  return { loginImage: s.loginImage, registerImage: s.registerImage };
}

function getUploadsDir() {
  return uploadsDir;
}

function sanitizeAdHtml(html) {
  if (!html) return '';
  const allowedTags = ['b', 'i', 'u', 's', 'strike', 'del', 'strong', 'em', 'br', 'font', 'span', 'div', 'p', 'a', 'img', 'ul', 'ol', 'li', 'hr', 'blockquote', 'sub', 'sup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code'];
  const allowedAttrs = { font: ['color', 'size', 'face'], span: ['style'], div: ['style'], p: ['style'], b: ['style'], strong: ['style'], i: ['style'], em: ['style'], u: ['style'], s: ['style'], strike: ['style'], del: ['style'], sub: ['style'], sup: ['style'], a: ['href', 'target', 'style'], img: ['src', 'alt', 'width', 'height', 'style'], h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'], h5: ['style'], h6: ['style'], blockquote: ['style'], li: ['style'], ul: ['style'], ol: ['style'] };
  const safeStyleProps = ['color', 'font-size', 'text-align', 'font-weight', 'font-style', 'text-decoration', 'background-color', 'font-family', 'line-height', 'margin', 'padding', 'max-width', 'width', 'height', 'border', 'display'];

  function decodeEntities(str) {
    return str.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
              .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
              .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
              .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'");
  }
  function isSafeUrl(url) {
    const decoded = decodeEntities(url).replace(/[\x00-\x1f\x7f]/g, '').trim().toLowerCase();
    if (/^(javascript|data|vbscript)\s*:/i.test(decoded)) return false;
    return true;
  }

  html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  html = html.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  html = html.replace(/on\w+\s*=\s*[^\s>]*/gi, '');

  html = html.replace(/<\/?(\w+)([^>]*)>/g, (match, tag, attrs) => {
    const t = tag.toLowerCase();
    if (!allowedTags.includes(t)) return '';
    if (match.startsWith('</')) return '</' + t + '>';
    const tagAllowed = allowedAttrs[t] || [];
    let safeAttrs = '';
    if (tagAllowed.length > 0) {
      const attrRegex = /(\w+)\s*=\s*["']([^"']*)["']/g;
      let m;
      while ((m = attrRegex.exec(attrs)) !== null) {
        const aName = m[1].toLowerCase();
        const aVal = m[2];
        if (!tagAllowed.includes(aName)) continue;
        if ((aName === 'href' || aName === 'src') && !isSafeUrl(aVal)) continue;
        if (aName === 'style') {
          const safeParts = aVal.split(';').filter(p => {
            const prop = p.split(':')[0]?.trim().toLowerCase();
            return prop && safeStyleProps.includes(prop);
          });
          if (safeParts.length > 0) safeAttrs += ' style="' + safeParts.join(';') + '"';
        } else {
          if (!/[<>"']/.test(aVal)) safeAttrs += ' ' + aName + '="' + aVal + '"';
        }
      }
      if (t === 'a' && safeAttrs.includes('target=')) {
        safeAttrs += ' rel="noopener noreferrer"';
      }
    }
    return '<' + t + safeAttrs + '>';
  });
  return html;
}

function getAds() {
  const s = load();
  return s.ads || [];
}

function addAd(content, imageInfo) {
  const s = load();
  if (!s.ads) s.ads = [];
  const id = crypto.randomBytes(8).toString('hex');
  const ad = { id, content: sanitizeAdHtml(content), image: imageInfo || null, order: s.ads.length };
  s.ads.push(ad);
  save(s);
  return ad;
}

function updateAd(id, updates) {
  const s = load();
  if (!s.ads) return null;
  const ad = s.ads.find(a => a.id === id);
  if (!ad) return null;
  if (updates.content !== undefined) ad.content = sanitizeAdHtml(updates.content);
  if (updates.image !== undefined) ad.image = updates.image;
  save(s);
  return ad;
}

function adExists(id) {
  const s = load();
  return s.ads && s.ads.some(a => a.id === id);
}

function removeAd(id) {
  const s = load();
  if (!s.ads) return false;
  const idx = s.ads.findIndex(a => a.id === id);
  if (idx === -1) return false;
  const ad = s.ads[idx];
  if (ad.image && ad.image.filename) {
    const filepath = path.join(uploadsDir, ad.image.filename);
    try { fs.unlinkSync(filepath); } catch (e) {}
  }
  s.ads.splice(idx, 1);
  s.ads.forEach((a, i) => a.order = i);
  save(s);
  return true;
}

function reorderAds(orderedIds) {
  const s = load();
  if (!s.ads) return [];
  const map = {};
  s.ads.forEach(a => map[a.id] = a);
  const reordered = [];
  orderedIds.forEach((id, i) => {
    if (map[id]) { map[id].order = i; reordered.push(map[id]); delete map[id]; }
  });
  Object.values(map).forEach(a => { a.order = reordered.length; reordered.push(a); });
  s.ads = reordered;
  save(s);
  return s.ads;
}

function saveAdImage(adId, fileBuffer, originalName, mimeType) {
  ensureDirs();
  const ext = path.extname(originalName).toLowerCase() || '.png';
  const filename = 'ad_' + adId + ext;
  const filepath = path.join(uploadsDir, filename);
  const existing = fs.readdirSync(uploadsDir).filter(f => f.startsWith('ad_' + adId));
  for (const f of existing) {
    try { fs.unlinkSync(path.join(uploadsDir, f)); } catch (e) {}
  }
  fs.writeFileSync(filepath, fileBuffer);
  return { filename, mimeType, size: fileBuffer.length, version: Date.now() };
}

module.exports = {
  setAppRole,
  setDataDir,
  isAdminRegistered,
  registerAdmin,
  verifyAdmin,
  changeAdminPassword,
  getSettings,
  getPublicSettings,
  updateSettings,
  ensurePlaytimeMission,
  getAttendancePolicy,
  getAttendancePoliciesForYear,
  getTelegramSettings,
  getTelegramAdminSettings,
  updateTelegramSettings,
  isWithinCurfew,
  saveBackgroundImage,
  removeBackgroundImage,
  getBackgroundImagePath,
  saveLoginImage,
  removeLoginImage,
  saveRegisterImage,
  removeRegisterImage,
  swapPanelImages,
  getUploadsDir,
  getAds,
  addAd,
  updateAd,
  removeAd,
  reorderAds,
  saveAdImage,
  adExists,
};
