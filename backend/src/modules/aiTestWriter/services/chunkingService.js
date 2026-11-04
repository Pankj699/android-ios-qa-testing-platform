const crypto = require('crypto');

/**
 * Estimates token count using a deterministic word-and-punctuation count heuristic.
 * Note: This is an empirical approximation, not a verified subword tokenizer.
 * Method: word_punctuation_heuristic_v1
 */
function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  const words = trimmed.split(/\s+/).filter(Boolean).length;
  const punctuationCount = (trimmed.match(/[^a-zA-Z0-9\s]/g) || []).length;
  return Math.max(1, Math.round(words * 1.25 + punctuationCount * 0.5));
}

/**
 * Formats token count for UI display with explicit approximation label.
 */
function formatTokenEstimate(tokenCount) {
  return `~${tokenCount} tokens (est.)`;
}

// Target structural benchmark: 500–800 tokens (~2,000–3,200 chars)
const TARGET_MIN_TOKENS = 500;
const TARGET_MAX_TOKENS = 800;
const DEFAULT_OVERLAP_TOKENS = 75;

/**
 * Helper to extract breadcrumb string from unit metadata or heading path.
 */
function extractBreadcrumbs(unit, currentBreadcrumbs) {
  if (unit.source_type === 'HEADING') {
    const headingText = unit.extracted_text.trim();
    const level = unit.metadata?.level || 1;
    // Update breadcrumbs up to current heading level
    const crumbs = currentBreadcrumbs.slice(0, Math.max(0, level - 1));
    crumbs.push(headingText);
    return crumbs;
  }
  if (unit.metadata?.heading_path && Array.isArray(unit.metadata.heading_path) && unit.metadata.heading_path.length > 0) {
    return unit.metadata.heading_path;
  }
  return currentBreadcrumbs;
}

/**
 * Structural chunking pipeline for extracted units.
 * Converts ordered extracted units into context-enriched, bounded chunks with provenance.
/**
 * Splits an oversized text block at sentence boundaries.
 * Uses punctuation marks (. ! ?) followed by whitespace or end of line.
 * If a single sentence exceeds maxTokens, falls back to word boundaries.
 */
function splitTextAtSentenceBoundaries(text, maxTokens) {
  if (!text || typeof text !== 'string') return [];
  if (estimateTokens(text) <= maxTokens) {
    return [text.trim()];
  }

  // Regex splitting on sentence boundaries (. ! ? followed by whitespace or end-of-string)
  const sentenceMatches = text.match(/[^.!?]+(?:[.!?]+(?=\s|$)|$)/g) || [text];
  const parts = [];
  let currentPart = '';

  for (const s of sentenceMatches) {
    const trimmed = s.trim();
    if (!trimmed) continue;

    const candidate = currentPart ? `${currentPart} ${trimmed}` : trimmed;
    if (estimateTokens(candidate) > maxTokens && currentPart) {
      parts.push(currentPart);

      // If a single sentence exceeds maxTokens by itself, split at word boundaries
      if (estimateTokens(trimmed) > maxTokens) {
        const words = trimmed.split(/\s+/);
        let wordPart = '';
        for (const w of words) {
          const wCandidate = wordPart ? `${wordPart} ${w}` : w;
          if (estimateTokens(wCandidate) > maxTokens && wordPart) {
            parts.push(wordPart);
            wordPart = w;
          } else {
            wordPart = wCandidate;
          }
        }
        currentPart = wordPart;
      } else {
        currentPart = trimmed;
      }
    } else {
      currentPart = candidate;
    }
  }

  if (currentPart) {
    parts.push(currentPart);
  }

  return parts.length > 0 ? parts : [text.trim()];
}

/**
 * Structural chunking pipeline for extracted units.
 * Converts ordered extracted units into context-enriched, bounded chunks with provenance.
 *
 * @param {Array<Object>} units - List of extracted units from ai_document_extracted_units
 * @param {Object} options - Chunking options
 * @param {number} [options.minTokens=TARGET_MIN_TOKENS]
 * @param {number} [options.maxTokens=TARGET_MAX_TOKENS]
 * @param {boolean} [options.enableOverlap=true]
 * @returns {Array<Object>} Array of chunk objects ready for DB insertion
 */
