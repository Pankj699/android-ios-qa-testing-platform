const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { spawnSync } = require('child_process');
const config = require('../config');
const logger = require('../utils/logger');
const { formatBytes } = require('../utils/fileUtils');

class AabAnalyzerService {
  /**
   * Analyze an uploaded .aab or .apk file and extract full metadata, package info and asset packs
   */
  async analyzeAab(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Build file not found at path: ${filePath}`);
    }

    const isApk = filePath.toLowerCase().endsWith('.apk');

    try {
      const stats = fs.statSync(filePath);
      const zip = new AdmZip(filePath);
      const zipEntries = zip.getEntries();

      let packageName = '';
      let versionCode = '';
      let versionName = '';
      let minSdkVersion = '';
      let targetSdkVersion = '';
      let appName = '';

      if (isApk) {
        // APK Analysis via Binary XML
        for (const entry of zipEntries) {
          if (entry.entryName === 'AndroidManifest.xml') {
            const parsed = this.parseBinaryXmlManifest(entry.getData()) || this.parseBinaryOrProtoManifest(entry.getData());
            if (parsed.packageName) packageName = parsed.packageName;
            if (parsed.versionCode) versionCode = parsed.versionCode;
            if (parsed.versionName) versionName = parsed.versionName;
            if (parsed.minSdkVersion) minSdkVersion = parsed.minSdkVersion;
            if (parsed.targetSdkVersion) targetSdkVersion = parsed.targetSdkVersion;
            break;
          }
        }

        if (!packageName || packageName.includes('schemas.android.com')) {
          packageName = this.extractFallbackPackageName(zipEntries) || 'com.example.app';
        }

        const pkgParts = (packageName || '').split('.');
        const lastPart = pkgParts[pkgParts.length - 1] || 'App';
        appName = lastPart
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, str => str.toUpperCase())
          .trim();

        return {
          fileName: path.basename(filePath),
          filePath,
          fileSize: stats.size,
          formattedFileSize: formatBytes(stats.size),
          fileType: 'apk',
          applicationName: appName,
          packageName: packageName || 'com.example.app',
          versionName: versionName || '1.0.0',
          versionCode: versionCode || '1',
          minSdkVersion: minSdkVersion || '24',
          targetSdkVersion: targetSdkVersion || '34',
          assetPacks: [],
          modulesCount: 1,
          analyzedAt: new Date().toISOString()
        };
      }

      // 1. Try bundletool dump manifest for 100% accurate AndroidManifest extraction if available
      const btManifest = this.dumpManifestWithBundletool(filePath);
      if (btManifest) {
        const parsed = this.parseXmlManifest(btManifest);
        if (parsed.packageName) packageName = parsed.packageName;
        if (parsed.versionCode) versionCode = parsed.versionCode;
        if (parsed.versionName) versionName = parsed.versionName;
        if (parsed.minSdkVersion) minSdkVersion = parsed.minSdkVersion;
        if (parsed.targetSdkVersion) targetSdkVersion = parsed.targetSdkVersion;
      }

      // Map of module folders and asset files
      const modules = new Map();
      const nonModuleNames = new Set(['BundleConfig.pb', 'BUNDLE-METADATA', 'META-INF']);

      for (const entry of zipEntries) {
        const entryName = entry.entryName.replace(/\\/g, '/');
        const parts = entryName.split('/');
        const topModule = parts[0];

        // Skip root files like BundleConfig.pb and metadata
        if (nonModuleNames.has(topModule) || !topModule) continue;

        if (!modules.has(topModule)) {
          modules.set(topModule, {
            name: topModule,
            isBase: topModule === 'base',
            filesCount: 0,
            totalSize: 0,
            hasAssets: false,
            deliveryType: null
          });
        }

        const modInfo = modules.get(topModule);
        if (!entry.isDirectory) {
          modInfo.filesCount++;
          modInfo.totalSize += entry.header.size;
          if (parts[1] === 'assets') {
            modInfo.hasAssets = true;
          }
        }

        // Submodule manifest delivery detection
        if (topModule !== 'base' && (parts[1] === 'manifest' || parts[1] === 'AndroidManifest.xml')) {
          const raw = entry.getData().toString('utf8');
          if (raw.includes('fast-follow') || raw.includes('fast_follow')) {
            modInfo.deliveryType = 'fast-follow';
          } else if (raw.includes('install-time') || raw.includes('install_time')) {
            modInfo.deliveryType = 'install-time';
          } else if (raw.includes('on-demand') || raw.includes('on_demand')) {
            modInfo.deliveryType = 'on-demand';
          }
        }

        // Fallback parse if bundletool wasn't used
        if (!packageName && (entryName === 'base/manifest/AndroidManifest.xml' || entryName === 'base/AndroidManifest.xml')) {
          const content = entry.getData();
          const fallback = this.parseBinaryOrProtoManifest(content);
          if (!packageName && fallback.packageName) packageName = fallback.packageName;
          if (!versionCode && fallback.versionCode) versionCode = fallback.versionCode;
          if (!versionName && fallback.versionName) versionName = fallback.versionName;
          if (!minSdkVersion && fallback.minSdkVersion) minSdkVersion = fallback.minSdkVersion;
          if (!targetSdkVersion && fallback.targetSdkVersion) targetSdkVersion = fallback.targetSdkVersion;
        }
      }

      // Build Asset Packs array (excluding base)
      const assetPacks = [];
      for (const [modName, modInfo] of modules.entries()) {
        if (modName === 'base') continue;

        let deliveryType = modInfo.deliveryType;
        if (!deliveryType) {
          const lower = modName.toLowerCase();
          if (lower.includes('fastfollow') || lower.includes('fast_follow') || lower.includes('main')) {
            deliveryType = 'fast-follow';
          } else if (lower.includes('installtime') || lower.includes('install_time') || lower.includes('initial')) {
            deliveryType = 'install-time';
          } else {
            deliveryType = 'on-demand';
          }
        }

        assetPacks.push({
          name: modName,
          deliveryType,
          size: modInfo.totalSize,
          formattedSize: formatBytes(modInfo.totalSize),
          filesCount: modInfo.filesCount,
          status: 'Detected'
        });
      }

      // Fallback package extraction
      if (!packageName || packageName.includes('schemas.android.com')) {
        packageName = this.extractFallbackPackageName(zipEntries) || 'com.example.app';
      }
      if (!versionCode) versionCode = '1';
      if (!versionName) versionName = '1.0.0';
      if (!minSdkVersion) minSdkVersion = '24';
      if (!targetSdkVersion) targetSdkVersion = '34';

      // Application Name derivation
      if (!appName || appName.startsWith('@')) {
        const pkgParts = packageName.split('.');
        const lastPart = pkgParts[pkgParts.length - 1] || 'App';
        appName = lastPart
          .replace(/([A-Z])/g, ' $1')
          .replace(/^./, str => str.toUpperCase())
          .trim();
      }

      return {
        fileName: path.basename(filePath),
        filePath,
        fileSize: stats.size,
        formattedFileSize: formatBytes(stats.size),
        applicationName: appName,
        packageName,
        versionName,
        versionCode,
        minSdkVersion,
        targetSdkVersion,
        assetPacks,
        modulesCount: modules.size,
        analyzedAt: new Date().toISOString()
      };
    } catch (err) {
      logger.error(`Error analyzing AAB: ${err.message}`);
      throw new Error(`Failed to parse AAB structure: ${err.message}`);
    }
  }

  /**
   * Run bundletool dump manifest to get XML string
   */
  dumpManifestWithBundletool(aabPath) {
    try {
      const bundletoolJar = config.BUNDLETOOL_PATH;
      if (!fs.existsSync(bundletoolJar)) return null;

      const res = spawnSync(config.JAVA_PATH, ['-jar', bundletoolJar, 'dump', 'manifest', `--bundle=${aabPath}`], {
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true
      });

      if (res.status === 0 && res.stdout) {
        return res.stdout;
      }
    } catch (e) {
      logger.debug(`Bundletool dump manifest failed: ${e.message}`);
    }
    return null;
  }

  /**
   * Parse XML manifest string
   */
  parseXmlManifest(xmlText) {
    const res = {};
    const pkgMatch = xmlText.match(/package\s*=\s*["']([^"']+)["']/i);
    if (pkgMatch && !pkgMatch[1].includes('schemas.android.com')) {
      res.packageName = pkgMatch[1];
    }

    const vNameMatch = xmlText.match(/android:versionName\s*=\s*["']([^"']+)["']/i);
    if (vNameMatch) res.versionName = vNameMatch[1];

    const vCodeMatch = xmlText.match(/android:versionCode\s*=\s*["']([^"']+)["']/i);
    if (vCodeMatch) res.versionCode = vCodeMatch[1];

    const minSdkMatch = xmlText.match(/android:minSdkVersion\s*=\s*["']([^"']+)["']/i);
    if (minSdkMatch) res.minSdkVersion = minSdkMatch[1];

    const targetSdkMatch = xmlText.match(/android:targetSdkVersion\s*=\s*["']([^"']+)["']/i);
    if (targetSdkMatch) res.targetSdkVersion = targetSdkMatch[1];

    return res;
  }

  /**
   * High-accuracy binary XML (AXML) parser for Android APK AndroidManifest.xml
   */
  parseBinaryXmlManifest(buf) {
    if (!buf || buf.length < 8) return null;
    const magic = buf.readUInt32LE(0);
    // RES_XML_TYPE = 0x00080003
    if ((magic & 0xFFFF) !== 0x0003) return null;

    try {
      let offset = 8;
      const strings = [];
      const parsed = {};

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
            } catch (e) {
              strings.push('');
            }
          }
        } else if (chunkType === 0x0102) { // RES_XML_START_ELEMENT_TYPE
          const tagNameIdx = buf.readInt32LE(offset + 20);
          const tagName = strings[tagNameIdx];
          const attrSize = buf.readUInt16LE(offset + 26) || 20;
          const attrCount = buf.readUInt16LE(offset + 28);
          const attrStartActual = offset + 36;

          const attrs = {};
          for (let a = 0; a < attrCount; a++) {
            const ap = attrStartActual + a * attrSize;
            if (ap + 20 > buf.length) break;
            const nameIdx = buf.readInt32LE(ap + 4);
            const valStrIdx = buf.readInt32LE(ap + 8);
            const data = buf.readUInt32LE(ap + 16);
            const name = strings[nameIdx] || ('attr_' + nameIdx);
            let val = valStrIdx >= 0 && strings[valStrIdx] !== undefined ? strings[valStrIdx] : String(data);
            attrs[name] = val;
          }

          if (tagName === 'manifest') {
            if (attrs.package) parsed.packageName = attrs.package;
            if (attrs.versionCode) parsed.versionCode = attrs.versionCode;
            if (attrs.versionName) parsed.versionName = attrs.versionName;
          } else if (tagName === 'uses-sdk') {
            if (attrs.minSdkVersion) parsed.minSdkVersion = attrs.minSdkVersion;
            if (attrs.targetSdkVersion) parsed.targetSdkVersion = attrs.targetSdkVersion;
          }
        }

        offset += chunkSize;
      }

      return parsed.packageName ? parsed : null;
    } catch (err) {
      logger.debug(`parseBinaryXmlManifest failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Parse Android Proto XML / Binary XML in AAB to extract attributes safely
   */
  parseBinaryOrProtoManifest(buffer) {
    const result = {};
    const text = buffer.toString('utf8');

    // Extract package name via regex over string pools, strictly excluding XML namespaces
    const allMatches = text.match(/([a-zA-Z0-9_]{2,}\.[a-zA-Z0-9_]{2,}(?:\.[a-zA-Z0-9_]+)+)/g) || [];
    for (const m of allMatches) {
      if (!m.includes('schemas.android.com') && !m.includes('android.com') && !m.includes('w3.org') && !m.includes('google.protobuf')) {
        result.packageName = m;
        break;
      }
    }

    const vNameMatch = text.match(/versionName["']?\s*[:=]\s*["']?([0-9a-zA-Z._-]+)/i)
      || text.match(/(\d+\.\d+\.[\d\w.-]+)/);
    if (vNameMatch) {
      result.versionName = vNameMatch[1];
    }

    const vCodeMatch = text.match(/versionCode["']?\s*[:=]\s*["']?(\d+)/i);
    if (vCodeMatch) {
      result.versionCode = vCodeMatch[1];
    }

    const targetSdkMatch = text.match(/targetSdkVersion["']?\s*[:=]\s*["']?(\d+)/i);
    if (targetSdkMatch) {
      result.targetSdkVersion = targetSdkMatch[1];
    }

    const minSdkMatch = text.match(/minSdkVersion["']?\s*[:=]\s*["']?(\d+)/i);
    if (minSdkMatch) {
      result.minSdkVersion = minSdkMatch[1];
    }

    return result;
  }

  /**
   * Fallback extractor for package name
   */
  extractFallbackPackageName(zipEntries) {
    for (const entry of zipEntries) {
      if (entry.entryName.startsWith('base/dex/') || entry.entryName.includes('classes.dex')) {
        const data = entry.getData().toString('binary', 0, 8192);
        const match = data.match(/L([a-zA-Z0-9_]+(?:\/[a-zA-Z0-9_]+){2,});/);
        if (match && !match[1].includes('android/support') && !match[1].includes('androidx/')) {
          return match[1].replace(/\//g, '.');
        }
      }
    }
    return null;
  }
}

module.exports = new AabAnalyzerService();
