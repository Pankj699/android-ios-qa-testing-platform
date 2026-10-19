const googleDriveService = require('../services/googleDriveService');
const logger = require('../utils/logger');

// Strict origin validation allowlist: allows localhost, loopback, private LAN IP, and valid hostname matches
function isAllowedOrigin(originStr, reqHost = null) {
  if (!originStr) return false;
  try {
    const u = new URL(originStr);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname.toLowerCase();
    // Allow localhost and loopback
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    // Allow private network IPs (192.168.x.x, 10.x.x.x, 172.16-31.x.x)
    if (/^(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})$/.test(host)) return true;
    // Allow configured backend host / nip.io / sslip.io hostnames
    if (host.endsWith('.nip.io') || host.endsWith('.sslip.io')) return true;
    // Allow same host as request
    if (reqHost) {
      const currentReqHost = reqHost.split(':')[0].toLowerCase();
      if (currentReqHost && host === currentReqHost) return true;
    }
    return false;
  } catch (_) {
    return false;
  }
}

/**
 * Generates Google OAuth authorization URL for the authenticated user.
 */
async function getAuthUrl(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const prompt = req.query.prompt === 'select_account' ? 'select_account' : 'consent';

    // Safely capture initiating origin (for popup completion redirect and cross-origin handling)
    let clientOrigin = req.query.origin || req.headers.origin || req.headers.referer || '';
    let validatedOrigin = '';
    if (clientOrigin && isAllowedOrigin(clientOrigin, req.headers.host)) {
      try {
        const u = new URL(clientOrigin);
        validatedOrigin = u.origin;
      } catch (_) {}
    }
    if (!validatedOrigin) {
      const proto = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      validatedOrigin = `${proto}://${req.headers.host || '192.168.0.163:8080'}`;
    }

    const { url, state } = await googleDriveService.generateAuthUrl(userId, { prompt, origin: validatedOrigin });

    return res.json({
      success: true,
      url,
      state
    });
  } catch (err) {
    const statusCode = err.statusCode || (err.code === 'NOT_CONFIGURED' ? 503 : 500);
    logger.error(`[DriveController] Failed to generate auth URL: ${err.message}`);
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to generate Google Drive authorization URL'
    });
  }
}

/**
 * Handles Google OAuth callback. Publicly accessible without Bearer token,
 * but user identity is strictly derived from validated server-side state.
 */
