const fs = require('fs');
const path = require('path');
const testRunnerService = require('../services/testRunnerService');
const historyService = require('../services/historyService');
const adbService = require('../services/adbService');
const iosService = require('../services/iosService');
const deviceLockService = require('../services/deviceLockService');
const config = require('../config');

class TestController {
  async runTest(req, res, next) {
    try {
      const {
        buildId,
        deviceSerial,
        installMode = 'fresh',
        launchApp = true,
        uninstallConfirmed = false,
        monitoringTimeoutSec = 12
      } = req.body;

      if (!buildId) {
        return res.status(400).json({ success: false, error: 'Build ID is required to run test.' });
      }
      if (!deviceSerial) {
        return res.status(400).json({ success: false, error: 'Target device serial is required.' });
      }

      if (iosService.isIosDevice(deviceSerial)) {
        return res.status(400).json({
          success: false,
          error: 'PAD and Bundletool testing is only supported on Android devices. Target device is an iOS device.'
        });
      }

      const build = historyService.getBuildById(buildId);
      if (!build) {
        return res.status(404).json({ success: false, error: `Build with ID ${buildId} not found.` });
      }

      // Check device availability & lock ownership
      if (!deviceLockService.isDeviceAccessible(deviceSerial, req.user)) {
        const lock = deviceLockService.getLock(deviceSerial);
        return res.status(409).json({
          success: false,
          error: `Device ${deviceSerial} is currently claimed by ${lock ? lock.userName : 'another user'}.`
        });
      }

      // Check if package already exists on device
      if (installMode === 'fresh' && !uninstallConfirmed && build.packageName) {
        const isInstalled = await adbService.isPackageInstalled(deviceSerial, build.packageName);
        if (isInstalled) {
          return res.status(409).json({
            success: false,
            needsConfirmation: true,
            message: `An existing installation of ${build.packageName} was detected on device. Do you want to uninstall it before testing?`,
            packageName: build.packageName,
            deviceSerial
          });
        }
      }

      const result = await testRunnerService.runTest({
        buildId,
        aabPath: build.filePath,
        deviceSerial,
        installMode,
        launchApp: launchApp !== false,
        uninstallConfirmed,
        monitoringTimeoutSec: parseInt(monitoringTimeoutSec, 10) || 12,
        user: req.user
      });

      res.status(202).json({
        success: true,
        message: 'Test started successfully',
        testId: result.testId,
        status: result.status
      });
    } catch (err) {
      next(err);
    }
  }

  async monitorInstalledApp(req, res, next) {
    try {
      const { packageName, deviceSerial } = req.body;
      if (!packageName) {
        return res.status(400).json({ success: false, error: 'Package name is required.' });
      }
      if (!deviceSerial) {
        return res.status(400).json({ success: false, error: 'Device serial is required.' });
      }

      if (iosService.isIosDevice(deviceSerial)) {
        return res.status(400).json({
          success: false,
          error: 'Installed application monitoring is currently supported for Android devices.'
        });
      }

      // Check device availability & lock ownership
      if (!deviceLockService.isDeviceAccessible(deviceSerial, req.user)) {
        const lock = deviceLockService.getLock(deviceSerial);
        return res.status(403).json({
          success: false,
          error: `Device ${deviceSerial} is currently claimed by ${lock ? lock.userName : 'another user'}.`
        });
      }

      // Validate package existence on device
      const isInstalled = await adbService.isPackageInstalled(deviceSerial, packageName);
      if (!isInstalled) {
        return res.status(404).json({
          success: false,
          error: `Application '${packageName}' is not installed on device ${deviceSerial}.`
        });
      }

      const result = await testRunnerService.monitorInstalledApp({
        packageName,
        deviceSerial,
        user: req.user
      });

      res.status(202).json({
        success: true,
        testId: result.testId,
        packageName: result.packageName,
        deviceSerial: result.deviceSerial,
        status: result.status,
        message: result.message
      });
    } catch (err) {
      next(err);
    }
  }

  async getTest(req, res, next) {
    try {
      const test = historyService.getTestById(req.params.id);
      if (!test) {
        return res.status(404).json({ success: false, error: 'Test not found.' });
      }

      const userId = req.user?.id;
      const isAdmin = (req.user?.role || '').toLowerCase() === 'admin';
      if (config.AUTH_ENABLED && !isAdmin && test.userId && test.userId !== userId) {
        return res.status(403).json({ success: false, error: 'Forbidden. You do not have permission to view this test.' });
      }

      res.json({ success: true, test });
    } catch (err) {
      next(err);
    }
  }

