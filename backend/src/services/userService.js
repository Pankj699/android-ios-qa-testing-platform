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
  async seedInitialAdmin(customPassword = null) {
    const adminEmail = (config.INITIAL_ADMIN_EMAIL || 'admin.ob@gmail.com').toLowerCase().trim();
    const adminPassword = customPassword || config.INITIAL_ADMIN_PASSWORD;

    // Check if administrator account already exists
    const existing = await this._query('SELECT id, role, status FROM users WHERE email = $1', [adminEmail]);
    if (existing.rows.length > 0) {
      const user = existing.rows[0];
      if (user.role !== 'ADMIN' || user.status !== 'ACTIVE') {
        await this._query("UPDATE users SET role = 'ADMIN', status = 'ACTIVE', updated_at = NOW() WHERE id = $1", [user.id]);
        logger.info(`[Bootstrap] Ensured existing admin account ${adminEmail} has role ADMIN and status ACTIVE.`);
      }
      return { id: user.id, email: adminEmail, role: 'ADMIN', status: 'ACTIVE', isExisting: true };
    }

    if (!adminPassword) {
      logger.info(`[Bootstrap] Admin account ${adminEmail} does not exist and no password supplied; awaiting manual bootstrap.`);
      return null;
    }

    logger.info(`[Bootstrap] Creating initial administrator account for ${adminEmail}...`);
    const passwordHash = await this.hashPassword(adminPassword);
    const result = await this._query(
      `INSERT INTO users (email, password_hash, name, role, status)
       VALUES ($1, $2, 'Platform Administrator', 'ADMIN', 'ACTIVE')
       RETURNING id, email, name, role, status`,
      [adminEmail, passwordHash]
    );

    logger.info(`[Bootstrap] Initial administrator account created successfully: ${adminEmail} (${result.rows[0].id})`);
    return { ...result.rows[0], isNew: true };
  }

  /**
   * Count active administrators in the database
   */
  async countActiveAdmins() {
    const res = await this._query("SELECT COUNT(*) as count FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE'");
    return parseInt(res.rows[0]?.count || '0', 10);
  }

  /**
   * List users with optional search, role/status filtering, and sorting
   */
  async listUsers({ search = '', role = '', status = '', sortBy = 'created_at', sortOrder = 'desc' } = {}) {
    let queryText = 'SELECT id, email, name, role, status, created_at, updated_at, last_login_at FROM users WHERE 1=1';
    const params = [];

    if (search && search.trim()) {
      params.push(`%${search.trim().toLowerCase()}%`);
      queryText += ` AND (LOWER(name) LIKE $${params.length} OR LOWER(email) LIKE $${params.length})`;
    }

    if (role && role.trim()) {
      params.push(role.trim().toUpperCase());
      queryText += ` AND role = $${params.length}`;
    }

    if (status && status.trim()) {
      params.push(status.trim().toUpperCase());
      queryText += ` AND status = $${params.length}`;
    }

    // Safe sorting column mapping
    const allowedSortCols = {
      name: 'name',
      email: 'email',
      role: 'role',
      status: 'status',
      created_at: 'created_at',
      createdAt: 'created_at',
      last_login_at: 'last_login_at',
      lastLoginAt: 'last_login_at',
      updated_at: 'updated_at',
      updatedAt: 'updated_at'
    };
    const col = allowedSortCols[sortBy] || 'created_at';
    const order = (sortOrder || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    queryText += ` ORDER BY ${col} ${order}`;

    const res = await this._query(queryText, params);

    // Compute summary metrics
    const allUsersRes = await this._query('SELECT role, status FROM users');
    const allRows = allUsersRes.rows;
    const summary = {
      total: allRows.length,
      active: allRows.filter(u => u.status === 'ACTIVE').length,
      inactive: allRows.filter(u => u.status !== 'ACTIVE').length,
      administrators: allRows.filter(u => (u.role || '').toUpperCase() === 'ADMIN' && u.status === 'ACTIVE').length
    };

    return {
      users: res.rows.map(r => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        lastLoginAt: r.last_login_at
      })),
      summary
    };
  }

  /**
   * Retrieve single user details by ID
   */
  async getUserById(id) {
    if (!id) return null;
    const res = await this._query(
      'SELECT id, email, name, role, status, created_at, updated_at, last_login_at FROM users WHERE id = $1',
      [id]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      lastLoginAt: r.last_login_at
    };
  }

  /**
   * Update user details (name, role, status) with admin-less prevention
   */
  async updateUser(id, updates = {}, requestingUser = null) {
    const existing = await this.getUserById(id);
    if (!existing) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }

    const { name, role, status } = updates;
    let newName = existing.name;
    let newRole = existing.role;
    let newStatus = existing.status;

    if (name !== undefined) {
      const trimmed = (name || '').trim();
      if (!trimmed || trimmed.length < 2) {
        const err = new Error('Name must be at least 2 characters long.');
        err.statusCode = 400;
        throw err;
      }
      newName = trimmed;
    }

    if (role !== undefined) {
      const normalizedRole = (role || '').trim().toUpperCase();
      if (!VALID_ROLES.includes(normalizedRole)) {
        const err = new Error(`Invalid role '${role}'. Allowed roles: ${VALID_ROLES.join(', ')}.`);
        err.statusCode = 400;
        throw err;
      }
      newRole = normalizedRole;
    }

    if (status !== undefined) {
      const normalizedStatus = (status || '').trim().toUpperCase();
      if (!['ACTIVE', 'INACTIVE'].includes(normalizedStatus)) {
        const err = new Error(`Invalid status '${status}'. Allowed statuses: ACTIVE, INACTIVE.`);
        err.statusCode = 400;
        throw err;
      }
      newStatus = normalizedStatus;
    }

    // Safety guard: Prevent admin-less system
    const activeAdmins = await this.countActiveAdmins();
    const isTargetActiveAdmin = existing.role === 'ADMIN' && existing.status === 'ACTIVE';

    if (isTargetActiveAdmin && activeAdmins <= 1) {
      if (newRole !== 'ADMIN') {
        const err = new Error('Cannot remove the last active administrator. At least one active administrator must remain.');
        err.statusCode = 409;
        throw err;
      }
      if (newStatus !== 'ACTIVE') {
        const err = new Error('Cannot deactivate the last active administrator. At least one active administrator must remain.');
        err.statusCode = 409;
        throw err;
      }
    }

    await this._query(
      `UPDATE users
       SET name = $1, role = $2, status = $3, updated_at = NOW()
       WHERE id = $4`,
      [newName, newRole, newStatus, id]
    );

    // If deactivated, invalidate all user sessions immediately
    if (newStatus === 'INACTIVE' && existing.status !== 'INACTIVE') {
      await this.revokeAllUserSessions(id);
    }

    // If role changed, update cache so permissions apply immediately
    if (newRole !== existing.role) {
      for (const [k, v] of this._sessionCache.entries()) {
        if (v.user?.id === id) {
          v.user.role = newRole;
        }
      }
    }

    auditLogger.logEvent('USER_UPDATE', {
      targetUserId: id,
      targetUserEmail: existing.email,
      actorUserId: requestingUser?.id || 'admin',
      updatedFields: {
        name: newName !== existing.name ? newName : undefined,
        role: newRole !== existing.role ? newRole : undefined,
        status: newStatus !== existing.status ? newStatus : undefined
      },
      status: 'SUCCESS'
    });

    return this.getUserById(id);
  }

  /**
   * Admin-initiated password reset
   */
  async adminResetPassword(id, customPassword = null, requestingUser = null) {
    const existing = await this.getUserById(id);
    if (!existing) {
      const err = new Error('User not found.');
      err.statusCode = 404;
      throw err;
    }

    let tempPassword = customPassword;
    if (!tempPassword) {
      tempPassword = crypto.randomBytes(8).toString('hex') + '!Aa1';
    }

    const passCheck = this.validatePasswordStrength(tempPassword);
    if (!passCheck.valid) {
      const err = new Error(passCheck.error);
      err.statusCode = 400;
      throw err;
    }

    const passwordHash = await this.hashPassword(tempPassword);
    await this._query(
      'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
      [passwordHash, id]
    );

    // Invalidate all existing sessions for this user
    await this.revokeAllUserSessions(id);

    auditLogger.logEvent('ADMIN_RESET_PASSWORD', {
      targetUserId: id,
      targetUserEmail: existing.email,
      actorUserId: requestingUser?.id || 'admin',
      status: 'SUCCESS'
    });

    return {
      success: true,
      message: 'Password reset successfully.',
      temporaryPassword: tempPassword
    };
  }
}

module.exports = new UserService();
