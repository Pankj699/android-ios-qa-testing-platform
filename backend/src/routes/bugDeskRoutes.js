const express = require('express');
const router = express.Router();
const bugDeskController = require('../controllers/bugDeskController');

// Standard Next.js compatible API routes mapped directly into QA Platform API
router.post('/rewrite-bug', (req, res, next) => bugDeskController.rewriteBug(req, res, next));
router.post('/test-connection', (req, res, next) => bugDeskController.testConnection(req, res, next));

// Namespaced aliases
router.post('/bug-desk/rewrite', (req, res, next) => bugDeskController.rewriteBug(req, res, next));
router.post('/bug-desk/test-connection', (req, res, next) => bugDeskController.testConnection(req, res, next));

// Globally Shared Device & OS Catalog Endpoints
router.get('/bug-desk/devices', (req, res, next) => bugDeskController.getDevices(req, res, next));
router.post('/bug-desk/devices', (req, res, next) => bugDeskController.createDevice(req, res, next));
router.patch('/bug-desk/devices/:id', (req, res, next) => bugDeskController.updateDevice(req, res, next));
router.delete('/bug-desk/devices/:id', (req, res, next) => bugDeskController.deleteDevice(req, res, next));

// Clean aliases without hyphen
router.get('/bugdesk/devices', (req, res, next) => bugDeskController.getDevices(req, res, next));
router.post('/bugdesk/devices', (req, res, next) => bugDeskController.createDevice(req, res, next));
router.patch('/bugdesk/devices/:id', (req, res, next) => bugDeskController.updateDevice(req, res, next));
router.delete('/bugdesk/devices/:id', (req, res, next) => bugDeskController.deleteDevice(req, res, next));

// PMS / Redmine Integration Endpoints
router.get('/bug-desk/pms/options', (req, res, next) => bugDeskController.getPmsOptions(req, res, next));
router.post('/bug-desk/pms/test-connection', (req, res, next) => bugDeskController.testPmsConnection(req, res, next));
router.get('/bugdesk/pms/options', (req, res, next) => bugDeskController.getPmsOptions(req, res, next));
router.post('/bugdesk/pms/test-connection', (req, res, next) => bugDeskController.testPmsConnection(req, res, next));

module.exports = router;
