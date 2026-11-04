# Phase 1.4: Schema Reconciliation & Final Implementation Contract
## AI Test Case Writer — Centralized QA Tools Platform

**Contract Status:** Final Implementation Contract  
**Date:** 2026-10-30  
**Target Environment:** Windows 10 Pro 64-bit | Intel Core i5-3470S (4C/4T @ 2.90 GHz, AVX) | 16 GB RAM | Localhost (127.0.0.1)  
**Scope:** Strictly Read-Only Architecture Audit & Definitive Pre-Implementation Contract  

---

## Executive Summary & Final Verdict

This document reconciles all previous architecture deliverables (Phase 1.1, 1.2, and 1.3) into **one authoritative, internally consistent implementation contract**. Every table definition, foreign key reference, enum value, SQL query, authorization check, and queue state transition is reconciled to eliminate discrepancies.

### Final Implementation Verdict

```
+---------------------------------------------------------------------------------------+
|                                    FINAL VERDICT:                                     |
|                                  READY FOR PHASE 2                                    |
|                      (Implementation Contract Fully Established)                      |
+---------------------------------------------------------------------------------------+
|  1. Architecture & DDL: Complete and reconciled across all 16 tables.                |
|  2. Security & Roles: DDL/DML privileges strictly separated; no hardcoded passwords. |
|  3. Resource Auth: Explicit parameterized traversal queries for every entity.        |
|  4. Job Reliability: Transactional outbox pattern prevents dispatch drop windows.    |
|  5. Vector Consistency: Uniform HNSW cosine distance (<=>) in DDL and queries.       |
|  6. Execution Plan: Phase 2 begins with host prerequisite installation.               |
+---------------------------------------------------------------------------------------+
```

---

## 1. Authoritative Database Schema (Complete 16-Table DDL)

All 16 tables are defined below. Reconciled column naming decisions:
- **`version_id`**: Consistently used across chunks (`ai_document_chunks.version_id`) and embeddings (`ai_document_embeddings.version_id`), referencing `ai_document_versions(id)`.
- **`model_id`**: Embeddings strictly reference `ai_embedding_config(id)` (`UUID NOT NULL REFERENCES ai_embedding_config(id) ON DELETE RESTRICT`). String-based `model_name` foreign references are eliminated.
- **`scenario_type`**: Replaces the reserved keyword `type` in `ai_test_scenarios`.
- **`review_action`**: Replaces `action` in `ai_human_reviews`.

