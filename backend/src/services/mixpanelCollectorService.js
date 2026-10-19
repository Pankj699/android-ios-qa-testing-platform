const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const logger = require('../utils/logger');
const deviceLockService = require('./deviceLockService');
const adbService = require('./adbService');
const { validateEvent } = require('./mixpanelValidationEngine');

class MixpanelCollectorService {
  constructor() {
    this.activePollers = new Map(); // sessionId -> timer handle
    this.activeStreams = new Map(); // sessionId -> { process, pendingEvent, pendingTimer, sessionStartedAtMs, serial, stdoutBuffer }
    this.captureLocks = new Map(); // canonicalSerial -> { sessionId, userId, userName, userEmail, startedAt }
    this._startingLocks = new Set(); // canonicalSerial (in-flight atomic mutex)
    this.pollingInFlight = new Set(); // sessionId set to prevent overlapping polls
    this._saveDiskTimer = null;
  }

  /**
   * Resolve physical/canonical serial across hardwareMap and wireless bare IPs.
   */
  _getCanonicalSerial(deviceSerial) {
    if (!deviceSerial) return '';
    try {
      const hwSerial = deviceLockService.hardwareMap?.get(deviceSerial);
      if (hwSerial) return hwSerial;
    } catch (e) {}
    if (deviceSerial.includes(':')) {
      const bare = deviceSerial.split(':')[0];
      if (bare) return bare;
    }
    return deviceSerial;
  }

  /**
   * Check if device currently has an active exclusive capture lock (memory + database).
   */
  async isDeviceCaptureLocked(deviceSerial) {
    const canonical = this._getCanonicalSerial(deviceSerial);
    if (!canonical) return null;

    if (this.captureLocks.has(canonical)) {
      return this.captureLocks.get(canonical);
    }

    try {
      const dbRes = await db.query(
        `SELECT s.id, s.user_id, s.device_serial, s.started_at, u.name as user_name, u.email as user_email
         FROM mixpanel_sessions s
         LEFT JOIN users u ON s.user_id = u.id
         WHERE (s.device_serial = $1 OR s.device_serial = $2) AND s.status = 'ACTIVE'
         LIMIT 1`,
        [deviceSerial, canonical]
      );

      if (dbRes.rows.length > 0) {
        const row = dbRes.rows[0];
        const lockData = {
          sessionId: row.id,
          userId: row.user_id,
          userName: row.user_name || 'Another user',
          userEmail: row.user_email || '',
          startedAt: row.started_at
        };
        this.captureLocks.set(canonical, lockData);
        return lockData;
      }
    } catch (err) {
      logger.debug(`[MixpanelCollector] DB query for capture lock error: ${err.message}`);
    }

    return null;
  }

  /**
   * Safely release exclusive capture lock for a device serial or session.
   */
  _releaseCaptureLock(deviceSerial, sessionId = null) {
    const canonical = this._getCanonicalSerial(deviceSerial);
    if (canonical && this.captureLocks.has(canonical)) {
      const existing = this.captureLocks.get(canonical);
      if (!sessionId || existing.sessionId === sessionId) {
        this.captureLocks.delete(canonical);
      }
    }
    if (sessionId) {
      for (const [key, lock] of this.captureLocks.entries()) {
        if (lock.sessionId === sessionId) {
          this.captureLocks.delete(key);
        }
      }
    }
  }

  /**
   * Handle physical device disconnect or unexpected child-process termination.
   */
  async handleDeviceDisconnect(serial) {
    if (!serial) return;
    const canonical = this._getCanonicalSerial(serial);

    // 1. Stop any active streaming process
    for (const [sessionId, state] of this.activeStreams.entries()) {
      if (state.serial === serial || state.serial === canonical) {
        logger.info(`[MixpanelCollector] Device ${serial} disconnected; stopping stream for session ${sessionId}`);
        this._stopAdbStreaming(sessionId);
      }
    }

    // 2. Identify and release capture lock
    const lock = this.captureLocks.get(canonical) || this.captureLocks.get(serial);
    const sessionId = lock?.sessionId;
    this._releaseCaptureLock(serial, sessionId);

    // 3. Mark active session as STOPPED due to disconnect
    if (sessionId) {
      try {
        await db.query(
          `UPDATE mixpanel_sessions
           SET status = 'STOPPED',
               stopped_at = NOW(),
               error_message = 'Device disconnected during capture session'
           WHERE id = $1 AND status = 'ACTIVE'`,
          [sessionId]
        );
      } catch (e) {
        logger.debug(`[MixpanelCollector] DB update error on disconnect: ${e.message}`);
      }
    }
  }

