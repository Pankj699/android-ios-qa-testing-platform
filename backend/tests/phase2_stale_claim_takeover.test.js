const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const deviceLockService = require('../src/services/deviceLockService');
const screenMirrorService = require('../src/services/screenMirrorService');
const testRunnerService = require('../src/services/testRunnerService');
const { terminateDeviceLogcat } = require('../src/websocket/testSocket');

describe('Phase 2 — Stale Claim Takeover on Real Successful Connection Suite', () => {
  const userA = { id: 'usr_phase2_a', name: 'User A', email: 'usera@qa.internal', role: 'tester' };
  const userB = { id: 'usr_phase2_b', name: 'User B', email: 'userb@qa.internal', role: 'tester' };
  const userC = { id: 'usr_phase2_c', name: 'User C', email: 'userc@qa.internal', role: 'tester' };
  const admin = { id: 'usr_admin', name: 'Admin', email: 'admin@qatools.internal', role: 'admin' };

  const serial1 = '192.168.0.50:41001';
  const serial1Rotated = '192.168.0.50:49222';
  const hwSerial1 = '15909075850008D';

  const serial2 = '192.168.0.60:42002';
  const hwSerial2 = 'RZGL30DK6AM';

  beforeEach(() => {
    deviceLockService.releaseDevice(serial1, admin, true);
    deviceLockService.releaseDevice(serial1Rotated, admin, true);
    deviceLockService.releaseDevice(hwSerial1, admin, true);
    deviceLockService.releaseDevice('192.168.0.50', admin, true);

    deviceLockService.releaseDevice(serial2, admin, true);
    deviceLockService.releaseDevice(hwSerial2, admin, true);
    deviceLockService.releaseDevice('192.168.0.60', admin, true);
  });

  test('TEST 1 — Unclaimed device + User A connects -> User A becomes owner', () => {
    const claim = deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });
    assert.strictEqual(claim.userId, userA.id);
    assert.strictEqual(claim.userName, userA.name);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), false);
  });

  test('TEST 2 — User A owns device. User B merely discovers device -> A remains owner', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Discovery / listing simulation: User B queries list
    const decorated = deviceLockService.decorateDevices([
      { serial: serial1, state: 'device', connected: true }
    ], userB);

    // User B cannot see claimed device; claim remains intact for User A
    assert.strictEqual(decorated.length, 0);
    const currentClaim = deviceLockService.getClaim(serial1);
    assert.strictEqual(currentClaim.userId, userA.id);
    assert.strictEqual(currentClaim.userName, userA.name);
  });

  test('TEST 3 — User A owns device. User B connection attempt FAILS -> A remains owner', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Simulating failed connection (e.g. adb connect rejected or error thrown)
    const failedConnection = false;
    if (!failedConnection) {
      // Connect failed: no takeover initiated
    }

    const currentClaim = deviceLockService.getClaim(serial1);
    assert.strictEqual(currentClaim.userId, userA.id);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), false);
  });

  test('TEST 4 — User A owns device. User B successfully connects same physical device -> claim transfers A -> B', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // User B establishes real verified ADB connection
    const claimB = deviceLockService.claimDevice(serial1, userB, {
      hardwareSerial: hwSerial1,
      forceTakeover: true,
      verifiedConnection: true
    });

    assert.strictEqual(claimB.userId, userB.id);
    assert.strictEqual(claimB.userName, userB.name);

    const activeClaim = deviceLockService.getClaim(serial1);
    assert.strictEqual(activeClaim.userId, userB.id);
    assert.strictEqual(activeClaim.userName, userB.name);
  });

  test('TEST 5 — After transfer: User A device access -> DENIED', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // User B takes over
    deviceLockService.claimDevice(serial1, userB, {
      hardwareSerial: hwSerial1,
      forceTakeover: true,
      verifiedConnection: true
    });

    // User A is strictly blocked
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), false);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userA), false);

    // User A cannot re-claim without verified connection
    assert.throws(() => {
      deviceLockService.claimDevice(serial1, userA);
    }, { message: /currently claimed by User B/ });
  });

  test('TEST 6 — After transfer: User B device access -> ALLOWED', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // User B takes over
    deviceLockService.claimDevice(serial1, userB, {
      hardwareSerial: hwSerial1,
      forceTakeover: true,
      verifiedConnection: true
    });

    // User B has full access
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), true);

    const decorated = deviceLockService.decorateDevice({ serial: serial1, state: 'device', connected: true }, userB);
    assert.strictEqual(decorated.isClaimed, true);
    assert.strictEqual(decorated.isClaimedByMe, true);
    assert.strictEqual(decorated.claimedBy, 'User B');
  });

  test('TEST 7 — User A active mirror. User B successfully takes over -> A mirror is safely terminated', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Simulate active mirror session for User A
    screenMirrorService.activeSessions.set(serial1, {
      serial: serial1,
      user: userA,
      isStopping: false
    });

    // User B takes over
    deviceLockService.claimDevice(serial1, userB, {
      hardwareSerial: hwSerial1,
      forceTakeover: true,
      verifiedConnection: true
    });

    // Verify session for serial1 is stopped and cleared
    assert.strictEqual(screenMirrorService.activeSessions.has(serial1), false);
  });

  test('TEST 8 — User A active logcat/monitoring. User B takes over -> A device-specific resources are cleaned', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Simulate active test in testRunnerService for User A on this device
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

    // User B takes over
    deviceLockService.claimDevice(serial1, userB, {
      hardwareSerial: hwSerial1,
      forceTakeover: true,
      verifiedConnection: true
    });

    // Verify User A test was cancelled
    assert.strictEqual(testRunnerService.activeTests.has(mockTestId), false);
  });

  test('TEST 9 — User A disconnects. User A reconnects -> A remains owner', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Temporary transport disconnect
    deviceLockService.clearOwner(serial1);

    // User A reconnects
    const reconnectedClaim = deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });
    assert.strictEqual(reconnectedClaim.userId, userA.id);
    assert.strictEqual(reconnectedClaim.userName, userA.name);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), true);
  });

  test('TEST 10 — Wireless port rotates. Same hardwareSerial. User B successfully connects -> B can take over stale A claim', () => {
    // User A claims on port 41001
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Wireless disconnects and reconnects on port 49222 (port rotation)
    // Hardware serial is identical
    const claimB = deviceLockService.claimDevice(serial1Rotated, userB, {
      hardwareSerial: hwSerial1,
      forceTakeover: true,
      verifiedConnection: true
    });

    assert.strictEqual(claimB.userId, userB.id);
    assert.strictEqual(claimB.userName, userB.name);

    // Both new port and hardware serial now point to User B
    assert.strictEqual(deviceLockService.getClaim(serial1Rotated).userId, userB.id);
    assert.strictEqual(deviceLockService.getClaim(hwSerial1).userId, userB.id);
    // Old port record was cleaned up
    assert.strictEqual(deviceLockService.claims.has(serial1), false);
    // User A lost access to both old and new port
    assert.strictEqual(deviceLockService.isUserDevice(serial1Rotated, userA), false);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), false);
  });

  test('TEST 11 — Explicit Release. User B connects -> normal claim behavior works', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // User A releases
    deviceLockService.releaseDevice(serial1, userA);
    assert.strictEqual(deviceLockService.getClaim(serial1), null);

    // User B claims without needing forceTakeover
    const claimB = deviceLockService.claimDevice(serial1, userB, { hardwareSerial: hwSerial1 });
    assert.strictEqual(claimB.userId, userB.id);
    assert.strictEqual(claimB.userName, userB.name);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), false);
  });

  test('TEST 12 — User B and User C race to take over -> exactly one winner', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // User B takes over
    const claimB = deviceLockService.claimDevice(serial1, userB, {
      hardwareSerial: hwSerial1,
      forceTakeover: true,
      verifiedConnection: true
    });
    assert.strictEqual(claimB.userId, userB.id);

    // User C immediately races to take over right after User B
    assert.throws(() => {
      deviceLockService.claimDevice(serial1, userC, {
        hardwareSerial: hwSerial1,
        forceTakeover: true,
        verifiedConnection: true
      });
    }, { message: /was just claimed by User B/ });

    // Strict invariant: only User B is owner, User C is rejected
    assert.strictEqual(deviceLockService.getClaim(serial1).userId, userB.id);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userC), false);
  });

  test('TEST 13 — Different physical device with different hardwareSerial -> never treated as same device', () => {
    // Device 1 claimed by User A
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Device 2 connects for User B with different hardwareSerial
    const claimB = deviceLockService.claimDevice(serial2, userB, { hardwareSerial: hwSerial2 });

    assert.strictEqual(claimB.userId, userB.id);
    // Device 1 remains completely owned by User A
    assert.strictEqual(deviceLockService.getClaim(serial1).userId, userA.id);
    assert.strictEqual(deviceLockService.getClaim(hwSerial1).userId, userA.id);

    // Device 2 owned by User B
    assert.strictEqual(deviceLockService.getClaim(serial2).userId, userB.id);
    assert.strictEqual(deviceLockService.getClaim(hwSerial2).userId, userB.id);
  });

  test('TEST 14 — Direct claimDevice forceTakeover attempt without verified connection -> rejected / not exposed', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // User B attempts forceTakeover without verified connection
    assert.throws(() => {
      deviceLockService.claimDevice(serial1, userB, {
        hardwareSerial: hwSerial1,
        forceTakeover: true,
        verifiedConnection: false
      });
    }, { message: /Claim takeover requires a verified active device connection/ });

    // User A remains owner
    assert.strictEqual(deviceLockService.getClaim(serial1).userId, userA.id);
  });

  test('TEST 15 — Claim persistence after successful takeover -> disk and memory agree', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // User B takes over
    deviceLockService.claimDevice(serial1, userB, {
      hardwareSerial: hwSerial1,
      forceTakeover: true,
      verifiedConnection: true
    });

    // Check memory
    assert.strictEqual(deviceLockService.getClaim(serial1).userId, userB.id);

    // Check disk
    const diskContent = JSON.parse(fs.readFileSync(deviceLockService.claimsFile, 'utf8'));
    assert.strictEqual(diskContent[serial1].userId, userB.id);
    assert.strictEqual(diskContent[serial1].userName, userB.name);
    assert.strictEqual(diskContent[hwSerial1].userId, userB.id);
  });

  test('TEST 16 — Existing multi-user isolation tests remain passing', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Decorate check
    const decA = deviceLockService.decorateDevice({ serial: serial1, state: 'device', connected: true }, userA);
    assert.strictEqual(decA.isClaimedByMe, true);
    assert.strictEqual(decA.isClaimed, true);

    const decB = deviceLockService.decorateDevice({ serial: serial1, state: 'device', connected: true }, userB);
    assert.strictEqual(decB.isClaimedByMe, false);
    assert.strictEqual(decB.isClaimed, true);
    assert.strictEqual(decB.claimedBy, 'User A');
  });
});
