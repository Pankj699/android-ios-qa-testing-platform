const { describe, test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const testRunnerService = require('../src/services/testRunnerService');
const historyService = require('../src/services/historyService');

describe('Run PAD Test - Event Persistence & Live Continuity Test Suite', () => {
  let padExecutionManager;
  let mockSocket;
  let mockApi;
  let sentSocketMessages = [];
  let socketSubscriptions = new Map();

  before(async () => {
    // Mock environment globals
    global.window = {
      location: { protocol: 'http:', host: 'localhost:5000' }
    };

    const managerPath = path.resolve(__dirname, '../../frontend/src/services/padExecutionManager.js');
    const module = await import(pathToFileURL(managerPath).href);
    padExecutionManager = module.padExecutionManager;
  });

  beforeEach(() => {
    sentSocketMessages = [];
    socketSubscriptions = new Map();

    mockSocket = {
      connect: () => {},
      subscribeToTest: (tid) => {
        sentSocketMessages.push({ action: 'SUBSCRIBE', testId: tid });
      },
      send: (msg) => {
        sentSocketMessages.push(msg);
      },
      on: (eventType, cb) => {
        if (!socketSubscriptions.has(eventType)) {
          socketSubscriptions.set(eventType, new Set());
        }
        socketSubscriptions.get(eventType).add(cb);
        return () => socketSubscriptions.get(eventType)?.delete(cb);
      },
      emit: (eventType, data) => {
        const cbs = socketSubscriptions.get(eventType);
        if (cbs) {
          cbs.forEach((fn) => fn(data));
        }
      }
    };

    mockApi = {
      getCurrentUser: () => ({ id: 'user_alice_123', name: 'Alice QA', role: 'tester' }),
      cancelTest: async (tid) => ({ success: true, message: `Cancelled ${tid}` })
    };

    padExecutionManager.socketService = mockSocket;
    padExecutionManager.api = mockApi;
    padExecutionManager.resetForUser('user_alice_123');
    padExecutionManager.listeners.clear();
    padExecutionManager.initialized = false;
    padExecutionManager.init();
  });

  // Test 1: Event Capture across Categories
  test('1. Captures API calls, catalogs/events, crashes, errors, QA actions, and app logs into manager', () => {
    const testId = 'test_session_001';
    padExecutionManager.startSession({
      testId,
      deviceSerial: 'DEVICE_01',
      packageName: 'com.nra.flyermaker',
      initialSteps: [{ id: 'step_1', label: 'Init', status: 'RUNNING' }],
      userId: 'user_alice_123'
    });

    // 1. QA Action
    mockSocket.emit('LOG', {
      testId,
      log: { time: '12:00:01', text: '✓ Checking Prerequisites (Java, ADB, Bundletool)', level: 'INFO' }
    });

    // 2. Volley HTTP API Call
    mockSocket.emit('LOG', {
      testId,
      log: {
        time: '12:00:02',
        text: 'Volley: HTTP response for request=<[POST] https://api.flyer.com/v1/generate> [lifetime=240], [size=1024], [rc=200]',
        level: 'INFO'
      }
    });

    // 3. App Crash
    mockSocket.emit('LOG', {
      testId,
      log: { time: '12:00:03', text: 'FATAL EXCEPTION: main Process: com.nra.flyermaker', level: 'ERROR' }
    });

    // 4. General App Logcat
    mockSocket.emit('LOG', {
      testId,
      log: { time: '12:00:04', text: 'Rendering flyer editor surface', level: 'DEBUG' }
    });

    const state = padExecutionManager.getState();
    assert.strictEqual(state.logs.length, 4);
    assert.strictEqual(state.activeTestId, testId);
    assert.strictEqual(state.isRunning, true);
    assert.ok(state.logs[0].text.includes('Checking Prerequisites'));
    assert.ok(state.logs[1].text.includes('Volley'));
    assert.ok(state.logs[2].text.includes('FATAL EXCEPTION'));
    assert.ok(state.logs[3].text.includes('Rendering flyer editor'));
  });

  // Test 2: Tab Navigation Preservation (Simulate RunTestPage unmount and remount)
  test('2. Preserves captured events when UI component unmounts and remounts during tab navigation', () => {
    const testId = 'test_nav_002';
    padExecutionManager.startSession({
      testId,
      deviceSerial: 'DEVICE_01',
      packageName: 'com.nra.flyermaker',
      initialSteps: [{ id: 'step_install', label: 'Installing', status: 'RUNNING' }],
      userId: 'user_alice_123'
    });

    mockSocket.emit('LOG', {
      testId,
      log: { time: '12:05:00', text: '[API] POST https://api.flyer.com/v1/login 200 (150ms)', level: 'INFO' }
    });

    // Simulate RunTestPage mounting: it subscribes
    let uiReceivedLogs = [];
    let uiActiveId = null;
    const unsubUi = padExecutionManager.subscribe((st) => {
      uiReceivedLogs = st.logs;
      uiActiveId = st.activeTestId;
    });

    assert.strictEqual(uiReceivedLogs.length, 1);
    assert.strictEqual(uiActiveId, testId);

    // User navigates away to BugDesk -> RunTestPage unmounts, calls unsubUi()
    unsubUi();

    // Verify manager retains the event history in memory
    const stateWhileAway = padExecutionManager.getState();
    assert.strictEqual(stateWhileAway.logs.length, 1);
    assert.strictEqual(stateWhileAway.activeTestId, testId);

    // User returns to Run PAD Test -> RunTestPage mounts again and subscribes
    let returnedUiLogs = [];
    const unsubReturn = padExecutionManager.subscribe((st) => {
      returnedUiLogs = st.logs;
    });

    // History is immediately restored!
    assert.strictEqual(returnedUiLogs.length, 1);
    assert.strictEqual(returnedUiLogs[0].text, '[API] POST https://api.flyer.com/v1/login 200 (150ms)');
    unsubReturn();
  });

  // Test 3: Live Event Streaming While User Is on Another Tab
  test('3. Continues capturing live events while user is viewing another tab and restores all in order', () => {
    const testId = 'test_away_003';
    padExecutionManager.startSession({
      testId,
      deviceSerial: 'DEVICE_02',
      packageName: 'com.nra.flyermaker',
      initialSteps: [{ id: 'step_1', label: 'Step 1', status: 'RUNNING' }],
      userId: 'user_alice_123'
    });

    // Log 1: Captured before navigating
    mockSocket.emit('LOG', {
      testId,
      log: { time: '12:10:00', text: 'Log before navigation', level: 'INFO' }
    });

    // User navigates to BugDesk / ScreenMirror (no UI subscriber)
    assert.strictEqual(padExecutionManager.listeners.size, 0);

    // Events continue arriving in real time from backend socket while user is away!
    mockSocket.emit('LOG', {
      testId,
      log: { time: '12:10:02', text: 'API call while on BugDesk', level: 'INFO' }
    });
    mockSocket.emit('STEP_UPDATE', {
      testId,
      steps: [
        { id: 'step_1', label: 'Step 1', status: 'PASSED' },
        { id: 'step_2', label: 'Step 2', status: 'RUNNING' }
      ]
    });
    mockSocket.emit('LOG', {
      testId,
      log: { time: '12:10:05', text: 'Background download complete', level: 'INFO' }
    });

    // User navigates back to Run PAD Test
    let currentLogs = [];
    let currentSteps = [];
    padExecutionManager.subscribe((st) => {
      currentLogs = st.logs;
      currentSteps = st.steps;
    });

    // All 3 logs exist in exact chronological order
    assert.strictEqual(currentLogs.length, 3);
    assert.strictEqual(currentLogs[0].text, 'Log before navigation');
    assert.strictEqual(currentLogs[1].text, 'API call while on BugDesk');
    assert.strictEqual(currentLogs[2].text, 'Background download complete');

    // Steps were also updated in background
    assert.strictEqual(currentSteps.length, 2);
    assert.strictEqual(currentSteps[0].status, 'PASSED');
    assert.strictEqual(currentSteps[1].status, 'RUNNING');
  });

  // Test 4: WebSocket Reconnection Recovery & Deduplication
  test('4. Merges SNAPSHOT logs without duplicate entries upon reconnection', () => {
    const testId = 'test_recon_004';
    padExecutionManager.startSession({
      testId,
      deviceSerial: 'DEVICE_03',
      packageName: 'com.nra.flyermaker',
      userId: 'user_alice_123'
    });

    mockSocket.emit('LOG', {
      testId,
      log: { time: '12:20:00', text: 'Unique Event Alpha', level: 'INFO' }
    });
    mockSocket.emit('LOG', {
      testId,
      log: { time: '12:20:01', text: 'Unique Event Beta', level: 'INFO' }
    });

    assert.strictEqual(padExecutionManager.getState().logs.length, 2);

    // Simulate WebSocket disconnect and reconnect receiving SNAPSHOT with both existing and missed events
    mockSocket.emit('SNAPSHOT', {
      testId,
      test: {
        id: testId,
        status: 'RUNNING',
        logs: [
          { time: '12:20:00', text: 'Unique Event Alpha', level: 'INFO' }, // Existing (must not duplicate)
          { time: '12:20:01', text: 'Unique Event Beta', level: 'INFO' },  // Existing (must not duplicate)
          { time: '12:20:02', text: 'Missed Event Gamma', level: 'INFO' }  // New
        ]
      }
    });

    const logs = padExecutionManager.getState().logs;
    assert.strictEqual(logs.length, 3, 'Should deduplicate existing and append missed log');
    assert.strictEqual(logs[0].text, 'Unique Event Alpha');
    assert.strictEqual(logs[1].text, 'Unique Event Beta');
    assert.strictEqual(logs[2].text, 'Missed Event Gamma');
  });

  // Test 5: Bounded Memory Retention (No Unbounded Growth)
  test('5. Enforces bounded memory limits across high volume logs, capping API/Crash logs and general logs', () => {
    const testId = 'test_bounds_005';
    padExecutionManager.startSession({
      testId,
      deviceSerial: 'DEVICE_04',
      packageName: 'com.nra.flyermaker',
      userId: 'user_alice_123'
    });

    // Emit 3,500 logs total (1,500 API calls + 2,000 general logcat)
    for (let i = 0; i < 1500; i++) {
      mockSocket.emit('LOG', {
        testId,
        log: { time: '12:30:00', text: `[API] POST /api/item/${i} 200`, level: 'INFO', api: { endpoint: `/item/${i}` } }
      });
    }
    for (let i = 0; i < 2000; i++) {
      mockSocket.emit('LOG', {
        testId,
        log: { time: '12:30:01', text: `General logcat message line ${i}`, level: 'DEBUG' }
      });
    }

    const logs = padExecutionManager.getState().logs;
    // Total logs must never exceed 3,000
    assert.ok(logs.length <= 3000, `Logs length ${logs.length} exceeded 3000`);

    // Verify bounded retention: retains the most recent 1,000 API and 2,000 general logs
    const apiCount = logs.filter((l) => (l.text || '').includes('[API]')).length;
    const genCount = logs.filter((l) => (l.text || '').includes('General logcat')).length;

    assert.strictEqual(apiCount, 1000, 'API logs should be bounded to 1,000');
    assert.strictEqual(genCount, 2000, 'General logs should be bounded to 2,000');
  });

  // Test 6: Session Isolation Between Different PAD Runs
  test('6. Starting a new PAD execution creates an isolated session and does not mix with previous run', () => {
    // Run 1
    padExecutionManager.startSession({
      testId: 'run_alpha_01',
      deviceSerial: 'DEVICE_01',
      packageName: 'com.example.appA',
      userId: 'user_alice_123'
    });
    mockSocket.emit('LOG', {
      testId: 'run_alpha_01',
      log: { time: '12:40:00', text: 'App A log line 1', level: 'INFO' }
    });
    assert.strictEqual(padExecutionManager.getState().logs.length, 1);
    assert.strictEqual(padExecutionManager.getState().logs[0].text, 'App A log line 1');

    // Run 2 starts
    padExecutionManager.startSession({
      testId: 'run_beta_02',
      deviceSerial: 'DEVICE_02',
      packageName: 'com.example.appB',
      userId: 'user_alice_123'
    });

    assert.strictEqual(padExecutionManager.getState().activeTestId, 'run_beta_02');
    assert.strictEqual(padExecutionManager.getState().logs.length, 0, 'New session starts with fresh logs');

    // Late log from Run 1 arrives via socket
    mockSocket.emit('LOG', {
      testId: 'run_alpha_01',
      log: { time: '12:40:05', text: 'App A delayed log', level: 'INFO' }
    });

    // Must be ignored because activeTestId is run_beta_02
    assert.strictEqual(padExecutionManager.getState().logs.length, 0);

    // Log from Run 2 arrives
    mockSocket.emit('LOG', {
      testId: 'run_beta_02',
      log: { time: '12:41:00', text: 'App B log line 1', level: 'INFO' }
    });
    assert.strictEqual(padExecutionManager.getState().logs.length, 1);
    assert.strictEqual(padExecutionManager.getState().logs[0].text, 'App B log line 1');
  });

  // Test 7: Multi-User Isolation
  test('7. Prevents User B from accessing or viewing User A event history', () => {
    // User Alice runs a test
    padExecutionManager.startSession({
      testId: 'test_alice_secret',
      deviceSerial: 'DEVICE_ALICE',
      packageName: 'com.alice.app',
      userId: 'user_alice_123'
    });
    mockSocket.emit('LOG', {
      testId: 'test_alice_secret',
      log: { time: '12:50:00', text: 'Confidential Alice data', level: 'INFO' }
    });
    assert.strictEqual(padExecutionManager.getState().logs.length, 1);

    // User switches to Bob
    padExecutionManager.resetForUser('user_bob_456');

    const bobState = padExecutionManager.getState();
    assert.strictEqual(bobState.activeTestId, null);
    assert.strictEqual(bobState.logs.length, 0);
    assert.strictEqual(bobState.userId, 'user_bob_456');

    // Alice log should be ignored
    mockSocket.emit('LOG', {
      testId: 'test_alice_secret',
      log: { time: '12:50:05', text: 'Another Alice secret', level: 'INFO' }
    });
    assert.strictEqual(padExecutionManager.getState().logs.length, 0);
  });

  // Test 8: Logcat Stream Continuity & Legitimate Stop
  test('8. Keeps logcat active across navigation and stops only on test completion or cancel', () => {
    padExecutionManager.startSession({
      testId: 'test_lifecycle_008',
      deviceSerial: 'DEVICE_DEV_01',
      packageName: 'com.test.app',
      userId: 'user_alice_123'
    });

    const startMsg = sentSocketMessages.find((m) => m.action === 'DEVICE_LOGCAT_START');
    assert.ok(startMsg);
    assert.strictEqual(startMsg.serial, 'DEVICE_DEV_01');

    // Simulating tab switch (subscriber unmounts)
    let unsub = padExecutionManager.subscribe(() => {});
    unsub();

    // No DEVICE_LOGCAT_STOP should be sent merely because UI unmounted!
    const stopMsgWhileAway = sentSocketMessages.find((m) => m.action === 'DEVICE_LOGCAT_STOP');
    assert.strictEqual(stopMsgWhileAway, undefined, 'Must not stop logcat on component unmount');

    // Test finishes
    mockSocket.emit('TEST_FINISHED', {
      testId: 'test_lifecycle_008',
      test: { id: 'test_lifecycle_008', status: 'COMPLETED' }
    });

    // Now DEVICE_LOGCAT_STOP should be legitimately sent
    const stopMsg = sentSocketMessages.find((m) => m.action === 'DEVICE_LOGCAT_STOP');
    assert.ok(stopMsg, 'DEVICE_LOGCAT_STOP must be sent when test finishes');
    assert.strictEqual(stopMsg.serial, 'DEVICE_DEV_01');
    assert.strictEqual(padExecutionManager.getState().isRunning, false);
  });

  // Test 9: Explicit Clear Logs
  test('9. Explicit clearLogs empties current log buffer without disrupting active session', () => {
    padExecutionManager.startSession({
      testId: 'test_clear_009',
      deviceSerial: 'DEVICE_05',
      packageName: 'com.test.clear',
      userId: 'user_alice_123'
    });

    mockSocket.emit('LOG', {
      testId: 'test_clear_009',
      log: { time: '13:00:00', text: 'Log before clear', level: 'INFO' }
    });
    assert.strictEqual(padExecutionManager.getState().logs.length, 1);

    // User clicks trash icon
    padExecutionManager.clearLogs();
    assert.strictEqual(padExecutionManager.getState().logs.length, 0);
    assert.strictEqual(padExecutionManager.getState().isRunning, true);
    assert.strictEqual(padExecutionManager.getState().activeTestId, 'test_clear_009');

    // Subsequent logs continue streaming
    mockSocket.emit('LOG', {
      testId: 'test_clear_009',
      log: { time: '13:00:05', text: 'Log after clear', level: 'INFO' }
    });
    assert.strictEqual(padExecutionManager.getState().logs.length, 1);
    assert.strictEqual(padExecutionManager.getState().logs[0].text, 'Log after clear');
  });

  // Test 10: Backend Active Test Buffer and Recovery
  test('10. Backend testRunnerService maintains active test log buffer and emits SNAPSHOT with logs', () => {
    const testId = 'test_backend_active_010';
    testRunnerService.activeTests.set(testId, {
      testId,
      startTime: Date.now(),
      steps: [{ id: 'step_init', status: 'RUNNING' }],
      status: 'RUNNING',
      progress: 50,
      logs: [],
      testData: {
        id: testId,
        userId: 'user_alice_123',
        deviceSerial: 'DEVICE_BACKEND_01',
        packageName: 'com.backend.test'
      }
    });

    testRunnerService.emitLog(testId, 'Backend active log line 1', 'INFO', { api: { endpoint: '/api/status' } });
    testRunnerService.emitLog(testId, 'Backend active log line 2', 'INFO');

    const active = testRunnerService.activeTests.get(testId);
    assert.ok(active.logs);
    assert.strictEqual(active.logs.length, 2);
    assert.strictEqual(active.logs[0].text, 'Backend active log line 1');
    assert.ok(active.logs[0].api);

    // Test WebSocket subscribe snapshot
    const sentSnapshot = [];
    const mockWs = {
      readyState: 1,
      user: { id: 'user_alice_123', role: 'tester' },
      send: (str) => sentSnapshot.push(JSON.parse(str))
    };

    const subResult = testRunnerService.subscribe(testId, mockWs);
    assert.strictEqual(subResult, true);
    assert.strictEqual(sentSnapshot.length, 1);
    assert.strictEqual(sentSnapshot[0].type, 'SNAPSHOT');
    assert.strictEqual(sentSnapshot[0].test.logs.length, 2);

    testRunnerService.activeTests.delete(testId);
  });
});
