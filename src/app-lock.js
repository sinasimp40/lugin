const http = require('http');

const LOCK_PORT = parseInt(process.env.DENFI_LOCK_PORT || '47318', 10);
const LOCK_HOST = '127.0.0.1';

let lockServer = null;
let heldRole = null;

function acquireLock(role) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/denfi-role') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ role: heldRole, pid: process.pid }));
        return;
      }
      res.writeHead(404).end();
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        queryHolder().then((info) => {
          resolve({ acquired: false, holder: info, reason: 'in-use' });
        });
      } else {
        resolve({ acquired: false, reason: err.code || err.message });
      }
    });

    server.listen(LOCK_PORT, LOCK_HOST, () => {
      lockServer = server;
      heldRole = role;
      resolve({ acquired: true, role });
    });
  });
}

function queryHolder() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: LOCK_HOST, port: LOCK_PORT, path: '/denfi-role', timeout: 1500 },
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
  }
}

module.exports = { acquireLock, releaseLock, queryHolder, LOCK_PORT };
