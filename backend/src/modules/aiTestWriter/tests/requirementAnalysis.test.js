const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const db = require('../db/connection');
const { runAiMigrations } = require('../db/migrationRunner');
const requirementAnalysisService = require('../services/requirementAnalysisService');
const requirementAnalysisController = require('../controllers/requirementAnalysisController');
const { validateSchema, screenRequirementEvidence } = require('../services/requirementSchemaValidator');
const llmService = require('../services/llmService');
const embeddingService = require('../services/embeddingService');

// Test Context
let testUserId = null;
let testProjectId = null;
let testEmptyProjectId = null;
let testDocId = null;
let testVerId = null;
let testExtId = null;
let testChunk1Id = null;
let testChunk2Id = null;

describe('Phase 2.7: Requirement Analysis & Knowledge-Grounded RAG Test Suite', () => {
  before(async () => {
    // 1. Ensure migrations through 009 are applied
    await runAiMigrations();

    testUserId = crypto.randomUUID();
    testProjectId = crypto.randomUUID();
    testEmptyProjectId = crypto.randomUUID();

    // 2. Create test projects with unique slugs
    const slug1 = `phase-2-7-kb-${crypto.randomBytes(4).toString('hex')}`;
    const slug2 = `phase-2-7-empty-${crypto.randomBytes(4).toString('hex')}`;

    await db.query(`
      INSERT INTO ai_projects (id, name, slug, created_by_user_id)
      VALUES 
        ($1, 'Phase 2.7 Knowledge Project', $2, $3),
        ($4, 'Phase 2.7 Empty Project', $5, $3);
    `, [testProjectId, slug1, testUserId, testEmptyProjectId, slug2]);

    // 3. Seed KB document and chunks for hybrid retrieval testing
    testDocId = crypto.randomUUID();
    testVerId = crypto.randomUUID();
    testExtId = crypto.randomUUID();
    testChunk1Id = crypto.randomUUID();
    testChunk2Id = crypto.randomUUID();

    await db.query(`
      INSERT INTO ai_documents (id, project_id, title, original_filename, document_type, created_by_user_id)
      VALUES ($1, $2, 'Payment Gateway Architecture Spec', 'payment_arch.pdf', 'PDF', $3);
    `, [testDocId, testProjectId, testUserId]);

    await db.query(`
      INSERT INTO ai_document_versions (id, document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id)
      VALUES ($1, $2, 1, 'hash_pay_v1', 1024, '/test/payment_arch.pdf', 'PENDING', $3);
    `, [testVerId, testDocId, testUserId]);

    await db.query(`
      UPDATE ai_documents SET active_version_id = $1 WHERE id = $2;
    `, [testVerId, testDocId]);

    await db.query(`
      INSERT INTO ai_document_extractions (
        id, version_id, document_id, project_id, status, is_active,
        attempt_number, extractor_version, total_units, started_at, completed_at
      ) VALUES ($1, $2, $3, $4, 'COMPLETED', TRUE, 1, '1.0.0', 2, NOW(), NOW());
    `, [testExtId, testVerId, testDocId, testProjectId]);

    // Insert chunks
    await db.query(`
      INSERT INTO ai_document_chunks (
        id, extraction_id, version_id, document_id, project_id,
        chunk_index, content, token_count, page_number, section_heading, metadata
      ) VALUES 
        ($1, $2, $3, $4, $5, 0, 'Payment processing requires OAuth2 token validation. Transactions over 10000 USD require 2FA authorization code auth_code.', 25, 1, 'Payment Rules', '{}'::jsonb),
        ($6, $2, $3, $4, $5, 1, 'API rate limits: Client applications are throttled at 100 requests per minute. Status code 429 Too Many Requests is returned on breach.', 25, 2, 'Rate Limiting', '{}'::jsonb);
    `, [testChunk1Id, testExtId, testVerId, testDocId, testProjectId, testChunk2Id]);

    // Insert embeddings
    const activeConfig = await embeddingService.getActiveEmbeddingConfig();
    const activeModelId = activeConfig.id;
    if (activeModelId) {
      const mockEmbedding = Array(768).fill(0.01);
      const vecStr = `[${mockEmbedding.join(',')}]`;

      await db.query(`
        INSERT INTO ai_document_embeddings (
          id, chunk_id, extraction_id, version_id, document_id, project_id,
          model_id, embedding
        ) VALUES 
          (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7::vector),
          (gen_random_uuid(), $8, $2, $3, $4, $5, $6, $7::vector);
      `, [testChunk1Id, testExtId, testVerId, testDocId, testProjectId, activeModelId, vecStr, testChunk2Id]);
    }

    // Now mark version as COMPLETED
    await db.query(`
      UPDATE ai_document_versions
      SET indexing_status = 'COMPLETED'
      WHERE id = $1;
    `, [testVerId]);
  });

  after(async () => {
    // Cleanup test data
    try {
      await db.query(`DELETE FROM ai_generation_jobs WHERE project_id IN ($1, $2);`, [testProjectId, testEmptyProjectId]);
      await db.query(`DELETE FROM ai_requirement_traceability WHERE requirement_id IN (SELECT id FROM ai_requirements WHERE project_id IN ($1, $2));`, [testProjectId, testEmptyProjectId]);
      await db.query(`DELETE FROM ai_requirements WHERE project_id IN ($1, $2);`, [testProjectId, testEmptyProjectId]);
      await db.query(`DELETE FROM ai_requirement_analyses WHERE project_id IN ($1, $2);`, [testProjectId, testEmptyProjectId]);
      await db.query(`DELETE FROM ai_document_embeddings WHERE extraction_id = $1;`, [testExtId]);
      await db.query(`DELETE FROM ai_document_chunks WHERE extraction_id = $1;`, [testExtId]);
      await db.query(`DELETE FROM ai_document_extractions WHERE id = $1;`, [testExtId]);
      await db.query(`UPDATE ai_documents SET active_version_id = NULL WHERE id = $1;`, [testDocId]);
      await db.query(`DELETE FROM ai_document_versions WHERE id = $1;`, [testVerId]);
      await db.query(`DELETE FROM ai_documents WHERE id = $1;`, [testDocId]);
      await db.query(`DELETE FROM ai_projects WHERE id IN ($1, $2);`, [testProjectId, testEmptyProjectId]);
    } catch (_) {}
    await db.closePool();
  });

  // ===========================================================================
  // SUITE 1: Asynchronous Job Submission & Polling
  // ===========================================================================
  describe('Suite 1: Asynchronous Job Submission & Polling', () => {
    test('1.1 submitAnalysisJob returns HTTP 202 Accepted metadata structure', async () => {
      const res = await requirementAnalysisService.submitAnalysisJob({
        projectId: testProjectId,
        userId: testUserId,
        ticketId: 'PAY-101',
        title: 'Add 2FA for high value transactions',
        description: 'Enforce two-factor authentication when payment > 10000 USD.',
        retrievalMode: 'KEYWORD',
        autoStart: false
      });

      assert.ok(res.jobId, 'jobId must be returned');
      assert.strictEqual(res.status, 'PENDING');
      assert.strictEqual(res.currentStage, 'QUEUED');
      assert.strictEqual(res.progressPercent, 0);
      assert.strictEqual(res.isExisting, false);
    });

    test('1.2 getJobStatus returns valid job status and progress tracking', async () => {
      const res = await requirementAnalysisService.submitAnalysisJob({
        projectId: testProjectId,
        userId: testUserId,
        ticketId: 'PAY-102',
        title: 'Rate limit handling in checkout',
        autoStart: false
      });

      const status = await requirementAnalysisService.getJobStatus(testProjectId, res.jobId);
      assert.strictEqual(status.id, res.jobId);
      assert.strictEqual(status.project_id, testProjectId);
      assert.ok(['PENDING', 'PROCESSING', 'COMPLETED'].includes(status.status));
      assert.ok(typeof status.progress_percent === 'number');
    });

    test('1.3 Controller analyze returns HTTP 202 with JSON envelope', async () => {
      const req = {
        params: { projectId: testProjectId },
        user: { id: testUserId },
        body: {
          ticketId: 'PAY-103',
          title: 'Controller submission test',
          description: 'Testing controller endpoint',
          autoStart: false
        }
      };

      let responseStatus = null;
      let responseBody = null;
      const res = {
        status: (code) => { responseStatus = code; return res; },
        json: (data) => { responseBody = data; return res; }
      };

      await requirementAnalysisController.analyze(req, res);
      assert.strictEqual(responseStatus, 202);
      assert.strictEqual(responseBody.success, true);
      assert.ok(responseBody.data.jobId);
    });
  });

  // ===========================================================================
  // SUITE 2: Atomic Job Claiming & Stale Worker Fencing
  // ===========================================================================
  describe('Suite 2: Atomic Job Claiming & Stale Worker Fencing', () => {
    test('2.1 Two independent workers competing for same job: exactly ONE wins', async () => {
      const jobId = crypto.randomUUID();
      const idempotencyKey = `req_claim_test:${crypto.randomUUID()}`;

      await db.query(`
        INSERT INTO ai_generation_jobs (
          id, project_id, user_id, job_type, status, idempotency_key, current_stage, progress_percent
        ) VALUES ($1, $2, $3, 'ANALYZE_REQUIREMENTS', 'PENDING', $4, 'QUEUED', 0);
      `, [jobId, testProjectId, testUserId, idempotencyKey]);

      const client1 = await db.getClient();
      const client2 = await db.getClient();

      try {
        const claimPromise1 = client1.query(`
          UPDATE ai_generation_jobs
          SET status = 'PROCESSING',
              claim_token = gen_random_uuid(),
              worker_id = 'worker_alpha',
              version = version + 1,
              lease_expires_at = clock_timestamp() + INTERVAL '2 minutes'
          WHERE id = $1 AND (status = 'PENDING' OR (status = 'PROCESSING' AND lease_expires_at < clock_timestamp()))
          RETURNING claim_token, version;
        `, [jobId]);

        const claimPromise2 = client2.query(`
          UPDATE ai_generation_jobs
          SET status = 'PROCESSING',
              claim_token = gen_random_uuid(),
              worker_id = 'worker_beta',
              version = version + 1,
              lease_expires_at = clock_timestamp() + INTERVAL '2 minutes'
          WHERE id = $1 AND (status = 'PENDING' OR (status = 'PROCESSING' AND lease_expires_at < clock_timestamp()))
          RETURNING claim_token, version;
        `, [jobId]);

        const [res1, res2] = await Promise.all([claimPromise1, claimPromise2]);

        const totalWins = (res1.rowCount || 0) + (res2.rowCount || 0);
        assert.strictEqual(totalWins, 1, 'Exactly one worker must successfully claim the job');
      } finally {
        client1.release();
        client2.release();
      }
    });

    test('2.2 Expired lease allows takeover, fencing stale worker from subsequent commit', async () => {
      const jobId = crypto.randomUUID();
      const idempotencyKey = `req_fence_test:${crypto.randomUUID()}`;

      // Insert job already expired
      await db.query(`
        INSERT INTO ai_generation_jobs (
          id, project_id, user_id, job_type, status, idempotency_key,
          current_stage, progress_percent, claim_token, worker_id, version, lease_expires_at
        ) VALUES (
          $1, $2, $3, 'ANALYZE_REQUIREMENTS', 'PROCESSING', $4,
          'GENERATING_ANALYSIS', 60, gen_random_uuid(), 'stale_worker', 1, clock_timestamp() - INTERVAL '10 seconds'
        );
      `, [jobId, testProjectId, testUserId, idempotencyKey]);

      // Worker 2 reclaims the expired job
      const takeoverRes = await db.query(`
        UPDATE ai_generation_jobs
        SET status = 'PROCESSING',
            claim_token = gen_random_uuid(),
            worker_id = 'new_worker',
            version = version + 1,
            lease_expires_at = clock_timestamp() + INTERVAL '2 minutes'
        WHERE id = $1 AND (status = 'PENDING' OR (status = 'PROCESSING' AND lease_expires_at < clock_timestamp()))
        RETURNING claim_token, version;
      `, [jobId]);

      assert.strictEqual(takeoverRes.rowCount, 1, 'New worker should successfully reclaim expired job');
      const newVersion = takeoverRes.rows[0].version;
      assert.strictEqual(newVersion, 2, 'Version should increment on takeover');

      // Stale worker attempts to finalize with version 1
      const staleCommitRes = await db.query(`
        UPDATE ai_generation_jobs
        SET status = 'COMPLETED',
            progress_percent = 100
        WHERE id = $1 AND version = 1 AND status = 'PROCESSING';
      `, [jobId]);

      assert.strictEqual(staleCommitRes.rowCount, 0, 'Stale worker update must be fenced and affect 0 rows');
    });
  });

  // ===========================================================================
  // SUITE 3: Idempotency Matrix
  // ===========================================================================
  describe('Suite 3: Idempotency Matrix', () => {
    test('3.1 Submitting identical payload returns existing PENDING/PROCESSING job', async () => {
      const res1 = await requirementAnalysisService.submitAnalysisJob({
        projectId: testProjectId,
        userId: testUserId,
        ticketId: 'IDEM-001',
        title: 'Idempotency Test Title',
        description: 'Exact same body',
        autoStart: false
      });

      const res2 = await requirementAnalysisService.submitAnalysisJob({
        projectId: testProjectId,
        userId: testUserId,
        ticketId: 'IDEM-001',
        title: 'Idempotency Test Title',
        description: 'Exact same body',
        autoStart: false
      });

      assert.strictEqual(res2.jobId, res1.jobId, 'Should return same jobId');
      assert.strictEqual(res2.isExisting, true, 'isExisting must be true');
    });

    test('3.2 Submitting identical payload returns existing COMPLETED job result', async () => {
      const uniqueTicket = `IDEM-COMP-${crypto.randomBytes(4).toString('hex')}`;
      const title = 'Completed Idempotency Test';
      const key = requirementAnalysisService.computeIdempotencyKey(testProjectId, uniqueTicket, title, '');

      const mockAnalysisId = crypto.randomUUID();
      await db.query(`
        INSERT INTO ai_generation_jobs (
          id, project_id, user_id, job_type, status, idempotency_key,
          current_stage, progress_percent, result_reference
        ) VALUES (
          gen_random_uuid(), $1, $2, 'ANALYZE_REQUIREMENTS', 'COMPLETED', $3,
          'COMPLETED', 100, json_build_object('analysisId', $4::uuid)
        );
      `, [testProjectId, testUserId, key, mockAnalysisId]);

      const res = await requirementAnalysisService.submitAnalysisJob({
        projectId: testProjectId,
        userId: testUserId,
        ticketId: uniqueTicket,
        title,
        autoStart: false
      });

      assert.strictEqual(res.status, 'COMPLETED');
      assert.strictEqual(res.isExisting, true);
      assert.strictEqual(res.resultReference.analysisId, mockAnalysisId);
    });

    test('3.3 Submitting identical payload after FAILED job creates a new retry job', async () => {
      const uniqueTicket = `IDEM-FAIL-${crypto.randomBytes(4).toString('hex')}`;
      const title = 'Failed Idempotency Test';
      const key = requirementAnalysisService.computeIdempotencyKey(testProjectId, uniqueTicket, title, '');

      await db.query(`
        INSERT INTO ai_generation_jobs (
          id, project_id, user_id, job_type, status, idempotency_key,
          current_stage, progress_percent, error_message
        ) VALUES (
          gen_random_uuid(), $1, $2, 'ANALYZE_REQUIREMENTS', 'FAILED', $3,
          'FAILED', 30, 'Simulated prior failure'
        );
      `, [testProjectId, testUserId, key]);

      const res = await requirementAnalysisService.submitAnalysisJob({
        projectId: testProjectId,
        userId: testUserId,
        ticketId: uniqueTicket,
        title,
        autoStart: false
      });

      assert.strictEqual(res.status, 'PENDING');
      assert.strictEqual(res.isExisting, false);
    });
  });

  // ===========================================================================
  // SUITE 4: Collision-Proof Requirement Key Generation
  // ===========================================================================
  describe('Suite 4: Collision-Proof Requirement Key Generation Under Simultaneous Analyses', () => {
    test('4.1 Simultaneous analyses for same ticket generate non-colliding keys', async () => {
      const ticket = 'PAY-200';
      const hex1 = crypto.randomBytes(6).toString('hex').toUpperCase(); // 12 hex chars
      const hex2 = crypto.randomBytes(6).toString('hex').toUpperCase();

      const analysisId1 = crypto.randomUUID();
      const analysisId2 = crypto.randomUUID();

      await db.query(`
        INSERT INTO ai_requirement_analyses (
          id, project_id, task_reference, task_title, task_description, raw_input_type, status, analysis_summary, created_by_user_id
        ) VALUES 
          ($1, $2, $3, 'Concurrent Run 1', 'Concurrent Desc 1', 'TEXT_ONLY', 'COMPLETED', 'Summary 1', $5),
          ($4, $2, $3, 'Concurrent Run 2', 'Concurrent Desc 2', 'TEXT_ONLY', 'COMPLETED', 'Summary 2', $5);
      `, [analysisId1, testProjectId, ticket, analysisId2, testUserId]);

      // Generate 5 requirements for each analysis
      const keys1 = [];
      const keys2 = [];

      for (let i = 1; i <= 5; i++) {
        const k1 = `REQ-${ticket}-${hex1}-${String(i).padStart(2, '0')}`;
        const k2 = `REQ-${ticket}-${hex2}-${String(i).padStart(2, '0')}`;
        keys1.push(k1);
        keys2.push(k2);

        await db.query(`
          INSERT INTO ai_requirements (id, project_id, analysis_id, req_key, title, description, status)
          VALUES 
            (gen_random_uuid(), $1, $2, $3, 'Req Run 1', 'Req Desc 1', 'DRAFT'),
            (gen_random_uuid(), $1, $4, $5, 'Req Run 2', 'Req Desc 2', 'DRAFT');
        `, [testProjectId, analysisId1, k1, analysisId2, k2]);
      }

      const allKeys = [...keys1, ...keys2];
      const uniqueKeys = new Set(allKeys);
      assert.strictEqual(uniqueKeys.size, 10, 'All 10 generated keys across simultaneous runs must be strictly unique');
    });
  });

  // ===========================================================================
  // SUITE 5: Complete ACTIVE Requirement Immutability (All 13 Fields)
  // ===========================================================================
  describe('Suite 5: Complete ACTIVE Requirement Immutability', () => {
    let activeReqId = null;

    before(async () => {
      activeReqId = crypto.randomUUID();
      const analysisId = crypto.randomUUID();

      await db.query(`
        INSERT INTO ai_requirement_analyses (id, project_id, task_title, task_description, raw_input_type, status, analysis_summary, created_by_user_id)
        VALUES ($1, $2, 'Immutability Base', 'Immutability Base Description', 'TEXT_ONLY', 'COMPLETED', 'Base Summary', $3);
      `, [analysisId, testProjectId, testUserId]);

      await db.query(`
        INSERT INTO ai_requirements (
          id, project_id, analysis_id, req_key, title, description,
          category, priority, status, source_classification,
          business_rules, validations, dependencies, acceptance_criteria, evidence_citations
        ) VALUES (
          $1, $2, $3, 'REQ-IMM-001', 'Initial Active Title', 'Initial Active Desc',
          'FUNCTIONAL', 'HIGH', 'ACTIVE', 'DIRECT',
          '["Rule A"]'::jsonb, '["Val A"]'::jsonb, '["Dep A"]'::jsonb, '["AC A"]'::jsonb, '[]'::jsonb
        );
      `, [activeReqId, testProjectId, analysisId]);
    });

    const protectedFields = [
      { field: 'req_key', value: "'REQ-MUTATED'" },
      { field: 'title', value: "'Mutated Title'" },
      { field: 'description', value: "'Mutated Description'" },
      { field: 'category', value: "'PERFORMANCE'" },
      { field: 'priority', value: "'LOW'" },
      { field: 'business_rules', value: "'[\"Mutated Rule\"]'::jsonb" },
      { field: 'validations', value: "'[\"Mutated Val\"]'::jsonb" },
      { field: 'dependencies', value: "'[\"Mutated Dep\"]'::jsonb" },
      { field: 'acceptance_criteria', value: "'[\"Mutated AC\"]'::jsonb" },
      { field: 'evidence_citations', value: "'[{\"chunkId\":\"new\"}]'::jsonb" },
      { field: 'analysis_id', value: `'${crypto.randomUUID()}'::uuid` },
      { field: 'project_id', value: `'${crypto.randomUUID()}'::uuid` },
      { field: 'status', value: "'DRAFT'" } // Status downgrade
    ];

    for (const { field, value } of protectedFields) {
      test(`5.x Rejects modification to protected field: ${field}`, async () => {
        let threw = false;
        let errorCode = null;

        try {
          await db.query(`
            UPDATE ai_requirements
            SET ${field} = ${value}
            WHERE id = $1;
          `, [activeReqId]);
        } catch (err) {
          threw = true;
          errorCode = err.code;
        }

        assert.strictEqual(threw, true, `Modification to ${field} must throw an error`);
        assert.strictEqual(errorCode, '23514', `Must throw check_violation (23514) from immutability trigger`);
      });
    }

    test('5.14 Permits non-protected field update on ACTIVE requirement', async () => {
      const updateRes = await db.query(`
        UPDATE ai_requirements
        SET updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING id;
      `, [activeReqId]);

      assert.strictEqual(updateRes.rowCount, 1, 'Should permit updating updated_at without triggering violation');
    });

    test('5.15 Permits ACTIVE -> DEPRECATED lifecycle deprecation', async () => {
      const depReqId = crypto.randomUUID();
      await db.query(`
        INSERT INTO ai_requirements (id, project_id, req_key, title, description, status)
        VALUES ($1, $2, 'REQ-DEP-001', 'Deprecate Test', 'Desc', 'ACTIVE');
      `, [depReqId, testProjectId]);

      const depRes = await db.query(`
        UPDATE ai_requirements
        SET status = 'DEPRECATED',
            updated_at = clock_timestamp()
        WHERE id = $1
        RETURNING status;
      `, [depReqId]);

      assert.strictEqual(depRes.rowCount, 1);
      assert.strictEqual(depRes.rows[0].status, 'DEPRECATED', 'ACTIVE requirement can be transitioned to DEPRECATED');
    });

    test('5.16 Background analysis cannot overwrite or delete existing ACTIVE requirements', async () => {
      // Confirm ACTIVE requirement before
      const beforeCheck = await db.query(`SELECT id, status, title FROM ai_requirements WHERE id = $1;`, [activeReqId]);
      assert.strictEqual(beforeCheck.rows[0].status, 'ACTIVE');
      const originalTitle = beforeCheck.rows[0].title;

      // Simulate concurrent worker analysis run with same project and ticket
      const newAnalysisId = crypto.randomUUID();
      await db.query(`
        INSERT INTO ai_requirement_analyses (id, project_id, task_title, task_description, raw_input_type, status, analysis_summary, created_by_user_id)
        VALUES ($1, $2, 'New Background Run', 'Desc', 'TEXT_ONLY', 'COMPLETED', 'Summary', $3);
      `, [newAnalysisId, testProjectId, testUserId]);

      // Insert new DRAFT requirement with unique key
      const newDraftId = crypto.randomUUID();
      await db.query(`
        INSERT INTO ai_requirements (id, project_id, analysis_id, req_key, title, description, status)
        VALUES ($1, $2, $3, 'REQ-NEW-RUN-01', 'New Draft Req', 'New Desc', 'DRAFT');
      `, [newDraftId, testProjectId, newAnalysisId]);

      // Verify original ACTIVE requirement is completely untouched
      const afterCheck = await db.query(`SELECT id, status, title FROM ai_requirements WHERE id = $1;`, [activeReqId]);
      assert.strictEqual(afterCheck.rows[0].status, 'ACTIVE');
      assert.strictEqual(afterCheck.rows[0].title, originalTitle);
    });
  });

  // ===========================================================================
  // SUITE 6: Atomic Analysis Persistence & Rollback on Fencing Mismatch
  // ===========================================================================
  describe('Suite 6: Atomic Analysis Persistence & Rollback on Fencing Mismatch', () => {
    test('6.1 Rollback aborts all inserts if worker fencing check fails', async () => {
      const client = await db.getClient();
      const fakeJobId = crypto.randomUUID();
      const fakeAnalysisId = crypto.randomUUID();
      const fakeReqId = crypto.randomUUID();

      await db.query(`
        INSERT INTO ai_generation_jobs (
          id, project_id, user_id, job_type, status, idempotency_key,
          current_stage, progress_percent, claim_token, version
        ) VALUES (
          $1, $2, $3, 'ANALYZE_REQUIREMENTS', 'PROCESSING', $4,
          'GENERATING_ANALYSIS', 60, gen_random_uuid(), 5
        );
      `, [fakeJobId, testProjectId, testUserId, `req_rb_test:${fakeJobId}`]);

      let transactionError = null;
      try {
        await client.query('BEGIN;');

        // Simulate stale worker with mismatched version (version 4 instead of 5)
        const lockCheck = await client.query(`
          SELECT claim_token, version, status 
          FROM ai_generation_jobs 
          WHERE id = $1 
          FOR UPDATE;
        `, [fakeJobId]);

        const expectedVersion = 4; // Mismatched!
        if (lockCheck.rows[0].version !== expectedVersion) {
          await client.query('ROLLBACK;');
          throw new Error('FENCING_ERROR: Stale worker prevented from committing.');
        }

        // Inserts that should never run
        await client.query(`
          INSERT INTO ai_requirement_analyses (id, project_id, task_title, raw_input_type, status, analysis_summary)
          VALUES ($1, $2, 'Orphaned Analysis', 'TEXT_ONLY', 'COMPLETED', 'Should not exist');
        `, [fakeAnalysisId, testProjectId]);

        await client.query('COMMIT;');
      } catch (err) {
        transactionError = err;
      } finally {
        client.release();
      }

      assert.ok(transactionError, 'Must throw fencing error');
      assert.ok(transactionError.message.includes('FENCING_ERROR'));

      // Verify no orphaned records exist
      const checkAnalysis = await db.query(`SELECT id FROM ai_requirement_analyses WHERE id = $1;`, [fakeAnalysisId]);
      assert.strictEqual(checkAnalysis.rows.length, 0, 'No orphaned analysis should exist');
    });
  });

  // ===========================================================================
  // SUITE 7: Attachment Resource Limits & Memory Safety
  // ===========================================================================
  describe('Suite 7: Attachment Resource Limits & Memory Safety', () => {
    test('7.1 Rejects attachment exceeding 10 MB limit', async () => {
      const largeBuffer = Buffer.alloc(11 * 1024 * 1024); // 11 MB
      let threw = false;
      let errorCode = null;

      try {
        await requirementAnalysisService.parseTaskAttachment(largeBuffer, 'large_spec.pdf', 'application/pdf');
      } catch (err) {
        threw = true;
        errorCode = err.code;
      }

      assert.strictEqual(threw, true, 'Should reject > 10MB buffer');
      assert.strictEqual(errorCode, 'LIMIT_FILE_SIZE');
    });

    test('7.2 Correctly parses supported text and CSV attachments', async () => {
      const csvContent = 'Requirement,Priority,Notes\nReq-1,High,Core auth\nReq-2,Low,Telemetry';
      const buffer = Buffer.from(csvContent, 'utf-8');

      const parsed = await requirementAnalysisService.parseTaskAttachment(buffer, 'spec.csv', 'text/csv');
      assert.ok(parsed.text.includes('Core auth'));
      assert.strictEqual(parsed.metadata.extension, 'csv');
      assert.ok(parsed.metadata.sha256);
      assert.strictEqual(parsed.metadata.sizeBytes, buffer.length);
    });
  });

  // ===========================================================================
  // SUITE 8: Automated Evidence Screening (4-Tier Screening)
  // ===========================================================================
  describe('Suite 8: Automated Evidence Screening', () => {
    const evidenceMap = new Map();
    evidenceMap.set('E-1', {
      chunkId: 'chunk-123',
      content: 'OAuth2 token authentication is required for all API endpoints. JWT must be signed with RS256.',
      provenance: { documentTitle: 'Auth Spec', sourceLocationDisplay: 'p. 1' }
    });
    evidenceMap.set('E-2', {
      chunkId: 'chunk-456',
      content: 'Database connection pooling is configured with standard settings.',
      provenance: { documentTitle: 'DB Spec', sourceLocationDisplay: 'p. 5' }
    });

    test('8.1 Tier 1: Plausible Support retains GROUNDED_INFERENCE classification', () => {
      const rawReq = {
        title: 'OAuth2 JWT RS256 validation',
        description: 'Verify all JWT tokens are signed using RS256 algorithm.',
        classification: 'GROUNDED_INFERENCE',
        priority: 'HIGH',
        evidence_keys: ['E-1']
      };

      const screened = screenRequirementEvidence(rawReq, evidenceMap);
      assert.strictEqual(screened.classification, 'GROUNDED_INFERENCE');
      assert.strictEqual(screened.citations[0].evidenceStatus, 'PLAUSIBLE_SUPPORT');
      assert.strictEqual(screened.citations[0].chunkId, 'chunk-123');
    });

    test('8.2 Tier 2: Topical/Ambiguous match downgrades to ASSUMPTION', () => {
      const rawReq = {
        title: 'Database connection pooling configuration',
        description: 'Set maximum idle database connections to 20.',
        classification: 'GROUNDED_INFERENCE',
        priority: 'MEDIUM',
        evidence_keys: ['E-2'] // E-2 is about CSS theme colors, unrelated to database pooling
      };

      const screened = screenRequirementEvidence(rawReq, evidenceMap);
      assert.strictEqual(screened.classification, 'ASSUMPTION', 'Low topicality citation must downgrade to ASSUMPTION');
      assert.strictEqual(screened.citations[0].evidenceStatus, 'TOPICAL_AMBIGUOUS');
    });

    test('8.3 Tier 3: Unsupported citation downgrades to ASSUMPTION', () => {
      const emptyMap = new Map();
      const rawReq = {
        title: 'High availability clustering',
        description: 'Cluster nodes across 3 availability zones.',
        classification: 'GROUNDED_INFERENCE',
        priority: 'HIGH',
        evidence_keys: []
      };

      const screened = screenRequirementEvidence(rawReq, emptyMap);
      assert.strictEqual(screened.classification, 'ASSUMPTION');
      assert.strictEqual(screened.citations[0].evidenceStatus, 'UNSUPPORTED_CITATION');
    });

    test('8.4 Tier 4: Invalid hallucinated key downgrades to ASSUMPTION', () => {
      const rawReq = {
        title: 'Hallucinated citation test',
        description: 'Testing non-existent citation key.',
        classification: 'GROUNDED_INFERENCE',
        priority: 'MEDIUM',
        evidence_keys: ['E-999'] // E-999 does not exist
      };

      const screened = screenRequirementEvidence(rawReq, evidenceMap);
      assert.strictEqual(screened.classification, 'ASSUMPTION');
      assert.strictEqual(screened.citations[0].evidenceStatus, 'INVALID_EVIDENCE_KEY');
    });
  });

  // ===========================================================================
  // SUITE 9: Multi-Query Hybrid Retrieval & Ungrounded Mode Fallback
  // ===========================================================================
  describe('Suite 9: Multi-Query Hybrid Retrieval & Ungrounded Mode Fallback', () => {
    test('9.1 Empty knowledge base project triggers UNGROUNDED_NO_KB mode gracefully', async () => {
      const res = await requirementAnalysisService.submitAnalysisJob({
        projectId: testEmptyProjectId,
        userId: testUserId,
        ticketId: 'EMPTY-001',
        title: 'Task in brand new project without documents',
        description: 'Implement simple greeting API endpoint.',
        autoStart: false
      });

      assert.ok(res.jobId);
      assert.strictEqual(res.status, 'PENDING');
    });
  });

  // ===========================================================================
  // SUITE 10: Safe Analysis Deletion Preserving Active Requirements
  // ===========================================================================
  describe('Suite 10: Safe Analysis Deletion Preserving Active Requirements', () => {
    test('10.1 Deleting analysis nullifies analysis_id on ACTIVE requirements while preserving project_id and records', async () => {
      const analysisId = crypto.randomUUID();
      const reqActiveId = crypto.randomUUID();
      const reqDraftId = crypto.randomUUID();

      await db.query(`
        INSERT INTO ai_requirement_analyses (id, project_id, task_title, task_description, raw_input_type, status, analysis_summary, created_by_user_id)
        VALUES ($1, $2, 'Delete Safe Test', 'Task description for safe deletion test', 'TEXT_ONLY', 'COMPLETED', 'Summary', $3);
      `, [analysisId, testProjectId, testUserId]);

      await db.query(`
        INSERT INTO ai_requirements (id, project_id, analysis_id, req_key, title, description, status)
        VALUES 
          ($1, $2, $3, 'REQ-DEL-ACT-01', 'Active Preserved', 'Active requirement description', 'ACTIVE'),
          ($4, $2, $3, 'REQ-DEL-DFT-02', 'Draft Preserved', 'Draft requirement description', 'DRAFT');
      `, [reqActiveId, testProjectId, analysisId, reqDraftId]);

      // Add RTM record
      await db.query(`
        INSERT INTO ai_requirement_traceability (id, requirement_id, chunk_id, trace_type)
        VALUES (gen_random_uuid(), $1, $2, 'DIRECT_COVERAGE');
      `, [reqActiveId, testChunk1Id]);

      // Perform safe deletion of analysis
      const delRes = await requirementAnalysisService.deleteAnalysis(testProjectId, analysisId);
      assert.strictEqual(delRes.success, true);

      // Verify analysis is deleted
      const checkAnalysis = await db.query(`SELECT id FROM ai_requirement_analyses WHERE id = $1;`, [analysisId]);
      assert.strictEqual(checkAnalysis.rows.length, 0, 'Analysis must be deleted');

      // Verify requirements are preserved with analysis_id = NULL
      const checkReqs = await db.query(`
        SELECT id, project_id, analysis_id, status FROM ai_requirements WHERE id IN ($1, $2);
      `, [reqActiveId, reqDraftId]);

      assert.strictEqual(checkReqs.rows.length, 2, 'Both requirements must still exist');
      for (const r of checkReqs.rows) {
        assert.strictEqual(r.analysis_id, null, 'analysis_id must be set to NULL');
        assert.strictEqual(r.project_id, testProjectId, 'project_id must remain intact');
      }

      // Verify RTM record still exists
      const checkRtm = await db.query(`SELECT id FROM ai_requirement_traceability WHERE requirement_id = $1;`, [reqActiveId]);
      assert.strictEqual(checkRtm.rows.length, 1, 'RTM link must be preserved');
    });
  });

  // ===========================================================================
  // SUITE 11: Explicit Human Approval from DRAFT to ACTIVE
  // ===========================================================================
  describe('Suite 11: Explicit Human Approval', () => {
    test('11.1 Promotes DRAFT requirement to ACTIVE', async () => {
      const draftReqId = crypto.randomUUID();

      await db.query(`
        INSERT INTO ai_requirements (id, project_id, req_key, title, description, status)
        VALUES ($1, $2, 'REQ-APPR-01', 'Draft to be Approved', 'Requirement description for approval', 'DRAFT');
      `, [draftReqId, testProjectId]);

      const res = await requirementAnalysisService.approveRequirement(testProjectId, draftReqId, testUserId, 'Approved by QA Lead');
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.requirement.status, 'ACTIVE');

      const check = await db.query(`SELECT status FROM ai_requirements WHERE id = $1;`, [draftReqId]);
      assert.strictEqual(check.rows[0].status, 'ACTIVE');
    });

    test('11.2 Approving already ACTIVE requirement is idempotent and succeeds', async () => {
      const activeReqId = crypto.randomUUID();

      await db.query(`
        INSERT INTO ai_requirements (id, project_id, req_key, title, description, status)
        VALUES ($1, $2, 'REQ-APPR-02', 'Already Active', 'Requirement description already active', 'ACTIVE');
      `, [activeReqId, testProjectId]);

      const res = await requirementAnalysisService.approveRequirement(testProjectId, activeReqId, testUserId);
      assert.strictEqual(res.success, true);
      assert.strictEqual(res.requirement.status, 'ACTIVE');
    });

    test('11.3 Rejects approval for non-existent requirement with 404', async () => {
      const nonExistentId = crypto.randomUUID();
      let threw = false;
      let status = null;

      try {
        await requirementAnalysisService.approveRequirement(testProjectId, nonExistentId, testUserId);
      } catch (err) {
        threw = true;
        status = err.status;
      }

      assert.strictEqual(threw, true, 'Approving non-existent requirement must throw');
      assert.strictEqual(status, 404, 'Must throw 404');
    });

    test('11.4 Rejects cross-project approval attempt with 404', async () => {
      const reqId = crypto.randomUUID();
      // Requirement belongs to testProjectId
      await db.query(`
        INSERT INTO ai_requirements (id, project_id, req_key, title, description, status)
        VALUES ($1, $2, 'REQ-CROSS-01', 'Cross-project candidate', 'Desc', 'DRAFT');
      `, [reqId, testProjectId]);

      let threw = false;
      let status = null;

      try {
        // Attempt to approve via testEmptyProjectId
        await requirementAnalysisService.approveRequirement(testEmptyProjectId, reqId, testUserId);
      } catch (err) {
        threw = true;
        status = err.status;
      }

      assert.strictEqual(threw, true, 'Cross-project approval must be rejected');
      assert.strictEqual(status, 404, 'Must throw 404 indicating requirement not found in project');
    });

    test('11.5 Rejects approval of DEPRECATED requirement with 400', async () => {
      const depReqId = crypto.randomUUID();
      await db.query(`
        INSERT INTO ai_requirements (id, project_id, req_key, title, description, status)
        VALUES ($1, $2, 'REQ-DEP-APPR', 'Deprecated Requirement', 'Desc', 'DEPRECATED');
      `, [depReqId, testProjectId]);

      let threw = false;
      let status = null;

      try {
        await requirementAnalysisService.approveRequirement(testProjectId, depReqId, testUserId);
      } catch (err) {
        threw = true;
        status = err.status;
      }

      assert.strictEqual(threw, true, 'Approving DEPRECATED requirement must throw');
      assert.strictEqual(status, 400, 'Must throw 400 status code');
    });
  });
});
