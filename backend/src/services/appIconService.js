const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const config = require('../config');
const logger = require('../utils/logger');

// Density order for selecting best quality icon
const DENSITY_SCORES = {
  640: 600, // xxxhdpi
  480: 500, // xxhdpi
  320: 400, // xhdpi
  240: 300, // hdpi
  160: 200, // mdpi
  120: 100, // ldpi
  65534: 50 // anydpi
};

class AppIconService {
  constructor() {
    this.iconDir = path.join(config.DATA_DIR, 'icons');
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.iconDir)) {
        fs.mkdirSync(this.iconDir, { recursive: true });
      }
    } catch (e) {
      logger.error(`[AppIconService] Failed to create icon directory: ${e.message}`);
    }
  }

  /**
   * Check if a cached icon exists for a given buildId.
   * Returns { filePath, mimeType } or null.
   */
  getCachedIcon(buildId) {
    if (!buildId) return null;
    const extensions = ['png', 'webp', 'jpg', 'jpeg'];
    for (const ext of extensions) {
      const candidate = path.join(this.iconDir, `${buildId}.${ext}`);
      if (fs.existsSync(candidate)) {
        const mimeType = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
        return { filePath: candidate, mimeType, ext };
      }
    }
    return null;
  }

  /**
   * Helper to parse ARSC String Pool
   */
  _parseStringPool(buf, off) {
    if (off + 28 > buf.length) return { strings: [], chunkSize: 0 };
    const chunkSize = buf.readUInt32LE(off + 4);
    const count = buf.readUInt32LE(off + 8);
    const flags = buf.readUInt32LE(off + 16);
    const isUtf8 = (flags & (1 << 8)) !== 0;
    const start = off + buf.readUInt32LE(off + 20);

    const offsets = [];
    for (let i = 0; i < count; i++) {
      if (off + 28 + i * 4 + 4 > buf.length) break;
      offsets.push(buf.readUInt32LE(off + 28 + i * 4));
    }

    const strings = [];
    for (let i = 0; i < offsets.length; i++) {
      const p = start + offsets[i];
      if (p >= buf.length) {
        strings.push('');
        continue;
      }
      try {
        if (isUtf8) {
          let ptr = p;
          let cLen = buf[ptr++];
          if (cLen & 0x80) cLen = ((cLen & 0x7F) << 8) | buf[ptr++];
          let bLen = buf[ptr++];
          if (bLen & 0x80) bLen = ((bLen & 0x7F) << 8) | buf[ptr++];
          strings.push(buf.toString('utf8', ptr, Math.min(buf.length, ptr + bLen)));
        } else {
          let ptr = p;
          let len = buf.readUInt16LE(ptr);
          ptr += 2;
          if (len & 0x8000) {
            len = ((len & 0x7FFF) << 16) | buf.readUInt16LE(ptr);
            ptr += 2;
          }
          strings.push(buf.toString('utf16le', ptr, Math.min(buf.length, ptr + len * 2)));
        }
      } catch {
        strings.push('');
      }
    }
    return { strings, chunkSize };
  }

  /**
   * Extract icon resource ID from APK's binary AndroidManifest.xml
   */
  _getIconResIdFromApkManifest(buf) {
    if (!buf || buf.length < 8) return null;
    const magic = buf.readUInt32LE(0);
    if ((magic & 0xFFFF) !== 0x0003) return null; // RES_XML_TYPE

    try {
      let offset = 8;
      const strings = [];

      while (offset < buf.length) {
        if (offset + 8 > buf.length) break;
        const chunkType = buf.readUInt16LE(offset);
        const chunkSize = buf.readUInt32LE(offset + 4);

        if (chunkSize <= 0 || offset + chunkSize > buf.length + 4) break;

        if (chunkType === 0x0001) { // RES_STRING_POOL_TYPE
          const stringCount = buf.readUInt32LE(offset + 8);
          const flags = buf.readUInt32LE(offset + 16);
          const isUtf8 = (flags & (1 << 8)) !== 0;
          const stringsStart = offset + buf.readUInt32LE(offset + 20);

          const stringOffsets = [];
          for (let i = 0; i < stringCount; i++) {
            if (offset + 28 + i * 4 + 4 <= buf.length) {
              stringOffsets.push(buf.readUInt32LE(offset + 28 + i * 4));
            }
          }

          for (let i = 0; i < stringCount; i++) {
            const strOffset = stringsStart + stringOffsets[i];
            if (strOffset >= buf.length) {
              strings.push('');
              continue;
            }

            try {
              if (isUtf8) {
                let p = strOffset;
                let charLen = buf[p++];
                if (charLen & 0x80) charLen = ((charLen & 0x7F) << 8) | buf[p++];
                let byteLen = buf[p++];
                if (byteLen & 0x80) byteLen = ((byteLen & 0x7F) << 8) | buf[p++];
                strings.push(buf.toString('utf8', p, Math.min(buf.length, p + byteLen)));
              } else {
                let p = strOffset;
                let len = buf.readUInt16LE(p);
                p += 2;
                if (len & 0x8000) {
                  len = ((len & 0x7FFF) << 16) | buf.readUInt16LE(p);
                  p += 2;
                }
                strings.push(buf.toString('utf16le', p, Math.min(buf.length, p + len * 2)));
              }
            } catch {
              strings.push('');
            }
          }
        } else if (chunkType === 0x0102) { // RES_XML_START_ELEMENT_TYPE
          const tagNameIdx = buf.readInt32LE(offset + 20);
          const tagName = strings[tagNameIdx];

          if (tagName === 'application') {
            const attrSize = buf.readUInt16LE(offset + 26) || 20;
            const attrCount = buf.readUInt16LE(offset + 28);
            const attrStartActual = offset + 36;

            let roundIconResId = null;

            for (let a = 0; a < attrCount; a++) {
              const ap = attrStartActual + a * attrSize;
              if (ap + 20 > buf.length) break;
              const nameIdx = buf.readInt32LE(ap + 4);
              const name = strings[nameIdx];
              const valType = buf.readUInt8(ap + 15);
              const valData = buf.readUInt32LE(ap + 16);

              if (name === 'icon' && (valType === 1 || valType === 2)) {
                return valData;
              }
              if (name === 'roundIcon' && (valType === 1 || valType === 2)) {
                roundIconResId = valData;
              }
            }

            if (roundIconResId) return roundIconResId;
          }
        }

        offset += chunkSize;
      }
    } catch (e) {
      logger.warn(`[AppIconService] Manifest parsing error: ${e.message}`);
    }
    return null;
  }

  /**
   * Resolve resource ID from resources.arsc to file path candidates
   */
  _resolveResIdInArsc(arscBuf, resId) {
    const candidates = [];
    try {
      if (!arscBuf || arscBuf.length < 12) return candidates;
      const globalPool = this._parseStringPool(arscBuf, 12);
      let pkgOff = 12 + globalPool.chunkSize;

      const targetTypeId = (resId >> 16) & 0xff;
      const targetEntryIdx = resId & 0xffff;

      while (pkgOff + 8 <= arscBuf.length) {
        const pType = arscBuf.readUInt16LE(pkgOff);
        const pSize = arscBuf.readUInt32LE(pkgOff + 4);
        if (pSize <= 0) break;

        if (pType === 0x0200) {
          // RES_TABLE_PACKAGE_TYPE
          const pHeaderSize = arscBuf.readUInt16LE(pkgOff + 2);
          let sOff = pkgOff + pHeaderSize;
          while (sOff < pkgOff + pSize && sOff + 8 <= arscBuf.length) {
            const sType = arscBuf.readUInt16LE(sOff);
            const sHeader = arscBuf.readUInt16LE(sOff + 2);
            const sSize = arscBuf.readUInt32LE(sOff + 4);
            if (sSize <= 0) break;

            if (sType === 0x0201) {
              // RES_TABLE_TYPE_TYPE
              const typeId = arscBuf.readUInt8(sOff + 8);
              if (typeId === targetTypeId) {
                // In ResTable_config, density is at offset 34
                const density = arscBuf.readUInt16LE(sOff + 34);
                const entriesStart = sOff + arscBuf.readUInt32LE(sOff + 16);
                const offsetTable = sOff + sHeader;
                const entryTablePos = offsetTable + targetEntryIdx * 4;

                if (entryTablePos + 4 <= entriesStart && entryTablePos >= offsetTable) {
                  const entryOffset = arscBuf.readInt32LE(entryTablePos);
                  if (entryOffset !== -1) {
                    const entryActual = entriesStart + entryOffset;
                    if (entryActual + 16 <= arscBuf.length) {
                      const valType = arscBuf.readUInt8(entryActual + 11);
                      const valData = arscBuf.readUInt32LE(entryActual + 12);
                      if (valType === 3 && globalPool.strings[valData]) {
                        const filePath = globalPool.strings[valData];
                        candidates.push({ filePath, density });
                      }
                    }
                  }
                }
              }
            }
            sOff += sSize;
          }
        }
        pkgOff += pSize;
      }
    } catch (e) {
      logger.warn(`[AppIconService] ARSC resolution error: ${e.message}`);
    }
    return candidates;
  }

  /**
   * Parse an adaptive-icon binary XML to find the foreground drawable resource ID
   */
  _getAdaptiveIconForegroundResId(xmlBuf) {
    if (!xmlBuf || xmlBuf.length < 8) return null;
    const magic = xmlBuf.readUInt32LE(0);
    if ((magic & 0xFFFF) !== 0x0003) return null;

    try {
      const stringPool = this._parseStringPool(xmlBuf, 8);
      let offset = 8 + stringPool.chunkSize;

      while (offset < xmlBuf.length) {
        if (offset + 8 > xmlBuf.length) break;
        const chunkType = xmlBuf.readUInt16LE(offset);
        const chunkSize = xmlBuf.readUInt32LE(offset + 4);
        if (chunkSize <= 0) break;

        if (chunkType === 0x0102) { // RES_XML_START_ELEMENT_TYPE
          const tagNameIdx = xmlBuf.readInt32LE(offset + 20);
          const tagName = stringPool.strings[tagNameIdx];

          if (tagName === 'foreground' || tagName === 'background') {
            const attrSize = xmlBuf.readUInt16LE(offset + 26) || 20;
            const attrCount = xmlBuf.readUInt16LE(offset + 28);
            const attrStart = offset + 36;

            for (let a = 0; a < attrCount; a++) {
              const ap = attrStart + a * attrSize;
              if (ap + 20 > xmlBuf.length) break;
              const nameIdx = xmlBuf.readInt32LE(ap + 4);
              const name = stringPool.strings[nameIdx];
              const valType = xmlBuf.readUInt8(ap + 15);
              const data = xmlBuf.readUInt32LE(ap + 16);

              if (name === 'drawable' && (valType === 1 || valType === 2)) {
                if (tagName === 'foreground') return data;
              }
            }
          }
        }
        offset += chunkSize;
      }
    } catch (e) {
      logger.warn(`[AppIconService] Adaptive XML parsing error: ${e.message}`);
    }
    return null;
  }

  /**
   * Determine image mime type from header magic bytes
   */
  _detectMimeType(buf) {
    if (!buf || buf.length < 8) return null;
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) {
      return { mimeType: 'image/png', ext: 'png' };
    }
    // WebP: RIFF ... WEBP
    if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
        buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) {
      return { mimeType: 'image/webp', ext: 'webp' };
    }
    // JPEG: FF D8 FF
    if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) {
      return { mimeType: 'image/jpeg', ext: 'jpg' };
    }
    return null;
  }

  /**
   * Score an entry path for likelihood of being the primary app launcher icon
   */
  _scoreIconPath(entryPath) {
    const normalized = entryPath.replace(/\\/g, '/').toLowerCase();
    // Launcher icons are strictly located in Android resource directories (res/ in APK, base/res/ in AAB)
    if (!normalized.startsWith('res/') && !normalized.startsWith('base/res/')) {
      return -100;
    }

    if (normalized.endsWith('.xml')) return -100; // XML adaptive definition
    if (!normalized.endsWith('.png') && !normalized.endsWith('.webp') && !normalized.endsWith('.jpg') && !normalized.endsWith('.jpeg')) {
      return -100;
    }

    let score = 0;
    const baseName = path.basename(normalized);

    // Filter out common non-launcher UI icons
    if (normalized.includes('notification') || normalized.includes('badge') ||
        normalized.includes('action_bar') || normalized.includes('status_bar') ||
        normalized.includes('btn_') || normalized.includes('dialog_')) {
      return -50;
    }

    if (baseName.startsWith('ic_launcher.')) score += 300;
    else if (baseName.startsWith('ic_launcher_round.')) score += 250;
    else if (baseName.includes('ic_launcher')) score += 200;
    else if (baseName.startsWith('app_icon')) score += 180;
    else if (baseName.includes('launcher')) score += 150;
    else if (baseName.includes('icon')) score += 80;

    // Density bonuses
    if (normalized.includes('xxxhdpi')) score += 60;
    else if (normalized.includes('xxhdpi')) score += 50;
    else if (normalized.includes('xhdpi')) score += 40;
    else if (normalized.includes('hdpi')) score += 30;
    else if (normalized.includes('mdpi')) score += 20;

    // Favor mipmap over drawable for launcher icons
    if (normalized.includes('mipmap')) score += 25;

    return score;
  }

  /**
   * Main entry point: Extracts icon from an APK or AAB file and caches it.
   * Returns metadata object or null.
   */
  async extractAndCacheIcon(buildId, filePath) {
    if (!buildId || !filePath || !fs.existsSync(filePath)) {
      return null;
    }

    // Check if already cached
    const existing = this.getCachedIcon(buildId);
    if (existing) {
      return {
        success: true,
        buildId,
        filePath: existing.filePath,
        mimeType: existing.mimeType,
        iconUrl: `/api/build/${buildId}/icon`
      };
    }

    try {
      const zip = new AdmZip(filePath);
      let iconBuffer = null;
      let matchedPath = null;

      // 1. If APK, try binary Manifest + ARSC resolution
      const manifestEntry = zip.getEntry('AndroidManifest.xml');
      const arscEntry = zip.getEntry('resources.arsc');

      if (manifestEntry && arscEntry) {
        const manifestBuf = manifestEntry.getData();
        const iconResId = this._getIconResIdFromApkManifest(manifestBuf);

        if (iconResId) {
          const arscBuf = arscEntry.getData();
          let candidates = this._resolveResIdInArsc(arscBuf, iconResId);

          // If candidates contain XML (adaptive icon), inspect the XML for foreground drawable
          const xmlCandidate = candidates.find(c => c.filePath.toLowerCase().endsWith('.xml'));
          if (xmlCandidate) {
            const xmlEntry = zip.getEntry(xmlCandidate.filePath);
            if (xmlEntry) {
              const fgResId = this._getAdaptiveIconForegroundResId(xmlEntry.getData());
              if (fgResId) {
                const fgCandidates = this._resolveResIdInArsc(arscBuf, fgResId);
                if (fgCandidates.length > 0) {
                  candidates = candidates.concat(fgCandidates);
                }
              }
            }
          }

          // Filter candidates that are raster images and exist in the zip
          const rasterCandidates = candidates
            .filter(c => !c.filePath.toLowerCase().endsWith('.xml'))
            .map(c => {
              const densityScore = DENSITY_SCORES[c.density] || c.density || 0;
              return { ...c, score: densityScore };
            })
            .sort((a, b) => b.score - a.score);

          for (const cand of rasterCandidates) {
            const entry = zip.getEntry(cand.filePath);
            if (entry) {
              const data = entry.getData();
              const mime = this._detectMimeType(data);
              if (mime) {
                iconBuffer = data;
                matchedPath = cand.filePath;
                break;
              }
            }
          }
        }
      }

      // 2. If AAB or Manifest/ARSC did not yield a raster image, perform heuristic search
      if (!iconBuffer) {
        const entries = zip.getEntries();
        const scoredEntries = [];

        for (const entry of entries) {
          const score = this._scoreIconPath(entry.entryName);
          if (score > 0) {
            scoredEntries.push({ entry, score });
          }
        }

        scoredEntries.sort((a, b) => b.score - a.score);

        for (const item of scoredEntries) {
          const data = item.entry.getData();
          const mime = this._detectMimeType(data);
          if (mime) {
            iconBuffer = data;
            matchedPath = item.entry.entryName;
            break;
          }
        }
      }

      if (!iconBuffer) {
        logger.info(`[AppIconService] No launcher icon found in ${path.basename(filePath)}`);
        return null;
      }

      const detected = this._detectMimeType(iconBuffer);
      const ext = detected ? detected.ext : 'png';
      const mimeType = detected ? detected.mimeType : 'image/png';
      const targetFilePath = path.join(this.iconDir, `${buildId}.${ext}`);

      fs.writeFileSync(targetFilePath, iconBuffer);
      logger.info(`[AppIconService] Successfully cached icon for build ${buildId} from ${matchedPath} (${iconBuffer.length} bytes, ${mimeType})`);

      return {
        success: true,
        buildId,
        filePath: targetFilePath,
        mimeType,
        iconUrl: `/api/build/${buildId}/icon`
      };
    } catch (e) {
      logger.error(`[AppIconService] Extraction failed for build ${buildId}: ${e.message}`);
      return null;
    }
  }

  /**
   * Delete cached icon when a build is deleted
   */
  deleteCachedIcon(buildId) {
    if (!buildId) return;
    const extensions = ['png', 'webp', 'jpg', 'jpeg'];
    for (const ext of extensions) {
      const candidate = path.join(this.iconDir, `${buildId}.${ext}`);
      if (fs.existsSync(candidate)) {
        try {
          fs.unlinkSync(candidate);
        } catch (e) {
          logger.warn(`[AppIconService] Failed to delete cached icon: ${e.message}`);
        }
      }
    }
  }
}

module.exports = new AppIconService();
