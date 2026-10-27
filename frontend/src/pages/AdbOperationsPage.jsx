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
import CustomSelect from '../components/ui/select';
import { toast } from '../utils/toast';

export default function AdbOperationsPage({
  devices = [],
  selectedDevice,
  setSelectedDevice,
  onOpenPairModal,
  onConnectBrowserUsb
}) {
  const [packageName, setPackageName] = useState('');
  const [loadingAction, setLoadingAction] = useState(false);

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
      toast.error('Please select or connect an Android device first. ADB operations are not supported on iOS.');
      return;
    }
    const targetPkg = (packageName || '').trim();
    if (!targetPkg && actionType !== 'clear-logcat') {
      toast.error('Please specify an Android package name (e.g. com.example.app).');
      return;
    }

    setLoadingAction(true);

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

      toast.success(res?.message || 'Operation executed successfully.');
    } catch (err) {
      toast.error(err.message || 'Operation failed.');
    } finally {
      setLoadingAction(false);
    }
  };

  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[var(--line)]">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Terminal className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1F2544] dark:text-white tracking-tight flex items-center gap-2.5 font-sans">
              ADB <span className="text-heading-gradient">Operations</span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6B7194] dark:text-[#94A3B8] mt-1">
              Execute controlled, server-validated Android Debug Bridge maintenance operations on connected devices.
            </p>
          </div>
        </div>
      </div>

      {/* Target Device Bar */}
      <div className="p-4 rounded-card glass border border-[var(--line)] shadow-glass flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <DeviceThumbnail device={effectiveSelectedDevice} size="header" className="shadow-xs shrink-0" />
          <div className="space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-[#6B7194] dark:text-[#94A3B8] font-bold block">Target Device</span>
            <CustomSelect
              value={effectiveSelectedDevice?.serial || ''}
              onChange={(val) => {
                const serial = val?.target ? val.target.value : val;
                const found = androidDevices.find(d => d.serial === serial);
                if (found) setSelectedDevice(found);
              }}
              disabled={androidDevices.length === 0}
              placeholder="No Android devices connected"
              options={androidDevices.map((d) => ({
                value: d.serial,
                label: formatDeviceSelectorLabel(d)
              }))}
              className="h-9 min-w-[220px] max-w-[320px] text-xs font-mono rounded-xl"
              title="Target Device"
            />
          </div>
        </div>

        {effectiveSelectedDevice && (
          <div className="flex items-center gap-4 text-xs font-mono text-[#6B7194] dark:text-[#94A3B8]">
            <div className="px-2.5 py-1 rounded-full chip-badge">Battery: <span className="font-bold text-[#1F2544] dark:text-white">{effectiveSelectedDevice.battery || 'N/A'}</span></div>
            <div className="px-2.5 py-1 rounded-full chip-badge">Storage: <span className="font-bold text-[#1F2544] dark:text-white">{effectiveSelectedDevice.storageFree || 'N/A'}</span></div>
            <div className="px-2.5 py-1 rounded-full chip-badge">OS: <span className="font-bold text-[#1F2544] dark:text-white">{formatDeviceOsVersion(effectiveSelectedDevice) || 'Android'}</span></div>
          </div>
        )}
      </div>

      {/* Predefined Package Actions Card */}
      <div className="p-5 lg:p-6 rounded-card glass border border-[var(--line)] shadow-glass space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#7c6cf6] dark:text-[#F59E0B]" />
          <h3 className="text-xs font-extrabold text-[#1F2544] dark:text-slate-200 uppercase tracking-wide">
            App Maintenance Actions
          </h3>
        </div>

        <div>
          <label className="block text-[11px] font-bold uppercase tracking-wider text-[#6B7194] dark:text-[#94A3B8] mb-1.5">
            Target Application Package Name
          </label>
          <input
            type="text"
            value={packageName}
            onChange={(e) => setPackageName(e.target.value)}
            placeholder="e.g. com.example.app or com.company.game"
            className="w-full px-3.5 py-2.5 rounded-xl bg-white/70 border border-[var(--line)] text-xs text-[#1F2544] font-mono placeholder-[#6B7194] dark:bg-[#080B10] dark:border-[#1C2230] dark:text-white focus:outline-none focus:border-[#7c6cf6] focus:ring-2 focus:ring-[#7c6cf6]/20 shadow-xs"
          />
        </div>

        {/* Action Buttons Grid: Relaunch | Clear App Data | Clear Cache | Uninstall App */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
          <button
            onClick={() => handleAction('launch')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3.5 rounded-xl bg-white/70 hover:bg-white border border-[var(--line)] hover:border-[#7c6cf6]/40 text-xs text-[#1F2544] dark:bg-[#16130C] dark:hover:bg-[#1F190E] dark:border-[#F59E0B]/60 dark:text-[#F59E0B] transition-all flex flex-col items-center gap-1.5 disabled:opacity-50 shadow-xs cursor-pointer group"
            title="Relaunch application from fresh state"
          >
            <Play className="w-5 h-5 text-[#7c6cf6] fill-[#7c6cf6]/20 dark:text-[#F59E0B] dark:fill-[#F59E0B]/20 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-[#7c6cf6] dark:text-[#F59E0B]">Relaunch</span>
            <span className="text-[10px] text-[#6B7194] dark:text-[#94A3B8] font-mono">monkey launcher</span>
          </button>

          <button
            onClick={() => handleAction('clear-data')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3.5 rounded-xl bg-white/70 hover:bg-white border border-[var(--line)] hover:border-[#fb923c]/40 text-xs text-[#1F2544] dark:bg-[#080B10] dark:hover:bg-[#10131B] dark:hover:border-amber-500/40 dark:border-[#1C2230] dark:text-slate-200 dark:hover:text-white transition-all flex flex-col items-center gap-1.5 disabled:opacity-50 shadow-xs cursor-pointer group"
            title="Wipe application user and runtime data"
          >
            <Eraser className="w-5 h-5 text-amber-500 dark:text-[#F59E0B] group-hover:scale-110 transition-transform" />
            <span className="font-bold text-[#1F2544] dark:text-white">Clear App Data</span>
            <span className="text-[10px] text-[#6B7194] font-mono">pm clear</span>
          </button>

          <button
            onClick={() => handleAction('clear-cache')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3.5 rounded-xl bg-white/70 hover:bg-white border border-[var(--line)] hover:border-cyan-400/40 text-xs text-[#1F2544] dark:bg-[#080B10] dark:hover:bg-[#10131B] dark:hover:border-cyan-500/40 dark:border-[#1C2230] dark:text-slate-200 dark:hover:text-white transition-all flex flex-col items-center gap-1.5 disabled:opacity-50 shadow-xs cursor-pointer group"
            title="Clear application cache without clearing persistent data"
          >
            <Sparkles className="w-5 h-5 text-cyan-600 dark:text-cyan-400 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-[#1F2544] dark:text-white">Clear Cache</span>
            <span className="text-[10px] text-[#6B7194] font-mono">trim caches</span>
          </button>

          <button
            onClick={() => handleAction('uninstall')}
            disabled={loadingAction || !effectiveSelectedDevice}
            className="p-3.5 rounded-xl bg-white/70 hover:bg-white border border-[var(--line)] hover:border-rose-400/40 text-xs text-[#1F2544] dark:bg-[#080B10] dark:hover:bg-[#10131B] dark:hover:border-rose-500/40 dark:border-[#1C2230] dark:text-slate-200 dark:hover:text-white transition-all flex flex-col items-center gap-1.5 disabled:opacity-50 shadow-xs cursor-pointer group"
            title="Uninstall application from device"
          >
            <Trash2 className="w-5 h-5 text-rose-500 dark:text-rose-400 group-hover:scale-110 transition-transform" />
            <span className="font-bold text-[#1F2544] dark:text-white">Uninstall App</span>
            <span className="text-[10px] text-[#6B7194] font-mono">adb uninstall</span>
          </button>
        </div>
      </div>

      {/* Safe Allowlisted ADB Console */}
      <SafeAdbConsole activeSerial={selectedDevice?.serial} device={selectedDevice} />
    </div>
  );
}
