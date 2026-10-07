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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-[#131924] border border-[#1E2638] p-5 rounded-2xl">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#261D10] border border-[#78350F] flex items-center justify-center text-[#F59E0B]">
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
            <span className="text-xs text-[#94A3B8] font-medium hidden sm:inline">Active Device:</span>
            <select
              value={currentDevice?.serial || ''}
              onChange={(e) => {
                const target = devices.find(d => d.serial === e.target.value);
                if (target && onSelectDevice) onSelectDevice(target);
              }}
              className="px-3 py-2 bg-[#0D111A] border border-[#1E2638] rounded-xl text-xs font-semibold text-[#FFFFFF] focus:outline-none focus:border-[#F59E0B]"
            >
              {devices.map((d) => {
                const isIos = d.platform === 'ios';
                const osLabel = isIos 
                  ? (d.osVersion || (d.iosVersion ? `iOS ${d.iosVersion}` : 'iOS')) 
                  : (d.androidVersion || 'Android');
                return (
                  <option key={d.serial} value={d.serial}>
                    {d.name || d.model} — {osLabel} ({d.serial})
                  </option>
                );
              })}
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
            <div className="p-5 rounded-2xl bg-[#131924] border border-[#1E2638] space-y-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                  <Smartphone className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="font-bold text-xs text-[#FFFFFF] flex items-center gap-2">
                    {currentDevice.name || currentDevice.model}
                    {currentDevice.platform === 'ios' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30">
                        iOS
                      </span>
                    )}
                  </h4>
                  <p className="text-[11px] text-[#64748B] font-mono">{currentDevice.serial}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-[#1E2638] text-xs">
                <div>
                  <span className="text-[#64748B] text-[10px] block">
                    {currentDevice.platform === 'ios' ? 'iOS Version' : 'Android Version'}
                  </span>
                  <span className="font-semibold text-[#CBD5E1] font-mono">
                    {currentDevice.platform === 'ios'
                      ? (currentDevice.osVersion || (currentDevice.iosVersion ? `iOS ${currentDevice.iosVersion}` : 'iOS'))
                      : (currentDevice.androidVersion || 'Android')}
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
            <div className="p-5 rounded-2xl bg-[#131924] border border-[#1E2638] space-y-3 text-xs">
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
        <div className="p-12 rounded-2xl bg-[#131924] border border-[#1E2638] text-center flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-[#261D10] border border-[#78350F] flex items-center justify-center text-[#F59E0B]">
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
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] font-bold text-xs text-[#000000] shadow transition-colors"
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
