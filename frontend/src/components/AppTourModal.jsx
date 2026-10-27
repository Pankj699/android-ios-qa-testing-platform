import React, { useState, useEffect } from 'react';
import {
  X,
  ChevronLeft,
  ChevronRight,
  Compass,
  Smartphone,
  Package,
  PlayCircle,
  Terminal,
  Activity,
  History,
  BookOpen,
  Sparkles,
  CheckCircle2,
  Layers,
  Wifi,
  ExternalLink
} from 'lucide-react';

const TOUR_STEPS = [
  {
    title: 'Welcome to Android PAD & ORD QA Platform',
    category: 'Platform Overview',
    icon: Sparkles,
    tab: 'dashboard',
    badge: 'Getting Started',
    description: 'This platform automates Play Asset Delivery (PAD) and On-Demand Resources (ODR) testing on physical Android devices using Wireless Debugging, Google Bundletool local mock testing, and live Logcat stream monitoring.',
    highlights: [
      'Simulates Google Play Store CDN asset downloads locally using bundletool --local-testing',
      'Pairs and connects seamlessly over Wi-Fi without USB cables',
      'Extracts package name, version, and asset pack configurations automatically from .aab bundles',
      'Provides real-time logcat streaming and one-click controlled ADB operations'
    ],
    tip: 'No publishing to Google Play Internal App Sharing required—all asset delivery testing happens instantly on your local network!'
  },
  {
    title: '1. Connect Device via Wireless Debugging',
    category: 'Device Management',
    icon: Smartphone,
    tab: 'devices',
    badge: 'Step 1',
    description: 'Connect any Android 11+ physical device or emulator wirelessly using Android Developer Options Wireless Debugging.',
    highlights: [
      'Enable Developer Options -> Wireless Debugging on your Android phone',
      'Tap "Pair device with pairing code" to see the 6-digit PIN and pair port',
      'Enter the IP, Pair Port, and 6-digit PIN in the platform pairing modal',
      'Once paired, the device will connect automatically and appear in your active device list'
    ],
    tip: 'Ensure your computer and the Android phone are connected to the same Wi-Fi network!'
  },
  {
    title: '2. Upload & Inspect Android App Bundles (.aab)',
    category: 'Build Management',
    icon: Package,
    tab: 'builds',
    badge: 'Step 2',
    description: 'Upload your application .aab bundle. The host automatically inspects the internal AndroidManifest.xml and asset pack modules.',
    highlights: [
      'Drag and drop or browse for your .aab build file',
      'Inspect detected package name, version name/code, min/target SDK',
      'Review detected asset pack delivery types (install-time, fast-follow, on-demand)',
      'Manage multiple uploaded build versions effortlessly'
    ],
    tip: 'The original build file name is preserved throughout the testing interface for fast QA identification.'
  },
  {
    title: '3. Run Automated PAD / ORD Tests',
    category: 'Test Execution',
    icon: PlayCircle,
    tab: 'run-test',
    badge: 'Step 3',
    description: 'Execute the complete automated 16-step test pipeline that builds device-specific split APKs with local asset pack mocks and installs them onto your target device.',
    highlights: [
      'Select your target device and target .aab build',
      'Toggle Post-Install Action: Choose whether the app launches automatically post-install',
      'Specify custom Logcat filter tags (e.g. PlayCore, AssetPack, or your app tag)',
      'Live step tracker shows exact execution progress from Bundletool build to APK install'
    ],
    tip: 'Bundletool extracts asset packs into a local mock storage directory on the device (/sdcard/Android/data/<pkg>/files/local_testing/) to simulate Google Play downloads.'
  },
  {
    title: '4. Live Monitoring & Logcat Streaming',
    category: 'Live Verification',
    icon: Activity,
    tab: 'run-test',
    badge: 'Step 4',
    description: 'Monitor real-time Logcat outputs over WebSockets as your app initializes and requests on-demand asset packs.',
    highlights: [
      'Real-time streaming directly from adb logcat over WebSocket',
      'Filter logs by level (Verbose, Debug, Info, Warning, Error) and search terms',
      'Live state machine tracking for asset pack transfer states (PENDING -> DOWNLOADING -> COMPLETED)',
      'Pause, resume, and clear log streams anytime with a single click'
    ],
    tip: 'Watch for PlayCore AssetPackManager callbacks to verify fast-follow and on-demand assets load successfully!'
  },
  {
    title: '5. Controlled ADB Device Operations',
    category: 'Device Control',
    icon: Terminal,
    tab: 'run-test',
    badge: 'Step 5',
    description: 'Execute essential QA maintenance actions directly from the workbench without needing to open a terminal or handle cables.',
    highlights: [
      'Launch App: Force-starts the primary launcher activity via ADB monkey launcher',
      'Clear App Data: Resets app storage (pm clear) to test fresh install / re-download behavior',
      'Uninstall App: Completely removes previous package builds to avoid signature conflicts',
      'Clear Logcat: Empties the device log buffer (logcat -c) before recording a fresh session'
    ],
    tip: 'The Controlled Operations panel is embedded directly inside the Run PAD Test tab for instant access!'
  },
  {
    title: '6. Test History, Reports & SOP Documentation',
    category: 'QA Sign-Off',
    icon: BookOpen,
    tab: 'sop',
    badge: 'Step 6',
    description: 'Review automated PASS/FAIL reports, download full execution JSON artifacts, and consult the comprehensive SOP Guide for standard QA operating procedures.',
    highlights: [
      'Review detailed PASS/FAIL test summaries with duration, device metadata, and log snippets',
      'Download full JSON run artifacts and raw logs for bug tickets (Jira, GitHub Issues)',
      'Access the built-in Standard Operating Procedure (SOP) Guide for complete testing guidelines',
      'Interactive QA Sign-off checklist ready for release verification'
    ],
    tip: 'Check out the new SOP Section from the sidebar anytime you or your team need step-by-step guidance!'
  }
];

