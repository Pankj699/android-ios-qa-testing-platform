const express = require('express');
const router = express.Router();
const driveController = require('../controllers/driveController');
const recordingUpload = require('../middleware/recordingUpload');

// List user recordings
router.get('/recordings', driveController.listRecordings);

// Upload screen recording
router.post('/recordings/upload', recordingUpload.single('file'), driveController.uploadRecording);

// Retrieve single recording details
router.get('/recordings/:recordingId', driveController.getRecording);

// Delete recording record (optionally from Google Drive)
router.delete('/recordings/:recordingId', driveController.deleteRecording);

module.exports = router;
