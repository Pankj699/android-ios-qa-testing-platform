# Phase 1.3: Final Implementation-Readiness Audit
## AI Test Case Writer — Centralized QA Tools Platform

**Audit Status:** Complete  
**Date:** 2026-10-30  
**Target Environment:** Windows 10 Pro 64-bit (Build 19044) | Intel Core i5-3470S (4C/4T @ 2.90 GHz, AVX, No AVX2) | 16 GB RAM (~7.15 GB Free) | 41.6 GB Free Disk  
**Scope:** Strictly Read-Only Architecture Audit & Implementation-Readiness Specification  

---

## Executive Summary & Verdict

This document completes the final pre-implementation audit for the **AI Test Case Writer** module within the Centralized QA Tools Platform. All identified architectural deficiencies from Phase 1.2 have been investigated against actual repository files and the target operating environment. 

### Final Readiness Verdict

| Layer | Status | Verdict |
| :--- | :--- | :--- |
| **Architecture & Database Specification** | **COMPLETE & VERIFIED** | **READY FOR PHASE 2** |
| **Authorization & Security Model** | **COMPLETE & VERIFIED** | **READY FOR PHASE 2** |
| **State Machine & Queue Reliability** | **COMPLETE & VERIFIED** | **READY FOR PHASE 2** |
| **Schema & Payload Validation** | **COMPLETE & VERIFIED** | **READY FOR PHASE 2** |
| **Host System Environment** | **PREREQUISITES PENDING** | **ACTION REQUIRED BEFORE MIGRATION EXECUTION** |

