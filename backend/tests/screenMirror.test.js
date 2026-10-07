const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const screenMirrorService = require('../src/services/screenMirrorService');
const deviceLockService = require('../src/services/deviceLockService');

test('ScreenMirrorService initializes screenshot storage correctly', () => {
  assert.ok(fs.existsSync(screenMirrorService.screenshotsDir));
});

test('ScreenMirrorService reports inactive status for unmirrored device', () => {
  const status = screenMirrorService.getMirrorStatus('non_existent_device:5555');
  assert.strictEqual(status.active, false);
});

test('ScreenMirrorService rejects unauthorized user access', async () => {
  const testUserA = { id: 'usr_test_a', name: 'User A', email: 'userA@test.com' };
  const testUserB = { id: 'usr_test_b', name: 'User B', email: 'userB@test.com' };
  const serial = '192.168.1.99:5555';

  // Assign ownership to User A
  deviceLockService.setOwner(serial, testUserA);

  // User B attempts to start mirror -> must reject
  await assert.rejects(
    async () => {
      await screenMirrorService.startMirror(serial, testUserB);
    },
    /not accessible/
  );

  // User B attempts to take screenshot -> must reject
  await assert.rejects(
    async () => {
      await screenMirrorService.captureScreenshot(serial, testUserB);
    },
    /not accessible/
  );

  // Cleanup
  deviceLockService.clearOwner(serial);
});

test('ScreenMirrorService input validation rejects unallowlisted keycodes', async () => {
  const testUser = { id: 'usr_admin_default_01', name: 'Admin', email: 'admin@qatools.internal' };
  const serial = '192.168.1.98:5555';
  deviceLockService.setOwner(serial, testUser);

  // Keycode 999 is not allowed
  await assert.rejects(
    async () => {
      await screenMirrorService.sendInput(serial, testUser, { type: 'keyevent', keycode: 999 });
    },
    /not in the allowlist/
  );

  deviceLockService.clearOwner(serial);
});
