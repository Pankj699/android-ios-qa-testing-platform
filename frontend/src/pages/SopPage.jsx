import React, { useState, useMemo, useEffect } from 'react';
import {
  BookOpen,
  Search,
  CheckSquare,
  Square,
  Smartphone,
  Package,
  PlayCircle,
  Terminal,
  Activity,
  AlertTriangle,
  Info,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  Layers,
  Wifi,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Cpu,
  RefreshCw,
  HelpCircle,
  FileText,
  Cast,
  Eye,
  Sliders,
  Bug,
  Users,
  Compass,
  ArrowRight,
  RotateCcw,
  Sparkles,
  Zap,
  HardDrive
} from 'lucide-react';
import { SOP_CATEGORIES, SOP_GUIDES } from './sopData';

// Map icon string or guide id to Lucide Icon
const GUIDE_ICONS = {
  quickstart: Compass,
  dashboard: Layers,
  devices: Smartphone,
  'screen-mirror': Cast,
  'ui-inspector': Eye,
  builds: Package,
  'google-drive': HardDrive,
  'run-test': PlayCircle,
  'test-history': Activity,
  'adb-operations': Terminal,
  'mixpanel-validator': Activity,
  'remote-config': Sliders,
  'bug-desk': Bug,
  diagnostics: Cpu,
  'admin-users-devices': Users,
  'shortcuts-cheatsheet': FileText,
  'qa-checklist': CheckSquare
};

const CHECKLIST_STORAGE_KEY = 'qa_sop_checklist_state_v2';

const DEFAULT_CHECKLIST = {
  prereq_wifi: false,
  prereq_wireless_debug: false,
  aab_verified: false,
  install_time_present: false,
  fast_follow_downloaded: false,
  on_demand_triggered: false,
  offline_fallback_handled: false,
  asset_integrity_verified: false,
  no_anr_crashes: false,
  pm_clear_reset_tested: false
};

const CHECKLIST_ITEMS = [
  {
    key: 'prereq_wifi',
    title: 'Network Synchronization',
    description: 'Workstation host and Android/iOS test device connected to identical 5GHz Wi-Fi network subnet (or physical high-speed USB-C cable).'
  },
  {
    key: 'prereq_wireless_debug',
    title: 'Developer Debugging Authorization',
    description: 'Wireless debugging paired with 6-digit code or USB debugging RSA key permanently authorized on device screen.'
  },
  {
    key: 'aab_verified',
    title: 'AAB Binary & Manifest Validation',
    description: 'Target bundle uploaded and parsed by Bundletool; package name, build version, and declared asset packs validated without manifest schema errors.'
  },
  {
    key: 'install_time_present',
    title: 'Install-Time Asset Delivery',
    description: 'Install-time asset packs bundled directly inside the base/split APKs and accessible immediately upon initial cold launch.'
  },
  {
    key: 'fast_follow_downloaded',
    title: 'Fast-Follow Asset Download',
    description: 'Fast-follow asset packs automatically queued and downloaded in background upon launch without blocking primary user onboarding.'
  },
  {
    key: 'on_demand_triggered',
    title: 'On-Demand Asset Fetching & Progression',
    description: 'On-demand packs requested via Play Core AssetPackManager API; progress bar displays accurately and assets extract to internal storage.'
  },
  {
    key: 'offline_fallback_handled',
    title: 'Offline & Low-Bandwidth Resilience',
    description: 'Network interrupted during asset download; app handles error gracefully with friendly UI and successfully resumes on reconnect.'
  },
  {
    key: 'asset_integrity_verified',
    title: 'Runtime Asset Integrity & Rendering',
    description: 'Visual 3D models, textures, audio packs, and video files rendered in-game without corruption, missing meshes, or purple placeholder textures.'
  },
  {
    key: 'no_anr_crashes',
    title: 'Zero ANR Dialogs & Fatal Crashes',
    description: 'Logcat monitored continuously for fatal exceptions, OutOfMemory errors, native segmentation faults, or main-thread stalls exceeding 5 seconds.'
  },
  {
    key: 'pm_clear_reset_tested',
    title: 'Fresh State Reset & Regression Verification',
    description: 'Application package cleared via ADB "pm clear", relaunch tested from clean slate, and all regression test cases completed.'
  }
];

