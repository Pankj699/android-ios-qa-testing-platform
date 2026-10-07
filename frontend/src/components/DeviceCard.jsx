import React from 'react';
import { Smartphone, Battery, HardDrive, Monitor, RefreshCw, Trash2, Play, Eraser, Unlink, CheckCircle2, AlertCircle, Lock, Unlock, Tv, Usb, Wifi } from 'lucide-react';

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
  onClaim,
  onRelease,
  loadingAction
}) {
  if (!device) return null;

  const isAgentUsb = device.connectionMode === 'agent-usb' || !!device.agentId;
  const isBrowserUsb = device.connectionMode === 'browser-usb' || device.serial?.startsWith('browser_usb_');
  const isBrowserWireless = device.connectionMode === 'browser-wireless';
  const isPrivateDevice = isAgentUsb || isBrowserUsb || isBrowserWireless;
  const isClaimed = !isPrivateDevice && (device.isClaimed ?? device.lock?.isLocked);
  const isClaimedByMe = !isPrivateDevice && (device.isClaimedByMe ?? device.lock?.isLockedByMe);
  const claimedBy = !isPrivateDevice ? (device.claimedBy ?? device.lock?.lockedBy) : null;
  const isLockedByOther = !isPrivateDevice && isClaimed && !isClaimedByMe;

  return (
    <div className={`p-5 rounded-xl border transition-all ${
      isSelected 
        ? 'bg-[#131924] border-[#F59E0B] shadow-md shadow-[#F59E0B]/10' 
        : 'bg-[#131924] border-[#1E2638] hover:border-[#334155]'
    }`}>
      {/* Header with status badge */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-lg border ${
            isAgentUsb
              ? 'bg-blue-950/40 border-blue-500/40 text-blue-400'
              : isBrowserUsb
              ? 'bg-purple-950/40 border-purple-500/40 text-purple-400'
              : isBrowserWireless
              ? 'bg-cyan-950/40 border-cyan-500/40 text-cyan-400'
              : 'bg-[#261D10] border-[#78350F] text-[#F59E0B]'
          }`}>
            {isAgentUsb || isBrowserUsb ? (
              <Usb className="w-5 h-5" />
            ) : isBrowserWireless ? (
              <Wifi className="w-5 h-5" />
            ) : (
              <Smartphone className="w-5 h-5" />
            )}
          </div>
          <div>
            <h3 className="font-bold text-[#FFFFFF] text-sm flex items-center gap-2">
              {device.name || device.model || (device.platform === 'ios' ? 'iPhone' : 'Android Device')}
              {isAgentUsb && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                  <Usb className="w-2.5 h-2.5" /> Agent USB
                </span>
              )}
              {isBrowserUsb && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  <Usb className="w-2.5 h-2.5" /> Browser USB
                </span>
              )}
              {isBrowserWireless && (
                <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  <Wifi className="w-2.5 h-2.5" /> Wireless (Wi-Fi)
                </span>
              )}
              {device.platform === 'ios' && (
                <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  iOS
                </span>
              )}
              {isClaimedByMe && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-[#F59E0B] border border-amber-500/20">
                  <Lock className="w-2.5 h-2.5" /> Claimed by You
                </span>
              )}
              {isLockedByOther && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
                  <Lock className="w-2.5 h-2.5" /> Claimed by {claimedBy}
                </span>
              )}
            </h3>
            <p className="text-xs text-[#94A3B8] font-mono">{device.serial}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
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
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#F59E0B] text-[#000000]">
              Active
            </span>
          )}
        </div>
      </div>

      {/* Device Specs Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#1E2638]">
        <div className="space-y-1">
          <span className="text-[11px] text-[#94A3B8]">{device.platform === 'ios' ? 'iOS' : 'Android OS'}</span>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">{device.osVersion || device.androidVersion || device.iosVersion || 'N/A'}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] text-[#94A3B8]">
            <Battery className="w-3 h-3 text-emerald-400" />
            <span>Battery</span>
          </div>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">
            {device.battery || 'N/A'} {device.batteryStatus ? `(${device.batteryStatus})` : ''}
          </p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] text-[#94A3B8]">
            <HardDrive className="w-3 h-3 text-[#F59E0B]" />
            <span>Storage</span>
          </div>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">{device.storageFree || 'N/A'}</p>
        </div>

        <div className="space-y-1">
          <div className="flex items-center gap-1 text-[11px] text-[#94A3B8]">
            <Monitor className="w-3 h-3 text-purple-400" />
            <span>Screen</span>
          </div>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">{device.screenResolution || 'N/A'}</p>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 mt-5 pt-3 border-t border-[#1E2638]">
        <div className="flex items-center gap-2">
          {!isSelected && onSelect && (
            <button
              onClick={() => onSelect(device)}
              disabled={isLockedByOther}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5 ${
                isLockedByOther 
                  ? 'bg-[#1E2638] text-[#64748B] cursor-not-allowed' 
                  : 'bg-[#F59E0B] hover:bg-[#D97706] text-[#000000] shadow'
              }`}
              title={isLockedByOther ? `Device is currently claimed by ${claimedBy}` : 'Select Device'}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{isLockedByOther ? 'In Use' : 'Select Device'}</span>
            </button>
          )}

          {/* Screen Mirror Button */}
          {onMirror && (
            <button
              onClick={() => onMirror(device)}
              disabled={isLockedByOther}
              className="px-3 py-1.5 rounded-lg bg-[#261D10] hover:bg-[#3D2C15] disabled:opacity-50 border border-[#78350F] text-xs font-semibold text-[#F59E0B] hover:text-[#FBBF24] transition-colors flex items-center gap-1.5 shadow-sm"
              title="Open Low-Latency Screen Mirror"
            >
              <Tv className="w-3.5 h-3.5 text-[#F59E0B]" />
              <span>Screen Mirror</span>
            </button>
          )}

          {/* Claim / Release button (Server ADB devices only) */}
          {!isPrivateDevice && onClaim && onRelease && (
            isClaimedByMe ? (
              <button
                onClick={() => onRelease(device.serial)}
                className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-xs text-[#F59E0B] border border-amber-500/30 transition-colors flex items-center gap-1 font-semibold"
                title="Release Claim"
              >
                <Unlock className="w-3 h-3" />
                <span>Release</span>
              </button>
            ) : !isClaimed && (
              <button
                onClick={() => onClaim(device.serial)}
                className="px-2.5 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs text-[#CBD5E1] hover:text-[#FFFFFF] border border-[#334155] transition-colors flex items-center gap-1"
                title="Claim device for your test session"
              >
                <Lock className="w-3 h-3 text-[#F59E0B]" />
                <span>Claim</span>
              </button>
            )
          )}

          {onRefresh && (
            <button
              onClick={() => onRefresh(device.serial)}
              disabled={loadingAction}
              className="p-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-[#CBD5E1] hover:text-[#FFFFFF] transition-colors border border-[#334155]"
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
              disabled={isLockedByOther}
              className="px-2.5 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] disabled:opacity-50 text-xs text-[#CBD5E1] hover:text-[#FFFFFF] transition-colors flex items-center gap-1 border border-[#334155]"
              title="Clear App Data"
            >
              <Eraser className="w-3 h-3 text-[#F59E0B]" />
              <span className="hidden sm:inline">Clear Data</span>
            </button>
          )}

          {device.platform !== 'ios' && onLaunchApp && (
            <button
              onClick={() => onLaunchApp(device.serial)}
              disabled={isLockedByOther}
              className="px-2.5 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] disabled:opacity-50 text-xs text-[#CBD5E1] hover:text-[#FFFFFF] transition-colors flex items-center gap-1 border border-[#334155]"
              title="Launch App"
            >
              <Play className="w-3 h-3 text-emerald-400" />
              <span className="hidden sm:inline">Launch</span>
            </button>
          )}

          {onDisconnect && (
            <button
              onClick={() => onDisconnect(device.serial)}
              disabled={isLockedByOther}
              className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50 text-rose-400 border border-rose-500/20 transition-colors"
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
