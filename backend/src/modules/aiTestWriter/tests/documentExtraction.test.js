const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const ExcelJS = require('exceljs');

const db = require('../db/connection');
const { runAiMigrations } = require('../db/migrationRunner');
const storageService = require('../services/storageService');
const documentService = require('../services/documentService');
const extractionService = require('../services/extractionService');
const pdfParser = require('../services/parsers/pdfParser');
const docxParser = require('../services/parsers/docxParser');
const xlsxParser = require('../services/parsers/xlsxParser');
const csvParser = require('../services/parsers/csvParser');
const txtParser = require('../services/parsers/txtParser');

// Test fixtures & context
let testUserIdA = null;
let testUserIdB = null;
let testAdminUserId = null;
let testProjectAId = null;
let testProjectBId = null;
let createdDocIds = [];

// Helper: Dynamically builds a valid PDF buffer with byte-exact xref table offsets
function buildPdf(objects) {
  let header = '%PDF-1.4\n';
  let body = '';
  const offsets = [];
  let currentOffset = Buffer.byteLength(header, 'utf8');

  for (let i = 0; i < objects.length; i++) {
    offsets.push(currentOffset);
    const objStr = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    body += objStr;
    currentOffset += Buffer.byteLength(objStr, 'utf8');
  }

  const startxref = currentOffset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += String(off).padStart(10, '0') + ' 00000 n \n';
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  return Buffer.from(header + body + xref + trailer, 'utf8');
}

// Helper: Generates a valid minimal multi-page PDF buffer with selectable page text
function createMultiPagePdfBuffer(page1Text = 'Requirement 1: System Login', page2Text = 'Requirement 2: Data Export') {
  const p1Stream = `BT /F1 12 Tf 50 100 Td (${page1Text}) Tj ET`;
  const p2Stream = `BT /F1 12 Tf 50 100 Td (${page2Text}) Tj ET`;

  const objs = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R 4 0 R]/Count 2>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 5 0 R/Resources<</Font<</F1 6 0 R>>>>>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 7 0 R/Resources<</Font<</F1 6 0 R>>>>>>',
    `<</Length ${Buffer.byteLength(p1Stream, 'utf8')}>>\nstream\n${p1Stream}\nendstream`,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<</Length ${Buffer.byteLength(p2Stream, 'utf8')}>>\nstream\n${p2Stream}\nendstream`
  ];

  return buildPdf(objs);
}

// Helper: Generates a scanned/empty PDF buffer (valid structure but 0 extractable text)
function createEmptyScannedPdfBuffer() {
  const head = '%PDF-1.4\n';
  const obj1 = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  const obj2 = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  const obj3 = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n';

  const off1 = Buffer.byteLength(head, 'utf8');
  const off2 = off1 + Buffer.byteLength(obj1, 'utf8');
  const off3 = off2 + Buffer.byteLength(obj2, 'utf8');
  const body = head + obj1 + obj2 + obj3;

  const startxref = Buffer.byteLength(body, 'utf8');

  const xref = 'xref\n' +
    '0 4\n' +
    '0000000000 65535 f \r\n' +
    String(off1).padStart(10, '0') + ' 00000 n \r\n' +
    String(off2).padStart(10, '0') + ' 00000 n \r\n' +
    String(off3).padStart(10, '0') + ' 00000 n \r\n';

  const trailer = 'trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n' + startxref + '\n%%EOF\n';

  return Buffer.from(body + xref + trailer, 'utf8');
}

// Helper: Generates a valid DOCX buffer with paragraphs, headings, tables, and required [Content_Types].xml
function createTestDocxBuffer({
  heading1 = 'Architecture Overview',
  heading2 = 'Authentication Service',
  paraText = 'All incoming requests must provide a valid session token.',
  tableData = [['Method', 'Endpoint'], ['POST', '/api/auth/login'], ['GET', '/api/auth/me']]
} = {}) {
  const zip = new AdmZip();

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));

  let tableXml = '';
  if (tableData && tableData.length > 0) {
    tableXml = '<w:tbl>' + tableData.map(row => (
      '<w:tr>' + row.map(cell => (
        `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`
      )).join('') + '</w:tr>'
    )).join('') + '</w:tbl>';
  }

  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading1"/></w:pPr>
      <w:r><w:t>${heading1}</w:t></w:r>
    </w:p>
    <w:p>
      <w:pPr><w:pStyle w:val="Heading2"/></w:pPr>
      <w:r><w:t>${heading2}</w:t></w:r>
    </w:p>
    <w:p>
      <w:r><w:t>${paraText}</w:t></w:r>
    </w:p>
    ${tableXml}
  </w:body>
</w:document>`;

  zip.addFile('word/document.xml', Buffer.from(docXml, 'utf8'));
  return zip.toBuffer();
}

// Helper: Generates a valid XLSX buffer
async function createTestXlsxBuffer() {
  const wb = new ExcelJS.Workbook();

  // Sheet 1: Requirements
  const ws1 = wb.addWorksheet('Requirements');
  ws1.addRow(['Req ID', 'Title', 'Category', 'Priority']);
  ws1.addRow(['REQ-01', 'User Authentication', 'Security', 'CRITICAL']);
  ws1.addRow(['REQ-02', 'Profile Management', 'User', 'MEDIUM']);

  // Sheet 2: Formulas & Calculations
  const ws2 = wb.addWorksheet('Metrics');
  ws2.addRow(['Metric', 'Count', 'Score', 'Total']);
  ws2.addRow(['Tests Passed', 150, 2, { formula: 'B2*C2', result: 300 }]);

  // Sheet 3: Hidden Sheet
  const ws3 = wb.addWorksheet('InternalKeys');
  ws3.state = 'hidden';
  ws3.addRow(['SecretName', 'SecretVal']);
  ws3.addRow(['API_TOKEN', 'token-super-secret-xyz']);

  return await wb.xlsx.writeBuffer();
}

