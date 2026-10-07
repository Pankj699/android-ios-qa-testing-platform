import React from 'react';
import { CheckCircle2, XCircle, Loader2, Circle, AlertTriangle, MinusCircle, Layers } from 'lucide-react';

export default function StepTracker({ steps = [] }) {
  if (!steps || steps.length === 0) return null;

  const totalSteps = steps.length;
  const completedSteps = steps.filter(s => s.status === 'PASSED').length;
  const runningIndex = steps.findIndex(s => s.status === 'RUNNING');
  const activeStepNumber = runningIndex >= 0 ? runningIndex + 1 : (completedSteps === totalSteps ? totalSteps : completedSteps + 1);
  const overallPercent = Math.round((completedSteps / totalSteps) * 100);

  const getStepIcon = (status) => {
    switch (status) {
      case 'PASSED':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'RUNNING':
        return <Loader2 className="w-4 h-4 text-[#F59E0B] animate-spin shrink-0" />;
      case 'FAILED':
        return <XCircle className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'CANCELLED':
        return <MinusCircle className="w-4 h-4 text-slate-500 shrink-0" />;
      default:
        return <Circle className="w-4 h-4 text-slate-600 shrink-0" />;
    }
  };

  const getStepClass = (status) => {
    switch (status) {
      case 'PASSED':
        return 'text-emerald-300 font-medium';
      case 'RUNNING':
        return 'text-[#F59E0B] font-bold animate-pulse';
      case 'FAILED':
        return 'text-rose-300 font-medium';
      case 'CANCELLED':
        return 'text-slate-500 line-through';
      default:
        return 'text-slate-400';
    }
  };

  return (
    <div className="bg-[#131924] border border-[#1E2638] rounded-xl p-4 space-y-3">
      {/* Header & Overall Pipeline Progress */}
      <div className="space-y-1.5 pb-2 border-b border-[#1E2638]">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-white uppercase tracking-wider">
            <Layers className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>Overall Pipeline Progress</span>
          </div>
          <span className="font-mono text-[#F59E0B] font-bold">
            Step {activeStepNumber}/{totalSteps} ({overallPercent}%)
          </span>
        </div>

        {/* Small overall progress bar */}
        <div className="w-full bg-[#0A0D14] rounded-full h-2 border border-[#1E2638] overflow-hidden">
          <div
            className="bg-[#F59E0B] h-full rounded-full transition-all duration-300"
            style={{ width: `${overallPercent}%` }}
          ></div>
        </div>
      </div>

      {/* Step checklist items */}
      <div className="space-y-2">
        {steps.map((step, index) => (
          <div
            key={step.id || index}
            className={`flex items-start justify-between p-2 rounded-lg transition-colors ${
              step.status === 'RUNNING'
                ? 'bg-[#261D10] border border-[#78350F]'
                : step.status === 'FAILED'
                ? 'bg-rose-500/10 border border-rose-500/20'
                : 'bg-[#0A0D14] border border-transparent'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {getStepIcon(step.status)}
              <span className={`text-xs ${getStepClass(step.status)}`}>
                {step.label}
              </span>
            </div>

            {step.details && (
              <span className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                step.status === 'PASSED'
                  ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                  : step.status === 'FAILED'
                  ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                  : 'text-slate-400'
              }`}>
                {step.details}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
