const AdmZip = require('adm-zip');

/**
 * Custom clean XLSX parser using adm-zip and native XML parsing.
 * Eliminates external npm dependency issues while parsing Excel (.xlsx) workbooks cleanly.
 */
class ExcelWorkbookParser {
  /**
   * Parse XLSX buffer into structured sheet data.
   * @param {Buffer} buffer - Raw file buffer of .xlsx file
   * @returns {{ sheets: Array<{ name: string, rows: Array<Array<string>> }> }}
   */
  static parse(buffer) {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new Error('Invalid workbook buffer: file must be a non-empty Buffer');
    }

    let zip;
    try {
      zip = new AdmZip(buffer);
    } catch (err) {
      throw new Error(`Failed to read Excel workbook: invalid zip archive (${err.message})`);
    }

    // 1. Read shared strings
    const sharedStrings = [];
    const sstEntry = zip.getEntry('xl/sharedStrings.xml');
    if (sstEntry) {
      const sstXml = sstEntry.getData().toString('utf8');
      // Matches <si>...<t xml:space="preserve">val</t>...</si> or multiple <t> inside <si>
      const siMatches = sstXml.match(/<si\b[\s\S]*?<\/si>/gi) || [];
      for (const si of siMatches) {
        // Collect all <t> or <t ...> content inside this <si>
        const tMatches = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi) || [];
        let fullStr = '';
        for (const t of tMatches) {
          const content = t.replace(/<t(?:\s[^>]*)?>/i, '').replace(/<\/t>/i, '');
          fullStr += decodeXmlEntities(content);
        }
        sharedStrings.push(fullStr);
      }
    }

    // 2. Read workbook.xml for sheet names and r:id
    const wbEntry = zip.getEntry('xl/workbook.xml');
    if (!wbEntry) {
      throw new Error('Invalid Excel file: missing xl/workbook.xml');
    }
    const wbXml = wbEntry.getData().toString('utf8');

    // Read relationships (xl/_rels/workbook.xml.rels) to resolve sheet rId to target filename
    const relsMap = new Map();
    const relsEntry = zip.getEntry('xl/_rels/workbook.xml.rels');
    if (relsEntry) {
      const relsXml = relsEntry.getData().toString('utf8');
      const relMatches = relsXml.match(/<Relationship\b[\s\S]*?\/>/gi) || [];
      for (const rel of relMatches) {
        const idMatch = rel.match(/Id="([^"]+)"/i);
        const targetMatch = rel.match(/Target="([^"]+)"/i);
        if (idMatch && targetMatch) {
          let target = targetMatch[1];
          if (!target.startsWith('xl/') && !target.startsWith('/')) {
            target = 'xl/' + target;
          } else if (target.startsWith('/')) {
            target = target.substring(1);
          }
          relsMap.set(idMatch[1], target);
        }
      }
    }

    // Parse sheet definitions in workbook.xml
    const sheetDefs = [];
    const sheetMatches = wbXml.match(/<sheet\b[\s\S]*?\/>/gi) || [];
    for (let i = 0; i < sheetMatches.length; i++) {
      const sMatch = sheetMatches[i];
      const nameMatch = sMatch.match(/name="([^"]+)"/i);
      const rIdMatch = sMatch.match(/r:id="([^"]+)"/i);
      const sheetName = nameMatch ? decodeXmlEntities(nameMatch[1]) : `Sheet${i + 1}`;
      const rId = rIdMatch ? rIdMatch[1] : null;
      let targetFile = relsMap.get(rId);
      if (!targetFile) {
        targetFile = `xl/worksheets/sheet${i + 1}.xml`;
      }
      sheetDefs.push({ name: sheetName, targetFile });
    }

    // 3. Parse each sheet
    const sheets = [];
    for (const def of sheetDefs) {
      const sheetEntry = zip.getEntry(def.targetFile);
      if (!sheetEntry) continue;

      const sheetXml = sheetEntry.getData().toString('utf8');
      const rows = parseSheetXml(sheetXml, sharedStrings);
      sheets.push({
        name: def.name,
        rows
      });
    }

    if (sheets.length === 0) {
      throw new Error('Workbook contains no readable worksheets');
    }

    return { sheets };
  }
}

/**
 * Decode XML entities
 */
function decodeXmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(dec))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Convert column letters (A, B, AA) to 0-based column index
 */
function colLettersToIndex(letters) {
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

/**
 * Parse worksheet XML into 2D grid of string cells
 */
function parseSheetXml(sheetXml, sharedStrings) {
  const rows = [];
  const rowMatches = sheetXml.match(/<row\b[\s\S]*?<\/row>/gi) || [];

  for (const rXml of rowMatches) {
    const rowNumMatch = rXml.match(/r="(\d+)"/i);
    const rowIndex = rowNumMatch ? parseInt(rowNumMatch[1], 10) - 1 : rows.length;

    const rowCells = [];
    const cellMatches = rXml.match(/<c\b[\s\S]*?<\/c>|<c\b[^>]*\/>/gi) || [];

    for (const cXml of cellMatches) {
      // Cell ref e.g. r="B4"
      const rMatch = cXml.match(/r="([A-Z]+)(\d+)"/i);
      let colIndex = rowCells.length;
      if (rMatch) {
        colIndex = colLettersToIndex(rMatch[1]);
      }

      // Cell type: t="s" (shared string), t="b" (boolean), t="str" (inline formula string), etc.
      const typeMatch = cXml.match(/t="([^"]+)"/i);
      const cellType = typeMatch ? typeMatch[1] : 'n'; // default number

      // Cell value <v>...</v> or inline string <is><t>...</t></is>
      let value = '';
      const vMatch = cXml.match(/<v>([\s\S]*?)<\/v>/i);
      const inlineMatch = cXml.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/i);

      if (inlineMatch) {
        value = decodeXmlEntities(inlineMatch[1]);
      } else if (vMatch) {
        const rawV = vMatch[1].trim();
        if (cellType === 's') {
          const sIndex = parseInt(rawV, 10);
          value = sharedStrings[sIndex] !== undefined ? sharedStrings[sIndex] : rawV;
        } else if (cellType === 'b') {
          value = rawV === '1' ? 'true' : 'false';
        } else {
          value = decodeXmlEntities(rawV);
        }
      }

      // Pad array if sparse
      while (rowCells.length < colIndex) {
        rowCells.push('');
      }
      rowCells[colIndex] = value;
    }

    // Fill row into rows array
    while (rows.length < rowIndex) {
      rows.push([]);
    }
    rows[rowIndex] = rowCells;
  }

  return rows;
}

module.exports = ExcelWorkbookParser;
