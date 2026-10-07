const express = require('express');
const router = express.Router();
const deviceController = require('../controllers/deviceController');

router.get('/devices', (req, res, next) => deviceController.listDevices(req, res, next));
router.post('/device/pair', (req, res, next) => deviceController.pairDevice(req, res, next));
router.post('/device/connect', (req, res, next) => deviceController.connectDevice(req, res, next));
router.post('/device/disconnect', (req, res, next) => deviceController.disconnectDevice(req, res, next));
router.post('/device/:id/disconnect', (req, res, next) => deviceController.disconnectDevice(req, res, next));
router.get('/device/:id/info', (req, res, next) => deviceController.getDeviceInfo(req, res, next));
router.get('/device/:id/storage', (req, res, next) => deviceController.getStorage(req, res, next));
router.post('/device/:id/claim', (req, res, next) => deviceController.claimDevice(req, res, next));
router.post('/device/:id/release', (req, res, next) => deviceController.releaseDevice(req, res, next));
router.post('/device/:id/command', (req, res, next) => deviceController.executeAgentCommand(req, res, next));
router.get('/device/:id/installed-apps', (req, res, next) => deviceController.getInstalledApps(req, res, next));

// Screen Mirroring & Screenshot Routes
router.post('/device/:id/mirror/start', (req, res, next) => deviceController.startMirror(req, res, next));
router.post('/device/:id/mirror/stop', (req, res, next) => deviceController.stopMirror(req, res, next));
router.get('/device/:id/mirror/status', (req, res, next) => deviceController.getMirrorStatus(req, res, next));
router.all('/device/:id/mirror/stream*', (req, res, next) => deviceController.proxyIosStream(req, res, next));
router.post('/device/:id/screenshot', (req, res, next) => deviceController.captureScreenshot(req, res, next));
router.post('/device/:id/input', (req, res, next) => deviceController.sendInput(req, res, next));
router.get('/device/:id/screenshot/:filename', (req, res, next) => deviceController.getScreenshotFile(req, res, next));

module.exports = router;
