const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const historyService = require('../src/services/historyService');
const testController = require('../src/controllers/testController');

test('Browser USB Endpoint & Conflict Resolution Suite', async (t) => {
  const mockUser = {
    id: 'usr_browser_tester',
    username: 'Browser Tester',
    role: 'tester'
  };

  // Create a mock build record
  const buildId = 'build_mock_usb_' + Date.now();
  const mockBuild = {
    id: buildId,
    packageName: 'com.test.browserusb',
    version: '2.4.0',
    fileName: 'app-release.aab',
    filePath: path.join(process.cwd(), 'uploads', 'mock_app.aab'),
    assetPacks: [{ name: 'level_pack_1', deliveryType: 'on-demand', size: 102400 }],
    userId: mockUser.id
  };
  historyService.saveBuild(mockBuild);

  await t.test('POST /api/test/save-browser-result saves test execution record into history', async () => {
    let responseStatus = 200;
    let responseData = null;

    const mockReq = {
      user: mockUser,
      body: {
        buildId: mockBuild.id,
        packageName: mockBuild.packageName,
        version: mockBuild.version,
        deviceSerial: 'browser_usb_emulator_5554',
        deviceName: 'Pixel 8 Pro (USB)',
        installMode: 'fresh',
        launchApp: true,
        steps: [
          { id: 'check_prereqs', label: 'Prerequisites', status: 'PASSED', duration: '200ms' },
          { id: 'install_app', label: 'Install APK', status: 'PASSED', duration: '2.1s' },
          { id: 'verify_result', label: 'Verification', status: 'PASSED', duration: '100ms' }
        ],
        status: 'COMPLETED',
        result: 'PASS',
        totalDurationMs: 4500,
        logs: ['[INFO] WebUSB stream active', '[INFO] Install success'],
        assetPacks: mockBuild.assetPacks
      }
    };

    const mockRes = {
      status(code) {
        responseStatus = code;
        return this;
      },
      json(data) {
        responseData = data;
        return this;
      }
    };

    await testController.saveBrowserResult(mockReq, mockRes, () => {});

    assert.strictEqual(responseStatus, 201);
    assert.strictEqual(responseData.success, true);
    assert.strictEqual(responseData.test.packageName, 'com.test.browserusb');
    assert.strictEqual(responseData.test.connectionMode, 'browser-usb');
    assert.strictEqual(responseData.test.result, 'PASS');
    assert.strictEqual(responseData.test.userId, mockUser.id);

    // Verify record in historyService
    const saved = historyService.getTestById(responseData.test.id);
    assert.ok(saved, 'Test record must exist in history');
    assert.strictEqual(saved.deviceId, 'browser_usb_emulator_5554');
  });

  await t.test('Host ADB conflict detection identifies device active on host ADB before WebUSB claim', () => {
    const activeServerDevices = [
      { serial: 'CPH2729', model: 'OnePlus Nord', isWireless: false, connected: true, connectionMode: 'server-adb' },
      { serial: '192.168.0.22:43827', model: 'Pixel 7', isWireless: true, connected: true, connectionMode: 'server-adb' }
    ];

    const selectedSerial = 'CPH2729';

    const hasConflict = activeServerDevices.some((d) => {
      const isConnected = d.connected ?? true;
      const isServerAdb = d.connectionMode !== 'browser-usb' && !d.serial?.startsWith('browser_usb_');
      const isUsb = !d.isWireless && !d.serial?.includes(':');
      return isConnected && isServerAdb && isUsb && (d.serial === selectedSerial || d.hardwareSerial === selectedSerial);
    });

    assert.strictEqual(hasConflict, true, 'Physical USB device active on host ADB must trigger conflict check');

    // Wireless device should NOT conflict with WebUSB
    const wirelessSerial = '192.168.0.22:43827';
    const wirelessConflict = activeServerDevices.some((d) => {
      const isConnected = d.connected ?? true;
      const isServerAdb = d.connectionMode !== 'browser-usb' && !d.serial?.startsWith('browser_usb_');
      const isUsb = !d.isWireless && !d.serial?.includes(':');
      return isConnected && isServerAdb && isUsb && (d.serial === wirelessSerial || d.hardwareSerial === wirelessSerial);
    });

    assert.strictEqual(wirelessConflict, false, 'Wireless devices must not trigger USB conflict');
  });

  await t.test('ClaimInterface failure error message is translated to friendly host ADB conflict message', () => {
    const rawError = new Error("Failed to execute 'claimInterface' on 'USBDevice': Unable to claim interface.");
    const msg = rawError.message;
    let translatedMessage = '';

    if (
      msg.includes('claimInterface') ||
      msg.includes('Unable to claim interface') ||
      msg.includes('busy') ||
      msg.includes('Access denied') ||
      msg.includes('LIBUSB_ERROR_BUSY') ||
      msg.includes('already in use')
    ) {
      translatedMessage = 'This device is currently connected to the host ADB service. Disconnect the device from host ADB before connecting it through Browser USB.';
    }

    assert.strictEqual(
      translatedMessage,
      'This device is currently connected to the host ADB service. Disconnect the device from host ADB before connecting it through Browser USB.'
    );
  });

  await t.test('Physical USB device deduplication removes duplicate server ADB entry when connected via Browser USB', () => {
    const serverDevices = [
      { serial: 'CPH2729', hardwareSerial: 'CPH2729', name: 'OnePlus Nord (Server)', isWireless: false, connectionMode: 'server-adb' },
      { serial: '192.168.0.22:43827', name: 'Pixel 7 (Wi-Fi)', isWireless: true, connectionMode: 'server-adb' }
    ];

    const browserUsbDevice = {
      serial: 'browser_usb_CPH2729',
      hardwareSerial: 'CPH2729',
      name: 'OnePlus Nord (USB)',
      isWireless: false,
      connectionMode: 'browser-usb'
    };

    const hwSerial = browserUsbDevice.hardwareSerial || browserUsbDevice.serial?.replace('browser_usb_', '');
    const filteredServerDevices = serverDevices.filter((d) => {
      if (d.serial === browserUsbDevice.serial) return false;
      if (hwSerial && (d.serial === hwSerial || d.hardwareSerial === hwSerial)) {
        return false;
      }
      return true;
    });

    const combinedDevices = [browserUsbDevice, ...filteredServerDevices];

    assert.strictEqual(combinedDevices.length, 2);
    assert.strictEqual(combinedDevices[0].serial, 'browser_usb_CPH2729');
    assert.strictEqual(combinedDevices[1].serial, '192.168.0.22:43827');
    assert.strictEqual(combinedDevices.some(d => d.serial === 'CPH2729'), false, 'Duplicate CPH2729 server entry must be filtered out');
  });

  await t.test('Multi-User Isolation: User A Browser USB does not register global server claims or lock out User B', () => {
    const deviceLockService = require('../src/services/deviceLockService');
    const userA = { id: 'usr_user_a', username: 'User A', email: 'userA@company.com' };
    const userB = { id: 'usr_user_b', username: 'User B', email: 'userB@company.com' };

    const browserUsbSerial = 'browser_usb_device_a';

    // 1. Browser USB devices should NOT be in global server claims
    const claim = deviceLockService.getClaim(browserUsbSerial);
    assert.strictEqual(claim, null, 'Browser USB device must never be stored in global server claims');

    // 2. User B can own and access their own device independently
    const serverSerialB = '192.168.1.188:5555';
    deviceLockService.setOwner(serverSerialB, userB);

    assert.strictEqual(deviceLockService.isDeviceAccessible(serverSerialB, userB), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serverSerialB, userA), false);

    // Clean up
    deviceLockService.clearOwner(serverSerialB);
  });

  await t.test('POST /api/test/prepare-browser-artifact input validation and error handling', async () => {
    // 1. Missing buildId
    let statusMissing = 200;
    let dataMissing = null;
    await testController.prepareBrowserArtifact(
      { body: {}, user: mockUser },
      {
        status(c) { statusMissing = c; return this; },
        json(d) { dataMissing = d; return this; }
      },
      () => {}
    );
    assert.strictEqual(statusMissing, 400);
    assert.strictEqual(dataMissing.success, false);
    assert.match(dataMissing.error, /Build ID is required/i);

    // 2. Non-existent buildId
    let statusNotFound = 200;
    let dataNotFound = null;
    await testController.prepareBrowserArtifact(
      { body: { buildId: 'build_nonexistent_9999' }, user: mockUser },
      {
        status(c) { statusNotFound = c; return this; },
        json(d) { dataNotFound = d; return this; }
      },
      () => {}
    );
    assert.strictEqual(statusNotFound, 404);
    assert.strictEqual(dataNotFound.success, false);
    assert.match(dataNotFound.error, /not found/i);

    // 3. Unauthorized access (different user)
    let statusForbidden = 200;
    let dataForbidden = null;
    await testController.prepareBrowserArtifact(
      { body: { buildId: mockBuild.id }, user: { id: 'usr_stranger', role: 'tester' } },
      {
        status(c) { statusForbidden = c; return this; },
        json(d) { dataForbidden = d; return this; }
      },
      () => {}
    );
    assert.strictEqual(statusForbidden, 403);
    assert.strictEqual(dataForbidden.success, false);
    assert.match(dataForbidden.error, /Forbidden/i);
  });

  await t.test('POST /api/test/prepare-browser-artifact successfully prepares artifact and avoids exposing internal filesystem paths', async () => {
    const config = require('../src/config');
    assert.strictEqual(typeof config.OUTPUT_DIR, 'string', 'config.OUTPUT_DIR must be a defined string');

    // Create a temporary mock apk file
    const tempDir = path.join(config.DATA_DIR, 'test_temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    const tempApk = path.join(tempDir, 'sample_app.apk');
    fs.writeFileSync(tempApk, 'MOCK_APK_BINARY_CONTENT');

    const apkBuildId = 'build_mock_apk_' + Date.now();
    const mockApkBuild = {
      id: apkBuildId,
      packageName: 'com.test.sampleapp',
      version: '1.0.0',
      fileName: 'sample_app.apk',
      filePath: tempApk,
      fileType: 'apk',
      userId: mockUser.id
    };
    historyService.saveBuild(mockApkBuild);

    let statusSuccess = 200;
    let dataSuccess = null;
    await testController.prepareBrowserArtifact(
      { body: { buildId: apkBuildId }, user: mockUser },
      {
        status(c) { statusSuccess = c; return this; },
        json(d) { dataSuccess = d; return this; }
      },
      () => {}
    );

    assert.strictEqual(statusSuccess, 200);
    assert.strictEqual(dataSuccess.success, true);
    assert.strictEqual(dataSuccess.filename, `${apkBuildId}_universal.apk`);
    assert.strictEqual(dataSuccess.downloadUrl, `/api/test/artifact/${apkBuildId}_universal.apk`);
    assert.strictEqual(typeof dataSuccess.size, 'number');
    assert.strictEqual(dataSuccess.size > 0, true);
    // Crucial: no backend absolute paths leaked in response
    assert.strictEqual(dataSuccess.filePath, undefined);
    assert.strictEqual(dataSuccess.outputPath, undefined);

    // Verify GET /api/test/artifact/:filename
    let fileSent = null;
    let headers = {};
    await testController.downloadArtifact(
      { params: { filename: `${apkBuildId}_universal.apk` } },
      {
        setHeader(k, v) { headers[k] = v; },
        sendFile(p) { fileSent = p; }
      },
      () => {}
    );
    assert.ok(fileSent, 'File should be sent');
    assert.strictEqual(headers['Content-Type'], 'application/vnd.android.package-archive');

    // Verify 404 for missing artifact
    let statusMissingArtifact = 200;
    let dataMissingArtifact = null;
    await testController.downloadArtifact(
      { params: { filename: 'nonexistent_artifact.apk' } },
      {
        status(c) { statusMissingArtifact = c; return this; },
        json(d) { dataMissingArtifact = d; return this; }
      },
      () => {}
    );
    assert.strictEqual(statusMissingArtifact, 404);
    assert.strictEqual(dataMissingArtifact.success, false);

    // Clean up
    historyService.deleteBuild(apkBuildId);
    if (fs.existsSync(tempApk)) fs.unlinkSync(tempApk);
    const generatedApk = path.join(config.OUTPUT_DIR, `${apkBuildId}_universal.apk`);
    if (fs.existsSync(generatedApk)) fs.unlinkSync(generatedApk);
  });

  // Clean up mock build
  historyService.deleteBuild(buildId);
});

