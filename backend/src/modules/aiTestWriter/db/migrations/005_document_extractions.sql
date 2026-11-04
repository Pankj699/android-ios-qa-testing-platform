-- ============================================================================
-- Migration 005: Document Extraction & Normalized Structured Units Schema
-- Phase 2.4 Approved Architecture & Safe Reprocessing Model
-- ============================================================================

-- 1. Document Extractions (Per-version lifecycle, attempt tracking, safe reprocessing)
CREATE TABLE IF NOT EXISTS ai_document_extractions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES ai_document_versions(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING' 
        CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    attempt_number INT NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
    extractor_version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    total_units INT NOT NULL DEFAULT 0 CHECK (total_units >= 0),
    warning_count INT NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
    warnings JSONB NOT NULL DEFAULT '[]',
    error_message TEXT,
    internal_diagnostics JSONB,
    metadata JSONB NOT NULL DEFAULT '{}',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ai_ext_ver_attempt UNIQUE (version_id, attempt_number),
    CONSTRAINT fk_ai_ext_doc_proj FOREIGN KEY (document_id, project_id) 
        REFERENCES ai_documents(id, project_id) ON DELETE CASCADE
);

-- Partial unique index ensuring at most ONE active extraction per document version
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_ext_single_active 
    ON ai_document_extractions (version_id) 
    WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_ai_ext_ver ON ai_document_extractions(version_id);
CREATE INDEX IF NOT EXISTS idx_ai_ext_proj ON ai_document_extractions(project_id);
CREATE INDEX IF NOT EXISTS idx_ai_ext_doc ON ai_document_extractions(document_id);
CREATE INDEX IF NOT EXISTS idx_ai_ext_processing_heartbeat 
    ON ai_document_extractions(status, last_heartbeat_at) 
    WHERE status = 'PROCESSING';

-- 2. Document Extracted Units (Normalized structured content with machine-readable provenance)
CREATE TABLE IF NOT EXISTS ai_document_extracted_units (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    extraction_id UUID NOT NULL REFERENCES ai_document_extractions(id) ON DELETE CASCADE,
    version_id UUID NOT NULL REFERENCES ai_document_versions(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    sequence_number INT NOT NULL CHECK (sequence_number >= 0),
    source_type VARCHAR(50) NOT NULL,
    source_location JSONB NOT NULL DEFAULT '{}',
    source_location_display TEXT NOT NULL,
    extracted_text TEXT NOT NULL,
    unit_warnings JSONB NOT NULL DEFAULT '[]',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_unit_extraction_seq UNIQUE (extraction_id, sequence_number),
    CONSTRAINT fk_unit_doc_proj FOREIGN KEY (document_id, project_id) 
        REFERENCES ai_documents(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_unit_ext_id ON ai_document_extracted_units(extraction_id);
CREATE INDEX IF NOT EXISTS idx_unit_ver_id ON ai_document_extracted_units(version_id);
CREATE INDEX IF NOT EXISTS idx_unit_proj_id ON ai_document_extracted_units(project_id);
CREATE INDEX IF NOT EXISTS idx_unit_source_type ON ai_document_extracted_units(source_type);
