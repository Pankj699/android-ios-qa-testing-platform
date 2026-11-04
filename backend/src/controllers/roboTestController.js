const fs = require('fs');
const path = require('path');
const roboTestService = require('../services/roboTestService');
const historyService = require('../services/historyService');
const logger = require('../utils/logger');

class RoboTestController {
  async getEnvironment(req, res, next) {
    try {
      const envDiag = await roboTestService.getEnvironment();
      res.json({
        success: true,
        environment: envDiag
      });
    } catch (err) {
      next(err);
    }
  }

  async getCatalog(req, res, next) {
    try {
      const forceRefresh = req.query.refresh === 'true';
      const search = req.query.search ? String(req.query.search).trim().slice(0, 100) : null;
      const catalog = await roboTestService.getDeviceCatalog({ forceRefresh, search });
      res.json({
        success: true,
        catalog
      });
    } catch (err) {
      next(err);
    }
  }

  async uploadBuild(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No application file uploaded. Please upload a valid .apk or .aab file.'
        });
      }

      const ext = path.extname(req.file.originalname).toLowerCase();
      if (ext !== '.apk' && ext !== '.aab') {
        // Remove invalid uploaded file
        if (fs.existsSync(req.file.path)) {
          try { fs.unlinkSync(req.file.path); } catch (_) {}
        }
        return res.status(400).json({
          success: false,
          error: `Invalid file extension '${ext}'. Only Android Package (.apk) and App Bundle (.aab) are supported.`
        });
      }

      const buildInfo = {
        buildId: `upload-${Date.now()}`,
        filename: req.file.originalname,
        filePath: req.file.path,
        size: req.file.size,
        format: ext === '.aab' ? 'aab' : 'apk',
        uploadedAt: new Date().toISOString()
      };

      res.status(201).json({
        success: true,
        message: 'Build uploaded successfully for Robo Testing',
        build: buildInfo
      });
    } catch (err) {
      next(err);
    }
  }

  async runTest(req, res, next) {
    try {
      const {
        buildId,
        appPath,
        appName,
        testLabel,
        devices,
        timeout = '15m',
        roboDirectives = []
      } = req.body;

      let resolvedAppPath = appPath;
      let resolvedAppName = appName || 'Android Application';

      // If buildId supplied from standard platform builds, resolve filePath
      if (buildId && (!resolvedAppPath || !fs.existsSync(resolvedAppPath))) {
        const platformBuild = historyService.getBuildById(buildId);
        if (platformBuild && platformBuild.filePath && fs.existsSync(platformBuild.filePath)) {
          resolvedAppPath = platformBuild.filePath;
          resolvedAppName = platformBuild.name || platformBuild.packageName || resolvedAppName;
        }
      }

      if (!resolvedAppPath || !fs.existsSync(resolvedAppPath)) {
        return res.status(400).json({
          success: false,
          error: 'Valid application build file is required. Upload an APK/AAB or select an existing build.'
        });
      }

      if (!Array.isArray(devices) || devices.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'At least one target device configuration must be selected.'
        });
      }

      for (const d of devices) {
        if (!d.model || !d.version) {
          return res.status(400).json({
            success: false,
            error: 'Each device must specify a valid model and OS version.'
          });
        }
      }

      const job = await roboTestService.startRoboTest({
        appPath: resolvedAppPath,
        appName: resolvedAppName,
        buildId,
        testLabel,
        devices,
        timeout,
        roboDirectives,
        user: req.user
      });

      res.status(202).json({
        success: true,
        message: 'Firebase Test Lab Robo Test initiated successfully.',
        job
      });
    } catch (err) {
      next(err);
    }
  }

  async listJobs(req, res, next) {
    try {
      const filters = {
        status: req.query.status,
        search: req.query.search,
        userId: req.query.userId
      };
      const jobs = roboTestService.getJobs(filters, req.user);
      res.json({
        success: true,
        jobs
      });
    } catch (err) {
      next(err);
    }
  }

  async getJob(req, res, next) {
    try {
      const { id } = req.params;
      const job = roboTestService.getJobById(id, req.user);
      if (!job) {
        return res.status(404).json({
          success: false,
          error: `Robo test job '${id}' not found.`
        });
      }
      res.json({
        success: true,
        job
      });
    } catch (err) {
      next(err);
    }
  }

  async getJobLogs(req, res, next) {
    try {
      const { id } = req.params;
      const logs = roboTestService.getJobLogs(id, req.user);
      res.json({
        success: true,
        logs
      });
    } catch (err) {
      next(err);
    }
  }

  async cancelJob(req, res, next) {
    try {
      const { id } = req.params;
      const job = await roboTestService.cancelJob(id, req.user);
      res.json({
        success: true,
        message: 'Test job cancelled successfully.',
        job
      });
    } catch (err) {
      next(err);
    }
  }

  async deleteJob(req, res, next) {
    try {
      const { id } = req.params;
      await roboTestService.deleteJob(id, req.user);
      res.json({
        success: true,
        message: 'Robo test record deleted successfully.'
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new RoboTestController();
