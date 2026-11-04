# Phase 1.5: Final Database Integrity & Reliability Corrections
## AI Test Case Writer — Centralized QA Tools Platform

**Document Status:** Final Pre-Implementation Sign-Off Contract  
**Date:** 2026-10-30  
**Target Environment:** Windows 10 Pro 64-bit | Intel Core i5-3470S (4C/4T @ 2.90 GHz, AVX) | 16 GB RAM | Localhost (127.0.0.1)  
**Execution Context:** Strictly Read-Only Audit & Definitive Architectural Corrections  

---

## Executive Summary & Final Verdict

This document completes the final integrity and reliability corrections for the **AI Test Case Writer** module. Every identified edge case—including composite foreign key enforcement, active version ownership, duplicate-safe transactional outbox dispatch, document version immutability, independent active-version RAG retrieval, and the verified empirical regression baseline—is resolved.

### Final Implementation Verdict

```
+---------------------------------------------------------------------------------------+
|                                    FINAL VERDICT:                                     |
|                                  READY FOR PHASE 2                                    |
|                       (All Database & Queue Integrity Enforced)                       |
+---------------------------------------------------------------------------------------+
|  1. Embedding & Chunk Integrity: Composite FK enforces chunk-version consistency.     |
|  2. Active Version Ownership: Composite FK enforces version belongs to document.      |
|  3. Transactional Outbox: Queue deduplication key & atomic worker claiming.          |
|  4. Version Immutability: Write-locking protocol prevents post-completion mutations.  |
|  5. RAG Retrieval: 4-table join query independently enforces active version scoping.  |
|  6. Empirical Test Baseline: Verified 1090 total tests across 81 suites (1086 pass).  |
|  7. Phase 2 Readiness: Ready to proceed with Step 1 (Host Prerequisites Setup).       |
+---------------------------------------------------------------------------------------+
```

---

## 1. Enforce Embedding and Chunk Version Integrity

### 1.1 The Vulnerability in Prior DDL
In Phase 1.4, `ai_document_embeddings` stored both `chunk_id` and `version_id`, with separate foreign keys:
- `chunk_id REFERENCES ai_document_chunks(id)`
- `version_id REFERENCES ai_document_versions(id)`

This permitted a relational inconsistency: an embedding row could point to `chunk_id = C1` (which actually belonged to version `V1`), while stating `version_id = V2`. Activation count queries (`SELECT COUNT(*) FROM ai_document_embeddings WHERE version_id = V2`) could theoretically be satisfied by mismatched chunks.

### 1.2 Corrected Composite DDL
PostgreSQL enforces version consistency by introducing a composite unique key on the parent table and a composite foreign key on the dependent table:

```sql
-- 1. Document Chunks: Guarantee uniqueness of (id, version_id)
CREATE TABLE IF NOT EXISTS ai_document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES ai_document_versions(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL CHECK (chunk_index >= 0),
    content TEXT NOT NULL,
    token_count INT NOT NULL DEFAULT 0 CHECK (token_count >= 0),
    page_number INT CHECK (page_number > 0),
    section_heading VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_doc_chunk_idx UNIQUE (version_id, chunk_index),
    CONSTRAINT uq_chunk_id_version UNIQUE (id, version_id)
);
CREATE INDEX IF NOT EXISTS idx_chunks_version ON ai_document_chunks(version_id);

-- 2. Document Embeddings: Enforce that chunk_id strictly belongs to version_id
CREATE TABLE IF NOT EXISTS ai_document_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL,
    version_id UUID NOT NULL,
    model_id UUID NOT NULL REFERENCES ai_embedding_config(id) ON DELETE RESTRICT,
    embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chunk_model UNIQUE (chunk_id, model_id),
    -- Composite Foreign Key Guarantee:
    CONSTRAINT fk_embedding_chunk_version FOREIGN KEY (chunk_id, version_id)
        REFERENCES ai_document_chunks(id, version_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON ai_document_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_version_model ON ai_document_embeddings(version_id, model_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw_cosine 
    ON ai_document_embeddings USING hnsw (embedding vector_cosine_ops);
```