```sql
-- ============================================================================
-- AI TEST CASE WRITER — AUTHORITATIVE DDL (Database: qa_ai_platform)
-- ============================================================================

-- Extensions (Provisioned by PostgreSQL superuser)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ----------------------------------------------------------------------------
-- 1. Schema Migration History
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_schema_migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------------------
-- 2. Embedding Configuration (Strict Single-Active Model with History)
-- ----------------------------------------------------------------------------
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

-- Partial Unique Index: Exactly one active configuration row, arbitrary inactive historical rows
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_embedding_config_single_active 
    ON ai_embedding_config (is_active) 
    WHERE is_active = TRUE;

-- ----------------------------------------------------------------------------
-- 3. Projects (Option B: Scoped to Creator + Platform Admin)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 4. Documents (Permanent Entity)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 5. Document Versions (Permanent Immutable Revisions)
-- ----------------------------------------------------------------------------
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
    CONSTRAINT uq_doc_version UNIQUE (document_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_doc_ver_doc_id ON ai_document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_ver_hash ON ai_document_versions(sha256_hash);

-- Circular FK for Authoritative Active Version (ON DELETE SET NULL ensures clean document deletion)
ALTER TABLE ai_documents 
    DROP CONSTRAINT IF EXISTS fk_active_doc_version,
    ADD CONSTRAINT fk_active_doc_version FOREIGN KEY (active_version_id) 
    REFERENCES ai_document_versions(id) ON DELETE SET NULL;

-- ----------------------------------------------------------------------------
-- 6. Document Chunks (Version-Isolated)
-- ----------------------------------------------------------------------------
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
    CONSTRAINT uq_doc_chunk_idx UNIQUE (version_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_version ON ai_document_chunks(version_id);

-- ----------------------------------------------------------------------------
-- 7. Document Embeddings (Fixed 768-dim nomic-embed-text)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_document_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL REFERENCES ai_document_chunks(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES ai_document_versions(id) ON DELETE CASCADE,
    model_id UUID NOT NULL REFERENCES ai_embedding_config(id) ON DELETE RESTRICT,
    embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chunk_model UNIQUE (chunk_id, model_id)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON ai_document_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_version_model ON ai_document_embeddings(version_id, model_id);

-- HNSW Cosine Distance Index (Strict vector_cosine_ops)
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw_cosine 
    ON ai_document_embeddings USING hnsw (embedding vector_cosine_ops);

-- ----------------------------------------------------------------------------
-- 8. Application-Level Job Tracking (With Transactional Outbox)
-- ----------------------------------------------------------------------------
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
    idempotency_key VARCHAR(128) UNIQUE,
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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_project_status ON ai_generation_jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_heartbeat ON ai_generation_jobs(status, last_heartbeat_at) WHERE status = 'PROCESSING';
CREATE INDEX IF NOT EXISTS idx_ai_jobs_outbox ON ai_generation_jobs(dispatch_status, created_at) WHERE dispatch_status = 'OUTBOX_PENDING';
CREATE INDEX IF NOT EXISTS idx_ai_jobs_pgboss_id ON ai_generation_jobs(pgboss_job_id);

-- ----------------------------------------------------------------------------
-- 9. Requirements Decomposition
-- ----------------------------------------------------------------------------
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
    CONSTRAINT uq_project_req UNIQUE (project_id, req_key)
);
CREATE INDEX IF NOT EXISTS idx_ai_req_project ON ai_requirements(project_id);

-- ----------------------------------------------------------------------------
-- 10. Test Suites
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_test_suites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    suite_key VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    objective TEXT,
    target_module VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' 
        CHECK (status IN ('DRAFT', 'GENERATING', 'REVIEW_PENDING', 'APPROVED', 'ARCHIVED')),
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_suite UNIQUE (project_id, suite_key)
);
CREATE INDEX IF NOT EXISTS idx_suites_proj ON ai_test_suites(project_id);

-- ----------------------------------------------------------------------------
-- 11. Test Scenarios
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 12. Detailed Test Cases
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 13. QA Checklists
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_qa_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id UUID NOT NULL REFERENCES ai_test_suites(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklists_suite ON ai_qa_checklists(suite_id);

-- ----------------------------------------------------------------------------
-- 14. Requirement Traceability Matrix (RTM)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 15. Generation History
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_generation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    suite_id UUID REFERENCES ai_test_suites(id) ON DELETE SET NULL,
    job_id UUID REFERENCES ai_generation_jobs(id) ON DELETE SET NULL,
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gen_hist_proj ON ai_generation_history(project_id);

-- ----------------------------------------------------------------------------
-- 16. Human Review History
-- ----------------------------------------------------------------------------
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

## 2. Canonical Status & Enum Values

The following table provides the **sole authoritative reference** for status and enum values across DDL, API contracts, AJV schemas, and worker logic:

| Entity & Column | Canonical Allowed Values | Default Value | Notes |
| :--- | :--- | :--- | :--- |
| **`ai_embedding_config.provider`** | `'OLLAMA'`, `'LOCAL'` | `'OLLAMA'` | Local inference via Ollama service |
| **`ai_embedding_config.distance_metric`** | `'cosine'` | `'cosine'` | Fixed to cosine distance (`vector_cosine_ops`) |
| **`ai_projects.status`** | `'ACTIVE'`, `'ARCHIVED'` | `'ACTIVE'` | Soft project archiving |
| **`ai_documents.document_type`** | `'PDF'`, `'DOCX'`, `'XLSX'`, `'CSV'`, `'TXT'` | None | Supported document upload types |
| **`ai_document_versions.indexing_status`**| `'PENDING'`, `'PROCESSING'`, `'COMPLETED'`, `'FAILED'` | `'PENDING'` | State of chunking and vector embedding |
| **`ai_generation_jobs.job_type`** | `'INDEX_DOCUMENT'`, `'GENERATE_TEST_CASES'`, `'REINDEX_DOCUMENT'`, `'EXPORT_SUITE'` | None | Type of asynchronous task |
| **`ai_generation_jobs.status`** | `'PENDING'`, `'PROCESSING'`, `'COMPLETED'`, `'FAILED'`, `'CANCELLED'` | `'PENDING'` | Lifecycle state; terminal states immutable |
| **`ai_generation_jobs.dispatch_status`** | `'OUTBOX_PENDING'`, `'DISPATCHED'`, `'FAILED'` | `'OUTBOX_PENDING'` | Transactional outbox state |
| **`ai_requirements.priority`** | `'LOW'`, `'MEDIUM'`, `'HIGH'`, `'CRITICAL'` | `'MEDIUM'` | Defect & requirement severity |
| **`ai_requirements.status`** | `'ACTIVE'`, `'DRAFT'`, `'DEPRECATED'` | `'ACTIVE'` | Requirements governance state |
| **`ai_test_suites.status`** | `'DRAFT'`, `'GENERATING'`, `'REVIEW_PENDING'`, `'APPROVED'`, `'ARCHIVED'` | `'DRAFT'` | Suite lifecycle state |
| **`ai_test_scenarios.scenario_type`** | `'FUNCTIONAL'`, `'EDGE_CASE'`, `'SECURITY'`, `'PERFORMANCE'`, `'USABILITY'`, `'INTEGRATION'`, `'NEGATIVE'` | `'FUNCTIONAL'` | Scenario classification |
| **`ai_test_cases.priority`** | `'LOW'`, `'MEDIUM'`, `'HIGH'`, `'CRITICAL'` | `'MEDIUM'` | Execution priority |
| **`ai_test_cases.source_classification`**| `'DIRECT_REQUIREMENT'`, `'INFERRED'`, `'EDGE_CASE'`, `'USER_SPECIFIED'` | `'DIRECT_REQUIREMENT'` | Hallucination tracking |
| **`ai_test_cases.execution_status`** | `'UNTESTED'`, `'PASSED'`, `'FAILED'`, `'BLOCKED'`, `'SKIPPED'` | `'UNTESTED'` | Manual/automated test outcome |
| **`ai_test_cases.review_status`** | `'PENDING'`, `'ACCEPTED'`, `'MODIFIED'`, `'REJECTED'` | `'PENDING'` | QA reviewer governance |
| **`ai_requirement_traceability.trace_type`**| `'DIRECT_COVERAGE'`, `'INFERRED_COVERAGE'`, `'NEGATIVE_COVERAGE'` | `'DIRECT_COVERAGE'` | RTM relationship |
| **`ai_generation_history.validation_status`**| `'VALID'`, `'SCHEMA_ERROR'`, `'PARSE_ERROR'`, `'ABORTED'` | `'VALID'` | LLM response validation result |
| **`ai_human_reviews.review_action`** | `'APPROVED'`, `'MODIFIED'`, `'REJECTED'`, `'COMMENTED'` | None | Audit log action |

---

## 3. Explicit Resource Ownership Authorization Queries

To prevent Insecure Direct Object References (IDOR), generic table queries are eliminated. Every entity has an explicit, parameterized query verifying ownership back to `ai_projects.id` and `ai_projects.created_by_user_id`:

```
               ai_projects (project_id, created_by_user_id)
                     ▲                              ▲
                     │                              │
             ai_documents                     ai_test_suites
                     ▲                              ▲
                     │                              │
           ai_document_versions             ai_test_scenarios
                     ▲                              ▲
                     │                              │
            ai_document_chunks                ai_test_cases
                                                    ▲
                                                    │
                                             ai_human_reviews
