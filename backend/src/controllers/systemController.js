const fs = require('fs');
const config = require('../config');
const adbService = require('../services/adbService');
const iosService = require('../services/iosService');
const bundletoolService = require('../services/bundletoolService');

class SystemController {
  async getDiagnostics(req, res, next) {
    try {
      const [javaInfo, adbInfo, bundletoolInfo, adbDevices, iosDiagnostics, iosDevices] = await Promise.all([
        bundletoolService.checkJava(),
        adbService.checkAvailability(),
        bundletoolService.checkBundletool(),
        adbService.listDevices(),
        iosService.getDiagnostics().catch(() => ({
          pythonAvailable: false,
          pymobiledevice3Available: false,
          usbmuxdReachable: false,
          connectedDevicesCount: 0,
          error: 'Failed to query iOS diagnostics'
        })),
        iosService.listDevices().catch(() => [])
      ]);

      const allDevices = [...adbDevices, ...iosDevices];

      // Check upload and log directory writability
      let uploadDirWritable = false;
      let logDirWritable = false;
      try {
        fs.accessSync(config.UPLOAD_DIR, fs.constants.W_OK);
        uploadDirWritable = true;
      } catch (e) {}

      try {
        fs.accessSync(config.LOG_DIR, fs.constants.W_OK);
        logDirWritable = true;
      } catch (e) {}

      const diagnostics = {
        server: {
          status: 'Running',
          appVersion: config.APP_VERSION,
          displayVersion: config.DISPLAY_VERSION,
          nodeVersion: process.version,
          platform: process.platform,
          uptimeSeconds: Math.floor(process.uptime()),
          port: config.PORT,
          env: config.NODE_ENV
        },
        tools: {
          java: {
            available: javaInfo.available,
            version: javaInfo.version || null,
            path: config.JAVA_PATH,
            error: javaInfo.error || null
          },
          adb: {
            available: adbInfo.available,
            version: adbInfo.version || null,
            path: config.ADB_PATH,
            error: adbInfo.error || null
          },
          bundletool: {
            available: bundletoolInfo.available,
            version: bundletoolInfo.version || null,
            path: bundletoolInfo.path || config.BUNDLETOOL_PATH,
            error: bundletoolInfo.error || null
          },
          iosBridge: {
            available: iosDiagnostics.pymobiledevice3Available && iosDiagnostics.usbmuxdReachable,
            pythonAvailable: iosDiagnostics.pythonAvailable,
            pythonVersion: iosDiagnostics.pythonVersion,
            pymobiledevice3Version: iosDiagnostics.pymobiledevice3Version,
            usbmuxdReachable: iosDiagnostics.usbmuxdReachable,
            connectedIosDevicesCount: iosDevices.length,
            error: iosDiagnostics.error || null
          }
        },
        devices: {
          count: allDevices.length,
          connectedCount: allDevices.filter(d => d.connected).length,
          androidCount: adbDevices.filter(d => d.connected).length,
          iosCount: iosDevices.filter(d => d.connected).length,
          list: allDevices
        },
        storage: {
          uploadDir: config.UPLOAD_DIR,
          uploadDirWritable,
          logDir: config.LOG_DIR,
          logDirWritable,
          maxUploadSizeMb: config.MAX_AAB_SIZE_MB,
          diskStatus: 'Available'
        },
        timestamp: new Date().toISOString()
      };

      res.json({ success: true, diagnostics });
    } catch (err) {
      next(err);
    }
  }

  getEnv(req, res) {
    // Expose only safe configuration
    res.json({
      success: true,
      config: {
        appVersion: config.APP_VERSION,
        displayVersion: config.DISPLAY_VERSION,
        port: config.PORT,
        maxUploadMb: config.MAX_AAB_SIZE_MB,
        isInternalQa: config.IS_INTERNAL_QA,
        adbConfigured: !!config.ADB_PATH,
        javaConfigured: !!config.JAVA_PATH,
        bundletoolConfigured: !!config.BUNDLETOOL_PATH
      }
    });
  }
}

module.exports = new SystemController();
