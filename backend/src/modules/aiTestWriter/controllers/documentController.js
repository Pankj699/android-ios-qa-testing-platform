const documentService = require('../services/documentService');
const extractionService = require('../services/extractionService');

/**
 * Controller for Document Upload and Management Endpoints.
 */
const documentController = {
  upload: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded. Please provide a document file.'
        });
      }

      const projectId = req.params.projectId;
      const userId = req.user.id;
      const fileBuffer = req.file.buffer;
      const originalFilename = req.file.originalname;
      const title = req.body?.title;

      const doc = await documentService.uploadDocument({
        projectId,
        userId,
        fileBuffer,
        originalFilename,
        title
      });

      // Automatically trigger background extraction for the newly created version
      if (doc && doc.active_version_id) {
        extractionService.extractDocumentVersion({
          projectId,
          documentId: doc.id,
          versionId: doc.active_version_id,
          userId
        }).catch(err => {
          console.error(`[AutoExtraction] Error triggering extraction for doc ${doc.id}:`, err.message);
        });
      }

      return res.status(201).json({
        success: true,
        data: doc
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'UPLOAD_ERROR',
        existingDocument: err.existingDocument || null
      });
    }
  },

  createVersion: async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No file uploaded for new version.'
        });
      }

      const { projectId, documentId } = req.params;
      const userId = req.user.id;
      const fileBuffer = req.file.buffer;
      const originalFilename = req.file.originalname;
      const changeSummary = req.body?.changeSummary;

      const doc = await documentService.createDocumentVersion({
        projectId,
        documentId,
        userId,
        fileBuffer,
        originalFilename,
        changeSummary
      });

      // Automatically trigger background extraction for the newly uploaded version
      if (doc && doc.active_version_id) {
        extractionService.extractDocumentVersion({
          projectId,
          documentId: doc.id,
          versionId: doc.active_version_id,
          userId
        }).catch(err => {
          console.error(`[AutoExtraction] Error triggering extraction for new version ${doc.active_version_id}:`, err.message);
        });
      }

      return res.status(201).json({
        success: true,
        data: doc
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'VERSION_ERROR'
      });
    }
  },

  activateVersion: async (req, res) => {
    try {
      const { projectId, documentId, versionId } = req.params;

      const doc = await documentService.activateVersion({
        projectId,
        documentId,
        versionId
      });

      return res.status(200).json({
        success: true,
        data: doc
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  },

  list: async (req, res) => {
    try {
      const { projectId } = req.params;
      const documents = await documentService.listDocuments(projectId);

      return res.status(200).json({
        success: true,
        data: documents
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  },

  getById: async (req, res) => {
    try {
      const { documentId } = req.params;
      const doc = await documentService.getDocumentById(documentId);

      return res.status(200).json({
        success: true,
        data: doc
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  },

  download: async (req, res) => {
    try {
      const { documentId } = req.params;
      const versionId = req.query?.versionId || null;

      const { stream, originalFilename, fileSize } = await documentService.getDownloadStream(
        documentId,
        versionId
      );

      // Safe download headers
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(originalFilename)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (fileSize) {
        res.setHeader('Content-Length', fileSize);
      }

      stream.pipe(res);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  },

  preview: async (req, res) => {
    try {
      const { documentId } = req.params;
      const versionId = req.query?.versionId || null;

      const { stream, originalFilename, contentType, fileSize } = await documentService.getPreviewStream(
        documentId,
        versionId
      );

      // Safe preview headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(originalFilename)}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      if (fileSize) {
        res.setHeader('Content-Length', fileSize);
      }

      stream.pipe(res);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'PREVIEW_ERROR'
      });
    }
  },

  delete: async (req, res) => {
    try {
      const { projectId, documentId } = req.params;
      const effectiveProjectId = projectId || req.document?.project_id;

      const result = await documentService.deleteDocument({
        projectId: effectiveProjectId,
        documentId
      });

      return res.status(200).json(result);
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  }
};

module.exports = documentController;
