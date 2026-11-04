const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let pool = null;

function resolvePassword() {
  if (process.env.AI_DB_PASSWORD) {
    return process.env.AI_DB_PASSWORD;
  }

  // 1. Check local secure secret file outside repo
  const secretFile = 'C:\\pgsql16\\.pgpass_secret';
  if (fs.existsSync(secretFile)) {
    try {
      const content = fs.readFileSync(secretFile, 'utf8').trim();
      if (content) return content;
    } catch (e) {}
  }

  // 2. Check %APPDATA%\postgresql\pgpass.conf
  const appData = process.env.APPDATA;
  if (appData) {
    const pgpassPath = path.join(appData, 'postgresql', 'pgpass.conf');
    if (fs.existsSync(pgpassPath)) {
      try {
        const lines = fs.readFileSync(pgpassPath, 'utf8').split('\n');
        for (const line of lines) {
          const parts = line.trim().split(':');
          if (parts.length >= 5 && (parts[2] === '*' || parts[2] === (process.env.AI_DB_NAME || 'qa_ai_platform'))) {
            return parts[4];
          }
        }
      } catch (e) {}
    }
  }

  return '';
}

function getPoolConfig() {
  if (process.env.AI_DATABASE_URL && process.env.AI_DATABASE_URL.trim()) {
    return {
      connectionString: process.env.AI_DATABASE_URL.trim(),
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000
    };
  }

  return {
    host: process.env.AI_DB_HOST || '127.0.0.1',
    port: parseInt(process.env.AI_DB_PORT, 10) || 5432,
    database: process.env.AI_DB_NAME || 'qa_ai_platform',
    user: process.env.AI_DB_USER || 'postgres',
    password: resolvePassword(),
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000
  };
}

function getPool() {
  if (!pool) {
    pool = new Pool(getPoolConfig());
    pool.on('error', (err) => {
      console.error('[AI DB] Unexpected error on idle client:', err.message);
    });
  }
  return pool;
}

async function query(text, params) {
  const p = getPool();
  return p.query(text, params);
}

async function getClient() {
  const p = getPool();
  return p.connect();
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = {
  getPool,
  getClient,
  query,
  closePool,
  getPoolConfig
};
