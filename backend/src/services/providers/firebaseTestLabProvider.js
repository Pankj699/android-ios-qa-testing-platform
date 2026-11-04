const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../utils/logger');

/**
 * Regex patterns for extracting Firebase Test Lab identifiers and reports from CLI streams
 */
const MATRIX_ID_REGEX = /(?:Test\s*\[|Matrix\[|testMatrixId["':\s]+"?|matrix-)([a-zA-Z0-9_-]{5,})\]?/i;
const FIREBASE_CONSOLE_URL_REGEX = /(https:\/\/console\.firebase\.google\.com\/project\/[^\s\]'"\)]+)/i;
const GCS_RESULTS_URL_REGEX = /(https:\/\/console\.(?:cloud|developers)\.google\.com\/storage\/browser\/[^\s\]'"\)]+)/i;

function redactSecrets(text) {
  if (typeof text !== 'string') return text;
  let sanitized = text;
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._~+/-]+=*/gi, 'Bearer [REDACTED_SECRET]');
  sanitized = sanitized.replace(/ya29\.[a-zA-Z0-9_-]+/gi, '[REDACTED_SECRET]');
  sanitized = sanitized.replace(/(client_secret|password|private_key|secret)["':\s=]+("[^"]*"|'[^']*'|[^\s,]+)/gi, '$1="[REDACTED_SECRET]"');
  return sanitized;
}

const ANSI_REGEX = /\u001b\[[0-9;]*[a-zA-Z]/g;

function stripAnsi(text) {
  if (typeof text !== 'string') return '';
  return text.replace(ANSI_REGEX, '');
}

/**
 * Strict validation of Firebase Test Lab Console Results URL
 */
function isValidFirebaseResultsUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'console.firebase.google.com') return false;
    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (pathParts[0] !== 'project' || pathParts[2] !== 'testlab' || !parsed.pathname.includes('/matrices/')) {
      return false;
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Map Google Cloud CLI Firebase Test Lab exit codes and termination signals to platform status and outcome
 * Official Google Test Lab Exit Codes:
 * 0: All test executions passed.
 * 1: General failure, including file, HTTP, or network errors.
 * 2: Unknown command or invalid arguments.
 * 10: One or more test cases failed.
 * 15: Test Lab could not determine whether the matrix passed or failed (inconclusive).
 * 18: Unsupported test environment or incompatible test dimensions.
 * 19: Test matrix cancelled.
 * 20: Test infrastructure error.
 */
function mapExitCode(code, signal, isTerminated = false) {
  let status = 'COMPLETED';
  let outcome = 'SUCCESS';
  let error = null;

  if (signal === 'SIGINT' || signal === 'SIGTERM' || code === 19 || isTerminated) {
    status = 'CANCELLED';
    outcome = 'CANCELLED';
    error = 'Test matrix execution was cancelled.';
  } else if (code === 0) {
    status = 'COMPLETED';
    outcome = 'SUCCESS';
  } else if (code === 10) {
    status = 'COMPLETED';
    outcome = 'FAILURE';
    error = 'Robo test detected application defects, crashes, or unhandled exceptions.';
  } else if (code === 1) {
    status = 'FAILED';
    outcome = 'GENERAL_FAILURE';
    error = 'General failure occurred while executing Firebase Test Lab command.';
  } else if (code === 2) {
    status = 'FAILED';
    outcome = 'CONFIG_ERROR';
    error = 'Invalid configuration or unsupported arguments passed to Firebase Test Lab.';
  } else if (code === 15) {
    status = 'FAILED';
    outcome = 'INCONCLUSIVE';
    error = 'Firebase Test Lab could not determine whether the test matrix passed or failed.';
  } else if (code === 18) {
    status = 'FAILED';
    outcome = 'UNSUPPORTED_ENVIRONMENT';
    error = 'Unsupported test environment or incompatible test dimensions requested.';
  } else if (code === 20) {
    status = 'FAILED';
    outcome = 'INFRASTRUCTURE_ERROR';
    error = 'Firebase Test Lab infrastructure error occurred on Google Cloud.';
  } else {
    status = 'FAILED';
    outcome = 'UNKNOWN_FAILURE';
    error = `Firebase Test Lab exited with code ${code}.`;
  }

  return { status, outcome, error };
}

/**
 * Resolves process environment ensuring Google Cloud SDK bin directories are included in PATH on Windows
 */
function getResolvedEnvironment() {
  const env = { ...process.env };
  if (process.platform === 'win32') {
    const candidateDirs = [
      path.join(process.env.LOCALAPPDATA || 'C:\\Users\\Admin\\AppData\\Local', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin'),
      path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin')
    ];
    for (const dir of candidateDirs) {
      if (fs.existsSync(dir)) {
        const currentPath = env.PATH || env.Path || '';
        if (!currentPath.toLowerCase().includes(dir.toLowerCase())) {
          env.PATH = `${dir};${currentPath}`;
          env.Path = env.PATH;
        }
        break;
      }
    }
  }
  return env;
}

class FirebaseTestLabProvider {
  constructor(options = {}) {
    this.gcloudPath = options.gcloudPath || config.GCLOUD_PATH || 'gcloud';
    this.defaultProjectId = options.projectId || config.FIREBASE_PROJECT_ID || '';
    this.cachedCatalog = null;
    this.catalogCacheTime = 0;
    this.catalogTtlMs = 60 * 60 * 1000; // 1 hour cache
  }

  /**
   * Safe wrapper around execFile with timeout and output capture
   */
  execCli(args, options = {}) {
    return new Promise((resolve, reject) => {
      const gcloud = options.gcloudPath || this.gcloudPath;
      const env = { ...getResolvedEnvironment(), ...options.env };

      let cmd = gcloud;
      let finalArgs = args;

      if (process.platform === 'win32' && !gcloud.endsWith('.exe')) {
        cmd = process.env.ComSpec || 'cmd.exe';
        finalArgs = ['/d', '/s', '/c', gcloud, ...args];
      }

      execFile(cmd, finalArgs, {
        timeout: options.timeout || 30000,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
        env
      }, (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          return reject(err);
        }
        resolve({ stdout, stderr });
      });
    });
  }

  /**
   * Diagnostic environment verification: verifies CLI availability, account authentication, and project configuration.
   * Never leaks local host filesystem paths, account emails, or authentication tokens.
   */
  async checkEnvironment(options = {}) {
    const customGcloud = options.gcloudPath || this.gcloudPath;
    const diag = {
      ready: false,
      step: null,
      message: '',
      gcloudInstalled: false,
      authenticated: false,
      projectId: options.projectId || this.defaultProjectId || null,
      setupGuideUrl: 'https://firebase.google.com/docs/test-lab/android/command-line'
    };

    // 1. Verify gcloud executable availability
    try {
      await this.execCli(['--version'], { gcloudPath: customGcloud, timeout: 10000 });
      diag.gcloudInstalled = true;
    } catch (err) {
      diag.ready = false;
      diag.step = 'GCLOUD_MISSING';
      diag.message = 'Google Cloud CLI (gcloud) is not found in PATH. Please install the Google Cloud SDK.';
      return diag;
    }

    // 2. Verify active authenticated Google account
    try {
      const authRes = await this.execCli(['auth', 'list', '--format=json'], { gcloudPath: customGcloud, timeout: 15000 });
      const accounts = JSON.parse(authRes.stdout || '[]');
      const active = accounts.find(a => a.status === 'ACTIVE' || a.active);
      if (active && (active.account || active.name)) {
        diag.authenticated = true;
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
        diag.authenticated = true;
      } else {
        diag.ready = false;
        diag.step = 'AUTH_MISSING';
        diag.message = 'No active Google Cloud account is authenticated. Run "gcloud auth login" or configure Application Default Credentials.';
        return diag;
      }
    } catch (err) {
      diag.ready = false;
      diag.step = 'AUTH_MISSING';
      diag.message = 'Failed to query Google Cloud authentication status. Run "gcloud auth login".';
      return diag;
    }

    // 3. Verify target project ID
    let activeProject = diag.projectId;
    if (!activeProject) {
      try {
        const projRes = await this.execCli(['config', 'get-value', 'project'], { gcloudPath: customGcloud, timeout: 10000 });
        const p = (projRes.stdout || '').trim();
        if (p && p !== '(unset)') {
          activeProject = p;
        }
      } catch (_) {}
    }

    if (!activeProject) {
      diag.ready = false;
      diag.step = 'PROJECT_MISSING';
      diag.message = 'No Google Cloud / Firebase project configured. Set FIREBASE_TEST_LAB_PROJECT_ID or run "gcloud config set project <PROJECT_ID>".';
      return diag;
    }
    diag.projectId = activeProject;

    // All prerequisites satisfied
    diag.ready = true;
    diag.step = 'READY';
    diag.message = `Connected to Firebase Test Lab (Project: ${activeProject})`;
    return diag;
  }

  /**
   * Filter catalog models by search query matching API versions, Android OS names,
   * device names, brand/manufacturer, model ID, form factor, or tags case-insensitively.
   */
  filterCatalog(catalog, searchQuery) {
    if (!catalog || !Array.isArray(catalog.models)) return catalog;
    if (!searchQuery || typeof searchQuery !== 'string') return catalog;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return catalog;

    const catalogVersions = Array.isArray(catalog.versions) ? catalog.versions : [];

    const androidReleaseToApi = {
      '16': [36, 37, 38],
      '15': [35],
      '14': [34],
      '13': [33],
      '12': [31, 32],
      '11': [30],
      '10': [29],
      '9': [28],
      '8.1': [27],
      '8.0': [26],
      '8': [26, 27],
      '7.1': [25],
      '7.0': [24],
      '7': [24, 25],
      '6': [23],
      '5': [21, 22]
    };

    const apiMatch = q.match(/^api[:\s-]*(\d+)$/i);
    const androidMatch = q.match(/^android[:\s-]*(\d+(?:\.\d+)?)$/i);
    const isPureDigits = /^\d+$/.test(q);

    const filteredModels = catalog.models.filter(m => {
      // 1. Supported versions & API levels
      const supportedVersionIds = (m.supportedVersionIds || []).map(v => String(v).trim().toLowerCase());
      const supportedVersions = Array.isArray(m.supportedVersions) && m.supportedVersions.length > 0
        ? m.supportedVersions
        : catalogVersions.filter(v => supportedVersionIds.includes(String(v.id).toLowerCase()));

      const apiLevels = supportedVersions.map(v => v.apiLevel || parseInt(v.id, 10)).filter(n => !isNaN(n));
      supportedVersionIds.forEach(id => {
        const num = parseInt(id, 10);
        if (!isNaN(num) && !apiLevels.includes(num)) apiLevels.push(num);
      });

      const versionStrings = supportedVersions.map(v => String(v.versionString || '').trim().toLowerCase());
      const codeNames = supportedVersions.map(v => String(v.codeName || '').trim().toLowerCase());

      // 2. "API <number>" search (e.g. API 36, API 35)
      if (apiMatch) {
        const targetApi = apiMatch[1];
        const targetNum = parseInt(targetApi, 10);
        if (supportedVersionIds.includes(targetApi) || apiLevels.includes(targetNum)) return true;
      }

      // 3. "Android <version>" search (e.g. Android 16, Android 14)
      if (androidMatch) {
        const targetVer = androidMatch[1];
        if (versionStrings.includes(targetVer)) return true;
        const targetApis = androidReleaseToApi[targetVer] || [];
        if (targetApis.some(api => apiLevels.includes(api) || supportedVersionIds.includes(String(api)))) {
          return true;
        }
        if (supportedVersionIds.includes(targetVer)) return true;
      }

      // 4. Pure numeric search (e.g. "36", "14")
      if (isPureDigits) {
        const num = parseInt(q, 10);
        if (supportedVersionIds.includes(q) || apiLevels.includes(num)) return true;
        if (versionStrings.includes(q)) return true;
        const mapped = androidReleaseToApi[q];
        if (mapped && mapped.some(api => apiLevels.includes(api) || supportedVersionIds.includes(String(api)))) {
          return true;
        }
      }

      // 5. Code name or "api XX" substring
      if (codeNames.some(cn => cn.includes(q))) return true;
      if (supportedVersionIds.some(vid => `api ${vid}`.includes(q) || `api${vid}`.includes(q))) return true;
      if (apiLevels.some(api => `api ${api}`.includes(q) || `api${api}`.includes(q))) return true;

      // 6. Name, ID, Brand, FormFactor, Form, Tags
      const nameMatch = m.name && m.name.toLowerCase().includes(q);
      const idMatch = m.id && m.id.toLowerCase().includes(q);
      const brandMatch = m.brand && m.brand.toLowerCase().includes(q);
      const formFactorMatch = m.formFactor && m.formFactor.toLowerCase().includes(q);
      const formMatch = m.form && m.form.toLowerCase().includes(q);
      const tagsMatch = Array.isArray(m.tags) && m.tags.some(t => t.toLowerCase().includes(q));

      return !!(nameMatch || idMatch || brandMatch || formFactorMatch || formMatch || tagsMatch);
    });

    return {
      ...catalog,
      models: filteredModels,
      totalModels: catalog.models.length,
      matchingCount: filteredModels.length,
      searchQuery: q
    };
  }

  /**
   * Retrieve supported Android models, OS versions, and locales from Firebase Test Lab
   */
  async getDeviceCatalog(options = {}) {
    const forceRefresh = options.forceRefresh || false;
    const now = Date.now();
    let catalog = this.cachedCatalog;

    if (!forceRefresh && catalog && (now - this.catalogCacheTime < this.catalogTtlMs)) {
      if (options.search) {
        return this.filterCatalog(catalog, options.search);
      }
      return catalog;
    }

    const projectId = options.projectId || this.defaultProjectId;
    const extraArgs = projectId ? [`--project=${projectId}`] : [];

    try {
      const [modelsRes, versionsRes, localesRes] = await Promise.all([
        this.execCli(['firebase', 'test', 'android', 'models', 'list', '--format=json', ...extraArgs]),
        this.execCli(['firebase', 'test', 'android', 'versions', 'list', '--format=json', ...extraArgs]),
        this.execCli(['firebase', 'test', 'android', 'locales', 'list', '--format=json', ...extraArgs]).catch(() => ({ stdout: '[]' }))
      ]);

      const rawModels = JSON.parse(modelsRes.stdout || '[]');
      const rawVersions = JSON.parse(versionsRes.stdout || '[]');
      const rawLocales = JSON.parse(localesRes.stdout || '[]');

      // Standardize versions
      const versions = rawVersions.map(v => ({
        id: String(v.id || v.apiLevel || ''),
        versionString: String(v.versionString || v.id || ''),
        codeName: v.codeName || '',
        apiLevel: v.apiLevel || parseInt(v.id, 10) || null,
        tags: Array.isArray(v.tags) ? v.tags : []
      })).sort((a, b) => (b.apiLevel || 0) - (a.apiLevel || 0));

      const versionMap = new Map(versions.map(v => [v.id, v]));

      // Index official device thumbnails for direct and variant resolution
      const nameToThumb = new Map();
      const baseIdToThumb = new Map();

      rawModels.forEach(m => {
        if (m.thumbnailUrl && typeof m.thumbnailUrl === 'string') {
          const normBrandName = `${(m.brand || '').toLowerCase().trim()} ${(m.name || '').toLowerCase().trim()}`;
          const plainName = (m.name || '').toLowerCase().trim();
          if (!nameToThumb.has(normBrandName)) nameToThumb.set(normBrandName, m.thumbnailUrl);
          if (!nameToThumb.has(plainName)) nameToThumb.set(plainName, m.thumbnailUrl);

          const cleanId = String(m.id || '').toLowerCase();
          const baseId = cleanId.replace(/(eea|tfn|sub|msq|ksx|xxx|sqw|ksw|naeea|ue|zh)+$/, '');
          if (baseId && baseId !== cleanId && !baseIdToThumb.has(baseId)) {
            baseIdToThumb.set(baseId, m.thumbnailUrl);
          }
          if (!baseIdToThumb.has(cleanId)) {
            baseIdToThumb.set(cleanId, m.thumbnailUrl);
          }
        }
      });

      // Standardize models and correlate with supported OS versions
      const models = rawModels.map(m => {
        const supportedVersionIds = (m.supportedVersionIds || []).map(String);

        // Resolve thumbnail URL: direct official URL > variant name match > base model ID match
        let resolvedThumbnail = m.thumbnailUrl || null;
        if (!resolvedThumbnail) {
          const normBrandName = `${(m.brand || '').toLowerCase().trim()} ${(m.name || '').toLowerCase().trim()}`;
          const plainName = (m.name || '').toLowerCase().trim();
          resolvedThumbnail = nameToThumb.get(normBrandName) || nameToThumb.get(plainName) || null;

          if (!resolvedThumbnail) {
            const cleanId = String(m.id || '').toLowerCase();
            for (const [base, thumb] of baseIdToThumb.entries()) {
              if (cleanId.startsWith(base)) {
                resolvedThumbnail = thumb;
                break;
              }
            }
          }
        }

        return {
          id: m.id,
          name: m.name || m.id,
          brand: m.brand || 'Google',
          form: (m.form || 'PHYSICAL').toUpperCase(),
          formFactor: (m.formFactor || 'PHONE').toUpperCase(),
          screenDensity: m.screenDensity || null,
          screenX: m.screenX || null,
          screenY: m.screenY || null,
          thumbnailUrl: resolvedThumbnail,
          supportedVersionIds,
          supportedVersions: supportedVersionIds.map(vid => versionMap.get(vid)).filter(Boolean),
          tags: Array.isArray(m.tags) ? m.tags : [],
          isDefault: Array.isArray(m.tags) && m.tags.includes('default'),
          isDeprecated: Array.isArray(m.tags) && m.tags.includes('deprecated')
        };
      }).sort((a, b) => {
        // Defaults first, then by brand and name
        if (a.isDefault && !b.isDefault) return -1;
        if (!a.isDefault && b.isDefault) return 1;
        return a.name.localeCompare(b.name);
      });

      // Standardize locales
      const locales = rawLocales.map(l => ({
        id: l.id,
        name: l.name || l.id,
        region: l.region || ''
      }));

      catalog = {
        models,
        versions,
        locales: locales.length > 0 ? locales : [{ id: 'en', name: 'English', region: 'United States' }],
        orientations: ['portrait', 'landscape'],
        fetchedAt: new Date().toISOString()
      };

      this.cachedCatalog = catalog;
      this.catalogCacheTime = now;

      if (options.search) {
        return this.filterCatalog(catalog, options.search);
      }
      return catalog;
    } catch (err) {
      logger.error(`[FirebaseTestLabProvider] Failed to fetch device catalog: ${err.message}`);
      throw new Error(`Failed to retrieve Firebase Test Lab device catalog: ${err.message}`);
    }
  }

  /**
   * Construct safe, non-shell command argument array for gcloud firebase test android run
   */
  buildCommandArgs(params) {
    const {
      appPath,
      devices,
      timeout,
      roboDirectives = [],
      roboScriptPath = null,
      resultsBucket = null,
      resultsDir = null,
      projectId = null
    } = params;

    if (!appPath || typeof appPath !== 'string') {
      throw new Error('Application build path is required.');
    }
    if (!fs.existsSync(appPath)) {
      throw new Error(`Application file does not exist at path: ${appPath}`);
    }

    const ext = path.extname(appPath).toLowerCase();
    if (ext !== '.apk' && ext !== '.aab') {
      throw new Error(`Invalid application format '${ext}'. Firebase Test Lab Robo test accepts .apk or .aab files.`);
    }

    if (!Array.isArray(devices) || devices.length === 0) {
      throw new Error('At least one device configuration must be specified for Firebase Test Lab.');
    }

    const args = [
      'firebase',
      'test',
      'android',
      'run',
      '--type=robo',
      `--app=${appPath}`
    ];

    // Append device dimensions: model, version, locale, orientation
    for (const d of devices) {
      if (!d.model || !d.version) {
        throw new Error('Device configuration must include model and version.');
      }
      const modelStr = String(d.model).trim();
      const versionStr = String(d.version).trim();
      const localeStr = String(d.locale || 'en_US').trim();

      if (!/^[a-zA-Z0-9_.-]+$/.test(modelStr)) {
        throw new Error(`Invalid characters in device model '${d.model}'. Only alphanumeric, dashes, dots, and underscores are permitted.`);
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(versionStr)) {
        throw new Error(`Invalid characters in OS version '${d.version}'. Only alphanumeric, dashes, dots, and underscores are permitted.`);
      }
      if (!/^[a-zA-Z0-9_.-]+$/.test(localeStr)) {
        throw new Error(`Invalid characters in locale '${d.locale}'.`);
      }

      const cleanOrientation = (d.orientation || 'portrait').toLowerCase() === 'landscape' ? 'landscape' : 'portrait';
      args.push(`--device=model=${modelStr},version=${versionStr},locale=${localeStr},orientation=${cleanOrientation}`);
    }

    // Timeout flag
    if (timeout) {
      const cleanTimeout = String(timeout).trim();
      if (!/^\d+[smh]$/.test(cleanTimeout)) {
        throw new Error(`Invalid timeout format '${timeout}'. Expected format like '10m', '300s', or '1h'.`);
      }
      args.push(`--timeout=${cleanTimeout}`);
    }

    // Robo directives: type:resource_name=text
    if (Array.isArray(roboDirectives) && roboDirectives.length > 0) {
      const directiveStrings = [];
      for (const dir of roboDirectives) {
        if (!dir.type || !dir.resourceName) continue;
        const validTypes = ['text', 'click', 'ignore'];
        const type = validTypes.includes(dir.type.toLowerCase()) ? dir.type.toLowerCase() : 'text';
        const resName = String(dir.resourceName).replace(/[=,\s]/g, '');
        const val = type === 'text' ? String(dir.text || '').replace(/[=,\n\r]/g, '') : '';
        directiveStrings.push(`${type}:${resName}=${val}`);
      }
      if (directiveStrings.length > 0) {
        args.push(`--robo-directives=${directiveStrings.join(',')}`);
      }
    }

    // Optional Robo script
    if (roboScriptPath && fs.existsSync(roboScriptPath)) {
      args.push(`--robo-script=${roboScriptPath}`);
    }

    // Results bucket
    const bucket = resultsBucket || config.FIREBASE_RESULTS_BUCKET;
    if (bucket) {
      args.push(`--results-bucket=${bucket.replace(/[^a-zA-Z0-9_.-]/g, '')}`);
    }

    if (resultsDir) {
      args.push(`--results-dir=${resultsDir.replace(/[^a-zA-Z0-9_.-]/g, '')}`);
    }

    // Target project ID
    const proj = projectId || this.defaultProjectId;
    if (proj) {
      args.push(`--project=${proj.replace(/[^a-zA-Z0-9_.-]/g, '')}`);
    }

    return args;
  }

  /**
   * Parse Matrix ID from gcloud output stream
   */
  parseMatrixId(output) {
    if (!output) return null;
    const cleanOutput = stripAnsi(output);
    const match = cleanOutput.match(MATRIX_ID_REGEX);
    if (match && match[1]) {
      const rawId = match[1].replace(/[.,;:)>\]'"]+$/, '').trim();
      if (/^[a-zA-Z0-9_-]+$/.test(rawId)) {
        return rawId.startsWith('matrix-') ? rawId : `matrix-${rawId}`;
      }
    }
    return null;
  }

  /**
   * Parse Firebase Console Results URL from gcloud output stream
   */
  parseResultsUrl(output, projectId = null, matrixId = null) {
    if (output) {
      const cleanOutput = stripAnsi(output);
      const match = cleanOutput.match(FIREBASE_CONSOLE_URL_REGEX);
      if (match && match[1]) {
        const candidate = match[1].replace(/[.,;:)>\]'"]+$/, '').trim();
        if (isValidFirebaseResultsUrl(candidate)) {
          return candidate;
        }
      }
    }
    // Fallback: If matrixId and projectId are valid, construct standard canonical console link
    const proj = projectId || this.defaultProjectId;
    if (proj && matrixId && /^[a-zA-Z0-9_.-]+$/.test(proj) && /^[a-zA-Z0-9_.-]+$/.test(matrixId)) {
      const cleanMatrixId = matrixId.startsWith('matrix-') ? matrixId : `matrix-${matrixId}`;
      return `https://console.firebase.google.com/project/${proj}/testlab/histories/default/matrices/${cleanMatrixId}`;
    }
    return null;
  }

  /**
   * Parse GCS Storage bucket link from gcloud output stream
   */
  parseGcsUrl(output) {
    if (!output) return null;
    const cleanOutput = stripAnsi(output);
    const match = cleanOutput.match(GCS_RESULTS_URL_REGEX);
    if (match && match[1]) {
      const candidate = match[1].replace(/[.,;:)>\]'"]+$/, '').trim();
      try {
        const parsed = new URL(candidate);
        if (parsed.protocol === 'https:' && 
            (parsed.hostname === 'console.cloud.google.com' || parsed.hostname === 'console.developers.google.com')) {
          return candidate;
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Start a real Firebase Robo Test execution asynchronously via spawned child process
   */
  startRoboTest(params, callbacks = {}) {
    const { onLog, onMatrixDiscovered, onFinished } = callbacks;
    const args = this.buildCommandArgs(params);
    const projectId = params.projectId || this.defaultProjectId;

    logger.info(`[FirebaseTestLabProvider] Spawning test command: ${this.gcloudPath} ${args.join(' ')}`);

    let matrixId = null;
    let resultsUrl = null;
    let gcsUrl = null;
    let isTerminated = false;
    let spawnCmd = this.gcloudPath;
    let spawnArgs = args;
    const env = { ...getResolvedEnvironment() };

    if (process.platform === 'win32' && !this.gcloudPath.endsWith('.exe')) {
      spawnCmd = process.env.ComSpec || 'cmd.exe';
      spawnArgs = ['/d', '/s', '/c', this.gcloudPath, ...args];
    }

    const child = spawn(spawnCmd, spawnArgs, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env
    });

    const handleChunk = (chunk, streamName) => {
      const rawText = chunk.toString('utf8');
      const sanitizedText = redactSecrets(rawText);

      // Extract Matrix ID as soon as it appears
      if (!matrixId) {
        const foundMatrix = this.parseMatrixId(rawText);
        if (foundMatrix) {
          matrixId = foundMatrix;
          resultsUrl = this.parseResultsUrl(rawText, projectId, matrixId);
          if (onMatrixDiscovered) {
            onMatrixDiscovered({ matrixId, resultsUrl });
          }
        }
      }

      // Extract Results URL if not yet found
      if (!resultsUrl) {
        const foundUrl = this.parseResultsUrl(rawText, projectId, matrixId);
        if (foundUrl) {
          resultsUrl = foundUrl;
          if (onMatrixDiscovered && matrixId) {
            onMatrixDiscovered({ matrixId, resultsUrl });
          }
        }
      }

      // Extract GCS URL
      if (!gcsUrl) {
        gcsUrl = this.parseGcsUrl(rawText);
      }

      if (onLog) {
        onLog(sanitizedText, streamName);
      }
    };

    child.stdout.on('data', chunk => handleChunk(chunk, 'stdout'));
    child.stderr.on('data', chunk => handleChunk(chunk, 'stderr'));

    const executionPromise = new Promise((resolve) => {
      child.on('error', (err) => {
        logger.error(`[FirebaseTestLabProvider] Process spawn error: ${err.message}`);
        resolve({
          exitCode: 1,
          matrixId,
          resultsUrl: resultsUrl || this.parseResultsUrl(null, projectId, matrixId),
          gcsUrl,
          status: 'FAILED',
          outcome: 'SPAWN_ERROR',
          error: `Failed to spawn Google Cloud CLI: ${err.message}`
        });
      });

      child.on('close', (code, signal) => {
        const { status, outcome, error } = mapExitCode(code, signal, isTerminated);
        const finalResultsUrl = resultsUrl || this.parseResultsUrl(null, projectId, matrixId);

        const result = {
          exitCode: code,
          signal,
          matrixId,
          resultsUrl: finalResultsUrl,
          gcsUrl,
          status,
          outcome,
          error
        };

        if (onFinished) {
          onFinished(result);
        }

        resolve(result);
      });
    });

    return {
      pid: child.pid,
      cancel: () => {
        isTerminated = true;
        if (child && !child.killed) {
          try {
            if (process.platform === 'win32') {
              // On Windows, kill process tree cleanly
              spawn('taskkill', ['/pid', child.pid.toString(), '/T', '/F']);
            } else {
              child.kill('SIGINT');
            }
          } catch (e) {
            logger.warn(`[FirebaseTestLabProvider] Error terminating process ${child.pid}: ${e.message}`);
          }
        }
      },
      promise: executionPromise
    };
  }
}

module.exports = new FirebaseTestLabProvider();
module.exports.FirebaseTestLabProvider = FirebaseTestLabProvider;
module.exports.redactSecrets = redactSecrets;
module.exports.stripAnsi = stripAnsi;
module.exports.isValidFirebaseResultsUrl = isValidFirebaseResultsUrl;
module.exports.mapExitCode = mapExitCode;

