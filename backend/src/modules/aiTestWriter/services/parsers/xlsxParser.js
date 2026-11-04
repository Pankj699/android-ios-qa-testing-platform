const ExcelJS = require('exceljs');

const DEFAULT_LIMITS = {
  maxBytes: 25 * 1024 * 1024, // 25 MB
  maxWorksheets: 50,
  maxRowsPerSheet: 50000,
  maxColsPerRow: 200,
  maxExtractedTextBytes: 10 * 1024 * 1024, // 10 MB
  timeoutMs: 30000 // 30 seconds
};

/**
 * Extracts normalized text and formula info from an ExcelJS cell.
 * Does NOT evaluate or execute formulas.
 */
function extractCellInfo(cell) {
  if (!cell || cell.value === null || cell.value === undefined) {
    return { text: '', formula: null, cachedResult: null, isFormula: false };
  }

  const rawVal = cell.value;

  // Formula cell
  if (rawVal && typeof rawVal === 'object' && ('formula' in rawVal || 'sharedFormula' in rawVal)) {
    const formulaStr = rawVal.formula || rawVal.sharedFormula || '';
    const resultVal = (rawVal.result !== undefined && rawVal.result !== null)
      ? String(rawVal.result)
      : '';

    return {
      text: resultVal || formulaStr,
      formula: formulaStr,
      cachedResult: resultVal || null,
      isFormula: true
    };
  }

  // Rich Text cell
  if (rawVal && typeof rawVal === 'object' && Array.isArray(rawVal.richText)) {
    const richStr = rawVal.richText.map(t => (t && t.text) || '').join('');
    return { text: richStr, formula: null, cachedResult: null, isFormula: false };
  }

  // Hyperlink cell
  if (rawVal && typeof rawVal === 'object' && ('hyperlink' in rawVal || 'text' in rawVal)) {
    const linkText = rawVal.text || rawVal.hyperlink || '';
    return { text: String(linkText), formula: null, cachedResult: null, isFormula: false };
  }

  // Error cell
  if (rawVal && typeof rawVal === 'object' && 'error' in rawVal) {
    return { text: String(rawVal.error), formula: null, cachedResult: null, isFormula: false };
  }

  // Date
  if (rawVal instanceof Date) {
    return { text: rawVal.toISOString(), formula: null, cachedResult: null, isFormula: false };
  }

  // Primitive value (number, string, boolean)
  return {
    text: String(rawVal),
    formula: null,
    cachedResult: null,
    isFormula: false
  };
}

/**
 * Converts column index (1-based) to Excel column letter (e.g. 1 -> 'A', 27 -> 'AA').
 */
