const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const deviceLockService = require('../src/services/deviceLockService');

describe('Device Claim and Release Robustness Suite', () => {
  const userA = { id: 'usr_user_a', name: 'User A', email: 'usera@example.com', role: 'tester' };
  const userB = { id: 'usr_user_b', name: 'User B', email: 'userb@example.com', role: 'tester' };
  const userC = { id: 'usr_user_c', name: 'User C', email: 'userc@example.com', role: 'tester' };
  const admin = { id: 'usr_admin', name: 'Admin', email: 'admin@qatools.internal', role: 'admin' };

  const serial1 = '192.168.1.150:5555';
  const serial2 = '192.168.1.151:44321';
  const hwSerial1 = 'R52X808W8QK';

  beforeEach(() => {
    deviceLockService.releaseDevice(serial1, admin, true);
    deviceLockService.releaseDevice(serial2, admin, true);
    deviceLockService.releaseDevice(hwSerial1, admin, true);
  });

  test('TEST 1 — Automatic Claim on Connection for Unclaimed Device', () => {
    // User A connects unclaimed device
    const claim = deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });
    assert.strictEqual(claim.userId, userA.id);
    assert.strictEqual(claim.userName, userA.name);

    const decorated = deviceLockService.decorateDevice({ serial: serial1, state: 'device', connected: true }, userA);
    assert.strictEqual(decorated.isClaimed, true);
    assert.strictEqual(decorated.isClaimedByMe, true);
    assert.strictEqual(decorated.claimedBy, 'User A');
    assert.strictEqual(decorated.lock.isLocked, true);
  });

  test('TEST 2 — Claim Persists Without Timer Expiration', () => {
    deviceLockService.claimDevice(serial1, userA);

    // Verify lock has no automatic expiration (expiresAt is null)
    const lock = deviceLockService.getLock(serial1);
    assert.strictEqual(lock.expiresAt, null, 'Claim/Lock must never have automatic timer expiration');

    const claim = deviceLockService.getClaim(serial1);
    assert.strictEqual(claim.userId, userA.id);
    assert.strictEqual(claim.userName, userA.name);
  });

  test('TEST 3 — Device Refresh preserves ownership', () => {
    deviceLockService.claimDevice(serial1, userA);

    // Simulate multiple device refresh / list decorations
    for (let i = 0; i < 5; i++) {
      const decorated = deviceLockService.decorateDevice({ serial: serial1, state: 'device', connected: true }, userA);
      assert.strictEqual(decorated.isClaimed, true);
      assert.strictEqual(decorated.isClaimedByMe, true);
      assert.strictEqual(decorated.claimedBy, 'User A');
    }
  });

  test('TEST 4 — Temporary ADB Disconnect preserves claim', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Simulate ADB disconnect (clears transport connection only)
    deviceLockService.clearOwner(serial1);

    // Claim MUST remain User A even while disconnected
    const claim = deviceLockService.getClaim(serial1);
    assert.ok(claim !== null, 'Claim must not be cleared on disconnect');
    assert.strictEqual(claim.userName, 'User A');

    // Simulate reconnect
    const reconnected = deviceLockService.decorateDevice({ serial: serial1, state: 'device', connected: true }, userA);
    assert.strictEqual(reconnected.isClaimed, true);
    assert.strictEqual(reconnected.isClaimedByMe, true);
    assert.strictEqual(reconnected.claimedBy, 'User A');
  });

  test('TEST 5 — Second User Connection Attempt Cannot Overwrite Claim', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // User B attempts to set owner / connect to same device
    deviceLockService.setOwner(serial1, userB);

    // Claim must STILL be User A
    const claim = deviceLockService.getClaim(serial1);
    assert.strictEqual(claim.userId, userA.id);
    assert.strictEqual(claim.userName, 'User A');

    // User B cannot claim
    assert.throws(() => {
      deviceLockService.claimDevice(serial1, userB);
    }, { message: /currently claimed by User A/ });
  });

  test('TEST 6 — Second User Disconnect Does Not Affect User A Claim', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // User B disconnects
    deviceLockService.clearOwner(serial1);

    // User A claim remains 100% intact
    const claim = deviceLockService.getClaim(serial1);
    assert.strictEqual(claim.userId, userA.id);
    assert.strictEqual(claim.userName, 'User A');
  });

  test('TEST 7 — Explicit Release Clears Claim and Makes Device Available', () => {
    deviceLockService.claimDevice(serial1, userA);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), false);

    // User A explicitly releases
    deviceLockService.releaseDevice(serial1, userA);

    assert.strictEqual(deviceLockService.getClaim(serial1), null);
    // After release, both User A and User B can see the unclaimed connected device
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), true);

    const decorated = deviceLockService.decorateDevice({ serial: serial1 }, userB);
    assert.strictEqual(decorated.isClaimed, false);
    assert.strictEqual(decorated.claimedBy, null);
  });

  test('TEST 8 — Second User Can Claim After Explicit Release', () => {
    deviceLockService.claimDevice(serial1, userA);
    deviceLockService.releaseDevice(serial1, userA);

    // User B claims
    const claimB = deviceLockService.claimDevice(serial1, userB);
    assert.strictEqual(claimB.userId, userB.id);
    assert.strictEqual(claimB.userName, 'User B');

    // Now strictly visible to User B, hidden from User A and User C
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), false);
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userC), false);
  });

  test('TEST 9 — Claim Cannot Be Stolen By Unauthorized Users', () => {
    deviceLockService.claimDevice(serial1, userA);

    assert.throws(() => {
      deviceLockService.releaseDevice(serial1, userB);
    }, { message: /Cannot release device/ });

    assert.strictEqual(deviceLockService.getClaim(serial1).userId, userA.id);
  });

  test('TEST 10 — Login / Logout Persistence (Claims File Reload)', () => {
    deviceLockService.claimDevice(serial1, userA, { hardwareSerial: hwSerial1 });

    // Re-initialize service instance from persistent files on disk
    deviceLockService.init();

    const claim = deviceLockService.getClaim(serial1);
    assert.ok(claim !== null, 'Claim must survive reload from disk');
    assert.strictEqual(claim.userId, userA.id);
    assert.strictEqual(claim.userName, 'User A');
  });

  test('TEST 11 — Stable Hardware Serial Reconnect Across Dynamic Port Changes', () => {
    const port1 = '192.168.0.22:43827';
    const port2 = '192.168.0.22:38911';

    // User A connects on port1 with hardware serial
    deviceLockService.claimDevice(port1, userA, { hardwareSerial: hwSerial1 });

    // Port changes on reconnect to port2
    deviceLockService.registerHardwareSerial(port2, hwSerial1);

    // Querying port2 should resolve User A's claim via stable hardware serial & IP
    const claimOnNewPort = deviceLockService.getClaim(port2);
    assert.ok(claimOnNewPort !== null, 'Claim must resolve on new dynamic Wi-Fi port');
    assert.strictEqual(claimOnNewPort.userName, 'User A');

    const decorated = deviceLockService.decorateDevice({ serial: port2, state: 'device', connected: true }, userA);
    assert.strictEqual(decorated.isClaimed, true);
    assert.strictEqual(decorated.isClaimedByMe, true);
    assert.strictEqual(decorated.claimedBy, 'User A');
  });

  test('TEST 12 — Multiple Devices Isolation', () => {
    deviceLockService.claimDevice(serial1, userA);
    deviceLockService.claimDevice(serial2, userB);

    assert.strictEqual(deviceLockService.getClaim(serial1).userId, userA.id);
    assert.strictEqual(deviceLockService.getClaim(serial2).userId, userB.id);

    // User A only sees Device 1
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userA), true);
    assert.strictEqual(deviceLockService.isUserDevice(serial2, userA), false);

    // User B only sees Device 2
    assert.strictEqual(deviceLockService.isUserDevice(serial1, userB), false);
    assert.strictEqual(deviceLockService.isUserDevice(serial2, userB), true);
  });
});
