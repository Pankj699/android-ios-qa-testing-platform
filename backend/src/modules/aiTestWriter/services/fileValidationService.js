const path = require('path');
const zlib = require('zlib');
const AdmZip = require('adm-zip');

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// ZIP Archive Security Limits (DOCX / XLSX)
const ZIP_LIMITS = {
  MAX_ENTRIES: 500,
  MAX_ENTRY_SIZE: 10 * 1024 * 1024,      // 10 MB per individual entry
  MAX_TOTAL_UNCOMPRESSED: 50 * 1024 * 1024, // 50 MB total uncompressed
  MAX_COMPRESSION_RATIO: 20              // 20:1 ratio limit
};

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'csv', 'txt']);

/**
 * Validates file extension, size, content headers/signatures, archive safety,
 * and character encoding.
 * 
 * @param {Buffer} buffer - File buffer
 * @param {string} originalFilename - User-supplied filename
 * @returns {{ documentType: string, sanitizedFilename: string, fileSize: number }}
 */
function validateFile(buffer, originalFilename) {
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error('Invalid file buffer.');
    err.status = 400;
    throw err;
  }

  const fileSize = buffer.length;
  if (fileSize === 0) {
    const err = new Error('File is empty (0 bytes).');
    err.status = 400;
    throw err;
  }

  if (fileSize > MAX_FILE_SIZE) {
    const err = new Error(`File size (${(fileSize / (1024 * 1024)).toFixed(2)} MB) exceeds the 25 MB limit.`);
    err.status = 400;
    throw err;
  }

  if (!originalFilename || typeof originalFilename !== 'string') {
    const err = new Error('Filename is missing or invalid.');
    err.status = 400;
    throw err;
  }

  // Sanitize original filename (strip directory traversal, null bytes, control chars)
  const sanitizedFilename = path.basename(originalFilename).replace(/[\0\r\n\t]/g, '').trim();
  if (!sanitizedFilename) {
    const err = new Error('Sanitized filename is empty.');
    err.status = 400;
    throw err;
  }

  const extMatch = sanitizedFilename.match(/\.([a-zA-Z0-9]+)$/);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    const err = new Error(`Unsupported file extension ".${ext}". Allowed formats are: PDF, DOCX, XLSX, CSV, TXT.`);
    err.status = 400;
    throw err;
  }

  let documentType = ext.toUpperCase();

  switch (ext) {
    case 'pdf':
      validatePdfSignature(buffer);
      break;
    case 'docx':
      validateOoxmlZip(buffer, 'docx');
      break;
    case 'xlsx':
      validateOoxmlZip(buffer, 'xlsx');
      break;
    case 'csv':
      validateTextContent(buffer, 'csv');
      break;
    case 'txt':
      validateTextContent(buffer, 'txt');
      break;
    default: {
      const err = new Error(`Unsupported document type: ${ext}`);
      err.status = 400;
      throw err;
    }
  }

  return {
    documentType,
    sanitizedFilename,
    fileSize
  };
}

/**
 * Validates PDF magic bytes: '%PDF-'
 */
function validatePdfSignature(buffer) {
  if (buffer.length < 5) {
    const err = new Error('Corrupted or truncated PDF file.');
    err.status = 400;
    throw err;
  }

  const magic = buffer.subarray(0, 5).toString('ascii');
  if (magic !== '%PDF-') {
    const err = new Error('Invalid file signature: Content does not match valid PDF magic bytes (%PDF-).');
    err.status = 400;
    throw err;
  }
}

/**
 * Validates DOCX/XLSX ZIP structure, OOXML required entries, compression limits,
 * encryption checks, macro rejection, and path traversal guards.
 */
