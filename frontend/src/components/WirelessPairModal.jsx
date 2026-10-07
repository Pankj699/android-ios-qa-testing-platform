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
      setManualStep('connect');
    } catch (err) {
      setManualError(err.message || 'Failed to pair device.');
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
      setTimeout(() => {
        if (onDeviceConnected) {
          onDeviceConnected(res.device || { serial: res.serial, connected: true, connectionMode: 'browser-wireless' });
        }
        onClose();
      }, 1000);
    } catch (err) {
      setManualError(err.message || 'Failed to connect to device.');
    } finally {
      setManualLoading(false);
    }
  };

  // Handle 1-click connect to discovered mDNS device
  const handleConnectDiscovered = async (dev) => {
    setConnectingSerial(dev.address);
    try {
      const res = await api.connectWirelessDevice(dev.ip, dev.port, 'browser-wireless');
      if (onDeviceConnected) {
        onDeviceConnected(res.device || { serial: res.serial, connected: true, connectionMode: 'browser-wireless' });
      }
      setTimeout(onClose, 800);
    } catch (err) {
      alert(`Connection failed: ${err.message}`);
    } finally {
      setConnectingSerial(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto">
      <div 
        className="w-full max-w-[900px] bg-[#131924] border border-[#1E2638] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-48px)] my-auto"
        style={{ width: 'min(900px, calc(100vw - 48px))' }}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#1E2638] flex items-center justify-between gap-3 bg-[#0D111A]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 text-[#F59E0B] border border-[#78350F] shrink-0">
              <Wifi className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-bold text-white text-base truncate">Pair & Connect Android Device</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 whitespace-nowrap">
                  Android 11+
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">Android Wireless Debugging (QR & TLS Handshake)</p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setShowDiagnostics(!showDiagnostics);
                if (!showDiagnostics) fetchDiagnostics();
              }}
              className={`p-2 sm:px-3 sm:py-1.5 rounded-lg text-xs font-semibold border transition-colors flex items-center gap-1.5 cursor-pointer ${
                showDiagnostics
                  ? 'bg-amber-500/20 text-[#F59E0B] border-amber-500/40'
                  : 'text-slate-400 hover:text-white bg-[#1E2638] border-[#334155]'
              }`}
              title="Wireless Debugging Diagnostics & mDNS Discovery"
            >
              <Activity className="w-3.5 h-3.5" />
              <span className="text-[11px] hidden sm:inline">Diagnostics</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1E2638] transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-3 border-b border-[#1E2638] bg-[#0A0D14] flex items-center justify-between overflow-x-auto">
          <div className="flex gap-2 min-w-max">
            <button
              onClick={() => setActiveTab('qr')}
              className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-all flex items-center gap-2 border-b-2 cursor-pointer ${
                activeTab === 'qr'
                  ? 'border-[#F59E0B] text-[#F59E0B] bg-[#131924]'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#131924]/50'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Pair with QR Code</span>
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-[#F59E0B]">
                Recommended
              </span>
            </button>

            <button
              onClick={() => setActiveTab('code')}
              className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-all flex items-center gap-2 border-b-2 cursor-pointer ${
                activeTab === 'code'
                  ? 'border-[#F59E0B] text-[#F59E0B] bg-[#131924]'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#131924]/50'
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
              className={`px-4 py-2 text-xs font-bold rounded-t-lg transition-all flex items-center gap-2 border-b-2 cursor-pointer ${
                activeTab === 'discovered'
                  ? 'border-[#F59E0B] text-[#F59E0B] bg-[#131924]'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-[#131924]/50'
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
            <div className="p-4 rounded-xl bg-[#0A0D14] border border-amber-500/30 text-xs space-y-3 animate-in fade-in duration-150">
              <div className="flex items-center justify-between border-b border-[#1E2638] pb-2">
                <div className="flex items-center gap-2 text-[#F59E0B] font-bold">
                  <Terminal className="w-4 h-4" />
                  <span>mDNS & Network Discovery Diagnostics</span>
                </div>
                <button
                  onClick={fetchDiagnostics}
                  disabled={loadingDiag}
                  className="p-1 rounded bg-[#1E2638] hover:bg-[#263248] text-slate-300 cursor-pointer"
                  title="Refresh Diagnostics"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDiag ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {diagnosticsData ? (
                <div className="space-y-2 text-[11px] font-mono">
                  <div className="flex justify-between py-1 border-b border-[#1E2638]/50">
                    <span className="text-slate-400">QA Host Local IP:</span>
                    <span className="text-white font-bold">{diagnosticsData.localIp || 'Unknown'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1E2638]/50">
                    <span className="text-slate-400">ADB mDNS Daemon Status:</span>
                    <span className={diagnosticsData.mdnsAvailable ? 'text-emerald-400' : 'text-rose-400'}>
                      {diagnosticsData.mdnsAvailable ? 'Active & Available' : 'Unavailable'}
                    </span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1E2638]/50">
                    <span className="text-slate-400">Pairing Services Detected (_adb-tls-pairing):</span>
                    <span className="text-[#F59E0B] font-bold">{diagnosticsData.pairingServicesCount}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-[#1E2638]/50">
                    <span className="text-slate-400">Connected Services Detected (_adb-tls-connect):</span>
                    <span className="text-emerald-400 font-bold">{diagnosticsData.connectServicesCount}</span>
                  </div>

                  {diagnosticsData.discoveredServices?.length > 0 && (
                    <div className="pt-2">
                      <span className="text-slate-400 block mb-1">Discovered Network Services:</span>
                      <div className="space-y-1 max-h-32 overflow-y-auto bg-[#131924] p-2 rounded border border-[#1E2638]">
                        {diagnosticsData.discoveredServices.map((s, idx) => (
                          <div key={idx} className="flex justify-between text-[10px]">
                            <span className="text-slate-300 truncate max-w-[200px]">{s.serviceName}</span>
                            <span className={s.isPairing ? 'text-amber-400' : 'text-emerald-400'}>
                              {s.address} ({s.isPairing ? 'pairing' : 'connect'})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center py-4 text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
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
                <div className="flex flex-col items-center justify-center p-6 rounded-2xl bg-[#0A0D14] border border-[#1E2638] text-center w-full max-w-[360px] mx-auto shadow-inner">
                  {qrStatus === 'LOADING' ? (
                    <div className="w-[280px] h-[280px] flex flex-col items-center justify-center gap-3">
                      <Loader2 className="w-10 h-10 text-[#F59E0B] animate-spin" />
                      <span className="text-xs text-slate-400 font-medium">Generating Pairing QR...</span>
                    </div>
                  ) : qrStatus === 'CONNECTED' ? (
                    <div className="w-[280px] h-[280px] flex flex-col items-center justify-center gap-3 text-emerald-400 animate-in zoom-in-95">
                      <CheckCircle2 className="w-16 h-16" />
                      <span className="text-base font-bold text-white">Device Connected!</span>
                      <span className="text-xs text-slate-400">Closing dialog...</span>
                    </div>
                  ) : qrStatus === 'EXPIRED' ? (
                    <div className="w-[280px] h-[280px] flex flex-col items-center justify-center gap-4 text-slate-400">
                      <AlertCircle className="w-12 h-12 text-amber-400" />
                      <div>
                        <span className="text-sm text-slate-200 font-semibold block">QR Code Expired</span>
                        <span className="text-xs text-slate-400 mt-1 block">Security token expired after 2 minutes</span>
                      </div>
                      <button
                        onClick={startQrSession}
                        className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-black text-xs font-bold transition-all flex items-center gap-2 shadow cursor-pointer"
                      >
                        <RefreshCw className="w-4 h-4" />
                        <span>Refresh QR</span>
                      </button>
                    </div>
                  ) : qrDataUrl ? (
                    <div className="space-y-4 flex flex-col items-center w-full">
                      <div className="p-3 bg-white rounded-2xl shadow-xl border-2 border-amber-500/40">
                        <img
                          src={qrDataUrl}
                          alt="Android Wireless Debugging QR Code"
                          className="w-[260px] sm:w-[280px] h-[260px] sm:h-[280px] rounded-lg block object-contain"
                        />
                      </div>
                      <div className="flex items-center justify-between w-full px-2 text-xs text-slate-400 pt-1">
                        <span className="flex items-center gap-1.5">
                          Expires in: <strong className="text-amber-400 font-mono text-sm">{Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}</strong>
                        </span>
                        <button
                          onClick={startQrSession}
                          className="text-[#F59E0B] hover:text-[#FBBF24] hover:underline flex items-center gap-1.5 font-medium cursor-pointer"
                          title="Regenerate QR Code"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Refresh</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="w-[280px] h-[280px] flex items-center justify-center text-rose-400 text-xs text-center p-4">
                      {qrError || 'Failed to generate QR.'}
                    </div>
                  )}
                </div>

                {/* RIGHT COLUMN: How to Pair on Android 11+ */}
                <div className="space-y-5 flex flex-col justify-between h-full">
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 pb-2 border-b border-[#1E2638]">
                      <Smartphone className="w-4 h-4 text-[#F59E0B]" />
                      <span>How to Pair on Android 11+</span>
                    </h4>

                    <ol className="space-y-3.5 text-xs text-slate-300">
                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-[#1E2638] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-[#334155]">
                          1
                        </span>
                        <div className="pt-0.5 leading-relaxed">
                          Open Android <strong className="text-white">Settings</strong> → <strong className="text-white">Developer Options</strong>.
                        </div>
                      </li>

                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-[#1E2638] text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 border border-[#334155]">
                          2
                        </span>
                        <div className="pt-0.5 leading-relaxed">
                          Enable <strong className="text-white">Wireless Debugging</strong>.
                        </div>
                      </li>

                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F] flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                          3
                        </span>
                        <div className="pt-0.5 leading-relaxed">
                          Tap <strong className="text-[#F59E0B]">"Pair device with QR code"</strong>.
                        </div>
                      </li>

                      <li className="flex items-start gap-3">
                        <span className="w-6 h-6 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F] flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
                          4
                        </span>
                        <div className="pt-0.5 leading-relaxed">
                          Scan the QR code displayed on this screen.
                        </div>
                      </li>
                    </ol>
                  </div>

                  <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] text-xs text-slate-400 space-y-1.5 mt-2">
                    <span className="font-semibold text-slate-200 flex items-center gap-1.5 text-xs">
                      <Info className="w-4 h-4 text-[#F59E0B]" /> Wi-Fi Network Requirement:
                    </span>
                    <p className="text-slate-400 leading-relaxed text-[11px]">
                      Make sure your Android device and this computer are connected to the same Wi-Fi network.
                    </p>
                  </div>
                </div>
              </div>

              {/* Status Banner */}
              <div className={`p-4 rounded-xl border flex items-center gap-3 transition-all ${
                qrStatus === 'CONNECTED'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : qrStatus === 'PAIRING' || qrStatus === 'CONNECTING'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : qrStatus === 'ERROR' || qrStatus === 'EXPIRED'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-[#0A0D14] border-[#1E2638] text-slate-300'
              }`}>
                {qrStatus === 'PAIRING' || qrStatus === 'CONNECTING' ? (
                  <Loader2 className="w-4 h-4 animate-spin text-[#F59E0B] shrink-0" />
                ) : qrStatus === 'CONNECTED' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : qrStatus === 'ERROR' || qrStatus === 'EXPIRED' ? (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                ) : (
                  <Radio className="w-4 h-4 text-[#F59E0B] animate-pulse shrink-0" />
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
              <div className="flex items-center gap-3 pb-3 border-b border-[#1E2638]">
                <div className={`flex items-center gap-2 text-xs font-bold ${manualStep === 'pair' ? 'text-[#F59E0B]' : 'text-emerald-400'}`}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                    1
                  </span>
                  <span>Pair with 6-Digit Code</span>
                </div>

                <ArrowRight className="w-3.5 h-3.5 text-slate-600" />

                <div className={`flex items-center gap-2 text-xs font-bold ${manualStep === 'connect' ? 'text-[#F59E0B]' : 'text-slate-500'}`}>
                  <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold bg-[#0A0D14] text-slate-500 border border-[#1E2638]">
                    2
                  </span>
                  <span>Connect to Main Port</span>
                </div>
              </div>

              {manualError && (
                <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>{manualError}</div>
                </div>
              )}

              {manualSuccessMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>{manualSuccessMsg}</div>
                </div>
              )}

              {manualStep === 'pair' ? (
                <form onSubmit={handleManualPair} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Device IP Address <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      placeholder="e.g. 192.168.0.86"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] text-xs text-white font-mono focus:outline-none focus:border-[#F59E0B]"
                      required
                    />
                    <p className="text-[11px] text-slate-400 mt-1">Found in Developer Options → Wireless Debugging → "Pair device with pairing code"</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        Pairing Port <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={pairPort}
                        onChange={(e) => setPairPort(e.target.value)}
                        placeholder="e.g. 39203"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] text-xs text-white font-mono focus:outline-none focus:border-[#F59E0B]"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        6-Digit Pairing Code <span className="text-rose-400">*</span>
                      </label>
                      <input
                        type="text"
                        value={pairCode}
                        onChange={(e) => setPairCode(e.target.value)}
                        placeholder="e.g. 842109"
                        maxLength={6}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] text-xs text-white font-mono tracking-wider focus:outline-none focus:border-[#F59E0B]"
                        required
                      />
                    </div>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setManualStep('connect')}
                      className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
                    >
                      Already paired? Skip to connect →
                    </button>

                    <button
                      type="submit"
                      disabled={manualLoading}
                      className="px-5 py-2.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-black transition-colors flex items-center gap-2 cursor-pointer shadow"
                    >
                      {manualLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      <span>Pair Device</span>
                    </button>
                  </div>
                </form>
              ) : (
                <form onSubmit={handleManualConnect} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Device IP Address <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={ip}
                      onChange={(e) => setIp(e.target.value)}
                      placeholder="e.g. 192.168.0.86"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] text-xs text-white font-mono focus:outline-none focus:border-[#F59E0B]"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Connection Port <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      value={connectPort}
                      onChange={(e) => setConnectPort(e.target.value)}
                      placeholder="e.g. 44261 (shown on main Wireless Debugging screen)"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] text-xs text-white font-mono focus:outline-none focus:border-[#F59E0B]"
                      required
                    />
                    <p className="text-[11px] text-slate-400 mt-1">
                      Note: Android uses different ports for pairing and main connection.
                    </p>
                  </div>

                  <div className="pt-2 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setManualStep('pair')}
                      className="text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                    >
                      ← Back to Pairing
                    </button>

                    <button
                      type="submit"
                      disabled={manualLoading}
                      className="px-5 py-2.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-black transition-colors flex items-center gap-2 cursor-pointer shadow"
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
              <div className="flex items-center justify-between pb-2 border-b border-[#1E2638]">
                <div>
                  <h4 className="text-xs font-bold text-white">Discovered Wireless Devices</h4>
                  <p className="text-[11px] text-slate-400">
                    Devices broadcasting active ADB TLS services on the local network.
                  </p>
                </div>
                <button
                  onClick={fetchDiscovered}
                  disabled={loadingDiscovered}
                  className="p-1.5 px-3 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-slate-300 text-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${loadingDiscovered ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
              </div>

              {loadingDiscovered ? (
                <div className="p-10 text-center text-xs text-slate-400 flex flex-col items-center justify-center gap-2">
                  <Loader2 className="w-6 h-6 text-[#F59E0B] animate-spin" />
                  <span>Scanning local network for ADB TLS services via mDNS...</span>
                </div>
              ) : discoveredDevices.length > 0 ? (
                <div className="space-y-3 max-h-72 overflow-y-auto">
                  {discoveredDevices.map((dev, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] hover:border-amber-500/40 flex items-center justify-between gap-3 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-lg bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                          <Wifi className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="text-xs font-bold text-white font-mono">{dev.address}</div>
                          <div className="text-[11px] text-slate-400 truncate max-w-[260px] sm:max-w-md">{dev.serviceName}</div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleConnectDiscovered(dev)}
                        disabled={connectingSerial === dev.address}
                        className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-black transition-colors flex items-center gap-1.5 cursor-pointer shadow"
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
                <div className="p-10 rounded-xl border border-dashed border-[#1E2638] text-center space-y-2 bg-[#0A0D14]/50">
                  <Radio className="w-8 h-8 text-slate-600 mx-auto" />
                  <div className="text-xs font-semibold text-slate-300">No Wireless Devices Discovered</div>
                  <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
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
