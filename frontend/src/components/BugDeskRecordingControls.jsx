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
  Copy
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

  const [copiedLink, setCopiedLink] = useState(false);
  const successResetTimerRef = useRef(null);

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

      if (detail.state === 'completed') {
        toast.success('Recording published to Google Drive & attached to bug report!');
        if (successResetTimerRef.current) clearTimeout(successResetTimerRef.current);
        successResetTimerRef.current = setTimeout(() => {
          if (screenMirrorStreamManager.state === 'completed') {
            screenMirrorStreamManager.reset();
          }
        }, 8000);
      }
    };

    window.addEventListener('bugdesk:recording-state-changed', handleRecordingState);
    return () => {
      window.removeEventListener('bugdesk:recording-state-changed', handleRecordingState);
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
      if (!recording) return;

      // Automatically trigger upload & publishing
      await screenMirrorStreamManager.uploadAndPublish({
        project: moduleSettings?.project || 'Project',
        module: moduleSettings?.module || 'Module',
        round: moduleSettings?.round || '',
        recording
      });
    } catch (err) {
      toast.error(err.message || 'Error stopping recording');
    }
  };

  const handleRetryUpload = async () => {
    try {
      await screenMirrorStreamManager.uploadAndPublish({
        project: moduleSettings?.project || 'Project',
        module: moduleSettings?.module || 'Module',
        round: moduleSettings?.round || '',
        recording: null
      });
    } catch (err) {
      toast.error(err.message || 'Retry upload failed');
    }
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
      {/* ── Screen Mirror Toggle Button ── */}
      <button
        onClick={onOpenMirror}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all shadow-xs cursor-pointer ${
          isMirrorReady
            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
            : 'bg-[#10141D] hover:bg-[#161B26] border border-[#1A202E] text-[#94A3B8] hover:text-[#FFFFFF]'
        }`}
        title={
          isMirrorReady
            ? `Screen Mirror active (${activeDevice?.name || activeDevice?.serial || 'Device'}). Click to view mirror.`
            : 'Open Screen Mirror viewport for testing'
        }
      >
        <Tv className="w-3.5 h-3.5" />
        <span>Mirror</span>
        {isMirrorReady && (
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
        )}
      </button>

      {/* ── State 1: Mirror Inactive ── */}
      {!isMirrorReady && recordState === 'idle' && (
        <button
          disabled
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#10141D]/50 border border-[#1E2638] text-[12.5px] text-[#525A6C] font-semibold cursor-not-allowed opacity-75"
          title="Start Screen Mirror before recording."
        >
          <VideoOff className="w-3.5 h-3.5 text-[#525A6C]" />
          <span>Record Screen</span>
        </button>
      )}

      {/* ── State 2: Mirror Active, Ready to Record ── */}
      {isMirrorReady && recordState === 'idle' && (
        <button
          onClick={handleStartRecording}
          className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-rose-500/15 hover:bg-rose-500/25 text-rose-400 border border-rose-500/40 text-[12.5px] font-bold transition-all shadow-xs cursor-pointer group"
          title={`Start recording live mirrored screen of ${activeDevice?.name || activeDevice?.serial || 'device'}`}
        >
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 group-hover:scale-110 transition-transform"></span>
          <span>Record Screen</span>
        </button>
      )}

      {/* ── State 3: Recording Active ── */}
      {recordState === 'recording' && (
        <button
          onClick={handleStopRecording}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white border border-rose-400 text-[12.5px] font-bold shadow-md transition-all cursor-pointer animate-pulse"
          title="Click to stop recording and automatically upload & publish to Google Drive"
        >
          <Square className="w-3 h-3 fill-white" />
          <span className="font-mono text-[12px]">{formatDuration(durationSec)}</span>
          <span className="text-[11px] opacity-90 border-l border-rose-400 pl-1.5">Stop</span>
        </button>
      )}

      {/* ── State 4: Finalizing & Uploading ── */}
      {(recordState === 'finalizing' || recordState === 'uploading' || recordState === 'publishing') && (
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[12.5px] font-semibold">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>
            {recordState === 'finalizing' && 'Finalizing...'}
            {recordState === 'uploading' && `Uploading Drive ${uploadProgress}%`}
            {recordState === 'publishing' && 'Publishing Link...'}
          </span>
        </div>
      )}

      {/* ── State 5: Upload Completed ── */}
      {recordState === 'completed' && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-[12.5px] font-semibold animate-fadeIn">
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          <span>Attached!</span>
          <button
            onClick={handleCopyLink}
            className="ml-1 p-1 rounded hover:bg-emerald-500/20 text-emerald-300 transition-colors"
            title="Copy published Google Drive link"
          >
            {copiedLink ? <CheckCircle2 className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>
        </div>
      )}

      {/* ── State 6: Error & Failure Recovery ── */}
      {recordState === 'error' && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-400 text-[12px] font-semibold">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="max-w-[130px] truncate" title={errorMessage || 'Recording failed'}>
            {errorMessage ? 'Error' : 'Upload Failed'}
          </span>

          {/* Recovery Actions */}
          {hasUploadedFile ? (
            <button
              onClick={handleRetryPublish}
              className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-[11px] font-bold text-white transition-colors cursor-pointer"
              title="Retry creating shareable link for uploaded file"
            >
              Retry Link
            </button>
          ) : hasPreservedBlob ? (
            <button
              onClick={handleRetryUpload}
              className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-[11px] font-bold text-white transition-colors cursor-pointer"
              title="Retry uploading preserved recording"
            >
              Retry
            </button>
          ) : null}

          {hasPreservedBlob && (
            <button
              onClick={() => screenMirrorStreamManager.downloadLocalVideo()}
              className="p-1 rounded hover:bg-rose-500/25 text-rose-300 transition-colors cursor-pointer"
              title="Download recording locally (.webm)"
            >
              <Download className="w-3 h-3" />
            </button>
          )}

          <button
            onClick={() => screenMirrorStreamManager.reset()}
            className="text-[11px] text-rose-300 hover:text-white ml-0.5"
            title="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
