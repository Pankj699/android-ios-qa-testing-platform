const db = require('../db/connection');

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_BATCH_SIZE = 5;
const APPROVED_EMBEDDING_MODEL = 'nomic-embed-text';
const EXPECTED_DIMENSIONS = 768;

/**
 * Retrieves and validates the single active embedding model configuration.
 * Hard-blocks unapproved models (e.g. Qwen) and incorrect vector dimensions.
 */
async function getActiveEmbeddingConfig(client = null) {
  const queryFn = client ? (q, p) => client.query(q, p) : (q, p) => db.query(q, p);
  const res = await queryFn(`
    SELECT id, model_name, provider, dimensions, context_window, distance_metric, is_active
    FROM ai_embedding_config
    WHERE is_active = TRUE
    LIMIT 1;
  `);

  if (!res.rows || res.rows.length === 0) {
    const err = new Error('No active embedding configuration found in ai_embedding_config.');
    err.code = 'INVALID_EMBEDDING_CONFIG';
    err.status = 500;
    throw err;
  }

  const config = res.rows[0];

  // Reject Qwen or any other model attempting to be used as embedding model
  if (config.model_name.toLowerCase().includes('qwen')) {
    const err = new Error(`Model '${config.model_name}' is a test-generation LLM, not an approved embedding model. Only 'nomic-embed-text' is permitted.`);
    err.code = 'UNSUPPORTED_EMBEDDING_MODEL';
    err.status = 400;
    throw err;
  }

  if (config.model_name !== APPROVED_EMBEDDING_MODEL) {
    const err = new Error(`Unsupported embedding model '${config.model_name}'. Expected '${APPROVED_EMBEDDING_MODEL}'.`);
    err.code = 'UNSUPPORTED_EMBEDDING_MODEL';
    err.status = 400;
    throw err;
  }

  if (parseInt(config.dimensions, 10) !== EXPECTED_DIMENSIONS) {
    const err = new Error(`Active embedding model dimensions must be exactly ${EXPECTED_DIMENSIONS}. Found ${config.dimensions}.`);
    err.code = 'INVALID_EMBEDDING_DIMENSIONS';
    err.status = 400;
    throw err;
  }

  return config;
}

/**
 * Validates a single dense embedding vector.
 * Asserts 768 dimensions, finite floating numbers, non-NaN, and non-all-zero.
 */
function validateEmbeddingVector(vec, expectedDim = EXPECTED_DIMENSIONS) {
  if (!Array.isArray(vec)) {
    throw new Error('Embedding vector must be an array.');
  }

  if (vec.length !== expectedDim) {
    throw new Error(`Embedding vector dimension mismatch: expected ${expectedDim}, got ${vec.length}.`);
  }

  let isAllZero = true;
  for (let i = 0; i < vec.length; i++) {
    const val = vec[i];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(`Embedding vector contains invalid numeric value at index ${i}: ${val}`);
    }
    if (val !== 0) {
      isAllZero = false;
    }
  }

  if (isAllZero) {
    throw new Error('Embedding vector is all zeros, which indicates model inference failure.');
  }

  return true;
}

/**
 * Sends a single embedding request to Ollama with AbortController timeout protection.
 * Supports /api/embed (batch) with fallback to /api/embeddings (single).
 */
