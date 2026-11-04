const db = require('../db/connection');

/**
 * Retrieves full suite hierarchy with scenarios, test cases, proposals, reviews, and diagnostics.
 */
async function getSuiteDetails(projectId, suiteId) {
  const pool = db.getPool();

  // 1. Suite metadata
  const suiteRes = await pool.query(`
    SELECT id, project_id, job_id, suite_key, title, target_module, status, created_by_user_id, created_at, updated_at
    FROM ai_test_suites
    WHERE id = $1 AND project_id = $2;
  `, [suiteId, projectId]);

  if (suiteRes.rows.length === 0) {
    const err = new Error(`Suite ${suiteId} not found in project ${projectId}.`);
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const suite = suiteRes.rows[0];

  // 2. Scenarios and Test Cases
  const scenRes = await pool.query(`
    SELECT id, suite_id, scenario_key, title, scenario_type, description, created_at
    FROM ai_test_scenarios
    WHERE suite_id = $1
    ORDER BY scenario_key ASC;
  `, [suiteId]);

  const scenarios = scenRes.rows;
  const scenarioIds = scenarios.map(s => s.id);

  let testCases = [];
  if (scenarioIds.length > 0) {
    const tcRes = await pool.query(`
      SELECT 
        tc.id,
        tc.scenario_id,
        tc.test_case_key,
        tc.title,
        tc.priority,
        tc.source_classification,
        tc.preconditions,
        tc.test_steps,
        tc.expected_result,
        tc.actual_result,
        tc.evidence_references,
        tc.execution_status,
        tc.review_status,
        tc.created_at,
        tc.updated_at,
        COALESCE(
          jsonb_agg(
            jsonb_build_object(
              'requirement_id', r.id,
              'requirement_key', r.req_key,
              'requirement_title', r.title,
              'trace_type', tr.trace_type
            )
          ) FILTER (WHERE r.id IS NOT NULL),
          '[]'::jsonb
        ) AS traceability
      FROM ai_test_cases tc
      LEFT JOIN ai_requirement_traceability tr ON tr.test_case_id = tc.id
      LEFT JOIN ai_requirements r ON r.id = tr.requirement_id
      WHERE tc.scenario_id = ANY($1::uuid[])
      GROUP BY tc.id
      ORDER BY tc.test_case_key ASC;
    `, [scenarioIds]);
    testCases = tcRes.rows;
  }

  // Map test cases into their scenarios
  const tcMap = new Map();
  for (const tc of testCases) {
    if (!tcMap.has(tc.scenario_id)) tcMap.set(tc.scenario_id, []);
    tcMap.get(tc.scenario_id).push(tc);
  }

  const enrichedScenarios = scenarios.map(sc => ({
    ...sc,
    test_cases: tcMap.get(sc.id) || []
  }));

  // 3. Proposals
  const propRes = await pool.query(`
    SELECT 
      id, suite_id, project_id, proposal_key, scenario_name, title, description,
      preconditions, steps, expected_results, priority, status,
      converted_test_case_id, converted_test_case_key_snapshot, converted_at, created_at, updated_at
    FROM ai_test_case_proposals
    WHERE suite_id = $1 AND project_id = $2
    ORDER BY proposal_key ASC;
  `, [suiteId, projectId]);

  // 4. Human Reviews
  const revRes = await pool.query(`
    SELECT id, project_id, suite_id, test_case_id, user_id, review_action, previous_state, updated_state,
           reviewer_notes, suite_key_snapshot, test_case_key_snapshot, created_at
    FROM ai_human_reviews
    WHERE project_id = $1 AND (suite_id = $2 OR test_case_id IN (
      SELECT tc.id FROM ai_test_cases tc JOIN ai_test_scenarios sc ON sc.id = tc.scenario_id WHERE sc.suite_id = $2
    ))
    ORDER BY created_at DESC;
  `, [projectId, suiteId]);

  // 5. Unresolved Behavior Diagnostics
  const unresolvedCases = testCases.filter(tc => 
    (tc.expected_result || '').includes('NEEDS_CLARIFICATION') && 
    tc.review_status !== 'ACCEPTED' && 
    tc.review_status !== 'MODIFIED' && 
    tc.review_status !== 'APPROVED'
  );

  return {
    suite,
    scenarios: enrichedScenarios,
    proposals: propRes.rows,
    reviews: revRes.rows,
    statistics: {
      total_scenarios: scenarios.length,
      total_test_cases: testCases.length,
      total_proposals: propRes.rows.length,
      approved_cases: testCases.filter(c => c.review_status === 'ACCEPTED' || c.review_status === 'APPROVED').length,
      unresolved_behavior_cases: unresolvedCases.length
    },
    unresolved_warnings: unresolvedCases.map(c => ({
      test_case_id: c.id,
      test_case_key: c.test_case_key,
      title: c.title,
      warning: 'Contains unreviewed NEEDS_CLARIFICATION behavior.'
    }))
  };
}

/**
 * Reviews a specific test case with audit trail preservation.
 */
async function reviewTestCase({
  projectId,
  suiteId,
  testCaseId,
  userId,
  action,
  notes = '',
  modifications = null
}) {
  const pool = db.getPool();
  const client = await pool.connect();

  const validActions = ['APPROVED', 'MODIFIED', 'REJECTED', 'COMMENTED'];
  const normalizedAction = (action || '').toUpperCase();
  if (!validActions.includes(normalizedAction)) {
    const err = new Error(`Invalid review action '${action}'. Must be one of: ${validActions.join(', ')}`);
    err.code = 'INVALID_ACTION';
    err.status = 400;
    throw err;
  }

  try {
    await client.query('BEGIN;');

    // Verify test case belongs to suite and project
    const tcRes = await client.query(`
      SELECT tc.id, tc.title, tc.priority, tc.source_classification, tc.preconditions,
             tc.test_steps, tc.expected_result, tc.review_status, s.id as suite_id, s.project_id
      FROM ai_test_cases tc
      JOIN ai_test_scenarios sc ON sc.id = tc.scenario_id
      JOIN ai_test_suites s ON s.id = sc.suite_id
      WHERE tc.id = $1 AND s.id = $2 AND s.project_id = $3
      FOR UPDATE;
    `, [testCaseId, suiteId, projectId]);

    if (tcRes.rows.length === 0) {
      const err = new Error(`Test case ${testCaseId} not found in suite ${suiteId}.`);
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const currentCase = tcRes.rows[0];
    const previousState = {
      title: currentCase.title,
      priority: currentCase.priority,
      preconditions: currentCase.preconditions,
      test_steps: currentCase.test_steps,
      expected_result: currentCase.expected_result,
      review_status: currentCase.review_status
    };

    let updatedReviewStatus = currentCase.review_status;
    let newTitle = currentCase.title;
    let newPriority = currentCase.priority;
    let newPreconditions = currentCase.preconditions;
    let newTestSteps = currentCase.test_steps;
    let newExpectedResult = currentCase.expected_result;

    if (normalizedAction === 'APPROVED') {
      updatedReviewStatus = 'ACCEPTED';
    } else if (normalizedAction === 'REJECTED') {
      updatedReviewStatus = 'REJECTED';
    } else if (normalizedAction === 'MODIFIED') {
      updatedReviewStatus = 'MODIFIED';
      if (modifications) {
        if (modifications.title) newTitle = modifications.title;
        if (modifications.priority) newPriority = modifications.priority;
        if (modifications.preconditions !== undefined) newPreconditions = modifications.preconditions;
        if (modifications.test_steps) newTestSteps = modifications.test_steps;
        if (modifications.expected_result) newExpectedResult = modifications.expected_result;
      }
    }

    // Update test case
    await client.query(`
      UPDATE ai_test_cases
      SET title = $1,
          priority = $2,
          preconditions = $3,
          test_steps = $4,
          expected_result = $5,
          review_status = $6,
          updated_at = clock_timestamp()
      WHERE id = $7;
    `, [newTitle, newPriority, newPreconditions, JSON.stringify(newTestSteps), newExpectedResult, updatedReviewStatus, testCaseId]);

    const updatedState = {
      title: newTitle,
      priority: newPriority,
      preconditions: newPreconditions,
      test_steps: newTestSteps,
      expected_result: newExpectedResult,
      review_status: updatedReviewStatus
    };

    // Insert review record (trigger will validate project and populate genuine snapshots)
    const reviewRes = await client.query(`
      INSERT INTO ai_human_reviews (
        project_id,
        test_case_id,
        user_id,
        review_action,
        previous_state,
        updated_state,
        reviewer_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, suite_key_snapshot, test_case_key_snapshot, created_at;
    `, [projectId, testCaseId, userId, normalizedAction, JSON.stringify(previousState), JSON.stringify(updatedState), notes || null]);

    await client.query('COMMIT;');

    return {
      review: reviewRes.rows[0],
      testCase: {
        id: testCaseId,
        review_status: updatedReviewStatus,
        ...updatedState
      }
    };
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reviews and updates status of an entire test suite.
 */
async function reviewSuite({
  projectId,
  suiteId,
  userId,
  action,
  notes = ''
}) {
  const pool = db.getPool();
  const client = await pool.connect();

  const validActions = ['APPROVED', 'REJECTED', 'COMMENTED'];
  const normalizedAction = (action || '').toUpperCase();
  if (!validActions.includes(normalizedAction)) {
    const err = new Error(`Invalid suite review action '${action}'. Must be one of: ${validActions.join(', ')}`);
    err.code = 'INVALID_ACTION';
    err.status = 400;
    throw err;
  }

  try {
    await client.query('BEGIN;');

    const suiteRes = await client.query(`
      SELECT id, project_id, suite_key, title, status
      FROM ai_test_suites
      WHERE id = $1 AND project_id = $2
      FOR UPDATE;
    `, [suiteId, projectId]);

    if (suiteRes.rows.length === 0) {
      const err = new Error(`Suite ${suiteId} not found in project ${projectId}.`);
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const currentSuite = suiteRes.rows[0];

    // Gate suite approval if unreviewed cases, rejected cases, or ambiguous expected results exist
    if (normalizedAction === 'APPROVED') {
      // Rule 1: Block if any test case remains PENDING
      const pendingRes = await client.query(`
        SELECT count(*)
        FROM ai_test_cases tc
        JOIN ai_test_scenarios sc ON sc.id = tc.scenario_id
        WHERE sc.suite_id = $1 AND tc.review_status = 'PENDING';
      `, [suiteId]);
      const pendingCount = parseInt(pendingRes.rows[0].count, 10);
      if (pendingCount > 0) {
        const err = new Error(`CANNOT_APPROVE_SUITE [PENDING_CASES_EXIST]: Suite contains ${pendingCount} test case(s) with PENDING review status. Every test case must be explicitly reviewed.`);
        err.code = 'PENDING_CASES_EXIST';
        err.status = 422;
        throw err;
      }

      // Rule 2: Block if any test case is REJECTED
      const rejectedRes = await client.query(`
        SELECT count(*)
        FROM ai_test_cases tc
        JOIN ai_test_scenarios sc ON sc.id = tc.scenario_id
        WHERE sc.suite_id = $1 AND tc.review_status = 'REJECTED';
      `, [suiteId]);
      const rejectedCount = parseInt(rejectedRes.rows[0].count, 10);
      if (rejectedCount > 0) {
        const err = new Error(`CANNOT_APPROVE_SUITE [REJECTED_CASES_EXIST]: Suite contains ${rejectedCount} REJECTED test case(s). A suite containing rejected test cases cannot be approved.`);
        err.code = 'REJECTED_CASES_EXIST';
        err.status = 422;
        throw err;
      }

      // Rule 3: Block if any test case has EXPECTED_BEHAVIOR_UNSPECIFIED
      const unspecRes = await client.query(`
        SELECT count(*)
        FROM ai_test_cases tc
        JOIN ai_test_scenarios sc ON sc.id = tc.scenario_id
        WHERE sc.suite_id = $1 AND tc.expected_result LIKE '%EXPECTED_BEHAVIOR_UNSPECIFIED%';
      `, [suiteId]);
      const unspecCount = parseInt(unspecRes.rows[0].count, 10);
      if (unspecCount > 0) {
        const err = new Error(`CANNOT_APPROVE_SUITE [UNSPECIFIED_BEHAVIOR_EXIST]: Suite contains ${unspecCount} test case(s) with EXPECTED_BEHAVIOR_UNSPECIFIED. All expected behaviors must be specified prior to suite approval.`);
        err.code = 'UNSPECIFIED_BEHAVIOR_EXIST';
        err.status = 422;
        throw err;
      }

      // Rule 4: Block if any test case has NEEDS_CLARIFICATION
      const unresRes = await client.query(`
        SELECT count(*)
        FROM ai_test_cases tc
        JOIN ai_test_scenarios sc ON sc.id = tc.scenario_id
        WHERE sc.suite_id = $1 AND tc.expected_result LIKE '%NEEDS_CLARIFICATION%';
      `, [suiteId]);
      const unresolvedCount = parseInt(unresRes.rows[0].count, 10);
      if (unresolvedCount > 0) {
        const warnErr = new Error(`CANNOT_APPROVE_SUITE [UNRESOLVED_CLARIFICATIONS]: Suite contains ${unresolvedCount} test case(s) with unresolved 'NEEDS_CLARIFICATION' expected behavior. Clarifications must be resolved prior to suite approval.`);
        warnErr.code = 'UNRESOLVED_CLARIFICATIONS';
        warnErr.status = 422;
        throw warnErr;
      }
    }

    const previousState = { status: currentSuite.status };
    let newSuiteStatus = currentSuite.status;

    if (normalizedAction === 'APPROVED') {
      newSuiteStatus = 'APPROVED';
    } else if (normalizedAction === 'REJECTED') {
      newSuiteStatus = 'DRAFT';
    }

    await client.query(`
      UPDATE ai_test_suites
      SET status = $1,
          updated_at = clock_timestamp()
      WHERE id = $2;
    `, [newSuiteStatus, suiteId]);

    const updatedState = { status: newSuiteStatus };

    // Record suite-level review
    const reviewRes = await client.query(`
      INSERT INTO ai_human_reviews (
        project_id,
        suite_id,
        user_id,
        review_action,
        previous_state,
        updated_state,
        reviewer_notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id, suite_key_snapshot, created_at;
    `, [projectId, suiteId, userId, normalizedAction, JSON.stringify(previousState), JSON.stringify(updatedState), notes || null]);

    await client.query('COMMIT;');

    return {
      review: reviewRes.rows[0],
      suite: {
        id: suiteId,
        status: newSuiteStatus
      }
    };
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Atomically converts a test case proposal into a formal test case in the suite.
 */
async function convertProposal({
  projectId,
  suiteId,
  proposalId,
  userId,
  targetScenarioId = null
}) {
  const pool = db.getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN;');

    // 1. Lock proposal
    const propRes = await client.query(`
      SELECT id, suite_id, project_id, proposal_key, scenario_name, title, description,
             preconditions, steps, expected_results, priority, status
      FROM ai_test_case_proposals
      WHERE id = $1 AND suite_id = $2 AND project_id = $3
      FOR UPDATE;
    `, [proposalId, suiteId, projectId]);

    if (propRes.rows.length === 0) {
      const err = new Error(`Proposal ${proposalId} not found in suite ${suiteId}.`);
      err.code = 'NOT_FOUND';
      err.status = 404;
      throw err;
    }

    const proposal = propRes.rows[0];
    if (proposal.status !== 'PROPOSED') {
      const err = new Error(`ALREADY_CONVERTED: Proposal ${proposalId} is already ${proposal.status} and cannot be converted.`);
      err.code = 'ALREADY_CONVERTED';
      err.status = 400;
      throw err;
    }

    // 2. Lock suite
    await client.query(`
      SELECT id FROM ai_test_suites WHERE id = $1 AND project_id = $2 FOR UPDATE;
    `, [suiteId, projectId]);

    // 3. Find or Create target scenario
    let scenarioId = targetScenarioId;
    if (!scenarioId) {
      const scenRes = await client.query(`
        SELECT id FROM ai_test_scenarios
        WHERE suite_id = $1 AND title ILIKE $2
        ORDER BY scenario_key ASC LIMIT 1;
      `, [suiteId, proposal.scenario_name]);

      if (scenRes.rows.length > 0) {
        scenarioId = scenRes.rows[0].id;
      } else {
        const countRes = await client.query(`SELECT count(*) FROM ai_test_scenarios WHERE suite_id = $1;`, [suiteId]);
        const nextIdx = parseInt(countRes.rows[0].count, 10) + 1;
        const newScenRes = await client.query(`
          INSERT INTO ai_test_scenarios (suite_id, scenario_key, title, scenario_type, description)
          VALUES ($1, 'SCEN-' || $2, $3, 'FUNCTIONAL', 'Generated from proposal conversion')
          RETURNING id;
        `, [suiteId, nextIdx, proposal.scenario_name]);
        scenarioId = newScenRes.rows[0].id;
      }
    }

    // 4. Insert new test case
    const tcCountRes = await client.query(`SELECT count(*) FROM ai_test_cases WHERE scenario_id = $1;`, [scenarioId]);
    const tcIdx = parseInt(tcCountRes.rows[0].count, 10) + 1;
    const testCaseKey = `TC-PROP-${tcIdx}`;

    const expText = Array.isArray(proposal.expected_results)
      ? proposal.expected_results.map(e => `[SPECIFIED] ${e}`).join('\n')
      : String(proposal.expected_results || 'Expected behavior matches proposal');

    const newCaseRes = await client.query(`
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
      ) VALUES ($1, $2, $3, $4, 'INFERRED', $5, $6, $7, '[]'::jsonb, 'UNTESTED', 'PENDING')
      RETURNING id, test_case_key, title;
    `, [
      scenarioId,
      testCaseKey,
      proposal.title,
      proposal.priority,
      proposal.preconditions || null,
      JSON.stringify(proposal.steps || []),
      expText
    ]);

    const newCase = newCaseRes.rows[0];

    // 5. Update proposal with trigger validation
    await client.query(`
      UPDATE ai_test_case_proposals
      SET status = 'CONVERTED',
          converted_test_case_id = $1,
          converted_by_user_id = $2,
          converted_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE id = $3;
    `, [newCase.id, userId, proposalId]);

    await client.query('COMMIT;');

    return {
      success: true,
      proposalId,
      convertedTestCase: newCase
    };
  } catch (err) {
    await client.query('ROLLBACK;').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Rejects a test case proposal.
 */
async function rejectProposal({ projectId, suiteId, proposalId, userId }) {
  const pool = db.getPool();
  const res = await pool.query(`
    UPDATE ai_test_case_proposals
    SET status = 'REJECTED',
        updated_at = clock_timestamp()
    WHERE id = $1 AND suite_id = $2 AND project_id = $3
    RETURNING id, status, updated_at;
  `, [proposalId, suiteId, projectId]);

  if (res.rows.length === 0) {
    const err = new Error(`Proposal ${proposalId} not found in suite ${suiteId}.`);
    err.code = 'NOT_FOUND';
    err.status = 404;
    throw err;
  }

  return res.rows[0];
}

module.exports = {
  getSuiteDetails,
  reviewTestCase,
  reviewSuite,
  convertProposal,
  rejectProposal
};
