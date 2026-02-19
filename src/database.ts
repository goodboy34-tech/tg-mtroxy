import Database from 'better-sqlite3';
import path from 'path';

const DB_PATH = path.join(__dirname, '..', 'data', 'proxy.db');

// Убедимся что папка data существует
import fs from 'fs';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db: InstanceType<typeof Database> = new Database(DB_PATH);

// WAL mode — быстрее для чтения, безопаснее
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Инициализация таблиц ───
db.exec(`
  -- Таблица серверных нод
  CREATE TABLE IF NOT EXISTS nodes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    domain          TEXT NOT NULL,
    ip              TEXT NOT NULL,
    mtproto_port    INTEGER NOT NULL,
    socks5_port     INTEGER NOT NULL,
    api_port        INTEGER NOT NULL DEFAULT 8080,
    api_token       TEXT NOT NULL,
    secret_dd       TEXT,  -- MTProto secret для fake-TLS (dd)
    secret_normal   TEXT,  -- MTProto secret обычный
    socks5_user     TEXT,  -- SOCKS5 username
    socks5_pass     TEXT,  -- SOCKS5 password
    is_active       INTEGER DEFAULT 1,
    last_check      TEXT,
    status          TEXT DEFAULT 'unknown',  -- online | offline | error | unknown
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );

  -- Логи действий админа
  CREATE TABLE IF NOT EXISTS admin_logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id        INTEGER NOT NULL,
    action          TEXT NOT NULL,
    details         TEXT,
    created_at      TEXT DEFAULT (datetime('now'))
  );
`);// ─── Подготовленные запросы ───

export const queries = {
  // Ноды
  getAllNodes: db.prepare(`SELECT * FROM nodes ORDER BY created_at DESC`),
  getActiveNodes: db.prepare(`SELECT * FROM nodes WHERE is_active = 1`),
  getNodeById: db.prepare(`SELECT * FROM nodes WHERE id = ?`),
  
  insertNode: db.prepare(`
    INSERT INTO nodes (name, domain, ip, mtproto_port, socks5_port, api_port, api_token, secret_dd, secret_normal, socks5_user, socks5_pass, is_active)
    VALUES (@name, @domain, @ip, @mtproto_port, @socks5_port, @api_port, @api_token, @secret_dd, @secret_normal, @socks5_user, @socks5_pass, @is_active)
  `),
  
  updateNode: db.prepare(`
    UPDATE nodes SET 
      name = @name,
      domain = @domain, 
      ip = @ip, 
      mtproto_port = @mtproto_port, 
      socks5_port = @socks5_port,
      api_port = @api_port,
      api_token = @api_token,
      secret_dd = @secret_dd,
      secret_normal = @secret_normal,
      socks5_user = @socks5_user,
      socks5_pass = @socks5_pass,
      is_active = @is_active, 
      updated_at = datetime('now')
    WHERE id = @id
  `),
  
  updateNodeStatus: db.prepare(`
    UPDATE nodes SET status = @status, last_check = datetime('now'), updated_at = datetime('now')
    WHERE id = @id
  `),
  
  updateNodeSecrets: db.prepare(`
    UPDATE nodes SET secret_dd = @secret_dd, secret_normal = @secret_normal, updated_at = datetime('now')
    WHERE id = @id
  `),
  
  deactivateNode: db.prepare(`
    UPDATE nodes SET is_active = 0, updated_at = datetime('now')
    WHERE id = ?
  `),
  
  activateNode: db.prepare(`
    UPDATE nodes SET is_active = 1, updated_at = datetime('now')
    WHERE id = ?
  `),
  
  deleteNode: db.prepare(`DELETE FROM nodes WHERE id = ?`),

  // Логи админа
  insertAdminLog: db.prepare(`
    INSERT INTO admin_logs (admin_id, action, details)
    VALUES (@admin_id, @action, @details)
  `),
  
  getRecentLogs: db.prepare(`
    SELECT * FROM admin_logs ORDER BY created_at DESC LIMIT ?
  `),
};

export default db;
