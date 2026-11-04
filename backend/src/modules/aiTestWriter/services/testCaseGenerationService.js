const crypto = require('crypto');
const db = require('../db/connection');
const llmService = require('./llmService');
const retrievalService = require('./retrievalService');
const { withSharedInferenceLock } = require('./sharedInferenceLock');
const { validateTestCaseSchema, normalizeTestCaseOutput } = require('./testCaseSchemaValidator');

function getWorkerId() {
  return `tc_worker_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Creates an asynchronous test case generation job with canonical corpus pinning.
 */
async function createGenerationJob({
  projectId,
  userId,
  requirementIds = [],
  moduleName = null,
  candidateLimit = 10,
  retrievalMode = 'HYBRID',
  idempotencyKey = null,
  autoStart = true
}) {
  const pool = db.getPool();

  // 1. Idempotency Check
  const effectiveIdempotencyKey = idempotencyKey || `gen_tc_${projectId}_${crypto.randomBytes(8).toString('hex')}`;

  const existingRes = await pool.query(`
    SELECT id, status, current_stage, progress_percent, result_reference, created_at
    FROM ai_generation_jobs
    WHERE project_id = $1
      AND idempotency_key = $2
      AND job_type = 'GENERATE_TEST_CASES'
    LIMIT 1;
  `, [projectId, effectiveIdempotencyKey]);

  if (existingRes.rows.length > 0) {
    const existing = existingRes.rows[0];
    return {
      jobId: existing.id,
      job_id: existing.id,
      projectId,
      project_id: projectId,
      status: existing.status,
      currentStage: existing.current_stage,
      current_stage: existing.current_stage,
      progressPercent: existing.progress_percent,
      progress_percent: existing.progress_percent,
      resultReference: existing.result_reference,
      isExisting: true
    };
  }

  // 2. Pin Active Corpus Fingerprint Upfront
  const fpRes = await pool.query(
    `SELECT fn_calculate_active_corpus_fingerprint($1) AS fp;`,
    [projectId]
  );
  const expectedCorpusIdentity = fpRes.rows[0]?.fp || null;

  const payload = {
    projectId,
    requirementIds: Array.isArray(requirementIds) ? requirementIds : [],
    moduleName: moduleName || 'GENERAL',
    candidateLimit: Math.min(Math.max(candidateLimit || 10, 5), 50),
    retrievalMode: retrievalMode || 'HYBRID',
    expected_corpus_identity: expectedCorpusIdentity
  };

  // 3. Insert Job Record
  const insertRes = await pool.query(`
    INSERT INTO ai_generation_jobs (
      project_id,
      user_id,
      job_type,
      idempotency_key,
      status,
      current_stage,
      progress_percent,
      payload
    ) VALUES ($1, $2, 'GENERATE_TEST_CASES', $3, 'PENDING', 'QUEUED', 0, $4)
    RETURNING id, status, current_stage, progress_percent;
  `, [projectId, userId, effectiveIdempotencyKey, JSON.stringify(payload)]);

  const job = insertRes.rows[0];

  // 4. Trigger Asynchronous Worker
  if (autoStart) {
    setImmediate(() => {
      executeTestCaseWorker(job.id).catch(err => {
        console.error(`[TestCaseWorker] Unhandled error processing job ${job.id}:`, err);
      });
    });
  }

  return {
    jobId: job.id,
    job_id: job.id,
    projectId,
    project_id: projectId,
    status: job.status,
    currentStage: job.current_stage,
    current_stage: job.current_stage,
    progressPercent: job.progress_percent,
    progress_percent: job.progress_percent,
    expectedCorpusIdentity,
    isExisting: false
  };
}

/**
 * Retrieves the status and progress of a test case generation job.
 */
async function getJobStatus(jobId, projectId) {
  const pool = db.getPool();
  const res = await pool.query(`
    SELECT 
      id,
      project_id,
      user_id,
      job_type,
      status,
      current_stage,
      progress_percent,
      error_message,
      internal_diagnostics,
      result_reference,
      started_at,
      completed_at,
      created_at,
      updated_at
    FROM ai_generation_jobs
    WHERE id = $1 AND project_id = $2;
  `, [jobId, projectId]);

  if (res.rows.length === 0) {
    const err = new Error(`Job ${jobId} not found in project ${projectId}.`);
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  return res.rows[0];
}

/**
 * Worker execution for test case generation.
 */
async function executeTestCaseWorker(jobId) {
  const workerId = getWorkerId();
  const pool = db.getPool();
  const claimClient = await pool.connect();

  let claimToken = null;
  let version = null;
  let projectId = null;
  let userId = null;
  let payload = {};

  try {
    // -------------------------------------------------------------------------
    // 1. Atomic Job Claim
    // -------------------------------------------------------------------------
    const claimRes = await claimClient.query(`
      UPDATE ai_generation_jobs
      SET status = 'PROCESSING',
          claim_token = gen_random_uuid(),
          worker_id = $2,
          version = version + 1,
          lease_expires_at = clock_timestamp() + INTERVAL '2 minutes',
          last_heartbeat_at = clock_timestamp(),
          started_at = COALESCE(started_at, clock_timestamp()),
          current_stage = 'CLAIMED',
          progress_percent = 5,
          updated_at = clock_timestamp()
      WHERE id = $1
        AND (
          status = 'PENDING'
          OR (status = 'PROCESSING' AND lease_expires_at < clock_timestamp())
        )
      RETURNING id, project_id, user_id, claim_token, version, payload;
    `, [jobId, workerId]);

    if (claimRes.rows.length === 0) {
      claimClient.release();
      return;
    }

    const job = claimRes.rows[0];
    claimToken = job.claim_token;
    version = job.version;
    projectId = job.project_id;
    userId = job.user_id;
    payload = job.payload || {};
  } finally {
    claimClient.release();
  }

  // Stage update helper
  const updateStage = async (stage, progress, diagnostics = null) => {
    const res = await pool.query(`
      UPDATE ai_generation_jobs
      SET current_stage = $1,
          progress_percent = $2,
          internal_diagnostics = CASE WHEN $3::jsonb IS NOT NULL THEN $3::jsonb ELSE internal_diagnostics END,
          last_heartbeat_at = clock_timestamp(),
          lease_expires_at = clock_timestamp() + INTERVAL '2 minutes',
          updated_at = clock_timestamp()
      WHERE id = $4
        AND claim_token = $5
        AND version = $6
        AND status = 'PROCESSING'
      RETURNING id;
    `, [stage, progress, diagnostics ? JSON.stringify(diagnostics) : null, jobId, claimToken, version]);

    if (res.rowCount === 0) {
      const fenceErr = new Error('FENCING_ERROR: Worker lost ownership during stage update.');
      fenceErr.code = 'WORKER_FENCED';
      throw fenceErr;
    }
  };

  try {
    // -------------------------------------------------------------------------
    // STAGE 1: VALIDATING INPUT (10%)
    // -------------------------------------------------------------------------
    await updateStage('VALIDATING_INPUT', 10);

    // -------------------------------------------------------------------------
    // STAGE 2: VERIFYING CORPUS & RETRIEVING UNDER REPEATABLE READ (30%)
    // -------------------------------------------------------------------------
    await updateStage('VERIFYING_CORPUS_AND_RETRIEVING', 30);

    const snapshotClient = await pool.connect();
    let activeRequirements = [];
    let retrievedEvidence = [];
    let verifiedCorpusFingerprint = null;

    try {
      await snapshotClient.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;');

      // 1. Verify Active Corpus Fingerprint within Snapshot
      const fpCheck = await snapshotClient.query(
        `SELECT fn_calculate_active_corpus_fingerprint($1) AS fp;`,
        [projectId]
      );
      verifiedCorpusFingerprint = fpCheck.rows[0]?.fp || null;

      if (payload.expected_corpus_identity && verifiedCorpusFingerprint !== payload.expected_corpus_identity) {
        await snapshotClient.query('ROLLBACK;');
        const mutateErr = new Error(`CORPUS_MUTATED_CONCURRENTLY: Active corpus changed from expected ${payload.expected_corpus_identity} to ${verifiedCorpusFingerprint}.`);
        mutateErr.code = 'CORPUS_MUTATED_CONCURRENTLY';
        mutateErr.retryable = true;
        throw mutateErr;
      }

      // 2. Fetch Active Requirements
      let reqQuery;
      let reqQueryParams;
      if (Array.isArray(payload.requirementIds) && payload.requirementIds.length > 0) {
        reqQuery = `
          SELECT id, req_key, title, description, business_rules, acceptance_criteria, validations, dependencies, source_classification
          FROM ai_requirements
          WHERE project_id = $1 AND id = ANY($2::uuid[]) AND status = 'ACTIVE'
          ORDER BY req_key ASC;
        `;
        reqQueryParams = [projectId, payload.requirementIds];
      } else {
        reqQuery = `
          SELECT id, req_key, title, description, business_rules, acceptance_criteria, validations, dependencies, source_classification
          FROM ai_requirements
          WHERE project_id = $1 AND status = 'ACTIVE'
          ORDER BY req_key ASC;
        `;
        reqQueryParams = [projectId];
      }

      const reqRes = await snapshotClient.query(reqQuery, reqQueryParams);
      activeRequirements = reqRes.rows.map(r => ({
        ...r,
        requirement_key: r.req_key,
        classification: r.source_classification
      }));

      if (activeRequirements.length === 0) {
        await snapshotClient.query('ROLLBACK;');
        const noReqErr = new Error(`No ACTIVE requirements found for project ${projectId}. Active requirements are required for test generation.`);
        noReqErr.code = 'NO_ACTIVE_REQUIREMENTS';
        throw noReqErr;
      }

      // 3. Retrieve Hybrid Knowledge Base Chunks
      const queryTexts = activeRequirements.map(r => r.title).slice(0, 3).join(' ');
      if (queryTexts.trim().length > 0) {
        try {
          const retRes = await retrievalService.hybridSearch({
            projectId,
            query: queryTexts,
            mode: payload.retrievalMode || 'HYBRID',
            limit: payload.candidateLimit || 10,
            candidateLimit: 50,
            fallbackOnSemanticFailure: true,
            client: snapshotClient
          });
          retrievedEvidence = retRes.results || [];
        } catch (retErr) {
          console.warn(`[TestCaseWorker] Hybrid retrieval warning on job ${jobId}:`, retErr.message);
          retrievedEvidence = [];
        }
      }

      await snapshotClient.query('COMMIT;');
    } catch (sErr) {
      await snapshotClient.query('ROLLBACK;').catch(() => {});
      throw sErr;
    } finally {
      snapshotClient.release();
    }

    // -------------------------------------------------------------------------
    // STAGE 3: FORMULATING PROMPT (45%)
    // -------------------------------------------------------------------------
    await updateStage('FORMULATING_PROMPT', 45);

    const requirementsBlock = activeRequirements.map((r, i) => {
      const rules = Array.isArray(r.business_rules) ? r.business_rules.join('; ') : '';
      const ac = Array.isArray(r.acceptance_criteria) ? r.acceptance_criteria.join('; ') : '';
      return `[${r.requirement_key}] Title: ${r.title}
Classification: ${r.classification}
Description: ${r.description}
${rules ? `Business Rules: ${rules}\n` : ''}${ac ? `Acceptance Criteria: ${ac}\n` : ''}`;
    }).join('\n---\n');

    const evidenceMap = new Map();
    const evidenceBlock = retrievedEvidence.map((c, i) => {
      const eKey = `E-${i + 1}`;
      evidenceMap.set(eKey, c);
      return `[${eKey}] Source: ${c.documentTitle || c.originalFilename} (p. ${c.pageNumber || 1}, section: ${c.sectionHeading || 'N/A'})\n${c.content}`;
    }).join('\n\n') || 'No project knowledge base evidence retrieved.';

    const systemPrompt = `You are a Senior Principal QA Engineer specializing in mission-critical automated and manual test case design.
Generate comprehensive, structured test scenarios and test cases strictly matching the JSON schema.

RULES:
1. Every test case MUST have a clear title, priority (LOW, MEDIUM, HIGH, CRITICAL), and source_classification (DIRECT_REQUIREMENT, GROUNDED_INFERENCE, ASSUMPTION).
2. For DIRECT_REQUIREMENT, you MUST cite at least one valid requirement key from the Active Requirements block in 'traceability_keys' (e.g. ["REQ-1"]).
3. In 'evidence_references', you may ONLY cite keys from the Evidence block (e.g. ["E-1"]). Never invent keys.
4. For every expected result, you MUST provide classification:
   - "SPECIFIED": Explicitly stated in the requirement or evidence.
   - "EXPECTED_BEHAVIOR_UNSPECIFIED": Logical QA standard behavior not explicitly documented.
   - "NEEDS_CLARIFICATION": Ambiguous or contradictory behavior requiring human engineer signoff.
5. Create diverse scenario types: FUNCTIONAL, EDGE_CASE, SECURITY, PERFORMANCE, USABILITY, INTEGRATION, NEGATIVE.
6. Proposals array: Ideas that cannot be formally grounded in the provided requirements go into 'proposals'.
7. Return pure valid JSON only matching the schema.`;

    const userPrompt = `=== ACTIVE REQUIREMENTS ===
${requirementsBlock}

=== RETRIEVED KNOWLEDGE BASE EVIDENCE ===
${evidenceBlock}

Generate 2-3 focused test scenarios with 1-2 test cases each, and 1 exploratory proposal for module: "${payload.moduleName}". Return strictly valid JSON.`;

    // -------------------------------------------------------------------------
    // STAGE 4: INFERRING TEST CASES WITH SHARED INFERENCE LOCK (70%)
    // -------------------------------------------------------------------------
    await updateStage('INFERRING_TEST_CASES', 70);

    let parsedOutput;
    await withSharedInferenceLock({
      pool,
      jobId,
      claimToken,
      version,
      lockTimeoutMs: 300000,
      heartbeatIntervalMs: 5000,
      maxHeartbeatFailureMs: 15000
    }, async ({ abortSignal, checkFenced }) => {
      checkFenced();

      const llmResult = await llmService.generateStructuredCompletion({
        prompt: userPrompt,
        systemPrompt,
        temperature: 0.1,
        timeoutMs: 300000,
        signal: abortSignal
      });

      checkFenced();

      try {
        parsedOutput = JSON.parse(llmResult.rawResponse);
      } catch (parseErr) {
        // Repair pass
        console.warn(`[TestCaseWorker] JSON syntax error on job ${jobId}. Attempting repair pass...`);
        const repairRes = await llmService.generateStructuredCompletion({
          prompt: `Fix JSON syntax errors and return pure valid JSON matching schema:\n\n${llmResult.rawResponse}`,
          systemPrompt: 'You are a JSON repair specialist. Output only valid JSON.',
          temperature: 0.0,
          timeoutMs: 60000,
          signal: abortSignal
        });
        parsedOutput = JSON.parse(repairRes.rawResponse);
      }

      checkFenced();
    });

    // -------------------------------------------------------------------------
    // STAGE 5: VALIDATING SCHEMA & TRACEABILITY (85%)
    // -------------------------------------------------------------------------
    await updateStage('VALIDATING_SCHEMA_AND_TRACEABILITY', 85);

    parsedOutput = normalizeTestCaseOutput(parsedOutput, {
      suiteTitle: payload.suiteTitle || 'Test Suite',
      targetModule: payload.moduleName || 'Core'
    });
    const validation = validateTestCaseSchema(parsedOutput);
    if (!validation.valid) {
      const schemaErr = new Error(`Model test case output failed schema validation: ${JSON.stringify(validation.errors)}`);
      schemaErr.code = 'SCHEMA_VALIDATION_FAILED';
      throw schemaErr;
    }

    // Map active requirements for validation
    const validReqKeySet = new Set(activeRequirements.map(r => r.requirement_key));
    const validReqMap = new Map(activeRequirements.map(r => [r.requirement_key, r.id]));

    // -------------------------------------------------------------------------
    // STAGE 6: PERSISTING SUITE ATOMICALLY (100%)
    // -------------------------------------------------------------------------
    await updateStage('PERSISTING_SUITE', 95);

    const persistClient = await pool.connect();
    let suiteId;
    let totalScenarios = 0;
    let totalTestCases = 0;
    let totalProposals = 0;

    try {
      await persistClient.query('BEGIN;');

      // 1. Insert Suite
      const suiteKey = `SUITE-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const suiteTitle = parsedOutput.suite_title || `${payload.moduleName} Test Suite`;

      const suiteRes = await persistClient.query(`
        INSERT INTO ai_test_suites (
          project_id,
          job_id,
          suite_key,
          title,
          target_module,
          status,
          created_by_user_id
        ) VALUES ($1, $2, $3, $4, $5, 'DRAFT', $6)
        RETURNING id;
      `, [projectId, jobId, suiteKey, suiteTitle, payload.moduleName, userId]);

      suiteId = suiteRes.rows[0].id;

      // 2. Insert Scenarios and Test Cases
      for (let sIdx = 0; sIdx < parsedOutput.scenarios.length; sIdx++) {
        const scen = parsedOutput.scenarios[sIdx];
        const scenKey = `${suiteKey}-SCEN-${sIdx + 1}`;

        const scenRes = await persistClient.query(`
          INSERT INTO ai_test_scenarios (
            suite_id,
            scenario_key,
            title,
            scenario_type,
            description
          ) VALUES ($1, $2, $3, $4, $5)
          RETURNING id;
        `, [suiteId, scenKey, scen.title, scen.scenario_type, scen.description || null]);

        const scenarioId = scenRes.rows[0].id;
        totalScenarios++;

        for (let tIdx = 0; tIdx < scen.test_cases.length; tIdx++) {
          const tc = scen.test_cases[tIdx];
          const tcKey = `${scenKey}-TC-${tIdx + 1}`;

          // Format expected result text & metadata
          const expText = tc.expected_results.map(e => `[${e.classification}] ${e.description}`).join('\n');

          let dbClassification = 'DIRECT_REQUIREMENT';
          if (['INFERRED', 'GROUNDED_INFERENCE', 'ASSUMPTION'].includes(tc.source_classification)) {
            dbClassification = 'INFERRED';
          } else if (['EDGE_CASE', 'USER_SPECIFIED'].includes(tc.source_classification)) {
            dbClassification = tc.source_classification;
          }

          const tcRes = await persistClient.query(`
            INSERT INTO ai_test_cases (
              scenario_id,
              test_case_key,
              title,
              priority,
              source_classification,
              preconditions,
              test_steps,
              expected_result,
              evidence_references,
              execution_status,
              review_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'UNTESTED', 'PENDING')
            RETURNING id;
          `, [
            scenarioId,
            tcKey,
            tc.title,
            tc.priority,
            dbClassification,
            tc.preconditions || null,
            JSON.stringify(tc.test_steps),
            expText,
            JSON.stringify(tc.evidence_references)
          ]);

          const testCaseId = tcRes.rows[0].id;
          totalTestCases++;

          // Traceability links
          for (const reqKey of tc.traceability_keys) {
            const reqId = validReqMap.get(reqKey);
            if (reqId) {
              await persistClient.query(`
                INSERT INTO ai_requirement_traceability (
                  requirement_id,
                  test_case_id,
                  trace_type
                ) VALUES ($1, $2, 'DIRECT_COVERAGE')
                ON CONFLICT (requirement_id, test_case_id) DO NOTHING;
              `, [reqId, testCaseId]);
            }
          }
        }
      }

      // 3. Insert Proposals
      for (let pIdx = 0; pIdx < (parsedOutput.proposals || []).length; pIdx++) {
        const prop = parsedOutput.proposals[pIdx];
        const propKey = `${suiteKey}-PROP-${pIdx + 1}`;

        await persistClient.query(`
          INSERT INTO ai_test_case_proposals (
            suite_id,
            project_id,
            proposal_key,
            scenario_name,
            title,
            description,
            preconditions,
            steps,
            expected_results,
            priority,
            status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PROPOSED')
          ON CONFLICT (suite_id, proposal_key) DO NOTHING;
        `, [
          suiteId,
          projectId,
          propKey,
          prop.scenario_name,
          prop.title,
          prop.description || '',
          prop.preconditions || '',
          JSON.stringify(prop.steps),
          JSON.stringify(prop.expected_results),
          prop.priority
        ]);

        totalProposals++;
      }

      // 4. Update Job Completion
      const resultReference = {
        suite_id: suiteId,
        suite_key: suiteKey,
        suite_title: suiteTitle,
        total_scenarios: totalScenarios,
        total_test_cases: totalTestCases,
        total_proposals: totalProposals,
        corpus_fingerprint: verifiedCorpusFingerprint
      };

      await persistClient.query(`
        UPDATE ai_generation_jobs
        SET status = 'COMPLETED',
            current_stage = 'COMPLETED',
            progress_percent = 100,
            result_reference = $1,
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = $2;
      `, [JSON.stringify(resultReference), jobId]);

      await persistClient.query('COMMIT;');
    } catch (pErr) {
      await persistClient.query('ROLLBACK;').catch(() => {});
      throw pErr;
    } finally {
      persistClient.release();
    }

    console.log(`[TestCaseWorker] Job ${jobId} completed successfully. Generated suite ${suiteId} with ${totalTestCases} test cases.`);
  } catch (err) {
    console.error(`[TestCaseWorker] Job ${jobId} failed:`, err);

    await pool.query(`
      UPDATE ai_generation_jobs
      SET status = 'FAILED',
          current_stage = 'FAILED',
          error_message = $1,
          internal_diagnostics = jsonb_build_object(
            'error_code', $2::text,
            'error_message', $1::text,
            'failed_at', clock_timestamp()
          ),
          completed_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE id = $3;
    `, [err.message, err.code || 'UNKNOWN_ERROR', jobId]).catch(() => {});
  }
}

module.exports = {
  createGenerationJob,
  getJobStatus,
  executeTestCaseWorker
};
