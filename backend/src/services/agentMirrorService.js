const http = require('http');
const crypto = require('crypto');
const logger = require('../utils/logger');
const deviceLockService = require('./deviceLockService');
const agentService = require('./agentService');

class AgentMirrorService {
  constructor() {
    this.sessions = new Map(); // udid -> { udid, sessionId, sessionToken, agentId, userId, port, streamUrl, viewerUrl, resolution, startedAt }
    this.streamTokens = new Map(); // token -> { udid, userId, agentId, expiresAt }
    this.pendingRequests = new Map(); // requestId -> { resolve, reject, timeoutId, ... }
  }

  /**
   * Start mirror session on an Agent-connected physical iOS device.
   */
  async startMirror(deviceId, user, options = {}) {
    if (!deviceId) {
      throw new Error('Device UDID is required.');
    }

    if (!deviceLockService.isDeviceAccessible(deviceId, user)) {
      throw new Error('Device is currently claimed by another user.');
    }

    const device = agentService.getAgentDevice(deviceId, user);
    if (!device) {
      throw new Error('Agent iOS device not found or unauthorized.');
    }

    const agentId = device.agentId;
    const ws = agentService.activeSockets.get(agentId);
    if (!ws || ws.readyState !== 1) {
      const err = new Error('QA Device Agent is offline.');
      err.code = 'AGENT_OFFLINE';
      throw err;
    }

    // Check if mirror is already active for this device
    if (this.sessions.has(deviceId)) {
      const existing = this.sessions.get(deviceId);
      return {
        success: true,
        message: 'iOS Screen mirror already active',
        udid: deviceId,
        port: existing.port,
        streamUrl: `/api/device/${encodeURIComponent(deviceId)}/mirror/stream?token=${existing.sessionToken}`,
        sessionToken: existing.sessionToken,
        resolution: existing.resolution,
        startedAt: existing.startedAt,
        reused: true
      };
    }

    const sessionToken = crypto.randomBytes(24).toString('hex');
    const sessionId = 'ios_mir_' + crypto.randomBytes(8).toString('hex');
    const requestId = 'mir_start_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
    const quality = options.quality || '720p';

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          const err = new Error('Starting iOS mirror on agent timed out.');
          err.code = 'MIRROR_START_TIMEOUT';
          reject(err);
        }
      }, 15000);

      this.pendingRequests.set(requestId, {
        resolve: (data) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);

          if (!data.success) {
            return reject(new Error(data.error || 'Failed to start screen mirror on agent.'));
          }

          const port = data.port || 19200;
          const session = {
            udid: deviceId,
            sessionId,
            sessionToken,
            agentId,
            userId: user ? user.id : 'unknown',
            port,
            streamUrl: data.streamUrl || `http://127.0.0.1:${port}/stream.bin`,
            viewerUrl: data.viewerUrl || `http://127.0.0.1:${port}/`,
            resolution: data.resolution || '1170x2532',
            startedAt: new Date().toISOString()
          };

          this.sessions.set(deviceId, session);
          this.streamTokens.set(sessionToken, {
            udid: deviceId,
            userId: user ? user.id : 'unknown',
            agentId,
            expiresAt: Date.now() + 15 * 60 * 1000 // 15 mins
          });

          logger.info(`[AgentMirrorService] Started mirror session ${sessionId} for device ${deviceId} on agent ${agentId} (port ${port})`);

          resolve({
            success: true,
            message: 'iOS Screen mirror active',
            udid: deviceId,
            port,
            streamUrl: `/api/device/${encodeURIComponent(deviceId)}/mirror/stream?token=${sessionToken}`,
            sessionToken,
            resolution: session.resolution,
            startedAt: session.startedAt,
            reused: false
          });
        },
        reject: (err) => {
          clearTimeout(timeoutId);
          this.pendingRequests.delete(requestId);
          reject(err);
        },
        timeoutId
      });

      const payload = {
        type: 'START_MIRROR_REQUEST',
        requestId,
        deviceId,
        quality
      };

      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        reject(err);
      }
    });
  }

  /**
   * Stop mirror session on an Agent-connected physical iOS device.
   */
  async stopMirror(deviceId, user) {
    if (!deviceId) {
      throw new Error('Device UDID is required.');
    }

    if (!deviceLockService.isDeviceAccessible(deviceId, user)) {
      throw new Error('Device is currently claimed by another user.');
    }

    const session = this.sessions.get(deviceId);
    if (!session) {
      return { success: true, message: 'No active mirror session to stop.', udid: deviceId };
    }

    const agentId = session.agentId;
    const ws = agentService.activeSockets.get(agentId);
    const requestId = 'mir_stop_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');

    // Remove session & token locally
    this.sessions.delete(deviceId);
    this.streamTokens.delete(session.sessionToken);

    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({
          type: 'STOP_MIRROR_REQUEST',
          requestId,
          deviceId
        }));
      } catch (e) {
        logger.warn(`[AgentMirrorService] Error dispatching STOP_MIRROR_REQUEST to agent ${agentId}: ${e.message}`);
      }
    }

    logger.info(`[AgentMirrorService] Stopped mirror session for device ${deviceId}`);
    return { success: true, message: `Mirror for ${deviceId} stopped.`, udid: deviceId };
  }

  /**
   * Returns mirror status for an Agent device.
   */
  getMirrorStatus(deviceId) {
    const session = this.sessions.get(deviceId);
    if (!session) {
      return { active: false, udid: deviceId };
    }

    return {
      active: true,
      udid: deviceId,
      port: session.port,
      resolution: session.resolution,
      startedAt: session.startedAt,
      sessionToken: session.sessionToken
    };
  }

  /**
   * Validates stream authorization token.
   */
  verifyStreamToken(deviceId, token) {
    if (!token) return false;
    const tokenInfo = this.streamTokens.get(token);
    if (!tokenInfo) return false;
    if (tokenInfo.udid !== deviceId) return false;
    if (Date.now() > tokenInfo.expiresAt) {
      this.streamTokens.delete(token);
      return false;
    }
    return true;
  }

  /**
   * Proxies stream requests to the agent loopback HTTP server.
   */
  proxyStreamRequest(deviceId, req, res) {
    const session = this.sessions.get(deviceId);
    if (!session) {
      return res.status(404).send('Mirror session is not active for this device.');
    }

    const token = req.query.token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
    if (!this.verifyStreamToken(deviceId, token) && !deviceLockService.isDeviceAccessible(deviceId, req.user)) {
      return res.status(403).send('Unauthorized stream access.');
    }

    // Determine subpath
    const urlToMatch = req.originalUrl || req.url;
    const streamIndex = urlToMatch.indexOf('/mirror/stream');
    let subPath = '/';
    if (streamIndex !== -1) {
      subPath = urlToMatch.slice(streamIndex + '/mirror/stream'.length);
      if (!subPath || subPath === '') subPath = '/';
    }
    const [pathOnly, queryString] = subPath.split('?');
    const cleanSubpath = pathOnly || '/';

    const agent = agentService.agents.get(session.agentId);
    const agentHost = (agent && agent.remoteIp) ? agent.remoteIp : '127.0.0.1';

    const forwardPath = (cleanSubpath === '/' ? '/' : cleanSubpath) + (queryString ? '?' + queryString : '');

    const options = {
      hostname: agentHost,
      port: session.port,
      path: forwardPath,
      method: req.method,
      headers: { ...req.headers, host: `${agentHost}:${session.port}` }
    };

    // For HTML viewer root: rewrite paths and inject base + styles
    if (cleanSubpath === '/' || cleanSubpath === '/index.html') {
      const proxyReq = http.request(options, (proxyRes) => {
        let body = '';
        proxyRes.setEncoding('utf8');
        proxyRes.on('data', (chunk) => { body += chunk; });
        proxyRes.on('end', () => {
          const baseTag = `<base href="/api/device/${encodeURIComponent(deviceId)}/mirror/stream/">`;
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
        logger.error(`[AgentMirrorService] Proxy error for ${deviceId}: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Error communicating with agent stream server.');
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
        logger.error(`[AgentMirrorService] Proxy error for ${deviceId}: ${err.message}`);
        if (!res.headersSent) res.status(502).send('Error communicating with agent stream server.');
      });
      return req.pipe(proxyReq);
    }

    // For binary stream (/stream.bin), /codec, and other assets/commands: direct streaming proxy
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });

    proxyReq.on('error', (err) => {
      logger.error(`[AgentMirrorService] Proxy error for ${deviceId}: ${err.message}`);
      if (!res.headersSent) {
        res.status(502).send('Error communicating with agent stream server.');
      }
    });

    req.pipe(proxyReq);
  }

  /**
   * Handles incoming agent mirror responses from WebSocket.
   */
  handleAgentMirrorResponse(agentId, data = {}) {
    const requestId = data.requestId;
    if (!requestId) return false;

    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      pending.resolve(data);
      return true;
    }
    return false;
  }

  /**
   * Cleanup all sessions for a disconnected agent.
   */
  handleAgentDisconnect(agentId) {
    for (const [udid, session] of this.sessions.entries()) {
      if (session.agentId === agentId) {
        this.streamTokens.delete(session.sessionToken);
        this.sessions.delete(udid);
        logger.info(`[AgentMirrorService] Cleaned mirror session for ${udid} due to agent ${agentId} disconnect`);
      }
    }
  }
}

module.exports = new AgentMirrorService();
