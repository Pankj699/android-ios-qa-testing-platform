-- ============================================================================
-- Migration 003: Immutability, Hierarchy & RTM Integrity Triggers
-- Phase 1 Approved Final Architecture (Section 3.2)
-- ============================================================================

-- 1. TRIGGER: Complete Row Immutability for ai_document_versions
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

DROP TRIGGER IF EXISTS trg_version_row_immutability ON ai_document_versions;
CREATE TRIGGER trg_version_row_immutability
BEFORE UPDATE ON ai_document_versions
FOR EACH ROW EXECUTE FUNCTION trg_enforce_version_row_immutability();


-- 2. TRIGGER: Chunks and Embeddings Immutability with Safe Cascade Detection
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

DROP TRIGGER IF EXISTS trg_chunks_immutability ON ai_document_chunks;
CREATE TRIGGER trg_chunks_immutability
BEFORE INSERT OR UPDATE OR DELETE ON ai_document_chunks
FOR EACH ROW EXECUTE FUNCTION trg_enforce_version_immutability();

DROP TRIGGER IF EXISTS trg_embeddings_immutability ON ai_document_embeddings;
CREATE TRIGGER trg_embeddings_immutability
BEFORE INSERT OR UPDATE OR DELETE ON ai_document_embeddings
FOR EACH ROW EXECUTE FUNCTION trg_enforce_version_immutability();


-- 3. TRIGGER: Protect Completed Versions Against Direct Deletion
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

DROP TRIGGER IF EXISTS trg_version_delete_protection ON ai_document_versions;
CREATE TRIGGER trg_version_delete_protection
BEFORE DELETE ON ai_document_versions
FOR EACH ROW EXECUTE FUNCTION trg_protect_completed_version_delete();


-- 4. TRIGGER: RTM Traceability Integrity with Explicit Sequential Row Locking
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
    -- PHASE 1: Document Ownership Chain (Levels 1 -> 2 -> 3)
    IF NEW.chunk_id IS NOT NULL THEN
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

        -- Level 1: ai_documents
        SELECT project_id INTO v_chunk_project_id 
        FROM ai_documents 
        WHERE id = v_chunk_doc_id 
        FOR SHARE;

        IF v_chunk_project_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Document % does not exist or was concurrently deleted.', v_chunk_doc_id USING ERRCODE = '23503';
        END IF;

        -- Level 2: ai_document_versions
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

        -- Level 3: ai_document_chunks
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

    -- PHASE 2: Requirement Entity (Level 4)
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

    -- PHASE 3: Test Case Hierarchy (Levels 5 -> 6 -> 7)
    IF NEW.test_case_id IS NOT NULL THEN
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

        -- Level 5: ai_test_suites
        SELECT project_id INTO v_tc_project_id 
        FROM ai_test_suites 
        WHERE id = v_tc_suite_id 
        FOR SHARE;

        IF v_tc_project_id IS NULL THEN
            RAISE EXCEPTION 'ForeignKeyViolation: Test suite % does not exist or was concurrently deleted.', v_tc_suite_id USING ERRCODE = '23503';
        END IF;

        -- Level 6: ai_test_scenarios
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

        -- Level 7: ai_test_cases
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

DROP TRIGGER IF EXISTS trg_rtm_project_integrity ON ai_requirement_traceability;
CREATE TRIGGER trg_rtm_project_integrity
BEFORE INSERT OR UPDATE ON ai_requirement_traceability
FOR EACH ROW EXECUTE FUNCTION trg_enforce_rtm_project_integrity();


-- 5. TRIGGER: Prevent Parent Reassignment from Breaking Active RTM Records
CREATE OR REPLACE FUNCTION trg_prevent_parent_cross_project_reassignment()
RETURNS TRIGGER AS $$
DECLARE
    v_old_proj UUID;
    v_new_proj UUID;
BEGIN
    -- Check 1: On ai_requirements
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

    -- Check 2: On ai_test_suites
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

    -- Check 3: On ai_test_scenarios
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

    -- Check 4: On ai_test_cases
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

    -- Check 5: On ai_documents
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

    -- Check 6: On ai_document_chunks
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

    -- Check 7: On ai_document_versions
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

DROP TRIGGER IF EXISTS trg_req_project_reassign ON ai_requirements;
CREATE TRIGGER trg_req_project_reassign
BEFORE UPDATE OF project_id ON ai_requirements
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

DROP TRIGGER IF EXISTS trg_doc_project_reassign ON ai_documents;
CREATE TRIGGER trg_doc_project_reassign
BEFORE UPDATE OF project_id ON ai_documents
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

DROP TRIGGER IF EXISTS trg_version_doc_reassign ON ai_document_versions;
CREATE TRIGGER trg_version_doc_reassign
BEFORE UPDATE OF document_id ON ai_document_versions
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

DROP TRIGGER IF EXISTS trg_chunk_version_reassign ON ai_document_chunks;
CREATE TRIGGER trg_chunk_version_reassign
BEFORE UPDATE OF version_id ON ai_document_chunks
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

DROP TRIGGER IF EXISTS trg_suite_project_reassign ON ai_test_suites;
CREATE TRIGGER trg_suite_project_reassign
BEFORE UPDATE OF project_id ON ai_test_suites
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

DROP TRIGGER IF EXISTS trg_scen_suite_reassign ON ai_test_scenarios;
CREATE TRIGGER trg_scen_suite_reassign
BEFORE UPDATE OF suite_id ON ai_test_scenarios
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();

DROP TRIGGER IF EXISTS trg_tc_scen_reassign ON ai_test_cases;
CREATE TRIGGER trg_tc_scen_reassign
BEFORE UPDATE OF scenario_id ON ai_test_cases
FOR EACH ROW EXECUTE FUNCTION trg_prevent_parent_cross_project_reassignment();
