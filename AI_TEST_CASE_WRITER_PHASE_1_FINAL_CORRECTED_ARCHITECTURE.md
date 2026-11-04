# Phase 1: Final Architecture Correction & Consolidation
## AI Test Case Writer — Centralized QA Tools Platform

**Document Status:** Authoritative Pre-Implementation Blueprint & Consolidated Architecture  
**Date:** 2026-10-30  
**Target Environment:** Windows 10 Pro 64-bit | Intel Core i5-3470S (4C/4T @ 2.90 GHz, AVX) | 16 GB RAM | Localhost (127.0.0.1)  
**Repository Git Commit Baseline:** `ba0d402ae2482bfc7f7c065ec9ab2e5503ddf200`  
**Execution Context:** Documentation Consolidation Only (No source code or database modifications)  

---

## Executive Summary & Final Architecture Status

This document represents the **authoritative, final consolidated architectural blueprint** for the **AI Test Case Writer** module within the Centralized QA Tools Platform. It formally incorporates the resolution of all technical defects identified across the architecture review cycles (Phases 1.1 through 1.8), provides full 16-table DDL reconciliation, establishes strict platform isolation, and records the **mandatory Phase 2 implementation requirements and acceptance gates**.

All design-level corrections in this document are strictly categorized according to verified implementation readiness. **Phase 2 implementation has NOT begun and remains subject to explicit user approval and host environment provisioning.**

### Consolidated Architecture Status

```
+---------------------------------------------------------------------------------------+
|                               CONSOLIDATED STATUS:                                    |
|                       PHASE 1 DESIGN ARCHITECTURE CONSOLIDATED                        |
|                  MANDATORY PHASE 2 ACCEPTANCE GATES FORMALLY RECORDED                 |
|             (Phase 2 Implementation Pending Explicit User Authorization)             |
+---------------------------------------------------------------------------------------+
|  1. Architecture & DDL: Complete 16-table schema reconciled with composite FKs.       |
|  2. Fencing & Outbox: Committed-outbox boundary + single watchdog retry authority.     |
|  3. Transaction Boundaries: Mandatory shared client covers all artifact writes.       |
|  4. Immutability: Version row triggers lock metadata; chunk triggers check OLD/NEW.   |
|  5. Concurrency: FOR SHARE chunk insertion vs FOR UPDATE completion serialization.   |
|  6. Safe Cascades: Deletion triggers allow CASCADE on document removal, block direct. |
|  7. Route Security: Complete 24-route inventory adhering strictly to Option B.        |
|  8. Implementation Gates: Gates A, B, and C formally recorded with test matrices.     |
|  9. Test Baseline: Reconciled 1,090 tests (1,086 pass, 4 known) signature-tracked.    |
| 10. Platform Integrity: 100% preservation of existing pg-mem DB and QA tools.         |
+---------------------------------------------------------------------------------------+
```

---

## 1. Original Approved Architecture Overview

The core architectural pillars established across Phase 1 remain fully preserved:

1. **Dedicated AI PostgreSQL Database (`qa_ai_platform`)**: Runs locally on `127.0.0.1:5432` completely isolated from the existing QA platform database (`pg-mem` syncing to `backend/data/auth_db.json`). Zero shared tables, zero migration interference.
2. **PostgreSQL pgvector Extension**: Local vector storage utilizing 768-dimensional embeddings (`nomic-embed-text`) with HNSW indexing under cosine distance (`vector_cosine_ops`).
3. **Local Inference Engine (Ollama for Windows)**: Bound to `127.0.0.1:11434`, running in native AVX CPU mode (`OLLAMA_NUM_THREADS=3`) on the host's Intel Core i5-3470S processor.
   - Embedding Model: `nomic-embed-text` (768 dimensions, 8192 context window).
   - Generation LLM: `qwen2.5:3b-instruct` (Q4_K_M quantization ~ 1.9 GB).
4. **Backend Integration**: Node.js & Express service mounted under `/api/ai`, using connection pooling (`aiDbPool`) and a dedicated schema migration runner (`ai_schema_migrations`).
5. **Option B Authorization Model**: Access restricted strictly to **Project Creator** (`created_by_user_id === req.user.id`) and **Platform Administrator** (`req.user.role === 'ADMIN'`). Multi-user shared project membership (`ai_project_members`) is formally deferred to v2.

---

## 2. Comprehensive Defect-to-Correction Verification Table

> [!NOTE]
> In accordance with architectural audit standards, all items are classified using strict verification statuses:
> - `DESIGN CORRECTED — NOT RUNTIME VERIFIED`: Architectural specification corrected and mathematically validated; requires PostgreSQL 16 runtime execution in Phase 2 to verify.
> - `IMPLEMENTED — NOT YET TESTED`: Code implemented but awaiting test execution.
> - `RUNTIME VERIFIED — EVIDENCE ATTACHED`: Empirically validated with execution logs attached.
> - `NOT VERIFIED`: Not yet verified.

| # | Architecture Area | Identified Defect | Consolidated Technical Correction | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **1** | **Document Version Row Immutability** | Trigger only monitored `indexing_status` transitions, allowing modification of version metadata (`file_size_bytes`, `storage_path`, `sha256_hash`, `total_chunks`) after completion. | Implemented `trg_enforce_version_row_immutability` on `BEFORE UPDATE ON ai_document_versions`. Aborts ANY modification to metadata or status if `OLD.indexing_status = 'COMPLETED'`. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **2** | **Chunk & Embedding Immutability** | Child trigger checked only `NEW.version_id` on `UPDATE`, allowing reassignment of chunks away from a completed version. | Implemented `trg_enforce_version_immutability` checking **both** `OLD.version_id` (on `UPDATE`/`DELETE`) and `NEW.version_id` (on `INSERT`/`UPDATE`). Both must not be `COMPLETED`. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **3** | **Concurrency: Chunk Write vs Completion** | Potential race condition between background chunk ingestion and the worker's status transition to `COMPLETED`. | Implemented PostgreSQL row lock serialization: Chunk insert acquires `SELECT id FROM ai_document_versions WHERE id = NEW.version_id FOR SHARE`. Worker status completion acquires `FOR UPDATE`. Locks mutually serialize. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **4** | **Safe Cascade Deletion** | Trigger `BEFORE DELETE` on completed versions and chunks blocked legitimate document cascade deletions (`ON DELETE CASCADE`). | Triggers verify parent document existence (`SELECT EXISTS(SELECT 1 FROM ai_documents WHERE id = ...)`). When a parent document is deleted, the cascade delete proceeds unimpeded. Direct deletion of completed versions or chunks is blocked. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **5** | **Watchdog Recovery Outbox Ordering** | Watchdog called `boss.send` before committing PostgreSQL retry state, risking duplicate or outbox split-brain dispatches. | Section 4.2 enforces strict **Committed-Outbox Boundary**: DB transaction updates `status = 'PENDING'`, advances `retry_count` and `claim_token`, sets `dispatch_status = 'OUTBOX_PENDING'`, and **COMMITS** before `boss.send` is invoked with versioned singleton key. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **6** | **Final Worker Lease Validation** | Worker's final `UPDATE ai_generation_jobs SET status = 'COMPLETED'` did not verify unexpired lease or check `rowCount`, allowing stale workers to finalize jobs after timeout. | Section 5.2 enforces `lease_expires_at > clock_timestamp()` and `status = 'PROCESSING'` on the final completion `UPDATE`. If the lease expired during artifact persistence, `rowCount === 0`, throwing `FencingTokenExpiredError` and executing a full `ROLLBACK`. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **7** | **Active-Version Composite FK** | Composite FK `(active_version_id, id)` referencing `(id, document_id)` with generic `ON DELETE SET NULL` failed because `id` is primary key and cannot be NULL. | Configured PostgreSQL 16 targeted column syntax: `ON DELETE SET NULL (active_version_id)`. Correctly nullifies the pointer without violating PK constraints. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **8** | **Single Recovery Authority** | Competing retry mechanisms between `pg-boss` automatic retries and the Application Watchdog caused race conditions. | Configured `pg-boss` with `retryLimit: 0`. The Application Watchdog is established as the sole authoritative recovery coordinator. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **9** | **Real-Time Wall Clock Evaluation** | Using PostgreSQL `NOW()` evaluated transaction-start time, failing to account for lock wait delays during heartbeat and lease validation. | Replaced `NOW()` with **`clock_timestamp()`** across all worker fencing checks, lease expirations, heartbeats, and completion validations. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **10**| **Regression Baseline Discrepancy** | Ambiguity between Phase 1.5 and 1.6 regarding test file attribution for 3 console shortcut failures. | Confirmed via empirical log `task-40102.log` that `backend/tests/httpInspector.test.js` (lines 288, 295, 301) is the sole location of the 3 console shortcut failures (1,086 pass / 4 fail out of 1,090). | `RUNTIME VERIFIED — EVIDENCE ATTACHED` |
| **11**| **Safe pg-boss Singleton Reconciliation** | Blindly treating `boss.send() === null` as queued or blindly creating attempts risked invalid re-enqueueing of completed/failed jobs. | Implemented dual-state reconciliation (`ai_generation_jobs` + `pgboss.job`) under `FOR UPDATE`. Completed/failed jobs never re-enqueued; sole Watchdog retry authority preserved. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **12**| **Persistent RTM Cross-Project Integrity** | Parent relationship updates (requirements, suites, scenarios, cases, documents) after RTM insert could break cross-project consistency. | Added `trg_prevent_parent_cross_project_reassignment` and `FOR SHARE` locking across requirements, suites, scenarios, test cases, and documents; blocks invalid reassignments while preserving declarative FK cascade deletions. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **13**| **Nullable RTM Test Case Support** | Trigger failed with FK violation when `test_case_id IS NULL`, preventing valid requirement extraction/gap traceability records. | Updated `trg_enforce_rtm_project_integrity` to explicitly validate requirement and chunk ownership while skipping test case hierarchy when `test_case_id IS NULL`. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **14**| **Document Ownership-Chain Lifecycle Protection** | Trigger protected only `ai_documents.project_id`, leaving chunks vulnerable to cross-project reassignment via updates to `ai_document_chunks.version_id` or `ai_document_versions.document_id`. | Added Checks 6 and 7 to `trg_prevent_parent_cross_project_reassignment` and attached triggers `trg_chunk_version_reassign` and `trg_version_doc_reassign`. Defined hierarchical locking order, `40P01` backoff retry, and Scenarios C.14–C.17. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **15**| **Explicit Row-Locking Order in RTM Integrity** | Joined queries (`FOR SHARE OF d, v, c` and `FOR SHARE OF s, sc, tc`) relied on query-planner-selected join execution order rather than guaranteed row-lock acquisition hierarchy. | Replaced multi-table joined queries with separate, explicit sequential row-locking statements strictly executing in order (1: documents, 2: versions, 3: chunks, 4: requirements, 5: suites, 6: scenarios, 7: test cases, 8: rtm). | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **16**| **Parent Reassignment Locking Protocols & Deadlock Rollback** | Design asserted lock order guarantees on parent updates without defining statement-level lock acquisition order, full rollback mechanics, or non-retryable integrity errors. | Defined locking protocol for all 7 parent reassignment operations, documented exact PostgreSQL statement-level acquisition limitations, and formalized mandatory `ROLLBACK`, fresh client renewal, and non-retryable errors (`23514`, `23503`, `23505`). | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **17**| **Unified Durable Outbox Dispatcher, Claiming, and Terminal State Closure** | Ambiguity between inline dispatch, watchdog recovery, and standalone outbox dispatcher; lack of dispatcher claim mechanics and terminal state transitions left jobs stranded in `OUTBOX_PENDING`. | Established Durable Outbox Dispatcher as single authoritative dispatch engine; defined transaction-scoped claiming (`FOR UPDATE SKIP LOCKED`) and documented schema limitations; enforced terminal state transitions (`COMPLETED` -> `DISPATCHED`, `FAILED`/`CANCELLED` -> `FAILED`) to permanently close outbox lifecycle. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |

---

## 3. Database Integrity Rules & Authoritative DDL

### 3.1 Complete 16-Table Reconciled DDL (`qa_ai_platform`)

