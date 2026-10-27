import React, { useState, useRef, useEffect } from 'react';
import { Smartphone, ShieldCheck, Activity, Cpu, Wifi, Compass, BookOpen, User, Lock, LogOut, LogIn, ChevronDown, CheckCircle, Check, Usb, X, Mail, Shield, Bug, LayoutDashboard, FilePlus2, History, Settings, Repeat, Sun, Moon, Sliders } from 'lucide-react';
import { DISPLAY_VERSION } from '../config/version';
import { formatDeviceDisplayName, formatDeviceOsVersion } from '../utils/deviceFormatter';
import DeviceThumbnail from './DeviceThumbnail';
import BugDeskRecordingControls from './BugDeskRecordingControls';
import { useTheme } from '../context/ThemeContext';

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
  devices = [],
  onSelectDevice,
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
  onOpenMirror,
  remoteConfigPlatform = 'android'
}) {
  const { theme, toggleTheme } = useTheme();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [deviceMenuOpen, setDeviceMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const deviceMenuRef = useRef(null);

  // Filter connected and available devices
  const connectedDevices = React.useMemo(() => {
    const list = (devices || []).filter(
      (d) => d && (d.connected ?? true) && (d.platform === 'ios' || !d.state || d.state === 'device') && !d.serial?.includes('_adb-tls-') && !d.serial?.includes('._tcp')
    );
    if (selectedDevice && !list.some((d) => d.serial === selectedDevice.serial)) {
      list.unshift(selectedDevice);
    }
    return list;
  }, [devices, selectedDevice]);

  // Close device menu on outside click or escape
  useEffect(() => {
    function handleClickOutside(event) {
      if (deviceMenuRef.current && !deviceMenuRef.current.contains(event.target)) {
        setDeviceMenuOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setDeviceMenuOpen(false);
      }
    }
    if (deviceMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [deviceMenuOpen]);

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
    <header className="sticky top-0 z-30 select-none bg-inherit">
      {/* ── Tier 1: Main Topbar (56px) ── */}
      <div className="h-[56px] topbar px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-4 relative z-20">
        {/* Left: Brand / Title & BugDesk Navigation */}
        {currentTab === 'bug-desk' ? (
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 mr-2">
            <div className="brand-mark shrink-0" title="BugDesk">
              <Bug className="w-5 h-5 text-white" />
            </div>
            {/* BugDesk Navigation Tabs in Main Header Row */}
            <nav className="flex items-center gap-1 sm:gap-1.5 overflow-x-auto py-1 scrollbar-none">
              {BUG_DESK_NAV.map((tab) => {
                const Icon = tab.icon;
                const isActive = bugDeskTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => onSelectBugDeskTab && onSelectBugDeskTab(tab.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all whitespace-nowrap cursor-pointer shrink-0 ${
                      isActive
                        ? 'btn-magic text-white shadow-xs'
                        : 'text-[#6b7194] hover:text-[#1f2544] hover:bg-violet-50/70 dark:text-[#8F97A6] dark:hover:text-[#FFFFFF] dark:hover:bg-[#141B28]'
                    }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-[#6b7194] dark:text-[#64748B]'}`} />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        ) : (
          <div
            className="flex items-center gap-2.5 min-w-0 shrink-0 cursor-pointer"
            onClick={() => onNavigate && onNavigate('dashboard')}
            title="QA Platform"
          >
            <div className="brand-mark shrink-0">
              <Activity className="w-5 h-5 text-white" />
            </div>
            <span className="font-extrabold text-[#1f2544] dark:text-white text-sm tracking-tight hidden sm:inline">
              QA Platform
            </span>
          </div>
        )}

        {/* Right: Global Controls & Actions */}
        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          {/* Selected Device Selector */}
          {isAuthenticated && selectedDevice ? (
            <div className="relative shrink-0" ref={deviceMenuRef}>
              <button
                type="button"
                onClick={() => {
                  if (connectedDevices.length > 1) {
                    setDeviceMenuOpen((prev) => !prev);
                  }
                }}
                disabled={connectedDevices.length <= 1}
                className={`h-9 px-2.5 rounded-xl border border-[rgba(99,102,241,0.14)] dark:border-[#1E2638] bg-white/70 dark:bg-[#0B0F17] flex items-center gap-2 max-w-[155px] sm:max-w-[210px] shadow-xs shrink-0 text-left transition-all ${
                  connectedDevices.length > 1
                    ? 'cursor-pointer hover:border-[rgba(99,102,241,0.3)] dark:hover:border-[#2E3A52] hover:bg-white/90 dark:hover:bg-[#101522] focus:outline-none focus:ring-1 focus:ring-violet-500/50'
                    : 'cursor-default'
                }`}
                title={
                  connectedDevices.length > 1
                    ? `${formatDeviceDisplayName(selectedDevice)} (Click to switch device)`
                    : formatDeviceDisplayName(selectedDevice)
                }
                aria-label={
                  connectedDevices.length > 1
                    ? `Current device: ${formatDeviceDisplayName(selectedDevice)}. Click to switch device.`
                    : `Current device: ${formatDeviceDisplayName(selectedDevice)}`
                }
                aria-haspopup={connectedDevices.length > 1 ? 'listbox' : undefined}
                aria-expanded={connectedDevices.length > 1 ? deviceMenuOpen : undefined}
              >
                <span className="dot ok shrink-0"></span>
                <DeviceThumbnail device={selectedDevice} size="xs" />
                <span className="font-semibold text-xs text-[#1f2544] dark:text-white truncate max-w-[75px] sm:max-w-[110px]">
                  {formatDeviceDisplayName(selectedDevice)}
                </span>
                {selectedDevice.lock?.isLocked && (
                  <span title={`Claimed by ${selectedDevice.lock.lockedBy}`} className="shrink-0">
                    <Lock className="w-3 h-3 text-[#7c6cf6] dark:text-violet-400" />
                  </span>
                )}
                {connectedDevices.length > 1 && (
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-[#6b7194] dark:text-[#8F97A6] shrink-0 transition-transform duration-200 ml-auto ${
                      deviceMenuOpen ? 'rotate-180' : ''
                    }`}
                  />
                )}
              </button>

              {/* Custom Device Selection Dropdown */}
              {deviceMenuOpen && connectedDevices.length > 1 && (
                <div
                  className="absolute right-0 sm:left-0 mt-2 w-72 sm:w-80 rounded-2xl bg-white/95 dark:bg-[#0D111A]/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden animate-fadeIn border border-[rgba(99,102,241,0.18)] dark:border-[#1E2638] p-2 space-y-1.5"
                  role="listbox"
                  aria-label="Select Device"
                >
                  <div className="px-2.5 py-1.5 flex items-center justify-between border-b border-[rgba(99,102,241,0.1)] dark:border-[#1C2230]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#6B7194] dark:text-[#8F97A6] flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-violet-400" />
                      <span>Select Device</span>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-[#7c6cf6] dark:bg-violet-500/15 dark:text-violet-300">
                      {connectedDevices.length} available
                    </span>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-1 py-0.5 pr-0.5">
                    {connectedDevices.map((dev) => {
                      const isSelected = selectedDevice?.serial === dev.serial;
                      const osVer = formatDeviceOsVersion(dev);
                      const isBrowserUsb = dev.connectionMode === 'browser-usb' || dev.serial?.startsWith('browser_usb_');
                      const isAgentUsb = dev.connectionMode === 'agent-usb' || !!dev.agentId;
                      const isWireless = dev.isWireless || dev.connectionMode === 'browser-wireless' || (dev.serial && /:\d+$/.test(dev.serial));
                      const connLabel = dev.platform === 'ios'
                        ? 'Apple USB'
                        : isBrowserUsb
                        ? 'Browser USB'
                        : isAgentUsb
                        ? 'Agent USB'
                        : isWireless
                        ? 'Wi-Fi'
                        : 'USB';

                      return (
                        <button
                          key={dev.serial}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => {
                            if (onSelectDevice) {
                              onSelectDevice(dev);
                            }
                            setDeviceMenuOpen(false);
                          }}
                          className={`w-full p-2 rounded-xl text-left transition-all flex items-start gap-2.5 cursor-pointer ${
                            isSelected
                              ? 'bg-purple-50 text-purple-900 border border-purple-200/80 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30'
                              : 'hover:bg-slate-100/80 text-slate-700 dark:text-slate-200 dark:hover:bg-[#141B28] border border-transparent'
                          }`}
                        >
                          <div className="pt-0.5 shrink-0">
                            <DeviceThumbnail device={dev} size="xs" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-1.5">
                              <span className={`text-xs font-bold truncate ${
                                isSelected ? 'text-[#7c6cf6] dark:text-violet-300' : 'text-[#1F2544] dark:text-white'
                              }`}>
                                {formatDeviceDisplayName(dev)}
                              </span>
                              {isSelected && (
                                <Check className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-violet-400 shrink-0 ml-1.5" />
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              {/* Connection Status Indicator */}
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <span className="dot ok w-1.5 h-1.5"></span>
                                Connected
                              </span>

                              {/* Connection Type */}
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.2 rounded bg-slate-100 dark:bg-[#1A2234] text-[#6B7194] dark:text-[#94A3B8] border border-slate-200/60 dark:border-[#222C42]">
                                {isWireless ? <Wifi className="w-2.5 h-2.5 text-cyan-500" /> : <Usb className="w-2.5 h-2.5 text-purple-500" />}
                                {connLabel}
                              </span>

                              {/* OS Version */}
                              {osVer && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 dark:bg-violet-500/10 dark:text-violet-300 border border-purple-200/50 dark:border-violet-500/20">
                                  {osVer}
                                </span>
                              )}
                            </div>

                            {/* Serial */}
                            <div className="text-[10.5px] font-mono text-[#6B7194] dark:text-[#64748B] truncate mt-0.5">
                              {dev.serial}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : isAuthenticated && connectedDevices.length > 0 ? (
            <div className="relative shrink-0" ref={deviceMenuRef}>
              <button
                type="button"
                onClick={() => setDeviceMenuOpen((prev) => !prev)}
                className="btn-soft text-xs h-9 px-2.5 lg:px-3 rounded-xl cursor-pointer shadow-xs shrink-0 flex items-center gap-1.5"
                title="Select a connected device"
                aria-label="Select Device"
              >
                <Smartphone className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-violet-400" />
                <span>Select Device</span>
                <ChevronDown className="w-3.5 h-3.5 text-[#6b7194] dark:text-[#8F97A6]" />
              </button>

              {deviceMenuOpen && (
                <div
                  className="absolute right-0 sm:left-0 mt-2 w-72 sm:w-80 rounded-2xl bg-white/95 dark:bg-[#0D111A]/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden animate-fadeIn border border-[rgba(99,102,241,0.18)] dark:border-[#1E2638] p-2 space-y-1.5"
                  role="listbox"
                  aria-label="Select Device"
                >
                  <div className="px-2.5 py-1.5 flex items-center justify-between border-b border-[rgba(99,102,241,0.1)] dark:border-[#1C2230]">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-[#6B7194] dark:text-[#8F97A6] flex items-center gap-1.5">
                      <Smartphone className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-violet-400" />
                      <span>Select Device</span>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-[#7c6cf6] dark:bg-violet-500/15 dark:text-violet-300">
                      {connectedDevices.length} available
                    </span>
                  </div>

                  <div className="max-h-64 overflow-y-auto space-y-1 py-0.5 pr-0.5">
                    {connectedDevices.map((dev) => {
                      const osVer = formatDeviceOsVersion(dev);
                      const isBrowserUsb = dev.connectionMode === 'browser-usb' || dev.serial?.startsWith('browser_usb_');
                      const isAgentUsb = dev.connectionMode === 'agent-usb' || !!dev.agentId;
                      const isWireless = dev.isWireless || dev.connectionMode === 'browser-wireless' || (dev.serial && /:\d+$/.test(dev.serial));
                      const connLabel = dev.platform === 'ios'
                        ? 'Apple USB'
                        : isBrowserUsb
                        ? 'Browser USB'
                        : isAgentUsb
                        ? 'Agent USB'
                        : isWireless
                        ? 'Wi-Fi'
                        : 'USB';

                      return (
                        <button
                          key={dev.serial}
                          type="button"
                          role="option"
                          onClick={() => {
                            if (onSelectDevice) {
                              onSelectDevice(dev);
                            }
                            setDeviceMenuOpen(false);
                          }}
                          className="w-full p-2 rounded-xl text-left transition-all flex items-start gap-2.5 cursor-pointer hover:bg-slate-100/80 text-slate-700 dark:text-slate-200 dark:hover:bg-[#141B28] border border-transparent"
                        >
                          <div className="pt-0.5 shrink-0">
                            <DeviceThumbnail device={dev} size="xs" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold truncate text-[#1F2544] dark:text-white block">
                              {formatDeviceDisplayName(dev)}
                            </span>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <span className="dot ok w-1.5 h-1.5"></span>
                                Connected
                              </span>
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.2 rounded bg-slate-100 dark:bg-[#1A2234] text-[#6B7194] dark:text-[#94A3B8] border border-slate-200/60 dark:border-[#222C42]">
                                {isWireless ? <Wifi className="w-2.5 h-2.5 text-cyan-500" /> : <Usb className="w-2.5 h-2.5 text-purple-500" />}
                                {connLabel}
                              </span>
                              {osVer && (
                                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 dark:bg-violet-500/10 dark:text-violet-300 border border-purple-200/50 dark:border-violet-500/20">
                                  {osVer}
                                </span>
                              )}
                            </div>
                            <div className="text-[10.5px] font-mono text-[#6B7194] dark:text-[#64748B] truncate mt-0.5">
                              {dev.serial}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ) : isAuthenticated ? (
            <button
              type="button"
              onClick={onOpenPairModal}
              className="btn-soft text-xs h-9 px-2.5 lg:px-3 rounded-xl cursor-pointer shadow-xs shrink-0 flex items-center gap-1.5"
              title="Connect an Android device"
              aria-label="Connect Device"
            >
              <Wifi className="w-3.5 h-3.5 text-[#6b7194] dark:text-[#64748B]" />
              <span className="hidden xl:inline">Connect Device</span>
            </button>
          ) : null}

          {/* Device Actions (Mirror & Recording) */}
          {isAuthenticated && (
            <BugDeskRecordingControls
              moduleSettings={bugDeskModuleSettings}
              onOpenMirror={onOpenMirror}
              selectedDevice={selectedDevice}
            />
          )}

          {/* In Bug Desk mode: Active Module / Project Switcher (Icon Only) */}
          {currentTab === 'bug-desk' && isAuthenticated && (
            <button
              type="button"
              onClick={onOpenSwitchModule}
              className="btn-soft w-10 h-10 rounded-xl shadow-xs group cursor-pointer shrink-0 flex items-center justify-center p-0"
              title={
                bugDeskModuleSettings && (bugDeskModuleSettings.project || bugDeskModuleSettings.module)
                  ? `Active Project: ${bugDeskModuleSettings.project || ''} / ${bugDeskModuleSettings.module || ''}${bugDeskModuleSettings.round && bugDeskModuleSettings.round.trim() ? ` (${bugDeskModuleSettings.round.trim()})` : ''}\nClick to switch project`
                  : 'Switch project'
              }
              aria-label="Switch project"
            >
              <Repeat
                className="w-[21px] h-[21px] stroke-[2.2] text-[#7c6cf6] dark:text-violet-400 group-hover:rotate-180 transition-transform duration-300"
                strokeWidth={2.2}
              />
            </button>
          )}

          {/* Accessible Theme Icon Toggle (approx 40px square, 22-24px icon) */}
          <button
            type="button"
            onClick={toggleTheme}
            className="w-10 h-10 rounded-xl btn-soft flex items-center justify-center cursor-pointer shadow-xs shrink-0 transition-all p-0"
            title={theme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'}
            aria-label={theme === 'dark' ? 'Switch to Light theme' : 'Switch to Dark theme'}
          >
            {theme === 'dark' ? (
              <Sun
                className="w-[23px] h-[23px] stroke-[2.2] text-amber-400"
                strokeWidth={2.2}
              />
            ) : (
              <Moon
                className="w-[23px] h-[23px] stroke-[2.2] text-[#7c6cf6]"
                strokeWidth={2.2}
              />
            )}
          </button>

          {/* User Status Dropdown (Icon Only) or Sign In */}
          {isAuthenticated && currentUser ? (
            <div className="relative pl-1 border-l border-[rgba(99,102,241,0.14)] dark:border-[#1A202E]" ref={menuRef}>
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                className="btn-soft w-10 h-10 rounded-xl cursor-pointer shadow-xs flex items-center justify-center p-0 shrink-0"
                title={`User profile: ${currentUser.name || currentUser.email}`}
                aria-label="User profile"
              >
                <User
                  className="w-[21px] h-[21px] stroke-[2.2] text-[#7c6cf6] dark:text-violet-400"
                  strokeWidth={2.2}
                />
              </button>

              {/* User Dropdown Popover */}
              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-2xl bg-white/95 dark:bg-[#0D111A]/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden animate-fadeIn p-0 border border-[rgba(99,102,241,0.18)] dark:border-[#1E2638]">
                  {/* User Header Info */}
                  <div className="p-4 bg-white/50 border-b border-[rgba(99,102,241,0.14)] dark:bg-[#141B2D] dark:border-[#1E2638]">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-violet-100 text-[#7c6cf6] dark:bg-violet-500/20 dark:border-violet-500/30 flex items-center justify-center dark:text-violet-400 font-bold text-sm">
                        {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-sm text-[#1f2544] dark:text-[#FFFFFF] truncate">
                          {currentUser.name || 'QA Engineer'}
                        </div>
                        <div className="text-xs text-[#6b7194] dark:text-[#94A3B8] truncate flex items-center gap-1">
                          <Mail className="w-3 h-3 text-[#6b7194] dark:text-[#64748B] flex-shrink-0" />
                          <span className="truncate">{currentUser.email}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-3">
                      <span className="chip-badge text-[10px] py-0.5 px-2 flex items-center gap-1">
                        <Shield className="w-2.5 h-2.5" />
                        {currentUser.role || 'TESTER'}
                      </span>
                      <span className="status-pill text-[10px] py-0.5 px-2 text-emerald-600 flex items-center gap-1">
                        <span className="dot ok"></span>
                        Active
                      </span>
                    </div>
                  </div>

                  {/* Dropdown Options */}
                  <div className="p-2 space-y-1">
                    {/* Relocated App Tour Item */}
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        if (onOpenTourModal) onOpenTourModal();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#1f2544] hover:bg-violet-50/60 dark:text-[#CBD5E1] dark:hover:text-[#FFFFFF] dark:hover:bg-[#1A2234] transition-colors text-left cursor-pointer"
                    >
                      <Compass className="w-4 h-4 text-[#7c6cf6] dark:text-violet-400" />
                      <span>Platform Tour</span>
                    </button>

                    {currentUser.role === 'ADMIN' && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          if (onNavigate) onNavigate('admin-users');
                        }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-[#7c6cf6] hover:bg-violet-50 dark:text-violet-400 dark:hover:text-violet-300 dark:hover:bg-violet-500/10 transition-colors text-left cursor-pointer"
                      >
                        <ShieldCheck className="w-4 h-4 text-[#7c6cf6] dark:text-violet-400" />
                        <span>User Management</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        setProfileModalOpen(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs text-[#1f2544] hover:bg-violet-50/60 dark:text-[#CBD5E1] dark:hover:text-[#FFFFFF] dark:hover:bg-[#1A2234] transition-colors text-left cursor-pointer"
                    >
                      <User className="w-4 h-4 text-[#7c6cf6] dark:text-violet-400" />
                      <span>View Profile</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        if (onLogout) onLogout();
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-300 dark:hover:bg-rose-500/10 transition-colors text-left cursor-pointer"
                    >
                      <LogOut className="w-4 h-4" />
                      <span>Sign Out</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 pl-1 border-l border-[rgba(99,102,241,0.14)] dark:border-[#1A202E]">
              <button
                type="button"
                onClick={onOpenTourModal}
                className="w-9 h-9 rounded-xl btn-soft flex items-center justify-center cursor-pointer shadow-xs shrink-0 p-0"
                title="Start Interactive Platform Tour"
                aria-label="Start Interactive Platform Tour"
              >
                <Compass className="w-4 h-4 text-[#7c6cf6] dark:text-violet-400" />
              </button>
              <button
                type="button"
                onClick={onOpenAuthModal}
                className="btn-magic text-xs font-bold h-9 px-3.5 rounded-xl shadow-magic cursor-pointer flex items-center gap-1.5 shrink-0"
              >
                <LogIn className="w-3.5 h-3.5 text-white" />
                <span>Sign In</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* User Profile Modal */}
      {profileModalOpen && currentUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md rounded-2xl bg-white dark:bg-[#0F1420] border border-slate-200 dark:border-[#1E2638] shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-5 bg-slate-50 dark:bg-[#141B2D] border-b border-slate-200 dark:border-[#1E2638]">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100 text-purple-600 border border-purple-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/20">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-[#FFFFFF]">User Profile</h3>
                  <p className="text-xs text-slate-500 dark:text-[#94A3B8]">QA Testing Platform Account</p>
                </div>
              </div>
              <button
                onClick={() => setProfileModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-[#94A3B8] dark:hover:text-[#FFFFFF] dark:hover:bg-[#1E2638] transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-4 p-4 rounded-xl bg-slate-50 dark:bg-[#141B2D] border border-slate-200 dark:border-[#1E2638]">
                <div className="w-14 h-14 rounded-full bg-purple-100 border border-purple-200 text-purple-700 dark:bg-violet-500/20 dark:border-violet-500/30 flex items-center justify-center dark:text-violet-400 font-bold text-xl">
                  {currentUser.name ? currentUser.name.charAt(0).toUpperCase() : 'U'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-lg font-bold text-slate-900 dark:text-[#FFFFFF] truncate">{currentUser.name}</div>
                  <div className="text-xs text-slate-500 dark:text-[#94A3B8] truncate">{currentUser.email}</div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-purple-50 text-purple-700 border border-purple-200 dark:bg-violet-500/10 dark:text-violet-400 dark:border-violet-500/30">
                      {currentUser.role || 'TESTER'}
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono uppercase font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      Active
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-[#1E2638] text-xs">
                  <span className="text-slate-500 dark:text-[#94A3B8]">User ID:</span>
                  <span className="font-mono text-slate-800 dark:text-[#CBD5E1] text-[11px]">{currentUser.id || 'N/A'}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-[#1E2638] text-xs">
                  <span className="text-slate-500 dark:text-[#94A3B8]">Email Address:</span>
                  <span className="font-semibold text-slate-800 dark:text-[#CBD5E1]">{currentUser.email}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-[#1E2638] text-xs">
                  <span className="text-slate-500 dark:text-[#94A3B8]">Role / Permissions:</span>
                  <span className="font-mono uppercase font-semibold text-purple-600 dark:text-violet-400">{currentUser.role || 'TESTER'}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-200 dark:border-[#1E2638] text-xs">
                  <span className="text-slate-500 dark:text-[#94A3B8]">Session Security:</span>
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">HttpOnly Session Cookie (qa_session)</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end p-4 bg-slate-50 dark:bg-[#141B2D] border-t border-slate-200 dark:border-[#1E2638]">
              <button
                onClick={() => setProfileModalOpen(false)}
                className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 text-xs font-semibold text-slate-800 dark:bg-[#1E2638] dark:hover:bg-[#2A344A] dark:text-[#FFFFFF] transition-colors cursor-pointer"
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
