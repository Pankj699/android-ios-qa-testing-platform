const { spawn } = require('child_process');
const path = require('path');
const userService = require('../services/userService');
const deviceImageService = require('../services/deviceImageService');
const logger = require('../utils/logger');

let isRestartInProgress = false;

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

  /**
   * GET /api/admin/devices/models
   * Returns list of catalog models and connected devices with image status.
   */
  async listDeviceModels(req, res, next) {
    try {
      const result = await deviceImageService.listDeviceModels(req.query, req.user);
      res.json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/admin/devices/models
   * Adds or updates a device model entry in the catalog.
   */
  async addDeviceModel(req, res, next) {
    try {
      const { manufacturer, model, displayName } = req.body || {};
      if (!manufacturer || !model) {
        return res.status(400).json({ success: false, error: 'Manufacturer and model identifier are required.' });
      }
      const result = deviceImageService.addOrUpdateModel({
        manufacturer,
        model,
        displayName,
        user: req.user
      });
      res.json({
        success: true,
        message: 'Device model registered in catalog.',
        data: result
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/admin/devices/models/:manufacturer/:model/image
   * Uploads or replaces a device thumbnail image.
   * Optionally accepts originalImage for separate preservation when trimmed.
   */
  async uploadDeviceImage(req, res, next) {
    try {
      const { manufacturer, model } = req.params;
      const displayName = req.body?.displayName;
      const isTrimmed = req.body?.isTrimmed === 'true' || req.body?.isTrimmed === true;

      const mainFile = (req.files && req.files.image && req.files.image[0]) || req.file;
      const originalFile = req.files && req.files.originalImage && req.files.originalImage[0];

      if (!mainFile || !mainFile.buffer) {
        return res.status(400).json({ success: false, error: 'Valid image file (PNG, JPEG, WebP) is required.' });
      }

      const result = deviceImageService.uploadDeviceImage({
        manufacturer,
        model,
        buffer: mainFile.buffer,
        originalBuffer: originalFile?.buffer || null,
        isTrimmed,
        user: req.user,
        displayName
      });

      res.json({
        success: true,
        message: 'Device thumbnail uploaded and updated successfully.',
        data: result
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/admin/devices/models/:manufacturer/:model/restore-original
   * Restores the original raw image if a trimmed version was active.
   */
  async restoreOriginalDeviceImage(req, res, next) {
    try {
      const { manufacturer, model } = req.params;
      const result = deviceImageService.restoreOriginalImage(manufacturer, model, req.user);
      res.json({
        success: true,
        message: result.message,
        data: result.data
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * DELETE /api/admin/devices/models/:manufacturer/:model/image
   * Removes an uploaded thumbnail image while preserving the catalog model record.
   */
  async removeDeviceImage(req, res, next) {
    try {
      const { manufacturer, model } = req.params;
      const result = deviceImageService.removeDeviceImage(manufacturer, model, req.user);
      res.json({
        success: true,
        message: result.message
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * DELETE /api/admin/devices/models/:manufacturer/:model
   * Deletes a model entry from the catalog.
   */
  async deleteDeviceModel(req, res, next) {
    try {
      const { manufacturer, model } = req.params;
      const result = deviceImageService.deleteModel(manufacturer, model);
      res.json({
        success: true,
        message: result.message
      });
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  /**
   * POST /api/admin/system/restart
   * Initiates a controlled, non-colliding backend restart on Windows/POSIX.
   */
  async restartBackend(req, res, next) {
    try {
      if (isRestartInProgress) {
        return res.status(409).json({
          success: false,
          error: 'A backend restart is already in progress.'
        });
      }

      isRestartInProgress = true;
      const userEmail = req.user?.email || 'admin';
      logger.info(`[Admin] Backend restart initiated by ${userEmail}.`);

      // Acknowledge restart to client before process exits
      res.json({
        success: true,
        message: 'Backend restart initiated. Server is cycling...',
        reconnectProbeUrl: '/api/system/health',
        estimatedDowntimeMs: 2500
      });

      // Allow HTTP response to flush cleanly before triggering listener recycle
      setTimeout(async () => {
        try {
          if (process.env.RESTART_MODE === 'supervisor') {
            const supervisorScript = path.resolve(__dirname, '../scripts/restartService.js');
            const supervisor = spawn(process.execPath, [supervisorScript, String(process.pid)], {
              cwd: path.resolve(__dirname, '../..'),
              detached: true,
              stdio: 'ignore',
              env: process.env
            });
            supervisor.unref();
            setTimeout(() => { process.exit(0); }, 400);
            return;
          }

          // Gracefully recycle HTTP/HTTPS listener, WebSocket server, and configs in-process
          const indexModule = require('../index');
          if (typeof indexModule.recycleServer === 'function') {
            await indexModule.recycleServer();
          }
        } catch (recycleErr) {
          logger.error(`[Admin] Failed to recycle backend server: ${recycleErr.message}`);
        } finally {
          isRestartInProgress = false;
        }
      }, 500);
    } catch (err) {
      isRestartInProgress = false;
      next(err);
    }
  }
}

const adminController = new AdminController();
module.exports = adminController;
