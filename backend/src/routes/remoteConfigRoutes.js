const express = require('express');
const router = express.Router();
const remoteConfigController = require('../controllers/remoteConfigController');

// Prevent stale caching on all Remote Config read/write operations
router.use((req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  next();
});

// List applications for a platform (?platform=android|ios)
router.get('/applications', remoteConfigController.getApplications.bind(remoteConfigController));

// List configs for an application (?platform=android|ios&app=...)
router.get('/configs', remoteConfigController.getConfigs.bind(remoteConfigController));

// Create a new config
router.post('/configs', remoteConfigController.createConfig.bind(remoteConfigController));

// Update an existing config
router.put('/configs/:id', remoteConfigController.updateConfig.bind(remoteConfigController));

// Toggle active status
router.patch('/configs/:id/toggle', remoteConfigController.toggleActive.bind(remoteConfigController));

// Delete a config
router.delete('/configs/:id', remoteConfigController.deleteConfig.bind(remoteConfigController));

module.exports = router;
