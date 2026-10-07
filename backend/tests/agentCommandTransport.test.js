const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert');
const agentService = require('../src/services/agentService');
const deviceController = require('../src/controllers/deviceController');

describe('QA Device Agent - Phase 3 Command Transport Suite', () => {
  const userAlice = { id: 'usr_alice_cmd', name: 'Alice Tester', email: 'alice@qa.local', role: 'editor' };
  const userBob = { id: 'usr_bob_cmd', name: 'Bob Tester', email: 'bob@qa.local', role: 'editor' };

  const agentIdAlice = 'AGENT-WIN-ALICE-CMD';
  const udidAlice = '00008140-0005596A36E9801C';

  let sentMessages = [];
  const fakeSocket = {
    readyState: 1, // OPEN
    send: (msg) => { sentMessages.push(JSON.parse(msg)); }
  };

  beforeEach(() => {
    sentMessages = [];
    agentService.agentDevices.clear();
    agentService.pendingCommands.clear();
    agentService.activeSockets.clear();
    agentService.agents.clear();

    // Register Alice's Agent
    agentService.agents.set(agentIdAlice, {
      agentId: agentIdAlice,
      userId: userAlice.id,
      userName: userAlice.name,
      userEmail: userAlice.email,
      status: 'ONLINE'
    });
    agentService.activeSockets.set(agentIdAlice, fakeSocket);

    // Register Alice's iPhone
    agentService.handleDeviceConnected(agentIdAlice, {
      udid: udidAlice,
      name: 'iPhone 16e',
      model: 'iPhone 16e',
      productType: 'iPhone17,5',
      platform: 'ios',
      connectionMode: 'agent-usb'
    }, userAlice);
  });

  test('1. sendCommandToAgent dispatches COMMAND_REQUEST and resolves on COMMAND_RESPONSE', async () => {
    const promise = agentService.sendCommandToAgent(agentIdAlice, udidAlice, 'DEVICE_INFO', {});
    assert.strictEqual(sentMessages.length, 1);
    const sent = sentMessages[0];
    assert.strictEqual(sent.type, 'COMMAND_REQUEST');
    assert.strictEqual(sent.command, 'DEVICE_INFO');
    assert.strictEqual(sent.deviceId, udidAlice);
    assert.ok(sent.requestId);

    // Simulate Agent returning successful response
    const resPayload = {
      requestId: sent.requestId,
      success: true,
      command: 'DEVICE_INFO',
      deviceId: udidAlice,
      result: { name: 'iPhone 16e', productVersion: '26.4.2' }
    };
    agentService.handleCommandResponse(agentIdAlice, resPayload);

    const result = await promise;
    assert.deepStrictEqual(result, { name: 'iPhone 16e', productVersion: '26.4.2' });
    assert.strictEqual(agentService.pendingCommands.size, 0);
  });

  test('2. sendCommandToAgent rejects when agent returns error response', async () => {
    const promise = agentService.sendCommandToAgent(agentIdAlice, udidAlice, 'APP_LAUNCH', { bundleId: 'com.fake.app' });
    const sent = sentMessages[0];

    // Simulate Agent error response
    agentService.handleCommandResponse(agentIdAlice, {
      requestId: sent.requestId,
      success: false,
      command: 'APP_LAUNCH',
      error: { code: 'APP_NOT_FOUND', message: 'Application not found on device' }
    });

    await assert.rejects(async () => { await promise; }, { code: 'APP_NOT_FOUND' });
    assert.strictEqual(agentService.pendingCommands.size, 0);
  });

  test('3. sendCommandToAgent handles timeout cleanly', async () => {
    // 50ms timeout for test
    const promise = agentService.sendCommandToAgent(agentIdAlice, udidAlice, 'DEVICE_INFO', {}, 50);
    assert.strictEqual(agentService.pendingCommands.size, 1);

    await assert.rejects(async () => { await promise; }, { code: 'AGENT_COMMAND_TIMEOUT' });
    assert.strictEqual(agentService.pendingCommands.size, 0);
  });

  test('4. sendCommandToAgent throws AGENT_OFFLINE when agent is offline', async () => {
    agentService.activeSockets.delete(agentIdAlice);
    await assert.rejects(
      async () => { await agentService.sendCommandToAgent(agentIdAlice, udidAlice, 'DEVICE_INFO'); },
      { code: 'AGENT_OFFLINE' }
    );
  });

  test('5. handleAgentDisconnect cancels and cleans pending requests', async () => {
    const promise = agentService.sendCommandToAgent(agentIdAlice, udidAlice, 'DEVICE_INFO', {}, 10000);
    assert.strictEqual(agentService.pendingCommands.size, 1);

    agentService.handleAgentDisconnect(agentIdAlice);
    assert.strictEqual(agentService.pendingCommands.size, 0);

    await assert.rejects(async () => { await promise; }, { code: 'AGENT_DISCONNECTED' });
  });

  test('6. handleCommandResponse handles unknown or duplicate requestIds safely', () => {
    const res1 = agentService.handleCommandResponse(agentIdAlice, { requestId: 'unknown_req_123' });
    assert.strictEqual(res1, false);

    const res2 = agentService.handleCommandResponse(agentIdAlice, {});
    assert.strictEqual(res2, false);
  });

  test('7. executeAgentCommand enforces Multi-User Isolation (rejects Bob targeting Alice device)', async () => {
    let responseStatus = 200;
    let responseBody = null;

    const req = {
      params: { id: udidAlice },
      user: userBob, // Bob attempts to control Alice's device
      body: { command: 'DEVICE_INFO' }
    };
    const res = {
      status: (code) => { responseStatus = code; return res; },
      json: (data) => { responseBody = data; return res; }
    };

    await deviceController.executeAgentCommand(req, res, () => {});
    assert.strictEqual(responseStatus, 404);
    assert.strictEqual(responseBody.success, false);
    assert.strictEqual(responseBody.error, 'Device not found or unauthorized.');
  });

  test('8. executeAgentCommand rejects unsupported commands outside allowlist', async () => {
    let responseStatus = 200;
    let responseBody = null;

    const req = {
      params: { id: udidAlice },
      user: userAlice,
      body: { command: 'RUN_UNAPPROVED_SHELL', args: { cmd: 'whoami' } }
    };
    const res = {
      status: (code) => { responseStatus = code; return res; },
      json: (data) => { responseBody = data; return res; }
    };

    await deviceController.executeAgentCommand(req, res, () => {});
    assert.strictEqual(responseStatus, 400);
    assert.strictEqual(responseBody.success, false);
    assert.ok(responseBody.error.includes('not supported'));
  });

  test('9. executeAgentCommand rejects invalid bundleId format', async () => {
    let responseStatus = 200;
    let responseBody = null;

    const req = {
      params: { id: udidAlice },
      user: userAlice,
      body: { command: 'APP_LAUNCH', args: { bundleId: '../../etc/passwd; calc.exe' } }
    };
    const res = {
      status: (code) => { responseStatus = code; return res; },
      json: (data) => { responseBody = data; return res; }
    };

    await deviceController.executeAgentCommand(req, res, () => {});
    assert.strictEqual(responseStatus, 400);
    assert.strictEqual(responseBody.success, false);
    assert.ok(responseBody.error.includes('Invalid bundleId format'));
  });
});
