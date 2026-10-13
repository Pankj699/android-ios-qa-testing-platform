import React from 'react';
import {
  DownloadCloud,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  MinusCircle,
  Layers
} from 'lucide-react';

export default function ProgressBar({
  progress = 0,
  steps = [],
  currentStepId,
  isRunning = false,
  completedTest = null,
  error = null,
  appSource = 'uploaded'
}) {
  const defaultSteps = appSource === 'installed'
    ? [
        { id: 'resolve_pid', label: 'Resolving process on device', status: 'PENDING', details: 'Pending' },
        { id: 'attach_logcat', label: 'Attaching PID-Scoped Logcat & Dynamic Watcher', status: 'PENDING', details: 'Pending' },
        { id: 'monitor_session', label: 'Live Application QA Event Monitoring Active', status: 'PENDING', details: 'Pending' }
      ]
    : [
        { id: 'check_prereqs', label: 'Checking Prerequisites (Java, ADB, Bundletool)', status: 'PENDING', details: 'Pending' },
        { id: 'check_device', label: 'Validating Connected Android Device', status: 'PENDING', details: 'Pending' },
        { id: 'analyze_aab', label: 'Analyzing AAB and Asset Packs', status: 'PENDING', details: 'Pending' },
        { id: 'handle_install_mode', label: 'Handling Fresh / Update Install', status: 'PENDING', details: 'Pending' },
        { id: 'generate_apks', label: 'Generating APKs with Bundletool', status: 'PENDING', details: 'Pending' },
        { id: 'install_app', label: 'Installing Generated Application', status: 'PENDING', details: 'Pending' },
        { id: 'launch_app', label: 'Launching Application', status: 'PENDING', details: 'Pending' },
        { id: 'monitor_logs', label: 'Monitoring AssetPackHelper & Download', status: 'PENDING', details: 'Pending' },
        { id: 'verify_result', label: 'Final PAD Verification & Result Analysis', status: 'PENDING', details: 'Pending' }
      ];

  const displaySteps = steps && steps.length > 0 ? steps : defaultSteps;
  const totalSteps = displaySteps.length;
  const completedStepsCount = displaySteps.filter((s) => s.status === 'PASSED').length;
  const stepPercent = totalSteps > 0 ? Math.round((completedStepsCount / totalSteps) * 100) : 0;

  const effectiveProgress = completedTest?.result === 'PASS'
    ? 100
    : Math.max(progress || 0, stepPercent);

  const boundedProgress = Math.min(Math.max(effectiveProgress, 0), 100);

  const isFailed = completedTest?.result === 'FAIL' || displaySteps.some((s) => s.status === 'FAILED');
  const isSuccess = completedTest?.result === 'PASS' || (boundedProgress === 100 && !isRunning && !isFailed);

  const ringColor = isFailed ? '#F43F5E' : isSuccess ? '#10B981' : '#F59E0B';

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (boundedProgress / 100) * circumference;

  const getDynamicStatusBadge = () => {
    if (completedTest) {
      if (completedTest.result === 'PASS') {
        return {
          label: 'All steps completed',
          style: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
        };
      }
      return {
        label: completedTest.failureReason || 'Pipeline failed',
        style: 'bg-rose-500/10 text-rose-300 border-rose-500/30'
      };
    }

    const failedStep = displaySteps.find((s) => s.status === 'FAILED');
    if (failedStep) {
      return {
        label: failedStep.details || failedStep.error || 'Step failed',
        style: 'bg-rose-500/10 text-rose-300 border-rose-500/30'
      };
    }

    const runningStep = displaySteps.find((s) => s.status === 'RUNNING');
    if (runningStep) {
      let label = runningStep.details;
      if (!label || label === 'Pending' || label === 'Waiting') {
        switch (runningStep.id) {
          case 'check_prereqs':
            label = 'Checking Prerequisites...';
            break;
          case 'check_device':
            label = 'Validating Device...';
            break;
          case 'analyze_aab':
            label = 'Analyzing Packs...';
            break;
          case 'handle_install_mode':
            label = 'Preparing Install...';
            break;
          case 'generate_apks':
            label = 'Generating APKs...';
            break;
          case 'install_app':
            label = 'Installing APK...';
            break;
          case 'launch_app':
            label = 'Launching App...';
            break;
          case 'monitor_logs':
            label = boundedProgress > 0 ? `Downloading ${boundedProgress}%` : 'Monitoring Logcat...';
            break;
          case 'verify_result':
            label = 'Verifying PAD Results...';
            break;
          case 'resolve_pid':
            label = 'Resolving Process...';
            break;
          case 'attach_logcat':
            label = 'Attaching Logcat...';
            break;
          case 'monitor_session':
            label = 'Monitoring Logcat...';
            break;
          default:
            label = runningStep.label || 'In Progress...';
        }
      }
      return {
        label,
        style: 'bg-[#1C180A] text-[#F59E0B] border-[#F59E0B]/40 animate-pulse'
      };
    }

    if (displaySteps.length > 0 && displaySteps.every((s) => s.status === 'PASSED' || s.status === 'SKIPPED')) {
      return {
        label: 'All steps completed',
        style: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
      };
    }

    if (isRunning) {
      return {
        label: 'Initializing...',
        style: 'bg-[#1C180A] text-[#F59E0B] border-[#F59E0B]/40 animate-pulse'
      };
    }

    return {
      label: 'Ready',
      style: 'bg-[#151A25] text-[#94A3B8] border-[#232A3B]'
    };
  };

  const getStatusDescription = () => {
    if (completedTest) {
      if (completedTest.result === 'PASS') {
        return '✓ Play Asset Delivery pipeline and verification completed successfully.';
      }
      return completedTest.failureReason || 'Pipeline failed during execution.';
    }

    const failedStep = displaySteps.find((s) => s.status === 'FAILED');
    if (failedStep) {
      return `Failed at step "${failedStep.label}": ${failedStep.details || failedStep.error || 'Execution error'}`;
    }

    if (!isRunning && boundedProgress === 0) {
      return 'Asset pack download progress will track in real-time when the test initiates.';
    }

    if (boundedProgress === 100 && !isRunning) {
      return '✓ Asset pack download and extraction completed successfully on device.';
    }

    const runningStep = displaySteps.find((s) => s.status === 'RUNNING');
    if (runningStep) {
      switch (runningStep.id) {
        case 'check_prereqs':
          return 'Verifying host environment (Java, ADB, Bundletool)...';
        case 'check_device':
          return 'Validating target Android device connection & transport...';
        case 'analyze_aab':
          return 'Analyzing AAB manifest, modules, and asset packs...';
        case 'handle_install_mode':
          return 'Preparing installation target (cleaning or preserving data)...';
        case 'generate_apks':
          return 'Building APKs with embedded local asset delivery server...';
        case 'install_app':
          return 'Deploying APKs and asset pack mock files onto Android device...';
        case 'launch_app':
          return 'Launching application to trigger asset pack download...';
        case 'monitor_logs':
          return boundedProgress > 0
            ? `Downloading and extracting asset pack on device: ${boundedProgress}%`
            : 'Monitoring AssetPackHelper and real-time logcat...';
        case 'verify_result':
          return 'Verifying final PAD delivery results and test assertions...';
        case 'resolve_pid':
          return 'Resolving process PID for installed application on device...';
        case 'attach_logcat':
          return 'Attaching PID-scoped logcat stream and runtime watcher...';
        case 'monitor_session':
          return 'Live application QA event monitoring active...';
        default:
          return runningStep.details || `Executing ${runningStep.label}...`;
      }
    }

    return 'Waiting for test pipeline execution on device...';
  };

  const getStepIcon = (status) => {
    switch (status) {
      case 'PASSED':
        return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
      case 'RUNNING':
        return <Loader2 className="w-4 h-4 text-[#F59E0B] animate-spin shrink-0" />;
      case 'FAILED':
        return <XCircle className="w-4 h-4 text-rose-400 shrink-0" />;
      case 'CANCELLED':
      case 'SKIPPED':
        return <MinusCircle className="w-4 h-4 text-slate-500 shrink-0" />;
      default:
        return <Circle className="w-4 h-4 text-slate-600 shrink-0" />;
    }
  };

  const getStepLabelClass = (status) => {
    switch (status) {
      case 'PASSED':
        return 'text-emerald-300 font-medium';
      case 'RUNNING':
        return 'text-[#F59E0B] font-semibold animate-pulse';
      case 'FAILED':
        return 'text-rose-300 font-medium';
      case 'CANCELLED':
      case 'SKIPPED':
        return 'text-slate-500 line-through';
      default:
        return 'text-slate-400 font-normal';
    }
  };

  const badge = getDynamicStatusBadge();

  return (
    <div className="bg-[#10131B] border border-[#1C2230] rounded-2xl p-5 shadow-2xl flex flex-col justify-between">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-[#1C2230]/80">
        <div className="flex items-center gap-2">
          <DownloadCloud className="w-4 h-4 text-[#F59E0B]" />
          <h3 className="font-bold text-sm text-white">PAD Progress</h3>
        </div>
        <span className={`font-mono text-xs px-2.5 py-1 rounded-lg border transition-all ${badge.style}`}>
          {badge.label}
        </span>
      </div>

      {/* Radial Circular Progress Indicator */}
      <div className="flex flex-col items-center justify-center my-4">
        <div className="relative w-36 h-36 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 128 128">
            <circle
              cx="64"
              cy="64"
              r={radius}
              stroke="#181E2B"
              strokeWidth="10"
              fill="transparent"
            />
            <circle
              cx="64"
              cy="64"
              r={radius}
              stroke={ringColor}
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-500 ease-out"
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            {isFailed ? (
              <span className="text-xl font-extrabold text-rose-400 font-mono tracking-tight">
                FAILED
              </span>
            ) : (
              <span className={`text-3xl font-extrabold font-mono tracking-tight ${isSuccess ? 'text-emerald-400' : 'text-white'}`}>
                {boundedProgress}%
              </span>
            )}
            {isRunning && !isFailed && boundedProgress < 100 && (
              <Loader2 className="w-3.5 h-3.5 text-[#F59E0B] animate-spin mt-1" />
            )}
            {isSuccess && (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-1" />
            )}
          </div>
        </div>

        <p className="text-xs text-[#8F97A6] mt-3 text-center max-w-[280px] leading-relaxed">
          {getStatusDescription()}
        </p>

        {/* Milestone Markers */}
        <div className="pt-3 mt-3 border-t border-[#181E2B] flex items-center justify-between text-[11px] font-mono w-full px-2">
          <span className={boundedProgress >= 0 ? 'text-[#F59E0B] font-bold' : 'text-[#525A6C]'}>
            0% (Queued)
          </span>
          <span className={boundedProgress >= 50 ? 'text-[#F59E0B] font-bold' : 'text-[#525A6C]'}>
            50% (Transfer)
          </span>
          <span className={boundedProgress === 100 ? 'text-emerald-400 font-bold' : 'text-[#525A6C]'}>
            100% (Done)
          </span>
        </div>
      </div>

      {/* Complete Pipeline Step List */}
      <div className="pt-4 border-t border-[#1C2230] space-y-2.5">
        <div className="flex items-center justify-between text-xs pb-1">
          <div className="flex items-center gap-1.5 font-semibold text-[#CBD5E1] uppercase tracking-wider text-[11px]">
            <Layers className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>Overall Pipeline Steps</span>
          </div>
          <span className="font-mono text-[#F59E0B] font-bold text-xs">
            {completedStepsCount}/{totalSteps} ({stepPercent}%)
          </span>
        </div>

        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
          {displaySteps.map((step, index) => (
            <div
              key={step.id || index}
              className={`flex items-start justify-between gap-2 p-2.5 rounded-xl border transition-all ${
                step.status === 'RUNNING'
                  ? 'bg-[#16130C] border-[#F59E0B]/50 shadow-xs'
                  : step.status === 'PASSED'
                  ? 'bg-[#080B10] border-emerald-500/20'
                  : step.status === 'FAILED'
                  ? 'bg-rose-500/10 border-rose-500/30'
                  : 'bg-[#080B10] border-[#1C2230]/60'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {getStepIcon(step.status)}
                <span className={`text-xs truncate ${getStepLabelClass(step.status)}`}>
                  {step.label}
                </span>
              </div>

              {step.details && (
                <span
                  className={`text-[11px] font-mono px-2 py-0.5 rounded shrink-0 ${
                    step.status === 'PASSED'
                      ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                      : step.status === 'RUNNING'
                      ? 'bg-[#1C180A] text-[#F59E0B] border border-[#F59E0B]/40'
                      : step.status === 'FAILED'
                      ? 'bg-rose-500/10 text-rose-300 border border-rose-500/20'
                      : 'text-slate-500'
                  }`}
                >
                  {step.details}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
