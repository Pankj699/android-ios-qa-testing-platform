const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class DeviceLockService {
  constructor() {
    this.ownershipFile = path.join(config.DATA_DIR, 'devices_ownership.json');
    this.hardwareMapFile = path.join(config.DATA_DIR, 'devices_hardware_map.json');

    this.locks = new Map(); // serial/ip/hwId -> active test execution lock
    this.ownership = new Map(); // serial/ip/hwId -> { userId, userName, userEmail, connectedAt }
    this.hardwareMap = new Map(); // serial/ip -> hardwareSerial
    this.claims = new Map(); // Deprecated legacy container
    this._takeoverLocks = new Set();
    this._recentTakeovers = new Map();

    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(config.DATA_DIR)) {
        fs.mkdirSync(config.DATA_DIR, { recursive: true });
      }

      // Load ownership mappings
      if (fs.existsSync(this.ownershipFile)) {
        const raw = fs.readFileSync(this.ownershipFile, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data === 'object' && data !== null) {
          for (const [key, val] of Object.entries(data)) {
            this.ownership.set(key, val);
          }
          logger.info(`[DeviceLock] Loaded ${this.ownership.size} persisted device ownership mappings.`);
        }
      } else {
        this._persistOwnership();
      }

      // Load hardware mappings
      if (fs.existsSync(this.hardwareMapFile)) {
        const raw = fs.readFileSync(this.hardwareMapFile, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data === 'object' && data !== null) {
          for (const [key, val] of Object.entries(data)) {
            this.hardwareMap.set(key, val);
          }
        }
      }
    } catch (err) {
      logger.error(`[DeviceLock] Failed to initialize device ownership store: ${err.message}`);
    }
  }

  _persistOwnership() {
    try {
      const obj = {};
      for (const [k, v] of this.ownership.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.ownershipFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      logger.error(`[DeviceLock] Failed to persist device ownership: ${err.message}`);
    }
  }

  _persistHardwareMap() {
    try {
      const obj = {};
      for (const [k, v] of this.hardwareMap.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.hardwareMapFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      logger.error(`[DeviceLock] Failed to persist hardware map: ${err.message}`);
    }
  }

  /**
   * Bind a connection identifier (e.g. 192.168.0.22:43827) to a stable hardware serial (e.g. R52X808W8QK).
   */
  registerHardwareSerial(serial, hardwareSerial) {
    if (!serial || !hardwareSerial) return;
    this.hardwareMap.set(serial, hardwareSerial);
    if (serial.includes(':')) {
      this.hardwareMap.set(serial.split(':')[0], hardwareSerial);
    }
    const owner = this.ownership.get(serial) || (serial.includes(':') ? this.ownership.get(serial.split(':')[0]) : null);
    if (owner && !this.ownership.has(hardwareSerial)) {
      this.ownership.set(hardwareSerial, owner);
    }
    this._persistHardwareMap();
  }

  /**
   * Set device owner (e.g. when connected/paired by user).
   */
  setOwner(serial, user) {
    if (!serial || !user) return;

    const oldOwner = this.getOwner(serial);
    const hwSerial = this.hardwareMap.get(serial);
    if (oldOwner && oldOwner.userId !== user.id) {
      this._cleanupDeviceResources(serial, hwSerial, oldOwner);
    }

    const ownerData = {
      userId: user.id,
      userName: user.name || 'QA Tester',
      userEmail: (user.email || '').toLowerCase(),
      connectedAt: new Date().toISOString()
    };

    this.ownership.set(serial, ownerData);
    if (serial.includes(':')) {
      const bareIp = serial.split(':')[0];
      if (bareIp) {
        this.ownership.set(bareIp, ownerData);
      }
    }

    if (hwSerial) {
      this.ownership.set(hwSerial, ownerData);
    }

    this._persistOwnership();
    logger.info(`[DeviceLock] Device ${serial} ownership assigned to ${user.name} (${user.email || user.id})`);
  }

  /**
   * Get device owner (checks exact serial, bare IP, and hardware serial)
   */
  getOwner(serial) {
    if (!serial) return null;
    if (this.ownership.has(serial)) {
      return this.ownership.get(serial);
    }
    if (serial.includes(':')) {
      const bareIp = serial.split(':')[0];
      if (this.ownership.has(bareIp)) {
        return this.ownership.get(bareIp);
      }
    }
    const hwSerial = this.hardwareMap.get(serial);
    if (hwSerial && this.ownership.has(hwSerial)) {
      return this.ownership.get(hwSerial);
    }
    return null;
  }

  /**
   * Legacy Claim retrieval — permanently deprecated; always returns null.
   */
  getClaim(serial) {
    return null;
  }

  /**
   * Clear transient connection ownership (e.g. on adb disconnect).
   */
  clearOwner(serial) {
    if (!serial) return;
    this.ownership.delete(serial);
    if (serial.includes(':')) {
      const bareIp = serial.split(':')[0];
      this.ownership.delete(bareIp);
    }
    const hwSerial = this.hardwareMap.get(serial);
    if (hwSerial) {
      this.ownership.delete(hwSerial);
    }
    try {
      const adbService = require('./adbService');
      if (adbService && adbService.clearFallback) {
        adbService.clearFallback(hwSerial || serial);
      }
    } catch (e) {}
    this._persistOwnership();
    logger.info(`[DeviceLock] Device ${serial} connection ownership cleared.`);
  }

  /**
   * Get active lock for device serial.
   * Lock remains valid as long as claim is active.
   */
  getLock(serial) {
    if (!serial) return null;
    let lock = this.locks.get(serial);
    if (!lock && serial.includes(':')) {
      lock = this.locks.get(serial.split(':')[0]);
    }
    if (!lock) {
      const hwSerial = this.hardwareMap.get(serial);
      if (hwSerial) lock = this.locks.get(hwSerial);
    }
    return lock || null;
  }

  /**
   * Safely clean up device-specific active resources (mirror, test sessions, logcat)
   * belonging to previous owner when claim is transferred.
   */
  _cleanupDeviceResources(serial, hardwareSerial, oldClaim) {
    try {
      const screenMirrorService = require('./screenMirrorService');
      if (screenMirrorService) {
        if (serial) screenMirrorService.stopMirror(serial);
        if (oldClaim?.serial && oldClaim.serial !== serial) {
          screenMirrorService.stopMirror(oldClaim.serial);
        }
        if (hardwareSerial) screenMirrorService.stopMirror(hardwareSerial);
      }
    } catch (e) {
      logger.debug(`[DeviceLock] Screen mirror cleanup notice: ${e.message}`);
    }

    try {
      const testRunnerService = require('./testRunnerService');
      if (testRunnerService && testRunnerService.activeTests) {
        for (const [testId, active] of testRunnerService.activeTests.entries()) {
          const devSerial = active.testData?.deviceSerial;
          const testUserId = active.testData?.userId;
          const matchesDevice = devSerial === serial || devSerial === hardwareSerial || (oldClaim && devSerial === oldClaim.serial);
          const matchesUser = oldClaim ? testUserId === oldClaim.userId : true;
          if (matchesDevice && matchesUser) {
            try {
              testRunnerService.cancelTest(testId, null);
            } catch (err) {
              testRunnerService.activeTests.delete(testId);
            }
          }
        }
      }
    } catch (e) {
      logger.debug(`[DeviceLock] Test runner cleanup notice: ${e.message}`);
    }

    try {
      const { terminateDeviceLogcat } = require('../websocket/testSocket');
      if (terminateDeviceLogcat) {
        terminateDeviceLogcat(serial, hardwareSerial, oldClaim?.userId);
      }
    } catch (e) {
      logger.debug(`[DeviceLock] WebSocket logcat cleanup notice: ${e.message}`);
    }
  }

  /**
   * Legacy Claim Device — Deprecated shim mapping to connection ownership.
   */
  claimDevice(serial, user, options = {}) {
    logger.debug(`[DeviceLock] claimDevice called for ${serial} (maps to connection ownership).`);
    if (!serial) throw new Error('Device serial is required.');
    if (!user) throw new Error('User authentication required.');

    const userId = user.id;
    const userEmail = (user.email || '').toLowerCase();
    const existingOwner = this.getOwner(serial) || this.getClaim(serial);

    const isMatchUser = (o) => o && (o.userId === userId || (userEmail && (o.userEmail || '').toLowerCase() === userEmail));

    if (existingOwner && !isMatchUser(existingOwner) && !options.forceTakeover) {
      throw new Error(`Device ${serial} is already claimed or owned by another user (${existingOwner.userName || 'another user'}).`);
    }

    if (options.hardwareSerial) {
      this.registerHardwareSerial(serial, options.hardwareSerial);
    }
    this.setOwner(serial, user);

    return {
      serial,
      userId: user.id,
      userName: user.name || 'QA Tester',
      deprecated: true
    };
  }

  /**
   * Get claim for device serial (compatibility container).
   */
  getClaim(serial) {
    if (!serial) return null;
    if (this.claims.has(serial)) {
      return this.claims.get(serial);
    }
    if (serial.includes(':')) {
      const bareIp = serial.split(':')[0];
      if (this.claims.has(bareIp)) {
        return this.claims.get(bareIp);
      }
    }
    const hwSerial = this.hardwareMap.get(serial);
    if (hwSerial && this.claims.has(hwSerial)) {
      return this.claims.get(hwSerial);
    }
    return null;
  }

  /**
   * Legacy Transfer Claim — Deprecated.
   */
  transferClaim(serial, user, options = {}) {
    return this.claimDevice(serial, user, options);
  }

  /**
   * Legacy Migrate Claim — Deprecated.
   */
  migrateClaim(fromSerial, toSerial, hardwareSerial) {
    if (hardwareSerial) {
      this.registerHardwareSerial(toSerial, hardwareSerial);
    }
    const owner = this.getOwner(fromSerial);
    if (owner) {
      this.setOwner(toSerial, { id: owner.userId, name: owner.userName, email: owner.userEmail });
    }
    return null;
  }

  /**
   * Legacy Release Device — Deprecated.
   */
  releaseDevice(serial, user, force = false) {
    logger.debug(`[DeviceLock] releaseDevice called for ${serial} (maps to connection ownership cleanup).`);
    if (serial) {
      this.clearOwner(serial);
      this.claims.delete(serial);
      if (serial.includes(':')) {
        this.claims.delete(serial.split(':')[0]);
      }
      const hwSerial = this.hardwareMap.get(serial);
      if (hwSerial) {
        this.claims.delete(hwSerial);
      }
    }
    return true;
  }

  /**
   * Check if user has visibility to device:
   * 1. If device is connected through Agent, verify Agent ownership.
   * 2. If device has a connected owner, verify owner match.
   * 3. Unowned connected devices are visible to authenticated users.
   */
  isUserDevice(serial, user) {
    if (!user || !serial) return false;
    const userId = user.id;
    const userEmail = (user.email || '').toLowerCase();

    // If device is an Agent-connected device, check Agent ownership
    try {
      const agentService = require('./agentService');
      if (agentService && agentService.isAgentIosDevice(serial)) {
        return !!agentService.getAgentDevice(serial, user);
      }
    } catch (e) {}

    // Check connection owner
    const owner = this.getOwner(serial);
    if (owner) {
      return Boolean(owner.userId === userId || (userEmail && owner.userEmail === userEmail));
    }

    // Unowned -> visible to all authenticated users
    return true;
  }

  /**
   * Check if user can run tests, stream screen mirror, or execute ADB actions on device
   */
  isDeviceAccessible(serial, user) {
    if (!user) return false;
    return this.isUserDevice(serial, user);
  }

  /**
   * Decorate device object with neutral compatibility fields and connection ownership status
   */
  decorateDevice(device, user) {
    if (!device) return device;
    const serial = device.id || device.serial;
    const isAgentUsb = device.connectionMode === 'agent-usb' || !!device.agentId;
    const owner = isAgentUsb ? null : this.getOwner(serial);

    const isOwner = isAgentUsb || (owner && (owner.userId === user?.id || (user?.email && owner.userEmail === (user?.email || '').toLowerCase())));

    // Neutral compatibility fields per specification (claims removed)
    const lockInfo = {
      isLocked: false,
      isLockedByMe: false,
      lockedBy: null,
      lockedByEmail: null,
      lockedAt: null,
      expiresInSeconds: 0,
      testId: null
    };

    const ownerInfo = {
      isOwner: Boolean(isOwner),
      ownerName: isAgentUsb ? (device.userName || 'You') : (owner ? owner.userName : null)
    };

    const connectionMode = device.connectionMode || (serial.startsWith('browser_usb_') ? 'browser-usb' : 'server-adb');

    return {
      ...device,
      connectionMode,
      isClaimed: false,
      isClaimedByMe: false,
      claimedBy: null,
      lock: lockInfo,
      owner: ownerInfo
    };
  }

  /**
   * Decorate array of devices and strictly filter according to connected status and claim/ownership visibility rules
   */
  decorateDevices(devices = [], user) {
    if (!user) return [];

    const filtered = devices
      .filter(d => {
        if (!d) return false;
        // Strictly require real active connection (state === 'device' or platform === 'ios')
        if (!d.connected || (d.state !== 'device' && d.platform !== 'ios')) {
          return false;
        }

        const serial = d.id || d.serial || '';
        // Discard any mDNS discovery artifacts or invalid serials
        if (serial.includes('_adb-tls-') || serial.includes('._tcp') || (serial.startsWith('adb-') && serial.includes('._'))) {
          return false;
        }

        return this.isUserDevice(serial, user);
      });

    // Deduplicate physical devices: if two transports share the same hardwareSerial, prefer USB over Wireless
    const deduplicated = [];
    const seenHw = new Map(); // hwSerial -> index in deduplicated

    for (const dev of filtered) {
      const serial = dev.id || dev.serial;
      const hwSerial = dev.hardwareSerial || this.hardwareMap.get(serial) || (serial.includes(':') ? this.hardwareMap.get(serial.split(':')[0]) : null);

      if (hwSerial) {
        if (seenHw.has(hwSerial)) {
          const existingIdx = seenHw.get(hwSerial);
          const existingDev = deduplicated[existingIdx];
          // If existing is wireless and new is USB, replace with USB!
          if (existingDev.isWireless && !dev.isWireless) {
            deduplicated[existingIdx] = dev;
          }
          // Otherwise keep the first (authoritative/USB)
        } else {
          seenHw.set(hwSerial, deduplicated.length);
          deduplicated.push(dev);
        }
      } else {
        deduplicated.push(dev);
      }
    }

    return deduplicated.map(d => this.decorateDevice(d, user));
  }
}

module.exports = new DeviceLockService();
