const crypto = require('crypto');
const adbService = require('./adbService');
const deviceLockService = require('./deviceLockService');
const logger = require('../utils/logger');
const { broadcastEvent } = require('../websocket/testSocket');
const { getLocalIpAddress } = require('../utils/networkUtils');

class WirelessPairingService {
  constructor() {
    this.sessions = new Map(); // sessionId -> sessionData
    this.sessionTimeoutMs = 120000; // 2 minutes QR lifespan
  }

  /**
   * Format standard Android AOSP Wireless Debugging QR payload:
   * WIFI:T:ADB;S:<service-name>;P:<pairing-code>;;
   */
  static formatQrPayload(serviceName, pairingCode) {
    return `WIFI:T:ADB;S:${serviceName};P:${pairingCode};;`;
  }

  /**
   * Generate a random 6-digit pairing code
   */
  static generatePairingCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /**
   * Generate a random service name following Android Studio convention: studio-XXXXXX
   */
  static generateServiceName() {
    const randomHex = crypto.randomBytes(3).toString('hex');
    return `studio-${randomHex}`;
  }

  /**
   * Create a new QR Pairing Session for the authenticated user
   */
  async createPairingSession(user) {
    if (!user) {
      throw new Error('User authentication required to start wireless pairing.');
    }

    // Clean up any stale sessions for this user
    for (const [id, s] of this.sessions.entries()) {
      if (s.user?.id === user.id || s.expiresAt < Date.now()) {
        this.cancelSession(id, user);
      }
    }

    const sessionId = 'wdbg_sess_' + crypto.randomBytes(6).toString('hex');
    const serviceName = WirelessPairingService.generateServiceName();
    const pairingCode = WirelessPairingService.generatePairingCode();
    const qrPayload = WirelessPairingService.formatQrPayload(serviceName, pairingCode);
    const now = Date.now();
    const expiresAt = now + this.sessionTimeoutMs;

    // Snapshot existing pairing services to detect new appearances
    const existingServices = await adbService.getMdnsServices().catch(() => []);
    const knownPairingAddresses = new Set(
      existingServices.filter(s => s.isPairing).map(s => s.address)
    );

    const sessionData = {
      sessionId,
      user: { id: user.id, username: user.username || user.name || 'User', email: user.email || '' },
      serviceName,
      pairingCode,
      qrPayload,
      status: 'NOT_PAIRED', // 'NOT_PAIRED' | 'PAIRING' | 'PAIRED' | 'CONNECTING' | 'CONNECTED' | 'PAIRING_FAILED' | 'CONNECTION_FAILED' | 'EXPIRED'
      statusMessage: 'Waiting for Android device to scan QR code...',
      createdAt: new Date(now).toISOString(),
      expiresAt,
      pairedIp: null,
      pairedPort: null,
      connectPort: null,
      device: null,
      error: null,
      knownPairingAddresses,
      watcherActive: true
    };

    this.sessions.set(sessionId, sessionData);
    logger.info(`[WirelessPairing] Created QR pairing session ${sessionId} (${serviceName}) for ${user.username || user.id}`);

    // Start asynchronous mDNS pairing watcher
    this._startWatcherLoop(sessionId);

    return {
      sessionId,
      serviceName,
      pairingCode,
      qrPayload,
      expiresAt,
      timeoutSeconds: Math.round(this.sessionTimeoutMs / 1000)
    };
  }

  /**
   * Retrieve active session state
   */
  getSession(sessionId, user) {
    if (!sessionId) return null;
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    if (user && session.user?.id !== user.id && (user.role || '').toLowerCase() !== 'admin') {
      return null;
    }

    if (session.status !== 'CONNECTED' && session.expiresAt < Date.now()) {
      session.status = 'EXPIRED';
      session.statusMessage = 'QR Pairing session expired. Please generate a new QR code.';
      session.watcherActive = false;
    }

    // Return sanitized session state (NEVER leak secrets)
    return {
      sessionId: session.sessionId,
      serviceName: session.serviceName,
      status: session.status,
      statusMessage: session.statusMessage,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      pairedIp: session.pairedIp,
      device: session.device,
      error: session.error
    };
  }

