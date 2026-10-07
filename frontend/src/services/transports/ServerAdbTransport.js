/**
 * ServerAdbTransport.js
 * Transport implementation for Server-side ADB and Wireless ADB devices.
 * Communicates with the backend REST endpoints and WebSocket service.
 */

import { AndroidDeviceTransport } from './AndroidDeviceTransport';
import { api } from '../api';

export class ServerAdbTransport extends AndroidDeviceTransport {
  constructor(device) {
    super(device);
  }

  async executeCommand(command, options = {}) {
    if (!this.serial) throw new Error('Device serial is required');
    try {
      const res = await api.executeSafeAdb(this.serial, typeof command === 'string' ? command : command.join(' '));
      return AndroidDeviceTransport.normalizeCommandResult({
        stdout: res.output || '',
        stderr: '',
        exitCode: 0
      });
    } catch (err) {
      return AndroidDeviceTransport.normalizeCommandResult({
        stdout: '',
        stderr: err.message,
        exitCode: -1,
        error: err.message
      });
    }
  }

  async executeSafeAdb(command) {
    if (!this.serial) throw new Error('Device serial is required');
    const res = await api.executeSafeAdb(this.serial, command);
    return {
      success: true,
      output: res.output || '(No output)'
    };
  }

  async getDeviceInfo() {
    if (!this.serial) throw new Error('Device serial is required');
    return await api.getDeviceInfo(this.serial);
  }

  async isPackageInstalled(packageName) {
    if (!this.serial) return false;
    try {
      const info = await api.getDeviceInfo(this.serial);
      if (!info) return false;
      // Alternatively run safe check
      const res = await this.executeCommand(`adb shell pm list packages ${packageName}`);
      return res.stdout.includes(`package:${packageName}`);
    } catch (e) {
      return false;
    }
  }

  async isAppRunning(packageName) {
    if (!this.serial) return false;
    try {
      const res = await this.executeCommand(`adb shell pidof ${packageName}`);
      return res.success && res.stdout.trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  async getPackageInfo(packageName) {
    if (!this.serial) return { installed: false };
    try {
      const res = await this.executeCommand(`adb shell dumpsys package ${packageName}`);
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

  async relaunchApp(packageName) {
    if (!this.serial) throw new Error('Device serial is required');
    return await api.launchApp(this.serial, packageName);
  }

  async clearAppData(packageName) {
    if (!this.serial) throw new Error('Device serial is required');
    return await api.clearAppData(this.serial, packageName);
  }

  async clearAppCache(packageName) {
    if (!this.serial) throw new Error('Device serial is required');
    return await api.clearAppCache(this.serial, packageName);
  }

  async uninstallApp(packageName) {
    if (!this.serial) throw new Error('Device serial is required');
    return await api.uninstallApp(this.serial, packageName);
  }

  async clearLogcat() {
    if (!this.serial) throw new Error('Device serial is required');
    return await api.clearLogcat(this.serial);
  }

  async startLogcat(onLogLine) {
    // Handled via backend WebSocket test runner or logcat stream
  }

  stopLogcat() {
    // Handled via backend
  }

  async captureScreenshot() {
    if (!this.serial) throw new Error('Device serial is required');
    const res = await api.takeScreenshot(this.serial);
    return res.url ? api.getScreenshotUrl(this.serial, res.filename) : null;
  }

  async sendInput(event) {
    if (!this.serial) throw new Error('Device serial is required');
    return await api.sendDeviceInput(this.serial, event);
  }
}
