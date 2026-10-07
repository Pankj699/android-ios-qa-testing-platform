const express = require('express');
const router = express.Router();
const agentController = require('../controllers/agentController');
const { authenticate } = require('../middleware/auth');
const { pairingAttemptLimiter, pairingCodeLimiter } = require('../middleware/rateLimiter');

// Public agent pairing & package download endpoints
router.post('/pair', pairingAttemptLimiter, (req, res, next) => agentController.pairAgent(req, res, next));
router.get('/download/:platform', (req, res, next) => agentController.downloadAgent(req, res, next));

// User-authenticated endpoints
router.post('/pairing-code', authenticate, pairingCodeLimiter, (req, res, next) => agentController.generatePairingCode(req, res, next));
router.get('/list', authenticate, (req, res, next) => agentController.listAgents(req, res, next));
router.get('/:id', authenticate, (req, res, next) => agentController.getAgent(req, res, next));
router.post('/:id/unpair', authenticate, (req, res, next) => agentController.unpairAgent(req, res, next));

module.exports = router;
