const { describe, it, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const adbService = require('../src/services/adbService');
const testRunnerService = require('../src/services/testRunnerService');
const deviceLockService = require('../src/services/deviceLockService');

// Load LiveLogViewer helper context using exact pattern from httpInspector.test.js
const liveLogViewerPath = path.resolve(__dirname, '../../frontend/src/components/LiveLogViewer.jsx');
const content = fs.readFileSync(liveLogViewerPath, 'utf-8');
const helperStart = content.indexOf('export const HTTP_STATUS_TEXTS');
const helperEnd = content.indexOf('export function JsonSyntaxViewer');
const helperBlock = content.substring(helperStart, helperEnd).replace(/export\s+/g, '');
const viewerContext = new Function(`
  ${helperBlock}
  return { parseLogEntry, correlateLogs, getStructuredTransactionJson, ALLOWED_CATEGORIES };
`)();

describe('App Relaunch, Clear Data, and Volley MarkerLog Telemetry Suite', () => {
  let padExecutionManager;
  let mockSocket;
  let mockApi;
  let sentSocketMessages = [];
  let socketSubscriptions = new Map();

  before(async () => {
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
      getCurrentUser: () => ({ id: 'user_alice_relaunch', name: 'Alice Tester', role: 'tester' }),
      cancelTest: async (tid) => ({ success: true, message: `Cancelled ${tid}` })
    };

    padExecutionManager.socketService = mockSocket;
    padExecutionManager.api = mockApi;
    padExecutionManager.resetForUser('user_alice_relaunch');
    padExecutionManager.listeners.clear();
    padExecutionManager.initialized = false;
    padExecutionManager.init();
  });

  // Test 1: Real Volley MarkerLog format parsing with UNKNOWN method and null status
  it('1. Parses real Volley MarkerLog format: extracts endpoint, duration, UNKNOWN method and null status', () => {
    // Real hardware telemetry log line
    const rawLine = '10-20 15:08:00.894 22042 22042 D Volley  : [2] MarkerLog.finish: (1532 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 10';
    const parsed = viewerContext.parseLogEntry(rawLine, 0);

    assert.strictEqual(parsed.category, 'API', 'Must be classified as API category');
    assert.ok(parsed.apiDetails, 'apiDetails must be generated');
    assert.strictEqual(parsed.apiDetails.endpoint, 'https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs');
    assert.strictEqual(parsed.apiDetails.duration, '1532 ms');
    assert.strictEqual(parsed.apiDetails.method, 'UNKNOWN', 'Do not infer GET from [ ] marker; must be UNKNOWN');
    assert.strictEqual(parsed.apiDetails.status, null, 'Status must not be assumed 200 without correlated response code');

    // Test with explicit HTTP method in brackets
    const postLine = 'Volley  : [2] MarkerLog.finish: (620 ms) [POST] https://flyerbuilder.app/api/public/api/generateAiFlyerImage 0x8a92 NORMAL 12';
    const parsedPost = viewerContext.parseLogEntry(postLine, 1);
    assert.strictEqual(parsedPost.category, 'API');
    assert.strictEqual(parsedPost.apiDetails.method, 'POST', 'Extracts explicit HTTP method when present');
    assert.strictEqual(parsedPost.apiDetails.status, null);
    assert.strictEqual(parsedPost.apiDetails.duration, '620 ms');
  });

  // Test 2: Separate Test Completion from Monitoring Completion
  it('2. Keeps logcat active when isMonitoring is true even after TEST_FINISHED', () => {
    padExecutionManager.startSession({
      testId: 'test_mon_session_001',
      deviceSerial: 'DEVICE_SERIAL_99',
      packageName: 'com.nra.flyermaker',
      userId: 'user_alice_relaunch',
      isMonitoring: true
    });

    assert.strictEqual(padExecutionManager.logcatActive, true);

    // Automated test pipeline finishes
    mockSocket.emit('TEST_FINISHED', {
      testId: 'test_mon_session_001',
      test: { id: 'test_mon_session_001', status: 'COMPLETED', result: 'PASS' }
    });

    // In monitoring mode, DEVICE_LOGCAT_STOP must NOT be sent
    const stopMsg = sentSocketMessages.find((m) => m.action === 'DEVICE_LOGCAT_STOP');
    assert.strictEqual(stopMsg, undefined, 'Must not stop logcat on test finish when isMonitoring is true');
    assert.strictEqual(padExecutionManager.logcatActive, true);
    assert.strictEqual(padExecutionManager.completedTest?.status, 'COMPLETED');

    // Explicit stop or cancel cleanly terminates logcat
    padExecutionManager.cancelSession();
    const explicitStopMsg = sentSocketMessages.find((m) => m.action === 'DEVICE_LOGCAT_STOP');
    assert.ok(explicitStopMsg, 'Explicit cancelSession must stop logcat');
    assert.strictEqual(padExecutionManager.logcatActive, false);
  });

  // Test 3: Log acceptance across app process death and relaunch
  it('3. Accepts new incoming logs after app process restart when deviceSerial matches', () => {
    padExecutionManager.startSession({
      testId: 'test_relaunch_002',
      deviceSerial: 'DEV_RELAUNCH_01',
      packageName: 'com.nra.flyermaker',
      userId: 'user_alice_relaunch',
      isMonitoring: true
    });

    // Test marked completed
    mockSocket.emit('TEST_FINISHED', {
      testId: 'test_relaunch_002',
      test: { id: 'test_relaunch_002', status: 'COMPLETED' }
    });

    // Device emits log after relaunch with new PID (no testId on raw logcat lines)
    mockSocket.emit('LOG', {
      serial: 'DEV_RELAUNCH_01',
      packageName: 'com.nra.flyermaker',
      pid: '33445',
      log: {
        time: '15:10:00',
        text: 'Volley  : [2] MarkerLog.finish: (1200 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0x123 NORMAL 1',
        level: 'INFO'
      }
    });

    const state = padExecutionManager.getState();
    assert.strictEqual(state.logs.length, 1);
    assert.ok(state.logs[0].text.includes('getTemplateWithCatalogs'));
  });

  // Test 4: Dynamic PID Watcher re-arms verbose tags on process transition in testRunnerService
  it('4. adbService.launchApp sets verbose log properties and resolves new PID', async () => {
    const origExec = adbService.execute;
    const executedCommands = [];

    adbService.execute = async (args) => {
      executedCommands.push(args.join(' '));
      if (args.includes('packages')) {
        return { code: 0, stdout: 'package:com.nra.flyermaker\n', stderr: '', raw: '' };
      }
      if (args.includes('pidof')) {
        return { code: 0, stdout: '9988\n', stderr: '', raw: '9988' };
      }
      if (args.includes('monkey')) {
        return { code: 0, stdout: 'Events injected: 1', stderr: '', raw: '' };
      }
      return { code: 0, stdout: '', stderr: '', raw: '' };
    };

    const res = await adbService.launchApp('DEV_TEST_LAUNCH', 'com.nra.flyermaker');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.pid, '9988');

    // Verify setprop was executed before launch
    const setpropVolley = executedCommands.find(c => c.includes('setprop log.tag.Volley VERBOSE'));
    const setpropOkHttp = executedCommands.find(c => c.includes('setprop log.tag.OkHttp VERBOSE'));
    assert.ok(setpropVolley, 'Must set log.tag.Volley VERBOSE');
    assert.ok(setpropOkHttp, 'Must set log.tag.OkHttp VERBOSE');

    adbService.execute = origExec;
  });

  // Test 5: Multi-user isolation across relaunches
  it('5. Rejects logs from different device serial or different user session', () => {
    padExecutionManager.startSession({
      testId: 'test_sec_005',
      deviceSerial: 'DEV_ALICE_ONLY',
      packageName: 'com.alice.app',
      userId: 'user_alice_relaunch'
    });

    // Bob's device logs arriving on same socket
    mockSocket.emit('LOG', {
      serial: 'DEV_BOB_OTHER',
      packageName: 'com.bob.app',
      pid: '7777',
      log: { time: '15:12:00', text: 'Bob secret log', level: 'INFO' }
    });

    assert.strictEqual(padExecutionManager.getState().logs.length, 0, 'Must not accept logs from other device');
  });

  // Test 6: Marker-only entries ((+0), (+1), (+2), (+50)) are categorized as APP LOGCAT, NOT API
  it('6. Does not classify marker-only timing lines ((+0), (+1), (+2), (+50)) as API calls', () => {
    const markerLines = [
      'D/Volley: [2] MarkerLog.finish: (+1) ...',
      '10-20 15:08:00.890 22042 22042 D Volley : [2] MarkerLog.finish: (+0) [ 1] add-to-queue',
      '10-20 15:08:00.891 22042 22042 D Volley : [2] MarkerLog.finish: (+1) [ 1] network-queue-take',
      '10-20 15:08:00.892 22042 22042 D Volley : [2] MarkerLog.finish: (+2) [ 1] intermediate-marker',
      '10-20 15:08:00.893 22042 22042 D Volley : [2] MarkerLog.finish: (+50) [ 1] slow-marker'
    ];

    for (let i = 0; i < markerLines.length; i++) {
      const parsed = viewerContext.parseLogEntry(markerLines[i], i);
      assert.notStrictEqual(parsed.category, 'API', `Line ${i} with (+N) timing marker must NOT be categorized as API`);
      assert.strictEqual(parsed.category, 'APP LOGCAT', `Line ${i} must remain in general logcat`);
      assert.strictEqual(parsed.apiDetails, null, `Line ${i} must not generate apiDetails`);
    }
  });

  // Test 7: Multiple marker lines associated with a single request produce exactly one API transaction
  it('7. Multiple marker lines for a single request correlate into a single API transaction', () => {
    const rawLogs = [
      '10-20 15:08:00.890 22042 22042 D Volley : [2] MarkerLog.finish: (+0) [ 1] add-to-queue',
      '10-20 15:08:00.891 22042 22042 D Volley : [2] MarkerLog.finish: (+1) [ 1] network-queue-take',
      '10-20 15:08:00.892 22042 22042 D Volley : [2] MarkerLog.finish: (+1530) [ 1] network-http-complete',
      '10-20 15:08:00.893 22042 22042 D Volley : [2] MarkerLog.finish: (+1) [ 1] network-parse-complete',
      '10-20 15:08:00.893 22042 22042 D Volley : [2] MarkerLog.finish: (+0) [ 1] post-response',
      '10-20 15:08:00.894 22042 22042 D Volley : [2] MarkerLog.finish: (1532 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 10'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');
    const logcatRecords = correlated.filter(e => e.category === 'APP LOGCAT' || e.category === 'LOGCAT');

    assert.strictEqual(apiRecords.length, 1, 'Must produce exactly 1 API transaction, not 6');
    assert.strictEqual(apiRecords[0].apiDetails.endpoint, 'https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs');
    assert.strictEqual(apiRecords[0].duration, '1532 ms');
    assert.strictEqual(apiRecords[0].apiDetails.method, 'UNKNOWN');
    assert.strictEqual(apiRecords[0].status, null);

    // Raw logcat entries must remain available
    assert.strictEqual(logcatRecords.length, 5, 'All 5 timing marker lines must remain available for Raw Logcat');
    assert.ok(logcatRecords[0].cleanText.includes('add-to-queue'));
  });

  // Test 8: Two legitimate requests to the same endpoint (getTemplateWithCatalogs) both remain visible
  it('8. Two legitimate requests to getTemplateWithCatalogs both remain visible', () => {
    const rawLogs = [
      '10-20 15:08:00.894 22042 22042 D Volley : [2] MarkerLog.finish: (1532 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 10',
      '10-20 15:08:05.120 22042 22042 D Volley : [2] MarkerLog.finish: (840 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 11'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 2, 'Two legitimate distinct requests must both remain visible');
    assert.strictEqual(apiRecords[0].duration, '1532 ms');
    assert.strictEqual(apiRecords[1].duration, '840 ms');
    assert.strictEqual(apiRecords[0].apiDetails.endpoint, 'https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs');
    assert.strictEqual(apiRecords[1].apiDetails.endpoint, 'https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs');
  });

  // Test 9: Deduplicates duplicate emission of the same Volley completion record
  it('9. Deduplicates duplicate emission of the same Volley completion record', () => {
    const rawLogs = [
      '10-20 15:08:00.894 22042 22042 D Volley : [2] MarkerLog.finish: (1532 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 10',
      '10-20 15:08:00.894 22042 22042 D Volley : [2] MarkerLog.finish: (1532 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 10'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 1, 'Exact duplicate emission must be deduplicated to 1 entry');
    assert.strictEqual(apiRecords[0].duration, '1532 ms');
  });

  // Test 10: Volley logSlowRequests and MarkerLog.finish merge without duplicating record
  it('10. Volley logSlowRequests and MarkerLog.finish merge into unified transaction', () => {
    const rawLogs = [
      '10-20 15:08:00.894 22042 22042 D Volley : [2] MarkerLog.finish: (1532 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 10',
      '10-20 15:08:00.895 22042 22042 D Volley : [2] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 10> [lifetime=1532], [size=18841], [rc=200], [retryCount=0]'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 1, 'Must merge into a single unified transaction');
    assert.strictEqual(apiRecords[0].status, 200, 'Backfills response status 200 from logSlowRequests');
    assert.strictEqual(apiRecords[0].duration, '1532 ms');
    assert.strictEqual(apiRecords[0].apiDetails.responseSize, '18.4 KB');
  });

  // Test 11: Unknown method and null status values are preserved safely without fabricating 200 in JSON
  it('11. Preserves unknown method and null status without fabricating 200 in JSON view', () => {
    const rawLine = '10-20 15:08:00.894 22042 22042 D Volley : [2] MarkerLog.finish: (1532 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 10';
    const parsed = viewerContext.parseLogEntry(rawLine, 0);
    const jsonObj = viewerContext.getStructuredTransactionJson(parsed);

    assert.strictEqual(jsonObj.request.method, 'UNKNOWN', 'Must preserve UNKNOWN method');
    assert.strictEqual(jsonObj.response.status, null, 'Must preserve null status without fabricating 200');
    assert.strictEqual(jsonObj.response.statusText, 'Completed');
  });

  // Test 12: ALLOWED_CATEGORIES strictly contains only genuine structured event types
  it('12. ALLOWED_CATEGORIES contains only genuine target-app categories (no App Logcat)', () => {
    assert.ok(Array.isArray(viewerContext.ALLOWED_CATEGORIES));
    assert.deepStrictEqual(viewerContext.ALLOWED_CATEGORIES, ['API', 'QA ACTION', 'ERROR', 'APP CRASH']);
    assert.ok(!viewerContext.ALLOWED_CATEGORIES.includes('LOGCAT'), 'Must not include LOGCAT');
    assert.ok(!viewerContext.ALLOWED_CATEGORIES.includes('APP LOGCAT'), 'Must not include APP LOGCAT');
  });

  // Test 13: Console All tab excludes raw logcat while keeping genuine com.bg.flyermaker events
  it('13. Console All tab excludes raw/general logcat while keeping genuine com.bg.flyermaker events', () => {
    const rawLogs = [
      '10-20 15:08:00.894 22042 22042 D Volley : [2] MarkerLog.finish: (204 ms) [ ] https://flyerbuilder.app/api/public/api/getImagesByCatalogIdV2 0xb623c8ee NORMAL 40',
      '10-20 15:08:00.895 22042 22042 D Volley : [2] MarkerLog.finish: (+1) [2] add-to-queue',
      '10-20 15:08:00.896 22042 22042 D Volley : [2] MarkerLog.finish: (+5) [2] cache-hit',
      '[10:00:00] Checking Prerequisites for com.bg.flyermaker',
      '10-20 15:08:00.900 22042 22042 E AndroidRuntime: FATAL EXCEPTION: main\nProcess: com.bg.flyermaker, PID: 22042\njava.lang.NullPointerException: Test crash',
      '10-20 15:08:00.950 22042 22042 E TestApp : [ERROR] Connection timed out for com.bg.flyermaker'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    // Console All tab filtering logic:
    const allTabEvents = correlated.filter(e => !e.isCrashContinuationLine && viewerContext.ALLOWED_CATEGORIES.includes(e.category));

    // Must include the API call, QA action, crash, and error (4 items)
    assert.strictEqual(allTabEvents.length, 4, 'Must only retain 4 structured events, excluding all raw logcat lines');
    assert.strictEqual(allTabEvents[0].category, 'API');
    assert.strictEqual(allTabEvents[0].apiDetails.endpoint, 'https://flyerbuilder.app/api/public/api/getImagesByCatalogIdV2');
    assert.strictEqual(allTabEvents[1].category, 'QA ACTION');
    assert.strictEqual(allTabEvents[2].category, 'APP CRASH');
    assert.strictEqual(allTabEvents[3].category, 'ERROR');

    // Verify raw timing lines are completely absent from All tab
    const hasRawTiming = allTabEvents.some(e => e.cleanText.includes('add-to-queue') || e.cleanText.includes('cache-hit'));
    assert.strictEqual(hasRawTiming, false, 'Raw timing marker logs must not appear in the All tab');
  });

  // Test 14: Category counts for ALL equals sum of allowed structured categories with no LOGCAT counter
  it('14. Category counts for ALL equals sum of allowed structured categories with no LOGCAT counter', () => {
    const rawLogs = [
      '10-20 15:08:00.894 22042 22042 D Volley : [2] MarkerLog.finish: (158 ms) [ ] https://flyerbuilder.app/api/public/api/getImagesByCatalogIdV2 0xb623c8ee NORMAL 41',
      '10-20 15:08:00.895 22042 22042 D Volley : [2] MarkerLog.finish: (+1) [2] add-to-queue',
      '[10:00:00] Checking Prerequisites',
      '10-20 15:08:00.950 22042 22042 E TestApp : [ERROR] Something failed'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);

    // Emulate categoryCounts hook logic:
    const counts = { ALL: 0, API: 0, ACTION: 0, ERROR: 0, CRASH: 0 };
    correlated.forEach(entry => {
      if (entry.isCrashContinuationLine) return;
      if (entry.category === 'API') {
        counts.API++;
        counts.ALL++;
      } else if (entry.category === 'QA ACTION') {
        counts.ACTION++;
        counts.ALL++;
      } else if (entry.category === 'APP CRASH') {
        counts.CRASH++;
        counts.ALL++;
      } else if (entry.category === 'ERROR') {
        counts.ERROR++;
        counts.ALL++;
      }
    });

    assert.strictEqual(counts.ALL, 3, 'ALL count must be 3 (1 API + 1 ACTION + 1 ERROR, ignoring 1 raw logcat line)');
    assert.strictEqual(counts.API, 1);
    assert.strictEqual(counts.ACTION, 1);
    assert.strictEqual(counts.ERROR, 1);
    assert.strictEqual(counts.CRASH, 0);
    assert.strictEqual(counts.LOGCAT, undefined, 'LOGCAT property must be undefined');
    assert.strictEqual(counts.ALL, counts.API + counts.ACTION + counts.ERROR + counts.CRASH);
  });

  // Test 15: Consecutive requests to addUserPreferencesV2 with Volley sequence 9 and sequence 10 remain distinct and both retain correct method, status 200, size, and response body
  it('15. Consecutive requests to addUserPreferencesV2 with Volley sequence 9 and sequence 10 remain distinct and both retain correct method, status 200, size, and response body', () => {
    const rawLogs = [
      // Sequence 9 request and response lifecycle
      '10-20 16:19:28.100 5534 5534 I TestApp : API_TO_CALL:< https://flyerbuilder.app/api/public/api/addUserPreferencesV2\tRequest: ',
      '10-20 16:19:29.069 5534 5580 D Volley : [2] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] https://flyerbuilder.app/api/public/api/addUserPreferencesV2 0xb623c8ee NORMAL 9> [lifetime=969], [size=106], [rc=200], [retryCount=0]',
      '10-20 16:19:29.085 5534 5534 D Volley : [2] MarkerLog.finish: (985 ms) [ ] https://flyerbuilder.app/api/public/api/addUserPreferencesV2 0xb623c8ee NORMAL 9',

      // Sequence 10 request, response, GsonRequest payload, and finish marker
      '10-20 16:19:36.500 5534 5534 I TestApp : API_TO_CALL:< https://flyerbuilder.app/api/public/api/addUserPreferencesV2\tRequest: ',
      '10-20 16:19:37.520 5534 5580 D Volley : [2] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] https://flyerbuilder.app/api/public/api/addUserPreferencesV2 0xb623c8ee NORMAL 10> [lifetime=1020], [size=106], [rc=200], [retryCount=0]',
      '10-20 16:19:37.525 5534 5534 I TestApp : GsonRequest: {"code":200,"message":"User question and answer store successfully.","case":"","data":{"user_id":2041021}}',
      '10-20 16:19:37.533 5534 5534 D Volley : [2] MarkerLog.finish: (1033 ms) [ ] https://flyerbuilder.app/api/public/api/addUserPreferencesV2 0xb623c8ee NORMAL 10'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    // Exactly 2 API transactions (no duplicate empty/in-flight entries)
    assert.strictEqual(apiRecords.length, 2, 'Must correlate exactly 2 distinct API transactions for sequences 9 and 10');

    // Sequence 9 verification
    assert.strictEqual(apiRecords[0].status, 200);
    assert.strictEqual(apiRecords[0].duration, '985 ms');
    assert.strictEqual(apiRecords[0].apiDetails.responseSize, '106 B');
    assert.strictEqual(apiRecords[0].apiDetails.endpoint, 'https://flyerbuilder.app/api/public/api/addUserPreferencesV2');

    // Sequence 10 verification
    assert.strictEqual(apiRecords[1].status, 200);
    assert.strictEqual(apiRecords[1].duration, '1033 ms');
    assert.strictEqual(apiRecords[1].apiDetails.responseSize, '106 B');
    assert.strictEqual(apiRecords[1].apiDetails.endpoint, 'https://flyerbuilder.app/api/public/api/addUserPreferencesV2');
    assert.ok(apiRecords[1].apiDetails.responseBody, 'Sequence 10 must have response body attached from GsonRequest');
    assert.match(apiRecords[1].apiDetails.responseBody.text, /2041021/);

    // Verify structured JSON view for sequence 10 does not have null status or missing fields
    const seq10Json = viewerContext.getStructuredTransactionJson(apiRecords[1]);
    assert.strictEqual(seq10Json.response.status, 200);
    assert.strictEqual(seq10Json.response.size, '106 B');
    assert.strictEqual(seq10Json.response.duration, '1033 ms');
    assert.ok(seq10Json.response.body);
    assert.strictEqual(seq10Json.response.body.data.user_id, 2041021);
  });

  // Test 16: Preserves explicit GET method through Volley response and completion events without overwriting with UNKNOWN
  it('16. Preserves explicit GET method through Volley response and completion events without overwriting with UNKNOWN', () => {
    const rawLogs = [
      '10-20 16:30:00.100 5534 5534 D OkHttp : --> GET https://flyerbuilder.app/api/public/api/getTemplates',
      '10-20 16:30:01.000 5534 5580 D Volley : [2] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] https://flyerbuilder.app/api/public/api/getTemplates 0xb623c8ee NORMAL 15> [lifetime=900], [size=2048], [rc=200], [retryCount=0]',
      '10-20 16:30:01.020 5534 5534 D Volley : [2] MarkerLog.finish: (920 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplates 0xb623c8ee NORMAL 15'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 1, 'Must correlate to a single API transaction');
    assert.strictEqual(apiRecords[0].apiDetails.method, 'GET', 'Explicit GET method must not be overwritten by [ ] marker');
    assert.strictEqual(apiRecords[0].status, 200);
    assert.strictEqual(apiRecords[0].duration, '920 ms');
    assert.strictEqual(apiRecords[0].apiDetails.responseSize, '2.0 KB');

    const json = viewerContext.getStructuredTransactionJson(apiRecords[0]);
    assert.strictEqual(json.request.method, 'GET');
  });

  // Test 17: Multi-line Request payload for getAndroidCredits resolves to POST and is preserved across Volley completion
  it('17. Multi-line Request payload for getAndroidCredits resolves to POST and is preserved across Volley completion', () => {
    const rawLogs = [
      '10-20 16:40:00.100 22042 22042 I FlyerMaker : API_TO_CALL: https://flyerbuilder.app/api/public/api/getAndroidCredits',
      '10-20 16:40:00.105 22042 22042 I FlyerMaker : Request:{"app_id":2,"device_type":"android","user_id":"2041021"}',
      '10-20 16:40:01.069 22042 22080 D Volley : [2] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] https://flyerbuilder.app/api/public/api/getAndroidCredits 0xb623c8ee NORMAL 20> [lifetime=969], [size=106], [rc=200], [retryCount=0]',
      '10-20 16:40:01.085 22042 22042 D Volley : [2] MarkerLog.finish: (985 ms) [ ] https://flyerbuilder.app/api/public/api/getAndroidCredits 0xb623c8ee NORMAL 20'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 1, 'Must correlate into single complete transaction');
    assert.strictEqual(apiRecords[0].apiDetails.method, 'POST', 'Target app Request convention must establish POST method');
    assert.strictEqual(apiRecords[0].apiDetails.summary, 'POST https://flyerbuilder.app/api/public/api/getAndroidCredits');
    assert.ok(apiRecords[0].apiDetails.requestBody, 'Request body must be attached');
    assert.strictEqual(apiRecords[0].status, 200);
    assert.strictEqual(apiRecords[0].duration, '985 ms');
    assert.strictEqual(apiRecords[0].apiDetails.responseSize, '106 B');

    const json = viewerContext.getStructuredTransactionJson(apiRecords[0]);
    assert.strictEqual(json.request.method, 'POST');
    assert.strictEqual(json.request.body.app_id, 2);
    assert.strictEqual(json.response.status, 200);
  });

  // Test 18: Genuinely unknown method (LocalRemoteConfig configs) without body or verb remains strictly UNKNOWN
  it('18. Genuinely unknown method (LocalRemoteConfig configs) without body or verb remains strictly UNKNOWN', () => {
    const rawLogs = [
      '10-20 16:50:00.100 22042 22042 I LocalRemoteConfig : API_TO_CALL: http://192.168.0.247:2315/api/configs?application=designwiz_test',
      '10-20 16:50:00.350 22042 22080 D Volley : [2] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] http://192.168.0.247:2315/api/configs?application=designwiz_test 0xb623c8ee NORMAL 25> [lifetime=250], [size=512], [rc=200], [retryCount=0]',
      '10-20 16:50:00.360 22042 22042 D Volley : [2] MarkerLog.finish: (260 ms) [ ] http://192.168.0.247:2315/api/configs?application=designwiz_test 0xb623c8ee NORMAL 25'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 1);
    assert.strictEqual(apiRecords[0].apiDetails.method, 'UNKNOWN', 'Telemetries without verbs or body must remain strictly UNKNOWN');
    assert.strictEqual(apiRecords[0].status, 200);
    assert.strictEqual(apiRecords[0].duration, '260 ms');

    const json = viewerContext.getStructuredTransactionJson(apiRecords[0]);
    assert.strictEqual(json.request.method, 'UNKNOWN', 'JSON representation must preserve UNKNOWN without falling back to GET');
  });

  // Test 19: Two requests to same endpoint with different sequences and different methods remain distinct
  it('19. Two requests to same endpoint with different sequences and different methods remain distinct', () => {
    const rawLogs = [
      // Call 1: GET
      '10-20 17:00:00.100 5534 5534 D OkHttp : --> GET https://flyerbuilder.app/api/public/api/userPreferences',
      '10-20 17:00:00.300 5534 5534 D Volley : [2] MarkerLog.finish: (200 ms) [ ] https://flyerbuilder.app/api/public/api/userPreferences 0xb623c8ee NORMAL 30',

      // Call 2: POST via established Request convention
      '10-20 17:00:05.100 5534 5534 I TestApp : API_TO_CALL: https://flyerbuilder.app/api/public/api/userPreferences',
      '10-20 17:00:05.105 5534 5534 I TestApp : Request:{"theme":"dark"}',
      '10-20 17:00:05.450 5534 5534 D Volley : [2] MarkerLog.finish: (345 ms) [ ] https://flyerbuilder.app/api/public/api/userPreferences 0xb623c8ee NORMAL 31'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 2, 'Must remain two distinct records');
    assert.strictEqual(apiRecords[0].apiDetails.method, 'GET');
    assert.strictEqual(apiRecords[0].duration, '200 ms');

    assert.strictEqual(apiRecords[1].apiDetails.method, 'POST');
    assert.strictEqual(apiRecords[1].duration, '345 ms');
    assert.ok(apiRecords[1].apiDetails.requestBody);
  });

  // Test 20: UI method badge and JSON view produce identical method tokens without GET fallback
  it('20. UI method badge and JSON view produce identical method tokens without GET fallback', () => {
    const unknownEntry = {
      id: 'test-1',
      category: 'API',
      time: '12:00:00',
      apiDetails: {
        endpoint: 'https://example.com/api',
        method: 'UNKNOWN'
      }
    };
    const unknownJson = viewerContext.getStructuredTransactionJson(unknownEntry);
    assert.strictEqual(unknownJson.request.method, 'UNKNOWN');

    const postEntry = {
      id: 'test-2',
      category: 'API',
      time: '12:00:01',
      apiDetails: {
        endpoint: 'https://example.com/api',
        method: 'POST'
      }
    };
    const postJson = viewerContext.getStructuredTransactionJson(postEntry);
    assert.strictEqual(postJson.request.method, 'POST');
  });

  // Test 21: getFeedbackUrlByApp with >>> syncTestimonial : API_TO_CALL <<< and jsonData resolves to POST
  it('21. getFeedbackUrlByApp with >>> syncTestimonial : API_TO_CALL <<< and jsonData resolves to POST', () => {
    const rawLogs = [
      '10-20 18:12:39.323  3624  3624 I com.ui.activity.NEWBusinessCardMainActivity: >>> syncTestimonial : API_TO_CALL <<< https://testimonial.graphicdesigns.co.in/api/getFeedbackUrlByApp',
      '10-20 18:12:39.323  3624  3624 I com.ui.activity.NEWBusinessCardMainActivity: >>> syncTestimonial : jsonData <<< {"country_code":"in","is_template":1,"is_try":0,"package_name":"com.bg.flyermaker","platform":1,"total_designs":0}',
      '10-20 18:12:40.022  3624  3720 D Volley  : [807] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] https://testimonial.graphicdesigns.co.in/api/getFeedbackUrlByApp 0x4fa0e535 NORMAL 10> [lifetime=697], [size=168], [rc=200], [retryCount=0]',
      '10-20 18:12:40.193  3624  3624 D Volley  : [2] MarkerLog.finish: (868  ms) [ ] https://testimonial.graphicdesigns.co.in/api/getFeedbackUrlByApp 0x4fa0e535 NORMAL 10'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 1, 'Must correlate into exactly 1 unified transaction');
    assert.strictEqual(apiRecords[0].apiDetails.method, 'POST');
    assert.strictEqual(apiRecords[0].status, 200);
    assert.strictEqual(apiRecords[0].duration, '868  ms');
    assert.strictEqual(apiRecords[0].apiDetails.responseSize, '168 B');
    assert.ok(apiRecords[0].apiDetails.requestBody);
    assert.match(apiRecords[0].apiDetails.requestBody.text, /"package_name":\s*"com\.bg\.flyermaker"/);
  });

  // Test 22: WaitingRequestManager integer method code 1- decodes to POST and merges with pending request
  it('22. WaitingRequestManager integer method code 1- decodes to POST and merges with pending request', () => {
    const rawLogs = [
      '10-20 18:12:28.290  3624  3624 I Sync    : API_TO_CALL: https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs\tRequest: ',
      '10-20 18:12:28.347  3624  3717 D Volley  : [804] WaitingRequestManager.maybeAddToWaitingRequests: new request, sending to network 1-https://flyerbuilder.app/api/public/api/getTemplateWithCatalogsrequest_json={"catalog_id":0,"page":1}api_name=https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs',
      '10-20 18:12:29.653  3624  3720 D Volley  : [807] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 5> [lifetime=1304], [size=357839], [rc=200], [retryCount=0]',
      '10-20 18:12:32.144  3624  3624 D Volley  : [2] MarkerLog.finish: (3853 ms) [ ] https://flyerbuilder.app/api/public/api/getTemplateWithCatalogs 0xb623c8ee NORMAL 5'
    ];

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 1, 'WaitingRequestManager must enrich in-flight request rather than duplicate');
    assert.strictEqual(apiRecords[0].apiDetails.method, 'POST');
    assert.strictEqual(apiRecords[0].status, 200);
    assert.strictEqual(apiRecords[0].duration, '3853 ms');
    assert.ok(apiRecords[0].apiDetails.requestBody);
    assert.match(apiRecords[0].apiDetails.requestBody.text, /"catalog_id":\s*0/);
  });

  // Test 23: Volley sequence indexing merges across 300+ intervening lines without lookback failure
  it('23. Volley sequence indexing merges across 300+ intervening lines without lookback failure', () => {
    const rawLogs = [
      '10-20 18:12:39.287  3624  3624 I GetAndroidCreditsSync: API_TO_CALL: https://flyerbuilder.app/api/public/api/getAndroidCredits',
      '10-20 18:12:39.287  3624  3624 I GetAndroidCreditsSync: Request:{"user_id":2041099}',
      '10-20 18:12:40.211  3624  3718 D Volley  : [805] NetworkUtility.logSlowRequests: HTTP response for request=<[ ] https://flyerbuilder.app/api/public/api/getAndroidCredits 0xb623c8ee NORMAL 9> [lifetime=921], [size=839], [rc=200], [retryCount=0]'
    ];

    // Add 350 intervening general logcat lines (simulating real Android noise)
    for (let i = 0; i < 350; i++) {
      rawLogs.push(`10-20 18:12:40.220  3624  3624 D Noise    : Intervening log line ${i}`);
    }

    rawLogs.push('10-20 18:12:40.258  3624  3624 D Volley  : [2] MarkerLog.finish: (970  ms) [ ] https://flyerbuilder.app/api/public/api/getAndroidCredits 0xb623c8ee NORMAL 9');

    const correlated = viewerContext.correlateLogs(rawLogs);
    const apiRecords = correlated.filter(e => e.category === 'API');

    assert.strictEqual(apiRecords.length, 1, 'Must correlate into 1 record despite 350 intervening lines');
    assert.strictEqual(apiRecords[0].apiDetails.method, 'POST');
    assert.strictEqual(apiRecords[0].status, 200);
    assert.strictEqual(apiRecords[0].duration, '970  ms');
    assert.strictEqual(apiRecords[0].apiDetails.responseSize, '839 B');
  });

  // Test 24: Target-app capture regression test on real device logcat
  it('24. Target-app capture regression test on real device logcat', () => {
    const logcatPath = path.resolve('C:\\Users\\Admin\\.gemini\\antigravity\\brain\\5671ada5-1df4-4d1e-830d-217042d8c59b\\scratch\\rzgl30_logcat.txt');
    if (fs.existsSync(logcatPath)) {
      const realLines = fs.readFileSync(logcatPath, 'utf-8').split(/\r?\n/).filter(l => l.trim().length > 0);
      const correlated = viewerContext.correlateLogs(realLines);
      const apiRecords = correlated.filter(e => e.category === 'API');

      // Check getAndroidCredits: all entries must be POST and have 0 UNKNOWN duplicate records
      const creditsEntries = apiRecords.filter(r => r.apiDetails?.endpoint?.includes('getAndroidCredits'));
      assert.strictEqual(creditsEntries.length, 2, 'Must have exactly 2 getAndroidCredits records');
      creditsEntries.forEach(r => {
        assert.strictEqual(r.apiDetails.method, 'POST');
        assert.strictEqual(r.status, 200);
      });

      // Check getFeedbackUrlByApp: all entries must be POST and have 0 UNKNOWN duplicate records
      const feedbackEntries = apiRecords.filter(r => r.apiDetails?.endpoint?.includes('getFeedbackUrlByApp'));
      assert.strictEqual(feedbackEntries.length, 2, 'Must have exactly 2 getFeedbackUrlByApp records');
      feedbackEntries.forEach(r => {
        assert.strictEqual(r.apiDetails.method, 'POST');
        assert.strictEqual(r.status, 200);
      });

      // Check getCorruptedFontList: 1 entry, POST, status 200
      const fontEntries = apiRecords.filter(r => r.apiDetails?.endpoint?.includes('getCorruptedFontList'));
      assert.strictEqual(fontEntries.length, 1, 'Must have exactly 1 getCorruptedFontList record');
      assert.strictEqual(fontEntries[0].apiDetails.method, 'POST');
      assert.strictEqual(fontEntries[0].status, 200);

      // Check configs?application=designwiz_test: 1 entry, UNKNOWN (no telemetry method/body)
      const configEntries = apiRecords.filter(r => r.apiDetails?.endpoint?.includes('configs?application=designwiz_test'));
      assert.strictEqual(configEntries.length, 1, 'Must have exactly 1 configs record');
      assert.strictEqual(configEntries[0].apiDetails.method, 'UNKNOWN');
      assert.strictEqual(configEntries[0].status, 200);
    }
  });
});
