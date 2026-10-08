const path = require('path');
const fs = require('fs');
const adbService = require('../services/adbService');
const iosService = require('../services/iosService');
const iosMirrorService = require('../services/iosMirrorService');
const deviceLockService = require('../services/deviceLockService');
const screenMirrorService = require('../services/screenMirrorService');
const agentService = require('../services/agentService');
const agentMirrorService = require('../services/agentMirrorService');
const { broadcastEvent } = require('../websocket/testSocket');
const logger = require('../utils/logger');

class DeviceController {
  async listDevices(req, res, next) {
    try {
      if (!req.user) {
        return res.json({ success: true, count: 0, devices: [] });
      }

      // Fetch Android devices via ADB
      const rawAndroidDevices = await adbService.listDevices().catch((err) => {
        logger.debug(`[DeviceController] ADB listDevices error: ${err.message}`);
        return [];
      });

      // Fetch iOS devices via pymobiledevice3 bridge
      const rawIosDevices = await iosService.listDevices().catch((err) => {
        logger.debug(`[DeviceController] iOS listDevices error: ${err.message}`);
        return [];
      });

      // Fetch iOS devices discovered via paired QA Device Agents
      const agentDevices = agentService.listAgentDevices(req.user);

      const rawDevices = [...rawAndroidDevices, ...rawIosDevices, ...agentDevices];
      const devices = deviceLockService.decorateDevices(rawDevices, req.user);
      res.json({ success: true, count: devices.length, devices });
    } catch (err) {
      next(err);
    }
  }

