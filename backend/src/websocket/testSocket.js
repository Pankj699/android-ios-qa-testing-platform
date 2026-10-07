const { WebSocketServer } = require('ws');
const logger = require('../utils/logger');
const testRunnerService = require('../services/testRunnerService');
const screenMirrorService = require('../services/screenMirrorService');
const iosService = require('../services/iosService');
const iosMirrorService = require('../services/iosMirrorService');
const agentService = require('../services/agentService');
const agentMirrorService = require('../services/agentMirrorService');
const adbService = require('../services/adbService');
const deviceLockService = require('../services/deviceLockService');
const { verifySocketToken } = require('../middleware/auth');
const config = require('../config');

const { setupAgentWebSocket } = require('./agentSocket');

function sanitizeSensitiveData(text) {
  if (!text || typeof text !== 'string') return text;
  return text
    .replace(/(authorization\s*:\s*(?:Bearer|Basic)\s+)[^\s\r\n]+/gi, '$1[MASKED]')
    .replace(/(bearer\s+)[a-zA-Z0-9_\-\.]{15,}/gi, '$1[MASKED]')
    .replace(/(basic\s+)[a-zA-Z0-9+/=]{10,}/gi, '$1[MASKED]')
    .replace(/("?(?:password|access_token|accessToken|refresh_token|refreshToken|secret|client_secret|apiKey|api_key|sessionToken|cookie|set-cookie|token|jwt|creditCard|cvv|auth)"?\s*:\s*)"([^"]*)"/gi, '$1"********"')
    .replace(/((?:password|access_token|accessToken|refresh_token|refreshToken|secret|client_secret|apiKey|api_key|sessionToken|cookie|token|jwt)=)[^&\s\r\n]+/gi, '$1********');
}

let globalWss = null;

