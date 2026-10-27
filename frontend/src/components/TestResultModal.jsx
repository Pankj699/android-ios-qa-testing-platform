import React, { useState } from 'react';
import { CheckCircle2, XCircle, Clock, Smartphone, Package, Download, X, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../services/api';
import { formatDeviceDisplayName, formatDeviceOsVersion } from '../utils/deviceFormatter';
import DeviceThumbnail from './DeviceThumbnail';
import BuildThumbnail from './BuildThumbnail';

export default function TestResultModal({ test, isOpen, onClose, onRunAgain }) {
  const [showTechnical, setShowTechnical] = useState(false);

  if (!isOpen || !test) return null;

  const isPass = test.result === 'PASS';

  const handleDownloadLog = () => {
    window.open(`/api/test/${test.id}/download-logs`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-lg glass border border-[var(--line)] rounded-card shadow-2xl overflow-hidden">
        {/* Header Banner */}
        <div className={`p-6 text-center border-b border-[var(--line)] ${
          isPass 
            ? 'bg-emerald-500/10' 
            : 'bg-rose-500/10'
        }`}>
          <div className="flex justify-end">
            <button onClick={onClose} className="text-[#6B7194] hover:text-[#1F2544] dark:hover:text-white p-1 rounded-lg cursor-pointer transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex justify-center mb-3">
            {isPass ? (
              <div className="w-16 h-16 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <CheckCircle2 className="w-10 h-10 stroke-[2.5]" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-2xl bg-rose-500 text-white flex items-center justify-center shadow-lg shadow-rose-500/30">
                <XCircle className="w-10 h-10 stroke-[2.5]" />
              </div>
            )}
          </div>

          <h2 className="text-xl font-extrabold text-[#1F2544] dark:text-white font-sans">
            TEST RESULT: <span className={isPass ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{test.result || 'COMPLETED'}</span>
          </h2>
          <p className="text-xs text-[#6B7194] dark:text-slate-300 mt-1">
            {isPass
              ? 'Play Asset Delivery local testing successfully loaded all required asset packs.'
              : test.failureReason || 'Test execution encountered an error.'}
          </p>
        </div>

        {/* Details List */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl bg-white/60 dark:bg-[#0A0D14] border border-[var(--line)] dark:border-[#1E2638] space-y-1 shadow-xs">
              <div className="flex items-center gap-1.5 text-[#6B7194]">
                <Smartphone className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B]" />
                <span className="font-bold">Target Device</span>
              </div>
              <p className="font-semibold text-[#1F2544] dark:text-white flex items-center gap-1.5">
                <DeviceThumbnail device={{ name: test.deviceName, serial: test.deviceSerial, osVersion: test.androidVersion || test.osVersion, platform: test.platform }} size="xs" />
                <span>{formatDeviceDisplayName({ name: test.deviceName, serial: test.deviceSerial, osVersion: test.androidVersion || test.osVersion, platform: test.platform })}</span>
              </p>
              <p className="text-[11px] text-[#6B7194] dark:text-slate-400 font-mono">
                {formatDeviceOsVersion({ name: test.deviceName, serial: test.deviceSerial, osVersion: test.androidVersion || test.osVersion, platform: test.platform }) || test.androidVersion || 'Android'}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-white/60 dark:bg-[#0A0D14] border border-[var(--line)] dark:border-[#1E2638] space-y-1 shadow-xs">
              <div className="flex items-center gap-1.5 text-[#6B7194]">
                <Package className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B]" />
                <span className="font-bold">Build / Package</span>
              </div>
              <p className="font-semibold text-[#1F2544] dark:text-white truncate flex items-center gap-1.5" title={test.fileName || test.packageName}>
                <BuildThumbnail
                  iconUrl={test.iconUrl}
                  packageName={test.packageName}
                  applicationName={test.applicationName}
                  size="xs"
                />
                <span className="truncate">{test.fileName || test.packageName || 'App'}</span>
              </p>
              <p className="text-[11px] text-[#6B7194] dark:text-slate-400 font-mono truncate">
                {test.packageName} ({test.version || '1.0'})
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-white/60 dark:bg-[#0A0D14] border border-[var(--line)] dark:border-[#1E2638] space-y-1 shadow-xs">
              <div className="flex items-center gap-1.5 text-[#6B7194]">
                <Clock className="w-3.5 h-3.5 text-[#7c6cf6]" />
                <span className="font-bold">Test Duration</span>
              </div>
              <p className="font-semibold text-[#1F2544] dark:text-white">{test.duration || '0s'}</p>
              <p className="text-[11px] text-[#6B7194] dark:text-slate-400 font-mono">{test.installMode || 'Fresh Install'}</p>
            </div>

            <div className="p-3.5 rounded-xl bg-white/60 dark:bg-[#0A0D14] border border-[var(--line)] dark:border-[#1E2638] space-y-1 shadow-xs">
              <span className="text-[#6B7194] font-bold block">Completed At</span>
              <p className="font-semibold text-[#1F2544] dark:text-white">
                {test.completedAt ? new Date(test.completedAt).toLocaleTimeString() : 'Just now'}
              </p>
              <p className="text-[11px] text-[#6B7194] dark:text-slate-400 font-mono">ID: {test.id?.substring(0, 8)}...</p>
            </div>
          </div>

          {/* Technical Details Expandable */}
          {test.technicalDetails && (
            <div className="border border-[var(--line)] rounded-xl overflow-hidden shadow-xs">
              <button
                onClick={() => setShowTechnical(!showTechnical)}
                className="w-full px-3.5 py-2.5 bg-white/60 dark:bg-[#0A0D14] text-xs font-bold text-[#1F2544] dark:text-slate-300 flex items-center justify-between cursor-pointer"
              >
                <span>Technical Details & Stack Trace</span>
                {showTechnical ? <ChevronUp className="w-3.5 h-3.5 text-[#6B7194]" /> : <ChevronDown className="w-3.5 h-3.5 text-[#6B7194]" />}
              </button>
              {showTechnical && (
                <pre className="p-3.5 bg-slate-900 text-[11px] font-mono text-rose-300 max-h-36 overflow-y-auto whitespace-pre-wrap border-t border-[var(--line)]">
                  {test.technicalDetails}
                </pre>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleDownloadLog}
              className="px-4 py-2 rounded-btn btn-soft text-xs font-bold text-[#1F2544] dark:text-white flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Logs</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-btn btn-soft text-xs font-bold text-[#6B7194] hover:text-[#1F2544] dark:text-slate-300 transition-colors cursor-pointer"
              >
                Close
              </button>
              {onRunAgain && (
                <button
                  onClick={() => { onClose(); onRunAgain(); }}
                  className="btn-magic px-4 py-2 rounded-btn text-xs font-bold text-white shadow-magic transition-all cursor-pointer"
                >
                  Run Again
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
