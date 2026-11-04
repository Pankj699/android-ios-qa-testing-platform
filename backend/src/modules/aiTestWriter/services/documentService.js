const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../db/connection');
const fileValidationService = require('./fileValidationService');
const storageService = require('./storageService');

/**
 * Sanitizes document version object for API output (never exposing storage_path).
 */
function sanitizeVersion(ver) {
  if (!ver) return null;
  const { storage_path, ...safeVer } = ver;
  return safeVer;
}

/**
 * Sanitizes document object for API output.
 */
function sanitizeDocument(doc) {
  if (!doc) return null;
  const { storage_path, ...safeDoc } = doc;
  if (Array.isArray(safeDoc.versions)) {
    safeDoc.versions = safeDoc.versions.map(sanitizeVersion);
  }
  return safeDoc;
}

/**
 * Uploads a new document into an existing project.
 * Implements the approved sequence:
 * 1. Validate file (type, magic bytes, ZIP bomb/macro checks, encoding)
 * 2. Write to temporary staging
 * 3. Generate permanent storage path
 * 4. Move staged file to permanent storage
 * 5. Start DB transaction
 * 6. Acquire project/hash advisory lock (pg_advisory_xact_lock)
 * 7. Check for duplicate content within project scope
 * 8. Insert document and version records
 * 9. Update active-version pointer
 * 10. Commit transaction
 * (Removes permanent file if DB transaction fails)
 */
