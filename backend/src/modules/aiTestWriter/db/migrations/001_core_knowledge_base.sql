-- ============================================================================
-- Migration 001: Core Knowledge Base & Project Isolation Schema
-- Phase 1 Approved Final Architecture (Tables 1 - 7)
-- ============================================================================

-- Ensure vector extension exists
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Schema Migration History (Dedicated AI table)
CREATE TABLE IF NOT EXISTS ai_schema_migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Embedding Configuration (Strict Single-Active Model with History)
CREATE TABLE IF NOT EXISTS ai_embedding_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name VARCHAR(100) NOT NULL,
    provider VARCHAR(50) NOT NULL DEFAULT 'OLLAMA' CHECK (provider IN ('OLLAMA', 'LOCAL')),
    dimensions INT NOT NULL CHECK (dimensions = 768),
    context_window INT NOT NULL DEFAULT 8192 CHECK (context_window > 0),
    distance_metric VARCHAR(50) NOT NULL DEFAULT 'cosine' CHECK (distance_metric IN ('cosine')),
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_embedding_config_single_active 
    ON ai_embedding_config (is_active) 
    WHERE is_active = TRUE;

-- 3. Projects (Option B: Creator + Platform Admin)
CREATE TABLE IF NOT EXISTS ai_projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) UNIQUE NOT NULL,
    description TEXT,
    app_package_name VARCHAR(255),
    pms_project_id VARCHAR(100),
    mixpanel_project_id VARCHAR(100),
    created_by_user_id UUID NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    settings JSONB NOT NULL DEFAULT '{
        "default_priority": "MEDIUM",
        "require_human_review": true,
        "inference_model": "qwen2.5:3b-instruct"
    }',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_proj_creator ON ai_projects(created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_ai_proj_status ON ai_projects(status);

-- 4. Documents (Permanent Entity)
CREATE TABLE IF NOT EXISTS ai_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    document_type VARCHAR(50) NOT NULL CHECK (document_type IN ('PDF', 'DOCX', 'XLSX', 'CSV', 'TXT')),
    active_version_id UUID,
    created_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ai_docs_id_project UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_docs_project ON ai_documents(project_id);

-- 5. Document Versions (Immutable Revisions with Model Pinning)
CREATE TABLE IF NOT EXISTS ai_document_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES ai_documents(id) ON DELETE CASCADE,
    version_number INT NOT NULL CHECK (version_number > 0),
    sha256_hash VARCHAR(64) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    storage_path VARCHAR(512) NOT NULL,
    indexing_status VARCHAR(50) NOT NULL DEFAULT 'PENDING' 
        CHECK (indexing_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
    embedding_model_id UUID REFERENCES ai_embedding_config(id) ON DELETE RESTRICT,
    indexing_error TEXT,
    total_chunks INT NOT NULL DEFAULT 0 CHECK (total_chunks >= 0),
    change_summary TEXT,
    uploaded_by_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    indexed_at TIMESTAMPTZ,
    CONSTRAINT uq_doc_version UNIQUE (document_id, version_number),
    CONSTRAINT uq_doc_ver_id_doc UNIQUE (id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_doc_ver_doc_id ON ai_document_versions(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_ver_hash ON ai_document_versions(sha256_hash);

-- Circular FK for Authoritative Active Version (Targeted SET NULL on active_version_id only)
ALTER TABLE ai_documents 
    DROP CONSTRAINT IF EXISTS fk_active_doc_version,
    DROP CONSTRAINT IF EXISTS fk_active_doc_version_ownership;

ALTER TABLE ai_documents 
    ADD CONSTRAINT fk_active_doc_version_ownership 
        FOREIGN KEY (active_version_id, id) 
        REFERENCES ai_document_versions(id, document_id) 
        ON DELETE SET NULL (active_version_id);

-- 6. Document Chunks (Version-Isolated with Composite Key)
CREATE TABLE IF NOT EXISTS ai_document_chunks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version_id UUID NOT NULL REFERENCES ai_document_versions(id) ON DELETE CASCADE,
    chunk_index INT NOT NULL CHECK (chunk_index >= 0),
    content TEXT NOT NULL,
    token_count INT NOT NULL DEFAULT 0 CHECK (token_count >= 0),
    page_number INT CHECK (page_number > 0),
    section_heading VARCHAR(255),
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_doc_chunk_idx UNIQUE (version_id, chunk_index),
    CONSTRAINT uq_chunk_id_version UNIQUE (id, version_id)
);

CREATE INDEX IF NOT EXISTS idx_chunks_version ON ai_document_chunks(version_id);

-- 7. Document Embeddings (Fixed 768-dim with Composite FK)
CREATE TABLE IF NOT EXISTS ai_document_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chunk_id UUID NOT NULL,
    version_id UUID NOT NULL,
    model_id UUID NOT NULL REFERENCES ai_embedding_config(id) ON DELETE RESTRICT,
    embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chunk_model UNIQUE (chunk_id, model_id),
    CONSTRAINT fk_embedding_chunk_version FOREIGN KEY (chunk_id, version_id)
        REFERENCES ai_document_chunks(id, version_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_embeddings_chunk ON ai_document_embeddings(chunk_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_version_model ON ai_document_embeddings(version_id, model_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_hnsw_cosine 
    ON ai_document_embeddings USING hnsw (embedding vector_cosine_ops);
