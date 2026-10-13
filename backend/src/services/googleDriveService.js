const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const db = require('../db');
const logger = require('../utils/logger');
const tokenCrypto = require('../utils/tokenCrypto');
const { sanitizeFilename } = require('../utils/fileUtils');

// Per-user in-flight token refresh promise deduplication
const activeRefreshPromises = new Map();

/**
 * Checks if Google Drive integration credentials are configured in environment.
 * @returns {boolean}
 */
function isConfigured() {
  return Boolean(
    config.GOOGLE_CLIENT_ID &&
    config.GOOGLE_CLIENT_ID.trim() &&
    config.GOOGLE_CLIENT_SECRET &&
    config.GOOGLE_CLIENT_SECRET.trim()
  );
}

/**
 * Creates and returns an OAuth2 client configured with application credentials.
 * @param {object} [customOverrides]
 * @returns {google.auth.OAuth2}
 */
function createOAuth2Client(customOverrides = {}) {
  const clientId = customOverrides.clientId || config.GOOGLE_CLIENT_ID;
  const clientSecret = customOverrides.clientSecret || config.GOOGLE_CLIENT_SECRET;
  const redirectUri = customOverrides.redirectUri || config.GOOGLE_REDIRECT_URI;

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

/**
 * Helper to determine if a Google API error is retryable.
 * @param {Error} err
 * @returns {boolean}
 */
function isRetryableError(err) {
  if (!err) return false;

  const status = err.status || err.response?.status || err.code;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  const code = err.code || '';
  if (['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    return true;
  }

  const message = (err.message || '').toLowerCase();
  if (
    message.includes('ratelimitexceeded') ||
    message.includes('userateLimitexceeded') ||
    message.includes('backend error')
  ) {
    return true;
  }

  return false;
}

/**
 * Executes an async operation with bounded exponential backoff on retryable errors.
 * @param {Function} operation
 * @param {object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.baseDelayMs=150]
 * @returns {Promise<any>}
 */
async function withRetry(operation, options = {}) {
  const maxRetries = options.maxRetries ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 150;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (err) {
      attempt++;
      if (attempt > maxRetries || !isRetryableError(err)) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 50;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Generates an authorization URL bound to the authenticated user ID and saves state to DB.
 * @param {string} userId
 * @param {object} [options]
 * @returns {Promise<{ url: string, state: string }>}
 */
async function generateAuthUrl(userId, options = {}) {
  if (!userId) {
    throw new Error('User ID is required to generate Google authorization URL');
  }

  if (!isConfigured()) {
    const err = new Error(
      'Google Drive integration is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the server environment.'
    );
    err.code = 'NOT_CONFIGURED';
    err.statusCode = 503;
    throw err;
  }

  const oauth2Client = createOAuth2Client();
  const state = tokenCrypto.generateOAuthState(userId, { origin: options.origin });
  const parsed = tokenCrypto.parseAndVerifyOAuthStateSignature(state);

  // Atomically persist state in database for multi-instance single-use validation
  await db.query(
    `INSERT INTO oauth_states (nonce, user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (nonce) DO NOTHING`,
    [parsed.nonce, userId, parsed.expiresAt]
  );

  const scopes = [
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile'
  ];

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: options.prompt || 'consent', // Enforces returning a refresh_token
    scope: scopes,
    state
  });

  return { url, state };
}

/**
 * Cryptographically verifies and atomically consumes an OAuth state from the database.
 * Derives the initiating user ID safely from server-side state.
 * @param {string} stateString
 * @param {string} [expectedUserId]
 * @returns {Promise<{ userId: string, nonce: string, expiresAt: number }>}
 */
async function consumeOAuthState(stateString, expectedUserId = null) {
  // 1. Verify signature, expiration and format
  const parsed = tokenCrypto.parseAndVerifyOAuthStateSignature(stateString);

  if (expectedUserId && parsed.userId !== expectedUserId) {
    const err = new Error('OAuth state user mismatch. State does not match current session user.');
    err.statusCode = 403;
    throw err;
  }

  const now = Date.now();

  // 2. Atomic database update with condition used_at IS NULL (prevents replay across all instances)
  const result = await db.query(
    `UPDATE oauth_states
     SET used_at = NOW()
     WHERE nonce = $1 AND used_at IS NULL AND expires_at > $2
     RETURNING nonce, user_id, expires_at`,
    [parsed.nonce, now]
  );

  if (result.rows && result.rows.length > 0) {
    return {
      userId: result.rows[0].user_id,
      nonce: result.rows[0].nonce,
      origin: parsed.origin || '',
      expiresAt: Number(result.rows[0].expires_at)
    };
  }

  // Row was not updated. Inspect reason for exact security error reporting:
  const check = await db.query('SELECT nonce, user_id, expires_at, used_at FROM oauth_states WHERE nonce = $1', [
    parsed.nonce
  ]);

  if (check.rows.length === 0) {
    const err = new Error('Unknown or unregistered OAuth state nonce');
    err.statusCode = 400;
    throw err;
  }

  const record = check.rows[0];
  if (record.used_at) {
    const err = new Error('OAuth state has already been used (replay attempt detected)');
    err.statusCode = 409;
    throw err;
  }

  if (Number(record.expires_at) <= now) {
    const err = new Error('OAuth state has expired. Please initiate Google Drive connection again.');
    err.statusCode = 400;
    throw err;
  }

  const err = new Error('OAuth state validation failed');
  err.statusCode = 400;
  throw err;
}

/**
 * Handles Google OAuth callback, exchanges authorization code, verifies identity,
 * encrypts tokens, and stores credentials.
 * @param {string} code
 * @param {string} stateString
 * @param {object} [injectedClient] Optional mock client for automated testing
 * @returns {Promise<{ success: boolean, userId: string, email: string, name: string, picture: string }>}
 */
async function handleOAuthCallback(code, stateString, injectedClient = null) {
  logger.info(`[DriveOAuth] Processing callback. Code received: ${Boolean(code)}`);

  if (!code || typeof code !== 'string') {
    const err = new Error('Authorization code is missing or invalid');
    err.statusCode = 400;
    logger.warn('[DriveOAuth] Code missing or invalid');
    throw err;
  }

  // 1. Atomically consume state to securely derive user ID
  logger.info('[DriveOAuth] Validating and consuming OAuth state...');
  let userId;
  let origin = '';
  try {
    const consumed = await consumeOAuthState(stateString);
    userId = consumed.userId;
    origin = consumed.origin || '';
    logger.info(`[DriveOAuth] State validation passed. Bound user ID: ${userId}`);
  } catch (stateErr) {
    logger.warn(`[DriveOAuth] State validation failed: ${stateErr.message}`);
    throw stateErr;
  }

  // 2. Exchange code for tokens
  logger.info('[DriveOAuth] Token exchange started with Google.');
  const oauth2Client = injectedClient || (module.exports.createOAuth2Client ? module.exports.createOAuth2Client() : createOAuth2Client());
  let tokens;
  try {
    const tokenResponse = await withRetry(() => oauth2Client.getToken(code));
    tokens = tokenResponse.tokens || tokenResponse;
    logger.info(`[DriveOAuth] Token exchange completed. Has access token: ${Boolean(tokens?.access_token)}, Has refresh token: ${Boolean(tokens?.refresh_token)}`);
  } catch (tokenErr) {
    logger.error(`[DriveOAuth] Token exchange failed: ${tokenErr.message}`);
    throw tokenErr;
  }

  if (!tokens || !tokens.access_token) {
    const err = new Error('Failed to retrieve valid access token from Google');
    err.statusCode = 502;
    logger.error('[DriveOAuth] Valid access token missing in Google response');
    throw err;
  }

  oauth2Client.setCredentials(tokens);

  // 3. Fetch Google account profile
  let email = '';
  let name = '';
  let picture = '';

  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfoRes = await withRetry(() => oauth2.userinfo.get());
    email = userInfoRes.data?.email || '';
    name = userInfoRes.data?.name || '';
    picture = userInfoRes.data?.picture || '';
  } catch (userErr) {
    logger.warn(`[Google Drive] Could not fetch userinfo profile: ${userErr.message}`);
  }

  // 4. Encrypt tokens using Phase 1 AES-256-GCM utilities
  const encryptedAccess = tokenCrypto.encryptToken(tokens.access_token);
  const encryptedRefresh = tokens.refresh_token
    ? tokenCrypto.encryptSelfContained(tokens.refresh_token)
    : null;

  const expiryDate = tokens.expiry_date || (Date.now() + 3600000);
  const scope = tokens.scope || 'https://www.googleapis.com/auth/drive.file';

  // 5. Atomic Upsert for user_id (preserving existing refresh token if Google omitted replacement)
  logger.info('[DriveOAuth] Token persistence started.');
  try {
    const existingRes = await db.query('SELECT id, encrypted_refresh_token FROM google_drive_tokens WHERE user_id = $1', [
      userId
    ]);

    if (existingRes.rows.length > 0) {
      await db.query(
        `UPDATE google_drive_tokens
         SET google_email = $2,
             google_name = $3,
             google_picture = $4,
             encrypted_access_token = $5,
             encrypted_refresh_token = COALESCE($6, encrypted_refresh_token),
             token_iv = $7,
             token_auth_tag = $8,
             expiry_date = $9,
             scope = $10,
             updated_at = NOW()
         WHERE user_id = $1`,
        [
          userId,
          email,
          name,
          picture,
          encryptedAccess.encrypted,
          encryptedRefresh,
          encryptedAccess.iv,
          encryptedAccess.authTag,
          expiryDate,
          scope
        ]
      );
    } else {
      await db.query(
        `INSERT INTO google_drive_tokens (
          user_id, google_email, google_name, google_picture,
          encrypted_access_token, encrypted_refresh_token,
          token_iv, token_auth_tag, expiry_date, scope
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          userId,
          email,
          name,
          picture,
          encryptedAccess.encrypted,
          encryptedRefresh,
          encryptedAccess.iv,
          encryptedAccess.authTag,
          expiryDate,
          scope
        ]
      );
    }
    logger.info(`[DriveOAuth] Token persistence succeeded for user ${userId}.`);
  } catch (dbErr) {
    logger.error(`[DriveOAuth] Token persistence failed: ${dbErr.message}`);
    throw dbErr;
  }

  logger.info(`[Google Drive] Account connected successfully for user ${userId} (${email})`);

  return {
    success: true,
    userId,
    email,
    name,
    picture,
    origin
  };
}

/**
 * Retrieves the connection status and profile for a given user.
 * Scoped strictly to user_id. Never returns raw or encrypted tokens.
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function getConnectionStatus(userId) {
  if (!userId) {
    return { connected: false, configured: isConfigured() };
  }

  const res = await db.query(
    `SELECT google_email, google_name, google_picture, default_folder_id,
            default_folder_name, expiry_date, scope, encrypted_refresh_token,
            created_at, updated_at
     FROM google_drive_tokens
     WHERE user_id = $1`,
    [userId]
  );

  if (res.rows.length === 0) {
    return {
      connected: false,
      configured: isConfigured()
    };
  }

  const row = res.rows[0];
  const now = Date.now();
  const isExpired = row.expiry_date && Number(row.expiry_date) < now;
  const hasRefreshToken = Boolean(row.encrypted_refresh_token);
  const needsReconnect = Boolean(isExpired && !hasRefreshToken);

  const grantedScopes = (row.scope || '').split(/\s+/).filter(Boolean);
  const hasFullDriveScope = grantedScopes.includes('https://www.googleapis.com/auth/drive');
  const scopeWarning = !hasFullDriveScope
    ? 'Your Google account was connected with limited per-file permissions (drive.file). Reconnect to grant full Google Drive folder access.'
    : null;

  return {
    connected: true,
    configured: isConfigured(),
    email: row.google_email,
    name: row.google_name,
    picture: row.google_picture,
    defaultFolderId: row.default_folder_id || null,
    defaultFolderName: row.default_folder_name || null,
    scope: row.scope,
    hasFullDriveScope,
    scopeWarning,
    expiryDate: row.expiry_date ? Number(row.expiry_date) : null,
    needsReconnect,
    connectedAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Disconnects the current user's Google Drive connection safely.
 * Affects ONLY the specified userId without touching Google Drive files.
 * @param {string} userId
 * @param {object} [injectedClient] Optional mock client
 * @returns {Promise<{ success: boolean }>}
 */
async function disconnect(userId, injectedClient = null) {
  if (!userId) {
    throw new Error('User ID is required to disconnect Google Drive');
  }

  const res = await db.query(
    'SELECT encrypted_access_token, token_iv, token_auth_tag FROM google_drive_tokens WHERE user_id = $1',
    [userId]
  );

  if (res.rows.length > 0) {
    const row = res.rows[0];
    // Best-effort revocation with Google
    try {
      const accessToken = tokenCrypto.decryptToken(row.encrypted_access_token, row.token_iv, row.token_auth_tag);
      if (accessToken) {
        const client = injectedClient || createOAuth2Client();
        await client.revokeToken(accessToken).catch(() => {});
      }
    } catch (e) {
      // Ignored: Revocation failure on Google's end must not prevent local disconnect
    }

    await db.query('DELETE FROM google_drive_tokens WHERE user_id = $1', [userId]);
  }

  logger.info(`[Google Drive] Disconnected account for user ${userId}`);
  return { success: true };
}

/**
 * Refreshes an expired or expiring access token for a user with concurrent request deduplication.
 * Preserves the existing refresh token if Google omits a replacement.
 * @param {string} userId
 * @param {object} userRecord
 * @param {object} [injectedClient]
 * @returns {Promise<{ accessToken: string, expiryDate: number }>}
 */
async function refreshUserToken(userId, userRecord, injectedClient = null) {
  if (activeRefreshPromises.has(userId)) {
    return activeRefreshPromises.get(userId);
  }

  const refreshPromise = (async () => {
    try {
      if (!userRecord.encrypted_refresh_token) {
        const err = new Error('No refresh token available. Reconnection required.');
        err.code = 'NO_REFRESH_TOKEN';
        err.needsReconnect = true;
        throw err;
      }

      // Decrypt refresh token
      let refreshToken = null;
      if (userRecord.encrypted_refresh_token.includes(':')) {
        refreshToken = tokenCrypto.decryptSelfContained(userRecord.encrypted_refresh_token);
      } else {
        refreshToken = tokenCrypto.decryptToken(
          userRecord.encrypted_refresh_token,
          userRecord.token_iv,
          userRecord.token_auth_tag
        );
      }

      const client = injectedClient || createOAuth2Client();
      client.setCredentials({ refresh_token: refreshToken });

      let refreshedResponse;
      try {
        refreshedResponse = await withRetry(() => client.refreshAccessToken());
      } catch (refreshErr) {
        const msg = (refreshErr.message || '').toLowerCase();
        const dataErr = (refreshErr.response?.data?.error || '').toLowerCase();
        if (msg.includes('invalid_grant') || dataErr === 'invalid_grant') {
          const err = new Error('Google authorization was revoked or expired. Please reconnect your account.');
          err.code = 'GOOGLE_AUTH_REVOKED';
          err.needsReconnect = true;
          throw err;
        }
        throw refreshErr;
      }

      const tokens = refreshedResponse.credentials || refreshedResponse;
      const newAccessToken = tokens.access_token;
      const newExpiryDate = tokens.expiry_date || (Date.now() + 3600000);
      const encAccess = tokenCrypto.encryptToken(newAccessToken);

      // Preserve existing encrypted refresh token if replacement omitted
      let encRefresh = userRecord.encrypted_refresh_token;
      if (tokens.refresh_token) {
        encRefresh = tokenCrypto.encryptSelfContained(tokens.refresh_token);
      }

      await db.query(
        `UPDATE google_drive_tokens
         SET encrypted_access_token = $1,
             encrypted_refresh_token = $2,
             token_iv = $3,
             token_auth_tag = $4,
             expiry_date = $5,
             updated_at = NOW()
         WHERE user_id = $6`,
        [encAccess.encrypted, encRefresh, encAccess.iv, encAccess.authTag, newExpiryDate, userId]
      );

      return {
        accessToken: newAccessToken,
        expiryDate: newExpiryDate
      };
    } finally {
      activeRefreshPromises.delete(userId);
    }
  })();

  activeRefreshPromises.set(userId, refreshPromise);
  return refreshPromise;
}

/**
 * Retrieves an authenticated Google Drive client for a user, automatically refreshing tokens if needed.
 * @param {string} userId
 * @param {object} [injectedClient]
 * @returns {Promise<{ drive: object, oauth2Client: object, userId: string, email: string }>}
 */
async function getAuthenticatedDriveClient(userId, injectedClient = null) {
  if (!userId) {
    throw new Error('User ID is required');
  }

  const res = await db.query('SELECT * FROM google_drive_tokens WHERE user_id = $1', [userId]);
  if (res.rows.length === 0) {
    const err = new Error('Google Drive is not connected for this account. Please connect Google Drive first.');
    err.code = 'NOT_CONNECTED';
    err.statusCode = 404;
    throw err;
  }

  const record = res.rows[0];
  const now = Date.now();
  // If token expires within 5 minutes or already expired, refresh it
  const isExpiring = !record.expiry_date || (Number(record.expiry_date) - now < 300000);

  let accessToken = null;
  if (isExpiring && record.encrypted_refresh_token) {
    const refreshed = await refreshUserToken(userId, record, injectedClient);
    accessToken = refreshed.accessToken;
  } else {
    accessToken = tokenCrypto.decryptToken(
      record.encrypted_access_token,
      record.token_iv,
      record.token_auth_tag
    );
  }

  if (injectedClient && (injectedClient.files || injectedClient.permissions || injectedClient.about)) {
    return {
      drive: injectedClient,
      oauth2Client: injectedClient,
      userId,
      email: record.google_email
    };
  }

  const oauth2Client = injectedClient || createOAuth2Client();
  if (typeof oauth2Client.setCredentials === 'function') {
    oauth2Client.setCredentials({ access_token: accessToken });
  }

  const drive = google.drive({ version: 'v3', auth: oauth2Client });

  return {
    drive,
    oauth2Client,
    userId,
    email: record.google_email
  };
}

/**
 * Retrieves storage quota from Google Drive for the connected user.
 * @param {string} userId
 * @param {object} [injectedClient]
 * @returns {Promise<object>}
 */
async function getStorageQuota(userId, injectedClient = null) {
  const { drive } = await getAuthenticatedDriveClient(userId, injectedClient);

  const res = await withRetry(() =>
    drive.about.get({
      fields: 'storageQuota,user'
    })
  );

  const quota = res.data?.storageQuota || {};
  return {
    limit: quota.limit ? Number(quota.limit) : null,
    usage: quota.usage ? Number(quota.usage) : 0,
    usageInDrive: quota.usageInDrive ? Number(quota.usageInDrive) : 0,
    usageInDriveTrash: quota.usageInDriveTrash ? Number(quota.usageInDriveTrash) : 0,
    user: res.data?.user || null
  };
}

/**
 * Lists files and folders from Google Drive for the authenticated user.
 * @param {string} userId
 * @param {object} [options]
 * @param {object} [injectedClient]
 * @returns {Promise<{ files: Array, nextPageToken: string|null }>}
 */
async function listFiles(userId, options = {}, injectedClient = null) {
  const { drive } = await getAuthenticatedDriveClient(userId, injectedClient);

  const pageSize = Math.min(Math.max(1, parseInt(options.pageSize || '50', 10)), 100);
  const pageToken = options.pageToken || undefined;

  const queries = ['trashed = false'];

  if (options.folderId) {
    const safeFolderId = options.folderId.replace(/'/g, "\\'");
    queries.push(`'${safeFolderId}' in parents`);
  }

  if (options.fileType === 'folder') {
    queries.push("mimeType = 'application/vnd.google-apps.folder'");
  } else if (options.fileType === 'file') {
    queries.push("mimeType != 'application/vnd.google-apps.folder'");
  }

  if (options.search && typeof options.search === 'string' && options.search.trim()) {
    const cleanSearch = options.search.trim().replace(/'/g, "\\'");
    queries.push(`name contains '${cleanSearch}'`);
  }

  const res = await withRetry(() =>
    drive.files.list({
      q: queries.join(' and '),
      pageSize,
      pageToken,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, createdTime, parents, webViewLink, iconLink)',
      orderBy: 'folder,name',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true
    })
  );

  return {
    files: res.data?.files || [],
    nextPageToken: res.data?.nextPageToken || null
  };
}

/**
 * Creates a new folder in Google Drive.
 * @param {string} userId
 * @param {string} folderName
 * @param {string} [parentId]
 * @param {object} [injectedClient]
 * @returns {Promise<object>}
 */
async function createFolder(userId, folderName, parentId = null, injectedClient = null) {
  if (!folderName || typeof folderName !== 'string' || !folderName.trim()) {
    const err = new Error('Folder name is required and cannot be empty');
    err.statusCode = 400;
    throw err;
  }

  const cleanName = folderName.trim().slice(0, 255);
  const { drive } = await getAuthenticatedDriveClient(userId, injectedClient);

  const parents = parentId && parentId !== 'root' ? [parentId] : undefined;

  const res = await withRetry(() =>
    drive.files.create({
      requestBody: {
        name: cleanName,
        mimeType: 'application/vnd.google-apps.folder',
        parents
      },
      fields: 'id, name, mimeType, parents, createdTime, webViewLink',
      supportsAllDrives: true
    })
  );

  return res.data;
}

/**
 * Renames an existing file or folder in Google Drive.
 * @param {string} userId
 * @param {string} fileId
 * @param {string} newName
 * @param {object} [injectedClient]
 * @returns {Promise<object>}
 */
async function renameFile(userId, fileId, newName, injectedClient = null) {
  if (!fileId || typeof fileId !== 'string' || !fileId.trim()) {
    const err = new Error('File ID is required');
    err.statusCode = 400;
    throw err;
  }
  if (!newName || typeof newName !== 'string' || !newName.trim()) {
    const err = new Error('New name is required');
    err.statusCode = 400;
    throw err;
  }

  const cleanName = newName.trim().slice(0, 255);
  const { drive } = await getAuthenticatedDriveClient(userId, injectedClient);

  const res = await withRetry(() =>
    drive.files.update({
      fileId,
      requestBody: { name: cleanName },
      fields: 'id, name, mimeType, modifiedTime, webViewLink'
    })
  );

  // Sync filename in local recordings table if tracked
  await db.query(
    'UPDATE recordings SET filename = $1, updated_at = NOW() WHERE user_id = $2 AND google_drive_file_id = $3',
    [cleanName, userId, fileId]
  );

  return res.data;
}

/**
 * Moves a file or folder to a different parent folder.
 * @param {string} userId
 * @param {string} fileId
 * @param {string} destinationFolderId
 * @param {string} [currentParentId]
 * @param {object} [injectedClient]
 * @returns {Promise<object>}
 */
async function moveFile(userId, fileId, destinationFolderId, currentParentId = null, injectedClient = null) {
  if (!fileId || typeof fileId !== 'string' || !fileId.trim()) {
    const err = new Error('File ID is required');
    err.statusCode = 400;
    throw err;
  }
  if (!destinationFolderId || typeof destinationFolderId !== 'string' || !destinationFolderId.trim()) {
    const err = new Error('Destination folder ID is required');
    err.statusCode = 400;
    throw err;
  }

  const { drive } = await getAuthenticatedDriveClient(userId, injectedClient);

  let prevParents = currentParentId;
  if (!prevParents) {
    const getRes = await withRetry(() => drive.files.get({ fileId, fields: 'parents' }));
    prevParents = (getRes.data?.parents || []).join(',');
  }

  const res = await withRetry(() =>
    drive.files.update({
      fileId,
      addParents: destinationFolderId,
      removeParents: prevParents,
      fields: 'id, name, parents'
    })
  );

  // Sync folder reference in local recordings table if tracked
  await db.query(
    'UPDATE recordings SET google_drive_folder_id = $1, updated_at = NOW() WHERE user_id = $2 AND google_drive_file_id = $3',
    [destinationFolderId, userId, fileId]
  );

  return res.data;
}

/**
 * Deletes a file or folder from Google Drive.
 * Scoped strictly to the authenticated user.
 * @param {string} userId
 * @param {string} fileId
 * @param {object} [injectedClient]
 * @returns {Promise<{ success: boolean, fileId: string }>}
 */
async function deleteFile(userId, fileId, injectedClient = null) {
  if (!fileId || typeof fileId !== 'string' || !fileId.trim()) {
    const err = new Error('File ID is required');
    err.statusCode = 400;
    throw err;
  }

  const { drive } = await getAuthenticatedDriveClient(userId, injectedClient);

  await withRetry(() => drive.files.delete({ fileId }));

  // Keep local recording record intact, but mark upload status as LOCAL_ONLY and clear Drive ID
  await db.query(
    `UPDATE recordings
     SET upload_status = 'LOCAL_ONLY',
         google_drive_file_id = NULL,
         google_drive_web_view_link = NULL,
         google_drive_share_link = NULL,
         updated_at = NOW()
     WHERE user_id = $1 AND google_drive_file_id = $2`,
    [userId, fileId]
  );

  return { success: true, fileId };
}

/**
 * Retrieves metadata for a specific file or folder.
 * @param {string} userId
 * @param {string} fileId
 * @param {object} [injectedClient]
 * @returns {Promise<object>}
 */
async function getFileMetadata(userId, fileId, injectedClient = null) {
  if (!fileId || typeof fileId !== 'string' || !fileId.trim()) {
    const err = new Error('File ID is required');
    err.statusCode = 400;
    throw err;
  }

  const { drive } = await getAuthenticatedDriveClient(userId, injectedClient);

  const res = await withRetry(() =>
    drive.files.get({
      fileId,
      fields: 'id, name, mimeType, size, modifiedTime, createdTime, parents, webViewLink, webContentLink, shared',
      supportsAllDrives: true
    })
  );

  return res.data;
}

/**
 * Resolves the structured breadcrumbs path for a Google Drive folder.
 * Returns an array from root down to the target folder:
 * [{ id: 'root', name: 'My Drive' }, ..., { id: folderId, name: folderName }]
 * @param {string} userId
 * @param {string} folderId
 * @param {object} [injectedClient]
 * @returns {Promise<{ folder: object, breadcrumbs: Array<{ id: string, name: string }> }>}
 */
async function getFolderBreadcrumbs(userId, folderId, injectedClient = null) {
  if (!folderId || folderId === 'root') {
    return {
      folder: { id: 'root', name: 'My Drive' },
      breadcrumbs: [{ id: 'root', name: 'My Drive' }]
    };
  }

  const { drive } = await getAuthenticatedDriveClient(userId, injectedClient);
  const breadcrumbs = [];
  let currentId = folderId;
  let targetFolder = null;
  let depth = 0;
  const maxDepth = 10;

  while (currentId && currentId !== 'root' && depth < maxDepth) {
    depth++;
    try {
      const res = await withRetry(() =>
        drive.files.get({
          fileId: currentId,
          fields: 'id, name, mimeType, parents',
          supportsAllDrives: true
        })
      );
      const file = res.data;
      if (!targetFolder) {
        targetFolder = file;
      }
      breadcrumbs.unshift({ id: file.id, name: file.name });
      if (file.parents && file.parents.length > 0) {
        currentId = file.parents[0];
      } else {
        currentId = null;
      }
    } catch (err) {
      if (depth === 1) {
        const error = new Error(`Folder "${folderId}" not found or inaccessible in Google Drive`);
        error.statusCode = 404;
        throw error;
      }
      break;
    }
  }

  breadcrumbs.unshift({ id: 'root', name: 'My Drive' });

  return {
    folder: targetFolder || { id: folderId, name: breadcrumbs[breadcrumbs.length - 1]?.name || 'Folder' },
    breadcrumbs
  };
}

/**
 * Explicitly publishes/shares a file in Google Drive by generating a shareable link.
 * Verifies file accessibility, checks for existing permissions to prevent duplicates,
 * applies the least permissive public role (role: 'reader', type: 'anyone'),
 * updates the database recording record, and returns the shareable link.
 *
 * @param {string} userId - ID of authenticated user
 * @param {string} fileId - ID of Google Drive file
 * @param {object} [optionsOrClient={}] - Optional configuration or mock client
 * @param {object} [injectedClient=null] - Mock client for testing
 * @returns {Promise<{ fileId: string, shareLink: string, webContentLink: string, permissionStatus: string, alreadyShared: boolean, role: string, type: string, message: string }>}
 */
async function publishFile(userId, fileId, optionsOrClient = {}, injectedClient = null) {
  if (!fileId || typeof fileId !== 'string' || !fileId.trim()) {
    const err = new Error('File ID is required');
    err.statusCode = 400;
    throw err;
  }

  let options = {};
  let mockClient = injectedClient;
  if (optionsOrClient && (optionsOrClient.files || optionsOrClient.permissions || optionsOrClient.about)) {
    mockClient = optionsOrClient;
    options = {};
  } else if (typeof optionsOrClient === 'object') {
    options = optionsOrClient;
  }

  const cleanFileId = fileId.trim();
  const targetRole = options.role || 'reader';
  const targetType = options.type || 'anyone';

  // 1. Authenticate with Google Drive
  const { drive } = await getAuthenticatedDriveClient(userId, mockClient);

  // 2. Validate file existence, access, and permissions
  let fileMeta;
  try {
    const metaRes = await withRetry(() =>
      drive.files.get({
        fileId: cleanFileId,
        fields: 'id, name, webViewLink, webContentLink, trashed, capabilities(canShare)'
      })
    );
    fileMeta = metaRes.data;
  } catch (err) {
    if (err.status === 404 || err.code === 404) {
      const notFoundErr = new Error(`Google Drive file not found or inaccessible: ${cleanFileId}`);
      notFoundErr.statusCode = 404;
      throw notFoundErr;
    }
    if (err.status === 403 || err.code === 403) {
      const forbiddenErr = new Error(`Insufficient permissions to access Google Drive file: ${err.message}`);
      forbiddenErr.statusCode = 403;
      throw forbiddenErr;
    }
    throw err;
  }

  if (fileMeta?.trashed) {
    const err = new Error('Cannot publish a file that is in the trash');
    err.statusCode = 400;
    throw err;
  }

  if (fileMeta?.capabilities && fileMeta.capabilities.canShare === false) {
    const err = new Error('You do not have permission to share this file in Google Drive');
    err.statusCode = 403;
    throw err;
  }

  // 3. Inspect existing permissions to prevent duplicate permission creation
  let alreadyShared = false;
  let existingPermissionId = null;

  if (drive.permissions && typeof drive.permissions.list === 'function') {
    try {
      const permListRes = await withRetry(() =>
        drive.permissions.list({
          fileId: cleanFileId,
          fields: 'permissions(id, role, type)'
        })
      );
      const existingPerms = permListRes.data?.permissions || [];
      const matched = existingPerms.find(
        (p) => p.type === targetType && (p.role === targetRole || p.role === 'writer' || p.role === 'commenter')
      );
      if (matched) {
        alreadyShared = true;
        existingPermissionId = matched.id;
      }
    } catch (permListErr) {
      logger.warn(`[Google Drive] Could not list permissions for file ${cleanFileId}: ${permListErr.message}`);
    }
  }

  // 4. Create sharing permission only if it does not already exist
  if (!alreadyShared) {
    if (!drive.permissions || typeof drive.permissions.create !== 'function') {
      const err = new Error('Google Drive permissions API is unavailable');
      err.statusCode = 500;
      throw err;
    }
    try {
      await withRetry(() =>
        drive.permissions.create({
          fileId: cleanFileId,
          requestBody: {
            role: targetRole,
            type: targetType
          },
          fields: 'id'
        })
      );
    } catch (permCreateErr) {
      logger.error(`[Google Drive] Permission creation failed for file ${cleanFileId}: ${permCreateErr.message}`);
      const err = new Error(`Failed to grant sharing permission in Google Drive: ${permCreateErr.message}`);
      err.statusCode = permCreateErr.status || permCreateErr.code || 500;
      throw err;
    }
  }

  // 5. Retrieve verified shareable URL (webViewLink)
  let shareLink = fileMeta?.webViewLink || null;
  let webContentLink = fileMeta?.webContentLink || null;

  if (!shareLink && drive.files && typeof drive.files.get === 'function') {
    try {
      const refreshedMeta = await withRetry(() =>
        drive.files.get({
          fileId: cleanFileId,
          fields: 'id, name, webViewLink, webContentLink'
        })
      );
      shareLink = refreshedMeta.data?.webViewLink || null;
      webContentLink = refreshedMeta.data?.webContentLink || null;
    } catch (_) {}
  }

  if (!shareLink) {
    shareLink = `https://drive.google.com/file/d/${cleanFileId}/view?usp=sharing`;
  }

  // 6. Update local database recording record if associated with this user and file
  try {
    await db.query(
      `UPDATE recordings
       SET google_drive_share_link = $1,
           updated_at = NOW()
       WHERE user_id = $2 AND google_drive_file_id = $3`,
      [shareLink, userId, cleanFileId]
    );
  } catch (dbErr) {
    logger.warn(`[Google Drive] Could not update recording record in DB: ${dbErr.message}`);
  }

  return {
    fileId: cleanFileId,
    shareLink,
    webContentLink,
    alreadyShared,
    role: targetRole,
    type: targetType,
    permissionStatus: alreadyShared ? 'reused' : 'created',
    message: alreadyShared
      ? 'Shareable link retrieved (existing sharing permission reused).'
      : 'Shareable link created and published successfully. Anyone with this link can now view the file.'
  };
}

const createShareableLink = publishFile;

/**
 * Retrieves the user's default upload folder ID and name.
 * @param {string} userId
 * @returns {Promise<{ defaultFolderId: string|null, defaultFolderName: string|null }>}
 */
async function getDefaultFolder(userId) {
  const res = await db.query(
    'SELECT default_folder_id, default_folder_name FROM google_drive_tokens WHERE user_id = $1',
    [userId]
  );

  if (res.rows.length === 0) {
    return { defaultFolderId: null, defaultFolderName: null };
  }

  return {
    defaultFolderId: res.rows[0].default_folder_id || null,
    defaultFolderName: res.rows[0].default_folder_name || null
  };
}

/**
 * Sets the user's default upload folder ID and name.
 * @param {string} userId
 * @param {string} folderId
 * @param {string} folderName
 * @returns {Promise<{ success: boolean, defaultFolderId: string, defaultFolderName: string }>}
 */
async function setDefaultFolder(userId, folderId, folderName) {
  await db.query(
    `UPDATE google_drive_tokens
     SET default_folder_id = $1,
         default_folder_name = $2,
         updated_at = NOW()
     WHERE user_id = $3`,
    [folderId || null, folderName || null, userId]
  );

  return {
    success: true,
    defaultFolderId: folderId || null,
    defaultFolderName: folderName || null
  };
}

/**
 * Uploads a screen recording to Google Drive safely via streaming without loading into memory.
 * Persists recording metadata in recordings table.
 * @param {string} userId
 * @param {object} payload
 * @param {object} [injectedClient]
 * @returns {Promise<object>}
 */
async function uploadRecording(userId, payload = {}, injectedClient = null) {
  const {
    filePath,
    originalFilename,
    mimeType = 'video/webm',
    sizeBytes = 0,
    durationSec = 0,
    deviceSerial = '',
    deviceName = '',
    testId = null,
    folderId = null,
    recordingId = null
  } = payload;

  if (!filePath || !fs.existsSync(filePath)) {
    const err = new Error('Recording file does not exist on disk or has been removed');
    err.statusCode = 400;
    throw err;
  }

  const stat = fs.statSync(filePath);
  const actualSize = stat.size;
  const maxBytes = config.MAX_RECORDING_SIZE_MB * 1024 * 1024;

  if (actualSize > maxBytes) {
    const err = new Error(
      `Recording file exceeds maximum allowed size of ${config.MAX_RECORDING_SIZE_MB}MB (${actualSize} bytes)`
    );
    err.statusCode = 413;
    throw err;
  }

  const cleanOriginal = originalFilename || path.basename(filePath);
  const safeFilename = path.basename(sanitizeFilename(cleanOriginal));
  const recId = recordingId || `rec_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  // Check duplicate submission
  const dupCheck = await db.query(
    'SELECT * FROM recordings WHERE user_id = $1 AND recording_id = $2',
    [userId, recId]
  );
  if (dupCheck.rows.length > 0 && dupCheck.rows[0].upload_status === 'UPLOADED') {
    return dupCheck.rows[0];
  }

  // Resolve target folder: payload folderId -> user default folder -> root
  let targetFolderId = folderId;
  let targetFolderName = null;
  if (!targetFolderId) {
    const defaultF = await getDefaultFolder(userId);
    targetFolderId = defaultF.defaultFolderId;
    targetFolderName = defaultF.defaultFolderName;
  }

  // If a specific folder ID is targeted (not root), verify it exists and is accessible
  if (targetFolderId && targetFolderId !== 'root') {
    // If injected client provides files.get or in standard runtime, perform validation
    const hasGetSupport = !injectedClient || (injectedClient.files && typeof injectedClient.files.get === 'function');
    if (hasGetSupport) {
      try {
        const meta = await getFileMetadata(userId, targetFolderId, injectedClient);
        if (meta && meta.name) {
          targetFolderName = meta.name;
        }
      } catch (folderCheckErr) {
        const err = new Error(
          `Destination folder does not exist or is not accessible: ${folderCheckErr.message}`
        );
        err.statusCode = 404;
        throw err;
      }
    }
  }

  // Initial persistence record marked as UPLOADING
  await db.query(
    `INSERT INTO recordings (
      user_id, recording_id, filename, original_filename,
      mime_type, size_bytes, duration_sec, device_serial,
      device_name, test_id, google_drive_folder_id, google_drive_folder_name,
      upload_status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'UPLOADING')
    ON CONFLICT (recording_id) DO UPDATE SET
      upload_status = 'UPLOADING',
      size_bytes = EXCLUDED.size_bytes,
      updated_at = NOW()`,
    [
      userId,
      recId,
      safeFilename,
      cleanOriginal,
      mimeType,
      actualSize,
      parseInt(durationSec, 10) || 0,
      deviceSerial || null,
      deviceName || null,
      testId || null,
      targetFolderId || null,
      targetFolderName || null
    ]
  );

  // Authenticate and stream upload to Google Drive
  let driveClientObj;
  try {
    driveClientObj = await getAuthenticatedDriveClient(userId, injectedClient);
  } catch (authErr) {
    await db.query(
      `UPDATE recordings
       SET upload_status = 'FAILED',
           upload_error = $1,
           updated_at = NOW()
       WHERE user_id = $2 AND recording_id = $3`,
      [authErr.message, userId, recId]
    );
    throw authErr;
  }

  const { drive, email } = driveClientObj;
  const fileStream = fs.createReadStream(filePath);

  let driveFile;
  try {
    const uploadRes = await withRetry(() =>
      drive.files.create({
        requestBody: {
          name: safeFilename,
          mimeType: mimeType || 'video/webm',
          parents: targetFolderId && targetFolderId !== 'root' ? [targetFolderId] : undefined
        },
        media: {
          mimeType: mimeType || 'video/webm',
          body: fileStream
        },
        fields: 'id, name, size, webViewLink, parents'
      })
    );
    driveFile = uploadRes.data;
  } catch (uploadErr) {
    await db.query(
      `UPDATE recordings
       SET upload_status = 'FAILED',
           upload_error = $1,
           updated_at = NOW()
       WHERE user_id = $2 AND recording_id = $3`,
      [uploadErr.message, userId, recId]
    );
    throw uploadErr;
  }

  // Update record upon confirmed Google Drive success
  const updateRes = await db.query(
    `UPDATE recordings
     SET google_drive_file_id = $1,
         google_drive_web_view_link = $2,
         google_drive_folder_id = $3,
         google_account_email = $4,
         upload_status = 'UPLOADED',
         upload_error = NULL,
         updated_at = NOW()
     WHERE user_id = $5 AND recording_id = $6
     RETURNING *`,
    [
      driveFile.id,
      driveFile.webViewLink || null,
      targetFolderId || null,
      email || null,
      userId,
      recId
    ]
  );

  return updateRes.rows[0];
}

/**
 * Lists recordings belonging strictly to the authenticated user.
 * @param {string} userId
 * @param {object} [options]
 * @returns {Promise<Array>}
 */
async function listRecordings(userId, options = {}) {
  const limit = Math.min(Math.max(1, parseInt(options.limit || '50', 10)), 100);
  const offset = Math.max(0, parseInt(options.offset || '0', 10));

  const queries = ['user_id = $1'];
  const params = [userId];

  if (options.status) {
    params.push(options.status.toUpperCase());
    queries.push(`upload_status = $${params.length}`);
  }

  if (options.testId) {
    params.push(options.testId);
    queries.push(`test_id = $${params.length}`);
  }

  params.push(limit);
  const limitParam = params.length;
  params.push(offset);
  const offsetParam = params.length;

  const sql = `
    SELECT id, recording_id, filename, original_filename, mime_type,
           size_bytes, duration_sec, device_serial, device_name, test_id,
           google_drive_file_id, google_drive_folder_id, google_drive_folder_name,
           google_drive_web_view_link, google_drive_share_link, google_account_email,
           upload_status, upload_error, created_at, updated_at
    FROM recordings
    WHERE ${queries.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT $${limitParam} OFFSET $${offsetParam}
  `;

  const res = await db.query(sql, params);
  return res.rows;
}

/**
 * Retrieves a single recording record for the authenticated user.
 * @param {string} userId
 * @param {string} recordingId
 * @returns {Promise<object|null>}
 */
async function getRecording(userId, recordingId) {
  const res = await db.query(
    `SELECT * FROM recordings
     WHERE user_id = $1 AND (recording_id = $2 OR id::text = $2)`,
    [userId, recordingId]
  );

  return res.rows[0] || null;
}

/**
 * Deletes a recording record and optionally deletes the file from Google Drive.
 * @param {string} userId
 * @param {string} recordingId
 * @param {boolean} [deleteFromDrive=false]
 * @param {object} [injectedClient]
 * @returns {Promise<{ success: boolean, deletedFromDrive: boolean }>}
 */
async function deleteRecording(userId, recordingId, deleteFromDrive = false, injectedClient = null) {
  const record = await getRecording(userId, recordingId);
  if (!record) {
    const err = new Error('Recording not found');
    err.statusCode = 404;
    throw err;
  }

  let deletedFromDriveSuccess = false;
  if (deleteFromDrive && record.google_drive_file_id) {
    try {
      await deleteFile(userId, record.google_drive_file_id, injectedClient);
      deletedFromDriveSuccess = true;
    } catch (e) {
      logger.warn(`[Google Drive] Could not delete Drive file during recording deletion: ${e.message}`);
    }
  }

  await db.query('DELETE FROM recordings WHERE user_id = $1 AND recording_id = $2', [
    userId,
    record.recording_id
  ]);

  return {
    success: true,
    deletedFromDrive: deletedFromDriveSuccess
  };
}

module.exports = {
  isConfigured,
  createOAuth2Client,
  isRetryableError,
  withRetry,
  generateAuthUrl,
  consumeOAuthState,
  handleOAuthCallback,
  getConnectionStatus,
  disconnect,
  refreshUserToken,
  getAuthenticatedDriveClient,
  getStorageQuota,
  listFiles,
  createFolder,
  renameFile,
  moveFile,
  deleteFile,
  getFileMetadata,
  publishFile,
  createShareableLink,
  getFolderBreadcrumbs,
  getDefaultFolder,
  setDefaultFolder,
  uploadRecording,
  listRecordings,
  getRecording,
  deleteRecording,
  _activeRefreshPromises: activeRefreshPromises
};