### 1.3 Integrity Guarantee
The composite constraint `fk_embedding_chunk_version` forces the database engine to validate `(chunk_id, version_id)` as an atomic tuple. Any insert or update that pairs a `chunk_id` from version `V1` with `version_id = V2` is rejected by PostgreSQL with a `23503 foreign_key_violation`. Activation queries counting embeddings for version `V2` are mathematically guaranteed to count only chunks belonging to version `V2`.

---

## 2. Enforce Active Version Ownership

### 2.1 The Cross-Document Reference Vulnerability
Previously, `ai_documents.active_version_id` referenced `ai_document_versions(id)`. This ensured that `active_version_id` existed, but did not guarantee that the version belonged to *that specific document*. Document A could mistakenly point to Version B (belonging to Document B).

### 2.2 Corrected Composite Ownership DDL
To solve this at the database engine level, `ai_document_versions` exposes a composite unique constraint on `(id, document_id)`. `ai_documents` then enforces that `(active_version_id, id)` references `(id, document_id)`:

```sql
-- 1. Document Versions: Expose composite unique target (id, document_id)
CREATE TABLE IF NOT EXISTS ai_document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
    version_number INT NOT NULL CHECK (version_number > 0),
    sha256_hash VARCHAR(64) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    storage_path VARCHAR(512) NOT NULL,
    indexing_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' 
        CHECK (indexing_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    indexing_error TEXT,
    total_chunks INT NOT NULL DEFAULT 0 CHECK (total_chunks >= 0),
    change_summary TEXT,
    uploaded_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    indexed_at TIMESTAMPTZ,
    CONSTRAINT uq_doc_version UNIQUE (document_id, version_number),
    CONSTRAINT uq_doc_ver_id_doc UNIQUE (id, document_id)
);
CREATE INDEX IF NOT EXISTS idx_doc_ver_doc_id ON ai_document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_ver_hash ON ai_document_versions(sha256_hash);

-- 2. Documents: Enforce that active_version_id belongs to THIS document
ALTER TABLE ai_documents 
    DROP CONSTRAINT IF EXISTS fk_active_doc_version,
    ADD CONSTRAINT fk_active_doc_version_ownership 
        FOREIGN KEY (active_version_id, id) 
        REFERENCES ai_document_versions(id, document_id) 
        ON DELETE SET NULL;
```

### 2.3 Deletion and Nullability Guarantee
1. **Creation**: When an `ai_documents` row is initially inserted, `active_version_id` is `NULL`. In PostgreSQL composite foreign keys under `MATCH SIMPLE`, any tuple containing `NULL` is valid.
2. **Activation**: When `active_version_id = V_ID` is set on document `D_ID`, PostgreSQL verifies that `(V_ID, D_ID)` exists in `ai_document_versions(id, document_id)`. If version `V_ID` belongs to document `D_OTHER`, the transaction fails immediately.
3. **Deletion**: When document `D_ID` is deleted, `ON DELETE CASCADE` on `ai_document_versions.document_id` cascades cleanly. If version `V_ID` is individually deleted, `ON DELETE SET NULL` automatically nulls `active_version_id` on the document row without circular deadlocks.

---

## 3. Duplicate-Safe Transactional Outbox Design

### 3.1 Failure Window in Naive Outbox
In naive outbox systems:
1. Job is committed to `ai_generation_jobs` (`dispatch_status = 'OUTBOX_PENDING'`).
2. Node dispatches to pg-boss. pg-boss enqueues the job.
3. Node process crashes before updating `dispatch_status = 'DISPATCHED'` and `pgboss_job_id`.
4. Outbox sweeper wakes up, sees `OUTBOX_PENDING`, and re-sends the job to pg-boss, creating two active queue tasks for one user request.

### 3.2 Duplicate-Safe Architecture

