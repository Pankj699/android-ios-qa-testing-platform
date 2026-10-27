import React, { useState, useEffect, useRef } from 'react';
import {
  Wifi,
  QrCode,
  KeyRound,
  Radio,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
  Info,
  ArrowRight,
  RefreshCw,
  Smartphone,
  ShieldCheck,
  Check,
  Terminal,
  Activity,
  Layers
} from 'lucide-react';
import QRCode from 'qrcode';
import { api } from '../services/api';
import { toast } from '../utils/toast';

export default function WirelessPairModal({ isOpen, onClose, onDeviceConnected }) {
  const [activeTab, setActiveTab] = useState('qr'); // 'qr' | 'code' | 'discovered'
  
  // QR Pairing Session State
  const [qrSession, setQrSession] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [qrStatus, setQrStatus] = useState('IDLE'); // 'IDLE' | 'LOADING' | 'NOT_PAIRED' | 'PAIRING' | 'PAIRED' | 'CONNECTING' | 'CONNECTED' | 'ERROR' | 'EXPIRED'
  const [statusMessage, setStatusMessage] = useState('');
  const [countdown, setCountdown] = useState(120);
  const [qrError, setQrError] = useState(null);

  // Manual Pairing Code State
  const [ip, setIp] = useState('');
  const [pairPort, setPairPort] = useState('');
  const [pairCode, setPairCode] = useState('');
  const [connectPort, setConnectPort] = useState('');
  const [manualStep, setManualStep] = useState('pair'); // 'pair' | 'connect'
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState(null);
  const [manualSuccessMsg, setManualSuccessMsg] = useState(null);

  // Discovered Devices State
  const [discoveredDevices, setDiscoveredDevices] = useState([]);
  const [loadingDiscovered, setLoadingDiscovered] = useState(false);
  const [connectingSerial, setConnectingSerial] = useState(null);

  // Diagnostics State
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [diagnosticsData, setDiagnosticsData] = useState(null);
  const [loadingDiag, setLoadingDiag] = useState(false);

  const pollTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);

  // Start QR Pairing Session
  const startQrSession = async () => {
    setQrStatus('LOADING');
    setStatusMessage('Generating Android Studio-compatible wireless pairing QR...');
    setQrError(null);
    setQrDataUrl(null);

    try {
      const res = await api.startWirelessQrSession();
      setQrSession(res);
      setCountdown(res.timeoutSeconds || 120);

      // Generate visual QR code with high resolution for large crisp display
      const url = await QRCode.toDataURL(res.qrPayload, {
        width: 320,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        },
        errorCorrectionLevel: 'M'
      });
      setQrDataUrl(url);
      setQrStatus('NOT_PAIRED');
      setStatusMessage('Waiting for Android device to scan QR code...');
    } catch (err) {
      setQrStatus('ERROR');
      setQrError(err.message || 'Failed to initialize wireless pairing session.');
    }
  };

  // Poll pairing status while session is active
  useEffect(() => {
    if (!isOpen || activeTab !== 'qr' || !qrSession?.sessionId || qrStatus === 'CONNECTED' || qrStatus === 'ERROR' || qrStatus === 'EXPIRED') {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      return;
    }

    const checkStatus = async () => {
      try {
        const res = await api.getWirelessQrStatus(qrSession.sessionId);
        if (res.status) {
          setQrStatus(res.status);
          if (res.statusMessage) setStatusMessage(res.statusMessage);

          if (res.status === 'CONNECTED' && res.device) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            if (onDeviceConnected) {
              onDeviceConnected(res.device);
            }
            setTimeout(() => {
              onClose();
            }, 1500);
          } else if (res.status === 'PAIRING_FAILED' || res.status === 'CONNECTION_FAILED') {
            setQrError(res.error || res.statusMessage);
          }
        }
      } catch (err) {
        // Ignore transient poll network errors
      }
    };

    pollTimerRef.current = setInterval(checkStatus, 1000);
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, [isOpen, activeTab, qrSession, qrStatus, onDeviceConnected, onClose]);

  // Countdown timer for QR expiration
  useEffect(() => {
    if (!isOpen || activeTab !== 'qr' || qrStatus === 'CONNECTED' || qrStatus === 'EXPIRED') {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      return;
    }

    countdownTimerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownTimerRef.current);
          setQrStatus('EXPIRED');
          setStatusMessage('QR code expired. Click "Refresh QR" to generate a fresh pairing session.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
  }, [isOpen, activeTab, qrStatus]);

  // Fetch discovered devices when Discovered tab is clicked
  const fetchDiscovered = async () => {
    setLoadingDiscovered(true);
    try {
      const res = await api.getDiscoveredWirelessDevices();
      setDiscoveredDevices(res.devices || []);
    } catch (e) {
      setDiscoveredDevices([]);
    } finally {
      setLoadingDiscovered(false);
    }
  };

  // Fetch diagnostics
  const fetchDiagnostics = async () => {
    setLoadingDiag(true);
    try {
      const res = await api.getWirelessDiagnostics();
      setDiagnosticsData(res.diagnostics);
    } catch (e) {
      setDiagnosticsData(null);
    } finally {
      setLoadingDiag(false);
    }
  };

  // Initialize session on modal open
  useEffect(() => {
    if (isOpen) {
      if (activeTab === 'qr') {
        startQrSession();
      } else if (activeTab === 'discovered') {
        fetchDiscovered();
      }
    } else {
      if (qrSession?.sessionId) {
        api.cancelWirelessQrSession(qrSession.sessionId).catch(() => {});
      }
      setQrSession(null);
      setQrDataUrl(null);
      setQrStatus('IDLE');
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  // Handle manual pairing
  const handleManualPair = async (e) => {
    e.preventDefault();
    if (!ip || !pairPort || !pairCode) {
      setManualError('Please fill in Device IP, Pairing Port, and 6-Digit Pairing Code.');
      return;
    }

    setManualLoading(true);
    setManualError(null);
    setManualSuccessMsg(null);

    try {
      const res = await api.pairWirelessWithCode(ip.trim(), pairPort.trim(), pairCode.trim());
      setManualSuccessMsg(`✓ Successfully paired with ${ip}:${pairPort}! Now enter your Wireless Debugging connection port.`);
      toast.success(`Successfully paired with ${ip}:${pairPort}!`);
      setManualStep('connect');
    } catch (err) {
      setManualError(err.message || 'Failed to pair device.');
      toast.error(err.message || 'Failed to pair device.');
    } finally {
      setManualLoading(false);
    }
  };

  // Handle manual connect
  const handleManualConnect = async (e) => {
    e.preventDefault();
    if (!ip || !connectPort) {
      setManualError('Please fill in Connection Port.');
      return;
    }

    setManualLoading(true);
    setManualError(null);
    setManualSuccessMsg(null);

    try {
      const res = await api.connectWirelessDevice(ip.trim(), connectPort.trim(), 'browser-wireless');
      setManualSuccessMsg(`✓ Successfully connected to ${res.serial}!`);
      toast.success(`Device connected successfully: ${res.serial}`);
      setTimeout(() => {
        if (onDeviceConnected) {
          onDeviceConnected(res.device || { serial: res.serial, connected: true, connectionMode: 'browser-wireless' });
        }
        onClose();
      }, 1000);
    } catch (err) {
      setManualError(err.message || 'Failed to connect to device.');
      toast.error(err.message || 'Failed to connect to device.');
    } finally {
      setManualLoading(false);
    }
  };

  // Handle 1-click connect to discovered mDNS device
  const handleConnectDiscovered = async (dev) => {
    setConnectingSerial(dev.address);
    try {
      const res = await api.connectWirelessDevice(dev.ip, dev.port, 'browser-wireless');
      toast.success(`Device connected successfully: ${res.serial || dev.name}`);
      if (onDeviceConnected) {
        onDeviceConnected(res.device || { serial: res.serial, connected: true, connectionMode: 'browser-wireless' });
      }
      setTimeout(onClose, 800);
    } catch (err) {
      toast.error(`Connection failed: ${err.message}`);
    } finally {
      setConnectingSerial(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div 
        className="w-full max-w-[900px] glass rounded-2xl border border-[var(--line)] shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-48px)] my-auto"
        style={{ width: 'min(900px, calc(100vw - 48px))' }}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[var(--line)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[var(--violet)] to-[var(--pink)] flex items-center justify-center text-white shadow-md shadow-[var(--violet)]/20 shrink-0">
              <Wifi className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-[var(--ink)] text-base truncate">Pair & Connect Android Device</h3>
                <span className="chip-badge chip-badge-primary whitespace-nowrap text-[10px]">
                  Android 11+
                </span>
              </div>
              <p className="text-xs text-[var(--muted)] mt-0.5">Android Wireless Debugging (QR & TLS Handshake)</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setShowDiagnostics(!showDiagnostics);
                if (!showDiagnostics) fetchDiagnostics();
              }}
              className={`p-2 sm:px-3 sm:py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5 cursor-pointer ${
                showDiagnostics
                  ? 'btn-magic text-white shadow-xs'
                  : 'btn-soft text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
              title="Wireless Debugging Diagnostics & mDNS Discovery"
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="text-[11px] hidden sm:inline">Diagnostics</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-xl text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--card)] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 py-2.5 border-b border-[var(--line)] bg-[var(--card)]/40 flex items-center justify-between overflow-x-auto gap-2">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => setActiveTab('qr')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'qr'
                  ? 'btn-magic text-white shadow-xs'
                  : 'btn-soft text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Pair with QR Code</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-white/20 text-white">
                Recommended
              </span>
            </button>

            <button
              onClick={() => setActiveTab('code')}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'code'
                  ? 'btn-magic text-white shadow-xs'
                  : 'btn-soft text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Pair with Code</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('discovered');
                fetchDiscovered();
              }}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer ${
                activeTab === 'discovered'
                  ? 'btn-magic text-white shadow-xs'
                  : 'btn-soft text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Radio className="w-3.5 h-3.5" />
              <span>Already Paired?</span>
              {discoveredDevices.length > 0 && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              )}
            </button>
          </div>
        </div>

        {/* Scrollable Body */}
        <div className="p-6 md:p-8 overflow-y-auto space-y-6 flex-1">
          {/* Diagnostics Panel (if toggled) */}
          {showDiagnostics && (
            <div className="p-4 rounded-xl bg-[var(--card)] border border-[var(--line)] text-xs space-y-3 animate-fade-in shadow-inner">
              <div className="flex items-center justify-between border-b border-[var(--line)] pb-2">
                <div className="flex items-center gap-2 text-[var(--violet)] font-bold">
                  <Terminal className="w-4 h-4" />
                  <span>mDNS & Network Discovery Diagnostics</span>
                </div>
                <button
                  onClick={fetchDiagnostics}
                  disabled={loadingDiag}
                  className="btn-soft p-1 rounded-lg cursor-pointer"
                  title="Refresh Diagnostics"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDiag ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {diagnosticsData ? (
                <div className="space-y-2 text-[11px] font-mono">
                  <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                    <span className="text-[var(--muted)]">QA Host Local IP:</span>
                    <span className="text-[var(--ink)] font-bold">{diagnosticsData.localIp || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                    <span className="text-[var(--muted)]">ADB mDNS Daemon Status:</span>
                    <span className={diagnosticsData.mdnsAvailable ? 'text-emerald-500 font-bold' : 'text-rose-500 font-bold'}>
                      {diagnosticsData.mdnsAvailable ? 'Active & Available' : 'Unavailable'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                    <span className="text-[var(--muted)]">Pairing Services Detected (_adb-tls-pairing):</span>
                    <span className="text-amber-500 font-bold">{diagnosticsData.pairingServicesCount}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[var(--line)]/50">
                    <span className="text-[var(--muted)]">Connected Services Detected (_adb-tls-connect):</span>
                    <span className="text-emerald-500 font-bold">{diagnosticsData.connectServicesCount}</span>
                  </div>

                  {diagnosticsData.discoveredServices?.length > 0 && (
                    <div className="pt-2">
                      <span className="text-[var(--muted)] block mb-1">Discovered Network Services:</span>
                      <div className="space-y-1 max-h-32 overflow-y-auto bg-[var(--card)] p-2 rounded-xl border border-[var(--line)]">
                        {diagnosticsData.discoveredServices.map((s, idx) => (
                          <div key={idx} className="flex justify-between text-[10px]">
                            <span className="text-[var(--ink)] truncate max-w-[200px]">{s.serviceName}</span>
                            <span className={s.isPairing ? 'text-amber-500 font-semibold' : 'text-emerald-500 font-semibold'}>
                              {s.address} ({s.isPairing ? 'pairing' : 'connect'})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center py-4 text-[var(--muted)]">
                  <Loader2 className="w-4 h-4 animate-spin mr-2 text-[var(--violet)]" />
                  <span>Loading network discovery diagnostics...</span>
                </div>
              )}
            </div>
          )}

          {/* TAB 1: PAIR WITH QR CODE */}
          {activeTab === 'qr' && (
            <div className="space-y-6">
              {/* Responsive Two-Column Layout on Desktop */}
              <div className="grid grid-cols-1 md:grid-cols-[340px_1fr] lg:grid-cols-[360px_1fr] gap-6 lg:gap-8 items-start">
                {/* LEFT COLUMN: QR Code Container */}
                <div className="flex flex-col items-center justify-center p-6 rounded-2xl glass border border-[var(--line)] text-center w-full max-w-[360px] mx-auto shadow-sm">
                  {qrStatus === 'LOADING' ? (
                    <div className="w-[280px] h-[280px] flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-10 h-10 text-[var(--violet)] animate-spin" />
                      <span className="text-xs text-[var(--muted)] font-medium">Generating Pairing QR...</span>
                    </div>
                  ) : qrStatus === 'CONNECTED' ? (
                    <div className="w-[280px] h-[280px] flex flex-col items-center justify-center gap-3 text-emerald-500 animate-in zoom-in-95">
                      <CheckCircle2 className="w-16 h-16" />
                      <span className="text-base font-bold text-[var(--ink)]">Device Connected!</span>
                      <span className="text-xs text-[var(--muted)]">Closing dialog...</span>
                    </div>
                  ) : qrStatus === 'EXPIRED' ? (
                    <div className="w-[280px] h-[280px] flex flex-col items-center justify-center gap-4 text-[var(--muted)]">
                      <AlertCircle className="w-12 h-12 text-amber-500" />
                      <div>
                        <span className="text-sm text-[var(--ink)] font-semibold block">QR Code Expired</span>
                        <span className="text-xs text-[var(--muted)] mt-1 block">Security token expired after 2 minutes</span>
                      </div>
                      <button
                        onClick={startQrSession}
                        className="btn-magic px-4 py-2 rounded-xl text-white text-xs font-bold transition-all flex items-center gap-2 shadow-md cursor-pointer"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Refresh QR</span>
                      </button>
                    </div>
                  ) : qrDataUrl ? (
                    <div className="space-y-4 flex flex-col items-center w-full">
                      <div className="p-3 bg-white rounded-2xl shadow-xl border-2 border-[var(--violet)]/40">
                        <img
                          src={qrDataUrl}
                          alt="Android Wireless Debugging QR Code"
                          className="w-[260px] sm:w-[280px] h-[260px] sm:h-[280px] rounded-xl block object-contain"
                        />
                      </div>
                      <div className="flex items-center justify-between w-full px-2 text-xs text-[var(--muted)] pt-1">
                        <span className="flex items-center gap-1.5">
                          Expires in: <strong className="text-amber-500 font-mono text-sm">{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</strong>
                        </span>
                        <button
                          onClick={startQrSession}
                          className="text-[var(--violet)] hover:underline flex items-center gap-1.5 font-semibold cursor-pointer"
                          title="Regenerate QR Code"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Refresh</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="w-[280px] h-[280px] flex items-center justify-center text-rose-500 text-xs text-center p-4">
                      {qrError || 'Failed to generate QR.'}
                    </div>
                  )}
                </div>

                {/* RIGHT COLUMN: How to Pair on Android 11+ */}
                <div className="space-y-5 flex flex-col justify-between h-full">
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-[var(--ink)] uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-[var(--line)]">
                      <Smartphone className="w-4 h-4 text-[var(--violet)]" />
                      <span>How to Pair on Android 11+</span>
                    </h4>

                    <ol className="space-y-3.5 text-xs text-[var(--muted)]">
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-[var(--card)] text-[var(--ink)] flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-[var(--line)] shadow-xs">
                          1
                        </span>
                        <div className="pt-0.5 leading-relaxed">
                          Open Android <strong className="text-[var(--ink)]">Settings</strong> → <strong className="text-[var(--ink)]">Developer Options</strong>.
                        </div>
                      </li>

                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-[var(--card)] text-[var(--ink)] flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-[var(--line)] shadow-xs">
                          2
                        </span>
                        <div className="pt-0.5 leading-relaxed">
                          Enable <strong className="text-[var(--ink)]">Wireless Debugging</strong>.
                        </div>
                      </li>

                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-gradient-to-tr from-[var(--violet)] to-[var(--pink)] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 shadow-xs">
                          3
                        </span>
                        <div className="pt-0.5 leading-relaxed">
                          Tap <strong className="text-[var(--violet)]">"Pair device with QR code"</strong>.
                        </div>
                      </li>

                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-gradient-to-tr from-[var(--violet)] to-[var(--pink)] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 shadow-xs">
                          4
                        </span>
                        <div className="pt-0.5 leading-relaxed">
                          Scan the QR code displayed on this screen.
                        </div>
                      </li>
                    </ol>
                  </div>

                  <div className="p-4 rounded-xl glass border border-[var(--line)] text-xs text-[var(--muted)] space-y-1.5 mt-2">
                    <span className="font-semibold text-[var(--ink)] flex items-center gap-1.5 text-xs">
                      <Info className="w-4 h-4 text-[var(--violet)]" /> Wi-Fi Network Requirement:
                    </span>
                    <p className="text-[var(--muted)] leading-relaxed text-[11px]">
                      Make sure your Android device and this computer are connected to the same Wi-Fi network.
                    </p>
                  </div>
                </div>
              </div>

              {/* Status Banner */}
              <div className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${
                qrStatus === 'CONNECTED'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                  : qrStatus === 'PAIRING' || qrStatus === 'CONNECTING'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                  : qrStatus === 'ERROR' || qrStatus === 'EXPIRED'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : 'glass border-[var(--line)] text-[var(--ink)]'
              }`}>
                {qrStatus === 'PAIRING' || qrStatus === 'CONNECTING' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[var(--violet)] shrink-0" />
                ) : qrStatus === 'CONNECTED' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                ) : qrStatus === 'ERROR' || qrStatus === 'EXPIRED' ? (
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0" />
                ) : (
                  <Radio className="w-4 h-4 text-[var(--violet)] animate-pulse shrink-0" />
                )}
                <div className="text-xs font-medium flex-1">
                  {statusMessage || 'Waiting for Android device to scan QR code...'}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PAIR WITH PAIRING CODE (FALLBACK) */}
          {activeTab === 'code' && (
            <div className="space-y-5">
              {/* Step indicator */}
              <div className="flex items-center gap-3 pb-3 border-b border-[var(--line)]">
                <div className={`flex items-center gap-2 text-xs font-bold ${manualStep === 'pair' ? 'text-[var(--violet)]' : 'text-emerald-500'}`}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-[var(--card)] text-[var(--violet)] border border-[var(--line)] shadow-xs">
                    1
                  </span>
                  <span>Pair with 6-Digit Code</span>
                </div>

                <ArrowRight className="w-3.5 h-3.5 text-[var(--muted)]" />

                <div className={`flex items-center gap-2 text-xs font-bold ${manualStep === 'connect' ? 'text-[var(--violet)]' : 'text-[var(--muted)]'}`}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-[var(--card)] text-[var(--muted)] border border-[var(--line)] shadow-xs">
                    2
                  </span>
                  <span>Connect to Main Port</span>
                </div>
              </div>

              {manualError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-500 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  <div>{manualError}</div>
                </div>
              )}

              {manualSuccessMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-500 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <div>{manualSuccessMsg}</div>
                </div>
              )}

              {manualStep === 'pair' ? (
                <form onSubmit={handleManualPair} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--ink)] mb-1.5">
                      Device IP Address <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      placeholder="e.g. 192.168.0.86"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--line)] text-xs text-[var(--ink)] font-mono placeholder-[var(--muted)] focus:outline-none focus:border-[var(--violet)] focus:ring-2 focus:ring-[var(--violet)]/20 transition-all"
                      required
                    />
                    <p className="text-[11px] text-[var(--muted)] mt-1">Found in Developer Options → Wireless Debugging → "Pair device with pairing code"</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-[var(--ink)] mb-1.5">
                        Pairing Port <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={pairPort}
                        onChange={(e) => setPairPort(e.target.value)}
                        placeholder="e.g. 39203"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--line)] text-xs text-[var(--ink)] font-mono placeholder-[var(--muted)] focus:outline-none focus:border-[var(--violet)] focus:ring-2 focus:ring-[var(--violet)]/20 transition-all"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-[var(--ink)] mb-1.5">
                        6-Digit Pairing Code <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={pairCode}
                        onChange={(e) => setPairCode(e.target.value)}
                        placeholder="e.g. 842109"
                        maxLength={6}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--line)] text-xs text-[var(--ink)] font-mono tracking-wider placeholder-[var(--muted)] focus:outline-none focus:border-[var(--violet)] focus:ring-2 focus:ring-[var(--violet)]/20 transition-all"
                        required
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setManualStep('connect')}
                      className="text-xs text-[var(--muted)] hover:text-[var(--ink)] underline cursor-pointer"
                    >
                      Already paired? Skip to connect →
                    </button>

                    <button
                      type="submit"
                      disabled={manualLoading}
                      className="btn-magic px-5 py-2.5 rounded-xl disabled:opacity-50 text-xs font-bold text-white transition-all flex items-center gap-2 cursor-pointer shadow-md"
                    >
                      {manualLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Pair Device</span>
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleManualConnect} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-[var(--ink)] mb-1.5">
                      Device IP Address <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      placeholder="e.g. 192.168.0.86"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--line)] text-xs text-[var(--ink)] font-mono placeholder-[var(--muted)] focus:outline-none focus:border-[var(--violet)] focus:ring-2 focus:ring-[var(--violet)]/20 transition-all"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[var(--ink)] mb-1.5">
                      Connection Port <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={connectPort}
                      onChange={(e) => setConnectPort(e.target.value)}
                      placeholder="e.g. 44261 (shown on main Wireless Debugging screen)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[var(--card)] border border-[var(--line)] text-xs text-[var(--ink)] font-mono placeholder-[var(--muted)] focus:outline-none focus:border-[var(--violet)] focus:ring-2 focus:ring-[var(--violet)]/20 transition-all"
                      required
                    />
                    <p className="text-[11px] text-[var(--muted)] mt-1">
                      Note: Android uses different ports for pairing and main connection.
                    </p>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setManualStep('pair')}
                      className="text-xs text-[var(--muted)] hover:text-[var(--ink)] cursor-pointer"
                    >
                      ← Back to Pairing
                    </button>

                    <button
                      type="submit"
                      disabled={manualLoading}
                      className="btn-magic px-5 py-2.5 rounded-xl disabled:opacity-50 text-xs font-bold text-white transition-all flex items-center gap-2 cursor-pointer shadow-md"
                    >
                      {manualLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Connect Device</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: ALREADY PAIRED & DISCOVERED DEVICES */}
          {activeTab === 'discovered' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--line)]">
                <div>
                  <h4 className="text-xs font-bold text-[var(--ink)]">Discovered Wireless Devices</h4>
                  <p className="text-[11px] text-[var(--muted)]">
                    Devices broadcasting active ADB TLS services on the local network.
                  </p>
                </div>
                <button
                  onClick={fetchDiscovered}
                  disabled={loadingDiscovered}
                  className="btn-soft p-1.5 px-3 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDiscovered ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>

              {loadingDiscovered ? (
                <div className="p-10 text-center text-xs text-[var(--muted)] flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-6 h-6 text-[var(--violet)] animate-spin" />
                  <span>Scanning local network for ADB TLS services via mDNS...</span>
                </div>
              ) : discoveredDevices.length > 0 ? (
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {discoveredDevices.map((dev, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl glass border border-[var(--line)] hover:border-[var(--violet)]/40 flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-[var(--violet)]/10 text-[var(--violet)]">
                          <Wifi className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-[var(--ink)] font-mono">{dev.address}</div>
                          <div className="text-[11px] text-[var(--muted)] truncate max-w-[260px] sm:max-w-md">{dev.serviceName}</div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleConnectDiscovered(dev)}
                        disabled={connectingSerial === dev.address}
                        className="btn-magic px-4 py-2 rounded-xl disabled:opacity-50 text-xs font-bold text-white transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        {connectingSerial === dev.address ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>Connect</span>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-10 rounded-xl border border-dashed border-[var(--line)] text-center space-y-2 glass">
                  <Radio className="w-8 h-8 text-[var(--muted)] mx-auto opacity-50" />
                  <div className="text-xs font-semibold text-[var(--ink)]">No Wireless Devices Discovered</div>
                  <p className="text-[11px] text-[var(--muted)] max-w-sm mx-auto">
                    Ensure Wireless Debugging is toggled ON on your Android device and that both devices share the same Wi-Fi.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
