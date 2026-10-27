import { api } from './api.js';
import { generateRecordingFilename, generateScreenMirrorFilename } from '../bugdesk/lib/recording-naming.js';

export { generateScreenMirrorFilename };

export const getSupportedRecordingMimeType = () => {
  const types = [
    { mime: 'video/webm;codecs=vp8', ext: 'webm' },
    { mime: 'video/webm;codecs=h264', ext: 'webm' },
    { mime: 'video/mp4;codecs=avc1', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' }
  ];
  if (typeof window !== 'undefined' && window.MediaRecorder) {
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t.mime)) {
        return t;
      }
    }
  }
  return { mime: '', ext: 'webm' };
};

export class CanvasRecordingBridge {
  constructor(videoElement, targetFps = 30) {
    this.videoElement = videoElement;
    this.targetFps = targetFps;
    this.canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    this.ctx = this.canvas ? this.canvas.getContext('2d', { alpha: false, desynchronized: true }) : null;

    const vw = videoElement?.videoWidth || 720;
    const vh = videoElement?.videoHeight || 1600;
    if (this.canvas) {
      this.canvas.width = vw;
      this.canvas.height = vh;
    }

    this.isRendering = false;
    this.rvfcHandle = null;
    this.rafHandle = null;
    this.stream = null;
  }

  start() {
    if (this.isRendering || !this.videoElement || !this.canvas || !this.ctx) return;
    this.isRendering = true;

    this._draw();

    if (typeof this.videoElement.requestVideoFrameCallback === 'function') {
      const onFrame = () => {
        if (!this.isRendering) return;
        this._draw();
        this.rvfcHandle = this.videoElement.requestVideoFrameCallback(onFrame);
      };
      this.rvfcHandle = this.videoElement.requestVideoFrameCallback(onFrame);
    } else {
      const onFrame = () => {
        if (!this.isRendering) return;
        this._draw();
        this.rafHandle = requestAnimationFrame(onFrame);
      };
      this.rafHandle = requestAnimationFrame(onFrame);
    }
  }

  _draw() {
    if (!this.videoElement || !this.ctx || !this.canvas) return;
    const vw = this.videoElement.videoWidth;
    const vh = this.videoElement.videoHeight;
    if (vw > 0 && vh > 0 && (vw !== this.canvas.width || vh !== this.canvas.height)) {
      this.canvas.width = vw;
      this.canvas.height = vh;
    }
    try {
      this.ctx.drawImage(this.videoElement, 0, 0, this.canvas.width, this.canvas.height);
    } catch {
      // In case video frame is not yet decodable
    }
  }

  getStream() {
    if (!this.stream && this.canvas) {
      this.start();
      if (this.canvas.captureStream) {
        this.stream = this.canvas.captureStream(this.targetFps);
      } else if (this.canvas.mozCaptureStream) {
        this.stream = this.canvas.mozCaptureStream(this.targetFps);
      }
    }
    return this.stream;
  }

  destroy() {
    this.isRendering = false;
    if (this.rvfcHandle && typeof this.videoElement?.cancelVideoFrameCallback === 'function') {
      try {
        this.videoElement.cancelVideoFrameCallback(this.rvfcHandle);
      } catch {}
      this.rvfcHandle = null;
    }
    if (this.rafHandle && typeof cancelAnimationFrame === 'function') {
      try {
        cancelAnimationFrame(this.rafHandle);
      } catch {}
      this.rafHandle = null;
    }
    if (this.stream) {
      try {
        const tracks = this.stream.getTracks();
        for (const track of tracks) {
          track.stop();
        }
      } catch {}
      this.stream = null;
    }
    this.ctx = null;
    this.canvas = null;
    this.videoElement = null;
  }
}