async function callOllamaEmbeddings(texts, { model = APPROVED_EMBEDDING_MODEL, timeoutMs = DEFAULT_TIMEOUT_MS, baseUrl = OLLAMA_BASE_URL } = {}) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  const startTime = Date.now();

  try {
    // 1. Try batch /api/embed endpoint first
    const embedUrl = `${baseUrl.replace(/\/+$/, '')}/api/embed`;
    const response = await fetch(embedUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      signal: controller.signal
    });

    if (response.ok) {
      const data = await response.json();
      if (!Array.isArray(data.embeddings)) {
        throw new Error("Ollama /api/embed response missing 'embeddings' array.");
      }
      if (data.embeddings.length !== texts.length) {
        throw new Error(`Ollama /api/embed returned ${data.embeddings.length} vectors for ${texts.length} inputs.`);
      }

      for (let i = 0; i < data.embeddings.length; i++) {
        validateEmbeddingVector(data.embeddings[i], EXPECTED_DIMENSIONS);
      }

      return {
        embeddings: data.embeddings,
        latencyMs: Date.now() - startTime,
        endpoint: '/api/embed'
      };
    }

    // If /api/embed returned 404, fallback to /api/embeddings sequentially
    if (response.status === 404) {
      console.warn('[EmbeddingService] /api/embed not supported by Ollama, falling back to /api/embeddings.');
      const fallbackUrl = `${baseUrl.replace(/\/+$/, '')}/api/embeddings`;
      const fallbackVectors = [];

      for (let i = 0; i < texts.length; i++) {
        const singleRes = await fetch(fallbackUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: texts[i] }),
          signal: controller.signal
        });

        if (!singleRes.ok) {
          const errText = await singleRes.text().catch(() => '');
          throw new Error(`Ollama fallback /api/embeddings failed (${singleRes.status}): ${errText}`);
        }

        const singleData = await singleRes.json();
        if (!Array.isArray(singleData.embedding)) {
          throw new Error("Ollama fallback response missing 'embedding' array.");
        }
        validateEmbeddingVector(singleData.embedding, EXPECTED_DIMENSIONS);
        fallbackVectors.push(singleData.embedding);
      }

      return {
        embeddings: fallbackVectors,
        latencyMs: Date.now() - startTime,
        endpoint: '/api/embeddings'
      };
    }

    const errBody = await response.text().catch(() => '');
    throw new Error(`Ollama /api/embed HTTP ${response.status}: ${errBody}`);
  } catch (err) {
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Ollama embedding request timed out after ${timeoutMs}ms.`);
      timeoutErr.code = 'OLLAMA_TIMEOUT';
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    throw err;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Checks local Ollama liveness and verifies nomic-embed-text availability.
 */
async function checkOllamaHealth(baseUrl = OLLAMA_BASE_URL) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      return { available: false, error: `HTTP ${res.status}` };
    }
    const data = await res.json();
    const models = data.models || [];
    const hasNomic = models.some(m => m.name.includes(APPROVED_EMBEDDING_MODEL));
    return {
      available: true,
      hasApprovedModel: hasNomic,
      models: models.map(m => m.name)
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

/**
 * Generates embeddings for an array of chunks in batches with single-retry logic.
 * Ensures zero partial index exposure: if any batch fails after retry, throws and discards vectors.
 *
 * @param {Array<Object>} chunks - Array of chunk objects { id, content, ... }
 * @param {Object} options - Execution options
 * @param {string} [options.baseUrl=OLLAMA_BASE_URL]
 * @param {number} [options.batchSize=DEFAULT_BATCH_SIZE]
 * @param {number} [options.timeoutMs=DEFAULT_TIMEOUT_MS]
 * @returns {Promise<Object>} { embeddings: Array<Object>, diagnostics: Object }
 */
async function generateEmbeddingsForChunks(chunks, options = {}) {
  if (!chunks || !Array.isArray(chunks) || chunks.length === 0) {
    return { embeddings: [], diagnostics: { totalChunks: 0, totalDurationMs: 0 } };
  }

  const activeConfig = await getActiveEmbeddingConfig();
  const batchSize = options.batchSize || DEFAULT_BATCH_SIZE;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const baseUrl = options.baseUrl || OLLAMA_BASE_URL;

  const memBefore = process.memoryUsage();
  const overallStartTime = Date.now();
  const batchDiagnostics = [];
  const generatedEmbeddings = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batchChunks = chunks.slice(i, i + batchSize);
    const batchTexts = batchChunks.map(c => c.content);
    const batchIndex = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(chunks.length / batchSize);

    let batchResult = null;
    let attempt = 1;

    while (attempt <= 2) {
      try {
        batchResult = await callOllamaEmbeddings(batchTexts, {
          model: activeConfig.model_name,
          timeoutMs,
          baseUrl
        });
        break; // Success
      } catch (err) {
        if (attempt === 1) {
          console.warn(`[EmbeddingService] Batch ${batchIndex}/${totalBatches} failed on attempt 1 (${err.message}). Retrying in 2,000ms...`);
          await new Promise(r => setTimeout(r, 2000));
          attempt++;
        } else {
          // Retry failed: Fail entire indexing pipeline immediately
          const failErr = new Error(`Ollama batch ${batchIndex}/${totalBatches} failed after retry: ${err.message}`);
          failErr.code = err.code || 'OLLAMA_BATCH_FAILED';
          failErr.batchIndex = batchIndex;
          failErr.diagnostics = {
            failedBatchIndex: batchIndex,
            totalBatches,
            attempt,
            originalError: err.message
          };
          throw failErr;
        }
      }
    }

    // Pair vectors with chunk IDs
    for (let cIdx = 0; cIdx < batchChunks.length; cIdx++) {
      generatedEmbeddings.push({
        id: crypto.randomUUID(),
        chunk_id: batchChunks[cIdx].id,
        model_id: activeConfig.id,
        embedding: batchResult.embeddings[cIdx]
      });
    }

    batchDiagnostics.push({
      batchIndex,
      chunkCount: batchChunks.length,
      latencyMs: batchResult.latencyMs,
      endpoint: batchResult.endpoint
    });
  }

  const memAfter = process.memoryUsage();
  const totalDurationMs = Date.now() - overallStartTime;

  return {
    embeddings: generatedEmbeddings,
    diagnostics: {
      modelName: activeConfig.model_name,
      modelId: activeConfig.id,
      dimensions: EXPECTED_DIMENSIONS,
      totalChunks: chunks.length,
      totalBatches: batchDiagnostics.length,
      batchSize,
      totalDurationMs,
      averageBatchLatencyMs: batchDiagnostics.length > 0 
        ? Math.round(batchDiagnostics.reduce((acc, b) => acc + b.latencyMs, 0) / batchDiagnostics.length) 
        : 0,
      memoryDeltaBytes: {
        rss: memAfter.rss - memBefore.rss,
        heapUsed: memAfter.heapUsed - memBefore.heapUsed
      },
      batchDetails: batchDiagnostics
    }
  };
}

/**
 * Generates an embedding vector for a single query string without prefix,
 * maintaining exact vector space parity with stored Phase 2.5 document vectors.
 *
 * @param {string} queryText - The query text to embed
 * @param {Object} [options={}] - Execution options (timeoutMs, baseUrl)
 * @returns {Promise<Object>} { embedding: Array<number>, latencyMs: number, dimensions: number, model: string }
 */
async function generateQueryEmbedding(queryText, options = {}) {
  if (typeof queryText !== 'string' || !queryText.trim()) {
    const err = new Error('Query text must be a non-empty string.');
    err.code = 'INVALID_QUERY_TEXT';
    err.status = 400;
    throw err;
  }

  const activeConfig = await getActiveEmbeddingConfig();
  const cleanQuery = queryText.trim();
  const timeoutMs = options.timeoutMs || 10000;
  const baseUrl = options.baseUrl || OLLAMA_BASE_URL;

  const result = await callOllamaEmbeddings([cleanQuery], {
    model: activeConfig.model_name,
    timeoutMs,
    baseUrl
  });

  return {
    embedding: result.embeddings[0],
    latencyMs: result.latencyMs,
    dimensions: EXPECTED_DIMENSIONS,
    model: activeConfig.model_name
  };
}

module.exports = {
  getActiveEmbeddingConfig,
  validateEmbeddingVector,
  callOllamaEmbeddings,
  checkOllamaHealth,
  generateEmbeddingsForChunks,
  generateQueryEmbedding,
  APPROVED_EMBEDDING_MODEL,
  EXPECTED_DIMENSIONS
};

