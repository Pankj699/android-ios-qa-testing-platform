const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../utils/logger');
const config = require('../config');

function safeBroadcast(type, payload = {}) {
  try {
    const testSocket = require('../websocket/testSocket');
    if (testSocket && typeof testSocket.broadcastEvent === 'function') {
      testSocket.broadcastEvent(type, payload);
    }
  } catch (err) {
    logger.debug(`[DeviceImageService] WebSocket broadcast deferred: ${err.message}`);
  }
}

// Storage directories
const DATA_DIR = path.resolve(__dirname, '../../data');
const IMAGE_CACHE_DIR = path.join(DATA_DIR, 'device_images');
const MANIFEST_FILE = path.join(IMAGE_CACHE_DIR, 'manifest.json');
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2.0 MB maximum upload size

class DeviceImageService {
  constructor() {
    this.manifest = {};
    this._manifestMtime = 0;
    this._ensureStorage();
    this._loadManifest();
  }

  _ensureStorage() {
    try {
      if (!fs.existsSync(IMAGE_CACHE_DIR)) {
        fs.mkdirSync(IMAGE_CACHE_DIR, { recursive: true });
      }
    } catch (err) {
      logger.error(`[DeviceImageService] Failed to create image cache directory: ${err.message}`);
    }
  }

  _loadManifest() {
    try {
      if (fs.existsSync(MANIFEST_FILE)) {
        const stats = fs.statSync(MANIFEST_FILE);
        if (this._manifestMtime && stats.mtimeMs <= this._manifestMtime) {
          return;
        }
        const raw = fs.readFileSync(MANIFEST_FILE, 'utf8');
        this.manifest = JSON.parse(raw);
        this._manifestMtime = stats.mtimeMs;
        logger.info(`[DeviceImageService] Loaded ${Object.keys(this.manifest).length} device catalog records.`);
      } else {
        this.manifest = {};
      }
    } catch (err) {
      logger.warn(`[DeviceImageService] Failed to load manifest, initializing empty: ${err.message}`);
      this.manifest = {};
    }
  }

