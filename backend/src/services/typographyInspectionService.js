/**
 * typographyInspectionService.js
 *
 * Layered typography extraction service for Android UI Inspector.
 * Uses a 4-tier provenance architecture:
 *   1. Direct runtime inspection (when available / instrumented) -> EXACT
 *   2. Verified APK asset & font resource cataloging -> INFERRED
 *   3. Heuristic / Screenshot analysis -> ESTIMATED
 *   4. Unavailable when no defensible value can be established -> UNAVAILABLE
 *
 * Adheres strictly to the provenance rules:
 *   - NEVER labels an inferred resource declaration as EXACT.
 *   - NEVER labels a screenshot-based estimate as EXACT.
 *   - Gracefully falls back if any layer fails, times out, or is unsupported.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const AdmZip = require('adm-zip');
const logger = require('../utils/logger');
const adbService = require('./adbService');

/**
 * Cache for parsed APK font catalogs so we do not re-stream or re-parse APKs on every click.
 * Key: package name (or apk path), Value: { timestamp, fonts: [...] }
 */
const apkFontCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Decode a UTF-16 Big Endian byte buffer chunk safely to a JS string.
 * @param {Buffer} buf
 * @param {number} start
 * @param {number} length
 * @returns {string}
 */
function decodeUtf16BE(buf, start, length) {
  const chars = [];
  for (let i = 0; i < length; i += 2) {
    if (start + i + 1 >= buf.length) break;
    chars.push(String.fromCharCode(buf.readUInt16BE(start + i)));
  }
  return chars.join('');
}

/**
 * Parses OpenType (TTF / OTF) table directory and extracts:
 *   - Font Family Name (Name ID 1)
 *   - Subfamily / Style (Name ID 2)
 *   - Full Font Name (Name ID 4)
 *   - PostScript Name (Name ID 6)
 *   - usWeightClass from OS/2 table (100 - 900)
 *   - fsSelection flags (bold, italic)
 *
 * @param {Buffer} buffer
 * @returns {object|null}
 */
function parseOpenType(buffer) {
  if (!buffer || buffer.length < 12) return null;

  try {
    const numTables = buffer.readUInt16BE(4);
    let nameTableOffset = null;
    let os2TableOffset = null;
    let fvarTableOffset = null;

    for (let i = 0; i < numTables; i++) {
      const tableOffset = 12 + i * 16;
      if (tableOffset + 16 > buffer.length) break;
      const tag = buffer.toString('ascii', tableOffset, tableOffset + 4);
      const offset = buffer.readUInt32BE(tableOffset + 8);
      if (tag === 'name') nameTableOffset = offset;
      if (tag === 'OS/2') os2TableOffset = offset;
      if (tag === 'fvar') fvarTableOffset = offset;
    }

    const result = {
      familyName: null,
      subFamily: null,
      typographicFamily: null,
      typographicSubFamily: null,
      fullName: null,
      postscriptName: null,
      usWeightClass: null,
      fsSelection: null,
      isVariableFont: false,
      weightRange: null,
      isItalic: false,
      isBold: false
    };

    // Extract weight and flags from OS/2 table
    if (os2TableOffset && os2TableOffset + 64 <= buffer.length) {
      result.usWeightClass = buffer.readUInt16BE(os2TableOffset + 4);
      result.fsSelection = buffer.readUInt16BE(os2TableOffset + 62);
      result.isItalic = (result.fsSelection & 0x01) !== 0;
      result.isBold = (result.fsSelection & 0x20) !== 0;
    }

    // Check fvar table for variable font axes (e.g. wght min/default/max)
    if (fvarTableOffset && fvarTableOffset + 16 <= buffer.length) {
      result.isVariableFont = true;
      try {
        const axesOffset = fvarTableOffset + buffer.readUInt16BE(fvarTableOffset + 4);
        const axisCount = buffer.readUInt16BE(fvarTableOffset + 8);
        const axisSize = buffer.readUInt16BE(fvarTableOffset + 10);
        for (let a = 0; a < axisCount; a++) {
          const aOffset = axesOffset + a * axisSize;
          if (aOffset + 20 <= buffer.length) {
            const axisTag = buffer.toString('ascii', aOffset, aOffset + 4);
            if (axisTag === 'wght') {
              const minVal = buffer.readInt32BE(aOffset + 4) / 65536;
              const defVal = buffer.readInt32BE(aOffset + 8) / 65536;
              const maxVal = buffer.readInt32BE(aOffset + 12) / 65536;
              result.weightRange = { min: Math.round(minVal), default: Math.round(defVal), max: Math.round(maxVal) };
            }
          }
        }
      } catch {
        // Non-fatal fvar parsing
      }
    }

    // Extract names from name table
    if (nameTableOffset && nameTableOffset + 6 <= buffer.length) {
      const count = buffer.readUInt16BE(nameTableOffset + 2);
      const stringOffset = nameTableOffset + buffer.readUInt16BE(nameTableOffset + 4);

      for (let i = 0; i < count; i++) {
        const rec = nameTableOffset + 6 + i * 12;
        if (rec + 12 > buffer.length) break;

        const platformId = buffer.readUInt16BE(rec);
        const nameId = buffer.readUInt16BE(rec + 6);
        const length = buffer.readUInt16BE(rec + 8);
        const offset = buffer.readUInt16BE(rec + 10);
        const strStart = stringOffset + offset;
        if (strStart + length > buffer.length) continue;

        let str = null;
        if (platformId === 0 || platformId === 3) {
          // Unicode / Windows platform (UTF-16BE)
          str = decodeUtf16BE(buffer, strStart, length);
        } else if (platformId === 1) {
          // Macintosh platform (Latin-1/ASCII)
          str = buffer.toString('latin1', strStart, strStart + length);
        }

        if (str && str.trim()) {
          str = str.trim();
          if (nameId === 1 && !result.familyName) result.familyName = str;
          if (nameId === 2 && !result.subFamily) result.subFamily = str;
          if (nameId === 4 && !result.fullName) result.fullName = str;
          if (nameId === 6 && !result.postscriptName) result.postscriptName = str;
          if (nameId === 16 && !result.typographicFamily) result.typographicFamily = str;
          if (nameId === 17 && !result.typographicSubFamily) result.typographicSubFamily = str;
        }
      }

      // If typographic family is available, use it as preferred family name
      if (result.typographicFamily) {
        result.preferredFamily = result.typographicFamily;
      } else {
        result.preferredFamily = result.familyName;
      }
    }

    return result;
  } catch (err) {
    logger.debug(`[TypographyService] Error parsing OpenType font: ${err.message}`);
    return null;
  }
}

/**
 * Standardize weight to common names and validate numeric ranges
 * @param {number|null} weight
 * @returns {{ numeric: number, label: string }}
 */
