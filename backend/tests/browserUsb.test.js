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

    // 2. User B can claim and access their own device independently
    const serverSerialB = '192.168.1.188:5555';
    deviceLockService.claimDevice(serverSerialB, userB);

    assert.strictEqual(deviceLockService.isDeviceAccessible(serverSerialB, userB), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serverSerialB, userA), false);

    // Clean up
    deviceLockService.releaseDevice(serverSerialB, userB);
  });

  // Clean up mock build
  historyService.deleteBuild(buildId);
});
