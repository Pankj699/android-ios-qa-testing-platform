import React, { useState } from 'react';
import { Terminal, Play, AlertCircle, ShieldAlert, Loader2, Sparkles } from 'lucide-react';
import { getDeviceTransport } from '../services/transports/deviceTransportFactory';
import { toast } from '../utils/toast';

const PREDEFINED_COMMANDS = [
  { label: 'List Devices', cmd: 'adb devices' },
  { label: 'Battery Status', cmd: 'adb shell dumpsys battery' },
  { label: 'Storage Usage', cmd: 'adb shell df -h /data' },
  { label: 'Screen Resolution', cmd: 'adb shell wm size' },
  { label: 'Android Properties', cmd: 'adb shell getprop ro.build.version.release' },
  { label: 'Clear Logcat Buffer', cmd: 'adb logcat -c' }
];

export default function SafeAdbConsole({ activeSerial, device }) {
  const [command, setCommand] = useState('adb devices');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleExecute = async (cmdToRun) => {
    const targetCmd = cmdToRun || command;
    if (!targetCmd) return;

    setLoading(true);
    setError(null);

    try {
      const targetDevice = device || (activeSerial ? { serial: activeSerial } : null);
      const transport = getDeviceTransport(targetDevice);
      if (!transport) {
        throw new Error('Please select an active Android device first.');
      }
      const res = await transport.executeSafeAdb(targetCmd);
      setOutput(`$ ${targetCmd}\n${res.output || '(No output)'}`);
    } catch (err) {
      setError(err.message || 'Execution error');
      setOutput(`$ ${targetCmd}\n[ERROR] ${err.message}`);
      toast.error(err.message || 'Command execution failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass border border-[var(--line)] rounded-card p-5 lg:p-6 space-y-4 shadow-glass">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="brand-mark w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-sm shrink-0">
            <Terminal className="w-4 h-4 text-white" />
          </div>
          <div>
            <h3 className="text-sm font-extrabold text-[#1F2544] dark:text-white font-sans">Safe ADB Operations Console</h3>
            <p className="text-xs text-[#6B7194] dark:text-[#94A3B8]">Strictly allowlisted and sanitized host ADB execution</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full chip-badge text-xs font-bold text-amber-600 dark:text-[#F59E0B]">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Restricted Sandbox</span>
        </div>
      </div>

      {/* Quick Predefined Command Chips */}
      <div>
        <label className="block text-[11px] font-bold uppercase tracking-wider text-[#6B7194] dark:text-[#94A3B8] mb-2">Predefined Operations</label>
        <div className="flex flex-wrap gap-2">
          {PREDEFINED_COMMANDS.map((item, idx) => (
            <button
              key={idx}
              onClick={() => {
                setCommand(item.cmd);
                handleExecute(item.cmd);
              }}
              disabled={loading}
              className="idea px-3 py-1.5 rounded-btn text-xs font-mono font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Command Input Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleExecute()}
            placeholder="e.g. adb shell getprop ro.product.model"
            className="w-full px-3.5 py-2.5 rounded-xl bg-white/70 border border-[var(--line)] text-xs text-[#1F2544] font-mono placeholder-[#6B7194] dark:bg-[#080B10] dark:border-[#1C2230] dark:text-white focus:outline-none focus:border-[#7c6cf6] focus:ring-2 focus:ring-[#7c6cf6]/20 shadow-xs"
          />
        </div>

        <button
          onClick={() => handleExecute()}
          disabled={loading || !command}
          className="btn-magic px-5 py-2.5 rounded-btn disabled:opacity-50 text-xs font-bold text-white shadow-magic transition-all flex items-center gap-1.5 cursor-pointer"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-white" />}
          <span>Execute</span>
        </button>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl alert-soft bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-500 dark:text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Output Console Box */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 font-mono text-xs text-emerald-400 min-h-[160px] max-h-[300px] overflow-y-auto whitespace-pre-wrap shadow-inner">
        {output ? output : <span className="text-slate-500 italic">Click any predefined operation or execute a command to inspect output...</span>}
      </div>
    </div>
  );
}
