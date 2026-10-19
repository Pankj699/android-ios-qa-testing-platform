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
  Compass,
  ShieldCheck,
  HardDrive,
  Scan,
  FileSpreadsheet,
  Bug
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
      { id: 'sop', label: 'SOP Guide', icon: BookOpen },
      { id: 'diagnostics', label: 'System Diagnostics', icon: Activity }
    ]
  }
];

export default function Sidebar({ currentTab, setTab, runningTestCount = 0, onOpenTourModal, currentUser }) {
  const isAdmin = currentUser?.role === 'ADMIN';

  return (
    <aside className="w-64 bg-[#090C12] border-r border-[#161B26] flex flex-col justify-between shrink-0 select-none">
      <div className="flex-1 overflow-y-auto">
        {/* Top Branding matching Screenshot 1 */}
        <div className="p-4 flex items-center gap-3 border-b border-[#141824]/60">
          <div className="w-8 h-8 rounded-lg bg-[#19150F] border border-[#78350F]/70 flex items-center justify-center text-[#F59E0B] shadow-inner shrink-0">
            <Activity className="w-4 h-4 text-[#F59E0B]" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-white tracking-wider font-sans uppercase">QA PLATFORM</div>
            <div className="text-[10px] text-[#525A6C] font-mono tracking-wider">SYS.VER.1.1</div>
          </div>
        </div>

        {/* Navigation Sections */}
        <nav className="p-3 space-y-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.id} className="space-y-1">
              {group.title && (
                <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[#525A6C] uppercase tracking-wider font-sans">
                  {group.title}
                </div>
              )}
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.id;

                return (
                  <button
                    key={item.id}
                    onClick={() => setTab(item.id)}
                    className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all group ${
                      isActive
                        ? 'bg-[#16130C] border border-[#F59E0B]/50 text-[#F59E0B] shadow-xs'
                        : 'text-[#8F97A6] hover:text-[#FFFFFF] hover:bg-[#12151E]'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-[#F59E0B]' : 'text-[#64748B] group-hover:text-[#94A3B8]'}`} />
                      <span className="truncate">{item.label}</span>
                    </div>

                    {item.id === 'run-test' && runningTestCount > 0 && (
                      <span className="flex h-2 w-2 relative shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F59E0B] opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F59E0B]"></span>
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
              <div className="px-3 pt-2 pb-1 text-[10px] font-semibold text-[#F59E0B] uppercase tracking-wider font-sans flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3" />
                <span>ADMINISTRATION</span>
              </div>
              <button
                onClick={() => setTab('admin-users')}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all group ${
                  currentTab === 'admin-users'
                    ? 'bg-[#16130C] border border-[#F59E0B]/50 text-[#F59E0B] shadow-xs'
                    : 'text-[#8F97A6] hover:text-[#FFFFFF] hover:bg-[#12151E]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <ShieldCheck className={`w-4 h-4 shrink-0 transition-colors ${currentTab === 'admin-users' ? 'text-[#F59E0B]' : 'text-[#64748B] group-hover:text-[#94A3B8]'}`} />
                  <span className="truncate">User Management</span>
                </div>
              </button>
              <button
                onClick={() => setTab('admin-devices')}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all group ${
                  currentTab === 'admin-devices'
                    ? 'bg-[#16130C] border border-[#F59E0B]/50 text-[#F59E0B] shadow-xs'
                    : 'text-[#8F97A6] hover:text-[#FFFFFF] hover:bg-[#12151E]'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Smartphone className={`w-4 h-4 shrink-0 transition-colors ${currentTab === 'admin-devices' ? 'text-[#F59E0B]' : 'text-[#64748B] group-hover:text-[#94A3B8]'}`} />
                  <span className="truncate">Device Management</span>
                </div>
              </button>
            </div>
          )}
        </nav>
      </div>

      {/* Footer info & App Tour Button */}
      <div className="p-4 border-t border-[#161B26] text-xs text-[#64748B] space-y-3">
        {onOpenTourModal && (
          <button
            onClick={onOpenTourModal}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-[#0D1017] hover:bg-[#151A25] border border-[#1C2230] text-[#94A3B8] hover:text-[#FFFFFF] font-medium transition-all text-xs shadow-xs"
          >
            <Compass className="w-3.5 h-3.5 text-[#94A3B8]" />
            <span>Take App Tour</span>
          </button>
        )}

        {currentTab !== 'dashboard' && (
          <div className="pt-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-[#525A6C]">Backend Mode</span>
              <span className="text-[#10B981] font-semibold font-mono">Host Execution</span>
            </div>
            <div className="mt-0.5 text-[10px] text-[#525A6C] font-mono flex items-center justify-between">
              <span>Bundletool 1.18.3</span>
              <span>Local Mock</span>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
