import React, { useState } from 'react';
import ScreenMirrorView from '../components/ScreenMirrorView';
import IosAgentSection from '../components/IosAgentSection';
import {
  Smartphone,
  Tv,
  Wifi,
  Camera,
  Activity,
  Zap,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Sparkles,
  Info
} from 'lucide-react';
import { formatDeviceDisplayName, formatDeviceOsVersion, formatDeviceSelectorLabel } from '../utils/deviceFormatter';
import DeviceThumbnail from '../components/DeviceThumbnail';

export default function ScreenMirrorPage({
  devices = [],
  selectedDevice,
  onSelectDevice,
  onOpenPairModal
}) {
  const currentDevice = selectedDevice || devices[0] || null;

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#10131B] border border-[#1C2230] p-5 rounded-2xl shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#16130C] border border-[#F59E0B]/40 flex items-center justify-center text-[#F59E0B]">
            <Tv className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#FFFFFF] flex items-center gap-2">
              Low-Latency Screen Mirror
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                H.264 Hardware Stream
              </span>
            </h2>
            <p className="text-xs text-[#94A3B8]">
              Live Android & iOS screen display & instantaneous defect screenshot capture
            </p>
          </div>
        </div>

        {/* Device Selection Dropdown */}
        {devices.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] hidden sm:inline">Active Device:</span>
            <DeviceThumbnail device={currentDevice} size="xs" />
            <select
              value={currentDevice?.serial || ''}
              onChange={(e) => {
                const target = devices.find(d => d.serial === e.target.value);
                if (target && onSelectDevice) onSelectDevice(target);
              }}
              className="px-3 py-2 bg-[#080B10] border border-[#1C2230] rounded-xl text-xs font-semibold text-[#FFFFFF] focus:outline-none focus:border-[#F59E0B] cursor-pointer"
            >
              {devices.map((d) => (
                <option key={d.serial} value={d.serial} className="bg-[#10131B]">
                  {formatDeviceSelectorLabel(d)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {currentDevice ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Main Mirror Viewport */}
          <div className="lg:col-span-8 flex justify-center">
            <ScreenMirrorView device={currentDevice} />
          </div>

          {/* Side Telemetry & Instructions Panel */}
          <div className="lg:col-span-4 space-y-4">
            {/* Device Profile Card */}
            <div className="p-5 rounded-2xl bg-[#10131B] border border-[#1C2230] space-y-4 shadow-sm">
              <div className="flex items-center gap-3.5">
                <DeviceThumbnail device={currentDevice} size="xl" className="shadow-md shrink-0" />
                <div className="min-w-0 space-y-1">
                  <h4 className="font-bold text-sm text-[#FFFFFF] flex flex-wrap items-center gap-2">
                    <span className="truncate">{formatDeviceDisplayName(currentDevice)}</span>
                    {currentDevice.platform === 'ios' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30 shrink-0">
                        iOS
                      </span>
                    )}
                  </h4>
                  <p className="text-xs text-[#64748B] font-mono truncate">{currentDevice.serial}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-[#1C2230] text-xs">
                <div>
                  <span className="text-[#64748B] text-[10px] block">
                    {currentDevice.platform === 'ios' ? 'iOS Version' : 'Android Version'}
                  </span>
                  <span className="font-semibold text-[#CBD5E1] font-mono">
                    {formatDeviceOsVersion(currentDevice) || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="text-[#64748B] text-[10px] block">Battery</span>
                  <span className="font-semibold text-[#CBD5E1] font-mono">{currentDevice.battery || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[#64748B] text-[10px] block">Screen Native</span>
                  <span className="font-semibold text-[#CBD5E1] font-mono">{currentDevice.screenResolution || 'N/A'}</span>
                </div>
                <div>
                  <span className="text-[#64748B] text-[10px] block">Connection</span>
                  <span className="font-semibold text-emerald-400 font-mono">
                    {currentDevice.platform === 'ios' 
                      ? 'Apple USB' 
                      : currentDevice.connectionMode === 'browser-usb' 
                      ? 'Browser USB' 
                      : currentDevice.isWireless 
                      ? 'Wireless Debug' 
                      : 'Server USB'}
                  </span>
                </div>
              </div>
            </div>

            {/* QA Debugging Tips Card */}
            <div className="p-5 rounded-2xl bg-[#10131B] border border-[#1C2230] space-y-3 text-xs shadow-sm">
              <h4 className="font-bold text-xs text-[#FFFFFF] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#F59E0B]" />
                QA Defect Reporting Tips
              </h4>

              <ul className="space-y-2 text-[11px] text-[#94A3B8] leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-1.5 shrink-0"></span>
                  <span><strong>Touch & Swipe:</strong> Click directly on the phone screen to tap, or click and drag to swipe through UI elements.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-1.5 shrink-0"></span>
                  <span><strong>Instant Screenshots:</strong> Click <em>Screenshot</em> anytime to capture pixel-perfect PNG evidence with Copy Image for bug reports.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-1.5 shrink-0"></span>
                  <span><strong>Screen Recording:</strong> Click <em>Start Recording</em> to record device screen interactions in real-time, then preview and download the video file.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B] mt-1.5 shrink-0"></span>
                  <span><strong>Cross-Platform Isolation:</strong> iOS and Android mirroring operate safely without cross-platform command leakage.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-12 rounded-2xl bg-[#10131B] border border-[#1C2230] text-center flex flex-col items-center justify-center gap-4 shadow-sm">
          <div className="w-16 h-16 rounded-2xl bg-[#16130C] border border-[#F59E0B]/40 flex items-center justify-center text-[#F59E0B]">
            <Tv className="w-8 h-8" />
          </div>
          <div className="max-w-md">
            <h3 className="text-base font-bold text-[#FFFFFF]">No Device Connected</h3>
            <p className="text-xs text-[#94A3B8] mt-1">
              Connect an Android device via USB/Wi-Fi or plug in an iPhone via USB to begin low-latency screen mirroring.
            </p>
          </div>
          {onOpenPairModal && (
            <button
              onClick={onOpenPairModal}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] font-bold text-xs text-[#000000] shadow-md shadow-[#F59E0B]/20 transition-colors cursor-pointer"
            >
              <Wifi className="w-4 h-4" />
              <span>Connect Device Now</span>
            </button>
          )}
        </div>
      )}

      {/* iOS Device Agent Download & SOP Section */}
      <IosAgentSection onOpenPairModal={onOpenPairModal} />
    </div>
  );
}
