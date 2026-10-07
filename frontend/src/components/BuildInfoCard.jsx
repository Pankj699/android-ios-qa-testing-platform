import React from 'react';
import { Package, Layers, Sparkles, CheckCircle2, Trash2 } from 'lucide-react';

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
    <div className={`p-5 rounded-xl border transition-all ${
      isSelected 
        ? 'bg-[#131924] border-[#F59E0B] shadow-md shadow-[#F59E0B]/10' 
        : 'bg-[#131924] border-[#1E2638] hover:border-[#334155]'
    }`}>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-[#261D10] border border-[#78350F] text-[#F59E0B]">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-[#FFFFFF] text-sm break-all">{build.fileName || build.applicationName || 'Application Build'}</h3>
              <span className={`text-[10px] uppercase font-mono px-1.5 py-0.2 rounded font-bold border ${
                build.fileType === 'apk' || build.fileName?.endsWith('.apk')
                  ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                  : 'bg-[#261D10] text-[#F59E0B] border-[#78350F]'
              }`}>
                {build.fileType === 'apk' || build.fileName?.endsWith('.apk') ? 'APK' : 'AAB'}
              </span>
            </div>
            <p className="text-xs text-[#94A3B8] font-mono">{build.packageName}{build.applicationName && ` • ${build.applicationName}`}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isSelected && (
            <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-[#F59E0B] text-[#000000]">
              Selected
            </span>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(build.id)}
              className="p-1.5 rounded-lg text-[#64748B] hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
              title="Delete Build"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Build Details Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t border-[#1E2638]">
        <div className="space-y-1">
          <span className="text-[11px] text-[#94A3B8]">Version</span>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">{build.versionName || '1.0'} ({build.versionCode || '1'})</p>
        </div>

        <div className="space-y-1">
          <span className="text-[11px] text-[#94A3B8]">Target SDK</span>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">API {build.targetSdkVersion || '34'}</p>
        </div>

        <div className="space-y-1">
          <span className="text-[11px] text-[#94A3B8]">Min SDK</span>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">API {build.minSdkVersion || '24'}</p>
        </div>

        <div className="space-y-1">
          <span className="text-[11px] text-[#94A3B8]">File Size</span>
          <p className="text-xs font-medium text-[#CBD5E1] font-mono">
            {build.fileSize ? `${(build.fileSize / (1024 * 1024)).toFixed(1)} MB` : 'N/A'}
          </p>
        </div>
      </div>

      {/* Asset Packs Breakdown */}
      <div className="mt-4 pt-3 border-t border-[#1E2638]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#CBD5E1]">
            <Layers className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>Asset Packs ({build.assetPacks?.length || 0})</span>
          </div>
          <span className="text-[11px] text-[#64748B] font-mono">
            {build.assetPacks?.length > 0 ? 'Play Asset Delivery' : 'Standard APK'}
          </span>
        </div>

        {build.assetPacks && build.assetPacks.length > 0 ? (
          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
            {build.assetPacks.map((pack, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between p-2 rounded-lg bg-[#0A0D14] border border-[#1E2638] text-xs"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="w-3 h-3 text-[#F59E0B]" />
                  <span className="font-mono text-[#CBD5E1]">{pack.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${getDeliveryBadgeClass(pack.deliveryType)}`}>
                    {pack.deliveryType || 'on-demand'}
                  </span>
                  <span className="text-[11px] text-[#94A3B8] font-mono">
                    {pack.formattedSize || (pack.size ? `${(pack.size / (1024 * 1024)).toFixed(1)} MB` : 'Detected')}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#64748B] italic py-1">
            No distinct asset packs detected in this AAB module manifest.
          </p>
        )}
      </div>

      {/* Footer select button */}
      {!isSelected && onSelect && (
        <div className="mt-4 pt-3 border-t border-[#1E2638] flex justify-end">
          <button
            onClick={() => onSelect(build)}
            className="px-3.5 py-1.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-colors flex items-center gap-1.5"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-[#000000]" />
            <span>Select for Testing</span>
          </button>
        </div>
      )}
    </div>
  );
}
