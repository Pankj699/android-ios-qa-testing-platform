import React, { useState } from 'react';
import { Terminal, Play, AlertCircle, ShieldAlert, Loader2, Sparkles } from 'lucide-react';
import { getDeviceTransport } from '../services/transports/deviceTransportFactory';

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
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#10131B] border border-[#1C2230] rounded-xl p-5 space-y-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-[#F59E0B]" />
          <div>
            <h3 className="text-sm font-semibold text-white">Safe ADB Operations Console</h3>
            <p className="text-xs text-[#94A3B8]">Strictly allowlisted and sanitized host ADB execution</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#16130C] border border-[#F59E0B]/40 text-xs text-[#F59E0B]">
          <ShieldAlert className="w-3.5 h-3.5" />
          <span>Restricted Sandbox</span>
        </div>
      </div>

      {/* Quick Predefined Command Chips */}
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#94A3B8] mb-2">Predefined Operations</label>
        <div className="flex flex-wrap gap-2">
          {PREDEFINED_COMMANDS.map((item, idx) => (
            <button
              key={idx}
              onClick={() => {
                setCommand(item.cmd);
                handleExecute(item.cmd);
              }}
              disabled={loading}
              className="px-2.5 py-1 rounded-lg bg-[#080B10] hover:bg-[#161B26] text-xs text-slate-300 hover:text-white border border-[#1C2230] transition-colors flex items-center gap-1.5 font-mono cursor-pointer"
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
            className="w-full px-3 py-2 rounded-lg bg-[#080B10] border border-[#1C2230] text-xs text-white font-mono placeholder-[#64748B] focus:outline-none focus:border-[#F59E0B]"
          />
        </div>

        <button
          onClick={() => handleExecute()}
          disabled={loading || !command}
          className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-black shadow-md shadow-[#F59E0B]/20 transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
          <span>Execute</span>
        </button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Output Console Box */}
      <div className="bg-[#080B10] border border-[#1C2230] rounded-lg p-4 font-mono text-xs text-slate-200 min-h-[160px] max-h-[300px] overflow-y-auto whitespace-pre-wrap">
        {output ? output : <span className="text-[#64748B] italic">Click any predefined operation or execute a command to inspect output...</span>}
      </div>
    </div>
  );
}
