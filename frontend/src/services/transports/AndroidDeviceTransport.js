/**
 * AndroidDeviceTransport.js
 * Base abstract class defining the common transport interface for Android device operations.
 * Enforces a normalized command execution and operation response contract across
 * Server ADB, Wireless ADB, and Browser WebADB connections.
 */

export class AndroidDeviceTransport {
  constructor(device) {
    this.device = device;
  }

  get serial() {
    return this.device?.serial;
  }

  get connectionMode() {
    return this.device?.connectionMode || (this.device?.serial?.startsWith('browser_usb_') ? 'browser-usb' : 'server-adb');
  }

  get isBrowserUsb() {
    return this.connectionMode === 'browser-usb';
  }

  /**
   * Normalize any command output into the standard application contract:
   * {
   *   success: boolean,
   *   stdout: string,
   *   stderr: string,
   *   exitCode: number | null,
   *   error: string | null,
   *   raw: string
   * }
   */
  static normalizeCommandResult(rawResult) {
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let error = null;

    if (rawResult === null || rawResult === undefined) {
      stdout = '';
      stderr = '';
      exitCode = 0;
    } else if (typeof rawResult === 'string') {
      stdout = rawResult;
    } else if (rawResult instanceof Uint8Array || rawResult instanceof ArrayBuffer) {
      stdout = new TextDecoder().decode(rawResult);
    } else if (typeof rawResult === 'object') {
      // Handle { stdout, stderr, exitCode } from WebADB ShellProtocol or Server ADB
      if (rawResult.stdout !== undefined) {
        if (typeof rawResult.stdout === 'string') {
          stdout = rawResult.stdout;
        } else if (rawResult.stdout instanceof Uint8Array || rawResult.stdout instanceof ArrayBuffer) {
          stdout = new TextDecoder().decode(rawResult.stdout);
        } else {
          stdout = String(rawResult.stdout || '');
        }
      }

      if (rawResult.stderr !== undefined) {
        if (typeof rawResult.stderr === 'string') {
          stderr = rawResult.stderr;
        } else if (rawResult.stderr instanceof Uint8Array || rawResult.stderr instanceof ArrayBuffer) {
          stderr = new TextDecoder().decode(rawResult.stderr);
        } else {
          stderr = String(rawResult.stderr || '');
        }
      }

      if (typeof rawResult.exitCode === 'number') {
        exitCode = rawResult.exitCode;
      } else if (typeof rawResult.code === 'number') {
        exitCode = rawResult.code;
      }

      if (rawResult.error) {
        error = typeof rawResult.error === 'string' ? rawResult.error : (rawResult.error.message || String(rawResult.error));
      }
    } else {
      stdout = String(rawResult);
    }

    // Ensure strict strings
    stdout = typeof stdout === 'string' ? stdout : '';
    stderr = typeof stderr === 'string' ? stderr : '';

    const isSuccess = exitCode === 0 && !error;
    const combinedRaw = stdout + (stderr ? (stdout ? '\n' : '') + stderr : '');

    return {
      success: isSuccess,
      stdout,
      stderr,
      exitCode,
      error: isSuccess ? null : (error || stderr || stdout || 'Command failed'),
      raw: combinedRaw
    };
  }

  /**
   * Execute low-level command on device
   */
  async executeCommand(command, options = {}) {
    throw new Error('executeCommand() must be implemented by transport subclass');
  }

  /**
   * Execute allowlisted safe ADB command
   */
  async executeSafeAdb(command) {
    throw new Error('executeSafeAdb() must be implemented by transport subclass');
  }

  /**
   * Query device hardware/software information
   */
  async getDeviceInfo() {
    throw new Error('getDeviceInfo() must be implemented by transport subclass');
  }

  /**
   * Check if an application package is installed on the device
   */
  async isPackageInstalled(packageName) {
    throw new Error('isPackageInstalled() must be implemented by transport subclass');
  }

  /**
   * Check if an application is currently running
   */
  async isAppRunning(packageName) {
    throw new Error('isAppRunning() must be implemented by transport subclass');
  }

  /**
   * Get package version info
   */
  async getPackageInfo(packageName) {
    throw new Error('getPackageInfo() must be implemented by transport subclass');
  }

  /**
   * State-aware Relaunch
   */
  async relaunchApp(packageName) {
    throw new Error('relaunchApp() must be implemented by transport subclass');
  }

  /**
   * Clear Application Data (pm clear)
   */
  async clearAppData(packageName) {
    throw new Error('clearAppData() must be implemented by transport subclass');
  }

  /**
   * Clear Application Cache only
   */
  async clearAppCache(packageName) {
    throw new Error('clearAppCache() must be implemented by transport subclass');
  }

  /**
   * Uninstall Application (adb uninstall)
   */
  async uninstallApp(packageName) {
    throw new Error('uninstallApp() must be implemented by transport subclass');
  }

  /**
   * Clear device logcat buffer
   */
  async clearLogcat() {
    throw new Error('clearLogcat() must be implemented by transport subclass');
  }

  /**
   * Start streaming logcat
   */
  async startLogcat(onLogLine) {
    throw new Error('startLogcat() must be implemented by transport subclass');
  }

  /**
   * Stop streaming logcat
   */
  stopLogcat() {
    throw new Error('stopLogcat() must be implemented by transport subclass');
  }

  /**
   * Capture high-res screenshot
   */
  async captureScreenshot() {
    throw new Error('captureScreenshot() must be implemented by transport subclass');
  }

  /**
   * Send remote user input event
   */
  async sendInput(event) {
    throw new Error('sendInput() must be implemented by transport subclass');
  }
}