async function handleCallback(req, res) {
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  const isJsonExpected = Boolean(
    req.headers.accept?.includes('application/json') || req.query.format === 'json'
  );

  const { code, state, error: googleError } = req.query;

  // Derive target origin from signed state if available, verified against strict origin allowlist
  let targetOrigin = '';
  if (state) {
    try {
      const tokenCrypto = require('../utils/tokenCrypto');
      const parsed = tokenCrypto.parseAndVerifyOAuthStateSignature(state);
      if (parsed.origin && isAllowedOrigin(parsed.origin, req.headers.host)) {
        targetOrigin = parsed.origin;
      }
    } catch (_) {}
  }
  const currentProto = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const currentOrigin = `${currentProto}://${req.headers.host || '192.168.0.163:8080'}`;
  const isCrossOrigin = Boolean(targetOrigin && targetOrigin !== currentOrigin);

  logger.info(`[DriveOAuth] Callback reached. Protocol=${req.protocol} Secure=${req.secure} Host=${req.headers.host} currentOrigin=${currentOrigin} targetOrigin=${targetOrigin || currentOrigin} hasCode=${Boolean(code)} hasState=${Boolean(state)} hasError=${Boolean(googleError)}`);

  // Handle Google user cancellation or consent denial
  if (googleError) {
    const errorMsg = `Google authorization was cancelled or denied: ${googleError}`;
    logger.warn(`[DriveOAuth] Callback error from Google: ${googleError}`);

    if (isJsonExpected) {
      logger.info('[DriveOAuth] Response sent: 400 error json (Google denied)');
      return res.status(400).json({ success: false, error: errorMsg });
    }

    if (isCrossOrigin) {
      logger.info(`[DriveOAuth] Redirecting error popup to parent origin ${targetOrigin}...`);
      return res.redirect(`${targetOrigin}/api/drive/oauth-complete?status=error&error=${encodeURIComponent(errorMsg)}`);
    }

    logger.info('[DriveOAuth] Response sent: 400 error html (Google denied)');
    return renderOAuthCompleteHtml(res, { status: 'error', error: errorMsg });
  }

  if (!code || !state) {
    const errorMsg = 'Missing authorization code or state parameter';
    logger.warn(`[DriveOAuth] Callback missing required params. hasCode=${Boolean(code)} hasState=${Boolean(state)}`);
    if (isJsonExpected) {
      logger.info('[DriveOAuth] Response sent: 400 missing params json');
      return res.status(400).json({ success: false, error: errorMsg });
    }

    if (isCrossOrigin) {
      logger.info(`[DriveOAuth] Redirecting missing params popup to parent origin ${targetOrigin}...`);
      return res.redirect(`${targetOrigin}/api/drive/oauth-complete?status=error&error=${encodeURIComponent(errorMsg)}`);
    }

    logger.info('[DriveOAuth] Response sent: 400 missing params html');
    return renderOAuthCompleteHtml(res, { status: 'error', error: errorMsg });
  }

  try {
    const result = await googleDriveService.handleOAuthCallback(code, state);
    const candidateOrigin = result.origin || targetOrigin || currentOrigin;
    const destinationOrigin = isAllowedOrigin(candidateOrigin, req.headers.host) ? candidateOrigin : currentOrigin;
    const needsRedirect = Boolean(destinationOrigin && destinationOrigin !== currentOrigin);

    if (isJsonExpected) {
      logger.info('[DriveOAuth] Response sent: 200 success json');
      return res.json({
        success: true,
        message: 'Google Drive connected successfully',
        email: result.email,
        name: result.name
      });
    }

    if (needsRedirect) {
      logger.info(`[DriveOAuth] Redirecting popup to parent origin ${destinationOrigin}...`);
      const completeUrl = `${destinationOrigin}/api/drive/oauth-complete?status=success&email=${encodeURIComponent(result.email || '')}&name=${encodeURIComponent(result.name || '')}`;
      return res.redirect(completeUrl);
    }

    logger.info('[DriveOAuth] Response sent: 200 success html popup');
    return renderOAuthCompleteHtml(res, { status: 'success', email: result.email, name: result.name });
  } catch (err) {
    const statusCode = err.statusCode || (err.message.includes('replay') ? 409 : 400);
    logger.error(`[DriveOAuth] Callback exchange failed: ${err.message}`);

    if (isJsonExpected) {
      logger.info(`[DriveOAuth] Response sent: ${statusCode} failure json`);
      return res.status(statusCode).json({
        success: false,
        error: err.message || 'Failed to exchange authorization code for tokens'
      });
    }

    if (isCrossOrigin) {
      logger.info(`[DriveOAuth] Redirecting failure popup to parent origin ${targetOrigin}...`);
      const completeUrl = `${targetOrigin}/api/drive/oauth-complete?status=error&error=${encodeURIComponent(err.message || 'Authentication failed')}`;
      return res.redirect(completeUrl);
    }

    logger.info(`[DriveOAuth] Response sent: ${statusCode} failure html popup`);
    return renderOAuthCompleteHtml(res, { status: 'error', error: err.message || 'Authentication failed', statusCode });
  }
}

/**
 * Helper to render the OAuth completion HTML page.
 * Rendered either directly or via /api/drive/oauth-complete on the parent window's origin.
 */