```

### 3.1 Entity Traversal Queries

#### 1. Documents
```sql
SELECT d.id, d.project_id, p.created_by_user_id 
FROM ai_documents d
JOIN ai_projects p ON d.project_id = p.id
WHERE d.id = $1 AND d.project_id = $2;
```

#### 2. Document Versions
```sql
SELECT v.id, d.project_id, p.created_by_user_id 
FROM ai_document_versions v
JOIN ai_documents d ON v.document_id = d.id
JOIN ai_projects p ON d.project_id = p.id
WHERE v.id = $1 AND d.project_id = $2;
```

#### 3. Generation Jobs
```sql
SELECT j.id, j.project_id, j.user_id, p.created_by_user_id 
FROM ai_generation_jobs j
JOIN ai_projects p ON j.project_id = p.id
WHERE j.id = $1 AND j.project_id = $2;
```

#### 4. Test Suites
```sql
SELECT s.id, s.project_id, p.created_by_user_id 
FROM ai_test_suites s
JOIN ai_projects p ON s.project_id = p.id
WHERE s.id = $1 AND s.project_id = $2;
```

#### 5. Test Scenarios
```sql
SELECT sc.id, s.project_id, p.created_by_user_id 
FROM ai_test_scenarios sc
JOIN ai_test_suites s ON sc.suite_id = s.id
JOIN ai_projects p ON s.project_id = p.id
WHERE sc.id = $1 AND s.project_id = $2;
```

#### 6. Test Cases
```sql
SELECT tc.id, s.project_id, p.created_by_user_id 
FROM ai_test_cases tc
JOIN ai_test_scenarios sc ON tc.scenario_id = sc.id
JOIN ai_test_suites s ON sc.suite_id = s.id
JOIN ai_projects p ON s.project_id = p.id
WHERE tc.id = $1 AND s.project_id = $2;
```

#### 7. QA Checklists
```sql
SELECT cl.id, s.project_id, p.created_by_user_id 
FROM ai_qa_checklists cl
JOIN ai_test_suites s ON cl.suite_id = s.id
JOIN ai_projects p ON s.project_id = p.id
WHERE cl.id = $1 AND s.project_id = $2;
```

#### 8. Generation History
```sql
SELECT gh.id, gh.project_id, gh.user_id, p.created_by_user_id 
FROM ai_generation_history gh
JOIN ai_projects p ON gh.project_id = p.id
WHERE gh.id = $1 AND gh.project_id = $2;
```

#### 9. Human Review History
```sql
SELECT hr.id, s.project_id, hr.user_id, p.created_by_user_id 
FROM ai_human_reviews hr
JOIN ai_test_cases tc ON hr.test_case_id = tc.id
JOIN ai_test_scenarios sc ON tc.scenario_id = sc.id
JOIN ai_test_suites s ON sc.suite_id = s.id
JOIN ai_projects p ON s.project_id = p.id
WHERE hr.id = $1 AND s.project_id = $2;
```

### 3.2 Authorization Logic & Diagnostic Masking
```javascript
function authorizeAccess(reqUser, resourceRecord) {
  const isPlatformAdmin = (reqUser.role || '').toUpperCase() === 'ADMIN';
  const isProjectOwner = resourceRecord.created_by_user_id === reqUser.id;

  if (!isPlatformAdmin && !isProjectOwner) {
    return { authorized: false, status: 404, error: 'Resource not found in project.' };
  }

  // Diagnostic masking: Ordinary users see sanitized errors; Admin sees full diagnostics
  if (!isPlatformAdmin && resourceRecord.internal_diagnostics) {
    delete resourceRecord.internal_diagnostics;
  }

  return { authorized: true, resource: resourceRecord };
}
```

---

## 4. PostgreSQL Role Setup & Privileges

### 4.1 Strict Role Separation
1. **Superuser (`postgres`)**: Provisions roles, creates database, installs C-extensions. Never used at runtime.
2. **Migration Role (`qa_ai_migrator`)**: Schema owner of `public` and `pgboss`. Executes migrations.
3. **Application Runtime Role (`qa_ai_app`)**:
   - In schema `public`: **STRICTLY DML-ONLY** (`SELECT`, `INSERT`, `UPDATE`, `DELETE`). Zero `CREATE`, `DROP`, or `ALTER` privileges.
   - In schema `pgboss`: Granted `CREATE` exclusively so `pg-boss` can initialize and manage dynamic partition and queue tables without granting DDL rights on `public`.

### 4.2 Initial Setup Script (`000_admin_init.sql`)
*Execute with `psql -U postgres -h 127.0.0.1` using environment-supplied passwords:*

```sql
-- 1. Create Dedicated Roles (Passwords injected via environment variables)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'qa_ai_migrator') THEN
    CREATE ROLE qa_ai_migrator WITH LOGIN PASSWORD :'MIGRATOR_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'qa_ai_app') THEN
    CREATE ROLE qa_ai_app WITH LOGIN PASSWORD :'APP_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