class ScreenMirrorStreamManager {
  constructor() {
    this.activeStreamInfo = null; // { device, videoElement, status: 'connecting'|'waiting_for_frame'|'live'|'stopped'|'error' }
    this.recorder = null;
    this.recordedChunks = [];
    this.recordingTimer = null;
    this.recordingStartTime = null;
    this.recordingMimeConfig = null;

    // State machine: 'idle' | 'recording' | 'finalizing' | 'ready_to_upload' | 'uploading' | 'publishing' | 'completed' | 'error'
    this.state = 'idle';
    this.durationSec = 0;
    this.uploadProgress = 0;
    this.errorMessage = null;

    // Preserved data for failure recovery & upload confirmation
    this.pendingRecording = null;
    this.isConfirmingUpload = false;
    this.preservedBlob = null;
    this.preservedFilename = null;
    this.uploadedDriveFile = null; // { id, name, webViewLink }
    this.publishedUrl = null;
  }

  // ---- Mirror Stream Registry ----

  registerStream(device, videoElement, status = 'connecting') {
    if (!device?.serial) return;
    this.activeStreamInfo = {
      device,
      videoElement,
      status,
      lastUpdated: Date.now()
    };
    this._emitStatusChanged();
  }

  updateStatus(serial, status) {
    if (this.activeStreamInfo && this.activeStreamInfo.device?.serial === serial) {
      this.activeStreamInfo.status = status;
      this.activeStreamInfo.lastUpdated = Date.now();
      this._emitStatusChanged();

      // If mirror stopped or errored while recording, safely finalize available footage
      if (status === 'stopped' || status === 'error') {
        if (this.state === 'recording') {
          this.stopRecording({ reason: 'mirror_disconnected' });
        }
      }
    }
  }

  unregisterStream(serial, videoElement = null) {
    if (!this.activeStreamInfo) return;
    if (serial && this.activeStreamInfo.device?.serial !== serial && this.activeStreamInfo.device?.hardwareSerial !== serial) {
      return;
    }
    // If a specific video element was provided, ensure it matches
    if (videoElement && this.activeStreamInfo.videoElement !== videoElement) {
      return;
    }
    // Only stop recording if the mirror session was explicitly disconnected or dead
    if (this.state === 'recording' && (this.activeStreamInfo.status === 'stopped' || this.activeStreamInfo.status === 'error')) {
      this.stopRecording({ reason: 'mirror_closed' });
    }
    this._cleanupBridge();
    this.activeStreamInfo = null;
    this._emitStatusChanged();
  }

  _cleanupBridge() {
    if (this.recordingBridge) {
      try {
        this.recordingBridge.destroy();
      } catch (e) {
        console.warn('[ScreenMirrorStreamManager] Error destroying recording bridge:', e);
      }
      this.recordingBridge = null;
    }
  }

  getActiveSession() {
    return this.activeStreamInfo;
  }

  getActiveDevice() {
    return this.activeStreamInfo?.device || null;
  }

  getMirrorStatus() {
    return this.activeStreamInfo?.status || 'inactive';
  }

  /**
   * Precondition check: is the mirror active, ready, and producing screen data?
   */
  isMirrorReady(targetDevice = null) {
    if (!this.activeStreamInfo) return false;
    if (this.activeStreamInfo.status !== 'live') return false;

    // Check device match if a specific target is provided (support serial and hardwareSerial)
    if (targetDevice?.serial) {
      const activeDev = this.activeStreamInfo.device;
      const match =
        activeDev.serial === targetDevice.serial ||
        (targetDevice.hardwareSerial && (activeDev.serial === targetDevice.hardwareSerial || activeDev.hardwareSerial === targetDevice.hardwareSerial)) ||
        (activeDev.hardwareSerial && activeDev.hardwareSerial === targetDevice.serial);
      if (!match) {
        return false;
      }
    }

    const videoEl = this.activeStreamInfo.videoElement;
    if (!videoEl) return false;

    // Check if video element is actually playing or has valid dimensions
    if (videoEl.videoWidth === 0 && videoEl.readyState < 2) {
      return false;
    }

    return true;
  }

  /**
   * Reconcile status with backend active sessions
   */
  async reconcileBackendStatus(targetDevice = null, apiService = null) {
    const serial = targetDevice?.serial || this.activeStreamInfo?.device?.serial;
    if (!serial) return false;
    try {
      const client = apiService || this.api || api;
      const res = await client.getMirrorStatus(serial);
      if (res?.status?.active) {
        if (this.activeStreamInfo) {
          this.activeStreamInfo.status = 'live';
          this._emitStatusChanged();
        }
        return true;
      } else {
        if (this.activeStreamInfo && (this.activeStreamInfo.device?.serial === serial || this.activeStreamInfo.device?.hardwareSerial === serial)) {
          this.updateStatus(this.activeStreamInfo.device.serial, 'stopped');
        }
        return false;
      }
    } catch {
      return false;
    }
  }

