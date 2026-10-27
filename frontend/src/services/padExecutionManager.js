import { socketService } from './socket.js';
import { api } from './api.js';

class PadExecutionManager {
  constructor() {
    this.activeTestId = null;
    this.isRunning = false;
    this.steps = [];
    this.logs = [];
    this.progress = 0;
    this.assetPackName = 'main_assets';
    this.completedTest = null;
    this.error = null;
    this.deviceSerial = null;
    this.packageName = null;
    this.userId = null;
    this.isBrowserUsb = false;
    this.logcatActive = false;
    this.isMonitoring = false;

    // Bounded buffer limits for memory protection
    this.maxLogsTotal = 3000;
    this.maxApiCrashLogs = 1000;
    this.maxGeneralLogs = 2000;

    // Listeners for UI subscribers
    this.listeners = new Set();

    // Session cache by testId to support session isolation
    this.sessionCache = new Map();

    this.socketService = null;
    this.api = null;
    this.initialized = false;
  }

  getSocket() {
    return this.socketService || socketService;
  }

  getApi() {
    return this.api || api;
  }

  init() {
    if (this.initialized) return;
    this.initialized = true;

    const sock = this.getSocket();
    sock.connect();

    sock.on('STEP_UPDATE', (data) => {
      if (!this.activeTestId || !data.testId || data.testId !== this.activeTestId) return;
      if (data.steps) {
        this.steps = data.steps;
        this._updateSessionCache();
        this.notify();
      }
    });

    sock.on('LOG', (data) => {
      // If this log belongs to a test, enforce strict activeTestId matching
      if (data.testId) {
        if (!this.activeTestId || data.testId !== this.activeTestId) return;
      } else {
        // Raw device logcat line - accept if associated with current device and an active test, active monitoring session, or active logcat stream
        if (!this.activeTestId && !this.isRunning && !this.logcatActive && !this.hasActiveSession()) return;
        if (!this.deviceSerial || !data.serial || data.serial !== this.deviceSerial) return;
      }

      if (data.log) {
        this._addLog(data.log);
      }
    });

    sock.on('PROGRESS', (data) => {
      if (!this.activeTestId || !data.testId || data.testId !== this.activeTestId) return;
      this.progress = data.progress || 0;
      if (data.assetPackName) {
        this.assetPackName = data.assetPackName;
      }
      this._updateSessionCache();
      this.notify();
    });

    sock.on('TEST_FINISHED', (data) => {
      const eventTestId = data.testId || data.test?.id;
      if (!this.activeTestId || !eventTestId || eventTestId !== this.activeTestId) return;
      if (this.isBrowserUsb && this.isRunning) return;

      this.isRunning = false;
      this.completedTest = data.test;
      // If this is an ongoing installed-app monitoring session, keep logcat active for continuous telemetry.
      // Otherwise cleanly stop logcat for standard test pipeline runs.
      if (!this.isMonitoring) {
        this.stopLogcatMonitoring();
      }
      this._updateSessionCache();
      this.notify();
    });

    sock.on('SNAPSHOT', (data) => {
      const snapTestId = data.testId || data.test?.id;
      if (!this.activeTestId || !snapTestId || snapTestId !== this.activeTestId) return;
      if (this.isBrowserUsb && this.isRunning) return;

      if (data.test) {
        if (data.test.status === 'COMPLETED') {
          this.completedTest = data.test;
          this.isRunning = false;
        } else if (data.test.status === 'RUNNING') {
          this.isRunning = true;
        }
        if (data.test.steps) {
          this.steps = data.test.steps;
        }
        // If snapshot includes logs (e.g. from server recovery), merge with deduplication
        if (Array.isArray(data.test.logs) && data.test.logs.length > 0) {
          for (const l of data.test.logs) {
            this._addLog(l);
          }
        }
      }
      this._updateSessionCache();
      this.notify();
    });
  }