function setupWebSocket(server) {
  const clientWss = new WebSocketServer({ noServer: true });
  const agentWss = setupAgentWebSocket(server);
  globalWss = clientWss;

  server.on('upgrade', (request, socket, head) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
      const pathname = url.pathname;

      if (pathname === '/ws/agent' || pathname.startsWith('/ws/agent/')) {
        agentWss.handleUpgrade(request, socket, head, (ws) => {
          agentWss.emit('connection', ws, request);
        });
      } else if (pathname === '/ws' || pathname.startsWith('/ws/')) {
        clientWss.handleUpgrade(request, socket, head, (ws) => {
          clientWss.emit('connection', ws, request);
        });
      } else {
        socket.destroy();
      }
    } catch (e) {
      socket.destroy();
    }
  });

  clientWss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const testId = url.searchParams.get('testId');
    const mirrorSerial = url.searchParams.get('mirrorSerial') || url.searchParams.get('serial');
    const token = url.searchParams.get('token');

    const user = verifySocketToken(token, req);
    if (!user && config.AUTH_ENABLED) {
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized. Valid token required.' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    ws.user = user || { id: 'default_user', name: 'QA Tester', role: 'admin' };
    logger.debug(`[WS] Client connected for ${ws.user.name}. Test ID: ${testId || 'general'}, Mirror: ${mirrorSerial || 'none'}`);

    if (testId) {
      testRunnerService.subscribe(testId, ws, ws.user);
    }

    if (mirrorSerial) {
      if (!iosService.isIosDevice(mirrorSerial)) {
        screenMirrorService.subscribeClient(mirrorSerial, ws, ws.user);
      }
    }

    // Helper to stop logcat streaming and PID tracking
    const cleanupLogcat = () => {
      if (ws.pidWatchInterval) {
        clearInterval(ws.pidWatchInterval);
        ws.pidWatchInterval = null;
      }
      if (ws.deviceLogcatProc) {
        try { ws.deviceLogcatProc.kill('SIGKILL'); } catch (e) {}
        ws.deviceLogcatProc = null;
      }
      ws.deviceLogcatSerial = null;
      ws.currentAppPid = null;
      ws.targetPackage = null;
    };

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());

        // Test runner actions
        if (data.action === 'SUBSCRIBE' && data.testId) {
          const authorized = testRunnerService.subscribe(data.testId, ws, ws.user);
          if (authorized) {
            ws.send(JSON.stringify({ type: 'SUBSCRIBED', testId: data.testId }));
          }
        } else if (data.action === 'UNSUBSCRIBE' && data.testId) {
          testRunnerService.unsubscribe(data.testId, ws);
        }

        // Screen Mirror actions
        else if (data.action === 'MIRROR_START' && data.serial) {
          try {
            if (agentService.isAgentIosDevice(data.serial)) {
              const res = await agentMirrorService.startMirror(data.serial, ws.user, data.options || {});
              ws.send(JSON.stringify({
                type: 'MIRROR_STARTED',
                serial: data.serial,
                platform: 'ios',
                streamUrl: res.streamUrl,
                sessionToken: res.sessionToken,
                port: res.port
              }));
            } else if (iosService.isIosDevice(data.serial)) {
              const res = await iosMirrorService.startMirror(data.serial, ws.user, data.options || {});
              ws.send(JSON.stringify({
                type: 'MIRROR_STARTED',
                serial: data.serial,
                platform: 'ios',
                streamUrl: res.streamUrl,
                port: res.port
              }));
            } else {
              await screenMirrorService.startMirror(data.serial, ws.user, data.options || {});
              screenMirrorService.subscribeClient(data.serial, ws, ws.user);
            }
          } catch (err) {
            ws.send(JSON.stringify({ type: 'MIRROR_ERROR', error: err.message, serial: data.serial }));
          }
        } else if (data.action === 'MIRROR_STOP' && data.serial) {
          try {
            if (agentService.isAgentIosDevice(data.serial)) {
              await agentMirrorService.stopMirror(data.serial, ws.user);
              ws.send(JSON.stringify({ type: 'MIRROR_STOPPED', serial: data.serial }));
            } else if (iosService.isIosDevice(data.serial)) {
              iosMirrorService.stopMirror(data.serial, ws.user);
              ws.send(JSON.stringify({ type: 'MIRROR_STOPPED', serial: data.serial }));
            } else {
              screenMirrorService.unsubscribeClient(data.serial, ws);
              screenMirrorService.stopMirror(data.serial, ws.user);
            }
          } catch (err) {
            ws.send(JSON.stringify({ type: 'MIRROR_ERROR', error: err.message, serial: data.serial }));
          }
        } else if (data.action === 'MIRROR_INPUT' && data.serial && data.input) {
          if (!iosService.isIosDevice(data.serial)) {
            await screenMirrorService.sendInput(data.serial, ws.user, data.input).catch(err => {
              ws.send(JSON.stringify({ type: 'MIRROR_INPUT_ERROR', error: err.message }));
            });
          }
        } else if (data.action === 'MIRROR_PING') {
          ws.send(JSON.stringify({
            type: 'MIRROR_PONG',
            clientTimestamp: data.timestamp,
            serverTimestamp: Date.now()
          }));
        }

        // Device Logcat streaming actions with PID-scoped isolation & dynamic PID tracking
        else if (data.action === 'DEVICE_LOGCAT_START' && data.serial) {
          try {
            if (!deviceLockService.isDeviceAccessible(data.serial, ws.user)) {
              ws.send(JSON.stringify({ type: 'ERROR', message: `Device ${data.serial} is not accessible to your account.` }));
              return;
            }

            cleanupLogcat();

            // Enable verbose Volley and OkHttp tags on target device
            adbService.runSafeAdbCommand(data.serial, 'adb shell setprop log.tag.Volley VERBOSE').catch(() => {});
            adbService.runSafeAdbCommand(data.serial, 'adb shell setprop log.tag.OkHttp VERBOSE').catch(() => {});

            ws.deviceLogcatSerial = data.serial;
            const targetPkg = data.packageName || '';
            ws.targetPackage = targetPkg || null;

            const attachLogcatStream = (pid) => {
              if (ws.deviceLogcatProc) {
                try { ws.deviceLogcatProc.kill('SIGKILL'); } catch (e) {}
                ws.deviceLogcatProc = null;
              }

              // Strict PID scoping: if targetPkg is specified, NEVER fallback to device-wide logcat!
              if (targetPkg && !pid) {
                return;
              }

              const proc = pid
                ? adbService.streamPidLogcat(data.serial, pid)
                : adbService.streamLogcat(data.serial);

              ws.deviceLogcatProc = proc;

              let logBuffer = '';
              proc.stdout.on('data', (chunk) => {
                logBuffer += chunk.toString();
                const lines = logBuffer.split('\n');
                logBuffer = lines.pop();

                for (const line of lines) {
                  const trimmed = line.trim();
                  if (!trimmed) continue;

                  // When PID-scoped, all logs from stdout are generated by the target application
                  const isPidScoped = !!pid;
                  const isRel = isPidScoped || (
                    !targetPkg && (
                      trimmed.includes('Volley') ||
                      trimmed.includes('VOLLEY_HTTP_TRANSACTION') ||
                      trimmed.includes('API_TRANSACTION') ||
                      trimmed.includes('NetworkUtility') ||
                      trimmed.includes('BasicNetwork') ||
                      trimmed.includes('GsonRequest') ||
                      trimmed.includes('PhotoMultipartRequest') ||
                      trimmed.includes('AIToolsHelper') ||
                      trimmed.includes('AIImageGeneratorHelper') ||
                      trimmed.includes('GetAndroidCreditsSync') ||
                      trimmed.includes('SessionManager') ||
                      trimmed.includes('TOKEN:') ||
                      trimmed.includes('onResponse') ||
                      trimmed.includes('callApiFor') ||
                      trimmed.includes('OkHttp') ||
                      trimmed.includes('Retrofit') ||
                      trimmed.includes('API_TO_CALL') ||
                      trimmed.includes('API_URL') ||
                      trimmed.includes('--> POST') ||
                      trimmed.includes('--> GET') ||
                      trimmed.includes('--> PUT') ||
                      trimmed.includes('--> DELETE') ||
                      trimmed.includes('--> PATCH') ||
                      trimmed.includes('<-- 200') ||
                      trimmed.includes('HTTP response for request=<') ||
                      trimmed.includes('[API]') ||
                      trimmed.includes('FATAL') ||
                      trimmed.includes('AndroidRuntime') ||
                      trimmed.includes('AssetPack')
                    )
                  );

                  if (isRel && ws.readyState === 1) {
                    const time = new Date().toLocaleTimeString();
                    const level = trimmed.includes(' E ') || trimmed.includes('ERROR') ? 'ERROR' : trimmed.includes(' W ') ? 'WARN' : 'INFO';
                    const sanitized = sanitizeSensitiveData(trimmed);

                    let structuredApi = null;
                    // Only extract structured API when PID-scoped to prevent attributing unscoped lines
                    if (isPidScoped && (trimmed.includes('[VOLLEY_HTTP_TRANSACTION]') || trimmed.includes('VOLLEY_HTTP_TRANSACTION:') || trimmed.includes('[API_TRANSACTION]'))) {
                      try {
                        const jsonStart = trimmed.indexOf('{');
                        if (jsonStart !== -1) {
                          structuredApi = JSON.parse(sanitizeSensitiveData(trimmed.substring(jsonStart)));
                        }
                      } catch (e) {}
                    }

                    ws.send(JSON.stringify({
                      type: 'LOG',
                      serial: data.serial,
                      packageName: isPidScoped ? (targetPkg || null) : null,
                      pid: pid || null,
                      userId: ws.user.id,
                      platform: 'android',
                      log: { time, text: sanitized, level, ...(structuredApi ? { api: structuredApi } : {}) }
                    }));
                  }
                }
              });

              proc.stderr.on('data', () => {});
              proc.on('error', (err) => {
                logger.debug(`[DeviceLogcat] Proc error for ${data.serial}: ${err.message}`);
              });
            };

            if (targetPkg) {
              // Attempt to resolve PID for selected app
              const initialPid = await adbService.getPid(data.serial, targetPkg).catch(() => null);
              ws.currentAppPid = initialPid;
              attachLogcatStream(initialPid);

              // Dynamic PID tracking interval
              ws.pidWatchInterval = setInterval(async () => {
                try {
                  const freshPid = await adbService.getPid(data.serial, targetPkg);
                  if (freshPid && freshPid !== ws.currentAppPid) {
                    logger.info(`[DeviceLogcat PID Watch] Switched PID for ${targetPkg} on ${data.serial}: ${ws.currentAppPid || 'none'} -> ${freshPid}`);
                    ws.currentAppPid = freshPid;
                    attachLogcatStream(freshPid);
                  } else if (!freshPid && ws.currentAppPid) {
                    ws.currentAppPid = null;
                    if (ws.deviceLogcatProc) {
                      try { ws.deviceLogcatProc.kill('SIGKILL'); } catch (e) {}
                      ws.deviceLogcatProc = null;
                    }
                  }
                } catch (e) {}
              }, 2000);
            } else {
              // Raw diagnostic stream
              attachLogcatStream(null);
            }

            ws.send(JSON.stringify({ type: 'DEVICE_LOGCAT_STARTED', serial: data.serial, packageName: targetPkg || null }));
          } catch (err) {
            ws.send(JSON.stringify({ type: 'ERROR', message: `Failed to start device logcat: ${err.message}` }));
          }
        } else if (data.action === 'DEVICE_LOGCAT_STOP') {
          cleanupLogcat();
          ws.send(JSON.stringify({ type: 'DEVICE_LOGCAT_STOPPED' }));
        }

        // General ping
        else if (data.action === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG' }));
        }
      } catch (err) {
        logger.error(`[WS Error] Failed to handle message: ${err.message}`);
      }
    });

    ws.on('close', () => {
      logger.debug(`[WS] Client disconnected. Test ID: ${testId || 'general'}, Mirror: ${ws.subscribedSerial || 'none'}`);
      if (testId) {
        testRunnerService.unsubscribe(testId, ws);
      }
      if (ws.subscribedSerial) {
        screenMirrorService.unsubscribeClient(ws.subscribedSerial, ws);
      }
      cleanupLogcat();
    });

    ws.on('error', (err) => {
      logger.error(`[WS Error] ${err.message}`);
    });

    // Send initial welcome
    ws.send(JSON.stringify({
      type: 'CONNECTED',
      serverTime: new Date().toISOString(),
      user: { id: ws.user.id, name: ws.user.name, role: ws.user.role }
    }));
  });

  return clientWss;
}