  async cancelTest(req, res, next) {
    try {
      const result = await testRunnerService.cancelTest(req.params.id, req.user);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async getTestLogs(req, res, next) {
    try {
      const test = historyService.getTestById(req.params.id);
      const userId = req.user?.id;
      const isAdmin = (req.user?.role || '').toLowerCase() === 'admin';
      if (config.AUTH_ENABLED && !isAdmin && test && test.userId && test.userId !== userId) {
        return res.status(403).json({ success: false, error: 'Forbidden. You do not have permission to view these logs.' });
      }

      const logs = historyService.getTestLog(req.params.id);
      res.json({ success: true, testId: req.params.id, logs });
    } catch (err) {
      next(err);
    }
  }

  async downloadTestLogs(req, res, next) {
    try {
      const test = historyService.getTestById(req.params.id);
      const userId = req.user?.id;
      const isAdmin = (req.user?.role || '').toLowerCase() === 'admin';
      if (config.AUTH_ENABLED && !isAdmin && test && test.userId && test.userId !== userId) {
        return res.status(403).json({ success: false, error: 'Forbidden.' });
      }

      const logs = historyService.getTestLog(req.params.id);
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Content-Disposition', `attachment; filename="pad-test-${req.params.id}.log"`);
      res.send(logs);
    } catch (err) {
      next(err);
    }
  }

  async listHistory(req, res, next) {
    try {
      const filters = { ...req.query };
      const userId = req.user?.id;
      const isAdmin = (req.user?.role || '').toLowerCase() === 'admin';
      const showAll = req.query.all === 'true' && isAdmin;

      if (config.AUTH_ENABLED && !showAll && userId) {
        filters.userId = userId;
      }

      const history = historyService.getHistory(filters);
      res.json({ success: true, count: history.length, history });
    } catch (err) {
      next(err);
    }
  }

  async deleteTest(req, res, next) {
    try {
      const test = historyService.getTestById(req.params.id);
      if (test) {
        const userId = req.user?.id;
        const isAdmin = (req.user?.role || '').toLowerCase() === 'admin';
        if (config.AUTH_ENABLED && !isAdmin && test.userId && test.userId !== userId) {
          return res.status(403).json({ success: false, error: 'Forbidden. You do not have permission to delete this test.' });
        }
      }

      historyService.deleteTest(req.params.id);
      res.json({ success: true, message: 'Test history entry deleted.' });
    } catch (err) {
      next(err);
    }
  }

  async getSummary(req, res, next) {
    try {
      const filters = {};
      const userId = req.user?.id;
      const isAdmin = (req.user?.role || '').toLowerCase() === 'admin';
      const showAll = req.query.all === 'true' && isAdmin;

      if (config.AUTH_ENABLED && !showAll && userId) {
        filters.userId = userId;
      }

      const stats = historyService.getSummaryStats(filters);
      res.json({ success: true, stats });
    } catch (err) {
      next(err);
    }
  }

  async prepareBrowserArtifact(req, res, next) {
    try {
      const { buildId } = req.body;
      if (!buildId) {
        return res.status(400).json({ success: false, error: 'Build ID is required.' });
      }

      const build = historyService.getBuildById(buildId);
      if (!build) {
        return res.status(404).json({ success: false, error: `Build with ID ${buildId} not found.` });
      }

      const bundletoolService = require('../services/bundletoolService');
      const filename = `${build.id}_universal.apk`;
      const outputPath = path.join(config.OUTPUT_DIR, filename);

      if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
        await bundletoolService.buildUniversalApk(build.filePath, outputPath);
      }

      const artifactStats = fs.statSync(outputPath);
      res.json({
        success: true,
        filename,
        downloadUrl: `/api/test/artifact/${filename}`,
        size: artifactStats.size,
        packageName: build.packageName,
        version: build.version,
        assetPacks: build.assetPacks || []
      });
    } catch (err) {
      next(err);
    }
  }

  async downloadArtifact(req, res, next) {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(config.OUTPUT_DIR, filename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Artifact file not found or expired.' });
      }

      res.setHeader('Content-Type', 'application/vnd.android.package-archive');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.sendFile(filePath);
    } catch (err) {
      next(err);
    }
  }

  async saveBrowserResult(req, res, next) {
    try {
      const {
        buildId,
        deviceSerial,
        deviceName,
        installMode = 'fresh',
        launchApp = true,
        steps = [],
        status,
        result,
        totalDurationMs = 0,
        logs = [],
        assetPacks = [],
        error = null
      } = req.body;

      const build = buildId ? historyService.getBuildById(buildId) : null;
      const testId = 'test_usb_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6);

      const testRecord = {
        id: testId,
        buildId: buildId || null,
        packageName: build?.packageName || req.body.packageName || 'Unknown',
        version: build?.version || req.body.version || '1.0',
        fileName: build?.fileName || 'Browser USB Build',
        deviceId: deviceSerial || 'browser_usb_device',
        deviceName: deviceName || 'Browser USB Device',
        connectionMode: 'browser-usb',
        installMode,
        launchApp: launchApp !== false,
        status: status || (result === 'PASS' ? 'COMPLETED' : 'FAILED'),
        result: result || (status === 'COMPLETED' ? 'PASS' : 'FAIL'),
        totalDurationMs: totalDurationMs || 0,
        steps: steps || [],
        error: error || null,
        assetPacks: assetPacks || build?.assetPacks || [],
        userId: req.user?.id || null,
        userName: req.user?.username || req.user?.name || 'User',
        createdAt: new Date().toISOString()
      };

      historyService.saveTest(testRecord);

      // Save log file if provided
      if (logs && logs.length > 0) {
        const logContent = Array.isArray(logs) ? logs.join('\n') : String(logs);
        const logPath = path.join(config.LOG_DIR, `test-${testId}.log`);
        try {
          fs.writeFileSync(logPath, logContent, 'utf8');
        } catch (e) {}
      }

      res.status(201).json({
        success: true,
        message: 'Browser USB test result saved successfully',
        test: testRecord
      });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new TestController();