  async pairDevice(req, res, next) {
    try {
      const { ip, port, code } = req.body;
      if (!ip || !port || !code) {
        return res.status(400).json({
          success: false,
          error: 'Device IP, Pairing Port, and 6-digit Pairing Code are required.'
        });
      }

      const result = await adbService.pairDevice(ip, port, code);
      if (result.success && req.user) {
        deviceLockService.setOwner(`${ip}:${port}`, req.user);
        deviceLockService.setOwner(ip, req.user);
        broadcastEvent('DEVICES_UPDATED');
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async connectDevice(req, res, next) {
    try {
      const { ip, port } = req.body;
      if (!ip || !port) {
        return res.status(400).json({
          success: false,
          error: 'Device IP and Connection Port are required.'
        });
      }

      const result = await adbService.connectDevice(ip, port);
      if (result.success && req.user) {
        const serial = result.serial || `${ip}:${port}`;
        const hardwareSerial = result.device?.hardwareSerial || deviceLockService.hardwareMap.get(serial) || deviceLockService.hardwareMap.get(ip) || null;

        // Transport Priority: Check if physical device is already connected via authoritative USB
        if (hardwareSerial) {
          const rawAndroidDevices = await adbService.listDevices({ connectedOnly: true }).catch(() => []);
          const existingUsb = rawAndroidDevices.find(d => !d.isWireless && (d.serial === hardwareSerial || d.hardwareSerial === hardwareSerial) && d.state === 'device');
          if (existingUsb) {
            logger.info(`[ConnectDevice] Physical device ${hardwareSerial} is already connected via authoritative USB (${existingUsb.serial}). Deduplicating redundant wireless transport ${serial}.`);

            // Record fallback
            if (!adbService.wirelessFallbacks) adbService.wirelessFallbacks = new Map();
            adbService.wirelessFallbacks.set(hardwareSerial, {
              serial,
              ip,
              port: parseInt(port, 10),
              hardwareSerial,
              savedAt: Date.now()
            });

            // Disconnect redundant wireless transport
            await adbService.disconnectDevice(serial).catch(() => {});

            deviceLockService.setOwner(existingUsb.serial, req.user);

            broadcastEvent('DEVICES_UPDATED');
            return res.json({
              success: true,
              serial: existingUsb.serial,
              message: `Device connected via authoritative USB transport (${existingUsb.serial}). Redundant wireless transport deduplicated.`,
              device: deviceLockService.decorateDevice(existingUsb, req.user),
              isAuthoritative: true,
              transportPriority: 'usb'
            });
          }
        }

        deviceLockService.setOwner(serial, req.user);
        broadcastEvent('DEVICES_UPDATED');
      }
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async disconnectDevice(req, res, next) {
    try {
      const serial = req.params.id || req.body.serial;
      if (!serial) {
        return res.status(400).json({ success: false, error: 'Device serial is required.' });
      }

      if (!deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).json({ success: false, error: 'Device is claimed by another user.' });
      }

      // Handle iOS device disconnect
      if (iosService.isIosDevice(serial)) {
        iosMirrorService.stopMirror(serial, req.user);
        const result = await iosService.disconnectDevice(serial);
        broadcastEvent('DEVICES_UPDATED');
        return res.json(result);
      }

      // Android device disconnect (stops stream & drops transport, preserves persistent claim)
      screenMirrorService.stopMirror(serial, req.user);
      const result = await adbService.disconnectDevice(serial);
      broadcastEvent('DEVICES_UPDATED');
      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  async getDeviceInfo(req, res, next) {
    try {
      const serial = req.params.id;
      if (!serial) {
        return res.status(400).json({ success: false, error: 'Device serial is required.' });
      }

      if (!deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).json({ success: false, error: 'Device is claimed by another user.' });
      }

      let rawInfo;
      if (agentService.isAgentIosDevice(serial)) {
        rawInfo = agentService.getAgentDevice(serial, req.user);
      } else if (iosService.isIosDevice(serial)) {
        rawInfo = await iosService.getDeviceInfo(serial);
      } else {
        rawInfo = await adbService.getDeviceInfo(serial);
      }

      const info = deviceLockService.decorateDevice(rawInfo, req.user);
      res.json({ success: true, device: info });
    } catch (err) {
      next(err);
    }
  }

  async getStorage(req, res, next) {
    try {
      const serial = req.params.id;
      let info;
      if (iosService.isIosDevice(serial)) {
        info = await iosService.getDeviceInfo(serial);
      } else {
        info = await adbService.getDeviceInfo(serial);
      }

      res.json({
        success: true,
        serial,
        storageFree: info.storageFree,
        storageTotal: info.storageTotal,
        storageUsedPct: info.storageUsedPct
      });
    } catch (err) {
      next(err);
    }
  }

  async claimDevice(req, res, next) {
    res.status(410).json({
      success: false,
      error: 'Device claim functionality has been removed from this platform.',
      code: 'CLAIM_RELEASE_DEPRECATED'
    });
  }

  async releaseDevice(req, res, next) {
    res.status(410).json({
      success: false,
      error: 'Device release functionality has been removed from this platform.',
      code: 'CLAIM_RELEASE_DEPRECATED'
    });
  }

  // --- Screen Mirroring & Screenshot Endpoints ---

  async startMirror(req, res, next) {
    try {
      const serial = req.params.id;

      if (agentService.isAgentIosDevice(serial)) {
        const result = await agentMirrorService.startMirror(serial, req.user, req.body);
        return res.json(result);
      }

      if (iosService.isIosDevice(serial)) {
        const result = await iosMirrorService.startMirror(serial, req.user, req.body);
        return res.json(result);
      }

      const options = {
        width: req.body.width ? parseInt(req.body.width, 10) : undefined,
        height: req.body.height ? parseInt(req.body.height, 10) : undefined,
        bitrate: req.body.bitrate ? parseInt(req.body.bitrate, 10) : undefined,
        fps: req.body.fps ? parseInt(req.body.fps, 10) : undefined
      };

      const result = await screenMirrorService.startMirror(serial, req.user, options);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async stopMirror(req, res, next) {
    try {
      const serial = req.params.id;

      if (agentService.isAgentIosDevice(serial)) {
        const result = await agentMirrorService.stopMirror(serial, req.user);
        return res.json(result);
      }

      if (iosService.isIosDevice(serial)) {
        const result = iosMirrorService.stopMirror(serial, req.user);
        return res.json(result);
      }

      const result = screenMirrorService.stopMirror(serial, req.user);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async getMirrorStatus(req, res, next) {
    try {
      const serial = req.params.id;

      if (agentService.isAgentIosDevice(serial)) {
        const status = agentMirrorService.getMirrorStatus(serial);
        return res.json({ success: true, status });
      }

      if (iosService.isIosDevice(serial)) {
        const status = iosMirrorService.getMirrorStatus(serial);
        return res.json({ success: true, status });
      }

      const status = screenMirrorService.getMirrorStatus(serial);
      res.json({ success: true, status });
    } catch (err) {
      next(err);
    }
  }

  async captureScreenshot(req, res, next) {
    try {
      const serial = req.params.id;

      if (iosService.isIosDevice(serial)) {
        const result = await iosMirrorService.captureScreenshot(serial, req.user);
        return res.json(result);
      }

      const result = await screenMirrorService.captureScreenshot(serial, req.user);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async proxyIosStream(req, res, next) {
    try {
      const serial = req.params.id;
      if (!deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).send('Device is claimed by another user.');
      }
      if (agentService.isAgentIosDevice(serial)) {
        return agentMirrorService.proxyStreamRequest(serial, req, res);
      }
      iosMirrorService.proxyStreamRequest(serial, req, res);
    } catch (err) {
      next(err);
    }
  }

  async sendInput(req, res, next) {
    try {
      const serial = req.params.id;
      const event = req.body;
      const result = await screenMirrorService.sendInput(serial, req.user, event);
      res.json(result);
    } catch (err) {
      res.status(400).json({ success: false, error: err.message });
    }
  }

  async getScreenshotFile(req, res, next) {
    try {
      const { filename } = req.params;
      const safeFilename = path.basename(filename);
      const filePath = path.join(screenMirrorService.screenshotsDir, safeFilename);

      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: 'Screenshot not found' });
      }

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `inline; filename="${safeFilename}"`);
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      next(err);
    }
  }

  async executeAgentCommand(req, res, next) {
    try {
      const serial = req.params.id;
      if (!serial) {
        return res.status(400).json({ success: false, error: 'Device serial is required.' });
      }

      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }

      const dev = agentService.getAgentDevice(serial, req.user);
      if (!dev) {
        return res.status(404).json({ success: false, error: 'Device not found or unauthorized.' });
      }

      if (dev.platform !== 'ios') {
        return res.status(400).json({
          success: false,
          error: 'Agent command transport is only supported on iOS devices.'
        });
      }

      const { command, args } = req.body;
      if (!command || typeof command !== 'string') {
        return res.status(400).json({ success: false, error: 'Command name is required.' });
      }

      const ALLOWLIST = ['DEVICE_INFO', 'APP_LAUNCH', 'APP_TERMINATE', 'SYSLOG'];
      if (!ALLOWLIST.includes(command)) {
        return res.status(400).json({
          success: false,
          error: `Command '${command}' is not supported. Approved commands: ${ALLOWLIST.join(', ')}`
        });
      }

      // Argument validation
      if (command === 'APP_LAUNCH' || command === 'APP_TERMINATE') {
        const bundleId = args?.bundleId;
        if (bundleId) {
          const BUNDLE_REGEX = /^[a-zA-Z0-9]+(\.[a-zA-Z0-9_-]+)+$/;
          if (typeof bundleId !== 'string' || !BUNDLE_REGEX.test(bundleId) || bundleId.length > 255) {
            return res.status(400).json({
              success: false,
              error: 'Invalid bundleId format. Must be a valid application identifier (e.g. com.example.app).'
            });
          }
        } else if (command === 'APP_LAUNCH') {
          return res.status(400).json({ success: false, error: 'bundleId is required for APP_LAUNCH.' });
        }
      }

      const result = await agentService.sendCommandToAgent(dev.agentId, dev.udid, command, args || {});
      res.json({
        success: true,
        command,
        deviceId: dev.udid,
        result
      });
    } catch (err) {
      const status = err.code === 'AGENT_COMMAND_TIMEOUT' ? 504 : (err.code === 'AGENT_OFFLINE' ? 503 : 400);
      res.status(status).json({
        success: false,
        error: {
          code: err.code || 'COMMAND_ERROR',
          message: err.message
        }
      });
    }
  }

  async getInstalledApps(req, res, next) {
    try {
      const serial = req.params.id;
      if (!serial) {
        return res.status(400).json({ success: false, error: 'Device serial is required.' });
      }

      // Verify device accessibility
      if (!deviceLockService.isDeviceAccessible(serial, req.user)) {
        return res.status(403).json({ success: false, error: 'Device is claimed by another user.' });
      }

      if (iosService.isIosDevice(serial)) {
        return res.json({ success: true, count: 0, packages: [], apps: [] });
      }

      const includeSystem = req.query.includeSystem === 'true';
      const apps = await adbService.listInstalledPackages(serial, { includeSystem });
      res.json({ success: true, count: apps.length, packages: apps, apps });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new DeviceController();
