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
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1f2544] dark:text-white tracking-tight font-sans">
              Builds &amp; <span className="text-heading-gradient">AAB</span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6b7194] dark:text-[#94A3B8] mt-1">
              Upload and inspect Android App Bundles with automatic Play Asset Delivery pack detection.
            </p>
          </div>
        </div>

        <button
          onClick={onOpenUploadModal}
          className="btn-magic text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-magic flex items-center gap-2 cursor-pointer"
        >
          <UploadCloud className="w-4 h-4 text-white" />
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
        <div className="p-12 rounded-2xl glass text-center space-y-4 shadow-glass">
          <div className="brand-mark w-14 h-14 rounded-2xl mx-auto flex items-center justify-center">
            <Package className="w-7 h-7 text-white" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-[#1f2544] dark:text-[#FFFFFF]">No AAB Builds Uploaded</h3>
            <p className="text-xs text-[#6b7194] dark:text-[#94A3B8] max-w-sm mx-auto mt-1">
              Upload your latest <span className="font-mono text-[#1f2544] bg-white dark:text-[#FFFFFF] dark:bg-[#080B10] px-1.5 py-0.5 rounded border border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">.aab</span> build file to analyze its asset packs and run local PAD tests.
            </p>
          </div>
          <button
            onClick={onOpenUploadModal}
            className="btn-magic px-5 py-2.5 rounded-xl text-white text-xs font-bold shadow-magic inline-flex items-center gap-2 cursor-pointer"
          >
            <UploadCloud className="w-4 h-4 text-white" />
            <span>Upload AAB Build</span>
          </button>
        </div>
      )}
    </div>
  );
}
