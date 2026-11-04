const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STORAGE_ROOT = path.resolve('C:/Projects/ODR Test/backend/data/ai_documents');
const TMP_DIR = path.join(STORAGE_ROOT, 'tmp');
const ORPHAN_LOG_FILE = path.join(STORAGE_ROOT, '.orphaned_files.jsonl');

/**
 * Ensures required storage directories exist.
 */
function ensureStorageDirs() {
  if (!fs.existsSync(STORAGE_ROOT)) {
    fs.mkdirSync(STORAGE_ROOT, { recursive: true });
  }
  if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
  }
}

/**
 * Validates that a file path resides strictly within the approved storage root.
 * Throws an error on path traversal attempts.
 */
function assertSafePath(targetPath) {
  const resolved = path.resolve(targetPath);
  if (!resolved.startsWith(STORAGE_ROOT)) {
    const err = new Error('Access denied: Path traversal detected outside storage root.');
    err.status = 403;
    throw err;
  }
  return resolved;
}

/**
 * Computes the SHA-256 cryptographic hash of a buffer.
 */
function computeSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * Writes an uploaded buffer to temporary staging storage.
 * 
 * @param {Buffer} buffer - File buffer
 * @param {string} ext - File extension (e.g., 'pdf')
 * @returns {string} Absolute path of the staged temporary file
 */
