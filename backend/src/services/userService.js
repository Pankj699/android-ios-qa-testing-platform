const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const logger = require('../utils/logger');
const auditLogger = require('../utils/auditLogger');

const VALID_ROLES = ['ADMIN', 'EDITOR', 'TESTER', 'DEVELOPER', 'VIEWER'];
const BCRYPT_SALT_ROUNDS = 12;

class UserService {
  constructor(customDb = null) {
    this.db = customDb || db;
    this._sessionCache = new Map(); // tokenHash -> { user, expiresAt }
  }

  _query(text, params) {
    return this.db.query(text, params);
  }

  _hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async hashPassword(password) {
    return bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
  }

  async verifyPassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  validatePasswordStrength(password) {
    if (!password || typeof password !== 'string') {
      return { valid: false, error: 'Password is required.' };
    }
    if (password.length < 8) {
      return { valid: false, error: 'Password must be at least 8 characters long.' };
    }
    if (password.length > 128) {
      return { valid: false, error: 'Password must be fewer than 128 characters.' };
    }
    return { valid: true };
  }

  validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return { valid: false, error: 'Email is required.' };
    }
    const normalized = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalized)) {
      return { valid: false, error: 'Please enter a valid email address.' };
    }
    return { valid: true, email: normalized };
  }

  /**
   * Register a new user. Default role is ALWAYS 'TESTER'.
   */
  async register({ email, password, name }) {
    const emailCheck = this.validateEmail(email);
    if (!emailCheck.valid) {
      const err = new Error(emailCheck.error);
      err.statusCode = 400;
      throw err;
    }
    const normalizedEmail = emailCheck.email;

    const passCheck = this.validatePasswordStrength(password);
    if (!passCheck.valid) {
      const err = new Error(passCheck.error);
      err.statusCode = 400;
      throw err;
    }

    const trimmedName = (name || '').trim();
    if (!trimmedName || trimmedName.length < 2) {
      const err = new Error('Name must be at least 2 characters long.');
      err.statusCode = 400;
      throw err;
    }

    // Check email uniqueness
    const existing = await this._query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      const err = new Error('An account with this email already exists.');
      err.statusCode = 409;
      throw err;
    }

    const passwordHash = await this.hashPassword(password);
    const assignedRole = 'TESTER';

    const insertResult = await this._query(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       RETURNING id, email, name, role, status, created_at, updated_at`,
      [normalizedEmail, passwordHash, trimmedName, assignedRole]
    );

    const user = insertResult.rows[0];
    auditLogger.logEvent('USER_REGISTER', {
      userId: user.id,
      userEmail: user.email,
      action: 'REGISTER',
      status: 'SUCCESS'
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
      createdAt: user.created_at
    };
  }

  /**
   * Authenticate user credentials.
   */
  async authenticate(email, password, clientMeta = {}) {
    const emailCheck = this.validateEmail(email);
    if (!emailCheck.valid || !password) {
      const err = new Error('Email and password are required.');
      err.statusCode = 400;
      throw err;
    }
    const normalizedEmail = emailCheck.email;

    const res = await this._query(
      'SELECT id, email, password_hash, name, role, status FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (res.rows.length === 0) {
      auditLogger.logEvent('USER_LOGIN', {
        userEmail: normalizedEmail,
        action: 'LOGIN',
        status: 'FAILED',
        ip: clientMeta.ip || '127.0.0.1'
      });
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      throw err;
    }

    const user = res.rows[0];

    if (user.status !== 'ACTIVE') {
      auditLogger.logEvent('USER_LOGIN', {
        userId: user.id,
        userEmail: user.email,
        action: 'LOGIN',
        status: 'DEACTIVATED',
        ip: clientMeta.ip || '127.0.0.1'
      });
      const err = new Error('This account has been deactivated. Please contact an administrator.');
      err.statusCode = 403;
      throw err;
    }

    const isValid = await this.verifyPassword(password, user.password_hash);
    if (!isValid) {
      auditLogger.logEvent('USER_LOGIN', {
        userId: user.id,
        userEmail: user.email,
        action: 'LOGIN',
        status: 'FAILED',
        ip: clientMeta.ip || '127.0.0.1'
      });
      const err = new Error('Invalid email or password.');
      err.statusCode = 401;
      throw err;
    }

    // Update last login timestamp
    await this._query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    auditLogger.logEvent('USER_LOGIN', {
      userId: user.id,
      userEmail: user.email,
      action: 'LOGIN',
      status: 'SUCCESS',
      ip: clientMeta.ip || '127.0.0.1'
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status
    };
  }

  /**
   * Create a persistent server-side session for a user.
   */
  async createSession(userId, { ip = '127.0.0.1', userAgent = '' } = {}) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this._hashToken(rawToken);
    const expiresAt = new Date(Date.now() + config.SESSION_MAX_AGE_MS);

    await this._query(
      `INSERT INTO user_sessions (user_id, token_hash, ip_address, user_agent, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, tokenHash, ip, userAgent, expiresAt]
    );

    // Warm session cache for sync/WebSocket lookups
    try {
      const userRes = await this._query('SELECT id, email, name, role, status FROM users WHERE id = $1', [userId]);
      if (userRes.rows.length > 0) {
        const u = userRes.rows[0];
        this._sessionCache.set(tokenHash, {
          user: {
            id: u.id,
            email: u.email,
            name: u.name,
            role: (u.role || 'TESTER').toUpperCase(),
            status: u.status
          },
          expiresAt
        });
      }
    } catch (e) {}

    return {
      sessionToken: rawToken,
      expiresAt
    };
  }

  /**
   * Synchronously validate a session token from memory cache (ideal for WebSocket handshake).
   */
  validateSessionSync(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return null;
    const tokenHash = this._hashToken(rawToken.trim());
    const cached = this._sessionCache.get(tokenHash);
    if (!cached) return null;
    if (new Date(cached.expiresAt) < new Date() || cached.user.status !== 'ACTIVE') {
      this._sessionCache.delete(tokenHash);
      return null;
    }
    return cached.user;
  }

  /**
   * Validate a session token and retrieve user profile.
   */
  async validateSession(rawToken) {
    if (!rawToken || typeof rawToken !== 'string') return null;

    const tokenHash = this._hashToken(rawToken.trim());

    // Check fast cache first
    const cached = this._sessionCache.get(tokenHash);
    if (cached) {
      if (new Date(cached.expiresAt) >= new Date() && cached.user.status === 'ACTIVE') {
        return cached.user;
      }
      this._sessionCache.delete(tokenHash);
    }

    const res = await this._query(
      `SELECT s.id as session_id, s.expires_at, u.id, u.email, u.name, u.role, u.status
       FROM user_sessions s
       JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1`,
      [tokenHash]
    );

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    const now = new Date();

    if (new Date(row.expires_at) < now) {
      // Clean up expired session
      await this._query('DELETE FROM user_sessions WHERE id = $1', [row.session_id]);
      this._sessionCache.delete(tokenHash);
      return null;
    }

    if (row.status !== 'ACTIVE') {
      this._sessionCache.delete(tokenHash);
      return null;
    }

    const userProfile = {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role.toUpperCase(),
      status: row.status,
      sessionId: row.session_id
    };

    // Populate cache
    this._sessionCache.set(tokenHash, {
      user: userProfile,
      expiresAt: row.expires_at
    });

    return userProfile;
  }

  /**
   * Revoke a single session.
   */
  async revokeSession(rawToken) {
    if (!rawToken) return false;
    const tokenHash = this._hashToken(rawToken.trim());
    this._sessionCache.delete(tokenHash);
    const res = await this._query('DELETE FROM user_sessions WHERE token_hash = $1', [tokenHash]);
    return (res.rowCount || 0) > 0;
  }

  /**
   * Revoke all sessions for a user (e.g. after password reset).
   */
  async revokeAllUserSessions(userId) {
    if (!userId) return false;
    for (const [k, v] of this._sessionCache.entries()) {
      if (v.user?.id === userId) {
        this._sessionCache.delete(k);
      }
    }
    await this._query('DELETE FROM user_sessions WHERE user_id = $1', [userId]);
    return true;
  }

  /**
   * Request password reset. Always returns a generic response to prevent email enumeration.
   */
  async requestPasswordReset(email, clientMeta = {}) {
    const emailCheck = this.validateEmail(email);
    const genericResponse = {
      success: true,
      message: 'If an account exists with that email address, password reset instructions have been sent.'
    };

    if (!emailCheck.valid) {
      return genericResponse;
    }

    const res = await this._query('SELECT id, email, status FROM users WHERE email = $1', [emailCheck.email]);
    if (res.rows.length === 0 || res.rows[0].status !== 'ACTIVE') {
      auditLogger.logEvent('PASSWORD_RESET_REQUEST', {
        userEmail: emailCheck.email,
        action: 'FORGOT_PASSWORD',
        status: 'USER_NOT_FOUND_OR_INACTIVE',
        ip: clientMeta.ip || '127.0.0.1'
      });
      return genericResponse;
    }

    const user = res.rows[0];
    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this._hashToken(rawResetToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour TTL

    // Invalidate any existing unused reset tokens for this user
    await this._query(
      'UPDATE password_resets SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL',
      [user.id]
    );

    await this._query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt]
    );

    auditLogger.logEvent('PASSWORD_RESET_REQUEST', {
      userId: user.id,
      userEmail: user.email,
      action: 'FORGOT_PASSWORD',
      status: 'TOKEN_GENERATED',
      ip: clientMeta.ip || '127.0.0.1'
    });

    // In non-production or testing environments, include the token for verification
    if (config.NODE_ENV !== 'production') {
      return {
        ...genericResponse,
        devResetToken: rawResetToken
      };
    }

    return genericResponse;
  }

  /**
   * Reset password using a valid cryptographic reset token.
   */
  async resetPassword(rawToken, newPassword) {
    if (!rawToken || typeof rawToken !== 'string') {
      const err = new Error('Password reset token is required.');
      err.statusCode = 400;
      throw err;
    }

    const passCheck = this.validatePasswordStrength(newPassword);
    if (!passCheck.valid) {
      const err = new Error(passCheck.error);
      err.statusCode = 400;
      throw err;
    }

    const tokenHash = this._hashToken(rawToken.trim());
    const res = await this._query(
      `SELECT pr.id as reset_id, pr.user_id, pr.expires_at, pr.used_at, u.email, u.status
       FROM password_resets pr
       JOIN users u ON pr.user_id = u.id
       WHERE pr.token_hash = $1`,
      [tokenHash]
    );

    if (res.rows.length === 0) {
      const err = new Error('Invalid or expired password reset token.');
      err.statusCode = 400;
      throw err;
    }

    const resetRecord = res.rows[0];
    const now = new Date();

    if (resetRecord.used_at) {
      const err = new Error('This password reset token has already been used.');
      err.statusCode = 400;
      throw err;
    }

    if (new Date(resetRecord.expires_at) < now) {
      const err = new Error('Password reset token has expired. Please request a new one.');
      err.statusCode = 400;
      throw err;
    }

    const newPasswordHash = await this.hashPassword(newPassword);

    // Update password
    await this._query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [newPasswordHash, resetRecord.user_id]
    );

    // Mark token as used
    await this._query(
      'UPDATE password_resets SET used_at = NOW() WHERE id = $1',
      [resetRecord.reset_id]
    );

    // Critical Requirement: Invalidate ALL active sessions for this user upon password reset
    await this.revokeAllUserSessions(resetRecord.user_id);

    auditLogger.logEvent('PASSWORD_RESET_COMPLETE', {
      userId: resetRecord.user_id,
      userEmail: resetRecord.email,
      action: 'RESET_PASSWORD',
      status: 'SUCCESS'
    });

    return {
      success: true,
      message: 'Password has been successfully reset. Please log in with your new password.'
    };
  }

  /**
   * Controlled Initial Admin Bootstrapping
   */
  async seedInitialAdmin() {
    if (!config.INITIAL_ADMIN_EMAIL || !config.INITIAL_ADMIN_PASSWORD) {
      return null;
    }

    const adminEmail = config.INITIAL_ADMIN_EMAIL.toLowerCase().trim();
    const existing = await this._query('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (existing.rows.length > 0) {
      return null;
    }

    // Check if any ADMIN exists
    const anyAdmin = await this._query("SELECT id FROM users WHERE role = 'ADMIN'");
    if (anyAdmin.rows.length > 0) {
      return null;
    }

    logger.info(`[Bootstrap] Creating initial admin account for ${adminEmail}...`);
    const passwordHash = await this.hashPassword(config.INITIAL_ADMIN_PASSWORD);
    const result = await this._query(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ($1, $2, 'Platform Administrator', 'ADMIN', 'ACTIVE')
       RETURNING id, email, name, role, status`,
      [adminEmail, passwordHash]
    );

    logger.info(`[Bootstrap] Initial admin created successfully: ${adminEmail} (${result.rows[0].id})`);
    return result.rows[0];
  }
}

module.exports = new UserService();
