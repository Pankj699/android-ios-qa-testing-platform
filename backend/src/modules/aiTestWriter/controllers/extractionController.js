const extractionService = require('../services/extractionService');

/**
 * Controller for Document Extraction & Provenance Endpoints.
 */
const extractionController = {
  /**
   * Triggers asynchronous extraction for a document version.
   * Returns 202 Accepted with the in-flight extraction job details.
   */
  triggerExtraction: async (req, res) => {
    try {
      const { projectId, documentId, versionId } = req.params;
      const userId = req.user.id;

      const extraction = await extractionService.extractDocumentVersion({
        projectId,
        documentId,
        versionId,
        userId,
        isReprocess: false
      });

      return res.status(202).json({
        success: true,
        message: 'Document extraction started.',
        data: extraction
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'EXTRACTION_TRIGGER_ERROR'
      });
    }
  },

  /**
   * Retrieves the current extraction status and metadata for a document version.
   */
  getStatus: async (req, res) => {
    try {
      const { projectId, documentId, versionId } = req.params;

      const statusInfo = await extractionService.getExtractionStatus({
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
   * Retrieves paginated extracted units with search and provenance.
   */
  getUnits: async (req, res) => {
    try {
      const { projectId, documentId, versionId } = req.params;
      const { page, pageSize, sourceType, search } = req.query;

      const result = await extractionService.getExtractedUnits({
        projectId,
        documentId,
        versionId,
        page,
        pageSize,
        sourceType,
        search
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
   * Requests explicit safe reprocessing of a document version.
   * Returns 202 Accepted while preserving the active extraction until successful completion.
   */
  reprocess: async (req, res) => {
    try {
      const { projectId, documentId, versionId } = req.params;
      const userId = req.user.id;

      const extraction = await extractionService.extractDocumentVersion({
        projectId,
        documentId,
        versionId,
        userId,
        isReprocess: true
      });

      return res.status(202).json({
        success: true,
        message: 'Document reprocessing started.',
        data: extraction
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'REPROCESS_TRIGGER_ERROR'
      });
    }
  }
};

module.exports = extractionController;
