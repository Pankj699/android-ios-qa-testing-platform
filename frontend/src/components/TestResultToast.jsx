import React from 'react';
import { CheckCircle2, XCircle, Clock, Smartphone, Package, Download, X, RotateCcw } from 'lucide-react';

export default function TestResultToast({ test, onClose, onRunAgain }) {
  if (!test) return null;

  const isPass = test.result === 'PASS';

  const handleDownloadLog = () => {
    window.open(`/api/test/${test.id}/download-logs`, '_blank');
  };

  return (
    <div className="fixed top-20 right-6 z-50 max-w-md w-full animate-slideInRight">
      <div
        className={`p-4 rounded-2xl bg-[#131924]/95 backdrop-blur-md border shadow-2xl space-y-3 ${
          isPass
            ? 'border-emerald-500/60 shadow-emerald-950/40 text-slate-100'
            : 'border-rose-500/60 shadow-rose-950/40 text-slate-100'
        }`}
      >
        {/* Top Header & Close */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isPass
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}
            >
              {isPass ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  PAD Test Finished
                </span>
                <span
                  className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded font-mono ${
                    isPass
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  }`}
                >
                  {test.result || 'COMPLETED'}
                </span>
              </div>
              <h4 className="text-sm font-bold text-white">
                {isPass ? 'Test Passed Successfully' : 'Test Failed'}
              </h4>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#1E2638] transition-colors"
            title="Dismiss Toast"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Message description */}
        <p className="text-xs text-slate-300 leading-relaxed">
          {isPass
            ? 'Play Asset Delivery local testing successfully loaded all required asset packs.'
            : test.failureReason || 'Test execution encountered an error.'}
        </p>

        {/* Compact Metadata Chips */}
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-300 bg-[#0A0D14] p-2.5 rounded-xl border border-[#1E2638]">
          <div className="flex items-center gap-1.5 truncate">
            <Smartphone className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
            <span className="truncate">{test.deviceName || test.deviceSerial}</span>
          </div>

          <div className="flex items-center gap-1.5 truncate">
            <Clock className="w-3.5 h-3.5 text-purple-400 shrink-0" />
            <span>Duration: {test.duration || '0s'}</span>
          </div>

          <div className="col-span-2 flex items-center gap-1.5 truncate">
            <Package className="w-3.5 h-3.5 text-[#F59E0B] shrink-0" />
            <span className="truncate">{test.fileName || test.packageName}</span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-1 gap-2">
          <button
            onClick={handleDownloadLog}
            className="px-3 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs text-slate-200 hover:text-white font-medium flex items-center gap-1.5 transition-colors border border-[#334155]"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Logs</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-white transition-colors"
            >
              Dismiss
            </button>
            {onRunAgain && (
              <button
                onClick={() => {
                  onClose();
                  onRunAgain();
                }}
                className="px-3.5 py-1.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-black shadow-md shadow-amber-500/10 flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Run Again</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
