const testCaseGenerationService = require('../services/testCaseGenerationService');
const db = require('../db/connection');

/**
 * Triggers test case generation job.
 */
async function generate(req, res, next) {
  try {
    const { projectId } = req.params;
    const requirementIds = req.body?.requirementIds || req.body?.requirement_ids || [];
    const moduleName = req.body?.moduleName || req.body?.target_module || req.body?.suite_title || 'Core';
    const candidateLimit = req.body?.candidateLimit || req.body?.candidate_limit || 10;
    const retrievalMode = req.body?.retrievalMode || req.body?.retrieval_mode || 'HYBRID';
    const idempotencyKey = req.body?.idempotencyKey || req.body?.idempotency_key || null;

    const userId = req.user?.id || req.user?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: User identifier missing from request.'
      });
    }

    const result = await testCaseGenerationService.createGenerationJob({
      projectId,
      userId,
      requirementIds,
      moduleName,
      candidateLimit,
      retrievalMode,
      idempotencyKey
    });

    return res.status(result.isExisting ? 200 : 202).json({
      success: true,
      data: result
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Gets test case generation job status.
 */
async function getJobStatus(req, res, next) {
  try {
    const { projectId, jobId } = req.params;
    const job = await testCaseGenerationService.getJobStatus(jobId, projectId);

    return res.status(200).json({
      success: true,
      data: job
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Lists test suites for a project.
 */
async function listSuites(req, res, next) {
  try {
    const { projectId } = req.params;
    const pool = db.getPool();

    const result = await pool.query(`
      SELECT 
        s.id,
        s.project_id,
        s.job_id,
        s.suite_key,
        s.title,
        s.target_module,
        s.status,
        s.created_at,
        s.updated_at,
        COUNT(DISTINCT sc.id) AS scenario_count,
        COUNT(DISTINCT tc.id) AS test_case_count
      FROM ai_test_suites s
      LEFT JOIN ai_test_scenarios sc ON sc.suite_id = s.id
      LEFT JOIN ai_test_cases tc ON tc.scenario_id = sc.id
      WHERE s.project_id = $1
      GROUP BY s.id
      ORDER BY s.created_at DESC;
    `, [projectId]);

    return res.status(200).json({
      success: true,
      data: result.rows
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  generate,
  getJobStatus,
  listSuites
};
