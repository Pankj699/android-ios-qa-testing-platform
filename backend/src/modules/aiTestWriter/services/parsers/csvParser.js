const { TextDecoder } = require('util');

const DEFAULT_LIMITS = {
  maxBytes: 25 * 1024 * 1024, // 25 MB
  maxRows: 50000,
  maxExtractedTextBytes: 10 * 1024 * 1024 // 10 MB
};

const SUPPORTED_DELIMITERS = [',', ';', '\t', '|'];

/**
 * Detects the most probable delimiter from the first few lines of text.
 * Flags ambiguity warnings if counts are close or irregular.
 */
function detectDelimiter(text) {
  const sampleLines = text.split(/\r\n|\r|\n/).filter(l => l.trim().length > 0).slice(0, 10);
  if (sampleLines.length === 0) {
    return { delimiter: ',', isAmbiguous: false, message: null };
  }

  const scores = {};
  for (const delim of SUPPORTED_DELIMITERS) {
    scores[delim] = { total: 0, lineCounts: [] };
  }

  for (const line of sampleLines) {
    for (const delim of SUPPORTED_DELIMITERS) {
      // Count delimiters not enclosed in quotes (simple sample heuristic)
      let count = 0;
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"') inQuote = !inQuote;
        else if (line[i] === delim && !inQuote) count++;
      }
      scores[delim].total += count;
      scores[delim].lineCounts.push(count);
    }
  }

  // Calculate consistency (low variance across sample lines with count > 0)
  let bestDelim = ',';
  let bestScore = -1;
  const candidates = [];

  for (const delim of SUPPORTED_DELIMITERS) {
    const s = scores[delim];
    if (s.total > 0) {
      const avg = s.total / sampleLines.length;
      const variance = s.lineCounts.reduce((acc, c) => acc + Math.pow(c - avg, 2), 0) / sampleLines.length;
      // Higher average with lower variance gives higher score
      const consistencyScore = avg / (1 + variance);
      candidates.push({ delim, avg, variance, consistencyScore });

      if (consistencyScore > bestScore) {
        bestScore = consistencyScore;
        bestDelim = delim;
      }
    }
  }

  if (candidates.length > 1) {
    // Check if the top two candidates have very similar consistency scores
    candidates.sort((a, b) => b.consistencyScore - a.consistencyScore);
    if (candidates[0].consistencyScore > 0 && candidates[1].consistencyScore > 0) {
      const ratio = candidates[1].consistencyScore / candidates[0].consistencyScore;
      if (ratio > 0.8) {
        return {
          delimiter: candidates[0].delim,
          isAmbiguous: true,
          message: `Delimiter ambiguity detected between '${candidates[0].delim}' and '${candidates[1].delim}'. Selected '${candidates[0].delim}' based on consistency.`
        };
      }
    }
  }

  return { delimiter: bestDelim, isAmbiguous: false, message: null };
}

/**
 * Parses CSV text into rows of field arrays using an RFC 4180 compliant state machine.
 * Tracks source row numbers, multiline quoted fields, and escaped quotes ("").
 */
function tokenizeCsv(text, delimiter) {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  let rowStartLine = 1;
  let currentLine = 1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = i + 1 < text.length ? text[i + 1] : null;

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentField += '"';
          i++;
        } else {
          // Closing quote
          inQuotes = false;
        }
      } else {
        if (char === '\n') currentLine++;
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentField);
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++; // Skip \n in \r\n
        }
        currentRow.push(currentField);
        rows.push({
          rowNumber: rowStartLine,
          fields: currentRow,
          endLine: currentLine
        });
        currentRow = [];
        currentField = '';
        currentLine++;
        rowStartLine = currentLine;
      } else if (char === '\n') {
        currentRow.push(currentField);
        rows.push({
          rowNumber: rowStartLine,
          fields: currentRow,
          endLine: currentLine
        });
        currentRow = [];
        currentField = '';
        currentLine++;
        rowStartLine = currentLine;
      } else {
        currentField += char;
      }
    }
  }

  // Push final field/row if text does not end with newline
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push({
      rowNumber: rowStartLine,
      fields: currentRow,
      endLine: currentLine
    });
  }

  return rows;
}

/**
 * Parses CSV buffer into normalized structured units.
 */