```sql
-- ============================================================================
-- AUTHORITATIVE DDL FOR AI TEST CASE WRITER (qa_ai_platform)
-- Database: PostgreSQL 16 | Port: 5432 | Isolated from pg-mem / auth_db.json
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Schema Migration History
CREATE TABLE IF NOT EXISTS ai_schema_migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Embedding Configuration (Strict Single-Active Model with History)
CREATE TABLE IF NOT EXISTS ai_embedding_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'OLLAMA' CHECK (provider IN ('OLLAMA', 'LOCAL')),
    dimensions INT NOT NULL CHECK (dimensions = 768),
    context_window INT NOT NULL DEFAULT 8192 CHECK (context_window > 0),
    distance_metric VARCHAR(50) NOT NULL DEFAULT 'cosine' CHECK (distance_metric IN ('cosine')),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_embedding_config_single_active 
    ON ai_embedding_config (is_active) 
    WHERE is_active = TRUE;

-- 3. Projects (Option B: Creator + Platform Admin)
CREATE TABLE IF NOT EXISTS ai_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    app_package_name VARCHAR(255),
    pms_project_id VARCHAR(100),
    mixpanel_project_id VARCHAR(100),
    created_by_user_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    settings JSONB NOT NULL DEFAULT '{
        "default_priority": "MEDIUM",
        "require_human_review": true,
        "inference_model": "qwen2.5:3b-instruct"
    }',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_proj_creator ON ai_projects(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_ai_proj_status ON ai_projects(status);

-- 4. Documents (Permanent Entity)
CREATE TABLE IF NOT EXISTS ai_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('PDF', 'DOCX', 'XLSX', 'CSV', 'TXT')),
    active_version_id UUID,
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_docs_project ON ai_documents(project_id);

-- 5. Document Versions (Immutable Revisions with Model Pinning)
CREATE TABLE IF NOT EXISTS ai_document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
    version_number INT NOT NULL CHECK (version_number > 0),
    sha256_hash VARCHAR(64) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    storage_path VARCHAR(512) NOT NULL,
    indexing_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' 
        CHECK (indexing_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    embedding_model_id UUID REFERENCES ai_embedding_config(id) ON DELETE RESTRICT,
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

-- Circular FK for Authoritative Active Version (Targeted SET NULL on active_version_id only)
ALTER TABLE ai_documents 
    DROP CONSTRAINT IF EXISTS fk_active_doc_version,
    DROP CONSTRAINT IF EXISTS fk_active_doc_version_ownership;

ALTER TABLE ai_documents 
    ADD CONSTRAINT fk_active_doc_version_ownership 
        FOREIGN KEY (active_version_id, id) 
        REFERENCES ai_document_versions(id, document_id) 
        ON DELETE SET NULL (active_version_id);

-- 6. Document Chunks (Version-Isolated with Composite Key)
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

-- 7. Document Embeddings (Fixed 768-dim with Composite FK)
CREATE TABLE IF NOT EXISTS ai_document_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL,
    version_id UUID NOT NULL,
    model_id UUID NOT NULL REFERENCES ai_embedding_config(id) ON DELETE RESTRICT,
    embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chunk_model UNIQUE (chunk_id, model_id),
    CONSTRAINT fk_embedding_chunk_version FOREIGN KEY (chunk_id, version_id)
        REFERENCES ai_document_chunks(id, version_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON ai_document_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_version_model ON ai_document_embeddings(version_id, model_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw_cosine 
    ON ai_document_embeddings USING hnsw (embedding vector_cosine_ops);

-- 8. Application-Level Job Tracking (With Fencing Tokens & Outbox)
CREATE TABLE IF NOT EXISTS ai_generation_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    job_type VARCHAR(50) NOT NULL 
        CHECK (job_type IN ('INDEX_DOCUMENT', 'GENERATE_TEST_CASES', 'REINDEX_DOCUMENT', 'EXPORT_SUITE')),
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' 
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED')),
    dispatch_status VARCHAR(50) NOT NULL DEFAULT 'OUTBOX_PENDING' 
        CHECK (dispatch_status IN ('OUTBOX_PENDING', 'DISPATCHED', 'FAILED')),
    pgboss_job_id UUID,
    idempotency_key VARCHAR(128),
    claim_token UUID NOT NULL DEFAULT gen_random_uuid(),
    lease_expires_at TIMESTAMPTZ,
    worker_id VARCHAR(100),
    version INT NOT NULL DEFAULT 1,
    progress_percent INT NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
    current_stage VARCHAR(100) NOT NULL DEFAULT 'QUEUED',
    error_message TEXT,
    internal_diagnostics JSONB,
    retry_count INT NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
    max_retries INT NOT NULL DEFAULT 3 CHECK (max_retries >= 0),
    payload JSONB NOT NULL DEFAULT '{}',
    result_reference JSONB NOT NULL DEFAULT '{}',
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ai_jobs_id_project UNIQUE (id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_project_status ON ai_generation_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_heartbeat ON ai_generation_jobs(status, lease_expires_at) WHERE status = 'PROCESSING';
CREATE INDEX IF NOT EXISTS idx_ai_jobs_outbox ON ai_generation_jobs(dispatch_status, created_at) WHERE dispatch_status = 'OUTBOX_PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_jobs_idempotency ON ai_generation_jobs (idempotency_key) WHERE status IN ('PENDING', 'PROCESSING', 'COMPLETED');

-- 9. Requirements Decomposition
CREATE TABLE IF NOT EXISTS ai_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    req_key VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'FUNCTIONAL',
    priority VARCHAR(50) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DRAFT', 'DEPRECATED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_req UNIQUE (project_id, req_key),
    CONSTRAINT uq_ai_req_id_project UNIQUE (id, project_id)
);
CREATE INDEX IF NOT EXISTS idx_ai_req_project ON ai_requirements(project_id);

-- 10. Test Suites (With Project-Scoped Job Constraint)
CREATE TABLE IF NOT EXISTS ai_test_suites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    job_id UUID UNIQUE,
    suite_key VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    objective TEXT,
    target_module VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' 
        CHECK (status IN ('DRAFT', 'GENERATING', 'REVIEW_PENDING', 'APPROVED', 'ARCHIVED')),
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_suite UNIQUE (project_id, suite_key),
    CONSTRAINT uq_ai_suites_id_project UNIQUE (id, project_id),
    CONSTRAINT fk_suite_job_project FOREIGN KEY (job_id, project_id)
        REFERENCES ai_generation_jobs(id, project_id) ON DELETE SET NULL (job_id)
);
CREATE INDEX IF NOT EXISTS idx_suites_proj ON ai_test_suites(project_id);

-- 11. Test Scenarios
CREATE TABLE IF NOT EXISTS ai_test_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id UUID NOT NULL REFERENCES ai_test_suites(id) ON DELETE CASCADE,
    scenario_key VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    scenario_type VARCHAR(50) NOT NULL DEFAULT 'FUNCTIONAL' 
        CHECK (scenario_type IN ('FUNCTIONAL', 'EDGE_CASE', 'SECURITY', 'PERFORMANCE', 'USABILITY', 'INTEGRATION', 'NEGATIVE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scen_suite ON ai_test_scenarios(suite_id);

-- 12. Detailed Test Cases
CREATE TABLE IF NOT EXISTS ai_test_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id UUID NOT NULL REFERENCES ai_test_scenarios(id) ON DELETE CASCADE,
    test_case_key VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    priority VARCHAR(50) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    source_classification VARCHAR(50) NOT NULL DEFAULT 'DIRECT_REQUIREMENT' 
        CHECK (source_classification IN ('DIRECT_REQUIREMENT', 'INFERRED', 'EDGE_CASE', 'USER_SPECIFIED')),
    preconditions TEXT,
    test_steps JSONB NOT NULL DEFAULT '[]',
    expected_result TEXT NOT NULL,
    actual_result TEXT,
    evidence_references JSONB NOT NULL DEFAULT '[]',
    execution_status VARCHAR(50) NOT NULL DEFAULT 'UNTESTED' 
        CHECK (execution_status IN ('UNTESTED', 'PASSED', 'FAILED', 'BLOCKED', 'SKIPPED')),
    review_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' 
        CHECK (review_status IN ('PENDING', 'ACCEPTED', 'MODIFIED', 'REJECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tc_scenario ON ai_test_cases(scenario_id);
CREATE INDEX IF NOT EXISTS idx_tc_source ON ai_test_cases(source_classification);
CREATE INDEX IF NOT EXISTS idx_tc_review ON ai_test_cases(review_status);

-- 13. QA Checklists
CREATE TABLE IF NOT EXISTS ai_qa_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id UUID NOT NULL REFERENCES ai_test_suites(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklists_suite ON ai_qa_checklists(suite_id);

-- 14. Requirement Traceability Matrix (RTM)
CREATE TABLE IF NOT EXISTS ai_requirement_traceability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requirement_id UUID NOT NULL REFERENCES ai_requirements(id) ON DELETE CASCADE,
    test_case_id UUID REFERENCES ai_test_cases(id) ON DELETE CASCADE,
    chunk_id UUID REFERENCES ai_document_chunks(id) ON DELETE SET NULL,
    trace_type VARCHAR(50) NOT NULL DEFAULT 'DIRECT_COVERAGE' 
        CHECK (trace_type IN ('DIRECT_COVERAGE', 'INFERRED_COVERAGE', 'NEGATIVE_COVERAGE')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_rtm_req_tc UNIQUE (requirement_id, test_case_id)
);
CREATE INDEX IF NOT EXISTS idx_rtm_req ON ai_requirement_traceability(requirement_id);
CREATE INDEX IF NOT EXISTS idx_rtm_tc ON ai_requirement_traceability(test_case_id);

-- 15. Generation History (With Project-Scoped Suite and Job Constraints)
CREATE TABLE IF NOT EXISTS ai_generation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    suite_id UUID,
    job_id UUID,
    user_id UUID NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    prompt_tokens INT CHECK (prompt_tokens >= 0),
    completion_tokens INT CHECK (completion_tokens >= 0),
    total_duration_ms INT CHECK (total_duration_ms >= 0),
    system_prompt TEXT NOT NULL,
    user_prompt TEXT NOT NULL,
    retrieved_chunk_ids JSONB NOT NULL DEFAULT '[]',
    raw_response TEXT NOT NULL,
    parsed_json JSONB,
    validation_status VARCHAR(50) NOT NULL DEFAULT 'VALID' 
        CHECK (validation_status IN ('VALID', 'SCHEMA_ERROR', 'PARSE_ERROR', 'ABORTED')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_gen_hist_suite_project FOREIGN KEY (suite_id, project_id)
        REFERENCES ai_test_suites(id, project_id) ON DELETE SET NULL (suite_id),
    CONSTRAINT fk_gen_hist_job_project FOREIGN KEY (job_id, project_id)
        REFERENCES ai_generation_jobs(id, project_id) ON DELETE SET NULL (job_id)
);
CREATE INDEX IF NOT EXISTS idx_gen_hist_proj ON ai_generation_history(project_id);

-- 16. Human Review History
CREATE TABLE IF NOT EXISTS ai_human_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_case_id UUID NOT NULL REFERENCES ai_test_cases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    review_action VARCHAR(50) NOT NULL 
        CHECK (review_action IN ('APPROVED', 'MODIFIED', 'REJECTED', 'COMMENTED')),
    previous_state JSONB NOT NULL,
    updated_state JSONB NOT NULL,
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_tc ON ai_human_reviews(test_case_id);
```

---

### 3.2 Complete Immutability & Safe Cascade Triggers

The following triggers enforce absolute data integrity for completed versions while guaranteeing that legitimate document-level cascade deletions execute cleanly without trigger errors.

