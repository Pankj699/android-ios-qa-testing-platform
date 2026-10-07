const adbService = require('../services/adbService');
const iosService = require('../services/iosService');
const deviceLockService = require('../services/deviceLockService');

class AdbController {
  async clearData(req, res, next) {
    try {
      const serial = req.params.id;
      if (iosService.isIosDevice(serial)) {
        return res.status(400).json({ success: false, error: 'Operation not supported on iOS devices. Target device is not an Android device.' });
      }

      const { packageName } = req.body;
      if (!packageName) {
        return res.status(400).json({ success: false, error: 'Package name is required.' });
      }

      if (!deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).json({ success: false, error: 'Device is not accessible or claimed by another user.' });
      }

      const result = await adbService.clearAppData(serial, packageName);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async clearCache(req, res, next) {
    try {
      const serial = req.params.id;
      if (iosService.isIosDevice(serial)) {
        return res.status(400).json({ success: false, error: 'Operation not supported on iOS devices. Target device is not an Android device.' });
      }

      const { packageName } = req.body;
      if (!packageName) {
        return res.status(400).json({ success: false, error: 'Package name is required.' });
      }

      if (!deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).json({ success: false, error: 'Device is not accessible or claimed by another user.' });
      }

      const result = await adbService.clearAppCache(serial, packageName);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async uninstall(req, res, next) {
    try {
      const serial = req.params.id;
      if (iosService.isIosDevice(serial)) {
        return res.status(400).json({ success: false, error: 'Operation not supported on iOS devices. Target device is not an Android device.' });
      }

      const { packageName } = req.body;
      if (!packageName) {
        return res.status(400).json({ success: false, error: 'Package name is required.' });
      }

      if (!deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).json({ success: false, error: 'Device is not accessible or claimed by another user.' });
      }

      const result = await adbService.uninstallApp(serial, packageName);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async launch(req, res, next) {
    try {
      const serial = req.params.id;
      if (iosService.isIosDevice(serial)) {
        return res.status(400).json({ success: false, error: 'Operation not supported on iOS devices. Target device is not an Android device.' });
      }

      const { packageName } = req.body;
      if (!packageName) {
        return res.status(400).json({ success: false, error: 'Package name is required.' });
      }

      if (!deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).json({ success: false, error: 'Device is not accessible or claimed by another user.' });
      }

      const result = await adbService.launchApp(serial, packageName);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async clearLogcat(req, res, next) {
    try {
      const serial = req.params.id;
      if (iosService.isIosDevice(serial)) {
        return res.status(400).json({ success: false, error: 'Operation not supported on iOS devices. Target device is not an Android device.' });
      }

      if (!deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).json({ success: false, error: 'Device is not accessible or claimed by another user.' });
      }

      const result = await adbService.clearLogcat(serial);
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async executeSafeCommand(req, res, next) {
    try {
      const { serial, command } = req.body;
      if (!command) {
        return res.status(400).json({ success: false, error: 'Command string is required.' });
      }

      if (serial && iosService.isIosDevice(serial)) {
        return res.status(400).json({ success: false, error: 'ADB commands cannot be executed on iOS devices.' });
      }

      if (serial && !deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).json({ success: false, error: 'Device is not accessible or claimed by another user.' });
      }

      const result = await adbService.runSafeAdbCommand(serial, command);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AdbController();
