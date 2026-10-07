import React, { useState } from 'react';
import {
  Download,
  Laptop,
  Terminal,
  Smartphone,
  Tv,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ShieldCheck,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Info,
  ChevronRight,
  Sparkles
} from 'lucide-react';

export default function IosAgentSection({ onOpenPairModal }) {
  const [activeTab, setActiveTab] = useState('windows');
  const [copiedCmd, setCopiedCmd] = useState(null);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  return (
    <div className="space-y-6 pt-4 border-t border-[#1E2638]">
      {/* 1. Download Header & Cards Section */}
      <div className="bg-[#131924] border border-[#1E2638] rounded-2xl p-6 space-y-6">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#F59E0B]">
            <Sparkles className="w-4 h-4" />
            <span>Remote iOS Connectivity</span>
          </div>
          <h3 className="text-lg font-bold text-[#FFFFFF] mt-1">iOS Device Agent</h3>
          <p className="text-xs text-[#94A3B8] max-w-3xl mt-1 leading-relaxed">
            Install the QA Device Agent on the computer connected to your iPhone to enable iOS device connectivity and live screen mirroring.
          </p>
        </div>

        {/* Download Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Windows Download Card */}
          <div className="bg-[#0D111A] border border-[#1E2638] hover:border-blue-500/40 rounded-xl p-5 flex flex-col justify-between transition-all">
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="p-3 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Laptop className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/20 font-semibold">
                  <span>v1.1.2</span>
                </div>
              </div>

              <div>
                <h4 className="text-base font-bold text-[#FFFFFF] flex items-center gap-2">
                  Windows
                  <span className="text-xs font-normal text-[#64748B] font-mono">(x64)</span>
                </h4>
                <p className="text-xs text-[#94A3B8] mt-1">
                  Standalone portable agent with embedded Python runtime & Windows batch launcher.
                </p>
              </div>

              <div className="space-y-1 text-[11px] text-[#64748B] font-mono">
                <div>Package: <span className="text-[#CBD5E1]">QA-Device-Agent-Windows-x64-v1.1.2.zip</span></div>
                <div>Architecture: <span className="text-[#CBD5E1]">x64 (Windows 10 / 11)</span></div>
                <div>Prerequisite: <span className="text-[#CBD5E1]">Apple Mobile Device Support</span></div>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-[#1E2638]/60">
              <a
                href="/api/agent/download/windows"
                download="QA-Device-Agent-Windows-x64-v1.1.2.zip"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors shadow-lg shadow-blue-500/10"
              >
                <Download className="w-4 h-4" />
                <span>Download Windows Agent</span>
              </a>
            </div>
          </div>

          {/* macOS Download Card */}
          <div className="bg-[#0D111A] border border-[#1E2638] hover:border-amber-500/40 rounded-xl p-5 flex flex-col justify-between transition-all">
            <div className="space-y-3">
              <div className="flex items-start justify-between">
                <div className="p-3 rounded-xl bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                  <Terminal className="w-6 h-6" />
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono bg-[#F59E0B]/10 text-[#F59E0B] border border-[#F59E0B]/20 font-semibold">
                  <span>v1.1.2</span>
                </div>
              </div>

              <div>
                <h4 className="text-base font-bold text-[#FFFFFF] flex items-center gap-2">
                  macOS
                  <span className="text-xs font-normal text-[#64748B] font-mono">(Universal)</span>
                </h4>
                <p className="text-xs text-[#94A3B8] mt-1">
                  Native macOS bundle with Finder quick-start script and CoreDevice RemoteXPC tunnel.
                </p>
              </div>

              <div className="space-y-1 text-[11px] text-[#64748B] font-mono">
                <div>Package: <span className="text-[#CBD5E1]">QA-Device-Agent-macOS-v1.1.2.zip</span></div>
                <div>Launcher: <span className="text-[#CBD5E1]">start-agent.command</span></div>
                <div>Prerequisite: <span className="text-[#CBD5E1]">Python 3 & usbmuxd</span></div>
              </div>
            </div>

            <div className="pt-4 mt-4 border-t border-[#1E2638]/60">
              <a
                href="/api/agent/download/macos"
                download="QA-Device-Agent-macOS-v1.1.2.zip"
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-black font-semibold text-xs transition-colors shadow-lg shadow-amber-500/10"
              >
                <Download className="w-4 h-4" />
                <span>Download macOS Agent</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* 2. SOP Section with Tabs */}
      <div className="bg-[#131924] border border-[#1E2638] rounded-2xl p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-[#FFFFFF]">Agent Setup & Usage SOP</h3>
            <p className="text-xs text-[#94A3B8] mt-0.5">
              Standard operating procedure for configuring the QA Device Agent on your workstation.
            </p>
          </div>

          {/* SOP Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-[#0D111A] border border-[#1E2638] rounded-xl self-start sm:self-auto">
            <button
              onClick={() => setActiveTab('windows')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'windows'
                  ? 'bg-blue-600 text-white shadow'
                  : 'text-[#94A3B8] hover:text-[#FFFFFF]'
              }`}
            >
              <Laptop className="w-3.5 h-3.5" />
              <span>Windows</span>
            </button>
            <button
              onClick={() => setActiveTab('macos')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'macos'
                  ? 'bg-[#F59E0B] text-black shadow'
                  : 'text-[#94A3B8] hover:text-[#FFFFFF]'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" />
              <span>macOS</span>
            </button>
            <button
              onClick={() => setActiveTab('flow')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                activeTab === 'flow'
                  ? 'bg-emerald-600 text-white shadow'
                  : 'text-[#94A3B8] hover:text-[#FFFFFF]'
              }`}
            >
              <Tv className="w-3.5 h-3.5" />
              <span>Connect iPhone & Start Mirroring</span>
            </button>
          </div>
        </div>

        {/* TAB 1: WINDOWS SOP */}
        {activeTab === 'windows' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 text-xs text-blue-300 flex items-start gap-2.5">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                The Windows Agent is a self-contained portable package. No Python installation is required.
              </span>
            </div>

            <ol className="space-y-3.5 text-xs text-[#CBD5E1]">
              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0">1</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Download the Windows Agent</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Click <strong>Download Windows Agent</strong> above to get <code className="text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded font-mono">QA-Device-Agent-Windows-x64-v1.1.2.zip</code>.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0">2</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Extract the ZIP Archive</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Right-click the downloaded ZIP and select <strong>Extract All...</strong> to a convenient folder (such as <code className="text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded font-mono">C:\QA-Device-Agent</code>).
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0">3</span>
                <div className="space-y-1.5">
                  <div className="font-bold text-[#FFFFFF]">Verify Windows Dependencies (Apple Mobile Device Support)</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    The Agent requires the Apple USB driver to communicate with iOS devices. Install either:
                  </p>
                  <ul className="list-disc pl-5 space-y-1 text-[#94A3B8]">
                    <li><strong>Apple Devices</strong> app from the Microsoft Store (Recommended on Windows 10/11)</li>
                    <li>Or <strong>iTunes for Windows</strong> from <a href="https://www.apple.com/itunes/" target="_blank" rel="noopener noreferrer" className="text-blue-400 underline">apple.com/itunes</a></li>
                  </ul>
                  <p className="text-[11px] text-[#64748B]">
                    Ensure the <em>Apple Mobile Device Service</em> is running. In Command Prompt as Admin, run:
                  </p>
                  <div className="flex items-center justify-between p-2 rounded bg-black/40 font-mono text-[11px] text-[#CBD5E1]">
                    <span>net start "Apple Mobile Device Service"</span>
                    <button onClick={() => handleCopy('net start "Apple Mobile Device Service"', 'netstart')} className="text-[#64748B] hover:text-white">
                      {copiedCmd === 'netstart' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0">4</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Connect iPhone & Trust Computer</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Connect your physical iPhone to the Windows PC using an official Lightning or USB-C cable. Unlock your iPhone, tap <strong>Trust This Computer</strong> in the prompt, and enter your device passcode.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0">5</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Launch the Agent</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Double-click <code className="text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded font-mono">qa-device-agent.bat</code> in the extracted folder (or run <code className="text-blue-400 bg-blue-500/10 px-1 py-0.5 rounded font-mono">qa-device-agent\qa-device-agent.exe</code> in Command Prompt).
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0">6</span>
                <div className="space-y-2">
                  <div className="font-bold text-[#FFFFFF]">Interactive Pairing with QA Platform Server</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    On first run, the Agent initiates the pairing wizard. It will prompt for:
                  </p>
                  <ol className="list-decimal pl-5 space-y-1 text-[#94A3B8]">
                    <li><strong>QA Platform Server URL:</strong> Enter your platform URL (e.g. <code className="text-blue-400 font-mono">https://192.168.0.163:8080</code> or <code className="text-blue-400 font-mono">https://localhost:8080</code>).</li>
                    <li><strong>6-Digit Pairing Code:</strong> Click the button below to generate a fresh pairing code:</li>
                  </ol>
                  {onOpenPairModal && (
                    <button
                      onClick={onOpenPairModal}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Get 6-Digit Pairing Code</span>
                    </button>
                  )}
                  <p className="text-[11px] text-[#64748B]">
                    3. <strong>Agent Name:</strong> Press Enter to accept the default workstation hostname.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0">7</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Confirm Successful Connection</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    The console will output:
                  </p>
                  <div className="p-2.5 rounded bg-black/40 font-mono text-[11px] text-emerald-400 border border-emerald-500/20">
                    [+] SUCCESS: Agent successfully paired to QA Tester!<br />
                    [*] Starting Agent connection loop...<br />
                    [*] Heartbeat active | 1 iOS device(s) detected
                  </div>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 font-bold text-xs flex items-center justify-center shrink-0">8</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Select iPhone & Start Live Mirror</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Return to this <strong>Screen Mirror</strong> page. Your iPhone will appear in the <strong>Active Device</strong> dropdown at the top. Select it to start live low-latency hardware mirroring.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        )}

        {/* TAB 2: macOS SOP */}
        {activeTab === 'macos' && (
          <div className="space-y-4 animate-fadeIn">
            <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex items-start gap-2.5">
              <Info className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                The macOS Agent uses native Apple usbmuxd and CoreDevice RemoteXPC tunnels for ultra low-latency display streaming.
              </span>
            </div>

            <ol className="space-y-3.5 text-xs text-[#CBD5E1]">
              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] font-bold text-xs flex items-center justify-center shrink-0">1</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Download the macOS Agent</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Click <strong>Download macOS Agent</strong> above to get <code className="text-[#F59E0B] bg-[#F59E0B]/10 px-1 py-0.5 rounded font-mono">QA-Device-Agent-macOS-v1.1.2.zip</code>.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] font-bold text-xs flex items-center justify-center shrink-0">2</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Extract the ZIP Archive</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Double-click the downloaded ZIP in Finder to extract the <code className="text-[#F59E0B] bg-[#F59E0B]/10 px-1 py-0.5 rounded font-mono">qa-device-agent</code> folder.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] font-bold text-xs flex items-center justify-center shrink-0">3</span>
                <div className="space-y-1.5">
                  <div className="font-bold text-[#FFFFFF]">Verify macOS Prerequisites</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Ensure Python 3 and Xcode Command Line Tools are installed. Open Terminal and run:
                  </p>
                  <div className="flex items-center justify-between p-2 rounded bg-black/40 font-mono text-[11px] text-[#CBD5E1]">
                    <span>xcode-select --install</span>
                    <button onClick={() => handleCopy('xcode-select --install', 'xcode')} className="text-[#64748B] hover:text-white">
                      {copiedCmd === 'xcode' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#64748B]">
                    Native Apple <code className="font-mono">usbmuxd</code> starts automatically on macOS whenever an iPhone is connected via USB.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] font-bold text-xs flex items-center justify-center shrink-0">4</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Connect iPhone via USB</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Plug in your iPhone to your Mac via USB cable. Unlock the device and tap <strong>Trust This Computer</strong> in the prompt, entering the device passcode.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] font-bold text-xs flex items-center justify-center shrink-0">5</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Launch the Agent</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    In Finder, double-click <code className="text-[#F59E0B] bg-[#F59E0B]/10 px-1 py-0.5 rounded font-mono">start-agent.command</code>. Alternatively, open Terminal in the extracted folder and run:
                  </p>
                  <div className="flex items-center justify-between p-2 rounded bg-black/40 font-mono text-[11px] text-[#CBD5E1]">
                    <span>./start-agent.sh</span>
                    <button onClick={() => handleCopy('./start-agent.sh', 'macstart')} className="text-[#64748B] hover:text-white">
                      {copiedCmd === 'macstart' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[11px] text-[#64748B]">
                    The script automatically verifies and installs lightweight dependencies (<code className="font-mono">pymobiledevice3</code>, <code className="font-mono">websockets</code>, <code className="font-mono">requests</code>).
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] font-bold text-xs flex items-center justify-center shrink-0">6</span>
                <div className="space-y-2">
                  <div className="font-bold text-[#FFFFFF]">Pair with QA Platform Server</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    In the terminal wizard, enter:
                  </p>
                  <ol className="list-decimal pl-5 space-y-1 text-[#94A3B8]">
                    <li><strong>Server URL:</strong> (e.g. <code className="text-[#F59E0B] font-mono">https://192.168.0.163:8080</code>).</li>
                    <li><strong>6-Digit Pairing Code:</strong> Click below to generate:</li>
                  </ol>
                  {onOpenPairModal && (
                    <button
                      onClick={onOpenPairModal}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-black font-semibold text-xs transition-colors"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>Get 6-Digit Pairing Code</span>
                    </button>
                  )}
                  <p className="text-[11px] text-[#64748B]">
                    3. <strong>Agent Name:</strong> Press Enter to accept Mac hostname.
                  </p>
                </div>
              </li>

              <li className="flex items-start gap-3 bg-[#0D111A] p-4 rounded-xl border border-[#1E2638]">
                <span className="w-6 h-6 rounded-full bg-[#F59E0B]/20 text-[#F59E0B] font-bold text-xs flex items-center justify-center shrink-0">7</span>
                <div className="space-y-1">
                  <div className="font-bold text-[#FFFFFF]">Select Device in Screen Mirror</div>
                  <p className="text-[#94A3B8] leading-relaxed">
                    Once paired, the agent reports online status. In the QA Platform, open <strong>Screen Mirror</strong>, select your iPhone from the dropdown, and view the live stream.
                  </p>
                </div>
              </li>
            </ol>
          </div>
        )}

        {/* TAB 3: COMMON IPHONE CONNECTION & MIRROR FLOW */}
        {activeTab === 'flow' && (
          <div className="space-y-5 animate-fadeIn">
            {/* Visual Architecture Diagram */}
            <div className="bg-[#0D111A] border border-[#1E2638] rounded-xl p-5 space-y-4">
              <div className="font-bold text-xs text-[#FFFFFF]">End-to-End iOS Mirroring Architecture</div>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-2 text-center text-xs">
                <div className="p-3 rounded-lg bg-[#131924] border border-[#1E2638] space-y-1">
                  <Laptop className="w-4 h-4 mx-auto text-blue-400" />
                  <div className="font-semibold text-[#FFFFFF] text-[11px]">Computer</div>
                  <div className="text-[10px] text-[#64748B]">Windows / macOS</div>
                </div>
                <div className="flex items-center justify-center text-[#64748B]">
                  <ChevronRight className="w-4 h-4 hidden md:block" />
                  <span className="md:hidden text-[10px]">runs ↓</span>
                </div>
                <div className="p-3 rounded-lg bg-[#131924] border border-[#1E2638] space-y-1">
                  <Terminal className="w-4 h-4 mx-auto text-[#F59E0B]" />
                  <div className="font-semibold text-[#FFFFFF] text-[11px]">QA Device Agent</div>
                  <div className="text-[10px] text-[#64748B]">USB Discovery + Stream Server</div>
                </div>
                <div className="flex items-center justify-center text-[#64748B]">
                  <ChevronRight className="w-4 h-4 hidden md:block" />
                  <span className="md:hidden text-[10px]">WebSocket wss:// ↓</span>
                </div>
                <div className="p-3 rounded-lg bg-[#131924] border border-emerald-500/30 space-y-1">
                  <Tv className="w-4 h-4 mx-auto text-emerald-400" />
                  <div className="font-semibold text-[#FFFFFF] text-[11px]">QA Platform Web</div>
                  <div className="text-[10px] text-emerald-400 font-mono">Live H.264 Mirroring</div>
                </div>
              </div>
            </div>

            {/* Stage-by-Stage Explanation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
              <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
                <div className="font-bold text-[#FFFFFF] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>1. Pairing & Authentication</span>
                </div>
                <p className="text-[#94A3B8] text-[11px] leading-relaxed">
                  The Agent uses a secure 6-digit numeric pairing code (valid for 5 minutes). Upon verification, the central server issues a signed JWT token saved in your local configuration. Re-pairing is not required on subsequent launches.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
                <div className="font-bold text-[#FFFFFF] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>2. Hardware USB Discovery</span>
                </div>
                <p className="text-[#94A3B8] text-[11px] leading-relaxed">
                  The Agent queries the native Apple USB subsystem (<code className="font-mono text-[10px]">usbmuxd</code>) every 5 seconds. Connected iPhones are assigned their hardware UDID and registered exclusively to your user session.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
                <div className="font-bold text-[#FFFFFF] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>3. CoreDevice Display Stream</span>
                </div>
                <p className="text-[#94A3B8] text-[11px] leading-relaxed">
                  When you open the Screen Mirror tab and select the iPhone, the QA Platform sends a stream command to the Agent. The Agent establishes an RSD tunnel via CoreDevice RemoteXPC and streams H.264 Annex-B frames at 30 fps.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
                <div className="font-bold text-[#FFFFFF] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <span>4. QA Defect Tools</span>
                </div>
                <p className="text-[#94A3B8] text-[11px] leading-relaxed">
                  Use the live viewport controls to capture instantaneous PNG screenshots, record screen videos with webm download, and inspect device telemetry without installing any third-party app on the iPhone.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Compact Troubleshooting Section */}
      <div className="bg-[#131924] border border-[#1E2638] rounded-2xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-[#F59E0B]" />
          <h3 className="text-base font-bold text-[#FFFFFF]">Troubleshooting & Common Issues</h3>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
          {/* Issue 1 */}
          <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
            <div className="font-bold text-red-400">Agent Cannot Connect to Server</div>
            <p className="text-[11px] text-[#94A3B8]">
              <strong>Likely Cause:</strong> Server URL incorrect or self-signed HTTPS certificate rejected.
            </p>
            <p className="text-[11px] text-[#CBD5E1]">
              <strong>Action:</strong> Ensure the URL includes <code className="font-mono text-blue-400">https://</code> and port 8080. Open the URL in your browser once to accept the self-signed certificate.
            </p>
          </div>

          {/* Issue 2 */}
          <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
            <div className="font-bold text-amber-400">iPhone Not Detected (0 Devices)</div>
            <p className="text-[11px] text-[#94A3B8]">
              <strong>Likely Cause:</strong> iPhone is locked or "Trust This Computer" prompt was not accepted.
            </p>
            <p className="text-[11px] text-[#CBD5E1]">
              <strong>Action:</strong> Unlock the iPhone, re-plug the cable, and tap <em>Trust</em> in the prompt. Run <code className="font-mono text-[#F59E0B]">qa-device-agent.exe devices</code> to test detection.
            </p>
          </div>

          {/* Issue 3 */}
          <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
            <div className="font-bold text-red-400">Windows: Missing Apple Driver</div>
            <p className="text-[11px] text-[#94A3B8]">
              <strong>Likely Cause:</strong> Apple Mobile Device Support not installed on Windows.
            </p>
            <p className="text-[11px] text-[#CBD5E1]">
              <strong>Action:</strong> Install "Apple Devices" from Microsoft Store or iTunes for Windows. In Admin Command Prompt, run <code className="font-mono text-blue-400">net start "Apple Mobile Device Service"</code>.
            </p>
          </div>

          {/* Issue 4 */}
          <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
            <div className="font-bold text-amber-400">macOS: usbmuxd Not Running</div>
            <p className="text-[11px] text-[#94A3B8]">
              <strong>Likely Cause:</strong> No device connected or Xcode command line tools missing.
            </p>
            <p className="text-[11px] text-[#CBD5E1]">
              <strong>Action:</strong> Connect your iPhone to wake the native usbmuxd daemon. Run <code className="font-mono text-[#F59E0B]">xcode-select --install</code> in Terminal if needed.
            </p>
          </div>

          {/* Issue 5 */}
          <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
            <div className="font-bold text-amber-400">Pairing Code Expired</div>
            <p className="text-[11px] text-[#94A3B8]">
              <strong>Likely Cause:</strong> 5-minute validity window elapsed before code was submitted.
            </p>
            <p className="text-[11px] text-[#CBD5E1]">
              <strong>Action:</strong> In the QA Platform, click <em>Pair Agent</em>, note the fresh 6-digit code, and enter it into the agent console prompt.
            </p>
          </div>

          {/* Issue 6 */}
          <div className="p-4 rounded-xl bg-[#0D111A] border border-[#1E2638] space-y-2">
            <div className="font-bold text-amber-400">Mirror Does Not Start / Black Screen</div>
            <p className="text-[11px] text-[#94A3B8]">
              <strong>Likely Cause:</strong> Device locked or CoreDevice RSD tunnel initializing.
            </p>
            <p className="text-[11px] text-[#CBD5E1]">
              <strong>Action:</strong> Unlock the iPhone. In the web interface, click Stop Mirror and Start Mirror again to re-initialize the RemoteXPC stream tunnel.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
