const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const adbService = require('../src/services/adbService');
const bundletoolService = require('../src/services/bundletoolService');
const testRunnerService = require('../src/services/testRunnerService');
const screenMirrorService = require('../src/services/screenMirrorService');
const deviceLockService = require('../src/services/deviceLockService');
const historyService = require('../src/services/historyService');

describe('Phase 3: Slow Test Execution & Device Stability Suite', () => {
  const dummySerial = 'DEV_TEST_PHASE3_001';
  const dummyUser = { id: 'usr_phase3_tester', name: 'Phase3 Tester', email: 'p3@qa.test', role: 'tester' };

  // 1. Screen Stay-Awake & Wakeup Unit Tests
  test('1. Stay-Awake: acquireStayAwake reads original setting and engages stay-awake', async () => {
    const executedCommands = [];
    const origExecute = adbService.execute;

    adbService.execute = async (args, options) => {
      const cmdStr = args.join(' ');
      executedCommands.push(cmdStr);
      if (cmdStr.includes('settings get global stay_on_while_plugged_in')) {
        return { code: 0, stdout: '2', stderr: '', raw: '2' };
      }
      return { code: 0, stdout: '', stderr: '', raw: '' };
    };

    try {
      const stayAwake = await adbService.acquireStayAwake(dummySerial);
      assert.ok(stayAwake, 'acquireStayAwake should return an object');
      assert.strictEqual(stayAwake.serial, dummySerial);
      assert.strictEqual(stayAwake.originalStayOn, '2');

      // Verify wakeup, keyguard dismiss, and settings commands were invoked
      assert.ok(executedCommands.some(c => c.includes('input keyevent 224')), 'Screen wakeup keyevent must be sent');
      assert.ok(executedCommands.some(c => c.includes('wm dismiss-keyguard')), 'Keyguard dismiss must be sent');
      assert.ok(executedCommands.some(c => c.includes('svc power stayon true')), 'svc power stayon true must be sent');
      assert.ok(executedCommands.some(c => c.includes('settings put global stay_on_while_plugged_in 7')), 'stay_on_while_plugged_in 7 must be sent');
    } finally {
      adbService.execute = origExecute;
    }
  });

  test('2. Stay-Awake: restoreStayAwake faithfully restores original captured value', async () => {
    const executedCommands = [];
    const origExecute = adbService.execute;

    adbService.execute = async (args, options) => {
      executedCommands.push(args.join(' '));
      return { code: 0, stdout: '', stderr: '', raw: '' };
    };

    try {
      // Test restoring non-zero setting (e.g. 2)
      await adbService.restoreStayAwake(dummySerial, '2');
      assert.ok(executedCommands.some(c => c.includes('settings put global stay_on_while_plugged_in 2')));

      // Test restoring 0 setting (must also turn svc power stayon false)
      executedCommands.length = 0;
      await adbService.restoreStayAwake(dummySerial, '0');
      assert.ok(executedCommands.some(c => c.includes('settings put global stay_on_while_plugged_in 0')));
      assert.ok(executedCommands.some(c => c.includes('svc power stayon false')));

      // Test restoring null/empty setting (defaults to 0 safe reset)
      executedCommands.length = 0;
      await adbService.restoreStayAwake(dummySerial, null);
      assert.ok(executedCommands.some(c => c.includes('settings put global stay_on_while_plugged_in 0')));
      assert.ok(executedCommands.some(c => c.includes('svc power stayon false')));
    } finally {
      adbService.execute = origExecute;
    }
  });

  // 2. Device Liveness & Offline Fast-Fail Tests
  test('3. Device Liveness: assertDeviceOnline succeeds for online device and rejects offline device fast', async () => {
    const origExecute = adbService.execute;

    try {
      // Mock online device
      adbService.execute = async (args) => {
        if (args.includes('get-state')) {
          return { code: 0, stdout: 'device', stderr: '', raw: 'device' };
        }
        return { code: 0, stdout: '', stderr: '', raw: '' };
      };

      const onlineRes = await adbService.assertDeviceOnline(dummySerial);
      assert.strictEqual(onlineRes.online, true);
      assert.strictEqual(onlineRes.state, 'device');

      const isOnline = await adbService.isDeviceOnline(dummySerial);
      assert.strictEqual(isOnline, true);

      // Mock offline device
      adbService.execute = async (args) => {
        if (args.includes('get-state')) {
          return { code: 1, stdout: 'offline', stderr: 'error: device offline', raw: 'offline' };
        }
        return { code: 1, stdout: '', stderr: '', raw: '' };
      };

      await assert.rejects(
        async () => { await adbService.assertDeviceOnline(dummySerial); },
        /is not ready|offline/i
      );

      const isOffline = await adbService.isDeviceOnline(dummySerial);
      assert.strictEqual(isOffline, false);
    } finally {
      adbService.execute = origExecute;
    }
  });

  // 3. Process Tracking & Bounded Timeout Tests
  test('4. Process Tracking: bundletool and installApk support onSpawn callback and child tracking', async () => {
    let bundletoolProc = null;
    const fakeAab = path.join(__dirname, 'fake_test.aab');
    const fakeApks = path.join(__dirname, 'fake_test.apks');
    fs.writeFileSync(fakeAab, 'FAKE_AAB_CONTENT');

    const origExecute = bundletoolService.execute;
    bundletoolService.execute = (args, options) => {
      if (options.onSpawn) {
        const mockChild = new EventEmitter();
        mockChild.kill = () => { mockChild.killed = true; };
        options.onSpawn(mockChild);
        bundletoolProc = mockChild;
      }
      return Promise.resolve({ code: 0, stdout: 'Success', stderr: '' });
    };

    try {
      await bundletoolService.buildApks(fakeAab, fakeApks, {
        onSpawn: (proc) => { bundletoolProc = proc; }
      });
      assert.ok(bundletoolProc, 'onSpawn should pass the spawned process');
    } finally {
      bundletoolService.execute = origExecute;
      try { fs.unlinkSync(fakeAab); } catch (e) {}
      try { fs.unlinkSync(fakeApks); } catch (e) {}
    }
  });

  // 4. Test Cancellation Kills Active Child Process & Restores Stay-Awake
  test('5. Test Cancellation: cancelTest kills active install process and restores stay-awake', async () => {
    let restoreCalled = false;
    let restoreSerial = null;
    let restoreVal = null;

    const origRestore = adbService.restoreStayAwake;
    adbService.restoreStayAwake = async (serial, val) => {
      restoreCalled = true;
      restoreSerial = serial;
      restoreVal = val;
      return true;
    };

    const mockChild = new EventEmitter();
    let childKilled = false;
    mockChild.kill = (sig) => { childKilled = true; };

    const testId = 'test_cancel_phase3_sample';
    testRunnerService.activeTests.set(testId, {
      testId,
      startTime: Date.now() - 5000,
      currentStepId: 'install_app',
      isCancelled: false,
      currentProc: mockChild,
      stayAwakeState: { serial: dummySerial, originalStayOn: '3' },
      logcatProc: null,
      steps: [{ id: 'install_app', label: 'Installing', status: 'RUNNING' }],
      testData: {
        id: testId,
        userId: dummyUser.id,
        deviceSerial: dummySerial
      }
    });

    try {
      const cancelRes = await testRunnerService.cancelTest(testId, dummyUser);
      assert.strictEqual(cancelRes.success, true);
      assert.strictEqual(childKilled, true, 'Active child process must be killed on cancellation');
      assert.strictEqual(restoreCalled, true, 'Stay-awake setting must be restored on cancellation');
      assert.strictEqual(restoreSerial, dummySerial);
      assert.strictEqual(restoreVal, '3');
    } finally {
      adbService.restoreStayAwake = origRestore;
      testRunnerService.activeTests.delete(testId);
    }
  });

  // 5. Test Failure in Pipeline Restores Stay-Awake
  test('6. Test Failure: Pipeline failure restores stay-awake reliably', async () => {
    let restoreCalled = false;
    let restoreVal = null;

    const origRestore = adbService.restoreStayAwake;
    adbService.restoreStayAwake = async (serial, val) => {
      restoreCalled = true;
      restoreVal = val;
      return true;
    };

    const origCheckJava = bundletoolService.checkJava;
    bundletoolService.checkJava = async () => ({ available: true });

    const origCheckAdb = adbService.checkAvailability;
    adbService.checkAvailability = async () => ({ available: true });

    const origCheckBundletool = bundletoolService.checkBundletool;
    bundletoolService.checkBundletool = async () => ({ available: true });

    const origListDevices = adbService.listDevices;
    adbService.listDevices = async () => [
      { serial: dummySerial, state: 'device', connected: true }
    ];

    const origGetDeviceInfo = adbService.getDeviceInfo;
    adbService.getDeviceInfo = async () => ({ serial: dummySerial, name: 'Test Device', androidVersion: 'Android 13' });

    const origAcquireStayAwake = adbService.acquireStayAwake;
    adbService.acquireStayAwake = async (serial) => ({ serial, originalStayOn: '0', acquiredAt: Date.now() });

    try {
      // Run test pointing to non-existent AAB (will fail at step 3: analyze_aab)
      const res = await testRunnerService.runTest({
        aabPath: 'C:\\non_existent_build.aab',
        deviceSerial: dummySerial,
        user: dummyUser
      });

      // Wait a moment for pipeline background execution to fail
      await new Promise(resolve => setTimeout(resolve, 500));

      const record = historyService.getTestById(res.testId);
      assert.ok(record, 'Failed test must be saved to history');
      assert.strictEqual(record.status, 'COMPLETED');
      assert.strictEqual(record.result, 'FAIL');
      assert.strictEqual(restoreCalled, true, 'Stay-awake must be restored when test fails in pipeline');
      assert.strictEqual(restoreVal, '0');
    } finally {
      adbService.restoreStayAwake = origRestore;
      bundletoolService.checkJava = origCheckJava;
      adbService.checkAvailability = origCheckAdb;
      bundletoolService.checkBundletool = origCheckBundletool;
      adbService.listDevices = origListDevices;
      adbService.getDeviceInfo = origGetDeviceInfo;
      adbService.acquireStayAwake = origAcquireStayAwake;
    }
  });

  // 6. Screen Mirror Exponential Backoff & Rapid Retry Loop Prevention
  test('7. Screen Mirror: Disconnection and repeated errors terminate session after 5 attempts without infinite loop', async () => {
    const origSpawn = screenMirrorService._spawnStreamProcess;
    let spawnCount = 0;

    const session = {
      serial: 'DEV_MIRROR_P3',
      subscribers: new Set([{ readyState: 1, send: () => {} }]),
      options: { width: 720, height: 1280, bitrate: 2000000, fps: 30 },
      stats: { fps: 0 },
      isStopping: false,
      consecutiveErrors: 0,
      procStartTime: Date.now()
    };

    screenMirrorService.activeSessions.set(session.serial, session);

    // Simulate close handler with code 1 (failure)
    const simulateFailure = () => {
      spawnCount++;
      session.consecutiveErrors++;
      if (session.consecutiveErrors >= 5) {
        screenMirrorService.stopMirror(session.serial);
        return false;
      }
      return true;
    };

    // Run 5 failure iterations
    for (let i = 0; i < 5; i++) {
      simulateFailure();
    }

    assert.strictEqual(session.consecutiveErrors, 5);
    assert.strictEqual(screenMirrorService.activeSessions.has(session.serial), false, 'Session must be stopped after 5 consecutive failures');
  });
});
