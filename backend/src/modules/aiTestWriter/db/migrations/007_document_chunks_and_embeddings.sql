-- ============================================================================
-- Migration 007: Document Chunks & Embeddings Hierarchy Schema & Configuration
-- Phase 2.5 Approved Architecture & Hierarchy Integrity
-- ============================================================================

-- 1. Add direct hierarchy columns to ai_document_chunks
ALTER TABLE ai_document_chunks
    ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES ai_documents(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES ai_projects(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS extraction_id UUID REFERENCES ai_document_extractions(id) ON DELETE CASCADE;

-- 2. Add direct hierarchy columns to ai_document_embeddings
ALTER TABLE ai_document_embeddings
    ADD COLUMN IF NOT EXISTS document_id UUID REFERENCES ai_documents(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES ai_projects(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS extraction_id UUID REFERENCES ai_document_extractions(id) ON DELETE CASCADE;

-- 3. Replace version-only chunk index constraint with extraction-scoped chunk index constraint
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_doc_chunk_idx'
    ) THEN
        ALTER TABLE ai_document_chunks DROP CONSTRAINT uq_doc_chunk_idx;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_ai_chunk_ext_idx'
    ) THEN
        ALTER TABLE ai_document_chunks
            ADD CONSTRAINT uq_ai_chunk_ext_idx UNIQUE (extraction_id, chunk_index);
    END IF;
END $$;

-- 4. Composite unique constraint on ai_document_chunks full hierarchy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_ai_chunk_hierarchy'
    ) THEN
        ALTER TABLE ai_document_chunks
            ADD CONSTRAINT uq_ai_chunk_hierarchy 
            UNIQUE (id, extraction_id, version_id, document_id, project_id);
    END IF;
END $$;

-- 5. Composite foreign key from chunks to extraction hierarchy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_chunk_extraction_hierarchy'
    ) THEN
        ALTER TABLE ai_document_chunks
            ADD CONSTRAINT fk_ai_chunk_extraction_hierarchy
            FOREIGN KEY (extraction_id, version_id, document_id, project_id)
            REFERENCES ai_document_extractions (id, version_id, document_id, project_id)
            ON DELETE CASCADE;
    END IF;
END $$;

-- 6. Composite foreign key from embeddings to chunk hierarchy
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_embedding_chunk_version'
    ) THEN
        ALTER TABLE ai_document_embeddings DROP CONSTRAINT fk_embedding_chunk_version;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_ai_embedding_chunk_hierarchy'
    ) THEN
        ALTER TABLE ai_document_embeddings
            ADD CONSTRAINT fk_ai_embedding_chunk_hierarchy
            FOREIGN KEY (chunk_id, extraction_id, version_id, document_id, project_id)
            REFERENCES ai_document_chunks (id, extraction_id, version_id, document_id, project_id)
            ON DELETE CASCADE;
    END IF;
END $$;

-- 7. Add indexing heartbeat and diagnostics to ai_document_versions
ALTER TABLE ai_document_versions
    ADD COLUMN IF NOT EXISTS indexing_last_heartbeat_at TIMESTAMPTZ DEFAULT NOW(),
    ADD COLUMN IF NOT EXISTS indexing_diagnostics JSONB DEFAULT '{}';

-- 8. Add index on processing heartbeat for indexing sweeper efficiency
CREATE INDEX IF NOT EXISTS idx_ai_ver_indexing_heartbeat 
    ON ai_document_versions(indexing_status, indexing_last_heartbeat_at) 
    WHERE indexing_status = 'PROCESSING';

CREATE INDEX IF NOT EXISTS idx_chunks_extraction_id ON ai_document_chunks(extraction_id);
CREATE INDEX IF NOT EXISTS idx_chunks_doc_proj ON ai_document_chunks(document_id, project_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_extraction_id ON ai_document_embeddings(extraction_id);

-- 9. Seed active embedding model configuration (nomic-embed-text, 768-dim, cosine)
INSERT INTO ai_embedding_config (
    id, model_name, provider, dimensions, context_window, distance_metric, is_active
) VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'nomic-embed-text',
    'OLLAMA',
    768,
    8192,
    'cosine',
    TRUE
) ON CONFLICT DO NOTHING;

-- 10. Update version row immutability trigger for safe re-indexing
-- Preserves strict immutability of file content & metadata while permitting indexing lifecycle transitions.
CREATE OR REPLACE FUNCTION trg_enforce_version_row_immutability()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.indexing_status = 'COMPLETED' THEN
        -- Strictly enforce immutability of document revision file content and metadata
        IF NEW.sha256_hash != OLD.sha256_hash OR
           NEW.file_size_bytes != OLD.file_size_bytes OR
           NEW.storage_path != OLD.storage_path OR
           NEW.version_number != OLD.version_number OR
           NEW.document_id != OLD.document_id OR
           NEW.change_summary IS DISTINCT FROM OLD.change_summary THEN
            RAISE EXCEPTION 'VersionImmutableViolation: Version % file content and metadata are immutable. No modifications to file or version metadata are permitted.',
                OLD.id USING ERRCODE = '23514';
        END IF;

        -- Status can only transition to PROCESSING (re-indexing), FAILED (failed re-indexing), or remain COMPLETED
        IF NEW.indexing_status NOT IN ('COMPLETED', 'PROCESSING', 'FAILED') THEN
            RAISE EXCEPTION 'VersionImmutableViolation: Version % is COMPLETED. Status cannot transition to %.',
                OLD.id, NEW.indexing_status USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
