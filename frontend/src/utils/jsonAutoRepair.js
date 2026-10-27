/**
 * Safe, Deterministic JSON Auto Repair & Syntax Diagnostics Utility
 *
 * Implements token-aware syntax analysis and conservative auto-repair
 * without external dependencies, unsafe eval, or AI services.
 *
 * Guaranteed Safety Rules:
 * - Never guesses business values (e.g. dangling keys like "weekly_total_credit":).
 * - Never silently drops or removes configuration properties.
 * - Never overwrites original content unless user accepts a successful repair.
 * - Never reports success unless JSON.parse() strictly passes.
 * - Preserves string literals, escaped characters, Unicode, and nested structures.
 */

/**
 * Extracts line, column, and position from text or error message.
 * @param {string} text
 * @param {number} [pos] - 0-indexed position in text
 * @returns {{ line: number, column: number, position: number }}
 */
export function getLineColFromPosition(text, pos) {
  if (typeof text !== 'string') return { line: 1, column: 1, position: 0 };
  const safePos = typeof pos === 'number' && !isNaN(pos) ? Math.max(0, Math.min(pos, text.length)) : 0;
  const upTo = text.slice(0, safePos);
  const lines = upTo.split('\n');
  const line = lines.length;
  const column = lines[lines.length - 1].length + 1;
  return { line, column, position: safePos };
}

/**
 * Extracts position number from standard JSON.parse() error messages across browsers and Node V8.
 * @param {string} errMsg
 * @param {string} text
 * @returns {number|null}
 */
export function extractPositionFromError(errMsg, text) {
  if (!errMsg || typeof errMsg !== 'string') return null;

  // 1. "at position 42" or "in JSON at position 42"
  const posMatch = errMsg.match(/at position\s+(\d+)/i) || errMsg.match(/position\s+(\d+)/i);
  if (posMatch) {
    const p = parseInt(posMatch[1], 10);
    if (!isNaN(p) && p >= 0 && p <= (text ? text.length : Infinity)) {
      return p;
    }
  }

  // 2. "line 3 column 5"
  const lineColMatch = errMsg.match(/line\s+(\d+)\s+column\s+(\d+)/i);
  if (lineColMatch && text) {
    const targetLine = parseInt(lineColMatch[1], 10);
    const targetCol = parseInt(lineColMatch[2], 10);
    const lines = text.split('\n');
    let currPos = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i + 1 === targetLine) {
        return currPos + Math.min(targetCol - 1, lines[i].length);
      }
      currPos += lines[i].length + 1; // +1 for '\n'
    }
  }

  // 3. "at 3:5"
  const colonMatch = errMsg.match(/at\s+(\d+):(\d+)/i);
  if (colonMatch && text) {
    const targetLine = parseInt(colonMatch[1], 10);
    const targetCol = parseInt(colonMatch[2], 10);
    const lines = text.split('\n');
    let currPos = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i + 1 === targetLine) {
        return currPos + Math.min(targetCol - 1, lines[i].length);
      }
      currPos += lines[i].length + 1;
    }
  }

  return null;
}

/**
 * Token types for lightweight token scanner
 */
export const TOKEN = {
  STRING: 'STRING',
  NUMBER: 'NUMBER',
  BOOLEAN: 'BOOLEAN',
  NULL: 'NULL',
  LBRACE: '{',
  RBRACE: '}',
  LBRACKET: '[',
  RBRACKET: ']',
  COLON: ':',
  COMMA: ',',
  WORD: 'WORD',
  UNKNOWN: 'UNKNOWN'
};

/**
 * Normalizes special Unicode punctuation outside strings:
 * - Smart/curly quotes (“ ” „ « » ‘ ’ ‚)
 * - Full-width commas (，) and colons (：)
 * - Full-width braces/brackets (｛ ｝ ［ ］)
 * - Non-breaking and zero-width spaces
 */
