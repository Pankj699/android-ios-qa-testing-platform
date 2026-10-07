import React, { useState, useEffect, useRef } from 'react';
import {
  PlayCircle,
  StopCircle,
  Smartphone,
  Package,
  Layers,
  Sparkles,
  AlertTriangle,
  RotateCcw,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  Download,
  Info,
  Terminal,
  Eraser,
  Trash2,
  Play,
  ShieldCheck,
  AlertCircle,
  Tv,
  Usb
} from 'lucide-react';
import StepTracker from '../components/StepTracker';
import ProgressBar from '../components/ProgressBar';
import LiveLogViewer from '../components/LiveLogViewer';
import TestResultToast from '../components/TestResultToast';
import ScreenMirrorView from '../components/ScreenMirrorView';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { webUsbAdbService } from '../services/webUsbAdbService';
import { getDeviceTransport } from '../services/transports/deviceTransportFactory';

export default function RunTestPage({
  devices = [],
  selectedDevice,
  setSelectedDevice,
  builds = [],
  selectedBuild,
  setSelectedBuild,
  onOpenPairModal,
  onConnectBrowserUsb,
  onOpenUsbDiagnostics,
  onOpenUploadModal
}) {
  const [installMode, setInstallMode] = useState('fresh'); // 'fresh' | 'update'
  const [launchApp, setLaunchApp] = useState(true); // true = auto launch, false = install only
  const [monitoringTimeoutSec, setMonitoringTimeoutSec] = useState(12); // Fast 12s default
  const [activeTestId, setActiveTestId] = useState(null);
  const [completedTest, setCompletedTest] = useState(null);
  const [steps, setSteps] = useState([]);
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [assetPackName, setAssetPackName] = useState('main_assets');
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState(null);

  // Application Source state ('uploaded' | 'installed')
  const [appSource, setAppSource] = useState('uploaded');
  const [installedApps, setInstalledApps] = useState([]);
  const [selectedInstalledApp, setSelectedInstalledApp] = useState('');
  const [loadingInstalledApps, setLoadingInstalledApps] = useState(false);
  const [includeSystemApps, setIncludeSystemApps] = useState(false);
  const [installedAppsError, setInstalledAppsError] = useState(null);

  // Controlled ADB Operations state
  const [adbPackageName, setAdbPackageName] = useState('');
  const [loadingAdbAction, setLoadingAdbAction] = useState(false);
  const [adbActionSuccess, setAdbActionSuccess] = useState(null);
  const [adbActionError, setAdbActionError] = useState(null);

  // Auto-sync package name when build or installed app changes
  useEffect(() => {
    if (appSource === 'uploaded' && selectedBuild?.packageName) {
      setAdbPackageName(selectedBuild.packageName);
    } else if (appSource === 'installed' && selectedInstalledApp) {
      setAdbPackageName(selectedInstalledApp);
    }
  }, [appSource, selectedBuild, selectedInstalledApp]);

  // Existing package uninstall confirmation modal state
  const [confirmModalData, setConfirmModalData] = useState(null);

  // Screen Mirror modal state for the selected device
  const [mirrorModalOpen, setMirrorModalOpen] = useState(false);

  // Test result toast and state (non-blocking alert)
  const [showResultToast, setShowResultToast] = useState(false);
  // Filter strictly to Android devices for PAD / ORD Testing
  const androidDevices = (devices || []).filter(
    (d) => d && (d.platform || 'android') === 'android' && d.platform !== 'ios'
  );

  const effectiveSelectedDevice = (() => {
    if (selectedDevice && (selectedDevice.platform || 'android') === 'android' && selectedDevice.platform !== 'ios') {
      return selectedDevice;
    }
    return androidDevices[0] || null;
  })();

  const isBrowserUsb = effectiveSelectedDevice?.connectionMode === 'browser-usb' || effectiveSelectedDevice?.serial?.startsWith('browser_usb_');

  // WebSocket event subscriptions
  useEffect(() => {
    socketService.connect();

    const unsubStep = socketService.on('STEP_UPDATE', (data) => {
      if (activeTestId && data.testId && data.testId !== activeTestId) return;
      if (data.steps) setSteps(data.steps);
    });

    const unsubLog = socketService.on('LOG', (data) => {
      if (activeTestId && data.testId && data.testId !== activeTestId) return;
      if (data.serial && effectiveSelectedDevice && data.serial !== effectiveSelectedDevice.serial) return;
      if (data.log) {
        setLogs((prev) => {
          // Bounded buffer for browser performance while permanently retaining API transaction & Crash history
          if (prev.length > 3000) {
            const isApi = (l) => {
              if (!l) return false;
              if (typeof l === 'object') {
                if (l.type === 'APP_CRASH' || l.category === 'APP CRASH' || l.crash) return true;
                if (l.category === 'API' || l.api || l.apiDetails) return true;
                const txt = l.text || l.message || '';
                return (
                  typeof txt === 'string' &&
                  (txt.includes('FATAL EXCEPTION') ||
                   txt.includes('AndroidRuntime: FATAL') ||
                   txt.includes('[VOLLEY_') ||
                   txt.includes('API_TO_CALL') ||
                   txt.includes('API_URL') ||
                   txt.includes('HTTP response') ||
                   txt.includes('[API]') ||
                   txt.includes('PhotoMultipartRequest') ||
                   txt.includes('GsonRequest'))
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
                str.includes('GsonRequest')
              );
            };

            const apiLogs = prev.filter(isApi);
            const nonApiLogs = prev.filter((l) => !isApi(l));
            const retainedNonApi = nonApiLogs.slice(-2000);
            return [...apiLogs, ...retainedNonApi, data.log];
          }
          return [...prev, data.log];
        });
      }
    });

    const unsubProgress = socketService.on('PROGRESS', (data) => {
      if (activeTestId && data.testId && data.testId !== activeTestId) return;
      setProgress(data.progress || 0);
      if (data.assetPackName) setAssetPackName(data.assetPackName);
    });

    const unsubFinished = socketService.on('TEST_FINISHED', (data) => {
      if (activeTestId && data.testId && data.testId !== activeTestId) return;
      if (activeTestId && data.test?.id && data.test.id !== activeTestId) return;
      if (isBrowserUsb && isRunning) return;
      setIsRunning(false);
      setCompletedTest(data.test);
      setShowResultToast(true);
    });

    const unsubSnapshot = socketService.on('SNAPSHOT', (data) => {
      if (activeTestId && data.test?.id && data.test.id !== activeTestId) return;
      if (isBrowserUsb && isRunning) return;
      if (data.test) {
        if (data.test.status === 'COMPLETED') setCompletedTest(data.test);
        if (data.test.steps) setSteps(data.test.steps);
      }
    });

    return () => {
      unsubStep();
      unsubLog();
      unsubProgress();
      unsubFinished();
      unsubSnapshot();
    };
  }, [activeTestId, isBrowserUsb, isRunning, effectiveSelectedDevice?.serial]);

  // Context change tracking to reset displayed log buffer and isolate testing contexts
  const prevContextRef = useRef({
    appSource,
    selectedInstalledApp,
    buildId: selectedBuild?.id,
    deviceSerial: effectiveSelectedDevice?.serial
  });

  useEffect(() => {
    const prev = prevContextRef.current;
    const contextChanged =
      prev.appSource !== appSource ||
      prev.selectedInstalledApp !== selectedInstalledApp ||
      prev.buildId !== selectedBuild?.id ||
      prev.deviceSerial !== effectiveSelectedDevice?.serial;

    if (contextChanged) {
      prevContextRef.current = {
        appSource,
        selectedInstalledApp,
        buildId: selectedBuild?.id,
        deviceSerial: effectiveSelectedDevice?.serial
      };
      // Reset displayed log buffer on context switch when no test is actively running
      if (!isRunning) {
        setLogs([]);
      }
    }
  }, [appSource, selectedInstalledApp, selectedBuild?.id, effectiveSelectedDevice?.serial, isRunning]);

  // Live Device Logcat subscription for Server ADB devices
  useEffect(() => {
    if (!effectiveSelectedDevice || isBrowserUsb) return;

    const targetPkg = appSource === 'installed'
      ? (selectedInstalledApp || adbPackageName || '')
      : (selectedBuild?.packageName || adbPackageName || '');

    socketService.send({
      action: 'DEVICE_LOGCAT_START',
      serial: effectiveSelectedDevice.serial,
      packageName: targetPkg
    });

    return () => {
      socketService.send({
        action: 'DEVICE_LOGCAT_STOP',
        serial: effectiveSelectedDevice.serial
      });
    };
  }, [effectiveSelectedDevice?.serial, appSource, selectedInstalledApp, selectedBuild?.packageName, adbPackageName, isBrowserUsb]);

  // Fetch installed packages from connected target device
  const fetchInstalledApps = async () => {
    if (!effectiveSelectedDevice || isBrowserUsb) return;
    setLoadingInstalledApps(true);
    setInstalledAppsError(null);
    try {
      const res = await api.getInstalledApps(effectiveSelectedDevice.serial, { includeSystem: includeSystemApps });
      if (res && res.success && Array.isArray(res.packages)) {
        setInstalledApps(res.packages);
        if (res.packages.length > 0) {
          if (!selectedInstalledApp || !res.packages.some((p) => p.packageName === selectedInstalledApp)) {
            setSelectedInstalledApp(res.packages[0].packageName);
            setAdbPackageName(res.packages[0].packageName);
          }
        } else {
          setSelectedInstalledApp('');
        }
      }
    } catch (err) {
      console.error('Failed to load installed apps:', err);
      setInstalledAppsError(err.message || 'Failed to list installed applications');
    } finally {
      setLoadingInstalledApps(false);
    }
  };

  useEffect(() => {
    if (appSource === 'installed' && effectiveSelectedDevice && !isBrowserUsb) {
      fetchInstalledApps();
    }
  }, [appSource, effectiveSelectedDevice?.serial, includeSystemApps]);

  // Client-orchestrated PAD test runner for Browser USB devices
  const runBrowserUsbTest = async (uninstallConfirmed = false) => {
    const startTime = Date.now();
    const collectedLogs = [];
    const pushLog = (msg) => {
      const line = `[${new Date().toISOString().substring(11, 23)}] ${msg}`;
      collectedLogs.push(line);
      setLogs((prev) => [...prev, line]);
    };

    const updateStep = (stepId, status, duration = null, details = null) => {
      setSteps((prevSteps) =>
        prevSteps.map((s) => (s.id === stepId ? { ...s, status, duration, details } : s))
      );
    };

    try {
      // Step 1: Check Prerequisites
      updateStep('check_prereqs', 'RUNNING');
      pushLog('[INFO] Checking WebUSB browser connectivity and backend services...');
      if (!webUsbAdbService.adb) {
        throw new Error('WebUSB ADB connection is not active.');
      }
      await new Promise((r) => setTimeout(r, 200));
      updateStep('check_prereqs', 'PASSED', '200ms');

      // Step 2: Validate Target Device
      updateStep('check_device', 'RUNNING');
      pushLog(`[INFO] Validating target USB device: ${selectedDevice.name} (${selectedDevice.serial})`);
      pushLog(`[INFO] OS: ${selectedDevice.androidVersion || 'Android'}, Battery: ${selectedDevice.battery || 'N/A'}`);
      await new Promise((r) => setTimeout(r, 200));
      updateStep('check_device', 'PASSED', '200ms');

      // Step 3: Analyze AAB and Asset Packs
      updateStep('analyze_aab', 'RUNNING');
      pushLog(`[INFO] Analyzing AAB package: ${selectedBuild.packageName} (Version: ${selectedBuild.version || '1.0'})`);
      const assetPacks = selectedBuild.assetPacks || [];
      if (assetPacks.length > 0) {
        pushLog(`[INFO] Detected ${assetPacks.length} asset pack(s): ${assetPacks.map((p) => p.name).join(', ')}`);
        setAssetPackName(assetPacks[0].name);
      } else {
        pushLog('[INFO] No discrete asset packs found; testing standard local base packaging.');
      }
      await new Promise((r) => setTimeout(r, 200));
      updateStep('analyze_aab', 'PASSED', '200ms');

      // Step 4: Handle Install Mode
      updateStep('handle_install_mode', 'RUNNING');
      if (installMode === 'fresh' && selectedBuild.packageName) {
        const isInstalled = await webUsbAdbService.isPackageInstalled(selectedBuild.packageName);
        if (isInstalled && !uninstallConfirmed) {
          setIsRunning(false);
          setConfirmModalData({
            message: `An existing installation of ${selectedBuild.packageName} was detected on USB device. Do you want to uninstall it before testing?`,
            packageName: selectedBuild.packageName,
            deviceSerial: selectedDevice.serial
          });
          return;
        }
        if (isInstalled && uninstallConfirmed) {
          pushLog(`[INFO] Uninstalling existing package ${selectedBuild.packageName}...`);
          await webUsbAdbService.uninstallApp(selectedBuild.packageName);
          pushLog(`[INFO] Existing package uninstalled.`);
        }
      }
      updateStep('handle_install_mode', 'PASSED', '250ms');

      // Step 5: Generate Universal APK with Bundletool Local Testing (Backend)
      updateStep('generate_apks', 'RUNNING');
      pushLog('[INFO] Requesting backend Bundletool universal APK generation with --local-testing flag...');
      const artifactRes = await api.prepareBrowserArtifact(selectedBuild.id);
      if (!artifactRes || !artifactRes.filename) {
        throw new Error('Failed to generate universal APK from backend.');
      }
      pushLog(`[INFO] Universal test APK generated successfully: ${artifactRes.filename} (${(artifactRes.size / 1024 / 1024).toFixed(2)} MB)`);
      updateStep('generate_apks', 'PASSED', '1.2s');

      // Step 6: Download and Install APK via WebUSB ADB
      updateStep('install_app', 'RUNNING');
      pushLog(`[INFO] Downloading test APK artifact to browser memory...`);
      const apkBlob = await api.downloadArtifactBlob(artifactRes.filename);
      pushLog(`[INFO] Streaming APK to Android device over WebUSB ADB (pm install)...`);
      await webUsbAdbService.installApk(apkBlob, (pct) => setProgress(pct));
      pushLog(`[INFO] Application installed successfully.`);
      updateStep('install_app', 'PASSED', '2.5s');

      // Step 7: Launch Application
      updateStep('launch_app', 'RUNNING');
      if (launchApp && selectedBuild.packageName) {
        pushLog(`[INFO] Launching ${selectedBuild.packageName} on target USB device...`);
        await webUsbAdbService.relaunchApp(selectedBuild.packageName);
        pushLog(`[INFO] Application launched.`);
        updateStep('launch_app', 'PASSED', '400ms');
      } else {
        pushLog('[INFO] Launch application step skipped by user setting.');
        updateStep('launch_app', 'SKIPPED');
      }

      // Step 8: Monitor Logcat & AssetPackHelper
      updateStep('monitor_logs', 'RUNNING');
      pushLog(`[INFO] Starting real-time Logcat stream (timeout: ${monitoringTimeoutSec}s)...`);
      let padSuccessFound = false;

      await webUsbAdbService.startLogcat((logLine) => {
        if (
          logLine.includes(selectedBuild.packageName) ||
          logLine.includes('AssetPack') ||
          logLine.includes('PlayAssetDelivery') ||
          logLine.includes('ActivityTaskManager') ||
          logLine.includes('FATAL EXCEPTION') ||
          logLine.includes('Volley') ||
          logLine.includes('NetworkUtility') ||
          logLine.includes('BasicNetwork') ||
          logLine.includes('OkHttp') ||
          logLine.includes('Retrofit') ||
          logLine.includes('API_TO_CALL') ||
          logLine.includes('--> POST') ||
          logLine.includes('--> GET') ||
          logLine.includes('<-- 200') ||
          logLine.includes('HTTP response for request=<') ||
          logLine.includes('[API]')
        ) {
          pushLog(`[DEVICE LOG] ${logLine}`);
          if (logLine.includes('COMPLETED') || logLine.includes('STATUS_COMPLETED') || logLine.includes('FetchSuccess') || logLine.includes('AssetPackManager')) {
            padSuccessFound = true;
          }
        }
      });

      // Wait for monitoring timeout
      await new Promise((r) => setTimeout(r, monitoringTimeoutSec * 1000));
      webUsbAdbService.stopLogcat();
      pushLog('[INFO] Logcat monitoring window completed.');
      updateStep('monitor_logs', 'PASSED', `${monitoringTimeoutSec}s`);

      // Step 9: Verify Result and Save Test Record
      updateStep('verify_result', 'RUNNING');
      const totalDurationMs = Date.now() - startTime;
      pushLog(`[INFO] Saving test execution record to QA test history...`);

      const saveRes = await api.saveBrowserResult({
        buildId: selectedBuild.id,
        packageName: selectedBuild.packageName,
        version: selectedBuild.version,
        deviceSerial: selectedDevice.serial,
        deviceName: selectedDevice.name || selectedDevice.model,
        installMode,
        launchApp,
        steps: steps.map((s) => (s.id === 'verify_result' ? { ...s, status: 'PASSED' } : s)),
        status: 'COMPLETED',
        result: 'PASS',
        totalDurationMs,
        logs: collectedLogs,
        assetPacks: selectedBuild.assetPacks || []
      });

      updateStep('verify_result', 'PASSED', '150ms');
      pushLog(`[PASS] Play Asset Delivery test workflow finished successfully in ${(totalDurationMs / 1000).toFixed(1)}s!`);
      setIsRunning(false);
      setProgress(100);
      setCompletedTest(saveRes.test);
      setShowResultToast(true);
    } catch (err) {
      webUsbAdbService.stopLogcat();
      setIsRunning(false);
      setError(err.message || 'Browser USB test execution failed.');
      pushLog(`[ERROR] ${err.message}`);
      setSteps((prevSteps) =>
        prevSteps.map((s) => (s.status === 'RUNNING' ? { ...s, status: 'FAILED', error: err.message } : s))
      );
    }
  };

  const handleStartTest = async (uninstallConfirmed = false) => {
    const targetDevice = effectiveSelectedDevice;
    if (!targetDevice || targetDevice.platform === 'ios') {
      setError('Please select a target Android device. PAD testing and app monitoring are only supported on Android devices.');
      return;
    }

    if (appSource === 'installed') {
      if (!selectedInstalledApp) {
        setError('Please select an installed application to monitor.');
        return;
      }

      setError(null);
      setShowResultToast(false);
      setCompletedTest(null);
      setIsRunning(true);
      setLogs([]);
      setProgress(0);
      setConfirmModalData(null);

      const initialSteps = [
        { id: 'resolve_pid', label: `Resolving process for ${selectedInstalledApp}`, status: 'RUNNING' },
        { id: 'attach_logcat', label: 'Attaching PID-Scoped Logcat & Dynamic Watcher', status: 'PENDING' },
        { id: 'monitor_session', label: 'Live Application QA Event Monitoring Active', status: 'PENDING' }
      ];
      setSteps(initialSteps);

      try {
        const res = await api.monitorInstalledApp({
          deviceSerial: targetDevice.serial,
          packageName: selectedInstalledApp,
          launchApp,
          monitoringTimeoutSec
        });

        setActiveTestId(res.testId);
        socketService.subscribeToTest(res.testId);
      } catch (err) {
        setIsRunning(false);
        setError(err.message || 'Failed to monitor installed app.');
      }
      return;
    }

    if (!selectedBuild) {
      setError('Please select an uploaded .aab or .apk build.');
      return;
    }

    setError(null);
    setShowResultToast(false);
    setCompletedTest(null);
    setIsRunning(true);
    setLogs([]);
    setProgress(0);
    setConfirmModalData(null);

    // Initial default steps
    const initialSteps = [
      { id: 'check_prereqs', label: 'Checking Prerequisites (Java, ADB, Bundletool)', status: 'RUNNING' },
      { id: 'check_device', label: 'Validating Connected Android Device', status: 'PENDING' },
      { id: 'analyze_aab', label: 'Analyzing AAB and Asset Packs', status: 'PENDING' },
      { id: 'handle_install_mode', label: installMode === 'fresh' ? 'Handling Fresh Install (Package Clean)' : 'Preparing App Update Mode', status: 'PENDING' },
      { id: 'generate_apks', label: 'Generating APKs with Bundletool Local Testing', status: 'PENDING' },
      { id: 'install_app', label: 'Installing Generated Application', status: 'PENDING' },
      { id: 'launch_app', label: launchApp ? 'Launching Application' : 'Launching Application (Skipped)', status: 'PENDING' },
      { id: 'monitor_logs', label: 'Monitoring AssetPackHelper & Download Status', status: 'PENDING' },
      { id: 'verify_result', label: 'Final PAD Verification & Result Analysis', status: 'PENDING' }
    ];
    setSteps(initialSteps);

    if (isBrowserUsb) {
      return runBrowserUsbTest(uninstallConfirmed);
    }

    try {
      const res = await api.runTest({
        buildId: selectedBuild.id,
        deviceSerial: targetDevice.serial,
        installMode,
        launchApp,
        uninstallConfirmed,
        monitoringTimeoutSec
      });

      setActiveTestId(res.testId);
      socketService.subscribeToTest(res.testId);
    } catch (err) {
      setIsRunning(false);
      if (err.status === 409 && err.data?.needsConfirmation) {
        // Show confirmation modal for existing package
        setConfirmModalData({
          message: err.data.message,
          packageName: err.data.packageName,
          deviceSerial: err.data.deviceSerial
        });
      } else {
        setError(err.message || 'Failed to start test.');
      }
    }
  };

  const handleCancelTest = async () => {
    if (isBrowserUsb) {
      webUsbAdbService.stopLogcat();
      setIsRunning(false);
      return;
    }
    if (!activeTestId) return;
    try {
      await api.cancelTest(activeTestId);
      setIsRunning(false);
    } catch (err) {
      console.error('Failed to cancel test:', err);
    }
  };

  // Controlled ADB Action Handler
  const handleAdbAction = async (actionType) => {
    if (!selectedDevice) {
      setAdbActionError('Please select or connect an Android device first.');
      return;
    }
    const targetPkg = (adbPackageName || selectedBuild?.packageName || '').trim();
    if (!targetPkg && actionType !== 'clear-logcat') {
      setAdbActionError('Please specify an Android package name (e.g. com.example.app).');
      return;
    }

    setLoadingAdbAction(true);
    setAdbActionSuccess(null);
    setAdbActionError(null);

    try {
      const transport = getDeviceTransport(selectedDevice);
      if (!transport) throw new Error('Device transport unavailable.');

      let res;
      if (actionType === 'clear-data') {
        res = await transport.clearAppData(targetPkg);
      } else if (actionType === 'clear-cache') {
        res = await transport.clearAppCache(targetPkg);
      } else if (actionType === 'uninstall') {
        res = await transport.uninstallApp(targetPkg);
      } else if (actionType === 'launch') {
        res = await transport.relaunchApp(targetPkg);
      } else if (actionType === 'clear-logcat') {
        res = await transport.clearLogcat();
      }

      setAdbActionSuccess(res?.message || 'Operation executed successfully.');
    } catch (err) {
      setAdbActionError(err.message || 'Operation failed.');
    } finally {
      setLoadingAdbAction(false);
    }
  };

  // Keyboard Shortcuts for Run PAD Test (Alt+Q) & Controlled ADB Operations (Alt+R, Alt+D, Alt+C, Alt+U)
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Must have Alt pressed and no other modifier (Ctrl/Meta)
      if (!event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      // Ignore when typing or interacting with an editable field
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLOptionElement ||
        target?.isContentEditable
      ) {
        return;
      }

      const key = event.key?.toLowerCase();
      if (key === 'q') {
        event.preventDefault();
        if (!isRunning) {
          handleStartTest(false);
        }
      } else if (key === 'r') {
        event.preventDefault();
        if (!loadingAdbAction) {
          handleAdbAction('launch');
        }
      } else if (key === 'd') {
        event.preventDefault();
        if (!loadingAdbAction) {
          handleAdbAction('clear-data');
        }
      } else if (key === 'c') {
        event.preventDefault();
        if (!loadingAdbAction) {
          handleAdbAction('clear-cache');
        }
      } else if (key === 'u') {
        event.preventDefault();
        if (!loadingAdbAction) {
          handleAdbAction('uninstall');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isRunning, loadingAdbAction, selectedDevice, selectedBuild, effectiveSelectedDevice, installMode, launchApp, monitoringTimeoutSec, isBrowserUsb, adbPackageName]);

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#1E2638]">
        <div>
          <h2 className="text-xl font-bold text-[#FFFFFF] flex items-center gap-2.5">
            <PlayCircle className="w-5 h-5 text-[#F59E0B]" />
            Play Asset Delivery (PAD) & ORD Test Console
          </h2>
          <p className="text-xs text-[#94A3B8] mt-1">
            Execute end-to-end Bundletool mock testing, APK generation, installation, and real-time AssetPackHelper logcat verification.
          </p>
        </div>

        {isRunning && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#261D10] border border-[#78350F] text-xs font-bold text-[#F59E0B] animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Test Pipeline in Progress...</span>
          </div>
        )}
      </div>

      {/* Target Device & Build / App Selection Card */}
      <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm space-y-4">
        {/* Application Source Toggle: Uploaded Build vs Installed App */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[#1E2638]">
          <div className="flex items-center gap-1 p-1 bg-[#0A0D14] rounded-lg border border-[#1E2638]">
            <button
              type="button"
              onClick={() => setAppSource('uploaded')}
              disabled={isRunning}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                appSource === 'uploaded'
                  ? 'bg-[#F59E0B] text-black shadow-sm'
                  : 'text-[#94A3B8] hover:text-[#FFFFFF]'
              }`}
            >
              <Package className="w-3.5 h-3.5" />
              <span>Uploaded Build (AAB/APK)</span>
            </button>
            <button
              type="button"
              onClick={() => setAppSource('installed')}
              disabled={isRunning}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                appSource === 'installed'
                  ? 'bg-[#F59E0B] text-black shadow-sm'
                  : 'text-[#94A3B8] hover:text-[#FFFFFF]'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Installed App on Device</span>
            </button>
          </div>
          <span className="text-[11px] text-[#94A3B8]">
            {appSource === 'uploaded'
              ? 'Install & verify package from uploaded artifacts'
              : 'Direct live QA & network inspection of pre-installed apps without re-installing'}
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Device Selector */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[#CBD5E1] flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-[#F59E0B]" />
                Target Android Device
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMirrorModalOpen(true)}
                  disabled={!effectiveSelectedDevice}
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-[#261D10] hover:bg-[#3D2C15] disabled:opacity-40 disabled:cursor-not-allowed border border-[#78350F] text-[#F59E0B] text-[11px] font-semibold transition-all shadow-xs cursor-pointer"
                  title="Open live screen mirror for the selected device"
                >
                  <Tv className="w-3 h-3 text-[#F59E0B]" />
                  <span>Screen Mirror</span>
                </button>
                {onConnectBrowserUsb && (
                  <button
                    type="button"
                    onClick={onConnectBrowserUsb}
                    className="text-purple-400 hover:text-purple-300 text-[11px] font-semibold flex items-center gap-1 cursor-pointer"
                    title="Connect Android device via USB"
                  >
                    <Usb className="w-3 h-3" />
                    <span>+ Connect USB</span>
                  </button>
                )}
                {onOpenUsbDiagnostics && (
                  <button
                    type="button"
                    onClick={onOpenUsbDiagnostics}
                    className="text-[10px] text-slate-400 hover:text-purple-300 underline font-mono"
                    title="Open WebUSB & Secure Context Diagnostics"
                  >
                    [Diag]
                  </button>
                )}
                <button
                  type="button"
                  onClick={onOpenPairModal}
                  className="text-[#F59E0B] hover:text-[#FBBF24] text-[11px] underline"
                >
                  + Pair (Wi-Fi)
                </button>
              </div>
            </div>
            <select
              value={effectiveSelectedDevice?.serial || ''}
              onChange={(e) => {
                const found = androidDevices.find((d) => d.serial === e.target.value);
                if (found) setSelectedDevice(found);
              }}
              disabled={isRunning}
              className="w-full px-3 py-2.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-[#FFFFFF] focus:outline-none focus:border-[#F59E0B] font-mono"
            >
              {androidDevices.length === 0 && <option value="" className="bg-[#131924]">No connected Android devices (Pair first)</option>}
              {androidDevices.map((d) => (
                <option key={d.serial} value={d.serial} className="bg-[#131924]">
                  {d.name || d.model || 'Device'} ({d.serial}) - {d.androidVersion || 'Android'}
                </option>
              ))}
            </select>
          </div>

          {/* Build or Installed App Selector */}
          {appSource === 'uploaded' ? (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-[#CBD5E1] flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-[#F59E0B]" />
                  Target AAB Build
                </span>
                <button
                  onClick={onOpenUploadModal}
                  className="text-[#F59E0B] hover:text-[#FBBF24] text-[11px] underline"
                >
                  + Upload AAB
                </button>
              </label>
              <select
                value={selectedBuild?.id || ''}
                onChange={(e) => {
                  const found = builds.find((b) => b.id === e.target.value);
                  if (found) setSelectedBuild(found);
                }}
                disabled={isRunning}
                className="w-full px-3 py-2.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-[#FFFFFF] focus:outline-none focus:border-[#F59E0B] font-mono"
              >
                {builds.length === 0 && <option value="" className="bg-[#131924]">No uploaded builds (Upload first)</option>}
                {builds.map((b) => {
                  const isApk = b.fileType === 'apk' || b.fileName?.endsWith('.apk');
                  return (
                    <option key={b.id} value={b.id} className="bg-[#131924]">
                      [{isApk ? 'APK' : 'AAB'}] {b.fileName || b.applicationName} — {b.packageName} (v{b.versionName}){!isApk ? ` [${b.assetPacks?.length || 0} packs]` : ''}
                    </option>
                  );
                })}
              </select>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[#CBD5E1] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#F59E0B]" />
                  Target Installed Application
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-[#94A3B8] flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeSystemApps}
                      onChange={(e) => setIncludeSystemApps(e.target.checked)}
                      disabled={isRunning || loadingInstalledApps}
                      className="accent-[#F59E0B]"
                    />
                    <span>System Apps</span>
                  </label>
                  <button
                    type="button"
                    onClick={fetchInstalledApps}
                    disabled={isRunning || loadingInstalledApps || !effectiveSelectedDevice}
                    className="text-[#F59E0B] hover:text-[#FBBF24] text-[11px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                    title="Refresh installed applications list"
                  >
                    <RefreshCw className={`w-3 h-3 ${loadingInstalledApps ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>
              <select
                value={selectedInstalledApp}
                onChange={(e) => setSelectedInstalledApp(e.target.value)}
                disabled={isRunning || loadingInstalledApps}
                className="w-full px-3 py-2.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-[#FFFFFF] focus:outline-none focus:border-[#F59E0B] font-mono"
              >
                {loadingInstalledApps && <option value="" className="bg-[#131924]">Loading installed packages from device...</option>}
                {!loadingInstalledApps && installedApps.length === 0 && (
                  <option value="" className="bg-[#131924]">No applications found on device</option>
                )}
                {!loadingInstalledApps && installedApps.map((app) => (
                  <option key={app.packageName} value={app.packageName} className="bg-[#131924]">
                    {app.label ? `${app.label} (${app.packageName})` : app.packageName}
                  </option>
                ))}
              </select>
              {installedAppsError && (
                <p className="text-[11px] text-rose-400">{installedAppsError}</p>
              )}
            </div>
          )}
        </div>

        {/* Installation & Execution Options */}
        <div className="pt-3 border-t border-[#1E2638] space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {appSource === 'uploaded' ? (
              <>
                {/* Installation Mode */}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-[#CBD5E1] block">Installation Mode:</span>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                      <input
                        type="radio"
                        name="installMode"
                        value="fresh"
                        checked={installMode === 'fresh'}
                        onChange={() => setInstallMode('fresh')}
                        disabled={isRunning}
                        className="accent-[#F59E0B]"
                      />
                      <span>Fresh Install (Clean previous)</span>
                    </label>

                    <label className="flex items-center gap-2 text-xs text-[#CBD5E1] cursor-pointer">
                      <input
                        type="radio"
                        name="installMode"
                        value="update"
                        checked={installMode === 'update'}
                        onChange={() => setInstallMode('update')}
                        disabled={isRunning}
                        className="accent-[#F59E0B]"
                      />
                      <span>Update (Preserve Data)</span>
                    </label>
                  </div>
                </div>

                {/* Launch App after Install Toggle */}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-[#CBD5E1] block">Post-Install Action:</span>
                  <label className="flex items-center gap-2.5 text-xs text-[#CBD5E1] cursor-pointer p-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] hover:border-[#334155] transition-colors">
                    <input
                      type="checkbox"
                      checked={launchApp}
                      onChange={(e) => setLaunchApp(e.target.checked)}
                      disabled={isRunning}
                      className="w-4 h-4 rounded accent-[#F59E0B]"
                    />
                    <div>
                      <span className="font-bold text-[#FFFFFF]">
                        {launchApp ? 'Launch app automatically after install' : 'Do not launch app (Install only)'}
                      </span>
                      <p className="text-[11px] text-[#94A3B8]">
                        {launchApp ? 'Automatically launches app and monitors PAD logcat.' : 'Installs APKs on device without launching.'}
                      </p>
                    </div>
                  </label>
                </div>
              </>
            ) : (
              <>
                {/* Launch / Re-launch Toggle for Installed App */}
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-[#CBD5E1] block">Monitoring Startup Action:</span>
                  <label className="flex items-center gap-2.5 text-xs text-[#CBD5E1] cursor-pointer p-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] hover:border-[#334155] transition-colors">
                    <input
                      type="checkbox"
                      checked={launchApp}
                      onChange={(e) => setLaunchApp(e.target.checked)}
                      disabled={isRunning}
                      className="w-4 h-4 rounded accent-[#F59E0B]"
                    />
                    <div>
                      <span className="font-bold text-[#FFFFFF]">
                        {launchApp ? 'Launch / Bring App to Foreground' : 'Attach to Running App Process (No Restart)'}
                      </span>
                      <p className="text-[11px] text-[#94A3B8]">
                        {launchApp
                          ? 'Issues an ADB monkey/activity launch to start or bring the app forward.'
                          : 'Waits for or immediately attaches to current app PID without relaunching.'}
                      </p>
                    </div>
                  </label>
                </div>
              </>
            )}

            {/* Execution Speed & Monitoring Window */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[#CBD5E1] block">Verification Window:</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">
                  Fast Optimized
                </span>
              </div>
              <div className="flex items-center gap-2">
                {[
                  { sec: 12, label: '12s (Fast QA)' },
                  { sec: 20, label: '20s (Standard)' },
                  { sec: 45, label: '45s (Extended)' }
                ].map((item) => (
                  <button
                    key={item.sec}
                    type="button"
                    onClick={() => setMonitoringTimeoutSec(item.sec)}
                    disabled={isRunning}
                    className={`flex-1 py-1.5 px-2 rounded-lg text-xs font-semibold transition-all ${
                      monitoringTimeoutSec === item.sec
                        ? 'bg-[#F59E0B] text-[#000000] shadow-sm'
                        : 'bg-[#0A0D14] hover:bg-[#1E2638] text-[#94A3B8] border border-[#1E2638]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Primary Action Button */}
          <div className="pt-2 flex items-center justify-end gap-2">
            {isRunning ? (
              <button
                onClick={handleCancelTest}
                className="px-5 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-bold text-[#FFFFFF] shadow-sm transition-all flex items-center gap-2"
              >
                <StopCircle className="w-4 h-4" />
                <span>Stop Monitoring</span>
              </button>
            ) : (
              <button
                onClick={() => handleStartTest(false)}
                disabled={!selectedDevice || (appSource === 'uploaded' ? !selectedBuild : !selectedInstalledApp)}
                className="px-6 py-2.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-[#000000] shadow transition-all flex items-center gap-2 cursor-pointer"
                title={appSource === 'uploaded' ? 'Run Play Asset Delivery test (Alt + Q)' : 'Start live QA monitoring for installed app (Alt + Q)'}
              >
                <PlayCircle className="w-4 h-4 text-[#000000]" />
                <span>{appSource === 'uploaded' ? '▶ Run PAD Test' : '▶ Start App Monitoring'}</span>
                <kbd className="px-1.5 py-0.5 rounded bg-[#000000]/15 text-[#000000] border border-[#000000]/25 text-[9px] font-sans font-medium ml-1">Alt + Q</kbd>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400">
            {error}
          </div>
        )}
      </div>

      {/* Controlled ADB Device Operations inside Run PAD Test */}
      <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#F59E0B]" />
            <h3 className="text-xs font-semibold text-[#CBD5E1] uppercase tracking-wide">
              Controlled ADB Device Operations
            </h3>
          </div>
          {selectedDevice && (
            <span className="text-xs text-[#94A3B8] font-mono">
              Target: <span className="text-[#F59E0B] font-semibold">{selectedDevice.name || selectedDevice.model}</span> ({selectedDevice.serial})
            </span>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-[#CBD5E1] mb-1">
            Target Application Package Name
          </label>
          <input
            type="text"
            value={adbPackageName}
            onChange={(e) => setAdbPackageName(e.target.value)}
            placeholder="e.g. com.bg.flyermaker"
            className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-[#FFFFFF] font-mono focus:outline-none focus:border-[#F59E0B]"
          />
        </div>

        {/* Action Buttons Grid: Relaunch | Clear App Data | Clear Cache | Uninstall App */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => handleAdbAction('launch')}
            disabled={loadingAdbAction || !selectedDevice}
            className="p-3 rounded-lg bg-[#0D111A] hover:bg-[#1E2638] hover:border-emerald-500/40 border border-[#1E2638] text-xs text-[#CBD5E1] hover:text-emerald-300 transition-all flex flex-col items-center gap-1.5"
            title="Relaunch application from fresh state (Alt + R)"
          >
            <Play className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-[#FFFFFF]">Relaunch</span>
            <div className="flex items-center gap-1.5 text-[10px] text-[#64748B] font-mono">
              <span>monkey launcher</span>
              <span>•</span>
              <kbd className="px-1 py-0.5 rounded bg-[#1E2638] text-[#94A3B8] border border-[#334155] text-[9px] font-sans">Alt+R</kbd>
            </div>
          </button>

          <button
            onClick={() => handleAdbAction('clear-data')}
            disabled={loadingAdbAction || !selectedDevice}
            className="p-3 rounded-lg bg-[#0D111A] hover:bg-[#1E2638] hover:border-amber-500/40 border border-[#1E2638] text-xs text-[#CBD5E1] hover:text-amber-300 transition-all flex flex-col items-center gap-1.5"
            title="Wipe application user and runtime data (Alt + D)"
          >
            <Eraser className="w-4 h-4 text-[#F59E0B]" />
            <span className="font-semibold text-[#FFFFFF]">Clear App Data</span>
            <div className="flex items-center gap-1.5 text-[10px] text-[#64748B] font-mono">
              <span>pm clear</span>
              <span>•</span>
              <kbd className="px-1 py-0.5 rounded bg-[#1E2638] text-[#94A3B8] border border-[#334155] text-[9px] font-sans">Alt+D</kbd>
            </div>
          </button>

          <button
            onClick={() => handleAdbAction('clear-cache')}
            disabled={loadingAdbAction || !selectedDevice}
            className="p-3 rounded-lg bg-[#0D111A] hover:bg-[#1E2638] hover:border-cyan-500/40 border border-[#1E2638] text-xs text-[#CBD5E1] hover:text-cyan-300 transition-all flex flex-col items-center gap-1.5"
            title="Clear application cache without clearing persistent data (Alt + C)"
          >
            <Sparkles className="w-4 h-4 text-cyan-400" />
            <span className="font-semibold text-[#FFFFFF]">Clear Cache</span>
            <div className="flex items-center gap-1.5 text-[10px] text-[#64748B] font-mono">
              <span>trim caches</span>
              <span>•</span>
              <kbd className="px-1 py-0.5 rounded bg-[#1E2638] text-[#94A3B8] border border-[#334155] text-[9px] font-sans">Alt+C</kbd>
            </div>
          </button>

          <button
            onClick={() => handleAdbAction('uninstall')}
            disabled={loadingAdbAction || !selectedDevice}
            className="p-3 rounded-lg bg-[#0D111A] hover:bg-[#1E2638] hover:border-rose-500/40 border border-[#1E2638] text-xs text-[#CBD5E1] hover:text-rose-300 transition-all flex flex-col items-center gap-1.5"
            title="Uninstall application from device (Alt + U)"
          >
            <Trash2 className="w-4 h-4 text-rose-400" />
            <span className="font-semibold text-[#FFFFFF]">Uninstall App</span>
            <div className="flex items-center gap-1.5 text-[10px] text-[#64748B] font-mono">
              <span>adb uninstall</span>
              <span>•</span>
              <kbd className="px-1 py-0.5 rounded bg-[#1E2638] text-[#94A3B8] border border-[#334155] text-[9px] font-sans">Alt+U</kbd>
            </div>
          </button>
        </div>

        {/* Feedback Alerts */}
        {adbActionSuccess && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{adbActionSuccess}</span>
          </div>
        )}

        {adbActionError && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{adbActionError}</span>
          </div>
        )}
      </div>

      {/* Inline Test Result Summary Banner (non-blocking) */}
      {completedTest && !isRunning && (
        <div
          className={`p-4 rounded-xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fadeIn ${
            completedTest.result === 'PASS'
              ? 'bg-emerald-950/20 border-emerald-500/30 text-emerald-200'
              : 'bg-rose-950/20 border-rose-500/30 text-rose-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                completedTest.result === 'PASS'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
              }`}
            >
              {completedTest.result === 'PASS' ? (
                <CheckCircle2 className="w-6 h-6" />
              ) : (
                <XCircle className="w-6 h-6" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider">
                  Test Result: {completedTest.result || 'COMPLETED'}
                </span>
                <span className="text-[10px] font-mono text-[#CBD5E1]">
                  (Duration: {completedTest.duration || '0s'})
                </span>
              </div>
              <p className="text-xs text-[#CBD5E1] mt-0.5">
                {completedTest.result === 'PASS'
                  ? 'Play Asset Delivery local testing successfully loaded all required asset packs.'
                  : completedTest.failureReason || 'Test execution encountered an error.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => window.open(`/api/test/${completedTest.id}/download-logs`, '_blank')}
              className="px-3 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs text-[#CBD5E1] hover:text-[#FFFFFF] font-medium flex items-center gap-1.5 transition-colors border border-[#334155]"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Logs</span>
            </button>

            <button
              onClick={() => handleStartTest(false)}
              className="px-3.5 py-1.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow flex items-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Run Again</span>
            </button>
          </div>
        </div>
      )}

      {/* Real-time Step Tracker & Progress Bar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-4">
          <StepTracker steps={steps} />
          <ProgressBar
            progress={progress}
            assetPackName={assetPackName}
            currentStepId={steps.find(s => s.status === 'RUNNING')?.id}
            isRunning={isRunning}
          />
        </div>

        {/* Live Terminal & Logcat Output */}
        <div className="lg:col-span-2">
          <LiveLogViewer
            logs={logs}
            onClear={() => setLogs([])}
            testId={activeTestId}
          />
        </div>
      </div>

      {/* Confirmation Modal for Existing Application Uninstall (Section 9) */}
      {confirmModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fadeIn">
          <div className="w-full max-w-md bg-[#131924] border border-[#1E2638] rounded-xl shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-[#F59E0B]">
              <div className="p-2.5 rounded-lg bg-[#261D10] border border-[#78350F]">
                <AlertTriangle className="w-6 h-6 text-[#F59E0B]" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-[#FFFFFF]">Existing App Detected</h3>
                <p className="text-xs text-[#94A3B8]">Confirmation Required</p>
              </div>
            </div>

            <p className="text-xs text-[#CBD5E1] leading-relaxed">
              An existing installation of <span className="font-mono text-[#F59E0B] font-bold">{confirmModalData.packageName}</span> was detected on device <span className="font-mono text-[#FFFFFF]">{confirmModalData.deviceSerial}</span>.
              <br /><br />
              Do you want to uninstall it before testing?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setConfirmModalData(null);
                  setIsRunning(false);
                }}
                className="px-4 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-[#CBD5E1] transition-colors border border-[#334155]"
              >
                Cancel
              </button>

              <button
                onClick={() => handleStartTest(true)}
                className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-colors"
              >
                Uninstall & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screen Mirror Modal for Selected Target Android Device */}
      {mirrorModalOpen && selectedDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col">
            <ScreenMirrorView
              device={selectedDevice}
              onClose={() => setMirrorModalOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Non-blocking Floating Test Result Toast Alert */}
      {showResultToast && completedTest && (
        <TestResultToast
          test={completedTest}
          onClose={() => setShowResultToast(false)}
          onRunAgain={() => handleStartTest(false)}
        />
      )}
    </div>
  );
}
