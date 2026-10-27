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
import { formatDeviceSelectorLabel } from '../utils/deviceFormatter';
import DeviceThumbnail from './DeviceThumbnail';

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl rounded-2xl glass border border-[var(--line)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-[var(--line)]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[var(--violet)] to-[var(--pink)] flex items-center justify-center text-white shadow-md shadow-[var(--violet)]/20">
              <Usb className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--ink)] flex items-center gap-2">
                WebUSB Device Diagnostics & Stage Inspector
              </h3>
              <p className="text-xs text-[var(--muted)]">
                End-to-end telemetry for USB device discovery, kernel interface claim, and ADB handshake.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--card)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5 overflow-y-auto">
          {/* Main Status Banners */}
          {diag.status === 'host_adb_conflict' && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-500 shrink-0 mt-0.5">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-amber-700 dark:text-amber-300">
                    Host ADB Device Contention Detected
                  </h4>
                  <p className="text-xs text-amber-800 dark:text-amber-200 font-medium leading-relaxed">
                    This device is currently connected to the host ADB service. Disconnect the device from host ADB before connecting it through Browser USB.
                  </p>
                  <div className="text-[11px] text-[var(--muted)] pt-1 space-y-1">
                    <p>The host server's local ADB process has exclusive access to this physical USB interface.</p>
                    <p className="font-semibold text-[var(--ink)]">To connect this device via Browser USB:</p>
                    <ul className="list-disc list-inside space-y-0.5 pl-1">
                      <li>On your Android device: Go to <strong>Settings → Developer Options</strong>, toggle <strong>"USB Debugging" OFF and back ON</strong>.</li>
                      <li>Or disconnect the USB cable from the host server and plug it directly into your client computer.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          )}

          {diag.status === 'insecure_context' && (
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-500 shrink-0 mt-0.5">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-amber-700 dark:text-amber-300">
                    Secure Connection (HTTPS) Required
                  </h4>
                  <p className="text-xs text-amber-800 dark:text-amber-200 leading-relaxed">
                    WebUSB is supported by your browser ({diag.browser}), but the WebUSB API is strictly restricted to <strong>Secure Contexts</strong>.
                  </p>
                  <p className="text-[11px] text-[var(--muted)] pt-1">
                    When accessing the QA platform via a LAN IP address (<code className="font-mono bg-[var(--card)] px-1 py-0.5 rounded border border-[var(--line)] text-amber-600 dark:text-amber-400">{diag.currentOrigin}</code>), HTTPS is required to access USB devices.
                  </p>
                </div>
              </div>

              {/* Action: Switch to HTTPS */}
              <div className="p-3 rounded-xl glass border border-[var(--line)] flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-semibold truncate">
                  {diag.httpsOrigin}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={handleCopyHttpsUrl}
                    className="btn-soft px-2.5 py-1.5 rounded-xl text-xs flex items-center gap-1 cursor-pointer"
                    title="Copy HTTPS URL"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    onClick={handleSwitchToHttps}
                    className="btn-magic px-3 py-1.5 rounded-xl text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in HTTPS</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {diag.status === 'unsupported_browser' && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
              <div className="p-2 rounded-lg bg-rose-500/20 text-rose-500 shrink-0 mt-0.5">
                <XCircle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h4 className="text-xs font-bold text-rose-700 dark:text-rose-300">
                  Browser Not Supported for WebUSB
                </h4>
                <p className="text-xs text-rose-800 dark:text-rose-200 leading-relaxed">
                  WebUSB is not supported in {diag.browser}. Please open this QA Platform in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.
                </p>
              </div>
            </div>
          )}

          {/* Tab Navigation */}
          <div className="flex items-center gap-2 border-b border-[var(--line)] pb-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('stages')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'stages'
                  ? 'btn-magic text-white shadow-xs'
                  : 'btn-soft text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Activity className="w-3.5 h-3.5" />
              <span>Connection Stages</span>
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'logs'
                  ? 'btn-magic text-white shadow-xs'
                  : 'btn-soft text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>Diagnostic Logs ({diag.stageLogs?.length || 0})</span>
            </button>
            <button
              onClick={() => setActiveTab('paired')}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer ${
                activeTab === 'paired'
                  ? 'btn-magic text-white shadow-xs'
                  : 'btn-soft text-[var(--muted)] hover:text-[var(--ink)]'
              }`}
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Paired Devices ({diag.pairedDevices?.length || 0})</span>
            </button>
          </div>

          {/* TAB 1: Connection Stages Breakdown */}
          {activeTab === 'stages' && (
            <div className="rounded-xl border border-[var(--line)] glass divide-y divide-[var(--line)] text-xs overflow-hidden">
              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">1. WebUSB API</div>
                  <div className="text-[11px] text-[var(--muted)]">{diag.browser} environment</div>
                </div>
                {getStatusBadge(stages.webusbApi?.status || (diag.hasWebUsbApi ? 'PASSED' : 'FAILED'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">2. Secure Context</div>
                  <div className="text-[11px] text-[var(--muted)] font-mono">{diag.currentOrigin}</div>
                </div>
                {getStatusBadge(stages.secureContext?.status || (diag.isSecureContext ? 'PASSED' : 'FAILED'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">3. Device Permission</div>
                  <div className="text-[11px] text-[var(--muted)]">{stages.devicePermission?.details || diag.devicePermission}</div>
                </div>
                {getStatusBadge(stages.devicePermission?.status || (diag.pairedDevices?.length > 0 ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">4. Device Selection & Picker</div>
                  <div className="text-[11px] text-[var(--muted)]">{stages.deviceSelected?.details || 'Standard ADB Filter (Class: 255, Subclass: 66, Protocol: 1)'}</div>
                </div>
                {getStatusBadge(stages.deviceSelected?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">5. USB Device Open</div>
                  <div className="text-[11px] text-[var(--muted)]">{stages.deviceOpen?.details || 'Chromium USB Device Handle'}</div>
                </div>
                {getStatusBadge(stages.deviceOpen?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">6. ADB Interface Discovery</div>
                  <div className="text-[11px] text-[var(--muted)]">{stages.interfaceDiscovery?.details || 'Interface 0 / 1 detection'}</div>
                </div>
                {getStatusBadge(stages.interfaceDiscovery?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">7. USB Interface Claim</div>
                  <div className="text-[11px] text-[var(--muted)]">{stages.interfaceClaim?.details || 'Exclusive kernel interface ownership'}</div>
                </div>
                {getStatusBadge(stages.interfaceClaim?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">8. ADB Handshake (CNXN)</div>
                  <div className="text-[11px] text-[var(--muted)]">{stages.adbHandshake?.details || 'Protocol handshake & stream setup'}</div>
                </div>
                {getStatusBadge(stages.adbHandshake?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">9. RSA Authentication</div>
                  <div className="text-[11px] text-[var(--muted)]">{stages.adbAuth?.details || 'Phone screen "Allow USB debugging" verification'}</div>
                </div>
                {getStatusBadge(stages.adbAuth?.status || (diag.connectedDevice ? 'PASSED' : 'PENDING'))}
              </div>

              <div className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-[var(--ink)]">10. Transport Active & Ready</div>
                  <div className="text-[11px] text-[var(--muted)] font-mono flex items-center gap-1.5">
                    {diag.connectedDevice && <DeviceThumbnail device={diag.connectedDevice} size="xs" />}
                    <span>{diag.connectedDevice ? formatDeviceSelectorLabel(diag.connectedDevice) : 'No active transport'}</span>
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
                <span className="text-xs text-[var(--muted)]">Live Stage Execution Transcript</span>
                <button
                  onClick={handleCopyLogs}
                  disabled={!diag.stageLogs || diag.stageLogs.length === 0}
                  className="btn-soft px-2.5 py-1 rounded-xl disabled:opacity-40 text-xs flex items-center gap-1 cursor-pointer"
                >
                  {copiedLogs ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedLogs ? 'Copied' : 'Copy Logs'}</span>
                </button>
              </div>
              <div className="bg-slate-950 border border-[var(--line)] rounded-xl p-4 font-mono text-[11px] text-slate-200 min-h-[220px] max-h-[300px] overflow-y-auto space-y-1 shadow-inner">
                {diag.stageLogs && diag.stageLogs.length > 0 ? (
                  diag.stageLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className={
                        log.includes('FAILED') || log.includes('ERROR')
                          ? 'text-rose-400 font-semibold'
                          : log.includes('PASSED')
                          ? 'text-emerald-400 font-semibold'
                          : log.includes('RUNNING')
                          ? 'text-amber-400 font-semibold'
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
              <span className="text-xs text-[var(--muted)]">Previously Paired WebUSB Devices in Chrome</span>
              {diag.pairedDevices && diag.pairedDevices.length > 0 ? (
                <div className="space-y-2">
                  {diag.pairedDevices.map((dev, idx) => (
                    <div key={idx} className="p-3 rounded-xl glass border border-[var(--line)] flex items-center justify-between text-xs font-mono">
                      <div>
                        <div className="font-bold text-[var(--ink)] font-sans">{dev.productName}</div>
                        <div className="text-[11px] text-[var(--muted)]">{dev.manufacturerName} • Serial: {dev.serialNumber}</div>
                      </div>
                      <div className="text-right text-[11px] text-[var(--muted)]">
                        <div>VID: <span className="text-emerald-500 font-semibold">{dev.vendorId}</span> PID: <span className="text-emerald-500 font-semibold">{dev.productId}</span></div>
                        <div>Status: {dev.opened ? <span className="text-emerald-500 font-semibold">Opened</span> : <span className="text-[var(--muted)]">Closed</span>}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 rounded-xl border border-dashed border-[var(--line)] text-center text-xs text-[var(--muted)] glass">
                  No WebUSB devices currently paired with this origin.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between p-4 border-t border-[var(--line)]">
          <button
            onClick={refreshDiagnostics}
            disabled={loading}
            className="btn-soft px-3 py-2 rounded-xl text-xs flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Recheck</span>
          </button>

          <div className="flex items-center gap-2">
            {diag.status === 'insecure_context' && (
              <button
                onClick={handleSwitchToHttps}
                className="btn-magic px-4 py-2 rounded-xl text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
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
                className="btn-magic px-4 py-2 rounded-xl text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <Usb className="w-3.5 h-3.5" />
                <span>Connect Android Device</span>
              </button>
            )}

            <button
              onClick={onClose}
              className="btn-soft px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