```sql
-- ============================================================================
-- 1. TRIGGER: Complete Row Immutability for ai_document_versions
-- Blocks ANY modification to metadata, status, or hashes once COMPLETED.
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_enforce_version_row_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.indexing_status = 'COMPLETED' THEN
        RAISE EXCEPTION 'VersionImmutableViolation: Version % is COMPLETED and immutable. No modifications to metadata or status are permitted.',
            OLD.id USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_version_row_immutability
BEFORE UPDATE ON ai_document_versions
FOR EACH ROW EXECUTE FUNCTION trg_enforce_version_row_immutability();


-- ============================================================================
-- 2. TRIGGER: Chunks and Embeddings Immutability with Safe Cascade Detection
-- Validates both OLD and NEW version references; permits cascade if parent doc is deleted.
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_enforce_version_immutability()
RETURNS TRIGGER AS $$
DECLARE
    v_old_status VARCHAR(50);
    v_new_status VARCHAR(50);
    v_doc_exists BOOLEAN;
BEGIN
    -- On DELETE: Prevent direct chunk/embedding deletion from completed versions.
    -- Allows deletion ONLY if the parent document was deleted (cascade deletion).
    IF TG_OP = 'DELETE' THEN
        SELECT EXISTS(
            SELECT 1 FROM ai_documents d 
            JOIN ai_document_versions v ON v.document_id = d.id 
            WHERE v.id = OLD.version_id
        ) INTO v_doc_exists;

        -- If parent document still exists, this is a direct deletion attempt:
        IF v_doc_exists THEN
            SELECT indexing_status INTO v_old_status FROM ai_document_versions WHERE id = OLD.version_id;
            IF v_old_status = 'COMPLETED' THEN
                RAISE EXCEPTION 'VersionImmutableViolation: Cannot directly delete records from COMPLETED version %.',
                    OLD.version_id USING ERRCODE = '23514';
            END IF;
        END IF;
        RETURN OLD;
    END IF;

    -- On UPDATE: Verify OLD version was not COMPLETED (prevents moving away from completed)
    IF TG_OP = 'UPDATE' THEN
        SELECT indexing_status INTO v_old_status FROM ai_document_versions WHERE id = OLD.version_id;
        IF v_old_status = 'COMPLETED' THEN
            RAISE EXCEPTION 'VersionImmutableViolation: Cannot update records belonging to COMPLETED version %.',
                OLD.version_id USING ERRCODE = '23514';
        END IF;
    END IF;

    -- On INSERT or UPDATE: Verify NEW version is not COMPLETED (prevents inserting into completed)
    -- Also acquires FOR SHARE row lock on parent version to serialize against concurrent status completion.
    IF TG_OP IN ('INSERT', 'UPDATE') THEN
        SELECT indexing_status INTO v_new_status 
        FROM ai_document_versions 
        WHERE id = NEW.version_id 
        FOR SHARE;

        IF v_new_status IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Referenced version % does not exist.', NEW.version_id USING ERRCODE = '23503';
        END IF;

        IF v_new_status = 'COMPLETED' THEN
            RAISE EXCEPTION 'VersionImmutableViolation: Cannot insert or assign records into COMPLETED version %.',
                NEW.version_id USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_chunks_immutability
BEFORE INSERT OR UPDATE OR DELETE ON ai_document_chunks
FOR EACH ROW EXECUTE FUNCTION trg_enforce_version_immutability();

CREATE TRIGGER trg_embeddings_immutability
BEFORE INSERT OR UPDATE OR DELETE ON ai_document_embeddings
FOR EACH ROW EXECUTE FUNCTION trg_enforce_version_immutability();


-- ============================================================================
-- 3. TRIGGER: Protect Completed Versions Against Direct Deletion
-- Allows deletion ONLY when parent document is deleted (cascade delete).
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_protect_completed_version_delete()
RETURNS TRIGGER AS $$
DECLARE
    v_doc_exists BOOLEAN;
BEGIN
    IF OLD.indexing_status = 'COMPLETED' THEN
        SELECT EXISTS(SELECT 1 FROM ai_documents WHERE id = OLD.document_id) INTO v_doc_exists;
        IF v_doc_exists THEN
            RAISE EXCEPTION 'VersionDeleteViolation: Cannot directly delete COMPLETED version %. Delete the parent document to remove all revisions.',
                OLD.id USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_version_delete_protection
BEFORE DELETE ON ai_document_versions
FOR EACH ROW EXECUTE FUNCTION trg_protect_completed_version_delete();


-- ============================================================================
-- 4. TRIGGER: RTM Traceability Integrity with Explicit Sequential Row Locking
-- Enforces strict top-down lock acquisition order (documents -> versions -> chunks ->
-- reqs -> suites -> scenarios -> cases -> rtm).
-- Does NOT rely on multi-table JOIN lock acquisition order.
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_enforce_rtm_project_integrity()
RETURNS TRIGGER AS $$
DECLARE
    -- Document hierarchy keys & project
    v_chunk_ver_id UUID;
    v_chunk_doc_id UUID;
    v_chunk_project_id UUID;
    v_verify_doc_id UUID;
    v_verify_ver_id UUID;

    -- Requirement hierarchy project
    v_req_project_id UUID;

    -- Test case hierarchy keys & project
    v_tc_scen_id UUID;
    v_tc_suite_id UUID;
    v_tc_project_id UUID;
    v_verify_suite_id UUID;
    v_verify_scen_id UUID;
BEGIN
    -- =========================================================================
    -- HIERARCHICAL ROW LOCKING PROTOCOL
    -- Strict Lock Acquisition Order:
    -- 1. ai_documents
    -- 2. ai_document_versions
    -- 3. ai_document_chunks
    -- 4. ai_requirements
    -- 5. ai_test_suites
    -- 6. ai_test_scenarios
    -- 7. ai_test_cases
    -- 8. ai_requirement_traceability (locked by initiating statement)
    -- =========================================================================

    -- -------------------------------------------------------------------------
    -- PHASE 1: Document Ownership Chain (Levels 1 -> 2 -> 3)
    -- -------------------------------------------------------------------------
    IF NEW.chunk_id IS NOT NULL THEN
        -- Step 1.0: Traverse foreign keys up to root document without locks to determine IDs
        SELECT version_id INTO v_chunk_ver_id 
        FROM ai_document_chunks 
        WHERE id = NEW.chunk_id;

        IF v_chunk_ver_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Document chunk % does not exist.', NEW.chunk_id USING ERRCODE = '23503';
        END IF;

        SELECT document_id INTO v_chunk_doc_id 
        FROM ai_document_versions 
        WHERE id = v_chunk_ver_id;

        IF v_chunk_doc_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Version % for chunk % does not exist.', v_chunk_ver_id, NEW.chunk_id USING ERRCODE = '23503';
        END IF;

        -- Step 1.1: Lock Level 1 (ai_documents)
        SELECT project_id INTO v_chunk_project_id 
        FROM ai_documents 
        WHERE id = v_chunk_doc_id 
        FOR SHARE;

        IF v_chunk_project_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Document % does not exist or was concurrently deleted.', v_chunk_doc_id USING ERRCODE = '23503';
        END IF;

        -- Step 1.2: Lock Level 2 (ai_document_versions) and validate linkage to locked Level 1
        SELECT document_id INTO v_verify_doc_id 
        FROM ai_document_versions 
        WHERE id = v_chunk_ver_id 
        FOR SHARE;

        IF v_verify_doc_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Document version % does not exist or was concurrently deleted.', v_chunk_ver_id USING ERRCODE = '23503';
        END IF;

        IF v_verify_doc_id IS DISTINCT FROM v_chunk_doc_id THEN
            RAISE EXCEPTION 'ConcurrentMutationDetected: Version % re-parented during lock acquisition.', v_chunk_ver_id USING ERRCODE = '40001';
        END IF;

        -- Step 1.3: Lock Level 3 (ai_document_chunks) and validate linkage to locked Level 2
        SELECT version_id INTO v_verify_ver_id 
        FROM ai_document_chunks 
        WHERE id = NEW.chunk_id 
        FOR SHARE;

        IF v_verify_ver_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Document chunk % does not exist or was concurrently deleted.', NEW.chunk_id USING ERRCODE = '23503';
        END IF;

        IF v_verify_ver_id IS DISTINCT FROM v_chunk_ver_id THEN
            RAISE EXCEPTION 'ConcurrentMutationDetected: Chunk % re-parented during lock acquisition.', NEW.chunk_id USING ERRCODE = '40001';
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- PHASE 2: Requirement Entity (Level 4)
    -- -------------------------------------------------------------------------
    -- Step 2.1: Lock Level 4 (ai_requirements)
    SELECT project_id INTO v_req_project_id 
    FROM ai_requirements 
    WHERE id = NEW.requirement_id 
    FOR SHARE;

    IF v_req_project_id IS NULL THEN
        RAISE EXCEPTION 'ForeignKeyViolation: Requirement % does not exist.', NEW.requirement_id USING ERRCODE = '23503';
    END IF;

    -- Validate Document Chunk vs Requirement project match
    IF NEW.chunk_id IS NOT NULL THEN
        IF v_chunk_project_id IS DISTINCT FROM v_req_project_id THEN
            RAISE EXCEPTION 'CrossProjectIntegrityViolation: Requirement % (project %) and Chunk % (project %) belong to different projects.',
                NEW.requirement_id, v_req_project_id, NEW.chunk_id, v_chunk_project_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    -- -------------------------------------------------------------------------
    -- PHASE 3: Test Case Hierarchy (Levels 5 -> 6 -> 7)
    -- -------------------------------------------------------------------------
    -- Requirement-only traceability (test_case_id IS NULL) is valid; skips test case checks.
    IF NEW.test_case_id IS NOT NULL THEN
        -- Step 3.0: Traverse foreign keys up to root test suite without locks to determine IDs
        SELECT scenario_id INTO v_tc_scen_id 
        FROM ai_test_cases 
        WHERE id = NEW.test_case_id;

        IF v_tc_scen_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Test Case % does not exist.', NEW.test_case_id USING ERRCODE = '23503';
        END IF;

        SELECT suite_id INTO v_tc_suite_id 
        FROM ai_test_scenarios 
        WHERE id = v_tc_scen_id;

        IF v_tc_suite_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Scenario % for test case % does not exist.', v_tc_scen_id, NEW.test_case_id USING ERRCODE = '23503';
        END IF;

        -- Step 3.1: Lock Level 5 (ai_test_suites)
        SELECT project_id INTO v_tc_project_id 
        FROM ai_test_suites 
        WHERE id = v_tc_suite_id 
        FOR SHARE;

        IF v_tc_project_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Test suite % does not exist or was concurrently deleted.', v_tc_suite_id USING ERRCODE = '23503';
        END IF;

        -- Step 3.2: Lock Level 6 (ai_test_scenarios) and validate linkage to locked Level 5
        SELECT suite_id INTO v_verify_suite_id 
        FROM ai_test_scenarios 
        WHERE id = v_tc_scen_id 
        FOR SHARE;

        IF v_verify_suite_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Scenario % does not exist or was concurrently deleted.', v_tc_scen_id USING ERRCODE = '23503';
        END IF;

        IF v_verify_suite_id IS DISTINCT FROM v_tc_suite_id THEN
            RAISE EXCEPTION 'ConcurrentMutationDetected: Scenario % re-parented during lock acquisition.', v_tc_scen_id USING ERRCODE = '40001';
        END IF;

        -- Step 3.3: Lock Level 7 (ai_test_cases) and validate linkage to locked Level 6
        SELECT scenario_id INTO v_verify_scen_id 
        FROM ai_test_cases 
        WHERE id = NEW.test_case_id 
        FOR SHARE;

        IF v_verify_scen_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Test case % does not exist or was concurrently deleted.', NEW.test_case_id USING ERRCODE = '23503';
        END IF;

        IF v_verify_scen_id IS DISTINCT FROM v_tc_scen_id THEN
            RAISE EXCEPTION 'ConcurrentMutationDetected: Test case % re-parented during lock acquisition.', NEW.test_case_id USING ERRCODE = '40001';
        END IF;

        -- Validate Test Case vs Requirement project match
        IF v_req_project_id IS DISTINCT FROM v_tc_project_id THEN
            RAISE EXCEPTION 'CrossProjectIntegrityViolation: Requirement % (project %) and Test Case % (project %) belong to different projects.',
                NEW.requirement_id, v_req_project_id, NEW.test_case_id, v_tc_project_id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_rtm_project_integrity
BEFORE INSERT OR UPDATE ON ai_requirement_traceability
FOR EACH ROW EXECUTE FUNCTION trg_enforce_rtm_project_integrity();


-- ============================================================================
-- 5. TRIGGER: Prevent Parent Reassignment from Breaking Active RTM Records
-- Blocks project/parent updates on requirements, suites, scenarios, test cases,
-- documents, document versions, and chunks that would invalidate existing RTM relationships.
-- ============================================================================
CREATE OR REPLACE FUNCTION trg_prevent_parent_cross_project_reassignment()
RETURNS TRIGGER AS $$
DECLARE
    v_old_proj UUID;
    v_new_proj UUID;
BEGIN
    -- Check 1: On ai_requirements, project_id cannot be changed if RTM records link to test cases OR chunks
    IF TG_TABLE_NAME = 'ai_requirements' THEN
        IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
            IF EXISTS (
                SELECT 1 FROM ai_requirement_traceability 
                WHERE requirement_id = OLD.id 
                  AND (test_case_id IS NOT NULL OR chunk_id IS NOT NULL)
            ) THEN
                RAISE EXCEPTION 'ParentReassignmentViolation: Cannot reassign project_id of requirement % while active RTM links (test cases or chunks) exist.',
                    OLD.id USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    -- Check 2: On ai_test_suites, project_id cannot be changed if test cases under this suite are in RTM
    IF TG_TABLE_NAME = 'ai_test_suites' THEN
        IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
            IF EXISTS (
                SELECT 1 FROM ai_requirement_traceability rtm
                JOIN ai_test_cases tc ON tc.id = rtm.test_case_id
                JOIN ai_test_scenarios sc ON sc.id = tc.scenario_id
                WHERE sc.suite_id = OLD.id
            ) THEN
                RAISE EXCEPTION 'ParentReassignmentViolation: Cannot reassign project_id of test suite % while active RTM records reference its test cases.',
                    OLD.id USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    -- Check 3: On ai_test_scenarios, cannot be moved to a suite in a different project if cases are in RTM
    IF TG_TABLE_NAME = 'ai_test_scenarios' THEN
        IF OLD.suite_id IS DISTINCT FROM NEW.suite_id THEN
            SELECT project_id INTO v_old_proj FROM ai_test_suites WHERE id = OLD.suite_id;
            SELECT project_id INTO v_new_proj FROM ai_test_suites WHERE id = NEW.suite_id;
            IF v_old_proj IS DISTINCT FROM v_new_proj THEN
                IF EXISTS (
                    SELECT 1 FROM ai_requirement_traceability rtm
                    JOIN ai_test_cases tc ON tc.id = rtm.test_case_id
                    WHERE tc.scenario_id = OLD.id
                ) THEN
                    RAISE EXCEPTION 'ParentReassignmentViolation: Cannot move scenario % to a suite in another project while active RTM records reference its test cases.',
                        OLD.id USING ERRCODE = '23514';
                END IF;
            END IF;
        END IF;
    END IF;

    -- Check 4: On ai_test_cases, cannot be moved to a scenario in a different project if referenced in RTM
    IF TG_TABLE_NAME = 'ai_test_cases' THEN
        IF OLD.scenario_id IS DISTINCT FROM NEW.scenario_id THEN
            SELECT s.project_id INTO v_old_proj FROM ai_test_scenarios sc JOIN ai_test_suites s ON s.id = sc.suite_id WHERE sc.id = OLD.scenario_id;
            SELECT s.project_id INTO v_new_proj FROM ai_test_scenarios sc JOIN ai_test_suites s ON s.id = sc.suite_id WHERE sc.id = NEW.scenario_id;
            IF v_old_proj IS DISTINCT FROM v_new_proj THEN
                IF EXISTS (SELECT 1 FROM ai_requirement_traceability WHERE test_case_id = OLD.id) THEN
                    RAISE EXCEPTION 'ParentReassignmentViolation: Cannot move test case % to a scenario in another project while active RTM records reference it.',
                        OLD.id USING ERRCODE = '23514';
                END IF;
            END IF;
        END IF;
    END IF;

    -- Check 5: On ai_documents, project_id cannot be changed if chunks belonging to this document are in RTM
    IF TG_TABLE_NAME = 'ai_documents' THEN
        IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
            IF EXISTS (
                SELECT 1 FROM ai_requirement_traceability rtm
                JOIN ai_document_chunks c ON c.id = rtm.chunk_id
                JOIN ai_document_versions v ON v.id = c.version_id
                WHERE v.document_id = OLD.id
            ) THEN
                RAISE EXCEPTION 'ParentReassignmentViolation: Cannot reassign project_id of document % while active RTM records reference its chunks.',
                    OLD.id USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    -- Check 6: On ai_document_chunks, version_id cannot be changed if the new version belongs to a document in another project and chunk is in RTM
    IF TG_TABLE_NAME = 'ai_document_chunks' THEN
        IF OLD.version_id IS DISTINCT FROM NEW.version_id THEN
            SELECT d.project_id INTO v_old_proj 
            FROM ai_document_versions v JOIN ai_documents d ON d.id = v.document_id WHERE v.id = OLD.version_id;
            SELECT d.project_id INTO v_new_proj 
            FROM ai_document_versions v JOIN ai_documents d ON d.id = v.document_id WHERE v.id = NEW.version_id;
            IF v_old_proj IS DISTINCT FROM v_new_proj THEN
                IF EXISTS (SELECT 1 FROM ai_requirement_traceability WHERE chunk_id = OLD.id) THEN
                    RAISE EXCEPTION 'ParentReassignmentViolation: Cannot reassign version_id of chunk % to a version in another project while active RTM records reference it.',
                        OLD.id USING ERRCODE = '23514';
                END IF;
            END IF;
        END IF;
    END IF;

    -- Check 7: On ai_document_versions, document_id cannot be changed if the new document belongs to another project and chunks under this version are in RTM
    IF TG_TABLE_NAME = 'ai_document_versions' THEN
        IF OLD.document_id IS DISTINCT FROM NEW.document_id THEN
            SELECT project_id INTO v_old_proj FROM ai_documents WHERE id = OLD.document_id;
            SELECT project_id INTO v_new_proj FROM ai_documents WHERE id = NEW.document_id;
            IF v_old_proj IS DISTINCT FROM v_new_proj THEN
                IF EXISTS (
                    SELECT 1 FROM ai_requirement_traceability rtm
                    JOIN ai_document_chunks c ON c.id = rtm.chunk_id
                    WHERE c.version_id = OLD.id
                ) THEN
                    RAISE EXCEPTION 'ParentReassignmentViolation: Cannot reassign document_id of version % to a document in another project while active RTM records reference its chunks.',
                        OLD.id USING ERRCODE = '23514';
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_req_project_reassign
BEFORE UPDATE OF project_id ON ai_requirements
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

CREATE TRIGGER trg_doc_project_reassign
BEFORE UPDATE OF project_id ON ai_documents
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

CREATE TRIGGER trg_version_doc_reassign
BEFORE UPDATE OF document_id ON ai_document_versions
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

CREATE TRIGGER trg_chunk_version_reassign
BEFORE UPDATE OF version_id ON ai_document_chunks
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

CREATE TRIGGER trg_suite_project_reassign
BEFORE UPDATE OF project_id ON ai_test_suites
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

CREATE TRIGGER trg_scen_suite_reassign
BEFORE UPDATE OF suite_id ON ai_test_scenarios
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

CREATE TRIGGER trg_tc_scen_reassign
BEFORE UPDATE OF scenario_id ON ai_test_cases
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();
```

