const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const agentService = require('../src/services/agentService');
const agentMirrorService = require('../src/services/agentMirrorService');
const deviceLockService = require('../src/services/deviceLockService');

describe('QA Device Agent - Phase 4 Agent Mirror Suite', () => {
  const alice = { id: 'user-alice-mir', name: 'Alice Tester', email: 'alice@qa.test', role: 'developer' };
  const bob = { id: 'user-bob-mir', name: 'Bob Tester', email: 'bob@qa.test', role: 'developer' };

  const agentId = 'AGENT-WIN-ALICE-MIR';
  const testUdid = '00008140-0005596A36E9801C';

  let mockWs;
  let sentMessages = [];

  beforeEach(() => {
    sentMessages = [];
    mockWs = {
      readyState: 1,
      send: (data) => sentMessages.push(JSON.parse(data))
    };

    // Register test agent and claim
    agentService.agents.set(agentId, {
      id: agentId,
      name: 'Alice PC',
      userId: alice.id,
      userName: alice.name,
      userEmail: alice.email,
      status: 'ONLINE',
      platform: 'win32',
      registeredAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    });
    agentService.activeSockets.set(agentId, mockWs);

    // Register iOS device
    agentService.handleDeviceConnected(agentId, {
      udid: testUdid,
      name: 'iPhone 16e - Alice',
      platform: 'ios',
      iosVersion: '26.4.2',
      model: 'iPhone17,5'
    }, alice);

    deviceLockService.claims.set(testUdid, {
      userId: alice.id,
      userName: alice.name,
      claimedAt: new Date().toISOString()
    });
  });

  afterEach(() => {
    agentService.handleAgentDisconnect(agentId);
    agentMirrorService.handleAgentDisconnect(agentId);
    deviceLockService.claims.delete(testUdid);
  });

  test('1. startMirror dispatches START_MIRROR_REQUEST to Agent and returns streamUrl', async () => {
    const startPromise = agentMirrorService.startMirror(testUdid, alice, { quality: '720p' });

    assert.equal(sentMessages.length, 1);
    const sent = sentMessages[0];
    assert.equal(sent.type, 'START_MIRROR_REQUEST');
    assert.equal(sent.deviceId, testUdid);
    assert.equal(sent.quality, '720p');
    assert.ok(sent.requestId);

    // Simulate Agent START_MIRROR_RESPONSE
    agentMirrorService.handleAgentMirrorResponse(agentId, {
      type: 'START_MIRROR_RESPONSE',
      requestId: sent.requestId,
      deviceId: testUdid,
      success: true,
      port: 19450,
      streamUrl: 'http://127.0.0.1:19450/stream.bin',
      viewerUrl: 'http://127.0.0.1:19450/',
      resolution: '1170x2532'
    });

    const res = await startPromise;
    assert.equal(res.success, true);
    assert.equal(res.udid, testUdid);
    assert.equal(res.port, 19450);
    assert.ok(res.streamUrl.includes('/api/device/'));
    assert.ok(res.sessionToken);

    // Verify status
    const status = agentMirrorService.getMirrorStatus(testUdid);
    assert.equal(status.active, true);
    assert.equal(status.port, 19450);
    assert.equal(status.resolution, '1170x2532');

    // Verify token validation
    assert.equal(agentMirrorService.verifyStreamToken(testUdid, res.sessionToken), true);
    assert.equal(agentMirrorService.verifyStreamToken(testUdid, 'invalid-token'), false);
  });

  test('2. startMirror reuses existing active session without double dispatch', async () => {
    // Start initial session
    const p1 = agentMirrorService.startMirror(testUdid, alice);
    const reqId = sentMessages[0].requestId;
    agentMirrorService.handleAgentMirrorResponse(agentId, {
      type: 'START_MIRROR_RESPONSE',
      requestId: reqId,
      deviceId: testUdid,
      success: true,
      port: 19450,
      resolution: '1170x2532'
    });
    const r1 = await p1;

    // Second start request
    const r2 = await agentMirrorService.startMirror(testUdid, alice);
    assert.equal(r2.success, true);
    assert.equal(r2.reused, true);
    assert.equal(r2.sessionToken, r1.sessionToken);
    assert.equal(sentMessages.length, 1); // No second WS request
  });

  test('3. stopMirror dispatches STOP_MIRROR_REQUEST and invalidates stream token', async () => {
    // Start session
    const p1 = agentMirrorService.startMirror(testUdid, alice);
    const reqId = sentMessages[0].requestId;
    agentMirrorService.handleAgentMirrorResponse(agentId, {
      type: 'START_MIRROR_RESPONSE',
      requestId: reqId,
      deviceId: testUdid,
      success: true,
      port: 19450
    });
    const r1 = await p1;

    // Stop session
    sentMessages = [];
    const stopRes = await agentMirrorService.stopMirror(testUdid, alice);
    assert.equal(stopRes.success, true);

    assert.equal(sentMessages.length, 1);
    assert.equal(sentMessages[0].type, 'STOP_MIRROR_REQUEST');
    assert.equal(sentMessages[0].deviceId, testUdid);

    // Verify status and token invalidation
    assert.equal(agentMirrorService.getMirrorStatus(testUdid).active, false);
    assert.equal(agentMirrorService.verifyStreamToken(testUdid, r1.sessionToken), false);
  });

  test('4. Multi-User Isolation: Bob is rejected when attempting to start Alice device mirror', async () => {
    await assert.rejects(async () => {
      await agentMirrorService.startMirror(testUdid, bob);
    }, /Device is currently claimed by another user|Agent iOS device not found or unauthorized/);
  });

  test('5. Agent disconnect cleans all active mirror sessions and invalidates tokens', async () => {
    const p1 = agentMirrorService.startMirror(testUdid, alice);
    const reqId = sentMessages[0].requestId;
    agentMirrorService.handleAgentMirrorResponse(agentId, {
      type: 'START_MIRROR_RESPONSE',
      requestId: reqId,
      deviceId: testUdid,
      success: true,
      port: 19450
    });
    const r1 = await p1;

    // Simulate Agent Disconnect
    agentMirrorService.handleAgentDisconnect(agentId);

    assert.equal(agentMirrorService.getMirrorStatus(testUdid).active, false);
    assert.equal(agentMirrorService.verifyStreamToken(testUdid, r1.sessionToken), false);
  });

  test('6. proxyStreamRequest rewrites HTML viewer with base href and custom styles', async () => {
    const p1 = agentMirrorService.startMirror(testUdid, alice);
    const reqId = sentMessages[0].requestId;
    agentMirrorService.handleAgentMirrorResponse(agentId, {
      type: 'START_MIRROR_RESPONSE',
      requestId: reqId,
      deviceId: testUdid,
      success: true,
      port: 19450
    });
    const r1 = await p1;

    // Create a mock HTTP server simulating the agent stream server
    const http = require('http');
    const mockAgentServer = http.createServer((req, res) => {
      if (req.url === '/' || req.url.startsWith('/?')) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!doctype html><html><head><link rel="stylesheet" href="/viewer.css"></head><body><canvas id="c"></canvas><script src="/viewer.js"></script></body></html>');
      } else if (req.url === '/viewer.js' || req.url.startsWith('/viewer.js?')) {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end("fetch('/codec'); postJson('/touch', {x:0, y:0}); fetch('/stream.bin');");
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    await new Promise((resolve) => mockAgentServer.listen(19450, '127.0.0.1', resolve));

    try {
      // Test HTML viewer request
      let htmlResponse = '';
      let htmlHeaders = {};
      const mockHtmlRes = {
        writeHead: (status, headers) => { htmlHeaders = headers; },
        end: (body) => { htmlResponse = body; },
        status: (s) => ({ send: () => {} }),
        headersSent: false
      };

      const mockHtmlReq = {
        url: `/api/device/${encodeURIComponent(testUdid)}/mirror/stream?token=${r1.sessionToken}`,
        originalUrl: `/api/device/${encodeURIComponent(testUdid)}/mirror/stream?token=${r1.sessionToken}`,
        method: 'GET',
        headers: {},
        query: { token: r1.sessionToken },
        user: alice,
        pipe: (dest) => dest.end()
      };

      await new Promise((resolve) => {
        agentMirrorService.proxyStreamRequest(testUdid, mockHtmlReq, {
          ...mockHtmlRes,
          end: (b) => { mockHtmlRes.end(b); resolve(); }
        });
      });

      assert.ok(htmlResponse.includes(`<base href="/api/device/${encodeURIComponent(testUdid)}/mirror/stream/">`));
      assert.ok(htmlResponse.includes('<style>'));
      assert.ok(htmlResponse.includes('href="./viewer.css"'));
      assert.ok(htmlResponse.includes('src="./viewer.js"'));

      // Test viewer.js rewrite request
      let jsResponse = '';
      const mockJsReq = {
        url: `/api/device/${encodeURIComponent(testUdid)}/mirror/stream/viewer.js?token=${r1.sessionToken}`,
        originalUrl: `/api/device/${encodeURIComponent(testUdid)}/mirror/stream/viewer.js?token=${r1.sessionToken}`,
        method: 'GET',
        headers: {},
        query: { token: r1.sessionToken },
        user: alice,
        pipe: (dest) => dest.end()
      };

      await new Promise((resolve) => {
        agentMirrorService.proxyStreamRequest(testUdid, mockJsReq, {
          writeHead: () => {},
          end: (b) => { jsResponse = b; resolve(); },
          status: () => ({ send: () => {} }),
          headersSent: false
        });
      });

      assert.ok(jsResponse.includes("fetch('./codec')"));
      assert.ok(jsResponse.includes("postJson('./touch'"));
      assert.ok(jsResponse.includes("fetch('./stream.bin')"));
      assert.ok(!jsResponse.includes("fetch('/codec')"));
    } finally {
      await new Promise((resolve) => mockAgentServer.close(resolve));
    }
  });
});

