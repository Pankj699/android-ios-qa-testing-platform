const express = require('express');
const multer = require('multer');
const { verifyProjectAccess, verifyDocumentAccess, requireAuth } = require('../middleware/authOptionB');
const projectController = require('../controllers/projectController');
const documentController = require('../controllers/documentController');
const extractionController = require('../controllers/extractionController');
const indexingController = require('../controllers/indexingController');
const retrievalController = require('../controllers/retrievalController');
const retrievalRoutes = require('./retrievalRoutes');
const requirementAnalysisRoutes = require('./requirementAnalysisRoutes');
const testCaseRoutes = require('./testCaseRoutes');

const router = express.Router();

// 25 MB upload limit
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024
  }
});

// Middleware to catch multer-specific errors (e.g. file size limit exceeded)
function handleFileUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'File size exceeds the 25 MB limit.'
        });
      }
      return res.status(400).json({
        success: false,
        error: `File upload error: ${err.message}`
      });
    }
    next();
  });
}

// ==========================================
// Project Routes
// ==========================================
router.get('/projects', requireAuth, projectController.list);
router.post('/projects', requireAuth, projectController.create);
router.get('/projects/:projectId', verifyProjectAccess, projectController.getById);

// ==========================================
// Project-Scoped Document Routes
// ==========================================
router.get('/projects/:projectId/documents', verifyProjectAccess, documentController.list);
router.post('/projects/:projectId/documents', verifyProjectAccess, handleFileUpload, documentController.upload);
router.get('/projects/:projectId/documents/:documentId', verifyProjectAccess, verifyDocumentAccess, documentController.getById);
router.post('/projects/:projectId/documents/:documentId/versions', verifyProjectAccess, verifyDocumentAccess, handleFileUpload, documentController.createVersion);
router.post('/projects/:projectId/documents/:documentId/versions/:versionId/activate', verifyProjectAccess, verifyDocumentAccess, documentController.activateVersion);
router.get('/projects/:projectId/documents/:documentId/download', verifyProjectAccess, verifyDocumentAccess, documentController.download);
router.get('/projects/:projectId/documents/:documentId/preview', verifyProjectAccess, verifyDocumentAccess, documentController.preview);
router.delete('/projects/:projectId/documents/:documentId', verifyProjectAccess, verifyDocumentAccess, documentController.delete);

// ==========================================
// Project-Scoped Extraction & Provenance Routes
// ==========================================
router.post('/projects/:projectId/documents/:documentId/versions/:versionId/extract', verifyProjectAccess, verifyDocumentAccess, extractionController.triggerExtraction);
router.get('/projects/:projectId/documents/:documentId/versions/:versionId/extraction', verifyProjectAccess, verifyDocumentAccess, extractionController.getStatus);
router.get('/projects/:projectId/documents/:documentId/versions/:versionId/extraction/units', verifyProjectAccess, verifyDocumentAccess, extractionController.getUnits);
router.post('/projects/:projectId/documents/:documentId/versions/:versionId/reprocess', verifyProjectAccess, verifyDocumentAccess, extractionController.reprocess);

// ==========================================
// Project-Scoped Indexing & Chunk Routes
// ==========================================
router.post('/projects/:projectId/documents/:documentId/versions/:versionId/index', verifyProjectAccess, verifyDocumentAccess, indexingController.triggerIndexing);
router.get('/projects/:projectId/documents/:documentId/versions/:versionId/indexing-status', verifyProjectAccess, verifyDocumentAccess, indexingController.getStatus);
router.get('/projects/:projectId/documents/:documentId/versions/:versionId/chunks', verifyProjectAccess, verifyDocumentAccess, indexingController.getChunks);
router.get('/projects/:projectId/documents/:documentId/versions/:versionId/chunks/:chunkId', verifyProjectAccess, verifyDocumentAccess, indexingController.getChunkDetails);
router.post('/projects/:projectId/documents/:documentId/versions/:versionId/reindex', verifyProjectAccess, verifyDocumentAccess, indexingController.reindex);

// ==========================================
// Project-Scoped Knowledge Base Retrieval Routes
// ==========================================
router.use('/projects/:projectId/retrieval', retrievalRoutes);
router.post('/projects/:projectId/retrieval/search', verifyProjectAccess, retrievalController.searchKnowledgeBase);

// ==========================================
// Project-Scoped Requirement Analysis Routes
// ==========================================
router.use('/projects/:projectId/requirements', requirementAnalysisRoutes);

// ==========================================
// Project-Scoped Test Case & Suite Routes
// ==========================================
router.use('/projects/:projectId/test-cases', testCaseRoutes);
router.use('/projects/:projectId/suites', testCaseRoutes);

// ==========================================
// Direct Document Routes (Option B validated through document's project)
// ==========================================
router.get('/documents/:documentId', verifyDocumentAccess, documentController.getById);
router.get('/documents/:documentId/download', verifyDocumentAccess, documentController.download);
router.get('/documents/:documentId/preview', verifyDocumentAccess, documentController.preview);
router.delete('/documents/:documentId', verifyDocumentAccess, documentController.delete);

// Direct Document Extraction Routes
router.post('/documents/:documentId/versions/:versionId/extract', verifyDocumentAccess, extractionController.triggerExtraction);
router.get('/documents/:documentId/versions/:versionId/extraction', verifyDocumentAccess, extractionController.getStatus);
router.get('/documents/:documentId/versions/:versionId/extraction/units', verifyDocumentAccess, extractionController.getUnits);
router.post('/documents/:documentId/versions/:versionId/reprocess', verifyDocumentAccess, extractionController.reprocess);

// Direct Document Indexing Routes
router.post('/documents/:documentId/versions/:versionId/index', verifyDocumentAccess, indexingController.triggerIndexing);
router.get('/documents/:documentId/versions/:versionId/indexing-status', verifyDocumentAccess, indexingController.getStatus);
router.get('/documents/:documentId/versions/:versionId/chunks', verifyDocumentAccess, indexingController.getChunks);
router.get('/documents/:documentId/versions/:versionId/chunks/:chunkId', verifyDocumentAccess, indexingController.getChunkDetails);
router.post('/documents/:documentId/versions/:versionId/reindex', verifyDocumentAccess, indexingController.reindex);

module.exports = router;
