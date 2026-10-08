const userService = require('../services/userService');
const logger = require('../utils/logger');

class AdminController {
  /**
   * GET /api/admin/users
   */
  async listUsers(req, res, next) {
    try {
      const { search, role, status, sortBy, sortOrder } = req.query || {};
      const result = await userService.listUsers({ search, role, status, sortBy, sortOrder });
      res.json({
        success: true,
        users: result.users,
        summary: result.summary
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/admin/users/:id
   */
  async getUser(req, res, next) {
    try {
      const { id } = req.params;
      const user = await userService.getUserById(id);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found.'
        });
      }
      res.json({
        success: true,
        user
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/admin/users/:id
   */
  async updateUser(req, res, next) {
    try {
      const { id } = req.params;
      const updates = req.body || {};
      const user = await userService.updateUser(id, updates, req.user);
      res.json({
        success: true,
        message: 'User updated successfully.',
        user
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          error: err.message
        });
      }
      next(err);
    }
  }

  /**
   * POST /api/admin/users/:id/reset-password
   */
  async resetUserPassword(req, res, next) {
    try {
      const { id } = req.params;
      const { temporaryPassword } = req.body || {};
      const result = await userService.adminResetPassword(id, temporaryPassword, req.user);
      res.json({
        success: true,
        message: result.message,
        temporaryPassword: result.temporaryPassword
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          error: err.message
        });
      }
      next(err);
    }
  }
}

module.exports = new AdminController();
