const { WebSocketServer } = require('ws');
const logger = require('../utils/logger');
const agentService = require('../services/agentService');
const agentMirrorService = require('../services/agentMirrorService');

let agentWss = null;

function setupAgentWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });
  agentWss = wss;

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const agentId = url.searchParams.get('agentId');
    const token = url.searchParams.get('agentToken') || url.searchParams.get('token');

    const auth = agentService.verifyAgentToken(token);
    if (!auth || (agentId && auth.agentId !== agentId)) {
      logger.warn(`[AgentWS] Unauthorized agent connection attempt for agentId=${agentId}`);
      ws.send(JSON.stringify({ type: 'ERROR', message: 'Unauthorized: Invalid agent token.' }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    const boundAgentId = auth.agentId;
    ws.agentId = boundAgentId;
    ws.userId = auth.userId;
    ws.userEmail = auth.userEmail;

    const rawIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress || '127.0.0.1';
    const cleanIp = rawIp.replace(/^::ffff:/, '');
    const remoteIp = (cleanIp === '::1' || cleanIp === '127.0.0.1') ? '127.0.0.1' : cleanIp;
    ws.remoteIp = remoteIp;

    logger.info(`[AgentWS] Agent ${boundAgentId} connected successfully from ${remoteIp} for user ${auth.userName} (${auth.userId}).`);
    agentService.registerSocket(boundAgentId, ws, { remoteIp });

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());

        if (data.type === 'AGENT_HEARTBEAT') {
          agentService.recordHeartbeat(boundAgentId, data);
          ws.send(JSON.stringify({
            type: 'AGENT_HEARTBEAT_ACK',
            clientTimestamp: data.timestamp,
            serverTimestamp: Date.now()
          }));
        } else if (data.type === 'DEVICE_CONNECTED') {
          agentService.handleDeviceConnected(boundAgentId, data.device, auth);
          const { broadcastEvent } = require('./testSocket');
          broadcastEvent('DEVICES_UPDATED');
        } else if (data.type === 'DEVICE_DISCONNECTED') {
          agentService.handleDeviceDisconnected(boundAgentId, data.udid);
          const { broadcastEvent } = require('./testSocket');
          broadcastEvent('DEVICES_UPDATED');
        } else if (data.type === 'DEVICE_LIST') {
          agentService.handleDeviceList(boundAgentId, data.devices, auth);
          const { broadcastEvent } = require('./testSocket');
          broadcastEvent('DEVICES_UPDATED');
        } else if (data.type === 'COMMAND_RESPONSE') {
          agentService.handleCommandResponse(boundAgentId, data);
        } else if (data.type === 'START_MIRROR_RESPONSE' || data.type === 'STOP_MIRROR_RESPONSE' || data.type === 'GET_MIRROR_STATUS_RESPONSE') {
          agentMirrorService.handleAgentMirrorResponse(boundAgentId, data);
        } else if (data.type === 'AGENT_DIAGNOSTICS') {
          logger.info(`[AgentWS] Received diagnostics from agent ${boundAgentId}:`, data.diagnostics);
          agentService.recordHeartbeat(boundAgentId, { metrics: data.diagnostics });
        } else if (data.type === 'PING') {
          ws.send(JSON.stringify({ type: 'PONG', serverTimestamp: Date.now() }));
        }
      } catch (err) {
        logger.error(`[AgentWS Error] Message parse error from agent ${boundAgentId}: ${err.message}`);
      }
    });

    ws.on('close', (code, reason) => {
      logger.info(`[AgentWS] Agent ${boundAgentId} disconnected (code ${code})`);
      agentService.unregisterSocket(boundAgentId, ws);
      agentService.handleAgentDisconnect(boundAgentId);
      agentMirrorService.handleAgentDisconnect(boundAgentId);
      try {
        const { broadcastEvent } = require('./testSocket');
        broadcastEvent('DEVICES_UPDATED');
      } catch (e) {}
    });

    ws.on('error', (err) => {
      logger.warn(`[AgentWS Error] Socket error for agent ${boundAgentId}: ${err.message}`);
    });

    // Send welcome payload
    ws.send(JSON.stringify({
      type: 'AGENT_CONNECTED',
      agentId: boundAgentId,
      user: { id: auth.userId, email: auth.userEmail, name: auth.userName },
      serverTime: new Date().toISOString()
    }));
  });

  return wss;
}

module.exports = { setupAgentWebSocket };
