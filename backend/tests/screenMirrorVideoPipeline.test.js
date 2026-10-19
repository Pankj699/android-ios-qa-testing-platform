const test = require('node:test');
const assert = require('node:assert');
const screenMirrorService = require('../src/services/screenMirrorService');
const deviceLockService = require('../src/services/deviceLockService');

test('ScreenMirrorService: accurately extracts SPS, PPS and IDR keyframe across chunk boundaries', () => {
  const sps = Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1f]); // type 7
  const pps = Buffer.from([0, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80]); // type 8
  const idrPart1 = Buffer.concat([Buffer.from([0, 0, 0, 1, 0x65]), Buffer.alloc(20000, 0xaa)]); // type 5, 20005 bytes
  const idrPart2 = Buffer.alloc(15000, 0xbb); // continuation of type 5
  const pFrame = Buffer.concat([Buffer.from([0, 0, 0, 1, 0x41]), Buffer.alloc(500, 0xcc)]); // type 1

  const chunk1 = Buffer.concat([sps, pps, idrPart1]);
  const chunk2 = Buffer.concat([idrPart2, pFrame]);

  const session = {
    cachedSps: null,
    cachedPps: null,
    cachedKeyframe: null,
    _accumulatingNalType: -1,
    _accumulatingChunks: [],
    _accumulatedLength: 0,
    _pendingStartCodeBytes: null
  };

  screenMirrorService._processH264Chunk(session, chunk1);
  assert.ok(session.cachedSps, 'SPS should be cached');
  assert.strictEqual(session.cachedSps.length, sps.length);
  assert.ok(session.cachedPps, 'PPS should be cached');
  assert.strictEqual(session.cachedPps.length, pps.length);
  assert.strictEqual(session.cachedKeyframe, null, 'Keyframe should not be finalized mid-stream');

  screenMirrorService._processH264Chunk(session, chunk2);
  assert.ok(session.cachedKeyframe, 'Keyframe should be finalized after next frame start code');

  const expectedKeyframe = Buffer.concat([idrPart1, idrPart2]);
  assert.strictEqual(session.cachedKeyframe.length, expectedKeyframe.length);
  assert.ok(session.cachedKeyframe.equals(expectedKeyframe), 'Keyframe must match concatenated chunks exactly');
});

test('ScreenMirrorService: handles 3-chunk split keyframe with intermediate headless chunk', () => {
  const sps = Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1f]);
  const pps = Buffer.from([0, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80]);
  const idrPart1 = Buffer.concat([Buffer.from([0, 0, 0, 1, 0x65]), Buffer.alloc(10000, 0x11)]);
  const idrPart2 = Buffer.alloc(15000, 0x22); // No start codes in this chunk
  const idrPart3 = Buffer.alloc(8000, 0x33);
  const pFrame = Buffer.concat([Buffer.from([0, 0, 0, 1, 0x41]), Buffer.alloc(500, 0x44)]);

  const chunk1 = Buffer.concat([sps, pps, idrPart1]);
  const chunk2 = idrPart2;
  const chunk3 = Buffer.concat([idrPart3, pFrame]);

  const session = {
    cachedSps: null,
    cachedPps: null,
    cachedKeyframe: null,
    _accumulatingNalType: -1,
    _accumulatingChunks: [],
    _accumulatedLength: 0,
    _pendingStartCodeBytes: null
  };

  screenMirrorService._processH264Chunk(session, chunk1);
  screenMirrorService._processH264Chunk(session, chunk2);
  screenMirrorService._processH264Chunk(session, chunk3);

  const expectedKeyframe = Buffer.concat([idrPart1, idrPart2, idrPart3]);
  assert.strictEqual(session.cachedKeyframe.length, expectedKeyframe.length);
  assert.ok(session.cachedKeyframe.equals(expectedKeyframe));
});

