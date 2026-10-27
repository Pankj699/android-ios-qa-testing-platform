import React from 'react';
import { Smartphone, Battery, HardDrive, Monitor, RefreshCw, Trash2, Play, Eraser, Unlink, CheckCircle2, AlertCircle, Lock, Unlock, Tv, Usb, Wifi } from 'lucide-react';
import { formatDeviceDisplayName, formatDeviceOsVersion } from '../utils/deviceFormatter';
import DeviceThumbnail from './DeviceThumbnail';

export default function DeviceCard({
  device,
  isSelected,
  onSelect,
  onMirror,
  onDisconnect,
  onRefresh,
  onClearData,
  onUninstall,
  onLaunchApp,
  loadingAction
}) {
  if (!device) return null;

  const isAgentUsb = device.connectionMode === 'agent-usb' || !!device.agentId;
  const isBrowserUsb = device.connectionMode === 'browser-usb' || device.serial?.startsWith('browser_usb_');
  const isBrowserWireless = device.connectionMode === 'browser-wireless';

  return (
    <div className={`p-5 rounded-2xl glass transition-all ${
      isSelected 
        ? 'border-[#7c6cf6] shadow-magic/25 dark:border-[#F59E0B] dark:shadow-lg dark:shadow-[#F59E0B]/10' 
        : 'border-[rgba(99,102,241,0.14)] hover:border-[#7c6cf6]/30 shadow-glass'
    }`}>
      {/* Header with status badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <DeviceThumbnail device={device} size="xl" className="shadow-md shrink-0" />
          <div className="min-w-0 space-y-1">
            <h3 className="font-extrabold text-[#1f2544] dark:text-[#FFFFFF] text-sm flex flex-wrap items-center gap-2">
              <span className="truncate">{formatDeviceDisplayName(device)}</span>
              {isAgentUsb && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300 border border-blue-500/20 dark:border-blue-500/30 shrink-0">
                  <Usb className="w-2.5 h-2.5" /> Agent USB
                </span>
              )}
              {isBrowserUsb && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 dark:bg-purple-500/20 dark:text-purple-300 border border-purple-500/20 dark:border-purple-500/30 shrink-0">
                  <Usb className="w-2.5 h-2.5" /> Browser USB
                </span>
              )}
              {isBrowserWireless && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 dark:bg-cyan-500/20 dark:text-cyan-300 border border-cyan-500/20 dark:border-cyan-500/30 shrink-0">
                  <Wifi className="w-2.5 h-2.5" /> Wireless (Wi-Fi)
                </span>
              )}
              {device.platform === 'ios' && (
                <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 shrink-0">
                  iOS
                </span>
              )}
            </h3>
            <p className="text-xs text-[#6b7194] dark:text-[#94A3B8] font-mono truncate">{device.serial}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {device.connected ? (
            <span className="status-pill text-xs text-emerald-600">
              <span className="dot ok"></span>
              Connected
            </span>
          ) : (
            <span className="status-pill text-xs text-amber-600">
              <span className="dot warn"></span>
              {device.state || 'Offline'}
            </span>
          )}

          {isSelected && (
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#7c6cf6] text-white dark:bg-[#F59E0B] dark:text-[#000000] shadow-sm">
              Active
            </span>
          )}
        </div>
      </div>

      {/* Device Specs Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">
        <div className="space-y-1">
          <span className="section-label text-[10px] font-bold">{device.platform === 'ios' ? 'iOS' : 'Android OS'}</span>
          <p className="text-xs font-semibold text-[#1f2544] dark:text-[#CBD5E1] font-mono">{formatDeviceOsVersion(device) || 'N/A'}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 section-label text-[10px] font-bold">
            <Battery className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
            <span>Battery</span>
          </div>
          <p className="text-xs font-semibold text-[#1f2544] dark:text-[#CBD5E1] font-mono">
            {device.battery || 'N/A'} {device.batteryStatus ? `(${device.batteryStatus})` : ''}
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 section-label text-[10px] font-bold">
            <HardDrive className="w-3 h-3 text-amber-500 dark:text-[#F59E0B]" />
            <span>Storage</span>
          </div>
          <p className="text-xs font-semibold text-[#1f2544] dark:text-[#CBD5E1] font-mono">{device.storageFree || 'N/A'}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 section-label text-[10px] font-bold">
            <Monitor className="w-3 h-3 text-[#7c6cf6] dark:text-purple-400" />
            <span>Screen</span>
          </div>
          <p className="text-xs font-semibold text-[#1f2544] dark:text-[#CBD5E1] font-mono">{device.screenResolution || 'N/A'}</p>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-5 pt-3 border-t border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">
        <div className="flex items-center gap-2">
          {!isSelected && onSelect && (
            <button
              onClick={() => onSelect(device)}
              className="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 btn-magic text-white shadow-magic cursor-pointer"
              title="Select Device"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Select Device</span>
            </button>
          )}

          {/* Screen Mirror Button */}
          {onMirror && (
            <button
              onClick={() => onMirror(device)}
              className="btn-soft px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-xs cursor-pointer"
              title="Open Low-Latency Screen Mirror"
            >
              <Tv className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B]" />
              <span>Screen Mirror</span>
            </button>
          )}

          {onRefresh && (
            <button
              onClick={() => onRefresh(device.serial)}
              disabled={loadingAction}
              className="btn-soft p-1.5 rounded-xl cursor-pointer shadow-xs"
              title="Refresh Device Info"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingAction ? 'animate-spin' : ''}`} />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {device.platform !== 'ios' && onClearData && (
            <button
              onClick={() => onClearData(device.serial)}
              className="btn-soft px-2.5 py-1.5 rounded-xl text-xs flex items-center gap-1 cursor-pointer shadow-xs"
              title="Clear App Data"
            >
              <Eraser className="w-3 h-3 text-amber-500 dark:text-[#F59E0B]" />
              <span className="hidden sm:inline">Clear Data</span>
            </button>
          )}

          {device.platform !== 'ios' && onLaunchApp && (
            <button
              onClick={() => onLaunchApp(device.serial)}
              className="btn-soft px-2.5 py-1.5 rounded-xl text-xs flex items-center gap-1 cursor-pointer shadow-xs"
              title="Launch App"
            >
              <Play className="w-3 h-3 text-emerald-500 dark:text-emerald-400" />
              <span className="hidden sm:inline">Launch</span>
            </button>
          )}

          {onDisconnect && (
            <button
              onClick={() => onDisconnect(device.serial)}
              className="p-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 dark:text-rose-400 border border-rose-500/20 transition-colors cursor-pointer"
              title="Disconnect Device"
            >
              <Unlink className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
