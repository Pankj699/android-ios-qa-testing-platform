const { TextDecoder } = require('util');

const DEFAULT_LIMITS = {
  maxBytes: 25 * 1024 * 1024, // 25 MB
  maxLines: 100000,
  maxExtractedTextBytes: 10 * 1024 * 1024 // 10 MB
};

/**
 * Parses plain text buffer into normalized structured units.
 * Supports UTF-8 and UTF-8 BOM.
 * Strictly detects and rejects invalid encodings without silent corruption.
 */
function parseTxt(buffer, filename, customLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  const warnings = [];

  if (!buffer || buffer.length === 0) {
    warnings.push('Document is empty (0 bytes).');
    return {
      units: [],
      warnings,
      metadata: { lineCount: 0, totalBytes: 0, encoding: 'UTF-8' }
    };
  }

  if (buffer.length > limits.maxBytes) {
    throw new Error(`TXT input size (${buffer.length} bytes) exceeds limit of ${limits.maxBytes} bytes.`);
  }

  // Detect UTF-8 BOM if present in raw bytes
  const hasBom = buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;

  // Strict UTF-8 decoding (fatal: true throws TypeError on invalid byte sequences)
  let text = '';
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
    text = decoder.decode(buffer);
  } catch (err) {
    const encErr = new Error(`Unsupported or invalid text encoding: File is not valid UTF-8. (${err.message})`);
    encErr.code = 'UNSUPPORTED_ENCODING';
    throw encErr;
  }

  // Ensure leading BOM is stripped if preserved
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  if (text.trim().length === 0) {
    warnings.push('Document contains only whitespace.');
  }

  // Split lines (handling \r\n, \r, and \n)
  const rawLines = text.split(/\r\n|\r|\n/);
  if (rawLines.length > limits.maxLines) {
    throw new Error(`TXT line count (${rawLines.length}) exceeds limit of ${limits.maxLines} lines.`);
  }

  let totalExtractedBytes = 0;
  const units = [];

  for (let i = 0; i < rawLines.length; i++) {
    const lineNumber = i + 1; // 1-indexed line number
    const lineContent = rawLines[i];
    const lineBytes = Buffer.byteLength(lineContent, 'utf8');

    totalExtractedBytes += lineBytes;
    if (totalExtractedBytes > limits.maxExtractedTextBytes) {
      throw new Error(`Extracted text volume exceeds limit of ${limits.maxExtractedTextBytes} bytes at line ${lineNumber}.`);
    }

    units.push({
      sequence_number: i,
      source_type: 'LINE',
      source_location: {
        line_number: lineNumber
      },
      source_location_display: `Line ${lineNumber}`,
      extracted_text: lineContent,
      unit_warnings: [],
      metadata: {
        line_number: lineNumber,
        length: lineContent.length
      }
    });
  }

  return {
    units,
    warnings,
    metadata: {
      lineCount: units.length,
      totalBytes: buffer.length,
      hasBom,
      encoding: 'UTF-8'
    }
  };
}

module.exports = {
  parseTxt,
  DEFAULT_LIMITS
};
