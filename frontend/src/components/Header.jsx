import React, { useState, useRef, useEffect } from 'react';
import { Smartphone, ShieldCheck, Activity, Cpu, Wifi, Compass, BookOpen, User, Lock, LogOut, LogIn, ChevronDown, CheckCircle, X, Mail, Shield } from 'lucide-react';
import { DISPLAY_VERSION } from '../config/version';

export default function Header({
  currentUser,
  isAuthenticated,
  selectedDevice,
  diagnostics,
  onOpenPairModal,
  onOpenTourModal,
  onOpenAuthModal,
  onLogout,
  onNavigate
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

  return (
    <header className="h-16 bg-[#0D111A] border-b border-[#1E2638] px-6 flex items-center justify-between sticky top-0 z-30 shadow-sm">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[#261D10] border border-[#78350F] flex items-center justify-center text-[#F59E0B] font-bold">
          <Activity className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-bold text-[#FFFFFF] text-sm tracking-wide flex items-center gap-2">
            Android PAD / ORD Testing Platform
            <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-[#261D10] text-[#F59E0B] border border-[#78350F] font-bold">
              {currentDisplayVersion}
            </span>
          </h1>
          <p className="text-xs text-[#94A3B8]">Play Asset Delivery & On-Demand Resources Automation</p>
        </div>
      </div>

      {/* Right Telemetry & Action Badges */}
      <div className="flex items-center gap-2.5">
        {/* App Tour Button */}
        <button
          onClick={onOpenTourModal}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#261D10] hover:bg-[#3D2C15] border border-[#78350F] text-xs text-[#F59E0B] hover:text-[#FBBF24] transition-all shadow-sm font-semibold"
          title="Start Interactive Platform Tour"
        >
          <Compass className="w-3.5 h-3.5 text-[#F59E0B]" />
          <span>App Tour</span>
        </button>

        {/* SOP Guide Button */}
        <button
          onClick={() => onNavigate && onNavigate('sop')}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#131924] hover:bg-[#1E2638] border border-[#1E2638] text-xs text-[#94A3B8] hover:text-[#FFFFFF] transition-all shadow-sm font-medium"
          title="Open Standard Operating Procedure (SOP) Guide"
        >
          <BookOpen className="w-3.5 h-3.5 text-[#64748B]" />
          <span>SOP Guide</span>
        </button>

        {/* System Diagnostics status pill */}
        <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#131924] border border-[#1E2638] text-xs">
          <span className={`w-2 h-2 rounded-full ${allToolsReady ? 'bg-[#10B981] animate-pulse' : 'bg-[#F59E0B]'}`}></span>
          <span className="text-[#94A3B8] font-mono text-[11px]">
            {allToolsReady ? 'Host Tools Ready' : 'Tools Check Required'}
          </span>
        </div>

        {/* Selected Device pill */}
        {isAuthenticated && selectedDevice ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#131924] border border-[#1E2638] text-xs text-[#CBD5E1]">
            <Smartphone className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span className="font-semibold max-w-[120px] truncate text-[#FFFFFF]">{selectedDevice.model || selectedDevice.name || selectedDevice.serial}</span>
            {selectedDevice.lock?.isLocked && (
              <span title={`Claimed by ${selectedDevice.lock.lockedBy}`}>
                <Lock className="w-3 h-3 text-[#F59E0B]" />
              </span>
            )}
            <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]"></span>
          </div>
        ) : isAuthenticated ? (
          <button
            onClick={onOpenPairModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#131924] hover:bg-[#1E2638] border border-[#1E2638] text-xs text-[#94A3B8] hover:text-[#FFFFFF] transition-colors font-medium"
          >
            <Wifi className="w-3.5 h-3.5 text-[#64748B]" />
            <span>Connect Device</span>
          </button>
        ) : null}

        {/* Authenticated User Status with Dropdown Menu */}
        {isAuthenticated && currentUser ? (
          <div className="relative pl-1 border-l border-[#1E2638]" ref={menuRef}>
            <button
              onClick={() => setUserMenuOpen((prev) => !prev)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#131924] hover:bg-[#1A2234] border border-[#1E2638] hover:border-[#2A344A] text-xs text-[#CBD5E1] transition-all group shadow-sm"
              title={`Logged in as ${currentUser.name || currentUser.email}`}
            >
              <div className="w-5 h-5 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] flex items-center justify-center font-bold text-[10px] border border-[#F59E0B]/30">
                {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
              </div>
              <span className="font-semibold max-w-[110px] truncate text-[#E2E8F0]">
                {currentUser.name || currentUser.email}
              </span>
              {currentUser.role === 'ADMIN' && (
                <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-[#F59E0B] border border-amber-500/30">
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
