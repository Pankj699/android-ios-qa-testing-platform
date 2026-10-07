const { spawn } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const http = require('http');
const config = require('../config');
const logger = require('../utils/logger');
const deviceLockService = require('./deviceLockService');

class IosMirrorService {
  constructor() {
    this.pythonPath = config.PYTHON_PATH;
    this.sessions = new Map(); // udid -> { udid, port, process, user, startedAt, clients: Set() }
    this.screenshotsDir = path.join(config.DATA_DIR, 'screenshots');
    this._ensureDirectories();
  }

  _ensureDirectories() {
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  /**
   * Find an available local port for the internal serve-web process.
   */
  async _findAvailablePort(startPort = 19100) {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', (err) => reject(err));
    });
  }

  /**
   * Wait for a local TCP port to start accepting connections.
   */
  async _waitForPort(port, host = '127.0.0.1', timeoutMs = 8000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      const isListening = await new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(500);
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => {
          socket.destroy();
          resolve(false);
        });
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(port, host);
      });

      if (isListening) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  }

  /**
   * Start iOS Screen Mirror session.
   */
  async startMirror(udid, user, options = {}) {
    if (!udid) {
      throw new Error('Device UDID is required.');
    }

    if (!deviceLockService.isDeviceAccessible(udid, user)) {
      throw new Error('Device is currently claimed by another user.');
    }

    // Check if mirror is already running
    if (this.sessions.has(udid)) {
      const existing = this.sessions.get(udid);
      return {
        success: true,
        message: 'iOS Screen mirror already active',
        udid,
        port: existing.port,
        streamUrl: `/api/device/${encodeURIComponent(udid)}/mirror/stream/`,
        startedAt: existing.startedAt
      };
    }

    const port = await this._findAvailablePort();
    logger.info(`[iOS Mirror] Starting iOS stream server for ${udid} on 127.0.0.1:${port}...`);

    const serverScript = path.join(__dirname, 'ios_stream_server.py');
    const quality = options.quality || '720p';
    const args = [
      serverScript,
      '--udid', udid,
      '--port', port.toString(),
      '--host', '127.0.0.1',
      '--quality', quality
    ];

    const child = spawn(this.pythonPath, args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stderrBuffer = '';
    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderrBuffer += text;
      logger.debug(`[iOS Mirror serve-web ${udid}] ${text.trim()}`);
    });

    child.stdout.on('data', (d) => {
      logger.debug(`[iOS Mirror serve-web ${udid}] ${d.toString().trim()}`);
    });

    child.on('close', (code) => {
      logger.info(`[iOS Mirror] serve-web for ${udid} exited with code ${code}`);
      this.sessions.delete(udid);
    });

    child.on('error', (err) => {
      logger.error(`[iOS Mirror] Error spawning serve-web for ${udid}: ${err.message}`);
      this.sessions.delete(udid);
    });

    // Wait for port to become active
    const ready = await this._waitForPort(port, '127.0.0.1', 8000);
    if (!ready && child.exitCode !== null) {
      try { child.kill('SIGTERM'); } catch (e) {}
      throw new Error(`Failed to start iOS mirror: ${stderrBuffer.trim() || 'Process exited prematurely'}`);
    }

    const session = {
      udid,
      port,
      process: child,
      user: user ? { id: user.id, name: user.name } : null,
      startedAt: new Date().toISOString(),
      clients: new Set()
    };

    this.sessions.set(udid, session);

    return {
      success: true,
      message: 'iOS Screen mirror session started',
      udid,
      port,
      streamUrl: `/api/device/${encodeURIComponent(udid)}/mirror/stream/`,
      startedAt: session.startedAt
    };
  }

  /**
   * Stop iOS Screen Mirror session.
   */
  stopMirror(udid, user) {
    if (!this.sessions.has(udid)) {
      return { success: true, message: 'No active iOS mirror session found.' };
    }

    const session = this.sessions.get(udid);
    if (user && session.user && session.user.id !== user.id && (user.role || '').toLowerCase() !== 'admin') {
      throw new Error('Cannot stop mirror session started by another user.');
    }

    try {
      if (session.process && !session.process.killed) {
        session.process.kill('SIGTERM');
        // Force kill if not exited after 1 second
        setTimeout(() => {
          try {
            if (!session.process.killed) session.process.kill('SIGKILL');
          } catch (e) {}
        }, 1000);
      }
    } catch (e) {
      logger.warn(`[iOS Mirror] Error terminating session process: ${e.message}`);
    }

    this.sessions.delete(udid);
    return { success: true, message: `iOS mirror session for ${udid} stopped.` };
  }

  /**
   * Get mirror status.
   */
  getMirrorStatus(udid) {
    if (this.sessions.has(udid)) {
      const session = this.sessions.get(udid);
      return {
        active: true,
        udid,
        port: session.port,
        startedAt: session.startedAt,
        user: session.user,
        streamUrl: `/api/device/${encodeURIComponent(udid)}/mirror/stream/`
      };
    }
    return { active: false, udid };
  }

  /**
   * Proxy authenticated HTTP requests to the internal iOS serve-web instance.
   */
  proxyStreamRequest(udid, req, res) {
    const session = this.sessions.get(udid);
    if (!session) {
      return res.status(404).send('iOS mirror session not active.');
    }

    // Determine target sub-path
    const urlToMatch = req.originalUrl || req.url;
    const streamIndex = urlToMatch.indexOf('/mirror/stream');
    let subPath = '/';
    if (streamIndex !== -1) {
      subPath = urlToMatch.slice(streamIndex + '/mirror/stream'.length);
      if (!subPath || subPath === '') subPath = '/';
    }
    const [pathOnly, queryString] = subPath.split('?');
    const cleanSubpath = pathOnly || '/';
    const forwardPath = (cleanSubpath === '/' ? '/' : cleanSubpath) + (queryString ? '?' + queryString : '');

    const options = {
      hostname: '127.0.0.1',
      port: session.port,
      path: forwardPath,
      method: req.method,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${session.port}`,
        accept: req.headers.accept || '*/*'
      }
    };

    // For HTML viewer root: rewrite paths and inject base + styles
    if (cleanSubpath === '/' || cleanSubpath === '/index.html') {
      const proxyReq = http.request(options, (proxyRes) => {
        let body = '';
        proxyRes.setEncoding('utf8');
        proxyRes.on('data', (chunk) => { body += chunk; });
        proxyRes.on('end', () => {
          const baseTag = `<base href="/api/device/${encodeURIComponent(udid)}/mirror/stream/">`;
          const styleTag = `<style>
  #topbar, #left-tray, #right-tray, #bottom-row { display: none !important; }
  body { background: #000 !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; width: 100% !important; height: 100% !important; }
  #workspace { padding: 0 !important; margin: 0 !important; height: 100vh !important; width: 100vw !important; display: flex !important; align-items: center !important; justify-content: center !important; }
  #stage-wrap { padding: 0 !important; margin: 0 !important; width: 100% !important; height: 100% !important; display: flex !important; align-items: center !important; justify-content: center !important; }
  #stage { padding: 0 !important; margin: 0 !important; width: 100% !important; height: 100% !important; display: flex !important; align-items: center !important; justify-content: center !important; }
  #device-frame { border: none !important; box-shadow: none !important; background: transparent !important; margin: 0 !important; padding: 0 !important; }
  #device-frame .hw { display: none !important; }
  canvas#c { max-width: 100% !important; max-height: 100% !important; object-fit: contain !important; }
</style>`;
          let modified = body.replace(/href="\//g, 'href="./');
          modified = modified.replace(/src="\//g, 'src="./');
          modified = modified.replace('<head>', `<head>${baseTag}${styleTag}`);
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Length': Buffer.byteLength(modified)
          });
          res.end(modified);
        });
      });
      proxyReq.on('error', (err) => {
        logger.debug(`[iOS Mirror Proxy] Request error: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Error proxying iOS stream');
      });
      return req.pipe(proxyReq);
    }

    // For viewer.js: rewrite root paths to relative paths
    if (cleanSubpath === '/viewer.js') {
      const proxyReq = http.request(options, (proxyRes) => {
        let body = '';
        proxyRes.setEncoding('utf8');
        proxyRes.on('data', (chunk) => { body += chunk; });
        proxyRes.on('end', () => {
          const modified = body.replace(/['"]\/([a-zA-Z0-9_\-\.\?=\/]+)['"]/g, (match, p1) => `'./${p1}'`);
          res.writeHead(proxyRes.statusCode, {
            'Content-Type': 'application/javascript; charset=utf-8',
            'Content-Length': Buffer.byteLength(modified)
          });
          res.end(modified);
        });
      });
      proxyReq.on('error', (err) => {
        logger.debug(`[iOS Mirror Proxy] Request error: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Error proxying iOS stream');
      });
      return req.pipe(proxyReq);
    }

    // For binary stream (/stream.bin), /codec, and other assets/commands: direct streaming proxy
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      logger.debug(`[iOS Mirror Proxy] Request error: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).send('Error proxying iOS stream');
      }
    });

    req.pipe(proxyReq);
  }

  /**
   * Capture a screenshot from iOS device.
   */
  async captureScreenshot(udid, user) {
    if (!deviceLockService.isDeviceAccessible(udid, user)) {
      throw new Error('Device is currently claimed by another user.');
    }

    const timestamp = Date.now();
    const filename = `screenshot_${udid.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.png`;
    const outputPath = path.join(this.screenshotsDir, filename);

    const iosService = require('./iosService');
    const deviceInfo = await iosService.getDeviceInfo(udid).catch(() => ({}));

    // If an active stream server is running for this device, grab the instant latest frame
    if (this.sessions.has(udid)) {
      const session = this.sessions.get(udid);
      return new Promise((resolve, reject) => {
        const frameReq = http.get(`http://127.0.0.1:${session.port}/frame`, (frameRes) => {
          if (frameRes.statusCode !== 200) {
            return reject(new Error(`Failed to capture frame from stream server: status ${frameRes.statusCode}`));
          }
          const chunks = [];
          frameRes.on('data', (c) => chunks.push(c));
          frameRes.on('end', () => {
            const imgBuffer = Buffer.concat(chunks);
            fs.writeFileSync(outputPath, imgBuffer);
            resolve({
              success: true,
              filename,
              filePath: outputPath,
              url: `/api/device/${encodeURIComponent(udid)}/screenshot/${filename}`,
              sizeBytes: imgBuffer.length,
              timestamp: new Date().toISOString(),
              device: {
                serial: udid,
                name: deviceInfo.name || 'iPhone',
                model: deviceInfo.model || 'iPhone',
                iosVersion: deviceInfo.iosVersion || 'iOS',
                screenResolution: deviceInfo.screenResolution || '1170 × 2532',
                platform: 'ios'
              },
              previewBase64: `data:image/jpeg;base64,${imgBuffer.toString('base64')}`
            });
          });
        });

        frameReq.on('error', (err) => {
          logger.warn(`[iOS Screenshot] Error reading frame from stream server: ${err.message}`);
          // Fallback to subprocess if stream server request fails
          this._captureScreenshotViaCli(udid, outputPath, filename, deviceInfo)
            .then(resolve)
            .catch(reject);
        });

        frameReq.setTimeout(4000, () => {
          frameReq.destroy(new Error('Timed out fetching frame from stream server'));
        });
      });
    }

    return this._captureScreenshotViaCli(udid, outputPath, filename, deviceInfo);
  }

  /**
   * Fallback CLI screenshot when mirror session is not active.
   */
  async _captureScreenshotViaCli(udid, outputPath, filename, deviceInfo) {
    return new Promise((resolve, reject) => {
      // Use pymobiledevice3 developer dvt screenshot API
      const args = [
        '-m', 'pymobiledevice3',
        'developer', 'dvt', 'screenshot',
        outputPath,
        '--userspace',
        '--udid', udid
      ];

      const proc = spawn(this.pythonPath, args, {
        timeout: 10000,
        windowsHide: true
      });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code === 0 && fs.existsSync(outputPath)) {
          const pngBuffer = fs.readFileSync(outputPath);
          resolve({
            success: true,
            filename,
            filePath: outputPath,
            url: `/api/device/${encodeURIComponent(udid)}/screenshot/${filename}`,
            sizeBytes: pngBuffer.length,
            timestamp: new Date().toISOString(),
            device: {
              serial: udid,
              name: deviceInfo.name || 'iPhone',
              model: deviceInfo.model || 'iPhone',
              iosVersion: deviceInfo.iosVersion || 'iOS',
              screenResolution: deviceInfo.screenResolution || '1170 × 2532',
              platform: 'ios'
            },
            previewBase64: `data:image/png;base64,${pngBuffer.toString('base64')}`
          });
        } else {
          logger.warn(`[iOS Screenshot] Command exited with code ${code}: ${stderr}`);
          reject(new Error(`Screenshot failed: ${stderr.trim() || 'Device unavailable'}`));
        }
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }
}

module.exports = new IosMirrorService();
