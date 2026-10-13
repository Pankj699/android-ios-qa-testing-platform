const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

const config = require('../src/config');
const { runMigrations } = require('../src/db/migrate');
const userService = require('../src/services/userService');
const { authenticate } = require('../src/middleware/auth');
const driveRoutes = require('../src/routes/driveRoutes');

describe('Google Drive Router Mount & Auth URL Endpoint Suite', () => {
  let app;
  let testUser;
  let authToken;
  let origClientId;
  let origClientSecret;

  // Simulate requests through Express application
  function makeRequest({ method = 'GET', urlPath, headers = {} }) {
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
    origClientId = config.GOOGLE_CLIENT_ID;
    origClientSecret = config.GOOGLE_CLIENT_SECRET;

    config.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    config.GOOGLE_CLIENT_SECRET = 'test-client-secret-123';
    config.GOOGLE_REDIRECT_URI = 'http://localhost:8080/api/drive/callback';

    await runMigrations();

    testUser = await userService.register({
      email: `router_test_user_${Date.now()}@test.com`,
      password: 'Password123!',
      name: 'Router Tester'
    });

    authToken = jwt.sign(
      { id: testUser.id, email: testUser.email, role: 'TESTER' },
      config.JWT_SECRET
    );

    // Express app setup mimicking backend/src/index.js exactly
    app = express();
    app.use(express.json());
    app.use('/api', authenticate);
    app.use('/api/drive', driveRoutes);
  });

  after(() => {
    config.GOOGLE_CLIENT_ID = origClientId;
    config.GOOGLE_CLIENT_SECRET = origClientSecret;
  });

  it('1. GET /api/drive/auth-url successfully returns authorization URL for authenticated user', async () => {
    const res = await makeRequest({
      method: 'GET',
      urlPath: '/api/drive/auth-url',
      headers: { authorization: `Bearer ${authToken}` }
    });

    assert.strictEqual(res.status, 200, 'Expected status 200');
    assert.strictEqual(res.body.success, true);
    assert.ok(typeof res.body.url === 'string' && res.body.url.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
    assert.ok(typeof res.body.state === 'string' && res.body.state.length > 20);
  });

  it('2. GET /api/drive/auth/url alias successfully returns authorization URL for authenticated user', async () => {
    const res = await makeRequest({
      method: 'GET',
      urlPath: '/api/drive/auth/url',
      headers: { authorization: `Bearer ${authToken}` }
    });

    assert.strictEqual(res.status, 200, 'Expected status 200 on /auth/url alias');
    assert.strictEqual(res.body.success, true);
    assert.ok(typeof res.body.url === 'string' && res.body.url.includes('client_id='));
    assert.ok(typeof res.body.state === 'string');
  });

  it('3. GET /api/drive/auth-url with prompt=select_account query parameter passes through', async () => {
    const res = await makeRequest({
      method: 'GET',
      urlPath: '/api/drive/auth-url?prompt=select_account',
      headers: { authorization: `Bearer ${authToken}` }
    });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.success, true);
    assert.ok(res.body.url.includes('prompt=select_account'));
  });

  it('4. Rejects unauthenticated request to /api/drive/auth-url with 401 JSON and not 404 HTML', async () => {
    const res = await makeRequest({
      method: 'GET',
      urlPath: '/api/drive/auth-url'
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.authenticated, false);
    assert.strictEqual(res.body.success, false);
  });

  it('5. Rejects unauthenticated request to /api/drive/auth/url with 401 JSON and not 404 HTML', async () => {
    const res = await makeRequest({
      method: 'GET',
      urlPath: '/api/drive/auth/url'
    });

    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.authenticated, false);
    assert.strictEqual(res.body.success, false);
  });

  it('6. OAuth callback at /api/drive/callback is exempted from Bearer authentication', async () => {
    const res = await makeRequest({
      method: 'GET',
      urlPath: '/api/drive/callback?format=json'
    });

    // Should NOT be 401 Unauthorized; missing code/state results in 400 Bad Request
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.success, false);
    assert.ok(res.body.error.includes('Missing authorization code or state'));
  });
});