export function normalizeSpecialCharacters(text) {
  let out = '';
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  let changed = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (inDouble) {
      if (ch === '"') inDouble = false;
      out += ch;
      continue;
    }

    if (inSingle) {
      if (ch === "'") inSingle = false;
      out += ch;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      out += ch;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      out += ch;
      continue;
    }

    // Smart double quotes outside strings
    if (ch === '“' || ch === '”' || ch === '„' || ch === '«' || ch === '»') {
      out += '"';
      changed = true;
      continue;
    }
    // Smart single quotes outside strings
    if (ch === '‘' || ch === '’' || ch === '‚') {
      out += "'";
      changed = true;
      continue;
    }

    // Full-width comma and colon
    if (ch === '\uFF0C') {
      out += ',';
      changed = true;
      continue;
    }
    if (ch === '\uFF1A') {
      out += ':';
      changed = true;
      continue;
    }
    if (ch === '\uFF5B') {
      out += '{';
      changed = true;
      continue;
    }
    if (ch === '\uFF5D') {
      out += '}';
      changed = true;
      continue;
    }
    if (ch === '\uFF3B') {
      out += '[';
      changed = true;
      continue;
    }
    if (ch === '\uFF3D') {
      out += ']';
      changed = true;
      continue;
    }

    // Special whitespaces
    if (ch === '\u00A0' || ch === '\u200B' || ch === '\u200C' || ch === '\u200D' || ch === '\uFEFF') {
      out += ' ';
      changed = true;
      continue;
    }

    out += ch;
  }

  return { text: out, changed };
}

/**
 * Strips JavaScript-style comments (// and /* *\/) outside string literals.
 * Preserves newlines to keep line numbers aligned.
 */
export function stripComments(text) {
  let out = '';
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  let changed = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (escaped) {
      out += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      i++;
      continue;
    }

    if (inDouble) {
      if (ch === '"') inDouble = false;
      out += ch;
      i++;
      continue;
    }

    if (inSingle) {
      if (ch === "'") inSingle = false;
      out += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inDouble = true;
      out += ch;
      i++;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      out += ch;
      i++;
      continue;
    }

    // Line comments //
    if (ch === '/' && next === '/') {
      changed = true;
      i += 2;
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        i++;
      }
      continue;
    }

    // Block comments /* ... */
    if (ch === '/' && next === '*') {
      changed = true;
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        if (text[i] === '\n') out += '\n'; // preserve line numbering
        i++;
      }
      i += 2; // skip */
      continue;
    }

    out += ch;
    i++;
  }

  return { text: out, changed };
}

/**
 * Escapes literal unescaped control characters (\n, \r, \t) inside string literals.
 */
export function normalizeControlCharactersInStrings(text) {
  let out = '';
  let inDouble = false;
  let inSingle = false;
  let escaped = false;
  let changed = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      out += ch;
      escaped = true;
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
        out += ch;
      } else if (ch === '\n') {
        out += '\\n';
        changed = true;
      } else if (ch === '\r') {
        out += '\\r';
        changed = true;
      } else if (ch === '\t') {
        out += '\\t';
        changed = true;
      } else {
        out += ch;
      }
      continue;
    }

    if (inSingle) {
      if (ch === "'") {
        inSingle = false;
        out += ch;
      } else if (ch === '\n') {
        out += '\\n';
        changed = true;
      } else if (ch === '\r') {
        out += '\\r';
        changed = true;
      } else if (ch === '\t') {
        out += '\\t';
        changed = true;
      } else {
        out += ch;
      }
      continue;
    }

    if (ch === '"') inDouble = true;
    if (ch === "'") inSingle = true;
    out += ch;
  }

  return { text: out, changed };
}

/**
 * Checks if a line begins with structural JSON tokens (closing braces, new keys, or literals)
 * indicating that an open string on the previous line cannot legally continue across the line break.
 */
export function isStructuralBoundary(line) {
  if (line === null || line === undefined) return true;
  const trimmed = line.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('}') || trimmed.startsWith(']')) return true;
  if (/^"?[a-zA-Z0-9_$-]+"?\s*:/.test(trimmed)) return true;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return true;
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) return true;
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)/.test(trimmed)) return true;
  if (/^(true|false|null)\b/.test(trimmed)) return true;
  return false;
}

/**
 * Counts unescaped instances of a quotation mark character in a string.
 */
export function countUnescapedQuotes(str, quoteChar = '"') {
  let count = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '\\') {
      i++;
      continue;
    }
    if (str[i] === quoteChar) {
      count++;
    }
  }
  return count;
}

/**
 * Safe, conservative missing quote repair:
 * 1. Missing opening quote on property key (e.g. key": "value" -> "key": "value")
 * 2. Missing closing quote on property key (e.g. "key: "value" -> "key": "value")
 * 3. Unclosed string literal value ending on a line before a structural boundary or EOF
 * 4. Unclosed string literal value ending before a delimiter comma
 */