function renderOAuthCompleteHtml(res, { status, email = '', name = '', error = '', statusCode = null }) {
  res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

  const isSuccess = status === 'success';
  const code = statusCode || (isSuccess ? 200 : 400);

  const safeEmail = String(email || '').replace(/[<>"']/g, '');
  const safeName = String(name || '').replace(/[<>"']/g, '');
  const safeError = String(error || '').replace(/[<>"']/g, '');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${isSuccess ? 'Google Drive Connected' : 'Google Drive Authorization Cancelled'}</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: #090C12;
      color: #E2E8F0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
    }
    .card {
      background: #0D1017;
      border: 1px solid #1E2638;
      border-radius: 16px;
      padding: 32px 28px;
      text-align: center;
      max-width: 400px;
      width: 100%;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }
    .badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      margin-bottom: 16px;
      font-size: 24px;
    }
    .badge-success { background: rgba(16, 185, 129, 0.15); color: #10B981; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-error { background: rgba(239, 68, 68, 0.15); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.3); }
    h2 { font-size: 18px; font-weight: 700; color: #FFFFFF; margin: 0 0 8px; }
    p { font-size: 13px; color: #94A3B8; margin: 4px 0; line-height: 1.5; }
    .email-chip {
      display: inline-block;
      margin-top: 10px;
      padding: 4px 12px;
      border-radius: 20px;
      background: rgba(245, 158, 11, 0.1);
      border: 1px solid rgba(245, 158, 11, 0.3);
      color: #F59E0B;
      font-weight: 600;
      font-size: 12px;
      font-family: monospace;
      word-break: break-all;
    }
    .status-text { margin-top: 18px; font-size: 11px; color: #64748B; }
    .action-link {
      display: inline-block;
      margin-top: 16px;
      font-size: 12px;
      color: #F59E0B;
      text-decoration: none;
      font-weight: 600;
    }
    .action-link:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="card">
    ${isSuccess ? `
      <div class="badge badge-success">✓</div>
      <h2>Google Drive Connected Successfully</h2>
      <p>Connected account: <strong>${safeEmail || 'Google Account'}</strong></p>
      <div class="email-chip">${safeEmail || 'Google Account'}</div>
      <p class="status-text">This window will close automatically...</p>
    ` : `
      <div class="badge badge-error">✕</div>
      <h2>${safeError.includes('cancelled') || safeError.includes('denied') ? 'Google Authorization Cancelled' : 'Google Drive Connection Failed'}</h2>
      <p style="color: #ff8080;">${safeError || 'An error occurred during authentication'}</p>
      <p class="status-text">This window will close automatically...</p>
    `}
    <a href="/drive" class="action-link" target="_self">Return to QA Platform</a>
  </div>
  <script>
    (function() {
      var isSuccess = ${isSuccess ? 'true' : 'false'};
      var payload = isSuccess ? {
        type: 'GDRIVE_AUTH_SUCCESS',
        email: ${JSON.stringify(safeEmail)},
        name: ${JSON.stringify(safeName)}
      } : {
        type: 'GDRIVE_AUTH_ERROR',
        error: ${JSON.stringify(safeError || 'Authentication failed')}
      };

      // 1. Post to opener with exact origin
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
        }
      } catch (e) {}

      // 2. BroadcastChannel companion for reliable same-origin cross-window messaging
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          var bc = new BroadcastChannel('gdrive_oauth_channel');
          bc.postMessage(payload);
          bc.close();
        }
      } catch (e) {}

      // 3. Automatically close popup
      setTimeout(function() {
        try { window.close(); } catch (e) {}
      }, isSuccess ? 800 : 2500);
    })();
  </script>
</body>
</html>`;

  return res.status(code).send(html);
}

/**
 * Dedicated OAuth completion endpoint rendered on the parent window's origin.
 */
function handleOAuthComplete(req, res) {
  const { status, email = '', name = '', error = '' } = req.query;
  return renderOAuthCompleteHtml(res, { status, email, name, error });
}

/**
 * Retrieves the connection status and profile of the current user's Google Drive.
 */
async function getStatus(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const status = await googleDriveService.getConnectionStatus(userId);
    return res.json({
      success: true,
      ...status
    });
  } catch (err) {
    logger.error(`[DriveController] Failed to retrieve status: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve Google Drive connection status'
    });
  }
}

/**
 * Disconnects the current user's Google Drive connection safely.
 */
async function disconnect(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    await googleDriveService.disconnect(userId);
    return res.json({
      success: true,
      message: 'Google Drive disconnected successfully'
    });
  } catch (err) {
    logger.error(`[DriveController] Disconnect failed: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to disconnect Google Drive'
    });
  }
}

/**
 * Retrieves storage quota information for the connected user.
 */
async function getQuota(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const quota = await googleDriveService.getStorageQuota(userId);
    return res.json({
      success: true,
      quota
    });
  } catch (err) {
    const statusCode = err.statusCode || (err.code === 'NOT_CONNECTED' ? 404 : 500);
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to retrieve storage quota'
    });
  }
}

/**
 * Lists files and folders from Google Drive.
 */
async function listFiles(req, res) {
  try {
    const userId = req.user.id;
    const { folderId, pageSize, pageToken, fileType, search } = req.query;

    const result = await googleDriveService.listFiles(userId, {
      folderId,
      pageSize,
      pageToken,
      fileType,
      search
    });

    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    logger.error(`[DriveController] List files error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to list Google Drive files'
    });
  }
}