function getColumnLetter(colIndex) {
  let letter = '';
  let temp = colIndex;
  while (temp > 0) {
    const rem = (temp - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    temp = Math.floor((temp - 1) / 26);
  }
  return letter;
}

/**
 * Parses XLSX buffer into normalized structured units.
 * Preserves workbook sheet order, hidden sheet state, cell coordinates, formulas, and cached values.
 * Strictly enforces configurable limits on file size, sheet count, row/col count, text volume, and execution time.
 */
async function parseXlsx(buffer, filename, customLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  const warnings = [];

  if (!buffer || buffer.length === 0) {
    warnings.push('Document is empty (0 bytes).');
    return {
      units: [],
      warnings,
      metadata: { sheetCount: 0, totalBytes: 0 }
    };
  }

  if (buffer.length > limits.maxBytes) {
    throw new Error(`XLSX input size (${buffer.length} bytes) exceeds limit of ${limits.maxBytes} bytes.`);
  }

  const workbook = new ExcelJS.Workbook();

  if (limits.timeoutMs <= 0) {
    const err = new Error(`XLSX extraction timed out after ${limits.timeoutMs}ms.`);
    err.code = 'PARSER_TIMEOUT';
    throw err;
  }

  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const err = new Error(`XLSX extraction timed out after ${limits.timeoutMs}ms.`);
      err.code = 'PARSER_TIMEOUT';
      reject(err);
    }, limits.timeoutMs);
  });

  const loadPromise = (async () => {
    if (limits._simulateDelayMs) {
      await new Promise(r => setTimeout(r, limits._simulateDelayMs));
    }
    return workbook.xlsx.load(buffer);
  })();

  try {
    await Promise.race([
      loadPromise,
      timeoutPromise
    ]);
  } catch (err) {
    if (err.code === 'PARSER_TIMEOUT') throw err;
    const corruptErr = new Error(`Corrupt or invalid XLSX file: Unable to load workbook. (${err.message})`);
    corruptErr.code = 'CORRUPT_XLSX';
    throw corruptErr;
  } finally {
    clearTimeout(timeoutHandle);
  }

  const worksheets = workbook.worksheets || [];
  if (worksheets.length > limits.maxWorksheets) {
    throw new Error(`XLSX worksheet count (${worksheets.length}) exceeds limit of ${limits.maxWorksheets} sheets.`);
  }

  if (worksheets.length === 0) {
    warnings.push('Workbook contains no worksheets.');
    return {
      units: [],
      warnings,
      metadata: { sheetCount: 0, totalBytes: buffer.length }
    };
  }

  const units = [];
  let totalExtractedBytes = 0;
  let seq = 0;
  const sheetMetadataList = [];

  for (let sIdx = 0; sIdx < worksheets.length; sIdx++) {
    const ws = worksheets[sIdx];
    const sheetName = ws.name || `Sheet${sIdx + 1}`;
    const sheetOrder = sIdx + 1; // 1-indexed
    const isHidden = (ws.state === 'hidden' || ws.state === 'veryHidden');

    if (isHidden) {
      warnings.push(`Worksheet '${sheetName}' (position ${sheetOrder}) is hidden (${ws.state}). Extracted with visibility status.`);
    }

    sheetMetadataList.push({
      sheetName,
      sheetOrder,
      isHidden,
      state: ws.state || 'visible'
    });

    if ((ws.rowCount || 0) > limits.maxRowsPerSheet) {
      throw new Error(`Worksheet '${sheetName}' row count (${ws.rowCount}) exceeds limit of ${limits.maxRowsPerSheet} rows.`);
    }

    // Inspect rows: iterate each row safely up to limits.maxRowsPerSheet
    let headerRow = null;
    let headerRowNumber = 1;
    let headers = [];
    let rowsProcessedInSheet = 0;

    // First pass to discover header row (first non-empty row)
    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (!headerRow && rowsProcessedInSheet < limits.maxRowsPerSheet) {
        headerRow = row;
        headerRowNumber = rowNumber;
      }
    });

    if (!headerRow) {
      // Entire sheet is empty
      units.push({
        sequence_number: seq++,
        source_type: 'SHEET_EMPTY',
        source_location: {
          sheet_name: sheetName,
          sheet_order: sheetOrder,
          is_hidden_sheet: isHidden
        },
        source_location_display: `Sheet '${sheetName}' (Empty)`,
        extracted_text: '',
        unit_warnings: ['Worksheet is empty.'],
        metadata: {
          sheet_name: sheetName,
          sheet_order: sheetOrder,
          is_hidden_sheet: isHidden,
          is_empty: true
        }
      });
      continue;
    }

    // Determine headers from header row
    if ((headerRow.cellCount || 0) > limits.maxColsPerRow) {
      throw new Error(`Worksheet '${sheetName}' column count (${headerRow.cellCount}) exceeds limit of ${limits.maxColsPerRow} columns.`);
    }

    const rawHeaderValues = [];
    const maxCol = headerRow.cellCount || 1;

    for (let c = 1; c <= maxCol; c++) {
      const cell = headerRow.getCell(c);
      const info = extractCellInfo(cell);
      const textVal = info.text.trim();
      const colLetter = getColumnLetter(c);
      rawHeaderValues.push(textVal || `Column_${colLetter}`);
    }
    headers = rawHeaderValues;

    // Header Unit
    const headerDisplay = `Sheet '${sheetName}' > Header (Row ${headerRowNumber})`;
    const headerText = headers.join(' | ');
    units.push({
      sequence_number: seq++,
      source_type: 'SHEET_HEADER',
      source_location: {
        sheet_name: sheetName,
        sheet_order: sheetOrder,
        row_number: headerRowNumber,
        is_hidden_sheet: isHidden,
        headers
      },
      source_location_display: headerDisplay,
      extracted_text: headerText,
      unit_warnings: [],
      metadata: {
        sheet_name: sheetName,
        sheet_order: sheetOrder,
        row_number: headerRowNumber,
        is_hidden_sheet: isHidden,
        headers
      }
    });

    // Process all data rows in this sheet
    ws.eachRow({ includeEmpty: true }, (row, rowNumber) => {
      if (rowNumber === headerRowNumber) return; // Skip header row already processed

      rowsProcessedInSheet++;
      if (rowsProcessedInSheet > limits.maxRowsPerSheet) {
        throw new Error(`Worksheet '${sheetName}' row count exceeds limit of ${limits.maxRowsPerSheet} rows.`);
      }

      if ((row.cellCount || 0) > limits.maxColsPerRow) {
        throw new Error(`Worksheet '${sheetName}' row ${rowNumber} column count (${row.cellCount}) exceeds limit of ${limits.maxColsPerRow} columns.`);
      }

      const rowPairs = [];
      const cellsMap = {};
      const formulasMap = {};
      let hasContent = false;
      const actualCols = Math.max(row.cellCount || 0, headers.length);

      for (let c = 1; c <= actualCols; c++) {
        const cell = row.getCell(c);
        const colLetter = getColumnLetter(c);
        const headerName = headers[c - 1] || `Column_${colLetter}`;
        const info = extractCellInfo(cell);

        if (info.text.length > 0) {
          hasContent = true;
          if (info.isFormula && info.cachedResult !== null) {
            rowPairs.push(`${headerName}: ${info.cachedResult} (formula: =${info.formula}, cached result: ${info.cachedResult})`);
          } else if (info.isFormula) {
            rowPairs.push(`${headerName}: =${info.formula}`);
          } else {
            rowPairs.push(`${headerName}: ${info.text}`);
          }
        }

        cellsMap[headerName] = info.text;
        if (info.isFormula) {
          formulasMap[headerName] = {
            formula: info.formula,
            cachedResult: info.cachedResult,
            wasEvaluated: false
          };
        }
      }

      const extractedText = rowPairs.join(' | ');
      const textBytes = Buffer.byteLength(extractedText, 'utf8');
      totalExtractedBytes += textBytes;

      if (totalExtractedBytes > limits.maxExtractedTextBytes) {
        throw new Error(`Extracted text volume exceeds limit of ${limits.maxExtractedTextBytes} bytes in sheet '${sheetName}'.`);
      }

      const displayLoc = `Sheet '${sheetName}', Row ${rowNumber}`;
      units.push({
        sequence_number: seq++,
        source_type: 'SHEET_ROW',
        source_location: {
          sheet_name: sheetName,
          sheet_order: sheetOrder,
          row_number: rowNumber,
          is_hidden_sheet: isHidden,
          headers
        },
        source_location_display: displayLoc,
        extracted_text: extractedText,
        unit_warnings: !hasContent ? ['Row is blank.'] : [],
        metadata: {
          sheet_name: sheetName,
          sheet_order: sheetOrder,
          row_number: rowNumber,
          is_hidden_sheet: isHidden,
          is_blank: !hasContent,
          cells: cellsMap,
          formulas: Object.keys(formulasMap).length > 0 ? formulasMap : null
        }
      });
    });
  }

  return {
    units,
    warnings,
    metadata: {
      sheetCount: worksheets.length,
      sheets: sheetMetadataList,
      totalUnits: units.length,
      totalBytes: buffer.length
    }
  };
}

module.exports = {
  parseXlsx,
  extractCellInfo,
  getColumnLetter,
  DEFAULT_LIMITS
};
