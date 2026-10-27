const remoteConfigService = require('../services/remoteConfigService');
const logger = require('../utils/logger');

function resolveErrorStatus(err) {
  if (err.statusCode && typeof err.statusCode === 'number') {
    return err.statusCode;
  }
  if (err.type === 'UPSTREAM_404') return 404;
  if (err.type === 'UPSTREAM_AUTH') return 401;
  if (err.type === 'TIMEOUT') return 504;
  if (err.type === 'UPSTREAM_UNAVAILABLE') return 502;
  if (err.type === 'UPSTREAM_VALIDATION_ERROR') return 422;
  if (err.type === 'VALIDATION_ERROR') return 400;

  const msg = err.message || '';
  if (msg.includes('Unsupported platform') || msg.includes('Invalid') || msg.includes('required')) {
    return 400;
  }
  return 502;
}

class RemoteConfigController {
  async getApplications(req, res, next) {
    try {
      const platform = (req.query.platform || 'android').toString().trim().toLowerCase();
      const applications = await remoteConfigService.getApplications(platform);
      return res.json({
        success: true,
        platform,
        count: applications.length,
        applications
      });
    } catch (err) {
      logger.error(`[RemoteConfigController.getApplications] Error (${err.type || 'UNKNOWN'}): ${err.message}`);
      const status = resolveErrorStatus(err);
      return res.status(status).json({
        success: false,
        type: err.type || 'ERROR',
        error: err.message
      });
    }
  }

  async getConfigs(req, res, next) {
    try {
      const platform = (req.query.platform || 'android').toString().trim().toLowerCase();
      const app = (req.query.app || req.query.application || '').toString().trim();

      const targetKey = (req.query.key || '').toString().trim();
      const targetId = req.query.id ? parseInt(req.query.id, 10) : null;

      if (!app) {
        return res.status(400).json({
          success: false,
          type: 'VALIDATION_ERROR',
          error: "Application slug ('app') is required."
        });
      }

      const result = await remoteConfigService.getConfigs(platform, app);
      let matchedConfig = null;
      if (targetId) {
        matchedConfig = result.configs.find(c => c.id === targetId);
      }
      if (!matchedConfig && targetKey) {
        const normKey = targetKey.toLowerCase();
        matchedConfig = result.configs.find(c => (c.key || '').toLowerCase() === normKey);
      }

      return res.json({
        success: true,
        ...result,
        ...(matchedConfig ? { config: matchedConfig } : {})
      });
    } catch (err) {
      logger.error(`[RemoteConfigController.getConfigs] Error (${err.type || 'UNKNOWN'}): ${err.message}`);
      const status = resolveErrorStatus(err);
      return res.status(status).json({
        success: false,
        type: err.type || 'ERROR',
        error: err.message
      });
    }
  }

  async createConfig(req, res, next) {
    try {
      const { platform, app, key, type, value, is_active } = req.body || {};

      if (!platform) {
        return res.status(400).json({ success: false, type: 'VALIDATION_ERROR', error: "Platform ('android' or 'ios') is required." });
      }
      if (!app) {
        return res.status(400).json({ success: false, type: 'VALIDATION_ERROR', error: 'Application slug is required.' });
      }
      if (!key) {
        return res.status(400).json({ success: false, type: 'VALIDATION_ERROR', error: 'Configuration key is required.' });
      }

      const created = await remoteConfigService.createConfig(platform, app, {
        key,
        type,
        value,
        is_active
      });

      return res.status(201).json({
        success: true,
        message: `Remote Config '${created.key}' created successfully.`,
        config: created
      });
    } catch (err) {
      logger.error(`[RemoteConfigController.createConfig] Error (${err.type || 'UNKNOWN'}): ${err.message}`);
      const status = resolveErrorStatus(err);
      return res.status(status).json({
        success: false,
        type: err.type || 'ERROR',
        error: err.message
      });
    }
  }

  async updateConfig(req, res, next) {
    try {
      const { id } = req.params;
      const { platform, app, key, type, value, is_active } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, type: 'VALIDATION_ERROR', error: 'Configuration ID is required.' });
      }
      if (!platform || !app) {
        return res.status(400).json({ success: false, type: 'VALIDATION_ERROR', error: 'Platform and application are required.' });
      }

      const updated = await remoteConfigService.updateConfig(platform, app, id, {
        key,
        type,
        value,
        is_active
      });

      return res.json({
        success: true,
        message: `Remote Config '${updated.key}' updated successfully.`,
        config: updated
      });
    } catch (err) {
      logger.error(`[RemoteConfigController.updateConfig] Error (${err.type || 'UNKNOWN'}): ${err.message}`);
      const status = resolveErrorStatus(err);
      return res.status(status).json({
        success: false,
        type: err.type || 'ERROR',
        error: err.message
      });
    }
  }

  async toggleActive(req, res, next) {
    try {
      const { id } = req.params;
      const { platform, app, is_active } = req.body || {};

      if (!id) {
        return res.status(400).json({ success: false, type: 'VALIDATION_ERROR', error: 'Configuration ID is required.' });
      }
      if (!platform || !app) {
        return res.status(400).json({ success: false, type: 'VALIDATION_ERROR', error: 'Platform and application are required.' });
      }

      const updated = await remoteConfigService.toggleActive(platform, app, id, is_active);

      return res.json({
        success: true,
        message: `Remote Config '${updated.key}' is now ${updated.active ? 'ACTIVE' : 'INACTIVE'}.`,
        config: updated
      });
    } catch (err) {
      logger.error(`[RemoteConfigController.toggleActive] Error (${err.type || 'UNKNOWN'}): ${err.message}`);
      const status = resolveErrorStatus(err);
      return res.status(status).json({
        success: false,
        type: err.type || 'ERROR',
        error: err.message
      });
    }
  }

  async deleteConfig(req, res, next) {
    try {
      const { id } = req.params;
      const platform = req.body?.platform || req.query?.platform;
      const app = req.body?.app || req.query?.app;

      if (!id) {
        return res.status(400).json({ success: false, type: 'VALIDATION_ERROR', error: 'Configuration ID is required.' });
      }
      if (!platform || !app) {
        return res.status(400).json({ success: false, type: 'VALIDATION_ERROR', error: 'Platform and application are required.' });
      }

      const result = await remoteConfigService.deleteConfig(platform, app, id);

      return res.json({
        success: true,
        ...result
      });
    } catch (err) {
      logger.error(`[RemoteConfigController.deleteConfig] Error (${err.type || 'UNKNOWN'}): ${err.message}`);
      const status = resolveErrorStatus(err);
      return res.status(status).json({
        success: false,
        type: err.type || 'ERROR',
        error: err.message
      });
    }
  }
}

module.exports = new RemoteConfigController();
