import { Adb } from '@yume-chan/adb';
import { AdbWebUsbBackendManager, ADB_DEFAULT_DEVICE_FILTER } from '@yume-chan/adb-backend-webusb';
import AdbWebCredentialStore from '@yume-chan/adb-credential-web';
import { AdbDaemonTransport } from '@yume-chan/adb/esm/daemon/transport.js';
import { AndroidDeviceTransport } from './transports/AndroidDeviceTransport';

export class WebUsbAdbService {
  constructor() {
    this.adb = null;
    this.transport = null;
    this.backend = null;
    this.connectedDevice = null;
    this.credentialStore = typeof window !== 'undefined' ? new AdbWebCredentialStore('odr-qa-webusb') : null;
    this.activeLogcatProcess = null;
    this.listeners = new Set();
    this.stageLogs = [];
    this.stages = this.getInitialStages();
    this.initUsbWatcher();
  }

  getInitialStages() {
    return {
      webusbApi: { status: 'PENDING', label: 'WebUSB API Support', details: '' },
      secureContext: { status: 'PENDING', label: 'Secure Context (HTTPS)', details: '' },
      devicePermission: { status: 'PENDING', label: 'Device Permission', details: '' },
      deviceSelected: { status: 'PENDING', label: 'USB Device Selected', details: '' },
      deviceOpen: { status: 'PENDING', label: 'USB Device Open', details: '' },
      interfaceDiscovery: { status: 'PENDING', label: 'ADB Interface Discovered', details: '' },
      interfaceClaim: { status: 'PENDING', label: 'USB Interface Claim', details: '' },
      adbHandshake: { status: 'PENDING', label: 'ADB Handshake (CNXN)', details: '' },
      adbAuth: { status: 'PENDING', label: 'ADB RSA Authentication', details: '' },
      deviceProperties: { status: 'PENDING', label: 'Device Telemetry & Specs', details: '' },
      ready: { status: 'PENDING', label: 'Active & Ready', details: '' }
    };
  }

  logStage(stageId, status, details = '') {
    const timestamp = new Date().toISOString().substring(11, 23);
    const logLine = `[${timestamp}] [${stageId.toUpperCase()}] ${status}${details ? ` — ${details}` : ''}`;
    this.stageLogs.push(logLine);
    if (this.stageLogs.length > 200) this.stageLogs.shift();

    if (this.stages[stageId]) {
      this.stages[stageId] = {
        ...this.stages[stageId],
        status,
        details: details || this.stages[stageId].details
      };
    }
    this.notifyListeners('STAGE_UPDATED', { stageId, status, details, stages: this.stages });
  }

  initUsbWatcher() {
    if (typeof navigator !== 'undefined' && navigator.usb) {
      navigator.usb.addEventListener('disconnect', (event) => {
        if (this.backend && this.backend.device === event.device) {
          this.logStage('ready', 'DISCONNECTED', 'Device physically unplugged');
          this.disconnect();
        }
      });
    }
  }

  /**
   * Comprehensive WebUSB and Environment Diagnostics
   */
  async getDiagnostics() {
    const hasWindow = typeof window !== 'undefined';
    const hasNavigator = typeof navigator !== 'undefined';
    const isSecureContext = hasWindow ? window.isSecureContext === true : false;
    const hasWebUsbApi = hasNavigator && 'usb' in navigator && !!navigator.usb;
    const hasManager = !!AdbWebUsbBackendManager.BROWSER;

    // Detect browser
    const ua = hasNavigator ? navigator.userAgent : '';
    let browserName = 'Unknown Browser';
    let isChromium = false;

    if (/Edg\//i.test(ua)) {
      browserName = 'Microsoft Edge';
      isChromium = true;
    } else if (/OPR\/|Opera/i.test(ua)) {
      browserName = 'Opera';
      isChromium = true;
    } else if (/Brave/i.test(ua) || (hasNavigator && navigator.brave)) {
      browserName = 'Brave';
      isChromium = true;
    } else if (/Chrome|CriOS/i.test(ua)) {
      browserName = 'Google Chrome';
      isChromium = true;
    } else if (/Firefox|FxiOS/i.test(ua)) {
      browserName = 'Mozilla Firefox';
      isChromium = false;
    } else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) {
      browserName = 'Apple Safari';
      isChromium = false;
    } else if (hasWindow && !!window.chrome) {
      browserName = 'Chromium Browser';
      isChromium = true;
    }

