import React from 'react';
import {
  LayoutDashboard,
  Smartphone,
  Tv,
  Package,
  PlayCircle,
  History,
  Terminal,
  Activity,
  BookOpen,
  ShieldCheck,
  HardDrive,
  Scan,
  FileSpreadsheet,
  Bug,
  PanelLeftClose,
  PanelLeftOpen,
  Sliders,
  Bot,
  FileText,
  ListChecks,
  Sparkles
} from 'lucide-react';
import Tooltip from './ui/Tooltip';
import { isAiTestWriterEnabled } from '../utils/featureFlags';
import { SYS_VERSION, APP_VERSION, GIT_COMMIT_HASH } from '../config/version';

const NAV_GROUPS = [
  {
    id: 'main',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'devices', label: 'Devices', icon: Smartphone },
      { id: 'screen-mirror', label: 'Screen Mirror', icon: Tv },
      { id: 'ui-inspector', label: 'UI Inspector', icon: Scan },
      { id: 'builds', label: 'Builds & AAB', icon: Package },
      { id: 'google-drive', label: 'Google Drive', icon: HardDrive },
      { id: 'bug-desk', label: 'Bug Desk', icon: Bug }
    ]
  },
  {
    id: 'ai-writer',
    title: 'AI TEST WRITER',
    items: [
      { id: 'ai-documents', label: 'AI Documents', icon: FileText },
      { id: 'ai-requirements', label: 'Requirements Analysis', icon: ListChecks },
      { id: 'ai-test-writer', label: 'Test Case Generation', icon: Sparkles }
    ]
  },
  {
    id: 'execution',
    title: 'EXECUTION',
    items: [
      { id: 'run-test', label: 'Run PAD Test', icon: PlayCircle, highlight: true },
      { id: 'robo-test', label: 'Robo Test (Firebase)', icon: Bot },
      { id: 'mixpanel-validator', label: 'Mixpanel Validator', icon: FileSpreadsheet },
      { id: 'history', label: 'Test History', icon: History },
      { id: 'adb-ops', label: 'ADB Operations', icon: Terminal }
    ]
  },
  {
    id: 'resources',
    title: 'RESOURCES',
    items: [
      { id: 'remote-config', label: 'Remote Config', icon: Sliders },
      { id: 'sop', label: 'SOP Guide', icon: BookOpen },
      { id: 'diagnostics', label: 'System Diagnostics', icon: Activity }
    ]
  }
];

