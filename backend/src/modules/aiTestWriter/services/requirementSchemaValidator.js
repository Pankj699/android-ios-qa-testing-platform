const Ajv = require('ajv');

const ajv = new Ajv({ allErrors: true, strict: false });

const requirementAnalysisSchema = {
  type: 'object',
  required: [
    'summary',
    'features_and_modules',
    'functional_requirements',
    'non_functional_requirements',
    'user_workflows',
    'api_dependencies',
    'gap_analysis'
  ],
  additionalProperties: false,
  properties: {
    summary: { type: 'string', minLength: 10 },
    features_and_modules: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'description', 'impacted_existing_modules'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          impacted_existing_modules: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    functional_requirements: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'req_key',
          'title',
          'description',
          'classification',
          'priority',
          'business_rules',
          'validations',
          'dependencies',
          'acceptance_criteria',
          'evidence_keys'
        ],
        additionalProperties: false,
        properties: {
          req_key: { type: 'string' },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', minLength: 1 },
          classification: { type: 'string', enum: ['DIRECT', 'GROUNDED_INFERENCE', 'ASSUMPTION'] },
          priority: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
          business_rules: { type: 'array', items: { type: 'string' } },
          validations: { type: 'array', items: { type: 'string' } },
          dependencies: { type: 'array', items: { type: 'string' } },
          acceptance_criteria: { type: 'array', items: { type: 'string' } },
          evidence_keys: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    non_functional_requirements: {
      type: 'array',
      items: {
        type: 'object',
        required: ['req_key', 'title', 'description', 'category', 'acceptance_criteria', 'evidence_keys'],
        additionalProperties: false,
        properties: {
          req_key: { type: 'string' },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string' },
          category: { type: 'string', enum: ['PERFORMANCE', 'SECURITY', 'RELIABILITY', 'COMPLIANCE'] },
          acceptance_criteria: { type: 'array', items: { type: 'string' } },
          evidence_keys: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    user_workflows: {
      type: 'array',
      items: {
        type: 'object',
        required: ['workflow_name', 'actor', 'steps', 'evidence_keys'],
        additionalProperties: false,
        properties: {
          workflow_name: { type: 'string', minLength: 1 },
          actor: { type: 'string' },
          steps: { type: 'array', items: { type: 'string' } },
          evidence_keys: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    api_dependencies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['service_name', 'endpoint', 'interaction_type', 'evidence_keys'],
        additionalProperties: false,
        properties: {
          service_name: { type: 'string', minLength: 1 },
          endpoint: { type: 'string' },
          interaction_type: { type: 'string' },
          evidence_keys: { type: 'array', items: { type: 'string' } }
        }
      }
    },
    gap_analysis: {
      type: 'object',
      required: [
        'missing_requirements',
        'ambiguities',
        'conflicting_information',
        'unsupported_assumptions',
        'open_questions'
      ],
      additionalProperties: false,
      properties: {
        missing_requirements: { type: 'array', items: { type: 'string' } },
        ambiguities: { type: 'array', items: { type: 'string' } },
        conflicting_information: {
          type: 'array',
          items: {
            type: 'object',
            required: ['topic', 'task_statement', 'kb_evidence', 'conflict_summary', 'evidence_keys'],
            additionalProperties: false,
            properties: {
              topic: { type: 'string' },
              task_statement: { type: 'string' },
              kb_evidence: { type: 'string' },
              conflict_summary: { type: 'string' },
              evidence_keys: { type: 'array', items: { type: 'string' } }
            }
          }
        },
        unsupported_assumptions: { type: 'array', items: { type: 'string' } },
        open_questions: { type: 'array', items: { type: 'string' } }
      }
    }
  }
};

const validateRequirementAnalysisJson = ajv.compile(requirementAnalysisSchema);

/**
 * Validates parsed model JSON against Ajv schema.
 * Returns { valid: boolean, errors: Array }
 */
function validateSchema(data) {
  const valid = validateRequirementAnalysisJson(data);
  return {
    valid: !!valid,
    errors: validateRequirementAnalysisJson.errors || []
  };
}

/**
 * Four-tier Automated Evidence Screening:
 * Screens model-provided citations against actual retrieved evidence map.
 * Enforces strict downgrade to ASSUMPTION on ambiguity or missing support.
 *
 * @param {Object} req - A single functional or non-functional requirement
 * @param {Map<string, Object>} evidenceMap - Map of 'E-1' => chunk object
 * @returns {Object} screened requirement with enriched citations and review flags
 */
function screenRequirementEvidence(req, evidenceMap) {
  const result = {
    ...req,
    originalClassification: req.classification,
    screeningFlags: [],
    citations: []
  };

  const citedKeys = Array.isArray(req.evidence_keys) ? req.evidence_keys : [];

  // Outcome 3: Unsupported inference if model claims GROUNDED_INFERENCE with no keys
  if (req.classification === 'GROUNDED_INFERENCE' && citedKeys.length === 0) {
    result.classification = 'ASSUMPTION';
    result.screeningFlags.push('DOWNGRADED_UNSUPPORTED_INFERENCE: Model asserted grounded inference without citing evidence keys.');
    result.citations.push({
      evidenceKey: 'NONE',
      chunkId: null,
      evidenceStatus: 'UNSUPPORTED_CITATION',
      note: 'Model asserted grounded inference without citing evidence keys.'
    });
    return result;
  }

  let hasPlausibleSupport = false;
  let hasTopicalEvidence = false;

  for (const key of citedKeys) {
    const chunk = evidenceMap.get(key);

    // Outcome 4: Invalid key
    if (!chunk) {
      result.screeningFlags.push(`STRIPPED_INVALID_KEY: Evidence key '${key}' does not exist in retrieved evidence set.`);
      result.citations.push({
        evidenceKey: key,
        chunkId: null,
        evidenceStatus: 'INVALID_EVIDENCE_KEY',
        note: `Evidence key '${key}' does not exist in retrieved evidence set.`
      });
      continue;
    }

    const reqText = `${req.title || ''} ${req.description || ''} ${(req.business_rules || []).join(' ')} ${(req.validations || []).join(' ')}`.toLowerCase();
    const chunkText = (chunk.content || '').toLowerCase();

    // 1. Technical identifier extraction (error codes, endpoints, protocols, params, tokens)
    const technicalEntities = (reqText.match(/oauth2?|jwt|token[s]?|api|http|rest|grpc|cors|csrf|cookie|session|[a-z0-9_-]+:[0-9]+|[a-z0-9_-]+_[a-z0-9_-]+|[a-z]+-[a-z0-9-]+|\b[0-9]{3,4}\b|\b[a-z0-9]+secret\b/gi) || [])
      .map(e => e.toLowerCase());

    const entityMatches = technicalEntities.filter(e => chunkText.includes(e));

    // 2. Specific assertion checks (numbers, times, parameters, algorithms)
    const assertions = (reqText.match(/\b\d+\s*(?:seconds|sec|minutes|min|hours|bytes|bits|days|ms)?\b|\b(?:sha-256|sha256|rs256|hs256|es256|s256|hmac|jwt|pkce|bearer|tls|ssl|aes|2fa|mfa)\b/gi) || [])
      .map(a => a.toLowerCase());

    const assertionMatches = assertions.filter(a => chunkText.includes(a));

    if (entityMatches.length > 0 && assertionMatches.length > 0) {
      // Outcome 1: Plausible Grounding
      hasPlausibleSupport = true;
      result.citations.push({
        evidenceKey: key,
        chunkId: chunk.chunkId || chunk.id,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        versionNumber: chunk.versionNumber,
        documentType: chunk.documentType,
        sourceLocationDisplay: chunk.sourceLocationDisplay,
        evidenceStatus: 'PLAUSIBLE_SUPPORT',
        matchedEntities: entityMatches,
        matchedAssertions: assertionMatches,
        snippet: (chunk.content || '').slice(0, 300)
      });
    } else if (entityMatches.length > 0 || (req.title && chunkText.includes(req.title.toLowerCase().split(' ')[0]))) {
      // Outcome 2: Topical / Ambiguous Evidence
      hasTopicalEvidence = true;
      result.citations.push({
        evidenceKey: key,
        chunkId: chunk.chunkId || chunk.id,
        documentId: chunk.documentId,
        documentTitle: chunk.documentTitle,
        versionNumber: chunk.versionNumber,
        documentType: chunk.documentType,
        sourceLocationDisplay: chunk.sourceLocationDisplay,
        evidenceStatus: 'TOPICAL_AMBIGUOUS',
        note: 'Cited chunk is topically related, but lacks explicit statement of asserted constraint.',
        snippet: (chunk.content || '').slice(0, 300)
      });
    } else {
      // Outcome 3: Irrelevant Evidence
      result.screeningFlags.push(`REJECTED_CITATION: Chunk '${key}' has no substantive entity or assertion overlap.`);
      result.citations.push({
        evidenceKey: key,
        chunkId: chunk.chunkId || chunk.id,
        evidenceStatus: 'UNSUPPORTED_CITATION',
        note: `Chunk '${key}' has no substantive entity or assertion overlap.`,
        snippet: (chunk.content || '').slice(0, 300)
      });
    }
  }

  // Downgrade rules: Never promote on failure. Any ambiguity or missing support defaults downward to ASSUMPTION
  if (req.classification === 'GROUNDED_INFERENCE') {
    if (hasPlausibleSupport) {
      result.classification = 'GROUNDED_INFERENCE';
    } else if (hasTopicalEvidence) {
      result.classification = 'ASSUMPTION';
      result.screeningFlags.push('FLAGGED_FOR_HUMAN_REVIEW: Cited evidence is topical only. Downgraded to ASSUMPTION.');
    } else {
      result.classification = 'ASSUMPTION';
      result.screeningFlags.push('DOWNGRADED_UNSUPPORTED_INFERENCE: No verified supporting evidence found in citations.');
    }
  }

  return result;
}

module.exports = {
  validateSchema,
  screenRequirementEvidence,
  requirementAnalysisSchema
};
