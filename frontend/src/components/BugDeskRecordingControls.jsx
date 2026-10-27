import React, { useState, useEffect, useRef } from 'react';
import {
  Video,
  VideoOff,
  Square,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Tv,
  RefreshCw,
  Download,
  Share2,
  Copy,
  HardDrive,
  X,
  ChevronDown
} from 'lucide-react';
import { screenMirrorStreamManager } from '../services/screenMirrorStreamManager';
import { toast } from 'sonner';

const formatDuration = (totalSeconds) => {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

export default function BugDeskRecordingControls({
  moduleSettings,
  onOpenMirror,
  selectedDevice
}) {
  const [mirrorStatus, setMirrorStatus] = useState(screenMirrorStreamManager.getMirrorStatus());
  const [activeDevice, setActiveDevice] = useState(screenMirrorStreamManager.getActiveDevice());
  const [isMirrorReady, setIsMirrorReady] = useState(screenMirrorStreamManager.isMirrorReady(selectedDevice));

  // Recording manager state
  const [recordState, setRecordState] = useState(screenMirrorStreamManager.state);
  const [durationSec, setDurationSec] = useState(screenMirrorStreamManager.durationSec);
  const [uploadProgress, setUploadProgress] = useState(screenMirrorStreamManager.uploadProgress);
  const [errorMessage, setErrorMessage] = useState(screenMirrorStreamManager.errorMessage);
  const [publishedUrl, setPublishedUrl] = useState(screenMirrorStreamManager.publishedUrl);
  const [hasPreservedBlob, setHasPreservedBlob] = useState(Boolean(screenMirrorStreamManager.preservedBlob));
  const [hasUploadedFile, setHasUploadedFile] = useState(Boolean(screenMirrorStreamManager.uploadedDriveFile));

  // Device actions dropdown state
  const [deviceActionsOpen, setDeviceActionsOpen] = useState(false);
  const actionsMenuRef = useRef(null);

  // Upload confirmation dialog state (synchronized with authoritative streamManager)
  const [showUploadConfirm, setShowUploadConfirm] = useState(
    Boolean(screenMirrorStreamManager.pendingRecording && screenMirrorStreamManager.isConfirmingUpload)
  );
  const [pendingRecording, setPendingRecording] = useState(
    screenMirrorStreamManager.pendingRecording
  );
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  const [copiedLink, setCopiedLink] = useState(false);
  const successResetTimerRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target)) {
        setDeviceActionsOpen(false);
      }
    }
    if (deviceActionsOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [deviceActionsOpen]);

  // Sync mirror status
  useEffect(() => {
    setIsMirrorReady(screenMirrorStreamManager.isMirrorReady(selectedDevice));
    setActiveDevice(screenMirrorStreamManager.getActiveDevice());
    setMirrorStatus(screenMirrorStreamManager.getMirrorStatus());

    const handleStatusChanged = (e) => {
      setMirrorStatus(e.detail?.status || 'inactive');
      setActiveDevice(e.detail?.device || null);
      setIsMirrorReady(screenMirrorStreamManager.isMirrorReady(selectedDevice));
    };

    window.addEventListener('mirror:status-changed', handleStatusChanged);
    return () => window.removeEventListener('mirror:status-changed', handleStatusChanged);
  }, [selectedDevice]);

  // Sync recording manager state
  useEffect(() => {
    const handleRecordingState = (e) => {
      const detail = e.detail;
      setRecordState(detail.state);
      setDurationSec(detail.durationSec);
      setUploadProgress(detail.uploadProgress);
      setErrorMessage(detail.errorMessage);
      setPublishedUrl(detail.publishedUrl);
      setHasPreservedBlob(detail.hasPreservedBlob);
      setHasUploadedFile(detail.hasUploadedFile);

      if (detail.state === 'ready_to_upload' || (detail.hasPendingRecording && detail.isConfirmingUpload)) {
        setShowUploadConfirm(true);
        setPendingRecording(screenMirrorStreamManager.getPendingRecording());
      }

      if (detail.state === 'completed') {
        setShowUploadConfirm(false);
        setPendingRecording(null);
        setIsUploading(false);
        setUploadError(null);
        toast.success('Recording published to Google Drive & attached to bug report!');
        if (successResetTimerRef.current) clearTimeout(successResetTimerRef.current);
        successResetTimerRef.current = setTimeout(() => {
          if (screenMirrorStreamManager.state === 'completed') {
            screenMirrorStreamManager.reset();
          }
        }, 8000);
      }
    };

    const handleRecordingReady = (e) => {
      const rec = e.detail?.recording;
      if (rec && rec.blob && rec.blob.size > 0) {
        setPendingRecording(rec);
        setUploadError(null);
        setIsUploading(false);
        setShowUploadConfirm(true);
      }
    };

    window.addEventListener('bugdesk:recording-state-changed', handleRecordingState);
    window.addEventListener('bugdesk:recording-ready', handleRecordingReady);
    return () => {
      window.removeEventListener('bugdesk:recording-state-changed', handleRecordingState);
      window.removeEventListener('bugdesk:recording-ready', handleRecordingReady);
      if (successResetTimerRef.current) clearTimeout(successResetTimerRef.current);
    };
  }, []);

  // Actions
  const handleStartRecording = async () => {
    if (!isMirrorReady) {
      toast.error('Start Screen Mirror before recording.');
      return;
    }

    try {
      await screenMirrorStreamManager.startRecording();
    } catch (err) {
      toast.error(err.message || 'Could not start recording');
    }
  };

  const handleStopRecording = async () => {
    try {
      const recording = await screenMirrorStreamManager.stopRecording();
      if (!recording || !recording.blob || recording.blob.size === 0) return;

      // Do NOT upload automatically — store pending recording and ask for confirmation
      setPendingRecording(recording);
      setUploadError(null);
      setIsUploading(false);
      setShowUploadConfirm(true);
    } catch (err) {
      toast.error(err.message || 'Error stopping recording');
    }
  };

  const handleConfirmUpload = async () => {
    if (isUploading) return;
    const rec = pendingRecording || screenMirrorStreamManager.getPendingRecording();
    if (!rec) return;

    setIsUploading(true);
    setUploadError(null);

    try {
      const result = await screenMirrorStreamManager.uploadAndPublish({
        project: moduleSettings?.project || 'Project',
        module: moduleSettings?.module || 'Module',
        round: moduleSettings?.round || '',
        recording: rec
      });

      if (result && result.success) {
        setShowUploadConfirm(false);
        setPendingRecording(null);
        setIsUploading(false);
        setUploadError(null);
      } else {
        setIsUploading(false);
        setUploadError(screenMirrorStreamManager.errorMessage || 'Failed to upload recording to Google Drive.');
      }
    } catch (err) {
      setIsUploading(false);
      setUploadError(err.message || 'Failed to upload recording to Google Drive.');
    }
  };

  const handleSkipUpload = () => {
    if (isUploading) return;
    setShowUploadConfirm(false);
    setPendingRecording(null);
    setUploadError(null);
    screenMirrorStreamManager.discardPendingRecording();
  };

  const handleDismissModal = () => {
    if (isUploading) return;
    setShowUploadConfirm(false);
  };

  const handleRetryUpload = async () => {
    return handleConfirmUpload();
  };

  const handleRetryPublish = async () => {
    try {
      await screenMirrorStreamManager.retryPublish();
    } catch (err) {
      toast.error(err.message || 'Retry publish failed');
    }
  };

  const handleCopyLink = async () => {
    if (!publishedUrl) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(publishedUrl);
      }
      setCopiedLink(true);
      toast.success('Published Google Drive link copied to clipboard!');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error('Failed to copy link.');
    }
  };

  return (
    <div className="flex items-center gap-2">
      {/* ── State: Recording is ACTIVE -> Persistent Glowing Indicator & Direct Stop Action ── */}
      {recordState === 'recording' && (
        <div className="flex items-center gap-2 animate-fadeIn">
          <div className="flex items-center gap-2 px-3 h-9 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-500 text-xs font-bold shadow-xs">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping" />
            <span className="font-mono text-xs">{formatDuration(durationSec)}</span>
          </div>
          <button
            type="button"
            onClick={handleStopRecording}
            className="h-9 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-md transition-all cursor-pointer animate-pulse"
            title="Stop recording and review upload"
          >
            <Square className="w-3.5 h-3.5 fill-white" />
            <span>Stop Recording</span>
          </button>
        </div>
      )}

      {/* ── State: Finalizing & Uploading ── */}
      {(recordState === 'finalizing' || recordState === 'uploading' || recordState === 'publishing') && (
        <div className="flex items-center gap-2 px-3 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-500 dark:text-amber-400 text-xs font-semibold animate-fadeIn shadow-xs">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>
            {recordState === 'finalizing' && 'Finalizing...'}
            {recordState === 'uploading' && `Uploading Drive ${uploadProgress}%`}
            {recordState === 'publishing' && 'Publishing Link...'}
          </span>
        </div>
      )}

      {/* ── State: Upload Completed ── */}
      {recordState === 'completed' && (
        <div className="flex items-center gap-2 px-3 h-9 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-semibold animate-fadeIn shadow-xs">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
          <span>Attached!</span>
          <button
            type="button"
            onClick={handleCopyLink}
            className="p-1 rounded hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 transition-colors cursor-pointer"
            title="Copy published Google Drive link"
          >
            {copiedLink ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* ── State: Error & Failure Recovery ── */}
      {recordState === 'error' && (
        <div className="flex items-center gap-1.5 px-3 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-500 text-xs font-semibold animate-fadeIn shadow-xs">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="max-w-[110px] truncate" title={errorMessage || 'Recording failed'}>
            {errorMessage ? 'Error' : 'Upload Failed'}
          </span>

          {hasUploadedFile ? (
            <button
              type="button"
              onClick={handleRetryPublish}
              className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-[11px] font-bold text-white transition-colors cursor-pointer"
              title="Retry creating shareable link for uploaded file"
            >
              Retry
            </button>
          ) : hasPreservedBlob ? (
            <button
              type="button"
              onClick={handleRetryUpload}
              className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-[11px] font-bold text-white transition-colors cursor-pointer"
              title="Retry uploading preserved recording"
            >
              Retry
            </button>
          ) : null}

          {hasPreservedBlob && (
            <button
              type="button"
              onClick={() => screenMirrorStreamManager.downloadLocalVideo()}
              className="p-1 rounded hover:bg-rose-500/25 text-rose-400 transition-colors cursor-pointer"
              title="Download recording locally (.webm)"
            >
              <Download className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            onClick={() => screenMirrorStreamManager.reset()}
            className="text-xs text-rose-400 hover:text-rose-200 ml-1 cursor-pointer"
            title="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Device Actions Dropdown (Mirror & Record Screen) ── */}
      {recordState !== 'recording' && (
        <div className="relative" ref={actionsMenuRef}>
          <button
            type="button"
            onClick={() => setDeviceActionsOpen((prev) => !prev)}
            className="btn-soft h-9 px-2.5 lg:px-3 rounded-xl flex items-center gap-1.5 lg:gap-2 text-xs font-semibold cursor-pointer shadow-xs"
            title="Device Actions: Screen Mirror & Recording"
            aria-label="Device Actions"
          >
            <div className="relative flex items-center justify-center">
              <Tv className="w-3.5 h-3.5 text-[#7c6cf6] dark:text-violet-400" />
              {isMirrorReady && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </div>
            <span className="hidden xl:inline">Device Actions</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-[#6b7194] dark:text-[#64748B] transition-transform duration-200 ${
                deviceActionsOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {/* Dropdown Menu */}
          {deviceActionsOpen && (
            <div className="absolute right-0 mt-1.5 w-60 rounded-2xl bg-white/95 dark:bg-[#0D111A]/95 backdrop-blur-xl shadow-2xl z-50 overflow-hidden animate-fadeIn p-1.5 border border-[rgba(99,102,241,0.18)] dark:border-[#1E2638]">
              {/* Option 1: Screen Mirror */}
              <button
                type="button"
                onClick={() => {
                  setDeviceActionsOpen(false);
                  if (onOpenMirror) onOpenMirror();
                }}
                className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-[#1f2544] dark:text-[#CBD5E1] hover:bg-violet-50/70 dark:hover:bg-[#1A2234] dark:hover:text-white transition-colors text-left cursor-pointer group"
              >
                <div className="flex items-center gap-2.5">
                  <Tv className="w-4 h-4 text-[#7c6cf6] dark:text-violet-400" />
                  <span>Screen Mirror</span>
                </div>
                {isMirrorReady ? (
                  <span className="flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 font-bold font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    LIVE
                  </span>
                ) : (
                  <span className="text-[10px] text-[#6b7194] dark:text-[#64748B]">Open</span>
                )}
              </button>

              {/* Option 2: Record Screen */}
              <button
                type="button"
                onClick={() => {
                  setDeviceActionsOpen(false);
                  handleStartRecording();
                }}
                disabled={!isMirrorReady}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold transition-colors text-left ${
                  !isMirrorReady
                    ? 'text-[#94a3b8] dark:text-[#525A6C] opacity-60 cursor-not-allowed'
                    : 'text-[#1f2544] dark:text-[#CBD5E1] hover:bg-violet-50/70 dark:hover:bg-[#1A2234] dark:hover:text-white cursor-pointer'
                }`}
                title={!isMirrorReady ? 'Start Screen Mirror before recording.' : 'Start recording screen'}
              >
                <div className="flex items-center gap-2.5">
                  <Video className="w-4 h-4 text-rose-500" />
                  <span>Record Screen</span>
                </div>
                {!isMirrorReady ? (
                  <span className="text-[10px] text-[#94a3b8] dark:text-[#525A6C]">Needs Mirror</span>
                ) : (
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                )}
              </button>

              {/* Option 3: Pending Upload (if present) */}
              {Boolean(pendingRecording) && (
                <button
                  type="button"
                  onClick={() => {
                    setDeviceActionsOpen(false);
                    setShowUploadConfirm(true);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 transition-colors text-left cursor-pointer border-t border-[rgba(99,102,241,0.14)] dark:border-[#1E2638] mt-1 pt-2"
                >
                  <div className="flex items-center gap-2.5">
                    <HardDrive className="w-4 h-4 text-amber-500" />
                    <span>Pending Recording</span>
                  </div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400">
                    Review
                  </span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Confirmation Modal: Upload Recording to Google Drive? ── */}
      {showUploadConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md bg-[#0D111A] border border-[#1E2638] rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-scaleUp">
            {/* Header */}
            <div className="px-6 py-4 border-b border-[#1E2638] bg-[#131924] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-[#F59E0B]">
                  <HardDrive className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Upload Recording to Google Drive?</h3>
                  <p className="text-[11px] text-[#94A3B8]">Screen recording confirmation</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleDismissModal}
                disabled={isUploading}
                className="p-1.5 rounded-lg hover:bg-[#1E2638] text-[#94A3B8] hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-6 space-y-4">
              <p className="text-xs text-[#CBD5E1] leading-relaxed">
                Your screen recording is ready. Do you want to upload it to Google Drive and automatically attach the link to this BugDesk report?
              </p>

              {/* Video metadata pill */}
              <div className="flex items-center gap-2 p-2.5 rounded-xl bg-[#080B12] border border-[#1E2638] text-[12px] text-[#8F97A6]">
                <Video className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="font-mono text-slate-200">
                  {formatDuration(pendingRecording?.durationSec || durationSec || 0)}
                </span>
                <span className="text-slate-500">•</span>
                <span className="truncate text-slate-300">
                  {moduleSettings?.project || 'Project'} / {moduleSettings?.module || 'Module'}
                </span>
              </div>

              {/* Upload Progress Indicator when uploading */}
              {isUploading && (
                <div className="space-y-1.5 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 animate-fadeIn">
                  <div className="flex items-center justify-between text-xs font-semibold text-amber-400">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {recordState === 'publishing' ? 'Publishing Shareable Link...' : 'Uploading to Google Drive...'}
                    </span>
                    <span className="font-mono">{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-[#080B12] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="bg-amber-400 h-full rounded-full transition-all duration-300"
                      style={{ width: `${Math.max(5, uploadProgress)}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Error message if upload failed */}
              {uploadError && (
                <div className="space-y-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs animate-fadeIn">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-rose-200">Upload Failed</p>
                      <p className="mt-0.5 text-rose-300/90 leading-relaxed">{uploadError}</p>
                    </div>
                  </div>
                  {screenMirrorStreamManager.preservedBlob && (
                    <button
                      type="button"
                      onClick={() => screenMirrorStreamManager.downloadLocalVideo()}
                      className="mt-1 flex items-center gap-1.5 text-amber-400 hover:text-amber-300 underline font-medium text-[11px] cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download recording locally (.webm)</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 border-t border-[#1E2638] bg-[#0A0D14] flex items-center justify-between gap-2.5">
              <button
                type="button"
                onClick={() => {
                  const rec = pendingRecording || screenMirrorStreamManager.getPendingRecording();
                  const filename = rec?.filename || screenMirrorStreamManager.preservedFilename;
                  const success = screenMirrorStreamManager.downloadLocalVideo(filename);
                  if (success) {
                    toast.success('Downloaded screen recording locally.');
                  } else {
                    toast.error('No recording file available to download.');
                  }
                }}
                disabled={isUploading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#1E2638] bg-[#10141D] hover:bg-[#161B26] text-emerald-400 hover:text-emerald-300 hover:border-emerald-500/30 text-xs font-bold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                title="Download screen recording directly to local computer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Recording</span>
              </button>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={handleSkipUpload}
                  disabled={isUploading}
                  className="px-4 py-2 rounded-xl border border-[#1E2638] bg-[#10141D] hover:bg-[#161B26] text-slate-300 hover:text-white text-xs font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  No, Skip Upload
                </button>

                <button
                  type="button"
                  onClick={handleConfirmUpload}
                  disabled={isUploading}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-black text-xs font-bold transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : uploadError ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>Retry Upload</span>
                    </>
                  ) : (
                    <span>Yes, Upload</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