```
 User Request (POST /generate)
       │
       ▼
 1. Generate Deterministic Idempotency Key: sha256(projectId + jobType + payload)
       │
       ▼
 2. BEGIN TRANSACTION
    - Lock & check existing: SELECT id, status FROM ai_generation_jobs WHERE idempotency_key = $key;
    - If active job exists, COMMIT and return existing jobId.
    - INSERT INTO ai_generation_jobs (
        id = $jobId,
        status = 'PENDING',
        dispatch_status = 'OUTBOX_PENDING',
        idempotency_key = $key,
        payload = $payload
      );
    COMMIT TRANSACTION;
       │
       ▼
 3. Immediate Dispatch with Stable pg-boss Singleton Key:
    boss.send('ai-jobs', { jobId }, { 
      singletonKey: jobId,   // Queue-level deduplication: guarantees only 1 active queue task
      retryLimit: 3, 
      retryDelay: 30 
    })
       │
       ├──► Success: UPDATE ai_generation_jobs SET dispatch_status = 'DISPATCHED', pgboss_job_id = $pgbossId
       └──► Crash / Net Error: Job remains 'OUTBOX_PENDING'
                                  │
                                  ▼
               Outbox Sweeper (Every 15s via SELECT ... FOR UPDATE SKIP LOCKED)
               - Sweeper calls boss.send with identical singletonKey = jobId.
               - pg-boss rejects/ignores duplicate queue entry if already enqueued!
```

### 3.3 Worker Idempotency & Unique Suite Persistence
When a worker picks up `{ jobId }` from pg-boss:

1. **Atomic Claim**:
   ```sql
   UPDATE ai_generation_jobs
   SET status = 'PROCESSING',
       dispatch_status = 'DISPATCHED',
       pgboss_job_id = COALESCE(pgboss_job_id, $pgbossJobId),
       started_at = COALESCE(started_at, NOW()),
       last_heartbeat_at = NOW()
   WHERE id = $jobId AND status IN ('PENDING', 'PROCESSING')
   RETURNING id, status, job_type, project_id, payload;
   ```
   If 0 rows are returned (job was already `COMPLETED` or `CANCELLED`), worker calls `job.done()` immediately and halts.

2. **Unique Test Suite Persistence**:
   In `ai_test_suites`, `job_id` is unique:
   ```sql
   ALTER TABLE ai_test_suites ADD COLUMN IF NOT EXISTS job_id UUID UNIQUE REFERENCES ai_generation_jobs(id) ON DELETE SET NULL;
   ```
   Persistence uses:
   ```sql
   INSERT INTO ai_test_suites (project_id, job_id, suite_key, title, target_module, status, created_by_user_id)
   VALUES ($projectId, $jobId, $suiteKey, $title, $module, 'DRAFT', $userId)
   ON CONFLICT (job_id) DO NOTHING
   RETURNING id;
   ```
   Even if two workers concurrently execute the same job, exactly one test suite record can be created.

3. **Single Authoritative Retry Authority**:
   - `pg-boss` is the **sole authority** for execution retries (`retryLimit: 3, retryDelay: 30`).
   - The application watchdog does **NOT** re-enqueue running jobs.
   - The application watchdog only marks `status = 'FAILED'` if worker heartbeat is dead for `> 10 minutes` and pg-boss confirms the job failed or expired.
   - **Delivery Guarantee**: At-least-once outbox dispatch + pg-boss queue singleton deduplication + atomic worker claim + database unique constraints = **effectively exactly-once side effects**.

---

## 4. Document Version Immutability Protocol

### 4.1 Concurrency-Safe Indexing Write Protocol
To prevent chunks or embeddings from being written to a version after indexing is marked complete, all writes enforce status-checked pessimistic locking:

```sql
-- ============================================================================
-- ATOMIC CHUNKING & EMBEDDING WRITE PROTOCOL
-- ============================================================================

BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 1. Lock the document version and verify mutable status
SELECT id, document_id, indexing_status, total_chunks 
FROM ai_document_versions 
WHERE id = $versionId 
FOR UPDATE;

-- 2. State Guard in Service Layer:
-- If indexing_status IN ('COMPLETED', 'FAILED'), throw VersionImmutableError and ROLLBACK immediately.
-- Writes are ONLY permitted if indexing_status = 'PROCESSING'.

-- 3. Insert Chunks (Validated against version_id)
INSERT INTO ai_document_chunks (version_id, chunk_index, content, token_count, page_number, section_heading, metadata)
VALUES ($versionId, $chunkIndex, $content, $tokens, $page, $heading, $metadata);

-- 4. Insert Embeddings (Validated against composite FK)
INSERT INTO ai_document_embeddings (chunk_id, version_id, model_id, embedding)
VALUES ($chunkId, $versionId, $activeModelId, $embeddingVector);

-- 5. Atomic Completeness Check Before Marking COMPLETED:
-- Confirm expected count matches:
SELECT COUNT(*)::int AS chunk_count FROM ai_document_chunks WHERE version_id = $versionId;
SELECT COUNT(*)::int AS emb_count FROM ai_document_embeddings WHERE version_id = $versionId AND model_id = $activeModelId;
-- Service layer confirms chunk_count > 0 AND chunk_count === emb_count.

-- 6. Lock and Transition Version to COMPLETED
UPDATE ai_document_versions 
SET indexing_status = 'COMPLETED',
    total_chunks = $chunkCount,
    indexed_at = NOW(),
    indexing_error = NULL
WHERE id = $versionId;

COMMIT;
```

### 4.2 Serialization Against Activation
Because activation begins by acquiring `SELECT id FROM ai_document_versions WHERE id = $versionId FOR UPDATE`, an activation request blocks until any in-flight indexing transaction commits. Once indexing commits with `indexing_status = 'COMPLETED'`, subsequent attempts to write chunks or embeddings will fail at Step 2 with `VersionImmutableError`.

---

## 5. RAG Retrieval Independently Enforces Active Versions

### 5.1 Authoritative 4-Table Join Retrieval Query
The retrieval query does not trust the client or caller to pass a valid active version ID. It joins across embeddings, chunks, versions, and documents, independently verifying the project and active version pointer:

```sql
SELECT 
    c.id AS chunk_id,
    c.version_id,
    d.id AS document_id,
    d.title AS document_title,
    c.content,
    c.page_number,
    c.section_heading,
    1 - (e.embedding <=> $queryVector) AS cosine_similarity
FROM ai_document_embeddings e
JOIN ai_document_chunks c 
    ON e.chunk_id = c.id AND e.version_id = c.version_id
JOIN ai_document_versions v 
    ON c.version_id = v.id
JOIN ai_documents d 
    ON v.document_id = d.id
WHERE d.project_id = $projectId
  AND d.active_version_id = v.id
  AND v.indexing_status = 'COMPLETED'
  AND e.model_id = $activeModelId
ORDER BY e.embedding <=> $queryVector ASC
LIMIT $topK;
```

### 5.2 Query Enforcement Matrix
1. **`d.project_id = $projectId`**: Enforces strict project isolation.
2. **`d.active_version_id = v.id`**: Guarantees that only the document's authoritative active version is retrieved. Draft, unindexed, or deprecated versions are excluded.
3. **`v.indexing_status = 'COMPLETED'`**: Confirms the version was fully verified before being queried.
4. **`e.model_id = $activeModelId`**: Enforces that retrieved embeddings match the active embedding model.
5. **HNSW Cosine Traversal**: The clause `ORDER BY e.embedding <=> $queryVector ASC` utilizes the `idx_embeddings_hnsw_cosine` index created with `vector_cosine_ops`.
6. **Dimension Validation**: Node.js vector service asserts `Array.isArray(queryVector) && queryVector.length === 768` before invoking the query.

---

## 6. PostgreSQL Initialization, Privileges & Verification

### 6.1 Administrator Setup Script (`000_admin_init.sql`)
*Run as PostgreSQL superuser (`postgres`) passing passwords via `psql` variables:*