---

### 3.3 Concurrency & Ingestion Serialization Protocol

To prevent any race condition where a background ingestion worker inserts chunks into a version while the version completion transaction transitions `indexing_status` to `'COMPLETED'`:

1. **Chunk Insertion Phase**:
   During chunk batch insertion, the trigger `trg_enforce_version_immutability` executes:
   ```sql
   SELECT indexing_status FROM ai_document_versions WHERE id = NEW.version_id FOR SHARE;
   ```
   This places a shared row lock (`FOR SHARE`) on the version row. Multiple chunk insert workers can concurrently hold `FOR SHARE` locks.
2. **Version Completion Phase**:
   When the ingestion job finishes and marks the version complete:
   ```sql
   BEGIN;
   -- 1. Acquire exclusive row lock on version
   SELECT id FROM ai_document_versions WHERE id = $1 FOR UPDATE;

   -- 2. Verify all chunks are accounted for and update status
   UPDATE ai_document_versions 
   SET indexing_status = 'COMPLETED', 
       indexed_at = clock_timestamp(), 
       total_chunks = $2 
   WHERE id = $1;
   COMMIT;
   ```
3. **Lock Mutual Exclusion**:
   - If chunks are being inserted, the `FOR UPDATE` lock blocks until chunk transactions commit.
   - Once the completion transaction acquires `FOR UPDATE` and commits `indexing_status = 'COMPLETED'`, any subsequent chunk insertion will wait for the commit, read `indexing_status = 'COMPLETED'`, and immediately fail with `VersionImmutableViolation`.
   - Once completed, the row update trigger `trg_version_row_immutability` prevents any subsequent changes to that version row.
4. **Explicit Row-Locking Requirement (No Assumed Join Order)**:
   - PostgreSQL joined queries (such as `SELECT ... FROM a JOIN b ... FOR SHARE OF a, b`) acquire locks in query-planner-determined execution order, NOT in the order declared in SQL text or schema hierarchy.
   - Therefore, multi-table row locking across parent and child entities MUST NEVER rely on joined queries.
   - All multi-table lock acquisitions must execute separate, explicit `SELECT ... FOR SHARE` or `SELECT ... FOR UPDATE` statements adhering strictly to the global lock hierarchy (Section 10.3).

---

## 4. Recovery and Outbox Rules (Committed Outbox Boundary & Single Dispatch Path)

### 4.1 Committed-Outbox Boundary & Single Authoritative Dispatch Path Protocol
To prevent orphan queue messages if a PostgreSQL transaction rolls back and eliminate split-brain races between route handlers, watchdog loops, and background sweepers:
1. **Database Commit First**: The generation job row is inserted and committed with `status = 'PENDING', dispatch_status = 'OUTBOX_PENDING', retry_count = 0` before any queue network call.
2. **Single Authoritative Dispatch Engine**: All initial dispatches (`attempt-0`) and retry dispatches (`attempt-N`) are executed through the **Durable Outbox Dispatcher** (`outboxDispatcher.dispatchJob(jobId)` or `outboxDispatcher.sweepPending()`). Ad-hoc, uncoordinated calls to `boss.send()` from route handlers or watchdog loops are strictly forbidden.
3. **Dispatch Sequence via Durable Dispatcher**:
   ```javascript
   // Step 1: Database Commit (Standalone Transaction in Route Handler)
   const job = await jobRepo.createJob({ projectId, userId, jobType, payload, idempotencyKey });

   // Step 2: Trigger Immediate Asynchronous Dispatch via Authoritative Dispatcher
   // (Non-blocking: if network fails or server restarts, durable outbox sweeper recovers it)
   outboxDispatcher.dispatchJob(job.id).catch((err) => {
     logger.warn({ jobId: job.id, err }, 'Initial dispatch deferred to durable outbox sweeper');
   });
   ```

---

### 4.2 Single Watchdog Recovery Authority & Outbox Ordering

The Application Watchdog is the **sole authority** for lease expiration, retry counting, and re-enqueue authorization. `pg-boss` retry limit is strictly `0`.

The Watchdog executes every 60 seconds following the strict **Committed-Outbox Boundary**:

```javascript
async function executeWatchdogSweep() {
  const client = await pool.connect();
  let recoverableJobs = [];

  try {
    // 1. Transaction: Identify and commit recovery state in PostgreSQL FIRST
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED');

    const expiredRes = await client.query(
      `SELECT id, retry_count, max_retries, pgboss_job_id 
       FROM ai_generation_jobs 
       WHERE status = 'PROCESSING' 
         AND lease_expires_at < clock_timestamp()
       ORDER BY lease_expires_at ASC 
       LIMIT 10 
       FOR UPDATE SKIP LOCKED`
    );

    for (const job of expiredRes.rows) {
      if (job.retry_count < job.max_retries) {
        const nextAttempt = job.retry_count + 1;
        const newClaimToken = crypto.randomUUID();

        // Increment retry count, advance fencing token, reset to OUTBOX_PENDING
        await client.query(
          `UPDATE ai_generation_jobs 
           SET status = 'PENDING',
               dispatch_status = 'OUTBOX_PENDING',
               retry_count = $1,
               claim_token = $2,
               lease_expires_at = NULL,
               worker_id = NULL,
               current_stage = 'RECOVERY_QUEUED',
               updated_at = clock_timestamp()
           WHERE id = $3`,
          [nextAttempt, newClaimToken, job.id]
        );

        recoverableJobs.push({ id: job.id, attempt: nextAttempt });
      } else {
        // Terminal Failure: Exceeded maximum retries
        // CRITICAL: Must transition dispatch_status to 'FAILED' to permanently close outbox lifecycle!
        await client.query(
          `UPDATE ai_generation_jobs 
           SET status = 'FAILED',
               dispatch_status = 'FAILED',
               completed_at = clock_timestamp(),
               error_message = 'Job timed out: Worker lease expired and maximum retries (3) exceeded.',
               current_stage = 'TIMEOUT_TERMINATED',
               lease_expires_at = NULL,
               worker_id = NULL,
               updated_at = clock_timestamp()
           WHERE id = $1`,
          [job.id]
        );
      }
    }

    // COMMIT database transaction BEFORE queue dispatch!
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // 2. Queue Dispatch: Delegated strictly to the Durable Outbox Dispatcher
  for (const job of recoverableJobs) {
    outboxDispatcher.dispatchJob(job.id).catch((dispatchErr) => {
      // Net error or restart: Remains OUTBOX_PENDING, recovered by durable outbox sweeper
    });
  }
}
```

---

## 5. Worker Transaction Rules & Mandatory Shared Client

### 5.1 The Shared Client Rule
All repository write operations that persist generated artifacts MUST accept a transactional `client` instance as their first parameter (`createSuite(client, ...)`). No repository write method is permitted to call `pool.query()` independently.

### 5.2 Atomic Artifact Persistence Sequence with Final Lease Validation

```javascript
async function persistGeneratedSuite({ jobId, claimToken, projectId, userId, generatedData }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED');

    // 1. Lock job row and verify fencing token and unexpired lease
    const jobRes = await client.query(
      `SELECT id, status, claim_token 
       FROM ai_generation_jobs 
       WHERE id = $1 
         AND claim_token = $2 
         AND status = 'PROCESSING' 
         AND lease_expires_at > clock_timestamp()
       FOR UPDATE`,
      [jobId, claimToken]
    );

    if (jobRes.rows.length === 0) {
      throw new FencingTokenExpiredError('Fencing check failed: lease expired or job was reclaimed.');
    }

    // 2. Persist Test Suite in THIS transaction
    const suite = await aiSuiteRepo.createSuite(client, {
      projectId,
      jobId,
      suiteKey: generatedData.suite_key,
      title: generatedData.title,
      targetModule: generatedData.target_module,
      status: 'DRAFT',
      userId
    });

    // 3. Persist Scenarios & Cases in THIS transaction
    for (const scen of generatedData.scenarios) {
      const scenario = await aiScenarioRepo.createScenario(client, { suiteId: suite.id, ...scen });
      for (const tc of scen.test_cases) {
        const testCase = await aiCaseRepo.createTestCase(client, { scenarioId: scenario.id, ...tc });
        // 4. Link Traceability in THIS transaction
        if (tc.requirement_id) {
          await aiTraceRepo.linkRequirement(client, { requirementId: tc.requirement_id, testCaseId: testCase.id });
        }
      }
    }

    // 5. Persist Checklists in THIS transaction
    await aiChecklistRepo.createChecklist(client, { suiteId: suite.id, items: generatedData.checklists });

    // 6. Record Generation History in THIS transaction
    await aiHistoryRepo.recordHistory(client, { projectId, suiteId: suite.id, jobId, userId, ...generatedData.history });

    // 7. Finalize Job to COMPLETED with final lease and fencing check
    const updateRes = await client.query(
      `UPDATE ai_generation_jobs 
       SET status = 'COMPLETED', 
           dispatch_status = 'DISPATCHED', 
           completed_at = clock_timestamp(), 
           result_reference = jsonb_build_object('suite_id', $1::uuid),
           progress_percent = 100, 
           current_stage = 'COMPLETED', 
           lease_expires_at = NULL,
           worker_id = NULL,
           updated_at = clock_timestamp()
       WHERE id = $2 
         AND claim_token = $3 
         AND status = 'PROCESSING' 
         AND lease_expires_at > clock_timestamp()`,
      [suite.id, jobId, claimToken]
    );

    // If the lease expired during artifact persistence, updateRes.rowCount === 0!
    if (updateRes.rowCount === 0) {
      throw new FencingTokenExpiredError(
        'Worker lease expired or job was reclaimed during artifact persistence. Rolling back all changes.'
      );
    }

    await client.query('COMMIT');
    return { success: true, suiteId: suite.id };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // Zero artifacts survive a failed commit
  } finally {
    client.release();
  }
}
```