function chunkExtractedUnits(units, options = {}) {
  if (!units || !Array.isArray(units) || units.length === 0) {
    return [];
  }

  const minTokens = options.minTokens || TARGET_MIN_TOKENS;
  const maxTokens = options.maxTokens || TARGET_MAX_TOKENS;
  const enableOverlap = options.enableOverlap !== false;

  // Pre-process: split oversized units at sentence boundaries while preserving provenance
  const normalizedUnits = [];
  for (const u of units) {
    const text = u.extracted_text || '';
    if (estimateTokens(text) > maxTokens) {
      const parts = splitTextAtSentenceBoundaries(text, maxTokens);
      for (let idx = 0; idx < parts.length; idx++) {
        normalizedUnits.push({
          ...u,
          extracted_text: parts[idx],
          metadata: {
            ...(u.metadata || {}),
            split_at_sentence_boundary: true,
            split_part_index: idx,
            split_total_parts: parts.length
          }
        });
      }
    } else {
      normalizedUnits.push(u);
    }
  }

  // Detect dominant document format from source_type distribution
  const sourceTypes = new Set(normalizedUnits.map(u => u.source_type));
  const isPdf = sourceTypes.has('PAGE');
  const isSheet = sourceTypes.has('SHEET_HEADER') || sourceTypes.has('SHEET_ROW');
  const isCsv = sourceTypes.has('CSV_ROW');
  const isDocx = sourceTypes.has('HEADING') || sourceTypes.has('TABLE') || sourceTypes.has('TABLE_ROW');
  const isTxt = sourceTypes.has('LINE');

  if (isCsv) {
    return chunkCsvUnits(normalizedUnits, { minTokens, maxTokens, enableOverlap });
  } else if (isSheet) {
    return chunkSheetUnits(normalizedUnits, { minTokens, maxTokens, enableOverlap });
  } else if (isPdf) {
    return chunkPdfUnits(normalizedUnits, { minTokens, maxTokens, enableOverlap });
  } else if (isDocx) {
    return chunkDocxUnits(normalizedUnits, { minTokens, maxTokens, enableOverlap });
  } else if (isTxt) {
    return chunkLineUnits(normalizedUnits, { minTokens, maxTokens, enableOverlap });
  }

  // Fallback: Generic sequential unit chunking
  return chunkGenericUnits(normalizedUnits, { minTokens, maxTokens, enableOverlap });
}

/**
 * Format 1: PDF Units (Page-aware chunking)
 */
