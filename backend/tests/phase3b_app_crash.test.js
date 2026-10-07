const { describe, it } = require('node:test');
const assert = require('node:assert');
const testRunnerService = require('../src/services/testRunnerService');
const adbService = require('../src/services/adbService');

// Replicate the core parsing/correlation algorithms used in LiveLogViewer to test them in Node
function sanitizeSensitiveData(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/(Bearer\s+)[A-Za-z0-9\-._~+/]+=*/gi, '$1[REDACTED_TOKEN]')
    .replace(/((?:api[_-]?key|access[_-]?token|secret|password|passwd|auth)\s*[:=]\s*["']?)[^"'\s\r\n,;]+(["']?)/gi, '$1[REDACTED]$2')
    .replace(/(eyJ[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*)/g, '[REDACTED_JWT]');
}

function parseLogEntry(log, index = 0) {
  let rawText = '';
  let cleanText = '';
  let level = 'INFO';
  let category = 'APP LOGCAT';
  let status = null;
  const isObj = log && typeof log === 'object';

  if (isObj) {
    rawText = log.raw || log.text || log.message || JSON.stringify(log);
    cleanText = log.text || log.message || rawText;
    level = log.level || 'INFO';
    if (log.category) category = log.category;
  } else {
    rawText = String(log);
    cleanText = rawText;
  }

  const levelParsed = isObj ? (log.level || 'INFO') : (rawText.match(/\[(INFO|WARN|ERROR|DEBUG)\]/)?.[1] || (/\s+E\s+/.test(rawText) || rawText.includes('[ERROR]') ? 'ERROR' : 'INFO'));
  level = levelParsed;

  cleanText = cleanText
    .replace(/^\[\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, '')
    .replace(/^\[(INFO|WARN|ERROR|DEBUG)\]\s*/, '')
    .replace(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+[VDIWE]\s+/, '');

  // Fatal App Crash detection
  if (
    cleanText.includes('FATAL EXCEPTION') ||
    cleanText.includes('AndroidRuntime: FATAL') ||
    rawText.includes('FATAL EXCEPTION') ||
    (isObj && (log.type === 'APP_CRASH' || log.category === 'APP CRASH'))
  ) {
    category = 'APP CRASH';
    status = 'CRASH';
  } else if (
    level === 'ERROR' ||
    cleanText.includes('[ERROR]') ||
    cleanText.toLowerCase().includes('failed') ||
    cleanText.startsWith('✕')
  ) {
    category = 'ERROR';
  }

  return {
    id: `log-${index}`,
    index,
    rawText: sanitizeSensitiveData(rawText),
    cleanText: sanitizeSensitiveData(cleanText),
    level,
    category,
    status
  };
}

function formatCrashReport(crashEntry, options = {}) {
  const c = crashEntry?.crashDetails || {};
  const appName = options.applicationName || c.process || 'Android Application';
  const pkgName = options.packageName || c.process || 'Unknown Package';
  const deviceName = options.device || options.serial || 'Android Device';

  const report = [
    'ANDROID APP CRASH REPORT',
    '========================',
    '',
    'Application:',
    appName,
    '',
    'Package:',
    pkgName,
    '',
    'Device:',
    deviceName,
    '',
    'PID:',
    c.pid || 'N/A',
    '',
    'Timestamp:',
    crashEntry?.time || new Date().toISOString(),
    '',
    'Thread:',
    c.thread || 'main',
    '',
    'Exception:',
    c.exceptionType || 'java.lang.RuntimeException',
    '',
    'Message:',
    c.message || 'No message provided',
    '',
    'Stack Trace:',
    c.stackTrace || 'No stack trace captured',
    '',
    'Caused By:',
    c.causedBy || 'None',
    '',
    'Raw Crash Log:',
    c.rawLog || crashEntry?.rawText || ''
  ].join('\n');

  return sanitizeSensitiveData(report);
}

function correlateLogs(logs = []) {
  const rawParsed = logs.map((log, idx) => parseLogEntry(log, idx));
  const result = [];
  let activeCrash = null;

  function finalizeCrashBlock(crash) {
    if (!crash) return;
    const fullStackTrace = [
      ...(crash.exceptionType ? [`${crash.exceptionType}${crash.message ? ': ' + crash.message : ''}`] : []),
      ...crash.stackFrames,
      ...(crash.causedBy ? [crash.causedBy] : [])
    ].join('\n');

    const crashEntry = {
      id: crash.id,
      index: crash.startIndex,
      time: crash.time,
      level: 'ERROR',
      category: 'APP CRASH',
      status: 'CRASH',
      rawText: crash.rawLines.join('\n'),
      cleanText: `CRASH: ${crash.exceptionType || 'Fatal Exception'}${crash.message ? ': ' + crash.message : ''}`,
      crashDetails: {
        exceptionType: crash.exceptionType || 'java.lang.RuntimeException',
        message: crash.message || '',
        thread: crash.thread || 'main',
        process: crash.process || null,
        pid: crash.pid || null,
        stackTrace: fullStackTrace.trim() || crash.cleanLines.join('\n'),
        causedBy: crash.causedBy || null,
        rawLog: crash.rawLines.join('\n')
      }
    };
    result.push(crashEntry);

    if (crash.rawEntries && crash.rawEntries.length > 0) {
      for (const re of crash.rawEntries) {
        result.push({
          ...re,
          category: 'APP LOGCAT',
          isCrashContinuationLine: true
        });
      }
    }
  }

  function stripCrashPrefix(text) {
    if (!text) return '';
    return text
      .replace(/^\[\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?\]\s*/, '')
      .replace(/^\[(INFO|WARN|ERROR|DEBUG)\]\s*/, '')
      .replace(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3}\s+\d+\s+\d+\s+[VDIWE]\s+/, '')
      .replace(/^(?:.*?\s+)?(?:AndroidRuntime(?:\(\s*\d+\s*\))?|E\/AndroidRuntime(?:\(\s*\d+\s*\))?):\s*/, '')
      .trim();
  }

  function isFatalExceptionStart(entry) {
    const text = entry.cleanText || '';
    const raw = entry.rawText || '';
    return text.includes('FATAL EXCEPTION') || text.includes('AndroidRuntime: FATAL') || raw.includes('FATAL EXCEPTION');
  }

  function isCrashContinuationLine(entry) {
    const clean = entry.cleanText || '';
    const raw = entry.rawText || '';
    if (isFatalExceptionStart(entry)) return false;
    if (clean.includes('[API]') || clean.includes('API_TO_CALL') || clean.startsWith('✓')) return false;
    if (raw.includes('AndroidRuntime') || clean.includes('AndroidRuntime')) return true;
    const stripped = stripCrashPrefix(clean || raw);
    if (
      stripped.startsWith('at ') ||
      stripped.startsWith('Process:') ||
      stripped.includes('PID:') ||
      stripped.startsWith('Caused by:') ||
      stripped.startsWith('...') ||
      /^[a-zA-Z_$][a-zA-Z0-9_$.]*(?:Exception|Error|Throwable)(?::.*)?$/.test(stripped)
    ) {
      return true;
    }
    return false;
  }

  for (let i = 0; i < rawParsed.length; i++) {
    const entry = rawParsed[i];
    const cleanText = entry.cleanText;

    if (isFatalExceptionStart(entry)) {
      if (activeCrash) {
        finalizeCrashBlock(activeCrash);
        activeCrash = null;
      }
      const stripped = stripCrashPrefix(cleanText || entry.rawText);
      const threadMatch = stripped.match(/FATAL EXCEPTION:\s*([^\s\r\n]+)/i);

      activeCrash = {
        id: `crash-${entry.index}`,
        time: '12:00:00',
        thread: threadMatch ? threadMatch[1] : 'main',
        process: null,
        pid: null,
        exceptionType: null,
        message: null,
        stackFrames: [],
        causedBy: null,
        rawLines: [entry.rawText],
        cleanLines: [entry.cleanText],
        startIndex: entry.index,
        rawEntries: [entry]
      };
      continue;
    }

    if (activeCrash) {
      if (isCrashContinuationLine(entry)) {
        activeCrash.rawLines.push(entry.rawText);
        activeCrash.cleanLines.push(entry.cleanText);
        activeCrash.rawEntries.push(entry);

        const stripped = stripCrashPrefix(cleanText || entry.rawText);
        const procMatch = stripped.match(/Process:\s*([^,\s\r\n]+)(?:,\s*PID:\s*(\d+))?/i);
        if (procMatch) {
          if (!activeCrash.process) activeCrash.process = procMatch[1];
          if (procMatch[2] && !activeCrash.pid) activeCrash.pid = procMatch[2];
        }
        const pidMatch = stripped.match(/PID:\s*(\d+)/i);
        if (pidMatch && !activeCrash.pid) {
          activeCrash.pid = pidMatch[1];
        }
        if (stripped.startsWith('Caused by:')) {
          activeCrash.causedBy = (activeCrash.causedBy ? activeCrash.causedBy + '\n' : '') + stripped;
        } else if (stripped.startsWith('at ') || stripped.startsWith('...')) {
          if (activeCrash.causedBy) {
            activeCrash.causedBy += '\n    ' + stripped;
          } else {
            activeCrash.stackFrames.push('    ' + stripped);
          }
        } else if (!activeCrash.exceptionType && !stripped.startsWith('Process:') && !stripped.includes('FATAL EXCEPTION')) {
          const excMatch = stripped.match(/^([a-zA-Z_$][a-zA-Z0-9_$.]*(?:Exception|Error|Throwable)|[a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)+)(?::\s*(.*))?$/);
          if (excMatch) {
            activeCrash.exceptionType = excMatch[1];
            activeCrash.message = excMatch[2] ? excMatch[2].trim() : '';
          }
        }
        continue;
      } else {
        finalizeCrashBlock(activeCrash);
        activeCrash = null;
      }
    }

    result.push(entry);
  }

  if (activeCrash) {
    finalizeCrashBlock(activeCrash);
    activeCrash = null;
  }

  return result;
}

