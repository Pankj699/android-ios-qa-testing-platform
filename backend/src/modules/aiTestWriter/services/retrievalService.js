const db = require('../db/connection');
const embeddingService = require('./embeddingService');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const DEFAULT_CANDIDATE_LIMIT = 50;
const DEFAULT_RRF_K = 60;
const DEFAULT_WEIGHT_SEMANTIC = 1.0;
const DEFAULT_WEIGHT_KEYWORD = 1.0;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates and sanitizes retrieval options.
 * Throws structured errors with HTTP 400 status for invalid inputs.
 */
function validateSearchOptions(options) {
  const {
    projectId,
    query,
    mode = 'HYBRID',
    limit = DEFAULT_LIMIT,
    candidateLimit = DEFAULT_CANDIDATE_LIMIT,
    documentId = null,
    weights = {},
    fallbackOnSemanticFailure = false,
    client = null
  } = options;

  if (!projectId || !UUID_REGEX.test(projectId)) {
    const err = new Error('Invalid or missing projectId. Must be a valid UUID.');
    err.code = 'INVALID_PROJECT_ID';
    err.status = 400;
    throw err;
  }

  if (typeof query !== 'string' || !query.trim()) {
    const err = new Error('Search query must be a non-empty string.');
    err.code = 'INVALID_QUERY';
    err.status = 400;
    throw err;
  }

  if (query.trim().length > 2000) {
    const err = new Error('Search query exceeds maximum length of 2000 characters.');
    err.code = 'QUERY_TOO_LONG';
    err.status = 400;
    throw err;
  }

  const normalizedMode = mode.toUpperCase();
  if (!['HYBRID', 'SEMANTIC', 'KEYWORD'].includes(normalizedMode)) {
    const err = new Error(`Invalid retrieval mode '${mode}'. Must be 'HYBRID', 'SEMANTIC', or 'KEYWORD'.`);
    err.code = 'INVALID_RETRIEVAL_MODE';
    err.status = 400;
    throw err;
  }

  const parsedLimit = parseInt(limit, 10);
  if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > MAX_LIMIT) {
    const err = new Error(`Limit must be an integer between 1 and ${MAX_LIMIT}. Received: ${limit}`);
    err.code = 'INVALID_LIMIT';
    err.status = 400;
    throw err;
  }

  const parsedCandidateLimit = parseInt(candidateLimit, 10);
  if (isNaN(parsedCandidateLimit) || parsedCandidateLimit < 10 || parsedCandidateLimit > 100) {
    const err = new Error(`Candidate limit must be an integer between 10 and 100. Received: ${candidateLimit}`);
    err.code = 'INVALID_CANDIDATE_LIMIT';
    err.status = 400;
    throw err;
  }

  if (documentId !== null && documentId !== undefined && !UUID_REGEX.test(documentId)) {
    const err = new Error(`Invalid documentId '${documentId}'. Must be a valid UUID.`);
    err.code = 'INVALID_DOCUMENT_ID';
    err.status = 400;
    throw err;
  }

  const weightSemantic = weights.semantic !== undefined ? parseFloat(weights.semantic) : DEFAULT_WEIGHT_SEMANTIC;
  if (isNaN(weightSemantic) || !Number.isFinite(weightSemantic) || weightSemantic < 0.0 || weightSemantic > 10.0) {
    const err = new Error(`Semantic weight must be a number between 0.0 and 10.0. Received: ${weights.semantic}`);
    err.code = 'INVALID_WEIGHT';
    err.status = 400;
    throw err;
  }

  const weightKeyword = weights.keyword !== undefined ? parseFloat(weights.keyword) : DEFAULT_WEIGHT_KEYWORD;
  if (isNaN(weightKeyword) || !Number.isFinite(weightKeyword) || weightKeyword < 0.0 || weightKeyword > 10.0) {
    const err = new Error(`Keyword weight must be a number between 0.0 and 10.0. Received: ${weights.keyword}`);
    err.code = 'INVALID_WEIGHT';
    err.status = 400;
    throw err;
  }

  const rrfK = weights.rrf_k !== undefined ? parseInt(weights.rrf_k, 10) : DEFAULT_RRF_K;
  if (isNaN(rrfK) || rrfK < 1 || rrfK > 1000) {
    const err = new Error(`RRF constant 'k' must be an integer between 1 and 1000. Received: ${weights.rrf_k}`);
    err.code = 'INVALID_RRF_K';
    err.status = 400;
    throw err;
  }

  return {
    projectId,
    cleanQuery: query.trim(),
    mode: normalizedMode,
    limit: parsedLimit,
    candidateLimit: parsedCandidateLimit,
    documentId: documentId || null,
    weightSemantic,
    weightKeyword,
    rrfK,
    fallbackOnSemanticFailure: Boolean(fallbackOnSemanticFailure),
    client: client || null
  };
}

