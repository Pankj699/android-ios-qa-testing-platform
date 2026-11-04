-- ============================================================================
-- Migration 010: Refine ACTIVE Requirement Immutability Trigger for Cascade Deletion
--
-- Description:
-- Refines trg_enforce_active_requirement_immutability() on ai_requirements.
-- While all 13 requirement fields remain strictly immutable once status = 'ACTIVE',
-- this migration permits the composite foreign key cascade ON DELETE SET NULL (analysis_id)
-- to set analysis_id to NULL when the parent analysis session is explicitly deleted,
-- preserving the ACTIVE requirement and its RTM links in the project.
-- Any other attempt to modify, clear, or reassign analysis_id remains strictly blocked (23514).
-- ============================================================================

CREATE OR REPLACE FUNCTION trg_enforce_active_requirement_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'ACTIVE' THEN
        -- 1. Status downgrade protection (ACTIVE -> DRAFT is strictly forbidden)
        IF NEW.status = 'DRAFT' THEN
            RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot downgrade ACTIVE requirement % to DRAFT.',
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

        -- 12. Protect analysis_id (permit ON DELETE SET NULL only when parent analysis has been deleted)
        IF OLD.analysis_id IS DISTINCT FROM NEW.analysis_id THEN
            IF NOT (NEW.analysis_id IS NULL AND NOT EXISTS (SELECT 1 FROM ai_requirement_analyses WHERE id = OLD.analysis_id)) THEN
                RAISE EXCEPTION 'ActiveRequirementImmutableViolation: Cannot modify analysis_id of ACTIVE requirement %.',
                    OLD.id USING ERRCODE = '23514';
            END IF;
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
FOR EACH ROW
EXECUTE FUNCTION trg_enforce_active_requirement_immutability();