-- 2. Create Database
CREATE DATABASE qa_ai_platform WITH OWNER = qa_ai_migrator ENCODING = 'UTF8';

-- 3. Connect to Database
\c qa_ai_platform

-- 4. Install Extensions (Must be executed by superuser)
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 5. Create Schemas with migrator ownership
CREATE SCHEMA IF NOT EXISTS public AUTHORIZATION qa_ai_migrator;
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION qa_ai_migrator;

-- 6. Grant Schema Privileges
GRANT CONNECT ON DATABASE qa_ai_platform TO qa_ai_app;

-- Schema 'public': Strictly DML-only for application role
GRANT USAGE ON SCHEMA public TO qa_ai_app;
-- Schema 'pgboss': Queue management exception (allows pg-boss dynamic queue tables)
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

---

## 5. Recoverable Job Dispatch Design (Transactional Outbox)

To close the failure window where an application job is saved but the process crashes before pg-boss receives the job, a **Transactional Outbox Pattern** is enforced.

```
 Client Request
       │
       ▼
 1. Validate Idempotency Key ───────► If active job exists, return existing jobId
       │ (No active job found)
       ▼
 2. BEGIN TRANSACTION
    - INSERT INTO ai_generation_jobs (
        status = 'PENDING',
        dispatch_status = 'OUTBOX_PENDING',
        idempotency_key = $key,
        payload = $payload
      ) RETURNING id;
    COMMIT TRANSACTION;
       │
       ▼
 3. Attempt Immediate Dispatch to pg-boss
       ├──► SUCCESS: UPDATE ai_generation_jobs SET pgboss_job_id = $pgbossId, dispatch_status = 'DISPATCHED'
       └──► FAILURE / CRASH: Job remains dispatch_status = 'OUTBOX_PENDING'
                                 │
                                 ▼
                     Outbox Sweeper (Every 15s)
                     - SELECT id FROM ai_generation_jobs 
                       WHERE dispatch_status = 'OUTBOX_PENDING' AND created_at < NOW() - INTERVAL '15 seconds'
                       FOR UPDATE SKIP LOCKED;
                     - Resends to pg-boss, guaranteeing zero dropped jobs.
```

