const { test, describe, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const iosService = require('../src/services/iosService');
const iosMirrorService = require('../src/services/iosMirrorService');
const deviceLockService = require('../src/services/deviceLockService');

describe('iOS Device Detection and Mirroring Suite', () => {
  const mockUserA = { id: 'usr_ios_tester_1', name: 'iOS Tester 1', email: 'tester1@apple.qa', role: 'tester' };
  const mockUserB = { id: 'usr_ios_tester_2', name: 'iOS Tester 2', email: 'tester2@apple.qa', role: 'tester' };
  const mockAdmin = { id: 'usr_admin', name: 'QA Admin', email: 'admin@qatools.internal', role: 'admin' };

  const sampleUdid1 = '00008110-001A29040182801E'; // 25-char format
  const sampleUdid2 = '7b2586b46853289052b610ff982e5b7c7b829104'; // 40-char format
  const androidSerial = '192.168.1.150:5555';

  beforeEach(() => {
    deviceLockService.clearOwner(sampleUdid1);
    deviceLockService.clearOwner(sampleUdid2);
    deviceLockService.clearOwner(androidSerial);
  });

  test('isIosDevice correctly distinguishes iOS UDIDs from Android serials', () => {
    assert.strictEqual(iosService.isIosDevice(sampleUdid1), true);
    assert.strictEqual(iosService.isIosDevice(sampleUdid2), true);
    assert.strictEqual(iosService.isIosDevice(androidSerial), false);
    assert.strictEqual(iosService.isIosDevice('emulator-5554'), false);
    assert.strictEqual(iosService.isIosDevice('R58M30XYZAB'), false);
    assert.strictEqual(iosService.isIosDevice(null), false);
    assert.strictEqual(iosService.isIosDevice(undefined), false);
  });

  test('iosService.listDevices executes safely and returns array', async () => {
    const devices = await iosService.listDevices();
    assert.ok(Array.isArray(devices));
  });

  test('iosService.getDeviceInfo returns normalized structure', async () => {
    const info = await iosService.getDeviceInfo(sampleUdid1);
    assert.strictEqual(info.serial, sampleUdid1);
    assert.strictEqual(info.platform, 'ios');
    assert.strictEqual(info.manufacturer, 'Apple');
    assert.ok(info.osVersion.includes('iOS'));
  });

  test('iOS device participates in connection ownership lifecycle with claims removed', () => {
    // 1. Assign connection ownership to User A
    deviceLockService.setOwner(sampleUdid1, mockUserA);
    assert.strictEqual(deviceLockService.isDeviceAccessible(sampleUdid1, mockUserA), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(sampleUdid1, mockUserB), false);

    // 2. Legacy getClaim returns null (claims deprecated)
    const status = deviceLockService.getClaim(sampleUdid1);
    assert.strictEqual(status, null);

    // 3. User A clears ownership
    deviceLockService.clearOwner(sampleUdid1);

    // 4. Device is now unowned and accessible to authenticated User B
    assert.strictEqual(deviceLockService.isDeviceAccessible(sampleUdid1, mockUserB), true);

    // 5. User B takes connection ownership
    deviceLockService.setOwner(sampleUdid1, mockUserB);
    assert.strictEqual(deviceLockService.isDeviceAccessible(sampleUdid1, mockUserB), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(sampleUdid1, mockUserA), false);

    // 6. Cleanup
    deviceLockService.clearOwner(sampleUdid1);
  });

  test('iosMirrorService reports inactive status for unmirrored device', () => {
    const status = iosMirrorService.getMirrorStatus(sampleUdid1);
    assert.strictEqual(status.active, false);
    assert.strictEqual(status.udid, sampleUdid1);
  });

  test('iosMirrorService rejects startMirror when device owned by another user', async () => {
    deviceLockService.setOwner(sampleUdid1, mockUserA);

    await assert.rejects(
      async () => {
        await iosMirrorService.startMirror(sampleUdid1, mockUserB);
      },
      /Device is currently claimed by another user/
    );

    deviceLockService.clearOwner(sampleUdid1);
  });

  test('iosMirrorService rejects captureScreenshot when device owned by another user', async () => {
    deviceLockService.setOwner(sampleUdid1, mockUserA);

    await assert.rejects(
      async () => {
        await iosMirrorService.captureScreenshot(sampleUdid1, mockUserB);
      },
      /Device is currently claimed by another user/
    );

    deviceLockService.clearOwner(sampleUdid1);
  });

  test('iosService.getDiagnostics returns system diagnostic structure', async () => {
    const diag = await iosService.getDiagnostics();
    assert.ok(typeof diag === 'object');
    assert.strictEqual(typeof diag.pythonAvailable, 'boolean');
    assert.strictEqual(typeof diag.pymobiledevice3Available, 'boolean');
    assert.strictEqual(typeof diag.usbmuxdReachable, 'boolean');
  });

  test('Cross-platform safety: ADB controller rejects operations targeting iOS UDID', async () => {
    const adbController = require('../src/controllers/adbController');
    let resStatus = 0;
    let resBody = null;

    const mockRes = {
      status(code) {
        resStatus = code;
        return {
          json(body) {
            resBody = body;
          }
        };
      },
      json(body) {
        resBody = body;
      }
    };

    const mockReq = {
      params: { id: sampleUdid1 },
      body: { packageName: 'com.example.app' },
      user: mockUserA
    };

    await adbController.clearData(mockReq, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.ok(resBody.error.includes('not supported on iOS devices'));

    await adbController.clearCache(mockReq, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.ok(resBody.error.includes('not supported on iOS devices'));

    await adbController.uninstall(mockReq, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.ok(resBody.error.includes('not supported on iOS devices'));

    await adbController.launch(mockReq, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.ok(resBody.error.includes('not supported on iOS devices'));

    await adbController.clearLogcat(mockReq, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.ok(resBody.error.includes('not supported on iOS devices'));

    const cmdReq = {
      body: { serial: sampleUdid1, command: 'shell ls' },
      user: mockUserA
    };
    await adbController.executeSafeCommand(cmdReq, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.ok(resBody.error.includes('cannot be executed on iOS'));
  });

  test('Cross-platform safety: Test controller rejects PAD test on iOS device', async () => {
    const testController = require('../src/controllers/testController');
    let resStatus = 0;
    let resBody = null;

    const mockRes = {
      status(code) {
        resStatus = code;
        return {
          json(body) {
            resBody = body;
          }
        };
      },
      json(body) {
        resBody = body;
      }
    };

    const mockReq = {
      body: { buildId: 'build_123', deviceSerial: sampleUdid1 },
      user: mockUserA
    };

    await testController.runTest(mockReq, mockRes, () => {});
    assert.strictEqual(resStatus, 400);
    assert.ok(resBody.error.includes('only supported on Android devices'));
  });
});
