const db = require('../db/connection');
const chunkingService = require('./chunkingService');
const embeddingService = require('./embeddingService');

// In-process registry for fast rejection of concurrent indexing triggers
const activeInFlightIndexings = new Set();

const ADVISORY_LOCK_CLASS_NAME = 'ai_document_indexing';
const STALE_INDEXING_TIMEOUT_MINUTES = 5;
const HEARTBEAT_INTERVAL_MS = 5000;

/**
 * Returns the two integer keys used for PostgreSQL session advisory lock.
 * Key 1: class identifier hash
 * Key 2: version UUID hash
 */
function getAdvisoryLockKeys(versionId) {
  return {
    className: ADVISORY_LOCK_CLASS_NAME,
    versionId: String(versionId)
  };
}

/**
 * Checks whether an advisory lock for the given versionId is currently held in PostgreSQL.
 * Executes a pure non-blocking SELECT against pg_locks without acquiring or releasing any lock.
 *
 * @param {string} versionId
 * @param {object} [client] - Optional db client
 * @returns {Promise<{ isHeld: boolean, pid: number|null }>}
 */
async function checkAdvisoryLockHeldInDb(versionId, client = null) {
  const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
  const res = await queryFn(`
    SELECT pid, mode, granted
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND classid = (hashtext($1::text)::integer)::oid
      AND objid = (hashtext($2::text)::integer)::oid
      AND granted = TRUE
    LIMIT 1;
  `, [ADVISORY_LOCK_CLASS_NAME, String(versionId)]);

  if (res.rows && res.rows.length > 0) {
    return { isHeld: true, pid: res.rows[0].pid };
  }
  return { isHeld: false, pid: null };
}

/**
 * Triggers document version indexing (chunking + embedding generation).
 * Protected by full-lifecycle two-tier session advisory lock.
 *
 * @param {Object} params
 * @param {string} params.projectId
 * @param {string} params.documentId
 * @param {string} params.versionId
 * @param {boolean} [params.isReindex=false]
 * @returns {Promise<Object>}
 */
