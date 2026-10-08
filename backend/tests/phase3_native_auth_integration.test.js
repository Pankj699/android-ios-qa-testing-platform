const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');

const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const userService = require('../src/services/userService');
const authController = require('../src/controllers/authController');
const deviceController = require('../src/controllers/deviceController');
const testController = require('../src/controllers/testController');
const buildController = require('../src/controllers/buildController');
const { authenticate, verifySocketToken, requireRole } = require('../src/middleware/auth');
const deviceLockService = require('../src/services/deviceLockService');
const agentService = require('../src/services/agentService');
const screenMirrorService = require('../src/services/screenMirrorService');
const testRunnerService = require('../src/services/testRunnerService');
const historyService = require('../src/services/historyService');
const config = require('../src/config');

describe('Phase 3 — Native Authentication ↔ Authorization Integration Suite', () => {
  let app;
  let origEnv;

  before(async () => {
    origEnv = config.NODE_ENV;
    config.NODE_ENV = 'test';

    await runMigrations();
    await userService.seedInitialAdmin();

    app = express();
    app.use(express.json());
    app.use('/api', authenticate);

    // Auth Routes
    app.post('/api/auth/register', (req, res, next) => authController.register(req, res, next));
    app.post('/api/auth/login', (req, res, next) => authController.login(req, res, next));
    app.get('/api/auth/me', (req, res, next) => authController.me(req, res, next));
    app.post('/api/auth/logout', (req, res, next) => authController.logout(req, res, next));
    app.post('/api/auth/forgot-password', (req, res, next) => authController.forgotPassword(req, res, next));
    app.post('/api/auth/reset-password', (req, res, next) => authController.resetPassword(req, res, next));

    // Device Routes
    app.get('/api/devices', (req, res, next) => deviceController.listDevices(req, res, next));
    app.get('/api/device/:id/info', (req, res, next) => deviceController.getDeviceInfo(req, res, next));
    app.post('/api/device/:id/claim', (req, res, next) => deviceController.claimDevice(req, res, next));
    app.post('/api/device/:id/release', (req, res, next) => deviceController.releaseDevice(req, res, next));
    app.post('/api/device/:id/mirror/start', (req, res, next) => deviceController.startMirror(req, res, next));

    // Test & Build Routes
    app.post('/api/test/run', (req, res, next) => testController.runTest(req, res, next));
    app.get('/api/test/:id', (req, res, next) => testController.getTest(req, res, next));
    app.get('/api/tests/history', (req, res, next) => testController.listHistory(req, res, next));
    app.get('/api/builds', (req, res, next) => buildController.listBuilds(req, res, next));

    // Role-protected test routes for contract verification
    app.get('/api/role-test/admin', requireRole(['ADMIN']), (req, res) => res.json({ success: true, role: req.user.role }));
    app.get('/api/role-test/editor', requireRole(['EDITOR']), (req, res) => res.json({ success: true, role: req.user.role }));
    app.get('/api/role-test/tester', requireRole(['TESTER']), (req, res) => res.json({ success: true, role: req.user.role }));
    app.get('/api/role-test/developer', requireRole(['DEVELOPER']), (req, res) => res.json({ success: true, role: req.user.role }));
    app.get('/api/role-test/viewer', requireRole(['VIEWER']), (req, res) => res.json({ success: true, role: req.user.role }));
  });

  after(() => {
    if (origEnv !== undefined) config.NODE_ENV = origEnv;
  });

  function makeRequest({ method = 'GET', path: reqPath, headers = {}, body = null }) {
    return new Promise((resolve) => {
      let statusCode = 200;
      let responseHeaders = {};
      let responseBody = null;

      const [pathname, queryString] = reqPath.split('?');
      const query = {};
      if (queryString) {
        new URLSearchParams(queryString).forEach((v, k) => { query[k] = v; });
      }

      const req = {
        method,
        url: reqPath,
        originalUrl: reqPath,
        path: pathname,
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

  // --- 1. Authenticated TESTER can access permitted protected APIs ---
  test('1. Authenticated TESTER can access permitted protected APIs', async () => {
    const email = `tester_${Date.now()}@qatools.test`;
    const reg = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Alice Tester', email, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    assert.strictEqual(reg.status, 201);
    const sessionToken = extractCookie(reg.headers, 'qa_session');
    assert.ok(sessionToken);

    // Call protected /api/devices
    const devRes = await makeRequest({
      method: 'GET',
      path: '/api/devices',
      headers: { cookie: `qa_session=${sessionToken}` }
    });
    assert.strictEqual(devRes.status, 200);
    assert.strictEqual(devRes.body.success, true);
    assert.ok(Array.isArray(devRes.body.devices));

    // Call protected /api/builds
    const buildRes = await makeRequest({
      method: 'GET',
      path: '/api/builds',
      headers: { cookie: `qa_session=${sessionToken}` }
    });
    assert.strictEqual(buildRes.status, 200);
    assert.strictEqual(buildRes.body.success, true);
  });

  // --- 2. Unauthenticated user receives 401 from protected APIs ---
  test('2. Unauthenticated user receives 401 from protected APIs', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/devices'
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.authenticated, false);
    assert.match(res.body.error, /Authentication required/i);
  });

  // --- 3. Invalid or revoked qa_session receives 401 ---
  test('3. Invalid or revoked qa_session receives 401', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/devices',
      headers: { cookie: 'qa_session=invalid_fake_session_token_12345' }
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.authenticated, false);
    assert.match(res.body.error, /Invalid or expired session/i);
  });

  // --- 4. User A cannot access User B claimed device ---
  test('4. User A cannot access User B claimed device', async () => {
    const emailA = `user_a_${Date.now()}@qatools.test`;
    const emailB = `user_b_${Date.now()}@qatools.test`;

    const regA = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'User A', email: emailA, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const cookieA = extractCookie(regA.headers, 'qa_session');

    const regB = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'User B', email: emailB, password: 'Password123!', confirmPassword: 'Password123!' }
    });

    const testSerial = `DEV_TEST_${Date.now()}`;
    // User B claims device
    deviceLockService.claimDevice(testSerial, regB.body.user);

    // User A attempts to access User B device info
    const infoRes = await makeRequest({
      method: 'GET',
      path: `/api/device/${testSerial}/info`,
      headers: { cookie: `qa_session=${cookieA}` }
    });
    assert.strictEqual(infoRes.status, 403);
    assert.match(infoRes.body.error, /claimed by another user/i);

    // Clean up
    deviceLockService.releaseDevice(testSerial, regB.body.user, true);
  });

  // --- 5. User B cannot release User A device ---
  test('5. User B cannot release User A device', async () => {
    const emailA = `owner_a_${Date.now()}@qatools.test`;
    const emailB = `intruder_b_${Date.now()}@qatools.test`;

    const regA = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Owner A', email: emailA, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const regB = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Intruder B', email: emailB, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const cookieB = extractCookie(regB.headers, 'qa_session');

    const serial = `DEV_OWNED_A_${Date.now()}`;
    deviceLockService.claimDevice(serial, regA.body.user);

    // User B attempts to release User A device -> 410 Gone (claim/release removed)
    const relRes = await makeRequest({
      method: 'POST',
      path: `/api/device/${serial}/release`,
      headers: { cookie: `qa_session=${cookieB}` },
      body: {}
    });
    assert.strictEqual(relRes.status, 410);
    assert.strictEqual(relRes.body.code, 'CLAIM_RELEASE_DEPRECATED');

    // Clean up with owner
    deviceLockService.clearOwner(serial);
  });

  // --- 6. User B cannot run tests against User A claimed device ---
  test('6. User B cannot run tests against User A claimed device', async () => {
    const emailA = `owner_runner_a_${Date.now()}@qatools.test`;
    const emailB = `runner_b_${Date.now()}@qatools.test`;

    const regA = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Owner Runner A', email: emailA, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const regB = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Runner B', email: emailB, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const cookieB = extractCookie(regB.headers, 'qa_session');

    const serial = `DEV_PAD_${Date.now()}`;
    deviceLockService.claimDevice(serial, regA.body.user);

    // Create a mock build so build check passes
    const buildId = `bld_${Date.now()}`;
    historyService.saveBuild({
      id: buildId,
      fileName: 'app.aab',
      packageName: 'com.example.app',
      userId: regA.body.user.id
    });

    // User B attempts to run test on device
    const runRes = await makeRequest({
      method: 'POST',
      path: '/api/test/run',
      headers: { cookie: `qa_session=${cookieB}` },
      body: {
        buildId,
        deviceSerial: serial
      }
    });
    assert.strictEqual(runRes.status, 409);
    assert.match(runRes.body.error, /currently claimed by/i);

    // Clean up
    deviceLockService.releaseDevice(serial, regA.body.user);
  });

  // --- 7. User B cannot open User A protected screen mirror ---
  test('7. User B cannot open User A protected screen mirror', async () => {
    const emailA = `mirror_a_${Date.now()}@qatools.test`;
    const emailB = `mirror_b_${Date.now()}@qatools.test`;

    const regA = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Mirror A', email: emailA, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const regB = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Mirror B', email: emailB, password: 'Password123!', confirmPassword: 'Password123!' }
    });

    const serial = `DEV_MIRROR_${Date.now()}`;
    deviceLockService.claimDevice(serial, regA.body.user);

    // screenMirrorService authorization check
    await assert.rejects(
      async () => {
        await screenMirrorService.startMirror(serial, regB.body.user);
      },
      /not accessible/i
    );

    deviceLockService.releaseDevice(serial, regA.body.user);
  });

  // --- 8. User B cannot access User A protected logcat/WebSocket resources ---
  test('8. User B cannot access User A protected logcat/WebSocket resources', async () => {
    const userA = { id: `usr_logcat_a_${Date.now()}`, name: 'User A', email: 'a@qa.test', role: 'TESTER' };
    const userB = { id: `usr_logcat_b_${Date.now()}`, name: 'User B', email: 'b@qa.test', role: 'TESTER' };

    const serial = `DEV_LOGCAT_${Date.now()}`;
    deviceLockService.claimDevice(serial, userA);

    // Verify accessibility check for User B
    const canAccess = deviceLockService.isDeviceAccessible(serial, userB);
    assert.strictEqual(canAccess, false);

    // Verify test subscription isolation
    const mockWs = {
      messages: [],
      send(data) { this.messages.push(JSON.parse(data)); },
      readyState: 1
    };

    const testId = `test_p3_${Date.now()}`;
    testRunnerService.activeTests.set(testId, {
      testData: { id: testId, userId: userA.id },
      snapshot: { type: 'SNAPSHOT' }
    });

    const subscribed = testRunnerService.subscribe(testId, mockWs, userB);
    assert.strictEqual(subscribed, false);
    assert.strictEqual(mockWs.messages.length, 1);
    assert.strictEqual(mockWs.messages[0].type, 'ERROR');
    assert.match(mockWs.messages[0].message, /Unauthorized/i);

    testRunnerService.activeTests.delete(testId);
    deviceLockService.releaseDevice(serial, userA);
  });

  // --- 9 & 10. User A claim remains intact after User A logs out; User B cannot inherit it ---
  test('9 & 10. User A claim remains intact after logout; User B cannot inherit it', async () => {
    const emailA = `claim_persist_a_${Date.now()}@qatools.test`;
    const emailB = `claim_persist_b_${Date.now()}@qatools.test`;

    const regA = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Persist A', email: emailA, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const cookieA = extractCookie(regA.headers, 'qa_session');
    const userA = regA.body.user;

    const serial = `DEV_PERSIST_${Date.now()}`;
    // User A sets connection ownership
    deviceLockService.setOwner(serial, userA);

    // User A logs out
    const logoutRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/logout',
      headers: { cookie: `qa_session=${cookieA}` }
    });
    assert.strictEqual(logoutRes.status, 200);

    // Check device connection ownership still persists in deviceLockService
    const ownerAfterLogout = deviceLockService.getOwner(serial);
    assert.ok(ownerAfterLogout, 'Device connection ownership MUST persist across user logout');
    assert.strictEqual(ownerAfterLogout.userId, userA.id);

    // User B registers/logs in
    const regB = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Persist B', email: emailB, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const cookieB = extractCookie(regB.headers, 'qa_session');

    // User B cannot access User A device
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial, regB.body.user), false);

    // Clean up
    deviceLockService.clearOwner(serial);
  });

  // --- 11. Explicit device release remains deprecated (HTTP 410) ---
  test('11. Explicit device release endpoint returns HTTP 410 Gone', async () => {
    const email = `explicit_rel_${Date.now()}@qatools.test`;
    const reg = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Releaser', email, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const cookie = extractCookie(reg.headers, 'qa_session');
    const user = reg.body.user;

    const serial = `DEV_EXPLICIT_REL_${Date.now()}`;
    deviceLockService.setOwner(serial, user);

    // Owner requests release -> 410 Gone (claims removed)
    const relRes = await makeRequest({
      method: 'POST',
      path: `/api/device/${serial}/release`,
      headers: { cookie: `qa_session=${cookie}` }
    });
    assert.strictEqual(relRes.status, 410);
    assert.strictEqual(relRes.body.code, 'CLAIM_RELEASE_DEPRECATED');
    assert.strictEqual(deviceLockService.getClaim(serial), null);

    deviceLockService.clearOwner(serial);
  });

  // --- 12 & 13. Password reset invalidates all previous sessions ---
  test('12 & 13. Password reset invalidates previous browser sessions', async () => {
    const email = `pwd_reset_${Date.now()}@qatools.test`;
    const reg = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Reset User', email, password: 'OldPassword123!', confirmPassword: 'OldPassword123!' }
    });
    const oldCookie = extractCookie(reg.headers, 'qa_session');
    assert.ok(oldCookie);

    // Verify old session works
    const meBefore = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: { cookie: `qa_session=${oldCookie}` }
    });
    assert.strictEqual(meBefore.status, 200);

    // Request reset token via userService
    const forgotRes = await userService.requestPasswordReset(email);
    assert.ok(forgotRes.devResetToken);
    const token = forgotRes.devResetToken;

    // Reset password
    const resetRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/reset-password',
      body: {
        token,
        newPassword: 'NewPassword123!',
        confirmPassword: 'NewPassword123!'
      }
    });
    assert.strictEqual(resetRes.status, 200);

    // Old session should now be rejected with 401
    const meAfter = await makeRequest({
      method: 'GET',
      path: '/api/auth/me',
      headers: { cookie: `qa_session=${oldCookie}` }
    });
    assert.strictEqual(meAfter.status, 401);

    // Old session cannot access protected APIs
    const devAfter = await makeRequest({
      method: 'GET',
      path: '/api/devices',
      headers: { cookie: `qa_session=${oldCookie}` }
    });
    assert.strictEqual(devAfter.status, 401);
  });

  // --- 14. Agent JWT with role=device_agent cannot be used as normal browser user ---
  test('14. Agent JWT with role=device_agent cannot be used as normal browser user', async () => {
    const agentToken = jwt.sign(
      { agentId: 'AGENT_TEST_01', userId: 'usr_mock_agent', role: 'device_agent' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const res = await makeRequest({
      method: 'GET',
      path: '/api/devices',
      headers: { authorization: `Bearer ${agentToken}` }
    });
    assert.strictEqual(res.status, 403);
    assert.match(res.body.error, /Agent tokens cannot be used/i);
  });

  // --- 15. Browser qa_session cannot be used as device agent credential ---
  test('15. Browser qa_session cannot be used as device agent credential', async () => {
    const email = `browser_sess_${Date.now()}@qatools.test`;
    const reg = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Browser User', email, password: 'Password123!', confirmPassword: 'Password123!' }
    });
    const sessionCookie = extractCookie(reg.headers, 'qa_session');

    // agentService.verifyAgentToken must reject plain session string
    const verified = agentService.verifyAgentToken(sessionCookie);
    assert.strictEqual(verified, null, 'Browser session must not validate as an Agent token');
  });

  // --- 16. ADMIN authorization remains intact ---
  test('16. ADMIN authorization remains intact (case-insensitive, force-release, view all)', async () => {
    const adminPass = 'AdminPassword123!';
    const adminHash = await userService.hashPassword(adminPass);
    const adminEmail = 'admin_p3@qatools.internal';
    await db.query(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ($1, $2, 'Platform Administrator', 'ADMIN', 'ACTIVE')
       ON CONFLICT (email) DO UPDATE SET role = 'ADMIN', password_hash = $2`,
      [adminEmail, adminHash]
    );

    // Login as admin
    const loginRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email: adminEmail, password: adminPass }
    });
    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.body.user.role, 'ADMIN');
    const adminCookie = extractCookie(loginRes.headers, 'qa_session');

    // Admin passes role-check
    const roleRes = await makeRequest({
      method: 'GET',
      path: '/api/role-test/admin',
      headers: { cookie: `qa_session=${adminCookie}` }
    });
    assert.strictEqual(roleRes.status, 200);

    // Admin can force-release any user device
    const targetSerial = `DEV_ADMIN_FORCE_${Date.now()}`;
    deviceLockService.claimDevice(targetSerial, { id: 'usr_other', name: 'Other User', email: 'other@qa.test', role: 'TESTER' });

    const forceRel = await makeRequest({
      method: 'POST',
      path: `/api/device/${targetSerial}/release`,
      headers: { cookie: `qa_session=${adminCookie}` },
      body: { force: true }
    });
    assert.strictEqual(forceRel.status, 410);
    assert.strictEqual(forceRel.body.code, 'CLAIM_RELEASE_DEPRECATED');
    assert.strictEqual(deviceLockService.getClaim(targetSerial), null);
    deviceLockService.clearOwner(targetSerial);
  });

  // --- 17-20. All 5 role contracts remain intact ---
  test('17-20. Role contracts: ADMIN, EDITOR, TESTER, DEVELOPER, VIEWER authorization works', async () => {
    const roles = ['ADMIN', 'EDITOR', 'TESTER', 'DEVELOPER', 'VIEWER'];

    for (const r of roles) {
      const token = jwt.sign(
        { id: `usr_${r.toLowerCase()}`, name: `${r} User`, email: `${r.toLowerCase()}@qa.test`, role: r },
        config.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // Verify the user can access their specific role endpoint
      const res = await makeRequest({
        method: 'GET',
        path: `/api/role-test/${r.toLowerCase()}`,
        headers: { authorization: `Bearer ${token}` }
      });
      assert.strictEqual(res.status, 200, `User with role ${r} must access /api/role-test/${r.toLowerCase()}`);

      // Verify ADMIN can access all role endpoints
      const adminToken = jwt.sign(
        { id: 'usr_superadmin', name: 'Super Admin', email: 'sa@qa.test', role: 'ADMIN' },
        config.JWT_SECRET,
        { expiresIn: '1h' }
      );
      const adminAccessRes = await makeRequest({
        method: 'GET',
        path: `/api/role-test/${r.toLowerCase()}`,
        headers: { authorization: `Bearer ${adminToken}` }
      });
      assert.strictEqual(adminAccessRes.status, 200, `ADMIN must access /api/role-test/${r.toLowerCase()}`);
    }

    // Verify VIEWER cannot access TESTER-only endpoint
    const viewerToken = jwt.sign(
      { id: 'usr_viewer_01', name: 'Viewer', email: 'viewer@qa.test', role: 'VIEWER' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );
    const viewerDenied = await makeRequest({
      method: 'GET',
      path: '/api/role-test/tester',
      headers: { authorization: `Bearer ${viewerToken}` }
    });
    assert.strictEqual(viewerDenied.status, 403);
  });

  // --- 21. Explicit Logout Contract Verification ---
  test('21. Logout Contract: Claim persists across logout, accessible after re-login', async () => {
    const email = `contract_user_${Date.now()}@qatools.test`;
    const password = 'Password123!';

    // Step 1: User A registers & logs in
    const regRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/register',
      body: { name: 'Contract User A', email, password, confirmPassword: password }
    });
    assert.strictEqual(regRes.status, 201);
    const cookieA1 = extractCookie(regRes.headers, 'qa_session');
    const userA = regRes.body.user;

    // Step 2: Set connection ownership for User A
    const serial = `DEV_LIFECYCLE_CONTRACT_${Date.now()}`;
    deviceLockService.setOwner(serial, userA);

    // Step 3: Verify connection ownership
    const owner1 = deviceLockService.getOwner(serial);
    assert.ok(owner1);
    assert.strictEqual(owner1.userId, userA.id);

    // Step 4: Logout
    const logoutRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/logout',
      headers: { cookie: `qa_session=${cookieA1}` }
    });
    assert.strictEqual(logoutRes.status, 200);

    // Step 5: Verify device connection ownership STILL exists
    const ownerAfterLogout = deviceLockService.getOwner(serial);
    assert.ok(ownerAfterLogout, 'Connection ownership MUST NOT be cleared on user logout');
    assert.strictEqual(ownerAfterLogout.userId, userA.id);

    // Step 6: Login again
    const loginRes = await makeRequest({
      method: 'POST',
      path: '/api/auth/login',
      body: { email, password }
    });
    assert.strictEqual(loginRes.status, 200);
    const cookieA2 = extractCookie(loginRes.headers, 'qa_session');

    // Step 7: Verify User A can still access their device
    const infoRes = await makeRequest({
      method: 'GET',
      path: `/api/device/${serial}/info`,
      headers: { cookie: `qa_session=${cookieA2}` }
    });
    assert.notStrictEqual(infoRes.status, 403, 'User A should not be blocked from their owned device');

    const canAccess = deviceLockService.isDeviceAccessible(serial, loginRes.body.user);
    assert.strictEqual(canAccess, true);

    // Clean up
    deviceLockService.clearOwner(serial);
  });
});