export default function AppTourModal({ isOpen, onClose, onNavigate }) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (isOpen) {
      setCurrentStep(0);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (currentStep < TOUR_STEPS.length - 1) {
          setCurrentStep((prev) => prev + 1);
        } else {
          onClose();
        }
      } else if (e.key === 'ArrowLeft') {
        if (currentStep > 0) {
          setCurrentStep((prev) => prev - 1);
        }
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStep, onClose]);

  if (!isOpen) return null;

  const step = TOUR_STEPS[currentStep];
  const StepIcon = step.icon;
  const isFirst = currentStep === 0;
  const isLast = currentStep === TOUR_STEPS.length - 1;

  const handleGoToTab = () => {
    if (onNavigate && step.tab) {
      onNavigate(step.tab);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl glass rounded-2xl border border-[var(--line)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[var(--line)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[var(--violet)] to-[var(--pink)] flex items-center justify-center text-white shadow-md shadow-[var(--violet)]/20">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-[var(--muted)] uppercase tracking-wider">
                {step.category}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-[var(--ink)]">Interactive App Tour</span>
                <span className="chip-badge chip-badge-primary text-[10px]">
                  {step.badge}
                </span>
              </div>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--card)] transition-colors cursor-pointer"
            title="Close Tour (Esc)"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {/* Main Card */}
          <div className="p-5 rounded-2xl glass border border-[var(--line)] space-y-4">
            <div className="flex items-start gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-[var(--violet)]/10 text-[var(--violet)] flex items-center justify-center shrink-0 mt-0.5">
                <StepIcon className="w-5 h-5" />
              </div>
              <div className="space-y-1 flex-1">
                <h3 className="text-base font-bold text-[var(--ink)]">{step.title}</h3>
                <p className="text-xs text-[var(--muted)] leading-relaxed">{step.description}</p>
              </div>
            </div>

            {/* Feature Highlights */}
            <div className="space-y-2 pt-2 border-t border-[var(--line)]">
              <span className="text-[11px] font-semibold text-[var(--muted)] uppercase tracking-wide">
                Key Features & Actions:
              </span>
              <ul className="space-y-1.5">
                {step.highlights.map((hl, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-xs text-[var(--ink)]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                    <span>{hl}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* QA Pro Tip Box */}
            {step.tip && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-start gap-2.5 text-xs text-amber-700 dark:text-amber-300">
                <Sparkles className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <p><span className="font-bold text-amber-600 dark:text-amber-400">QA Pro Tip: </span><span>{step.tip}</span></p>
              </div>
            )}
          </div>

          {/* Quick jump to tab action */}
          {step.tab && (
            <div className="flex items-center justify-between p-3.5 rounded-xl glass border border-[var(--line)] text-xs text-[var(--muted)]">
              <span>Want to explore this section in the app?</span>
              <button
                onClick={handleGoToTab}
                className="btn-soft flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[var(--violet)] font-semibold transition-all cursor-pointer"
              >
                <span>Jump to {step.category} Tab</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="px-6 py-4 border-t border-[var(--line)] flex items-center justify-between">
          {/* Progress Indicators */}
          <div className="flex items-center gap-1.5">
            {TOUR_STEPS.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentStep(idx)}
                className={`h-2 rounded-full transition-all ${
                  idx === currentStep
                    ? 'w-6 bg-[var(--violet)]'
                    : 'w-2 bg-[var(--line)] hover:bg-[var(--violet)]/40'
                }`}
                title={`Step ${idx + 1}`}
              />
            ))}
            <span className="text-xs text-[var(--muted)] ml-2 font-mono">
              {currentStep + 1} / {TOUR_STEPS.length}
            </span>
          </div>

          {/* Navigation Buttons */}
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={() => setCurrentStep((prev) => prev - 1)}
                className="btn-soft px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            )}

            {isLast ? (
              <button
                onClick={onClose}
                className="btn-magic px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Finish Tour</span>
              </button>
            ) : (
              <button
                onClick={() => setCurrentStep((prev) => prev + 1)}
                className="btn-magic px-4 py-2 rounded-xl text-xs font-bold text-white shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
