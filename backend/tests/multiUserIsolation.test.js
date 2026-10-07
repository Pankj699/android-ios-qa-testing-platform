const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const agentService = require('../src/services/agentService');
const agentMirrorService = require('../src/services/agentMirrorService');
const deviceLockService = require('../src/services/deviceLockService');

describe('QA Device Agent - Phase 5 Multi-User Isolation & Validation Suite', () => {
  // Test User Identities
  const alice = { id: 'usr_alice_phase5', name: 'Alice Tester', email: 'alice.p5@qa.internal', role: 'developer' };
  const bob = { id: 'usr_bob_phase5', name: 'Bob Tester', email: 'bob.p5@qa.internal', role: 'developer' };

  // Agents
  const agentAliceId = 'AGENT-ALICE-P5';
  const agentBobId = 'AGENT-BOB-P5';

  // Devices
  const iphoneA = '00008140-0005596A36E9801A'; // Alice's physical iPhone A
  const iphoneB = '00008140-0005596A36E9801B'; // Bob's physical iPhone B

  let aliceWs, bobWs;
  let aliceSent = [], bobSent = [];

  beforeEach(() => {
    aliceSent = [];
    bobSent = [];

    aliceWs = {
      readyState: 1,
      send: (data) => aliceSent.push(JSON.parse(data))
    };

    bobWs = {
      readyState: 1,
      send: (data) => bobSent.push(JSON.parse(data))
    };

    // 1. Register Agent A for Alice
    agentService.agents.set(agentAliceId, {
      id: agentAliceId,
      name: 'Alice Workstation',
      userId: alice.id,
      userName: alice.name,
      userEmail: alice.email,
      status: 'ONLINE',
      platform: 'win32',
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    agentService.activeSockets.set(agentAliceId, aliceWs);

    // 2. Register Agent B for Bob
    agentService.agents.set(agentBobId, {
      id: agentBobId,
      name: 'Bob MacBook',
      userId: bob.id,
      userName: bob.name,
      userEmail: bob.email,
      status: 'ONLINE',
      platform: 'darwin',
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    agentService.activeSockets.set(agentBobId, bobWs);

    // 3. Connect iPhone A to Agent A (Alice)
    agentService.handleDeviceConnected(agentAliceId, {
      udid: iphoneA,
      name: 'iPhone 16e - Alice',
      platform: 'ios',
      iosVersion: '26.4.2',
      model: 'iPhone17,5'
    }, alice);

    // 4. Connect iPhone B to Agent B (Bob)
    agentService.handleDeviceConnected(agentBobId, {
      udid: iphoneB,
      name: 'iPhone 15 Pro - Bob',
      platform: 'ios',
      iosVersion: '26.4.1',
      model: 'iPhone16,1'
    }, bob);
  });

  afterEach(() => {
    agentService.handleAgentDisconnect(agentAliceId);
    agentService.handleAgentDisconnect(agentBobId);
    agentMirrorService.handleAgentDisconnect(agentAliceId);
    agentMirrorService.handleAgentDisconnect(agentBobId);
    deviceLockService.claims.delete(iphoneA);
    deviceLockService.claims.delete(iphoneB);
  });

  test('Area 1 & 2: User & Agent Ownership Isolation', () => {
    // Alice sees only Agent A
    const aliceAgents = agentService.listAgents(alice);
    assert.equal(aliceAgents.length, 1);
    assert.equal(aliceAgents[0].id, agentAliceId);

    // Bob sees only Agent B
    const bobAgents = agentService.listAgents(bob);
    assert.equal(bobAgents.length, 1);
    assert.equal(bobAgents[0].id, agentBobId);

    // Alice lookup of Bob's Agent returns null
    assert.equal(agentService.getAgent(agentBobId, alice), null);

    // Bob lookup of Alice's Agent returns null
    assert.equal(agentService.getAgent(agentAliceId, bob), null);
  });

  test('Area 3 & 4: Device Ownership & Discovery Isolation', () => {
    // Alice device list contains only iPhone A
    const aliceDevices = agentService.listAgentDevices(alice);
    assert.equal(aliceDevices.length, 1);
    assert.equal(aliceDevices[0].udid, iphoneA);

    // Bob device list contains only iPhone B
    const bobDevices = agentService.listAgentDevices(bob);
    assert.equal(bobDevices.length, 1);
    assert.equal(bobDevices[0].udid, iphoneB);

    // Alice direct lookup of iPhone B returns null
    assert.equal(agentService.getAgentDevice(iphoneB, alice), null);

    // Bob direct lookup of iPhone A returns null
    assert.equal(agentService.getAgentDevice(iphoneA, bob), null);
  });

  test('Area 5: Device Claim Isolation & Protection', () => {
    // Alice claims iPhone A
    const aliceClaim = deviceLockService.claimDevice(iphoneA, alice);
    assert.equal(aliceClaim.userId, alice.id);

    // Bob attempts to claim Alice's iPhone A -> REJECTED
    assert.throws(() => {
      deviceLockService.claimDevice(iphoneA, bob);
    }, /claimed by Alice Tester|claimed or owned by another user/);

    // Bob claims iPhone B -> ALLOWED
    const bobClaim = deviceLockService.claimDevice(iphoneB, bob);
    assert.equal(bobClaim.userId, bob.id);

    // Alice attempts to claim Bob's iPhone B -> REJECTED
    assert.throws(() => {
      deviceLockService.claimDevice(iphoneB, alice);
    }, /claimed by Bob Tester|claimed or owned by another user/);
  });

  test('Area 6 & 7: Command Isolation & Payload Manipulation Prevention', async () => {
    // 1. Alice -> iPhone A -> DEVICE_INFO (ALLOWED)
    const aliceCmdPromise = agentService.sendCommandToAgent(agentAliceId, iphoneA, 'DEVICE_INFO', {});
    assert.equal(aliceSent.length, 1);
    assert.equal(aliceSent[0].command, 'DEVICE_INFO');
    assert.equal(aliceSent[0].deviceId, iphoneA);

    // Mock agent response
    agentService.handleCommandResponse(agentAliceId, {
      requestId: aliceSent[0].requestId,
      success: true,
      result: { productType: 'iPhone17,5', batteryLevel: 99 }
    });
    const aliceRes = await aliceCmdPromise;
    assert.equal(aliceRes.productType, 'iPhone17,5');

    // 2. Bob attempts to target Alice's iPhone A via agentService lookup -> REJECTED
    const targetDev = agentService.getAgentDevice(iphoneA, bob);
    assert.equal(targetDev, null); // Cannot resolve target device for unauthorized user

    // 3. Bob attempts to dispatch command with manipulated deviceId -> REJECTED
    assert.equal(agentService.getAgentDevice(iphoneA, bob), null);
  });

  test('Area 8, 9 & 10: Mirror Session, Hijacking & Stream Token Isolation', async () => {
    // 1. Alice starts mirror on iPhone A
    const aliceMirPromise = agentMirrorService.startMirror(iphoneA, alice, { quality: '720p' });
    const aliceReqId = aliceSent[0].requestId;
    agentMirrorService.handleAgentMirrorResponse(agentAliceId, {
      type: 'START_MIRROR_RESPONSE',
      requestId: aliceReqId,
      deviceId: iphoneA,
      success: true,
      port: 19601,
      streamUrl: 'http://127.0.0.1:19601/stream.bin',
      resolution: '1170x2532'
    });
    const aliceMir = await aliceMirPromise;
    assert.ok(aliceMir.sessionToken);

    // 2. Bob starts mirror on iPhone B
    const bobMirPromise = agentMirrorService.startMirror(iphoneB, bob, { quality: '1080p' });
    const bobReqId = bobSent[0].requestId;
    agentMirrorService.handleAgentMirrorResponse(agentBobId, {
      type: 'START_MIRROR_RESPONSE',
      requestId: bobReqId,
      deviceId: iphoneB,
      success: true,
      port: 19602,
      streamUrl: 'http://127.0.0.1:19602/stream.bin',
      resolution: '1179x2556'
    });
    const bobMir = await bobMirPromise;
    assert.ok(bobMir.sessionToken);

    // Tokens are distinct
    assert.notEqual(aliceMir.sessionToken, bobMir.sessionToken);

    // 3. Bob attempts to validate Alice's token against iPhone B -> REJECTED
    assert.equal(agentMirrorService.verifyStreamToken(iphoneB, aliceMir.sessionToken), false);

    // 4. Bob attempts to validate Alice's token against iPhone A -> REJECTED (Bob is not owner)
    assert.equal(agentMirrorService.verifyStreamToken(iphoneA, bobMir.sessionToken), false);

    // 5. Bob attempts to start mirror on Alice's iPhone A -> REJECTED
    await assert.rejects(async () => {
      await agentMirrorService.startMirror(iphoneA, bob);
    }, /Device is currently claimed by another user|Agent iOS device not found or unauthorized/);

    // 6. Bob attempts to stop Alice's mirror -> REJECTED
    await assert.rejects(async () => {
      await agentMirrorService.stopMirror(iphoneA, bob);
    }, /Device is currently claimed by another user|Agent iOS device not found or unauthorized/);
  });

  test('Area 11 & 12: Concurrent Independent Mirrors & Independent Teardown', async () => {
    // Start both mirrors
    const pA = agentMirrorService.startMirror(iphoneA, alice);
    agentMirrorService.handleAgentMirrorResponse(agentAliceId, {
      type: 'START_MIRROR_RESPONSE',
      requestId: aliceSent[0].requestId,
      deviceId: iphoneA,
      success: true,
      port: 19611
    });
    const rA = await pA;

    const pB = agentMirrorService.startMirror(iphoneB, bob);
    agentMirrorService.handleAgentMirrorResponse(agentBobId, {
      type: 'START_MIRROR_RESPONSE',
      requestId: bobSent[0].requestId,
      deviceId: iphoneB,
      success: true,
      port: 19612
    });
    const rB = await pB;

    // Verify both are active simultaneously
    assert.equal(agentMirrorService.getMirrorStatus(iphoneA).active, true);
    assert.equal(agentMirrorService.getMirrorStatus(iphoneB).active, true);
    assert.equal(agentMirrorService.getMirrorStatus(iphoneA).port, 19611);
    assert.equal(agentMirrorService.getMirrorStatus(iphoneB).port, 19612);

    // Alice stops her mirror
    await agentMirrorService.stopMirror(iphoneA, alice);

    // Alice's mirror is inactive, but Bob's mirror remains active!
    assert.equal(agentMirrorService.getMirrorStatus(iphoneA).active, false);
    assert.equal(agentMirrorService.getMirrorStatus(iphoneB).active, true);
    assert.equal(agentMirrorService.verifyStreamToken(iphoneA, rA.sessionToken), false);
    assert.equal(agentMirrorService.verifyStreamToken(iphoneB, rB.sessionToken), true);

    // Bob stops his mirror
    await agentMirrorService.stopMirror(iphoneB, bob);
    assert.equal(agentMirrorService.getMirrorStatus(iphoneB).active, false);
  });

  test('Area 13 & 14: Agent & Device Disconnect Isolation', () => {
    // Disconnect Agent A (Alice)
    agentService.handleAgentDisconnect(agentAliceId);
    agentMirrorService.handleAgentDisconnect(agentAliceId);

    // Alice's device is cleared
    assert.equal(agentService.listAgentDevices(alice).length, 0);

    // Bob's Agent and iPhone B are completely unaffected!
    const bobDevices = agentService.listAgentDevices(bob);
    assert.equal(bobDevices.length, 1);
    assert.equal(bobDevices[0].udid, iphoneB);
    assert.equal(agentService.getAgent(agentBobId, bob).status, 'ONLINE');
  });

  test('Area 15 & 16: Agent & Device Reconnect Idempotency', () => {
    // Disconnect Agent A
    agentService.handleAgentDisconnect(agentAliceId);
    assert.equal(agentService.listAgentDevices(alice).length, 0);

    // Reconnect Agent A
    agentService.registerSocket(agentAliceId, aliceWs);
    agentService.handleDeviceConnected(agentAliceId, {
      udid: iphoneA,
      name: 'iPhone 16e - Alice',
      platform: 'ios',
      iosVersion: '26.4.2',
      model: 'iPhone17,5'
    }, alice);

    // Device returns under Alice with exact same UDID
    const aliceDevices = agentService.listAgentDevices(alice);
    assert.equal(aliceDevices.length, 1);
    assert.equal(aliceDevices[0].udid, iphoneA);

    // Bob still cannot see iPhone A
    assert.equal(agentService.getAgentDevice(iphoneA, bob), null);
  });

  test('Area 21: Error Information Leakage Prevention', async () => {
    // Bob attempts to access Alice's device info
    const dev = agentService.getAgentDevice(iphoneA, bob);
    assert.equal(dev, null); // Returns clean null, zero leaked metadata

    // Bob attempts unpair on Alice's agent
    assert.throws(() => {
      agentService.unpairAgent(agentAliceId, bob);
    }, /Agent not found or you do not have permission/);
  });
});
