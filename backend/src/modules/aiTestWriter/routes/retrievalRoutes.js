const express = require('express');
const { verifyProjectAccess } = require('../middleware/authOptionB');
const retrievalController = require('../controllers/retrievalController');

const router = express.Router({ mergeParams: true });

/**
 * Knowledge Base Hybrid Retrieval Routes
 * Base mount point: /projects/:projectId/retrieval (within /api/ai)
 */
router.post('/search', verifyProjectAccess, retrievalController.searchKnowledgeBase);

module.exports = router;
