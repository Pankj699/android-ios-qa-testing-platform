/**
 * BugDesk Video Upload Utilities
 * Reusable validation, size formatting, and state helpers.
 */

export const MAX_VIDEO_SIZE_MB = 500;
export const MAX_VIDEO_SIZE_BYTES = MAX_VIDEO_SIZE_MB * 1024 * 1024;

export const ALLOWED_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.mkv'];
export const ALLOWED_VIDEO_MIMES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'application/octet-stream'
];

/**
 * Formats byte size into human readable string (B, KB, MB)
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes === 0 || bytes === null || bytes === undefined) return '0 B';
  const num = typeof bytes === 'number' ? bytes : parseInt(bytes, 10);
  if (isNaN(num) || num <= 0) return '0 B';
  if (num < 1024) return `${num} B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
  return `${(num / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validates selected file for extension and 500 MB size limit
 * @param {File|object} file
 * @returns {{ valid: boolean, error: string|null }}
 */
export function validateVideoFile(file) {
  if (!file) {
    return { valid: false, error: 'No video file provided.' };
  }

  const name = file.name || '';
  const lastDot = name.lastIndexOf('.');
  const ext = lastDot !== -1 ? name.slice(lastDot).toLowerCase() : '';
  const mime = (file.type || '').toLowerCase();

  const isExtAllowed = ALLOWED_VIDEO_EXTENSIONS.includes(ext);
  const isMimeAllowed =
    !mime ||
    ALLOWED_VIDEO_MIMES.some((allowed) => mime.startsWith(allowed));

  if (!isExtAllowed && (!mime || !ALLOWED_VIDEO_MIMES.some((m) => mime.startsWith(m)))) {
    return {
      valid: false,
      error: `Unsupported file format "${ext || mime || 'unknown'}". Please upload an MP4, MOV, or WebM video.`
    };
  }

  const fileSize = typeof file.size === 'number' ? file.size : 0;
  if (fileSize > MAX_VIDEO_SIZE_BYTES) {
    const sizeMb = (fileSize / (1024 * 1024)).toFixed(1);
    return {
      valid: false,
      error: `File size exceeds the ${MAX_VIDEO_SIZE_MB} MB limit (selected: ${sizeMb} MB).`
    };
  }

  return { valid: true, error: null };
}

/**
 * Prepares the upload FormData payload for Google Drive.
 * @param {File} file
 * @param {object} [options]
 * @returns {FormData}
 */
export function buildVideoUploadFormData(file, options = {}) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('originalFilename', options.filename || file.name || 'video_attachment.mp4');
  formData.append('mimeType', file.type || 'video/mp4');
  if (options.folderId && options.folderId !== 'root') {
    formData.append('folderId', options.folderId);
  }
  return formData;
}

/**
 * Replaces attachment URL in bug report state while preserving all unrelated fields.
 * @param {object|null} currentReport
 * @param {string} newUrl
 * @returns {object|null}
 */
export function applyAttachmentUrlToReport(currentReport, newUrl) {
  if (!currentReport) return null;
  return {
    ...currentReport,
    attachmentUrl: String(newUrl || '').trim(),
    hasAttachment: true
  };
}
