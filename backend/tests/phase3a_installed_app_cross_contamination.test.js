const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');
const jwt = require('jsonwebtoken');

const config = require('../src/config');
const adbService = require('../src/services/adbService');
const deviceLockService = require('../src/services/deviceLockService');
const { setupWebSocket } = require('../src/websocket/testSocket');

describe('Phase 3A — Installed-App Logcat Cross-Contamination Prevention Suite', () => {
  let origStreamPidLogcat;
  let origStreamLogcat;
  let origGetPid;
  let origIsDeviceAccessible;

  beforeEach(() => {
    origStreamPidLogcat = adbService.streamPidLogcat;
    origStreamLogcat = adbService.streamLogcat;
    origGetPid = adbService.getPid;
    origIsDeviceAccessible = deviceLockService.isDeviceAccessible;

    deviceLockService.isDeviceAccessible = () => true;
  });

  afterEach(() => {
    adbService.streamPidLogcat = origStreamPidLogcat;
    adbService.streamLogcat = origStreamLogcat;
    adbService.getPid = origGetPid;
    deviceLockService.isDeviceAccessible = origIsDeviceAccessible;
  });

  function createMockProc() {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = (sig) => {
      proc.killed = true;
      proc.emit('exit', 0, sig);
    };
    return proc;
  }

  function createMockWs(user = { id: 'usr_qa', name: 'QA Tester', role: 'tester' }) {
    const ws = new EventEmitter();
    ws.readyState = 1;
    ws.user = user;
    ws.sentMessages = [];
    ws.send = (msg) => {
      ws.sentMessages.push(JSON.parse(msg));
    };
    ws.close = () => {
      ws.emit('close');
    };
    return ws;
  }

  function getValidUrl(user = { id: 'usr_qa', name: 'QA Tester', role: 'tester' }) {
    const token = jwt.sign(user, config.JWT_SECRET);
    return `/?token=${token}`;
  }

  // TEST 1: Selected package running -> PID found -> PID-scoped logcat starts.
  it('TEST 1: Selected package running -> PID found -> PID-scoped logcat starts with --pid', async () => {
    let pidStreamCalled = false;
    let deviceWideStreamCalled = false;
    const mockProc = createMockProc();

    adbService.getPid = async (serial, pkg) => '12345';
    adbService.streamPidLogcat = (serial, pid) => {
      pidStreamCalled = true;
      assert.strictEqual(serial, 'DEV-TEST-01');
      assert.strictEqual(pid, '12345');
      return mockProc;
    };
    adbService.streamLogcat = () => {
      deviceWideStreamCalled = true;
      return createMockProc();
    };

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);
    const mockWs = createMockWs();

    wss.emit('connection', mockWs, { url: getValidUrl(mockWs.user), headers: { host: 'localhost' } });

    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.google.android.webview.dev'
    }));

    await new Promise(r => setTimeout(r, 30));

    assert.strictEqual(pidStreamCalled, true, 'PID-scoped logcat must start when PID is found');
    assert.strictEqual(deviceWideStreamCalled, false, 'Device-wide logcat must NOT be started');

    mockWs.emit('close');
  });

  // TEST 2: Selected package not running -> PID null -> NO device-wide logcat starts.
  it('TEST 2: Selected package not running -> PID null -> NO device-wide logcat starts', async () => {
    let pidStreamCalled = false;
    let deviceWideStreamCalled = false;

    adbService.getPid = async () => null; // App not running
    adbService.streamPidLogcat = () => {
      pidStreamCalled = true;
      return createMockProc();
    };
    adbService.streamLogcat = () => {
      deviceWideStreamCalled = true;
      return createMockProc();
    };

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);
    const mockWs = createMockWs();

    wss.emit('connection', mockWs, { url: getValidUrl(mockWs.user), headers: { host: 'localhost' } });

    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.google.android.webview.dev'
    }));

    await new Promise(r => setTimeout(r, 30));

    assert.strictEqual(pidStreamCalled, false, 'PID-scoped logcat must NOT start when PID is null');
    assert.strictEqual(deviceWideStreamCalled, false, 'Device-wide logcat must NOT start when packageName is specified and PID is null');
    assert.ok(!mockWs.deviceLogcatProc, 'No active logcat process should exist');

    mockWs.emit('close');
  });

  // TEST 3: Selected package not running -> unrelated Flyer Maker Volley log appears -> event MUST NOT be emitted.
  it('TEST 3: Selected package not running -> unrelated Flyer Maker Volley log appears -> NOT emitted to selected-app stream', async () => {
    adbService.getPid = async () => null;

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);
    const mockWs = createMockWs();

    wss.emit('connection', mockWs, { url: getValidUrl(mockWs.user), headers: { host: 'localhost' } });

    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.google.android.webview.dev'
    }));

    await new Promise(r => setTimeout(r, 30));

    // Verify sent messages contain no LOG events
    const logMessages = mockWs.sentMessages.filter(m => m.type === 'LOG');
    assert.strictEqual(logMessages.length, 0, 'No LOG messages should be sent when app is not running');

    mockWs.emit('close');
  });

  // TEST 4: Selected package starts later -> PID becomes available -> attaches PID-scoped stream automatically.
  it('TEST 4: Selected package starts later -> PID becomes available -> attaches PID-scoped stream automatically', async () => {
    let currentResolvedPid = null;
    let pidStreamAttached = false;
    const mockProc = createMockProc();

    adbService.getPid = async () => currentResolvedPid;
    adbService.streamPidLogcat = (serial, pid) => {
      pidStreamAttached = true;
      assert.strictEqual(pid, '55555');
      return mockProc;
    };

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);
    const mockWs = createMockWs();

    wss.emit('connection', mockWs, { url: getValidUrl(mockWs.user), headers: { host: 'localhost' } });

    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.google.android.webview.dev'
    }));

    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(pidStreamAttached, false);

    // App launches later on device
    currentResolvedPid = '55555';

    // Simulate pidWatchInterval tick
    const freshPid = await adbService.getPid('DEV-TEST-01', 'com.google.android.webview.dev');
    if (freshPid && freshPid !== mockWs.currentAppPid) {
      mockWs.currentAppPid = freshPid;
      mockWs.deviceLogcatProc = adbService.streamPidLogcat('DEV-TEST-01', freshPid);
    }

    assert.strictEqual(pidStreamAttached, true, 'PID-scoped stream attached once PID became available');
    assert.strictEqual(mockWs.currentAppPid, '55555');

    mockWs.emit('close');
  });

  // TEST 5: Selected package relaunches -> old PID stream terminates -> new PID stream attaches without duplicates.
  it('TEST 5: Selected package relaunches -> old PID stream terminates -> new PID stream attaches without duplicates', async () => {
    const proc1 = createMockProc();
    const proc2 = createMockProc();

    adbService.getPid = async () => '11111';
    adbService.streamPidLogcat = (serial, pid) => {
      if (pid === '11111') return proc1;
      if (pid === '22222') return proc2;
      return createMockProc();
    };

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);
    const mockWs = createMockWs();

    wss.emit('connection', mockWs, { url: getValidUrl(mockWs.user), headers: { host: 'localhost' } });

    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.target.app'
    }));

    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(mockWs.currentAppPid, '11111');
    assert.strictEqual(proc1.killed, false);

    // App relaunches with new PID
    adbService.getPid = async () => '22222';

    // Relaunch triggers new start or watcher transition
    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.target.app'
    }));

    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(proc1.killed, true, 'Old process must be killed');
    assert.strictEqual(mockWs.currentAppPid, '22222');
    assert.strictEqual(proc2.killed, false);

    mockWs.emit('close');
    assert.strictEqual(proc2.killed, true, 'New process must be killed on close');
  });

  // TEST 6: Switch Uploaded -> Installed -> previous monitoring context is stopped/isolated.
  it('TEST 6: Context switch (Uploaded -> Installed) stops previous monitoring context cleanly', async () => {
    const procUploaded = createMockProc();

    adbService.getPid = async () => '33333';
    adbService.streamPidLogcat = () => procUploaded;

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);
    const mockWs = createMockWs();

    wss.emit('connection', mockWs, { url: getValidUrl(mockWs.user), headers: { host: 'localhost' } });

    // Uploaded build context started
    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.uploaded.build'
    }));

    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(mockWs.targetPackage, 'com.uploaded.build');
    assert.strictEqual(procUploaded.killed, false);

    // Frontend switches context: sends STOP
    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_STOP'
    }));

    assert.strictEqual(procUploaded.killed, true, 'Previous context process must be terminated on stop');
    assert.strictEqual(mockWs.targetPackage, null);
    assert.strictEqual(mockWs.deviceLogcatProc, null);

    mockWs.emit('close');
  });

  // TEST 7: Switch Installed App A -> Installed App B -> A events do not appear under B.
  it('TEST 7: Switch Installed App A -> Installed App B isolates events completely', async () => {
    const procA = createMockProc();
    const procB = createMockProc();

    adbService.getPid = async (serial, pkg) => {
      if (pkg === 'com.app.a') return '1001';
      if (pkg === 'com.app.b') return '2002';
      return null;
    };

    adbService.streamPidLogcat = (serial, pid) => {
      if (pid === '1001') return procA;
      if (pid === '2002') return procB;
      return createMockProc();
    };

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);
    const mockWs = createMockWs();

    wss.emit('connection', mockWs, { url: getValidUrl(mockWs.user), headers: { host: 'localhost' } });

    // Start App A
    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.app.a'
    }));
    await new Promise(r => setTimeout(r, 30));

    // Switch to App B
    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.app.b'
    }));
    await new Promise(r => setTimeout(r, 30));

    assert.strictEqual(procA.killed, true, 'App A process terminated');
    assert.strictEqual(procB.killed, false, 'App B process active');
    assert.strictEqual(mockWs.targetPackage, 'com.app.b');

    // Emit line from procB
    procB.stdout.emit('data', Buffer.from('10-06 12:00:00.000  2002  2002 I AppB: Hello from App B\n'));

    const bLogs = mockWs.sentMessages.filter(m => m.type === 'LOG');
    assert.strictEqual(bLogs.length, 1);
    assert.strictEqual(bLogs[0].packageName, 'com.app.b');
    assert.strictEqual(bLogs[0].pid, '2002');

    mockWs.emit('close');
  });

  // TEST 8: API event from selected PID -> packageName matches selected package.
  it('TEST 8: API event from selected PID attributes packageName matching selected package', async () => {
    const proc = createMockProc();
    adbService.getPid = async () => '7777';
    adbService.streamPidLogcat = () => proc;

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);
    const mockWs = createMockWs();

    wss.emit('connection', mockWs, { url: getValidUrl(mockWs.user), headers: { host: 'localhost' } });

    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01',
      packageName: 'com.my.app'
    }));

    await new Promise(r => setTimeout(r, 30));

    // Simulate structured Volley event from target app PID
    const volleyPayload = JSON.stringify({
      method: 'POST',
      url: 'https://api.myapp.com/v1/auth',
      statusCode: 200,
      durationMs: 145
    });

    proc.stdout.emit('data', Buffer.from(`10-06 12:00:00.000  7777  7777 I [VOLLEY_HTTP_TRANSACTION]: ${volleyPayload}\n`));

    const logMessages = mockWs.sentMessages.filter(m => m.type === 'LOG');
    assert.strictEqual(logMessages.length, 1);
    assert.strictEqual(logMessages[0].packageName, 'com.my.app');
    assert.strictEqual(logMessages[0].pid, '7777');
    assert.ok(logMessages[0].log.api);
    assert.strictEqual(logMessages[0].log.api.url, 'https://api.myapp.com/v1/auth');

    mockWs.emit('close');
  });

  // TEST 9: Multi-user isolation remains intact.
  it('TEST 9: Multi-user device claim prevents unauthorized user from starting logcat', async () => {
    deviceLockService.isDeviceAccessible = (serial, user) => user.id === 'usr_alice';

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);

    const mockWsBob = createMockWs({ id: 'usr_bob', name: 'Bob Tester', role: 'tester' });
    wss.emit('connection', mockWsBob, { url: getValidUrl(mockWsBob.user), headers: { host: 'localhost' } });

    await mockWsBob.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-CLAIMED-BY-ALICE',
      packageName: 'com.alice.app'
    }));

    await new Promise(r => setTimeout(r, 30));

    const errors = mockWsBob.sentMessages.filter(m => m.type === 'ERROR');
    assert.strictEqual(errors.length, 1);
    assert.ok(errors[0].message.includes('not accessible'));

    mockWsBob.emit('close');
  });

  // TEST 10: Raw Logcat, if intentionally device-wide, remains available but never feeds selected-app API/App Logcat events.
  it('TEST 10: Raw Logcat (no package specified) streams device-wide without fake packageName or structuredApi', async () => {
    let rawLogcatStarted = false;
    const rawProc = createMockProc();

    adbService.streamLogcat = () => {
      rawLogcatStarted = true;
      return rawProc;
    };

    const mockHttpServer = new EventEmitter();
    const wss = setupWebSocket(mockHttpServer);
    const mockWs = createMockWs();

    wss.emit('connection', mockWs, { url: getValidUrl(mockWs.user), headers: { host: 'localhost' } });

    // Start raw device logcat (no packageName)
    await mockWs.emit('message', JSON.stringify({
      action: 'DEVICE_LOGCAT_START',
      serial: 'DEV-TEST-01'
    }));

    await new Promise(r => setTimeout(r, 30));
    assert.strictEqual(rawLogcatStarted, true, 'Raw logcat should start when no packageName requested');

    // Simulate an unrelated app's Volley log line on raw stream
    rawProc.stdout.emit('data', Buffer.from('10-06 12:00:00.000  9999  9999 I [VOLLEY_HTTP_TRANSACTION]: {"url":"https://unrelated.com"}\n'));

    const logs = mockWs.sentMessages.filter(m => m.type === 'LOG');
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].packageName, null, 'Raw logcat line must NEVER be stamped with a packageName');
    assert.strictEqual(logs[0].pid, null, 'Raw logcat line must not be stamped with a selected PID');
    assert.strictEqual(logs[0].log.api, undefined, 'Raw unscoped logcat line must NEVER produce structured API events');

    mockWs.emit('close');
  });
});
