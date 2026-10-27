import React from 'react';
import { Smartphone, Wifi, RefreshCw, AlertCircle, PlusCircle, Usb, Laptop } from 'lucide-react';
import DeviceCard from '../components/DeviceCard';

export default function DevicesPage({
  devices,
  selectedDevice,
  currentUser,
  onSelectDevice,
  onMirrorDevice,
  onOpenPairModal,
  onOpenAgentPairModal,
  onConnectBrowserUsb,
  onOpenUsbDiagnostics,
  onRefreshDevices,
  onDisconnectDevice,
  onClearData,
  onUninstallApp,
  onLaunchApp,
  loading
}) {
  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Smartphone className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1f2544] dark:text-white tracking-tight font-sans">
              Connected Test <span className="text-heading-gradient">Devices</span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6b7194] dark:text-[#94A3B8] mt-1">
              Connect physical Android devices (USB/Wi-Fi) or pair your QA Device Agent for physical iOS USB streaming.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={onRefreshDevices}
            disabled={loading}
            className="h-9 w-9 p-0 inline-flex items-center justify-center rounded-xl btn-soft shrink-0 cursor-pointer shadow-xs"
            title="Refresh Devices List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {onOpenAgentPairModal && (
            <button
              onClick={onOpenAgentPairModal}
              className="h-9 px-3.5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-xs font-bold text-white shadow-md shadow-blue-900/30 transition-all border border-blue-400/30 shrink-0 cursor-pointer whitespace-nowrap"
              title="Pair QA Device Agent to connect physical iPhones/iPads over USB"
            >
              <Laptop className="w-4 h-4 text-blue-200" />
              <span>Pair Agent (iOS USB)</span>
            </button>
          )}

          {onConnectBrowserUsb && (
            <button
              onClick={onConnectBrowserUsb}
              className="h-9 px-3.5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-xs font-bold text-white shadow-md shadow-purple-900/30 transition-all border border-purple-400/30 shrink-0 cursor-pointer whitespace-nowrap"
              title="Connect physical Android device directly to this browser via USB cable"
            >
              <Usb className="w-4 h-4 text-purple-200" />
              <span>Connect Device (USB)</span>
            </button>
          )}

          <button
            onClick={onOpenPairModal}
            className="h-9 px-3.5 inline-flex items-center gap-2 rounded-xl btn-magic text-white text-xs font-bold shadow-magic transition-all shrink-0 cursor-pointer whitespace-nowrap"
            title="Pair and connect physical Android device wirelessly over Wi-Fi"
          >
            <Wifi className="w-4 h-4 text-white" />
            <span>Pair New Device (Wi-Fi)</span>
          </button>
        </div>
      </div>

      {/* Network Reachability & Wireless Debugging Note */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-5 rounded-2xl glass text-xs text-[#1f2544] dark:text-[#CBD5E1] space-y-1.5 shadow-glass">
          <div className="flex items-center justify-between">
            <span className="font-bold text-[#7c6cf6] dark:text-purple-400 flex items-center gap-1.5">
              <Usb className="w-3.5 h-3.5" /> Browser USB Direct Connection:
            </span>
            {onOpenUsbDiagnostics && (
              <button
                onClick={onOpenUsbDiagnostics}
                className="text-[11px] text-[#7c6cf6] dark:text-purple-400 hover:underline font-mono cursor-pointer"
              >
                Diagnostics
              </button>
            )}
          </div>
          <p className="text-[#6b7194] dark:text-[#94A3B8] leading-relaxed">
            Plug your Android phone/tablet into this PC using a USB cable. Enable <span className="font-mono text-[#1f2544] bg-white dark:text-[#FFFFFF] dark:bg-[#080B10] px-1 py-0.5 rounded border border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">USB Debugging</span> in Developer Options. Tap <strong className="text-[#1f2544] dark:text-white font-medium">"Connect Device (USB)"</strong> above, select your device, and allow USB debugging on your device screen.
          </p>
        </div>

        <div className="p-5 rounded-2xl glass text-xs text-[#1f2544] dark:text-[#CBD5E1] space-y-1.5 shadow-glass">
          <span className="font-bold text-amber-600 dark:text-[#F59E0B] flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5" /> Wireless Debugging (Wi-Fi):
          </span>
          <p className="text-[#6b7194] dark:text-[#94A3B8] leading-relaxed">
            On Android 11+: Go to <span className="font-mono text-[#1f2544] bg-white dark:text-[#FFFFFF] dark:bg-[#080B10] px-1 py-0.5 rounded border border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">Settings → Developer Options → Wireless Debugging</span>. 
            Tap <span className="font-mono text-[#1f2544] bg-white dark:text-[#FFFFFF] dark:bg-[#080B10] px-1 py-0.5 rounded border border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">"Pair device with pairing code"</span> to get the 6-digit code and pairing port.
          </p>
        </div>
      </div>

      {/* Device Cards Grid */}
      {(() => {
        const connectedDevices = (devices || []).filter(
          (d) => d && (d.connected ?? true) && (d.platform === 'ios' || !d.state || d.state === 'device') && !d.serial?.includes('_adb-tls-') && !d.serial?.includes('._tcp')
        );

        return connectedDevices.length > 0 ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {connectedDevices.map((device) => (
              <DeviceCard
                key={device.serial}
                device={device}
                isSelected={selectedDevice?.serial === device.serial}
                onSelect={onSelectDevice}
                onMirror={onMirrorDevice}
                onDisconnect={onDisconnectDevice}
                onRefresh={onRefreshDevices}
                onClearData={onClearData}
                onUninstall={onUninstallApp}
                onLaunchApp={onLaunchApp}
              />
            ))}
          </div>
        ) : (
          <div className="p-12 rounded-2xl border-2 border-dashed border-slate-300 dark:border-[#1C2230] text-center space-y-3 bg-white/60 dark:bg-[#10131B]/40 shadow-xs">
            <Smartphone className="w-10 h-10 text-slate-400 dark:text-[#64748B] mx-auto opacity-50" />
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-[#FFFFFF]">No Devices Connected</h3>
              <p className="text-xs text-slate-500 dark:text-[#94A3B8] max-w-sm mx-auto mt-1">
                Connect an Android device via USB/Wi-Fi or plug in an iOS device (iPhone/iPad) with trust enabled.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {onOpenAgentPairModal && (
                <button
                  onClick={onOpenAgentPairModal}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-xs font-bold text-white shadow transition-all inline-flex items-center gap-2 border border-blue-400/30 cursor-pointer"
                >
                  <Laptop className="w-4 h-4 text-blue-200" />
                  <span>Pair Agent (iOS USB)</span>
                </button>
              )}
              {onConnectBrowserUsb && (
                <button
                  onClick={onConnectBrowserUsb}
                  className="px-4 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-xs font-bold text-white shadow transition-all inline-flex items-center gap-2 border border-purple-400/30 cursor-pointer"
                >
                  <Usb className="w-4 h-4 text-purple-200" />
                  <span>Connect Device (USB)</span>
                </button>
              )}
              <button
                onClick={onOpenPairModal}
                className="px-4 py-2 rounded-lg btn-primary-gradient text-white text-xs font-bold shadow transition-all inline-flex items-center gap-2 cursor-pointer"
              >
                <Wifi className="w-4 h-4 text-white" />
                <span>Pair Android Device (Wi-Fi)</span>
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
