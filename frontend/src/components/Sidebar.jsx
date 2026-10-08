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
  Settings,
  ShieldCheck
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'devices', label: 'Devices', icon: Smartphone },
  { id: 'screen-mirror', label: 'Screen Mirror', icon: Tv },
  { id: 'builds', label: 'Builds & AAB', icon: Package },
  { id: 'run-test', label: 'Run PAD Test', icon: PlayCircle, highlight: true },
  { id: 'history', label: 'Test History', icon: History },
  { id: 'adb-ops', label: 'ADB Operations', icon: Terminal },
  { id: 'sop', label: 'SOP Guide', icon: BookOpen },
  { id: 'diagnostics', label: 'System Diagnostics', icon: Activity }
];

export default function Sidebar({ currentTab, setTab, runningTestCount = 0, onOpenTourModal, currentUser }) {
  const isAdmin = currentUser?.role === 'ADMIN';

  return (
    <aside className="w-64 bg-[#0D111A] border-r border-[#1E2638] flex flex-col justify-between shrink-0">
      <div className="p-4 space-y-1">
        <div className="px-3 py-2 text-[10px] font-semibold text-[#64748B] uppercase tracking-wider font-mono">
          QA Platform
        </div>

        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => setTab(item.id)}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all ${
                  isActive
                    ? 'bg-[#F59E0B] text-[#000000] shadow-sm'
                    : 'text-[#94A3B8] hover:bg-[#131924] hover:text-[#FFFFFF]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#000000]' : 'text-[#64748B]'}`} />
                  <span>{item.label}</span>
                </div>

                {item.id === 'run-test' && runningTestCount > 0 && (
                  <span className="flex h-2 w-2 relative">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#F59E0B] opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-[#F59E0B]"></span>
                  </span>
                )}
              </button>
            );
          })}

          {isAdmin && (
            <div className="pt-3 mt-3 border-t border-[#1E2638]">
              <div className="px-3 py-1.5 text-[10px] font-semibold text-[#F59E0B] uppercase tracking-wider font-mono flex items-center gap-1.5">
                <ShieldCheck className="w-3 h-3" />
                <span>Administration</span>
              </div>
              <button
                onClick={() => setTab('admin-users')}
                className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-lg text-xs font-semibold transition-all mt-1 ${
                  currentTab === 'admin-users'
                    ? 'bg-[#F59E0B] text-[#000000] shadow-sm'
                    : 'text-[#94A3B8] hover:bg-[#131924] hover:text-[#FFFFFF]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <ShieldCheck className={`w-4 h-4 ${currentTab === 'admin-users' ? 'text-[#000000]' : 'text-[#F59E0B]'}`} />
                  <span>User Management</span>
                </div>
              </button>
            </div>
          )}
        </nav>
      </div>

      {/* Footer info & App Tour Button */}
      <div className="p-4 border-t border-[#1E2638] text-xs text-[#64748B] space-y-3">
        {onOpenTourModal && (
          <button
            onClick={onOpenTourModal}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-[#261D10] hover:bg-[#3D2C15] border border-[#78350F] text-[#F59E0B] hover:text-[#FBBF24] font-semibold transition-all text-xs"
          >
            <Compass className="w-4 h-4 text-[#F59E0B]" />
            <span>Take App Tour</span>
          </button>
        )}

        <div className="pt-1">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-[#94A3B8]">Backend Mode</span>
            <span className="text-[#10B981] font-semibold font-mono">Host Execution</span>
          </div>
          <div className="mt-0.5 text-[10px] text-[#64748B] font-mono">
            Bundletool 1.18.3 • Local Mock
          </div>
        </div>
      </div>
    </aside>
  );
}
