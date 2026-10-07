const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authLimiter } = require('../middleware/rateLimiter');

// Public registration & authentication
router.post('/auth/register', authLimiter, (req, res, next) => authController.register(req, res, next));
router.post('/auth/login', authLimiter, (req, res, next) => authController.login(req, res, next));
router.post('/auth/forgot-password', authLimiter, (req, res, next) => authController.forgotPassword(req, res, next));
router.post('/auth/reset-password', authLimiter, (req, res, next) => authController.resetPassword(req, res, next));

// Authenticated session operations
router.get('/auth/me', (req, res, next) => authController.me(req, res, next));
router.post('/auth/logout', (req, res, next) => authController.logout(req, res, next));

module.exports = router;
