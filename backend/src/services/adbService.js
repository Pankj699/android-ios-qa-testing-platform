const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const networkUtils = require('../utils/networkUtils');
const { formatDeviceModelName, formatDeviceDisplayName } = require('../utils/deviceFormatter');

class AdbService {
  constructor() {
    this.adbPath = config.ADB_PATH;
    this.wirelessFallbacks = new Map();
    this._hardwareSerialCache = new Map();
    this._deviceMetaCache = new Map();
    this._deviceTelemetryCache = new Map();
    this._telemetryFetching = new Set();
    this._disconnectingSerials = new Set();
    this.deferredCleanups = new Map(); // hwSerial -> { wSerial, usbSerial, hwSerial }
    this._activeTestChecker = null;
  }

  /**
   * Set callback to check if a PAD/monitoring test is actively running on device.
   * Registered by TestRunnerService to avoid circular dependencies.
   */
  setActiveTestChecker(fn) {
    this._activeTestChecker = typeof fn === 'function' ? fn : null;
  }

  /**
   * Check if a device has an active test running via registered callback.
   */
  isTestActiveForDevice(serial, hardwareSerial) {
    if (typeof this._activeTestChecker === 'function') {
      try {
        return !!this._activeTestChecker(serial, hardwareSerial);
      } catch (err) {
        logger.debug(`[AdbService] Error in active test checker: ${err.message}`);
        return false;
      }
    }
    return false;
  }

  /**
   * Clear stored wireless fallback for a physical device (e.g. upon explicit device release).
   */
  clearFallback(hardwareSerial) {
    if (!hardwareSerial) return false;
    let deleted = false;
    if (this.wirelessFallbacks) {
      if (this.wirelessFallbacks.has(hardwareSerial)) {
        this.wirelessFallbacks.delete(hardwareSerial);
        deleted = true;
      }
      // Also check if any fallback entry has serial matching hardwareSerial
      for (const [key, val] of this.wirelessFallbacks.entries()) {
        if (val.serial === hardwareSerial || val.hardwareSerial === hardwareSerial) {
          this.wirelessFallbacks.delete(key);
          deleted = true;
        }
      }
    }
    return deleted;
  }

  /**
   * Execute any deferred wireless cleanup for a physical device once its active test finishes.
   * Executes exactly once per registered deferred state.
   */
  async executeDeferredCleanup(serial, hardwareSerial) {
    const hwKey = hardwareSerial || (serial ? this._hardwareSerialCache?.get(serial) : null) || serial;
    if (!hwKey) return false;

    let deferred = this.deferredCleanups.get(hwKey);
    let targetKey = hwKey;
    if (!deferred) {
      for (const [key, val] of this.deferredCleanups.entries()) {
        if (val.wSerial === serial || val.usbSerial === serial || val.hwSerial === hwKey || val.hwSerial === serial) {
          deferred = val;
          targetKey = key;
          break;
        }
      }
    }

    if (!deferred) return false;

    // Remove from map first to ensure execution occurs exactly once
    this.deferredCleanups.delete(targetKey);
    const { wSerial, usbSerial, hwSerial: savedHw } = deferred;
    logger.info(`[AdbService] Executing deferred wireless teardown for ${wSerial} (authoritative USB: ${usbSerial}, physical device: ${savedHw || targetKey}).`);

    // In-flight disconnect guard
    if (this._disconnectingSerials.has(wSerial)) {
      logger.info(`[AdbService] Deferred disconnect for ${wSerial} already in-flight.`);
      return true;
    }

    try {
      this._disconnectingSerials.add(wSerial);

      // Stop screen mirror on old wireless transport
      try {
        const screenMirrorService = require('./screenMirrorService');
        screenMirrorService.stopMirror(wSerial);
      } catch (err) {
        logger.debug(`[AdbService] Deferred mirror cleanup on ${wSerial}: ${err.message}`);
      }

      // Disconnect wireless transport
      try {
        await this.disconnectDevice(wSerial);
        logger.info(`[AdbService] Safely executed deferred wireless teardown for ${wSerial}.`);
      } catch (err) {
        logger.warn(`[AdbService] Error in deferred wireless disconnect for ${wSerial}: ${err.message}`);
      }
    } finally {
      this._disconnectingSerials.delete(wSerial);
    }

    return true;
  }

