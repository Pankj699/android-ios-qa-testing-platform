const fs = require('fs');
const crypto = require('crypto');
const db = require('../db/connection');
const storageService = require('./storageService');
const pdfParser = require('./parsers/pdfParser');
const docxParser = require('./parsers/docxParser');
const xlsxParser = require('./parsers/xlsxParser');
const csvParser = require('./parsers/csvParser');
const txtParser = require('./parsers/txtParser');

// In-memory set tracking currently executing extraction version IDs to prevent simultaneous duplicate runs
const activeInFlightExtractions = new Set();

let periodicRecoveryTimer = null;

/**
 * Recovers stale PROCESSING extractions on application startup or periodic recovery check.
 * Identifies extractions stuck in 'PROCESSING' whose heartbeat is older than threshold
 * and marks them FAILED with clear diagnostic messaging.
 * Safely excludes locally in-flight extractions whose event loop is active.
 */
async function recoverStaleExtractions(staleThresholdMs = 300000) {
  const cutoff = new Date(Date.now() - staleThresholdMs);
  const activeIds = Array.from(activeInFlightExtractions);
  const queryParams = [cutoff];
  let excludeClause = '';
  if (activeIds.length > 0) {
    queryParams.push(activeIds);
    excludeClause = ' AND NOT (version_id = ANY($2::uuid[]))';
  }

  const result = await db.query(`
    UPDATE ai_document_extractions
    SET 
      status = 'FAILED',
      error_message = 'ExtractionInterrupted: Processing was interrupted by a process restart or crash.',
      internal_diagnostics = jsonb_build_object(
        'recovered_at', NOW(),
        'reason', 'STALE_HEARTBEAT_RECOVERY',
        'last_heartbeat_at', last_heartbeat_at
      ),
      completed_at = NOW(),
      updated_at = NOW()
    WHERE status = 'PROCESSING'
      AND last_heartbeat_at < $1${excludeClause}
    RETURNING id, version_id, attempt_number
  `, queryParams);

  if (result.rows.length > 0) {
    console.log(`[ExtractionService] Recovered ${result.rows.length} stale PROCESSING extraction(s).`);
  }
  return result.rows;
}

/**
 * Starts periodic background sweeping of stale PROCESSING records.
 * Default: sweeps every 5 minutes for jobs whose heartbeat is older than 5 minutes.
 */
function startPeriodicStaleRecovery(intervalMs = 300000, staleThresholdMs = 300000) {
  if (periodicRecoveryTimer) return;
  periodicRecoveryTimer = setInterval(async () => {
    try {
      await recoverStaleExtractions(staleThresholdMs);
    } catch (err) {
      console.error('[ExtractionService] Periodic stale recovery error:', err.message);
    }
  }, intervalMs);
  if (periodicRecoveryTimer.unref) periodicRecoveryTimer.unref();
}

/**
 * Stops periodic background sweeping of stale PROCESSING records.
 */
function stopPeriodicStaleRecovery() {
  if (periodicRecoveryTimer) {
    clearInterval(periodicRecoveryTimer);
    periodicRecoveryTimer = null;
  }
}

/**
 * Dispatches file buffer to the appropriate format parser based on documentType.
 */
async function dispatchParser(documentType, fileBuffer, originalFilename) {
  const type = (documentType || '').toUpperCase();
  switch (type) {
    case 'PDF':
      return await pdfParser.parsePdf(fileBuffer, originalFilename);
    case 'DOCX':
      return docxParser.parseDocx(fileBuffer, originalFilename);
    case 'XLSX':
      return await xlsxParser.parseXlsx(fileBuffer, originalFilename);
    case 'CSV':
      return csvParser.parseCsv(fileBuffer, originalFilename);
    case 'TXT':
      return txtParser.parseTxt(fileBuffer, originalFilename);
    default:
      throw new Error(`Unsupported document type for extraction: ${type}`);
  }
}

/**
 * Initiates or reprocesses extraction for a document version.
 * Implements safe reprocessing:
 * - Next attempt is created separately in PROCESSING state with is_active = FALSE.
 * - Any existing successful extraction remains is_active = TRUE and queryable during processing.
 * - Concurrent extractions on the same version are rejected or serialized.
 * - Upon success, units are replaced transactionally.
 * - Upon failure, previous active extraction remains preserved.
 */
