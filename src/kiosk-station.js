const { isIP } = require('node:net');

function stationFromHotspot(active) {
  const ip = typeof active?.ip === 'string' ? active.ip.trim() : '';
  const units = active?.units;
  const mapped = units && typeof units === 'object' && !Array.isArray(units) &&
    Object.prototype.hasOwnProperty.call(units, ip) ? units[ip] : null;
  if (typeof mapped === 'string') {
    const name = mapped.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 60);
    if (name) return name;
  }
  // A saved unit label can be cloned across diskless PCs (default: PC 1).
  // Do not present it as detected identity when the live mapping is absent.
  return isIP(ip) ? `Unknown PC (${ip})` : 'Unknown PC';
}

module.exports = { stationFromHotspot };