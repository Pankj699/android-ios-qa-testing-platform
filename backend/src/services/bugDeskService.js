const logger = require('../utils/logger');

const SYSTEM_PROMPT = `You are a Senior QA Engineer and Bug Report Writer.

Convert rough QA notes into professional PMS-format bug reports.

Generate:
- Professional Bug Title
- Professional Reproduction Steps
- Actual Result (what actually happened — derived from the notes)
- Expected Result (what should have happened — inferred from context)

Rules:
- Improve grammar and readability.
- Keep the original meaning; do not invent unsupported information.
- Preserve URLs and attachments as-is.
- Create concise, developer-friendly titles. Avoid generic titles like "Bug Found" or "Error Occurred".
- Each step must be a single, clear action sentence. Do NOT include any numbering or prefixes in the step text — the app adds numbering automatically.
- The actualResult should clearly describe the buggy behaviour observed.
- The expectedResult should clearly describe the correct behaviour that should occur.
- Both actualResult and expectedResult should be concise (1–2 sentences max).
- If the notes do not give enough context to infer actual/expected results, use "Analysing by given steps".

Return JSON only — no markdown fences, no commentary, nothing else:
{"title": "", "steps": [""], "actualResult": "", "expectedResult": ""}`;

class BugDeskService {
  resolveApiKey(userProvidedKey) {
    if (userProvidedKey && typeof userProvidedKey === 'string' && userProvidedKey.trim()) {
      return userProvidedKey.trim();
    }
    if (process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim()) {
      return process.env.GEMINI_API_KEY.trim();
    }
    return '';
  }

  async rewriteBug({ rawNotes, apiKey, model = 'gemini-2.5-flash' }) {
    const effectiveKey = this.resolveApiKey(apiKey);
    if (!effectiveKey) {
      const err = new Error('Missing Gemini API key. Please configure your API key in Bug Desk Settings.');
      err.status = 400;
      throw err;
    }

    if (!rawNotes || typeof rawNotes !== 'string' || !rawNotes.trim()) {
      const err = new Error('Raw QA notes are required.');
      err.status = 400;
      throw err;
    }

    const selectedModel = model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${encodeURIComponent(effectiveKey)}`;

    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `Rough QA notes:\n\n${rawNotes.trim()}` }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.4 }
    };

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch (networkErr) {
      logger.error(`[BugDeskService] Network error reaching Gemini: ${networkErr.message}`);
      const err = new Error('Could not reach the Gemini API. Check your network connection.');
      err.status = 502;
      throw err;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      logger.warn(`[BugDeskService] Gemini API returned status ${res.status}: ${errText.slice(0, 200)}`);
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        const err = new Error('Invalid Gemini API key or insufficient permissions.');
        err.status = 401;
        throw err;
      }
      const err = new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      const err = new Error('Gemini returned an empty response.');
      err.status = 502;
      throw err;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const err = new Error('Gemini returned a response that could not be parsed as JSON.');
      err.status = 502;
      throw err;
    }

    const title = (parsed.title || '').trim();
    const steps = Array.isArray(parsed.steps)
      ? parsed.steps.map(s => String(s).trim()).filter(Boolean)
      : [];
    const actualResult = (parsed.actualResult || 'Analysing by given steps').trim();
    const expectedResult = (parsed.expectedResult || 'Analysing by given steps').trim();

    if (!title || steps.length === 0) {
      const err = new Error('Gemini did not return a usable title and steps.');
      err.status = 502;
      throw err;
    }

    return { title, steps, actualResult, expectedResult };
  }

  async testConnection({ apiKey, model = 'gemini-2.5-flash' }) {
    const effectiveKey = this.resolveApiKey(apiKey);
    if (!effectiveKey) {
      const err = new Error('Missing Gemini API key.');
      err.status = 400;
      throw err;
    }

    const selectedModel = model || 'gemini-2.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${encodeURIComponent(effectiveKey)}`;

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
          generationConfig: { maxOutputTokens: 8 }
        })
      });
    } catch (networkErr) {
      const err = new Error('Could not reach the Gemini API. Check your network connection.');
      err.status = 502;
      throw err;
    }

    if (!res.ok) {
      const err = new Error('Invalid Gemini API key, unsupported model, or insufficient permissions.');
      err.status = 401;
      throw err;
    }

    return { connected: true };
  }
}

module.exports = new BugDeskService();
