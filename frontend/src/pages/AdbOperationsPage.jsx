import React, { useState } from 'react';
import {
  Terminal,
  Smartphone,
  Eraser,
  Trash2,
  Play,
  RotateCcw,
  Sparkles,
  HardDrive,
  Battery,
  AlertCircle,
  CheckCircle2,
  Loader2,
  ShieldCheck
} from 'lucide-react';
import SafeAdbConsole from '../components/SafeAdbConsole';
import { api } from '../services/api';
import { webUsbAdbService } from '../services/webUsbAdbService';
import { getDeviceTransport } from '../services/transports/deviceTransportFactory';

export default function AdbOperationsPage({
  devices = [],
  selectedDevice,
  setSelectedDevice,
  onOpenPairModal,
  onConnectBrowserUsb
}) {
  const [packageName, setPackageName] = useState('');
  const [loadingAction, setLoadingAction] = useState(false);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [actionError, setActionError] = useState(null);

  const androidDevices = (devices || []).filter(
    (d) => d && (d.platform || 'android') === 'android' && d.platform !== 'ios'
  );

  const effectiveSelectedDevice = (() => {
    if (selectedDevice && (selectedDevice.platform || 'android') === 'android' && selectedDevice.platform !== 'ios') {
      return selectedDevice;
    }
    return androidDevices[0] || null;
  })();

  const handleAction = async (actionType) => {
    if (!effectiveSelectedDevice || effectiveSelectedDevice.platform === 'ios') {
      setActionError('Please select or connect an Android device first. ADB operations are not supported on iOS.');
      return;
    }
    const targetPkg = (packageName || '').trim();
    if (!targetPkg && actionType !== 'clear-logcat') {
      setActionError('Please specify an Android package name (e.g. com.example.app).');
      return;
    }

    setLoadingAction(true);
    setActionSuccess(null);
    setActionError(null);

    try {
      const transport = getDeviceTransport(effectiveSelectedDevice);
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

      setActionSuccess(res?.message || 'Operation executed successfully.');
    } catch (err) {
      setActionError(err.message || 'Operation failed.');
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Terminal className="w-5 h-5 text-[#F59E0B]" />
          Controlled ADB Device Operations
        </h2>
        <p className="text-xs text-slate-400">
          Execute controlled, server-validated Android Debug Bridge maintenance operations on connected devices.
        </p>
      </div>

      {/* Target Device Bar */}
      <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Smartphone className="w-4 h-4 text-[#F59E0B]" />
          <span className="text-xs text-slate-300 font-medium">Target Device:</span>
          <select
            value={effectiveSelectedDevice?.serial || ''}
            onChange={(e) => {
              const found = androidDevices.find(d => d.serial === e.target.value);
              if (found) setSelectedDevice(found);
            }}
            className="px-3 py-1.5 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-white focus:outline-none focus:border-[#F59E0B] font-mono"
          >
            {androidDevices.length === 0 && <option value="">No Android devices connected</option>}
            {androidDevices.map(d => (
              <option key={d.serial} value={d.serial}>
                {d.name || d.model} ({d.serial})
              </option>
            ))}
          </select>
        </div>

        {effectiveSelectedDevice && (
          <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
            <div>Battery: <span className="text-white">{effectiveSelectedDevice.battery || 'N/A'}</span></div>
            <div>Storage: <span className="text-white">{effectiveSelectedDevice.storageFree || 'N/A'}</span></div>
            <div>OS: <span className="text-white">{effectiveSelectedDevice.androidVersion || 'Android'}</span></div>
          </div>
        )}
      </div>

      {/* Predefined Package Actions Card */}
      <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#F59E0B]" />
          <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
            App Maintenance Actions
          </h3>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-300 mb-1">
            Target Application Package Name
          </label>
          <input
            type="text"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            placeholder="e.g. com.example.app or com.company.game"
            className="w-full px-3 py-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
          />
        </div>

        {/* Action Buttons Grid: Relaunch | Clear App Data | Clear Cache | Uninstall App */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <button
            onClick={() => handleAction('launch')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3 rounded-lg bg-[#0A0D14] hover:bg-emerald-500/10 hover:border-emerald-500/40 border border-[#1E2638] text-xs text-slate-200 hover:text-emerald-300 transition-all flex flex-col items-center gap-2 disabled:opacity-50"
            title="Relaunch application from fresh state"
          >
            <Play className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold">Relaunch</span>
            <span className="text-[10px] text-slate-400 font-mono">monkey launcher</span>
          </button>

          <button
            onClick={() => handleAction('clear-data')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3 rounded-lg bg-[#0A0D14] hover:bg-[#261D10] hover:border-[#78350F] border border-[#1E2638] text-xs text-slate-200 hover:text-[#F59E0B] transition-all flex flex-col items-center gap-2 disabled:opacity-50"
            title="Wipe application user and runtime data"
          >
            <Eraser className="w-5 h-5 text-[#F59E0B]" />
            <span className="font-semibold">Clear App Data</span>
            <span className="text-[10px] text-slate-400 font-mono">pm clear</span>
          </button>

          <button
            onClick={() => handleAction('clear-cache')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3 rounded-lg bg-[#0A0D14] hover:bg-cyan-500/10 hover:border-cyan-500/40 border border-[#1E2638] text-xs text-slate-200 hover:text-cyan-300 transition-all flex flex-col items-center gap-2 disabled:opacity-50"
            title="Clear application cache without clearing persistent data"
          >
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <span className="font-semibold">Clear Cache</span>
            <span className="text-[10px] text-slate-400 font-mono">trim caches</span>
          </button>

          <button
            onClick={() => handleAction('uninstall')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3 rounded-lg bg-[#0A0D14] hover:bg-rose-500/10 hover:border-rose-500/40 border border-[#1E2638] text-xs text-slate-200 hover:text-rose-300 transition-all flex flex-col items-center gap-2 disabled:opacity-50"
            title="Uninstall application from device"
          >
            <Trash2 className="w-5 h-5 text-rose-400" />
            <span className="font-semibold">Uninstall App</span>
            <span className="text-[10px] text-slate-400 font-mono">adb uninstall</span>
          </button>
        </div>

        {/* Feedback Messages */}
        {actionSuccess && (
          <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {actionError && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}
      </div>

      {/* Safe Allowlisted ADB Console */}
      <SafeAdbConsole activeSerial={selectedDevice?.serial} device={selectedDevice} />
    </div>
  );
}