function parseCsv(buffer, filename, customLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  const warnings = [];

  if (!buffer || buffer.length === 0) {
    warnings.push('Document is empty (0 bytes).');
    return {
      units: [],
      warnings,
      metadata: { rowCount: 0, columnCount: 0, delimiter: ',' }
    };
  }

  if (buffer.length > limits.maxBytes) {
    throw new Error(`CSV input size (${buffer.length} bytes) exceeds limit of ${limits.maxBytes} bytes.`);
  }

  // Detect UTF-8 BOM if present in raw bytes
  const hasBom = buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF;

  // Strict UTF-8 decoding
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
    return {
      units: [],
      warnings,
      metadata: { rowCount: 0, columnCount: 0, delimiter: ',', hasBom }
    };
  }

  // Delimiter detection
  const delimDetection = detectDelimiter(text);
  const delimiter = delimDetection.delimiter;
  if (delimDetection.isAmbiguous && delimDetection.message) {
    warnings.push(delimDetection.message);
  }

  // Tokenize rows
  const parsedRows = tokenizeCsv(text, delimiter);

  if (parsedRows.length > limits.maxRows) {
    throw new Error(`CSV row count (${parsedRows.length}) exceeds limit of ${limits.maxRows} rows.`);
  }

  if (parsedRows.length === 0) {
    warnings.push('No parseable rows found in CSV.');
    return {
      units: [],
      warnings,
      metadata: { rowCount: 0, columnCount: 0, delimiter, hasBom }
    };
  }

  // Header resolution: First row is header row
  const headerRowObj = parsedRows[0];
  const rawHeaders = headerRowObj.fields;
  const headers = [];
  let blankHeaderCount = 0;

  for (let c = 0; c < rawHeaders.length; c++) {
    const h = (rawHeaders[c] || '').trim();
    if (h.length === 0) {
      blankHeaderCount++;
      headers.push(`Column_${c + 1}`);
    } else {
      headers.push(h);
    }
  }

  if (blankHeaderCount > 0) {
    warnings.push(`CSV header contains ${blankHeaderCount} blank column header(s). Assigned default identifiers.`);
  }

  const units = [];
  let totalExtractedBytes = 0;
  let seq = 0;

  // Header Unit (sequence 0)
  const headerText = headers.join(' | ');
  units.push({
    sequence_number: seq++,
    source_type: 'CSV_ROW',
    source_location: {
      row_number: headerRowObj.rowNumber,
      column_count: headers.length,
      delimiter
    },
    source_location_display: `Header (Row ${headerRowObj.rowNumber})`,
    extracted_text: headerText,
    unit_warnings: blankHeaderCount > 0 ? [`${blankHeaderCount} column(s) were blank`] : [],
    metadata: {
      row_number: headerRowObj.rowNumber,
      headers,
      is_header: true
    }
  });

  // Data Rows (sequence 1..)
  for (let r = 1; r < parsedRows.length; r++) {
    const rowObj = parsedRows[r];
    const fields = rowObj.fields;

    // Check for empty row
    const isAllBlank = fields.every(f => f.trim().length === 0);
    if (isAllBlank) {
      // Empty row
      units.push({
        sequence_number: seq++,
        source_type: 'CSV_ROW',
        source_location: {
          row_number: rowObj.rowNumber,
          delimiter
        },
        source_location_display: `Row ${rowObj.rowNumber} (Empty)`,
        extracted_text: '',
        unit_warnings: ['Row is empty.'],
        metadata: {
          row_number: rowObj.rowNumber,
          is_empty: true
        }
      });
      continue;
    }

    const unitWarnings = [];
    if (fields.length !== headers.length) {
      unitWarnings.push(`Row has ${fields.length} columns (expected ${headers.length} from header).`);
    }

    // Build structured record mapping: "Header: Value"
    const rowPairs = [];
    const recordMap = {};

    for (let c = 0; c < Math.max(headers.length, fields.length); c++) {
      const colName = headers[c] || `Column_${c + 1}`;
      const val = (fields[c] !== undefined) ? fields[c].trim() : '';
      recordMap[colName] = val;
      if (val.length > 0) {
        rowPairs.push(`${colName}: ${val}`);
      }
    }

    const extractedText = rowPairs.join(' | ');
    const textBytes = Buffer.byteLength(extractedText, 'utf8');
    totalExtractedBytes += textBytes;

    if (totalExtractedBytes > limits.maxExtractedTextBytes) {
      throw new Error(`Extracted text volume exceeds limit of ${limits.maxExtractedTextBytes} bytes at row ${rowObj.rowNumber}.`);
    }

    units.push({
      sequence_number: seq++,
      source_type: 'CSV_ROW',
      source_location: {
        row_number: rowObj.rowNumber,
        delimiter,
        headers
      },
      source_location_display: `Row ${rowObj.rowNumber}`,
      extracted_text: extractedText,
      unit_warnings: unitWarnings,
      metadata: {
        row_number: rowObj.rowNumber,
        cells: recordMap,
        raw_fields: fields
      }
    });
  }

  return {
    units,
    warnings,
    metadata: {
      rowCount: parsedRows.length,
      dataRowCount: parsedRows.length - 1,
      columnCount: headers.length,
      delimiter,
      hasBom,
      headers
    }
  };
}

module.exports = {
  parseCsv,
  detectDelimiter,
  tokenizeCsv,
  DEFAULT_LIMITS
};
