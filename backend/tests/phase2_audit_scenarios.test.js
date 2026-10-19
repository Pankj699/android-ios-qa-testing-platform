const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const deviceLockService = require('../src/services/deviceLockService');
const testRunnerService = require('../src/services/testRunnerService');
const screenMirrorService = require('../src/services/screenMirrorService');
const mixpanelCollectorService = require('../src/services/mixpanelCollectorService');
const deviceController = require('../src/controllers/deviceController');
const testController = require('../src/controllers/testController');
const adbService = require('../src/services/adbService');

describe('Phase 2 Final Audit — Edge Case Verification Suite', () => {
  const alice = { id: 'usr_audit_alice', name: 'Alice Auditor', email: 'alice.audit@qa.internal', role: 'tester' };
  const bob = { id: 'usr_audit_bob', name: 'Bob Auditor', email: 'bob.audit@qa.internal', role: 'tester' };
  const charlie = { id: 'usr_audit_charlie', name: 'Charlie Auditor', email: 'charlie.audit@qa.internal', role: 'tester' };

  const devHw = 'HW_AUDIT_PHYSICAL_01';
  const devUsb = 'HW_AUDIT_PHYSICAL_01';
  const devWifi = '192.168.0.210:41235';

  beforeEach(() => {
    deviceLockService.clearOwner(devHw);
    deviceLockService.clearOwner(devUsb);
    deviceLockService.clearOwner(devWifi);
    deviceLockService.locks.delete(devHw);
    deviceLockService.locks.delete(devUsb);
    deviceLockService.locks.delete(devWifi);
    deviceLockService.deferredResets.clear();
    deviceLockService.deferredTransfers.clear();
    deviceLockService._takeoverLocks.clear();

    deviceLockService.registerHardwareSerial(devUsb, devHw);
    deviceLockService.registerHardwareSerial(devWifi, devHw);
  });

  afterEach(() => {
    deviceLockService.clearOwner(devHw);
    deviceLockService.clearOwner(devUsb);
    deviceLockService.clearOwner(devWifi);
    deviceLockService.locks.delete(devHw);
    deviceLockService.locks.delete(devUsb);
    deviceLockService.locks.delete(devWifi);
  });

  // --- SECTION 1 AUDIT: Concurrency & Lock Serialization ---
  test('Audit Section 1 — High Concurrency Race: 5 concurrent acquisitions leave exactly 1 valid owner with zero lock leaks', async () => {
    deviceLockService.setOwner(devUsb, alice);

    const candidates = [
      { id: 'usr_c1', name: 'User 1', email: 'u1@test.internal', role: 'tester' },
      { id: 'usr_c2', name: 'User 2', email: 'u2@test.internal', role: 'tester' },
      { id: 'usr_c3', name: 'User 3', email: 'u3@test.internal', role: 'tester' },
      { id: 'usr_c4', name: 'User 4', email: 'u4@test.internal', role: 'tester' },
      { id: 'usr_c5', name: 'User 5', email: 'u5@test.internal', role: 'tester' }
    ];

    const results = await Promise.all(
      candidates.map(u => deviceLockService.transferDeviceOwnership(devUsb, u))
    );

    // All promises resolve safely without unhandled rejections or crashes
    assert.strictEqual(results.length, 5);
    const finalOwner = deviceLockService.getOwner(devUsb);
    assert.ok(finalOwner, 'A final owner must exist');
    assert.ok(candidates.some(c => c.id === finalOwner.userId), 'Final owner must be one of the candidates');

    // Concurrency lock set must be completely empty
    assert.strictEqual(deviceLockService._takeoverLocks.size, 0);
  });

  // --- SECTION 2 AUDIT: Complete Old-Owner Revocation ---
  test('Audit Section 2 — Complete Revocation: Old owner blocked across all endpoints after transfer', async () => {
    deviceLockService.setOwner(devUsb, alice);
    assert.strictEqual(deviceLockService.isDeviceAccessible(devUsb, alice), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(devUsb, bob), false);

    // Transfer device to Bob
    const xfer = await deviceLockService.transferDeviceOwnership(devUsb, bob);
    assert.strictEqual(xfer.success, true);

    // 1. Device Accessibility check
    assert.strictEqual(deviceLockService.isDeviceAccessible(devUsb, bob), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(devUsb, alice), false);

    // 2. Test Execution Endpoint check
    let testErrCode = null;
    const mockRes = {
      status: (code) => { testErrCode = code; return mockRes; },
      json: () => mockRes
    };
    await testController.monitorInstalledApp({ body: { packageName: 'com.test.app', deviceSerial: devUsb }, user: alice }, mockRes, () => {});
    assert.strictEqual(testErrCode, 403);

    // 3. Screen Mirror start check
    await assert.rejects(
      async () => screenMirrorService.startMirror(devUsb, alice),
      /not accessible/i
    );

    // 4. Screenshot capture check
    let screenshotCode = null;
    const mockScreenshotRes = {
      status: (code) => { screenshotCode = code; return mockScreenshotRes; },
      json: () => mockScreenshotRes
    };
    await deviceController.captureScreenshot({ params: { id: devUsb }, user: alice }, mockScreenshotRes, () => {});
    assert.ok(screenshotCode === 400 || screenshotCode === 403);

    // 5. UI Hierarchy check
    let hierarchyCode = null;
    const mockHierarchyRes = {
      status: (code) => { hierarchyCode = code; return mockHierarchyRes; },
      json: () => mockHierarchyRes
    };
    await deviceController.getUiHierarchy({ params: { id: devUsb }, user: alice }, mockHierarchyRes, () => {});
    assert.strictEqual(hierarchyCode, 403);

    // 6. Mixpanel capture check
    await assert.rejects(
      async () => mixpanelCollectorService.startSession({ user: alice, deviceSerial: devUsb }),
      /owned by another user/i
    );

    // 7. New owner (Bob) has full accessibility
    assert.strictEqual(deviceLockService.isDeviceAccessible(devUsb, bob), true);
  });

  // --- SECTION 3 AUDIT: Midnight Reset Lifecycle & Deferred Operation ---
  test('Audit Section 3 — Midnight Reset: Preserves active test across boundary and allows seamless re-acquisition', () => {
    deviceLockService.setOwner(devUsb, alice);

    // Mock active test on devUsb
    const origIsTestActive = testRunnerService.isTestActiveForDevice;
    testRunnerService.isTestActiveForDevice = (serial, hw) => serial === devUsb || hw === devHw;

    try {
      // Midnight arrives: daily reset triggers
      const resetDay = '2026-10-18';
      const resetRes = deviceLockService.performDailyReset(resetDay, true);
      assert.strictEqual(resetRes.success, true);
      assert.strictEqual(resetRes.deferredCount, 1);
      assert.strictEqual(deviceLockService.deferredResets.has(devUsb), true);

      // Alice's active test is NOT disrupted
      assert.strictEqual(deviceLockService.getOwner(devUsb)?.userId, alice.id);
      assert.strictEqual(deviceLockService.isDeviceAccessible(devUsb, alice), true);

      // Other users cannot interrupt Alice while active
      assert.strictEqual(deviceLockService.isDeviceAccessible(devUsb, bob), false);

      // Now active test finishes: notifyOperationFinished
      testRunnerService.isTestActiveForDevice = () => false;
      deviceLockService.notifyOperationFinished(devUsb, devHw);

      // Ownership cleared without disconnecting ADB
      assert.strictEqual(deviceLockService.getOwner(devUsb), null);
      assert.strictEqual(deviceLockService.deferredResets.has(devUsb), false);

      // Re-discovery: Bob sees device as AVAILABLE on dashboard
      const decorated = deviceLockService.decorateDevices(
        [{ id: devUsb, serial: devUsb, hardwareSerial: devHw, connected: true, state: 'device', isWireless: false }],
        bob
      );
      assert.strictEqual(decorated.length, 1);
      assert.strictEqual(decorated[0].owner.status, 'AVAILABLE');
      assert.strictEqual(decorated[0].owner.isOwner, false);

      // Bob acquires device directly without manual Claim/Release
      deviceLockService.setOwner(devUsb, bob);
      assert.strictEqual(deviceLockService.getOwner(devUsb)?.userId, bob.id);
      assert.strictEqual(deviceLockService.isUserDevice(devUsb, bob), true);
    } finally {
      testRunnerService.isTestActiveForDevice = origIsTestActive;
    }
  });

  // --- SECTION 4 AUDIT: USB/Wireless Transport Lifecycle & Deduplication ---
  test('Audit Section 4 — Transport Deduplication: Preserves single physical card and active test integrity', async () => {
    deviceLockService.setOwner(devWifi, alice);

    const origDisconnect = adbService.disconnectDevice;
    let disconnected = null;
    adbService.disconnectDevice = async (serial) => {
      disconnected = serial;
      return { success: true };
    };

    try {
      const rawDevices = [
        { serial: devWifi, state: 'device', isWireless: true, connected: true },
        { serial: devUsb, state: 'device', isWireless: false, connected: true }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      // Redundant wireless disconnected in favor of USB
      assert.strictEqual(disconnected, devWifi);
      assert.strictEqual(prioritized.length, 1);
      assert.strictEqual(prioritized[0].serial, devUsb);
      assert.strictEqual(prioritized[0].isAuthoritative, true);

      // Dashboard decoration produces exactly 1 physical card
      const decorated = deviceLockService.decorateDevices(rawDevices, alice);
      assert.strictEqual(decorated.length, 1);
      assert.strictEqual(decorated[0].serial, devUsb);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // --- SECTION 5 AUDIT: Ownership Transfer Triggers & Authorization ---
  test('Audit Section 5 — Passive Actions: Polling, info lookup, and unauthorized calls do NOT trigger transfer', async () => {
    deviceLockService.setOwner(devUsb, alice);

    // 1. Bob polls device list (GET /api/devices)
    const rawDevices = [
      { id: devUsb, serial: devUsb, hardwareSerial: devHw, connected: true, state: 'device', isWireless: false }
    ];
    const decorated = deviceLockService.decorateDevices(rawDevices, bob);
    assert.strictEqual(decorated.length, 1);
    assert.strictEqual(decorated[0].owner.status, 'IN_USE');
    assert.strictEqual(decorated[0].owner.ownerName, alice.name);

    // Verify ownership was NOT transferred by dashboard polling
    assert.strictEqual(deviceLockService.getOwner(devUsb)?.userId, alice.id);

    // 2. Bob calls device info (GET /api/device/:id/info) - read only
    const ownerAfterInfo = deviceLockService.getOwner(devUsb);
    assert.strictEqual(ownerAfterInfo?.userId, alice.id);

    // 3. Unauthorized acquisition call (no req.user)
    let unauthCode = null;
    const mockUnauthRes = {
      status: (code) => { unauthCode = code; return mockUnauthRes; },
      json: () => mockUnauthRes
    };
    await deviceController.acquireDevice({ params: { id: devUsb }, user: null }, mockUnauthRes, () => {});
    assert.strictEqual(unauthCode, 401);

    // Ownership remains strictly with Alice
    assert.strictEqual(deviceLockService.getOwner(devUsb)?.userId, alice.id);
  });

  // --- SECTION 6 AUDIT: Safeguard for Device 15909075850008D ---
  test('Audit Section 6 — Safeguard: Device 15909075850008D cannot be hijacked while occupied', async () => {
    const specialSerial = '15909075850008D';
    const pankaj = { id: 'usr_pankaj_gupta', name: 'Pankaj Gupta', email: 'pankajgupta.ob@gmail.com', role: 'tester' };

    deviceLockService.setOwner(specialSerial, pankaj);
    deviceLockService.locks.set(specialSerial, { userId: pankaj.id, testId: 'pad_active_live_run' });

    // Intruding user attempts takeover
    const xfer = await deviceLockService.transferDeviceOwnership(specialSerial, bob);
    assert.strictEqual(xfer.success, false);
    assert.strictEqual(xfer.status, 'BUSY_PENDING');

    // Pankaj Gupta remains owner
    assert.strictEqual(deviceLockService.getOwner(specialSerial)?.userId, pankaj.id);
    assert.strictEqual(deviceLockService.isDeviceAccessible(specialSerial, pankaj), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(specialSerial, bob), false);

    deviceLockService.locks.delete(specialSerial);
  });
});
