-- ============================================================================
-- Migration 008: Hybrid Retrieval Full-Text TSVector & Retrieval Indexes
-- Phase 2.6 Approved Architecture
-- ============================================================================

-- 1. Add generated tsvector column to ai_document_chunks combining heading and content
-- Heading is weighted 'A' (priority), Content is weighted 'B'
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'ai_document_chunks' AND column_name = 'content_tsv'
    ) THEN
        ALTER TABLE ai_document_chunks
            ADD COLUMN content_tsv tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('english', coalesce(section_heading, '')), 'A') ||
                setweight(to_tsvector('english', coalesce(content, '')), 'B')
            ) STORED;
    END IF;
END $$;

-- 2. GIN Index on content_tsv for sub-millisecond lexical search
CREATE INDEX IF NOT EXISTS idx_chunks_content_tsv 
    ON ai_document_chunks USING gin (content_tsv);

-- 3. Composite covering index for fast retrieval filtering across hierarchy
CREATE INDEX IF NOT EXISTS idx_chunks_retrieval_filter 
    ON ai_document_chunks (project_id, document_id, version_id, extraction_id);
