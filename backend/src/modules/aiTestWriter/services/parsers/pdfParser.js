const pdfParse = require('pdf-parse');

const DEFAULT_LIMITS = {
  maxBytes: 25 * 1024 * 1024, // 25 MB
  maxPages: 500,
  maxExtractedTextBytes: 10 * 1024 * 1024, // 10 MB
  timeoutMs: 30000 // 30 seconds
};

let pdfParseMutex = Promise.resolve();

/**
 * Extracts text page-by-page from PDF buffer using pdf-parse with custom page render hooks.
 * Serializes executions to protect pdf-parse's shared module singleton from concurrent stream collision.
 * Enforces page-count, text volume, and execution time limits.
 * Detects scanned/image-only PDFs and flags OCR warnings without claiming OCR support.
 */
async function parsePdf(buffer, filename, customLimits = {}) {
  const previous = pdfParseMutex;
  let release;
  pdfParseMutex = new Promise(resolve => { release = resolve; });

  try {
    await previous.catch(() => {});
    return await _parsePdfInternal(buffer, filename, customLimits);
  } finally {
    release();
  }
}

async function _parsePdfInternal(buffer, filename, customLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  const warnings = [];

  if (!buffer || buffer.length === 0) {
    warnings.push('Document is empty (0 bytes).');
    return {
      units: [],
      warnings,
      metadata: { pageCount: 0, totalBytes: 0 }
    };
  }

  if (buffer.length > limits.maxBytes) {
    throw new Error(`PDF input size (${buffer.length} bytes) exceeds limit of ${limits.maxBytes} bytes.`);
  }

  const extractedPages = [];
  let totalExtractedBytes = 0;

  let pageRenderError = null;

  // Custom page renderer hook called for each page in document order
  function customPageRender(pageData) {
    if (pageRenderError) {
      throw pageRenderError;
    }
    const pageNumber = (pageData.pageIndex || 0) + 1; // 1-indexed

    if (pageNumber > limits.maxPages) {
      pageRenderError = new Error(`PDF page count exceeds limit of ${limits.maxPages} pages.`);
      throw pageRenderError;
    }

    return pageData.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false
    }).then(textContent => {
      if (pageRenderError) {
        throw pageRenderError;
      }
      let lastY = null;
      let pageText = '';

      for (const item of textContent.items) {
        if (!item || typeof item.str !== 'string') continue;

        if (lastY === null) {
          pageText += item.str;
        } else if (lastY === item.transform[5]) {
          pageText += ' ' + item.str;
        } else {
          pageText += '\n' + item.str;
        }
        lastY = item.transform[5];
      }

      const pageBytes = Buffer.byteLength(pageText, 'utf8');
      totalExtractedBytes += pageBytes;

      if (totalExtractedBytes > limits.maxExtractedTextBytes) {
        pageRenderError = new Error(`Extracted text volume exceeds limit of ${limits.maxExtractedTextBytes} bytes at page ${pageNumber}.`);
        throw pageRenderError;
      }

      const isEmpty = pageText.trim().length === 0;
      if (isEmpty) {
        warnings.push(`Page ${pageNumber} contains no extractable text layer (OCR required).`);
      }

      extractedPages.push({
        pageNumber,
        text: pageText,
        isEmpty,
        charCount: pageText.length
      });

      return pageText;
    });
  }

  // Ensure input data is passed as an isolated Uint8Array with its own ArrayBuffer.
  // Mozilla PDF.js v1.10.100 LoopbackPort clones buffers using `new value.constructor(value.buffer)`,
  // which discards byteOffset for Node Buffers (especially pooled buffers < 8KB) and triggers
  // deprecated Buffer constructors. Wrapping into an isolated Uint8Array guarantees exact offsets.
  const safeData = new Uint8Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    safeData[i] = buffer[i];
  }

  if (limits.timeoutMs <= 0) {
    const timeoutErr = new Error(`PDF extraction timed out after ${limits.timeoutMs}ms.`);
    timeoutErr.code = 'PARSER_TIMEOUT';
    throw timeoutErr;
  }

  // Execution with strict timeout protection
  const parsePromise = (async () => {
    if (limits._simulateDelayMs) {
      await new Promise(r => setTimeout(r, limits._simulateDelayMs));
    }
    return pdfParse(safeData, {
      pagerender: customPageRender,
      max: limits.maxPages + 1
    });
  })();

  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const timeoutErr = new Error(`PDF extraction timed out after ${limits.timeoutMs}ms.`);
      timeoutErr.code = 'PARSER_TIMEOUT';
      reject(timeoutErr);
    }, limits.timeoutMs);
  });

  let pdfResult;
  try {
    pdfResult = await Promise.race([parsePromise, timeoutPromise]);
  } catch (err) {
    if (err.message && (err.message.includes('PDF page count exceeds') || err.message.includes('Extracted text volume exceeds'))) {
      throw err;
    }
    if (err.code === 'PARSER_TIMEOUT') {
      throw err;
    }
    const corruptErr = new Error(`Corrupt or invalid PDF: Unable to parse document structure. (${err.message})`);
    corruptErr.code = 'CORRUPT_PDF';
    throw corruptErr;
  } finally {
    clearTimeout(timeoutHandle);
  }

  if (pageRenderError) {
    throw pageRenderError;
  }

  if (pdfResult.numpages > limits.maxPages) {
    throw new Error(`PDF page count (${pdfResult.numpages}) exceeds limit of ${limits.maxPages} pages.`);
  }

  // Sort pages by pageNumber to ensure strict monotonic ordering
  extractedPages.sort((a, b) => a.pageNumber - b.pageNumber);

  // Check if entire PDF is scanned or image-only
  const allEmpty = extractedPages.length > 0 && extractedPages.every(p => p.isEmpty);
  if (allEmpty) {
    warnings.unshift('Scanned or image-only PDF: No usable text extracted across document (OCR required).');
  }

  // Map into normalized structured units
  const units = extractedPages.map((page, idx) => ({
    sequence_number: idx,
    source_type: 'PAGE',
    source_location: {
      page_number: page.pageNumber
    },
    source_location_display: `Page ${page.pageNumber}`,
    extracted_text: page.text,
    unit_warnings: page.isEmpty ? ['No extractable text layer (OCR required).'] : [],
    metadata: {
      page_number: page.pageNumber,
      character_count: page.charCount,
      is_empty: page.isEmpty
    }
  }));

  return {
    units,
    warnings,
    metadata: {
      pageCount: pdfResult.numpages,
      renderedPages: extractedPages.length,
      allEmpty,
      totalBytes: buffer.length,
      info: pdfResult.info || {}
    }
  };
}

module.exports = {
  parsePdf,
  DEFAULT_LIMITS
};