/**
 * Executes unified hybrid retrieval across pgvector semantic and PostgreSQL full-text search.
 */
async function hybridSearch(options) {
  const validated = validateSearchOptions(options);
  const {
    projectId,
    cleanQuery,
    mode,
    limit,
    candidateLimit,
    documentId,
    weightSemantic,
    weightKeyword,
    rrfK,
    fallbackOnSemanticFailure,
    client
  } = validated;

  const overallStartTime = Date.now();
  let queryEmbedding = null;
  let embeddingLatencyMs = 0;
  let degraded = false;
  let semanticError = null;

  // 1. Generate query embedding if mode requires it (SEMANTIC or HYBRID)
  if (mode === 'SEMANTIC' || mode === 'HYBRID') {
    try {
      const embRes = await embeddingService.generateQueryEmbedding(cleanQuery);
      queryEmbedding = embRes.embedding;
      embeddingLatencyMs = embRes.latencyMs;
    } catch (embErr) {
      if (mode === 'SEMANTIC') {
        // In SEMANTIC mode, NEVER silently fallback to keyword
        throw embErr;
      }
      // In HYBRID mode, fallback to keyword only if explicitly allowed
      if (fallbackOnSemanticFailure) {
        console.warn(`[RetrievalService] Semantic leg failed (${embErr.message}). Falling back to KEYWORD_ONLY.`);
        degraded = true;
        semanticError = embErr.message;
      } else {
        throw embErr;
      }
    }
  }

  const dbStartTime = Date.now();
  let searchResultRows = [];

  // 2. Dispatch to execution path
  if (mode === 'KEYWORD' || (mode === 'HYBRID' && degraded)) {
    // Pure lexical execution path (ZERO Ollama calls)
    searchResultRows = await executeKeywordSearch({
      projectId,
      queryString: cleanQuery,
      documentId,
      limit,
      candidateLimit,
      client
    });
  } else if (mode === 'SEMANTIC') {
    // Pure semantic execution path
    searchResultRows = await executeSemanticSearch({
      projectId,
      queryVector: queryEmbedding,
      documentId,
      limit,
      candidateLimit,
      client
    });
  } else {
    // Full HYBRID execution path with RRF fusion
    searchResultRows = await executeUnifiedHybridSearch({
      projectId,
      queryVector: queryEmbedding,
      queryString: cleanQuery,
      documentId,
      limit,
      candidateLimit,
      weightSemantic,
      weightKeyword,
      rrfK,
      client
    });
  }

  const dbLatencyMs = Date.now() - dbStartTime;
  const totalDurationMs = Date.now() - overallStartTime;

  // 3. Format citations and provenance
  const formattedResults = searchResultRows.map(row => formatCitationResult(row));

  return {
    query: cleanQuery,
    mode: degraded ? 'HYBRID_DEGRADED' : mode,
    totalCount: formattedResults.length,
    durationMs: totalDurationMs,
    diagnostics: {
      embeddingLatencyMs,
      dbLatencyMs,
      totalDurationMs,
      candidateLimit,
      returnedCount: formattedResults.length,
      degraded,
      semanticError: semanticError || null
    },
    results: formattedResults
  };
}

/**
 * Unified CTE SQL query executing semantic candidates, keyword candidates, and RRF fusion
 * within a single statement under PostgreSQL MVCC statement-level snapshot isolation.
 */
