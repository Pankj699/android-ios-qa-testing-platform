const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');

const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const userService = require('../src/services/userService');
const authController = require('../src/controllers/authController');
const { authenticate } = require('../src/middleware/auth');
const deviceLockService = require('../src/services/deviceLockService');
const config = require('../src/config');

describe('Native Standalone Authentication Foundation Suite (Phase 1)', () => {
  let app;
  let origEnv;

  before(async () => {
    origEnv = config.NODE_ENV;
    config.NODE_ENV = 'test';

    // Run migrations on the active pool (in-memory pg-mem for unit tests)
    await runMigrations();

    // Setup an isolated Express app for testing native auth routes
    app = express();
    app.use(express.json());
    app.use('/api', authenticate);

    // Routes
    app.post('/api/auth/register', (req, res, next) => authController.register(req, res, next));
    app.post('/api/auth/login', (req, res, next) => authController.login(req, res, next));
    app.get('/api/auth/me', (req, res, next) => authController.me(req, res, next));
    app.post('/api/auth/logout', (req, res, next) => authController.logout(req, res, next));
    app.post('/api/auth/forgot-password', (req, res, next) => authController.forgotPassword(req, res, next));
    app.post('/api/auth/reset-password', (req, res, next) => authController.resetPassword(req, res, next));
  });

  after(() => {
    if (origEnv !== undefined) {
      config.NODE_ENV = origEnv;
    }
  });

  // Helper to simulate HTTP requests without opening a network port
  function makeRequest({ method = 'GET', path, headers = {}, body = null }) {
    return new Promise((resolve) => {
      let statusCode = 200;
      let responseHeaders = {};
      let responseBody = null;

      const req = {
        method,
        url: path,
        originalUrl: path,
        path,
        headers: {
          'content-type': 'application/json',
          ...headers
        },
        body,
        query: {},
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
          resolve({ status: err.statusCode || 500, headers: responseHeaders, body: { error: err.message } });
        } else {
          resolve({ status: 404, headers: responseHeaders, body: { error: 'Not found' } });
        }
      });
    });
  }

  function extractCookie(headers, cookieName) {
    const raw = headers['set-cookie'];
    if (!raw) return null;
    const cookieList = Array.isArray(raw) ? raw : [raw];
    for (const c of cookieList) {
      if (c.startsWith(`${cookieName}=`)) {
        const parts = c.split(';')[0].split('=');
        return decodeURIComponent(parts[1]);
      }
    }
    return null;
  }

  test('1. User Registration: normal registration assigns role = TESTER', async () => {
    const regRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: {
        email: 'alice.tester@qatools.internal',
        password: 'Password123!',
        name: 'Alice Tester'
      }
    });

    assert.strictEqual(regRes.status, 201);
    assert.strictEqual(regRes.body.success, true);
    assert.strictEqual(regRes.body.user.email, 'alice.tester@qatools.internal');
    assert.strictEqual(regRes.body.user.role, 'TESTER', 'Registration must default to role = TESTER');
    assert.strictEqual(regRes.body.user.password_hash, undefined, 'Password hash must never be returned');

    // Verify session cookie was issued automatically upon registration
    const sessionCookie = extractCookie(regRes.headers, 'qa_session');
    assert.ok(sessionCookie, 'HttpOnly session cookie must be set upon registration');

    // Verify raw password is not stored plaintext in database
    const dbUser = await db.query('SELECT password_hash FROM users WHERE email = $1', ['alice.tester@qatools.internal']);
    assert.ok(dbUser.rows[0].password_hash.startsWith('$2'), 'Password must be hashed with bcrypt');
  });

  test('2. User Registration: rejects duplicate email and weak passwords', async () => {
    // Duplicate email check
    const dupRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: {
        email: 'alice.tester@qatools.internal',
        password: 'Password123!',
        name: 'Alice Clone'
      }
    });
    assert.strictEqual(dupRes.status, 409);
    assert.strictEqual(dupRes.body.success, false);
    assert.match(dupRes.body.error, /already exists/i);

    // Weak password check (< 8 chars)
    const weakRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: {
        email: 'bob.short@qatools.internal',
        password: '123',
        name: 'Bob Short'
      }
    });
    assert.strictEqual(weakRes.status, 400);
    assert.match(weakRes.body.error, /at least 8 characters/i);
  });

  test('3. Login: authenticates with valid credentials, sets HttpOnly cookie, and rejects invalid credentials', async () => {
    // Successful login
    const loginRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'alice.tester@qatools.internal',
        password: 'Password123!'
      }
    });

    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.body.success, true);
    assert.strictEqual(loginRes.body.user.name, 'Alice Tester');
    assert.strictEqual(loginRes.body.token, undefined, 'No browser JWT should be returned in response body');

    const sessionCookie = extractCookie(loginRes.headers, 'qa_session');
    assert.ok(sessionCookie);

    // Invalid password
    const wrongPassRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'alice.tester@qatools.internal',
        password: 'WrongPassword999'
      }
    });
    assert.strictEqual(wrongPassRes.status, 401);
    assert.strictEqual(wrongPassRes.body.success, false);

    // Non-existent user
    const nonExistentRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'ghost@qatools.internal',
        password: 'Password123!'
      }
    });
    assert.strictEqual(nonExistentRes.status, 401);
    assert.match(nonExistentRes.body.error, /invalid email or password/i);
  });

  test('4. Session & /me endpoint: verifies active session and returns user profile', async () => {
    // 1. Login to obtain session cookie
    const loginRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'alice.tester@qatools.internal',
        password: 'Password123!'
      }
    });
    const sessionCookie = extractCookie(loginRes.headers, 'qa_session');

    // 2. Query /api/auth/me with session cookie
    const meRes = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: {
        cookie: `qa_session=${sessionCookie}`
      }
    });

    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.body.success, true);
    assert.strictEqual(meRes.body.authenticated, true);
    assert.strictEqual(meRes.body.user.email, 'alice.tester@qatools.internal');
    assert.strictEqual(meRes.body.user.role, 'TESTER');

    // 3. Query /api/auth/me without cookie -> 401
    const noCookieRes = await makeRequest({
      method: 'GET',
      path: '/api/auth/me'
    });
    assert.strictEqual(noCookieRes.status, 401);
  });

  test('5. Logout: revokes session in DB, clears cookie, and MUST NOT release device claims', async () => {
    // 1. Login
    const loginRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'alice.tester@qatools.internal',
        password: 'Password123!'
      }
    });
    const sessionCookie = extractCookie(loginRes.headers, 'qa_session');
    const aliceUser = loginRes.body.user;

    // 2. Establish a persistent device claim for Alice in DeviceLockService
    const testSerial = 'TEST_DEVICE_SERIAL_PHASE1';
    deviceLockService.claims.set(testSerial, {
      userId: aliceUser.id,
      userName: aliceUser.name,
      userEmail: aliceUser.email,
      claimedAt: new Date().toISOString()
    });

    assert.ok(deviceLockService.getClaim(testSerial), 'Device must be claimed before logout');
    assert.strictEqual(deviceLockService.getClaim(testSerial).userId, aliceUser.id);

    // 3. Perform Logout
    const logoutRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/logout',
      headers: {
        cookie: `qa_session=${sessionCookie}`
      }
    });

    assert.strictEqual(logoutRes.status, 200);
    assert.strictEqual(logoutRes.body.success, true);

    // Verify session cookie was cleared (Max-Age=0)
    const setCookieHeader = logoutRes.headers['set-cookie'];
    assert.ok(setCookieHeader);

    // 4. CRITICAL CHECK: Verify Alice's device claim STILL EXISTS after logout!
    const claimAfterLogout = deviceLockService.getClaim(testSerial);
    assert.ok(claimAfterLogout, 'CRITICAL: Persistent device claim must NOT be released on user logout');
    assert.strictEqual(claimAfterLogout.userId, aliceUser.id);

    // 5. Verify old session token is completely revoked
    const meAfterLogout = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: {
        cookie: `qa_session=${sessionCookie}`
      }
    });
    assert.strictEqual(meAfterLogout.status, 401, 'Revoked session cannot access /me');
  });

  test('6. Password Reset: cryptographic single-use token, SHA-256 storage, and session invalidation', async () => {
    // 1. Register a test user
    const regRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: {
        email: 'charlie.reset@qatools.internal',
        password: 'OriginalPassword1!',
        name: 'Charlie Reset'
      }
    });
    const sessionTokenBeforeReset = extractCookie(regRes.headers, 'qa_session');

    // Verify Charlie can access /me with his current session
    const meBefore = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: { cookie: `qa_session=${sessionTokenBeforeReset}` }
    });
    assert.strictEqual(meBefore.status, 200);

    // 2. Request password reset (Forgot Password)
    const forgotRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/forgot-password',
      body: {
        email: 'charlie.reset@qatools.internal'
      }
    });

    assert.strictEqual(forgotRes.status, 200);
    assert.strictEqual(forgotRes.body.success, true);
    assert.match(forgotRes.body.message, /password reset instructions/i);

    // In dev/test mode, the controller provides devResetToken
    const resetToken = forgotRes.body.devResetToken;
    assert.ok(resetToken, 'Reset token must be generated');

    // Verify token is stored as SHA-256 hash in database, not raw token
    const tokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const resetRow = await db.query('SELECT * FROM password_resets WHERE token_hash = $1', [tokenHash]);
    assert.strictEqual(resetRow.rows.length, 1, 'Only token hash should be stored in database');
    assert.strictEqual(resetRow.rows[0].used_at, null);

    // 3. Reset password using valid token
    const resetRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/reset-password',
      body: {
        token: resetToken,
        newPassword: 'BrandNewSecurePassword2026!'
      }
    });

    assert.strictEqual(resetRes.status, 200);
    assert.strictEqual(resetRes.body.success, true);

    // 4. CRITICAL CHECK: Existing session must be invalidated upon password reset!
    const meAfterReset = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: { cookie: `qa_session=${sessionTokenBeforeReset}` }
    });
    assert.strictEqual(meAfterReset.status, 401, 'Prior sessions must be invalidated upon password reset');

    // 5. CRITICAL CHECK: Reset token cannot be reused (single-use enforcement)
    const reuseRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/reset-password',
      body: {
        token: resetToken,
        newPassword: 'AnotherPassword3!'
      }
    });
    assert.strictEqual(reuseRes.status, 400);
    assert.match(reuseRes.body.error, /already been used/i);

    // 6. Old password no longer works
    const oldLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'charlie.reset@qatools.internal',
        password: 'OriginalPassword1!'
      }
    });
    assert.strictEqual(oldLogin.status, 401);

    // 7. New password works
    const newLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'charlie.reset@qatools.internal',
        password: 'BrandNewSecurePassword2026!'
      }
    });
    assert.strictEqual(newLogin.status, 200);
    assert.strictEqual(newLogin.body.success, true);
  });

  test('7. Forgot password for non-existent email returns generic success (no user enumeration)', async () => {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/forgot-password',
      body: {
        email: 'nobody_exists_here_999@qatools.internal'
      }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.match(res.body.message, /if an account exists/i);
    assert.strictEqual(res.body.devResetToken, undefined, 'No token should be generated for non-existent user');
  });

  test('8. Controlled Admin Bootstrapping: seeds initial admin without letting normal users register as ADMIN', async () => {
    // 1. Normal registration cannot set role = 'ADMIN'
    const attemptRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: {
        email: 'fake.admin@qatools.internal',
        password: 'Password123!',
        name: 'Fake Admin',
        role: 'ADMIN' // Client attempts privilege escalation
      }
    });
    assert.strictEqual(attemptRes.status, 201);
    assert.strictEqual(attemptRes.body.user.role, 'TESTER', 'Registration must ignore client role and enforce TESTER');

    // 2. Controlled Admin Seed via config
    config.INITIAL_ADMIN_EMAIL = 'sysadmin@qatools.internal';
    config.INITIAL_ADMIN_PASSWORD = 'AdminSecureMasterPassword2026!';

    const seeded = await userService.seedInitialAdmin();
    assert.ok(seeded);
    assert.strictEqual(seeded.email, 'sysadmin@qatools.internal');
    assert.strictEqual(seeded.role, 'ADMIN');

    // 3. Admin can log in normally
    const adminLogin = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: {
        email: 'sysadmin@qatools.internal',
        password: 'AdminSecureMasterPassword2026!'
      }
    });
    assert.strictEqual(adminLogin.status, 200);
    assert.strictEqual(adminLogin.body.user.role, 'ADMIN');
  });
});