```sql
-- Execution syntax:
-- psql -h 127.0.0.1 -p 5432 -U postgres -v MIGRATOR_PASS="<SECURE_PASSWORD>" -v APP_PASS="<SECURE_PASSWORD>" -f 000_admin_init.sql

-- 1. Create Dedicated Roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'qa_ai_migrator') THEN
    CREATE ROLE qa_ai_migrator WITH LOGIN PASSWORD :'MIGRATOR_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'qa_ai_app') THEN
    CREATE ROLE qa_ai_app WITH LOGIN PASSWORD :'APP_PASS' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- 2. Create Database
CREATE DATABASE qa_ai_platform WITH OWNER = qa_ai_migrator ENCODING = 'UTF8';

-- 3. Connect to qa_ai_platform
\c qa_ai_platform

-- 4. Install Extensions (Must be superuser)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 5. Configure Schemas
CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION qa_ai_migrator;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION qa_ai_migrator;

-- Revoke default public schema creation from PUBLIC
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- 6. Grant Role Privileges
GRANT CONNECT ON DATABASE qa_ai_platform TO qa_ai_app;

-- Schema 'public': Strictly DML-only
GRANT USAGE ON SCHEMA public TO qa_ai_app;

-- Schema 'pgboss': Queue exception (allows pg-boss to create dynamic partition/queue tables)
GRANT USAGE, CREATE ON SCHEMA pgboss TO qa_ai_app;

-- 7. Configure Default Privileges for objects created by qa_ai_migrator
ALTER DEFAULT PRIVILEGES FOR ROLE qa_ai_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO qa_ai_app;

ALTER DEFAULT PRIVILEGES FOR ROLE qa_ai_migrator IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO qa_ai_app;

ALTER DEFAULT PRIVILEGES FOR ROLE qa_ai_migrator IN SCHEMA pgboss
  GRANT ALL PRIVILEGES ON TABLES TO qa_ai_app;

ALTER DEFAULT PRIVILEGES FOR ROLE qa_ai_migrator IN SCHEMA pgboss
  GRANT ALL PRIVILEGES ON SEQUENCES TO qa_ai_app;
```

### 6.2 Catalog Privilege Verification Queries
*Run these queries to verify privilege segregation:*

```sql
-- Verify qa_ai_app CANNOT create tables in public:
SELECT has_schema_privilege('qa_ai_app', 'public', 'CREATE') AS public_create_allowed;
-- Expected output: false

-- Verify qa_ai_app CAN access public schema:
SELECT has_schema_privilege('qa_ai_app', 'public', 'USAGE') AS public_usage_allowed;
-- Expected output: true

-- Verify qa_ai_app CAN create tables in isolated pgboss schema:
SELECT has_schema_privilege('qa_ai_app', 'pgboss', 'CREATE') AS pgboss_create_allowed;
-- Expected output: true

-- Verify extensions installed and vector version:
SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'uuid-ossp');
-- Expected output: vector | 0.8.0+, uuid-ossp | 1.1+
```

### 6.3 Permitted vs Forbidden Operations Matrix (Testing as `qa_ai_app`)

| Action | SQL Tested | Expected Result |
| :--- | :--- | :--- |
| **Permitted DML** | `SELECT * FROM ai_projects;` | `200 OK / Success` |
| **Permitted DML** | `INSERT INTO ai_projects (...) VALUES (...);` | `200 OK / Success` |
| **Forbidden DDL** | `CREATE TABLE public.test_leak (id int);` | `ERROR: permission denied for schema public` |
| **Forbidden DDL** | `DROP TABLE ai_projects;` | `ERROR: must be owner of table ai_projects` |
| **Forbidden DDL** | `ALTER TABLE ai_projects ADD COLUMN leak text;` | `ERROR: must be owner of table ai_projects` |
| **Permitted Queue** | `CREATE TABLE pgboss.job_test (id int);` | `200 OK / Success` |

---

## 7. Seed & Verify Embedding Configuration

### 7.1 Duplicate-Safe Seed Script
To ensure that a newly provisioned database contains exactly one active initial model without violating the partial unique index:

```sql
INSERT INTO ai_embedding_config (
    model_name, 
    provider, 
    dimensions, 
    context_window, 
    distance_metric, 
    is_active
)
SELECT 'nomic-embed-text', 'OLLAMA', 768, 8192, 'cosine', TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM ai_embedding_config WHERE is_active = TRUE
);
```

### 7.2 Application Startup Verification Check
Before accepting requests, the backend AI database pool validates the embedding configuration:

```javascript
async function verifyEmbeddingConfig(pool) {
  const result = await pool.query(
    'SELECT id, model_name, dimensions, distance_metric, provider FROM ai_embedding_config WHERE is_active = TRUE'
  );

  if (result.rows.length === 0) {
    throw new Error('[FATAL] AI Module Startup Aborted: No active embedding configuration found in ai_embedding_config.');
  }

  if (result.rows.length > 1) {
    throw new Error('[FATAL] AI Module Startup Aborted: Multiple active embedding configurations detected.');
  }

  const active = result.rows[0];
  if (active.dimensions !== 768 || active.distance_metric !== 'cosine') {
    throw new Error(`[FATAL] Active embedding model configuration invalid: ${JSON.stringify(active)}`);
  }

  return active;
}
```

---

## 8. Complete Resource Ownership Authorization Coverage

Explicit parameterized ownership traversal queries for all resources:

### 1. Requirements
```sql
SELECT r.id, r.project_id, p.created_by_user_id 
FROM ai_requirements r
JOIN ai_projects p ON r.project_id = p.id
WHERE r.id = $1 AND r.project_id = $2;
```

### 2. Requirement Traceability Records
```sql
SELECT rt.id, r.project_id, p.created_by_user_id 
FROM ai_requirement_traceability rt
JOIN ai_requirements r ON rt.requirement_id = r.id
JOIN ai_projects p ON r.project_id = p.id
WHERE rt.id = $1 AND r.project_id = $2;
```

### 3. Document Chunks
```sql
SELECT c.id, d.project_id, p.created_by_user_id 
FROM ai_document_chunks c
JOIN ai_document_versions v ON c.version_id = v.id
JOIN ai_documents d ON v.document_id = d.id
JOIN ai_projects p ON d.project_id = p.id
WHERE c.id = $1 AND d.project_id = $2;
```

### 4. Document Embeddings
```sql
SELECT e.id, d.project_id, p.created_by_user_id 
FROM ai_document_embeddings e
JOIN ai_document_chunks c ON e.chunk_id = c.id
JOIN ai_document_versions v ON c.version_id = v.id
JOIN ai_documents d ON v.document_id = d.id
JOIN ai_projects p ON d.project_id = p.id
WHERE e.id = $1 AND d.project_id = $2;
```

### 5. Documents
```sql
SELECT d.id, d.project_id, p.created_by_user_id 
FROM ai_documents d
JOIN ai_projects p ON d.project_id = p.id
WHERE d.id = $1 AND d.project_id = $2;
```

### 6. Document Versions
```sql
SELECT v.id, d.project_id, p.created_by_user_id 
FROM ai_document_versions v
JOIN ai_documents d ON v.document_id = d.id
JOIN ai_projects p ON d.project_id = p.id
WHERE v.id = $1 AND d.project_id = $2;
```

### 7. Generation Jobs
```sql
SELECT j.id, j.project_id, j.user_id, p.created_by_user_id 
FROM ai_generation_jobs j
JOIN ai_projects p ON j.project_id = p.id
WHERE j.id = $1 AND j.project_id = $2;
```

### 8. Test Suites
```sql
SELECT s.id, s.project_id, p.created_by_user_id 
FROM ai_test_suites s
JOIN ai_projects p ON s.project_id = p.id
WHERE s.id = $1 AND s.project_id = $2;
```

### 9. Test Scenarios
```sql
SELECT sc.id, s.project_id, p.created_by_user_id 
FROM ai_test_scenarios sc
JOIN ai_test_suites s ON sc.suite_id = s.id
JOIN ai_projects p ON s.project_id = p.id
WHERE sc.id = $1 AND s.project_id = $2;
```

