import React from 'react';
import { Smartphone, Wifi, RefreshCw, AlertCircle, PlusCircle, Usb, Laptop } from 'lucide-react';
import DeviceCard from '../components/DeviceCard';

export default function DevicesPage({
  devices,
  selectedDevice,
  onSelectDevice,
  onMirrorDevice,
  onOpenPairModal,
  onOpenAgentPairModal,
  onConnectBrowserUsb,
  onOpenUsbDiagnostics,
  onRefreshDevices,
  onDisconnectDevice,
  onClaimDevice,
  onReleaseDevice,
  onClearData,
  onUninstallApp,
  onLaunchApp,
  loading
}) {
  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#1E2638]">
        <div>
          <h2 className="text-xl font-bold text-[#FFFFFF] flex items-center gap-2.5">
            <Smartphone className="w-5 h-5 text-[#F59E0B]" />
            Connected Test Devices
          </h2>
          <p className="text-xs text-[#94A3B8] mt-1">
            Connect physical Android devices (USB/Wi-Fi) or pair your QA Device Agent for physical iOS USB streaming.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={onRefreshDevices}
            disabled={loading}
            className="p-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-[#CBD5E1] transition-colors border border-[#334155]"
            title="Refresh Devices List"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {onOpenAgentPairModal && (
            <button
              onClick={onOpenAgentPairModal}
              className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-xs font-bold text-white shadow-md shadow-blue-900/30 transition-all flex items-center gap-2 border border-blue-400/30 cursor-pointer"
              title="Pair QA Device Agent to connect physical iPhones/iPads over USB"
            >
              <Laptop className="w-4 h-4 text-blue-200" />
              <span>Pair Agent (iOS USB)</span>
            </button>
          )}

          {onOpenUsbDiagnostics && (
            <button
              onClick={onOpenUsbDiagnostics}
              className="p-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-purple-300 hover:text-purple-200 transition-colors border border-purple-500/30"
              title="Inspect WebUSB & Secure Context Diagnostics"
            >
              <Usb className="w-4 h-4" />
            </button>
          )}

          {onConnectBrowserUsb && (
            <button
              onClick={onConnectBrowserUsb}
              className="px-3.5 py-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-xs font-bold text-white shadow-md shadow-purple-900/30 transition-all flex items-center gap-2 border border-purple-400/30 cursor-pointer"
              title="Connect physical Android device directly to this browser via USB cable"
            >
              <Usb className="w-4 h-4 text-purple-200" />
              <span>Connect Device (USB)</span>
            </button>
          )}

          <button
            onClick={onOpenPairModal}
            className="px-3.5 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-all flex items-center gap-2"
          >
            <Wifi className="w-4 h-4 text-[#000000]" />
            <span>Pair New Device (Wi-Fi)</span>
          </button>
        </div>
      </div>

      {/* Network Reachability & Wireless Debugging Note */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="p-4 rounded-xl bg-[#131924] border border-purple-500/20 text-xs text-[#CBD5E1] space-y-1">
          <div className="flex items-center justify-between">
            <span className="font-bold text-purple-400 flex items-center gap-1.5">
              <Usb className="w-3.5 h-3.5" /> Browser USB Direct Connection:
            </span>
            {onOpenUsbDiagnostics && (
              <button
                onClick={onOpenUsbDiagnostics}
                className="text-[11px] text-purple-400 hover:text-purple-300 underline font-mono"
              >
                Diagnostics
              </button>
            )}
          </div>
          <p className="text-[#94A3B8]">
            Plug your Android phone/tablet into this PC using a USB cable. Enable <span className="font-mono text-[#FFFFFF] bg-[#0A0D14] px-1 py-0.5 rounded border border-[#1E2638]">USB Debugging</span> in Developer Options. Tap <strong className="text-white font-medium">"Connect Device (USB)"</strong> above, select your device, and allow USB debugging on your device screen.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638] text-xs text-[#CBD5E1] space-y-1">
          <span className="font-bold text-[#F59E0B] flex items-center gap-1.5">
            <Wifi className="w-3.5 h-3.5" /> Wireless Debugging (Wi-Fi):
          </span>
          <p className="text-[#94A3B8]">
            On Android 11+: Go to <span className="font-mono text-[#FFFFFF] bg-[#0A0D14] px-1 py-0.5 rounded border border-[#1E2638]">Settings → Developer Options → Wireless Debugging</span>. 
            Tap <span className="font-mono text-[#FFFFFF] bg-[#0A0D14] px-1 py-0.5 rounded border border-[#1E2638]">"Pair device with pairing code"</span> to get the 6-digit code and pairing port.
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
                onClaim={onClaimDevice}
                onRelease={onReleaseDevice}
                onRefresh={onRefreshDevices}
                onClearData={onClearData}
                onUninstall={onUninstallApp}
                onLaunchApp={onLaunchApp}
              />
            ))}
          </div>
        ) : (
          <div className="p-12 rounded-2xl border-2 border-dashed border-[#1E2638] text-center space-y-3 bg-[#131924]/40">
            <Smartphone className="w-10 h-10 text-[#64748B] mx-auto opacity-50" />
            <div>
              <h3 className="text-sm font-semibold text-[#FFFFFF]">No Devices Connected</h3>
              <p className="text-xs text-[#94A3B8] max-w-sm mx-auto mt-1">
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
                className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-all inline-flex items-center gap-2 cursor-pointer"
              >
                <Wifi className="w-4 h-4 text-[#000000]" />
                <span>Pair Android Device (Wi-Fi)</span>
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
