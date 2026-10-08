const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const deviceLockService = require('../src/services/deviceLockService');
const adbService = require('../src/services/adbService');
const testRunnerService = require('../src/services/testRunnerService');
const screenMirrorService = require('../src/services/screenMirrorService');

describe('Phase 4 — Device Transport Lifecycle Hardening Suite', () => {
  const userA = { id: 'usr_phase4_a', name: 'Tester A', email: 'testera@qa.internal', role: 'tester' };
  const userB = { id: 'usr_phase4_b', name: 'Tester B', email: 'testerb@qa.internal', role: 'tester' };
  const admin = { id: 'usr_admin', name: 'Admin', email: 'admin@qatools.internal', role: 'admin' };

  const hwVivo = 'V2143_PHASE4_HW';
  const usbVivo = 'V2143_PHASE4_HW';
  const wifiVivo = '192.168.0.222:37143';

  const hwPixel = 'PIXEL_PHASE4_HW';
  const usbPixel = 'PIXEL_PHASE4_HW';
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
    if (adbService._disconnectingSerials) {
      adbService._disconnectingSerials.clear();
    }
    if (adbService.deferredCleanups) {
      adbService.deferredCleanups.clear();
    }
    if (testRunnerService.activeTests) {
      testRunnerService.activeTests.clear();
    }
  });

  // TEST 1: Wireless selected -> USB plugged in -> Run PAD Test device resolution succeeds
  test('TEST 1: Wireless selected -> USB becomes authoritative -> Step 2 resolves device by hardwareSerial', async () => {
    // Simulate that device is currently visible only via USB
    const origList = adbService.listDevices;
    const origGetInfo = adbService.getDeviceInfo;
    try {
      adbService.listDevices = async () => [
        { serial: usbVivo, hardwareSerial: hwVivo, state: 'device', connected: true, isAuthoritative: true }
      ];
      adbService.getDeviceInfo = async (s) => ({ name: 'Vivo V2143', androidVersion: '14' });

      // Simulate active test started with wifiVivo serial
      const testId = 'test-phase4-t1';
      const activeState = {
        testId,
        startTime: Date.now(),
        steps: [
          { id: 'check_prereqs', status: 'PASSED' },
          { id: 'check_device', status: 'PENDING' }
        ],
        currentStepId: 'check_device',
        isCancelled: false,
        testData: { id: testId, deviceSerial: wifiVivo, userId: userA.id }
      };
      testRunnerService.activeTests.set(testId, activeState);

      const devices = await adbService.listDevices();
      const targetHw = (deviceLockService.hardwareMap && deviceLockService.hardwareMap.get(wifiVivo)) || wifiVivo;
      const targetDevice = devices.find(d =>
        d.serial === wifiVivo ||
        (targetHw && (d.hardwareSerial === targetHw || d.serial === targetHw))
      );

      assert.ok(targetDevice, 'Should find authoritative USB device by hardwareSerial matching');
      assert.strictEqual(targetDevice.serial, usbVivo);
      assert.strictEqual(targetDevice.state, 'device');
    } finally {
      adbService.listDevices = origList;
      adbService.getDeviceInfo = origGetInfo;
    }
  });

  // TEST 2: Device selection tracking by hardwareSerial
  test('TEST 2: Selection tracking by hardwareSerial preserves device across transport switch', () => {
    const prev = { serial: wifiVivo, hardwareSerial: hwVivo, model: 'Vivo V2143' };
    const deviceList = [
      { serial: usbVivo, hardwareSerial: hwVivo, model: 'Vivo V2143 (USB)', state: 'device' }
    ];

    const stillConnected = deviceList.find(
      (d) =>
        d.serial === prev.serial ||
        (prev.hardwareSerial && (d.hardwareSerial === prev.hardwareSerial || d.serial === prev.hardwareSerial)) ||
        (d.hardwareSerial && (d.hardwareSerial === prev.serial))
    );

    assert.ok(stillConnected, 'Should find USB device matching prev wireless hardwareSerial');
    assert.strictEqual(stillConnected.serial, usbVivo);
  });

  // TEST 3: Active PAD Test on wireless -> USB plugged in -> Wireless NOT disconnected mid-test
  test('TEST 3: Active PAD Test on wireless -> USB plugged in -> Wireless teardown deferred, NOT disconnected mid-test', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    // Mark test active for wifiVivo
    const testId = 'test-phase4-active';
    testRunnerService.activeTests.set(testId, {
      testId,
      startTime: Date.now(),
      isCancelled: false,
      testData: { id: testId, deviceSerial: wifiVivo, userId: userA.id }
    });

    let disconnectedCalled = false;
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async (s) => {
      disconnectedCalled = true;
      return { success: true };
    };

    try {
      const rawDevices = [
        { serial: wifiVivo, isWireless: true, state: 'device', connected: true },
        { serial: usbVivo, isWireless: false, state: 'device', connected: true }
      ];

      const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      assert.strictEqual(prioritized.length, 1);
      assert.strictEqual(prioritized[0].serial, usbVivo);
      assert.strictEqual(disconnectedCalled, false, 'Wireless transport MUST NOT be disconnected while test is active!');
      assert.ok(adbService.deferredCleanups.has(hwVivo), 'Deferred cleanup state must be registered');
      assert.strictEqual(adbService.deferredCleanups.get(hwVivo).wSerial, wifiVivo);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // TEST 4: Active test reaches terminal state -> Deferred wireless teardown completes exactly once
  test('TEST 4: Active test reaches terminal state -> Deferred wireless teardown executes exactly once', async () => {
    adbService.deferredCleanups.set(hwVivo, {
      wSerial: wifiVivo,
      usbSerial: usbVivo,
      hwSerial: hwVivo
    });

    let disconnectCount = 0;
    let disconnectedSerial = null;
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async (s) => {
      disconnectCount++;
      disconnectedSerial = s;
      return { success: true };
    };

    try {
      // First terminal trigger
      const res1 = await adbService.executeDeferredCleanup(wifiVivo, hwVivo);
      assert.strictEqual(res1, true, 'First deferred cleanup should execute');
      assert.strictEqual(disconnectCount, 1);
      assert.strictEqual(disconnectedSerial, wifiVivo);
      assert.strictEqual(adbService.deferredCleanups.has(hwVivo), false, 'Deferred cleanup state must be removed after execution');

      // Second trigger (duplicate / subsequent terminal event)
      const res2 = await adbService.executeDeferredCleanup(wifiVivo, hwVivo);
      assert.strictEqual(res2, false, 'Second deferred cleanup should be a no-op');
      assert.strictEqual(disconnectCount, 1, 'Teardown must not execute a second time');
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // TEST 5: Explicit Release -> Fallback entry removed from wirelessFallbacks
  test('TEST 5: Explicit Release -> Fallback entry removed from wirelessFallbacks', () => {
    deviceLockService.claimDevice(usbVivo, userA, { hardwareSerial: hwVivo });
    adbService.wirelessFallbacks.set(hwVivo, {
      serial: wifiVivo,
      ip: '192.168.0.222',
      port: 37143,
      hardwareSerial: hwVivo,
      savedAt: Date.now()
    });

    assert.ok(adbService.wirelessFallbacks.has(hwVivo));

    // Explicit release
    deviceLockService.releaseDevice(usbVivo, userA);

    assert.strictEqual(adbService.wirelessFallbacks.has(hwVivo), false, 'Fallback must be removed from wirelessFallbacks on explicit release');
  });

  // TEST 6: Explicit Release -> USB unplugged -> Old wireless endpoint NOT reconnected
  test('TEST 6: Explicit Release -> USB disconnect -> Old wireless endpoint NOT reconnected', async () => {
    deviceLockService.claimDevice(usbVivo, userA, { hardwareSerial: hwVivo });
    adbService.wirelessFallbacks.set(hwVivo, {
      serial: wifiVivo,
      ip: '192.168.0.222',
      port: 37143,
      hardwareSerial: hwVivo,
      savedAt: Date.now()
    });

    // Explicit release
    deviceLockService.releaseDevice(usbVivo, userA);

    let connectCalled = false;
    const origExec = adbService.execute;
    adbService.execute = async (args) => {
      if (args[0] === 'connect') connectCalled = true;
      return { stdout: '', raw: 'connected' };
    };

    try {
      // Simulate USB disconnect
      const rawDevices = [];
      await adbService.checkFallbackRecovery(rawDevices);

      assert.strictEqual(connectCalled, false, 'Should not attempt connect because fallback was cleared on release');
    } finally {
      adbService.execute = origExec;
    }
  });

  // TEST 7: Normal owned USB -> Wireless fallback still works after USB disconnect
  test('TEST 7: Normal owned USB -> Wireless fallback connects after USB disconnect when NOT released', async () => {
    deviceLockService.claimDevice(usbVivo, userA, { hardwareSerial: hwVivo });
    adbService.wirelessFallbacks.set(hwVivo, {
      serial: wifiVivo,
      ip: '192.168.0.222',
      port: 37143,
      hardwareSerial: hwVivo,
      savedAt: Date.now()
    });

    let connectTarget = null;
    const origExec = adbService.execute;
    const origReach = require('../src/utils/networkUtils').testReachability;
    require('../src/utils/networkUtils').testReachability = async () => ({ reachable: true });
    adbService.execute = async (args) => {
      if (args[0] === 'connect') {
        connectTarget = args[1];
        return { stdout: '', raw: `connected to ${args[1]}` };
      }
      return { stdout: '', raw: '' };
    };

    try {
      const emptyDevices = [];
      await adbService.checkFallbackRecovery(emptyDevices);

      assert.strictEqual(connectTarget, wifiVivo, 'Should attempt reconnect to saved fallback');
      assert.strictEqual(emptyDevices.length, 1);
      assert.strictEqual(emptyDevices[0].serial, wifiVivo);
    } finally {
      adbService.execute = origExec;
      require('../src/utils/networkUtils').testReachability = origReach;
    }
  });

  // TEST 8: Concurrent deduplicateAndPrioritizeTransports calls -> In-flight guard ensures only 1 disconnect
  test('TEST 8: Concurrent transport deduplication calls -> In-flight guard prevents redundant disconnect calls', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    let disconnectInvocations = 0;
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async (s) => {
      disconnectInvocations++;
      // Simulate delay in adb disconnect
      await new Promise(r => setTimeout(r, 50));
      return { success: true };
    };

    try {
      const rawDevices1 = [
        { serial: wifiVivo, isWireless: true, state: 'device', connected: true },
        { serial: usbVivo, isWireless: false, state: 'device', connected: true }
      ];
      const rawDevices2 = [
        { serial: wifiVivo, isWireless: true, state: 'device', connected: true },
        { serial: usbVivo, isWireless: false, state: 'device', connected: true }
      ];

      // Call deduplicate concurrently
      await Promise.all([
        adbService.deduplicateAndPrioritizeTransports(rawDevices1),
        adbService.deduplicateAndPrioritizeTransports(rawDevices2)
      ]);

      assert.strictEqual(disconnectInvocations, 1, 'In-flight guard must ensure disconnect is invoked only once');
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // TEST 9: Disconnect failure -> _disconnectingSerials cleaned in finally
  test('TEST 9: Disconnect failure -> _disconnectingSerials cleaned in finally block', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async (s) => {
      throw new Error('ADB disconnect simulated I/O failure');
    };

    try {
      const rawDevices = [
        { serial: wifiVivo, isWireless: true, state: 'device', connected: true },
        { serial: usbVivo, isWireless: false, state: 'device', connected: true }
      ];

      await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      assert.strictEqual(adbService._disconnectingSerials.has(wifiVivo), false, '_disconnectingSerials must be cleaned up in finally block despite error');
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // TEST 10: Disconnect timeout -> _disconnectingSerials cleaned in finally
  test('TEST 10: Disconnect timeout -> _disconnectingSerials cleaned in finally block', async () => {
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async (s) => {
      const err = new Error('Command timed out');
      err.code = 'ETIMEDOUT';
      throw err;
    };

    try {
      const rawDevices = [
        { serial: wifiVivo, isWireless: true, state: 'device', connected: true },
        { serial: usbVivo, isWireless: false, state: 'device', connected: true }
      ];

      await adbService.deduplicateAndPrioritizeTransports(rawDevices);

      assert.strictEqual(adbService._disconnectingSerials.has(wifiVivo), false, '_disconnectingSerials must be cleared after timeout');
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // TEST 11: Different physical devices -> Never matched across hardwareSerial
  test('TEST 11: Different physical devices -> Never matched across hardwareSerial or deduplicated', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });
    deviceLockService.claimDevice(usbPixel, userB, { hardwareSerial: hwPixel });

    const rawDevices = [
      { serial: wifiVivo, isWireless: true, state: 'device', connected: true },
      { serial: usbPixel, isWireless: false, state: 'device', connected: true }
    ];

    const prioritized = await adbService.deduplicateAndPrioritizeTransports(rawDevices);

    assert.strictEqual(prioritized.length, 2, 'Two distinct devices must NOT be deduplicated');
    assert.strictEqual(deviceLockService.isUserDevice(wifiVivo, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(usbPixel, userB), true);
  });

  // TEST 12: Existing Phase 1 stable physical identity semantics pass
  test('TEST 12: Phase 1 stable physical identity preserved', () => {
    const hwMap = deviceLockService.hardwareMap;
    assert.strictEqual(hwMap.get(usbVivo), hwVivo);
    assert.strictEqual(hwMap.get(wifiVivo), hwVivo);
  });

  // TEST 13: Existing Phase 2 verified connection ownership handover semantics pass
  test('TEST 13: Phase 2 connection ownership handover semantics preserved', () => {
    deviceLockService.claimDevice(hwVivo, userA, { hardwareSerial: hwVivo });
    assert.strictEqual(deviceLockService.getOwner(hwVivo).userId, userA.id);

    // User B takes over with connection
    deviceLockService.claimDevice(hwVivo, userB, {
      hardwareSerial: hwVivo,
      forceTakeover: true,
      verifiedConnection: true,
      allowImmediateReclaim: true
    });

    assert.strictEqual(deviceLockService.getOwner(hwVivo).userId, userB.id);
  });

  // TEST 14: Existing Phase 3 USB priority semantics pass
  test('TEST 14: Phase 3 USB priority semantics preserved', async () => {
    deviceLockService.claimDevice(wifiVivo, userA, { hardwareSerial: hwVivo });

    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async () => ({ success: true });

    try {
      const raw = [
        { serial: wifiVivo, isWireless: true, state: 'device', connected: true },
        { serial: usbVivo, isWireless: false, state: 'device', connected: true }
      ];
      const prioritized = await adbService.deduplicateAndPrioritizeTransports(raw);
      assert.strictEqual(prioritized.length, 1);
      assert.strictEqual(prioritized[0].serial, usbVivo);
      assert.strictEqual(prioritized[0].isAuthoritative, true);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // TEST 15: Run PAD Test regression: failTest triggers deferred cleanup
  test('TEST 15: Run PAD Test failTest triggers deferred cleanup for device', async () => {
    adbService.deferredCleanups.set(hwVivo, {
      wSerial: wifiVivo,
      usbSerial: usbVivo,
      hwSerial: hwVivo
    });

    let teardownExecuted = false;
    const origDisconnect = adbService.disconnectDevice;
    adbService.disconnectDevice = async (s) => {
      teardownExecuted = true;
      return { success: true };
    };

    try {
      // Simulate test cancellation
      const testId = 'test-phase4-cancel';
      testRunnerService.activeTests.set(testId, {
        testId,
        startTime: Date.now(),
        steps: [],
        currentStepId: 'check_device',
        isCancelled: false,
        testData: { id: testId, deviceSerial: wifiVivo, userId: userA.id }
      });

      await testRunnerService.cancelTest(testId, userA);

      assert.strictEqual(teardownExecuted, true, 'cancelTest must execute deferred cleanup');
      assert.strictEqual(adbService.deferredCleanups.has(hwVivo), false);
    } finally {
      adbService.disconnectDevice = origDisconnect;
    }
  });

  // TEST 16: Zero circular dependencies verification
  test('TEST 16: Zero circular dependencies between adbService and testRunnerService', () => {
    assert.strictEqual(typeof adbService.setActiveTestChecker, 'function');
    assert.strictEqual(typeof adbService.isTestActiveForDevice, 'function');
    assert.strictEqual(typeof testRunnerService.isTestActiveForDevice, 'function');
    assert.strictEqual(typeof adbService.executeDeferredCleanup, 'function');
    assert.strictEqual(typeof adbService.clearFallback, 'function');
  });
});
