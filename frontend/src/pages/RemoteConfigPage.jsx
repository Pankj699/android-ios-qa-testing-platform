import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  Sliders,
  Search,
  Plus,
  RefreshCw,
  Edit2,
  Trash2,
  Copy,
  Check,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Maximize2,
  Code,
  Code2,
  Smartphone,
  Apple,
  FileJson,
  Hash,
  ToggleLeft,
  X,
  ExternalLink,
  Wrench,
  Crosshair,
  AlertCircle,
  Sparkles
} from 'lucide-react';
import { api } from '../services/api';
import CustomSelect from '../components/ui/select';
import { toast } from '../utils/toast';
import { JsonSyntaxViewer, tokenizeJsonLine } from '../components/LiveLogViewer';
import { isGenerateShortcut, isMacPlatform } from '../utils/shortcutUtils';
import { analyzeJsonSyntax, repairJson } from '../utils/jsonAutoRepair';

/**
 * Compact syntax-highlighted preview of configuration values matching HTTP Inspector
 */
function ConfigValuePreview({ type, value }) {
  if (type === 'boolean') {
    const isTrue = value === '1' || value === 1 || value === true || value === 'true';
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-mono font-bold ${
        isTrue
          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20'
          : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20'
      }`}>
        {isTrue ? '1 (TRUE)' : '0 (FALSE)'}
      </span>
    );
  }

  if (type === 'number') {
    return (
      <span className="inline-flex items-center font-mono text-[12px] font-semibold text-[#FFB86C] bg-amber-500/10 dark:bg-[#FFB86C]/10 px-2 py-0.5 rounded border border-amber-500/20">
        {value}
      </span>
    );
  }

  // JSON preview with syntax tokens
  const previewSnippet = useMemo(() => {
    if (!value) return '';
    try {
      const parsed = JSON.parse(value);
      const minified = JSON.stringify(parsed);
      return minified.length > 70 ? minified.slice(0, 70) + '...' : minified;
    } catch (e) {
      return value.length > 70 ? value.slice(0, 70) + '...' : value;
    }
  }, [value]);

  const tokens = useMemo(() => {
    try {
      return tokenizeJsonLine(previewSnippet);
    } catch (e) {
      return [{ type: 'text', text: previewSnippet }];
    }
  }, [previewSnippet]);

  return (
    <div
      className="font-mono text-[11.5px] leading-tight truncate px-2.5 py-1.5 rounded-lg bg-[#07090E] border border-[#171E2E] dark:border-[#1E2638] text-slate-300 max-w-full"
      title={value}
    >
      {tokens.map((token, idx) => {
        let colorClass = 'text-[#C9D1D9]';
        if (token.type === 'key') colorClass = 'text-[#79C0FF] font-medium';
        else if (token.type === 'string') colorClass = 'text-[#A5D6A7]';
        else if (token.type === 'number') colorClass = 'text-[#FFB86C]';
        else if (token.type === 'boolean') colorClass = 'text-[#C792EA] font-semibold';
        else if (token.type === 'null') colorClass = 'text-[#F07178] italic font-semibold';
        else if (token.type === 'punctuation') colorClass = 'text-[#C9D1D9]';
        else if (token.type === 'text') colorClass = 'text-slate-400';

        return (
          <span key={idx} className={colorClass}>
            {token.text}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Fully Highlighted, Synchronized Editable JSON Editor
 * Layered architecture: Transparent textarea overlaid directly on top of a
 * synchronized syntax-highlighted <pre> rendering layer and line numbers gutter.
 */
const SynchronizedJsonEditor = React.forwardRef(function SynchronizedJsonEditor({
  value,
  onChange,
  onKeyDown,
  heightClass = 'h-[60vh] min-h-[380px] max-h-[68vh]',
  placeholder = '{\n  \n}'
}, ref) {
  const textareaRef = React.useRef(null);
  const preRef = React.useRef(null);
  const gutterRef = React.useRef(null);

  // Imperative handle for cursor navigation and focusing
  React.useImperativeHandle(ref, () => ({
    focus: () => {
      if (textareaRef.current) textareaRef.current.focus();
    },
    setCursor: (pos) => {
      if (!textareaRef.current) return;
      const textarea = textareaRef.current;
      const safePos = typeof pos === 'number' ? Math.max(0, Math.min(pos, textarea.value.length)) : 0;
      textarea.focus();
      textarea.setSelectionRange(safePos, safePos);
    },
    scrollToLine: (lineNumber) => {
      if (!textareaRef.current) return;
      const lineH = 22; // 22px line height matching sharedTypography
      const targetScroll = Math.max(0, (lineNumber - 1) * lineH - 44);
      textareaRef.current.scrollTop = targetScroll;
      if (preRef.current) preRef.current.scrollTop = targetScroll;
      if (gutterRef.current) gutterRef.current.scrollTop = targetScroll;
    },
    navigateToError: (errorInfo) => {
      if (!textareaRef.current || !errorInfo) return;
      const textarea = textareaRef.current;
      const text = textarea.value || '';

      // Determine accurate character position
      let targetPos = errorInfo.position;
      if (typeof targetPos !== 'number' || isNaN(targetPos) || targetPos < 0 || targetPos > text.length) {
        if (typeof errorInfo.line === 'number' && errorInfo.line > 0) {
          const lines = text.split('\n');
          let offset = 0;
          for (let i = 0; i < Math.min(errorInfo.line - 1, lines.length); i++) {
            offset += lines[i].length + 1; // +1 for '\n'
          }
          if (typeof errorInfo.column === 'number' && errorInfo.column > 0) {
            offset += Math.min(errorInfo.column - 1, lines[errorInfo.line - 1] ? lines[errorInfo.line - 1].length : 0);
          }
          targetPos = offset;
        } else {
          targetPos = 0;
        }
      }
      targetPos = Math.max(0, Math.min(targetPos, text.length));

      // Calculate line and column from targetPos if not explicitly provided
      let targetLine = errorInfo.line;
      let targetCol = errorInfo.column;
      if (typeof targetLine !== 'number' || typeof targetCol !== 'number') {
        const upTo = text.slice(0, targetPos);
        const splitLines = upTo.split('\n');
        targetLine = splitLines.length;
        targetCol = splitLines[splitLines.length - 1].length + 1;
      }

      // Vertical scroll: center target line in viewport
      const lineH = 22;
      const viewH = textarea.clientHeight || 350;
      const lineTop = (targetLine - 1) * lineH;
      const targetScrollTop = Math.max(0, lineTop - Math.floor(viewH / 2) + Math.floor(lineH / 2));

      // Horizontal scroll: scroll error into view if line is long
      const charW = 8.4;
      const viewW = textarea.clientWidth || 600;
      const colLeft = (targetCol - 1) * charW;
      const targetScrollLeft = Math.max(0, colLeft - Math.floor(viewW / 2) + 20);

      // Focus and position caret
      textarea.focus();
      textarea.setSelectionRange(targetPos, targetPos);

      // Synchronize scroll positions
      textarea.scrollTop = targetScrollTop;
      textarea.scrollLeft = targetScrollLeft;
      if (preRef.current) {
        preRef.current.scrollTop = targetScrollTop;
        preRef.current.scrollLeft = targetScrollLeft;
      }
      if (gutterRef.current) {
        gutterRef.current.scrollTop = targetScrollTop;
      }
    },
    getTextarea: () => textareaRef.current
  }), []);

  // Synchronize vertical and horizontal scroll positions
  const handleScroll = (e) => {
    const { scrollTop, scrollLeft } = e.currentTarget;
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop;
      preRef.current.scrollLeft = scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
  };

  // Lines split for gutter and highlighting
  const lines = React.useMemo(() => {
    return (value || '').split('\n');
  }, [value]);

  const lineCount = lines.length || 1;

  // Exact matching styles for 1:1 pixel parity between textarea and pre layer
  const sharedTypography = {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: '14px',
    lineHeight: '22px',
    letterSpacing: '0px',
    tabSize: 2,
    whiteSpace: 'pre',
    wordWrap: 'normal',
    overflowWrap: 'normal'
  };

  const getTokenColor = (type) => {
    switch (type) {
      case 'key': return '#79C0FF';
      case 'string': return '#A5D6A7';
      case 'number': return '#FFB86C';
      case 'boolean': return '#C792EA';
      case 'null': return '#F07178';
      case 'punctuation': return '#E6EDF3';
      default: return '#CBD5E1';
    }
  };

  return (
    <div className={`relative flex bg-[#07090E] border border-[#171E2E] dark:border-[#1E2638] rounded-xl overflow-hidden focus-within:border-[#7c6cf6] focus-within:ring-1 focus-within:ring-[#7c6cf6]/50 shadow-inner ${heightClass}`}>
      {/* Line Numbers Gutter */}
      <div
        ref={gutterRef}
        aria-hidden="true"
        className="w-12 shrink-0 bg-[#06080C] border-r border-[#171E2E] dark:border-[#1E2638] select-none overflow-hidden text-right pr-3 pt-3.5 pb-3.5 font-mono text-[13px] text-slate-600"
        style={{
          fontFamily: sharedTypography.fontFamily,
          lineHeight: sharedTypography.lineHeight
        }}
      >
        {Array.from({ length: lineCount }).map((_, idx) => (
          <div key={idx} style={{ height: sharedTypography.lineHeight }}>
            {idx + 1}
          </div>
        ))}
      </div>

      {/* Editor Content Area (Pre layer + Textarea layer) */}
      <div className="relative flex-1 min-w-0 h-full overflow-hidden">
        {/* 1. Syntax Highlighted Layer (Rendered below textarea) */}
        <pre
          ref={preRef}
          aria-hidden="true"
          className="absolute inset-0 m-0 p-3.5 select-none pointer-events-none overflow-hidden bg-transparent"
          style={{
            ...sharedTypography,
            boxSizing: 'border-box'
          }}
        >
          {lines.map((line, lIdx) => {
            const tokens = tokenizeJsonLine(line);
            return (
              <div key={lIdx} style={{ height: sharedTypography.lineHeight }}>
                {line.length === 0 ? (
                  '\u00A0'
                ) : (
                  tokens.map((token, tIdx) => (
                    <span
                      key={tIdx}
                      style={{
                        color: getTokenColor(token.type),
                        fontWeight: token.type === 'key' ? 500 : token.type === 'boolean' || token.type === 'null' ? 600 : 400
                      }}
                    >
                      {token.text}
                    </span>
                  ))
                )}
              </div>
            );
          })}
        </pre>

        {/* 2. Interactive Editable Layer (Transparent text, visible glowing caret & selection) */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onScroll={handleScroll}
          placeholder={placeholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="absolute inset-0 w-full h-full m-0 p-3.5 resize-none bg-transparent text-transparent caret-[#79C0FF] selection:bg-violet-600/35 overflow-auto border-0 outline-none ring-0 shadow-none focus:outline-none focus:ring-0 focus:border-0 focus:shadow-none !border-0 !outline-none !ring-0 !shadow-none focus:!border-0 focus:!outline-none focus:!ring-0 focus:!shadow-none"
          style={{
            ...sharedTypography,
            boxSizing: 'border-box',
            outline: 'none',
            border: 'none',
            boxShadow: 'none'
          }}
        />
      </div>
    </div>
  );
});

const SESSION_MUTATIONS_KEY = 'rc_session_mutations';

const getCompoundKey = (plt, app, key) => {
  return `${(plt || '').toLowerCase().trim()}:${(app || '').toLowerCase().trim()}:${(key || '').toLowerCase().trim()}`;
};

const loadSessionMutations = () => {
  try {
    const raw = sessionStorage.getItem(SESSION_MUTATIONS_KEY);
    if (!raw) return { sequence: 0, items: {} };
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.sequence === 'number' && parsed.items && typeof parsed.items === 'object') {
      return parsed;
    }
    return { sequence: 0, items: {} };
  } catch (err) {
    console.warn('Failed to parse rc_session_mutations from sessionStorage:', err);
    return { sequence: 0, items: {} };
  }
};

const saveSessionMutations = (data) => {
  try {
    sessionStorage.setItem(SESSION_MUTATIONS_KEY, JSON.stringify(data));
  } catch (err) {
    console.warn('Failed to save rc_session_mutations to sessionStorage:', err);
  }
};

const copyToClipboard = async (text) => {
  if (navigator?.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const successful = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!successful) throw new Error('Failed to copy to clipboard.');
};

const findConfigInList = (list, target) => {
  if (!target || !Array.isArray(list)) return null;
  if (target.id) {
    const byId = list.find(c => c.id === target.id);
    if (byId) return byId;
  }
  const normKey = (target.key || '').trim().toLowerCase();
  const normApp = (target.app || '').trim().toLowerCase();
  const normPlt = (target.platform || '').trim().toLowerCase();
  return list.find(c => {
    const cKey = (c.key || '').trim().toLowerCase();
    const cApp = (c.app || '').trim().toLowerCase();
    const cPlt = (c.platform || '').trim().toLowerCase();
    return cKey === normKey && (!normApp || !cApp || cApp === normApp) && (!normPlt || !cPlt || cPlt === normPlt);
  }) || list.find(c => (c.key || '').trim().toLowerCase() === normKey) || null;
};

export default function RemoteConfigPage({ currentUser, platform: propPlatform, onPlatformChange }) {
  // Navigation & Platform State (synced with Header via App.jsx)
  const [internalPlatform, setInternalPlatform] = useState('android');
  const platform = propPlatform !== undefined ? propPlatform : internalPlatform;

  const handlePlatformChange = useCallback((newPlatform) => {
    setInternalPlatform(newPlatform);
    if (onPlatformChange) {
      onPlatformChange(newPlatform);
    }
  }, [onPlatformChange]);

  const [applications, setApplications] = useState([]);
  const [selectedApp, setSelectedApp] = useState('');
  const [loadingApps, setLoadingApps] = useState(false);

  // Configuration Table State
  const [configs, setConfigs] = useState([]);
  const [loadingConfigs, setLoadingConfigs] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sortBy, setSortBy] = useState('recent'); // 'recent', 'server', 'key-asc', 'key-desc', 'type', 'status'
  const [timestampLimitation, setTimestampLimitation] = useState('');
  const [mutationTracker, setMutationTracker] = useState(() => loadSessionMutations());
  const fetchIdRef = useRef(0);

  // Modals State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalConfig, setEditModalConfig] = useState(null);
  const [viewValueConfig, setViewValueConfig] = useState(null);
  const [deleteConfirmConfig, setDeleteConfirmConfig] = useState(null);

  // Form State
  const [formKey, setFormKey] = useState('');
  const [formType, setFormType] = useState('json');
  const [formValue, setFormValue] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [formError, setFormError] = useState('');
  const [editorViewMode, setEditorViewMode] = useState('editor'); // 'editor' | 'preview'
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const isMac = useMemo(() => isMacPlatform(), []);
  const submitShortcutLabel = isMac ? '⌘ + Enter' : 'Ctrl + Enter';
  const [copiedKey, setCopiedKey] = useState(null);
  const [copiedModalValue, setCopiedModalValue] = useState(false);
  const [togglingId, setTogglingId] = useState(null);
  const [fetchingActionId, setFetchingActionId] = useState(null); // 'view-key' | 'edit-key' | 'copy-key'
  const [conflictState, setConflictState] = useState(null);
  const baselineConfigRef = useRef(null);
  const actionFetchIdRef = useRef(0);
  const editorRef = useRef(null);
  const [repairFeedback, setRepairFeedback] = useState(null); // { success: boolean, message: string, repairs?: string[], reasonCode?: string, line?: number, column?: number }

  // Mutation tracking callbacks
  const recordMutation = useCallback((plt, app, newKey, oldKey = null) => {
    setMutationTracker((prev) => {
      const nextSeq = (prev.sequence || 0) + 1;
      const nextItems = { ...(prev.items || {}) };

      // If key was renamed, remove the old key identity
      if (oldKey && oldKey.trim().toLowerCase() !== newKey.trim().toLowerCase()) {
        const oldCompound = getCompoundKey(plt, app, oldKey);
        delete nextItems[oldCompound];
      }

      const newCompound = getCompoundKey(plt, app, newKey);
      nextItems[newCompound] = {
        sequence: nextSeq,
        timestamp: Date.now(),
        platform: (plt || '').toLowerCase().trim(),
        app: (app || '').toLowerCase().trim(),
        key: newKey.trim()
      };

      const nextState = { sequence: nextSeq, items: nextItems };
      saveSessionMutations(nextState);
      return nextState;
    });
  }, []);

  const removeMutation = useCallback((plt, app, key) => {
    setMutationTracker((prev) => {
      const compound = getCompoundKey(plt, app, key);
      if (!prev.items || !prev.items[compound]) return prev;
      const nextItems = { ...prev.items };
      delete nextItems[compound];
      const nextState = { sequence: prev.sequence, items: nextItems };
      saveSessionMutations(nextState);
      return nextState;
    });
  }, []);

  // Load applications whenever platform changes
  const loadApplications = useCallback(async (targetPlatform) => {
    setLoadingApps(true);
    try {
      const res = await api.getRemoteConfigApplications(targetPlatform);
      const apps = res.applications || [];
      setApplications(apps);

      // Select default app: keep current if valid, else pick 'designwiz' or first app
      if (apps.length > 0) {
        const found = apps.find(a => a.slug.toLowerCase() === selectedApp.toLowerCase());
        if (found) {
          setSelectedApp(found.slug);
        } else {
          const preferred = apps.find(a => a.slug.toLowerCase().includes('designwiz')) || apps[0];
          setSelectedApp(preferred.slug);
        }
      } else {
        setSelectedApp('');
      }
    } catch (err) {
      console.error('Failed to load applications:', err);
      toast.error(`Failed to load applications for ${targetPlatform.toUpperCase()}: ${err.message}`);
    } finally {
      setLoadingApps(false);
    }
  }, [selectedApp]);

  useEffect(() => {
    loadApplications(platform);
  }, [platform]);

  // Load configs whenever selectedApp or platform changes (with stale-fetch protection)
  const loadConfigs = useCallback(async () => {
    if (!selectedApp) {
      setConfigs([]);
      return;
    }
    const currentFetchId = ++fetchIdRef.current;
    setLoadingConfigs(true);
    try {
      const res = await api.getRemoteConfigs(platform, selectedApp);
      // Ignore response if a newer fetch request has already been initiated
      if (currentFetchId !== fetchIdRef.current) return;

      setConfigs(res.configs || []);
      setTimestampLimitation(res.timestampLimitation || '');
    } catch (err) {
      if (currentFetchId !== fetchIdRef.current) return;
      console.error('Failed to load configs:', err);
      toast.error(`Failed to load Remote Configs for ${selectedApp}: ${err.message}`);
    } finally {
      if (currentFetchId === fetchIdRef.current) {
        setLoadingConfigs(false);
      }
    }
  }, [platform, selectedApp]);

  useEffect(() => {
    loadConfigs();
  }, [loadConfigs]);

  // Lock background scroll when any modal is open
  useEffect(() => {
    const hasOpenModal = Boolean(createModalOpen || editModalConfig || viewValueConfig || deleteConfirmConfig);
    if (hasOpenModal) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [createModalOpen, editModalConfig, viewValueConfig, deleteConfirmConfig]);

  // Handle Escape key to close open modals
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (createModalOpen || editModalConfig) {
          setCreateModalOpen(false);
          setEditModalConfig(null);
        } else if (viewValueConfig) {
          setViewValueConfig(null);
        } else if (deleteConfirmConfig) {
          setDeleteConfirmConfig(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [createModalOpen, editModalConfig, viewValueConfig, deleteConfirmConfig]);

  // Filter and Sort Configurations
  const filteredConfigs = useMemo(() => {
    let result = [...configs];

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(c =>
        (c.key && c.key.toLowerCase().includes(q)) ||
        (c.value && c.value.toLowerCase().includes(q)) ||
        (c.app && c.app.toLowerCase().includes(q))
      );
    }

    if (typeFilter) {
      result = result.filter(c => c.type === typeFilter.toLowerCase());
    }

    if (statusFilter === 'active') {
      result = result.filter(c => c.active === true);
    } else if (statusFilter === 'inactive') {
      result = result.filter(c => c.active === false);
    }

    if (sortBy === 'recent') {
      result.sort((a, b) => {
        const aCompound = getCompoundKey(platform, selectedApp, a.key);
        const bCompound = getCompoundKey(platform, selectedApp, b.key);
        const aSeq = mutationTracker.items?.[aCompound]?.sequence || 0;
        const bSeq = mutationTracker.items?.[bCompound]?.sequence || 0;

        if (aSeq > 0 || bSeq > 0) {
          if (aSeq > 0 && bSeq > 0) {
            return bSeq - aSeq; // Monotonically increasing sequence: higher sequence = newer mutation = first
          }
          return aSeq > 0 ? -1 : 1; // Mutated item comes before unmutated item
        }

        // Unmodified records below session-mutated records, preserving original server order
        return (a.srNo || 0) - (b.srNo || 0);
      });
    } else if (sortBy === 'server') {
      // 'server' order by original srNo
      result.sort((a, b) => (a.srNo || 0) - (b.srNo || 0));
    } else if (sortBy === 'key-asc') {
      result.sort((a, b) => a.key.localeCompare(b.key));
    } else if (sortBy === 'key-desc') {
      result.sort((a, b) => b.key.localeCompare(a.key));
    } else if (sortBy === 'type') {
      result.sort((a, b) => a.type.localeCompare(b.type));
    } else if (sortBy === 'status') {
      result.sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
    }

    return result;
  }, [configs, searchQuery, typeFilter, statusFilter, sortBy, platform, selectedApp, mutationTracker]);

  // Summary counts
  const summary = useMemo(() => {
    const total = configs.length;
    const active = configs.filter(c => c.active).length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [configs]);

  // Open Create Modal
  const openCreateModal = () => {
    setFormKey('');
    setFormType('json');
    setFormValue('{\n  \n}');
    setFormActive(true);
    setFormError('');
    setConflictState(null);
    setRepairFeedback(null);
    setEditorViewMode('editor');
    setCreateModalOpen(true);
  };

  // View Action: Always fetch the latest value from upstream before opening the inspector
  const handleViewConfig = async (cfg) => {
    if (!cfg) return;
    const actionKey = `view-${cfg.id || cfg.key}`;
    setFetchingActionId(actionKey);
    const fetchId = ++actionFetchIdRef.current;

    try {
      const res = await api.getRemoteConfigs(platform, selectedApp, {
        id: cfg.id,
        key: cfg.key
      });
      if (fetchId !== actionFetchIdRef.current) return;

      const freshList = res.configs || [];
      const freshRecord = findConfigInList(freshList, cfg);

      if (!freshRecord) {
        setConfigs(prev => prev.filter(c => (c.id && cfg.id ? c.id !== cfg.id : c.key !== cfg.key)));
        toast.error(`Configuration '${cfg.key}' was deleted upstream or no longer exists.`);
        return;
      }

      // Synchronize table with fresh records (without altering mutation sequence)
      setConfigs(freshList);

      // Open View dialog with fresh record
      setViewValueConfig(freshRecord);
    } catch (err) {
      if (fetchId !== actionFetchIdRef.current) return;
      console.error('Failed to fetch latest configuration for view:', err);
      toast.error(`Failed to fetch latest value for '${cfg.key}': ${err.message}`);
    } finally {
      if (fetchId === actionFetchIdRef.current) {
        setFetchingActionId(null);
      }
    }
  };

  // Edit Action: Always fetch the latest data from upstream before opening the editor
  const handleEditConfig = async (cfg) => {
    if (!cfg) return;
    const actionKey = `edit-${cfg.id || cfg.key}`;
    setFetchingActionId(actionKey);
    const fetchId = ++actionFetchIdRef.current;

    try {
      const res = await api.getRemoteConfigs(platform, selectedApp, {
        id: cfg.id,
        key: cfg.key
      });
      if (fetchId !== actionFetchIdRef.current) return;

      const freshList = res.configs || [];
      const freshRecord = findConfigInList(freshList, cfg);

      if (!freshRecord) {
        setConfigs(prev => prev.filter(c => (c.id && cfg.id ? c.id !== cfg.id : c.key !== cfg.key)));
        toast.error(`Configuration '${cfg.key}' was deleted upstream or no longer exists.`);
        return;
      }

      // Synchronize table state with fresh configs
      setConfigs(freshList);

      // Capture baseline snapshot for concurrent conflict detection
      baselineConfigRef.current = {
        id: freshRecord.id,
        key: freshRecord.key,
        value: freshRecord.value,
        type: freshRecord.type || 'json',
        active: freshRecord.active
      };
      setConflictState(null);

      // Populate edit modal
      setEditModalConfig(freshRecord);
      setFormKey(freshRecord.key);
      setFormType(freshRecord.type || 'json');

      let initialVal = freshRecord.value;
      if (freshRecord.type === 'json') {
        try {
          const parsed = JSON.parse(freshRecord.value);
          initialVal = JSON.stringify(parsed, null, 2);
        } catch (e) {}
      }
      setFormValue(initialVal);
      setFormActive(freshRecord.active);
      setFormError('');
      setRepairFeedback(null);
      setEditorViewMode('editor');
    } catch (err) {
      if (fetchId !== actionFetchIdRef.current) return;
      console.error('Failed to load latest configuration for editing:', err);
      toast.error(`Failed to load latest configuration for editing: ${err.message}`);
    } finally {
      if (fetchId === actionFetchIdRef.current) {
        setFetchingActionId(null);
      }
    }
  };

  // Copy Action: Always fetch the latest value from upstream, copy raw value to clipboard, sync table
  const handleCopyConfig = async (cfg) => {
    if (!cfg) return;
    const actionKey = `copy-${cfg.id || cfg.key}`;
    setFetchingActionId(actionKey);
    const fetchId = ++actionFetchIdRef.current;

    try {
      const res = await api.getRemoteConfigs(platform, selectedApp, {
        id: cfg.id,
        key: cfg.key
      });
      if (fetchId !== actionFetchIdRef.current) return;

      const freshList = res.configs || [];
      const freshRecord = findConfigInList(freshList, cfg);

      if (!freshRecord) {
        setConfigs(prev => prev.filter(c => (c.id && cfg.id ? c.id !== cfg.id : c.key !== cfg.key)));
        toast.error(`Configuration '${cfg.key}' was deleted upstream or no longer exists.`);
        return;
      }

      // Synchronize table with latest values without altering mutation ordering
      setConfigs(freshList);

      // Copy complete raw configuration value
      await copyToClipboard(freshRecord.value);
      setCopiedKey(`val-${cfg.id || cfg.key}`);
      setTimeout(() => setCopiedKey(null), 2000);
      toast.success(`Copied latest value of '${cfg.key}' to clipboard`);
    } catch (err) {
      if (fetchId !== actionFetchIdRef.current) return;
      console.error('Failed to copy latest configuration value:', err);
      toast.error(`Failed to copy latest value for '${cfg.key}': ${err.message}`);
    } finally {
      if (fetchId === actionFetchIdRef.current) {
        setFetchingActionId(null);
      }
    }
  };

  // Copy key name helper
  const handleCopyKey = async (keyName, identifier) => {
    try {
      await copyToClipboard(keyName);
      setCopiedKey(identifier);
      setTimeout(() => setCopiedKey(null), 2000);
      toast.success(`Copied key '${keyName}'`);
    } catch (err) {
      toast.error(`Failed to copy key: ${err.message}`);
    }
  };

  // Reload latest upstream value into editor when conflict is resolved
  const handleReloadLatestIntoEditor = () => {
    if (!conflictState?.currentUpstream) return;
    const up = conflictState.currentUpstream;
    baselineConfigRef.current = {
      id: up.id,
      key: up.key,
      value: up.value,
      type: up.type || 'json',
      active: up.active
    };
    setFormKey(up.key);
    setFormType(up.type || 'json');
    let val = up.value;
    if (up.type === 'json') {
      try {
        val = JSON.stringify(JSON.parse(up.value), null, 2);
      } catch (e) {}
    }
    setFormValue(val);
    setFormActive(up.active);
    setConflictState(null);
    setRepairFeedback(null);
    setFormError('');
    toast.info('Loaded latest upstream value into editor.');
  };

  // Force overwrite when user explicitly reviews and decides to proceed
  const handleForceOverwrite = () => {
    setConflictState(null);
    handleSaveForm(null, true);
  };

  const bannerMessage = useMemo(() => {
    if (sortBy === 'recent') {
      return 'Showing session-mutated configurations first (newest updates at the top), followed by original server list order. (Note: Upstream service does not provide persistent update timestamps).';
    }
    if (sortBy === 'server') {
      return 'Showing original server list order (Sr. No). Upstream Remote Config service does not store or expose update timestamps.';
    }
    if (sortBy === 'key-asc' || sortBy === 'key-desc') {
      return `Sorted alphabetically by configuration key (${sortBy === 'key-asc' ? 'A → Z' : 'Z → A'}).`;
    }
    if (sortBy === 'type') {
      return 'Sorted by data type (boolean, number, json).';
    }
    if (sortBy === 'status') {
      return 'Sorted by active status (active configurations first).';
    }
    return timestampLimitation || 'Legacy Remote Config service does not provide update timestamps. Table reflects server list order.';
  }, [sortBy, timestampLimitation]);

  // Toggle Active directly from table
  const handleToggleActive = async (config) => {
    setTogglingId(config.id);
    const targetState = !config.active;
    try {
      const res = await api.toggleRemoteConfigActive(config.id, {
        platform,
        app: selectedApp,
        is_active: targetState
      });

      // 1. Record mutation sequence
      recordMutation(platform, selectedApp, config.key);

      // 2. Immediately update local state without duplicating
      const confirmedConfig = res.config || { ...config, active: targetState };
      setConfigs(prev => prev.map(c =>
        (c.id && c.id === config.id) || c.key === config.key
          ? { ...c, ...confirmedConfig, active: targetState }
          : c
      ));

      toast.success(`Remote Config '${config.key}' is now ${targetState ? 'ACTIVE' : 'INACTIVE'}`);
      await loadConfigs();
    } catch (err) {
      console.error('Failed to toggle active status:', err);
      toast.error(`Failed to toggle status: ${err.message}`);
    } finally {
      setTogglingId(null);
    }
  };

  // Handle Form Submission (Create or Edit)
  const handleSaveForm = async (e, forceOverwrite = false) => {
    if (e && e.preventDefault) e.preventDefault();
    if (submittingRef.current || submitting) return;
    setFormError('');

    if (!formKey.trim()) {
      setFormError('Key name is required.');
      return;
    }

    // Type-specific client validation
    if (formType === 'json') {
      try {
        JSON.parse(formValue);
      } catch (err) {
        setFormError(`Invalid JSON syntax: ${err.message}`);
        return;
      }
    } else if (formType === 'number') {
      if (formValue.trim() === '' || isNaN(Number(formValue))) {
        setFormError('Value must be a valid number.');
        return;
      }
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const trimmedKey = formKey.trim();
      if (editModalConfig) {
        // Concurrency Check before updating: verify if another user modified this key upstream
        if (!forceOverwrite && baselineConfigRef.current) {
          try {
            const freshRes = await api.getRemoteConfigs(platform, selectedApp, {
              id: editModalConfig.id,
              key: editModalConfig.key
            });
            const currentUpstream = findConfigInList(freshRes.configs || [], editModalConfig);

            if (!currentUpstream) {
              setFormError(`Configuration '${editModalConfig.key}' was deleted upstream by another team member.`);
              return;
            }

            const valueChanged = currentUpstream.value !== baselineConfigRef.current.value;
            const typeChanged = (currentUpstream.type || 'json') !== (baselineConfigRef.current.type || 'json');
            const activeChanged = Boolean(currentUpstream.active) !== Boolean(baselineConfigRef.current.active);

            if (valueChanged || typeChanged || activeChanged) {
              setConflictState({
                detected: true,
                upstreamValue: currentUpstream.value,
                upstreamType: currentUpstream.type || 'json',
                upstreamActive: currentUpstream.active,
                baselineValue: baselineConfigRef.current.value,
                currentUpstream
              });
              return; // Halt: require user review before overwriting
            }
          } catch (fetchErr) {
            console.warn('Pre-save concurrency verification could not reach upstream:', fetchErr);
          }
        }

        // Update
        const oldKey = editModalConfig.key;
        const res = await api.updateRemoteConfig(editModalConfig.id, {
          platform,
          app: selectedApp,
          key: trimmedKey,
          type: formType,
          value: formValue,
          is_active: formActive
        });

        // 1. Record mutation with rename handling
        recordMutation(platform, selectedApp, trimmedKey, oldKey);

        // 2. Immediately update local configuration state
        const confirmedConfig = res.config || {
          ...editModalConfig,
          key: trimmedKey,
          type: formType,
          value: formValue,
          active: formActive
        };

        setConfigs(prev => {
          const exists = prev.some(c => (c.id && c.id === editModalConfig.id) || c.key === oldKey);
          if (exists) {
            return prev.map(c =>
              (c.id && c.id === editModalConfig.id) || c.key === oldKey
                ? { ...c, ...confirmedConfig }
                : c
            );
          }
          return [confirmedConfig, ...prev];
        });

        toast.success(`Config '${trimmedKey}' updated successfully.`);
        setEditModalConfig(null);
        setConflictState(null);
      } else {
        // Create
        const res = await api.createRemoteConfig({
          platform,
          app: selectedApp,
          key: trimmedKey,
          type: formType,
          value: formValue,
          is_active: formActive
        });

        // 1. Record mutation
        recordMutation(platform, selectedApp, trimmedKey);

        // 2. Immediately update local state without creating duplicate
        const confirmedConfig = res.config || {
          id: Date.now(),
          key: trimmedKey,
          type: formType,
          value: formValue,
          active: formActive,
          platform,
          app: selectedApp,
          srNo: configs.length + 1
        };

        setConfigs(prev => {
          const filtered = prev.filter(c => c.key.toLowerCase() !== trimmedKey.toLowerCase());
          return [confirmedConfig, ...filtered];
        });

        toast.success(`Config '${trimmedKey}' created successfully.`);
        setCreateModalOpen(false);
      }
      await loadConfigs();
    } catch (err) {
      console.error('Failed to save config:', err);
      // Preserve form values so user doesn't lose inputs!
      setFormError(err.message || 'Operation failed on remote service.');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  // Keyboard shortcut: Ctrl + Enter (Cmd + Enter on macOS) to save while Edit Remote Config is open
  useEffect(() => {
    if (!editModalConfig) return;

    const handleKeyDown = (e) => {
      if (isGenerateShortcut(e)) {
        e.preventDefault();
        e.stopPropagation();
        if (submittingRef.current) return;
        handleSaveForm();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => {
      window.removeEventListener('keydown', handleKeyDown, { capture: true });
    };
  }, [editModalConfig, handleSaveForm]);

  // Handle Delete Confirmation
  const handleDeleteConfirm = async () => {
    if (!deleteConfirmConfig) return;
    setSubmitting(true);
    try {
      await api.deleteRemoteConfig(deleteConfirmConfig.id, {
        platform,
        app: selectedApp
      });

      // Remove from mutation tracker
      removeMutation(platform, selectedApp, deleteConfirmConfig.key);

      // Remove from local state
      setConfigs(prev => prev.filter(c => c.id !== deleteConfirmConfig.id && c.key !== deleteConfirmConfig.key));

      toast.success(`Config '${deleteConfirmConfig.key}' deleted successfully.`);
      setDeleteConfirmConfig(null);
      await loadConfigs();
    } catch (err) {
      console.error('Failed to delete config:', err);
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  // JSON Formatting helpers
  const handlePrettifyJson = () => {
    try {
      const parsed = JSON.parse(formValue);
      setFormValue(JSON.stringify(parsed, null, 2));
      setFormError('');
    } catch (err) {
      setFormError(`Cannot format invalid JSON: ${err.message}`);
    }
  };

  const handleMinifyJson = () => {
    try {
      const parsed = JSON.parse(formValue);
      setFormValue(JSON.stringify(parsed));
      setFormError('');
    } catch (err) {
      setFormError(`Cannot minify invalid JSON: ${err.message}`);
    }
  };

  // Handle Tab and Shift+Tab indentation inside the JSON editor
  const handleTextareaKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      if (e.shiftKey) {
        // Unindent: if previous 2 chars are spaces, remove them
        if (start >= 2 && val.substring(start - 2, start) === '  ') {
          const newVal = val.substring(0, start - 2) + val.substring(start);
          setFormValue(newVal);
          requestAnimationFrame(() => {
            textarea.selectionStart = textarea.selectionEnd = start - 2;
          });
        }
      } else {
        // Indent: insert 2 spaces
        const newVal = val.substring(0, start) + '  ' + val.substring(end);
        setFormValue(newVal);
        requestAnimationFrame(() => {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        });
      }
    }
  };

  // Real-time JSON validation & detailed syntax analysis
  const jsonAnalysis = useMemo(() => {
    if (formType !== 'json') return null;
    return analyzeJsonSyntax(formValue);
  }, [formType, formValue]);

  // Backward-compatible validation indicator
  const jsonValidation = useMemo(() => {
    if (formType !== 'json' || !jsonAnalysis) return null;
    return {
      valid: jsonAnalysis.valid,
      error: jsonAnalysis.message
    };
  }, [formType, jsonAnalysis]);

  // Auto Repair action handler
  const handleAutoRepair = () => {
    if (formType !== 'json') return;
    const res = repairJson(formValue);
    if (res.success) {
      setFormValue(res.repairedText);
      setRepairFeedback({
        success: true,
        message: res.message,
        repairs: res.repairsApplied
      });
      setFormError('');
      toast.success('JSON automatically repaired!');
    } else {
      setRepairFeedback({
        success: false,
        message: res.message,
        reasonCode: res.reasonCode,
        line: res.line,
        column: res.column
      });
      toast.error(res.message);
    }
  };

  // Show Error Location handler: moves caret to exact error line and column with centered viewport
  const handleShowErrorLocation = () => {
    if (!jsonAnalysis || jsonAnalysis.valid) return;
    editorRef.current?.navigateToError(jsonAnalysis);
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 p-6 lg:p-8 space-y-5 pb-16">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[var(--line)]">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Sliders className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1F2544] dark:text-white tracking-tight font-sans flex items-center gap-2.5">
              Remote Config <span className="text-heading-gradient">Manager</span>
              <span className="chip-badge text-[10px] py-0.5 px-2 uppercase font-mono">
                {platform || 'Android'}
              </span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6B7194] dark:text-[#94A3B8] mt-1">
              Centralized mobile feature flags, dynamic variables, and runtime JSON configuration management.
            </p>
          </div>
        </div>
      </div>

      {/* Controls Toolbar */}
      <div className="p-4 sm:p-5 rounded-card glass border border-[var(--line)] shadow-glass space-y-4">
        {/* Row 1: Platform & App Selection (Left) + Counts & Action Buttons (Right) */}
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3.5">
          {/* Left Controls: Platform Tabs & Application Dropdown */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Platform Segmented Control */}
            <div
              role="tablist"
              aria-label="Target Platform"
              className="inline-flex items-center p-1 rounded-xl bg-slate-100/80 dark:bg-[#0E131F] border border-[var(--line)] shrink-0 h-10"
            >
              <button
                type="button"
                role="tab"
                aria-selected={platform === 'android'}
                onClick={() => handlePlatformChange('android')}
                className={`h-8 min-w-[105px] px-3.5 inline-flex items-center justify-center gap-2 rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${
                  platform === 'android'
                    ? 'bg-white dark:bg-[#1C2333] text-[#7c6cf6] dark:text-violet-400 shadow-xs border border-[rgba(99,102,241,0.2)] dark:border-[#2A344A]'
                    : 'text-[#6B7194] dark:text-[#8F97A6] hover:text-[#1F2544] dark:hover:text-white border border-transparent'
                }`}
              >
                <Smartphone className="w-4 h-4 shrink-0 text-[#7c6cf6] dark:text-violet-400" />
                <span>Android</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={platform === 'ios'}
                onClick={() => handlePlatformChange('ios')}
                className={`h-8 min-w-[105px] px-3.5 inline-flex items-center justify-center gap-2 rounded-lg text-xs font-bold transition-all cursor-pointer select-none ${
                  platform === 'ios'
                    ? 'bg-white dark:bg-[#1C2333] text-[#7c6cf6] dark:text-violet-400 shadow-xs border border-[rgba(99,102,241,0.2)] dark:border-[#2A344A]'
                    : 'text-[#6B7194] dark:text-[#8F97A6] hover:text-[#1F2544] dark:hover:text-white border border-transparent'
                }`}
              >
                <Apple className="w-4 h-4 shrink-0 text-[#7c6cf6] dark:text-violet-400" />
                <span>iOS</span>
              </button>
            </div>

            {/* Application Dropdown */}
            <div className="w-full sm:w-64 min-w-[200px]">
              <CustomSelect
                value={selectedApp}
                onValueChange={setSelectedApp}
                onChange={(e) => setSelectedApp(e?.target?.value ?? e)}
                options={applications.map(a => ({
                  value: a.slug,
                  label: `${a.name} (${a.slug})${a.configCount ? ` • ${a.configCount}` : ''}`
                }))}
                placeholder={loadingApps ? "Loading applications..." : "Select Application"}
                disabled={loadingApps || applications.length === 0}
                className="h-10 text-xs font-medium rounded-xl"
                searchable={applications.length > 5}
              />
            </div>
          </div>

          {/* Right Controls: Summary Counts, Refresh & Create Config */}
          <div className="flex flex-wrap items-center gap-2.5 ml-auto shrink-0">
            {/* Quick Summary Counts */}
            <div className="hidden sm:flex items-center gap-2 text-xs">
              <span className="status-pill text-xs py-1 px-3">
                Total: <strong className="ml-1 text-[#1F2544] dark:text-white font-bold">{summary.total}</strong>
              </span>
              <span className="status-pill text-xs py-1 px-3 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/20">
                <span className="dot ok w-1.5 h-1.5 mr-1.5"></span>
                Active: <strong className="ml-1 font-bold">{summary.active}</strong>
              </span>
              <span className="status-pill text-xs py-1 px-3 text-[#6B7194] dark:text-[#8F97A6]">
                <span className="dot w-1.5 h-1.5 mr-1.5"></span>
                Inactive: <strong className="ml-1 font-bold">{summary.inactive}</strong>
              </span>
            </div>

            {/* Refresh Button */}
            <button
              type="button"
              onClick={() => loadConfigs()}
              disabled={loadingConfigs}
              title="Refresh configurations"
              className="h-10 w-10 p-0 rounded-xl btn-soft shrink-0 flex items-center justify-center cursor-pointer shadow-xs"
            >
              <RefreshCw className={`w-4 h-4 text-[#6B7194] dark:text-[#8F97A6] ${loadingConfigs ? 'animate-spin text-[#7c6cf6] dark:text-violet-400' : ''}`} />
            </button>

            {/* Create Config Button */}
            <button
              type="button"
              onClick={openCreateModal}
              disabled={!selectedApp}
              className="h-10 px-4 rounded-xl btn-magic text-white text-xs font-bold shadow-magic transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4 text-white" />
              <span>Create Config</span>
            </button>
          </div>
        </div>

        {/* Mobile Summary Counts (Visible on small screens where wrapped) */}
        <div className="flex sm:hidden items-center gap-2 text-xs pt-1">
          <span className="status-pill text-xs py-1 px-2.5">
            Total: <strong className="ml-1 text-[#1F2544] dark:text-white font-bold">{summary.total}</strong>
          </span>
          <span className="status-pill text-xs py-1 px-2.5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 bg-emerald-50/50 dark:bg-emerald-950/20">
            <span className="dot ok w-1.5 h-1.5 mr-1"></span>
            Active: <strong className="ml-1 font-bold">{summary.active}</strong>
          </span>
          <span className="status-pill text-xs py-1 px-2.5 text-[#6B7194] dark:text-[#8F97A6]">
            <span className="dot w-1.5 h-1.5 mr-1"></span>
            Inactive: <strong className="ml-1 font-bold">{summary.inactive}</strong>
          </span>
        </div>

        {/* Row 2: Filters & Search */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 pt-3 border-t border-[var(--line)]">
          {/* Search */}
          <div className="lg:col-span-4 sm:col-span-2 relative">
            <Search className="w-4 h-4 text-[#6B7194] dark:text-[#8F97A6] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by key name, value, or app..."
              className="w-full h-10 pl-9 pr-3.5 text-xs rounded-xl bg-white/70 border border-[var(--line)] text-[#1F2544] placeholder-[#6B7194] dark:bg-[#080B10] dark:border-[#1E2638] dark:text-white focus:outline-none focus:border-[#7c6cf6] focus:ring-1 focus:ring-[#7c6cf6]/50 shadow-xs"
            />
          </div>

          {/* Type Filter */}
          <div className="lg:col-span-2 sm:col-span-1">
            <CustomSelect
              value={typeFilter}
              onValueChange={setTypeFilter}
              onChange={(e) => setTypeFilter(e?.target?.value ?? e)}
              options={[
                { value: '', label: 'All Types' },
                { value: 'boolean', label: 'Boolean' },
                { value: 'number', label: 'Number' },
                { value: 'json', label: 'JSON' }
              ]}
              placeholder="All Types"
              className="h-10 text-xs font-medium rounded-xl"
            />
          </div>

          {/* Status Filter */}
          <div className="lg:col-span-2 sm:col-span-1">
            <CustomSelect
              value={statusFilter}
              onValueChange={setStatusFilter}
              onChange={(e) => setStatusFilter(e?.target?.value ?? e)}
              options={[
                { value: '', label: 'All Status' },
                { value: 'active', label: 'Active Only' },
                { value: 'inactive', label: 'Inactive Only' }
              ]}
              placeholder="All Status"
              className="h-10 text-xs font-medium rounded-xl"
            />
          </div>

          {/* Sort Filter */}
          <div className="lg:col-span-4 sm:col-span-2">
            <CustomSelect
              value={sortBy}
              onValueChange={setSortBy}
              onChange={(e) => setSortBy(e?.target?.value ?? e)}
              options={[
                { value: 'recent', label: 'Order: Recently Updated' },
                { value: 'server', label: 'Order: Server (Sr. No)' },
                { value: 'key-asc', label: 'Order: Key (A → Z)' },
                { value: 'key-desc', label: 'Order: Key (Z → A)' },
                { value: 'type', label: 'Order: Type' },
                { value: 'status', label: 'Order: Active Status' }
              ]}
              placeholder="Sort order"
              className="h-10 text-xs font-medium rounded-xl"
            />
          </div>
        </div>
      </div>

      {/* Timestamps Limitation Notice Banner */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-xs bg-white/50 dark:bg-[#0E131F] text-[#6B7194] dark:text-[#8F97A6] border border-[var(--line)]">
        <Info className="w-4 h-4 text-[#7c6cf6] dark:text-violet-400 shrink-0" />
        <span className="leading-relaxed">
          {bannerMessage}
        </span>
      </div>

      {/* Configurations Table */}
      <div className="rounded-card glass border border-[var(--line)] overflow-hidden shadow-glass">
        <div className="overflow-x-auto min-w-0 w-full">
          <table className="w-full text-left text-xs text-[#1F2544] dark:text-slate-300 border-collapse">
            <thead className="sticky top-0 z-10 bg-white/95 dark:bg-[#080B10]/95 backdrop-blur-sm border-b border-[var(--line)] text-[#6B7194] dark:text-[#94A3B8] font-bold uppercase tracking-wider text-[11px]">
              <tr>
                <th className="py-3.5 px-4 w-14 text-center">Sr.</th>
                <th className="py-3.5 px-4 w-40 min-w-[130px]">Application</th>
                <th className="py-3.5 px-4 min-w-[220px] max-w-xs">Key</th>
                <th className="py-3.5 px-4 min-w-[320px]">Value</th>
                <th className="py-3.5 px-4 w-28 text-center">Type</th>
                <th className="py-3.5 px-4 w-28 text-center">Active</th>
                <th className="py-3.5 px-4 w-36 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--line)]">
              {loadingConfigs ? (
                <tr>
                  <td colSpan="7" className="py-14 text-center text-[#6B7194] dark:text-[#8F97A6] text-xs">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2.5 text-[#7c6cf6] dark:text-violet-400" />
                    <span>Loading remote configurations...</span>
                  </td>
                </tr>
              ) : filteredConfigs.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-14 text-center text-[#6B7194] dark:text-[#8F97A6] text-xs">
                    <Sliders className="w-8 h-8 mx-auto mb-2.5 opacity-40 text-[#7c6cf6] dark:text-violet-400" />
                    <p className="font-bold text-[#1F2544] dark:text-white text-sm">No configurations found</p>
                    <p className="text-xs text-[#6B7194] dark:text-[#8F97A6] mt-1">
                      {searchQuery || typeFilter || statusFilter
                        ? 'Try clearing the search or filters to see more results.'
                        : 'Click "Create Config" above to add the first configuration key.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredConfigs.map((cfg) => {
                  const isCopied = copiedKey === cfg.key;
                  const isToggling = togglingId === cfg.id;

                  return (
                    <tr
                      key={cfg.id || cfg.key}
                      className="hover:bg-[#7c6cf6]/5 dark:hover:bg-[#1C2230]/40 transition-colors"
                    >
                      {/* Sr. No */}
                      <td className="py-3.5 px-4 text-center font-mono text-[#6B7194] dark:text-[#8F97A6] text-xs">
                        {cfg.srNo}
                      </td>

                      {/* Application */}
                      <td className="py-3.5 px-4 font-medium">
                        <span className="px-2.5 py-1 rounded-md bg-slate-100 dark:bg-[#141B28] text-[#6B7194] dark:text-[#94A3B8] font-mono text-xs border border-[var(--line)]">
                          {cfg.app}
                        </span>
                      </td>

                      {/* Key */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2 group">
                          <span className="font-mono font-bold text-[#1F2544] dark:text-white text-xs select-all break-all">
                            {cfg.key}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopyKey(cfg.key, cfg.key)}
                            title="Copy key name"
                            className="opacity-0 group-hover:opacity-100 p-1 text-[#6B7194] hover:text-[#7c6cf6] dark:hover:text-violet-400 transition-opacity cursor-pointer shrink-0"
                          >
                            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </td>

                      {/* Value Preview */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2 max-w-xl">
                          <div className="flex-1 min-w-0">
                            <ConfigValuePreview type={cfg.type} value={cfg.value} />
                          </div>
                          <button
                            type="button"
                            onClick={() => handleViewConfig(cfg)}
                            disabled={fetchingActionId === `view-${cfg.id || cfg.key}`}
                            title="View full value in JSON Inspector (fetches latest upstream value)"
                            className="p-1.5 rounded-lg btn-soft text-[#6B7194] hover:text-[#1F2544] dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                          >
                            {fetchingActionId === `view-${cfg.id || cfg.key}` ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#7c6cf6]" />
                            ) : (
                              <Maximize2 className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Type Badge */}
                      <td className="py-3.5 px-4 text-center">
                        {cfg.type === 'boolean' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                            Boolean
                          </span>
                        )}
                        {cfg.type === 'number' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30">
                            Number
                          </span>
                        )}
                        {cfg.type === 'json' && (
                          <span className="px-2.5 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/30">
                            JSON
                          </span>
                        )}
                      </td>

                      {/* Active Toggle */}
                      <td className="py-3.5 px-4 text-center">
                        <button
                          type="button"
                          onClick={() => handleToggleActive(cfg)}
                          disabled={isToggling}
                          title={cfg.active ? 'Click to deactivate' : 'Click to activate'}
                          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10.5px] font-bold transition-all cursor-pointer ${
                            cfg.active
                              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20'
                              : 'bg-slate-100 dark:bg-[#141B28] text-[#6B7194] dark:text-[#8F97A6] border border-[var(--line)] hover:bg-slate-200/50'
                          }`}
                        >
                          {isToggling ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : cfg.active ? (
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          ) : (
                            <XCircle className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>{cfg.active ? 'YES' : 'NO'}</span>
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleEditConfig(cfg)}
                            disabled={fetchingActionId === `edit-${cfg.id || cfg.key}`}
                            title="Edit configuration (fetches latest upstream data)"
                            className="p-1.5 rounded-lg btn-soft text-[#6B7194] hover:text-[#7c6cf6] transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {fetchingActionId === `edit-${cfg.id || cfg.key}` ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#7c6cf6]" />
                            ) : (
                              <Edit2 className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyConfig(cfg)}
                            disabled={fetchingActionId === `copy-${cfg.id || cfg.key}`}
                            title="Copy latest raw value to clipboard"
                            className="p-1.5 rounded-lg btn-soft text-[#6B7194] hover:text-[#1F2544] dark:hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {fetchingActionId === `copy-${cfg.id || cfg.key}` ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#7c6cf6]" />
                            ) : copiedKey === `val-${cfg.id || cfg.key}` ? (
                              <Check className="w-3.5 h-3.5 text-emerald-500" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setDeleteConfirmConfig(cfg)}
                            title="Delete configuration"
                            className="p-1.5 rounded-lg btn-soft text-[#6B7194] hover:text-rose-600 hover:border-rose-300 dark:hover:text-rose-400 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE / EDIT MODAL */}
      {(createModalOpen || editModalConfig) && (
        <div
          data-remote-config-dialog="true"
          role="dialog"
          aria-modal="true"
          aria-label={editModalConfig ? 'Edit Remote Config' : 'Create New Remote Config'}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setCreateModalOpen(false);
              setEditModalConfig(null);
            }
          }}
        >
          <div className="bg-white dark:bg-[#0D111A] border border-[var(--line)] dark:border-[#1E2638] rounded-2xl w-full max-w-[960px] max-h-[94vh] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-[var(--line)] shrink-0 bg-slate-50/50 dark:bg-[#0A0E17]/60">
              <div className="flex items-center justify-between gap-4">
                {/* Left: Icon + Title + Key Badge + Platform/App */}
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-950/50 flex items-center justify-center text-[#7c6cf6] dark:text-violet-400 shrink-0">
                    {editModalConfig ? <Edit2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </div>
                  <div className="min-w-0 flex-1 flex items-center gap-2.5 flex-wrap">
                    <h2 className="text-base sm:text-lg font-bold text-[#1F2544] dark:text-white truncate">
                      {editModalConfig ? 'Edit Remote Config' : 'Create New Remote Config'}
                    </h2>
                    {editModalConfig && (
                      <span
                        className="font-mono text-xs px-2.5 py-0.5 rounded-md bg-violet-500/10 text-[#7c6cf6] dark:text-violet-400 border border-violet-500/20 max-w-[280px] sm:max-w-md truncate"
                        title={editModalConfig.key}
                      >
                        {editModalConfig.key}
                      </span>
                    )}
                    <span className="text-xs text-[#6B7194] dark:text-[#8F97A6]">•</span>
                    <span className="text-xs font-semibold text-[#6B7194] dark:text-[#8F97A6]">
                      <span className="font-bold text-[#7c6cf6] dark:text-violet-400 uppercase">{platform}</span> / <span className="font-mono text-[#1F2544] dark:text-white">{selectedApp}</span>
                    </span>
                  </div>
                </div>

                {/* Right controls: Active Status toggle + Close button */}
                <div className="flex items-center gap-3 shrink-0">
                  <label className="inline-flex items-center gap-2 px-2.5 py-1 rounded-lg border border-[var(--line)] bg-white/70 dark:bg-[#080B10] cursor-pointer hover:border-[#7c6cf6]/50 transition-colors select-none" title="Live active status on service">
                    <input
                      type="checkbox"
                      checked={formActive}
                      onChange={(e) => setFormActive(e.target.checked)}
                      className="w-3.5 h-3.5 rounded border-slate-300 text-[#7c6cf6] focus:ring-[#7c6cf6] cursor-pointer"
                    />
                    <span className="text-xs font-semibold text-[#1F2544] dark:text-white">Active</span>
                    <span className={`w-2 h-2 rounded-full ${formActive ? 'bg-emerald-500 shadow-xs' : 'bg-slate-400'}`} />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      setCreateModalOpen(false);
                      setEditModalConfig(null);
                    }}
                    className="shrink-0 p-1.5 text-[#6B7194] hover:text-[#1F2544] dark:hover:text-white rounded-lg btn-soft cursor-pointer transition-colors"
                    title="Close modal (Esc)"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleSaveForm} className="flex-1 min-h-0 flex flex-col overflow-hidden text-xs">
              <div className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0">
                {/* Form Error Banner */}
                {formError && (
                  <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-900/60">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="text-xs font-medium">{formError}</div>
                  </div>
                )}

                {/* Concurrent Update Conflict Banner */}
                {conflictState && (
                  <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 dark:bg-amber-500/15 text-amber-800 dark:text-amber-200 space-y-3 animate-in fade-in">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
                      <div className="flex-1 text-xs">
                        <p className="font-bold text-sm text-amber-900 dark:text-amber-100">
                          Concurrent Update Conflict Detected
                        </p>
                        <p className="mt-1 leading-relaxed text-amber-800 dark:text-amber-200">
                          Another team member modified configuration <strong className="font-mono">{editModalConfig?.key}</strong> upstream while your editor was open. Overwriting now would replace their latest saved values.
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2.5 pt-1">
                      <button
                        type="button"
                        onClick={handleReloadLatestIntoEditor}
                        className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Reload Latest Upstream Value</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleForceOverwrite}
                        className="px-3.5 py-1.5 rounded-lg border border-amber-600/40 hover:bg-amber-500/20 text-amber-900 dark:text-amber-200 font-semibold text-xs transition-colors cursor-pointer"
                      >
                        <span>Review & Overwrite Anyway</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Key Field (Only shown in Create mode; in Edit mode the key is pinned in header) */}
                {!editModalConfig && (
                  <div>
                    <label className="block font-bold uppercase tracking-wider text-[11px] text-[#6B7194] dark:text-[#94A3B8] mb-1.5">
                      Configuration Key <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formKey}
                      onChange={(e) => setFormKey(e.target.value)}
                      placeholder="e.g. enable_new_paywall_experiment"
                      required
                      className="w-full h-10 px-3.5 rounded-xl font-mono text-[13px] bg-white/70 border border-[var(--line)] text-[#1F2544] dark:bg-[#080B10] dark:border-[#1E2638] dark:text-white focus:outline-none focus:border-[#7c6cf6] focus:ring-1 focus:ring-[#7c6cf6]/50 shadow-xs"
                    />
                  </div>
                )}

                {/* Configuration Value Section */}
                <div className="flex-1 min-h-0 flex flex-col">
                  <div className="flex items-center justify-between mb-1.5 flex-wrap gap-2">
                    <label className="font-bold uppercase tracking-wider text-[11px] text-[#6B7194] dark:text-[#94A3B8]">
                      Configuration Value <span className="text-rose-500">*</span>
                    </label>

                    {formType === 'json' && (
                      <div className="flex items-center gap-2">
                        {/* Editor View Mode Segmented Toggle: Editor | Preview */}
                        <div
                          role="tablist"
                          aria-label="JSON Editor Mode"
                          className="inline-flex items-center bg-[#07090E] border border-[#171E2E] dark:border-[#1E2638] rounded-lg p-0.5"
                        >
                          <button
                            type="button"
                            role="tab"
                            aria-selected={editorViewMode === 'editor'}
                            onClick={() => setEditorViewMode('editor')}
                            className={`px-2.5 py-1 rounded text-[10.5px] font-semibold transition-all cursor-pointer ${
                              editorViewMode === 'editor'
                                ? 'bg-[#1E2638] text-white shadow-xs'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            Editor
                          </button>
                          <button
                            type="button"
                            role="tab"
                            aria-selected={editorViewMode === 'preview'}
                            onClick={() => setEditorViewMode('preview')}
                            className={`px-2.5 py-1 rounded text-[10.5px] font-semibold transition-all flex items-center gap-1 cursor-pointer ${
                              editorViewMode === 'preview'
                                ? 'bg-[#1E2638] text-sky-400 shadow-xs'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <Code2 className="w-3 h-3" />
                            <span>Syntax Preview</span>
                          </button>
                        </div>

                        <div className="h-4 w-px bg-[var(--line)]" />

                        {/* Formatting action buttons */}
                        <button
                          type="button"
                          onClick={handlePrettifyJson}
                          className="px-2.5 py-1 rounded-lg btn-soft text-[#6B7194] hover:text-[#1F2544] dark:text-[#CBD5E1] dark:hover:text-white text-[11px] font-semibold cursor-pointer transition-colors"
                          title="Prettify JSON with 2 spaces indentation"
                        >
                          Format
                        </button>
                        <button
                          type="button"
                          onClick={handleMinifyJson}
                          className="px-2.5 py-1 rounded-lg btn-soft text-[#6B7194] hover:text-[#1F2544] dark:text-[#CBD5E1] dark:hover:text-white text-[11px] font-semibold cursor-pointer transition-colors"
                          title="Minify JSON into a single line"
                        >
                          Minify
                        </button>
                      </div>
                    )}
                  </div>

                  {formType === 'boolean' && (
                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <button
                        type="button"
                        onClick={() => setFormValue('1')}
                        className={`h-12 rounded-xl border font-mono text-xs font-bold transition-all cursor-pointer ${
                          formValue === '1'
                            ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 shadow-xs'
                            : 'border-[var(--line)] bg-white/70 dark:bg-[#080B10] text-[#6B7194]'
                        }`}
                      >
                        1 (TRUE / ENABLED)
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormValue('0')}
                        className={`h-12 rounded-xl border font-mono text-xs font-bold transition-all cursor-pointer ${
                          formValue === '0'
                            ? 'border-slate-500 bg-slate-500/15 text-[#1F2544] dark:text-white shadow-xs'
                            : 'border-[var(--line)] bg-white/70 dark:bg-[#080B10] text-[#6B7194]'
                        }`}
                      >
                        0 (FALSE / DISABLED)
                      </button>
                    </div>
                  )}

                  {formType === 'number' && (
                    <input
                      type="number"
                      step="any"
                      value={formValue}
                      onChange={(e) => setFormValue(e.target.value)}
                      placeholder="e.g. 42 or 3.14"
                      required
                      className="w-full h-10 px-3.5 rounded-xl font-mono text-[13px] bg-white/70 border border-[var(--line)] text-[#1F2544] dark:bg-[#080B10] dark:border-[#1E2638] dark:text-white focus:outline-none focus:border-[#7c6cf6] focus:ring-1 focus:ring-[#7c6cf6]/50 shadow-xs"
                    />
                  )}

                  {formType === 'json' && (
                    <div className="flex-1 min-h-0 flex flex-col space-y-2">
                      {editorViewMode === 'preview' ? (
                        <div className="flex-1 min-h-0">
                          <JsonSyntaxViewer
                            json={formValue}
                            showLineNumbers={true}
                            sanitize={false}
                            maxHeightClass="h-[62vh] min-h-[380px] max-h-[70vh]"
                          />
                        </div>
                      ) : (
                        <SynchronizedJsonEditor
                          ref={editorRef}
                          value={formValue}
                          onChange={(e) => {
                            setFormValue(e.target.value);
                            setRepairFeedback(null);
                            setFormError('');
                          }}
                          onKeyDown={handleTextareaKeyDown}
                          heightClass="h-[58vh] min-h-[350px] max-h-[64vh]"
                        />
                      )}

                      {/* Live JSON status & Auto Repair Error Panel */}
                      {jsonAnalysis && (
                        <div className="shrink-0 pt-1">
                          {jsonAnalysis.valid ? (
                            <div className="flex items-center justify-between gap-2 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs">
                              <span className="flex items-center gap-1.5 font-semibold">
                                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
                                <span>Valid JSON syntax</span>
                              </span>
                              {repairFeedback?.success && (
                                <span className="text-[11px] font-medium text-emerald-600/90 dark:text-emerald-300 truncate max-w-[360px]" title={repairFeedback.message}>
                                  {repairFeedback.message}
                                </span>
                              )}
                            </div>
                          ) : (
                            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 dark:bg-rose-950/30 p-2.5 sm:p-3 text-xs space-y-2">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                                <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
                                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5 sm:mt-0" />
                                  <span className="font-semibold text-rose-700 dark:text-rose-300 break-words leading-tight">
                                    {jsonAnalysis.message}
                                  </span>
                                  {jsonAnalysis.line && (
                                    <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[10.5px] font-bold bg-rose-500/20 text-rose-700 dark:text-rose-300 border border-rose-500/30">
                                      Line {jsonAnalysis.line}{jsonAnalysis.column ? `, Col ${jsonAnalysis.column}` : ''}
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  {jsonAnalysis.position !== null && (
                                    <button
                                      type="button"
                                      onClick={handleShowErrorLocation}
                                      className="px-2.5 py-1 rounded-lg border border-rose-400/40 hover:bg-rose-500/20 text-rose-700 dark:text-rose-300 font-semibold text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                                      title="Jump cursor to error position"
                                    >
                                      <Crosshair className="w-3.5 h-3.5" />
                                      <span>Show Error Location</span>
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    onClick={handleAutoRepair}
                                    className="px-3 py-1 rounded-lg bg-[#7c6cf6] hover:bg-[#6b5ae0] text-white font-bold text-[11px] flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                    title="Automatically repair safe syntax errors"
                                  >
                                    <Wrench className="w-3.5 h-3.5" />
                                    <span>Auto Repair</span>
                                  </button>
                                </div>
                              </div>

                              {/* Manual action required callout if auto-repair cannot safely determine value */}
                              {repairFeedback && !repairFeedback.success && (
                                <div className="flex items-start gap-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-200 text-[11.5px] leading-relaxed">
                                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500 mt-0.5" />
                                  <div className="flex-1">
                                    <span className="font-bold">Manual action required: </span>
                                    <span>
                                      {repairFeedback.reasonCode === 'DANGLING_COLON_MISSING_VALUE'
                                        ? 'A property value is missing and cannot be guessed. Please provide the value manually.'
                                        : 'This syntax error cannot be repaired automatically without guessing values. Please correct it manually at the highlighted location.'}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Form Actions Footer */}
              <div className="shrink-0 px-6 py-4 border-t border-[var(--line)] flex items-center justify-end gap-3 bg-white/50 dark:bg-[#0D111A]/80 backdrop-blur-xs">
                <button
                  type="button"
                  onClick={() => {
                    setCreateModalOpen(false);
                    setEditModalConfig(null);
                  }}
                  className="h-10 px-5 rounded-xl btn-soft font-semibold text-xs transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  title={editModalConfig ? `Update Config (${submitShortcutLabel})` : undefined}
                  className="h-10 px-6 rounded-xl btn-magic text-white font-bold text-xs shadow-magic transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin text-white" />}
                  <span>{editModalConfig ? 'Update Config' : 'Create Config'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* VIEW FULL VALUE MODAL */}
      {viewValueConfig && (
        <div
          data-remote-config-dialog="true"
          role="dialog"
          aria-modal="true"
          aria-label="View Full Configuration Value"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setViewValueConfig(null);
            }
          }}
        >
          <div className="bg-white dark:bg-[#0D111A] border border-[var(--line)] dark:border-[#1E2638] rounded-2xl w-full max-w-[850px] max-h-[calc(100vh-48px)] flex flex-col shadow-2xl overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="px-6 py-4.5 border-b border-[var(--line)] flex items-center justify-between shrink-0 gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base sm:text-lg font-bold font-mono text-[#1F2544] dark:text-white truncate">
                    {viewValueConfig.key}
                  </h2>
                  <span className="shrink-0 px-2.5 py-0.5 rounded text-[10.5px] font-bold uppercase tracking-wider bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/30">
                    {viewValueConfig.type}
                  </span>
                </div>
                <p className="text-xs text-[#6B7194] dark:text-[#8F97A6] mt-0.5 truncate">
                  Application: <span className="font-mono font-semibold">{viewValueConfig.app}</span> | Status: <span className="font-semibold">{viewValueConfig.active ? 'ACTIVE' : 'INACTIVE'}</span>
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => handleViewConfig(viewValueConfig)}
                  disabled={fetchingActionId === `view-${viewValueConfig.id || viewValueConfig.key}`}
                  className="p-1.5 text-[#6B7194] hover:text-[#7c6cf6] rounded-lg btn-soft cursor-pointer transition-colors"
                  title="Re-fetch latest value from upstream"
                >
                  <RefreshCw className={`w-4 h-4 ${fetchingActionId === `view-${viewValueConfig.id || viewValueConfig.key}` ? 'animate-spin text-[#7c6cf6]' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setViewValueConfig(null)}
                  className="shrink-0 p-1.5 text-[#6B7194] hover:text-[#1F2544] dark:hover:text-white rounded-lg btn-soft cursor-pointer transition-colors"
                  title="Close modal (Esc)"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1 min-h-0">
              <JsonSyntaxViewer
                json={viewValueConfig.value}
                showLineNumbers={true}
                sanitize={false}
                maxHeightClass="min-h-[250px] max-h-[550px]"
              />
            </div>

            <div className="shrink-0 px-6 py-3.5 border-t border-[var(--line)] flex items-center justify-between bg-white/50 dark:bg-[#0D111A]/80 backdrop-blur-xs">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await copyToClipboard(viewValueConfig.value);
                    setCopiedModalValue(true);
                    setTimeout(() => setCopiedModalValue(false), 2000);
                    toast.success('Value copied to clipboard');
                  } catch (err) {
                    toast.error(`Failed to copy value: ${err.message}`);
                  }
                }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-xl btn-soft text-xs font-bold cursor-pointer transition-colors"
              >
                {copiedModalValue ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedModalValue ? 'Copied' : 'Copy Value'}</span>
              </button>

              <button
                type="button"
                onClick={() => setViewValueConfig(null)}
                className="px-4 py-2 rounded-xl btn-soft text-xs font-bold cursor-pointer transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DELETE CONFIRMATION MODAL */}
      {deleteConfirmConfig && (
        <div
          data-remote-config-dialog="true"
          role="dialog"
          aria-modal="true"
          aria-label="Delete Configuration Confirmation"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setDeleteConfirmConfig(null);
            }
          }}
        >
          <div className="bg-white dark:bg-[#0D111A] border border-[var(--line)] dark:border-[#1E2638] rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 text-rose-600 mb-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/50 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#1F2544] dark:text-white">Delete Configuration</h3>
                <p className="text-xs text-[#6B7194] dark:text-[#8F97A6]">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-[#6B7194] dark:text-[#CBD5E1] leading-relaxed mb-4">
              Are you sure you want to permanently delete configuration key{' '}
              <strong className="font-mono font-bold text-[#1F2544] dark:text-white">
                {deleteConfirmConfig.key}
              </strong>{' '}
              from application{' '}
              <strong className="font-mono font-bold text-[#1F2544] dark:text-white">
                {selectedApp}
              </strong>{' '}
              ({platform.toUpperCase()})?
            </p>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={submitting}
                onClick={() => setDeleteConfirmConfig(null)}
                className="px-4 py-2 rounded-xl btn-soft text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleDeleteConfirm}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                {submitting && <RefreshCw className="w-3.5 h-3.5 animate-spin" />}
                <span>Delete Key</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
