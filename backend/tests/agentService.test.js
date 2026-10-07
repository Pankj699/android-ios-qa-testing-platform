const test = require('node:test');
const assert = require('node:assert');
const agentService = require('../src/services/agentService');

test('QA Device Agent Service Suite', async (t) => {
  const userAlice = { id: 'usr_alice_01', name: 'Alice', email: 'alice@qa.internal', role: 'tester' };
  const userBob = { id: 'usr_bob_02', name: 'Bob', email: 'bob@qa.internal', role: 'tester' };
  const admin = { id: 'usr_admin_01', name: 'Admin', email: 'admin@qa.internal', role: 'admin' };

  await t.test('1. generatePairingCode creates valid 6-digit code with TTL', () => {
    const res = agentService.generatePairingCode(userAlice);
    assert.strictEqual(res.success, true);
    assert.strictEqual(typeof res.pairingCode, 'string');
    assert.strictEqual(res.pairingCode.length, 6);
    assert.ok(res.expiresInSeconds > 0);
  });

  await t.test('2. pairAgent rejects invalid or empty pairing code', () => {
    assert.throws(() => {
      agentService.pairAgent('AGENT-TEST-001', '000000');
    }, /Invalid or expired pairing code/);
  });

  await t.test('3. pairAgent successfully pairs agent with valid code and returns JWT token', () => {
    const pairCodeRes = agentService.generatePairingCode(userAlice);
    const code = pairCodeRes.pairingCode;

    const agentId = 'AGENT-ALICE-WIN11-01';
    const systemInfo = {
      os: 'Windows',
      osVersion: '10.0.22631',
      hostname: 'Alice-Workstation',
      agentVersion: '1.0.0'
    };

    const pairResult = agentService.pairAgent(agentId, code, systemInfo, '192.168.1.50');
    assert.strictEqual(pairResult.success, true);
    assert.strictEqual(pairResult.agentId, agentId);
    assert.ok(pairResult.agentToken);
    assert.strictEqual(pairResult.user.id, userAlice.id);

    // Verify token
    const decoded = agentService.verifyAgentToken(pairResult.agentToken);
    assert.ok(decoded);
    assert.strictEqual(decoded.agentId, agentId);
    assert.strictEqual(decoded.userId, userAlice.id);
  });

  await t.test('4. listAgents enforces strict multi-user ownership isolation', () => {
    // User Alice lists agents -> sees her agent
    const aliceAgents = agentService.listAgents(userAlice);
    const aliceAgent = aliceAgents.find(a => a.agentId === 'AGENT-ALICE-WIN11-01');
    assert.ok(aliceAgent);
    assert.strictEqual(aliceAgent.isOwner, true);

    // User Bob lists agents -> does NOT see Alice's agent
    const bobAgents = agentService.listAgents(userBob);
    const bobSeesAliceAgent = bobAgents.find(a => a.agentId === 'AGENT-ALICE-WIN11-01');
    assert.strictEqual(bobSeesAliceAgent, undefined);

    // Admin lists agents -> sees Alice's agent
    const adminAgents = agentService.listAgents(admin);
    const adminSeesAliceAgent = adminAgents.find(a => a.agentId === 'AGENT-ALICE-WIN11-01');
    assert.ok(adminSeesAliceAgent);
  });

  await t.test('5. getAgent and unpairAgent reject cross-user access', () => {
    // Bob attempts to get Alice's agent -> null
    const bobGet = agentService.getAgent('AGENT-ALICE-WIN11-01', userBob);
    assert.strictEqual(bobGet, null);

    // Bob attempts to unpair Alice's agent -> throws error
    assert.throws(() => {
      agentService.unpairAgent('AGENT-ALICE-WIN11-01', userBob);
    }, /Agent not found or you do not have permission/);
  });

  await t.test('6. recordHeartbeat updates lastSeenAt and online status', () => {
    const success = agentService.recordHeartbeat('AGENT-ALICE-WIN11-01', {
      timestamp: Date.now(),
      metrics: { cpuUsagePercent: 12, ramUsagePercent: 45 }
    });
    assert.strictEqual(success, true);
    const agent = agentService.getAgent('AGENT-ALICE-WIN11-01', userAlice);
    assert.strictEqual(agent.status, 'ONLINE');
    assert.ok(agent.lastMetrics);
  });

  await t.test('7. unpairAgent by owner successfully removes agent', () => {
    const unpairRes = agentService.unpairAgent('AGENT-ALICE-WIN11-01', userAlice);
    assert.strictEqual(unpairRes.success, true);

    const check = agentService.getAgent('AGENT-ALICE-WIN11-01', userAlice);
    assert.strictEqual(check, null);
  });
});
