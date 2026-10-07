const express = require('express');
const router = express.Router();
const adbController = require('../controllers/adbController');

router.post('/device/:id/clear-data', (req, res, next) => adbController.clearData(req, res, next));
router.post('/device/:id/clear-cache', (req, res, next) => adbController.clearCache(req, res, next));
router.post('/device/:id/uninstall', (req, res, next) => adbController.uninstall(req, res, next));
router.post('/device/:id/launch', (req, res, next) => adbController.launch(req, res, next));
router.post('/device/:id/clear-logcat', (req, res, next) => adbController.clearLogcat(req, res, next));
router.post('/adb/execute-safe', (req, res, next) => adbController.executeSafeCommand(req, res, next));

module.exports = router;
