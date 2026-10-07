/**
 * BrowserAdbTransport.js
 * Transport implementation for direct WebUSB / WebADB connected Android devices.
 * Communicates directly with the physical device via @yume-chan/adb.
 * Normalizes all binary streams, subprocess results, and lifecycle management.
 */

import { AndroidDeviceTransport } from './AndroidDeviceTransport';

export class BrowserAdbTransport extends AndroidDeviceTransport {
  constructor(device, webUsbService) {
    super(device);
    this.webUsbService = webUsbService;
    this._commandLock = Promise.resolve();
  }

  get adb() {
    return this.webUsbService?.adb;
  }

  get isConnected() {
    return !!this.adb && !!this.webUsbService?.transport;
  }

  /**
   * Sequential execution lock to prevent overlapping ADB socket collisions
   */
  async _withLock(fn) {
    let release;
    const waitPromise = new Promise((resolve) => {
      release = resolve;
    });
    const previousLock = this._commandLock;
    this._commandLock = waitPromise;

    try {
      await previousLock;
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Low-level command runner with robust result normalization and stream cleanup
   */
  async executeCommand(command, options = {}) {
    if (!this.isConnected) {
      throw new Error('Device disconnected. WebUSB ADB connection is not active.');
    }

    return await this._withLock(async () => {
      const runner = this.adb.subprocess.shellProtocol || this.adb.subprocess.noneProtocol;
      if (!runner) {
        throw new Error('ADB Subprocess service is unavailable on this device.');
      }

      try {
        let rawResult;

        if (this.adb.subprocess.shellProtocol) {
          // shellProtocol.spawnWaitText returns { stdout: string, stderr: string, exitCode: number }
          rawResult = await this.adb.subprocess.shellProtocol.spawnWaitText(command);
        } else {
          // noneProtocol.spawnWaitText returns string | Uint8Array
          rawResult = await this.adb.subprocess.noneProtocol.spawnWaitText(command);
        }

        return AndroidDeviceTransport.normalizeCommandResult(rawResult);
      } catch (err) {
        // If the error was a transport drop or disconnect
        if (err.message && (err.message.includes('closed') || err.message.includes('destroyed') || err.message.includes('USB'))) {
          throw new Error(`ADB connection lost: ${err.message}`);
        }
        return AndroidDeviceTransport.normalizeCommandResult({
          stdout: '',
          stderr: err.message || 'Execution error',
          exitCode: -1,
          error: err.message || 'Execution error'
        });
      }
    });
  }

  /**
   * Safe Allowlisted ADB Execution for Browser USB devices
   */
  async executeSafeAdb(command) {
    if (!command || typeof command !== 'string') {
      throw new Error('Command string is required');
    }

    const trimmed = command.trim();
    const allowedPrefixes = [
      'adb devices',
      'adb shell getprop',
      'adb shell dumpsys',
      'adb shell df',
      'adb shell pm list',
      'adb shell pm clear',
      'adb shell pm trim-caches',
      'adb shell pm path',
      'adb shell wm size',
      'adb shell monkey',
      'adb logcat',
      'adb shell am force-stop',
      'adb shell am start',
      'adb shell pidof',
      'adb shell ps',
      'getprop',
      'dumpsys',
      'df',
      'pm list',
      'pm clear',
      'pm trim-caches',
      'pm path',
      'wm size',
      'monkey',
      'logcat',
      'am force-stop',
      'am start',
      'pidof',
      'ps'
    ];

    const isAllowed = allowedPrefixes.some(
      (prefix) => trimmed.startsWith(prefix) || trimmed.startsWith(prefix.replace('adb ', ''))
    );

    if (!isAllowed) {
      throw new Error(
        `Command is not in the safe allowlist. Allowed commands: devices, getprop, dumpsys, df, pm list, pm clear, pm trim-caches, wm size, logcat, monkey.`
      );
    }

    // Strip leading 'adb shell' or 'adb'
    let cmdToRun = trimmed;
    if (cmdToRun.startsWith('adb shell ')) {
      cmdToRun = cmdToRun.replace('adb shell ', '');
    } else if (cmdToRun.startsWith('adb ')) {
      cmdToRun = cmdToRun.replace('adb ', '');
    }

    if (cmdToRun === 'devices') {
      const dev = this.webUsbService.getConnectedDevice();
      return {
        success: true,
        output: `List of devices attached\n${dev ? `${dev.hardwareSerial || dev.serial}\tdevice (browser-usb)` : ''}\n`
      };
    }

    const res = await this.executeCommand(cmdToRun);
    return {
      success: res.success,
      output: res.raw || '(No output)'
    };
  }

  /**
   * Retrieve real device metadata
   */
  async getDeviceInfo() {
    if (!this.isConnected) {
      throw new Error('Device disconnected. WebUSB ADB connection is not active.');
    }
    return await this.webUsbService.queryDeviceInfo(this.device?.hardwareSerial || this.serial);
  }

  /**
   * Check if application package is installed
   */
  async isPackageInstalled(packageName) {
    if (!packageName) return false;
    try {
      const res = await this.executeCommand(['pm', 'list', 'packages', packageName]);
      return res.stdout.includes(`package:${packageName}`);
    } catch (e) {
      return false;
    }
  }

  /**
   * Check if application is currently running
   */
  async isAppRunning(packageName) {
    if (!packageName) return false;
    try {
      const pidRes = await this.executeCommand(['pidof', packageName]);
      if (pidRes.success && pidRes.stdout.trim().length > 0) {
        const pids = pidRes.stdout.trim().split(/\s+/).filter(Boolean);
        if (pids.length > 0) return true;
      }
    } catch (e) {}

    try {
      const psRes = await this.executeCommand(['ps', '-A']);
      if (psRes.success && psRes.stdout) {
        const regex = new RegExp(`\\b${packageName.replace(/\./g, '\\.')}\\b`);
        return regex.test(psRes.stdout);
      }
    } catch (e) {}

    return false;
  }

  /**
   * Get package version information
   */
  async getPackageInfo(packageName) {
    if (!packageName) return { installed: false };
    try {
      const res = await this.executeCommand(['dumpsys', 'package', packageName]);
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
   * State-aware Launch / Relaunch
   */
  async relaunchApp(packageName) {
    if (!packageName) throw new Error('Package name is required');

    // 1. Verify package is installed
    const isInstalled = await this.isPackageInstalled(packageName);
    if (!isInstalled) {
      throw new Error(`Package '${packageName}' is not installed on this device.`);
    }

    // 2. Check if running
    const isRunning = await this.isAppRunning(packageName);
    if (isRunning) {
      await this.executeCommand(['am', 'force-stop', packageName]);
      await new Promise((r) => setTimeout(r, 250));
    }

    // 3. Launch via monkey launcher
    const launchRes = await this.executeCommand([
      'monkey',
      '-p',
      packageName,
      '-c',
      'android.intent.category.LAUNCHER',
      '1'
    ]);

    if (
      launchRes.stdout.toLowerCase().includes('no activities found') ||
      launchRes.stderr.toLowerCase().includes('error')
    ) {
      // Fallback to am start
      await this.executeCommand(['am', 'start', '-n', `${packageName}/.MainActivity`]).catch(() => {});
    }

    return {
      success: true,
      message: isRunning
        ? `Force-stopped running process and relaunched ${packageName} on Browser USB device`
        : `Launched ${packageName} on Browser USB device`
    };
  }

  /**
   * Clear Application Data (pm clear)
   */
  async clearAppData(packageName) {
    if (!packageName) throw new Error('Package name is required');

    // 1. Verify package is installed
    const isInstalled = await this.isPackageInstalled(packageName);
    if (!isInstalled) {
      throw new Error(`Package '${packageName}' is not installed on this device.`);
    }

    // 2. Execute pm clear
    const res = await this.executeCommand(['pm', 'clear', packageName]);
    if (!res.stdout.includes('Success')) {
      throw new Error(`Failed to clear app data for ${packageName}: ${res.raw || res.stderr || 'Unknown error'}`);
    }

    return {
      success: true,
      message: `Cleared app data for ${packageName} on Browser USB device`
    };
  }

  /**
   * Clear Application Cache only
   */
  async clearAppCache(packageName) {
    if (!packageName) throw new Error('Package name is required');

    // 1. Verify package is installed
    const isInstalled = await this.isPackageInstalled(packageName);
    if (!isInstalled) {
      throw new Error(`Package '${packageName}' is not installed on this device.`);
    }

    // 2. Request Android package manager to trim/purge cache allocations
    await this.executeCommand(['pm', 'trim-caches', '4096M']).catch(() => {});

    // 3. Clear external cache directories on shared storage if present
    await this.executeCommand([
      'rm',
      '-rf',
      `/sdcard/Android/data/${packageName}/cache`,
      `/storage/emulated/0/Android/data/${packageName}/cache`
    ]).catch(() => {});

    // 4. If debuggable, clean internal cache directory via run-as
    await this.executeCommand(['run-as', packageName, 'rm', '-rf', 'cache', 'code_cache']).catch(() => {});

    return {
      success: true,
      message: `Cleared cache for ${packageName} on Browser USB device`
    };
  }

  /**
   * Uninstall Application
   */
  async uninstallApp(packageName) {
    if (!packageName) throw new Error('Package name is required');

    // Check if installed
    const isInstalled = await this.isPackageInstalled(packageName);
    if (!isInstalled) {
      return {
        success: true,
        message: `Application ${packageName} is not installed.`
      };
    }

    const res = await this.executeCommand(['pm', 'uninstall', packageName]);
    if (!res.stdout.includes('Success')) {
      throw new Error(`Failed to uninstall ${packageName}: ${res.raw || res.stderr || 'Unknown error'}`);
    }

    return {
      success: true,
      message: `Uninstalled ${packageName} from Browser USB device`
    };
  }

  /**
   * Clear Logcat buffer
   */
  async clearLogcat() {
    const res = await this.executeCommand(['logcat', '-c']);
    return {
      success: res.success,
      message: 'Logcat buffer cleared on Browser USB device'
    };
  }

  /**
   * Start streaming logcat
   */
  async startLogcat(onLogLine) {
    return await this.webUsbService.startLogcat(onLogLine);
  }

  /**
   * Stop streaming logcat
   */
  stopLogcat() {
    this.webUsbService.stopLogcat();
  }

  /**
   * Capture high-res screenshot
   */
  async captureScreenshot() {
    return await this.webUsbService.captureScreenshot();
  }

  /**
   * Send touch / gesture / key input
   */
  async sendInput(event) {
    if (!event) return;
    if (event.type === 'tap') {
      await this.executeCommand(['input', 'tap', String(Math.round(event.x)), String(Math.round(event.y))]);
    } else if (event.type === 'swipe') {
      await this.executeCommand([
        'input',
        'swipe',
        String(Math.round(event.x)),
        String(Math.round(event.y)),
        String(Math.round(event.endX)),
        String(Math.round(event.endY)),
        String(event.durationMs || 300)
      ]);
    } else if (event.type === 'keyevent') {
      await this.executeCommand(['input', 'keyevent', String(event.keycode)]);
    }
  }
}
