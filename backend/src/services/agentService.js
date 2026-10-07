const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

class AgentService {
  constructor() {
    this.agentsFile = path.join(config.DATA_DIR, 'agents.json');
    this.pairingCodes = new Map();
    this.agents = new Map();
    this.activeSockets = new Map();
    this.agentDevices = new Map(); // udid -> deviceRecord
    this.pendingCommands = new Map(); // requestId -> { resolve, reject, timeoutId, agentId, deviceId, createdAt }

    this._ensureDirectories();
    this._loadAgents();
    this._startWatchdog();
  }

  _ensureDirectories() {
    if (!fs.existsSync(config.DATA_DIR)) {
      fs.mkdirSync(config.DATA_DIR, { recursive: true });
    }
  }

  _loadAgents() {
    try {
      if (fs.existsSync(this.agentsFile)) {
        const raw = fs.readFileSync(this.agentsFile, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data === 'object' && data !== null) {
          for (const [id, agent] of Object.entries(data)) {
            this.agents.set(id, {
              ...agent,
              status: 'OFFLINE'
            });
          }
          logger.info(`[AgentService] Loaded ${this.agents.size} registered agents.`);
        }
      } else {
        this._persistAgents();
      }
    } catch (err) {
      logger.error(`[AgentService] Failed to load agents: ${err.message}`);
    }
  }