### 5.1 Permitted State Transitions

| From State | To State | Trigger / Event | Guard Condition |
| :--- | :--- | :--- | :--- |
| **`PENDING`** | `PROCESSING` | Worker acquires job from pg-boss | `pgboss_job_id` matches, worker sets `started_at = NOW()` |
| **`PENDING`** | `CANCELLED` | User requests cancellation | Before worker picks up |
| **`PENDING`** | `FAILED` | Outbox max dispatch retries exceeded | Unable to enqueue in pg-boss after 5 retries |
| **`PROCESSING`** | `PROCESSING` | Worker heartbeat / progress update | `progress_percent` is non-decreasing; `last_heartbeat_at = NOW()` |
| **`PROCESSING`** | `COMPLETED` | Worker finishes generation / indexing | All test cases/chunks persisted, `completed_at = NOW()` |
| **`PROCESSING`** | `FAILED` | Unrecoverable error or max retries reached | Sanitized error recorded; terminal state |
| **`PROCESSING`** | `CANCELLED` | User cancels active job | Worker checks cancellation token and aborts |
| **`PROCESSING`** | `PENDING` | Watchdog detects stale heartbeat (`> 5m`) | `retry_count < max_retries`; increment `retry_count` and requeue |
| **`COMPLETED`** | *None* | **Terminal State** | Immutable |
| **`FAILED`** | *None* | **Terminal State** | Immutable |
| **`CANCELLED`** | *None* | **Terminal State** | Immutable |

