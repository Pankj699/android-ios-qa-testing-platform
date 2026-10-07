import React, { useState, useEffect } from 'react';
import {
  Usb,
  X,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Globe,
  Lock,
  Unlock,
  KeyRound,
  HelpCircle,
  Copy,
  Check,
  Smartphone,
  Terminal,
  Activity,
  ChevronRight,
  Info
} from 'lucide-react';
import { webUsbAdbService } from '../services/webUsbAdbService';

export default function WebUsbDiagnosticsModal({
  isOpen,
  onClose,
  onConnectUsb,
  initialDiagnostics = null
}) {
  const [diagnostics, setDiagnostics] = useState(initialDiagnostics);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const [activeTab, setActiveTab] = useState('stages'); // 'stages' | 'logs' | 'paired'

  const refreshDiagnostics = async () => {
    setLoading(true);
    try {
      const diag = await webUsbAdbService.getDiagnostics();
      setDiagnostics(diag);
    } catch (e) {
      console.error('Failed to get WebUSB diagnostics:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      refreshDiagnostics();
    }
    const unsub = webUsbAdbService.subscribe((event, data) => {
      if (event === 'STAGE_UPDATED' || event === 'CONNECTED' || event === 'DISCONNECTED') {
        webUsbAdbService.getDiagnostics().then((d) => setDiagnostics(d));
      }
    });
    return () => unsub();
  }, [isOpen]);

  if (!isOpen) return null;

  const diag = diagnostics || {
    browser: 'Detecting...',
    webUsbSupported: false,
    isSecureContext: false,
    currentOrigin: typeof window !== 'undefined' ? window.location.origin : '',
    httpsOrigin: typeof window !== 'undefined' ? `https://${window.location.host}` : '',
    devicePermission: 'Unknown',
    pairedDevices: [],
    stages: {},
    stageLogs: [],
    status: 'checking',
    message: ''
  };

  const handleCopyHttpsUrl = () => {
    if (diag.httpsOrigin) {
      navigator.clipboard.writeText(diag.httpsOrigin);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleCopyLogs = () => {
    if (diag.stageLogs && diag.stageLogs.length > 0) {
      navigator.clipboard.writeText(diag.stageLogs.join('\n'));
      setCopiedLogs(true);
      setTimeout(() => setCopiedLogs(false), 2000);
    }
  };

  const handleSwitchToHttps = () => {
    if (diag.httpsOrigin) {
      window.location.href = `${diag.httpsOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`;
    }
  };

  const stages = diag.stages || {};

  const getStatusBadge = (status) => {
    switch (status) {
      case 'PASSED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded">
            <CheckCircle2 className="w-3 h-3" /> Passed
          </span>
        );
      case 'RUNNING':
      case 'PROMPTING':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#F59E0B] bg-[#261D10] border border-[#78350F] px-2 py-0.5 rounded animate-pulse">
            <RefreshCw className="w-3 h-3 animate-spin" /> In Progress
          </span>
        );
      case 'FAILED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded">
            <XCircle className="w-3 h-3" /> Failed
          </span>
        );
      case 'UNAUTHORIZED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded">
            <KeyRound className="w-3 h-3" /> Unauthorized
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400 bg-slate-800 border border-slate-700 px-2 py-0.5 rounded">
            Cancelled
          </span>
        );
      case 'PENDING':
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] text-slate-500 bg-slate-900 border border-slate-800 px-2 py-0.5 rounded font-mono">
            Pending
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-2xl rounded-2xl bg-[#0F141F] border border-[#1E2638] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#1E2638] bg-[#131924]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Usb className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                WebUSB Device Diagnostics & Stage Inspector
              </h3>
              <p className="text-xs text-slate-400">
                End-to-end telemetry for USB device discovery, kernel interface claim, and ADB handshake.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Main Status Banners */}
          {diag.status === 'host_adb_conflict' && (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-amber-200">
                    Host ADB Device Contention Detected
                  </h4>
                  <p className="text-xs text-amber-300 font-medium leading-relaxed">
                    This device is currently connected to the host ADB service. Disconnect the device from host ADB before connecting it through Browser USB.
                  </p>
                  <div className="text-[11px] text-slate-300 pt-1 space-y-1">
                    <p>The host server's local ADB process has exclusive access to this physical USB interface.</p>
                    <p className="font-semibold text-slate-200">To connect this device via Browser USB:</p>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-400 pl-1">
                      <li>On your Android device: Go to <strong>Settings → Developer Options</strong>, toggle <strong>"USB Debugging" OFF and back ON</strong>.</li>
                      <li>Or disconnect the USB cable from the host server and plug it directly into your client computer.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {diag.status === 'insecure_context' && (
            <div className="p-4 rounded-xl bg-amber-950/40 border border-amber-500/40 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-amber-200">
                    Secure Connection (HTTPS) Required
                  </h4>
                  <p className="text-xs text-amber-300/90 leading-relaxed">
                    WebUSB is supported by your browser ({diag.browser}), but the WebUSB API is strictly restricted to <strong>Secure Contexts</strong>.
                  </p>
                  <p className="text-[11px] text-slate-300 pt-1">
                    When accessing the QA platform via a LAN IP address (<code className="font-mono bg-black/40 px-1 py-0.5 rounded text-amber-300">{diag.currentOrigin}</code>), HTTPS is required to access USB devices.
                  </p>
                </div>
              </div>

              {/* Action: Switch to HTTPS */}
              <div className="p-3 rounded-lg bg-[#0A0D14] border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="text-xs font-mono text-emerald-400 truncate">
                  {diag.httpsOrigin}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleCopyHttpsUrl}
                    className="px-2.5 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs text-slate-200 transition-colors flex items-center gap-1 border border-slate-700"
                    title="Copy HTTPS URL"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    onClick={handleSwitchToHttps}
                    className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-all shadow flex items-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in HTTPS</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {diag.status === 'unsupported_browser' && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/40 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 shrink-0 mt-0.5">
                <XCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-rose-200">
                  Browser Not Supported for WebUSB
                </h4>
                <p className="text-xs text-rose-300/90 leading-relaxed">
                  WebUSB is not supported in {diag.browser}. Please open this QA Platform in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex items-center gap-2 border-b border-[#1E2638] pb-2">
            <button
              onClick={() => setActiveTab('stages')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'stages'
                  ? 'bg-purple-600 text-white'
                  : 'bg-[#131924] text-slate-400 hover:text-white border border-[#1E2638]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Connection Stages</span>
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'logs'
                  ? 'bg-purple-600 text-white'
                  : 'bg-[#131924] text-slate-400 hover:text-white border border-[#1E2638]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Diagnostic Logs ({diag.stageLogs?.length || 0})</span>
            </button>
            <button
              onClick={() => setActiveTab('paired')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                activeTab === 'paired'
                  ? 'bg-purple-600 text-white'
                  : 'bg-[#131924] text-slate-400 hover:text-white border border-[#1E2638]'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Paired Devices ({diag.pairedDevices?.length || 0})</span>
            </button>
          </div>

          {/* TAB 1: Connection Stages Breakdown */}
          {activeTab === 'stages' && (
            <div className="rounded-xl border border-[#1E2638] bg-[#131924] divide-y divide-[#1E2638] text-xs">
              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">1. WebUSB API</div>
                  <div className="text-[11px] text-slate-400">{diag.browser} environment</div>
                </div>
                {getStatusBadge(stages.webusbApi?.status || (diag.hasWebUsbApi ? 'PASSED' : 'FAILED'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">2. Secure Context</div>
                  <div className="text-[11px] text-slate-400 font-mono">{diag.currentOrigin}</div>
                </div>
                {getStatusBadge(stages.secureContext?.status || (diag.isSecureContext ? 'PASSED' : 'FAILED'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">3. Device Permission</div>
                  <div className="text-[11px] text-slate-400">{stages.devicePermission?.details || diag.devicePermission}</div>
                </div>
                {getStatusBadge(stages.devicePermission?.status || (diag.pairedDevices?.length > 0 ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">4. Device Selection & Picker</div>
                  <div className="text-[11px] text-slate-400">{stages.deviceSelected?.details || 'Standard ADB Filter (Class: 255, Subclass: 66, Protocol: 1)'}</div>
                </div>
                {getStatusBadge(stages.deviceSelected?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">5. USB Device Open</div>
                  <div className="text-[11px] text-slate-400">{stages.deviceOpen?.details || 'Chromium USB Device Handle'}</div>
                </div>
                {getStatusBadge(stages.deviceOpen?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">6. ADB Interface Discovery</div>
                  <div className="text-[11px] text-slate-400">{stages.interfaceDiscovery?.details || 'Interface 0 / 1 detection'}</div>
                </div>
                {getStatusBadge(stages.interfaceDiscovery?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">7. USB Interface Claim</div>
                  <div className="text-[11px] text-slate-400">{stages.interfaceClaim?.details || 'Exclusive kernel interface ownership'}</div>
                </div>
                {getStatusBadge(stages.interfaceClaim?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">8. ADB Handshake (CNXN)</div>
                  <div className="text-[11px] text-slate-400">{stages.adbHandshake?.details || 'Protocol handshake & stream setup'}</div>
                </div>
                {getStatusBadge(stages.adbHandshake?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">9. RSA Authentication</div>
                  <div className="text-[11px] text-slate-400">{stages.adbAuth?.details || 'Phone screen "Allow USB debugging" verification'}</div>
                </div>
                {getStatusBadge(stages.adbAuth?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">10. Transport Active & Ready</div>
                  <div className="text-[11px] text-slate-400 font-mono">
                    {diag.connectedDevice ? `${diag.connectedDevice.name} (${diag.connectedDevice.serial})` : 'No active transport'}
                  </div>
                </div>
                {getStatusBadge(diag.connectedDevice ? 'PASSED' : 'PENDING')}
              </div>
            </div>
          )}

          {/* TAB 2: Diagnostic Logs */}
          {activeTab === 'logs' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">Live Stage Execution Transcript</span>
                <button
                  onClick={handleCopyLogs}
                  disabled={!diag.stageLogs || diag.stageLogs.length === 0}
                  className="px-2 py-1 rounded bg-[#1E2638] hover:bg-[#263248] disabled:opacity-40 text-xs text-slate-300 flex items-center gap-1 border border-slate-700"
                >
                  {copiedLogs ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedLogs ? 'Copied' : 'Copy Logs'}</span>
                </button>
              </div>
              <div className="bg-[#0A0D14] border border-[#1E2638] rounded-xl p-4 font-mono text-[11px] text-slate-200 min-h-[220px] max-h-[300px] overflow-y-auto space-y-1">
                {diag.stageLogs && diag.stageLogs.length > 0 ? (
                  diag.stageLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className={
                        log.includes('FAILED') || log.includes('ERROR')
                          ? 'text-rose-400'
                          : log.includes('PASSED')
                          ? 'text-emerald-400'
                          : log.includes('RUNNING')
                          ? 'text-[#F59E0B]'
                          : 'text-slate-300'
                      }
                    >
                      {log}
                    </div>
                  ))
                ) : (
                  <span className="text-slate-500 italic">No connection attempts logged yet. Click "Connect Android Device" below to begin.</span>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: Paired Devices */}
          {activeTab === 'paired' && (
            <div className="space-y-3">
              <span className="text-xs text-slate-400">Previously Paired WebUSB Devices in Chrome</span>
              {diag.pairedDevices && diag.pairedDevices.length > 0 ? (
                <div className="space-y-2">
                  {diag.pairedDevices.map((dev, idx) => (
                    <div key={idx} className="p-3 rounded-xl bg-[#131924] border border-[#1E2638] flex items-center justify-between text-xs font-mono">
                      <div>
                        <div className="font-bold text-white font-sans">{dev.productName}</div>
                        <div className="text-[11px] text-slate-400">{dev.manufacturerName} • Serial: {dev.serialNumber}</div>
                      </div>
                      <div className="text-right text-[11px] text-slate-400">
                        <div>VID: <span className="text-emerald-400">{dev.vendorId}</span> PID: <span className="text-emerald-400">{dev.productId}</span></div>
                        <div>Status: {dev.opened ? <span className="text-emerald-400">Opened</span> : <span className="text-slate-500">Closed</span>}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 rounded-xl border border-dashed border-[#1E2638] text-center text-xs text-slate-500 bg-[#0A0D14]/40">
                  No WebUSB devices currently paired with this origin.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-4 border-t border-[#1E2638] bg-[#131924]">
          <button
            onClick={refreshDiagnostics}
            disabled={loading}
            className="px-3 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs text-slate-300 transition-colors flex items-center gap-1.5 border border-slate-700"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recheck</span>
          </button>

          <div className="flex items-center gap-2">
            {diag.status === 'insecure_context' && (
              <button
                onClick={handleSwitchToHttps}
                className="px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-all shadow flex items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open in HTTPS</span>
              </button>
            )}

            {onConnectUsb && (
              <button
                onClick={() => {
                  onClose();
                  onConnectUsb();
                }}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold transition-all shadow flex items-center gap-1.5"
              >
                <Usb className="w-3.5 h-3.5" />
                <span>Connect Android Device</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-slate-300 hover:text-white transition-colors border border-slate-700"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
