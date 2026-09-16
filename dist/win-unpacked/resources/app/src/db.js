const Database = require('better-sqlite3');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

let db;

function init() {
  const userDataPath = app.getPath('userData');
  if (!fs.existsSync(userDataPath)) fs.mkdirSync(userDataPath, { recursive: true });
  const dbPath = path.join(userDataPath, 'hotspot.db');
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS router_config (
      id INTEGER PRIMARY KEY,
      host TEXT NOT NULL,
      api_port INTEGER DEFAULT 8728,
      api_user TEXT NOT NULL,
      api_password TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS session_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL,
      logged_in_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function saveRouterConfig(config) {
  db.prepare(`
    INSERT OR REPLACE INTO router_config (id, host, api_port, api_user, api_password, updated_at)
    VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run(config.host, config.apiPort || 8728, config.apiUser, config.apiPassword);
}

function getRouterConfig() {
  if (!db) return null;
  const row = db.prepare('SELECT * FROM router_config WHERE id = 1').get();
  if (!row) return null;
  return {
    host: row.host,
    apiPort: row.api_port,
    apiUser: row.api_user,
    apiPassword: row.api_password,
  };
}

function saveSession(username) {
  db.prepare('INSERT INTO session_log (username) VALUES (?)').run(username);
}

module.exports = { init, saveRouterConfig, getRouterConfig, saveSession };
