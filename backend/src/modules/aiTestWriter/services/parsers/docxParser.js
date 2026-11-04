const AdmZip = require('adm-zip');
const { DOMParser } = require('@xmldom/xmldom');

const DEFAULT_LIMITS = {
  maxBytes: 25 * 1024 * 1024, // 25 MB file size
  maxXmlEntryBytes: 10 * 1024 * 1024, // 10 MB per XML entry
  maxParagraphs: 50000,
  maxTables: 1000,
  maxExtractedTextBytes: 10 * 1024 * 1024, // 10 MB
  maxDomNodes: 200000
};

/**
 * Parses DOCX buffer into normalized structured units.
 * Extracts paragraphs, heading hierarchy, and table rows/cells with exact provenance.
 * Strictly enforces bounded decompression, XML external entity rejection, and node limits.
 */
function parseDocx(buffer, filename, customLimits = {}) {
  const limits = { ...DEFAULT_LIMITS, ...customLimits };
  const warnings = [];

  if (!buffer || buffer.length === 0) {
    warnings.push('Document is empty (0 bytes).');
    return {
      units: [],
      warnings,
      metadata: { paragraphCount: 0, tableCount: 0, totalBytes: 0 }
    };
  }

  if (buffer.length > limits.maxBytes) {
    throw new Error(`DOCX input size (${buffer.length} bytes) exceeds limit of ${limits.maxBytes} bytes.`);
  }

  // 1. Open ZIP archive safely
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch (err) {
    const corruptErr = new Error(`Corrupt or invalid DOCX archive: Unable to read ZIP structure. (${err.message})`);
    corruptErr.code = 'CORRUPT_DOCX';
    throw corruptErr;
  }

  const entries = zip.getEntries();
  const docEntry = entries.find(e => e.entryName === 'word/document.xml');

  if (!docEntry) {
    const invalidErr = new Error('Invalid DOCX document: word/document.xml entry is missing.');
    invalidErr.code = 'INVALID_DOCX';
    throw invalidErr;
  }

  // 2. Validate uncompressed size limit before and during reading
  if (docEntry.header.size > limits.maxXmlEntryBytes) {
    throw new Error(`DOCX document.xml uncompressed size (${docEntry.header.size} bytes) exceeds limit of ${limits.maxXmlEntryBytes} bytes.`);
  }

  let xmlString;
  try {
    const xmlBuffer = zip.readAsText(docEntry);
    xmlString = typeof xmlBuffer === 'string' ? xmlBuffer : docEntry.getData().toString('utf8');
  } catch (err) {
    const corruptErr = new Error(`Corrupt or compressed data error in word/document.xml: ${err.message}`);
    corruptErr.code = 'CORRUPT_DOCX';
    throw corruptErr;
  }

  if (Buffer.byteLength(xmlString, 'utf8') > limits.maxXmlEntryBytes) {
    throw new Error(`DOCX document.xml decompressed content exceeds limit of ${limits.maxXmlEntryBytes} bytes.`);
  }

  // 3. XML Security: Prevent external entity attacks (XXE) and external DTD expansions
  if (/<!ENTITY/i.test(xmlString) || /<!DOCTYPE/i.test(xmlString)) {
    const xxeErr = new Error('Security Violation: Disallowed DTD or XML entity declaration detected in DOCX part.');
    xxeErr.code = 'SECURITY_VIOLATION';
    throw xxeErr;
  }

  // 4. Parse XML DOM with strict error handler
  const parser = new DOMParser({
    onError: (level, msg) => {
      if (level === 'error' || level === 'fatalError') {
        const err = new Error(`Malformed DOCX XML: ${msg}`);
        err.code = 'MALFORMED_XML';
        throw err;
      }
    }
  });

  let doc;
  try {
    doc = parser.parseFromString(xmlString, 'text/xml');
  } catch (err) {
    if (!err.code) err.code = 'MALFORMED_XML';
    throw err;
  }

  // 5. Traverse Document Body
  const bodyNodes = doc.getElementsByTagName('w:body');
  if (!bodyNodes || bodyNodes.length === 0) {
    warnings.push('Document body element (w:body) is empty or missing.');
    return {
      units: [],
      warnings,
      metadata: { paragraphCount: 0, tableCount: 0 }
    };
  }

  const body = bodyNodes[0];
  const units = [];
  const headingStack = []; // Active hierarchy stack of { level, text }
  let currentParagraphIndex = 0;
  let tableIndex = 0;
  let totalExtractedBytes = 0;
  let seq = 0;

  // Helper to extract all text runs from a node
  function extractTextFromNode(node) {
    const textNodes = node.getElementsByTagName('w:t');
    let text = '';
    for (let i = 0; i < textNodes.length; i++) {
      text += textNodes[i].textContent || '';
    }
    return text.trim();
  }

  // Helper to inspect paragraph style
  function getParagraphStyle(pNode) {
    const pPrNodes = pNode.getElementsByTagName('w:pPr');
    if (pPrNodes && pPrNodes.length > 0) {
      const pStyleNodes = pPrNodes[0].getElementsByTagName('w:pStyle');
      if (pStyleNodes && pStyleNodes.length > 0) {
        return pStyleNodes[0].getAttribute('w:val') || '';
      }
    }
    return '';
  }

  // Helper to detect heading level from style
  function parseHeadingLevel(styleVal) {
    if (!styleVal) return null;
    const clean = styleVal.toLowerCase().replace(/[\s_-]/g, '');
    const match = clean.match(/^heading([1-6])$/);
    if (match) {
      return parseInt(match[1], 10);
    }
    if (clean === 'title') return 1;
    if (clean === 'subtitle') return 2;
    return null;
  }

  let nodeCount = 0;
  let child = body.firstChild;

  while (child) {
    nodeCount++;
    if (nodeCount > limits.maxDomNodes) {
      throw new Error(`DOCX structure exceeds DOM node limit (${limits.maxDomNodes} nodes).`);
    }

    const nodeName = child.nodeName;

    if (nodeName === 'w:p') {
      // Paragraph
      const style = getParagraphStyle(child);
      const text = extractTextFromNode(child);
      const headingLevel = parseHeadingLevel(style);

      if (headingLevel !== null && text.length > 0) {
        // Heading found: update headingStack
        while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= headingLevel) {
          headingStack.pop();
        }
        headingStack.push({ level: headingLevel, text });
        currentParagraphIndex = 0; // Reset paragraph counter for new section

        const headingPath = headingStack.map(h => h.text);
        const displayLoc = headingPath.join(' > ');

        const textBytes = Buffer.byteLength(text, 'utf8');
        totalExtractedBytes += textBytes;
        if (totalExtractedBytes > limits.maxExtractedTextBytes) {
          throw new Error(`Extracted text volume exceeds limit of ${limits.maxExtractedTextBytes} bytes.`);
        }

        units.push({
          sequence_number: seq++,
          source_type: 'HEADING',
          source_location: {
            heading_path: headingPath,
            heading_level: headingLevel,
            style
          },
          source_location_display: displayLoc,
          extracted_text: text,
          unit_warnings: [],
          metadata: {
            heading_level: headingLevel,
            style
          }
        });
      } else {
        // Regular paragraph (include even if blank to preserve paragraph ordering)
        currentParagraphIndex++;
        const headingPath = headingStack.map(h => h.text);
        const isBlank = text.length === 0;

        const displayLoc = headingPath.length > 0
          ? `${headingPath.join(' > ')} > Paragraph ${currentParagraphIndex}`
          : `Paragraph ${currentParagraphIndex}`;

        const textBytes = Buffer.byteLength(text, 'utf8');
        totalExtractedBytes += textBytes;
        if (totalExtractedBytes > limits.maxExtractedTextBytes) {
          throw new Error(`Extracted text volume exceeds limit of ${limits.maxExtractedTextBytes} bytes.`);
        }

        units.push({
          sequence_number: seq++,
          source_type: 'PARAGRAPH',
          source_location: {
            heading_path: headingPath,
            paragraph_index: currentParagraphIndex,
            style
          },
          source_location_display: displayLoc,
          extracted_text: text,
          unit_warnings: isBlank ? ['Blank paragraph'] : [],
          metadata: {
            paragraph_index: currentParagraphIndex,
            is_blank: isBlank,
            style
          }
        });
      }
    } else if (nodeName === 'w:tbl') {
      // Table
      tableIndex++;
      if (tableIndex > limits.maxTables) {
        throw new Error(`DOCX table count (${tableIndex}) exceeds limit of ${limits.maxTables} tables.`);
      }

      const rows = child.getElementsByTagName('w:tr');
      const headingPath = headingStack.map(h => h.text);
      let tableHeaderCells = [];

      for (let r = 0; r < rows.length; r++) {
        const rowNode = rows[r];
        const cells = rowNode.getElementsByTagName('w:tc');
        const cellTexts = [];

        for (let c = 0; c < cells.length; c++) {
          const cText = extractTextFromNode(cells[c]);
          cellTexts.push(cText);
        }

        const rowIndex = r + 1; // 1-indexed
        if (rowIndex === 1) {
          tableHeaderCells = [...cellTexts];
        }

        const isHeader = (rowIndex === 1);
        const rowText = cellTexts.join(' | ');
        const textBytes = Buffer.byteLength(rowText, 'utf8');
        totalExtractedBytes += textBytes;

        if (totalExtractedBytes > limits.maxExtractedTextBytes) {
          throw new Error(`Extracted text volume exceeds limit of ${limits.maxExtractedTextBytes} bytes.`);
        }

        const displayLoc = headingPath.length > 0
          ? `${headingPath.join(' > ')} > Table ${tableIndex}, Row ${rowIndex}`
          : `Table ${tableIndex}, Row ${rowIndex}`;

        units.push({
          sequence_number: seq++,
          source_type: isHeader ? 'TABLE_HEADER' : 'TABLE_ROW',
          source_location: {
            heading_path: headingPath,
            table_index: tableIndex,
            row_index: rowIndex,
            column_count: cellTexts.length,
            headers: tableHeaderCells
          },
          source_location_display: displayLoc,
          extracted_text: rowText,
          unit_warnings: [],
          metadata: {
            table_index: tableIndex,
            row_index: rowIndex,
            cells: cellTexts,
            is_header: isHeader
          }
        });
      }
    }

    child = child.nextSibling;
  }

  if (units.length === 0) {
    warnings.push('Document contains no extractable paragraphs or tables.');
  }

  return {
    units,
    warnings,
    metadata: {
      unitCount: units.length,
      paragraphCount: currentParagraphIndex,
      tableCount: tableIndex,
      headingCount: units.filter(u => u.source_type === 'HEADING').length,
      totalBytes: buffer.length
    }
  };
}

module.exports = {
  parseDocx,
  DEFAULT_LIMITS
};
