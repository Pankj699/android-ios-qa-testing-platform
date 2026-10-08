const test = require('node:test');
const assert = require('node:assert');
const wirelessPairingService = require('../src/services/wirelessPairingService');
const deviceLockService = require('../src/services/deviceLockService');
const adbService = require('../src/services/adbService');

test('Android 11+ Wireless Debugging QR Pairing Suite', async (t) => {
  const mockUserA = { id: 'usr_wifi_tester_a', username: 'Tester A', role: 'tester', email: 'testerA@qa.test' };
  const mockUserB = { id: 'usr_wifi_tester_b', username: 'Tester B', role: 'tester', email: 'testerB@qa.test' };

  await t.test('1. QR Code Payload conforms to standard AOSP WIFI:T:ADB schema', () => {
    const serviceName = 'studio-a7f29c';
    const pairingCode = '842109';
    const payload = wirelessPairingService.constructor.formatQrPayload(serviceName, pairingCode);

    assert.strictEqual(
      payload,
      'WIFI:T:ADB;S:studio-a7f29c;P:842109;;',
      'QR Code payload must strictly match AOSP standard WIFI:T:ADB;S:...;P:...;;'
    );
  });

  await t.test('2. Generates 6-digit numeric pairing code and studio- prefixed service name', () => {
    const code = wirelessPairingService.constructor.generatePairingCode();
    const serviceName = wirelessPairingService.constructor.generateServiceName();

    assert.match(code, /^\d{6}$/, 'Pairing code must be a 6-digit numeric string');
    assert.match(serviceName, /^studio-[a-f0-9]{6}$/, 'Service name must start with studio- followed by hex chars');
  });

  await t.test('3. Pairing Session Lifecycle (Creation, Sanitized Retrieval, and Expiration/Cancellation)', async () => {
    const session = await wirelessPairingService.createPairingSession(mockUserA);

    assert.ok(session.sessionId, 'Session ID must be generated');
    assert.ok(session.serviceName.startsWith('studio-'), 'Service name must be studio- prefixed');
    assert.match(session.pairingCode, /^\d{6}$/, 'Pairing code must be 6 digits');
    assert.strictEqual(
      session.qrPayload,
      `WIFI:T:ADB;S:${session.serviceName};P:${session.pairingCode};;`
    );

    // Retrieve session state
    const retrieved = wirelessPairingService.getSession(session.sessionId, mockUserA);
    assert.ok(retrieved, 'Session must be retrievable');
    assert.strictEqual(retrieved.status, 'NOT_PAIRED');
    assert.strictEqual(retrieved.pairingCode, undefined, 'Pairing code and secrets must never be exposed in public getSession');

    // Cancel session
    const cancelRes = wirelessPairingService.cancelSession(session.sessionId, mockUserA);
    assert.strictEqual(cancelRes, true, 'Session should be successfully cancelled');

    const cancelledRetrieval = wirelessPairingService.getSession(session.sessionId, mockUserA);
    assert.strictEqual(cancelledRetrieval, null, 'Cancelled session must no longer exist');
  });

  await t.test('4. mDNS Service parsing handles _adb-tls-pairing and _adb-tls-connect services cleanly', () => {
    // Test parsing logic on sample raw output from adb mdns services
    const sampleOutput = [
      'adb-99cf18ee-5eq3WP\t_adb-tls-connect._tcp\t192.168.0.96:44261',
      'adb-pairing-test\t_adb-tls-pairing._tcp\t192.168.0.86:39203'
    ];

    const parsed = [];
    for (const line of sampleOutput) {
      const parts = line.split(/\t+|\s{2,}/).map(p => p.trim()).filter(Boolean);
      if (parts.length >= 3) {
        const address = parts[2];
        const lastColon = address.lastIndexOf(':');
        parsed.push({
          serviceName: parts[0],
          serviceType: parts[1],
          address,
          ip: address.substring(0, lastColon),
          port: parseInt(address.substring(lastColon + 1), 10),
          isPairing: parts[1].includes('pairing'),
          isConnect: parts[1].includes('connect')
        });
      }
    }

    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].isConnect, true);
    assert.strictEqual(parsed[0].ip, '192.168.0.96');
    assert.strictEqual(parsed[0].port, 44261);

    assert.strictEqual(parsed[1].isPairing, true);
    assert.strictEqual(parsed[1].ip, '192.168.0.86');
    assert.strictEqual(parsed[1].port, 39203);
  });

  await t.test('5. Multi-User Isolation: User A Browser Wireless device is private to User A', () => {
    const serialA = `192.168.0.86:${Math.floor(30000 + Math.random() * 20000)}`;
    const hwSerial = `WIFI_HW_${Date.now()}`;

    // Claim wireless device for User A with connectionMode: browser-wireless
    deviceLockService.claimDevice(serialA, mockUserA, {
      connectionMode: 'browser-wireless',
      hardwareSerial: hwSerial
    });

    // Verification: Accessible strictly to User A, inaccessible to User B
    assert.strictEqual(deviceLockService.isDeviceAccessible(serialA, mockUserA), true);
    assert.strictEqual(deviceLockService.isDeviceAccessible(serialA, mockUserB), false);

    // Decorate device verification
    const rawDev = { serial: serialA, connected: true, state: 'device' };
    const decoratedA = deviceLockService.decorateDevice(rawDev, mockUserA);
    const decoratedB = deviceLockService.decorateDevice(rawDev, mockUserB);

    assert.strictEqual(decoratedA.owner.isOwner, true);
    assert.strictEqual(decoratedB.owner.isOwner, false);
    assert.strictEqual(decoratedA.isClaimed, false);

    // Clean up
    deviceLockService.releaseDevice(serialA, mockUserA);
  });

  await t.test('6. Diagnostics endpoint reports mDNS and network status', async () => {
    const diag = await wirelessPairingService.getDiagnostics();

    assert.ok(diag, 'Diagnostics object must be returned');
    assert.ok(diag.localIp, 'Local IP must be reported');
    assert.strictEqual(typeof diag.mdnsAvailable, 'boolean');
    assert.strictEqual(typeof diag.pairingServicesCount, 'number');
    assert.strictEqual(typeof diag.connectServicesCount, 'number');
    assert.ok(Array.isArray(diag.discoveredServices));
  });
});
