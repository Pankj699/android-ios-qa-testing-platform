import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import WirelessPairModal from './components/WirelessPairModal';
import AabUploadModal from './components/AabUploadModal';
import AppTourModal from './components/AppTourModal';
import AuthModal from './components/AuthModal';
import PairAgentModal from './components/PairAgentModal';
import WebUsbDiagnosticsModal from './components/WebUsbDiagnosticsModal';
import ErrorBoundary from './components/ErrorBoundary';
import ScreenMirrorView from './components/ScreenMirrorView';

import Dashboard from './pages/Dashboard';
import DevicesPage from './pages/DevicesPage';
import ScreenMirrorPage from './pages/ScreenMirrorPage';
import UiInspectorPage from './pages/UiInspectorPage';
import BuildsPage from './pages/BuildsPage';
import RunTestPage from './pages/RunTestPage';
import TestHistoryPage from './pages/TestHistoryPage';
import AdbOperationsPage from './pages/AdbOperationsPage';
import SopPage from './pages/SopPage';
import DiagnosticsPage from './pages/DiagnosticsPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminDeviceManagementPage from './pages/AdminDeviceManagementPage';
import GoogleDrivePage from './pages/GoogleDrivePage';
import MixpanelValidatorPage from './pages/MixpanelValidatorPage';
import BugDeskApp from './bugdesk/BugDeskApp';
import { getModuleSettings } from './bugdesk/lib/scoped-storage';
import { Toaster } from 'sonner';

