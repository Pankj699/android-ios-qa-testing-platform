-- ============================================================================
-- Migration 011: Phase 2.8 Test Scenario & Test Case Generation
-- Integrity, Human Reviews, Proposals, and Corpus Fingerprinting
-- ============================================================================

-- 1. Ensure unique constraint on ai_test_suites for composite foreign keys
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_ai_suites_id_project'
    ) THEN
        ALTER TABLE ai_test_suites ADD CONSTRAINT uq_ai_suites_id_project UNIQUE (id, project_id);
    END IF;
END $$;

-- 2. Modify ai_human_reviews for suite & case level reviews with deferred audit retention
DO $$
BEGIN
    -- Add project_id column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ai_human_reviews' AND column_name = 'project_id'
    ) THEN
        ALTER TABLE ai_human_reviews ADD COLUMN project_id UUID REFERENCES ai_projects(id) ON DELETE CASCADE;
    END IF;

    -- Add suite_id column if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ai_human_reviews' AND column_name = 'suite_id'
    ) THEN
        ALTER TABLE ai_human_reviews ADD COLUMN suite_id UUID;
    END IF;

    -- Add snapshot columns if not exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ai_human_reviews' AND column_name = 'suite_key_snapshot'
    ) THEN
        ALTER TABLE ai_human_reviews ADD COLUMN suite_key_snapshot VARCHAR(50);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ai_human_reviews' AND column_name = 'test_case_key_snapshot'
    ) THEN
        ALTER TABLE ai_human_reviews ADD COLUMN test_case_key_snapshot VARCHAR(50);
    END IF;
END $$;

-- Drop existing test_case_id NOT NULL constraint if present
ALTER TABLE ai_human_reviews ALTER COLUMN test_case_id DROP NOT NULL;

-- Update foreign keys to DEFERRABLE NO ACTION for audit retention
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ai_human_reviews_test_case_id_fkey'
    ) THEN
        ALTER TABLE ai_human_reviews DROP CONSTRAINT ai_human_reviews_test_case_id_fkey;
    END IF;
END $$;

ALTER TABLE ai_human_reviews 
    ADD CONSTRAINT ai_human_reviews_test_case_id_fkey 
    FOREIGN KEY (test_case_id) REFERENCES ai_test_cases(id) 
    ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'ai_human_reviews_suite_id_fkey'
    ) THEN
        ALTER TABLE ai_human_reviews 
            ADD CONSTRAINT ai_human_reviews_suite_id_fkey 
            FOREIGN KEY (suite_id) REFERENCES ai_test_suites(id) 
            ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
    END IF;
END $$;

-- Exactly one target check constraint
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_human_review_single_target'
    ) THEN
        ALTER TABLE ai_human_reviews 
            ADD CONSTRAINT chk_human_review_single_target 
            CHECK (
                (test_case_id IS NOT NULL AND suite_id IS NULL) OR 
                (test_case_id IS NULL AND suite_id IS NOT NULL)
            );
    END IF;
END $$;

-- Triggers on ai_human_reviews: Snapshot auto-population and Immutability
CREATE OR REPLACE FUNCTION trg_ai_human_reviews_insert() RETURNS TRIGGER AS $$
DECLARE
    v_actual_project_id UUID;
    v_actual_suite_key VARCHAR(50);
    v_actual_tc_key VARCHAR(50);
