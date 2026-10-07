import React from 'react';
import { DownloadCloud, Sparkles, Loader2, CheckCircle2, Clock } from 'lucide-react';

export default function ProgressBar({ progress = 0, assetPackName = 'onDemand', currentStepId, isRunning }) {
  const boundedProgress = Math.min(Math.max(progress, 0), 100);

  const getStatusDescription = () => {
    if (!isRunning && boundedProgress === 0) {
      return 'Asset pack download progress will track in real-time when the test runs.';
    }
    if (boundedProgress === 100) {
      return '✓ Asset pack download and extraction completed successfully on device.';
    }
    if (currentStepId === 'monitor_logs') {
      return `Downloading and extracting asset pack on device: ${boundedProgress}%`;
    }
    if (currentStepId === 'generate_apks') {
      return 'Building APKs with embedded local asset delivery server...';
    }
    if (currentStepId === 'install_app') {
      return 'Deploying APKs and asset pack mock files onto Android device...';
    }
    if (currentStepId === 'launch_app') {
      return 'Launching application to trigger asset pack download...';
    }
    return 'Waiting for app installation and launch on device...';
  };

  return (
    <div className="bg-[#131924] border border-[#1E2638] rounded-xl p-4 space-y-2.5">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <DownloadCloud className="w-4 h-4 text-[#F59E0B]" />
          <span className="font-semibold text-white">Play Asset Delivery (PAD) Progress</span>
          <span className="font-mono text-[#F59E0B] text-[11px] px-1.5 py-0.5 rounded bg-[#261D10] border border-[#78350F]">
            {assetPackName || 'Asset Pack'}
          </span>
        </div>
        <div className="font-mono font-bold text-[#F59E0B] text-sm">
          {boundedProgress}%
        </div>
      </div>

      {/* Progress Bar Container */}
      <div className="w-full bg-[#0A0D14] rounded-full h-3 p-0.5 border border-[#1E2638] overflow-hidden">
        <div
          className="bg-gradient-to-r from-amber-500 via-[#F59E0B] to-emerald-400 h-full rounded-full transition-all duration-300 relative overflow-hidden"
          style={{ width: `${boundedProgress}%` }}
        >
          {boundedProgress > 0 && boundedProgress < 100 && (
            <div className="absolute inset-0 bg-white/20 animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/30 to-transparent"></div>
          )}
        </div>
      </div>

      {/* Contextual Status & Legend */}
      <div className="space-y-1">
        <p className="text-[11px] text-slate-300 flex items-center gap-1.5">
          {isRunning && boundedProgress < 100 ? (
            <Loader2 className="w-3 h-3 text-[#F59E0B] animate-spin shrink-0" />
          ) : boundedProgress === 100 ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
          ) : (
            <Clock className="w-3 h-3 text-slate-400 shrink-0" />
          )}
          <span className="truncate">{getStatusDescription()}</span>
        </p>

        <div className="flex justify-between items-center text-[10px] text-slate-400 pt-0.5 font-mono">
          <span>0% (Queued)</span>
          <span>50% (Transferring)</span>
          <span>100% (Extracted)</span>
        </div>
      </div>
    </div>
  );
}
