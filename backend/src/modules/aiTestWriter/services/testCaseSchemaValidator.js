const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, strict: false });

const testCaseGenerationSchema = {
  type: 'object',
  required: [
    'suite_title',
    'target_module',
    'summary',
    'scenarios',
    'proposals'
  ],
  additionalProperties: false,
  properties: {
    suite_title: { type: 'string', minLength: 3 },
    target_module: { type: 'string', minLength: 1 },
    summary: { type: 'string', minLength: 5 },
    scenarios: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'scenario_key',
          'title',
          'scenario_type',
          'description',
          'test_cases'
        ],
        additionalProperties: false,
        properties: {
          scenario_key: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          scenario_type: {
            type: 'string',
            enum: [
              'FUNCTIONAL',
              'EDGE_CASE',
              'SECURITY',
              'PERFORMANCE',
              'USABILITY',
              'INTEGRATION',
              'NEGATIVE'
            ]
          },
          description: { type: 'string' },
          test_cases: {
            type: 'array',
            items: {
              type: 'object',
              required: [
                'test_case_key',
                'title',
                'priority',
                'source_classification',
                'preconditions',
                'test_steps',
                'expected_results',
                'evidence_references',
                'traceability_keys'
              ],
              additionalProperties: false,
              properties: {
                test_case_key: { type: 'string', minLength: 1 },
                title: { type: 'string', minLength: 1 },
                priority: {
                  type: 'string',
                  enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
                },
                source_classification: {
                  type: 'string',
                  enum: ['DIRECT_REQUIREMENT', 'GROUNDED_INFERENCE', 'ASSUMPTION']
                },
                preconditions: { type: 'string' },
                test_steps: {
                  type: 'array',
                  items: {
                    anyOf: [
                      { type: 'string' },
                      {
                        type: 'object',
                        properties: {
                          step_number: { type: 'number' },
                          action: { type: 'string' },
                          test_data: { type: 'string' }
                        }
                      }
                    ]
                  }
                },
                expected_results: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['description', 'classification'],
                    additionalProperties: false,
                    properties: {
                      description: { type: 'string', minLength: 1 },
                      classification: {
                        type: 'string',
                        enum: ['SPECIFIED', 'EXPECTED_BEHAVIOR_UNSPECIFIED', 'NEEDS_CLARIFICATION']
                      }
                    }
                  }
                },
                evidence_references: {
                  type: 'array',
                  items: { type: 'string' }
                },
                traceability_keys: {
                  type: 'array',
                  items: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },
    proposals: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'proposal_key',
          'scenario_name',
          'title',
          'description',
          'preconditions',
          'steps',
          'expected_results',
          'priority'
        ],
        additionalProperties: false,
        properties: {
          proposal_key: { type: 'string', minLength: 1 },
          scenario_name: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          preconditions: { type: 'string' },
          steps: {
            type: 'array',
            items: { type: 'string' }
          },
          expected_results: {
            type: 'array',
            items: { type: 'string' }
          },
          priority: {
            type: 'string',
            enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
          }
        }
      }
    }
  }
};

const compiledValidate = ajv.compile(testCaseGenerationSchema);

/**
 * Validates generated test case suite output against Ajv schema.
 */
function validateTestCaseSchema(data) {
  const valid = compiledValidate(data);
  return {
    valid: Boolean(valid),
    errors: compiledValidate.errors || []
  };
}

/**
 * Normalizes minor LLM imperfections (e.g. string expected_results instead of array of objects).
 */