export default function SopPage({ onNavigate, onOpenPairModal, onOpenUploadModal }) {
  const [activeGuideId, setActiveGuideId] = useState('quickstart');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Persistent Interactive Checklist State
  const [checklist, setChecklist] = useState(() => {
    try {
      const saved = localStorage.getItem(CHECKLIST_STORAGE_KEY);
      return saved ? { ...DEFAULT_CHECKLIST, ...JSON.parse(saved) } : DEFAULT_CHECKLIST;
    } catch {
      return DEFAULT_CHECKLIST;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CHECKLIST_STORAGE_KEY, JSON.stringify(checklist));
    } catch {
      // Storage unavailable or quota exceeded
    }
  }, [checklist]);

  const toggleChecklist = (key) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const resetChecklist = () => {
    setChecklist(DEFAULT_CHECKLIST);
    try {
      localStorage.removeItem(CHECKLIST_STORAGE_KEY);
    } catch {
      // Storage unavailable
    }
  };

  const scrollToAnchor = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Filtered guides based on selected category & search query
  const filteredGuides = useMemo(() => {
    return SOP_GUIDES.filter((guide) => {
      const matchesCategory =
        selectedCategory === 'all' || guide.categoryId === selectedCategory;
      if (!matchesCategory) return false;

      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase();
      const inTitle = guide.title.toLowerCase().includes(q);
      const inSummary = guide.summary.toLowerCase().includes(q);
      const inBadge = guide.badge.toLowerCase().includes(q);
      const inOverview =
        guide.overview?.description?.toLowerCase().includes(q) ||
        guide.overview?.whenToUse?.toLowerCase().includes(q) ||
        guide.overview?.example?.toLowerCase().includes(q);
      const inSteps = guide.steps?.some(
        (s) => s.title.toLowerCase().includes(q) || s.action.toLowerCase().includes(q)
      );

      return inTitle || inSummary || inBadge || inOverview || inSteps;
    });
  }, [selectedCategory, searchQuery]);

  // Active guide object
  const activeGuide = useMemo(() => {
    return SOP_GUIDES.find((g) => g.id === activeGuideId) || SOP_GUIDES[0];
  }, [activeGuideId]);

  // Checklist counts and progress
  const completedChecklistCount = Object.values(checklist).filter(Boolean).length;
  const totalChecklistCount = CHECKLIST_ITEMS.length;
  const checklistProgress = Math.round((completedChecklistCount / totalChecklistCount) * 100);

  // Category counts
  const categoryCounts = useMemo(() => {
    const counts = { all: SOP_GUIDES.length };
    SOP_GUIDES.forEach((g) => {
      counts[g.categoryId] = (counts[g.categoryId] || 0) + 1;
    });
    return counts;
  }, []);

  const ActiveIcon = GUIDE_ICONS[activeGuide.id] || BookOpen;

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-200">
      {/* 1. Header Banner */}
      <div className="p-6 rounded-card glass border border-[var(--line)] shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-11 h-11 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <BookOpen className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1F2544] dark:text-white tracking-tight font-sans">
                SOP <span className="text-heading-gradient">Guide</span>
              </h1>
              <span className="chip-badge text-[10px] py-0.5 px-2.5 font-mono">
                Platform Standard v2.0
              </span>
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                17 Comprehensive Operational Procedures
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-[#6B7194] dark:text-[#94A3B8] max-w-3xl mt-1 leading-relaxed">
              Complete, beginner-friendly operational procedures, hardware prerequisites, step-by-step verification flows, common troubleshooting fixes, and safety guidelines for every module on the QA Platform.
            </p>
          </div>
        </div>

        {/* QA Checklist Quick Metric Card */}
        <div
          onClick={() => setActiveGuideId('qa-checklist')}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setActiveGuideId('qa-checklist');
            }
          }}
          className="bg-white/90 dark:bg-slate-950/70 border border-[var(--line)] hover:border-violet-500/40 rounded-2xl p-3 shrink-0 flex items-center gap-3.5 shadow-sm transition-all cursor-pointer group"
          title="Click to view interactive QA Sign-Off Checklist"
        >
          <div>
            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
              QA Sign-Off Progress
            </div>
            <div className="text-sm font-extrabold text-[#1F2544] dark:text-white mt-0.5">
              {completedChecklistCount} of {totalChecklistCount} Passed ({checklistProgress}%)
            </div>
          </div>
          <div className="w-12 h-12 rounded-full bg-violet-500/10 border border-violet-500/25 flex items-center justify-center relative shadow-sm shrink-0">
            <span className="text-xs font-black text-violet-600 dark:text-violet-400 font-mono">
              {checklistProgress}%
            </span>
          </div>
        </div>
      </div>

      {/* 2. Category Filter Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
        {SOP_CATEGORIES.map((cat) => {
          const isSelected = selectedCategory === cat.id;
          const count = categoryCounts[cat.id] || 0;
          return (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(cat.id)}
              className={`shrink-0 px-3.5 py-1.5 rounded-pill text-xs font-semibold transition-all flex items-center gap-2 ${
                isSelected
                  ? 'btn-magic text-white shadow-sm font-bold'
                  : 'bg-white/70 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 border border-[var(--line)] hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span>{cat.label}</span>
              <span
                className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                  isSelected ? 'bg-white/20 text-white font-bold' : 'bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 3. Main Grid: Sidebar List + Guide Reader */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Sidebar: Search + Guide Directory */}
        <div className="lg:col-span-4 space-y-3">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search guides, actions, fixes..."
              className="w-full bg-white/80 dark:bg-slate-950/60 border border-[var(--line)] rounded-pill pl-9.5 pr-4 py-2 text-xs text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-violet-500 shadow-inner transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-2.5 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                Clear
              </button>
            )}
          </div>

          {/* Guide Cards Navigation List */}
          <div className="glass rounded-card border border-[var(--line)] p-2 space-y-1 shadow-sm max-h-[calc(100vh-280px)] overflow-y-auto">
            {filteredGuides.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400 space-y-2">
                <AlertTriangle className="w-6 h-6 mx-auto text-amber-500" />
                <p>No guides match your filter or search query.</p>
                <button
                  onClick={() => {
                    setSelectedCategory('all');
                    setSearchQuery('');
                  }}
                  className="text-violet-600 dark:text-violet-400 font-semibold hover:underline"
                >
                  Reset search & filters
                </button>
              </div>
            ) : (
              filteredGuides.map((guide) => {
                const Icon = GUIDE_ICONS[guide.id] || BookOpen;
                const isActive = activeGuideId === guide.id;

                return (
                  <button
                    key={guide.id}
                    onClick={() => setActiveGuideId(guide.id)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-pill text-xs font-semibold text-left transition-all ${
                      isActive
                        ? 'btn-magic text-white font-bold shadow-sm'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 truncate pr-2">
                      <Icon
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-white' : 'text-slate-400 dark:text-slate-400'
                        }`}
                      />
                      <span className="truncate">{guide.title}</span>
                    </div>
                    <span
                      className={`text-[9px] uppercase font-mono px-2 py-0.5 rounded-pill shrink-0 ${
                        isActive
                          ? 'bg-white/20 text-white font-bold'
                          : 'bg-white/60 dark:bg-slate-900/60 text-slate-600 dark:text-slate-400 border border-[var(--line)]'
                      }`}
                    >
                      {guide.badge}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Quick Support & Shortcuts Card */}
          <div className="p-4 rounded-2xl glass border border-[var(--line)] space-y-2 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <Zap className="w-4 h-4 text-violet-500" />
              <span>Need Quick Platform Assistance?</span>
            </div>
            <p className="text-[11px] text-[#6B7194] dark:text-[#94A3B8] leading-relaxed">
              All shortcuts can be viewed on the{' '}
              <button
                onClick={() => setActiveGuideId('shortcuts-cheatsheet')}
                className="text-violet-600 dark:text-violet-400 font-semibold hover:underline"
              >
                Shortcuts Cheatsheet
              </button>
              . For release validation, jump to the{' '}
              <button
                onClick={() => setActiveGuideId('qa-checklist')}
                className="text-violet-600 dark:text-violet-400 font-semibold hover:underline"
              >
                QA Acceptance Checklist
              </button>
              .
            </p>
          </div>
        </div>

        {/* Right Content Area: Active SOP Guide Viewer */}
        <div className="lg:col-span-8 glass border border-[var(--line)] rounded-card p-6 lg:p-8 space-y-8 shadow-sm">
          {/* Active Guide Header */}
          <div className="space-y-4 pb-6 border-b border-[var(--line)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <span className="chip-badge text-[10px] py-0.5 px-2.5 font-mono">
                  {activeGuide.badge}
                </span>
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 uppercase">
                  Category: {activeGuide.categoryId.replace('-', ' ')}
                </span>
              </div>

              {/* Contextual Action Buttons */}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Pairing Modal trigger */}
                {(activeGuide.id === 'devices' || activeGuide.id === 'quickstart') && onOpenPairModal && (
                  <button
                    onClick={onOpenPairModal}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Wifi className="w-3.5 h-3.5" />
                    <span>Pair Device</span>
                  </button>
                )}

                {/* Upload Modal trigger */}
                {(activeGuide.id === 'builds' || activeGuide.id === 'quickstart') && onOpenUploadModal && (
                  <button
                    onClick={onOpenUploadModal}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>Upload Build</span>
                  </button>
                )}

                {/* Module navigation triggers matching real App.jsx tab IDs */}
                {activeGuide.id === 'dashboard' && onNavigate && (
                  <button
                    onClick={() => onNavigate('dashboard')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Open Dashboard</span>
                  </button>
                )}

                {activeGuide.id === 'devices' && onNavigate && (
                  <button
                    onClick={() => onNavigate('devices')}
                    className="btn-soft px-3 py-1.5 text-xs rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span>Go to Devices Tab</span>
                  </button>
                )}

                {activeGuide.id === 'builds' && onNavigate && (
                  <button
                    onClick={() => onNavigate('builds')}
                    className="btn-soft px-3 py-1.5 text-xs rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>Go to Builds Tab</span>
                  </button>
                )}

                {(activeGuide.id === 'run-test' || activeGuide.id === 'quickstart') && onNavigate && (
                  <button
                    onClick={() => onNavigate('run-test')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <PlayCircle className="w-3.5 h-3.5" />
                    <span>Open Run PAD Test</span>
                  </button>
                )}

                {activeGuide.id === 'screen-mirror' && onNavigate && (
                  <button
                    onClick={() => onNavigate('screen-mirror')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Cast className="w-3.5 h-3.5" />
                    <span>Open Screen Mirror</span>
                  </button>
                )}

                {activeGuide.id === 'ui-inspector' && onNavigate && (
                  <button
                    onClick={() => onNavigate('ui-inspector')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Open UI Inspector</span>
                  </button>
                )}

                {activeGuide.id === 'google-drive' && onNavigate && (
                  <button
                    onClick={() => onNavigate('google-drive')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <HardDrive className="w-3.5 h-3.5" />
                    <span>Open Google Drive</span>
                  </button>
                )}

                {activeGuide.id === 'test-history' && onNavigate && (
                  <button
                    onClick={() => onNavigate('history')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Open Test History</span>
                  </button>
                )}

                {activeGuide.id === 'adb-operations' && onNavigate && (
                  <button
                    onClick={() => onNavigate('adb-ops')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Open ADB Operations</span>
                  </button>
                )}

                {activeGuide.id === 'mixpanel-validator' && onNavigate && (
                  <button
                    onClick={() => onNavigate('mixpanel-validator')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Open Mixpanel Validator</span>
                  </button>
                )}

                {activeGuide.id === 'remote-config' && onNavigate && (
                  <button
                    onClick={() => onNavigate('remote-config')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Sliders className="w-3.5 h-3.5" />
                    <span>Open Remote Config</span>
                  </button>
                )}

                {activeGuide.id === 'bug-desk' && onNavigate && (
                  <button
                    onClick={() => onNavigate('bug-desk')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Bug className="w-3.5 h-3.5" />
                    <span>Open Bug Desk</span>
                  </button>
                )}

                {activeGuide.id === 'diagnostics' && onNavigate && (
                  <button
                    onClick={() => onNavigate('diagnostics')}
                    className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                  >
                    <Cpu className="w-3.5 h-3.5" />
                    <span>Open System Diagnostics</span>
                  </button>
                )}

                {activeGuide.id === 'admin-users-devices' && onNavigate && (
                  <>
                    <button
                      onClick={() => onNavigate('admin-users')}
                      className="btn-magic px-3 py-1.5 text-xs text-white rounded-pill flex items-center gap-1.5 shadow-sm"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>User Management</span>
                    </button>
                    <button
                      onClick={() => onNavigate('admin-devices')}
                      className="btn-soft px-3 py-1.5 text-xs rounded-pill flex items-center gap-1.5 shadow-sm"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>Device Management</span>
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center shrink-0">
                  <ActiveIcon className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-[#1F2544] dark:text-white tracking-tight">
                  {activeGuide.title}
                </h2>
              </div>
              <p className="text-xs sm:text-[13px] text-[#6B7194] dark:text-[#94A3B8] leading-relaxed">
                {activeGuide.summary}
              </p>
            </div>

            {/* Quick-Jump Anchor Bar */}
            {activeGuide.id !== 'qa-checklist' && activeGuide.id !== 'shortcuts-cheatsheet' && (
              <div className="flex items-center gap-1.5 flex-wrap pt-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1">
                  Quick Jump:
                </span>
                <button
                  type="button"
                  onClick={() => scrollToAnchor('section-overview')}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-pill bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer"
                >
                  A. Overview
                </button>
                <button
                  type="button"
                  onClick={() => scrollToAnchor('section-prerequisites')}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-pill bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer"
                >
                  B. Prerequisites
                </button>
                <button
                  type="button"
                  onClick={() => scrollToAnchor('section-steps')}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-pill bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer"
                >
                  C. Step-by-Step
                </button>
                <button
                  type="button"
                  onClick={() => scrollToAnchor('section-verification')}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-pill bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer"
                >
                  D. Verification
                </button>
                <button
                  type="button"
                  onClick={() => scrollToAnchor('section-troubleshooting')}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-pill bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer"
                >
                  E. Troubleshooting
                </button>
                <button
                  type="button"
                  onClick={() => scrollToAnchor('section-warnings')}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-pill bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-violet-50 dark:hover:bg-violet-950/40 hover:text-violet-600 dark:hover:text-violet-400 transition-colors cursor-pointer"
                >
                  F. Safety & Best Practices
                </button>
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* SPECIAL GUIDE 1: INTERACTIVE QA SIGN-OFF CHECKLIST */}
          {/* ========================================================================= */}
          {activeGuide.id === 'qa-checklist' ? (
            <div className="space-y-6">
              <div className="p-4 rounded-2xl bg-violet-50/70 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800/40 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-bold text-violet-900 dark:text-violet-200">
                    <CheckSquare className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                    <span>QA Sign-Off Acceptance Criteria Checklist</span>
                  </div>
                  <button
                    onClick={resetChecklist}
                    className="text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset All Checks</span>
                  </button>
                </div>
                <p className="text-xs text-violet-700 dark:text-violet-300 leading-relaxed">
                  Every mobile build must meet these 10 core acceptance criteria before production sign-off. Your check progress is saved locally in your browser.
                </p>
                {/* Progress bar */}
                <div className="w-full bg-violet-200 dark:bg-violet-900/50 rounded-full h-2.5 mt-2 overflow-hidden">
                  <div
                    className="bg-violet-600 h-2.5 rounded-full transition-all duration-300"
                    style={{ width: `${checklistProgress}%` }}
                  />
                </div>
              </div>

              {/* Checklist Items */}
              <div className="space-y-3">
                {CHECKLIST_ITEMS.map((item, idx) => {
                  const isChecked = Boolean(checklist[item.key]);
                  return (
                    <div
                      key={item.key}
                      onClick={() => toggleChecklist(item.key)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          toggleChecklist(item.key);
                        }
                      }}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-3.5 ${
                        isChecked
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800/40 text-emerald-950 dark:text-emerald-100 shadow-sm'
                          : 'bg-white/80 dark:bg-slate-900/60 border-[var(--line)] hover:border-violet-400/50 text-slate-800 dark:text-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleChecklist(item.key);
                        }}
                        className="mt-0.5 shrink-0 focus:outline-none cursor-pointer"
                      >
                        {isChecked ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Square className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                        )}
                      </button>
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold font-mono text-slate-400">
                            #{idx + 1}
                          </span>
                          <span
                            className={`text-xs sm:text-sm font-bold ${
                              isChecked
                                ? 'text-emerald-900 dark:text-emerald-200 line-through opacity-85'
                                : 'text-[#1F2544] dark:text-white'
                            }`}
                          >
                            {item.title}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Status Banner */}
              {checklistProgress === 100 ? (
                <div className="p-4 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-800 dark:text-emerald-300 flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <div>
                    <div className="text-xs font-bold uppercase tracking-wider">
                      All Acceptance Checks Passed
                    </div>
                    <div className="text-xs mt-0.5">
                      This mobile build has met all 10 QA criteria. You can safely sign off on the build or export your findings to Bug Desk / Jira.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 flex items-center gap-3">
                  <AlertTriangle className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="text-xs">
                    <span className="font-bold">Pending Sign-Off:</span> Complete the remaining {totalChecklistCount - completedChecklistCount} verification items before approving this release for production.
                  </div>
                </div>
              )}
            </div>
          ) : activeGuide.id === 'shortcuts-cheatsheet' ? (
            /* ========================================================================= */
            /* SPECIAL GUIDE 2: KEYBOARD SHORTCUTS CHEAT SHEET */
            /* ========================================================================= */
            <div className="space-y-6">
              <div className="p-4 rounded-2xl bg-violet-50/70 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800/40 space-y-1">
                <div className="flex items-center gap-2 text-xs font-bold text-violet-900 dark:text-violet-200">
                  <FileText className="w-4 h-4 text-violet-600 dark:text-violet-400" />
                  <span>Platform Keyboard Accelerators & Operational Shortcuts</span>
                </div>
                <p className="text-xs text-violet-700 dark:text-violet-300 leading-relaxed">
                  These shortcuts accelerate high-frequency QA operations across Windows/Linux (<kbd className="px-1.5 py-0.5 rounded bg-violet-200/60 dark:bg-violet-900 text-[10px] font-mono font-bold">Alt</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-violet-200/60 dark:bg-violet-900 text-[10px] font-mono font-bold">Ctrl</kbd>) and macOS (<kbd className="px-1.5 py-0.5 rounded bg-violet-200/60 dark:bg-violet-900 text-[10px] font-mono font-bold">Option</kbd> / <kbd className="px-1.5 py-0.5 rounded bg-violet-200/60 dark:bg-violet-900 text-[10px] font-mono font-bold">Cmd</kbd>). All Alt-key shortcuts include intelligent text-entry suppression to prevent interfering while typing in input fields.
                </p>
              </div>

              <div className="overflow-x-auto rounded-2xl border border-[var(--line)] glass shadow-sm">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-[var(--line)] text-slate-500 dark:text-slate-400 font-mono text-[10px] uppercase">
                    <tr>
                      <th className="p-3.5">Shortcut Key</th>
                      <th className="p-3.5">Action Target</th>
                      <th className="p-3.5">Availability Scope</th>
                      <th className="p-3.5">Operational Description</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--line)] text-slate-700 dark:text-slate-300">
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="p-3.5 font-mono">
                        <kbd className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white font-bold border border-slate-300 dark:border-slate-700 shadow-sm">
                          Alt + Q
                        </kbd>
                      </td>
                      <td className="p-3.5 font-bold text-[#1F2544] dark:text-white">Run PAD Test</td>
                      <td className="p-3.5">
                        <span className="chip-badge text-[9px] py-0.5 px-2">Run Test, Bug Desk, Remote Config</span>
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        Immediately triggers the 9-stage Play Asset Delivery automated test pipeline on the target device.
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="p-3.5 font-mono">
                        <kbd className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white font-bold border border-slate-300 dark:border-slate-700 shadow-sm">
                          Alt + R
                        </kbd>
                      </td>
                      <td className="p-3.5 font-bold text-[#1F2544] dark:text-white">Relaunch Application</td>
                      <td className="p-3.5">
                        <span className="chip-badge text-[9px] py-0.5 px-2">Run Test, Bug Desk, Remote Config</span>
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        Force-stops and relaunches the active target application package on the connected phone via ADB.
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="p-3.5 font-mono">
                        <kbd className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white font-bold border border-slate-300 dark:border-slate-700 shadow-sm">
                          Alt + D
                        </kbd>
                      </td>
                      <td className="p-3.5 font-bold text-[#1F2544] dark:text-white">Wipe App Data</td>
                      <td className="p-3.5">
                        <span className="chip-badge text-[9px] py-0.5 px-2">Run Test, Bug Desk, Remote Config</span>
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        Executes <code className="font-mono text-[11px] text-violet-600 dark:text-violet-400">pm clear &lt;package&gt;</code> to reset local databases, credentials, and app preferences.
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="p-3.5 font-mono">
                        <kbd className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white font-bold border border-slate-300 dark:border-slate-700 shadow-sm">
                          Alt + C
                        </kbd>
                      </td>
                      <td className="p-3.5 font-bold text-[#1F2544] dark:text-white">Clear App Cache</td>
                      <td className="p-3.5">
                        <span className="chip-badge text-[9px] py-0.5 px-2">Run Test, Bug Desk, Remote Config</span>
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        Purges temporary cache files without logging the user out or clearing saved databases.
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="p-3.5 font-mono">
                        <kbd className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white font-bold border border-slate-300 dark:border-slate-700 shadow-sm">
                          Alt + U
                        </kbd>
                      </td>
                      <td className="p-3.5 font-bold text-[#1F2544] dark:text-white">Uninstall Application</td>
                      <td className="p-3.5">
                        <span className="chip-badge text-[9px] py-0.5 px-2">Run Test, Bug Desk, Remote Config</span>
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        Completely removes the active package from the target device (<code className="font-mono text-[11px] text-rose-500">pm uninstall</code>).
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="p-3.5 font-mono">
                        <kbd className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white font-bold border border-slate-300 dark:border-slate-700 shadow-sm">
                          Ctrl + Enter
                        </kbd>
                      </td>
                      <td className="p-3.5 font-bold text-[#1F2544] dark:text-white">Save Config / Generate Bug</td>
                      <td className="p-3.5">
                        <span className="chip-badge text-[9px] py-0.5 px-2">Edit Remote Config &amp; Bug Desk</span>
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        In Edit Remote Config: validates JSON syntax and saves configuration. In Bug Desk: triggers Gemini AI report generation from raw notes.
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="p-3.5 font-mono">
                        <kbd className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white font-bold border border-slate-300 dark:border-slate-700 shadow-sm">
                          Escape
                        </kbd>
                      </td>
                      <td className="p-3.5 font-bold text-[#1F2544] dark:text-white">Close / Dismiss Dialog</td>
                      <td className="p-3.5">
                        <span className="chip-badge text-[9px] py-0.5 px-2">Modals &amp; Previews</span>
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        Safely dismisses open dialogs (Create/Edit Remote Config, View Full Value, Delete Confirmation, Device dropdowns, Log Viewer).
                      </td>
                    </tr>
                    <tr className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="p-3.5 font-mono">
                        <kbd className="px-2 py-1 rounded bg-slate-200 dark:bg-slate-800 text-slate-900 dark:text-white font-bold border border-slate-300 dark:border-slate-700 shadow-sm">
                          Tab / Shift+Tab
                        </kbd>
                      </td>
                      <td className="p-3.5 font-bold text-[#1F2544] dark:text-white">Indent / Unindent Code</td>
                      <td className="p-3.5">
                        <span className="chip-badge text-[9px] py-0.5 px-2">JSON Editor</span>
                      </td>
                      <td className="p-3.5 text-slate-500 dark:text-slate-400">
                        Indents or unindents code blocks by 2 spaces inside the Synchronized JSON Editor on Remote Config Manager.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            /* ========================================================================= */
            /* STANDARD 6-PART SOP GUIDE BODY */
            /* ========================================================================= */
            <div className="space-y-8">
              {/* SECTION A: FEATURE OVERVIEW */}
              <section id="section-overview" className="space-y-3 scroll-mt-20">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 font-bold border border-violet-200 dark:border-violet-800/50">
                    SECTION A
                  </span>
                  <h3 className="text-base font-extrabold text-[#1F2544] dark:text-white">
                    Feature Overview
                  </h3>
                </div>

                <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/50 border border-[var(--line)] space-y-3 shadow-inner">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      {activeGuide.overview?.name}
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                      {activeGuide.overview?.description}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                    <div className="p-3 rounded-xl bg-violet-50/60 dark:bg-violet-950/20 border border-violet-200/60 dark:border-violet-800/30 space-y-1">
                      <div className="text-[11px] font-bold text-violet-800 dark:text-violet-300 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400 shrink-0" />
                        <span>When & Why to Use It</span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        {activeGuide.overview?.whenToUse}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800/60 space-y-1">
                      <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        <span>Real-World QA Scenario</span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                        {activeGuide.overview?.example}
                      </p>
                    </div>
                  </div>
                </div>
              </section>

              {/* SECTION B: BEFORE YOU START (PREREQUISITES) */}
              <section id="section-prerequisites" className="space-y-3 scroll-mt-20">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 font-bold border border-violet-200 dark:border-violet-800/50">
                    SECTION B
                  </span>
                  <h3 className="text-base font-extrabold text-[#1F2544] dark:text-white">
                    Before You Start (Prerequisites)
                  </h3>
                </div>

                <div className="p-4 rounded-2xl bg-white/70 dark:bg-slate-900/50 border border-[var(--line)] space-y-2.5 shadow-inner">
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                    Ensure all prerequisites below are satisfied before initiating this procedure:
                  </p>
                  <div className="space-y-2">
                    {activeGuide.prerequisites?.map((prereq, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-300"
                      >
                        <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{prereq}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* SECTION C: STEP-BY-STEP INSTRUCTIONS */}
              <section id="section-steps" className="space-y-3 scroll-mt-20">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 font-bold border border-violet-200 dark:border-violet-800/50">
                    SECTION C
                  </span>
                  <h3 className="text-base font-extrabold text-[#1F2544] dark:text-white">
                    Step-by-Step Instructions
                  </h3>
                </div>

                <div className="space-y-3">
                  {activeGuide.steps?.map((stepItem) => (
                    <div
                      key={stepItem.step}
                      className="p-4 rounded-2xl bg-white/80 dark:bg-slate-900/60 border border-[var(--line)] shadow-sm space-y-2"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="w-6 h-6 rounded-full bg-violet-600 text-white font-extrabold text-xs flex items-center justify-center shrink-0">
                          {stepItem.step}
                        </span>
                        <h4 className="text-xs sm:text-sm font-bold text-[#1F2544] dark:text-white">
                          {stepItem.title}
                        </h4>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-300 pl-8.5 leading-relaxed">
                        {stepItem.action}
                      </p>
                    </div>
                  ))}
                </div>
              </section>

              {/* SECTION D: EXPECTED RESULT & VERIFICATION */}
              <section id="section-verification" className="space-y-3 scroll-mt-20">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 font-bold border border-violet-200 dark:border-violet-800/50">
                    SECTION D
                  </span>
                  <h3 className="text-base font-extrabold text-[#1F2544] dark:text-white">
                    Expected Result & How to Verify Success
                  </h3>
                </div>

                <div className="p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 space-y-3 shadow-inner">
                  {/* Appearance / Visual */}
                  <div className="space-y-1">
                    <div className="text-[11px] font-bold text-emerald-950 dark:text-emerald-100 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                      <span>Expected Appearance &amp; State:</span>
                    </div>
                    <p className="text-xs text-emerald-900 dark:text-emerald-200 pl-5.5 leading-relaxed">
                      {activeGuide.expectedResult?.appearance || activeGuide.expectedResult?.visual}
                    </p>
                  </div>

                  {/* Verification Instructions or Criteria List */}
                  {(activeGuide.expectedResult?.verification || activeGuide.expectedResult?.criteria) && (
                    <div className="space-y-1.5 pt-2.5 border-t border-emerald-200/60 dark:border-emerald-800/30">
                      <div className="text-[11px] font-bold text-emerald-950 dark:text-emerald-100 flex items-center gap-1.5">
                        <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                        <span>How to Verify Success:</span>
                      </div>
                      {activeGuide.expectedResult?.verification && (
                        <p className="text-xs text-emerald-900 dark:text-emerald-200 pl-5.5 leading-relaxed">
                          {activeGuide.expectedResult.verification}
                        </p>
                      )}
                      {Array.isArray(activeGuide.expectedResult?.criteria) && (
                        <div className="space-y-1 pl-5.5 pt-1">
                          {activeGuide.expectedResult.criteria.map((crit, idx) => (
                            <div
                              key={idx}
                              className="flex items-start gap-2 text-xs text-emerald-900 dark:text-emerald-200"
                            >
                              <span className="text-emerald-600 font-bold">•</span>
                              <span className="leading-relaxed">{crit}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </section>

              {/* SECTION E: TROUBLESHOOTING & COMMON ISSUES */}
              <section id="section-troubleshooting" className="space-y-3 scroll-mt-20">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 font-bold border border-violet-200 dark:border-violet-800/50">
                    SECTION E
                  </span>
                  <h3 className="text-base font-extrabold text-[#1F2544] dark:text-white">
                    Troubleshooting & Error Resolution
                  </h3>
                </div>

                <div className="space-y-3">
                  {activeGuide.troubleshooting?.map((trouble, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-2xl bg-white/80 dark:bg-slate-900/60 border border-[var(--line)] space-y-2 shadow-sm"
                    >
                      <div className="flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>Issue: {trouble.issue || trouble.problem}</span>
                      </div>
                      <div className="text-xs text-slate-700 dark:text-slate-300 pl-6 leading-relaxed bg-slate-50 dark:bg-slate-950/40 p-2.5 rounded-xl border border-[var(--line)]">
                        <span className="font-bold text-slate-900 dark:text-white">
                          Actionable Fix:
                        </span>{' '}
                        {trouble.solution || trouble.fix}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* SECTION F: SAFETY WARNINGS & BEST PRACTICES */}
              <section id="section-warnings" className="space-y-3 scroll-mt-20">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 font-bold border border-amber-200 dark:border-amber-800/50">
                    SECTION F
                  </span>
                  <h3 className="text-base font-extrabold text-[#1F2544] dark:text-white">
                    Important Warnings & Best Practices
                  </h3>
                </div>

                <div className="space-y-2.5">
                  {activeGuide.warnings?.map((warn, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-start gap-3 shadow-inner"
                    >
                      <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                        {warn}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
