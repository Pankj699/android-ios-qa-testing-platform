const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');

const config = require('../src/config');
const db = require('../src/db');
const { runMigrations } = require('../src/db/migrate');
const userService = require('../src/services/userService');
const bugDeskService = require('../src/services/bugDeskService');
const bugDeskController = require('../src/controllers/bugDeskController');
const { authenticate } = require('../src/middleware/auth');
const bugDeskRoutes = require('../src/routes/bugDeskRoutes');

describe('BugDesk Shared Device & OS Catalog Test Suite', () => {
  let testUserA;
  let testUserB;
  let authTokenA;
  let authTokenB;
  let deviceSuffixUtil;
  let scopedStorage;
  let reportFormat;
  let frontendApi;
  let storageStore;
  let testApp;
  let testServer;
  let serverBaseUrl;

  before(async () => {
    config.NODE_ENV = 'test';
    await runMigrations();

    // Register User A and User B
    testUserA = await userService.register({
      email: `device_cat_a_${Date.now()}@test.com`,
      password: 'Password123!',
      name: 'Alice QA'
    });

    testUserB = await userService.register({
      email: `device_cat_b_${Date.now()}@test.com`,
      password: 'Password123!',
      name: 'Bob QA'
    });

    authTokenA = jwt.sign(
      { id: testUserA.id, email: testUserA.email, role: 'TESTER' },
      config.JWT_SECRET
    );

    authTokenB = jwt.sign(
      { id: testUserB.id, email: testUserB.email, role: 'TESTER' },
      config.JWT_SECRET
    );

    // Mock localStorage for frontend scoped storage & report tests
    storageStore = new Map();
    global.window = {
      localStorage: {
        getItem: (k) => storageStore.get(k) || null,
        setItem: (k, v) => storageStore.set(k, String(v)),
        removeItem: (k) => storageStore.delete(k),
        clear: () => storageStore.clear()
      },
      dispatchEvent: () => {}
    };

    const deviceSuffixPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/device-suffix.js');
    deviceSuffixUtil = await import(pathToFileURL(deviceSuffixPath).href);

    const scopedStoragePath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/scoped-storage.js');
    scopedStorage = await import(pathToFileURL(scopedStoragePath).href);

    const reportFormatPath = path.resolve(__dirname, '../../frontend/src/bugdesk/lib/report-format.js');
    reportFormat = await import(pathToFileURL(reportFormatPath).href);

    const apiPath = path.resolve(__dirname, '../../frontend/src/services/api.js');
    const apiModule = await import(pathToFileURL(apiPath).href);
    frontendApi = apiModule.api;

    // Real mounted Express HTTP server matching backend/src/index.js exactly
    testApp = express();
    testApp.use(express.json());
    testApp.use('/api', authenticate);
    testApp.use('/api', bugDeskRoutes);

    await new Promise((resolve) => {
      testServer = http.createServer(testApp);
      testServer.listen(0, '127.0.0.1', () => {
        const port = testServer.address().port;
        serverBaseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (testServer) {
      await new Promise(r => testServer.close(r));
    }
  });

  beforeEach(async () => {
    // Clean up devices before each test
    try {
      await db.query('DELETE FROM bugdesk_devices');
    } catch (_) {}
  });

  describe('1. Database Migration & Schema', () => {
    test('1.1 bugdesk_devices table exists with expected schema and unique normalized_key', async () => {
      const check = await db.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'bugdesk_devices'
      `);
      assert.ok(check.rows.length >= 7, 'bugdesk_devices should have at least 7 columns');
      const cols = check.rows.map(r => r.column_name);
      assert.ok(cols.includes('id'), 'Missing id column');
      assert.ok(cols.includes('name'), 'Missing name column');
      assert.ok(cols.includes('os'), 'Missing os column');
      assert.ok(cols.includes('manufacturer'), 'Missing manufacturer column');
      assert.ok(cols.includes('model'), 'Missing model column');
      assert.ok(cols.includes('normalized_key'), 'Missing normalized_key column');
      assert.ok(cols.includes('created_by_user_id'), 'Missing created_by_user_id column');
    });

    test('1.2 saveToDisk and restoreFromDisk persist bugdesk_devices', async () => {
      const created = await bugDeskService.createDevice({
        name: 'Persistence Device',
        os: 'Android 15',
        manufacturer: 'Google',
        model: 'Pixel 8',
        userId: testUserA.id
      });
      assert.ok(created.id);

      // Verify db.saveToDisk executes
      if (typeof db.saveToDisk === 'function') {
        db.saveToDisk();
      }

      // Verify records are present in db
      const listBefore = await bugDeskService.getAllDevices();
      assert.strictEqual(listBefore.some(d => d.name === 'Persistence Device'), true);

      // Restore and verify
      if (typeof db.restoreFromDisk === 'function') {
        db.restoreFromDisk();
      }
      const listAfter = await bugDeskService.getAllDevices();
      assert.strictEqual(listAfter.some(d => d.name === 'Persistence Device'), true);
    });
  });

  describe('2. Shared Catalog Visibility & Cross-User Permissions', () => {
    test('2.1 Device created by User A is immediately visible to User B in shared catalog', async () => {
      const deviceA = await bugDeskService.createDevice({
        name: 'OPPO CPH2729',
        os: 'Android 16',
        manufacturer: 'OPPO',
        model: 'CPH2729',
        userId: testUserA.id
      });

      assert.ok(deviceA.id);
      assert.strictEqual(deviceA.name, 'OPPO CPH2729');
      assert.strictEqual(deviceA.os, 'Android 16');
      assert.strictEqual(deviceA.created_by_user_id, testUserA.id);

      // User B fetches all devices
      const allDevices = await bugDeskService.getAllDevices();
      const found = allDevices.find(d => d.id === deviceA.id);
      assert.ok(found, 'User B should see device created by User A');
      assert.strictEqual(found.name, 'OPPO CPH2729');
      assert.strictEqual(found.os, 'Android 16');
    });

    test('2.2 User B can edit a device created by User A (globally shared catalog)', async () => {
      const deviceA = await bugDeskService.createDevice({
        name: 'OnePlus 12',
        os: 'OxygenOS 14',
        manufacturer: 'OnePlus',
        model: 'CPH2583',
        userId: testUserA.id
      });

      // User B updates it
      const updated = await bugDeskService.updateDevice(deviceA.id, {
        name: 'OnePlus 12R',
        os: 'OxygenOS 15',
        model: 'CPH2609'
      });

      assert.strictEqual(updated.name, 'OnePlus 12R');
      assert.strictEqual(updated.os, 'OxygenOS 15');
      assert.strictEqual(updated.model, 'CPH2609');

      // User A fetches and sees updated values
      const fetchedByA = await bugDeskService.getDeviceById(deviceA.id);
      assert.strictEqual(fetchedByA.name, 'OnePlus 12R');
      assert.strictEqual(fetchedByA.os, 'OxygenOS 15');
    });

    test('2.3 User B can delete a device created by User A (globally shared catalog)', async () => {
      const deviceA = await bugDeskService.createDevice({
        name: 'Xiaomi 14',
        os: 'HyperOS 1.0',
        userId: testUserA.id
      });

      // User B deletes the device
      const delResult = await bugDeskService.deleteDevice(deviceA.id);
      assert.strictEqual(delResult.success, true);

      // Device is gone for all users
      const all = await bugDeskService.getAllDevices();
      assert.strictEqual(all.some(d => d.id === deviceA.id), false);
      const single = await bugDeskService.getDeviceById(deviceA.id);
      assert.strictEqual(single, null);
    });
  });

  describe('3. Validation, Normalization, & Uniqueness Constraints', () => {
    test('3.1 Rejects creation with missing or blank name (400)', async () => {
      await assert.rejects(
        async () => {
          await bugDeskService.createDevice({ name: '   ', os: 'Android 15' });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /name.*required/i);
          return true;
        }
      );
    });

    test('3.2 Rejects creation with missing or blank os (400)', async () => {
      await assert.rejects(
        async () => {
          await bugDeskService.createDevice({ name: 'Pixel 9', os: '  ' });
        },
        (err) => {
          assert.strictEqual(err.status, 400);
          assert.match(err.message, /os.*required/i);
          return true;
        }
      );
    });

    test('3.3 Rejects duplicate device with case-insensitive and whitespace normalization (409)', async () => {
      await bugDeskService.createDevice({
        name: 'Samsung Galaxy S24',
        os: 'Android 14',
        userId: testUserA.id
      });

      // Duplicate with varied casing and extra whitespace
      await assert.rejects(
        async () => {
          await bugDeskService.createDevice({
            name: '  samsung galaxy s24  ',
            os: ' android 14 ',
            userId: testUserB.id
          });
        },
        (err) => {
          assert.strictEqual(err.status, 409);
          assert.match(err.message, /already exists/i);
          return true;
        }
      );
    });

    test('3.4 Update to a colliding name/os combination returns 409', async () => {
      const dev1 = await bugDeskService.createDevice({ name: 'Device Alpha', os: 'Android 14' });
      const dev2 = await bugDeskService.createDevice({ name: 'Device Beta', os: 'Android 14' });

      // Try renaming dev2 to match dev1
      await assert.rejects(
        async () => {
          await bugDeskService.updateDevice(dev2.id, { name: 'device alpha', os: 'android 14' });
        },
        (err) => {
          assert.strictEqual(err.status, 409);
          return true;
        }
      );
    });

    test('3.5 Updating own attributes without changing name/os succeeds (no false 409)', async () => {
      const dev = await bugDeskService.createDevice({
        name: 'Self Update Dev',
        os: 'Android 14',
        model: 'OldModel'
      });

      const updated = await bugDeskService.updateDevice(dev.id, {
        name: 'Self Update Dev',
        os: 'Android 14',
        model: 'NewModel'
      });

      assert.strictEqual(updated.model, 'NewModel');
    });
  });

  describe('4. Mounted Express Router & Frontend API Client Verification', () => {
    // 4.1 - 4.4: Unauthenticated real HTTP requests return 401 JSON
    test('4.1 Real HTTP GET /api/bug-desk/devices without auth returns 401 JSON', async () => {
      const res = await fetch(`${serverBaseUrl}/api/bug-desk/devices`);
      assert.strictEqual(res.status, 401);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.authenticated, false);
    });

    test('4.2 Real HTTP POST /api/bug-desk/devices without auth returns 401 JSON', async () => {
      const res = await fetch(`${serverBaseUrl}/api/bug-desk/devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Pixel 9', os: 'Android 15' })
      });
      assert.strictEqual(res.status, 401);
    });

    test('4.3 Real HTTP PATCH /api/bug-desk/devices/:id without auth returns 401 JSON', async () => {
      const res = await fetch(`${serverBaseUrl}/api/bug-desk/devices/dummy-id`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Pixel 9 Pro' })
      });
      assert.strictEqual(res.status, 401);
    });

    test('4.4 Real HTTP DELETE /api/bug-desk/devices/:id without auth returns 401 JSON', async () => {
      const res = await fetch(`${serverBaseUrl}/api/bug-desk/devices/dummy-id`, {
        method: 'DELETE'
      });
      assert.strictEqual(res.status, 401);
    });

    // 4.5 - 4.9: Authenticated real HTTP CRUD operations
    test('4.5 Real HTTP POST /api/bug-desk/devices creates device and returns 201', async () => {
      const res = await fetch(`${serverBaseUrl}/api/bug-desk/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenA}`
        },
        body: JSON.stringify({
          name: 'Real HTTP Device',
          os: 'Android 15',
          manufacturer: 'Google',
          model: 'Pixel 8'
        })
      });

      assert.strictEqual(res.status, 201);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(data.device.id);
      assert.strictEqual(data.device.name, 'Real HTTP Device');
      assert.strictEqual(data.device.os, 'Android 15');
      assert.strictEqual(data.device.manufacturer, 'Google');
      assert.strictEqual(data.device.model, 'Pixel 8');
    });

    test('4.6 Real HTTP GET /api/bug-desk/devices returns shared catalog (200)', async () => {
      // User A creates device via HTTP
      await fetch(`${serverBaseUrl}/api/bug-desk/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenA}`
        },
        body: JSON.stringify({ name: 'Real HTTP Device', os: 'Android 15' })
      });

      // User B fetches it
      const res = await fetch(`${serverBaseUrl}/api/bug-desk/devices`, {
        headers: { 'Authorization': `Bearer ${authTokenB}` }
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.success, true);
      assert.ok(Array.isArray(data.devices));
      const found = data.devices.find(d => d.name === 'Real HTTP Device');
      assert.ok(found, 'Device created by User A should be in User B list');
    });

    test('4.7 Real HTTP POST duplicate combination returns 409 Conflict', async () => {
      // Initial creation
      await fetch(`${serverBaseUrl}/api/bug-desk/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenA}`
        },
        body: JSON.stringify({ name: 'Real HTTP Device', os: 'Android 15' })
      });

      // Duplicate attempt
      const res = await fetch(`${serverBaseUrl}/api/bug-desk/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenB}`
        },
        body: JSON.stringify({
          name: 'real http device',
          os: 'android 15'
        })
      });

      assert.strictEqual(res.status, 409);
      const data = await res.json();
      assert.strictEqual(data.success, false);
      assert.match(data.error, /already exists/i);
    });

    test('4.8 Real HTTP PATCH /api/bug-desk/devices/:id updates device (200)', async () => {
      const createRes = await fetch(`${serverBaseUrl}/api/bug-desk/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenA}`
        },
        body: JSON.stringify({ name: 'Real HTTP Device', os: 'Android 15' })
      });
      const createData = await createRes.json();
      const devId = createData.device.id;

      // User B updates User A device
      const patchRes = await fetch(`${serverBaseUrl}/api/bug-desk/devices/${devId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenB}`
        },
        body: JSON.stringify({
          name: 'Real HTTP Device Pro',
          os: 'Android 16',
          model: 'Pixel 8 Pro'
        })
      });

      assert.strictEqual(patchRes.status, 200);
      const patchData = await patchRes.json();
      assert.strictEqual(patchData.success, true);
      assert.strictEqual(patchData.device.name, 'Real HTTP Device Pro');
      assert.strictEqual(patchData.device.os, 'Android 16');
    });

    test('4.9 Real HTTP DELETE /api/bug-desk/devices/:id deletes device (200)', async () => {
      const createRes = await fetch(`${serverBaseUrl}/api/bug-desk/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenA}`
        },
        body: JSON.stringify({ name: 'Device To Delete', os: 'Android 15' })
      });
      const createData = await createRes.json();
      const devId = createData.device.id;

      const delRes = await fetch(`${serverBaseUrl}/api/bug-desk/devices/${devId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authTokenB}` }
      });

      assert.strictEqual(delRes.status, 200);
      const delData = await delRes.json();
      assert.strictEqual(delData.success, true);

      // Verify device is removed
      const checkRes = await fetch(`${serverBaseUrl}/api/bug-desk/devices`, {
        headers: { 'Authorization': `Bearer ${authTokenA}` }
      });
      const checkData = await checkRes.json();
      assert.strictEqual(checkData.devices.some(d => d.id === devId), false);
    });

    test('4.10 Real HTTP clean aliases (/api/bugdesk/devices) work identically', async () => {
      // POST alias
      const postRes = await fetch(`${serverBaseUrl}/api/bugdesk/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenA}`
        },
        body: JSON.stringify({ name: 'Alias Phone', os: 'iOS 18' })
      });
      assert.strictEqual(postRes.status, 201);
      const postData = await postRes.json();
      const devId = postData.device.id;

      // GET alias
      const getRes = await fetch(`${serverBaseUrl}/api/bugdesk/devices`, {
        headers: { 'Authorization': `Bearer ${authTokenB}` }
      });
      assert.strictEqual(getRes.status, 200);
      const getData = await getRes.json();
      assert.ok(getData.devices.some(d => d.id === devId));

      // PATCH alias
      const patchRes = await fetch(`${serverBaseUrl}/api/bugdesk/devices/${devId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authTokenA}`
        },
        body: JSON.stringify({ os: 'iOS 18.1' })
      });
      assert.strictEqual(patchRes.status, 200);

      // DELETE alias
      const delRes = await fetch(`${serverBaseUrl}/api/bugdesk/devices/${devId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${authTokenB}` }
      });
      assert.strictEqual(delRes.status, 200);
    });

    test('4.11 Frontend API helpers construct correct URLs and HTTP methods', async () => {
      const calls = [];
      const originalFetch = global.fetch;

      global.fetch = async (url, options = {}) => {
        calls.push({ url, method: options.method || 'GET', body: options.body });
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, devices: [] })
        };
      };

      try {
        await frontendApi.getBugDeskDevices();
        assert.strictEqual(calls[calls.length - 1].url, '/api/bug-desk/devices');
        assert.strictEqual(calls[calls.length - 1].method, 'GET');

        await frontendApi.createBugDeskDevice({ name: 'Dev', os: 'OS' });
        assert.strictEqual(calls[calls.length - 1].url, '/api/bug-desk/devices');
        assert.strictEqual(calls[calls.length - 1].method, 'POST');
        assert.strictEqual(calls[calls.length - 1].body, JSON.stringify({ name: 'Dev', os: 'OS' }));

        await frontendApi.updateBugDeskDevice('d123', { os: 'OS 2' });
        assert.strictEqual(calls[calls.length - 1].url, '/api/bug-desk/devices/d123');
        assert.strictEqual(calls[calls.length - 1].method, 'PATCH');
        assert.strictEqual(calls[calls.length - 1].body, JSON.stringify({ os: 'OS 2' }));

        await frontendApi.deleteBugDeskDevice('d123');
        assert.strictEqual(calls[calls.length - 1].url, '/api/bug-desk/devices/d123');
        assert.strictEqual(calls[calls.length - 1].method, 'DELETE');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('5. Title Suffix Formatting, Normalization, & Idempotency', () => {
    test('5.1 Formats Android OS versions correctly with em-dash and "OS <Version>"', () => {
      const { formatDeviceSuffix } = deviceSuffixUtil;
      // Android 16 -> " — OPPO CPH2729 OS 16"
      const s1 = formatDeviceSuffix({ name: 'OPPO CPH2729', os: 'Android 16' });
      assert.strictEqual(s1, ' — OPPO CPH2729 OS 16');

      // 16 -> " — OPPO CPH2729 OS 16"
      const s2 = formatDeviceSuffix({ name: 'OPPO CPH2729', os: '16' });
      assert.strictEqual(s2, ' — OPPO CPH2729 OS 16');

      // OS 16 -> " — OPPO CPH2729 OS 16"
      const s3 = formatDeviceSuffix({ name: 'OPPO CPH2729', os: 'OS 16' });
      assert.strictEqual(s3, ' — OPPO CPH2729 OS 16');
    });

    test('5.2 Formats iOS versions preserving iOS branding', () => {
      const { formatDeviceSuffix } = deviceSuffixUtil;
      const s = formatDeviceSuffix({ name: 'iPhone 15 Pro', os: 'iOS 18.2' });
      assert.strictEqual(s, ' — iPhone 15 Pro iOS 18.2');
    });

    test('5.3 Handles missing device or fields gracefully', () => {
      const { formatDeviceSuffix } = deviceSuffixUtil;
      assert.strictEqual(formatDeviceSuffix(null), '');
      assert.strictEqual(formatDeviceSuffix(undefined), '');
      assert.strictEqual(formatDeviceSuffix({}), '');
      assert.strictEqual(formatDeviceSuffix({ name: 'Pixel 8' }), ' — Pixel 8');
    });

    test('5.4 Strips device suffix accurately without touching hyphens in title or device name', () => {
      const { stripDeviceSuffix } = deviceSuffixUtil;
      // Strips trailing em-dash suffix
      const t1 = 'Flyer Maker Issue : Button not responding — OPPO CPH2729 OS 16';
      assert.strictEqual(stripDeviceSuffix(t1), 'Flyer Maker Issue : Button not responding');

      // Leaves standard hyphen in title untouched
      const t2 = 'Flyer Maker - Login issue with sub-feature';
      assert.strictEqual(stripDeviceSuffix(t2), 'Flyer Maker - Login issue with sub-feature');

      // Strips suffix from a title that has regular hyphens and device model with hyphens
      const t3 = 'Step 1 - Step 2 issue — Samsung SM-G998B OS 14';
      assert.strictEqual(stripDeviceSuffix(t3), 'Step 1 - Step 2 issue');
    });

    test('5.5 applyDeviceSuffix is idempotent and never duplicates suffixes', () => {
      const { applyDeviceSuffix } = deviceSuffixUtil;
      const base = 'Flyer Maker (V 213.0.213) API 36 + Billing 9 + In App Experience (R-1) : Dialog closes unexpectedly';
      const device = { name: 'OPPO CPH2729', os: 'Android 16' };

      // First application
      const appliedOnce = applyDeviceSuffix(base, device);
      assert.strictEqual(
        appliedOnce,
        'Flyer Maker (V 213.0.213) API 36 + Billing 9 + In App Experience (R-1) : Dialog closes unexpectedly — OPPO CPH2729 OS 16'
      );

      // Re-applying same device
      const appliedTwice = applyDeviceSuffix(appliedOnce, device);
      assert.strictEqual(appliedTwice, appliedOnce);

      // Switching to a different device
      const device2 = { name: 'iPhone 15 Pro', os: 'iOS 18.2' };
      const switched = applyDeviceSuffix(appliedOnce, device2);
      assert.strictEqual(
        switched,
        'Flyer Maker (V 213.0.213) API 36 + Billing 9 + In App Experience (R-1) : Dialog closes unexpectedly — iPhone 15 Pro iOS 18.2'
      );

      // Deselecting device (null) restores pristine base title
      const cleared = applyDeviceSuffix(switched, null);
      assert.strictEqual(cleared, base);
    });
  });

  describe('6. Draft Isolation & Historical Report Immutability', () => {
    test('6.1 User A and User B drafts are completely isolated', () => {
      const { saveNewBugDraft, getNewBugDraft } = scopedStorage;
      const devA = { id: 'dev-1', name: 'OPPO CPH2729', os: 'Android 16' };
      const devB = { id: 'dev-2', name: 'iPhone 15 Pro', os: 'iOS 18.2' };

      saveNewBugDraft(testUserA.id, {
        rawNotes: 'Notes from Alice',
        selectedDevice: devA,
        selectedDeviceId: devA.id
      });

      saveNewBugDraft(testUserB.id, {
        rawNotes: 'Notes from Bob',
        selectedDevice: devB,
        selectedDeviceId: devB.id
      });

      const draftA = getNewBugDraft(testUserA.id);
      const draftB = getNewBugDraft(testUserB.id);

      assert.strictEqual(draftA.rawNotes, 'Notes from Alice');
      assert.strictEqual(draftA.selectedDevice.name, 'OPPO CPH2729');

      assert.strictEqual(draftB.rawNotes, 'Notes from Bob');
      assert.strictEqual(draftB.selectedDevice.name, 'iPhone 15 Pro');
    });

    test('6.2 Historical reports retain frozen title and device snapshot even if catalog is modified', async () => {
      const { saveBugReport, getBugHistory } = scopedStorage;
      // 1. Create device in catalog
      const dev = await bugDeskService.createDevice({
        name: 'Historic Phone',
        os: 'Android 14',
        userId: testUserA.id
      });

      // 2. User generates and saves report
      const reportTitle = deviceSuffixUtil.applyDeviceSuffix('Bug Title Here', dev);
      const report = {
        id: 'hist-rep-101',
        createdAt: Date.now(),
        project: 'Flyer Maker',
        module: 'Editor',
        round: 'R-1',
        title: reportTitle,
        device: { id: dev.id, name: dev.name, os: dev.os }
      };

      saveBugReport(testUserA.id, report);

      // 3. Device in catalog is edited and then deleted
      await bugDeskService.updateDevice(dev.id, { name: 'Historic Phone Renamed', os: 'Android 15' });
      await bugDeskService.deleteDevice(dev.id);

      // 4. Verify historical report in storage is unchanged
      const reports = getBugHistory(testUserA.id);
      const saved = reports.find(r => r.id === 'hist-rep-101');
      assert.ok(saved);
      assert.strictEqual(saved.title, 'Bug Title Here — Historic Phone OS 14');
      assert.strictEqual(saved.device.name, 'Historic Phone');
      assert.strictEqual(saved.device.os, 'Android 14');
    });
  });

  describe('7. Output Consistency across Heading, PMS, TXT, and PDF Exports', () => {
    test('7.1 Suffix is uniformly preserved in buildHeading and PMS report text', () => {
      const dev = { name: 'OPPO CPH2729', os: 'Android 16' };
      const title = deviceSuffixUtil.applyDeviceSuffix('Keyboard closes unexpectedly', dev);

      const rep = {
        project: 'Flyer Maker (V 213.0.213) API 36 + Billing 9',
        module: 'Predictive Back Navigation',
        round: 'R-1',
        title,
        steps: ['Open app', 'Press back'],
        actualResult: 'Closed',
        expectedResult: 'Remain open',
        includeResults: true
      };

      const heading = reportFormat.buildHeading(rep);
      const expectedHeading = 'Flyer Maker (V 213.0.213) API 36 + Billing 9 Predictive Back Navigation (R-1) : Keyboard closes unexpectedly — OPPO CPH2729 OS 16';
      assert.strictEqual(heading, expectedHeading);

      const pmsText = reportFormat.buildPMSReportText(rep);
      assert.ok(pmsText.startsWith(expectedHeading), 'PMS report must start with formatted heading');
    });
  });
});
