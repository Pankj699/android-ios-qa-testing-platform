const { Pool } = require('pg');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

let globalPool = null;

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
    logger.info('[DB] No DATABASE_URL provided. Using in-memory PostgreSQL engine (pg-mem) for offline/testing mode.');
    globalPool = createInMemoryPgPool();
  }

  return globalPool;
}

async function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

async function getClient() {
  const pool = getPool();
  return pool.connect();
}

async function closePool() {
  if (globalPool) {
    try {
      await globalPool.end();
    } catch (e) {}
    globalPool = null;
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
  createInMemoryPgPool
};
