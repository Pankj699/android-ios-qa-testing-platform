const http = require('http');

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
const DEFAULT_INFERENCE_MODEL = process.env.AI_INFERENCE_MODEL || 'qwen2.5:3b-instruct';
const DEFAULT_TIMEOUT_MS = 120000; // 120 seconds timeout for local LLM generation

/**
 * Checks local Ollama server health and model availability.
 */
async function checkOllamaLiveness(baseUrl = OLLAMA_BASE_URL) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(`${baseUrl}/api/tags`, {
      method: 'GET',
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return { available: false, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const models = (data.models || []).map(m => m.name);
    return {
      available: true,
      models,
      hasInferenceModel: models.some(m => m.includes('qwen2.5') || m.includes(DEFAULT_INFERENCE_MODEL))
    };
  } catch (err) {
    return { available: false, error: err.message };
  }
}

/**
 * Sends a structured generation request to Ollama with format: 'json'
 * Protected by AbortController timeout and sanitization.
 */
async function generateStructuredCompletion({
  prompt,
  systemPrompt,
  model = DEFAULT_INFERENCE_MODEL,
  temperature = 0.1,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  baseUrl = OLLAMA_BASE_URL,
  signal = null,
  maxPredictTokens = 1024,
  keepAlive = '30m'
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
    }
  }

  const startTime = Date.now();

  try {
    const payload = {
      model,
      prompt,
      system: systemPrompt,
      stream: false,
      format: 'json',
      keep_alive: keepAlive,
      options: {
        temperature,
        num_ctx: 4096,
        num_predict: maxPredictTokens
      }
    };

    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    clearTimeout(timer);

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const err = new Error(`Ollama generation failed (HTTP ${response.status}): ${errText}`);
      err.code = 'OLLAMA_HTTP_ERROR';
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const durationMs = Date.now() - startTime;

    if (!data.response) {
      const err = new Error('Ollama returned empty response string.');
      err.code = 'OLLAMA_EMPTY_RESPONSE';
      throw err;
    }

    return {
      rawResponse: data.response,
      model: data.model || model,
      promptTokens: data.prompt_eval_count || 0,
      completionTokens: data.eval_count || 0,
      promptEvalDurationMs: data.prompt_eval_duration ? Math.round(data.prompt_eval_duration / 1e6) : null,
      evalDurationMs: data.eval_duration ? Math.round(data.eval_duration / 1e6) : null,
      durationMs
    };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      const timeoutErr = new Error(`Ollama generation request timed out after ${timeoutMs}ms.`);
      timeoutErr.code = 'OLLAMA_TIMEOUT';
      timeoutErr.status = 504;
      throw timeoutErr;
    }
    if (err.code === 'ECONNREFUSED' || err.message.includes('fetch failed')) {
      const connErr = new Error('Local Ollama service connection refused. Verify Ollama is running.');
      connErr.code = 'OLLAMA_UNAVAILABLE';
      connErr.status = 503;
      throw connErr;
    }
    throw err;
  }
}

module.exports = {
  checkOllamaLiveness,
  generateStructuredCompletion,
  DEFAULT_INFERENCE_MODEL,
  DEFAULT_TIMEOUT_MS,
  OLLAMA_BASE_URL
};
