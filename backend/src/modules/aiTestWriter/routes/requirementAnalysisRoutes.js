const express = require('express');
const multer = require('multer');
const { verifyProjectAccess } = require('../middleware/authOptionB');
const requirementAnalysisController = require('../controllers/requirementAnalysisController');

const router = express.Router({ mergeParams: true });

// 10 MB upload limit for task attachments (PDF, DOCX, XLSX, CSV, TXT)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024
  }
});

// Middleware to catch attachment-specific multer errors
function handleAttachmentUpload(req, res, next) {
  upload.single('file')(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({
          success: false,
          error: 'Task attachment size exceeds the 10 MB limit.',
          code: 'LIMIT_FILE_SIZE'
        });
      }
      return res.status(400).json({
        success: false,
        error: `Attachment upload error: ${err.message}`,
        code: 'ATTACHMENT_UPLOAD_ERROR'
      });
    }
    next();
  });
}

/**
 * Requirement Analysis & Knowledge-Grounded RAG Routes
 * Base mount point: /projects/:projectId/requirements (within /api/ai)
 */

// 1. Submit asynchronous requirement analysis job
router.post('/analyze', verifyProjectAccess, handleAttachmentUpload, requirementAnalysisController.analyze);

// 2. Poll asynchronous job status
router.get('/jobs/:jobId', verifyProjectAccess, requirementAnalysisController.getJobStatus);

// 3. List past analysis sessions
router.get('/analyses', verifyProjectAccess, requirementAnalysisController.listAnalyses);

// 4. Retrieve complete analysis details with requirements and citations
router.get('/analyses/:analysisId', verifyProjectAccess, requirementAnalysisController.getAnalysis);

// 5. Delete analysis session (safe: preserves active requirements and RTM links)
router.delete('/analyses/:analysisId', verifyProjectAccess, requirementAnalysisController.deleteAnalysis);

// 6. List requirements for project (supports filters: status, analysisId, category, search)
router.get('/', verifyProjectAccess, requirementAnalysisController.listRequirements);

// 7. Explicit human approval: promote requirement DRAFT -> ACTIVE
router.post('/:requirementId/approve', verifyProjectAccess, requirementAnalysisController.approveRequirement);

module.exports = router;
