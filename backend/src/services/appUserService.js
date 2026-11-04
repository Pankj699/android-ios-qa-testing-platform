const https = require('https');
const http = require('http');
const { URL } = require('url');
const config = require('../config');
const logger = require('../utils/logger');
const adbService = require('./adbService');
const iosService = require('./iosService');
const deviceLockService = require('./deviceLockService');

class AppUserService {
  constructor() {
    this.defaultAppId = 2;
    this.primaryPackage = 'com.bg.flyermaker';
    this.fallbackPackage = 'com.nra.flyermaker';
  }

  /**
   * Identify the installed Flyer Maker package on the target device
   */
  async resolveInstalledPackage(serial) {
    if (!serial || iosService.isIosDevice(serial)) {
      return null;
    }

    try {
      const res = await adbService.getInstalledApps(serial);
      const packages = res.packages || [];
      const found = packages.find(p => p.packageName === this.primaryPackage) ||
                    packages.find(p => p.packageName === this.fallbackPackage) ||
                    packages.find(p => p.packageName && p.packageName.toLowerCase().includes('flyermaker'));
      return found ? found.packageName : this.primaryPackage;
    } catch (err) {
      logger.debug(`[AppUserService] Could not list packages on ${serial}: ${err.message}. Defaulting to ${this.primaryPackage}`);
      return this.primaryPackage;
    }
  }

