const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

let globalPool = null;
let globalMemDb = null;
let isRestored = false;
const AUTH_DB_FILE = process.env.AUTH_DB_FILE || path.join(config.DATA_DIR, 'auth_db.json');

function isTestMode() {
  return (
    process.env.NODE_ENV === 'test' ||
    config.NODE_ENV === 'test' ||
    (Array.isArray(process.execArgv) && process.execArgv.includes('--test')) ||
    (Array.isArray(process.argv) && process.argv.some(a => a.includes('.test.js') || a.includes('node:test')))
  );
}

function saveToDisk(customFile = null) {
  if (!globalMemDb) return;
  const targetFile = customFile || AUTH_DB_FILE;
  if (!customFile && (isTestMode() || !isRestored)) return;

  try {
    const dataDir = path.dirname(targetFile);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const getRows = (table) => {
      try {
        return globalMemDb.public.many(`SELECT * FROM ${table}`);
      } catch (e) {
        return [];
      }
    };

    const payload = {
      users: getRows('users'),
      user_sessions: getRows('user_sessions'),
      password_resets: getRows('password_resets'),
      schema_migrations: getRows('schema_migrations'),
      savedAt: new Date().toISOString()
    };

    fs.writeFileSync(targetFile, JSON.stringify(payload, null, 2), 'utf8');
  } catch (err) {
    logger.error(`[DB Persistence] Failed to save authentication data to disk: ${err.message}`);
  }
}

async function restoreFromDisk(customFile = null) {
  if (!globalMemDb || !globalPool) return;
  const targetFile = customFile || AUTH_DB_FILE;
  if (!customFile && isTestMode()) return;
  if (!fs.existsSync(targetFile)) return;

  try {
    const raw = fs.readFileSync(targetFile, 'utf8');
    const data = JSON.parse(raw);
    if (!data) return;

    // 1. Restore Users
    if (Array.isArray(data.users) && data.users.length > 0) {
      for (const u of data.users) {
        const check = await globalPool.query('SELECT id FROM users WHERE id = $1 OR email = $2', [u.id, u.email]);
        if (check.rows.length === 0) {
          await globalPool.query(
            `INSERT INTO users (id, email, password_hash, name, role, status, created_at, updated_at, last_login_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [u.id, u.email, u.password_hash, u.name, u.role, u.status, u.created_at, u.updated_at, u.last_login_at]
          );
        }
      }
      logger.info(`[DB Persistence] Restored ${data.users.length} persisted user account(s) from disk.`);
    }

    // 2. Restore Sessions (skipping expired ones)
    if (Array.isArray(data.user_sessions) && data.user_sessions.length > 0) {
      const now = new Date();
      let restoredSessions = 0;
      for (const s of data.user_sessions) {
        if (s.expires_at && new Date(s.expires_at) < now) continue;
        const check = await globalPool.query('SELECT id FROM user_sessions WHERE token_hash = $1', [s.token_hash]);
        if (check.rows.length === 0) {
          await globalPool.query(
            `INSERT INTO user_sessions (id, user_id, token_hash, ip_address, user_agent, expires_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [s.id, s.user_id, s.token_hash, s.ip_address, s.user_agent, s.expires_at, s.created_at]
          );
          restoredSessions++;
        }
      }
      if (restoredSessions > 0) {
        logger.info(`[DB Persistence] Restored ${restoredSessions} active user session(s) from disk.`);
      }
    }

    // 3. Restore Password Resets
    if (Array.isArray(data.password_resets) && data.password_resets.length > 0) {
      for (const r of data.password_resets) {
        const check = await globalPool.query('SELECT id FROM password_resets WHERE token_hash = $1', [r.token_hash]);
        if (check.rows.length === 0) {
          await globalPool.query(
            `INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, created_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [r.id, r.user_id, r.token_hash, r.expires_at, r.used_at, r.created_at]
          );
        }
      }
    }
  } catch (err) {
    logger.error(`[DB Persistence] Failed to restore authentication data from disk: ${err.message}`);
  } finally {
    if (!customFile) {
      isRestored = true;
    }
  }
}

function createInMemoryPgPool() {
  const { newDb } = require('pg-mem');
  const memDb = newDb();

  // Register standard PostgreSQL functions used in migrations
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    impure: true,
    implementation: () => crypto.randomUUID()
  });

  const { Pool: MemPool } = memDb.adapters.createPg();
  const pool = new MemPool();
  globalMemDb = memDb;
  return pool;
}

function getPool() {
  if (globalPool) {
    return globalPool;
  }

  if (config.DATABASE_URL && config.DATABASE_URL.trim()) {
    logger.info(`[DB] Connecting to PostgreSQL at ${config.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
    globalPool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: config.DATABASE_URL.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined
    });

    globalPool.on('error', (err) => {
      logger.error(`[DB] Unexpected idle PostgreSQL client error: ${err.message}`);
    });
  } else {
    logger.info('[DB] No DATABASE_URL provided. Using persistent file-backed PostgreSQL engine (pg-mem) for offline/local mode.');
    globalPool = createInMemoryPgPool();
  }

  return globalPool;
}

async function query(text, params) {
  const pool = getPool();
  const res = await pool.query(text, params);

  // If using file-backed pg-mem and query mutates state, persist changes
  if (globalMemDb && !isTestMode()) {
    const trimmed = (typeof text === 'string' ? text.trim().toUpperCase() : '');
    if (
      trimmed.startsWith('INSERT') ||
      trimmed.startsWith('UPDATE') ||
      trimmed.startsWith('DELETE') ||
      trimmed.startsWith('TRUNCATE')
    ) {
      saveToDisk();
    }
  }

  return res;
}

async function getClient() {
  const pool = getPool();
  const client = await pool.connect();
  const origQuery = client.query.bind(client);
  client.query = async (...args) => {
    const res = await origQuery(...args);
    if (globalMemDb && !isTestMode()) {
      const text = typeof args[0] === 'string' ? args[0] : (args[0]?.text || '');
      const trimmed = text.trim().toUpperCase();
      if (
        trimmed.startsWith('INSERT') ||
        trimmed.startsWith('UPDATE') ||
        trimmed.startsWith('DELETE') ||
        trimmed.startsWith('TRUNCATE')
      ) {
        saveToDisk();
      }
    }
    return res;
  };
  return client;
}

async function closePool() {
  if (globalPool) {
    if (globalMemDb && !isTestMode()) {
      saveToDisk();
    }
    try {
      await globalPool.end();
    } catch (e) {}
    globalPool = null;
    globalMemDb = null;
    isRestored = false;
  }
}

function setPool(customPool) {
  globalPool = customPool;
}

module.exports = {
  getPool,
  setPool,
  query,
  getClient,
  closePool,
  createInMemoryPgPool,
  saveToDisk,
  restoreFromDisk
};