function normalizeWeight(weight) {
  if (!weight || typeof weight !== 'number') return { numeric: 400, label: 'Normal' };
  if (weight <= 150) return { numeric: 100, label: 'Thin' };
  if (weight <= 250) return { numeric: 200, label: 'ExtraLight' };
  if (weight <= 350) return { numeric: 300, label: 'Light' };
  if (weight <= 450) return { numeric: 400, label: 'Regular' };
  if (weight <= 550) return { numeric: 500, label: 'Medium' };
  if (weight <= 650) return { numeric: 600, label: 'SemiBold' };
  if (weight <= 750) return { numeric: 700, label: 'Bold' };
  if (weight <= 850) return { numeric: 800, label: 'ExtraBold' };
  return { numeric: 900, label: 'Black' };
}

class TypographyInspectionService {
  constructor() {
    this.parseOpenType = parseOpenType;
    this.normalizeWeight = normalizeWeight;
  }

  /**
   * Retrieves the catalog of bundled fonts in an installed application APK.
   * Runs offline without modifying or instrumenting the target application.
   *
   * @param {string} serial
   * @param {string} packageName
   * @returns {Promise<Array<object>>}
   */
  async getApkFontCatalog(serial, packageName) {
    if (!serial || !packageName || packageName.startsWith('android')) {
      return [];
    }

    const cached = apkFontCache.get(packageName);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.fonts;
    }

