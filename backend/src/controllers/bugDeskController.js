const bugDeskService = require('../services/bugDeskService');
const logger = require('../utils/logger');

class BugDeskController {
  async rewriteBug(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ error: 'Authentication required to access Bug Desk services.' });
      }

      const { rawNotes, apiKey, model } = req.body || {};
      const result = await bugDeskService.rewriteBug({ rawNotes, apiKey, model });
      return res.json(result);
    } catch (err) {
      logger.warn(`[BugDeskController] rewriteBug failed: ${err.message}`);
      const status = err.status || 500;
      return res.status(status).json({ error: err.message || 'Unexpected server error.' });
    }
  }

  async testConnection(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ connected: false, error: 'Authentication required to test AI connection.' });
      }

      const { apiKey, model } = req.body || {};
      const result = await bugDeskService.testConnection({ apiKey, model });
      return res.json(result);
    } catch (err) {
      logger.warn(`[BugDeskController] testConnection failed: ${err.message}`);
      const status = err.status || 500;
      return res.status(status).json({ connected: false, error: err.message || 'Unexpected server error.' });
    }
  }
}

module.exports = new BugDeskController();
