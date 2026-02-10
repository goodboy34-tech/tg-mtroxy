import Database from 'better-sqlite3';
import type { Statement } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = path.join(__dirname, '..', 'data', 'proxy.db');

// Убедимся что папка data существует
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
    api_url         TEXT NOT NULL,
    api_token       TEXT NOT NULL,
    mtproto_port    INTEGER DEFAULT 443,
    socks5_port     INTEGER DEFAULT 1080,
    workers         INTEGER DEFAULT 2,
    is_active       INTEGER DEFAULT 1,
    status          TEXT DEFAULT 'unknown',  -- online | offline | error | unknown
    last_seen       TEXT,
    cpu_cores       INTEGER DEFAULT 2,
    ram_mb          INTEGER DEFAULT 1024,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );

  -- Таблица секретов MTProto для каждой ноды
  CREATE TABLE IF NOT EXISTS mtproto_secrets (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id         INTEGER NOT NULL,
    secret          TEXT NOT NULL,
    is_fake_tls     INTEGER DEFAULT 1,  -- 1 = dd префикс (fake-TLS), 0 = обычный
    description     TEXT DEFAULT '',
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  );

  -- Таблица SOCKS5 учетных записей
  CREATE TABLE IF NOT EXISTS socks5_accounts (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id         INTEGER NOT NULL,
    username        TEXT NOT NULL,
    password        TEXT NOT NULL,
    description     TEXT DEFAULT '',
    is_active       INTEGER DEFAULT 1,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  );

  -- Таблица подписок пользователей (subscription links)
  CREATE TABLE IF NOT EXISTS subscriptions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    node_ids        TEXT NOT NULL,  -- JSON массив ID нод: "[1,2,3]"
    include_mtproto INTEGER DEFAULT 1,
    include_socks5  INTEGER DEFAULT 1,
    subscription_url TEXT UNIQUE,  -- Уникальная ссылка для импорта
    is_active       INTEGER DEFAULT 1,
    access_count    INTEGER DEFAULT 0,  -- Счетчик обращений
    last_accessed   TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now'))
  );

  -- Таблица логов и событий
  CREATE TABLE IF NOT EXISTS logs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id         INTEGER,
    level           TEXT NOT NULL,  -- info | warning | error | critical
    message         TEXT NOT NULL,
    details         TEXT,
    created_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE SET NULL
  );

  -- Таблица статистики (сохраняется каждые 5 минут)
  CREATE TABLE IF NOT EXISTS node_stats (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id             INTEGER NOT NULL,
    mtproto_connections INTEGER DEFAULT 0,
    mtproto_max         INTEGER DEFAULT 0,
    socks5_connections  INTEGER DEFAULT 0,
    cpu_usage           REAL DEFAULT 0,
    ram_usage           REAL DEFAULT 0,
    network_in_mb       REAL DEFAULT 0,
    network_out_mb      REAL DEFAULT 0,
    created_at          TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  );

  -- Индексы для быстрого поиска
  CREATE INDEX IF NOT EXISTS idx_nodes_active ON nodes(is_active);
  CREATE INDEX IF NOT EXISTS idx_secrets_node ON mtproto_secrets(node_id);
  CREATE INDEX IF NOT EXISTS idx_socks5_node ON socks5_accounts(node_id);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_active ON subscriptions(is_active);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_url ON subscriptions(subscription_url);
  CREATE INDEX IF NOT EXISTS idx_logs_node ON logs(node_id);
  CREATE INDEX IF NOT EXISTS idx_stats_node ON node_stats(node_id);
  CREATE INDEX IF NOT EXISTS idx_stats_date ON node_stats(created_at);
