import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Smartphone,
  Upload,
  Image as ImageIcon,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Search,
  Plus,
  Trash2,
  RefreshCw,
  Server,
  X,
  Check,
  Info,
  Clock,
  Layers,
  Sparkles,
  Wifi,
  HardDrive
} from 'lucide-react';
import { api } from '../services/api';
import { socketService } from '../services/socket';
import DeviceThumbnail from '../components/DeviceThumbnail';

export default function AdminDeviceManagementPage({ currentUser }) {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState({ models: [], summary: { totalModels: 0, withImages: 0, missingImages: 0, connectedCount: 0 } });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all, connected, has_image, missing_image
  const [notification, setNotification] = useState(null);

  // Upload modal state
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [displayNameInput, setDisplayNameInput] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Add model modal state
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [newMfg, setNewMfg] = useState('');
  const [newModel, setNewModel] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [addingModel, setAddingModel] = useState(false);

  // Controlled Restart modal state
  const [restartModalOpen, setRestartModalOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [restartProgress, setRestartProgress] = useState(null);

  const showNotification = (message, type = 'success') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(null);
    }, 4500);
  };

  const fetchModels = useCallback(async () => {
    try {
      const res = await api.adminGetDeviceModels({ search, filter });
      if (res?.success && res.data) {
        setData(res.data);
      }
    } catch (err) {
      showNotification(err.message || 'Failed to fetch device models.', 'error');
    } finally {
      setLoading(false);
    }
  }, [search, filter]);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  // Subscribe to real-time WebSocket events
  useEffect(() => {
    const unsub = socketService.on('DEVICE_IMAGE_UPDATED', () => {
      fetchModels();
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, [fetchModels]);

  // Safe client-side margin detection and conservative trimming
  const detectAndTrimMargins = (file) => {
    return new Promise((resolve) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h || w < 32 || h < 32 || w > 4096 || h > 4096) {
          resolve({ shouldTrim: false, width: w, height: h });
          return;
        }

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve({ shouldTrim: false, width: w, height: h });
          return;
        }

        ctx.drawImage(img, 0, 0);
        let imgData;
        try {
          imgData = ctx.getImageData(0, 0, w, h);
        } catch (_) {
          resolve({ shouldTrim: false, width: w, height: h });
          return;
        }
        const data = imgData.data;

        // Conservative margin scanning:
        // A pixel is empty if transparent (a <= 15) or pure light background (r,g,b >= 248 with a >= 240)
        const isMarginPixel = (x, y) => {
          const idx = (y * w + x) * 4;
          const a = data[idx + 3];
          if (a <= 15) return true;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          return r >= 248 && g >= 248 && b >= 248 && a >= 240;
        };

        let minX = w, maxX = 0, minY = h, maxY = 0;
        let nonMarginCount = 0;

        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (!isMarginPixel(x, y)) {
              nonMarginCount++;
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        // If safe content detection is uncertain (e.g. empty, inverted, or occupies > 96% of frame)
        const contentRatio = nonMarginCount / (w * h);
        if (nonMarginCount === 0 || minX >= maxX || minY >= maxY || contentRatio > 0.96) {
          resolve({ shouldTrim: false, width: w, height: h });
          return;
        }

        // Keep a conservative protective margin (8px) around the detected device
        const pad = 8;
        const cropX = Math.max(0, minX - pad);
        const cropY = Math.max(0, minY - pad);
        const cropW = Math.min(w - cropX, (maxX - minX + 1) + pad * 2);
        const cropH = Math.min(h - cropY, (maxY - minY + 1) + pad * 2);

        // Verify that trimming trims meaningful space (at least 3% in either dimension)
        if (cropW >= w * 0.97 && cropH >= h * 0.97) {
          resolve({ shouldTrim: false, width: w, height: h });
          return;
        }

        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const mimeType = file.type || 'image/png';
        cropCanvas.toBlob((blob) => {
          if (!blob) {
            resolve({ shouldTrim: false, width: w, height: h });
            return;
          }
          resolve({
            shouldTrim: true,
            trimmedBlob: blob,
            trimmedWidth: cropW,
            trimmedHeight: cropH,
            originalWidth: w,
            originalHeight: h
          });
        }, mimeType, 0.95);
      };
      img.onerror = () => resolve({ shouldTrim: false });
      img.src = objectUrl;
    });
  };

  // Upload modal state with trimming & preview comparison
  const [trimmedBlob, setTrimmedBlob] = useState(null);
  const [trimmedPreviewUrl, setTrimmedPreviewUrl] = useState(null);
  const [originalDimensions, setOriginalDimensions] = useState(null);
  const [trimmedDimensions, setTrimmedDimensions] = useState(null);
  const [trimMarginsEnabled, setTrimMarginsEnabled] = useState(true);
  const [previewTab, setPreviewTab] = useState('trimmed'); // 'trimmed' | 'original'

  // Handle file selection and preview
  const handleFileChange = async (file) => {
    if (!file) return;

    const allowed = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    if (!allowed.includes(file.type.toLowerCase())) {
      showNotification('Invalid file type. Only PNG, JPEG, and WebP images are allowed.', 'error');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      showNotification('File size exceeds maximum allowed size of 2MB.', 'error');
      return;
    }

    setSelectedFile(file);
    const origUrl = URL.createObjectURL(file);
    setPreviewUrl(origUrl);

    // Detect and compute trimmed version safely
    const trimResult = await detectAndTrimMargins(file);
    if (trimResult.shouldTrim && trimResult.trimmedBlob) {
      const trimmedUrl = URL.createObjectURL(trimResult.trimmedBlob);
      setTrimmedBlob(trimResult.trimmedBlob);
      setTrimmedPreviewUrl(trimmedUrl);
      setOriginalDimensions({ width: trimResult.originalWidth, height: trimResult.originalHeight });
      setTrimmedDimensions({ width: trimResult.trimmedWidth, height: trimResult.trimmedHeight });
      setTrimMarginsEnabled(true);
      setPreviewTab('trimmed');
    } else {
      setTrimmedBlob(null);
      setTrimmedPreviewUrl(null);
      setOriginalDimensions(trimResult.width && trimResult.height ? { width: trimResult.width, height: trimResult.height } : null);
      setTrimmedDimensions(null);
      setTrimMarginsEnabled(false);
      setPreviewTab('original');
    }
  };

  const handleOpenUpload = (model) => {
    setSelectedModel(model);
    setSelectedFile(null);
    setPreviewUrl(null);
    setTrimmedBlob(null);
    setTrimmedPreviewUrl(null);
    setOriginalDimensions(null);
    setTrimmedDimensions(null);
    setTrimMarginsEnabled(true);
    setPreviewTab('trimmed');
    setDisplayNameInput(model.displayName || '');
    setUploadModalOpen(true);
  };

  const handleCloseUpload = () => {
    setUploadModalOpen(false);
    setSelectedModel(null);
    setSelectedFile(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    if (trimmedPreviewUrl) {
      URL.revokeObjectURL(trimmedPreviewUrl);
      setTrimmedPreviewUrl(null);
    }
    setTrimmedBlob(null);
    setOriginalDimensions(null);
    setTrimmedDimensions(null);
  };

  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!selectedModel || !selectedFile) {
      showNotification('Please select an image file to upload.', 'error');
      return;
    }

    try {
      setUploading(true);
      const formData = new FormData();

      if (trimMarginsEnabled && trimmedBlob) {
        // Submit normalized image as primary thumbnail and preserve original file
        formData.append('image', trimmedBlob, selectedFile.name);
        formData.append('originalImage', selectedFile);
        formData.append('isTrimmed', 'true');
      } else {
        // Submit raw original directly without trimming
        formData.append('image', selectedFile);
        formData.append('isTrimmed', 'false');
      }

      if (displayNameInput.trim()) {
        formData.append('displayName', displayNameInput.trim());
      }

      const res = await api.adminUploadDeviceImage(
        selectedModel.manufacturer,
        selectedModel.model,
        formData
      );

      if (res?.success) {
        showNotification(res.message || 'Image uploaded successfully!', 'success');
        handleCloseUpload();
        fetchModels();
      }
    } catch (err) {
      showNotification(err.message || 'Failed to upload image.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleRestoreOriginal = async (model) => {
    if (!window.confirm(`Restore the raw original image for ${model.displayName}?`)) {
      return;
    }

    try {
      const res = await api.adminRestoreOriginalDeviceImage(model.manufacturer, model.model);
      if (res?.success) {
        showNotification('Original device image restored successfully.', 'success');
        fetchModels();
      }
    } catch (err) {
      showNotification(err.message || 'Failed to restore original image.', 'error');
    }
  };

  const handleRemoveImage = async (model) => {
    if (!window.confirm(`Are you sure you want to remove the custom thumbnail for ${model.displayName}? The generic fallback illustration will be restored.`)) {
      return;
    }

    try {
      const res = await api.adminRemoveDeviceImage(model.manufacturer, model.model);
      if (res?.success) {
        showNotification('Thumbnail removed. Generic fallback illustration restored.', 'success');
        fetchModels();
      }
    } catch (err) {
      showNotification(err.message || 'Failed to remove image.', 'error');
    }
  };

  const handleDeleteModel = async (model) => {
    if (!window.confirm(`Are you sure you want to delete ${model.displayName} from the catalog?`)) {
      return;
    }

    try {
      const res = await api.adminDeleteDeviceModel(model.manufacturer, model.model);
      if (res?.success) {
        showNotification(res.message || 'Model deleted from catalog.', 'success');
        fetchModels();
      }
    } catch (err) {
      showNotification(err.message || 'Failed to delete model.', 'error');
    }
  };

  const handleAddModelSubmit = async (e) => {
    e.preventDefault();
    if (!newMfg.trim() || !newModel.trim()) {
      showNotification('Manufacturer and Model Identifier are required.', 'error');
      return;
    }

    try {
      setAddingModel(true);
      const res = await api.adminAddDeviceModel({
        manufacturer: newMfg.trim(),
        model: newModel.trim(),
        displayName: newDisplayName.trim() || null
      });

      if (res?.success) {
        showNotification('Device model registered in catalog!', 'success');
        setNewMfg('');
        setNewModel('');
        setNewDisplayName('');
        setAddModalOpen(false);
        fetchModels();
      }
    } catch (err) {
      showNotification(err.message || 'Failed to register model.', 'error');
    } finally {
      setAddingModel(false);
    }
  };

  // Controlled Restart Execution
  const executeRestart = async () => {
    try {
      setRestarting(true);
      setRestartProgress('Initiating controlled listener recycle...');

      const res = await api.adminRestartBackend();
      if (!res?.success) {
        throw new Error(res?.error || 'Restart initiation failed.');
      }

      setRestartProgress('Backend process recycling... Waiting for health probe...');

      const startTime = Date.now();
      const maxWaitMs = 15000;

      const probeInterval = setInterval(async () => {
        try {
          const health = await api.getHealth();
          if (health?.status === 'ok') {
            clearInterval(probeInterval);
            setRestartProgress('Backend successfully restarted and reconnected!');
            setTimeout(() => {
              setRestarting(false);
              setRestartModalOpen(false);
              setRestartProgress(null);
              fetchModels();
              showNotification('Backend successfully restarted.', 'success');
            }, 1200);
          }
        } catch (_) {
          if (Date.now() - startTime > maxWaitMs) {
            clearInterval(probeInterval);
            setRestartProgress('Restart timed out waiting for health check. Please refresh.');
            setRestarting(false);
          }
        }
      }, 1500);
    } catch (err) {
      setRestartProgress(`Restart error: ${err.message}`);
      setRestarting(false);
      showNotification(err.message || 'Failed to execute restart.', 'error');
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Toast Notification */}
      {notification && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-xl shadow-xl text-xs font-semibold animate-fade-in transition-all ${
          notification.type === 'success'
            ? 'bg-[#064E3B] text-[#34D399] border border-[#059669]'
            : 'bg-[#4C0519] text-[#FECDD3] border border-[#E11D48]'
        }`}>
          {notification.type === 'success' ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
          <span>{notification.message}</span>
        </div>
      )}

      {/* Header Section */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#1C2230] pb-5">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
              <Smartphone className="w-6 h-6 text-[#F59E0B]" />
              <span>Device Management</span>
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-[#78350F] text-[#FDE68A] border border-[#F59E0B]/30 uppercase">
              Admin Only
            </span>
          </div>
          <p className="text-xs text-[#94A3B8] mt-1">
            Manage device catalog models and upload custom thumbnail images. Uploaded images are shared across all users and sessions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setAddModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#F59E0B] hover:bg-[#D97706] text-black font-bold text-xs rounded-lg transition-all shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Device Model</span>
          </button>

          <button
            onClick={() => setRestartModalOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 bg-[#16130C] hover:bg-[#261D10] text-[#EF4444] font-semibold text-xs rounded-lg border border-[#EF4444]/30 transition-all"
            title="Controlled Backend Restart"
          >
            <Server className="w-3.5 h-3.5 text-[#EF4444]" />
            <span>Restart Backend</span>
          </button>
        </div>
      </div>

      {/* Telemetry Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-[#10131B] border border-[#1C2230] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#94A3B8] font-medium">Total Models</span>
            <Layers className="w-4 h-4 text-[#F59E0B]" />
          </div>
          <div className="text-2xl font-bold text-white font-mono mt-2">{data.summary.totalModels}</div>
          <p className="text-[10px] text-[#64748B] mt-1">Registered in catalog</p>
        </div>

        <div className="bg-[#10131B] border border-[#1C2230] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#94A3B8] font-medium">With Custom Image</span>
            <CheckCircle2 className="w-4 h-4 text-[#10B981]" />
          </div>
          <div className="text-2xl font-bold text-[#34D399] font-mono mt-2">{data.summary.withImages}</div>
          <p className="text-[10px] text-[#64748B] mt-1">Real thumbnails active</p>
        </div>

        <div className="bg-[#10131B] border border-[#1C2230] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#94A3B8] font-medium">Missing Image</span>
            <Sparkles className="w-4 h-4 text-[#94A3B8]" />
          </div>
          <div className="text-2xl font-bold text-[#FBBF24] font-mono mt-2">{data.summary.missingImages}</div>
          <p className="text-[10px] text-[#64748B] mt-1">Using SVG fallback</p>
        </div>

        <div className="bg-[#10131B] border border-[#1C2230] rounded-xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-[#94A3B8] font-medium">Connected Devices</span>
            <Wifi className="w-4 h-4 text-[#38BDF8]" />
          </div>
          <div className="text-2xl font-bold text-[#38BDF8] font-mono mt-2">{data.summary.connectedCount}</div>
          <p className="text-[10px] text-[#64748B] mt-1">Physically online now</p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-[#10131B] border border-[#1C2230] p-3 rounded-xl">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search models, brands..."
            className="w-full bg-[#080B10] border border-[#1C2230] rounded-lg pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {[
            { id: 'all', label: 'All Models' },
            { id: 'connected', label: 'Connected' },
            { id: 'has_image', label: 'Has Image' },
            { id: 'missing_image', label: 'Missing Image' }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setFilter(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${
                filter === tab.id
                  ? 'bg-[#F59E0B] text-black shadow-xs'
                  : 'bg-[#080B10] text-[#94A3B8] hover:text-white border border-[#1C2230]'
              }`}
            >
              {tab.label}
            </button>
          ))}

          <button
            onClick={() => fetchModels()}
            className="p-1.5 rounded-lg bg-[#080B10] hover:bg-[#1C2230] text-[#94A3B8] hover:text-white border border-[#1C2230] transition-all ml-1"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Device Models Grid */}
      {loading ? (
        <div className="p-12 text-center text-slate-400">
          <RefreshCw className="w-8 h-8 text-[#F59E0B] animate-spin mx-auto mb-3" />
          <p className="text-xs">Loading device models...</p>
        </div>
      ) : data.models.length === 0 ? (
        <div className="p-12 text-center bg-[#10131B] border border-[#1C2230] rounded-xl text-slate-400">
          <Smartphone className="w-10 h-10 mx-auto mb-3 text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-200">No Device Models Found</h3>
          <p className="text-xs text-slate-500 mt-1">
            {search || filter !== 'all' ? 'Try adjusting your search or filters.' : 'Click "Add Device Model" to register your first model.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.models.map((model) => (
            <div
              key={`${model.manufacturer}:${model.model}`}
              className="bg-[#10131B] border border-[#1C2230] rounded-xl p-4 flex flex-col justify-between hover:border-[#F59E0B]/30 transition-all"
            >
              <div>
                {/* Header row: Thumbnail + Info */}
                <div className="flex items-start gap-3.5">
                  <div className="relative">
                    <DeviceThumbnail
                      device={{ manufacturer: model.manufacturer, model: model.model, displayName: model.displayName }}
                      size="lg"
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-white truncate" title={model.displayName}>
                        {model.displayName}
                      </span>
                      {model.isConnected && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-[#064E3B] text-[#34D399] border border-[#059669]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-pulse"></span>
                          Online ({model.connectedCount})
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-[#94A3B8] font-mono mt-1">
                      <span className="capitalize">{model.manufacturer}</span> • <span className="font-semibold text-slate-300">{model.model}</span>
                    </div>

                    {/* Image Status Pill */}
                    <div className="mt-2">
                      {model.hasImage ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#0C4A6E] text-[#38BDF8] border border-[#0284C7]">
                          <CheckCircle2 className="w-3 h-3 text-[#38BDF8]" />
                          Custom Thumbnail Active
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-[#080B10] text-[#94A3B8] border border-[#1C2230]">
                          <Sparkles className="w-3 h-3 text-[#F59E0B]" />
                          SVG Fallback Illustration
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Metadata details if image uploaded */}
                {model.hasImage && (
                  <div className="mt-3 pt-3 border-t border-[#1C2230] text-[10px] text-[#64748B] font-mono grid grid-cols-2 gap-1">
                    <div>
                      Resolution: <span className="text-slate-300">{model.width}x{model.height}</span>
                    </div>
                    <div>
                      Size: <span className="text-slate-300">{(model.fileSize / 1024).toFixed(1)} KB</span>
                    </div>
                    <div>
                      Type: <span className="text-slate-300 uppercase">{model.mimeType?.replace('image/', '')}</span>
                    </div>
                    <div>
                      Fit: <span className={model.isTrimmed ? 'text-emerald-400 font-semibold' : 'text-slate-300'}>{model.isTrimmed ? 'Trimmed' : 'Original'}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions row */}
              <div className="mt-4 pt-3 border-t border-[#1C2230] flex items-center justify-between gap-2">
                <button
                  onClick={() => handleOpenUpload(model)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F59E0B] hover:bg-[#D97706] text-black font-bold text-xs rounded-lg transition-all shadow-xs"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{model.hasImage ? 'Replace Image' : 'Upload Image'}</span>
                </button>

                <div className="flex items-center gap-1.5">
                  {model.hasImage && model.isTrimmed && model.hasOriginal && (
                    <button
                      onClick={() => handleRestoreOriginal(model)}
                      className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-[#080B10] hover:bg-[#1C2230] text-[#F59E0B] hover:text-[#FBBF24] border border-[#F59E0B]/30 text-[11px] font-mono transition-all"
                      title="Restore preserved raw original image"
                    >
                      <RotateCcw className="w-3 h-3 text-[#F59E0B]" />
                      <span>Restore Orig</span>
                    </button>
                  )}

                  {model.hasImage && (
                    <button
                      onClick={() => handleRemoveImage(model)}
                      className="p-1.5 rounded-lg bg-[#080B10] hover:bg-[#4C0519] text-[#FECDD3] hover:text-[#F43F5E] border border-[#1C2230] transition-all"
                      title="Remove custom image (restore fallback)"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {!model.isConnected && (
                    <button
                      onClick={() => handleDeleteModel(model)}
                      className="p-1.5 rounded-lg bg-[#080B10] hover:bg-[#4C0519] text-[#94A3B8] hover:text-rose-400 border border-[#1C2230] transition-all"
                      title="Delete model from catalog"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload Image Modal */}
      {uploadModalOpen && selectedModel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#10131B] border border-[#1C2230] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#1C2230] pb-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#F59E0B]" />
                <span>Upload Device Thumbnail</span>
              </h2>
              <button onClick={handleCloseUpload} className="text-[#64748B] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">Target Model Identifier</label>
                <div className="p-2.5 bg-[#080B10] border border-[#1C2230] rounded-lg text-xs font-mono text-white flex items-center justify-between">
                  <span>{selectedModel.manufacturer} • {selectedModel.model}</span>
                  <span className="text-[10px] text-[#64748B]">Normalized Key</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">Display Name (Optional)</label>
                <input
                  type="text"
                  value={displayNameInput}
                  onChange={(e) => setDisplayNameInput(e.target.value)}
                  placeholder="e.g. Vivo V2143 (Android 13)"
                  className="w-full bg-[#080B10] border border-[#1C2230] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
                />
              </div>

              {/* Dropzone & Preview */}
              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">Select Image File (PNG, JPG, WebP &le; 2MB)</label>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-[#1C2230] hover:border-[#F59E0B] rounded-xl p-4 text-center cursor-pointer bg-[#080B10] transition-all"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => handleFileChange(e.target.files?.[0])}
                    className="hidden"
                  />

                  {previewUrl ? (
                    <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                      {/* Trimming preview comparison tabs */}
                      {trimmedPreviewUrl && (
                        <div className="flex items-center justify-center gap-1.5 p-1 bg-[#080B10] rounded-lg border border-[#1C2230] text-[11px] font-mono">
                          <button
                            type="button"
                            onClick={() => { setPreviewTab('trimmed'); setTrimMarginsEnabled(true); }}
                            className={`px-2.5 py-1 rounded-md transition-all font-semibold ${
                              previewTab === 'trimmed' && trimMarginsEnabled
                                ? 'bg-[#064E3B] text-[#34D399] border border-[#059669]'
                                : 'text-[#94A3B8] hover:text-white'
                            }`}
                          >
                            Trimmed ({trimmedDimensions?.width}x{trimmedDimensions?.height})
                          </button>
                          <button
                            type="button"
                            onClick={() => { setPreviewTab('original'); setTrimMarginsEnabled(false); }}
                            className={`px-2.5 py-1 rounded-md transition-all font-semibold ${
                              previewTab === 'original' || !trimMarginsEnabled
                                ? 'bg-[#1C2230] text-white border border-[#334155]'
                                : 'text-[#94A3B8] hover:text-white'
                            }`}
                          >
                            Original ({originalDimensions?.width}x{originalDimensions?.height})
                          </button>
                        </div>
                      )}

                      {/* Frame preview */}
                      <div className="w-24 h-36 mx-auto bg-[#080B10] rounded-xl overflow-hidden border border-[#1C2230] p-1 flex items-center justify-center shadow-inner">
                        <img
                          src={trimMarginsEnabled && trimmedPreviewUrl && previewTab === 'trimmed' ? trimmedPreviewUrl : previewUrl}
                          alt="Thumbnail Preview"
                          className="w-full h-full object-contain"
                        />
                      </div>

                      {/* Trimming toggle */}
                      {trimmedPreviewUrl && (
                        <label className="flex items-center justify-center gap-2 text-xs text-slate-300 cursor-pointer pt-1">
                          <input
                            type="checkbox"
                            checked={trimMarginsEnabled}
                            onChange={(e) => {
                              setTrimMarginsEnabled(e.target.checked);
                              setPreviewTab(e.target.checked ? 'trimmed' : 'original');
                            }}
                            className="rounded border-[#1C2230] bg-[#080B10] text-[#F59E0B] focus:ring-0"
                          />
                          <span>Trim outer whitespace margins (Recommended)</span>
                        </label>
                      )}

                      <div className="text-center">
                        <p className="text-xs font-semibold text-[#34D399] truncate max-w-[280px] mx-auto">{selectedFile?.name}</p>
                        <p className="text-[10px] text-[#64748B]">
                          {(selectedFile?.size / 1024).toFixed(1)} KB •
                          <span
                            onClick={() => fileInputRef.current?.click()}
                            className="text-[#F59E0B] hover:underline cursor-pointer ml-1"
                          >
                            Change file
                          </span>
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 py-4">
                      <ImageIcon className="w-8 h-8 text-[#64748B] mx-auto" />
                      <p className="text-xs text-slate-300 font-semibold">Click to browse or drag and drop image here</p>
                      <p className="text-[10px] text-[#64748B]">PNG, JPEG, or WebP up to 2MB (Recommended ratio 9:16 portrait)</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1C2230]">
                <button
                  type="button"
                  onClick={handleCloseUpload}
                  className="px-4 py-2 rounded-lg bg-[#080B10] hover:bg-[#1C2230] text-slate-300 border border-[#1C2230] text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !selectedFile}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F59E0B] text-black text-xs font-bold hover:bg-[#D97706] disabled:opacity-50 shadow-sm"
                >
                  {uploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Uploading...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-3.5 h-3.5" />
                      <span>Save & Publish</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add Device Model Modal */}
      {addModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#10131B] border border-[#1C2230] rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-[#1C2230] pb-3">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-[#F59E0B]" />
                <span>Register Device Model in Catalog</span>
              </h2>
              <button onClick={() => setAddModalOpen(false)} className="text-[#64748B] hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddModelSubmit} className="space-y-4">
              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">Manufacturer *</label>
                <input
                  type="text"
                  value={newMfg}
                  onChange={(e) => setNewMfg(e.target.value)}
                  placeholder="e.g. vivo, motorola, samsung, apple"
                  required
                  className="w-full bg-[#080B10] border border-[#1C2230] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">Exact Model Identifier *</label>
                <input
                  type="text"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                  placeholder="e.g. v2143, motog965g, lxx523, sm-e025f"
                  required
                  className="w-full bg-[#080B10] border border-[#1C2230] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
                />
                <p className="text-[10px] text-[#64748B] mt-1">This should match the internal Android model or iOS hardware ID.</p>
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#94A3B8] mb-1">Display Name (Optional)</label>
                <input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder="e.g. Vivo V2143 (Android 13)"
                  className="w-full bg-[#080B10] border border-[#1C2230] rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1C2230]">
                <button
                  type="button"
                  onClick={() => setAddModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-[#080B10] hover:bg-[#1C2230] text-slate-300 border border-[#1C2230] text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingModel}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#F59E0B] text-black text-xs font-bold hover:bg-[#D97706] disabled:opacity-50 shadow-sm"
                >
                  {addingModel ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Register Model</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Controlled Backend Restart Modal */}
      {restartModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-fade-in">
          <div className="bg-[#10131B] border border-[#EF4444]/40 rounded-2xl w-full max-w-md p-6 space-y-4 shadow-2xl">
            <div className="flex items-center gap-3 text-[#EF4444]">
              <Server className="w-6 h-6 shrink-0" />
              <div>
                <h2 className="text-sm font-bold text-white">Controlled Backend Restart</h2>
                <p className="text-[11px] text-[#94A3B8]">Safe listener recycle on port 8080 without port collisions</p>
              </div>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              This safely recycles the Node.js server listener and device configuration stores. Existing certificates, HTTPS settings, and connected device sessions remain intact.
            </p>

            {restartProgress && (
              <div className="p-3 bg-[#080B10] border border-[#1C2230] rounded-xl text-xs font-mono text-[#F59E0B] flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                <span>{restartProgress}</span>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1C2230]">
              <button
                type="button"
                onClick={() => setRestartModalOpen(false)}
                disabled={restarting}
                className="px-4 py-2 rounded-lg bg-[#080B10] hover:bg-[#1C2230] text-slate-300 border border-[#1C2230] text-xs font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={executeRestart}
                disabled={restarting}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#991B1B] hover:bg-[#B91C1C] text-white text-xs font-bold disabled:opacity-50 shadow-sm"
              >
                {restarting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Server className="w-3.5 h-3.5" />}
                <span>{restarting ? 'Restarting...' : 'Confirm Restart'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