  getCaptureStream() {
    if (!this.isMirrorReady()) return null;
    const videoEl = this.activeStreamInfo.videoElement;
    try {
      this._cleanupBridge();
      this.recordingBridge = new CanvasRecordingBridge(videoEl, 30);
      const stream = this.recordingBridge.getStream();
      if (stream) return stream;
    } catch (e) {
      console.warn('[ScreenMirrorStreamManager] CanvasRecordingBridge error, trying fallback:', e);
    }
    try {
      if (videoEl.captureStream) return videoEl.captureStream(30);
      if (videoEl.mozCaptureStream) return videoEl.mozCaptureStream(30);
    } catch (e) {
      console.warn('[ScreenMirrorStreamManager] captureStream error:', e);
    }
    return null;
  }

  // ---- Recording Operations ----

  async startRecording() {
    if (this.state === 'recording') return false;

    if (!this.isMirrorReady()) {
      throw new Error('Screen Mirror is not active or ready. Start Screen Mirror before recording.');
    }

    const stream = this.getCaptureStream();
    if (!stream || stream.getVideoTracks().length === 0) {
      this._cleanupBridge();
      throw new Error('No video stream track available for recording from the mirrored screen.');
    }

    const typeConfig = getSupportedRecordingMimeType();
    const options = typeConfig.mime ? { mimeType: typeConfig.mime, videoBitsPerSecond: 2500000 } : {};

    try {
      this.recorder = new MediaRecorder(stream, options);
      this.recordedChunks = [];
      this.recordingMimeConfig = typeConfig;
      this.recordingStartTime = Date.now();
      this.durationSec = 0;
      this.uploadProgress = 0;
      this.errorMessage = null;
      this.pendingRecording = null;
      this.isConfirmingUpload = false;
      this.preservedBlob = null;
      this.uploadedDriveFile = null;
      this.publishedUrl = null;

      this.recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.recorder.onerror = (err) => {
        console.error('[MediaRecorder Error]:', err);
        this.state = 'error';
        this.errorMessage = `Recording error: ${err.message || 'MediaRecorder failed'}`;
        this._cleanupBridge();
        this._stopTimer();
        this._emitRecordingState();
      };

      this.recorder.start(1000);
      this.state = 'recording';
      this._startTimer();
      this._emitRecordingState();
      return true;
    } catch (err) {
      this.state = 'error';
      this.errorMessage = err.message || 'Failed to start screen recording';
      this._cleanupBridge();
      this._stopTimer();
      this._emitRecordingState();
      throw err;
    }
  }

  _startTimer() {
    this._stopTimer();
    this.recordingTimer = setInterval(() => {
      this.durationSec += 1;
      this._emitRecordingState();
    }, 1000);
  }