  /**
   * Reconcile stale locks against active DB sessions.
   */
  async reconcileStaleLocks() {
    try {
      const activeRes = await db.query("SELECT id, device_serial FROM mixpanel_sessions WHERE status = 'ACTIVE'");
      const activeSessionIds = new Set(activeRes.rows.map(r => r.id));

      for (const [canonical, lock] of this.captureLocks.entries()) {
        if (!activeSessionIds.has(lock.sessionId)) {
          logger.info(`[MixpanelCollector] Reconciling stale capture lock for device ${canonical} (session ${lock.sessionId} no longer active).`);
          this.captureLocks.delete(canonical);
        }
      }
    } catch (err) {
      logger.warn(`[MixpanelCollector] Error reconciling stale locks: ${err.message}`);
    }
  }

  /**
   * Debounced save to disk to prevent I/O thrashing during high event volume.
   */
  _requestSaveToDisk() {
    if (this._saveDiskTimer) return;
    this._saveDiskTimer = setTimeout(async () => {
      this._saveDiskTimer = null;
      if (typeof db.saveToDisk === 'function') {
        try {
          await db.saveToDisk();
        } catch (e) {}
      }
    }, 500);
    if (this._saveDiskTimer.unref) {
      this._saveDiskTimer.unref();
    }
  }

