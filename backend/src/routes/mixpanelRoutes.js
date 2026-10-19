const express = require('express');
const router = express.Router();
const multer = require('multer');
const mixpanelController = require('../controllers/mixpanelController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB limit
});

// Integration status & feature flags
router.get('/status', mixpanelController.getStatus.bind(mixpanelController));

// Specification endpoints
router.get('/specifications', mixpanelController.listSpecifications.bind(mixpanelController));
router.post('/specifications', upload.single('file'), mixpanelController.uploadSpecification.bind(mixpanelController));
router.get('/specifications/:id', mixpanelController.getSpecification.bind(mixpanelController));
router.delete('/specifications/:id', mixpanelController.deleteSpecification.bind(mixpanelController));

// Capture session endpoints
router.get('/sessions', mixpanelController.listSessions.bind(mixpanelController));
router.post('/sessions', mixpanelController.startSession.bind(mixpanelController));
router.get('/sessions/:id', mixpanelController.getSession.bind(mixpanelController));
router.post('/sessions/:id/stop', mixpanelController.stopSession.bind(mixpanelController));

// Event endpoints within session
router.get('/sessions/:id/events', mixpanelController.getSessionEvents.bind(mixpanelController));
router.delete('/sessions/:id/events', mixpanelController.clearSessionEvents.bind(mixpanelController));
router.post('/sessions/:id/events/inject', mixpanelController.injectEvent.bind(mixpanelController));
router.post('/sessions/:id/events/:eventId/validate', mixpanelController.revalidateEvent.bind(mixpanelController));

// Ad-hoc raw payload validation
router.post('/validate-raw', mixpanelController.validateRaw.bind(mixpanelController));

module.exports = router;
