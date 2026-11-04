-- ============================================================================
-- Migration 009: Asynchronous Requirement Analysis & Knowledge Grounding Schema
-- Extends Migration 002 with analysis tracking, composite foreign keys,
-- partial RTM indexes, job_type registration, and active requirement immutability.
-- ============================================================================

-- 1. Extend ai_generation_jobs CHECK constraint to include 'ANALYZE_REQUIREMENTS'
--    Preserves all 4 existing supported job types.
ALTER TABLE ai_generation_jobs 
    DROP CONSTRAINT IF EXISTS ai_generation_jobs_job_type_check;

ALTER TABLE ai_generation_jobs 
    ADD CONSTRAINT ai_generation_jobs_job_type_check 
    CHECK (job_type IN (
        'INDEX_DOCUMENT', 
        'GENERATE_TEST_CASES', 
        'REINDEX_DOCUMENT', 
        'EXPORT_SUITE', 
        'ANALYZE_REQUIREMENTS'
    ));

-- 2. Enforce non-null idempotency_key for ANALYZE_REQUIREMENTS
ALTER TABLE ai_generation_jobs 
    DROP CONSTRAINT IF EXISTS chk_ai_jobs_analyze_idempotency_not_null;

ALTER TABLE ai_generation_jobs 
    ADD CONSTRAINT chk_ai_jobs_analyze_idempotency_not_null 
    CHECK (job_type != 'ANALYZE_REQUIREMENTS' OR idempotency_key IS NOT NULL);

-- 3. Project-Scoped Idempotency Index on ai_generation_jobs
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_jobs_project_idempotency 
    ON ai_generation_jobs (project_id, idempotency_key) 
    WHERE status IN ('PENDING', 'PROCESSING', 'COMPLETED');

-- 4. Requirement Analysis Sessions Table
CREATE TABLE IF NOT EXISTS ai_requirement_analyses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    job_id UUID REFERENCES ai_generation_jobs(id) ON DELETE SET NULL,
    task_reference VARCHAR(255),
    task_title VARCHAR(255) NOT NULL,
    task_description TEXT NOT NULL,
    raw_input_type VARCHAR(50) NOT NULL 
        CHECK (raw_input_type IN ('TEXT_ONLY', 'TICKET_ONLY', 'HYBRID_TEXT_TICKET', 'WITH_ATTACHMENT')),
    attachment_metadata JSONB NOT NULL DEFAULT '[]',
    status VARCHAR(50) NOT NULL DEFAULT 'COMPLETED' 
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    grounding_mode VARCHAR(50) NOT NULL DEFAULT 'GROUNDED' 
        CHECK (grounding_mode IN ('GROUNDED', 'UNGROUNDED_NO_KB', 'PARTIALLY_GROUNDED', 'DEGRADED_KEYWORD_ONLY')),
    retrieved_chunks JSONB NOT NULL DEFAULT '[]',
    analysis_summary TEXT,
    features_and_modules JSONB NOT NULL DEFAULT '[]',
    user_workflows JSONB NOT NULL DEFAULT '[]',
    api_dependencies JSONB NOT NULL DEFAULT '[]',
    gap_analysis JSONB NOT NULL DEFAULT '{
        "missing_requirements": [],
        "ambiguities": [],
        "conflicting_information": [],
        "unsupported_assumptions": [],
        "open_questions": []
    }',
    model_name VARCHAR(100) NOT NULL DEFAULT 'qwen2.5:3b-instruct',
    prompt_tokens INT CHECK (prompt_tokens >= 0),
    completion_tokens INT CHECK (completion_tokens >= 0),
    duration_ms INT CHECK (duration_ms >= 0),
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ai_req_analysis_id_project UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_req_analysis_project ON ai_requirement_analyses(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_req_analysis_created ON ai_requirement_analyses(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_req_analysis_task_ref ON ai_requirement_analyses(project_id, task_reference);

-- 5. Additive Columns on ai_requirements
ALTER TABLE ai_requirements 
    ADD COLUMN IF NOT EXISTS analysis_id UUID,
    ADD COLUMN IF NOT EXISTS source_classification VARCHAR(50) NOT NULL DEFAULT 'DIRECT' 
        CHECK (source_classification IN ('DIRECT', 'GROUNDED_INFERENCE', 'ASSUMPTION')),
    ADD COLUMN IF NOT EXISTS business_rules JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS validations JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS dependencies JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS acceptance_criteria JSONB NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS evidence_citations JSONB NOT NULL DEFAULT '[]';

-- 6. PostgreSQL 16 Column-Specific Composite Foreign Key:
--    Setting NULL ONLY on analysis_id preserves project_id and the requirement row!
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_req_analysis_project'
    ) THEN
        ALTER TABLE ai_requirements
            ADD CONSTRAINT fk_req_analysis_project 
            FOREIGN KEY (analysis_id, project_id) 
            REFERENCES ai_requirement_analyses(id, project_id) 
            ON DELETE SET NULL (analysis_id);
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_req_analysis_id ON ai_requirements(analysis_id);

-- 7. Partial Unique Index on ai_requirement_traceability for idempotent chunk links without test cases
CREATE UNIQUE INDEX IF NOT EXISTS uq_rtm_req_chunk_null_tc 
    ON ai_requirement_traceability(requirement_id, chunk_id) 
    WHERE test_case_id IS NULL;

-- 8. Complete ACTIVE Requirement Immutability Trigger
CREATE OR REPLACE FUNCTION trg_enforce_active_requirement_immutability()
RETURNS TRIGGER AS $$
BEGIN
    -- If the requirement is already ACTIVE, protect all core specification fields from unauthorized modification
    IF OLD.status = 'ACTIVE' THEN
        -- 1. Prevent downgrade to DRAFT
        IF NEW.status = 'DRAFT' THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Requirement % is ACTIVE and cannot be downgraded to DRAFT.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 2. Protect req_key
        IF OLD.req_key IS DISTINCT FROM NEW.req_key THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify req_key of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 3. Protect title
        IF OLD.title IS DISTINCT FROM NEW.title THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify title of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 4. Protect description
        IF OLD.description IS DISTINCT FROM NEW.description THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify description of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 5. Protect category
        IF OLD.category IS DISTINCT FROM NEW.category THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify category of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 6. Protect priority
        IF OLD.priority IS DISTINCT FROM NEW.priority THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify priority of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 7. Protect business_rules
        IF OLD.business_rules IS DISTINCT FROM NEW.business_rules THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify business_rules of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 8. Protect validations
        IF OLD.validations IS DISTINCT FROM NEW.validations THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify validations of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 9. Protect dependencies
        IF OLD.dependencies IS DISTINCT FROM NEW.dependencies THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify dependencies of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 10. Protect acceptance_criteria
        IF OLD.acceptance_criteria IS DISTINCT FROM NEW.acceptance_criteria THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify acceptance_criteria of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 11. Protect evidence_citations
        IF OLD.evidence_citations IS DISTINCT FROM NEW.evidence_citations THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify evidence_citations of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 12. Protect analysis_id
        IF OLD.analysis_id IS DISTINCT FROM NEW.analysis_id THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify analysis_id of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- 13. Protect project_id
        IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify project_id of ACTIVE requirement %.',
                OLD.id USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_active_requirement_immutability ON ai_requirements;
CREATE TRIGGER trg_active_requirement_immutability
BEFORE UPDATE ON ai_requirements
FOR EACH ROW EXECUTE FUNCTION trg_enforce_active_requirement_immutability();
