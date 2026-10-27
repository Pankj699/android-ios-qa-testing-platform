const http = require('http');
const https = require('https');
const querystring = require('querystring');
const config = require('../config');
const logger = require('../utils/logger');

const HTTP_TIMEOUT_MS = 15000;

class RemoteConfigService {
  constructor() {
    this.timeout = HTTP_TIMEOUT_MS;
  }

  /**
   * Validate and resolve the base URL for the given platform.
   */
  getBaseUrl(platform) {
    if (!platform || typeof platform !== 'string') {
      const err = new Error("Platform must be specified ('android' or 'ios')");
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }
    const normalized = platform.trim().toLowerCase();
    if (normalized === 'android') {
      return config.REMOTE_CONFIG_ANDROID_URL.replace(/\/+$/, '');
    }
    if (normalized === 'ios') {
      return config.REMOTE_CONFIG_IOS_URL.replace(/\/+$/, '');
    }
    const err = new Error(`Unsupported platform: '${platform}'. Must be 'android' or 'ios'.`);
    err.type = 'VALIDATION_ERROR';
    err.statusCode = 400;
    throw err;
  }

  /**
   * Validate application slug against directory/path traversal and invalid characters.
   */
  validateAppSlug(appSlug) {
    if (!appSlug || typeof appSlug !== 'string' || !/^[a-zA-Z0-9_\-]+$/.test(appSlug.trim())) {
      const err = new Error(`Invalid application slug: '${appSlug}'. Only alphanumeric, hyphen, and underscore characters are allowed.`);
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }
    return appSlug.trim();
  }

  /**
   * Validate configuration key.
   */
  validateKey(key) {
    if (!key || typeof key !== 'string' || !/^[a-zA-Z0-9_\-\.:]+$/.test(key.trim())) {
      const err = new Error(`Invalid key: '${key}'. Must contain valid key characters (letters, numbers, underscores, hyphens, periods, colons).`);
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }
    return key.trim();
  }

  /**
   * Validate and normalize type.
   */
  validateType(type) {
    if (!type || typeof type !== 'string') {
      const err = new Error("Config type must be specified ('boolean', 'number', 'json')");
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }
    const normalized = type.trim().toLowerCase();
    if (!['boolean', 'number', 'json'].includes(normalized)) {
      const err = new Error(`Invalid config type: '${type}'. Supported types are: 'boolean', 'number', 'json'.`);
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }
    return normalized;
  }

