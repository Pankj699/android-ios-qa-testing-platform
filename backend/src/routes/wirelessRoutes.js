const express = require('express');
const router = express.Router();
const wirelessPairingController = require('../controllers/wirelessPairingController');

// QR Pairing lifecycle
router.post('/wireless/qr/start', (req, res, next) => wirelessPairingController.startQrSession(req, res, next));
router.get('/wireless/qr/status/:sessionId', (req, res, next) => wirelessPairingController.getSessionStatus(req, res, next));
router.post('/wireless/qr/cancel/:sessionId', (req, res, next) => wirelessPairingController.cancelSession(req, res, next));

// Pairing code fallback
router.post('/wireless/pair-code', (req, res, next) => wirelessPairingController.pairWithCode(req, res, next));

// Connect already paired wireless device
router.post('/wireless/connect', (req, res, next) => wirelessPairingController.connectDevice(req, res, next));

// Discovered mDNS services & diagnostics
router.get('/wireless/discovered', (req, res, next) => wirelessPairingController.getDiscovered(req, res, next));
router.get('/wireless/diagnostics', (req, res, next) => wirelessPairingController.getDiagnostics(req, res, next));

module.exports = router;
