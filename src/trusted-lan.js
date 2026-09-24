const os = require('os');

function ipv4Number(address) {
  const parts = String(address || '').split('.');
  if (parts.length !== 4 || parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((value, part) => ((value << 8) | Number(part)) >>> 0, 0);
}

function privateIpv4(address) {
  const value = ipv4Number(address);
  if (value === null) return false;
  return (value >>> 24) === 10 ||
    ((value >>> 20) === 0xac1) ||
    ((value >>> 16) === 0xc0a8);
}

function cidrContains(address, cidr) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(String(cidr || ''));
  if (!match) return false;
  const base = ipv4Number(match[1]);
  const value = ipv4Number(address);
  const bits = Number(match[2]);
  if (base === null || value === null || bits < 1 || bits > 32 || !privateIpv4(match[1])) return false;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return ((base & mask) >>> 0) === ((value & mask) >>> 0);
}

function trustedLanPeer(remoteAddress, interfaces = os.networkInterfaces(), options = {}) {
  const remote = String(remoteAddress || '').replace(/^::ffff:/i, '');
  if (remote === '127.0.0.1' || remote === '::1') return options.allowLoopback === true;
  if (!privateIpv4(remote)) return false;
  const local = String(options.localAddress || '').replace(/^::ffff:/i, '');
  if (options.subnet && (!cidrContains(remote, options.subnet) || !cidrContains(local, options.subnet))) return false;
  const remoteNumber = ipv4Number(remote);
  return Object.values(interfaces).flat().some(net => {
    if (!net || net.internal || !privateIpv4(net.address) || !net.netmask ||
        (local && net.address !== local)) return false;
    const mask = ipv4Number(net.netmask);
    return mask !== null && mask !== 0 &&
      ((remoteNumber & mask) >>> 0) === ((ipv4Number(net.address) & mask) >>> 0);
  });
}

module.exports = { trustedLanPeer };