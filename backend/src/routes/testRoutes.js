const express = require('express');
const router = express.Router();
const testController = require('../controllers/testController');

router.post('/test/run', (req, res, next) => testController.runTest(req, res, next));
router.post('/test/monitor-installed', (req, res, next) => testController.monitorInstalledApp(req, res, next));
router.post('/test/prepare-browser-artifact', (req, res, next) => testController.prepareBrowserArtifact(req, res, next));
router.get('/test/artifact/:filename', (req, res, next) => testController.downloadArtifact(req, res, next));
router.post('/test/save-browser-result', (req, res, next) => testController.saveBrowserResult(req, res, next));
router.get('/test/:id', (req, res, next) => testController.getTest(req, res, next));
router.post('/test/:id/cancel', (req, res, next) => testController.cancelTest(req, res, next));
router.get('/test/:id/logs', (req, res, next) => testController.getTestLogs(req, res, next));
router.get('/test/:id/download-logs', (req, res, next) => testController.downloadTestLogs(req, res, next));
router.delete('/test/:id', (req, res, next) => testController.deleteTest(req, res, next));
router.get('/tests/history', (req, res, next) => testController.listHistory(req, res, next));
router.get('/tests/summary', (req, res, next) => testController.getSummary(req, res, next));

module.exports = router;