export function repairMissingQuotes(text) {
  const repairs = [];
  let modified = false;
  const lines = text.split('\n');

  for (let lIdx = 0; lIdx < lines.length; lIdx++) {
    let line = lines[lIdx];
    const nextLine = lIdx + 1 < lines.length ? lines[lIdx + 1] : null;

    // Case A: Missing opening quote on key: e.g. chatbot_title": "Customize with AI"
    const missingOpeningKeyMatch = line.match(/^(\s*)([a-zA-Z0-9_$-]+)":/);
    if (missingOpeningKeyMatch) {
      const indent = missingOpeningKeyMatch[1];
      const key = missingOpeningKeyMatch[2];
      line = `${indent}"${key}":` + line.slice(missingOpeningKeyMatch[0].length);
      lines[lIdx] = line;
      modified = true;
      repairs.push(`Added missing opening quote to property '${key}'`);
    }

    // Case B: Missing closing quote on key before colon: e.g. "chatbot_title: "Customize with AI"
    const missingClosingKeyMatch = line.match(/^(\s*)"([a-zA-Z0-9_$-]+):(\s*.*)$/);
    if (missingClosingKeyMatch) {
      const indent = missingClosingKeyMatch[1];
      const key = missingClosingKeyMatch[2];
      const rest = missingClosingKeyMatch[3];
      line = `${indent}"${key}":${rest}`;
      lines[lIdx] = line;
      modified = true;
      repairs.push(`Added missing closing quote to property '${key}'`);
    }

    // Case C: Unclosed double-quoted string on this line
    const doubleQuoteCount = countUnescapedQuotes(line, '"');
    if (doubleQuoteCount % 2 === 1) {
      const trimmedEnd = line.trimEnd();
      const endsWithQuote = trimmedEnd.endsWith('"') || trimmedEnd.endsWith('",');

      if (!endsWithQuote && isStructuralBoundary(nextLine)) {
        const trailingWhitespace = line.slice(trimmedEnd.length);

        if (trimmedEnd.endsWith(',')) {
          const withoutComma = trimmedEnd.slice(0, -1);
          lines[lIdx] = `${withoutComma}",${trailingWhitespace}`;
          repairs.push(`Added missing closing quote before comma on line ${lIdx + 1}`);
        } else {
          lines[lIdx] = `${trimmedEnd}"${trailingWhitespace}`;
          repairs.push(`Added missing closing quote on line ${lIdx + 1}`);
        }
        modified = true;
      }
    }

    // Case D: Unclosed single-quoted string on this line
    const singleQuoteCount = countUnescapedQuotes(line, "'");
    if (singleQuoteCount % 2 === 1) {
      const trimmedEnd = line.trimEnd();
      const endsWithQuote = trimmedEnd.endsWith("'") || trimmedEnd.endsWith("',");

      if (!endsWithQuote && isStructuralBoundary(nextLine)) {
        const trailingWhitespace = line.slice(trimmedEnd.length);

        if (trimmedEnd.endsWith(',')) {
          const withoutComma = trimmedEnd.slice(0, -1);
          lines[lIdx] = `${withoutComma}',${trailingWhitespace}`;
          repairs.push(`Added missing closing single quote before comma on line ${lIdx + 1}`);
        } else {
          lines[lIdx] = `${trimmedEnd}'${trailingWhitespace}`;
          repairs.push(`Added missing closing single quote on line ${lIdx + 1}`);
        }
        modified = true;
      }
    }
  }

  return { text: lines.join('\n'), modified, repairs };
}

/**
 * Tokenizes JSON text safely respecting string escaping, Unicode, comments/whitespace.
 * Returns an array of tokens with start and end indices.
 */
export function tokenizeJson(text) {
  const tokens = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];

    // Whitespace
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      i++;
      continue;
    }

    // Structural characters
    if (char === '{' || char === '}' || char === '[' || char === ']' || char === ':' || char === ',') {
      tokens.push({ type: char, value: char, start: i, end: i + 1 });
      i++;
      continue;
    }

    // Double-quoted string
    if (char === '"') {
      const start = i;
      i++; // skip opening quote
      let escaped = false;
      let closed = false;
      while (i < len) {
        const c = text[i];
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === '"') {
          closed = true;
          i++;
          break;
        } else if (c === '\n' || c === '\r') {
          // If followed by structural boundary, this unclosed string stops at end of line
          const nextNewlineIdx = text.indexOf('\n', i + 1);
          const nextLineText = text.slice(i + 1, nextNewlineIdx !== -1 ? nextNewlineIdx : undefined);
          if (isStructuralBoundary(nextLineText)) {
            break;
          }
        }
        i++;
      }
      tokens.push({
        type: TOKEN.STRING,
        value: text.slice(start, i),
        isClosed: closed,
        quote: '"',
        start,
        end: i
      });
      continue;
    }

    // Single-quoted string
    if (char === "'") {
      const start = i;
      i++; // skip opening single quote
      let escaped = false;
      let closed = false;
      while (i < len) {
        const c = text[i];
        if (escaped) {
          escaped = false;
        } else if (c === '\\') {
          escaped = true;
        } else if (c === "'") {
          closed = true;
          i++;
          break;
        } else if (c === '\n' || c === '\r') {
          const nextNewlineIdx = text.indexOf('\n', i + 1);
          const nextLineText = text.slice(i + 1, nextNewlineIdx !== -1 ? nextNewlineIdx : undefined);
          if (isStructuralBoundary(nextLineText)) {
            break;
          }
        }
        i++;
      }
      tokens.push({
        type: TOKEN.STRING,
        value: text.slice(start, i),
        isClosed: closed,
        quote: "'",
        start,
        end: i
      });
      continue;
    }

    // Numbers (e.g. -123, 45.67, 1e10, .5, 5., +5)
    if (char === '-' || char === '+' || char === '.' || (char >= '0' && char <= '9')) {
      const start = i;
      const numMatch = text.slice(i).match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
      if (numMatch && numMatch[0] !== '.' && numMatch[0] !== '+' && numMatch[0] !== '-') {
        tokens.push({
          type: TOKEN.NUMBER,
          value: numMatch[0],
          start,
          end: start + numMatch[0].length
        });
        i += numMatch[0].length;
        continue;
      }
    }

    // Identifiers or unquoted words (keys, true, false, null, True, False, None, undefined)
    const wordMatch = text.slice(i).match(/^[a-zA-Z_$][a-zA-Z0-9_$-]*/);
    if (wordMatch) {
      const word = wordMatch[0];
      const start = i;
      let type = TOKEN.WORD;
      if (word === 'true' || word === 'false') type = TOKEN.BOOLEAN;
      else if (word === 'null') type = TOKEN.NULL;
      tokens.push({
        type,
        value: word,
        start,
        end: start + word.length
      });
      i += word.length;
      continue;
    }

    // Unknown character fallback
    tokens.push({
      type: TOKEN.UNKNOWN,
      value: char,
      start: i,
      end: i + 1
    });
    i++;
  }

  return tokens;
}