async function extractDocumentVersion({ projectId, documentId, versionId, userId, isReprocess = false }) {
  // 1. Guard against duplicate in-flight processing in memory
  if (activeInFlightExtractions.has(versionId)) {
    const err = new Error('Extraction is already in progress for this document version.');
    err.status = 409;
    err.code = 'EXTRACTION_IN_PROGRESS';
    throw err;
  }

  let client = null;
  let extractionId = null;
  let attemptNumber = 1;
  let storagePath = null;
  let documentType = null;
  let originalFilename = null;

  try {
    client = await db.getClient();
    await client.query('BEGIN');

    // Advisory lock per version to serialize concurrent DB triggers
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
      ['ai_extraction', versionId]
    );

    // Verify document and version ownership under project
    const verRes = await client.query(`
      SELECT 
        v.id as version_id,
        v.version_number,
        v.storage_path,
        d.id as document_id,
        d.project_id,
        d.document_type,
        d.original_filename
      FROM ai_document_versions v
      JOIN ai_documents d ON d.id = v.document_id
      WHERE v.id = $1 AND d.id = $2 AND d.project_id = $3
      FOR UPDATE OF v
    `, [versionId, documentId, projectId]);

    if (verRes.rows.length === 0) {
      const err = new Error('Document version not found in specified project.');
      err.status = 404;
      throw err;
    }

    const row = verRes.rows[0];
    storagePath = row.storage_path;
    documentType = row.document_type;
    originalFilename = row.original_filename;

    // Check if an extraction is already marked PROCESSING in DB
    const runningCheck = await client.query(`
      SELECT id, attempt_number FROM ai_document_extractions
      WHERE version_id = $1 AND status = 'PROCESSING'
      LIMIT 1
    `, [versionId]);

    if (runningCheck.rows.length > 0) {
      const err = new Error('Extraction is already in progress for this document version.');
      err.status = 409;
      err.code = 'EXTRACTION_IN_PROGRESS';
      throw err;
    }

    // Determine attempt number
    const maxAttemptRes = await client.query(`
      SELECT COALESCE(MAX(attempt_number), 0) as max_attempt
      FROM ai_document_extractions
      WHERE version_id = $1
    `, [versionId]);
    attemptNumber = parseInt(maxAttemptRes.rows[0].max_attempt, 10) + 1;

    // Create new extraction record in PROCESSING state (is_active = FALSE)
    extractionId = crypto.randomUUID();
    await client.query(`
      INSERT INTO ai_document_extractions (
        id, version_id, document_id, project_id, status, is_active,
        attempt_number, started_at, last_heartbeat_at
      ) VALUES ($1, $2, $3, $4, 'PROCESSING', FALSE, $5, NOW(), NOW())
    `, [extractionId, versionId, documentId, projectId, attemptNumber]);

    await client.query('COMMIT');
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }

  // Mark in-flight in memory
  activeInFlightExtractions.add(versionId);

  // Execute extraction asynchronously (non-blocking for Express HTTP response)
  // Return the initial PROCESSING extraction metadata immediately
  const initialExtraction = {
    id: extractionId,
    versionId,
    documentId,
    projectId,
    status: 'PROCESSING',
    is_active: false,
    attemptNumber,
    startedAt: new Date().toISOString()
  };

  // Run in-process async pipeline
  setImmediate(async () => {
    let heartbeatTimer = null;
    try {
      // Setup periodic heartbeat while processing
      heartbeatTimer = setInterval(async () => {
        try {
          await db.query(`
            UPDATE ai_document_extractions
            SET last_heartbeat_at = NOW()
            WHERE id = $1 AND status = 'PROCESSING'
          `, [extractionId]);
        } catch (_) {}
      }, 5000);

      // 1. Read source file safely from disk
      const safePath = storageService.assertSafePath(storagePath);
      if (!fs.existsSync(safePath)) {
        throw new Error(`Physical document file is missing on storage: ${safePath}`);
      }
      const fileBuffer = fs.readFileSync(safePath);

      // 2. Dispatch to format parser
      const parseResult = await module.exports.dispatchParser(documentType, fileBuffer, originalFilename);
      const { units, warnings, metadata } = parseResult;

      // 3. Persist units and update status transactionally
      let txnClient = null;
      try {
        txnClient = await db.getClient();
        await txnClient.query('BEGIN');

        // Advisory lock during completion
        await txnClient.query(
          'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
          ['ai_extraction_complete', versionId]
        );

        // Explicit row-level lock on the currently active extraction (if any)
        // Coordinates with concurrent indexing transactions holding FOR SHARE on that row
        await txnClient.query(`
          SELECT id FROM ai_document_extractions
          WHERE version_id = $1 AND id != $2 AND is_active = TRUE
          FOR UPDATE
        `, [versionId, extractionId]);

        // Batch insert extracted units
        if (units && units.length > 0) {
          // Chunk inserts in batches of 500 to keep parameter counts well within limits
          const BATCH_SIZE = 500;
          for (let b = 0; b < units.length; b += BATCH_SIZE) {
            const batch = units.slice(b, b + BATCH_SIZE);
            const valueClauses = [];
            const params = [];
            let pIdx = 1;

            for (const unit of batch) {
              valueClauses.push(
                `($${pIdx}, $${pIdx + 1}, $${pIdx + 2}, $${pIdx + 3}, $${pIdx + 4}, $${pIdx + 5}, $${pIdx + 6}, $${pIdx + 7}, $${pIdx + 8}, $${pIdx + 9}, $${pIdx + 10}, $${pIdx + 11})`
              );
              params.push(
                crypto.randomUUID(),
                extractionId,
                versionId,
                documentId,
                projectId,
                unit.sequence_number,
                unit.source_type,
                JSON.stringify(unit.source_location || {}),
                unit.source_location_display || '',
                unit.extracted_text || '',
                JSON.stringify(unit.unit_warnings || []),
                JSON.stringify(unit.metadata || {})
              );
              pIdx += 12;
            }

            const insertSql = `
              INSERT INTO ai_document_extracted_units (
                id, extraction_id, version_id, document_id, project_id,
                sequence_number, source_type, source_location, source_location_display,
                extracted_text, unit_warnings, metadata
              ) VALUES ${valueClauses.join(', ')}
            `;
            await txnClient.query(insertSql, params);
          }
        }

        // Deactivate previous active extractions for this version
        await txnClient.query(`
          UPDATE ai_document_extractions
          SET is_active = FALSE, updated_at = NOW()
          WHERE version_id = $1 AND id != $2 AND is_active = TRUE
        `, [versionId, extractionId]);

        // Clean up units of older inactive extractions to avoid storage bloat
        await txnClient.query(`
          DELETE FROM ai_document_extracted_units
          WHERE version_id = $1 AND extraction_id != $2
        `, [versionId, extractionId]);

        // Mark this extraction COMPLETED and is_active = TRUE
        await txnClient.query(`
          UPDATE ai_document_extractions
          SET 
            status = 'COMPLETED',
            is_active = TRUE,
            total_units = $1,
            warning_count = $2,
            warnings = $3,
            metadata = $4,
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = $5
        `, [
          units.length,
          warnings.length,
          JSON.stringify(warnings),
          JSON.stringify(metadata || {}),
          extractionId
        ]);

        await txnClient.query('COMMIT');
      } catch (txnErr) {
        if (txnClient) {
          try { await txnClient.query('ROLLBACK'); } catch (_) {}
        }
        throw txnErr;
      } finally {
        if (txnClient) {
          txnClient.release();
        }
      }
    } catch (execErr) {
      // Failure Handling: Mark current extraction FAILED without corrupting any previously active extraction
      console.error(`[ExtractionService] Extraction FAILED for version ${versionId} (attempt ${attemptNumber}):`, execErr.message);
      try {
        await db.query(`
          UPDATE ai_document_extractions
          SET 
            status = 'FAILED',
            error_message = $1,
            internal_diagnostics = jsonb_build_object(
              'error_code', $2::text,
              'error_stack', $3::text,
              'failed_at', NOW()
            ),
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = $4
        `, [
          execErr.message || 'Unknown extraction error',
          execErr.code || 'PARSER_ERROR',
          (execErr.stack || '').slice(0, 1000),
          extractionId
        ]);
      } catch (dbErr) {
        console.error('[ExtractionService] Failed to record extraction failure in DB:', dbErr.message);
      }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      activeInFlightExtractions.delete(versionId);
    }
  });

  return initialExtraction;
}