BEGIN
    IF NEW.suite_id IS NOT NULL THEN
        SELECT project_id, suite_key INTO v_actual_project_id, v_actual_suite_key
        FROM ai_test_suites WHERE id = NEW.suite_id;

        IF v_actual_project_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Suite % does not exist.', NEW.suite_id USING ERRCODE = '23503';
        END IF;

        IF NEW.project_id IS DISTINCT FROM v_actual_project_id THEN
            RAISE EXCEPTION 'ProjectMismatchViolation: Review project_id % does not match suite project_id %.',
                NEW.project_id, v_actual_project_id USING ERRCODE = '23514';
        END IF;

        IF NEW.suite_key_snapshot IS NOT NULL AND NEW.suite_key_snapshot IS DISTINCT FROM v_actual_suite_key THEN
            RAISE EXCEPTION 'ForgedSnapshotViolation: Supplied suite_key_snapshot does not match genuine suite_key %.',
                v_actual_suite_key USING ERRCODE = '23514';
        END IF;

        NEW.suite_key_snapshot := v_actual_suite_key;
        NEW.test_case_key_snapshot := NULL;

    ELSIF NEW.test_case_id IS NOT NULL THEN
        SELECT s.project_id, s.suite_key, tc.test_case_key 
        INTO v_actual_project_id, v_actual_suite_key, v_actual_tc_key
        FROM ai_test_cases tc
        JOIN ai_test_scenarios sc ON sc.id = tc.scenario_id
        JOIN ai_test_suites s ON s.id = sc.suite_id
        WHERE tc.id = NEW.test_case_id;

        IF v_actual_project_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Test case % does not exist.', NEW.test_case_id USING ERRCODE = '23503';
        END IF;

        IF NEW.project_id IS DISTINCT FROM v_actual_project_id THEN
            RAISE EXCEPTION 'ProjectMismatchViolation: Review project_id % does not match test case project_id %.',
                NEW.project_id, v_actual_project_id USING ERRCODE = '23514';
        END IF;

        IF NEW.test_case_key_snapshot IS NOT NULL AND NEW.test_case_key_snapshot IS DISTINCT FROM v_actual_tc_key THEN
            RAISE EXCEPTION 'ForgedSnapshotViolation: Supplied test_case_key_snapshot does not match genuine test_case_key %.',
                v_actual_tc_key USING ERRCODE = '23514';
        END IF;

        IF NEW.suite_key_snapshot IS NOT NULL AND NEW.suite_key_snapshot IS DISTINCT FROM v_actual_suite_key THEN
            RAISE EXCEPTION 'ForgedSnapshotViolation: Supplied suite_key_snapshot does not match genuine suite_key %.',
                v_actual_suite_key USING ERRCODE = '23514';
        END IF;

        NEW.test_case_key_snapshot := v_actual_tc_key;
        NEW.suite_key_snapshot := v_actual_suite_key;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_human_reviews_before_insert ON ai_human_reviews;
CREATE TRIGGER trg_ai_human_reviews_before_insert 
BEFORE INSERT ON ai_human_reviews 
FOR EACH ROW EXECUTE FUNCTION trg_ai_human_reviews_insert();

CREATE OR REPLACE FUNCTION trg_ai_human_reviews_update() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.suite_key_snapshot IS DISTINCT FROM OLD.suite_key_snapshot THEN
        RAISE EXCEPTION 'ImmutableViolation: suite_key_snapshot cannot be modified.' USING ERRCODE = '23514';
    END IF;
    IF NEW.test_case_key_snapshot IS DISTINCT FROM OLD.test_case_key_snapshot THEN
        RAISE EXCEPTION 'ImmutableViolation: test_case_key_snapshot cannot be modified.' USING ERRCODE = '23514';
    END IF;
    IF NEW.suite_id IS DISTINCT FROM OLD.suite_id THEN
        RAISE EXCEPTION 'ImmutableViolation: suite_id cannot be reassigned.' USING ERRCODE = '23514';
    END IF;
    IF NEW.test_case_id IS DISTINCT FROM OLD.test_case_id THEN
        RAISE EXCEPTION 'ImmutableViolation: test_case_id cannot be reassigned.' USING ERRCODE = '23514';
    END IF;
    IF NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        RAISE EXCEPTION 'ImmutableViolation: project_id cannot be reassigned.' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_human_reviews_before_update ON ai_human_reviews;
CREATE TRIGGER trg_ai_human_reviews_before_update 
BEFORE UPDATE ON ai_human_reviews 
FOR EACH ROW EXECUTE FUNCTION trg_ai_human_reviews_update();

-- 3. Create ai_test_case_proposals Table
CREATE TABLE IF NOT EXISTS ai_test_case_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suite_id UUID NOT NULL,
    project_id UUID NOT NULL,
    proposal_key VARCHAR(50) NOT NULL,
    scenario_name VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    preconditions TEXT,
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    expected_results JSONB NOT NULL DEFAULT '[]'::jsonb,
    priority VARCHAR(20) NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    status VARCHAR(50) NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'CONVERTED', 'REJECTED', 'TARGET_DELETED')),
    converted_test_case_id UUID REFERENCES ai_test_cases(id) ON DELETE SET NULL,
    converted_test_case_key_snapshot VARCHAR(50),
    converted_at TIMESTAMPTZ,
    converted_by_user_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT fk_proposal_suite_proj FOREIGN KEY (suite_id, project_id) REFERENCES ai_test_suites(id, project_id) ON DELETE CASCADE,
    CONSTRAINT uq_proposal_suite_key UNIQUE (suite_id, proposal_key)
);

CREATE INDEX IF NOT EXISTS idx_ai_proposals_suite ON ai_test_case_proposals (suite_id);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_project ON ai_test_case_proposals (project_id);
CREATE INDEX IF NOT EXISTS idx_ai_proposals_status ON ai_test_case_proposals (status);

-- 4. Proposal Conversion Integrity Trigger
CREATE OR REPLACE FUNCTION trg_ai_proposal_conversion_integrity() RETURNS TRIGGER AS $$
DECLARE
    v_tc_suite_id UUID;
    v_tc_project_id UUID;
    v_tc_key VARCHAR(50);
