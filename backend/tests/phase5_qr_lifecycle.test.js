const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const deviceLockService = require('../src/services/deviceLockService');
const wirelessPairingService = require('../src/services/wirelessPairingService');
const adbService = require('../src/services/adbService');
const screenMirrorService = require('../src/services/screenMirrorService');
const testRunnerService = require('../src/services/testRunnerService');

describe('Phase 5 — QR / Browser Wireless Connection Lifecycle Suite', () => {
  const userA = { id: 'usr_phase5_a', name: 'Tester A', email: 'testera@qa.internal', role: 'tester' };
  const userB = { id: 'usr_phase5_b', name: 'Tester B', email: 'testerb@qa.internal', role: 'tester' };
  const admin = { id: 'usr_admin', name: 'Admin', email: 'admin@qatools.internal', role: 'admin' };

  const hwVivo = '15909075850008D';
  const qrSerialA = '192.168.0.146:38111';
  const qrSerialB = '192.168.0.146:41222';
  const usbVivo = '15909075850008D';

  beforeEach(() => {
    // Release any lingering claims
    deviceLockService.releaseDevice(hwVivo, admin, true);
    deviceLockService.releaseDevice(qrSerialA, admin, true);
    deviceLockService.releaseDevice(qrSerialB, admin, true);
    deviceLockService.releaseDevice(usbVivo, admin, true);
    deviceLockService.releaseDevice('192.168.0.146', admin, true);

    deviceLockService.registerHardwareSerial(usbVivo, hwVivo);
    deviceLockService.registerHardwareSerial(qrSerialA, hwVivo);
    deviceLockService.registerHardwareSerial(qrSerialB, hwVivo);

    if (adbService.wirelessFallbacks) {
      adbService.wirelessFallbacks.clear();
    }
    if (adbService._hardwareSerialCache) {
      adbService._hardwareSerialCache.clear();
    }
    if (adbService.deferredCleanups) {
      adbService.deferredCleanups.clear();
    }
    if (testRunnerService.activeTests) {
      testRunnerService.activeTests.clear();
    }
    wirelessPairingService.sessions.clear();
  });

  // TEST 1: User A QR connection creates browser-wireless ownership
  test('TEST 1: User A QR connection creates browser-wireless ownership', async () => {
    const origConnect = adbService.connectDevice;
    adbService.connectDevice = async (ip, port) => ({
      success: true,
      serial: `${ip}:${port}`,
      device: { serial: `${ip}:${port}`, hardwareSerial: hwVivo, model: 'V2143' }
    });

    try {
      const res = await wirelessPairingService.connectDevice(userA, '192.168.0.146', '38111', { connectionMode: 'browser-wireless' });
      assert.strictEqual(res.success, true);

      const owner = deviceLockService.getOwner(qrSerialA);
      assert.ok(owner, 'Owner must exist for QR device');
      assert.strictEqual(owner.userId, userA.id);
      assert.strictEqual(deviceLockService.isUserDevice(qrSerialA, userA), true);
      assert.strictEqual(deviceLockService.isUserDevice(qrSerialA, userB), false);
    } finally {
      adbService.connectDevice = origConnect;
    }
  });

  // TEST 2: Existing QR UI decoration contains no Claim/Release controls
  test('TEST 2: Existing QR UI decoration designates device as private and hides Claim/Release controls', () => {
    const rawDevice = {
      serial: qrSerialA,
      hardwareSerial: hwVivo,
      connectionMode: 'browser-wireless',
      connected: true,
      model: 'V2143'
    };

    deviceLockService.claimDevice(qrSerialA, userA, { hardwareSerial: hwVivo, connectionMode: 'browser-wireless' });
    const decorated = deviceLockService.decorateDevice(rawDevice, userA);

    // Verify logic matching DeviceCard.jsx:
    // const isBrowserWireless = device.connectionMode === 'browser-wireless';
    // const isPrivateDevice = isAgentUsb || isBrowserUsb || isBrowserWireless;
    // const isClaimed = !isPrivateDevice && ...
    // {!isPrivateDevice && onClaim && onRelease && ...}
    const isBrowserWireless = decorated.connectionMode === 'browser-wireless';
    const isPrivateDevice = isBrowserWireless;
    const showClaimReleaseButtons = !isPrivateDevice;

    assert.strictEqual(isBrowserWireless, true);
    assert.strictEqual(isPrivateDevice, true);
    assert.strictEqual(showClaimReleaseButtons, false, 'QR/browser-wireless devices MUST NOT show Claim/Release controls');
  });

  // TEST 3: User A QR device becomes stale -> User B performs REAL successful wireless connection -> Takeover succeeds
  test('TEST 3: User A QR device becomes stale -> User B performs REAL successful wireless connection -> Takeover succeeds', async () => {
    // 1. User A originally connected via QR
    deviceLockService.claimDevice(qrSerialA, userA, { hardwareSerial: hwVivo, connectionMode: 'browser-wireless' });
    assert.strictEqual(deviceLockService.getOwner(qrSerialA).userId, userA.id);
    assert.strictEqual(deviceLockService.getOwner(hwVivo).userId, userA.id);

    // 2. Wireless transport disappears, but User B connects same physical device on new port (or same port)
    const origConnect = adbService.connectDevice;
    adbService.connectDevice = async (ip, port) => ({
      success: true,
      serial: `${ip}:${port}`,
      device: { serial: `${ip}:${port}`, hardwareSerial: hwVivo, model: 'V2143' }
    });

    try {
      const res = await wirelessPairingService.connectDevice(userB, '192.168.0.146', '41222', { connectionMode: 'browser-wireless' });
      assert.strictEqual(res.success, true);

      // 3. User B must now be the verified owner
      const ownerB = deviceLockService.getOwner(hwVivo);
      assert.ok(ownerB, 'Owner must exist on hardwareSerial');
      assert.strictEqual(ownerB.userId, userB.id, 'User B must become the new owner');
      assert.strictEqual(ownerB.userName, userB.name);

      assert.strictEqual(deviceLockService.isUserDevice(hwVivo, userB), true);
      assert.strictEqual(deviceLockService.isUserDevice(hwVivo, userA), false, 'User A must no longer have access');
    } finally {
      adbService.connectDevice = origConnect;
    }
  });

  // TEST 4: User A old mirror/logcat/monitoring resources are cleaned up upon User B QR takeover
  test('TEST 4: User A old mirror/monitoring resources cleaned up on User B QR takeover', async () => {
    // User A claims device
    deviceLockService.claimDevice(qrSerialA, userA, { hardwareSerial: hwVivo, connectionMode: 'browser-wireless' });

    let mirrorStopped = false;
    const origStopMirror = screenMirrorService.stopMirror;
    screenMirrorService.stopMirror = (s) => {
      if (s === qrSerialA || s === hwVivo) mirrorStopped = true;
    };

    const origConnect = adbService.connectDevice;
    adbService.connectDevice = async (ip, port) => ({
      success: true,
      serial: `${ip}:${port}`,
      device: { serial: `${ip}:${port}`, hardwareSerial: hwVivo, model: 'V2143' }
    });

    try {
      await wirelessPairingService.connectDevice(userB, '192.168.0.146', '41222', { connectionMode: 'browser-wireless' });
      assert.strictEqual(mirrorStopped, true, 'User A screen mirror must be cleaned up on takeover');
    } finally {
      adbService.connectDevice = origConnect;
      screenMirrorService.stopMirror = origStopMirror;
    }
  });

  // TEST 5: mDNS discovery by User B does NOT transfer User A's claim
  test('TEST 5: mDNS discovery of User A device by User B does NOT transfer User A claim', async () => {
    // User A claims device
    deviceLockService.claimDevice(qrSerialA, userA, { hardwareSerial: hwVivo, connectionMode: 'browser-wireless' });
    assert.strictEqual(deviceLockService.getOwner(hwVivo).userId, userA.id);

    // Mock adbService.getMdnsServices to advertise User A's device
    const origGetMdns = adbService.getMdnsServices;
    adbService.getMdnsServices = async () => [
      { serviceName: 'adb-tls-connect', ip: '192.168.0.146', port: 38111, address: '192.168.0.146:38111', isConnect: true }
    ];

    try {
      // User B inspects discovered devices
      const discovered = await wirelessPairingService.getDiscoveredWirelessDevices();
      assert.strictEqual(discovered.length, 1);
      assert.strictEqual(discovered[0].address, '192.168.0.146:38111');

      // Crucial assertion: User A must STILL be the exclusive owner!
      const owner = deviceLockService.getOwner(hwVivo);
      assert.strictEqual(owner.userId, userA.id, 'mDNS discovery alone MUST NEVER transfer ownership');
      assert.strictEqual(deviceLockService.isUserDevice(hwVivo, userA), true);
      assert.strictEqual(deviceLockService.isUserDevice(hwVivo, userB), false);
    } finally {
      adbService.getMdnsServices = origGetMdns;
    }
  });

  // TEST 6: QR/browser-wireless + USB same physical device -> USB remains authoritative and only one device represented
  test('TEST 6: QR/browser-wireless + USB for same physical device -> USB remains authoritative', async () => {
    deviceLockService.claimDevice(qrSerialA, userA, { hardwareSerial: hwVivo, connectionMode: 'browser-wireless' });

    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => ({ success: true });

    try {
      const rawDevices = [
        { serial: qrSerialA, isWireless: true, state: 'device', connected: true },
        { serial: usbVivo, isWireless: false, state: 'device', connected: true }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      assert.strictEqual(prioritized.length, 1, 'Only 1 card must be represented');
      assert.strictEqual(prioritized[0].serial, usbVivo, 'USB must be authoritative');
      assert.strictEqual(prioritized[0].isAuthoritative, true);

      // Verify connection ownership migrated to USB for User A
      const owner = deviceLockService.getOwner(usbVivo);
      assert.strictEqual(owner.userId, userA.id);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // TEST 7: Active test on QR transport + USB appearance -> Phase 4 deferred teardown behavior intact
  test('TEST 7: Active test on QR transport + USB appearance -> Phase 4 deferred teardown honored', async () => {
    deviceLockService.claimDevice(qrSerialA, userA, { hardwareSerial: hwVivo, connectionMode: 'browser-wireless' });

    // Mark active test running on qrSerialA
    const testId = 'test-phase5-qr-active';
    testRunnerService.activeTests.set(testId, {
      testId,
      startTime: Date.now(),
      isCancelled: false,
      testData: { id: testId, deviceSerial: qrSerialA, userId: userA.id }
    });

    let disconnectedCalled = false;
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => {
      disconnectedCalled = true;
      return { success: true };
    };

    try {
      const rawDevices = [
        { serial: qrSerialA, isWireless: true, state: 'device', connected: true },
        { serial: usbVivo, isWireless: false, state: 'device', connected: true }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      assert.strictEqual(prioritized.length, 1);
      assert.strictEqual(disconnectedCalled, false, 'Wireless transport must not be disconnected mid-test');
      assert.ok(adbService.deferredCleanups.has(hwVivo), 'Deferred cleanup must be registered');

      // Test completes -> deferred teardown executes
      testRunnerService.activeTests.delete(testId);
      const cleaned = await adbService.executeDeferredCleanup(qrSerialA, hwVivo);
      assert.strictEqual(cleaned, true);
      assert.strictEqual(disconnectedCalled, true, 'Deferred teardown executes after test completes');
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // TEST 8: QR session cancellation/expiration cleans temporary session without releasing an established device claim
  test('TEST 8: QR session cancellation/expiration cleans temporary session without releasing established persistent claim', async () => {
    // 1. Establish persistent claim on device
    deviceLockService.claimDevice(usbVivo, userA, { hardwareSerial: hwVivo });
    assert.strictEqual(deviceLockService.getOwner(hwVivo).userId, userA.id);

    // 2. User B starts a QR pairing session
    const sessionB = await wirelessPairingService.createPairingSession(userB);
    assert.ok(sessionB.sessionId);
    assert.strictEqual(wirelessPairingService.sessions.has(sessionB.sessionId), true);

    // 3. User B cancels their QR pairing session BEFORE connecting
    const cancelled = wirelessPairingService.cancelSession(sessionB.sessionId, userB);
    assert.strictEqual(cancelled, true);
    assert.strictEqual(wirelessPairingService.sessions.has(sessionB.sessionId), false);

    // 4. Critical assertion: User A persistent device ownership must NOT be released!
    const owner = deviceLockService.getOwner(hwVivo);
    assert.ok(owner, 'Established device ownership must remain intact');
    assert.strictEqual(owner.userId, userA.id, 'Session cancellation must never release existing device ownership');
  });
});
