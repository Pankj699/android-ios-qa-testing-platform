// Native Authentication API Helpers & Request Client
const API_BASE = '/api';

let _cachedUser = null;

export function getAuthToken() {
  return null;
}

export function setAuthToken() {
  // HttpOnly cookies managed by browser
}

export function getCurrentUser() {
  return _cachedUser;
}

export function setCurrentUser(user) {
  _cachedUser = user;
}

async function request(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;

  const headers = {
    ...(!options.isFormData ? { 'Content-Type': 'application/json' } : {}),
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    ...(options.headers || {})
  };

  const config = {
    cache: 'no-store',
    ...options,
    credentials: 'include', // Automatically send HttpOnly qa_session cookie
    headers
  };

  if (options.body && !options.isFormData && typeof options.body === 'object') {
    config.body = JSON.stringify(options.body);
  }

  const response = await fetch(url, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || data.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

export function buildQueryString(params = {}) {
  if (!params || typeof params !== 'object') return '';
  const filtered = Object.entries(params).filter(
    ([_, v]) => v !== undefined && v !== null && v !== '' && v !== 'undefined' && v !== 'null'
  );
  if (filtered.length === 0) return '';
  return new URLSearchParams(Object.fromEntries(filtered)).toString();
}

export const api = {
  // Native Authentication Endpoints
  getAuthToken,
  setAuthToken,
  getCurrentUser,
  setCurrentUser,
  register: async (data) => {
    const res = await request('/auth/register', { method: 'POST', body: data });
    if (res?.user) _cachedUser = res.user;
    return res;
  },
  login: async (credentials) => {
    const res = await request('/auth/login', { method: 'POST', body: credentials });
    if (res?.user) _cachedUser = res.user;
    return res;
  },
  logout: async () => {
    try {
      await request('/auth/logout', { method: 'POST' });
    } finally {
      _cachedUser = null;
    }
  },
  getMe: async () => {
    const res = await request('/auth/me');
    if (res?.user) _cachedUser = res.user;
    return res;
  },
  forgotPassword: (email) => request('/auth/forgot-password', { method: 'POST', body: { email } }),
  resetPassword: (data) => request('/auth/reset-password', { method: 'POST', body: data }),

  // Devices & Pairing
  getDevices: () => request('/devices'),
  getDeviceInfo: (serial) => request(`/device/${encodeURIComponent(serial)}/info`),
  getDeviceStorage: (serial) => request(`/device/${encodeURIComponent(serial)}/storage`),
  pairDevice: (ip, port, code) => request('/device/pair', { method: 'POST', body: { ip, port, code } }),
  connectDevice: (ip, port) => request('/device/connect', { method: 'POST', body: { ip, port } }),
  disconnectDevice: (serial) => request(`/device/${encodeURIComponent(serial)}/disconnect`, { method: 'POST' }),
  claimDevice: (serial, durationMs) => request(`/device/${encodeURIComponent(serial)}/claim`, { method: 'POST', body: { durationMs } }),
  releaseDevice: (serial, force) => request(`/device/${encodeURIComponent(serial)}/release`, { method: 'POST', body: { force } }),

  // Android 11+ Wireless QR Pairing & Discovery
  startWirelessQrSession: () => request('/wireless/qr/start', { method: 'POST' }),
  getWirelessQrStatus: (sessionId) => request(`/wireless/qr/status/${encodeURIComponent(sessionId)}`),
  cancelWirelessQrSession: (sessionId) => request(`/wireless/qr/cancel/${encodeURIComponent(sessionId)}`, { method: 'POST' }),
  pairWirelessWithCode: (ip, port, code) => request('/wireless/pair-code', { method: 'POST', body: { ip, port, code } }),
  connectWirelessDevice: (ip, port, connectionMode = 'browser-wireless') => request('/wireless/connect', { method: 'POST', body: { ip, port, connectionMode } }),
  getDiscoveredWirelessDevices: () => request('/wireless/discovered'),
  getWirelessDiagnostics: () => request('/wireless/diagnostics'),

  // Builds
  getBuilds: (params = {}) => {
    const query = buildQueryString(params);
    return request(`/builds${query ? `?${query}` : ''}`);
  },
  getBuild: (id) => request(`/build/${id}`),
  uploadAab: (file, onProgress) => {
    const formData = new FormData();
    formData.append('file', file);
    return request('/build/upload', {
      method: 'POST',
      body: formData,
      isFormData: true
    });
  },
  analyzeBuild: (id) => request(`/build/${id}/analyze`, { method: 'POST' }),
  deleteBuild: (id) => request(`/build/${id}`, { method: 'DELETE' }),

  // Installed Applications & Tests
  getInstalledApps: (serial, params = {}) => {
    const query = buildQueryString(params);
    return request(`/device/${encodeURIComponent(serial)}/installed-apps${query ? `?${query}` : ''}`);
  },
  runTest: (params) => request('/test/run', { method: 'POST', body: params }),
  monitorInstalledApp: (params) => request('/test/monitor-installed', { method: 'POST', body: params }),
  getTest: (id) => request(`/test/${id}`),
  cancelTest: (id) => request(`/test/${id}/cancel`, { method: 'POST' }),
  getTestLogs: (id) => request(`/test/${id}/logs`),
  getTestHistory: (params = {}) => {
    const query = buildQueryString(params);
    return request(`/tests/history${query ? `?${query}` : ''}`);
  },
  deleteTest: (id) => request(`/test/${id}`, { method: 'DELETE' }),
  getSummaryStats: (params = {}) => {
    const query = buildQueryString(params);
    return request(`/tests/summary${query ? `?${query}` : ''}`);
  },

  // Browser USB Test Helpers
  prepareBrowserArtifact: (buildId) => request('/test/prepare-browser-artifact', {
    method: 'POST',
    body: { buildId }
  }),
  saveBrowserResult: (data) => request('/test/save-browser-result', {
    method: 'POST',
    body: data
  }),
  getArtifactUrl: (filename) => `${API_BASE}/test/artifact/${encodeURIComponent(filename)}`,
  downloadArtifactBlob: async (filename) => {
    const token = getAuthToken();
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const res = await fetch(`${API_BASE}/test/artifact/${encodeURIComponent(filename)}`, { headers });
    if (!res.ok) throw new Error(`Failed to download artifact: ${res.statusText}`);
    return await res.blob();
  },

  // Controlled ADB Operations
  clearAppData: (serial, packageName) => request(`/device/${encodeURIComponent(serial)}/clear-data`, {
    method: 'POST',
    body: { packageName }
  }),
  clearAppCache: (serial, packageName) => request(`/device/${encodeURIComponent(serial)}/clear-cache`, {
    method: 'POST',
    body: { packageName }
  }),
  uninstallApp: (serial, packageName) => request(`/device/${encodeURIComponent(serial)}/uninstall`, {
    method: 'POST',
    body: { packageName }
  }),
  launchApp: (serial, packageName) => request(`/device/${encodeURIComponent(serial)}/launch`, {
    method: 'POST',
    body: { packageName }
  }),
  clearLogcat: (serial) => request(`/device/${encodeURIComponent(serial)}/clear-logcat`, { method: 'POST' }),
  executeSafeAdb: (serial, command) => request('/adb/execute-safe', {
    method: 'POST',
    body: { serial, command }
  }),

  // Screen Mirroring & Screenshots
  startMirror: (serial, options = {}) => request(`/device/${encodeURIComponent(serial)}/mirror/start`, {
    method: 'POST',
    body: options
  }),
  stopMirror: (serial) => request(`/device/${encodeURIComponent(serial)}/mirror/stop`, {
    method: 'POST'
  }),
  getMirrorStatus: (serial) => request(`/device/${encodeURIComponent(serial)}/mirror/status`),
  takeScreenshot: (serial) => request(`/device/${encodeURIComponent(serial)}/screenshot`, {
    method: 'POST'
  }),
  getUiHierarchy: (serial) => request(`/device/${encodeURIComponent(serial)}/ui-hierarchy`, {
    method: 'POST'
  }),
  getRuntimeTypography: (serial, data) => request(`/device/${encodeURIComponent(serial)}/runtime-typography`, {
    method: 'POST',
    body: data
  }),
  sendDeviceInput: (serial, event) => request(`/device/${encodeURIComponent(serial)}/input`, {
    method: 'POST',
    body: event
  }),
  // QA Device Agent Management (iOS USB & Remote)
  generateAgentPairingCode: () => request('/agent/pairing-code', { method: 'POST' }),
  listAgents: () => request('/agent/list'),
  unpairAgent: (agentId) => request(`/agent/${encodeURIComponent(agentId)}/unpair`, { method: 'POST' }),

  // Admin User Management
  adminGetUsers: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.append('search', params.search);
    if (params.role) qs.append('role', params.role);
    if (params.status) qs.append('status', params.status);
    if (params.sortBy) qs.append('sortBy', params.sortBy);
    if (params.sortOrder) qs.append('sortOrder', params.sortOrder);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/admin/users${query}`);
  },
  adminGetUser: (id) => request(`/admin/users/${encodeURIComponent(id)}`),
  adminUpdateUser: (id, updates) => request(`/admin/users/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: updates
  }),
  adminResetPassword: (id, temporaryPassword = null) => request(`/admin/users/${encodeURIComponent(id)}/reset-password`, {
    method: 'POST',
    body: temporaryPassword ? { temporaryPassword } : {}
  }),

  // Admin Device Management & Controlled System Restart
  adminGetDeviceModels: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.search) qs.append('search', params.search);
    if (params.filter) qs.append('filter', params.filter);
    const query = qs.toString() ? `?${qs.toString()}` : '';
    return request(`/admin/devices/models${query}`);
  },
  adminAddDeviceModel: (data) => request('/admin/devices/models', { method: 'POST', body: data }),
  adminUploadDeviceImage: (manufacturer, model, formData) => request(
    `/admin/devices/models/${encodeURIComponent(manufacturer)}/${encodeURIComponent(model)}/image`,
    { method: 'POST', body: formData, isFormData: true }
  ),
  adminRemoveDeviceImage: (manufacturer, model) => request(
    `/admin/devices/models/${encodeURIComponent(manufacturer)}/${encodeURIComponent(model)}/image`,
    { method: 'DELETE' }
  ),
  adminDeleteDeviceModel: (manufacturer, model) => request(
    `/admin/devices/models/${encodeURIComponent(manufacturer)}/${encodeURIComponent(model)}`,
    { method: 'DELETE' }
  ),
  adminRestoreOriginalDeviceImage: (manufacturer, model) => request(
    `/admin/devices/models/${encodeURIComponent(manufacturer)}/${encodeURIComponent(model)}/restore-original`,
    { method: 'POST' }
  ),
  adminRestartBackend: () => request('/admin/system/restart', { method: 'POST' }),

  // Google Drive & Screen Recording
  getDriveStatus: () => request('/drive/status'),
  getDriveAuthUrl: async (prompt, origin) => {
    const params = new URLSearchParams();
    if (prompt) params.append('prompt', prompt);
    const resolvedOrigin = origin || (typeof window !== 'undefined' ? window.location.origin : '');
    if (resolvedOrigin) params.append('origin', resolvedOrigin);
    const q = params.toString() ? `?${params.toString()}` : '';
    try {
      return await request(`/drive/auth-url${q}`);
    } catch (err) {
      if (err.status === 404) {
        return await request(`/drive/auth/url${q}`);
      }
      throw err;
    }
  },
  disconnectDrive: () => request('/drive/disconnect', { method: 'POST' }),
  getDriveQuota: () => request('/drive/quota'),
  listDriveFiles: (params = {}) => {
    const qs = buildQueryString(params);
    return request(`/drive/files${qs ? `?${qs}` : ''}`);
  },
  createDriveFolder: (name, parentId) => request('/drive/folders', {
    method: 'POST',
    body: { name, parentId }
  }),
  getDriveFolderBreadcrumbs: (folderId) => request(`/drive/folders/${encodeURIComponent(folderId)}/breadcrumbs`),
  getDriveFileMetadata: (fileId) => request(`/drive/files/${encodeURIComponent(fileId)}`),
  renameDriveFile: (fileId, name) => request(`/drive/files/${encodeURIComponent(fileId)}/rename`, {
    method: 'PATCH',
    body: { name }
  }),
  moveDriveFile: (fileId, destinationFolderId, currentParentId) => request(`/drive/files/${encodeURIComponent(fileId)}/move`, {
    method: 'POST',
    body: { destinationFolderId, currentParentId }
  }),
  deleteDriveFile: (fileId) => request(`/drive/files/${encodeURIComponent(fileId)}`, {
    method: 'DELETE'
  }),
  shareDriveFile: (fileId) => request(`/drive/files/${encodeURIComponent(fileId)}/share`, {
    method: 'POST'
  }),
  publishDriveFile: (fileId, options = {}) => request(`/drive/files/${encodeURIComponent(fileId)}/publish`, {
    method: 'POST',
    body: options
  }),
  getDriveDefaultFolder: (params = {}) => {
    const qs = buildQueryString(params);
    return request(`/drive/default-folder${qs ? `?${qs}` : ''}`);
  },
  setDriveDefaultFolder: (folderId, folderName) => request('/drive/default-folder', {
    method: 'POST',
    body: { folderId, folderName }
  }),
  uploadScreenRecording: (formData, onProgress) => {
    if (onProgress && typeof XMLHttpRequest !== 'undefined') {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', `${API_BASE}/drive/upload-recording`);
        xhr.withCredentials = true;
        const token = getAuthToken();
        if (token) {
          xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        }

        if (xhr.upload) {
          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              onProgress(percent, event.loaded, event.total);
            }
          };
        }

        xhr.onload = () => {
          let data;
          try {
            data = JSON.parse(xhr.responseText);
          } catch (e) {
            data = {};
          }
          if (xhr.status >= 200 && xhr.status < 300 && data.success) {
            resolve(data);
          } else {
            const err = new Error(data.error || data.message || `Upload failed with status ${xhr.status}`);
            err.status = xhr.status;
            err.data = data;
            reject(err);
          }
        };

        xhr.onerror = () => {
          reject(new Error('Network error during recording upload'));
        };

        xhr.ontimeout = () => {
          reject(new Error('Recording upload timed out'));
        };

        xhr.send(formData);
      });
    }

    return request('/drive/upload-recording', {
      method: 'POST',
      body: formData,
      isFormData: true
    });
  },
  listRecordings: (params = {}) => {
    const qs = buildQueryString(params);
    return request(`/recordings${qs ? `?${qs}` : ''}`);
  },
  getRecording: (recordingId) => request(`/recordings/${encodeURIComponent(recordingId)}`),
  deleteRecording: (recordingId, deleteFromDrive = false) => {
    const q = deleteFromDrive ? '?deleteFromDrive=true' : '';
    return request(`/recordings/${encodeURIComponent(recordingId)}${q}`, {
      method: 'DELETE'
    });
  },

  // Mixpanel Event Validator
  getMixpanelStatus: () => request('/mixpanel/status'),
  getMixpanelSpecifications: () => request('/mixpanel/specifications'),
  uploadMixpanelSpecification: (file, name) => {
    const formData = new FormData();
    formData.append('file', file);
    if (name) formData.append('name', name);
    return request('/mixpanel/specifications', {
      method: 'POST',
      body: formData,
      isFormData: true
    });
  },
  getMixpanelSpecification: (id) => request(`/mixpanel/specifications/${encodeURIComponent(id)}`),
  deleteMixpanelSpecification: (id) => request(`/mixpanel/specifications/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  startMixpanelSession: (data) => request('/mixpanel/sessions', { method: 'POST', body: data }),
  getMixpanelSessions: () => request('/mixpanel/sessions'),
  getMixpanelSession: (id) => request(`/mixpanel/sessions/${encodeURIComponent(id)}`),
  stopMixpanelSession: (id) => request(`/mixpanel/sessions/${encodeURIComponent(id)}/stop`, { method: 'POST' }),
  getMixpanelEvents: (sessionId, params = {}) => {
    const qs = buildQueryString(params);
    return request(`/mixpanel/sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ''}`);
  },
  clearMixpanelEvents: (sessionId) => request(`/mixpanel/sessions/${encodeURIComponent(sessionId)}/events`, { method: 'DELETE' }),
  injectMixpanelEvent: (sessionId, payload) => request(`/mixpanel/sessions/${encodeURIComponent(sessionId)}/events/inject`, { method: 'POST', body: payload }),
  revalidateMixpanelEvent: (sessionId, eventId, specId) => request(`/mixpanel/sessions/${encodeURIComponent(sessionId)}/events/${encodeURIComponent(eventId)}/validate`, { method: 'POST', body: { specId } }),
  validateMixpanelRaw: (rawPayload, specId, rules) => request('/mixpanel/validate-raw', { method: 'POST', body: { rawPayload, specId, rules } }),

  // BugDesk Shared Device Catalog
  getBugDeskDevices: () => request('/bug-desk/devices'),
  createBugDeskDevice: (data) => request('/bug-desk/devices', { method: 'POST', body: data }),
  updateBugDeskDevice: (id, data) => request(`/bug-desk/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: data }),
  deleteBugDeskDevice: (id) => request(`/bug-desk/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // BugDesk PMS / Redmine Integration Options
  getBugDeskPmsOptions: (platform = 'android', customUrl = null, apiKey = null) => {
    const params = new URLSearchParams();
    if (platform) params.append('platform', platform);
    if (customUrl) params.append('customUrl', customUrl);
    const headers = {};
    if (apiKey && typeof apiKey === 'string' && apiKey.trim()) {
      headers['X-Redmine-API-Key'] = apiKey.trim();
    }
    const q = params.toString() ? `?${params.toString()}` : '';
    return request(`/bug-desk/pms/options${q}`, { headers });
  },
  testBugDeskPmsConnection: (apiKey) => request('/bug-desk/pms/test-connection', {
    method: 'POST',
    body: { apiKey }
  }),

  // Remote Config Manager
  getRemoteConfigApplications: (platform = 'android') => {
    const qs = buildQueryString({ platform });
    return request(`/remote-config/applications${qs ? `?${qs}` : ''}`);
  },
  getRemoteConfigs: (platform = 'android', app, extraParams = {}) => {
    const qs = buildQueryString({ platform, app, ...extraParams, _t: Date.now() });
    return request(`/remote-config/configs${qs ? `?${qs}` : ''}`);
  },
  createRemoteConfig: (data) => request('/remote-config/configs', {
    method: 'POST',
    body: data
  }),
  updateRemoteConfig: (id, data) => request(`/remote-config/configs/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: data
  }),
  toggleRemoteConfigActive: (id, data) => request(`/remote-config/configs/${encodeURIComponent(id)}/toggle`, {
    method: 'PATCH',
    body: data
  }),
  deleteRemoteConfig: (id, data) => request(`/remote-config/configs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    body: data
  }),

  // System
  getDiagnostics: () => request('/system/diagnostics'),
  getHealth: () => request('/system/health'),
  getEnv: () => request('/system/env')
};
