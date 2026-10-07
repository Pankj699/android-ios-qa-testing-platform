const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');

class HistoryService {
  constructor() {
    this.historyFile = path.join(config.DATA_DIR, 'test-history.json');
    this.buildsFile = path.join(config.DATA_DIR, 'builds.json');
    this.init();
  }

  init() {
    if (!fs.existsSync(config.DATA_DIR)) {
      fs.mkdirSync(config.DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(this.historyFile)) {
      fs.writeFileSync(this.historyFile, JSON.stringify([], null, 2), 'utf8');
    }
    if (!fs.existsSync(this.buildsFile)) {
      fs.writeFileSync(this.buildsFile, JSON.stringify([], null, 2), 'utf8');
    }
  }

  // --- Builds Management ---

  getBuilds(filters = {}) {
    try {
      if (fs.existsSync(this.buildsFile)) {
        let list = JSON.parse(fs.readFileSync(this.buildsFile, 'utf8'));
        if (filters.userId) {
          list = list.filter(b => b.userId === filters.userId || !b.userId);
        }
        return list;
      }
    } catch (e) {
      logger.error(`Failed to read builds file: ${e.message}`);
    }
    return [];
  }

  saveBuild(build) {
    const builds = this.getBuilds();
    const existingIndex = builds.findIndex(b => b.id === build.id);
    if (existingIndex >= 0) {
      builds[existingIndex] = { ...builds[existingIndex], ...build, updatedAt: new Date().toISOString() };
    } else {
      builds.unshift({ ...build, createdAt: new Date().toISOString() });
    }
    fs.writeFileSync(this.buildsFile, JSON.stringify(builds, null, 2), 'utf8');
    return build;
  }

  getBuildById(id) {
    const builds = this.getBuilds();
    return builds.find(b => b.id === id) || null;
  }

  deleteBuild(id) {
    const builds = this.getBuilds();
    const build = builds.find(b => b.id === id);
    if (build && build.filePath && fs.existsSync(build.filePath)) {
      try { fs.unlinkSync(build.filePath); } catch (e) {}
    }
    const filtered = builds.filter(b => b.id !== id);
    fs.writeFileSync(this.buildsFile, JSON.stringify(filtered, null, 2), 'utf8');
    return true;
  }

  // --- Test History Management ---

  getHistory(filters = {}) {
    try {
      if (fs.existsSync(this.historyFile)) {
        let list = JSON.parse(fs.readFileSync(this.historyFile, 'utf8'));
        if (filters.userId) {
          list = list.filter(t => t.userId === filters.userId || !t.userId);
        }
        if (filters.result) {
          list = list.filter(t => t.result.toUpperCase() === filters.result.toUpperCase());
        }
        if (filters.search) {
          const q = filters.search.toLowerCase();
          list = list.filter(t => 
            (t.packageName && t.packageName.toLowerCase().includes(q)) ||
            (t.deviceName && t.deviceName.toLowerCase().includes(q)) ||
            (t.version && t.version.toLowerCase().includes(q)) ||
            (t.id && t.id.toLowerCase().includes(q))
          );
        }
        return list;
      }
    } catch (e) {
      logger.error(`Failed to read test history: ${e.message}`);
    }
    return [];
  }

  getTestById(id) {
    const history = this.getHistory();
    return history.find(t => t.id === id) || null;
  }

  saveTest(testData) {
    const history = this.getHistory();
    const existingIndex = history.findIndex(t => t.id === testData.id);
    if (existingIndex >= 0) {
      history[existingIndex] = { ...history[existingIndex], ...testData, updatedAt: new Date().toISOString() };
    } else {
      history.unshift({ ...testData, createdAt: new Date().toISOString() });
    }
    fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2), 'utf8');
    return testData;
  }

  deleteTest(id) {
    const history = this.getHistory();
    const filtered = history.filter(t => t.id !== id);
    fs.writeFileSync(this.historyFile, JSON.stringify(filtered, null, 2), 'utf8');
    
    // Also remove log file
    const logPath = path.join(config.LOG_DIR, `test-${id}.log`);
    if (fs.existsSync(logPath)) {
      try { fs.unlinkSync(logPath); } catch (e) {}
    }
    return true;
  }

  getTestLog(id) {
    const logPath = path.join(config.LOG_DIR, `test-${id}.log`);
    if (fs.existsSync(logPath)) {
      return fs.readFileSync(logPath, 'utf8');
    }
    return '';
  }

  getSummaryStats(filters = {}) {
    const history = this.getHistory(filters);
    const total = history.length;
    const passed = history.filter(t => t.result === 'PASS').length;
    const failed = history.filter(t => t.result === 'FAIL').length;
    const running = history.filter(t => t.status === 'RUNNING' || t.status === 'QUEUED').length;
    const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

    return {
      totalTests: total,
      passed,
      failed,
      running,
      passRate: `${passRate}%`,
      recentTests: history.slice(0, 5)
    };
  }
}

module.exports = new HistoryService();
