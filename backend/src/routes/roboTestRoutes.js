const express = require('express');
const router = express.Router();
const upload = require('../middleware/upload');
const roboTestController = require('../controllers/roboTestController');

// Diagnostic Environment & Catalog
router.get('/environment', (req, res, next) => roboTestController.getEnvironment(req, res, next));
router.get('/catalog', (req, res, next) => roboTestController.getCatalog(req, res, next));

// Build Upload & Test Launch
router.post('/upload', upload.single('file'), (req, res, next) => roboTestController.uploadBuild(req, res, next));
router.post('/run', (req, res, next) => roboTestController.runTest(req, res, next));

// Jobs Lifecycle & History
router.get('/jobs', (req, res, next) => roboTestController.listJobs(req, res, next));
router.get('/jobs/:id', (req, res, next) => roboTestController.getJob(req, res, next));
router.get('/jobs/:id/logs', (req, res, next) => roboTestController.getJobLogs(req, res, next));
router.post('/jobs/:id/cancel', (req, res, next) => roboTestController.cancelJob(req, res, next));
router.delete('/jobs/:id', (req, res, next) => roboTestController.deleteJob(req, res, next));

module.exports = router;