  /**
   * Cancel / clean up an active pairing session
   */
  cancelSession(sessionId, user) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.watcherActive = false;
      this.sessions.delete(sessionId);
      logger.info(`[WirelessPairing] Session ${sessionId} cancelled.`);
      return true;
    }
    return false;
  }

  /**
   * Background watcher loop that detects device QR scan via mDNS and completes pairing
   */
  async _startWatcherLoop(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const pollIntervalMs = 750;
    const startTime = Date.now();

    const watcher = async () => {
      if (!session.watcherActive || session.status === 'CONNECTED' || session.status === 'EXPIRED') {
        return;
      }

      if (Date.now() > session.expiresAt) {
        session.status = 'EXPIRED';
        session.statusMessage = 'QR Pairing session timed out. Please try again.';
        session.watcherActive = false;
        return;
      }

      try {
        const mdnsServices = await adbService.getMdnsServices();
        const pairingServices = mdnsServices.filter(s => s.isPairing);

        // Find candidate pairing service:
        // 1. Exact match with session serviceName
        // 2. OR newly appeared _adb-tls-pairing._tcp service
        let targetService = pairingServices.find(s => 
          s.serviceName.includes(session.serviceName) || s.raw.includes(session.serviceName)
        );

        if (!targetService) {
          targetService = pairingServices.find(s => !session.knownPairingAddresses.has(s.address));
        }

        if (targetService && session.status === 'NOT_PAIRED') {
          session.status = 'PAIRING';
          session.statusMessage = `Detected pairing service at ${targetService.address}. Establishing TLS SPAKE2 handshake...`;
          session.pairedIp = targetService.ip;
          session.pairedPort = targetService.port;
          logger.info(`[WirelessPairing] Pairing with ${targetService.address} using code ${session.pairingCode}...`);

          try {
            const pairResult = await adbService.pairDevice(targetService.ip, targetService.port, session.pairingCode);
            session.status = 'PAIRED';
            session.statusMessage = `Pairing successful! Discovering ADB TLS connection service...`;
            logger.info(`[WirelessPairing] Successfully paired with ${targetService.address}`);

            // Step 2: Discover _adb-tls-connect._tcp and connect
            await this._resolveAndConnect(session, targetService.ip);
            return;
          } catch (pairErr) {
            session.status = 'PAIRING_FAILED';
            session.statusMessage = `Pairing failed: ${pairErr.message}`;
            session.error = pairErr.message;
            session.watcherActive = false;
            logger.error(`[WirelessPairing] Pairing failed: ${pairErr.message}`);
            return;
          }
        }
      } catch (err) {
        logger.debug(`[WirelessPairing Watcher] Poll error: ${err.message}`);
      }

      if (session.watcherActive) {
        setTimeout(watcher, pollIntervalMs);
      }
    };

    setTimeout(watcher, 500);
  }

  /**
   * Resolve _adb-tls-connect._tcp and establish the final ADB TLS connection
   */
  async _resolveAndConnect(session, targetIp) {
    session.status = 'CONNECTING';
    session.statusMessage = `Connecting to Android device at ${targetIp}...`;

    const maxWaitMs = 15000;
    const startConnect = Date.now();

    while (Date.now() - startConnect < maxWaitMs && session.watcherActive) {
      try {
        const mdnsServices = await adbService.getMdnsServices();
        const connectServices = mdnsServices.filter(s => s.isConnect);

        // Find matching connect service by IP or recently updated
        const connectService = connectServices.find(s => s.ip === targetIp) || (connectServices.length > 0 ? connectServices[0] : null);

        if (connectService) {
          session.connectPort = connectService.port;
          logger.info(`[WirelessPairing] Found connect service at ${connectService.address}. Executing adb connect...`);

          const connectResult = await adbService.connectDevice(connectService.ip, connectService.port);
          if (connectResult.success) {
            const serial = connectResult.serial || `${connectService.ip}:${connectService.port}`;
            const hwSerial = connectResult.device?.hardwareSerial || null;

            // Assign connection ownership for browser-wireless device
            if (hwSerial) {
              deviceLockService.registerHardwareSerial(serial, hwSerial);
            }
            deviceLockService.setOwner(serial, session.user);

            const deviceInfo = {
              ...(connectResult.device || {}),
              serial,
              hardwareSerial: hwSerial,
              ip: connectService.ip,
              port: connectService.port,
              connectionMode: 'browser-wireless',
              connected: true,
              isWireless: true
            };

            session.status = 'CONNECTED';
            session.statusMessage = `Successfully connected to ${deviceInfo.model || 'Android Device'} (${serial})!`;
            session.device = deviceInfo;
            session.watcherActive = false;

            logger.info(`[WirelessPairing] Successfully established browser-wireless connection to ${serial} for ${session.user.username}`);
            broadcastEvent('DEVICES_UPDATED');
            return;
          }
        }
      } catch (e) {
        logger.debug(`[WirelessPairing] Connect poll iteration: ${e.message}`);
      }

      await new Promise(r => setTimeout(r, 1000));
    }

    // Fallback: If mDNS connect service not advertised, report prompt for connection port
    session.status = 'PAIRED';
    session.statusMessage = `Device paired successfully, but ADB connection port was not auto-discovered. Please enter connection port to finish.`;
  }

  /**
   * Fallback: Manual pairing using 6-digit code
   */
  async pairWithCode(user, ip, pairPort, pairCode) {
    if (!ip || !pairPort || !pairCode) {
      throw new Error('Device IP, Pairing Port, and 6-Digit Pairing Code are required.');
    }

    const pairResult = await adbService.pairDevice(ip.trim(), pairPort.trim(), pairCode.trim());
    if (user) {
      deviceLockService.setOwner(`${ip}:${pairPort}`, user);
    }
    return pairResult;
  }

  /**
   * Connect an already paired wireless device
   */
  async connectDevice(user, ip, connectPort, options = {}) {
    if (!ip || !connectPort) {
      throw new Error('Device IP and Connection Port are required.');
    }

    const connectResult = await adbService.connectDevice(ip.trim(), connectPort.trim());
    if (connectResult.success && user) {
      const serial = connectResult.serial || `${ip}:${connectPort}`;
      const hwSerial = connectResult.device?.hardwareSerial || null;
      const connectionMode = options.connectionMode || 'browser-wireless';
      if (hwSerial) {
        deviceLockService.registerHardwareSerial(serial, hwSerial);
      }
      deviceLockService.setOwner(serial, user);

      broadcastEvent('DEVICES_UPDATED');
    }
    return connectResult;
  }

  /**
   * List all discovered wireless connection services (_adb-tls-connect._tcp)
   */
  async getDiscoveredWirelessDevices() {
    try {
      const mdnsServices = await adbService.getMdnsServices();
      return mdnsServices.filter(s => s.isConnect).map(s => ({
        serviceName: s.serviceName,
        ip: s.ip,
        port: s.port,
        address: s.address
      }));
    } catch (err) {
      return [];
    }
  }

  /**
   * Comprehensive Diagnostics for Wireless Debugging
   */
  async getDiagnostics() {
    const mdnsCheck = await adbService.checkMdns();
    const mdnsServices = await adbService.getMdnsServices();
    const localIp = getLocalIpAddress();

    return {
      localIp,
      mdnsAvailable: mdnsCheck.available,
      mdnsDaemonOutput: mdnsCheck.output,
      pairingServicesCount: mdnsServices.filter(s => s.isPairing).length,
      connectServicesCount: mdnsServices.filter(s => s.isConnect).length,
      discoveredServices: mdnsServices.map(s => ({
        serviceName: s.serviceName,
        serviceType: s.serviceType,
        address: s.address,
        isPairing: s.isPairing,
        isConnect: s.isConnect
      })),
      activeSessionsCount: this.sessions.size,
      serverTime: new Date().toISOString()
    };
  }
}

module.exports = new WirelessPairingService();
