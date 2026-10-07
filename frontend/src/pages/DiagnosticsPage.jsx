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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Activity className="w-5 h-5 text-[#F59E0B]" />
            Host Server & System Diagnostics
          </h2>
          <p className="text-xs text-slate-400">
            Verify execution prerequisites, binary dependencies, runtime versions, and filesystem writability.
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3.5 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-black shadow-lg shadow-amber-500/10 transition-all flex items-center gap-2 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          <span>Refresh Diagnostics</span>
        </button>
      </div>

      {/* Tools Status Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Java */}
        <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="w-5 h-5 text-[#F59E0B]" />
              <span className="font-semibold text-sm text-white">Java JDK</span>
            </div>
            {tools.java?.available ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> Available
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-semibold text-rose-400">
                <XCircle className="w-4 h-4" /> Missing
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 space-y-1 font-mono">
            <div>Version: <span className="text-white">{tools.java?.version || 'N/A'}</span></div>
            <div className="truncate">Path: <span className="text-slate-300">{tools.java?.path}</span></div>
          </div>
          {tools.java?.error && (
            <p className="text-[11px] text-rose-400 font-mono bg-rose-500/10 p-2 rounded border border-rose-500/20">
              {tools.java.error}
            </p>
          )}
        </div>

        {/* ADB */}
        <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Terminal className="w-5 h-5 text-[#F59E0B]" />
              <span className="font-semibold text-sm text-white">Android ADB</span>
            </div>
            {tools.adb?.available ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> Available
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-semibold text-rose-400">
                <XCircle className="w-4 h-4" /> Missing
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 space-y-1 font-mono">
            <div>Version: <span className="text-white">{tools.adb?.version || 'N/A'}</span></div>
            <div className="truncate">Path: <span className="text-slate-300">{tools.adb?.path}</span></div>
          </div>
          {tools.adb?.error && (
            <p className="text-[11px] text-rose-400 font-mono bg-rose-500/10 p-2 rounded border border-rose-500/20">
              {tools.adb.error}
            </p>
          )}
        </div>

        {/* Bundletool */}
        <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-5 h-5 text-[#F59E0B]" />
              <span className="font-semibold text-sm text-white">Bundletool</span>
            </div>
            {tools.bundletool?.available ? (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-400">
                <CheckCircle2 className="w-4 h-4" /> Available
              </span>
            ) : (
              <span className="flex items-center gap-1 text-xs font-semibold text-rose-400">
                <XCircle className="w-4 h-4" /> Missing
              </span>
            )}
          </div>
          <div className="text-xs text-slate-400 space-y-1 font-mono">
            <div>Version: <span className="text-white">{tools.bundletool?.version || 'N/A'}</span></div>
            <div className="truncate">Path: <span className="text-slate-300">{tools.bundletool?.path}</span></div>
          </div>
          {tools.bundletool?.error && (
            <p className="text-[11px] text-rose-400 font-mono bg-rose-500/10 p-2 rounded border border-rose-500/20">
              {tools.bundletool.error}
            </p>
          )}
        </div>
      </div>

      {/* Server & Environment Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Node Server */}
        <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] space-y-3">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-emerald-400" />
            <span className="font-semibold text-sm text-white">Backend Server Runtime</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono text-slate-400">
            <div>Status: <span className="text-emerald-400 font-semibold">{server.status || 'Running'}</span></div>
            <div>Platform Version: <span className="text-amber-400 font-bold">{server.displayVersion || DISPLAY_VERSION} ({server.appVersion || APP_VERSION})</span></div>
            <div>Node.js: <span className="text-white">{server.nodeVersion || (typeof process !== 'undefined' ? process.version : 'v20')}</span></div>
            <div>Platform OS: <span className="text-white">{server.platform || 'win32'}</span></div>
            <div>Port: <span className="text-white">{server.port || 8080}</span></div>
            <div>Uptime: <span className="text-white">{server.uptimeSeconds ? `${Math.floor(server.uptimeSeconds / 60)}m ${server.uptimeSeconds % 60}s` : '0s'}</span></div>
            <div>Connected Devices: <span className="text-white">{devices.count || 0}</span></div>
          </div>
        </div>

        {/* Filesystem & Storage */}
        <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] space-y-3">
          <div className="flex items-center gap-2">
            <HardDrive className="w-5 h-5 text-[#F59E0B]" />
            <span className="font-semibold text-sm text-white">Filesystem & Directories</span>
          </div>
          <div className="text-xs font-mono space-y-2 text-slate-400">
            <div className="flex items-center justify-between">
              <span className="truncate max-w-[200px]">Uploads Dir:</span>
              <span className={`px-2 py-0.5 rounded text-[10px] ${storage.uploadDirWritable ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                {storage.uploadDirWritable ? '✓ Writable' : '✕ Read-Only'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="truncate max-w-[200px]">Logs Dir:</span>
              <span className={`px-2 py-0.5 rounded text-[10px] ${storage.logDirWritable ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'}`}>
                {storage.logDirWritable ? '✓ Writable' : '✕ Read-Only'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Max Upload Size:</span>
              <span className="text-white">{storage.maxUploadSizeMb || 1024} MB</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