/**
 * Scoped dispatch to a specific user
 */
function sendToUser(userId, message) {
  if (!globalWss || !userId) return;
  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  for (const client of globalWss.clients) {
    if (client.readyState === 1 && client.user && (client.user.id === userId || (client.user.role || '').toLowerCase() === 'admin')) {
      try {
        client.send(messageStr);
      } catch (err) {
        logger.debug(`[WS sendToUser] Error: ${err.message}`);
      }
    }
  }
}

/**
 * Scoped dispatch to clients authorized for a device
 */
function sendToDevice(serial, message) {
  if (!globalWss || !serial) return;
  const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
  for (const client of globalWss.clients) {
    if (client.readyState === 1 && client.user) {
      if (deviceLockService.isDeviceAccessible(serial, client.user)) {
        try {
          client.send(messageStr);
        } catch (err) {
          logger.debug(`[WS sendToDevice] Error: ${err.message}`);
        }
      }
    }
  }
}

/**
 * Scoped dispatch to subscribers of a test
 */
function sendToTest(testId, message) {
  testRunnerService.broadcast(testId, message);
}

/**
 * Global broadcast for non-sensitive system events (e.g. DEVICES_UPDATED notifications)
 */
function broadcastEvent(type, payload = {}) {
  if (!globalWss) return;
  const message = JSON.stringify({ type, ...payload, timestamp: Date.now() });
  for (const client of globalWss.clients) {
    if (client.readyState === 1 /* WebSocket.OPEN */) {
      try {
        client.send(message);
      } catch (err) {
        logger.debug(`[WS Broadcast] Failed to send to client: ${err.message}`);
      }
    }
  }
}