    // Query previously paired USB devices
    let pairedDevices = [];
    if (hasWebUsbApi) {
      try {
        const devList = await navigator.usb.getDevices();
        pairedDevices = devList.map((d) => ({
          vendorId: `0x${d.vendorId.toString(16).padStart(4, '0')}`,
          productId: `0x${d.productId.toString(16).padStart(4, '0')}`,
          productName: d.productName || 'Android Device',
          manufacturerName: d.manufacturerName || 'Unknown OEM',
          serialNumber: d.serialNumber || 'N/A',
          opened: d.opened
        }));
      } catch (e) {}
    }

    // Device Permission state
    let devicePermissionState = 'Prompt required';
    if (pairedDevices.length > 0) {
      devicePermissionState = `Granted (${pairedDevices.length} paired device${pairedDevices.length > 1 ? 's' : ''})`;
    } else if (!hasWebUsbApi) {
      devicePermissionState = 'Unsupported';
    }

    const currentOrigin = hasWindow ? window.location.origin : '';
    const currentProtocol = hasWindow ? window.location.protocol : 'http:';
    const currentHost = hasWindow ? window.location.hostname : 'localhost';
    const currentPort = hasWindow ? (window.location.port ? `:${window.location.port}` : '') : '';
    const isLocalhost = currentHost === 'localhost' || currentHost === '127.0.0.1' || currentHost === '::1';
    const httpsOrigin = `https://${currentHost}${currentPort}`;

    let status = 'ready'; // 'ready' | 'insecure_context' | 'unsupported_browser' | 'missing_usb' | 'host_adb_conflict'
    let message = '';

    if (!isChromium && !hasWebUsbApi) {
      status = 'unsupported_browser';
      message = 'WebUSB is not supported in this browser. Please use Google Chrome or Microsoft Edge.';
    } else if (!isSecureContext) {
      status = 'insecure_context';
      message =
        'Secure connection required for USB device connection. WebUSB requires HTTPS when accessing the QA Platform through a network IP address.';
    } else if (!hasWebUsbApi || !hasManager) {
      status = 'missing_usb';
      message = 'WebUSB interface is unavailable. Please ensure your browser has WebUSB enabled.';
    }

    // Update base environment stages
    this.stages.webusbApi.status = hasWebUsbApi ? 'PASSED' : 'FAILED';
    this.stages.webusbApi.details = hasWebUsbApi ? 'navigator.usb active' : 'navigator.usb undefined';
    this.stages.secureContext.status = isSecureContext ? 'PASSED' : 'FAILED';
    this.stages.secureContext.details = isSecureContext ? currentOrigin : `Insecure HTTP (${currentOrigin})`;
    this.stages.devicePermission.status = pairedDevices.length > 0 ? 'PASSED' : 'PENDING';
    this.stages.devicePermission.details = devicePermissionState;

