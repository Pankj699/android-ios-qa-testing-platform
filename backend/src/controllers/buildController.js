const { v4: uuidv4 } = require('uuid');
const path = require('path');
const aabAnalyzerService = require('../services/aabAnalyzerService');
const historyService = require('../services/historyService');
const config = require('../config');
const logger = require('../utils/logger');

class BuildController {
  async uploadAab(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'Authentication required to upload builds.' });
      }

      if (!req.file) {
        return res.status(400).json({ success: false, error: 'No build file (.aab or .apk) was uploaded.' });
      }

      const filePath = req.file.path;
      const ext = path.extname(req.file.originalname).toLowerCase();
      const fileType = ext === '.apk' ? 'apk' : 'aab';
      const userId = req.user.id;
      const userName = req.user.name || 'QA Tester';
      const userEmail = req.user.email || '';

      logger.info(`Uploaded ${fileType.toUpperCase()}: ${req.file.originalname} (${req.file.size} bytes) by ${userName} (${userId})`);

      // Automatically analyze after upload
      let analysis = null;
      let analysisError = null;
      try {
        analysis = await aabAnalyzerService.analyzeAab(filePath);
      } catch (e) {
        logger.warn(`Initial analysis error: ${e.message}`);
        analysisError = e.message;
      }

      const buildId = uuidv4();
      const buildRecord = {
        id: buildId,
        userId,
        uploadedBy: userName,
        userEmail,
        fileName: req.file.originalname,
        storedFileName: req.file.filename,
        filePath,
        fileSize: req.file.size,
        fileType, // 'aab' | 'apk'
        applicationName: analysis ? analysis.applicationName : path.basename(req.file.originalname, ext),
        packageName: analysis ? analysis.packageName : 'Pending Analysis',
        versionName: analysis ? analysis.versionName : '1.0',
        versionCode: analysis ? analysis.versionCode : '1',
        minSdkVersion: analysis ? analysis.minSdkVersion : '24',
        targetSdkVersion: analysis ? analysis.targetSdkVersion : '34',
        assetPacks: analysis ? analysis.assetPacks : [],
        modulesCount: analysis ? analysis.modulesCount : 1,
        analysisError,
        uploadedAt: new Date().toISOString()
      };

      historyService.saveBuild(buildRecord);

      res.status(201).json({
        success: true,
        message: `${fileType.toUpperCase()} build uploaded and analyzed successfully`,
        build: buildRecord
      });
    } catch (err) {
      next(err);
    }
  }

  async listBuilds(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.json({ success: true, count: 0, builds: [] });
      }

      let builds = historyService.getBuilds();
      const userId = req.user.id;
      const isAdmin = (req.user.role || '').toLowerCase() === 'admin';
      const showAll = req.query.all === 'true' && isAdmin;

      // Filter strictly by user if not requesting all builds as admin
      if (!showAll) {
        builds = builds.filter(b => b.userId === userId);
      }

      res.json({ success: true, count: builds.length, builds });
    } catch (err) {
      next(err);
    }
  }

  async getBuild(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }

      const build = historyService.getBuildById(req.params.id);
      if (!build) {
        return res.status(404).json({ success: false, error: 'Build not found.' });
      }

      const userId = req.user.id;
      const isAdmin = (req.user.role || '').toLowerCase() === 'admin';
      if (!isAdmin && build.userId && build.userId !== userId) {
        return res.status(403).json({ success: false, error: 'Forbidden. You do not own this build.' });
      }

      res.json({ success: true, build });
    } catch (err) {
      next(err);
    }
  }

  async analyzeBuild(req, res, next) {
    try {
      const build = historyService.getBuildById(req.params.id);
      if (!build) {
        return res.status(404).json({ success: false, error: 'Build not found.' });
      }

      const analysis = await aabAnalyzerService.analyzeAab(build.filePath);
      const updatedBuild = {
        ...build,
        applicationName: analysis.applicationName,
        packageName: analysis.packageName,
        versionName: analysis.versionName,
        versionCode: analysis.versionCode,
        minSdkVersion: analysis.minSdkVersion,
        targetSdkVersion: analysis.targetSdkVersion,
        assetPacks: analysis.assetPacks,
        modulesCount: analysis.modulesCount,
        analysisError: null
      };

      historyService.saveBuild(updatedBuild);
      res.json({ success: true, build: updatedBuild });
    } catch (err) {
      next(err);
    }
  }

  async deleteBuild(req, res, next) {
    try {
      if (!req.user || !req.user.id) {
        return res.status(401).json({ success: false, error: 'Authentication required.' });
      }

      const build = historyService.getBuildById(req.params.id);
      if (!build) {
        return res.status(404).json({ success: false, error: 'Build not found.' });
      }

      const userId = req.user.id;
      const isAdmin = (req.user.role || '').toLowerCase() === 'admin';
      if (!isAdmin && build.userId && build.userId !== userId) {
        return res.status(403).json({ success: false, error: 'Forbidden. You do not have permission to delete this build.' });
      }

      historyService.deleteBuild(req.params.id);
      res.json({ success: true, message: 'Build deleted successfully' });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new BuildController();
