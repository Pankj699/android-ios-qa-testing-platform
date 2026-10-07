import React, { useState } from 'react';
import { CheckCircle2, XCircle, Clock, Smartphone, Package, Download, X, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../services/api';

export default function TestResultModal({ test, isOpen, onClose, onRunAgain }) {
  const [showTechnical, setShowTechnical] = useState(false);

  if (!isOpen || !test) return null;

  const isPass = test.result === 'PASS';

  const handleDownloadLog = () => {
    window.open(`/api/test/${test.id}/download-logs`, '_blank');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-[#131924] border border-[#1E2638] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header Banner */}
        <div className={`p-6 text-center border-b ${
          isPass 
            ? 'bg-emerald-500/10 border-emerald-500/20' 
            : 'bg-rose-500/10 border-rose-500/20'
        }`}>
          <div className="flex justify-end">
            <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex justify-center mb-3">
            {isPass ? (
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-emerald-400 shadow-lg shadow-emerald-500/20">
                <CheckCircle2 className="w-10 h-10" />
              </div>
            ) : (
              <div className="w-16 h-16 rounded-full bg-rose-500/20 border-2 border-rose-400 flex items-center justify-center text-rose-400 shadow-lg shadow-rose-500/20">
                <XCircle className="w-10 h-10" />
              </div>
            )}
          </div>

          <h2 className="text-xl font-bold text-white">
            TEST RESULT: <span className={isPass ? 'text-emerald-400' : 'text-rose-400'}>{test.result || 'COMPLETED'}</span>
          </h2>
          <p className="text-xs text-slate-300 mt-1">
            {isPass
              ? 'Play Asset Delivery local testing successfully loaded all required asset packs.'
              : test.failureReason || 'Test execution encountered an error.'}
          </p>
        </div>

        {/* Details List */}
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-[#0A0D14] border border-[#1E2638] space-y-1">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Smartphone className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>Target Device</span>
              </div>
              <p className="font-semibold text-white">{test.deviceName || test.deviceSerial}</p>
              <p className="text-[11px] text-slate-400">{test.androidVersion}</p>
            </div>

            <div className="p-3 rounded-lg bg-[#0A0D14] border border-[#1E2638] space-y-1">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Package className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>Build / Package</span>
              </div>
              <p className="font-semibold text-white truncate" title={test.fileName || test.packageName}>
                {test.fileName || test.packageName || 'App'}
              </p>
              <p className="text-[11px] text-slate-400 font-mono truncate">
                {test.packageName} ({test.version || '1.0'})
              </p>
            </div>

            <div className="p-3 rounded-lg bg-[#0A0D14] border border-[#1E2638] space-y-1">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Clock className="w-3.5 h-3.5 text-purple-400" />
                <span>Test Duration</span>
              </div>
              <p className="font-semibold text-white">{test.duration || '0s'}</p>
              <p className="text-[11px] text-slate-400">{test.installMode || 'Fresh Install'}</p>
            </div>

            <div className="p-3 rounded-lg bg-[#0A0D14] border border-[#1E2638] space-y-1">
              <span className="text-slate-400">Completed At</span>
              <p className="font-semibold text-white">
                {test.completedAt ? new Date(test.completedAt).toLocaleTimeString() : 'Just now'}
              </p>
              <p className="text-[11px] text-slate-400 font-mono">ID: {test.id?.substring(0, 8)}...</p>
            </div>
          </div>

          {/* Technical Details Expandable */}
          {test.technicalDetails && (
            <div className="border border-[#1E2638] rounded-lg overflow-hidden">
              <button
                onClick={() => setShowTechnical(!showTechnical)}
                className="w-full px-3 py-2 bg-[#0A0D14] text-xs font-medium text-slate-300 hover:text-white flex items-center justify-between"
              >
                <span>Technical Details & Stack Trace</span>
                {showTechnical ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
              {showTechnical && (
                <pre className="p-3 bg-[#0A0D14] border-t border-[#1E2638] text-[11px] font-mono text-rose-300 max-h-36 overflow-y-auto whitespace-pre-wrap">
                  {test.technicalDetails}
                </pre>
              )}
            </div>
          )}

          {/* Footer Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleDownloadLog}
              className="px-3.5 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-slate-200 border border-[#334155] flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Logs</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-slate-300 border border-[#334155] transition-colors"
              >
                Close
              </button>
              {onRunAgain && (
                <button
                  onClick={() => { onClose(); onRunAgain(); }}
                  className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-black shadow-lg shadow-amber-500/10 transition-colors"
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
