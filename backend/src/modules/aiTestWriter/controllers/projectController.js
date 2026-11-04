const projectService = require('../services/projectService');

const projectController = {
  list: async (req, res) => {
    try {
      const userId = req.user.id;
      const userRole = req.user.role;
      const projects = await projectService.listProjects(userId, userRole);

      return res.status(200).json({
        success: true,
        data: projects
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        error: err.message
      });
    }
  },

  create: async (req, res) => {
    try {
      const userId = req.user.id;
      const project = await projectService.createProject(userId, req.body || {});

      return res.status(201).json({
        success: true,
        data: project
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  },

  getById: async (req, res) => {
    try {
      const { projectId } = req.params;
      const project = await projectService.getProjectById(projectId);

      return res.status(200).json({
        success: true,
        data: project
      });
    } catch (err) {
      const status = err.status || 500;
      return res.status(status).json({
        success: false,
        error: err.message
      });
    }
  }
};

module.exports = projectController;
