const { test, describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { authenticate } = require('../src/middleware/auth');
const remoteConfigRoutes = require('../src/routes/remoteConfigRoutes');
const remoteConfigService = require('../src/services/remoteConfigService');
const config = require('../src/config');
const jwt = require('jsonwebtoken');

describe('Remote Config Manager Unauthenticated Access & Route Protection Suite', () => {
  let app;
  let origEnv;
  let origGetApplications;
  let origGetConfigs;
  let origCreateConfig;
  let origUpdateConfig;
  let origToggleActive;
  let origDeleteConfig;

  before(async () => {
    origEnv = config.NODE_ENV;
    config.NODE_ENV = 'test';

    // Mock remoteConfigService methods to avoid hitting real upstream network services in unit tests
    origGetApplications = remoteConfigService.getApplications;
    origGetConfigs = remoteConfigService.getConfigs;
    origCreateConfig = remoteConfigService.createConfig;
    origUpdateConfig = remoteConfigService.updateConfig;
    origToggleActive = remoteConfigService.toggleActive;
    origDeleteConfig = remoteConfigService.deleteConfig;

    remoteConfigService.getApplications = async (platform) => {
      if (platform !== 'android' && platform !== 'ios') {
        const err = new Error(`Unsupported platform: '${platform}'. Must be 'android' or 'ios'.`);
        err.type = 'VALIDATION_ERROR';
        err.statusCode = 400;
        throw err;
      }
      return [
        { name: 'DesignWiz', slug: 'designwiz', config_count: 5 },
        { name: '1Invites', slug: '1invites', config_count: 2 }
      ];
    };

    remoteConfigService.getConfigs = async (platform, appSlug) => {
      if (!appSlug) {
        const err = new Error("Application slug ('app') is required.");
        err.type = 'VALIDATION_ERROR';
        err.statusCode = 400;
        throw err;
      }
      return {
        platform,
        application: appSlug,
        count: 1,
        configs: [
          { id: '101', key: 'test_feature', value: '{"enabled":true}', type: 'json', active: true, rawValue: '{"enabled":true}' }
        ]
      };
    };

    remoteConfigService.createConfig = async (platform, appSlug, data) => {
      if (!data.key) {
        const err = new Error('Configuration key is required.');
        err.type = 'VALIDATION_ERROR';
        err.statusCode = 400;
        throw err;
      }
      return {
        id: '202',
        key: data.key,
        value: data.value || '1',
        type: data.type || 'boolean',
        active: data.is_active !== undefined ? Boolean(data.is_active) : true
      };
    };

    remoteConfigService.updateConfig = async (platform, appSlug, id, data) => {
      return {
        id,
        key: data.key || 'updated_key',
        value: data.value || '2',
        type: data.type || 'number',
        active: true
      };
    };

    remoteConfigService.toggleActive = async (platform, appSlug, id, isActive) => {
      return {
        id,
        key: 'toggled_key',
        active: isActive !== undefined ? Boolean(isActive) : false
      };
    };

    remoteConfigService.deleteConfig = async (platform, appSlug, id) => {
      return {
        success: true,
        message: `Remote Config ID ${id} deleted successfully.`
      };
    };

    // Setup isolated Express application mirroring index.js routing
    app = express();
    app.use(express.json());

    // Central Auth Middleware mounted at /api exactly as in index.js
    app.use('/api', authenticate);

    // Protected dummy routes to verify auth is still strictly enforced for other features
    app.get('/api/devices', (req, res) => res.json({ success: true, devices: [] }));
    app.get('/api/builds', (req, res) => res.json({ success: true, builds: [] }));
    app.post('/api/tests/run', (req, res) => res.json({ success: true, status: 'running' }));
    app.post('/api/adb/relaunch', (req, res) => res.json({ success: true, action: 'relaunch' }));
    app.get('/api/admin/users', (req, res) => res.json({ success: true, users: [] }));

    // Remote Config Routes mounted at all three aliases
    app.use('/api/remote-config', remoteConfigRoutes);
    app.use('/api/remote-configs', remoteConfigRoutes);
    app.use('/api/remoteconfig', remoteConfigRoutes);
  });

  after(() => {
    config.NODE_ENV = origEnv;
    remoteConfigService.getApplications = origGetApplications;
    remoteConfigService.getConfigs = origGetConfigs;
    remoteConfigService.createConfig = origCreateConfig;
    remoteConfigService.updateConfig = origUpdateConfig;
    remoteConfigService.toggleActive = origToggleActive;
    remoteConfigService.deleteConfig = origDeleteConfig;
  });

  // Simulated HTTP request helper using real Express dispatching
  function dispatchRequest({ method = 'GET', url, headers = {}, body = null }) {
    return new Promise((resolve) => {
      const http = require('http');
      const server = http.createServer(app);

      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
        const reqOptions = {
          hostname: '127.0.0.1',
          port,
          path: url,
          method,
          headers: {
            'content-type': 'application/json',
            ...(payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
            ...headers
          }
        };

        const req = http.request(reqOptions, (res) => {
          let rawData = '';
          res.on('data', (chunk) => { rawData += chunk; });
          res.on('end', () => {
            server.close();
            let parsed = {};
            try {
              parsed = JSON.parse(rawData);
            } catch {
              parsed = { raw: rawData };
            }
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: parsed
            });
          });
        });

        req.on('error', (err) => {
          server.close();
          resolve({ status: 500, error: err });
        });

        if (payload) {
          req.write(payload);
        }
        req.end();
      });
    });
  }

  describe('1. Unauthenticated Remote Config Access (Zero Token / Zero Session)', () => {
    it('allows unauthenticated GET /api/remote-config/applications for android', async () => {
      const res = await dispatchRequest({
        method: 'GET',
        url: '/api/remote-config/applications?platform=android'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.platform, 'android');
      assert.strictEqual(res.body.applications.length, 2);
    });

    it('allows unauthenticated GET /api/remote-config/applications for ios', async () => {
      const res = await dispatchRequest({
        method: 'GET',
        url: '/api/remote-config/applications?platform=ios'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.platform, 'ios');
      assert.strictEqual(res.body.applications.length, 2);
    });

    it('allows unauthenticated GET /api/remote-config/configs', async () => {
      const res = await dispatchRequest({
        method: 'GET',
        url: '/api/remote-config/configs?platform=android&app=designwiz'
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.application, 'designwiz');
      assert.strictEqual(res.body.configs.length, 1);
    });

    it('allows unauthenticated POST /api/remote-config/configs (create)', async () => {
      const res = await dispatchRequest({
        method: 'POST',
        url: '/api/remote-config/configs',
        body: {
          platform: 'android',
          app: 'designwiz',
          key: 'new_feature_flag',
          type: 'boolean',
          value: '1',
          is_active: true
        }
      });
      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.config.key, 'new_feature_flag');
    });

    it('allows unauthenticated PUT /api/remote-config/configs/:id (update)', async () => {
      const res = await dispatchRequest({
        method: 'PUT',
        url: '/api/remote-config/configs/101',
        body: {
          platform: 'android',
          app: 'designwiz',
          key: 'updated_feature_flag',
          type: 'number',
          value: '42',
          is_active: true
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.config.id, '101');
    });

    it('allows unauthenticated PATCH /api/remote-config/configs/:id/toggle (active toggle)', async () => {
      const res = await dispatchRequest({
        method: 'PATCH',
        url: '/api/remote-config/configs/101/toggle',
        body: {
          platform: 'android',
          app: 'designwiz',
          is_active: false
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.config.active, false);
    });

    it('allows unauthenticated DELETE /api/remote-config/configs/:id (delete)', async () => {
      const res = await dispatchRequest({
        method: 'DELETE',
        url: '/api/remote-config/configs/101',
        body: {
          platform: 'android',
          app: 'designwiz'
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });

    it('works across route aliases (/api/remote-configs and /api/remoteconfig)', async () => {
      const resAlias1 = await dispatchRequest({
        method: 'GET',
        url: '/api/remote-configs/applications?platform=android'
      });
      assert.strictEqual(resAlias1.status, 200);

      const resAlias2 = await dispatchRequest({
        method: 'GET',
        url: '/api/remoteconfig/applications?platform=android'
      });
      assert.strictEqual(resAlias2.status, 200);
    });
  });

  describe('2. Validation & Error Handling (Without Auth)', () => {
    it('returns 400 VALIDATION_ERROR on missing app slug', async () => {
      const res = await dispatchRequest({
        method: 'GET',
        url: '/api/remote-config/configs?platform=android'
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.type, 'VALIDATION_ERROR');
      assert.ok(res.body.error.includes('app'));
    });

    it('returns 400 VALIDATION_ERROR on missing key when creating config', async () => {
      const res = await dispatchRequest({
        method: 'POST',
        url: '/api/remote-config/configs',
        body: {
          platform: 'android',
          app: 'designwiz',
          key: '',
          type: 'string',
          value: 'test'
        }
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.type, 'VALIDATION_ERROR');
      assert.ok(res.body.error.includes('key'));
    });

    it('returns 400 VALIDATION_ERROR on unsupported platform', async () => {
      const res = await dispatchRequest({
        method: 'GET',
        url: '/api/remote-config/applications?platform=windows'
      });
      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.type, 'VALIDATION_ERROR');
      assert.ok(res.body.error.includes('Unsupported platform'));
    });
  });

  describe('3. Non-Remote-Config Protected Routes Still Strictly Require Authentication', () => {
    it('rejects unauthenticated GET /api/devices with 401 Unauthorized', async () => {
      const res = await dispatchRequest({
        method: 'GET',
        url: '/api/devices'
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.authenticated, false);
      assert.ok(res.body.error.includes('Authentication required'));
    });

    it('rejects unauthenticated GET /api/builds with 401 Unauthorized', async () => {
      const res = await dispatchRequest({
        method: 'GET',
        url: '/api/builds'
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.authenticated, false);
    });

    it('rejects unauthenticated POST /api/tests/run with 401 Unauthorized', async () => {
      const res = await dispatchRequest({
        method: 'POST',
        url: '/api/tests/run',
        body: { deviceId: 'emulator-5554' }
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.authenticated, false);
    });

    it('rejects unauthenticated POST /api/adb/relaunch with 401 Unauthorized', async () => {
      const res = await dispatchRequest({
        method: 'POST',
        url: '/api/adb/relaunch',
        body: { serial: 'emulator-5554' }
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.authenticated, false);
    });

    it('rejects unauthenticated GET /api/admin/users with 401 Unauthorized', async () => {
      const res = await dispatchRequest({
        method: 'GET',
        url: '/api/admin/users'
      });
      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.authenticated, false);
    });
  });

  describe('4. Authenticated Remote Config Access (With Token)', () => {
    it('allows authenticated users to access Remote Config without degradation', async () => {
      const token = jwt.sign(
        { id: 'user_123', name: 'Lead QA', email: 'qa@company.com', role: 'QA_ENGINEER' },
        config.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const res = await dispatchRequest({
        method: 'GET',
        url: '/api/remote-config/applications?platform=android',
        headers: {
          authorization: `Bearer ${token}`
        }
      });
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
    });
  });
});
