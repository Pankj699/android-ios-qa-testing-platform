-- ============================================================================
-- Migration 004: Persistent Chat Data Model (Section 5)
-- Project-scoped conversations, citation history, and document-level scoping
-- ============================================================================

-- 17. Persistent Project Chat Conversations
CREATE TABLE IF NOT EXISTS ai_chat_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES ai_projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    title VARCHAR(255) NOT NULL DEFAULT 'New Conversation',
    task_reference VARCHAR(255),
    scope_mode VARCHAR(50) NOT NULL DEFAULT 'PROJECT_KNOWLEDGE_BASE' 
        CHECK (scope_mode IN ('PROJECT_KNOWLEDGE_BASE', 'SELECTED_DOCUMENTS')),
    status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE' 
        CHECK (status IN ('ACTIVE', 'ARCHIVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_ai_chat_conv_id_project UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_conv_project ON ai_chat_conversations(project_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_user ON ai_chat_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_conv_updated ON ai_chat_conversations(updated_at DESC);

-- 18. Scoped Conversation Document Associations (Enforces project isolation via Composite FKs)
CREATE TABLE IF NOT EXISTS ai_chat_conversation_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL,
    document_id UUID NOT NULL,
    project_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_chat_conv_doc UNIQUE (conversation_id, document_id),
    CONSTRAINT fk_chat_doc_conv FOREIGN KEY (conversation_id, project_id) 
        REFERENCES ai_chat_conversations(id, project_id) ON DELETE CASCADE,
    CONSTRAINT fk_chat_doc_document FOREIGN KEY (document_id, project_id) 
        REFERENCES ai_documents(id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_doc_conv ON ai_chat_conversation_documents(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_doc_document ON ai_chat_conversation_documents(document_id);
CREATE INDEX IF NOT EXISTS idx_chat_doc_project ON ai_chat_conversation_documents(project_id);

-- 19. Persistent Chat Messages
CREATE TABLE IF NOT EXISTS ai_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES ai_chat_conversations(id) ON DELETE CASCADE,
    sender_user_id UUID,
    role VARCHAR(50) NOT NULL CHECK (role IN ('USER', 'ASSISTANT', 'SYSTEM')),
    content TEXT NOT NULL,
    citations JSONB NOT NULL DEFAULT '[]',
    model_name VARCHAR(100),
    tokens_used INT CHECK (tokens_used >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_msg_conv_time ON ai_chat_messages(conversation_id, created_at ASC);
