const express = require('express');
const router = express.Router();
const bugDeskController = require('../controllers/bugDeskController');

// Standard Next.js compatible API routes mapped directly into QA Platform API
router.post('/rewrite-bug', (req, res, next) => bugDeskController.rewriteBug(req, res, next));
router.post('/test-connection', (req, res, next) => bugDeskController.testConnection(req, res, next));

// Namespaced aliases
router.post('/bug-desk/rewrite', (req, res, next) => bugDeskController.rewriteBug(req, res, next));
router.post('/bug-desk/test-connection', (req, res, next) => bugDeskController.testConnection(req, res, next));

module.exports = router;