function chunkPdfUnits(units, { minTokens, maxTokens, enableOverlap }) {
  const chunks = [];
  let chunkIndex = 0;

  // Group units by page
  const pageMap = new Map();
  for (const u of units) {
    const pageNum = u.source_location?.page || (u.metadata?.page) || 1;
    if (!pageMap.has(pageNum)) pageMap.set(pageNum, []);
    pageMap.get(pageNum).push(u);
  }

  const sortedPages = Array.from(pageMap.keys()).sort((a, b) => a - b);
  let currentGroup = [];
  let currentTokens = 0;
  let startPage = null;

  for (const pageNum of sortedPages) {
    const pageUnits = pageMap.get(pageNum);
    const pageText = pageUnits.map(u => u.extracted_text).join('\n\n');
    const pageTokenEstimate = estimateTokens(pageText);

    if (startPage === null) startPage = pageNum;

    // If a single page exceeds maxTokens, split it into paragraph sub-chunks
    if (pageTokenEstimate > maxTokens) {
      // Flush any accumulated smaller pages first
      if (currentGroup.length > 0) {
        chunks.push(createChunkFromUnits({
          units: currentGroup,
          chunkIndex: chunkIndex++,
          pageNumber: startPage,
          prefix: `[Page ${startPage}${startPage !== pageNum - 1 ? `-${pageNum - 1}` : ''}]\n`
        }));
        currentGroup = [];
        currentTokens = 0;
      }

      // Split large page by paragraphs
      const paragraphs = pageText.split(/\n\n+/).filter(Boolean);
      let subGroup = [];
      let subTokens = 0;

      for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
        const para = paragraphs[pIdx];
        const pTokens = estimateTokens(para);

        if (subTokens + pTokens > maxTokens && subGroup.length > 0) {
          const chunkContent = `[Page ${pageNum}]\n` + subGroup.join('\n\n');
          chunks.push({
            id: crypto.randomUUID(),
            chunk_index: chunkIndex++,
            content: chunkContent,
            token_count: estimateTokens(chunkContent),
            page_number: pageNum,
            section_heading: null,
            metadata: {
              token_estimation: {
                method: 'word_punctuation_heuristic_v1',
                estimated: true,
                estimated_tokens: estimateTokens(chunkContent)
              },
              source_type: 'PAGE',
              page: pageNum,
              source_location_display: `Page ${pageNum}`
            }
          });
          subGroup = enableOverlap ? [subGroup[subGroup.length - 1], para] : [para];
          subTokens = estimateTokens(subGroup.join('\n\n'));
        } else {
          subGroup.push(para);
          subTokens += pTokens;
        }
      }

      if (subGroup.length > 0) {
        const chunkContent = `[Page ${pageNum}]\n` + subGroup.join('\n\n');
        chunks.push({
          id: crypto.randomUUID(),
          chunk_index: chunkIndex++,
          content: chunkContent,
          token_count: estimateTokens(chunkContent),
          page_number: pageNum,
          section_heading: null,
          metadata: {
            token_estimation: {
              method: 'word_punctuation_heuristic_v1',
              estimated: true,
              estimated_tokens: estimateTokens(chunkContent)
            },
            source_type: 'PAGE',
            page: pageNum,
            source_location_display: `Page ${pageNum}`
          }
        });
      }

      startPage = null;
      continue;
    }

    // Accumulate consecutive pages up to target benchmark
    if (currentTokens + pageTokenEstimate > maxTokens && currentGroup.length > 0) {
      const endPage = currentGroup[currentGroup.length - 1].source_location?.page || startPage;
      const prefix = startPage === endPage ? `[Page ${startPage}]\n` : `[Pages ${startPage}-${endPage}]\n`;
      chunks.push(createChunkFromUnits({
        units: currentGroup,
        chunkIndex: chunkIndex++,
        pageNumber: startPage,
        prefix
      }));
      currentGroup = [pageUnits[0]];
      currentTokens = estimateTokens(pageUnits[0].extracted_text);
      startPage = pageNum;
    } else {
      currentGroup.push(...pageUnits);
      currentTokens += pageTokenEstimate;
    }
  }

  if (currentGroup.length > 0) {
    const endPage = currentGroup[currentGroup.length - 1].source_location?.page || startPage;
    const prefix = startPage === endPage ? `[Page ${startPage}]\n` : `[Pages ${startPage}-${endPage}]\n`;
    chunks.push(createChunkFromUnits({
      units: currentGroup,
      chunkIndex: chunkIndex++,
      pageNumber: startPage,
      prefix
    }));
  }

  return chunks;
}

/**
 * Format 2: DOCX Units (Breadcrumbs and Heading Hierarchy)
 */
function chunkDocxUnits(units, { minTokens, maxTokens, enableOverlap }) {
  const chunks = [];
  let chunkIndex = 0;
  let activeBreadcrumbs = [];
  let currentGroup = [];
  let currentTokens = 0;
  let lastHeading = null;

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    activeBreadcrumbs = extractBreadcrumbs(u, activeBreadcrumbs);
    if (u.source_type === 'HEADING') {
      lastHeading = u.extracted_text.trim();
    }

    const unitTokens = estimateTokens(u.extracted_text);

    if (currentTokens + unitTokens > maxTokens && currentGroup.length > 0) {
      const breadcrumbStr = activeBreadcrumbs.length > 0 ? activeBreadcrumbs.join(' > ') : null;
      const prefix = breadcrumbStr ? `[Section: ${breadcrumbStr}]\n` : '';
      
      chunks.push(createChunkFromUnits({
        units: currentGroup,
        chunkIndex: chunkIndex++,
        sectionHeading: lastHeading || breadcrumbStr,
        prefix,
        metadataExtra: { breadcrumbs: activeBreadcrumbs }
      }));

      // Overlap: retain last unit if enabled
      if (enableOverlap && currentGroup.length > 1) {
        const overlapUnit = currentGroup[currentGroup.length - 1];
        currentGroup = [overlapUnit, u];
        currentTokens = estimateTokens(overlapUnit.extracted_text) + unitTokens;
      } else {
        currentGroup = [u];
        currentTokens = unitTokens;
      }
    } else {
      currentGroup.push(u);
      currentTokens += unitTokens;
    }
  }

  if (currentGroup.length > 0) {
    const breadcrumbStr = activeBreadcrumbs.length > 0 ? activeBreadcrumbs.join(' > ') : null;
    const prefix = breadcrumbStr ? `[Section: ${breadcrumbStr}]\n` : '';
    chunks.push(createChunkFromUnits({
      units: currentGroup,
      chunkIndex: chunkIndex++,
      sectionHeading: lastHeading || breadcrumbStr,
      prefix,
      metadataExtra: { breadcrumbs: activeBreadcrumbs }
    }));
  }

  return chunks;
}