/**
 * Creates a new folder in Google Drive.
 */
async function createFolder(req, res) {
  try {
    const userId = req.user.id;
    const { name, parentId } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Folder name is required'
      });
    }

    const folder = await googleDriveService.createFolder(userId, name, parentId);
    return res.json({
      success: true,
      folder
    });
  } catch (err) {
    logger.error(`[DriveController] Create folder error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to create folder'
    });
  }
}

/**
 * Renames a file or folder in Google Drive.
 */
async function renameFile(req, res) {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({
        success: false,
        error: 'New file name is required'
      });
    }

    const file = await googleDriveService.renameFile(userId, fileId, name);
    return res.json({
      success: true,
      file
    });
  } catch (err) {
    logger.error(`[DriveController] Rename file error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to rename file'
    });
  }
}

/**
 * Moves a file or folder to a different parent folder.
 */
async function moveFile(req, res) {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;
    const { destinationFolderId, currentParentId } = req.body;

    if (!destinationFolderId) {
      return res.status(400).json({
        success: false,
        error: 'Destination folder ID is required'
      });
    }

    const file = await googleDriveService.moveFile(userId, fileId, destinationFolderId, currentParentId);
    return res.json({
      success: true,
      file
    });
  } catch (err) {
    logger.error(`[DriveController] Move file error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to move file'
    });
  }
}

/**
 * Deletes a file or folder from Google Drive.
 */
async function deleteFile(req, res) {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;

    const result = await googleDriveService.deleteFile(userId, fileId);
    return res.json({
      success: true,
      ...result,
      message: 'File successfully deleted from Google Drive'
    });
  } catch (err) {
    logger.error(`[DriveController] Delete file error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to delete file from Google Drive'
    });
  }
}

/**
 * Retrieves metadata for a file in Google Drive.
 */
async function getFileMetadata(req, res) {
  try {
    const userId = req.user.id;
    const { fileId } = req.params;

    const metadata = await googleDriveService.getFileMetadata(userId, fileId);
    return res.json({
      success: true,
      metadata
    });
  } catch (err) {
    logger.error(`[DriveController] Get file metadata error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to retrieve file metadata'
    });
  }
}

/**
 * Publishes a Google Drive file by creating or reusing a public sharing permission and returning a shareable link.
 */
async function publishFile(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
    }

    const fileId = req.params?.fileId || req.body?.fileId;
    if (!fileId || typeof fileId !== 'string' || !fileId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'File ID is required'
      });
    }

    const { role, type } = req.body || {};
    const result = await googleDriveService.publishFile(userId, fileId.trim(), { role, type });

    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    logger.error(`[DriveController] Publish file error: ${err.message}`);
    const statusCode = err.statusCode || (err.code === 'NOT_CONNECTED' ? 401 : 500);
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to publish Google Drive file link'
    });
  }
}

const createShareableLink = publishFile;
const publishRecording = publishFile;

/**
 * Retrieves the user's default upload folder.
 */
async function getDefaultFolder(req, res) {
  try {
    const userId = req.user.id;
    const shouldResolve = req.query.resolve === 'true' || req.query.refresh === 'true';
    const folder = await googleDriveService.getDefaultFolder(userId, { resolve: shouldResolve });
    return res.json({
      success: true,
      ...folder
    });
  } catch (err) {
    logger.error(`[DriveController] Get default folder error: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve default folder'
    });
  }
}

/**
 * Sets the user's default upload folder.
 */
async function setDefaultFolder(req, res) {
  try {
    const userId = req.user.id;
    const { folderId, folderName } = req.body;

    const result = await googleDriveService.setDefaultFolder(userId, folderId, folderName);
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    logger.error(`[DriveController] Set default folder error: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to set default folder'
    });
  }
}

/**
 * Uploads a screen recording file to Google Drive and tracks metadata.
 */
async function uploadRecording(req, res) {
  try {
    const userId = req.user.id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No video recording file provided in request'
      });
    }

    const {
      durationSec,
      deviceSerial,
      deviceName,
      testId,
      folderId,
      recordingId,
      originalFilename
    } = req.body;

    const recording = await googleDriveService.uploadRecording(userId, {
      filePath: req.file.path,
      originalFilename: originalFilename || req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      durationSec,
      deviceSerial,
      deviceName,
      testId,
      folderId,
      recordingId
    });

    return res.json({
      success: true,
      recording
    });
  } catch (err) {
    logger.error(`[DriveController] Recording upload error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to upload screen recording'
    });
  }
}

