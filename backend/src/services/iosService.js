const { spawn } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');

class IosService {
  constructor() {
    this.pythonPath = config.PYTHON_PATH;
    this.bridgePath = config.IOS_BRIDGE_PATH;
    this.cachedDevices = new Map(); // udid -> device object
  }

  /**
   * Helper to check if a serial/identifier is likely an iOS UDID.
   * iOS UDIDs are typically 40-character hex (older) or 25-character (8-16 hyphenated) hex (iOS 12+).
   */
  isIosDevice(serial) {
    if (!serial) return false;
    if (this.cachedDevices.has(serial)) return true;
    try {
      const agentService = require('./agentService');
      if (agentService && agentService.isAgentIosDevice(serial)) return true;
    } catch (e) {}
    // Check UDID pattern: 40 hex chars or 8-16 hex chars (e.g., 00008110-001A29040182801E)
    const isUdid = /^[0-9a-fA-F]{40}$/.test(serial) || /^[0-9a-fA-F]{8}-[0-9a-fA-F]{16}$/.test(serial);
    return isUdid;
  }

  /**
   * List all currently connected iOS devices via pymobiledevice3 bridge.
   * Returns normalized device array.
   */
  async listDevices() {
    return new Promise((resolve) => {
      let stdoutData = '';
      let stderrData = '';

      const proc = spawn(this.pythonPath, [this.bridgePath, 'list'], {
        timeout: 10000,
        windowsHide: true
      });

      proc.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderrData += data.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          logger.debug(`[iOS Service] Discovery exited with code ${code}: ${stderrData.trim()}`);
          resolve(Array.from(this.cachedDevices.values()).filter(d => d.connected));
          return;
        }

        try {
          const raw = stdoutData.trim();
          const parsed = raw ? JSON.parse(raw) : [];
          
          // Update cache
          const currentUdids = new Set();
          for (const dev of parsed) {
            const normalized = {
              serial: dev.udid,
              udid: dev.udid,
              name: dev.name || 'iPhone',
              model: dev.model || 'iPhone',
              productType: dev.productType || 'iPhone',
              manufacturer: 'Apple',
              platform: 'ios',
              iosVersion: dev.iosVersion || 'Unknown',
              osVersion: dev.osVersion || `iOS ${dev.iosVersion || ''}`.trim(),
              state: 'device',
              connected: true,
              isWireless: !!dev.isWireless,
              trustStatus: dev.trustStatus || 'trusted',
              trustMessage: dev.trustMessage || null,
              developerMode: dev.developerMode ?? null,
              connectionMode: 'server-ios',
              battery: dev.battery || 'N/A',
              batteryStatus: dev.batteryStatus || '',
              storageFree: dev.storageFree || 'N/A',
              storageTotal: dev.storageTotal || 'N/A',
              screenResolution: dev.screenResolution || '1170 × 2532'
            };
            this.cachedDevices.set(dev.udid, normalized);
            currentUdids.add(dev.udid);
          }

          // Mark missing cached devices as disconnected
          for (const [udid, dev] of this.cachedDevices.entries()) {
            if (!currentUdids.has(udid)) {
              this.cachedDevices.delete(udid);
            }
          }

          resolve(Array.from(this.cachedDevices.values()));
        } catch (err) {
          logger.debug(`[iOS Service] Failed to parse device list: ${err.message}`);
          resolve(Array.from(this.cachedDevices.values()));
        }
      });

      proc.on('error', (err) => {
        logger.debug(`[iOS Service] Failed to spawn python bridge: ${err.message}`);
        resolve(Array.from(this.cachedDevices.values()));
      });
    });
  }

  /**
   * Get detailed device information by UDID.
   */
  async getDeviceInfo(udid) {
    if (this.cachedDevices.has(udid)) {
      return this.cachedDevices.get(udid);
    }

    const devices = await this.listDevices();
    const found = devices.find(d => d.udid === udid || d.serial === udid);
    if (found) return found;

    return {
      serial: udid,
      udid: udid,
      name: 'iPhone',
      model: 'iPhone',
      productType: 'iPhone',
      manufacturer: 'Apple',
      platform: 'ios',
      iosVersion: 'Unknown',
      osVersion: 'iOS',
      state: 'device',
      connected: true,
      isWireless: false,
      trustStatus: 'trusted',
      trustMessage: null,
      connectionMode: 'server-ios',
      battery: 'N/A',
      batteryStatus: '',
      storageFree: 'N/A',
      storageTotal: 'N/A',
      screenResolution: '1170 × 2532'
    };
  }

  /**
   * Disconnect an iOS device.
   */
  async disconnectDevice(udid) {
    this.cachedDevices.delete(udid);
    return { success: true, message: `iOS device ${udid} disconnected.` };
  }

  /**
   * Query iOS environment and USB diagnostics.
   */
  async getDiagnostics() {
    return new Promise((resolve) => {
      let stdoutData = '';
      const proc = spawn(this.pythonPath, [this.bridgePath, 'diagnostics'], {
        timeout: 8000,
        windowsHide: true
      });

      proc.stdout.on('data', (d) => { stdoutData += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0 && stdoutData.trim()) {
          try {
            resolve(JSON.parse(stdoutData.trim()));
            return;
          } catch (e) {}
        }
        resolve({
          pythonAvailable: false,
          pymobiledevice3Available: false,
          usbmuxdReachable: false,
          connectedDevicesCount: 0,
          error: 'Diagnostics execution error'
        });
      });
      proc.on('error', (err) => {
        resolve({
          pythonAvailable: false,
          pymobiledevice3Available: false,
          usbmuxdReachable: false,
          connectedDevicesCount: 0,
          error: err.message
        });
      });
    });
  }
}

module.exports = new IosService();
