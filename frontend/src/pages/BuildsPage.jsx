import React from 'react';
import { Package, UploadCloud, RefreshCw, AlertCircle, Layers } from 'lucide-react';
import BuildInfoCard from '../components/BuildInfoCard';

export default function BuildsPage({
  builds,
  selectedBuild,
  onSelectBuild,
  onOpenUploadModal,
  onDeleteBuild,
  loading
}) {
  return (
    <div className="space-y-6 fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#1E2638]">
        <div>
          <h2 className="text-xl font-bold text-[#FFFFFF] flex items-center gap-2.5">
            <Package className="w-5 h-5 text-[#F59E0B]" />
            Android App Bundle (.aab) Builds
          </h2>
          <p className="text-xs text-[#94A3B8] mt-1">
            Upload and inspect Android App Bundles with automatic Play Asset Delivery pack detection.
          </p>
        </div>

        <button
          onClick={onOpenUploadModal}
          className="px-3.5 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-all flex items-center gap-2"
        >
          <UploadCloud className="w-4 h-4 text-[#000000]" />
          <span>Upload Latest Build (.aab)</span>
        </button>
      </div>

      {/* Builds Grid */}
      {builds && builds.length > 0 ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {builds.map((build) => (
            <BuildInfoCard
              key={build.id}
              build={build}
              isSelected={selectedBuild?.id === build.id}
              onSelect={onSelectBuild}
              onDelete={onDeleteBuild}
            />
          ))}
        </div>
      ) : (
        <div className="p-12 rounded-2xl border-2 border-dashed border-[#1E2638] text-center space-y-3 bg-[#131924]/40">
          <Package className="w-10 h-10 text-[#64748B] mx-auto opacity-50" />
          <div>
            <h3 className="text-sm font-semibold text-[#FFFFFF]">No AAB Builds Uploaded</h3>
            <p className="text-xs text-[#94A3B8] max-w-sm mx-auto mt-1">
              Upload your latest <span className="font-mono text-[#FFFFFF] bg-[#0A0D14] px-1.5 py-0.5 rounded border border-[#1E2638]">.aab</span> build file to analyze its asset packs and run local PAD tests.
            </p>
          </div>
          <button
            onClick={onOpenUploadModal}
            className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] text-xs font-bold text-[#000000] shadow transition-all inline-flex items-center gap-2"
          >
            <UploadCloud className="w-4 h-4 text-[#000000]" />
            <span>Upload AAB Build</span>
          </button>
        </div>
      )}
    </div>
  );
}