  _stopTimer() {
    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
      this.recordingTimer = null;
    }
  }

  /**
   * Stop recording and automatically upload & publish to Google Drive
   */
  async stopRecording(options = {}) {
    if (this.state !== 'recording' || !this.recorder) {
      this._cleanupBridge();
      return null;
    }

    this._stopTimer();
    this.state = 'finalizing';
    this._emitRecordingState();

    return new Promise((resolve) => {
      this.recorder.onstop = async () => {
        try {
          this._cleanupBridge();
          if (this.recordedChunks.length === 0) {
            this.state = 'error';
            this.errorMessage = 'No video data was recorded. Please ensure screen mirroring is displaying frames.';
            this._emitRecordingState();
            resolve(null);
            return;
          }

          const mimeType = this.recordingMimeConfig?.mime || 'video/webm';
          const ext = this.recordingMimeConfig?.ext || 'webm';
          const blob = new Blob(this.recordedChunks, { type: mimeType });
          this.preservedBlob = blob;

          const filename = generateScreenMirrorFilename({
            device: this.activeStreamInfo?.device,
            ext
          });
          this.preservedFilename = filename;

          // Check if truncated
          const recId = options.recordingId || `rec_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const recordingResult = {
            recordingId: recId,
            blob,
            filename,
            mimeType,
            ext,
            durationSec: Math.max(1, this.durationSec),
            device: this.activeStreamInfo?.device
          };

          this.pendingRecording = recordingResult;
          this.isConfirmingUpload = true;
          this.state = 'ready_to_upload';
          this._emitRecordingState();

          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('bugdesk:recording-ready', {
                detail: { recording: recordingResult }
              })
            );
          }

          resolve(recordingResult);
        } catch (e) {
          this.state = 'error';
          this.errorMessage = e.message || 'Error finalizing recording';
          this._emitRecordingState();
          resolve(null);
        }
      };

      try {
        if (this.recorder.state !== 'inactive') {
          this.recorder.stop();
        }
      } catch (err) {
        console.warn('Error calling recorder.stop():', err);
      }
    });
  }

  /**
   * Upload finalized recording to user's default Google Drive folder and publish shareable link.
   */
  async uploadAndPublish({ project, module, round, recording, folderId = null }) {
    if (this.isUploadingInProgress) {
      console.warn('[ScreenMirrorStreamManager] uploadAndPublish already in progress, ignoring duplicate call');
      return null;
    }

    const videoBlob = recording?.blob || this.preservedBlob;
    if (!videoBlob) {
      this.state = 'error';
      this.errorMessage = 'No recording blob available to upload.';
      this._emitRecordingState();
      return null;
    }

    this.isUploadingInProgress = true;
    this.state = 'uploading';
    this.uploadProgress = 0;
    this.errorMessage = null;
    this._emitRecordingState();

    try {
      const client = this.api || api;
      // 1. Verify Google Drive status
      const driveStatus = await client.getDriveStatus();
      if (!driveStatus?.connected) {
        throw new Error('Google Drive is not connected. Connect your Google Drive account in Settings to enable auto-publishing.');
      }

      // 2. Generate filename
      const ext = recording?.ext || this.recordingMimeConfig?.ext || 'webm';
      const filename = generateRecordingFilename({ project, module, round, ext });
      this.preservedFilename = filename;

      // 3. Prepare upload FormData
      const formData = new FormData();
      formData.append('file', videoBlob, filename);
      formData.append('durationSec', String(recording?.durationSec || this.durationSec || 1));
      formData.append('deviceSerial', this.activeStreamInfo?.device?.serial || '');
      formData.append('deviceName', this.activeStreamInfo?.device?.name || '');
      formData.append('originalFilename', filename);

      const recId = recording?.recordingId || this.pendingRecording?.recordingId;
      if (recId) {
        formData.append('recordingId', recId);
      }

      const targetFolderId = folderId || driveStatus.defaultFolderId;
      if (targetFolderId && targetFolderId !== 'root') {
        formData.append('folderId', targetFolderId);
      }

      // 4. Upload with progress tracking (or reuse already uploaded drive file)
      let fileId = this.uploadedDriveFile?.id;
      if (!fileId) {
        const uploadRes = await client.uploadScreenRecording(formData, (percent) => {
          this.uploadProgress = percent;
          this._emitRecordingState();
        });

        if (!uploadRes?.success || !uploadRes.recording) {
          throw new Error(uploadRes?.error || 'Failed to upload recording to Google Drive');
        }

        fileId = uploadRes.recording.google_drive_file_id;
        this.uploadedDriveFile = {
          id: fileId,
          name: uploadRes.recording.filename || filename,
          webViewLink: uploadRes.recording.google_drive_web_view_link
        };
      }

      // 5. Automatically Publish / create shareable link
      this.state = 'publishing';
      this._emitRecordingState();

      const publishRes = await client.publishDriveFile(fileId);
      if (!publishRes?.success || (!publishRes.shareLink && !publishRes.webViewLink)) {
        throw new Error(publishRes?.error || 'Uploaded successfully, but failed to create shareable link.');
      }

      const finalUrl = publishRes.shareLink || publishRes.webViewLink;
      this.publishedUrl = finalUrl;
      this.pendingRecording = null;
      this.isConfirmingUpload = false;
      this.state = 'completed';
      this._emitRecordingState();

      // Dispatch event for BugDesk to auto-populate the Attachment URL
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('bugdesk:attachment-ready', {
            detail: {
              url: finalUrl,
              filename,
              fileId
            }
          })
        );
      }

      return {
        success: true,
        url: finalUrl,
        filename,
        fileId
      };
    } catch (err) {
      console.error('[ScreenMirrorStreamManager] uploadAndPublish error:', err);
      this.state = 'error';
      this.errorMessage = err.message || 'Upload & publish failed';
      this._emitRecordingState();
      return null;
    } finally {
      this.isUploadingInProgress = false;
    }
  }

  /**
   * Retry publishing shareable link if upload succeeded but publishing failed
   */
  async retryPublish() {
    if (!this.uploadedDriveFile?.id) {
      this.errorMessage = 'No uploaded file ID found to publish.';
      this.state = 'error';
      this._emitRecordingState();
      return;
    }

    this.state = 'publishing';
    this.errorMessage = null;
    this._emitRecordingState();

    try {
      const res = await api.publishDriveFile(this.uploadedDriveFile.id);
      if (!res?.success || (!res.shareLink && !res.webViewLink)) {
        throw new Error(res?.error || 'Failed to generate shareable link.');
      }

      const finalUrl = res.shareLink || res.webViewLink;
      this.publishedUrl = finalUrl;
      this.state = 'completed';
      this._emitRecordingState();

      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('bugdesk:attachment-ready', {
            detail: {
              url: finalUrl,
              filename: this.preservedFilename,
              fileId: this.uploadedDriveFile.id
            }
          })
        );
      }
    } catch (err) {
      this.state = 'error';
      this.errorMessage = err.message || 'Retry publish failed';
      this._emitRecordingState();
    }
  }

  /**
   * Download the preserved video file locally
   */
  downloadLocalVideo(customFilename = null) {
    if (!this.preservedBlob || typeof window === 'undefined') return false;
    const url = URL.createObjectURL(this.preservedBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = customFilename || this.preservedFilename || generateScreenMirrorFilename({
      device: this.activeStreamInfo?.device,
      ext: this.recordingMimeConfig?.ext || 'webm'
    });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }

  getPendingRecording() {
    return this.pendingRecording;
  }

  discardPendingRecording() {
    this.pendingRecording = null;
    this.isConfirmingUpload = false;
    // Clear preserved data so that no stale blob remains after skipping upload
    this.preservedBlob = null;
    this.preservedFilename = null;
    if (this.state === 'ready_to_upload' || this.state === 'finalizing') {
      this.state = 'idle';
    }
    this._emitRecordingState();
  }

  clearPendingRecording() {
    this.pendingRecording = null;
    this.isConfirmingUpload = false;
  }

  reset() {
    this._stopTimer();
    this.state = 'idle';
    this.durationSec = 0;
    this.uploadProgress = 0;
    this.errorMessage = null;
    this.isUploadingInProgress = false;
    this.preservedBlob = null;
    this.preservedFilename = null;
    this.uploadedDriveFile = null;
    this.publishedUrl = null;
    this.pendingRecording = null;
    this.isConfirmingUpload = false;
    this._emitRecordingState();
  }

  _emitStatusChanged() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('mirror:status-changed', {
          detail: {
            status: this.getMirrorStatus(),
            device: this.getActiveDevice(),
            isReady: this.isMirrorReady()
          }
        })
      );
    }
  }

  _emitRecordingState() {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('bugdesk:recording-state-changed', {
          detail: {
            state: this.state,
            durationSec: this.durationSec,
            uploadProgress: this.uploadProgress,
            errorMessage: this.errorMessage,
            publishedUrl: this.publishedUrl,
            hasPreservedBlob: Boolean(this.preservedBlob),
            hasUploadedFile: Boolean(this.uploadedDriveFile),
            hasPendingRecording: Boolean(this.pendingRecording),
            isConfirmingUpload: Boolean(this.isConfirmingUpload)
          }
        })
      );
    }
  }
}

export const screenMirrorStreamManager = new ScreenMirrorStreamManager();
export default screenMirrorStreamManager;