async function indexDocumentVersion({ projectId, documentId, versionId, isReindex = false }) {
  // 1. Tier 1: In-process fast rejection
  if (activeInFlightIndexings.has(versionId)) {
    const err = new Error('Document indexing is already in progress for this version.');
    err.status = 409;
    err.code = 'INDEXING_ALREADY_IN_PROGRESS';
    throw err;
  }

  // 2. Pre-execution check: Verify completed active extraction exists for this hierarchy
  const extractionRes = await db.query(`
    SELECT e.id as extraction_id, e.status, e.is_active, e.total_units, d.project_id
    FROM ai_document_extractions e
    JOIN ai_documents d ON d.id = e.document_id
    WHERE e.version_id = $1 
      AND e.document_id = $2 
      AND e.project_id = $3
      AND e.is_active = TRUE 
      AND e.status = 'COMPLETED';
  `, [versionId, documentId, projectId]);

  if (!extractionRes.rows || extractionRes.rows.length === 0) {
    const err = new Error('No completed active extraction found for this document version. Run document extraction first.');
    err.status = 400;
    err.code = 'EXTRACTION_NOT_READY';
    throw err;
  }

  const extraction = extractionRes.rows[0];
  const extractionId = extraction.extraction_id;

  if (parseInt(extraction.total_units, 10) === 0) {
    const err = new Error('Active document extraction contains 0 structured units. Cannot generate chunks.');
    err.status = 400;
    err.code = 'EXTRACTION_EMPTY';
    throw err;
  }

  // 3. Tier 2: Check out dedicated pg-client and acquire cross-process session advisory lock
  let dedicatedClient = null;
  let lockAcquired = false;

  try {
    dedicatedClient = await db.getClient();
    const lockRes = await dedicatedClient.query(`
      SELECT pg_try_advisory_lock(hashtext($1::text)::integer, hashtext($2::text)::integer) as locked
    `, [ADVISORY_LOCK_CLASS_NAME, versionId]);

    if (!lockRes.rows[0] || !lockRes.rows[0].locked) {
      const err = new Error('Another process is currently indexing this document version.');
      err.status = 409;
      err.code = 'INDEXING_IN_PROGRESS_LOCK';
      throw err;
    }

    lockAcquired = true;
    activeInFlightIndexings.add(versionId);

    // Update document version status to PROCESSING
    await db.query(`
      UPDATE ai_document_versions
      SET indexing_status = 'PROCESSING',
          indexing_last_heartbeat_at = NOW(),
          indexing_error = NULL
      WHERE id = $1 AND document_id = $2;
    `, [versionId, documentId]);

  } catch (initErr) {
    if (lockAcquired && dedicatedClient) {
      try {
        await dedicatedClient.query(`
          SELECT pg_advisory_unlock(hashtext($1::text)::integer, hashtext($2::text)::integer)
        `, [ADVISORY_LOCK_CLASS_NAME, versionId]);
      } catch (_) {}
    }
    if (dedicatedClient) {
      dedicatedClient.release();
    }
    activeInFlightIndexings.delete(versionId);
    throw initErr;
  }

  // Pipeline begins asynchronously in the background so HTTP route responds promptly,
  // OR runs synchronously if invoked in testing / background task.
  // We return the immediate initiation status, while the dedicated client is held in closure.
  const pipelinePromise = (async () => {
    let heartbeatTimer = null;
    try {
      // 4. Start active heartbeat loop while processing
      heartbeatTimer = setInterval(async () => {
        try {
          await db.query(`
            UPDATE ai_document_versions
            SET indexing_last_heartbeat_at = NOW()
            WHERE id = $1 AND indexing_status = 'PROCESSING';
          `, [versionId]);
        } catch (_) {}
      }, HEARTBEAT_INTERVAL_MS);

      // 5. Fetch extracted units with full hierarchy scoping
      const unitsRes = await db.query(`
        SELECT id, extraction_id, version_id, document_id, project_id, sequence_number, source_type,
               source_location, source_location_display, extracted_text, unit_warnings, metadata
        FROM ai_document_extracted_units
        WHERE extraction_id = $1 
          AND version_id = $2 
          AND document_id = $3 
          AND project_id = $4
        ORDER BY sequence_number ASC;
      `, [extractionId, versionId, documentId, projectId]);

      const units = unitsRes.rows;
      if (units.length === 0) {
        throw new Error('No extracted units found in database for extraction.');
      }

      // 6. Execute structural chunking
      const chunks = chunkingService.chunkExtractedUnits(units);
      if (chunks.length === 0) {
        throw new Error('Chunking produced 0 chunks from extracted units.');
      }

      // Assign hierarchy keys to each chunk
      for (const chunk of chunks) {
        chunk.extraction_id = extractionId;
        chunk.version_id = versionId;
        chunk.document_id = documentId;
        chunk.project_id = projectId;
      }

      // 7. Execute batch Ollama embedding generation (in-memory)
      const embeddingResult = await embeddingService.generateEmbeddingsForChunks(chunks);
      const embeddings = embeddingResult.embeddings;
      const diagnostics = embeddingResult.diagnostics;

      // Assign hierarchy keys to each embedding
      for (const emb of embeddings) {
        emb.extraction_id = extractionId;
        emb.version_id = versionId;
        emb.document_id = documentId;
        emb.project_id = projectId;
      }

      // 8. Atomic pre-commit revalidation and atomic swap
      let txnClient = null;
      try {
        txnClient = await db.getClient();
        await txnClient.query('BEGIN');

        // A. Shared row-level lock on active extraction to ensure it hasn't changed during inference
        const revalRes = await txnClient.query(`
          SELECT id FROM ai_document_extractions
          WHERE id = $1 
            AND version_id = $2 
            AND document_id = $3 
            AND project_id = $4
            AND is_active = TRUE 
            AND status = 'COMPLETED'
          FOR SHARE;
        `, [extractionId, versionId, documentId, projectId]);

        if (!revalRes.rows || revalRes.rows.length === 0) {
          throw new Error('Active document extraction was deactivated or invalidated during embedding generation.');
        }

        // B. Hierarchy-scoped deletion of any prior chunks for this exact extraction
        await txnClient.query(`
          DELETE FROM ai_document_chunks
          WHERE extraction_id = $1
            AND version_id = $2
            AND document_id = $3
            AND project_id = $4;
        `, [extractionId, versionId, documentId, projectId]);

        // C. Hierarchy-scoped retirement of old chunks for other extractions of this version
        await txnClient.query(`
          DELETE FROM ai_document_chunks
          WHERE version_id = $1
            AND document_id = $2
            AND project_id = $3
            AND extraction_id != $4;
        `, [versionId, documentId, projectId, extractionId]);

        // D. Batch insert chunks
        const CHUNK_INSERT_BATCH = 200;
        for (let b = 0; b < chunks.length; b += CHUNK_INSERT_BATCH) {
          const batch = chunks.slice(b, b + CHUNK_INSERT_BATCH);
          const valueClauses = [];
          const params = [];
          let pIdx = 1;

          for (const c of batch) {
            valueClauses.push(
              `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7}, $${pIdx + 8}, $${pIdx + 9}, $${pIdx + 10})`
            );
            params.push(
              c.id,
              c.extraction_id,
              c.version_id,
              c.document_id,
              c.project_id,
              c.chunk_index,
              c.content,
              c.token_count,
              c.page_number,
              c.section_heading,
              JSON.stringify(c.metadata || {})
            );
            pIdx += 11;
          }

          const insertChunksSql = `
            INSERT INTO ai_document_chunks (
              id, extraction_id, version_id, document_id, project_id,
              chunk_index, content, token_count, page_number, section_heading, metadata
            ) VALUES ${valueClauses.join(', ')}
          `;
          await txnClient.query(insertChunksSql, params);
        }

        // E. Batch insert embeddings with vector casting
        const EMB_INSERT_BATCH = 100;
        for (let b = 0; b < embeddings.length; b += EMB_INSERT_BATCH) {
          const batch = embeddings.slice(b, b + EMB_INSERT_BATCH);
          const valueClauses = [];
          const params = [];
          let pIdx = 1;

          for (const emb of batch) {
            valueClauses.push(
              `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7}::vector)`
            );
            params.push(
              emb.id,
              emb.chunk_id,
              emb.extraction_id,
              emb.version_id,
              emb.document_id,
              emb.project_id,
              emb.model_id,
              JSON.stringify(emb.embedding)
            );
            pIdx += 8;
          }

          const insertEmbsSql = `
            INSERT INTO ai_document_embeddings (
              id, chunk_id, extraction_id, version_id, document_id, project_id,
              model_id, embedding
            ) VALUES ${valueClauses.join(', ')}
          `;
          await txnClient.query(insertEmbsSql, params);
        }

        // F. Update version status to COMPLETED
        await txnClient.query(`
          UPDATE ai_document_versions
          SET indexing_status = 'COMPLETED',
              indexing_error = NULL,
              total_chunks = $1,
              indexed_at = NOW(),
              embedding_model_id = $2,
              indexing_diagnostics = $3
          WHERE id = $4 AND document_id = $5;
        `, [
          chunks.length,
          diagnostics.modelId,
          JSON.stringify(diagnostics),
          versionId,
          documentId
        ]);

        await txnClient.query('COMMIT');
        console.log(`[IndexingService] Version ${versionId} indexed successfully (${chunks.length} chunks, ${embeddings.length} embeddings).`);
      } catch (commitErr) {
        if (txnClient) {
          try { await txnClient.query('ROLLBACK'); } catch (_) {}
        }
        throw commitErr;
      } finally {
        if (txnClient) txnClient.release();
      }

    } catch (pipelineErr) {
      console.error(`[IndexingService] Indexing failed for version ${versionId}:`, pipelineErr.message);
      // Mark version as FAILED, preserving any existing chunks from previous runs
      try {
        await db.query(`
          UPDATE ai_document_versions
          SET indexing_status = 'FAILED',
              indexing_error = $1,
              indexing_diagnostics = jsonb_build_object(
                'failure_reason', $1::text,
                'failed_at', NOW(),
                'details', $2::jsonb
              )
          WHERE id = $3 AND document_id = $4;
        `, [
          pipelineErr.message,
          JSON.stringify(pipelineErr.diagnostics || {}),
          versionId,
          documentId
        ]);
      } catch (_) {}
    } finally {
      // 9. Outer finally: Guaranteed lock release and cleanup
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (lockAcquired && dedicatedClient) {
        try {
          await dedicatedClient.query(`
            SELECT pg_advisory_unlock(hashtext($1::text)::integer, hashtext($2::text)::integer)
          `, [ADVISORY_LOCK_CLASS_NAME, versionId]);
        } catch (_) {}
      }
      if (dedicatedClient) {
        dedicatedClient.release();
      }
      activeInFlightIndexings.delete(versionId);
    }
  })();

  return {
    versionId,
    documentId,
    projectId,
    extractionId,
    indexingStatus: 'PROCESSING',
    isReindex,
    pipelinePromise
  };
}

