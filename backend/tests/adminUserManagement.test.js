const { test, describe, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');

const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const userService = require('../src/services/userService');
const authController = require('../src/controllers/authController');
const adminController = require('../src/controllers/adminController');
const { authenticate, requireRole } = require('../src/middleware/auth');
const config = require('../src/config');
const auditLogger = require('../src/utils/auditLogger');

describe('Admin Authentication & User Management Suite (Phase 5B)', () => {
  let app;
  let adminUser;
  let adminSessionToken;
  let regularUser;
  let regularSessionToken;

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
        ip: '127.0.0.1'
      };

      if (path.includes('?')) {
        const [p, qs] = path.split('?');
        req.path = p;
        const params = new URLSearchParams(qs);
        for (const [k, v] of params.entries()) {
          req.query[k] = v;
        }
      }

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        setHeader(k, v) {
          responseHeaders[k.toLowerCase()] = v;
          return this;
        },
        cookie(name, val, opts) {
          responseHeaders['set-cookie'] = responseHeaders['set-cookie'] || [];
          responseHeaders['set-cookie'].push(`${name}=${encodeURIComponent(val)}`);
          return this;
        },
        json(data) {
          responseBody = data;
          resolve({ status: statusCode, headers: responseHeaders, body: responseBody });
        },
        send(data) {
          responseBody = data;
          resolve({ status: statusCode, headers: responseHeaders, body: responseBody });
        },
        end() {
          resolve({ status: statusCode, headers: responseHeaders, body: responseBody });
        }
      };

      app.handle(req, res, (err) => {
        if (err) {
          statusCode = err.statusCode || 500;
          responseBody = { error: err.message };
        }
        resolve({ status: statusCode, headers: responseHeaders, body: responseBody });
      });
    });
  }

  before(async () => {
    await runMigrations();

    app = express();
    app.use(express.json());
    app.use('/api', authenticate);

    // Auth endpoints
    app.post('/api/auth/register', (req, res, next) => authController.register(req, res, next));
    app.post('/api/auth/login', (req, res, next) => authController.login(req, res, next));
    app.get('/api/auth/me', (req, res, next) => authController.me(req, res, next));

    // Admin endpoints
    const adminRouter = express.Router();
    adminRouter.use(requireRole(['ADMIN']));
    adminRouter.get('/users', (req, res, next) => adminController.listUsers(req, res, next));
    adminRouter.get('/users/:id', (req, res, next) => adminController.getUser(req, res, next));
    adminRouter.patch('/users/:id', (req, res, next) => adminController.updateUser(req, res, next));
    adminRouter.post('/users/:id/reset-password', (req, res, next) => adminController.resetUserPassword(req, res, next));
    app.use('/api/admin', adminRouter);

    // Ensure bootstrap admin exists
    await userService.seedInitialAdmin('AdminPass123!');
    const findAdmin = await userService._query('SELECT id, email, role, status FROM users WHERE email = $1', ['admin.ob@gmail.com']);
    adminUser = findAdmin.rows[0];

    // Login admin and obtain session
    const adminAuth = await userService.authenticate('admin.ob@gmail.com', 'AdminPass123!');
    const adminSess = await userService.createSession(adminAuth.id);
    adminSessionToken = adminSess.sessionToken;

    // Create a regular user
    const regEmail = `test_user_${Date.now()}@qatools.test`;
    const regRes = await userService.register({
      email: regEmail,
      password: 'RegularPass123!',
      name: 'Regular Tester'
    });
    regularUser = regRes;
    const regAuth = await userService.authenticate(regEmail, 'RegularPass123!');
    const regSess = await userService.createSession(regAuth.id);
    regularSessionToken = regSess.sessionToken;
  });

  // 1. Non-admin cannot access GET /api/admin/users (403)
  test('1. Non-admin cannot access GET /api/admin/users (403)', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/admin/users',
      headers: { cookie: `qa_session=${regularSessionToken}` }
    });
    assert.equal(res.status, 403);
    assert.equal(res.body.success, false);
  });

  // 2. Unauthenticated user cannot access GET /api/admin/users (401)
  test('2. Unauthenticated user cannot access GET /api/admin/users (401)', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/admin/users'
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.authenticated, false);
  });

  // 3. Admin can list all users
  test('3. Admin can list all users', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/admin/users',
      headers: { cookie: `qa_session=${adminSessionToken}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.users));
    assert.ok(res.body.users.length >= 2);
  });

  // 4. User list contains correct summary counters
  test('4. User list contains correct summary counters', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/admin/users',
      headers: { cookie: `qa_session=${adminSessionToken}` }
    });
    const s = res.body.summary;
    assert.ok(s);
    assert.equal(typeof s.total, 'number');
    assert.equal(typeof s.active, 'number');
    assert.equal(typeof s.inactive, 'number');
    assert.equal(typeof s.administrators, 'number');
    assert.ok(s.total >= 2);
    assert.ok(s.administrators >= 1);
  });

  // 5. User list excludes password hashes
  test('5. User list excludes password hashes', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/admin/users',
      headers: { cookie: `qa_session=${adminSessionToken}` }
    });
    for (const u of res.body.users) {
      assert.equal(u.password_hash, undefined);
      assert.equal(u.passwordHash, undefined);
      assert.equal(u.token_hash, undefined);
    }
  });

  // 6. Admin can search users by email
  test('6. Admin can search users by email', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: `/api/admin/users?search=${encodeURIComponent(regularUser.email)}`,
      headers: { cookie: `qa_session=${adminSessionToken}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.users.length, 1);
    assert.equal(res.body.users[0].email, regularUser.email);
  });

  // 7. Admin can search users by name
  test('7. Admin can search users by name', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/admin/users?search=Regular',
      headers: { cookie: `qa_session=${adminSessionToken}` }
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.users.some(u => u.name.includes('Regular')));
  });

  // 8. Admin can filter users by role
  test('8. Admin can filter users by role', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/admin/users?role=ADMIN',
      headers: { cookie: `qa_session=${adminSessionToken}` }
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.users.length >= 1);
    for (const u of res.body.users) {
      assert.equal(u.role, 'ADMIN');
    }
  });

  // 9. Admin can filter users by status
  test('9. Admin can filter users by status', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/admin/users?status=ACTIVE',
      headers: { cookie: `qa_session=${adminSessionToken}` }
    });
    assert.equal(res.status, 200);
    for (const u of res.body.users) {
      assert.equal(u.status, 'ACTIVE');
    }
  });

  // 10. Admin can view a single user by ID
  test('10. Admin can view a single user by ID', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: `/api/admin/users/${regularUser.id}`,
      headers: { cookie: `qa_session=${adminSessionToken}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.id, regularUser.id);
    assert.equal(res.body.user.email, regularUser.email);
  });

  // 11. Admin can update a user's name
  test("11. Admin can update a user's name", async () => {
    const res = await makeRequest({
      method: 'PATCH',
      path: `/api/admin/users/${regularUser.id}`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: { name: 'Updated Regular Name' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.name, 'Updated Regular Name');
  });

  // 12. Admin can update a user's role
  test("12. Admin can update a user's role", async () => {
    const res = await makeRequest({
      method: 'PATCH',
      path: `/api/admin/users/${regularUser.id}`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: { role: 'DEVELOPER' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.role, 'DEVELOPER');
  });

  // 13. Admin can update a user's status to INACTIVE
  test("13. Admin can update a user's status to INACTIVE", async () => {
    const res = await makeRequest({
      method: 'PATCH',
      path: `/api/admin/users/${regularUser.id}`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: { status: 'INACTIVE' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.status, 'INACTIVE');
  });

  // 14. Admin cannot deactivate the only active admin (409 Conflict)
  test('14. Admin cannot deactivate the only active admin (409 Conflict)', async () => {
    const res = await makeRequest({
      method: 'PATCH',
      path: `/api/admin/users/${adminUser.id}`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: { status: 'INACTIVE' }
    });
    assert.equal(res.status, 409);
    assert.ok(res.body.error.includes('administrator'));
  });

  // 15. Admin cannot demote the only active admin (409 Conflict)
  test('15. Admin cannot demote the only active admin (409 Conflict)', async () => {
    const res = await makeRequest({
      method: 'PATCH',
      path: `/api/admin/users/${adminUser.id}`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: { role: 'TESTER' }
    });
    assert.equal(res.status, 409);
    assert.ok(res.body.error.includes('administrator'));
  });

  // 16. Inactive user cannot sign in
  test('16. Inactive user cannot sign in', async () => {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: regularUser.email, password: 'RegularPass123!' }
    });
    assert.equal(res.status, 403);
    assert.ok(res.body.error.includes('deactivated') || res.body.error.includes('inactive'));
  });

  // 17. Inactive user's existing sessions are invalidated immediately
  test("17. Inactive user's existing sessions are invalidated immediately", async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: { cookie: `qa_session=${regularSessionToken}` }
    });
    assert.equal(res.status, 401);
  });

  // Reactivate user for subsequent tests
  test('Reactivate regular user', async () => {
    const res = await makeRequest({
      method: 'PATCH',
      path: `/api/admin/users/${regularUser.id}`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: { status: 'ACTIVE', role: 'TESTER' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.status, 'ACTIVE');
  });

  // 18. Role change takes effect on subsequent authorized requests
  test('18. Role change takes effect on subsequent authorized requests', async () => {
    // Log in regular user to get a fresh session
    const loginRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: regularUser.email, password: 'RegularPass123!' }
    });
    assert.equal(loginRes.status, 200);
    const setCookie = loginRes.headers['set-cookie']?.find(c => c.startsWith('qa_session='));
    const token = decodeURIComponent(setCookie.split(';')[0].replace('qa_session=', ''));

    // Check /me shows TESTER
    const meRes1 = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: { cookie: `qa_session=${token}` }
    });
    assert.equal(meRes1.body.user.role, 'TESTER');

    // Admin promotes regular user to EDITOR
    await makeRequest({
      method: 'PATCH',
      path: `/api/admin/users/${regularUser.id}`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: { role: 'EDITOR' }
    });

    // Check /me shows EDITOR immediately with same session
    const meRes2 = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: { cookie: `qa_session=${token}` }
    });
    assert.equal(meRes2.body.user.role, 'EDITOR');
  });

  // 19. Admin can reset a user's password with a custom temporary password
  test("19. Admin can reset a user's password with a custom temporary password", async () => {
    const res = await makeRequest({
      method: 'POST',
      path: `/api/admin/users/${regularUser.id}/reset-password`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: { temporaryPassword: 'CustomTempPass999!' }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.temporaryPassword, 'CustomTempPass999!');
  });

  // 20. Admin can reset a user's password with an auto-generated temporary password
  test("20. Admin can reset a user's password with an auto-generated temporary password", async () => {
    const res = await makeRequest({
      method: 'POST',
      path: `/api/admin/users/${regularUser.id}/reset-password`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: {}
    });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body.temporaryPassword === 'string');
    assert.ok(res.body.temporaryPassword.length >= 8);
  });

  // 21. Password reset invalidates all existing sessions for the target user
  test('21. Password reset invalidates all existing sessions for the target user', async () => {
    // Reset password again with a known password
    await makeRequest({
      method: 'POST',
      path: `/api/admin/users/${regularUser.id}/reset-password`,
      headers: { cookie: `qa_session=${adminSessionToken}` },
      body: { temporaryPassword: 'FreshPassword123!' }
    });

    // Attempt using the old regularSessionToken
    const meRes = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: { cookie: `qa_session=${regularSessionToken}` }
    });
    assert.equal(meRes.status, 401);
  });

  // 22. Target user can sign in with the new temporary password
  test('22. Target user can sign in with the new temporary password', async () => {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: regularUser.email, password: 'FreshPassword123!' }
    });
    assert.equal(res.status, 200);
    assert.ok(res.body.session?.token || res.headers['set-cookie']);
  });

  // 23. Target user cannot sign in with their old password after reset
  test('23. Target user cannot sign in with their old password after reset', async () => {
    const res = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: regularUser.email, password: 'RegularPass123!' }
    });
    assert.equal(res.status, 401);
  });

  // 24. Password reset does not affect other users' sessions
  test("24. Password reset does not affect other users' sessions", async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: { cookie: `qa_session=${adminSessionToken}` }
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.email, adminUser.email);
  });

  // 25. Audit log records all admin actions (user update, password reset)
  test('25. Audit log records all admin actions', async () => {
    const events = auditLogger.getRecentEvents(50);
    const updateEvent = events.find(e => e.eventType === 'USER_UPDATE' && e.metadata?.targetUserId === regularUser.id);
    const resetEvent = events.find(e => e.eventType === 'ADMIN_RESET_PASSWORD' && e.metadata?.targetUserId === regularUser.id);
    assert.ok(updateEvent, 'USER_UPDATE event was recorded in audit log');
    assert.ok(resetEvent, 'ADMIN_RESET_PASSWORD event was recorded in audit log');
  });
});