---

## 6. Authorization Requirements (Option B & 24 Routes)

### 6.1 Policy Rules
- **Creator Access**: A project's creator (`ai_projects.created_by_user_id === req.user.id`) possesses full authority to view, upload, generate, activate, edit, and delete resources within their project.
- **Administrator Bypass**: Users with `req.user.role === 'ADMIN'` have global read/write access.
- **Ordinary Non-Owner Prohibition**: Non-admin users attempting to access another user's project or passing cross-project resource UUIDs receive `404 Not Found` (preventing ID enumeration).
- **Diagnostic Masking**: Technical stack traces in `internal_diagnostics` are stripped for non-admin users.

### 6.2 Traversal Scoping Mapping (24 Routes)
Every endpoint validates authorization before controller invocation:
```javascript
// Middleware: verifyProjectAccess
const isAuthorized = req.user.role === 'ADMIN' || project.created_by_user_id === req.user.id;
if (!isAuthorized) return res.status(404).json({ success: false, error: 'Project not found.' });
```
Project listing routes (`/documents`, `/jobs`, `/requirements`, `/suites`, `/search`) enforce `verifyProjectAccess` on `:projectId` before returning scoped records.

---

## 7. Reconciled Regression Baseline

### 7.1 Authoritative Baseline Metrics

| Metric | Measured Baseline | Verification Source | Verification Status |
| :--- | :--- | :--- | :--- |
| **Git Commit Hash** | `ba0d402ae2482bfc7f7c065ec9ab2e5503ddf200` | `git rev-parse HEAD` | `RUNTIME VERIFIED — EVIDENCE ATTACHED` |
| **Execution Command**| `cmd /c "npm test"` | `backend/package.json` (`node --test --test-concurrency=1 tests/**/*.test.js`) | `RUNTIME VERIFIED — EVIDENCE ATTACHED` |
| **Preserved Output** | `task-40102.log` | `C:\Users\Admin\.gemini\antigravity\brain\...\task-40102.log` | `RUNTIME VERIFIED — EVIDENCE ATTACHED` |
| **Test Suites** | **81 files** | `(Get-ChildItem -Path "backend/tests" -Filter "*.test.js" -Recurse).Count` = 81 | `RUNTIME VERIFIED — EVIDENCE ATTACHED` |
| **Total Tests** | **1,090 tests** | Exact test runner output line: `ℹ tests 1090` | `RUNTIME VERIFIED — EVIDENCE ATTACHED` |
| **Passing Tests** | **1,086 tests** | Exact test runner output line: `ℹ pass 1086` | `RUNTIME VERIFIED — EVIDENCE ATTACHED` |
| **Failing Tests** | **4 tests** | Exact test runner output line: `ℹ fail 4` | `RUNTIME VERIFIED — EVIDENCE ATTACHED` |

### 7.2 Exact Pre-Existing Failure Signatures
1. **`backend/tests/httpInspector.test.js:288:11`** — `LiveLogViewer component includes expand/minimize button with aria-labels and tooltips` (Regex mismatch on expand title).
2. **`backend/tests/httpInspector.test.js:295:11`** — `LiveLogViewer component includes dedicated close button in expanded mode` (Regex mismatch on close button).
3. **`backend/tests/httpInspector.test.js:301:11`** — `ESC keydown listener closes expanded overlay without resetting state` (Regex mismatch on ESC listener).
4. **`backend/tests/sopGuideVerification.test.js:6:1`** — `SOP Guide Content & Integrity Verification Suite` (ENOENT path discrepancy when run from `backend/`).

### 7.3 Milestone Comparison Rule
Phase 2 test runs pass only if:
1. `totalTests >= 1090` (Detects accidental test file or case deletion).
2. `passCount >= 1086` (Detects passing count degradation).
3. `actualFailures.filter(f => !KNOWN_FAILURES.has(f.signature)).length === 0` (Detects any new failure even if an old failure is fixed).

---

## 8. Host Prerequisites & Windows Installation

Before Phase 2 migrations can run:
1. **PostgreSQL 16**: Installed natively on Windows (`127.0.0.1:5432`).
2. **pgvector 0.8.0**: Compiled via MSVC Build Tools (`nmake /F Makefile.win install`) placed in `PostgreSQL\16\lib\vector.dll` and `PostgreSQL\16\share\extension\vector.control`.
3. **Ollama for Windows**: Installed with `OLLAMA_NUM_THREADS=3` and `OLLAMA_HOST=127.0.0.1:11434`. Models pulled: `nomic-embed-text` and `qwen2.5:3b-instruct`.
4. **Database Role Setup (`000_admin_init.sql`)**: Executed as superuser using `psql \getenv` and GUC session variables without hardcoded passwords.

---

## 9. Implementation Boundaries & Platform Isolation

1. **Isolation**: All new backend code resides strictly in `backend/src/modules/aiTestWriter/`.
2. **No Platform Regressions**: Zero modifications to existing files (`auth.js`, `userService.js`, `deviceRoutes.js`, `roboTestService.js`, `migrate.js`, `auth_db.json`).
3. **Existing DB Preserved**: `pg-mem` and `auth_db.json` continue serving all existing QA platform tools without interruption.

---

## 10. Phase 2 — Mandatory Implementation Requirements and Acceptance Gates

This section establishes the **non-negotiable reliability, concurrency, and data-integrity acceptance gates** that the Phase 2 implementation must satisfy. Implementation in Phase 2 will not be considered complete until automated test evidence is produced for every gate.

### 10.1 Gate A — Durable Outbox Dispatch, Claiming, and Crash Recovery

- **Gate ID:** `GATE-A-OUTBOX-RECOVERY`
- **Requirement:**
  The backend implementation must provide a durable outbox dispatcher that explicitly queries committed `OUTBOX_PENDING` records and dispatches them to `pg-boss`. The dispatcher acts as the **single authoritative dispatch engine** for both initial job dispatches (`attempt-0`) and Watchdog-authorized retries (`attempt-N`). Concurrency between multiple dispatcher instances must be safe, terminal application states must be strictly respected, and recovery must not depend on ad-hoc uncoordinated queue network calls.
- **Implementation Constraints:**

  #### 1. Single Authoritative Dispatch Engine
  - All transmissions to `pg-boss` (`boss.send`) are performed exclusively by the Durable Outbox Dispatcher.
  - Route handlers and Watchdog sweeps do not execute uncoordinated raw queue sends. Instead, after committing job state changes to PostgreSQL (`status = 'PENDING', dispatch_status = 'OUTBOX_PENDING'`), they delegate execution to `outboxDispatcher.dispatchJob(jobId)`.
  - If a route handler or Watchdog crashes before triggering the dispatcher, or if network connectivity is lost, the periodic outbox sweeper (`outboxDispatcher.sweepPending()`) automatically discovers and dispatches the pending outbox record.

  #### 2. Dispatcher Concurrency & Claiming Protocol
  - The periodic outbox sweeper runs every 10–15s executing the following atomic claim query:
    ```sql
    SELECT id, retry_count, idempotency_key, pgboss_job_id, status 
    FROM ai_generation_jobs 
    WHERE dispatch_status = 'OUTBOX_PENDING' 
    ORDER BY created_at ASC 
    LIMIT 20 
    FOR UPDATE SKIP LOCKED;
    ```
  - **Terminal-State Selection & In-Memory Reconcile:**
    By querying `WHERE dispatch_status = 'OUTBOX_PENDING'` without filtering out non-pending application statuses, the sweeper actively claims any job stranded in `OUTBOX_PENDING` regardless of its application lifecycle status:
    - If `status = 'COMPLETED'`: Reconciles immediately by updating `dispatch_status = 'DISPATCHED'` without queue interaction.
    - If `status IN ('FAILED', 'CANCELLED')`: Reconciles immediately by updating `dispatch_status = 'FAILED'` without queue interaction.
    - If `status = 'PROCESSING'`: The job is actively executing under an unexpired worker lease; sweeper skips queue dispatch.
    - If `status = 'PENDING'`: Proceeds with queue dispatch (`boss.send`) and Gate B dual-state reconciliation.
  - **Claim Ownership & Concurrency:** Concurrency is serialized via PostgreSQL's `FOR UPDATE SKIP LOCKED`. When multiple dispatcher instances run concurrently, each acquires a disjoint batch of pending rows. A second dispatcher automatically skips any row locked by an active dispatcher, preventing competing concurrent sends of the same attempt.
  - **Transaction-Scoped Claiming vs. Schema Limitations:**
    *Documented Schema Limitation:* The approved 16-table schema does NOT contain separate persistent dispatch lease columns (such as `dispatch_claimed_at` or `dispatch_claim_token`). The existing columns `claim_token`, `worker_id`, and `lease_expires_at` are reserved strictly for worker execution fencing (`status = 'PROCESSING'`). Overloading worker fencing columns for outbox dispatch is prohibited to prevent worker fencing corruption. Therefore, dispatcher claiming is transaction-scoped. A dispatcher opens a database transaction, claims rows via `FOR UPDATE SKIP LOCKED`, calls `boss.send()`, updates `dispatch_status = 'DISPATCHED'`, and commits.
  - **Claim Expiry & Crash Recovery:**
    - If a dispatcher crashes or disconnects while holding the transaction lock before calling `boss.send()`, PostgreSQL automatically aborts the transaction (`ROLLBACK`) and releases the row lock. The row remains `dispatch_status = 'OUTBOX_PENDING'` and is claimed by the next sweeper pass.
    - If a dispatcher crashes after `boss.send()` succeeds over the network but before committing `dispatch_status = 'DISPATCHED'`, the transaction lock is released. The next sweeper pass claims the row, re-invokes `boss.send()` with the identical versioned singleton key (`${job.id}-attempt-${job.retry_count}`), receives `null` due to singleton deduplication, and triggers **Gate B Dual-State Reconciliation** to confirm the job in `pgboss.job` and commit `dispatch_status = 'DISPATCHED'`. Zero duplicate dispatches occur.
  - **Strict Preservation of Retry Authority:** Dispatch claiming has zero authority to increment `retry_count` or generate a new attempt key. It only dispatches the currently authorized attempt.

  #### 3. Terminal State Outbox Closure
  - Jobs entering terminal states must never remain stranded in `OUTBOX_PENDING` or repeatedly selected by the outbox sweeper:
    - **`status = 'COMPLETED'`:** When a worker finalizes a job, the completion transaction sets `dispatch_status = 'DISPATCHED'` (Section 5.2). If encountered by the sweeper, it sets `dispatch_status = 'DISPATCHED'` without queue interaction.
    - **`status = 'FAILED'`:** When a job fails terminally (e.g., Watchdog timeout after maximum retries exhausted), the update transaction sets `status = 'FAILED'` and `dispatch_status = 'FAILED'`. If encountered by the sweeper, it sets `dispatch_status = 'FAILED'` without queue interaction.
    - **`status = 'CANCELLED'`:** When a job is cancelled by user/admin, the update transaction sets `status = 'CANCELLED'` and `dispatch_status = 'FAILED'`. If encountered by the sweeper, it sets `dispatch_status = 'FAILED'` without queue interaction.
  - Setting `dispatch_status` to `'DISPATCHED'` or `'FAILED'` removes the row from the partial index `idx_ai_jobs_outbox (WHERE dispatch_status = 'OUTBOX_PENDING')`, permanently closing the outbox lifecycle.