test('ScreenMirrorService: handles start code split across chunk boundaries', () => {
  const sps = Buffer.from([0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1f]);
  const pps = Buffer.from([0, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80]);
  const idrPart = Buffer.concat([Buffer.from([0, 0, 0, 1, 0x65]), Buffer.alloc(1000, 0xaa)]);

  // Chunk 1 ends with 0x00, 0x00
  const chunk1 = Buffer.concat([sps, pps, idrPart, Buffer.from([0, 0])]);
  // Chunk 2 starts with 0x00, 0x01, 0x41 (NAL type 1)
  const chunk2 = Buffer.concat([Buffer.from([0, 1, 0x41]), Buffer.alloc(200, 0xbb)]);

  const session = {
    cachedSps: null,
    cachedPps: null,
    cachedKeyframe: null,
    _accumulatingNalType: -1,
    _accumulatingChunks: [],
    _accumulatedLength: 0,
    _pendingStartCodeBytes: null
  };

  screenMirrorService._processH264Chunk(session, chunk1);
  screenMirrorService._processH264Chunk(session, chunk2);

  assert.ok(session.cachedKeyframe);
  assert.ok(session.cachedKeyframe.equals(idrPart), 'Keyframe should match without trailing zeros from split start code');
});

test('ScreenMirrorService: subscribeClient is idempotent and avoids duplicate header delivery', () => {
  const serial = 'mock_serial_idempotent_test';
  const testUser = { id: 'usr_mirror_test', name: 'Tester', email: 'tester@qatools.internal' };
  deviceLockService.setOwner(serial, testUser);

  const mockSession = {
    serial,
    subscribers: new Set(),
    options: { width: 720, height: 1600, bitrate: 2000000, fps: 30 },
    cachedSps: Buffer.from([0, 0, 0, 1, 0x67, 0x42]),
    cachedPps: Buffer.from([0, 0, 0, 1, 0x68, 0xce]),
    cachedKeyframe: Buffer.from([0, 0, 0, 1, 0x65, 0xaa, 0xbb]),
    stats: { resolution: '720x1600', bitrateKbps: 2000, fps: 30 },
    isStopping: false
  };

  screenMirrorService.activeSessions.set(serial, mockSession);

  const sentMessages = [];
  const mockWs = {
    readyState: 1, // OPEN
    send: (data, opts) => {
      sentMessages.push({ data, opts });
    }
  };

  // First subscription
  screenMirrorService.subscribeClient(serial, mockWs, testUser);
  assert.strictEqual(mockSession.subscribers.size, 1);
  assert.strictEqual(sentMessages.length, 4); // MIRROR_STARTED JSON + SPS + PPS + Keyframe

  // Second subscription call on the same ws (e.g. MIRROR_START action)
  screenMirrorService.subscribeClient(serial, mockWs, testUser);
  assert.strictEqual(mockSession.subscribers.size, 1);
  assert.strictEqual(sentMessages.length, 4, 'Should NOT send duplicate MIRROR_STARTED or headers');

  // Cleanup
  screenMirrorService.activeSessions.delete(serial);
  deviceLockService.clearOwner(serial);
});

test('ScreenMirrorService: allows Android bottom navigation keycodes (3, 4, 187)', async () => {
  const serial = 'mock_nav_test_device';
  const testUser = { id: 'usr_nav_tester', name: 'Nav Tester', email: 'nav@test.com' };
  deviceLockService.setOwner(serial, testUser);

  // We test allowlist validation in sendInput
  // Keycode 3: HOME
  // Keycode 4: BACK
  // Keycode 187: RECENT APPS
  // All three should be recognized as valid keycodes by the allowlist check
  const allowed = [3, 4, 187];
  for (const code of allowed) {
    try {
      // It might attempt adb execute which will fail on mock serial, but must NOT fail validation
      await screenMirrorService.sendInput(serial, testUser, { type: 'keyevent', keycode: code });
    } catch (err) {
      assert.ok(!err.message.includes('not in the allowlist'), `Keycode ${code} should be in allowlist`);
    }
  }

  deviceLockService.clearOwner(serial);
});