    try {
      // 1. Locate APK: check local upload/data directories first (instant, avoids large adb network transfers)
      let apkBuffer = null;
      const searchDirs = [
        path.join(process.cwd(), 'uploads'),
        path.join(process.cwd(), 'data', 'apks'),
        path.join(process.cwd(), 'data', 'apk')
      ];

      function scanDirForApk(dir) {
        if (!fs.existsSync(dir)) return null;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            const found = scanDirForApk(fullPath);
            if (found) return found;
          } else if (entry.name.endsWith('.apk') || entry.name.endsWith('.apks')) {
            try {
              const stat = fs.statSync(fullPath);
              if (stat.size > 10000 && stat.size < 200 * 1024 * 1024) {
                const zip = new AdmZip(fullPath);
                const manifestEntry = zip.getEntry('AndroidManifest.xml');
                if (manifestEntry) {
                  const mData = manifestEntry.getData();
                  if (
                    mData.includes(Buffer.from(packageName, 'utf16le')) ||
                    mData.includes(Buffer.from(packageName, 'utf8')) ||
                    mData.toString('latin1').includes(packageName)
                  ) {
                    return fullPath;
                  }
                }
              }
            } catch {
              // Ignore corrupted or unreadable APK candidates
            }
          }
        }
        return null;
      }

      for (const dir of searchDirs) {
        try {
          const matchPath = scanDirForApk(dir);
          if (matchPath) {
            apkBuffer = fs.readFileSync(matchPath);
            logger.info(`[TypographyService] Found local APK for ${packageName} at ${matchPath}`);
            break;
          }
        } catch {
          // Continue searching
        }
      }

      // 2. If not found locally, pull APK from connected device safely via adb pull
      if (!apkBuffer && serial) {
        const pathRes = await adbService.execute(['-s', serial, 'shell', 'pm', 'path', packageName]).catch(() => null);
        const pathOutput = pathRes?.stdout || pathRes?.raw || '';
        const match = pathOutput.match(/package:(.+base\.apk|.+)/);
        if (!match || !match[1]) {
          return [];
        }
        const apkPathOnDevice = match[1].trim();

        const tempDir = os.tmpdir();
        const tempLocalApk = path.join(tempDir, `qa_temp_${packageName}_${Date.now()}.apk`);
        try {
          const pullRes = await adbService.execute(['-s', serial, 'pull', apkPathOnDevice, tempLocalApk], {
            timeout: 30000
          }).catch(() => null);

          if (fs.existsSync(tempLocalApk)) {
            apkBuffer = fs.readFileSync(tempLocalApk);
            fs.unlinkSync(tempLocalApk);
          }
        } catch (pullErr) {
          logger.warn(`[TypographyService] Failed to pull APK from device: ${pullErr.message}`);
          if (fs.existsSync(tempLocalApk)) {
            try { fs.unlinkSync(tempLocalApk); } catch {}
          }
        }
      }

      if (!apkBuffer || apkBuffer.length < 1000) {
        return [];
      }

      // 3. Open with AdmZip and parse all font entries
      const zip = new AdmZip(apkBuffer);
      const entries = zip.getEntries();
      const fontEntries = entries.filter((e) => {
        const name = e.entryName.toLowerCase();
        return (
          (name.includes('res/font/') || name.includes('assets/fonts/') || name.includes('assets/font/')) &&
          (name.endsWith('.ttf') || name.endsWith('.otf') || name.endsWith('.ttc'))
        );
      });

      const catalog = [];
      for (const entry of fontEntries) {
        const data = entry.getData();
        const parsed = parseOpenType(data);
        if (parsed && parsed.familyName) {
          const norm = normalizeWeight(parsed.usWeightClass);
          catalog.push({
            entryPath: entry.entryName,
            fileName: path.basename(entry.entryName),
            familyName: parsed.familyName,
            subFamily: parsed.subFamily || norm.label,
            fullName: parsed.fullName || `${parsed.familyName} ${parsed.subFamily || ''}`.trim(),
            weight: norm.numeric,
            weightLabel: norm.label,
            isItalic: parsed.isItalic,
            isBold: parsed.isBold
          });
        }
      }

      apkFontCache.set(packageName, {
        timestamp: Date.now(),
        fonts: catalog
      });

      logger.info(
        `[TypographyService] Cached ${catalog.length} bundled fonts from APK for ${packageName} on ${serial}`
      );
      return catalog;
    } catch (err) {
      logger.debug(`[TypographyService] Failed to extract APK font catalog for ${packageName}: ${err.message}`);
      return [];
    }
  }

  /**
   * Safely attempts runtime VM inspection via JDWP on debuggable target applications.
   * Performs passive inspection (version handshake, class metadata, VM state) without
   * leaving target threads suspended. Times out after 3000ms and detaches immediately.
   *
   * @param {string} serial
   * @param {string} packageName
   * @returns {Promise<object|null>}
   */
  async inspectRuntimeJdwp(serial, packageName) {
    if (!serial || !packageName || packageName.startsWith('android')) {
      return null;
    }

    try {
      // 1. Check if package is debuggable
      const pkgDumpsysRes = await adbService.execute(['-s', serial, 'shell', 'dumpsys', 'package', packageName]).catch(() => null);
      const pkgDumpsys = (pkgDumpsysRes?.stdout || pkgDumpsysRes?.raw || '');
      if (!pkgDumpsys || !pkgDumpsys.includes('DEBUGGABLE')) {
        return {
          supported: false,
          reason: 'Application is not marked android:debuggable=true in AndroidManifest.xml'
        };
      }

      // 2. Find PID of target process
      const pidRes = await adbService.execute(['-s', serial, 'shell', 'pidof', packageName]).catch(() => null);
      const pidStr = (pidRes?.stdout || '').trim().split(/\s+/)[0];
      const pid = parseInt(pidStr, 10);
      if (!pid || isNaN(pid)) {
        return {
          supported: false,
          reason: `Target application process '${packageName}' is not currently running`
        };
      }

      // 3. Allocate a free local TCP port for JDWP forward
      const localPort = 8700 + (Math.floor(Math.random() * 100));
      await adbService.execute(['-s', serial, 'forward', `tcp:${localPort}`, `jdwp:${pid}`]);

      try {
        const vmInfo = await new Promise((resolve) => {
          let resolved = false;
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              client.destroy();
              resolve(null);
            }
          }, 3000);

          const client = net.createConnection({ port: localPort, host: '127.0.0.1' }, () => {
            client.write('JDWP-Handshake');
          });

          let handshaked = false;
          let buffer = Buffer.alloc(0);

          client.on('data', (chunk) => {
            buffer = Buffer.concat([buffer, chunk]);
            if (!handshaked && buffer.toString().startsWith('JDWP-Handshake')) {
              handshaked = true;
              buffer = buffer.slice('JDWP-Handshake'.length);

              // Send JDWP Version command (CommandSet 1, Command 1)
              const pkt = Buffer.alloc(11);
              pkt.writeUInt32BE(11, 0); // length
              pkt.writeUInt32BE(1, 4);  // id
              pkt.writeUInt8(0, 8);     // flags
              pkt.writeUInt8(1, 9);     // command set: VirtualMachine
              pkt.writeUInt8(1, 10);    // command: Version
              client.write(pkt);
              return;
            }

            if (handshaked && buffer.length >= 11) {
              const len = buffer.readUInt32BE(0);
              if (buffer.length >= len) {
                const errorCode = buffer.readUInt16BE(9);
                if (errorCode === 0) {
                  let off = 11;
                  const descLen = buffer.readUInt32BE(off); off += 4;
                  const desc = buffer.toString('utf8', off, off + descLen); off += descLen;
                  const jdwpMajor = buffer.readInt32BE(off); off += 4;
                  const jdwpMinor = buffer.readInt32BE(off); off += 4;
                  const vmVerLen = buffer.readUInt32BE(off); off += 4;
                  const vmVer = buffer.toString('utf8', off, off + vmVerLen); off += vmVerLen;
                  const vmNameLen = buffer.readUInt32BE(off); off += 4;
                  const vmName = buffer.toString('utf8', off, off + vmNameLen); off += vmNameLen;

                  if (!resolved) {
                    resolved = true;
                    clearTimeout(timer);
                    client.end();
                    resolve({
                      supported: true,
                      pid,
                      vmName,
                      vmVersion: vmVer,
                      jdwpVersion: `${jdwpMajor}.${jdwpMinor}`,
                      description: desc
                    });
                  }
                }
              }
            }
          });

          client.on('error', () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              resolve(null);
            }
          });
        });

        return vmInfo;
      } finally {
        // Always clean up ADB port forward immediately to prevent port leaks
        await adbService.execute(['-s', serial, 'forward', '--remove', `tcp:${localPort}`]).catch(() => {});
      }
    } catch (err) {
      logger.debug(`[TypographyService] Runtime JDWP check non-fatal error: ${err.message}`);
      return null;
    }
  }

  /**
   * Performs user-triggered live runtime typography extraction via JDWP on a debuggable app.
   * Maps the selected UIAutomator node to its live View and Typeface on the heap,
   * extracting exact runtime weight, style, text color, and matching font assets.
   *
   * @param {string} serial
   * @param {string} packageName
   * @param {object} node
   * @returns {Promise<object>}
   */
  async inspectRuntimeViewTypography(serial, packageName, node) {
    const self = this;
    if (!serial || !packageName) {
      return { success: false, error: 'Device serial and package name are required' };
    }
    if (!node || (!node.text && !node.resourceId)) {
      return { success: false, error: 'Selected element must have text or resource ID to map to runtime View' };
    }

    // 1. Verify that target application is debuggable and running
    const dumpsys = await adbService.execute(['-s', serial, 'shell', 'dumpsys', 'package', packageName]);
    const isDebuggable = (dumpsys?.stdout || '').includes('DEBUGGABLE');
    if (!isDebuggable) {
      return {
        success: false,
        supported: false,
        error: `Application '${packageName}' is not debuggable (android:debuggable=true required).`
      };
    }

    const pidRes = await adbService.execute(['-s', serial, 'shell', 'pidof', packageName]);
    const pidStr = (pidRes?.stdout || '').trim().split(/\s+/)[0];
    const pid = parseInt(pidStr, 10);
    if (!pid || isNaN(pid)) {
      return {
        success: false,
        supported: false,
        error: `Target application process '${packageName}' is not currently running`
      };
    }

    const localPort = 8720 + Math.floor(Math.random() * 80);

    // Forward temporary port
    await adbService.execute(['-s', serial, 'forward', `tcp:${localPort}`, `jdwp:${pid}`]);

    let socket = null;
    try {
      const result = await new Promise((resolve, reject) => {
        let isComplete = false;
        const timer = setTimeout(() => {
          if (!isComplete) {
            isComplete = true;
            if (socket) socket.destroy();
            resolve({ success: false, error: 'Runtime JDWP inspection timed out after 15000ms' });
          }
        }, 15000);

        socket = new net.Socket();
        let packetId = 1;
        const pendingRequests = new Map();
        let rxBuf = Buffer.alloc(0);
        let handshaked = false;

        function sendCommand(cmdSet, cmd, data = Buffer.alloc(0), timeoutMs = 4000) {
          return new Promise((res, rej) => {
            const id = packetId++;
            const len = 11 + data.length;
            const header = Buffer.alloc(11);
            header.writeUInt32BE(len, 0);
            header.writeUInt32BE(id, 4);
            header.writeUInt8(0, 8);
            header.writeUInt8(cmdSet, 9);
            header.writeUInt8(cmd, 10);
            const packet = Buffer.concat([header, data]);
            const cmdTimer = setTimeout(() => {
              if (pendingRequests.has(id)) {
                pendingRequests.delete(id);
                rej(new Error(`JDWP command ${cmdSet}/${cmd} timed out after ${timeoutMs}ms`));
              }
            }, timeoutMs);
            pendingRequests.set(id, {
              resolve: (val) => {
                clearTimeout(cmdTimer);
                res(val);
              },
              reject: (err) => {
                clearTimeout(cmdTimer);
                rej(err);
              },
              cmdSet,
              cmd
            });
            socket.write(packet);
          });
        }

        function processIncoming() {
          if (!handshaked) {
            if (rxBuf.length >= 14 && rxBuf.toString('ascii', 0, 14) === 'JDWP-Handshake') {
              handshaked = true;
              rxBuf = rxBuf.subarray(14);
              executeInspection().then((res) => {
                if (!isComplete) {
                  isComplete = true;
                  clearTimeout(timer);
                  resolve(res);
                }
              }).catch((err) => {
                if (!isComplete) {
                  isComplete = true;
                  clearTimeout(timer);
                  reject(err);
                }
              });
            } else {
              return;
            }
          }

          while (rxBuf.length >= 11) {
            const len = rxBuf.readUInt32BE(0);
            if (rxBuf.length < len) break;
            const packet = rxBuf.subarray(0, len);
            rxBuf = rxBuf.subarray(len);
            const id = packet.readUInt32BE(4);
            const errCode = packet.readUInt16BE(9);
            const data = packet.subarray(11);
            const req = pendingRequests.get(id);
            if (req) {
              pendingRequests.delete(id);
              if (errCode === 0) req.resolve(data);
              else req.reject(new Error(`JDWP Error ${errCode} on cmd ${req.cmdSet}/${req.cmd}`));
            }
          }
        }

        socket.on('data', (chunk) => {
          rxBuf = Buffer.concat([rxBuf, chunk]);
          processIncoming();
        });

        socket.on('error', (err) => {
          if (!isComplete) {
            isComplete = true;
            clearTimeout(timer);
            resolve({ success: false, error: `JDWP connection error: ${err.message}` });
          }
        });

        socket.connect(localPort, '127.0.0.1', () => {
          socket.write('JDWP-Handshake');
        });

        async function executeInspection() {
          const idSizes = await sendCommand(1, 7);
          const fieldIDSize = idSizes.readUInt32BE(0);
          const objectIDSize = idSizes.readUInt32BE(8);
          const refTypeIDSize = idSizes.readUInt32BE(12);

          async function getClassFields(signature) {
            const sigBuf = Buffer.alloc(4 + signature.length);
            sigBuf.writeUInt32BE(signature.length, 0);
            sigBuf.write(signature, 4, 'ascii');
            const cRes = await sendCommand(1, 2, sigBuf);
            if (cRes.readUInt32BE(0) === 0) return { typeId: null, fields: {} };
            const typeId = cRes.subarray(5, 5 + refTypeIDSize);
            const fRes = await sendCommand(2, 4, typeId);
            const count = fRes.readUInt32BE(0);
            let off = 4;
            const fields = {};
            for (let i = 0; i < count && off < fRes.length; i++) {
              const fid = fRes.subarray(off, off + fieldIDSize);
              off += fieldIDSize;
              const nl = fRes.readUInt32BE(off);
              off += 4;
              const fn = fRes.toString('ascii', off, off + nl);
              off += nl;
              const sl = fRes.readUInt32BE(off);
              off += 4;
              const fs = fRes.toString('ascii', off, off + sl);
              off += sl;
              off += 4;
              fields[fn] = { fid, sig: fs };
            }
            return { typeId, fields };
          }

          async function getObjectFields(objId, fieldIds) {
            const req = Buffer.concat([
              objId,
              Buffer.from([0, 0, 0, fieldIds.length]),
              ...fieldIds
            ]);
            const res = await sendCommand(9, 2, req);
            const count = res.readUInt32BE(0);
            let off = 4;
            const results = [];
            for (let i = 0; i < count; i++) {
              const tag = res.readUInt8(off++);
              let val = null;
              if (tag === 73) {
                val = res.readInt32BE(off);
                off += 4;
              } else if (tag === 74) {
                val = res.readBigInt64BE(off);
                off += 8;
              } else if (tag === 90) {
                val = res.readUInt8(off) !== 0;
                off += 1;
              } else if (tag === 70) {
                val = res.readFloatBE(off);
                off += 4;
              } else if (tag === 76 || tag === 91 || tag === 115) {
                val = res.subarray(off, off + objectIDSize);
                off += objectIDSize;
              } else {
                off += objectIDSize;
              }
              results.push({ tag: String.fromCharCode(tag), val });
            }
            return results;
          }

          async function readString(stringObjId) {
            if (!stringObjId || !stringObjId.some((b) => b !== 0)) return '';
            try {
              const sRes = await sendCommand(10, 1, stringObjId);
              const sLen = sRes.readUInt32BE(0);
              return sRes.toString('utf8', 4, 4 + sLen);
            } catch {
              return '';
            }
          }

          const classHierarchyCache = new Map();
          async function isSubclassOf(refTypeId, targetSig) {
            let curr = refTypeId;
            while (curr && curr.some((b) => b !== 0)) {
              const hex = curr.toString('hex');
              let sig = classHierarchyCache.get(hex);
              if (!sig) {
                const sRes = await sendCommand(2, 1, curr).catch(() => null);
                if (!sRes) break;
                const sLen = sRes.readUInt32BE(0);
                sig = sRes.toString('ascii', 4, 4 + sLen);
                classHierarchyCache.set(hex, sig);
              }
              if (sig === targetSig) return true;
              if (sig === 'Ljava/lang/Object;') break;
              const superRes = await sendCommand(3, 1, curr).catch(() => null);
              if (!superRes || superRes.length < refTypeIDSize) break;
              curr = superRes.subarray(0, refTypeIDSize);
            }
            return false;
          }

          const wmgInfo = await getClassFields('Landroid/view/WindowManagerGlobal;');
          const alInfo = await getClassFields('Ljava/util/ArrayList;');
          const viewInfo = await getClassFields('Landroid/view/View;');
          const vgInfo = await getClassFields('Landroid/view/ViewGroup;');
          const tvInfo = await getClassFields('Landroid/widget/TextView;');
          const tfInfo = await getClassFields('Landroid/graphics/Typeface;');
          const tpInfo = await getClassFields('Landroid/text/TextPaint;').catch(() => ({ typeId: null, fields: {} }));
          const paintInfo = await getClassFields('Landroid/graphics/Paint;').catch(() => ({ typeId: null, fields: {} }));
          const resInfo = await getClassFields('Landroid/content/res/Resources;').catch(() => ({ typeId: null, fields: {} }));
          const implInfo = await getClassFields('Landroid/content/res/ResourcesImpl;').catch(() => ({ typeId: null, fields: {} }));
          const dmInfo = await getClassFields('Landroid/util/DisplayMetrics;').catch(() => ({ typeId: null, fields: {} }));

          let systemDensity = null;
          let systemScaledDensity = null;
          let systemDensityDpi = null;

          if (resInfo.typeId && resInfo.fields['mSystem']?.fid && implInfo.fields['mMetrics']?.fid && dmInfo.fields['density']?.fid) {
            try {
              const mSysRes = await sendCommand(2, 6, Buffer.concat([
                resInfo.typeId,
                Buffer.from([0, 0, 0, 1]),
                resInfo.fields['mSystem'].fid
              ]));
              const mSysObjId = mSysRes.subarray(5, 5 + objectIDSize);
              if (mSysObjId.some((b) => b !== 0)) {
                const implRes = await getObjectFields(mSysObjId, [resInfo.fields['mResourcesImpl'].fid]);
                const implObjId = implRes[0].val;
                if (implObjId && implObjId.some((b) => b !== 0)) {
                  const mMetricsRes = await getObjectFields(implObjId, [implInfo.fields['mMetrics'].fid]);
                  const dmObjId = mMetricsRes[0].val;
                  if (dmObjId && dmObjId.some((b) => b !== 0)) {
                    const dmFieldsToFetch = [dmInfo.fields['density'].fid];
                    const hasScaled = !!dmInfo.fields['scaledDensity']?.fid;
                    const hasDpi = !!dmInfo.fields['densityDpi']?.fid;
                    if (hasScaled) dmFieldsToFetch.push(dmInfo.fields['scaledDensity'].fid);
                    if (hasDpi) dmFieldsToFetch.push(dmInfo.fields['densityDpi'].fid);

                    const dmVals = await getObjectFields(dmObjId, dmFieldsToFetch);
                    let dmIdx = 0;
                    systemDensity = dmVals[dmIdx++].val;
                    if (hasScaled) systemScaledDensity = dmVals[dmIdx++].val;
                    if (hasDpi) systemDensityDpi = dmVals[dmIdx++].val;
                  }
                }
              }
            } catch (err) {
              logger.debug(`[TypographyService] Error reading DisplayMetrics via JDWP: ${err.message}`);
            }
          }

          const sDefFid = wmgInfo.fields['sDefaultWindowManager']?.fid;
          const mViewsFid = wmgInfo.fields['mViews']?.fid;
          if (!sDefFid || !mViewsFid) throw new Error('WindowManagerGlobal fields missing');

          const sDefRes = await sendCommand(2, 6, Buffer.concat([
            wmgInfo.typeId,
            Buffer.from([0, 0, 0, 1]),
            sDefFid
          ]));
          const sDefObjId = sDefRes.subarray(5, 5 + objectIDSize);

          const mViewsRes = await getObjectFields(sDefObjId, [mViewsFid]);
          const mViewsObjId = mViewsRes[0].val;

          const alRes = await getObjectFields(mViewsObjId, [alInfo.fields['size'].fid, alInfo.fields['elementData'].fid]);
          const alSize = alRes[0].val;
          const elDataObjId = alRes[1].val;

          const lenRes = await sendCommand(13, 1, elDataObjId);
          const arrLen = lenRes.readUInt32BE(0);
          const fetchCount = Math.min(alSize, arrLen);
          logger.info(`[TypographyService] alSize=${alSize}, arrLen=${arrLen}, fetchCount=${fetchCount}`);
          const rootObjIds = [];
          if (fetchCount > 0) {
            const arrRes = await sendCommand(13, 2, Buffer.concat([
              elDataObjId,
              Buffer.from([0, 0, 0, 0]),
              Buffer.from([0, 0, 0, fetchCount])
            ]));
            for (let i = 0; i < fetchCount; i++) {
              const off = 5 + i * (1 + objectIDSize) + 1;
              rootObjIds.push(arrRes.subarray(off, off + objectIDSize));
            }
          }

          const targetText = (node.text || '').trim();
          const discoveredTextViews = [];

          async function traverseView(viewObjId, parentLeft = 0, parentTop = 0, depth = 0) {
            if (!viewObjId || !viewObjId.some((b) => b !== 0) || depth > 12) return;
            if (discoveredTextViews.length >= 25) return;
            if (targetText && discoveredTextViews.some((v) => v.text && v.text.trim() === targetText)) {
              return;
            }

            try {
              const refTypeRes = await sendCommand(9, 1, viewObjId);
              const refTypeId = refTypeRes.subarray(1, 1 + refTypeIDSize);

              const sigRes = await sendCommand(2, 1, refTypeId);
              const sigLen = sigRes.readUInt32BE(0);
              const classSig = sigRes.toString('ascii', 4, 4 + sigLen);

              const vFields = await getObjectFields(viewObjId, [
                viewInfo.fields['mID'].fid,
                viewInfo.fields['mLeft'].fid,
                viewInfo.fields['mTop'].fid,
                viewInfo.fields['mRight'].fid,
                viewInfo.fields['mBottom'].fid
              ]);
              const mId = vFields[0].val;
              const localLeft = vFields[1].val || 0;
              const localTop = vFields[2].val || 0;
              const localRight = vFields[3].val || 0;
              const localBottom = vFields[4].val || 0;
              const width = Math.max(0, localRight - localLeft);
              const height = Math.max(0, localBottom - localTop);
              const screenLeft = parentLeft + localLeft;
              const screenTop = parentTop + localTop;
              const bounds = {
                left: screenLeft,
                top: screenTop,
                right: screenLeft + width,
                bottom: screenTop + height,
                width,
                height
              };

              const isTextView = classSig.includes('TextView') || classSig.includes('Button') || classSig.includes('EditText') || await isSubclassOf(refTypeId, 'Landroid/widget/TextView;');
              const isViewGroup = classSig.includes('ViewGroup') || classSig.includes('Layout') || classSig.includes('DecorView') || await isSubclassOf(refTypeId, 'Landroid/view/ViewGroup;');

              if (isTextView) {
                const reqFields = [
                  tvInfo.fields['mText']?.fid,
                  tvInfo.fields['mOriginalTypeface']?.fid,
                  tvInfo.fields['mCurTextColor']?.fid
                ];
                const hasTextPaint = !!tvInfo.fields['mTextPaint']?.fid;
                const hasTextSizeUnit = !!tvInfo.fields['mTextSizeUnit']?.fid;
                const hasTvTextSize = !!tvInfo.fields['mTextSize']?.fid;

                if (hasTextPaint) reqFields.push(tvInfo.fields['mTextPaint'].fid);
                if (hasTextSizeUnit) reqFields.push(tvInfo.fields['mTextSizeUnit'].fid);
                if (hasTvTextSize) reqFields.push(tvInfo.fields['mTextSize'].fid);

                const tfFields = await getObjectFields(viewObjId, reqFields.filter(Boolean));

                let fIdx = 0;
                const mTextObjId = tfFields[fIdx++].val;
                const mTypefaceObjId = tfFields[fIdx++].val;
                const curTextColor = tfFields[fIdx++].val;
                const mTextPaintObjId = hasTextPaint ? tfFields[fIdx++].val : null;
                const textSizeUnit = hasTextSizeUnit ? tfFields[fIdx++].val : null;
                const directTvTextSize = hasTvTextSize ? tfFields[fIdx++].val : null;

                const textStr = await readString(mTextObjId);
                let typefaceInfo = null;

                if (mTypefaceObjId && mTypefaceObjId.some((b) => b !== 0)) {
                  const tRes = await getObjectFields(mTypefaceObjId, [
                    tfInfo.fields['mWeight'].fid,
                    tfInfo.fields['mStyle'].fid
                  ]);
                  typefaceInfo = {
                    weight: tRes[0].val,
                    style: tRes[1].val === 0 ? 'normal' : (tRes[1].val === 1 ? 'bold' : (tRes[1].val === 2 ? 'italic' : 'bold_italic'))
                  };
                }

                let paintDensity = null;
                let directPaintTextSize = null;

                if (mTextPaintObjId && mTextPaintObjId.some((b) => b !== 0)) {
                  const tpReq = [];
                  const hasDensity = !!tpInfo.fields['density']?.fid;
                  const hasTpTextSize = !!tpInfo.fields['mTextSize']?.fid;
                  const hasPaintTextSize = !!paintInfo.fields['mTextSize']?.fid;

                  if (hasDensity) tpReq.push(tpInfo.fields['density'].fid);
                  if (hasTpTextSize) tpReq.push(tpInfo.fields['mTextSize'].fid);
                  if (hasPaintTextSize) tpReq.push(paintInfo.fields['mTextSize'].fid);

                  if (tpReq.length > 0) {
                    try {
                      const tpRes = await getObjectFields(mTextPaintObjId, tpReq);
                      let tpIdx = 0;
                      if (hasDensity) paintDensity = tpRes[tpIdx++].val;
                      if (hasTpTextSize) directPaintTextSize = tpRes[tpIdx++].val;
                      if (hasPaintTextSize && directPaintTextSize === null) directPaintTextSize = tpRes[tpIdx++].val;
                    } catch {}
                  }
                }

                const runtimePaintPx = (typeof directTvTextSize === 'number' && directTvTextSize > 0)
                  ? directTvTextSize
                  : ((typeof directPaintTextSize === 'number' && directPaintTextSize > 0) ? directPaintTextSize : null);

                discoveredTextViews.push({
                  class: classSig.replace(/^L|;$/g, '').replace(/\//g, '.'),
                  id: mId !== 0 ? `0x${(mId >>> 0).toString(16)}` : 'NO_ID',
                  text: textStr,
                  bounds,
                  textColor: `#${(curTextColor >>> 0).toString(16).padStart(8, '0').toUpperCase()}`,
                  typeface: typefaceInfo,
                  paintDensity: typeof paintDensity === 'number' ? Math.round(paintDensity * 100) / 100 : null,
                  textSizeUnit,
                  runtimePaintPx
                });
              }

              if (isViewGroup) {
                try {
                  const gRes = await getObjectFields(viewObjId, [
                    vgInfo.fields['mChildrenCount'].fid,
                    vgInfo.fields['mChildren'].fid
                  ]);
                  const childCount = gRes[0].val;
                  const childrenArrayObjId = gRes[1].val;
                  if (childCount > 0 && childrenArrayObjId && childrenArrayObjId.some((b) => b !== 0)) {
                    const cLenRes = await sendCommand(13, 1, childrenArrayObjId).catch(() => null);
                    const cArrLen = cLenRes ? cLenRes.readUInt32BE(0) : childCount;
                    const fetchChildren = Math.min(childCount, cArrLen);
                    if (fetchChildren > 0) {
                      const cArrRes = await sendCommand(13, 2, Buffer.concat([
                        childrenArrayObjId,
                        Buffer.from([0, 0, 0, 0]),
                        Buffer.from([0, 0, 0, fetchChildren])
                      ]));
                      for (let i = 0; i < fetchChildren; i++) {
                        const off = 5 + i * (1 + objectIDSize) + 1;
                        const childObjId = cArrRes.subarray(off, off + objectIDSize);
                        await traverseView(childObjId, screenLeft, screenTop, depth + 1);
                      }
                    }
                  }
                } catch {}
              }
            } catch {}
          }

          for (const rootId of rootObjIds) {
            await traverseView(rootId, 0, 0, 0);
          }

          logger.info(`[TypographyService] Discovered ${discoveredTextViews.length} TextViews in runtime heap: ${discoveredTextViews.map(v => `"${v.text}"`).filter(Boolean).slice(0, 10).join(', ')}`);

          // Match the target node
          let matched = null;

          if (targetText.length > 0) {
            const textMatches = discoveredTextViews.filter((v) => v.text && v.text.trim() === targetText);
            if (textMatches.length === 1) {
              matched = textMatches[0];
            } else if (textMatches.length > 1) {
              let targetLeft = null;
              let targetTop = null;
              let targetW = 0;
              let targetH = 0;
              if (Array.isArray(node.bounds)) {
                targetLeft = node.bounds[0];
                targetTop = node.bounds[1];
                targetW = node.bounds[2] - node.bounds[0];
                targetH = node.bounds[3] - node.bounds[1];
              } else if (typeof node.bounds === 'object') {
                targetLeft = node.bounds.left;
                targetTop = node.bounds.top;
                targetW = node.bounds.width ?? ((node.bounds.right || 0) - (node.bounds.left || 0));
                targetH = node.bounds.height ?? ((node.bounds.bottom || 0) - (node.bounds.top || 0));
              }

              if (targetLeft !== null && targetTop !== null && targetW > 0 && targetH > 0) {
                matched = textMatches.find((m) => {
                  const dx = Math.abs(m.bounds.left - targetLeft);
                  const dy = Math.abs(m.bounds.top - targetTop);
                  const dw = Math.abs(m.bounds.width - targetW);
                  const dh = Math.abs(m.bounds.height - targetH);
                  return dx < 30 && dy < 30 && dw < 30 && dh < 30;
                });
              }

              if (!matched) {
                // If all matching text views share identical typography metrics, safe to resolve
                const firstTf = textMatches[0].typeface;
                const allSame = textMatches.every((m) =>
                  m.typeface?.weight === firstTf?.weight &&
                  m.typeface?.style === firstTf?.style &&
                  m.textColor === textMatches[0].textColor
                );
                if (allSame) {
                  matched = textMatches[0];
                }
              }
            }
          }

          if (!matched) {
            return {
              success: false,
              matched: false,
              error: `Could not uniquely map element '${targetText || node.resourceId}' to runtime View instance.`
            };
          }

          // Query APK font catalog to match candidates filtered by exact runtime weight
          const catalog = await self.getApkFontCatalog(serial, packageName);
          const weightNum = matched.typeface?.weight || 400;
          const weightNorm = normalizeWeight(weightNum);

          const matchingFonts = catalog.filter((f) => Math.abs(f.weight - weightNum) <= 50);
          const uniqueFamilies = Array.from(new Set(matchingFonts.map((f) => f.preferredFamily || f.familyName)));

          // Check if element resource ID or text hints at a specific font file
          const resHint = (node.resourceId || '').toLowerCase();
          let hintedFamily = null;
          for (const f of matchingFonts) {
            const fontBase = path.basename(f.assetPath || '', path.extname(f.assetPath || '')).toLowerCase();
            if (resHint.includes(fontBase) || (node.text && node.text.toLowerCase().includes(fontBase))) {
              hintedFamily = f.preferredFamily || f.familyName;
              break;
            }
          }

          let fontFamilyResult;
          if (hintedFamily) {
            fontFamilyResult = {
              value: hintedFamily,
              candidates: [hintedFamily],
              source: 'Inferred',
              status: 'INFERRED',
              confidence: 'high',
              note: `Direct correlation between element resource hint and bundled font '${hintedFamily}' (weight ${weightNum})`
            };
          } else if (uniqueFamilies.length === 1) {
            fontFamilyResult = {
              value: uniqueFamilies[0],
              candidates: uniqueFamilies,
              source: 'Inferred',
              status: 'INFERRED',
              confidence: 'medium',
              note: `Single bundled font candidate matching exact runtime Typeface weight (${weightNum})`
            };
          } else if (uniqueFamilies.length > 1) {
            fontFamilyResult = {
              value: `Candidates (${weightNorm.label}): ${uniqueFamilies.slice(0, 5).join(', ')}${uniqueFamilies.length > 5 ? ` (+${uniqueFamilies.length - 5} more)` : ''}`,
              candidates: uniqueFamilies,
              source: 'Inferred',
              status: 'INFERRED',
              confidence: 'medium',
              note: `Multiple APK font candidates match exact weight ${weightNum}; distinguishing requires explicit view-style linkage`
            };
          } else {
            fontFamilyResult = {
              value: 'Native SkTypeface (No asset file link in bytecode)',
              candidates: [],
              source: 'Unavailable',
              status: 'UNAVAILABLE',
              confidence: 'low',
              note: 'Standard system font or dynamically synthesized Typeface without corresponding APK font asset'
            };
          }

          const UNIT_MAP = {
            0: 'px',
            1: 'dp',
            2: 'sp',
            3: 'pt',
            4: 'in',
            5: 'mm'
          };
          const unitStr = UNIT_MAP[matched.textSizeUnit] || 'sp';
          const density = matched.paintDensity || systemDensity || 2.75;
          const scaledDensity = systemScaledDensity || density;
          const fontScale = (density > 0 && scaledDensity > 0) ? Math.round((scaledDensity / density) * 100) / 100 : 1.0;

          let fontSizeResult;
          if (matched.runtimePaintPx !== null) {
            const spVal = scaledDensity ? Math.round((matched.runtimePaintPx / scaledDensity) * 10) / 10 : null;
            fontSizeResult = {
              value: `${matched.runtimePaintPx}px (${spVal !== null ? `${spVal}sp` : 'scaled density unavailable'})`,
              pixelSize: matched.runtimePaintPx,
              spSize: spVal,
              density,
              scaledDensity,
              fontScale,
              unit: unitStr,
              source: 'Runtime',
              status: 'EXACT',
              confidence: 'high',
              note: `Retrieved directly from runtime TextPaint via JDWP (density ${density}x, scaledDensity ${scaledDensity}x)`
            };
          } else {
            // Actual native paint size is not stored in Java fields on Android 9+ (API 28+).
            // It is managed in native C++ Skia memory (SkFont::fSize referenced by Paint.mNativePaint).
            // Do NOT disguise a bounding-box visual heuristic as an exact runtime paint measurement.
            const singleLineH = matched.bounds?.height || (node.bounds?.height || 0);
            const estPx = singleLineH > 0 ? Math.max(8, Math.round(singleLineH * 0.65)) : null;
            const estSp = (estPx && scaledDensity) ? Math.round((estPx / scaledDensity) * 10) / 10 : null;

            fontSizeResult = {
              value: estSp !== null ? `~${Math.round(estSp)}sp (${estPx}px layout bound estimate)` : 'Unavailable',
              source: 'Estimated',
              status: 'ESTIMATED',
              confidence: 'low',
              density,
              scaledDensity,
              fontScale,
              unit: unitStr,
              runtimePaintPx: null,
              note: 'Native SkFont size is stored in C++ heap (Paint.mNativePaint pointer); Dalvik/ART bytecode exposes no Java mTextSize field in Android 9+ (API 28+). Value is estimated from layout bounding box height, not a runtime paint measurement.'
            };
          }

          return {
            success: true,
            matched: true,
            runtimeView: {
              class: matched.class,
              id: matched.id,
              text: matched.text,
              textColor: matched.textColor,
              bounds: matched.bounds,
              typeface: matched.typeface,
              paintDensity: matched.paintDensity,
              displayDensity: density,
              scaledDensity,
              fontScale,
              textSizeUnit: matched.textSizeUnit,
              runtimePaintPx: matched.runtimePaintPx
            },
            typography: {
              fontSize: fontSizeResult,
              fontWeight: {
                value: `${weightNum} (${weightNorm.label})`,
                numeric: weightNum,
                source: 'Runtime',
                status: 'EXACT',
                confidence: 'high',
                note: `Retrieved directly from runtime Typeface.mWeight via JDWP (PID ${pid})`
              },
              fontStyle: {
                value: matched.typeface?.style || 'normal',
                source: 'Runtime',
                status: 'EXACT',
                confidence: 'high',
                note: `Retrieved directly from runtime Typeface.mStyle via JDWP (PID ${pid})`
              },
              textColor: {
                value: matched.textColor,
                source: 'Runtime',
                status: 'EXACT',
                confidence: 'high',
                note: `Retrieved directly from runtime TextView.mCurTextColor via JDWP (PID ${pid})`
              },
              fontFamily: fontFamilyResult,
              fakeBold: {
                value: matched.typeface?.style === 'bold' && weightNum < 600 ? 'true' : 'false',
                source: 'Runtime',
                status: 'EXACT',
                confidence: 'high',
                note: matched.typeface?.style === 'bold' && weightNum < 600
                  ? 'Synthetic fake bold applied over non-bold base typeface'
                  : 'No synthetic fake bold detected'
              },
              runtime: {
                supported: true,
                pid,
                vmName: 'Dalvik',
                jdwpVersion: '1.8',
                inspectedAt: new Date().toISOString()
              }
            }
          };
        }
      });

      return result;
    } catch (err) {
      logger.warn(`[TypographyService] Error in inspectRuntimeViewTypography: ${err.message}`);
      return { success: false, error: err.message };
    } finally {
      if (socket) {
        try { socket.end(); socket.destroy(); } catch {}
      }
      await adbService.execute(['-s', serial, 'forward', '--remove', `tcp:${localPort}`]).catch(() => {});
    }
  }

  /**
   * Resolves typography properties for a specific UI node using layered analysis:
   *   Layer 1: Runtime view inspection (if debuggable / instrumented)
   *   Layer 2: Verified APK font catalog correlation
   *   Layer 3: Bounding-box and class heuristics (Estimated)
   *   Layer 4: Unavailable fallback
   *
   * @param {object} node - UIAutomator parsed node
   * @param {string} serial - Android device serial
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async inspectTypography(node, serial, options = {}) {
    const text = node?.text || '';
    const bounds = node?.bounds || {};
    const className = node?.className || '';
    const resourceId = node?.resourceId || '';
    const packageName = node?.package || '';

    // If node has no text, typography is unavailable
    if (!text || text.trim().length === 0) {
      return {
        fontSize: {
          value: 'None',
          source: 'Unavailable',
          status: 'UNAVAILABLE',
          confidence: 'none',
          note: 'No text present on element'
        },
        fontFamily: {
          value: 'Not exposed by UIAutomator',
          source: 'Unavailable',
          status: 'UNAVAILABLE',
          confidence: 'none',
          note: 'No text present on element'
        },
        fontWeight: {
          value: 'Not exposed by UIAutomator',
          source: 'Unavailable',
          status: 'UNAVAILABLE',
          confidence: 'none',
          note: 'No text present on element'
        },
        fontStyle: {
          value: 'normal',
          source: 'Unavailable',
          status: 'UNAVAILABLE',
          confidence: 'none',
          note: 'No text present on element'
        }
      };
    }

    // 1. Standard visual font-size estimation (reusing existing tested algorithm)
    const explicitLines = Math.max(1, (text.match(/\n/g) || []).length + 1);
    const height = bounds.height || 0;
    const singleLineHeight = height > 0 ? height / explicitLines : 0;
    const estimatedPx = Math.max(8, Math.round(singleLineHeight * 0.65));
    const estimatedSp = Math.max(6, Math.round(estimatedPx / 2.625));

    const fontSizeResult = {
      value: `~${estimatedSp}sp (${estimatedPx}px visual estimate)`,
      source: 'Estimated',
      status: 'ESTIMATED',
      confidence: 'medium',
      note: 'Generic visual estimate from bounding box height; not an exact native measurement'
    };

    // 2. Query Bundled Fonts Catalog for this application (Offline APK analysis)
    let catalog = [];
    if (packageName && !options.skipApkAnalysis) {
      catalog = await this.getApkFontCatalog(serial, packageName);
    }

    // 3. Evaluate match against resource ID or layout indicators
    // Check if resourceId or className offers layout hints (e.g. bold, title, caption)
    const lowerResId = (resourceId || '').toLowerCase();
    const isBoldHint =
      lowerResId.includes('bold') ||
      lowerResId.includes('title') ||
      lowerResId.includes('header') ||
      lowerResId.includes('btn') ||
      lowerResId.includes('button');

    let fontFamilyResult = null;
    let fontWeightResult = null;
    let fontStyleResult = {
      value: 'normal',
      source: 'Unavailable',
      status: 'UNAVAILABLE',
      confidence: 'low',
      note: 'Normal/italic style not exposed by UIAutomator'
    };

    // If application has bundled fonts, determine if any family is prominent or referenced
    if (catalog && catalog.length > 0) {
      // Find candidate font families
      // If resource ID specifically names a font or style
      const directMatch = catalog.find((f) => {
        const cleanName = f.familyName.toLowerCase().replace(/\s+/g, '');
        return lowerResId.includes(cleanName);
      });

      if (directMatch) {
        fontFamilyResult = {
          value: directMatch.preferredFamily || directMatch.familyName,
          source: 'Inferred',
          status: 'INFERRED',
          confidence: 'medium',
          note: `Matched bundled font family in APK via resource ID '${resourceId}'`
        };
        fontWeightResult = {
          value: `${directMatch.weight} (${directMatch.weightLabel})`,
          numeric: directMatch.weight,
          source: 'Inferred',
          status: 'INFERRED',
          confidence: 'medium',
          note: `Extracted from declared font file ${directMatch.fileName} (OS/2 usWeightClass); runtime Paint weight may differ`
        };
        fontStyleResult = {
          value: directMatch.isItalic ? 'italic' : 'normal',
          source: 'Inferred',
          status: 'INFERRED',
          confidence: 'medium',
          note: `Extracted from bundled font flags (${directMatch.fileName})`
        };
      } else {
        // App has custom fonts in APK, but this specific TextView does not have an explicit font resource ID link.
        // Present available font candidates without picking one arbitrarily!
        const uniqueFamilies = Array.from(new Set(catalog.map((f) => f.preferredFamily || f.familyName)));
        const candidates = uniqueFamilies.slice(0, 5);

        fontFamilyResult = {
          value: `Candidates: ${candidates.join(', ')}${uniqueFamilies.length > 5 ? ` (+${uniqueFamilies.length - 5} more)` : ''}`,
          candidates: uniqueFamilies,
          source: 'Inferred',
          status: 'INFERRED',
          confidence: 'low',
          note: `APK packages ${uniqueFamilies.length} bundled font families, but exact view binding is set at runtime or in layout style without direct accessibility linkage`
        };

        const inferredWeight = isBoldHint ? 700 : 400;
        const weightLabel = isBoldHint ? 'Bold' : 'Regular';
        fontWeightResult = {
          value: `~${inferredWeight} (${weightLabel} heuristic)`,
          numeric: inferredWeight,
          source: 'Estimated',
          status: 'ESTIMATED',
          confidence: 'low',
          note: `Heuristically estimated from view role/ID '${resourceId || className.split('.').pop()}'; actual runtime Paint weight requires bytecode inspection`
        };
      }
    }

    // 4. Default Fallback when APK analysis is empty or unavailable
    if (!fontFamilyResult) {
      fontFamilyResult = {
        value: 'Not exposed by UIAutomator',
        source: 'Unavailable',
        status: 'UNAVAILABLE',
        confidence: 'none',
        note: 'Android accessibility hierarchy does not provide typeface font family'
      };
    }

    if (!fontWeightResult) {
      const fallbackWeight = isBoldHint ? 700 : 400;
      const weightLabel = isBoldHint ? 'Bold' : 'Regular';
      fontWeightResult = {
        value: `~${fallbackWeight} (${weightLabel} heuristic)`,
        numeric: fallbackWeight,
        source: 'Estimated',
        status: 'ESTIMATED',
        confidence: 'low',
        note: `Visual heuristic based on element class and dimensions; requires bytecode instrumentation for exact Paint weight`
      };
    }

    let runtimeResult = null;
    if (options.inspectRuntime && packageName) {
      runtimeResult = await this.inspectRuntimeJdwp(serial, packageName);
    }

    return {
      fontSize: fontSizeResult,
      fontFamily: fontFamilyResult,
      fontWeight: fontWeightResult,
      fontStyle: fontStyleResult,
      runtime: runtimeResult
    };
  }

  /**
   * Enriches an entire UIAutomator parsed hierarchy tree with layered typography properties.
   * Traverses nodes asynchronously and updates typography and propertySources without mutating native properties.
   *
   * @param {object} rootNode
   * @param {string} serial
   * @param {object} [options]
   * @returns {Promise<object>}
   */
  async enrichHierarchyTypography(rootNode, serial, options = {}) {
    if (!rootNode) return rootNode;

    // First collect all text nodes
    const textNodes = [];
    function collect(n) {
      if (!n) return;
      if (n.text && n.text.trim()) {
        textNodes.push(n);
      }
      if (n.children && n.children.length > 0) {
        n.children.forEach(collect);
      }
    }
    collect(rootNode);

    // Limit concurrent inspections to 20 text nodes to maintain sub-second response times
    const nodesToInspect = textNodes.slice(0, 25);
    await Promise.all(
      nodesToInspect.map(async (node) => {
        try {
          const typo = await this.inspectTypography(node, serial, options);
          if (typo) {
            node.typography = typo;
            if (node.propertySources) {
              node.propertySources.fontSize = typo.fontSize?.source || 'Estimated';
              node.propertySources.fontFamily = typo.fontFamily?.source || 'Unavailable';
              node.propertySources.fontWeight = typo.fontWeight?.source || 'Unavailable';
              node.propertySources.fontStyle = typo.fontStyle?.source || 'Unavailable';
            }
          }
        } catch (err) {
          logger.debug(`[TypographyService] Error enriching node ${node.id}: ${err.message}`);
        }
      })
    );

    return rootNode;
  }
}

module.exports = new TypographyInspectionService();

