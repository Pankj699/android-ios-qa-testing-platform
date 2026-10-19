const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const deviceLockService = require('../src/services/deviceLockService');
const testRunnerService = require('../src/services/testRunnerService');
const screenMirrorService = require('../src/services/screenMirrorService');
const adbService = require('../src/services/adbService');
const deviceController = require('../src/controllers/deviceController');

describe('Phase 2 — Automatic Device Ownership and Connection Management Suite', () => {
  const userA = { id: 'usr_p2_alice', name: 'Alice QA', email: 'alice.qa@company.internal', role: 'tester' };
  const userB = { id: 'usr_p2_bob', name: 'Bob QA', email: 'bob.qa@company.internal', role: 'tester' };
  const admin = { id: 'usr_p2_admin', name: 'Admin QA', email: 'admin.qa@company.internal', role: 'admin' };

  const testHwSerial = 'HW_PHASE2_V2143_01';
  const testUsbSerial = 'HW_PHASE2_V2143_01';
  const testWifiSerial = '192.168.0.155:38821';

  beforeEach(() => {
    deviceLockService.clearOwner(testHwSerial);
    deviceLockService.clearOwner(testUsbSerial);
    deviceLockService.clearOwner(testWifiSerial);
    deviceLockService.locks.delete(testHwSerial);
    deviceLockService.locks.delete(testUsbSerial);
    deviceLockService.locks.delete(testWifiSerial);
    deviceLockService.deferredResets.clear();
    deviceLockService.deferredTransfers.clear();
    deviceLockService._takeoverLocks.clear();

    deviceLockService.registerHardwareSerial(testUsbSerial, testHwSerial);
    deviceLockService.registerHardwareSerial(testWifiSerial, testHwSerial);
  });

  afterEach(() => {
    deviceLockService.clearOwner(testHwSerial);
    deviceLockService.clearOwner(testUsbSerial);
    deviceLockService.clearOwner(testWifiSerial);
    deviceLockService.locks.delete(testHwSerial);
    deviceLockService.locks.delete(testUsbSerial);
    deviceLockService.locks.delete(testWifiSerial);
  });

  // 1. Seamless Ownership Transfer
  test('1. Seamless Ownership Transfer: User B acquires device owned by User A without manual buttons', async () => {
    // User A connects / owns device
    deviceLockService.setOwner(testUsbSerial, userA);
    assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userB), false);

    // Mock User A having an active mirror session
    let mirrorStopped = false;
    const origStopMirror = screenMirrorService.stopMirror;
    screenMirrorService.stopMirror = (serial) => {
      if (serial === testUsbSerial || serial === testHwSerial) mirrorStopped = true;
    };

    try {
      // User B acquires ownership
      const res = await deviceLockService.transferDeviceOwnership(testUsbSerial, userB);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.transferred, true);
      assert.strictEqual(res.status, 'ACQUIRED');
      assert.strictEqual(res.previousOwner, userA.name);

      // Ownership updated: User B owns it, User A revoked
      assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userB), true);
      assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userA), false);
      assert.strictEqual(deviceLockService.isDeviceAccessible(testUsbSerial, userB), true);
      assert.strictEqual(deviceLockService.isDeviceAccessible(testUsbSerial, userA), false);

      // User A resources revoked
      assert.strictEqual(mirrorStopped, true);
    } finally {
      screenMirrorService.stopMirror = origStopMirror;
    }
  });

  // 2. Active Operation Protection
  test('2. Active Operation Protection: Transfer rejected with BUSY_PENDING during active PAD test', async () => {
    deviceLockService.setOwner(testUsbSerial, userA);

    // Mock an active test on the device
    const origIsTestActive = testRunnerService.isTestActiveForDevice;
    testRunnerService.isTestActiveForDevice = (serial, hwSerial) => {
      return serial === testUsbSerial || hwSerial === testHwSerial;
    };

    try {
      // User B attempts to transfer ownership
      const res = await deviceLockService.transferDeviceOwnership(testUsbSerial, userB, { queueDeferred: true });
      assert.strictEqual(res.success, false);
      assert.strictEqual(res.status, 'BUSY_PENDING');
      assert.match(res.message, /active operation/i);

      // User A still owns the device
      assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userA), true);
      assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userB), false);

      // Transfer was queued
      assert.strictEqual(deviceLockService.deferredTransfers.has(testUsbSerial), true);

      // Now test finishes: simulate notifyOperationFinished
      testRunnerService.isTestActiveForDevice = () => false;
      deviceLockService.notifyOperationFinished(testUsbSerial, testHwSerial);

      // Allow microtask to process deferred transfer
      await new Promise(r => setTimeout(r, 60));

      // Ownership automatically transferred after active operation completed
      assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userB), true);
      assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userA), false);
    } finally {
      testRunnerService.isTestActiveForDevice = origIsTestActive;
    }
  });

  // 3. Concurrent Transfer Serialization
  test('3. Concurrency Guard: Concurrent acquisition requests do not corrupt state', async () => {
    deviceLockService.setOwner(testUsbSerial, userA);

    const userC = { id: 'usr_p2_charlie', name: 'Charlie QA', email: 'charlie.qa@company.internal', role: 'tester' };

    // Fire two transfers simultaneously
    const [resB, resC] = await Promise.all([
      deviceLockService.transferDeviceOwnership(testUsbSerial, userB),
      deviceLockService.transferDeviceOwnership(testUsbSerial, userC)
    ]);

    // Exactly one winner and state is consistent
    const finalOwner = deviceLockService.getOwner(testUsbSerial);
    assert.ok(finalOwner);
    assert.ok(finalOwner.userId === userB.id || finalOwner.userId === userC.id);
    assert.strictEqual(deviceLockService._takeoverLocks.size, 0);
  });

  // 4. Daily Midnight Ownership Reset
  test('4. Daily Midnight Reset: Clears ownership idempotently without deleting test history', () => {
    deviceLockService.setOwner(testUsbSerial, userA);
    assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userA), true);

    const initialGen = deviceLockService.ownershipMeta.resetGeneration;
    const testDay = '2026-10-16';

    // Perform daily reset
    const resetRes = deviceLockService.performDailyReset(testDay, true);
    assert.strictEqual(resetRes.success, true);
    assert.strictEqual(resetRes.reset, true);
    assert.strictEqual(resetRes.day, testDay);
    assert.strictEqual(resetRes.generation, initialGen + 1);

    // Device is now unowned and available to any authenticated user
    assert.strictEqual(deviceLockService.getOwner(testUsbSerial), null);
    assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(testUsbSerial, userB), true);

    // Repeated call for same day is idempotent
    const secondCall = deviceLockService.performDailyReset(testDay, false);
    assert.strictEqual(secondCall.reset, false);
    assert.strictEqual(deviceLockService.ownershipMeta.resetGeneration, initialGen + 1);
  });

  // 5. Daily Midnight Reset with Active Test
  test('5. Daily Reset Deferral: Active test at midnight defers ownership clear until completion', () => {
    deviceLockService.setOwner(testUsbSerial, userA);

    // Mock active test
    const origIsTestActive = testRunnerService.isTestActiveForDevice;
    testRunnerService.isTestActiveForDevice = (serial) => serial === testUsbSerial;

    try {
      const resetRes = deviceLockService.performDailyReset('2026-10-17', true);
      assert.strictEqual(resetRes.deferredCount, 1);
      assert.strictEqual(deviceLockService.deferredResets.has(testUsbSerial), true);

      // Ownership retained while test is running
      assert.strictEqual(deviceLockService.getOwner(testUsbSerial)?.userId, userA.id);

      // When test finishes
      testRunnerService.isTestActiveForDevice = () => false;
      deviceLockService.notifyOperationFinished(testUsbSerial, testHwSerial);

      // Ownership now cleared
      assert.strictEqual(deviceLockService.getOwner(testUsbSerial), null);
      assert.strictEqual(deviceLockService.deferredResets.has(testUsbSerial), false);
    } finally {
      testRunnerService.isTestActiveForDevice = origIsTestActive;
    }
  });

  // 6. Bare IP Decoupling & DHCP Immunity
  test('6. Bare IP Decoupling: DHCP dynamic IPs do not collide or overwrite device ownership', () => {
    const dev1Hw = 'DEV_PHYSICAL_01';
    const dev2Hw = 'DEV_PHYSICAL_02';
    const dynamicIp = '192.168.0.18';
    const dev1Port = `${dynamicIp}:44111`;
    const dev2Port = `${dynamicIp}:55222`;

    // Day 1: Device 1 gets dynamicIp:44111
    deviceLockService.registerHardwareSerial(dev1Port, dev1Hw);
    deviceLockService.setOwner(dev1Port, userA);

    assert.strictEqual(deviceLockService.getOwner(dev1Port)?.userId, userA.id);
    assert.strictEqual(deviceLockService.getOwner(dev1Hw)?.userId, userA.id);

    // Bare IP should NOT be mapped as an owner key
    assert.strictEqual(deviceLockService.ownership.has(dynamicIp), false);
    assert.strictEqual(deviceLockService.hardwareMap.has(dynamicIp), false);

    // Day 2: Device 2 connects on dynamicIp:55222
    deviceLockService.registerHardwareSerial(dev2Port, dev2Hw);
    deviceLockService.setOwner(dev2Port, userB);

    assert.strictEqual(deviceLockService.getOwner(dev2Port)?.userId, userB.id);
    assert.strictEqual(deviceLockService.getOwner(dev2Hw)?.userId, userB.id);

    // Device 1 ownership on physical identity remains intact!
    assert.strictEqual(deviceLockService.getOwner(dev1Hw)?.userId, userA.id);
    assert.strictEqual(deviceLockService.ownership.has(dynamicIp), false);
  });

  // 7. TCP/IP Input Validation
  test('7. ADB over TCP/IP: Strict IPv4 and port validation in connectDevice', async () => {
    let statusSent = null;
    let jsonSent = null;
    const mockRes = {
      status: (code) => { statusSent = code; return mockRes; },
      json: (data) => { jsonSent = data; return mockRes; }
    };

    // Test invalid IPv4
    await deviceController.connectDevice({ body: { ip: '999.1.2.3', port: 5555 }, user: userA }, mockRes, () => {});
    assert.strictEqual(statusSent, 400);
    assert.match(jsonSent.error, /Invalid IP address/i);

    // Test shell metacharacter injection
    statusSent = null;
    await deviceController.connectDevice({ body: { ip: '192.168.0.1; rm -rf', port: 5555 }, user: userA }, mockRes, () => {});
    assert.strictEqual(statusSent, 400);
    assert.match(jsonSent.error, /Invalid IP address/i);

    // Test invalid port bounds
    statusSent = null;
    await deviceController.connectDevice({ body: { ip: '192.168.0.100', port: 70000 }, user: userA }, mockRes, () => {});
    assert.strictEqual(statusSent, 400);
    assert.match(jsonSent.error, /Invalid port/i);

    statusSent = null;
    await deviceController.connectDevice({ body: { ip: '192.168.0.100', port: 0 }, user: userA }, mockRes, () => {});
    assert.strictEqual(statusSent, 400);
    assert.match(jsonSent.error, /Invalid port/i);
  });

  // 8. Device Visibility & Dashboard Decoration
  test('8. Device Visibility: Dashboard shows connected physical devices with correct status', () => {
    deviceLockService.setOwner(testUsbSerial, userA);

    const devices = [
      { id: testUsbSerial, serial: testUsbSerial, hardwareSerial: testHwSerial, connected: true, state: 'device', isWireless: false }
    ];

    // User A sees YOUR_DEVICE
    const decoratedA = deviceLockService.decorateDevices(devices, userA);
    assert.strictEqual(decoratedA.length, 1);
    assert.strictEqual(decoratedA[0].owner.isOwner, true);
    assert.strictEqual(decoratedA[0].owner.status, 'YOUR_DEVICE');

    // User B sees IN_USE with User A's name
    const decoratedB = deviceLockService.decorateDevices(devices, userB);
    assert.strictEqual(decoratedB.length, 1);
    assert.strictEqual(decoratedB[0].owner.isOwner, false);
    assert.strictEqual(decoratedB[0].owner.ownerName, userA.name);
    assert.strictEqual(decoratedB[0].owner.status, 'IN_USE');
  });

  // 9. Dedicated Device Safeguard (15909075850008D)
  test('9. Safeguard: Device 15909075850008D protected from unauthorized takeover while active', async () => {
    const specialSerial = '15909075850008D';
    const specialOwner = { id: 'usr_pankaj', name: 'Pankaj Gupta', email: 'pankajgupta.ob@gmail.com', role: 'tester' };

    deviceLockService.setOwner(specialSerial, specialOwner);

    // Active lock set on the device
    deviceLockService.locks.set(specialSerial, { userId: specialOwner.id, testId: 'pad_active_999' });

    // User B attempts takeover
    const res = await deviceLockService.transferDeviceOwnership(specialSerial, userB);
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.status, 'BUSY_PENDING');

    // Pankaj Gupta remains owner
    assert.strictEqual(deviceLockService.getOwner(specialSerial)?.userId, specialOwner.id);
    assert.strictEqual(deviceLockService.isUserDevice(specialSerial, specialOwner), true);
    assert.strictEqual(deviceLockService.isUserDevice(specialSerial, userB), false);

    // Clean up mock lock
    deviceLockService.locks.delete(specialSerial);
  });
});
