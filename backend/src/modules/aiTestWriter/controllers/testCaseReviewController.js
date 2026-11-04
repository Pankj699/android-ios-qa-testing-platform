const testCaseReviewService = require('../services/testCaseReviewService');

/**
 * Gets full suite details.
 */
async function getSuite(req, res, next) {
  try {
    const { projectId, suiteId } = req.params;
    const details = await testCaseReviewService.getSuiteDetails(projectId, suiteId);

    return res.status(200).json({
      success: true,
      data: details
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Reviews a test case.
 */
async function reviewTestCase(req, res, next) {
  try {
    const { projectId, suiteId, testCaseId } = req.params;
    const { action, notes, modifications } = req.body || {};
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User identifier missing from request.'
      });
    }

    const result = await testCaseReviewService.reviewTestCase({
      projectId,
      suiteId,
      testCaseId,
      userId,
      action,
      notes,
      modifications
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Reviews a test suite.
 */
async function reviewSuite(req, res, next) {
  try {
    const { projectId, suiteId } = req.params;
    const { action, notes } = req.body || {};
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User identifier missing from request.'
      });
    }

    const result = await testCaseReviewService.reviewSuite({
      projectId,
      suiteId,
      userId,
      action,
      notes
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Converts a proposal to a test case.
 */
async function convertProposal(req, res, next) {
  try {
    const { projectId, suiteId, proposalId } = req.params;
    const { targetScenarioId } = req.body || {};
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User identifier missing from request.'
      });
    }

    const result = await testCaseReviewService.convertProposal({
      projectId,
      suiteId,
      proposalId,
      userId,
      targetScenarioId
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Rejects a proposal.
 */
async function rejectProposal(req, res, next) {
  try {
    const { projectId, suiteId, proposalId } = req.params;
    const userId = req.user?.id || req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User identifier missing from request.'
      });
    }

    const result = await testCaseReviewService.rejectProposal({
      projectId,
      suiteId,
      proposalId,
      userId
    });

    return res.status(200).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getSuite,
  reviewTestCase,
  reviewSuite,
  convertProposal,
  rejectProposal
};
