const express = require('express');
const router = express.Router();
const driveController = require('../controllers/driveController');
const recordingUpload = require('../middleware/recordingUpload');

// --- Connection & OAuth ---
// 1. Generate Google OAuth authorization URL (Authenticated) - supports both /auth-url and /auth/url
router.get('/auth-url', driveController.getAuthUrl);
router.get('/auth/url', driveController.getAuthUrl);

// 2. OAuth Callback endpoint (Publicly reachable, derives user from state)
router.get('/callback', driveController.handleCallback);

// 2b. OAuth Completion endpoint (Publicly reachable, serves popup completion page)
router.get('/oauth-complete', driveController.handleOAuthComplete);

// 3. Current user connection status (Authenticated)
router.get('/status', driveController.getStatus);

// 4. Disconnect Google Drive (Authenticated)
router.post('/disconnect', driveController.disconnect);

// 5. Google Drive storage quota (Authenticated)
router.get('/quota', driveController.getQuota);

// 5b. Google Drive integration diagnostic information (Authenticated)
router.get('/diagnostics', driveController.getDiagnostics);

// --- File & Folder Operations ---
// 6. List files and folders with pagination & filtering
router.get('/files', driveController.listFiles);

// 7. Create a new folder
router.post('/folders', driveController.createFolder);

// 7b. Retrieve breadcrumbs path for a specific folder
router.get('/folders/:folderId/breadcrumbs', driveController.getFolderBreadcrumbs);

// 8. Retrieve metadata for a specific file
router.get('/files/:fileId', driveController.getFileMetadata);

// 9. Rename a file or folder (supports PATCH and POST)
router.patch('/files/:fileId/rename', driveController.renameFile);
router.post('/files/:fileId/rename', driveController.renameFile);

// 10. Move a file or folder to a new destination folder
router.post('/files/:fileId/move', driveController.moveFile);

// 11. Delete a file or folder from Google Drive
router.delete('/files/:fileId', driveController.deleteFile);

// 12. Explicitly publish / generate a shareable link
router.post('/files/:fileId/publish', driveController.publishFile);
router.post('/files/:fileId/share', driveController.publishFile);
router.post('/publish', driveController.publishRecording);

// --- User Default Upload Folder ---
// 13. Get default upload folder
router.get('/default-folder', driveController.getDefaultFolder);

// 14. Set default upload folder
router.post('/default-folder', driveController.setDefaultFolder);

// --- Direct Recording Upload Endpoint ---
// 15. Upload recording via multipart streaming
router.post('/upload-recording', recordingUpload.single('file'), driveController.uploadRecording);

module.exports = router;
