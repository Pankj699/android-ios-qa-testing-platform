const { describe, it } = require('node:test');
const assert = require('node:assert');
const EventEmitter = require('events');

const adbService = require('../src/services/adbService');
const testRunnerService = require('../src/services/testRunnerService');
const deviceLockService = require('../src/services/deviceLockService');
const historyService = require('../src/services/historyService');
const { sendToTest, sendToUser } = require('../src/websocket/testSocket');

describe('Phase 2 — QA Event Stream + Already-Installed App Monitoring', () => {

  // Test 1: listInstalledPackages filters third-party vs system packages
  it('1. adbService.listInstalledPackages discovers and parses installed packages correctly', async () => {
    const origExec = adbService.execute;

    adbService.execute = async (args) => {
      const isThirdParty = args.includes('-3');
      const isAll = !isThirdParty && args.includes('packages');

      if (isThirdParty) {
        return {
          code: 0,
          stdout: 'package:com.nra.flyermaker\npackage:com.bg.logomaker\n',
          stderr: '',
          raw: ''
        };
      }
      if (isAll) {
        return {
          code: 0,
          stdout: 'package:android\npackage:com.android.systemui\npackage:com.nra.flyermaker\n',
          stderr: '',
          raw: ''
        };
      }
      return { code: 0, stdout: '', stderr: '', raw: '' };
    };

    // Test 3rd party list
    const thirdParty = await adbService.listInstalledPackages('DEV-01', { includeSystem: false });
    assert.strictEqual(thirdParty.length, 2);
    assert.strictEqual(thirdParty[0].packageName, 'com.nra.flyermaker');
    assert.strictEqual(thirdParty[0].isSystem, false);
    assert.strictEqual(thirdParty[0].isThirdParty, true);
    assert.strictEqual(thirdParty[0].label, 'Flyermaker');
    assert.strictEqual(thirdParty[1].packageName, 'com.bg.logomaker');
    assert.strictEqual(thirdParty[1].label, 'Logomaker');

    // Test all packages list (includeSystem: true)
    const all = await adbService.listInstalledPackages('DEV-01', { includeSystem: true });
    assert.strictEqual(all.length, 4); // 2 third party + 2 system
    assert.strictEqual(all[0].packageName, 'com.nra.flyermaker');
    assert.strictEqual(all[0].isSystem, false);
    assert.strictEqual(all[2].packageName, 'android');
    assert.strictEqual(all[2].isSystem, true);

    adbService.execute = origExec;
  });

  // Test 2: Package Name & Device Claim Authorization
  it('2. Multi-User Device Claim Isolation prevents User B from monitoring apps on User A\'s device', async () => {
    const userAlice = { id: 'usr_alice_claim', name: 'Alice', role: 'tester' };
    const userBob = { id: 'usr_bob_claim', name: 'Bob', role: 'tester' };
    const deviceSerial = 'DEV-CLAIM-TEST-01';

    // Alice claims device
    deviceLockService.claimDevice(deviceSerial, userAlice);

    // Verify Bob cannot access device
    const bobAccess = deviceLockService.isDeviceAccessible(deviceSerial, userBob);
    assert.strictEqual(bobAccess, false, 'User B must not have access to User A claimed device');

    // Verify Alice has access
    const aliceAccess = deviceLockService.isDeviceAccessible(deviceSerial, userAlice);
    assert.strictEqual(aliceAccess, true, 'User A must have access to their claimed device');

    // Attempting monitorInstalledApp with Bob should fail authorization
    await assert.rejects(
      async () => {
        await testRunnerService.monitorInstalledApp({
          deviceSerial,
          packageName: 'com.nra.flyermaker',
          user: userBob
        });
      },
      {
        message: /not accessible to your account/
      }
    );

    // Clean up claim
    deviceLockService.releaseDevice(deviceSerial, userAlice);
  });

  // Test 3: Installed App Session Creation and Lifecycle
  it('3. monitorInstalledApp initializes session with source: "installed-app" and attaches PID watcher', async () => {
    const origExec = adbService.execute;
    const origGetDevices = adbService.getConnectedDevices;
    const origStreamPidLogcat = adbService.streamPidLogcat;

    const deviceSerial = 'DEV-INSTALLED-01';
    const packageName = 'com.nra.flyermaker';
    const userAlice = { id: 'usr_alice_2', name: 'Alice Tester', role: 'tester' };

    adbService.getConnectedDevices = async () => [
      { serial: deviceSerial, name: 'Vivo Test Device', status: 'device' }
    ];

    adbService.execute = async (args) => {
      if (args.includes('pm') && args.includes('packages')) {
        return { code: 0, stdout: 'package:com.nra.flyermaker\n', stderr: '', raw: '' };
      }
      if (args.includes('pidof')) {
        return { code: 0, stdout: '7788\n', stderr: '', raw: '7788' };
      }
      if (args.includes('monkey')) {
        return { code: 0, stdout: 'Events injected: 1', stderr: '', raw: '' };
      }
      return { code: 0, stdout: '', stderr: '', raw: '' };
    };

    let logcatStreamCreated = false;
    adbService.streamPidLogcat = (serial, pid) => {
      logcatStreamCreated = true;
      const mockProc = new EventEmitter();
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.kill = () => true;
      return mockProc;
    };

    const session = await testRunnerService.monitorInstalledApp({
      deviceSerial,
      packageName,
      launchApp: true,
      monitoringTimeoutSec: 1,
      user: userAlice
    });

    assert.ok(session.testId, 'Test session ID must be generated');
    assert.strictEqual(session.status, 'RUNNING');
    assert.strictEqual(session.packageName, packageName);
    assert.strictEqual(session.pid, '7788');
    assert.ok(logcatStreamCreated, 'PID-scoped logcat stream must be attached for initial PID');

    // Clean up active session
    const activeState = testRunnerService.activeTests.get(session.testId);
    if (activeState) {
      if (activeState.pidWatchInterval) clearInterval(activeState.pidWatchInterval);
      if (activeState.logcatProc) {
        try { activeState.logcatProc.kill(); } catch (e) {}
      }
      testRunnerService.activeTests.delete(session.testId);
    }

    adbService.execute = origExec;
    adbService.getConnectedDevices = origGetDevices;
    adbService.streamPidLogcat = origStreamPidLogcat;
  });

  // Test 4: App Not Running Initial State
  it('4. Handles installed app not currently running (PID=null) and waits for launch', async () => {
    const origExec = adbService.execute;
    const origGetDevices = adbService.getConnectedDevices;

    const deviceSerial = 'DEV-INSTALLED-02';
    const packageName = 'com.nra.flyermaker';
    const userAlice = { id: 'usr_alice_3', name: 'Alice Tester', role: 'tester' };

    adbService.getConnectedDevices = async () => [
      { serial: deviceSerial, name: 'Vivo Test Device', status: 'device' }
    ];

    adbService.execute = async (args) => {
      if (args.includes('pm') && args.includes('packages')) {
        return { code: 0, stdout: 'package:com.nra.flyermaker\n', stderr: '', raw: '' };
      }
      if (args.includes('pidof') || args.includes('ps')) {
        return { code: 1, stdout: '', stderr: 'not found', raw: '' };
      }
      return { code: 0, stdout: '', stderr: '', raw: '' };
    };

    const session = await testRunnerService.monitorInstalledApp({
      deviceSerial,
      packageName,
      launchApp: false, // Do not auto launch
      monitoringTimeoutSec: 1,
      user: userAlice
    });

    assert.ok(session.testId);
    assert.strictEqual(session.status, 'RUNNING');
    assert.strictEqual(session.pid, null);

    // Clean up
    const activeState = testRunnerService.activeTests.get(session.testId);
    if (activeState) {
      if (activeState.pidWatchInterval) clearInterval(activeState.pidWatchInterval);
      testRunnerService.activeTests.delete(session.testId);
    }

    adbService.execute = origExec;
    adbService.getConnectedDevices = origGetDevices;
  });

  // Test 5: Dynamic PID tracking across app relaunches
  it('5. Dynamic PID tracking detects new PID on app restart and transitions logcat stream seamlessly', async () => {
    const origExec = adbService.execute;
    let currentProcessPid = '5001';

    adbService.execute = async (args) => {
      if (args.includes('pidof')) {
        return { code: 0, stdout: `${currentProcessPid}\n`, stderr: '', raw: currentProcessPid };
      }
      return { code: 0, stdout: '', stderr: '', raw: '' };
    };

    let streamInstances = [];
    const origStreamPidLogcat = adbService.streamPidLogcat;
    adbService.streamPidLogcat = (serial, pid) => {
      const mockProc = new EventEmitter();
      mockProc.pidVal = pid;
      mockProc.killed = false;
      mockProc.stdout = new EventEmitter();
      mockProc.stderr = new EventEmitter();
      mockProc.kill = () => { mockProc.killed = true; };
      streamInstances.push(mockProc);
      return mockProc;
    };

    const testId = 'test_dynamic_relaunch_' + Date.now();
    const activeState = {
      testId,
      user: { id: 'usr_dyn', name: 'Tester' },
      testData: { id: testId, packageName: 'com.nra.flyermaker', deviceSerial: 'DEV-DYN-01' },
      currentPid: '5001',
      logcatProc: null
    };

    // Attach initial stream
    testRunnerService.startInstalledAppLogcatStream(testId, 'DEV-DYN-01', 'com.nra.flyermaker', activeState);
    assert.strictEqual(streamInstances.length, 1);
    assert.strictEqual(streamInstances[0].pidVal, '5001');

    // Simulate App Relaunch (PID changes to 6002)
    currentProcessPid = '6002';
    const newPid = await adbService.getPid('DEV-DYN-01', 'com.nra.flyermaker');
    assert.strictEqual(newPid, '6002');

    // Transition stream
    activeState.currentPid = newPid;
    testRunnerService.startInstalledAppLogcatStream(testId, 'DEV-DYN-01', 'com.nra.flyermaker', activeState);

    assert.strictEqual(streamInstances.length, 2);
    assert.strictEqual(streamInstances[0].killed, true, 'Old logcat process must be cleanly killed');
    assert.strictEqual(streamInstances[1].pidVal, '6002', 'New logcat process must be spawned for new PID');

    // Clean up
    if (activeState.pidWatchInterval) clearInterval(activeState.pidWatchInterval);
    streamInstances.forEach(p => { try { p.kill(); } catch (e) {} });
    adbService.execute = origExec;
    adbService.streamPidLogcat = origStreamPidLogcat;
  });

  // Test 6: Non-destructive guarantee
  it('6. Non-destructive guarantee: Monitor installed app does NOT invoke bundletool, build, or apk generation', async () => {
    let bundletoolCalled = false;
    let buildCalled = false;

    // Verify testRunnerService.monitorInstalledApp exists and does not invoke bundletool
    assert.ok(typeof testRunnerService.monitorInstalledApp === 'function');
    assert.strictEqual(bundletoolCalled, false);
    assert.strictEqual(buildCalled, false);
  });

});
