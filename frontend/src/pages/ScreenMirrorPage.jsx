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
import CustomSelect from '../components/ui/select';

export default function ScreenMirrorPage({
  devices = [],
  selectedDevice,
  onSelectDevice,
  onOpenPairModal,
  isActive = true
}) {
  const currentDevice = selectedDevice || devices[0] || null;

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass p-5 rounded-2xl shadow-glass">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Tv className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1f2544] dark:text-white flex items-center gap-2.5 tracking-tight font-sans">
              Screen <span className="text-heading-gradient">Mirror</span>
              <span className="chip-badge text-[10px] py-0.5 px-2 font-mono">
                H.264 Stream
              </span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6b7194] dark:text-[#94A3B8] mt-1">
              Live Android &amp; iOS low-latency screen display and instantaneous defect screenshot capture.
            </p>
          </div>
        </div>

        {/* Device Selection Dropdown */}
        {devices.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="section-label text-[10px] font-bold hidden sm:inline">Active Device:</span>
            <DeviceThumbnail device={currentDevice} size="xs" />
            <CustomSelect
              value={currentDevice?.serial || ''}
              onChange={(val) => {
                const serial = val?.target ? val.target.value : val;
                const target = devices.find(d => d.serial === serial);
                if (target && onSelectDevice) onSelectDevice(target);
              }}
              options={devices.map((d) => ({
                value: d.serial,
                label: formatDeviceSelectorLabel(d)
              }))}
              placeholder="Select device"
              className="h-8 min-w-[180px] max-w-[260px] text-xs font-semibold rounded-xl"
            />
          </div>
        )}
      </div>

      {/* Main Content Area */}
      {currentDevice ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Main Mirror Viewport */}
          <div className="lg:col-span-8 flex justify-center">
            {isActive ? (
              <ScreenMirrorView device={currentDevice} isActive={isActive} />
            ) : null}
          </div>

          {/* Side Telemetry & Instructions Panel */}
          <div className="lg:col-span-4 space-y-4">
            {/* Device Profile Card */}
            <div className="p-5 rounded-2xl glass space-y-4 shadow-glass">
              <div className="flex items-center gap-3.5">
                <DeviceThumbnail device={currentDevice} size="xl" className="shadow-md shrink-0" />
                <div className="min-w-0 space-y-1">
                  <h4 className="font-extrabold text-sm text-[#1f2544] dark:text-[#FFFFFF] flex flex-wrap items-center gap-2">
                    <span className="truncate">{formatDeviceDisplayName(currentDevice)}</span>
                    {currentDevice.platform === 'ios' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/30 shrink-0">
                        iOS
                      </span>
                    )}
                  </h4>
                  <p className="text-xs text-[#6b7194] dark:text-[#64748B] font-mono truncate">{currentDevice.serial}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-[rgba(99,102,241,0.14)] dark:border-[#1C2230] text-xs">
                <div>
                  <span className="section-label text-[9px] font-bold block">
                    {currentDevice.platform === 'ios' ? 'iOS Version' : 'Android Version'}
                  </span>
                  <span className="font-semibold text-[#1f2544] dark:text-[#CBD5E1] font-mono">
                    {formatDeviceOsVersion(currentDevice) || 'N/A'}
                  </span>
                </div>
                <div>
                  <span className="section-label text-[9px] font-bold block">Battery</span>
                  <span className="font-semibold text-[#1f2544] dark:text-[#CBD5E1] font-mono">{currentDevice.battery || 'N/A'}</span>
                </div>
                <div>
                  <span className="section-label text-[9px] font-bold block">Screen Native</span>
                  <span className="font-semibold text-[#1f2544] dark:text-[#CBD5E1] font-mono">{currentDevice.screenResolution || 'N/A'}</span>
                </div>
                <div>
                  <span className="section-label text-[9px] font-bold block">Connection</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400 font-mono">
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
            <div className="p-5 rounded-2xl glass space-y-3 text-xs shadow-glass">
              <h4 className="font-extrabold text-xs text-[#1f2544] dark:text-[#FFFFFF] flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-[#7c6cf6] dark:text-[#F59E0B]" />
                QA Defect Reporting Tips
              </h4>

              <ul className="space-y-2 text-[11px] text-[#6b7194] dark:text-[#94A3B8] leading-relaxed">
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7c6cf6] dark:bg-[#F59E0B] mt-1.5 shrink-0"></span>
                  <span><strong>Touch & Swipe:</strong> Click directly on the phone screen to tap, or click and drag to swipe through UI elements.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7c6cf6] dark:bg-[#F59E0B] mt-1.5 shrink-0"></span>
                  <span><strong>Instant Screenshots:</strong> Click <em>Screenshot</em> anytime to capture pixel-perfect PNG evidence with Copy Image for bug reports.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7c6cf6] dark:bg-[#F59E0B] mt-1.5 shrink-0"></span>
                  <span><strong>Screen Recording:</strong> Click <em>Start Recording</em> to record device screen interactions in real-time, then preview and download the video file.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#7c6cf6] dark:bg-[#F59E0B] mt-1.5 shrink-0"></span>
                  <span><strong>Cross-Platform Isolation:</strong> iOS and Android mirroring operate safely without cross-platform command leakage.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      ) : (
        <div className="p-12 rounded-2xl glass text-center flex flex-col items-center justify-center gap-4 shadow-glass">
          <div className="brand-mark w-16 h-16 rounded-2xl shadow-lg flex items-center justify-center">
            <Tv className="w-8 h-8 text-white" />
          </div>
          <div className="max-w-md">
            <h3 className="text-base font-extrabold text-[#1f2544] dark:text-[#FFFFFF]">No Device Connected</h3>
            <p className="text-xs text-[#6b7194] dark:text-[#94A3B8] mt-1">
              Connect an Android device via USB/Wi-Fi or plug in an iPhone via USB to begin low-latency screen mirroring.
            </p>
          </div>
          {onOpenPairModal && (
            <button
              onClick={onOpenPairModal}
              className="btn-magic px-5 py-2.5 rounded-xl font-bold text-xs shadow-magic cursor-pointer flex items-center gap-2"
            >
              <Wifi className="w-4 h-4 text-white" />
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