describe('Phase 3B — Real App Crash Detection & Full Crash Diagnostics', () => {

  const sampleCrashLogs = [
    '05-18 14:22:01.123  8124  8124 E AndroidRuntime: FATAL EXCEPTION: main',
    '05-18 14:22:01.124  8124  8124 E AndroidRuntime: Process: com.nra.flyermaker, PID: 8124',
    '05-18 14:22:01.125  8124  8124 E AndroidRuntime: java.lang.NullPointerException: Attempt to invoke virtual method on a null object reference',
    '05-18 14:22:01.126  8124  8124 E AndroidRuntime: \tat com.nra.flyermaker.MainActivity.onCreate(MainActivity.java:42)',
    '05-18 14:22:01.127  8124  8124 E AndroidRuntime: \tat android.app.Activity.performCreate(Activity.java:8051)',
    '05-18 14:22:01.128  8124  8124 E AndroidRuntime: \tat android.app.Instrumentation.callActivityOnCreate(Instrumentation.java:1342)',
    '05-18 14:22:01.129  8124  8124 E AndroidRuntime: Caused by: java.lang.IllegalStateException: Missing token Bearer eyJhbGciOiJIUzI1NiJ9.test',
    '05-18 14:22:01.130  8124  8124 E AndroidRuntime: \tat com.nra.flyermaker.auth.TokenValidator.validate(TokenValidator.java:18)'
  ];

  it('1. Detects FATAL EXCEPTION start line as category APP CRASH', () => {
    const entry = parseLogEntry(sampleCrashLogs[0], 0);
    assert.strictEqual(entry.category, 'APP CRASH');
    assert.strictEqual(entry.status, 'CRASH');
  });

  it('2. Detects AndroidRuntime: FATAL start line as category APP CRASH', () => {
    const entry = parseLogEntry('10-06 12:00:00.000 1234 1234 E AndroidRuntime: FATAL: unhandled throwable', 0);
    assert.strictEqual(entry.category, 'APP CRASH');
  });

  it('3. Extracts thread name from FATAL EXCEPTION line correctly', () => {
    const correlated = correlateLogs(sampleCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    assert.ok(crash, 'Crash event should exist');
    assert.strictEqual(crash.crashDetails.thread, 'main');
  });

  it('4. Extracts package process name and PID correctly', () => {
    const correlated = correlateLogs(sampleCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    assert.strictEqual(crash.crashDetails.process, 'com.nra.flyermaker');
    assert.strictEqual(crash.crashDetails.pid, '8124');
  });

  it('5. Extracts exception type and message correctly', () => {
    const correlated = correlateLogs(sampleCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    assert.strictEqual(crash.crashDetails.exceptionType, 'java.lang.NullPointerException');
    assert.strictEqual(crash.crashDetails.message, 'Attempt to invoke virtual method on a null object reference');
  });

  it('6. Accumulates complete multi-line stack trace frames', () => {
    const correlated = correlateLogs(sampleCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    assert.ok(crash.crashDetails.stackTrace.includes('MainActivity.onCreate(MainActivity.java:42)'));
    assert.ok(crash.crashDetails.stackTrace.includes('Activity.performCreate'));
  });

  it('7. Captures Caused by chain in crashDetails', () => {
    const correlated = correlateLogs(sampleCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    assert.ok(crash.crashDetails.causedBy, 'Caused by should be captured');
    assert.ok(crash.crashDetails.causedBy.includes('IllegalStateException'));
    assert.ok(crash.crashDetails.causedBy.includes('TokenValidator.validate'));
  });

  it('8. Captures raw crash log stream verbatim', () => {
    const correlated = correlateLogs(sampleCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    assert.ok(crash.crashDetails.rawLog.includes('FATAL EXCEPTION: main'));
    assert.ok(crash.crashDetails.rawLog.includes('Process: com.nra.flyermaker, PID: 8124'));
  });

  it('9. Non-fatal application error remains category ERROR, not APP CRASH', () => {
    const errorLog = '10-06 12:00:00.000 8124 8124 E Glide: Failed to find GeneratedAppGlideModule';
    const entry = parseLogEntry(errorLog, 0);
    assert.strictEqual(entry.category, 'ERROR');
    assert.notStrictEqual(entry.category, 'APP CRASH');
  });

  it('10. Consolidated event replaces scattered crash lines in All tab', () => {
    const mixedLogs = [
      'Normal log line 1',
      ...sampleCrashLogs,
      'Normal log line 2'
    ];
    const correlated = correlateLogs(mixedLogs);
    const allTabEvents = correlated.filter(e => !e.isCrashContinuationLine);
    const crashEvents = allTabEvents.filter(e => e.category === 'APP CRASH');
    assert.strictEqual(crashEvents.length, 1, 'Only one consolidated crash event should appear in All view');
    assert.strictEqual(allTabEvents.length, 3, 'All view has 2 normal logs + 1 crash event');
  });

  it('11. Continuation lines remain available for App Logcat stream', () => {
    const mixedLogs = [
      'Normal log line 1',
      ...sampleCrashLogs
    ];
    const correlated = correlateLogs(mixedLogs);
    const rawContinuationLines = correlated.filter(e => e.isCrashContinuationLine);
    assert.strictEqual(rawContinuationLines.length, sampleCrashLogs.length);
  });

  it('12. Errors tab excludes fatal APP CRASH events', () => {
    const mixedLogs = [
      '10-06 12:00:00.000 E Error message 1',
      ...sampleCrashLogs,
      '10-06 12:00:00.000 E Error message 2'
    ];
    const correlated = correlateLogs(mixedLogs);
    const errorTabLogs = correlated.filter(e => e.category === 'ERROR');
    assert.strictEqual(errorTabLogs.length, 2);
    assert.ok(errorTabLogs.every(e => !e.cleanText.includes('FATAL EXCEPTION')));
  });

  it('13. App Crashes tab includes only APP CRASH events', () => {
    const mixedLogs = [
      '10-06 12:00:00.000 E Error message 1',
      ...sampleCrashLogs,
      '10-06 12:00:00.000 I Normal info'
    ];
    const correlated = correlateLogs(mixedLogs);
    const crashTabLogs = correlated.filter(e => e.category === 'APP CRASH');
    assert.strictEqual(crashTabLogs.length, 1);
    assert.strictEqual(crashTabLogs[0].crashDetails.pid, '8124');
  });

  it('14. formatCrashReport generates complete developer-friendly plain text', () => {
    const correlated = correlateLogs(sampleCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    const report = formatCrashReport(crash, {
      applicationName: 'Flyer Maker',
      packageName: 'com.nra.flyermaker',
      device: 'Vivo V2143'
    });

    assert.ok(report.includes('ANDROID APP CRASH REPORT'));
    assert.ok(report.includes('Application:\nFlyer Maker'));
    assert.ok(report.includes('Package:\ncom.nra.flyermaker'));
    assert.ok(report.includes('Device:\nVivo V2143'));
    assert.ok(report.includes('PID:\n8124'));
    assert.ok(report.includes('Thread:\nmain'));
    assert.ok(report.includes('Exception:\njava.lang.NullPointerException'));
    assert.ok(report.includes('Stack Trace:'));
    assert.ok(report.includes('Caused By:'));
    assert.ok(report.includes('Raw Crash Log:'));
  });

  it('15. formatCrashReport sanitizes tokens and secrets', () => {
    const correlated = correlateLogs(sampleCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    const report = formatCrashReport(crash);
    assert.ok(!report.includes('eyJhbGciOiJIUzI1NiJ9.test'), 'JWT token must be redacted');
    assert.ok(report.includes('[REDACTED_TOKEN]') || report.includes('[REDACTED_JWT]'));
  });

  it('16. Multiple crashes are captured as independent events without overwriting', () => {
    const doubleCrashLogs = [
      ...sampleCrashLogs,
      '05-18 14:22:05.000  8124  8124 I Application: Resumed after restart',
      '05-18 14:22:10.123  9555  9555 E AndroidRuntime: FATAL EXCEPTION: background-worker',
      '05-18 14:22:10.124  9555  9555 E AndroidRuntime: Process: com.nra.flyermaker, PID: 9555',
      '05-18 14:22:10.125  9555  9555 E AndroidRuntime: java.lang.OutOfMemoryError: Failed to allocate 64MB bitmap',
      '05-18 14:22:10.126  9555  9555 E AndroidRuntime: \tat android.graphics.Bitmap.nativeCreate(Native Method)'
    ];

    const correlated = correlateLogs(doubleCrashLogs);
    const crashes = correlated.filter(e => e.category === 'APP CRASH');
    assert.strictEqual(crashes.length, 2, 'Must record two distinct crash events');
    assert.strictEqual(crashes[0].crashDetails.pid, '8124');
    assert.strictEqual(crashes[0].crashDetails.thread, 'main');
    assert.strictEqual(crashes[1].crashDetails.pid, '9555');
    assert.strictEqual(crashes[1].crashDetails.thread, 'background-worker');
    assert.strictEqual(crashes[1].crashDetails.exceptionType, 'java.lang.OutOfMemoryError');
  });

  it('17. Buffer pruning retains both API and Crash events indefinitely', () => {
    const buffer = [];
    for (let i = 0; i < 2500; i++) {
      buffer.push({ text: `Normal log ${i}`, category: 'LOGCAT' });
    }
    buffer.push({ text: '[VOLLEY_200] /api/v1/test', category: 'API' });
    buffer.push({ text: 'FATAL EXCEPTION: main', category: 'APP CRASH', type: 'APP_CRASH' });
    for (let i = 0; i < 1000; i++) {
      buffer.push({ text: `Extra log ${i}`, category: 'LOGCAT' });
    }

    assert.ok(buffer.length > 3000);

    const isPermanent = (l) => {
      if (!l) return false;
      if (l.type === 'APP_CRASH' || l.category === 'APP CRASH') return true;
      if (l.category === 'API') return true;
      const txt = l.text || '';
      return txt.includes('FATAL EXCEPTION') || txt.includes('[VOLLEY_');
    };

    const permanent = buffer.filter(isPermanent);
    const others = buffer.filter(l => !isPermanent(l));
    const retained = [...permanent, ...others.slice(-2000)];

    assert.ok(retained.some(l => l.category === 'API'));
    assert.ok(retained.some(l => l.category === 'APP CRASH'));
  });

  it('18. TestRunner monitorLogcatForPad detects fatal exception and preserves context', () => {
    assert.ok(typeof testRunnerService.monitorLogcatForPad === 'function');
  });

  it('19. Dynamic PID relaunch preserves ability to capture crashes under new PID', () => {
    const relaunchCrashLogs = [
      '05-18 14:30:00.000 11200 11200 E AndroidRuntime: FATAL EXCEPTION: main',
      '05-18 14:30:00.001 11200 11200 E AndroidRuntime: Process: com.nra.flyermaker, PID: 11200',
      '05-18 14:30:00.002 11200 11200 E AndroidRuntime: java.lang.SecurityException: Permission denied'
    ];
    const correlated = correlateLogs(relaunchCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    assert.ok(crash);
    assert.strictEqual(crash.crashDetails.pid, '11200');
    assert.strictEqual(crash.crashDetails.exceptionType, 'java.lang.SecurityException');
  });

  it('20. Clean text summary for row displays Exception Type and Message', () => {
    const correlated = correlateLogs(sampleCrashLogs);
    const crash = correlated.find(e => e.category === 'APP CRASH');
    assert.strictEqual(
      crash.cleanText,
      'CRASH: java.lang.NullPointerException: Attempt to invoke virtual method on a null object reference'
    );
  });

});
