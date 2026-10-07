const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const adbService = require('./adbService');
const deviceLockService = require('./deviceLockService');
const iosService = require('./iosService');

class ScreenMirrorService {
  constructor() {
    this.screenshotsDir = path.join(config.DATA_DIR, 'screenshots');
    this.activeSessions = new Map(); // serial -> { proc, subscribers: Set<ws>, options, stats, startTime, isStopping }
    this.init();
  }

  init() {
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  /**
   * Start or attach to an active screen mirroring session for a device
   */
  async startMirror(serial, user, options = {}) {
    if (!serial) throw new Error('Device serial is required for screen mirror');
    if (!deviceLockService.isDeviceAccessible(serial, user)) {
      throw new Error(`Device ${serial} is not accessible by ${user.name}`);
    }

    if (iosService.isIosDevice(serial)) {
      const iosMirrorService = require('./iosMirrorService');
      return iosMirrorService.startMirror(serial, user, options);
    }

    let session = this.activeSessions.get(serial);
    if (session && session.proc && !session.proc.killed) {
      logger.info(`[ScreenMirror] Reusing active stream session for device ${serial}`);
      return {
        success: true,
        serial,
        status: 'active',
        resolution: session.stats.resolution || 'Auto',
        fps: session.stats.fps || 30
      };
    }

    const width = options.width || 720;
    const height = options.height || 1600;
    const bitrate = options.bitrate || 2000000; // 2 Mbps default for low-latency
    const fps = options.fps || 30;

    session = {
      serial,
      subscribers: new Set(),
      options: { width, height, bitrate, fps },
      cachedSps: null,
      cachedPps: null,
      cachedKeyframe: null,
      stats: {
        fps: 0,
        frameCount: 0,
        lastFpsCheck: Date.now(),
        bytesReceived: 0,
        resolution: `${width}x${height}`,
        bitrateKbps: Math.round(bitrate / 1000),
        startedAt: new Date().toISOString()
      },
      isStopping: false,
      proc: null
    };

    this.activeSessions.set(serial, session);
    this._spawnStreamProcess(session);

    logger.info(`[ScreenMirror] Started screen mirror session for device ${serial} (${width}x${height} @ ${Math.round(bitrate / 1000)}kbps)`);

    return {
      success: true,
      serial,
      status: 'active',
      resolution: session.stats.resolution,
      fps
    };
  }

  /**
   * Spawn ADB screenrecord process in continuous output mode
   */
  _spawnStreamProcess(session) {
    if (session.isStopping) return;

    const { serial, options } = session;
    // screenrecord arguments: output raw h264 to stdout
    const args = [
      '-s', serial,
      'exec-out',
      'screenrecord',
      '--output-format=h264',
      '--size', `${options.width}x${options.height}`,
      '--bit-rate', String(options.bitrate),
      '--time-limit', '180',
      '-'
    ];

    logger.debug(`[ScreenMirror Exec] adb ${args.join(' ')}`);

    const proc = spawn(config.ADB_PATH, args, { windowsHide: true });
    session.proc = proc;

    let chunkCounter = 0;
    let bytesInWindow = 0;
    let windowStartTime = Date.now();

    proc.stdout.on('data', (chunk) => {
      if (session.isStopping) return;

      session.stats.bytesReceived += chunk.length;
      chunkCounter++;
      bytesInWindow += chunk.length;

      // Accurately parse individual NAL units from H.264 Annex B chunk
      let lastNalPos = -1;
      let lastNalType = -1;

      for (let i = 0; i < chunk.length - 3; i++) {
        let startLen = 0;
        if (chunk[i] === 0 && chunk[i + 1] === 0) {
          if (chunk[i + 2] === 1) {
            startLen = 3;
          } else if (i < chunk.length - 3 && chunk[i + 2] === 0 && chunk[i + 3] === 1) {
            startLen = 4;
          }
        }

        if (startLen > 0) {
          if (lastNalPos !== -1) {
            const nalBuf = chunk.slice(lastNalPos, i);
            if (lastNalType === 7) session.cachedSps = nalBuf;
            else if (lastNalType === 8) session.cachedPps = nalBuf;
            else if (lastNalType === 5) session.cachedKeyframe = nalBuf;
          }
          lastNalType = chunk[i + startLen] & 0x1f;
          lastNalPos = i;
        }
      }

      if (lastNalPos !== -1) {
        const nalBuf = chunk.slice(lastNalPos);
        if (lastNalType === 7) session.cachedSps = nalBuf;
        else if (lastNalType === 8) session.cachedPps = nalBuf;
        else if (lastNalType === 5) session.cachedKeyframe = nalBuf;
      }

      // Update FPS & bitrate stats every 1 second
      const now = Date.now();
      const elapsed = (now - windowStartTime) / 1000;
      if (elapsed >= 1.0) {
        session.stats.fps = Math.round(chunkCounter / elapsed);
        session.stats.bitrateKbps = Math.round((bytesInWindow * 8) / (elapsed * 1000));
        chunkCounter = 0;
        bytesInWindow = 0;
        windowStartTime = now;
      }

      // Broadcast binary H.264 chunk to all subscribed WebSocket clients
      this._broadcastVideoChunk(session, chunk);
    });

    proc.stderr.on('data', (errChunk) => {
      const errStr = errChunk.toString().trim();
      if (errStr && !errStr.includes('Stop requested')) {
        logger.warn(`[ScreenMirror Stderr ${serial}]: ${errStr}`);
      }
    });

    proc.on('close', (code) => {
      logger.info(`[ScreenMirror Process Exited] Device: ${serial}, Code: ${code}`);
      // If session is still alive and has subscribers, automatically restart screenrecord (handles 180s limit)
      if (!session.isStopping && session.subscribers.size > 0) {
        logger.info(`[ScreenMirror] Seamlessly restarting screen stream for ${serial}...`);
        setTimeout(() => {
          if (!session.isStopping && this.activeSessions.has(serial)) {
            this._spawnStreamProcess(session);
          }
        }, 100);
      } else if (session.subscribers.size === 0) {
        this.stopMirror(serial);
      }
    });

    proc.on('error', (err) => {
      logger.error(`[ScreenMirror Error ${serial}]: ${err.message}`);
      this._broadcastJson(session, {
        type: 'MIRROR_ERROR',
        serial,
        error: `Screen recording process error: ${err.message}`
      });
    });
  }

  /**
   * Broadcast binary H.264 video chunk to WebSocket subscribers
   */
  _broadcastVideoChunk(session, chunk) {
    if (!session || !session.subscribers) return;

    for (const ws of session.subscribers) {
      if (ws.readyState === 1 /* OPEN */) {
        try {
          ws.send(chunk, { binary: true });
        } catch (err) {
          logger.warn(`[ScreenMirror] Failed to send video frame to client: ${err.message}`);
        }
      } else {
        session.subscribers.delete(ws);
      }
    }
  }

  /**
   * Broadcast JSON status/error message to subscribers
   */
  _broadcastJson(session, msg) {
    if (!session || !session.subscribers) return;
    const payload = JSON.stringify(msg);

    for (const ws of session.subscribers) {
      if (ws.readyState === 1) {
        try {
          ws.send(payload);
        } catch (e) {}
      }
    }
  }

  /**
   * Subscribe a WebSocket client to a device mirror stream
   */
  subscribeClient(serial, ws, user) {
    if (!serial || !ws) return;
    if (!deviceLockService.isDeviceAccessible(serial, user)) {
      ws.send(JSON.stringify({ type: 'MIRROR_ERROR', serial, error: 'Unauthorized to view this device screen' }));
      return;
    }

    if (iosService.isIosDevice(serial)) {
      const iosMirrorService = require('./iosMirrorService');
      iosMirrorService.startMirror(serial, user)
        .then((res) => {
          ws.send(JSON.stringify({
            type: 'MIRROR_STARTED',
            serial,
            streamUrl: res.streamUrl,
            resolution: '1170x2532',
            fps: 30
          }));
        })
        .catch((err) => {
          ws.send(JSON.stringify({
            type: 'MIRROR_ERROR',
            serial,
            error: err.message
          }));
        });
      return;
    }

    let session = this.activeSessions.get(serial);
    if (!session) {
      this.startMirror(serial, user);
      session = this.activeSessions.get(serial);
    }

    if (session) {
      session.subscribers.add(ws);
      ws.subscribedSerial = serial;
      logger.info(`[ScreenMirror] Client subscribed to device ${serial} (total subscribers: ${session.subscribers.size})`);

      ws.send(JSON.stringify({
        type: 'MIRROR_STARTED',
        serial,
        resolution: session.stats.resolution,
        bitrateKbps: session.stats.bitrateKbps,
        fps: session.stats.fps || 30
      }));

      // Immediately send cached SPS/PPS initialization chunks to ensure decoder starts without delay
      if (ws.readyState === 1 /* OPEN */) {
        try {
          if (session.cachedSps) {
            ws.send(session.cachedSps, { binary: true });
          }
          if (session.cachedPps) {
            ws.send(session.cachedPps, { binary: true });
          }
          if (session.cachedKeyframe) {
            ws.send(session.cachedKeyframe, { binary: true });
          }
        } catch (err) {
          logger.warn(`[ScreenMirror] Error delivering cached SPS/PPS headers: ${err.message}`);
        }
      }
    }
  }

  /**
   * Unsubscribe a WebSocket client from a device mirror stream
   */
  unsubscribeClient(serial, ws) {
    const targetSerial = serial || ws.subscribedSerial;
    if (!targetSerial) return;

    const session = this.activeSessions.get(targetSerial);
    if (session) {
      session.subscribers.delete(ws);
      logger.info(`[ScreenMirror] Client unsubscribed from device ${targetSerial} (remaining: ${session.subscribers.size})`);

      // If no clients remain after 15s grace period, stop mirror to conserve device battery & CPU
      if (session.subscribers.size === 0) {
        setTimeout(() => {
          const current = this.activeSessions.get(targetSerial);
          if (current && current.subscribers.size === 0) {
            this.stopMirror(targetSerial);
          }
        }, 15000);
      }
    }
    delete ws.subscribedSerial;
  }

  /**
   * Stop active mirroring session for a device
   */
  stopMirror(serial, user = null) {
    if (!serial) return { success: false };

    if (iosService.isIosDevice(serial)) {
      const iosMirrorService = require('./iosMirrorService');
      return iosMirrorService.stopMirror(serial, user);
    }

    const session = this.activeSessions.get(serial);
    if (!session) {
      return { success: true, message: 'No active session' };
    }

    session.isStopping = true;
    this._broadcastJson(session, { type: 'MIRROR_STOPPED', serial });

    if (session.proc) {
      try {
        session.proc.stdout?.removeAllListeners();
        session.proc.stderr?.removeAllListeners();
        session.proc.removeAllListeners();
        session.proc.kill('SIGKILL');
      } catch (e) {
        try { session.proc.kill('SIGTERM'); } catch (e2) {}
      }
    }

    session.cachedSps = null;
    session.cachedPps = null;
    session.cachedKeyframe = null;

    this.activeSessions.delete(serial);
    logger.info(`[ScreenMirror] Screen mirror session stopped and fully cleaned up for device ${serial}`);
    return { success: true, message: `Mirror session stopped for ${serial}` };
  }

  /**
   * Get status of device mirror session
   */
  getMirrorStatus(serial) {
    const session = this.activeSessions.get(serial);
    if (!session) {
      return { active: false, serial };
    }

    return {
      active: true,
      serial,
      subscribersCount: session.subscribers.size,
      fps: session.stats.fps,
      bitrateKbps: session.stats.bitrateKbps,
      resolution: session.stats.resolution,
      bytesReceived: session.stats.bytesReceived,
      startedAt: session.stats.startedAt
    };
  }

  /**
   * Capture high-resolution PNG screenshot directly from device framebuffer
   */
  async captureScreenshot(serial, user) {
    if (!serial) throw new Error('Device serial is required for screenshot');
    if (!deviceLockService.isDeviceAccessible(serial, user)) {
      throw new Error(`Device ${serial} is not accessible by ${user.name}`);
    }

    const sanitizedSerial = serial.replace(/[^a-zA-Z0-9_-]/g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `screenshot_${sanitizedSerial}_${timestamp}.png`;
    const filePath = path.join(this.screenshotsDir, filename);

    logger.info(`[Screenshot] Capturing screenshot for device ${serial} -> ${filename}`);

    const pngBuffer = await new Promise((resolve, reject) => {
      const proc = spawn(config.ADB_PATH, ['-s', serial, 'exec-out', 'screencap', '-p'], {
        windowsHide: true,
        maxBuffer: 15 * 1024 * 1024
      });

      const chunks = [];
      proc.stdout.on('data', chunk => chunks.push(chunk));
      proc.stderr.on('data', () => {});

      proc.on('error', err => reject(err));
      proc.on('close', (code) => {
        const buffer = Buffer.concat(chunks);
        if (code === 0 && buffer.length > 0 && buffer[0] === 0x89 && buffer[1] === 0x50) { // Valid PNG magic bytes
          resolve(buffer);
        } else {
          reject(new Error(`Screenshot capture failed (code ${code}, received ${buffer.length} bytes)`));
        }
      });
    });

    // Write file to disk
    fs.writeFileSync(filePath, pngBuffer);

    // Get basic telemetry metadata
    const deviceInfo = await adbService.getDeviceInfo(serial).catch(() => ({}));

    return {
      success: true,
      filename,
      filePath,
      url: `/api/device/${encodeURIComponent(serial)}/screenshot/${filename}`,
      sizeBytes: pngBuffer.length,
      timestamp: new Date().toISOString(),
      device: {
        serial,
        name: deviceInfo.name || 'Android Device',
        model: deviceInfo.model || 'Unknown',
        androidVersion: deviceInfo.androidVersion || 'Android',
        screenResolution: deviceInfo.screenResolution || 'Unknown'
      },
      previewBase64: `data:image/png;base64,${pngBuffer.toString('base64')}`
    };
  }

  /**
   * Send touch or key input event to device
   */
  async sendInput(serial, user, event = {}) {
    if (!serial) throw new Error('Device serial is required');
    if (!deviceLockService.isDeviceAccessible(serial, user)) {
      throw new Error(`Device ${serial} is not accessible`);
    }

    const { type, x, y, endX, endY, durationMs, keycode } = event;

    if (type === 'tap') {
      if (typeof x !== 'number' || typeof y !== 'number') throw new Error('Valid X and Y coordinates required for tap');
      await adbService.execute(['-s', serial, 'shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
      return { success: true, type: 'tap', x, y };
    }

    if (type === 'swipe') {
      if (typeof x !== 'number' || typeof y !== 'number' || typeof endX !== 'number' || typeof endY !== 'number') {
        throw new Error('Valid start and end coordinates required for swipe');
      }
      const dur = durationMs || 300;
      await adbService.execute([
        '-s', serial,
        'shell', 'input', 'swipe',
        String(Math.round(x)), String(Math.round(y)),
        String(Math.round(endX)), String(Math.round(endY)),
        String(dur)
      ]);
      return { success: true, type: 'swipe' };
    }

    if (type === 'keyevent') {
      const allowedKeys = [
        3,   // HOME
        4,   // BACK
        187, // APP_SWITCH (Recents)
        24,  // VOLUME_UP
        25,  // VOLUME_DOWN
        26,  // POWER / WAKE
        82,  // MENU
        66,  // ENTER
        67   // DEL / BACKSPACE
      ];

      const targetKey = parseInt(keycode, 10);
      if (!allowedKeys.includes(targetKey)) {
        throw new Error(`Keycode ${keycode} is not in the allowlist.`);
      }

      await adbService.execute(['-s', serial, 'shell', 'input', 'keyevent', String(targetKey)]);
      return { success: true, type: 'keyevent', keycode: targetKey };
    }

    if (type === 'text') {
      const text = String(event.text || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (text) {
        await adbService.execute(['-s', serial, 'shell', 'input', 'text', text]);
      }
      return { success: true, type: 'text' };
    }

    throw new Error(`Unsupported input event type: ${type}`);
  }

  /**
   * Cleanup all sessions on server shutdown
   */
  cleanupAll() {
    for (const [serial, session] of this.activeSessions.entries()) {
      try {
        session.isStopping = true;
        if (session.proc) session.proc.kill('SIGKILL');
      } catch (e) {}
    }
    this.activeSessions.clear();
    logger.info('[ScreenMirror] All screen mirror processes cleaned up.');
  }
}

module.exports = new ScreenMirrorService();