/**
 * Checks specifically for dangling colon / incomplete value cases.
 * Returns information about the missing value if detected.
 */
export function detectDanglingColonMissingValue(text) {
  const tokens = tokenizeJson(text);

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === ':') {
      const prev = tokens[i - 1];
      const next = tokens[i + 1];

      // Colon followed directly by comma, closing brace, closing bracket, or EOF
      if (!next || next.type === ',' || next.type === '}' || next.type === ']') {
        let keyName = prev ? prev.value : 'property';
        // Strip quotes from key name for cleaner message
        if (keyName.startsWith('"') && keyName.endsWith('"')) {
          keyName = keyName.slice(1, -1);
        } else if (keyName.startsWith("'") && keyName.endsWith("'")) {
          keyName = keyName.slice(1, -1);
        }

        const loc = getLineColFromPosition(text, t.end);
        return {
          detected: true,
          keyName,
          colonPos: t.start,
          line: loc.line,
          column: loc.column,
          position: t.end,
          message: `Incomplete configuration: Property '${keyName}' is missing a value. Values cannot be guessed and must be provided manually.`,
          reasonCode: 'DANGLING_COLON_MISSING_VALUE'
        };
      }
    }
  }

  return null;
}

/**
 * Analyzes the syntax of a JSON string.
 * Uses JSON.parse() as the authoritative validator.
 *
 * @param {string} text
 * @returns {{
 *   valid: boolean,
 *   message: string,
 *   line: number|null,
 *   column: number|null,
 *   position: number|null,
 *   reasonCode: string
 * }}
 */
