import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UploadCloud, FileArchive, CheckCircle2, AlertCircle, Loader2, X, Package } from 'lucide-react';
import { api } from '../services/api';

export default function AabUploadModal({ isOpen, onClose, onBuildUploaded }) {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [uploadedBuild, setUploadedBuild] = useState(null);
  const fileInputRef = useRef(null);
  const closeTimeoutRef = useRef(null);

  const resetState = useCallback(() => {
    setDragActive(false);
    setFile(null);
    setUploading(false);
    setError(null);
    setUploadedBuild(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  // Reset transient upload state every time the modal is opened
  useEffect(() => {
    if (isOpen) {
      resetState();
    } else {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
    }
  }, [isOpen, resetState]);

  // Clean up any pending timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  const handleClose = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    resetState();
    if (onClose) onClose();
  };

  if (!isOpen) return null;

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      handleSelectedFile(e.target.files[0]);
    }
  };

  const handleSelectedFile = (selectedFile) => {
    const name = selectedFile.name.toLowerCase();
    if (!name.endsWith('.aab') && !name.endsWith('.apk')) {
      setError('Invalid file format. Please upload an Android App Bundle (.aab) or Package (.apk) file.');
      return;
    }
    setError(null);
    setFile(selectedFile);
  };

  const handleUploadAndAnalyze = async () => {
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const res = await api.uploadAab(file);
      setUploadedBuild(res.build);
      closeTimeoutRef.current = setTimeout(() => {
        if (onBuildUploaded) onBuildUploaded(res.build);
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err.message || 'Failed to upload and analyze build.');
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-[#131924] border border-[#1E2638] rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1E2638] flex items-center justify-between bg-[#0D111A]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-[#261D10] text-[#F59E0B] border border-[#78350F]">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-white text-sm">Upload Build (.aab or .apk)</h3>
              <p className="text-xs text-slate-400">Play Asset Delivery & Standalone Package Inspection</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#1E2638] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {uploadedBuild && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span>Build Analyzed & Ready for Testing!</span>
              </div>
              <div className="text-xs text-slate-300 space-y-1">
                <div><span className="text-slate-400">Format:</span> <span className="font-mono uppercase font-bold text-[#F59E0B]">{uploadedBuild.fileType || 'AAB'}</span></div>
                <div><span className="text-slate-400">Package:</span> <span className="font-mono text-emerald-200">{uploadedBuild.packageName}</span></div>
                <div><span className="text-slate-400">Version:</span> {uploadedBuild.versionName} ({uploadedBuild.versionCode})</div>
                {uploadedBuild.assetPacks?.length > 0 && (
                  <div><span className="text-slate-400">Asset Packs:</span> {uploadedBuild.assetPacks.length} detected</div>
                )}
              </div>
            </div>
          )}

          {!uploadedBuild && (
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all ${
                dragActive
                  ? 'border-[#F59E0B] bg-[#261D10]/50'
                  : file
                  ? 'border-[#1E2638] bg-[#0A0D14]'
                  : 'border-[#1E2638] hover:border-[#F59E0B]/60 bg-[#0A0D14] hover:bg-[#1E2638]/20'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".aab,.apk"
                onChange={handleFileChange}
                className="hidden"
              />

              {file ? (
                <div className="space-y-2">
                  <div className="w-12 h-12 rounded-xl bg-[#261D10] border border-[#78350F] text-[#F59E0B] flex items-center justify-center mx-auto">
                    <FileArchive className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-white">{file.name}</p>
                    <p className="text-[11px] text-slate-400 font-mono mt-0.5">{formatFileSize(file.size)}</p>
                  </div>
                  <span className="inline-block text-[11px] text-[#F59E0B] hover:underline">Click to choose another file</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-12 h-12 rounded-xl bg-[#131924] border border-[#1E2638] text-slate-400 flex items-center justify-center mx-auto">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-slate-200">
                      Drag & Drop your <span className="text-[#F59E0B] font-mono">.aab</span> or <span className="text-[#F59E0B] font-mono">.apk</span> build here
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">or browse from your computer</p>
                  </div>
                  <p className="text-[10px] text-slate-400">Supports Android App Bundles (.aab) and APKs (.apk)</p>
                </div>
              )}
            </div>
          )}

          {!uploadedBuild && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-medium text-slate-300 border border-[#334155] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUploadAndAnalyze}
                disabled={!file || uploading}
                className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-black transition-colors flex items-center gap-2 shadow-lg shadow-amber-500/10"
              >
                {uploading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Analyzing Build...</span>
                  </>
                ) : (
                  <span>Upload & Analyze</span>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