- **Required Test Scenarios:**
  - *Scenario A.1 (Crash Before Queue Send):* Process terminates immediately after PostgreSQL job insert commits (`dispatch_status = 'OUTBOX_PENDING'`) and before `boss.send()`. Outbox dispatcher sweeps and dispatches the job upon reboot.
  - *Scenario A.2 (Crash After Queue Send Before DB Commit):* Process terminates after `boss.send()` succeeds but before updating `dispatch_status = 'DISPATCHED'`. Next sweep reconciles the job via Gate B without re-dispatching duplicate work.
  - *Scenario A.3 (Watchdog Recovery Dispatch):* Watchdog commits retry state (`attempt-1`, `OUTBOX_PENDING`) but crashes before queue send. Outbox dispatcher recovers and dispatches `attempt-1`.
  - *Scenario A.4 (Idempotent Dispatch Sweeps):* Repeated dispatch sweeps on identical outbox jobs remain strictly idempotent.
  - *Scenario A.5 (Failed Job Encountered by Outbox Sweeper):* Job in `status = 'FAILED'` with `dispatch_status = 'OUTBOX_PENDING'` is scanned by sweeper; sweeper updates `dispatch_status = 'FAILED'` without calling `boss.send()`; job is never re-enqueued.
  - *Scenario A.6 (Cancelled Job Encountered by Outbox Sweeper):* Job in `status = 'CANCELLED'` with `dispatch_status = 'OUTBOX_PENDING'` is scanned by sweeper; sweeper updates `dispatch_status = 'FAILED'` without calling `boss.send()`; job is never re-enqueued.
  - *Scenario A.7 (Completed Job Encountered by Outbox Sweeper):* Job in `status = 'COMPLETED'` with `dispatch_status = 'OUTBOX_PENDING'` is scanned by sweeper; sweeper updates `dispatch_status = 'DISPATCHED'` without calling `boss.send()`; job is never re-enqueued.
  - *Scenario A.8 (Terminal Job Repeated Sweep Immunity):* Sweeper executed repeatedly against completed, failed, and cancelled jobs; zero network calls made to `pg-boss`; zero job re-activations.
  - *Scenario A.9 (Terminal Job Index Exclusion):* Verification that terminal transitions to `dispatch_status IN ('DISPATCHED', 'FAILED')` physically exclude jobs from `idx_ai_jobs_outbox` scans.
- **Acceptance Evidence:**
  Automated integration test suite verifying that 100% of simulated crash states and terminal states either reach `DISPATCHED` status or cleanly transition to a terminal `FAILED` status, with zero orphaned outbox records and zero duplicate executions.
- **Verification Status:** `DESIGN CORRECTED — NOT RUNTIME VERIFIED`

---

### 10.2 Gate B — Safe pg-boss Singleton Reconciliation

- **Gate ID:** `GATE-B-SINGLETON-RECONCILIATION`
- **Requirement:**
  The implementation must **never** interpret a `null` return value from `boss.send()` as proof that a job is successfully queued. It must explicitly reconcile **both**:
  1. The application job state in `ai_generation_jobs`.
  2. The corresponding queue job state in `pgboss.job`.
  Reconciliation must prevent invalid re-enqueueing of completed or terminally failed jobs, serialize concurrent dispatch attempts, and preserve the Application Watchdog as the sole retry authority (`retryLimit: 0`).
- **Implementation Constraints:**
  1. **Dual State Evaluation (Application + Queue):**
     - When `boss.send()` returns `null` (singleton key collision for key `${job.id}-attempt-${job.retry_count}`), the dispatcher serializes execution by locking the application job row:
       ```sql
       SELECT id, status, retry_count, max_retries, dispatch_status 
       FROM ai_generation_jobs 
       WHERE id = $1 
       FOR UPDATE;
       ```
     - Authoritative lookup in `pgboss.job`:
       ```sql
       SELECT id, state 
       FROM pgboss.job 
       WHERE name = 'ai-generation-queue' AND singletonkey = $1 
       LIMIT 1;
       ```
  2. **Strict Re-enqueueing & Terminal State Rules:**
     - **Completed Application Job:** If `ai_generation_jobs.status = 'COMPLETED'`, the job MUST NEVER be re-enqueued under any circumstances. If `dispatch_status` is `OUTBOX_PENDING` (e.g. sweeper pass after worker finished), update `dispatch_status = 'DISPATCHED'` without queue interaction.
     - **Cancelled or Terminally Failed Job:** If `ai_generation_jobs.status IN ('FAILED', 'CANCELLED')`, the job MUST NOT be re-enqueued. Update `dispatch_status = 'FAILED'` without queue interaction. Terminal application states are strictly respected.
     - **Active Processing Job:** If `ai_generation_jobs.status = 'PROCESSING'` with an active worker lease (`lease_expires_at > clock_timestamp()`), do NOT re-enqueue.
     - **Pending Job with Active Singleton:** If `ai_generation_jobs.status = 'PENDING'` and matching pg-boss job has `state IN ('created', 'active', 'retry')`: Confirm the job is legitimately queued. Record its `pgboss_job_id = existingJob.id` and update `dispatch_status = 'DISPATCHED'`. Zero duplicate dispatches.
     - **Pending Job with Stale Singleton or Missing Record:** If matching pg-boss job has `state IN ('completed', 'cancelled', 'failed')` or no record is found:
       - A stale pg-boss singleton must **not** automatically trigger a new attempt.
       - The dispatcher has **zero authority** to independently increment `retry_count` or generate a new attempt key (`attempt-N+1`).
       - A new attempt may be created **only** after confirming that the application job remains eligible for recovery and the existing Application Watchdog recovery rules authorize it.
       - If `job.retry_count >= job.max_retries`: Transition the job to terminal `FAILED` (`status = 'FAILED'`, `dispatch_status = 'FAILED'`, `error_message = 'Dispatch aborted: pg-boss singleton in terminal state and maximum retries exceeded.'`, `completed_at = clock_timestamp()`).
       - If `job.retry_count < job.max_retries`: Leave `dispatch_status = 'OUTBOX_PENDING'` for the Watchdog recovery sweep. The Watchdog alone evaluates whether the worker lease expired, increments `retry_count`, advances the claim token, and authorizes the new attempt key.
  3. **Concurrency Serialization:**
     - Reconciliation is serialized via `SELECT ... FOR UPDATE` on `ai_generation_jobs`.
     - Concurrent dispatch workers block on the row lock; the subsequent worker reads `dispatch_status = 'DISPATCHED'` (or `'FAILED'`) and safely no-ops.
  4. **Preservation of Watchdog as Sole Retry Authority:**
     - `pg-boss` configuration strictly maintains `retryLimit: 0`.
     - Dispatchers and sweepers perform idempotent dispatch of the *currently authorized* attempt only.
- **Required Test Scenarios:**
  - *Scenario B.1 (Active Singleton Matched):* Valid existing pg-boss job in `created`/`active` state correctly reconciled; outbox record marked `DISPATCHED` with matching `pgboss_job_id`.
  - *Scenario B.2 (Completed Application Job with Stale Singleton):* Application job is `COMPLETED` while pg-boss has stale singleton; dispatcher marks `DISPATCHED` and aborts re-enqueueing.
  - *Scenario B.3 (Failed Application Job with Stale Singleton):* Application job is `FAILED` with stale singleton; dispatcher marks `dispatch_status = 'FAILED'`, zero re-enqueue.
  - *Scenario B.4 (Pending Application Job with No Queue Record):* Application job is `PENDING` with no active queue record; dispatcher verifies eligibility; if collision with archived key occurs, defers to Watchdog retry authority without independent attempt increment.
  - *Scenario B.5 (Concurrent Reconciliation of Same Job and Attempt):* Two concurrent dispatch sweeps attempt to reconcile the same job and attempt; serialized via row lock without duplicate queue records.
  - *Scenario B.6 (Recovery-Authorized Retry after Watchdog Transition):* Watchdog authorizes retry, increments `retry_count = 1`, advances claim token; dispatcher dispatches `attempt-1` successfully.
- **Acceptance Evidence:**
  Automated integration tests demonstrating zero invalid re-enqueues on completed/failed jobs, serialized reconciliation without race conditions, and strict preservation of Watchdog sole retry authority.
- **Verification Status:** `DESIGN CORRECTED — NOT RUNTIME VERIFIED`

---

### 10.3 Gate C — Persistent Cross-Project Database Integrity & Lifecycle Protection

- **Gate ID:** `GATE-C-CROSS-PROJECT-INTEGRITY`
- **Requirement:**
  The database schema must enforce project ownership consistency across all entity relationships at the PostgreSQL constraint level. Project consistency must be preserved **not only during insertion, but throughout the entire lifetime of every entity relationship**. For RTM traceability (`ai_requirement_traceability`), subsequent parent relationship changes (updates or reassignments to requirements, test cases, scenarios, or suites) must be physically prevented from invalidating existing RTM records.