export function analyzeJsonSyntax(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      valid: false,
      message: 'Configuration value is empty. Expected a valid JSON object, array, or literal.',
      line: 1,
      column: 1,
      position: 0,
      reasonCode: 'EMPTY'
    };
  }

  // 1. Authoritative parse test
  try {
    JSON.parse(text);
    return {
      valid: true,
      message: 'Valid JSON syntax',
      line: null,
      column: null,
      position: null,
      reasonCode: 'VALID'
    };
  } catch (err) {
    // 2. Check for missing value before anything else (Critical safety check)
    const dangling = detectDanglingColonMissingValue(text);
    if (dangling) {
      return {
        valid: false,
        message: dangling.message,
        line: dangling.line,
        column: dangling.column,
        position: dangling.position,
        reasonCode: dangling.reasonCode
      };
    }

    // 3. Extract line/column from error
    const pos = extractPositionFromError(err.message, text);
    let line = null;
    let column = null;
    let position = null;

    if (pos !== null) {
      const loc = getLineColFromPosition(text, pos);
      line = loc.line;
      column = loc.column;
      position = pos;
    }

    // 4. Normalize message to clean human-readable text
    let userMsg = err.message || 'Syntax error in JSON';

    // Check for unterminated string
    const tokens = tokenizeJson(text);
    const unclosedString = tokens.find(t => t.type === TOKEN.STRING && !t.isClosed);
    if (unclosedString) {
      // Point error location directly to where the string terminated (unclosedString.end)
      const loc = getLineColFromPosition(text, unclosedString.end);
      return {
        valid: false,
        message: `Unterminated string literal at Line ${loc.line}, Col ${loc.column}. Please add closing quotation mark.`,
        line: loc.line,
        column: loc.column,
        position: unclosedString.end,
        reasonCode: 'UNTERMINATED_STRING'
      };
    }

    // Normalize common V8 engine messages
    if (/Unexpected end of JSON input/i.test(userMsg)) {
      userMsg = 'Unexpected end of input: missing closing brace \'}\' or bracket \']\'';
    } else if (/Expected ',' or '}' after property value/i.test(userMsg)) {
      userMsg = 'Missing comma between object properties or unexpected token';
    } else if (/Expected ',' or ']' after array element/i.test(userMsg)) {
      userMsg = 'Missing comma between array elements or unexpected token';
    } else if (/Expected double-quoted property name/i.test(userMsg)) {
      userMsg = 'Property keys must be enclosed in double quotes';
    } else if (/Bad control character in string literal/i.test(userMsg)) {
      userMsg = 'String contains unescaped control character (newline or tab). Must be escaped.';
    } else if (/Unexpected token.*is not valid JSON/i.test(userMsg)) {
      userMsg = userMsg.replace(/\s+in JSON at position \d+.*$/i, '').trim();
    }

    return {
      valid: false,
      message: userMsg,
      line,
      column,
      position,
      reasonCode: 'SYNTAX_ERROR'
    };
  }
}

/**
 * Attempts safe, deterministic repair of common JSON syntax errors.
 *
 * Supported repairs (only when unambiguous):
 * 1. Normalize special unicode punctuation (smart quotes, full-width commas/colons).
 * 2. Strip JavaScript comments (// and /* *\/) outside strings.
 * 3. Escape unescaped control characters in string literals.
 * 4. Convert single-quoted strings/keys to double-quoted strings.
 * 5. Normalize standalone True/False/None to true/false/null.
 * 6. Normalize non-standard numbers (+5 -> 5, .5 -> 0.5, 5. -> 5.0).
 * 7. Quote unquoted property keys.
 * 8. Insert missing colons between property names and values.
 * 9. Remove trailing commas immediately preceding '}' or ']'.
 * 10. Insert missing commas between adjacent properties or elements.
 * 11. Add missing closing braces '}' or brackets ']' when all contained items are complete.
 *
 * @param {string} text
 * @returns {{
 *   success: boolean,
 *   repairedText: string,
 *   originalText: string,
 *   message: string,
 *   repairsApplied: string[],
 *   line: number|null,
 *   column: number|null,
 *   position: number|null,
 *   reasonCode: string
 * }}
 */
