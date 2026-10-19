const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { formatDeviceDisplayName } = require('../utils/deviceFormatter');

class DeviceLockService {
  constructor() {
    this.ownershipFile = path.join(config.DATA_DIR, 'devices_ownership.json');
    this.hardwareMapFile = path.join(config.DATA_DIR, 'devices_hardware_map.json');
    this.ownershipMetaFile = path.join(config.DATA_DIR, 'devices_ownership_meta.json');

    this.locks = new Map(); // serial/hwId -> active test execution lock
    this.ownership = new Map(); // serial/hwId -> { userId, userName, userEmail, connectedAt }
    this.hardwareMap = new Map(); // serial -> hardwareSerial
    this.claims = new Map(); // Deprecated legacy compatibility container
    this._takeoverLocks = new Set();
    this.deferredResets = new Set(); // serials awaiting test completion before reset
    this.deferredTransfers = new Map(); // serial -> { user, options, requestedAt }
    this._recentTakeovers = new Map();
    this._midnightTimer = null;
    this.ownershipMeta = {
      lastResetDay: null,
      resetGeneration: 0,
      lastResetTimestamp: null
    };
  }

  init() {
    try {
      if (!fs.existsSync(config.DATA_DIR)) {
        fs.mkdirSync(config.DATA_DIR, { recursive: true });
      }

      const isBareIpv4 = (k) => typeof k === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(k.trim());

      // Load ownership mappings
      if (fs.existsSync(this.ownershipFile)) {
        const raw = fs.readFileSync(this.ownershipFile, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data === 'object' && data !== null) {
          for (const [key, val] of Object.entries(data)) {
            // Decouple & purge bare IP keys to prevent DHCP cross-device pollution
            if (!isBareIpv4(key)) {
              this.ownership.set(key, val);
            }
          }
          logger.info(`[DeviceLock] Loaded ${this.ownership.size} persisted device ownership mappings (bare IPs sanitized).`);
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
            // Decouple & purge bare IP keys
            if (!isBareIpv4(key)) {
              this.hardwareMap.set(key, val);
            }
          }
        }
      }

      // Load ownership metadata
      this._loadOwnershipMeta();

      // Check and trigger daily ownership reset if day has rolled over
      this.checkAndTriggerDailyReset();

      // Schedule recurring daily reset timer at midnight in server timezone
      this._scheduleMidnightResetTimer();
    } catch (err) {
      logger.error(`[DeviceLock] Failed to initialize device ownership store: ${err.message}`);
    }
  }

  getTimezone() {
    return config.SERVER_TIMEZONE || process.env.TZ || 'Asia/Kolkata';
  }

  getCurrentDayInTz(tz = this.getTimezone()) {
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      return formatter.format(new Date());
    } catch (e) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  _loadOwnershipMeta() {
    try {
      if (fs.existsSync(this.ownershipMetaFile)) {
        const raw = fs.readFileSync(this.ownershipMetaFile, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          this.ownershipMeta = {
            lastResetDay: data.lastResetDay || null,
            resetGeneration: data.resetGeneration || 0,
            lastResetTimestamp: data.lastResetTimestamp || null
          };
          return;
        }
      }
    } catch (err) {
      logger.error(`[DeviceLock] Failed to load ownership metadata: ${err.message}`);
    }

    this.ownershipMeta = {
      lastResetDay: this.getCurrentDayInTz(),
      resetGeneration: 0,
      lastResetTimestamp: new Date().toISOString()
    };
    this._persistOwnershipMeta();
  }

  _persistOwnershipMeta() {
    try {
      fs.writeFileSync(this.ownershipMetaFile, JSON.stringify(this.ownershipMeta, null, 2), 'utf8');
    } catch (err) {
      logger.error(`[DeviceLock] Failed to persist ownership metadata: ${err.message}`);
    }
  }

  _persistOwnership() {
    try {
      const isBareIpv4 = (k) => typeof k === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(k.trim());
      const obj = {};
      for (const [k, v] of this.ownership.entries()) {
        if (!isBareIpv4(k)) {
          obj[k] = v;
        }
      }
      fs.writeFileSync(this.ownershipFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      logger.error(`[DeviceLock] Failed to persist device ownership: ${err.message}`);
    }
  }

  _persistHardwareMap() {
    try {
      const isBareIpv4 = (k) => typeof k === 'string' && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(k.trim());
      const obj = {};
      for (const [k, v] of this.hardwareMap.entries()) {
        if (!isBareIpv4(k)) {
          obj[k] = v;
        }
      }
      fs.writeFileSync(this.hardwareMapFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      logger.error(`[DeviceLock] Failed to persist hardware map: ${err.message}`);
    }
  }

  /**
   * Bind a connection identifier (e.g. 192.168.0.22:43827) to a stable hardware serial (e.g. R52X808W8QK).
   * Note: Bare IPs are strictly excluded to avoid DHCP collision.
   */
  registerHardwareSerial(serial, hardwareSerial) {
    if (!serial || !hardwareSerial) return;
    this.hardwareMap.set(serial, hardwareSerial);
    const owner = this.ownership.get(serial);
    if (owner && !this.ownership.has(hardwareSerial)) {
      this.ownership.set(hardwareSerial, owner);
    }
    this._persistHardwareMap();
  }

  /**
   * Retrieve stable physical hardware serial mapped to connection identifier.
   */
  getHardwareSerial(serial) {
    if (!serial) return null;
    return this.hardwareMap.get(serial) || null;
  }

  setActiveTestChecker(fn) {
    this._activeTestChecker = typeof fn === 'function' ? fn : null;
  }

  /**
   * Check if any PAD test, installation, or execution lock is active for a device
   */
  isOperationActive(serial, hardwareSerial) {
    if (!serial && !hardwareSerial) return false;
    const hwSerial = hardwareSerial || this.getHardwareSerial(serial);

    // 1. Check in-memory execution lock
    if (this.locks.has(serial) || (hwSerial && this.locks.has(hwSerial))) {
      return true;
    }

    // 2. Check active test checker callback
    if (typeof this._activeTestChecker === 'function') {
      try {
        if (this._activeTestChecker(serial, hwSerial)) return true;
      } catch (e) {}
    } else {
      try {
        const testRunnerService = require('./testRunnerService');
        if (testRunnerService && typeof testRunnerService.isTestActiveForDevice === 'function') {
          if (testRunnerService.isTestActiveForDevice(serial, hwSerial)) {
            return true;
          }
        }
      } catch (e) {}
    }

    return false;
  }

  /**
   * Called when a test finishes or lock releases, to process deferred resets or transfers
   */
  notifyOperationFinished(serial, hardwareSerial) {
    if (!serial && !hardwareSerial) return;
    const hwSerial = hardwareSerial || this.getHardwareSerial(serial);

    // 1. Process deferred midnight reset
    const hasDeferredReset = this.deferredResets.has(serial) || (hwSerial && this.deferredResets.has(hwSerial));
    if (hasDeferredReset) {
      this.deferredResets.delete(serial);
      if (hwSerial) this.deferredResets.delete(hwSerial);
      this.clearOwner(serial);
      logger.info(`[DeviceLock] Processed deferred midnight ownership reset for ${serial} (${hwSerial || 'none'}).`);
      try {
        const { broadcastEvent } = require('../websocket/testSocket');
        if (broadcastEvent) broadcastEvent('DEVICES_UPDATED');
      } catch (e) {}
      return;
    }

    // 2. Process deferred transfer
    const deferredTransfer = this.deferredTransfers.get(serial) || (hwSerial && this.deferredTransfers.get(hwSerial));
    if (deferredTransfer) {
      this.deferredTransfers.delete(serial);
      if (hwSerial) this.deferredTransfers.delete(hwSerial);
      logger.info(`[DeviceLock] Processing deferred ownership transfer for ${serial} to ${deferredTransfer.user?.name}.`);
      this.transferDeviceOwnership(serial, deferredTransfer.user, deferredTransfer.options).catch(err => {
        logger.error(`[DeviceLock] Deferred transfer failed: ${err.message}`);
      });
    }
  }

  /**
   * Check and trigger daily midnight ownership reset if the server day rolled over.
   */
  checkAndTriggerDailyReset() {
    const currentDay = this.getCurrentDayInTz();
    if (this.ownershipMeta.lastResetDay && this.ownershipMeta.lastResetDay !== currentDay) {
      logger.info(`[DeviceLock] New day detected (${currentDay} vs ${this.ownershipMeta.lastResetDay}). Triggering daily midnight ownership reset.`);
      return this.performDailyReset(currentDay);
    }
    return { reset: false, day: currentDay };
  }

  /**
   * Perform daily midnight ownership reset idempotently.
   * Only ownership mappings are cleared; test history, logs, QA data, and active ADB connections remain untouched.
   * Devices with active tests defer clearing until the test completes.
   */
  performDailyReset(targetDay = null, force = false) {
    const currentDay = targetDay || this.getCurrentDayInTz();
    if (!force && this.ownershipMeta.lastResetDay === currentDay && this.ownershipMeta.resetGeneration > 0) {
      logger.debug(`[DeviceLock] Daily ownership reset already performed for ${currentDay}.`);
      return { reset: false, message: 'Already reset for today', day: currentDay };
    }

    logger.info(`[DeviceLock] Executing daily device ownership reset for ${currentDay}...`);
    let clearedCount = 0;
    let deferredCount = 0;

    for (const [key] of Array.from(this.ownership.entries())) {
      if (this.isOperationActive(key)) {
        logger.info(`[DeviceLock] Device ${key} has active operation. Deferring midnight reset.`);
        this.deferredResets.add(key);
        deferredCount++;
      } else {
        this.ownership.delete(key);
        clearedCount++;
      }
    }

    this.ownershipMeta.lastResetDay = currentDay;
    this.ownershipMeta.resetGeneration = (this.ownershipMeta.resetGeneration || 0) + 1;
    this.ownershipMeta.lastResetTimestamp = new Date().toISOString();

    this._persistOwnershipMeta();
    this._persistOwnership();

    try {
      const { broadcastEvent } = require('../websocket/testSocket');
      if (broadcastEvent) broadcastEvent('DEVICES_UPDATED');
    } catch (e) {}

    logger.info(`[DeviceLock] Daily reset completed (generation ${this.ownershipMeta.resetGeneration}). Cleared: ${clearedCount}, Deferred: ${deferredCount}.`);
    return {
      success: true,
      reset: true,
      clearedCount,
      deferredCount,
      generation: this.ownershipMeta.resetGeneration,
      day: currentDay
    };
  }

  /**
   * Schedule recurring timer for midnight in server timezone.
   */
  _scheduleMidnightResetTimer() {
    if (this._midnightTimer) {
      clearTimeout(this._midnightTimer);
      this._midnightTimer = null;
    }

    try {
      const tz = this.getTimezone();
      const now = new Date();

      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: false
      }).formatToParts(now);

      const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
      const minute = parseInt(parts.find(p => p.type === 'minute')?.value || '0', 10);
      const second = parseInt(parts.find(p => p.type === 'second')?.value || '0', 10);

      const msSinceMidnightInTz = (hour * 3600 + minute * 60 + second) * 1000;
      const msUntilMidnight = Math.max(1000, 86400000 - msSinceMidnightInTz);

      logger.info(`[DeviceLock] Midnight reset scheduled in ${Math.round(msUntilMidnight / 60000)} minutes (${tz}).`);

      this._midnightTimer = setTimeout(() => {
        this.performDailyReset();
        this._scheduleMidnightResetTimer();
      }, msUntilMidnight);

      if (this._midnightTimer && typeof this._midnightTimer.unref === 'function') {
        this._midnightTimer.unref();
      }
    } catch (err) {
      logger.error(`[DeviceLock] Failed to schedule midnight reset timer: ${err.message}`);
    }
  }

  /**
   * Set device owner (e.g. when connected/paired by user).
   */
  setOwner(serial, user) {
    if (!serial || !user) return;

    const oldOwner = this.getOwner(serial);
    const hwSerial = this.getHardwareSerial(serial);
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
    if (hwSerial) {
      this.ownership.set(hwSerial, ownerData);
    }

    this._persistOwnership();
    logger.info(`[DeviceLock] Device ${serial} (${hwSerial || 'no hw'}) ownership assigned to ${user.name} (${user.email || user.id})`);
  }

  /**
   * Get device owner (checks exact connection serial and hardware serial)
   */
  getOwner(serial) {
    if (!serial) return null;
    if (this.ownership.has(serial)) {
      return this.ownership.get(serial);
    }
    const hwSerial = this.getHardwareSerial(serial);
    if (hwSerial && this.ownership.has(hwSerial)) {
      return this.ownership.get(hwSerial);
    }
    return null;
  }

  /**
   * Clear connection ownership.
   */
  clearOwner(serial) {
    if (!serial) return;
    this.ownership.delete(serial);
    const hwSerial = this.getHardwareSerial(serial);
    if (hwSerial) {
      this.ownership.delete(hwSerial);
    }
    try {
      const adbService = require('./adbService');
      if (adbService && adbService.clearFallback) {
        adbService.clearFallback(hwSerial || serial);
      }
    } catch (e) {}
    try {
      const mixpanelCollectorService = require('./mixpanelCollectorService');
      if (mixpanelCollectorService && mixpanelCollectorService.handleDeviceDisconnect) {
        mixpanelCollectorService.handleDeviceDisconnect(serial);
        if (hwSerial) mixpanelCollectorService.handleDeviceDisconnect(hwSerial);
      }
    } catch (e) {}
    this._persistOwnership();
    logger.info(`[DeviceLock] Device ${serial} connection ownership cleared.`);
  }

  /**
   * Get active lock for device serial.
   */
  getLock(serial) {
    if (!serial) return null;
    let lock = this.locks.get(serial);
    if (!lock) {
      const hwSerial = this.getHardwareSerial(serial);
      if (hwSerial) lock = this.locks.get(hwSerial);
    }
    return lock || null;
  }

  /**
   * Safely clean up device-specific active resources (mirror, test sessions, logcat)
   * belonging to previous owner when ownership is transferred.
   */
  _cleanupDeviceResources(serial, hardwareSerial, oldOwner) {
    try {
      const screenMirrorService = require('./screenMirrorService');
      if (screenMirrorService) {
        if (serial) screenMirrorService.stopMirror(serial);
        if (hardwareSerial) screenMirrorService.stopMirror(hardwareSerial);
      }
    } catch (e) {
      logger.debug(`[DeviceLock] Screen mirror cleanup notice: ${e.message}`);
    }

    try {
      const mixpanelCollectorService = require('./mixpanelCollectorService');
      if (mixpanelCollectorService && mixpanelCollectorService.handleDeviceDisconnect) {
        mixpanelCollectorService.handleDeviceDisconnect(serial);
        if (hardwareSerial) mixpanelCollectorService.handleDeviceDisconnect(hardwareSerial);
      }
    } catch (e) {
      logger.debug(`[DeviceLock] Mixpanel capture cleanup notice: ${e.message}`);
    }

    try {
      const testRunnerService = require('./testRunnerService');
      if (testRunnerService && testRunnerService.activeTests) {
        for (const [testId, active] of testRunnerService.activeTests.entries()) {
          const devSerial = active.testData?.deviceSerial;
          const testUserId = active.testData?.userId;
          const matchesDevice = devSerial === serial || devSerial === hardwareSerial;
          const matchesUser = oldOwner ? testUserId === oldOwner.userId : true;
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
        terminateDeviceLogcat(serial, hardwareSerial, oldOwner?.userId);
      }
    } catch (e) {
      logger.debug(`[DeviceLock] WebSocket logcat cleanup notice: ${e.message}`);
    }
  }

  /**
   * Atomic device ownership acquisition & transfer.
   * Transfers ownership smoothly without requiring manual claim/release buttons.
   * Never interrupts active PAD tests/installations (returns BUSY_PENDING).
   * Immediately revokes previous owner's mirror, logcat, and control resources.
   */
  async transferDeviceOwnership(serial, user, options = {}) {
    if (!serial) throw new Error('Device serial is required.');
    if (!user) throw new Error('User authentication required.');

    const hwSerial = options.hardwareSerial || this.getHardwareSerial(serial) || serial;
    const lockKey = hwSerial || serial;

    // Atomic concurrency lock
    if (this._takeoverLocks.has(lockKey)) {
      await new Promise(resolve => setTimeout(resolve, 50));
      if (this._takeoverLocks.has(lockKey)) {
        return {
          success: false,
          status: 'BUSY_PENDING',
          message: `Transfer operation already in progress for device ${serial}.`
        };
      }
    }

    this._takeoverLocks.add(lockKey);
    try {
      // Guard against interrupting an active operation
      if (this.isOperationActive(serial, hwSerial)) {
        logger.info(`[DeviceLock] Device ${serial} (${hwSerial}) is busy running an active operation. Transfer deferred.`);
        if (options.queueDeferred) {
          this.deferredTransfers.set(serial, { user, options, requestedAt: Date.now() });
        }
        return {
          success: false,
          status: 'BUSY_PENDING',
          message: `Device ${serial} is currently running an active operation. Transfer cannot interrupt active tests.`
        };
      }

      const existingOwner = this.getOwner(serial);
      const isSameUser = existingOwner && (existingOwner.userId === user.id || (user.email && existingOwner.userEmail === (user.email || '').toLowerCase()));

      if (existingOwner && !isSameUser) {
        logger.info(`[DeviceLock] Seamless transfer of device ${serial} (${hwSerial}) from ${existingOwner.userName} to ${user.name}`);
        this._cleanupDeviceResources(serial, hwSerial, existingOwner);
      }

      this.setOwner(serial, user);

      try {
        const { broadcastEvent } = require('../websocket/testSocket');
        if (broadcastEvent) broadcastEvent('DEVICES_UPDATED');
      } catch (e) {}

      return {
        success: true,
        status: 'ACQUIRED',
        transferred: !isSameUser && !!existingOwner,
        previousOwner: existingOwner ? existingOwner.userName : null,
        serial,
        hardwareSerial: hwSerial
      };
    } finally {
      this._takeoverLocks.delete(lockKey);
    }
  }

  async acquireDevice(serial, user, options = {}) {
    return this.transferDeviceOwnership(serial, user, options);
  }

  /**
   * Backward-compatibility shims
   */
  claimDevice(serial, user, options = {}) {
    logger.debug(`[DeviceLock] claimDevice called for ${serial} (maps to connection ownership).`);
    if (!serial) throw new Error('Device serial is required.');
    if (!user) throw new Error('User authentication required.');

    const userId = user.id;
    const userEmail = (user.email || '').toLowerCase();
    const existingOwner = this.getOwner(serial);

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

  getClaim(serial) {
    if (!serial) return null;
    return this.claims.get(serial) || null;
  }

  transferClaim(serial, user, options = {}) {
    return this.claimDevice(serial, user, options);
  }

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

  releaseDevice(serial, user, force = false) {
    logger.debug(`[DeviceLock] releaseDevice called for ${serial} (maps to connection ownership cleanup).`);
    if (serial) {
      this.clearOwner(serial);
      this.claims.delete(serial);
      const hwSerial = this.getHardwareSerial(serial);
      if (hwSerial) {
        this.claims.delete(hwSerial);
      }
    }
    return true;
  }

  /**
   * Check if user is the current owner of device
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

    // Unowned -> available/user device
    return true;
  }

  /**
   * Check if user can run tests, stream screen mirror, or execute ADB actions on device.
   * Access is restricted to the current owner (or unowned devices) and admins.
   */
  isDeviceAccessible(serial, user) {
    if (!user) return false;
    if (user.role === 'ADMIN' || (user.role || '').toLowerCase() === 'admin') return true;
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
    const ownerStatus = isOwner ? 'YOUR_DEVICE' : (owner ? 'IN_USE' : 'AVAILABLE');

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
      ownerName: isAgentUsb ? (device.userName || 'You') : (owner ? owner.userName : null),
      status: ownerStatus
    };

    const connectionMode = device.connectionMode || (serial.startsWith('browser_usb_') ? 'browser-usb' : 'server-adb');

    return {
      ...device,
      displayName: device.displayName || formatDeviceDisplayName(device),
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
  decorateDevices(devices = [], user, options = {}) {
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

        // If device is an Agent iOS device, check agent ownership
        try {
          const agentService = require('./agentService');
          if (agentService && agentService.isAgentIosDevice(serial)) {
            return !!agentService.getAgentDevice(serial, user);
          }
        } catch (e) {}

        return true;
      });

    // Deduplicate physical devices: if two transports share the same hardwareSerial, prefer USB over Wireless
    const deduplicated = [];
    const seenHw = new Map(); // hwSerial -> index in deduplicated

    for (const dev of filtered) {
      const serial = dev.id || dev.serial;
      const hwSerial = dev.hardwareSerial || this.getHardwareSerial(serial);

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

    const decorated = deduplicated.map(d => this.decorateDevice(d, user));
    if (options && options.ownedOnly) {
      return decorated.filter(d => d.owner && d.owner.isOwner);
    }
    return decorated;
  }
}

const deviceLockService = new DeviceLockService();
module.exports = deviceLockService;
deviceLockService.init();
