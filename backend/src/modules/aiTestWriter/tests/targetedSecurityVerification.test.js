const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const express = require('express');
const AdmZip = require('adm-zip');

const db = require('../db/connection');
const fileValidationService = require('../services/fileValidationService');
const storageService = require('../services/storageService');
const documentService = require('../services/documentService');
const projectService = require('../services/projectService');
const aiRoutes = require('../routes/index');

describe('Phase 2.3 — Targeted Security Verification Suite', () => {
  let client;
  let creatorUser;
  let unauthorizedUser;
  let adminUser;
  let projectA;
  let projectB;
  let docA;
  let app;
  const runId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // Helper to dispatch mock requests through the Express router
  function requestApp(method, url, { user, body, headers = {} } = {}) {
    return new Promise((resolve) => {
      const parsedUrl = new URL(url, 'http://localhost');
      const req = {
        method: method.toUpperCase(),
        url: parsedUrl.pathname + parsedUrl.search,
        originalUrl: parsedUrl.pathname + parsedUrl.search,
        path: parsedUrl.pathname,
        query: Object.fromEntries(parsedUrl.searchParams),
        headers: {
          'content-type': 'application/json',
          ...headers
        },
        user: user || null,
        body: body || {},
        params: {}
      };

      let statusCode = 200;
      const resHeaders = {};
      let responseBody = null;

      const res = {
        setHeader(k, v) {
          resHeaders[k.toLowerCase()] = v;
        },
        getHeader(k) {
          return resHeaders[k.toLowerCase()];
        },
        status(code) {
          statusCode = code;
          return this;
        },
        json(data) {
          responseBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: responseBody });
        },
        send(data) {
          responseBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: responseBody });
        },
        end(data) {
          if (data) responseBody = data;
          resolve({ status: statusCode, headers: resHeaders, body: responseBody });
        },
        pipe(dest) {
          // Mock stream piping for download/preview
          dest.write = () => {};
          dest.end = () => {};
          resolve({ status: statusCode, headers: resHeaders, body: 'STREAM_PIPED' });
        }
      };

      app.handle(req, res, (err) => {
        if (err) {
          statusCode = err.status || 500;
          responseBody = { success: false, error: err.message };
        }
        resolve({ status: statusCode, headers: resHeaders, body: responseBody });
      });
    });
  }

  before(async () => {
    client = await db.getClient();

    creatorUser = { id: '00000000-0000-0000-0000-000000000101', role: 'TESTER', name: 'Creator Tester' };
    unauthorizedUser = { id: '00000000-0000-0000-0000-000000000102', role: 'TESTER', name: 'Unauthorized Tester' };
    adminUser = { id: '00000000-0000-0000-0000-000000000199', role: 'ADMIN', name: 'Platform Admin' };

    // Create Project A (Creator)
    projectA = await projectService.createProject(creatorUser.id, {
      name: `Security Project Alpha ${runId}`,
      slug: `sec-alpha-${runId}`,
      description: 'Project Alpha for Security Verification'
    });

    // Create Project B (Unauthorized User)
    projectB = await projectService.createProject(unauthorizedUser.id, {
      name: `Security Project Beta ${runId}`,
      slug: `sec-beta-${runId}`,
      description: 'Project Beta for Security Verification'
    });

    // Upload Document A into Project A
    const pdfBuffer = Buffer.from(`%PDF-1.4\n% Test Doc A ${runId}\n%%EOF`);
    docA = await documentService.uploadDocument({
      projectId: projectA.id,
      userId: creatorUser.id,
      fileBuffer: pdfBuffer,
      originalFilename: 'Target_Document_A.pdf',
      title: 'Target Document A'
    });

    // Mount Express app for route testing
    app = express();
    app.use(express.json());
    app.use('/api/ai', aiRoutes);
  });

  after(async () => {
    if (client) {
      try {
        await client.query("DELETE FROM ai_projects WHERE slug LIKE 'sec-%'");
      } catch (_) {}
      client.release();
    }
    await storageService.reconcileOrphanedFiles(db);
  });

  // ==========================================================================
  // 1. OOXML ZIP DECOMPRESSION SAFETY & METADATA INTEGRITY
  // ==========================================================================
  describe('1. OOXML ZIP Decompression Safety & Metadata Integrity', () => {
    it('1.1 Rejects archive when actual decompressed size exceeds 10 MB limit despite small declared header', () => {
      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
      // Add entry exceeding 10 MB decompressed size
      zip.addFile('word/document.xml', Buffer.alloc(11 * 1024 * 1024, 'A'));

      // Forge declared header size to small value (500 bytes)
      const entry = zip.getEntries().find(e => e.entryName === 'word/document.xml');
      entry.header.size = 500;

      const rawBuf = zip.toBuffer();

      assert.throws(() => {
        fileValidationService.validateFile(rawBuf, 'bomb_forged_header.docx');
      }, /exceeds 10 MB uncompressed limit/i);
    });

    it('1.2 Rejects archive when aggregate decompressed size exceeds 50 MB across multiple entries', () => {
      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
      zip.addFile('word/document.xml', Buffer.from('<w:document/>'));

      // 6 entries of 9 MB = 54 MB total decompressed (exceeds 50 MB total limit)
      // Compression ratio is ~3.3:1 (< 20:1 limit) and total ZIP is ~16.3 MB (< 25 MB limit)
      const chunk = Buffer.alloc(9 * 1024 * 1024);
      for (let j = 0; j < chunk.length; j += 16) {
        chunk.writeUInt32LE((j * 1664525 + 1013904223) >>> 0, j);
        chunk.fill(0xAA, j + 4, j + 16);
      }
      for (let i = 0; i < 6; i++) {
        zip.addFile(`word/part_${i}.xml`, chunk);
      }

      const rawBuf = zip.toBuffer();

      assert.throws(() => {
        fileValidationService.validateFile(rawBuf, 'aggregate_bomb.docx');
      }, /Total uncompressed archive size exceeds 50 MB limit/i);
    });

    it('1.3 Rejects archive with suspicious actual compression ratio exceeding 20:1', () => {
      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
      zip.addFile('word/document.xml', Buffer.from('<w:document/>'));

      // 5 MB of repeating zeros compresses to ~5 KB (ratio ~1000:1)
      zip.addFile('word/dense_zeroes.xml', Buffer.alloc(5 * 1024 * 1024, 0));

      const rawBuf = zip.toBuffer();

      assert.throws(() => {
        fileValidationService.validateFile(rawBuf, 'high_ratio.docx');
      }, /Suspicious compression ratio/i);
    });

    it('1.4 Rejects archive with inconsistent declared vs actual size metadata', () => {
      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
      zip.addFile('word/document.xml', Buffer.from('<w:document><w:body/></w:document>'));

      // Forge declared size of word/document.xml to non-matching number
      const entry = zip.getEntries().find(e => e.entryName === 'word/document.xml');
      entry.header.size = entry.header.size + 42;

      const rawBuf = zip.toBuffer();

      assert.throws(() => {
        fileValidationService.validateFile(rawBuf, 'inconsistent_meta.docx');
      }, /Inconsistent ZIP metadata/i);
    });

    it('1.5 Rejects archive with corrupted compressed data', () => {
      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
      zip.addFile('word/document.xml', Buffer.from('<w:document/>'));

      // Invalidate the compressed stream payload directly
      let buf = zip.toBuffer();
      const corruptedBuf = Buffer.from(buf);
      // Corrupt a byte in the deflate data block
      corruptedBuf[buf.length - 30] = 0xFF;
      corruptedBuf[buf.length - 31] = 0xFF;

      assert.throws(() => {
        fileValidationService.validateFile(corruptedBuf, 'corrupted_stream.docx');
      });
    });

    it('1.6 Rejects encrypted / password-protected archives (general purpose bit flag 0x01)', () => {
      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
      zip.addFile('word/document.xml', Buffer.from('<w:document/>'));

      // Set encryption flag on entry
      const entry = zip.getEntries().find(e => e.entryName === 'word/document.xml');
      entry.header.flags = entry.header.flags | 0x01;

      const rawBuf = zip.toBuffer();

      assert.throws(() => {
        fileValidationService.validateFile(rawBuf, 'encrypted.docx');
      }, /Encrypted or password-protected archives are not supported/i);
    });

    it('1.7 Rejects archive exceeding entry count limit (500 entries)', () => {
      const zip = new AdmZip();
      zip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
      zip.addFile('word/document.xml', Buffer.from('<w:document/>'));

      for (let i = 0; i < 501; i++) {
        zip.addFile(`word/item_${i}.xml`, Buffer.from('<item/>'));
      }

      const rawBuf = zip.toBuffer();

      assert.throws(() => {
        fileValidationService.validateFile(rawBuf, 'too_many_entries.docx');
      }, /exceeds maximum entry count limit/i);
    });
  });

  // ==========================================================================
  // 2. ORPHAN RECONCILIATION SAFETY & RACE PREVENTION
  // ==========================================================================
  describe('2. Orphan Reconciliation Safety & Race Prevention', () => {
    it('2.1 Grace period protects recently created / in-flight permanent files from deletion', async () => {
      const tempDocId = '00000000-0000-0000-0000-000000009999';
      const safePath = storageService.generatePermanentStoragePath(tempDocId, 1, 'pdf');
      fs.writeFileSync(safePath, Buffer.from('%PDF-1.4\nIn flight upload\n%%EOF'));

      // Run reconciliation with default 30-minute grace period
      // File was just created (mtime < 1s), so grace period MUST protect it
      await storageService.reconcileOrphanedFiles(db, { gracePeriodMs: 30 * 60 * 1000 });

      assert.ok(fs.existsSync(safePath), 'File within grace period must NOT be deleted');

      // Cleanup test file
      fs.unlinkSync(safePath);
      try { fs.rmdirSync(path.dirname(safePath)); } catch (_) {}
    });

    it('2.2 Unreferenced files older than grace period are safely unlinked', async () => {
      const staleDocId = '00000000-0000-0000-0000-000000008888';
      const stalePath = storageService.generatePermanentStoragePath(staleDocId, 1, 'pdf');
      fs.writeFileSync(stalePath, Buffer.from('%PDF-1.4\nStale unreferenced file\n%%EOF'));

      // Backdate mtime by 5 seconds to simulate a stale unreferenced file
      const fiveSecsAgo = (Date.now() - 5000) / 1000;
      fs.utimesSync(stalePath, fiveSecsAgo, fiveSecsAgo);

      // Run reconciliation with 1s grace period
      await storageService.reconcileOrphanedFiles(db, { gracePeriodMs: 1000 });

      assert.ok(!fs.existsSync(stalePath), 'Unreferenced file older than grace period must be unlinked');
    });

    it('2.3 Committed database records are NEVER deleted by orphan reconciliation regardless of age', async () => {
      // Query physical path of active committed document version
      const verRes = await client.query(
        'SELECT storage_path FROM ai_document_versions WHERE id = $1',
        [docA.active_version_id]
      );
      assert.equal(verRes.rows.length, 1);
      const activeStoragePath = verRes.rows[0].storage_path;

      assert.ok(fs.existsSync(activeStoragePath), 'Physical file must exist');

      // Run reconciliation with 0ms grace period
      await storageService.reconcileOrphanedFiles(db, { gracePeriodMs: 0 });

      assert.ok(fs.existsSync(activeStoragePath), 'Committed file referenced by DB must NEVER be deleted');
    });

    it('2.4 Stale temporary staging files older than tmp grace period are purged', async () => {
      const stagedPath = storageService.writeToStaging(Buffer.from('temporary data'), 'txt');
      assert.ok(fs.existsSync(stagedPath), 'Staged file must exist');

      // Backdate mtime by 5 seconds to simulate an expired temporary file
      const fiveSecsAgo = (Date.now() - 5000) / 1000;
      fs.utimesSync(stagedPath, fiveSecsAgo, fiveSecsAgo);

      // Run reconciliation with 1s tmp grace period
      await storageService.reconcileOrphanedFiles(db, { tmpGraceMs: 1000 });

      assert.ok(!fs.existsSync(stagedPath), 'Stale staged file older than tmp grace period must be purged');
    });

    it('2.5 Retry queue (.orphaned_files.jsonl) checks database before unlinking and preserves committed files', async () => {
      // Query active committed storage path
      const verRes = await client.query(
        'SELECT storage_path FROM ai_document_versions WHERE id = $1',
        [docA.active_version_id]
      );
      const activePath = verRes.rows[0].storage_path;

      // Write active path to orphan log
      const entry = JSON.stringify({ path: activePath, timestamp: new Date().toISOString(), error: 'Fake error' }) + '\n';
      fs.writeFileSync(storageService.ORPHAN_LOG_FILE, entry);

      // Run reconciliation
      await storageService.reconcileOrphanedFiles(db);

      // Committed active file MUST NOT be unlinked
      assert.ok(fs.existsSync(activePath), 'Committed file referenced in DB must be preserved during retry queue processing');

      // Clean orphan log
      if (fs.existsSync(storageService.ORPHAN_LOG_FILE)) {
        fs.unlinkSync(storageService.ORPHAN_LOG_FILE);
      }
    });
  });

  // ==========================================================================
  // 3. AUTHORIZATION MATRIX ACROSS ALL ENDPOINTS
  // ==========================================================================
  describe('3. Authorization Matrix Across All Endpoints', () => {
    // ------------------------------------------------------------------------
    // 3.1 Unauthenticated requests (no user session) -> 401 Unauthorized
    // ------------------------------------------------------------------------
    describe('3.1 Unauthenticated Requests (401 Unauthorized)', () => {
      it('Reject unauthenticated: GET /api/ai/projects', async () => {
        const res = await requestApp('get', '/api/ai/projects', { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: POST /api/ai/projects', async () => {
        const res = await requestApp('post', '/api/ai/projects', { user: null, body: { name: 'Evil' } });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: GET /api/ai/projects/:projectId', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: GET /api/ai/projects/:projectId/documents', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: POST /api/ai/projects/:projectId/documents', async () => {
        const res = await requestApp('post', `/api/ai/projects/${projectA.id}/documents`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: GET /api/ai/projects/:projectId/documents/:documentId', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: POST /api/ai/projects/:projectId/documents/:documentId/versions', async () => {
        const res = await requestApp('post', `/api/ai/projects/${projectA.id}/documents/${docA.id}/versions`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: POST /api/ai/projects/:projectId/documents/:documentId/versions/:versionId/activate', async () => {
        const res = await requestApp('post', `/api/ai/projects/${projectA.id}/documents/${docA.id}/versions/${docA.active_version_id}/activate`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: GET /api/ai/projects/:projectId/documents/:documentId/download', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}/download`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: GET /api/ai/projects/:projectId/documents/:documentId/preview', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}/preview`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: DELETE /api/ai/projects/:projectId/documents/:documentId', async () => {
        const res = await requestApp('delete', `/api/ai/projects/${projectA.id}/documents/${docA.id}`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: Direct GET /api/ai/documents/:documentId', async () => {
        const res = await requestApp('get', `/api/ai/documents/${docA.id}`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: Direct GET /api/ai/documents/:documentId/download', async () => {
        const res = await requestApp('get', `/api/ai/documents/${docA.id}/download`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: Direct GET /api/ai/documents/:documentId/preview', async () => {
        const res = await requestApp('get', `/api/ai/documents/${docA.id}/preview`, { user: null });
        assert.equal(res.status, 401);
      });

      it('Reject unauthenticated: Direct DELETE /api/ai/documents/:documentId', async () => {
        const res = await requestApp('delete', `/api/ai/documents/${docA.id}`, { user: null });
        assert.equal(res.status, 401);
      });
    });

    // ------------------------------------------------------------------------
    // 3.2 Unauthorized requests (non-owner, non-admin) -> 403 Forbidden
    // ------------------------------------------------------------------------
    describe('3.2 Unauthorized Requests (403 Forbidden)', () => {
      it('Reject unauthorized: GET /api/ai/projects/:projectAId', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: GET /api/ai/projects/:projectAId/documents', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: POST /api/ai/projects/:projectAId/documents', async () => {
        const res = await requestApp('post', `/api/ai/projects/${projectA.id}/documents`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: GET /api/ai/projects/:projectAId/documents/:docAId', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: POST /api/ai/projects/:projectAId/documents/:docAId/versions', async () => {
        const res = await requestApp('post', `/api/ai/projects/${projectA.id}/documents/${docA.id}/versions`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: POST /api/ai/projects/:projectAId/documents/:docAId/versions/:versionId/activate', async () => {
        const res = await requestApp('post', `/api/ai/projects/${projectA.id}/documents/${docA.id}/versions/${docA.active_version_id}/activate`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: GET /api/ai/projects/:projectAId/documents/:docAId/download', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}/download`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: GET /api/ai/projects/:projectAId/documents/:docAId/preview', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}/preview`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: DELETE /api/ai/projects/:projectAId/documents/:docAId', async () => {
        const res = await requestApp('delete', `/api/ai/projects/${projectA.id}/documents/${docA.id}`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: Direct GET /api/ai/documents/:docAId', async () => {
        const res = await requestApp('get', `/api/ai/documents/${docA.id}`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: Direct GET /api/ai/documents/:docAId/download', async () => {
        const res = await requestApp('get', `/api/ai/documents/${docA.id}/download`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: Direct GET /api/ai/documents/:docAId/preview', async () => {
        const res = await requestApp('get', `/api/ai/documents/${docA.id}/preview`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });

      it('Reject unauthorized: Direct DELETE /api/ai/documents/:docAId', async () => {
        const res = await requestApp('delete', `/api/ai/documents/${docA.id}`, { user: unauthorizedUser });
        assert.equal(res.status, 403);
      });
    });

    // ------------------------------------------------------------------------
    // 3.3 Cross-project document-ID attempt -> 404 Not Found
    // ------------------------------------------------------------------------
    describe('3.3 Cross-Project Document Association Guard', () => {
      it('Reject cross-project access: docA via projectB URL returns 404 (preventing leakage)', async () => {
        // unauthorizedUser owns projectB, but docA belongs to projectA!
        const res = await requestApp('get', `/api/ai/projects/${projectB.id}/documents/${docA.id}`, {
          user: unauthorizedUser
        });
        assert.equal(res.status, 404);
        assert.match(res.body.error, /does not belong to the specified project/i);
      });
    });

    // ------------------------------------------------------------------------
    // 3.4 Authorized Project Creator (User A) -> 200 OK
    // ------------------------------------------------------------------------
    describe('3.4 Authorized Project Creator Access', () => {
      it('Creator can retrieve project details', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}`, { user: creatorUser });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.id, projectA.id);
      });

      it('Creator can list project documents', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents`, { user: creatorUser });
        assert.equal(res.status, 200);
        assert.ok(Array.isArray(res.body.data));
      });

      it('Creator can retrieve document by ID', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}`, { user: creatorUser });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.id, docA.id);
      });

      it('Creator can download document', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}/download`, { user: creatorUser });
        assert.equal(res.status, 200);
      });

      it('Creator can preview document', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}/preview`, { user: creatorUser });
        assert.equal(res.status, 200);
      });
    });

    // ------------------------------------------------------------------------
    // 3.5 Platform Administrator (Admin) -> Full 200 Access
    // ------------------------------------------------------------------------
    describe('3.5 Platform Administrator Access (Option B Override)', () => {
      it('Admin can retrieve any project details', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}`, { user: adminUser });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.id, projectA.id);
      });

      it('Admin can retrieve any document details', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}`, { user: adminUser });
        assert.equal(res.status, 200);
        assert.equal(res.body.data.id, docA.id);
      });

      it('Admin can download any document', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}/download`, { user: adminUser });
        assert.equal(res.status, 200);
      });

      it('Admin can preview any document', async () => {
        const res = await requestApp('get', `/api/ai/projects/${projectA.id}/documents/${docA.id}/preview`, { user: adminUser });
        assert.equal(res.status, 200);
      });
    });
  });
});
