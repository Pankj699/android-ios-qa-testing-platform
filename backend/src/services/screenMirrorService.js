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

    if (user && !deviceLockService.isUserDevice(serial, user)) {
      deviceLockService.setOwner(serial, user);
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
      _accumulatingNalType: -1,
      _accumulatingChunks: [],
      _accumulatedLength: 0,
      _pendingStartCodeBytes: null,
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
      proc: null,
      inputProc: null,
      inputQueue: [],
      isProcessingInputQueue: false
    };

    this.activeSessions.set(serial, session);
    this._spawnStreamProcess(session);
    this._initInputProc(session);

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
    session.procStartTime = Date.now();

    let chunkCounter = 0;
    let bytesInWindow = 0;
    let windowStartTime = Date.now();

    proc.stdout.on('data', (chunk) => {
      if (session.isStopping) return;

      session.stats.bytesReceived += chunk.length;
      chunkCounter++;
      bytesInWindow += chunk.length;

      // Accurately parse and assemble complete NAL units across chunk boundaries
      this._processH264Chunk(session, chunk);

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

      const runDuration = Date.now() - (session.procStartTime || 0);
      if (runDuration > 10000) {
        session.consecutiveErrors = 0;
      } else if (code !== 0) {
        session.consecutiveErrors = (session.consecutiveErrors || 0) + 1;
      }

      // If session is still alive and has subscribers, automatically restart screenrecord (handles 180s limit)
      if (!session.isStopping && session.subscribers.size > 0) {
        if (session.consecutiveErrors >= 5) {
          logger.warn(`[ScreenMirror] Screen recording failed repeatedly (${session.consecutiveErrors} consecutive errors) on device ${serial}. Stopping mirror session.`);
          this._broadcastJson(session, {
            type: 'MIRROR_ERROR',
            serial,
            error: `Screen recording failed repeatedly: device ${serial} is offline or not responding.`
          });
          this.stopMirror(serial);
          return;
        }

        const backoffMs = session.consecutiveErrors > 0
          ? Math.min(500 * Math.pow(1.5, session.consecutiveErrors), 5000)
          : 100;

        logger.info(`[ScreenMirror] Seamlessly restarting screen stream for ${serial} (retry in ${backoffMs}ms, error streak: ${session.consecutiveErrors})...`);
        setTimeout(() => {
          if (!session.isStopping && this.activeSessions.has(serial)) {
            this._spawnStreamProcess(session);
          }
        }, backoffMs);
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
   * Parse H.264 Annex-B stream chunks and accurately assemble complete SPS, PPS, and IDR keyframe units
   * across arbitrary TCP/process chunk boundaries.
   */
  _processH264Chunk(session, chunk) {
    if (!session || !chunk || chunk.length === 0) return;

    let buf = chunk;
    if (session._pendingStartCodeBytes && session._pendingStartCodeBytes.length > 0) {
      buf = Buffer.concat([session._pendingStartCodeBytes, chunk]);
      session._pendingStartCodeBytes = null;
    }

    // Check if buffer ends with trailing zeros that could be part of a split start code (up to 3 zeros)
    let trailingZeroCount = 0;
    for (let j = buf.length - 1; j >= Math.max(0, buf.length - 3); j--) {
      if (buf[j] === 0) trailingZeroCount++;
      else break;
    }

    let processableBuf = buf;
    if (trailingZeroCount > 0 && trailingZeroCount < buf.length) {
      processableBuf = buf.slice(0, buf.length - trailingZeroCount);
      session._pendingStartCodeBytes = buf.slice(buf.length - trailingZeroCount);
    } else if (trailingZeroCount === buf.length) {
      session._pendingStartCodeBytes = buf;
      return;
    }

    // Check if processableBuf ends with a start code prefix whose NAL type byte hasn't arrived yet
    if (processableBuf.length >= 3) {
      const pLen = processableBuf.length;
      if (processableBuf[pLen - 3] === 0 && processableBuf[pLen - 2] === 0 && processableBuf[pLen - 1] === 1) {
        session._pendingStartCodeBytes = Buffer.concat([
          processableBuf.slice(pLen - 3),
          session._pendingStartCodeBytes || Buffer.alloc(0)
        ]);
        processableBuf = processableBuf.slice(0, pLen - 3);
      } else if (pLen >= 4 && processableBuf[pLen - 4] === 0 && processableBuf[pLen - 3] === 0 && processableBuf[pLen - 2] === 0 && processableBuf[pLen - 1] === 1) {
        session._pendingStartCodeBytes = Buffer.concat([
          processableBuf.slice(pLen - 4),
          session._pendingStartCodeBytes || Buffer.alloc(0)
        ]);
        processableBuf = processableBuf.slice(0, pLen - 4);
      }
    }

    const startCodes = [];
    let i = 0;
    while (i <= processableBuf.length - 3) {
      if (processableBuf[i] === 0 && processableBuf[i + 1] === 0) {
        if (processableBuf[i + 2] === 1) {
          if (i + 3 < processableBuf.length) {
            const type = processableBuf[i + 3] & 0x1f;
            startCodes.push({ index: i, len: 3, type });
            i += 3;
            continue;
          }
        } else if (i <= processableBuf.length - 4 && processableBuf[i + 2] === 0 && processableBuf[i + 3] === 1) {
          if (i + 4 < processableBuf.length) {
            const type = processableBuf[i + 4] & 0x1f;
            startCodes.push({ index: i, len: 4, type });
            i += 4;
            continue;
          }
        }
      }
      i++;
    }

    // If no start codes found in this chunk
    if (startCodes.length === 0) {
      if (session._accumulatingNalType === 5) {
        session._accumulatingChunks.push(processableBuf);
        session._accumulatedLength = (session._accumulatedLength || 0) + processableBuf.length;
        if (session._accumulatedLength > 4 * 1024 * 1024) {
          session._accumulatingChunks = [];
          session._accumulatingNalType = -1;
          session._accumulatedLength = 0;
        }
      } else if (session._accumulatingNalType === 7 || session._accumulatingNalType === 8) {
        session._accumulatingChunks.push(processableBuf);
      }
      return;
    }

    // Prefix bytes before first start code belong to previous accumulating NAL unit
    const prefixBytes = processableBuf.slice(0, startCodes[0].index);
    if (prefixBytes.length > 0) {
      if (session._accumulatingNalType === 5) {
        session._accumulatingChunks.push(prefixBytes);
        session.cachedKeyframe = Buffer.concat(session._accumulatingChunks);
        session._accumulatingChunks = [];
        session._accumulatingNalType = -1;
        session._accumulatedLength = 0;
      } else if (session._accumulatingNalType === 7) {
        session._accumulatingChunks.push(prefixBytes);
        session.cachedSps = Buffer.concat(session._accumulatingChunks);
        session._accumulatingChunks = [];
        session._accumulatingNalType = -1;
      } else if (session._accumulatingNalType === 8) {
        session._accumulatingChunks.push(prefixBytes);
        session.cachedPps = Buffer.concat(session._accumulatingChunks);
        session._accumulatingChunks = [];
        session._accumulatingNalType = -1;
      }
    } else if (startCodes[0].index === 0) {
      if (session._accumulatingNalType === 5) {
        session.cachedKeyframe = Buffer.concat(session._accumulatingChunks);
        session._accumulatingChunks = [];
        session._accumulatingNalType = -1;
        session._accumulatedLength = 0;
      } else if (session._accumulatingNalType === 7) {
        session.cachedSps = Buffer.concat(session._accumulatingChunks);
        session._accumulatingChunks = [];
        session._accumulatingNalType = -1;
      } else if (session._accumulatingNalType === 8) {
        session.cachedPps = Buffer.concat(session._accumulatingChunks);
        session._accumulatingChunks = [];
        session._accumulatingNalType = -1;
      }
    }

    // Process each start code in this chunk
    for (let k = 0; k < startCodes.length; k++) {
      const curr = startCodes[k];
      const isLast = (k === startCodes.length - 1);

      if (!isLast) {
        const next = startCodes[k + 1];
        const nalSlice = processableBuf.slice(curr.index, next.index);
        if (curr.type === 7) session.cachedSps = nalSlice;
        else if (curr.type === 8) session.cachedPps = nalSlice;
        else if (curr.type === 5) session.cachedKeyframe = nalSlice;
      } else {
        const tail = processableBuf.slice(curr.index);
        if (curr.type === 7 || curr.type === 8 || curr.type === 5) {
          session._accumulatingNalType = curr.type;
          session._accumulatingChunks = [tail];
          session._accumulatedLength = tail.length;
          if (curr.type === 7 && tail.length >= 10) session.cachedSps = tail;
          if (curr.type === 8 && tail.length >= 4) session.cachedPps = tail;
        } else {
          session._accumulatingNalType = -1;
          session._accumulatingChunks = [];
          session._accumulatedLength = 0;
        }
      }
    }
  }

  /**
   * Broadcast binary H.264 video chunk to WebSocket subscribers
   */
  _broadcastVideoChunk(session, chunk) {
    if (!session || !session.subscribers) return;

    for (const ws of session.subscribers) {
      if (ws.readyState === 1 /* OPEN */) {
        // Backpressure guard: if client socket buffer has accumulated > 2MB,
        // client socket is critically congested (e.g. background tab or network stall).
        // Disconnect congested socket so client can cleanly reconnect fresh
        // without ballooning Node heap or buffering stale seconds of backlog.
        if (ws.bufferedAmount > 2097152) {
          logger.warn(`[ScreenMirror] Subscriber socket buffer overflow (${ws.bufferedAmount} bytes). Disconnecting congested client.`);
          try {
            ws.send(JSON.stringify({ type: 'MIRROR_ERROR', error: 'Network congestion: client buffer overflow' }));
            ws.close(1008, 'Buffer overflow');
          } catch (e) {}
          session.subscribers.delete(ws);
          continue;
        }

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
      const alreadySubscribed = session.subscribers.has(ws);
      session.subscribers.add(ws);
      ws.subscribedSerial = serial;

      if (!alreadySubscribed) {
        logger.info(`[ScreenMirror] Client subscribed to device ${serial} (total subscribers: ${session.subscribers.size})`);

        ws.send(JSON.stringify({
          type: 'MIRROR_STARTED',
          serial,
          resolution: session.stats.resolution,
          bitrateKbps: session.stats.bitrateKbps,
          fps: session.stats.fps || 30
        }));

        // Immediately send cached SPS/PPS/Keyframe initialization chunks to ensure decoder starts without delay
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

    if (session.inputProc) {
      try {
        session.inputProc.stdin?.end();
        session.inputProc.stdout?.removeAllListeners();
        session.inputProc.stderr?.removeAllListeners();
        session.inputProc.removeAllListeners();
        session.inputProc.kill('SIGTERM');
      } catch (e) {}
      session.inputProc = null;
    }
    session.inputQueue = [];

    session.cachedSps = null;
    session.cachedPps = null;
    session.cachedKeyframe = null;
    session._accumulatingNalType = -1;
    session._accumulatingChunks = [];
    session._accumulatedLength = 0;
    session._pendingStartCodeBytes = null;

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
   * Spawn a dedicated, persistent ADB interactive shell for the mirror session
   * to eliminate process-spawn latency (~200ms) on touch and gesture injection.
   */
  _initInputProc(session) {
    if (session.isStopping || session.inputProc) return;
    const { serial } = session;
    try {
      const inputProc = spawn(config.ADB_PATH, ['-s', serial, 'shell'], { windowsHide: true });
      session.inputProc = inputProc;
      session.inputQueue = [];
      session.isProcessingInputQueue = false;

      inputProc.stdout.on('data', () => {});
      inputProc.stderr.on('data', (data) => {
        const err = data.toString().trim();
        if (err) logger.debug(`[ScreenMirror Input Stderr ${serial}]: ${err}`);
      });
      inputProc.on('close', () => {
        session.inputProc = null;
      });
      inputProc.on('error', (err) => {
        logger.warn(`[ScreenMirror Input Error ${serial}]: ${err.message}`);
        session.inputProc = null;
      });
    } catch (err) {
      logger.warn(`[ScreenMirror] Failed to spawn persistent input shell for ${serial}: ${err.message}`);
      session.inputProc = null;
    }
  }

  /**
   * Drain sequential input commands to ensure strictly ordered, non-interleaved delivery
   */
  _drainInputQueue(session) {
    if (session.isProcessingInputQueue || !session.inputQueue || session.inputQueue.length === 0) return;
    session.isProcessingInputQueue = true;

    const item = session.inputQueue.shift();
    if (!item) {
      session.isProcessingInputQueue = false;
      return;
    }

    const { cmd, resolve, reject, type, event } = item;
    try {
      if (session.inputProc && !session.inputProc.killed && session.inputProc.stdin && session.inputProc.stdin.writable) {
        session.inputProc.stdin.write(`${cmd}\n`, (err) => {
          session.isProcessingInputQueue = false;
          if (err) {
            // Safe fallback to adbService.execute on pipe write failure
            const parts = ['-s', session.serial, 'shell', ...cmd.split(' ')];
            adbService.execute(parts).then(() => resolve({ success: true, type, ...event })).catch(reject);
          } else {
            resolve({ success: true, type, ...event });
          }
          if (session.inputQueue.length > 0) {
            setImmediate(() => this._drainInputQueue(session));
          }
        });
      } else {
        session.isProcessingInputQueue = false;
        const parts = ['-s', session.serial, 'shell', ...cmd.split(' ')];
        adbService.execute(parts).then(() => resolve({ success: true, type, ...event })).catch(reject);
        if (session.inputQueue.length > 0) {
          setImmediate(() => this._drainInputQueue(session));
        }
      }
    } catch (err) {
      session.isProcessingInputQueue = false;
      const parts = ['-s', session.serial, 'shell', ...cmd.split(' ')];
      adbService.execute(parts).then(() => resolve({ success: true, type, ...event })).catch(reject);
      if (session.inputQueue.length > 0) {
        setImmediate(() => this._drainInputQueue(session));
      }
    }
  }

  /**
   * Send touch or key input event to device with sub-5ms persistent shell injection and fallback
   */
  async sendInput(serial, user, event = {}) {
    if (!serial) throw new Error('Device serial is required');
    if (!deviceLockService.isDeviceAccessible(serial, user)) {
      throw new Error(`Device ${serial} is not accessible`);
    }

    const { type, x, y, endX, endY, durationMs, keycode } = event;
    let cmd = null;

    if (type === 'tap') {
      if (typeof x !== 'number' || typeof y !== 'number') throw new Error('Valid X and Y coordinates required for tap');
      cmd = `input tap ${Math.round(x)} ${Math.round(y)}`;
    } else if (type === 'swipe') {
      if (typeof x !== 'number' || typeof y !== 'number' || typeof endX !== 'number' || typeof endY !== 'number') {
        throw new Error('Valid start and end coordinates required for swipe');
      }
      const dur = durationMs || 300;
      cmd = `input swipe ${Math.round(x)} ${Math.round(y)} ${Math.round(endX)} ${Math.round(endY)} ${dur}`;
    } else if (type === 'keyevent') {
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

      cmd = `input keyevent ${targetKey}`;
    } else if (type === 'text') {
      const text = String(event.text || '').replace(/[^a-zA-Z0-9._-]/g, '');
      if (text) {
        cmd = `input text ${text}`;
      } else {
        return { success: true, type: 'text' };
      }
    } else {
      throw new Error(`Unsupported input event type: ${type}`);
    }

    const session = this.activeSessions.get(serial);
    if (session && session.inputProc && !session.inputProc.killed && session.inputProc.stdin && session.inputProc.stdin.writable) {
      return new Promise((resolve, reject) => {
        session.inputQueue.push({ cmd, resolve, reject, type, event });
        this._drainInputQueue(session);
      });
    }

    // Direct fallback if mirror session or inputProc is not running
    const parts = ['-s', serial, 'shell', ...cmd.split(' ')];
    await adbService.execute(parts);
    return { success: true, type, ...event };
  }

  /**
   * Cleanup all sessions on server shutdown
   */
  cleanupAll() {
    for (const [serial, session] of this.activeSessions.entries()) {
      try {
        session.isStopping = true;
        if (session.proc) session.proc.kill('SIGKILL');
        if (session.inputProc) session.inputProc.kill('SIGTERM');
      } catch (e) {}
    }
    this.activeSessions.clear();
    logger.info('[ScreenMirror] All screen mirror processes cleaned up.');
  }
}

module.exports = new ScreenMirrorService();
