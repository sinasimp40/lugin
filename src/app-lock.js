const http = require('http');
const path = require('path');

const LOCK_PORT = parseInt(process.env.DENFI_LOCK_PORT || '47318', 10);
const LOCK_HOST = '127.0.0.1';

let lockServer = null;
let heldRole = null;
let heldDataDir = null;

function lockPortForRole(role) {
  if (role === 'points') return LOCK_PORT;
  if (role === 'auto-shutdown') return LOCK_PORT + 1;
  throw new Error('Unknown Denfi app role');
}

function sameDataDir(first, second) {
  if (!first || !second) return false;
  const normalize = dir => process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir);
  return normalize(first) === normalize(second);
}

function acquireLock(role, dataDir) {
  if (!dataDir) throw new Error('A data folder is required for the desktop lock');
  const resolvedDataDir = path.resolve(dataDir);
  return new Promise((resolve) => {
    const port = lockPortForRole(role);
    const server = http.createServer((req, res) => {
      if (req.url === '/denfi-role') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ role: heldRole, pid: process.pid, dataDir: heldDataDir }));
        return;
      }
      res.writeHead(404).end();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        queryHolder(role).then((info) => {
          resolve({ acquired: false, holder: info, reason: 'in-use' });
        });
      } else {
        resolve({ acquired: false, reason: err.code || err.message });
      }
    });

    server.listen(port, LOCK_HOST, () => {
      lockServer = server;
      heldRole = role;
      heldDataDir = resolvedDataDir;
      resolve({ acquired: true, role });
    });
  });
}

function queryHolder(role) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: LOCK_HOST, port: lockPortForRole(role), path: '/denfi-role', timeout: 1500 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (_) {
            resolve({ role: 'unknown', pid: null });
          }
        });
      }
    );
    req.on('error', () => resolve({ role: 'unknown', pid: null }));
    req.on('timeout', () => {
      try { req.destroy(); } catch (_) {}
      resolve({ role: 'unknown', pid: null });
    });
  });
}

function releaseLock() {
  if (lockServer) {
    try { lockServer.close(); } catch (_) {}
    lockServer = null;
    heldRole = null;
    heldDataDir = null;
  }
}

module.exports = { acquireLock, releaseLock, queryHolder, sameDataDir, lockPortForRole, LOCK_PORT };
