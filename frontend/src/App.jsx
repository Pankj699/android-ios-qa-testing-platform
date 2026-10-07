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

import Dashboard from './pages/Dashboard';
import DevicesPage from './pages/DevicesPage';
import ScreenMirrorPage from './pages/ScreenMirrorPage';
import BuildsPage from './pages/BuildsPage';
import RunTestPage from './pages/RunTestPage';
import TestHistoryPage from './pages/TestHistoryPage';
import AdbOperationsPage from './pages/AdbOperationsPage';
import SopPage from './pages/SopPage';
import DiagnosticsPage from './pages/DiagnosticsPage';

import { api } from './services/api';
import { socketService } from './services/socket';
import { webUsbAdbService } from './services/webUsbAdbService';
import { Lock, LogIn, ShieldAlert } from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState(() => api.getCurrentUser());
  const [isAuthenticated, setIsAuthenticated] = useState(() => !!api.getCurrentUser());

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

      const deviceList = devicesRes.devices || [];
      setDevices(deviceList);
      setSelectedDevice((prev) => {
        const currentUsb = browserUsbDeviceRef.current;
        // If current selected device is the active browser USB device, keep it!
        if (currentUsb && prev && (prev.serial === currentUsb.serial || prev.connectionMode === 'browser-usb' || prev.serial?.startsWith('browser_usb_'))) {
          return currentUsb;
        }
        // If previous was a server device, check if it is still connected (by serial or physical hardwareSerial)
        if (prev) {
          const stillConnected = deviceList.find(
            (d) =>
              d.serial === prev.serial ||
              (prev.hardwareSerial && (d.hardwareSerial === prev.hardwareSerial || d.serial === prev.hardwareSerial)) ||
              (d.hardwareSerial && (d.hardwareSerial === prev.serial))
          );
          if (stillConnected) return stillConnected;
        }
        // Fallback: prefer active browser USB device, otherwise first available server device, or null
        return currentUsb || deviceList[0] || null;
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

    // Connect WebSocket and listen for real-time device updates across clients
    socketService.connect();
    const unsubDevices = socketService.on('DEVICES_UPDATED', () => {
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
      unsubDevices();
      unsubUsb();
    };
  }, [fetchData]);

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

  const handleClaimDevice = async (serial) => {
    if (serial && serial.startsWith('browser_usb_')) return;
    try {
      await api.claimDevice(serial);
      fetchData();
    } catch (err) {
      alert(`Claim failed: ${err.message}`);
    }
  };

  const handleReleaseDevice = async (serial) => {
    if (serial && serial.startsWith('browser_usb_')) return;
    try {
      await api.releaseDevice(serial);
      fetchData();
    } catch (err) {
      alert(`Release failed: ${err.message}`);
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
    <div className="flex h-screen overflow-hidden bg-[#0A0D14] text-[#FFFFFF] font-sans antialiased">
      {/* Sidebar Navigation */}
      <Sidebar
        currentTab={currentTab}
        setTab={setCurrentTab}
        runningTestCount={summaryStats?.running || 0}
        onOpenTourModal={() => setTourModalOpen(true)}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
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
          onNavigate={setCurrentTab}
        />

        {/* Scrollable Page Views */}
        <main className="flex-1 overflow-y-auto p-6 lg:p-8 max-w-7xl w-full mx-auto">
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
                onClaimDevice={handleClaimDevice}
                onReleaseDevice={handleReleaseDevice}
                loading={loading}
              />
            )}

            {currentTab === 'screen-mirror' && (
              <ScreenMirrorPage
                devices={combinedDevices}
                selectedDevice={selectedDevice}
                onSelectDevice={setSelectedDevice}
                onOpenPairModal={() => guardAction(() => setPairModalOpen(true))}
                onConnectBrowserUsb={handleConnectBrowserUsb}
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

            {currentTab === 'history' && (
              <TestHistoryPage />
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
        onNavigate={setCurrentTab}
      />

      {/* WebUSB Device Diagnostics & Insecure Context Modal */}
      <WebUsbDiagnosticsModal
        isOpen={usbDiagModalOpen}
        onClose={() => setUsbDiagModalOpen(false)}
        onConnectUsb={handleConnectBrowserUsb}
        initialDiagnostics={usbDiagnostics}
      />
    </div>
  );
}