function validateOoxmlZip(buffer, format) {
  // 1. Verify ZIP local header: PK\x03\x04
  if (buffer.length < 4) {
    const err = new Error(`Corrupted or truncated ${format.toUpperCase()} file.`);
    err.status = 400;
    throw err;
  }

  if (buffer[0] !== 0x50 || buffer[1] !== 0x4B || buffer[2] !== 0x03 || buffer[3] !== 0x04) {
    const err = new Error(`Invalid file signature: Content does not match valid ZIP archive header for ${format.toUpperCase()}.`);
    err.status = 400;
    throw err;
  }

  // 2. Parse central directory in memory using adm-zip
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (parseErr) {
    const err = new Error(`Malformed ZIP archive for ${format.toUpperCase()}: ${parseErr.message}`);
    err.status = 400;
    throw err;
  }

  let entries;
  try {
    entries = zip.getEntries();
  } catch (entryErr) {
    const err = new Error(`Failed to read ZIP directory: ${entryErr.message}`);
    err.status = 400;
    throw err;
  }

  if (!entries || entries.length === 0) {
    const err = new Error(`Empty ZIP archive for ${format.toUpperCase()}.`);
    err.status = 400;
    throw err;
  }

  // 3. Enforce entry count limit
  if (entries.length > ZIP_LIMITS.MAX_ENTRIES) {
    const err = new Error(`ZIP archive exceeds maximum entry count limit (${entries.length} > ${ZIP_LIMITS.MAX_ENTRIES}).`);
    err.status = 400;
    throw err;
  }

  let totalUncompressed = 0;
  const seenEntries = new Set();
  const entryNamesLower = new Set();
  let contentTypesEntry = null;

  for (const entry of entries) {
    const name = entry.entryName;
    const lowerName = name.toLowerCase();

    // Check duplicate critical entries
    if (seenEntries.has(name)) {
      const err = new Error(`Archive contains duplicate entry: "${name}".`);
      err.status = 400;
      throw err;
    }
    seenEntries.add(name);
    entryNamesLower.add(lowerName);

    // Path traversal check
    if (
      name.includes('..') ||
      name.startsWith('/') ||
      name.startsWith('\\') ||
      /^[a-zA-Z]:/.test(name) ||
      name.includes('\0')
    ) {
      const err = new Error(`Suspicious entry path detected in archive: "${name}".`);
      err.status = 400;
      throw err;
    }

    // Encryption check (General Purpose Bit Flag: bit 0 = 0x01 indicates encryption)
    if (entry.header && (entry.header.flags & 0x01) !== 0) {
      const err = new Error('Encrypted or password-protected archives are not supported.');
      err.status = 400;
      throw err;
    }

    // Macro file rejection
    if (
      lowerName.endsWith('vbaproject.bin') ||
      lowerName.endsWith('.vba') ||
      lowerName.includes('macrosheets')
    ) {
      const err = new Error('Macro-enabled document detected. Macro-enabled formats (DOCM, XLSM, VBA) are strictly forbidden.');
      err.status = 400;
      throw err;
    }

    // Declared size metadata inspection
    const declaredSize = entry.header ? entry.header.size : 0;
    const declaredCompSize = entry.header ? entry.header.compressedSize : 0;

    if (declaredSize < 0 || declaredCompSize < 0) {
      const err = new Error(`Corrupted entry size metadata in ZIP: "${name}".`);
      err.status = 400;
      throw err;
    }

    // Declared individual entry size limit
    if (declaredSize > ZIP_LIMITS.MAX_ENTRY_SIZE) {
      const err = new Error(`Archive entry "${name}" exceeds 10 MB uncompressed limit (${(declaredSize / (1024 * 1024)).toFixed(1)} MB).`);
      err.status = 400;
      throw err;
    }

    // Declared compression ratio limit (ZIP bomb guard)
    if (declaredCompSize > 0 && declaredSize > 1024) {
      const ratio = declaredSize / declaredCompSize;
      if (ratio > ZIP_LIMITS.MAX_COMPRESSION_RATIO) {
        const err = new Error(`Suspicious compression ratio (${ratio.toFixed(1)}:1) for entry "${name}" exceeds 20:1 limit.`);
        err.status = 400;
        throw err;
      }
    }

    // Enforce ACTUAL decompressed byte counting and bounds
    let actualDecompressedBytes = 0;
    let decompressedPayload = null;

    if (!entry.isDirectory) {
      const method = entry.header ? entry.header.method : 0;
      const remainingArchiveBudget = ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED - totalUncompressed;
      const maxAllowedForEntry = Math.min(ZIP_LIMITS.MAX_ENTRY_SIZE, remainingArchiveBudget);

      if (maxAllowedForEntry <= 0) {
        const err = new Error(`Total uncompressed archive size exceeds 50 MB limit (potential ZIP bomb).`);
        err.status = 400;
        throw err;
      }

      if (method === 0) {
        // STORE (uncompressed)
        const rawData = entry.getCompressedData();
        actualDecompressedBytes = rawData ? rawData.length : 0;
        decompressedPayload = rawData;

        if (actualDecompressedBytes > maxAllowedForEntry) {
          const err = new Error(`Archive entry "${name}" exceeds 10 MB uncompressed limit.`);
          err.status = 400;
          throw err;
        }

        if (entry.header && entry.header.size !== actualDecompressedBytes) {
          const err = new Error(`Inconsistent ZIP metadata: entry "${name}" declared size (${entry.header.size}) does not match actual size (${actualDecompressedBytes}).`);
          err.status = 400;
          throw err;
        }
      } else if (method === 8) {
        // DEFLATE (compressed)
        const compressedData = entry.getCompressedData();
        if (!compressedData) {
          const err = new Error(`Corrupted or missing compressed payload for entry: "${name}".`);
          err.status = 400;
          throw err;
        }

        try {
          // Bounded decompression: stops before creating a buffer larger than allowed budget
          decompressedPayload = zlib.inflateRawSync(compressedData, {
            maxOutputLength: maxAllowedForEntry + 1
          });
          actualDecompressedBytes = decompressedPayload.length;
        } catch (zlibErr) {
          if (zlibErr.code === 'ERR_BUFFER_TOO_LARGE') {
            if (totalUncompressed + maxAllowedForEntry >= ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED) {
              const err = new Error(`Total uncompressed archive size exceeds 50 MB limit (potential ZIP bomb).`);
              err.status = 400;
              throw err;
            }
            const err = new Error(`Archive entry "${name}" exceeds 10 MB uncompressed limit.`);
            err.status = 400;
            throw err;
          }
          const err = new Error(`Malformed compressed data for entry "${name}": ${zlibErr.message}`);
          err.status = 400;
          throw err;
        }

        // Enforce per-entry decompressed limit
        if (actualDecompressedBytes > ZIP_LIMITS.MAX_ENTRY_SIZE) {
          const err = new Error(`Archive entry "${name}" exceeds 10 MB uncompressed limit (${(actualDecompressedBytes / (1024 * 1024)).toFixed(1)} MB).`);
          err.status = 400;
          throw err;
        }

        // Verify metadata consistency (declared header.size vs actual decompressed size)
        if (entry.header && entry.header.size !== actualDecompressedBytes) {
          const err = new Error(`Inconsistent ZIP metadata: entry "${name}" declared size (${entry.header.size}) does not match actual decompressed size (${actualDecompressedBytes}).`);
          err.status = 400;
          throw err;
        }

        // Enforce actual compression ratio
        if (compressedData.length > 0 && actualDecompressedBytes > 1024) {
          const actualRatio = actualDecompressedBytes / compressedData.length;
          if (actualRatio > ZIP_LIMITS.MAX_COMPRESSION_RATIO) {
            const err = new Error(`Suspicious compression ratio (${actualRatio.toFixed(1)}:1) for entry "${name}" exceeds 20:1 limit.`);
            err.status = 400;
            throw err;
          }
        }
      } else {
        const err = new Error(`Unsupported compression method (${method}) for entry "${name}". Only STORE (0) and DEFLATE (8) are supported.`);
        err.status = 400;
        throw err;
      }

      totalUncompressed += actualDecompressedBytes;
      if (totalUncompressed > ZIP_LIMITS.MAX_TOTAL_UNCOMPRESSED) {
        const err = new Error(`Total uncompressed archive size exceeds 50 MB limit (potential ZIP bomb).`);
        err.status = 400;
        throw err;
      }
    }

    if (name === '[Content_Types].xml' || lowerName === '[content_types].xml') {
      contentTypesEntry = entry;
      contentTypesBuffer = decompressedPayload;
    }
  }

  // 4. Validate required OOXML entries
  if (!contentTypesEntry || !contentTypesBuffer) {
    const err = new Error(`Invalid ${format.toUpperCase()} archive: missing required "[Content_Types].xml" entry.`);
    err.status = 400;
    throw err;
  }

  if (format === 'docx') {
    const hasWordDoc = entryNamesLower.has('word/document.xml');
    if (!hasWordDoc) {
      const err = new Error('Invalid DOCX document: missing required "word/document.xml" entry.');
      err.status = 400;
      throw err;
    }
  } else if (format === 'xlsx') {
    const hasWorkbook = entryNamesLower.has('xl/workbook.xml');
    if (!hasWorkbook) {
      const err = new Error('Invalid XLSX spreadsheet: missing required "xl/workbook.xml" entry.');
      err.status = 400;
      throw err;
    }
  }

  // 5. Inspect [Content_Types].xml content for macro declarations using safe bounded buffer
  const contentTypesText = contentTypesBuffer.toString('utf8');

  if (
    contentTypesText.includes('macroEnabled.12') ||
    contentTypesText.includes('vnd.ms-word.document.macroEnabled') ||
    contentTypesText.includes('vnd.ms-excel.sheet.macroEnabled')
  ) {
    const err = new Error('Macro-enabled document format detected in [Content_Types].xml. Macro-enabled formats are strictly rejected.');
    err.status = 400;
    throw err;
  }
}