function terminateDeviceLogcat(serial, hardwareSerial, oldUserId) {
  if (!globalWss || !globalWss.clients) return;
  for (const client of globalWss.clients) {
    const isTargetUser = !oldUserId || (client.user && client.user.id === oldUserId);
    const matchesSerial = client.deviceLogcatSerial && (
      client.deviceLogcatSerial === serial ||
      (hardwareSerial && client.deviceLogcatSerial === hardwareSerial) ||
      (serial && serial.includes(':') && client.deviceLogcatSerial.startsWith(serial.split(':')[0]))
    );
    if (isTargetUser && matchesSerial) {
      if (client.pidWatchInterval) {
        clearInterval(client.pidWatchInterval);
        client.pidWatchInterval = null;
      }
      if (client.deviceLogcatProc) {
        try { client.deviceLogcatProc.kill('SIGKILL'); } catch (e) {}
        client.deviceLogcatProc = null;
      }
      try {
        client.send(JSON.stringify({
          type: 'LOGCAT_TERMINATED',
          serial: client.deviceLogcatSerial,
          message: 'Device ownership transferred to another user.'
        }));
      } catch (e) {}
      client.deviceLogcatSerial = null;
      client.currentAppPid = null;
      client.targetPackage = null;
    }
  }
}

module.exports = { setupWebSocket, broadcastEvent, sendToUser, sendToDevice, sendToTest, terminateDeviceLogcat };

