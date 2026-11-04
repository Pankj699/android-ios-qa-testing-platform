const db = require('../db/connection');

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Option B Authorization Middleware:
 * Enforces strict access restriction to:
 * 1. The Project Creator (ai_projects.created_by_user_id === req.user.id)
 * 2. Platform Administrator (req.user.role === 'ADMIN')
 */
async function verifyProjectAccess(req, res, next) {
  const projectId = req.params.projectId || req.body?.projectId || req.query?.projectId;

  if (!projectId || !UUID_REGEX.test(projectId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing project ID.'
    });
  }

  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in.'
    });
  }

  try {
    const result = await db.query(
      'SELECT id, name, slug, created_by_user_id, status FROM ai_projects WHERE id = $1',
      [projectId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Project not found.'
      });
    }

    const project = result.rows[0];
    const isCreator = project.created_by_user_id === req.user.id;
    const isAdmin = (req.user.role || '').toUpperCase() === 'ADMIN';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden. You do not have permission to access this project.'
      });
    }

    req.project = project;
    next();
  } catch (err) {
    console.error('[authOptionB] verifyProjectAccess error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal authorization error.'
    });
  }
}

/**
 * Verifies document existence and Option B authorization through its parent project.
 */
async function verifyDocumentAccess(req, res, next) {
  const documentId = req.params.documentId;
  const projectId = req.params.projectId;

  if (!documentId || !UUID_REGEX.test(documentId)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing document ID.'
    });
  }

  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in.'
    });
  }

  try {
    const result = await db.query(`
      SELECT d.id, d.project_id, d.title, d.original_filename, d.document_type, d.active_version_id,
             p.created_by_user_id as project_creator_id, p.name as project_name
      FROM ai_documents d
      JOIN ai_projects p ON p.id = d.project_id
      WHERE d.id = $1
    `, [documentId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Document not found.'
      });
    }

    const doc = result.rows[0];

    // If projectId was in URL params, assert cross-project integrity
    if (projectId && doc.project_id !== projectId) {
      return res.status(404).json({
        success: false,
        error: 'Document does not belong to the specified project.'
      });
    }

    const isCreator = doc.project_creator_id === req.user.id;
    const isAdmin = (req.user.role || '').toUpperCase() === 'ADMIN';

    if (!isCreator && !isAdmin) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden. You do not have permission to access this document.'
      });
    }

    req.document = doc;
    next();
  } catch (err) {
    console.error('[authOptionB] verifyDocumentAccess error:', err);
    return res.status(500).json({
      success: false,
      error: 'Internal authorization error.'
    });
  }
}

/**
 * Simple authentication check middleware.
 */
function requireAuth(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({
      success: false,
      error: 'Authentication required. Please sign in.'
    });
  }
  next();
}

module.exports = {
  verifyProjectAccess,
  verifyDocumentAccess,
  requireAuth
};