  /**
   * Validate and normalize value based on type.
   */
  normalizeValue(type, value) {
    const normType = this.validateType(type);
    if (value === undefined || value === null) {
      const err = new Error(`Value is required for type '${normType}'.`);
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    if (normType === 'boolean') {
      if (typeof value === 'boolean') return value ? '1' : '0';
      const strVal = String(value).trim().toLowerCase();
      if (strVal === '1' || strVal === 'true' || strVal === 'yes') return '1';
      if (strVal === '0' || strVal === 'false' || strVal === 'no') return '0';
      const err = new Error("Invalid boolean value. Must be '1'/'true' or '0'/'false'.");
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    if (normType === 'number') {
      const strVal = String(value).trim();
      if (strVal === '' || isNaN(Number(strVal))) {
        const err = new Error(`Invalid number value: '${value}'. Must be a valid integer or floating point number.`);
        err.type = 'VALIDATION_ERROR';
        err.statusCode = 400;
        throw err;
      }
      return strVal;
    }

    if (normType === 'json') {
      let strVal = typeof value === 'object' ? JSON.stringify(value) : String(value).trim();
      try {
        JSON.parse(strVal);
      } catch (e) {
        const err = new Error(`Invalid JSON value: ${e.message}`);
        err.type = 'VALIDATION_ERROR';
        err.statusCode = 400;
        throw err;
      }
      return strVal;
    }

    return String(value);
  }

  /**
   * Normalize active status to '0' or '1'.
   */
  normalizeActive(isActive) {
    if (typeof isActive === 'boolean') return isActive ? '1' : '0';
    const str = String(isActive).trim().toLowerCase();
    if (str === '1' || str === 'true' || str === 'yes' || str === 'active') return '1';
    return '0';
  }

  /**
   * Low-level HTTP request helper with automatic redirect following (up to 5),
   * timeout handling, and cookie extraction.
   */
  _request(urlStr, options = {}, postData = null, redirectCount = 0) {
    if (redirectCount > 5) {
      const err = new Error(`Too many redirects (max 5) when accessing ${urlStr}`);
      err.type = 'UPSTREAM_ERROR';
      err.statusCode = 502;
      return Promise.reject(err);
    }

    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlStr);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const reqOptions = {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || (postData ? 'POST' : 'GET'),
        headers: {
          'User-Agent': 'Centralized-QA-Platform/1.0',
          ...(options.headers || {})
        },
        timeout: this.timeout
      };

      const req = client.request(reqOptions, (res) => {
        // Follow HTTP Redirects (301, 302, 303, 307, 308) for non-POST or GET requests
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && options.method !== 'POST') {
          const redirectUrl = new URL(res.headers.location, urlStr).href;
          const setCookies = res.headers['set-cookie'];
          let mergedHeaders = { ...(options.headers || {}) };
          if (setCookies) {
            const newCookies = setCookies.map(c => c.split(';')[0]).join('; ');
            const existing = mergedHeaders.Cookie ? mergedHeaders.Cookie + '; ' : '';
            mergedHeaders.Cookie = existing + newCookies;
          }
          return resolve(this._request(redirectUrl, { ...options, headers: mergedHeaders }, null, redirectCount + 1));
        }

        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body
          });
        });
      });

      req.on('timeout', () => {
        req.destroy();
        const cleanHost = parsedUrl.hostname + (parsedUrl.port ? `:${parsedUrl.port}` : '');
        const err = new Error(`Upstream request to ${cleanHost}${parsedUrl.pathname} timed out after ${this.timeout}ms`);
        err.type = 'TIMEOUT';
        err.statusCode = 504;
        reject(err);
      });

      req.on('error', (err) => {
        const cleanHost = parsedUrl.hostname + (parsedUrl.port ? `:${parsedUrl.port}` : '');
        const isConnRefused = err.code === 'ECONNREFUSED' || err.message.includes('ECONNREFUSED');
        const customErr = new Error(`Upstream service unavailable (${cleanHost}${parsedUrl.pathname}): ${isConnRefused ? 'Connection refused' : err.message}`);
        customErr.type = 'UPSTREAM_UNAVAILABLE';
        customErr.statusCode = 502;
        reject(customErr);
      });

      if (postData) {
        req.write(postData);
      }
      req.end();
    });
  }

  /**
   * Extract CSRF token from HTML.
   */
  _extractCsrf(html) {
    if (!html) return null;
    const tokenMatch = html.match(/name=["']_token["']\s+value=["']([^"']+)["']/i) ||
                       html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
    return tokenMatch ? tokenMatch[1] : null;
  }

  /**
   * Extract and format cookie string from set-cookie headers.
   */
  _extractCookies(headers) {
    const setCookies = headers['set-cookie'];
    if (!setCookies) return '';
    return setCookies.map(c => c.split(';')[0]).join('; ');
  }

  /**
   * Parse HTML table of Remote Configs from Blade view.
   */
  parseTable(html, platform, appSlug) {
    if (!html) return [];
    const tableMatch = html.match(/<table\b[\s\S]*?<\/table>/i);
    if (!tableMatch) return [];

    const rows = [...tableMatch[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
    const configs = [];

    // Skip header row at index 0
    for (let i = 1; i < rows.length; i++) {
      const rowContent = rows[i][1];
      const tds = [...rowContent.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].trim());
      if (tds.length >= 6) {
        const srNo = tds[0].replace(/<[^>]+>/g, '').trim();
        const app = tds[1].replace(/<[^>]+>/g, '').trim();
        const key = tds[2].replace(/<[^>]+>/g, '').trim();

        // Extract value: unescape preformatted code or raw HTML entities
        const valuePre = tds[3].match(/<pre\b[^>]*>([\s\S]*?)<\/pre>/i);
        let rawValue = valuePre ? valuePre[1] : tds[3].replace(/<[^>]+>/g, '').trim();
        rawValue = rawValue
          .replace(/&quot;/g, '"')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&#039;/g, "'");

        const type = tds[4].replace(/<[^>]+>/g, '').trim().toLowerCase();
        const activeText = tds[5].replace(/<[^>]+>/g, '').trim().toLowerCase();
        const active = activeText.includes('yes') || activeText.includes('active') || activeText === '1';

        // Extract Edit and Delete URLs / IDs
        const actionsTd = tds[6] || '';
        const editMatch = actionsTd.match(/href=["']([^"']*\/configs\/(\d+)\/edit)["']/i);
        const deleteMatch = actionsTd.match(/action=["']([^"']*\/configs\/(\d+))["']/i);
        const tokenMatch = actionsTd.match(/name=["']_token["']\s+value=["']([^"']+)["']/i);
        const id = editMatch ? editMatch[2] : (deleteMatch ? deleteMatch[2] : null);

        configs.push({
          id: id ? parseInt(id, 10) : null,
          srNo: srNo ? parseInt(srNo, 10) : i,
          platform,
          app: app || appSlug,
          key,
          value: rawValue,
          type: type || 'json',
          active,
          updatedAt: null, // Limitation documented: Legacy server table exposes no timestamp
          deleteToken: tokenMatch ? tokenMatch[1] : null,
          editUrl: editMatch ? editMatch[1] : null,
          deleteUrl: deleteMatch ? deleteMatch[1] : null
        });
      }
    }

    return configs;
  }

  /**
   * Parse applications list from HTML Blade view.
   */
  parseApplications(html, platform) {
    const apps = [];
    if (!html) return apps;

    // Matches application cards linking to configs
    const linkRegex = /<a\b[^>]*href=["']([^"']*(?:\/admin\/applications\/(?:ios\/)?([a-zA-Z0-9_\-]+)\/configs))["'][^>]*>([\s\S]*?)<\/a>/gi;
    const matches = [...html.matchAll(linkRegex)];

    const seenSlugs = new Set();
    for (const m of matches) {
      const fullUrl = m[1];
      const urlSlug = m[2];
      const cardHtml = m[3];

      if (urlSlug && !seenSlugs.has(urlSlug.toLowerCase()) && urlSlug.toLowerCase() !== 'create' && urlSlug.toLowerCase() !== 'test') {
        seenSlugs.add(urlSlug.toLowerCase());

        // Extract clean displayName from <h2> tag if present
        const h2Match = cardHtml.match(/<h2\b[^>]*>([\s\S]*?)<\/h2>/i);
        let displayName = h2Match ? h2Match[1].replace(/<[^>]+>/g, '').trim() : '';

        // Extract slug from <p class="...text-stone-400">slug</p> if present
        const slugMatch = cardHtml.match(/<p\b[^>]*text-stone-400[^>]*>([\s\S]*?)<\/p>/i);
        const resolvedSlug = (slugMatch ? slugMatch[1].replace(/<[^>]+>/g, '').trim() : '') || urlSlug;

        // If no h2, fallback to slug or link text
        if (!displayName) {
          const cleanText = cardHtml.replace(/<[^>]+>/g, '').trim().replace(/\s+/g, ' ');
          displayName = cleanText.split(/\s+/)[0] || resolvedSlug;
        }

        // Extract count if mentioned, e.g. "30 configs"
        const countMatch = cardHtml.match(/(\d+)\s+configs?/i);
        const configCount = countMatch ? parseInt(countMatch[1], 10) : 0;

        apps.push({
          slug: resolvedSlug,
          name: displayName,
          configCount,
          platform,
          url: fullUrl
        });
      }
    }

    // Default fallbacks if parsing found none
    if (apps.length === 0) {
      const defaultApps = platform === 'ios'
        ? [
            { slug: '1invites', name: '1Invites' },
            { slug: 'flyerwiz', name: 'Flyerwiz' },
            { slug: 'designwiz', name: 'Designwiz' },
            { slug: 'lisimenu', name: 'Lisi.menu' },
            { slug: 'logoWiz', name: 'LogoWiz' },
            { slug: 'planwiz', name: 'Planwiz' },
            { slug: 'postermaker', name: 'Poster Maker' },
            { slug: 'postwizz', name: 'Postwizz' }
          ]
        : [
            { slug: '1invites', name: '1Invites' },
            { slug: 'designwiz', name: 'Designwiz' },
            { slug: 'lisimenu', name: 'Lisi.menu' },
            { slug: 'LogoMaker', name: 'LogoMaker' },
            { slug: 'logoWiz', name: 'LogoWiz' },
            { slug: 'planwiz', name: 'Planwiz' },
            { slug: 'postermaker', name: 'Poster Maker' },
            { slug: 'postwizz', name: 'Postwizz' }
          ];

      return defaultApps.map(a => ({ ...a, platform, configCount: 0 }));
    }

    return apps;
  }

  /**
   * Fetch the list of applications for a platform.
   */
  async getApplications(platform) {
    const baseUrl = this.getBaseUrl(platform);
    const normPlatform = platform.trim().toLowerCase();

    // Determine target routes to attempt in order of preference:
    // Android uses /admin/applications/test (with fallback to /admin/applications)
    // iOS uses /admin/applications/ios (with fallback to /admin/applications)
    const pathsToTry = normPlatform === 'ios'
      ? ['/admin/applications/ios', '/admin/applications']
      : ['/admin/applications/test', '/admin/applications'];

    let lastError = null;
    let res = null;
    let successfulUrl = null;

    for (const appPath of pathsToTry) {
      const targetUrl = `${baseUrl}${appPath}`;
      try {
        logger.info(`[RemoteConfig] Fetching applications for ${normPlatform} from ${targetUrl}`);
        const attempt = await this._request(targetUrl);
        if (attempt.statusCode === 200) {
          res = attempt;
          successfulUrl = targetUrl;
          break;
        } else if (attempt.statusCode === 404) {
          lastError = new Error(`Upstream route not found (404) at ${appPath}`);
          lastError.type = 'UPSTREAM_404';
          lastError.statusCode = 404;
        } else if (attempt.statusCode === 401 || attempt.statusCode === 403) {
          lastError = new Error(`Upstream authentication or session failure (HTTP ${attempt.statusCode}) at ${appPath}`);
          lastError.type = 'UPSTREAM_AUTH';
          lastError.statusCode = attempt.statusCode;
        } else {
          lastError = new Error(`Upstream service returned HTTP ${attempt.statusCode} for ${appPath}`);
          lastError.type = 'UPSTREAM_ERROR';
          lastError.statusCode = attempt.statusCode;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!res) {
      const errMsg = lastError ? lastError.message : 'Unknown upstream error';
      logger.error(`[RemoteConfig] Failed to load applications for ${normPlatform}: ${errMsg}`);
      const err = new Error(`Failed to load applications for ${normPlatform.toUpperCase()}: ${errMsg}`);
      err.type = lastError?.type || 'UPSTREAM_ERROR';
      err.statusCode = lastError?.statusCode || 502;
      throw err;
    }

    return this.parseApplications(res.body, normPlatform);
  }

  /**
   * Fetch configuration records for a specific platform and application.
   */
  async getConfigs(platform, appSlug) {
    const baseUrl = this.getBaseUrl(platform);
    const validApp = this.validateAppSlug(appSlug);
    const normPlatform = platform.trim().toLowerCase();
    const configsPath = normPlatform === 'ios'
      ? `/admin/applications/ios/${validApp}/configs`
      : `/admin/applications/${validApp}/configs`;
    const targetUrl = `${baseUrl}${configsPath}`;

    logger.info(`[RemoteConfig] Fetching configs for ${normPlatform}/${validApp} from ${targetUrl}`);
    const res = await this._request(targetUrl);
    if (res.statusCode === 404) {
      const err = new Error(`Upstream route not found (404) for application '${validApp}' at ${configsPath}.`);
      err.type = 'UPSTREAM_404';
      err.statusCode = 404;
      throw err;
    }
    if (res.statusCode === 401 || res.statusCode === 403) {
      const err = new Error(`Upstream authentication failure (HTTP ${res.statusCode}) for application '${validApp}'.`);
      err.type = 'UPSTREAM_AUTH';
      err.statusCode = res.statusCode;
      throw err;
    }
    if (res.statusCode >= 400) {
      const err = new Error(`Upstream service returned HTTP ${res.statusCode} for application '${validApp}'.`);
      err.type = 'UPSTREAM_ERROR';
      err.statusCode = res.statusCode;
      throw err;
    }

    const configs = this.parseTable(res.body, normPlatform, validApp);
    return {
      platform: normPlatform,
      app: validApp,
      count: configs.length,
      configs,
      timestampLimitation: 'Legacy Remote Config service does not provide update timestamps. Table reflects server list order.'
    };
  }

  /**
   * Acquire a fresh session cookie and CSRF token for a form action.
   */
  async _acquireFormContext(platform, appSlug, formType = 'create', configId = null) {
    const baseUrl = this.getBaseUrl(platform);
    const validApp = this.validateAppSlug(appSlug);
    const normPlatform = platform.trim().toLowerCase();

    let path = '';
    if (formType === 'create') {
      path = normPlatform === 'ios'
        ? `/admin/applications/ios/${validApp}/configs/create`
        : `/admin/applications/${validApp}/configs/create`;
    } else {
      if (!configId) {
        const err = new Error('configId is required to edit a configuration');
        err.type = 'VALIDATION_ERROR';
        err.statusCode = 400;
        throw err;
      }
      path = normPlatform === 'ios'
        ? `/admin/applications/ios/${validApp}/configs/${configId}/edit`
        : `/admin/applications/${validApp}/configs/${configId}/edit`;
    }

    const targetUrl = `${baseUrl}${path}`;
    logger.info(`[RemoteConfig] Acquiring CSRF and session from ${targetUrl}`);
    const res = await this._request(targetUrl);

    if (res.statusCode === 404) {
      const err = new Error(`Upstream ${formType} form not found (404) at ${path}.`);
      err.type = 'UPSTREAM_404';
      err.statusCode = 404;
      throw err;
    }

    if (res.statusCode !== 200) {
      const err = new Error(`Failed to load ${formType} form from upstream service (HTTP ${res.statusCode}).`);
      err.type = 'UPSTREAM_ERROR';
      err.statusCode = res.statusCode;
      throw err;
    }

    const token = this._extractCsrf(res.body);
    const cookies = this._extractCookies(res.headers);

    if (!token) {
      const err = new Error('Upstream form did not contain a valid CSRF token (_token).');
      err.type = 'UPSTREAM_AUTH';
      err.statusCode = 502;
      throw err;
    }

    return {
      token,
      cookies,
      refererUrl: targetUrl,
      baseUrl,
      formBody: res.body
    };
  }

  /**
   * Create a new Remote Config key on the upstream service.
   */
  async createConfig(platform, appSlug, data = {}) {
    const normPlatform = platform.trim().toLowerCase();
    const validApp = this.validateAppSlug(appSlug);
    const validKey = this.validateKey(data.key);
    const validType = this.validateType(data.type);
    const validVal = this.normalizeValue(validType, data.value);
    const validActive = this.normalizeActive(data.is_active);

    const { token, cookies, refererUrl, baseUrl } = await this._acquireFormContext(normPlatform, validApp, 'create');

    const postPath = normPlatform === 'ios'
      ? `/admin/applications/ios/${validApp}/configs`
      : `/admin/applications/${validApp}/configs`;
    const targetUrl = `${baseUrl}${postPath}`;

    const payload = querystring.stringify({
      _token: token,
      key: validKey,
      value: validVal,
      type: validType,
      is_active: validActive
    });

    logger.info(`[RemoteConfig] Submitting CREATE config '${validKey}' to ${targetUrl}`);
    const postRes = await this._request(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        'Cookie': cookies,
        'Referer': refererUrl
      }
    }, payload);

    // Safeguard: Never treat HTTP 200 alone as proof of success!
    // Verify that the record actually exists in the configuration list.
    const latestState = await this.getConfigs(normPlatform, validApp);
    const verifiedRecord = latestState.configs.find(c => c.key === validKey);

    if (!verifiedRecord) {
      // Check if upstream returned validation errors in the HTML body
      let errorHint = 'Configuration was not saved by upstream service.';
      if (postRes.body) {
        const errMatch = postRes.body.match(/<div class=["'][^"']*text-red[^"']*["']>([\s\S]*?)<\/div>/i) ||
                         postRes.body.match(/<span class=["'][^"']*text-red[^"']*["']>([\s\S]*?)<\/span>/i);
        if (errMatch) {
          errorHint = errMatch[1].replace(/<[^>]+>/g, '').trim();
        }
      }
      const err = new Error(`Upstream rejected config creation for key '${validKey}': ${errorHint}`);
      err.type = 'UPSTREAM_VALIDATION_ERROR';
      err.statusCode = 422;
      throw err;
    }

    logger.info(`[RemoteConfig] Successfully verified created config '${validKey}' (ID: ${verifiedRecord.id})`);
    return verifiedRecord;
  }

  /**
   * Update an existing Remote Config key on the upstream service.
   */
  async updateConfig(platform, appSlug, configId, data = {}) {
    const normPlatform = platform.trim().toLowerCase();
    const validApp = this.validateAppSlug(appSlug);
    const id = parseInt(configId, 10);
    if (!id || isNaN(id)) {
      const err = new Error(`Invalid configuration ID: '${configId}'`);
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    const validKey = this.validateKey(data.key);
    const validType = this.validateType(data.type);
    const validVal = this.normalizeValue(validType, data.value);
    const validActive = this.normalizeActive(data.is_active);

    const { token, cookies, refererUrl, baseUrl } = await this._acquireFormContext(normPlatform, validApp, 'edit', id);

    const postPath = normPlatform === 'ios'
      ? `/admin/applications/ios/${validApp}/configs/${id}`
      : `/admin/applications/${validApp}/configs/${id}`;
    const targetUrl = `${baseUrl}${postPath}`;

    const payload = querystring.stringify({
      _token: token,
      _method: 'PUT',
      key: validKey,
      value: validVal,
      type: validType,
      is_active: validActive
    });

    logger.info(`[RemoteConfig] Submitting UPDATE config ID ${id} ('${validKey}') to ${targetUrl}`);
    const putRes = await this._request(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        'Cookie': cookies,
        'Referer': refererUrl
      }
    }, payload);

    // Safeguard: Verify that the record actually updated on upstream service
    const latestState = await this.getConfigs(normPlatform, validApp);
    const verifiedRecord = latestState.configs.find(c => c.id === id || c.key === validKey);

    if (!verifiedRecord) {
      const err = new Error(`Config ID ${id} was not found after update attempt.`);
      err.type = 'UPSTREAM_ERROR';
      err.statusCode = 502;
      throw err;
    }

    // Verify key attributes match requested update
    const expectedActive = validActive === '1';
    if (verifiedRecord.active !== expectedActive) {
      const err = new Error(`Update verification failed: active status is ${verifiedRecord.active}, expected ${expectedActive}.`);
      err.type = 'UPSTREAM_ERROR';
      err.statusCode = 502;
      throw err;
    }

    logger.info(`[RemoteConfig] Successfully verified updated config ID ${id} ('${validKey}')`);
    return verifiedRecord;
  }

  /**
   * Toggle the active status of an existing config.
   */
  async toggleActive(platform, appSlug, configId, targetActiveState = null) {
    const normPlatform = platform.trim().toLowerCase();
    const validApp = this.validateAppSlug(appSlug);
    const id = parseInt(configId, 10);
    if (!id || isNaN(id)) {
      const err = new Error(`Invalid configuration ID: '${configId}'`);
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    // Fetch existing configs to inspect current attributes
    const currentState = await this.getConfigs(normPlatform, validApp);
    const existing = currentState.configs.find(c => c.id === id);
    if (!existing) {
      const err = new Error(`Configuration with ID ${id} not found in application '${validApp}'.`);
      err.type = 'UPSTREAM_404';
      err.statusCode = 404;
      throw err;
    }

    const newActiveState = targetActiveState !== null && targetActiveState !== undefined
      ? (targetActiveState ? '1' : '0')
      : (existing.active ? '0' : '1');

    return this.updateConfig(normPlatform, validApp, id, {
      key: existing.key,
      value: existing.value,
      type: existing.type,
      is_active: newActiveState
    });
  }

  /**
   * Delete a configuration key on the upstream service.
   */
  async deleteConfig(platform, appSlug, configId) {
    const normPlatform = platform.trim().toLowerCase();
    const validApp = this.validateAppSlug(appSlug);
    const id = parseInt(configId, 10);
    if (!id || isNaN(id)) {
      const err = new Error(`Invalid configuration ID: '${configId}'`);
      err.type = 'VALIDATION_ERROR';
      err.statusCode = 400;
      throw err;
    }

    // First inspect existing configs to get the key name and verify it exists
    const beforeState = await this.getConfigs(normPlatform, validApp);
    const targetConfig = beforeState.configs.find(c => c.id === id);
    if (!targetConfig) {
      const err = new Error(`Configuration ID ${id} does not exist in application '${validApp}'.`);
      err.type = 'UPSTREAM_404';
      err.statusCode = 404;
      throw err;
    }

    const { token, cookies, refererUrl, baseUrl } = await this._acquireFormContext(normPlatform, validApp, 'edit', id);

    const postPath = normPlatform === 'ios'
      ? `/admin/applications/ios/${validApp}/configs/${id}`
      : `/admin/applications/${validApp}/configs/${id}`;
    const targetUrl = `${baseUrl}${postPath}`;

    const payload = querystring.stringify({
      _token: token,
      _method: 'DELETE'
    });

    logger.info(`[RemoteConfig] Submitting DELETE config ID ${id} ('${targetConfig.key}') to ${targetUrl}`);
    await this._request(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload),
        'Cookie': cookies,
        'Referer': refererUrl
      }
    }, payload);

    // Safeguard: Verify that the record is completely removed from upstream service
    const afterState = await this.getConfigs(normPlatform, validApp);
    const stillExists = afterState.configs.some(c => c.id === id || c.key === targetConfig.key);

    if (stillExists) {
      const err = new Error(`Failed to delete config ID ${id} ('${targetConfig.key}') from upstream service.`);
      err.type = 'UPSTREAM_ERROR';
      err.statusCode = 502;
      throw err;
    }

    logger.info(`[RemoteConfig] Successfully verified deletion of config ID ${id} ('${targetConfig.key}')`);
    return {
      success: true,
      id,
      key: targetConfig.key,
      message: `Configuration '${targetConfig.key}' deleted successfully.`
    };
  }
}

module.exports = new RemoteConfigService();
