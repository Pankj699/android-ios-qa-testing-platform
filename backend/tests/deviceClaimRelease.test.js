const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const deviceLockService = require('../src/services/deviceLockService');
const deviceController = require('../src/controllers/deviceController');

describe('Device Claim/Release Deprecation & Connection Ownership Suite', () => {
  const userA = { id: 'usr_user_a', name: 'User A', email: 'usera@example.com', role: 'tester' };
  const userB = { id: 'usr_user_b', name: 'User B', email: 'userb@example.com', role: 'tester' };
  const userC = { id: 'usr_user_c', name: 'User C', email: 'userc@example.com', role: 'tester' };

  const serial1 = '192.168.1.150:5555';
  const serial2 = '192.168.1.151:44321';
  const hwSerial1 = 'R52X808W8QK';

  beforeEach(() => {
    deviceLockService.clearOwner(serial1);
    deviceLockService.clearOwner(serial2);
    deviceLockService.clearOwner(hwSerial1);
  });

  test('TEST 1 — Claim and Release endpoints return HTTP 410 Gone', async () => {
    let claimStatus = 0;
    let claimBody = null;
    await deviceController.claimDevice(
      { params: { id: serial1 }, user: userA },
      {
        status(code) { claimStatus = code; return this; },
        json(data) { claimBody = data; return this; }
      },
      () => {}
    );

    assert.strictEqual(claimStatus, 410);
    assert.strictEqual(claimBody.success, false);
    assert.strictEqual(claimBody.code, 'CLAIM_RELEASE_DEPRECATED');
    assert.ok(claimBody.error.includes('removed'));

    let releaseStatus = 0;
    let releaseBody = null;
    await deviceController.releaseDevice(
      { params: { id: serial1 }, user: userA },
      {
        status(code) { releaseStatus = code; return this; },
        json(data) { releaseBody = data; return this; }
      },
      () => {}
    );

    assert.strictEqual(releaseStatus, 410);
    assert.strictEqual(releaseBody.success, false);
    assert.strictEqual(releaseBody.code, 'CLAIM_RELEASE_DEPRECATED');
    assert.ok(releaseBody.error.includes('removed'));
  });

  test('TEST 2 — getClaim strictly returns null and claims are deactivated', () => {
    // Calling legacy claim stub
    const res = deviceLockService.claimDevice(serial1, userA);
    assert.strictEqual(res.deprecated, true);

    // getClaim strictly returns null
    const claim = deviceLockService.getClaim(serial1);
    assert.strictEqual(claim, null);
  });

  test('TEST 3 — Device decoration provides neutral compatibility fields', () => {
    const rawDevice = { serial: serial1, state: 'device', connected: true };
    const decorated = deviceLockService.decorateDevice(rawDevice, userA);

    assert.strictEqual(decorated.isClaimed, false);
    assert.strictEqual(decorated.isClaimedByMe, false);
    assert.strictEqual(decorated.claimedBy, null);
    assert.strictEqual(decorated.lock.isLocked, false);
    assert.strictEqual(decorated.lock.isLockedByMe, false);
    assert.strictEqual(decorated.lock.lockedBy, null);
  });

  test('TEST 4 — Connection Ownership: setOwner, getOwner, and isUserDevice', () => {
    deviceLockService.setOwner(serial1, userA);

    const owner = deviceLockService.getOwner(serial1);
    assert.ok(owner);
    assert.strictEqual(owner.userId, userA.id);
    assert.strictEqual(owner.userName, userA.name);

    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), false);
  });

  test('TEST 5 — Connection Ownership governs isDeviceAccessible', () => {
    deviceLockService.setOwner(serial1, userA);

    // User A has access
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userA), true);
    // User B is isolated and denied
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), false);
  });

  test('TEST 6 — clearOwner releases connection ownership and frees device', () => {
    deviceLockService.setOwner(serial1, userA);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), false);

    deviceLockService.clearOwner(serial1);
    assert.strictEqual(deviceLockService.getOwner(serial1), null);

    // Unowned device is accessible to authenticated users
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), true);
  });

  test('TEST 7 — Hardware serial registration preserves identity across ports', () => {
    const port1 = '192.168.0.22:43827';
    const port2 = '192.168.0.22:38911';

    deviceLockService.registerHardwareSerial(port1, hwSerial1);
    deviceLockService.registerHardwareSerial(port2, hwSerial1);

    deviceLockService.setOwner(port1, userA);

    // Owner resolves on hardware serial and correlated port
    const ownerOnPort2 = deviceLockService.getOwner(port2);
    assert.ok(ownerOnPort2);
    assert.strictEqual(ownerOnPort2.userId, userA.id);

    // Clean up
    deviceLockService.clearOwner(port1);
    deviceLockService.clearOwner(port2);
  });

  test('TEST 8 — Multi-Device Connection Isolation', () => {
    deviceLockService.setOwner(serial1, userA);
    deviceLockService.setOwner(serial2, userB);

    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userA), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial1, userB), false);

    assert.strictEqual(deviceLockService.isDeviceAccessible(serial2, userB), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial2, userA), false);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serial2, userC), false);
  });
});
