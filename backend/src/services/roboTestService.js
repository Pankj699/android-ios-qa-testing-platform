const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');
const firebaseTestLabProvider = require('./providers/firebaseTestLabProvider');
const { broadcastEvent } = require('../websocket/testSocket');

class RoboTestService {
  constructor() {
    this.historyFile = path.join(config.DATA_DIR, 'robo-test-history.json');
    this.activeJobs = new Map(); // jobId -> { job, processHandle }
    this.writeLock = Promise.resolve();
    this.init();
    this.recoverInterruptedJobs();
  }

  init() {
    if (!fs.existsSync(config.DATA_DIR)) {
      fs.mkdirSync(config.DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(config.LOG_DIR)) {
      fs.mkdirSync(config.LOG_DIR, { recursive: true });
    }
    if (!fs.existsSync(this.historyFile)) {
      fs.writeFileSync(this.historyFile, JSON.stringify([], null, 2), 'utf8');
    }
  }

  /**
   * Concurrency-safe atomic file persistence for test history
   */
  async _persistHistory(history) {
    this.writeLock = this.writeLock.then(async () => {
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const tempPath = `${this.historyFile}.tmp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      try {
        fs.writeFileSync(tempPath, JSON.stringify(history, null, 2), 'utf8');
        fs.renameSync(tempPath, this.historyFile);
      } catch (err) {
        logger.error(`[RoboTestService] Atomic history persistence failed: ${err.message}`);
        if (fs.existsSync(tempPath)) {
          try { fs.unlinkSync(tempPath); } catch (_) {}
        }
      }
    });
    return this.writeLock;
  }

  /**
   * Reads history with corruption recovery
   */
  _readHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const raw = fs.readFileSync(this.historyFile, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed;
        }
      }
    } catch (err) {
      logger.error(`[RoboTestService] History corrupted, backing up and resetting: ${err.message}`);
      try {
        const backupPath = `${this.historyFile}.corrupt-${Date.now()}`;
        fs.renameSync(this.historyFile, backupPath);
        fs.writeFileSync(this.historyFile, JSON.stringify([], null, 2), 'utf8');
      } catch (_) {}
    }
    return [];
  }

  /**
   * On server startup: marks any unresolved jobs as INTERRUPTED (never falsely report success)
   * Distinguishes remote matrices already submitted to Google Cloud from local process terminations prior to creation.
   */
  async recoverInterruptedJobs() {
    const history = this._readHistory();
    let updated = false;
    const now = new Date().toISOString();

    for (const job of history) {
      if (job.status === 'RUNNING' || job.status === 'QUEUED') {
        job.status = 'INTERRUPTED';
        if (job.matrixId) {
          job.outcome = 'REMOTE_EXECUTION_UNKNOWN';
          job.error = `Test matrix was submitted to Google Cloud (Matrix ID: ${job.matrixId}), but local process monitoring was interrupted by backend server restart. Check the Firebase Console report to verify final remote results.`;
          if (!job.resultsUrl && job.projectId) {
            job.resultsUrl = firebaseTestLabProvider.parseResultsUrl(null, job.projectId, job.matrixId);
          }
        } else {
          job.outcome = 'PROCESS_INTERRUPTED';
          job.error = 'Test execution was interrupted by backend server restart prior to test matrix creation.';
        }
        job.finishedAt = now;
        job.updatedAt = now;
        updated = true;
      }
    }

    if (updated) {
      await this._persistHistory(history);
      logger.warn('[RoboTestService] Recovered and reconciled unresolved jobs from previous server run.');
    }
  }

  /**
   * Diagnostic environment check
   */
  async getEnvironment() {
    return firebaseTestLabProvider.checkEnvironment();
  }

  /**
   * Retrieve Google Firebase Test Lab device catalog
   */
  async getDeviceCatalog(options = {}) {
    return firebaseTestLabProvider.getDeviceCatalog(options);
  }

  /**
   * Launch a Robo Test asynchronously
   */
  async startRoboTest(params) {
    const {
      appPath,
      appName = 'Android Application',
      buildId = null,
      devices,
      timeout = '15m',
      testLabel = '',
      roboDirectives = [],
      user
    } = params;

    if (!user || !user.id) {
      throw new Error('Authenticated user required to launch Robo test.');
    }

    if (!appPath || !fs.existsSync(appPath)) {
      throw new Error(`Application binary not found at path: ${appPath}`);
    }

    if (!Array.isArray(devices) || devices.length === 0) {
      throw new Error('At least one device configuration is required.');
    }

    // Duplicate submission prevention: check if same build + devices submitted in past 15 seconds
    const nowMs = Date.now();
    for (const [, active] of this.activeJobs.entries()) {
      if (active.job.userId === user.id && active.job.appPath === appPath) {
        const timeDiff = nowMs - new Date(active.job.createdAt).getTime();
        if (timeDiff < 15000) {
          throw new Error('A test with this build was just submitted. Please wait a moment before submitting again.');
        }
      }
    }

    // Verify environment readiness before launching
    const envDiag = await this.getEnvironment();
    if (!envDiag.ready) {
      throw new Error(`Firebase Test Lab is not ready: ${envDiag.message}`);
    }

    const jobId = `robo-${uuidv4()}`;
    const logFilePath = path.join(config.LOG_DIR, `robo-test-${jobId}.log`);
    const logStream = fs.createWriteStream(logFilePath, { flags: 'a', encoding: 'utf8' });

    const job = {
      id: jobId,
      userId: user.id,
      userName: user.name || user.email || 'Tester',
      testLabel: testLabel ? testLabel.trim() : `${path.basename(appPath)} Robo Run`,
      appPath,
      appName,
      buildId,
      filename: path.basename(appPath),
      fileSize: fs.statSync(appPath).size,
      format: path.extname(appPath).toLowerCase() === '.aab' ? 'aab' : 'apk',
      devices,
      timeout,
      roboDirectives,
      status: 'QUEUED',
      outcome: 'PENDING',
      matrixId: null,
      resultsUrl: null,
      gcsUrl: null,
      projectId: envDiag.projectId || config.FIREBASE_PROJECT_ID,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      updatedAt: new Date().toISOString()
    };

    // Save initial queued state to persistent store
    const history = this._readHistory();
    history.unshift(job);
    await this._persistHistory(history);

    // Broadcast queued state
    this._broadcastJobUpdate(job);

    // Start background execution
    job.status = 'RUNNING';
    job.startedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
    await this._updateJobInHistory(job);
    this._broadcastJobUpdate(job);

    const logLine = (msg) => {
      const line = `[${new Date().toISOString()}] ${msg}\n`;
      try { logStream.write(line); } catch (_) {}
    };

    logLine(`Starting Firebase Test Lab Robo Test: ${job.testLabel}`);
    logLine(`Target Project: ${job.projectId}`);
    logLine(`Target Devices: ${devices.map(d => `${d.model} (API ${d.version}, ${d.orientation || 'portrait'})`).join(', ')}`);

    const processHandle = firebaseTestLabProvider.startRoboTest({
      appPath,
      devices,
      timeout,
      roboDirectives,
      projectId: job.projectId
    }, {
      onLog: (text, streamName) => {
        try { logStream.write(text); } catch (_) {}
      },
      onMatrixDiscovered: ({ matrixId, resultsUrl }) => {
        logLine(`Firebase Matrix discovered: ${matrixId}`);
        if (resultsUrl) logLine(`Firebase Console URL: ${resultsUrl}`);
        job.matrixId = matrixId;
        job.resultsUrl = resultsUrl;
        job.updatedAt = new Date().toISOString();
        this._updateJobInHistory(job);
        this._broadcastJobUpdate(job);
      },
      onFinished: (result) => {
        logLine(`Execution completed with exit code ${result.exitCode}. Final status: ${result.status}`);
        job.status = result.status;
        job.outcome = result.outcome;
        job.error = result.error;
        job.matrixId = result.matrixId || job.matrixId;
        job.resultsUrl = result.resultsUrl || job.resultsUrl;
        job.gcsUrl = result.gcsUrl || job.gcsUrl;
        job.finishedAt = new Date().toISOString();
        job.updatedAt = new Date().toISOString();
        
        try { logStream.end(); } catch (_) {}
        this.activeJobs.delete(jobId);
        this._updateJobInHistory(job);
        this._broadcastJobUpdate(job);
      }
    });

    this.activeJobs.set(jobId, { job, processHandle });

    return job;
  }

  /**
   * Broadcast real-time job updates over WebSocket
   */
  _broadcastJobUpdate(job) {
    try {
      broadcastEvent('ROBO_TEST_STATUS_UPDATED', {
        id: job.id,
        userId: job.userId,
        status: job.status,
        outcome: job.outcome,
        matrixId: job.matrixId,
        resultsUrl: job.resultsUrl,
        error: job.error,
        updatedAt: job.updatedAt
      });
    } catch (e) {
      logger.debug(`[RoboTestService] WebSocket broadcast skipped: ${e.message}`);
    }
  }

  /**
   * Update single job in persistent history
   */
  async _updateJobInHistory(updatedJob) {
    const history = this._readHistory();
    const idx = history.findIndex(j => j.id === updatedJob.id);
    if (idx >= 0) {
      history[idx] = { ...history[idx], ...updatedJob };
      await this._persistHistory(history);
    }
  }

  /**
   * List jobs with user ownership isolation (admins see all)
   */
  getJobs(filters = {}, user) {
    const history = this._readHistory();
    const isAdmin = user?.role === 'ADMIN';

    let list = history;
    // Strict isolation: non-admins only see their own jobs
    if (!isAdmin) {
      list = list.filter(j => j.userId === user?.id);
    } else if (filters.userId) {
      list = list.filter(j => j.userId === filters.userId);
    }

    if (filters.status && filters.status !== 'ALL') {
      list = list.filter(j => j.status === filters.status);
    }

    if (filters.search) {
      const q = filters.search.toLowerCase().trim();
      list = list.filter(j => 
        (j.testLabel && j.testLabel.toLowerCase().includes(q)) ||
        (j.filename && j.filename.toLowerCase().includes(q)) ||
        (j.matrixId && j.matrixId.toLowerCase().includes(q)) ||
        (j.appName && j.appName.toLowerCase().includes(q))
      );
    }

    return list.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  /**
   * Get single job by ID with authorization check
   */
  getJobById(id, user) {
    const history = this._readHistory();
    const job = history.find(j => j.id === id);
    if (!job) return null;

    const isAdmin = user?.role === 'ADMIN';
    if (!isAdmin && job.userId !== user?.id) {
      const err = new Error('Unauthorized to view this test job.');
      err.status = 403;
      throw err;
    }
    return job;
  }

  /**
   * Get job execution logs
   */
  getJobLogs(id, user) {
    const job = this.getJobById(id, user);
    if (!job) return '';

    const logPath = path.join(config.LOG_DIR, `robo-test-${id}.log`);
    if (fs.existsSync(logPath)) {
      return fs.readFileSync(logPath, 'utf8');
    }
    return '';
  }

  /**
   * Cancel an in-progress job
   */
  async cancelJob(id, user) {
    const job = this.getJobById(id, user);
    if (!job) {
      throw new Error(`Job '${id}' not found.`);
    }

    if (job.status !== 'RUNNING' && job.status !== 'QUEUED') {
      return job;
    }

    const active = this.activeJobs.get(id);
    if (active && active.processHandle && typeof active.processHandle.cancel === 'function') {
      active.processHandle.cancel();
    }

    job.status = 'CANCELLED';
    job.outcome = 'CANCELLED';
    job.error = 'Test execution was cancelled by user.';
    job.finishedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();

    this.activeJobs.delete(id);
    await this._updateJobInHistory(job);
    this._broadcastJobUpdate(job);

    return job;
  }

  /**
   * Delete historical job record and associated log file
   */
  async deleteJob(id, user) {
    const job = this.getJobById(id, user);
    if (!job) return false;

    if (job.status === 'RUNNING' || job.status === 'QUEUED') {
      const err = new Error('Cannot delete an active test job. Please cancel it first.');
      err.status = 400;
      throw err;
    }

    const history = this._readHistory();
    const filtered = history.filter(j => j.id !== id);
    await this._persistHistory(filtered);

    // Delete log file
    const logPath = path.join(config.LOG_DIR, `robo-test-${id}.log`);
    if (fs.existsSync(logPath)) {
      try { fs.unlinkSync(logPath); } catch (_) {}
    }

    // Cleanup uploaded build file if not referenced by any other job
    if (job.appPath && fs.existsSync(job.appPath) && job.appPath.includes('/robo/')) {
      const isShared = filtered.some(j => j.appPath === job.appPath);
      if (!isShared) {
        try { fs.unlinkSync(job.appPath); } catch (_) {}
      }
    }

    return true;
  }
}

module.exports = new RoboTestService();
module.exports.RoboTestService = RoboTestService;
