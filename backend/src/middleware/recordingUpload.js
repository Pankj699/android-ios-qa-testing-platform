const multer = require('multer');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const { sanitizeFilename } = require('../utils/fileUtils');

const ALLOWED_EXTENSIONS = new Set(['.webm', '.mp4', '.mkv']);
const ALLOWED_MIME_PREFIXES = ['video/webm', 'video/mp4', 'video/x-matroska', 'video/quicktime'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userId = req.user?.id ? String(req.user.id).replace(/[^a-zA-Z0-9_-]/g, '_') : 'anonymous';
    const destDir = path.join(config.UPLOAD_DIR, 'recordings', userId);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    cb(null, destDir);
  },
  filename: (req, file, cb) => {
    const cleanOrig = sanitizeFilename(path.basename(file.originalname || 'recording.webm'));
    const ext = path.extname(cleanOrig).toLowerCase() || '.webm';
    const base = path.basename(cleanOrig, ext).slice(0, 50);
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `${base}-${uniqueSuffix}${ext}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname || '').toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  const isExtAllowed = ALLOWED_EXTENSIONS.has(ext);
  const isMimeAllowed =
    ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix)) ||
    mime === 'application/octet-stream'; // Browsers sometimes label webm blobs as octet-stream

  if (isExtAllowed && isMimeAllowed) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Invalid video file type '${ext || mime}'. Only webm, mp4, and mkv video recordings are accepted.`
      ),
      false
    );
  }
};

const recordingUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.MAX_RECORDING_SIZE_MB * 1024 * 1024
  }
});

module.exports = recordingUpload;