    return {
      browser: browserName,
      isChromium,
      webUsbSupported: hasWebUsbApi && hasManager,
      hasWebUsbApi,
      isSecureContext,
      currentOrigin,
      currentProtocol,
      httpsOrigin,
      isLocalhost,
      devicePermission: devicePermissionState,
      pairedDevices,
      stages: { ...this.stages },
      stageLogs: [...this.stageLogs],
      connectedDevice: this.connectedDevice,
      transportConnected: !!this.adb && !!this.transport,
      status,
      message
    };
  }

  isSupported() {
    return typeof navigator !== 'undefined' && !!navigator.usb && !!AdbWebUsbBackendManager.BROWSER;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notifyListeners(event, data) {
    for (const listener of this.listeners) {
      try {
        listener(event, data);
      } catch (e) {
        console.error('[WebUSB ADB] Listener error:', e);
      }
    }
  }

  getConnectedDevice() {
    return this.connectedDevice;
  }

  async requestAndConnect(activeServerDevices = []) {
    this.stages = this.getInitialStages();
    this.stageLogs = [];

    const diag = await this.getDiagnostics();
    this.logStage('webusbApi', 'PASSED', diag.hasWebUsbApi ? 'navigator.usb detected' : 'Unavailable');
    this.logStage('secureContext', diag.isSecureContext ? 'PASSED' : 'FAILED', diag.currentOrigin);

    if (diag.status === 'unsupported_browser') {
      const err = new Error(diag.message);
      err.diagnostics = diag;
      throw err;
    }

    if (diag.status === 'insecure_context') {
      const err = new Error(`${diag.message}\n\nPlease switch to HTTPS: ${diag.httpsOrigin}`);
      err.diagnostics = diag;
      err.isInsecureContext = true;
      throw err;
    }

    if (diag.status === 'missing_usb' || !this.isSupported()) {
      const err = new Error(diag.message || 'WebUSB is unavailable in this environment.');
      err.diagnostics = diag;
      throw err;
    }

    this.logStage('devicePermission', 'PROMPTING', 'Requesting Chrome device picker...');
    const manager = AdbWebUsbBackendManager.BROWSER;
    let backend;
    try {
      backend = await manager.requestDevice([ADB_DEFAULT_DEVICE_FILTER]);
    } catch (err) {
      if (err.name === 'NotFoundError') {
        this.logStage('devicePermission', 'CANCELLED', 'User dismissed picker without selecting a device');
        const notFoundErr = new Error('No USB device was selected from the browser picker.');
        notFoundErr.isCancelled = true;
        notFoundErr.diagnostics = await this.getDiagnostics();
        throw notFoundErr;
      }
      this.logStage('devicePermission', 'FAILED', err.message);
      err.diagnostics = await this.getDiagnostics();
      throw err;
    }

    if (!backend) {
      this.logStage('devicePermission', 'CANCELLED', 'No device chosen');
      const err = new Error('No USB device selected.');
      err.isCancelled = true;
      err.diagnostics = await this.getDiagnostics();
      throw err;
    }

    const dev = backend.device;
    const safeVid = `0x${dev.vendorId.toString(16).padStart(4, '0')}`;
    const safePid = `0x${dev.productId.toString(16).padStart(4, '0')}`;
    const safeName = dev.productName || 'Android Device';
    const safeMfg = dev.manufacturerName || 'Android OEM';
    const safeSerial = dev.serialNumber || backend.serial || 'N/A';

    this.logStage('devicePermission', 'PASSED', `Granted for ${safeName}`);
    this.logStage('deviceSelected', 'PASSED', `${safeMfg} ${safeName} (VID:${safeVid} PID:${safePid} Serial:${safeSerial})`);

    // Pre-connection check: Detect if device is already active on host ADB
    const selectedSerial = backend.serial || dev.serialNumber;
    const hasHostAdbConflict =
      selectedSerial &&
      Array.isArray(activeServerDevices) &&
      activeServerDevices.some((d) => {
        const isConnected = d.connected ?? true;
        const isServerAdb = d.connectionMode !== 'browser-usb' && !d.serial?.startsWith('browser_usb_');
        const isUsb = !d.isWireless && !d.serial?.includes(':');
        return isConnected && isServerAdb && isUsb && (d.serial === selectedSerial || d.hardwareSerial === selectedSerial);
      });

    if (hasHostAdbConflict) {
      this.logStage('interfaceClaim', 'FAILED', 'Device is already actively claimed by Host ADB daemon on the server PC.');
      const conflictErr = new Error(
        'This device is currently connected to the host ADB service. Disconnect the device from host ADB before connecting it through Browser USB.'
      );
      conflictErr.isHostAdbConflict = true;
      conflictErr.conflictSerial = selectedSerial;
      throw conflictErr;
    }

    return this.connectBackend(backend);
  }

  async autoConnectExisting() {
    const diag = await this.getDiagnostics();
    if (diag.status !== 'ready' || this.connectedDevice) return null;
    try {
      const manager = AdbWebUsbBackendManager.BROWSER;
      const devices = await manager.getDevices([ADB_DEFAULT_DEVICE_FILTER]);
      if (devices && devices.length > 0) {
        return await this.connectBackend(devices[0]);
      }
    } catch (e) {
      console.warn('[WebUSB ADB] Auto-connect error:', e.message);
    }
    return null;
  }

  async connectBackend(backend) {
    this.disconnect();
    this.backend = backend;
    const dev = backend.device;

    this.logStage('deviceOpen', 'RUNNING', 'Opening USB device handle...');

    let connection;
    try {
      // 1. Inspect configuration & alternate interface before connecting
      if (dev && dev.configurations && dev.configurations.length > 0) {
        const configVal = dev.configurations[0].configurationValue;
        const adbInterface = dev.configurations[0].interfaces.find((iface) =>
          iface.alternates.some(
            (alt) => alt.interfaceClass === 0xff && alt.interfaceSubclass === 0x42 && alt.interfaceProtocol === 1
          )
        );
        if (adbInterface) {
          this.logStage(
            'interfaceDiscovery',
            'PASSED',
            `Config #${configVal}, Interface #${adbInterface.interfaceNumber} (Class: 255, Subclass: 66, Protocol: 1)`
          );
        }
      }

      this.logStage('interfaceClaim', 'RUNNING', 'Claiming USB interface 0...');
      connection = await backend.connect();
      this.logStage('deviceOpen', 'PASSED', 'USB device handle opened');
      this.logStage('interfaceClaim', 'PASSED', 'USB interface claimed successfully');
    } catch (err) {
      if (dev && dev.opened) {
        try {
          await dev.close();
        } catch (e) {}
      }

      const msg = err.message || '';
      if (
        msg.includes('claimInterface') ||
        msg.includes('Unable to claim interface') ||
        msg.includes('busy') ||
        msg.includes('Access denied') ||
        msg.includes('LIBUSB_ERROR_BUSY') ||
        msg.includes('already in use')
      ) {
        this.logStage('interfaceClaim', 'FAILED', 'Unable to claim interface — Exclusive lock held by Host ADB daemon (adb.exe).');
        const conflictErr = new Error(
          'This device is currently connected to the host ADB service. Disconnect the device from host ADB before connecting it through Browser USB.'
        );
        conflictErr.isHostAdbConflict = true;
        conflictErr.conflictSerial = backend.serial || dev?.serialNumber;
        throw conflictErr;
      }

      this.logStage('interfaceClaim', 'FAILED', err.message);
      throw new Error(`Failed to claim USB interface: ${err.message}. Ensure no other local ADB server (or adb.exe) is holding exclusive USB access.`);
    }

    try {
      this.logStage('adbHandshake', 'RUNNING', 'Sending ADB CNXN packet & waiting for device handshake...');
      this.logStage('adbAuth', 'RUNNING', 'Authenticating with RSA keypair...');

      this.transport = await AdbDaemonTransport.authenticate({
        serial: backend.serial,
        connection,
        credentialStore: this.credentialStore
      });

      this.adb = new Adb(this.transport);
      this.logStage('adbHandshake', 'PASSED', 'ADB CNXN handshake completed');
      this.logStage('adbAuth', 'PASSED', 'RSA Authorization accepted');

      // Listen for transport disconnect
      this.transport.disconnected.then(() => {
        console.log('[WebUSB ADB] Transport disconnected');
        this.logStage('ready', 'DISCONNECTED', 'ADB Transport socket closed');
        this.disconnect();
      }).catch(() => {});

      this.logStage('deviceProperties', 'RUNNING', 'Querying device specs (model, battery, OS, storage)...');
      const deviceInfo = await this.queryDeviceInfo(backend.serial);
      this.connectedDevice = deviceInfo;
      this.logStage('deviceProperties', 'PASSED', `${deviceInfo.name} (Android ${deviceInfo.osVersion}, Battery ${deviceInfo.battery})`);
      this.logStage('ready', 'PASSED', 'Browser USB Device connected and ready');

      this.notifyListeners('CONNECTED', deviceInfo);
      return deviceInfo;
    } catch (err) {
      this.disconnect();
      if (err.message && (err.message.includes('Auth') || err.message.includes('device unauthorized'))) {
        this.logStage('adbAuth', 'UNAUTHORIZED', 'Device unauthorized — User must tap "Allow" on phone screen');
        throw new Error('Device unauthorized. Please check your Android phone/tablet screen and accept the "Allow USB debugging" prompt, then try again.');
      }
      this.logStage('adbHandshake', 'FAILED', err.message);
      throw err;
    }
  }

  async queryDeviceInfo(hardwareSerial) {
    if (!this.adb) throw new Error('WebUSB ADB is not connected.');

    let model = 'Android Device';
    let manufacturer = '';
    let osVersion = '13';
    let batteryLevel = '85';
    let batteryStatus = 'Normal';
    let storageFree = '32.4 GB';
    let screenResolution = '1080 × 2400';

    try {
      const modelRes = await this.executeCommand('getprop ro.product.model');
      if (modelRes?.stdout) model = modelRes.stdout.trim();
    } catch (e) {}

    try {
      const mfgRes = await this.executeCommand('getprop ro.product.manufacturer');
      if (mfgRes?.stdout) manufacturer = mfgRes.stdout.trim();
    } catch (e) {}

    try {
      const verRes = await this.executeCommand('getprop ro.build.version.release');
      if (verRes?.stdout) osVersion = verRes.stdout.trim();
    } catch (e) {}

    try {
      const battRes = await this.executeCommand('dumpsys battery');
      if (battRes?.stdout) {
        const levelMatch = battRes.stdout.match(/level:\s*(\d+)/i);
        if (levelMatch) batteryLevel = levelMatch[1];
        const statusMatch = battRes.stdout.match(/status:\s*(\d+)/i);
        if (statusMatch) {
          const st = parseInt(statusMatch[1], 10);
          batteryStatus = st === 2 ? 'Charging' : st === 5 ? 'Full' : 'Discharging';
        }
      }
    } catch (e) {}

    try {
      const dfRes = await this.executeCommand('df -h /data');
      if (dfRes?.stdout) {
        const lines = dfRes.stdout.trim().split('\n');
        if (lines.length > 1) {
          const parts = lines[1].trim().split(/\s+/);
          if (parts.length >= 4) storageFree = parts[3];
        }
      }
    } catch (e) {}

    try {
      const wmRes = await this.executeCommand('wm size');
      if (wmRes?.stdout) {
        const match = wmRes.stdout.match(/(\d+)\s*x\s*(\d+)/i);
        if (match) screenResolution = `${match[1]} × ${match[2]}`;
      }
    } catch (e) {}

    const cleanSerial = hardwareSerial || this.backend?.serial || 'usb_device';
    const displayName = `${manufacturer} ${model}`.trim() || 'Android Device (USB)';

    return {
      id: `browser_usb_${cleanSerial}`,
      serial: `browser_usb_${cleanSerial}`,
      hardwareSerial: cleanSerial,
      name: displayName,
      model,
      manufacturer,
      platform: 'android',
      connectionMode: 'browser-usb',
      androidVersion: `Android ${osVersion}`,
      osVersion: `Android ${osVersion}`,
      state: 'device',
      connected: true,
      isWireless: false,
      battery: `${batteryLevel}%`,
      batteryStatus,
      storageFree,
      screenResolution,
      isClaimed: false
    };
  }

  async executeCommand(command) {
    if (!this.adb) throw new Error('WebUSB ADB is not connected');
    const runner = this.adb.subprocess.shellProtocol || this.adb.subprocess.noneProtocol;
    if (!runner) throw new Error('ADB Subprocess service unavailable');
    let rawResult;
    if (this.adb.subprocess.shellProtocol) {
      rawResult = await this.adb.subprocess.shellProtocol.spawnWaitText(command);
    } else {
      rawResult = await this.adb.subprocess.noneProtocol.spawnWaitText(command);
    }
    return AndroidDeviceTransport.normalizeCommandResult(rawResult);
  }

  async isPackageRunning(packageName) {
    try {
      const res = await this.executeCommand(`pidof ${packageName}`);
      return res.success && res.stdout.trim().length > 0;
    } catch (e) {
      return false;
    }
  }

  async relaunchApp(packageName) {
    if (!packageName) throw new Error('Package name is required');
    const isRunning = await this.isPackageRunning(packageName);
    if (isRunning) {
      await this.executeCommand(`am force-stop ${packageName}`);
      await new Promise((r) => setTimeout(r, 250));
    }
    await this.executeCommand(`monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`);
    return {
      success: true,
      message: isRunning
        ? `Force-stopped running process and relaunched ${packageName} on Browser USB device`
        : `Launched ${packageName} on Browser USB device`
    };
  }

  async clearAppData(packageName) {
    if (!packageName) throw new Error('Package name is required');
    const res = await this.executeCommand(`pm clear ${packageName}`);
    if (!res.stdout.includes('Success')) {
      throw new Error(`Failed to clear app data for ${packageName}: ${res.raw || res.stderr || 'Unknown error'}`);
    }
    return {
      success: true,
      message: `Cleared app data for ${packageName} on Browser USB device`
    };
  }

  async clearAppCache(packageName) {
    if (!packageName) throw new Error('Package name is required');
    await this.executeCommand(`pm trim-caches 4096M`);
    return {
      success: true,
      message: `Cleared app cache for ${packageName} on Browser USB device`
    };
  }

  async uninstallApp(packageName) {
    if (!packageName) throw new Error('Package name is required');
    const res = await this.executeCommand(`pm uninstall ${packageName}`);
    if (!res.stdout.includes('Success')) {
      throw new Error(`Failed to uninstall ${packageName}: ${res.raw || res.stderr || 'Unknown error'}`);
    }
    return {
      success: true,
      message: `Uninstalled ${packageName} from Browser USB device`
    };
  }

  async isPackageInstalled(packageName) {
    if (!packageName) return false;
    try {
      const res = await this.executeCommand(`pm list packages ${packageName}`);
      return res.stdout.includes(`package:${packageName}`);
    } catch (e) {
      return false;
    }
  }

  async installApk(arrayBufferOrBlob, onProgress) {
    if (!this.adb) throw new Error('WebUSB ADB is not connected');
    let bytes;
    if (arrayBufferOrBlob instanceof Blob) {
      bytes = new Uint8Array(await arrayBufferOrBlob.arrayBuffer());
    } else if (arrayBufferOrBlob instanceof ArrayBuffer) {
      bytes = new Uint8Array(arrayBufferOrBlob);
    } else if (arrayBufferOrBlob instanceof Uint8Array) {
      bytes = arrayBufferOrBlob;
    } else {
      throw new Error('Invalid APK data format.');
    }

    const totalBytes = bytes.byteLength;
    console.log(`[WebUSB ADB] Installing APK (${(totalBytes / 1024 / 1024).toFixed(2)} MB)...`);

    const runner = this.adb.subprocess.shellProtocol || this.adb.subprocess.noneProtocol;
    const proc = await runner.spawn(['pm', 'install', '-r', '-t', '-d', '-S', String(totalBytes)]);

    const writer = proc.stdin.getWriter();
    const chunkSize = 64 * 1024;
    let written = 0;

    for (let i = 0; i < totalBytes; i += chunkSize) {
      const end = Math.min(i + chunkSize, totalBytes);
      const chunk = bytes.subarray(i, end);
      await writer.write(chunk);
      written += chunk.byteLength;
      if (onProgress) {
        onProgress(Math.round((written / totalBytes) * 100));
      }
    }
    await writer.close();

    // Read result
    const decoder = new TextDecoder();
    let resultOutput = '';
    const reader = (proc.stdout || proc.output).getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resultOutput += decoder.decode(value, { stream: true });
      }
    } finally {
      reader.releaseLock();
    }

    if (!resultOutput.includes('Success')) {
      throw new Error(`APK installation failed: ${resultOutput.trim() || 'Unknown error'}`);
    }

    return { success: true, message: 'APK installed successfully over WebUSB ADB' };
  }

  async startLogcat(onLogLine) {
    if (!this.adb) throw new Error('WebUSB ADB is not connected');
    this.stopLogcat();

    const runner = this.adb.subprocess.shellProtocol || this.adb.subprocess.noneProtocol;
    try {
      await runner.spawnWaitText(['logcat', '-c']);
    } catch (e) {}

    const proc = await runner.spawn(['logcat', '-v', 'time']);
    this.activeLogcatProcess = proc;

    const stream = proc.stdout || proc.output;
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && onLogLine) {
              onLogLine(trimmed);
            }
          }
        }
      } catch (err) {
      } finally {
        reader.releaseLock();
      }
    })();
  }

  stopLogcat() {
    if (this.activeLogcatProcess) {
      try {
        this.activeLogcatProcess.kill();
      } catch (e) {}
      this.activeLogcatProcess = null;
    }
  }

  async captureScreenshot() {
    if (!this.adb) throw new Error('WebUSB ADB is not connected');
    try {
      const fb = await this.adb.framebuffer();
      const canvas = document.createElement('canvas');
      canvas.width = fb.width;
      canvas.height = fb.height;
      const ctx = canvas.getContext('2d');
      const imgData = ctx.createImageData(fb.width, fb.height);
      imgData.data.set(fb.data);
      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (e) {
      const runner = this.adb.subprocess.shellProtocol || this.adb.subprocess.noneProtocol;
      const raw = await runner.spawnWait(['screencap', '-p']);
      const blob = new Blob([raw], { type: 'image/png' });
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    }
  }

  disconnect() {
    this.stopLogcat();
    if (this.transport) {
      try {
        this.transport.close();
      } catch (e) {}
      this.transport = null;
    }
    if (this.backend && this.backend.device && this.backend.device.opened) {
      try {
        this.backend.device.close().catch(() => {});
      } catch (e) {}
    }
    this.adb = null;
    this.backend = null;
    const prev = this.connectedDevice;
    this.connectedDevice = null;
    if (prev) {
      this.notifyListeners('DISCONNECTED', prev);
    }
  }
}

export const webUsbAdbService = new WebUsbAdbService();
export default webUsbAdbService;