---

## 6. Authoritative Document Version Activation

```sql
-- ============================================================================
-- 10-STEP ATOMIC VERSION ACTIVATION TRANSACTION
-- Parameters: $1 = documentId, $2 = projectId, $3 = versionId
-- ============================================================================

BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- 1 & 2. Lock parent document row and verify project ownership
SELECT id, active_version_id 
FROM ai_documents 
WHERE id = $1 AND project_id = $2 
FOR UPDATE;

-- 3. Lock candidate version row and verify ownership
SELECT id, document_id, indexing_status, total_chunks 
FROM ai_document_versions 
WHERE id = $3 AND document_id = $1 
FOR UPDATE;

-- 4. Confirm indexing status is COMPLETED
-- (Application validates candidate.indexing_status === 'COMPLETED'; if not, ROLLBACK)

-- 5. Confirm total_chunks > 0
-- (Application validates candidate.total_chunks > 0; if not, ROLLBACK)

-- 6. Resolve active embedding configuration model_id
SELECT id AS active_model_id 
FROM ai_embedding_config 
WHERE is_active = TRUE 
LIMIT 1;

-- 7. Confirm expected embedding count matches total_chunks
SELECT COUNT(*)::int AS count 
FROM ai_document_embeddings 
WHERE version_id = $3 AND model_id = $active_model_id;
-- (Application validates count === candidate.total_chunks; if not, ROLLBACK)

-- 8. Confirm no chunk is missing an embedding under the active model
SELECT EXISTS (
    SELECT 1 FROM ai_document_chunks c
    WHERE c.version_id = $3
      AND NOT EXISTS (
          SELECT 1 FROM ai_document_embeddings e
          WHERE e.chunk_id = c.id AND e.model_id = $active_model_id
      )
) AS has_missing;
-- (Application validates has_missing === false; if true, ROLLBACK)

-- 9. Prevent subsequent indexing writes & update active_version_id
UPDATE ai_documents 
SET active_version_id = $3, updated_at = NOW() 
WHERE id = $1;

-- 10. Commit transaction
COMMIT;
```

---

## 7. pgvector Metric Consistency (HNSW Cosine Distance)

To guarantee consistent vector similarity and index usage, **cosine distance (`<=>`) with `vector_cosine_ops`** is used uniformly:

### 7.1 DDL Index
```sql
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw_cosine 
    ON ai_document_embeddings USING hnsw (embedding vector_cosine_ops);
```

### 7.2 Retrieval Query
```sql
SELECT 
    c.id AS chunk_id,
    c.version_id,
    c.content,
    c.page_number,
    c.section_heading,
    1 - (e.embedding <=> $queryVector) AS cosine_similarity
FROM ai_document_embeddings e
JOIN ai_document_chunks c ON e.chunk_id = c.id
WHERE e.version_id = $activeVersionId 
  AND e.model_id = $activeModelId
ORDER BY e.embedding <=> $queryVector ASC
LIMIT $topK;
```

### 7.3 Benchmark Query
*Uses the identical `<=>` operator to ensure the HNSW index is traversed during latency benchmarks:*
```sql
EXPLAIN ANALYZE
SELECT e.chunk_id, e.embedding <=> $benchmarkVector AS distance
FROM ai_document_embeddings e
WHERE e.model_id = $activeModelId
ORDER BY e.embedding <=> $benchmarkVector ASC
LIMIT 5;
```

---

## 8. Windows Installation Procedure

### 8.1 PostgreSQL 16 on Windows 10
- **Installer**: Official EnterpriseDB (EDB) Windows x86-64 installer (`postgresql-16.x-x-windows-x64.exe`).
- **Binding**: `postgresql.conf` set to `listen_addresses = '127.0.0.1'`.

