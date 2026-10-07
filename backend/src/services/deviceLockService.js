const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class DeviceLockService {
  constructor() {
    this.ownershipFile = path.join(config.DATA_DIR, 'devices_ownership.json');
    this.claimsFile = path.join(config.DATA_DIR, 'devices_claims.json');
    this.hardwareMapFile = path.join(config.DATA_DIR, 'devices_hardware_map.json');

    this.locks = new Map(); // serial/ip/hwId -> { userId, userName, userEmail, lockedAt, testId }
    this.ownership = new Map(); // serial/ip/hwId -> { userId, userName, userEmail, connectedAt }
    this.claims = new Map(); // serial/ip/hwId -> { userId, userName, userEmail, claimedAt, hardwareSerial }
    this.hardwareMap = new Map(); // serial/ip -> hardwareSerial and hardwareSerial -> Set(serials/ips)
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

      // Load claim mappings
      if (fs.existsSync(this.claimsFile)) {
        const raw = fs.readFileSync(this.claimsFile, 'utf8');
        const data = JSON.parse(raw);
        if (typeof data === 'object' && data !== null) {
          for (const [key, val] of Object.entries(data)) {
            this.claims.set(key, val);
          }
          logger.info(`[DeviceLock] Loaded ${this.claims.size} persisted device claim mappings.`);
        }
      } else {
        this._persistClaims();
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
      logger.error(`[DeviceLock] Failed to initialize device ownership/claims store: ${err.message}`);
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

  _persistClaims() {
    try {
      const obj = {};
      for (const [k, v] of this.claims.entries()) {
        obj[k] = v;
      }
      fs.writeFileSync(this.claimsFile, JSON.stringify(obj, null, 2), 'utf8');
    } catch (err) {
      logger.error(`[DeviceLock] Failed to persist device claims: ${err.message}`);
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
    this._persistHardwareMap();

    // If there is already a claim on the hardware serial, map it to this current connection serial
    const hwClaim = this.claims.get(hardwareSerial);
    if (hwClaim) {
      this.claims.set(serial, hwClaim);
      if (serial.includes(':')) {
        this.claims.set(serial.split(':')[0], hwClaim);
      }
      this._persistClaims();
    }
  }

  /**
   * Set device owner (e.g. when connected/paired by user).
   * Note: NEVER overwrites an existing claim held by another user.
   */
  setOwner(serial, user) {
    if (!serial || !user) return;

    // Check if claimed by another user first
    const existingClaim = this.getClaim(serial);
    const userId = user.id;
    const userEmail = (user.email || '').toLowerCase();
    const isMatchUser = (c) => c.userId === userId || (userEmail && c.userEmail === userEmail);

    if (existingClaim && !isMatchUser(existingClaim)) {
      logger.warn(`[DeviceLock] Ignoring setOwner for ${serial}: device is currently claimed by ${existingClaim.userName}.`);
      return;
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

    const hwSerial = this.hardwareMap.get(serial);
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
   * Get active claim for device across stable identifiers (exact serial, bare IP, hardware serial).
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
   * Clear transient connection ownership (e.g. on adb disconnect).
   * CRITICAL: MUST NEVER delete active claims. Claimed state is independent of connection state.
   */
  clearOwner(serial) {
    if (!serial) return;
    // Only delete ownership if NOT claimed
    if (!this.getClaim(serial)) {
      this.ownership.delete(serial);
      if (serial.includes(':')) {
        const bareIp = serial.split(':')[0];
        this.ownership.delete(bareIp);
      }
      const hwSerial = this.hardwareMap.get(serial);
      if (hwSerial) {
        this.ownership.delete(hwSerial);
      }
      this._persistOwnership();
      logger.info(`[DeviceLock] Unclaimed device ${serial} connection ownership cleared.`);
    }
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
   * Claim device for user. Atomically checks if already claimed by someone else.
   * Claims NEVER expire automatically; they remain until explicit release or verified takeover.
   * Takeover is strictly restricted to options.forceTakeover === true with options.verifiedConnection === true.
   */
  claimDevice(serial, user, options = {}) {
    if (!serial) throw new Error('Device serial is required to claim device.');
    if (!user) throw new Error('User authentication required to claim device.');

    const userId = user.id;
    const userName = user.name || 'QA Tester';
    const userEmail = (user.email || '').toLowerCase();

    const hardwareSerial = options.hardwareSerial || this.hardwareMap.get(serial) || (serial.includes(':') ? this.hardwareMap.get(serial.split(':')[0]) : null) || null;
    const existingClaim = this.getClaim(serial) || (hardwareSerial ? this.claims.get(hardwareSerial) : null);
    const isMatchUser = (c) => c && (c.userId === userId || (userEmail && c.userEmail === userEmail));
    const lockKey = hardwareSerial || serial;

    // Check takeover validation
    if (options.forceTakeover) {
      if (!options.verifiedConnection) {
        throw new Error('Claim takeover requires a verified active device connection.');
      }

      // Concurrency protection: prevent race condition if another takeover is in progress or device was taken over just now
      if (existingClaim && !isMatchUser(existingClaim)) {
        if (this._takeoverLocks.has(lockKey)) {
          throw new Error(`Device ${serial} is currently being claimed by another user.`);
        }
        const lastTakeover = this._recentTakeovers.get(lockKey) || 0;
        if (Date.now() - lastTakeover < 2000 && !options.allowImmediateReclaim) {
          throw new Error(`Device ${serial} was just claimed by ${existingClaim.userName}.`);
        }
      }
    } else {
      // Standard claim path
      if (!this.isDeviceAccessible(serial, user)) {
        throw new Error(`Device ${serial} is currently claimed by ${existingClaim ? existingClaim.userName : 'another user'}.`);
      }
      if (existingClaim && !isMatchUser(existingClaim)) {
        throw new Error(`Device ${serial} is currently claimed by ${existingClaim.userName}.`);
      }
    }

    const isTakeover = options.forceTakeover && existingClaim && !isMatchUser(existingClaim);
    if (isTakeover) {
      this._takeoverLocks.add(lockKey);
      this._recentTakeovers.set(lockKey, Date.now());
      this._cleanupDeviceResources(serial, hardwareSerial, existingClaim);

      // Clean up previous serial key if port rotated
      if (existingClaim.serial && existingClaim.serial !== serial) {
        this.claims.delete(existingClaim.serial);
        this.ownership.delete(existingClaim.serial);
        this.locks.delete(existingClaim.serial);
      }
    }

    // Preserve memory backups for rollback if disk persistence fails
    const prevClaimSerial = this.claims.get(serial);
    const prevClaimHw = hardwareSerial ? this.claims.get(hardwareSerial) : null;
    const prevOwnerSerial = this.ownership.get(serial);
    const prevOwnerHw = hardwareSerial ? this.ownership.get(hardwareSerial) : null;
    const prevLockSerial = this.locks.get(serial);
    const prevLockHw = hardwareSerial ? this.locks.get(hardwareSerial) : null;

    const connectionMode = options.connectionMode || (serial.startsWith('browser_usb_') ? 'browser-usb' : (serial.includes(':') ? 'server-adb' : 'server-adb'));

    const claimData = {
      serial,
      userId,
      userName,
      userEmail,
      claimedAt: (isMatchUser(existingClaim) && existingClaim?.claimedAt && !isTakeover) ? existingClaim.claimedAt : new Date().toISOString(),
      hardwareSerial,
      connectionMode: options.connectionMode || existingClaim?.connectionMode || connectionMode
    };

    this.claims.set(serial, claimData);
    this.ownership.set(serial, {
      userId,
      userName,
      userEmail,
      connectedAt: claimData.claimedAt
    });

    if (serial.includes(':')) {
      const bareIp = serial.split(':')[0];
      if (bareIp) {
        this.claims.set(bareIp, claimData);
        this.ownership.set(bareIp, this.ownership.get(serial));
      }
    }

    if (hardwareSerial) {
      this.claims.set(hardwareSerial, claimData);
      this.ownership.set(hardwareSerial, this.ownership.get(serial));
      this.hardwareMap.set(serial, hardwareSerial);
      if (serial.includes(':')) {
        this.hardwareMap.set(serial.split(':')[0], hardwareSerial);
      }
    }

    const lock = {
      serial,
      userId,
      userName,
      userEmail,
      lockedAt: claimData.claimedAt,
      expiresAt: null,
      testId: options.testId || null
    };

    this.locks.set(serial, lock);
    if (serial.includes(':')) {
      const bareIp = serial.split(':')[0];
      if (bareIp) this.locks.set(bareIp, lock);
    }
    if (hardwareSerial) {
      this.locks.set(hardwareSerial, lock);
    }

    try {
      this._persistClaims();
      this._persistOwnership();
      if (hardwareSerial) {
        this._persistHardwareMap();
      }
    } catch (err) {
      // Rollback memory state on persistence failure
      if (prevClaimSerial) this.claims.set(serial, prevClaimSerial); else this.claims.delete(serial);
      if (hardwareSerial && prevClaimHw) this.claims.set(hardwareSerial, prevClaimHw); else if (hardwareSerial) this.claims.delete(hardwareSerial);
      if (prevOwnerSerial) this.ownership.set(serial, prevOwnerSerial); else this.ownership.delete(serial);
      if (hardwareSerial && prevOwnerHw) this.ownership.set(hardwareSerial, prevOwnerHw); else if (hardwareSerial) this.ownership.delete(hardwareSerial);
      if (prevLockSerial) this.locks.set(serial, prevLockSerial); else this.locks.delete(serial);
      if (hardwareSerial && prevLockHw) this.locks.set(hardwareSerial, prevLockHw); else if (hardwareSerial) this.locks.delete(hardwareSerial);
      throw new Error(`Failed to persist claim: ${err.message}`);
    } finally {
      if (isTakeover) {
        this._takeoverLocks.delete(lockKey);
      }
    }

    if (isTakeover) {
      logger.info(`[DeviceLock] Device ${serial} (${hardwareSerial || 'no hw'}) claim successfully transferred from ${existingClaim.userName} (${existingClaim.userId}) to ${userName} (${userId}).`);
    } else {
      logger.info(`[DeviceLock] Device ${serial} successfully claimed by ${userName} (${userId}).`);
    }

    return claimData;
  }

  /**
   * Helper to transfer claim on verified connection.
   */
  transferClaim(serial, user, options = {}) {
    return this.claimDevice(serial, user, {
      ...options,
      forceTakeover: true
    });
  }

  /**
   * Migrate an active claim and ownership from one transport (e.g. wireless)
   * to another transport (e.g. USB) for the same physical device.
   * Ensures uninterrupted ownership and preserves multi-user access control.
   */
  migrateClaim(fromSerial, toSerial, hardwareSerial) {
    if (!toSerial) return null;
    if (fromSerial === toSerial) return this.getClaim(toSerial);

    const hwSerial = hardwareSerial || this.hardwareMap.get(fromSerial) || this.hardwareMap.get(toSerial) || null;
    const existingClaim = this.getClaim(fromSerial) || (hwSerial ? this.claims.get(hwSerial) : null);

    if (!existingClaim) {
      // If device is unclaimed, also migrate any pending connection owner info
      const existingOwner = this.getOwner(fromSerial) || (hwSerial ? this.ownership.get(hwSerial) : null);
      if (existingOwner) {
        this.ownership.set(toSerial, { ...existingOwner });
        if (hwSerial) this.ownership.set(hwSerial, { ...existingOwner });
        this._persistOwnership();
      }
      return null;
    }

    const migratedClaim = {
      ...existingClaim,
      serial: toSerial,
      hardwareSerial: hwSerial || existingClaim.hardwareSerial || null,
      connectionMode: toSerial.startsWith('browser_usb_') ? 'browser-usb' : (toSerial.includes(':') ? 'server-adb' : 'usb'),
      migratedFrom: fromSerial,
      migratedAt: new Date().toISOString()
    };

    this.claims.set(toSerial, migratedClaim);
    if (hwSerial) {
      this.claims.set(hwSerial, migratedClaim);
      this.hardwareMap.set(toSerial, hwSerial);
      if (fromSerial) this.hardwareMap.set(fromSerial, hwSerial);
    }

    const ownerData = {
      userId: existingClaim.userId,
      userName: existingClaim.userName,
      userEmail: existingClaim.userEmail,
      connectedAt: existingClaim.claimedAt
    };
    this.ownership.set(toSerial, ownerData);
    if (hwSerial) this.ownership.set(hwSerial, ownerData);

    const existingLock = this.getLock(fromSerial) || (hwSerial ? this.locks.get(hwSerial) : null);
    if (existingLock) {
      const migratedLock = {
        ...existingLock,
        serial: toSerial
      };
      this.locks.set(toSerial, migratedLock);
      if (hwSerial) this.locks.set(hwSerial, migratedLock);
    }

    // Clean up fromSerial keys if different
    if (fromSerial && fromSerial !== toSerial) {
      this.claims.delete(fromSerial);
      this.ownership.delete(fromSerial);
      this.locks.delete(fromSerial);
      if (fromSerial.includes(':')) {
        const bareIp = fromSerial.split(':')[0];
        this.claims.delete(bareIp);
        this.ownership.delete(bareIp);
        this.locks.delete(bareIp);
      }
    }

    this._persistClaims();
    this._persistOwnership();
    if (hwSerial) this._persistHardwareMap();

    logger.info(`[DeviceLock] Claim migrated from ${fromSerial} to ${toSerial} (hardware: ${hwSerial}) for user ${existingClaim.userName}.`);
    return migratedClaim;
  }
  /**
   * Release claim on device.
   * Clears claim, locks, and ownership restriction ONLY when explicitly triggered.
   */
  releaseDevice(serial, user, force = false) {
    if (!serial) return true;
    const existingClaim = this.getClaim(serial);
    const existingOwner = this.getOwner(serial);

    const userId = user?.id;
    const userEmail = (user?.email || '').toLowerCase();

    if (existingClaim) {
      const isClaimOwner = existingClaim.userId === userId || (userEmail && existingClaim.userEmail === userEmail);
      if (!force && !isClaimOwner) {
        throw new Error(`Cannot release device ${serial}: claim is held by ${existingClaim.userName}.`);
      }
    } else if (existingOwner) {
      const isOwner = existingOwner.userId === userId || (userEmail && existingOwner.userEmail === userEmail);
      if (!force && !isOwner) {
        throw new Error(`Cannot release device ${serial}: owned by ${existingOwner.userName}.`);
      }
    }

    const hwSerial = this.hardwareMap.get(serial);

    this.claims.delete(serial);
    this.ownership.delete(serial);
    this.locks.delete(serial);

    if (serial.includes(':')) {
      const bareIp = serial.split(':')[0];
      if (bareIp) {
        this.claims.delete(bareIp);
        this.ownership.delete(bareIp);
        this.locks.delete(bareIp);
      }
    }

    if (hwSerial) {
      this.claims.delete(hwSerial);
      this.ownership.delete(hwSerial);
      this.locks.delete(hwSerial);
      this._recentTakeovers.delete(hwSerial);
    }
    this._recentTakeovers.delete(serial);

    // Clean up any mapped transports associated with this physical hardwareSerial
    const targetHw = hwSerial || serial;
    for (const [k, v] of this.hardwareMap.entries()) {
      if (v === targetHw || v === serial || k === targetHw) {
        this.claims.delete(k);
        this.ownership.delete(k);
        this.locks.delete(k);
      }
    }

    // Clear stored wireless fallback so unplugging USB later does not resurrect an old stale wireless connection
    try {
      const adbService = require('./adbService');
      if (adbService && typeof adbService.clearFallback === 'function') {
        adbService.clearFallback(targetHw);
        if (serial !== targetHw) {
          adbService.clearFallback(serial);
        }
      }
    } catch (e) {
      logger.debug(`[DeviceLock] Fallback clearing notice: ${e.message}`);
    }

    this._persistClaims();
    this._persistOwnership();
    logger.info(`[DeviceLock] Device ${serial} explicitly released and made available to all users.`);
    return true;
  }

  /**
   * Check if user has visibility to device:
   * 1. If claimed: ONLY the user holding the claim can see it.
   * 2. If unclaimed with owner (connected user): ONLY the connected user can see it initially.
   * 3. If unclaimed and released: ALL signed-in users can see it and claim it.
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

    // 1. If claimed, strictly visible to claim holder only
    const claim = this.getClaim(serial);
    if (claim) {
      return Boolean(claim.userId === userId || (userEmail && claim.userEmail === userEmail));
    }

    // 2. If unclaimed but has specific connector/owner
    const owner = this.getOwner(serial);
    if (owner) {
      return Boolean(owner.userId === userId || (userEmail && owner.userEmail === userEmail));
    }

    // 3. Unclaimed and released -> visible to all authenticated users
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
   * Decorate device object with claim, lock & ownership status for frontend
   */
  decorateDevice(device, user) {
    if (!device) return device;
    const serial = device.id || device.serial;
    const isAgentUsb = device.connectionMode === 'agent-usb' || !!device.agentId;
    const claim = isAgentUsb ? null : this.getClaim(serial);
    const owner = isAgentUsb ? null : this.getOwner(serial);

    const isClaimed = !!claim;
    const isClaimedByMe = isAgentUsb || (isClaimed && (claim.userId === user?.id || (user?.email && claim.userEmail === (user?.email || '').toLowerCase())));
    const claimedBy = claim ? claim.userName : null;
    const isOwner = isAgentUsb || (!claim && owner && (owner.userId === user?.id || (user?.email && owner.userEmail === (user?.email || '').toLowerCase())));

    const lockInfo = {
      isLocked: isClaimed,
      isLockedByMe: isClaimedByMe,
      lockedBy: claimedBy,
      lockedByEmail: claim ? claim.userEmail : null,
      lockedAt: claim ? claim.claimedAt : null,
      expiresInSeconds: 0,
      testId: null
    };

    const ownerInfo = {
      isOwner: isClaimedByMe || isOwner,
      ownerName: isAgentUsb ? (device.userName || 'You') : (claim ? claim.userName : (owner ? owner.userName : null))
    };

    const connectionMode = device.connectionMode || claim?.connectionMode || (serial.startsWith('browser_usb_') ? 'browser-usb' : 'server-adb');

    return {
      ...device,
      connectionMode,
      isClaimed,
      isClaimedByMe,
      claimedBy,
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
