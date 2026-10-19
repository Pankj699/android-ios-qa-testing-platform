const crypto = require('crypto');
const ExcelWorkbookParser = require('../utils/excelWorkbookParser');
const logger = require('../utils/logger');

/**
 * Service to parse uploaded Excel workbooks, extract events and parameter definitions,
 * structure specifications, and compute validation rules.
 */
class MixpanelSpecificationService {
  /**
   * Parse workbook buffer and return structured specification preview/result.
   * @param {Buffer} buffer - Excel workbook buffer
   * @param {string} originalFilename
   * @returns {object} { name, fileHash, sheetsSummary, eventsCount, rules, warnings, errors }
   */
  static parseWorkbook(buffer, originalFilename = 'specification.xlsx') {
    if (!buffer || !Buffer.isBuffer(buffer)) {
      throw new Error('Workbook buffer is required');
    }

    const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const { sheets } = ExcelWorkbookParser.parse(buffer);

    const warnings = [];
    const errors = [];
    const eventMap = new Map(); // normalizedEventName -> { eventName, sheetName, attributes: Map<attrName, attrRule> }

    const sheetsSummary = [];

    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      if (rows.length === 0) continue;

      let sheetEventsFound = 0;
      let headerRowIndex = -1;
      let eventColIndex = -1;
      let paramColIndex = -1;
      let typeColIndex = -1;
      let valColIndex = -1;
      let descColIndex = -1;

      // Scan first 15 rows to find header columns
      for (let r = 0; r < Math.min(rows.length, 15); r++) {
        const row = rows[r] || [];
        for (let c = 0; c < row.length; c++) {
          const cell = (row[c] || '').toString().trim().toLowerCase();
          if (
            cell === 'event name' ||
            cell === 'event_name' ||
            cell === 'event' ||
            cell === 'events' ||
            cell.includes('event name')
          ) {
            headerRowIndex = r;
            eventColIndex = c;
          } else if (
            cell === 'parameter' ||
            cell === 'parameters' ||
            cell === 'attributes' ||
            cell === 'properties' ||
            cell === 'event properties' ||
            cell === 'params' ||
            cell.includes('parameter')
          ) {
            paramColIndex = c;
          } else if (cell === 'type' || cell === 'data type' || cell === 'datatype') {
            typeColIndex = c;
          } else if (cell === 'expected value' || cell === 'expected values' || cell === 'values' || cell === 'sample value') {
            valColIndex = c;
          } else if (cell === 'description' || cell === 'notes' || cell === 'desc') {
            descColIndex = c;
          }
        }
        if (eventColIndex !== -1 && paramColIndex !== -1) {
          break;
        }
      }

      // If no explicit header was found, fallback to Column 0 = Event, Column 1 = Parameters
      const startRow = headerRowIndex !== -1 ? headerRowIndex + 1 : 0;
      const actualEventCol = eventColIndex !== -1 ? eventColIndex : 0;
      const actualParamCol = paramColIndex !== -1 ? paramColIndex : (rows[0] && rows[0].length > 1 ? 1 : -1);

      let currentEventName = null;

      for (let r = startRow; r < rows.length; r++) {
        const row = rows[r] || [];
        const rawEventCell = (row[actualEventCol] !== undefined ? row[actualEventCol] : '').toString().trim();
        const rawParamCell = (actualParamCol !== -1 && row[actualParamCol] !== undefined ? row[actualParamCol] : '').toString().trim();
        const rawTypeCell = (typeColIndex !== -1 && row[typeColIndex] !== undefined ? row[typeColIndex] : '').toString().trim();
        const rawValCell = (valColIndex !== -1 && row[valColIndex] !== undefined ? row[valColIndex] : '').toString().trim();
        const rawDescCell = (descColIndex !== -1 && row[descColIndex] !== undefined ? row[descColIndex] : '').toString().trim();

        // Check if event name changes on this row
        if (rawEventCell) {
          // Clean event name
          const cleanName = cleanIdentifier(rawEventCell);
          if (cleanName) {
            currentEventName = cleanName;
            sheetEventsFound++;
            if (!eventMap.has(currentEventName)) {
              eventMap.set(currentEventName, {
                eventName: currentEventName,
                sheetName: sheet.name,
                sourceRow: r + 1,
                attributes: new Map()
              });
            }
          }
        }

        // If we have an active event, parse parameters
        if (currentEventName && rawParamCell) {
          const eventEntry = eventMap.get(currentEventName);
          const parsedAttributes = extractAttributes(rawParamCell, rawTypeCell, rawValCell, rawDescCell);

          for (const attr of parsedAttributes) {
            if (!eventEntry.attributes.has(attr.name)) {
              eventEntry.attributes.set(attr.name, attr);
            } else {
              // Duplicate attribute in same event - record warning
              warnings.push(`Sheet "${sheet.name}" Row ${r + 1}: Duplicate attribute "${attr.name}" in event "${currentEventName}".`);
            }
          }
        }
      }

      sheetsSummary.push({
        name: sheet.name,
        totalRows: rows.length,
        eventsCount: sheetEventsFound
      });
    }

