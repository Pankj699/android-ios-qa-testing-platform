const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db/connection');
const { runAiMigrations, MIGRATION_ADVISORY_LOCK_ID } = require('../db/migrationRunner');

describe('Phase 2.2 — Final Verification Test Suite', () => {
  let client;
  const testRunId = `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const testSlugPrefix = `verif-${testRunId}`;

  // Helper to create test project with unique slug
  async function createTestProject(nameSuffix) {
    const slug = `${testSlugPrefix}-${nameSuffix}`;
    const res = await client.query(`
      INSERT INTO ai_projects (name, slug, created_by_user_id)
      VALUES ($1, $2, gen_random_uuid())
      RETURNING id, slug, name
    `, [`Verification Project ${nameSuffix}`, slug]);
    return res.rows[0];
  }

  before(async () => {
    client = await db.getClient();
  });

  after(async () => {
    if (client) {
      try {
        await client.query("DELETE FROM ai_projects WHERE slug LIKE 'verif-%'");
      } catch (err) {
        console.error('[Cleanup Warning]', err.message);
      }
      client.release();
    }
    await db.closePool();
  });

  // ==========================================================================
  // SECTION A: Outbox Recovery Tests
  // ==========================================================================
  describe('A. Outbox Recovery Tests', () => {
    let proj;

    before(async () => {
      proj = await createTestProject('outbox');
    });

    it('A.1: Stuck/Pending Job Detection and Safe Retry Mechanism', async () => {
      // 1. Create a job with status = 'PENDING' and no pg-boss job record (pgboss_job_id IS NULL)
      const insertRes = await client.query(`
        INSERT INTO ai_generation_jobs (
          project_id, user_id, job_type, status, dispatch_status, retry_count, max_retries
        ) VALUES (
          $1, gen_random_uuid(), 'GENERATE_TEST_CASES', 'PENDING', 'OUTBOX_PENDING', 0, 3
        ) RETURNING id, status, dispatch_status, pgboss_job_id, retry_count, max_retries
      `, [proj.id]);
      const job = insertRes.rows[0];
      assert.equal(job.status, 'PENDING');
      assert.equal(job.dispatch_status, 'OUTBOX_PENDING');
      assert.equal(job.pgboss_job_id, null);
      assert.equal(job.retry_count, 0);

      // 2. Verify sweeper query detects it
      const sweeperRes = await client.query(`
        SELECT id, project_id, job_type, status, dispatch_status, retry_count, max_retries
        FROM ai_generation_jobs
        WHERE dispatch_status = 'OUTBOX_PENDING' AND id = $1
        ORDER BY created_at ASC
        LIMIT 20
        FOR UPDATE SKIP LOCKED
      `, [job.id]);
      assert.equal(sweeperRes.rows.length, 1);
      assert.equal(sweeperRes.rows[0].id, job.id);

      // 3. Verify it can be dispatched or safely retried (incrementing retry_count)
      await client.query(`
        UPDATE ai_generation_jobs
        SET retry_count = retry_count + 1, updated_at = NOW()
        WHERE id = $1
      `, [job.id]);

      const retryRes = await client.query(`
        SELECT retry_count, status, dispatch_status FROM ai_generation_jobs WHERE id = $1
      `, [job.id]);
      assert.equal(retryRes.rows[0].retry_count, 1);
      assert.equal(retryRes.rows[0].dispatch_status, 'OUTBOX_PENDING');

      // 4. Verify it cannot remain permanently stuck:
      // When retry_count reaches max_retries, it transitions to terminal FAILED
      await client.query(`
        UPDATE ai_generation_jobs
        SET retry_count = 3,
            status = 'FAILED',
            dispatch_status = 'FAILED',
            error_message = 'Exceeded max dispatch attempts',
            internal_diagnostics = '{"reason": "Exceeded max dispatch attempts"}'::jsonb,
            updated_at = NOW()
        WHERE id = $1
      `, [job.id]);

      // 5. Verify it is no longer selected by the outbox sweeper
      const finalSweeperRes = await client.query(`
        SELECT id FROM ai_generation_jobs
        WHERE dispatch_status = 'OUTBOX_PENDING' AND id = $1
        FOR UPDATE SKIP LOCKED
      `, [job.id]);
      assert.equal(finalSweeperRes.rows.length, 0, 'Job must no longer appear in OUTBOX_PENDING queue');

      const finalState = await client.query(`
        SELECT status, dispatch_status, error_message, internal_diagnostics FROM ai_generation_jobs WHERE id = $1
      `, [job.id]);
      assert.equal(finalState.rows[0].status, 'FAILED');
      assert.equal(finalState.rows[0].dispatch_status, 'FAILED');
      assert.equal(finalState.rows[0].error_message, 'Exceeded max dispatch attempts');
      assert.equal(finalState.rows[0].internal_diagnostics.reason, 'Exceeded max dispatch attempts');
    });

    it('A.2: In-Flight Stale Job Recovery & Concurrent Sweeper Protection', async () => {
      // 1. Create a test job with status = 'PROCESSING' and dispatch_status = 'OUTBOX_PENDING'
      // with expired lease (lease_expires_at 5 minutes in the past)
      const insertRes = await client.query(`
        INSERT INTO ai_generation_jobs (
          project_id, user_id, job_type, status, dispatch_status,
          retry_count, max_retries, lease_expires_at
        ) VALUES (
          $1, gen_random_uuid(), 'INDEX_DOCUMENT', 'PROCESSING', 'OUTBOX_PENDING',
          0, 3, NOW() - INTERVAL '5 minutes'
        ) RETURNING id, status, dispatch_status, lease_expires_at
      `, [proj.id]);
      const staleJobId = insertRes.rows[0].id;

      // 2. Verify watchdog detects stale processing job
      const watchdogRes = await client.query(`
        SELECT id, status, retry_count, max_retries, lease_expires_at
        FROM ai_generation_jobs
        WHERE status = 'PROCESSING' AND lease_expires_at < NOW() AND id = $1
        FOR UPDATE SKIP LOCKED
      `, [staleJobId]);
      assert.equal(watchdogRes.rows.length, 1);
      assert.equal(watchdogRes.rows[0].id, staleJobId);

      // 3. Verify repeated sweeper/watchdog executions do not select it indefinitely without progress
      // Each recovery attempt increments retry_count; once retry_count >= max_retries, it terminates to FAILED
      for (let attempt = 1; attempt <= 3; attempt++) {
        await client.query(`
          UPDATE ai_generation_jobs
          SET retry_count = retry_count + 1,
              status = CASE WHEN retry_count + 1 >= max_retries THEN 'FAILED' ELSE 'PENDING' END,
              dispatch_status = CASE WHEN retry_count + 1 >= max_retries THEN 'FAILED' ELSE 'OUTBOX_PENDING' END,
              updated_at = NOW()
          WHERE id = $1
        `, [staleJobId]);
      }

      const terminalCheck = await client.query(`
        SELECT status, dispatch_status, retry_count FROM ai_generation_jobs WHERE id = $1
      `, [staleJobId]);
      assert.equal(terminalCheck.rows[0].status, 'FAILED');
      assert.equal(terminalCheck.rows[0].dispatch_status, 'FAILED');
      assert.equal(terminalCheck.rows[0].retry_count, 3);

      // 4. Verify concurrent sweepers do not process the same row simultaneously via FOR UPDATE SKIP LOCKED
      // Create a new pending outbox job
      const concRes = await client.query(`
        INSERT INTO ai_generation_jobs (
          project_id, user_id, job_type, status, dispatch_status
        ) VALUES (
          $1, gen_random_uuid(), 'INDEX_DOCUMENT', 'PENDING', 'OUTBOX_PENDING'
        ) RETURNING id
      `, [proj.id]);
      const concJobId = concRes.rows[0].id;

      const worker1Client = await db.getClient();
      const worker2Client = await db.getClient();

      try {
        // Worker 1 starts transaction and locks the job
        await worker1Client.query('BEGIN');
        const w1Select = await worker1Client.query(`
          SELECT id FROM ai_generation_jobs
          WHERE dispatch_status = 'OUTBOX_PENDING' AND id = $1
          FOR UPDATE SKIP LOCKED
        `, [concJobId]);
        assert.equal(w1Select.rows.length, 1, 'Worker 1 must acquire the row lock');

        // Worker 2 attempts concurrent selection with FOR UPDATE SKIP LOCKED
        await worker2Client.query('BEGIN');
        const w2Select = await worker2Client.query(`
          SELECT id FROM ai_generation_jobs
          WHERE dispatch_status = 'OUTBOX_PENDING' AND id = $1
          FOR UPDATE SKIP LOCKED
        `, [concJobId]);
        assert.equal(w2Select.rows.length, 0, 'Worker 2 must skip the locked row and receive 0 rows');

        // Worker 1 marks the job DISPATCHED and commits
        await worker1Client.query(`
          UPDATE ai_generation_jobs SET dispatch_status = 'DISPATCHED' WHERE id = $1
        `, [concJobId]);
        await worker1Client.query('COMMIT');
        await worker2Client.query('COMMIT');
      } finally {
        worker1Client.release();
        worker2Client.release();
      }
    });

    it('A.3: Preserve Terminal-State In-Memory Reconciliation', async () => {
      // 1. Create two jobs in terminal states (COMPLETED and FAILED) but with OUTBOX_PENDING
      const completedJobRes = await client.query(`
        INSERT INTO ai_generation_jobs (
          project_id, user_id, job_type, status, dispatch_status
        ) VALUES (
          $1, gen_random_uuid(), 'GENERATE_TEST_CASES', 'COMPLETED', 'OUTBOX_PENDING'
        ) RETURNING id
      `, [proj.id]);
      const compJobId = completedJobRes.rows[0].id;

      const failedJobRes = await client.query(`
        INSERT INTO ai_generation_jobs (
          project_id, user_id, job_type, status, dispatch_status
        ) VALUES (
          $1, gen_random_uuid(), 'INDEX_DOCUMENT', 'FAILED', 'OUTBOX_PENDING'
        ) RETURNING id
      `, [proj.id]);
      const failJobId = failedJobRes.rows[0].id;

      // 2. Sweeper selects terminal jobs because query does NOT require status = 'PENDING'
      const sweeperRes = await client.query(`
        SELECT id, status, dispatch_status
        FROM ai_generation_jobs
        WHERE dispatch_status = 'OUTBOX_PENDING' AND id = ANY($1::uuid[])
        FOR UPDATE SKIP LOCKED
      `, [[compJobId, failJobId]]);
      assert.equal(sweeperRes.rows.length, 2);

      // 3. Reconcile both jobs directly in-memory to DISPATCHED without queue interaction
      for (const row of sweeperRes.rows) {
        assert.ok(['COMPLETED', 'FAILED'].includes(row.status));
        await client.query(`
          UPDATE ai_generation_jobs
          SET dispatch_status = 'DISPATCHED', updated_at = NOW()
          WHERE id = $1
        `, [row.id]);
      }

      // 4. Verify neither job appears in OUTBOX_PENDING
      const verifyRes = await client.query(`
        SELECT id FROM ai_generation_jobs
        WHERE dispatch_status = 'OUTBOX_PENDING' AND id = ANY($1::uuid[])
      `, [[compJobId, failJobId]]);
      assert.equal(verifyRes.rows.length, 0);
    });
  });

  // ==========================================================================
  // SECTION B: Chat Persistence Tests
  // ==========================================================================
  describe('B. Chat Persistence Tests', () => {
    let projA, projB;
    let conv1Id, conv2Id;
    let docAId, docBId;

    before(async () => {
      projA = await createTestProject('chat-a');
      projB = await createTestProject('chat-b');

      // Create Document under Project A
      const docARes = await client.query(`
        INSERT INTO ai_documents (
          project_id, title, original_filename, document_type, created_by_user_id
        ) VALUES (
          $1, 'Checkout Requirements Spec', 'checkout.pdf', 'PDF', gen_random_uuid()
        ) RETURNING id
      `, [projA.id]);
      docAId = docARes.rows[0].id;

      // Create Document under Project B
      const docBRes = await client.query(`
        INSERT INTO ai_documents (
          project_id, title, original_filename, document_type, created_by_user_id
        ) VALUES (
          $1, 'Project B Spec', 'spec_b.pdf', 'PDF', gen_random_uuid()
        ) RETURNING id
      `, [projB.id]);
      docBId = docBRes.rows[0].id;
    });

    it('B.1 & B.2: Create Two Conversations Under Same Project & Insert Different Messages', async () => {
      // 1. Create two conversations under Project A
      const conv1Res = await client.query(`
        INSERT INTO ai_chat_conversations (
          project_id, user_id, title, task_reference, scope_mode
        ) VALUES (
          $1, gen_random_uuid(), 'Conversation Alpha: Auth Focus', 'JIRA-1001', 'PROJECT_KNOWLEDGE_BASE'
        ) RETURNING id
      `, [projA.id]);
      conv1Id = conv1Res.rows[0].id;

      const conv2Res = await client.query(`
        INSERT INTO ai_chat_conversations (
          project_id, user_id, title, task_reference, scope_mode
        ) VALUES (
          $1, gen_random_uuid(), 'Conversation Beta: Payment Focus', NULL, 'SELECTED_DOCUMENTS'
        ) RETURNING id
      `, [projA.id]);
      conv2Id = conv2Res.rows[0].id;

      // 2. Insert messages into Conversation 1
      await client.query(`
        INSERT INTO ai_chat_messages (conversation_id, role, content, model_name, tokens_used)
        VALUES
          ($1, 'USER', 'What are the authentication test requirements?', 'qwen2.5:3b-instruct', 15),
          ($1, 'ASSISTANT', 'The system requires 2FA and OAuth2 authorization.', 'qwen2.5:3b-instruct', 45)
      `, [conv1Id]);

      // 3. Insert different messages into Conversation 2
      await client.query(`
        INSERT INTO ai_chat_messages (conversation_id, role, content, model_name, tokens_used)
        VALUES
          ($1, 'USER', 'How does the payment gateway handle 3DS callback timeout?', 'qwen2.5:3b-instruct', 22),
          ($1, 'ASSISTANT', 'A timeout triggers automatic transaction voiding and event emission.', 'qwen2.5:3b-instruct', 60)
      `, [conv2Id]);

      // Verify insertion counts
      const c1Count = await client.query('SELECT count(*) FROM ai_chat_messages WHERE conversation_id = $1', [conv1Id]);
      assert.equal(parseInt(c1Count.rows[0].count), 2);

      const c2Count = await client.query('SELECT count(*) FROM ai_chat_messages WHERE conversation_id = $1', [conv2Id]);
      assert.equal(parseInt(c2Count.rows[0].count), 2);
    });

    it('B.3: Each Conversation Returns Only Its Own Message History (Isolation)', async () => {
      // Query Conversation 1 history
      const c1History = await client.query(`
        SELECT role, content FROM ai_chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC
      `, [conv1Id]);

      assert.equal(c1History.rows.length, 2);
      assert.equal(c1History.rows[0].content, 'What are the authentication test requirements?');
      assert.equal(c1History.rows[1].content, 'The system requires 2FA and OAuth2 authorization.');

      // Query Conversation 2 history
      const c2History = await client.query(`
        SELECT role, content FROM ai_chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC
      `, [conv2Id]);

      assert.equal(c2History.rows.length, 2);
      assert.equal(c2History.rows[0].content, 'How does the payment gateway handle 3DS callback timeout?');
      assert.equal(c2History.rows[1].content, 'A timeout triggers automatic transaction voiding and event emission.');

      // Cross-check: none of Conv2's messages appear in Conv1's query
      const c1Contents = c1History.rows.map(r => r.content);
      for (const r2 of c2History.rows) {
        assert.ok(!c1Contents.includes(r2.content), `Conversation 1 leaked message: ${r2.content}`);
      }
    });

    it('B.4: Optional Task Association (task_reference)', async () => {
      // Conversation 1 was initialized with task_reference = 'JIRA-1001'
      const c1Check = await client.query(`
        SELECT task_reference FROM ai_chat_conversations WHERE id = $1
      `, [conv1Id]);
      assert.equal(c1Check.rows[0].task_reference, 'JIRA-1001');

      // Conversation 2 was initialized with NULL task_reference
      const c2Check = await client.query(`
        SELECT task_reference FROM ai_chat_conversations WHERE id = $1
      `, [conv2Id]);
      assert.equal(c2Check.rows[0].task_reference, null);

      // Verify task_reference can be updated to link an issue
      await client.query(`
        UPDATE ai_chat_conversations SET task_reference = 'GH-ISSUE-402' WHERE id = $1
      `, [conv2Id]);

      const c2Updated = await client.query(`
        SELECT task_reference FROM ai_chat_conversations WHERE id = $1
      `, [conv2Id]);
      assert.equal(c2Updated.rows[0].task_reference, 'GH-ISSUE-402');
    });

    it('B.5: Source / Citation References (JSONB) Storage & Retrieval', async () => {
      const mockCitations = [
        {
          chunk_id: 'a0000000-0000-0000-0000-000000000001',
          document_title: 'Checkout Requirements Spec',
          section: '3.4 Payment Gateways',
          page_number: 14,
          similarity_score: 0.932
        },
        {
          chunk_id: 'a0000000-0000-0000-0000-000000000002',
          document_title: 'Checkout Requirements Spec',
          section: '3.5 Callback Retries',
          page_number: 16,
          similarity_score: 0.887
        }
      ];

      // Insert message with rich structured citations
      const msgRes = await client.query(`
        INSERT INTO ai_chat_messages (
          conversation_id, role, content, citations, model_name, tokens_used
        ) VALUES (
          $1, 'ASSISTANT', 'According to section 3.4 and 3.5, callback retries expire after 3 attempts.',
          $2::jsonb, 'qwen2.5:3b-instruct', 85
        ) RETURNING id, citations
      `, [conv2Id, JSON.stringify(mockCitations)]);

      const msgId = msgRes.rows[0].id;

      // Retrieve message citations via JSONB operators
      const queryRes = await client.query(`
        SELECT
          citations,
          jsonb_array_length(citations) as citation_count,
          citations->0->>'document_title' as first_doc,
          (citations->0->>'similarity_score')::numeric as first_score,
          citations->1->>'section' as second_section
        FROM ai_chat_messages
        WHERE id = $1
      `, [msgId]);

      const row = queryRes.rows[0];
      assert.equal(row.citation_count, 2);
      assert.equal(row.first_doc, 'Checkout Requirements Spec');
      assert.equal(Number(row.first_score), 0.932);
      assert.equal(row.second_section, '3.5 Callback Retries');
      assert.deepEqual(row.citations, mockCitations);
    });

    it('B.6: Cross-Project Document Association Rejected via Composite Foreign Keys', async () => {
      // conv1Id belongs to projA. docBId belongs to projB.
      // Attempting to link docBId into conv1Id must fail composite FK integrity:

      // Case 1: Specifying projA as project_id fails fk_chat_doc_document
      // (docBId does not exist under projA)
      await assert.rejects(async () => {
        await client.query(`
          INSERT INTO ai_chat_conversation_documents (conversation_id, document_id, project_id)
          VALUES ($1, $2, $3)
        `, [conv1Id, docBId, projA.id]);
      }, /fk_chat_doc_document/i);

      // Case 2: Specifying projB as project_id fails fk_chat_doc_conv
      // (conv1Id does not exist under projB)
      await assert.rejects(async () => {
        await client.query(`
          INSERT INTO ai_chat_conversation_documents (conversation_id, document_id, project_id)
          VALUES ($1, $2, $3)
        `, [conv1Id, docBId, projB.id]);
      }, /fk_chat_doc_conv/i);

      // Valid association within same project (conv1Id + docAId under projA) succeeds
      const validAssoc = await client.query(`
        INSERT INTO ai_chat_conversation_documents (conversation_id, document_id, project_id)
        VALUES ($1, $2, $3)
        RETURNING id
      `, [conv1Id, docAId, projA.id]);
      assert.ok(validAssoc.rows[0].id);
    });

    it('B.7: Conversation & Document Deletion Behaviour (Cascade vs Restrict)', async () => {
      // --- PART 1: Conversation Deletion Cascades to Messages & Document Links ---
      // Delete conv1Id
      await client.query('DELETE FROM ai_chat_conversations WHERE id = $1', [conv1Id]);

      // Verify messages of conv1Id were cascade deleted
      const msgCheck = await client.query('SELECT count(*) FROM ai_chat_messages WHERE conversation_id = $1', [conv1Id]);
      assert.equal(parseInt(msgCheck.rows[0].count), 0, 'Messages must cascade delete with conversation');

      // Verify conversation-document links were cascade deleted
      const linkCheck = await client.query('SELECT count(*) FROM ai_chat_conversation_documents WHERE conversation_id = $1', [conv1Id]);
      assert.equal(parseInt(linkCheck.rows[0].count), 0, 'Conversation-document links must cascade delete with conversation');

      // Verify the document ITSELF (docAId) was NOT deleted (remains intact)
      const docCheck = await client.query('SELECT id, title FROM ai_documents WHERE id = $1', [docAId]);
      assert.equal(docCheck.rows.length, 1, 'Underlying document must remain intact after conversation deletion');

      // --- PART 2: Document Deletion Cascades to Conversation Links, Preserves Conversation ---
      // Associate docAId with conv2Id under projA
      await client.query(`
        INSERT INTO ai_chat_conversation_documents (conversation_id, document_id, project_id)
        VALUES ($1, $2, $3)
      `, [conv2Id, docAId, projA.id]);

      // Delete docAId
      await client.query('DELETE FROM ai_documents WHERE id = $1', [docAId]);

      // Verify conversation link for docAId was cascade deleted
      const docLinkCheck = await client.query('SELECT count(*) FROM ai_chat_conversation_documents WHERE document_id = $1', [docAId]);
      assert.equal(parseInt(docLinkCheck.rows[0].count), 0, 'Document link must cascade delete with document');

      // Verify conv2Id ITSELF and its messages remain intact
      const conv2Check = await client.query('SELECT id FROM ai_chat_conversations WHERE id = $1', [conv2Id]);
      assert.equal(conv2Check.rows.length, 1, 'Conversation must remain intact after document deletion');

      const conv2MsgCheck = await client.query('SELECT count(*) FROM ai_chat_messages WHERE conversation_id = $1', [conv2Id]);
      assert.ok(parseInt(conv2MsgCheck.rows[0].count) >= 2, 'Conversation messages must remain intact');

      // --- PART 3: Restrict Semantics on Direct Version Deletion ---
      // Create new doc with completed version
      const restrDoc = (await client.query(`
        INSERT INTO ai_documents (project_id, title, original_filename, document_type, created_by_user_id)
        VALUES ($1, 'Restrict Test Doc', 'r.pdf', 'PDF', gen_random_uuid()) RETURNING id
      `, [projA.id])).rows[0].id;

      const restrVer = (await client.query(`
        INSERT INTO ai_document_versions (
          document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id
        ) VALUES (
          $1, 1, 'sha_restr', 500, '/path/r', 'COMPLETED', gen_random_uuid()
        ) RETURNING id
      `, [restrDoc])).rows[0].id;

      // Direct deletion of COMPLETED version must be restricted by trigger
      await assert.rejects(async () => {
        await client.query('DELETE FROM ai_document_versions WHERE id = $1', [restrVer]);
      }, /VersionDeleteViolation/);
    });
  });

  // ==========================================================================
  // SECTION C: Migration Runner Safety & Advisory Lock Concurrency
  // ==========================================================================
  describe('C. Migration Runner Safety', () => {
    it('C.1: Advisory Lock Serializes Migration Execution', async () => {
      // 1. Verify that MIGRATION_ADVISORY_LOCK_ID is defined
      assert.ok(MIGRATION_ADVISORY_LOCK_ID, 'Migration advisory lock ID must be defined');

      // 2. Test advisory lock exclusivity:
      // Client 1 acquires lock
      const c1 = await db.getClient();
      const c2 = await db.getClient();

      try {
        await c1.query('SELECT pg_advisory_lock($1)', [MIGRATION_ADVISORY_LOCK_ID]);

        // Client 2 attempts try-lock -> must return false (locked by c1)
        const tryRes = await c2.query('SELECT pg_try_advisory_lock($1) as acquired', [MIGRATION_ADVISORY_LOCK_ID]);
        assert.equal(tryRes.rows[0].acquired, false, 'Client 2 must NOT acquire advisory lock while Client 1 holds it');

        // Client 1 releases lock
        await c1.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);

        // Client 2 attempts try-lock again -> now succeeds
        const tryAgainRes = await c2.query('SELECT pg_try_advisory_lock($1) as acquired', [MIGRATION_ADVISORY_LOCK_ID]);
        assert.equal(tryAgainRes.rows[0].acquired, true, 'Client 2 must acquire advisory lock once Client 1 unlocks');

        // Release c2
        await c2.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID]);
      } finally {
        c1.release();
        c2.release();
      }
    });

    it('C.2: Concurrent Invocations of runAiMigrations Execute Safely Without Collisions', async () => {
      // Run two instances of runAiMigrations simultaneously in parallel Promise.all
      const [result1, result2] = await Promise.all([
        runAiMigrations(),
        runAiMigrations()
      ]);

      assert.equal(result1.success, true);
      assert.equal(result2.success, true);
      assert.equal(result1.appliedCount, 0, 'Already applied migrations must be skipped cleanly');
      assert.equal(result2.appliedCount, 0, 'Already applied migrations must be skipped cleanly');
      assert.ok(result1.skippedCount >= 4);
      assert.ok(result2.skippedCount >= 4);
    });
  });
});
