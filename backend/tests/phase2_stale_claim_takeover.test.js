const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const deviceLockService = require('../src/services/deviceLockService');
const screenMirrorService = require('../src/services/screenMirrorService');
const testRunnerService = require('../src/services/testRunnerService');

describe('Phase 2 — Connection Ownership & Multi-User Isolation Suite', () => {
  const userA = { id: 'usr_phase2_a', name: 'User A', email: 'usera@qa.internal', role: 'tester' };
  const userB = { id: 'usr_phase2_b', name: 'User B', email: 'userb@qa.internal', role: 'tester' };
  const userC = { id: 'usr_phase2_c', name: 'User C', email: 'userc@qa.internal', role: 'tester' };

  const serial1 = '192.168.0.50:41001';
  const serial1Rotated = '192.168.0.50:49222';
  const hwSerial1 = '15909075850008D';

  const serial2 = '192.168.0.60:42002';
  const hwSerial2 = 'RZGL30DK6AM';

  beforeEach(() => {
    deviceLockService.clearOwner(serial1);
    deviceLockService.clearOwner(serial1Rotated);
    deviceLockService.clearOwner(hwSerial1);
    deviceLockService.clearOwner('192.168.0.50');

    deviceLockService.clearOwner(serial2);
    deviceLockService.clearOwner(hwSerial2);
    deviceLockService.clearOwner('192.168.0.60');
  });

  test('TEST 1 — Unowned device + User A connects -> User A becomes connection owner', () => {
    deviceLockService.registerHardwareSerial(serial1, hwSerial1);
    deviceLockService.setOwner(serial1, userA);

    const owner = deviceLockService.getOwner(serial1);
    assert.strictEqual(owner.userId, userA.id);
    assert.strictEqual(owner.userName, userA.name);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), false);
  });

  test('TEST 2 — User A owns device -> User B cannot access device', () => {
    deviceLockService.registerHardwareSerial(serial1, hwSerial1);
    deviceLockService.setOwner(serial1, userA);

    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userA), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), false);
  });

  test('TEST 3 — Connection ownership handover: User B connects same device -> ownership updates to User B', () => {
    deviceLockService.registerHardwareSerial(serial1, hwSerial1);
    deviceLockService.setOwner(serial1, userA);

    // User B takes over connection ownership
    deviceLockService.setOwner(serial1, userB);

    const activeOwner = deviceLockService.getOwner(serial1);
    assert.strictEqual(activeOwner.userId, userB.id);
    assert.strictEqual(activeOwner.userName, userB.name);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userA), false);
  });

  test('TEST 4 — Resource cleanup on device cleanup', () => {
    deviceLockService.setOwner(serial1, userA);

    // Simulate active mirror session
    screenMirrorService.activeSessions.set(serial1, {
      serial: serial1,
      user: userA,
      isStopping: false
    });

    // Run resource cleanup
    deviceLockService._cleanupDeviceResources(serial1, hwSerial1, null);

    // Verify session stopped
    assert.strictEqual(screenMirrorService.activeSessions.has(serial1), false);
  });

  test('TEST 5 — Active test cancellation during resource cleanup', () => {
    deviceLockService.setOwner(serial1, userA);

    const mockTestId = 'test_phase2_cleanup_01';
    testRunnerService.activeTests.set(mockTestId, {
      testId: mockTestId,
      startTime: Date.now(),
      currentStepId: null,
      testData: { id: mockTestId, deviceSerial: serial1, userId: userA.id, steps: [] },
      steps: [],
      pidWatchInterval: null,
      logcatProc: null
    });

    deviceLockService._cleanupDeviceResources(serial1, hwSerial1, null);

    assert.strictEqual(testRunnerService.activeTests.has(mockTestId), false);
  });

  test('TEST 6 — Port rotation with stable hardware serial preserves device identity', () => {
    deviceLockService.registerHardwareSerial(serial1, hwSerial1);
    deviceLockService.registerHardwareSerial(serial1Rotated, hwSerial1);

    deviceLockService.setOwner(serial1, userA);

    // Resolving on rotated port should find owner via hardware serial
    const ownerOnNewPort = deviceLockService.getOwner(serial1Rotated);
    assert.ok(ownerOnNewPort);
    assert.strictEqual(ownerOnNewPort.userId, userA.id);
    assert.strictEqual(deviceLockService.isUserDevice(serial1Rotated, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1Rotated, userB), false);
  });

  test('TEST 7 — Clear owner makes device accessible to authenticated users', () => {
    deviceLockService.setOwner(serial1, userA);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), false);

    deviceLockService.clearOwner(serial1);
    assert.strictEqual(deviceLockService.getOwner(serial1), null);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userA), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), true);
  });

  test('TEST 8 — Distinct physical devices maintain independent ownership', () => {
    deviceLockService.registerHardwareSerial(serial1, hwSerial1);
    deviceLockService.registerHardwareSerial(serial2, hwSerial2);

    deviceLockService.setOwner(serial1, userA);
    deviceLockService.setOwner(serial2, userB);

    assert.strictEqual(deviceLockService.getOwner(serial1).userId, userA.id);
    assert.strictEqual(deviceLockService.getOwner(serial2).userId, userB.id);

    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userA), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), false);

    assert.strictEqual(deviceLockService.isDeviceAccessible(serial2, userB), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial2, userA), false);
  });

  test('TEST 9 — Ownership persistence to disk and reload agree', () => {
    deviceLockService.setOwner(serial1, userA);

    // Verify disk content
    const diskContent = JSON.parse(fs.readFileSync(deviceLockService.ownershipFile, 'utf8'));
    assert.strictEqual(diskContent[serial1].userId, userA.id);
    assert.strictEqual(diskContent[serial1].userName, userA.name);

    // Re-init service
    deviceLockService.init();
    assert.strictEqual(deviceLockService.getOwner(serial1).userId, userA.id);
  });

  test('TEST 10 — Neutral device decoration for legacy compatibility', () => {
    deviceLockService.setOwner(serial1, userA);

    const decA = deviceLockService.decorateDevice({ serial: serial1, state: 'device', connected: true }, userA);
    assert.strictEqual(decA.isClaimed, false);
    assert.strictEqual(decA.isClaimedByMe, false);
    assert.strictEqual(decA.claimedBy, null);
    assert.strictEqual(decA.owner.isOwner, true);

    const decB = deviceLockService.decorateDevice({ serial: serial1, state: 'device', connected: true }, userB);
    assert.strictEqual(decB.isClaimed, false);
    assert.strictEqual(decB.isClaimedByMe, false);
    assert.strictEqual(decB.claimedBy, null);
    assert.strictEqual(decB.owner.isOwner, false);
  });
});
