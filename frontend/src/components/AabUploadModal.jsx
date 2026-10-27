import React, { useState, useEffect, useRef, useCallback } from 'react';
import { UploadCloud, FileArchive, CheckCircle2, AlertCircle, Loader2, X, Package } from 'lucide-react';
import { api } from '../services/api';
import BuildThumbnail from './BuildThumbnail';
import { toast } from '../utils/toast';

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
      const errMsg = err.message || 'Failed to upload and analyze build.';
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setUploading(false);
    }
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return '0 MB';
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-lg glass rounded-2xl border border-[var(--line)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--line)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[var(--violet)] to-[var(--pink)] text-white flex items-center justify-center shadow-md shadow-[var(--violet)]/20">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-[var(--ink)] text-sm">Upload Build (.aab or .apk)</h3>
              <p className="text-xs text-[var(--muted)]">Play Asset Delivery & Standalone Package Inspection</p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-xl text-[var(--muted)] hover:text-[var(--ink)] hover:bg-[var(--card)] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-500 flex items-start gap-2.5">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          {uploadedBuild && (
            <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span>Build Analyzed & Ready for Testing!</span>
              </div>
              <div className="flex items-center gap-3 pt-1">
                <BuildThumbnail build={uploadedBuild} size="md" />
                <div className="text-xs text-[var(--muted)] space-y-0.5 min-w-0">
                  <div className="font-semibold text-[var(--ink)] truncate">{uploadedBuild.applicationName || uploadedBuild.fileName}</div>
                  <div><span className="text-[var(--muted)]">Package:</span> <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">{uploadedBuild.packageName}</span></div>
                  <div><span className="text-[var(--muted)]">Version:</span> <span className="text-[var(--ink)]">{uploadedBuild.versionName} ({uploadedBuild.versionCode})</span></div>
                  {uploadedBuild.assetPacks?.length > 0 && (
                    <div><span className="text-[var(--muted)]">Asset Packs:</span> <span className="text-[var(--ink)]">{uploadedBuild.assetPacks.length} detected</span></div>
                  )}
                </div>
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
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                dragActive
                  ? 'border-[var(--violet)] bg-[var(--violet)]/10 scale-[0.99]'
                  : file
                  ? 'border-[var(--line)] bg-[var(--card)]'
                  : 'border-[var(--line)] hover:border-[var(--violet)]/60 bg-[var(--card)]/50 hover:bg-[var(--card)]'
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
                  <div className="w-12 h-12 rounded-xl bg-[var(--violet)]/10 text-[var(--violet)] flex items-center justify-center mx-auto">
                    <FileArchive className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-[var(--ink)]">{file.name}</p>
                    <p className="text-[11px] text-[var(--muted)] font-mono mt-0.5">{formatFileSize(file.size)}</p>
                  </div>
                  <span className="inline-block text-[11px] text-[var(--violet)] font-semibold hover:underline">Click to choose another file</span>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="w-12 h-12 rounded-xl bg-[var(--card)] border border-[var(--line)] text-[var(--muted)] flex items-center justify-center mx-auto shadow-xs">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="text-xs font-medium text-[var(--ink)]">
                      Drag & Drop your <span className="text-[var(--violet)] font-mono font-bold">.aab</span> or <span className="text-[var(--violet)] font-mono font-bold">.apk</span> build here
                    </p>
                    <p className="text-[11px] text-[var(--muted)] mt-1">or browse from your computer</p>
                  </div>
                  <p className="text-[10px] text-[var(--muted)]">Supports Android App Bundles (.aab) and APKs (.apk)</p>
                </div>
              )}
            </div>
          )}

          {!uploadedBuild && (
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                className="btn-soft px-4 py-2 rounded-xl text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleUploadAndAnalyze}
                disabled={!file || uploading}
                className="btn-magic px-4 py-2 rounded-xl disabled:opacity-50 text-xs font-bold text-white transition-all flex items-center gap-2 shadow-md cursor-pointer"
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
