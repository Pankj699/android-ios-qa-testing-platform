const fs = require('fs');
const path = require('path');
const db = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

/**
 * Ensures the dedicated ai_schema_migrations table exists in qa_ai_platform.
 */
async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS ai_schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

/**
 * Retrieves the set of already applied migration names.
 */
async function getAppliedMigrations(client) {
  const result = await client.query('SELECT name FROM ai_schema_migrations ORDER BY id ASC');
  return new Set(result.rows.map(r => r.name));
}

/**
 * Reads all .sql files in migrations directory, sorted alphanumerically.
 */
function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();
}

/**
 * Executes a single migration file within a transaction.
 * Records the migration in ai_schema_migrations ONLY after execution succeeds.
 */
async function executeMigration(client, filename) {
  const filePath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filePath, 'utf8');

  console.log(`[AI DB Migration] Executing ${filename}...`);
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query('INSERT INTO ai_schema_migrations (name) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    console.log(`[AI DB Migration] Applied ${filename} successfully.`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[AI DB Migration] FAILED ${filename}: ${err.message}`);
    throw err;
  }
}

// Stable advisory lock identifier for qa_ai_platform migration runner
const MIGRATION_ADVISORY_LOCK_ID = 829471928;

/**
 * Main migration entrypoint.
 * Connects to qa_ai_platform, acquires an advisory lock to serialize concurrent
 * runners, executes pending migrations in order, and returns execution summary.
 */
async function runAiMigrations(customClient = null) {
  const client = customClient || await db.getClient();
  const shouldRelease = !customClient;
  let lockAcquired = false;

  try {
    // 1. Acquire session-level advisory lock to serialize concurrent migration executions
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
    lockAcquired = true;

    await ensureMigrationTable(client);
    const appliedSet = await getAppliedMigrations(client);
    const files = getMigrationFiles();

    const applied = [];
    const skipped = [];

    for (const file of files) {
      if (appliedSet.has(file)) {
        skipped.push(file);
      } else {
        await executeMigration(client, file);
        applied.push(file);
      }
    }

    return {
      success: true,
      totalMigrations: files.length,
      appliedCount: applied.length,
      skippedCount: skipped.length,
      applied,
      skipped
    };
  } finally {
    if (lockAcquired) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
      } catch (err) {
        console.error('[AI DB Migration] Failed to release advisory lock:', err.message);
      }
    }
    if (shouldRelease) {
      client.release();
    }
  }
}

module.exports = {
  runAiMigrations,
  ensureMigrationTable,
  getAppliedMigrations,
  getMigrationFiles,
  executeMigration,
  MIGRATION_ADVISORY_LOCK_ID
};