  _persistAgents() {
    try {
      const obj = {};
      for (const [k, v] of this.agents.entries()) {
        const { socket, ...persistable } = v;
        obj[k] = persistable;
      }
      fs.writeFileSync(this.agentsFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      logger.error(`[AgentService] Failed to persist agents: ${err.message}`);
    }
  }

  _startWatchdog() {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [code, entry] of this.pairingCodes.entries()) {
        if (now > entry.expiresAt) {
          this.pairingCodes.delete(code);
        }
      }

      for (const [id, agent] of this.agents.entries()) {
        if (agent.status === 'ONLINE') {
          const lastSeen = agent.lastSeenAt ? new Date(agent.lastSeenAt).getTime() : 0;
          if (now - lastSeen > 45000) {
            agent.status = 'OFFLINE';
            logger.warn(`[AgentService] Agent ${id} (${agent.name || agent.hostname}) heartbeat timed out -> OFFLINE`);
            this._persistAgents();
          }
        }
      }
    }, 10000);
    if (timer && timer.unref) {
      timer.unref();
    }
  }

  generatePairingCode(user) {
    if (!user || !user.id) {
      throw new Error('Authentication required to generate agent pairing code.');
    }

    const code = crypto.randomInt(100000, 999999).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000;

    this.pairingCodes.set(code, {
      code,
      userId: user.id,
      userName: user.name || 'QA Tester',
      userEmail: (user.email || '').toLowerCase(),
      createdAt: Date.now(),
      expiresAt
    });

    logger.info(`[AgentService] Generated pairing code for user ${user.name} (${user.id}), expires in 5m.`);
    return {
      success: true,
      pairingCode: code,
      expiresInSeconds: 300,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  pairAgent(agentId, code, systemInfo = {}, ip = '') {
    if (!agentId || typeof agentId !== 'string') {
      throw new Error('Agent ID is required for pairing.');
    }
    if (!code || typeof code !== 'string') {
      throw new Error('Pairing code is required.');
    }

    const entry = this.pairingCodes.get(code.trim());
    if (!entry) {
      throw new Error('Invalid or expired pairing code. Please generate a new code in the Central QA Tool.');
    }

    if (Date.now() > entry.expiresAt) {
      this.pairingCodes.delete(code.trim());
      throw new Error('Pairing code has expired. Please generate a new code.');
    }

    this.pairingCodes.delete(code.trim());

    const now = new Date().toISOString();
    const agentRecord = {
      agentId,
      userId: entry.userId,
      userName: entry.userName,
      userEmail: entry.userEmail,
      os: systemInfo.os || 'unknown',
      osVersion: systemInfo.osVersion || 'unknown',
      hostname: systemInfo.hostname || 'QA-Host',
      agentVersion: systemInfo.agentVersion || '1.0.0',
      ip: ip || '127.0.0.1',
      pairedAt: now,
      lastSeenAt: now,
      status: 'ONLINE'
    };

    this.agents.set(agentId, agentRecord);
    this._persistAgents();

    const agentToken = jwt.sign(
      {
        agentId,
        userId: entry.userId,
        userName: entry.userName,
        userEmail: entry.userEmail,
        role: 'device_agent'
      },
      config.JWT_SECRET,
      { expiresIn: '30d' }
    );

    logger.info(`[AgentService] Agent ${agentId} (${agentRecord.hostname}, ${agentRecord.os}) successfully paired to user ${entry.userName}.`);

    return {
      success: true,
      agentId,
      agentToken,
      user: {
        id: entry.userId,
        name: entry.userName,
        email: entry.userEmail
      },
      serverVersion: config.APP_VERSION || '1.1.2'
    };
  }

  verifyAgentToken(token) {
    if (!token) return null;
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      if (decoded && decoded.agentId && decoded.userId) {
        return decoded;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  registerSocket(agentId, ws, systemInfo = {}) {
    this.activeSockets.set(agentId, ws);
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'ONLINE';
      agent.lastSeenAt = new Date().toISOString();
      if (systemInfo.remoteIp) agent.remoteIp = systemInfo.remoteIp;
      if (systemInfo.os) agent.os = systemInfo.os;
      if (systemInfo.osVersion) agent.osVersion = systemInfo.osVersion;
      if (systemInfo.hostname) agent.hostname = systemInfo.hostname;
      if (systemInfo.agentVersion) agent.agentVersion = systemInfo.agentVersion;
      this._persistAgents();
    }
  }

  unregisterSocket(agentId, ws) {
    if (this.activeSockets.get(agentId) === ws) {
      this.activeSockets.delete(agentId);
      const agent = this.agents.get(agentId);
      if (agent) {
        agent.status = 'OFFLINE';
        this._persistAgents();
      }
    }
  }

  recordHeartbeat(agentId, payload = {}) {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = 'ONLINE';
    agent.lastSeenAt = new Date().toISOString();
    if (payload.metrics) {
      agent.lastMetrics = payload.metrics;
    }
    return true;
  }

  listAgents(user) {
    if (!user) return [];
    const list = [];
    const isAdmin = (user.role || '').toLowerCase() === 'admin';
    const userId = user.id;
    const userEmail = (user.email || '').toLowerCase();

    for (const agent of this.agents.values()) {
      const isOwner = agent.userId === userId || (userEmail && agent.userEmail === userEmail);
      if (isAdmin || isOwner) {
        list.push({
          ...agent,
          isOwner
        });
      }
    }
    return list;
  }

  getAgent(agentId, user) {
    if (!user || !agentId) return null;
    const agent = this.agents.get(agentId);
    if (!agent) return null;

    const isAdmin = (user.role || '').toLowerCase() === 'admin';
    const isOwner = agent.userId === user.id || (user.email && agent.userEmail === (user.email || '').toLowerCase());
    if (!isAdmin && !isOwner) {
      return null;
    }

    return {
      ...agent,
      isOwner
    };
  }

  unpairAgent(agentId, user) {
    const agent = this.getAgent(agentId, user);
    if (!agent) {
      throw new Error('Agent not found or you do not have permission to unpair it.');
    }

    const ws = this.activeSockets.get(agentId);
    if (ws) {
      try {
        ws.send(JSON.stringify({ type: 'UNPAIRED', message: 'Agent was unpaired by user.' }));
        ws.close(4002, 'Agent unpaired');
      } catch (e) {}
      this.activeSockets.delete(agentId);
    }

    this.agents.delete(agentId);
    this._persistAgents();
    logger.info(`[AgentService] Agent ${agentId} was unpaired by user ${user.name || user.id}.`);
    return { success: true, message: `Agent ${agentId} successfully unpaired.` };
  }

  // --- Agent-Discovered Devices Management (Phase 2) ---

  handleDeviceConnected(agentId, device, wsUser = {}) {
    if (!device || !device.udid) return null;
    const udid = device.udid;
    const agent = this.agents.get(agentId);

    const normalized = {
      serial: udid,
      udid: udid,
      deviceId: udid,
      name: device.name || 'iPhone',
      model: device.model || 'iPhone',
      productType: device.productType || 'iPhone',
      manufacturer: 'Apple',
      platform: 'ios',
      iosVersion: device.iosVersion || 'Unknown',
      osVersion: device.osVersion || 'iOS',
      state: 'device',
      connected: true,
      isWireless: false,
      trustStatus: device.trustStatus || 'trusted',
      trustMessage: device.trustMessage || null,
      connectionType: 'usb',
      connectionMode: 'agent-usb',
      battery: device.battery || 'N/A',
      batteryStatus: device.batteryStatus || '',
      storageFree: device.storageFree || 'N/A',
      storageTotal: device.storageTotal || 'N/A',
      screenResolution: device.screenResolution || '1170 × 2532',
      agentId: agentId,
      agentHostname: agent?.hostname || 'QA-Agent',
      userId: wsUser.id || wsUser.userId || agent?.userId,
      userName: wsUser.name || wsUser.userName || agent?.userName,
      userEmail: (wsUser.email || wsUser.userEmail || agent?.userEmail || '').toLowerCase(),
      lastSeenAt: new Date().toISOString()
    };

    this.agentDevices.set(udid, normalized);
    logger.info(`[AgentService] Registered iOS device ${udid} (${normalized.name}) from agent ${agentId} for user ${normalized.userName}`);
    return normalized;
  }

  handleDeviceDisconnected(agentId, udid) {
    if (!udid) return false;
    const existing = this.agentDevices.get(udid);
    if (existing && existing.agentId === agentId) {
      this.agentDevices.delete(udid);
      logger.info(`[AgentService] iOS device ${udid} disconnected from agent ${agentId}`);
      return true;
    }
    return false;
  }

  handleDeviceList(agentId, devices = [], wsUser = {}) {
    // Clear old devices registered by this specific agent
    for (const [udid, dev] of this.agentDevices.entries()) {
      if (dev.agentId === agentId) {
        this.agentDevices.delete(udid);
      }
    }

    const registered = [];
    for (const dev of devices) {
      const res = this.handleDeviceConnected(agentId, dev, wsUser);
      if (res) registered.push(res);
    }
    return registered;
  }

  handleAgentDisconnect(agentId) {
    let count = 0;
    for (const [udid, dev] of this.agentDevices.entries()) {
      if (dev.agentId === agentId) {
        this.agentDevices.delete(udid);
        count++;
      }
    }
    if (count > 0) {
      logger.info(`[AgentService] Cleared ${count} iOS device(s) on agent ${agentId} disconnect.`);
    }

    // Clean and reject pending commands for this disconnected agent
    for (const [reqId, pending] of this.pendingCommands.entries()) {
      if (pending.agentId === agentId) {
        clearTimeout(pending.timeoutId);
        this.pendingCommands.delete(reqId);
        pending.reject({
          code: 'AGENT_DISCONNECTED',
          message: 'Agent disconnected while command was executing.'
        });
      }
    }
  }

  listAgentDevices(user) {
    if (!user) return [];
    const isAdmin = (user.role || '').toLowerCase() === 'admin';
    const userId = user.id;
    const userEmail = (user.email || '').toLowerCase();

    const result = [];
    for (const dev of this.agentDevices.values()) {
      const isOwner = dev.userId === userId || (userEmail && dev.userEmail === userEmail);
      if (isAdmin || isOwner) {
        result.push({
          ...dev,
          isOwner: true
        });
      }
    }
    return result;
  }

  isAgentIosDevice(serial) {
    if (!serial) return false;
    const dev = this.agentDevices.get(serial);
    return !!(dev && dev.platform === 'ios');
  }

  getAgentDevice(serial, user) {
    if (!serial || !user) return null;
    const dev = this.agentDevices.get(serial);
    if (!dev) return null;

    const isAdmin = (user.role || '').toLowerCase() === 'admin';
    const isOwner = dev.userId === user.id || (user.email && dev.userEmail === (user.email || '').toLowerCase());
    if (isAdmin || isOwner) {
      return dev;
    }
    return null;
  }

  // --- Bidirectional Command Transport (Phase 3) ---

  async sendCommandToAgent(agentId, deviceId, command, args = {}, timeoutMs = 15000) {
    const ws = this.activeSockets.get(agentId);
    const agent = this.agents.get(agentId);

    if (!ws || ws.readyState !== 1 /* OPEN */ || !agent || agent.status !== 'ONLINE') {
      const err = new Error('Target QA Device Agent is currently offline or unreachable.');
      err.code = 'AGENT_OFFLINE';
      throw err;
    }

    const requestId = `cmd_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingCommands.has(requestId)) {
          this.pendingCommands.delete(requestId);
          const err = new Error('Agent command timed out.');
          err.code = 'AGENT_COMMAND_TIMEOUT';
          reject(err);
        }
      }, timeoutMs);

      this.pendingCommands.set(requestId, {
        resolve,
        reject,
        timeoutId,
        agentId,
        deviceId,
        command,
        createdAt: Date.now()
      });

      const payload = {
        type: 'COMMAND_REQUEST',
        requestId,
        agentId,
        deviceId,
        command,
        args,
        timestamp: Date.now()
      };

      try {
        ws.send(JSON.stringify(payload));
        logger.info(`[AgentService] Dispatched ${command} (requestId=${requestId}) to agent ${agentId} for device ${deviceId}`);
      } catch (sendErr) {
        clearTimeout(timeoutId);
        this.pendingCommands.delete(requestId);
        reject(sendErr);
      }
    });
  }

  handleCommandResponse(agentId, data = {}) {
    const requestId = data.requestId;
    if (!requestId) {
      logger.warn(`[AgentService] Received COMMAND_RESPONSE without requestId from agent ${agentId}`);
      return false;
    }

    const pending = this.pendingCommands.get(requestId);
    if (!pending) {
      logger.debug(`[AgentService] Received unexpected or timed-out COMMAND_RESPONSE (requestId=${requestId})`);
      return false;
    }

    // Clear timeout and remove from pending tracking
    clearTimeout(pending.timeoutId);
    this.pendingCommands.delete(requestId);

    const isSuccess = data.success === true || data.status === 'SUCCESS';

    if (isSuccess) {
      logger.info(`[AgentService] Command ${pending.command} (requestId=${requestId}) succeeded on agent ${agentId}`);
      pending.resolve(data.result || data.data || {});
    } else {
      const errData = data.error || { code: 'AGENT_COMMAND_FAILED', message: data.message || 'Command execution failed on agent.' };
      logger.warn(`[AgentService] Command ${pending.command} (requestId=${requestId}) failed on agent ${agentId}:`, errData);
      const err = new Error(typeof errData === 'string' ? errData : (errData.message || 'Command failed on agent.'));
      err.code = (typeof errData === 'object' && errData.code) ? errData.code : 'AGENT_COMMAND_FAILED';
      err.details = errData;
      pending.reject(err);
    }
    return true;
  }
}

module.exports = new AgentService();
