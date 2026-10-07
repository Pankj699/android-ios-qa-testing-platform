const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');
const userService = require('../services/userService');

// Public endpoints that do not require an active session or token
const PUBLIC_PATHS = [
  '/auth/login',
  '/api/auth/login',
  '/auth/register',
  '/api/auth/register',
  '/auth/forgot-password',
  '/api/auth/forgot-password',
  '/auth/reset-password',
  '/api/auth/reset-password',
  '/system/diagnostics',
  '/api/system/diagnostics',
  '/system/env',
  '/api/system/env',
  '/agent/pair',
  '/api/agent/pair',
  '/agent/download',
  '/api/agent/download'
];

/**
 * Helper to extract session token or JWT from Cookie, Authorization header, or Query parameter.
 */
function extractTokenFromRequest(req) {
  if (!req) return null;

  // 1. Authorization header (Bearer <token>)
  const authHeader = req.headers?.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const bearer = authHeader.slice(7).trim();
    if (bearer) return bearer;
  }

  // 2. Cookie header: check qa_session first, then legacy tokens
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    const cookies = cookieHeader.split(';');
    for (const c of cookies) {
      const trimmed = c.trim();
      if (trimmed.startsWith('qa_session=')) {
        const val = decodeURIComponent(trimmed.slice('qa_session='.length));
        if (val) return val;
      }
      if (trimmed.startsWith('qa_auth_token=')) {
        const val = decodeURIComponent(trimmed.slice('qa_auth_token='.length));
        if (val) return val;
      }
      if (trimmed.startsWith('qa_tools_auth_token_jwt=')) {
        const val = decodeURIComponent(trimmed.slice('qa_tools_auth_token_jwt='.length));
        if (val) return val;
      }
      if (trimmed.startsWith('token=')) {
        const val = decodeURIComponent(trimmed.slice('token='.length));
        if (val) return val;
      }
    }
  }

  // 3. Query parameter (?token=...)
  if (req.query && req.query.token) {
    return req.query.token;
  }

  return null;
}

/**
 * Native Authentication middleware.
 * - Handles JWT tokens synchronously (preserving existing test assertions and API compatibility).
 * - Handles native server-side session tokens (qa_session) via database lookup.
 */
function authenticate(req, res, next) {
  const token = extractTokenFromRequest(req);
  const path = req.path || '';
  const isPublic = PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'));

  if (isPublic) {
    if (!token) {
      return next();
    }
    // Optional user attachment for public endpoints
    if (typeof token === 'string' && token.split('.').length === 3) {
      try {
        const decoded = jwt.verify(token, config.JWT_SECRET);
        req.user = {
          id: decoded.id || decoded.userId || decoded.sub,
          name: decoded.name || decoded.username || 'QA Tester',
          email: decoded.email || '',
          role: (decoded.role || 'TESTER').toUpperCase()
        };
      } catch (e) {}
      return next();
    }
    userService.validateSession(token)
      .then(u => {
        if (u) req.user = u;
        next();
      })
      .catch(() => next());
    return;
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      authenticated: false,
      error: 'Authentication required. Please sign in.'
    });
  }

  // 1. JWT verification (Synchronous path for unit tests and API callers)
  if (typeof token === 'string' && token.split('.').length === 3) {
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      if (decoded.role === 'device_agent' || (decoded.role || '').toUpperCase() === 'DEVICE_AGENT') {
        logger.warn(`Agent token attempted user API access at ${path}`);
        return res.status(403).json({
          success: false,
          error: 'Forbidden. Agent tokens cannot be used to authenticate user sessions.'
        });
      }
      req.user = {
        id: decoded.id || decoded.userId || decoded.sub,
        name: decoded.name || decoded.username || 'QA Tester',
        email: decoded.email || '',
        role: (decoded.role || 'TESTER').toUpperCase()
      };
      return next();
    } catch (err) {
      logger.warn(`JWT verification failed for path ${path}: ${err.message}`);
      return res.status(401).json({
        success: false,
        authenticated: false,
        error: 'Invalid or expired session. Please sign in again.'
      });
    }
  }

  // 2. Server-side session verification in Database
  userService.validateSession(token)
    .then(sessionUser => {
      if (sessionUser) {
        req.user = {
          id: sessionUser.id,
          name: sessionUser.name,
          email: sessionUser.email,
          role: sessionUser.role
        };
        req.session = sessionUser;
        return next();
      }

      logger.warn(`Session token lookup failed for path ${path}`);
      return res.status(401).json({
        success: false,
        authenticated: false,
        error: 'Invalid or expired session. Please sign in again.'
      });
    })
    .catch(err => {
      logger.error(`[Auth] Session validation error: ${err.message}`);
      return res.status(401).json({
        success: false,
        authenticated: false,
        error: 'Invalid or expired session. Please sign in again.'
      });
    });
}

/**
 * Verify token for WebSocket handshake
 */
function verifySocketToken(token, req = null) {
  if (token) {
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET);
      if (decoded.role === 'device_agent' || (decoded.role || '').toUpperCase() === 'DEVICE_AGENT') {
        return null;
      }
      return {
        id: decoded.id || decoded.userId || decoded.sub,
        name: decoded.name || decoded.username || 'QA Tester',
        email: decoded.email || '',
        role: (decoded.role || 'TESTER').toUpperCase()
      };
    } catch (e) {}
  }

  // Fallback to qa_session cookie in WebSocket handshake request
  if (req && req.headers?.cookie) {
    const cookies = req.headers.cookie.split(';');
    for (const c of cookies) {
      const trimmed = c.trim();
      if (trimmed.startsWith('qa_session=')) {
        const sessionToken = decodeURIComponent(trimmed.slice('qa_session='.length));
        return userService.validateSessionSync(sessionToken);
      }
    }
  }

  return null;
}

/**
 * Role-based authorization middleware
 */
function requireRole(allowedRoles = []) {
  const normalizedAllowed = allowedRoles.map(r => r.toUpperCase());
  return (req, res, next) => {
    const userRole = (req.user?.role || '').toUpperCase();
    if (!req.user || (!normalizedAllowed.includes(userRole) && userRole !== 'ADMIN')) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden. Insufficient permissions for this resource.'
      });
    }
    next();
  };
}

module.exports = {
  authenticate,
  verifySocketToken,
  extractTokenFromRequest,
  requireRole,
  PUBLIC_PATHS
};
