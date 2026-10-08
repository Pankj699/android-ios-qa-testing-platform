const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const deviceLockService = require('../src/services/deviceLockService');
const adbService = require('../src/services/adbService');
const screenMirrorService = require('../src/services/screenMirrorService');
const networkUtils = require('../src/utils/networkUtils');

describe('Phase 3 — USB Priority & Wireless/USB Transport Deduplication Suite', () => {
  const userA = { id: 'usr_phase3_a', name: 'Tester A', email: 'testera@qa.internal', role: 'tester' };
  const userB = { id: 'usr_phase3_b', name: 'Tester B', email: 'testerb@qa.internal', role: 'tester' };
  const admin = { id: 'usr_admin', name: 'Admin', email: 'admin@qatools.internal', role: 'admin' };

  const hwVivo = 'V2143_PHASE3_HW';
  const usbVivo = 'V2143_PHASE3_HW';
  const wifiVivo = '192.168.0.222:37143';

  const hwPixel = '9A211FFAZ001';
  const usbPixel = '9A211FFAZ001';
  const wifiPixel = '192.168.0.78:42559';

  beforeEach(() => {
    // Release any lingering claims
    deviceLockService.releaseDevice(hwVivo, admin, true);
    deviceLockService.releaseDevice(usbVivo, admin, true);
    deviceLockService.releaseDevice(wifiVivo, admin, true);
    deviceLockService.releaseDevice('192.168.0.222', admin, true);

    deviceLockService.releaseDevice(hwPixel, admin, true);
    deviceLockService.releaseDevice(usbPixel, admin, true);
    deviceLockService.releaseDevice(wifiPixel, admin, true);
    deviceLockService.releaseDevice('192.168.0.78', admin, true);

    // Register hardware serial mappings
    deviceLockService.registerHardwareSerial(usbVivo, hwVivo);
    deviceLockService.registerHardwareSerial(wifiVivo, hwVivo);
    deviceLockService.registerHardwareSerial(usbPixel, hwPixel);
    deviceLockService.registerHardwareSerial(wifiPixel, hwPixel);

    if (adbService.wirelessFallbacks) {
      adbService.wirelessFallbacks.clear();
    }
    if (adbService._hardwareSerialCache) {
      adbService._hardwareSerialCache.clear();
    }
  });

  test('TEST 1 — Wireless connected first + User A claims wireless -> User A owns device', () => {
    const claim = deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });
    assert.strictEqual(claim.userId, userA.id);
    assert.strictEqual(claim.userName, userA.name);
    assert.strictEqual(deviceLockService.isUserDevice(wifiVivo, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(wifiVivo, userB), false);
  });

  test('TEST 2 — USB plugged in for same physical device (healthy state) -> USB prioritized, wireless disconnected', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    let disconnectedSerial = null;
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async (serial) => {
      disconnectedSerial = serial;
      return { success: true };
    };

    try {
      const rawDevices = [
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true, model: 'V2143' },
        { serial: usbVivo, state: 'device', isWireless: false, connected: true, model: 'V2143' }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      // Wireless transport must have been safely disconnected
      assert.strictEqual(disconnectedSerial, wifiVivo);

      // Exactly 1 device returned, which is the authoritative USB device
      assert.strictEqual(prioritized.length, 1);
      assert.strictEqual(prioritized[0].serial, usbVivo);
      assert.strictEqual(prioritized[0].isWireless, false);
      assert.strictEqual(prioritized[0].isAuthoritative, true);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  test('TEST 3 — Claim Safety: User A claim automatically migrated from wireless to USB without re-claim', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => ({ success: true });

    try {
      const rawDevices = [
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true },
        { serial: usbVivo, state: 'device', isWireless: false, connected: true }
      ];

      await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      // Connection ownership must now be bound to USB serial for User A
      const usbOwner = deviceLockService.getOwner(usbVivo);
      assert.ok(usbOwner, 'USB serial must have active ownership');
      assert.strictEqual(usbOwner.userId, userA.id);
      assert.strictEqual(usbOwner.userName, userA.name);
      assert.strictEqual(deviceLockService.isUserDevice(usbVivo, userA), true);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  test('TEST 4 — Multi-user isolation: User B blocked from seeing or controlling USB device', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => ({ success: true });

    try {
      const rawDevices = [
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true },
        { serial: usbVivo, state: 'device', isWireless: false, connected: true }
      ];

      await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      // User B must NOT be able to access the device
      assert.strictEqual(deviceLockService.isUserDevice(usbVivo, userB), false);
      assert.strictEqual(deviceLockService.isDeviceAccessible(usbVivo, userB), false);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  test('TEST 5 — UI representation: Deduplication ensures exactly 1 device card returned (authoritative USB)', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => ({ success: true });

    try {
      const rawDevices = [
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true, model: 'V2143' },
        { serial: usbVivo, state: 'device', isWireless: false, connected: true, model: 'V2143' }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);
      const decorated = deviceLockService.decorateDevices(prioritized, userA);

      assert.strictEqual(decorated.length, 1);
      assert.strictEqual(decorated[0].serial, usbVivo);
      assert.strictEqual(decorated[0].isClaimed, false);
      assert.strictEqual(decorated[0].owner.isOwner, true);
      assert.strictEqual(decorated[0].isWireless, false);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  test('TEST 6 — USB connected first + Wireless connected later -> USB priority maintained, redundant wireless disconnected', async () => {
    // User A connects USB directly
    deviceLockService.claimDevice(usbVivo, userA, { hardwareSerial: hwVivo });

    let disconnectedSerial = null;
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async (serial) => {
      disconnectedSerial = serial;
      return { success: true };
    };

    try {
      // Later wireless transport appears
      const rawDevices = [
        { serial: usbVivo, state: 'device', isWireless: false, connected: true, model: 'V2143' },
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true, model: 'V2143' }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      assert.strictEqual(disconnectedSerial, wifiVivo);
      assert.strictEqual(prioritized.length, 1);
      assert.strictEqual(prioritized[0].serial, usbVivo);

      const owner = deviceLockService.getOwner(usbVivo);
      assert.strictEqual(owner.userId, userA.id);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  test('TEST 7 — Redundant wireless disconnect safely cleans up active screen mirror session on wireless transport', async () => {
    let mirrorStopped = null;
    const origStopMirror = screenMirrorService.stopMirror;
    screenMirrorService.stopMirror = (serial) => {
      mirrorStopped = serial;
      return { success: true };
    };

    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => ({ success: true });

    try {
      const rawDevices = [
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true },
        { serial: usbVivo, state: 'device', isWireless: false, connected: true }
      ];

      await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      assert.strictEqual(mirrorStopped, wifiVivo, 'Mirror on wireless transport must be stopped');
    } finally {
      screenMirrorService.stopMirror = origStopMirror;
      adbService.disconnectDevice = origDisconnect;
    }
  });

  test('TEST 8 — USB verification failure: USB in unauthorized state -> does NOT disconnect wireless transport', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    let disconnectCalled = false;
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => {
      disconnectCalled = true;
      return { success: true };
    };

    try {
      const rawDevices = [
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true },
        { serial: usbVivo, state: 'unauthorized', isWireless: false, connected: false }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      // Wireless must NOT be disconnected because USB verification failed!
      assert.strictEqual(disconnectCalled, false);
      assert.strictEqual(prioritized.some(d => d.serial === wifiVivo), true);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  test('TEST 9 — USB verification failure: USB in offline state -> does NOT disconnect wireless transport', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    let disconnectCalled = false;
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => {
      disconnectCalled = true;
      return { success: true };
    };

    try {
      const rawDevices = [
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true },
        { serial: usbVivo, state: 'offline', isWireless: false, connected: false }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      // Wireless must NOT be disconnected because USB is offline
      assert.strictEqual(disconnectCalled, false);
      assert.strictEqual(prioritized.some(d => d.serial === wifiVivo), true);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  test('TEST 10 — USB disconnected: Fallback endpoint stored in adbService.wirelessFallbacks', async () => {
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => ({ success: true });

    try {
      const rawDevices = [
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true },
        { serial: usbVivo, state: 'device', isWireless: false, connected: true }
      ];

      await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      assert.ok(adbService.wirelessFallbacks.has(hwVivo), 'Fallback must be saved for hardware serial');
      const fallback = adbService.wirelessFallbacks.get(hwVivo);
      assert.strictEqual(fallback.serial, wifiVivo);
      assert.strictEqual(fallback.ip, '192.168.0.222');
      assert.strictEqual(fallback.port, 37143);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  test('TEST 11 — Fallback recovery: Reconnects wireless transport when USB disconnected and endpoint is reachable', async () => {
    // Setup stored fallback
    adbService.wirelessFallbacks.set(hwVivo, {
      serial: wifiVivo,
      ip: '192.168.0.222',
      port: 37143,
      hardwareSerial: hwVivo,
      savedAt: Date.now()
    });

    const origExecute = adbService.execute;
    const origReach = networkUtils.testReachability;
    networkUtils.testReachability = async () => ({ reachable: true, message: 'Reachable' });
    let connectCalledWith = null;
    adbService.execute = async (args) => {
      if (args[0] === 'connect') {
        connectCalledWith = args[1];
        return { raw: 'connected to ' + args[1], code: 0 };
      }
      return origExecute.call(adbService, args);
    };

    try {
      // Simulated empty device list (USB unplugged)
      const emptyDevices = [];
      await adbService.checkFallbackRecovery(emptyDevices);

      assert.strictEqual(connectCalledWith, wifiVivo);
      assert.strictEqual(emptyDevices.length, 1);
      assert.strictEqual(emptyDevices[0].serial, wifiVivo);
    } finally {
      adbService.execute = origExecute;
      networkUtils.testReachability = origReach;
    }
  });

  test('TEST 12 — Fallback claim preservation: User A retains ownership when device transitions back to wireless', async () => {
    // User A originally owns device on USB
    deviceLockService.claimDevice(usbVivo, userA, { hardwareSerial: hwVivo });

    adbService.wirelessFallbacks.set(hwVivo, {
      serial: wifiVivo,
      ip: '192.168.0.222',
      port: 37143,
      hardwareSerial: hwVivo,
      savedAt: Date.now()
    });

    const origExecute = adbService.execute;
    const origReach = networkUtils.testReachability;
    networkUtils.testReachability = async () => ({ reachable: true, message: 'Reachable' });
    adbService.execute = async (args) => {
      if (args[0] === 'connect') {
        return { raw: 'connected to ' + args[1], code: 0 };
      }
      return origExecute.call(adbService, args);
    };

    try {
      const devices = [];
      await adbService.checkFallbackRecovery(devices);

      // Verify connection ownership migrated back to wireless serial
      const owner = deviceLockService.getOwner(wifiVivo);
      assert.ok(owner, 'Wireless transport must retain ownership');
      assert.strictEqual(owner.userId, userA.id);
      assert.strictEqual(owner.userName, userA.name);
      assert.strictEqual(deviceLockService.isUserDevice(wifiVivo, userA), true);
    } finally {
      adbService.execute = origExecute;
      networkUtils.testReachability = origReach;
    }
  });

  test('TEST 13 — decorateDevices deduplicates devices sharing same hardwareSerial, preferring USB', () => {
    deviceLockService.claimDevice(hwVivo, userA, { hardwareSerial: hwVivo });

    // Raw list containing both representations
    const bothTransports = [
      { serial: wifiVivo, state: 'device', connected: true, isWireless: true, hardwareSerial: hwVivo, model: 'V2143' },
      { serial: usbVivo, state: 'device', connected: true, isWireless: false, hardwareSerial: hwVivo, model: 'V2143' }
    ];

    const decorated = deviceLockService.decorateDevices(bothTransports, userA);

    assert.strictEqual(decorated.length, 1, 'Must return exactly one card');
    assert.strictEqual(decorated[0].serial, usbVivo, 'Must prefer USB representation');
    assert.strictEqual(decorated[0].isWireless, false);
  });

  test('TEST 14 — Different physical devices (Phone 1 on USB, Phone 2 on Wireless) -> Both retained', async () => {
    deviceLockService.claimDevice(usbVivo, userA, { hardwareSerial: hwVivo });
    deviceLockService.claimDevice(wifiPixel, userA, { hardwareSerial: hwPixel });

    const rawDevices = [
      { serial: usbVivo, state: 'device', isWireless: false, connected: true, model: 'V2143' },
      { serial: wifiPixel, state: 'device', isWireless: true, connected: true, model: 'Pixel 6' }
    ];

    const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

    // Both are different physical devices, both must be preserved!
    assert.strictEqual(prioritized.length, 2);
    assert.strictEqual(prioritized.some(d => d.serial === usbVivo), true);
    assert.strictEqual(prioritized.some(d => d.serial === wifiPixel), true);
  });

  test('TEST 15 — Device release clears connection ownership across both USB and wireless transport keys', () => {
    deviceLockService.claimDevice(usbVivo, userA, { hardwareSerial: hwVivo });
    assert.strictEqual(deviceLockService.isUserDevice(usbVivo, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(wifiVivo, userA), true);

    deviceLockService.releaseDevice(usbVivo, userA);

    assert.strictEqual(deviceLockService.getOwner(usbVivo), null);
    assert.strictEqual(deviceLockService.getClaim(usbVivo), null);
    assert.strictEqual(deviceLockService.getClaim(wifiVivo), null);
    assert.strictEqual(deviceLockService.getClaim(hwVivo), null);
  });

  test('TEST 16 — Transport priority preserves test runner and session integrity (no crash, clean transition)', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => ({ success: true });

    try {
      const rawDevices = [
        { serial: wifiVivo, state: 'device', isWireless: true, connected: true, model: 'V2143' },
        { serial: usbVivo, state: 'device', isWireless: false, connected: true, model: 'V2143' }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);
      const decorated = deviceLockService.decorateDevices(prioritized, userA);

      assert.strictEqual(decorated.length, 1);
      assert.strictEqual(decorated[0].serial, usbVivo);
      assert.strictEqual(deviceLockService.isDeviceAccessible(usbVivo, userA), true);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });
});
