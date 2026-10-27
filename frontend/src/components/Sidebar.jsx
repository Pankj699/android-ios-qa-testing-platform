import React, { useState, useEffect, useCallback } from 'react';
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
  Compass,
  ShieldCheck,
  HardDrive,
  Scan,
  FileSpreadsheet,
  Bug,
  PanelLeftClose,
  PanelLeftOpen,
  Sliders
} from 'lucide-react';

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
    id: 'execution',
    title: 'EXECUTION',
    items: [
      { id: 'run-test', label: 'Run PAD Test', icon: PlayCircle, highlight: true },
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
  const [tooltip, setTooltip] = useState(null);

  const showTooltip = useCallback((label, target) => {
    if (!isCollapsed || !target) return;
    const rect = target.getBoundingClientRect();
    setTooltip({
      label,
      top: rect.top + rect.height / 2,
      left: rect.right + 10
    });
  }, [isCollapsed]);

  const hideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  // Dismiss tooltip on Escape, click, or when focus/hover moves away
  useEffect(() => {
    if (!tooltip) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        hideTooltip();
      }
    };

    const handleClickOutside = () => {
      hideTooltip();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('click', handleClickOutside);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('click', handleClickOutside);
    };
  }, [tooltip, hideTooltip]);

  // Immediately clear tooltip if sidebar expands
  useEffect(() => {
    if (!isCollapsed) {
      setTooltip(null);
    }
  }, [isCollapsed]);

  return (
    <aside
      className={`bg-white/80 backdrop-blur-md border-r border-[rgba(99,102,241,0.14)] dark:bg-[#090C12]/90 dark:border-[#161B26] flex flex-col justify-between shrink-0 select-none transition-[width] duration-200 ease-in-out relative ${
        isCollapsed ? 'w-[68px]' : 'w-64'
      }`}
      aria-label="Sidebar Navigation"
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0" onScroll={hideTooltip}>
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
                  <div className="text-[10px] text-[#6b7194] dark:text-[#525A6C] font-mono tracking-wider">SYS.VER.1.1</div>
                </div>
              </div>
              <button
                type="button"
                onClick={onToggleCollapse}
                aria-label="Collapse sidebar"
                aria-expanded={!isCollapsed}
                title="Collapse sidebar"
                className="p-1.5 rounded-xl text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50 dark:text-[#8F97A6] dark:hover:text-white dark:hover:bg-[#12151E] transition-colors cursor-pointer shrink-0"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label="Expand sidebar"
              aria-expanded={!isCollapsed}
              title="Expand sidebar"
              onMouseEnter={(e) => showTooltip('Expand sidebar', e.currentTarget)}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip('Expand sidebar', e.currentTarget)}
              onBlur={hideTooltip}
              className="w-10 h-10 rounded-xl btn-soft flex items-center justify-center transition-all cursor-pointer shadow-xs"
            >
              <PanelLeftOpen className="w-4 h-4 text-[#7c6cf6] dark:text-[#F59E0B]" />
            </button>
          )}
        </div>

        {/* Navigation Sections */}
        <nav className={isCollapsed ? 'p-2 space-y-2' : 'p-3 space-y-3'}>
          {NAV_GROUPS.map((group) => (
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
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        hideTooltip();
                        setTab(item.id);
                      }}
                      onMouseEnter={(e) => showTooltip(item.label, e.currentTarget)}
                      onMouseLeave={hideTooltip}
                      onFocus={(e) => showTooltip(item.label, e.currentTarget)}
                      onBlur={hideTooltip}
                      aria-label={item.label}
                      title={item.label}
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
                  <button
                    type="button"
                    onClick={() => {
                      hideTooltip();
                      setTab('admin-users');
                    }}
                    onMouseEnter={(e) => showTooltip('User Management', e.currentTarget)}
                    onMouseLeave={hideTooltip}
                    onFocus={(e) => showTooltip('User Management', e.currentTarget)}
                    onBlur={hideTooltip}
                    aria-label="User Management"
                    title="User Management"
                    className={`w-10 h-10 mx-auto rounded-xl flex items-center justify-center relative transition-all group cursor-pointer ${
                      currentTab === 'admin-users'
                        ? 'bg-violet-100/90 border border-[#7c6cf6]/40 text-[#7c6cf6] shadow-xs dark:bg-[#16130C] dark:border-[#F59E0B]/50 dark:text-[#F59E0B]'
                        : 'text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50/70 dark:text-[#8F97A6] dark:hover:text-[#FFFFFF] dark:hover:bg-[#12151E]'
                    }`}
                  >
                    <ShieldCheck className={`w-4 h-4 shrink-0 transition-colors ${currentTab === 'admin-users' ? 'text-[#7c6cf6] dark:text-[#F59E0B]' : 'text-[#6b7194] group-hover:text-[#1f2544] dark:text-[#64748B] dark:group-hover:text-[#94A3B8]'}`} />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      hideTooltip();
                      setTab('admin-devices');
                    }}
                    onMouseEnter={(e) => showTooltip('Device Management', e.currentTarget)}
                    onMouseLeave={hideTooltip}
                    onFocus={(e) => showTooltip('Device Management', e.currentTarget)}
                    onBlur={hideTooltip}
                    aria-label="Device Management"
                    title="Device Management"
                    className={`w-10 h-10 mx-auto rounded-xl flex items-center justify-center relative transition-all group cursor-pointer ${
                      currentTab === 'admin-devices'
                        ? 'bg-violet-100/90 border border-[#7c6cf6]/40 text-[#7c6cf6] shadow-xs dark:bg-[#16130C] dark:border-[#F59E0B]/50 dark:text-[#F59E0B]'
                        : 'text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50/70 dark:text-[#8F97A6] dark:hover:text-[#FFFFFF] dark:hover:bg-[#12151E]'
                    }`}
                  >
                    <Smartphone className={`w-4 h-4 shrink-0 transition-colors ${currentTab === 'admin-devices' ? 'text-[#7c6cf6] dark:text-[#F59E0B]' : 'text-[#6b7194] group-hover:text-[#1f2544] dark:text-[#64748B] dark:group-hover:text-[#94A3B8]'}`} />
                  </button>
                </>
              )}
            </div>
          )}
        </nav>
      </div>

      {/* Footer info & App Tour Button */}
      <div
        className={`border-t border-[rgba(99,102,241,0.14)] dark:border-[#161B26] text-xs text-[#6b7194] dark:text-[#64748B] transition-all ${
          isCollapsed ? 'p-2.5 flex flex-col items-center gap-2' : 'p-3.5 space-y-3'
        }`}
      >
        {onOpenTourModal && (
          !isCollapsed ? (
            <button
              type="button"
              onClick={onOpenTourModal}
              className="w-full btn-soft py-2 px-3 text-xs shadow-xs cursor-pointer font-semibold"
            >
              <Compass className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#94A3B8]" />
              <span>Take App Tour</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onOpenTourModal}
              onMouseEnter={(e) => showTooltip('Take App Tour', e.currentTarget)}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip('Take App Tour', e.currentTarget)}
              onBlur={hideTooltip}
              aria-label="Take App Tour"
              title="Take App Tour"
              className="w-10 h-10 rounded-xl btn-soft flex items-center justify-center transition-all cursor-pointer shadow-xs"
            >
              <Compass className="w-4 h-4 text-[#7c6cf6] dark:text-[#94A3B8]" />
            </button>
          )
        )}

        {currentTab !== 'dashboard' && (
          !isCollapsed ? (
            <div className="pt-1">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-slate-500 dark:text-[#525A6C]">Backend Mode</span>
                <span className="text-emerald-600 dark:text-[#10B981] font-semibold font-mono">Host Execution</span>
              </div>
              <div className="mt-0.5 text-[10px] text-slate-400 dark:text-[#525A6C] font-mono flex items-center justify-between">
                <span>Bundletool 1.18.3</span>
                <span>Local Mock</span>
              </div>
            </div>
          ) : (
            <div
              className="py-1 cursor-default"
              onMouseEnter={(e) => showTooltip('Backend: Host Execution (Bundletool 1.18.3)', e.currentTarget)}
              onMouseLeave={hideTooltip}
              onFocus={(e) => showTooltip('Backend: Host Execution (Bundletool 1.18.3)', e.currentTarget)}
              onBlur={hideTooltip}
              tabIndex={0}
              role="status"
              aria-label="Backend: Host Execution (Bundletool 1.18.3)"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            </div>
          )
        )}
      </div>

      {/* Floating Dark-Themed Tooltip for Collapsed Sidebar */}
      {isCollapsed && tooltip && (
        <div
          role="tooltip"
          className="fixed z-50 pointer-events-none -translate-y-1/2 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white border border-slate-700 dark:bg-[#141824] dark:border-[#263248] text-xs font-semibold shadow-2xl whitespace-nowrap flex items-center animate-fadeIn"
          style={{
            top: `${tooltip.top}px`,
            left: `${tooltip.left}px`
          }}
        >
          <span className="absolute -left-1 w-2 h-2 bg-slate-900 border-l border-b border-slate-700 dark:bg-[#141824] dark:border-[#263248] rotate-45" />
          <span className="relative z-10">{tooltip.label}</span>
        </div>
      )}
    </aside>
  );
}
