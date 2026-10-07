import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  CheckSquare,
  Square,
  Smartphone,
  Package,
  PlayCircle,
  Terminal,
  Activity,
  AlertTriangle,
  Info,
  CheckCircle2,
  Copy,
  Check,
  ExternalLink,
  Layers,
  Wifi,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  Cpu,
  RefreshCw,
  HelpCircle,
  FileText
} from 'lucide-react';

const SOP_SECTIONS = [
  {
    id: 'overview',
    title: '1. Overview & Architecture',
    icon: BookOpen,
    badge: 'Foundation'
  },
  {
    id: 'prerequisites',
    title: '2. Hardware & Network Prerequisites',
    icon: Smartphone,
    badge: 'Setup'
  },
  {
    id: 'wireless-pairing',
    title: '3. Wireless Debugging Pairing & Connection',
    icon: Wifi,
    badge: 'Connectivity'
  },
  {
    id: 'aab-upload',
    title: '4. AAB Upload & Manifest Inspection',
    icon: Package,
    badge: 'Builds'
  },
  {
    id: 'test-execution',
    title: '5. Automated PAD / ORD Test Pipeline',
    icon: PlayCircle,
    badge: 'Execution'
  },
  {
    id: 'logcat-monitoring',
    title: '6. Real-Time Logcat & Asset Verification',
    icon: Activity,
    badge: 'Monitoring'
  },
  {
    id: 'adb-operations',
    title: '7. Controlled ADB Device Operations',
    icon: Terminal,
    badge: 'Operations'
  },
  {
    id: 'qa-checklist',
    title: '8. QA Sign-Off Checklist & Acceptance Criteria',
    icon: CheckSquare,
    badge: 'Verification'
  },
  {
    id: 'troubleshooting',
    title: '9. Troubleshooting & Common Issues',
    icon: AlertTriangle,
    badge: 'Debugging'
  },
  {
    id: 'cheat-sheet',
    title: '10. ADB & Bundletool Cheat Sheet',
    icon: FileText,
    badge: 'Reference'
  }
];

