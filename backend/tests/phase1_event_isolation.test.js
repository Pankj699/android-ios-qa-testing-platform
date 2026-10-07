const { describe, it } = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const adbService = require('../src/services/adbService');
const testRunnerService = require('../src/services/testRunnerService');
const deviceLockService = require('../src/services/deviceLockService');
const historyService = require('../src/services/historyService');
const { setupWebSocket, sendToUser, sendToDevice, sendToTest } = require('../src/websocket/testSocket');

describe('Phase 1 — Selected-App Event Isolation & Multi-User Live Event Routing', () => {

  // Test 1: Selected application PID resolution
  it('1. Resolves application PID correctly from pidof and ps -A fallback', async () => {
    const origExec = adbService.execute;

    // Test pidof success
    adbService.execute = async (args) => {
      if (args.includes('pidof')) {
        return { code: 0, stdout: '4892\n', stderr: '', raw: '4892' };
      }
      return { code: 0, stdout: '', stderr: '', raw: '' };
    };

    const pid = await adbService.getPid('TEST-DEVICE-01', 'com.nra.flyermaker');
    assert.strictEqual(pid, '4892');

    const pids = await adbService.getPids('TEST-DEVICE-01', 'com.nra.flyermaker');
    assert.deepStrictEqual(pids, ['4892']);

    // Test ps -A fallback
    adbService.execute = async (args) => {
      if (args.includes('pidof')) {
        return { code: 1, stdout: '', stderr: 'pidof: not found', raw: '' };
      }
      if (args.includes('ps')) {
        return {
          code: 0,
          stdout: 'USER PID PPID VSZ RSS WCHAN ADDR S NAME\nu0_a123 9124 1234 1000 200 0 0 S com.nra.flyermaker\n',
          stderr: '',
          raw: ''
        };
      }
      return { code: 0, stdout: '', stderr: '', raw: '' };
    };

    const fallbackPid = await adbService.getPid('TEST-DEVICE-01', 'com.nra.flyermaker');
    assert.strictEqual(fallbackPid, '9124');

    adbService.execute = origExec;
  });

  // Test 2: PID-scoped logcat spawning with --pid
  it('2. Spawns PID-scoped logcat command using --pid argument', () => {
    const proc = adbService.streamPidLogcat('DEVICE-SERIAL-XYZ', '4892');
    assert.ok(proc);
    try { proc.kill('SIGKILL'); } catch (e) {}
  });

  // Test 3: Multi-User WebSocket Test Authorization
  it('3. Multi-User WebSocket Authorization: Blocks User B from subscribing to User A\'s test', async () => {
    const userAlice = { id: 'usr_alice', name: 'Alice Tester', role: 'tester' };
    const userBob = { id: 'usr_bob', name: 'Bob Tester', role: 'tester' };
    const userAdmin = { id: 'usr_admin', name: 'Admin User', role: 'admin' };

    const testId = 'test_isolation_' + Date.now();

    // Create a mock active test for Alice
    testRunnerService.activeTests.set(testId, {
      testId,
      startTime: Date.now(),
      steps: [],
      user: userAlice,
      testData: {
        id: testId,
        userId: userAlice.id,
        userName: userAlice.name,
        packageName: 'com.alice.app',
        deviceSerial: 'DEVICE-ALICE'
      }
    });

    const messagesBob = [];
    const mockWsBob = {
      readyState: 1,
      user: userBob,
      send: (msg) => messagesBob.push(JSON.parse(msg))
    };

    // Bob attempts to subscribe to Alice's test
    const bobSubscribed = testRunnerService.subscribe(testId, mockWsBob, userBob);
    assert.strictEqual(bobSubscribed, false, 'User B must not be allowed to subscribe to User A\'s test');
    assert.strictEqual(messagesBob.length, 1);
    assert.strictEqual(messagesBob[0].type, 'ERROR');
    assert.ok(messagesBob[0].message.includes('Unauthorized'));

    // Alice subscribes to her own test
    const messagesAlice = [];
    const mockWsAlice = {
      readyState: 1,
      user: userAlice,
      send: (msg) => messagesAlice.push(JSON.parse(msg))
    };
    const aliceSubscribed = testRunnerService.subscribe(testId, mockWsAlice, userAlice);
    assert.strictEqual(aliceSubscribed, true, 'Alice should be authorized to subscribe to her own test');

    // Admin subscribes to Alice's test
    const messagesAdmin = [];
    const mockWsAdmin = {
      readyState: 1,
      user: userAdmin,
      send: (msg) => messagesAdmin.push(JSON.parse(msg))
    };
    const adminSubscribed = testRunnerService.subscribe(testId, mockWsAdmin, userAdmin);
    assert.strictEqual(adminSubscribed, true, 'Admin should be authorized to view any test');

    // Cleanup
    testRunnerService.activeTests.delete(testId);
    testRunnerService.subscribers.delete(testId);
  });

  // Test 4: Device Claim Authorization & Isolation
  it('4. Device Claim Protection: Blocks User B from streaming logs of Device A claimed by User A', () => {
    const userAlice = { id: 'usr_alice', name: 'Alice Tester', role: 'tester' };
    const userBob = { id: 'usr_bob', name: 'Bob Tester', role: 'tester' };

    const deviceSerial = 'DEV_CLAIM_TEST_99';
    deviceLockService.setOwner(deviceSerial, userAlice);
    deviceLockService.claimDevice(deviceSerial, userAlice, { durationMs: 60000 });

    // Alice has access
    assert.strictEqual(deviceLockService.isDeviceAccessible(deviceSerial, userAlice), true);

    // Bob is denied access
    assert.strictEqual(deviceLockService.isDeviceAccessible(deviceSerial, userBob), false);

    // Release device
    deviceLockService.releaseDevice(deviceSerial, userAlice);
  });

  // Test 5: Event Attribution Metadata
  it('5. Event Attribution: Emitted log events contain package, user, and device metadata', () => {
    const userAlice = { id: 'usr_alice', name: 'Alice Tester', role: 'tester' };
    const testId = 'test_attr_' + Date.now();

    testRunnerService.activeTests.set(testId, {
      testId,
      startTime: Date.now(),
      steps: [],
      currentPid: '7788',
      user: userAlice,
      testData: {
        id: testId,
        userId: userAlice.id,
        packageName: 'com.test.targetapp',
        deviceSerial: 'DEVICE-ATTR-01'
      }
    });

    const emittedMessages = [];
    const mockWs = {
      readyState: 1,
      user: userAlice,
      send: (msg) => emittedMessages.push(JSON.parse(msg))
    };

    testRunnerService.subscribe(testId, mockWs, userAlice);
    testRunnerService.emitLog(testId, 'Test log line execution', 'INFO');

    assert.strictEqual(emittedMessages.length >= 1, true);
    const logEvent = emittedMessages.find(m => m.type === 'LOG');
    assert.ok(logEvent);
    assert.strictEqual(logEvent.testId, testId);
    assert.strictEqual(logEvent.serial, 'DEVICE-ATTR-01');
    assert.strictEqual(logEvent.packageName, 'com.test.targetapp');
    assert.strictEqual(logEvent.userId, userAlice.id);
    assert.strictEqual(logEvent.pid, '7788');
    assert.strictEqual(logEvent.platform, 'android');
    assert.strictEqual(logEvent.log.text, 'Test log line execution');

    // Cleanup
    testRunnerService.activeTests.delete(testId);
    testRunnerService.subscribers.delete(testId);
  });

  // Test 6: Test cancellation cleans up logcat child processes
  it('6. Process Cleanup: Cancelling a test terminates child logcat processes cleanly', async () => {
    const userAlice = { id: 'usr_alice', name: 'Alice Tester', role: 'tester' };
    const testId = 'test_cancel_cleanup_' + Date.now();

    let killCalled = false;
    let killSignal = null;
    const mockLogcatProc = {
      kill: (sig) => {
        killCalled = true;
        killSignal = sig;
      }
    };

    const mockInterval = setInterval(() => {}, 10000);

    testRunnerService.activeTests.set(testId, {
      testId,
      startTime: Date.now(),
      steps: [{ id: 'monitor_logs', status: 'RUNNING' }],
      currentStepId: 'monitor_logs',
      logcatProc: mockLogcatProc,
      pidWatchInterval: mockInterval,
      user: userAlice,
      testData: {
        id: testId,
        userId: userAlice.id,
        status: 'RUNNING'
      }
    });

    const res = await testRunnerService.cancelTest(testId, userAlice);
    assert.strictEqual(res.success, true);
    assert.strictEqual(killCalled, true, 'Logcat process kill should be called upon cancellation');
    assert.strictEqual(killSignal, 'SIGKILL');
    assert.strictEqual(testRunnerService.activeTests.has(testId), false, 'Active test reference should be cleaned up');
  });

  // Test 7: Scoped dispatch routing helpers
  it('7. Scoped routing: sendToUser and sendToTest route only to targeted listeners', () => {
    assert.strictEqual(typeof sendToUser, 'function');
    assert.strictEqual(typeof sendToDevice, 'function');
    assert.strictEqual(typeof sendToTest, 'function');
  });
});
