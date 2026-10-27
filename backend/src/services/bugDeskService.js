const db = require('../db');
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

  normalizeKey(name, os) {
    const n = (name || '').trim().toLowerCase();
    const o = (os || '').trim().toLowerCase();
    return `${n}:::${o}`;
  }

  async getAllDevices() {
    const res = await db.query(
      `SELECT id, name, os, manufacturer, model, created_by_user_id, created_at, updated_at
       FROM bugdesk_devices
       ORDER BY name ASC, os ASC`
    );
    return res.rows || [];
  }

  async getDeviceById(id) {
    if (!id) return null;
    const res = await db.query(
      `SELECT id, name, os, manufacturer, model, created_by_user_id, created_at, updated_at
       FROM bugdesk_devices
       WHERE id = $1`,
      [id]
    );
    return res.rows?.[0] || null;
  }

  async createDevice({ name, os, manufacturer, model, userId }) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    const trimmedOs = typeof os === 'string' ? os.trim() : '';
    if (!trimmedName) {
      const err = new Error('Device display name is required.');
      err.status = 400;
      throw err;
    }
    if (!trimmedOs) {
      const err = new Error('OS display/version is required.');
      err.status = 400;
      throw err;
    }

    const normKey = this.normalizeKey(trimmedName, trimmedOs);

    // Duplicate check before insert
    const dupCheck = await db.query(
      `SELECT id, name, os FROM bugdesk_devices WHERE normalized_key = $1`,
      [normKey]
    );
    if (dupCheck.rows && dupCheck.rows.length > 0) {
      const err = new Error(`A device with name "${trimmedName}" and OS "${trimmedOs}" already exists in the catalog.`);
      err.status = 409;
      throw err;
    }

    const trimmedMfg = typeof manufacturer === 'string' && manufacturer.trim() ? manufacturer.trim() : null;
    const trimmedModel = typeof model === 'string' && model.trim() ? model.trim() : null;

    let validUserId = null;
    if (userId) {
      try {
        const uCheck = await db.query('SELECT id FROM users WHERE id = $1', [userId]);
        if (uCheck.rows && uCheck.rows.length > 0) {
          validUserId = uCheck.rows[0].id;
        }
      } catch (_) {}
    }

    try {
      const insertRes = await db.query(
        `INSERT INTO bugdesk_devices (name, os, manufacturer, model, normalized_key, created_by_user_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id, name, os, manufacturer, model, created_by_user_id, created_at, updated_at`,
        [trimmedName, trimmedOs, trimmedMfg, trimmedModel, normKey, validUserId]
      );
      if (typeof db.saveToDisk === 'function') {
        db.saveToDisk();
      }
      return insertRes.rows[0];
    } catch (dbErr) {
      if (dbErr.code === '23505' || dbErr.message?.includes('duplicate key') || dbErr.message?.includes('unique constraint')) {
        const err = new Error(`A device with name "${trimmedName}" and OS "${trimmedOs}" already exists in the catalog.`);
        err.status = 409;
        throw err;
      }
      throw dbErr;
    }
  }

  async updateDevice(id, { name, os, manufacturer, model }) {
    if (!id) {
      const err = new Error('Device ID is required.');
      err.status = 400;
      throw err;
    }

    const existing = await this.getDeviceById(id);
    if (!existing) {
      const err = new Error('Device not found.');
      err.status = 404;
      throw err;
    }

    const newName = name !== undefined ? (typeof name === 'string' ? name.trim() : '') : existing.name;
    const newOs = os !== undefined ? (typeof os === 'string' ? os.trim() : '') : existing.os;

    if (!newName) {
      const err = new Error('Device display name cannot be empty.');
      err.status = 400;
      throw err;
    }
    if (!newOs) {
      const err = new Error('OS display/version cannot be empty.');
      err.status = 400;
      throw err;
    }

    const newMfg = manufacturer !== undefined
      ? (typeof manufacturer === 'string' && manufacturer.trim() ? manufacturer.trim() : null)
      : existing.manufacturer;
    const newModel = model !== undefined
      ? (typeof model === 'string' && model.trim() ? model.trim() : null)
      : existing.model;

    const normKey = this.normalizeKey(newName, newOs);

    // Duplicate check excluding current ID
    const dupCheck = await db.query(
      `SELECT id FROM bugdesk_devices WHERE normalized_key = $1 AND id != $2`,
      [normKey, id]
    );
    if (dupCheck.rows && dupCheck.rows.length > 0) {
      const err = new Error(`A device with name "${newName}" and OS "${newOs}" already exists in the catalog.`);
      err.status = 409;
      throw err;
    }

    try {
      const updateRes = await db.query(
        `UPDATE bugdesk_devices
         SET name = $1, os = $2, manufacturer = $3, model = $4, normalized_key = $5, updated_at = NOW()
         WHERE id = $6
         RETURNING id, name, os, manufacturer, model, created_by_user_id, created_at, updated_at`,
        [newName, newOs, newMfg, newModel, normKey, id]
      );
      if (typeof db.saveToDisk === 'function') {
        db.saveToDisk();
      }
      return updateRes.rows[0];
    } catch (dbErr) {
      if (dbErr.code === '23505' || dbErr.message?.includes('duplicate key') || dbErr.message?.includes('unique constraint')) {
        const err = new Error(`A device with name "${newName}" and OS "${newOs}" already exists in the catalog.`);
        err.status = 409;
        throw err;
      }
      throw dbErr;
    }
  }

  async deleteDevice(id) {
    if (!id) {
      const err = new Error('Device ID is required.');
      err.status = 400;
      throw err;
    }

    const existing = await this.getDeviceById(id);
    if (!existing) {
      const err = new Error('Device not found.');
      err.status = 404;
      throw err;
    }

    await db.query(`DELETE FROM bugdesk_devices WHERE id = $1`, [id]);
    if (typeof db.saveToDisk === 'function') {
      db.saveToDisk();
    }
    return { success: true, message: `Device "${existing.name}" removed from catalog.` };
  }

  // ---- PMS / Redmine Integration Options ----

  resolvePmsHostAndProject(platform = 'android', customUrl = null) {
    let host = 'https://pms.optimumbrew.com';
    let projectId = platform === 'ios' ? 'iha_ios' : 'cp-photo-editor-suite';

    if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
      try {
        const parsed = new URL(customUrl.trim());
        host = parsed.origin;
        const match = parsed.pathname.match(/\/projects\/([^/]+)/);
        if (match && match[1]) {
          projectId = match[1];
        }
      } catch (_) {}
    }

    return { host, projectId };
  }

  async getPmsOptions({ platform = 'android', customUrl = null, apiKey = null } = {}) {
    const { host, projectId } = this.resolvePmsHostAndProject(platform, customUrl);
    const effectiveApiKey = (apiKey && typeof apiKey === 'string' && apiKey.trim())
      ? apiKey.trim()
      : (process.env.REDMINE_API_KEY || process.env.PMS_API_KEY || '').trim();

    // 1. Fetch Statuses
    let statuses = [];
    let defaultStatusId = null;
    try {
      const res = await fetch(`${host}/issue_statuses.json`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        statuses = (data?.issue_statuses || []).map(s => ({
          id: s.id,
          name: s.name,
          is_closed: Boolean(s.is_closed)
        }));
      }
    } catch (e) {
      logger.warn(`[BugDeskService] Failed to fetch issue_statuses from ${host}: ${e.message}`);
    }

    // Fallback statuses if live fetch unavailable
    if (!statuses || statuses.length === 0) {
      statuses = [
        { id: 1, name: 'New', is_closed: false },
        { id: 2, name: 'In Progress', is_closed: false },
        { id: 7, name: 'Ready for testing (Resolved)', is_closed: false },
        { id: 3, name: 'Resolved', is_closed: false },
        { id: 4, name: 'Feedback', is_closed: false }
      ];
    }

    // Verified default for Status: "New"
    const newStatus = statuses.find(s => s.name && s.name.trim().toLowerCase() === 'new');
    if (newStatus) {
      defaultStatusId = newStatus.id;
    }

    // 2. Fetch Priorities
    let priorities = [];
    let defaultPriorityId = null;
    try {
      const res = await fetch(`${host}/enumerations/issue_priorities.json`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        priorities = (data?.issue_priorities || []).map(p => ({
          id: p.id,
          name: p.name,
          is_default: Boolean(p.is_default),
          active: p.active !== undefined ? Boolean(p.active) : true
        }));
      }
    } catch (e) {
      logger.warn(`[BugDeskService] Failed to fetch issue_priorities from ${host}: ${e.message}`);
    }

    // Fallback priorities if live fetch unavailable
    if (!priorities || priorities.length === 0) {
      priorities = [
        { id: 1, name: 'Low', is_default: false },
        { id: 2, name: 'Normal', is_default: true },
        { id: 3, name: 'High', is_default: false },
        { id: 4, name: 'Urgent', is_default: false },
        { id: 5, name: 'Immediate', is_default: false }
      ];
    }

    // Verified default for Priority: "Normal" or is_default: true
    const normalPriority = priorities.find(p => p.is_default || (p.name && p.name.trim().toLowerCase() === 'normal'));
    if (normalPriority) {
      defaultPriorityId = normalPriority.id;
    }

    // 3. Fetch Assignees (Project Memberships)
    const assignees = [{ id: '', name: 'Unassigned' }];
    let requiresApiKey = !effectiveApiKey;
    let assigneeError = null;

    if (effectiveApiKey) {
      try {
        const res = await fetch(`${host}/projects/${encodeURIComponent(projectId)}/memberships.json?limit=100`, {
          headers: {
            'Accept': 'application/json',
            'X-Redmine-API-Key': effectiveApiKey
          }
        });

        if (res.ok) {
          const data = await res.json();
          const userMap = new Map();

          (data?.memberships || []).forEach(m => {
            if (m.user && m.user.id && m.user.name) {
              userMap.set(String(m.user.id), {
                id: String(m.user.id),
                name: m.user.name.trim()
              });
            }
            if (m.group && m.group.id && m.group.name) {
              userMap.set(String(m.group.id), {
                id: String(m.group.id),
                name: `${m.group.name.trim()} (Group)`
              });
            }
          });

          const sortedUsers = Array.from(userMap.values()).sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
          );

          assignees.push(...sortedUsers);
          requiresApiKey = false;
        } else if (res.status === 401 || res.status === 403) {
          requiresApiKey = true;
          assigneeError = 'Redmine API key is invalid or unauthorized for this project.';
        } else {
          assigneeError = `Redmine responded with status ${res.status}.`;
        }
      } catch (err) {
        logger.warn(`[BugDeskService] Failed to fetch project memberships for ${projectId}: ${err.message}`);
        assigneeError = 'Could not reach Redmine to load assignees.';
      }
    }

    return {
      success: true,
      platform,
      projectId,
      host,
      statuses,
      defaultStatusId,
      priorities,
      defaultPriorityId,
      assignees,
      requiresApiKey,
      assigneeError
    };
  }

  async testPmsConnection({ apiKey, customUrl = null } = {}) {
    const key = (apiKey && typeof apiKey === 'string') ? apiKey.trim() : '';
    if (!key) {
      const err = new Error('Redmine API key is required.');
      err.status = 400;
      throw err;
    }

    let host = 'https://pms.optimumbrew.com';
    if (customUrl && typeof customUrl === 'string' && customUrl.trim()) {
      try {
        const parsed = new URL(customUrl.trim());
        host = parsed.origin;
      } catch (_) {}
    }

    try {
      const res = await fetch(`${host}/users/current.json`, {
        headers: {
          'Accept': 'application/json',
          'X-Redmine-API-Key': key
        }
      });

      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          return { connected: false, error: 'Invalid Redmine API key or unauthorized.' };
        }
        return { connected: false, error: `Redmine returned HTTP status ${res.status}.` };
      }

      const data = await res.json().catch(() => ({}));
      return {
        connected: true,
        user: data.user ? {
          id: data.user.id,
          name: `${data.user.firstname || ''} ${data.user.lastname || ''}`.trim() || data.user.login,
          login: data.user.login,
          mail: data.user.mail
        } : null
      };
    } catch (err) {
      logger.warn(`[BugDeskService] Redmine test connection error: ${err.message}`);
      return { connected: false, error: 'Could not connect to Redmine server. Check network connection.' };
    }
  }
}

module.exports = new BugDeskService();
