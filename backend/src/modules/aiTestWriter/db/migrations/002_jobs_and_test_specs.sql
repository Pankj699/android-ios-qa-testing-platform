-- ============================================================================
-- Migration 002: Job Management & QA Test Specifications Schema
-- Phase 1 Approved Final Architecture (Tables 8 - 16)
-- ============================================================================

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