BEGIN
    IF NEW.converted_test_case_id IS NOT NULL THEN
        SELECT sc.suite_id, s.project_id, tc.test_case_key 
        INTO v_tc_suite_id, v_tc_project_id, v_tc_key
        FROM ai_test_cases tc
        JOIN ai_test_scenarios sc ON sc.id = tc.scenario_id
        JOIN ai_test_suites s ON s.id = sc.suite_id
        WHERE tc.id = NEW.converted_test_case_id;

        IF v_tc_suite_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Converted test case % does not exist.', NEW.converted_test_case_id USING ERRCODE = '23503';
        END IF;

        IF v_tc_suite_id IS DISTINCT FROM NEW.suite_id THEN
            RAISE EXCEPTION 'CrossSuiteViolation: Converted test case belongs to suite %, but proposal is in suite %.',
                v_tc_suite_id, NEW.suite_id USING ERRCODE = '23514';
        END IF;

        IF v_tc_project_id IS DISTINCT FROM NEW.project_id THEN
            RAISE EXCEPTION 'CrossProjectViolation: Converted test case belongs to project %, but proposal is in project %.',
                v_tc_project_id, NEW.project_id USING ERRCODE = '23514';
        END IF;

        NEW.converted_test_case_key_snapshot := v_tc_key;
        NEW.status := 'CONVERTED';
        IF NEW.converted_at IS NULL THEN
            NEW.converted_at := clock_timestamp();
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_test_case_proposals_integrity ON ai_test_case_proposals;
CREATE TRIGGER trg_ai_test_case_proposals_integrity
BEFORE INSERT OR UPDATE OF converted_test_case_id, suite_id, project_id ON ai_test_case_proposals
FOR EACH ROW EXECUTE FUNCTION trg_ai_proposal_conversion_integrity();

-- 5. Test Case Deletion Lifecycle Preservation Trigger
-- When a test case is deleted, linked proposals transition to 'TARGET_DELETED',
-- preserving the snapshot key, converted timestamp, and auditable history.
CREATE OR REPLACE FUNCTION trg_ai_test_case_delete_proposal_sync() RETURNS TRIGGER AS $$
BEGIN
    UPDATE ai_test_case_proposals
    SET status = 'TARGET_DELETED',
        updated_at = clock_timestamp()
    WHERE converted_test_case_id = OLD.id;
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_test_cases_before_delete_proposal_sync ON ai_test_cases;
CREATE TRIGGER trg_ai_test_cases_before_delete_proposal_sync
BEFORE DELETE ON ai_test_cases
FOR EACH ROW EXECUTE FUNCTION trg_ai_test_case_delete_proposal_sync();

-- 6. Canonical Active Corpus Fingerprint SQL Function
CREATE OR REPLACE FUNCTION fn_calculate_active_corpus_fingerprint(p_project_id UUID) 
RETURNS VARCHAR(64) AS $$
DECLARE
    v_raw_json jsonb;
    v_hash varchar(64);
BEGIN
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'doc_id', d.id,
                'doc_title', d.title,
                'ver_id', v.id,
                'ver_num', v.version_number,
                'ver_sha256', v.sha256_hash,
                'ext_id', x.id,
                'ext_ver', x.extractor_version,
                'chunk_config', x.metadata->>'chunk_config',
                'chunk_id', c.id,
                'chunk_idx', c.chunk_index,
                'content_sha256', encode(sha256(c.content::bytea), 'hex'),
                'token_count', c.token_count,
                'model_id', e.model_id,
                'model_name', m.model_name,
                'dimensions', m.dimensions
            )
            ORDER BY d.id ASC, v.id ASC, c.chunk_index ASC, c.id ASC
        ),
        '[]'::jsonb
    )
    INTO v_raw_json
    FROM ai_document_chunks c
    JOIN ai_document_embeddings e ON e.chunk_id = c.id
      AND e.extraction_id = c.extraction_id
      AND e.version_id = c.version_id
      AND e.document_id = c.document_id
      AND e.project_id = c.project_id
    JOIN ai_embedding_config m ON m.id = e.model_id
    JOIN ai_documents d ON d.id = c.document_id AND d.project_id = p_project_id
    JOIN ai_document_versions v ON v.id = d.active_version_id AND v.id = c.version_id
    JOIN ai_document_extractions x ON x.version_id = v.id AND x.id = c.extraction_id
      AND x.is_active = TRUE AND x.status = 'COMPLETED'
    WHERE c.project_id = p_project_id
      AND v.indexing_status = 'COMPLETED';

    v_hash := encode(sha256(v_raw_json::text::bytea), 'hex');
    RETURN v_hash;
END;
$$ LANGUAGE plpgsql;