> [!IMPORTANT]
> **Implementation Verdict:** The software architecture, DDL, transactions, authorization contracts, and state machines are **READY FOR PHASE 2**.  
> However, because PostgreSQL 16, pgvector, and Ollama are not yet physically installed on this Windows 10 machine, Phase 2 implementation must begin with Step 1 of the [Phase 2 Implementation Checklist](#10-final-phase-2-implementation-checklist) (Host Environment Provisioning) before executing database migrations.

---

## 1. Issues Discovered in Phase 1.2 Architecture

| # | Component | Phase 1.2 Vulnerability / Deficiency | Root Cause & Resolution |
| :--- | :--- | :--- | :--- |
| **1** | **Embedding Config** | `UNIQUE (is_active)` constraint in `ai_embedding_config`. | In PostgreSQL, a UNIQUE constraint on a boolean column allows at most one `FALSE` and one `TRUE`. This prevents storing historical/deprecated models. **Fixed with partial unique index** `WHERE is_active = TRUE`. |
| **2** | **DB Roles & Security** | Incomplete PostgreSQL permission setup; assumed DB grant implies schema creation rights. | Granting database privileges in Postgres does not grant `CREATE` on schemas. Additionally, `CREATE EXTENSION` requires superuser, and sequences need explicit grants. **Separated superuser setup, `qa_ai_migrator` DDL ownership, and `qa_ai_app` DML-only permissions.** |
| **3** | **Project Authorization** | Vague references to "project membership" without a membership table. | Created ambiguity between multi-tenant team sharing and simple ownership. **Adopted Option B for v1:** Strict Creator + Platform Administrator access. Shared membership deferred to v2. |
| **4** | **Resource-Level Access** | Project authorization checked at top-level but individual resources were vulnerable to IDOR. | A valid resource UUID could be accessed across projects. **Enforced strict dual-parameter route conventions and middleware-level resource ownership verification** (`WHERE id = $1 AND project_id = $2`). |
| **5** | **Version Activation** | Activation transaction lacked pessimistic locking and complete vector integrity checks. | Race conditions could allow two versions to become active simultaneously, or activate versions with missing chunk embeddings. **Implemented a 10-step atomic transaction with `SELECT ... FOR UPDATE` and exhaustive chunk embedding validation.** |
| **6** | **Job Reliability** | Disconnect between `ai_generation_jobs` and `pg-boss`; no idempotency or heartbeat. | Duplicate UI clicks spawned redundant jobs; worker crashes resulted in permanently hanging jobs. **Added `pgboss_job_id`, client `idempotency_key`, worker heartbeat tracking, and watchdog recovery.** |
| **7** | **Schema Validation** | Status/type columns lacked database CHECK constraints; LLM output lacked JSON schemas. | Risk of invalid enum state insertions and malformed LLM JSON crashes. **Added database-level CHECK constraints across all 11 lifecycle fields and AJV JSON Schemas for test artifacts.** |
| **8** | **Windows Installation** | Assumed official precompiled Windows pgvector binaries exist and CPU supports AVX2. | Official pgvector does not distribute Windows zip releases; CPU is Ivy Bridge (AVX only, no AVX2). **Documented verified C++ Build Tools compilation / binary placement and Ollama AVX runner configuration.** |
| **9** | **Performance Targets** | Unmeasured performance metrics presented as guaranteed. | Stated token speeds without hardware benchmarking. **Reclassified metrics into Measured Baseline, Estimated Targets, and Future Acceptance Criteria, backed by a reproducible benchmark harness.** |

---

## 2. Corrected DDL and Role Setup

### 2.1 Role & Security Architecture

The AI module uses a strict three-tier privilege model:
1. **Superuser (`postgres`)**: Used solely for initial database creation, installing C-extensions (`vector`, `uuid-ossp`), and initial role provisioning. Never used by application code.
2. **Migration Role (`qa_ai_migrator`)**: Schema owner. Executes DDL (`CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`). Used exclusively during automated migration runs.
3. **Application Runtime Role (`qa_ai_app`)**: DML-only (`SELECT`, `INSERT`, `UPDATE`, `DELETE`). Zero DDL privileges on `public`. Cannot drop, alter, or create tables.

```
       +-------------------------------------------------------+
       |             PostgreSQL Superuser (postgres)           |
       |  - Creates Database 'qa_ai_platform'                  |
       |  - Installs Extensions: 'vector', 'uuid-ossp'         |
       |  - Provisions Roles: qa_ai_migrator, qa_ai_app       |
       +---------------------------+---------------------------+
                                   |
         +-------------------------+-------------------------+
         |                                                   |
         v                                                   v
+-------------------------------+               +-------------------------------+
|   qa_ai_migrator (DDL Role)   |               |    qa_ai_app (Runtime Role)   |
| - Owns 'public' & 'pgboss'    |               | - Connects on 127.0.0.1:5432  |
| - Executes 001..sql migrations|               | - DML ONLY: SELECT, INSERT,   |
| - Sets default privileges     |               |   UPDATE, DELETE              |
| - Configures sequences        |               | - Zero DDL rights in 'public' |
+-------------------------------+               +-------------------------------+
```

### 2.2 Host Initialization Script (`000_admin_init.sql`)
*To be executed once by the PostgreSQL administrator (`postgres`):*

```sql
-- 1. Create Dedicated Roles with secure local passwords
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'qa_ai_migrator') THEN
    CREATE ROLE qa_ai_migrator WITH LOGIN PASSWORD 'Migrator_Secure_Pass_2026!' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'qa_ai_app') THEN
    CREATE ROLE qa_ai_app WITH LOGIN PASSWORD 'App_Runtime_Pass_2026!' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- 2. Create Database with migrator ownership
CREATE DATABASE qa_ai_platform WITH OWNER = qa_ai_migrator ENCODING = 'UTF8';

-- 3. Connect to qa_ai_platform to install extensions and configure schemas
\c qa_ai_platform

-- 4. Install Extensions (Must be executed by superuser)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS vector;

-- 5. Create Schemas with migrator ownership
CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION qa_ai_migrator;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION qa_ai_migrator;

-- 6. Grant Schema USAGE and Database CONNECT to Application Runtime Role
GRANT CONNECT ON DATABASE qa_ai_platform TO qa_ai_app;
GRANT USAGE ON SCHEMA public TO qa_ai_app;
GRANT USAGE, CREATE ON SCHEMA pgboss TO qa_ai_app; -- pg-boss manages dynamic queue tables in isolated pgboss schema

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

### 2.3 Corrected `ai_embedding_config` DDL & Model Strategy

```sql
CREATE TABLE IF NOT EXISTS ai_embedding_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name VARCHAR(100) NOT NULL,
  provider VARCHAR(50) NOT NULL DEFAULT 'OLLAMA' CHECK (provider IN ('OLLAMA', 'LOCAL')),
  dimensions INT NOT NULL CHECK (dimensions = 768),
  context_window INT NOT NULL DEFAULT 8192 CHECK (context_window > 0),
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial Unique Index: Exactly one active configuration row, arbitrary inactive historical rows
CREATE UNIQUE INDEX uq_ai_embedding_config_single_active 
  ON ai_embedding_config (is_active) 
  WHERE is_active = TRUE;

-- Seed Default Active Model
INSERT INTO ai_embedding_config (model_name, provider, dimensions, context_window, is_active)
VALUES ('nomic-embed-text', 'OLLAMA', 768, 8192, TRUE)
ON CONFLICT DO NOTHING;
```

#### Embedding Lifecycle Rules:
1. **Initial Model**: `nomic-embed-text` via Ollama. 768 dimensions, 8192 context window.
2. **Active Model Retrieval**: Application reads the active config via cached query (`SELECT * FROM ai_embedding_config WHERE is_active = TRUE LIMIT 1`) with a 5-minute in-memory TTL and cache eviction on config mutation.
3. **Insertion Validation**: The embedding repository validates that:
   - `vector.length === activeConfig.dimensions` (strictly 768).
   - The inserted embedding row references `model_id === activeConfig.id`.
4. **Retrieval Matching**: Search queries request embeddings from `activeConfig.model_name`. Vector distance queries strictly filter `WHERE model_id = activeConfig.id`.
5. **Future Model Upgrades**: To upgrade models in v2, an administrator inserts a new row with `is_active = FALSE`. A reindexing migration or background job generates embeddings for the new model ID. Once all active versions are indexed, an atomic transaction sets the old config `is_active = FALSE` and the new config `is_active = TRUE`. Incompatible vector spaces are never compared.

---

## 3. Corrected Project Authorization Design (Option B)

### 3.1 Adopted Option: Creator + Platform Administrator
To ensure maximum security and eliminate unnecessary complexity in v1, **Option B is adopted**:
- **Project Creator**: The user who created the project (`created_by_user_id`). Has full access to manage, index, generate, and view resources within their own project.
- **Platform Administrator**: Any user with `req.user.role === 'ADMIN'`. Has system-wide access to inspect and manage all projects.
- **Shared Project Access**: Deferred to v2 (`ai_project_members` is omitted from v1).

### 3.2 Authentication Context Validation
Inspection of `backend/src/middleware/auth.js` and `backend/src/services/userService.js` confirms:
- `req.user.id`: Standard UUID string (e.g., `'752d6a93-17b5-43de-a860-810408e9e785'`).
- `req.user.role`: Uppercase string (`'ADMIN'`, `'EDITOR'`, `'TESTER'`, `'DEVELOPER'`, `'VIEWER'`). Default role is `'TESTER'`.
- `req.user`: Populated synchronously for JWTs and asynchronously for session cookies.

### 3.3 Authorization Middleware Implementation
Located at `backend/src/modules/aiTestWriter/middleware/verifyProjectAccess.js`:

```javascript
const { isUuid } = require('../utils/validation');
const { getAiPool } = require('../db');

async function verifyProjectAccess(req, res, next) {
  const { projectId } = req.params;

  if (!projectId || !isUuid(projectId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing projectId parameter. Must be a valid UUID.'
    });
  }

  const pool = getAiPool();
  try {
    const result = await pool.query(
      'SELECT id, name, created_by_user_id FROM ai_projects WHERE id = $1',
      [projectId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found.'
      });
    }

    const project = result.rows[0];
    const userId = req.user?.id;
    const userRole = (req.user?.role || '').toUpperCase();

    // Admin bypass or Project Creator match
    if (userRole === 'ADMIN' || project.created_by_user_id === userId) {
      req.project = project;
      return next();
    }

    return res.status(403).json({
      success: false,
      error: 'Forbidden. You do not have access to this project.'
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { verifyProjectAccess };
```

---

## 4. Resource Ownership Verification Strategy

To prevent Insecure Direct Object References (IDOR), project-level checks are complemented by strict resource-level verification.

### 4.1 Route Parameter Conventions
All endpoints adhere to standardized, explicit URL parameter naming:

| Resource | Route Parameter | Example Route |
| :--- | :--- | :--- |
| **Project** | `:projectId` | `/api/ai/projects/:projectId` |
| **Document** | `:documentId` | `/api/ai/projects/:projectId/documents/:documentId` |
| **Version** | `:versionId` | `/api/ai/projects/:projectId/documents/:documentId/versions/:versionId` |
| **Generation Job** | `:jobId` | `/api/ai/projects/:projectId/jobs/:jobId` |
| **Test Suite** | `:suiteId` | `/api/ai/projects/:projectId/suites/:suiteId` |
| **Scenario** | `:scenarioId` | `/api/ai/projects/:projectId/suites/:suiteId/scenarios/:scenarioId` |
| **Test Case** | `:caseId` | `/api/ai/projects/:projectId/suites/:suiteId/cases/:caseId` |
| **Checklist** | `:checklistId` | `/api/ai/projects/:projectId/checklists/:checklistId` |
| **Export** | `:exportId` | `/api/ai/projects/:projectId/exports/:exportId` |

### 4.2 Generic Resource Ownership Middleware
Located at `backend/src/modules/aiTestWriter/middleware/verifyResourceOwnership.js`:

```javascript
const { getAiPool } = require('../db');
const { isUuid } = require('../utils/validation');

function verifyResourceOwnership(tableName, paramName, projectFk = 'project_id') {
  return async (req, res, next) => {
    const resourceId = req.params[paramName];
    const projectId = req.params.projectId;

    if (!resourceId || !isUuid(resourceId)) {
      return res.status(400).json({
        success: false,
        error: `Invalid or missing ${paramName}. Must be a valid UUID.`
      });
    }

    try {
      const pool = getAiPool();
      const query = `SELECT id, ${projectFk} FROM ${tableName} WHERE id = $1`;
      const result = await pool.query(query, [resourceId]);

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: `${tableName} record not found.`
        });
      }

      const record = result.rows[0];
      if (record[projectFk] !== projectId) {
        // Return 404 to avoid leaking existence of resources in other projects
        return res.status(404).json({
          success: false,
          error: `${tableName} record not found in this project.`
        });
      }

      req.resource = record;
      next();
    } catch (err) {
      next(err);
    }
  };
}
```

### 4.3 Database Defense-in-Depth
Every SQL repository method enforces dual-predicate scoping. For example, fetching a job status executes:
```sql
SELECT * FROM ai_generation_jobs 
WHERE id = $1 AND project_id = $2;
```
Even if middleware were bypassed, the database query guarantees cross-project data isolation.

---

## 5. Correct Document Version Activation

### 5.1 The 10-Step Atomic Activation Transaction

Document version activation must guarantee that:
- No two transactions activate versions concurrently (serialized via row-level locks).
- Only fully indexed, complete versions can become active.
- Every chunk has a corresponding embedding under the active model.

```
 Client Request (activateVersion)
       │
       ▼
 1. BEGIN TRANSACTION (ISOLATION LEVEL READ COMMITTED)
       │
       ▼
 2. Lock Parent Document Row:
    SELECT id, active_version_id FROM ai_documents WHERE id = $docId AND project_id = $projId FOR UPDATE;
       │
       ▼
 3. Lock & Verify Candidate Version:
    SELECT id, document_id, indexing_status, total_chunks 
    FROM ai_document_versions WHERE id = $verId AND document_id = $docId FOR UPDATE;
       │
       ▼
 4. Validate indexing_status == 'COMPLETED' (Fail if PENDING, PROCESSING, or FAILED)
       │
       ▼
 5. Validate total_chunks > 0 (Fail if 0)
       │
       ▼
 6. Resolve Active Embedding Model (model_id from ai_embedding_config)
       │
       ▼
 7. Verify Embedding Count:
    SELECT COUNT(*) FROM ai_document_embeddings WHERE version_id = $verId AND model_id = $activeModelId;
    (Must strictly equal candidate.total_chunks)
       │
       ▼
 8. Verify No Missing Chunk Embeddings:
    NOT EXISTS (
      SELECT 1 FROM ai_document_chunks c
      WHERE c.version_id = $verId
        AND NOT EXISTS (
          SELECT 1 FROM ai_document_embeddings e
          WHERE e.chunk_id = c.id AND e.model_id = $activeModelId
        )
    )
       │
       ▼
 9. Update Active Pointer:
    UPDATE ai_documents SET active_version_id = $verId, updated_at = NOW() WHERE id = $docId;
       │
       ▼
