const db = require('../db/connection');

/**
 * Lists projects accessible to the user under Option B:
 * - Admin sees all projects
 * - Regular users see projects where created_by_user_id === userId
 */
async function listProjects(userId, userRole) {
  const isAdmin = (userRole || '').toUpperCase() === 'ADMIN';

  if (isAdmin) {
    const res = await db.query(`
      SELECT p.*,
        (SELECT count(*) FROM ai_documents d WHERE d.project_id = p.id) as document_count
      FROM ai_projects p
      ORDER BY p.updated_at DESC
    `);
    return res.rows;
  }

  const res = await db.query(`
    SELECT p.*,
      (SELECT count(*) FROM ai_documents d WHERE d.project_id = p.id) as document_count
    FROM ai_projects p
    WHERE p.created_by_user_id = $1
    ORDER BY p.updated_at DESC
  `, [userId]);

  return res.rows;
}

/**
 * Creates a new project in qa_ai_platform.
 */
async function createProject(userId, data) {
  const { name, slug, description, app_package_name } = data;

  if (!name || typeof name !== 'string' || !name.trim()) {
    const err = new Error('Project name is required.');
    err.status = 400;
    throw err;
  }

  const projectSlug = (slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')) || `proj-${Date.now()}`;

  const res = await db.query(`
    INSERT INTO ai_projects (
      name, slug, description, app_package_name, created_by_user_id
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *
  `, [name.trim(), projectSlug, description || null, app_package_name || null, userId]);

  return res.rows[0];
}

/**
 * Retrieves a single project by ID.
 */
async function getProjectById(projectId) {
  const res = await db.query(`
    SELECT p.*,
      (SELECT count(*) FROM ai_documents d WHERE d.project_id = p.id) as document_count
    FROM ai_projects p
    WHERE p.id = $1
  `, [projectId]);

  if (res.rows.length === 0) {
    const err = new Error('Project not found.');
    err.status = 404;
    throw err;
  }

  return res.rows[0];
}

module.exports = {
  listProjects,
  createProject,
  getProjectById
};
