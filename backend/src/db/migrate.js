const db = require('./index');
const logger = require('../utils/logger');

const MIGRATIONS = [
  {
    name: '001_create_users_table',
    up: `
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        role VARCHAR(50) NOT NULL DEFAULT 'TESTER',
        status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        last_login_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    `
  },
  {
    name: '002_create_user_sessions_table',
    up: `
      CREATE TABLE IF NOT EXISTS user_sessions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) UNIQUE NOT NULL,
        ip_address VARCHAR(45),
        user_agent TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON user_sessions(token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON user_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON user_sessions(expires_at);
    `
  },
  {
    name: '003_create_password_resets_table',
    up: `
      CREATE TABLE IF NOT EXISTS password_resets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(64) UNIQUE NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_resets_token_hash ON password_resets(token_hash);
      CREATE INDEX IF NOT EXISTS idx_resets_user_id ON password_resets(user_id);
    `
  },
  {
    name: '004_create_google_drive_tokens_table',
    up: `
      CREATE TABLE IF NOT EXISTS google_drive_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        google_email VARCHAR(255) NOT NULL,
        google_name VARCHAR(255),
        google_picture TEXT,
        encrypted_access_token TEXT NOT NULL,
        encrypted_refresh_token TEXT,
        token_iv VARCHAR(64) NOT NULL,
        token_auth_tag VARCHAR(64) NOT NULL,
        expiry_date BIGINT,
        scope TEXT NOT NULL,
        default_folder_id VARCHAR(255),
        default_folder_name VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_gdrive_tokens_user_id ON google_drive_tokens(user_id);
    `
  },
  {
    name: '005_create_recordings_table',
    up: `
      CREATE TABLE IF NOT EXISTS recordings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        recording_id VARCHAR(255) UNIQUE NOT NULL,
        filename VARCHAR(255) NOT NULL,
        original_filename VARCHAR(255) NOT NULL,
        mime_type VARCHAR(100),
        size_bytes BIGINT,
        duration_sec INT,
        device_serial VARCHAR(100),
        device_name VARCHAR(255),
        test_id VARCHAR(255),
        google_drive_file_id VARCHAR(255),
        google_drive_folder_id VARCHAR(255),
        google_drive_folder_name VARCHAR(255),
        google_drive_web_view_link TEXT,
        google_drive_share_link TEXT,
        google_account_email VARCHAR(255),
        upload_status VARCHAR(50) DEFAULT 'LOCAL_ONLY',
        upload_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_recordings_user_id ON recordings(user_id);
      CREATE INDEX IF NOT EXISTS idx_recordings_test_id ON recordings(test_id);
    `
  },
  {
    name: '006_create_oauth_states_table',
    up: `
      CREATE TABLE IF NOT EXISTS oauth_states (
        nonce VARCHAR(64) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at BIGINT NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_oauth_states_user_id ON oauth_states(user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_gdrive_tokens_unique_user ON google_drive_tokens(user_id);
    `
  }
];

async function runMigrations(customPool = null) {
  const queryFn = customPool ? (text, params) => customPool.query(text, params) : db.query;

  // Create schema migrations tracking table
  await queryFn(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  const appliedResult = await queryFn('SELECT name FROM schema_migrations');
  const appliedNames = new Set(appliedResult.rows.map(r => r.name));

  for (const m of MIGRATIONS) {
    if (!appliedNames.has(m.name)) {
      logger.info(`[DB Migration] Applying ${m.name}...`);
      await queryFn(m.up);
      await queryFn('INSERT INTO schema_migrations (name) VALUES ($1)', [m.name]);
      logger.info(`[DB Migration] Applied ${m.name} successfully.`);
    }
  }

  // Restore persisted authentication data if using file-backed pg-mem
  if (!customPool && typeof db.restoreFromDisk === 'function') {
    await db.restoreFromDisk();
  }

  return { success: true, count: MIGRATIONS.length };
}

module.exports = {
  MIGRATIONS,
  runMigrations
};
