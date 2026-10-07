const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');

router.get('/system/diagnostics', (req, res, next) => systemController.getDiagnostics(req, res, next));
router.get('/system/env', (req, res, next) => systemController.getEnv(req, res, next));

module.exports = router;