### 10. Test Cases
```sql
SELECT tc.id, s.project_id, p.created_by_user_id 
FROM ai_test_cases tc
JOIN ai_test_scenarios sc ON tc.scenario_id = sc.id
JOIN ai_test_suites s ON sc.suite_id = s.id
JOIN ai_projects p ON s.project_id = p.id
WHERE tc.id = $1 AND s.project_id = $2;
```

### 11. QA Checklists
```sql
SELECT cl.id, s.project_id, p.created_by_user_id 
FROM ai_qa_checklists cl
JOIN ai_test_suites s ON cl.suite_id = s.id
JOIN ai_projects p ON s.project_id = p.id
WHERE cl.id = $1 AND s.project_id = $2;
```

### 12. Generation History
```sql
SELECT gh.id, gh.project_id, gh.user_id, p.created_by_user_id 
FROM ai_generation_history gh
JOIN ai_projects p ON gh.project_id = p.id
WHERE gh.id = $1 AND gh.project_id = $2;
```

### 13. Human Review History
```sql
SELECT hr.id, s.project_id, hr.user_id, p.created_by_user_id 
FROM ai_human_reviews hr
JOIN ai_test_cases tc ON hr.test_case_id = tc.id
JOIN ai_test_scenarios sc ON tc.scenario_id = sc.id
JOIN ai_test_suites s ON sc.suite_id = s.id
JOIN ai_projects p ON s.project_id = p.id
WHERE hr.id = $1 AND s.project_id = $2;
```

---

## 9. Reconciled Empirical Regression Baseline

An empirical execution of the complete repository test harness was performed via `task-40102`.

### 9.1 Baseline Measurement

| Parameter | Measured Repository Value |
| :--- | :--- |
| **Supported Test Command** | `cmd /c "npm test"` (executing `node --test --test-concurrency=1 tests/**/*.test.js`) |
| **Total Test Files** | 81 files in `backend/tests/` |
| **Total Test Count** | **1,090 tests** |
| **Passing Tests** | **1,086 passing** |
| **Pre-existing Failures** | **4 tests** (3 in `tests/dialogShortcuts.test.js` due to frontend CSS class assertion mismatch; 1 in `tests/sopGuideVerification.test.js` due to relative path resolution of `sopData.js`). |

### 9.2 Milestone Verification Rule for Phase 2
After each Phase 2 integration milestone:
1. Run `cmd /c "npm test"`.
2. Total test count must equal or exceed **1,090**.
3. Total passing tests must not drop below **1,086**.
4. Zero new test failures are permitted.
5. All existing QA tools (Robo Test, Remote Config, Device Management, ADB, Google Drive) must remain 100% operational.

---

## 10. Phase 2 Implementation Roadmap

1. [ ] **Step 1: Host Prerequisites Installation**
   - Install PostgreSQL 16 on `127.0.0.1:5432`.
   - Compile and install `pgvector` binaries (`vector.dll`, `vector.control`) via Visual C++ Build Tools.
   - Install Ollama for Windows (`OLLAMA_NUM_THREADS=3`, `OLLAMA_HOST=127.0.0.1:11434`).
   - Pull `nomic-embed-text` and `qwen2.5:3b-instruct`.
2. [ ] **Step 2: Admin DB Setup**
   - Execute `000_admin_init.sql` as `postgres` with environment passwords.
   - Verify catalog permissions with Section 6.2 queries.
3. [ ] **Step 3: Module DB & Migration Engine**
   - Create `backend/src/modules/aiTestWriter/db/` (`config.js`, `index.js`, `migrate.js`).
   - Implement `001_initial_ai_schema.sql` with composite foreign keys, CHECK constraints, and partial unique index.
4. [ ] **Step 4: Outbox Dispatcher & Repositories**
   - Implement `aiJobRepository.js` with singleton keys and atomic claiming.
   - Implement outbox sweeper daemon.
   - Implement all 13 resource ownership queries.
5. [ ] **Step 5: Testing & Verification**
   - Run unit and integration tests (`aiTestWriterDb.test.js`).
   - Run regression baseline: assert `pass >= 1086` and `fail <= 4`.