describe('AI Test Case Writer — Phase 2.4: Document Extraction & Normalization Test Suite', { concurrency: 1 }, () => {
  before(async () => {
    await runAiMigrations();

    testUserIdA = crypto.randomUUID();
    testUserIdB = crypto.randomUUID();
    testAdminUserId = crypto.randomUUID();

    // Create Project A (User A)
    const pARes = await db.query(`
      INSERT INTO ai_projects (name, slug, description, created_by_user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, ['Project Alpha Extraction', `proj-alpha-ext-${Date.now()}`, 'Extraction Testing Project A', testUserIdA]);
    testProjectAId = pARes.rows[0].id;

    // Create Project B (User B)
    const pBRes = await db.query(`
      INSERT INTO ai_projects (name, slug, description, created_by_user_id)
      VALUES ($1, $2, $3, $4)
      RETURNING id
    `, ['Project Beta Extraction', `proj-beta-ext-${Date.now()}`, 'Extraction Testing Project B', testUserIdB]);
    testProjectBId = pBRes.rows[0].id;
  });

  after(async () => {
    // Cleanup created test documents and projects
    if (createdDocIds.length > 0) {
      for (const dId of createdDocIds) {
        try {
          await documentService.deleteDocument({ projectId: testProjectAId, documentId: dId });
        } catch (_) {}
        try {
          await documentService.deleteDocument({ projectId: testProjectBId, documentId: dId });
        } catch (_) {}
      }
    }

    if (testProjectAId) {
      await db.query('DELETE FROM ai_projects WHERE id = $1', [testProjectAId]);
    }
    if (testProjectBId) {
      await db.query('DELETE FROM ai_projects WHERE id = $1', [testProjectBId]);
    }
  });

  // ==========================================================================
  // SUITE 1: Format-Specific Parsers & Source Provenance
  // ==========================================================================
  describe('1. Format Extraction & Exact Provenance', { concurrency: 1 }, () => {
    test('1.1 PDF: Extracts multi-page text preserving explicit page boundaries and 1-indexed numbers', async () => {
      const pdfPath = path.resolve(__dirname, '../../../../node_modules/pdf-parse/test/data/02-valid.pdf');
      const pdfBuf = fs.readFileSync(pdfPath);
      const result = await pdfParser.parsePdf(pdfBuf, 'specs.pdf');

      assert.equal(result.metadata.pageCount, 5);
      assert.equal(result.units.length, 5);

      // Page 1 provenance
      const p1 = result.units[0];
      assert.equal(p1.source_type, 'PAGE');
      assert.equal(p1.source_location.page_number, 1);
      assert.equal(p1.source_location_display, 'Page 1');
      assert.match(p1.extracted_text, /Performance evaluation/);

      // Page 2 provenance
      const p2 = result.units[1];
      assert.equal(p2.source_type, 'PAGE');
      assert.equal(p2.source_location.page_number, 2);
      assert.equal(p2.source_location_display, 'Page 2');
      assert.ok(p2.extracted_text.length > 0);
    });

    test('1.2 PDF: Scanned or image-only PDF flags OCR warnings without inventing text', async () => {
      const emptyPdfBuf = createEmptyScannedPdfBuffer();
      const result = await pdfParser.parsePdf(emptyPdfBuf, 'scanned.pdf');

      assert.equal(result.metadata.pageCount, 1);
      assert.ok(result.metadata.allEmpty);
      assert.ok(result.warnings.some(w => w.includes('OCR required')));
      assert.equal(result.units[0].extracted_text.trim(), '');
      assert.ok(result.units[0].unit_warnings.some(w => w.includes('OCR required')));
    });

    test('1.3 DOCX: Extracts paragraph order, heading hierarchy stack, and preserves heading context', () => {
      const docxBuf = createTestDocxBuffer({
        heading1: 'Security Architecture',
        heading2: 'OAuth Token Verification',
        paraText: 'All client requests must include a Bearer JWT.'
      });
      const result = docxParser.parseDocx(docxBuf, 'security.docx');

      assert.ok(result.units.length >= 3);

      // Heading 1
      const h1 = result.units.find(u => u.source_type === 'HEADING' && u.extracted_text === 'Security Architecture');
      assert.ok(h1);
      assert.deepEqual(h1.source_location.heading_path, ['Security Architecture']);
      assert.equal(h1.source_location_display, 'Security Architecture');

      // Heading 2
      const h2 = result.units.find(u => u.source_type === 'HEADING' && u.extracted_text === 'OAuth Token Verification');
      assert.ok(h2);
      assert.deepEqual(h2.source_location.heading_path, ['Security Architecture', 'OAuth Token Verification']);
      assert.equal(h2.source_location_display, 'Security Architecture > OAuth Token Verification');

      // Paragraph associated with active heading context
      const p = result.units.find(u => u.source_type === 'PARAGRAPH' && u.extracted_text.includes('Bearer JWT'));
      assert.ok(p);
      assert.deepEqual(p.source_location.heading_path, ['Security Architecture', 'OAuth Token Verification']);
      assert.equal(p.source_location_display, 'Security Architecture > OAuth Token Verification > Paragraph 1');
    });

    test('1.4 DOCX: Extracts tables with rows, columns, headers, and structured content', () => {
      const docxBuf = createTestDocxBuffer({
        tableData: [
          ['Status Code', 'Description', 'Action'],
          ['200', 'Success', 'Proceed'],
          ['401', 'Unauthorized', 'Redirect to login']
        ]
      });
      const result = docxParser.parseDocx(docxBuf, 'table.docx');

      const tblUnits = result.units.filter(u => u.source_type.startsWith('TABLE_'));
      assert.equal(tblUnits.length, 3);

      // Table Header row
      assert.equal(tblUnits[0].source_type, 'TABLE_HEADER');
      assert.equal(tblUnits[0].source_location.table_index, 1);
      assert.equal(tblUnits[0].source_location.row_index, 1);
      assert.equal(tblUnits[0].extracted_text, 'Status Code | Description | Action');

      // Table Data row 2
      assert.equal(tblUnits[1].source_type, 'TABLE_ROW');
      assert.equal(tblUnits[1].source_location.row_index, 2);
      assert.equal(tblUnits[1].extracted_text, '200 | Success | Proceed');
    });

    test('1.5 XLSX: Multi-sheet workbook preserves sheet order, sheet names, and row coordinates', async () => {
      const xlsxBuf = await createTestXlsxBuffer();
      const result = await xlsxParser.parseXlsx(xlsxBuf, 'test_matrix.xlsx');

      assert.equal(result.metadata.sheetCount, 3);
      assert.equal(result.metadata.sheets[0].sheetName, 'Requirements');
      assert.equal(result.metadata.sheets[1].sheetName, 'Metrics');
      assert.equal(result.metadata.sheets[2].sheetName, 'InternalKeys');

      // Check Requirements Sheet Row
      const reqRow = result.units.find(u => u.source_location.sheet_name === 'Requirements' && u.source_type === 'SHEET_ROW');
      assert.ok(reqRow);
      assert.equal(reqRow.source_location_display, "Sheet 'Requirements', Row 2");
      assert.match(reqRow.extracted_text, /Req ID: REQ-01/);
      assert.match(reqRow.extracted_text, /Category: Security/);
    });

    test('1.6 XLSX: Hidden worksheets are detected and flagged with visibility state', async () => {
      const xlsxBuf = await createTestXlsxBuffer();
      const result = await xlsxParser.parseXlsx(xlsxBuf, 'test_matrix.xlsx');

      assert.ok(result.warnings.some(w => w.includes("Worksheet 'InternalKeys'") && w.includes('hidden')));
      const hiddenUnit = result.units.find(u => u.source_location.sheet_name === 'InternalKeys');
      assert.ok(hiddenUnit);
      assert.equal(hiddenUnit.source_location.is_hidden_sheet, true);
      assert.equal(hiddenUnit.metadata.is_hidden_sheet, true);
    });

    test('1.7 XLSX: Preserves formula text and cached formula result without calculating formulas', async () => {
      const xlsxBuf = await createTestXlsxBuffer();
      const result = await xlsxParser.parseXlsx(xlsxBuf, 'test_matrix.xlsx');

      const formulaUnit = result.units.find(u => u.source_location.sheet_name === 'Metrics' && u.source_type === 'SHEET_ROW');
      assert.ok(formulaUnit);
      assert.match(formulaUnit.extracted_text, /Total: 300 \(formula: =B2\*C2, cached result: 300\)/);
      assert.ok(formulaUnit.metadata.formulas);
      assert.equal(formulaUnit.metadata.formulas.Total.formula, 'B2*C2');
      assert.equal(formulaUnit.metadata.formulas.Total.cachedResult, '300');
      assert.equal(formulaUnit.metadata.formulas.Total.wasEvaluated, false);
    });

    test('1.8 CSV: Handles UTF-8 BOM, quoted commas, escaped quotes, multiline fields, and strict CSV_ROW provenance', () => {
      const rawCsv = 'TC_ID,Summary,Expected Result\r\n' +
        'TC-101,"Login with valid username, password","User is redirected to Dashboard"\r\n' +
        'TC-102,"Quotes in ""double quotes"" field","Shows alert ""Access Granted"""\r\n' +
        'TC-103,"Multiline step:\n1. Click Pay\n2. Confirm","Payment Success"';

      const bomCsvBuf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(rawCsv, 'utf8')]);
      const result = csvParser.parseCsv(bomCsvBuf, 'test_cases.csv');

      assert.equal(result.metadata.hasBom, true);
      assert.equal(result.metadata.dataRowCount, 3);
      assert.equal(result.units.length, 4); // 1 header + 3 rows

      // Strict CSV_ROW provenance across all units
      for (const unit of result.units) {
        assert.equal(unit.source_type, 'CSV_ROW', `Expected source_type CSV_ROW but got ${unit.source_type}`);
      }
      assert.equal(result.units[0].metadata.is_header, true);
      assert.equal(result.units[0].source_location_display, 'Header (Row 1)');
      assert.equal(result.units[1].source_location_display, 'Row 2');

      // TC-101: comma inside quotes
      const tc1 = result.units[1];
      assert.equal(tc1.source_location.row_number, 2);
      assert.equal(tc1.metadata.cells['Summary'], 'Login with valid username, password');

      // TC-102: escaped quotes
      const tc2 = result.units[2];
      assert.equal(tc2.metadata.cells['Summary'], 'Quotes in "double quotes" field');

      // TC-103: multiline field
      const tc3 = result.units[3];
      assert.match(tc3.metadata.cells['Summary'], /1\. Click Pay/);
    });

    test('1.9 CSV: Delimiter auto-detection supports semicolons and tabs', () => {
      const semiCsv = 'ID;Feature;Status\r\n1;Auth;PASS\r\n2;Cart;FAIL';
      const semiRes = csvParser.parseCsv(Buffer.from(semiCsv, 'utf8'), 'semi.csv');
      assert.equal(semiRes.metadata.delimiter, ';');
      assert.equal(semiRes.units[1].metadata.cells['Feature'], 'Auth');

      const tabCsv = 'ID\tFeature\tStatus\r\n1\tAuth\tPASS\r\n2\tCart\tFAIL';
      const tabRes = csvParser.parseCsv(Buffer.from(tabCsv, 'utf8'), 'tab.tsv');
      assert.equal(tabRes.metadata.delimiter, '\t');
      assert.equal(tabRes.units[1].metadata.cells['Feature'], 'Auth');
    });

    test('1.10 TXT: Strict line preservation, line numbering, and UTF-8 BOM handling', () => {
      const text = 'First line of instructions\r\nSecond line of instructions\r\nThird line of instructions';
      const bomTxt = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]);
      const result = txtParser.parseTxt(bomTxt, 'readme.txt');

      assert.equal(result.metadata.hasBom, true);
      assert.equal(result.units.length, 3);

      assert.equal(result.units[0].source_location.line_number, 1);
      assert.equal(result.units[0].source_location_display, 'Line 1');
      assert.equal(result.units[0].extracted_text, 'First line of instructions');

      assert.equal(result.units[2].source_location.line_number, 3);
      assert.equal(result.units[2].source_location_display, 'Line 3');
      assert.equal(result.units[2].extracted_text, 'Third line of instructions');
    });
  });

  describe('2. Resource Limits & Parser Hardening', { concurrency: 1 }, () => {
    test('2.1 PDF: Page count limit enforcement rejects PDFs exceeding configured page limit', async () => {
      const pdfPath = path.resolve(__dirname, '../../../../node_modules/pdf-parse/test/data/02-valid.pdf');
      const pdfBuf = fs.readFileSync(pdfPath);
      await assert.rejects(
        async () => {
          await pdfParser.parsePdf(pdfBuf, 'large.pdf', { maxPages: 2 });
        },
        /PDF page count.*exceeds limit of 2 pages/
      );
    });

    test('2.2 PDF: Corrupt or malformed PDF buffer is rejected with CORRUPT_PDF', async () => {
      const corruptPdf = Buffer.from('%PDF-1.4 completely invalid truncated binary bytes', 'utf8');
      await assert.rejects(
        async () => {
          await pdfParser.parsePdf(corruptPdf, 'corrupt.pdf');
        },
        (err) => err.code === 'CORRUPT_PDF'
      );
    });

    test('2.3 XLSX: Worksheet count limit rejects workbooks exceeding maxWorksheets', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('S1').addRow(['A']);
      wb.addWorksheet('S2').addRow(['B']);
      const buf = await wb.xlsx.writeBuffer();

      await assert.rejects(
        async () => {
          await xlsxParser.parseXlsx(buf, 'sheets.xlsx', { maxWorksheets: 1 });
        },
        /XLSX worksheet count \(2\) exceeds limit of 1 sheets/
      );
    });

    test('2.4 DOCX: Oversized XML entry is rejected before eager processing', () => {
      const zip = new AdmZip();
      zip.addFile('word/document.xml', Buffer.alloc(5000, 'A'));
      const buf = zip.toBuffer();

      assert.throws(
        () => {
          docxParser.parseDocx(buf, 'large_part.docx', { maxXmlEntryBytes: 1000 });
        },
        /uncompressed size .* exceeds limit/
      );
    });

    test('2.5 DOCX: XXE / DTD expansion attempts are rejected as SECURITY_VIOLATION', () => {
      const zip = new AdmZip();
      const xxeXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE test [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>&xxe;</w:t></w:r></w:p></w:body>
</w:document>`;
      zip.addFile('word/document.xml', Buffer.from(xxeXml, 'utf8'));
      const buf = zip.toBuffer();

      assert.throws(
        () => {
          docxParser.parseDocx(buf, 'xxe.docx');
        },
        (err) => err.code === 'SECURITY_VIOLATION'
      );
    });

    test('2.6 DOCX: Malformed XML syntax is safely caught with MALFORMED_XML', () => {
      const zip = new AdmZip();
      const malformedXml = `<w:document><w:body><w:p><unclosed_tag></w:body></w:document>`;
      zip.addFile('word/document.xml', Buffer.from(malformedXml, 'utf8'));
      const buf = zip.toBuffer();

      assert.throws(
        () => {
          docxParser.parseDocx(buf, 'malformed.docx');
        },
        (err) => err.code === 'MALFORMED_XML'
      );
    });

    test('2.7 TXT: Invalid UTF-8 byte sequences are strictly rejected without silent replacement', () => {
      // 0xFF 0xFE are invalid in strict UTF-8
      const invalidUtf8 = Buffer.from([0xFF, 0xFE, 0x41, 0x42, 0x43]);
      assert.throws(
        () => {
          txtParser.parseTxt(invalidUtf8, 'invalid.txt');
        },
        (err) => err.code === 'UNSUPPORTED_ENCODING'
      );
    });

    test('2.8 PDF: Extracted text volume limit is enforced immediately during page extraction', async () => {
      const pdfPath = path.resolve(__dirname, '../../../../node_modules/pdf-parse/test/data/02-valid.pdf');
      const pdfBuf = fs.readFileSync(pdfPath);
      await assert.rejects(
        async () => {
          await pdfParser.parsePdf(pdfBuf, 'large_text.pdf', { maxExtractedTextBytes: 50 });
        },
        /Extracted text volume exceeds limit of 50 bytes/
      );
    });

    test('2.9 PDF: Parser execution timeout terminates extraction deterministically', async () => {
      const pdfPath = path.resolve(__dirname, '../../../../node_modules/pdf-parse/test/data/02-valid.pdf');
      const pdfBuf = fs.readFileSync(pdfPath);
      await assert.rejects(
        async () => {
          await pdfParser.parsePdf(pdfBuf, 'timeout.pdf', { timeoutMs: 20, _simulateDelayMs: 60 });
        },
        (err) => err.code === 'PARSER_TIMEOUT' && err.message.includes('PDF extraction timed out')
      );
    });

    test('2.10 PDF: Default maxPages limit is 500 pages', async () => {
      assert.equal(pdfParser.DEFAULT_LIMITS.maxPages, 500);
      assert.equal(pdfParser.DEFAULT_LIMITS.maxExtractedTextBytes, 10 * 1024 * 1024);
      assert.equal(pdfParser.DEFAULT_LIMITS.timeoutMs, 30000);
    });

    test('2.11 XLSX: Worksheet count limit rejects workbooks exceeding maxWorksheets', async () => {
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('S1').addRow(['A']);
      wb.addWorksheet('S2').addRow(['B']);
      wb.addWorksheet('S3').addRow(['C']);
      const buf = await wb.xlsx.writeBuffer();

      await assert.rejects(
        async () => {
          await xlsxParser.parseXlsx(buf, 'sheets.xlsx', { maxWorksheets: 2 });
        },
        /XLSX worksheet count \(3\) exceeds limit of 2 sheets/
      );
      assert.equal(xlsxParser.DEFAULT_LIMITS.maxWorksheets, 50);
    });

    test('2.12 XLSX: Maximum rows per worksheet limit halts processing immediately', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('DataSheet');
      ws.addRow(['H1', 'H2']);
      ws.addRow(['R1C1', 'R1C2']);
      ws.addRow(['R2C1', 'R2C2']);
      ws.addRow(['R3C1', 'R3C2']);
      const buf = await wb.xlsx.writeBuffer();

      await assert.rejects(
        async () => {
          await xlsxParser.parseXlsx(buf, 'rows.xlsx', { maxRowsPerSheet: 2 });
        },
        /Worksheet 'DataSheet' row count.*exceeds limit of 2 rows/
      );
      assert.equal(xlsxParser.DEFAULT_LIMITS.maxRowsPerSheet, 50000);
    });

    test('2.13 XLSX: Maximum columns per row limit halts processing immediately', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('WideSheet');
      ws.addRow(['C1', 'C2', 'C3', 'C4', 'C5']);
      ws.addRow(['D1', 'D2', 'D3', 'D4', 'D5']);
      const buf = await wb.xlsx.writeBuffer();

      await assert.rejects(
        async () => {
          await xlsxParser.parseXlsx(buf, 'cols.xlsx', { maxColsPerRow: 3 });
        },
        /column count \(5\) exceeds limit of 3 columns/
      );
      assert.equal(xlsxParser.DEFAULT_LIMITS.maxColsPerRow, 200);
    });

    test('2.14 XLSX: Extracted text volume limit halts extraction immediately', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('TextSheet');
      ws.addRow(['Title', 'Description']);
      ws.addRow(['Item 1', 'A'.repeat(500)]);
      const buf = await wb.xlsx.writeBuffer();

      await assert.rejects(
        async () => {
          await xlsxParser.parseXlsx(buf, 'text.xlsx', { maxExtractedTextBytes: 100 });
        },
        /Extracted text volume exceeds limit of 100 bytes/
      );
      assert.equal(xlsxParser.DEFAULT_LIMITS.maxExtractedTextBytes, 10 * 1024 * 1024);
    });

    test('2.15 XLSX: Parser execution timeout terminates extraction deterministically', async () => {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('S1');
      ws.addRow(['A', 'B']);
      const buf = await wb.xlsx.writeBuffer();

      await assert.rejects(
        async () => {
          await xlsxParser.parseXlsx(buf, 'timeout.xlsx', { timeoutMs: 20, _simulateDelayMs: 60 });
        },
        (err) => err.code === 'PARSER_TIMEOUT' && err.message.includes('XLSX extraction timed out')
      );
      assert.equal(xlsxParser.DEFAULT_LIMITS.timeoutMs, 30000);
    });
  });

  // ==========================================================================
  // SUITE 3: Extraction Service, Safe Reprocessing & Concurrency
  // ==========================================================================
  describe('3. Extraction Service Lifecycle, Safe Reprocessing & Concurrency', { concurrency: 1 }, () => {
    let testDoc = null;

    before(async () => {
      const docxBuf = createTestDocxBuffer({
        heading1: 'Requirements Document',
        paraText: 'System must handle 1000 concurrent users.'
      });
      testDoc = await documentService.uploadDocument({
        projectId: testProjectAId,
        userId: testUserIdA,
        fileBuffer: docxBuf,
        originalFilename: 'requirements_v1.docx',
        title: 'Requirements Spec'
      });
      createdDocIds.push(testDoc.id);
    });

    test('3.1 Initial extraction execution persists normalized units and marks is_active = TRUE', async () => {
      // Trigger extraction
      const initJob = await extractionService.extractDocumentVersion({
        projectId: testProjectAId,
        documentId: testDoc.id,
        versionId: testDoc.active_version_id,
        userId: testUserIdA
      });

      assert.equal(initJob.status, 'PROCESSING');

      // Wait briefly for asynchronous in-process pipeline to complete
      await new Promise(r => setTimeout(r, 600));

      const status = await extractionService.getExtractionStatus({
        projectId: testProjectAId,
        documentId: testDoc.id,
        versionId: testDoc.active_version_id
      });

      assert.equal(status.status, 'COMPLETED');
      assert.equal(status.is_active, true);
      assert.equal(status.attempt_number, 1);
      assert.ok(status.total_units > 0);

      const unitsData = await extractionService.getExtractedUnits({
        projectId: testProjectAId,
        documentId: testDoc.id,
        versionId: testDoc.active_version_id,
        page: 1,
        pageSize: 10
      });

      assert.ok(unitsData.units.length > 0);
      assert.equal(unitsData.extraction.status, 'COMPLETED');
    });

    test('3.2 Duplicate concurrent extraction on same version is rejected (409 Conflict)', async () => {
      // Simulate an active in-flight extraction by adding versionId to in-flight set
      extractionService.activeInFlightExtractions.add(testDoc.active_version_id);

      await assert.rejects(
        async () => {
          await extractionService.extractDocumentVersion({
            projectId: testProjectAId,
            documentId: testDoc.id,
            versionId: testDoc.active_version_id,
            userId: testUserIdA
          });
        },
        (err) => err.status === 409 && err.code === 'EXTRACTION_IN_PROGRESS'
      );

      extractionService.activeInFlightExtractions.delete(testDoc.active_version_id);
    });

    test('3.3 Safe Reprocessing: Failed attempt DOES NOT destroy previous successful units', async () => {
      // 1. Verify Attempt 1 units exist and are active
      const beforeUnits = await extractionService.getExtractedUnits({
        projectId: testProjectAId,
        documentId: testDoc.id,
        versionId: testDoc.active_version_id
      });
      assert.ok(beforeUnits.units.length > 0);
      const originalUnitCount = beforeUnits.units.length;

      // 2. Temporarily break dispatch parser to simulate an extraction failure during reprocessing
      const originalDispatch = extractionService.dispatchParser;
      extractionService.dispatchParser = async () => {
        throw new Error('Simulated parser crash during reprocessing.');
      };

      try {
        const reprocessJob = await extractionService.extractDocumentVersion({
          projectId: testProjectAId,
          documentId: testDoc.id,
          versionId: testDoc.active_version_id,
          userId: testUserIdA,
          isReprocess: true
        });

        assert.equal(reprocessJob.attemptNumber, 2);

        // Wait for failed pipeline
        await new Promise(r => setTimeout(r, 400));
      } finally {
        extractionService.dispatchParser = originalDispatch;
      }

      // 3. Verify Attempt 1 remains ACTIVE and its units are completely preserved!
      const afterUnits = await extractionService.getExtractedUnits({
        projectId: testProjectAId,
        documentId: testDoc.id,
        versionId: testDoc.active_version_id
      });

      assert.equal(afterUnits.units.length, originalUnitCount, 'Failed reprocessing must NOT erase previous successful units');
      assert.equal(afterUnits.extraction.status, 'COMPLETED');

      // Check DB: Attempt 2 is recorded as FAILED without touching Attempt 1 is_active
      const attemptsRes = await db.query(`
        SELECT attempt_number, status, is_active, error_message
        FROM ai_document_extractions
        WHERE version_id = $1
        ORDER BY attempt_number ASC
      `, [testDoc.active_version_id]);

      assert.equal(attemptsRes.rows.length, 2);
      assert.equal(attemptsRes.rows[0].attempt_number, 1);
      assert.equal(attemptsRes.rows[0].status, 'COMPLETED');
      assert.equal(attemptsRes.rows[0].is_active, true);

      assert.equal(attemptsRes.rows[1].attempt_number, 2);
      assert.equal(attemptsRes.rows[1].status, 'FAILED');
      assert.equal(attemptsRes.rows[1].is_active, false);
      assert.match(attemptsRes.rows[1].error_message, /Simulated parser crash/);
    });

    test('3.4 Safe Reprocessing: Successful attempt replaces active units transactionally', async () => {
      // Reprocess with working parser
      const reprocessJob = await extractionService.extractDocumentVersion({
        projectId: testProjectAId,
        documentId: testDoc.id,
        versionId: testDoc.active_version_id,
        userId: testUserIdA,
        isReprocess: true
      });

      assert.equal(reprocessJob.attemptNumber, 3);
      await new Promise(r => setTimeout(r, 600));

      // Attempt 3 should now be COMPLETED and is_active = TRUE
      const status = await extractionService.getExtractionStatus({
        projectId: testProjectAId,
        documentId: testDoc.id,
        versionId: testDoc.active_version_id
      });

      assert.equal(status.status, 'COMPLETED');
      assert.equal(status.is_active, true);
      assert.equal(status.attempt_number, 3);

      // Verify single active constraint in database
      const activeCountRes = await db.query(`
        SELECT count(*) as count FROM ai_document_extractions
        WHERE version_id = $1 AND is_active = TRUE
      `, [testDoc.active_version_id]);
      assert.equal(parseInt(activeCountRes.rows[0].count, 10), 1);
    });

    test('3.5 Stale PROCESSING recovery heals interrupted extractions safely', async () => {
      // Create a dedicated version record so it cannot conflict with any in-flight extraction
      const dummyVersionRes = await db.query(`
        INSERT INTO ai_document_versions (
          document_id, version_number, storage_path,
          file_size_bytes, sha256_hash, uploaded_by_user_id
        ) VALUES ($1, 99, 'mock/path', 10, 'mockhash99', $2)
        RETURNING id
      `, [testDoc.id, testUserIdA]);
      const dummyVersionId = dummyVersionRes.rows[0].id;
      const dummyExtractionId = crypto.randomUUID();

      // Insert mock stale extraction with last_heartbeat_at 5 minutes ago
      await db.query(`
        INSERT INTO ai_document_extractions (
          id, version_id, document_id, project_id, status, is_active,
          attempt_number, started_at, last_heartbeat_at
        ) VALUES ($1, $2, $3, $4, 'PROCESSING', FALSE, 99, NOW() - interval '5 minutes', NOW() - interval '5 minutes')
      `, [dummyExtractionId, dummyVersionId, testDoc.id, testProjectAId]);

      // Run recovery
      const recovered = await extractionService.recoverStaleExtractions(60000); // 1 minute threshold
      assert.ok(recovered.some(r => r.id === dummyExtractionId));

      const check = await db.query('SELECT status, error_message FROM ai_document_extractions WHERE id = $1', [dummyExtractionId]);
      assert.equal(check.rows[0].status, 'FAILED');
      assert.match(check.rows[0].error_message, /ExtractionInterrupted/);

      // Clean up mock rows
      await db.query('DELETE FROM ai_document_extractions WHERE id = $1', [dummyExtractionId]);
      await db.query('DELETE FROM ai_document_versions WHERE id = $1', [dummyVersionId]);
    });

    test('3.6 Active in-flight extraction is NOT marked stale by recovery check', async () => {
      const dummyExtractionId = crypto.randomUUID();
      const inFlightVersionId = testDoc.active_version_id;

      // Register this version as actively in flight in memory
      extractionService.activeInFlightExtractions.add(inFlightVersionId);

      try {
        // Insert mock extraction whose heartbeat is old
        await db.query(`
          INSERT INTO ai_document_extractions (
            id, version_id, document_id, project_id, status, is_active,
            attempt_number, started_at, last_heartbeat_at
          ) VALUES ($1, $2, $3, $4, 'PROCESSING', FALSE, 98, NOW() - interval '10 minutes', NOW() - interval '10 minutes')
        `, [dummyExtractionId, inFlightVersionId, testDoc.id, testProjectAId]);

        // Run recovery with 1-minute threshold
        const recovered = await extractionService.recoverStaleExtractions(60000);
        // It must NOT recover this extraction because it is in activeInFlightExtractions!
        assert.ok(!recovered.some(r => r.id === dummyExtractionId));

        const check = await db.query('SELECT status FROM ai_document_extractions WHERE id = $1', [dummyExtractionId]);
        assert.equal(check.rows[0].status, 'PROCESSING');
      } finally {
        extractionService.activeInFlightExtractions.delete(inFlightVersionId);
        await db.query('DELETE FROM ai_document_extractions WHERE id = $1', [dummyExtractionId]);
      }
    });

    test('3.7 Stale attempt marked FAILED can be explicitly retried preserving active extraction', async () => {
      // 1. Create a version with an active extraction attempt 1
      const checkActive = await db.query(`
        SELECT id, attempt_number, status, is_active
        FROM ai_document_extractions
        WHERE version_id = $1 AND is_active = TRUE
      `, [testDoc.active_version_id]);
      assert.ok(checkActive.rows.length > 0);
      const activeExtraction = checkActive.rows[0];

      // 2. Simulate an interrupted attempt by inserting a stale PROCESSING record
      const staleExtractionId = crypto.randomUUID();
      await db.query(`
        INSERT INTO ai_document_extractions (
          id, version_id, document_id, project_id, status, is_active,
          attempt_number, started_at, last_heartbeat_at
        ) VALUES ($1, $2, $3, $4, 'PROCESSING', FALSE, 4, NOW() - interval '10 minutes', NOW() - interval '10 minutes')
      `, [staleExtractionId, testDoc.active_version_id, testDoc.id, testProjectAId]);

      // 3. Sweep stale jobs
      await extractionService.recoverStaleExtractions(60000);
      const staleCheck = await db.query('SELECT status, error_message FROM ai_document_extractions WHERE id = $1', [staleExtractionId]);
      assert.equal(staleCheck.rows[0].status, 'FAILED');

      // Verify previous active extraction remains active and untouched
      const stillActive = await db.query('SELECT id, is_active FROM ai_document_extractions WHERE id = $1', [activeExtraction.id]);
      assert.equal(stillActive.rows[0].is_active, true);

      // 4. Client explicitly triggers retry via isReprocess: true
      const retryJob = await extractionService.extractDocumentVersion({
        projectId: testProjectAId,
        documentId: testDoc.id,
        versionId: testDoc.active_version_id,
        userId: testUserIdA,
        isReprocess: true
      });
      assert.equal(retryJob.attemptNumber, 5);

      await new Promise(r => setTimeout(r, 600));

      // Attempt 5 finishes COMPLETED and becomes active
      const finalStatus = await extractionService.getExtractionStatus({
        projectId: testProjectAId,
        documentId: testDoc.id,
        versionId: testDoc.active_version_id
      });
      assert.equal(finalStatus.status, 'COMPLETED');
      assert.equal(finalStatus.attempt_number, 5);
      assert.equal(finalStatus.is_active, true);
    });
  });

  // ==========================================================================
  // SUITE 4: Option B Project Isolation & Multi-Tenancy Matrix
  // ==========================================================================
  describe('4. Option B Authorization Matrix & Multi-Project Isolation', { concurrency: 1 }, () => {
    let docA = null;
    let docB = null;

    before(async () => {
      // Create Doc in Project A (User A)
      const txtA = Buffer.from('Project A Sensitive Requirements', 'utf8');
      docA = await documentService.uploadDocument({
        projectId: testProjectAId,
        userId: testUserIdA,
        fileBuffer: txtA,
        originalFilename: 'project_a.txt'
      });
      createdDocIds.push(docA.id);

      // Trigger extraction for docA (v1)
      await extractionService.extractDocumentVersion({
        projectId: testProjectAId,
        documentId: docA.id,
        versionId: docA.active_version_id,
        userId: testUserIdA
      });

      // Create Doc in Project B (User B)
      const txtB = Buffer.from('Project B Proprietary Matrix', 'utf8');
      docB = await documentService.uploadDocument({
        projectId: testProjectBId,
        userId: testUserIdB,
        fileBuffer: txtB,
        originalFilename: 'project_b.txt'
      });
      createdDocIds.push(docB.id);

      // Trigger extraction for docB
      await extractionService.extractDocumentVersion({
        projectId: testProjectBId,
        documentId: docB.id,
        versionId: docB.active_version_id,
        userId: testUserIdB
      });

      // Wait for background extraction
      await new Promise(r => setTimeout(r, 600));
    });

    test('4.1 Version Isolation: Different versions retain separate, isolated extraction results', async () => {
      // Upload Version 2 for Doc A
      const txtA2 = Buffer.from('Project A Version 2 Updated Requirements\nLine Two', 'utf8');
      const docA_v2 = await documentService.createDocumentVersion({
        projectId: testProjectAId,
        documentId: docA.id,
        userId: testUserIdA,
        fileBuffer: txtA2,
        originalFilename: 'project_a_v2.txt',
        changeSummary: 'Second version'
      });

      // Trigger extraction for docA v2
      await extractionService.extractDocumentVersion({
        projectId: testProjectAId,
        documentId: docA.id,
        versionId: docA_v2.active_version_id,
        userId: testUserIdA
      });

      // Wait for V2 extraction
      await new Promise(r => setTimeout(r, 600));

      const v1Status = await extractionService.getExtractionStatus({
        projectId: testProjectAId,
        documentId: docA.id,
        versionId: docA.active_version_id // Original version 1 ID before update
      });

      const v2Status = await extractionService.getExtractionStatus({
        projectId: testProjectAId,
        documentId: docA.id,
        versionId: docA_v2.active_version_id
      });

      assert.notEqual(v1Status.version_id, v2Status.version_id);
      assert.equal(v1Status.status, 'COMPLETED');
      assert.equal(v2Status.status, 'COMPLETED');
      assert.equal(v1Status.total_units, 1);
      assert.equal(v2Status.total_units, 2);
    });

    test('4.2 Project Isolation: Cross-project access is strictly rejected', async () => {
      // Attempting to query Project A document extraction from Project B throws 404
      await assert.rejects(
        async () => {
          await extractionService.getExtractionStatus({
            projectId: testProjectBId, // Project B context
            documentId: docA.id,      // Project A document
            versionId: docA.active_version_id
          });
        },
        /Document version not found in specified project/
      );

      await assert.rejects(
        async () => {
          await extractionService.getExtractedUnits({
            projectId: testProjectBId,
            documentId: docA.id,
            versionId: docA.active_version_id
          });
        },
        /Document version not found in specified project/
      );
    });

    test('4.3 Paginated Extracted Units query supports search and source_type filtering', async () => {
      const unitsRes = await extractionService.getExtractedUnits({
        projectId: testProjectAId,
        documentId: docA.id,
        versionId: docA.active_version_id,
        page: 1,
        pageSize: 10,
        search: 'Sensitive'
      });

      assert.ok(unitsRes.units.length > 0);
      assert.match(unitsRes.units[0].extracted_text, /Sensitive/);

      const noMatchRes = await extractionService.getExtractedUnits({
        projectId: testProjectAId,
        documentId: docA.id,
        versionId: docA.active_version_id,
        page: 1,
        pageSize: 10,
        search: 'NonExistentString123'
      });
      assert.equal(noMatchRes.units.length, 0);
    });
  });

  // ==========================================================================
  // SUITE 5: Extraction Hierarchy Integrity & Composite Constraints
  // ==========================================================================
  describe('5. Extraction Hierarchy Integrity & Composite Constraints', { concurrency: 1 }, () => {
    let baseExt = null;
    let otherProjId = null;
    let otherDocId = null;
    let otherVersionId = null;

    before(async () => {
      // Fetch an existing valid extraction record from Project A
      const extRes = await db.query(`
        SELECT id, version_id, document_id, project_id
        FROM ai_document_extractions
        WHERE project_id = $1
        LIMIT 1
      `, [testProjectAId]);
      baseExt = extRes.rows[0];

      // Create an isolated secondary project, document, and version for negative tests
      const pRes = await db.query(`
        INSERT INTO ai_projects (name, slug, created_by_user_id)
        VALUES ('Other Proj', $1, $2)
        RETURNING id
      `, [`other-proj-hier-${Date.now()}`, testUserIdB]);
      otherProjId = pRes.rows[0].id;

      const dRes = await db.query(`
        INSERT INTO ai_documents (project_id, title, original_filename, document_type, created_by_user_id)
        VALUES ($1, 'Other Title', 'other.txt', 'TXT', $2)
        RETURNING id
      `, [otherProjId, testUserIdB]);
      otherDocId = dRes.rows[0].id;

      const vRes = await db.query(`
        INSERT INTO ai_document_versions (
          document_id, version_number, storage_path,
          file_size_bytes, sha256_hash, uploaded_by_user_id
        ) VALUES ($1, 1, 'mock/path', 10, 'mockhash', $2)
        RETURNING id
      `, [otherDocId, testUserIdB]);
      otherVersionId = vRes.rows[0].id;
    });

    after(async () => {
      if (otherProjId) {
        await db.query('DELETE FROM ai_projects WHERE id = $1', [otherProjId]);
      }
    });

    test('5.1 Negative: Inserting unit with mismatched version_id fails composite FK', async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO ai_document_extracted_units (
              extraction_id, version_id, document_id, project_id,
              sequence_number, source_type, source_location, source_location_display, extracted_text
            ) VALUES ($1, $2, $3, $4, 9991, 'PARAGRAPH', '{}', 'Test Loc', 'Sample Text')
          `, [baseExt.id, otherVersionId, baseExt.document_id, baseExt.project_id]);
        },
        (err) => err.code === '23503' && err.constraint === 'fk_ai_unit_extraction_hierarchy'
      );
    });

    test('5.2 Negative: Inserting unit with mismatched document_id fails composite FK', async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO ai_document_extracted_units (
              extraction_id, version_id, document_id, project_id,
              sequence_number, source_type, source_location, source_location_display, extracted_text
            ) VALUES ($1, $2, $3, $4, 9992, 'PARAGRAPH', '{}', 'Test Loc', 'Sample Text')
          `, [baseExt.id, baseExt.version_id, otherDocId, baseExt.project_id]);
        },
        (err) => err.code === '23503' && (err.constraint === 'fk_ai_unit_extraction_hierarchy' || err.constraint === 'fk_unit_doc_proj')
      );
    });

    test('5.3 Negative: Inserting unit with mismatched project_id fails composite FK', async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO ai_document_extracted_units (
              extraction_id, version_id, document_id, project_id,
              sequence_number, source_type, source_location, source_location_display, extracted_text
            ) VALUES ($1, $2, $3, $4, 9993, 'PARAGRAPH', '{}', 'Test Loc', 'Sample Text')
          `, [baseExt.id, baseExt.version_id, baseExt.document_id, otherProjId]);
        },
        (err) => err.code === '23503' && (err.constraint === 'fk_ai_unit_extraction_hierarchy' || err.constraint === 'fk_unit_doc_proj')
      );
    });

    test('5.4 Negative: Inserting unit with invalid source_type fails check constraint', async () => {
      await assert.rejects(
        async () => {
          await db.query(`
            INSERT INTO ai_document_extracted_units (
              extraction_id, version_id, document_id, project_id,
              sequence_number, source_type, source_location, source_location_display, extracted_text
            ) VALUES ($1, $2, $3, $4, 9994, 'INVALID_TYPE', '{}', 'Test Loc', 'Sample Text')
          `, [baseExt.id, baseExt.version_id, baseExt.document_id, baseExt.project_id]);
        },
        (err) => err.code === '23514' && err.constraint === 'chk_ai_unit_source_type'
      );
    });

    test('5.5 Positive: Inserting unit with valid matching hierarchy and CSV_ROW source_type succeeds', async () => {
      const insRes = await db.query(`
        INSERT INTO ai_document_extracted_units (
          extraction_id, version_id, document_id, project_id,
          sequence_number, source_type, source_location, source_location_display, extracted_text
        ) VALUES ($1, $2, $3, $4, 9995, 'CSV_ROW', '{"row": 1}', 'Row 1', 'Test,CSV,Unit')
        RETURNING id, source_type
      `, [baseExt.id, baseExt.version_id, baseExt.document_id, baseExt.project_id]);

      assert.equal(insRes.rows.length, 1);
      assert.equal(insRes.rows[0].source_type, 'CSV_ROW');

      // Clean up test unit
      await db.query('DELETE FROM ai_document_extracted_units WHERE id = $1', [insRes.rows[0].id]);
    });
  });
});
