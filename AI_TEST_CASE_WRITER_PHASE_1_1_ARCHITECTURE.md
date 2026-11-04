# Phase 1.1: Architecture Corrections & Phase 2 Preparation
## AI Test Case Writer Subsystem

**Document Version:** 1.1.0  
**Date:** October 30, 2026  
**Status:** Architecture Blueprint (Read-Only Design Phase — No Code Modified)  
**Target:** Dedicated Local PostgreSQL 16 + pgvector + pg-boss + Ollama

---

## 1. Executive Summary & Mandatory Corrections

Following review of `AI_TEST_CASE_WRITER_PHASE_1_AUDIT.md`, this document establishes the mandatory architecture corrections prior to Phase 2 implementation:

1. **Preserve Existing Database Unconditionally**: The current application database (`pg-mem` synchronized to `auth_db.json`) and its migration engine (`backend/src/db/migrate.js`) remain 100% untouched. All existing QA tools (PAD Test, Device Locking, Mixpanel Validator, UI Inspector, Remote Config, Bug Desk, Firebase Robo Test) will continue operating without any changes.
2. **Dedicated AI PostgreSQL Database**: A separate local PostgreSQL 16+ instance (`qa_ai_platform`) with the native `pgvector` extension is introduced specifically for the AI module. It features an isolated connection pool, independent migrations, and independent backup procedures.
3. **Permanent Document Versioning & Zero-Contamination Knowledge Base**: Slicing documents into versioned entities (`ai_documents` $\rightarrow$ `ai_document_versions` $\rightarrow$ `ai_document_chunks`). Vector searches strictly query active document versions, preventing stale knowledge contamination.
4. **Structured QA Generation Schema**: Incorporating dedicated tables for Requirements, Test Suites, Scenarios, Test Cases, Checklists, Traceability Matrices, Generation History, and Human Reviews with 4-tier source classification (`DOCUMENT_BACKED`, `TICKET_BACKED`, `QA_INFERRED`, `NEEDS_CLARIFICATION`).
5. **Native Background Queue via `pg-boss`**: Utilizing PostgreSQL-native ACID job queueing on the dedicated AI database for asynchronous chunking, embedding, generation, and retry recovery without blocking Express request threads.
6. **Hardware-Realistic Model Strategy**: Benchmarking small Qwen models (`qwen2.5:3b-instruct` primary, `qwen2.5:1.5b-instruct` baseline) against the server's Intel Core i5-3470S CPU (no AVX2) and 7.15 GB available RAM.

---

## 2. Corrected Architecture Diagram

```mermaid
graph TD
    Client["Frontend SPA (React 18 + Vite + Tailwind CSS)<br/>Dual Port 8080 (HTTPS) / 8081 (HTTP)"]
    Gateway["Express 4.21 Gateway (src/index.js)"]
    AuthMW["Global Auth Middleware (src/middleware/auth.js)"]

    subgraph Existing_Subsystem ["Existing QA Subsystem (Untouched)"]
        ExistingRoutes["Existing Routes (/api/devices, /api/test, etc.)"]
        ExistingServices["Existing Services (PAD, Robo, Mixpanel, Lock)"]
        ExistingDBPool["Existing DB Engine (src/db/index.js)"]
        PGMem["pg-mem Engine (In-Memory Postgres)"]
        AuthDB["auth_db.json (Persistent JSON Disk Store)"]
    end

    subgraph AI_Subsystem ["Dedicated AI Test Case Writer Subsystem"]
        AIRoutes["AI Router (/api/ai-test-writer/*)"]
        AIControllers["AI Controllers (Projects, Docs, Tests, Jobs)"]
        AIServices["AI Orchestration (RAG, Chunker, Prompts, Exporter)"]
        AIPool["Dedicated AI DB Pool (src/modules/aiTestWriter/db/index.js)"]
        AIMigrate["Independent AI Migrations (src/modules/aiTestWriter/db/migrations/)"]
        PGBossWorker["pg-boss Background Worker (Indexing, Embed, Generation)"]
        OllamaClient["Ollama Client (http://127.0.0.1:11434)"]
    end

    subgraph Dedicated_AI_Database ["Dedicated AI PostgreSQL 16+ Instance"]
        Postgres16["Database: qa_ai_platform (Port 5432)"]
        PGVectorExt["Extension: pgvector (vector 768)"]
        PGBossSchema["pg-boss Queue Schema (pgboss.*)"]
        AITables["AI Tables (ai_projects, ai_documents, ai_test_cases, etc.)"]
    end

    subgraph Local_Inference ["Local AI Inference Runtime"]
        OllamaDaemon["Ollama Daemon (127.0.0.1:11434)"]
        EmbedModel["nomic-embed-text (768-dim)"]
        LLMModel["qwen2.5:3b-instruct (CPU Inference)"]
    end

    Client --> Gateway
    Gateway --> AuthMW
    AuthMW --> ExistingRoutes
    AuthMW --> AIRoutes

    ExistingRoutes --> ExistingServices
    ExistingServices --> ExistingDBPool
    ExistingDBPool --> PGMem
    PGMem <--> AuthDB

    AIRoutes --> AIControllers
    AIControllers --> AIServices
    AIControllers --> PGBossWorker
    AIServices --> AIPool
    PGBossWorker --> AIPool
    PGBossWorker --> OllamaClient
    AIServices --> OllamaClient
    AIMigrate --> AIPool

    AIPool --> Postgres16
    Postgres16 --> PGVectorExt
    Postgres16 --> PGBossSchema
    Postgres16 --> AITables

    OllamaClient --> OllamaDaemon
    OllamaDaemon --> EmbedModel
    OllamaDaemon --> LLMModel
```

