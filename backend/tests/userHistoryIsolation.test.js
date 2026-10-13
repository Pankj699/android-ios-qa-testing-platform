const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const express = require('express');

const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const userService = require('../src/services/userService');
const testController = require('../src/controllers/testController');
const { authenticate } = require('../src/middleware/auth');
const historyService = require('../src/services/historyService');
const config = require('../src/config');

describe('User-Wise Test History and Dashboard Isolation Suite', () => {
  let app;
  let userAToken;
  let userBToken;
  let adminToken;
  let userAId;
  let userBId;
  let adminId;
  let userATest1;
  let userATest2;
  let userBTest1;

  function simulateRequest(method, reqPath, { headers = {}, body = null } = {}) {
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

  before(async () => {
    await runMigrations();
    await userService.seedInitialAdmin();

    app = express();
    app.use(express.json());
    app.use('/api', authenticate);

    app.get('/api/tests/history', (req, res, next) => testController.listHistory(req, res, next));
    app.get('/api/tests/summary', (req, res, next) => testController.getSummary(req, res, next));
    app.get('/api/test/:id', (req, res, next) => testController.getTest(req, res, next));
    app.get('/api/test/:id/logs', (req, res, next) => testController.getTestLogs(req, res, next));
    app.get('/api/test/:id/download-logs', (req, res, next) => testController.downloadTestLogs(req, res, next));
    app.delete('/api/test/:id', (req, res, next) => testController.deleteTest(req, res, next));

    // Register / Create User A
    const userAEmail = `user_a_${Date.now()}@qatools.test`;
    const regA = await userService.register({
      name: 'User Alpha',
      email: userAEmail,
      password: 'Password123!'
    });
    userAId = regA.id;
    userAToken = jwt.sign({ id: userAId, name: 'User Alpha', email: userAEmail, role: 'TESTER' }, config.JWT_SECRET, { expiresIn: '1h' });

    // Register / Create User B
    const userBEmail = `user_b_${Date.now()}@qatools.test`;
    const regB = await userService.register({
      name: 'User Beta',
      email: userBEmail,
      password: 'Password123!'
    });
    userBId = regB.id;
    userBToken = jwt.sign({ id: userBId, name: 'User Beta', email: userBEmail, role: 'TESTER' }, config.JWT_SECRET, { expiresIn: '1h' });

    // Admin user
    adminId = 'admin-uuid-test';
    adminToken = jwt.sign({ id: adminId, name: 'Super Admin', email: config.ADMIN_EMAIL, role: 'ADMIN' }, config.JWT_SECRET, { expiresIn: '1h' });

    // Seed test records directly into historyService
    userATest1 = historyService.saveTest({
      id: `test_a1_${Date.now()}`,
      userId: userAId,
      userName: 'User Alpha',
      packageName: 'com.alphacompany.appone',
      applicationName: 'Alpha Game',
      deviceName: 'Pixel 7',
      deviceSerial: 'PIXEL7_A',
      version: '1.0.0',
      status: 'COMPLETED',
      result: 'PASS',
      createdAt: new Date(Date.now() - 60000).toISOString()
    });

    userATest2 = historyService.saveTest({
      id: `test_a2_${Date.now()}`,
      userId: userAId,
      userName: 'User Alpha',
      packageName: 'com.alphacompany.apptwo',
      applicationName: 'Alpha Second App',
      deviceName: 'Pixel 7',
      deviceSerial: 'PIXEL7_A',
      version: '2.0.0',
      status: 'COMPLETED',
      result: 'FAIL',
      createdAt: new Date(Date.now() - 30000).toISOString()
    });

    userBTest1 = historyService.saveTest({
      id: `test_b1_${Date.now()}`,
      userId: userBId,
      userName: 'User Beta',
      packageName: 'com.betagroup.betagame',
      applicationName: 'Beta Game',
      deviceName: 'Galaxy S23',
      deviceSerial: 'SAMSUNG_B',
      version: '1.5.0',
      status: 'COMPLETED',
      result: 'PASS',
      createdAt: new Date().toISOString()
    });
  });

  after(() => {
    if (userATest1) historyService.deleteTest(userATest1.id);
    if (userATest2) historyService.deleteTest(userATest2.id);
    if (userBTest1) historyService.deleteTest(userBTest1.id);
  });

  test('1. User A sees strictly their own test history records and not User B', async () => {
    const res = await simulateRequest('GET', '/api/tests/history', {
      headers: { authorization: `Bearer ${userAToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.history));
    
    // User A should see test A1 and A2
    const foundA1 = res.body.history.find(t => t.id === userATest1.id);
    const foundA2 = res.body.history.find(t => t.id === userATest2.id);
    const foundB1 = res.body.history.find(t => t.id === userBTest1.id);

    assert.ok(foundA1, 'User A must see their test A1');
    assert.ok(foundA2, 'User A must see their test A2');
    assert.strictEqual(foundB1, undefined, 'User A must NEVER see User B test records');
    
    // Ensure all returned records belong strictly to User A
    for (const record of res.body.history) {
      assert.strictEqual(record.userId, userAId, 'All records in User A history must belong to User A');
    }
  });

  test('2. User B sees strictly their own test history records and not User A', async () => {
    const res = await simulateRequest('GET', '/api/tests/history', {
      headers: { authorization: `Bearer ${userBToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(Array.isArray(res.body.history));

    const foundB1 = res.body.history.find(t => t.id === userBTest1.id);
    const foundA1 = res.body.history.find(t => t.id === userATest1.id);

    assert.ok(foundB1, 'User B must see their test B1');
    assert.strictEqual(foundA1, undefined, 'User B must NEVER see User A test records');

    for (const record of res.body.history) {
      assert.strictEqual(record.userId, userBId, 'All records in User B history must belong to User B');
    }
  });

  test('3. Query parameter sanitization: undefined and null strings do NOT wipe test history', async () => {
    const res = await simulateRequest('GET', '/api/tests/history?result=undefined&search=undefined', {
      headers: { authorization: `Bearer ${userAToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.history.length >= 2, 'History must not be empty when query params are "undefined"');
  });

  test('4. Result filtering (PASS / FAIL) works accurately within user scope', async () => {
    // Filter PASS for User A
    const passRes = await simulateRequest('GET', '/api/tests/history?result=PASS', {
      headers: { authorization: `Bearer ${userAToken}` }
    });

    assert.strictEqual(passRes.status, 200);
    assert.strictEqual(passRes.body.success, true);
    assert.ok(passRes.body.history.some(t => t.id === userATest1.id));
    assert.strictEqual(passRes.body.history.some(t => t.id === userATest2.id), false);

    // Filter FAIL for User A
    const failRes = await simulateRequest('GET', '/api/tests/history?result=FAIL', {
      headers: { authorization: `Bearer ${userAToken}` }
    });

    assert.strictEqual(failRes.status, 200);
    assert.strictEqual(failRes.body.success, true);
    assert.ok(failRes.body.history.some(t => t.id === userATest2.id));
    assert.strictEqual(failRes.body.history.some(t => t.id === userATest1.id), false);
  });

  test('5. Search filtering accurately finds tests by package name or device within user scope', async () => {
    const searchRes = await simulateRequest('GET', '/api/tests/history?search=apptwo', {
      headers: { authorization: `Bearer ${userAToken}` }
    });

    assert.strictEqual(searchRes.status, 200);
    assert.strictEqual(searchRes.body.success, true);
    assert.strictEqual(searchRes.body.history.length, 1);
    assert.strictEqual(searchRes.body.history[0].id, userATest2.id);
  });

  test('6. User A dashboard summary statistics reflect ONLY User A data', async () => {
    const res = await simulateRequest('GET', '/api/tests/summary', {
      headers: { authorization: `Bearer ${userAToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const stats = res.body.stats;
    assert.strictEqual(stats.totalTests, 2, 'User A should have exactly 2 tests');
    assert.strictEqual(stats.passed, 1, 'User A should have 1 passed test');
    assert.strictEqual(stats.failed, 1, 'User A should have 1 failed test');
    assert.strictEqual(stats.passRate, '50%', 'Pass rate should be 50%');
    assert.strictEqual(stats.recentTests.length, 2);
    assert.strictEqual(stats.recentTests[0].id, userATest2.id, 'Recent tests must be sorted newest first');
  });

  test('7. User B dashboard summary statistics reflect ONLY User B data', async () => {
    const res = await simulateRequest('GET', '/api/tests/summary', {
      headers: { authorization: `Bearer ${userBToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    const stats = res.body.stats;
    assert.strictEqual(stats.totalTests, 1, 'User B should have exactly 1 test');
    assert.strictEqual(stats.passed, 1, 'User B should have 1 passed test');
    assert.strictEqual(stats.failed, 0, 'User B should have 0 failed tests');
    assert.strictEqual(stats.passRate, '100%', 'Pass rate should be 100%');
  });

  test('8. Brand new user with zero tests sees clean empty statistics (no leaked legacy records)', async () => {
    const newEmail = `fresh_user_${Date.now()}@qatools.test`;
    const regNew = await userService.register({
      name: 'Brand New User',
      email: newEmail,
      password: 'Password123!'
    });
    const newToken = jwt.sign({ id: regNew.id, name: 'Brand New User', email: newEmail, role: 'TESTER' }, config.JWT_SECRET, { expiresIn: '1h' });

    const statsRes = await simulateRequest('GET', '/api/tests/summary', {
      headers: { authorization: `Bearer ${newToken}` }
    });

    assert.strictEqual(statsRes.status, 200);
    assert.strictEqual(statsRes.body.success, true);
    assert.strictEqual(statsRes.body.stats.totalTests, 0, 'New user totalTests must be 0');
    assert.strictEqual(statsRes.body.stats.passed, 0);
    assert.strictEqual(statsRes.body.stats.failed, 0);
    assert.strictEqual(statsRes.body.stats.passRate, '0%', 'Empty tests pass rate must be 0%');
    assert.strictEqual(statsRes.body.stats.recentTests.length, 0);

    const histRes = await simulateRequest('GET', '/api/tests/history', {
      headers: { authorization: `Bearer ${newToken}` }
    });

    assert.strictEqual(histRes.status, 200);
    assert.strictEqual(histRes.body.success, true);
    assert.strictEqual(histRes.body.history.length, 0, 'New user test history must be completely empty');
  });

  test('9. Ownership authorization: User B cannot view or delete User A test', async () => {
    // User B tries to view User A's test
    const viewRes = await simulateRequest('GET', `/api/test/${userATest1.id}`, {
      headers: { authorization: `Bearer ${userBToken}` }
    });

    assert.strictEqual(viewRes.status, 403, 'User B must get 403 Forbidden viewing User A test');

    // User B tries to delete User A's test
    const delRes = await simulateRequest('DELETE', `/api/test/${userATest1.id}`, {
      headers: { authorization: `Bearer ${userBToken}` }
    });

    assert.strictEqual(delRes.status, 403, 'User B must get 403 Forbidden deleting User A test');
  });

  test('10. Admin can inspect all tests across users with query parameter all=true', async () => {
    const adminRes = await simulateRequest('GET', '/api/tests/history?all=true', {
      headers: { authorization: `Bearer ${adminToken}` }
    });

    assert.strictEqual(adminRes.status, 200);
    assert.strictEqual(adminRes.body.success, true);
    assert.ok(adminRes.body.history.some(t => t.id === userATest1.id), 'Admin must see User A test');
    assert.ok(adminRes.body.history.some(t => t.id === userBTest1.id), 'Admin must see User B test');
  });
});