### 8.2 pgvector: Documented & Verified Installation Route
> [!IMPORTANT]
> Because official standalone precompiled Windows `.zip` releases are not published by the `pgvector` maintainers and third-party precompiled binaries cannot be guaranteed for arbitrary PostgreSQL minor builds, **Source Compilation via Visual C++ Build Tools is the documented, authoritative installation route**:

1. Install **Visual Studio C++ Build Tools** (Workload: *Desktop development with C++*).
2. Open **x64 Native Tools Command Prompt for VS** as Administrator.
3. Run the compilation commands:
   ```cmd
   set "PGROOT=C:\Program Files\PostgreSQL\16"
   cd %TEMP%
   git clone --branch v0.8.0 https://github.com/pgvector/pgvector.git
   cd pgvector
   nmake /F Makefile.win
   nmake /F Makefile.win install
   ```
4. Verify files were placed:
   - `C:\Program Files\PostgreSQL\16\lib\vector.dll`
   - `C:\Program Files\PostgreSQL\16\share\extension\vector.control`
5. Enable extension in `qa_ai_platform` as superuser:
   ```sql
   CREATE EXTENSION vector;
   SELECT extversion FROM pg_extension WHERE extname = 'vector';
   ```

### 8.3 Ollama Configuration (AVX CPU Mode)
- **Host CPU**: Intel Core i5-3470S (Ivy Bridge, AVX support, NO AVX2).
- **Installer**: Official Windows installer (`OllamaSetup.exe`).
- **Configuration** (System Environment Variables):
  - `OLLAMA_HOST=127.0.0.1:11434`
  - `OLLAMA_NUM_THREADS=3`
- **Models**:
  - `ollama pull nomic-embed-text` (Embedding: 768 dims, ~274 MB)
  - `ollama pull qwen2.5:3b-instruct` (Inference: 3B Q4_K_M, ~1.9 GB)

---

## 9. Regression Baseline Procedure for Phase 2

Before making any source code additions or running migrations in Phase 2, an automated baseline will be recorded.

### 9.1 Baseline Execution Command
```bash
node --test backend/tests/roboTest.test.js backend/tests/remoteConfig.test.js backend/tests/dialogShortcuts.test.js backend/tests/dynamicDocumentTitle.test.js
```

### 9.2 Milestone Verification Script (`backend/tests/verifyRegressionBaseline.js`)
Phase 2 executes this verification after each milestone:
1. Dynamically parses test output for total tests and passes (e.g. `ℹ tests (\d+)`, `ℹ pass (\d+)`, `ℹ fail (\d+)`).
2. Enforces `fail === 0` and `pass === baselineCount`.
3. Verifies existing QA tools (Robo Test, Remote Config, Builds, Devices, Diagnostics) remain healthy on ports `8080` (HTTPS) & `8081` (HTTP).

---

## 10. Remaining Risks & Phase 2 Checklist

### 10.1 Known Constraints
- **AVX Inference Throughput**: On an Ivy Bridge i5-3470S without AVX2, generation throughput for `qwen2.5:3b` is estimated at 5–9 tokens/sec. The asynchronous pg-boss worker design ensures frontend responsiveness regardless of generation duration.
- **Single-Host Isolation**: Localhost-only binding (`127.0.0.1`) guarantees security without network exposure.

### 10.2 Phase 2 Execution Roadmap
1. [ ] **Host Setup**: Install PostgreSQL 16, compile/install `pgvector`, install Ollama, pull models.
2. [ ] **Admin Init**: Run `000_admin_init.sql` as superuser `postgres`.
3. [ ] **Module DB Layer**: Create `backend/src/modules/aiTestWriter/db/` (`config.js`, `index.js`, `migrate.js`, `001_initial_ai_schema.sql`).
4. [ ] **Repositories & Middleware**: Implement Option B project access, resource ownership queries, and outbox job dispatcher.
5. [ ] **Verification**: Run `aiTestWriterDb.test.js` and verify regression baseline passes with 0 failures.
