const express = require('express');
const router = express.Router();
const config = require('../config');
const agentService = require('../services/agentService');
const agentMirrorService = require('../services/agentMirrorService');

router.get('/health', (req, res) => {
  const activeAgents = Array.from(agentService.agents.values()).filter(a => a.status === 'ONLINE').length;
  const activeMirrors = agentMirrorService.sessions.size;
  const connectedDevices = agentService.agentDevices.size;

  res.json({
    status: 'UP',
    version: config.APP_VERSION || '1.1.2',
    displayVersion: config.DISPLAY_VERSION,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
    checks: {
      backend: 'UP',
      agents: { total: agentService.agents.size, online: activeAgents },
      devices: { total: connectedDevices },
      mirrors: { active: activeMirrors }
    }
  });
});

module.exports = router;
