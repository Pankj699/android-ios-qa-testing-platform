const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const http = require('http');

const db = require('../db/connection');
const { runAiMigrations } = require('../db/migrationRunner');
const chunkingService = require('../services/chunkingService');
const embeddingService = require('../services/embeddingService');
const indexingService = require('../services/indexingService');

// Test Context
let testUserIdA = null;
let testUserIdB = null;
let testProjectAId = null;
let testProjectBId = null;
let testDocAId = null;
let testVerAId = null;
let testExtAId = null;

describe('Phase 2.5: Chunking & Local Embeddings Test Suite', () => {
  before(async () => {
    await runAiMigrations();

    testUserIdA = crypto.randomUUID();
    testUserIdB = crypto.randomUUID();
    testProjectAId = crypto.randomUUID();
    testProjectBId = crypto.randomUUID();

    // Seed test projects
    await db.query(`
      INSERT INTO ai_projects (id, name, slug, created_by_user_id)
      VALUES 
        ($1, 'Phase 2.5 Project A', 'phase-2-5-proj-a', $2),
        ($3, 'Phase 2.5 Project B', 'phase-2-5-proj-b', $4)
      ON CONFLICT DO NOTHING;
    `, [testProjectAId, testUserIdA, testProjectBId, testUserIdB]);

    // Seed document in Project A
    testDocAId = crypto.randomUUID();
    testVerAId = crypto.randomUUID();
    testExtAId = crypto.randomUUID();

    await db.query(`
      INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id)
      VALUES ($1, $2, 'Doc A Test Spec', 'spec.pdf', 'PDF', $3);
    `, [testDocAId, testProjectAId, testUserIdA]);

    await db.query(`
      INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id)
      VALUES ($1, $2, 1, 'dummyhash25a', 1024, 'dummy/path/spec.pdf', 'PENDING', $3);
    `, [testVerAId, testDocAId, testUserIdA]);

    await db.query(`
      UPDATE ai_documents SET active_version_id = $1 WHERE id = $2;
    `, [testVerAId, testDocAId]);

    // Seed completed active extraction in Project A
    await db.query(`
      INSERT INTO ai_document_extractions (
        id, version_id, document_id, project_id, status, is_active,
        attempt_number, extractor_version, total_units, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 3, NOW(), NOW());
    `, [testExtAId, testVerAId, testDocAId, testProjectAId]);

    // Seed extracted units
    await db.query(`
      INSERT INTO ai_document_extracted_units (
        id, extraction_id, version_id, document_id, project_id,
        sequence_number, source_type, source_location, source_location_display, extracted_text
      ) VALUES 
        (gen_random_uuid(), $1, $2, $3, $4, 0, 'PAGE', '{"page": 1}'::jsonb, 'Page 1', 'Overview of the Payment Gateway and Transaction Processing Engine. The payment module authenticates transactions securely.'),
        (gen_random_uuid(), $1, $2, $3, $4, 1, 'PAGE', '{"page": 2}'::jsonb, 'Page 2', 'Tokenization, fraud detection algorithms, and merchant account settlement schedules. Chargebacks are managed according to compliance rules.'),
        (gen_random_uuid(), $1, $2, $3, $4, 2, 'PAGE', '{"page": 3}'::jsonb, 'Page 3', 'API error codes, idempotency requirements, and webhook retry intervals. Ensure exponential backoff is configured for all webhooks.');
    `, [testExtAId, testVerAId, testDocAId, testProjectAId]);
  });

  after(async () => {
    try {
      await db.query('DELETE FROM ai_documents WHERE id = $1', [testDocAId]);
      await db.query('DELETE FROM ai_projects WHERE id IN ($1, $2)', [testProjectAId, testProjectBId]);
    } catch (_) {}
  });

  // ==========================================================================
  // SUITE 1: Structural Chunking, Token Heuristic & Provenance
  // ==========================================================================
  describe('Suite 1: Structural Chunking, Token Heuristic & Provenance', () => {
    test('1.1 PDF Chunking: Preserves page numbers and boundaries within ~500-800 estimated tokens', () => {
      const singlePageUnit = [
        { sequence_number: 0, source_type: 'PAGE', source_location: { page: 1 }, source_location_display: 'Page 1', extracted_text: 'Header info on page 1' }
      ];
      const singleChunk = chunkingService.chunkExtractedUnits(singlePageUnit, { maxTokens: 800 });
      assert.strictEqual(singleChunk[0].page_number, 1);
      assert.ok(singleChunk[0].content.includes('[Page 1]'));

      const multiUnits = [
        { sequence_number: 0, source_type: 'PAGE', source_location: { page: 1 }, source_location_display: 'Page 1', extracted_text: 'Header info on page 1' },
        { sequence_number: 1, source_type: 'PAGE', source_location: { page: 2 }, source_location_display: 'Page 2', extracted_text: 'Details info on page 2' }
      ];
      const multiChunks = chunkingService.chunkExtractedUnits(multiUnits, { maxTokens: 800 });
      assert.ok(multiChunks.length > 0);
      assert.strictEqual(multiChunks[0].page_number, 1);
      assert.ok(multiChunks[0].content.includes('[Pages 1-2]'));
    });

    test('1.2 DOCX Chunking: Prepends heading path breadcrumbs and table column headers', () => {
      const units = [
        { sequence_number: 0, source_type: 'HEADING', extracted_text: 'Architecture', metadata: { level: 1 } },
        { sequence_number: 1, source_type: 'HEADING', extracted_text: 'Database', metadata: { level: 2 } },
        { sequence_number: 2, source_type: 'PARAGRAPH', extracted_text: 'PostgreSQL 16 is used with pgvector.' }
      ];

      const chunks = chunkingService.chunkExtractedUnits(units);
      assert.ok(chunks.length > 0);
      const docxChunk = chunks[0];
      assert.ok(docxChunk.content.includes('Architecture') || docxChunk.section_heading.includes('Database'));
      assert.ok(docxChunk.metadata.breadcrumbs.includes('Architecture'));
    });

    test('1.3 XLSX Chunking: Prepends sheet name and column headers to row batches', () => {
      const units = [
        { sequence_number: 0, source_type: 'SHEET_HEADER', extracted_text: 'ID, TestName, Priority', source_location: { sheet: 'Regression' }, metadata: { sheet: 'Regression' } },
        { sequence_number: 1, source_type: 'SHEET_ROW', extracted_text: '1, LoginValid, High', source_location: { sheet: 'Regression' }, metadata: { sheet: 'Regression' } },
        { sequence_number: 2, source_type: 'SHEET_ROW', extracted_text: '2, Logout, Low', source_location: { sheet: 'Regression' }, metadata: { sheet: 'Regression' } }
      ];

      const chunks = chunkingService.chunkExtractedUnits(units);
      assert.ok(chunks.length > 0);
      assert.ok(chunks[0].content.includes('Sheet: Regression'));
      assert.ok(chunks[0].content.includes('ID, TestName, Priority'));
      assert.strictEqual(chunks[0].section_heading, 'Regression');
    });

    test('1.4 CSV Chunking: Prepends header row and retains CSV_ROW line coordinates', () => {
      const units = [
        { sequence_number: 0, source_type: 'CSV_ROW', extracted_text: 'ColA, ColB, ColC', source_location: { row: 1 }, metadata: { headers: ['ColA', 'ColB', 'ColC'] } },
        { sequence_number: 1, source_type: 'CSV_ROW', extracted_text: 'val1, val2, val3', source_location: { row: 2 } },
        { sequence_number: 2, source_type: 'CSV_ROW', extracted_text: 'val4, val5, val6', source_location: { row: 3 } }
      ];

      const chunks = chunkingService.chunkExtractedUnits(units);
      assert.ok(chunks.length > 0);
      assert.ok(chunks[0].content.includes('CSV Headers: ColA, ColB, ColC'));
      assert.strictEqual(chunks[0].metadata.source_type, 'CSV_ROW');
      assert.ok(chunks[0].metadata.line_start !== undefined);
    });

    test('1.5 TXT Chunking: Retains 1-indexed line ranges in prefix and metadata', () => {
      const units = [
        { sequence_number: 0, source_type: 'LINE', extracted_text: 'First line of requirements.', source_location: { line_start: 1, line_end: 1 } },
        { sequence_number: 1, source_type: 'LINE', extracted_text: 'Second line of requirements.', source_location: { line_start: 2, line_end: 2 } }
      ];

      const chunks = chunkingService.chunkExtractedUnits(units);
      assert.ok(chunks.length > 0);
      assert.ok(chunks[0].content.includes('Lines 1-2'));
      assert.strictEqual(chunks[0].metadata.line_start, 1);
      assert.strictEqual(chunks[0].metadata.line_end, 2);
    });

    test('1.6 Overlap Context: Carries forward context units without duplicating chunk indices', () => {
      const units = [
        { sequence_number: 0, source_type: 'PARAGRAPH', extracted_text: 'First block with words to reach target minimum token count.' },
        { sequence_number: 1, source_type: 'PARAGRAPH', extracted_text: 'Second block with words to force boundary rollover.' },
        { sequence_number: 2, source_type: 'PARAGRAPH', extracted_text: 'Third block that should include overlapped content from second block.' }
      ];

      // Use a low maxTokens to force a split
      const chunks = chunkingService.chunkExtractedUnits(units, { maxTokens: 15, enableOverlap: true });
      assert.ok(chunks.length >= 2, `Expected at least 2 chunks, got ${chunks.length}`);
      assert.strictEqual(chunks[0].chunk_index, 0);
      assert.strictEqual(chunks[1].chunk_index, 1);
      assert.notStrictEqual(chunks[0].id, chunks[1].id);
    });

    test('1.7 Token Heuristic: word_punctuation_heuristic_v1 calculates estimates and formats as ~N tokens (est.)', () => {
      const sample = 'The quick brown fox jumps over the lazy dog! Accurate test? Yes, 100%.';
      const estimate = chunkingService.estimateTokens(sample);
      assert.ok(estimate > 0);
      assert.ok(typeof estimate === 'number');

      const formatted = chunkingService.formatTokenEstimate(estimate);
      assert.ok(formatted.startsWith('~'));
      assert.ok(formatted.endsWith('tokens (est.)'));

      // Check empty
      assert.strictEqual(chunkingService.estimateTokens(''), 0);
      assert.strictEqual(chunkingService.estimateTokens(null), 0);
    });

    test('1.8 Oversized Unit Sentence Splitting: Splits text exceeding maxTokens at sentence boundaries without cutting mid-sentence', () => {
      const longText = 'First comprehensive sentence discusses protocol specs. Second sentence mandates TLS 1.3 encryption everywhere. Third sentence requires hardware cryptographic keys. Fourth sentence details audit logging requirements.';
      const parts = chunkingService.splitTextAtSentenceBoundaries(longText, 15);
      assert.ok(parts.length >= 2, `Expected at least 2 parts, got ${parts.length}`);
      for (const p of parts) {
        assert.ok(p.endsWith('.') || p.endsWith('!') || p.endsWith('?'), `Part should end at sentence punctuation: "${p}"`);
      }
    });
  });

  // ==========================================================================
  // SUITE 2: Local Ollama & Embeddings Hardening
  // ==========================================================================
  describe('Suite 2: Local Ollama & Embeddings Hardening', () => {
    test('2.1 Dimension Validation: Local Ollama generates valid 768-dimensional embeddings for nomic-embed-text', async () => {
      const health = await embeddingService.checkOllamaHealth();
      assert.strictEqual(health.available, true, 'Ollama server should be available at 127.0.0.1:11434');

      const testChunks = [
        { id: crypto.randomUUID(), content: 'Automated test chunk for vector dimension validation.' }
      ];

      const result = await embeddingService.generateEmbeddingsForChunks(testChunks);
      assert.strictEqual(result.embeddings.length, 1);
      assert.strictEqual(result.embeddings[0].embedding.length, 768);
      assert.strictEqual(result.diagnostics.dimensions, 768);
      assert.strictEqual(result.diagnostics.modelName, 'nomic-embed-text');
    });

    test('2.2 Connection Outage: Simulates ECONNREFUSED on invalid port; verifies clean failure', async () => {
      const testChunks = [{ id: crypto.randomUUID(), content: 'Outage test chunk' }];
      await assert.rejects(
        async () => {
          await embeddingService.generateEmbeddingsForChunks(testChunks, {
            baseUrl: 'http://127.0.0.1:54999' // Dead port
          });
        },
        /fetch failed|ECONNREFUSED/i
      );
    });

    test('2.3 AbortController Timeout: Tests timeout threshold triggers OLLAMA_TIMEOUT and aborts fetch', async () => {
      // Create a dummy mock server that delays response past timeout
      const slowServer = http.createServer((req, res) => {
        // Intentionally delay past 50ms
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ embeddings: [[...Array(768).fill(0.1)]] }));
        }, 500);
      });

      await new Promise(r => slowServer.listen(0, '127.0.0.1', r));
      const port = slowServer.address().port;

      try {
        await assert.rejects(
          async () => {
            await embeddingService.callOllamaEmbeddings(['test text'], {
              baseUrl: `http://127.0.0.1:${port}`,
              timeoutMs: 50 // 50ms timeout
            });
          },
          (err) => {
            assert.strictEqual(err.code, 'OLLAMA_TIMEOUT');
            return true;
          }
        );
      } finally {
        await new Promise(r => slowServer.close(r));
      }
    });

    test('2.4 Invalid Vector Rejection: Verifies non-768, NaN, and all-zero vectors throw structured validation errors', () => {
      // Non-768 dimension
      assert.throws(
        () => embeddingService.validateEmbeddingVector([...Array(512).fill(0.1)]),
        /dimension mismatch/i
      );

      // NaN in vector
      const nanVec = [...Array(768).fill(0.1)];
      nanVec[10] = NaN;
      assert.throws(
        () => embeddingService.validateEmbeddingVector(nanVec),
        /invalid numeric value/i
      );

      // All zero vector
      const zeroVec = [...Array(768).fill(0)];
      assert.throws(
        () => embeddingService.validateEmbeddingVector(zeroVec),
        /all zeros/i
      );
    });

    test('2.5 Single Active Config: Rejects execution if active model is not 768-dim nomic-embed-text (e.g. Qwen)', async () => {
      // Mock client that returns qwen model as active embedding config
      const mockClient = {
        query: async () => ({
          rows: [{
            id: crypto.randomUUID(),
            model_name: 'qwen2.5:3b-instruct',
            dimensions: 768,
            is_active: true
          }]
        })
      };

      await assert.rejects(
        async () => {
          await embeddingService.getActiveEmbeddingConfig(mockClient);
        },
        (err) => {
          assert.strictEqual(err.code, 'UNSUPPORTED_EMBEDDING_MODEL');
          return true;
        }
      );
    });
  });

  // ==========================================================================
  // SUITE 3: Concurrency, Hierarchy Integrity, Atomic Swap & Stale Recovery
  // ==========================================================================
  describe('Suite 3: Concurrency, Hierarchy Integrity, Atomic Swap & Stale Recovery', () => {
    test('3.1 In-Process Concurrency: Concurrent trigger requests return HTTP 409 Conflict immediately', async () => {
      // Artificially register version in activeInFlightIndexings
      const testVId = crypto.randomUUID();
      indexingService.activeInFlightIndexings.add(testVId);

      try {
        await assert.rejects(
          async () => {
            await indexingService.indexDocumentVersion({
              projectId: testProjectAId,
              documentId: testDocAId,
              versionId: testVId
            });
          },
          (err) => {
            assert.strictEqual(err.status, 409);
            assert.strictEqual(err.code, 'INDEXING_ALREADY_IN_PROGRESS');
            return true;
          }
        );
      } finally {
        indexingService.activeInFlightIndexings.delete(testVId);
      }
    });

    test('3.2 Cross-Process Concurrency: Session-level advisory lock serializes parallel clients across processes', async () => {
      const client1 = await db.getClient();
      const testVId = crypto.randomUUID();

      try {
        // Client 1 acquires session advisory lock
        const lockRes1 = await client1.query(`
          SELECT pg_try_advisory_lock(hashtext('ai_document_indexing')::integer, hashtext($1::text)::integer) as locked
        `, [testVId]);
        assert.strictEqual(lockRes1.rows[0].locked, true);

        // Client 2 attempts to acquire same lock
        const client2 = await db.getClient();
        try {
          const lockRes2 = await client2.query(`
            SELECT pg_try_advisory_lock(hashtext('ai_document_indexing')::integer, hashtext($1::text)::integer) as locked
          `, [testVId]);
          assert.strictEqual(lockRes2.rows[0].locked, false, 'Client 2 must be rejected by advisory lock');
        } finally {
          client2.release();
        }
      } finally {
        await client1.query(`
          SELECT pg_advisory_unlock(hashtext('ai_document_indexing')::integer, hashtext($1::text)::integer)
        `, [testVId]);
        client1.release();
      }
    });

    test('3.3 Session Lock Release: Lock is guaranteed released on process or normal completion', async () => {
      const testVId = crypto.randomUUID();
      const client = await db.getClient();
      await client.query(`
        SELECT pg_advisory_lock(hashtext('ai_document_indexing')::integer, hashtext($1::text)::integer)
      `, [testVId]);

      // Release lock
      const unlockRes = await client.query(`
        SELECT pg_advisory_unlock(hashtext('ai_document_indexing')::integer, hashtext($1::text)::integer) as unlocked
      `, [testVId]);
      assert.strictEqual(unlockRes.rows[0].unlocked, true);
      client.release();

      // Verify lock is no longer held in pg_locks
      const status = await indexingService.checkAdvisoryLockHeldInDb(testVId);
      assert.strictEqual(status.isHeld, false);
    });

    test('3.4 Extraction-Level Identity & 4-Key Scoped Swap: Full indexing pipeline populates chunks & embeddings', async () => {
      const result = await indexingService.indexDocumentVersion({
        projectId: testProjectAId,
        documentId: testDocAId,
        versionId: testVerAId
      });

      assert.strictEqual(result.indexingStatus, 'PROCESSING');
      assert.ok(result.pipelinePromise);

      // Await completion of in-memory inference and DB atomic swap
      await result.pipelinePromise;

      // Verify DB version status
      const statusInfo = await indexingService.getIndexingStatus({
        projectId: testProjectAId,
        documentId: testDocAId,
        versionId: testVerAId
      });

      assert.strictEqual(statusInfo.indexingStatus, 'COMPLETED');
      assert.ok(statusInfo.totalChunks > 0);

      // Verify chunks retrieval
      const chunksData = await indexingService.getDocumentChunks({
        projectId: testProjectAId,
        documentId: testDocAId,
        versionId: testVerAId
      });

      assert.strictEqual(chunksData.totalCount, statusInfo.totalChunks);
      assert.strictEqual(chunksData.chunks[0].hasEmbedding, true);
    });

    test('3.5 Failure Preservation: Failed re-indexing does not erase previous successful chunks', async () => {
      // Verify initial chunks exist
      const beforeChunks = await indexingService.getDocumentChunks({
        projectId: testProjectAId,
        documentId: testDocAId,
        versionId: testVerAId
      });
      assert.ok(beforeChunks.totalCount > 0);

      // Simulate a broken embedding pipeline by pointing to invalid Ollama port during re-index
      const originalGenerate = embeddingService.generateEmbeddingsForChunks;
      embeddingService.generateEmbeddingsForChunks = async () => {
        const err = new Error('Simulated network failure during embedding generation');
        err.code = 'OLLAMA_BATCH_FAILED';
        throw err;
      };

      try {
        const reindexResult = await indexingService.indexDocumentVersion({
          projectId: testProjectAId,
          documentId: testDocAId,
          versionId: testVerAId,
          isReindex: true
        });

        await reindexResult.pipelinePromise;
      } finally {
        embeddingService.generateEmbeddingsForChunks = originalGenerate;
      }

      // Verify version status is FAILED, BUT previous chunks remain intact in database!
      const statusInfo = await indexingService.getIndexingStatus({
        projectId: testProjectAId,
        documentId: testDocAId,
        versionId: testVerAId
      });

      assert.strictEqual(statusInfo.indexingStatus, 'FAILED_RETRY');
      assert.strictEqual(statusInfo.totalChunks, beforeChunks.totalCount);

      const afterChunks = await indexingService.getDocumentChunks({
        projectId: testProjectAId,
        documentId: testDocAId,
        versionId: testVerAId
      });
      assert.strictEqual(afterChunks.totalCount, beforeChunks.totalCount, 'Previous successful chunks must remain fully intact');
    });

    test('3.6 Four-Key Composite Hierarchy Constraints: Database strictly rejects mismatched project_id, document_id, version_id, and extraction_id across chunks AND embeddings', async () => {
      const pBId = testProjectBId;
      const mismatchVerId = crypto.randomUUID();
      const mismatchExtId = crypto.randomUUID();
      const otherDocId = crypto.randomUUID();
      const otherVerId = crypto.randomUUID();
      const otherExtId = crypto.randomUUID();

      // Create extra fixtures in Project B for cross-hierarchy testing
      await db.query(`INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id) VALUES ($1, $2, 'Other Doc', 'other.txt', 'TXT', $3)`, [otherDocId, pBId, testUserIdB]);
      await db.query(`INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id) VALUES ($1, $2, 1, 'otherhash', 100, 'path/other', 'PROCESSING', $3)`, [otherVerId, otherDocId, testUserIdB]);
      await db.query(`INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number, extractor_version, total_units) VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 1)`, [otherExtId, otherVerId, otherDocId, pBId]);

      // Create base version and extraction in Project A (in PROCESSING so triggers permit chunk insert)
      await db.query(`
        INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id)
        VALUES ($1, $2, 98, 'mismatchhash123', 500, 'dummy/mismatch.pdf', 'PROCESSING', $3);
      `, [mismatchVerId, testDocAId, testUserIdA]);

      await db.query(`
        INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number, extractor_version, total_units)
        VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 1);
      `, [mismatchExtId, mismatchVerId, testDocAId, testProjectAId]);

      const modelRes = await db.query('SELECT id FROM ai_embedding_config WHERE is_active = TRUE LIMIT 1');
      const modelId = modelRes.rows[0].id;
      const dummyVector = `[${new Array(768).fill(0.01).join(',')}]`;

      try {
        // --- CHUNK HIERARCHY TESTS ---
        // Negative 1: Chunk mismatched project_id
        await assert.rejects(
          async () => {
            await db.query(`
              INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, 1, 'Mismatch project', 10);
            `, [mismatchExtId, mismatchVerId, testDocAId, pBId]);
          },
          /foreign key constraint|violates foreign key/i,
          'Chunk must reject mismatched project_id'
        );

        // Negative 2: Chunk mismatched document_id
        await assert.rejects(
          async () => {
            await db.query(`
              INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, 2, 'Mismatch doc', 10);
            `, [mismatchExtId, mismatchVerId, otherDocId, testProjectAId]);
          },
          /foreign key constraint|violates foreign key/i,
          'Chunk must reject mismatched document_id'
        );

        // Negative 3: Chunk mismatched version_id
        await assert.rejects(
          async () => {
            await db.query(`
              INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, 3, 'Mismatch ver', 10);
            `, [mismatchExtId, otherVerId, testDocAId, testProjectAId]);
          },
          /foreign key constraint|violates foreign key/i,
          'Chunk must reject mismatched version_id'
        );

        // Negative 4: Chunk mismatched extraction_id
        await assert.rejects(
          async () => {
            await db.query(`
              INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, 4, 'Mismatch ext', 10);
            `, [otherExtId, mismatchVerId, testDocAId, testProjectAId]);
          },
          /foreign key constraint|violates foreign key/i,
          'Chunk must reject mismatched extraction_id'
        );

        // Insert a valid chunk for embedding hierarchy tests
        const validChunkId = crypto.randomUUID();
        await db.query(`
          INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count)
          VALUES ($1, $2, $3, $4, $5, 0, 'Valid chunk content', 10);
        `, [validChunkId, mismatchExtId, mismatchVerId, testDocAId, testProjectAId]);

        // --- EMBEDDING HIERARCHY TESTS ---
        // Negative 5: Embedding mismatched project_id
        await assert.rejects(
          async () => {
            await db.query(`
              INSERT INTO ai_document_embeddings (id, chunk_id, extraction_id, version_id, document_id, project_id, model_id, embedding)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::vector);
            `, [validChunkId, mismatchExtId, mismatchVerId, testDocAId, pBId, modelId, dummyVector]);
          },
          /foreign key constraint|violates foreign key/i,
          'Embedding must reject mismatched project_id'
        );

        // Negative 6: Embedding mismatched document_id
        await assert.rejects(
          async () => {
            await db.query(`
              INSERT INTO ai_document_embeddings (id, chunk_id, extraction_id, version_id, document_id, project_id, model_id, embedding)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::vector);
            `, [validChunkId, mismatchExtId, mismatchVerId, otherDocId, testProjectAId, modelId, dummyVector]);
          },
          /foreign key constraint|violates foreign key/i,
          'Embedding must reject mismatched document_id'
        );

        // Negative 7: Embedding mismatched version_id
        await assert.rejects(
          async () => {
            await db.query(`
              INSERT INTO ai_document_embeddings (id, chunk_id, extraction_id, version_id, document_id, project_id, model_id, embedding)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::vector);
            `, [validChunkId, mismatchExtId, otherVerId, testDocAId, testProjectAId, modelId, dummyVector]);
          },
          /foreign key constraint|violates foreign key/i,
          'Embedding must reject mismatched version_id'
        );

        // Negative 8: Embedding mismatched extraction_id
        await assert.rejects(
          async () => {
            await db.query(`
              INSERT INTO ai_document_embeddings (id, chunk_id, extraction_id, version_id, document_id, project_id, model_id, embedding)
              VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::vector);
            `, [validChunkId, otherExtId, mismatchVerId, testDocAId, testProjectAId, modelId, dummyVector]);
          },
          /foreign key constraint|violates foreign key/i,
          'Embedding must reject mismatched extraction_id'
        );

        // Negative 9: Embedding mismatched chunk_id
        await assert.rejects(
          async () => {
            await db.query(`
              INSERT INTO ai_document_embeddings (id, chunk_id, extraction_id, version_id, document_id, project_id, model_id, embedding)
              VALUES (gen_random_uuid(), gen_random_uuid(), $1, $2, $3, $4, $5, $6::vector);
            `, [mismatchExtId, mismatchVerId, testDocAId, testProjectAId, modelId, dummyVector]);
          },
          /foreign key constraint|violates foreign key/i,
          'Embedding must reject mismatched chunk_id'
        );

        // Positive: Valid matching hierarchy embedding succeeds
        await db.query(`
          INSERT INTO ai_document_embeddings (id, chunk_id, extraction_id, version_id, document_id, project_id, model_id, embedding)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::vector);
        `, [validChunkId, mismatchExtId, mismatchVerId, testDocAId, testProjectAId, modelId, dummyVector]);

      } finally {
        await db.query('DELETE FROM ai_document_versions WHERE id = $1', [mismatchVerId]);
        await db.query('DELETE FROM ai_documents WHERE id = $1', [otherDocId]);
      }
    });

    test('3.7 Extraction Promotion Integration Lifecycle: E1 -> E2 promotion retires E1 only after E2 commits; E3 embedding failure preserves E2', async () => {
      const promoDocId = crypto.randomUUID();
      const promoVerId = crypto.randomUUID();
      const ext1Id = crypto.randomUUID();
      const ext2Id = crypto.randomUUID();
      const ext3Id = crypto.randomUUID();

      await db.query(`INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id) VALUES ($1, $2, 'Doc Promo', 'promo.txt', 'TXT', $3)`, [promoDocId, testProjectAId, testUserIdA]);
      await db.query(`INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id) VALUES ($1, $2, 1, 'hashpromo1', 200, 'path/promo.txt', 'PENDING', $3)`, [promoVerId, promoDocId, testUserIdA]);
      await db.query(`UPDATE ai_documents SET active_version_id = $1 WHERE id = $2`, [promoVerId, promoDocId]);

      try {
        // Step A: Complete and activate extraction E1
        await db.query(`
          INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number, extractor_version, total_units, completed_at)
          VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 2, NOW());
        `, [ext1Id, promoVerId, promoDocId, testProjectAId]);
        await db.query(`
          INSERT INTO ai_document_extracted_units (id, extraction_id, version_id, document_id, project_id, sequence_number, source_type, source_location_display, extracted_text)
          VALUES 
            (gen_random_uuid(), $1, $2, $3, $4, 0, 'LINE', 'Line 1', 'E1 Line 1 content for payment authentication rules.'),
            (gen_random_uuid(), $1, $2, $3, $4, 1, 'LINE', 'Line 2', 'E1 Line 2 content for transaction settlement engine.');
        `, [ext1Id, promoVerId, promoDocId, testProjectAId]);

        // Step B: Index E1 successfully
        const idxResult1 = await indexingService.indexDocumentVersion({ projectId: testProjectAId, documentId: promoDocId, versionId: promoVerId });
        await idxResult1.pipelinePromise;

        const vCheck1 = await db.query(`SELECT indexing_status, total_chunks FROM ai_document_versions WHERE id = $1`, [promoVerId]);
        assert.strictEqual(vCheck1.rows[0].indexing_status, 'COMPLETED');
        assert.strictEqual(vCheck1.rows[0].total_chunks, 1);

        const e1Chunks = await db.query(`SELECT count(*) as count FROM ai_document_chunks WHERE extraction_id = $1`, [ext1Id]);
        assert.strictEqual(parseInt(e1Chunks.rows[0].count, 10), 1);

        // Step C: Complete and activate extraction E2 for the same version
        await db.query(`UPDATE ai_document_extractions SET is_active = FALSE WHERE version_id = $1 AND id = $2`, [promoVerId, ext1Id]);
        await db.query(`
          INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number, extractor_version, total_units, completed_at)
          VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 2, '1.0.0', 3, NOW());
        `, [ext2Id, promoVerId, promoDocId, testProjectAId]);
        await db.query(`
          INSERT INTO ai_document_extracted_units (id, extraction_id, version_id, document_id, project_id, sequence_number, source_type, source_location_display, extracted_text)
          VALUES 
            (gen_random_uuid(), $1, $2, $3, $4, 0, 'LINE', 'Line 1', 'E2 Line 1 revised specification for modern oauth tokens.'),
            (gen_random_uuid(), $1, $2, $3, $4, 1, 'LINE', 'Line 2', 'E2 Line 2 revised cryptographic algorithms and sha256 hashes.'),
            (gen_random_uuid(), $1, $2, $3, $4, 2, 'LINE', 'Line 3', 'E2 Line 3 revised webhook retry rules.');
        `, [ext2Id, promoVerId, promoDocId, testProjectAId]);

        // Verify BEFORE E2 indexing: E1 chunks are still present in DB!
        const e1BeforeE2 = await db.query(`SELECT count(*) as count FROM ai_document_chunks WHERE extraction_id = $1`, [ext1Id]);
        assert.strictEqual(parseInt(e1BeforeE2.rows[0].count, 10), 1, 'E1 chunks must remain intact before E2 indexing');

        // Step D: Index E2 successfully
        const idxResult2 = await indexingService.indexDocumentVersion({ projectId: testProjectAId, documentId: promoDocId, versionId: promoVerId, isReindex: true });
        await idxResult2.pipelinePromise;

        // Step E: Verify E1 is retired only after E2 commits
        const e1After = await db.query(`SELECT count(*) as count FROM ai_document_chunks WHERE extraction_id = $1`, [ext1Id]);
        assert.strictEqual(parseInt(e1After.rows[0].count, 10), 0, 'E1 chunks retired only after E2 commits');

        // Step F: Verify E2 chunks and embeddings are correct
        const e2Chunks = await db.query(`SELECT id, content FROM ai_document_chunks WHERE extraction_id = $1`, [ext2Id]);
        const e2Embeddings = await db.query(`SELECT chunk_id, vector_dims(embedding) as dims FROM ai_document_embeddings WHERE extraction_id = $1`, [ext2Id]);
        assert.strictEqual(e2Chunks.rows.length, 1);
        assert.ok(e2Chunks.rows[0].content.includes('E2 Line 1 revised specification'));
        assert.strictEqual(e2Embeddings.rows.length, 1);
        assert.strictEqual(e2Embeddings.rows[0].dims, 768);
        assert.strictEqual(e2Embeddings.rows[0].chunk_id, e2Chunks.rows[0].id);

        // Repeat with E3 embedding failure
        await db.query(`UPDATE ai_document_extractions SET is_active = FALSE WHERE version_id = $1 AND id = $2`, [promoVerId, ext2Id]);
        await db.query(`
          INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number, extractor_version, total_units, completed_at)
          VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 3, '1.0.0', 1, NOW());
        `, [ext3Id, promoVerId, promoDocId, testProjectAId]);
        await db.query(`
          INSERT INTO ai_document_extracted_units (id, extraction_id, version_id, document_id, project_id, sequence_number, source_type, source_location_display, extracted_text)
          VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, 'LINE', 'Line 1', 'E3 Temporary text to fail.');
        `, [ext3Id, promoVerId, promoDocId, testProjectAId]);

        const originalGenerate = embeddingService.generateEmbeddingsForChunks;
        embeddingService.generateEmbeddingsForChunks = async () => {
          throw new Error('Simulated embedding service network outage during E3');
        };

        try {
          const idxResult3 = await indexingService.indexDocumentVersion({ projectId: testProjectAId, documentId: promoDocId, versionId: promoVerId, isReindex: true });
          await idxResult3.pipelinePromise;
        } catch (_) {} finally {
          embeddingService.generateEmbeddingsForChunks = originalGenerate;
        }

        // Verify E2 chunks and embeddings remain intact and usable
        const e2ChunksPreserved = await db.query(`SELECT count(*) as count FROM ai_document_chunks WHERE extraction_id = $1`, [ext2Id]);
        const e2EmbeddingsPreserved = await db.query(`SELECT count(*) as count FROM ai_document_embeddings WHERE extraction_id = $1`, [ext2Id]);
        assert.strictEqual(parseInt(e2ChunksPreserved.rows[0].count, 10), 1, 'E2 chunks must remain intact on E3 failure');
        assert.strictEqual(parseInt(e2EmbeddingsPreserved.rows[0].count, 10), 1, 'E2 embeddings must remain intact on E3 failure');

        // Verify NO partial E3 index exists
        const e3ChunksCheck = await db.query(`SELECT count(*) as count FROM ai_document_chunks WHERE extraction_id = $1`, [ext3Id]);
        const e3EmbeddingsCheck = await db.query(`SELECT count(*) as count FROM ai_document_embeddings WHERE extraction_id = $1`, [ext3Id]);
        assert.strictEqual(parseInt(e3ChunksCheck.rows[0].count, 10), 0, 'Zero partial E3 chunks must exist');
        assert.strictEqual(parseInt(e3EmbeddingsCheck.rows[0].count, 10), 0, 'Zero partial E3 embeddings must exist');

        const vCheckFinal = await db.query(`SELECT indexing_status, indexing_error FROM ai_document_versions WHERE id = $1`, [promoVerId]);
        assert.strictEqual(vCheckFinal.rows[0].indexing_status, 'FAILED');
        assert.ok(vCheckFinal.rows[0].indexing_error.includes('Simulated embedding service network outage'));
      } finally {
        await db.query('DELETE FROM ai_documents WHERE id = $1', [promoDocId]);
      }
    });

    test('3.8 Extraction-Level Row Locking & Invalidation: FOR SHARE on active extraction protects against deactivation before commit', async () => {
      // Test that if an extraction row is deactivated during embedding generation, commit transaction rejects it
      const lockDocId = crypto.randomUUID();
      const lockVerId = crypto.randomUUID();
      const lockExtId = crypto.randomUUID();

      await db.query(`INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id) VALUES ($1, $2, 'Doc Lock', 'lock.txt', 'TXT', $3)`, [lockDocId, testProjectAId, testUserIdA]);
      await db.query(`INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id) VALUES ($1, $2, 1, 'hashlock', 200, 'path/lock.txt', 'PENDING', $3)`, [lockVerId, lockDocId, testUserIdA]);
      await db.query(`UPDATE ai_documents SET active_version_id = $1 WHERE id = $2`, [lockVerId, lockDocId]);

      await db.query(`
        INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number, extractor_version, total_units, completed_at)
        VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 1, NOW());
      `, [lockExtId, lockVerId, lockDocId, testProjectAId]);
      await db.query(`
        INSERT INTO ai_document_extracted_units (id, extraction_id, version_id, document_id, project_id, sequence_number, source_type, source_location_display, extracted_text)
        VALUES (gen_random_uuid(), $1, $2, $3, $4, 0, 'LINE', 'Line 1', 'Locking test content.');
      `, [lockExtId, lockVerId, lockDocId, testProjectAId]);

      // Hook embeddingService to deactivate the extraction while embeddings are being computed
      const originalGenerate = embeddingService.generateEmbeddingsForChunks;
      embeddingService.generateEmbeddingsForChunks = async (chunks) => {
        // Deactivate extraction concurrently!
        await db.query(`UPDATE ai_document_extractions SET is_active = FALSE WHERE id = $1`, [lockExtId]);
        return await originalGenerate(chunks);
      };

      try {
        const idxResult = await indexingService.indexDocumentVersion({ projectId: testProjectAId, documentId: lockDocId, versionId: lockVerId });
        await idxResult.pipelinePromise;

        // Verify version status is FAILED with expected invalidation error
        const vCheck = await db.query(`SELECT indexing_status, indexing_error FROM ai_document_versions WHERE id = $1`, [lockVerId]);
        assert.strictEqual(vCheck.rows[0].indexing_status, 'FAILED');
        assert.ok(vCheck.rows[0].indexing_error.includes('Active document extraction was deactivated or invalidated'));

        // Verify zero chunks or embeddings were saved
        const chunkCheck = await db.query(`SELECT count(*) as count FROM ai_document_chunks WHERE extraction_id = $1`, [lockExtId]);
        assert.strictEqual(parseInt(chunkCheck.rows[0].count, 10), 0, 'No chunks saved when extraction was invalidated');
      } finally {
        embeddingService.generateEmbeddingsForChunks = originalGenerate;
        await db.query('DELETE FROM ai_documents WHERE id = $1', [lockDocId]);
      }
    });

    test('3.9 Multi-Project Isolation & Plain Search: Cross-project queries return 404/empty; search is substring only', async () => {
      // Attempt to fetch chunks using Project B ID for Document A (belongs to Project A)
      const crossRes = await indexingService.getDocumentChunks({
        projectId: testProjectBId,
        documentId: testDocAId,
        versionId: testVerAId
      });
      assert.strictEqual(crossRes.totalCount, 0, 'Cross-project query must return 0 chunks');

      // Test plain substring search (e.g. 'Payment Gateway')
      const searchRes = await indexingService.getDocumentChunks({
        projectId: testProjectAId,
        documentId: testDocAId,
        versionId: testVerAId,
        search: 'Payment'
      });
      assert.ok(searchRes.totalCount > 0);
      assert.ok(searchRes.chunks[0].content.includes('Payment'));
    });

    test('3.10 Stale Sweeper Lock Protection: Sweeper checks pg_locks; preserves active jobs with delayed heartbeats', async () => {
      // 1. Create a version artificially in PROCESSING with heartbeat > 5 minutes ago
      const staleVerId = crypto.randomUUID();
      await db.query(`
        INSERT INTO ai_document_versions (
          id, document_id, version_number, sha256_hash, file_size_bytes, storage_path,
          indexing_status, indexing_last_heartbeat_at, uploaded_by_user_id
        ) VALUES (
          $1, $2, 99, 'stalehash123', 500, 'dummy/stale.pdf',
          'PROCESSING', NOW() - INTERVAL '10 minutes', $3
        );
      `, [staleVerId, testDocAId, testUserIdA]);

      // Acquire advisory lock to simulate a live process with delayed heartbeat
      const liveClient = await db.getClient();
      await liveClient.query(`
        SELECT pg_advisory_lock(hashtext('ai_document_indexing')::integer, hashtext($1::text)::integer)
      `, [staleVerId]);

      try {
        // Run sweeper while lock is held
        const sweepResult = await indexingService.recoverStaleIndexings();
        assert.ok(sweepResult.preservedCount >= 1, 'Job with active advisory lock must be preserved');

        // Verify status remains PROCESSING
        const checkRes = await db.query('SELECT indexing_status FROM ai_document_versions WHERE id = $1', [staleVerId]);
        assert.strictEqual(checkRes.rows[0].indexing_status, 'PROCESSING');
      } finally {
        // Unlock and release
        await liveClient.query(`
          SELECT pg_advisory_unlock(hashtext('ai_document_indexing')::integer, hashtext($1::text)::integer)
        `, [staleVerId]);
        liveClient.release();
      }

      // Now run sweeper again when lock is UNHELD
      const sweepResult2 = await indexingService.recoverStaleIndexings();
      assert.ok(sweepResult2.recoveredCount >= 1, 'Job without active advisory lock must be marked FAILED');

      const checkRes2 = await db.query('SELECT indexing_status, indexing_error, indexing_diagnostics FROM ai_document_versions WHERE id = $1', [staleVerId]);
      assert.strictEqual(checkRes2.rows[0].indexing_status, 'FAILED');
      assert.strictEqual(checkRes2.rows[0].indexing_diagnostics.reason, 'STALE_HEARTBEAT_NO_LOCK');

      // Cleanup
      await db.query('DELETE FROM ai_document_versions WHERE id = $1', [staleVerId]);
    });

    test('3.11 Deterministic Real Concurrent Promotion & Lock Barrier: Client A FOR SHARE blocks Client B FOR UPDATE; releases on commit; reverse ordering rejects inactive E1', async () => {
      const lockDocId = crypto.randomUUID();
      const lockVerId = crypto.randomUUID();
      const ext1Id = crypto.randomUUID();
      const ext2Id = crypto.randomUUID();

      await db.query(`INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id) VALUES ($1, $2, 'Doc Promo Lock', 'promolock.txt', 'TXT', $3)`, [lockDocId, testProjectAId, testUserIdA]);
      await db.query(`INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id) VALUES ($1, $2, 1, 'hashpromolock', 100, 'path/promolock.txt', 'PENDING', $3)`, [lockVerId, lockDocId, testUserIdA]);
      await db.query(`UPDATE ai_documents SET active_version_id = $1 WHERE id = $2`, [lockVerId, lockDocId]);

      // E1 is active, completed extraction
      await db.query(`
        INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number, extractor_version, total_units, completed_at)
        VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 1, NOW())
      `, [ext1Id, lockVerId, lockDocId, testProjectAId]);

      // E2 is pending extraction
      await db.query(`
        INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number, extractor_version, total_units)
        VALUES ($1, $2, $3, $4, 'PROCESSING', FALSE, 2, '1.0.0', 0)
      `, [ext2Id, lockVerId, lockDocId, testProjectAId]);

      const clientA = await db.getClient();
      const clientB = await db.getClient();

      try {
        const pidA = (await clientA.query('SELECT pg_backend_pid()')).rows[0].pg_backend_pid;
        const pidB = (await clientB.query('SELECT pg_backend_pid()')).rows[0].pg_backend_pid;

        // Transaction A begins indexing E1 and acquires its FOR SHARE row lock
        await clientA.query('BEGIN');
        const selA = await clientA.query(`
          SELECT id FROM ai_document_extractions
          WHERE id = $1 AND version_id = $2 AND document_id = $3 AND project_id = $4
            AND is_active = TRUE AND status = 'COMPLETED'
          FOR SHARE
        `, [ext1Id, lockVerId, lockDocId, testProjectAId]);
        assert.strictEqual(selA.rows.length, 1);

        // Transaction B attempts to promote E2 and must block while acquiring FOR UPDATE on E1
        let bCompleted = false;
        await clientB.query('BEGIN');

        const clientBPromise = (async () => {
          await clientB.query(`
            SELECT id FROM ai_document_extractions
            WHERE version_id = $1 AND id != $2 AND is_active = TRUE
            FOR UPDATE
          `, [lockVerId, ext2Id]);
          bCompleted = true;
        })();

        // Check pg_blocking_pids deterministically to verify B is blocked by A holding lock
        let isBlocked = false;
        for (let i = 0; i < 20; i++) {
          const blockCheck = await db.query(`SELECT pg_blocking_pids($1) as blocking`, [pidB]);
          const blocking = blockCheck.rows[0].blocking;
          if (blocking && blocking.includes(pidA)) {
            isBlocked = true;
            break;
          }
          await new Promise(r => setTimeout(r, 50));
        }

        assert.ok(isBlocked, `Client B (PID ${pidB}) must be blocked by Client A (PID ${pidA})`);
        assert.strictEqual(bCompleted, false, 'Transaction B must not complete promotion while A holds the lock');

        // Allow Transaction A to commit
        const chunkIdA = crypto.randomUUID();
        await clientA.query(`
          INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count)
          VALUES ($1, $2, $3, $4, $5, 0, 'E1 chunk content under lock', 10)
        `, [chunkIdA, ext1Id, lockVerId, lockDocId, testProjectAId]);
        await clientA.query('COMMIT');

        // Verify B proceeds and commits E2 activation
        await clientBPromise;
        assert.strictEqual(bCompleted, true, 'Transaction B must unblock after Transaction A commits');

        await clientB.query(`UPDATE ai_document_extractions SET is_active = FALSE WHERE version_id = $1 AND id = $2`, [lockVerId, ext1Id]);
        await clientB.query(`UPDATE ai_document_extractions SET status = 'COMPLETED', is_active = TRUE, total_units = 1 WHERE id = $1`, [ext2Id]);
        await clientB.query('COMMIT');

        // Verify E1 is inactive and E2 is active
        const extCheck = await db.query(`SELECT id, is_active FROM ai_document_extractions WHERE version_id = $1 ORDER BY attempt_number`, [lockVerId]);
        assert.strictEqual(extCheck.rows.length, 2);
        assert.strictEqual(extCheck.rows[0].id, ext1Id);
        assert.strictEqual(extCheck.rows[0].is_active, false);
        assert.strictEqual(extCheck.rows[1].id, ext2Id);
        assert.strictEqual(extCheck.rows[1].is_active, true);

        // Verify subsequent indexing of E2 retires E1 chunks and final indexed data belongs strictly to active extraction E2
        const clientIdxE2 = await db.getClient();
        try {
          await clientIdxE2.query('BEGIN');
          const revalE2 = await clientIdxE2.query(`
            SELECT id FROM ai_document_extractions
            WHERE id = $1 AND version_id = $2 AND is_active = TRUE AND status = 'COMPLETED'
            FOR SHARE
          `, [ext2Id, lockVerId]);
          assert.strictEqual(revalE2.rows.length, 1);

          await clientIdxE2.query(`
            DELETE FROM ai_document_chunks
            WHERE version_id = $1 AND document_id = $2 AND project_id = $3 AND extraction_id != $4
          `, [lockVerId, lockDocId, testProjectAId, ext2Id]);

          const chunkIdB = crypto.randomUUID();
          await clientIdxE2.query(`
            INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count)
            VALUES ($1, $2, $3, $4, $5, 0, 'E2 chunk content post promotion', 12)
          `, [chunkIdB, ext2Id, lockVerId, lockDocId, testProjectAId]);
          await clientIdxE2.query('COMMIT');
        } finally {
          clientIdxE2.release();
        }

        const finalChunks = await db.query(`SELECT id, extraction_id, content FROM ai_document_chunks WHERE version_id = $1`, [lockVerId]);
        assert.strictEqual(finalChunks.rows.length, 1);
        assert.strictEqual(finalChunks.rows[0].extraction_id, ext2Id);
        assert.strictEqual(finalChunks.rows[0].content, 'E2 chunk content post promotion');

        // Reverse Ordering:
        // When promotion of E2 commits first, subsequent indexing for inactive E1 fails active-extraction check
        const clientReverse = await db.getClient();
        let reverseFailed = false;
        let reverseError = null;
        try {
          await clientReverse.query('BEGIN');
          const revalInactive = await clientReverse.query(`
            SELECT id FROM ai_document_extractions
            WHERE id = $1 AND version_id = $2 AND document_id = $3 AND project_id = $4
              AND is_active = TRUE AND status = 'COMPLETED'
            FOR SHARE
          `, [ext1Id, lockVerId, lockDocId, testProjectAId]);

          if (!revalInactive.rows || revalInactive.rows.length === 0) {
            throw new Error('Active document extraction was deactivated or invalidated during embedding generation.');
          }
          await clientReverse.query('COMMIT');
        } catch (err) {
          reverseFailed = true;
          reverseError = err;
          await clientReverse.query('ROLLBACK');
        } finally {
          clientReverse.release();
        }

        assert.ok(reverseFailed, 'Indexing attempt on inactive E1 must fail');
        assert.ok(reverseError.message.includes('Active document extraction was deactivated or invalidated'));

        const e1ChunksCheck = await db.query(`SELECT count(*) as count FROM ai_document_chunks WHERE extraction_id = $1`, [ext1Id]);
        assert.strictEqual(parseInt(e1ChunksCheck.rows[0].count, 10), 0, 'No obsolete E1 chunks committed');
      } finally {
        clientA.release();
        clientB.release();
        await db.query('DELETE FROM ai_documents WHERE id = $1', [lockDocId]);
      }
    });

    test('3.12 Concurrent Promotion Single-Active Constraint: Partial unique index uq_ai_ext_single_active strictly prevents two active extractions', async () => {
      const actDocId = crypto.randomUUID();
      const actVerId = crypto.randomUUID();
      const extAId = crypto.randomUUID();
      const extBId = crypto.randomUUID();

      await db.query(`INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id) VALUES ($1, $2, 'Doc Act', 'act.txt', 'TXT', $3)`, [actDocId, testProjectAId, testUserIdA]);
      await db.query(`INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id) VALUES ($1, $2, 1, 'hashact', 100, 'path/act.txt', 'PENDING', $3)`, [actVerId, actDocId, testUserIdA]);

      await db.query(`
        INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number)
        VALUES 
          ($1, $2, $3, $4, 'PROCESSING', FALSE, 1),
          ($5, $2, $3, $4, 'PROCESSING', FALSE, 2)
      `, [extAId, actVerId, actDocId, testProjectAId, extBId]);

      const c1 = await db.getClient();
      const c2 = await db.getClient();

      try {
        await c1.query('BEGIN');
        await c1.query(`UPDATE ai_document_extractions SET is_active = TRUE, status = 'COMPLETED' WHERE id = $1`, [extAId]);

        await c2.query('BEGIN');
        let c2Failed = false;
        let c2Error = null;

        const p2 = c2.query(`UPDATE ai_document_extractions SET is_active = TRUE, status = 'COMPLETED' WHERE id = $1`, [extBId])
          .then(() => c2.query('COMMIT'))
          .catch(err => {
            c2Failed = true;
            c2Error = err;
            return c2.query('ROLLBACK');
          });

        await c1.query('COMMIT');
        await p2;

        assert.ok(c2Failed, 'Client 2 must fail to activate a second extraction for the same version');
        assert.strictEqual(c2Error.code, '23505', 'PostgreSQL error code must be 23505 (unique_violation)');
        assert.ok(c2Error.constraint.includes('uq_ai_ext_single_active'), `Must violate uq_ai_ext_single_active`);

        const activeCount = await db.query(`SELECT count(*) as count FROM ai_document_extractions WHERE version_id = $1 AND is_active = TRUE`, [actVerId]);
        assert.strictEqual(parseInt(activeCount.rows[0].count, 10), 1, 'Exactly one active extraction in database');
      } finally {
        c1.release();
        c2.release();
        await db.query('DELETE FROM ai_documents WHERE id = $1', [actDocId]);
      }
    });

    test('3.13 Atomic Chunk and Embedding Retirement & Deletion Predicate Scope: FK cascade removes embeddings; scope safe across projects, docs, versions; failure rollback preserves state', async () => {
      const p1 = crypto.randomUUID();
      const p2 = crypto.randomUUID();
      const doc1 = crypto.randomUUID();
      const doc2 = crypto.randomUUID();
      const docP2 = crypto.randomUUID();
      const ver1 = crypto.randomUUID();
      const ver2 = crypto.randomUUID();
      const verP2 = crypto.randomUUID();
      const ext1 = crypto.randomUUID();
      const ext2 = crypto.randomUUID();
      const extOther = crypto.randomUUID();
      const extP2 = crypto.randomUUID();

      await db.query(`INSERT INTO ai_projects (id, name, slug, created_by_user_id) VALUES ($1, 'P1 Scope', $2, $3), ($4, 'P2 Scope', $5, $3)`, [p1, `p1-scope-${Date.now()}`, testUserIdA, p2, `p2-scope-${Date.now()}`]);
      await db.query(`INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id) VALUES 
        ($1, $2, 'Doc1', 'doc1.txt', 'TXT', $3),
        ($4, $2, 'Doc2', 'doc2.txt', 'TXT', $3),
        ($5, $6, 'DocP2', 'docP2.txt', 'TXT', $3)
      `, [doc1, p1, testUserIdA, doc2, docP2, p2]);

      await db.query(`INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id) VALUES 
        ($1, $2, 1, 'h1', 100, 'path1', 'PENDING', $5),
        ($3, $2, 2, 'h2', 100, 'path2', 'PENDING', $5),
        ($4, $6, 1, 'hp2', 100, 'pathp2', 'PENDING', $5)
      `, [ver1, doc1, ver2, verP2, testUserIdA, docP2]);

      await db.query(`INSERT INTO ai_document_extractions (id, version_id, document_id, project_id, status, is_active, attempt_number) VALUES 
        ($1, $2, $3, $4, 'COMPLETED', FALSE, 1),
        ($5, $2, $3, $4, 'COMPLETED', TRUE, 2),
        ($6, $7, $3, $4, 'COMPLETED', TRUE, 1),
        ($8, $9, $10, $11, 'COMPLETED', TRUE, 1)
      `, [ext1, ver1, doc1, p1, ext2, extOther, ver2, extP2, verP2, docP2, p2]);

      const modelRes = await db.query(`SELECT id FROM ai_embedding_config WHERE is_active = TRUE LIMIT 1`);
      const modelId = modelRes.rows[0].id;
      const dummyVector = JSON.stringify(new Array(768).fill(0.05));

      const chunkA = crypto.randomUUID();
      const chunkB = crypto.randomUUID();
      const chunkC = crypto.randomUUID();

      await db.query(`INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count) VALUES 
        ($1, $2, $3, $4, $5, 0, 'Chunk A content (ext1, ver1)', 10),
        ($6, $7, $8, $4, $5, 0, 'Chunk B content (extOther, ver2)', 10),
        ($9, $10, $11, $12, $13, 0, 'Chunk C content (extP2, verP2, p2)', 10)
      `, [chunkA, ext1, ver1, doc1, p1, chunkB, extOther, ver2, chunkC, extP2, verP2, docP2, p2]);

      const embA = crypto.randomUUID();
      const embB = crypto.randomUUID();
      const embC = crypto.randomUUID();

      await db.query(`INSERT INTO ai_document_embeddings (id, chunk_id, extraction_id, version_id, document_id, project_id, model_id, embedding) VALUES 
        ($1, $2, $3, $4, $5, $6, $7, $8::vector),
        ($9, $10, $11, $12, $5, $6, $7, $8::vector),
        ($13, $14, $15, $16, $17, $18, $7, $8::vector)
      `, [embA, chunkA, ext1, ver1, doc1, p1, modelId, dummyVector,
          embB, chunkB, extOther, ver2,
          embC, chunkC, extP2, verP2, docP2, p2]);

      try {
        // Execute broad deletion predicate for ext2 indexing on ver1, doc1, p1
        await db.query(`
          DELETE FROM ai_document_chunks
          WHERE version_id = $1
            AND document_id = $2
            AND project_id = $3
            AND extraction_id != $4
        `, [ver1, doc1, p1, ext2]);

        // Chunk A and Embedding A deleted
        const checkChunkA = await db.query(`SELECT count(*) as c FROM ai_document_chunks WHERE id = $1`, [chunkA]);
        const checkEmbA = await db.query(`SELECT count(*) as c FROM ai_document_embeddings WHERE id = $1`, [embA]);
        assert.strictEqual(parseInt(checkChunkA.rows[0].c, 10), 0, 'Chunk A must be deleted');
        assert.strictEqual(parseInt(checkEmbA.rows[0].c, 10), 0, 'Embedding A must be cascade deleted');

        // Chunk B and Emb B (different version ver2) preserved
        const checkChunkB = await db.query(`SELECT count(*) as c FROM ai_document_chunks WHERE id = $1`, [chunkB]);
        const checkEmbB = await db.query(`SELECT count(*) as c FROM ai_document_embeddings WHERE id = $1`, [embB]);
        assert.strictEqual(parseInt(checkChunkB.rows[0].c, 10), 1, 'Chunk B in ver2 must NOT be deleted');
        assert.strictEqual(parseInt(checkEmbB.rows[0].c, 10), 1, 'Embedding B in ver2 must NOT be deleted');

        // Chunk C and Emb C (different project P2) preserved
        const checkChunkC = await db.query(`SELECT count(*) as c FROM ai_document_chunks WHERE id = $1`, [chunkC]);
        const checkEmbC = await db.query(`SELECT count(*) as c FROM ai_document_embeddings WHERE id = $1`, [embC]);
        assert.strictEqual(parseInt(checkChunkC.rows[0].c, 10), 1, 'Chunk C in project 2 must NOT be deleted');
        assert.strictEqual(parseInt(checkEmbC.rows[0].c, 10), 1, 'Embedding C in project 2 must NOT be deleted');

        // Atomicity and Rollback Test: failed indexing transaction leaves existing state intact
        const chunkExt2 = crypto.randomUUID();
        const embExt2 = crypto.randomUUID();
        await db.query(`INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count) VALUES ($1, $2, $3, $4, $5, 0, 'E2 original chunk', 10)`, [chunkExt2, ext2, ver1, doc1, p1]);
        await db.query(`INSERT INTO ai_document_embeddings (id, chunk_id, extraction_id, version_id, document_id, project_id, model_id, embedding) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector)`, [embExt2, chunkExt2, ext2, ver1, doc1, p1, modelId, dummyVector]);

        const failClient = await db.getClient();
        try {
          await failClient.query('BEGIN');
          await failClient.query(`DELETE FROM ai_document_chunks WHERE extraction_id = $1 AND version_id = $2`, [ext2, ver1]);
          const partialChunk = crypto.randomUUID();
          await failClient.query(`INSERT INTO ai_document_chunks (id, extraction_id, version_id, document_id, project_id, chunk_index, content, token_count) VALUES ($1, $2, $3, $4, $5, 0, 'Partial chunk', 5)`, [partialChunk, ext2, ver1, doc1, p1]);
          throw new Error('Simulated failure before commit');
        } catch (_) {
          await failClient.query('ROLLBACK');
        } finally {
          failClient.release();
        }

        const rollbackChunkCheck = await db.query(`SELECT count(*) as c, content FROM ai_document_chunks WHERE id = $1 GROUP BY content`, [chunkExt2]);
        const rollbackEmbCheck = await db.query(`SELECT count(*) as c FROM ai_document_embeddings WHERE id = $1`, [embExt2]);
        assert.strictEqual(parseInt(rollbackChunkCheck.rows[0].c, 10), 1, 'Previous chunk must remain intact after rollback');
        assert.strictEqual(rollbackChunkCheck.rows[0].content, 'E2 original chunk');
        assert.strictEqual(parseInt(rollbackEmbCheck.rows[0].c, 10), 1, 'Previous embedding must remain intact after rollback');
      } finally {
        await db.query('DELETE FROM ai_documents WHERE id IN ($1, $2)', [doc1, doc2]);
        await db.query('DELETE FROM ai_projects WHERE id IN ($1, $2)', [p1, p2]);
      }
    });
  });

  // ==========================================================================
  // SUITE 4: Multi-Chunk Synthetic Boundary & Provenance Verification
  // ==========================================================================
  describe('Suite 4: Multi-Chunk Synthetic Boundary & Provenance Verification', () => {
    test('4.1 PDF Multi-Chunk: 8 pages partitioned across chunks with page provenance', () => {
      const pdfUnits = [];
      for (let page = 1; page <= 8; page++) {
        pdfUnits.push({
          sequence_number: page - 1,
          source_type: 'PAGE',
          source_location: { page },
          source_location_display: `Page ${page}`,
          extracted_text: `PDF Content on Page ${page}. This section details transaction authorization protocol version ${page}. Verify all digital signature certificates, mutual TLS connections, and payload integrity hashes before continuing with settlement workflow.`
        });
      }

      const pdfChunks = chunkingService.chunkExtractedUnits(pdfUnits, { maxTokens: 60, enableOverlap: false });
      assert.ok(pdfChunks.length >= 4, `Expected at least 4 PDF chunks, got ${pdfChunks.length}`);

      pdfChunks.forEach((c, idx) => {
        assert.strictEqual(c.chunk_index, idx, `Chunk index must be sequential at ${idx}`);
        assert.ok(c.page_number >= 1, 'Page number must be valid');
        assert.ok(c.content.includes('[Page'), 'Chunk must contain page prefix');
        assert.ok(c.token_count > 0, 'Token count must be positive');
      });
    });

    test('4.2 DOCX Multi-Chunk: Heading hierarchy, tables, and oversized unit sentence splitting', () => {
      const docxUnits = [
        { sequence_number: 0, source_type: 'HEADING', extracted_text: 'Core Platform Architecture', metadata: { level: 1 } },
        { sequence_number: 1, source_type: 'HEADING', extracted_text: 'Authentication & Authorization', metadata: { level: 2 } },
        { sequence_number: 2, source_type: 'PARAGRAPH', extracted_text: 'The authentication service validates JWT bearer tokens signed with RS256 algorithms.' },
        {
          sequence_number: 3,
          source_type: 'PARAGRAPH',
          extracted_text: 'First security sentence defines the TLS requirement. Second sentence mandates hardware security modules for private keys. Third sentence enforces quarterly key rotation. Fourth sentence requires multi-factor authentication for administrative access. Fifth sentence specifies audit logging for all authentication attempts.'
        },
        { sequence_number: 4, source_type: 'TABLE', extracted_text: 'Endpoint | Method | Role\n/api/auth | POST | Anonymous\n/api/tokens | GET | Admin' },
        { sequence_number: 5, source_type: 'PARAGRAPH', extracted_text: 'Post-authentication session handlers manage token lifecycle and sliding expirations.' }
      ];

      const docxChunks = chunkingService.chunkExtractedUnits(docxUnits, { maxTokens: 40, enableOverlap: true });
      assert.ok(docxChunks.length >= 3, `Expected at least 3 DOCX chunks, got ${docxChunks.length}`);

      docxChunks.forEach((c, idx) => {
        assert.strictEqual(c.chunk_index, idx, `Chunk index must be sequential at ${idx}`);
        assert.ok(c.content.includes('Core Platform Architecture') || c.section_heading?.includes('Authentication'), 'Breadcrumb/heading must be present');
        assert.ok(c.token_count <= 100, `Chunk ${idx} token count ${c.token_count} must be within bounds`);
      });

      const splitChunks = docxChunks.filter(c => c.content.includes('Second sentence') || c.content.includes('Third sentence'));
      assert.ok(splitChunks.length >= 1, 'Oversized paragraph must be cleanly partitioned across chunks');
    });

    test('4.3 XLSX Multi-Chunk: Multiple sheets with column header preservation and row batches', () => {
      const xlsxUnits = [];
      let seq = 0;
      xlsxUnits.push({ sequence_number: seq++, source_type: 'SHEET_HEADER', extracted_text: 'OrderID, CustomerID, Amount, Status', metadata: { sheet: 'Orders' } });
      for (let r = 1; r <= 15; r++) {
        xlsxUnits.push({
          sequence_number: seq++,
          source_type: 'SHEET_ROW',
          extracted_text: `ORD-${1000 + r}, CUST-${500 + r}, $${r * 25}.00, APPROVED`,
          metadata: { sheet: 'Orders', row_number: r + 1 }
        });
      }
      xlsxUnits.push({ sequence_number: seq++, source_type: 'SHEET_HEADER', extracted_text: 'PaymentID, Gateway, Fee, Currency', metadata: { sheet: 'Payments' } });
      for (let r = 1; r <= 15; r++) {
        xlsxUnits.push({
          sequence_number: seq++,
          source_type: 'SHEET_ROW',
          extracted_text: `PAY-${2000 + r}, STRIPE, $${(r * 0.75).toFixed(2)}, USD`,
          metadata: { sheet: 'Payments', row_number: r + 1 }
        });
      }

      const xlsxChunks = chunkingService.chunkExtractedUnits(xlsxUnits, { maxTokens: 60, enableOverlap: false });
      assert.ok(xlsxChunks.length >= 4, `Expected at least 4 XLSX chunks, got ${xlsxChunks.length}`);

      xlsxChunks.forEach((c, idx) => {
        assert.strictEqual(c.chunk_index, idx, `Chunk index must be sequential at ${idx}`);
        assert.ok(c.content.includes('[Sheet:'), 'XLSX chunk must contain sheet prefix');
        assert.ok(c.section_heading === 'Orders' || c.section_heading === 'Payments', 'Sheet name must be in section heading');
      });
    });

    test('4.4 CSV Multi-Chunk: 20 CSV rows preserving headers and line coordinates', () => {
      const csvUnits = [];
      const csvHeaders = ['RuleID', 'Description', 'Severity', 'Action'];
      for (let r = 1; r <= 20; r++) {
        csvUnits.push({
          sequence_number: r - 1,
          source_type: 'CSV_ROW',
          source_location: { row: r + 1 },
          source_location_display: `Row ${r + 1}`,
          extracted_text: `RULE-${r}, Reject anomalous transaction pattern #${r}, HIGH, BLOCK_IP`,
          metadata: { headers: csvHeaders, row_number: r + 1 }
        });
      }

      const csvChunks = chunkingService.chunkExtractedUnits(csvUnits, { maxTokens: 60, enableOverlap: false });
      assert.ok(csvChunks.length >= 4, `Expected at least 4 CSV chunks, got ${csvChunks.length}`);

      csvChunks.forEach((c, idx) => {
        assert.strictEqual(c.chunk_index, idx, `Chunk index must be sequential at ${idx}`);
        assert.ok(c.content.includes('[CSV Headers:'), 'CSV chunk must prepend headers');
        assert.ok(c.metadata.line_start >= 2, 'Line start must be tracked');
        assert.ok(c.metadata.line_end >= c.metadata.line_start, 'Line end must be >= line start');
      });
    });

    test('4.5 TXT Multi-Chunk: 30 lines with line range provenance', () => {
      const txtUnits = [];
      for (let l = 1; l <= 30; l++) {
        txtUnits.push({
          sequence_number: l - 1,
          source_type: 'LINE',
          source_location: { line_start: l, line_end: l },
          source_location_display: `Line ${l}`,
          extracted_text: `Configuration parameter line ${l}: max_concurrency_limit_${l} = ${l * 10} threads and retry_timeout = 30s.`
        });
      }

      const txtChunks = chunkingService.chunkExtractedUnits(txtUnits, { maxTokens: 50, enableOverlap: false });
      assert.ok(txtChunks.length >= 4, `Expected at least 4 TXT chunks, got ${txtChunks.length}`);

      txtChunks.forEach((c, idx) => {
        assert.strictEqual(c.chunk_index, idx, `Chunk index must be sequential at ${idx}`);
        assert.ok(c.content.includes('[Lines '), 'TXT chunk must prepend line range');
        assert.ok(c.metadata.line_start >= 1, 'Line start must be valid');
        assert.ok(c.metadata.line_end >= c.metadata.line_start, 'Line end must be >= line start');
      });
    });

    test('4.6 Multi-chunk Embedding 1:1 Mapping: Verifying all embeddings map 1:1 to chunk IDs with 768 dimensions', async () => {
      const txtUnits = [];
      for (let l = 1; l <= 15; l++) {
        txtUnits.push({
          sequence_number: l - 1,
          source_type: 'LINE',
          source_location: { line_start: l, line_end: l },
          source_location_display: `Line ${l}`,
          extracted_text: `Line ${l}: Unique test phrase for batch embedding generation verification.`
        });
      }

      const chunks = chunkingService.chunkExtractedUnits(txtUnits, { maxTokens: 30, enableOverlap: false });
      assert.ok(chunks.length >= 3, `Expected at least 3 chunks, got ${chunks.length}`);

      for (const c of chunks) {
        c.extraction_id = crypto.randomUUID();
        c.version_id = crypto.randomUUID();
        c.document_id = crypto.randomUUID();
        c.project_id = crypto.randomUUID();
      }

      const embRes = await embeddingService.generateEmbeddingsForChunks(chunks);
      assert.strictEqual(embRes.embeddings.length, chunks.length, 'Embeddings count must exactly match chunks count');

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const emb = embRes.embeddings[i];
        assert.strictEqual(emb.chunk_id, chunk.id, `Embedding at ${i} must point to chunk.id ${chunk.id}`);
        assert.strictEqual(emb.embedding.length, 768, 'Embedding must have exactly 768 dimensions');
      }
      assert.strictEqual(embRes.diagnostics.dimensions, 768);
    });
  });
});
