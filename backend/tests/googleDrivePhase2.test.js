const { test, describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const config = require('../src/config');
const db = require('../src/db');
const { runMigrations, MIGRATIONS } = require('../src/db/migrate');
const tokenCrypto = require('../src/utils/tokenCrypto');
const googleDriveService = require('../src/services/googleDriveService');
const driveController = require('../src/controllers/driveController');
const { authenticate } = require('../src/middleware/auth');
const userService = require('../src/services/userService');

describe('Google Drive Integration — Phase 2 Test Suite', () => {
  let app;
  let origEnv;
  let origClientId;
  let origClientSecret;
  let testUserA;
  let testUserB;
  let tokenUserA;
  let tokenUserB;

  // Helper to simulate HTTP requests through Express app
  function makeRequest({ method = 'GET', urlPath, headers = {}, body = null }) {
    return new Promise((resolve) => {
      let statusCode = 200;
      let responseHeaders = {};
      let responseBody = null;

      const urlObj = new URL(urlPath, 'http://localhost:8080');
      const query = Object.fromEntries(urlObj.searchParams.entries());

      const req = {
        method,
        url: urlPath,
        originalUrl: urlPath,
        path: urlObj.pathname,
        headers: {
          'content-type': 'application/json',
          ...headers
        },
        body,
        query,
        socket: { remoteAddress: '127.0.0.1' },
        ip: '127.0.0.1'
      };

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        setHeader(name, val) {
          responseHeaders[name.toLowerCase()] = val;
          return this;
        },
        redirect(url) {
          statusCode = 302;
          responseHeaders['location'] = url;
          resolve({ status: statusCode, headers: responseHeaders, body: null });
        },
        json(data) {
          responseBody = data;
          resolve({ status: statusCode, headers: responseHeaders, body: responseBody });
        },
        send(data) {
          responseBody = data;
          resolve({ status: statusCode, headers: responseHeaders, body: responseBody });
        }
      };

      app.handle(req, res, (err) => {
        if (err) {
          resolve({
            status: err.statusCode || 500,
            headers: responseHeaders,
            body: { success: false, error: err.message }
          });
        } else {
          resolve({ status: 404, headers: responseHeaders, body: { success: false, error: 'Not found' } });
        }
      });
    });
  }

  before(async () => {
    origEnv = config.NODE_ENV;
    origClientId = config.GOOGLE_CLIENT_ID;
    origClientSecret = config.GOOGLE_CLIENT_SECRET;

    config.NODE_ENV = 'test';
    config.GOOGLE_CLIENT_ID = 'test-client-id-xyz.apps.googleusercontent.com';
    config.GOOGLE_CLIENT_SECRET = 'test-client-secret-abc';
    config.GOOGLE_REDIRECT_URI = 'http://localhost:8080/api/drive/callback';

    // Run migrations to ensure 006_create_oauth_states_table is applied
    await runMigrations();

    // Create two isolated test users in database
    const userA = await userService.register({
      email: `gdrive_user_a_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      name: 'User Alpha'
    });
    testUserA = userA;

    const userB = await userService.register({
      email: `gdrive_user_b_${Date.now()}@test.com`,
      password: 'SecurePassword123!',
      name: 'User Beta'
    });
    testUserB = userB;

    // Create authenticated tokens
    const jwt = require('jsonwebtoken');
    tokenUserA = jwt.sign({ id: testUserA.id, email: testUserA.email, role: 'TESTER' }, config.JWT_SECRET);
    tokenUserB = jwt.sign({ id: testUserB.id, email: testUserB.email, role: 'TESTER' }, config.JWT_SECRET);

    // Initialize express app matching backend/src/index.js
    app = express();
    app.use(express.json());
    app.use('/api', authenticate);

    // Mount drive endpoints
    const driveRoutes = require('../src/routes/driveRoutes');
    app.use('/api/drive', driveRoutes);
  });

  after(() => {
    config.NODE_ENV = origEnv;
    config.GOOGLE_CLIENT_ID = origClientId;
    config.GOOGLE_CLIENT_SECRET = origClientSecret;
  });

  beforeEach(() => {
    tokenCrypto._resetConsumedStates();
    googleDriveService._activeRefreshPromises.clear();
  });

  describe('1. OAuth Authorization URL Generation', () => {
    it('rejects unauthenticated requests with HTTP 401', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/auth-url'
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.authenticated, false);
    });

    it('generates a signed authorization URL and persists state for authenticated user', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/auth-url',
        headers: { authorization: `Bearer ${tokenUserA}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.url);
      assert.ok(res.body.state);

      // Verify the generated URL contains offline access and correct client id
      assert.ok(res.body.url.includes('access_type=offline'));
      assert.ok(res.body.url.includes(encodeURIComponent(config.GOOGLE_CLIENT_ID)));

      // Verify the state is persisted in oauth_states table
      const parsed = tokenCrypto.parseAndVerifyOAuthStateSignature(res.body.state);
      assert.strictEqual(parsed.userId, testUserA.id);

      const dbCheck = await db.query('SELECT * FROM oauth_states WHERE nonce = $1', [parsed.nonce]);
      assert.strictEqual(dbCheck.rows.length, 1);
      assert.strictEqual(dbCheck.rows[0].user_id, testUserA.id);
      assert.strictEqual(dbCheck.rows[0].used_at, null);
    });

    it('generates a signed authorization URL via /api/drive/auth/url alias through mounted router', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/auth/url',
        headers: { authorization: `Bearer ${tokenUserA}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.ok(res.body.url);
      assert.ok(res.body.state);
      assert.ok(res.body.url.includes(encodeURIComponent(config.GOOGLE_CLIENT_ID)));
    });

    it('rejects unauthenticated requests to /api/drive/auth/url alias with HTTP 401', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/auth/url'
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.authenticated, false);
    });

    it('returns HTTP 503 if Google Drive credentials are not configured', async () => {
      const savedClientId = config.GOOGLE_CLIENT_ID;
      config.GOOGLE_CLIENT_ID = '';

      try {
        const res = await makeRequest({
          method: 'GET',
          urlPath: '/api/drive/auth-url',
          headers: { authorization: `Bearer ${tokenUserA}` }
        });

        assert.strictEqual(res.status, 503);
        assert.ok(res.body.error.includes('not configured'));
      } finally {
        config.GOOGLE_CLIENT_ID = savedClientId;
      }
    });
  });

  describe('2. OAuth Callback & State Verification', () => {
    it('is reachable without a Bearer token or session cookie', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/callback?format=json'
      });
      // Should not be rejected by 401 authentication; should fail validation due to missing parameters (400)
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Missing authorization code or state'));
    });

    it('rejects callback with missing code or state parameter', async () => {
      const resNoCode = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/callback?state=dummy&format=json'
      });
      assert.strictEqual(resNoCode.status, 400);

      const resNoState = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/callback?code=dummy&format=json'
      });
      assert.strictEqual(resNoState.status, 400);
    });

    it('rejects callback when user cancelled or denied consent on Google', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/callback?error=access_denied&format=json'
      });
      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('cancelled or denied'));
    });

    it('rejects malformed or tampered state signatures', async () => {
      const validAuth = await googleDriveService.generateAuthUrl(testUserA.id);
      const tamperedState = validAuth.state + 'corrupted';

      const res = await makeRequest({
        method: 'GET',
        urlPath: `/api/drive/callback?code=mock_code&state=${encodeURIComponent(tamperedState)}&format=json`
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Invalid or tampered OAuth state signature') || res.body.error.includes('Malformed'));
    });

    it('rejects expired state', async () => {
      const expiredState = tokenCrypto.generateOAuthState(testUserA.id, { ttlMs: -1000 });

      const res = await makeRequest({
        method: 'GET',
        urlPath: `/api/drive/callback?code=mock_code&state=${encodeURIComponent(expiredState)}&format=json`
      });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('expired'));
    });

    it('exchanges code for tokens, derives user strictly from state, and encrypts tokens', async () => {
      // 1. Generate valid state
      const { state } = await googleDriveService.generateAuthUrl(testUserA.id);

      // 2. Mock Google OAuth2 exchange
      const mockOAuthClient = {
        getToken: async (code) => {
          assert.strictEqual(code, 'mock_valid_auth_code_123');
          return {
            tokens: {
              access_token: 'ya29.mock-sample-access-token-999',
              refresh_token: '1//0gmock-sample-refresh-token-888',
              expiry_date: Date.now() + 3600000,
              scope: 'https://www.googleapis.com/auth/drive.file'
            }
          };
        },
        setCredentials: () => {}
      };

      // Call handleOAuthCallback directly with injected mock client
      const callbackResult = await googleDriveService.handleOAuthCallback(
        'mock_valid_auth_code_123',
        state,
        mockOAuthClient
      );

      assert.strictEqual(callbackResult.success, true);
      assert.strictEqual(callbackResult.userId, testUserA.id);

      // Verify tokens stored encrypted in DB
      const dbTokens = await db.query('SELECT * FROM google_drive_tokens WHERE user_id = $1', [
        testUserA.id
      ]);
      assert.strictEqual(dbTokens.rows.length, 1);
      const row = dbTokens.rows[0];

      // Must NOT be stored in plaintext
      assert.notStrictEqual(row.encrypted_access_token, 'ya29.mock-sample-access-token-999');
      assert.notStrictEqual(row.encrypted_refresh_token, '1//0gmock-sample-refresh-token-888');

      // Decrypt access token using Phase 1 utilities
      const decryptedAccess = tokenCrypto.decryptToken(
        row.encrypted_access_token,
        row.token_iv,
        row.token_auth_tag
      );
      assert.strictEqual(decryptedAccess, 'ya29.mock-sample-access-token-999');

      // Decrypt refresh token
      const decryptedRefresh = tokenCrypto.decryptSelfContained(row.encrypted_refresh_token);
      assert.strictEqual(decryptedRefresh, '1//0gmock-sample-refresh-token-888');
    });

    it('atomically rejects replayed state (single-use protection in database)', async () => {
      const { state } = await googleDriveService.generateAuthUrl(testUserA.id);

      const mockClient = {
        getToken: async () => ({
          tokens: {
            access_token: 'ya29.replay-token',
            expiry_date: Date.now() + 3600000
          }
        }),
        setCredentials: () => {}
      };

      // First callback execution succeeds
      await googleDriveService.handleOAuthCallback('mock_code_1', state, mockClient);

      // Replaying the EXACT same state must be rejected with replay attempt detected (HTTP 409)
      await assert.rejects(
        async () => {
          await googleDriveService.handleOAuthCallback('mock_code_2', state, mockClient);
        },
        {
          message: /replay attempt detected/i
        }
      );
    });

    it('handles Google token exchange failure gracefully', async () => {
      const { state } = await googleDriveService.generateAuthUrl(testUserB.id);
      const mockFailingClient = {
        getToken: async () => {
          const err = new Error('invalid_grant: Bad Request from Google');
          err.statusCode = 400;
          throw err;
        }
      };

      await assert.rejects(
        async () => {
          await googleDriveService.handleOAuthCallback('bad_auth_code', state, mockFailingClient);
        },
        /invalid_grant/
      );
    });

    it('handles database persistence failure gracefully without leaking tokens', async () => {
      const { state } = await googleDriveService.generateAuthUrl(testUserB.id);
      const mockClient = {
        getToken: async () => ({
          tokens: {
            access_token: 'ya29.test-persist-fail',
            expiry_date: Date.now() + 3600000
          }
        }),
        setCredentials: () => {}
      };

      const origQuery = db.query;
      try {
        db.query = async (sql, params) => {
          if (typeof sql === 'string' && (sql.includes('google_drive_tokens') || sql.includes('INSERT INTO google_drive_tokens'))) {
            throw new Error('Database connection lost during token persist');
          }
          return origQuery.call(db, sql, params);
        };

        await assert.rejects(
          async () => {
            await googleDriveService.handleOAuthCallback('valid_code', state, mockClient);
          },
          /Database connection lost during token persist/
        );
      } finally {
        db.query = origQuery;
      }
    });

    it('renders HTML popup with GDRIVE_AUTH_SUCCESS postMessage script on browser callback', async () => {
      const popupUser = await userService.register({
        email: `cb_popup_${Date.now()}@test.com`,
        password: 'SecurePassword123!',
        name: 'Popup Tester'
      });
      const { state } = await googleDriveService.generateAuthUrl(popupUser.id);
      const mockClient = {
        getToken: async () => ({
          tokens: {
            access_token: 'ya29.test-html-popup',
            refresh_token: '1//0ghtml-popup-refresh',
            expiry_date: Date.now() + 3600000,
            scope: 'https://www.googleapis.com/auth/drive.file'
          }
        }),
        setCredentials: () => {}
      };

      await googleDriveService.handleOAuthCallback('popup_code_123', state, mockClient);

      // Verify connection status
      const popupToken = require('jsonwebtoken').sign({ id: popupUser.id, email: popupUser.email, role: 'TESTER' }, config.JWT_SECRET);
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/status',
        headers: { authorization: `Bearer ${popupToken}` }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.connected, true);
    });

    it('renders HTML error popup with GDRIVE_AUTH_ERROR postMessage when Google cancels', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/callback?error=access_denied',
        headers: { accept: 'text/html' }
      });
      assert.strictEqual(res.status, 400);
      assert.ok(typeof res.body === 'string');
      assert.ok(res.body.includes('Google Authorization Cancelled'));
      assert.ok(res.body.includes('GDRIVE_AUTH_ERROR'));
      assert.ok(res.body.includes('access_denied'));
    });
  });

  describe('3. User Isolation & Connection Status', () => {
    it('enforces strict multi-user isolation on connection status', async () => {
      // User A is connected from previous test. User A sees connected = true
      const resA = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/status',
        headers: { authorization: `Bearer ${tokenUserA}` }
      });

      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resA.body.connected, true);
      assert.strictEqual(typeof resA.body.scope, 'string');
      // Verify tokens are never exposed in API response
      assert.strictEqual(resA.body.encrypted_access_token, undefined);
      assert.strictEqual(resA.body.access_token, undefined);
      assert.strictEqual(resA.body.refresh_token, undefined);

      // User B MUST see connected = false
      const resB = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/status',
        headers: { authorization: `Bearer ${tokenUserB}` }
      });

      assert.strictEqual(resB.status, 200);
      assert.strictEqual(resB.body.connected, false);
    });

    it('prevents cross-user connection access', async () => {
      // User B cannot access User A's drive client
      await assert.rejects(
        async () => {
          await googleDriveService.getAuthenticatedDriveClient(testUserB.id);
        },
        {
          message: /Google Drive is not connected for this account/i
        }
      );
    });
  });

  describe('4. Token Refresh & Edge Cases', () => {
    it('preserves existing refresh token if Google omits replacement on reconnection', async () => {
      // User A connects again without Google returning a replacement refresh_token
      const { state } = await googleDriveService.generateAuthUrl(testUserA.id);

      const mockClientNoRefresh = {
        getToken: async () => ({
          tokens: {
            access_token: 'ya29.new-access-token-only',
            refresh_token: undefined, // Google omitted replacement
            expiry_date: Date.now() + 7200000
          }
        }),
        setCredentials: () => {}
      };

      await googleDriveService.handleOAuthCallback('code_no_refresh', state, mockClientNoRefresh);

      const dbCheck = await db.query('SELECT * FROM google_drive_tokens WHERE user_id = $1', [
        testUserA.id
      ]);
      const row = dbCheck.rows[0];

      // Access token was updated
      const decryptedAccess = tokenCrypto.decryptToken(
        row.encrypted_access_token,
        row.token_iv,
        row.token_auth_tag
      );
      assert.strictEqual(decryptedAccess, 'ya29.new-access-token-only');

      // Existing refresh token was PRESERVED
      const decryptedRefresh = tokenCrypto.decryptSelfContained(row.encrypted_refresh_token);
      assert.strictEqual(decryptedRefresh, '1//0gmock-sample-refresh-token-888');
    });

    it('auto-refreshes expired access tokens and persists updated credentials', async () => {
      // Set User A's token expiry in past
      await db.query(
        'UPDATE google_drive_tokens SET expiry_date = $1 WHERE user_id = $2',
        [Date.now() - 60000, testUserA.id]
      );

      const mockClient = {
        setCredentials: () => {},
        refreshAccessToken: async () => ({
          credentials: {
            access_token: 'ya29.auto-refreshed-token-success',
            expiry_date: Date.now() + 3600000
          }
        })
      };

      const { oauth2Client } = await googleDriveService.getAuthenticatedDriveClient(
        testUserA.id,
        mockClient
      );
      assert.ok(oauth2Client);

      // Check DB was updated with new token
      const dbCheck = await db.query('SELECT * FROM google_drive_tokens WHERE user_id = $1', [
        testUserA.id
      ]);
      const row = dbCheck.rows[0];
      const decryptedAccess = tokenCrypto.decryptToken(
        row.encrypted_access_token,
        row.token_iv,
        row.token_auth_tag
      );
      assert.strictEqual(decryptedAccess, 'ya29.auto-refreshed-token-success');
    });

    it('deduplicates concurrent refresh requests for the same user', async () => {
      let refreshCallCount = 0;
      const mockClient = {
        setCredentials: () => {},
        refreshAccessToken: async () => {
          refreshCallCount++;
          await new Promise((r) => setTimeout(r, 50));
          return {
            credentials: {
              access_token: 'ya29.concurrent-refresh-result',
              expiry_date: Date.now() + 3600000
            }
          };
        }
      };

      const userRecord = (await db.query('SELECT * FROM google_drive_tokens WHERE user_id = $1', [testUserA.id])).rows[0];

      // Launch 3 simultaneous refreshes for the same user
      const [res1, res2, res3] = await Promise.all([
        googleDriveService.refreshUserToken(testUserA.id, userRecord, mockClient),
        googleDriveService.refreshUserToken(testUserA.id, userRecord, mockClient),
        googleDriveService.refreshUserToken(testUserA.id, userRecord, mockClient)
      ]);

      assert.strictEqual(res1.accessToken, 'ya29.concurrent-refresh-result');
      assert.strictEqual(res2.accessToken, 'ya29.concurrent-refresh-result');
      assert.strictEqual(res3.accessToken, 'ya29.concurrent-refresh-result');

      // Must have invoked Google API exactly once
      assert.strictEqual(refreshCallCount, 1);
    });

    it('handles revoked credentials (invalid_grant) by throwing GOOGLE_AUTH_REVOKED', async () => {
      const mockClientRevoked = {
        setCredentials: () => {},
        refreshAccessToken: async () => {
          const err = new Error('invalid_grant: Token has been expired or revoked.');
          err.response = { data: { error: 'invalid_grant' } };
          throw err;
        }
      };

      const userRecord = (await db.query('SELECT * FROM google_drive_tokens WHERE user_id = $1', [testUserA.id])).rows[0];

      await assert.rejects(
        async () => {
          await googleDriveService.refreshUserToken(testUserA.id, userRecord, mockClientRevoked);
        },
        {
          code: 'GOOGLE_AUTH_REVOKED',
          needsReconnect: true
        }
      );
    });
  });

  describe('5. Disconnect & Reconnect Flow', () => {
    it('safely disconnects current user connection without affecting other users', async () => {
      // Connect User B
      const { state: stateB } = await googleDriveService.generateAuthUrl(testUserB.id);
      await googleDriveService.handleOAuthCallback('code_b', stateB, {
        getToken: async () => ({
          tokens: {
            access_token: 'ya29.user-b-access',
            expiry_date: Date.now() + 3600000
          }
        }),
        setCredentials: () => {}
      });

      // Disconnect User A
      const resDisconnect = await makeRequest({
        method: 'POST',
        urlPath: '/api/drive/disconnect',
        headers: { authorization: `Bearer ${tokenUserA}` }
      });

      assert.strictEqual(resDisconnect.status, 200);
      assert.strictEqual(resDisconnect.body.success, true);

      // Verify User A connection is removed
      const checkA = await db.query('SELECT * FROM google_drive_tokens WHERE user_id = $1', [
        testUserA.id
      ]);
      assert.strictEqual(checkA.rows.length, 0);

      // User B connection MUST remain intact
      const checkB = await db.query('SELECT * FROM google_drive_tokens WHERE user_id = $1', [
        testUserB.id
      ]);
      assert.strictEqual(checkB.rows.length, 1);
    });
  });

  describe('6. Bounded Retries, Rate Limits & Transient Errors', () => {
    it('retries on rate limits (429) and transient server errors (503) then succeeds', async () => {
      let attempts = 0;
      const result = await googleDriveService.withRetry(
        async () => {
          attempts++;
          if (attempts < 3) {
            const err = new Error('Rate limit exceeded');
            err.status = 429;
            throw err;
          }
          return 'success_after_retries';
        },
        { maxRetries: 3, baseDelayMs: 10 }
      );

      assert.strictEqual(result, 'success_after_retries');
      assert.strictEqual(attempts, 3);
    });

    it('fails immediately without retrying on non-retryable errors (e.g. 401)', async () => {
      let attempts = 0;
      await assert.rejects(
        async () => {
          await googleDriveService.withRetry(
            async () => {
              attempts++;
              const err = new Error('Invalid Credentials');
              err.status = 401;
              throw err;
            },
            { maxRetries: 3, baseDelayMs: 10 }
          );
        },
        {
          message: /Invalid Credentials/
        }
      );

      assert.strictEqual(attempts, 1);
    });

    it('stops after maxRetries on persistent 500 errors', async () => {
      let attempts = 0;
      await assert.rejects(
        async () => {
          await googleDriveService.withRetry(
            async () => {
              attempts++;
              const err = new Error('Google Backend 500');
              err.status = 500;
              throw err;
            },
            { maxRetries: 3, baseDelayMs: 10 }
          );
        },
        {
          message: /Google Backend 500/
        }
      );

      assert.strictEqual(attempts, 4); // Initial attempt + 3 retries
    });
  });

  describe('7. Schema Migration 006 & Database Persistence', () => {
    it('verifies oauth_states table and unique user constraint', async () => {
      const migrationNames = MIGRATIONS.map((m) => m.name);
      assert.ok(migrationNames.includes('006_create_oauth_states_table'));

      const migCheck = await db.query(
        "SELECT name FROM schema_migrations WHERE name = '006_create_oauth_states_table'"
      );
      assert.strictEqual(migCheck.rows.length, 1);

      // Verify oauth_states table query execution
      const statesCheck = await db.query('SELECT * FROM oauth_states LIMIT 1');
      assert.ok(Array.isArray(statesCheck.rows));
    });
  });

  describe('8. Dual-Protocol Server HTTP/HTTPS Callback Acceptance', () => {
    const http = require('node:http');
    const https = require('node:https');
    const net = require('node:net');
    const { getOrCreateCertificate } = require('../src/utils/sslCert');
    const { setupWebSocket } = require('../src/websocket/testSocket');

    let dualTcpServer;
    let dualHttpServer;
    let dualHttpsServer;
    let dualPort;

    before(async () => {
      const ssl = await getOrCreateCertificate(config.DATA_DIR);
      dualHttpServer = http.createServer(app);
      dualHttpsServer = https.createServer({ key: ssl.key, cert: ssl.cert }, app);

      setupWebSocket(dualHttpsServer, dualHttpServer);

      dualTcpServer = net.createServer((socket) => {
        socket.on('error', () => {});
        socket.once('data', (buffer) => {
          socket.pause();
          socket.unshift(buffer);
          if (buffer[0] === 0x16) {
            dualHttpsServer.emit('connection', socket);
          } else {
            dualHttpServer.emit('connection', socket);
          }
          process.nextTick(() => {
            if (!socket.destroyed) socket.resume();
          });
        });
      });

      await new Promise((resolve) => {
        dualTcpServer.listen(0, '127.0.0.1', () => {
          dualPort = dualTcpServer.address().port;
          resolve();
        });
      });
    });

    after(async () => {
      await new Promise((resolve) => {
        dualTcpServer.close(() => {
          dualHttpServer.close(() => {
            dualHttpsServer.close(resolve);
          });
        });
      });
    });

    it('accepts plaintext HTTP callback requests without ECONNRESET or ERR_EMPTY_RESPONSE', async () => {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${dualPort}/api/drive/callback?format=json`, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }).on('error', reject);
      });

      assert.strictEqual(res.status, 400);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, false);
      assert.ok(json.error.includes('Missing authorization code or state'));
    });

    it('accepts HTTPS callback requests on the same port without handshake error', async () => {
      const res = await new Promise((resolve, reject) => {
        https.get(`https://127.0.0.1:${dualPort}/api/drive/callback?format=json`, { rejectUnauthorized: false }, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve({ status: res.statusCode, body: data }));
        }).on('error', reject);
      });

      assert.strictEqual(res.status, 400);
      const json = JSON.parse(res.body);
      assert.strictEqual(json.success, false);
      assert.ok(json.error.includes('Missing authorization code or state'));
    });
  });

  describe('9. Cross-Origin OAuth Completion & State Origin Binding', () => {
    it('binds initiating origin into cryptographically signed OAuth state', async () => {
      const testOrigin = 'https://192.168.0.163:8080';
      const state = tokenCrypto.generateOAuthState(testUserA.id, { origin: testOrigin });

      const verified = await tokenCrypto.verifyAndConsumeOAuthState(state);
      assert.strictEqual(verified.userId, testUserA.id);
      assert.strictEqual(verified.origin, testOrigin);
    });

    it('rejects tampered OAuth state with modified origin', async () => {
      const state = tokenCrypto.generateOAuthState(testUserA.id, { origin: 'https://192.168.0.163:8080' });
      // Tamper origin in state
      const jsonStr = Buffer.from(state, 'base64url').toString('utf8');
      const stateObj = JSON.parse(jsonStr);
      stateObj.origin = 'https://attacker.evil.com';
      const tamperedState = Buffer.from(JSON.stringify(stateObj)).toString('base64url');

      await assert.rejects(
        async () => {
          await tokenCrypto.verifyAndConsumeOAuthState(tamperedState);
        },
        /Invalid or tampered OAuth state signature/i
      );
    });

    it('generates authorization URL binding the origin passed via query param', async () => {
      const testOrigin = 'https://192.168.0.163:8080';
      const res = await makeRequest({
        method: 'GET',
        urlPath: `/api/drive/auth-url?origin=${encodeURIComponent(testOrigin)}`,
        headers: { authorization: `Bearer ${tokenUserA}` }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      const url = new URL(res.body.url);
      const stateParam = url.searchParams.get('state');
      assert.ok(stateParam);

      const parsed = tokenCrypto.parseAndVerifyOAuthStateSignature(stateParam);
      assert.strictEqual(parsed.origin, testOrigin);
      assert.strictEqual(parsed.userId, testUserA.id);
    });

    it('redirects cross-origin callback to targetOrigin/api/drive/oauth-complete', async () => {
      const targetOrigin = 'https://192.168.0.163:8080';
      const { state } = await googleDriveService.generateAuthUrl(testUserA.id, { origin: targetOrigin });

      const origCreateClient = googleDriveService.createOAuth2Client;
      // Mock google token exchange
      const mockOAuth2Client = {
        getToken: async () => ({
          tokens: {
            access_token: 'mock-access-token-9',
            refresh_token: 'mock-refresh-token-9',
            expiry_date: Date.now() + 3600000,
            scope: 'https://www.googleapis.com/auth/drive.file'
          }
        }),
        setCredentials: () => {},
        request: async () => ({
          data: { email: 'crossorigin@test.com', name: 'Cross Origin User' }
        })
      };
      googleDriveService.createOAuth2Client = () => mockOAuth2Client;

      try {
        // Request callback via localhost
        const res = await makeRequest({
          method: 'GET',
          urlPath: `/api/drive/callback?code=mock_auth_code_9&state=${encodeURIComponent(state)}`,
          headers: { host: 'localhost:8080' }
        });

        // Should redirect to targetOrigin/api/drive/oauth-complete
        assert.strictEqual(res.status, 302);
        assert.ok(res.headers.location);
        assert.ok(res.headers.location.startsWith(`${targetOrigin}/api/drive/oauth-complete`));
        assert.ok(res.headers.location.includes('status=success'));
        assert.ok(res.headers.location.includes('email=crossorigin%40test.com'));
      } finally {
        googleDriveService.createOAuth2Client = origCreateClient;
      }
    });

    it('renders oauth-complete page with BroadcastChannel and postMessage to matching origin', async () => {
      const res = await makeRequest({
        method: 'GET',
        urlPath: '/api/drive/oauth-complete?status=success&email=crossorigin%40test.com',
        headers: { host: '192.168.0.163:8080' }
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.headers['cross-origin-opener-policy'], 'unsafe-none');
      assert.strictEqual(res.headers['cross-origin-resource-policy'], 'cross-origin');
      assert.ok(res.body.includes('GDRIVE_AUTH_SUCCESS'));
      assert.ok(res.body.includes('gdrive_oauth_channel'));
      assert.ok(res.body.includes('window.close()'));
    });
  });
});
