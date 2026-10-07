const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const agentService = require('../src/services/agentService');
const iosService = require('../src/services/iosService');

describe('QA Device Agent - Phase 2 iOS Device Discovery Suite', () => {
  const userAlice = { id: 'usr_alice_discovery', name: 'Alice Tester', email: 'alice@qa.local', role: 'editor' };
  const userBob = { id: 'usr_bob_discovery', name: 'Bob Tester', email: 'bob@qa.local', role: 'editor' };
  const userAdmin = { id: 'usr_admin', name: 'Admin', email: 'admin@qa.local', role: 'admin' };

  const agentIdAlice = 'AGENT-WIN-ALICE-01';
  const agentIdBob = 'AGENT-MAC-BOB-01';

  const sampleIPhoneAlice = {
    udid: '00008140-0005596A36E9801C',
    serial: '00008140-0005596A36E9801C',
    name: 'iPhone 16e - 3',
    model: 'iPhone 16e',
    productType: 'iPhone17,5',
    platform: 'ios',
    osVersion: 'iOS 26.4.2',
    iosVersion: '26.4.2',
    connectionType: 'usb',
    connectionMode: 'agent-usb',
    trustStatus: 'trusted'
  };

  const sampleIPhoneBob = {
    udid: '00008110-001A29040182801E',
    serial: '00008110-001A29040182801E',
    name: 'Bob iPhone 15 Pro',
    model: 'iPhone 15 Pro',
    productType: 'iPhone16,1',
    platform: 'ios',
    osVersion: 'iOS 17.5.1',
    iosVersion: '17.5.1',
    connectionType: 'usb',
    connectionMode: 'agent-usb',
    trustStatus: 'trusted'
  };

  beforeEach(() => {
    // Clean agentDevices
    agentService.agentDevices.clear();
  });

  test('1. handleDeviceConnected registers iOS device with proper owner context', () => {
    const registered = agentService.handleDeviceConnected(agentIdAlice, sampleIPhoneAlice, userAlice);
    assert.ok(registered);
    assert.strictEqual(registered.udid, sampleIPhoneAlice.udid);
    assert.strictEqual(registered.platform, 'ios');
    assert.strictEqual(registered.connectionMode, 'agent-usb');
    assert.strictEqual(registered.userId, userAlice.id);
    assert.strictEqual(registered.userName, userAlice.name);
    assert.strictEqual(registered.connected, true);
  });

  test('2. isAgentIosDevice correctly identifies agent-connected iOS devices', () => {
    agentService.handleDeviceConnected(agentIdAlice, sampleIPhoneAlice, userAlice);
    assert.strictEqual(agentService.isAgentIosDevice(sampleIPhoneAlice.udid), true);
    assert.strictEqual(iosService.isIosDevice(sampleIPhoneAlice.udid), true);
    assert.strictEqual(agentService.isAgentIosDevice('random-android-serial'), false);
  });

  test('3. listAgentDevices strictly enforces Multi-User Isolation', () => {
    // Alice connects iPhone Alice
    agentService.handleDeviceConnected(agentIdAlice, sampleIPhoneAlice, userAlice);
    // Bob connects iPhone Bob
    agentService.handleDeviceConnected(agentIdBob, sampleIPhoneBob, userBob);

    // Alice query -> only sees Alice's iPhone
    const aliceDevices = agentService.listAgentDevices(userAlice);
    assert.strictEqual(aliceDevices.length, 1);
    assert.strictEqual(aliceDevices[0].udid, sampleIPhoneAlice.udid);

    // Bob query -> only sees Bob's iPhone
    const bobDevices = agentService.listAgentDevices(userBob);
    assert.strictEqual(bobDevices.length, 1);
    assert.strictEqual(bobDevices[0].udid, sampleIPhoneBob.udid);

    // Admin query -> sees both
    const adminDevices = agentService.listAgentDevices(userAdmin);
    assert.strictEqual(adminDevices.length, 2);
  });

  test('4. Duplicate prevention across disconnect and reconnect', () => {
    // Connect device
    agentService.handleDeviceConnected(agentIdAlice, sampleIPhoneAlice, userAlice);
    assert.strictEqual(agentService.agentDevices.size, 1);

    // Disconnect device
    const disResult = agentService.handleDeviceDisconnected(agentIdAlice, sampleIPhoneAlice.udid);
    assert.strictEqual(disResult, true);
    assert.strictEqual(agentService.agentDevices.size, 0);

    // Reconnect same device
    agentService.handleDeviceConnected(agentIdAlice, sampleIPhoneAlice, userAlice);
    assert.strictEqual(agentService.agentDevices.size, 1);
    assert.strictEqual(agentService.agentDevices.get(sampleIPhoneAlice.udid).connected, true);
  });

  test('5. handleDeviceList synchronizes batch snapshot cleanly', () => {
    agentService.handleDeviceList(agentIdAlice, [sampleIPhoneAlice], userAlice);
    assert.strictEqual(agentService.agentDevices.size, 1);

    // Send empty device list
    agentService.handleDeviceList(agentIdAlice, [], userAlice);
    assert.strictEqual(agentService.agentDevices.size, 0);
  });

  test('6. handleAgentDisconnect cleans up devices registered by that agent', () => {
    agentService.handleDeviceConnected(agentIdAlice, sampleIPhoneAlice, userAlice);
    agentService.handleDeviceConnected(agentIdBob, sampleIPhoneBob, userBob);
    assert.strictEqual(agentService.agentDevices.size, 2);

    // Alice's agent disconnects
    agentService.handleAgentDisconnect(agentIdAlice);
    assert.strictEqual(agentService.agentDevices.size, 1);
    assert.ok(agentService.agentDevices.has(sampleIPhoneBob.udid));
    assert.strictEqual(agentService.agentDevices.has(sampleIPhoneAlice.udid), false);
  });

  test('7. getAgentDevice denies cross-user access', () => {
    agentService.handleDeviceConnected(agentIdAlice, sampleIPhoneAlice, userAlice);

    // Alice access -> success
    const aliceDev = agentService.getAgentDevice(sampleIPhoneAlice.udid, userAlice);
    assert.ok(aliceDev);

    // Bob access -> null / denied
    const bobDev = agentService.getAgentDevice(sampleIPhoneAlice.udid, userBob);
    assert.strictEqual(bobDev, null);
  });
});
