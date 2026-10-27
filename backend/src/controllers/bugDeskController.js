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

  async getDevices(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required to access device catalog.' });
      }
      const devices = await bugDeskService.getAllDevices();
      return res.json({ success: true, devices });
    } catch (err) {
      logger.warn(`[BugDeskController] getDevices failed: ${err.message}`);
      const status = err.status || 500;
      return res.status(status).json({ success: false, error: err.message || 'Failed to fetch device catalog.' });
    }
  }

  async createDevice(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required to add device.' });
      }
      const { name, os, manufacturer, model } = req.body || {};
      const device = await bugDeskService.createDevice({
        name,
        os,
        manufacturer,
        model,
        userId: req.user.id
      });
      return res.status(201).json({ success: true, device });
    } catch (err) {
      logger.warn(`[BugDeskController] createDevice failed: ${err.message}`);
      const status = err.status || 500;
      return res.status(status).json({ success: false, error: err.message || 'Failed to add device.' });
    }
  }

  async updateDevice(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required to update device.' });
      }
      const { id } = req.params;
      const { name, os, manufacturer, model } = req.body || {};
      const device = await bugDeskService.updateDevice(id, { name, os, manufacturer, model });
      return res.json({ success: true, device });
    } catch (err) {
      logger.warn(`[BugDeskController] updateDevice failed: ${err.message}`);
      const status = err.status || 500;
      return res.status(status).json({ success: false, error: err.message || 'Failed to update device.' });
    }
  }

  async deleteDevice(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required to delete device.' });
      }
      const { id } = req.params;
      const result = await bugDeskService.deleteDevice(id);
      return res.json(result);
    } catch (err) {
      logger.warn(`[BugDeskController] deleteDevice failed: ${err.message}`);
      const status = err.status || 500;
      return res.status(status).json({ success: false, error: err.message || 'Failed to delete device.' });
    }
  }

  async getPmsOptions(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, error: 'Authentication required to access PMS options.' });
      }

      const platform = req.query.platform || req.body?.platform || 'android';
      const customUrl = req.query.customUrl || req.body?.customUrl || null;
      const apiKey = req.headers['x-redmine-api-key'] || req.headers['x-pms-api-key'] || null;

      const result = await bugDeskService.getPmsOptions({ platform, customUrl, apiKey });
      return res.json(result);
    } catch (err) {
      logger.warn(`[BugDeskController] getPmsOptions failed: ${err.message}`);
      const status = err.status || 500;
      return res.status(status).json({ success: false, error: err.message || 'Failed to fetch PMS options.' });
    }
  }

  async testPmsConnection(req, res, next) {
    try {
      if (!req.user) {
        return res.status(401).json({ connected: false, error: 'Authentication required to test PMS connection.' });
      }

      const apiKey = req.body?.apiKey || req.headers['x-redmine-api-key'] || null;
      const customUrl = req.body?.customUrl || null;

      const result = await bugDeskService.testPmsConnection({ apiKey, customUrl });
      return res.json(result);
    } catch (err) {
      logger.warn(`[BugDeskController] testPmsConnection failed: ${err.message}`);
      const status = err.status || 500;
      return res.status(status).json({ connected: false, error: err.message || 'Failed to test PMS connection.' });
    }
  }
}

module.exports = new BugDeskController();
