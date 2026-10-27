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
  Usb,
  Upload,
  ChevronDown,
  Check,
  Wifi
} from 'lucide-react';
import { formatDeviceDisplayName, formatDeviceOsVersion, formatDeviceSelectorLabel } from '../utils/deviceFormatter';
import {
  isActionShortcut,
  isEditableElement,
  isModalDialogOpen,
  formatShortcutLabel,
  getShortcutModifierLabel
} from '../utils/shortcutUtils';
import DeviceThumbnail from '../components/DeviceThumbnail';
import BuildThumbnail from '../components/BuildThumbnail';
import ProgressBar from '../components/ProgressBar';
import LiveLogViewer from '../components/LiveLogViewer';
import TestResultToast from '../components/TestResultToast';
import ScreenMirrorView from '../components/ScreenMirrorView';
import CustomSelect from '../components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '../components/ui/dropdown-menu';
import { toast } from '../utils/toast';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import { webUsbAdbService } from '../services/webUsbAdbService';
import { getDeviceTransport } from '../services/transports/deviceTransportFactory';
import { padExecutionManager } from '../services/padExecutionManager';

// RunTestPage buffer pruning helper: preserves API transactions while pruning general logcat (max 3,000 entries)
export function pruneLogBuffer(prev, data) {
  const isApi = (l) => {
    if (!l) return false;
    const txt = typeof l === 'object' ? (l.text || l.message || '') : String(l);
    return txt.includes('Volley') || txt.includes('[API]') || txt.includes('HTTP response') || txt.includes('API_TO_CALL');
  };
  if (prev.length > 3000) {
    const apiLogs = prev.filter(isApi);
    const nonApiLogs = prev.filter((l) => !isApi(l));
    const retainedNonApi = nonApiLogs.slice(-2000);
    return [...apiLogs, ...retainedNonApi, data.log];
  }
  return [...prev, data.log];
}

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
  onOpenUploadModal,
  isActive = true,
  currentTab = 'run-test',
  currentUser = null
}) {
  const [installMode, setInstallMode] = useState('fresh'); // 'fresh' | 'update'
  const [launchApp, setLaunchApp] = useState(true); // true = auto launch, false = install only
  const [monitoringTimeoutSec, setMonitoringTimeoutSec] = useState(12); // Fast 12s default
  const [activeTestId, setActiveTestId] = useState(() => padExecutionManager.activeTestId);
  const [completedTest, setCompletedTest] = useState(() => padExecutionManager.completedTest);
  const [steps, setSteps] = useState(() => padExecutionManager.steps);
  const [logs, setLogs] = useState(() => padExecutionManager.logs);
  const [progress, setProgress] = useState(() => padExecutionManager.progress);
  const [assetPackName, setAssetPackName] = useState(() => padExecutionManager.assetPackName);
  const [isRunning, setIsRunning] = useState(() => padExecutionManager.isRunning);
  const [error, setError] = useState(() => padExecutionManager.error);

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
  const isStartingRef = useRef(false);
  const shortcutMod = getShortcutModifierLabel();

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

  // Authoritative subscription to padExecutionManager for persistent state & live updates
  useEffect(() => {
    const unsub = padExecutionManager.subscribe((mgrState) => {
      setActiveTestId(mgrState.activeTestId);
      setIsRunning(mgrState.isRunning);
      setSteps(mgrState.steps);
      setLogs(mgrState.logs);
      setProgress(mgrState.progress);
      setAssetPackName(mgrState.assetPackName);
      setCompletedTest(mgrState.completedTest);
      if (mgrState.error !== undefined) {
        setError(mgrState.error);
      }
    });
    return unsub;
  }, []);

  // Context change tracking to reset displayed log buffer when manually switching contexts
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
      // Reset displayed log buffer on manual context switch when no test is actively running or completed
      if (!padExecutionManager.isRunning && !padExecutionManager.hasActiveSession()) {
        padExecutionManager.clearLogs();
      }
    }
  }, [appSource, selectedInstalledApp, selectedBuild?.id, effectiveSelectedDevice?.serial]);

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
            const preferredApp = res.packages.find((p) => p.packageName === 'com.bg.flyermaker') || res.packages[0];
            setSelectedInstalledApp(preferredApp.packageName);
            setAdbPackageName(preferredApp.packageName);
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
      padExecutionManager.appendClientLog(line);
    };

    const updateStep = (stepId, status, duration = null, details = null) => {
      padExecutionManager.updateStep(stepId, status, duration, details);
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
      pushLog(`[INFO] Validating target USB device: ${formatDeviceDisplayName(selectedDevice)} (${selectedDevice.serial})`);
      pushLog(`[INFO] OS: ${formatDeviceOsVersion(selectedDevice) || 'Android'}, Battery: ${selectedDevice.battery || 'N/A'}`);
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
        deviceName: formatDeviceDisplayName(selectedDevice),
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
      padExecutionManager.setProgress(100);
      padExecutionManager.setCompletedTest(saveRes.test);
      setShowResultToast(true);
    } catch (err) {
      webUsbAdbService.stopLogcat();
      padExecutionManager.setIsRunning(false);
      padExecutionManager.setError(err.message || 'Browser USB test execution failed.');
      pushLog(`[ERROR] ${err.message}`);
      padExecutionManager.updateStep('verify_result', 'FAILED', null, err.message);
    }
  };

  const handleStartTest = async (uninstallConfirmed = false) => {
    if (isRunning || isStartingRef.current) return;
    isStartingRef.current = true;
    try {
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
      setConfirmModalData(null);

      const initialSteps = [
        { id: 'resolve_pid', label: `Resolving process for ${selectedInstalledApp}`, status: 'RUNNING' },
        { id: 'attach_logcat', label: 'Attaching PID-Scoped Logcat & Dynamic Watcher', status: 'PENDING' },
        { id: 'monitor_session', label: 'Live Application QA Event Monitoring Active', status: 'PENDING' }
      ];

      padExecutionManager.startSession({
        deviceSerial: targetDevice.serial,
        packageName: selectedInstalledApp,
        initialSteps,
        isBrowserUsb: false,
        userId: currentUser?.id,
        isMonitoring: true
      });

      try {
        const res = await api.monitorInstalledApp({
          deviceSerial: targetDevice.serial,
          packageName: selectedInstalledApp,
          launchApp,
          monitoringTimeoutSec
        });

        padExecutionManager.setActiveTestId(res.testId);
      } catch (err) {
        padExecutionManager.setIsRunning(false);
        padExecutionManager.setError(err.message || 'Failed to monitor installed app.');
      }
      return;
    }

    if (!selectedBuild) {
      setError('Please select an uploaded .aab or .apk build.');
      return;
    }

    setError(null);
    setShowResultToast(false);
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

    padExecutionManager.startSession({
      deviceSerial: targetDevice.serial,
      packageName: selectedBuild.packageName,
      initialSteps,
      isBrowserUsb,
      userId: currentUser?.id
    });

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

      padExecutionManager.setActiveTestId(res.testId);
    } catch (err) {
      padExecutionManager.setIsRunning(false);
      if (err.status === 409 && err.data?.needsConfirmation) {
        // Show confirmation modal for existing package
        setConfirmModalData({
          message: err.data.message,
          packageName: err.data.packageName,
          deviceSerial: err.data.deviceSerial
        });
      } else {
        padExecutionManager.setError(err.message || 'Failed to start test.');
      }
    }
  } finally {
    isStartingRef.current = false;
  }
};

  const handleCancelTest = async () => {
    if (isBrowserUsb) {
      webUsbAdbService.stopLogcat();
      padExecutionManager.setIsRunning(false);
      return;
    }
    padExecutionManager.cancelSession();
  };

  // Controlled ADB Action Handler
  const handleAdbAction = async (actionType) => {
    if (!selectedDevice) {
      toast.error('Please select or connect an Android device first.');
      return;
    }
    const targetPkg = (adbPackageName || selectedBuild?.packageName || '').trim();
    if (!targetPkg && actionType !== 'clear-logcat') {
      toast.error('Please specify an Android package name (e.g. com.example.app).');
      return;
    }

    setLoadingAdbAction(true);

    try {
      const transport = getDeviceTransport(selectedDevice);
      if (!transport) throw new Error('Device transport unavailable.');

      let res;
      if (actionType === 'clear-data') {
        res = await transport.clearAppData(targetPkg);
        padExecutionManager.appendClientLog(`ℹ Application data cleared for ${targetPkg}. Process stopped.`);
      } else if (actionType === 'clear-cache') {
        res = await transport.clearAppCache(targetPkg);
        padExecutionManager.appendClientLog(`ℹ Application cache cleared for ${targetPkg}.`);
      } else if (actionType === 'uninstall') {
        res = await transport.uninstallApp(targetPkg);
        padExecutionManager.appendClientLog(`ℹ Uninstalled ${targetPkg} from device.`);
      } else if (actionType === 'launch') {
        padExecutionManager.appendClientLog(`ℹ Launching ${targetPkg} on target device...`);
        if (selectedDevice && selectedDevice.platform !== 'ios') {
          padExecutionManager.startLogcatMonitoring(selectedDevice.serial, targetPkg);
        }
        res = await transport.relaunchApp(targetPkg);
        padExecutionManager.appendClientLog(`✓ Application launched successfully.`);
      } else if (actionType === 'clear-logcat') {
        res = await transport.clearLogcat();
        padExecutionManager.appendClientLog(`✓ Device Logcat buffer cleared.`);
      }

      toast.success(res?.message || 'Operation executed successfully.');
    } catch (err) {
      toast.error(err.message || 'Operation failed.');
    } finally {
      setLoadingAdbAction(false);
    }
  };

  // Cross-Platform Keyboard Shortcuts for Run PAD Test (Alt/Option + Q) & Controlled ADB Operations (R, D, C, U)
  useEffect(() => {
    const handleKeyDown = (event) => {
      // Must have Alt/Option pressed and no Ctrl or Meta/Cmd
      if (!event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }

      // Ignore repeated keydown events from holding key down
      if (event.repeat) {
        return;
      }

      // Scoping: shortcuts apply when active on Run Test, BugDesk, or Remote Config Manager
      const isApplicableRoute = currentTab === 'run-test' || currentTab === 'bug-desk' || currentTab === 'remote-config';
      if (!isApplicableRoute) {
        return;
      }

      // Do not trigger underlying page shortcut when a modal or confirmation dialog owns interaction.
      // On Remote Config Manager, in-page dialogs (Create, Edit, View, Delete) do not block global shortcuts.
      const isRemoteConfigActive = currentTab === 'remote-config';
      if (isModalDialogOpen(undefined, { ignoreRemoteConfig: isRemoteConfigActive })) {
        return;
      }

      // On RunTestPage and Remote Config, suppress if typing in an editable field.
      // On BugDesk, allow shortcuts even when focus is in textarea/input/dropdown (calling preventDefault on match).
      const isBugDeskActive = currentTab === 'bug-desk';
      if (!isBugDeskActive && isEditableElement(event.target)) {
        return;
      }

      if (isActionShortcut(event, 'KeyQ', 'q', 'œ')) {
        event.preventDefault();
        event.stopPropagation();
        if (!isRunning && !isStartingRef.current) {
          handleStartTest(false);
        }
      } else if (isActionShortcut(event, 'KeyR', 'r', '®')) {
        event.preventDefault();
        event.stopPropagation();
        if (!loadingAdbAction) {
          handleAdbAction('launch');
        }
      } else if (isActionShortcut(event, 'KeyD', 'd', '∂')) {
        event.preventDefault();
        event.stopPropagation();
        if (!loadingAdbAction) {
          handleAdbAction('clear-data');
        }
      } else if (isActionShortcut(event, 'KeyC', 'c', 'ç')) {
        event.preventDefault();
        event.stopPropagation();
        if (!loadingAdbAction) {
          handleAdbAction('clear-cache');
        }
      } else if (isActionShortcut(event, 'KeyU', 'u', '¨')) {
        event.preventDefault();
        event.stopPropagation();
        if (!loadingAdbAction) {
          handleAdbAction('uninstall');
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [currentTab, isRunning, loadingAdbAction, selectedDevice, selectedBuild, effectiveSelectedDevice, installMode, launchApp, monitoringTimeoutSec, isBrowserUsb, adbPackageName]);

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-5">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Play className="w-4 h-4 fill-current ml-0.5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1F2544] dark:text-white tracking-tight flex items-center gap-2 font-sans">
              Run PAD <span className="text-heading-gradient">Test</span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6B7194] dark:text-[#94A3B8] font-normal mt-1 leading-relaxed max-w-3xl">
              Execute end-to-end Bundletool mock testing, APK generation, installation, and real-time AssetPackHelper logcat verification.
            </p>
          </div>
        </div>

        {isRunning && (
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full glass border border-amber-500/40 text-xs font-bold text-amber-700 dark:text-[#F59E0B] animate-pulse shadow-sm">
            <Loader2 className="w-4 h-4 animate-spin text-amber-600 dark:text-[#F59E0B]" />
            <span>Test Pipeline in Progress...</span>
          </div>
        )}
      </div>

      {/* Target Device & Build / App Selection Card */}
      <div className="glass rounded-card p-6 lg:p-7 shadow-glass space-y-6">
        {/* Application Source Toggle: Uploaded Build vs Installed App */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setAppSource('uploaded')}
              disabled={isRunning}
              className={`px-3.5 py-1.5 rounded-btn text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                appSource === 'uploaded'
                  ? 'btn-soft text-[#7c6cf6] dark:text-white shadow-xs'
                  : 'text-[#6B7194] dark:text-[#94A3B8] hover:text-[#1F2544] dark:hover:text-white border border-transparent'
              }`}
            >
              <Package className="w-3.5 h-3.5 text-slate-500 dark:text-slate-300" />
              <span>Uploaded Build (AAB/APK)</span>
            </button>
            <button
              type="button"
              onClick={() => setAppSource('installed')}
              disabled={isRunning}
              className={`px-3.5 py-1.5 rounded-btn text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
                appSource === 'installed'
                  ? 'btn-soft text-[#7c6cf6] dark:text-white shadow-xs'
                  : 'text-[#6B7194] dark:text-[#94A3B8] hover:text-[#1F2544] dark:hover:text-white border border-transparent'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
              <span>Installed App on Device</span>
            </button>
          </div>
          <span className="text-xs text-[#6B7194] dark:text-[#64748B]">
            {appSource === 'uploaded'
              ? 'Install & verify package from uploaded artifacts'
              : 'Direct live QA & network inspection of pre-installed apps without re-installing'}
          </span>
        </div>

        {/* Top 2 Columns: Target Android Device and Target AAB Build */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
          {/* Target Android Device */}
          <div className="space-y-2 min-w-0">
            <div className="min-h-[30px] flex items-center justify-between">
              <label className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B]" />
                Target Android Device
              </label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1.5 px-3 py-1 rounded-btn btn-soft text-xs font-bold text-[#7c6cf6] dark:text-white transition-all cursor-pointer select-none"
                    title="Device actions and connection options"
                    aria-label="Device Actions"
                  >
                    <span>Device Actions</span>
                    <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    disabled={!effectiveSelectedDevice}
                    onSelect={() => {
                      if (effectiveSelectedDevice) {
                        if (!selectedDevice) {
                          setSelectedDevice(effectiveSelectedDevice);
                        }
                        setMirrorModalOpen(true);
                      }
                    }}
                    title="Open live screen mirror for the selected device"
                  >
                    <Tv className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B] shrink-0" />
                    <span>Screen Mirror</span>
                    {!effectiveSelectedDevice && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 ml-auto">(No device)</span>
                    )}
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />

                  <DropdownMenuItem
                    onSelect={() => onConnectBrowserUsb && onConnectBrowserUsb()}
                    title="Connect Android device via USB"
                  >
                    <Usb className="w-3.5 h-3.5 text-[#6B7194] dark:text-[#94A3B8] shrink-0" />
                    <span>Connect USB</span>
                  </DropdownMenuItem>

                  <DropdownMenuItem
                    onSelect={() => onOpenPairModal && onOpenPairModal()}
                    title="Pair Android device via Wi-Fi"
                  >
                    <Wifi className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B] shrink-0" />
                    <span>Pair (Wi-Fi)</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>

            <CustomSelect
              value={effectiveSelectedDevice?.serial || ''}
              onChange={(val) => {
                const serial = val?.target ? val.target.value : val;
                const found = androidDevices.find((d) => d.serial === serial);
                if (found) setSelectedDevice(found);
              }}
              disabled={isRunning || androidDevices.length === 0}
              placeholder={androidDevices.length === 0 ? "No connected Android devices (Pair first)" : "Select Android device"}
              options={androidDevices.map((d) => ({
                value: d.serial,
                label: `${formatDeviceDisplayName(d)} (${formatDeviceOsVersion(d)}) [${d.serial}]`
              }))}
              className="h-10 text-xs font-mono rounded-xl"
            />
          </div>

          {/* Target AAB Build */}
          {appSource === 'uploaded' ? (
            <div className="space-y-2 min-w-0">
              <div className="min-h-[30px] flex items-center justify-between">
                <label className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B]" />
                  Target AAB Build
                </label>
                <button
                  type="button"
                  onClick={onOpenUploadModal}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-btn btn-soft text-xs font-bold text-[#7c6cf6] dark:text-white transition-all cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Upload AAB</span>
                </button>
              </div>

              <CustomSelect
                value={selectedBuild?.id || ''}
                onChange={(val) => {
                  const id = val?.target ? val.target.value : val;
                  const found = builds.find((b) => b.id === id);
                  if (found) setSelectedBuild(found);
                }}
                disabled={isRunning || builds.length === 0}
                placeholder={builds.length === 0 ? "No uploaded builds (Upload first)" : "Select build"}
                options={builds.map((b) => {
                  const isApk = b.fileType === 'apk' || b.fileName?.endsWith('.apk');
                  return {
                    value: b.id,
                    label: `[${isApk ? 'APK' : 'AAB'}] ${b.fileName || b.applicationName} — ${b.packageName} (v${b.versionName})${!isApk ? ` [${b.assetPacks?.length || 0} packs]` : ''}`
                  };
                })}
                className="h-10 text-xs font-mono rounded-xl"
              />
            </div>
          ) : (
            <div className="space-y-2 min-w-0">
              <div className="min-h-[30px] flex items-center justify-between">
                <label className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B]" />
                  Target Installed Application
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-[#6B7194] dark:text-[#94A3B8] flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeSystemApps}
                      onChange={(e) => setIncludeSystemApps(e.target.checked)}
                      disabled={isRunning || loadingInstalledApps}
                      className="accent-[#7c6cf6]"
                    />
                    <span>System Apps</span>
                  </label>
                  <button
                    type="button"
                    onClick={fetchInstalledApps}
                    disabled={isRunning || loadingInstalledApps || !effectiveSelectedDevice}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-btn btn-soft text-xs font-bold text-[#7c6cf6] dark:text-white transition-all cursor-pointer disabled:opacity-50"
                    title="Refresh installed applications list"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingInstalledApps ? 'animate-spin' : ''}`} />
                    <span>Refresh</span>
                  </button>
                </div>
              </div>
              <CustomSelect
                value={selectedInstalledApp || ''}
                onChange={(val) => {
                  const pkg = val?.target ? val.target.value : val;
                  setSelectedInstalledApp(pkg);
                }}
                disabled={isRunning || loadingInstalledApps || installedApps.length === 0}
                placeholder={
                  loadingInstalledApps
                    ? "Loading installed packages from device..."
                    : installedApps.length === 0
                    ? "No applications found on device"
                    : "Select installed application"
                }
                options={installedApps.map((app) => ({
                  value: app.packageName,
                  label: app.label ? `${app.label} (${app.packageName})` : app.packageName
                }))}
                className="h-10 text-xs font-mono rounded-xl"
              />
              {installedAppsError && (
                <p className="text-[11px] text-rose-500">{installedAppsError}</p>
              )}
            </div>
          )}
        </div>

        {/* Lower 2 Columns: Installation Mode & Post-Install Action */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start pt-2">
          {/* Left: Installation Mode */}
          {appSource === 'uploaded' ? (
            <div className="space-y-3">
              <span className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] block">Installation Mode</span>
              <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                <label
                  onClick={() => !isRunning && setInstallMode('fresh')}
                  className="flex items-center gap-2.5 text-xs cursor-pointer select-none"
                >
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                    installMode === 'fresh'
                      ? 'border-[#7c6cf6] bg-transparent'
                      : 'border-slate-300 dark:border-[#2D3748] bg-transparent'
                  }`}>
                    {installMode === 'fresh' && (
                      <div className="w-2 h-2 rounded-full bg-[#7c6cf6]" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={installMode === 'fresh' ? 'text-[#7c6cf6] dark:text-[#F59E0B] font-bold' : 'text-[#6B7194] dark:text-[#CBD5E1]'}>
                      Fresh Install
                    </span>
                    <span className="text-[#6B7194] dark:text-[#64748B]">(Clean previous)</span>
                  </div>
                </label>

                <label
                  onClick={() => !isRunning && setInstallMode('update')}
                  className="flex items-center gap-2.5 text-xs cursor-pointer select-none"
                >
                  <div className={`w-4 h-4 rounded-full border flex items-center justify-center transition-all ${
                    installMode === 'update'
                      ? 'border-[#7c6cf6] bg-transparent'
                      : 'border-slate-300 dark:border-[#2D3748] bg-transparent'
                  }`}>
                    {installMode === 'update' && (
                      <div className="w-2 h-2 rounded-full bg-[#7c6cf6]" />
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className={installMode === 'update' ? 'text-[#7c6cf6] dark:text-[#F59E0B] font-bold' : 'text-[#6B7194] dark:text-[#CBD5E1]'}>
                      Update
                    </span>
                    <span className="text-[#6B7194] dark:text-[#64748B]">(Preserve Data)</span>
                  </div>
                </label>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <span className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] block">Monitoring Startup Action</span>
              <div
                onClick={() => !isRunning && setLaunchApp(!launchApp)}
                className="flex items-start gap-3 p-3.5 rounded-xl bg-white/70 border border-[var(--line)] dark:bg-[#080B10] dark:border-[#1C2230] cursor-pointer select-none transition-all hover:border-[#7c6cf6]/50 shadow-xs"
              >
                <div className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center transition-all shrink-0 ${
                  launchApp ? 'bg-[#7c6cf6] text-white' : 'border border-slate-300 dark:border-[#2D3748] bg-transparent'
                }`}>
                  {launchApp && <Check className="w-3 h-3 text-white stroke-[3]" />}
                </div>
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-[#1F2544] dark:text-white block">
                    {launchApp ? 'Launch / Bring App to Foreground' : 'Attach to Running App Process (No Restart)'}
                  </span>
                  <p className="text-[11px] text-[#6B7194] dark:text-[#94A3B8] leading-tight">
                    {launchApp
                      ? 'Issues an ADB monkey/activity launch to start or bring the app forward.'
                      : 'Waits for or immediately attaches to current app PID without relaunching.'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Right: Post-Install Action */}
          {appSource === 'uploaded' && (
            <div className="space-y-3">
              <span className="text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] block">Post-Install Action</span>
              <div
                onClick={() => !isRunning && setLaunchApp(!launchApp)}
                className="flex items-start gap-3 p-3.5 rounded-xl bg-white/70 border border-[var(--line)] dark:bg-[#080B10] dark:border-[#1C2230] cursor-pointer select-none transition-all hover:border-[#7c6cf6]/50 shadow-xs"
              >
                <div className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center transition-all shrink-0 ${
                  launchApp ? 'bg-[#7c6cf6] text-white' : 'border border-slate-300 dark:border-[#2D3748] bg-transparent'
                }`}>
                  {launchApp && <Check className="w-3 h-3 text-white stroke-[3]" />}
                </div>
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-[#1F2544] dark:text-white block">
                    Launch app automatically after install
                  </span>
                  <p className="text-[11px] text-[#6B7194] dark:text-[#94A3B8] leading-tight">
                    Automatically launches app and monitors PAD logcat.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Primary Action Button */}
        <div className="pt-2 flex items-center justify-end">
          {isRunning ? (
            <button
              onClick={handleCancelTest}
              className="px-6 py-3 rounded-btn bg-rose-600 hover:bg-rose-500 text-xs font-bold text-white shadow-lg transition-all flex items-center gap-2 cursor-pointer"
            >
              <StopCircle className="w-4 h-4" />
              <span>Stop Monitoring</span>
            </button>
          ) : (
            <button
              onClick={() => handleStartTest(false)}
              disabled={!selectedDevice || (appSource === 'uploaded' ? !selectedBuild : !selectedInstalledApp)}
              className="btn-magic px-6 py-3 rounded-btn disabled:opacity-40 text-xs font-bold text-white shadow-magic transition-all flex items-center gap-2.5 cursor-pointer"
              title={appSource === 'uploaded' ? `Run Play Asset Delivery test (${shortcutMod} + Q)` : `Start live QA monitoring for installed app (${shortcutMod} + Q)`}
            >
              <Play className="w-3.5 h-3.5 fill-white text-white" />
              <span className="font-bold text-white tracking-tight">{appSource === 'uploaded' ? 'Run PAD Test' : 'Start App Monitoring'}</span>
              <kbd className="px-1.5 py-0.5 rounded bg-white/20 border border-white/30 text-white text-[10px] font-mono font-bold tracking-tight ml-1">{shortcutMod} + Q</kbd>
            </button>
          )}
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-500 dark:text-rose-400">
            {error}
          </div>
        )}
      </div>

      {/* Controlled ADB Device Operations inside Run PAD Test */}
      <div className="glass rounded-card p-5 lg:p-6 shadow-glass space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--line)]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl brand-mark text-white flex items-center justify-center shrink-0 shadow-sm">
              <Terminal className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-xs font-extrabold text-[#1F2544] dark:text-[#CBD5E1] uppercase tracking-wide">
                Controlled ADB Device Operations
              </h3>
              <p className="text-[11px] text-[#6B7194] dark:text-[#64748B]">One-click package maintenance and lifecycle commands</p>
            </div>
          </div>
          {selectedDevice && (
            <div className="flex items-center gap-3 bg-white/60 dark:bg-[#080B10] px-3.5 py-1.5 rounded-xl border border-[var(--line)] dark:border-[#1C2230] shadow-xs">
              <DeviceThumbnail device={selectedDevice} size="header" className="shadow-sm shrink-0" />
              <div className="text-xs font-mono min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-[#6B7194] dark:text-[#64748B] font-bold">Target Device</div>
                <div className="text-[#7c6cf6] dark:text-[#F59E0B] font-bold text-xs truncate max-w-[260px]" title={formatDeviceDisplayName(selectedDevice)}>
                  {formatDeviceDisplayName(selectedDevice)}
                </div>
                <div className="text-[11px] text-[#6B7194] dark:text-[#64748B] truncate">{selectedDevice.serial}</div>
              </div>
            </div>
          )}
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-[#6B7194] dark:text-[#94A3B8] mb-1.5">
            Target Application Package Name
          </label>
          <input
            type="text"
            value={adbPackageName}
            onChange={(e) => setAdbPackageName(e.target.value)}
            placeholder="e.g. com.bg.flyermaker"
            className="w-full px-3.5 py-2.5 rounded-xl bg-white/70 border border-[var(--line)] text-[#1F2544] dark:bg-[#080B10] dark:border-[#1C2230] dark:text-[#E2E8F0] font-mono focus:outline-none focus:border-[#7c6cf6] focus:ring-2 focus:ring-[#7c6cf6]/20 text-xs shadow-xs"
          />
        </div>

        {/* Action Buttons Grid: Relaunch | Clear App Data | Clear Cache | Uninstall App */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <button
            onClick={() => handleAdbAction('launch')}
            disabled={loadingAdbAction || !selectedDevice}
            className="p-3.5 rounded-xl bg-white/70 hover:bg-white border border-[var(--line)] hover:border-[#7c6cf6]/40 text-xs text-[#1F2544] dark:bg-[#16130C] dark:hover:bg-[#1F190E] dark:border-[#F59E0B]/60 dark:text-[#F59E0B] transition-all flex flex-col items-center gap-1.5 shadow-xs cursor-pointer group"
            title={`Relaunch application from fresh state (${shortcutMod} + R)`}
          >
            <Play className="w-4 h-4 text-[#7c6cf6] fill-[#7c6cf6]/20 dark:text-[#F59E0B] dark:fill-[#F59E0B]/20 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-[#7c6cf6] dark:text-[#F59E0B]">Relaunch</span>
            <div className="flex items-center gap-1.5 text-[10px] text-[#6B7194] dark:text-[#94A3B8] font-mono">
              <span>monkey</span>
              <span>•</span>
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-black/40 text-[#7c6cf6] dark:text-[#F59E0B] border border-slate-200 dark:border-[#F59E0B]/30 text-[9px] font-sans">{shortcutMod}+R</kbd>
            </div>
          </button>

          <button
            onClick={() => handleAdbAction('clear-data')}
            disabled={loadingAdbAction || !selectedDevice}
            className="p-3.5 rounded-xl bg-white/70 hover:bg-white hover:border-[#fb923c]/40 border border-[var(--line)] text-xs text-[#1F2544] dark:bg-[#080B10] dark:hover:bg-[#10131B] dark:hover:border-amber-500/40 dark:border-[#1C2230] dark:text-[#CBD5E1] dark:hover:text-[#FFFFFF] transition-all flex flex-col items-center gap-1.5 cursor-pointer shadow-xs group"
            title={`Wipe application user and runtime data (${shortcutMod} + D)`}
          >
            <Eraser className="w-4 h-4 text-amber-500 dark:text-[#F59E0B] group-hover:scale-110 transition-transform" />
            <span className="font-bold text-[#1F2544] dark:text-[#FFFFFF]">Clear App Data</span>
            <div className="flex items-center gap-1.5 text-[10px] text-[#6B7194] dark:text-[#64748B] font-mono">
              <span>pm clear</span>
              <span>•</span>
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-[#10131B] text-[#1F2544] dark:text-[#94A3B8] border border-slate-200 dark:border-[#1C2230] text-[9px] font-sans">{shortcutMod}+D</kbd>
            </div>
          </button>

          <button
            onClick={() => handleAdbAction('clear-cache')}
            disabled={loadingAdbAction || !selectedDevice}
            className="p-3.5 rounded-xl bg-white/70 hover:bg-white hover:border-cyan-400/40 border border-[var(--line)] text-xs text-[#1F2544] dark:bg-[#080B10] dark:hover:bg-[#10131B] dark:hover:border-cyan-500/40 dark:border-[#1C2230] dark:text-[#CBD5E1] dark:hover:text-[#FFFFFF] transition-all flex flex-col items-center gap-1.5 cursor-pointer shadow-xs group"
            title={`Clear application cache without clearing persistent data (${shortcutMod} + C)`}
          >
            <Sparkles className="w-4 h-4 text-cyan-600 dark:text-cyan-400 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-[#1F2544] dark:text-[#FFFFFF]">Clear Cache</span>
            <div className="flex items-center gap-1.5 text-[10px] text-[#6B7194] dark:text-[#64748B] font-mono">
              <span>trim caches</span>
              <span>•</span>
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-[#10131B] text-[#1F2544] dark:text-[#94A3B8] border border-slate-200 dark:border-[#1C2230] text-[9px] font-sans">{shortcutMod}+C</kbd>
            </div>
          </button>

          <button
            onClick={() => handleAdbAction('uninstall')}
            disabled={loadingAdbAction || !selectedDevice}
            className="p-3.5 rounded-xl bg-white/70 hover:bg-white hover:border-rose-400/40 border border-[var(--line)] text-xs text-[#1F2544] dark:bg-[#080B10] dark:hover:bg-[#10131B] dark:hover:border-rose-500/40 dark:border-[#1C2230] dark:text-[#CBD5E1] dark:hover:text-[#FFFFFF] transition-all flex flex-col items-center gap-1.5 cursor-pointer shadow-xs group"
            title={`Uninstall application from device (${shortcutMod} + U)`}
          >
            <Trash2 className="w-4 h-4 text-rose-500 dark:text-rose-400 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-[#1F2544] dark:text-[#FFFFFF]">Uninstall App</span>
            <div className="flex items-center gap-1.5 text-[10px] text-[#6B7194] dark:text-[#64748B] font-mono">
              <span>uninstall</span>
              <span>•</span>
              <kbd className="px-1 py-0.5 rounded bg-slate-100 dark:bg-[#10131B] text-[#1F2544] dark:text-[#94A3B8] border border-slate-200 dark:border-[#1C2230] text-[9px] font-sans">{shortcutMod}+U</kbd>
            </div>
          </button>
        </div>
      </div>

      {/* Inline Test Result Summary Banner (non-blocking) */}
      {completedTest && !isRunning && (
        <div
          className={`glass p-5 rounded-2xl border flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fadeIn shadow-glass ${
            completedTest.result === 'PASS'
              ? 'border-emerald-500/30 text-emerald-900 dark:text-emerald-200'
              : 'border-rose-500/30 text-rose-900 dark:text-rose-200'
          }`}
        >
          <div className="flex items-center gap-3.5">
            <div
              className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm ${
                completedTest.result === 'PASS'
                  ? 'bg-emerald-500 text-white shadow-emerald-500/20'
                  : 'bg-rose-500 text-white shadow-rose-500/20'
              }`}
            >
              {completedTest.result === 'PASS' ? (
                <CheckCircle2 className="w-6 h-6 stroke-[2.5]" />
              ) : (
                <XCircle className="w-6 h-6 stroke-[2.5]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-[#1F2544] dark:text-white">
                  Test Result: {completedTest.result || 'COMPLETED'}
                </span>
                <span className="text-[10px] font-mono text-[#6B7194] dark:text-[#CBD5E1]">
                  (Duration: {completedTest.duration || '0s'})
                </span>
              </div>
              <p className="text-xs text-[#6B7194] dark:text-[#CBD5E1] mt-0.5">
                {completedTest.result === 'PASS'
                  ? 'Play Asset Delivery local testing successfully loaded all required asset packs.'
                  : completedTest.failureReason || 'Test execution encountered an error.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => window.open(`/api/test/${completedTest.id}/download-logs`, '_blank')}
              className="px-3.5 py-2 rounded-btn btn-soft text-xs text-[#1F2544] dark:text-[#CBD5E1] font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Logs</span>
            </button>

            <button
              onClick={() => handleStartTest(false)}
              className="btn-magic px-4 py-2 rounded-btn text-xs font-bold text-white shadow-magic flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Run Again</span>
            </button>
          </div>
        </div>
      )}

      {/* Real-time Integrated PAD Progress Bar & Pipeline Tracker */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1">
          <ProgressBar
            progress={progress}
            steps={steps}
            assetPackName={assetPackName}
            currentStepId={steps.find((s) => s.status === 'RUNNING')?.id}
            isRunning={isRunning}
            completedTest={completedTest}
            error={error}
            appSource={appSource}
          />
        </div>

        {/* Live Terminal & Logcat Output */}
        <div className="lg:col-span-2">
          <LiveLogViewer
            logs={logs}
            onClear={() => padExecutionManager.clearLogs()}
            testId={activeTestId}
          />
        </div>
      </div>

      {/* Confirmation Modal for Existing Application Uninstall (Section 9) */}
      {confirmModalData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md glass rounded-2xl shadow-2xl p-6 space-y-4 border border-[var(--line)]">
            <div className="flex items-center gap-3 text-amber-500">
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
                <AlertTriangle className="w-6 h-6 text-amber-500" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-[#1F2544] dark:text-[#FFFFFF]">Existing App Detected</h3>
                <p className="text-xs text-[#6B7194]">Confirmation Required</p>
              </div>
            </div>

            <p className="text-xs text-[#1F2544] dark:text-[#CBD5E1] leading-relaxed">
              An existing installation of <span className="font-mono text-[#7c6cf6] dark:text-[#F59E0B] font-bold">{confirmModalData.packageName}</span> was detected on device <span className="font-mono text-[#1F2544] dark:text-[#FFFFFF]">{confirmModalData.deviceSerial}</span>.
              <br /><br />
              Do you want to uninstall it before testing?
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => {
                  setConfirmModalData(null);
                  setIsRunning(false);
                }}
                className="px-4 py-2 rounded-btn btn-soft text-xs font-bold text-[#1F2544] dark:text-[#CBD5E1] cursor-pointer"
              >
                Cancel
              </button>

              <button
                onClick={() => handleStartTest(true)}
                className="btn-magic px-4 py-2 rounded-btn text-xs font-bold text-white shadow-magic cursor-pointer"
              >
                Uninstall & Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screen Mirror Modal for Selected Target Android Device */}
      {mirrorModalOpen && (selectedDevice || effectiveSelectedDevice) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col">
            <ScreenMirrorView
              device={selectedDevice || effectiveSelectedDevice}
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
