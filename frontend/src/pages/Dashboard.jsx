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
  Sparkles,
  Tv
} from 'lucide-react';
import { formatDeviceDisplayName, formatDeviceOsVersion } from '../utils/deviceFormatter';
import DeviceThumbnail from '../components/DeviceThumbnail';
import BuildThumbnail from '../components/BuildThumbnail';

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
      {/* Welcome Hero Banner */}
      <div className="p-6 rounded-2xl glass flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="dot ok"></span>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1f2544] dark:text-white tracking-tight font-sans">
              QA <span className="text-heading-gradient">Dashboard</span>
            </h1>
          </div>
          <p className="text-xs sm:text-[13px] text-[#6b7194] dark:text-[#94A3B8] max-w-xl leading-relaxed mt-1">
            Execute automated Play Asset Delivery local testing on Android physical devices via Wireless Debugging, Bundletool, and real-time Logcat monitoring.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            onClick={() => onNavigate('run-test')}
            className="btn-magic text-white text-xs font-bold shadow-magic px-4 py-2.5 rounded-xl flex items-center gap-2 cursor-pointer"
          >
            <PlayCircle className="w-4 h-4 text-white" />
            <span>Open Test Console</span>
          </button>
        </div>
      </div>

      {/* Summary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat glass p-4 flex items-center justify-between rounded-2xl">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6b7194] dark:text-[#94A3B8]">Total PAD Tests</span>
            <p className="text-2xl font-extrabold text-[#1f2544] dark:text-[#FFFFFF] mt-1 font-mono">{summaryStats?.totalTests || 0}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-violet-100/80 text-[#7c6cf6] border border-violet-200/50 dark:bg-[#16130C] dark:text-[#F59E0B] dark:border-[#F59E0B]/40 flex items-center justify-center shrink-0">
            <Activity className="w-5 h-5" />
          </div>
        </div>

        <div className="stat glass p-4 flex items-center justify-between rounded-2xl">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6b7194] dark:text-[#94A3B8]">Pass Rate</span>
            <p className="text-2xl font-extrabold text-[#10B981] mt-1 font-mono">{summaryStats?.passRate || '0%'}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-emerald-100/80 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="stat glass p-4 flex items-center justify-between rounded-2xl">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6b7194] dark:text-[#94A3B8]">Connected Devices</span>
            <p className="text-2xl font-extrabold text-[#1f2544] dark:text-[#FFFFFF] mt-1 font-mono">{devices?.length || 0}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-sky-100/80 text-sky-600 dark:text-sky-400 border border-sky-200/50 flex items-center justify-center shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>
        </div>

        <div className="stat glass p-4 flex items-center justify-between rounded-2xl">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#6b7194] dark:text-[#94A3B8]">Uploaded Builds</span>
            <p className="text-2xl font-extrabold text-[#1f2544] dark:text-[#FFFFFF] mt-1 font-mono">{builds?.length || 0}</p>
          </div>
          <div className="w-11 h-11 rounded-xl bg-pink-100/80 text-pink-600 border border-pink-200/50 dark:bg-[#16130C] dark:text-[#F59E0B] dark:border-[#F59E0B]/40 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Main 2-Column Section: Active Device & Build */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Device Status Card */}
        <div className="p-6 rounded-2xl glass space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-[#7c6cf6] dark:text-[#F59E0B]" />
              <h3 className="section-label font-bold tracking-wide">Target Device</h3>
            </div>
            <button
              onClick={onOpenPairModal}
              className="btn-soft text-xs py-1 px-3 rounded-full flex items-center gap-1 font-semibold cursor-pointer"
            >
              <Wifi className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B]" />
              <span>Pair / Connect</span>
            </button>
          </div>

          {selectedDevice ? (
            <div className="p-4 rounded-xl bg-white/70 border border-[rgba(99,102,241,0.14)] dark:bg-[#080B10] dark:border-[#1C2230] space-y-3">
              <div className="flex items-center gap-4">
                <DeviceThumbnail device={selectedDevice} size="lg" className="shadow-md shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-[#1f2544] dark:text-[#FFFFFF] truncate flex items-center gap-2 min-w-0">
                      <span className="truncate">{formatDeviceDisplayName(selectedDevice)}</span>
                      {selectedDevice.platform === 'ios' && (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/30 shrink-0">
                          iOS
                        </span>
                      )}
                    </span>
                    <span className="status-pill text-[10px] text-emerald-600 shrink-0">
                      <span className="dot ok"></span> Connected
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-[#6b7194] dark:text-[#94A3B8] font-mono">
                    <div>
                      OS: <span className="text-[#1f2544] dark:text-[#CBD5E1]">
                        {formatDeviceOsVersion(selectedDevice) || 'N/A'}
                      </span>
                    </div>
                    <div>Battery: <span className="text-[#1f2544] dark:text-[#CBD5E1]">{selectedDevice.battery || 'N/A'}</span></div>
                    <div>Storage: <span className="text-[#1f2544] dark:text-[#CBD5E1]">{selectedDevice.storageFree || 'N/A'}</span></div>
                    <div>Serial: <span className="text-[#1f2544] dark:text-[#CBD5E1] truncate">{selectedDevice.serial}</span></div>
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-[rgba(99,102,241,0.14)] dark:border-[#1C2230] flex items-center justify-between">
                <button
                  onClick={() => onNavigate('screen-mirror')}
                  className="w-full btn-soft py-2 px-3 text-xs font-bold rounded-xl cursor-pointer"
                >
                  <Tv className="w-3.5 h-3.5 text-[#7c6cf6]" />
                  <span>Open Screen Mirror</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-xl border border-dashed border-violet-200 dark:border-[#1C2230] bg-violet-50/20 dark:bg-[#080B10]/50 text-center space-y-3">
              <p className="text-xs text-[#6b7194] dark:text-[#94A3B8]">No device connected currently.</p>
              <button
                onClick={onOpenPairModal}
                className="btn-soft py-2 px-4 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Connect Device via Wireless Debugging
              </button>
            </div>
          )}
        </div>

        {/* Latest Build Card */}
        <div className="p-6 rounded-2xl glass space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-[#7c6cf6] dark:text-[#F59E0B]" />
              <h3 className="section-label font-bold tracking-wide">Active Build</h3>
            </div>
            <button
              onClick={onOpenUploadModal}
              className="btn-soft text-xs py-1 px-3 rounded-full flex items-center gap-1 font-semibold cursor-pointer"
            >
              <UploadCloud className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B]" />
              <span>Upload .aab</span>
            </button>
          </div>

          {selectedBuild ? (
            <div className="p-4 rounded-xl bg-white/70 border border-[rgba(99,102,241,0.14)] dark:bg-[#080B10] dark:border-[#1C2230] space-y-3">
              <div className="flex items-center gap-3">
                <BuildThumbnail build={selectedBuild} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-sm text-[#1f2544] dark:text-[#FFFFFF] truncate">{selectedBuild.fileName || selectedBuild.applicationName || 'App Build'}</span>
                    <span className="text-[11px] font-mono text-[#6b7194] dark:text-[#94A3B8] shrink-0 ml-2">{selectedBuild.versionName} ({selectedBuild.versionCode})</span>
                  </div>
                  <p className="text-xs text-[#6b7194] dark:text-[#94A3B8] font-mono truncate">{selectedBuild.packageName}{selectedBuild.applicationName && ` • ${selectedBuild.applicationName}`}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]/60 text-xs text-[#6b7194] dark:text-[#94A3B8]">
                <Layers className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-[#F59E0B]" />
                <span>{selectedBuild.assetPacks?.length || 0} Asset Packs detected</span>
              </div>
            </div>
          ) : (
            <div className="p-8 rounded-xl border border-dashed border-violet-200 dark:border-[#1C2230] bg-violet-50/20 dark:bg-[#080B10]/50 text-center space-y-3">
              <p className="text-xs text-[#6b7194] dark:text-[#94A3B8]">No .aab build uploaded yet.</p>
              <button
                onClick={onOpenUploadModal}
                className="btn-soft py-2 px-4 rounded-xl text-xs font-semibold cursor-pointer"
              >
                Upload Android App Bundle
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Recent Test History Section */}
      <div className="p-6 rounded-2xl glass space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-[#7c6cf6] dark:text-[#F59E0B]" />
            <h3 className="section-label font-bold tracking-wide">Recent Test Runs</h3>
          </div>
          <button
            onClick={() => onNavigate('history')}
            className="btn-soft text-xs py-1 px-3 rounded-full flex items-center gap-1 font-semibold cursor-pointer"
          >
            <span>View All History</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {recentTests.length > 0 ? (
          <div className="overflow-x-auto rounded-xl border border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">
            <table className="w-full text-left text-xs text-[#1f2544] dark:text-[#CBD5E1]">
              <thead className="bg-violet-50/60 text-[#6b7194] dark:bg-[#080B10] dark:text-[#94A3B8] uppercase text-[10px] font-bold border-b border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">
                <tr>
                  <th className="py-3 px-3.5">Date/Time</th>
                  <th className="py-3 px-3.5">Package / Build</th>
                  <th className="py-3 px-3.5">Target Device</th>
                  <th className="py-3 px-3.5">Type</th>
                  <th className="py-3 px-3.5">Duration</th>
                  <th className="py-3 px-3.5">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(99,102,241,0.14)] dark:divide-[#1C2230] font-mono">
                {recentTests.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-[#1C2230]/40 transition-colors">
                    <td className="py-2.5 px-3 text-slate-500 dark:text-[#94A3B8]">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-slate-900 dark:text-[#FFFFFF] font-sans">
                      <div className="flex items-center gap-2">
                        <BuildThumbnail
                          iconUrl={t.iconUrl}
                          packageName={t.packageName}
                          applicationName={t.applicationName}
                          size="xs"
                        />
                        <div>
                          <div>{t.packageName || 'App'}</div>
                          <div className="text-[10px] text-slate-400 dark:text-[#64748B]">{t.version}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-700 dark:text-[#CBD5E1]">
                      <div className="flex items-center gap-1.5">
                        <DeviceThumbnail device={{ name: t.deviceName, serial: t.deviceSerial, osVersion: t.androidVersion || t.osVersion, platform: t.platform }} size="xs" />
                        <span>{formatDeviceDisplayName({ name: t.deviceName, serial: t.deviceSerial, osVersion: t.androidVersion || t.osVersion, platform: t.platform })}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-500 dark:text-[#94A3B8]">{t.installMode || 'Fresh Install'}</td>
                    <td className="py-2.5 px-3 text-slate-500 dark:text-[#94A3B8]">{t.duration || '-'}</td>
                    <td className="py-2.5 px-3">
                      {t.result === 'PASS' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-sans font-semibold">
                          <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 font-sans font-semibold">
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
          <p className="text-xs text-slate-400 dark:text-[#64748B] italic py-4 text-center">
            No test runs recorded yet. Start a test from the Run PAD Test tab.
          </p>
        )}
      </div>
    </div>
  );
}