  _saveManifest() {
    try {
      const tmpFile = `${MANIFEST_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(this.manifest, null, 2), 'utf8');
      fs.renameSync(tmpFile, MANIFEST_FILE);
      if (fs.existsSync(MANIFEST_FILE)) {
        this._manifestMtime = fs.statSync(MANIFEST_FILE).mtimeMs;
      }
    } catch (err) {
      logger.error(`[DeviceImageService] Failed to save manifest: ${err.message}`);
    }
  }

  reload() {
    this._manifestMtime = 0;
    this._loadManifest();
    return this.manifest;
  }

  sanitizeIdentifier(input = '') {
    if (typeof input !== 'string') return '';
    return input.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
  }

  getCacheKey(mfg, model) {
    const sMfg = this.sanitizeIdentifier(mfg);
    const sModel = this.sanitizeIdentifier(model);
    return `${sMfg}:${sModel}`;
  }

  /**
   * Normalizes raw device object from discovery systems (ADB, iOS, Agent)
   */
  normalizeDeviceIdentity(device) {
    if (!device) return { sMfg: '', sModel: '', isIos: false, displayName: '' };

    const isIos = Boolean(
      device.platform === 'ios' ||
      (device.model && /i(phone|pad|pod)/i.test(device.model)) ||
      (device.name && /i(phone|pad|pod)/i.test(device.name))
    );

    const rawMfg = isIos ? 'apple' : (device.manufacturer || '');
    const rawModel = device.model || (isIos ? (device.name || 'iphone') : (device.name || ''));

    const sMfg = this.sanitizeIdentifier(rawMfg);
    const sModel = this.sanitizeIdentifier(rawModel);

    let displayName = device.displayName || device.name || '';
    if (!displayName) {
      const niceMfg = sMfg.charAt(0).toUpperCase() + sMfg.slice(1);
      displayName = `${niceMfg} ${sModel.toUpperCase()}`;
    }

    return { sMfg, sModel, isIos, displayName };
  }

  /**
   * Validates binary headers, dimensions, and pixel bounds for JPEG, PNG, and WebP.
   */
  validateImageBuffer(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 24) {
      return { valid: false, error: 'File buffer too small or empty.' };
    }
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      return { valid: false, error: `File size exceeds ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB limit.` };
    }

    let type = null;
    let width = 0;
    let height = 0;

    // 1. PNG Check (Magic: 89 50 4E 47)
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      type = 'image/png';
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
    }
    // 2. JPEG Check (Magic: FF D8 FF)
    else if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
      type = 'image/jpeg';
      let offset = 2;
      while (offset < buffer.length - 8) {
        if (buffer[offset] !== 0xFF) { offset++; continue; }
        const marker = buffer[offset + 1];
        if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) ||
            (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
          height = buffer.readUInt16BE(offset + 5);
          width = buffer.readUInt16BE(offset + 7);
          break;
        }
        const len = buffer.readUInt16BE(offset + 2);
        offset += 2 + len;
      }
    }
    // 3. WebP Check (Magic: RIFF....WEBP)
    else if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      type = 'image/webp';
      const chunkType = buffer.toString('ascii', 12, 16);
      if (chunkType === 'VP8 ' && buffer.length >= 30) {
        width = buffer.readUInt16LE(26) & 0x3fff;
        height = buffer.readUInt16LE(28) & 0x3fff;
      } else if (chunkType === 'VP8L' && buffer.length >= 25) {
        const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
        width = 1 + (((b2 & 0x3F) << 8) | b1);
        height = 1 + (((b4 & 0xF) << 10) | (b3 << 2) | ((b2 & 0xC0) >> 6));
      } else if (chunkType === 'VP8X' && buffer.length >= 30) {
        width = 1 + buffer.readUIntLE(24, 3);
        height = 1 + buffer.readUIntLE(27, 3);
      }
    }

    if (!type || width === 0 || height === 0) {
      return { valid: false, error: 'Unrecognized image format or corrupt headers. Only PNG, JPEG, and WebP are supported.' };
    }

    if (width < 32 || height < 32) {
      return { valid: false, error: `Image dimensions too small (${width}x${height}). Minimum is 32x32 pixels.` };
    }
    if (width > 4096 || height > 4096 || (width * height > 16000000)) {
      return { valid: false, error: `Image dimensions or pixel count exceed safe bounds (${width}x${height}). Maximum is 4096x4096.` };
    }

    return { valid: true, type, width, height };
  }

  /**
   * Uploads or replaces a device thumbnail image.
   * Shared globally across all users and sessions.
   * Preserves the raw original image separately if trimmed or requested.
   */
  uploadDeviceImage({ manufacturer, model, buffer, originalBuffer = null, isTrimmed = false, user = null, displayName = null }) {
    if (typeof manufacturer !== 'string' || typeof model !== 'string') {
      throw new Error('Manufacturer and model must be strings.');
    }
    if (manufacturer.includes('..') || manufacturer.includes('/') || manufacturer.includes('\\') ||
        model.includes('..') || model.includes('/') || model.includes('\\')) {
      throw new Error('Path traversal characters are prohibited in manufacturer and model identifiers.');
    }

    const sMfg = this.sanitizeIdentifier(manufacturer);
    const sModel = this.sanitizeIdentifier(model);

    if (!sMfg) {
      throw new Error('Manufacturer is required and must contain alphanumeric characters.');
    }
    if (!sModel) {
      throw new Error('Model identifier is required and must contain alphanumeric characters.');
    }

    const validation = this.validateImageBuffer(buffer);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    let origValidation = null;
    if (originalBuffer && Buffer.isBuffer(originalBuffer) && originalBuffer.length > 0) {
      origValidation = this.validateImageBuffer(originalBuffer);
      if (!origValidation.valid) {
        throw new Error(`Original image validation failed: ${origValidation.error}`);
      }
    }

    const key = this.getCacheKey(sMfg, sModel);
    this._loadManifest();
    const existing = this.manifest[key] || {};

    const ext = validation.type === 'image/png' ? 'png' : (validation.type === 'image/webp' ? 'webp' : 'jpg');
    const fileName = `${sMfg}_${sModel}.${ext}`;
    const filePath = path.join(IMAGE_CACHE_DIR, fileName);

    // Path traversal guard
    const resolvedPath = path.resolve(filePath);
    const resolvedCacheDir = path.resolve(IMAGE_CACHE_DIR);
    if (!resolvedPath.startsWith(resolvedCacheDir)) {
      throw new Error('Invalid file path.');
    }

    // Clean up older active image if extension changed
    if (existing.fileName && existing.fileName !== fileName && existing.fileName !== existing.originalFileName) {
      const oldFilePath = path.join(IMAGE_CACHE_DIR, existing.fileName);
      try {
        if (fs.existsSync(oldFilePath)) fs.unlinkSync(oldFilePath);
      } catch (_) {}
    }

    // Write active thumbnail atomically
    const tmpFile = `${filePath}.tmp`;
    fs.writeFileSync(tmpFile, buffer);
    fs.renameSync(tmpFile, filePath);
    try { fs.chmodSync(filePath, 0o644); } catch (_) {}

    // Handle original image preservation
    let originalFileName = existing.originalFileName || null;
    let originalFileSize = existing.originalFileSize || null;
    let originalWidth = existing.originalWidth || null;
    let originalHeight = existing.originalHeight || null;

    if (origValidation && originalBuffer) {
      const origExt = origValidation.type === 'image/png' ? 'png' : (origValidation.type === 'image/webp' ? 'webp' : 'jpg');
      originalFileName = `${sMfg}_${sModel}_orig.${origExt}`;
      const origFilePath = path.join(IMAGE_CACHE_DIR, originalFileName);
      const tmpOrigFile = `${origFilePath}.tmp`;
      fs.writeFileSync(tmpOrigFile, originalBuffer);
      fs.renameSync(tmpOrigFile, origFilePath);
      try { fs.chmodSync(origFilePath, 0o644); } catch (_) {}
      originalFileSize = originalBuffer.length;
      originalWidth = origValidation.width;
      originalHeight = origValidation.height;
    } else if (!originalFileName) {
      // If no separate original was provided and none existed, preserve buffer as original
      originalFileName = `${sMfg}_${sModel}_orig.${ext}`;
      const origFilePath = path.join(IMAGE_CACHE_DIR, originalFileName);
      const tmpOrigFile = `${origFilePath}.tmp`;
      fs.writeFileSync(tmpOrigFile, buffer);
      fs.renameSync(tmpOrigFile, origFilePath);
      try { fs.chmodSync(origFilePath, 0o644); } catch (_) {}
      originalFileSize = buffer.length;
      originalWidth = validation.width;
      originalHeight = validation.height;
    }

    const hash = crypto.createHash('sha256').update(buffer).digest('hex').substring(0, 16);
    const eTag = `"${hash}"`;

    const userEmail = user?.email || user?.id || 'admin';
    const computedDisplayName = displayName || existing.displayName || `${sMfg.toUpperCase()} ${sModel.toUpperCase()}`;

    const record = {
      manufacturer: sMfg,
      model: sModel,
      displayName: computedDisplayName,
      fileName,
      fileSize: buffer.length,
      mimeType: validation.type,
      width: validation.width,
      height: validation.height,
      eTag,
      originalFileName,
      originalFileSize,
      originalWidth,
      originalHeight,
      isTrimmed: Boolean(isTrimmed),
      status: 'cached',
      uploadedAt: existing.uploadedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail
    };

    this.manifest[key] = record;
    this._saveManifest();

    logger.info(`[DeviceImageService] Saved thumbnail for ${key} (${fileName}, ${validation.width}x${validation.height}, ${buffer.length} bytes, trimmed: ${isTrimmed}) by ${userEmail}`);

    // Broadcast WebSocket update so all active sessions hot-reload the thumbnail immediately
    safeBroadcast('DEVICE_IMAGE_UPDATED', {
      manufacturer: sMfg,
      model: sModel,
      imageUrl: `/api/devices/image/${sMfg}/${sModel}`,
      eTag,
      timestamp: Date.now()
    });

    return {
      manufacturer: record.manufacturer,
      model: record.model,
      displayName: record.displayName,
      fileName: record.fileName,
      fileSize: record.fileSize,
      mimeType: record.mimeType,
      width: record.width,
      height: record.height,
      eTag: record.eTag,
      originalFileName: record.originalFileName,
      originalWidth: record.originalWidth,
      originalHeight: record.originalHeight,
      isTrimmed: record.isTrimmed,
      updatedAt: record.updatedAt,
      hasImage: true,
      thumbnailUrl: `/api/devices/image/${sMfg}/${sModel}`
    };
  }

  /**
   * Removes an uploaded thumbnail image while preserving the model catalog record.
   */
  removeDeviceImage(manufacturer, model, user = null) {
    const sMfg = this.sanitizeIdentifier(manufacturer);
    const sModel = this.sanitizeIdentifier(model);
    const key = this.getCacheKey(sMfg, sModel);

    this._loadManifest();
    const record = this.manifest[key];
    if (!record) {
      throw new Error(`Device model '${sMfg}:${sModel}' not found in catalog.`);
    }

    if (record.fileName) {
      const filePath = path.join(IMAGE_CACHE_DIR, record.fileName);
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (err) {
        logger.warn(`[DeviceImageService] Failed to unlink file ${record.fileName}: ${err.message}`);
      }
    }

    if (record.originalFileName && record.originalFileName !== record.fileName) {
      const origFilePath = path.join(IMAGE_CACHE_DIR, record.originalFileName);
      try {
        if (fs.existsSync(origFilePath)) {
          fs.unlinkSync(origFilePath);
        }
      } catch (_) {}
    }

    // Preserve catalog entry, but mark as no image
    delete record.fileName;
    delete record.fileSize;
    delete record.mimeType;
    delete record.width;
    delete record.height;
    delete record.eTag;
    delete record.originalFileName;
    delete record.originalFileSize;
    delete record.originalWidth;
    delete record.originalHeight;
    delete record.isTrimmed;
    record.status = 'no_image';
    record.updatedAt = new Date().toISOString();
    record.updatedBy = user?.email || user?.id || 'admin';

    this._saveManifest();
    logger.info(`[DeviceImageService] Removed image for ${key} by ${record.updatedBy}`);

    // Notify all active sessions to restore generic SVG illustration
    safeBroadcast('DEVICE_IMAGE_UPDATED', {
      manufacturer: sMfg,
      model: sModel,
      removed: true,
      status: 'removed',
      timestamp: Date.now()
    });

    return { success: true, message: `Image removed for ${sMfg} ${sModel}.` };
  }

  /**
   * Restores the original uploaded image if an optimized/trimmed version was active.
   */
  restoreOriginalImage(manufacturer, model, user = null) {
    const sMfg = this.sanitizeIdentifier(manufacturer);
    const sModel = this.sanitizeIdentifier(model);
    const key = this.getCacheKey(sMfg, sModel);

    this._loadManifest();
    const record = this.manifest[key];
    if (!record || !record.originalFileName) {
      throw new Error(`Original image not available for '${sMfg}:${sModel}'.`);
    }

    const origPath = path.join(IMAGE_CACHE_DIR, record.originalFileName);
    if (!fs.existsSync(origPath)) {
      throw new Error(`Original image file '${record.originalFileName}' not found on disk.`);
    }

    const origBuffer = fs.readFileSync(origPath);
    const validation = this.validateImageBuffer(origBuffer);
    if (!validation.valid) {
      throw new Error(`Original image corrupted: ${validation.error}`);
    }

    const ext = validation.type === 'image/png' ? 'png' : (validation.type === 'image/webp' ? 'webp' : 'jpg');
    const activeFileName = `${sMfg}_${sModel}.${ext}`;
    const activePath = path.join(IMAGE_CACHE_DIR, activeFileName);

    // Atomically copy original buffer over active thumbnail file
    const tmpFile = `${activePath}.tmp`;
    fs.writeFileSync(tmpFile, origBuffer);
    fs.renameSync(tmpFile, activePath);
    try { fs.chmodSync(activePath, 0o644); } catch (_) {}

    const hash = crypto.createHash('sha256').update(origBuffer).digest('hex').substring(0, 16);
    const eTag = `"${hash}"`;

    record.fileName = activeFileName;
    record.fileSize = origBuffer.length;
    record.mimeType = validation.type;
    record.width = validation.width;
    record.height = validation.height;
    record.eTag = eTag;
    record.isTrimmed = false;
    record.updatedAt = new Date().toISOString();
    record.updatedBy = user?.email || user?.id || 'admin';

    this.manifest[key] = record;
    this._saveManifest();

    logger.info(`[DeviceImageService] Restored original image for ${key} (${record.width}x${record.height})`);

    safeBroadcast('DEVICE_IMAGE_UPDATED', {
      manufacturer: sMfg,
      model: sModel,
      imageUrl: `/api/devices/image/${sMfg}/${sModel}`,
      eTag,
      timestamp: Date.now()
    });

    return {
      success: true,
      message: `Original image restored for ${record.displayName}.`,
      data: record
    };
  }

  /**
   * Adds or updates a device model entry in the catalog (without image).
   */
  addOrUpdateModel({ manufacturer, model, displayName = null, user = null }) {
    const sMfg = this.sanitizeIdentifier(manufacturer);
    const sModel = this.sanitizeIdentifier(model);

    if (!sMfg || !sModel) {
      throw new Error('Manufacturer and model identifier are required.');
    }

    const key = this.getCacheKey(sMfg, sModel);
    this._loadManifest();
    const existing = this.manifest[key] || {};

    const computedDisplayName = (displayName && displayName.trim()) || existing.displayName || `${sMfg.toUpperCase()} ${sModel.toUpperCase()}`;
    const userEmail = user?.email || user?.id || 'admin';

    const record = {
      ...existing,
      manufacturer: sMfg,
      model: sModel,
      displayName: computedDisplayName,
      status: existing.status === 'cached' ? 'cached' : 'no_image',
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      updatedBy: userEmail
    };

    this.manifest[key] = record;
    this._saveManifest();
    logger.info(`[DeviceImageService] Registered model ${key} (${computedDisplayName}) by ${userEmail}`);

    return {
      manufacturer: record.manufacturer,
      model: record.model,
      displayName: record.displayName,
      hasImage: Boolean(record.status === 'cached' && record.fileName),
      thumbnailUrl: record.status === 'cached' ? `/api/devices/image/${sMfg}/${sModel}` : null,
      updatedAt: record.updatedAt
    };
  }

  /**
   * Deletes a catalog entry entirely.
   */
  deleteModel(manufacturer, model) {
    const sMfg = this.sanitizeIdentifier(manufacturer);
    const sModel = this.sanitizeIdentifier(model);
    const key = this.getCacheKey(sMfg, sModel);

    this._loadManifest();
    const record = this.manifest[key];
    if (!record) {
      return { success: true, message: 'Model was not in catalog.' };
    }

    if (record.fileName) {
      const filePath = path.join(IMAGE_CACHE_DIR, record.fileName);
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}
    }

    if (record.originalFileName) {
      const origFilePath = path.join(IMAGE_CACHE_DIR, record.originalFileName);
      try {
        if (fs.existsSync(origFilePath)) fs.unlinkSync(origFilePath);
      } catch (_) {}
    }

    delete this.manifest[key];
    this._saveManifest();
    logger.info(`[DeviceImageService] Deleted catalog model ${key}`);

    safeBroadcast('DEVICE_IMAGE_UPDATED', {
      manufacturer: sMfg,
      model: sModel,
      removed: true,
      status: 'removed',
      timestamp: Date.now()
    });

    return { success: true, message: `Model '${sMfg}:${sModel}' deleted.` };
  }

  /**
   * Retrieves a cached record for serving over HTTP.
   * Reconciles disk files if manifest was recreated or out-of-sync.
   * Supports serving original raw image via options.original === true.
   */
  getCachedRecord(mfg, model, options = {}) {
    this._loadManifest();
    const sMfg = this.sanitizeIdentifier(mfg);
    const sModel = this.sanitizeIdentifier(model);
    const key = this.getCacheKey(sMfg, sModel);
    let record = this.manifest[key];

    // Disk Reconciliation: If file exists on disk with valid image buffer
    if (!record || record.status !== 'cached' || !record.fileName) {
      for (const ext of ['jpg', 'png', 'webp', 'jpeg']) {
        const candidateFile = path.join(IMAGE_CACHE_DIR, `${sMfg}_${sModel}.${ext}`);
        if (fs.existsSync(candidateFile)) {
          try {
            const buf = fs.readFileSync(candidateFile);
            const val = this.validateImageBuffer(buf);
            if (val.valid) {
              const hash = crypto.createHash('sha256').update(buf).digest('hex').substring(0, 16);
              record = {
                manufacturer: sMfg,
                model: sModel,
                displayName: `${sMfg.toUpperCase()} ${sModel.toUpperCase()}`,
                fileName: `${sMfg}_${sModel}.${ext}`,
                fileSize: buf.length,
                mimeType: val.type,
                width: val.width,
                height: val.height,
                eTag: `"${hash}"`,
                status: 'cached',
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };
              this.manifest[key] = record;
              this._saveManifest();
              break;
            }
          } catch (_) {}
        }
      }
    }

    if (!record || record.status !== 'cached' || !record.fileName) {
      return null;
    }

    const serveOriginal = Boolean(options && options.original && record.originalFileName);
    const requestedFile = serveOriginal ? record.originalFileName : record.fileName;
    let filePath = path.join(IMAGE_CACHE_DIR, requestedFile);

    if (!fs.existsSync(filePath)) {
      if (serveOriginal) {
        // Fall back to active thumbnail if original file missing on disk
        filePath = path.join(IMAGE_CACHE_DIR, record.fileName);
        if (!fs.existsSync(filePath)) {
          record.status = 'no_image';
          delete record.fileName;
          this._saveManifest();
          return null;
        }
      } else {
        record.status = 'no_image';
        delete record.fileName;
        this._saveManifest();
        return null;
      }
    }

    return { ...record, filePath };
  }

  /**
   * Discovers connected physical devices across ADB, iOS, and Agent subsystems
   */
  async discoverConnectedDevices(user = null) {
    let adbService, iosService, agentService;
    try { adbService = require('./adbService'); } catch (_) {}
    try { iosService = require('./iosService'); } catch (_) {}
    try { agentService = require('./agentService'); } catch (_) {}

    const [rawAndroid, rawIos] = await Promise.all([
      (adbService && typeof adbService.listDevices === 'function')
        ? adbService.listDevices().catch((err) => {
            logger.debug(`[DeviceImageService] ADB discovery: ${err.message}`);
            return [];
          })
        : Promise.resolve([]),
      (iosService && typeof iosService.listDevices === 'function')
        ? iosService.listDevices().catch((err) => {
            logger.debug(`[DeviceImageService] iOS discovery: ${err.message}`);
            return [];
          })
        : Promise.resolve([])
    ]);

    let agentDevices = [];
    try {
      if (agentService && typeof agentService.listAgentDevices === 'function') {
        agentDevices = agentService.listAgentDevices(user) || [];
      }
    } catch (_) {}

    const all = [...(rawAndroid || []), ...(rawIos || []), ...(agentDevices || [])];

    // Filter connected
    return all.filter(d => {
      if (!d) return false;
      const isConnected = d.connected === true || d.state === 'device' || d.platform === 'ios';
      if (!isConnected) return false;
      const serial = d.id || d.serial || '';
      if (serial.includes('_adb-tls-pairing') || (serial.startsWith('adb-') && serial.includes('._'))) {
        return false;
      }
      return true;
    });
  }

  /**
   * Lists device models merging catalog entries with currently connected devices.
   */
  async listDeviceModels(query = {}, user = null) {
    this._loadManifest();
    const connectedDevices = await this.discoverConnectedDevices(user);

    // Group connected devices by normalized key
    const connectedByKey = new Map(); // key -> [devices]
    for (const d of connectedDevices) {
      const norm = this.normalizeDeviceIdentity(d);
      if (!norm.sMfg || !norm.sModel) continue;
      const key = `${norm.sMfg}:${norm.sModel}`;
      if (!connectedByKey.has(key)) {
        connectedByKey.set(key, []);
      }
      connectedByKey.get(key).push({
        id: d.id || d.serial,
        serial: d.serial || d.id,
        platform: d.platform || (norm.isIos ? 'ios' : 'android'),
        displayName: d.displayName || norm.displayName
      });
    }

    // Merge manifest records and connected models
    const modelMap = new Map(); // key -> modelEntry

    // 1. Process all manifest models
    for (const [key, record] of Object.entries(this.manifest)) {
      const hasImage = Boolean(record.status === 'cached' && record.fileName);
      const isConnected = connectedByKey.has(key);
      const connList = connectedByKey.get(key) || [];

      modelMap.set(key, {
        manufacturer: record.manufacturer,
        model: record.model,
        displayName: record.displayName || `${record.manufacturer.toUpperCase()} ${record.model.toUpperCase()}`,
        hasImage,
        thumbnailUrl: hasImage ? `/api/devices/image/${record.manufacturer}/${record.model}` : null,
        fileName: record.fileName || null,
        fileSize: record.fileSize || null,
        mimeType: record.mimeType || null,
        width: record.width || null,
        height: record.height || null,
        eTag: record.eTag || null,
        isTrimmed: Boolean(record.isTrimmed),
        hasOriginal: Boolean(record.originalFileName),
        originalFileName: record.originalFileName || null,
        originalWidth: record.originalWidth || null,
        originalHeight: record.originalHeight || null,
        originalFileSize: record.originalFileSize || null,
        originalUrl: record.originalFileName ? `/api/devices/image/${record.manufacturer}/${record.model}?original=true` : null,
        updatedAt: record.updatedAt || null,
        updatedBy: record.updatedBy || null,
        isConnected,
        connectedCount: connList.length,
        connectedDevices: connList,
        isCatalogRegistered: true
      });
    }

    // 2. Add connected devices not yet in manifest
    for (const [key, connList] of connectedByKey.entries()) {
      if (!modelMap.has(key)) {
        const [sMfg, sModel] = key.split(':');
        const first = connList[0];
        modelMap.set(key, {
          manufacturer: sMfg,
          model: sModel,
          displayName: first.displayName || `${sMfg.toUpperCase()} ${sModel.toUpperCase()}`,
          hasImage: false,
          thumbnailUrl: null,
          fileName: null,
          fileSize: null,
          mimeType: null,
          width: null,
          height: null,
          eTag: null,
          isTrimmed: false,
          hasOriginal: false,
          originalFileName: null,
          originalWidth: null,
          originalHeight: null,
          originalFileSize: null,
          originalUrl: null,
          updatedAt: null,
          updatedBy: null,
          isConnected: true,
          connectedCount: connList.length,
          connectedDevices: connList,
          isCatalogRegistered: false
        });
      }
    }

    let list = Array.from(modelMap.values());

    // Search filter
    const searchTerm = (query.search || '').trim().toLowerCase();
    if (searchTerm) {
      list = list.filter(m =>
        m.displayName.toLowerCase().includes(searchTerm) ||
        m.manufacturer.toLowerCase().includes(searchTerm) ||
        m.model.toLowerCase().includes(searchTerm)
      );
    }

    // Status filter
    const filterStatus = (query.filter || 'all').toLowerCase();
    if (filterStatus === 'has_image') {
      list = list.filter(m => m.hasImage);
    } else if (filterStatus === 'missing_image') {
      list = list.filter(m => !m.hasImage);
    } else if (filterStatus === 'connected') {
      list = list.filter(m => m.isConnected);
    }

    // Sort: Connected models first, then alphabetically by display name
    list.sort((a, b) => {
      if (a.isConnected && !b.isConnected) return -1;
      if (!a.isConnected && b.isConnected) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    const totalModels = modelMap.size;
    let withImages = 0;
    let missingImages = 0;
    let connectedCount = 0;

    for (const m of modelMap.values()) {
      if (m.hasImage) withImages++;
      else missingImages++;
      if (m.isConnected) connectedCount++;
    }

    return {
      models: list,
      summary: {
        totalModels,
        withImages,
        missingImages,
        connectedCount
      }
    };
  }
}

const deviceImageService = new DeviceImageService();
module.exports = deviceImageService;