/**
 * Retrieves the current indexing status and diagnostics for a document version.
 */
async function getIndexingStatus({ projectId, documentId, versionId }) {
  const res = await db.query(`
    SELECT v.id as version_id, v.document_id, d.project_id, v.indexing_status, v.total_chunks,
           v.indexing_error, v.indexing_last_heartbeat_at, v.indexed_at, v.indexing_diagnostics,
           e.id as active_extraction_id, e.status as extraction_status, e.total_units
    FROM ai_document_versions v
    JOIN ai_documents d ON d.id = v.document_id
    LEFT JOIN ai_document_extractions e ON e.version_id = v.id AND e.is_active = TRUE
    WHERE v.id = $1 AND v.document_id = $2 AND d.project_id = $3;
  `, [versionId, documentId, projectId]);

  if (!res.rows || res.rows.length === 0) {
    const err = new Error('Document version not found.');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const row = res.rows[0];

  // Map to unified API status
  let apiStatus = row.indexing_status;
  if (row.indexing_status === 'PENDING') {
    if (!row.active_extraction_id || row.extraction_status !== 'COMPLETED') {
      apiStatus = 'WAITING_FOR_EXTRACTION';
    } else {
      apiStatus = 'READY_TO_INDEX';
    }
  } else if (row.indexing_status === 'FAILED' && row.total_chunks > 0) {
    apiStatus = 'FAILED_RETRY';
  }

  return {
    versionId: row.version_id,
    documentId: row.document_id,
    projectId: row.project_id,
    extractionId: row.active_extraction_id,
    indexingStatus: apiStatus,
    rawStatus: row.indexing_status,
    totalChunks: parseInt(row.total_chunks, 10) || 0,
    indexingError: row.indexing_error,
    lastHeartbeatAt: row.indexing_last_heartbeat_at,
    indexedAt: row.indexed_at,
    diagnostics: row.indexing_diagnostics || {}
  };
}

/**
 * Retrieves chunks for a document version with optional plain text search.
 * Filters strictly by the version's active extraction.
 */
async function getDocumentChunks({ projectId, documentId, versionId, search = '', limit = 50, offset = 0 }) {
  // Verify document version and get active extraction ID
  const activeExtRes = await db.query(`
    SELECT e.id as extraction_id
    FROM ai_document_extractions e
    JOIN ai_documents d ON d.id = e.document_id
    WHERE e.version_id = $1 
      AND e.document_id = $2 
      AND d.project_id = $3
      AND e.is_active = TRUE;
  `, [versionId, documentId, projectId]);

  if (!activeExtRes.rows || activeExtRes.rows.length === 0) {
    return { chunks: [], totalCount: 0, extractionId: null };
  }

  const extractionId = activeExtRes.rows[0].extraction_id;
  const params = [extractionId, versionId, documentId, projectId];
  let searchClause = '';

  if (search && typeof search === 'string' && search.trim().length > 0) {
    params.push(`%${search.trim()}%`);
    searchClause = ` AND c.content ILIKE $${params.length}`;
  }

  // Count query
  const countRes = await db.query(`
    SELECT COUNT(*) as total
    FROM ai_document_chunks c
    WHERE c.extraction_id = $1 
      AND c.version_id = $2 
      AND c.document_id = $3 
      AND c.project_id = $4
      ${searchClause};
  `, params);

  const totalCount = parseInt(countRes.rows[0].total, 10) || 0;

  // Items query
  params.push(Math.min(parseInt(limit, 10) || 50, 100));
  params.push(Math.max(parseInt(offset, 10) || 0, 0));

  const itemsRes = await db.query(`
    SELECT c.id, c.chunk_index, c.content, c.token_count, c.page_number, c.section_heading,
           c.metadata, c.created_at,
           (SELECT e.model_id FROM ai_document_embeddings e WHERE e.chunk_id = c.id LIMIT 1) as model_id
    FROM ai_document_chunks c
    WHERE c.extraction_id = $1 
      AND c.version_id = $2 
      AND c.document_id = $3 
      AND c.project_id = $4
      ${searchClause}
    ORDER BY c.chunk_index ASC
    LIMIT $${params.length - 1} OFFSET $${params.length};
  `, params);

  return {
    extractionId,
    versionId,
    documentId,
    projectId,
    totalCount,
    chunks: itemsRes.rows.map(c => ({
      id: c.id,
      chunkIndex: c.chunk_index,
      content: c.content,
      tokenCount: c.token_count,
      pageNumber: c.page_number,
      sectionHeading: c.section_heading,
      metadata: c.metadata,
      hasEmbedding: !!c.model_id,
      createdAt: c.created_at
    }))
  };
}

/**
 * Retrieves a single chunk and its embedding vector preview.
 */
async function getChunkDetails({ projectId, documentId, versionId, chunkId }) {
  const res = await db.query(`
    SELECT c.id, c.extraction_id, c.version_id, c.document_id, c.project_id,
           c.chunk_index, c.content, c.token_count, c.page_number, c.section_heading,
           c.metadata, c.created_at,
           e.id as embedding_id, e.model_id, cfg.model_name,
           e.embedding::text as vector_text
    FROM ai_document_chunks c
    LEFT JOIN ai_document_embeddings e ON e.chunk_id = c.id
    LEFT JOIN ai_embedding_config cfg ON cfg.id = e.model_id
    WHERE c.id = $1 
      AND c.version_id = $2 
      AND c.document_id = $3 
      AND c.project_id = $4;
  `, [chunkId, versionId, documentId, projectId]);

  if (!res.rows || res.rows.length === 0) {
    const err = new Error('Chunk not found.');
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }

  const row = res.rows[0];
  let vectorPreview = null;
  let vectorDimensions = 0;

  if (row.vector_text) {
    try {
      const parsed = JSON.parse(row.vector_text);
      if (Array.isArray(parsed)) {
        vectorDimensions = parsed.length;
        // Preview first 5 and last 5 elements
        vectorPreview = {
          dimensions: parsed.length,
          sample: parsed.slice(0, 5),
          isNormalized: true
        };
      }
    } catch (_) {}
  }

  return {
    id: row.id,
    extractionId: row.extraction_id,
    versionId: row.version_id,
    documentId: row.document_id,
    projectId: row.project_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    tokenCount: row.token_count,
    pageNumber: row.page_number,
    sectionHeading: row.section_heading,
    metadata: row.metadata,
    createdAt: row.created_at,
    embedding: {
      id: row.embedding_id,
      modelId: row.model_id,
      modelName: row.model_name,
      dimensions: vectorDimensions,
      preview: vectorPreview
    }
  };
}

/**
 * Sweeper: Identifies and recovers stale indexing attempts.
 * Protected by pg_locks advisory lock inspection to ensure delayed heartbeats
 * never cause an active live job to be marked FAILED.
 */
async function recoverStaleIndexings() {
  try {
    const candidateRes = await db.query(`
      SELECT id, document_id, total_chunks, indexing_last_heartbeat_at
      FROM ai_document_versions
      WHERE indexing_status = 'PROCESSING'
        AND indexing_last_heartbeat_at < NOW() - INTERVAL '${STALE_INDEXING_TIMEOUT_MINUTES} minutes';
    `);

    if (!candidateRes.rows || candidateRes.rows.length === 0) {
      return { recoveredCount: 0, preservedCount: 0 };
    }

    let recoveredCount = 0;
    let preservedCount = 0;

    for (const row of candidateRes.rows) {
      const versionId = row.id;

      // Inspect PostgreSQL pg_locks directly
      const lockCheck = await checkAdvisoryLockHeldInDb(versionId);

      if (lockCheck.isHeld) {
        // Advisory lock is still held by a live backend session!
        // Heartbeat was delayed (e.g. CPU inference load), but process is LIVE.
        console.warn(`[IndexingSweeper] Version ${versionId} heartbeat delayed (>5m) but session advisory lock active (PID ${lockCheck.pid}). Preserving active job.`);
        preservedCount++;
        continue;
      }

      // No lock found in pg_locks: the worker process is truly dead / abandoned
      console.warn(`[IndexingSweeper] Recovering dead indexing for version ${versionId} (heartbeat expired, no active lock). Marking FAILED.`);
      await db.query(`
        UPDATE ai_document_versions
        SET indexing_status = 'FAILED',
            indexing_error = 'Indexing timed out without heartbeat updates and no active session advisory lock was found.',
            indexing_diagnostics = jsonb_build_object(
              'reason', 'STALE_HEARTBEAT_NO_LOCK',
              'heartbeat_last_seen', indexing_last_heartbeat_at,
              'recovered_at', NOW()
            )
        WHERE id = $1 AND indexing_status = 'PROCESSING';
      `, [versionId]);

      activeInFlightIndexings.delete(versionId);
      recoveredCount++;
    }

    return { recoveredCount, preservedCount };
  } catch (err) {
    console.error('[IndexingSweeper] Error running stale indexing recovery:', err.message);
    return { recoveredCount: 0, preservedCount: 0, error: err.message };
  }
}

let periodicIndexingTimer = null;

/**
 * Starts periodic background sweeping of stale PROCESSING indexing records.
 * Default: sweeps every 60 seconds.
 */
function startPeriodicStaleRecovery(intervalMs = 60000) {
  if (periodicIndexingTimer) return;
  periodicIndexingTimer = setInterval(async () => {
    try {
      await recoverStaleIndexings();
    } catch (err) {
      console.error('[IndexingService] Periodic stale recovery error:', err.message);
    }
  }, intervalMs);
  if (periodicIndexingTimer.unref) periodicIndexingTimer.unref();
}

/**
 * Stops the periodic background sweeper.
 */
function stopPeriodicStaleRecovery() {
  if (periodicIndexingTimer) {
    clearInterval(periodicIndexingTimer);
    periodicIndexingTimer = null;
  }
}

module.exports = {
  indexDocumentVersion,
  getIndexingStatus,
  getDocumentChunks,
  getChunkDetails,
  recoverStaleIndexings,
  startPeriodicStaleRecovery,
  stopPeriodicStaleRecovery,
  checkAdvisoryLockHeldInDb,
  getAdvisoryLockKeys,
  activeInFlightIndexings,
  ADVISORY_LOCK_CLASS_NAME
};