async function uploadDocument({ projectId, userId, fileBuffer, originalFilename, title = null }) {
  // 1. Validate file
  const { documentType, sanitizedFilename, fileSize } = fileValidationService.validateFile(
    fileBuffer,
    originalFilename
  );

  const sha256Hash = storageService.computeSha256(fileBuffer);
  const ext = path.extname(sanitizedFilename).slice(1).toLowerCase();
  const docTitle = (title && typeof title === 'string' && title.trim())
    ? title.trim()
    : path.parse(sanitizedFilename).name;

  // 2. Write to temporary staging
  const stagedPath = storageService.writeToStaging(fileBuffer, ext);

  const docId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  let permanentStoragePath = null;
  let client = null;

  try {
    // 3. Generate permanent storage path
    permanentStoragePath = storageService.generatePermanentStoragePath(docId, 1, ext);

    // 4. Move staged file to permanent storage
    storageService.moveToPermanent(stagedPath, permanentStoragePath);

    // 5. Start PostgreSQL transaction
    client = await db.getClient();
    await client.query('BEGIN');

    // 6. Acquire transaction-level advisory lock scoped to (projectId, sha256Hash)
    // Serializes concurrent uploads of the same file into the same project
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
      [projectId, sha256Hash]
    );

    // 7. Check for duplicate content in this project
    const dupCheck = await client.query(`
      SELECT v.id, v.document_id, v.version_number, d.title, d.original_filename
      FROM ai_document_versions v
      JOIN ai_documents d ON d.id = v.document_id
      WHERE d.project_id = $1 AND v.sha256_hash = $2
      LIMIT 1
    `, [projectId, sha256Hash]);

    if (dupCheck.rows.length > 0) {
      const existing = dupCheck.rows[0];
      const err = new Error(
        `Duplicate document: An identical file already exists in this project ("${existing.original_filename}", version ${existing.version_number}).`
      );
      err.status = 409;
      err.code = 'DUPLICATE_DOCUMENT';
      err.existingDocument = {
        id: existing.document_id,
        title: existing.title,
        version: existing.version_number
      };
      throw err;
    }

    // 8. Insert document record
    await client.query(`
      INSERT INTO ai_documents (
        id, project_id, title, original_filename, document_type, created_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [docId, projectId, docTitle, sanitizedFilename, documentType, userId]);

    // 8b. Insert version record with indexing_status = 'PENDING'
    await client.query(`
      INSERT INTO ai_document_versions (
        id, document_id, version_number, sha256_hash, file_size_bytes,
        storage_path, indexing_status, uploaded_by_user_id
      ) VALUES ($1, $2, 1, $3, $4, $5, 'PENDING', $6)
    `, [versionId, docId, sha256Hash, fileSize, permanentStoragePath, userId]);

    // 9. Update active-version pointer (enforcing circular FK)
    await client.query(`
      UPDATE ai_documents 
      SET active_version_id = $1, updated_at = NOW() 
      WHERE id = $2
    `, [versionId, docId]);

    // 10. Commit transaction
    await client.query('COMMIT');

    // Fetch created document and version for response
    const docRes = await client.query(`
      SELECT d.*, v.version_number, v.sha256_hash, v.file_size_bytes, v.indexing_status, v.created_at as version_created_at
      FROM ai_documents d
      JOIN ai_document_versions v ON v.id = d.active_version_id
      WHERE d.id = $1
    `, [docId]);

    return sanitizeDocument(docRes.rows[0]);
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    // Clean up staged or permanent file if transaction failed
    storageService.safeUnlink(stagedPath);
    if (permanentStoragePath) {
      storageService.safeUnlink(permanentStoragePath);
    }
    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Uploads a new version for an existing document.
 * Synchronizes with document deletion by locking the parent document row FOR UPDATE.
 */
async function createDocumentVersion({ projectId, documentId, userId, fileBuffer, originalFilename, changeSummary = null }) {
  // 1. Validate file
  const { documentType, sanitizedFilename, fileSize } = fileValidationService.validateFile(
    fileBuffer,
    originalFilename
  );

  const sha256Hash = storageService.computeSha256(fileBuffer);
  const ext = path.extname(sanitizedFilename).slice(1).toLowerCase();

  // 2. Write to staging
  const stagedPath = storageService.writeToStaging(fileBuffer, ext);

  let permanentStoragePath = null;
  let client = null;

  try {
    client = await db.getClient();
    await client.query('BEGIN');

    // 3. Acquire parent document row lock FOR UPDATE (synchronization point against concurrent deletions/versions)
    const docLock = await client.query(`
      SELECT id, project_id, document_type, active_version_id, original_filename
      FROM ai_documents
      WHERE id = $1 AND project_id = $2
      FOR UPDATE
    `, [documentId, projectId]);

    if (docLock.rows.length === 0) {
      const err = new Error('Document not found in specified project.');
      err.status = 404;
      throw err;
    }

    const doc = docLock.rows[0];

    // Ensure document type matches original document
    if (doc.document_type !== documentType) {
      const err = new Error(
        `Version document type mismatch. Expected ${doc.document_type}, but uploaded file is ${documentType}.`
      );
      err.status = 400;
      throw err;
    }

    // 4. Acquire project/hash advisory lock
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1::text), hashtext($2::text))',
      [projectId, sha256Hash]
    );

    // 5. Check duplicate content within project
    const dupCheck = await client.query(`
      SELECT v.id, v.document_id, v.version_number
      FROM ai_document_versions v
      JOIN ai_documents d ON d.id = v.document_id
      WHERE d.project_id = $1 AND v.sha256_hash = $2
      LIMIT 1
    `, [projectId, sha256Hash]);

    if (dupCheck.rows.length > 0) {
      const existing = dupCheck.rows[0];
      const err = new Error(
        `Duplicate content: This exact file content is already present as version ${existing.version_number}.`
      );
      err.status = 409;
      err.code = 'DUPLICATE_DOCUMENT';
      throw err;
    }

    // Determine next version number
    const maxVerRes = await client.query(`
      SELECT COALESCE(MAX(version_number), 0) as max_ver
      FROM ai_document_versions
      WHERE document_id = $1
    `, [documentId]);
    const nextVersionNumber = parseInt(maxVerRes.rows[0].max_ver, 10) + 1;

    // 6. Generate permanent path and move staged file
    permanentStoragePath = storageService.generatePermanentStoragePath(documentId, nextVersionNumber, ext);
    storageService.moveToPermanent(stagedPath, permanentStoragePath);

    // 7. Insert new version record
    const versionId = crypto.randomUUID();
    await client.query(`
      INSERT INTO ai_document_versions (
        id, document_id, version_number, sha256_hash, file_size_bytes,
        storage_path, indexing_status, change_summary, uploaded_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8)
    `, [versionId, documentId, nextVersionNumber, sha256Hash, fileSize, permanentStoragePath, changeSummary || null, userId]);

    // 8. Transactionally update active-version pointer to the newly created version
    await client.query(`
      UPDATE ai_documents
      SET active_version_id = $1, updated_at = NOW()
      WHERE id = $2 AND project_id = $3
    `, [versionId, documentId, projectId]);

    // 9. Commit transaction
    await client.query('COMMIT');

    const resultRes = await client.query(`
      SELECT d.*, v.id as version_id, v.version_number, v.sha256_hash, v.file_size_bytes, v.indexing_status, v.created_at as version_created_at
      FROM ai_documents d
      JOIN ai_document_versions v ON v.id = d.active_version_id
      WHERE d.id = $1
    `, [documentId]);

    return sanitizeDocument(resultRes.rows[0]);
  } catch (err) {
    if (client) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    storageService.safeUnlink(stagedPath);
    if (permanentStoragePath) {
      storageService.safeUnlink(permanentStoragePath);
    }
    throw err;
  } finally {
    if (client) {
      client.release();
    }
  }
}

/**
 * Activates an existing version of a document.
 * Synchronizes with parent document row lock FOR UPDATE.
 */
async function activateVersion({ projectId, documentId, versionId }) {
  let client = null;
  try {
    client = await db.getClient();
    await client.query('BEGIN');

    // 1. Lock parent document row FOR UPDATE
    const docLock = await client.query(`
      SELECT id, active_version_id FROM ai_documents
      WHERE id = $1 AND project_id = $2
      FOR UPDATE
    `, [documentId, projectId]);

    if (docLock.rows.length === 0) {
      const err = new Error('Document not found in specified project.');
      err.status = 404;
      throw err;
    }

    // 2. Verify target version belongs to this document
    const verRes = await client.query(`
      SELECT id, version_number, indexing_status
      FROM ai_document_versions
      WHERE id = $1 AND document_id = $2
    `, [versionId, documentId]);

    if (verRes.rows.length === 0) {
      const err = new Error('Version does not belong to the specified document.');
      err.status = 404;
      throw err;
    }

    // 3. Transactionally update active_version_id
    await client.query(`
      UPDATE ai_documents
      SET active_version_id = $1, updated_at = NOW()
      WHERE id = $2 AND project_id = $3
    `, [versionId, documentId, projectId]);

    await client.query('COMMIT');

    const updated = await client.query(`
      SELECT d.*, v.version_number, v.indexing_status
      FROM ai_documents d
      JOIN ai_document_versions v ON v.id = d.active_version_id
      WHERE d.id = $1
    `, [documentId]);

    return sanitizeDocument(updated.rows[0]);
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
}

/**
 * Deletes a document and all its versions.
 * Synchronizes via parent document row lock FOR UPDATE.
 * Collects storage paths before DB deletion, commits DB, then unlinks physical files.
 */
async function deleteDocument({ projectId, documentId }) {
  let client = null;
  let storagePathsToUnlink = [];

  try {
    client = await db.getClient();
    await client.query('BEGIN');

    // 1. Acquire parent document row lock FOR UPDATE
    const docLock = await client.query(`
      SELECT id, title, original_filename FROM ai_documents
      WHERE id = $1 AND project_id = $2
      FOR UPDATE
    `, [documentId, projectId]);

    if (docLock.rows.length === 0) {
      const err = new Error('Document not found in specified project.');
      err.status = 404;
      throw err;
    }

    // 2. Collect all version storage paths while holding the lock
    const pathsRes = await client.query(`
      SELECT storage_path FROM ai_document_versions WHERE document_id = $1
    `, [documentId]);
    storagePathsToUnlink = pathsRes.rows.map(r => r.storage_path);

    // 3. Delete document in DB (cascades to ai_document_versions)
    await client.query(`
      DELETE FROM ai_documents WHERE id = $1 AND project_id = $2
    `, [documentId, projectId]);

    // 4. Commit transaction
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

  // 5. Post-commit: unlink physical files from storage
  for (const filePath of storagePathsToUnlink) {
    storageService.safeUnlink(filePath);
  }

  return { success: true, deletedDocumentId: documentId };
}

/**
 * Lists all documents in a project with active version details and extraction status.
 */
async function listDocuments(projectId) {
  const res = await db.query(`
    SELECT 
      d.id,
      d.project_id,
      d.title,
      d.original_filename,
      d.document_type,
      d.active_version_id,
      d.created_by_user_id,
      d.created_at,
      d.updated_at,
      v.version_number,
      v.sha256_hash,
      v.file_size_bytes,
      v.indexing_status,
      v.total_chunks as indexing_total_chunks,
      v.indexing_error,
      v.created_at as active_version_created_at,
      (SELECT count(*) FROM ai_document_versions dv WHERE dv.document_id = d.id) as version_count,
      ext.status as extraction_status,
      ext.total_units as extraction_total_units,
      ext.warning_count as extraction_warning_count,
      ext.warnings as extraction_warnings,
      ext.error_message as extraction_error_message,
      ext.completed_at as extraction_completed_at
    FROM ai_documents d
    LEFT JOIN ai_document_versions v ON v.id = d.active_version_id
    LEFT JOIN LATERAL (
      SELECT status, total_units, warning_count, warnings, error_message, completed_at
      FROM ai_document_extractions
      WHERE version_id = d.active_version_id
      ORDER BY is_active DESC, attempt_number DESC
      LIMIT 1
    ) ext ON TRUE
    WHERE d.project_id = $1
    ORDER BY d.updated_at DESC
  `, [projectId]);

  return res.rows.map(sanitizeDocument);
}

/**
 * Retrieves a single document with complete version history and extraction status.
 */
async function getDocumentById(documentId) {
  const docRes = await db.query(`
    SELECT 
      d.*,
      v.version_number as active_version_number,
      v.indexing_status as active_indexing_status,
      ext.status as extraction_status,
      ext.total_units as extraction_total_units,
      ext.warning_count as extraction_warning_count,
      ext.warnings as extraction_warnings,
      ext.error_message as extraction_error_message,
      ext.completed_at as extraction_completed_at
    FROM ai_documents d
    LEFT JOIN ai_document_versions v ON v.id = d.active_version_id
    LEFT JOIN LATERAL (
      SELECT status, total_units, warning_count, warnings, error_message, completed_at
      FROM ai_document_extractions
      WHERE version_id = d.active_version_id
      ORDER BY is_active DESC, attempt_number DESC
      LIMIT 1
    ) ext ON TRUE
    WHERE d.id = $1
  `, [documentId]);

  if (docRes.rows.length === 0) {
    const err = new Error('Document not found.');
    err.status = 404;
    throw err;
  }

  const versionsRes = await db.query(`
    SELECT 
      dv.id, dv.document_id, dv.version_number, dv.sha256_hash, dv.file_size_bytes, dv.indexing_status,
      dv.change_summary, dv.uploaded_by_user_id, dv.created_at, dv.indexed_at,
      ext.status as extraction_status,
      ext.total_units as extraction_total_units,
      ext.warning_count as extraction_warning_count,
      ext.warnings as extraction_warnings,
      ext.error_message as extraction_error_message,
      ext.completed_at as extraction_completed_at
    FROM ai_document_versions dv
    LEFT JOIN LATERAL (
      SELECT status, total_units, warning_count, warnings, error_message, completed_at
      FROM ai_document_extractions
      WHERE version_id = dv.id
      ORDER BY is_active DESC, attempt_number DESC
      LIMIT 1
    ) ext ON TRUE
    WHERE dv.document_id = $1
    ORDER BY dv.version_number DESC
  `, [documentId]);

  const doc = sanitizeDocument(docRes.rows[0]);
  doc.versions = versionsRes.rows.map(sanitizeVersion);

  return doc;
}

/**
 * Resolves a safe read stream for document download.
 */
async function getDownloadStream(documentId, versionId = null) {
  let query = `
    SELECT d.original_filename, d.document_type, v.id as version_id, v.storage_path, v.file_size_bytes
    FROM ai_documents d
    JOIN ai_document_versions v ON v.document_id = d.id
    WHERE d.id = $1
  `;
  const params = [documentId];

  if (versionId) {
    query += ' AND v.id = $2';
    params.push(versionId);
  } else {
    query += ' AND v.id = d.active_version_id';
  }

  const res = await db.query(query, params);
  if (res.rows.length === 0) {
    const err = new Error('Document version not found.');
    err.status = 404;
    throw err;
  }

  const row = res.rows[0];
  const safePath = storageService.assertSafePath(row.storage_path);

  if (!fs.existsSync(safePath)) {
    const err = new Error('Physical storage file is missing.');
    err.status = 404;
    throw err;
  }

  return {
    stream: fs.createReadStream(safePath),
    originalFilename: row.original_filename,
    documentType: row.document_type,
    fileSize: row.file_size_bytes
  };
}

/**
 * Resolves safe preview stream for eligible documents (PDF, TXT, CSV).
 * DOCX and XLSX return an error advising download.
 */
async function getPreviewStream(documentId, versionId = null) {
  const downloadInfo = await getDownloadStream(documentId, versionId);

  const docType = downloadInfo.documentType.toUpperCase();
  if (docType === 'DOCX' || docType === 'XLSX') {
    const err = new Error(`Inline preview is not supported for ${docType} files. Please download the document.`);
    err.status = 400;
    err.code = 'PREVIEW_NOT_SUPPORTED';
    throw err;
  }

  let contentType = 'application/octet-stream';
  if (docType === 'PDF') {
    contentType = 'application/pdf';
  } else if (docType === 'TXT') {
    contentType = 'text/plain; charset=utf-8';
  } else if (docType === 'CSV') {
    contentType = 'text/csv; charset=utf-8';
  }

  return {
    ...downloadInfo,
    contentType
  };
}

module.exports = {
  uploadDocument,
  createDocumentVersion,
  activateVersion,
  deleteDocument,
  listDocuments,
  getDocumentById,
  getDownloadStream,
  getPreviewStream,
  sanitizeDocument,
  sanitizeVersion
};