export default function Sidebar({
  currentTab,
  setTab,
  runningTestCount = 0,
  onOpenTourModal,
  currentUser,
  isCollapsed = false,
  onToggleCollapse
}) {
  const isAdmin = currentUser?.role === 'ADMIN';
  const aiEnabled = isAiTestWriterEnabled();
  const visibleNavGroups = NAV_GROUPS
    .filter((group) => group.id !== 'ai-writer' || aiEnabled)
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (item.id === 'diagnostics') {
          return isAdmin;
        }
        return true;
      })
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside
      className={`bg-white/80 backdrop-blur-md border-r border-[rgba(99,102,241,0.14)] dark:bg-[#090C12]/90 dark:border-[#161B26] flex flex-col shrink-0 select-none transition-[width] duration-200 ease-in-out relative ${
        isCollapsed ? 'w-[68px]' : 'w-64'
      }`}
      aria-label="Sidebar Navigation"
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {/* Top Header & Collapse Toggle */}
        <div
          className={`border-b border-[rgba(99,102,241,0.14)] dark:border-[#141824]/60 min-h-[55px] flex items-center transition-all ${
            isCollapsed ? 'p-2.5 justify-center' : 'p-3.5 justify-between'
          }`}
        >
          {!isCollapsed ? (
            <>
              <div className="flex items-center gap-3 min-w-0">
                <div className="brand-mark w-8 h-8 rounded-xl shadow-xs shrink-0">
                  <Activity className="w-4 h-4 text-white" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-extrabold text-[#1f2544] dark:text-white tracking-wider font-sans uppercase">QA PLATFORM</div>
                  <div
                    className="text-[10px] text-[#6b7194] dark:text-[#525A6C] font-mono tracking-wider"
                    title={GIT_COMMIT_HASH ? `Version ${APP_VERSION} (Commit: ${GIT_COMMIT_HASH})` : `Version ${APP_VERSION}`}
                  >
                    {SYS_VERSION}
                  </div>
                </div>
              </div>
              <Tooltip content="Collapse sidebar" side="right">
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label="Collapse sidebar"
                  aria-expanded={!isCollapsed}
                  className="p-1.5 rounded-xl text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50 dark:text-[#8F97A6] dark:hover:text-white dark:hover:bg-[#12151E] transition-colors cursor-pointer shrink-0"
                >
                  <PanelLeftClose className="w-4 h-4" />
                </button>
              </Tooltip>
            </>
          ) : (
            <Tooltip content="Expand sidebar" side="right">
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Expand sidebar"
                aria-expanded={!isCollapsed}
                className="w-10 h-10 rounded-xl btn-soft flex items-center justify-center transition-all cursor-pointer shadow-xs"
              >
                <PanelLeftOpen className="w-4 h-4 text-[#7c6cf6] dark:text-[#F59E0B]" />
              </button>
            </Tooltip>
          )}
        </div>

        {/* Navigation Sections */}
        <nav className={isCollapsed ? 'p-2 space-y-2' : 'p-3 space-y-3'}>
          {visibleNavGroups.map((group) => (
            <div key={group.id} className="space-y-1">
              {group.title && (
                !isCollapsed ? (
                  <div className="section-label px-3 pt-2 pb-1 text-[10px] font-bold">
                    {group.title}
                  </div>
                ) : (
                  <div className="border-t border-[rgba(99,102,241,0.14)] dark:border-[#161B26] mx-2 my-2" role="separator" />
                )
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;

                if (isCollapsed) {
                  return (
                    <Tooltip key={item.id} content={item.label} side="right">
                      <button
                        type="button"
                        onClick={() => setTab(item.id)}
                        aria-label={item.label}
                        className={`w-10 h-10 mx-auto rounded-xl flex items-center justify-center relative transition-all group cursor-pointer ${
                          isActive
                            ? 'bg-violet-100/90 border border-[#7c6cf6]/40 text-[#7c6cf6] shadow-xs dark:bg-[#16130C] dark:border-[#F59E0B]/50 dark:text-[#F59E0B]'
                            : 'text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50/70 dark:text-[#8F97A6] dark:hover:text-[#FFFFFF] dark:hover:bg-[#12151E]'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-[#7c6cf6] dark:text-[#F59E0B]' : 'text-[#6b7194] group-hover:text-[#1f2544] dark:text-[#64748B] dark:group-hover:text-[#94A3B8]'}`} />

                        {item.id === 'run-test' && runningTestCount > 0 && (
                          <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7c6cf6] dark:bg-[#F59E0B] opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#7c6cf6] dark:bg-[#F59E0B]"></span>
                          </span>
                        )}
                      </button>
                    </Tooltip>
                  );
                }

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all group cursor-pointer ${
                      isActive
                        ? 'bg-gradient-to-r from-violet-500/12 to-pink-500/12 border border-[#7c6cf6]/30 text-[#7c6cf6] font-bold shadow-xs dark:bg-[#16130C] dark:border-[#F59E0B]/50 dark:text-[#F59E0B]'
                        : 'text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50/70 dark:text-[#8F97A6] dark:hover:text-[#FFFFFF] dark:hover:bg-[#12151E]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-[#7c6cf6] dark:text-[#F59E0B]' : 'text-[#6b7194] group-hover:text-[#1f2544] dark:text-[#64748B] dark:group-hover:text-[#94A3B8]'}`} />
                      <span className="truncate">{item.label}</span>
                    </div>

                    {item.id === 'run-test' && runningTestCount > 0 && (
                      <span className="flex h-2 w-2 relative shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#7c6cf6] dark:bg-[#F59E0B] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#7c6cf6] dark:bg-[#F59E0B]"></span>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}

          {/* Administration Section */}
          {isAdmin && (
            <div className="space-y-1 pt-1">
              {!isCollapsed ? (
                <>
                  <div className="section-label px-3 pt-2 pb-1 text-[10px] font-bold text-[#7c6cf6] dark:text-[#F59E0B] flex items-center gap-1.5">
                    <ShieldCheck className="w-3 h-3" />
                    <span>ADMINISTRATION</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTab('admin-users')}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all group cursor-pointer ${
                      currentTab === 'admin-users'
                        ? 'bg-gradient-to-r from-violet-500/12 to-pink-500/12 border border-[#7c6cf6]/30 text-[#7c6cf6] font-bold shadow-xs dark:bg-[#16130C] dark:border-[#F59E0B]/50 dark:text-[#F59E0B]'
                        : 'text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50/70 dark:text-[#8F97A6] dark:hover:text-[#FFFFFF] dark:hover:bg-[#12151E]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <ShieldCheck className={`w-4 h-4 shrink-0 transition-colors ${currentTab === 'admin-users' ? 'text-[#7c6cf6] dark:text-[#F59E0B]' : 'text-[#6b7194] group-hover:text-[#1f2544] dark:text-[#64748B] dark:group-hover:text-[#94A3B8]'}`} />
                      <span className="truncate">User Management</span>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('admin-devices')}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all group cursor-pointer ${
                      currentTab === 'admin-devices'
                        ? 'bg-gradient-to-r from-violet-500/12 to-pink-500/12 border border-[#7c6cf6]/30 text-[#7c6cf6] font-bold shadow-xs dark:bg-[#16130C] dark:border-[#F59E0B]/50 dark:text-[#F59E0B]'
                        : 'text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50/70 dark:text-[#8F97A6] dark:hover:text-[#FFFFFF] dark:hover:bg-[#12151E]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Smartphone className={`w-4 h-4 shrink-0 transition-colors ${currentTab === 'admin-devices' ? 'text-[#7c6cf6] dark:text-[#F59E0B]' : 'text-[#6b7194] group-hover:text-[#1f2544] dark:text-[#64748B] dark:group-hover:text-[#94A3B8]'}`} />
                      <span className="truncate">Device Management</span>
                    </div>
                  </button>
                </>
              ) : (
                <>
                  <div className="border-t border-[rgba(99,102,241,0.14)] dark:border-[#161B26] mx-2 my-2" role="separator" />
                  <Tooltip content="User Management" side="right">
                    <button
                      type="button"
                      onClick={() => setTab('admin-users')}
                      aria-label="User Management"
                      className={`w-10 h-10 mx-auto rounded-xl flex items-center justify-center relative transition-all group cursor-pointer ${
                        currentTab === 'admin-users'
                          ? 'bg-violet-100/90 border border-[#7c6cf6]/40 text-[#7c6cf6] shadow-xs dark:bg-[#16130C] dark:border-[#F59E0B]/50 dark:text-[#F59E0B]'
                          : 'text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50/70 dark:text-[#8F97A6] dark:hover:text-[#FFFFFF] dark:hover:bg-[#12151E]'
                      }`}
                    >
                      <ShieldCheck className={`w-4 h-4 shrink-0 transition-colors ${currentTab === 'admin-users' ? 'text-[#7c6cf6] dark:text-[#F59E0B]' : 'text-[#6b7194] group-hover:text-[#1f2544] dark:text-[#64748B] dark:group-hover:text-[#94A3B8]'}`} />
                    </button>
                  </Tooltip>
                  <Tooltip content="Device Management" side="right">
                    <button
                      type="button"
                      onClick={() => setTab('admin-devices')}
                      aria-label="Device Management"
                      className={`w-10 h-10 mx-auto rounded-xl flex items-center justify-center relative transition-all group cursor-pointer ${
                        currentTab === 'admin-devices'
                          ? 'bg-violet-100/90 border border-[#7c6cf6]/40 text-[#7c6cf6] shadow-xs dark:bg-[#16130C] dark:border-[#F59E0B]/50 dark:text-[#F59E0B]'
                          : 'text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50/70 dark:text-[#8F97A6] dark:hover:text-[#FFFFFF] dark:hover:bg-[#12151E]'
                      }`}
                    >
                      <Smartphone className={`w-4 h-4 shrink-0 transition-colors ${currentTab === 'admin-devices' ? 'text-[#7c6cf6] dark:text-[#F59E0B]' : 'text-[#6b7194] group-hover:text-[#1f2544] dark:text-[#64748B] dark:group-hover:text-[#94A3B8]'}`} />
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          )}
        </nav>
      </div>
    </aside>
  );
}
