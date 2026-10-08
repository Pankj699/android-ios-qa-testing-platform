const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireRole } = require('../middleware/auth');

// All /api/admin/* endpoints strictly require authenticated user with role === 'ADMIN'
router.use('/admin', requireRole(['ADMIN']));

router.get('/admin/users', (req, res, next) => adminController.listUsers(req, res, next));
router.get('/admin/users/:id', (req, res, next) => adminController.getUser(req, res, next));
router.patch('/admin/users/:id', (req, res, next) => adminController.updateUser(req, res, next));
router.post('/admin/users/:id/reset-password', (req, res, next) => adminController.resetUserPassword(req, res, next));

module.exports = router;