  /**
   * Execute raw ADB command with safe arguments array and timeout
   */
  execute(args, options = {}) {
    return new Promise((resolve, reject) => {
      const timeoutMs = options.timeout || config.ADB_TIMEOUT_MS;
      const cmdStr = `${this.adbPath} ${args.join(' ')}`;
      logger.debug(`[ADB Exec] ${cmdStr}`);

      const proc = spawn(this.adbPath, args, {
        windowsHide: true,
        shell: false
      });

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGKILL');
        reject(new Error(`ADB command '${cmdStr}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      proc.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        if (err.code === 'ENOENT') {
          reject(new Error(`ADB was not found at '${this.adbPath}'. Please configure ADB_PATH and verify Android Platform Tools are installed.`));
        } else {
          reject(new Error(`ADB execution error: ${err.message}`));
        }
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return;

        resolve({
          code,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          raw: (stdout + '\n' + stderr).trim()
        });
      });
    });
  }

  /**
   * Check ADB availability and version (cached for 60s)
   */
  async checkAvailability(force = false) {
    const now = Date.now();
    if (!force && this._cachedAdb && now < this._cachedAdbExpiry) {
      return this._cachedAdb;
    }

    try {
      const res = await this.execute(['version'], { timeout: 5000 });
      if (res.code === 0) {
        const result = {
          available: true,
          version: res.stdout.split('\n')[0] || 'ADB Available',
          raw: res.stdout
        };
        this._cachedAdb = result;
        this._cachedAdbExpiry = Date.now() + 60000;
        return result;
      }
      return { available: false, error: res.stderr || 'Non-zero exit code' };
    } catch (err) {
      return { available: false, error: err.message };
    }
  }

  /**
   * Start ADB server if not running
   */
  async startServer() {
    try {
      await this.execute(['start-server'], { timeout: 10000 });
      return true;
    } catch (e) {
      logger.warn(`Failed to start ADB server: ${e.message}`);
      return false;
    }
  }

  /**
   * Check if mDNS discovery daemon is available in Platform Tools
   */
  async checkMdns() {
    try {
      const res = await this.execute(['mdns', 'check'], { timeout: 4000 });
      return {
        available: res.code === 0,
        output: res.raw || res.stdout
      };
    } catch (err) {
      return {
        available: false,
        output: err.message
      };
    }
  }

  /**
   * Query all mDNS-discovered services (_adb-tls-pairing._tcp and _adb-tls-connect._tcp)
   */
  async getMdnsServices() {
    try {
      const res = await this.execute(['mdns', 'services'], { timeout: 5000 });
      const lines = res.stdout.split('\n').map(l => l.trim()).filter(Boolean);
      const services = [];

      for (const line of lines) {
        if (line.toLowerCase().startsWith('list of') || line.toLowerCase().startsWith('mdns daemon')) {
          continue;
        }

        // Output format: <service_name> \t <service_type> \t <ip:port>
        const parts = line.split(/\t+|\s{2,}/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 3) {
          const serviceName = parts[0];
          const serviceType = parts[1];
          const address = parts[2];

          let ip = '';
          let port = 0;
          if (address.includes(':')) {
            const lastColon = address.lastIndexOf(':');
            ip = address.substring(0, lastColon);
            port = parseInt(address.substring(lastColon + 1), 10) || 0;
          } else {
            ip = address;
          }

          services.push({
            serviceName,
            serviceType, // '_adb-tls-pairing._tcp' | '_adb-tls-connect._tcp'
            address,
            ip,
            port,
            isPairing: serviceType.includes('pairing'),
            isConnect: serviceType.includes('connect'),
            raw: line
          });
        }
      }

      return services;
    } catch (err) {
      logger.debug(`[getMdnsServices] Error fetching mDNS services: ${err.message}`);
      return [];
    }
  }

  /**
   * Pair an Android device via Wireless Debugging
   */
  async pairDevice(ip, port, code) {
    // 1. Network validation first
    const reachability = await networkUtils.testReachability(ip, port, 4000);
    if (!reachability.reachable) {
      throw new Error(reachability.message);
    }

    // 2. Perform pairing
    logger.info(`Pairing device at ${ip}:${port} with code ${code}...`);
    const res = await this.execute(['pair', `${ip}:${port}`, String(code)], { timeout: 15000 });
    
    if (res.code !== 0 || res.raw.toLowerCase().includes('failed') || res.raw.toLowerCase().includes('error')) {
      throw new Error(`Pairing failed: ${res.raw || 'Invalid pairing code or expired port'}`);
    }

    return {
      success: true,
      message: res.raw || `Successfully paired with ${ip}:${port}`,
      ip,
      port
    };
  }

  /**
   * Connect to an Android device over Wi-Fi
   */
  async connectDevice(ip, port) {
    // 1. Network reachability validation
    const reachability = await networkUtils.testReachability(ip, port, 4000);
    if (!reachability.reachable) {
      throw new Error(reachability.message);
    }

    // 2. Execute connect
    logger.info(`Connecting to device at ${ip}:${port}...`);
    const res = await this.execute(['connect', `${ip}:${port}`], { timeout: 15000 });

    if (res.raw.toLowerCase().includes('failed') || res.raw.toLowerCase().includes('unable to connect') || res.raw.toLowerCase().includes('cannot connect')) {
      throw new Error(`Connection failed: ${res.raw}. Verify that Wireless Debugging is on and the connection port is correct.`);
    }

    const serial = `${ip}:${port}`;
    // Wait slightly and fetch device details
    await new Promise(r => setTimeout(r, 1000));
    const info = await this.getDeviceInfo(serial).catch(() => null);

    return {
      success: true,
      serial,
      message: res.raw,
      device: info
    };
  }

  /**
   * Disconnect an Android device
   */
  async disconnectDevice(serial) {
    try {
      const res = await this.execute(['disconnect', serial]);
      return { success: true, message: res.raw };
    } catch (e) {
      throw new Error(`Failed to disconnect ${serial}: ${e.message}`);
    }
  }

  /**
   * Helper to check if a device entry/serial represents an mDNS discovery record rather than a real connected device
   */
  isMdnsDiscoveryEntry(serial = '', line = '') {
    const str = `${serial} ${line}`.toLowerCase();
    if (str.includes('_adb-tls-connect') || str.includes('_adb-tls-pairing') || str.includes('._tcp')) {
      return true;
    }
    if (serial.startsWith('adb-') && serial.includes('._')) {
      return true;
    }
    return false;
  }

  /**
   * Safe retrieval of cached device build metadata
   */
  _getCachedMeta(serial, hwSerial = null) {
    if (!this._deviceMetaCache) this._deviceMetaCache = new Map();
    const resolvedHw = hwSerial || (serial ? this._hardwareSerialCache?.get(serial) : null);
    if (resolvedHw && this._deviceMetaCache.has(resolvedHw)) {
      return this._deviceMetaCache.get(resolvedHw);
    }
    if (serial && this._deviceMetaCache.has(serial)) {
      return this._deviceMetaCache.get(serial);
    }
    return null;
  }

  /**
   * Safe storage of device build metadata (never overwrites valid values with null/empty)
   */
  _setCachedMeta(serial, hwSerial = null, newMeta = {}) {
    if (!this._deviceMetaCache) this._deviceMetaCache = new Map();
    const resolvedHw = hwSerial || (serial ? this._hardwareSerialCache?.get(serial) : null);
    const existing = this._getCachedMeta(serial, resolvedHw) || {};

    const merged = {
      manufacturer: (newMeta.manufacturer && newMeta.manufacturer !== 'Android' && newMeta.manufacturer !== 'Unknown')
        ? newMeta.manufacturer
        : (existing.manufacturer || newMeta.manufacturer || 'Android'),
      model: (newMeta.model && newMeta.model !== 'Unknown Model' && newMeta.model !== 'Device')
        ? newMeta.model
        : (existing.model || newMeta.model || 'Device'),
      osVersion: (newMeta.osVersion && newMeta.osVersion !== 'Unknown' && newMeta.osVersion !== 'N/A')
        ? newMeta.osVersion
        : (existing.osVersion || null),
      sdkVersion: (newMeta.sdkVersion && newMeta.sdkVersion !== 'Unknown')
        ? newMeta.sdkVersion
        : (existing.sdkVersion || ''),
      cachedAt: Date.now()
    };

    if (serial) this._deviceMetaCache.set(serial, merged);
    if (resolvedHw) this._deviceMetaCache.set(resolvedHw, merged);
    return merged;
  }

  /**
   * Safe retrieval of cached device telemetry (battery, storage, screen)
   */
  _getCachedTelemetry(serial, hwSerial = null) {
    if (!this._deviceTelemetryCache) this._deviceTelemetryCache = new Map();
    const resolvedHw = hwSerial || (serial ? this._hardwareSerialCache?.get(serial) : null);
    if (resolvedHw && this._deviceTelemetryCache.has(resolvedHw)) {
      return this._deviceTelemetryCache.get(resolvedHw);
    }
    if (serial && this._deviceTelemetryCache.has(serial)) {
      return this._deviceTelemetryCache.get(serial);
    }
    return null;
  }

  /**
   * Safe storage of device telemetry (never overwrites valid values with Unknown/null/N/A)
   */
  _setCachedTelemetry(serial, hwSerial = null, newTelemetry = {}) {
    if (!this._deviceTelemetryCache) this._deviceTelemetryCache = new Map();
    const resolvedHw = hwSerial || (serial ? this._hardwareSerialCache?.get(serial) : null);
    const existing = this._getCachedTelemetry(serial, resolvedHw) || {};

    const merged = {
      battery: (newTelemetry.battery && newTelemetry.battery !== 'Unknown' && newTelemetry.battery !== 'N/A')
        ? newTelemetry.battery
        : (existing.battery || null),
      batteryStatus: (newTelemetry.batteryStatus && newTelemetry.batteryStatus !== 'Unknown' && newTelemetry.batteryStatus !== 'N/A')
        ? newTelemetry.batteryStatus
        : (existing.batteryStatus || null),
      batteryTemp: newTelemetry.batteryTemp || existing.batteryTemp || null,
      storageFree: (newTelemetry.storageFree && newTelemetry.storageFree !== 'Unknown' && newTelemetry.storageFree !== 'N/A')
        ? newTelemetry.storageFree
        : (existing.storageFree || null),
      storageTotal: (newTelemetry.storageTotal && newTelemetry.storageTotal !== 'Unknown' && newTelemetry.storageTotal !== 'N/A')
        ? newTelemetry.storageTotal
        : (existing.storageTotal || null),
      storageUsedPct: newTelemetry.storageUsedPct || existing.storageUsedPct || null,
      screenResolution: (newTelemetry.screenResolution && newTelemetry.screenResolution !== 'Unknown' && newTelemetry.screenResolution !== 'N/A')
        ? newTelemetry.screenResolution
        : (existing.screenResolution || null),
      cachedAt: Date.now()
    };

    if (serial) this._deviceTelemetryCache.set(serial, merged);
    if (resolvedHw) this._deviceTelemetryCache.set(resolvedHw, merged);
    return merged;
  }

  /**
   * Non-blocking background telemetry refresh
   */
  async refreshDeviceTelemetry(serial, hwSerial = null) {
    if (!serial) return null;
    if (!this._telemetryFetching) this._telemetryFetching = new Set();
    if (this._telemetryFetching.has(serial)) return null;

    try {
      this._telemetryFetching.add(serial);
      return await this.getDeviceInfo(serial);
    } catch (e) {
      logger.debug(`[AdbService] refreshDeviceTelemetry for ${serial}: ${e.message}`);
      return null;
    } finally {
      this._telemetryFetching.delete(serial);
    }
  }

  /**
   * Fast resolution and caching of immutable Android device build metadata
   */
  async resolveDeviceMetadata(serial, hwSerial = null) {
    if (!serial) return null;
    const cached = this._getCachedMeta(serial, hwSerial);
    // If cached meta already has valid osVersion and model, return it immediately!
    if (cached && cached.osVersion && cached.model && cached.model !== 'Device') {
      return cached;
    }

    try {
      const res = await this.execute([
        '-s', serial, 'shell',
        'getprop ro.product.manufacturer; getprop ro.product.model; getprop ro.build.version.release; getprop ro.build.version.sdk'
      ], { timeout: 5000 });

      if (res && res.stdout) {
        const lines = res.stdout.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length >= 2) {
          const manufacturer = lines[0] || 'Android';
          const model = lines[1] || 'Device';
          const osVersion = lines[2] || '';
          const sdkVersion = lines[3] || '';

          return this._setCachedMeta(serial, hwSerial, {
            manufacturer,
            model,
            osVersion,
            sdkVersion
          });
        }
      }
    } catch (e) {
      logger.debug(`[AdbService] resolveDeviceMetadata notice for ${serial}: ${e.message}`);
    }

    // Never return null if we have any cached data!
    return cached || null;
  }

  /**
   * Enrich raw connected device with cached metadata, telemetry, and standard display names
   */
  async enrichDeviceMetadata(dev) {
    if (!dev || !dev.serial) return dev;
    if (!dev.hardwareSerial) {
      dev.hardwareSerial = await this.resolveHardwareSerial(dev.serial).catch(() => null);
    }
    const meta = await this.resolveDeviceMetadata(dev.serial, dev.hardwareSerial);
    
    let manufacturer = meta?.manufacturer;
    if (!manufacturer || manufacturer.toLowerCase() === 'android') {
      if (dev.model && /^SM[-_ ]/i.test(dev.model)) {
        manufacturer = 'samsung';
      } else {
        manufacturer = 'Android';
      }
    }

    const model = meta?.model || dev.model || 'Unknown Model';
    const osVersion = meta?.osVersion || dev.osVersion || null;
    const androidVersion = osVersion ? `Android ${osVersion}` : (dev.androidVersion || 'Android');
    const sdkVersion = meta?.sdkVersion || dev.sdkVersion || '';

    const cleanModelName = formatDeviceModelName({ manufacturer, model }) || dev.model || 'Android Device';

    dev.manufacturer = manufacturer;
    dev.model = model;
    dev.osVersion = osVersion;
    dev.androidVersion = androidVersion;
    dev.sdkVersion = sdkVersion;
    dev.name = cleanModelName;
    dev.platform = 'android';
    dev.displayName = formatDeviceDisplayName({
      name: cleanModelName,
      model,
      manufacturer,
      osVersion,
      androidVersion,
      serial: dev.serial,
      platform: 'android'
    });

    // Attach cached telemetry (battery, storage, screen resolution)
    const telemetry = this._getCachedTelemetry(dev.serial, dev.hardwareSerial);
    if (telemetry) {
      if (telemetry.battery) dev.battery = telemetry.battery;
      if (telemetry.batteryStatus) dev.batteryStatus = telemetry.batteryStatus;
      if (telemetry.batteryTemp) dev.batteryTemp = telemetry.batteryTemp;
      if (telemetry.storageFree) dev.storageFree = telemetry.storageFree;
      if (telemetry.storageTotal) dev.storageTotal = telemetry.storageTotal;
      if (telemetry.storageUsedPct) dev.storageUsedPct = telemetry.storageUsedPct;
      if (telemetry.screenResolution) dev.screenResolution = telemetry.screenResolution;
    }

    // If telemetry is not yet cached and device is in healthy connected state, trigger background refresh
    if (!telemetry && dev.connected && dev.state === 'device') {
      this.refreshDeviceTelemetry(dev.serial, dev.hardwareSerial).catch(() => {});
    }

    return dev;
  }

  /**
   * List all connected ADB devices with parsed properties
   */
  async listDevices(options = {}) {
    const { connectedOnly = true } = options;
    try {
      const res = await this.execute(['devices', '-l']);
      const lines = res.stdout.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('List of devices attached'));
      
      const devices = [];
      for (const line of lines) {
        // Exclude mDNS discovery services from raw output lines
        if (this.isMdnsDiscoveryEntry('', line)) {
          continue;
        }

        const parts = line.split(/\s+/);
        if (parts.length < 2) continue;

        const serial = parts[0];
        const state = parts[1]; // device, offline, unauthorized, etc.

        if (this.isMdnsDiscoveryEntry(serial, line)) {
          continue;
        }

        const isConnected = state === 'device';
        if (connectedOnly && !isConnected) {
          continue;
        }
        
        let model = 'Unknown Device';
        let product = '';
        let transportId = '';

        for (let i = 2; i < parts.length; i++) {
          const [key, val] = parts[i].split(':');
          if (key === 'model') model = val.replace(/_/g, ' ');
          if (key === 'product') product = val;
          if (key === 'transport_id') transportId = val;
        }

        const isWireless = serial.includes(':');

        devices.push({
          serial,
          state,
          model,
          product,
          transportId,
          isWireless,
          connected: isConnected
        });
      }

      // Check fallback recovery if a previously known USB device disconnected
      await this.checkFallbackRecovery(devices);

      // Deduplicate and prioritize transports (USB > Wireless)
      const prioritized = await this.deduplicateAndPrioritizeTransports(devices);

      // Enrich devices with immutable build metadata in parallel
      await Promise.all(
        prioritized.map(async (dev) => {
          if (dev.connected && dev.state === 'device') {
            await this.enrichDeviceMetadata(dev);
          }
        })
      );

      return prioritized;
    } catch (e) {
      logger.error(`Failed to list devices: ${e.message}`);
      return [];
    }
  }

  /**
   * Resolve stable hardware serial for a given connection serial (USB or Wireless).
   */
  async resolveHardwareSerial(serial) {
    if (!serial) return null;

    if (this._hardwareSerialCache && this._hardwareSerialCache.has(serial)) {
      return this._hardwareSerialCache.get(serial);
    }

    const deviceLockService = require('./deviceLockService');
    const cached = deviceLockService.hardwareMap.get(serial) ||
      (serial.includes(':') ? deviceLockService.hardwareMap.get(serial.split(':')[0]) : null);
    if (cached) {
      if (!this._hardwareSerialCache) this._hardwareSerialCache = new Map();
      this._hardwareSerialCache.set(serial, cached);
      return cached;
    }

    const isWireless = serial.includes(':');
    if (!isWireless && !serial.startsWith('browser_usb_') && !serial.startsWith('agent_') && !serial.startsWith('emulator-')) {
      if (!this._hardwareSerialCache) this._hardwareSerialCache = new Map();
      this._hardwareSerialCache.set(serial, serial);
      deviceLockService.registerHardwareSerial(serial, serial);
      return serial;
    }

    // Query device via getprop ro.serialno with short timeout
    try {
      const res = await this.execute(['-s', serial, 'shell', 'getprop ro.serialno'], { timeout: 2000 });
      let hw = res.stdout?.trim();
      if (!hw || hw.includes(' ') || hw.length < 3) {
        const res2 = await this.execute(['-s', serial, 'shell', 'getprop ro.boot.serialno'], { timeout: 2000 });
        hw = res2.stdout?.trim();
      }

      if (hw && !hw.includes(' ') && hw.length >= 3) {
        if (!this._hardwareSerialCache) this._hardwareSerialCache = new Map();
        this._hardwareSerialCache.set(serial, hw);
        deviceLockService.registerHardwareSerial(serial, hw);
        return hw;
      }
    } catch (e) {
      logger.debug(`[AdbService] resolveHardwareSerial shell check failed for ${serial}: ${e.message}`);
    }

    return null;
  }

  /**
   * Safe Fallback Recovery:
   * If a device that previously had a wireless transport was using USB, and USB is now unplugged,
   * attempt to reconnect the wireless transport gracefully.
   */
  async checkFallbackRecovery(devices = []) {
    if (!this.wirelessFallbacks || this.wirelessFallbacks.size === 0) return;

    const now = Date.now();
    for (const [hwSerial, fallback] of this.wirelessFallbacks.entries()) {
      // Check if device is already present in devices list
      const isAlreadyPresent = devices.some(d => {
        const dHw = d.hardwareSerial || (this._hardwareSerialCache && this._hardwareSerialCache.get(d.serial));
        return d.serial === hwSerial || dHw === hwSerial || d.serial === fallback.serial;
      });

      if (!isAlreadyPresent) {
        // Cooldown between recovery attempts: 4 seconds
        if (fallback.lastRecoveryAttempt && (now - fallback.lastRecoveryAttempt) < 4000) {
          continue;
        }
        fallback.lastRecoveryAttempt = now;

        try {
          const reachability = await networkUtils.testReachability(fallback.ip, fallback.port, 1000);
          if (reachability.reachable) {
            const res = await this.execute(['connect', fallback.serial], { timeout: 3000 });
            if (res.raw && !res.raw.toLowerCase().includes('failed') && !res.raw.toLowerCase().includes('unable')) {
              logger.info(`[AdbService] Successfully reconnected wireless fallback transport ${fallback.serial} for physical device ${hwSerial} after USB disconnect.`);
              
              const deviceLockService = require('./deviceLockService');
              deviceLockService.migrateClaim(hwSerial, fallback.serial, hwSerial);

              // Add newly connected fallback device to devices array
              devices.push({
                serial: fallback.serial,
                state: 'device',
                model: 'Android Device',
                product: '',
                transportId: '',
                isWireless: true,
                connected: true,
                hardwareSerial: hwSerial
              });
            }
          }
        } catch (e) {
          logger.debug(`[AdbService] Fallback recovery skipped for ${fallback.serial}: ${e.message}`);
        }
      }
    }
  }

  /**
   * Implement USB transport priority and physical-device transport deduplication.
   * Safe Wireless Disconnect sequence:
   * A. Detect USB device
   * B. Verify USB is healthy and usable (state === 'device' && connected === true)
   * C. Resolve stable hardwareSerial
   * D. Confirm USB and wireless belong to same physical device
   * E. Mark USB as authoritative
   * F. Disconnect/disable redundant wireless transport (adb disconnect <wirelessSerial>)
   * G. Ensure device remains usable through USB
   * *If USB verification fails, do NOT disconnect wireless!*
   */
  async deduplicateAndPrioritizeTransports(rawDevices = []) {
    if (!rawDevices || rawDevices.length <= 1) {
      if (rawDevices && rawDevices.length === 1) {
        const d = rawDevices[0];
        const s = d.serial || d.id;
        const hw = await this.resolveHardwareSerial(s).catch(() => null);
        if (hw) d.hardwareSerial = hw;
      }
      return rawDevices;
    }

    const deviceLockService = require('./deviceLockService');
    const screenMirrorService = require('./screenMirrorService');

    // Group by hardwareSerial
    const hwGroups = new Map();
    const ungrouped = [];

    for (const dev of rawDevices) {
      const serial = dev.serial || dev.id;
      const hwSerial = await this.resolveHardwareSerial(serial);
      if (hwSerial) {
        dev.hardwareSerial = hwSerial;
        if (!hwGroups.has(hwSerial)) {
          hwGroups.set(hwSerial, []);
        }
        hwGroups.get(hwSerial).push(dev);
      } else {
        ungrouped.push(dev);
      }
    }

    const prioritized = [];

    for (const [hwSerial, group] of hwGroups.entries()) {
      if (group.length === 1) {
        prioritized.push(group[0]);
        continue;
      }

      // Multiple transports for the same physical device!
      const usbDevices = group.filter(d => !d.isWireless);
      const wirelessDevices = group.filter(d => d.isWireless);

      // Verify USB is healthy and usable
      const healthyUsb = usbDevices.find(d => d.connected && d.state === 'device');

      if (healthyUsb) {
        // Safe Wireless Disconnect Sequence:
        healthyUsb.isAuthoritative = true;
        healthyUsb.transportPriority = 'usb';

        for (const wDev of wirelessDevices) {
          const wSerial = wDev.serial || wDev.id;

          // Save fallback endpoint
          if (wSerial.includes(':')) {
            const [wIp, wPortStr] = wSerial.split(':');
            const wPort = parseInt(wPortStr, 10);
            if (!this.wirelessFallbacks) this.wirelessFallbacks = new Map();
            this.wirelessFallbacks.set(hwSerial, {
              serial: wSerial,
              ip: wIp,
              port: wPort,
              hardwareSerial: hwSerial,
              savedAt: Date.now()
            });
          }

          // Migrate claim to healthy USB
          deviceLockService.migrateClaim(wSerial, healthyUsb.serial, hwSerial);

          // Check if an active PAD / monitoring test is currently executing on this wireless transport
          if (this.isTestActiveForDevice(wSerial, hwSerial)) {
            logger.info(`[AdbService] Active test detected on wireless transport ${wSerial} for device ${hwSerial}. Deferring wireless teardown until test reaches terminal state.`);
            this.deferredCleanups.set(hwSerial, {
              wSerial,
              usbSerial: healthyUsb.serial,
              hwSerial
            });
            // Do NOT tear down wireless or mirror mid-test; continue to next device
            continue;
          }

          // In-flight disconnect guard: avoid duplicate concurrent disconnects
          if (this._disconnectingSerials.has(wSerial)) {
            logger.info(`[AdbService] Disconnect already in progress for ${wSerial}. Skipping duplicate.`);
            continue;
          }

          try {
            this._disconnectingSerials.add(wSerial);

            // Stop mirror on wireless transport
            try {
              screenMirrorService.stopMirror(wSerial);
            } catch (e) {
              logger.debug(`[AdbService] Mirror cleanup on ${wSerial}: ${e.message}`);
            }

            // Disconnect redundant wireless transport
            try {
              await this.disconnectDevice(wSerial);
              logger.info(`[AdbService] Safely disconnected redundant wireless transport ${wSerial} in favor of authoritative USB ${healthyUsb.serial} for physical device ${hwSerial}.`);
            } catch (e) {
              logger.warn(`[AdbService] Failed to disconnect redundant wireless transport ${wSerial}: ${e.message}`);
            }
          } finally {
            this._disconnectingSerials.delete(wSerial);
          }
        }

        // Only the authoritative USB transport is returned
        prioritized.push(healthyUsb);
      } else {
        // USB verification failed (e.g. state !== 'device' or unauthorized or offline)
        // CRITICAL RULE: DO NOT disconnect wireless!
        logger.warn(`[AdbService] USB transport present for ${hwSerial} but not in healthy 'device' state. Preserving wireless transports.`);
        for (const dev of group) {
          prioritized.push(dev);
        }
      }
    }

    return [...prioritized, ...ungrouped];
  }


  /**
   * Get detailed device telemetry & status
   */
  async getDeviceInfo(serial) {
    if (!serial) throw new Error('Device serial is required');

    const runShell = async (cmd) => {
      try {
        const res = await this.execute(['-s', serial, 'shell', cmd], { timeout: 5000 });
        return (res.stdout || '').trim();
      } catch (e) {
        return '';
      }
    };

    // Parallel extraction of telemetry
    const [
      modelManufacturer,
      modelName,
      rawOsVersion,
      rawSdkVersion,
      batteryDump,
      storageDump,
      screenDump,
      hwSerial1,
      hwSerial2
    ] = await Promise.all([
      runShell('getprop ro.product.manufacturer'),
      runShell('getprop ro.product.model'),
      runShell('getprop ro.build.version.release'),
      runShell('getprop ro.build.version.sdk'),
      runShell('dumpsys battery'),
      runShell('df -h /data'),
      runShell('wm size'),
      runShell('getprop ro.serialno'),
      runShell('getprop ro.boot.serialno')
    ]);

    const hardwareSerial = (hwSerial1 || hwSerial2 || '').trim() || (this._hardwareSerialCache?.get(serial)) || null;
    if (hardwareSerial) {
      try {
        const deviceLockService = require('./deviceLockService');
        deviceLockService.registerHardwareSerial(serial, hardwareSerial);
        if (!this._hardwareSerialCache) this._hardwareSerialCache = new Map();
        this._hardwareSerialCache.set(serial, hardwareSerial);
      } catch (e) {}
    }

    // Retrieve previous cached values to prevent overwriting valid values on transient failure
    const prevMeta = this._getCachedMeta(serial, hardwareSerial) || {};
    const prevTelemetry = this._getCachedTelemetry(serial, hardwareSerial) || {};

    // Parse Battery
    let batteryLevel = prevTelemetry.battery || 'Unknown';
    let batteryStatus = prevTelemetry.batteryStatus || 'Unknown';
    let batteryTemp = prevTelemetry.batteryTemp || '';
    if (batteryDump) {
      const levelMatch = batteryDump.match(/level:\s*(\d+)/i);
      const statusMatch = batteryDump.match(/status:\s*(\d+)/i);
      const tempMatch = batteryDump.match(/temperature:\s*(\d+)/i);
      if (levelMatch) batteryLevel = `${levelMatch[1]}%`;
      if (statusMatch) {
        const statusCode = parseInt(statusMatch[1], 10);
        const statuses = { 1: 'Unknown', 2: 'Charging', 3: 'Discharging', 4: 'Not Charging', 5: 'Full' };
        batteryStatus = statuses[statusCode] || 'Active';
      }
      if (tempMatch) {
        batteryTemp = `${(parseInt(tempMatch[1], 10) / 10).toFixed(1)}°C`;
      }
    }

    // Parse Storage
    let storageFree = prevTelemetry.storageFree || 'Unknown';
    let storageTotal = prevTelemetry.storageTotal || 'Unknown';
    let storageUsedPct = prevTelemetry.storageUsedPct || '';
    if (storageDump) {
      const lines = storageDump.split('\n').map(l => l.trim()).filter(Boolean);
      if (lines.length >= 2) {
        const parts = lines[lines.length - 1].split(/\s+/);
        // Filesystem Size Used Avail Use% Mounted on
        if (parts.length >= 5) {
          storageTotal = parts[1];
          storageFree = `${parts[3]} free`;
          storageUsedPct = parts[4];
        }
      }
    }

    // Parse Screen Resolution
    let screenResolution = prevTelemetry.screenResolution || 'Unknown';
    if (screenDump) {
      const sizeMatch = screenDump.match(/Physical size:\s*(\d+x\d+)/i) || screenDump.match(/(\d+x\d+)/i);
      if (sizeMatch) {
        screenResolution = sizeMatch[1].replace('x', ' × ');
      }
    }

    // Model and Manufacturer
    const model = (modelName && modelName.trim()) || prevMeta.model || 'Unknown Model';
    let manufacturer = (modelManufacturer && modelManufacturer.trim()) || prevMeta.manufacturer || 'Android';
    if (!manufacturer || manufacturer.toLowerCase() === 'android') {
      if (model && /^SM[-_ ]/i.test(model)) {
        manufacturer = 'samsung';
      }
    }

    // OS and SDK version (preserve previous valid version if transiently empty)
    const osVersion = (rawOsVersion && rawOsVersion.trim()) || prevMeta.osVersion || null;
    const sdkVersion = (rawSdkVersion && rawSdkVersion.trim()) || prevMeta.sdkVersion || '';

    const cleanModelName = formatDeviceModelName({ manufacturer, model }) || 'Android Device';
    const formattedAndroidVersion = osVersion ? `Android ${osVersion}` : 'Android';
    const rawDev = {
      serial,
      hardwareSerial,
      name: cleanModelName,
      model,
      manufacturer,
      osVersion: osVersion || null,
      androidVersion: formattedAndroidVersion,
      platform: 'android'
    };
    const displayName = formatDeviceDisplayName(rawDev);

    // Save into both Meta and Telemetry caches
    this._setCachedMeta(serial, hardwareSerial, {
      manufacturer,
      model,
      osVersion: osVersion || null,
      sdkVersion
    });

    this._setCachedTelemetry(serial, hardwareSerial, {
      battery: batteryLevel !== 'Unknown' ? batteryLevel : null,
      batteryStatus: batteryStatus !== 'Unknown' ? batteryStatus : null,
      batteryTemp,
      storageFree: storageFree !== 'Unknown' ? storageFree : null,
      storageTotal: storageTotal !== 'Unknown' ? storageTotal : null,
      storageUsedPct,
      screenResolution: screenResolution !== 'Unknown' ? screenResolution : null
    });

    return {
      serial,
      hardwareSerial,
      displayName,
      name: cleanModelName,
      model,
      manufacturer,
      osVersion: osVersion || null,
      androidVersion: formattedAndroidVersion,
      sdkVersion: sdkVersion || 'Unknown',
      battery: batteryLevel,
      batteryStatus,
      batteryTemp,
      storageFree: storageFree !== 'Unknown' ? storageFree : 'Unknown',
      storageTotal,
      storageUsedPct,
      screenResolution,
      connected: true,
      state: 'device',
      isWireless: serial.includes(':'),
      platform: 'android'
    };
  }

  /**
   * List installed applications on device (prioritizing third-party/user apps)
   */
  async listInstalledPackages(serial, options = {}) {
    if (!serial) throw new Error('Device serial is required');
    const includeSystem = !!options.includeSystem;

    try {
      // 1. Fetch user/third-party packages (-3 flag)
      const res3 = await this.execute(['-s', serial, 'shell', 'pm', 'list', 'packages', '-3']);
      const thirdPartyPackages = res3.stdout
        .split('\n')
        .map(l => l.trim().replace(/^package:/, ''))
        .filter(p => p && !p.startsWith('android') && !p.startsWith('com.android.'));

      let allPackages = [...thirdPartyPackages];

      if (includeSystem) {
        const resAll = await this.execute(['-s', serial, 'shell', 'pm', 'list', 'packages']);
        const sysPackages = resAll.stdout
          .split('\n')
          .map(l => l.trim().replace(/^package:/, ''))
          .filter(p => p && !allPackages.includes(p));
        allPackages = [...allPackages, ...sysPackages];
      }

      // Format clean list with human-readable application labels
      const apps = allPackages.map(pkg => {
        const isThirdParty = thirdPartyPackages.includes(pkg);
        const parts = pkg.split('.');
        const lastPart = parts[parts.length - 1];
        const label = lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
        return {
          packageName: pkg,
          name: label,
          label: label,
          isThirdParty,
          isSystem: !isThirdParty
        };
      });

      return apps;
    } catch (err) {
      logger.error(`[listInstalledPackages] Error for ${serial}: ${err.message}`);
      throw new Error(`Failed to list installed packages: ${err.message}`);
    }
  }

  /**
   * Check if package is installed on device
   */
  async isPackageInstalled(serial, packageName) {
    try {
      const res = await this.execute(['-s', serial, 'shell', 'pm', 'list', 'packages', packageName]);
      return res.stdout.includes(`package:${packageName}`);
    } catch (e) {
      return false;
    }
  }

  /**
   * Get package version details
   */
  async getPackageInfo(serial, packageName) {
    try {
      const res = await this.execute(['-s', serial, 'shell', 'dumpsys', 'package', packageName]);
      if (!res.stdout || res.stdout.includes('Unable to find package')) {
        return { installed: false };
      }
      const versionNameMatch = res.stdout.match(/versionName=([^\s]+)/);
      const versionCodeMatch = res.stdout.match(/versionCode=(\d+)/);
      return {
        installed: true,
        packageName,
        versionName: versionNameMatch ? versionNameMatch[1] : 'Unknown',
        versionCode: versionCodeMatch ? versionCodeMatch[1] : 'Unknown'
      };
    } catch (e) {
      return { installed: false, error: e.message };
    }
  }

  /**
   * Get all active PIDs for an application package on target device
   */
  async getPids(serial, packageName) {
    if (!serial || !packageName) return [];
    try {
      const res = await this.execute(['-s', serial, 'shell', 'pidof', packageName]);
      if (res.code === 0 && res.stdout.trim().length > 0) {
        const pids = res.stdout.trim().split(/\s+/).filter(Boolean);
        if (pids.length > 0) return pids;
      }
    } catch (e) {}

    try {
      const psRes = await this.execute(['-s', serial, 'shell', 'ps', '-A']);
      if (psRes.code === 0 && psRes.stdout) {
        const lines = psRes.stdout.split('\n');
        const pids = [];
        const regex = new RegExp(`\\b${packageName.replace(/\./g, '\\.')}\\b`);
        for (const line of lines) {
          if (regex.test(line)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length > 1 && /^\d+$/.test(parts[1])) {
              pids.push(parts[1]);
            }
          }
        }
        if (pids.length > 0) return pids;
      }
    } catch (err) {
      logger.debug(`[getPids fallback error]: ${err.message}`);
    }

    return [];
  }

  /**
   * Get primary active PID for an application package
   */
  async getPid(serial, packageName) {
    const pids = await this.getPids(serial, packageName);
    return pids.length > 0 ? pids[0] : null;
  }

  /**
   * Check if application package is currently running on device (foreground, background, or active PID)
   */
  async isAppRunning(serial, packageName) {
    if (!serial || !packageName) return false;
    try {
      const res = await this.execute(['-s', serial, 'shell', 'pidof', packageName]);
      if (res.code === 0 && res.stdout.trim().length > 0) {
        const pids = res.stdout.trim().split(/\s+/).filter(Boolean);
        if (pids.length > 0) return true;
      }
    } catch (e) {
      // Fallback below
    }

    try {
      // Fallback check using ps -A
      const psRes = await this.execute(['-s', serial, 'shell', 'ps', '-A']);
      if (psRes.code === 0 && psRes.stdout) {
        const regex = new RegExp(`\\b${packageName.replace(/\./g, '\\.')}\\b`);
        return regex.test(psRes.stdout);
      }
    } catch (err) {
      logger.debug(`[isAppRunning fallback error]: ${err.message}`);
    }

    return false;
  }

  /**
   * Force stop application process
   */
  async stopApp(serial, packageName) {
    if (!packageName) throw new Error('Package name is required');
    await this.execute(['-s', serial, 'shell', 'am', 'force-stop', packageName]);
    return { success: true, message: `Stopped ${packageName}` };
  }

  /**
   * Clear application data
   */
  async clearAppData(serial, packageName) {
    if (!packageName) throw new Error('Package name is required');
    const res = await this.execute(['-s', serial, 'shell', 'pm', 'clear', packageName]);
    if (!res.stdout.includes('Success')) {
      throw new Error(`Failed to clear app data: ${res.raw}`);
    }
    return { success: true, message: `Cleared app data for ${packageName}` };
  }

  /**
   * Clear application cache only (does not clear persistent user databases/data, does not uninstall)
   */
  async clearAppCache(serial, packageName) {
    if (!packageName) throw new Error('Package name is required');
    if (!serial) throw new Error('Device serial is required');

    // 1. Verify package is installed
    const isInstalled = await this.isPackageInstalled(serial, packageName);
    if (!isInstalled) {
      throw new Error(`Package '${packageName}' is not installed on device ${serial}.`);
    }

    try {
      // 2. Request Android package manager to trim/purge cache allocations
      await this.execute(['-s', serial, 'shell', 'pm', 'trim-caches', '4096M']).catch(() => {});

      // 3. Clear external cache directories on shared storage if present
      await this.execute([
        '-s', serial,
        'shell',
        'rm', '-rf',
        `/sdcard/Android/data/${packageName}/cache`,
        `/storage/emulated/0/Android/data/${packageName}/cache`
      ]).catch(() => {});

      // 4. If app is debuggable, also clean internal cache directory via run-as
      await this.execute([
        '-s', serial,
        'shell',
        'run-as', packageName,
        'rm', '-rf', 'cache', 'code_cache'
      ]).catch(() => {});

      logger.info(`[ADB Clear Cache] Cleared application cache for ${packageName} on device ${serial}`);
      return { success: true, message: `Cleared cache for ${packageName}` };
    } catch (err) {
      throw new Error(`Failed to clear cache for ${packageName}: ${err.message}`);
    }
  }

  /**
   * Uninstall application
   */
  async uninstallApp(serial, packageName) {
    if (!packageName) throw new Error('Package name is required');
    const res = await this.execute(['-s', serial, 'uninstall', packageName]);
    if (!res.stdout.includes('Success')) {
      throw new Error(`Failed to uninstall ${packageName}: ${res.raw}`);
    }
    return { success: true, message: `Uninstalled ${packageName}` };
  }

  /**
   * State-aware Launch / Relaunch application.
   * If app is not running -> launches normally.
   * If app is already running -> force-stops and launches from a fresh state.
   */
  async launchApp(serial, packageName) {
    if (!packageName) throw new Error('Package name is required');
    if (!serial) throw new Error('Device serial is required');

    // 1. Verify package is installed
    const isInstalled = await this.isPackageInstalled(serial, packageName);
    if (!isInstalled) {
      throw new Error(`Package '${packageName}' is not installed on device ${serial}.`);
    }

    // 2. Check if app is currently running
    const isRunning = await this.isAppRunning(serial, packageName);

    // 3. If running, force-stop it first to ensure clean relaunch
    if (isRunning) {
      logger.info(`[ADB Launch] App ${packageName} is already running on ${serial}. Force-stopping for clean relaunch...`);
      await this.stopApp(serial, packageName);
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // 4. Launch default launcher activity via monkey
    const res = await this.execute([
      '-s', serial,
      'shell', 'monkey',
      '-p', packageName,
      '-c', 'android.intent.category.LAUNCHER',
      '1'
    ]);

    if (res.raw.toLowerCase().includes('no activities found') || res.raw.toLowerCase().includes('error')) {
      throw new Error(`Failed to launch ${packageName}: ${res.raw}`);
    }

    const actionText = isRunning ? 'Relaunched' : 'Launched';
    logger.info(`[ADB Launch] ${actionText} ${packageName} on device ${serial}`);

    return {
      success: true,
      relaunched: isRunning,
      isRunning,
      message: `${actionText} ${packageName}`
    };
  }

  /**
   * Clear logcat buffer
   */
  async clearLogcat(serial) {
    await this.execute(['-s', serial, 'logcat', '-c']);
    return { success: true, message: 'Logcat buffer cleared' };
  }

  /**
   * Spawn a streaming logcat process
   */
  streamLogcat(serial, tags = []) {
    const args = ['-s', serial, 'logcat', '-v', 'time'];
    if (tags && tags.length > 0) {
      tags.forEach(t => args.push(`${t}:V`));
      args.push('*:S');
    }
    return spawn(this.adbPath, args, { windowsHide: true });
  }

  /**
   * Spawn a PID-scoped streaming logcat process
   */
  streamPidLogcat(serial, pid, tags = []) {
    const args = ['-s', serial, 'logcat', '--pid', String(pid), '-v', 'time'];
    if (tags && tags.length > 0) {
      tags.forEach(t => args.push(`${t}:V`));
      args.push('*:S');
    }
    return spawn(this.adbPath, args, { windowsHide: true });
  }

  /**
   * Strictly allowlisted safe custom ADB command runner
   */
  async runSafeAdbCommand(serial, commandStr) {
    if (!commandStr || typeof commandStr !== 'string') {
      throw new Error('Command string is required');
    }

    const trimmed = commandStr.trim();
    // Disallow dangerous shell metacharacters
    if (/[;&|`$<>]/.test(trimmed)) {
      throw new Error('Command contains disallowed operators or shell metacharacters');
    }

    const allowedPrefixes = [
      'adb devices',
      'adb shell df',
      'adb shell dumpsys package',
      'adb shell dumpsys battery',
      'adb shell getprop',
      'adb shell wm size',
      'adb shell pm list packages',
      'adb shell pm clear',
      'adb uninstall',
      'adb logcat -c',
      'adb logcat -d',
      'adb shell monkey -p',
      'adb shell am force-stop',
      'adb shell am start',
      'adb shell pidof',
      'adb shell ps',
      'adb shell setprop'
    ];

    const isAllowed = allowedPrefixes.some(prefix => trimmed.startsWith(prefix) || trimmed.startsWith(prefix.replace('adb ', '')));
    if (!isAllowed) {
      throw new Error(`Command is not in the safe allowlist. Allowed commands: devices, getprop, dumpsys, df, pm list, pm clear, uninstall, logcat, monkey.`);
    }

    // Split args safely
    let parts = trimmed.split(/\s+/);
    if (parts[0] === 'adb') {
      parts = parts.slice(1);
    }

    // Insert serial if not provided
    if (serial && !parts.includes('-s')) {
      parts = ['-s', serial, ...parts];
    }

    const res = await this.execute(parts, { timeout: 15000 });
    return {
      command: trimmed,
      code: res.code,
      output: res.raw
    };
  }

  /**
   * Fast device liveness check (fails fast if device entered offline or disconnected state)
   */
  async assertDeviceOnline(serial) {
    if (!serial) throw new Error('Device serial is required for liveness check');
    try {
      const res = await this.execute(['-s', serial, 'get-state'], { timeout: 3000 });
      const state = (res.stdout || '').trim().toLowerCase();
      if (state === 'device') {
        return { online: true, state: 'device' };
      }
      throw new Error(`Device '${serial}' is not ready (State: ${state || 'offline'}).`);
    } catch (err) {
      throw new Error(`Device '${serial}' is offline or disconnected: ${err.message}`);
    }
  }

  /**
   * Check if device is online without throwing
   */
  async isDeviceOnline(serial) {
    try {
      await this.assertDeviceOnline(serial);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Acquire screen stay-awake for a device during test execution.
   * Wakes up the screen, dismisses the keyguard, reads and captures the original
   * stay_on_while_plugged_in setting, and engages stay-awake.
   * Returns metadata including original setting for guaranteed restoration.
   */
  async acquireStayAwake(serial) {
    if (!serial) return null;
    try {
      // 1. Wake up screen and dismiss keyguard
      await this.execute(['-s', serial, 'shell', 'input', 'keyevent', '224'], { timeout: 3000 }).catch(() => {});
      await this.execute(['-s', serial, 'shell', 'wm', 'dismiss-keyguard'], { timeout: 3000 }).catch(() => {});

      // 2. Capture original stay_on_while_plugged_in setting
      let originalStayOn = null;
      try {
        const getRes = await this.execute(['-s', serial, 'shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in'], { timeout: 3000 });
        const val = (getRes.stdout || '').trim();
        if (val && val !== 'null') {
          originalStayOn = val;
        }
      } catch (err) {
        logger.debug(`[AdbService] Error querying stay_on_while_plugged_in for ${serial}: ${err.message}`);
      }

      // 3. Engage stay-awake (AC, USB, Wireless charging mask = 7)
      await this.execute(['-s', serial, 'shell', 'svc', 'power', 'stayon', 'true'], { timeout: 4000 }).catch(() => {});
      await this.execute(['-s', serial, 'shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '7'], { timeout: 4000 }).catch(() => {});

      logger.info(`[AdbService] Engaged temporary screen stay-awake on ${serial} (original setting: ${originalStayOn ?? 'none'}).`);
      return {
        serial,
        originalStayOn,
        acquiredAt: Date.now()
      };
    } catch (err) {
      logger.warn(`[AdbService] Failed to acquire stay-awake on ${serial}: ${err.message}`);
      return null;
    }
  }

  /**
   * Restore captured screen stay-awake setting on target device.
   * Guaranteed safe execution (never throws).
   */
  async restoreStayAwake(serial, originalStayOn) {
    if (!serial) return false;
    try {
      if (originalStayOn === null || originalStayOn === undefined || originalStayOn === 'null' || originalStayOn === '') {
        await this.execute(['-s', serial, 'shell', 'svc', 'power', 'stayon', 'false'], { timeout: 4000 }).catch(() => {});
        await this.execute(['-s', serial, 'shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '0'], { timeout: 4000 }).catch(() => {});
      } else {
        await this.execute(['-s', serial, 'shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', String(originalStayOn)], { timeout: 4000 }).catch(() => {});
        if (String(originalStayOn) === '0') {
          await this.execute(['-s', serial, 'shell', 'svc', 'power', 'stayon', 'false'], { timeout: 4000 }).catch(() => {});
        } else if (String(originalStayOn) === '7') {
          await this.execute(['-s', serial, 'shell', 'svc', 'power', 'stayon', 'true'], { timeout: 4000 }).catch(() => {});
        }
      }
      logger.info(`[AdbService] Restored screen stay-awake on ${serial} to ${originalStayOn ?? '0'}.`);
      return true;
    } catch (err) {
      logger.warn(`[AdbService] Failed to restore stay-awake on ${serial}: ${err.message}`);
      return false;
    }
  }

  /**
   * Install standalone .apk file directly to target device with process tracking and bounded timeout
   */
  async installApk(serial, apkPath, options = {}) {
    if (!fs.existsSync(apkPath)) {
      throw new Error(`APK file not found at ${apkPath}`);
    }

    // 1. Fast liveness check before starting heavy install
    await this.assertDeviceOnline(serial);

    const args = ['-s', serial, 'install', '-r', '-d', '-t', '-g'];

    // For Android 11+ (API 30+), prevent adb streaming server hangs on Wi-Fi
    try {
      const sdkRes = await this.execute(['-s', serial, 'shell', 'getprop', 'ro.build.version.sdk'], { timeout: 2000 });
      const sdk = parseInt((sdkRes.stdout || '').trim(), 10);
      if (sdk >= 30) {
        args.push('--no-incremental');
      }
    } catch (e) {}

    args.push(apkPath);
    logger.info(`[ADB Install APK] ${this.adbPath} ${args.join(' ')}`);

    const timeoutMs = options.timeout || 120000; // 2 minutes bounded timeout

    return new Promise((resolve, reject) => {
      const proc = spawn(this.adbPath, args, { windowsHide: true });
      if (options.onSpawn && typeof options.onSpawn === 'function') {
        options.onSpawn(proc);
      }

      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try { proc.kill('SIGKILL'); } catch (e) {}
        reject(new Error(`APK installation timed out after ${timeoutMs}ms on device ${serial}`));
      }, timeoutMs);

      proc.stdout.on('data', (chunk) => {
        const str = chunk.toString();
        stdout += str;
        if (options.onLog) options.onLog(str);
      });

      proc.stderr.on('data', (chunk) => {
        const str = chunk.toString();
        stderr += str;
        if (options.onLog) options.onLog(str);
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`APK install execution error: ${err.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timer);
        if (timedOut) return;
        const raw = (stdout + '\n' + stderr).trim();
        if (code === 0 && (stdout.includes('Success') || !raw.toLowerCase().includes('failure'))) {
          resolve({ code, stdout: stdout.trim(), stderr: stderr.trim(), raw });
        } else {
          reject(new Error(`APK installation failed (code ${code}): ${raw || 'Unknown error'}`));
        }
      });
    });
  }
}

module.exports = new AdbService();