function writeToStaging(buffer, ext) {
  ensureStorageDirs();
  const tempId = crypto.randomUUID();
  const cleanExt = (ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const stagedPath = path.join(TMP_DIR, `${tempId}.${cleanExt}`);
  fs.writeFileSync(stagedPath, buffer);
  return stagedPath;
}

/**
 * Generates an immutable, collision-free permanent storage path.
 * Format: backend/data/ai_documents/<documentId>/v<versionNumber>_<uuid>.<ext>
 */
function generatePermanentStoragePath(documentId, versionNumber, ext) {
  ensureStorageDirs();
  const cleanDocId = String(documentId).replace(/[^a-zA-Z0-9-]/g, '');
  const docDir = path.join(STORAGE_ROOT, cleanDocId);
  if (!fs.existsSync(docDir)) {
    fs.mkdirSync(docDir, { recursive: true });
  }

  const cleanExt = (ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const fileUuid = crypto.randomUUID();
  const filename = `v${versionNumber}_${fileUuid}.${cleanExt}`;
  const fullPath = path.join(docDir, filename);

  return assertSafePath(fullPath);
}

/**
 * Moves a staged file to its permanent storage location.
 */
function moveToPermanent(stagedPath, permanentPath) {
  assertSafePath(stagedPath);
  assertSafePath(permanentPath);

  const targetDir = path.dirname(permanentPath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Cross-device/safe rename
  try {
    fs.renameSync(stagedPath, permanentPath);
  } catch (err) {
    // Fallback to copy and unlink if rename fails across partitions
    fs.copyFileSync(stagedPath, permanentPath);
    try {
      fs.unlinkSync(stagedPath);
    } catch (_) {}
  }
}

/**
 * Safely unlinks a file. If unlink fails, logs the path to .orphaned_files.jsonl for reconciliation.
 */
function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    const safePath = assertSafePath(filePath);
    if (fs.existsSync(safePath)) {
      fs.unlinkSync(safePath);
    }
  } catch (err) {
    console.warn(`[StorageService] Warning: Failed to unlink ${filePath}: ${err.message}. Recording to orphan queue.`);
    try {
      const entry = JSON.stringify({ path: filePath, timestamp: new Date().toISOString(), error: err.message }) + '\n';
      fs.appendFileSync(ORPHAN_LOG_FILE, entry);
    } catch (_) {}
  }
}

/**
 * Reconciles orphaned files and cleans up stale temporary uploads.
 * - Deletes temporary files in tmp/ older than 60 minutes.
 * - Reconciles permanent files created > 30 minutes ago without committed database records.
 * - Retries unlinks recorded in .orphaned_files.jsonl.
 * 
 * @param {object} db - Database connection module
 * @param {object} [options] - Optional overrides for grace periods (for testing)
 * @param {number} [options.gracePeriodMs] - Grace period in ms for permanent files (default 30m)
 * @param {number} [options.tmpGraceMs] - Grace period in ms for staging tmp files (default 60m)
 */
async function reconcileOrphanedFiles(db = null, options = {}) {
  ensureStorageDirs();
  const now = Date.now();
  const STALE_TMP_MS = options.tmpGraceMs !== undefined ? options.tmpGraceMs : 60 * 60 * 1000;      // 60 minutes default
  const PERM_GRACE_MS = options.gracePeriodMs !== undefined ? options.gracePeriodMs : 30 * 60 * 1000; // 30 minutes default

  // 1. Clean stale temporary uploads in tmp/
  try {
    if (fs.existsSync(TMP_DIR)) {
      const tmpFiles = fs.readdirSync(TMP_DIR);
      for (const file of tmpFiles) {
        const fullPath = path.join(TMP_DIR, file);
        try {
          const stat = fs.statSync(fullPath);
          if (now - stat.mtimeMs >= STALE_TMP_MS) {
            fs.unlinkSync(fullPath);
            console.log(`[StorageService] Cleaned stale staged upload: ${file}`);
          }
        } catch (_) {}
      }
    }
  } catch (err) {
    console.error(`[StorageService] Error cleaning tmp directory: ${err.message}`);
  }

  // 2. Reconcile permanent files against database (if db connection provided)
  if (db && typeof db.query === 'function') {
    try {
      const docDirs = fs.readdirSync(STORAGE_ROOT);
      for (const docDirName of docDirs) {
        if (docDirName === 'tmp' || docDirName.startsWith('.')) continue;

        const docDirPath = path.join(STORAGE_ROOT, docDirName);
        let stat;
        try {
          stat = fs.statSync(docDirPath);
        } catch (_) { continue; }

        if (!stat.isDirectory()) continue;

        const files = fs.readdirSync(docDirPath);
        for (const file of files) {
          const filePath = path.join(docDirPath, file);
          try {
            const fileStat = fs.statSync(filePath);
            // Only check files that have passed the grace period
            if (now - fileStat.mtimeMs >= PERM_GRACE_MS) {
              const res = await db.query(
                'SELECT id FROM ai_document_versions WHERE storage_path = $1 LIMIT 1',
                [filePath]
              );
              if (res.rows.length === 0) {
                fs.unlinkSync(filePath);
                console.log(`[StorageService] Cleaned unreferenced permanent storage file: ${filePath}`);
              }
            }
          } catch (fileErr) {
            console.error(`[StorageService] Error checking file ${filePath}: ${fileErr.message}`);
          }
        }

        // Clean empty directory
        try {
          const remaining = fs.readdirSync(docDirPath);
          if (remaining.length === 0) {
            fs.rmdirSync(docDirPath);
          }
        } catch (_) {}
      }
    } catch (permErr) {
      console.error(`[StorageService] Error in permanent storage reconciliation: ${permErr.message}`);
    }
  }

  // 3. Process retry queue in .orphaned_files.jsonl
  try {
    if (fs.existsSync(ORPHAN_LOG_FILE)) {
      const content = fs.readFileSync(ORPHAN_LOG_FILE, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const remainingLines = [];

      for (const line of lines) {
        try {
          const record = JSON.parse(line);
          if (fs.existsSync(record.path)) {
            // Confirm no committed database record references this path
            if (db && typeof db.query === 'function') {
              const res = await db.query(
                'SELECT id FROM ai_document_versions WHERE storage_path = $1 LIMIT 1',
                [record.path]
              );
              if (res.rows.length > 0) {
                // Referenced in DB! Skip deletion
                continue;
              }
            }
            fs.unlinkSync(record.path);
            console.log(`[StorageService] Successfully processed retry unlink: ${record.path}`);
          }
        } catch (retryErr) {
          remainingLines.push(line);
        }
      }

      if (remainingLines.length > 0) {
        fs.writeFileSync(ORPHAN_LOG_FILE, remainingLines.join('\n') + '\n');
      } else {
        fs.unlinkSync(ORPHAN_LOG_FILE);
      }
    }
  } catch (orphanErr) {
    console.error(`[StorageService] Error processing orphan log: ${orphanErr.message}`);
  }
}

module.exports = {
  STORAGE_ROOT,
  TMP_DIR,
  ORPHAN_LOG_FILE,
  ensureStorageDirs,
  assertSafePath,
  computeSha256,
  writeToStaging,
  generatePermanentStoragePath,
  moveToPermanent,
  safeUnlink,
  reconcileOrphanedFiles
};