async function executeUnifiedHybridSearch({
  projectId,
  queryVector,
  queryString,
  documentId,
  limit,
  candidateLimit,
  weightSemantic,
  weightKeyword,
  rrfK,
  client = null
}) {
  const querySql = `
    WITH semantic_candidates AS (
      SELECT 
        c.id AS chunk_id,
        c.extraction_id, c.version_id, c.document_id, c.project_id,
        c.chunk_index, c.content, c.token_count, c.page_number, c.section_heading, c.metadata,
        d.title AS document_title, d.original_filename, d.document_type,
        v.version_number, x.extractor_version,
        (1.0 - (e.embedding <=> $1::vector)) AS semantic_similarity,
        ROW_NUMBER() OVER (
          ORDER BY (e.embedding <=> $1::vector) ASC, c.chunk_index ASC, c.id ASC
        ) AS semantic_rank
      FROM ai_document_chunks c
      JOIN ai_document_embeddings e ON e.chunk_id = c.id
        AND e.extraction_id = c.extraction_id
        AND e.version_id = c.version_id
        AND e.document_id = c.document_id
        AND e.project_id = c.project_id
      JOIN ai_documents d ON d.id = c.document_id AND d.project_id = $2
      JOIN ai_document_versions v ON v.id = d.active_version_id AND v.id = c.version_id
      JOIN ai_document_extractions x ON x.version_id = v.id AND x.id = c.extraction_id 
        AND x.is_active = TRUE AND x.status = 'COMPLETED'
      WHERE c.project_id = $2
        AND v.indexing_status = 'COMPLETED'
        AND ($4::uuid IS NULL OR c.document_id = $4)
      ORDER BY (e.embedding <=> $1::vector) ASC, c.chunk_index ASC, c.id ASC
      LIMIT $5
    ),
    keyword_candidates AS (
      SELECT 
        c.id AS chunk_id,
        c.extraction_id, c.version_id, c.document_id, c.project_id,
        c.chunk_index, c.content, c.token_count, c.page_number, c.section_heading, c.metadata,
        d.title AS document_title, d.original_filename, d.document_type,
        v.version_number, x.extractor_version,
        (
          ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $3), 32) *
          (1.0 + CASE WHEN d.title ILIKE ('%' || $3 || '%') THEN 0.5 ELSE 0.0 END) +
          CASE WHEN ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $3), 32) = 0.0 
                    AND d.title ILIKE ('%' || $3 || '%') 
                    AND c.chunk_index = 0 THEN 0.05 ELSE 0.0 END
        ) AS keyword_rank_score,
        CASE 
          WHEN c.content_tsv @@ websearch_to_tsquery('english', $3) THEN 'CONTENT'
          ELSE 'DOCUMENT_TITLE'
        END AS keyword_match_level,
        ROW_NUMBER() OVER (
          ORDER BY (
            ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $3), 32) *
            (1.0 + CASE WHEN d.title ILIKE ('%' || $3 || '%') THEN 0.5 ELSE 0.0 END) +
            CASE WHEN ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $3), 32) = 0.0 
                      AND d.title ILIKE ('%' || $3 || '%') 
                      AND c.chunk_index = 0 THEN 0.05 ELSE 0.0 END
          ) DESC,
          c.chunk_index ASC, c.id ASC
        ) AS keyword_rank
      FROM ai_document_chunks c
      JOIN ai_documents d ON d.id = c.document_id AND d.project_id = $2
      JOIN ai_document_versions v ON v.id = d.active_version_id AND v.id = c.version_id
      JOIN ai_document_extractions x ON x.version_id = v.id AND x.id = c.extraction_id 
        AND x.is_active = TRUE AND x.status = 'COMPLETED'
      WHERE c.project_id = $2
        AND v.indexing_status = 'COMPLETED'
        AND (
          c.content_tsv @@ websearch_to_tsquery('english', $3)
          OR (d.title ILIKE ('%' || $3 || '%') AND c.chunk_index = 0)
        )
        AND ($4::uuid IS NULL OR c.document_id = $4)
      ORDER BY keyword_rank_score DESC, c.chunk_index ASC, c.id ASC
      LIMIT $5
    ),
    fused_results AS (
      SELECT 
        COALESCE(s.chunk_id, k.chunk_id) AS chunk_id,
        COALESCE(s.extraction_id, k.extraction_id) AS extraction_id,
        COALESCE(s.version_id, k.version_id) AS version_id,
        COALESCE(s.document_id, k.document_id) AS document_id,
        COALESCE(s.project_id, k.project_id) AS project_id,
        COALESCE(s.chunk_index, k.chunk_index) AS chunk_index,
        COALESCE(s.content, k.content) AS content,
        COALESCE(s.token_count, k.token_count) AS token_count,
        COALESCE(s.page_number, k.page_number) AS page_number,
        COALESCE(s.section_heading, k.section_heading) AS section_heading,
        COALESCE(s.metadata, k.metadata) AS metadata,
        COALESCE(s.document_title, k.document_title) AS document_title,
        COALESCE(s.original_filename, k.original_filename) AS original_filename,
        COALESCE(s.document_type, k.document_type) AS document_type,
        COALESCE(s.version_number, k.version_number) AS version_number,
        COALESCE(s.extractor_version, k.extractor_version) AS extractor_version,
        s.semantic_similarity,
        s.semantic_rank,
        k.keyword_rank_score,
        k.keyword_rank,
        COALESCE(k.keyword_match_level, 'CONTENT') AS match_level,
        (
          COALESCE($6::float8 / ($8::float8 + s.semantic_rank::float8), 0.0::float8) +
          COALESCE($7::float8 / ($8::float8 + k.keyword_rank::float8), 0.0::float8)
        ) AS rrf_score,
        CASE 
          WHEN s.chunk_id IS NOT NULL AND k.chunk_id IS NOT NULL THEN ARRAY['SEMANTIC', 'KEYWORD']
          WHEN s.chunk_id IS NOT NULL THEN ARRAY['SEMANTIC']
          ELSE ARRAY['KEYWORD']
        END AS match_types
      FROM semantic_candidates s
      FULL OUTER JOIN keyword_candidates k ON s.chunk_id = k.chunk_id
    )
    SELECT *
    FROM fused_results
    ORDER BY 
      rrf_score DESC, 
      semantic_similarity DESC NULLS LAST, 
      keyword_rank_score DESC NULLS LAST, 
      chunk_index ASC, 
      chunk_id ASC
    LIMIT $9;
  `;

  const queryClient = client || db;
  const res = await queryClient.query(querySql, [
    JSON.stringify(queryVector), // $1
    projectId,                  // $2
    queryString,                // $3
    documentId,                 // $4
    candidateLimit,             // $5
    weightSemantic,             // $6
    weightKeyword,              // $7
    rrfK,                       // $8
    limit                       // $9
  ]);

  return res.rows;
}

