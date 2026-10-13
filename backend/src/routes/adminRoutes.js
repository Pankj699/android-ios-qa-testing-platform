const express = require('express');
const router = express.Router();
const multer = require('multer');
const adminController = require('../controllers/adminController');
const { requireRole } = require('../middleware/auth');

// Multer memory storage configuration for device thumbnail uploads
const thumbnailUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024 // 2.0 MB maximum
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (allowed.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
    } else {
      cb(new Error('Invalid image format. Only PNG, JPEG, and WebP images are allowed.'));
    }
  }
});

// All /api/admin/* endpoints strictly require authenticated user with role === 'ADMIN'
router.use('/admin', requireRole(['ADMIN']));

// Admin User Management Endpoints
router.get('/admin/users', (req, res, next) => adminController.listUsers(req, res, next));
router.get('/admin/users/:id', (req, res, next) => adminController.getUser(req, res, next));
router.patch('/admin/users/:id', (req, res, next) => adminController.updateUser(req, res, next));
router.post('/admin/users/:id/reset-password', (req, res, next) => adminController.resetUserPassword(req, res, next));

// Admin Controlled Backend Restart
router.post('/admin/system/restart', (req, res, next) => adminController.restartBackend(req, res, next));

// Admin Device Management Endpoints
router.get('/admin/devices/models', (req, res, next) => adminController.listDeviceModels(req, res, next));
router.post('/admin/devices/models', (req, res, next) => adminController.addDeviceModel(req, res, next));
router.post(
  '/admin/devices/models/:manufacturer/:model/image',
  thumbnailUpload.fields([
    { name: 'image', maxCount: 1 },
    { name: 'originalImage', maxCount: 1 }
  ]),
  (req, res, next) => adminController.uploadDeviceImage(req, res, next)
);
router.post('/admin/devices/models/:manufacturer/:model/restore-original', (req, res, next) => adminController.restoreOriginalDeviceImage(req, res, next));
router.delete('/admin/devices/models/:manufacturer/:model/image', (req, res, next) => adminController.removeDeviceImage(req, res, next));
router.delete('/admin/devices/models/:manufacturer/:model', (req, res, next) => adminController.deleteDeviceModel(req, res, next));

module.exports = router;