  /**
   * Extract user_id, device_uuid, and app_id from the selected primary device
   */
  async getAppUser(serial) {
    if (!serial) {
      return {
        available: false,
        reason: 'No device serial provided.',
        appId: this.defaultAppId,
        serial: null
      };
    }

    if (iosService.isIosDevice(serial)) {
      return {
        available: false,
        reason: 'Target device is iOS. App user extraction currently supports Android primary devices.',
        appId: this.defaultAppId,
        serial
      };
    }

    const packageName = await this.resolveInstalledPackage(serial);

    try {
      // 1. Read main shared_prefs XML for user_id and app_id
      const mainPrefsCmd = await adbService.execute([
        '-s', serial, 'shell',
        `run-as ${packageName} cat shared_prefs/${packageName}.xml 2>/dev/null`
      ]);

      const mainPrefsXml = mainPrefsCmd.stdout || '';

      // Extract user_id
      let userId = null;
      const userIdIntMatch = mainPrefsXml.match(/<int\s+name=["']onboarding_user_id["']\s+value=["'](\d+)["']/i);
      const userIdStringMatch = mainPrefsXml.match(/<string\s+name=["']onboarding_user_id["']>(\d+)<\/string>/i);
      if (userIdIntMatch) {
        userId = parseInt(userIdIntMatch[1], 10);
      } else if (userIdStringMatch) {
        userId = parseInt(userIdStringMatch[1], 10);
      }

      // Extract app_id (defaults to 2)
      let appId = this.defaultAppId;
      const appIdIntMatch = mainPrefsXml.match(/<int\s+name=["']onbaording_app_id["']\s+value=["'](\d+)["']/i);
      const appIdStringMatch = mainPrefsXml.match(/<string\s+name=["']onbaording_app_id["']>(\d+)<\/string>/i);
      if (appIdIntMatch) {
        appId = parseInt(appIdIntMatch[1], 10);
      } else if (appIdStringMatch) {
        appId = parseInt(appIdStringMatch[1], 10);
      }

      // 2. Extract authoritative device_uuid
      let deviceUuid = null;

      // Check Mixpanel XML in shared_prefs
      try {
        const lsPrefsCmd = await adbService.execute([
          '-s', serial, 'shell',
          `run-as ${packageName} ls shared_prefs 2>/dev/null`
        ]);
        const files = (lsPrefsCmd.stdout || '').split('\n').map(f => f.trim()).filter(Boolean);
        const mpFile = files.find(f => f.startsWith('com.mixpanel.android.mpmetrics.MixpanelAPI_') && f.endsWith('.xml'));

        if (mpFile) {
          const mpContentCmd = await adbService.execute([
            '-s', serial, 'shell',
            `run-as ${packageName} cat shared_prefs/${mpFile} 2>/dev/null`
          ]);
          const mpXml = mpContentCmd.stdout || '';
          const eventsDistinctMatch = mpXml.match(/<string\s+name=["']events_distinct_id["']>([^<]+)<\/string>/i);
          const peopleDistinctMatch = mpXml.match(/<string\s+name=["']people_distinct_id["']>([^<]+)<\/string>/i);

          if (eventsDistinctMatch && eventsDistinctMatch[1].trim()) {
            deviceUuid = eventsDistinctMatch[1].trim();
          } else if (peopleDistinctMatch && peopleDistinctMatch[1].trim()) {
            deviceUuid = peopleDistinctMatch[1].trim();
          }
        }
      } catch (mpErr) {
        logger.debug(`[AppUserService] Mixpanel XML check failed: ${mpErr.message}`);
      }

      // Fallback: Check Crashlytics userlog where the app logs {"device_uuid":"..."}
      if (!deviceUuid) {
        try {
          const userlogCmd = await adbService.execute([
            '-s', serial, 'shell',
            `run-as ${packageName} sh -c "strings files/.crashlytics.v3/${packageName}/open-sessions/*/userlog 2>/dev/null | grep -o '\"device_uuid\":\"[^\"]*\"' | head -n 1"`
          ]);
          const match = (userlogCmd.stdout || '').match(/"device_uuid":"([^"]+)"/);
          if (match && match[1].trim()) {
            deviceUuid = match[1].trim();
          }
        } catch (logErr) {
          logger.debug(`[AppUserService] Crashlytics userlog check failed: ${logErr.message}`);
        }
      }

      // Fallback: Check Android ID
      if (!deviceUuid) {
        try {
          const androidIdCmd = await adbService.execute([
            '-s', serial, 'shell', 'settings get secure android_id'
          ]);
          const aid = (androidIdCmd.stdout || '').trim();
          if (aid && aid !== 'null' && !aid.includes(' ') && aid.length >= 8) {
            deviceUuid = aid;
          }
        } catch (aidErr) {
          logger.debug(`[AppUserService] Android ID lookup failed: ${aidErr.message}`);
        }
      }

      const available = Boolean(userId && deviceUuid && appId);

      return {
        available,
        userId: userId || null,
        appId: appId || this.defaultAppId,
        deviceUuid: deviceUuid || null,
        packageName,
        serial,
        reason: available ? null : 'Could not extract all active app identifiers. Ensure Flyer Maker is installed and opened at least once on this device.'
      };
    } catch (err) {
      logger.error(`[AppUserService] Error extracting app user from ${serial}: ${err.message}`);
      return {
        available: false,
        reason: `Failed to read app user identifiers from device: ${err.message}`,
        userId: null,
        appId: this.defaultAppId,
        deviceUuid: null,
        packageName,
        serial
      };
    }
  }

  /**
   * Call flyerbuilder removeCredits endpoint with validated inputs
   */
  async deleteAppUser(serial, { userId, deviceUuid, appId, clearLocalData = false, packageName }, user = null) {
    if (!serial) {
      const err = new Error('Device serial is required.');
      err.status = 400;
      throw err;
    }

    if (deviceLockService && user && !deviceLockService.isDeviceAccessible(serial, user)) {
      const err = new Error('Device is not accessible or claimed by another user.');
      err.status = 403;
      throw err;
    }

    const parsedUserId = parseInt(userId, 10);
    if (isNaN(parsedUserId) || parsedUserId <= 0) {
      const err = new Error('User ID must be a positive integer.');
      err.status = 400;
      throw err;
    }

    const parsedAppId = parseInt(appId, 10);
    if (isNaN(parsedAppId) || parsedAppId <= 0) {
      const err = new Error('App ID must be a positive integer.');
      err.status = 400;
      throw err;
    }

    const cleanDeviceUuid = typeof deviceUuid === 'string' ? deviceUuid.trim() : '';
    if (!cleanDeviceUuid) {
      const err = new Error('Device UUID is required.');
      err.status = 400;
      throw err;
    }

    const targetPackage = packageName || this.primaryPackage;

    // Call upstream API with verification fallback on timeout
    let upstreamResult = null;
    let verifiedViaStatusCheck = false;

    try {
      upstreamResult = await this.callRemoveCreditsApi({
        userId: parsedUserId,
        deviceUuid: cleanDeviceUuid,
        appId: parsedAppId
      });
    } catch (apiErr) {
      if (apiErr.code === 'UPSTREAM_TIMEOUT' || apiErr.status === 504) {
        logger.warn(`[AppUserService] removeCredits timed out for User ${parsedUserId}. Attempting read-only balance verification...`);
        let verified = false;
        try {
          const checkRes = await this.checkUserCredits({
            userId: parsedUserId,
            deviceUuid: cleanDeviceUuid,
            appId: parsedAppId
          });

          if (checkRes.success && checkRes.totalCredits !== null && checkRes.totalCredits === 0) {
            logger.info(`[AppUserService] Status check verified credits removed (total_credits = 0) for User ${parsedUserId}`);
            upstreamResult = {
              status: 200,
              code: 200,
              message: 'Credits removed successfully (verified via account status check after delayed upstream response)',
              data: checkRes.data || {}
            };
            verifiedViaStatusCheck = true;
            verified = true;
          } else {
            logger.warn(`[AppUserService] Verification check inconclusive: ${JSON.stringify(checkRes)}`);
          }
        } catch (verifyErr) {
          logger.error(`[AppUserService] Verification check error: ${verifyErr.message}`);
        }

        if (!verified) {
          const timeoutSec = Math.round((config.FLYERBUILDER_TIMEOUT_MS || 45000) / 1000);
          const timeoutErr = new Error(`Request to flyerbuilder.app timed out after ${timeoutSec}s. The upstream operation may have completed; please verify credit balance before retrying. Do not resubmit.`);
          timeoutErr.status = 504;
          timeoutErr.code = 'UPSTREAM_TIMEOUT';
          timeoutErr.outcomeUnknown = true;
          timeoutErr.userId = parsedUserId;
          timeoutErr.deviceUuid = cleanDeviceUuid;
          timeoutErr.appId = parsedAppId;
          throw timeoutErr;
        }
      } else {
        throw apiErr;
      }
    }

    let localCleared = false;
    let localClearError = null;

    if (clearLocalData && serial) {
      try {
        await adbService.clearAppData(serial, targetPackage);
        localCleared = true;
      } catch (cErr) {
        logger.warn(`[AppUserService] Upstream credits removed, but local pm clear failed: ${cErr.message}`);
        localClearError = cErr.message;
      }
    }

    return {
      success: true,
      message: upstreamResult.message || 'Credits removed successfully',
      upstreamCode: upstreamResult.code || 200,
      upstreamData: upstreamResult.data || {},
      verifiedViaStatusCheck,
      localDataCleared: localCleared,
      localClearError,
      userId: parsedUserId,
      deviceUuid: cleanDeviceUuid,
      appId: parsedAppId,
      serial
    };
  }

  /**
   * Status check for user credits via /getAndroidCredits (read-only verification)
   */
  async checkUserCredits({ userId, deviceUuid, appId }) {
    return new Promise((resolve) => {
      const payload = JSON.stringify({
        user_id: Number(userId),
        device_uuid: String(deviceUuid).trim(),
        app_id: Number(appId || 2)
      });

      const baseUrl = config.FLYERBUILDER_API_BASE_URL || 'https://flyerbuilder.app/api/public/api';
      const endpointUrl = new URL(`${baseUrl.replace(/\/+$/, '')}/getAndroidCredits`);
      const isHttps = endpointUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      };

      if (config.FLYERBUILDER_BEARER_TOKEN) {
        headers['Authorization'] = `Bearer ${config.FLYERBUILDER_BEARER_TOKEN}`;
      }

      const options = {
        hostname: endpointUrl.hostname,
        port: endpointUrl.port || (isHttps ? 443 : 80),
        path: `${endpointUrl.pathname}${endpointUrl.search}`,
        method: 'POST',
        headers,
        timeout: 15000 // Verification check timeout
      };

      const req = client.request(options, (res) => {
        let rawData = '';
        res.on('data', chunk => { rawData += chunk; });
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = JSON.parse(rawData);
          } catch (e) {
            parsed = { raw: rawData };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              success: true,
              statusCode: res.statusCode,
              totalCredits: parsed.data?.total_credits !== undefined ? Number(parsed.data.total_credits) : null,
              data: parsed.data || {}
            });
          } else {
            resolve({
              success: false,
              statusCode: res.statusCode,
              error: parsed.message || `Upstream returned status ${res.statusCode}`
            });
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          success: false,
          error: 'Verification request timed out'
        });
      });

      req.on('error', (err) => {
        resolve({
          success: false,
          error: err.message
        });
      });

      req.write(payload);
      req.end();
    });
  }

  /**
   * Internal proxy to flyerbuilder.app /removeCredits
   */
  callRemoveCreditsApi({ userId, deviceUuid, appId }) {
    return new Promise((resolve, reject) => {
      const payload = JSON.stringify({
        user_id: Number(userId),
        device_uuid: String(deviceUuid).trim(),
        app_id: Number(appId)
      });

      const baseUrl = config.FLYERBUILDER_API_BASE_URL || 'https://flyerbuilder.app/api/public/api';
      const endpointUrl = new URL(`${baseUrl.replace(/\/+$/, '')}/removeCredits`);
      const isHttps = endpointUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      };

      if (config.FLYERBUILDER_BEARER_TOKEN) {
        headers['Authorization'] = `Bearer ${config.FLYERBUILDER_BEARER_TOKEN}`;
      }

      const options = {
        hostname: endpointUrl.hostname,
        port: endpointUrl.port || (isHttps ? 443 : 80),
        path: `${endpointUrl.pathname}${endpointUrl.search}`,
        method: 'POST',
        headers,
        timeout: config.FLYERBUILDER_TIMEOUT_MS || 45000
      };

      const req = client.request(options, (res) => {
        let rawData = '';
        res.on('data', chunk => { rawData += chunk; });
        res.on('end', () => {
          let parsed = {};
          try {
            parsed = JSON.parse(rawData);
          } catch (e) {
            parsed = { raw: rawData };
          }

          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              status: res.statusCode,
              code: parsed.code || res.statusCode,
              message: parsed.message || 'Credits removed successfully',
              data: parsed.data || {}
            });
          } else {
            const error = new Error(parsed.message || `Upstream service returned HTTP ${res.statusCode}`);
            error.status = res.statusCode;
            error.upstreamData = parsed;
            reject(error);
          }
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const timeoutSec = Math.round(options.timeout / 1000);
        const error = new Error(`Request to flyerbuilder.app timed out after ${timeoutSec}s. The upstream operation may have completed; please verify credit and account status before retrying.`);
        error.status = 504;
        error.code = 'UPSTREAM_TIMEOUT';
        reject(error);
      });

      req.on('error', (err) => {
        const error = new Error(`Failed to reach flyerbuilder.app: ${err.message}`);
        error.status = 502;
        reject(error);
      });

      req.write(payload);
      req.end();
    });
  }
}

module.exports = new AppUserService();
