const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { requireRole } = require('../middleware/auth');

router.get('/system/diagnostics', requireRole(['ADMIN']), (req, res, next) => systemController.getDiagnostics(req, res, next));
router.get('/system/env', (req, res, next) => systemController.getEnv(req, res, next));

module.exports = router;