  /**
   * Parse timestamp from ADB logcat line (-v time format: "MM-DD HH:MM:SS.mmm").
   */
  _parseLogcatTime(line) {
    if (!line) return new Date();
    const match = line.match(/^(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?/);
    if (!match) return new Date();
    const [, month, day, hour, min, sec, ms] = match;
    const now = new Date();
    return new Date(
      now.getFullYear(),
      parseInt(month, 10) - 1,
      parseInt(day, 10),
      parseInt(hour, 10),
      parseInt(min, 10),
      parseInt(sec, 10),
      ms ? parseInt(ms, 10) : 0
    );
  }

  /**
   * Check whether live Mixpanel API credentials or ADB stream are fully configured.
   */
  isConfigured() {
    const hasSecret = Boolean(
      config.MIXPANEL_SERVICE_ACCOUNT_SECRET || config.MIXPANEL_API_SECRET
    );
    const hasProject = Boolean(config.MIXPANEL_PROJECT_ID);

    return {
      enabled: config.MIXPANEL_VALIDATOR_ENABLED,
      configured: hasSecret && hasProject,
      captureMode: (hasSecret && hasProject) ? 'HYBRID_MIXPANEL_AND_ADB' : 'REALTIME_ADB_STREAM',
      projectId: config.MIXPANEL_PROJECT_ID || null,
      region: config.MIXPANEL_REGION || 'US',
      hasServiceAccount: Boolean(config.MIXPANEL_SERVICE_ACCOUNT_USERNAME && config.MIXPANEL_SERVICE_ACCOUNT_SECRET),
      hasApiSecret: Boolean(config.MIXPANEL_API_SECRET)
    };
  }

  /**
   * Generate basic auth header for Mixpanel API.
   */
  _getAuthHeader() {
    if (config.MIXPANEL_SERVICE_ACCOUNT_USERNAME && config.MIXPANEL_SERVICE_ACCOUNT_SECRET) {
      const credentials = `${config.MIXPANEL_SERVICE_ACCOUNT_USERNAME}:${config.MIXPANEL_SERVICE_ACCOUNT_SECRET}`;
      return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    if (config.MIXPANEL_API_SECRET) {
      const credentials = `${config.MIXPANEL_API_SECRET}:`;
      return `Basic ${Buffer.from(credentials).toString('base64')}`;
    }
    return null;
  }

  /**
   * Get Mixpanel Export API base URL based on configured region.
   */
  _getExportBaseUrl() {
    const region = (config.MIXPANEL_REGION || 'US').toUpperCase();
    return region === 'EU'
      ? 'https://data-eu.mixpanel.com/api/2.0/export'
      : 'https://data.mixpanel.com/api/2.0/export';
  }

  /**
   * Start a new capture session for a user on a given device with exclusive capture locking.
   */
  async startSession({ user, deviceSerial, deviceName = null, specId = null, distinctId = null, projectId = null }) {
    if (!user || !user.id) {
      throw new Error('Authentication required to start a capture session.');
    }
    if (!deviceSerial) {
      throw new Error('Device serial is required.');
    }

    // 1. Verify multi-user device ownership / accessibility
    const accessible = deviceLockService.isDeviceAccessible(deviceSerial, user);
    if (!accessible) {
      const error = new Error(`Access denied: Device ${deviceSerial} is owned by another user.`);
      error.statusCode = 403;
      throw error;
    }

    const canonical = this._getCanonicalSerial(deviceSerial);

    // 2. In-flight atomic lock check (prevents concurrent race conditions)
    if (this._startingLocks.has(canonical)) {
      const error = new Error(`Conflict: Device ${deviceSerial} is currently being acquired by another capture session request.`);
      error.statusCode = 409;
      error.code = 'CAPTURE_DEVICE_CONFLICT';
      throw error;
    }

    // 3. Existing active capture session check (memory + database)
    const existingLock = await this.isDeviceCaptureLocked(deviceSerial);
    if (existingLock) {
      const isSelf = existingLock.userId === user.id;
      const holderName = isSelf ? 'You already have' : `${existingLock.userName || 'Another user'} has`;
      const error = new Error(`Conflict: ${holderName} an active capture session on device ${deviceSerial} (session: ${existingLock.sessionId}).`);
      error.statusCode = 409;
      error.code = 'CAPTURE_DEVICE_CONFLICT';
      throw error;
    }

    // Atomically claim starting lock before any asynchronous boundary
    this._startingLocks.add(canonical);

    try {

      // 4. Verify specification existence and ownership if provided
      let specVersion = 1;
      let specRules = [];
      if (specId) {
        const specRes = await db.query(
          'SELECT id, user_id, version, rules FROM mixpanel_specifications WHERE id = $1',
          [specId]
        );
        if (specRes.rows.length === 0) {
          const error = new Error('Selected specification not found.');
          error.statusCode = 404;
          throw error;
        }
        const spec = specRes.rows[0];
        if (user.role !== 'ADMIN' && spec.user_id !== user.id) {
          const error = new Error('Access denied to the selected specification.');
          error.statusCode = 403;
          throw error;
        }
        specVersion = spec.version || 1;
        specRules = Array.isArray(spec.rules) ? spec.rules : [];
      }

      const effectiveProjectId = projectId || config.MIXPANEL_PROJECT_ID || null;

      // 5. Create session record
      const insertRes = await db.query(
        `INSERT INTO mixpanel_sessions (
          user_id, device_serial, device_name, spec_id, spec_version,
          status, distinct_id, project_id, started_at, last_polled_at, events_count
        ) VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7, NOW(), NOW(), 0)
        RETURNING *`,
        [
          user.id,
          deviceSerial,
          deviceName || deviceSerial,
          specId,
          specVersion,
          distinctId ? distinctId.trim() : null,
          effectiveProjectId
        ]
      );

      const session = insertRes.rows[0];

      // 6. Register active capture lock in memory
      this.captureLocks.set(canonical, {
        sessionId: session.id,
        userId: user.id,
        userName: user.name || 'QA Tester',
        userEmail: user.email || '',
        startedAt: session.started_at
      });

      logger.info(`[MixpanelCollector] Started session ${session.id} for user ${user.id} on device ${deviceSerial} (exclusive lock acquired on ${canonical})`);

      // Persist DB state
      if (typeof db.saveToDisk === 'function') {
        await db.saveToDisk();
      }

      // Start background incremental polling if configured
      this._schedulePolling(session.id);

      // Start real-time ADB logcat streaming & buffer catchup on the device
      await this._startAdbStreaming(session);

      return session;
    } catch (startupErr) {
      // Reconcile/release lock if session startup failed
      this._releaseCaptureLock(canonical);
      throw startupErr;
    } finally {
      this._startingLocks.delete(canonical);
    }
  }

  /**
   * Stop an active session and release its exclusive capture lock.
   */
  async stopSession(sessionId, user) {
    if (!sessionId) throw new Error('Session ID is required.');

    const sessionRes = await db.query('SELECT * FROM mixpanel_sessions WHERE id = $1', [sessionId]);
    if (sessionRes.rows.length === 0) {
      const error = new Error('Session not found.');
      error.statusCode = 404;
      throw error;
    }

    const session = sessionRes.rows[0];
    if (user && user.role !== 'ADMIN' && session.user_id !== user.id) {
      const error = new Error('Access denied to session.');
      error.statusCode = 403;
      throw error;
    }

    // Release exclusive capture lock
    this._releaseCaptureLock(session.device_serial, sessionId);

    // Clear any polling timer
    this._stopPolling(sessionId);

    // Stop active ADB logcat streaming
    this._stopAdbStreaming(sessionId);

    const updateRes = await db.query(
      `UPDATE mixpanel_sessions
       SET status = 'STOPPED', stopped_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [sessionId]
    );

    if (typeof db.saveToDisk === 'function') {
      await db.saveToDisk();
    }

    logger.info(`[MixpanelCollector] Stopped session ${sessionId} (released capture lock for ${session.device_serial})`);
    return updateRes.rows[0];
  }

  /**
   * Check if device is currently online and attached via ADB.
   */
  async _isDeviceOnline(serial) {
    if (!serial) return false;
    try {
      const res = await adbService.execute(['-s', serial, 'get-state'], { timeout: 1500 });
      return res.code === 0 && res.stdout.trim() === 'device';
    } catch (e) {
      return false;
    }
  }

  /**
   * Start ADB streaming and buffer catchup for a session.
   */
  async _startAdbStreaming(session) {
    if (!session || !session.device_serial) return;
    this._stopAdbStreaming(session.id);

    const isOnline = await this._isDeviceOnline(session.device_serial);
    if (!isOnline) {
      logger.debug(`[MixpanelCollector] Device ${session.device_serial} is not connected via ADB; skipping logcat capture.`);
      return;
    }

    const state = {
      process: null,
      pendingEvent: null,
      pendingTimer: null,
      sessionStartedAtMs: session.started_at
        ? new Date(session.started_at).getTime() - 15000
        : Date.now() - 15000,
      serial: session.device_serial,
      stdoutBuffer: ''
    };

    this.activeStreams.set(session.id, state);

    // 1. First run catchup to ingest any buffered events that occurred since started_at
    await this._catchupAdbEvents(session).catch(err => {
      logger.debug(`[MixpanelCollector] Catchup warning for ${session.device_serial}: ${err.message}`);
    });

    // 2. Spawn continuous ADB logcat stream
    try {
      const tags = ['AnalyticsManager', 'MixpanelAPI', 'Mixpanel'];
      const proc = adbService.streamLogcat(session.device_serial, tags);
      state.process = proc;

      proc.stdout.on('data', (chunk) => {
        state.stdoutBuffer += chunk.toString('utf8');
        const lines = state.stdoutBuffer.split(/\r?\n/);
        state.stdoutBuffer = lines.pop(); // Retain incomplete line
        for (const line of lines) {
          if (line.trim()) {
            this._handleLogcatLine(session, line, state);
          }
        }
      });

      proc.stderr.on('data', () => {});

      proc.on('error', (err) => {
        logger.debug(`[MixpanelCollector] ADB stream process error (${session.device_serial}): ${err.message}`);
      });

      proc.on('exit', (code, signal) => {
        logger.debug(`[MixpanelCollector] ADB stream exited (${session.device_serial}) with code ${code}, signal ${signal}`);
      });
    } catch (err) {
      logger.debug(`[MixpanelCollector] Could not start ADB stream for ${session.device_serial}: ${err.message}`);
    }
  }

  /**
   * Read recent logcat buffer from the device and catch up events that occurred since session started.
   */
  async _catchupAdbEvents(session) {
    try {
      const args = [
        '-s', session.device_serial,
        'logcat', '-d', '-v', 'time',
        'AnalyticsManager:V', 'MixpanelAPI:V', 'Mixpanel:V', '*:S'
      ];
      const stdout = await adbService.execute(args, { maxBuffer: 10 * 1024 * 1024 });
      if (!stdout || typeof stdout !== 'string') return;

      const lines = stdout.split(/\r?\n/);
      const sessionStartedAtMs = session.started_at
        ? new Date(session.started_at).getTime() - 15000
        : Date.now() - 15000;

      let pending = null;
      const batchEvents = [];

      for (const line of lines) {
        if (!line.trim()) continue;
        const lineTime = this._parseLogcatTime(line);
        if (lineTime.getTime() < sessionStartedAtMs) continue;

        const nameMatch = line.match(/logMixPanelEvents\s*:>\s*MX\s*EventName\s*:\s*([^\r\n]+)/);
        if (nameMatch) {
          if (pending) {
            batchEvents.push(pending);
          }
          pending = {
            event: nameMatch[1].trim(),
            time: lineTime.toISOString(),
            properties: {}
          };
          continue;
        }

        const paramMatch = line.match(/logMixPanelEvents\s*MX\s*:>\s*Parameter\s*:\s*(\{.*\})/);
        if (paramMatch && pending) {
          try {
            pending.properties = JSON.parse(paramMatch[1]);
          } catch (e) {}
          batchEvents.push(pending);
          pending = null;
          continue;
        }

        const trackedMatch = line.match(/Tracked\s+event\s+([A-Za-z0-9_]+)(?:\s*:\s*(\{.*\}))?/);
        if (trackedMatch) {
          if (pending) {
            batchEvents.push(pending);
            pending = null;
          }
          let properties = {};
          if (trackedMatch[2]) {
            try {
              properties = JSON.parse(trackedMatch[2]);
            } catch (e) {}
          }
          batchEvents.push({
            event: trackedMatch[1],
            time: lineTime.toISOString(),
            properties
          });
        }
      }

      if (pending) {
        batchEvents.push(pending);
      }

      if (batchEvents.length > 0) {
        let specRules = [];
        if (session.spec_id) {
          const specRes = await db.query('SELECT rules FROM mixpanel_specifications WHERE id = $1', [session.spec_id]);
          if (specRes.rows.length > 0 && Array.isArray(specRes.rows[0].rules)) {
            specRules = specRes.rows[0].rules;
          }
        }

        let newInserted = 0;
        for (const ev of batchEvents) {
          const inserted = await this._processAndStoreEvent(session, ev, specRules, 'ADB_STREAM');
          if (inserted) newInserted++;
        }

        if (newInserted > 0) {
          await db.query(
            `UPDATE mixpanel_sessions
             SET last_polled_at = NOW(),
                 events_count = (SELECT COUNT(*) FROM mixpanel_events WHERE session_id = $1)
             WHERE id = $1`,
            [session.id]
          );
          this._requestSaveToDisk();
          logger.info(`[MixpanelCollector] Caught up ${newInserted} event(s) for session ${session.id} from device logcat.`);
        }
      }
    } catch (err) {
      logger.debug(`[MixpanelCollector] Catchup logcat query failed for ${session.device_serial}: ${err.message}`);
    }
  }

  /**
   * Handle single logcat line emitted by device stream.
   */
  _handleLogcatLine(session, line, state) {
    const lineTime = this._parseLogcatTime(line);
    if (lineTime.getTime() < state.sessionStartedAtMs) return;

    // Pattern 1: MX EventName
    const nameMatch = line.match(/logMixPanelEvents\s*:>\s*MX\s*EventName\s*:\s*([^\r\n]+)/);
    if (nameMatch) {
      if (state.pendingEvent) {
        const toDispatch = state.pendingEvent;
        state.pendingEvent = null;
        if (state.pendingTimer) clearTimeout(state.pendingTimer);
        this._dispatchPendingEvent(session, toDispatch).catch(() => {});
      }

      state.pendingEvent = {
        event: nameMatch[1].trim(),
        time: lineTime.toISOString(),
        properties: {}
      };

      state.pendingTimer = setTimeout(() => {
        if (state.pendingEvent) {
          const toDispatch = state.pendingEvent;
          state.pendingEvent = null;
          this._dispatchPendingEvent(session, toDispatch).catch(() => {});
        }
      }, 1500);
      if (state.pendingTimer.unref) {
        state.pendingTimer.unref();
      }
      return;
    }

    // Pattern 2: MX Parameter
    const paramMatch = line.match(/logMixPanelEvents\s*MX\s*:>\s*Parameter\s*:\s*(\{.*\})/);
    if (paramMatch && state.pendingEvent) {
      if (state.pendingTimer) clearTimeout(state.pendingTimer);
      try {
        state.pendingEvent.properties = JSON.parse(paramMatch[1]);
      } catch (e) {}
      const toDispatch = state.pendingEvent;
      state.pendingEvent = null;
      this._dispatchPendingEvent(session, toDispatch).catch(() => {});
      return;
    }

    // Pattern 3: Mixpanel tracked event
    const trackedMatch = line.match(/(?:Tracked|Queued)\s+event\s+([A-Za-z0-9_]+)(?:\s*:\s*(\{.*\}))?/);
    if (trackedMatch) {
      if (state.pendingEvent) {
        const toDispatch = state.pendingEvent;
        state.pendingEvent = null;
        if (state.pendingTimer) clearTimeout(state.pendingTimer);
        this._dispatchPendingEvent(session, toDispatch).catch(() => {});
      }
      let properties = {};
      if (trackedMatch[2]) {
        try {
          properties = JSON.parse(trackedMatch[2]);
        } catch (e) {}
      }
      this._dispatchPendingEvent(session, {
        event: trackedMatch[1],
        time: lineTime.toISOString(),
        properties
      }).catch(() => {});
      return;
    }
  }

  /**
   * Dispatch parsed real-time event to database and validation engine.
   */
  async _dispatchPendingEvent(session, eventPayload) {
    if (!eventPayload || !eventPayload.event) return;
    try {
      let specRules = [];
      if (session.spec_id) {
        const specRes = await db.query('SELECT rules FROM mixpanel_specifications WHERE id = $1', [session.spec_id]);
        if (specRes.rows.length > 0 && Array.isArray(specRes.rows[0].rules)) {
          specRules = specRes.rows[0].rules;
        }
      }

      const inserted = await this._processAndStoreEvent(session, eventPayload, specRules, 'ADB_STREAM');
      if (inserted) {
        await db.query(
          `UPDATE mixpanel_sessions
           SET last_polled_at = NOW(),
               events_count = (SELECT COUNT(*) FROM mixpanel_events WHERE session_id = $1)
           WHERE id = $1`,
          [session.id]
        );
        this._requestSaveToDisk();
        logger.info(`[MixpanelCollector] Real-time event "${eventPayload.event}" captured from device ${session.device_serial} in session ${session.id}`);
      }
    } catch (err) {
      logger.warn(`[MixpanelCollector] Error dispatching event for session ${session.id}: ${err.message}`);
    }
  }

  /**
   * Stop ADB streaming for a session.
   */
  _stopAdbStreaming(sessionId) {
    if (this.activeStreams.has(sessionId)) {
      const state = this.activeStreams.get(sessionId);
      if (state.pendingTimer) {
        clearTimeout(state.pendingTimer);
        state.pendingTimer = null;
      }
      if (state.process) {
        try {
          state.process.stdout.removeAllListeners();
          state.process.stderr.removeAllListeners();
          state.process.removeAllListeners();
          state.process.kill('SIGTERM');
        } catch (e) {}
        state.process = null;
      }
      this.activeStreams.delete(sessionId);
      logger.info(`[MixpanelCollector] Stopped ADB stream for session ${sessionId}`);
    }
  }

  /**
   * Resume any active capture sessions from database on server startup, registering locks and reconciling stale ones.
   */
  async resumeActiveSessions() {
    try {
      const activeRes = await db.query("SELECT * FROM mixpanel_sessions WHERE status = 'ACTIVE'");
      if (!activeRes || !Array.isArray(activeRes.rows) || activeRes.rows.length === 0) return;
      for (const session of activeRes.rows) {
        const canonical = this._getCanonicalSerial(session.device_serial);
        const isOnline = await this._isDeviceOnline(session.device_serial);
        if (isOnline) {
          this.captureLocks.set(canonical, {
            sessionId: session.id,
            userId: session.user_id,
            startedAt: session.started_at
          });
          logger.info(`[MixpanelCollector] Resuming active session ${session.id} on device ${session.device_serial} (lock registered on ${canonical})`);
          await this._startAdbStreaming(session);
          if (this._getAuthHeader() && session.project_id) {
            this._schedulePolling(session.id);
          }
        } else {
          logger.warn(`[MixpanelCollector] Active session ${session.id} on device ${session.device_serial} is not online on server restart. Stopping session to reconcile stale lock.`);
          await db.query(
            `UPDATE mixpanel_sessions
             SET status = 'STOPPED', stopped_at = NOW(),
                 error_message = 'Session stopped on server restart: Target device is not connected.'
             WHERE id = $1`,
            [session.id]
          );
          this._releaseCaptureLock(session.device_serial, session.id);
        }
      }
      if (typeof db.saveToDisk === 'function') {
        await db.saveToDisk();
      }
    } catch (err) {
      logger.warn(`[MixpanelCollector] Failed resuming active sessions: ${err.message}`);
    }
  }

  /**
   * Schedule polling loop for an active session.
   */
  _schedulePolling(sessionId) {
    this._stopPolling(sessionId);

    const interval = Math.max(1000, config.MIXPANEL_POLL_INTERVAL_MS || 3000);
    const timer = setInterval(() => {
      this.pollSession(sessionId).catch(err => {
        logger.warn(`[MixpanelCollector] Polling error in session ${sessionId}: ${err.message}`);
      });
    }, interval);

    this.activePollers.set(sessionId, timer);
  }

  /**
   * Stop polling loop for a session.
   */
  _stopPolling(sessionId) {
    if (this.activePollers.has(sessionId)) {
      clearInterval(this.activePollers.get(sessionId));
      this.activePollers.delete(sessionId);
    }
  }

  /**
   * Execute an incremental poll for a session against Mixpanel API.
   */
  async pollSession(sessionId) {
    if (this.pollingInFlight.has(sessionId)) return;

    this.pollingInFlight.add(sessionId);
    try {
      const sessionRes = await db.query('SELECT * FROM mixpanel_sessions WHERE id = $1', [sessionId]);
      if (sessionRes.rows.length === 0) {
        this._stopPolling(sessionId);
        return;
      }

      const session = sessionRes.rows[0];
      if (session.status !== 'ACTIVE') {
        this._stopPolling(sessionId);
        return;
      }

      const authHeader = this._getAuthHeader();
      if (!authHeader || !session.project_id) {
        // Not configured with live credentials; skip remote polling
        return;
      }

      // Fetch specification rules if session is linked to a spec
      let specRules = [];
      if (session.spec_id) {
        const specRes = await db.query('SELECT rules FROM mixpanel_specifications WHERE id = $1', [session.spec_id]);
        if (specRes.rows.length > 0 && Array.isArray(specRes.rows[0].rules)) {
          specRules = specRes.rows[0].rules;
        }
      }

      // Time range for Export API:
      // Mixpanel Export API uses dates: from_date and to_date (YYYY-MM-DD).
      const now = new Date();
      const startedAt = session.started_at ? new Date(session.started_at) : now;
      const fromDateStr = startedAt.toISOString().split('T')[0];
      const toDateStr = now.toISOString().split('T')[0];

      const url = new URL(this._getExportBaseUrl());
      url.searchParams.set('project_id', session.project_id);
      url.searchParams.set('from_date', fromDateStr);
      url.searchParams.set('to_date', toDateStr);

      if (session.distinct_id) {
        url.searchParams.set('where', `properties["distinct_id"] == "${session.distinct_id}"`);
      }

      const response = await fetch(url.toString(), {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(config.MIXPANEL_POLL_TIMEOUT_MS || 30000)
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        logger.warn(`[MixpanelCollector] Mixpanel export error HTTP ${response.status}: ${text}`);
        await db.query(
          `UPDATE mixpanel_sessions SET error_message = $1 WHERE id = $2`,
          [`Mixpanel API error HTTP ${response.status}: ${text.slice(0, 200)}`, sessionId]
        );
        return;
      }

      const rawText = await response.text();
      const lines = rawText.split('\n').filter(l => l.trim().length > 0);

      let newCount = 0;
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const inserted = await this._processAndStoreEvent(session, parsed, specRules, 'MIXPANEL_EXPORT');
          if (inserted) newCount++;
        } catch (e) {
          // ignore single line JSON parse error
        }
      }

      // Update session last_polled_at and events_count
      await db.query(
        `UPDATE mixpanel_sessions
         SET last_polled_at = NOW(),
             events_count = (SELECT COUNT(*) FROM mixpanel_events WHERE session_id = $1),
             error_message = NULL
         WHERE id = $1`,
        [sessionId]
      );

      if (newCount > 0 && typeof db.saveToDisk === 'function') {
        await db.saveToDisk();
      }
    } catch (err) {
      logger.warn(`[MixpanelCollector] Failed polling session ${sessionId}: ${err.message}`);
    } finally {
      this.pollingInFlight.delete(sessionId);
    }
  }

  /**
   * Process raw event object, validate, deduplicate, and store.
   */
  async _processAndStoreEvent(session, rawObj, specRules, source = 'ADB_STREAM') {
    const eventName = rawObj.event || rawObj.eventName || rawObj.name;
    if (!eventName || typeof eventName !== 'string') return false;

    const properties = rawObj.properties || {};
    const distinctId = properties.distinct_id || properties.device_uuid || rawObj.distinct_id || session.distinct_id || null;

    let insertId = properties.$insert_id || properties.insert_id || rawObj.insert_id || null;
    if (!insertId) {
      const rawTime = properties.time || rawObj.time || Date.now();
      const hashContent = `${eventName}:${distinctId}:${rawTime}:${JSON.stringify(properties)}`;
      insertId = crypto.createHash('md5').update(hashContent).digest('hex');
    }

    // Check if event already exists for this session
    const existing = await db.query(
      'SELECT id FROM mixpanel_events WHERE session_id = $1 AND insert_id = $2',
      [session.id, insertId]
    );

    if (existing.rows.length > 0) {
      return false; // Already recorded
    }

    // Parse event time
    let eventTime;
    if (typeof properties.time === 'number') {
      eventTime = new Date(properties.time > 1e11 ? properties.time : properties.time * 1000);
    } else if (rawObj.time) {
      eventTime = new Date(rawObj.time);
    } else {
      eventTime = new Date();
    }

    // Run deterministic validation engine
    const validation = validateEvent(rawObj, specRules);

    await db.query(
      `INSERT INTO mixpanel_events (
        session_id, user_id, event_name, distinct_id, insert_id,
        event_time, raw_payload, is_correlated, validation_status, validation_summary, source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        session.id,
        session.user_id,
        eventName,
        distinctId,
        insertId,
        eventTime.toISOString(),
        JSON.stringify(rawObj),
        true,
        validation.status,
        JSON.stringify(validation),
        source
      ]
    );

    return true;
  }

  /**
   * Manually inject or simulate an event into a session (e.g., from direct device hook,
   * SDK bridge, or synthetic test runner).
   */
  async injectEvent(sessionId, user, rawPayload) {
    if (!sessionId) throw new Error('Session ID is required.');
    if (!rawPayload || typeof rawPayload !== 'object') {
      throw new Error('Valid raw event payload is required.');
    }

    const sessionRes = await db.query('SELECT * FROM mixpanel_sessions WHERE id = $1', [sessionId]);
    if (sessionRes.rows.length === 0) {
      const error = new Error('Session not found.');
      error.statusCode = 404;
      throw error;
    }

    const session = sessionRes.rows[0];
    if (user && user.role !== 'ADMIN' && session.user_id !== user.id) {
      const error = new Error('Access denied to session.');
      error.statusCode = 403;
      throw error;
    }

    if (session.status !== 'ACTIVE') {
      const error = new Error('Cannot inject events into a stopped session.');
      error.statusCode = 400;
      throw error;
    }

    // Load spec rules
    let specRules = [];
    if (session.spec_id) {
      const specRes = await db.query('SELECT rules FROM mixpanel_specifications WHERE id = $1', [session.spec_id]);
      if (specRes.rows.length > 0 && Array.isArray(specRes.rows[0].rules)) {
        specRules = specRes.rows[0].rules;
      }
    }

    await this._processAndStoreEvent(session, rawPayload, specRules, 'SYNTHETIC_INJECTION');

    // Update count
    const countRes = await db.query(
      `UPDATE mixpanel_sessions
       SET events_count = (SELECT COUNT(*) FROM mixpanel_events WHERE session_id = $1),
           last_polled_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [sessionId]
    );

    if (typeof db.saveToDisk === 'function') {
      await db.saveToDisk();
    }

    // Retrieve the newly inserted event
    const latestEventRes = await db.query(
      'SELECT * FROM mixpanel_events WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1',
      [sessionId]
    );

    return {
      session: countRes.rows[0],
      event: latestEventRes.rows[0] || null
    };
  }

  /**
   * Revalidate an existing event against the session's specification or a newly chosen spec.
   */
  async revalidateEvent(sessionId, eventId, user, customSpecId = null) {
    const sessionRes = await db.query('SELECT * FROM mixpanel_sessions WHERE id = $1', [sessionId]);
    if (sessionRes.rows.length === 0) {
      const error = new Error('Session not found.');
      error.statusCode = 404;
      throw error;
    }

    const session = sessionRes.rows[0];
    if (user && user.role !== 'ADMIN' && session.user_id !== user.id) {
      const error = new Error('Access denied to session.');
      error.statusCode = 403;
      throw error;
    }

    const eventRes = await db.query(
      'SELECT * FROM mixpanel_events WHERE id = $1 AND session_id = $2',
      [eventId, sessionId]
    );
    if (eventRes.rows.length === 0) {
      const error = new Error('Event not found in session.');
      error.statusCode = 404;
      throw error;
    }

    const event = eventRes.rows[0];
    const targetSpecId = customSpecId || session.spec_id;

    let specRules = [];
    if (targetSpecId) {
      const specRes = await db.query('SELECT rules FROM mixpanel_specifications WHERE id = $1', [targetSpecId]);
      if (specRes.rows.length > 0 && Array.isArray(specRes.rows[0].rules)) {
        specRules = specRes.rows[0].rules;
      }
    }

    const rawPayload = typeof event.raw_payload === 'string'
      ? JSON.parse(event.raw_payload)
      : event.raw_payload;

    const validation = validateEvent(rawPayload, specRules);

    const updateRes = await db.query(
      `UPDATE mixpanel_events
       SET validation_status = $1, validation_summary = $2
       WHERE id = $3
       RETURNING *`,
      [validation.status, JSON.stringify(validation), eventId]
    );

    if (typeof db.saveToDisk === 'function') {
      await db.saveToDisk();
    }

    return updateRes.rows[0];
  }
}

module.exports = new MixpanelCollectorService();