/**
 * Exact project-filtered cosine semantic retrieval.
 */
async function executeSemanticSearch({
  projectId,
  queryVector,
  documentId,
  limit,
  candidateLimit,
  client = null
}) {
  const querySql = `
    SELECT 
      c.id AS chunk_id,
      c.extraction_id, c.version_id, c.document_id, c.project_id,
      c.chunk_index, c.content, c.token_count, c.page_number, c.section_heading, c.metadata,
      d.title AS document_title, d.original_filename, d.document_type,
      v.version_number, x.extractor_version,
      (1.0 - (e.embedding <=> $1::vector)) AS semantic_similarity,
      ROW_NUMBER() OVER (
        ORDER BY (e.embedding <=> $1::vector) ASC, c.chunk_index ASC, c.id ASC
      ) AS semantic_rank,
      ARRAY['SEMANTIC'] AS match_types,
      'CONTENT' AS match_level,
      NULL::float8 AS keyword_rank_score,
      NULL::bigint AS keyword_rank,
      (1.0 - (e.embedding <=> $1::vector)) AS rrf_score
    FROM ai_document_chunks c
    JOIN ai_document_embeddings e ON e.chunk_id = c.id
      AND e.extraction_id = c.extraction_id
      AND e.version_id = c.version_id
      AND e.document_id = c.document_id
      AND e.project_id = c.project_id
    JOIN ai_documents d ON d.id = c.document_id AND d.project_id = $2
    JOIN ai_document_versions v ON v.id = d.active_version_id AND v.id = c.version_id
    JOIN ai_document_extractions x ON x.version_id = v.id AND x.id = c.extraction_id 
      AND x.is_active = TRUE AND x.status = 'COMPLETED'
    WHERE c.project_id = $2
      AND v.indexing_status = 'COMPLETED'
      AND ($3::uuid IS NULL OR c.document_id = $3)
    ORDER BY (e.embedding <=> $1::vector) ASC, c.chunk_index ASC, c.id ASC
    LIMIT $4;
  `;

  const queryClient = client || db;
  const res = await queryClient.query(querySql, [
    JSON.stringify(queryVector), // $1
    projectId,                  // $2
    documentId,                 // $3
    limit                       // $4
  ]);

  return res.rows;
}

/**
 * Keyword / full-text retrieval with technical identifier phrase matching.
 * Bypasses Ollama inference completely.
 */
