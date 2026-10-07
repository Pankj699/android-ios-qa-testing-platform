import React from 'react';
import {
  Smartphone,
  Package,
  PlayCircle,
  CheckCircle2,
  XCircle,
  Activity,
  Layers,
  ArrowRight,
  Wifi,
  UploadCloud,
  History,
  Compass,
  BookOpen,
  Sparkles,
  Tv
} from 'lucide-react';

export default function Dashboard({
  devices,
  selectedDevice,
  builds,
  selectedBuild,
  summaryStats,
  onNavigate,
  onOpenPairModal,
  onOpenUploadModal,
  onOpenTourModal,
  onStartQuickTest
}) {
  const recentTests = summaryStats?.recentTests || [];

  return (
    <div className="space-y-6 fade-in">
      {/* Welcome Banner */}
      <div className="p-6 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[#10B981] animate-pulse"></span>
            <h2 className="text-base font-bold text-[#FFFFFF]">Play Asset Delivery QA Dashboard</h2>
          </div>
          <p className="text-xs text-[#94A3B8] max-w-xl">
            Execute automated Play Asset Delivery local testing on Android physical devices via Wireless Debugging, Bundletool, and real-time Logcat monitoring.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          {onOpenTourModal && (
            <button
              onClick={onOpenTourModal}
              className="px-3.5 py-2 rounded-lg bg-[#261D10] hover:bg-[#3D2C15] text-xs font-semibold text-[#F59E0B] hover:text-[#FBBF24] border border-[#78350F] transition-all flex items-center gap-1.5"
            >
              <Compass className="w-4 h-4 text-[#F59E0B]" />
              <span>Take App Tour</span>
            </button>
          )}

          <button
            onClick={() => onNavigate('sop')}
            className="px-3.5 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-[#CBD5E1] hover:text-[#FFFFFF] border border-[#334155] transition-all flex items-center gap-1.5"
          >
            <BookOpen className="w-4 h-4 text-[#64748B]" />
            <span>SOP Guide</span>
          </button>

          <button
            onClick={() => onNavigate('run-test')}
            className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-all flex items-center gap-2 cursor-pointer"
          >
            <PlayCircle className="w-4 h-4 text-[#000000]" />
            <span>Open Test Console</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-[#94A3B8]">Total PAD Tests</span>
            <p className="text-xl font-bold text-[#FFFFFF] mt-1 font-mono">{summaryStats?.totalTests || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
            <Activity className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-[#94A3B8]">Pass Rate</span>
            <p className="text-xl font-bold text-[#10B981] mt-1 font-mono">{summaryStats?.passRate || '0%'}</p>
          </div>
          <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-[#94A3B8]">Connected Devices</span>
            <p className="text-xl font-bold text-[#FFFFFF] mt-1 font-mono">{devices?.length || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Smartphone className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm flex items-center justify-between">
          <div>
            <span className="text-xs text-[#94A3B8]">Uploaded Builds</span>
            <p className="text-xl font-bold text-[#FFFFFF] mt-1 font-mono">{builds?.length || 0}</p>
          </div>
          <div className="p-3 rounded-lg bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
            <Package className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main 2-Column Section: Active Device & Build */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Device Status Card */}
        <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-[#F59E0B]" />
              <h3 className="text-xs font-semibold text-[#CBD5E1] uppercase tracking-wide">Target Device</h3>
            </div>
            <button
              onClick={onOpenPairModal}
              className="text-xs text-[#F59E0B] hover:text-[#FBBF24] flex items-center gap-1 font-medium transition-colors"
            >
              <Wifi className="w-3.5 h-3.5" />
              <span>Pair / Connect</span>
            </button>
          </div>

          {selectedDevice ? (
            <div className="p-4 rounded-lg bg-[#0A0D14] border border-[#1E2638] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-[#FFFFFF] flex items-center gap-2">
                  {selectedDevice.name || selectedDevice.model}
                  {selectedDevice.platform === 'ios' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30">
                      iOS
                    </span>
                  )}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> Connected
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-[#94A3B8] pt-1 font-mono">
                <div>
                  OS: <span className="text-[#CBD5E1]">
                    {selectedDevice.platform === 'ios'
                      ? (selectedDevice.osVersion || (selectedDevice.iosVersion ? `iOS ${selectedDevice.iosVersion}` : 'iOS'))
                      : (selectedDevice.androidVersion || 'Android')}
                  </span>
                </div>
                <div>Battery: <span className="text-[#CBD5E1]">{selectedDevice.battery || 'N/A'}</span></div>
                <div>Storage: <span className="text-[#CBD5E1]">{selectedDevice.storageFree || 'N/A'}</span></div>
                <div>Serial: <span className="text-[#CBD5E1] truncate">{selectedDevice.serial}</span></div>
              </div>

              <div className="pt-2 border-t border-[#1E2638] flex items-center justify-between">
                <button
                  onClick={() => onNavigate('screen-mirror')}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#261D10] hover:bg-[#3D2C15] border border-[#78350F] text-xs font-semibold text-[#F59E0B] hover:text-[#FBBF24] transition-all shadow-sm"
                >
                  <Tv className="w-3.5 h-3.5" />
                  <span>Open Screen Mirror</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-lg border border-dashed border-[#1E2638] bg-[#0A0D14]/50 text-center space-y-2">
              <p className="text-xs text-[#94A3B8]">No device connected currently.</p>
              <button
                onClick={onOpenPairModal}
                className="px-3 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-[#FFFFFF] transition-colors"
              >
                Connect Device via Wireless Debugging
              </button>
            </div>
          )}
        </div>

        {/* Latest Build Card */}
        <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-[#F59E0B]" />
              <h3 className="text-xs font-semibold text-[#CBD5E1] uppercase tracking-wide">Active Build</h3>
            </div>
            <button
              onClick={onOpenUploadModal}
              className="text-xs text-[#F59E0B] hover:text-[#FBBF24] flex items-center gap-1 font-medium transition-colors"
            >
              <UploadCloud className="w-3.5 h-3.5" />
              <span>Upload .aab</span>
            </button>
          </div>

          {selectedBuild ? (
            <div className="p-4 rounded-lg bg-[#0A0D14] border border-[#1E2638] space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-sm text-[#FFFFFF] break-all">{selectedBuild.fileName || selectedBuild.applicationName || 'App Build'}</span>
                <span className="text-[11px] font-mono text-[#94A3B8]">{selectedBuild.versionName} ({selectedBuild.versionCode})</span>
              </div>
              <p className="text-xs text-[#94A3B8] font-mono">{selectedBuild.packageName}{selectedBuild.applicationName && ` • ${selectedBuild.applicationName}`}</p>
              <div className="flex items-center gap-2 pt-1 text-xs text-[#94A3B8]">
                <Layers className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>{selectedBuild.assetPacks?.length || 0} Asset Packs detected</span>
              </div>
            </div>
          ) : (
            <div className="p-6 rounded-lg border border-dashed border-[#1E2638] bg-[#0A0D14]/50 text-center space-y-2">
              <p className="text-xs text-[#94A3B8]">No .aab build uploaded yet.</p>
              <button
                onClick={onOpenUploadModal}
                className="px-3 py-1.5 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-[#FFFFFF] transition-colors"
              >
                Upload Android App Bundle
              </button>
            </div>
          )}
        </div>
      </div>

      {/* SOP Quick Guide Banner */}
      <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-[#261D10] border border-[#78350F] flex items-center justify-center text-[#F59E0B] shrink-0">
            <BookOpen className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <h3 className="text-sm font-bold text-[#FFFFFF]">Standard Operating Procedure (SOP) Reference</h3>
            <p className="text-xs text-[#94A3B8]">
              Need help configuring Wireless Debugging, understanding PlayCore status codes, or checking QA sign-off criteria?
            </p>
          </div>
        </div>

        <button
          onClick={() => onNavigate('sop')}
          className="px-4 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-[#FFFFFF] border border-[#334155] transition-all flex items-center gap-2 shrink-0"
        >
          <span>Open SOP Guide</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Recent Test History Section */}
      <div className="p-5 rounded-xl bg-[#131924] border border-[#1E2638] shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#F59E0B]" />
            <h3 className="text-xs font-semibold text-[#CBD5E1] uppercase tracking-wide">Recent Test Runs</h3>
          </div>
          <button
            onClick={() => onNavigate('history')}
            className="text-xs text-[#F59E0B] hover:text-[#FBBF24] flex items-center gap-1 font-medium transition-colors"
          >
            <span>View All History</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentTests.length > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-[#1E2638]">
            <table className="w-full text-left text-xs text-[#CBD5E1]">
              <thead className="bg-[#0D111A] text-[#94A3B8] uppercase text-[10px] border-b border-[#1E2638]">
                <tr>
                  <th className="py-2.5 px-3">Date/Time</th>
                  <th className="py-2.5 px-3">Package / Build</th>
                  <th className="py-2.5 px-3">Target Device</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3">Duration</th>
                  <th className="py-2.5 px-3">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E2638] font-mono">
                {recentTests.map((t) => (
                  <tr key={t.id} className="hover:bg-[#1E2638]/40 transition-colors">
                    <td className="py-2.5 px-3 text-[#94A3B8]">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-[#FFFFFF] font-sans">
                      <div>{t.packageName || 'App'}</div>
                      <div className="text-[10px] text-[#64748B]">{t.version}</div>
                    </td>
                    <td className="py-2.5 px-3 font-sans text-[#CBD5E1]">{t.deviceName || t.deviceSerial}</td>
                    <td className="py-2.5 px-3 font-sans text-[#94A3B8]">{t.installMode || 'Fresh Install'}</td>
                    <td className="py-2.5 px-3 text-[#94A3B8]">{t.duration || '-'}</td>
                    <td className="py-2.5 px-3">
                      {t.result === 'PASS' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 font-sans font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-400 font-sans font-semibold">
                          <XCircle className="w-3.5 h-3.5" /> FAIL
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-[#64748B] italic py-4 text-center">
            No test runs recorded yet. Start a test from the Run PAD Test tab.
          </p>
        )}
      </div>
    </div>
  );
}
