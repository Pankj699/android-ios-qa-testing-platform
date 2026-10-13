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
    <div className={`p-5 rounded-xl border transition-all ${
      isSelected 
        ? 'bg-[#10131B] border-[#F59E0B] shadow-lg shadow-[#F59E0B]/10' 
        : 'bg-[#10131B] border-[#1C2230] hover:border-[#2C3549]'
    }`}>
      {/* Header with status badge */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3.5 min-w-0">
          <DeviceThumbnail device={device} size="xl" className="shadow-md shrink-0" />
          <div className="min-w-0 space-y-1">
            <h3 className="font-bold text-[#FFFFFF] text-sm flex flex-wrap items-center gap-2">
              <span className="truncate">{formatDeviceDisplayName(device)}</span>
              {isAgentUsb && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 shrink-0">
                  <Usb className="w-2.5 h-2.5" /> Agent USB
                </span>
              )}
              {isBrowserUsb && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 shrink-0">
                  <Usb className="w-2.5 h-2.5" /> Browser USB
                </span>
              )}
              {isBrowserWireless && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 shrink-0">
                  <Wifi className="w-2.5 h-2.5" /> Wireless (Wi-Fi)
                </span>
              )}
              {device.platform === 'ios' && (
                <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 shrink-0">
                  iOS
                </span>
              )}
            </h3>
            <p className="text-xs text-[#94A3B8] font-mono truncate">{device.serial}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {device.connected ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              Connected
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              {device.state || 'Offline'}
            </span>
          )}

          {isSelected && (
            <span className="px-2.5 py-0.5 rounded text-[11px] font-bold bg-[#F59E0B] text-[#000000] shadow-sm">
              Active
            </span>
          )}
        </div>
      </div>

      {/* Device Specs Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#1C2230]">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">{device.platform === 'ios' ? 'iOS' : 'Android OS'}</span>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">{formatDeviceOsVersion(device) || 'N/A'}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
            <Battery className="w-3 h-3 text-emerald-400" />
            <span>Battery</span>
          </div>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">
            {device.battery || 'N/A'} {device.batteryStatus ? `(${device.batteryStatus})` : ''}
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
            <HardDrive className="w-3 h-3 text-[#F59E0B]" />
            <span>Storage</span>
          </div>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">{device.storageFree || 'N/A'}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8]">
            <Monitor className="w-3 h-3 text-purple-400" />
            <span>Screen</span>
          </div>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">{device.screenResolution || 'N/A'}</p>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-5 pt-3 border-t border-[#1C2230]">
        <div className="flex items-center gap-2">
          {!isSelected && onSelect && (
            <button
              onClick={() => onSelect(device)}
              className="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 bg-[#F59E0B] hover:bg-[#D97706] text-[#000000] shadow cursor-pointer"
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
              className="px-3 py-1.5 rounded-lg bg-[#16130C] hover:bg-[#241A0E] disabled:opacity-50 border border-[#F59E0B]/40 text-xs font-semibold text-[#F59E0B] hover:text-[#FBBF24] transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Open Low-Latency Screen Mirror"
            >
              <Tv className="w-3.5 h-3.5 text-[#F59E0B]" />
              <span>Screen Mirror</span>
            </button>
          )}

          {onRefresh && (
            <button
              onClick={() => onRefresh(device.serial)}
              disabled={loadingAction}
              className="p-1.5 rounded-lg bg-[#080B10] hover:bg-[#121620] text-[#CBD5E1] hover:text-[#FFFFFF] transition-colors border border-[#1C2230] cursor-pointer"
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
              className="px-2.5 py-1.5 rounded-lg bg-[#080B10] hover:bg-[#121620] text-xs text-[#CBD5E1] hover:text-[#FFFFFF] transition-colors flex items-center gap-1 border border-[#1C2230] cursor-pointer"
              title="Clear App Data"
            >
              <Eraser className="w-3 h-3 text-[#F59E0B]" />
              <span className="hidden sm:inline">Clear Data</span>
            </button>
          )}

          {device.platform !== 'ios' && onLaunchApp && (
            <button
              onClick={() => onLaunchApp(device.serial)}
              className="px-2.5 py-1.5 rounded-lg bg-[#080B10] hover:bg-[#121620] text-xs text-[#CBD5E1] hover:text-[#FFFFFF] transition-colors flex items-center gap-1 border border-[#1C2230] cursor-pointer"
              title="Launch App"
            >
              <Play className="w-3 h-3 text-emerald-400" />
              <span className="hidden sm:inline">Launch</span>
            </button>
          )}

          {onDisconnect && (
            <button
              onClick={() => onDisconnect(device.serial)}
              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 transition-colors cursor-pointer"
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