/**
 * Format 3: XLSX Units (Sheet and Row Batches)
 */
function chunkSheetUnits(units, { minTokens, maxTokens, enableOverlap }) {
  const chunks = [];
  let chunkIndex = 0;

  // Group by sheet name
  const sheetMap = new Map();
  for (const u of units) {
    const sheetName = u.source_location?.sheet || u.metadata?.sheet || 'Sheet1';
    if (!sheetMap.has(sheetName)) sheetMap.set(sheetName, []);
    sheetMap.get(sheetName).push(u);
  }

  for (const [sheetName, sheetUnits] of sheetMap.entries()) {
    let headersText = '';
    const headerUnit = sheetUnits.find(u => u.source_type === 'SHEET_HEADER');
    if (headerUnit) {
      headersText = headerUnit.extracted_text.trim();
    }

    const rowUnits = sheetUnits.filter(u => u.source_type === 'SHEET_ROW');
    let currentBatch = [];
    let currentTokens = 0;
    const prefix = headersText 
      ? `[Sheet: ${sheetName} | Headers: ${headersText}]\n` 
      : `[Sheet: ${sheetName}]\n`;
    const prefixTokens = estimateTokens(prefix);

    for (const r of rowUnits) {
      const rTokens = estimateTokens(r.extracted_text);
      if (currentTokens + rTokens + prefixTokens > maxTokens && currentBatch.length > 0) {
        chunks.push(createChunkFromUnits({
          units: currentBatch,
          chunkIndex: chunkIndex++,
          prefix,
          sectionHeading: sheetName,
          metadataExtra: { sheet: sheetName, headers: headersText }
        }));
        currentBatch = [r];
        currentTokens = rTokens;
      } else {
        currentBatch.push(r);
        currentTokens += rTokens;
      }
    }

    if (currentBatch.length > 0) {
      chunks.push(createChunkFromUnits({
        units: currentBatch,
        chunkIndex: chunkIndex++,
        prefix,
        sectionHeading: sheetName,
        metadataExtra: { sheet: sheetName, headers: headersText }
      }));
    }
  }

  return chunks;
}

/**
 * Format 4: CSV Units (Header Preservation and Row Batches)
 */
function chunkCsvUnits(units, { minTokens, maxTokens, enableOverlap }) {
  const chunks = [];
  let chunkIndex = 0;

  let headersText = '';
  // Check if first unit or metadata has headers
  if (units.length > 0 && units[0].metadata?.headers) {
    headersText = Array.isArray(units[0].metadata.headers) 
      ? units[0].metadata.headers.join(', ') 
      : String(units[0].metadata.headers);
  }

  const prefix = headersText ? `[CSV Headers: ${headersText}]\n` : '';
  const prefixTokens = estimateTokens(prefix);

  let currentBatch = [];
  let currentTokens = 0;
  let startLine = null;

  for (const u of units) {
    const lineNo = u.source_location?.row || u.source_location?.line || u.sequence_number;
    if (startLine === null) startLine = lineNo;

    const uTokens = estimateTokens(u.extracted_text);
    if (currentTokens + uTokens + prefixTokens > maxTokens && currentBatch.length > 0) {
      const endLine = currentBatch[currentBatch.length - 1].source_location?.row || lineNo;
      chunks.push(createChunkFromUnits({
        units: currentBatch,
        chunkIndex: chunkIndex++,
        prefix,
        metadataExtra: {
          headers: headersText,
          line_start: startLine,
          line_end: endLine,
          source_type: 'CSV_ROW'
        }
      }));
      currentBatch = [u];
      currentTokens = uTokens;
      startLine = lineNo;
    } else {
      currentBatch.push(u);
      currentTokens += uTokens;
    }
  }

  if (currentBatch.length > 0) {
    const endLine = currentBatch[currentBatch.length - 1].source_location?.row || startLine;
    chunks.push(createChunkFromUnits({
      units: currentBatch,
      chunkIndex: chunkIndex++,
      prefix,
      metadataExtra: {
        headers: headersText,
        line_start: startLine,
        line_end: endLine,
        source_type: 'CSV_ROW'
      }
    }));
  }

  return chunks;
}

/**
 * Format 5: TXT Units (Line Ranges)
 */
