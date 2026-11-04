const express = require('express');
const { verifyProjectAccess } = require('../middleware/authOptionB');
const testCaseGenerationController = require('../controllers/testCaseGenerationController');
const testCaseReviewController = require('../controllers/testCaseReviewController');

const router = express.Router({ mergeParams: true });

// Generation and Jobs
router.post('/generate', verifyProjectAccess, testCaseGenerationController.generate);
router.get('/jobs/:jobId', verifyProjectAccess, testCaseGenerationController.getJobStatus);

// Suite Management and Review
router.get('/', verifyProjectAccess, testCaseGenerationController.listSuites);
router.get('/suites', verifyProjectAccess, testCaseGenerationController.listSuites);
router.get('/:suiteId', verifyProjectAccess, testCaseReviewController.getSuite);
router.get('/suites/:suiteId', verifyProjectAccess, testCaseReviewController.getSuite);
router.post('/:suiteId/review', verifyProjectAccess, testCaseReviewController.reviewSuite);
router.post('/suites/:suiteId/review', verifyProjectAccess, testCaseReviewController.reviewSuite);

// Case-Level Review
router.post('/:suiteId/cases/:testCaseId/review', verifyProjectAccess, testCaseReviewController.reviewTestCase);
router.post('/suites/:suiteId/cases/:testCaseId/review', verifyProjectAccess, testCaseReviewController.reviewTestCase);

// Proposal Management
router.post('/:suiteId/proposals/:proposalId/convert', verifyProjectAccess, testCaseReviewController.convertProposal);
router.post('/suites/:suiteId/proposals/:proposalId/convert', verifyProjectAccess, testCaseReviewController.convertProposal);
router.post('/:suiteId/proposals/:proposalId/reject', verifyProjectAccess, testCaseReviewController.rejectProposal);
router.post('/suites/:suiteId/proposals/:proposalId/reject', verifyProjectAccess, testCaseReviewController.rejectProposal);

module.exports = router;
