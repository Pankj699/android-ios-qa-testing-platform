const crypto = require('crypto');
const config = require('../config');

// In-memory set for replay protection with expiration timestamps
const consumedStates = new Map();

/**
 * Derives a 32-byte key for AES-256-GCM.
 * @param {string|Buffer} [customKey] Optional custom key
 * @returns {Buffer} 32-byte buffer
 */
function getEncryptionKey(customKey) {
  const rawKey = customKey || config.GOOGLE_TOKEN_ENCRYPTION_KEY;
  if (rawKey) {
    if (Buffer.isBuffer(rawKey) && rawKey.length === 32) {
      return rawKey;
    }
    if (typeof rawKey === 'string' && /^[0-9a-fA-F]{64}$/.test(rawKey)) {
      return Buffer.from(rawKey, 'hex');
    }
    return crypto.createHash('sha256').update(rawKey).digest();
  }

  // Fallback derived key using HMAC/SHA-256 from SESSION_SECRET
  return crypto
    .createHash('sha256')
    .update((config.SESSION_SECRET || 'qa_platform_default_key') + ':gdrive_token_aes256')
    .digest();
}

/**
 * Encrypts a plaintext token using AES-256-GCM.
 * @param {string} plainText The token to encrypt
 * @param {string|Buffer} [customKey] Optional key override
 * @returns {{ encrypted: string, iv: string, authTag: string }|null}
 */
function encryptToken(plainText, customKey = null) {
  if (!plainText || typeof plainText !== 'string') {
    return null;
  }

  const key = getEncryptionKey(customKey);
  const iv = crypto.randomBytes(12); // Standard 12-byte IV for AES-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');

  return {
    encrypted,
    iv: ivHex,
    authTag
  };
}

/**
 * Decrypts an encrypted token using AES-256-GCM.
 * @param {string} encryptedHex The encrypted token in hex
 * @param {string} ivHex The 12-byte IV in hex
 * @param {string} authTagHex The 16-byte auth tag in hex
 * @param {string|Buffer} [customKey] Optional key override
 * @returns {string|null} The decrypted plaintext token
 */
function decryptToken(encryptedHex, ivHex, authTagHex, customKey = null) {
  if (!encryptedHex || !ivHex || !authTagHex) {
    return null;
  }

  try {
    const key = getEncryptionKey(customKey);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);

    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    throw new Error('Failed to decrypt OAuth token: integrity check failed or invalid key');
  }
}

/**
 * Generates a signed, single-use, expiring OAuth state string bound to a userId.
 * @param {string} userId The user ID initiating OAuth
 * @param {object} [options]
 * @param {number} [options.ttlMs=600000] Time-to-live in milliseconds (default: 10 mins)
 * @param {string} [options.secret] Secret for HMAC signature
 * @returns {string} base64url encoded state string
 */
function generateOAuthState(userId, options = {}) {
  if (!userId) {
    throw new Error('userId is required to generate OAuth state');
  }

  const ttlMs = options.ttlMs || 10 * 60 * 1000;
  const secret = options.secret || config.SESSION_SECRET;
  const nonce = crypto.randomBytes(16).toString('hex');
  const expiresAt = Date.now() + ttlMs;
  const origin = options.origin || '';

  const hmac = crypto.createHmac('sha256', secret);
  if (origin) {
    hmac.update(`${userId}:${nonce}:${origin}:${expiresAt}`);
  } else {
    hmac.update(`${userId}:${nonce}:${expiresAt}`);
  }
  const sig = hmac.digest('hex');

  const stateObj = {
    userId,
    nonce,
    origin,
    expiresAt,
    sig
  };

  return Buffer.from(JSON.stringify(stateObj)).toString('base64url');
}

/**
 * Cleans up expired nonces from the replay protection cache.
 */
function cleanupExpiredNonces() {
  const now = Date.now();
  for (const [nonce, expiresAt] of consumedStates.entries()) {
    if (expiresAt < now) {
      consumedStates.delete(nonce);
    }
  }
}

/**
 * Validates, authenticates, and single-use consumes an OAuth state.
 * @param {string} stateString The state returned in callback
 * @param {string} [expectedUserId] If provided, verifies the state belongs to this user
 * @param {object} [options]
 * @param {string} [options.secret] Secret override for verification
 * @returns {{ userId: string, nonce: string, expiresAt: number }}
 */
