const crypto = require('crypto');
const db = require('../db/connection');
const llmService = require('./llmService');
const retrievalService = require('./retrievalService');
const { validateSchema, screenRequirementEvidence } = require('./requirementSchemaValidator');
const { withSharedInferenceLock, ADVISORY_CLASS_HASH, ADVISORY_OBJ_ID } = require('./sharedInferenceLock');

// Parsers from Phase 2.4
const pdfParser = require('./parsers/pdfParser');
const docxParser = require('./parsers/docxParser');
const xlsxParser = require('./parsers/xlsxParser');
const csvParser = require('./parsers/csvParser');
const txtParser = require('./parsers/txtParser');
const HEARTBEAT_INTERVAL_MS = 5000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB limit for task attachments

// Concurrency mutex for attachment parsing to prevent memory spikes
let parserMutex = Promise.resolve();

function getWorkerId() {
  return `worker_${process.pid}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Parses task attachment ephemerally using Phase 2.4 parsers.
 * Enforces strict memory release and timeout protection.
 */
async function parseTaskAttachment(fileBuffer, originalFilename, mimeType) {
  if (!fileBuffer || fileBuffer.length === 0) {
    return { text: '', units: [], metadata: { sizeBytes: 0, filename: originalFilename } };
  }

  if (fileBuffer.length > MAX_ATTACHMENT_BYTES) {
    const err = new Error(`Task attachment size (${fileBuffer.length} bytes) exceeds 10 MB limit.`);
    err.code = 'LIMIT_FILE_SIZE';
    err.status = 400;
    throw err;
  }

  const ext = (originalFilename.split('.').pop() || '').toLowerCase();
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // Serialize parsing to avoid concurrent decompression inflating heap memory
  const previous = parserMutex;
  let releaseMutex;
  parserMutex = new Promise(resolve => { releaseMutex = resolve; });

  try {
    await previous.catch(() => {});

    let parsedResult;
    const timeoutMs = 30000; // 30s timeout

    if (ext === 'pdf') {
      parsedResult = await pdfParser.parsePdf(fileBuffer, originalFilename, { timeoutMs, maxBytes: MAX_ATTACHMENT_BYTES });
    } else if (ext === 'docx') {
      parsedResult = await docxParser.parseDocx(fileBuffer, originalFilename, { timeoutMs, maxBytes: MAX_ATTACHMENT_BYTES });
    } else if (ext === 'xlsx') {
      parsedResult = await xlsxParser.parseXlsx(fileBuffer, originalFilename, { timeoutMs, maxBytes: MAX_ATTACHMENT_BYTES });
    } else if (ext === 'csv') {
      parsedResult = await csvParser.parseCsv(fileBuffer, originalFilename, { timeoutMs, maxBytes: MAX_ATTACHMENT_BYTES });
    } else if (ext === 'txt') {
      parsedResult = await txtParser.parseTxt(fileBuffer, originalFilename, { timeoutMs, maxBytes: MAX_ATTACHMENT_BYTES });
    } else {
      const err = new Error(`Unsupported attachment extension: .${ext}`);
      err.code = 'UNSUPPORTED_FILE_TYPE';
      err.status = 400;
      throw err;
    }

    const units = parsedResult.units || [];
    const combinedText = units.map(u => u.extracted_text || u.extractedText || u.text || '').join('\n\n');

    return {
      text: combinedText,
      unitsCount: units.length,
      metadata: {
        filename: originalFilename,
        extension: ext,
        sizeBytes: fileBuffer.length,
        sha256,
        unitsCount: units.length,
        warnings: parsedResult.warnings || []
      }
    };
  } finally {
    releaseMutex();
  }
}

/**
 * Computes deterministic project-scoped idempotency key.
 */
function computeIdempotencyKey(projectId, ticketId, title, description, attachmentSha256 = '') {
  const hash = crypto.createHash('sha256')
    .update([
      ticketId || '',
      (title || '').trim().toLowerCase(),
      (description || '').trim().toLowerCase(),
      attachmentSha256 || ''
    ].join('|'))
    .digest('hex');
  return `req_analyze:${projectId}:${hash}`;
}

function toArrayOfStrings(val) {
  if (Array.isArray(val)) {
    return val.map(v => typeof v === 'string' ? v : (v !== null && v !== undefined ? String(v) : '')).filter(Boolean);
  }
  if (typeof val === 'string' && val.trim().length > 0) {
    return [val.trim()];
  }
  return [];
}

/**
 * Defensively normalizes LLM JSON output to conform to schema array expectations
 * before strict Ajv validation. Coerces single strings or nulls to string arrays.
 */
function normalizeAnalysisOutput(raw) {
  if (!raw || typeof raw !== 'object') return raw;

  if (Array.isArray(raw.features_and_modules)) {
    raw.features_and_modules.forEach(f => {
      if (f && typeof f === 'object') {
        f.impacted_existing_modules = toArrayOfStrings(f.impacted_existing_modules);
      }
    });
  }

  if (Array.isArray(raw.functional_requirements)) {
    raw.functional_requirements.forEach(r => {
      if (r && typeof r === 'object') {
        r.business_rules = toArrayOfStrings(r.business_rules);
        r.validations = toArrayOfStrings(r.validations);
        r.dependencies = toArrayOfStrings(r.dependencies);
        r.acceptance_criteria = toArrayOfStrings(r.acceptance_criteria);
        r.evidence_keys = toArrayOfStrings(r.evidence_keys);
      }
    });
  }

  if (Array.isArray(raw.non_functional_requirements)) {
    raw.non_functional_requirements.forEach(r => {
      if (r && typeof r === 'object') {
        r.acceptance_criteria = toArrayOfStrings(r.acceptance_criteria);
        r.evidence_keys = toArrayOfStrings(r.evidence_keys);
      }
    });
  }

  if (Array.isArray(raw.user_workflows)) {
    raw.user_workflows.forEach(w => {
      if (w && typeof w === 'object') {
        w.steps = toArrayOfStrings(w.steps);
        w.evidence_keys = toArrayOfStrings(w.evidence_keys);
      }
    });
  }

  if (Array.isArray(raw.api_dependencies)) {
    raw.api_dependencies.forEach(a => {
      if (a && typeof a === 'object') {
        a.evidence_keys = toArrayOfStrings(a.evidence_keys);
      }
    });
  }

  if (raw.gap_analysis && typeof raw.gap_analysis === 'object') {
    raw.gap_analysis.missing_requirements = toArrayOfStrings(raw.gap_analysis.missing_requirements);
    raw.gap_analysis.ambiguities = toArrayOfStrings(raw.gap_analysis.ambiguities);
    raw.gap_analysis.unsupported_assumptions = toArrayOfStrings(raw.gap_analysis.unsupported_assumptions);
    raw.gap_analysis.open_questions = toArrayOfStrings(raw.gap_analysis.open_questions);
    if (Array.isArray(raw.gap_analysis.conflicting_information)) {
      raw.gap_analysis.conflicting_information.forEach(c => {
        if (c && typeof c === 'object') {
          c.evidence_keys = toArrayOfStrings(c.evidence_keys);
        }
      });
    } else {
      raw.gap_analysis.conflicting_information = [];
    }
  }

  return raw;
}

/**
 * Submits an asynchronous requirement analysis job.
 * Returns HTTP 202 Accepted status with job ID.
 */
async function submitAnalysisJob({
  projectId,
  userId,
  ticketId = '',
  title,
  description = '',
  rawText = '',
  file = null,
  saveAttachmentToKb = false,
  retrievalMode = 'HYBRID',
  candidateLimit = 10,
  idempotencyKey = null,
  autoStart = true
}) {
  if (!projectId) {
    const err = new Error('Project ID is required.');
    err.status = 400;
    throw err;
  }
  if (!title || title.trim().length === 0) {
    const err = new Error('Task title is required.');
    err.status = 400;
    throw err;
  }

  // Handle attachment preparation
  let attachmentMeta = null;
  let attachmentParsedText = '';
  let attachmentSha256 = '';

  if (file && file.buffer) {
    const parsed = await parseTaskAttachment(file.buffer, file.originalname, file.mimetype);
    attachmentMeta = parsed.metadata;
    attachmentParsedText = parsed.text;
    attachmentSha256 = parsed.metadata.sha256;
  }

  // Determine idempotency key
  const finalIdempotencyKey = idempotencyKey || computeIdempotencyKey(projectId, ticketId, title, description + '\n' + rawText, attachmentSha256);

  // Check existing job under idempotency key
  const existingJobRes = await db.query(`
    SELECT id, status, current_stage, progress_percent, result_reference, error_message
    FROM ai_generation_jobs
    WHERE project_id = $1 AND idempotency_key = $2
    ORDER BY created_at DESC
    LIMIT 1;
  `, [projectId, finalIdempotencyKey]);

  if (existingJobRes.rows.length > 0) {
    const existing = existingJobRes.rows[0];
    if (existing.status === 'COMPLETED') {
      return {
        jobId: existing.id,
        status: 'COMPLETED',
        currentStage: 'COMPLETED',
        progressPercent: 100,
        resultReference: existing.result_reference,
        isExisting: true
      };
    }
    if (existing.status === 'PENDING' || existing.status === 'PROCESSING') {
      return {
        jobId: existing.id,
        status: existing.status,
        currentStage: existing.current_stage,
        progressPercent: existing.progress_percent,
        isExisting: true
      };
    }
    // If previous job was FAILED, we fall through to create a new retry job
  }

  const jobId = crypto.randomUUID();
  const rawInputType = file ? 'WITH_ATTACHMENT' : (ticketId && rawText ? 'HYBRID_TEXT_TICKET' : (ticketId ? 'TICKET_ONLY' : 'TEXT_ONLY'));

  const payload = {
    ticketId,
    title,
    description,
    rawText,
    attachmentParsedText,
    attachmentMeta,
    saveAttachmentToKb: !!saveAttachmentToKb,
    retrievalMode,
    candidateLimit,
    rawInputType
  };

  try {
    await db.query(`
      INSERT INTO ai_generation_jobs (
        id, project_id, user_id, job_type, status, idempotency_key,
        current_stage, progress_percent, payload, max_retries, retry_count
      ) VALUES ($1, $2, $3, 'ANALYZE_REQUIREMENTS', 'PENDING', $4, 'QUEUED', 0, $5, 2, 0);
    `, [jobId, projectId, userId, finalIdempotencyKey, JSON.stringify(payload)]);
  } catch (insertErr) {
    if (insertErr.code === '23505') {
      // Race condition hit: another request inserted identical job simultaneously
      const racedRes = await db.query(`
        SELECT id, status, current_stage, progress_percent, result_reference
        FROM ai_generation_jobs
        WHERE project_id = $1 AND idempotency_key = $2
        LIMIT 1;
      `, [projectId, finalIdempotencyKey]);
      if (racedRes.rows[0]) {
        return {
          jobId: racedRes.rows[0].id,
          status: racedRes.rows[0].status,
          currentStage: racedRes.rows[0].current_stage,
          progressPercent: racedRes.rows[0].progress_percent,
          resultReference: racedRes.rows[0].result_reference,
          isExisting: true
        };
      }
    }
    throw insertErr;
  }

  // Trigger worker asynchronously
  if (autoStart) {
    setImmediate(() => {
      executeWorkerPass(jobId).catch(err => {
        console.error(`[RequirementAnalysisWorker] Unhandled job failure for ${jobId}:`, err);
      });
    });
  }

  return {
    jobId,
    status: 'PENDING',
    currentStage: 'QUEUED',
    progressPercent: 0,
    isExisting: false
  };
}

/**
 * Worker execution entrypoint with atomic claiming, lease fencing, and error capture.
 */
async function executeWorkerPass(jobId) {
  const workerId = getWorkerId();
  const client = await db.getClient();

  let claimToken = null;
  let version = null;
  let heartbeatTimer = null;
  let advisoryLockAcquired = false;

  try {
    // 1. Atomic Job Claim
    const claimRes = await client.query(`
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
      RETURNING id, project_id, user_id, claim_token, version, payload, created_at, started_at;
    `, [jobId, workerId]);

    if (!claimRes.rows || claimRes.rows.length === 0) {
      // Job already claimed or completed by another worker
      return;
    }

    const job = claimRes.rows[0];
    const workerClaimedAt = Date.now();
    const queueWaitMs = job.created_at ? Math.max(0, workerClaimedAt - new Date(job.created_at).getTime()) : 0;
    claimToken = job.claim_token;
    version = job.version;
    const projectId = job.project_id;
    const userId = job.user_id;
    const payload = job.payload || {};

    // Diagnostics container tracking all pipeline stages
    const diagnostics = {
      timings: {
        jobSubmittedAt: job.created_at,
        workerClaimedAt: new Date(workerClaimedAt).toISOString(),
        queueWaitMs,
        stage1AttachmentParsingMs: 0,
        stage2RetrievalMs: 0,
        stage3LockWaitMs: 0,
        stage3LockHoldingMs: 0,
        stage3PromptBuildMs: 0,
        stage3OllamaTimeToFirstTokenMs: 0,
        stage3OllamaGenerationDurationMs: 0,
        stage3OllamaTotalMs: 0,
        stage4SchemaValidationMs: 0,
        stage5PersistenceMs: 0,
        totalJobDurationMs: 0
      },
      retrieval: {
        query: payload.title || '',
        mode: payload.retrievalMode || 'HYBRID',
        rawCandidatesFound: 0,
        filteredCandidatesCount: 0,
        selectedChunksCount: 0,
        selectedEvidenceChars: 0,
        estimatedEvidenceTokens: 0,
        embeddingLatencyMs: 0,
        dbLatencyMs: 0,
        groundingMode: 'GROUNDED'
      },
      prompt: {
        taskTextChars: 0,
        evidenceBlockChars: 0,
        systemPromptChars: 0,
        userPromptChars: 0,
        totalPromptChars: 0,
        estimatedPromptTokens: 0
      },
      ollama: {
        model: null,
        promptTokens: 0,
        completionTokens: 0,
        tokensPerSecond: 0,
        timeToFirstTokenMs: 0,
        generationDurationMs: 0,
        totalRequestMs: 0
      },
      schemaValidation: {
        valid: true,
        errors: [],
        retryPassNeeded: false,
        functionalReqsCount: 0,
        nonFunctionalReqsCount: 0
      }
    };

    // 2. Start Active Heartbeat Loop
    let workerFenced = false;
    heartbeatTimer = setInterval(async () => {
      try {
        const hbRes = await db.query(`
          UPDATE ai_generation_jobs
          SET last_heartbeat_at = clock_timestamp(),
              lease_expires_at = clock_timestamp() + INTERVAL '2 minutes',
              updated_at = clock_timestamp()
          WHERE id = $1
            AND claim_token = $2
            AND version = $3
            AND status = 'PROCESSING'
          RETURNING id;
        `, [jobId, claimToken, version]);

        if (hbRes.rowCount === 0) {
          workerFenced = true;
          clearInterval(heartbeatTimer);
        }
      } catch (_) {}
    }, HEARTBEAT_INTERVAL_MS);
    if (heartbeatTimer && heartbeatTimer.unref) heartbeatTimer.unref();

    // Helper to update stage with fencing check
    const updateStage = async (stage, progress) => {
      if (workerFenced) throw new Error('FENCING_ERROR: Worker lost job ownership.');
      const uRes = await client.query(`
        UPDATE ai_generation_jobs
        SET current_stage = $1,
            progress_percent = $2,
            last_heartbeat_at = clock_timestamp(),
            lease_expires_at = clock_timestamp() + INTERVAL '2 minutes',
            updated_at = clock_timestamp()
        WHERE id = $3
          AND claim_token = $4
          AND version = $5
          AND status = 'PROCESSING'
        RETURNING id;
      `, [stage, progress, jobId, claimToken, version]);
      if (uRes.rowCount === 0) {
        workerFenced = true;
        throw new Error('FENCING_ERROR: Worker lease expired or job reclaimed.');
      }
    };

    // -------------------------------------------------------------------------
    // STAGE 1: PARSING ATTACHMENT / NORMALIZATION (15%)
    // -------------------------------------------------------------------------
    const tStage1Start = Date.now();
    await updateStage('PARSING_ATTACHMENT', 15);

    // Context budget protection on user task inputs (prevent multi-MB prompt blowout)
    const MAX_TASK_PART_CHARS = 1800;
    const truncatedAttachmentText = payload.attachmentParsedText
      ? (payload.attachmentParsedText.length > MAX_TASK_PART_CHARS
          ? payload.attachmentParsedText.slice(0, MAX_TASK_PART_CHARS) + '\n... [Attachment content truncated for context budget]'
          : payload.attachmentParsedText)
      : '';
    const truncatedRawText = payload.rawText
      ? (payload.rawText.length > MAX_TASK_PART_CHARS
          ? payload.rawText.slice(0, MAX_TASK_PART_CHARS) + '\n... [Pasted requirements truncated for context budget]'
          : payload.rawText)
      : '';

    const combinedTaskText = [
      payload.title ? `Title: ${payload.title}` : '',
      payload.ticketId ? `Ticket ID: ${payload.ticketId}` : '',
      payload.description ? `Description:\n${payload.description}` : '',
      truncatedRawText ? `Pasted Requirements:\n${truncatedRawText}` : '',
      truncatedAttachmentText ? `Attachment Content (${payload.attachmentMeta?.filename || 'File'}):\n${truncatedAttachmentText}` : ''
    ].filter(Boolean).join('\n\n');

    diagnostics.timings.stage1AttachmentParsingMs = Date.now() - tStage1Start;
    diagnostics.prompt.taskTextChars = combinedTaskText.length;

    // -------------------------------------------------------------------------
    // STAGE 2: RETRIEVING KNOWLEDGE BASE EVIDENCE (35%)
    // -------------------------------------------------------------------------
    const tStage2Start = Date.now();
    await updateStage('RETRIEVING_KNOWLEDGE', 35);

    // Multi-query formulation
    const titleQuery = payload.title || '';
    const technicalEntities = (combinedTaskText.match(/[a-z0-9_-]+:[0-9]+|[a-z0-9_-]+_[a-z0-9_-]+|[a-z]+-[a-z0-9-]+|\b[0-9]{3,4}\b/gi) || [])
      .slice(0, 5)
      .join(' ');

    let candidateChunks = [];
    let groundingMode = 'GROUNDED';
    let retrievalDiag = {};

    try {
      // Query A: Title hybrid search
      const resA = await retrievalService.hybridSearch({
        projectId,
        query: titleQuery,
        mode: payload.retrievalMode || 'HYBRID',
        limit: 10,
        candidateLimit: 50,
        fallbackOnSemanticFailure: true
      });

      retrievalDiag = resA.diagnostics || {};
      candidateChunks = [...(resA.results || [])];

      // Query B: Technical identifier search if present
      if (technicalEntities && technicalEntities.trim().length > 0) {
        const resB = await retrievalService.hybridSearch({
          projectId,
          query: technicalEntities,
          mode: 'KEYWORD',
          limit: 5,
          candidateLimit: 20
        });
        candidateChunks.push(...(resB.results || []));
      }

      // Deduplicate by chunkId
      const chunkMap = new Map();
      for (const c of candidateChunks) {
        if (!chunkMap.has(c.chunkId)) {
          chunkMap.set(c.chunkId, c);
        }
      }
      const allUniqueCandidates = Array.from(chunkMap.values());
      diagnostics.retrieval.rawCandidatesFound = allUniqueCandidates.length;

      // Relevance filtering: filter out noise chunks
      // Criteria:
      // 1. Semantic similarity >= 0.58 (strong semantic match, captures directly relevant specs)
      // 2. OR (semantic similarity >= 0.52 AND high-confidence keyword match in content)
      // 3. OR (pure keyword fallback when embeddings are absent: kwScore >= 0.05 AND rank <= 3)
      const MIN_SEMANTIC_THRESHOLD = 0.58;
      const MIN_BORDERLINE_SEMANTIC = 0.52;
      const filteredChunks = allUniqueCandidates.filter(c => {
        const sim = c.scores?.semantic?.similarity ?? 0;
        const kwScore = c.scores?.keyword?.score ?? 0;
        const kwRank = c.scores?.keyword?.rank ?? 999;
        const isSemanticCandidate = c.scores?.semantic !== null && c.scores?.semantic !== undefined;

        if (isSemanticCandidate) {
          if (sim >= MIN_SEMANTIC_THRESHOLD) return true;
          if (sim >= MIN_BORDERLINE_SEMANTIC && (kwScore >= 0.05 || kwRank <= 3)) {
            return true;
          }
          return false;
        }

        // Pure keyword fallback (e.g. embeddings disabled or degraded)
        return kwScore >= 0.05 && kwRank <= 3;
      });
      diagnostics.retrieval.filteredCandidatesCount = filteredChunks.length;

      // Sort filtered candidates: highest RRF score and semantic similarity first
      filteredChunks.sort((a, b) => {
        const rrfDiff = (b.scores?.rrfScore ?? 0) - (a.scores?.rrfScore ?? 0);
        if (Math.abs(rrfDiff) > 0.0001) return rrfDiff;
        return (b.scores?.semantic?.similarity ?? 0) - (a.scores?.semantic?.similarity ?? 0);
      });

      // Strict evidence character & chunk budgeting for CPU inference
      // Top 3 chunks, capped at 2000 total characters (~500 tokens)
      const MAX_EVIDENCE_CHUNKS = 3;
      const MAX_EVIDENCE_CHARS = 2000;

      let currentEvidenceChars = 0;
      const budgetedChunks = [];

      for (const c of filteredChunks) {
        if (budgetedChunks.length >= MAX_EVIDENCE_CHUNKS) break;
        const snippet = (c.content || '').trim();
        if (currentEvidenceChars + snippet.length > MAX_EVIDENCE_CHARS) {
          const remainingBudget = MAX_EVIDENCE_CHARS - currentEvidenceChars;
          if (remainingBudget >= 250) {
            const truncated = snippet.slice(0, remainingBudget) + '... [truncated for context budget]';
            budgetedChunks.push({ ...c, content: truncated });
            currentEvidenceChars += truncated.length;
          }
          break;
        }
        budgetedChunks.push(c);
        currentEvidenceChars += snippet.length;
      }

      candidateChunks = budgetedChunks;

      if (candidateChunks.length === 0) {
        groundingMode = 'UNGROUNDED_NO_KB';
      }
    } catch (retrievalErr) {
      console.warn(`[RequirementAnalysisWorker] Knowledge retrieval degraded for job ${jobId}:`, retrievalErr.message);
      groundingMode = 'UNGROUNDED_NO_KB';
      candidateChunks = [];
    }

    // Build evidence map [E-1]...[E-N]
    const evidenceMap = new Map();
    const evidenceSnippets = [];

    candidateChunks.forEach((c, idx) => {
      const key = `E-${idx + 1}`;
      evidenceMap.set(key, c);
      evidenceSnippets.push(`[${key}] (Doc: "${c.provenance?.documentTitle || 'Document'}", ${c.provenance?.sourceLocationDisplay || 'Chunk'})\n"${c.content}"`);
    });

    const evidenceBlock = evidenceSnippets.length > 0 
      ? evidenceSnippets.join('\n\n')
      : '[No relevant documents found in Project Knowledge Base. Analyze task input directly.]';

    diagnostics.timings.stage2RetrievalMs = Date.now() - tStage2Start;
    diagnostics.retrieval.selectedChunksCount = candidateChunks.length;
    diagnostics.retrieval.selectedEvidenceChars = evidenceSnippets.reduce((sum, s) => sum + s.length, 0);
    diagnostics.retrieval.estimatedEvidenceTokens = Math.ceil(diagnostics.retrieval.selectedEvidenceChars / 4);
    diagnostics.retrieval.embeddingLatencyMs = retrievalDiag.embeddingLatencyMs || 0;
    diagnostics.retrieval.dbLatencyMs = retrievalDiag.dbLatencyMs || 0;
    diagnostics.retrieval.groundingMode = groundingMode;
    diagnostics.prompt.evidenceBlockChars = evidenceBlock.length;

    // -------------------------------------------------------------------------
    // STAGE 3: GENERATING ANALYSIS WITH OLLAMA CONCURRENCY LOCK (65%)
    // -------------------------------------------------------------------------
    const tStage3Start = Date.now();

    // Mark stage as queued for lock so frontend progress banner accurately informs user
    await updateStage('QUEUED_FOR_INFERENCE', 45);

    // Build Prompt with conciseness directive
    const systemPrompt = `You are a Principal Software QA & Requirements Architect.
Analyze the development task input against the retrieved Project Knowledge Base Evidence.

Output strict JSON conforming to this specification:
- summary: Executive summary of scope and objective (min 10 chars).
- features_and_modules: Array of { name: string, description: string, impacted_existing_modules: string[] }.
- functional_requirements: Array of { req_key: string, title: string, description: string, classification: "DIRECT" | "GROUNDED_INFERENCE" | "ASSUMPTION", priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL", business_rules: string[], validations: string[], dependencies: string[], acceptance_criteria: string[], evidence_keys: string[] }.
- non_functional_requirements: Array of { req_key: string, title: string, description: string, category: "PERFORMANCE" | "SECURITY" | "RELIABILITY" | "COMPLIANCE", acceptance_criteria: string[], evidence_keys: string[] }.
- user_workflows: Array of { workflow_name: string, actor: string, steps: string[], evidence_keys: string[] }.
- api_dependencies: Array of { service_name: string, endpoint: string, interaction_type: string, evidence_keys: string[] }.
- gap_analysis: { missing_requirements: string[], ambiguities: string[], conflicting_information: [{ topic: string, task_statement: string, kb_evidence: string, conflict_summary: string, evidence_keys: string[] }], unsupported_assumptions: string[], open_questions: string[] }.

Rules:
1. Every requirement must be classified as DIRECT (explicitly stated in task), GROUNDED_INFERENCE (inferred from evidence), or ASSUMPTION.
2. Every list field (e.g. business_rules, acceptance_criteria, validations, dependencies, evidence_keys) MUST be an array of strings, e.g. ["item 1"], NEVER a plain string or null.
3. In evidence_keys, you may ONLY cite keys from the provided Evidence block (e.g. ["E-1"]). Never invent keys.
4. If no project evidence exists, do NOT create GROUNDED_INFERENCE requirements; classify them as DIRECT or ASSUMPTION.
5. CONCISENESS & SCOPE DIRECTIVE:
- Generate exactly 2 to 3 essential functional requirements and 1 non-functional requirement strictly scoped to the task.
- Keep each description to 1-2 concise sentences.
- Limit business_rules to 1-2 items per requirement.
- Limit acceptance_criteria to 1-2 bullet strings per requirement.
- Generate 1 user_workflow with 3-4 concise steps.
- Provide empty arrays [] for api_dependencies, missing_requirements, ambiguities, conflicting_information, unsupported_assumptions, and open_questions unless explicitly evidenced in the inputs.`;

    const userPrompt = `=== RETRIEVED PROJECT KNOWLEDGE BASE EVIDENCE ===
${evidenceBlock}

=== DEVELOPMENT TASK INPUT ===
${combinedTaskText}

Generate the complete JSON requirement analysis.`;

    diagnostics.prompt.systemPromptChars = systemPrompt.length;
    diagnostics.prompt.userPromptChars = userPrompt.length;
    diagnostics.prompt.totalPromptChars = systemPrompt.length + userPrompt.length;
    diagnostics.prompt.estimatedPromptTokens = Math.ceil(diagnostics.prompt.totalPromptChars / 4);
    diagnostics.timings.stage3PromptBuildMs = Date.now() - tStage3Start;

    // Acquire shared inference lock ensuring max 1 concurrent Ollama inference
    let llmResult;
    let lockWaitTime = 0;
    const lockAcquireStart = Date.now();

    await withSharedInferenceLock({
      pool: db.getPool(),
      jobId,
      claimToken,
      version,
      lockTimeoutMs: 300000
    }, async ({ abortSignal, checkFenced, lockMetrics }) => {
      lockWaitTime = lockMetrics?.lockWaitMs || (Date.now() - lockAcquireStart);
      diagnostics.timings.stage3LockWaitMs = lockWaitTime;
      checkFenced();

      // Transition to active generation once inference lock is held
      await updateStage('GENERATING_ANALYSIS', 65);

      const ollamaStart = Date.now();
      llmResult = await llmService.generateStructuredCompletion({
        prompt: userPrompt,
        systemPrompt,
        temperature: 0.1,
        timeoutMs: 300000,
        signal: abortSignal,
        maxPredictTokens: 1024,
        keepAlive: '30m'
      });
      diagnostics.timings.stage3OllamaTotalMs = Date.now() - ollamaStart;
      checkFenced();
    });

    diagnostics.timings.stage3LockHoldingMs = Date.now() - lockAcquireStart - lockWaitTime;
    diagnostics.ollama = {
      model: llmResult.model,
      promptTokens: llmResult.promptTokens,
      completionTokens: llmResult.completionTokens,
      timeToFirstTokenMs: llmResult.promptEvalDurationMs || 0,
      generationDurationMs: llmResult.evalDurationMs || 0,
      totalRequestMs: llmResult.durationMs,
      tokensPerSecond: (llmResult.evalDurationMs && llmResult.evalDurationMs > 0)
        ? +(llmResult.completionTokens / (llmResult.evalDurationMs / 1000)).toFixed(2)
        : 0
    };
    diagnostics.timings.stage3OllamaTimeToFirstTokenMs = llmResult.promptEvalDurationMs || 0;
    diagnostics.timings.stage3OllamaGenerationDurationMs = llmResult.evalDurationMs || 0;

    // -------------------------------------------------------------------------
    // STAGE 4: SCHEMA VALIDATION & EVIDENCE SCREENING (85%)
    // -------------------------------------------------------------------------
    const tStage4Start = Date.now();
    await updateStage('VALIDATING_SCHEMA', 85);

    let parsedOutput;
    try {
      parsedOutput = JSON.parse(llmResult.rawResponse);
    } catch (parseErr) {
      // Bounded retry repair pass
      console.warn(`[RequirementAnalysisWorker] Model JSON parse error on job ${jobId}. Retrying with strict repair prompt...`);
      diagnostics.schemaValidation.retryPassNeeded = true;
      await withSharedInferenceLock({
        pool: db.getPool(),
        jobId,
        claimToken,
        version,
        lockTimeoutMs: 120000
      }, async ({ abortSignal, checkFenced }) => {
        checkFenced();
        const repairRes = await llmService.generateStructuredCompletion({
          prompt: `The following text failed JSON parsing. Fix syntax errors and return pure valid JSON matching schema:\n\n${llmResult.rawResponse}`,
          systemPrompt: 'You are a JSON repair specialist. Output only valid JSON.',
          temperature: 0.0,
          timeoutMs: 60000,
          signal: abortSignal
        });
        checkFenced();
        parsedOutput = JSON.parse(repairRes.rawResponse);
      });
    }

    // Defensive normalization for 3B/small LLM list fields
    parsedOutput = normalizeAnalysisOutput(parsedOutput);

    // Ajv Schema Validation
    const validation = validateSchema(parsedOutput);
    if (!validation.valid) {
      diagnostics.schemaValidation.valid = false;
      diagnostics.schemaValidation.errors = validation.errors;
      const schemaErr = new Error(`LLM output failed Ajv schema validation: ${JSON.stringify(validation.errors)}`);
      schemaErr.code = 'SCHEMA_VALIDATION_FAILED';
      throw schemaErr;
    }

    // Four-tier automated evidence screening
    const screenedFunctionalReqs = (parsedOutput.functional_requirements || []).map(r => screenRequirementEvidence(r, evidenceMap));
    const screenedNonFunctionalReqs = (parsedOutput.non_functional_requirements || []).map(r => screenRequirementEvidence(r, evidenceMap));
    diagnostics.timings.stage4SchemaValidationMs = Date.now() - tStage4Start;
    diagnostics.schemaValidation.functionalReqsCount = screenedFunctionalReqs.length;
    diagnostics.schemaValidation.nonFunctionalReqsCount = screenedNonFunctionalReqs.length;

    // -------------------------------------------------------------------------
    // STAGE 5: ATOMIC TRANSACTIONAL COMMIT & WORKER FENCING VERIFICATION (95%)
    // -------------------------------------------------------------------------
    const tStage5Start = Date.now();
    await updateStage('PERSISTING_REQUIREMENTS', 95);
    await client.query('BEGIN;');

    // 1. Verify worker ownership before persistence
    const lockCheck = await client.query(`
      SELECT claim_token, version, status 
      FROM ai_generation_jobs 
      WHERE id = $1 
      FOR UPDATE;
    `, [jobId]);

    if (!lockCheck.rows || lockCheck.rows.length === 0 || 
        lockCheck.rows[0].claim_token !== claimToken || 
        lockCheck.rows[0].version !== version || 
        lockCheck.rows[0].status !== 'PROCESSING') {
      await client.query('ROLLBACK;');
      throw new Error('FENCING_ERROR: Stale worker prevented from committing. Job lease was reclaimed.');
    }

    // 2. Persist ai_requirement_analyses
    const analysisId = crypto.randomUUID();
    const hexPrefix = analysisId.replace(/-/g, '').slice(0, 12).toUpperCase();
    const cleanTicket = (payload.ticketId || 'TASK').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase() || 'TASK';

    await client.query(`
      INSERT INTO ai_requirement_analyses (
        id, project_id, job_id, task_reference, task_title, task_description,
        raw_input_type, attachment_metadata, status, grounding_mode,
        retrieved_chunks, analysis_summary, features_and_modules,
        user_workflows, api_dependencies, gap_analysis, model_name,
        prompt_tokens, completion_tokens, duration_ms, created_by_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'COMPLETED', $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20);
    `, [
      analysisId, projectId, jobId, payload.ticketId || null, payload.title, payload.description || payload.rawText || '',
      payload.rawInputType, JSON.stringify(payload.attachmentMeta ? [payload.attachmentMeta] : []),
      groundingMode, JSON.stringify(candidateChunks), parsedOutput.summary,
      JSON.stringify(parsedOutput.features_and_modules || []),
      JSON.stringify(parsedOutput.user_workflows || []),
      JSON.stringify(parsedOutput.api_dependencies || []),
      JSON.stringify(parsedOutput.gap_analysis || {}),
      llmResult.model, llmResult.promptTokens, llmResult.completionTokens,
      llmResult.durationMs, userId
    ]);

    // 3. Persist DRAFT requirements with collision-proof keys: REQ-<TICKET>-<12_HEX>-<INDEX>
    let reqSeq = 1;
    const allScreenedReqs = [...screenedFunctionalReqs, ...screenedNonFunctionalReqs];

    for (const req of allScreenedReqs) {
      const reqId = crypto.randomUUID();
      const collisionProofKey = `REQ-${cleanTicket}-${hexPrefix}-${String(reqSeq++).padStart(2, '0')}`;

      await client.query(`
        INSERT INTO ai_requirements (
          id, project_id, analysis_id, req_key, title, description,
          category, priority, status, source_classification,
          business_rules, validations, dependencies, acceptance_criteria, evidence_citations
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'DRAFT', $9, $10, $11, $12, $13, $14);
      `, [
        reqId, projectId, analysisId, collisionProofKey,
        req.title, req.description, req.category || 'FUNCTIONAL',
        req.priority || 'MEDIUM', req.classification || 'DIRECT',
        JSON.stringify(req.business_rules || []),
        JSON.stringify(req.validations || []),
        JSON.stringify(req.dependencies || []),
        JSON.stringify(req.acceptance_criteria || []),
        JSON.stringify(req.citations || [])
      ]);

      // 4. Persist citations to ai_requirement_traceability
      for (const cit of (req.citations || [])) {
        if (cit.chunkId && cit.evidenceStatus === 'PLAUSIBLE_SUPPORT') {
          await client.query(`
            INSERT INTO ai_requirement_traceability (
              id, requirement_id, chunk_id, test_case_id, trace_type
            ) VALUES ($1, $2, $3, NULL, $4)
            ON CONFLICT (requirement_id, test_case_id) DO NOTHING;
          `, [
            crypto.randomUUID(), reqId, cit.chunkId,
            req.classification === 'DIRECT' ? 'DIRECT_COVERAGE' : 'INFERRED_COVERAGE'
          ]);
        }
      }
    }

    diagnostics.timings.stage5PersistenceMs = Date.now() - tStage5Start;
    diagnostics.timings.totalJobDurationMs = Date.now() - workerClaimedAt;

    // 5. Finalize ai_generation_jobs in same transaction
    await client.query(`
      UPDATE ai_generation_jobs
      SET status = 'COMPLETED',
          current_stage = 'COMPLETED',
          progress_percent = 100,
          result_reference = json_build_object('analysisId', $1::uuid),
          internal_diagnostics = $5::jsonb,
          completed_at = clock_timestamp(),
          updated_at = clock_timestamp()
      WHERE id = $2
        AND claim_token = $3
        AND version = $4
        AND status = 'PROCESSING';
    `, [analysisId, jobId, claimToken, version, JSON.stringify(diagnostics)]);

    await client.query('COMMIT;');

    console.log(`[RequirementAnalysisWorker] Job ${jobId} completed successfully. Analysis ID: ${analysisId}`);
    console.log(`[RequirementAnalysisMetrics] Job ${jobId}: total=${(diagnostics.timings.totalJobDurationMs/1000).toFixed(1)}s, retrieval=${diagnostics.timings.stage2RetrievalMs}ms (${candidateChunks.length} chunks, ${diagnostics.retrieval.selectedEvidenceChars} chars), lockWait=${diagnostics.timings.stage3LockWaitMs}ms, timeToFirstToken=${diagnostics.timings.stage3OllamaTimeToFirstTokenMs}ms, genDuration=${(diagnostics.timings.stage3OllamaGenerationDurationMs/1000).toFixed(1)}s (${diagnostics.ollama.completionTokens} tokens @ ${diagnostics.ollama.tokensPerSecond} tok/s)`);
  } catch (err) {
    if (advisoryLockAcquired) {
      try { await client.query(`SELECT pg_advisory_unlock($1, $2);`, [ADVISORY_CLASS_HASH, ADVISORY_OBJ_ID]); } catch (_) {}
    }
    try { await client.query('ROLLBACK;'); } catch (_) {}

    console.error(`[RequirementAnalysisWorker] Job ${jobId} failed:`, err.message);

    // Record failure in ai_generation_jobs with diagnostics
    try {
      const errorDiagnostics = {
        error: err.message,
        code: err.code || 'JOB_EXECUTION_ERROR',
        workerId,
        failedAt: new Date().toISOString(),
        partialDiagnostics: typeof diagnostics !== 'undefined' ? diagnostics : null
      };

      await db.query(`
        UPDATE ai_generation_jobs
        SET status = 'FAILED',
            current_stage = 'FAILED',
            error_message = $1,
            internal_diagnostics = $2::jsonb,
            completed_at = clock_timestamp(),
            updated_at = clock_timestamp()
        WHERE id = $3;
      `, [err.message, JSON.stringify(errorDiagnostics), jobId]);
    } catch (_) {}
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    client.release();
  }
}

/**
 * Gets job status and diagnostics.
 */
async function getJobStatus(projectId, jobId) {
  const res = await db.query(`
    SELECT id, project_id, status, current_stage, progress_percent,
           result_reference, error_message, internal_diagnostics, created_at, started_at, completed_at
    FROM ai_generation_jobs
    WHERE id = $1 AND project_id = $2;
  `, [jobId, projectId]);

  if (!res.rows[0]) {
    const err = new Error('Job not found.');
    err.status = 404;
    throw err;
  }
  return res.rows[0];
}

/**
 * Gets full analysis by ID including associated requirements and citations.
 */
async function getAnalysisById(projectId, analysisId) {
  const analysisRes = await db.query(`
    SELECT * FROM ai_requirement_analyses
    WHERE id = $1 AND project_id = $2;
  `, [analysisId, projectId]);

  if (!analysisRes.rows[0]) {
    const err = new Error('Requirement analysis not found.');
    err.status = 404;
    throw err;
  }

  const analysis = analysisRes.rows[0];

  // Fetch associated requirements
  const reqRes = await db.query(`
    SELECT * FROM ai_requirements
    WHERE analysis_id = $1 AND project_id = $2
    ORDER BY req_key ASC;
  `, [analysisId, projectId]);

  return {
    ...analysis,
    requirements: reqRes.rows
  };
}

/**
 * Lists past analyses for project.
 */
async function listAnalyses(projectId, { page = 1, limit = 20, search = '' } = {}) {
  const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const searchPattern = search ? `%${search}%` : null;

  const countRes = await db.query(`
    SELECT COUNT(*) as total FROM ai_requirement_analyses
    WHERE project_id = $1
      AND ($2::text IS NULL OR task_title ILIKE $2 OR task_reference ILIKE $2);
  `, [projectId, searchPattern]);

  const rowsRes = await db.query(`
    SELECT id, project_id, task_reference, task_title, raw_input_type,
           status, grounding_mode, model_name, created_at, updated_at
    FROM ai_requirement_analyses
    WHERE project_id = $1
      AND ($2::text IS NULL OR task_title ILIKE $2 OR task_reference ILIKE $2)
    ORDER BY created_at DESC
    LIMIT $3 OFFSET $4;
  `, [projectId, searchPattern, limit, offset]);

  return {
    total: parseInt(countRes.rows[0]?.total || 0, 10),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    analyses: rowsRes.rows
  };
}

/**
 * Deletes an analysis session safely.
 * Thanks to ON DELETE SET NULL (analysis_id), active and referenced requirements remain intact.
 */
async function deleteAnalysis(projectId, analysisId) {
  const res = await db.query(`
    DELETE FROM ai_requirement_analyses
    WHERE id = $1 AND project_id = $2
    RETURNING id;
  `, [analysisId, projectId]);

  if (res.rowCount === 0) {
    const err = new Error('Requirement analysis not found.');
    err.status = 404;
    throw err;
  }

  return { success: true, deletedAnalysisId: analysisId };
}

/**
 * Explicit Human Approval: Promotes a DRAFT requirement to ACTIVE.
 */
async function approveRequirement(projectId, requirementId, userId, notes = '') {
  const res = await db.query(`
    UPDATE ai_requirements
    SET status = 'ACTIVE',
        updated_at = NOW()
    WHERE id = $1 
      AND project_id = $2 
      AND status = 'DRAFT'
    RETURNING *;
  `, [requirementId, projectId]);

  if (res.rowCount === 0) {
    const check = await db.query(`SELECT status FROM ai_requirements WHERE id = $1 AND project_id = $2;`, [requirementId, projectId]);
    if (!check.rows[0]) {
      const err = new Error('Requirement not found.');
      err.status = 404;
      throw err;
    }
    if (check.rows[0].status === 'ACTIVE') {
      return { success: true, message: 'Requirement is already ACTIVE.', requirement: check.rows[0] };
    }
    const err = new Error(`Cannot approve requirement with status: ${check.rows[0].status}`);
    err.status = 400;
    throw err;
  }

  return { success: true, message: 'Requirement approved and promoted to ACTIVE.', requirement: res.rows[0] };
}

/**
 * Lists requirements for a project with optional filters.
 */
async function listRequirements(projectId, { analysisId = null, status = null, category = null, search = '', page = 1, limit = 50 } = {}) {
  const offset = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
  const searchPattern = search ? `%${search}%` : null;

  const countRes = await db.query(`
    SELECT COUNT(*) as total FROM ai_requirements
    WHERE project_id = $1
      AND ($2::uuid IS NULL OR analysis_id = $2)
      AND ($3::text IS NULL OR status = $3)
      AND ($4::text IS NULL OR category = $4)
      AND ($5::text IS NULL OR title ILIKE $5 OR req_key ILIKE $5 OR description ILIKE $5);
  `, [projectId, analysisId, status, category, searchPattern]);

  const rowsRes = await db.query(`
    SELECT * FROM ai_requirements
    WHERE project_id = $1
      AND ($2::uuid IS NULL OR analysis_id = $2)
      AND ($3::text IS NULL OR status = $3)
      AND ($4::text IS NULL OR category = $4)
      AND ($5::text IS NULL OR title ILIKE $5 OR req_key ILIKE $5 OR description ILIKE $5)
    ORDER BY created_at DESC, req_key ASC
    LIMIT $6 OFFSET $7;
  `, [projectId, analysisId, status, category, searchPattern, limit, offset]);

  return {
    total: parseInt(countRes.rows[0]?.total || 0, 10),
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
    requirements: rowsRes.rows
  };
}

module.exports = {
  submitAnalysisJob,
  executeWorkerPass,
  getJobStatus,
  getAnalysisById,
  listAnalyses,
  deleteAnalysis,
  approveRequirement,
  listRequirements,
  computeIdempotencyKey,
  parseTaskAttachment
};
