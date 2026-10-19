const { describe, test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const deviceLockService = require('../src/services/deviceLockService');
const deviceController = require('../src/controllers/deviceController');
const adbService = require('../src/services/adbService');
const agentService = require('../src/services/agentService');
const iosService = require('../src/services/iosService');

describe('Targeted Fix: User Device Visibility & Isolation Suite', () => {
  const userA = { id: 'usr_alice_101', name: 'Alice Tester', email: 'alice.tester@qatools.test', role: 'tester' };
  const userB = { id: 'usr_bob_202', name: 'Bob Tester', email: 'bob.tester@qatools.test', role: 'tester' };
  const userPankaj = { id: 'usr_pankaj_999', name: 'Pankaj Gupta', email: 'pankajgupta.ob@gmail.com', role: 'tester' };

  const devA = 'ALICE_DEVICE_SERIAL_001';
  const devB = 'BOB_DEVICE_SERIAL_002';
  const devProtected = '15909075850008D';

  let origAdbList;
  let origIosList;

  before(() => {
    origAdbList = adbService.listDevices;
    origIosList = iosService.listDevices;
  });

  after(() => {
    adbService.listDevices = origAdbList;
    iosService.listDevices = origIosList;
  });

  beforeEach(() => {
    // Reset ownership state for test devices
    deviceLockService.clearOwner(devA);
    deviceLockService.clearOwner(devB);
    deviceLockService.locks.delete(devA);
    deviceLockService.locks.delete(devB);
  });

  test('1. decorateDevices backwards compatibility: retains all devices with IN_USE / YOUR_DEVICE when ownedOnly is omitted', () => {
    deviceLockService.setOwner(devA, userA);
    deviceLockService.setOwner(devB, userB);

    const rawList = [
      { id: devA, serial: devA, connected: true, state: 'device', isWireless: false },
      { id: devB, serial: devB, connected: true, state: 'device', isWireless: false }
    ];

    // Calling decorateDevices without ownedOnly returns all devices with owner info
    const decoratedForAlice = deviceLockService.decorateDevices(rawList, userA);
    assert.strictEqual(decoratedForAlice.length, 2);
    assert.strictEqual(decoratedForAlice.find(d => d.serial === devA).owner.status, 'YOUR_DEVICE');
    assert.strictEqual(decoratedForAlice.find(d => d.serial === devA).owner.isOwner, true);
    assert.strictEqual(decoratedForAlice.find(d => d.serial === devB).owner.status, 'IN_USE');
    assert.strictEqual(decoratedForAlice.find(d => d.serial === devB).owner.isOwner, false);
  });

  test('2. decorateDevices with { ownedOnly: true }: strictly filters to user-owned devices', () => {
    deviceLockService.setOwner(devA, userA);
    deviceLockService.setOwner(devB, userB);

    const rawList = [
      { id: devA, serial: devA, connected: true, state: 'device', isWireless: false },
      { id: devB, serial: devB, connected: true, state: 'device', isWireless: false }
    ];

    const aliceOnly = deviceLockService.decorateDevices(rawList, userA, { ownedOnly: true });
    assert.strictEqual(aliceOnly.length, 1);
    assert.strictEqual(aliceOnly[0].serial, devA);
    assert.strictEqual(aliceOnly[0].owner.isOwner, true);

    const bobOnly = deviceLockService.decorateDevices(rawList, userB, { ownedOnly: true });
    assert.strictEqual(bobOnly.length, 1);
    assert.strictEqual(bobOnly[0].serial, devB);
    assert.strictEqual(bobOnly[0].owner.isOwner, true);
  });

  test('3. listDevices controller endpoint: Alice sees strictly her devices, Bob sees strictly his devices', async () => {
    deviceLockService.setOwner(devA, userA);
    deviceLockService.setOwner(devB, userB);

    adbService.listDevices = async () => [
      { id: devA, serial: devA, connected: true, state: 'device', isWireless: false, model: 'Pixel 7' },
      { id: devB, serial: devB, connected: true, state: 'device', isWireless: false, model: 'Galaxy S23' }
    ];
    iosService.listDevices = async () => [];

    // Alice calls listDevices
    let aliceResponse = null;
    const resAlice = {
      json: (data) => { aliceResponse = data; }
    };
    await deviceController.listDevices({ user: userA }, resAlice, () => {});

    assert.strictEqual(aliceResponse.success, true);
    assert.strictEqual(aliceResponse.count, 1);
    assert.strictEqual(aliceResponse.devices.length, 1);
    assert.strictEqual(aliceResponse.devices[0].serial, devA);
    assert.strictEqual(aliceResponse.devices[0].owner.isOwner, true);

    // Bob calls listDevices
    let bobResponse = null;
    const resBob = {
      json: (data) => { bobResponse = data; }
    };
    await deviceController.listDevices({ user: userB }, resBob, () => {});

    assert.strictEqual(bobResponse.success, true);
    assert.strictEqual(bobResponse.count, 1);
    assert.strictEqual(bobResponse.devices.length, 1);
    assert.strictEqual(bobResponse.devices[0].serial, devB);
    assert.strictEqual(bobResponse.devices[0].owner.isOwner, true);
  });

  test('4. Ownership transfer visibility: device moves from Alice list to Bob list on takeover', async () => {
    deviceLockService.setOwner(devA, userA);

    adbService.listDevices = async () => [
      { id: devA, serial: devA, connected: true, state: 'device', isWireless: false, model: 'Pixel 7' }
    ];

    // Initial state: Alice sees devA
    let aliceRes = null;
    await deviceController.listDevices({ user: userA }, { json: d => { aliceRes = d; } }, () => {});
    assert.strictEqual(aliceRes.count, 1);
    assert.strictEqual(aliceRes.devices[0].serial, devA);

    // Bob does NOT see devA
    let bobRes = null;
    await deviceController.listDevices({ user: userB }, { json: d => { bobRes = d; } }, () => {});
    assert.strictEqual(bobRes.count, 0);

    // Ownership legitimately transferred to Bob
    await deviceLockService.transferDeviceOwnership(devA, userB);

    // After transfer: devA is gone from Alice list, present in Bob list
    let aliceRes2 = null;
    await deviceController.listDevices({ user: userA }, { json: d => { aliceRes2 = d; } }, () => {});
    assert.strictEqual(aliceRes2.count, 0);

    let bobRes2 = null;
    await deviceController.listDevices({ user: userB }, { json: d => { bobRes2 = d; } }, () => {});
    assert.strictEqual(bobRes2.count, 1);
    assert.strictEqual(bobRes2.devices[0].serial, devA);
    assert.strictEqual(bobRes2.devices[0].owner.isOwner, true);
  });

  test('5. Dedicated device safeguard: 15909075850008D is hidden from unauthorized users and operations return 403', async () => {
    deviceLockService.setOwner(devProtected, userPankaj);

    adbService.listDevices = async () => [
      { id: devProtected, serial: devProtected, connected: true, state: 'device', isWireless: false, model: 'Protected Tablet' }
    ];

    // User A polls device list
    let aliceRes = null;
    await deviceController.listDevices({ user: userA }, { json: d => { aliceRes = d; } }, () => {});
    assert.strictEqual(aliceRes.count, 0, 'Protected device must not appear in User A device list');

    // Pankaj polls device list
    let pankajRes = null;
    await deviceController.listDevices({ user: userPankaj }, { json: d => { pankajRes = d; } }, () => {});
    assert.strictEqual(pankajRes.count, 1, 'Protected device must appear in Pankaj device list');
    assert.strictEqual(pankajRes.devices[0].serial, devProtected);

    // Alice attempts to disconnect protected device -> 403 Forbidden
    let errStatus = null;
    let errJson = null;
    const mockRes = {
      status: (c) => { errStatus = c; return mockRes; },
      json: (d) => { errJson = d; }
    };
    await deviceController.disconnectDevice({ params: { id: devProtected }, user: userA }, mockRes, () => {});
    assert.strictEqual(errStatus, 403);
    assert.strictEqual(errJson.error, 'Device is claimed by another user.');
  });

  test('6. Unauthenticated requests receive empty list', async () => {
    let unauthRes = null;
    await deviceController.listDevices({ user: null }, { json: d => { unauthRes = d; } }, () => {});
    assert.strictEqual(unauthRes.count, 0);
    assert.deepStrictEqual(unauthRes.devices, []);
  });
});
