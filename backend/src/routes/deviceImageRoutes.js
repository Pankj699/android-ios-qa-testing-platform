const express = require('express');
const router = express.Router();
const deviceImageService = require('../services/deviceImageService');
const logger = require('../utils/logger');

/**
 * GET /api/devices/image/:manufacturer/:model
 * Serves verified, shared device thumbnails with ETag & validation.
 * Public endpoint used by DeviceThumbnail component across the entire app.
 */
router.get('/:manufacturer/:model', (req, res) => {
  try {
    const rawMfg = req.params.manufacturer || '';
    const rawModel = req.params.model || '';

    // Check for path traversal attempts
    if (rawMfg.includes('..') || rawMfg.includes('/') || rawMfg.includes('\\') ||
        rawModel.includes('..') || rawModel.includes('/') || rawModel.includes('\\')) {
      return res.status(400).json({ success: false, error: 'Invalid device parameters.' });
    }

    const sMfg = deviceImageService.sanitizeIdentifier(rawMfg);
    const sModel = deviceImageService.sanitizeIdentifier(rawModel);

    if (!sMfg || !sModel) {
      return res.status(400).json({ success: false, error: 'Manufacturer and model are required.' });
    }

    const serveOriginal = req.query.original === 'true';
    const record = deviceImageService.getCachedRecord(sMfg, sModel, { original: serveOriginal });

    if (!record || record.status !== 'cached' || !record.filePath) {
      return res.status(404).json({
        success: false,
        error: 'Device model image not cached.',
        manufacturer: sMfg,
        model: sModel
      });
    }

    // Check ETag for 304 Not Modified
    const clientETag = req.headers['if-none-match'];
    if (clientETag && clientETag === record.eTag) {
      return res.status(304).end();
    }

    // Safe Cache-Control: allows fast browser caching while requiring revalidation if updated
    res.setHeader('ETag', record.eTag);
    res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
    res.setHeader('Content-Type', record.mimeType || 'image/jpeg');

    res.sendFile(record.filePath);
  } catch (err) {
    logger.error(`[DeviceImageRoutes] Failed to serve image: ${err.message}`);
    res.status(500).json({ success: false, error: 'Internal server error serving device image.' });
  }
});

module.exports = router;