export default function SopPage({ onNavigate, onOpenPairModal, onOpenUploadModal }) {
  const [activeSection, setActiveSection] = useState('overview');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState(null);

  // Interactive Checklist State
  const [checklist, setChecklist] = useState({
    prereq_wifi: false,
    prereq_wireless_debug: false,
    aab_verified: false,
    install_time_present: false,
    fast_follow_downloaded: false,
    on_demand_triggered: false,
    offline_fallback_handled: false,
    asset_integrity_verified: false,
    no_anr_crashes: false,
    pm_clear_reset_tested: false
  });

  const toggleChecklist = (key) => {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const copyToClipboard = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const filteredSections = SOP_SECTIONS.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.badge.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const completedChecklistCount = Object.values(checklist).filter(Boolean).length;
  const totalChecklistCount = Object.keys(checklist).length;
  const checklistProgress = Math.round((completedChecklistCount / totalChecklistCount) * 100);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-2xl bg-[#131924] border border-[#1E2638] shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#F59E0B]" />
            <h2 className="text-lg font-bold text-white">Standard Operating Procedure (SOP) Guide</h2>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
              QA Standard v1.0
            </span>
          </div>
          <p className="text-xs text-slate-300 max-w-2xl">
            Comprehensive operational workflow, test procedures, acceptance criteria, and troubleshooting instructions for Android Play Asset Delivery (PAD) and On-Demand Resources (ODR) testing.
          </p>
        </div>

        {/* QA Checklist Progress Metric */}
        <div className="bg-[#0A0D14] border border-[#1E2638] rounded-xl p-3 shrink-0 flex items-center gap-3">
          <div>
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">QA Sign-Off Progress</div>
            <div className="text-sm font-bold text-white mt-0.5">
              {completedChecklistCount} of {totalChecklistCount} checks ({checklistProgress}%)
            </div>
          </div>
          <div className="w-12 h-12 rounded-full bg-[#131924] flex items-center justify-center relative border border-[#1E2638]">
            <span className="text-xs font-bold text-[#F59E0B]">{checklistProgress}%</span>
          </div>
        </div>
      </div>

      {/* Main Grid: Sidebar Navigation + Content Body */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left TOC / Navigation */}
        <div className="lg:col-span-4 space-y-3">
          {/* Search Box */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search SOP procedures, commands..."
              className="w-full bg-[#131924] border border-[#1E2638] rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
            />
          </div>

          {/* Section List */}
          <div className="bg-[#131924] border border-[#1E2638] rounded-2xl p-2 space-y-1">
            {filteredSections.map((sec) => {
              const Icon = sec.icon;
              const isActive = activeSection === sec.id;

              return (
                <button
                  key={sec.id}
                  onClick={() => setActiveSection(sec.id)}
                  className={`w-full flex items-center justify-between p-2.5 rounded-xl text-xs font-medium text-left transition-all ${
                    isActive
                      ? 'bg-[#F59E0B] text-black font-bold shadow-lg shadow-amber-500/10'
                      : 'text-slate-300 hover:bg-[#1E2638] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2.5 truncate">
                    <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-black' : 'text-slate-400'}`} />
                    <span className="truncate">{sec.title}</span>
                  </div>
                  <span
                    className={`text-[9px] uppercase font-mono px-1.5 py-0.5 rounded ${
                      isActive ? 'bg-black/20 text-black font-semibold' : 'bg-[#0A0D14] text-slate-400 border border-[#1E2638]'
                    }`}
                  >
                    {sec.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Quick Help Card */}
          <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638] space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <HelpCircle className="w-4 h-4 text-[#F59E0B]" />
              <span>Need Live Assistance?</span>
            </div>
            <p className="text-[11px] text-slate-400">
              You can launch the interactive Guided App Tour anytime or connect a device directly from the header.
            </p>
          </div>
        </div>

        {/* Right Content Area */}
        <div className="lg:col-span-8 bg-[#131924] border border-[#1E2638] rounded-2xl p-6 lg:p-8 space-y-8">
          {/* SECTION 1: OVERVIEW */}
          {activeSection === 'overview' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                  SECTION 1
                </span>
                <h3 className="text-xl font-bold text-white">1. Overview & Architecture</h3>
                <p className="text-xs text-slate-400">
                  Understanding Play Asset Delivery (PAD), On-Demand Resources (ODR), and local testing simulation.
                </p>
              </div>

              <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
                <p>
                  <strong>Play Asset Delivery (PAD)</strong> is Google Play's official solution for delivering large game and app assets (3D models, textures, video clips, sound packs) exceeding the standard 150MB base APK size limit.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-1.5">
                    <div className="font-semibold text-[#F59E0B]">1. Install-Time</div>
                    <p className="text-[11px] text-slate-400">
                      Delivered automatically at the time the app is installed. Available immediately on first launch as part of the split APKs without network requests.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-1.5">
                    <div className="font-semibold text-purple-400">2. Fast-Follow</div>
                    <p className="text-[11px] text-slate-400">
                      Downloads automatically in the background right after the app installation finishes, without blocking initial startup.
                    </p>
                  </div>
                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-1.5">
                    <div className="font-semibold text-emerald-400">3. On-Demand</div>
                    <p className="text-[11px] text-slate-400">
                      Downloaded dynamically on-demand when requested by the application via the PlayCore Asset Delivery API (e.g. user selects a specific template, level, or filter).
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                  <div className="flex items-center gap-2 font-semibold text-[#F59E0B] text-xs">
                    <Info className="w-4 h-4 text-[#F59E0B]" />
                    <span>How Local Testing Mode Works (`--local-testing`)</span>
                  </div>
                  <p className="text-[11px] text-slate-300">
                    Normally, testing on-demand asset packs requires publishing builds to Google Play Internal App Sharing. Google Bundletool's <code className="bg-[#131924] px-1 py-0.5 rounded text-[#F59E0B] font-mono border border-[#1E2638]">--local-testing</code> flag solves this by extracting asset packs into a local mock directory on the Android device at:
                    <br />
                    <code className="bg-[#131924] px-1.5 py-1 rounded text-emerald-400 font-mono text-[10px] block mt-1.5 border border-[#1E2638]">
                      /sdcard/Android/data/&lt;package_name&gt;/files/local_testing/
                    </code>
                    When your app calls the PlayCore AssetPackManager API, the PlayCore SDK intercepts requests and serves the files directly from this mock storage, perfectly simulating Google Play CDN responses.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: PREREQUISITES */}
          {activeSection === 'prerequisites' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                  SECTION 2
                </span>
                <h3 className="text-xl font-bold text-white">2. Hardware & Network Prerequisites</h3>
                <p className="text-xs text-slate-400">
                  Ensure target test environment meets QA requirements before commencing test runs.
                </p>
              </div>

              <div className="space-y-4 text-xs text-slate-300">
                <div className="space-y-3">
                  <h4 className="font-semibold text-slate-200 text-sm">Host System Requirements:</h4>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>Android Debug Bridge (adb):</strong> Installed and accessible in host PATH or configured in platform environment.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>Java Development Kit (JDK 11+ / 17+):</strong> Required to execute Google Bundletool JAR.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>Google Bundletool (1.18.3+):</strong> Pre-bundled in backend tools directory.</span>
                    </li>
                  </ul>
                </div>

                <div className="space-y-3 pt-3 border-t border-[#1E2638]">
                  <h4 className="font-semibold text-slate-200 text-sm">Target Android Device Requirements:</h4>
                  <ul className="space-y-2">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>Operating System:</strong> Android 11.0 (API 30) or higher for native Wireless Debugging pairing code support.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>Wi-Fi Connection:</strong> Device must be connected to the exact same Wi-Fi LAN / Subnet as the QA host machine.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>Developer Options Enabled:</strong> Go to Settings → About Phone → Tap <em>Build Number</em> 7 times until Developer Mode is unlocked.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span><strong>Storage:</strong> Minimum 2GB free internal storage for split APKs and mock asset packs.</span>
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 3: WIRELESS PAIRING */}
          {activeSection === 'wireless-pairing' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                  SECTION 3
                </span>
                <h3 className="text-xl font-bold text-white">3. Wireless Debugging Pairing & Connection</h3>
                <p className="text-xs text-slate-400">
                  Step-by-step pairing procedure for Android 11+ physical devices.
                </p>
              </div>

              <div className="space-y-4 text-xs text-slate-300">
                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                    <span className="font-semibold text-[#F59E0B] text-xs">Step 1: Open Wireless Debugging on Phone</span>
                    <p className="text-[11px] text-slate-400">
                      Navigate to <strong>Settings → System → Developer options → Wireless debugging</strong>. Toggle the switch to <strong>ON</strong>. Accept the prompt to allow wireless debugging on this Wi-Fi network.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                    <span className="font-semibold text-[#F59E0B] text-xs">Step 2: Generate Pairing Code</span>
                    <p className="text-[11px] text-slate-400">
                      Tap on <strong>"Pair device with pairing code"</strong>. A modal will appear showing:
                    </p>
                    <ul className="list-disc list-inside text-[11px] text-slate-300 space-y-1 pl-2">
                      <li><strong>Wi-Fi pairing code:</strong> 6-digit numeric PIN (e.g., <code className="text-[#F59E0B] font-mono">123456</code>)</li>
                      <li><strong>IP address &amp; Port:</strong> Device IP and dedicated pair port (e.g., <code className="text-[#F59E0B] font-mono">192.168.0.160:37451</code>)</li>
                    </ul>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                    <span className="font-semibold text-[#F59E0B] text-xs">Step 3: Connect in the QA Platform</span>
                    <p className="text-[11px] text-slate-400">
                      Open the <strong>Pair Wireless Device</strong> modal in this platform (click button below). Enter the IP address, the <strong>Pairing Port</strong>, and the <strong>6-digit PIN</strong>.
                    </p>
                    <button
                      onClick={onOpenPairModal}
                      className="px-3.5 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-black font-bold text-xs flex items-center gap-1.5 transition-colors mt-2"
                    >
                      <Wifi className="w-3.5 h-3.5 text-black" />
                      <span>Open Pairing Modal</span>
                    </button>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#261D10] border border-[#78350F] text-xs text-[#F59E0B] space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-[#F59E0B]">
                    <AlertTriangle className="w-4 h-4 text-[#F59E0B]" />
                    <span>Important Android Port Behavior Note:</span>
                  </div>
                  <p className="text-[11px] text-amber-200/90">
                    Android uses two separate ports: the <em>Pairing Port</em> (shown only in the pairing popup) and the <em>Connection Port</em> (shown on the main Wireless Debugging screen). The platform automatically handles handshake negotiation across both ports.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 4: AAB UPLOAD */}
          {activeSection === 'aab-upload' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                  SECTION 4
                </span>
                <h3 className="text-xl font-bold text-white">4. AAB Upload & Manifest Inspection</h3>
                <p className="text-xs text-slate-400">
                  Generating and verifying Android App Bundle files for automated testing.
                </p>
              </div>

              <div className="space-y-4 text-xs text-slate-300">
                <div className="space-y-3">
                  <h4 className="font-semibold text-slate-200 text-sm">Building the .aab in Android Studio:</h4>
                  <ol className="list-decimal list-inside space-y-1 text-slate-300 text-[11px] pl-2">
                    <li>In Android Studio, select <strong>Build → Generate Signed Bundle / APK...</strong></li>
                    <li>Select <strong>Android App Bundle (.aab)</strong> and click Next.</li>
                    <li>Provide your QA keystore signing credentials.</li>
                    <li>Select your target build variant (e.g. <code className="text-[#F59E0B] font-mono">qa</code>, <code className="text-[#F59E0B] font-mono">debug</code>, or <code className="text-[#F59E0B] font-mono">release</code>).</li>
                    <li>Locate the generated bundle in <code className="text-white font-mono">app/build/outputs/bundle/&lt;variant&gt;/*.aab</code>.</li>
                  </ol>
                </div>

                <div className="space-y-3 pt-3 border-t border-[#1E2638]">
                  <h4 className="font-semibold text-slate-200 text-sm">Automated Inspection on Upload:</h4>
                  <p className="text-[11px] text-slate-400">
                    When you upload the <code className="text-[#F59E0B] font-mono">.aab</code> file to this platform, Bundletool automatically dumps the binary XML manifest and parses:
                  </p>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="p-2.5 rounded-lg bg-[#0A0D14] border border-[#1E2638]">
                      <span className="text-slate-400">Package Name:</span> <strong className="text-white">com.example.app</strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0A0D14] border border-[#1E2638]">
                      <span className="text-slate-400">Version:</span> <strong className="text-white">203.0.qa (203)</strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0A0D14] border border-[#1E2638]">
                      <span className="text-slate-400">Min / Target SDK:</span> <strong className="text-white">SDK 24 / SDK 34</strong>
                    </div>
                    <div className="p-2.5 rounded-lg bg-[#0A0D14] border border-[#1E2638]">
                      <span className="text-slate-400">Asset Pack Modules:</span> <strong className="text-[#F59E0B]">Detected &amp; Verified</strong>
                    </div>
                  </div>
                </div>

                <button
                  onClick={onOpenUploadModal}
                  className="px-3.5 py-2 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-black font-bold text-xs flex items-center gap-1.5 transition-colors"
                >
                  <Package className="w-3.5 h-3.5" />
                  <span>Upload .aab Build File</span>
                </button>
              </div>
            </div>
          )}

          {/* SECTION 5: TEST EXECUTION PIPELINE */}
          {activeSection === 'test-execution' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                  SECTION 5
                </span>
                <h3 className="text-xl font-bold text-white">5. Automated PAD / ORD Test Pipeline</h3>
                <p className="text-xs text-slate-400">
                  The automated 16-step execution lifecycle orchestrated by the platform.
                </p>
              </div>

              <div className="space-y-3 text-xs text-slate-300">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-1">
                    <span className="text-[#F59E0B] font-mono font-bold text-[11px]">Steps 1-4: Precheck &amp; Verification</span>
                    <p className="text-[11px] text-slate-400">
                      Verifies device online status, host ADB / Java / Bundletool environment, and inspects AAB manifest for valid package configuration.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-1">
                    <span className="text-[#F59E0B] font-mono font-bold text-[11px]">Steps 5-8: Build &amp; Mock Injection</span>
                    <p className="text-[11px] text-slate-400">
                      Runs <code className="text-[#F59E0B] font-mono text-[10px]">bundletool build-apks --mode=default --local-testing</code> and pre-stages mock assets into the device sandbox.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-1">
                    <span className="text-[#F59E0B] font-mono font-bold text-[11px]">Steps 9-12: Install &amp; Launch</span>
                    <p className="text-[11px] text-slate-400">
                      Executes <code className="text-[#F59E0B] font-mono text-[10px]">bundletool install-apks</code>, verifies split APKs, and handles automatic or manual launcher start.
                    </p>
                  </div>

                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-1">
                    <span className="text-[#F59E0B] font-mono font-bold text-[11px]">Steps 13-16: Live Stream &amp; Sign-off</span>
                    <p className="text-[11px] text-slate-400">
                      Monitors real-time PlayCore callbacks, evaluates PASS/FAIL assertions, calculates duration, and saves test history artifact.
                    </p>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => onNavigate('run-test')}
                    className="px-4 py-2.5 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-black font-bold text-xs flex items-center gap-2 shadow-lg shadow-amber-500/10 transition-all"
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span>Go to Run PAD Test Tab</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 6: LOGCAT MONITORING */}
          {activeSection === 'logcat-monitoring' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                  SECTION 6
                </span>
                <h3 className="text-xl font-bold text-white">6. Real-Time Logcat &amp; Asset Verification</h3>
                <p className="text-xs text-slate-400">
                  Interpreting PlayCore AssetPackManager lifecycle callbacks and transfer status codes.
                </p>
              </div>

              <div className="space-y-4 text-xs text-slate-300">
                <div className="space-y-2">
                  <h4 className="font-semibold text-slate-200 text-sm">PlayCore AssetPackStatus Code Reference:</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead className="bg-[#0D111A] text-slate-400 uppercase text-[10px] font-semibold tracking-wider border-b border-[#1E2638]">
                        <tr>
                          <th className="py-2.5 px-3">Status Code</th>
                          <th className="py-2.5 px-3">State Name</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3">Expected QA Result</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1E2638] font-mono text-[11px]">
                        <tr className="hover:bg-[#1E2638]/40">
                          <td className="py-2.5 px-3 text-[#F59E0B]">0</td>
                          <td className="py-2.5 px-3 font-sans font-semibold text-white">UNKNOWN</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Asset pack state not known yet</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Initial</td>
                        </tr>
                        <tr className="hover:bg-[#1E2638]/40">
                          <td className="py-2.5 px-3 text-[#F59E0B]">1</td>
                          <td className="py-2.5 px-3 font-sans font-semibold text-white">PENDING</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Download request queued</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Valid transition</td>
                        </tr>
                        <tr className="hover:bg-[#1E2638]/40">
                          <td className="py-2.5 px-3 text-[#F59E0B]">2</td>
                          <td className="py-2.5 px-3 font-sans font-semibold text-white">DOWNLOADING</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Asset pack bytes streaming</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Progress update (0-100%)</td>
                        </tr>
                        <tr className="hover:bg-[#1E2638]/40">
                          <td className="py-2.5 px-3 text-[#F59E0B]">3</td>
                          <td className="py-2.5 px-3 font-sans font-semibold text-white">TRANSFERRING</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Unpacking files to app sandbox</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Valid transition</td>
                        </tr>
                        <tr className="bg-emerald-500/10">
                          <td className="py-2.5 px-3 text-emerald-400 font-bold">4</td>
                          <td className="py-2.5 px-3 font-sans font-bold text-emerald-400">COMPLETED</td>
                          <td className="py-2.5 px-3 font-sans text-slate-300">Asset pack ready &amp; mounted</td>
                          <td className="py-2.5 px-3 font-sans text-emerald-400 font-semibold">PASS Requirement</td>
                        </tr>
                        <tr className="bg-rose-500/10">
                          <td className="py-2.5 px-3 text-rose-400 font-bold">5</td>
                          <td className="py-2.5 px-3 font-sans font-bold text-rose-400">FAILED</td>
                          <td className="py-2.5 px-3 font-sans text-slate-300">Download or extract error</td>
                          <td className="py-2.5 px-3 font-sans text-rose-400 font-semibold">FAIL Indicator</td>
                        </tr>
                        <tr className="hover:bg-[#1E2638]/40">
                          <td className="py-2.5 px-3 text-amber-400">6</td>
                          <td className="py-2.5 px-3 font-sans font-semibold text-white">CANCELED</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Canceled by user or app</td>
                          <td className="py-2.5 px-3 font-sans text-slate-400">Investigate intent</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 7: CONTROLLED ADB OPERATIONS */}
          {activeSection === 'adb-operations' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
                  SECTION 7
                </span>
                <h3 className="text-xl font-bold text-white">7. Controlled ADB Device Operations</h3>
                <p className="text-xs text-slate-400">
                  Quick device maintenance actions directly from the workbench.
                </p>
              </div>

              <div className="space-y-3 text-xs text-slate-300">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-emerald-400 text-xs">Launch App (Monkey / Start)</span>
                      <button
                        onClick={() => copyToClipboard('adb shell monkey -p <package> -c android.intent.category.LAUNCHER 1', 'launch')}
                        className="text-slate-400 hover:text-white"
                        title="Copy Command"
                      >
                        {copiedKey === 'launch' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Forcefully starts the application main launcher activity on the connected device.
                    </p>
                    <code className="text-[10px] text-slate-300 font-mono bg-[#131924] border border-[#1E2638] px-2 py-1 rounded block">
                      adb shell monkey -p &lt;pkg&gt; -c android.intent.category.LAUNCHER 1
                    </code>
                  </div>

                  <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#F59E0B] text-xs">Clear App Data (pm clear)</span>
                      <button
                        onClick={() => copyToClipboard('adb shell pm clear <package>', 'clear')}
                        className="text-slate-400 hover:text-white"
                        title="Copy Command"
                      >
                        {copiedKey === 'clear' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Wipes all app cache, databases, and local storage. Essential for testing fresh on-demand asset downloads.
                    </p>
                    <code className="text-[10px] text-slate-300 font-mono bg-[#131924] border border-[#1E2638] px-2 py-1 rounded block">
                      adb shell pm clear &lt;pkg&gt;
                    </code>
                  </div>

                  <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-rose-400 text-xs">Uninstall App (pm uninstall)</span>
                      <button
                        onClick={() => copyToClipboard('adb shell pm uninstall <package>', 'uninstall')}
                        className="text-slate-400 hover:text-white"
                        title="Copy Command"
                      >
                        {copiedKey === 'uninstall' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Completely uninstalls the package. Fixes <code className="text-rose-300 font-mono">INSTALL_FAILED_UPDATE_INCOMPATIBLE</code> signature conflicts.
                    </p>
                    <code className="text-[10px] text-slate-300 font-mono bg-[#131924] border border-[#1E2638] px-2 py-1 rounded block">
                      adb shell pm uninstall &lt;pkg&gt;
                    </code>
                  </div>

                  <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#F59E0B] text-xs">Clear Logcat Buffer</span>
                      <button
                        onClick={() => copyToClipboard('adb logcat -c', 'logcat')}
                        className="text-slate-400 hover:text-white"
                        title="Copy Command"
                      >
                        {copiedKey === 'logcat' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Empties the device circular log buffer so previous application session logs do not interfere with new tests.
                    </p>
                    <code className="text-[10px] text-slate-300 font-mono bg-[#131924] border border-[#1E2638] px-2 py-1 rounded block">
                      adb logcat -c
                    </code>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 8: QA CHECKLIST */}
          {activeSection === 'qa-checklist' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  SECTION 8
                </span>
                <h3 className="text-xl font-bold text-white">8. QA Sign-Off Checklist &amp; Acceptance Criteria</h3>
                <p className="text-xs text-slate-400">
                  Interactive verification checklist for release candidate certification.
                </p>
              </div>

              <div className="space-y-3 text-xs text-slate-300">
                <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-3">
                  <span className="text-xs font-semibold text-slate-200">Pre-Test Setup Verification</span>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.prereq_wifi}
                        onChange={() => toggleChecklist('prereq_wifi')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>Device and host machine are on the same Wi-Fi subnet with active signal</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.prereq_wireless_debug}
                        onChange={() => toggleChecklist('prereq_wireless_debug')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>Wireless Debugging is connected and detected in the Target Device dropdown</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.aab_verified}
                        onChange={() => toggleChecklist('aab_verified')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>Uploaded .aab package name, version code, and asset pack modules correctly match release ticket</span>
                    </label>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-3">
                  <span className="text-xs font-semibold text-slate-200">Play Asset Delivery (PAD) Functional Criteria</span>
                  <div className="space-y-2">
                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.install_time_present}
                        onChange={() => toggleChecklist('install_time_present')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>Install-Time asset packs are immediately available without network loading spinners</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.fast_follow_downloaded}
                        onChange={() => toggleChecklist('fast_follow_downloaded')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>Fast-Follow asset packs commence background download immediately upon app start</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.on_demand_triggered}
                        onChange={() => toggleChecklist('on_demand_triggered')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>On-Demand asset packs trigger PlayCore download callbacks (Status 2 -&gt; 3 -&gt; 4 COMPLETED)</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.offline_fallback_handled}
                        onChange={() => toggleChecklist('offline_fallback_handled')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>App displays appropriate retry / error messaging if assets are missing or network dropped</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.asset_integrity_verified}
                        onChange={() => toggleChecklist('asset_integrity_verified')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>Visual assets (textures, templates, 3D meshes, audio) render correctly without artifacting</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.no_anr_crashes}
                        onChange={() => toggleChecklist('no_anr_crashes')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>Zero Application Not Responding (ANR) or Fatal Exception crashes during asset extraction</span>
                    </label>

                    <label className="flex items-center gap-2.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checklist.pm_clear_reset_tested}
                        onChange={() => toggleChecklist('pm_clear_reset_tested')}
                        className="w-4 h-4 rounded text-[#F59E0B] accent-[#F59E0B] bg-[#131924] border-[#1E2638]"
                      />
                      <span>Tested app after "Clear App Data" to ensure re-download flow functions as expected</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 9: TROUBLESHOOTING */}
          {activeSection === 'troubleshooting' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  SECTION 9
                </span>
                <h3 className="text-xl font-bold text-white">9. Troubleshooting &amp; Common Issues</h3>
                <p className="text-xs text-slate-400">
                  Quick resolutions for common QA environment errors.
                </p>
              </div>

              <div className="space-y-4 text-xs text-slate-300">
                <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                  <div className="font-semibold text-[#F59E0B]">Issue: "failed to authenticate to 192.168.x.x:port" or Pairing Timeout</div>
                  <p className="text-[11px] text-slate-400">
                    <strong>Cause:</strong> The 6-digit PIN expired or the Android Wireless Debugging pairing dialog was closed before the host finished pairing.
                  </p>
                  <p className="text-[11px] text-slate-300">
                    <strong>Fix:</strong> Keep the pairing dialog open on the phone while clicking Pair. If it fails, toggle Wireless Debugging OFF and ON, generate a fresh pairing code, and retry.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                  <div className="font-semibold text-[#F59E0B]">Issue: INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package signatures do not match</div>
                  <p className="text-[11px] text-slate-400">
                    <strong>Cause:</strong> A previous build of the app signed with a different debug or release keystore is already installed on the phone.
                  </p>
                  <p className="text-[11px] text-slate-300">
                    <strong>Fix:</strong> Click <strong>"Uninstall App"</strong> in the Controlled ADB Operations card on the Run PAD Test tab, then re-run the test.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2">
                  <div className="font-semibold text-[#F59E0B]">Issue: Asset pack status returns error or does not download</div>
                  <p className="text-[11px] text-slate-400">
                    <strong>Cause:</strong> The application may not be using the PlayCore Asset Delivery library or the local testing mock directory was wiped.
                  </p>
                  <p className="text-[11px] text-slate-300">
                    <strong>Fix:</strong> Ensure the build was packaged with asset pack modules and that Bundletool <code className="text-[#F59E0B] font-mono">--local-testing</code> was executed (our test pipeline does this automatically).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 10: CHEAT SHEET */}
          {activeSection === 'cheat-sheet' && (
            <div className="space-y-6">
              <div className="space-y-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  SECTION 10
                </span>
                <h3 className="text-xl font-bold text-white">10. ADB &amp; Bundletool Cheat Sheet</h3>
                <p className="text-xs text-slate-400">
                  Standard command reference for manual CLI execution and debugging.
                </p>
              </div>

              <div className="space-y-3 text-xs text-slate-300">
                <div className="space-y-2">
                  <span className="font-semibold text-slate-200">Bundletool Local Testing Commands:</span>
                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2 font-mono text-[11px]">
                    <div className="text-slate-400"># 1. Build Split APKs with local mock asset packs:</div>
                    <div className="text-[#F59E0B] bg-[#131924] border border-[#1E2638] p-2 rounded flex items-center justify-between">
                      <span className="break-all">java -jar bundletool.jar build-apks --bundle=app.aab --output=app.apks --mode=default --local-testing --overwrite</span>
                      <button
                        onClick={() => copyToClipboard('java -jar bundletool.jar build-apks --bundle=app.aab --output=app.apks --mode=default --local-testing --overwrite', 'bt_build')}
                        className="ml-2 text-slate-400 hover:text-white"
                      >
                        {copiedKey === 'bt_build' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>

                    <div className="text-slate-400 pt-2"># 2. Install Split APKs to connected device:</div>
                    <div className="text-[#F59E0B] bg-[#131924] border border-[#1E2638] p-2 rounded flex items-center justify-between">
                      <span className="break-all">java -jar bundletool.jar install-apks --apks=app.apks --adb=adb.exe --device-id=&lt;serial&gt;</span>
                      <button
                        onClick={() => copyToClipboard('java -jar bundletool.jar install-apks --apks=app.apks --adb=adb.exe --device-id=<serial>', 'bt_install')}
                        className="ml-2 text-slate-400 hover:text-white"
                      >
                        {copiedKey === 'bt_install' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="space-y-2 pt-3 border-t border-[#1E2638]">
                  <span className="font-semibold text-slate-200">ADB Wireless &amp; Logging Commands:</span>
                  <div className="p-3.5 rounded-xl bg-[#0A0D14] border border-[#1E2638] space-y-2 font-mono text-[11px]">
                    <div className="text-slate-400"># Pair device with code:</div>
                    <div className="text-[#F59E0B] bg-[#131924] border border-[#1E2638] p-2 rounded">adb pair 192.168.0.160:37451 123456</div>

                    <div className="text-slate-400 pt-1"># Connect to device:</div>
                    <div className="text-[#F59E0B] bg-[#131924] border border-[#1E2638] p-2 rounded">adb connect 192.168.0.160:5555</div>

                    <div className="text-slate-400 pt-1"># Stream PlayCore asset logs:</div>
                    <div className="text-[#F59E0B] bg-[#131924] border border-[#1E2638] p-2 rounded">adb -s 192.168.0.160:5555 logcat -s PlayCore:* AssetPack:*</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
