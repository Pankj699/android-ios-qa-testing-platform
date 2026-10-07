const logger = require('../utils/logger');
const config = require('../config');

function errorHandler(err, req, res, next) {
  logger.error(`[API Error] ${req.method} ${req.originalUrl}: ${err.message}`);

  let statusCode = err.status || 500;
  let friendlyMessage = err.message;
  let technicalDetails = err.stack;

  // Enhance common errors with QA-friendly hints
  if (err.message.includes('ENOENT')) {
    friendlyMessage = 'A required tool or binary (ADB, Java, or Bundletool) was not found on the QA server. Please check System Diagnostics.';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    friendlyMessage = `File size exceeds the maximum allowed limit of ${config.MAX_AAB_SIZE_MB}MB.`;
  } else if (err.message.includes('Only Android App Bundle')) {
    statusCode = 400;
  }

  res.status(statusCode).json({
    success: false,
    error: friendlyMessage,
    technicalDetails: config.NODE_ENV === 'development' ? technicalDetails : undefined,
    timestamp: new Date().toISOString()
  });
}

module.exports = errorHandler;