- **Implementation Constraints:**

  #### 1. Suite-to-Job & Generation History Composite Constraints
  - `ai_generation_jobs` has unique constraint `uq_ai_jobs_id_project (id, project_id)`.
  - `ai_test_suites` enforces `CONSTRAINT fk_suite_job_project FOREIGN KEY (job_id, project_id) REFERENCES ai_generation_jobs(id, project_id) ON DELETE SET NULL (job_id)`. Prevents linking a suite to a generation job belonging to another project.
  - `ai_test_suites` has unique constraint `uq_ai_suites_id_project (id, project_id)`.
  - `ai_generation_history` enforces:
    - `CONSTRAINT fk_gen_hist_suite_project FOREIGN KEY (suite_id, project_id) REFERENCES ai_test_suites(id, project_id) ON DELETE SET NULL (suite_id)`.
    - `CONSTRAINT fk_gen_hist_job_project FOREIGN KEY (job_id, project_id) REFERENCES ai_generation_jobs(id, project_id) ON DELETE SET NULL (job_id)`.
    Prevents history rows from referencing suites or jobs belonging to different projects.

  #### 2. RTM Traceability Insertion & Concurrency Protocol (Explicit Sequential Row Locking)
  - `ai_requirement_traceability` enforces database trigger `trg_enforce_rtm_project_integrity` on `BEFORE INSERT OR UPDATE`.
  - **No Multi-Table Joined Query Locking:** Multi-table queries with `FOR SHARE OF ...` do NOT guarantee row-lock acquisition order in PostgreSQL; the query planner chooses join order dynamically. Therefore, the trigger executes **separate, explicit sequential row-locking statements** strictly adhering to the top-down global hierarchy:
    ```sql
    -- Phase 1: Document Ownership Chain (Levels 1 -> 2 -> 3)
    -- Step 1.1: Lock Level 1 (ai_documents)
    SELECT project_id INTO v_chunk_project_id FROM ai_documents WHERE id = v_chunk_doc_id FOR SHARE;
    -- Step 1.2: Lock Level 2 (ai_document_versions) & validate linkage to Level 1
    SELECT document_id INTO v_verify_doc_id FROM ai_document_versions WHERE id = v_chunk_ver_id FOR SHARE;
    -- Step 1.3: Lock Level 3 (ai_document_chunks) & validate linkage to Level 2
    SELECT version_id INTO v_verify_ver_id FROM ai_document_chunks WHERE id = NEW.chunk_id FOR SHARE;

    -- Phase 2: Requirement Entity (Level 4)
    -- Step 2.1: Lock Level 4 (ai_requirements)
    SELECT project_id INTO v_req_project_id FROM ai_requirements WHERE id = NEW.requirement_id FOR SHARE;

    -- Phase 3: Test Case Hierarchy (Levels 5 -> 6 -> 7)
    -- Step 3.1: Lock Level 5 (ai_test_suites)
    SELECT project_id INTO v_tc_project_id FROM ai_test_suites WHERE id = v_tc_suite_id FOR SHARE;
    -- Step 3.2: Lock Level 6 (ai_test_scenarios) & validate linkage to Level 5
    SELECT suite_id INTO v_verify_suite_id FROM ai_test_scenarios WHERE id = v_tc_scen_id FOR SHARE;
    -- Step 3.3: Lock Level 7 (ai_test_cases) & validate linkage to Level 6
    SELECT scenario_id INTO v_verify_scen_id FROM ai_test_cases WHERE id = NEW.test_case_id FOR SHARE;
    ```
  - **Per-Statement Specification:**
    - **Lock Mode:** Every parent entity statement acquires a shared row lock (`FOR SHARE`), held until RTM transaction commit.
    - **Ownership Values Retrieved:** `project_id` is retrieved from root entities (`ai_documents`, `ai_requirements`, `ai_test_suites`) for cross-project comparison.
    - **Handling Missing or Concurrently Deleted Rows:** If any `SELECT ... FOR SHARE` returns `NULL` (row does not exist or was deleted concurrently before lock acquisition), PostgreSQL immediately raises `ForeignKeyViolation` (`23503`) and aborts the transaction.
    - **Linkage Validation:** Child-to-parent foreign keys (`v_verify_doc_id = v_chunk_doc_id`, `v_verify_ver_id = v_chunk_ver_id`, etc.) are validated after locks are acquired. If a concurrent transaction re-parented an entity before lock acquisition, the mismatch triggers `ConcurrentMutationDetected` (`40001`), ensuring no phantom or unvalidated parent-child edges are trusted.

  #### 3. Resolution of Nullable `test_case_id` (Problem B Resolution)
  - An RTM record with `test_case_id IS NULL` is **explicitly valid as a requirement-only traceability record** (used for requirement extraction audit, source chunk mapping, or tracking requirements with coverage gaps before test case generation).
  - When `test_case_id IS NULL`:
    - Validates requirement existence and acquires `FOR SHARE` lock on Level 4.
    - If `chunk_id IS NOT NULL`, locks Levels 1 -> 2 -> 3 and verifies that `chunk.project_id === req.project_id`.
    - Skips test-case hierarchy validation entirely (no FK violation raised for NULL `test_case_id`).
    - Preserves existing uniqueness `uq_rtm_req_tc (requirement_id, test_case_id)` and deletion semantics.
  - When `test_case_id IS NOT NULL`:
    - Validates both requirement and test-case hierarchy (Levels 1–7), enforcing `v_req_project_id === v_tc_project_id`.

  #### 4. Persistent Integrity & Locking Protocol Across Parent Lifecycle Changes
  To ensure project consistency remains valid after RTM insertion, subsequent parent relationship modifications and deletions across the entire ownership chain are governed by database-level triggers and declarative constraints:

  ##### Detailed Locking Protocols for Parent Reassignment Operations:
  1. **Changing `ai_documents.project_id`:**
     - *Row locked first:* Target document row (Level 1) is locked exclusively (`FOR UPDATE`) by PostgreSQL when executing the `UPDATE`.
     - *Additional rows inspected:* Trigger queries child versions and chunks referenced in `ai_requirement_traceability` (Level 8).
     - *Serialization vs RTM:* RTM insert locks Level 1 (`ai_documents`) first `FOR SHARE`. If RTM runs first, it holds `FOR SHARE`, blocking `UPDATE ai_documents` until RTM commits; upon unblocking, trigger finds active RTM chunk, aborting update with `ParentReassignmentViolation` (`23514`). If `UPDATE` runs first, it holds `FOR UPDATE`, blocking RTM insert's Level 1 lock; upon commit, RTM unblocks, reads updated project ID, detects mismatch, and aborts with `23514`.
     - *Lock order hierarchy:* Adheres strictly to top-down hierarchy (Level 1 acquired first).
  2. **Changing `ai_document_versions.document_id`:**
     - *Row locked first:* Direct `UPDATE` locks target version (Level 2) `FOR UPDATE`.
     - *Additional rows inspected:* Trigger queries old parent document and new parent document (Level 1) to compare project IDs.
     - *Serialization vs RTM:* RTM insert locks Level 1 then Level 2.
     - *Documented Architectural Limitation & Remediation:* In PostgreSQL, a direct `UPDATE ai_document_versions` locks Level 2 before trigger execution. If an RTM insert is concurrently locking Level 1 and moving to Level 2, an inverted lock order race (`Level 1 -> Level 2` vs `Level 2 -> Level 1`) can occur. Application repository re-parenting methods MUST pre-lock parent documents in order (`SELECT id FROM ai_documents WHERE id IN (OLD.document_id, NEW.document_id) ORDER BY id FOR SHARE;`) before issuing the update. Any residual concurrent cycle is caught by PostgreSQL deadlock detection (`40P01`) and retried.
  3. **Changing `ai_document_chunks.version_id`:**
     - *Row locked first:* Direct `UPDATE` locks target chunk (Level 3) `FOR UPDATE`.
     - *Additional rows inspected:* Trigger queries old version/document and new version/document to compare project IDs.
     - *Serialization vs RTM:* RTM insert locks Levels 1 -> 2 -> 3.
     - *Documented Architectural Limitation & Remediation:* Direct update acquires Level 3 before Level 1/2. Application repository re-parenting methods pre-lock root documents/versions top-down, or rely on PostgreSQL `40P01` deadlock detection and automatic transaction rollback + retry.
  4. **Changing `ai_requirements.project_id`:**
     - *Row locked first:* Target requirement (Level 4) is locked `FOR UPDATE`.
     - *Additional rows inspected:* Trigger queries `ai_requirement_traceability` (Level 8) to check for active links to test cases or chunks.
     - *Serialization vs RTM:* RTM insert locks Level 4 `FOR SHARE` before inserting into Level 8. Exclusive and shared locks serialize mutually; if active RTM links exist, trigger aborts with `ParentReassignmentViolation` (`23514`).
     - *Lock order hierarchy:* Adheres to top-down hierarchy (Level 4 locked before Level 8 check).
  5. **Changing `ai_test_suites.project_id`:**
     - *Row locked first:* Target suite (Level 5) is locked `FOR UPDATE`.
     - *Additional rows inspected:* Trigger queries downstream test cases in `ai_requirement_traceability` (Level 8).
     - *Serialization vs RTM:* RTM insert locks Level 5 `FOR SHARE`. Mutual lock exclusion prevents concurrent invalidation; active RTM references abort the update with `23514`.
     - *Lock order hierarchy:* Adheres to top-down hierarchy (Level 5 locked before downstream checks).
  6. **Changing `ai_test_scenarios.suite_id`:**
     - *Row locked first:* Target scenario (Level 6) is locked `FOR UPDATE`.
     - *Additional rows inspected:* Trigger queries old and new suites (Level 5) to verify project match.
     - *Documented Architectural Limitation & Remediation:* Direct update locks Level 6 before Level 5. Application repository pre-locks suites (`SELECT id FROM ai_test_suites WHERE id IN (OLD.suite_id, NEW.suite_id) ORDER BY id FOR SHARE;`) or relies on `40P01` deadlock rollback and retry.
  7. **Changing `ai_test_cases.scenario_id`:**
     - *Row locked first:* Target test case (Level 7) is locked `FOR UPDATE`.
     - *Additional rows inspected:* Trigger queries old and new scenario hierarchies to verify project match.
     - *Documented Architectural Limitation & Remediation:* Direct update locks Level 7 before Level 6/5. Application repository pre-locks parent scenarios/suites or relies on `40P01` deadlock rollback and retry.
  8. **Deleting Any Referenced Parent Entity:**
     Governed by declarative foreign key constraints:
     - If a requirement is deleted, `requirement_id REFERENCES ai_requirements(id) ON DELETE CASCADE` automatically and atomically deletes dependent RTM records.
     - If a test case is deleted, `test_case_id REFERENCES ai_test_cases(id) ON DELETE CASCADE` automatically deletes the RTM record.
     - If a document is deleted, foreign keys cascade to versions and chunks, and `ai_requirement_traceability.chunk_id REFERENCES ai_document_chunks(id) ON DELETE SET NULL` automatically nullifies the chunk pointer without deleting the requirement or test case. Normal document deletion and cascade semantics are 100% preserved.
     - If a version is deleted, its chunks cascade delete, and `ai_requirement_traceability.chunk_id` is automatically set to NULL via `ON DELETE SET NULL`.
     Zero invalid, dangling, or cross-project RTM links can survive parent deletion.

  #### 5. Concurrency and Row-Locking Serialization Protocol (Consistent Locking Protocol)
  To prevent race conditions where parent entities in the ownership chain are being reassigned concurrently while an RTM record is being inserted, the platform defines a strict **Consistent Locking Protocol**:
  
  ##### Global Hierarchical Lock Acquisition Order
  All database transactions that touch both parent and child entities in the QA AI platform acquire row locks strictly according to the following top-down hierarchy:
  1. `ai_documents`
  2. `ai_document_versions`
  3. `ai_document_chunks`
  4. `ai_requirements`
  5. `ai_test_suites`
  6. `ai_test_scenarios`
  7. `ai_test_cases`
  8. `ai_requirement_traceability`

  ##### Deadlock Guarantees, Transaction Rollback, and Retry Boundaries
  - **No Absolute Deadlock Immunity:** While top-down hierarchical locking drastically reduces lock contention and eliminates cycles in single-entity linear workflows, it does NOT mathematically eliminate all deadlocks in a relational database when complex concurrent multi-row batch inserts or cross-hierarchy re-parenting operations interleave.
  - **PostgreSQL `40P01` Deadlock Detection:** When an unavoidable circular wait occurs, the PostgreSQL lock manager detects the deadlock cycle and terminates one of the competing transactions with SQLSTATE `40P01` (`deadlock_detected`).
  - **Mandatory Full Transaction Rollback:** In PostgreSQL, an aborted transaction block cannot execute further queries (`ERROR: current transaction is aborted, commands ignored until end of transaction block`). The application layer MUST execute an explicit `await client.query('ROLLBACK')` to abort the failed transaction before any retry attempt.
  - **Fresh Database Client Renewal:** Upon rollback, the client connection is released back to `aiDbPool` (or cleanly reset), and a fresh database client is acquired to begin a brand-new `BEGIN` transaction block. Retrying statements inside an aborted transaction block is physically impossible and strictly prevented.
  - **Application Retry Boundary & Backoff Strategy:** The application repository wraps outer transaction boundaries (`executeRtmTransaction`, `reassignParentEntity`) in an exponential backoff retry loop:
    ```typescript
    const MAX_RETRIES = 3; // 4 attempts total
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
      const client = await aiDbPool.connect();
      try {
        await client.query('BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED');
        const result = await executeTransactionLogic(client, params);
        await client.query('COMMIT');
        return result;
      } catch (err: any) {
        await client.query('ROLLBACK').catch(() => {});
        client.release();

        // ONLY transient deadlock errors (40P01) or lock timeouts (55P03) may be retried
        if ((err.code === '40P01' || err.code === '55P03') && attempt < MAX_RETRIES - 1) {
          attempt++;
          const jitterMs = Math.floor(Math.random() * 50);
          const backoffDelay = Math.min(1000, 100 * Math.pow(2, attempt) + jitterMs);
          await new Promise((resolve) => setTimeout(resolve, backoffDelay));
          continue;
        }

        // Deterministic integrity violations MUST NEVER be retried
        throw err;
      }
    }
    ```
  - **Non-Retryable Integrity Errors:** The following errors represent deterministic business rule or relational schema violations and MUST NEVER be retried:
    - **`23514`** (`check_violation`): Trigger/Check integrity failure (`CrossProjectIntegrityViolation`, `ParentReassignmentViolation`, `VersionImmutableViolation`). Retrying will deterministically produce the exact same failure.
    - **`23503`** (`foreign_key_violation`): Non-existent parent or child entity.
    - **`23505`** (`unique_violation`): Natural key or idempotency constraint collision.
  - **Critical Architectural Warning:** Automatic retry on `40P01` is strictly an exception handler for transient contention; it is NEVER a substitute for correctly specified hierarchical lock ordering.

  ##### Concurrency Isolation Level Semantics
  - The database connection pool operates under PostgreSQL's default **`READ COMMITTED`** isolation level with explicit row locking (`FOR SHARE` / `FOR UPDATE`).
  - **Important Architectural Clarification:** The architecture does NOT make false claims of serializable transaction isolation. By using explicit hierarchical row locking within `READ COMMITTED`, the system achieves true physical mutual exclusion and deterministic ordering on conflicting rows without the performance penalties, phantom write anomalies, or high serialization failure rates of `SERIALIZABLE`.

  #### 6. Schema & Authorization Preservation
  - Preserves the existing 16-table schema without introducing unnecessary tables or altering table count.
  - Preserves the approved Option B authorization model without project membership tables.

