const indexingService = require('../services/indexingService');

/**
 * Controller for Document Indexing & Embeddings Endpoints.
 * Strictly scoped by (project_id, document_id, version_id).
 */
const indexingController = {
  /**
   * Triggers asynchronous indexing (chunking + embedding generation) for a document version.
   * Returns 202 Accepted with initial status or 409 Conflict if in progress.
   */
  triggerIndexing: async (req, res) => {
    try {
      const projectId = req.params.projectId || req.document?.project_id;
      const { documentId, versionId } = req.params;

      const result = await indexingService.indexDocumentVersion({
        projectId,
        documentId,
        versionId,
        isReindex: false
      });

      return res.status(202).json({
        success: true,
        message: 'Document indexing started.',
        data: {
          versionId: result.versionId,
          documentId: result.documentId,
          projectId: result.projectId,
          extractionId: result.extractionId,
          indexingStatus: result.indexingStatus,
          isReindex: result.isReindex
        }
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'INDEXING_TRIGGER_ERROR'
      });
    }
  },

  /**
   * Triggers re-indexing of an already extracted/indexed document version.
   */
  reindex: async (req, res) => {
    try {
      const projectId = req.params.projectId || req.document?.project_id;
      const { documentId, versionId } = req.params;

      const result = await indexingService.indexDocumentVersion({
        projectId,
        documentId,
        versionId,
        isReindex: true
      });

      return res.status(202).json({
        success: true,
        message: 'Document re-indexing started.',
        data: {
          versionId: result.versionId,
          documentId: result.documentId,
          projectId: result.projectId,
          extractionId: result.extractionId,
          indexingStatus: result.indexingStatus,
          isReindex: result.isReindex
        }
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'REINDEX_TRIGGER_ERROR'
      });
    }
  },

  /**
   * Retrieves the current indexing status, chunk count, and diagnostics.
   */
  getStatus: async (req, res) => {
    try {
      const projectId = req.params.projectId || req.document?.project_id;
      const { documentId, versionId } = req.params;

      const statusInfo = await indexingService.getIndexingStatus({
        projectId,
        documentId,
        versionId
      });

      return res.status(200).json({
        success: true,
        data: statusInfo
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  },

  /**
   * Retrieves paginated chunks for the active extraction of a document version.
   * Performs plain-text substring filtering only; no vector/semantic search.
   */
  getChunks: async (req, res) => {
    try {
      const projectId = req.params.projectId || req.document?.project_id;
      const { documentId, versionId } = req.params;
      const { search, limit, offset } = req.query;

      const result = await indexingService.getDocumentChunks({
        projectId,
        documentId,
        versionId,
        search,
        limit,
        offset
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  },

  /**
   * Retrieves a single chunk and its embedding vector preview.
   */
  getChunkDetails: async (req, res) => {
    try {
      const projectId = req.params.projectId || req.document?.project_id;
      const { documentId, versionId, chunkId } = req.params;

      const chunkDetails = await indexingService.getChunkDetails({
        projectId,
        documentId,
        versionId,
        chunkId
      });

      return res.status(200).json({
        success: true,
        data: chunkDetails
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  }
};

module.exports = indexingController;
