-- ============================================================================
-- Migration 006: Extraction Hierarchy Integrity & CSV Provenance Constraint
-- Phase 2.4 Final Integrity and Resource-Limit Closure
-- ============================================================================

-- 1. Ensure composite unique hierarchy exists on ai_document_extractions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_ai_ext_hierarchy'
    ) THEN
        ALTER TABLE ai_document_extractions
            ADD CONSTRAINT uq_ai_ext_hierarchy UNIQUE (id, version_id, document_id, project_id);
    END IF;
END $$;

-- 2. Enforce composite foreign key on ai_document_extracted_units
-- Guarantees that an extracted unit cannot be associated with an extraction from Version A,
-- but with Version B, or a document/project belonging to another hierarchy.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_unit_extraction_hierarchy'
    ) THEN
        ALTER TABLE ai_document_extracted_units
            ADD CONSTRAINT fk_ai_unit_extraction_hierarchy
            FOREIGN KEY (extraction_id, version_id, document_id, project_id)
            REFERENCES ai_document_extractions (id, version_id, document_id, project_id)
            ON DELETE CASCADE;
    END IF;
END $$;

-- 3. Enforce source_type domain constraint on ai_document_extracted_units
DO $$
BEGIN
    ALTER TABLE ai_document_extracted_units DROP CONSTRAINT IF EXISTS chk_ai_unit_source_type;
    ALTER TABLE ai_document_extracted_units
        ADD CONSTRAINT chk_ai_unit_source_type
        CHECK (source_type IN (
            'PAGE', 'HEADING', 'PARAGRAPH', 'TABLE', 'TABLE_HEADER', 'TABLE_ROW',
            'SHEET_HEADER', 'SHEET_ROW', 'CSV_ROW', 'LINE'
        ));
END $$;
