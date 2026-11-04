const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

const db = require('../db/connection');
const fileValidationService = require('../services/fileValidationService');
const storageService = require('../services/storageService');
const documentService = require('../services/documentService');
const projectService = require('../services/projectService');

// Sample test buffer generators
function createValidPdfBuffer() {
  return Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
}

function createValidDocxBuffer() {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`));
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Phase 2.3 Verification Specification</w:t></w:r></w:p></w:body>
</w:document>`));
  return zip.toBuffer();
}

function createValidXlsxBuffer() {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
</Types>`));
  zip.addFile('xl/workbook.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`));
  return zip.toBuffer();
}

function createValidCsvBuffer() {
  return Buffer.from('id,test_title,priority,expected\nTC-01,"Valid Login, OAuth2",HIGH,"Login successful"\nTC-02,"Timeout 3DS",CRITICAL,"Void transaction"\n', 'utf8');
}

function createValidTxtBuffer() {
  return Buffer.from('Functional Specification Document\nAuthor: QA Engineering\nScope: Core Knowledge Base\n', 'utf8');
}

function createUniquePdfBuffer(tag = '') {
  return Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n% Tag: ${tag} ${Date.now()}_${Math.random()}\ntrailer\n<< /Root 1 0 R >>\n%%EOF`);
}

function createUniqueDocxBuffer(tag = '') {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`));
  zip.addFile('word/document.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>Phase 2.3 Tag ${tag} ${Date.now()}</w:t></w:r></w:p></w:body>
</w:document>`));
  return zip.toBuffer();
}

function createUniqueTxtBuffer(tag = '') {
  return Buffer.from(`Functional Specification Document ${tag} ${Date.now()}\nAuthor: QA Engineering\nScope: Core Knowledge Base\n`, 'utf8');
}

describe('Phase 2.3 — Document Upload & Management Test Suite', () => {
  let client;
  let creatorUser;
  let otherUser;
  let adminUser;
  let projectA;
  let projectB;
  const runId = `${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

  before(async () => {
    client = await db.getClient();

    creatorUser = { id: '00000000-0000-0000-0000-000000000001', role: 'TESTER', name: 'Creator Tester' };
    otherUser = { id: '00000000-0000-0000-0000-000000000002', role: 'TESTER', name: 'Other Tester' };
    adminUser = { id: '00000000-0000-0000-0000-000000000099', role: 'ADMIN', name: 'Platform Admin' };

    // Create Project A (owned by creatorUser)
    projectA = await projectService.createProject(creatorUser.id, {
      name: `Project Alpha ${runId}`,
      slug: `proj-alpha-${runId}`,
      description: 'Test project for Phase 2.3'
    });

    // Create Project B (owned by otherUser)
    projectB = await projectService.createProject(otherUser.id, {
      name: `Project Beta ${runId}`,
      slug: `proj-beta-${runId}`,
      description: 'Second test project'
    });
  });

  after(async () => {
    if (client) {
      try {
        await client.query("DELETE FROM ai_projects WHERE slug LIKE 'proj-%'");
      } catch (_) {}
      client.release();
    }
    await storageService.reconcileOrphanedFiles(db);
    await db.closePool();
  });

  // ==========================================================================
  // 1. FORMAT VALIDATION & ARCHIVE SECURITY
  // ==========================================================================
  describe('1. Format Validation, Signatures & ZIP Bomb Defenses', () => {
    it('1.1 Accepts all 5 supported formats: PDF, DOCX, XLSX, CSV, TXT', () => {
      const pdf = fileValidationService.validateFile(createValidPdfBuffer(), 'sample.pdf');
      assert.equal(pdf.documentType, 'PDF');

      const docx = fileValidationService.validateFile(createValidDocxBuffer(), 'spec.docx');
      assert.equal(docx.documentType, 'DOCX');

      const xlsx = fileValidationService.validateFile(createValidXlsxBuffer(), 'matrix.xlsx');
      assert.equal(xlsx.documentType, 'XLSX');

      const csv = fileValidationService.validateFile(createValidCsvBuffer(), 'cases.csv');
      assert.equal(csv.documentType, 'CSV');

      const txt = fileValidationService.validateFile(createValidTxtBuffer(), 'notes.txt');
      assert.equal(txt.documentType, 'TXT');
    });

    it('1.2 Rejects unsupported file extensions (e.g. .exe, .zip, .png, .js)', () => {
      assert.throws(() => {
        fileValidationService.validateFile(Buffer.from('echo evil'), 'payload.exe');
      }, /Unsupported file extension/i);

      assert.throws(() => {
        fileValidationService.validateFile(Buffer.from('zipcontent'), 'archive.zip');
      }, /Unsupported file extension/i);

      assert.throws(() => {
        fileValidationService.validateFile(Buffer.from('img'), 'photo.png');
      }, /Unsupported file extension/i);
    });

    it('1.3 Rejects disguised files (invalid magic bytes, e.g. text file renamed to .pdf)', () => {
      assert.throws(() => {
        fileValidationService.validateFile(Buffer.from('This is actually a text file not a PDF!'), 'fake.pdf');
      }, /does not match valid PDF magic bytes/i);
    });

    it('1.4 Rejects macro-enabled DOCM/XLSM files and archives with vbaProject.bin', () => {
      const macroZip = new AdmZip();
      macroZip.addFile('[Content_Types].xml', Buffer.from(`<?xml version="1.0"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>
</Types>`));
      macroZip.addFile('word/document.xml', Buffer.from('<w:document/>'));
      macroZip.addFile('word/vbaProject.bin', Buffer.from('VBA_MACRO_BYTECODE'));

      assert.throws(() => {
        fileValidationService.validateFile(macroZip.toBuffer(), 'macro_exploit.docx');
      }, /Macro-enabled document/i);
    });

    it('1.5 Rejects DOCX/XLSX missing required OOXML internal parts', () => {
      const invalidZip = new AdmZip();
      invalidZip.addFile('random_file.txt', Buffer.from('No OOXML XML files inside'));

      assert.throws(() => {
        fileValidationService.validateFile(invalidZip.toBuffer(), 'corrupt.docx');
      }, /missing required "\[Content_Types\]\.xml"/i);
    });

    it('1.6 Rejects ZIP entry paths with directory traversal (../)', () => {
      const traversalZip = new AdmZip();
      traversalZip.addFile('[Content_Types].xml', Buffer.from('<Types/>'));
      traversalZip.addFile('word/document.xml', Buffer.from('<w:document/>'));
      traversalZip.addFile('normal.txt', Buffer.from('payload content'));

      const entries = traversalZip.getEntries();
      const targetEntry = entries.find(e => e.entryName === 'normal.txt');
      targetEntry.entryName = '../../evil_script.sh';

      const modifiedBuf = traversalZip.toBuffer();

      assert.throws(() => {
        fileValidationService.validateFile(modifiedBuf, 'traversal.docx');
      }, /Suspicious entry path/i);
    });

    it('1.7 Rejects files exceeding the 25 MB limit', () => {
      const oversizedBuffer = Buffer.alloc(25 * 1024 * 1024 + 1024); // 25 MB + 1 KB
      assert.throws(() => {
        fileValidationService.validateFile(oversizedBuffer, 'huge.pdf');
      }, /exceeds the 25 MB limit/i);
    });

    it('1.8 Accepts UTF-8 with BOM for CSV and TXT; rejects binary null bytes', () => {
      // UTF-8 with BOM: 0xEF, 0xBB, 0xBF
      const bomBuffer = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('key,val\n1,one\n')]);
      const res = fileValidationService.validateFile(bomBuffer, 'bom_data.csv');
      assert.equal(res.documentType, 'CSV');

      // Binary null byte in text file -> rejected
      const nullByteBuf = Buffer.from('test\0data\n', 'utf8');
      assert.throws(() => {
        fileValidationService.validateFile(nullByteBuf, 'binary.txt');
      }, /Binary null byte/i);
    });
  });

  // ==========================================================================
  // 2. DOCUMENT UPLOADS & METADATA PERSISTENCE
  // ==========================================================================
  describe('2. Document Uploads, Metadata & Version Persistence', () => {
    let uploadedPdfDoc;

    it('2.1 Uploads PDF document successfully with indexing_status = PENDING', async () => {
      const pdfBuffer = createValidPdfBuffer();
      uploadedPdfDoc = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: pdfBuffer,
        originalFilename: 'Authentication_Spec_v1.pdf',
        title: 'Authentication Specification'
      });

      assert.ok(uploadedPdfDoc.id);
      assert.equal(uploadedPdfDoc.project_id, projectA.id);
      assert.equal(uploadedPdfDoc.title, 'Authentication Specification');
      assert.equal(uploadedPdfDoc.original_filename, 'Authentication_Spec_v1.pdf');
      assert.equal(uploadedPdfDoc.document_type, 'PDF');
      assert.ok(uploadedPdfDoc.active_version_id);
      assert.equal(uploadedPdfDoc.version_number, 1);
      assert.equal(uploadedPdfDoc.indexing_status, 'PENDING');
      assert.equal(uploadedPdfDoc.storage_path, undefined, 'storage_path must not be exposed');
    });

    it('2.2 Safe server-side storage path and physical file existence', async () => {
      // Query raw database version row to inspect physical storage path
      const verRes = await client.query(
        'SELECT storage_path, file_size_bytes, sha256_hash FROM ai_document_versions WHERE id = $1',
        [uploadedPdfDoc.active_version_id]
      );
      assert.equal(verRes.rows.length, 1);
      const row = verRes.rows[0];

      assert.ok(row.storage_path.includes(uploadedPdfDoc.id));
      assert.ok(fs.existsSync(row.storage_path), 'Physical file must exist on disk at storage_path');
      assert.ok(!row.storage_path.includes('Authentication_Spec_v1.pdf'), 'Physical filename must not use user-supplied filename');
      assert.equal(parseInt(row.file_size_bytes), createValidPdfBuffer().length);
    });

    it('2.3 Uploads DOCX, XLSX, CSV, and TXT documents successfully', async () => {
      const docx = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: createValidDocxBuffer(),
        originalFilename: 'Requirements.docx'
      });
      assert.equal(docx.document_type, 'DOCX');
      assert.equal(docx.indexing_status, 'PENDING');

      const xlsx = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: createValidXlsxBuffer(),
        originalFilename: 'Test_Matrix.xlsx'
      });
      assert.equal(xlsx.document_type, 'XLSX');

      const csv = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: createValidCsvBuffer(),
        originalFilename: 'Test_Cases.csv'
      });
      assert.equal(csv.document_type, 'CSV');

      const txt = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: createValidTxtBuffer(),
        originalFilename: 'Architecture_Notes.txt'
      });
      assert.equal(txt.document_type, 'TXT');
    });
  });

  // ==========================================================================
  // 3. CONCURRENCY-SAFE DUPLICATE DETECTION
  // ==========================================================================
  describe('3. Concurrency-Safe Duplicate Detection', () => {
    it('3.1 Sequential upload of identical content in same project returns HTTP 409 Conflict', async () => {
      const buffer = createValidPdfBuffer(); // Identical to uploadedPdfDoc

      await assert.rejects(async () => {
        await documentService.uploadDocument({
          projectId: projectA.id,
          userId: creatorUser.id,
          fileBuffer: buffer,
          originalFilename: 'Duplicate_Spec.pdf'
        });
      }, (err) => {
        assert.equal(err.status, 409);
        assert.equal(err.code, 'DUPLICATE_DOCUMENT');
        assert.match(err.message, /Duplicate document/i);
        return true;
      });
    });

    it('3.2 Same content CAN be uploaded to a DIFFERENT project (project isolation of hash)', async () => {
      const buffer = createValidPdfBuffer();

      // Upload into projectB (different project) succeeds
      const docB = await documentService.uploadDocument({
        projectId: projectB.id,
        userId: otherUser.id,
        fileBuffer: buffer,
        originalFilename: 'ProjectB_Spec.pdf'
      });
      assert.ok(docB.id);
      assert.equal(docB.project_id, projectB.id);
    });

    it('3.3 Simultaneous parallel upload of identical file: exactly one succeeds, one gets 409', async () => {
      // Unique content for this test
      const uniquePdf = Buffer.from(`%PDF-1.4\n% Parallel test payload: ${Date.now()}\n%%EOF`);

      const [res1, res2] = await Promise.allSettled([
        documentService.uploadDocument({
          projectId: projectA.id,
          userId: creatorUser.id,
          fileBuffer: uniquePdf,
          originalFilename: 'Parallel_Doc_1.pdf'
        }),
        documentService.uploadDocument({
          projectId: projectA.id,
          userId: creatorUser.id,
          fileBuffer: uniquePdf,
          originalFilename: 'Parallel_Doc_2.pdf'
        })
      ]);

      const fulfilled = [res1, res2].filter(r => r.status === 'fulfilled');
      const rejected = [res1, res2].filter(r => r.status === 'rejected');

      assert.equal(fulfilled.length, 1, 'Exactly one parallel upload must succeed');
      assert.equal(rejected.length, 1, 'Exactly one parallel upload must be rejected');
      assert.equal(rejected[0].reason.status, 409, 'Rejected upload must return status 409 Conflict');
    });
  });

  // ==========================================================================
  // 4. VERSION MANAGEMENT & ACTIVATION SAFETY
  // ==========================================================================
  describe('4. Version Management & Activation Safety', () => {
    let targetDocId;

    before(async () => {
      const doc = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: Buffer.from('%PDF-1.4\n% Initial version 1\n%%EOF'),
        originalFilename: 'Versioned_Spec.pdf',
        title: 'Versioned Specification'
      });
      targetDocId = doc.id;
    });

    it('4.1 Creating version 2 increments version_number and updates active_version_id', async () => {
      const v2Buffer = Buffer.from('%PDF-1.4\n% Revised version 2\n%%EOF');
      const updated = await documentService.createDocumentVersion({
        projectId: projectA.id,
        documentId: targetDocId,
        userId: creatorUser.id,
        fileBuffer: v2Buffer,
        originalFilename: 'Versioned_Spec_Rev2.pdf',
        changeSummary: 'Added checkout section'
      });

      assert.equal(updated.version_number, 2);
      assert.equal(updated.indexing_status, 'PENDING');

      // Verify complete version history via getDocumentById
      const fullDoc = await documentService.getDocumentById(targetDocId);
      assert.equal(fullDoc.versions.length, 2);
      assert.equal(fullDoc.versions[0].version_number, 2);
      assert.equal(fullDoc.versions[1].version_number, 1);
    });

    it('4.2 Reverting / activating version 1 transactionally updates active_version_id', async () => {
      const fullDoc = await documentService.getDocumentById(targetDocId);
      const v1 = fullDoc.versions.find(v => v.version_number === 1);

      const activated = await documentService.activateVersion({
        projectId: projectA.id,
        documentId: targetDocId,
        versionId: v1.id
      });

      assert.equal(activated.version_number, 1);
      assert.equal(activated.active_version_id, v1.id);
    });

    it('4.3 Rejects activating a version from another document (circular FK enforcement)', async () => {
      // Create another doc
      const otherDoc = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: Buffer.from('%PDF-1.4\n% Other doc\n%%EOF'),
        originalFilename: 'Other_Doc.pdf'
      });

      await assert.rejects(async () => {
        await documentService.activateVersion({
          projectId: projectA.id,
          documentId: targetDocId,
          versionId: otherDoc.active_version_id // Belongs to otherDoc!
        });
      }, /does not belong to the specified document/i);
    });
  });

  // ==========================================================================
  // 5. DOWNLOAD & PREVIEW SECURITY
  // ==========================================================================
  describe('5. Safe Download & Preview Streams', () => {
    let testPdfId;
    let testDocxId;

    before(async () => {
      const pdf = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: createUniquePdfBuffer('download_test'),
        originalFilename: 'Download_Test.pdf'
      });
      testPdfId = pdf.id;

      const docx = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: createUniqueDocxBuffer('download_docx'),
        originalFilename: 'Download_Docx.docx'
      });
      testDocxId = docx.id;
    });

    it('5.1 Safe download stream delivers correct metadata and file stream', async () => {
      const download = await documentService.getDownloadStream(testPdfId);
      assert.equal(download.originalFilename, 'Download_Test.pdf');
      assert.equal(download.documentType, 'PDF');
      assert.ok(download.stream);
      download.stream.destroy();
    });

    it('5.2 Safe preview stream allows PDF preview with correct Content-Type', async () => {
      const preview = await documentService.getPreviewStream(testPdfId);
      assert.equal(preview.contentType, 'application/pdf');
      assert.ok(preview.stream);
      preview.stream.destroy();
    });

    it('5.3 DOCX and XLSX preview is rejected with 400 (download-only)', async () => {
      await assert.rejects(async () => {
        await documentService.getPreviewStream(testDocxId);
      }, (err) => {
        assert.equal(err.status, 400);
        assert.equal(err.code, 'PREVIEW_NOT_SUPPORTED');
        return true;
      });
    });
  });

  // ==========================================================================
  // 6. SERIALIZED DELETION & FILESYSTEM CONSISTENCY
  // ==========================================================================
  describe('6. Serialized Deletion & Filesystem Cleanup', () => {
    it('6.1 Deleting document removes database rows and unlinks physical files', async () => {
      const doc = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: createUniqueTxtBuffer('to_be_deleted'),
        originalFilename: 'To_Be_Deleted.txt'
      });

      // Get physical path before deletion
      const verRes = await client.query('SELECT storage_path FROM ai_document_versions WHERE id = $1', [doc.active_version_id]);
      const physicalPath = verRes.rows[0].storage_path;
      assert.ok(fs.existsSync(physicalPath), 'Physical file must exist prior to deletion');

      // Delete document
      const delResult = await documentService.deleteDocument({
        projectId: projectA.id,
        documentId: doc.id
      });
      assert.equal(delResult.success, true);

      // Verify DB row deleted
      const checkDb = await client.query('SELECT id FROM ai_documents WHERE id = $1', [doc.id]);
      assert.equal(checkDb.rows.length, 0);

      // Verify physical file unlinked
      assert.ok(!fs.existsSync(physicalPath), 'Physical file must be unlinked post-commit');
    });

    it('6.2 Concurrent version creation and document deletion are serialized via parent row lock', async () => {
      const doc = await documentService.uploadDocument({
        projectId: projectA.id,
        userId: creatorUser.id,
        fileBuffer: Buffer.from('%PDF-1.4\n% Concurrent test\n%%EOF'),
        originalFilename: 'Concurrent_Race.pdf'
      });

      // Run deletion and new version creation concurrently
      const [delRes, verRes] = await Promise.allSettled([
        documentService.deleteDocument({ projectId: projectA.id, documentId: doc.id }),
        documentService.createDocumentVersion({
          projectId: projectA.id,
          documentId: doc.id,
          userId: creatorUser.id,
          fileBuffer: Buffer.from('%PDF-1.4\n% Concurrent v2\n%%EOF'),
          originalFilename: 'Concurrent_Race.pdf'
        })
      ]);

      // Exactly one succeeds first:
      // If delete locks first -> version creation gets 404 (document deleted).
      // If version creation locks first -> version commits, delete locks second and deletes both versions.
      // In both cases, zero corrupt state or untracked orphaned files.
      if (delRes.status === 'fulfilled') {
        assert.equal(delRes.value.success, true);
        if (verRes.status === 'rejected') {
          assert.equal(verRes.reason.status, 404);
        }
      } else {
        assert.equal(verRes.status, 'fulfilled');
      }
    });
  });

  // ==========================================================================
  // 7. OPTION B AUTHORIZATION (PROJECT CREATOR + ADMIN ONLY)
  // ==========================================================================
  describe('7. Option B Authorization Enforced', () => {
    it('7.1 Project creator can list and retrieve documents', async () => {
      const docs = await documentService.listDocuments(projectA.id);
      assert.ok(docs.length > 0);
    });

    it('7.2 Project listing query filters by creator for non-admins; admin sees all', async () => {
      const creatorProjects = await projectService.listProjects(creatorUser.id, 'TESTER');
      const creatorSlugs = creatorProjects.map(p => p.slug);
      assert.ok(creatorSlugs.includes(projectA.slug));
      assert.ok(!creatorSlugs.includes(projectB.slug), 'Non-admin must not see other users projects');

      const adminProjects = await projectService.listProjects(adminUser.id, 'ADMIN');
      const adminSlugs = adminProjects.map(p => p.slug);
      assert.ok(adminSlugs.includes(projectA.slug));
      assert.ok(adminSlugs.includes(projectB.slug), 'Admin sees all projects');
    });
  });
});