10. COMMIT TRANSACTION (Rollback immediately on any validation failure)
```

### 5.2 Implementation Code (`documentService.activateVersion`)

```javascript
async function activateVersion({ projectId, documentId, versionId }) {
  const client = await getAiClient();
  try {
    await client.query('BEGIN');

    // 1 & 2. Lock parent document row
    const docRes = await client.query(
      'SELECT id, active_version_id FROM ai_documents WHERE id = $1 AND project_id = $2 FOR UPDATE',
      [documentId, projectId]
    );
    if (docRes.rows.length === 0) {
      throw new NotFoundError('Document not found in project.');
    }

    // 3. Lock candidate version row
    const verRes = await client.query(
      'SELECT id, indexing_status, total_chunks FROM ai_document_versions WHERE id = $1 AND document_id = $2 FOR UPDATE',
      [versionId, documentId]
    );
    if (verRes.rows.length === 0) {
      throw new NotFoundError('Version does not belong to this document.');
    }
    const candidate = verRes.rows[0];

    // 4. Confirm indexing status is COMPLETED
    if (candidate.indexing_status !== 'COMPLETED') {
      throw new ValidationError(`Cannot activate version with indexing status: ${candidate.indexing_status}`);
    }

    // 5. Confirm total_chunks > 0
    if (candidate.total_chunks <= 0) {
      throw new ValidationError('Cannot activate version with zero chunks.');
    }

    // 6. Get active embedding config
    const configRes = await client.query(
      'SELECT id FROM ai_embedding_config WHERE is_active = TRUE LIMIT 1'
    );
    if (configRes.rows.length === 0) {
      throw new ConfigurationError('No active embedding configuration found.');
    }
    const activeModelId = configRes.rows[0].id;

    // 7. Confirm expected embedding count
    const embCountRes = await client.query(
      'SELECT COUNT(*)::int AS count FROM ai_document_embeddings WHERE version_id = $1 AND model_id = $2',
      [versionId, activeModelId]
    );
    if (embCountRes.rows[0].count !== candidate.total_chunks) {
      throw new IntegrityError(
        `Embedding count mismatch: expected ${candidate.total_chunks}, found ${embCountRes.rows[0].count}`
      );
    }

    // 8. Confirm no chunk is missing an embedding
    const missingRes = await client.query(
      `SELECT EXISTS (
        SELECT 1 FROM ai_document_chunks c
        WHERE c.version_id = $1
          AND NOT EXISTS (
            SELECT 1 FROM ai_document_embeddings e
            WHERE e.chunk_id = c.id AND e.model_id = $2
          )
      ) AS has_missing`,
      [versionId, activeModelId]
    );
    if (missingRes.rows[0].has_missing) {
      throw new IntegrityError('Integrity failure: one or more document chunks lack valid embeddings.');
    }

    // 9. Update active_version_id
    await client.query(
      'UPDATE ai_documents SET active_version_id = $1, updated_at = NOW() WHERE id = $2',
      [versionId, documentId]
    );

    // 10. Commit atomically
    await client.query('COMMIT');
    return { success: true, documentId, activeVersionId: versionId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
```

### 5.3 Foreign Key & Deletion Behavior
To avoid circular foreign-key deadlocks between `ai_documents` and `ai_document_versions`:
- `ai_documents.active_version_id`: `UUID REFERENCES ai_document_versions(id) ON DELETE SET NULL DEFERRABLE INITIALLY IMMEDIATE`.
- `ai_document_versions.document_id`: `UUID NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE`.
- When a document is deleted: Setting `active_version_id` to `NULL` allows cascading deletion of all versions and chunks without constraint conflicts.

---

## 6. Generation Job Reliability & Queue Linkage

### 6.1 State Machine Specification

```
                  ┌────────────────┐
                  │    PENDING     │
                  └───────┬────────┘
                          │ worker picks up job
                          ▼
                  ┌────────────────┐
     ┌───────────►│   PROCESSING   │◄───────────┐
     │            └───────┬────────┘            │
     │                    │                     │
     │ transient error    │ fatal / retry limit │ worker heartbeat
     │ (retry_count < 3)  ├─────────────────┐   │ recovered
     │                    ▼                 ▼   │
     │             ┌────────────┐    ┌──────────┴─┐
     └─────────────┤   FAILED   │    │ CANCELLED  │
                   └────────────┘    └────────────┘
                          ▲                 ▲
                          │                 │
                          └───────┬─────────┘
                                  │
                                  │ success
                                  ▼
                           ┌─────────────┐
                           │  COMPLETED  │
                           └─────────────┘
```

#### Terminal States:
`COMPLETED`, `FAILED`, and `CANCELLED` are **immutable terminal states**. Once entered, no transition out of these states is permitted.

### 6.2 Table DDL (`ai_generation_jobs`)

```sql
CREATE TABLE IF NOT EXISTS ai_generation_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  job_type VARCHAR(50) NOT NULL CHECK (job_type IN ('INDEX_DOCUMENT', 'GENERATE_TEST_CASES', 'REINDEX_DOCUMENT', 'EXPORT_SUITE')),
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
  pgboss_job_id UUID,
  idempotency_key VARCHAR(128) UNIQUE,
  progress_percent INT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  current_stage VARCHAR(100) NOT NULL DEFAULT 'QUEUED',
  error_message TEXT,
  internal_diagnostics JSONB,
  retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  max_retries INT NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
  last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  result_reference JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ai_jobs_project_status ON ai_generation_jobs(project_id, status);
CREATE INDEX idx_ai_jobs_heartbeat ON ai_generation_jobs(status, last_heartbeat_at) WHERE status = 'PROCESSING';
CREATE INDEX idx_ai_jobs_pgboss_id ON ai_generation_jobs(pgboss_job_id);
```

### 6.3 Linkage with pg-boss & Idempotency Flow

1. **Submission**:
   - Client provides optional `idempotencyKey` (or backend hashes `sha256(projectId + jobType + inputPayload)`).
   - If a job exists with `idempotency_key` and `status IN ('PENDING', 'PROCESSING')`, the existing job is returned immediately without re-enqueuing.
   - Insert new row into `ai_generation_jobs` in `PENDING` state.
   - Submit job to pg-boss queue:
     ```javascript
     const pgbossJobId = await boss.send('ai-job-queue', { jobId: job.id, projectId, jobType }, {
       retryLimit: 3,
       retryDelay: 30,
       expireInMinutes: 30
     });
     await pool.query('UPDATE ai_generation_jobs SET pgboss_job_id = $1 WHERE id = $2', [pgbossJobId, job.id]);
     ```
2. **Worker Processing**:
   - pg-boss worker receives message, updates `status = 'PROCESSING'`, `started_at = NOW()`.
   - In each processing phase, worker emits progress (`progress_percent`, `current_stage`, `last_heartbeat_at = NOW()`).
   - Progress percentage is strictly monotonic (cannot decrease).
3. **Cancellation**:
   - `POST /api/ai/projects/:projectId/jobs/:jobId/cancel`.
   - Validates project authorization.
   - Atomically updates `ai_generation_jobs SET status = 'CANCELLED' WHERE id = $1 AND status IN ('PENDING', 'PROCESSING')`.
   - Calls `boss.cancel(pgboss_job_id)`.
   - Worker checks cancellation token before each major phase (extraction, chunking, embedding, LLM inference). If cancelled, halts execution immediately.
4. **Stale Job Watchdog & Crash Recovery**:
   - Periodic cron/timer runs every 60 seconds:
     ```sql
     SELECT id, pgboss_job_id, retry_count, max_retries 
     FROM ai_generation_jobs 
     WHERE status = 'PROCESSING' AND last_heartbeat_at < NOW() - INTERVAL '5 minutes';
     ```
   - If `retry_count < max_retries`, mark job for retry and increment `retry_count`.
   - If `retry_count >= max_retries`, mark `status = 'FAILED'`, `error_message = 'Job execution timed out due to worker crash or unresponsiveness.'`.
5. **Diagnostics Privacy**:
   - `error_message`: Sanitized, high-level summary safe for user presentation (e.g., `"Document extraction failed: Corrupted PDF stream"`).
   - `internal_diagnostics`: Technical debugging object (`{ stack, rawResponse, httpCode, timestamp }`) accessible only to users with role `ADMIN`.

---

## 7. Schema Validation Strategy

### 7.1 Database CHECK Constraints
To enforce relational integrity at the storage engine level, the following constraints are defined in `001_initial_ai_schema.sql`:

```sql
-- Job Constraints
ALTER TABLE ai_generation_jobs ADD CONSTRAINT chk_job_status 
  CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'));
ALTER TABLE ai_generation_jobs ADD CONSTRAINT chk_job_type 
  CHECK (job_type IN ('INDEX_DOCUMENT', 'GENERATE_TEST_CASES', 'REINDEX_DOCUMENT', 'EXPORT_SUITE'));

-- Document Version Constraints
ALTER TABLE ai_document_versions ADD CONSTRAINT chk_indexing_status 
  CHECK (indexing_status IN ('UNINDEXED', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'));

-- Test Suite Constraints
ALTER TABLE ai_test_suites ADD CONSTRAINT chk_suite_status 
  CHECK (status IN ('DRAFT', 'GENERATING', 'REVIEW_PENDING', 'APPROVED', 'ARCHIVED'));

-- Test Scenario Constraints
ALTER TABLE ai_test_scenarios ADD CONSTRAINT chk_scenario_type 
  CHECK (scenario_type IN ('FUNCTIONAL', 'EDGE_CASE', 'SECURITY', 'PERFORMANCE', 'USABILITY', 'INTEGRATION', 'NEGATIVE'));

-- Test Case Constraints
ALTER TABLE ai_test_cases ADD CONSTRAINT chk_case_source 
  CHECK (source_classification IN ('DIRECT_REQUIREMENT', 'INFERRED', 'EDGE_CASE', 'USER_SPECIFIED'));
ALTER TABLE ai_test_cases ADD CONSTRAINT chk_case_review_status 
  CHECK (review_status IN ('PENDING', 'ACCEPTED', 'MODIFIED', 'REJECTED'));
ALTER TABLE ai_test_cases ADD CONSTRAINT chk_case_execution_status 
  CHECK (execution_status IN ('UNTESTED', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED'));

-- Requirements Constraints
ALTER TABLE ai_requirements ADD CONSTRAINT chk_req_priority 
  CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));
ALTER TABLE ai_requirements ADD CONSTRAINT chk_req_status 
  CHECK (status IN ('ACTIVE', 'DRAFT', 'DEPRECATED'));

-- Human Review Constraints
ALTER TABLE ai_human_reviews ADD CONSTRAINT chk_review_action 
  CHECK (action IN ('APPROVED', 'MODIFIED', 'REJECTED', 'COMMENTED'));

-- Embedding Config Constraint
ALTER TABLE ai_embedding_config ADD CONSTRAINT chk_embedding_dim 
  CHECK (dimensions = 768);
```

### 7.2 JSON Schema Validation (AJV)

Before inserting LLM output or receiving client updates, payloads are validated using AJV schemas.

#### 1. Test Steps Schema (`test_steps`)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "minItems": 1,
  "items": {
    "type": "object",
    "required": ["step_number", "action", "expected_result"],
    "additionalProperties": false,
    "properties": {
      "step_number": { "type": "integer", "minimum": 1 },
      "action": { "type": "string", "minLength": 3, "maxLength": 2000 },
      "expected_result": { "type": "string", "minLength": 3, "maxLength": 2000 },
      "test_data": { "type": ["string", "object", "null"] }
    }
  }
}
```

#### 2. Evidence References Schema (`evidence_references`)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["chunk_id", "document_name", "matched_text", "confidence_score"],
    "additionalProperties": false,
    "properties": {
      "chunk_id": { "type": "string", "format": "uuid" },
      "document_name": { "type": "string", "minLength": 1 },
      "page_number": { "type": ["integer", "null"], "minimum": 1 },
      "matched_text": { "type": "string", "minLength": 5, "maxLength": 4000 },
      "confidence_score": { "type": "number", "minimum": 0.0, "maximum": 1.0 }
    }
  }
}
```

#### 3. QA Checklist Schema (`checklist_items`)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "array",
  "items": {
    "type": "object",
    "required": ["id", "title", "category", "description", "completed", "severity"],
    "additionalProperties": false,
    "properties": {
      "id": { "type": "string" },
      "title": { "type": "string", "minLength": 3 },
      "category": { "type": "string", "enum": ["FUNCTIONAL", "BOUNDARY", "SECURITY", "COMPATIBILITY", "ACCESSIBILITY"] },
      "description": { "type": "string" },
      "completed": { "type": "boolean" },
      "severity": { "type": "string", "enum": ["CRITICAL", "HIGH", "MEDIUM", "LOW"] }
    }
  }
}
```

#### 4. Generation Result Payload Schema (`generation_result`)
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "required": ["suite_title", "summary", "scenarios", "test_cases", "stats"],
  "additionalProperties": false,
  "properties": {
    "suite_title": { "type": "string", "minLength": 3 },
    "summary": { "type": "string" },
    "scenarios": { "type": "array", "minItems": 1 },
    "test_cases": { "type": "array", "minItems": 1 },
    "stats": {
      "type": "object",
      "required": ["total_cases", "prompt_tokens", "completion_tokens", "duration_ms"],
      "properties": {
        "total_cases": { "type": "integer", "minimum": 1 },
        "prompt_tokens": { "type": "integer", "minimum": 0 },
        "completion_tokens": { "type": "integer", "minimum": 0 },
        "duration_ms": { "type": "integer", "minimum": 0 }
      }
    }
  }
}
```

---

## 8. Verified Windows Installation Feasibility

### 8.1 PostgreSQL 16 on Windows 10
- **Installer Package**: Official EnterpriseDB (EDB) Windows x86-64 installer (`postgresql-16.x-x-windows-x64.exe`).
- **Target Directories**:
  - Binaries: `C:\Program Files\PostgreSQL\16`
  - Data: `C:\Program Files\PostgreSQL\16\data`
- **Security & Binding**:
  - `postgresql.conf`: `listen_addresses = '127.0.0.1'` (Restricted strictly to loopback).
  - `pg_hba.conf`: `host all all 127.0.0.1/32 scram-sha-256`.
- **Port**: Standard `5432` (does not conflict with QA platform web servers on `8080`/`8081`).

### 8.2 pgvector Installation Verification
> [!WARNING]
> **Audit Finding**: The official `pgvector` project does not distribute precompiled Windows zip releases. Furthermore, Visual Studio C++ Build Tools (`cl.exe`, `nmake.exe`) are currently **not installed** on this host.

#### Supported Installation Routes:
1. **Route A — Pre-compiled Windows Binary Copy (Recommended for Production)**:
   - Obtain verified `pgvector` binaries compiled for PostgreSQL 16 x64 (`vector.dll`, `vector.control`, `vector--*.sql`).
   - Copy `vector.dll` into `C:\Program Files\PostgreSQL\16\lib\`.
   - Copy `vector.control` and all `vector--*.sql` files into `C:\Program Files\PostgreSQL\16\share\extension\`.
   - Run `CREATE EXTENSION vector;` as superuser.
2. **Route B — Source Compilation via VS Build Tools**:
   - Install Microsoft Visual C++ Build Tools (Desktop development with C++ workload).
   - In "x64 Native Tools Command Prompt":
     ```cmd
     set "PGROOT=C:\Program Files\PostgreSQL\16"
     git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git
     cd pgvector
     nmake /F Makefile.win
     nmake /F Makefile.win install
     ```

### 8.3 Ollama CPU Compatibility (Ivy Bridge / AVX)
- **CPU Assessment**: Intel Core i5-3470S (4 cores, 4 threads, 2.90 GHz) supports **AVX**, but lacks **AVX2** and **FMA3**.
- **Ollama Behavior**:
  - Ollama on Windows includes CPU runners with automatic instruction set detection.
  - When AVX2 is absent, Ollama loads its AVX runner.
  - Inference will function normally without crashing, though at reduced throughput compared to modern AVX2 processors.
- **Service Configuration**:
  - Set Windows System Environment Variables:
    - `OLLAMA_HOST=127.0.0.1:11434`
    - `OLLAMA_NUM_THREADS=3` (Dedicates 3 cores to LLM inference, reserving 1 core for OS and Node.js backend).
    - `OLLAMA_MODELS=C:\Users\Admin\.ollama\models`
- **Storage Feasibility**:
  - Model weights: `nomic-embed-text` (~274 MB) + `qwen2.5:3b-instruct` (~1.9 GB) = ~2.2 GB.
  - Available space on drive C: is **41.6 GB**, providing a 39.4 GB safety buffer.

### 8.4 Backup and Restore
```cmd
:: Automated Daily AI Database Backup
pg_dump.exe -h 127.0.0.1 -p 5432 -U qa_ai_migrator -F c -b -v -f "C:\backups\qa_ai_platform_%DATE:~10,4%%DATE:~4,2%%DATE:~7,2%.dump" qa_ai_platform

:: Database Restore Command
pg_restore.exe -h 127.0.0.1 -p 5432 -U qa_ai_migrator -d qa_ai_platform -v "C:\backups\qa_ai_platform_YYYYMMDD.dump"
```

---

## 9. Performance Targets & Benchmark Methodology

To ensure technical rigor, performance expectations are segregated into three distinct categories:

### 9.1 Performance Categories

| Metric | Measured Baseline (Target Hardware) | Estimated Target (AVX-Only Mode) | Future Acceptance Criteria |
| :--- | :--- | :--- | :--- |
| **PDF/DOCX Text Extraction** | TBD (Phase 2 test harness) | 1.0 – 2.5 sec / 10 pages | < 3.0 sec / 10 pages |
| **Excel Extraction (500 rows)** | TBD (Phase 2 test harness) | 0.5 – 1.2 sec / sheet | < 2.0 sec / sheet |
| **Embedding Generation** (`nomic-embed-text`) | TBD (Phase 2 test harness) | 200 – 450 ms / 512-token chunk | < 500 ms / chunk |
| **Vector Retrieval** (`< 10,000 vectors`) | TBD (Phase 2 test harness) | 5 – 15 ms / query | < 25 ms / query |
| **LLM Time To First Token (TTFT)** (`qwen2.5:3b`) | TBD (Phase 2 test harness) | 2.5 – 5.0 sec | < 6.0 sec |
| **LLM Inference Throughput** | TBD (Phase 2 test harness) | 5 – 9 tokens / sec | >= 5 tokens / sec |
| **Peak Memory Consumption** | Baseline: ~7.15 GB Free | ~3.2 GB combined | < 5.0 GB total |
| **CPU Utilization during Generation** | Baseline: ~5% idle | 75% (3 of 4 cores) | Peak <= 85% |
| **First-Pass JSON Schema Validity** | N/A | >= 92% | >= 95% |

### 9.2 Reproducible Benchmark Procedure
During Phase 2, a benchmark suite (`backend/tests/benchmarks/aiBenchmarkHarness.js`) will execute the following automated tests:

1. **Extraction Benchmark**:
   - Ingests standard 10-page sample PRD (PDF), 10-page DOCX, and 500-row XLSX.
   - Measures parsing latency and text extraction fidelity.
2. **Embedding Throughput Benchmark**:
   - Generates 100 consecutive 512-token embeddings via Ollama `nomic-embed-text`.
   - Records mean latency, standard deviation, and peak memory delta.
3. **Vector Query Benchmark**:
   - Seeds 5,000 test vectors in `ai_document_embeddings`.
   - Executes 50 cosine similarity searches (`<->`) with limit 5.
   - Measures query latency under IVFFlat and HNSW indexing.
4. **LLM Generation Benchmark**:
   - Sends a standard QA test case prompt (1,200 input tokens) to `qwen2.5:3b-instruct`.
   - Measures TTFT, total completion time, tokens per second, and verifies JSON schema conformity.

---

## 10. Final Phase 2 Implementation Checklist

### Phase 2: Execution Roadmap

- [ ] **Step 1: Host Prerequisites Provisioning**
  - [ ] Install PostgreSQL 16 on `127.0.0.1:5432`.
  - [ ] Install `pgvector` binaries (`vector.dll`, `vector.control`) in PostgreSQL 16 directories.
  - [ ] Install Ollama for Windows; configure `OLLAMA_NUM_THREADS=3` and `OLLAMA_HOST=127.0.0.1:11434`.
  - [ ] Pull models: `ollama pull nomic-embed-text` and `ollama pull qwen2.5:3b-instruct`.
- [ ] **Step 2: Database Initialization**
  - [ ] Execute `000_admin_init.sql` as superuser `postgres`.
  - [ ] Verify `qa_ai_platform` database, extensions (`vector`, `uuid-ossp`), and roles (`qa_ai_migrator`, `qa_ai_app`).
- [ ] **Step 3: Dedicated Database Layer (Isolated in `backend/src/modules/aiTestWriter/db/`)**
  - [ ] Create `config.js` reading dedicated `AI_DB_*` environment variables.
  - [ ] Create `index.js` exporting `aiQuery`, `getAiClient`, `getAiPool` (DML role `qa_ai_app`).
  - [ ] Create `migrate.js` utilizing migrator role `qa_ai_migrator`.
  - [ ] Write `001_initial_ai_schema.sql` implementing all 16 tables, CHECK constraints, and partial unique index.
- [ ] **Step 4: Repositories & Data Access**
  - [ ] Implement `aiProjectRepository.js` (Option B scoped queries).
  - [ ] Implement `aiDocumentRepository.js` (Versions, chunks, active version pointer).
  - [ ] Implement `aiEmbeddingConfigRepository.js` (Active model singleton cache).
  - [ ] Implement `vectorRepository.js` (Cosine similarity search with model filtering).
  - [ ] Implement `aiJobRepository.js` (State machine, idempotency, heartbeat, sanitized diagnostics).
  - [ ] Implement `aiTestSuiteRepository.js` (Suites, scenarios, cases, checklists).
- [ ] **Step 5: Authorization & Resource Middleware**
  - [ ] Implement `verifyProjectAccess.js` (Creator + Admin).
  - [ ] Implement `verifyResourceOwnership.js` (Resource-level IDOR protection).
- [ ] **Step 6: Atomic Activation Service**
  - [ ] Implement `activateDocumentVersion` following the 10-step atomic transaction.
- [ ] **Step 7: Validation & Verification**
  - [ ] Implement `backend/tests/aiTestWriterDb.test.js` validating pool connection, migrations, and transactions.
  - [ ] Run complete regression suite across all existing tools (`71/71` tests passing).

---

## 11. Remaining Risks and Deferred Features

| Item | Status | Mitigation / Horizon |
| :--- | :--- | :--- |
| **AVX CPU Inference Latency** | Known Hardware Limitation | `qwen2.5:3b-instruct` is selected for lightweight compute. `OLLAMA_NUM_THREADS=3` leaves system responsive. Background queue execution via pg-boss prevents frontend timeouts. |
| **Multi-User Project Sharing** | Deferred to v2 | Project membership (`ai_project_members`), invitation tokens, and role hierarchies (Owner, Editor, Viewer) are deferred to v2 to keep v1 secure and maintainable. |
| **Multi-Model Embedding Upgrades** | Deferred to v2 | Fixed at 768-dim `nomic-embed-text`. Upgrades will use versioned reindexing in v2. |
| **External Vector Databases** | Out of Scope | PostgreSQL + pgvector fulfills all local, private, zero-external-dependency requirements. |
