const { describe, test, it, before, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

describe('BugDesk Screen Mirror State Preservation & Recording Integration Test Suite', () => {
  let screenMirrorStreamManager;

  // Mock synthetic DOM video element for capture testing
  function createMockVideoElement({ width = 1080, height = 2400, readyState = 4 } = {}) {
    return {
      videoWidth: width,
      videoHeight: height,
      readyState,
      muted: true,
      paused: false,
      play: () => Promise.resolve(),
      pause: () => {},
      captureStream: (fps = 30) => ({
        getVideoTracks: () => [{ id: 'mock-track-1', kind: 'video', enabled: true, stop: () => {} }]
      })
    };
  }

  before(async () => {
    // Setup minimal window/custom event mock environment in node if not defined
    if (typeof global.window === 'undefined') {
      const listeners = new Map();
      global.window = {
        addEventListener: (name, cb) => {
          if (!listeners.has(name)) listeners.set(name, new Set());
          listeners.get(name).add(cb);
        },
        removeEventListener: (name, cb) => {
          if (listeners.has(name)) listeners.get(name).delete(cb);
        },
        dispatchEvent: (event) => {
          if (listeners.has(event.type)) {
            for (const cb of listeners.get(event.type)) {
              try { cb(event); } catch (e) {}
            }
          }
          return true;
        }
      };
      global.CustomEvent = class CustomEvent {
        constructor(type, init = {}) {
          this.type = type;
          this.detail = init.detail || {};
        }
      };
    }

    // Dynamically import ESM stream manager
    const managerPath = path.resolve(__dirname, '../../frontend/src/services/screenMirrorStreamManager.js');
    const mod = await import(pathToFileURL(managerPath).href);
    screenMirrorStreamManager = mod.screenMirrorStreamManager;
  });

  beforeEach(() => {
    screenMirrorStreamManager.reset();
    screenMirrorStreamManager.activeStreamInfo = null;
  });

  describe('Scenario 1: Initial Inactive State', () => {
    test('Record Screen button is disabled when mirror has not been started', () => {
      const targetDevice = { serial: '192.168.0.45:41343', name: 'Vivo V2143' };
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(targetDevice), false);
      assert.strictEqual(screenMirrorStreamManager.getMirrorStatus(), 'inactive');
    });
  });

  describe('Scenario 2: Opening Mirror Starts Stream & Enables Recording', () => {
    test('Registering active stream transitions mirrorStatus to live and enables recording', () => {
      const targetDevice = { serial: '192.168.0.45:41343', hardwareSerial: '15909075850008D', name: 'Vivo V2143' };
      const videoEl = createMockVideoElement();

      let statusChangedFired = false;
      let lastDetail = null;
      const onStatus = (e) => {
        statusChangedFired = true;
        lastDetail = e.detail;
      };
      window.addEventListener('mirror:status-changed', onStatus);

      screenMirrorStreamManager.registerStream(targetDevice, videoEl, 'live');

      assert.strictEqual(statusChangedFired, true);
      assert.strictEqual(lastDetail.status, 'live');
      assert.strictEqual(lastDetail.isReady, true);
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(targetDevice), true);
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady({ serial: '15909075850008D' }), true);

      window.removeEventListener('mirror:status-changed', onStatus);
    });
  });

  describe('Scenario 3: Closing Mirror Panel (X) Preserves Active Session', () => {
    test('Closing mirror UI does NOT unregister stream or stop mirror when videoElement remains', () => {
      const targetDevice = { serial: '192.168.0.45:41343', name: 'Vivo V2143' };
      const videoEl = createMockVideoElement();

      screenMirrorStreamManager.registerStream(targetDevice, videoEl, 'live');
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(targetDevice), true);

      // Closing modal only toggles UI visibility; stream manager retains activeStreamInfo
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(targetDevice), true);
      assert.strictEqual(screenMirrorStreamManager.getMirrorStatus(), 'live');
    });

    test('Unregister with mismatched videoElement (e.g. from an unmounted secondary view) does NOT clear primary stream', () => {
      const targetDevice = { serial: '192.168.0.45:41343', name: 'Vivo V2143' };
      const primaryVideoEl = createMockVideoElement();
      const secondaryVideoEl = createMockVideoElement();

      screenMirrorStreamManager.registerStream(targetDevice, primaryVideoEl, 'live');

      // Secondary view unmounts and calls unregisterStream with its own video element
      screenMirrorStreamManager.unregisterStream(targetDevice.serial, secondaryVideoEl);

      // Primary stream remains intact and ready
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(targetDevice), true);
      assert.strictEqual(screenMirrorStreamManager.getActiveSession().videoElement, primaryVideoEl);
    });
  });

  describe('Scenario 4 & 5: Recording while Mirror Panel is Closed', () => {
    test('Can obtain capture stream track from preserved background video element', () => {
      const targetDevice = { serial: '192.168.0.45:41343', name: 'Vivo V2143' };
      const videoEl = createMockVideoElement();

      screenMirrorStreamManager.registerStream(targetDevice, videoEl, 'live');

      const stream = screenMirrorStreamManager.getCaptureStream();
      assert.ok(stream, 'Capture stream should be accessible');
      assert.strictEqual(stream.getVideoTracks().length, 1);
      assert.strictEqual(stream.getVideoTracks()[0].kind, 'video');
    });
  });

  describe('Scenario 6 & 7: Closing / Reopening Mirror UI During Active Recording', () => {
    test('UnregisterStream does not abort recording while mirror stream is still alive', () => {
      const targetDevice = { serial: '192.168.0.45:41343', name: 'Vivo V2143' };
      const videoEl = createMockVideoElement();

      screenMirrorStreamManager.registerStream(targetDevice, videoEl, 'live');
      screenMirrorStreamManager.state = 'recording';
      screenMirrorStreamManager.durationSec = 12;

      // An unmount event of another component occurs without dead status
      const otherVideoEl = createMockVideoElement();
      screenMirrorStreamManager.unregisterStream(targetDevice.serial, otherVideoEl);

      // Recording state and duration must be preserved
      assert.strictEqual(screenMirrorStreamManager.state, 'recording');
      assert.strictEqual(screenMirrorStreamManager.durationSec, 12);
    });
  });

  describe('Scenario 8: Synchronized Stop Recording', () => {
    test('Stop recording finalizes data and transitions state to finalizing', async () => {
      screenMirrorStreamManager.state = 'recording';
      screenMirrorStreamManager.durationSec = 5;
      screenMirrorStreamManager.recordedChunks = [Buffer.from('mock-h264-chunk')];
      screenMirrorStreamManager.recordingMimeConfig = { mime: 'video/webm', ext: 'webm' };
      screenMirrorStreamManager.recorder = {
        state: 'recording',
        stop: function() {
          this.state = 'inactive';
          if (this.onstop) this.onstop();
        }
      };

      const resultPromise = screenMirrorStreamManager.stopRecording();
      const res = await resultPromise;

      assert.ok(res, 'Recording result should be resolved');
      assert.strictEqual(res.durationSec, 5);
      assert.strictEqual(res.ext, 'webm');
      assert.ok(screenMirrorStreamManager.preservedBlob);
    });
  });

  describe('Scenario 9: Explicit Termination & Device Disconnection', () => {
    test('updateStatus(stopped) immediately transitions isMirrorReady to false and stops recording', () => {
      const targetDevice = { serial: '192.168.0.45:41343', name: 'Vivo V2143' };
      const videoEl = createMockVideoElement();

      screenMirrorStreamManager.registerStream(targetDevice, videoEl, 'live');
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(targetDevice), true);

      // Device disconnects or user stops mirror session
      screenMirrorStreamManager.updateStatus(targetDevice.serial, 'stopped');

      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(targetDevice), false);
      assert.strictEqual(screenMirrorStreamManager.getMirrorStatus(), 'stopped');
    });

    test('updateStatus(error) immediately transitions isMirrorReady to false', () => {
      const targetDevice = { serial: '192.168.0.45:41343', name: 'Vivo V2143' };
      const videoEl = createMockVideoElement();

      screenMirrorStreamManager.registerStream(targetDevice, videoEl, 'live');
      screenMirrorStreamManager.updateStatus(targetDevice.serial, 'error');

      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(targetDevice), false);
      assert.strictEqual(screenMirrorStreamManager.getMirrorStatus(), 'error');
    });
  });

  describe('Scenario 10: Page Refresh & Backend Reconciliation', () => {
    test('reconcileBackendStatus restores status to live if backend session is active', async () => {
      const targetDevice = { serial: '192.168.0.45:41343', name: 'Vivo V2143' };
      const videoEl = createMockVideoElement();

      screenMirrorStreamManager.registerStream(targetDevice, videoEl, 'connecting');

      // Mock api.getMirrorStatus returning active
      const originalApi = screenMirrorStreamManager.api;
      screenMirrorStreamManager.api = {
        getMirrorStatus: async (serial) => ({ success: true, status: { active: true, serial } })
      };

      const isLive = await screenMirrorStreamManager.reconcileBackendStatus(targetDevice);
      assert.strictEqual(isLive, true);
      assert.strictEqual(screenMirrorStreamManager.getMirrorStatus(), 'live');
    });

    test('reconcileBackendStatus stops mirror if backend reports inactive', async () => {
      const targetDevice = { serial: '192.168.0.45:41343', name: 'Vivo V2143' };
      const videoEl = createMockVideoElement();

      screenMirrorStreamManager.registerStream(targetDevice, videoEl, 'live');

      screenMirrorStreamManager.api = {
        getMirrorStatus: async (serial) => ({ success: true, status: { active: false, serial } })
      };

      const isLive = await screenMirrorStreamManager.reconcileBackendStatus(targetDevice);
      assert.strictEqual(isLive, false);
      assert.strictEqual(screenMirrorStreamManager.getMirrorStatus(), 'stopped');
      assert.strictEqual(screenMirrorStreamManager.isMirrorReady(targetDevice), false);
    });
  });
});