- **Required Test Scenarios (Problem C Acceptance Tests):**
  - *Scenario C.1 (Valid Same-Project RTM Insert):* Requirement and test case belong to same project; shared locks acquired on all parent rows; insert commits successfully.
  - *Scenario C.2 (Rejected Cross-Project RTM Insert):* Requirement from Project A and test case from Project B; trigger raises `CrossProjectIntegrityViolation` (`23514`) and transaction rolls back.
  - *Scenario C.3 (Requirement Reassignment Invalidation Rejection with Test Cases):* Attempt to change `project_id` on an existing requirement referenced in RTM with a test case; blocked by `trg_req_project_reassign` with `ParentReassignmentViolation` (`23514`).
  - *Scenario C.4 (Test-Case Reassignment to Scenario in Another Project):* Attempt to update `ai_test_cases.scenario_id` to a scenario belonging to a different project while referenced in RTM; blocked by `trg_tc_scen_reassign` (`23514`).
  - *Scenario C.5 (Scenario Reassignment to Suite in Another Project):* Attempt to update `ai_test_scenarios.suite_id` to a suite in another project while cases are in RTM; blocked by `trg_scen_suite_reassign` (`23514`).
  - *Scenario C.6 (Suite Project Reassignment Rejection):* Attempt to update `ai_test_suites.project_id` on a suite containing test cases referenced in RTM; blocked by `trg_suite_project_reassign` (`23514`).
  - *Scenario C.7 (Concurrent Parent Modification During RTM Insertion):* Concurrent transaction attempts to alter or re-parent the test scenario or suite while RTM insert is executing; blocked by the RTM trigger's explicit sequential row locks (`FOR SHARE` on `ai_test_suites`, `ai_test_scenarios`, and `ai_test_cases`) until the RTM transaction commits.
  - *Scenario C.8 (Concurrent Deletion of Referenced Parent Records):* Concurrent transaction attempts to delete the parent requirement or suite while RTM insert is executing; blocked by `FOR SHARE` locks until commit or fails cleanly with FK cascade.
  - *Scenario C.9 (Valid NULL test_case_id Behavior):* RTM record inserted with `test_case_id IS NULL` and valid `chunk_id` from the same project; passes validation without test-case hierarchy errors. Cross-project chunk insertion with NULL `test_case_id` is rejected.
  - *Scenario C.10 (Transaction Rollback on Any Integrity Failure):* Multi-row RTM batch insert transaction cleanly rolls back all modifications if any single entry fails project integrity verification.
  - *Scenario C.11 (Requirement Reassignment with Chunk-Only RTM):*
    - *Setup:* Project A contains Requirement R1 and Document D1 (Chunk C1). RTM row links R1 to C1 with `test_case_id IS NULL`.
    - *Action:* `UPDATE ai_requirements SET project_id = $projB WHERE id = R1.id;`
    - *Expected Result:* Trigger `trg_req_project_reassign` detects `chunk_id IS NOT NULL` on the active RTM record, raises `ParentReassignmentViolation` with SQLSTATE `23514`, and rolls back the transaction.
  - *Scenario C.12 (Document Project Reassignment Rejection):*
    - *Setup:* Project A contains Document D1 (Chunk C1) and Requirement R1. RTM row links R1 to C1.
    - *Action:* `UPDATE ai_documents SET project_id = $projB WHERE id = D1.id;`
    - *Expected Result:* Trigger `trg_doc_project_reassign` queries versions and chunks of D1, identifies active RTM reference to C1, raises `ParentReassignmentViolation` with SQLSTATE `23514`, and rolls back the transaction. (If D1 has no RTM-referenced chunks, the update succeeds).
  - *Scenario C.13 (Concurrent Document Reassignment and RTM Insertion):*
    - *Setup:* Project A contains Document D1 (Chunk C1) and Requirement R1.
    - *Concurrent Sequence:*
      1. Client 1 begins transaction, executes `INSERT INTO ai_requirement_traceability (requirement_id, chunk_id) VALUES (R1.id, C1.id)`. Trigger acquires explicit sequential shared row locks: Level 1 (`ai_documents`) `FOR SHARE`, Level 2 (`ai_document_versions`) `FOR SHARE`, and Level 3 (`ai_document_chunks`) `FOR SHARE`.
      2. Client 2 concurrently begins transaction, executes `UPDATE ai_documents SET project_id = $projB WHERE id = D1.id`. Client 2 blocks waiting for exclusive lock (`FOR UPDATE`) on D1 (Level 1).
      3. Client 1 executes `COMMIT`.
      4. Client 2 unblocks, `trg_doc_project_reassign` fires, executes query finding Client 1's newly committed RTM record, raises `ParentReassignmentViolation` with SQLSTATE `23514`, and Client 2 rolls back.
      *(In reverse ordering where Client 2 executes first, Client 1 blocks on Level 1 FOR SHARE, unblocks upon Client 2 commit, reads updated d.project_id != v_req_project_id, raises CrossProjectIntegrityViolation with SQLSTATE 23514, and rolls back).*
    - *Expected Result:* Neither race condition sequence can commit an invalid cross-project relationship.
  - *Scenario C.14 (Chunk Version Reassignment Rejection):*
    - *Setup:* Project A contains Document D1 (Version V1, Chunk C1) and Requirement R1. Project B contains Document D2 (Version V2, Chunk C2). RTM record links R1 to C1 (`chunk_id = C1.id`).
    - *Action:* `UPDATE ai_document_chunks SET version_id = V2.id WHERE id = C1.id;`
    - *Expected Result:* Trigger `trg_chunk_version_reassign` evaluates `v_old_proj` (Project A) and `v_new_proj` (Project B), identifies active RTM reference to C1, raises `ParentReassignmentViolation` with SQLSTATE `23514`, and rolls back the transaction. (If updated to another version within Project A, the update succeeds).
  - *Scenario C.15 (Version Document Reassignment Rejection):*
    - *Setup:* Project A contains Document D1 (Version V1, Chunk C1) and Requirement R1. Project B contains Document D2. RTM record links R1 to C1 (`chunk_id = C1.id`).
    - *Action:* `UPDATE ai_document_versions SET document_id = D2.id WHERE id = V1.id;`
    - *Expected Result:* Trigger `trg_version_doc_reassign` evaluates `v_old_proj` (Project A) and `v_new_proj` (Project B), identifies chunks under V1 referenced in active RTM, raises `ParentReassignmentViolation` with SQLSTATE `23514`, and rolls back the transaction. (If updated to another document within Project A, the update succeeds).
  - *Scenario C.16 (Concurrent Chunk Reassignment & RTM Insert Serialization):*
    - *Setup:* Project A contains Document D1 (Version V1, Chunk C1) and Requirement R1. Project B contains Document D2 (Version V2).
    - *Concurrent Sequence:*
      1. Client 1 begins transaction, executes `INSERT INTO ai_requirement_traceability (requirement_id, chunk_id) VALUES (R1.id, C1.id)`. Trigger acquires explicit sequential shared row locks on Level 1 (`ai_documents`), Level 2 (`ai_document_versions`), and Level 3 (`ai_document_chunks`) in strict top-down order `FOR SHARE`.
      2. Client 2 concurrently begins transaction, executes `UPDATE ai_document_chunks SET version_id = V2.id WHERE id = C1.id`. Client 2 blocks waiting for exclusive lock on C1 (Level 3).
      3. Client 1 executes `COMMIT`.
      4. Client 2 unblocks, `trg_chunk_version_reassign` executes, identifies Client 1's newly committed RTM record, raises `ParentReassignmentViolation` with SQLSTATE `23514`, and Client 2 rolls back.
      *(Reverse ordering: If Client 2 executes first, Client 1 blocks on Level 3 FOR SHARE, unblocks upon Client 2 commit, reads updated cross-project relationship, raises CrossProjectIntegrityViolation with SQLSTATE 23514, and rolls back).*
    - *Expected Result:* Mutual exclusion prevents cross-project RTM link from committing.
  - *Scenario C.17 (Concurrent Version Reassignment & RTM Insert Serialization):*
    - *Setup:* Project A contains Document D1 (Version V1, Chunk C1) and Requirement R1. Project B contains Document D2.
    - *Concurrent Sequence:*
      1. Client 1 begins transaction, executes `INSERT INTO ai_requirement_traceability (requirement_id, chunk_id) VALUES (R1.id, C1.id)`. Trigger acquires explicit sequential shared row locks on Level 1 (`ai_documents`), Level 2 (`ai_document_versions`), and Level 3 (`ai_document_chunks`) in strict top-down order `FOR SHARE`.
      2. Client 2 concurrently begins transaction, executes `UPDATE ai_document_versions SET document_id = D2.id WHERE id = V1.id`. Client 2 blocks waiting for exclusive lock on V1 (Level 2).
      3. Client 1 executes `COMMIT`.
      4. Client 2 unblocks, `trg_version_doc_reassign` executes, identifies Client 1's newly committed RTM record, raises `ParentReassignmentViolation` with SQLSTATE `23514`, and Client 2 rolls back.
      *(Reverse ordering: If Client 2 executes first, Client 1 blocks on Level 2 FOR SHARE, unblocks upon Client 2 commit, reads updated cross-project document relationship, raises CrossProjectIntegrityViolation with SQLSTATE 23514, and rolls back).*
    - *Expected Result:* Cross-project RTM violation is physically impossible under concurrent execution.
- **Acceptance Evidence:**
  Automated PostgreSQL 16 integration tests executing Scenarios C.1 through C.17 against the database proving constraint enforcement, complete ownership-chain lifecycle protection, concurrency serialization, and error codes (`23503`, `23514`, `40P01`).
- **Verification Status:** `DESIGN CORRECTED — NOT RUNTIME VERIFIED`

---

### 10.4 PostgreSQL 16 Runtime Verification Matrix

The Phase 2 implementation must include dedicated PostgreSQL 16 integration tests verifying the following critical architectural behaviors. Code inspection or documentation alone does NOT satisfy verification:

| Matrix Item | Architectural Behavior | Test Type | Required Execution Result | Verification Status |
| :--- | :--- | :--- | :--- | :--- |
| **RVM-1** | Document version row immutability | SQL Integration | Any update to completed version row raises `VersionImmutableViolation` (`23514`). | `NOT VERIFIED` |
| **RVM-2** | Chunk & embedding immutability | SQL Integration | Insert/update/delete on chunks of completed version raises `VersionImmutableViolation`. | `NOT VERIFIED` |
| **RVM-3** | Cascade deletion vs direct child deletion | SQL Integration | `DELETE FROM ai_documents` cascades cleanly; direct `DELETE FROM ai_document_versions` for completed version is blocked. | `NOT VERIFIED` |
| **RVM-4** | Concurrency serialization | Multi-client Concurrency | Chunk insert `FOR SHARE` and completion `FOR UPDATE` mutually block, eliminating race conditions. | `NOT VERIFIED` |
| **RVM-5** | Worker lease validation & rollback | Transaction Integration | Final `UPDATE ... WHERE lease_expires_at > clock_timestamp()` with `rowCount === 0` rolls back all artifact writes. | `NOT VERIFIED` |
| **RVM-6** | Atomic artifact persistence | Transaction Integration | Shared transactional `client` covers suites, scenarios, cases, checklists, traceability, and history. Zero ghost rows on error. | `NOT VERIFIED` |
| **RVM-7** | Cross-project integrity, explicit lock ordering & parent lifecycle | SQL Integration & Concurrency | Explicit sequential row locking (Levels 1–8) and parent reassignment triggers enforce Scenarios C.1–C.17 across all parent lifecycle updates, concurrency interleavings, and `40P01` backoff retries. | `NOT VERIFIED` |
| **RVM-8** | Safe singleton reconciliation, terminal outbox closure & single dispatcher path | Queue Integration & Concurrency | Single authoritative outbox dispatcher with transaction-scoped claiming (`FOR UPDATE SKIP LOCKED`); completed/failed jobs never re-enqueued; terminal states permanently close outbox lifecycle (Scenarios A.1–A.9, B.1–B.6). | `NOT VERIFIED` |

---

### 10.5 Acceptance Gate Traceability Matrix

| Gate ID | Requirement Summary | Implementation Constraint | Required Test Scenarios | Acceptance Evidence | Verification Status |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **GATE-A** | Durable outbox dispatch, claiming & terminal closure | Single authoritative outbox dispatcher + transaction-scoped claiming (`FOR UPDATE SKIP LOCKED`) + terminal state closure (`COMPLETED` -> `DISPATCHED`, `FAILED`/`CANCELLED` -> `FAILED`) + sole watchdog retry authority (`retryLimit: 0`). | A.1 to A.9 (crash before send, crash before dispatch update, retry sweep, idempotency, failed job sweeper, cancelled job sweeper, completed job sweeper, repeated sweep immunity, index exclusion). | 100% simulated crash recovery to `DISPATCHED` or terminal `FAILED`, with zero orphaned outbox records. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **GATE-B** | Safe pg-boss singleton reconciliation (Dual-state: `ai_generation_jobs` + `pgboss.job`) | Serialized `FOR UPDATE` lookup; completed/failed jobs never re-enqueued; terminal state reconciliation; sole Watchdog retry authority. | B.1 to B.6 (active singleton, completed job, failed job, missing record, concurrent dispatch, Watchdog-authorized retry). | Zero invalid re-enqueues, serialized reconciliation, strict Watchdog sole retry authority. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |
| **GATE-C** | Persistent cross-project database integrity & lifecycle protection | Composite FKs + explicit sequential row locking (Levels 1–8) on RTM + parent reassignment triggers (req, suite, scenario, tc, doc, version, chunk) + full transaction rollback and fresh client renewal on `40P01` + non-retryable integrity errors (`23514`, `23503`, `23505`). | C.1 to C.17 (insertion, cross-project, requirement reassignment, TC reassignment, scenario reassignment, suite reassignment, concurrent modification, concurrent deletion, NULL TC, rollback, chunk-only req reassignment, doc reassignment, concurrent doc reassignment, chunk version reassignment, version doc reassignment, concurrent chunk reassignment, concurrent version reassignment). | PostgreSQL constraint rejections (`23503`, `23514`, `40P01`), serializable concurrency protection, and lifecycle integrity verification under multi-client testing. | `DESIGN CORRECTED — NOT RUNTIME VERIFIED` |

---

## 11. Final Phase 1 Architecture Status & Next Steps

```
+---------------------------------------------------------------------------------------+
|                                  FINAL STATUS:                                        |
|                     PHASE 1 ARCHITECTURE RECONCILED & CONSOLIDATED                    |
|                   MANDATORY PHASE 2 IMPLEMENTATION GATES RECORDED                     |
+---------------------------------------------------------------------------------------+
|  All 10 original architectural sections, 16-table DDL schemas, trigger definitions,    |
|  and worker fencing protocols have been reconciled. The three mandatory acceptance    |
|  gates (Gates A, B, and C) and runtime verification matrix are formally established.  |
|                                                                                       |
|  PHASE 2 IMPLEMENTATION REMAINS PENDING: Requires explicit user approval following   |
|  native host binaries provisioning (PostgreSQL 16, pgvector, Ollama).                 |
+---------------------------------------------------------------------------------------+
```
