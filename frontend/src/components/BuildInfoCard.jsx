import React from 'react';
import { Layers, Sparkles, CheckCircle2, Trash2 } from 'lucide-react';
import BuildThumbnail from './BuildThumbnail';

export default function BuildInfoCard({ build, isSelected, onSelect, onDelete }) {
  if (!build) return null;

  const getDeliveryBadgeClass = (mode) => {
    switch (mode) {
      case 'fast-follow':
        return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
      case 'install-time':
        return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
      case 'on-demand':
        return 'bg-purple-500/10 text-purple-300 border-purple-500/30';
      default:
        return 'bg-[#1E2638] text-[#CBD5E1] border-[#334155]';
    }
  };

  return (
    <div className={`p-5 rounded-2xl glass transition-all ${
      isSelected 
        ? 'border-[#7c6cf6] shadow-magic/25 dark:border-[#F59E0B] dark:shadow-lg dark:shadow-[#F59E0B]/10' 
        : 'border-[rgba(99,102,241,0.14)] hover:border-[#7c6cf6]/30 shadow-glass'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <BuildThumbnail build={build} size="md" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-extrabold text-[#1f2544] dark:text-[#FFFFFF] text-sm break-all">{build.fileName || build.applicationName || 'Application Build'}</h3>
              <span className={`text-[10px] uppercase font-mono px-2 py-0.5 rounded-full font-bold border ${
                build.fileType === 'apk' || build.fileName?.endsWith('.apk')
                  ? 'bg-violet-100 text-[#7c6cf6] border-violet-200'
                  : 'bg-violet-50 text-[#7c6cf6] border-violet-200 dark:bg-[#16130C] dark:text-[#F59E0B] dark:border-[#F59E0B]/40'
              }`}>
                {build.fileType === 'apk' || build.fileName?.endsWith('.apk') ? 'APK' : 'AAB'}
              </span>
            </div>
            <p className="text-xs text-[#6b7194] dark:text-[#94A3B8] font-mono">{build.packageName}{build.applicationName && ` • ${build.applicationName}`}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isSelected && (
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[#7c6cf6] text-white dark:bg-[#F59E0B] dark:text-[#000000] shadow-sm">
              Selected
            </span>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(build.id)}
              className="p-1.5 rounded-xl text-[#6b7194] hover:text-rose-500 hover:bg-rose-50 dark:text-[#64748B] dark:hover:text-rose-400 dark:hover:bg-rose-500/10 transition-colors cursor-pointer"
              title="Delete Build"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Build Details Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-200 dark:border-[#1C2230]">
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#94A3B8]">Version</span>
          <p className="text-xs font-medium text-slate-700 dark:text-[#CBD5E1] font-mono">{build.versionName || '1.0'} ({build.versionCode || '1'})</p>
        </div>

        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#94A3B8]">Target SDK</span>
          <p className="text-xs font-medium text-slate-700 dark:text-[#CBD5E1] font-mono">API {build.targetSdkVersion || '34'}</p>
        </div>

        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#94A3B8]">Min SDK</span>
          <p className="text-xs font-medium text-slate-700 dark:text-[#CBD5E1] font-mono">API {build.minSdkVersion || '24'}</p>
        </div>

        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-[#94A3B8]">File Size</span>
          <p className="text-xs font-medium text-slate-700 dark:text-[#CBD5E1] font-mono">
            {build.fileSize ? `${(build.fileSize / (1024 * 1024)).toFixed(1)} MB` : 'N/A'}
          </p>
        </div>
      </div>

      {/* Asset Packs Breakdown */}
      <div className="mt-4 pt-3 border-t border-slate-200 dark:border-[#1C2230]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-[#CBD5E1]">
            <Layers className="w-3.5 h-3.5 text-purple-600 dark:text-[#F59E0B]" />
            <span>Asset Packs ({build.assetPacks?.length || 0})</span>
          </div>
          <span className="text-[11px] text-slate-400 dark:text-[#64748B] font-mono">
            {build.assetPacks?.length > 0 ? 'Play Asset Delivery' : 'Standard APK'}
          </span>
        </div>

        {build.assetPacks && build.assetPacks.length > 0 ? (
          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
            {build.assetPacks.map((pack, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200 dark:bg-[#080B10] dark:border-[#1C2230] text-xs"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3 h-3 text-purple-600 dark:text-[#F59E0B]" />
                  <span className="font-mono text-slate-800 dark:text-[#CBD5E1]">{pack.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getDeliveryBadgeClass(pack.deliveryType)}`}>
                    {pack.deliveryType || 'on-demand'}
                  </span>
                  <span className="text-[11px] text-slate-500 dark:text-[#94A3B8] font-mono">
                    {pack.formattedSize || (pack.size ? `${(pack.size / (1024 * 1024)).toFixed(1)} MB` : 'Detected')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-400 dark:text-[#64748B] italic py-1">
            No distinct asset packs detected in this AAB module manifest.
          </p>
        )}
      </div>

      {/* Footer select button */}
      {!isSelected && onSelect && (
        <div className="mt-4 pt-3 border-t border-slate-200 dark:border-[#1C2230] flex justify-end">
          <button
            onClick={() => onSelect(build)}
            className="px-3.5 py-1.5 rounded-lg btn-primary-gradient text-xs font-bold text-white shadow-sm transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-white" />
            <span>Select for Testing</span>
          </button>
        </div>
      )}
    </div>
  );
}