---

## 3. Database Separation Strategy

The QA platform will operate two completely decoupled database connections:

| Attribute | Existing Application Database | Dedicated AI Database |
|---|---|---|
| **Database Engine** | `pg-mem` (in-memory PostgreSQL clone) | **Native PostgreSQL 16+** |
| **Storage Location** | `backend/data/auth_db.json` | Dedicated PostgreSQL Data Directory |
| **Port** | Embedded (N/A) | `5432` |
| **Database Name** | N/A (Internal) | `qa_ai_platform` |
| **Connection Configuration** | Internal default | `AI_DATABASE_URL=postgres://postgres:postgres@localhost:5432/qa_ai_platform` |
| **Connection Pool** | `backend/src/db/index.js` (`getPool()`) | `backend/src/modules/aiTestWriter/db/index.js` (`getAiPool()`) |
| **Migration Runner** | `backend/src/db/migrate.js` (`schema_migrations`) | `backend/src/modules/aiTestWriter/db/migrate.js` (`ai_schema_migrations`) |
| **Vector Extension** | Not supported | **`pgvector`** (v0.7.0+) |
| **Background Queue** | In-memory `Map` / child process events | **`pg-boss`** (ACID job tables in `pgboss` schema) |
| **Backup Procedure** | Automatic file copy of `auth_db.json` | `pg_dump -U postgres -d qa_ai_platform > backup_ai.sql` |
| **Failure Isolation** | Cannot affect AI database | If PostgreSQL service stops, existing QA tools remain 100% operational |

---

## 4. Re-evaluated Project Management

### Audit Findings on Existing Projects
Inspection of `bugDeskService.js`, `mixpanelCollectorService.js`, and `scoped-storage.js` confirmed:
* There is **no persistent internal relational `projects` table** in the existing application database.
* "Projects" in the existing platform are external identifiers:
  * PMS / Redmine project slug in Bug Desk (`cp-photo-editor-suite`, `iha_ios`).
  * External Mixpanel project token string in Mixpanel Validator.
  * Google Cloud Project ID string in Firebase Test Lab (`qa-platform-511411`).
  * App package names in `builds.json` (`com.planner.journal`).

### Resolution: Dedicated `ai_projects` Table with Optional Bridge Links
To avoid creating redundant duplicate structures while establishing relational integrity for the AI subsystem, the dedicated AI database will define `ai_projects`. It includes optional bridge fields to link existing PMS and Application contexts:

```sql
CREATE TABLE ai_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    app_package_name VARCHAR(255),            -- Optional bridge to builds.json
    pms_project_id VARCHAR(100),              -- Optional bridge to Redmine PMS
    mixpanel_project_id VARCHAR(100),         -- Optional bridge to Mixpanel
    created_by_user_id UUID NOT NULL,         -- References existing user UUID
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 5. Final Database ER Diagram

```mermaid
erDiagram
    ai_projects ||--o{ ai_documents : "manages"
    ai_projects ||--o{ ai_requirements : "scopes"
    ai_projects ||--o{ ai_test_suites : "owns"
    
    ai_documents ||--o{ ai_document_versions : "has versions"
    ai_document_versions ||--o{ ai_document_chunks : "chunked into"
    ai_document_chunks ||--o{ ai_document_embeddings : "vectorized into"

    ai_test_suites ||--o{ ai_test_scenarios : "contains"
    ai_test_scenarios ||--o{ ai_test_cases : "breaks down into"
    ai_test_suites ||--o{ ai_qa_checklists : "includes"

    ai_requirements ||--o{ ai_requirement_traceability : "traced by"
    ai_test_cases ||--o{ ai_requirement_traceability : "verifies"
    ai_document_chunks ||--o{ ai_requirement_traceability : "evidence source"

    ai_projects ||--o{ ai_generation_history : "tracks generation"
    ai_test_cases ||--o{ ai_human_reviews : "reviewed by"

    ai_documents {
        UUID id PK
        UUID project_id FK
        VARCHAR title
        VARCHAR original_filename
        VARCHAR document_type
        UUID active_version_id
        TIMESTAMPTZ created_at
    }

    ai_document_versions {
        UUID id PK
        UUID document_id FK
        INT version_number
        VARCHAR sha256_hash
        BIGINT file_size_bytes
        VARCHAR storage_path
        VARCHAR indexing_status
        INT total_chunks
        BOOLEAN is_active
        TIMESTAMPTZ created_at
    }

    ai_document_chunks {
        UUID id PK
        UUID document_version_id FK
        INT chunk_index
        TEXT content
        INT token_count
        INT page_number
        VARCHAR section_heading
        JSONB metadata
    }

    ai_document_embeddings {
        UUID id PK
        UUID chunk_id FK
        VARCHAR model_name
        VARCHAR model_version
        vector embedding
        TIMESTAMPTZ created_at
    }

    ai_requirements {
        UUID id PK
        UUID project_id FK
        VARCHAR req_key
        VARCHAR title
        TEXT description
        VARCHAR category
        VARCHAR priority
    }

    ai_test_cases {
        UUID id PK
        UUID scenario_id FK
        VARCHAR test_case_key
        VARCHAR title
        VARCHAR type
        VARCHAR priority
        VARCHAR source_classification
        TEXT preconditions
        JSONB test_steps
        TEXT expected_result
        JSONB evidence_references
    }
```

---

## 6. Complete Proposed Table Definitions (DDL)

```sql
-- ============================================================================
-- AI TEST CASE WRITER SUBSYSTEM DDL (qa_ai_platform)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- 1. Schema Migrations Tracker
CREATE TABLE IF NOT EXISTS ai_schema_migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Projects
CREATE TABLE IF NOT EXISTS ai_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    app_package_name VARCHAR(255),
    pms_project_id VARCHAR(100),
    mixpanel_project_id VARCHAR(100),
    created_by_user_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    settings JSONB NOT NULL DEFAULT '{
        "default_priority": "MEDIUM",
        "require_human_review": true,
        "default_model": "qwen2.5:3b-instruct"
    }',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_projects_created_by ON ai_projects(created_by_user_id);

-- 3. Documents (Permanent Identifier)
CREATE TABLE IF NOT EXISTS ai_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    document_type VARCHAR(50) NOT NULL, -- 'PDF', 'DOCX', 'XLSX', 'CSV', 'TXT'
    active_version_id UUID,             -- Deferred FK to ai_document_versions
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_docs_project ON ai_documents(project_id);

-- 4. Document Versions (Permanent Immutability)
CREATE TABLE IF NOT EXISTS ai_document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
    version_number INT NOT NULL,
    sha256_hash VARCHAR(64) NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    storage_path VARCHAR(512) NOT NULL,
    indexing_status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'CHUNKING', 'EMBEDDING', 'COMPLETED', 'FAILED'
    indexing_error TEXT,
    total_chunks INT NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    change_summary TEXT,
    uploaded_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    indexed_at TIMESTAMPTZ,
    CONSTRAINT uq_doc_version UNIQUE (document_id, version_number)
);
CREATE INDEX IF NOT EXISTS idx_doc_versions_doc_id ON ai_document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_versions_hash ON ai_document_versions(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_doc_versions_active ON ai_document_versions(document_id, is_active);

-- Circular FK for active version
ALTER TABLE ai_documents 
    DROP CONSTRAINT IF EXISTS fk_active_version,
    ADD CONSTRAINT fk_active_version FOREIGN KEY (active_version_id) 
    REFERENCES ai_document_versions(id) ON DELETE SET NULL;

-- 5. Document Chunks (Version-Isolated)
CREATE TABLE IF NOT EXISTS ai_document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_version_id UUID NOT NULL REFERENCES ai_document_versions(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL,
    content TEXT NOT NULL,
    token_count INT NOT NULL DEFAULT 0,
    page_number INT,
    section_heading VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_version_chunk UNIQUE (document_version_id, chunk_index)
);
CREATE INDEX IF NOT EXISTS idx_chunks_version_id ON ai_document_chunks(document_version_id);

-- 6. Document Embeddings (Configurable Vector Dimensions)
CREATE TABLE IF NOT EXISTS ai_document_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL REFERENCES ai_document_chunks(id) ON DELETE CASCADE,
    model_name VARCHAR(100) NOT NULL,       -- e.g. 'nomic-embed-text'
    model_version VARCHAR(50) NOT NULL,    -- e.g. 'v1.5'
    dimensions INT NOT NULL DEFAULT 768,
    embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chunk_model UNIQUE (chunk_id, model_name, model_version)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_chunk_id ON ai_document_embeddings(chunk_id);
-- HNSW Cosine Index for ultra-fast ANN search
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw_cosine 
    ON ai_document_embeddings USING hnsw (embedding vector_cosine_ops);

-- 7. Decomposed Requirements
CREATE TABLE IF NOT EXISTS ai_requirements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    req_key VARCHAR(50) NOT NULL,           -- e.g. 'REQ-AUTH-001'
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'FUNCTIONAL',
    priority VARCHAR(50) NOT NULL DEFAULT 'MEDIUM',
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_req_key UNIQUE (project_id, req_key)
);
CREATE INDEX IF NOT EXISTS idx_req_project ON ai_requirements(project_id);

-- 8. Test Suites
CREATE TABLE IF NOT EXISTS ai_test_suites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    suite_key VARCHAR(50) NOT NULL,          -- e.g. 'SUITE-001'
    title VARCHAR(255) NOT NULL,
    objective TEXT,
    target_module VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'DRAFT', -- 'DRAFT', 'UNDER_REVIEW', 'APPROVED', 'ARCHIVED'
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_suite_key UNIQUE (project_id, suite_key)
);
CREATE INDEX IF NOT EXISTS idx_suites_project ON ai_test_suites(project_id);

-- 9. Test Scenarios
CREATE TABLE IF NOT EXISTS ai_test_scenarios (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id UUID NOT NULL REFERENCES ai_test_suites(id) ON DELETE CASCADE,
    scenario_key VARCHAR(50) NOT NULL,       -- e.g. 'SCEN-001'
    title VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(50) NOT NULL DEFAULT 'POSITIVE', -- 'POSITIVE', 'NEGATIVE', 'BOUNDARY', 'SECURITY', 'EDGE_CASE'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_scenarios_suite ON ai_test_scenarios(suite_id);

-- 10. Detailed Test Cases
CREATE TABLE IF NOT EXISTS ai_test_cases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scenario_id UUID NOT NULL REFERENCES ai_test_scenarios(id) ON DELETE CASCADE,
    test_case_key VARCHAR(50) NOT NULL,      -- e.g. 'TC-AUTH-001'
    title VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'FUNCTIONAL',
    priority VARCHAR(50) NOT NULL DEFAULT 'MEDIUM', -- 'P0', 'P1', 'P2', 'P3' or 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
    source_classification VARCHAR(50) NOT NULL DEFAULT 'DOCUMENT_BACKED', 
    -- 'DOCUMENT_BACKED', 'TICKET_BACKED', 'QA_INFERRED', 'NEEDS_CLARIFICATION'
    preconditions TEXT,
    test_steps JSONB NOT NULL DEFAULT '[]',  -- Array of: { step_number, action, test_data, expected_result }
    expected_result TEXT NOT NULL,
    actual_result TEXT,
    evidence_references JSONB NOT NULL DEFAULT '[]', -- Array of: { chunk_id, doc_id, doc_version, page, snippet, score }
    execution_status VARCHAR(50) NOT NULL DEFAULT 'UNTESTED',
    review_status VARCHAR(50) NOT NULL DEFAULT 'PENDING_REVIEW', -- 'PENDING_REVIEW', 'APPROVED', 'REJECTED', 'MODIFIED'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tc_scenario ON ai_test_cases(scenario_id);
CREATE INDEX IF NOT EXISTS idx_tc_source ON ai_test_cases(source_classification);
CREATE INDEX IF NOT EXISTS idx_tc_review ON ai_test_cases(review_status);

-- 11. QA Checklists
CREATE TABLE IF NOT EXISTS ai_qa_checklists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id UUID NOT NULL REFERENCES ai_test_suites(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    items JSONB NOT NULL DEFAULT '[]',       -- Array of: { id, label, category, checked: false, notes: "" }
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_checklists_suite ON ai_qa_checklists(suite_id);

-- 12. Requirement Traceability Matrix
CREATE TABLE IF NOT EXISTS ai_requirement_traceability (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requirement_id UUID NOT NULL REFERENCES ai_requirements(id) ON DELETE CASCADE,
    test_case_id UUID REFERENCES ai_test_cases(id) ON DELETE CASCADE,
    chunk_id UUID REFERENCES ai_document_chunks(id) ON DELETE SET NULL,
    trace_type VARCHAR(50) NOT NULL DEFAULT 'DIRECT_COVERAGE', -- 'DIRECT_COVERAGE', 'DERIVED_COVERAGE'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_req_tc UNIQUE (requirement_id, test_case_id)
);
CREATE INDEX IF NOT EXISTS idx_rtm_req ON ai_requirement_traceability(requirement_id);
CREATE INDEX IF NOT EXISTS idx_rtm_tc ON ai_requirement_traceability(test_case_id);

-- 13. Generation & Prompt History
CREATE TABLE IF NOT EXISTS ai_generation_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    suite_id UUID REFERENCES ai_test_suites(id) ON DELETE SET NULL,
    user_id UUID NOT NULL,
    model_name VARCHAR(100) NOT NULL,
    prompt_tokens INT,
    completion_tokens INT,
    total_duration_ms INT,
    system_prompt TEXT NOT NULL,
    user_prompt TEXT NOT NULL,
    retrieved_chunk_ids JSONB NOT NULL DEFAULT '[]',
    raw_response TEXT NOT NULL,
    parsed_json JSONB,
    validation_status VARCHAR(50) NOT NULL DEFAULT 'VALID',
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gen_hist_proj ON ai_generation_history(project_id);

-- 14. Human Review History
CREATE TABLE IF NOT EXISTS ai_human_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_case_id UUID NOT NULL REFERENCES ai_test_cases(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    review_action VARCHAR(50) NOT NULL,      -- 'APPROVED', 'REJECTED', 'EDITED'
    previous_state JSONB NOT NULL,
    updated_state JSONB NOT NULL,
    reviewer_notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reviews_tc ON ai_human_reviews(test_case_id);
```

---

## 7. Document Versioning & Anti-Contamination Workflow

### 1. Document Lifecycle State Machine

```mermaid
stateDiagram-v2
    [*] --> UPLOADED: Upload BRD / Spec file
    UPLOADED --> SHA256_CHECK: Calculate SHA-256
    
    state SHA256_CHECK {
        [*] --> CompareHash
        CompareHash --> IdenticalExists: Hash matches active version
        CompareHash --> CreateVersion: New hash or forced update
    }
    
    IdenticalExists --> REUSE_ACTIVE: Reject duplicate / return active
    CreateVersion --> CHUNKING: Generate ai_document_versions (status='CHUNKING')
    
    CHUNKING --> EMBEDDING: Chunked into 600-char slices (status='EMBEDDING')
    CHUNKING --> FAILED: Parser error
    
    EMBEDDING --> READY_INACTIVE: Vectorized into pgvector
    EMBEDDING --> FAILED: Ollama unreachable / timeout
    
    FAILED --> RETRY_INDEX: Retry via pg-boss job
    RETRY_INDEX --> EMBEDDING
    
    READY_INACTIVE --> ATOMIC_ACTIVATION: User/System confirms switch
    ATOMIC_ACTIVATION --> ACTIVE: Set is_active=TRUE, deactivate old version
    
    ACTIVE --> ROLLBACK: Rollback to previous version
    ROLLBACK --> ACTIVE: Swap active pointers
```

### 2. Zero-Contamination Knowledge Retrieval Rule
To prevent older document chunks from polluting RAG prompt contexts, all vector retrieval queries enforce an inner join with the verified active version:

```sql
SELECT 
    c.id AS chunk_id,
    c.content,
    c.page_number,
    c.section_heading,
    1 - (e.embedding <=> $1) AS cosine_similarity
FROM ai_document_embeddings e
JOIN ai_document_chunks c ON c.id = e.chunk_id
JOIN ai_document_versions v ON v.id = c.document_version_id
JOIN ai_documents d ON d.id = v.document_id
WHERE d.project_id = $2
  AND v.is_active = TRUE
  AND v.indexing_status = 'COMPLETED'
  AND e.model_name = $3
ORDER BY e.embedding <=> $1
LIMIT $4;
```
*Result*: Even if 10 older versions of a specification exist in the database, only the currently active, approved version's chunks can ever be retrieved.

---

## 8. Vector Retrieval Architecture

1. **Dedicated pgvector Engine**:
   * Distance Metric: Cosine Distance (`vector_cosine_ops`, operator `<=>`).
   * Index Algorithm: **HNSW (Hierarchical Navigable Small World)** with `m = 16`, `ef_construction = 64`. Provides sub-5ms nearest-neighbor lookups over thousands of document chunks on local storage.
2. **Configurable Embeddings**:
   * Default: `nomic-embed-text` (768 dimensions, 8192 context).
   * Dimensions and Model Name are explicit columns in `ai_document_embeddings`.
3. **Model Versioning & Migration**:
   * If the embedding model is upgraded (e.g. from `nomic-embed-text:v1.5` to a newer model), a background re-indexing job is queued:
     1. Creates new embedding rows with `model_name = 'new-model'` while existing embeddings continue serving queries.
     2. Verifies completion across 100% of active chunks.
     3. Atomically switches the project's active `embedding_model_name` setting.
     4. Safely purges superseded embedding rows.

---

## 9. AI Model Setup Strategy & Hardware Benchmark Plan

### Hardware Profile
* **Host Machine**: Intel Core i5-3470S (4 cores, 2.90 GHz base / 3.60 GHz turbo, Ivy Bridge).
* **Instruction Sets**: AVX, F16C (**No AVX2, No AVX-512**).
* **System RAM**: 15.88 GB Total (**~7.15 GB Free**).
* **GPU**: Intel HD Graphics 2500 (Integrated, CPU execution mode only).

### Model Selection Evaluation Matrix
| Candidate Model | Quantization | Model Weight RAM | KV Cache (4k Context) | Total RAM Footprint | Feasibility on i5-3470S (7.15 GB Free) |
|---|---|---|---|---|---|
| **`qwen2.5:1.5b-instruct`** | Q4_K_M | ~1.1 GB | ~0.2 GB | **~1.3 GB** | **Ultra-Fast Baseline** (15–25 tokens/s). Low memory, ideal for smoke testing. |
| **`qwen2.5:3b-instruct`** | Q4_K_M | ~2.0 GB | ~0.4 GB | **~2.4 GB** | **Primary Recommended Engine**. Exceptional structured JSON test output; safe 4.7 GB RAM headroom. |
| **`qwen2.5:7b-instruct`** | Q4_K_M | ~4.7 GB | ~1.1 GB | **~5.8 GB** | **Optional High-Reasoning**. Squeezes available RAM (leaves < 1.3 GB). Batch mode only. |
| **`qwen2.5:8b` / `qwen3:8b`** | Q4_K_M | ~5.2 GB | ~1.5 GB | **~6.7 GB** | **High Risk**. High probability of pagefile swap thrashing on 7.15 GB free RAM. |

### Rigorous Model Benchmarking Plan
Prior to locking the production prompt templates in Phase 4, an automated benchmark script (`scripts/benchmark_models.js`) will execute across 10 standardized QA requirement prompts measuring:
1. **RAM Allocation**: Measured via `process.memoryUsage().rss` and OS `os.freemem()` before, during, and after inference.
2. **CPU Saturation**: Measured via `os.cpus()` sampling over generation window.
3. **Latency Profile**:
   * Time to First Token (TTFT).
   * Average Tokens Per Second (TPS).
   * Total Generation Duration (seconds).
4. **JSON Schema Validity**: Pass rate (%) of raw completion parsed against the strict `ai_test_case` Ajv schema on first attempt.
5. **QA Test Case Quality Metric**:
   * Ratio of positive vs. negative test scenarios.
   * Presence of boundary value analysis.
   * Specificity of test steps and verifiable expected results.

---

## 10. Background Job Architecture (`pg-boss`)

To guarantee that Express request threads are never blocked by heavy CPU inference or document slicing, all asynchronous operations will be executed via **`pg-boss`** connected directly to the dedicated AI database.

```mermaid
sequenceDiagram
    autonumber
    actor QA as QA Tester
    participant API as Express API Thread
    participant PGBoss as pg-boss Job Queue (qa_ai_platform)
    participant Worker as Background Worker Process
    participant Ollama as Ollama Daemon

    QA->>API: POST /api/ai-test-writer/generate (User Story Prompt)
    API->>PGBoss: boss.send('ai:generate-suite', { projectId, prompt, userId })
    API-->>QA: 202 Accepted { jobId, status: 'QUEUED' }

    Note over API,QA: Express thread is immediately free to handle other traffic

    PGBoss->>Worker: Job dispatched (ACID SKIP LOCKED)
    Worker->>PGBoss: boss.setJobProgress(jobId, 20)
    Worker->>Ollama: Embed prompt & retrieve active chunks
    Worker->>Ollama: Generate structured test cases (Qwen2.5)
    Worker->>Worker: Validate with Ajv Schema
    Worker->>PGBoss: Store test suite & cases in DB
    Worker->>PGBoss: boss.complete(jobId)

    QA->>API: GET /api/ai-test-writer/jobs/:jobId
    API-->>QA: { status: 'COMPLETED', suiteId: '...' }
```

### Registered Job Types:
1. **`ai:document-ingest`**: Reads uploaded file, parses text, slices chunks, and triggers embedding queue.
2. **`ai:document-embed`**: Generates 768-dim vectors via `nomic-embed-text` with retry backoff.
3. **`ai:generate-suite`**: Executes semantic retrieval, prompt assembly, and LLM generation.
4. **`ai:reindex-collection`**: Re-computes embeddings if a new model version is activated.

---

## 11. Updated Folder Structure

All AI module source code is isolated under `backend/src/modules/aiTestWriter/`:

```
backend/
├── src/
│   ├── modules/
│   │   └── aiTestWriter/
│   │       ├── db/
│   │       │   ├── index.js                  # Dedicated PostgreSQL 16 connection pool (aiDbPool)
│   │       │   ├── migrate.js                # Independent AI schema migration runner
│   │       │   └── migrations/
│   │       │       └── 001_initial_ai_schema.sql # Complete DDL definition
│   │       ├── controllers/
│   │       │   ├── aiProjectController.js    # Project workspaces CRUD
│   │       │   ├── aiDocumentController.js   # Document upload, versioning & retrieval
│   │       │   ├── aiTestCaseController.js   # Test suites, scenarios, cases & human reviews
│   │       │   ├── aiJobController.js        # Background job status & progress polling
│   │       │   └── aiExportController.js     # ExcelJS export (.xlsx) & CSV endpoints
│   │       ├── services/
│   │       │   ├── documentParserService.js  # Clean text extraction for PDF, DOCX, XLSX, CSV, TXT
│   │       │   ├── textChunkerService.js     # 600-char semantic chunker with token estimator
│   │       │   ├── ollamaService.js          # Direct Ollama HTTP client with timeout & retry
│   │       │   ├── ragRetrievalService.js    # pgvector Cosine ANN search with active-version filter
│   │       │   ├── testCaseGeneratorService.js # Prompt orchestration & LLM generation
│   │       │   ├── excelExportService.js     # Styled Excel spreadsheet generator
│   │       │   └── jobQueueService.js        # pg-boss job scheduler and progress tracker
│   │       ├── prompts/
│   │       │   ├── systemPrompts.js          # Expert QA Engineer system persona
│   │       │   ├── testCasePromptTemplate.js # User Story & Acceptance Criteria prompts
│   │       │   └── schemaDefinitions.js      # Strict Ajv validation schemas for JSON output
│   │       ├── repositories/
│   │       │   ├── aiProjectRepository.js    # SQL access for ai_projects
│   │       │   ├── aiDocumentRepository.js   # SQL access for documents, versions & chunks
│   │       │   ├── vectorRepository.js       # pgvector distance queries (<=>)
│   │       │   └── aiTestCaseRepository.js   # SQL access for suites, test cases & reviews
│   │       ├── validators/
│   │       │   ├── documentUploadValidator.js# Multer MIME and file extension check
│   │       │   └── testCaseSchemaValidator.js# Ajv schema verification for LLM completions
│   │       ├── workers/
│   │       │   └── aiWorker.js               # pg-boss worker consumer process
│   │       └── routes/
│   │           └── aiTestWriterRoutes.js     # Router mounted at /api/ai-test-writer
│   └── index.js                              # Mounts AI router (single non-intrusive line)

frontend/
├── src/
│   ├── pages/
│   │   └── AiTestWriterPage.jsx              # Main workbench view
│   └── components/aiTestWriter/
│       ├── ProjectWorkspaceHeader.jsx        # Project selector & document count badge
│       ├── DocumentVersionManager.jsx        # Document list, version history & active toggle
│       ├── DocumentUploadModal.jsx           # Drag-and-drop file upload with format hints
│       ├── GenerationPromptCard.jsx          # Model selector, prompt input & parameters
│       ├── TestCaseDataGrid.jsx              # Searchable, filterable test case review table
│       ├── TestCaseDetailDrawer.jsx          # Full step inspection & evidence citation viewer
│       ├── HumanReviewActions.jsx            # Approve, Reject, Edit & Clarification badge
│       └── ExcelExportButton.jsx             # One-click styled .xlsx download
```

---

## 12. Implementation Roadmap & Risks

```mermaid
gantt
    title Revised AI Test Case Writer Implementation Roadmap
    dateFormat  YYYY-MM-DD
    section Phase 1.1
    Architecture Corrections & Preparation :done, p11, 2026-10-30, 1d
    section Phase 2
    Dedicated DB Setup & Migrations        :active, p2, 2026-10-31, 2d
    section Phase 3
    Document Versioning & Ingestion Engine :p3, 2026-11-02, 3d
    section Phase 4
    Model Benchmarking & Ollama Pipeline   :p4, 2026-11-05, 3d
    section Phase 5
    RAG Generation & pg-boss Background Jobs :p5, 2026-11-08, 3d
    section Phase 6
    Excel Export & Human Review Workflow   :p6, 2026-11-11, 2d
    section Phase 7
    Frontend UI & Full Platform Verification:p7, 2026-11-13, 3d
```

### Key Technical Risks & Exact Mitigations
1. **CPU Starvation During Inference**:
   * *Risk*: The i5-3470S has 4 cores. If Ollama utilizes all 4 cores, WebSocket mirroring or ADB execution could hitch.
   * *Mitigation*: Configure Ollama with `OLLAMA_NUM_THREADS=3` so 1 core remains permanently unblocked for the Node.js event loop and existing QA utilities.
2. **PostgreSQL Service Interruption**:
   * *Risk*: If local PostgreSQL restarts, Express might crash if connection pooling is not fault-tolerant.
   * *Mitigation*: Dedicated `aiDbPool` wrapped in reconnect logic. Health check endpoint `/api/ai-test-writer/health` reports status independently without taking down main platform routes.
3. **RAG Vector Search Contamination**:
   * *Risk*: Older versions of uploaded documents being returned in similarity search.
   * *Mitigation*: Hard SQL join constraint `WHERE v.is_active = TRUE` ensures 0% contamination from superseded document versions.

---

## 13. Exact Phase 2 Implementation Checklist

When user approval is granted, Phase 2 will execute strictly within the following checklist:

- [ ] **Step 1: AI Database Configuration File**
  * Create `backend/src/modules/aiTestWriter/db/config.js` defining `AI_DATABASE_URL` with local defaults (`postgres://postgres:postgres@localhost:5432/qa_ai_platform`).
- [ ] **Step 2: Dedicated AI Connection Pool**
  * Create `backend/src/modules/aiTestWriter/db/index.js` exporting `aiQuery(text, params)`, `getAiClient()`, and `getAiPool()`.
  * Ensure this pool is completely separate from `backend/src/db/index.js`.
- [ ] **Step 3: AI Schema Migration Engine**
  * Create `backend/src/modules/aiTestWriter/db/migrate.js` with `runAiMigrations()`.
  * Create `backend/src/modules/aiTestWriter/db/migrations/001_initial_ai_schema.sql` containing the complete DDL tables defined in Section 6.
- [ ] **Step 4: AI Repositories Layer**
  * Implement `aiProjectRepository.js` (Project CRUD).
  * Implement `aiDocumentRepository.js` (Document & Document Version CRUD with active version toggling).
  * Implement `aiTestCaseRepository.js` (Suites, Scenarios, Test Cases & Human Reviews CRUD).
  * Implement `vectorRepository.js` (`pgvector` HNSW cosine distance queries).
- [ ] **Step 5: Automated Verification Test Suite**
  * Create `backend/tests/aiTestWriterDb.test.js` verifying:
    1. Dedicated connection to `qa_ai_platform`.
    2. Execution of migrations and creation of all 14 tables.
    3. Document version isolation (verifying version 1 chunks are excluded when version 2 is active).
    4. Inserting and querying 768-dimensional test vectors using `<=>`.
    5. Zero impact on existing `pg-mem` database (running all 71 existing QA platform tests and verifying 100% pass rate).

---

**Next Step**: Await user review and approval of `AI_TEST_CASE_WRITER_PHASE_1_1_ARCHITECTURE.md` before executing Phase 2.