/**
 * Lists recordings for the current user.
 */
async function listRecordings(req, res) {
  try {
    const userId = req.user.id;
    const recordings = await googleDriveService.listRecordings(userId, req.query);
    return res.json({
      success: true,
      recordings
    });
  } catch (err) {
    logger.error(`[DriveController] List recordings error: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to list recordings'
    });
  }
}

/**
 * Retrieves a single recording by recordingId.
 */
async function getRecording(req, res) {
  try {
    const userId = req.user.id;
    const { recordingId } = req.params;

    const recording = await googleDriveService.getRecording(userId, recordingId);
    if (!recording) {
      return res.status(404).json({
        success: false,
        error: 'Recording not found'
      });
    }

    return res.json({
      success: true,
      recording
    });
  } catch (err) {
    logger.error(`[DriveController] Get recording error: ${err.message}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve recording'
    });
  }
}

/**
 * Deletes a recording record (and optionally from Google Drive).
 */
async function deleteRecording(req, res) {
  try {
    const userId = req.user.id;
    const { recordingId } = req.params;
    const deleteFromDrive = req.query.deleteFromDrive === 'true';

    const result = await googleDriveService.deleteRecording(userId, recordingId, deleteFromDrive);
    return res.json({
      success: true,
      ...result,
      message: 'Recording deleted successfully'
    });
  } catch (err) {
    logger.error(`[DriveController] Delete recording error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to delete recording'
    });
  }
}

/**
 * Resolves the breadcrumbs path for a Google Drive folder.
 */
async function getFolderBreadcrumbs(req, res) {
  try {
    const userId = req.user.id;
    const { folderId } = req.params;

    const result = await googleDriveService.getFolderBreadcrumbs(userId, folderId);
    return res.json({
      success: true,
      ...result
    });
  } catch (err) {
    logger.error(`[DriveController] Get folder breadcrumbs error: ${err.message}`);
    const statusCode = err.statusCode || 500;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Failed to retrieve folder breadcrumbs'
    });
  }
}

/**
 * Diagnostic endpoint reporting effective OAuth configuration and redirect URI source.
 * Safe for internal QA: never exposes client secret, tokens, or encryption keys.
 */
async function getDiagnostics(req, res) {
  try {
    const config = require('../config');
    const redirectUri = config.GOOGLE_REDIRECT_URI || '';
    let parsedUri = null;
    try {
      const u = new URL(redirectUri);
      parsedUri = {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? '443' : '80'),
        pathname: u.pathname
      };
    } catch (_) {}

    return res.json({
      success: true,
      diagnostic: {
        effectiveRedirectUri: redirectUri,
        redirectUriSource: config.GOOGLE_REDIRECT_URI_SOURCE || 'unknown',
        parsedRedirectUri: parsedUri,
        clientIdConfigured: Boolean(config.GOOGLE_CLIENT_ID),
        clientSecretConfigured: Boolean(config.GOOGLE_CLIENT_SECRET),
        encryptionKeyConfigured: Boolean(config.GOOGLE_TOKEN_ENCRYPTION_KEY),
        serverHost: req.headers.host || '',
        serverProto: req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http',
        serverPort: config.PORT,
        isHttpsActive: config.USE_HTTPS
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

module.exports = {
  getAuthUrl,
  handleCallback,
  handleOAuthComplete,
  getStatus,
  disconnect,
  getQuota,
  listFiles,
  createFolder,
  renameFile,
  moveFile,
  deleteFile,
  getFileMetadata,
  getFolderBreadcrumbs,
  publishFile,
  publishRecording,
  createShareableLink,
  getDefaultFolder,
  setDefaultFolder,
  uploadRecording,
  listRecordings,
  getRecording,
  deleteRecording,
  getDiagnostics
};
