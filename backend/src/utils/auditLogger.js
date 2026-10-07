/**
 * Structured Security Audit Logger.
 * Records security-critical actions safely without exposing secrets, JWTs, or passwords.
 */
const logger = require('./logger');

class AuditLogger {
  logEvent(event, data = {}) {
    const record = {
      audit: true,
      timestamp: new Date().toISOString(),
      event,
      userId: data.userId || null,
      userEmail: data.userEmail || null,
      agentId: data.agentId || null,
      deviceId: data.deviceId || null,
      action: data.action || null,
      status: data.status || 'SUCCESS',
      ip: data.ip || '127.0.0.1',
      details: data.details || {}
    };

    // Sanitize any accidentally passed secrets in details
    if (record.details.password) delete record.details.password;
    if (record.details.token) delete record.details.token;
    if (record.details.jwt) delete record.details.jwt;
    if (record.details.agentToken) delete record.details.agentToken;

    logger.info(`[AUDIT] [${record.event}] [${record.status}] user=${record.userEmail || record.userId || 'anon'} agent=${record.agentId || 'none'} device=${record.deviceId || 'none'}`);
  }
}

module.exports = new AuditLogger();