`);

// ─── Подготовленные запросы ───

// Типизированный объект запросов
type Queries = {
  [key: string]: Statement<any>;
};

export const queries: Queries = {
  // ═══ Ноды ═══
  getAllNodes: db.prepare(`SELECT * FROM nodes ORDER BY created_at DESC`),
  getActiveNodes: db.prepare(`SELECT * FROM nodes WHERE is_active = 1 ORDER BY name`),
  getNodeById: db.prepare(`SELECT * FROM nodes WHERE id = ?`),
  getNodeByDomain: db.prepare(`SELECT * FROM nodes WHERE domain = ?`),
  
  insertNode: db.prepare(`
    INSERT INTO nodes (name, domain, ip, api_url, api_token, mtproto_port, socks5_port, workers, cpu_cores, ram_mb)
    VALUES (@name, @domain, @ip, @api_url, @api_token, @mtproto_port, @socks5_port, @workers, @cpu_cores, @ram_mb)
  `),
  
  updateNode: db.prepare(`
    UPDATE nodes 
    SET name = @name, domain = @domain, ip = @ip, api_url = @api_url, 
        mtproto_port = @mtproto_port, socks5_port = @socks5_port, workers = @workers,
        cpu_cores = @cpu_cores, ram_mb = @ram_mb, updated_at = datetime('now')
    WHERE id = @id
  `),

  updateNodeStatus: db.prepare(`
    UPDATE nodes 
    SET status = @status, last_seen = datetime('now'), updated_at = datetime('now')
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

  // ═══ MTProto секреты ═══
  getNodeSecrets: db.prepare(`
    SELECT * FROM mtproto_secrets 
    WHERE node_id = ? AND is_active = 1
    ORDER BY is_fake_tls DESC, created_at
  `),

  getSecretById: db.prepare(`SELECT * FROM mtproto_secrets WHERE id = ?`),

  insertSecret: db.prepare(`
    INSERT INTO mtproto_secrets (node_id, secret, is_fake_tls, description)
    VALUES (@node_id, @secret, @is_fake_tls, @description)
  `),

  updateSecret: db.prepare(`
    UPDATE mtproto_secrets 
    SET secret = @secret, is_fake_tls = @is_fake_tls, description = @description
    WHERE id = @id
  `),

  deactivateSecret: db.prepare(`
    UPDATE mtproto_secrets SET is_active = 0 WHERE id = ?
  `),

  deleteSecret: db.prepare(`DELETE FROM mtproto_secrets WHERE id = ?`),

  // Alias для использования в subscription-manager
  getActiveSecretsForNode: db.prepare(`
    SELECT * FROM mtproto_secrets 
    WHERE node_id = ? AND is_active = 1
    ORDER BY is_fake_tls DESC, created_at
  `),

  // ═══ SOCKS5 аккаунты ═══
  getNodeSocks5Accounts: db.prepare(`
    SELECT * FROM socks5_accounts 
    WHERE node_id = ? AND is_active = 1
    ORDER BY created_at
  `),

  getSocks5AccountById: db.prepare(`SELECT * FROM socks5_accounts WHERE id = ?`),

  insertSocks5Account: db.prepare(`
    INSERT INTO socks5_accounts (node_id, username, password, description)
    VALUES (@node_id, @username, @password, @description)
  `),

  updateSocks5Account: db.prepare(`
    UPDATE socks5_accounts 
    SET username = @username, password = @password, description = @description
    WHERE id = @id
  `),

  deactivateSocks5Account: db.prepare(`
    UPDATE socks5_accounts SET is_active = 0 WHERE id = ?
  `),

  deleteSocks5Account: db.prepare(`DELETE FROM socks5_accounts WHERE id = ?`),

  // Alias для использования в subscription-manager
  getActiveSocks5Accounts: db.prepare(`
    SELECT * FROM socks5_accounts 
    WHERE node_id = ? AND is_active = 1
    ORDER BY created_at
  `),

  // ═══ Логи ═══
  insertLog: db.prepare(`
    INSERT INTO logs (node_id, level, message, details)
    VALUES (@node_id, @level, @message, @details)
  `),

  getRecentLogs: db.prepare(`
    SELECT l.*, n.name as node_name 
    FROM logs l
    LEFT JOIN nodes n ON l.node_id = n.id
    ORDER BY l.created_at DESC
    LIMIT ?
  `),

  getNodeLogs: db.prepare(`
    SELECT * FROM logs 
    WHERE node_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `),

  // ═══ Статистика ═══
  insertStats: db.prepare(`
    INSERT INTO node_stats 
    (node_id, mtproto_connections, mtproto_max, socks5_connections, cpu_usage, ram_usage, network_in_mb, network_out_mb)
    VALUES (@node_id, @mtproto_connections, @mtproto_max, @socks5_connections, @cpu_usage, @ram_usage, @network_in_mb, @network_out_mb)
  `),

  getLatestNodeStats: db.prepare(`
    SELECT * FROM node_stats 
    WHERE node_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `),

  getNodeStatsHistory: db.prepare(`
    SELECT * FROM node_stats 
    WHERE node_id = ? AND created_at > datetime('now', '-24 hours')
    ORDER BY created_at DESC
  `),

  getAllNodesLatestStats: db.prepare(`
    SELECT ns.*, n.name as node_name, n.domain
    FROM node_stats ns
    INNER JOIN (
      SELECT node_id, MAX(created_at) as max_date
      FROM node_stats
      GROUP BY node_id
    ) latest ON ns.node_id = latest.node_id AND ns.created_at = latest.max_date
    INNER JOIN nodes n ON ns.node_id = n.id
    WHERE n.is_active = 1
  `),

  // Очистка старой статистики (старше 7 дней)
  cleanOldStats: db.prepare(`
    DELETE FROM node_stats 
    WHERE created_at < datetime('now', '-7 days')
  `),

  cleanOldLogs: db.prepare(`
    DELETE FROM logs 
    WHERE created_at < datetime('now', '-30 days')
  `),

  // ═══ Подписки (Subscription Links) ═══
  getAllSubscriptions: db.prepare(`SELECT * FROM subscriptions ORDER BY created_at DESC`),
  getActiveSubscriptions: db.prepare(`SELECT * FROM subscriptions WHERE is_active = 1`),
  getSubscriptionById: db.prepare(`SELECT * FROM subscriptions WHERE id = ?`),
  getSubscriptionByUrl: db.prepare(`SELECT * FROM subscriptions WHERE subscription_url = ?`),

  insertSubscription: db.prepare(`
    INSERT INTO subscriptions (name, description, node_ids, include_mtproto, include_socks5, subscription_url)
    VALUES (@name, @description, @node_ids, @include_mtproto, @include_socks5, @subscription_url)
  `),

  updateSubscription: db.prepare(`
    UPDATE subscriptions
    SET name = @name, description = @description, node_ids = @node_ids,
        include_mtproto = @include_mtproto, include_socks5 = @include_socks5,
        updated_at = datetime('now')
    WHERE id = @id
  `),

  updateSubscriptionAccess: db.prepare(`
    UPDATE subscriptions
    SET access_count = access_count + 1, last_accessed = datetime('now')
    WHERE id = ?
  `),

  deactivateSubscription: db.prepare(`
    UPDATE subscriptions SET is_active = 0, updated_at = datetime('now')
    WHERE id = ?
  `),

  activateSubscription: db.prepare(`
    UPDATE subscriptions SET is_active = 1, updated_at = datetime('now')
    WHERE id = ?
  `),

  deleteSubscription: db.prepare(`DELETE FROM subscriptions WHERE id = ?`),
};

export default db;