/**
 * Retrieves the current extraction record for a document version.
 * Prioritizes the active extraction, or falls back to the most recent attempt.
 */
async function getExtractionStatus({ projectId, documentId, versionId }) {
  const res = await db.query(`
    SELECT 
      e.id,
      e.version_id,
      e.document_id,
      e.project_id,
      e.status,
      e.is_active,
      e.attempt_number,
      e.extractor_version,
      e.total_units,
      e.warning_count,
      e.warnings,
      e.error_message,
      e.metadata,
      e.started_at,
      e.completed_at,
      e.created_at,
      e.updated_at,
      d.title as document_title,
      d.original_filename,
      d.document_type,
      v.version_number
    FROM ai_document_versions v
    JOIN ai_documents d ON d.id = v.document_id
    LEFT JOIN ai_document_extractions e ON e.version_id = v.id
    WHERE v.id = $1 AND d.id = $2 AND d.project_id = $3
    ORDER BY e.is_active DESC, e.attempt_number DESC
    LIMIT 1
  `, [versionId, documentId, projectId]);

  if (res.rows.length === 0) {
    const err = new Error('Document version not found in specified project.');
    err.status = 404;
    throw err;
  }

  const row = res.rows[0];
  if (!row.id) {
    // No extraction has been run yet
    return {
      version_id: versionId,
      document_id: documentId,
      project_id: projectId,
      status: 'PENDING',
      is_active: false,
      attempt_number: 0,
      total_units: 0,
      warning_count: 0,
      warnings: [],
      error_message: null,
      metadata: {},
      document_title: row.document_title,
      original_filename: row.original_filename,
      document_type: row.document_type,
      version_number: row.version_number
    };
  }

  return row;
}

