const requirementAnalysisService = require('../services/requirementAnalysisService');

/**
 * Controller for Requirement Analysis & Knowledge-Grounded RAG Endpoints.
 * Scoped by project_id and enforces Option B authorization.
 */
const requirementAnalysisController = {
  /**
   * Submits development task for asynchronous analysis.
   * POST /api/ai/projects/:projectId/requirements/analyze
   * Returns HTTP 202 Accepted with job metadata.
   */
  analyze: async (req, res) => {
    try {
      const projectId = req.params.projectId;
      const userId = req.user?.id || '00000000-0000-0000-0000-000000000001';
      const {
        ticketId,
        title,
        description,
        rawText,
        saveAttachmentToKb,
        retrievalMode,
        candidateLimit,
        idempotencyKey,
        autoStart
      } = req.body || {};

      const file = req.file || null;

      const result = await requirementAnalysisService.submitAnalysisJob({
        projectId,
        userId,
        ticketId,
        title,
        description,
        rawText,
        file,
        saveAttachmentToKb: saveAttachmentToKb === 'true' || saveAttachmentToKb === true,
        retrievalMode,
        candidateLimit: candidateLimit ? parseInt(candidateLimit, 10) : 10,
        idempotencyKey,
        autoStart: autoStart === undefined ? true : (autoStart !== false && autoStart !== 'false')
      });

      return res.status(202).json({
        success: true,
        message: 'Requirement analysis job accepted for asynchronous processing.',
        data: result
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'REQUIREMENT_ANALYSIS_SUBMISSION_ERROR'
      });
    }
  },

  /**
   * Retrieves asynchronous job status, stage, and progress.
   * GET /api/ai/projects/:projectId/requirements/jobs/:jobId
   */
  getJobStatus: async (req, res) => {
    try {
      const { projectId, jobId } = req.params;
      const job = await requirementAnalysisService.getJobStatus(projectId, jobId);

      return res.status(200).json({
        success: true,
        data: job
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'JOB_STATUS_ERROR'
      });
    }
  },

  /**
   * Retrieves a completed requirement analysis including all extracted requirements and citations.
   * GET /api/ai/projects/:projectId/requirements/analyses/:analysisId
   */
  getAnalysis: async (req, res) => {
    try {
      const { projectId, analysisId } = req.params;
      const analysis = await requirementAnalysisService.getAnalysisById(projectId, analysisId);

      return res.status(200).json({
        success: true,
        data: analysis
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'ANALYSIS_NOT_FOUND'
      });
    }
  },

  /**
   * Lists past requirement analysis sessions for a project.
   * GET /api/ai/projects/:projectId/requirements/analyses
   */
  listAnalyses: async (req, res) => {
    try {
      const { projectId } = req.params;
      const { page, limit, search } = req.query;

      const result = await requirementAnalysisService.listAnalyses(projectId, {
        page,
        limit,
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
   * Safely deletes an analysis session while preserving requirements and RTM links.
   * DELETE /api/ai/projects/:projectId/requirements/analyses/:analysisId
   */
  deleteAnalysis: async (req, res) => {
    try {
      const { projectId, analysisId } = req.params;
      const result = await requirementAnalysisService.deleteAnalysis(projectId, analysisId);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'ANALYSIS_DELETE_ERROR'
      });
    }
  },

  /**
   * Lists requirements for a project with optional filters.
   * GET /api/ai/projects/:projectId/requirements
   */
  listRequirements: async (req, res) => {
    try {
      const { projectId } = req.params;
      const { analysisId, status, category, search, page, limit } = req.query;

      const result = await requirementAnalysisService.listRequirements(projectId, {
        analysisId,
        status,
        category,
        search,
        page,
        limit
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
   * Explicit human approval promoting a requirement from DRAFT to ACTIVE.
   * POST /api/ai/projects/:projectId/requirements/:requirementId/approve
   */
  approveRequirement: async (req, res) => {
    try {
      const { projectId, requirementId } = req.params;
      const userId = req.user?.id || '00000000-0000-0000-0000-000000000001';
      const { notes } = req.body || {};

      const result = await requirementAnalysisService.approveRequirement(
        projectId,
        requirementId,
        userId,
        notes
      );

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message,
        code: err.code || 'APPROVE_REQUIREMENT_ERROR'
      });
    }
  }
};

module.exports = requirementAnalysisController;