  subscribe(listener) {
    this.init();
    this.listeners.add(listener);
    // Immediately notify subscriber with current state
    try {
      listener(this.getState());
    } catch (e) {
      console.error('[PadExecutionManager] Listener error on initial call:', e);
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  notify() {
    const state = this.getState();
    this.listeners.forEach((fn) => {
      try {
        fn(state);
      } catch (e) {
        console.error('[PadExecutionManager] Error in listener callback:', e);
      }
    });
  }

  getState() {
    return {
      activeTestId: this.activeTestId,
      isRunning: this.isRunning,
      steps: [...this.steps],
      logs: [...this.logs],
      progress: this.progress,
      assetPackName: this.assetPackName,
      completedTest: this.completedTest,
      error: this.error,
      deviceSerial: this.deviceSerial,
      packageName: this.packageName,
      userId: this.userId,
      isBrowserUsb: this.isBrowserUsb,
      logcatActive: this.logcatActive
    };
  }

  hasActiveSession() {
    return Boolean(this.activeTestId || this.isRunning || this.completedTest);
  }

  startSession({
    testId = null,
    deviceSerial = null,
    packageName = null,
    initialSteps = [],
    isBrowserUsb = false,
    userId = null,
    isMonitoring = false
  }) {
    this.init();

    // Verify user isolation
    const currentUserId = userId || this.getApi().getCurrentUser()?.id;
    if (this.userId && currentUserId && this.userId !== currentUserId) {
      this.resetForUser(currentUserId);
    }
    this.userId = currentUserId;

    this.activeTestId = testId;
    this.isRunning = true;
    this.deviceSerial = deviceSerial;
    this.packageName = packageName;
    this.isBrowserUsb = isBrowserUsb;
    this.isMonitoring = isMonitoring;
    this.steps = initialSteps || [];
    this.logs = [];
    this.progress = 0;
    this.completedTest = null;
    this.error = null;

    if (testId) {
      this.getSocket().subscribeToTest(testId);
      this._updateSessionCache();
    }

    if (!isBrowserUsb && deviceSerial) {
      this.startLogcatMonitoring(deviceSerial, packageName);
    }

    this.notify();
  }

  setActiveTestId(testId) {
    if (!testId) return;
    this.activeTestId = testId;
    this.getSocket().subscribeToTest(testId);
    this._updateSessionCache();
    this.notify();
  }

  setSteps(steps) {
    this.steps = Array.isArray(steps) ? steps : [];
    this._updateSessionCache();
    this.notify();
  }

  updateStep(stepId, status, duration = null, details = null) {
    this.steps = this.steps.map((s) =>
      s.id === stepId ? { ...s, status, ...(duration ? { duration } : {}), ...(details ? { details } : {}) } : s
    );
    this._updateSessionCache();
    this.notify();
  }

  setProgress(progress, assetPackName = null) {
    this.progress = progress;
    if (assetPackName) this.assetPackName = assetPackName;
    this._updateSessionCache();
    this.notify();
  }

  setError(error) {
    this.error = error;
    this.notify();
  }

  setCompletedTest(test) {
    this.completedTest = test;
    this.isRunning = false;
    if (!this.isMonitoring) {
      this.stopLogcatMonitoring();
    }
    this._updateSessionCache();
    this.notify();
  }

  setIsRunning(isRunning) {
    this.isRunning = isRunning;
    this.notify();
  }

  appendClientLog(logLine) {
    this._addLog(logLine);
  }

  clearLogs() {
    this.logs = [];
    this._updateSessionCache();
    this.notify();
  }

  startLogcatMonitoring(serial, packageName) {
    if (this.isBrowserUsb || !serial) return;
    this.deviceSerial = serial;
    this.packageName = packageName || this.packageName;
    this.logcatActive = true;

    this.getSocket().send({
      action: 'DEVICE_LOGCAT_START',
      serial,
      packageName: this.packageName || ''
    });
  }

  stopLogcatMonitoring() {
    if (this.deviceSerial && this.logcatActive) {
      this.getSocket().send({
        action: 'DEVICE_LOGCAT_STOP',
        serial: this.deviceSerial
      });
      this.logcatActive = false;
    }
  }

  cancelSession() {
    if (this.activeTestId) {
      this.getApi().cancelTest(this.activeTestId).catch(() => {});
    }
    this.isRunning = false;
    this.stopLogcatMonitoring();
    this.notify();
  }

  resetForUser(newUserId) {
    this.stopLogcatMonitoring();
    this.activeTestId = null;
    this.isRunning = false;
    this.steps = [];
    this.logs = [];
    this.progress = 0;
    this.completedTest = null;
    this.error = null;
    this.deviceSerial = null;
    this.packageName = null;
    this.userId = newUserId || null;
    this.sessionCache.clear();
    this.notify();
  }

  _isDuplicate(log) {
    if (!log || this.logs.length === 0) return false;
    const logText = typeof log === 'object' ? (log.text || '') : String(log);
    const logTime = typeof log === 'object' ? (log.time || '') : '';

    const startIdx = Math.max(0, this.logs.length - 50);
    for (let i = this.logs.length - 1; i >= startIdx; i--) {
      const existing = this.logs[i];
      const exText = typeof existing === 'object' ? (existing.text || '') : String(existing);
      const exTime = typeof existing === 'object' ? (existing.time || '') : '';
      if (logText === exText && logTime === exTime) {
        return true;
      }
    }
    return false;
  }

  _addLog(log) {
    if (!log) return;
    if (this._isDuplicate(log)) return;

    this.logs.push(log);

    // Apply bounded retention to prevent unbounded memory growth
    if (this.logs.length > this.maxLogsTotal) {
      const isPriority = (l) => {
        if (!l) return false;
        if (typeof l === 'object') {
          if (l.type === 'APP_CRASH' || l.category === 'APP CRASH' || l.crash) return true;
          if (l.category === 'API' || l.api || l.apiDetails) return true;
          const txt = l.text || l.message || '';
          return typeof txt === 'string' && (
            txt.includes('FATAL EXCEPTION') ||
            txt.includes('AndroidRuntime: FATAL') ||
            txt.includes('[VOLLEY_') ||
            txt.includes('API_TO_CALL') ||
            txt.includes('API_URL') ||
            txt.includes('HTTP response') ||
            txt.includes('[API]') ||
            txt.includes('PhotoMultipartRequest') ||
            txt.includes('GsonRequest') ||
            (txt.includes('MarkerLog.finish') && (txt.includes('http://') || txt.includes('https://')))
          );
        }
        const str = String(l);
        return (
          str.includes('FATAL EXCEPTION') ||
          str.includes('AndroidRuntime: FATAL') ||
          str.includes('[VOLLEY_') ||
          str.includes('API_TO_CALL') ||
          str.includes('API_URL') ||
          str.includes('HTTP response') ||
          str.includes('[API]') ||
          str.includes('PhotoMultipartRequest') ||
          str.includes('GsonRequest') ||
          (str.includes('MarkerLog.finish') && (str.includes('http://') || str.includes('https://')))
        );
      };

      const priorityLogs = this.logs.filter(isPriority).slice(-this.maxApiCrashLogs);
      const generalLogs = this.logs.filter(l => !isPriority(l)).slice(-this.maxGeneralLogs);
      this.logs = [...priorityLogs, ...generalLogs];
    }

    this._updateSessionCache();
    this.notify();
  }

  _updateSessionCache() {
    if (!this.activeTestId) return;
    this.sessionCache.set(this.activeTestId, {
      testId: this.activeTestId,
      userId: this.userId,
      steps: [...this.steps],
      logs: [...this.logs],
      progress: this.progress,
      completedTest: this.completedTest,
      status: this.isRunning ? 'RUNNING' : (this.completedTest?.status || 'COMPLETED'),
      updatedAt: Date.now()
    });
  }
}

export const padExecutionManager = new PadExecutionManager();
export default padExecutionManager;
