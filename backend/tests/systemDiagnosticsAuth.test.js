const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const userService = require('../src/services/userService');
const { authenticate } = require('../src/middleware/auth');
const systemRoutes = require('../src/routes/systemRoutes');

describe('System Diagnostics Authorization Suite', () => {
  let app;
  let adminUser;
  let adminSessionToken;
  let regularUser;
  let regularSessionToken;

  function makeRequest({ method = 'GET', path, headers = {} }) {
    return new Promise((resolve) => {
      let statusCode = 200;
      let responseHeaders = {};
      let responseBody = null;

      const req = {
        method,
        url: path,
        originalUrl: path,
        path: path.split('?')[0],
        headers: {
          'content-type': 'application/json',
          ...headers
        },
        body: {},
        query: {},
        ip: '127.0.0.1'
      };

      const res = {
        status(code) {
          statusCode = code;
          return this;
        },
        setHeader(k, v) {
          responseHeaders[k.toLowerCase()] = v;
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
          resolve({ status: 500, headers: responseHeaders, body: { error: err.message } });
        } else {
          resolve({ status: 404, headers: responseHeaders, body: { error: 'Not found' } });
        }
      });
    });
  }

  before(async () => {
    await runMigrations();

    // 1. Create admin user
    const adminEmail = `admin_diag_${Date.now()}@test.internal`;
    const adminReg = await userService.register({
      name: 'Admin Tester',
      email: adminEmail,
      password: 'AdminPassword123!'
    });
    // Set role to ADMIN
    await db.query('UPDATE users SET role = $1 WHERE id = $2', ['ADMIN', adminReg.id]);
    const adminSession = await userService.createSession(adminReg.id, '127.0.0.1', 'Node-Test-Admin');
    adminSessionToken = adminSession.sessionToken;

    // 2. Create regular user
    const regularEmail = `user_diag_${Date.now()}@test.internal`;
    const regularReg = await userService.register({
      name: 'Regular QA',
      email: regularEmail,
      password: 'UserPassword123!'
    });
    const regularSession = await userService.createSession(regularReg.id, '127.0.0.1', 'Node-Test-User');
    regularSessionToken = regularSession.sessionToken;

    // 3. Setup Express app with production auth & system routes
    app = express();
    app.use(express.json());
    app.use('/api', authenticate);
    app.use('/api', systemRoutes);
  });

  test('1. Unauthenticated request to /api/system/diagnostics is rejected with 401', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/system/diagnostics'
    });

    assert.strictEqual(res.status, 401, 'Unauthenticated request must return 401');
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /Authentication required/i);
  });

  test('2. Authenticated non-admin request to /api/system/diagnostics is rejected with 403', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/system/diagnostics',
      headers: {
        cookie: `qa_session=${encodeURIComponent(regularSessionToken)}`
      }
    });

    assert.strictEqual(res.status, 403, 'Non-admin request must return 403');
    assert.strictEqual(res.body.success, false);
    assert.match(res.body.error, /Forbidden\. Insufficient permissions/i);
  });

  test('3. Authenticated admin request to /api/system/diagnostics succeeds with 200 and diagnostics data', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/system/diagnostics',
      headers: {
        cookie: `qa_session=${encodeURIComponent(adminSessionToken)}`
      }
    });

    assert.strictEqual(res.status, 200, 'Admin request must return 200');
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.diagnostics, 'Response must include diagnostics object');
    assert.ok(res.body.diagnostics.server, 'Diagnostics must include server information');
    assert.ok(res.body.diagnostics.tools, 'Diagnostics must include tools information');
    assert.ok(res.body.diagnostics.devices, 'Diagnostics must include devices information');
  });

  test('4. Public /api/system/env remains accessible without authentication', async () => {
    const res = await makeRequest({
      method: 'GET',
      path: '/api/system/env'
    });

    assert.strictEqual(res.status, 200, '/api/system/env must be public and return 200');
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.config, 'Response must include safe config');
  });
});
