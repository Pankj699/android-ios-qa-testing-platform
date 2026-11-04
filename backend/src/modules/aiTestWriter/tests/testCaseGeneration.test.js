const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const db = require('../db/connection');
const { validateTestCaseSchema, normalizeTestCaseOutput } = require('../services/testCaseSchemaValidator');
const testCaseGenerationService = require('../services/testCaseGenerationService');
const testCaseReviewService = require('../services/testCaseReviewService');
const { withSharedInferenceLock, ADVISORY_CLASS_HASH, ADVISORY_OBJ_ID } = require('../services/sharedInferenceLock');

describe('Phase 2.8: Test Case Generation, Traceability & Review Suite', () => {
  let pool;
  let testProjectId;
  let testUserId;
  let testRequirementId;
  let testSuiteId;
  let testScenarioId;
  let testCaseId;
  let testProposalId;

  before(async () => {
    pool = db.getPool();
    testUserId = crypto.randomUUID();

    // Seed test project
    const pRes = await pool.query(`
      INSERT INTO ai_projects (name, slug, created_by_user_id)
      VALUES ('Phase 2.8 Test Project', 'phase-28-test-' || substr(gen_random_uuid()::text, 1, 8), $1)
      RETURNING id;
    `, [testUserId]);
    testProjectId = pRes.rows[0].id;

    // Seed active requirement
    const reqRes = await pool.query(`
      INSERT INTO ai_requirements (
        project_id, req_key, title, description, category, priority,
        business_rules, validations, dependencies, acceptance_criteria, evidence_citations,
        status, source_classification
      ) VALUES (
        $1, 'REQ-AUTH-01', 'User Login via OAuth2', 'System must support OAuth2 PKCE login.',
        'FUNCTIONAL', 'HIGH',
        '["User must provide valid client_id"]'::jsonb,
        '["Token must expire after 1 hour"]'::jsonb,
        '[]'::jsonb,
        '["Given credentials, token is returned"]'::jsonb,
        '[]'::jsonb,
        'ACTIVE', 'DIRECT'
      ) RETURNING id;
    `, [testProjectId]);
    testRequirementId = reqRes.rows[0].id;
  });

  after(async () => {
    if (testProjectId) {
      // Clean up project (cascades)
      await pool.query(`DELETE FROM ai_projects WHERE id = $1;`, [testProjectId]).catch(() => {});
    }
  });

  // =========================================================================
  // 1. Schema Validation & Normalization
  // =========================================================================
  describe('1. Schema Validation & Normalization', () => {
    it('1.1 Normalizes model output and validates correct test case schema', () => {
      const rawOutput = {
        suite_title: 'Auth Test Suite',
        target_module: 'AUTH',
        summary: 'Complete automated and manual scenarios for authentication.',
        scenarios: [
          {
            scenario_key: 'SCEN-1',
            title: 'Valid Login',
            scenario_type: 'functional',
            description: 'Positive authentication scenarios.',
            test_cases: [
              {
                test_case_key: 'TC-1',
                title: 'Login with standard credentials',
                priority: 'high',
                source_classification: 'direct_requirement',
                preconditions: 'User exists in auth db',
                test_steps: ['Enter username', 'Enter password', 'Click Submit'],
                expected_results: [
                  { description: 'Redirect to dashboard', classification: 'specified' }
                ],
                evidence_references: ['E-1'],
                traceability_keys: ['REQ-AUTH-01']
              }
            ]
          }
        ],
        proposals: [
          {
            proposal_key: 'PROP-1',
            scenario_name: 'Biometrics',
            title: 'Verify WebAuthn fingerprint support',
            description: 'Test proposal for future biometric integration',
            preconditions: 'Hardware key attached',
            steps: ['Trigger prompt'],
            expected_results: ['Prompt appears'],
            priority: 'medium'
          }
        ]
      };

      const normalized = normalizeTestCaseOutput(rawOutput);
      assert.equal(normalized.scenarios[0].scenario_type, 'FUNCTIONAL');
      assert.equal(normalized.scenarios[0].test_cases[0].priority, 'HIGH');
      assert.equal(normalized.scenarios[0].test_cases[0].source_classification, 'DIRECT_REQUIREMENT');
      assert.equal(normalized.scenarios[0].test_cases[0].expected_results[0].classification, 'SPECIFIED');

      const validation = validateTestCaseSchema(normalized);
      assert.equal(validation.valid, true);
      assert.equal(validation.errors.length, 0);
    });

    it('1.2 Rejects test case schema missing required fields', () => {
      const invalid = {
        suite_title: 'Incomplete Suite',
        // missing target_module, summary, scenarios, proposals
      };
      const validation = validateTestCaseSchema(invalid);
      assert.equal(validation.valid, false);
      assert.ok(validation.errors.length > 0);
    });
  });

  // =========================================================================
  // 2. Asynchronous Job Submission & Corpus Pinning
  // =========================================================================
  describe('2. Asynchronous Job Submission & Corpus Pinning', () => {
    it('2.1 Creates generation job with pinned corpus fingerprint', async () => {
      const jobRes = await testCaseGenerationService.createGenerationJob({
        projectId: testProjectId,
        userId: testUserId,
        requirementIds: [testRequirementId],
        moduleName: 'AUTH',
        idempotencyKey: 'test_idemp_key_1',
        autoStart: false
      });

      assert.ok(jobRes.jobId);
      assert.equal(jobRes.status, 'PENDING');
      assert.equal(jobRes.isExisting, false);

      const status = await testCaseGenerationService.getJobStatus(jobRes.jobId, testProjectId);
      assert.equal(status.id, jobRes.jobId);
      assert.equal(status.project_id, testProjectId);
      assert.equal(status.status, 'PENDING');
    });

    it('2.2 Idempotent duplicate submission returns existing job', async () => {
      const dupRes = await testCaseGenerationService.createGenerationJob({
        projectId: testProjectId,
        userId: testUserId,
        requirementIds: [testRequirementId],
        moduleName: 'AUTH',
        idempotencyKey: 'test_idemp_key_1',
        autoStart: false
      });

      assert.equal(dupRes.isExisting, true);
    });
  });

  // =========================================================================
  // 3. Test Suite, Scenarios & Cases Persistence
  // =========================================================================
  describe('3. Test Suite, Scenarios & Cases Persistence', () => {
    it('3.1 Persists suite, scenarios, cases, and proposals matching schema', async () => {
      const suiteKey = `SUITE-${Date.now().toString(36).toUpperCase()}`;

      // Insert Suite
      const sRes = await pool.query(`
        INSERT INTO ai_test_suites (
          project_id, suite_key, title, target_module, status, created_by_user_id
        ) VALUES ($1, $2, 'OAuth2 Integration Suite', 'AUTH', 'DRAFT', $3)
        RETURNING id;
      `, [testProjectId, suiteKey, testUserId]);
      testSuiteId = sRes.rows[0].id;

      // Insert Scenario
      const scRes = await pool.query(`
        INSERT INTO ai_test_scenarios (
          suite_id, scenario_key, title, scenario_type, description
        ) VALUES ($1, $2, 'OAuth2 Token Grant Flow', 'FUNCTIONAL', 'Verify token grants')
        RETURNING id;
      `, [testSuiteId, `${suiteKey}-SCEN-1`]);
      testScenarioId = scRes.rows[0].id;

      // Insert Test Case with NEEDS_CLARIFICATION expected result
      const tcRes = await pool.query(`
        INSERT INTO ai_test_cases (
          scenario_id, test_case_key, title, priority, source_classification,
          preconditions, test_steps, expected_result, evidence_references, execution_status, review_status
        ) VALUES (
          $1, $2, 'Login with Refresh Token Rotation', 'HIGH', 'DIRECT_REQUIREMENT',
          'User logged in', '["Call /token with refresh_token"]'::jsonb,
          '[SPECIFIED] New access token returned\n[NEEDS_CLARIFICATION] Old refresh token revocation behavior is undocumented',
          '[]'::jsonb, 'UNTESTED', 'PENDING'
        ) RETURNING id;
      `, [testScenarioId, `${suiteKey}-TC-1`]);
      testCaseId = tcRes.rows[0].id;

      // Link Traceability
      await pool.query(`
        INSERT INTO ai_requirement_traceability (requirement_id, test_case_id, trace_type)
        VALUES ($1, $2, 'DIRECT_COVERAGE')
        ON CONFLICT DO NOTHING;
      `, [testRequirementId, testCaseId]);

      // Insert Proposal
      const propRes = await pool.query(`
        INSERT INTO ai_test_case_proposals (
          suite_id, project_id, proposal_key, scenario_name, title, description,
          preconditions, steps, expected_results, priority, status
        ) VALUES (
          $1, $2, $3, 'Token Flow', 'Test Token Revocation on Logout', 'Verify token is blacklisted on logout',
          'Active session', '["Call /logout"]'::jsonb, '["Token rejected on next use"]'::jsonb,
          'MEDIUM', 'PROPOSED'
        ) RETURNING id;
      `, [testSuiteId, testProjectId, `${suiteKey}-PROP-1`]);
      testProposalId = propRes.rows[0].id;

      assert.ok(testSuiteId);
      assert.ok(testScenarioId);
      assert.ok(testCaseId);
      assert.ok(testProposalId);
    });

    it('3.2 getSuiteDetails returns complete hierarchy and flags NEEDS_CLARIFICATION warning', async () => {
      const details = await testCaseReviewService.getSuiteDetails(testProjectId, testSuiteId);

      assert.equal(details.suite.id, testSuiteId);
      assert.equal(details.scenarios.length, 1);
      assert.equal(details.scenarios[0].test_cases.length, 1);
      assert.equal(details.proposals.length, 1);

      // Verify traceability
      const tc = details.scenarios[0].test_cases[0];
      assert.equal(tc.traceability.length, 1);
      assert.equal(tc.traceability[0].requirement_key, 'REQ-AUTH-01');

      // Verify unresolved behavior warning is surfaced
      assert.equal(details.statistics.unresolved_behavior_cases, 1);
      assert.equal(details.unresolved_warnings.length, 1);
      assert.equal(details.unresolved_warnings[0].test_case_id, testCaseId);
    });
  });

  // =========================================================================
  // 4. Case-Level Review, Modifications & Audit Snapshot Integrity
  // =========================================================================
  describe('4. Case-Level Review, Modifications & Audit Snapshot Integrity', () => {
    it('4.1 Reviews and modifies a test case, recording genuine snapshot in ai_human_reviews', async () => {
      const reviewResult = await testCaseReviewService.reviewTestCase({
        projectId: testProjectId,
        suiteId: testSuiteId,
        testCaseId: testCaseId,
        userId: testUserId,
        action: 'MODIFIED',
        notes: 'Clarified token revocation behavior per security team',
        modifications: {
          expected_result: '[SPECIFIED] New access token returned\n[SPECIFIED] Old refresh token immediately invalidated.'
        }
      });

      assert.equal(reviewResult.testCase.review_status, 'MODIFIED');
      assert.ok(reviewResult.review.test_case_key_snapshot);

      // Check database review row
      const revInDb = (await pool.query(
        `SELECT * FROM ai_human_reviews WHERE id = $1;`,
        [reviewResult.review.id]
      )).rows[0];

      assert.equal(revInDb.review_action, 'MODIFIED');
      assert.equal(revInDb.test_case_key_snapshot.includes('TC-1'), true);
      assert.equal(revInDb.suite_key_snapshot.includes('SUITE-'), true);
      assert.equal(revInDb.project_id, testProjectId);
    });

    it('4.2 Rejects snapshot modification on UPDATE (immutable audit record)', async () => {
      const revRes = await pool.query(
        `SELECT id FROM ai_human_reviews WHERE test_case_id = $1 LIMIT 1;`,
        [testCaseId]
      );
      const revId = revRes.rows[0].id;

      await assert.rejects(async () => {
        await pool.query(`UPDATE ai_human_reviews SET test_case_key_snapshot = 'FORGED_KEY' WHERE id = $1;`, [revId]);
      }, /ImmutableViolation/);
    });

    it('4.3 Rejects forged snapshot on INSERT', async () => {
      await assert.rejects(async () => {
        await pool.query(`
          INSERT INTO ai_human_reviews (
            project_id, test_case_id, user_id, review_action, previous_state, updated_state, test_case_key_snapshot
          ) VALUES ($1, $2, $3, 'APPROVED', '{}'::jsonb, '{}'::jsonb, 'TC-FORGED-FAKE');
        `, [testProjectId, testCaseId, testUserId]);
      }, /ForgedSnapshotViolation/);
    });

    it('4.4 Approving the modified test case resolves the clarification warning', async () => {
      await testCaseReviewService.reviewTestCase({
        projectId: testProjectId,
        suiteId: testSuiteId,
        testCaseId: testCaseId,
        userId: testUserId,
        action: 'APPROVED',
        notes: 'Approved after clarification'
      });

      const details = await testCaseReviewService.getSuiteDetails(testProjectId, testSuiteId);
      assert.equal(details.statistics.unresolved_behavior_cases, 0);
      assert.equal(details.unresolved_warnings.length, 0);
    });
  });

  // =========================================================================
  // 5. Suite Approval & Unresolved Behavior Gating
  // =========================================================================
  describe('5. Suite Approval & Unresolved Behavior Gating', () => {
    it('5.1 Blocks suite approval if any test case remains PENDING', async () => {
      // Insert a PENDING case
      const pendingCase = await pool.query(`
        INSERT INTO ai_test_cases (
          scenario_id, test_case_key, title, priority, source_classification,
          preconditions, test_steps, expected_result, evidence_references, execution_status, review_status
        ) VALUES (
          $1, 'TC-GATE-PENDING', 'Pending Unreviewed Case', 'MEDIUM', 'INFERRED',
          'None', '[]'::jsonb,
          '[SPECIFIED] Specified behavior',
          '[]'::jsonb, 'UNTESTED', 'PENDING'
        ) RETURNING id;
      `, [testScenarioId]);
      const pendingId = pendingCase.rows[0].id;

      await assert.rejects(async () => {
        await testCaseReviewService.reviewSuite({
          projectId: testProjectId,
          suiteId: testSuiteId,
          userId: testUserId,
          action: 'APPROVED'
        });
      }, /PENDING_CASES_EXIST/);

      // Review the case to ACCEPTED
      await testCaseReviewService.reviewTestCase({
        projectId: testProjectId,
        suiteId: testSuiteId,
        testCaseId: pendingId,
        userId: testUserId,
        action: 'APPROVED'
      });
    });

    it('5.2 Blocks suite approval if any test case is REJECTED', async () => {
      // Insert a REJECTED case
      const rejCase = await pool.query(`
        INSERT INTO ai_test_cases (
          scenario_id, test_case_key, title, priority, source_classification,
          preconditions, test_steps, expected_result, evidence_references, execution_status, review_status
        ) VALUES (
          $1, 'TC-GATE-REJECTED', 'Rejected Case', 'LOW', 'EDGE_CASE',
          'None', '[]'::jsonb,
          '[SPECIFIED] Specified behavior',
          '[]'::jsonb, 'UNTESTED', 'REJECTED'
        ) RETURNING id;
      `, [testScenarioId]);
      const rejId = rejCase.rows[0].id;

      await assert.rejects(async () => {
        await testCaseReviewService.reviewSuite({
          projectId: testProjectId,
          suiteId: testSuiteId,
          userId: testUserId,
          action: 'APPROVED'
        });
      }, /REJECTED_CASES_EXIST/);

      // Clean up the rejected case for subsequent tests
      await pool.query(`DELETE FROM ai_test_cases WHERE id = $1;`, [rejId]);
    });

    it('5.3 Blocks suite approval if any test case has EXPECTED_BEHAVIOR_UNSPECIFIED', async () => {
      const unspecCase = await pool.query(`
        INSERT INTO ai_test_cases (
          scenario_id, test_case_key, title, priority, source_classification,
          preconditions, test_steps, expected_result, evidence_references, execution_status, review_status
        ) VALUES (
          $1, 'TC-GATE-UNSPEC', 'Unspecified Expected Behavior Case', 'MEDIUM', 'INFERRED',
          'None', '[]'::jsonb,
          '[EXPECTED_BEHAVIOR_UNSPECIFIED] Response schema not fully specified in docs',
          '[]'::jsonb, 'UNTESTED', 'ACCEPTED'
        ) RETURNING id;
      `, [testScenarioId]);
      const unspecId = unspecCase.rows[0].id;

      await assert.rejects(async () => {
        await testCaseReviewService.reviewSuite({
          projectId: testProjectId,
          suiteId: testSuiteId,
          userId: testUserId,
          action: 'APPROVED'
        });
      }, /UNSPECIFIED_BEHAVIOR_EXIST/);

      // Clean up
      await pool.query(`DELETE FROM ai_test_cases WHERE id = $1;`, [unspecId]);
    });

    it('5.4 Blocks suite approval if any test case has NEEDS_CLARIFICATION', async () => {
      const clarCase = await pool.query(`
        INSERT INTO ai_test_cases (
          scenario_id, test_case_key, title, priority, source_classification,
          preconditions, test_steps, expected_result, evidence_references, execution_status, review_status
        ) VALUES (
          $1, 'TC-GATE-CLARIFY', 'Clarification Required Case', 'HIGH', 'DIRECT_REQUIREMENT',
          'None', '[]'::jsonb,
          '[NEEDS_CLARIFICATION] Session timeout duration not confirmed',
          '[]'::jsonb, 'UNTESTED', 'ACCEPTED'
        ) RETURNING id;
      `, [testScenarioId]);
      const clarId = clarCase.rows[0].id;

      await assert.rejects(async () => {
        await testCaseReviewService.reviewSuite({
          projectId: testProjectId,
          suiteId: testSuiteId,
          userId: testUserId,
          action: 'APPROVED'
        });
      }, /UNRESOLVED_CLARIFICATIONS/);

      // Resolve by modifying to SPECIFIED
      await testCaseReviewService.reviewTestCase({
        projectId: testProjectId,
        suiteId: testSuiteId,
        testCaseId: clarId,
        userId: testUserId,
        action: 'MODIFIED',
        notes: 'Session timeout confirmed as 15 minutes',
        modifications: {
          expected_result: '[SPECIFIED] Session expires after exactly 15 minutes of inactivity'
        }
      });
    });

    it('5.5 Approves suite once all cases are reviewed and all expected results are SPECIFIED', async () => {
      const suiteReviewRes = await testCaseReviewService.reviewSuite({
        projectId: testProjectId,
        suiteId: testSuiteId,
        userId: testUserId,
        action: 'APPROVED',
        notes: 'Suite signoff complete with all behaviors resolved'
      });

      assert.equal(suiteReviewRes.suite.status, 'APPROVED');

      const suiteInDb = (await pool.query(
        `SELECT status FROM ai_test_suites WHERE id = $1;`,
        [testSuiteId]
      )).rows[0];
      assert.equal(suiteInDb.status, 'APPROVED');
    });

    it('5.6 Deletion of reviewed suite is blocked by deferred foreign key', async () => {
      await assert.rejects(async () => {
        await pool.query('BEGIN;');
        await pool.query(`DELETE FROM ai_test_suites WHERE id = $1;`, [testSuiteId]);
        await pool.query('COMMIT;');
      }, /foreign key/);
      await pool.query('ROLLBACK;').catch(() => {});
    });
  });

  // =========================================================================
  // 6. Proposal Conversion, Lifecycle & Target Deletion Preservation
  // =========================================================================
  describe('6. Proposal Conversion, Lifecycle & Target Deletion Preservation', () => {
    it('6.1 Atomically converts proposal to formal test case', async () => {
      const convRes = await testCaseReviewService.convertProposal({
        projectId: testProjectId,
        suiteId: testSuiteId,
        proposalId: testProposalId,
        userId: testUserId,
        targetScenarioId: testScenarioId
      });

      assert.equal(convRes.success, true);
      assert.ok(convRes.convertedTestCase.id);

      // Verify proposal status in DB
      const propInDb = (await pool.query(
        `SELECT status, converted_test_case_id, converted_test_case_key_snapshot, converted_at FROM ai_test_case_proposals WHERE id = $1;`,
        [testProposalId]
      )).rows[0];

      assert.equal(propInDb.status, 'CONVERTED');
      assert.equal(propInDb.converted_test_case_id, convRes.convertedTestCase.id);
      assert.ok(propInDb.converted_test_case_key_snapshot);
      assert.ok(propInDb.converted_at);
    });

    it('6.2 Rejects duplicate conversion of already-converted proposal', async () => {
      await assert.rejects(async () => {
        await testCaseReviewService.convertProposal({
          projectId: testProjectId,
          suiteId: testSuiteId,
          proposalId: testProposalId,
          userId: testUserId
        });
      }, /ALREADY_CONVERTED/);
    });

    it('6.3 Deleting converted test case safely transitions proposal to TARGET_DELETED with preserved snapshot', async () => {
      const propBefore = (await pool.query(
        `SELECT converted_test_case_id, converted_test_case_key_snapshot, converted_at FROM ai_test_case_proposals WHERE id = $1;`,
        [testProposalId]
      )).rows[0];

      // Delete the test case
      await pool.query(`DELETE FROM ai_test_cases WHERE id = $1;`, [propBefore.converted_test_case_id]);

      const propAfter = (await pool.query(
        `SELECT status, converted_test_case_id, converted_test_case_key_snapshot, converted_at FROM ai_test_case_proposals WHERE id = $1;`,
        [testProposalId]
      )).rows[0];

      assert.equal(propAfter.status, 'TARGET_DELETED');
      assert.equal(propAfter.converted_test_case_id, null);
      assert.equal(propAfter.converted_test_case_key_snapshot, propBefore.converted_test_case_key_snapshot);
      assert.equal(propAfter.converted_at.toISOString(), propBefore.converted_at.toISOString());
    });
  });

  // =========================================================================
  // 7. Shared Inference Lock Exclusivity
  // =========================================================================
  describe('7. Shared Inference Lock Exclusivity', () => {
    it('7.1 Shared lock (8829101, 1) mutually excludes concurrent inference passes', async () => {
      let activeRunners = 0;
      let maxConcurrency = 0;

      const runSimulatedInference = async (label) => {
        return withSharedInferenceLock({
          pool,
          lockTimeoutMs: 30000,
          heartbeatIntervalMs: 500
        }, async () => {
          activeRunners++;
          if (activeRunners > maxConcurrency) maxConcurrency = activeRunners;
          await new Promise(r => setTimeout(r, 100));
          activeRunners--;
          return label;
        });
      };

      const [resA, resB] = await Promise.all([
        runSimulatedInference('Pass A'),
        runSimulatedInference('Pass B')
      ]);

      assert.equal(resA, 'Pass A');
      assert.equal(resB, 'Pass B');
      assert.equal(maxConcurrency, 1); // Strictly serialized
    });
  });
});
