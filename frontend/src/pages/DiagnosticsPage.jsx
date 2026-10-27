import React from 'react';
import {
  Activity,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Server,
  Terminal,
  Cpu,
  Package,
  HardDrive,
  FolderCheck,
  AlertTriangle
} from 'lucide-react';
import { APP_VERSION, DISPLAY_VERSION } from '../config/version';

export default function DiagnosticsPage({ diagnostics, onRefresh, loading }) {
  const tools = diagnostics?.tools || {};
  const server = diagnostics?.server || {};
  const storage = diagnostics?.storage || {};
  const devices = diagnostics?.devices || {};

  return (
    <div className="space-y-6 text-slate-800 dark:text-slate-200">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[var(--line)]">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1F2544] dark:text-white tracking-tight font-sans">
              System <span className="text-heading-gradient">Diagnostics</span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6B7194] dark:text-[#94A3B8] mt-1">
              Verify execution prerequisites, binary dependencies, runtime versions, and filesystem writability.
            </p>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-4 py-2 rounded-pill btn-magic text-xs font-bold text-white shadow-md transition-all flex items-center gap-2 disabled:opacity-50 cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Diagnostics</span>
        </button>
      </div>

      {/* Tools Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Java */}
        <div className="p-5 rounded-card glass border border-[var(--line)] shadow-sm space-y-3 hover:border-violet-500/30 transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-500/15 to-pink-500/15 border border-violet-500/25 flex items-center justify-center text-violet-600 dark:text-violet-400 shrink-0">
                <Cpu className="w-4 h-4" />
              </div>
              <span className="font-bold text-sm text-slate-900 dark:text-white">Java JDK</span>
            </div>
            {tools.java?.available ? (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-pill border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" /> Available
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-bold text-rose-700 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-pill border border-rose-500/20">
                <XCircle className="w-3.5 h-3.5" /> Missing
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 font-mono">
            <div>Version: <span className="text-slate-900 dark:text-white font-semibold">{tools.java?.version || 'N/A'}</span></div>
            <div className="truncate">Path: <span className="text-slate-700 dark:text-slate-300">{tools.java?.path}</span></div>
          </div>
          {tools.java?.error && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 font-mono bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/20">
              {tools.java.error}
            </p>
          )}
        </div>

        {/* ADB */}
        <div className="p-5 rounded-card glass border border-[var(--line)] shadow-sm space-y-3 hover:border-violet-500/30 transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-500/15 to-pink-500/15 border border-violet-500/25 flex items-center justify-center text-violet-600 dark:text-violet-400 shrink-0">
                <Terminal className="w-4 h-4" />
              </div>
              <span className="font-bold text-sm text-slate-900 dark:text-white">Android ADB</span>
            </div>
            {tools.adb?.available ? (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-pill border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" /> Available
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-bold text-rose-700 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-pill border border-rose-500/20">
                <XCircle className="w-3.5 h-3.5" /> Missing
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 font-mono">
            <div>Version: <span className="text-slate-900 dark:text-white font-semibold">{tools.adb?.version || 'N/A'}</span></div>
            <div className="truncate">Path: <span className="text-slate-700 dark:text-slate-300">{tools.adb?.path}</span></div>
          </div>
          {tools.adb?.error && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 font-mono bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/20">
              {tools.adb.error}
            </p>
          )}
        </div>

        {/* Bundletool */}
        <div className="p-5 rounded-card glass border border-[var(--line)] shadow-sm space-y-3 hover:border-violet-500/30 transition-all">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-500/15 to-pink-500/15 border border-violet-500/25 flex items-center justify-center text-violet-600 dark:text-violet-400 shrink-0">
                <Package className="w-4 h-4" />
              </div>
              <span className="font-bold text-sm text-slate-900 dark:text-white">Bundletool</span>
            </div>
            {tools.bundletool?.available ? (
              <span className="flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-pill border border-emerald-500/20">
                <CheckCircle2 className="w-3.5 h-3.5" /> Available
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-bold text-rose-700 dark:text-rose-400 bg-rose-500/10 px-2 py-0.5 rounded-pill border border-rose-500/20">
                <XCircle className="w-3.5 h-3.5" /> Missing
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 font-mono">
            <div>Version: <span className="text-slate-900 dark:text-white font-semibold">{tools.bundletool?.version || 'N/A'}</span></div>
            <div className="truncate">Path: <span className="text-slate-700 dark:text-slate-300">{tools.bundletool?.path}</span></div>
          </div>
          {tools.bundletool?.error && (
            <p className="text-[11px] text-rose-600 dark:text-rose-400 font-mono bg-rose-500/10 p-2.5 rounded-xl border border-rose-500/20">
              {tools.bundletool.error}
            </p>
          )}
        </div>
      </div>

      {/* Server & Environment Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Node Server */}
        <div className="p-5 rounded-card glass border border-[var(--line)] shadow-sm space-y-3 hover:border-violet-500/30 transition-all">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-emerald-500/15 to-teal-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
              <Server className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm text-slate-900 dark:text-white">Backend Server Runtime</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-500 dark:text-slate-400">
            <div>Status: <span className="text-emerald-600 dark:text-emerald-400 font-bold">{server.status || 'Running'}</span></div>
            <div>Platform Version: <span className="text-violet-600 dark:text-amber-400 font-bold">{server.displayVersion || DISPLAY_VERSION} ({server.appVersion || APP_VERSION})</span></div>
            <div>Node.js: <span className="text-slate-900 dark:text-white font-semibold">{server.nodeVersion || (typeof process !== 'undefined' ? process.version : 'v20')}</span></div>
            <div>Platform OS: <span className="text-slate-900 dark:text-white font-semibold">{server.platform || 'win32'}</span></div>
            <div>Port: <span className="text-slate-900 dark:text-white font-semibold">{server.port || 8080}</span></div>
            <div>Uptime: <span className="text-slate-900 dark:text-white font-semibold">{server.uptimeSeconds ? `${Math.floor(server.uptimeSeconds / 60)}m ${server.uptimeSeconds % 60}s` : '0s'}</span></div>
            <div>Connected Devices: <span className="text-slate-900 dark:text-white font-semibold">{devices.count || 0}</span></div>
          </div>
        </div>

        {/* Filesystem & Storage */}
        <div className="p-5 rounded-card glass border border-[var(--line)] shadow-sm space-y-3 hover:border-violet-500/30 transition-all">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-violet-500/15 to-pink-500/15 border border-violet-500/25 flex items-center justify-center text-violet-600 dark:text-violet-400 shrink-0">
              <HardDrive className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm text-slate-900 dark:text-white">Filesystem &amp; Directories</span>
          </div>
          <div className="text-xs font-mono space-y-2 text-slate-500 dark:text-slate-400">
            <div className="flex items-center justify-between">
              <span className="truncate max-w-[200px]">Uploads Dir:</span>
              <span className={`px-2.5 py-0.5 rounded-pill text-[10px] font-bold ${storage.uploadDirWritable ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20'}`}>
                {storage.uploadDirWritable ? '✓ Writable' : '✕ Read-Only'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="truncate max-w-[200px]">Logs Dir:</span>
              <span className={`px-2.5 py-0.5 rounded-pill text-[10px] font-bold ${storage.logDirWritable ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-700 dark:text-rose-400 border border-rose-500/20'}`}>
                {storage.logDirWritable ? '✓ Writable' : '✕ Read-Only'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Max Upload Size:</span>
              <span className="text-slate-900 dark:text-white font-bold">{storage.maxUploadSizeMb || 1024} MB</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
