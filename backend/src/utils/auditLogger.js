/**
 * Structured Security Audit Logger.
 * Records security-critical actions safely without exposing secrets, JWTs, or passwords.
 */
const logger = require('./logger');

class AuditLogger {
  constructor() {
    this.events = [];
  }

  logEvent(event, data = {}) {
    const record = {
      audit: true,
      timestamp: new Date().toISOString(),
      event,
      eventType: event,
      userId: data.userId || null,
      userEmail: data.userEmail || null,
      agentId: data.agentId || null,
      deviceId: data.deviceId || null,
      action: data.action || null,
      status: data.status || 'SUCCESS',
      ip: data.ip || '127.0.0.1',
      details: data.details || {},
      metadata: data
    };

    // Sanitize any accidentally passed secrets in details
    if (record.details.password) delete record.details.password;
    if (record.details.token) delete record.details.token;
    if (record.details.jwt) delete record.details.jwt;
    if (record.details.agentToken) delete record.details.agentToken;

    this.events.push(record);
    if (this.events.length > 500) {
      this.events.shift();
    }

    logger.info(`[AUDIT] [${record.event}] [${record.status}] user=${record.userEmail || record.userId || 'anon'} agent=${record.agentId || 'none'} device=${record.deviceId || 'none'}`);
  }

  getRecentEvents(limit = 50) {
    return this.events.slice(-limit);
  }
}

module.exports = new AuditLogger();