    if (eventMap.size === 0) {
      throw new Error('No valid events could be parsed from the workbook. Please ensure the Excel sheet contains an "Event Name" column.');
    }

    // Convert map to serializable JSON rules array
    const rules = [];
    for (const [eventName, data] of eventMap.entries()) {
      const attributes = Array.from(data.attributes.values());
      rules.push({
        eventName: data.eventName,
        sheetName: data.sheetName,
        sourceRow: data.sourceRow,
        attributesCount: attributes.length,
        attributes,
        parameters: attributes
      });
    }

    // Sort alphabetically by eventName
    rules.sort((a, b) => a.eventName.localeCompare(b.eventName));

    const nameWithoutExt = originalFilename.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
    const specName = nameWithoutExt.charAt(0).toUpperCase() + nameWithoutExt.slice(1);

    return {
      name: specName,
      originalFilename,
      fileHash,
      sheetsSummary,
      eventsCount: rules.length,
      rules,
      warnings,
      errors
    };
  }
}

/**
 * Clean and normalize identifier (event or parameter name)
 */
function cleanIdentifier(str) {
  if (!str) return '';
  // Remove numbering like "1. ", "1) ", bullet points, markdown bold/code markers
  let cleaned = str
    .replace(/^[\s\d.)\-*•]+/, '')
    .replace(/[`*]/g, '')
    .trim();
  // If multiline was passed to event cell, take first non-empty line
  if (cleaned.includes('\n')) {
    cleaned = cleaned.split('\n')[0].trim();
  }
  return cleaned;
}

/**
 * Extract parameter attributes from cell text.
 * Supports:
 * - Multiline entries (e.g. "param1\nparam2\nparam3")
 * - Numbered/bulleted lists ("1. is_pro_user\n2. app_open_count")
 * - Comma-separated or semicolon-separated entries
 * - Key-value formats e.g. "tool_name: string" or "is_from (e.g. 'home', 'settings')"
 */
function extractAttributes(rawParamText, rawType = '', rawExpectedVal = '', rawDesc = '') {
  if (!rawParamText) return [];

  const lines = rawParamText
    .split(/[\r\n,;]+/)
    .map(l => l.trim())
    .filter(Boolean);

  const attributes = [];

  for (const line of lines) {
    // Remove list prefixes: "1. ", "1) ", "- ", "• "
    let item = line.replace(/^[\s\d.)\-*•]+/, '').trim();
    if (!item) continue;

    let attrName = item;
    let expectedType = rawType ? rawType.toLowerCase() : null;
    let expectedValue = rawExpectedVal ? rawExpectedVal : null;
    let description = rawDesc || '';

    // Check for "attrName: type" or "attrName (type)"
    const typeColonMatch = item.match(/^([a-zA-Z0-9_.-]+)\s*:\s*([a-zA-Z0-9_|[\]]+)(?:\s*=\s*(.*))?$/);
    if (typeColonMatch) {
      attrName = typeColonMatch[1].trim();
      expectedType = typeColonMatch[2].trim().toLowerCase();
      if (typeColonMatch[3]) expectedValue = typeColonMatch[3].trim();
    } else {
      const parenMatch = item.match(/^([a-zA-Z0-9_.-]+)\s*\(([^)]+)\)$/);
      if (parenMatch) {
        attrName = parenMatch[1].trim();
        const inner = parenMatch[2].trim();
        if (['string', 'number', 'boolean', 'int', 'float', 'array', 'object', 'json'].includes(inner.toLowerCase())) {
          expectedType = inner.toLowerCase();
        } else {
          description = inner;
        }
      } else {
        // Just the name, e.g. "is_pro_user"
        const spaceMatch = item.match(/^([a-zA-Z0-9_.-]+)/);
        if (spaceMatch) {
          attrName = spaceMatch[1].trim();
          const remainder = item.substring(attrName.length).trim();
          if (remainder) {
            description = remainder.replace(/^[:\-=]/, '').trim();
          }
        }
      }
    }

    if (attrName) {
      attributes.push({
        name: attrName,
        required: true,
        expectedType: expectedType || null,
        type: expectedType || null,
        expectedValue: expectedValue || null,
        value: expectedValue || null,
        description: description || null
      });
    }
  }

  return attributes;
}

module.exports = MixpanelSpecificationService;
