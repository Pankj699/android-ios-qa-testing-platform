const config = require('../config');
const userService = require('../services/userService');
const logger = require('../utils/logger');
const { extractTokenFromRequest } = require('../middleware/auth');

class AuthController {
  _setSessionCookie(res, sessionToken) {
    if (!res || !sessionToken) return;
    const isSecure = config.USE_HTTPS || config.NODE_ENV === 'production';
    const maxAgeSec = Math.floor(config.SESSION_MAX_AGE_MS / 1000);
    const cookieOpts = `Path=/; Max-Age=${maxAgeSec}; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `qa_session=${encodeURIComponent(sessionToken)}; ${cookieOpts}`
    ]);
  }

  _clearSessionCookie(res) {
    if (!res) return;
    const isSecure = config.USE_HTTPS || config.NODE_ENV === 'production';
    const cookieOpts = `Path=/; Max-Age=0; HttpOnly; SameSite=Lax${isSecure ? '; Secure' : ''}`;
    res.setHeader('Set-Cookie', [
      `qa_session=; ${cookieOpts}`,
      `qa_auth_token=; Path=/; Max-Age=0; SameSite=Lax`,
      `token=; Path=/; Max-Age=0; SameSite=Lax`
    ]);
  }

  _getClientMeta(req) {
    const rawIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket?.remoteAddress || req.ip || '127.0.0.1';
    const cleanIp = rawIp.replace(/^::ffff:/, '');
    const userAgent = req.headers['user-agent'] || 'unknown';
    return { ip: cleanIp, userAgent };
  }

  /**
   * POST /api/auth/register
   * Normal registration creates users with role = 'TESTER'.
   */
  async register(req, res, next) {
    try {
      const { email, password, name } = req.body || {};
      const user = await userService.register({ email, password, name });

      // Automatically establish session upon registration
      const meta = this._getClientMeta(req);
      const session = await userService.createSession(user.id, meta);
      this._setSessionCookie(res, session.sessionToken);

      res.status(201).json({
        success: true,
        message: 'Account registered successfully.',
        user
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      next(err);
    }
  }

  /**
   * POST /api/auth/login
   * Authenticates credentials, creates server session, and sets HttpOnly cookie.
   */
  async login(req, res, next) {
    try {
      const { email, username, password } = req.body || {};
      const targetEmail = (email || username || '').trim();

      if (!targetEmail || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required.'
        });
      }

      const meta = this._getClientMeta(req);
      const user = await userService.authenticate(targetEmail, password, meta);
      const session = await userService.createSession(user.id, meta);

      this._setSessionCookie(res, session.sessionToken);

      logger.info(`[Auth] User logged in: ${user.name} (${user.id})`);
      res.json({
        success: true,
        message: 'Authenticated successfully.',
        user
      });
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      next(err);
    }
  }

  /**
   * GET /api/auth/me
   * Returns current authenticated user profile.
   */
  async me(req, res, next) {
    try {
      if (!req.user || req.user.id === 'default_user') {
        return res.status(401).json({
          success: false,
          authenticated: false,
          error: 'Not authenticated.'
        });
      }

      res.json({
        success: true,
        authenticated: true,
        user: req.user
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/logout
   * Revokes user session and clears cookies.
   * CRITICAL: MUST NOT release active or persistent device claims (DeviceLockService lifecycle is frozen).
   */
  async logout(req, res, next) {
    try {
      const token = extractTokenFromRequest(req);
      if (token) {
        await userService.revokeSession(token);
      }

      this._clearSessionCookie(res);
      logger.info(`[Auth] User logged out: ${req.user?.name || req.user?.id || 'session'}`);

      res.json({
        success: true,
        message: 'Logged out successfully.'
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/forgot-password
   * Generic response to prevent user enumeration.
   */
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body || {};
      const meta = this._getClientMeta(req);
      const result = await userService.requestPasswordReset(email, meta);

      res.json(result);
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/auth/reset-password
   * Resets password using single-use cryptographic token and invalidates all existing sessions.
   */
  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body || {};
      const result = await userService.resetPassword(token, newPassword);

      // Clear any lingering session cookies
      this._clearSessionCookie(res);

      res.json(result);
    } catch (err) {
      if (err.statusCode) {
        return res.status(err.statusCode).json({ success: false, error: err.message });
      }
      next(err);
    }
  }
}

module.exports = new AuthController();
