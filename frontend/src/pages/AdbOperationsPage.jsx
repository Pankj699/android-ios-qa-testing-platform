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
import { formatDeviceDisplayName, formatDeviceOsVersion, formatDeviceSelectorLabel } from '../utils/deviceFormatter';
import DeviceThumbnail from '../components/DeviceThumbnail';

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
      <div className="pb-4 border-b border-[#1C2230]">
        <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
          <Terminal className="w-5 h-5 text-[#F59E0B]" />
          Controlled ADB Device Operations
        </h2>
        <p className="text-xs text-[#94A3B8] mt-1">
          Execute controlled, server-validated Android Debug Bridge maintenance operations on connected devices.
        </p>
      </div>

      {/* Target Device Bar */}
      <div className="p-4 rounded-xl bg-[#10131B] border border-[#1C2230] shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <DeviceThumbnail device={effectiveSelectedDevice} size="header" className="shadow-xs shrink-0" />
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-[#94A3B8] font-semibold block">Target Device</span>
            <select
              value={effectiveSelectedDevice?.serial || ''}
              onChange={(e) => {
                const found = androidDevices.find(d => d.serial === e.target.value);
                if (found) setSelectedDevice(found);
              }}
              className="px-3 py-1.5 rounded-lg bg-[#080B10] border border-[#1C2230] text-xs text-white focus:outline-none focus:border-[#F59E0B] font-mono cursor-pointer"
            >
              {androidDevices.length === 0 && <option value="" className="bg-[#10131B]">No Android devices connected</option>}
              {androidDevices.map(d => (
                <option key={d.serial} value={d.serial} className="bg-[#10131B]">
                  {formatDeviceSelectorLabel(d)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {effectiveSelectedDevice && (
          <div className="flex items-center gap-4 text-xs font-mono text-[#94A3B8]">
            <div>Battery: <span className="text-white">{effectiveSelectedDevice.battery || 'N/A'}</span></div>
            <div>Storage: <span className="text-white">{effectiveSelectedDevice.storageFree || 'N/A'}</span></div>
            <div>OS: <span className="text-white">{formatDeviceOsVersion(effectiveSelectedDevice) || 'Android'}</span></div>
          </div>
        )}
      </div>

      {/* Predefined Package Actions Card */}
      <div className="p-5 rounded-xl bg-[#10131B] border border-[#1C2230] shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#F59E0B]" />
          <h3 className="text-xs font-semibold text-slate-200 uppercase tracking-wide">
            App Maintenance Actions
          </h3>
        </div>

        <div>
          <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-1">
            Target Application Package Name
          </label>
          <input
            type="text"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            placeholder="e.g. com.example.app or com.company.game"
            className="w-full px-3 py-2 rounded-lg bg-[#080B10] border border-[#1C2230] text-xs text-white font-mono placeholder-[#64748B] focus:outline-none focus:border-[#F59E0B]"
          />
        </div>

        {/* Action Buttons Grid: Relaunch | Clear App Data | Clear Cache | Uninstall App */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <button
            onClick={() => handleAction('launch')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3 rounded-lg bg-[#16130C] hover:bg-[#1F190E] border border-[#F59E0B]/60 text-xs text-[#F59E0B] transition-all flex flex-col items-center gap-2 disabled:opacity-50 shadow-sm cursor-pointer"
            title="Relaunch application from fresh state"
          >
            <Play className="w-5 h-5 text-[#F59E0B] fill-[#F59E0B]/20" />
            <span className="font-bold text-[#F59E0B]">Relaunch</span>
            <span className="text-[10px] text-[#94A3B8] font-mono">monkey launcher</span>
          </button>

          <button
            onClick={() => handleAction('clear-data')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3 rounded-lg bg-[#080B10] hover:bg-[#10131B] hover:border-amber-500/40 border border-[#1C2230] text-xs text-slate-200 hover:text-white transition-all flex flex-col items-center gap-2 disabled:opacity-50 cursor-pointer"
            title="Wipe application user and runtime data"
          >
            <Eraser className="w-5 h-5 text-[#F59E0B]" />
            <span className="font-semibold">Clear App Data</span>
            <span className="text-[10px] text-[#64748B] font-mono">pm clear</span>
          </button>

          <button
            onClick={() => handleAction('clear-cache')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3 rounded-lg bg-[#080B10] hover:bg-[#10131B] hover:border-cyan-500/40 border border-[#1C2230] text-xs text-slate-200 hover:text-white transition-all flex flex-col items-center gap-2 disabled:opacity-50 cursor-pointer"
            title="Clear application cache without clearing persistent data"
          >
            <Sparkles className="w-5 h-5 text-cyan-400" />
            <span className="font-semibold">Clear Cache</span>
            <span className="text-[10px] text-[#64748B] font-mono">trim caches</span>
          </button>

          <button
            onClick={() => handleAction('uninstall')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3 rounded-lg bg-[#080B10] hover:bg-[#10131B] hover:border-rose-500/40 border border-[#1C2230] text-xs text-slate-200 hover:text-white transition-all flex flex-col items-center gap-2 disabled:opacity-50 cursor-pointer"
            title="Uninstall application from device"
          >
            <Trash2 className="w-5 h-5 text-rose-400" />
            <span className="font-semibold">Uninstall App</span>
            <span className="text-[10px] text-[#64748B] font-mono">adb uninstall</span>
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