/**
 * Retrieves paginated extracted units for a document version.
 * Queries units belonging to the currently active extraction.
 */
async function getExtractedUnits({
  projectId,
  documentId,
  versionId,
  page = 1,
  pageSize = 50,
  sourceType = null,
  search = null
}) {
  const p = Math.max(parseInt(page, 10) || 1, 1);
  const ps = Math.min(Math.max(parseInt(pageSize, 10) || 50, 1), 200);
  const offset = (p - 1) * ps;

  // 1. Verify project ownership and resolve active extraction
  const extRes = await db.query(`
    SELECT e.id, e.status, e.total_units, e.warning_count, e.warnings, e.metadata
    FROM ai_document_versions v
    JOIN ai_documents d ON d.id = v.document_id
    JOIN ai_document_extractions e ON e.version_id = v.id
    WHERE v.id = $1 AND d.id = $2 AND d.project_id = $3 AND e.is_active = TRUE
    LIMIT 1
  `, [versionId, documentId, projectId]);

  if (extRes.rows.length === 0) {
    // Check if version exists
    const verCheck = await db.query(`
      SELECT v.id FROM ai_document_versions v
      JOIN ai_documents d ON d.id = v.document_id
      WHERE v.id = $1 AND d.id = $2 AND d.project_id = $3
    `, [versionId, documentId, projectId]);

    if (verCheck.rows.length === 0) {
      const err = new Error('Document version not found in specified project.');
      err.status = 404;
      throw err;
    }

    // No active extraction
    return {
      extraction: null,
      pagination: { page: p, pageSize: ps, total: 0, totalPages: 0 },
      units: []
    };
  }

  const extraction = extRes.rows[0];

  // 2. Build units query
  let countSql = `
    SELECT count(*) as total
    FROM ai_document_extracted_units
    WHERE extraction_id = $1
  `;
  let dataSql = `
    SELECT 
      id,
      sequence_number,
      source_type,
      source_location,
      source_location_display,
      extracted_text,
      unit_warnings,
      metadata,
      created_at
    FROM ai_document_extracted_units
    WHERE extraction_id = $1
  `;
  const filterParams = [extraction.id];
  let pIdx = 2;

  if (sourceType && typeof sourceType === 'string' && sourceType.trim()) {
    countSql += ` AND source_type = $${pIdx}`;
    dataSql += ` AND source_type = $${pIdx}`;
    filterParams.push(sourceType.trim().toUpperCase());
    pIdx++;
  }

  if (search && typeof search === 'string' && search.trim()) {
    const term = `%${search.trim()}%`;
    countSql += ` AND (extracted_text ILIKE $${pIdx} OR source_location_display ILIKE $${pIdx})`;
    dataSql += ` AND (extracted_text ILIKE $${pIdx} OR source_location_display ILIKE $${pIdx})`;
    filterParams.push(term);
    pIdx++;
  }

  dataSql += ` ORDER BY sequence_number ASC LIMIT $${pIdx} OFFSET $${pIdx + 1}`;
  const dataParams = [...filterParams, ps, offset];

  const [countRes, dataRes] = await Promise.all([
    db.query(countSql, filterParams),
    db.query(dataSql, dataParams)
  ]);

  const total = parseInt(countRes.rows[0].total, 10);
  const totalPages = Math.ceil(total / ps);

  return {
    extraction: {
      id: extraction.id,
      status: extraction.status,
      totalUnits: extraction.total_units,
      warningCount: extraction.warning_count,
      warnings: extraction.warnings,
      metadata: extraction.metadata
    },
    pagination: {
      page: p,
      pageSize: ps,
      total,
      totalPages
    },
    units: dataRes.rows
  };
}

module.exports = {
  extractDocumentVersion,
  getExtractionStatus,
  getExtractedUnits,
  recoverStaleExtractions,
  startPeriodicStaleRecovery,
  stopPeriodicStaleRecovery,
  dispatchParser,
  activeInFlightExtractions
};
