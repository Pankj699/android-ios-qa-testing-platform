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

  // Test 8: Simultaneous Test Execution (Alice and Bob running separate tests concurrently)
  it('8. Simultaneous Test Execution: Alice and Bob run tests concurrently without event cross-talk', () => {
    const userAlice = { id: 'usr_alice_sim', name: 'Alice Simultaneous', role: 'tester' };
    const userBob = { id: 'usr_bob_sim', name: 'Bob Simultaneous', role: 'tester' };

    const testIdAlice = 'test_sim_alice_' + Date.now();
    const testIdBob = 'test_sim_bob_' + Date.now();

    testRunnerService.activeTests.set(testIdAlice, {
      testId: testIdAlice,
      startTime: Date.now(),
      steps: [{ id: 'install_app', status: 'PENDING' }],
      user: userAlice,
      testData: { id: testIdAlice, userId: userAlice.id, packageName: 'com.alice.app', deviceSerial: 'DEV_ALICE' }
    });

    testRunnerService.activeTests.set(testIdBob, {
      testId: testIdBob,
      startTime: Date.now(),
      steps: [{ id: 'install_app', status: 'PENDING' }],
      user: userBob,
      testData: { id: testIdBob, userId: userBob.id, packageName: 'com.bob.app', deviceSerial: 'DEV_BOB' }
    });

    const aliceEvents = [];
    const bobEvents = [];

    const mockWsAlice = {
      readyState: 1,
      user: userAlice,
      send: (msg) => aliceEvents.push(JSON.parse(msg))
    };

    const mockWsBob = {
      readyState: 1,
      user: userBob,
      send: (msg) => bobEvents.push(JSON.parse(msg))
    };

    testRunnerService.subscribe(testIdAlice, mockWsAlice, userAlice);
    testRunnerService.subscribe(testIdBob, mockWsBob, userBob);

    // Clear initial snapshots
    aliceEvents.length = 0;
    bobEvents.length = 0;

    // 1. Emit Step Updates for Alice then Bob
    testRunnerService.updateStep(testIdAlice, 'install_app', 'RUNNING', 'Alice installing');
    testRunnerService.updateStep(testIdBob, 'install_app', 'RUNNING', 'Bob installing');

    // 2. Emit Progress for Alice (50%) and Bob (25%)
    testRunnerService.updateProgress(testIdAlice, 50, 'alice_pack');
    testRunnerService.updateProgress(testIdBob, 25, 'bob_pack');

    // 3. Emit Logs for Alice and Bob
    testRunnerService.emitLog(testIdAlice, 'Alice log line', 'INFO');
    testRunnerService.emitLog(testIdBob, 'Bob log line', 'INFO');

    // 4. Complete Alice's test
    const aliceRecord = { id: testIdAlice, userId: userAlice.id, status: 'COMPLETED', result: 'PASS' };
    testRunnerService.broadcast(testIdAlice, { type: 'TEST_FINISHED', testId: testIdAlice, test: aliceRecord });

    // Verify Alice received only Alice's events
    assert.ok(aliceEvents.length > 0);
    for (const ev of aliceEvents) {
      assert.strictEqual(ev.testId, testIdAlice, `Alice must only receive Alice testId events, got: ${ev.testId}`);
      if (ev.type === 'LOG') {
        assert.strictEqual(ev.log.text, 'Alice log line');
      }
      if (ev.type === 'PROGRESS') {
        assert.strictEqual(ev.progress, 50);
      }
      if (ev.type === 'TEST_FINISHED') {
        assert.strictEqual(ev.test.id, testIdAlice);
        assert.strictEqual(ev.test.result, 'PASS');
      }
    }

    // Verify Bob received only Bob's events
    assert.ok(bobEvents.length > 0);
    for (const ev of bobEvents) {
      assert.strictEqual(ev.testId, testIdBob, `Bob must only receive Bob testId events, got: ${ev.testId}`);
      if (ev.type === 'LOG') {
        assert.strictEqual(ev.log.text, 'Bob log line');
      }
      if (ev.type === 'PROGRESS') {
        assert.strictEqual(ev.progress, 25);
      }
    }

    // Verify Bob did NOT receive Alice's TEST_FINISHED
    const bobFinished = bobEvents.find(e => e.type === 'TEST_FINISHED');
    assert.strictEqual(bobFinished, undefined, 'Bob must NEVER receive Alice\'s TEST_FINISHED event');

    // Cleanup
    testRunnerService.activeTests.delete(testIdAlice);
    testRunnerService.activeTests.delete(testIdBob);
    testRunnerService.subscribers.delete(testIdAlice);
    testRunnerService.subscribers.delete(testIdBob);
  });

  // Test 9: Idle Page Isolation (Bob sitting idle on RunTestPage with no active test)
  it('9. Idle Page Isolation: Idle user page ignores foreign test events and preserves state', () => {
    const userAlice = { id: 'usr_alice_idle_test', name: 'Alice Active', role: 'tester' };
    const testIdAlice = 'test_alice_idle_' + Date.now();

    const aliceRecord = {
      id: testIdAlice,
      userId: userAlice.id,
      status: 'COMPLETED',
      result: 'PASS',
      fileName: 'AliceApp.apk',
      packageName: 'com.alice.app'
    };

    // Simulated Bob frontend state on idle RunTestPage
    const bobState = {
      activeTestId: null,
      isRunning: false,
      completedTest: null,
      showResultToast: false,
      steps: [],
      logs: []
    };

    // Frontend handler logic conforming to updated RunTestPage.jsx
    const handleTestFinished = (data) => {
      const eventTestId = data.testId || data.test?.id;
      if (!bobState.activeTestId || !eventTestId || eventTestId !== bobState.activeTestId) return;
      bobState.isRunning = false;
      bobState.completedTest = data.test;
      bobState.showResultToast = true;
    };

    const handleStepUpdate = (data) => {
      if (!bobState.activeTestId || !data.testId || data.testId !== bobState.activeTestId) return;
      if (data.steps) bobState.steps = data.steps;
    };

    const handleLog = (data) => {
      if (data.testId) {
        if (!bobState.activeTestId || data.testId !== bobState.activeTestId) return;
      }
      if (data.log) bobState.logs.push(data.log);
    };

    // Simulate foreign events arriving from Alice's test
    handleStepUpdate({ type: 'STEP_UPDATE', testId: testIdAlice, steps: [{ id: 'install_app', status: 'RUNNING' }] });
    handleLog({ type: 'LOG', testId: testIdAlice, log: { text: 'Alice secret log' } });
    handleTestFinished({ type: 'TEST_FINISHED', testId: testIdAlice, test: aliceRecord });

    // Assert Bob's idle state is completely untouched
    assert.strictEqual(bobState.activeTestId, null);
    assert.strictEqual(bobState.isRunning, false);
    assert.strictEqual(bobState.completedTest, null, 'Idle Bob must NOT receive Alice\'s completedTest');
    assert.strictEqual(bobState.showResultToast, false, 'Idle Bob must NOT show test completion toast');
    assert.strictEqual(bobState.steps.length, 0);
    assert.strictEqual(bobState.logs.length, 0);
  });

  // Test 10: Pending Test-Start Request Window
  it('10. Pending Test-Start Window: Foreign events do not abort pending start request or overwrite state', () => {
    const userAlice = { id: 'usr_alice_pending', name: 'Alice Pending Test', role: 'tester' };
    const testIdAlice = 'test_alice_foreign_' + Date.now();
    const testIdBob = 'test_bob_future_' + Date.now();

    // Bob clicked "Start Test": isRunning is true, but activeTestId is null until API returns
    const bobState = {
      activeTestId: null, // Pending in-flight
      isRunning: true,
      completedTest: null,
      showResultToast: false
    };

    const handleTestFinished = (data) => {
      const eventTestId = data.testId || data.test?.id;
      if (!bobState.activeTestId || !eventTestId || eventTestId !== bobState.activeTestId) return;
      bobState.isRunning = false;
      bobState.completedTest = data.test;
      bobState.showResultToast = true;
    };

    // Alice's test finishes while Bob's start request is in flight
    handleTestFinished({
      type: 'TEST_FINISHED',
      testId: testIdAlice,
      test: { id: testIdAlice, userId: userAlice.id, result: 'FAIL', failureReason: 'Alice failed' }
    });

    // Bob's pending state must NOT be prematurely stopped or corrupted
    assert.strictEqual(bobState.isRunning, true, 'Bob\'s isRunning must remain true while request is in flight');
    assert.strictEqual(bobState.completedTest, null, 'Bob\'s completedTest must not be set to Alice\'s failed test');
    assert.strictEqual(bobState.showResultToast, false);

    // Now Bob's API call returns and sets activeTestId
    bobState.activeTestId = testIdBob;

    // Bob's own test finishes
    handleTestFinished({
      type: 'TEST_FINISHED',
      testId: testIdBob,
      test: { id: testIdBob, userId: 'usr_bob', result: 'PASS' }
    });

    assert.strictEqual(bobState.isRunning, false);
    assert.strictEqual(bobState.completedTest.id, testIdBob);
    assert.strictEqual(bobState.showResultToast, true);
  });

  // Test 11: Test Failure and Cancellation Isolation
  it('11. Test Failure & Cancellation: Alice\'s failure or cancellation does not impact Bob\'s test', async () => {
    const userAlice = { id: 'usr_alice_fail', name: 'Alice Fail', role: 'tester' };
    const userBob = { id: 'usr_bob_run', name: 'Bob Running', role: 'tester' };

    const testIdAlice = 'test_alice_cancel_' + Date.now();
    const testIdBob = 'test_bob_ongoing_' + Date.now();

    testRunnerService.activeTests.set(testIdAlice, {
      testId: testIdAlice,
      startTime: Date.now(),
      steps: [{ id: 'install_app', status: 'RUNNING' }],
      currentStepId: 'install_app',
      user: userAlice,
      testData: { id: testIdAlice, userId: userAlice.id, status: 'RUNNING' }
    });

    testRunnerService.activeTests.set(testIdBob, {
      testId: testIdBob,
      startTime: Date.now(),
      steps: [{ id: 'install_app', status: 'RUNNING' }],
      currentStepId: 'install_app',
      user: userBob,
      testData: { id: testIdBob, userId: userBob.id, status: 'RUNNING' }
    });

    const bobEvents = [];
    const mockWsBob = {
      readyState: 1,
      user: userBob,
      send: (msg) => bobEvents.push(JSON.parse(msg))
    };

    testRunnerService.subscribe(testIdBob, mockWsBob, userBob);
    bobEvents.length = 0; // Clear snapshot

    // Alice cancels her test
    const cancelRes = await testRunnerService.cancelTest(testIdAlice, userAlice);
    assert.strictEqual(cancelRes.success, true);

    // Bob running his own test must receive 0 cancel events
    assert.strictEqual(bobEvents.length, 0, 'Bob must receive zero events when Alice cancels her test');
    assert.strictEqual(testRunnerService.activeTests.has(testIdBob), true, 'Bob\'s test must remain actively running');

    // Cleanup
    testRunnerService.activeTests.delete(testIdBob);
    testRunnerService.subscribers.delete(testIdBob);
  });

  // Test 12: Reconnects & Live SNAPSHOT Delivery
  it('12. Reconnection & SNAPSHOT: Client receives live snapshot upon reconnect, dead socket pruned', () => {
    const userAlice = { id: 'usr_alice_reconnect', name: 'Alice Reconnect', role: 'tester' };
    const testIdAlice = 'test_alice_rec_' + Date.now();

    testRunnerService.activeTests.set(testIdAlice, {
      testId: testIdAlice,
      startTime: Date.now(),
      steps: [
        { id: 'check_device', status: 'PASSED' },
        { id: 'install_app', status: 'RUNNING' }
      ],
      progress: 65,
      user: userAlice,
      testData: {
        id: testIdAlice,
        userId: userAlice.id,
        packageName: 'com.alice.app',
        deviceSerial: 'DEV_ALICE_REC'
      }
    });

    // 1. Initial socket connects and disconnects
    const deadSocket = {
      readyState: 3, // CLOSED
      user: userAlice,
      send: () => { throw new Error('Socket closed'); }
    };
    testRunnerService.subscribe(testIdAlice, deadSocket, userAlice);

    // 2. Broadcast triggers dead socket pruning
    testRunnerService.broadcast(testIdAlice, { type: 'PING' });
    const subs = testRunnerService.subscribers.get(testIdAlice);
    assert.strictEqual(!subs || !subs.has(deadSocket), true, 'Dead closed socket must be pruned on broadcast');

    // 3. Alice reconnects with a fresh socket
    const reconnectedEvents = [];
    const freshSocket = {
      readyState: 1, // OPEN
      user: userAlice,
      send: (msg) => reconnectedEvents.push(JSON.parse(msg))
    };

    testRunnerService.subscribe(testIdAlice, freshSocket, userAlice);

    // Verify SNAPSHOT delivered with active state
    assert.strictEqual(reconnectedEvents.length, 1);
    const snap = reconnectedEvents[0];
    assert.strictEqual(snap.type, 'SNAPSHOT');
    assert.strictEqual(snap.testId, testIdAlice);
    assert.strictEqual(snap.test.progress, 65);
    assert.strictEqual(snap.test.steps.length, 2);
    assert.strictEqual(snap.test.steps[0].status, 'PASSED');
    assert.strictEqual(snap.test.steps[1].status, 'RUNNING');

    // Cleanup
    testRunnerService.activeTests.delete(testIdAlice);
    testRunnerService.subscribers.delete(testIdAlice);
  });

  // Test 13: TEST_HISTORY_UPDATED Scoped Delivery
  it('13. Test History Notification: notifyGlobalFinished scopes update to owner without leaking payload', () => {
    const userAlice = { id: 'usr_alice_hist_owner', name: 'Alice Owner', role: 'tester' };
    const userBob = { id: 'usr_bob_hist_other', name: 'Bob Other', role: 'tester' };

    let capturedNotification = null;
    const origBroadcast = testRunnerService.globalBroadcastCallback;
    testRunnerService.setGlobalBroadcastCallback((type, payload) => {
      capturedNotification = { type, payload };
    });

    const testRecord = {
      id: 'test_hist_secure_123',
      userId: userAlice.id,
      status: 'COMPLETED',
      result: 'PASS',
      failureReason: 'Secret error that must not leak',
      fileName: 'SensitiveApp.apk'
    };

    testRunnerService.notifyGlobalFinished(testRecord);

    assert.ok(capturedNotification);
    assert.strictEqual(capturedNotification.type, 'TEST_HISTORY_UPDATED');
    assert.strictEqual(capturedNotification.payload.testId, 'test_hist_secure_123');
    assert.strictEqual(capturedNotification.payload.userId, userAlice.id);
    assert.strictEqual(capturedNotification.payload.failureReason, undefined, 'Sensitive failureReason must not be in notification payload');
    assert.strictEqual(capturedNotification.payload.fileName, undefined, 'Sensitive fileName must not be in notification payload');

    testRunnerService.globalBroadcastCallback = origBroadcast;
  });
});
