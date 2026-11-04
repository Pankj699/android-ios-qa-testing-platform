import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Bot,
  UploadCloud,
  FileArchive,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Plus,
  Trash2,
  Clock,
  Play,
  RotateCcw,
  StopCircle,
  Search,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Info,
  Copy,
  Check,
  Terminal,
  ShieldAlert,
  X
} from 'lucide-react';
import { api } from '../services/api';
import { toast } from '../utils/toast';
import Tooltip from '../components/ui/Tooltip';
import CustomSelect from '../components/ui/select';
import DeviceThumbnail from '../components/DeviceThumbnail';

// Canonical mapping of Android OS release versions to API levels
const ANDROID_RELEASE_TO_API = {
  '16': [36, 37, 38],
  '15': [35],
  '14': [34],
  '13': [33],
  '12': [31, 32],
  '12l': [32],
  '11': [30],
  '10': [29],
  '9': [28],
  '8.1': [27],
  '8.0': [26],
  '8': [26, 27],
  '7.1': [25],
  '7.0': [24],
  '7': [24, 25],
  '6': [23],
  '5': [21, 22]
};

// Formats supported API versions matching Firebase Console (e.g. "API 34, 36" or "API 26 – 35" or "API 36")
function formatSupportedApiLabel(supportedVersionIds) {
  if (!supportedVersionIds || !Array.isArray(supportedVersionIds) || supportedVersionIds.length === 0) {
    return 'API N/A';
  }
  const nums = supportedVersionIds
    .map(v => parseInt(v, 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  if (nums.length === 0) return 'API N/A';
  if (nums.length === 1) return `API ${nums[0]}`;

  // If 3 or more consecutive numbers, format as range: "API 26 – 35"
  const isContiguous = nums.length >= 3 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (isContiguous) {
    return `API ${nums[0]} – ${nums[nums.length - 1]}`;
  }

  return `API ${nums.join(', ')}`;
}

// Resolves human-readable Android version using actual Firebase versions catalog
function getAndroidVersionLabel(versionId, catalogVersions = []) {
  if (!versionId) return 'Unknown OS';
  const v = catalogVersions.find(cv => String(cv.id) === String(versionId));
  const fallbackNames = {
    '38': 'Android 16+ Preview',
    '37': 'Android 16+ Preview',
    '36': 'Android 16 (Baklava)',
    '35': 'Android 15 (VanillaIceCream)',
    '34': 'Android 14 (UpsideDownCake)',
    '33': 'Android 13 (Tiramisu)',
    '32': 'Android 12L',
    '31': 'Android 12',
    '30': 'Android 11',
    '29': 'Android 10',
    '28': 'Android 9 (Pie)',
    '27': 'Android 8.1',
    '26': 'Android 8.0',
    '25': 'Android 7.1',
    '24': 'Android 7.0',
    '23': 'Android 6.0',
    '22': 'Android 5.1',
    '21': 'Android 5.0'
  };
  if (v) {
    const osVer = (v.versionString && v.versionString !== v.id)
      ? `Android ${v.versionString}`
      : (fallbackNames[versionId]?.split(' (')[0] || `Android ${versionId}`);
    const codeName = v.codeName ? ` (${v.codeName})` : '';
    return `${osVer} (API ${v.id})${codeName}`;
  }
  return fallbackNames[versionId] ? `${fallbackNames[versionId]}` : `API ${versionId}`;
}

// Intelligent matcher against actual device metadata and supported API versions
function matchDeviceWithQuery(m, rawQuery, catalogVersions = []) {
  if (!rawQuery) return true;
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const supportedVersionIds = (m.supportedVersionIds || []).map(v => String(v).trim().toLowerCase());
  const supportedVersions = Array.isArray(m.supportedVersions) && m.supportedVersions.length > 0
    ? m.supportedVersions
    : catalogVersions.filter(v => supportedVersionIds.includes(String(v.id).toLowerCase()));

  const apiLevels = supportedVersions.map(v => v.apiLevel || parseInt(v.id, 10)).filter(n => !isNaN(n));
  supportedVersionIds.forEach(id => {
    const num = parseInt(id, 10);
    if (!isNaN(num) && !apiLevels.includes(num)) apiLevels.push(num);
  });

  const versionStrings = supportedVersions.map(v => String(v.versionString || '').trim().toLowerCase());
  const codeNames = supportedVersions.map(v => String(v.codeName || '').trim().toLowerCase());

  // 1. "API <number>" query (e.g. API 36, API 35)
  const apiMatch = q.match(/^api[:\s-]*(\d+)$/i);
  if (apiMatch) {
    const targetApi = apiMatch[1];
    const targetNum = parseInt(targetApi, 10);
    if (supportedVersionIds.includes(targetApi) || apiLevels.includes(targetNum)) return true;
  }

  // 2. "Android <version>" query (e.g. Android 16, Android 14)
  const androidMatch = q.match(/^android[:\s-]*(\d+(?:\.\d+)?)$/i);
  if (androidMatch) {
    const targetVer = androidMatch[1];
    if (versionStrings.includes(targetVer)) return true;
    const mapped = ANDROID_RELEASE_TO_API[targetVer] || [];
    if (mapped.some(api => apiLevels.includes(api) || supportedVersionIds.includes(String(api)))) {
      return true;
    }
    if (supportedVersionIds.includes(targetVer)) return true;
  }

  // 3. Pure numeric search (e.g. "36", "14")
  if (/^\d+$/.test(q)) {
    const num = parseInt(q, 10);
    if (supportedVersionIds.includes(q) || apiLevels.includes(num)) return true;
    if (versionStrings.includes(q)) return true;
    const mapped = ANDROID_RELEASE_TO_API[q];
    if (mapped && mapped.some(api => apiLevels.includes(api) || supportedVersionIds.includes(String(api)))) {
      return true;
    }
  }

  // 4. Code names and "api XX" substrings
  if (codeNames.some(cn => cn.includes(q))) return true;
  if (supportedVersionIds.some(vid => `api ${vid}`.includes(q) || `api${vid}`.includes(q))) return true;
  if (apiLevels.some(api => `api ${api}`.includes(q) || `api${api}`.includes(q))) return true;

  // 5. Name, ID, Brand, FormFactor, Form, Tags
  const nameMatch = m.name && m.name.toLowerCase().includes(q);
  const idMatch = m.id && m.id.toLowerCase().includes(q);
  const brandMatch = m.brand && m.brand.toLowerCase().includes(q);
  const formFactorMatch = m.formFactor && m.formFactor.toLowerCase().includes(q);
  const formMatch = m.form && m.form.toLowerCase().includes(q);
  const tagsMatch = Array.isArray(m.tags) && m.tags.some(t => t.toLowerCase().includes(q));

  return !!(nameMatch || idMatch || brandMatch || formFactorMatch || formMatch || tagsMatch);
}

// Device Selection Card matching Firebase Console design
function FirebaseDeviceCard({
  model,
  isInMatrix,
  matrixCount,
  onOpenConfigure
}) {
  const isVirtual = model.form === 'VIRTUAL';
  const isTablet = model.formFactor === 'TABLET';
  const apiLabel = formatSupportedApiLabel(model.supportedVersionIds);

  return (
    <div
      onClick={() => onOpenConfigure(model)}
      className={`group relative flex items-center justify-between gap-3 p-3.5 rounded-2xl border transition-all cursor-pointer select-none ${
        isInMatrix
          ? 'bg-violet-50/80 dark:bg-[#1E2335] border-violet-500/70 dark:border-violet-500/60 shadow-xs ring-1 ring-violet-500/30'
          : 'bg-white dark:bg-[#181C26] hover:bg-slate-50 dark:hover:bg-[#1E2330] border-slate-200/90 dark:border-[#262D3D] hover:border-violet-400 dark:hover:border-violet-500/40 shadow-xs'
      }`}
    >
      {/* Virtual Pill Badge */}
      {isVirtual && (
        <span className="absolute -top-2 left-3 text-[9.5px] font-bold px-2 py-0.5 rounded-full bg-slate-800 text-slate-200 dark:bg-slate-700 dark:text-slate-100 border border-slate-600/50 shadow-xs tracking-wider uppercase">
          Virtual
        </span>
      )}

      {/* Left: Device Image / Illustration */}
      <div className="shrink-0 flex items-center justify-center">
        <DeviceThumbnail
          device={{
            name: model.name,
            displayName: model.name,
            model: model.id,
            manufacturer: model.brand,
            formFactor: model.formFactor,
            form: model.form,
            thumbnailUrl: model.thumbnailUrl,
            isCatalogDevice: true
          }}
          size="md"
          className="rounded-lg shadow-none bg-transparent dark:bg-transparent border-0"
        />
      </div>

      {/* Center: Device Info */}
      <div className="flex-1 min-w-0 pr-1">
        <div
          className="font-bold text-xs sm:text-[13px] text-slate-900 dark:text-slate-100 truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors"
          title={model.name}
        >
          {model.name}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          {!isVirtual && model.brand && (
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider truncate">
              {model.brand}
            </span>
          )}
          {isVirtual && model.screenDensity && (
            <span className="text-[10px] text-slate-400 font-mono">
              {model.screenDensity}dpi
            </span>
          )}
        </div>
        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1">
          {apiLabel}
        </div>
      </div>

      {/* Top-Right: Add / In-Matrix Check Button */}
      <div className="shrink-0 self-start mt-0.5">
        {isInMatrix ? (
          <div
            className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center shadow-xs"
            title={`${matrixCount} configuration(s) added in matrix`}
          >
            <Check className="w-3.5 h-3.5" />
          </div>
        ) : (
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-blue-500 dark:text-blue-400 border border-blue-500/30 group-hover:bg-blue-500/10 group-hover:border-blue-500 transition-colors"
            title="Configure and add to test matrix"
          >
            <Plus className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
    </div>
  );
}

// Maps execution status and outcome to visual indicator classes
function getStatusColor(status, outcome) {
  const normStatus = String(status || '').toUpperCase();
  const normOutcome = String(outcome || '').toUpperCase();

  if (normStatus === 'RUNNING') return 'bg-violet-500 animate-pulse';
  if (normStatus === 'QUEUED' || normStatus === 'PENDING') return 'bg-amber-400 animate-pulse';
  if (normStatus === 'CANCELLED') return 'bg-slate-400';

  if (normOutcome === 'FAILURE' || normStatus === 'FAILED' || normStatus === 'ERROR' || normOutcome === 'INFRASTRUCTURE_ERROR') {
    return 'bg-rose-500';
  }
  if (normOutcome === 'INCONCLUSIVE' || normOutcome === 'UNSUPPORTED_ENVIRONMENT' || normStatus === 'INTERRUPTED') {
    return 'bg-amber-500';
  }
  if (normOutcome === 'SUCCESS' || normStatus === 'COMPLETED' || normStatus === 'PASSED') {
    return 'bg-emerald-500';
  }

  switch (normStatus) {
    case 'COMPLETED':
    case 'SUCCESS':
      return 'bg-emerald-500';
    case 'FAILED':
    case 'FAILURE':
      return 'bg-rose-500';
    case 'INCONCLUSIVE':
    case 'UNSUPPORTED_ENVIRONMENT':
    case 'INTERRUPTED':
      return 'bg-amber-500';
    default:
      return 'bg-slate-400';
  }
}

// Human-readable elapsed duration formatter
function formatDuration(startTime, completionTime) {
  const startRaw = startTime;
  if (!startRaw) return '—';
  const start = new Date(startRaw).getTime();
  if (isNaN(start)) return '—';
  const end = completionTime ? new Date(completionTime).getTime() : Date.now();
  if (isNaN(end)) return '—';
  const diffMs = Math.max(0, end - start);
  const totalSec = Math.floor(diffMs / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

export default function RoboTestPage({ currentUser }) {
  // Environment Diagnostics
  const [environment, setEnvironment] = useState(null);
  const [loadingEnv, setLoadingEnv] = useState(true);

  // Device Catalog
  const [catalog, setCatalog] = useState({ models: [], versions: [], locales: [], orientations: ['portrait', 'landscape'] });
  const [loadingCatalog, setLoadingCatalog] = useState(false);

  // Build Selection: Upload vs Existing Build
  const [buildSource, setBuildSource] = useState('upload'); // 'upload' | 'platform'
  const [platformBuilds, setPlatformBuilds] = useState([]);
  const [selectedPlatformBuildId, setSelectedPlatformBuildId] = useState('');
  const [uploadedBuild, setUploadedBuild] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  // Target Device Selection
  const [selectedModelId, setSelectedModelId] = useState('');
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [selectedOrientation, setSelectedOrientation] = useState('portrait');
  const [selectedLocale, setSelectedLocale] = useState('en_US');
  const [configuredDevices, setConfiguredDevices] = useState([]);
  const [deviceSearchQuery, setDeviceSearchQuery] = useState('');
  const [catalogError, setCatalogError] = useState(null);

  // Device Configuration Popover / Modal State
  const [configuringDevice, setConfiguringDevice] = useState(null);
  const [modalVersionId, setModalVersionId] = useState('');
  const [modalOrientation, setModalOrientation] = useState('portrait');

  // Navigation Workflow Tab: 'configure' (Full width device catalog) | 'monitor' (Execution monitor & history)
  const [activeWorkflowTab, setActiveWorkflowTab] = useState('configure');

  // Execution & Jobs
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [selectedJob, setSelectedJob] = useState(null);
  const [jobLogs, setJobLogs] = useState('');
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  // 1. Load Environment Diagnostics
  const fetchEnvironment = useCallback(async () => {
    setLoadingEnv(true);
    try {
      const res = await api.getRoboEnvironment();
      if (res && res.environment) {
        setEnvironment(res.environment);
      }
    } catch (err) {
      console.error('Failed to load Robo environment:', err);
      setEnvironment({
        ready: false,
        step: 'CLI_ERROR',
        message: err.message || 'Failed to inspect Google Cloud CLI status.'
      });
    } finally {
      setLoadingEnv(false);
    }
  }, []);

  // 2. Load Device Catalog
  const fetchCatalog = useCallback(async (forceRefresh = false) => {
    setLoadingCatalog(true);
    setCatalogError(null);
    try {
      const res = await api.getRoboCatalog(forceRefresh);
      if (res && res.catalog) {
        setCatalog(res.catalog);
        // Default to first physical or default model if not chosen
        if (res.catalog.models && res.catalog.models.length > 0 && !selectedModelId) {
          const defaultModel = res.catalog.models.find(m => m.isDefault) || res.catalog.models[0];
          setSelectedModelId(defaultModel.id);
          if (defaultModel.supportedVersionIds && defaultModel.supportedVersionIds.length > 0) {
            setSelectedVersionId(defaultModel.supportedVersionIds[0]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load device catalog:', err);
      setCatalogError(err.message || 'Failed to load device catalog from Google Cloud.');
    } finally {
      setLoadingCatalog(false);
    }
  }, [selectedModelId]);

  // 3. Load Platform Builds
  const fetchPlatformBuilds = useCallback(async () => {
    try {
      const res = await api.getBuilds();
      if (Array.isArray(res)) {
        setPlatformBuilds(res);
      } else if (res && Array.isArray(res.builds)) {
        setPlatformBuilds(res.builds);
      }
    } catch (err) {
      console.error('Failed to fetch platform builds:', err);
    }
  }, []);

  // 4. Load Robo Test Jobs
  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const params = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();
      const res = await api.getRoboJobs(params);
      if (res && res.jobs) {
        setJobs(res.jobs);
      }
    } catch (err) {
      console.error('Failed to fetch Robo jobs:', err);
    } finally {
      setLoadingJobs(false);
    }
  }, [statusFilter, searchQuery]);

  useEffect(() => {
    fetchEnvironment();
    fetchCatalog();
    fetchPlatformBuilds();
    fetchJobs();
  }, [fetchEnvironment, fetchCatalog, fetchPlatformBuilds, fetchJobs]);

  // Periodic polling for active jobs
  useEffect(() => {
    const hasActive = jobs.some(j => j.status === 'RUNNING' || j.status === 'QUEUED');
    if (!hasActive) return;

    const interval = setInterval(() => {
      fetchJobs();
    }, 4000);
    return () => clearInterval(interval);
  }, [jobs, fetchJobs]);

  // Filter devices by intelligent search query (API versions, Android releases, names, brands, IDs, tags)
  const filteredModels = useMemo(() => {
    const list = catalog.models || [];
    if (!deviceSearchQuery.trim()) return list;
    return list.filter(m => matchDeviceWithQuery(m, deviceSearchQuery, catalog.versions || []));
  }, [catalog.models, catalog.versions, deviceSearchQuery]);

  // Actual Firebase Test Lab metadata classification (form === 'VIRTUAL' vs form === 'PHYSICAL')
  const virtualDevices = useMemo(() => {
    return filteredModels.filter(m => m.form === 'VIRTUAL');
  }, [filteredModels]);

  const physicalDevices = useMemo(() => {
    return filteredModels.filter(m => m.form === 'PHYSICAL');
  }, [filteredModels]);

  // Open modal to configure Android OS version and orientation before adding to matrix
  const handleOpenConfigureDevice = (device) => {
    setConfiguringDevice(device);
    const supportedIds = device.supportedVersionIds || [];
    // Prefer the first supported version not yet added to the matrix
    const existingInMatrix = configuredDevices.filter(d => d.model === device.id).map(d => d.version);
    const candidate = supportedIds.find(vid => !existingInMatrix.includes(vid)) || supportedIds[0] || '';
    setModalVersionId(candidate);
    setModalOrientation('portrait');
  };

  // Add the configured device from the modal to the test matrix
  const handleAddConfiguredDevice = () => {
    if (!configuringDevice) return;
    if (!modalVersionId) {
      toast.error('Please select an Android OS version.');
      return;
    }

    // Verify duplicate model + version + orientation combination
    const exists = configuredDevices.some(d =>
      d.model === configuringDevice.id &&
      d.version === modalVersionId &&
      d.orientation === modalOrientation &&
      (d.locale || 'en_US') === (selectedLocale || 'en_US')
    );
    if (exists) {
      toast.error(`${configuringDevice.name} (API ${modalVersionId} • ${modalOrientation}) is already in your test matrix.`);
      return;
    }

    const newDev = {
      model: configuringDevice.id,
      modelName: configuringDevice.name || configuringDevice.id,
      brand: configuringDevice.brand || 'Google',
      form: configuringDevice.form || 'PHYSICAL',
      formFactor: configuringDevice.formFactor || 'PHONE',
      thumbnailUrl: configuringDevice.thumbnailUrl || null,
      version: modalVersionId,
      orientation: modalOrientation,
      locale: selectedLocale || 'en_US'
    };
    setConfiguredDevices(prev => [...prev, newDev]);
    toast.success(`Added ${newDev.modelName} (API ${newDev.version} • ${newDev.orientation}) to test matrix.`);
    setConfiguringDevice(null);
  };

  const handleRemoveDevice = (index) => {
    setConfiguredDevices(prev => prev.filter((_, i) => i !== index));
  };

  const handleClearMatrix = () => {
    setConfiguredDevices([]);
    toast.success('Cleared all devices from test matrix.');
  };

  // Upload Handling
  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  const handleFileUpload = async (file) => {
    if (!file) return;
    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.apk' && ext !== '.aab') {
      toast.error('Invalid file format. Please upload an Android Package (.apk) or App Bundle (.aab).');
      return;
    }
    setIsUploading(true);
    setUploadProgress(20);
    try {
      const res = await api.uploadRoboBuild(file);
      if (res && res.build) {
        setUploadedBuild(res.build);
        toast.success(`Application '${file.name}' uploaded successfully.`);
      }
    } catch (err) {
      toast.error(`Upload failed: ${err.message}`);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Launch Robo Test
  const handleStartTest = async () => {
    if (isSubmitting) return;

    if (!environment?.ready) {
      toast.error('Firebase Test Lab is not ready in this environment. Please review the setup diagnostic.');
      return;
    }

    let appPath = null;
    let appName = null;
    let buildId = null;

    if (buildSource === 'upload') {
      if (!uploadedBuild || !uploadedBuild.filePath) {
        toast.error('Please upload an APK or AAB file first.');
        return;
      }
      appPath = uploadedBuild.filePath;
      appName = uploadedBuild.filename;
    } else {
      if (!selectedPlatformBuildId) {
        toast.error('Please select an existing platform build.');
        return;
      }
      const pb = platformBuilds.find(b => b.id === selectedPlatformBuildId);
      if (!pb) {
        toast.error('Selected build not found.');
        return;
      }
      appPath = pb.filePath;
      appName = pb.name || pb.fileName;
      buildId = pb.id;
    }

    if (configuredDevices.length === 0) {
      toast.error('Please add at least one device configuration to the test matrix.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await api.runRoboTest({
        appPath,
        appName,
        buildId,
        testLabel: `${(appName || 'App').replace(/\.[^/.]+$/, '')} Robo Crawl`,
        devices: configuredDevices,
        timeout: '15m'
      });

      if (res && res.job) {
        toast.success('Firebase Test Lab Robo Test initiated successfully!');
        fetchJobs();
        setActiveWorkflowTab('monitor');
      }
    } catch (err) {
      console.error('Failed to submit Robo Test:', err);
      toast.error(`Submission failed: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Logs Viewing
  const handleViewLogs = async (job) => {
    setSelectedJob(job);
    setLogsModalOpen(true);
    setLoadingLogs(true);
    try {
      const res = await api.getRoboJobLogs(job.id);
      setJobLogs(res?.logs || 'No logs available.');
    } catch (err) {
      setJobLogs(`Failed to load logs: ${err.message}`);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Cancel Job
  const handleCancelJob = async (jobId) => {
    try {
      await api.cancelRoboJob(jobId);
      toast.success('Test cancellation requested.');
      fetchJobs();
    } catch (err) {
      toast.error(`Cancel failed: ${err.message}`);
    }
  };

  // Delete Job
  const handleDeleteJob = async (jobId) => {
    try {
      await api.deleteRoboJob(jobId);
      toast.success('Test record removed.');
      fetchJobs();
    } catch (err) {
      toast.error(`Delete failed: ${err.message}`);
    }
  };

  const copyToClipboard = (text, id) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.success('Copied to clipboard');
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12 font-sans">
      {/* Top Header Card */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 glass p-5 rounded-2xl shadow-glass border border-[rgba(99,102,241,0.14)] dark:border-[#1E2638]">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1f2544] dark:text-white flex items-center gap-2.5 tracking-tight">
              Robo Test <span className="text-heading-gradient">Firebase Test Lab</span>
              <span className="chip-badge text-[10px] py-0.5 px-2 font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                Official Google Cloud Service
              </span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6b7194] dark:text-[#94A3B8] mt-1">
              Autonomous mobile application crawling, UI regression testing, and unhandled exception detection on real Google-hosted devices.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { fetchEnvironment(); fetchCatalog(true); fetchJobs(); }}
            disabled={loadingEnv || loadingCatalog}
            className="btn-soft px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            title="Refresh Environment & Catalog"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingEnv || loadingCatalog ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Environment Diagnostics Banner */}
      {!loadingEnv && environment && (
        <div className={`p-4 rounded-2xl border transition-all ${
          environment.ready
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
            : 'bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-300'
        }`}>
          <div className="flex items-start gap-3">
            {environment.ready ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-bold text-xs uppercase tracking-wider">
                  {environment.ready ? 'Firebase Test Lab Ready' : 'Environment Configuration Required'}
                </span>
                {environment.projectId && (
                  <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-black/10 dark:bg-white/10 font-semibold">
                    Project: {environment.projectId}
                  </span>
                )}
              </div>
              <p className="text-xs mt-1 leading-relaxed opacity-90">{environment.message}</p>

              {/* Actionable Setup Guidance when not ready */}
              {!environment.ready && (
                <div className="mt-3 p-3 rounded-xl bg-black/10 dark:bg-[#0A0D14]/80 border border-amber-500/20 text-xs font-mono space-y-1.5">
                  <div className="text-[11px] font-bold text-[#1f2544] dark:text-[#E2E8F0] font-sans">
                    Required Google Cloud CLI Setup Commands:
                  </div>
                  <div className="text-slate-700 dark:text-slate-300 select-all">$ gcloud auth login</div>
                  <div className="text-slate-700 dark:text-slate-300 select-all">$ gcloud config set project &lt;YOUR_FIREBASE_PROJECT_ID&gt;</div>
                  <div className="text-slate-700 dark:text-slate-300 select-all">$ gcloud services enable testing.googleapis.com toolresults.googleapis.com</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Workflow Navigation Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[rgba(99,102,241,0.14)] dark:border-[#1E2638] pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveWorkflowTab('configure')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeWorkflowTab === 'configure'
                ? 'btn-magic text-white shadow-magic'
                : 'bg-slate-100 dark:bg-[#141B28] text-slate-600 dark:text-slate-300 hover:text-violet-600'
            }`}
          >
            <Smartphone className="w-4 h-4" />
            <span>Configure &amp; Run Robo Test</span>
            {configuredDevices.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/20 text-white font-mono">
                {configuredDevices.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveWorkflowTab('monitor')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition-all cursor-pointer ${
              activeWorkflowTab === 'monitor'
                ? 'btn-magic text-white shadow-magic'
                : 'bg-slate-100 dark:bg-[#141B28] text-slate-600 dark:text-slate-300 hover:text-violet-600'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Execution Monitor &amp; History</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 font-mono">
              {jobs.length}
            </span>
          </button>
        </div>

        {/* Running Jobs Alert Pill */}
        {jobs.some(j => j.status === 'RUNNING' || j.status === 'QUEUED') && (
          <button
            type="button"
            onClick={() => setActiveWorkflowTab('monitor')}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold animate-pulse cursor-pointer"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            <span>Active Test Lab Matrix Running — View Monitor</span>
          </button>
        )}
      </div>

      {/* Workflow Content: Configure & Run Tab */}
      {activeWorkflowTab === 'configure' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* LEFT COLUMN: Build Selection & Device Catalog */}
          <div className="lg:col-span-8 space-y-6">
            {/* Step 1: Select Application Binary */}
            <div className="glass p-5 rounded-2xl shadow-glass border border-[rgba(99,102,241,0.14)] dark:border-[#1E2638] space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-extrabold text-sm text-[#1f2544] dark:text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-[11px] flex items-center justify-center font-bold">1</span>
                  <span>Select Application Binary</span>
                </h3>
                <div className="flex rounded-lg bg-slate-100 dark:bg-[#141B28] p-0.5 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setBuildSource('upload')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${buildSource === 'upload' ? 'bg-white dark:bg-[#1E2638] shadow-xs text-violet-600 dark:text-violet-400' : 'text-slate-500'}`}
                  >
                    Upload New
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuildSource('platform')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${buildSource === 'platform' ? 'bg-white dark:bg-[#1E2638] shadow-xs text-violet-600 dark:text-violet-400' : 'text-slate-500'}`}
                  >
                    Platform Builds
                  </button>
                </div>
              </div>

              {buildSource === 'upload' ? (
                <div
                  onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={handleFileDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all ${
                    dragActive ? 'border-violet-500 bg-violet-500/10' : 'border-slate-300 dark:border-slate-700 hover:border-violet-400'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".apk,.aab"
                    className="hidden"
                    onChange={(e) => e.target.files && handleFileUpload(e.target.files[0])}
                  />

                  {isUploading ? (
                    <div className="flex flex-col items-center justify-center gap-2 py-2">
                      <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
                      <span className="text-xs font-bold text-[#1f2544] dark:text-white">Uploading Android Binary...</span>
                      <div className="w-48 bg-slate-200 dark:bg-slate-700 h-1.5 rounded-full overflow-hidden mt-1">
                        <div className="bg-violet-600 h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }} />
                      </div>
                    </div>
                  ) : uploadedBuild ? (
                    <div className="flex items-center justify-center gap-3 py-1">
                      <FileArchive className="w-8 h-8 text-emerald-500 shrink-0" />
                      <div className="text-left min-w-0">
                        <div className="text-xs font-bold truncate text-[#1f2544] dark:text-white">{uploadedBuild.filename}</div>
                        <div className="text-[10px] text-[#6b7194] dark:text-[#94A3B8] font-mono">
                          {(uploadedBuild.size / (1024 * 1024)).toFixed(2)} MB • {uploadedBuild.format.toUpperCase()}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-1.5 py-1">
                      <UploadCloud className="w-8 h-8 text-violet-500 mb-1" />
                      <span className="text-xs font-bold text-[#1f2544] dark:text-white">Click or drag &amp; drop APK or AAB here</span>
                      <span className="text-[10px] text-[#6b7194] dark:text-[#94A3B8]">Supports Android Packages (.apk) and App Bundles (.aab)</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <CustomSelect
                    value={selectedPlatformBuildId}
                    onChange={(val) => setSelectedPlatformBuildId(val?.target ? val.target.value : val)}
                    options={platformBuilds.map(b => ({
                      value: b.id,
                      label: `${b.name || b.fileName} (${(b.fileSize / (1024 * 1024)).toFixed(1)} MB)`
                    }))}
                    placeholder="Select from platform builds..."
                    className="w-full text-xs font-semibold rounded-xl"
                  />
                  {platformBuilds.length === 0 && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">No platform builds found. Switch to Upload New.</p>
                  )}
                </div>
              )}
            </div>

            {/* Step 2: Select Firebase Test Lab Devices */}
            <div className="glass p-5 rounded-2xl shadow-glass border border-[rgba(99,102,241,0.14)] dark:border-[#1E2638] space-y-5">
              {/* Catalog Header & Search Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-[rgba(99,102,241,0.1)] dark:border-[#1E2638]">
                <div>
                  <h3 className="font-extrabold text-base text-[#1f2544] dark:text-white flex items-center gap-2.5">
                    <span className="w-6 h-6 rounded-full bg-violet-600 text-white text-xs flex items-center justify-center font-bold">2</span>
                    <span>Select Firebase Test Lab Devices</span>
                    {catalog.models.length > 0 && (
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#141B28] text-slate-600 dark:text-slate-400 font-semibold">
                        {deviceSearchQuery.trim()
                          ? `${filteredModels.length} of ${catalog.models.length} devices`
                          : `${catalog.models.length} devices`}
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Choose devices from Google&apos;s official catalog. Click any device to select its Android OS version and orientation.
                  </p>
                </div>

                {/* Search input matching Firebase Console */}
                <div className="flex items-center gap-2">
                  <div className="relative w-full sm:w-72">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <input
                      type="text"
                      value={deviceSearchQuery}
                      onChange={(e) => setDeviceSearchQuery(e.target.value)}
                      placeholder="Search devices or Android API versions..."
                      className="w-full pl-9 pr-8 py-2 rounded-xl bg-slate-50 dark:bg-[#141B28] border border-[var(--line)] text-xs font-medium focus:outline-hidden focus:border-violet-500 transition-colors"
                    />
                    {deviceSearchQuery.trim() && (
                      <button
                        type="button"
                        onClick={() => setDeviceSearchQuery('')}
                        aria-label="Clear device search"
                        className="absolute right-2.5 top-2.5 p-0.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                        title="Clear search"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => fetchCatalog(true)}
                    disabled={loadingCatalog}
                    className="btn-soft p-2 sm:px-3 sm:py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 shrink-0 cursor-pointer"
                    title="Reload Google Cloud Device Catalog"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingCatalog ? 'animate-spin' : ''}`} />
                    <span className="hidden sm:inline">Refresh</span>
                  </button>
                </div>
              </div>

              {loadingCatalog ? (
                <div className="py-16 flex flex-col items-center justify-center gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-violet-600" />
                  <span className="text-xs font-semibold text-slate-500">Querying Google Cloud Test Lab catalog...</span>
                </div>
              ) : catalogError ? (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400 space-y-2">
                  <div className="flex items-center gap-2 font-bold">
                    <AlertCircle className="w-4 h-4" />
                    <span>Failed to load device catalog</span>
                  </div>
                  <p className="text-xs">{catalogError}</p>
                  <button
                    type="button"
                    onClick={() => fetchCatalog(true)}
                    className="btn-soft px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer"
                  >
                    Retry Catalog Load
                  </button>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* 1. Virtual Devices Category */}
                  {virtualDevices.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">
                            Virtual devices
                          </h4>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold">
                            {virtualDevices.length}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400">
                          Fast emulation on Google infrastructure
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                        {virtualDevices.map((m) => {
                          const inMatrixList = configuredDevices.filter(d => d.model === m.id);
                          return (
                            <FirebaseDeviceCard
                              key={m.id}
                              model={m}
                              isInMatrix={inMatrixList.length > 0}
                              matrixCount={inMatrixList.length}
                              onOpenConfigure={handleOpenConfigureDevice}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* 2. Available Physical Devices Category */}
                  {physicalDevices.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <h4 className="font-extrabold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">
                            Available devices
                          </h4>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold">
                            {physicalDevices.length}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400">
                          Physical Android smartphones &amp; tablets
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 max-h-[640px] overflow-y-auto pr-1">
                        {physicalDevices.map((m) => {
                          const inMatrixList = configuredDevices.filter(d => d.model === m.id);
                          return (
                            <FirebaseDeviceCard
                              key={m.id}
                              model={m}
                              isInMatrix={inMatrixList.length > 0}
                              matrixCount={inMatrixList.length}
                              onOpenConfigure={handleOpenConfigureDevice}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Zero matches empty state */}
                  {filteredModels.length === 0 && (
                    <div className="py-12 text-center text-slate-500 space-y-3 bg-slate-50/50 dark:bg-[#141B28]/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                      <Smartphone className="w-10 h-10 mx-auto text-slate-400/60" />
                      <div className="font-bold text-sm text-slate-800 dark:text-slate-200">
                        No devices match &quot;{deviceSearchQuery}&quot;
                      </div>
                      <p className="text-xs text-slate-500 max-w-sm mx-auto">
                        Try searching by Android API version (e.g. <span className="font-mono text-violet-600 dark:text-violet-400 font-semibold">API 36</span> or <span className="font-mono text-violet-600 dark:text-violet-400 font-semibold">Android 16</span>), brand name (e.g. <span className="font-mono text-violet-600 dark:text-violet-400 font-semibold">Samsung</span>, <span className="font-mono text-violet-600 dark:text-violet-400 font-semibold">Pixel</span>), or clear the search.
                      </p>
                      <button
                        type="button"
                        onClick={() => setDeviceSearchQuery('')}
                        className="btn-soft px-3.5 py-1.5 rounded-xl text-xs font-bold text-violet-600 dark:text-violet-400 cursor-pointer"
                      >
                        Clear search filter
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Selected Test Matrix & Start Button (Sticky on Desktop) */}
          <div className="lg:col-span-4 lg:sticky lg:top-4 space-y-6">
            <div className="glass p-5 rounded-2xl shadow-glass border border-[rgba(99,102,241,0.14)] dark:border-[#1E2638] space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between pb-3 border-b border-[rgba(99,102,241,0.1)] dark:border-[#1E2638]">
                <div className="flex items-center gap-2">
                  <h3 className="font-extrabold text-sm sm:text-base text-[#1f2544] dark:text-white flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-violet-500" />
                    <span>Selected Test Matrix</span>
                  </h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-600 dark:text-violet-400 font-bold border border-violet-500/20">
                    {configuredDevices.length} Targets
                  </span>
                </div>

                {configuredDevices.length > 0 && (
                  <button
                    type="button"
                    onClick={handleClearMatrix}
                    className="text-xs font-bold text-rose-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              {/* Devices List */}
              {configuredDevices.length === 0 ? (
                <div className="py-10 px-4 rounded-xl bg-slate-50/70 dark:bg-[#141B28]/70 border border-dashed border-slate-300 dark:border-slate-700 text-center space-y-2">
                  <Smartphone className="w-9 h-9 mx-auto text-slate-400/60" />
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    No devices selected yet
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
                    Click on any device card in the catalog or the <span className="text-blue-500 font-bold">+</span> button to choose an Android version and add it to the test matrix.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                  {configuredDevices.map((d, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-[#141B28] border border-[var(--line)] hover:border-violet-400/50 transition-colors shadow-2xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <DeviceThumbnail
                          device={{
                            name: d.modelName,
                            displayName: d.modelName,
                            model: d.model,
                            manufacturer: d.brand,
                            formFactor: d.formFactor,
                            form: d.form,
                            thumbnailUrl: d.thumbnailUrl || (catalog.models?.find(m => m.id === d.model)?.thumbnailUrl),
                            isCatalogDevice: true
                          }}
                          size="xs"
                          className="rounded-md shadow-none bg-transparent dark:bg-transparent border-0"
                        />
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate text-[#1f2544] dark:text-white" title={d.modelName}>
                            {d.modelName}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10.5px] mt-0.5">
                            <span className="font-mono text-violet-600 dark:text-violet-400 font-bold">API {d.version}</span>
                            <span className="text-slate-400">•</span>
                            <span className="uppercase text-[9.5px] font-semibold text-slate-500">{d.orientation}</span>
                            {d.form === 'VIRTUAL' ? (
                              <span className="text-[8.5px] px-1 py-0.2 rounded bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 font-mono font-semibold border border-cyan-500/20">
                                VIRTUAL
                              </span>
                            ) : (
                              <span className="text-[8.5px] px-1 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-mono font-semibold">
                                PHYSICAL
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleRemoveDevice(idx)}
                        aria-label={`Remove ${d.modelName}`}
                        className="p-1.5 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-500/10 transition-colors cursor-pointer shrink-0"
                        title="Remove from matrix"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Execution Summary & Validation Status */}
              <div className="pt-3 border-t border-[rgba(99,102,241,0.1)] dark:border-[#1E2638] space-y-2">
                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-slate-500">Selected Binary:</span>
                  <span className="font-bold truncate max-w-[180px] text-slate-800 dark:text-slate-200" title={uploadedBuild?.filename || (platformBuilds.find(b => b.id === selectedPlatformBuildId)?.name) || 'None'}>
                    {uploadedBuild?.filename || (platformBuilds.find(b => b.id === selectedPlatformBuildId)?.name) || (
                      <span className="text-amber-500 italic">No binary selected</span>
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs font-medium">
                  <span className="text-slate-500">Firebase Execution Mode:</span>
                  <span className="font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
                    Autonomous Robo Crawl
                  </span>
                </div>
              </div>

              {/* Prominent Start Button */}
              <button
                type="button"
                onClick={handleStartTest}
                disabled={isSubmitting || !environment?.ready || configuredDevices.length === 0 || (!uploadedBuild && !selectedPlatformBuildId)}
                className="w-full btn-magic py-3 rounded-xl font-bold text-xs sm:text-sm shadow-magic flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 text-white animate-spin" />
                    <span>Dispatching to Google Cloud...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 text-white" />
                    <span>Start Firebase Robo Test ({configuredDevices.length})</span>
                  </>
                )}
              </button>

              {/* Helpful Hint if Disabled */}
              {(!uploadedBuild && !selectedPlatformBuildId) ? (
                <p className="text-[11px] text-amber-500 text-center">
                  Select or upload an application binary (Step 1) to enable test launch.
                </p>
              ) : configuredDevices.length === 0 ? (
                <p className="text-[11px] text-slate-400 text-center">
                  Add at least 1 device target to enable test launch.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}


      {/* Workflow Content: Monitor & History Tab */}
      {activeWorkflowTab === 'monitor' && (
        <div className="glass p-5 rounded-2xl shadow-glass border border-[rgba(99,102,241,0.14)] dark:border-[#1E2638] space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[rgba(99,102,241,0.1)] dark:border-[#1E2638]">
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-[#1f2544] dark:text-white flex items-center gap-2">
                <span>Robo Test Executions</span>
                <span className="chip-badge text-[10px] py-0.5 px-2 font-mono">
                  {jobs.length} Runs
                </span>
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Live matrix statuses, structured Google Cloud error codes, logs, and direct Firebase console test reports.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tests..."
                  className="pl-8 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-[#141B28] border border-[var(--line)] text-xs font-medium w-36 sm:w-48 focus:outline-hidden"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-[#141B28] border border-[var(--line)] text-xs font-bold"
              >
                <option value="ALL">All Status</option>
                <option value="RUNNING">Running</option>
                <option value="COMPLETED">Completed</option>
                <option value="FAILED">Failed</option>
              </select>
              <button
                type="button"
                onClick={fetchJobs}
                disabled={loadingJobs}
                className="btn-soft p-2 rounded-xl text-xs font-semibold cursor-pointer"
                title="Refresh jobs"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingJobs ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {loadingJobs && jobs.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-6 h-6 animate-spin text-violet-600" />
              <span className="text-xs text-slate-500">Loading Robo test records...</span>
            </div>
          ) : jobs.length === 0 ? (
            <div className="py-16 text-center text-slate-500 space-y-3">
              <Bot className="w-12 h-12 mx-auto text-slate-400/50" />
              <div className="font-bold text-sm">No Robo Test Executions Found</div>
              <p className="text-xs max-w-sm mx-auto">
                Configure your application and devices in the &quot;Configure &amp; Run&quot; tab and launch your first cloud crawl.
              </p>
              <button
                type="button"
                onClick={() => setActiveWorkflowTab('configure')}
                className="btn-magic px-4 py-2 rounded-xl text-xs font-bold text-white shadow-magic cursor-pointer"
              >
                Configure Test Now
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const isRunning = job.status === 'RUNNING' || job.status === 'QUEUED';
                return (
                  <div
                    key={job.id}
                    className="p-4 rounded-2xl bg-white dark:bg-[#141B28] border border-[rgba(99,102,241,0.14)] dark:border-[#1E2638] space-y-3 shadow-xs hover:border-violet-500/30 transition-all"
                  >
                    {/* Header Row */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${getStatusColor(job.status, job.outcome)}`} />
                        <span className="font-extrabold text-sm truncate text-[#1f2544] dark:text-white">
                          {job.testLabel}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 dark:bg-[#1E2638] font-bold">
                          {job.status}
                        </span>
                        {job.outcome && job.outcome !== 'PENDING' && job.outcome !== 'UNSPECIFIED' && (
                          <span
                            className={`text-[9.5px] font-mono px-2 py-0.5 rounded-full font-bold ${
                              job.outcome === 'SUCCESS'
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : job.outcome === 'FAILURE'
                                ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                                : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {job.outcome}
                          </span>
                        )}
                        {job.exitCode !== null && job.exitCode !== undefined && (
                          <span
                            className={`text-[9.5px] font-mono px-1.5 py-0.2 rounded font-bold ${
                              job.exitCode === 0
                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                                : 'bg-rose-500/10 text-rose-600 dark:text-rose-400'
                            }`}
                            title={`Process exit code ${job.exitCode}`}
                          >
                            exit:{job.exitCode}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[11px] text-slate-400 font-mono">
                          {new Date(job.createdAt).toLocaleString()}
                        </span>
                        {isRunning && (
                          <button
                            type="button"
                            onClick={() => handleCancelJob(job.id)}
                            className="btn-soft px-2.5 py-1 rounded-lg text-xs font-bold text-rose-500 hover:text-rose-600 cursor-pointer"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleViewLogs(job)}
                          className="btn-soft p-1.5 rounded-lg text-slate-400 hover:text-violet-600 cursor-pointer"
                          title="View Execution Logs"
                        >
                          <Terminal className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Metadata Sub-row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
                      <div>
                        <span className="text-slate-400 text-[11px]">App:</span>{' '}
                        <span className="font-mono text-[11.5px] font-bold">{job.appName || 'Unknown Binary'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[11px]">Matrix Size:</span>{' '}
                        <span className="font-bold">{job.devices?.length || 0} device(s)</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[11px]">Duration:</span>{' '}
                        <span className="font-mono">{formatDuration(job.startTime || job.startedAt || job.createdAt, job.completionTime || job.finishedAt)}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[11px]">Timeout:</span>{' '}
                        <span className="font-mono">{job.timeout || '15m'}</span>
                      </div>
                    </div>

                    {/* Devices Mini Matrix */}
                    {job.devices && job.devices.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {job.devices.map((d, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 dark:bg-[#1E2638] text-[10.5px] font-mono text-slate-700 dark:text-slate-300"
                          >
                            <Smartphone className="w-3 h-3 text-violet-500" />
                            <span>{d.modelName || d.model}</span>
                            <span className="text-slate-400">/</span>
                            <span className="text-violet-600 dark:text-violet-400">API {d.version}</span>
                            <span className="text-slate-400">/</span>
                            <span className="uppercase text-[9px]">{d.orientation}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Error / Inconclusive Message */}
                    {job.errorMessage && (
                      <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="leading-relaxed">{job.errorMessage}</span>
                      </div>
                    )}

                    {/* Matrix ID & Official Google Results Button */}
                    <div className="pt-2 border-t border-[rgba(99,102,241,0.1)] dark:border-[#1E2638] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-[10.5px] font-bold text-slate-500 uppercase tracking-wider">Matrix ID:</span>
                        {job.matrixId ? (
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs font-bold text-violet-600 dark:text-violet-400">{job.matrixId}</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(job.matrixId, job.id)}
                              className="p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                              title="Copy Matrix ID"
                            >
                              {copiedId === job.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400 italic">Provisioning...</span>
                        )}
                      </div>

                      {/* Prominent Firebase Results Link Button */}
                      {job.resultsUrl ? (
                        <a
                          href={job.resultsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn-magic px-3.5 py-1.5 rounded-xl text-xs font-bold shadow-magic flex items-center justify-center gap-1.5 text-white no-underline shrink-0"
                        >
                          <ExternalLink className="w-3.5 h-3.5 text-white" />
                          <span>View Firebase Test Results</span>
                        </a>
                      ) : (
                        <span className="text-[11px] text-slate-400 italic">Report URL pending creation...</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Device Configuration Modal (Firebase Console style) */}
      {configuringDevice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="w-full max-w-md glass p-6 rounded-2xl shadow-glass border border-[rgba(99,102,241,0.25)] dark:border-[#1E2638] space-y-5">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-sm text-[#1f2544] dark:text-white flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-violet-500" />
                <span>Customize Device Selection</span>
              </h4>
              <button
                type="button"
                onClick={() => setConfiguringDevice(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Selected Device Preview Card */}
            <div className="flex items-center gap-3.5 p-3.5 rounded-xl bg-slate-50 dark:bg-[#141B28] border border-[var(--line)]">
              <div className="shrink-0 flex items-center justify-center">
                <DeviceThumbnail
                  device={{
                    name: configuringDevice.name,
                    displayName: configuringDevice.name,
                    model: configuringDevice.id,
                    manufacturer: configuringDevice.brand,
                    formFactor: configuringDevice.formFactor,
                    form: configuringDevice.form,
                    thumbnailUrl: configuringDevice.thumbnailUrl,
                    isCatalogDevice: true
                  }}
                  size="md"
                  className="rounded-lg shadow-none bg-transparent dark:bg-transparent border-0"
                />
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
                  {configuringDevice.name}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-xs text-slate-500">
                  <span className="uppercase font-semibold tracking-wider text-[10px]">{configuringDevice.brand || 'Google'}</span>
                  <span>•</span>
                  <span className="font-mono text-[10.5px]">
                    {configuringDevice.form === 'VIRTUAL' ? 'Virtual Device' : 'Physical Device'}
                  </span>
                </div>
              </div>
            </div>

            {/* Android OS Version Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Android Version (API):
              </label>
              <CustomSelect
                value={modalVersionId}
                onChange={(val) => setModalVersionId(val?.target ? val.target.value : val)}
                options={(configuringDevice.supportedVersionIds || []).map(vid => {
                  const label = getAndroidVersionLabel(vid, catalog.versions || []);
                  return {
                    value: vid,
                    label
                  };
                })}
                placeholder="Select Android OS version..."
                className="w-full text-xs font-semibold rounded-xl"
              />
              <p className="text-[11px] text-slate-500">
                Device supports {(configuringDevice.supportedVersionIds || []).length} API level{configuringDevice.supportedVersionIds?.length === 1 ? '' : 's'}.
              </p>
            </div>

            {/* Orientation Selection */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-200">
                Device Orientation:
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setModalOrientation('portrait')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                    modalOrientation === 'portrait'
                      ? 'bg-violet-600 text-white border-violet-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-[#141B28] text-slate-700 dark:text-slate-300 border-[var(--line)] hover:border-violet-400'
                  }`}
                >
                  Portrait
                </button>
                <button
                  type="button"
                  onClick={() => setModalOrientation('landscape')}
                  className={`py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 border transition-all cursor-pointer ${
                    modalOrientation === 'landscape'
                      ? 'bg-violet-600 text-white border-violet-600 shadow-xs'
                      : 'bg-slate-50 dark:bg-[#141B28] text-slate-700 dark:text-slate-300 border-[var(--line)] hover:border-violet-400'
                  }`}
                >
                  Landscape
                </button>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-[rgba(99,102,241,0.1)] dark:border-[#1E2638]">
              <button
                type="button"
                onClick={() => setConfiguringDevice(null)}
                className="btn-soft px-4 py-2 rounded-xl text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddConfiguredDevice}
                disabled={!modalVersionId}
                className="btn-magic px-5 py-2 rounded-xl text-xs font-bold text-white shadow-magic flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add to Test Matrix</span>
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Execution Logs Modal */}
      {logsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-fadeIn">
          <div className="w-full max-w-3xl glass p-6 rounded-2xl shadow-glass border border-[rgba(99,102,241,0.2)] dark:border-[#1E2638] space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-extrabold text-sm text-[#1f2544] dark:text-white flex items-center gap-2">
                  <Terminal className="w-4 h-4 text-violet-500" />
                  <span>Firebase Execution Logs: {selectedJob?.testLabel}</span>
                </h4>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  Job ID: {selectedJob?.id} • Matrix: {selectedJob?.matrixId || 'Pending'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setLogsModalOpen(false)}
                className="btn-soft px-3 py-1 rounded-lg text-xs font-bold"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-auto bg-[#0A0D14] p-4 rounded-xl border border-[#1E2638] text-xs font-mono text-slate-300 leading-relaxed whitespace-pre-wrap select-all">
              {loadingLogs ? (
                <div className="flex items-center justify-center py-8 gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-violet-500" />
                  <span>Loading execution logs...</span>
                </div>
              ) : (
                jobLogs || 'No execution logs available yet.'
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
