import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FileSpreadsheet,
  Play,
  Square,
  Upload,
  RefreshCw,
  Search,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  AlertCircle,
  HelpCircle,
  Trash2,
  Plus,
  Smartphone,
  ChevronRight,
  Activity,
  Eye,
  GripVertical,
  Bug,
  RotateCcw,
  ArrowLeft
} from 'lucide-react';
import { api } from '../services/api';
import { formatDeviceModelName } from '../utils/deviceFormatter';
import {
  formatValueForBug,
  getAttributeDisplayValues,
  generateBugStatement,
  generateBugDescription,
  groupAttributesByStatus
} from '../utils/mixpanelBugWriter';
import {
  filterAttributesByStatus,
  getStatusTitle,
  getEmptyStateMessage
} from '../utils/mixpanelFilter';

export default function MixpanelValidatorPage({
  devices = [],
  selectedDevice = null,
  setSelectedDevice = () => {},
  currentUser = null
}) {
  // State
  const [status, setStatus] = useState(null);
  const [specifications, setSpecifications] = useState([]);
  const [selectedSpecId, setSelectedSpecId] = useState('');
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [events, setEvents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

  // Filters & Search
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [activeAttrFilter, setActiveAttrFilter] = useState('ALL'); // 'ALL' | 'MATCHED' | 'MISSING' | 'EXTRA' | 'INCORRECT'
  const [activeTab, setActiveTab] = useState('attributes'); // 'attributes' | 'raw'
  const [copied, setCopied] = useState(false);

  // Draggable Split Pane Width (%)
  const [leftWidthPercent, setLeftWidthPercent] = useState(34);
  const isDraggingRef = useRef(false);

  // Manual Event Injection Modal
  const [injectModalOpen, setInjectModalOpen] = useState(false);
  const [injectPayloadText, setInjectPayloadText] = useState('{\n  "event": "app_open",\n  "properties": {\n    "distinct_id": "user_123",\n    "app_version": "1.0.0",\n    "platform": "Android"\n  }\n}');

  // Bug Writer Modal State
  const [bugModalOpen, setBugModalOpen] = useState(false);
  const [bugModalView, setBugModalView] = useState('select'); // 'select' | 'edit'
  const [selectedAttrNames, setSelectedAttrNames] = useState(new Set());
  const [editableBugText, setEditableBugText] = useState('');
  const [lastGeneratedText, setLastGeneratedText] = useState('');
  const [confirmRegenOpen, setConfirmRegenOpen] = useState(false);
  const [pendingRegenText, setPendingRegenText] = useState(null);
  const [bugCopied, setBugCopied] = useState(false);
  const currentBugEventIdRef = useRef(null);

  // Clear Events State
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [isClearingEvents, setIsClearingEvents] = useState(false);

  const fileInputRef = useRef(null);
  const pollIntervalRef = useRef(null);

  // 1. Initial Load: Mixpanel Status, Specifications, Active Sessions
  const loadInitialData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusRes, specsRes, sessionsRes] = await Promise.all([
        api.getMixpanelStatus().catch(err => {
          console.warn('[MixpanelValidator] Status check error:', err.message);
          return { success: false, data: null };
        }),
        api.getMixpanelSpecifications().catch(err => {
          throw new Error(`Failed to load event specifications: ${err.message}`);
        }),
        api.getMixpanelSessions().catch(err => {
          throw new Error(`Failed to load capture sessions: ${err.message}`);
        })
      ]);

      if (statusRes?.success) setStatus(statusRes.data);

      const specs = specsRes?.data || [];
      setSpecifications(specs);
      setSelectedSpecId(prev => (prev && specs.some(s => s.id === prev)) ? prev : (specs[0]?.id || ''));

      const userSessions = sessionsRes?.data || [];
      setSessions(userSessions);

      // Check if there is an active session
      const running = userSessions.find(s => s.status === 'ACTIVE');
      if (running) {
        setActiveSession(running);
      }
    } catch (err) {
      setError(err.message || 'Failed to load Mixpanel validator data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  // 2. Poll Events for Active Session
  const fetchSessionEvents = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await api.getMixpanelEvents(sessionId, {
        search: searchTerm,
        status: statusFilter,
        limit: 200
      });
      if (res?.success && res.data?.events) {
        setEvents(res.data.events);
        // If an event was selected, refresh its details from the new event list
        setSelectedEvent(prev => {
          if (!prev) return res.data.events[0] || null;
          const match = res.data.events.find(e => e.id === prev.id);
          return match || prev;
        });
      }
    } catch (err) {
      console.warn('[MixpanelValidator] Error polling events:', err.message);
    }
  }, [searchTerm, statusFilter]);

  // Manage Polling Interval when session is ACTIVE
  useEffect(() => {
    if (activeSession && activeSession.status === 'ACTIVE') {
      fetchSessionEvents(activeSession.id);
      pollIntervalRef.current = setInterval(() => {
        fetchSessionEvents(activeSession.id);
      }, 3000);
    } else {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [activeSession, fetchSessionEvents]);

  // 3. Upload Excel Specification
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await api.uploadMixpanelSpecification(file);
      if (res?.success && res.data) {
        setSuccessMsg(`Specification "${res.data.name}" v${res.data.version} parsed successfully (${res.data.events_count} events).`);
        await loadInitialData();
        setSelectedSpecId(res.data.id);
      }
    } catch (err) {
      setError(err.message || 'Failed to parse Excel workbook.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // 4. Delete Specification
  const handleDeleteSpec = async (specId) => {
    if (!confirm('Are you sure you want to delete this event specification?')) return;
    try {
      await api.deleteMixpanelSpecification(specId);
      if (selectedSpecId === specId) {
        setSelectedSpecId('');
      }
      await loadInitialData();
      setSuccessMsg('Specification deleted.');
    } catch (err) {
      setError(err.message || 'Failed to delete specification.');
    }
  };

  // 5. Start Capture Session
  const handleStartCapture = async () => {
    if (!selectedDevice) {
      setError('Please select an active device first.');
      return;
    }

    setError(null);
    setSuccessMsg(null);
    setLoading(true);

    try {
      const res = await api.startMixpanelSession({
        deviceSerial: selectedDevice.serial || selectedDevice.id,
        deviceName: selectedDevice.model || selectedDevice.name || selectedDevice.serial,
        specId: selectedSpecId || null
      });

      if (res?.success && res.data) {
        setActiveSession(res.data);
        setEvents([]);
        setSelectedEvent(null);
        setSuccessMsg(`Capture session started on ${res.data.device_name || res.data.device_serial}.`);
        await loadInitialData();
      }
    } catch (err) {
      if (err.status === 409 || err.data?.code === 'CAPTURE_DEVICE_CONFLICT' || (err.message && err.message.includes('already has an active Mixpanel capture session'))) {
        setError(`Conflict: Device ${selectedDevice.serial || selectedDevice.id} already has an active Mixpanel capture session. Please stop the ongoing session first.`);
      } else {
        setError(err.message || 'Failed to start capture session.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 6. Stop Capture Session
  const handleStopCapture = async () => {
    if (!activeSession) return;
    setLoading(true);
    try {
      const res = await api.stopMixpanelSession(activeSession.id);
      if (res?.success) {
        setActiveSession(null);
        setSuccessMsg('Capture session stopped.');
        await loadInitialData();
      }
    } catch (err) {
      setError(err.message || 'Failed to stop capture session.');
    } finally {
      setLoading(false);
    }
  };

  // 6b. Clear All Recorded Events in Current Session
  const handleConfirmClearEvents = async () => {
    if (!activeSession) return;
    setIsClearingEvents(true);
    setError(null);
    try {
      await api.clearMixpanelEvents(activeSession.id);
      setEvents([]);
      setSelectedEvent(null);
      setClearConfirmOpen(false);
      setSuccessMsg('All recorded events for this session have been cleared.');
      // Refresh session list so session event count is synchronized
      const sessionsRes = await api.getMixpanelSessions().catch(() => null);
      if (sessionsRes?.data) setSessions(sessionsRes.data);
    } catch (err) {
      setError(err.message || 'Failed to clear events.');
    } finally {
      setIsClearingEvents(false);
    }
  };

  // 7. Inject Test Event
  const handleInjectEvent = async () => {
    if (!activeSession) {
      setError('Start a capture session before injecting events.');
      return;
    }

    try {
      const parsed = JSON.parse(injectPayloadText);
      const res = await api.injectMixpanelEvent(activeSession.id, parsed);
      if (res?.success) {
        setInjectModalOpen(false);
        setSuccessMsg('Event injected and validated successfully.');
        await fetchSessionEvents(activeSession.id);
      }
    } catch (err) {
      setError('Invalid JSON payload or injection failed: ' + err.message);
    }
  };

  // 8. Revalidate Event
  const handleRevalidateEvent = async (eventId) => {
    if (!activeSession || !eventId) return;
    try {
      const res = await api.revalidateMixpanelEvent(activeSession.id, eventId, selectedSpecId);
      if (res?.success) {
        setSuccessMsg('Event revalidated.');
        await fetchSessionEvents(activeSession.id);
      }
    } catch (err) {
      setError(err.message || 'Failed to revalidate event.');
    }
  };

  // Helper for copying JSON
  const handleCopyJson = (obj) => {
    const text = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Draggable Splitter Mouse Down Handler
  const handleMouseDown = useCallback((e) => {
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent) => {
      if (!isDraggingRef.current) return;
      const container = document.getElementById('mixpanel-workspace-container');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newWidth = ((moveEvent.clientX - rect.left) / rect.width) * 100;
      if (newWidth >= 25 && newWidth <= 55) {
        setLeftWidthPercent(newWidth);
      }
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Get selected specification details
  const activeSpec = specifications.find(s => s.id === selectedSpecId) || null;

  // Selected event parsed details
  const parsedPayload = selectedEvent?.raw_payload
    ? (typeof selectedEvent.raw_payload === 'string' ? JSON.parse(selectedEvent.raw_payload) : selectedEvent.raw_payload)
    : null;

  const validationSummary = selectedEvent?.validation_summary
    ? (typeof selectedEvent.validation_summary === 'string' ? JSON.parse(selectedEvent.validation_summary) : selectedEvent.validation_summary)
    : null;

  // Dynamic filter pill counts
  const filterCounts = useMemo(() => {
    return {
      ALL: events.length,
      MATCHED: events.filter(e => e.validation_status === 'MATCHED').length,
      MISSING: events.filter(e => e.validation_status === 'MISSING').length,
      EXTRA: events.filter(e => e.validation_status === 'EXTRA').length,
      INCORRECT: events.filter(e => e.validation_status === 'INCORRECT').length,
      UNMAPPED: events.filter(e => e.validation_status === 'UNMAPPED').length
    };
  }, [events]);

  // Filtered events
  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      if (statusFilter !== 'ALL' && e.validation_status !== statusFilter) return false;
      if (searchTerm.trim()) {
        const term = searchTerm.toLowerCase();
        const name = (e.event_name || '').toLowerCase();
        const distinct = (e.distinct_id || '').toLowerCase();
        return name.includes(term) || distinct.includes(term);
      }
      return true;
    });
  }, [events, statusFilter, searchTerm]);

  // Metric counts for selected event
  const metrics = useMemo(() => {
    if (validationSummary?.metrics) {
      return validationSummary.metrics;
    }
    const attrs = validationSummary?.attributes || [];
    return {
      matched: attrs.filter(a => a.status === 'MATCHED').length,
      missing: attrs.filter(a => a.status === 'MISSING').length,
      extra: attrs.filter(a => a.status === 'EXTRA').length,
      incorrect: attrs.filter(a => a.status === 'INCORRECT').length
    };
  }, [validationSummary]);

  // All attributes for selected event
  const allAttributes = useMemo(() => {
    return validationSummary?.attributes || [];
  }, [validationSummary]);

  // Reset attribute filter when switching selected event
  useEffect(() => {
    setActiveAttrFilter('ALL');
  }, [selectedEvent?.id]);

  // Filtered attributes based on active summary card filter
  const visibleAttributes = useMemo(() => {
    return filterAttributesByStatus(allAttributes, activeAttrFilter);
  }, [allAttributes, activeAttrFilter]);

  // Grouped attributes by validation status for Bug Writer
  const groupedAttributes = useMemo(() => {
    return groupAttributesByStatus(allAttributes);
  }, [allAttributes]);

  // Open Bug Modal (starts fresh with no pre-selected attributes on new event)
  const handleOpenBugModal = () => {
    if (selectedEvent?.id !== currentBugEventIdRef.current) {
      currentBugEventIdRef.current = selectedEvent?.id;
      setSelectedAttrNames(new Set());
      setEditableBugText('');
      setLastGeneratedText('');
      setBugModalView('select');
      setPendingRegenText(null);
      setConfirmRegenOpen(false);
    }
    setBugModalOpen(true);
  };

  const handleCloseBugModal = () => {
    setBugModalOpen(false);
    setConfirmRegenOpen(false);
  };

  const handleToggleAttr = (attrName) => {
    setSelectedAttrNames(prev => {
      const next = new Set(prev);
      if (next.has(attrName)) {
        next.delete(attrName);
      } else {
        next.add(attrName);
      }
      return next;
    });
  };

  const handleSelectAllAttrs = () => {
    setSelectedAttrNames(new Set(allAttributes.map(a => a.name)));
  };

  const handleClearAllAttrs = () => {
    setSelectedAttrNames(new Set());
  };

  const handleGenerateBug = () => {
    const selectedList = allAttributes.filter(a => selectedAttrNames.has(a.name));
    if (selectedList.length === 0) return;

    const newGenerated = generateBugDescription(selectedEvent?.event_name, selectedList);

    const isEdited = editableBugText && editableBugText !== lastGeneratedText;
    if (isEdited) {
      setPendingRegenText(newGenerated);
      setConfirmRegenOpen(true);
      return;
    }

    setEditableBugText(newGenerated);
    setLastGeneratedText(newGenerated);
    setBugModalView('edit');
  };

  const handleRegenerateFromEdit = () => {
    const selectedList = allAttributes.filter(a => selectedAttrNames.has(a.name));
    const newGenerated = generateBugDescription(selectedEvent?.event_name, selectedList);

    const isEdited = editableBugText && editableBugText !== lastGeneratedText;
    if (isEdited) {
      setPendingRegenText(newGenerated);
      setConfirmRegenOpen(true);
      return;
    }

    setEditableBugText(newGenerated);
    setLastGeneratedText(newGenerated);
  };

  const handleConfirmRegenerate = () => {
    const textToUse = pendingRegenText !== null ? pendingRegenText : generateBugDescription(
      selectedEvent?.event_name,
      allAttributes.filter(a => selectedAttrNames.has(a.name))
    );
    setEditableBugText(textToUse);
    setLastGeneratedText(textToUse);
    setPendingRegenText(null);
    setConfirmRegenOpen(false);
    setBugModalView('edit');
  };

  const handleCancelRegenerate = () => {
    setPendingRegenText(null);
    setConfirmRegenOpen(false);
  };

  const handleBackToSelection = () => {
    setBugModalView('select');
  };

  const handleCopyBugText = async () => {
    if (!editableBugText) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(editableBugText);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = editableBugText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setBugCopied(true);
      setTimeout(() => setBugCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy bug text to clipboard:', err);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#080B11] text-slate-200 overflow-hidden">
      {/* 1. Top Header Card & Capture Toolbar */}
      <div className="bg-[#10131B] border border-[#1C2230] rounded-2xl p-4 shadow-sm mb-4 shrink-0">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Left: Icon, Title & Subtitle */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-500/30 flex items-center justify-center text-purple-400 shadow-inner shrink-0">
              <FileSpreadsheet className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-[15.5px] font-bold text-white tracking-wide">Mixpanel Event Validator</h1>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  Device Stream (ADB)
                </span>
              </div>
              <p className="text-[12.5px] text-slate-400 mt-0.5">Validate real-time native analytics events against Excel event specs</p>
            </div>
          </div>

          {/* Right: Compact Action Controls in a Clean Row */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Hidden File Input */}
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileUpload}
              accept=".xlsx"
              className="hidden"
            />

            {/* Upload Excel Spec Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/30 transition-colors disabled:opacity-50"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{isUploading ? 'Parsing...' : 'Upload Excel Spec'}</span>
            </button>

            {/* Specification Selector Pill */}
            <div className="flex items-center bg-[#080B10] px-3 py-1.5 rounded-lg border border-[#1C2230] text-[12.5px]">
              <span className="text-slate-400 mr-1.5 font-medium">Spec:</span>
              {specifications.length > 0 ? (
                <select
                  value={selectedSpecId}
                  onChange={(e) => setSelectedSpecId(e.target.value)}
                  className="bg-transparent text-[12.5px] text-white font-medium focus:outline-none cursor-pointer max-w-[170px] truncate"
                >
                  {specifications.map((s) => (
                    <option key={s.id} value={s.id} className="bg-[#10131B] text-slate-200">
                      {s.name} (v{s.version} • {s.events_count} ev)
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-amber-400/90 italic">No specs uploaded</span>
              )}

              {activeSpec && (
                <button
                  onClick={() => handleDeleteSpec(activeSpec.id)}
                  title="Delete this specification"
                  className="text-slate-400 hover:text-rose-400 transition-colors ml-2 p-0.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Device Selector Pill */}
            <div className="flex items-center bg-[#080B10] px-3 py-1.5 rounded-lg border border-[#1C2230] text-[12.5px]">
              <Smartphone className="w-3.5 h-3.5 text-slate-400 mr-1.5" />
              <span className="text-slate-400 mr-1.5 font-medium">Device:</span>
              {devices.length > 0 ? (
                <select
                  value={selectedDevice?.serial || selectedDevice?.id || ''}
                  onChange={(e) => {
                    const dev = devices.find(d => (d.serial || d.id) === e.target.value);
                    if (dev) setSelectedDevice(dev);
                  }}
                  className="bg-transparent text-[12.5px] text-white font-medium focus:outline-none cursor-pointer max-w-[140px] truncate"
                >
                  {devices.map((d) => (
                    <option key={d.serial || d.id} value={d.serial || d.id} className="bg-[#10131B] text-slate-200">
                      {formatDeviceModelName(d) || d.model || d.name || d.serial}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-rose-400/90 italic">No devices</span>
              )}
            </div>

            {/* Session Capture Controls */}
            {activeSession && activeSession.status === 'ACTIVE' ? (
              <button
                onClick={handleStopCapture}
                disabled={loading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/40 transition-colors"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Stop Capture
              </button>
            ) : (
              <button
                onClick={handleStartCapture}
                disabled={loading || !selectedDevice || specifications.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Start Capture
              </button>
            )}

            {/* Manual Inject Button */}
            <button
              onClick={() => {
                if (!activeSession) {
                  setError('Please start a capture session before injecting events.');
                  return;
                }
                setInjectModalOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-purple-600 hover:bg-purple-500 text-white shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Inject Event</span>
            </button>
          </div>
        </div>
      </div>

      {/* Notifications / Alerts */}
      {error && (
        <div className="mb-3 px-4 py-2.5 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center justify-between text-xs text-rose-400">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-rose-400/80 hover:text-rose-200">✕</button>
        </div>
      )}
      {successMsg && (
        <div className="mb-3 px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl flex items-center justify-between text-xs text-emerald-400">
          <div className="flex items-center gap-2">
            <Check className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-400/80 hover:text-emerald-200">✕</button>
        </div>
      )}

      {/* 2. Main Two-Pane Split Workspace */}
      <div id="mixpanel-workspace-container" className="flex-1 flex flex-col lg:flex-row gap-3 min-h-0 overflow-hidden">
        {/* LEFT PANE: Event Stream & Filters */}
        <div
          style={{ width: typeof window !== 'undefined' && window.innerWidth >= 1024 ? `${leftWidthPercent}%` : '100%' }}
          className="bg-[#10131B] border border-[#1C2230] rounded-2xl flex flex-col overflow-hidden min-w-[300px] shrink-0"
        >
          {/* List Title & Clear Events Action */}
          <div className="p-4 pb-2.5 flex items-center justify-between">
            <h2 className="text-[15px] font-bold text-white tracking-wide">Events ({events.length})</h2>
            <button
              type="button"
              onClick={() => setClearConfirmOpen(true)}
              disabled={events.length === 0 || !activeSession || isClearingEvents}
              title="Clear all recorded events in this session"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 border border-[#1C2230] hover:border-rose-500/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-slate-400 disabled:hover:bg-transparent disabled:hover:border-[#1C2230]"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear Events</span>
            </button>
          </div>

          {/* Search Input */}
          <div className="px-4 pb-2.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
              <input
                type="text"
                placeholder="Search event name or ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-[#080B10] border border-[#1C2230] rounded-xl pl-9 pr-3 py-2 text-[13px] text-[#E2E8F0] placeholder-slate-500 focus:outline-none focus:border-indigo-500/70 transition-colors"
              />
            </div>
          </div>

          {/* Status Filter Pills Row */}
          <div className="px-4 pb-3 flex items-center gap-1.5 overflow-x-auto text-xs no-scrollbar">
            {[
              { id: 'ALL', label: `All ${filterCounts.ALL}` },
              { id: 'MATCHED', label: `Matched ${filterCounts.MATCHED}` },
              { id: 'MISSING', label: `Missing ${filterCounts.MISSING}` },
              { id: 'EXTRA', label: `Extra ${filterCounts.EXTRA}` },
              { id: 'INCORRECT', label: `Incorrect ${filterCounts.INCORRECT}` },
              { id: 'UNMAPPED', label: `Unmapped ${filterCounts.UNMAPPED}` }
            ].map((pill) => (
              <button
                key={pill.id}
                onClick={() => setStatusFilter(pill.id)}
                className={`px-2.5 py-1 rounded-md transition-colors whitespace-nowrap text-[12.5px] ${
                  statusFilter === pill.id
                    ? 'bg-indigo-600 text-white font-medium shadow-sm'
                    : 'bg-[#080B10] text-slate-400 hover:text-slate-200 hover:bg-[#161B26] border border-[#1C2230]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Event Stream List */}
          <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-1">
            {filteredEvents.length === 0 ? (
              <div className="p-8 text-center text-slate-500">
                {activeSession ? (
                  <div className="space-y-2">
                    <Activity className="w-8 h-8 text-slate-600 mx-auto animate-pulse" />
                    <p className="text-xs text-slate-400 font-medium">Listening for Mixpanel events...</p>
                    <p className="text-[11px] text-slate-600">Perform user actions in the app to capture and validate.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <FileSpreadsheet className="w-8 h-8 text-slate-600 mx-auto" />
                    <p className="text-xs text-slate-400 font-medium">No active capture session</p>
                    <p className="text-[11px] text-slate-600">Select an Excel specification and device, then click "Start Capture".</p>
                  </div>
                )}
              </div>
            ) : (
              filteredEvents.map((ev) => {
                const isSelected = selectedEvent?.id === ev.id;
                const statusBadge = getStatusBadge(ev.validation_status);

                return (
                  <div
                    key={ev.id}
                    onClick={() => setSelectedEvent(ev)}
                    className={`px-3.5 py-2.5 rounded-xl cursor-pointer transition-all flex items-center justify-between gap-3 ${
                      isSelected
                        ? 'bg-indigo-950/40 border border-indigo-500/40 shadow-sm'
                        : 'hover:bg-[#080B10] border border-transparent'
                    }`}
                  >
                    {/* Left: Event Name */}
                    <div className="min-w-0 flex-1">
                      <span className="text-[13.5px] font-semibold text-white truncate font-mono block tracking-tight" title={ev.event_name}>
                        {ev.event_name}
                      </span>
                    </div>

                    {/* Middle: Compact Timestamp */}
                    <div className="text-xs text-slate-400 whitespace-nowrap">
                      {formatTimeOnly(ev.event_time)}
                    </div>

                    {/* Right: Validation Status Badge + Chevron (No Device Badge) */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {statusBadge}
                      <ChevronRight className="w-3.5 h-3.5 text-slate-500 ml-0.5" />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* DRAGGABLE DIVIDER (Desktop only) */}
        <div
          onMouseDown={handleMouseDown}
          className="hidden lg:flex items-center justify-center w-1.5 hover:w-2 bg-transparent hover:bg-indigo-500/40 transition-all cursor-col-resize group rounded select-none shrink-0"
          title="Drag to resize panels"
        >
          <GripVertical className="w-3 h-3 text-slate-600 group-hover:text-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>

        {/* RIGHT PANE: Event Inspector & Validation Table */}
        <div className="flex-1 bg-[#10131B] border border-[#1C2230] rounded-2xl flex flex-col overflow-hidden p-5 min-w-[340px]">
          {selectedEvent ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Event Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-[#1C2230]">
                <div>
                  <h2 className="text-[19px] font-bold text-white font-mono tracking-tight">{selectedEvent.event_name}</h2>
                  <div className="flex items-center gap-3 text-[12.5px] text-slate-400 mt-1 flex-wrap">
                    <span>Time: {formatTimeOnly(selectedEvent.event_time)}</span>
                    <span className="text-slate-600">•</span>
                    <span>ID: <strong className="text-slate-300 font-mono">{selectedEvent.distinct_id || 'n/a'}</strong></span>
                    {getStatusBadge(selectedEvent.validation_status)}
                    <span className="px-2.5 py-0.5 rounded-md text-[12px] font-mono bg-[#080B10] text-slate-300 border border-[#1C2230]">
                      Source: {selectedEvent.source || 'ADB_STREAM'}
                    </span>
                  </div>
                </div>

                {/* Actions: Generate Bug & Revalidate */}
                <div className="shrink-0 flex items-center gap-2">
                  <button
                    onClick={handleOpenBugModal}
                    title="Generate Redmine-ready bug statements from event attributes"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition-colors shadow-sm"
                  >
                    <Bug className="w-3.5 h-3.5 text-rose-400" />
                    <span>Generate Bug</span>
                  </button>

                  <button
                    onClick={() => handleRevalidateEvent(selectedEvent.id)}
                    title="Re-run validation engine against active specification"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12.5px] font-medium bg-[#080B10] hover:bg-[#161B26] text-slate-300 border border-[#1C2230] transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Revalidate</span>
                  </button>
                </div>
              </div>

              {/* Synthetic Event Warning Banner */}
              {selectedEvent.source === 'SYNTHETIC_INJECTION' && (
                <div className="mt-3 p-3 rounded-xl bg-amber-950/30 border border-amber-800/50 flex items-start gap-2.5 text-[12.5px] text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="font-semibold text-amber-300">Synthetic Event:</strong> This event was manually injected for simulation testing. It does not originate from physical device telemetry or Android Logcat.
                  </div>
                </div>
              )}

              {/* Summary Cards with Interactive Status Filtering */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mt-4">
                {/* 1. All Attributes Card */}
                <button
                  type="button"
                  onClick={() => setActiveAttrFilter('ALL')}
                  aria-label={`Show all ${allAttributes.length} attributes`}
                  aria-pressed={activeAttrFilter === 'ALL'}
                  className={`rounded-xl p-2.5 flex items-center gap-2.5 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${
                    activeAttrFilter === 'ALL'
                      ? 'bg-indigo-950/45 border-2 border-indigo-500/80 ring-1 ring-indigo-500/30 shadow-sm'
                      : 'bg-[#080B10] hover:bg-[#141824] border border-[#1C2230] hover:border-[#283244]'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0 transition-colors ${
                      activeAttrFilter === 'ALL'
                        ? 'bg-indigo-500/25 border border-indigo-500/40 text-indigo-300'
                        : 'bg-[#141824] border border-[#1C2230] text-slate-300'
                    }`}
                  >
                    {allAttributes.length}
                  </div>
                  <div className="text-[13px] min-w-0">
                    <strong className="text-[15.5px] font-bold text-white mr-1.5">{allAttributes.length}</strong>
                    <span className="text-slate-300 font-medium">All</span>
                  </div>
                </button>

                {/* 2. Matched Card */}
                <button
                  type="button"
                  onClick={() => setActiveAttrFilter(prev => prev === 'MATCHED' ? 'ALL' : 'MATCHED')}
                  aria-label={`Filter by Matched attributes (${metrics.matched})`}
                  aria-pressed={activeAttrFilter === 'MATCHED'}
                  className={`rounded-xl p-2.5 flex items-center gap-2.5 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                    activeAttrFilter === 'MATCHED'
                      ? 'bg-emerald-950/50 border-2 border-emerald-500/90 ring-1 ring-emerald-500/40 shadow-sm'
                      : 'bg-emerald-950/20 hover:bg-emerald-950/35 border border-emerald-800/40 hover:border-emerald-700/60'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0 transition-colors ${
                      activeAttrFilter === 'MATCHED'
                        ? 'bg-emerald-500/30 border border-emerald-400/60 text-emerald-300'
                        : 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400'
                    }`}
                  >
                    {metrics.matched}
                  </div>
                  <div className="text-[13px] min-w-0">
                    <strong className="text-[15.5px] font-bold text-white mr-1.5">{metrics.matched}</strong>
                    <span className="text-slate-300 font-medium">Matched</span>
                  </div>
                </button>

                {/* 3. Missing Card */}
                <button
                  type="button"
                  onClick={() => setActiveAttrFilter(prev => prev === 'MISSING' ? 'ALL' : 'MISSING')}
                  aria-label={`Filter by Missing attributes (${metrics.missing})`}
                  aria-pressed={activeAttrFilter === 'MISSING'}
                  className={`rounded-xl p-2.5 flex items-center gap-2.5 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${
                    activeAttrFilter === 'MISSING'
                      ? 'bg-rose-950/50 border-2 border-rose-500/90 ring-1 ring-rose-500/40 shadow-sm'
                      : 'bg-rose-950/20 hover:bg-rose-950/35 border border-rose-800/40 hover:border-rose-700/60'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0 transition-colors ${
                      activeAttrFilter === 'MISSING'
                        ? 'bg-rose-500/30 border border-rose-400/60 text-rose-300'
                        : 'bg-rose-500/20 border border-rose-500/30 text-rose-400'
                    }`}
                  >
                    {metrics.missing}
                  </div>
                  <div className="text-[13px] min-w-0">
                    <strong className="text-[15.5px] font-bold text-white mr-1.5">{metrics.missing}</strong>
                    <span className="text-slate-300 font-medium">Missing</span>
                  </div>
                </button>

                {/* 4. Extra Card */}
                <button
                  type="button"
                  onClick={() => setActiveAttrFilter(prev => prev === 'EXTRA' ? 'ALL' : 'EXTRA')}
                  aria-label={`Filter by Extra attributes (${metrics.extra})`}
                  aria-pressed={activeAttrFilter === 'EXTRA'}
                  className={`rounded-xl p-2.5 flex items-center gap-2.5 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                    activeAttrFilter === 'EXTRA'
                      ? 'bg-amber-950/50 border-2 border-amber-500/90 ring-1 ring-amber-500/40 shadow-sm'
                      : 'bg-amber-950/20 hover:bg-amber-950/35 border border-amber-800/40 hover:border-amber-700/60'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0 transition-colors ${
                      activeAttrFilter === 'EXTRA'
                        ? 'bg-amber-500/30 border border-amber-400/60 text-amber-300'
                        : 'bg-amber-500/20 border border-amber-500/30 text-amber-400'
                    }`}
                  >
                    {metrics.extra}
                  </div>
                  <div className="text-[13px] min-w-0">
                    <strong className="text-[15.5px] font-bold text-white mr-1.5">{metrics.extra}</strong>
                    <span className="text-slate-300 font-medium">Extra</span>
                  </div>
                </button>

                {/* 5. Incorrect Card */}
                <button
                  type="button"
                  onClick={() => setActiveAttrFilter(prev => prev === 'INCORRECT' ? 'ALL' : 'INCORRECT')}
                  aria-label={`Filter by Incorrect attributes (${metrics.incorrect})`}
                  aria-pressed={activeAttrFilter === 'INCORRECT'}
                  className={`rounded-xl p-2.5 flex items-center gap-2.5 transition-all cursor-pointer text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 ${
                    activeAttrFilter === 'INCORRECT'
                      ? 'bg-rose-950/45 border-2 border-rose-500/80 ring-1 ring-rose-500/35 shadow-sm'
                      : 'bg-[#080B10] hover:bg-[#141824] border border-[#1C2230] hover:border-[#283244]'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-[13px] font-bold shrink-0 transition-colors ${
                      activeAttrFilter === 'INCORRECT'
                        ? 'bg-rose-900/40 border border-rose-600/50 text-rose-300'
                        : 'bg-[#141824] border border-[#1C2230] text-slate-300'
                    }`}
                  >
                    {metrics.incorrect}
                  </div>
                  <div className="text-[13px] min-w-0">
                    <strong className="text-[15.5px] font-bold text-white mr-1.5">{metrics.incorrect}</strong>
                    <span className="text-slate-300 font-medium">Incorrect</span>
                  </div>
                </button>
              </div>

              {/* Tabs: Attributes vs Raw JSON */}
              <div className="mt-4 pt-3 border-t border-[#1C2230] flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveTab('attributes')}
                    className={`px-3 py-1.5 rounded-lg text-[12.5px] flex items-center gap-1.5 transition-colors ${
                      activeTab === 'attributes'
                        ? 'bg-indigo-950/50 text-indigo-400 border border-indigo-500/30 font-semibold'
                        : 'text-slate-400 hover:text-slate-200 font-medium'
                    }`}
                  >
                    <Activity className="w-3.5 h-3.5" />
                    <span>Attributes ({activeAttrFilter === 'ALL' ? allAttributes.length : `${visibleAttributes.length} of ${allAttributes.length}`})</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('raw')}
                    className={`px-3 py-1.5 rounded-lg text-[12.5px] flex items-center gap-1.5 transition-colors ${
                      activeTab === 'raw'
                        ? 'bg-indigo-950/50 text-indigo-400 border border-indigo-500/30 font-semibold'
                        : 'text-slate-400 hover:text-slate-200 font-medium'
                    }`}
                  >
                    <span className="font-mono text-[12.5px]">{'{ }'}</span>
                    <span>Raw JSON</span>
                  </button>
                </div>

                {/* Active Filter Pill & Reset Action */}
                {activeTab === 'attributes' && activeAttrFilter !== 'ALL' && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-400">
                      Filtered by: <strong className="text-white capitalize">{getStatusTitle(activeAttrFilter)}</strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveAttrFilter('ALL')}
                      className="px-2.5 py-0.5 rounded-md text-xs font-medium text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 transition-colors cursor-pointer"
                      title="Show all attributes"
                    >
                      All Attributes
                    </button>
                  </div>
                )}
              </div>

              {/* Tab 1: Attributes Responsive Card Grid */}
              {activeTab === 'attributes' && (
                <div className="flex-1 overflow-y-auto mt-4 pr-1">
                  {visibleAttributes.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {visibleAttributes.map((attr, idx) => (
                        <div
                          key={idx}
                          className="bg-[#080B10] hover:bg-[#141824] border border-[#1C2230] hover:border-[#283244] rounded-xl p-3.5 flex flex-col justify-between transition-colors min-h-[76px]"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span
                              className="font-mono text-[13.5px] font-semibold text-white tracking-tight truncate flex-1"
                              title={attr.name}
                            >
                              {attr.name}
                            </span>
                            <div className="shrink-0">
                              {getStatusBadge(attr.status)}
                            </div>
                          </div>

                          <div
                            className="mt-2 text-[13px] font-mono break-all line-clamp-2"
                            title={getAttributeTooltip(attr)}
                          >
                            {renderAttributeValue(attr)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="p-8 text-center text-slate-400 text-[13px] bg-[#080B10] rounded-xl border border-[#1C2230] space-y-3">
                      <p className="font-medium text-slate-300">
                        {getEmptyStateMessage(activeAttrFilter)}
                      </p>
                      {activeAttrFilter !== 'ALL' && allAttributes.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setActiveAttrFilter('ALL')}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#10131B] hover:bg-[#161B26] text-indigo-400 hover:text-indigo-300 border border-indigo-500/30 transition-colors cursor-pointer"
                        >
                          <span>Show All Attributes ({allAttributes.length})</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Tab 2: Raw JSON Viewer */}
              {activeTab === 'raw' && (
                <div className="flex-1 flex flex-col bg-[#080B10] mt-3 p-4 rounded-xl border border-[#1C2230] overflow-hidden">
                  <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1C2230]">
                    <span className="text-[12.5px] text-slate-400 font-mono">Raw Event Payload</span>
                    <button
                      onClick={() => handleCopyJson(parsedPayload)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-[#10131B] hover:bg-[#161B26] text-slate-300 text-[12.5px] border border-[#1C2230] transition-colors"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copied' : 'Copy JSON'}</span>
                    </button>
                  </div>
                  <pre className="flex-1 overflow-auto text-[12.5px] font-mono text-indigo-300 bg-[#0A0D14] p-3 rounded-lg border border-[#1C2230] leading-relaxed">
                    {JSON.stringify(parsedPayload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-500">
              <Eye className="w-10 h-10 text-slate-600 mb-3" />
              <h3 className="text-[15px] font-semibold text-white">No Event Selected</h3>
              <p className="text-[12.5px] text-slate-500 mt-1 max-w-sm">
                Select an event from the stream list on the left to inspect parameter validation, actual payload, and specification compliance.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Manual Event Injection Modal */}
      {injectModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#10131B] border border-[#1C2230] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            <div className="px-5 py-4 border-b border-[#1C2230] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Plus className="w-4 h-4 text-purple-400" />
                <h3 className="text-sm font-bold text-white">Inject Synthetic Event</h3>
              </div>
              <button
                onClick={() => setInjectModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="p-5 space-y-3">
              <p className="text-xs text-slate-400">
                Provide a raw Mixpanel JSON event payload. It will be injected into session{' '}
                <strong className="text-slate-200 font-mono">{activeSession?.id?.substring(0, 8)}...</strong>, validated against the active specification, and tagged with source <code className="text-purple-300">SYNTHETIC_INJECTION</code>.
              </p>

              <textarea
                rows={9}
                value={injectPayloadText}
                onChange={(e) => setInjectPayloadText(e.target.value)}
                className="w-full bg-[#080B10] border border-[#1C2230] rounded-xl p-3 text-xs font-mono text-indigo-300 focus:outline-none focus:border-purple-500/70"
              />
            </div>

            <div className="px-5 py-3.5 bg-[#080B10] border-t border-[#1C2230] flex items-center justify-end gap-2">
              <button
                onClick={() => setInjectModalOpen(false)}
                className="px-3.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-[#161B26] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleInjectEvent}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-colors shadow-sm"
              >
                Inject & Validate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bug Writer Modal */}
      {bugModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#10131B] border border-[#1C2230] rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[88vh]">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-[#1C2230] flex items-center justify-between shrink-0 bg-[#080B10]">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                  <Bug className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-white tracking-wide">
                      {bugModalView === 'select' ? 'Mixpanel Bug Writer' : 'Edit Bug Description'}
                    </h3>
                    <span className="px-2 py-0.5 rounded text-[11px] font-mono font-medium bg-[#10131B] text-slate-300 border border-[#1C2230] truncate max-w-[240px]">
                      {selectedEvent?.event_name || 'Event'}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-slate-400 mt-0.5">
                    {bugModalView === 'select'
                      ? 'Select attributes to generate Redmine-ready bug statements'
                      : 'Review and customize the generated text before copying into Redmine'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleCloseBugModal}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-[#161B26] transition-colors"
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* VIEW 1: Attribute Selection */}
            {bugModalView === 'select' && (
              <>
                {/* Selection Toolbar */}
                <div className="px-5 py-2.5 bg-[#080B10] border-b border-[#1C2230] flex items-center justify-between text-xs shrink-0">
                  <div className="text-slate-300">
                    <span className="font-semibold text-white">{selectedAttrNames.size}</span>
                    <span className="text-slate-400"> of {allAttributes.length} attributes selected</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSelectAllAttrs}
                      className="px-2.5 py-1 rounded-lg bg-[#10131B] hover:bg-[#161B26] text-slate-300 hover:text-white border border-[#1C2230] transition-colors font-medium text-[11.5px]"
                    >
                      Select All
                    </button>
                    <button
                      onClick={handleClearAllAttrs}
                      className="px-2.5 py-1 rounded-lg bg-[#10131B] hover:bg-[#161B26] text-slate-400 hover:text-slate-200 border border-[#1C2230] transition-colors font-medium text-[11.5px]"
                    >
                      Clear Selection
                    </button>
                  </div>
                </div>

                {/* Attribute Groups List */}
                <div className="p-5 flex-1 overflow-y-auto space-y-4">
                  {allAttributes.length === 0 ? (
                    <div className="py-8 text-center text-slate-500 text-xs bg-[#080B10] rounded-xl border border-[#1C2230]">
                      No attributes available for this event.
                    </div>
                  ) : (
                    [
                      { key: 'MISSING', label: 'Missing', items: groupedAttributes.MISSING, badgeColor: 'text-rose-400 bg-rose-500/10 border-rose-500/25' },
                      { key: 'INCORRECT', label: 'Incorrect', items: groupedAttributes.INCORRECT, badgeColor: 'text-rose-300 bg-rose-900/30 border-rose-700/40' },
                      { key: 'EXTRA', label: 'Extra', items: groupedAttributes.EXTRA, badgeColor: 'text-amber-400 bg-amber-500/10 border-amber-500/25' },
                      { key: 'MATCHED', label: 'Matched', items: groupedAttributes.MATCHED, badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25' }
                    ].map(group => {
                      if (!group.items || group.items.length === 0) return null;
                      return (
                        <div key={group.key} className="space-y-2">
                          {/* Group Section Header */}
                          <div className="flex items-center justify-between pb-1 border-b border-[#1C2230]">
                            <span className="text-[12.5px] font-semibold text-slate-300 flex items-center gap-2">
                              <span>{group.label}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-mono border ${group.badgeColor}`}>
                                {group.items.length}
                              </span>
                            </span>
                          </div>

                          {/* Attribute Rows */}
                          <div className="space-y-1.5">
                            {group.items.map((attr, idx) => {
                              const isChecked = selectedAttrNames.has(attr.name);
                              const { actual, expected } = getAttributeDisplayValues(attr);

                              return (
                                <div
                                  key={`${attr.name}-${idx}`}
                                  onClick={() => handleToggleAttr(attr.name)}
                                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                                    isChecked
                                      ? 'bg-indigo-950/35 border-indigo-500/40 shadow-sm'
                                      : 'bg-[#080B10] hover:bg-[#141824] border-[#1C2230]'
                                  }`}
                                >
                                  {/* Left: Checkbox & Name */}
                                  <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => {}} // handled by row onClick
                                      className="w-4 h-4 rounded text-indigo-600 bg-[#121826] border-slate-700 focus:ring-0 focus:ring-offset-0 cursor-pointer shrink-0"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2">
                                        <span className="font-mono text-[13px] font-semibold text-white tracking-tight truncate">
                                          {attr.name}
                                        </span>
                                      </div>
                                      {/* Key Value Details */}
                                      <div className="text-[11.5px] font-mono text-slate-400 mt-0.5 truncate">
                                        {group.key === 'MISSING' && (
                                          <span className="text-slate-400 italic">
                                            Missing from actual payload {expected !== undefined ? `(Expected: ${formatValueForBug(expected)})` : ''}
                                          </span>
                                        )}
                                        {group.key === 'EXTRA' && (
                                          <span>Actual: <strong className="text-amber-300">{formatValueForBug(actual)}</strong></span>
                                        )}
                                        {group.key === 'INCORRECT' && (
                                          <span>
                                            Expected: <strong className="text-emerald-400">{formatValueForBug(expected)}</strong> • Actual: <strong className="text-rose-400">{formatValueForBug(actual)}</strong>
                                          </span>
                                        )}
                                        {group.key === 'MATCHED' && (
                                          <span>Value: <strong className="text-slate-300">{formatValueForBug(actual)}</strong></span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  {/* Right: Validation Badge */}
                                  <div className="shrink-0">
                                    {getStatusBadge(attr.status)}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Selection Footer */}
                <div className="px-5 py-3.5 bg-[#080B10] border-t border-[#1C2230] flex items-center justify-between shrink-0">
                  <div className="text-xs text-slate-400">
                    {selectedAttrNames.size === 0 ? (
                      <span>Select at least 1 attribute</span>
                    ) : (
                      <span>Ready to generate statements for <strong className="text-white">{selectedAttrNames.size}</strong> attribute{selectedAttrNames.size > 1 ? 's' : ''}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCloseBugModal}
                      className="px-3.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-[#161B26] transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleGenerateBug}
                      disabled={selectedAttrNames.size === 0}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Bug className="w-3.5 h-3.5" />
                      <span>Generate Bug ({selectedAttrNames.size})</span>
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* VIEW 2: Edit Bug Description */}
            {bugModalView === 'edit' && (
              <>
                <div className="p-5 flex-1 flex flex-col overflow-hidden space-y-3">
                  <div className="flex items-center justify-between text-xs text-slate-400">
                    <span className="font-medium text-slate-300">Edit Bug Description (Redmine-ready)</span>
                    <span className="text-[11px] text-slate-500">Edit freely — text is not overwritten without confirmation</span>
                  </div>

                  <textarea
                    rows={12}
                    value={editableBugText}
                    onChange={(e) => setEditableBugText(e.target.value)}
                    placeholder="No statements generated. Return to selection and select attributes."
                    className="flex-1 w-full bg-[#080B10] border border-[#1C2230] rounded-xl p-4 text-[13px] font-mono text-slate-200 focus:outline-none focus:border-rose-500/70 resize-none leading-relaxed selection:bg-rose-900/50"
                  />
                </div>

                {/* Edit Footer */}
                <div className="px-5 py-3.5 bg-[#080B10] border-t border-[#1C2230] flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleBackToSelection}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#10131B] hover:bg-[#161B26] text-slate-300 border border-[#1C2230] transition-colors"
                    >
                      <ArrowLeft className="w-3.5 h-3.5 text-slate-400" />
                      <span>Back to Selection</span>
                    </button>
                    <button
                      onClick={handleRegenerateFromEdit}
                      title="Regenerate statements from selected attributes"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[#10131B] hover:bg-[#161B26] text-slate-300 border border-[#1C2230] transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Regenerate</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCloseBugModal}
                      className="px-3.5 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white hover:bg-[#161B26] transition-colors"
                    >
                      Close
                    </button>
                    <button
                      onClick={handleCopyBugText}
                      disabled={!editableBugText.trim()}
                      className={`inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all shadow-sm ${
                        bugCopied
                          ? 'bg-emerald-600 text-white'
                          : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed'
                      }`}
                    >
                      {bugCopied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{bugCopied ? 'Copied to Clipboard!' : 'Copy All'}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal for Overwriting Manual Edits */}
      {confirmRegenOpen && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#10131B] border border-[#1C2230] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white">Discard Custom Edits?</h4>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  You have modified the generated bug description. Regenerating will discard your custom changes and replace the text with newly generated statements.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1C2230]">
              <button
                onClick={handleCancelRegenerate}
                className="px-3.5 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white bg-[#080B10] hover:bg-[#161B26] border border-[#1C2230] transition-colors"
              >
                Keep My Edits
              </button>
              <button
                onClick={handleConfirmRegenerate}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors shadow-sm"
              >
                Discard & Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Clearing Recorded Events */}
      {clearConfirmOpen && (
        <div className="fixed inset-0 z-60 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="w-full max-w-md bg-[#10131B] border border-[#1C2230] rounded-2xl shadow-2xl p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Clear All Recorded Events?</h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  All <strong className="text-white">{events.length}</strong> recorded event{events.length === 1 ? '' : 's'} in the current capture session will be permanently removed.
                  {activeSession?.status === 'ACTIVE' && (
                    <span className="block mt-1 text-slate-400">
                      Active ADB capture will continue running, and newly arriving events will appear normally.
                    </span>
                  )}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2 border-t border-[#1C2230]">
              <button
                type="button"
                onClick={() => setClearConfirmOpen(false)}
                disabled={isClearingEvents}
                className="px-3.5 py-1.5 rounded-lg bg-[#080B10] hover:bg-[#161B26] text-xs font-medium text-slate-300 border border-[#1C2230] transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmClearEvents}
                disabled={isClearingEvents}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-xs font-semibold text-white shadow transition-colors cursor-pointer disabled:opacity-50"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{isClearingEvents ? 'Clearing...' : 'Clear Events'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helpers
function getStatusBadge(status) {
  switch (status) {
    case 'MATCHED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
          <CheckCircle2 className="w-3 h-3" /> MATCHED
        </span>
      );
    case 'MISSING':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/25">
          <XCircle className="w-3 h-3" /> MISSING
        </span>
      );
    case 'EXTRA':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/25">
          <AlertTriangle className="w-3 h-3" /> EXTRA
        </span>
      );
    case 'INCORRECT':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-900/30 text-rose-300 border border-rose-700/40">
          <AlertCircle className="w-3 h-3" /> INCORRECT
        </span>
      );
    case 'UNMAPPED':
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-slate-800 text-slate-400 border border-slate-700">
          <HelpCircle className="w-3 h-3" /> UNMAPPED
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-[11px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
          {status || 'PENDING'}
        </span>
      );
  }
}

function formatTimeOnly(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return String(isoStr);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function formatDateTime(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function renderAttributeValue(attr) {
  if (attr.actualValue === undefined) {
    return <span className="text-slate-500 italic">Not provided</span>;
  }
  if (attr.actualValue === null) {
    return <span className="text-slate-400 italic font-mono">null</span>;
  }
  if (typeof attr.actualValue === 'boolean') {
    return <span className="text-indigo-300 font-mono">{String(attr.actualValue)}</span>;
  }
  if (typeof attr.actualValue === 'object') {
    return <span className="text-slate-300 font-mono">{JSON.stringify(attr.actualValue)}</span>;
  }
  return <span className="text-slate-300 font-mono">{String(attr.actualValue)}</span>;
}

function getAttributeTooltip(attr) {
  if (attr.actualValue === undefined) return 'Not provided';
  if (attr.actualValue === null) return 'null';
  if (typeof attr.actualValue === 'object') return JSON.stringify(attr.actualValue);
  return String(attr.actualValue);
}