function verifyAndConsumeOAuthState(stateString, expectedUserId = null, options = {}) {
  if (!stateString || typeof stateString !== 'string') {
    throw new Error('Missing or invalid OAuth state parameter');
  }

  let stateObj;
  try {
    const jsonStr = Buffer.from(stateString, 'base64url').toString('utf8');
    stateObj = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Malformed OAuth state format');
  }

  const { userId, nonce, origin = '', expiresAt, sig } = stateObj || {};
  if (!userId || !nonce || !expiresAt || !sig) {
    throw new Error('Incomplete OAuth state structure');
  }

  // 1. Check expiration
  if (Date.now() > Number(expiresAt)) {
    throw new Error('OAuth state has expired. Please initiate Google Drive connection again.');
  }

  // 2. Check cryptographic signature (tampering protection)
  const secret = options.secret || config.SESSION_SECRET;
  const hmac = crypto.createHmac('sha256', secret);
  if (origin) {
    hmac.update(`${userId}:${nonce}:${origin}:${expiresAt}`);
  } else {
    hmac.update(`${userId}:${nonce}:${expiresAt}`);
  }
  const expectedSig = hmac.digest('hex');

  let sigValid = false;
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      sigValid = true;
    }
  } catch (e) {
    sigValid = false;
  }

  if (!sigValid) {
    throw new Error('Invalid or tampered OAuth state signature');
  }

  // 3. User binding check
  if (expectedUserId && userId !== expectedUserId) {
    throw new Error('OAuth state user mismatch. State does not match current session user.');
  }

  // 4. Single-use replay protection check
  if (consumedStates.has(nonce)) {
    throw new Error('OAuth state has already been used (replay attempt detected)');
  }

  // Mark nonce as consumed
  consumedStates.set(nonce, Number(expiresAt));

  // Periodic cleanup
  if (consumedStates.size > 500) {
    cleanupExpiredNonces();
  }

  return {
    userId,
    nonce,
    origin,
    expiresAt: Number(expiresAt)
  };
}

/**
 * Validates and verifies an OAuth state signature and expiration without consuming it.
 * @param {string} stateString
 * @param {object} [options]
 * @returns {{ userId: string, nonce: string, origin: string, expiresAt: number }}
 */
function parseAndVerifyOAuthStateSignature(stateString, options = {}) {
  if (!stateString || typeof stateString !== 'string') {
    throw new Error('Missing or invalid OAuth state parameter');
  }

  let stateObj;
  try {
    const jsonStr = Buffer.from(stateString, 'base64url').toString('utf8');
    stateObj = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Malformed OAuth state format');
  }

  const { userId, nonce, origin = '', expiresAt, sig } = stateObj || {};
  if (!userId || !nonce || !expiresAt || !sig) {
    throw new Error('Incomplete OAuth state structure');
  }

  // 1. Check expiration
  if (Date.now() > Number(expiresAt)) {
    throw new Error('OAuth state has expired. Please initiate Google Drive connection again.');
  }

  // 2. Check cryptographic signature (tampering protection)
  const secret = options.secret || config.SESSION_SECRET;
  const hmac = crypto.createHmac('sha256', secret);
  if (origin) {
    hmac.update(`${userId}:${nonce}:${origin}:${expiresAt}`);
  } else {
    hmac.update(`${userId}:${nonce}:${expiresAt}`);
  }
  const expectedSig = hmac.digest('hex');

  let sigValid = false;
  try {
    const sigBuf = Buffer.from(sig, 'hex');
    const expectedBuf = Buffer.from(expectedSig, 'hex');
    if (sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      sigValid = true;
    }
  } catch (e) {
    sigValid = false;
  }

  if (!sigValid) {
    throw new Error('Invalid or tampered OAuth state signature');
  }

  return {
    userId,
    nonce,
    origin,
    expiresAt: Number(expiresAt)
  };
}

/**
 * Encrypts a token into a self-contained string "ciphertext:iv:authTag".
 */
function encryptSelfContained(plainText, customKey = null) {
  const enc = encryptToken(plainText, customKey);
  if (!enc) return null;
  return `${enc.encrypted}:${enc.iv}:${enc.authTag}`;
}

/**
 * Decrypts a self-contained string "ciphertext:iv:authTag".
 */
function decryptSelfContained(combined, customKey = null) {
  if (!combined || typeof combined !== 'string') return null;
  const parts = combined.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid self-contained encrypted token format');
  }
  return decryptToken(parts[0], parts[1], parts[2], customKey);
}

/**
 * Resets the in-memory consumed states cache (for unit testing purposes).
 */
function _resetConsumedStates() {
  consumedStates.clear();
}

module.exports = {
  getEncryptionKey,
  encryptToken,
  decryptToken,
  encryptSelfContained,
  decryptSelfContained,
  generateOAuthState,
  parseAndVerifyOAuthStateSignature,
  verifyAndConsumeOAuthState,
  _resetConsumedStates
};
