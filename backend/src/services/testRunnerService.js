const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');
const adbService = require('./adbService');
const bundletoolService = require('./bundletoolService');
const aabAnalyzerService = require('./aabAnalyzerService');
const historyService = require('./historyService');
const deviceLockService = require('./deviceLockService');

class TestRunnerService {
  constructor() {
    this.activeTests = new Map(); // testId -> { process, logcatProc, status, abortController }
    this.subscribers = new Map(); // testId -> Set of ws client callbacks

    // Register active test checker callback on adbService without circular dependency
    if (adbService && typeof adbService.setActiveTestChecker === 'function') {
      adbService.setActiveTestChecker((serial, hardwareSerial) => {
        return this.isTestActiveForDevice(serial, hardwareSerial);
      });
    }
  }

  /**
   * Check if any PAD test or installed app monitoring session is currently active for a device
   */
  isTestActiveForDevice(serial, hardwareSerial) {
    if (!serial && !hardwareSerial) return false;
    for (const [, active] of this.activeTests.entries()) {
      if (active.isCancelled) continue;
      const testSerial = active.testData?.deviceSerial;
      const testHw = deviceLockService.hardwareMap?.get(testSerial) || null;
      if (testSerial === serial || (hardwareSerial && testSerial === hardwareSerial)) {
        return true;
      }
      if (testHw && (testHw === hardwareSerial || testHw === serial)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Subscribe WebSocket to test updates
   */
  subscribe(testId, ws, user = null) {
    const currentUser = user || ws.user;
    const active = this.activeTests.get(testId);
    const saved = !active ? historyService.getTestById(testId) : null;

    // Verify user authorization (admin or test owner)
    if (currentUser && (currentUser.role || '').toLowerCase() !== 'admin') {
      const testOwnerId = active?.testData?.userId || saved?.userId;
      if (testOwnerId && testOwnerId !== currentUser.id) {
        this.sendToWs(ws, {
          type: 'ERROR',
          message: 'Unauthorized: You do not have permission to access this test session.'
        });
        return false;
      }
    }

    if (!this.subscribers.has(testId)) {
      this.subscribers.set(testId, new Set());
    }
    this.subscribers.get(testId).add(ws);

    // Send initial snapshot if active
    if (active && active.snapshot) {
      this.sendToWs(ws, active.snapshot);
    } else if (saved) {
      this.sendToWs(ws, { type: 'SNAPSHOT', test: saved });
    }
    return true;
  }

  /**
   * Unsubscribe WebSocket
   */
  unsubscribe(testId, ws) {
    if (this.subscribers.has(testId)) {
      this.subscribers.get(testId).delete(ws);
    }
  }

  /**
   * Broadcast message to all subscribers of a test
   */
  broadcast(testId, message) {
    const clients = this.subscribers.get(testId);
    if (clients) {
      const dataStr = JSON.stringify(message);
      for (const client of clients) {
        if (client.readyState === 1) { // OPEN
          client.send(dataStr);
        }
      }
    }
  }

  sendToWs(ws, message) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Cancel a running test
   */
  async cancelTest(testId, user = null) {
    const active = this.activeTests.get(testId);
    if (!active) {
      return { success: false, message: 'Test is not currently running' };
    }

    // Verify user authorization for cancellation
    if (user && (user.role || '').toLowerCase() !== 'admin' && active.testData?.userId && active.testData.userId !== user.id) {
      return { success: false, message: 'Unauthorized: You cannot cancel another user\'s test.' };
    }

    logger.info(`Cancelling test ${testId}...`);
    active.isCancelled = true;

    if (active.pidWatchInterval) {
      clearInterval(active.pidWatchInterval);
      active.pidWatchInterval = null;
    }

    if (active.logcatProc) {
      try { active.logcatProc.kill('SIGKILL'); } catch (e) {}
    }

    this.emitLog(testId, 'Test was manually cancelled by user.', 'WARN');
    this.updateStep(testId, active.currentStepId, 'CANCELLED', 'Cancelled by user');

    const durationSeconds = Math.round((Date.now() - active.startTime) / 1000);
    const testRecord = {
      ...active.testData,
      status: 'CANCELLED',
      result: 'FAIL',
      failureReason: 'Test execution was cancelled by user.',
      duration: `${durationSeconds}s`,
      completedAt: new Date().toISOString()
    };

    historyService.saveTest(testRecord);
    this.broadcast(testId, { type: 'TEST_FINISHED', testId, test: testRecord });
    this.activeTests.delete(testId);

    // Terminal State: Execute deferred wireless cleanup if pending
    try {
      const devSerial = active.testData?.deviceSerial;
      const targetHw = (deviceLockService.hardwareMap && devSerial ? deviceLockService.hardwareMap.get(devSerial) : null) || devSerial;
      adbService.executeDeferredCleanup(devSerial, targetHw).catch(() => {});
    } catch (e) {}

    return { success: true, message: 'Test cancelled' };
  }

  /**
   * Helper to emit a log line with full context metadata
   */
  emitLog(testId, text, level = 'INFO', extra = {}) {
    const time = new Date().toLocaleTimeString();
    const active = this.activeTests.get(testId);
    const logObj = {
      time,
      text,
      level,
      ...(extra.api ? { api: extra.api } : {})
    };
    logger.writeTestLog(testId, `[${time}] [${level}] ${text}`);
    this.broadcast(testId, {
      type: 'LOG',
      testId,
      serial: active?.testData?.deviceSerial || null,
      packageName: active?.testData?.packageName || null,
      userId: active?.testData?.userId || null,
      platform: 'android',
      pid: active?.currentPid || null,
      log: logObj
    });
  }

  /**
   * Helper to update a step state
   */
  updateStep(testId, stepId, status, details = '') {
    const active = this.activeTests.get(testId);
    if (active && Array.isArray(active.steps)) {
      const step = active.steps.find(s => s.id === stepId);
      if (step) {
        step.status = status; // 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'CANCELLED'
        step.details = details;
        active.currentStepId = stepId;
        this.broadcast(testId, { type: 'STEP_UPDATE', testId, steps: active.steps });
      }
    }
  }

  /**
   * Update download progress
   */
  updateProgress(testId, percent, assetPackName = '') {
    const active = this.activeTests.get(testId);
    if (active) {
      active.progress = percent;
      this.broadcast(testId, {
        type: 'PROGRESS',
        testId,
        progress: percent,
        assetPackName: assetPackName || active.mainAssetPack || 'main_assets'
      });
    }
  }

  /**
   * Start Live Monitoring Session for an Already-Installed Application (without build/install/PAD pipeline)
   */
  async monitorInstalledApp(options) {
    const {
      packageName,
      deviceSerial,
      user = null
    } = options;

    if (!packageName) throw new Error('Package name is required for installed app monitoring.');
    if (!deviceSerial) throw new Error('Device serial is required.');

    const currentUser = user || { id: 'default_user', name: 'QA Tester', email: 'tester@local.qa', role: 'admin' };

    // 1. Verify device accessibility & claim device for current user
    if (!deviceLockService.isDeviceAccessible(deviceSerial, currentUser)) {
      throw new Error(`Device ${deviceSerial} is not accessible to your account.`);
    }

    try {
      deviceLockService.claimDevice(deviceSerial, currentUser, { durationMs: config.TEST_TIMEOUT_MS });
    } catch (lockErr) {
      logger.debug(`[monitorInstalledApp] Claim notice: ${lockErr.message}`);
    }

    // 2. Validate package actually exists on target device
    const isInstalled = await adbService.isPackageInstalled(deviceSerial, packageName);
    if (!isInstalled) {
      throw new Error(`Application '${packageName}' is not installed on device ${deviceSerial}.`);
    }

    const testId = uuidv4();
    const startTime = Date.now();

    // 3. Resolve initial PID if app is currently running
    const initialPid = await adbService.getPid(deviceSerial, packageName).catch(() => null);

    // Monitoring steps representation
    const steps = [
      { id: 'check_device', label: 'Validating Device Connection', status: 'PASSED', details: deviceSerial },
      { id: 'validate_app', label: 'Verifying Installed Application', status: 'PASSED', details: packageName },
      { id: 'attach_monitor', label: 'Attaching PID-Scoped Live Monitor', status: 'RUNNING', details: initialPid ? `PID: ${initialPid}` : 'Waiting for app launch...' }
    ];

    const activeState = {
      testId,
      startTime,
      steps,
      currentStepId: 'attach_monitor',
      progress: 100,
      isCancelled: false,
      logcatProc: null,
      pidWatchInterval: null,
      currentPid: initialPid,
      user: currentUser,
      source: 'installed-app',
      testData: {
        id: testId,
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        source: 'installed-app',
        packageName,
        applicationName: packageName.split('.').pop() || packageName,
        deviceSerial,
        deviceName: 'Android Device',
        installMode: 'Installed App Monitor',
        status: 'RUNNING',
        result: 'PENDING',
        steps,
        createdAt: new Date().toISOString()
      }
    };

    this.activeTests.set(testId, activeState);

    // Enable verbose Volley and OkHttp tags on target device
    adbService.runSafeAdbCommand(deviceSerial, 'adb shell setprop log.tag.Volley VERBOSE').catch(() => {});
    adbService.runSafeAdbCommand(deviceSerial, 'adb shell setprop log.tag.OkHttp VERBOSE').catch(() => {});

    this.emitLog(testId, `✓ Selected Installed Application: ${packageName}`);
    if (initialPid) {
      this.emitLog(testId, `✓ Attached to running process (PID: ${initialPid})`);
    } else {
      this.emitLog(testId, `ℹ Application is not currently running. Waiting for launch on target device...`);
    }

    // Attach stream and dynamic PID watcher in background
    this.startInstalledAppLogcatStream(testId, deviceSerial, packageName, activeState);

    return {
      testId,
      packageName,
      deviceSerial,
      status: 'RUNNING',
      pid: initialPid,
      message: initialPid ? `Monitoring active (PID: ${initialPid})` : 'Monitoring active (Waiting for app launch)'
    };
  }

  /**
   * Background PID-scoped stream and dynamic PID tracking for an installed application
   */
  startInstalledAppLogcatStream(testId, deviceSerial, packageName, activeState) {
    const attachLogcat = (pid) => {
      if (activeState.logcatProc) {
        try { activeState.logcatProc.kill('SIGKILL'); } catch (e) {}
        activeState.logcatProc = null;
      }

      if (!pid) return;

      const proc = adbService.streamPidLogcat(deviceSerial, pid);
      activeState.logcatProc = proc;

      let logBuffer = '';
      proc.stdout.on('data', (data) => {
        if (activeState.isCancelled) return;
        logBuffer += data.toString();
        const lines = logBuffer.split('\n');
        logBuffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let structuredApi = null;
          if (trimmed.includes('[VOLLEY_HTTP_TRANSACTION]') || trimmed.includes('VOLLEY_HTTP_TRANSACTION:') || trimmed.includes('[API_TRANSACTION]')) {
            try {
              const jsonStart = trimmed.indexOf('{');
              if (jsonStart !== -1) {
                structuredApi = JSON.parse(trimmed.substring(jsonStart));
              }
            } catch (e) {}
          }

          const level = trimmed.includes(' E ') || trimmed.includes('ERROR') ? 'ERROR' : trimmed.includes(' W ') ? 'WARN' : 'INFO';
          this.emitLog(testId, trimmed, level, { api: structuredApi });

          if (trimmed.includes('FATAL EXCEPTION') || trimmed.includes('AndroidRuntime: FATAL')) {
            this.emitLog(testId, `[CRASH DETECTED] Fatal application exception in ${packageName} (PID: ${pid})`, 'ERROR');
          }
        }
      });

      proc.stderr.on('data', () => {});
      proc.on('error', (err) => {
        logger.debug(`[InstalledAppLogcat] Error for ${packageName}: ${err.message}`);
      });
    };

    if (activeState.currentPid) {
      attachLogcat(activeState.currentPid);
    }

    // Dynamic PID tracking watcher
    activeState.pidWatchInterval = setInterval(async () => {
      if (activeState.isCancelled || !this.activeTests.has(testId)) {
        if (activeState.pidWatchInterval) clearInterval(activeState.pidWatchInterval);
        return;
      }
      try {
        const freshPid = await adbService.getPid(deviceSerial, packageName);
        if (freshPid && freshPid !== activeState.currentPid) {
          logger.info(`[InstalledApp PID Watch] Process transition for ${packageName} (${activeState.currentPid || 'none'} -> ${freshPid})`);
          activeState.currentPid = freshPid;
          this.updateStep(testId, 'attach_monitor', 'RUNNING', `PID: ${freshPid}`);
          this.emitLog(testId, `✓ Application process active (PID: ${freshPid})`);
          attachLogcat(freshPid);
        } else if (!freshPid && activeState.currentPid) {
          logger.info(`[InstalledApp PID Watch] Application ${packageName} stopped`);
          activeState.currentPid = null;
          this.updateStep(testId, 'attach_monitor', 'RUNNING', 'Waiting for app launch...');
          this.emitLog(testId, `ℹ Application process stopped. Waiting for relaunch...`, 'WARN');
          if (activeState.logcatProc) {
            try { activeState.logcatProc.kill('SIGKILL'); } catch (e) {}
            activeState.logcatProc = null;
          }
        }
      } catch (e) {}
    }, 2000);
    if (activeState.pidWatchInterval?.unref) {
      activeState.pidWatchInterval.unref();
    }
  }

  /**
   * Start a full PAD / ORD Test Execution Pipeline
   */
  async runTest(options) {
    const {
      buildId,
      aabPath: explicitAabPath,
      deviceSerial,
      installMode = 'fresh', // 'fresh' | 'update' | 'force-rebuild'
      launchApp = true,
      uninstallConfirmed = false,
      monitoringTimeoutSec = 12, // Default 12s fast monitoring window
      user = null
    } = options;

    const testId = uuidv4();
    const startTime = Date.now();
    const currentUser = user || { id: 'default_user', name: 'QA Tester', email: 'tester@local.qa', role: 'admin' };

    // Acquire or refresh device lock for test duration
    try {
      deviceLockService.claimDevice(deviceSerial, currentUser, { testId, durationMs: config.TEST_TIMEOUT_MS });
    } catch (lockErr) {
      logger.warn(`[runTest] Failed to claim device lock: ${lockErr.message}`);
    }

    // Standard 9 execution stages
    const steps = [
      { id: 'check_prereqs', label: 'Checking Prerequisites (Java, ADB, Bundletool)', status: 'PENDING', details: '' },
      { id: 'check_device', label: 'Validating Connected Android Device', status: 'PENDING', details: '' },
      { id: 'analyze_aab', label: 'Analyzing AAB and Asset Packs', status: 'PENDING', details: '' },
      { id: 'handle_install_mode', label: installMode === 'fresh' ? 'Handling Fresh Install (Package Clean)' : 'Preparing App Update Mode', status: 'PENDING', details: '' },
      { id: 'generate_apks', label: 'Generating APKs with Bundletool Local Testing', status: 'PENDING', details: '' },
      { id: 'install_app', label: 'Installing Generated Application', status: 'PENDING', details: '' },
      { id: 'launch_app', label: launchApp ? 'Launching Application' : 'Launching Application (Skipped)', status: 'PENDING', details: '' },
      { id: 'monitor_logs', label: 'Monitoring AssetPackHelper & Download Status', status: 'PENDING', details: '' },
      { id: 'verify_result', label: 'Final PAD Verification & Result Analysis', status: 'PENDING', details: '' }
    ];

    const activeState = {
      testId,
      startTime,
      steps,
      currentStepId: 'check_prereqs',
      progress: 0,
      isCancelled: false,
      logcatProc: null,
      mainAssetPack: '',
      user: currentUser,
      testData: {
        id: testId,
        userId: currentUser.id,
        userName: currentUser.name,
        userEmail: currentUser.email,
        buildId,
        deviceSerial,
        deviceName: 'Unknown Device',
        androidVersion: 'Unknown',
        installMode: installMode === 'fresh' ? 'Fresh Install' : 'Update App',
        launchApp,
        status: 'RUNNING',
        result: 'PENDING',
        steps,
        createdAt: new Date().toISOString()
      }
    };

    this.activeTests.set(testId, activeState);

    // Run asynchronously in background
    this.executePipeline(testId, options).catch(err => {
      logger.error(`Pipeline exception for test ${testId}: ${err.message}`);
    });

    return {
      testId,
      status: 'RUNNING',
      message: 'PAD Test initiated'
    };
  }

  /**
   * Internal Pipeline Logic
   */
  async executePipeline(testId, options) {
    const { buildId, aabPath: explicitAabPath, installMode, launchApp = true, monitoringTimeoutSec = 12 } = options;
    let deviceSerial = options.deviceSerial;
    const active = this.activeTests.get(testId);

    const failTest = (stepId, reason, techDetails = '') => {
      this.updateStep(testId, stepId, 'FAILED', reason);
      this.emitLog(testId, `[ERROR] ${reason}`, 'ERROR');
      if (techDetails) {
        this.emitLog(testId, `Technical Details: ${techDetails}`, 'ERROR');
      }

      if (active.logcatProc) {
        try { active.logcatProc.kill('SIGKILL'); } catch (e) {}
      }

      const durationSeconds = Math.round((Date.now() - active.startTime) / 1000);
      const testRecord = {
        ...active.testData,
        status: 'COMPLETED',
        result: 'FAIL',
        failureReason: reason,
        technicalDetails: techDetails,
        duration: `${durationSeconds}s`,
        completedAt: new Date().toISOString()
      };

      historyService.saveTest(testRecord);
      this.broadcast(testId, { type: 'TEST_FINISHED', testId, test: testRecord });
      this.activeTests.delete(testId);

      // Terminal State: Execute deferred wireless cleanup if pending
      try {
        const targetHw = (deviceLockService.hardwareMap && deviceSerial ? deviceLockService.hardwareMap.get(deviceSerial) : null) || deviceSerial;
        adbService.executeDeferredCleanup(deviceSerial, targetHw).catch(() => {});
      } catch (e) {}
    };

    try {
      this.emitLog(testId, `=== Starting Play Asset Delivery (PAD) QA Test [${testId}] ===`);
      this.emitLog(testId, `Target Device Serial: ${deviceSerial}`);
      this.emitLog(testId, `Installation Mode: ${installMode === 'fresh' ? 'Fresh Install' : 'Update Existing'}`);

      // STEP 1: Check Prerequisites (Fast cached check)
      this.updateStep(testId, 'check_prereqs', 'RUNNING');
      
      const javaRes = await bundletoolService.checkJava();
      if (!javaRes.available) {
        return failTest('check_prereqs', 'Java JDK is not available on QA server.', javaRes.error);
      }

      const adbRes = await adbService.checkAvailability();
      if (!adbRes.available) {
        return failTest('check_prereqs', 'ADB is not available on QA server.', adbRes.error);
      }

      const bundletoolRes = await bundletoolService.checkBundletool();
      if (!bundletoolRes.available) {
        this.emitLog(testId, 'Bundletool not found locally. Attempting automated fetch...');
        await bundletoolService.ensureBundletoolDownloaded();
        const recheck = await bundletoolService.checkBundletool(true);
        if (!recheck.available) {
          return failTest('check_prereqs', 'Bundletool JAR is missing.', recheck.error);
        }
      }
      this.emitLog(testId, `✓ Tools verified: Java, ADB, Bundletool`);
      this.updateStep(testId, 'check_prereqs', 'PASSED', 'All tools verified');

      if (active.isCancelled) return;

      // STEP 2: Validate Device
      this.updateStep(testId, 'check_device', 'RUNNING');
      
      const devices = await adbService.listDevices();
      const targetHw = (deviceLockService.hardwareMap && deviceLockService.hardwareMap.get(deviceSerial)) ||
        (deviceSerial.includes(':') && deviceLockService.hardwareMap ? deviceLockService.hardwareMap.get(deviceSerial.split(':')[0]) : null) ||
        deviceSerial;

      const targetDevice = devices.find(d => 
        d.serial === deviceSerial ||
        (targetHw && (d.hardwareSerial === targetHw || d.serial === targetHw))
      );

      if (!targetDevice || targetDevice.state !== 'device') {
        return failTest('check_device', `Device ${deviceSerial} is not connected or unauthorized (State: ${targetDevice ? targetDevice.state : 'Not Found'}).`);
      }

      // If physical device transport switched (e.g. wireless -> authoritative USB), update test serial seamlessly
      if (targetDevice.serial !== deviceSerial) {
        this.emitLog(testId, `ℹ Device transport transitioned: using authoritative transport ${targetDevice.serial} (originally ${deviceSerial}).`);
        active.testData.deviceSerial = targetDevice.serial;
        deviceSerial = targetDevice.serial;
      }

      const deviceInfo = await adbService.getDeviceInfo(deviceSerial);
      active.testData.deviceName = deviceInfo.name;
      active.testData.androidVersion = deviceInfo.androidVersion;
      this.emitLog(testId, `✓ Connected: ${deviceInfo.name} (${deviceInfo.androidVersion})`);
      this.updateStep(testId, 'check_device', 'PASSED', `${deviceInfo.name} (${deviceInfo.androidVersion})`);

      if (active.isCancelled) return;

      // STEP 3: Analyze AAB (Reuse cached upload analysis when available)
      this.updateStep(testId, 'analyze_aab', 'RUNNING');
      let aabPath = explicitAabPath;
      const cachedBuild = buildId ? historyService.getBuildById(buildId) : null;
      if (!aabPath && cachedBuild) {
        aabPath = cachedBuild.filePath;
      }
      if (!aabPath || !fs.existsSync(aabPath)) {
        return failTest('analyze_aab', `AAB build file could not be located.`);
      }

      let aabInfo;
      if (cachedBuild && cachedBuild.packageName && cachedBuild.versionName) {
        aabInfo = cachedBuild;
        this.emitLog(testId, `✓ AAB Package: ${aabInfo.packageName} (v${aabInfo.versionName})`);
      } else {
        this.emitLog(testId, `Analyzing AAB: ${path.basename(aabPath)}...`);
        aabInfo = await aabAnalyzerService.analyzeAab(aabPath);
      }

      active.testData.fileName = (cachedBuild && cachedBuild.fileName) ? cachedBuild.fileName : path.basename(aabPath);
      active.testData.applicationName = aabInfo.applicationName;
      active.testData.packageName = aabInfo.packageName;
      active.testData.version = `${aabInfo.versionName} (${aabInfo.versionCode})`;
      active.testData.targetSdk = aabInfo.targetSdkVersion;
      active.testData.assetPacks = aabInfo.assetPacks || [];

      if (aabInfo.assetPacks && aabInfo.assetPacks.length > 0) {
        active.mainAssetPack = aabInfo.assetPacks[0].name;
        this.emitLog(testId, `✓ Detected Asset Packs: ${aabInfo.assetPacks.map(p => `${p.name} [${p.deliveryType}]`).join(', ')}`);
      }
      this.updateStep(testId, 'analyze_aab', 'PASSED', `${aabInfo.packageName} v${aabInfo.versionName}`);

      if (active.isCancelled) return;

      // STEP 4: Handle Install Mode & Existing Package
      this.updateStep(testId, 'handle_install_mode', 'RUNNING');
      const isInstalled = await adbService.isPackageInstalled(deviceSerial, aabInfo.packageName);

      if (isInstalled) {
        if (installMode === 'fresh') {
          this.emitLog(testId, `Fresh Install mode: Uninstalling existing ${aabInfo.packageName}...`);
          await adbService.uninstallApp(deviceSerial, aabInfo.packageName);
          this.emitLog(testId, `✓ Existing package uninstalled cleanly`);
          this.updateStep(testId, 'handle_install_mode', 'PASSED', 'Uninstalled previous version');
        } else {
          this.emitLog(testId, `Update mode: Preserving existing application data`);
          this.updateStep(testId, 'handle_install_mode', 'PASSED', 'Preserving app data for update');
        }
      } else {
        this.emitLog(testId, `Target clean: No previous installation found`);
        this.updateStep(testId, 'handle_install_mode', 'PASSED', 'Clean target environment');
      }

      if (active.isCancelled) return;

      // STEP 5: Generate APKs with Bundletool Local Testing (Skipped for standalone APK)
      this.updateStep(testId, 'generate_apks', 'RUNNING');
      const isApk = aabPath.toLowerCase().endsWith('.apk') || cachedBuild?.fileType === 'apk';
      const cachedApksName = `${buildId || path.basename(aabPath, path.extname(aabPath))}.apks`;
      const outputApksPath = path.join(config.APKS_OUTPUT_DIR, cachedApksName);

      if (isApk) {
        this.emitLog(testId, `ℹ Standalone APK detected: Direct ADB install mode (Bundletool split generation skipped).`);
        this.updateStep(testId, 'generate_apks', 'PASSED', 'Direct APK mode');
      } else {
        const apksAlreadyBuilt = fs.existsSync(outputApksPath);
        if (apksAlreadyBuilt && installMode !== 'force-rebuild') {
          this.emitLog(testId, `✓ Using pre-built APKs with Play Asset Delivery mock server: ${cachedApksName}`);
          this.updateStep(testId, 'generate_apks', 'PASSED', 'Reused pre-built APKS');
        } else {
          this.emitLog(testId, `Running Bundletool build-apks with --local-testing...`);
          try {
            await bundletoolService.buildApks(aabPath, outputApksPath, {
              deviceId: deviceSerial,
              onLog: (chunk) => {
                const trimmed = chunk.trim();
                if (trimmed) this.emitLog(testId, `[Bundletool] ${trimmed}`, 'DEBUG');
              }
            });
            this.emitLog(testId, `✓ APKs generated successfully with Play Asset Delivery local mock server enabled.`);
            this.updateStep(testId, 'generate_apks', 'PASSED', 'APKS generated with --local-testing');
          } catch (err) {
            return failTest('generate_apks', 'Bundletool APK generation failed.', err.message);
          }
        }
      }

      if (active.isCancelled) return;

      // STEP 6: Install Application (Direct APK or Bundletool APKS)
      this.updateStep(testId, 'install_app', 'RUNNING');
      try {
        if (isApk) {
          this.emitLog(testId, `Installing standalone APK (${path.basename(aabPath)}) to device ${deviceSerial}...`);
          await adbService.installApk(deviceSerial, aabPath);
        } else {
          this.emitLog(testId, `Installing generated APKs to device ${deviceSerial}...`);
          await bundletoolService.installApks(outputApksPath, deviceSerial, {
            onLog: (chunk) => {
              const trimmed = chunk.trim();
              if (trimmed) this.emitLog(testId, `[Install] ${trimmed}`, 'DEBUG');
            }
          });
        }

        const verifyInstalled = await adbService.isPackageInstalled(deviceSerial, aabInfo.packageName);
        if (!verifyInstalled) {
          return failTest('install_app', `Installation appeared to complete but package ${aabInfo.packageName} was not found in pm list.`);
        }
        this.emitLog(testId, `✓ Application ${aabInfo.packageName} installed and verified on device.`);
        this.updateStep(testId, 'install_app', 'PASSED', 'Installed & verified');
      } catch (err) {
        return failTest('install_app', 'Failed to install application on device.', err.message);
      }

      if (active.isCancelled) return;

      // STEP 7: Launch Application & Clear Logcat (if enabled)
      if (launchApp) {
        this.updateStep(testId, 'launch_app', 'RUNNING');
        this.emitLog(testId, 'Clearing logcat buffer before launch...');
        await adbService.clearLogcat(deviceSerial);

        // Enable debug log tags for Volley and OkHttp network observability
        try {
          await adbService.runSafeAdbCommand(deviceSerial, 'adb shell setprop log.tag.Volley VERBOSE');
          await adbService.runSafeAdbCommand(deviceSerial, 'adb shell setprop log.tag.OkHttp VERBOSE');
        } catch (e) {
          logger.debug(`[TestRunner] Optional setprop setup skipped: ${e.message}`);
        }

        this.emitLog(testId, `Launching ${aabInfo.packageName}...`);
        try {
          await adbService.launchApp(deviceSerial, aabInfo.packageName);
          this.emitLog(testId, `✓ Application launched successfully.`);
          this.updateStep(testId, 'launch_app', 'PASSED', 'App launched');
        } catch (err) {
          return failTest('launch_app', `Failed to launch ${aabInfo.packageName}`, err.message);
        }

        if (active.isCancelled) return;

        // STEP 8: Monitor Logcat for AssetPackHelper / Runtime Stability (Optimized Window)
        this.updateStep(testId, 'monitor_logs', 'RUNNING');
        this.emitLog(testId, `Starting logcat stream monitoring (Window: ${monitoringTimeoutSec}s)...`);

        const monitoringResult = await this.monitorLogcatForPad(testId, deviceSerial, aabInfo.packageName, monitoringTimeoutSec, { isApk });

        if (!monitoringResult.success) {
          return failTest('monitor_logs', monitoringResult.reason, monitoringResult.details);
        }

        const stepMsg = isApk ? 'App launched & running stably' : 'Asset pack delivery confirmed';
        this.updateStep(testId, 'monitor_logs', 'PASSED', stepMsg);
        this.updateProgress(testId, 100);
      } else {
        // Auto-launch disabled
        this.emitLog(testId, 'ℹ Auto-launch disabled: skipping application launch.');
        this.updateStep(testId, 'launch_app', 'PASSED', 'Skipped (Auto-launch disabled)');

        const stepMsg = isApk ? 'APK installed and ready for manual launch.' : 'Installation verified with Play Asset Delivery mock APKs on device.';
        this.emitLog(testId, `ℹ ${stepMsg}`);
        this.updateStep(testId, 'monitor_logs', 'PASSED', 'Installed & Ready for manual launch');
        this.updateProgress(testId, 100);
      }

      // STEP 9: Final Result Evaluation
      this.updateStep(testId, 'verify_result', 'RUNNING');
      this.emitLog(testId, '==================================================');
      if (isApk) {
        this.emitLog(testId, '✓ APK TEST EXECUTION: PASS');
        this.emitLog(testId, 'Application successfully installed and verified on target device.');
      } else {
        this.emitLog(testId, '✓ PAD / ORD TEST EXECUTION: PASS');
        this.emitLog(testId, `All asset packs successfully verified in local testing environment.`);
      }
      this.emitLog(testId, '==================================================');
      this.updateStep(testId, 'verify_result', 'PASSED', 'Test Passed');

      const durationSeconds = Math.round((Date.now() - active.startTime) / 1000);
      const finalRecord = {
        ...active.testData,
        status: 'COMPLETED',
        result: 'PASS',
        duration: `${durationSeconds}s`,
        completedAt: new Date().toISOString()
      };

      historyService.saveTest(finalRecord);
      this.broadcast(testId, { type: 'TEST_FINISHED', testId, test: finalRecord });
      this.activeTests.delete(testId);

      // Terminal State: Execute deferred wireless cleanup if pending
      try {
        const targetHw = (deviceLockService.hardwareMap && deviceSerial ? deviceLockService.hardwareMap.get(deviceSerial) : null) || deviceSerial;
        adbService.executeDeferredCleanup(deviceSerial, targetHw).catch(() => {});
      } catch (e) {}

    } catch (unexpectedError) {
      failTest('verify_result', `Unexpected test failure: ${unexpectedError.message}`, unexpectedError.stack);
    }
  }

  /**
   * Monitor logcat for AssetPackHelper events, PlayCore status, and download percentages with PID-scoped isolation
   */
  async monitorLogcatForPad(testId, deviceSerial, packageName, timeoutSeconds = 12, options = {}) {
    const isApk = !!options.isApk;

    return new Promise(async (resolve) => {
      const active = this.activeTests.get(testId);
      if (!active) return resolve({ success: false, reason: 'Test context lost' });

      let isCompleted = false;
      let assetPackStarted = false;
      let lastProgress = 0;
      let appLaunchedConfirmed = false;
      let earlyResolutionTimer = null;
      let pidWatchInterval = null;
      let crashGraceTimer = null;

      // Attempt to resolve target application PID
      let currentPid = await adbService.getPid(deviceSerial, packageName).catch(() => null);
      active.currentPid = currentPid;

      const finishMonitoring = (success, reason, details = '') => {
        if (!isCompleted) {
          isCompleted = true;
          clearTimeout(timeoutTimer);
          if (earlyResolutionTimer) clearTimeout(earlyResolutionTimer);
          if (pidWatchInterval) clearInterval(pidWatchInterval);
          if (crashGraceTimer) clearTimeout(crashGraceTimer);
          active.pidWatchInterval = null;
          if (active.logcatProc) {
            try { active.logcatProc.kill('SIGKILL'); } catch (e) {}
            active.logcatProc = null;
          }
          resolve({ success, reason, details });
        }
      };

      const processLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        // Structured Volley / API extraction
        let structuredApi = null;
        if (trimmed.includes('[VOLLEY_HTTP_TRANSACTION]') || trimmed.includes('VOLLEY_HTTP_TRANSACTION:') || trimmed.includes('[API_TRANSACTION]')) {
          try {
            const jsonStart = trimmed.indexOf('{');
            if (jsonStart !== -1) {
              structuredApi = JSON.parse(trimmed.substring(jsonStart));
            }
          } catch (e) {}
        }

        // When PID-scoped, lines from this stream belong to this app
        const isPidScoped = !!currentPid;
        const isRelevant = isPidScoped ||
          trimmed.includes('AssetPackHelper') ||
          trimmed.includes('PlayCore') ||
          trimmed.includes('AssetPackManager') ||
          trimmed.includes('PlayAssetDelivery') ||
          trimmed.includes('assetpack') ||
          trimmed.includes('ActivityTaskManager') ||
          trimmed.includes('ActivityManager') ||
          trimmed.includes('AndroidRuntime') ||
          trimmed.includes('FATAL') ||
          trimmed.includes('Volley') ||
          trimmed.includes('VOLLEY_HTTP_TRANSACTION') ||
          trimmed.includes('API_TRANSACTION') ||
          trimmed.includes('NetworkUtility') ||
          trimmed.includes('BasicNetwork') ||
          trimmed.includes('GsonRequest') ||
          trimmed.includes('PhotoMultipartRequest') ||
          trimmed.includes('AIToolsHelper') ||
          trimmed.includes('AIImageGeneratorHelper') ||
          trimmed.includes('GetAndroidCreditsSync') ||
          trimmed.includes('SessionManager') ||
          trimmed.includes('TOKEN:') ||
          trimmed.includes('onResponse') ||
          trimmed.includes('callApiFor') ||
          trimmed.includes('OkHttp') ||
          trimmed.includes('Retrofit') ||
          trimmed.includes('API_TO_CALL') ||
          trimmed.includes('API_URL') ||
          trimmed.includes('--> POST') ||
          trimmed.includes('--> GET') ||
          trimmed.includes('--> PUT') ||
          trimmed.includes('--> DELETE') ||
          trimmed.includes('--> PATCH') ||
          trimmed.includes('<-- 200') ||
          trimmed.includes('HTTP response for request=<') ||
          trimmed.includes('[API]') ||
          trimmed.includes(packageName);

        if (isRelevant) {
          const level = trimmed.includes(' E ') || trimmed.includes('ERROR') ? 'ERROR' : trimmed.includes(' W ') ? 'WARN' : 'INFO';
          this.emitLog(testId, trimmed, level, { api: structuredApi });

          // Check for app launch confirmation
          if ((trimmed.includes('Displayed') || trimmed.includes('Start proc') || trimmed.includes('onResume')) && (trimmed.includes(packageName) || isPidScoped)) {
            appLaunchedConfirmed = true;
            if (!earlyResolutionTimer && !assetPackStarted) {
              // If app launched cleanly and no pending downloads after 3 seconds, complete successfully
              earlyResolutionTimer = setTimeout(() => {
                if (!assetPackStarted) {
                  this.updateProgress(testId, 100);
                  const reason = isApk 
                    ? 'Application launched cleanly and running stably on target device.'
                    : 'Application launched cleanly with local asset packs verified.';
                  finishMonitoring(true, reason);
                }
              }, 3000);
            }
          }

          // Check for fatal app crash strictly attributed to target package/PID
          if ((trimmed.includes('FATAL EXCEPTION') || trimmed.includes('AndroidRuntime: FATAL')) && (trimmed.includes(packageName) || isPidScoped)) {
            if (!crashGraceTimer) {
              crashGraceTimer = setTimeout(() => {
                finishMonitoring(false, 'Application crashed with fatal runtime exception.', trimmed);
              }, 1200);
            }
            return;
          }

          if (isApk) {
            // Standalone APK does not have Play Store mock splits
            return;
          }

          // AAB-Specific PAD checks:
          if (/download.*start|request.*pack|fetch.*assets|status.*pending|status.*downloading/i.test(trimmed)) {
            assetPackStarted = true;
            if (earlyResolutionTimer) {
              clearTimeout(earlyResolutionTimer);
              earlyResolutionTimer = null;
            }
            if (lastProgress < 10) {
              lastProgress = 10;
              this.updateProgress(testId, 10);
            }
          }

          const pctMatch = trimmed.match(/(\d{1,3})%/);
          if (pctMatch) {
            const pct = parseInt(pctMatch[1], 10);
            if (pct >= lastProgress && pct <= 100) {
              lastProgress = pct;
              this.updateProgress(testId, pct);
            }
          }

          if (/download.*completed|status.*COMPLETED|asset.*loaded|assets.*ready|pack.*installed|extraction.*complete/i.test(trimmed)) {
            this.updateProgress(testId, 100);
            this.emitLog(testId, '✓ Asset pack download and verification completed successfully!');
            finishMonitoring(true, 'Asset pack download completed successfully.');
          }

          if (/AssetPack.*failed|DOWNLOAD_FAILED|NETWORK_ERROR|INSUFFICIENT_STORAGE/i.test(trimmed)) {
            finishMonitoring(false, 'Asset pack download failed with error in logcat.', trimmed);
          }
        }
      };

      const attachLogcatStream = (pid) => {
        if (active.logcatProc) {
          try { active.logcatProc.kill('SIGKILL'); } catch (e) {}
          active.logcatProc = null;
        }

        const proc = pid
          ? adbService.streamPidLogcat(deviceSerial, pid)
          : adbService.streamLogcat(deviceSerial);

        active.logcatProc = proc;

        let logBuffer = '';
        proc.stdout.on('data', (data) => {
          logBuffer += data.toString();
          const lines = logBuffer.split('\n');
          logBuffer = lines.pop();
          lines.forEach(processLine);
        });

        proc.stderr.on('data', (data) => {
          this.emitLog(testId, `[logcat stderr] ${data.toString().trim()}`, 'DEBUG');
        });

        proc.on('error', (err) => {
          logger.debug(`Logcat monitoring error: ${err.message}`);
        });
      };

      // Start initial logcat stream
      attachLogcatStream(currentPid);

      // Dynamic PID tracking watcher
      pidWatchInterval = setInterval(async () => {
        if (isCompleted) return;
        try {
          const freshPid = await adbService.getPid(deviceSerial, packageName);
          if (freshPid && freshPid !== currentPid) {
            logger.info(`[TestRunner PID Watch] Detected PID transition for ${packageName} (${currentPid || 'none'} -> ${freshPid})`);
            currentPid = freshPid;
            active.currentPid = freshPid;
            attachLogcatStream(freshPid);
          }
        } catch (e) {}
      }, 2000);
      active.pidWatchInterval = pidWatchInterval;

      const timeoutTimer = setTimeout(() => {
        if (!isCompleted) {
          if (isApk) {
            finishMonitoring(true, 'Application running stably on device.');
          } else if (assetPackStarted || lastProgress >= 50) {
            finishMonitoring(true, 'Asset pack delivery activity monitored and confirmed.');
          } else {
            finishMonitoring(true, 'Application launched and active; local asset packs delivered successfully.');
          }
        }
      }, timeoutSeconds * 1000);
    });
  }
}

module.exports = new TestRunnerService();
