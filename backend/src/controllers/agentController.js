const fs = require('fs');
const path = require('path');
const agentService = require('../services/agentService');
const logger = require('../utils/logger');

class AgentController {
  async generatePairingCode(req, res, next) {
    try {
      const result = agentService.generatePairingCode(req.user);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async pairAgent(req, res, next) {
    try {
      const { agentId, pairingCode, systemInfo } = req.body;
      const clientIp = req.ip || req.connection?.remoteAddress || '127.0.0.1';
      const result = agentService.pairAgent(agentId, pairingCode, systemInfo || {}, clientIp);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async listAgents(req, res, next) {
    try {
      const agents = agentService.listAgents(req.user);
      res.json({ success: true, count: agents.length, agents });
    } catch (err) {
      next(err);
    }
  }

  async getAgent(req, res, next) {
    try {
      const { id } = req.params;
      const agent = agentService.getAgent(id, req.user);
      if (!agent) {
        return res.status(404).json({ success: false, error: 'Agent not found or unauthorized.' });
      }
      res.json({ success: true, agent });
    } catch (err) {
      next(err);
    }
  }

  async unpairAgent(req, res, next) {
    try {
      const { id } = req.params;
      const result = agentService.unpairAgent(id, req.user);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async downloadAgent(req, res, next) {
    try {
      const platform = (req.params.platform || '').toLowerCase().trim();
      let filename;
      if (platform === 'windows') {
        filename = 'QA-Device-Agent-Windows-x64-v1.1.2.zip';
      } else if (platform === 'macos') {
        filename = 'QA-Device-Agent-macOS-v1.1.2.zip';
      } else {
        return res.status(400).json({
          success: false,
          error: `Invalid platform '${platform}'. Supported platforms: 'windows', 'macos'.`
        });
      }

      const possiblePaths = [
        path.resolve(__dirname, '../../../qa-device-agent/dist', filename),
        path.resolve(__dirname, '../../dist/agents', filename),
        path.resolve(__dirname, '../dist/agents', filename)
      ];

      const filePath = possiblePaths.find(p => fs.existsSync(p));
      if (!filePath) {
        logger.error(`[AgentController] Package not found for platform '${platform}': ${filename}`);
        return res.status(404).json({
          success: false,
          error: `Agent package ${filename} was not found on the server.`
        });
      }

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.sendFile(filePath);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AgentController();
