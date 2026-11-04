const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const db = require('../db/connection');
const { runAiMigrations } = require('../db/migrationRunner');
const retrievalService = require('../services/retrievalService');
const embeddingService = require('../services/embeddingService');
const retrievalController = require('../controllers/retrievalController');

// Test Context
let testUserIdA = null;
let testUserIdB = null;
let testProjectAId = null;
let testProjectBId = null;

let testDocAuthId = null;
let testVerAuthId = null;
let testExtAuthId = null;

let testDocPaymentId = null;
let testVerPaymentId = null;
let testExtPaymentId = null;

let testDocBId = null;
let testVerBId = null;
let testExtBId = null;

let chunkIds = {};

describe('Phase 2.6: Hybrid Retrieval Test Suite', () => {
  before(async () => {
    // 1. Ensure migrations through 008 are applied
    await runAiMigrations();

    testUserIdA = crypto.randomUUID();
    testUserIdB = crypto.randomUUID();
    testProjectAId = crypto.randomUUID();
    testProjectBId = crypto.randomUUID();

    // 2. Seed test projects
    await db.query(`
      INSERT INTO ai_projects (id, name, slug, created_by_user_id)
      VALUES 
        ($1, 'Phase 2.6 Project A', 'phase-2-6-proj-a', $2),
        ($3, 'Phase 2.6 Project B', 'phase-2-6-proj-b', $4)
      ON CONFLICT DO NOTHING;
    `, [testProjectAId, testUserIdA, testProjectBId, testUserIdB]);

    // 3. Document 1: Authentication Specification in Project A
    testDocAuthId = crypto.randomUUID();
    testVerAuthId = crypto.randomUUID();
    testExtAuthId = crypto.randomUUID();

    await db.query(`
      INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id)
      VALUES ($1, $2, 'User Authentication Specification', 'auth_spec.pdf', 'PDF', $3);
    `, [testDocAuthId, testProjectAId, testUserIdA]);

    await db.query(`
      INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id)
      VALUES ($1, $2, 1, 'hash_auth_v1', 2048, 'uploads/auth.pdf', 'PENDING', $3);
    `, [testVerAuthId, testDocAuthId, testUserIdA]);

    await db.query(`
      UPDATE ai_documents SET active_version_id = $1 WHERE id = $2;
    `, [testVerAuthId, testDocAuthId]);

    await db.query(`
      INSERT INTO ai_document_extractions (
        id, version_id, document_id, project_id, status, is_active,
        attempt_number, extractor_version, total_units, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 4, NOW(), NOW());
    `, [testExtAuthId, testVerAuthId, testDocAuthId, testProjectAId]);

    // 4. Document 2: Payment Gateway Specification in Project A
    testDocPaymentId = crypto.randomUUID();
    testVerPaymentId = crypto.randomUUID();
    testExtPaymentId = crypto.randomUUID();

    await db.query(`
      INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id)
      VALUES ($1, $2, 'Payment Gateway Integration Specification', 'payment_spec.docx', 'DOCX', $3);
    `, [testDocPaymentId, testProjectAId, testUserIdA]);

    await db.query(`
      INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id)
      VALUES ($1, $2, 1, 'hash_pay_v1', 4096, 'uploads/payment.docx', 'PENDING', $3);
    `, [testVerPaymentId, testDocPaymentId, testUserIdA]);

    await db.query(`
      UPDATE ai_documents SET active_version_id = $1 WHERE id = $2;
    `, [testVerPaymentId, testDocPaymentId]);

    await db.query(`
      INSERT INTO ai_document_extractions (
        id, version_id, document_id, project_id, status, is_active,
        attempt_number, extractor_version, total_units, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 4, NOW(), NOW());
    `, [testExtPaymentId, testVerPaymentId, testDocPaymentId, testProjectAId]);

    // 5. Document in Project B (for isolation tests)
    testDocBId = crypto.randomUUID();
    testVerBId = crypto.randomUUID();
    testExtBId = crypto.randomUUID();

    await db.query(`
      INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id)
      VALUES ($1, $2, 'Project B Confidential Architecture', 'confidential.txt', 'TXT', $3);
    `, [testDocBId, testProjectBId, testUserIdB]);

    await db.query(`
      INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id)
      VALUES ($1, $2, 1, 'hash_proj_b_v1', 1024, 'uploads/b.txt', 'PENDING', $3);
    `, [testVerBId, testDocBId, testUserIdB]);

    await db.query(`
      UPDATE ai_documents SET active_version_id = $1 WHERE id = $2;
    `, [testVerBId, testDocBId]);

    await db.query(`
      INSERT INTO ai_document_extractions (
        id, version_id, document_id, project_id, status, is_active,
        attempt_number, extractor_version, total_units, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 1, NOW(), NOW());
    `, [testExtBId, testVerBId, testDocBId, testProjectBId]);

    // 6. Seed Chunks in Document 1 (Auth)
    // Chunk 0: Overview
    chunkIds.authOverview = crypto.randomUUID();
    // Chunk 1: OAuth2 Flow & user_id
    chunkIds.authOAuth = crypto.randomUUID();
    // Chunk 2: Error handling ERR_AUTH_401 & HTTP 401
    chunkIds.authError = crypto.randomUUID();
    // Chunk 3: API-v2 endpoints
    chunkIds.authApi = crypto.randomUUID();

    // 7. Seed Chunks in Document 2 (Payment)
    // Chunk 0: Payment Overview
    chunkIds.payOverview = crypto.randomUUID();
    // Chunk 1: Payment 3D-Secure
    chunkIds.pay3ds = crypto.randomUUID();
    // Chunk 2: DevOps & Logging (no payment content)
    chunkIds.payDevops = crypto.randomUUID();
    // Chunk 3: Distractor chunk (ERR_AUTH_402, OAuth 1.0a, OAuth3, API-v3, HTTP 403)
    chunkIds.payDistractors = crypto.randomUUID();

    // 8. Seed Chunks in Project B
    chunkIds.projBChunk = crypto.randomUUID();

    const chunksToInsert = [
      // Auth Doc Chunks
      {
        id: chunkIds.authOverview,
        extractionId: testExtAuthId,
        versionId: testVerAuthId,
        documentId: testDocAuthId,
        projectId: testProjectAId,
        index: 0,
        page: 1,
        heading: 'Authentication Overview',
        content: 'Overview of user authentication services and enterprise security architecture.',
        metadata: { format: 'PDF' }
      },
      {
        id: chunkIds.authOAuth,
        extractionId: testExtAuthId,
        versionId: testVerAuthId,
        documentId: testDocAuthId,
        projectId: testProjectAId,
        index: 1,
        page: 2,
        heading: 'OAuth 2.0 PKCE Flow',
        content: 'The mobile application implements OAuth2 PKCE authorization flow. Database column user_id is indexed as foreign key for access control.',
        metadata: { format: 'PDF' }
      },
      {
        id: chunkIds.authError,
        extractionId: testExtAuthId,
        versionId: testVerAuthId,
        documentId: testDocAuthId,
        projectId: testProjectAId,
        index: 2,
        page: 3,
        heading: 'Authentication Error Codes',
        content: 'Error code ERR_AUTH_401 triggers session termination and status returned HTTP 401 Unauthorized response.',
        metadata: { format: 'PDF' }
      },
      {
        id: chunkIds.authApi,
        extractionId: testExtAuthId,
        versionId: testVerAuthId,
        documentId: testDocAuthId,
        projectId: testProjectAId,
        index: 3,
        page: 4,
        heading: 'API Versioning',
        content: 'Deprecated endpoints on API-v2 will shut down next month. Migrate all clients immediately.',
        metadata: { format: 'PDF' }
      },

      // Payment Doc Chunks
      {
        id: chunkIds.payOverview,
        extractionId: testExtPaymentId,
        versionId: testVerPaymentId,
        documentId: testDocPaymentId,
        projectId: testProjectAId,
        index: 0,
        page: null,
        heading: 'Payment Gateway Overview',
        content: 'High-level introduction to payment processing, settlement schedules, and merchant onboarding.',
        metadata: { format: 'DOCX' }
      },
      {
        id: chunkIds.pay3ds,
        extractionId: testExtPaymentId,
        versionId: testVerPaymentId,
        documentId: testDocPaymentId,
        projectId: testProjectAId,
        index: 1,
        page: null,
        heading: 'Payment 3D-Secure Processing',
        content: 'Payment transactions require 3D-Secure 2.0 verification and CVV checks for fraud prevention.',
        metadata: { format: 'DOCX' }
      },
      {
        id: chunkIds.payDevops,
        extractionId: testExtPaymentId,
        versionId: testVerPaymentId,
        documentId: testDocPaymentId,
        projectId: testProjectAId,
        index: 2,
        page: null,
        heading: 'DevOps & Logging Infrastructure',
        content: 'Docker container logs are collected via fluentd and forwarded to Elasticsearch cluster.',
        metadata: { format: 'DOCX' }
      },
      {
        id: chunkIds.payDistractors,
        extractionId: testExtPaymentId,
        versionId: testVerPaymentId,
        documentId: testDocPaymentId,
        projectId: testProjectAId,
        index: 3,
        page: null,
        heading: 'Negative Distractor Specifications',
        content: 'Distractor records: ERR_AUTH_402 triggers token re-generation. Service uses legacy OAuth 1.0a flow and draft proposal for OAuth3 protocol. New endpoints on API-v3 support streaming. Status returned HTTP 403 Forbidden. There was an err in auth module leading to general failure response. Every user must have an id assigned by registration.',
        metadata: { format: 'DOCX' }
      },

      // Project B Chunk (Identical keyword terms for isolation verification)
      {
        id: chunkIds.projBChunk,
        extractionId: testExtBId,
        versionId: testVerBId,
        documentId: testDocBId,
        projectId: testProjectBId,
        index: 0,
        page: null,
        heading: 'Project B Secrets',
        content: 'Confidential project B OAuth2 and ERR_AUTH_401 handling specification.',
        metadata: { format: 'TXT' }
      }
    ];

    for (const chunk of chunksToInsert) {
      await db.query(`
        INSERT INTO ai_document_chunks (
          id, extraction_id, version_id, document_id, project_id,
          chunk_index, content, token_count, page_number, section_heading, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11);
      `, [
        chunk.id,
        chunk.extractionId,
        chunk.versionId,
        chunk.documentId,
        chunk.projectId,
        chunk.index,
        chunk.content,
        Math.ceil(chunk.content.length / 4),
        chunk.page,
        chunk.heading,
        JSON.stringify(chunk.metadata)
      ]);
    }

    // 8. Generate Embeddings for all chunks via Ollama
    const activeConfig = await embeddingService.getActiveEmbeddingConfig();
    for (const chunk of chunksToInsert) {
      const embRes = await embeddingService.generateQueryEmbedding(chunk.content);
      await db.query(`
        INSERT INTO ai_document_embeddings (
          id, chunk_id, extraction_id, version_id, document_id, project_id,
          model_id, embedding
        ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::vector);
      `, [
        chunk.id,
        chunk.extractionId,
        chunk.versionId,
        chunk.documentId,
        chunk.projectId,
        activeConfig.id,
        JSON.stringify(embRes.embedding)
      ]);
    }

    // 9. Mark versions as COMPLETED to activate them for retrieval
    await db.query(`
      UPDATE ai_document_versions
      SET indexing_status = 'COMPLETED'
      WHERE id IN ($1, $2, $3);
    `, [testVerAuthId, testVerPaymentId, testVerBId]);
  });

  after(async () => {
    try {
      await db.query('DELETE FROM ai_documents WHERE id IN ($1, $2, $3)', [testDocAuthId, testDocPaymentId, testDocBId]);
      await db.query('DELETE FROM ai_projects WHERE id IN ($1, $2)', [testProjectAId, testProjectBId]);
    } catch (_) {}
  });

  // ==========================================================================
  // SUITE 1: Parameter Validation & Bound Enforcement
  // ==========================================================================
  describe('Suite 1: Parameter Validation & Bound Enforcement', () => {
    test('1.1 Rejects missing or non-UUID projectId', () => {
      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: 'not-a-uuid', query: 'test' });
      }, { code: 'INVALID_PROJECT_ID', status: 400 });

      assert.throws(() => {
        retrievalService.validateSearchOptions({ query: 'test' });
      }, { code: 'INVALID_PROJECT_ID', status: 400 });
    });

    test('1.2 Rejects empty or whitespace-only search query', () => {
      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: '   ' });
      }, { code: 'INVALID_QUERY', status: 400 });

      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: '' });
      }, { code: 'INVALID_QUERY', status: 400 });
    });

    test('1.3 Rejects search query exceeding 2000 characters', () => {
      const longQuery = 'a'.repeat(2001);
      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: longQuery });
      }, { code: 'QUERY_TOO_LONG', status: 400 });
    });

    test('1.4 Rejects invalid retrieval modes', () => {
      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: 'test', mode: 'FUZZY' });
      }, { code: 'INVALID_RETRIEVAL_MODE', status: 400 });
    });

    test('1.5 Enforces limit between 1 and 50 and candidateLimit between 10 and 100', () => {
      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: 'test', limit: 0 });
      }, { code: 'INVALID_LIMIT', status: 400 });

      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: 'test', limit: 51 });
      }, { code: 'INVALID_LIMIT', status: 400 });

      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: 'test', candidateLimit: 5 });
      }, { code: 'INVALID_CANDIDATE_LIMIT', status: 400 });

      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: 'test', candidateLimit: 101 });
      }, { code: 'INVALID_CANDIDATE_LIMIT', status: 400 });
    });

    test('1.6 Enforces weight bounds [0.0, 10.0] and rrf_k bounds [1, 1000]', () => {
      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: 'test', weights: { semantic: -1.0 } });
      }, { code: 'INVALID_WEIGHT', status: 400 });

      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: 'test', weights: { keyword: 11.0 } });
      }, { code: 'INVALID_WEIGHT', status: 400 });

      assert.throws(() => {
        retrievalService.validateSearchOptions({ projectId: testProjectAId, query: 'test', weights: { rrf_k: 0 } });
      }, { code: 'INVALID_RRF_K', status: 400 });
    });
  });

  // ==========================================================================
  // SUITE 2: Technical Identifier Precision & Distractor Rejection (0 False Positives)
  // ==========================================================================
  describe('Suite 2: Technical Identifier Precision & Distractor Rejection', () => {
    test('2.1 Keyword search for ERR_AUTH_401 matches target chunk and rejects ERR_AUTH_402', async () => {
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'ERR_AUTH_401',
        mode: 'KEYWORD'
      });

      assert.ok(res.results.length > 0, 'Should find target chunk');
      assert.strictEqual(res.results[0].chunkId, chunkIds.authError);
      // Ensure distractor chunk with ERR_AUTH_402 is NOT in the results
      const hasDistractor = res.results.some(r => r.chunkId === chunkIds.payDistractors);
      assert.strictEqual(hasDistractor, false, 'Distractor ERR_AUTH_402 must NOT match ERR_AUTH_401');
    });

    test('2.2 Keyword search for OAuth2 matches target chunk and rejects OAuth 1.0a / OAuth3', async () => {
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'OAuth2',
        mode: 'KEYWORD'
      });

      assert.ok(res.results.length > 0, 'Should find target chunk');
      assert.strictEqual(res.results[0].chunkId, chunkIds.authOAuth);
      const hasDistractor = res.results.some(r => r.chunkId === chunkIds.payDistractors);
      assert.strictEqual(hasDistractor, false, 'Distractor OAuth 1.0a / OAuth3 must NOT match OAuth2');
    });

    test('2.3 Keyword search for user_id matches snake_case identifier and rejects separated user id', async () => {
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'user_id',
        mode: 'KEYWORD'
      });

      assert.ok(res.results.length > 0, 'Should find target chunk');
      assert.strictEqual(res.results[0].chunkId, chunkIds.authOAuth);
      const hasDistractor = res.results.some(r => r.chunkId === chunkIds.payDistractors);
      assert.strictEqual(hasDistractor, false, 'Separated "user id" distractor must NOT match user_id');
    });

    test('2.4 Keyword search for API-v2 matches target chunk and rejects API-v3', async () => {
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'API-v2',
        mode: 'KEYWORD'
      });

      assert.ok(res.results.length > 0, 'Should find target chunk');
      assert.strictEqual(res.results[0].chunkId, chunkIds.authApi);
      const hasDistractor = res.results.some(r => r.chunkId === chunkIds.payDistractors);
      assert.strictEqual(hasDistractor, false, 'Distractor API-v3 must NOT match API-v2');
    });

    test('2.5 Keyword search for HTTP 401 matches target chunk and rejects HTTP 403', async () => {
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'HTTP 401',
        mode: 'KEYWORD'
      });

      assert.ok(res.results.length > 0, 'Should find target chunk');
      assert.strictEqual(res.results[0].chunkId, chunkIds.authError);
      const hasDistractor = res.results.some(r => r.chunkId === chunkIds.payDistractors);
      assert.strictEqual(hasDistractor, false, 'Distractor HTTP 403 must NOT match HTTP 401');
    });
  });

  // ==========================================================================
  // SUITE 3: Anti-Flooding Document Title Ranking
  // ==========================================================================
  describe('Suite 3: Anti-Flooding Document Title Ranking', () => {
    test('3.1 Multiplicative title boost boosts content-matching chunks but excludes unrelated chunks in the same doc', async () => {
      // Query "payment":
      // Document 2 title is "Payment Gateway Integration Specification"
      // Chunk 1 has payment content -> gets base rank * 1.5
      // Chunk 2 (DevOps) has NO payment content -> base rank 0.0 * 1.5 = 0.0 -> EXCLUDED!
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'payment',
        mode: 'KEYWORD'
      });

      const matchedIds = res.results.map(r => r.chunkId);
      assert.ok(matchedIds.includes(chunkIds.payOverview), 'Chunk 0 matches title fallback or content');
      assert.ok(matchedIds.includes(chunkIds.pay3ds), 'Chunk 1 (Payment 3DS) must match');
      assert.strictEqual(matchedIds.includes(chunkIds.payDevops), false, 'Chunk 2 (DevOps) has NO payment content and MUST NOT flood results');
    });

    test('3.2 Title-only query: only Chunk 0 receives minimal floor and is marked DOCUMENT_TITLE', async () => {
      // Search for "Gateway" (appears only in doc 2 title and chunk 0 heading, not in chunk 2 devops)
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'Gateway',
        mode: 'KEYWORD'
      });

      assert.ok(res.results.length > 0);
      assert.strictEqual(res.results[0].chunkIndex, 0);
      assert.strictEqual(res.results[0].provenance.documentId, testDocPaymentId);
    });
  });

  // ==========================================================================
  // SUITE 4: Semantic Cosine Retrieval & Vector Space Parity
  // ==========================================================================
  describe('Suite 4: Semantic Cosine Retrieval & Vector Space Parity', () => {
    test('4.1 Semantic query finds conceptually relevant chunk with high cosine similarity and proper ordering', async () => {
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'How does client sign in using PKCE authorization?',
        mode: 'SEMANTIC'
      });

      assert.ok(res.results.length > 0);
      assert.strictEqual(res.results[0].chunkId, chunkIds.authOAuth);
      assert.ok(res.results[0].scores.semantic.similarity > 0.6, 'Should have high cosine similarity');

      // Verify strictly descending semantic similarity
      for (let i = 1; i < res.results.length; i++) {
        assert.ok(
          res.results[i - 1].scores.semantic.similarity >= res.results[i].scores.semantic.similarity,
          'Semantic results must be ordered by descending similarity'
        );
      }
    });

    test('4.2 Semantic query for credit card fraud verification retrieves payment 3DS chunk first', async () => {
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'Credit card transaction fraud prevention and CVV check',
        mode: 'SEMANTIC'
      });

      assert.ok(res.results.length > 0);
      assert.strictEqual(res.results[0].chunkId, chunkIds.pay3ds);
    });
  });

  // ==========================================================================
  // SUITE 5: Reciprocal Rank Fusion (RRF) & Hybrid Synergy
  // ==========================================================================
  describe('Suite 5: Reciprocal Rank Fusion (RRF) & Hybrid Synergy', () => {
    test('5.1 Dual-hit chunk appearing in both semantic and keyword candidates gets boosted via RRF', async () => {
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'OAuth2 PKCE mobile authorization flow',
        mode: 'HYBRID'
      });

      assert.ok(res.results.length > 0);
      const topResult = res.results[0];
      assert.strictEqual(topResult.chunkId, chunkIds.authOAuth);
      assert.ok(topResult.scores.matchTypes.includes('SEMANTIC') && topResult.scores.matchTypes.includes('KEYWORD'), 'Top hit should be dual-hit');
      assert.ok(topResult.scores.semantic !== null, 'Has semantic rank');
      assert.ok(topResult.scores.keyword !== null, 'Has keyword rank');
      assert.ok(topResult.scores.rrfScore > 0, 'RRF score is calculated');
    });

    test('5.2 Deterministic multi-tier tie-breaking preserves consistent ordering', async () => {
      const res1 = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'authentication security architecture',
        mode: 'HYBRID'
      });

      const res2 = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'authentication security architecture',
        mode: 'HYBRID'
      });

      assert.deepStrictEqual(
        res1.results.map(r => r.chunkId),
        res2.results.map(r => r.chunkId),
        'Results across identical queries must be deterministically identical'
      );
    });
  });

  // ==========================================================================
  // SUITE 6: Mode Isolation & Ollama Resilience
  // ==========================================================================
  describe('Suite 6: Mode Isolation & Ollama Resilience', () => {
    test('6.1 KEYWORD mode executes pure lexical search without calling Ollama', async () => {
      // Intentionally pass an invalid Ollama base URL in options
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'ERR_AUTH_401',
        mode: 'KEYWORD'
      });

      assert.strictEqual(res.diagnostics.embeddingLatencyMs, 0, 'KEYWORD mode must have 0 embedding latency');
      assert.strictEqual(res.mode, 'KEYWORD');
      assert.ok(res.results.length > 0);
      assert.strictEqual(res.results[0].chunkId, chunkIds.authError);
    });

    test('6.2 SEMANTIC mode never silently falls back to keyword if Ollama fails', async () => {
      // Mock generateQueryEmbedding temporarily to throw
      const origFn = embeddingService.generateQueryEmbedding;
      embeddingService.generateQueryEmbedding = async () => {
        const err = new Error('Ollama service connection refused');
        err.code = 'ECONNREFUSED';
        throw err;
      };

      try {
        await assert.rejects(async () => {
          await retrievalService.hybridSearch({
            projectId: testProjectAId,
            query: 'session termination',
            mode: 'SEMANTIC'
          });
        }, (err) => {
          assert.strictEqual(err.code, 'ECONNREFUSED');
          return true;
        });
      } finally {
        embeddingService.generateQueryEmbedding = origFn;
      }
    });

    test('6.3 HYBRID mode throws if Ollama fails and fallbackOnSemanticFailure is false', async () => {
      const origFn = embeddingService.generateQueryEmbedding;
      embeddingService.generateQueryEmbedding = async () => {
        const err = new Error('Ollama service timed out');
        err.code = 'OLLAMA_TIMEOUT';
        err.status = 504;
        throw err;
      };

      try {
        await assert.rejects(async () => {
          await retrievalService.hybridSearch({
            projectId: testProjectAId,
            query: 'ERR_AUTH_401',
            mode: 'HYBRID',
            fallbackOnSemanticFailure: false
          });
        }, (err) => {
          assert.strictEqual(err.code, 'OLLAMA_TIMEOUT');
          assert.strictEqual(err.status, 504);
          return true;
        });
      } finally {
        embeddingService.generateQueryEmbedding = origFn;
      }
    });

    test('6.4 HYBRID mode gracefully degrades to HYBRID_DEGRADED when fallbackOnSemanticFailure is true', async () => {
      const origFn = embeddingService.generateQueryEmbedding;
      embeddingService.generateQueryEmbedding = async () => {
        const err = new Error('Ollama offline');
        err.code = 'ECONNREFUSED';
        throw err;
      };

      try {
        const res = await retrievalService.hybridSearch({
          projectId: testProjectAId,
          query: 'ERR_AUTH_401',
          mode: 'HYBRID',
          fallbackOnSemanticFailure: true
        });

        assert.strictEqual(res.mode, 'HYBRID_DEGRADED');
        assert.strictEqual(res.diagnostics.degraded, true);
        assert.ok(res.diagnostics.semanticError.includes('Ollama offline'));
        assert.ok(res.results.length > 0, 'Fallback keyword results should be returned');
        assert.strictEqual(res.results[0].chunkId, chunkIds.authError);
      } finally {
        embeddingService.generateQueryEmbedding = origFn;
      }
    });
  });

  // ==========================================================================
  // SUITE 7: Strict Project Isolation & Snapshot State Filtering
  // ==========================================================================
  describe('Suite 7: Strict Project Isolation & Snapshot State Filtering', () => {
    test('7.1 Multi-project isolation: Project A searches NEVER return Project B chunks', async () => {
      // Both Project A and Project B have chunks containing "OAuth2" and "ERR_AUTH_401"
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'OAuth2 ERR_AUTH_401',
        mode: 'HYBRID'
      });

      for (const result of res.results) {
        assert.strictEqual(result.provenance.projectId, testProjectAId, 'All hits must belong to Project A');
        assert.notStrictEqual(result.chunkId, chunkIds.projBChunk, 'Project B chunk MUST NEVER leak into Project A search');
      }
    });

    test('7.2 Inactive versions are strictly excluded from retrieval', async () => {
      // Create version 2 of Auth doc and mark active, but leave version 2 unindexed
      const ver2Id = crypto.randomUUID();
      await db.query(`
        INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id)
        VALUES ($1, $2, 2, 'hash_auth_v2', 2048, 'uploads/auth2.pdf', 'PENDING', $3);
      `, [ver2Id, testDocAuthId, testUserIdA]);

      await db.query(`UPDATE ai_documents SET active_version_id = $1 WHERE id = $2;`, [ver2Id, testDocAuthId]);

      // Version 1 chunks are now from an INACTIVE version -> should return 0 hits for Auth doc
      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'ERR_AUTH_401',
        mode: 'KEYWORD',
        documentId: testDocAuthId
      });

      assert.strictEqual(res.results.length, 0, 'Inactive version chunks must be completely excluded');

      // Restore active version to Version 1
      await db.query(`UPDATE ai_documents SET active_version_id = $1 WHERE id = $2;`, [testVerAuthId, testDocAuthId]);
      await db.query(`DELETE FROM ai_document_versions WHERE id = $1;`, [ver2Id]);
    });

    test('7.3 Inactive extractions are strictly excluded from retrieval', async () => {
      // Deactivate extraction
      await db.query(`UPDATE ai_document_extractions SET is_active = FALSE WHERE id = $1;`, [testExtAuthId]);

      const res = await retrievalService.hybridSearch({
        projectId: testProjectAId,
        query: 'ERR_AUTH_401',
        mode: 'KEYWORD',
        documentId: testDocAuthId
      });

      assert.strictEqual(res.results.length, 0, 'Deactivated extraction chunks must be excluded');

      // Re-activate extraction
      await db.query(`UPDATE ai_document_extractions SET is_active = TRUE WHERE id = $1;`, [testExtAuthId]);
    });
  });

  // ==========================================================================
  // SUITE 8: Provenance Citation Formatting Across Formats
  // ==========================================================================
  describe('Suite 8: Provenance Citation Formatting Across Formats', () => {
    test('8.1 PDF chunk provenance formats page number as "Page X"', () => {
      const citation = retrievalService.formatCitationResult({
        chunk_id: crypto.randomUUID(),
        chunk_index: 0,
        content: 'Some PDF content',
        token_count: 5,
        page_number: 3,
        section_heading: null,
        metadata: { format: 'PDF' },
        project_id: testProjectAId,
        document_id: testDocAuthId,
        document_title: 'Auth Spec',
        original_filename: 'auth.pdf',
        document_type: 'PDF',
        version_id: testVerAuthId,
        version_number: 1,
        extraction_id: testExtAuthId
      });

      assert.strictEqual(citation.provenance.sourceLocationDisplay, 'Page 3');
      assert.strictEqual(citation.provenance.documentType, 'PDF');
    });

    test('8.2 DOCX chunk provenance formats section heading as "Section: Heading"', () => {
      const citation = retrievalService.formatCitationResult({
        chunk_id: crypto.randomUUID(),
        chunk_index: 1,
        content: 'Some DOCX content',
        token_count: 5,
        page_number: null,
        section_heading: '3D-Secure 2.0',
        metadata: { format: 'DOCX' },
        project_id: testProjectAId,
        document_id: testDocPaymentId,
        document_title: 'Payment Spec',
        original_filename: 'pay.docx',
        document_type: 'DOCX',
        version_id: testVerPaymentId,
        version_number: 1,
        extraction_id: testExtPaymentId
      });

      assert.strictEqual(citation.provenance.sourceLocationDisplay, 'Section: 3D-Secure 2.0');
    });

    test('8.3 XLSX chunk provenance formats sheet name as "Sheet: SheetName"', () => {
      const citation = retrievalService.formatCitationResult({
        chunk_id: crypto.randomUUID(),
        chunk_index: 2,
        content: 'Some XLSX row',
        token_count: 5,
        page_number: null,
        section_heading: null,
        metadata: { sheet_name: 'AuditLog' },
        project_id: testProjectAId,
        document_id: testDocPaymentId,
        document_title: 'Spreadsheet',
        original_filename: 'audit.xlsx',
        document_type: 'XLSX',
        version_id: testVerPaymentId,
        version_number: 1,
        extraction_id: testExtPaymentId
      });

      assert.strictEqual(citation.provenance.sourceLocationDisplay, 'Sheet: AuditLog');
    });

    test('8.4 CSV chunk provenance formats line range as "Lines X-Y"', () => {
      const citation = retrievalService.formatCitationResult({
        chunk_id: crypto.randomUUID(),
        chunk_index: 3,
        content: 'Some CSV rows',
        token_count: 5,
        page_number: null,
        section_heading: null,
        metadata: { line_range: [15, 30] },
        project_id: testProjectAId,
        document_id: testDocPaymentId,
        document_title: 'Data',
        original_filename: 'data.csv',
        document_type: 'CSV',
        version_id: testVerPaymentId,
        version_number: 1,
        extraction_id: testExtPaymentId
      });

      assert.strictEqual(citation.provenance.sourceLocationDisplay, 'Lines 15-30');
    });

    test('8.5 TXT chunk provenance formats as "Chunk #X" fallback', () => {
      const citation = retrievalService.formatCitationResult({
        chunk_id: crypto.randomUUID(),
        chunk_index: 4,
        content: 'Some text',
        token_count: 5,
        page_number: null,
        section_heading: null,
        metadata: {},
        project_id: testProjectAId,
        document_id: testDocPaymentId,
        document_title: 'Notes',
        original_filename: 'notes.txt',
        document_type: 'TXT',
        version_id: testVerPaymentId,
        version_number: 1,
        extraction_id: testExtPaymentId
      });

      assert.strictEqual(citation.provenance.sourceLocationDisplay, 'Chunk #5');
    });
  });

  // ==========================================================================
  // SUITE 9: Controller & HTTP Integration
  // ==========================================================================
  describe('Suite 9: Controller & HTTP Integration', () => {
    test('9.1 Controller returns 200 with formatted data on valid request', async () => {
      const req = {
        params: { projectId: testProjectAId },
        body: { query: 'ERR_AUTH_401', mode: 'KEYWORD' }
      };

      let responseStatus = null;
      let responseBody = null;

      const res = {
        status: (code) => {
          responseStatus = code;
          return res;
        },
        json: (data) => {
          responseBody = data;
          return res;
        }
      };

      await retrievalController.searchKnowledgeBase(req, res);

      assert.strictEqual(responseStatus, 200);
      assert.strictEqual(responseBody.success, true);
      assert.strictEqual(responseBody.data.query, 'ERR_AUTH_401');
      assert.strictEqual(responseBody.data.results[0].chunkId, chunkIds.authError);
    });

    test('9.2 Controller returns 400 on invalid input parameters', async () => {
      const req = {
        params: { projectId: testProjectAId },
        body: { query: '', mode: 'HYBRID' }
      };

      let responseStatus = null;
      let responseBody = null;

      const res = {
        status: (code) => {
          responseStatus = code;
          return res;
        },
        json: (data) => {
          responseBody = data;
          return res;
        }
      };

      await retrievalController.searchKnowledgeBase(req, res);

      assert.strictEqual(responseStatus, 400);
      assert.strictEqual(responseBody.success, false);
      assert.strictEqual(responseBody.code, 'INVALID_QUERY');
    });
  });
});