import { api } from './services/api';
import { socketService } from './services/socket';
import { webUsbAdbService } from './services/webUsbAdbService';
import { screenMirrorStreamManager } from './services/screenMirrorStreamManager';
import { Lock, LogIn, ShieldAlert } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState(() => api.getCurrentUser());
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!api.getCurrentUser());

  // Bug Desk sub-navigation & active module state
  const [bugDeskTab, setBugDeskTab] = useState('dashboard');
  const [bugDeskModuleSettings, setBugDeskModuleSettings] = useState(null);
  const [bugDeskSwitchOpen, setBugDeskSwitchOpen] = useState(false);
  const [mirrorModalOpen, setMirrorModalOpen] = useState(false);
  const [mirrorSessionActive, setMirrorSessionActive] = useState(false);

  const [devices, setDevices] = useState([]);
  const [browserUsbDevice, setBrowserUsbDevice] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const browserUsbDeviceRef = React.useRef(null);

  const [builds, setBuilds] = useState([]);
  const [selectedBuild, setSelectedBuild] = useState(null);

  const [diagnostics, setDiagnostics] = useState(null);
  const [summaryStats, setSummaryStats] = useState(null);
  const [loading, setLoading] = useState(false);

  // Modals
  const [pairModalOpen, setPairModalOpen] = useState(false);
  const [agentPairModalOpen, setAgentPairModalOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [tourModalOpen, setTourModalOpen] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState('login');
  const [authResetToken, setAuthResetToken] = useState('');
  const [usbDiagModalOpen, setUsbDiagModalOpen] = useState(false);
  const [usbDiagnostics, setUsbDiagnostics] = useState(null);

  // Fetch all initial data
  const fetchData = useCallback(async () => {
    const user = api.getCurrentUser();
    const authed = !!user;
    setCurrentUser(user);
    setIsAuthenticated(authed);

    // If user is not authenticated, clear user-specific resources
    if (!authed) {
      setDevices([]);
      setSelectedDevice(null);
      setBuilds([]);
      setSelectedBuild(null);
      setSummaryStats(null);
      try {
        const diagRes = await api.getDiagnostics().catch(() => ({ diagnostics: null }));
        setDiagnostics(diagRes.diagnostics);
      } catch (e) {}
      return;
    }

    setLoading(true);
    try {
      const [devicesRes, buildsRes, diagRes, statsRes] = await Promise.all([
        api.getDevices().catch(() => ({ devices: [] })),
        api.getBuilds().catch(() => ({ builds: [] })),
        api.getDiagnostics().catch(() => ({ diagnostics: null })),
        api.getSummaryStats().catch(() => ({ stats: null }))
      ]);

      // Strictly ensure each user sees only their own devices across all pages
      const rawDeviceList = (devicesRes.devices || []).filter(
        (d) => d && (d.owner ? Boolean(d.owner.isOwner) : true)
      );

      // Defensively preserve last-known-valid metadata/telemetry across refreshes
      setDevices((prevDevices) => {
        return rawDeviceList.map((d) => {
          const prevDev = prevDevices.find(
            (p) => p.serial === d.serial || (d.hardwareSerial && p.hardwareSerial === d.hardwareSerial)
          );
          if (!prevDev) return d;
          return {
            ...prevDev,
            ...d,
            battery: (d.battery && d.battery !== 'Unknown' && d.battery !== 'N/A') ? d.battery : (prevDev.battery || d.battery),
            batteryStatus: (d.batteryStatus && d.batteryStatus !== 'Unknown' && d.batteryStatus !== 'N/A') ? d.batteryStatus : (prevDev.batteryStatus || d.batteryStatus),
            storageFree: (d.storageFree && d.storageFree !== 'Unknown' && d.storageFree !== 'N/A') ? d.storageFree : (prevDev.storageFree || d.storageFree),
            storageTotal: (d.storageTotal && d.storageTotal !== 'Unknown' && d.storageTotal !== 'N/A') ? d.storageTotal : (prevDev.storageTotal || d.storageTotal),
            storageUsedPct: d.storageUsedPct || prevDev.storageUsedPct,
            screenResolution: (d.screenResolution && d.screenResolution !== 'Unknown' && d.screenResolution !== 'N/A') ? d.screenResolution : (prevDev.screenResolution || d.screenResolution),
            osVersion: (d.osVersion && d.osVersion !== 'Unknown' && d.osVersion !== 'N/A') ? d.osVersion : (prevDev.osVersion || d.osVersion),
            androidVersion: (d.androidVersion && !/^android$/i.test(String(d.androidVersion).trim())) ? d.androidVersion : (prevDev.androidVersion || d.androidVersion)
          };
        });
      });

      setSelectedDevice((prev) => {
        const currentUsb = browserUsbDeviceRef.current;
        // If current selected device is the active browser USB device, keep it!
        if (currentUsb && prev && (prev.serial === currentUsb.serial || prev.connectionMode === 'browser-usb' || prev.serial?.startsWith('browser_usb_'))) {
          return currentUsb;
        }
        // If previous was a server device, check if it is still connected (by serial or physical hardwareSerial)
        if (prev) {
          const stillConnected = rawDeviceList.find(
            (d) =>
              d.serial === prev.serial ||
              (prev.hardwareSerial && (d.hardwareSerial === prev.hardwareSerial || d.serial === prev.hardwareSerial)) ||
              (d.hardwareSerial && (d.hardwareSerial === prev.serial))
          );
          if (stillConnected) {
            return {
              ...prev,
              ...stillConnected,
              battery: (stillConnected.battery && stillConnected.battery !== 'Unknown' && stillConnected.battery !== 'N/A') ? stillConnected.battery : (prev.battery || stillConnected.battery),
              batteryStatus: (stillConnected.batteryStatus && stillConnected.batteryStatus !== 'Unknown' && stillConnected.batteryStatus !== 'N/A') ? stillConnected.batteryStatus : (prev.batteryStatus || stillConnected.batteryStatus),
              storageFree: (stillConnected.storageFree && stillConnected.storageFree !== 'Unknown' && stillConnected.storageFree !== 'N/A') ? stillConnected.storageFree : (prev.storageFree || stillConnected.storageFree),
              storageTotal: (stillConnected.storageTotal && stillConnected.storageTotal !== 'Unknown' && stillConnected.storageTotal !== 'N/A') ? stillConnected.storageTotal : (prev.storageTotal || stillConnected.storageTotal),
              storageUsedPct: stillConnected.storageUsedPct || prev.storageUsedPct,
              screenResolution: (stillConnected.screenResolution && stillConnected.screenResolution !== 'Unknown' && stillConnected.screenResolution !== 'N/A') ? stillConnected.screenResolution : (prev.screenResolution || stillConnected.screenResolution),
              osVersion: (stillConnected.osVersion && stillConnected.osVersion !== 'Unknown' && stillConnected.osVersion !== 'N/A') ? stillConnected.osVersion : (prev.osVersion || stillConnected.osVersion),
              androidVersion: (stillConnected.androidVersion && !/^android$/i.test(String(stillConnected.androidVersion).trim())) ? stillConnected.androidVersion : (prev.androidVersion || stillConnected.androidVersion)
            };
          }
        }
        // Fallback: prefer active browser USB device, otherwise first available server device, or null
        return currentUsb || rawDeviceList[0] || null;
      });

      const buildList = buildsRes.builds || [];
      setBuilds(buildList);
      setSelectedBuild((prev) => {
        if (!prev) return buildList[0] || null;
        const stillExists = buildList.find((b) => b.id === prev.id);
        return stillExists || buildList[0] || null;
      });

      setDiagnostics(diagRes.diagnostics);
      setSummaryStats(statsRes.stats);
    } catch (err) {
      console.error('Data fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Check if password reset token was provided in URL query parameters
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const resetTok = urlParams.get('resetToken');
      if (resetTok) {
        setAuthResetToken(resetTok);
        setAuthModalMode('reset');
        setAuthModalOpen(true);
        // Clean URL query parameter
        const newUrl = window.location.pathname + (window.location.hash || '');
        window.history.replaceState({}, document.title, newUrl);
      }
    } catch (e) {}

    // Check existing native session on mount
    api.getMe()
      .then((meRes) => {
        if (meRes?.user) {
          setCurrentUser(meRes.user);
          setIsAuthenticated(true);
        }
        fetchData();
      })
      .catch(() => {
        setCurrentUser(null);
        setIsAuthenticated(false);
        fetchData();
      });

    // Connect WebSocket and listen for real-time device and test updates across clients
    socketService.connect();
    const unsubDevices = socketService.on('DEVICES_UPDATED', () => {
      fetchData();
    });
    const unsubFinished = socketService.on('TEST_FINISHED', () => {
      fetchData();
    });
    const unsubDeleted = socketService.on('TEST_DELETED', () => {
      fetchData();
    });

    // Listen for WebUSB Device events
    const unsubUsb = webUsbAdbService.subscribe((event, data) => {
      if (event === 'CONNECTED') {
        browserUsbDeviceRef.current = data;
        setBrowserUsbDevice(data);
        setSelectedDevice(data);
      } else if (event === 'DISCONNECTED') {
        browserUsbDeviceRef.current = null;
        setBrowserUsbDevice(null);
        setSelectedDevice((prev) => (prev?.serial === data?.serial ? null : prev));
      }
    });

    // Check for already authorized WebUSB devices on mount
    webUsbAdbService.autoConnectExisting().catch(() => {});

    // Poll devices and diagnostics every 10s if authenticated
    const interval = setInterval(() => {
      if (api.getCurrentUser()) {
        fetchData();
      }
    }, 10000);

    return () => {
      clearInterval(interval);
      if (typeof unsubDevices === 'function') unsubDevices();
      if (typeof unsubFinished === 'function') unsubFinished();
      if (typeof unsubDeleted === 'function') unsubDeleted();
      unsubUsb();
    };
  }, [fetchData]);

  // Sync Bug Desk module settings with currentUser and storage events
  useEffect(() => {
    if (currentUser?.id) {
      setBugDeskModuleSettings(getModuleSettings(currentUser.id));
    } else {
      setBugDeskModuleSettings(null);
    }
  }, [currentUser]);

  useEffect(() => {
    const handleSettingsUpdated = (e) => {
      if (e.detail) {
        setBugDeskModuleSettings(e.detail);
      }
    };
    window.addEventListener('bugdesk:settings-updated', handleSettingsUpdated);
    return () => window.removeEventListener('bugdesk:settings-updated', handleSettingsUpdated);
  }, []);

  // Sync window URL path with Bug Desk tabs
  useEffect(() => {
    const parseUrlTab = () => {
      const path = window.location.pathname.toLowerCase();
      if (path.startsWith('/bug-desk')) {
        setCurrentTab('bug-desk');
        if (path.includes('/new-bug') || path.endsWith('/new')) {
          setBugDeskTab('new-bug');
        } else if (path.includes('/history')) {
          setBugDeskTab('history');
        } else if (path.includes('/settings')) {
          setBugDeskTab('settings');
        } else {
          setBugDeskTab('dashboard');
        }
      }
    };

    parseUrlTab();
    window.addEventListener('popstate', parseUrlTab);
    return () => window.removeEventListener('popstate', parseUrlTab);
  }, []);

  const handleTabChange = (newTab) => {
    setCurrentTab(newTab);
    if (newTab === 'screen-mirror') {
      setMirrorModalOpen(false);
    }
    if (newTab === 'bug-desk') {
      window.history.pushState({}, '', `/bug-desk/${bugDeskTab}`);
    } else if (window.location.pathname.startsWith('/bug-desk')) {
      window.history.pushState({}, '', '/');
    }
  };

  // If no selectedDevice, ensure mirror session & modal are deactivated
  useEffect(() => {
    if (!selectedDevice) {
      setMirrorSessionActive(false);
      setMirrorModalOpen(false);
      screenMirrorStreamManager.unregisterStream();
    }
  }, [selectedDevice]);

  // Reconcile backend mirror status on device selection or initial mount
  useEffect(() => {
    if (selectedDevice?.serial && !mirrorSessionActive) {
      api.getMirrorStatus(selectedDevice.serial)
        .then((res) => {
          if (res?.status?.active) {
            setMirrorSessionActive(true);
          }
        })
        .catch(() => {});
    }
  }, [selectedDevice?.serial, mirrorSessionActive]);

  const handleBugDeskTabChange = (newSubTab) => {
    setBugDeskTab(newSubTab);
    window.history.pushState({}, '', `/bug-desk/${newSubTab}`);
  };

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
    setIsAuthenticated(true);
    setAuthModalOpen(false);
    fetchData();
  };

  const handleLogout = async () => {
    webUsbAdbService.disconnect();
    browserUsbDeviceRef.current = null;
    setBrowserUsbDevice(null);
    await api.logout();
    setCurrentUser(null);
    setIsAuthenticated(false);
    setDevices([]);
    setSelectedDevice(null);
    setBuilds([]);
    setSelectedBuild(null);
    setSummaryStats(null);
    setAuthModalMode('login');
    setAuthModalOpen(true);
  };

  const handleDeviceConnected = (newDevice) => {
    fetchData();
    if (newDevice) setSelectedDevice(newDevice);
  };

  const handleConnectBrowserUsb = async () => {
    guardAction(async () => {
      try {
        const diag = await webUsbAdbService.getDiagnostics();
        if (diag.status !== 'ready') {
          setUsbDiagnostics(diag);
          setUsbDiagModalOpen(true);
          return;
        }
        const dev = await webUsbAdbService.requestAndConnect(devices);
        if (dev) {
          browserUsbDeviceRef.current = dev;
          setBrowserUsbDevice(dev);
          setSelectedDevice(dev);
        }
      } catch (err) {
        if (err.isCancelled) return;
        if (err.isHostAdbConflict) {
          setUsbDiagnostics({
            status: 'host_adb_conflict',
            message: err.message,
            conflictSerial: err.conflictSerial,
            browser: 'Google Chrome / Edge',
            webUsbSupported: true,
            isSecureContext: true
          });
          setUsbDiagModalOpen(true);
        } else if (err.diagnostics) {
          setUsbDiagnostics(err.diagnostics);
          setUsbDiagModalOpen(true);
        } else {
          alert(err.message || 'Failed to connect USB device.');
        }
      }
    });
  };

  const handleBuildUploaded = (newBuild) => {
    fetchData();
    if (newBuild) setSelectedBuild(newBuild);
  };

  const handleDisconnectDevice = async (serial) => {
    if (serial && serial.startsWith('browser_usb_')) {
      webUsbAdbService.disconnect();
      browserUsbDeviceRef.current = null;
      setBrowserUsbDevice(null);
      setSelectedDevice((prev) => (prev?.serial === serial ? null : prev));
      return;
    }
    try {
      await api.disconnectDevice(serial);
      fetchData();
    } catch (err) {
      alert(`Disconnect failed: ${err.message}`);
    }
  };



  const handleMirrorDevice = (device) => {
    guardAction(() => {
      if (device) setSelectedDevice(device);
      setCurrentTab('screen-mirror');
    });
  };

  const handleDeleteBuild = async (id) => {
    if (window.confirm('Are you sure you want to delete this build?')) {
      try {
        await api.deleteBuild(id);
        fetchData();
      } catch (err) {
        alert(`Delete failed: ${err.message}`);
      }
    }
  };

  // Combined device list: Browser USB + Server ADB devices (deduplicating same physical hardware serial)
  const combinedDevices = (() => {
    if (!browserUsbDevice) return devices;
    const hwSerial = browserUsbDevice.hardwareSerial || browserUsbDevice.serial?.replace('browser_usb_', '');
    const filteredServerDevices = devices.filter((d) => {
      if (d.serial === browserUsbDevice.serial) return false;
      if (hwSerial && (d.serial === hwSerial || d.hardwareSerial === hwSerial)) {
        return false;
      }
      return true;
    });
    return [browserUsbDevice, ...filteredServerDevices];
  })();

  // Action guards requiring authentication
  const guardAction = (actionFn) => {
    if (!isAuthenticated) {
      setAuthModalOpen(true);
      return;
    }
    actionFn();
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#080A0F] text-[#FFFFFF] font-sans antialiased">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        setTab={handleTabChange}
        runningTestCount={summaryStats?.running || 0}
        onOpenTourModal={() => setTourModalOpen(true)}
        currentUser={currentUser}
      />

      {/* Main Content Area */}
      <div className={`flex-1 flex flex-col min-w-0 overflow-hidden ${currentTab === 'bug-desk' ? 'bg-[#0A0D14]' : 'bg-qa-isometric'}`}>
        {/* Header with live status & User Profile */}
        <Header
          currentUser={currentUser}
          isAuthenticated={isAuthenticated}
          selectedDevice={selectedDevice}
          diagnostics={diagnostics}
          onOpenPairModal={() => guardAction(() => setPairModalOpen(true))}
          onOpenTourModal={() => setTourModalOpen(true)}
          onOpenAuthModal={() => {
            setAuthModalMode('login');
            setAuthModalOpen(true);
          }}
          onLogout={handleLogout}
          onNavigate={handleTabChange}
          currentTab={currentTab}
          bugDeskTab={bugDeskTab}
          onSelectBugDeskTab={handleBugDeskTabChange}
          bugDeskModuleSettings={bugDeskModuleSettings}
          onOpenSwitchModule={() => setBugDeskSwitchOpen(true)}
          onOpenMirror={() => {
            if (!selectedDevice && combinedDevices.length > 0) {
              setSelectedDevice(combinedDevices[0]);
            }
            setMirrorSessionActive(true);
            setMirrorModalOpen(true);
          }}
        />

        {/* Scrollable Page Views */}
        <main className={`flex-1 overflow-y-auto ${currentTab === 'mixpanel-validator' ? 'p-4 lg:p-5 w-full flex flex-col min-h-0' : currentTab === 'bug-desk' ? 'p-0 w-full flex flex-col min-h-0' : 'p-6 lg:p-8 max-w-7xl w-full mx-auto'}`}>
          {/* Unauthenticated Security Banner */}
          {!isAuthenticated && (
            <div className="mb-6 p-4 rounded-xl bg-[#261D10]/80 border border-[#78350F] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg animate-fadeIn">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#F59E0B]/20 text-[#F59E0B]">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-[#FFFFFF]">Authentication Required</h4>
                  <p className="text-[11px] text-[#94A3B8]">
                    Sign in to access your connected devices, uploaded builds, and run Play Asset Delivery tests.
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setAuthModalMode('login');
                  setAuthModalOpen(true);
                }}
                className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-all flex items-center gap-1.5 whitespace-nowrap"
              >
                <LogIn className="w-3.5 h-3.5 text-[#000000]" />
                <span>Sign In / Register</span>
              </button>
            </div>
          )}

          <ErrorBoundary onReset={fetchData}>
            {currentTab === 'dashboard' && (
              <Dashboard
                devices={combinedDevices}
                selectedDevice={selectedDevice}
                builds={builds}
                selectedBuild={selectedBuild}
                summaryStats={summaryStats}
                onNavigate={setCurrentTab}
                onOpenPairModal={() => guardAction(() => setPairModalOpen(true))}
                onConnectBrowserUsb={handleConnectBrowserUsb}
                onOpenUploadModal={() => guardAction(() => setUploadModalOpen(true))}
                onOpenTourModal={() => setTourModalOpen(true)}
              />
            )}

            {currentTab === 'devices' && (
              <DevicesPage
                devices={combinedDevices}
                selectedDevice={selectedDevice}
                currentUser={currentUser}
                onSelectDevice={setSelectedDevice}
                onMirrorDevice={handleMirrorDevice}
                onOpenPairModal={() => guardAction(() => setPairModalOpen(true))}
                onOpenAgentPairModal={() => guardAction(() => setAgentPairModalOpen(true))}
                onConnectBrowserUsb={handleConnectBrowserUsb}
                onOpenUsbDiagnostics={() => {
                  webUsbAdbService.getDiagnostics().then(d => { setUsbDiagnostics(d); setUsbDiagModalOpen(true); });
                }}
                onRefreshDevices={fetchData}
                onDisconnectDevice={handleDisconnectDevice}
                loading={loading}
              />
            )}

            <div className={currentTab === 'screen-mirror' ? 'block' : 'hidden'}>
              <ScreenMirrorPage
                devices={combinedDevices}
                selectedDevice={selectedDevice}
                onSelectDevice={setSelectedDevice}
                onOpenPairModal={() => guardAction(() => setPairModalOpen(true))}
                onConnectBrowserUsb={handleConnectBrowserUsb}
                isActive={currentTab === 'screen-mirror'}
              />
            </div>

            {currentTab === 'ui-inspector' && (
              <UiInspectorPage
                devices={combinedDevices}
                selectedDevice={selectedDevice}
                onSelectDevice={setSelectedDevice}
                onOpenPairModal={() => guardAction(() => setPairModalOpen(true))}
              />
            )}

            {currentTab === 'builds' && (
              <BuildsPage
                builds={builds}
                selectedBuild={selectedBuild}
                onSelectBuild={setSelectedBuild}
                onOpenUploadModal={() => guardAction(() => setUploadModalOpen(true))}
                onDeleteBuild={handleDeleteBuild}
                loading={loading}
              />
            )}

            {currentTab === 'google-drive' && (
              <GoogleDrivePage currentUser={currentUser} />
            )}

            {currentTab === 'run-test' && (
              <RunTestPage
                devices={combinedDevices}
                selectedDevice={selectedDevice}
                setSelectedDevice={setSelectedDevice}
                builds={builds}
                selectedBuild={selectedBuild}
                setSelectedBuild={setSelectedBuild}
                onOpenPairModal={() => guardAction(() => setPairModalOpen(true))}
                onConnectBrowserUsb={handleConnectBrowserUsb}
                onOpenUsbDiagnostics={() => {
                  webUsbAdbService.getDiagnostics().then(d => { setUsbDiagnostics(d); setUsbDiagModalOpen(true); });
                }}
                onOpenUploadModal={() => guardAction(() => setUploadModalOpen(true))}
              />
            )}

            {currentTab === 'mixpanel-validator' && (
              <MixpanelValidatorPage
                devices={combinedDevices}
                selectedDevice={selectedDevice}
                setSelectedDevice={setSelectedDevice}
                currentUser={currentUser}
              />
            )}

            {currentTab === 'history' && (
              <TestHistoryPage currentUser={currentUser} />
            )}

            {currentTab === 'adb-ops' && (
              <AdbOperationsPage
                devices={combinedDevices}
                selectedDevice={selectedDevice}
                setSelectedDevice={setSelectedDevice}
                onOpenPairModal={() => guardAction(() => setPairModalOpen(true))}
                onConnectBrowserUsb={handleConnectBrowserUsb}
              />
            )}

            {currentTab === 'sop' && (
              <SopPage
                onNavigate={setCurrentTab}
                onOpenPairModal={() => guardAction(() => setPairModalOpen(true))}
                onOpenUploadModal={() => guardAction(() => setUploadModalOpen(true))}
              />
            )}

            {currentTab === 'diagnostics' && (
              <DiagnosticsPage
                diagnostics={diagnostics}
                onRefresh={fetchData}
                loading={loading}
              />
            )}

            {currentTab === 'admin-users' && (
              currentUser?.role === 'ADMIN' ? (
                <AdminUsersPage currentUser={currentUser} />
              ) : (
                <div className="p-8 text-center text-slate-400">
                  <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
                  <h3 className="text-base font-bold text-white">Access Forbidden</h3>
                  <p className="text-xs text-slate-400 mt-1">Administrator privileges are required to access User Management.</p>
                </div>
              )
            )}

            {currentTab === 'admin-devices' && (
              currentUser?.role === 'ADMIN' ? (
                <AdminDeviceManagementPage currentUser={currentUser} />
              ) : (
                <div className="p-8 text-center text-slate-400">
                  <ShieldAlert className="w-12 h-12 text-rose-500 mx-auto mb-3" />
                  <h3 className="text-base font-bold text-white">Access Forbidden</h3>
                  <p className="text-xs text-slate-400 mt-1">Administrator privileges are required to access Device Management.</p>
                </div>
              )
            )}

            {isAuthenticated ? (
              <div className={currentTab === 'bug-desk' ? 'block' : 'hidden'}>
                <BugDeskApp
                  currentUser={currentUser}
                  onLogout={handleLogout}
                  activeSubTab={bugDeskTab}
                  onSelectSubTab={handleBugDeskTabChange}
                  switchModuleOpen={bugDeskSwitchOpen}
                  setSwitchModuleOpen={setBugDeskSwitchOpen}
                />
              </div>
            ) : (
              currentTab === 'bug-desk' && (
                <div className="p-12 text-center text-slate-400 max-w-md mx-auto my-12 bg-[#0F1420] border border-[#1E2638] rounded-2xl shadow-xl">
                  <div className="w-12 h-12 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 mx-auto mb-4">
                    <Lock className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white">Sign In Required</h3>
                  <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                    Please sign in to your QA Platform account to access your personal Bug Desk workspace, saved API keys, and bug reports.
                  </p>
                  <button
                    onClick={() => {
                      setAuthModalMode('login');
                      setAuthModalOpen(true);
                    }}
                    className="mt-5 px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-black font-bold text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
                  >
                    Sign In to QA Platform
                  </button>
                </div>
              )
            )}
          </ErrorBoundary>
        </main>
      </div>

      {/* Native Authentication Modal */}
      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        onLoginSuccess={handleLoginSuccess}
        initialMode={authModalMode}
        resetToken={authResetToken}
      />

      {/* QA Device Agent Pairing Modal */}
      <PairAgentModal
        isOpen={agentPairModalOpen}
        onClose={() => setAgentPairModalOpen(false)}
        onAgentPaired={fetchData}
      />

      {/* Wireless Debugging Pair & Connect Modal */}
      <WirelessPairModal
        isOpen={pairModalOpen}
        onClose={() => setPairModalOpen(false)}
        onDeviceConnected={handleDeviceConnected}
      />

      {/* AAB Upload Modal */}
      <AabUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onBuildUploaded={handleBuildUploaded}
      />

      {/* Interactive Guided App Tour Modal */}
      <AppTourModal
        isOpen={tourModalOpen}
        onClose={() => setTourModalOpen(false)}
        onNavigate={handleTabChange}
      />

      {/* WebUSB Device Diagnostics & Insecure Context Modal */}
      <WebUsbDiagnosticsModal
        isOpen={usbDiagModalOpen}
        onClose={() => setUsbDiagModalOpen(false)}
        onConnectUsb={handleConnectBrowserUsb}
        initialDiagnostics={usbDiagnostics}
      />

      {/* Screen Mirror Modal (Accessible from BugDesk and across the QA Platform) */}
      {mirrorSessionActive && selectedDevice && currentTab !== 'screen-mirror' && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md transition-opacity duration-200 ${
            mirrorModalOpen
              ? 'opacity-100 pointer-events-auto'
              : 'opacity-0 pointer-events-none -top-[99999px] -left-[99999px]'
          }`}
          aria-hidden={!mirrorModalOpen}
        >
          <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col">
            <ScreenMirrorView
              device={selectedDevice}
              onClose={() => setMirrorModalOpen(false)}
              onStopMirror={() => {
                setMirrorSessionActive(false);
                setMirrorModalOpen(false);
              }}
              isActive={mirrorModalOpen}
            />
          </div>
        </div>
      )}

      {/* Sonner toast provider for notifications across Bug Desk */}
      <Toaster position="top-right" richColors theme="dark" closeButton />
    </div>
  );
}
