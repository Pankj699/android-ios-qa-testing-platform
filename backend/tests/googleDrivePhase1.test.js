const { test, describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const config = require('../src/config');
const db = require('../src/db');
const { runMigrations, MIGRATIONS } = require('../src/db/migrate');
const tokenCrypto = require('../src/utils/tokenCrypto');

describe('Google Drive Integration — Phase 1 Test Suite', () => {
  let origEnv;

  before(async () => {
    origEnv = config.NODE_ENV;
    config.NODE_ENV = 'test';
    await runMigrations();
  });

  after(() => {
    if (origEnv !== undefined) {
      config.NODE_ENV = origEnv;
    }
  });

  beforeEach(() => {
    tokenCrypto._resetConsumedStates();
  });

  describe('1. AES-256-GCM Token Encryption & Decryption', () => {
    it('successfully encrypts and decrypts OAuth tokens', () => {
      const sampleAccessToken = 'ya29.a0AfH6SMD-sample-access-token-xyz123';
      const encryptedObj = tokenCrypto.encryptToken(sampleAccessToken);

      assert.ok(encryptedObj);
      assert.ok(encryptedObj.encrypted);
      assert.ok(encryptedObj.iv);
      assert.ok(encryptedObj.authTag);

      // Verify lengths (12 bytes IV = 24 hex chars; 16 bytes authTag = 32 hex chars)
      assert.strictEqual(encryptedObj.iv.length, 24);
      assert.strictEqual(encryptedObj.authTag.length, 32);
      assert.notStrictEqual(encryptedObj.encrypted, sampleAccessToken);

      // Decrypt
      const decrypted = tokenCrypto.decryptToken(
        encryptedObj.encrypted,
        encryptedObj.iv,
        encryptedObj.authTag
      );

      assert.strictEqual(decrypted, sampleAccessToken);
    });

    it('encrypts and decrypts with a custom 32-byte key or 64-char hex key', () => {
      const customKeyHex = crypto.randomBytes(32).toString('hex');
      const sampleRefreshToken = '1//0gRefreshToken-secure-secret-token-abc';

      const encryptedObj = tokenCrypto.encryptToken(sampleRefreshToken, customKeyHex);
      assert.ok(encryptedObj);

      const decrypted = tokenCrypto.decryptToken(
        encryptedObj.encrypted,
        encryptedObj.iv,
        encryptedObj.authTag,
        customKeyHex
      );

      assert.strictEqual(decrypted, sampleRefreshToken);
    });

    it('returns null when input is empty or null', () => {
      assert.strictEqual(tokenCrypto.encryptToken(null), null);
      assert.strictEqual(tokenCrypto.encryptToken(''), null);
      assert.strictEqual(tokenCrypto.decryptToken(null, 'iv', 'tag'), null);
      assert.strictEqual(tokenCrypto.decryptToken('enc', null, 'tag'), null);
      assert.strictEqual(tokenCrypto.decryptToken('enc', 'iv', null), null);
    });

    it('throws an error if ciphertext has been tampered with', () => {
      const sampleToken = 'valid-token-data';
      const encryptedObj = tokenCrypto.encryptToken(sampleToken);

      // Tamper with first character of ciphertext
      const tamperedEncrypted =
        (encryptedObj.encrypted[0] === 'a' ? 'b' : 'a') + encryptedObj.encrypted.slice(1);

      assert.throws(
        () => {
          tokenCrypto.decryptToken(tamperedEncrypted, encryptedObj.iv, encryptedObj.authTag);
        },
        {
          message: /Failed to decrypt OAuth token: integrity check failed/i
        }
      );
    });

    it('throws an error if authTag has been tampered with', () => {
      const sampleToken = 'valid-token-data';
      const encryptedObj = tokenCrypto.encryptToken(sampleToken);

      // Tamper with auth tag
      const tamperedTag =
        (encryptedObj.authTag[0] === '0' ? '1' : '0') + encryptedObj.authTag.slice(1);

      assert.throws(
        () => {
          tokenCrypto.decryptToken(encryptedObj.encrypted, encryptedObj.iv, tamperedTag);
        },
        {
          message: /Failed to decrypt OAuth token: integrity check failed/i
        }
      );
    });

    it('throws an error if decrypted with a different key', () => {
      const sampleToken = 'valid-token-data';
      const key1 = crypto.randomBytes(32).toString('hex');
      const key2 = crypto.randomBytes(32).toString('hex');

      const encryptedObj = tokenCrypto.encryptToken(sampleToken, key1);

      assert.throws(
        () => {
          tokenCrypto.decryptToken(
            encryptedObj.encrypted,
            encryptedObj.iv,
            encryptedObj.authTag,
            key2
          );
        },
        {
          message: /Failed to decrypt OAuth token: integrity check failed/i
        }
      );
    });
  });

  describe('2. OAuth State Security & Single-Use Replay Protection', () => {
    it('generates and verifies a valid OAuth state', () => {
      const userId = '11111111-2222-3333-4444-555555555555';
      const state = tokenCrypto.generateOAuthState(userId);

      assert.ok(state);
      assert.strictEqual(typeof state, 'string');

      const verified = tokenCrypto.verifyAndConsumeOAuthState(state, userId);
      assert.strictEqual(verified.userId, userId);
      assert.ok(verified.nonce);
      assert.ok(verified.expiresAt > Date.now());
    });

    it('rejects replayed OAuth states (single-use replay protection)', () => {
      const userId = '22222222-3333-4444-5555-666666666666';
      const state = tokenCrypto.generateOAuthState(userId);

      // First verification succeeds
      const verifiedFirst = tokenCrypto.verifyAndConsumeOAuthState(state, userId);
      assert.strictEqual(verifiedFirst.userId, userId);

      // Second verification of the exact same state MUST fail
      assert.throws(
        () => {
          tokenCrypto.verifyAndConsumeOAuthState(state, userId);
        },
        {
          message: /replay attempt detected/i
        }
      );
    });

    it('rejects tampered OAuth state signatures', () => {
      const userId = '33333333-4444-5555-6666-777777777777';
      const state = tokenCrypto.generateOAuthState(userId);

      // Decode state and modify payload
      const jsonStr = Buffer.from(state, 'base64url').toString('utf8');
      const stateObj = JSON.parse(jsonStr);
      stateObj.userId = 'attacker-user-id'; // Tampered user

      const tamperedState = Buffer.from(JSON.stringify(stateObj)).toString('base64url');

      assert.throws(
        () => {
          tokenCrypto.verifyAndConsumeOAuthState(tamperedState);
        },
        {
          message: /Invalid or tampered OAuth state signature/i
        }
      );
    });

    it('rejects expired OAuth states', () => {
      const userId = '44444444-5555-6666-7777-888888888888';
      // Create state with negative TTL so it is already expired
      const expiredState = tokenCrypto.generateOAuthState(userId, { ttlMs: -1000 });

      assert.throws(
        () => {
          tokenCrypto.verifyAndConsumeOAuthState(expiredState, userId);
        },
        {
          message: /OAuth state has expired/i
        }
      );
    });

    it('rejects state when expected userId does not match', () => {
      const userIdAlice = 'aaaaaaa-1111-1111-1111-111111111111';
      const userIdBob = 'bbbbbbb-2222-2222-2222-222222222222';

      const state = tokenCrypto.generateOAuthState(userIdAlice);

      assert.throws(
        () => {
          tokenCrypto.verifyAndConsumeOAuthState(state, userIdBob);
        },
        {
          message: /OAuth state user mismatch/i
        }
      );
    });

    it('rejects malformed or empty state string', () => {
      assert.throws(
        () => {
          tokenCrypto.verifyAndConsumeOAuthState(null);
        },
        {
          message: /Missing or invalid OAuth state parameter/i
        }
      );

      assert.throws(
        () => {
          tokenCrypto.verifyAndConsumeOAuthState('not-valid-base64-json!!!');
        },
        {
          message: /Malformed OAuth state format/i
        }
      );
    });
  });

  describe('3. Database Migrations (004 and 005)', () => {
    it('verifies google_drive_tokens table schema and constraints', async () => {
      // Check migration existence
      const migrationNames = MIGRATIONS.map((m) => m.name);
      assert.ok(migrationNames.includes('004_create_google_drive_tokens_table'));
      assert.ok(migrationNames.includes('005_create_recordings_table'));

      // Check schema_migrations has recorded them
      const migCheck = await db.query(
        "SELECT name FROM schema_migrations WHERE name IN ('004_create_google_drive_tokens_table', '005_create_recordings_table')"
      );
      assert.strictEqual(migCheck.rows.length, 2);

      // Verify table query execution
      const tokenTest = await db.query('SELECT * FROM google_drive_tokens LIMIT 1');
      assert.ok(Array.isArray(tokenTest.rows));

      const recordingsTest = await db.query('SELECT * FROM recordings LIMIT 1');
      assert.ok(Array.isArray(recordingsTest.rows));
    });
  });

  describe('4. File-Backed pg-mem Persistence After Restart', () => {
    it('preserves google_drive_tokens and recordings across saveToDisk and restoreFromDisk', async () => {
      const testDbFile = path.resolve(__dirname, `../data/test_persistence_${Date.now()}.json`);

      try {
        // Create a test user first to satisfy foreign key constraint
        const testUserId = crypto.randomUUID();
        await db.query(
          `INSERT INTO users (id, email, password_hash, name, role, status)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [testUserId, `persistence_user_${Date.now()}@example.com`, 'hash123', 'Persistence Tester', 'TESTER', 'ACTIVE']
        );

        // Insert sample google_drive_tokens record
        const tokenId = crypto.randomUUID();
        const encryptedToken = tokenCrypto.encryptToken('ya29.test-persist-token');
        await db.query(
          `INSERT INTO google_drive_tokens (
            id, user_id, google_email, google_name,
            encrypted_access_token, encrypted_refresh_token,
            token_iv, token_auth_tag, expiry_date, scope,
            default_folder_id, default_folder_name
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            tokenId,
            testUserId,
            'gdrive.user@gmail.com',
            'GDrive User',
            encryptedToken.encrypted,
            null,
            encryptedToken.iv,
            encryptedToken.authTag,
            Date.now() + 3600000,
            'https://www.googleapis.com/auth/drive.file',
            'folder_123',
            'QA Recordings'
          ]
        );

        // Insert sample recordings record
        const recordingId = crypto.randomUUID();
        await db.query(
          `INSERT INTO recordings (
            id, user_id, recording_id, filename, original_filename,
            mime_type, size_bytes, duration_sec, device_serial,
            google_drive_file_id, upload_status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            recordingId,
            testUserId,
            `rec_${Date.now()}`,
            'recording_001.webm',
            'orig_recording_001.webm',
            'video/webm',
            1048576,
            120,
            'device_xyz_123',
            'gdrive_file_abc_456',
            'UPLOADED'
          ]
        );

        // Save current in-memory database to custom test file
        db.saveToDisk(testDbFile);
        assert.ok(fs.existsSync(testDbFile), 'Backup file was created on disk');

        const savedContent = JSON.parse(fs.readFileSync(testDbFile, 'utf8'));
        assert.ok(Array.isArray(savedContent.google_drive_tokens));
        assert.ok(Array.isArray(savedContent.recordings));
        assert.ok(savedContent.google_drive_tokens.some((t) => t.id === tokenId));
        assert.ok(savedContent.recordings.some((r) => r.id === recordingId));

        // Now simulate fresh server restart by creating a brand new isolated in-memory pool
        const newPool = db.createInMemoryPgPool();
        await runMigrations(newPool);

        // Temporarily set active pool to newPool and restore
        const originalPool = db.getPool();
        db.setPool(newPool);

        await db.restoreFromDisk(testDbFile);

        // Verify that the restored pool has both the token and recording
        const restoredTokenResult = await newPool.query(
          'SELECT * FROM google_drive_tokens WHERE id = $1',
          [tokenId]
        );
        assert.strictEqual(restoredTokenResult.rows.length, 1);
        assert.strictEqual(restoredTokenResult.rows[0].google_email, 'gdrive.user@gmail.com');

        // Verify token decryption on restored data works seamlessly
        const decryptedRestored = tokenCrypto.decryptToken(
          restoredTokenResult.rows[0].encrypted_access_token,
          restoredTokenResult.rows[0].token_iv,
          restoredTokenResult.rows[0].token_auth_tag
        );
        assert.strictEqual(decryptedRestored, 'ya29.test-persist-token');

        const restoredRecordingResult = await newPool.query(
          'SELECT * FROM recordings WHERE id = $1',
          [recordingId]
        );
        assert.strictEqual(restoredRecordingResult.rows.length, 1);
        assert.strictEqual(restoredRecordingResult.rows[0].upload_status, 'UPLOADED');
        assert.strictEqual(restoredRecordingResult.rows[0].google_drive_file_id, 'gdrive_file_abc_456');

        // Restore original pool
        db.setPool(originalPool);
      } finally {
        if (fs.existsSync(testDbFile)) {
          fs.unlinkSync(testDbFile);
        }
      }
    });
  });
});