/**
 * Validates Text & CSV files:
 * - Supports UTF-8 and UTF-8 BOM
 * - Rejects invalid UTF-8 and binary null bytes (0x00)
 * - Ensures printable text content without imposing rigid delimiter/column width assumptions
 */
function validateTextContent(buffer, format) {
  // Check for binary null bytes (0x00)
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0x00) {
      const err = new Error(`Binary null byte (0x00) detected at offset ${i}. File is not a valid plain-text ${format.toUpperCase()} document.`);
      err.status = 400;
      throw err;
    }
  }

  // Check UTF-8 validity
  let stringContent;
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    stringContent = decoder.decode(buffer);
  } catch (decodeErr) {
    const err = new Error(`Invalid UTF-8 encoding detected: ${decodeErr.message}. Plain text and CSV files must be valid UTF-8.`);
    err.status = 400;
    throw err;
  }

  // Strip optional UTF-8 BOM (\uFEFF)
  if (stringContent.charCodeAt(0) === 0xFEFF) {
    stringContent = stringContent.slice(1);
  }

  if (stringContent.trim().length === 0) {
    const err = new Error(`The ${format.toUpperCase()} file contains only whitespace.`);
    err.status = 400;
    throw err;
  }
}

module.exports = {
  validateFile,
  validatePdfSignature,
  validateOoxmlZip,
  validateTextContent,
  MAX_FILE_SIZE,
  ZIP_LIMITS,
  ALLOWED_EXTENSIONS
};