export function repairJson(text) {
  const originalText = text;

  // 1. Initial validation check
  const initialAnalysis = analyzeJsonSyntax(text);
  if (initialAnalysis.valid) {
    return {
      success: true,
      repairedText: originalText,
      originalText,
      message: 'JSON is already valid. No repairs needed.',
      repairsApplied: [],
      line: null,
      column: null,
      position: null,
      reasonCode: 'ALREADY_VALID'
    };
  }

  // 2. Reject if dangling colon / missing value detected (Strict Non-Destructive Rule)
  if (initialAnalysis.reasonCode === 'DANGLING_COLON_MISSING_VALUE') {
    return {
      success: false,
      repairedText: originalText,
      originalText,
      message: initialAnalysis.message,
      repairsApplied: [],
      line: initialAnalysis.line,
      column: initialAnalysis.column,
      position: initialAnalysis.position,
      reasonCode: initialAnalysis.reasonCode
    };
  }

  // 3. Staged Token-Aware Transformations with Multi-Pass Convergence
  const repairsApplied = new Set();
  let candidate = text;

  // Phase A: Pre-sanitization
  // A1. Unicode punctuation normalization
  {
    const res = normalizeSpecialCharacters(candidate);
    if (res.changed) {
      candidate = res.text;
      repairsApplied.add('Normalized smart quotes and full-width punctuation to standard JSON');
    }
  }

  // A2. Strip comments
  {
    const res = stripComments(candidate);
    if (res.changed) {
      candidate = res.text;
      repairsApplied.add('Stripped JavaScript comments');
    }
  }

  // A3. Repair missing quotes (unclosed string values before structural boundaries, missing quotes on keys)
  {
    const res = repairMissingQuotes(candidate);
    if (res.modified) {
      candidate = res.text;
      for (const rep of res.repairs) {
        repairsApplied.add(rep);
      }
    }
  }

  // A4. Normalize unescaped control characters in strings
  {
    const res = normalizeControlCharactersInStrings(candidate);
    if (res.changed) {
      candidate = res.text;
      repairsApplied.add('Escaped control characters (newlines/tabs) in strings');
    }
  }

  // Quick check: does candidate validate now?
  try {
    JSON.parse(candidate);
    return {
      success: true,
      repairedText: candidate,
      originalText,
      message: `Auto Repair applied ${repairsApplied.size} fix(es): ${Array.from(repairsApplied).join(', ')}.`,
      repairsApplied: Array.from(repairsApplied),
      line: null,
      column: null,
      position: null,
      reasonCode: 'REPAIR_SUCCESS'
    };
  } catch (e) {}

  // Phase B: Iterative Syntax Transformations (up to 4 passes for compound issues)
  const maxPasses = 4;
  for (let pass = 0; pass < maxPasses; pass++) {
    const prevCandidate = candidate;

    // STEP B0: Repair missing quotes (unclosed string values, keys)
    {
      const res = repairMissingQuotes(candidate);
      if (res.modified) {
        candidate = res.text;
        for (const rep of res.repairs) {
          repairsApplied.add(rep);
        }
      }
    }

    // STEP B1: Convert single-quoted strings/keys to double-quoted JSON strings
    {
      const tokens = tokenizeJson(candidate);
      let singleQuoteFound = false;
      let newText = '';
      let lastIdx = 0;

      for (const t of tokens) {
        if (t.type === TOKEN.STRING && t.quote === "'") {
          singleQuoteFound = true;
          newText += candidate.slice(lastIdx, t.start);
          const inner = t.value.slice(1, t.isClosed ? -1 : undefined);
          let convertedInner = '';
          let escaped = false;
          for (let j = 0; j < inner.length; j++) {
            const ch = inner[j];
            if (escaped) {
              if (ch === "'") {
                convertedInner += "'";
              } else {
                convertedInner += '\\' + ch;
              }
              escaped = false;
            } else if (ch === '\\') {
              escaped = true;
            } else if (ch === '"') {
              convertedInner += '\\"';
            } else {
              convertedInner += ch;
            }
          }
          if (escaped) convertedInner += '\\';
          newText += `"${convertedInner}"`;
          lastIdx = t.end;
        }
      }

      if (singleQuoteFound) {
        newText += candidate.slice(lastIdx);
        candidate = newText;
        repairsApplied.add('Converted single-quoted strings and keys to double-quoted JSON strings');
      }
    }

    // STEP B2: Normalize standalone Python/literal tokens (True -> true, False -> false, None -> null)
    {
      const tokens = tokenizeJson(candidate);
      let literalChanged = false;
      let newText = '';
      let lastIdx = 0;

      for (const t of tokens) {
        if (t.type === TOKEN.WORD && (t.value === 'True' || t.value === 'False' || t.value === 'None')) {
          let replacement = t.value;
          if (t.value === 'True') replacement = 'true';
          else if (t.value === 'False') replacement = 'false';
          else if (t.value === 'None') replacement = 'null';

          newText += candidate.slice(lastIdx, t.start) + replacement;
          lastIdx = t.end;
          literalChanged = true;
        }
      }

      if (literalChanged) {
        newText += candidate.slice(lastIdx);
        candidate = newText;
        repairsApplied.add('Normalized True/False/None to valid JSON true/false/null');
      }
    }

    // STEP B3: Normalize non-standard numbers (.5 -> 0.5, 5. -> 5.0, +5 -> 5)
    {
      const tokens = tokenizeJson(candidate);
      let numChanged = false;
      let newText = '';
      let lastIdx = 0;

      for (const t of tokens) {
        if (t.type === TOKEN.NUMBER) {
          let v = t.value;
          let normalized = v;
          if (normalized.startsWith('+')) normalized = normalized.slice(1);
          if (normalized.startsWith('.')) normalized = '0' + normalized;
          if (normalized.startsWith('-.')) normalized = '-0.' + normalized.slice(2);
          if (normalized.endsWith('.')) normalized = normalized + '0';

          if (normalized !== v) {
            newText += candidate.slice(lastIdx, t.start) + normalized;
            lastIdx = t.end;
            numChanged = true;
          }
        }
      }

      if (numChanged) {
        newText += candidate.slice(lastIdx);
        candidate = newText;
        repairsApplied.add('Normalized numbers to valid JSON number format');
      }
    }

    // STEP B4: Quote unquoted property keys (e.g. { trial_total_credit: 300 })
    {
      const tokens = tokenizeJson(candidate);
      let keyQuoted = false;
      let newText = '';
      let lastIdx = 0;

      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const next = tokens[i + 1];

        if (t.type === TOKEN.WORD && next && next.type === ':') {
          newText += candidate.slice(lastIdx, t.start) + `"${t.value}"`;
          lastIdx = t.end;
          keyQuoted = true;
        }
      }

      if (keyQuoted) {
        newText += candidate.slice(lastIdx);
        candidate = newText;
        repairsApplied.add('Enclosed unquoted property keys in double quotes');
      }
    }

    // STEP B5: Insert missing colon between property name and property value
    {
      const tokens = tokenizeJson(candidate);
      let missingColonFound = false;
      let newText = '';
      let lastIdx = 0;

      for (let i = 0; i < tokens.length - 1; i++) {
        const curr = tokens[i];
        const next = tokens[i + 1];
        const prev = tokens[i - 1];

        // Is curr a property key missing a colon?
        const isKeyLike = (curr.type === TOKEN.STRING || curr.type === TOKEN.WORD);
        const isValidKeyContext = (!prev || prev.type === '{' || prev.type === ',');
        const isNextValue = (
          next.type === TOKEN.STRING ||
          next.type === TOKEN.NUMBER ||
          next.type === TOKEN.BOOLEAN ||
          next.type === TOKEN.NULL ||
          next.type === '{' ||
          next.type === '['
        );

        if (isKeyLike && isValidKeyContext && next.type !== ':' && isNextValue) {
          // Missing colon!
          let keyVal = curr.value;
          if (curr.type === TOKEN.WORD) keyVal = `"${keyVal}"`;
          newText += candidate.slice(lastIdx, curr.start) + keyVal + ':';
          lastIdx = curr.end;
          missingColonFound = true;
        }
      }

      if (missingColonFound) {
        newText += candidate.slice(lastIdx);
        candidate = newText;
        repairsApplied.add('Inserted missing colon between property name and value');
      }
    }

    // STEP B6: Remove trailing commas immediately preceding '}' or ']'
    {
      const tokens = tokenizeJson(candidate);
      let trailingCommaFound = false;
      let newText = '';
      let lastIdx = 0;

      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === ',') {
          const next = tokens[i + 1];
          if (next && (next.type === '}' || next.type === ']')) {
            newText += candidate.slice(lastIdx, t.start);
            lastIdx = t.end;
            trailingCommaFound = true;
          }
        }
      }

      if (trailingCommaFound) {
        newText += candidate.slice(lastIdx);
        candidate = newText;
        repairsApplied.add('Removed trailing commas before closing delimiters');
      }
    }

    // STEP B7: Insert missing commas between adjacent properties or array items
    {
      const tokens = tokenizeJson(candidate);
      let missingCommaFound = false;
      let newText = '';
      let lastIdx = 0;

      for (let i = 0; i < tokens.length - 1; i++) {
        const curr = tokens[i];
        const next = tokens[i + 1];

        const isValueEnd = (
          curr.type === TOKEN.STRING ||
          curr.type === TOKEN.NUMBER ||
          curr.type === TOKEN.BOOLEAN ||
          curr.type === TOKEN.NULL ||
          curr.type === '}' ||
          curr.type === ']'
        );

        const isNextItemStart = (
          (next.type === TOKEN.STRING && tokens[i + 2] && tokens[i + 2].type === ':') || // object key
          (next.type === TOKEN.WORD && tokens[i + 2] && tokens[i + 2].type === ':') ||   // unquoted key
          next.type === '{' ||                                                           // object item
          next.type === '[' ||                                                           // array item
          next.type === TOKEN.STRING ||                                                  // array string item
          next.type === TOKEN.NUMBER ||                                                  // array number item
          next.type === TOKEN.BOOLEAN ||                                                 // array boolean item
          next.type === TOKEN.NULL                                                       // array null item
        );

        if (isValueEnd && isNextItemStart) {
          newText += candidate.slice(lastIdx, curr.end) + ',';
          lastIdx = curr.end;
          missingCommaFound = true;
        }
      }

      if (missingCommaFound) {
        newText += candidate.slice(lastIdx);
        candidate = newText;
        repairsApplied.add('Inserted missing commas between adjacent properties or elements');
      }
    }

    // STEP B8: Add missing closing braces or brackets (when unambiguous)
    {
      const tokens = tokenizeJson(candidate);
      const stack = [];
      let structurallyValidSoFar = true;

      for (const t of tokens) {
        if (t.type === '{' || t.type === '[') {
          stack.push(t.type);
        } else if (t.type === '}') {
          if (stack.length > 0 && stack[stack.length - 1] === '{') {
            stack.pop();
          } else {
            structurallyValidSoFar = false;
            break;
          }
        } else if (t.type === ']') {
          if (stack.length > 0 && stack[stack.length - 1] === '[') {
            stack.pop();
          } else {
            structurallyValidSoFar = false;
            break;
          }
        }
      }

      if (structurallyValidSoFar && stack.length > 0) {
        const lastToken = tokens[tokens.length - 1];
        if (lastToken && lastToken.type !== ':' && lastToken.type !== ',') {
          let closingSuffix = '';
          while (stack.length > 0) {
            const expected = stack.pop();
            closingSuffix += expected === '{' ? '\n}' : '\n]';
          }
          candidate = candidate + closingSuffix;
          repairsApplied.add('Added missing closing delimiters');
        }
      }
    }

    // Check if JSON.parse() passes after this pass
    try {
      JSON.parse(candidate);
      return {
        success: true,
        repairedText: candidate,
        originalText,
        message: `Auto Repair applied ${repairsApplied.size} fix(es): ${Array.from(repairsApplied).join(', ')}.`,
        repairsApplied: Array.from(repairsApplied),
        line: null,
        column: null,
        position: null,
        reasonCode: 'REPAIR_SUCCESS'
      };
    } catch (e) {
      // If candidate did not change in this pass, no point in repeating identical transformations
      if (candidate === prevCandidate) {
        break;
      }
    }
  }

  // 4. Strict Validation Gate: Prove syntactic validity with JSON.parse()
  try {
    JSON.parse(candidate);

    return {
      success: true,
      repairedText: candidate,
      originalText,
      message: `Auto Repair applied ${repairsApplied.size} fix(es): ${Array.from(repairsApplied).join(', ')}.`,
      repairsApplied: Array.from(repairsApplied),
      line: null,
      column: null,
      position: null,
      reasonCode: 'REPAIR_SUCCESS'
    };
  } catch (parseErr) {
    // If our candidate is still not valid, check if it's because of an incomplete value
    const dangling = detectDanglingColonMissingValue(originalText);
    if (dangling) {
      return {
        success: false,
        repairedText: originalText,
        originalText,
        message: dangling.message,
        repairsApplied: [],
        line: dangling.line,
        column: dangling.column,
        position: dangling.position,
        reasonCode: dangling.reasonCode
      };
    }

    // Safety rule: Never return partially broken text. Return original text unchanged.
    // Use authoritative analysis from analyzeJsonSyntax to guarantee 100% diagnostic consistency
    const failureAnalysis = analyzeJsonSyntax(originalText);
    let diagnostic = failureAnalysis.message;
    if (!diagnostic.startsWith('Auto Repair could not safely') && !diagnostic.startsWith('Incomplete configuration:')) {
      diagnostic = `Auto Repair could not safely determine the intended syntax: ${failureAnalysis.message}`;
    }

    return {
      success: false,
      repairedText: originalText,
      originalText,
      message: diagnostic,
      repairsApplied: [],
      line: failureAnalysis.line,
      column: failureAnalysis.column,
      position: failureAnalysis.position,
      reasonCode: 'UNSAFE_OR_AMBIGUOUS'
    };
  }
}
