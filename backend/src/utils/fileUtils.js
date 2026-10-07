const fs = require('fs');
const path = require('path');
const config = require('../config');

// Ensure base directories exist
[config.UPLOAD_DIR, config.LOG_DIR, config.DATA_DIR, config.TOOLS_DIR, config.APKS_OUTPUT_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

function sanitizeFilename(filename) {
  return filename
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.');
}

function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function deleteFileIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
  } catch (e) {
    // ignore
  }
  return false;
}

function getAvailableDiskSpace() {
  // Approximate disk check or report directory size
  return 'Available';
}

module.exports = {
  sanitizeFilename,
  formatBytes,
  deleteFileIfExists,
  getAvailableDiskSpace
};
