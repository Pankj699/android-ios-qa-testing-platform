const crypto = require('crypto');
const db = require('../db');
const logger = require('../utils/logger');
const mixpanelSpecificationService = require('../services/mixpanelSpecificationService');
const mixpanelCollectorService = require('../services/mixpanelCollectorService');
const { validateEvent } = require('../services/mixpanelValidationEngine');

class MixpanelController {
  /**
   * Get feature flag and integration status.
   */
  async getStatus(req, res, next) {
    try {
      const status = mixpanelCollectorService.isConfigured();
      return res.json({
        success: true,
        data: status
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Upload and parse an Excel workbook specification.
   */
  async uploadSpecification(req, res, next) {
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({
          success: false,
          error: 'No Excel file uploaded. Please upload a .xlsx workbook.'
        });
      }

      const buffer = req.file.buffer;
      const originalFilename = req.file.originalname || 'events_specification.xlsx';
      const fileHash = crypto.createHash('sha256').update(buffer).digest('hex');

      // Parse the workbook using our custom OpenXML parser
      const parsed = mixpanelSpecificationService.parseWorkbook(buffer, originalFilename);

      if (!parsed.rules || parsed.rules.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'No event definitions could be extracted from this Excel file.',
          details: parsed.warnings
        });
      }

      const specName = (req.body.name || originalFilename.replace(/\.[^/.]+$/, '')).trim();

      // Check for existing specification with same name for this user to increment version
      const existingRes = await db.query(
        `SELECT version FROM mixpanel_specifications
         WHERE user_id = $1 AND name = $2
         ORDER BY version DESC LIMIT 1`,
        [req.user.id, specName]
      );

      const nextVersion = existingRes.rows.length > 0 ? (existingRes.rows[0].version + 1) : 1;

      const insertRes = await db.query(
        `INSERT INTO mixpanel_specifications (
          user_id, name, version, original_filename, file_hash,
          sheets_summary, events_count, rules, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        RETURNING *`,
        [
          req.user.id,
          specName,
          nextVersion,
          originalFilename,
          fileHash,
          JSON.stringify(parsed.sheetsSummary),
          parsed.eventsCount,
          JSON.stringify(parsed.rules)
        ]
      );

      if (typeof db.saveToDisk === 'function') {
        await db.saveToDisk();
      }

      logger.info(`[MixpanelController] User ${req.user.id} uploaded specification "${specName}" v${nextVersion} with ${parsed.eventsCount} events.`);

      return res.status(201).json({
        success: true,
        data: insertRes.rows[0],
        warnings: parsed.warnings
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * List specifications belonging to the authenticated user.
   */
  async listSpecifications(req, res, next) {
    try {
      const query = req.user.role === 'ADMIN'
        ? `SELECT s.*, u.email as user_email, u.name as user_name
           FROM mixpanel_specifications s
           LEFT JOIN users u ON s.user_id = u.id
           ORDER BY s.created_at DESC`
        : `SELECT * FROM mixpanel_specifications
           WHERE user_id = $1
           ORDER BY created_at DESC`;

      const params = req.user.role === 'ADMIN' ? [] : [req.user.id];
      const result = await db.query(query, params);

      return res.json({
        success: true,
        data: result.rows
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Get single specification details.
   */
  async getSpecification(req, res, next) {
    try {
      const { id } = req.params;
      const result = await db.query('SELECT * FROM mixpanel_specifications WHERE id = $1', [id]);

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Specification not found.' });
      }

      const spec = result.rows[0];
      if (req.user.role !== 'ADMIN' && spec.user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      return res.json({
        success: true,
        data: spec
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Delete a specification.
   */
  async deleteSpecification(req, res, next) {
    try {
      const { id } = req.params;
      const checkRes = await db.query('SELECT user_id FROM mixpanel_specifications WHERE id = $1', [id]);

      if (checkRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Specification not found.' });
      }

      if (req.user.role !== 'ADMIN' && checkRes.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      await db.query('DELETE FROM mixpanel_specifications WHERE id = $1', [id]);

      if (typeof db.saveToDisk === 'function') {
        await db.saveToDisk();
      }

      return res.json({
        success: true,
        message: 'Specification deleted successfully.'
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Start capture session.
   */
  async startSession(req, res, next) {
    try {
      const { deviceSerial, deviceName, specId, distinctId, projectId } = req.body;

      if (!deviceSerial) {
        return res.status(400).json({ success: false, error: 'deviceSerial is required.' });
      }

      const session = await mixpanelCollectorService.startSession({
        user: req.user,
        deviceSerial,
        deviceName,
        specId,
        distinctId,
        projectId
      });

      return res.status(201).json({
        success: true,
        data: session
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({
          success: false,
          error: err.message,
          code: err.code || (err.statusCode === 409 ? 'CAPTURE_DEVICE_CONFLICT' : undefined)
        });
      }
      return next(err);
    }
  }

  /**
   * List sessions belonging to user.
   */
  async listSessions(req, res, next) {
    try {
      const query = req.user.role === 'ADMIN'
        ? `SELECT s.*, sp.name as spec_name, u.email as user_email
           FROM mixpanel_sessions s
           LEFT JOIN mixpanel_specifications sp ON s.spec_id = sp.id
           LEFT JOIN users u ON s.user_id = u.id
           ORDER BY s.started_at DESC`
        : `SELECT s.*, sp.name as spec_name
           FROM mixpanel_sessions s
           LEFT JOIN mixpanel_specifications sp ON s.spec_id = sp.id
           WHERE s.user_id = $1
           ORDER BY s.started_at DESC`;

      const params = req.user.role === 'ADMIN' ? [] : [req.user.id];
      const result = await db.query(query, params);

      return res.json({
        success: true,
        data: result.rows
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Get single session details.
   */
  async getSession(req, res, next) {
    try {
      const { id } = req.params;
      const result = await db.query(
        `SELECT s.*, sp.name as spec_name, sp.rules as spec_rules
         FROM mixpanel_sessions s
         LEFT JOIN mixpanel_specifications sp ON s.spec_id = sp.id
         WHERE s.id = $1`,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Session not found.' });
      }

      const session = result.rows[0];
      if (req.user.role !== 'ADMIN' && session.user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      return res.json({
        success: true,
        data: session
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Stop an active session.
   */
  async stopSession(req, res, next) {
    try {
      const { id } = req.params;
      const session = await mixpanelCollectorService.stopSession(id, req.user);

      return res.json({
        success: true,
        data: session
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      return next(err);
    }
  }

  /**
   * Get paginated events for a session.
   */
  async getSessionEvents(req, res, next) {
    try {
      const { id } = req.params;
      const { search, status, source, limit = 100, offset = 0 } = req.query;

      // Ownership check on session
      const sessionRes = await db.query('SELECT user_id FROM mixpanel_sessions WHERE id = $1', [id]);
      if (sessionRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Session not found.' });
      }

      if (req.user.role !== 'ADMIN' && sessionRes.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      let whereClauses = ['session_id = $1'];
      let params = [id];

      if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        whereClauses.push(`LOWER(event_name) LIKE $${params.length}`);
      }

      if (status && status.trim() && status !== 'ALL') {
        params.push(status.trim().toUpperCase());
        whereClauses.push(`validation_status = $${params.length}`);
      }

      if (source && source.trim() && source !== 'ALL') {
        params.push(source.trim().toUpperCase());
        whereClauses.push(`source = $${params.length}`);
      }

      const whereSql = whereClauses.join(' AND ');

      // Count query
      const countRes = await db.query(
        `SELECT COUNT(*) as total FROM mixpanel_events WHERE ${whereSql}`,
        params
      );
      const total = parseInt(countRes.rows[0].total, 10);

      // Data query
      const parsedLimit = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
      const parsedOffset = Math.max(0, parseInt(offset, 10) || 0);

      const dataParams = [...params, parsedLimit, parsedOffset];
      const dataRes = await db.query(
        `SELECT * FROM mixpanel_events
         WHERE ${whereSql}
         ORDER BY event_time DESC, created_at DESC
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams
      );

      return res.json({
        success: true,
        data: {
          events: dataRes.rows,
          total,
          limit: parsedLimit,
          offset: parsedOffset
        }
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Delete all recorded events within a session.
   */
  async clearSessionEvents(req, res, next) {
    try {
      const { id } = req.params;

      // Ownership check on session
      const sessionRes = await db.query('SELECT user_id FROM mixpanel_sessions WHERE id = $1', [id]);
      if (sessionRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'Session not found.' });
      }

      if (req.user.role !== 'ADMIN' && sessionRes.rows[0].user_id !== req.user.id) {
        return res.status(403).json({ success: false, error: 'Access denied.' });
      }

      // Delete all events for this session
      const deleteRes = await db.query(
        'DELETE FROM mixpanel_events WHERE session_id = $1 RETURNING id',
        [id]
      );
      const deletedCount = deleteRes.rowCount || deleteRes.rows.length;

      // Reset events count on session record
      await db.query(
        'UPDATE mixpanel_sessions SET events_count = 0 WHERE id = $1',
        [id]
      );

      if (typeof db.saveToDisk === 'function') {
        await db.saveToDisk();
      }

      logger.info(`[MixpanelController] User ${req.user.id} cleared ${deletedCount} events from session ${id}`);

      return res.json({
        success: true,
        message: 'All recorded events cleared for session.',
        data: {
          deletedCount
        }
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * Revalidate an event.
   */
  async revalidateEvent(req, res, next) {
    try {
      const { id, eventId } = req.params;
      const customSpecId = req.body?.specId || null;

      const updated = await mixpanelCollectorService.revalidateEvent(id, eventId, req.user, customSpecId);

      return res.json({
        success: true,
        data: updated
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      return next(err);
    }
  }

  /**
   * Manually inject an event into session.
   */
  async injectEvent(req, res, next) {
    try {
      const { id } = req.params;
      const payload = req.body;

      const result = await mixpanelCollectorService.injectEvent(id, req.user, payload);

      return res.status(201).json({
        success: true,
        data: result
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      return next(err);
    }
  }

  /**
   * Ad-hoc validation of raw payload against a specification.
   */
  async validateRaw(req, res, next) {
    try {
      const { rawPayload, specId, rules } = req.body;

      if (!rawPayload || typeof rawPayload !== 'object') {
        return res.status(400).json({ success: false, error: 'rawPayload object is required.' });
      }

      let specRules = rules;
      if (!specRules && specId) {
        const specRes = await db.query('SELECT rules FROM mixpanel_specifications WHERE id = $1', [specId]);
        if (specRes.rows.length > 0 && Array.isArray(specRes.rows[0].rules)) {
          specRules = specRes.rows[0].rules;
        }
      }

      if (!Array.isArray(specRules)) {
        specRules = [];
      }

      const summary = validateEvent(rawPayload, specRules);

      return res.json({
        success: true,
        data: summary
      });
    } catch (err) {
      return next(err);
    }
  }
}

module.exports = new MixpanelController();
