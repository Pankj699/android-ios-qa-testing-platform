import * as React from "react";
import {
  UploadCloud,
  FileVideo,
  Video,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  HardDrive
} from "lucide-react";
import { Button } from "./ui/button";
import { api } from "../../services/api";
import {
  formatFileSize,
  validateVideoFile,
  buildVideoUploadFormData,
  MAX_VIDEO_SIZE_MB
} from "../lib/video-upload-utils";

/**
 * BugDeskVideoUpload Component
 *
 * Dedicated video drag-and-drop upload zone for BugDesk.
 * - Allows dragging/browsing MP4, MOV, WebM, MKV files up to 500 MB.
 * - Uploads to the user's configured default Google Drive folder.
 * - Publishes a shareable link and invokes onUploadSuccess to update Attachment URL.
 * - Prevents accidental page navigation on drop.
 * - Reusable and safe against duplicate submissions and failures.
 */
export default function BugDeskVideoUpload({
  onUploadSuccess,
  onStatusChange,
  disabled = false,
  currentAttachmentUrl = ""
}) {
  const [selectedFile, setSelectedFile] = React.useState(null);
  const [uploadStatus, setUploadStatus] = React.useState("idle"); // 'idle' | 'selected' | 'uploading' | 'publishing' | 'success' | 'error'
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [errorMessage, setErrorMessage] = React.useState(null);
  const [publishedUrl, setPublishedUrl] = React.useState(null);
  const [isDragging, setIsDragging] = React.useState(false);

  const fileInputRef = React.useRef(null);
  const dragCounterRef = React.useRef(0);
  const isUploadingRef = React.useRef(false);

  // Synchronize ref to prevent concurrent upload clicks
  isUploadingRef.current = uploadStatus === "uploading" || uploadStatus === "publishing";

  // Notify parent of status changes if requested
  React.useEffect(() => {
    if (onStatusChange) {
      onStatusChange({
        uploadStatus,
        uploadProgress,
        isUploading: uploadStatus === "uploading" || uploadStatus === "publishing",
        selectedFile,
        publishedUrl,
        errorMessage
      });
    }
  }, [uploadStatus, uploadProgress, selectedFile, publishedUrl, errorMessage, onStatusChange]);

  // Prevent accidental browser navigation when dropping files anywhere on window
  React.useEffect(() => {
    const handleWindowDragOver = (e) => {
      e.preventDefault();
    };
    const handleWindowDrop = (e) => {
      e.preventDefault();
    };

    window.addEventListener("dragover", handleWindowDragOver, false);
    window.addEventListener("drop", handleWindowDrop, false);

    return () => {
      window.removeEventListener("dragover", handleWindowDragOver, false);
      window.removeEventListener("drop", handleWindowDrop, false);
    };
  }, []);

  const processFile = (file) => {
    if (!file) return;

    const validation = validateVideoFile(file);
    if (!validation.valid) {
      setErrorMessage(validation.error);
      setUploadStatus("error");
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    setUploadStatus("selected");
    setErrorMessage(null);
    setUploadProgress(0);
    setPublishedUrl(null);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || isUploadingRef.current) return;
    dragCounterRef.current += 1;
    if (e.dataTransfer?.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "copy";
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    if (disabled || isUploadingRef.current) return;

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleClearSelection = (e) => {
    if (e) e.stopPropagation();
    setSelectedFile(null);
    setUploadStatus("idle");
    setErrorMessage(null);
    setUploadProgress(0);
    setPublishedUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUpload = async (e) => {
    if (e) e.stopPropagation();
    if (!selectedFile || isUploadingRef.current || disabled) return;

    setUploadStatus("uploading");
    setUploadProgress(0);
    setErrorMessage(null);

    try {
      // 1. Verify Google Drive connection status
      const driveStatus = await api.getDriveStatus().catch(() => null);
      if (!driveStatus?.connected) {
        throw new Error(
          "Google Drive is not connected. Please connect Google Drive in Settings or the QA Platform sidebar."
        );
      }

      // 2. Resolve configured default destination folder
      const defaultFolderRes = await api.getDriveDefaultFolder().catch(() => null);
      const folderId =
        defaultFolderRes?.defaultFolderId && defaultFolderRes.defaultFolderId !== "root"
          ? defaultFolderRes.defaultFolderId
          : null;

      // 3. Build multipart form data
      const formData = buildVideoUploadFormData(selectedFile, {
        filename: selectedFile.name,
        folderId
      });

      // 4. Stream upload with real-time progress
      const uploadRes = await api.uploadScreenRecording(formData, (percent) => {
        if (typeof percent === "number" && !isNaN(percent)) {
          setUploadProgress(Math.min(100, Math.max(0, percent)));
        }
      });

      const fileId = uploadRes?.recording?.google_drive_file_id;
      if (!fileId) {
        throw new Error(uploadRes?.error || "Upload succeeded but no Google Drive file ID was returned.");
      }

      // 5. Automatically publish file to generate shareable link
      setUploadStatus("publishing");
      setUploadProgress(100);

      const publishRes = await api.publishDriveFile(fileId);
      if (!publishRes?.success || (!publishRes.shareLink && !publishRes.webViewLink)) {
        throw new Error(publishRes?.error || "Video uploaded, but failed to generate public share link.");
      }

      const finalUrl = publishRes.shareLink || publishRes.webViewLink;
      setPublishedUrl(finalUrl);
      setUploadStatus("success");

      // 6. Mandatory auto-replacement: set the Attachment URL & update BugDesk preview
      if (onUploadSuccess) {
        onUploadSuccess(finalUrl, {
          fileId,
          filename: selectedFile.name,
          size: selectedFile.size
        });
      }
    } catch (err) {
      console.error("[BugDeskVideoUpload] Upload/publish error:", err);
      setErrorMessage(err.message || "Failed to upload video to Google Drive.");
      setUploadStatus("error");
      // Safety rule: Never clear or touch Attachment URL on failure. Selected file is preserved for retry.
    }
  };

  const isUploading = uploadStatus === "uploading" || uploadStatus === "publishing";

  return (
    <div className="space-y-2">
      {/* Hidden native file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv"
        onChange={handleFileChange}
        className="hidden"
        disabled={disabled || isUploading}
      />

      {/* Main Drag & Drop Zone */}
      <div
        onClick={() => {
          if (!isUploading && uploadStatus !== "success") {
            fileInputRef.current?.click();
          }
        }}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`relative rounded-lg border-2 transition-all p-3.5 select-none ${
          isDragging
            ? "border-[#F59E0B] bg-[#F59E0B]/10 ring-2 ring-[#F59E0B]/20 cursor-copy"
            : uploadStatus === "success"
            ? "border-emerald-500/40 bg-emerald-500/5 cursor-default"
            : uploadStatus === "error"
            ? "border-rose-500/40 bg-rose-500/5 cursor-pointer"
            : uploadStatus === "selected"
            ? "border-slate-300 dark:border-[#1E2638] bg-slate-50 dark:bg-[#080B12] cursor-default"
            : isUploading
            ? "border-slate-300 dark:border-[#1E2638] bg-slate-50 dark:bg-[#080B12] opacity-90 cursor-wait"
            : "border-dashed border-purple-300 hover:border-purple-500 bg-purple-50/40 hover:bg-purple-50/70 dark:border-[#1E2638] dark:hover:border-[#F59E0B]/50 dark:bg-[#080B12]/60 dark:hover:bg-[#080B12] cursor-pointer"
        }`}
      >
        {/* State: Idle (No file selected) */}
        {uploadStatus === "idle" && (
          <div className="flex flex-col items-center justify-center text-center py-2 space-y-1.5">
            <div className="h-8 w-8 rounded-full bg-purple-100 border border-purple-200 text-purple-600 dark:bg-[#141A28] dark:border-[#1E2638] dark:text-amber-400 flex items-center justify-center shadow-xs">
              <UploadCloud className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[12.5px] font-medium text-slate-700 dark:text-slate-200">
                Drag and drop a video here, or <span className="text-purple-600 dark:text-[#F59E0B] underline font-semibold">click to browse</span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-[#8F97A6] mt-0.5">
                Upload videos directly to Google Drive (MP4, MOV, WebM up to {MAX_VIDEO_SIZE_MB}MB)
              </p>
            </div>
          </div>
        )}

        {/* State: Selected (File ready to upload) */}
        {uploadStatus === "selected" && selectedFile && (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-purple-100 border border-purple-200 text-purple-600 dark:bg-[#141A28] dark:border-[#1E2638] dark:text-amber-400 flex items-center justify-center shrink-0">
                  <FileVideo className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-slate-900 dark:text-white truncate max-w-[280px]">
                    {selectedFile.name}
                  </p>
                  <p className="text-[11px] font-mono text-slate-500 dark:text-[#8F97A6]">
                    {formatFileSize(selectedFile.size)} • Ready to upload
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearSelection}
                  className="h-7 px-2 text-slate-500 hover:text-slate-900 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/50 text-[11px]"
                  title="Remove selection"
                >
                  <X className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Remove</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleUpload}
                  disabled={disabled}
                  className="btn-primary-gradient text-white font-bold text-[12px] h-7 px-3 rounded-md flex items-center gap-1.5 shadow-xs cursor-pointer"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  <span>Upload Video</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* State: Uploading or Publishing */}
        {isUploading && selectedFile && (
          <div className="space-y-2 py-1">
            <div className="flex items-center justify-between text-[12px]">
              <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-medium">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600 dark:text-[#F59E0B]" />
                <span>
                  {uploadStatus === "uploading"
                    ? `Uploading ${selectedFile.name}...`
                    : "Publishing shareable link in Google Drive..."}
                </span>
              </div>
              <span className="font-mono text-[11px] text-purple-600 dark:text-amber-400 font-semibold">
                {uploadProgress}%
              </span>
            </div>

            {/* Progress track */}
            <div className="w-full bg-slate-200 dark:bg-[#141A28] rounded-full h-1.5 overflow-hidden border border-slate-300 dark:border-[#1E2638]">
              <div
                className="bg-purple-600 dark:bg-[#F59E0B] h-full transition-all duration-300 ease-out"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* State: Success */}
        {uploadStatus === "success" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                  <CheckCircle2 className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-emerald-300 flex items-center gap-1.5">
                    <span>Video uploaded &amp; link attached!</span>
                  </p>
                  {publishedUrl && (
                    <a
                      href={publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] font-mono text-teal-400 hover:underline flex items-center gap-1 truncate max-w-[320px] mt-0.5"
                      title={publishedUrl}
                    >
                      <span className="truncate">{publishedUrl}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  )}
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleClearSelection}
                className="h-7 px-2 text-slate-400 hover:text-white hover:bg-slate-800/50 text-[11px] shrink-0"
                title="Upload another video"
              >
                <span>Upload another</span>
              </Button>
            </div>
          </div>
        )}

        {/* State: Error */}
        {uploadStatus === "error" && (
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="h-8 w-8 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0 mt-0.5">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-rose-400">
                    Upload failed
                  </p>
                  <p className="text-[11.5px] text-rose-300/90 leading-tight mt-0.5">
                    {errorMessage || "An error occurred while uploading to Google Drive."}
                  </p>
                  {selectedFile && (
                    <p className="text-[11px] font-mono text-slate-400 mt-1">
                      File: {selectedFile.name} ({formatFileSize(selectedFile.size)})
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                {selectedFile && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleUpload}
                    disabled={disabled || isUploading}
                    className="bg-[#F59E0B] hover:bg-[#E58E00] text-[#0A0D14] font-bold text-[11px] h-7 px-2.5 rounded-md flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry</span>
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearSelection}
                  className="h-7 px-1.5 text-slate-400 hover:text-white text-[11px]"
                  title="Dismiss error"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
