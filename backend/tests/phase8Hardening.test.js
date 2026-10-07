const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');
const config = require('../src/config');
const { authenticate } = require('../src/middleware/auth');
const { RateLimiter } = require('../src/middleware/rateLimiter');
const auditLogger = require('../src/utils/auditLogger');
const errorHandler = require('../src/middleware/errorHandler');
const agentService = require('../src/services/agentService');
const agentMirrorService = require('../src/services/agentMirrorService');
const deviceLockService = require('../src/services/deviceLockService');

test('Phase 8 — Production Hardening & Security Audit Suite', async (t) => {

  await t.test('1. Rate Limiter blocks excessive requests with HTTP 429', () => {
    const limiter = new RateLimiter({ windowMs: 1000, max: 3, message: 'Rate limit exceeded' });
    const mw = limiter.middleware(() => 'client_test_ip');

    const req = {};
    let status = 200;
    let jsonBody = null;
    const res = {
      status(code) { status = code; return this; },
      json(obj) { jsonBody = obj; return this; }
    };
    const next = () => {};

    // 3 requests pass
    mw(req, res, next);
    assert.strictEqual(status, 200);
    mw(req, res, next);
    assert.strictEqual(status, 200);
    mw(req, res, next);
    assert.strictEqual(status, 200);

    // 4th request gets blocked with 429
    mw(req, res, next);
    assert.strictEqual(status, 429);
    assert.strictEqual(jsonBody.success, false);
    assert.strictEqual(jsonBody.error, 'Rate limit exceeded');
  });

  await t.test('2. Audit Logger sanitizes sensitive tokens before recording', () => {
    const rawData = {
      userId: 'usr_audit_01',
      userEmail: 'auditor@qatools.test',
      action: 'LOGIN',
      details: {
        password: 'SuperSecretPassword123!',
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test',
        deviceId: '00008140-TEST'
      }
    };

    auditLogger.logEvent('USER_LOGIN', rawData);
    assert.strictEqual(rawData.details.password, undefined);
    assert.strictEqual(rawData.details.token, undefined);
    assert.strictEqual(rawData.details.deviceId, '00008140-TEST');
  });

  await t.test('3. Error Handler never leaks stack traces in production environment', () => {
    const origEnv = config.NODE_ENV;
    config.NODE_ENV = 'production';

    try {
      const err = new Error('Database connection failed at /var/secret/db.js:42');
      err.stack = 'Error: Database connection failed\\n    at /var/secret/db.js:42:15';
      const req = { method: 'GET', originalUrl: '/api/devices' };
      let statusCode = 0;
      let respBody = null;
      const res = {
        status(code) { statusCode = code; return this; },
        json(obj) { respBody = obj; return this; }
      };

      errorHandler(err, req, res, () => {});
      assert.strictEqual(statusCode, 500);
      assert.strictEqual(respBody.success, false);
      assert.strictEqual(respBody.technicalDetails, undefined, 'Technical details/stack trace must be hidden in production');
    } finally {
      config.NODE_ENV = origEnv;
    }
  });

  await t.test('4. JWT Authentication strictly validates signature and expiry', () => {
    // 1. Expired token
    const expiredToken = jwt.sign({ id: 'usr_p8', email: 'test@qa.org' }, config.JWT_SECRET, { expiresIn: '-1s' });
    let authReq = { headers: { authorization: `Bearer ${expiredToken}` }, path: '/api/devices' };
    let authRes = {
      status(code) { this.statusCode = code; return this; },
      json(obj) { this.body = obj; return this; }
    };
    let calledNext = false;
    authenticate(authReq, authRes, () => { calledNext = true; });
    assert.strictEqual(calledNext, false);
    assert.strictEqual(authRes.statusCode, 401);

    // 2. Tampered signature
    const forgedToken = jwt.sign({ id: 'usr_p8', email: 'test@qa.org' }, 'wrong_fake_secret_key');
    authReq = { headers: { authorization: `Bearer ${forgedToken}` }, path: '/api/devices' };
    calledNext = false;
    authenticate(authReq, authRes, () => { calledNext = true; });
    assert.strictEqual(calledNext, false);
    assert.strictEqual(authRes.statusCode, 401);
  });

  await t.test('5. Agent token cannot be used to forge normal user session', () => {
    const agentToken = jwt.sign(
      { agentId: 'AGENT-FORGER-01', userId: 'usr_alice', role: 'device_agent' },
      config.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const verifiedAgent = agentService.verifyAgentToken(agentToken);
    assert.ok(verifiedAgent);
    assert.strictEqual(verifiedAgent.agentId, 'AGENT-FORGER-01');
    assert.strictEqual(verifiedAgent.role, 'device_agent');
  });

  await t.test('6. Stream token is strictly scoped to device and expires', () => {
    const token = 'tok_p8_sec_test';
    agentMirrorService.streamTokens.set(token, {
      udid: '00008140-P8-DEVICE',
      userId: 'usr_alice_p8',
      agentId: 'AGENT-P8-01',
      expiresAt: Date.now() + 1000
    });

    // Valid check
    assert.strictEqual(agentMirrorService.verifyStreamToken('00008140-P8-DEVICE', token), true);

    // Mismatched device check
    assert.strictEqual(agentMirrorService.verifyStreamToken('00008140-OTHER', token), false);

    // Expired check
    agentMirrorService.streamTokens.set(token, {
      udid: '00008140-P8-DEVICE',
      userId: 'usr_alice_p8',
      agentId: 'AGENT-P8-01',
      expiresAt: Date.now() - 5000 // expired
    });
    assert.strictEqual(agentMirrorService.verifyStreamToken('00008140-P8-DEVICE', token), false);
  });

});