async function executeKeywordSearch({
  projectId,
  queryString,
  documentId,
  limit,
  candidateLimit,
  client = null
}) {
  const querySql = `
    SELECT 
      c.id AS chunk_id,
      c.extraction_id, c.version_id, c.document_id, c.project_id,
      c.chunk_index, c.content, c.token_count, c.page_number, c.section_heading, c.metadata,
      d.title AS document_title, d.original_filename, d.document_type,
      v.version_number, x.extractor_version,
      NULL::float8 AS semantic_similarity,
      NULL::bigint AS semantic_rank,
      (
        ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $2), 32) *
        (1.0 + CASE WHEN d.title ILIKE ('%' || $2 || '%') THEN 0.5 ELSE 0.0 END) +
        CASE WHEN ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $2), 32) = 0.0 
                  AND d.title ILIKE ('%' || $2 || '%') 
                  AND c.chunk_index = 0 THEN 0.05 ELSE 0.0 END
      ) AS keyword_rank_score,
      CASE 
        WHEN c.content_tsv @@ websearch_to_tsquery('english', $2) THEN 'CONTENT'
        ELSE 'DOCUMENT_TITLE'
      END AS match_level,
      ROW_NUMBER() OVER (
        ORDER BY (
          ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $2), 32) *
          (1.0 + CASE WHEN d.title ILIKE ('%' || $2 || '%') THEN 0.5 ELSE 0.0 END) +
          CASE WHEN ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $2), 32) = 0.0 
                    AND d.title ILIKE ('%' || $2 || '%') 
                    AND c.chunk_index = 0 THEN 0.05 ELSE 0.0 END
        ) DESC,
        c.chunk_index ASC, c.id ASC
      ) AS keyword_rank,
      ARRAY['KEYWORD'] AS match_types,
      (
        ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $2), 32) *
        (1.0 + CASE WHEN d.title ILIKE ('%' || $2 || '%') THEN 0.5 ELSE 0.0 END) +
        CASE WHEN ts_rank_cd(c.content_tsv, websearch_to_tsquery('english', $2), 32) = 0.0 
                  AND d.title ILIKE ('%' || $2 || '%') 
                  AND c.chunk_index = 0 THEN 0.05 ELSE 0.0 END
      ) AS rrf_score
    FROM ai_document_chunks c
    JOIN ai_documents d ON d.id = c.document_id AND d.project_id = $1
    JOIN ai_document_versions v ON v.id = d.active_version_id AND v.id = c.version_id
    JOIN ai_document_extractions x ON x.version_id = v.id AND x.id = c.extraction_id 
      AND x.is_active = TRUE AND x.status = 'COMPLETED'
    WHERE c.project_id = $1
      AND v.indexing_status = 'COMPLETED'
      AND (
        c.content_tsv @@ websearch_to_tsquery('english', $2)
        OR (d.title ILIKE ('%' || $2 || '%') AND c.chunk_index = 0)
      )
      AND ($3::uuid IS NULL OR c.document_id = $3)
    ORDER BY keyword_rank_score DESC, c.chunk_index ASC, c.id ASC
    LIMIT $4;
  `;

  const queryClient = client || db;
  const res = await queryClient.query(querySql, [
    projectId,   // $1
    queryString, // $2
    documentId,  // $3
    limit        // $4
  ]);

  return res.rows;
}

/**
 * Formats a raw database row into the standardized citation provenance structure.
 */
function formatCitationResult(row) {
  let sourceLocationDisplay = '';
  if (row.page_number !== null && row.page_number !== undefined) {
    sourceLocationDisplay = `Page ${row.page_number}`;
  } else if (row.section_heading) {
    sourceLocationDisplay = `Section: ${row.section_heading}`;
  } else if (row.metadata?.sheet_name) {
    sourceLocationDisplay = `Sheet: ${row.metadata.sheet_name}`;
  } else if (row.metadata?.line_range) {
    sourceLocationDisplay = `Lines ${row.metadata.line_range[0]}-${row.metadata.line_range[1]}`;
  } else {
    sourceLocationDisplay = `Chunk #${row.chunk_index + 1}`;
  }

  return {
    chunkId: row.chunk_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    tokenCount: row.token_count,
    scores: {
      rrfScore: typeof row.rrf_score === 'number' ? row.rrf_score : parseFloat(row.rrf_score || 0),
      matchTypes: row.match_types || [],
      matchLevel: row.match_level || 'CONTENT',
      semantic: row.semantic_rank ? {
        rank: parseInt(row.semantic_rank, 10),
        similarity: parseFloat(row.semantic_similarity || 0)
      } : null,
      keyword: row.keyword_rank ? {
        rank: parseInt(row.keyword_rank, 10),
        score: parseFloat(row.keyword_rank_score || 0)
      } : null
    },
    provenance: {
      projectId: row.project_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      originalFilename: row.original_filename,
      documentType: row.document_type,
      versionId: row.version_id,
      versionNumber: row.version_number,
      extractionId: row.extraction_id,
      pageNumber: row.page_number,
      sectionHeading: row.section_heading,
      sourceLocationDisplay,
      metadata: row.metadata || {}
    }
  };
}

module.exports = {
  validateSearchOptions,
  hybridSearch,
  executeUnifiedHybridSearch,
  executeSemanticSearch,
  executeKeywordSearch,
  formatCitationResult,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_RRF_K
};
