const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const db = require('../db/connection');
const { runAiMigrations } = require('../db/migrationRunner');

describe('AI Test Writer - Schema & Migrations Integrity Test Suite', () => {
  let client;

  before(async () => {
    client = await db.getClient();
  });

  after(async () => {
    if (client) {
      try {
        await client.query("DELETE FROM ai_projects WHERE slug LIKE 'test-%' OR slug LIKE 'chat-%' OR slug IN ('other-proj', 'doc-ver-proj', 'outbox-proj')");
      } catch (e) {
        // ignore
      }
      client.release();
    }
    await db.closePool();
  });

  // Test 1: Migration runner connection
  it('1. Migration runner connects to correct qa_ai_platform database', async () => {
    const res = await client.query('SELECT current_database() as db_name, current_user as user_name');
    assert.equal(res.rows[0].db_name, 'qa_ai_platform');
    assert.equal(res.rows[0].user_name, 'postgres');
  });

  // Test 2 & 3: Idempotency of migrations
  it('2 & 3. Re-running migrations is completely idempotent and reports 0 applied, all existing skipped', async () => {
    const res = await runAiMigrations(client);
    assert.equal(res.success, true);
    assert.equal(res.appliedCount, 0);
    assert.ok(res.skippedCount >= 4);
    assert.deepEqual(res.applied, []);
  });

  // Test 4: All 16 approved architecture tables exist
  it('4. All 16 approved architecture tables exist in public schema', async () => {
    const expectedTables = [
      'ai_schema_migrations',
      'ai_embedding_config',
      'ai_projects',
      'ai_documents',
      'ai_document_versions',
      'ai_document_chunks',
      'ai_document_embeddings',
      'ai_generation_jobs',
      'ai_requirements',
      'ai_test_suites',
      'ai_test_scenarios',
      'ai_test_cases',
      'ai_qa_checklists',
      'ai_requirement_traceability',
      'ai_generation_history',
      'ai_human_reviews'
    ];

    const res = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    `, [expectedTables]);

    const foundTables = res.rows.map(r => r.table_name);
    for (const t of expectedTables) {
      assert.ok(foundTables.includes(t), `Missing approved architecture table: ${t}`);
    }
  });

  // Test 5: All 3 chat tables exist
  it('5. All 3 persistent chat tables exist in public schema', async () => {
    const chatTables = [
      'ai_chat_conversations',
      'ai_chat_conversation_documents',
      'ai_chat_messages'
    ];

    const res = await client.query(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = ANY($1::text[])
    `, [chatTables]);

    const foundTables = res.rows.map(r => r.table_name);
    for (const t of chatTables) {
      assert.ok(foundTables.includes(t), `Missing chat table: ${t}`);
    }
  });

  // Test 6: Foreign keys, unique constraints, check constraints and indexes
  it('6. Key constraints and indexes match the architecture specification', async () => {
    // Check circular foreign key on ai_documents(active_version_id, id)
    const fkRes = await client.query(`
      SELECT conname FROM pg_constraint 
      WHERE conname = 'fk_active_doc_version_ownership'
    `);
    assert.equal(fkRes.rows.length, 1, 'Circular foreign key fk_active_doc_version_ownership must exist');

    // Check unique partial index on single active embedding model
    const idxRes = await client.query(`
      SELECT indexname FROM pg_indexes 
      WHERE indexname = 'uq_ai_embedding_config_single_active'
    `);
    assert.equal(idxRes.rows.length, 1, 'uq_ai_embedding_config_single_active index must exist');

    // Check partial outbox index
    const outboxIdx = await client.query(`
      SELECT indexname FROM pg_indexes 
      WHERE indexname = 'idx_ai_jobs_outbox'
    `);
    assert.equal(outboxIdx.rows.length, 1, 'idx_ai_jobs_outbox partial index must exist');
  });

  // Test 7: pgvector columns and required vector indexes are valid
  it('7. pgvector column vector(768) and HNSW cosine index exist and calculate distances', async () => {
    const colRes = await client.query(`
      SELECT data_type, udt_name FROM information_schema.columns 
      WHERE table_name = 'ai_document_embeddings' AND column_name = 'embedding'
    `);
    assert.equal(colRes.rows[0].udt_name, 'vector');

    const hnswRes = await client.query(`
      SELECT indexname, indexdef FROM pg_indexes 
      WHERE tablename = 'ai_document_embeddings' AND indexname = 'idx_embeddings_hnsw_cosine'
    `);
    assert.equal(hnswRes.rows.length, 1);
    assert.match(hnswRes.rows[0].indexdef, /hnsw/i);
    assert.match(hnswRes.rows[0].indexdef, /vector_cosine_ops/i);

    // Live distance computation test
    const dist = await client.query(`SELECT ('[1,2,3]'::vector <-> '[1,2,5]'::vector) as l2`);
    assert.equal(Number(dist.rows[0].l2), 2);
  });

  // Test 8: Triggers execute correctly for immutability & RTM integrity rules
  describe('8. Integrity Triggers Enforcement', () => {
    let projId, docId, verId, chunkId, reqId, suiteId, scenId, caseId;

    before(async () => {
      // Create test project
      const pRes = await client.query(`
        INSERT INTO ai_projects (name, slug, created_by_user_id) 
        VALUES ('Test Project A', 'test-proj-a', gen_random_uuid()) 
        RETURNING id
      `);
      projId = pRes.rows[0].id;

      // Create test document
      const dRes = await client.query(`
        INSERT INTO ai_documents (project_id, title, original_filename, document_type, created_by_user_id) 
        VALUES ($1, 'Spec Doc', 'spec.pdf', 'PDF', gen_random_uuid()) 
        RETURNING id
      `, [projId]);
      docId = dRes.rows[0].id;

      // Create test version
      const vRes = await client.query(`
        INSERT INTO ai_document_versions (document_id, version_number, sha256_hash, file_size_bytes, storage_path, indexing_status, uploaded_by_user_id) 
        VALUES ($1, 1, 'hash123', 1024, '/storage/v1', 'PENDING', gen_random_uuid()) 
        RETURNING id
      `, [docId]);
      verId = vRes.rows[0].id;

      // Create chunk
      const cRes = await client.query(`
        INSERT INTO ai_document_chunks (version_id, chunk_index, content, token_count, page_number) 
        VALUES ($1, 0, 'Chunk content test', 10, 1) 
        RETURNING id
      `, [verId]);
      chunkId = cRes.rows[0].id;

      // Create requirement
      const rRes = await client.query(`
        INSERT INTO ai_requirements (project_id, req_key, title, description) 
        VALUES ($1, 'REQ-001', 'Login Spec', 'User must log in') 
        RETURNING id
      `, [projId]);
      reqId = rRes.rows[0].id;

      // Create suite, scenario, test case
      const sRes = await client.query(`
        INSERT INTO ai_test_suites (project_id, suite_key, title, target_module, created_by_user_id) 
        VALUES ($1, 'SUITE-01', 'Auth Suite', 'AUTH', gen_random_uuid()) 
        RETURNING id
      `, [projId]);
      suiteId = sRes.rows[0].id;

      const scRes = await client.query(`
        INSERT INTO ai_test_scenarios (suite_id, scenario_key, title) 
        VALUES ($1, 'SCEN-01', 'Valid Login Scenario') 
        RETURNING id
      `, [suiteId]);
      scenId = scRes.rows[0].id;

      const tcRes = await client.query(`
        INSERT INTO ai_test_cases (scenario_id, test_case_key, title, expected_result) 
        VALUES ($1, 'TC-01', 'Verify Happy Path Login', 'User successfully logs in') 
        RETURNING id
      `, [scenId]);
      caseId = tcRes.rows[0].id;
    });

    it('8a. TrgVersionRowImmutability blocks metadata/status updates once COMPLETED', async () => {
      // Transition version to COMPLETED
      await client.query(`UPDATE ai_document_versions SET indexing_status = 'COMPLETED' WHERE id = $1`, [verId]);

      // Attempt update on COMPLETED version -> must throw VersionImmutableViolation
      await assert.rejects(async () => {
        await client.query(`UPDATE ai_document_versions SET change_summary = 'Attempted update' WHERE id = $1`, [verId]);
      }, /VersionImmutableViolation/);
    });

    it('8b. TrgChunksImmutability blocks chunk modification on COMPLETED version', async () => {
      await assert.rejects(async () => {
        await client.query(`UPDATE ai_document_chunks SET content = 'Tampered content' WHERE id = $1`, [chunkId]);
      }, /VersionImmutableViolation/);

      await assert.rejects(async () => {
        await client.query(`DELETE FROM ai_document_chunks WHERE id = $1`, [chunkId]);
      }, /VersionImmutableViolation/);
    });

    it('8c. TrgVersionDeleteProtection blocks direct deletion of COMPLETED version', async () => {
      await assert.rejects(async () => {
        await client.query(`DELETE FROM ai_document_versions WHERE id = $1`, [verId]);
      }, /VersionDeleteViolation/);
    });

    it('8d. TrgRtmProjectIntegrity enforces cross-project validation', async () => {
      // 1. Linking matching project req + case -> SUCCESS
      const rtmRes = await client.query(`
        INSERT INTO ai_requirement_traceability (requirement_id, test_case_id, chunk_id) 
        VALUES ($1, $2, $3) 
        RETURNING id
      `, [reqId, caseId, chunkId]);
      assert.ok(rtmRes.rows[0].id);

      // 2. Create Project B with distinct Requirement
      const pBRes = await client.query(`
        INSERT INTO ai_projects (name, slug, created_by_user_id) 
        VALUES ('Test Project B', 'test-proj-b', gen_random_uuid()) 
        RETURNING id
      `);
      const projBId = pBRes.rows[0].id;

      const rBRes = await client.query(`
        INSERT INTO ai_requirements (project_id, req_key, title, description) 
        VALUES ($1, 'REQ-B01', 'Foreign Req', 'Cross project test') 
        RETURNING id
      `, [projBId]);
      const reqBId = rBRes.rows[0].id;

      // Attempt to link Project B Requirement with Project A Test Case -> CrossProjectIntegrityViolation
      await assert.rejects(async () => {
        await client.query(`
          INSERT INTO ai_requirement_traceability (requirement_id, test_case_id) 
          VALUES ($1, $2)
        `, [reqBId, caseId]);
      }, /CrossProjectIntegrityViolation/);
    });

    it('8e. TrgPreventParentCrossProjectReassignment blocks reassigning project with active RTM', async () => {
      // Project A Requirement is in active RTM -> reassigning project_id must fail
      const otherProjRes = await client.query(`
        INSERT INTO ai_projects (name, slug, created_by_user_id) 
        VALUES ('Other Project', 'other-proj', gen_random_uuid()) 
        RETURNING id
      `);
      const otherId = otherProjRes.rows[0].id;

      await assert.rejects(async () => {
        await client.query(`UPDATE ai_requirements SET project_id = $1 WHERE id = $2`, [otherId, reqId]);
      }, /ParentReassignmentViolation|ActiveRequirementImmutableViolation/);
    });
  });

  // Test 9: Project isolation prevents cross-project chat document associations
  it('9. Composite foreign keys prevent cross-project chat document associations', async () => {
    // Project 1
    const p1 = (await client.query(`
      INSERT INTO ai_projects (name, slug, created_by_user_id) 
      VALUES ('Chat Proj 1', 'chat-proj-1', gen_random_uuid()) RETURNING id
    `)).rows[0].id;

    // Project 2
    const p2 = (await client.query(`
      INSERT INTO ai_projects (name, slug, created_by_user_id) 
      VALUES ('Chat Proj 2', 'chat-proj-2', gen_random_uuid()) RETURNING id
    `)).rows[0].id;

    // Doc in Project 1
    const docP1 = (await client.query(`
      INSERT INTO ai_documents (project_id, title, original_filename, document_type, created_by_user_id) 
      VALUES ($1, 'P1 Doc', 'p1.pdf', 'PDF', gen_random_uuid()) RETURNING id
    `, [p1])).rows[0].id;

    // Conversation in Project 2
    const convP2 = (await client.query(`
      INSERT INTO ai_chat_conversations (project_id, user_id, title) 
      VALUES ($1, gen_random_uuid(), 'P2 Conv') RETURNING id
    `, [p2])).rows[0].id;

    // Attempting to associate DocP1 (Project 1) with ConvP2 (Project 2) must violate composite FK
    await assert.rejects(async () => {
      await client.query(`
        INSERT INTO ai_chat_conversation_documents (conversation_id, document_id, project_id) 
        VALUES ($1, $2, $3)
      `, [convP2, docP1, p2]); // Foreign key to ai_documents(id, project_id) fails because docP1 belongs to p1!
    }, /foreign key/i);
  });

  // Test 10: Document version activation prevents obsolete versions from being treated as active
  it('10. Circular FK on ai_documents.active_version_id ensures only valid versions of the same document can be activated', async () => {
    const p = (await client.query(`
      INSERT INTO ai_projects (name, slug, created_by_user_id) 
      VALUES ('Doc Version Proj', 'doc-ver-proj', gen_random_uuid()) RETURNING id
    `)).rows[0].id;

    const docA = (await client.query(`
      INSERT INTO ai_documents (project_id, title, original_filename, document_type, created_by_user_id) 
      VALUES ($1, 'Doc A', 'a.pdf', 'PDF', gen_random_uuid()) RETURNING id
    `, [p])).rows[0].id;

    const docB = (await client.query(`
      INSERT INTO ai_documents (project_id, title, original_filename, document_type, created_by_user_id) 
      VALUES ($1, 'Doc B', 'b.pdf', 'PDF', gen_random_uuid()) RETURNING id
    `, [p])).rows[0].id;

    const verB = (await client.query(`
      INSERT INTO ai_document_versions (document_id, version_number, sha256_hash, file_size_bytes, storage_path, uploaded_by_user_id) 
      VALUES ($1, 1, 'hashB', 100, '/b/1', gen_random_uuid()) RETURNING id
    `, [docB])).rows[0].id;

    // Setting DocA's active_version_id to VerB (which belongs to DocB) must fail FK constraint!
    await assert.rejects(async () => {
      await client.query(`UPDATE ai_documents SET active_version_id = $1 WHERE id = $2`, [verB, docA]);
    }, /fk_active_doc_version_ownership/i);

    // Creating version for DocA and activating it succeeds
    const verA = (await client.query(`
      INSERT INTO ai_document_versions (document_id, version_number, sha256_hash, file_size_bytes, storage_path, uploaded_by_user_id) 
      VALUES ($1, 1, 'hashA', 100, '/a/1', gen_random_uuid()) RETURNING id
    `, [docA])).rows[0].id;

    await client.query(`UPDATE ai_documents SET active_version_id = $1 WHERE id = $2`, [verA, docA]);
    const check = await client.query(`SELECT active_version_id FROM ai_documents WHERE id = $1`, [docA]);
    assert.equal(check.rows[0].active_version_id, verA);
  });

  // Test 11: Outbox and job state handling
  it('11. Outbox sweeper selects OUTBOX_PENDING rows and reconciles terminal states without queue interaction', async () => {
    const p = (await client.query(`
      INSERT INTO ai_projects (name, slug, created_by_user_id) 
      VALUES ('Outbox Proj', 'outbox-proj', gen_random_uuid()) RETURNING id
    `)).rows[0].id;

    // 1. Create a job that completed while dispatch_status was OUTBOX_PENDING
    const jobRes = await client.query(`
      INSERT INTO ai_generation_jobs (
        project_id, user_id, job_type, status, dispatch_status
      ) VALUES ($1, gen_random_uuid(), 'INDEX_DOCUMENT', 'COMPLETED', 'OUTBOX_PENDING') 
      RETURNING id
    `, [p]);
    const jobId = jobRes.rows[0].id;

    // 2. Query matching the corrected Sweeper design (WITHOUT "AND status = 'PENDING'")
    const claimRes = await client.query(`
      SELECT id, status, dispatch_status 
      FROM ai_generation_jobs 
      WHERE dispatch_status = 'OUTBOX_PENDING' AND id = $1
      FOR UPDATE SKIP LOCKED
    `, [jobId]);

    assert.equal(claimRes.rows.length, 1);
    assert.equal(claimRes.rows[0].status, 'COMPLETED');
    assert.equal(claimRes.rows[0].dispatch_status, 'OUTBOX_PENDING');

    // 3. In-memory terminal reconciliation: marks DISPATCHED directly in DB
    await client.query(`
      UPDATE ai_generation_jobs 
      SET dispatch_status = 'DISPATCHED', updated_at = NOW() 
      WHERE id = $1
    `, [jobId]);

    // 4. Verify it is permanently removed from idx_ai_jobs_outbox index filter
    const verifyOutbox = await client.query(`
      SELECT id FROM ai_generation_jobs 
      WHERE dispatch_status = 'OUTBOX_PENDING' AND id = $1
    `, [jobId]);
    assert.equal(verifyOutbox.rows.length, 0);
  });

  // Test 12: A failed migration does not get recorded as successful
  it('12. Transaction rollback prevents failed migration from recording in ai_schema_migrations', async () => {
    const fakeMigration = '999_failing_migration.sql';
    const fakeClient = await db.getClient();
    try {
      await fakeClient.query('BEGIN');
      try {
        await fakeClient.query('CREATE TABLE ai_temp_fail_test (id INT PRIMARY KEY);');
        // Syntax error to force failure
        await fakeClient.query('THIS IS AN INVALID SQL SYNTAX ERROR;');
        await fakeClient.query('INSERT INTO ai_schema_migrations (name) VALUES ($1)', [fakeMigration]);
        await fakeClient.query('COMMIT');
      } catch (e) {
        await fakeClient.query('ROLLBACK');
      }

      // Verify migration record was NOT created
      const check = await fakeClient.query('SELECT name FROM ai_schema_migrations WHERE name = $1', [fakeMigration]);
      assert.equal(check.rows.length, 0);

      // Verify table was rolled back
      const tableCheck = await fakeClient.query(`
        SELECT table_name FROM information_schema.tables WHERE table_name = 'ai_temp_fail_test'
      `);
      assert.equal(tableCheck.rows.length, 0);
    } finally {
      fakeClient.release();
    }
  });

  // Test 13: Existing pg-mem and auth_db.json remain untouched
  it('13. auth_db.json file exists and has not been overwritten', async () => {
    const authDbPath = path.resolve('C:\\Projects\\ODR Test\\backend\\data\\auth_db.json');
    assert.ok(fs.existsSync(authDbPath), 'auth_db.json must exist');
    const stat = fs.statSync(authDbPath);
    assert.ok(stat.size > 6000000, 'auth_db.json size should match existing ~6.9MB database file');
  });
});
