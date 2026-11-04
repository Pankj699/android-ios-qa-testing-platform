const retrievalService = require('../services/retrievalService');

/**
 * Controller for Knowledge Base Hybrid Retrieval Endpoints.
 * Scoped by project_id and enforces Option B authorization.
 */
const retrievalController = {
  /**
   * Executes unified hybrid search (semantic + full-text RRF fusion).
   * POST /api/ai/projects/:projectId/retrieval/search
   */
  searchKnowledgeBase: async (req, res) => {
    try {
      const projectId = req.params.projectId || req.body?.projectId || req.query?.projectId;
      const {
        query,
        mode = 'HYBRID',
        limit,
        candidateLimit,
        documentId,
        weights,
        fallbackOnSemanticFailure
      } = req.body || {};

      const result = await retrievalService.hybridSearch({
        projectId,
        query,
        mode,
        limit,
        candidateLimit,
        documentId,
        weights,
        fallbackOnSemanticFailure
      });

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      let status = err.status || 500;
      let code = err.code || 'RETRIEVAL_ERROR';

      // Detect Ollama connectivity failures
      if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED') || err.message?.includes('fetch failed')) {
        status = 503;
        code = 'OLLAMA_SERVICE_UNAVAILABLE';
      }

      return res.status(status).json({
        success: false,
        error: err.message,
        code
      });
    }
  }
};

module.exports = retrievalController;