function chunkLineUnits(units, { minTokens, maxTokens, enableOverlap }) {
  const chunks = [];
  let chunkIndex = 0;

  let currentBatch = [];
  let currentTokens = 0;
  let startLine = null;

  for (const u of units) {
    const lineStart = u.source_location?.line_start || u.sequence_number;
    const lineEnd = u.source_location?.line_end || lineStart;
    if (startLine === null) startLine = lineStart;

    const uTokens = estimateTokens(u.extracted_text);
    if (currentTokens + uTokens > maxTokens && currentBatch.length > 0) {
      const prevEnd = currentBatch[currentBatch.length - 1].source_location?.line_end || lineStart;
      chunks.push(createChunkFromUnits({
        units: currentBatch,
        chunkIndex: chunkIndex++,
        prefix: `[Lines ${startLine}-${prevEnd}]\n`,
        metadataExtra: {
          line_start: startLine,
          line_end: prevEnd,
          source_type: 'LINE'
        }
      }));

      if (enableOverlap && currentBatch.length > 1) {
        const overlapUnit = currentBatch[currentBatch.length - 1];
        currentBatch = [overlapUnit, u];
        currentTokens = estimateTokens(overlapUnit.extracted_text) + uTokens;
        startLine = overlapUnit.source_location?.line_start || lineStart;
      } else {
        currentBatch = [u];
        currentTokens = uTokens;
        startLine = lineStart;
      }
    } else {
      currentBatch.push(u);
      currentTokens += uTokens;
    }
  }

  if (currentBatch.length > 0) {
    const prevEnd = currentBatch[currentBatch.length - 1].source_location?.line_end || startLine;
    chunks.push(createChunkFromUnits({
      units: currentBatch,
      chunkIndex: chunkIndex++,
      prefix: `[Lines ${startLine}-${prevEnd}]\n`,
      metadataExtra: {
        line_start: startLine,
        line_end: prevEnd,
        source_type: 'LINE'
      }
    }));
  }

  return chunks;
}

/**
 * Generic Fallback Chunking
 */
function chunkGenericUnits(units, { minTokens, maxTokens, enableOverlap }) {
  const chunks = [];
  let chunkIndex = 0;
  let currentBatch = [];
  let currentTokens = 0;

  for (const u of units) {
    const uTokens = estimateTokens(u.extracted_text);
    if (currentTokens + uTokens > maxTokens && currentBatch.length > 0) {
      chunks.push(createChunkFromUnits({
        units: currentBatch,
        chunkIndex: chunkIndex++
      }));
      currentBatch = enableOverlap && currentBatch.length > 1 
        ? [currentBatch[currentBatch.length - 1], u]
        : [u];
      currentTokens = estimateTokens(currentBatch.map(x => x.extracted_text).join('\n\n'));
    } else {
      currentBatch.push(u);
      currentTokens += uTokens;
    }
  }

  if (currentBatch.length > 0) {
    chunks.push(createChunkFromUnits({
      units: currentBatch,
      chunkIndex: chunkIndex++
    }));
  }

  return chunks;
}

/**
 * Creates a normalized chunk object from a set of units.
 */
function createChunkFromUnits({ units, chunkIndex, pageNumber = null, sectionHeading = null, prefix = '', metadataExtra = {} }) {
  const rawBody = units.map(u => u.extracted_text).join('\n\n');
  const content = prefix ? `${prefix}${rawBody}` : rawBody;
  const tokenCount = estimateTokens(content);
  
  // Provenance extraction
  const firstUnit = units[0];
  const lastUnit = units[units.length - 1];
  const page = pageNumber || firstUnit?.source_location?.page || null;
  const heading = sectionHeading || firstUnit?.metadata?.heading || null;

  return {
    id: crypto.randomUUID(),
    chunk_index: chunkIndex,
    content,
    token_count: tokenCount,
    page_number: page,
    section_heading: heading,
    metadata: {
      token_estimation: {
        method: 'word_punctuation_heuristic_v1',
        estimated: true,
        estimated_tokens: tokenCount
      },
      unit_count: units.length,
      start_sequence: firstUnit?.sequence_number ?? 0,
      end_sequence: lastUnit?.sequence_number ?? 0,
      source_location_display: firstUnit?.source_location_display || (page ? `Page ${page}` : null),
      ...metadataExtra
    }
  };
}

module.exports = {
  estimateTokens,
  formatTokenEstimate,
  chunkExtractedUnits,
  splitTextAtSentenceBoundaries,
  TARGET_MIN_TOKENS,
  TARGET_MAX_TOKENS
};