function normalizeTestCaseOutput(raw, fallbackMeta = {}) {
  if (!raw || typeof raw !== 'object') return raw;

  let data = { ...raw };

  // If model wrapped response inside an outer key (e.g. data.test_suite or data.output)
  if (data.test_suite && typeof data.test_suite === 'object') {
    data = { ...data, ...data.test_suite };
    delete data.test_suite;
  }

  // Handle case where LLM returned `test_scenarios` instead of `scenarios`
  if (!Array.isArray(data.scenarios) && Array.isArray(data.test_scenarios)) {
    data.scenarios = data.test_scenarios;
  }
  delete data.test_scenarios;

  // Fill in required root metadata if omitted or too short
  if (!data.suite_title || typeof data.suite_title !== 'string' || data.suite_title.trim().length < 3) {
    data.suite_title = fallbackMeta.suiteTitle || data.title || 'Generated Test Suite';
  }
  if (!data.target_module || typeof data.target_module !== 'string' || data.target_module.trim().length < 1) {
    data.target_module = fallbackMeta.targetModule || data.module || 'Core';
  }
  if (!data.summary || typeof data.summary !== 'string' || data.summary.trim().length < 5) {
    data.summary = data.description || 'Comprehensive test suite generated from active requirements.';
  }

  if (!Array.isArray(data.scenarios)) data.scenarios = [];
  if (!Array.isArray(data.proposals)) data.proposals = [];

  // Remove any extra root properties that violate additionalProperties: false
  const allowedRootKeys = new Set(['suite_title', 'target_module', 'summary', 'scenarios', 'proposals']);
  for (const k of Object.keys(data)) {
    if (!allowedRootKeys.has(k)) {
      delete data[k];
    }
  }

  data.scenarios = data.scenarios.map((sc, scIdx) => {
    const scenario = { ...sc };
    scenario.scenario_key = scenario.scenario_key || `SCEN-${scIdx + 1}`;
    scenario.title = scenario.title || `Scenario ${scIdx + 1}`;
    scenario.scenario_type = (scenario.scenario_type || 'FUNCTIONAL').toUpperCase();
    if (!['FUNCTIONAL', 'EDGE_CASE', 'SECURITY', 'PERFORMANCE', 'USABILITY', 'INTEGRATION', 'NEGATIVE'].includes(scenario.scenario_type)) {
      scenario.scenario_type = 'FUNCTIONAL';
    }
    scenario.description = scenario.description || '';

    if (!Array.isArray(scenario.test_cases)) scenario.test_cases = [];

    const allowedScenarioKeys = new Set(['scenario_key', 'title', 'scenario_type', 'description', 'test_cases']);
    for (const k of Object.keys(scenario)) {
      if (!allowedScenarioKeys.has(k)) {
        delete scenario[k];
      }
    }

    scenario.test_cases = scenario.test_cases.map((tc, tcIdx) => {
      const testCase = { ...tc };
      testCase.test_case_key = testCase.test_case_key || `TC-${scIdx + 1}-${tcIdx + 1}`;
      testCase.title = testCase.title || `Test Case ${tcIdx + 1}`;
      testCase.priority = (testCase.priority || 'MEDIUM').toUpperCase();
      if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(testCase.priority)) {
        testCase.priority = 'MEDIUM';
      }

      testCase.source_classification = (testCase.source_classification || 'DIRECT_REQUIREMENT').toUpperCase();
      if (!['DIRECT_REQUIREMENT', 'GROUNDED_INFERENCE', 'ASSUMPTION'].includes(testCase.source_classification)) {
        testCase.source_classification = 'DIRECT_REQUIREMENT';
      }

      testCase.preconditions = typeof testCase.preconditions === 'string' ? testCase.preconditions : '';

      // Normalize steps
      if (!Array.isArray(testCase.test_steps)) {
        if (typeof testCase.test_steps === 'string') {
          testCase.test_steps = testCase.test_steps.split('\n').filter(Boolean);
        } else {
          testCase.test_steps = [];
        }
      }

      // Normalize expected_results
      if (!Array.isArray(testCase.expected_results)) {
        if (typeof testCase.expected_results === 'string') {
          testCase.expected_results = [{
            description: testCase.expected_results,
            classification: 'SPECIFIED'
          }];
        } else {
          testCase.expected_results = [];
        }
      } else {
        testCase.expected_results = testCase.expected_results.map(exp => {
          if (typeof exp === 'string') {
            return {
              description: exp,
              classification: 'SPECIFIED'
            };
          }
          if (exp && typeof exp === 'object') {
            const classification = (exp.classification || 'SPECIFIED').toUpperCase();
            return {
              description: exp.description || 'System behaves as expected',
              classification: ['SPECIFIED', 'EXPECTED_BEHAVIOR_UNSPECIFIED', 'NEEDS_CLARIFICATION'].includes(classification)
                ? classification
                : 'SPECIFIED'
            };
          }
          return {
            description: String(exp),
            classification: 'SPECIFIED'
          };
        });
      }

      if (!Array.isArray(testCase.evidence_references)) {
        testCase.evidence_references = [];
      }
      if (!Array.isArray(testCase.traceability_keys)) {
        testCase.traceability_keys = [];
      }

      const allowedCaseKeys = new Set(['test_case_key', 'title', 'priority', 'source_classification', 'preconditions', 'test_steps', 'expected_results', 'traceability_keys', 'evidence_references']);
      for (const k of Object.keys(testCase)) {
        if (!allowedCaseKeys.has(k)) {
          delete testCase[k];
        }
      }

      return testCase;
    });

    return scenario;
  });

  data.proposals = data.proposals.map((prop, pIdx) => {
    const proposal = { ...prop };
    proposal.proposal_key = proposal.proposal_key || `PROP-${pIdx + 1}`;
    proposal.scenario_name = proposal.scenario_name || 'General';
    proposal.title = proposal.title || `Test Proposal ${pIdx + 1}`;
    proposal.description = proposal.description || '';
    proposal.preconditions = proposal.preconditions || '';
    if (!Array.isArray(proposal.steps)) {
      proposal.steps = typeof proposal.steps === 'string' ? [proposal.steps] : [];
    }
    if (!Array.isArray(proposal.expected_results)) {
      proposal.expected_results = typeof proposal.expected_results === 'string' ? [proposal.expected_results] : [];
    }
    proposal.priority = (proposal.priority || 'MEDIUM').toUpperCase();
    if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(proposal.priority)) {
      proposal.priority = 'MEDIUM';
    }

    const allowedProposalKeys = new Set(['proposal_key', 'scenario_name', 'title', 'description', 'preconditions', 'steps', 'expected_results', 'priority']);
    for (const k of Object.keys(proposal)) {
      if (!allowedProposalKeys.has(k)) {
        delete proposal[k];
      }
    }

    return proposal;
  });

  return data;
}

module.exports = {
  validateTestCaseSchema,
  normalizeTestCaseOutput
};
