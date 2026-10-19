import React, { useState, useRef, useEffect } from 'react';
import { Smartphone, ShieldCheck, Activity, Cpu, Wifi, Compass, BookOpen, User, Lock, LogOut, LogIn, ChevronDown, CheckCircle, X, Mail, Shield, Bug, LayoutDashboard, FilePlus2, History, Settings, Repeat } from 'lucide-react';
import { DISPLAY_VERSION } from '../config/version';
import { formatDeviceDisplayName } from '../utils/deviceFormatter';
import DeviceThumbnail from './DeviceThumbnail';
import BugDeskRecordingControls from './BugDeskRecordingControls';

const BUG_DESK_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'new-bug', label: 'New Bug', icon: FilePlus2 },
  { id: 'history', label: 'Bug History', icon: History },
  { id: 'settings', label: 'Settings', icon: Settings },
];

export default function Header({
  currentUser,
  isAuthenticated,
  selectedDevice,
  diagnostics,
  onOpenPairModal,
  onOpenTourModal,
  onOpenAuthModal,
  onLogout,
  onNavigate,
  currentTab,
  bugDeskTab = 'dashboard',
  onSelectBugDeskTab,
  bugDeskModuleSettings,
  onOpenSwitchModule,
  onOpenMirror
}) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const menuRef = useRef(null);

  const isServerRunning = diagnostics?.server?.status === 'Running';
  const hasAdb = diagnostics?.tools?.adb?.available;
  const hasJava = diagnostics?.tools?.java?.available;
  const hasBundletool = diagnostics?.tools?.bundletool?.available;
  const allToolsReady = hasAdb && hasJava && hasBundletool;
  const currentDisplayVersion = diagnostics?.server?.displayVersion || DISPLAY_VERSION;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [userMenuOpen]);

  const getUserInitials = (user) => {
    if (!user) return 'QA';
    if (user.name) {
      const parts = user.name.trim().split(/\s+/);
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (user.email || 'U').slice(0, 2).toUpperCase();
  };

  return (
    <header className="h-14 bg-[#090C12] border-b border-[#161B26] px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm select-none">
      {/* Brand & Contextual Nav */}
      {currentTab === 'bug-desk' ? (
        <div className="flex items-center gap-6 min-w-0">
          {/* BugDesk Title & Icon */}
          <div className="flex items-center gap-2.5 shrink-0">
            <div className="w-8 h-8 rounded-lg bg-[#19150F] border border-[#78350F]/70 flex items-center justify-center text-[#F59E0B] font-bold shadow-inner shrink-0">
              <Bug className="w-4.5 h-4.5 text-[#F59E0B]" />
            </div>
            <div className="flex items-center gap-2">
              <h1 className="font-display font-bold text-[18px] text-white tracking-tight">
                BugDesk
              </h1>
            </div>
          </div>

          {/* Contextual BugDesk Navigation */}
          <nav className="flex items-center gap-1.5 p-1 rounded-xl bg-[#0B0F17] border border-[#161B26] overflow-x-auto">
            {BUG_DESK_NAV.map((tab) => {
              const Icon = tab.icon;
              const isActive = bugDeskTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onSelectBugDeskTab && onSelectBugDeskTab(tab.id)}
                  className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13.5px] font-medium transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#F59E0B] text-[#0A0D14] font-semibold shadow-xs'
                      : 'text-[#8F97A6] hover:text-[#FFFFFF] hover:bg-[#141B28]'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-[#0A0D14]' : 'text-[#64748B]'}`} />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#19150F] border border-[#78350F]/70 flex items-center justify-center text-[#F59E0B] font-bold shadow-inner shrink-0">
            <Activity className="w-4 h-4 text-[#F59E0B]" />
          </div>
          <div>
            <h1 className="font-bold text-[#FFFFFF] text-xs sm:text-sm tracking-wide flex items-center gap-2">
              Android PAD / ORD Testing
              <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#241A0E] text-[#F59E0B] border border-[#78350F] font-bold">
                {currentDisplayVersion}
              </span>
            </h1>
            <p className="text-[11px] text-[#64748B] hidden md:block">Play Asset Delivery & On-Demand Resources Automation</p>
          </div>
        </div>
      )}

      {/* Right Telemetry & Action Badges */}
      <div className="flex items-center gap-2.5 shrink-0">
        {/* App Tour Button */}
        <button
          onClick={onOpenTourModal}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#131109] hover:bg-[#20180B] border border-[#78350F]/60 text-[13px] text-[#F59E0B] hover:text-[#FBBF24] transition-all shadow-xs font-semibold cursor-pointer"
          title="Start Interactive Platform Tour"
        >
          <Compass className="w-3.5 h-3.5 text-[#F59E0B]" />
          <span>App Tour</span>
        </button>

        {/* In Bug Desk mode: Recording Controls + Active Module switcher pill */}
        {currentTab === 'bug-desk' ? (
          isAuthenticated ? (
            <>
              <BugDeskRecordingControls
                moduleSettings={bugDeskModuleSettings}
                onOpenMirror={onOpenMirror}
                selectedDevice={selectedDevice}
              />
              {bugDeskModuleSettings ? (
                <button
                  onClick={onOpenSwitchModule}
                  className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#10141D] hover:bg-[#161B26] border border-[#1A202E] hover:border-[#283247] text-[13px] text-[#CBD5E1] transition-colors shadow-xs group cursor-pointer"
                  title={`Active Module: ${bugDeskModuleSettings.project} / ${bugDeskModuleSettings.module}${bugDeskModuleSettings.round && bugDeskModuleSettings.round.trim() ? ` (${bugDeskModuleSettings.round.trim()})` : ''}\nClick to switch module`}
                >
                  <Repeat className="w-3.5 h-3.5 text-[#F59E0B] group-hover:rotate-180 transition-transform duration-300" />
                  <span className="font-semibold max-w-[140px] truncate text-white">
                    {bugDeskModuleSettings.project}
                  </span>
                  {bugDeskModuleSettings.round && bugDeskModuleSettings.round.trim() ? (
                    <span className="text-[11px] font-mono px-1.5 py-0.2 rounded bg-amber-500/20 text-[#F59E0B] border border-amber-500/30">
                      {bugDeskModuleSettings.round.trim()}
                    </span>
                  ) : null}
                </button>
              ) : (
                <button
                  onClick={onOpenSwitchModule}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#10141D] hover:bg-[#161B26] border border-[#1A202E] text-[13px] text-[#F59E0B] hover:text-[#FBBF24] transition-colors font-medium shadow-xs cursor-pointer"
                >
                  <Repeat className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span>Setup Module</span>
                </button>
              )}
            </>
          ) : null
        ) : (
          isAuthenticated && selectedDevice ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#10141D] border border-[#1A202E] text-xs text-[#CBD5E1] shadow-xs">
              <span className="w-2 h-2 rounded-full bg-[#10B981] animate-pulse shrink-0"></span>
              <DeviceThumbnail device={selectedDevice} size="xs" />
              <span
                className="font-semibold max-w-[200px] truncate text-[#FFFFFF]"
                title={formatDeviceDisplayName(selectedDevice)}
              >
                {formatDeviceDisplayName(selectedDevice)}
              </span>
              {selectedDevice.lock?.isLocked && (
                <span title={`Claimed by ${selectedDevice.lock.lockedBy}`}>
                  <Lock className="w-3 h-3 text-[#F59E0B]" />
                </span>
              )}
            </div>
          ) : isAuthenticated ? (
            <button
              onClick={onOpenPairModal}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#10141D] hover:bg-[#161B26] border border-[#1A202E] text-xs text-[#94A3B8] hover:text-[#FFFFFF] transition-colors font-medium shadow-xs"
            >
              <Wifi className="w-3.5 h-3.5 text-[#64748B]" />
              <span>Connect Device</span>
            </button>
          ) : null
        )}

        {/* Authenticated User Status with Dropdown Menu */}
        {isAuthenticated && currentUser ? (
          <div className="relative pl-1 border-l border-[#1A202E]" ref={menuRef}>
            <button
              onClick={() => setUserMenuOpen((prev) => !prev)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#10141D] hover:bg-[#161B26] border border-[#1A202E] hover:border-[#283247] text-xs text-[#CBD5E1] transition-all group shadow-xs cursor-pointer"
              title={`Logged in as ${currentUser.name || currentUser.email}`}
            >
              <div className="w-5 h-5 rounded-full bg-[#24190E] text-[#F59E0B] flex items-center justify-center font-bold text-[10px] border border-[#78350F]/70">
                {getUserInitials(currentUser)}
              </div>
              <span className="font-semibold max-w-[120px] truncate text-[#E2E8F0]">
                {currentUser.name || currentUser.email}
              </span>
              {currentUser.role === 'ADMIN' && (
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded bg-amber-500/20 text-[#F59E0B] border border-amber-500/30">
                  ADMIN
                </span>
              )}
              <ChevronDown className={`w-3.5 h-3.5 text-[#64748B] group-hover:text-[#94A3B8] transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* User Dropdown Menu Popover */}
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 w-72 rounded-xl bg-[#0F1420] border border-[#1E2638] shadow-2xl z-50 overflow-hidden animate-fadeIn">
                {/* User Header Info */}
                <div className="p-4 bg-[#141B2D] border-b border-[#1E2638]">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[#F59E0B]/20 border border-[#F59E0B]/30 flex items-center justify-center text-[#F59E0B] font-bold text-sm">
                      {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-sm text-[#FFFFFF] truncate">
                        {currentUser.name || 'QA Engineer'}
                      </div>
                      <div className="text-xs text-[#94A3B8] truncate flex items-center gap-1">
                        <Mail className="w-3 h-3 text-[#64748B] flex-shrink-0" />
                        <span className="truncate">{currentUser.email}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 mt-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30 flex items-center gap-1">
                      <Shield className="w-2.5 h-2.5" />
                      {currentUser.role || 'TESTER'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                      <CheckCircle className="w-2.5 h-2.5" />
                      Active
                    </span>
                  </div>
                </div>

                {/* Dropdown Options */}
                <div className="p-2 space-y-1">
                  {currentUser.role === 'ADMIN' && (
                    <button
                      onClick={() => {
                        setUserMenuOpen(false);
                        if (onNavigate) onNavigate('admin-users');
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-[#F59E0B] hover:text-[#FBBF24] hover:bg-[#F59E0B]/10 transition-colors text-left"
                    >
                      <ShieldCheck className="w-4 h-4 text-[#F59E0B]" />
                      <span>User Management</span>
                    </button>
                  )}

                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      setProfileModalOpen(true);
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs text-[#CBD5E1] hover:text-[#FFFFFF] hover:bg-[#1A2234] transition-colors text-left"
                  >
                    <User className="w-4 h-4 text-[#F59E0B]" />
                    <span>View Profile</span>
                  </button>


                  <button
                    onClick={() => {
                      setUserMenuOpen(false);
                      if (onLogout) onLogout();
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors text-left"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onOpenAuthModal}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-all"
          >
            <LogIn className="w-3.5 h-3.5 text-[#000000]" />
            <span>Sign In</span>
          </button>
        )}
      </div>

      {/* User Profile Modal */}
      {profileModalOpen && currentUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-2xl bg-[#0F1420] border border-[#1E2638] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-5 bg-[#141B2D] border-b border-[#1E2638]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-[#FFFFFF]">User Profile</h3>
                  <p className="text-xs text-[#94A3B8]">QA Testing Platform Account</p>
                </div>
              </div>
              <button
                onClick={() => setProfileModalOpen(false)}
                className="p-1.5 rounded-lg text-[#94A3B8] hover:text-[#FFFFFF] hover:bg-[#1E2638] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-[#141B2D] border border-[#1E2638]">
                <div className="w-14 h-14 rounded-full bg-[#F59E0B]/20 border border-[#F59E0B]/30 flex items-center justify-center text-[#F59E0B] font-bold text-xl">
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-bold text-[#FFFFFF] truncate">{currentUser.name}</div>
                  <div className="text-xs text-[#94A3B8] truncate">{currentUser.email}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/30">
                      {currentUser.role || 'TESTER'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      Active
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-[#1E2638] text-xs">
                  <span className="text-[#94A3B8]">User ID:</span>
                  <span className="font-mono text-[#CBD5E1] text-[11px]">{currentUser.id || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#1E2638] text-xs">
                  <span className="text-[#94A3B8]">Email Address:</span>
                  <span className="font-semibold text-[#CBD5E1]">{currentUser.email}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#1E2638] text-xs">
                  <span className="text-[#94A3B8]">Role / Permissions:</span>
                  <span className="font-mono uppercase font-semibold text-[#F59E0B]">{currentUser.role || 'TESTER'}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-[#1E2638] text-xs">
                  <span className="text-[#94A3B8]">Session Security:</span>
                  <span className="font-semibold text-emerald-400">HttpOnly Session Cookie (qa_session)</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end p-4 bg-[#141B2D] border-t border-[#1E2638]">
              <button
                onClick={() => setProfileModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-[#1E2638] hover:bg-[#2A344A] text-xs font-semibold text-[#FFFFFF] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
