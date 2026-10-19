const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const aabAnalyzerService = require('../services/aabAnalyzerService');
const historyService = require('../services/historyService');
const appIconService = require('../services/appIconService');
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

      // Automatically extract and cache application launcher icon
      let hasIcon = false;
      try {
        const iconRes = await appIconService.extractAndCacheIcon(buildId, filePath);
        hasIcon = !!iconRes;
      } catch (e) {
        logger.warn(`Icon extraction error: ${e.message}`);
      }

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
        hasIcon,
        iconUrl: `/api/build/${buildId}/icon`,
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

      // Ensure each build has hasIcon and iconUrl populated
      const enhancedBuilds = builds.map(b => ({
        ...b,
        hasIcon: b.hasIcon !== undefined ? b.hasIcon : !!appIconService.getCachedIcon(b.id),
        iconUrl: b.iconUrl || `/api/build/${b.id}/icon`
      }));

      res.json({ success: true, count: enhancedBuilds.length, builds: enhancedBuilds });
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

      const enhancedBuild = {
        ...build,
        hasIcon: build.hasIcon !== undefined ? build.hasIcon : !!appIconService.getCachedIcon(build.id),
        iconUrl: build.iconUrl || `/api/build/${build.id}/icon`
      };

      res.json({ success: true, build: enhancedBuild });
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
        hasIcon: build.hasIcon !== undefined ? build.hasIcon : !!appIconService.getCachedIcon(build.id),
        iconUrl: build.iconUrl || `/api/build/${build.id}/icon`,
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

      appIconService.deleteCachedIcon(req.params.id);
      historyService.deleteBuild(req.params.id);
      res.json({ success: true, message: 'Build deleted successfully' });
    } catch (err) {
      next(err);
    }
  }

  /**
   * Serve application launcher icon with ETag & HTTP caching.
   * On-demand extracts and caches icon if missing from cache.
   */
  async getBuildIcon(req, res, next) {
    try {
      const { id } = req.params;
      if (!id || id.includes('..') || id.includes('/') || id.includes('\\')) {
        return res.status(400).json({ success: false, error: 'Invalid build ID.' });
      }

      let cached = appIconService.getCachedIcon(id);
      if (!cached) {
        // Attempt on-demand extraction from build file
        const build = historyService.getBuildById(id);
        if (build && build.filePath && fs.existsSync(build.filePath)) {
          await appIconService.extractAndCacheIcon(id, build.filePath);
          cached = appIconService.getCachedIcon(id);
        }
      }

      if (!cached || !fs.existsSync(cached.filePath)) {
        return res.status(404).json({ success: false, error: 'Icon not available for this build.' });
      }

      const stat = fs.statSync(cached.filePath);
      const eTag = `"${id}-${stat.mtimeMs}"`;
      if (req.headers['if-none-match'] === eTag) {
        return res.status(304).end();
      }

      res.setHeader('ETag', eTag);
      res.setHeader('Cache-Control', 'public, max-age=86400, must-revalidate');
      res.setHeader('Content-Type', cached.mimeType || 'image/png');
      res.sendFile(cached.filePath);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Serve icon by package name (matches newest build containing that package)
   */
  async getPackageIcon(req, res, next) {
    try {
      const { packageName } = req.params;
      if (!packageName || packageName.includes('..') || packageName.includes('/') || packageName.includes('\\')) {
        return res.status(400).json({ success: false, error: 'Invalid package name.' });
      }

      const builds = historyService.getBuilds();
      const matchingBuild = builds.find(b => b.packageName === packageName && (b.hasIcon || (b.filePath && fs.existsSync(b.filePath))));

      if (!matchingBuild) {
        return res.status(404).json({ success: false, error: 'No icon found for package.' });
      }

      req.params.id = matchingBuild.id;
      return this.getBuildIcon(req, res, next);
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new BuildController();
