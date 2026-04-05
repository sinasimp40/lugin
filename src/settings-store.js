const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let dataDir = path.join(__dirname, '..', 'data');
let settingsPath = path.join(dataDir, 'settings.json');
let uploadsDir = path.join(dataDir, 'uploads');

const HMAC_KEY = 'denfi-settings-integrity-v1';

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
        console.log('[Settings] WARNING: Data integrity check failed — file may have been tampered with.');
        console.log('[Settings] Admin password and settings have been reset for security.');
        const fresh = {};
        fresh._sig = computeHmac(fresh);
        save(fresh);
        return fresh;
      }
    }
    return raw;
  } catch (e) {
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

function getSettings() {
  const s = load();
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
    curfewEnabled: !!s.curfewEnabled,
    curfewStart: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.curfewStart) ? s.curfewStart : '22:00',
    curfewEnd: /^([01]\d|2[0-3]):[0-5]\d$/.test(s.curfewEnd) ? s.curfewEnd : '06:00',
    coinRates: Array.isArray(s.coinRates) ? s.coinRates : [],
    pointRates: Array.isArray(s.pointRates) ? s.pointRates : [],
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
    curfewEnabled: s.curfewEnabled,
    curfewStart: s.curfewStart,
    curfewEnd: s.curfewEnd,
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
  if (updates.curfewEnabled !== undefined) s.curfewEnabled = !!updates.curfewEnabled;
  if (updates.curfewStart !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(updates.curfewStart)) s.curfewStart = updates.curfewStart;
  if (updates.curfewEnd !== undefined && /^([01]\d|2[0-3]):[0-5]\d$/.test(updates.curfewEnd)) s.curfewEnd = updates.curfewEnd;
  if (updates.coinRates !== undefined && Array.isArray(updates.coinRates)) s.coinRates = updates.coinRates;
  if (updates.pointRates !== undefined && Array.isArray(updates.pointRates)) s.pointRates = updates.pointRates;
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
  s.loginImage = { filename, mimeType, size: fileBuffer.length };
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
  s.registerImage = { filename, mimeType, size: fileBuffer.length };
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
    const newLoginFilename = registerMeta.filename.replace('registerimage', 'loginimage');
    const newRegisterFilename = loginMeta.filename.replace('loginimage', 'registerimage');
    s.loginImage = { filename: newLoginFilename, mimeType: registerMeta.mimeType, size: registerMeta.size };
    s.registerImage = { filename: newRegisterFilename, mimeType: loginMeta.mimeType, size: loginMeta.size };
  } else if (loginMeta && !registerMeta) {
    const newRegisterFilename = loginMeta.filename.replace('loginimage', 'registerimage');
    s.registerImage = { filename: newRegisterFilename, mimeType: loginMeta.mimeType, size: loginMeta.size };
    s.loginImage = null;
  } else if (!loginMeta && registerMeta) {
    const newLoginFilename = registerMeta.filename.replace('registerimage', 'loginimage');
    s.loginImage = { filename: newLoginFilename, mimeType: registerMeta.mimeType, size: registerMeta.size };
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
  const allowedAttrs = { font: ['color', 'size', 'face'], span: ['style'], div: ['style'], p: ['style'], a: ['href', 'target'], img: ['src', 'alt', 'width', 'height', 'style'], h1: ['style'], h2: ['style'], h3: ['style'], h4: ['style'], h5: ['style'], h6: ['style'], blockquote: ['style'], li: ['style'], ul: ['style'], ol: ['style'] };
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
  return { filename, mimeType, size: fileBuffer.length };
}

module.exports = {
  setDataDir,
  isAdminRegistered,
  registerAdmin,
  verifyAdmin,
  changeAdminPassword,
  getSettings,
  getPublicSettings,
  updateSettings,
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
