import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  HardDrive,
  Folder,
  Film,
  File,
  FolderPlus,
  RefreshCw,
  Search,
  ExternalLink,
  Trash2,
  Edit2,
  FolderInput,
  Share2,
  Check,
  Copy,
  AlertCircle,
  AlertTriangle,
  Loader2,
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
  X,
  UserCheck,
  LogOut,
  Video,
  Clock,
  Smartphone
} from 'lucide-react';
import { api } from '../services/api';
import DriveFolderSelectorModal from '../components/DriveFolderSelectorModal';

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(dateStr) {
  if (!dateStr) return '--';
  try {
    const d = new Date(dateStr);
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (e) {
    return dateStr;
  }
}

export default function GoogleDrivePage({ currentUser }) {
  // Tab: 'explorer' | 'recordings'
  const [activeView, setActiveView] = useState('explorer');

  // Connection & Profile State
  const [status, setStatus] = useState(null);
  const [quota, setQuota] = useState(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectConfirmOpen, setDisconnectConfirmOpen] = useState(false);

  // Files & Explorer State
  const [currentFolder, setCurrentFolder] = useState({ id: 'root', name: 'My Drive' });
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: 'root', name: 'My Drive' }]);
  const [files, setFiles] = useState([]);
  const [nextPageToken, setNextPageToken] = useState(null);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSearch, setActiveSearch] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState(null);

  // Modals & Action States
  const [newFolderModalOpen, setNewFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderLoading, setNewFolderLoading] = useState(false);

  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [targetItemToRename, setTargetItemToRename] = useState(null);
  const [renamedName, setRenamedName] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [targetItemToMove, setTargetItemToMove] = useState(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [targetItemToDelete, setTargetItemToDelete] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [targetItemToShare, setTargetItemToShare] = useState(null);
  const [shareResult, setShareResult] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [defaultFolderPickerOpen, setDefaultFolderPickerOpen] = useState(false);

  // Recordings Tab State
  const [recordings, setRecordings] = useState([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [deleteRecordingTarget, setDeleteRecordingTarget] = useState(null);
  const [deleteRecordingFromDrive, setDeleteRecordingFromDrive] = useState(false);
  const [deleteRecordingLoading, setDeleteRecordingLoading] = useState(false);

  const feedbackTimerRef = useRef(null);

  const showFeedback = (text, type = 'success') => {
    setFeedbackMessage({ text, type });
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    feedbackTimerRef.current = setTimeout(() => {
      setFeedbackMessage(null);
    }, 4000);
  };

  // Fetch connection status & quota
  const fetchStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const statusRes = await api.getDriveStatus().catch(() => ({ connected: false }));
      setStatus(statusRes);

      if (statusRes?.connected) {
        const quotaRes = await api.getDriveQuota().catch(() => null);
        if (quotaRes?.quota) setQuota(quotaRes.quota);
      } else {
        setQuota(null);
      }
    } catch (err) {
      console.error('[GoogleDrivePage] Status check error:', err);
    } finally {
      setStatusLoading(false);
    }
  }, []);

  // Fetch files in explorer
  const fetchFiles = useCallback(async (folderId, pageToken = null, search = '') => {
    setFilesLoading(true);
    if (!pageToken) {
      setFilesError(null);
    }
    try {
      const res = await api.listDriveFiles({
        folderId: search ? undefined : (folderId || 'root'),
        pageToken: pageToken || undefined,
        search: search || undefined,
        pageSize: 50
      });

      if (res?.success) {
        if (pageToken) {
          setFiles((prev) => [...prev, ...(res.files || [])]);
        } else {
          setFiles(res.files || []);
        }
        setNextPageToken(res.nextPageToken || null);
        setFilesError(null);
      } else {
        throw new Error(res?.error || 'Failed to list Google Drive files');
      }
    } catch (err) {
      console.error('[GoogleDrivePage] List files error:', err);
      const errMsg = err.message || 'Failed to list Drive files';
      setFilesError(errMsg);
      if (!pageToken) {
        setFiles([]);
      }
      showFeedback(errMsg, 'error');
    } finally {
      setFilesLoading(false);
    }
  }, []);

  // Fetch recordings list
  const fetchRecordings = useCallback(async () => {
    setRecordingsLoading(true);
    try {
      const res = await api.listRecordings();
      if (res?.success) {
        setRecordings(res.recordings || []);
      }
    } catch (err) {
      console.error('[GoogleDrivePage] List recordings error:', err);
      showFeedback(err.message || 'Failed to load test recordings', 'error');
    } finally {
      setRecordingsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    if (status?.connected) {
      fetchFiles(currentFolder.id, null, activeSearch);
    }
  }, [status?.connected, currentFolder.id, activeSearch, fetchFiles]);

  useEffect(() => {
    if (activeView === 'recordings') {
      fetchRecordings();
    }
  }, [activeView, fetchRecordings]);

  // Handle OAuth Popup
  const handleConnect = async (promptMode = null) => {
    setConnecting(true);
    try {
      const res = await api.getDriveAuthUrl(promptMode, window.location.origin);
      if (!res?.url) {
        throw new Error('Failed to generate Google authorization URL');
      }

      const w = 600;
      const h = 720;
      const left = window.screen.width / 2 - w / 2;
      const top = window.screen.height / 2 - h / 2;
      const popup = window.open(
        res.url,
        'google_oauth_popup',
        `width=${w},height=${h},top=${top},left=${left},status=no,menubar=no,toolbar=no`
      );

      if (!popup) {
        showFeedback('Popup was blocked by browser. Please allow popups for this site.', 'error');
        setConnecting(false);
        return;
      }

      let handled = false;
      let checkTimer = null;
      let messageListener = null;
      let broadcastChannel = null;

      const cleanup = () => {
        if (checkTimer) {
          clearInterval(checkTimer);
          checkTimer = null;
        }
        if (messageListener) {
          window.removeEventListener('message', messageListener);
          messageListener = null;
        }
        if (broadcastChannel) {
          try {
            broadcastChannel.close();
          } catch (e) {}
          broadcastChannel = null;
        }
      };

      const handleSuccess = () => {
        if (handled) return;
        handled = true;
        cleanup();
        if (popup && !popup.closed) {
          try { popup.close(); } catch (e) {}
        }
        showFeedback('Google Drive connected successfully!');
        fetchStatus();
        setConnecting(false);
      };

      const handleError = (errMsg) => {
        if (handled) return;
        handled = true;
        cleanup();
        if (popup && !popup.closed) {
          try { popup.close(); } catch (e) {}
        }
        showFeedback(errMsg || 'Google Drive authorization failed', 'error');
        setConnecting(false);
      };

      if (typeof BroadcastChannel !== 'undefined') {
        broadcastChannel = new BroadcastChannel('gdrive_oauth_channel');
        broadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'GDRIVE_AUTH_SUCCESS') {
            handleSuccess();
          } else if (event.data?.type === 'GDRIVE_AUTH_ERROR') {
            handleError(event.data.error);
          }
        };
      }

      messageListener = (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'GDRIVE_AUTH_SUCCESS') {
          handleSuccess();
        } else if (event.data?.type === 'GDRIVE_AUTH_ERROR') {
          handleError(event.data.error);
        }
      };

      window.addEventListener('message', messageListener);

      // Fallback check when popup is closed
      checkTimer = setInterval(async () => {
        if (popup && popup.closed) {
          cleanup();
          if (!handled) {
            handled = true;
            setConnecting(false);
            try {
              const check = await api.getDriveStatus();
              if (check?.connected) {
                showFeedback('Google Drive connected successfully!');
                fetchStatus();
              }
            } catch (e) {}
          }
        }
      }, 1000);
    } catch (err) {
      console.error('[GoogleDrivePage] Connect error:', err);
      showFeedback(err.message || 'Failed to initiate Google authorization', 'error');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await api.disconnectDrive();
      showFeedback('Google Drive disconnected.');
      setDisconnectConfirmOpen(false);
      fetchStatus();
    } catch (err) {
      showFeedback(err.message || 'Failed to disconnect Google Drive', 'error');
    } finally {
      setDisconnecting(false);
    }
  };

  // Folder navigation
  const handleOpenFolder = (folder) => {
    const next = { id: folder.id, name: folder.name };
    setCurrentFolder(next);
    setBreadcrumbs((prev) => [...prev, next]);
    setActiveSearch('');
    setSearchQuery('');
  };

  const handleBreadcrumbClick = (index) => {
    if (index === breadcrumbs.length - 1) return;
    const nextCrumbs = breadcrumbs.slice(0, index + 1);
    const target = nextCrumbs[nextCrumbs.length - 1];
    setBreadcrumbs(nextCrumbs);
    setCurrentFolder(target);
    setActiveSearch('');
    setSearchQuery('');
  };

  const handleNavigateUp = () => {
    if (breadcrumbs.length <= 1) return;
    handleBreadcrumbClick(breadcrumbs.length - 2);
  };

  // Search handler
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    setActiveSearch(searchQuery.trim());
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setActiveSearch('');
  };

  // Create Folder
  const handleCreateFolder = async (e) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setNewFolderLoading(true);
    try {
      const res = await api.createDriveFolder(
        newFolderName.trim(),
        currentFolder.id === 'root' ? undefined : currentFolder.id
      );
      if (res?.success) {
        showFeedback(`Folder "${newFolderName.trim()}" created successfully!`);
        setNewFolderName('');
        setNewFolderModalOpen(false);
        fetchFiles(currentFolder.id, null, activeSearch);
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to create folder', 'error');
    } finally {
      setNewFolderLoading(false);
    }
  };

  // Rename File / Folder
  const handleRenameSubmit = async (e) => {
    e.preventDefault();
    if (!targetItemToRename || !renamedName.trim()) return;
    setRenameLoading(true);
    try {
      const res = await api.renameDriveFile(targetItemToRename.id, renamedName.trim());
      if (res?.success) {
        showFeedback(`Renamed to "${renamedName.trim()}".`);
        setRenameModalOpen(false);
        setTargetItemToRename(null);
        fetchFiles(currentFolder.id, null, activeSearch);
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to rename item', 'error');
    } finally {
      setRenameLoading(false);
    }
  };

  // Move File / Folder
  const handleMoveConfirm = async (selectedDestFolder) => {
    if (!targetItemToMove || !selectedDestFolder) return;
    try {
      const res = await api.moveDriveFile(
        targetItemToMove.id,
        selectedDestFolder.id === 'root' ? 'root' : selectedDestFolder.id,
        currentFolder.id === 'root' ? undefined : currentFolder.id
      );
      if (res?.success) {
        showFeedback(`Moved "${targetItemToMove.name}" to "${selectedDestFolder.name}".`);
        setMoveModalOpen(false);
        setTargetItemToMove(null);
        fetchFiles(currentFolder.id, null, activeSearch);
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to move item', 'error');
    }
  };

  // Delete File / Folder
  const handleDeleteConfirm = async () => {
    if (!targetItemToDelete) return;
    setDeleteLoading(true);
    try {
      const res = await api.deleteDriveFile(targetItemToDelete.id);
      if (res?.success) {
        showFeedback(`Deleted "${targetItemToDelete.name}".`);
        setDeleteConfirmOpen(false);
        setTargetItemToDelete(null);
        fetchFiles(currentFolder.id, null, activeSearch);
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to delete item', 'error');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Share File
  const handleOpenShare = (item) => {
    setTargetItemToShare(item);
    setShareResult(null);
    setShareCopied(false);
    setShareModalOpen(true);
  };

  const handleGenerateShareLink = async () => {
    if (!targetItemToShare) return;
    setShareLoading(true);
    try {
      const res = await api.shareDriveFile(targetItemToShare.id);
      if (res?.success) {
        setShareResult(res);
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to create shareable link', 'error');
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyShareLink = () => {
    if (!shareResult?.shareLink) return;
    navigator.clipboard.writeText(shareResult.shareLink);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  // Set Default Folder
  const handleSetCurrentAsDefault = async () => {
    try {
      const res = await api.setDriveDefaultFolder(
        currentFolder.id === 'root' ? null : currentFolder.id,
        currentFolder.id === 'root' ? null : currentFolder.name
      );
      if (res?.success) {
        showFeedback(`Default recording folder set to "${currentFolder.name}".`);
        fetchStatus();
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to set default folder', 'error');
    }
  };

  const handleSetPickerAsDefault = async (folder) => {
    try {
      const res = await api.setDriveDefaultFolder(
        folder.id === 'root' ? null : folder.id,
        folder.id === 'root' ? null : folder.name
      );
      if (res?.success) {
        showFeedback(`Default recording folder set to "${folder.name}".`);
        setDefaultFolderPickerOpen(false);
        fetchStatus();
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to set default folder', 'error');
    }
  };

  // Delete Recording from QA history
  const handleDeleteRecordingConfirm = async () => {
    if (!deleteRecordingTarget) return;
    setDeleteRecordingLoading(true);
    try {
      const res = await api.deleteRecording(
        deleteRecordingTarget.recording_id || deleteRecordingTarget.id,
        deleteRecordingFromDrive
      );
      if (res?.success) {
        showFeedback(res.message || 'Recording deleted successfully.');
        setDeleteRecordingTarget(null);
        fetchRecordings();
      }
    } catch (err) {
      showFeedback(err.message || 'Failed to delete recording', 'error');
    } finally {
      setDeleteRecordingLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Toast Feedback Notification */}
      {feedbackMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-xl text-xs font-semibold animate-slideUp border ${
            feedbackMessage.type === 'error'
              ? 'bg-rose-950/90 border-rose-500/50 text-rose-200'
              : 'bg-[#14201A] border-emerald-500/50 text-emerald-300'
          }`}
        >
          {feedbackMessage.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{feedbackMessage.text}</span>
        </div>
      )}

      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#161B26]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-[#F59E0B]">
            <HardDrive className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              Google Drive Integration
              {status?.connected && (
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                  Connected
                </span>
              )}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Connect your Google Drive to store, manage, and share automated Android PAD test recordings.
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        {status?.connected && (
          <div className="flex items-center bg-[#090C12] border border-[#161B26] rounded-xl p-1 shrink-0">
            <button
              onClick={() => setActiveView('explorer')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'explorer'
                  ? 'bg-[#19150F] border border-[#78350F] text-[#F59E0B] shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Folder className="w-3.5 h-3.5" />
              <span>Drive Explorer</span>
            </button>
            <button
              onClick={() => setActiveView('recordings')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeView === 'recordings'
                  ? 'bg-[#19150F] border border-[#78350F] text-[#F59E0B] shadow-xs'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>QA Recordings</span>
            </button>
          </div>
        )}
      </div>

      {/* Connection & Quota Overview Card */}
      {statusLoading ? (
        <div className="bg-[#0D1017] border border-[#161B26] rounded-2xl p-6 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-[#F59E0B] mr-2" />
          <span className="text-xs">Checking Google Drive authorization status...</span>
        </div>
      ) : !status?.connected ? (
        <div className="bg-gradient-to-br from-[#0D1017] to-[#121622] border border-[#1E2638] rounded-2xl p-6 relative overflow-hidden shadow-lg">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="max-w-xl space-y-2">
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <span>Connect your Google Account</span>
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Link your Google Drive account to enable direct screen recording uploads from live device sessions,
                browse stored test captures, organize folders, and generate shareable links for QA reports.
              </p>
              <div className="flex flex-wrap gap-4 pt-2 text-[11px] text-slate-400">
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Encrypted token storage (AES-256-GCM)</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Automatic background token refresh</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Private per-user account isolation</span>
                </div>
              </div>
            </div>

            <button
              onClick={() => handleConnect()}
              disabled={connecting}
              className="flex items-center justify-center gap-2.5 px-6 py-3 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-black font-bold text-xs shadow-md transition-all shrink-0 cursor-pointer"
            >
              {connecting ? (
                <Loader2 className="w-4 h-4 animate-spin text-black" />
              ) : (
                <HardDrive className="w-4 h-4 text-black" />
              )}
              <span>{connecting ? 'Connecting...' : 'Connect Google Drive'}</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Scope Warning Banner if user previously authorized with restricted drive.file scope */}
          {status?.connected && status?.hasFullDriveScope === false && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm animate-fadeIn">
              <div className="flex items-start gap-3 min-w-0">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 min-w-0">
                  <h4 className="text-xs font-bold text-amber-300">
                    Additional Permissions Needed to Browse All Existing Folders
                  </h4>
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Your Google Drive account was connected with restricted application-only permissions (
                    <code className="text-amber-300/90 font-mono text-[10px]">drive.file</code>
                    ). To browse your pre-existing Drive folders and save recordings to any folder, please reconnect with full Drive permissions.
                  </p>
                </div>
              </div>
              <button
                onClick={() => handleConnect('consent')}
                disabled={connecting}
                className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-xs shadow transition-all shrink-0 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin text-black" /> : <HardDrive className="w-3.5 h-3.5 text-black" />}
                <span>Reconnect for Full Access</span>
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* User Account Card */}
          <div className="bg-[#0D1017] border border-[#161B26] rounded-2xl p-5 flex flex-col justify-between space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                {status.picture ? (
                  <img
                    src={status.picture}
                    alt={status.name || 'User'}
                    className="w-11 h-11 rounded-full border border-amber-500/40 object-cover shrink-0"
                  />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-[#F59E0B] font-bold text-sm shrink-0">
                    {status.name ? status.name.charAt(0).toUpperCase() : 'G'}
                  </div>
                )}
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">{status.name || 'Google User'}</div>
                  <div className="text-[11px] text-slate-400 truncate font-mono">{status.email}</div>
                  <div className="flex items-center gap-1 text-[10px] text-emerald-400 mt-1">
                    <UserCheck className="w-3 h-3" />
                    <span>OAuth Session Active</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-[#161B26]/60">
              <button
                onClick={() => handleConnect('select_account')}
                className="flex-1 px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1E2638] text-[11px] text-slate-300 hover:text-white font-medium border border-[#263248] transition-colors"
                title="Switch Google Account"
              >
                Switch Account
              </button>
              <button
                onClick={() => setDisconnectConfirmOpen(true)}
                className="px-3 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-[11px] text-rose-400 font-medium border border-rose-500/20 transition-colors flex items-center gap-1"
                title="Disconnect Google Drive"
              >
                <LogOut className="w-3 h-3" />
                <span>Disconnect</span>
              </button>
            </div>
          </div>

          {/* Storage Quota Card */}
          <div className="bg-[#0D1017] border border-[#161B26] rounded-2xl p-5 flex flex-col justify-between space-y-3">
            <div>
              <div className="flex items-center justify-between text-xs font-semibold text-slate-300 mb-1">
                <span className="flex items-center gap-1.5">
                  <HardDrive className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span>Storage Quota</span>
                </span>
                {quota?.limit && quota.limit > 0 && (
                  <span className="text-[11px] font-mono text-slate-400">
                    {Math.round((quota.usage / quota.limit) * 100)}% used
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">Google Drive storage consumption</p>
            </div>

            {quota ? (
              <div className="space-y-2">
                <div className="w-full h-2 rounded-full bg-[#161B26] overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full transition-all duration-500"
                    style={{
                      width: `${quota.limit > 0 ? Math.min(100, (quota.usage / quota.limit) * 100) : 0}%`
                    }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <span>Used: {formatBytes(quota.usage)}</span>
                  <span>Limit: {quota.limit > 0 ? formatBytes(quota.limit) : 'Unlimited'}</span>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-slate-500">Quota information unavailable</div>
            )}

            <div className="text-[10px] text-slate-500 font-mono truncate">
              Drive: {formatBytes(quota?.usageInDrive || 0)} &bull; Trash: {formatBytes(quota?.usageInDriveTrash || 0)}
            </div>
          </div>

          {/* Default Folder Card */}
          <div className="bg-[#0D1017] border border-[#161B26] rounded-2xl p-5 flex flex-col justify-between space-y-3">
            <div>
              <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 mb-1">
                <Folder className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>Default Upload Folder</span>
              </div>
              <p className="text-[11px] text-slate-500">Destination folder for screen recordings</p>
            </div>

            <div className="p-2.5 rounded-xl bg-[#080B10] border border-[#161B26] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                <span className="text-xs font-semibold text-white truncate">
                  {status.defaultFolderName || 'My Drive (Root)'}
                </span>
              </div>
              {status.defaultFolderId && (
                <span className="text-[10px] font-mono text-slate-500 uppercase px-1.5 py-0.5 rounded bg-[#161B26]">
                  Custom
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setDefaultFolderPickerOpen(true)}
                className="flex-1 px-3 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1E2638] text-[11px] text-slate-300 hover:text-white font-medium border border-[#263248] transition-colors"
              >
                Change Default Folder
              </button>
              {status.defaultFolderId && (
                <button
                  onClick={async () => {
                    await api.setDriveDefaultFolder(null, null);
                    showFeedback('Default folder reset to My Drive (Root)');
                    fetchStatus();
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-[#141824] hover:bg-[#1E2638] text-[11px] text-slate-400 hover:text-white transition-colors"
                  title="Reset to Root"
                >
                  Reset
                </button>
              )}
            </div>
          </div>
        </div>
        </div>
      )}

      {/* Explorer / Recordings Tab Content */}
      {status?.connected && activeView === 'explorer' && (
        <div className="bg-[#0D1017] border border-[#161B26] rounded-2xl overflow-hidden shadow-lg space-y-0">
          {/* Action & Filter Toolbar */}
          <div className="p-4 bg-[#111520] border-b border-[#161B26] flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Breadcrumb Navigation */}
            <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto text-xs no-scrollbar">
              {breadcrumbs.length > 1 && (
                <button
                  onClick={handleNavigateUp}
                  className="p-1.5 rounded-lg bg-[#161B26] hover:bg-[#202738] text-slate-300 hover:text-white shrink-0 mr-1 transition-colors"
                  title="Go to parent folder"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                </button>
              )}

              {breadcrumbs.map((crumb, idx) => {
                const isLast = idx === breadcrumbs.length - 1;
                return (
                  <React.Fragment key={crumb.id || idx}>
                    <button
                      onClick={() => handleBreadcrumbClick(idx)}
                      className={`shrink-0 hover:underline transition-colors ${
                        isLast ? 'font-bold text-[#F59E0B]' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {crumb.name}
                    </button>
                    {!isLast && <ChevronRight className="w-3.5 h-3.5 text-slate-600 shrink-0" />}
                  </React.Fragment>
                );
              })}
            </div>

            {/* Actions & Search */}
            <div className="flex items-center gap-2 shrink-0">
              {/* Search Form */}
              <form onSubmit={handleSearchSubmit} className="relative">
                <input
                  type="text"
                  placeholder="Search Drive files..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-44 md:w-56 bg-[#090C12] border border-[#222838] rounded-xl pl-8 pr-7 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
                />
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5 pointer-events-none" />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={handleClearSearch}
                    className="absolute right-2 top-2 text-slate-400 hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </form>

              {/* Set Current Folder as Default Button */}
              {currentFolder.id !== 'root' && (
                <button
                  onClick={handleSetCurrentAsDefault}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#161B26] hover:bg-[#202738] border border-[#263248] text-xs font-medium text-slate-300 hover:text-[#F59E0B] transition-colors"
                  title="Set this folder as the default recording destination"
                >
                  <Check className="w-3.5 h-3.5 text-[#F59E0B]" />
                  <span>Set as Default</span>
                </button>
              )}

              {/* New Folder Button */}
              <button
                onClick={() => {
                  setNewFolderName('');
                  setNewFolderModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#161B26] hover:bg-[#202738] border border-[#263248] text-xs font-medium text-slate-300 hover:text-white transition-colors"
              >
                <FolderPlus className="w-3.5 h-3.5 text-[#F59E0B]" />
                <span>New Folder</span>
              </button>

              {/* Refresh Button */}
              <button
                onClick={() => fetchFiles(currentFolder.id, null, activeSearch)}
                className="p-1.5 rounded-xl bg-[#161B26] hover:bg-[#202738] border border-[#263248] text-slate-400 hover:text-white transition-colors"
                title="Refresh current folder"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${filesLoading ? 'animate-spin text-[#F59E0B]' : ''}`} />
              </button>
            </div>
          </div>

          {/* Active Search Notification */}
          {activeSearch && (
            <div className="px-6 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-300 flex items-center justify-between">
              <span>Showing search results for &ldquo;{activeSearch}&rdquo;</span>
              <button onClick={handleClearSearch} className="underline text-xs hover:text-white">
                Clear search
              </button>
            </div>
          )}

          {/* Files Table / List */}
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#161B26] text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-[#090C12]">
                  <th className="py-3 px-5">Name</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Modified</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141824] text-xs">
                {filesLoading && files.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-14 text-center text-slate-500">
                      <Loader2 className="w-6 h-6 animate-spin text-[#F59E0B] mx-auto mb-2" />
                      <span>Loading Drive items...</span>
                    </td>
                  </tr>
                ) : filesError ? (
                  <tr>
                    <td colSpan={4} className="py-14 text-center">
                      <div className="max-w-md mx-auto space-y-3">
                        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
                        <div className="text-sm font-semibold text-rose-300">
                          Failed to load Google Drive items
                        </div>
                        <p className="text-xs text-slate-400 leading-relaxed font-mono">
                          {filesError}
                        </p>
                        <button
                          onClick={() => fetchFiles(currentFolder.id, null, activeSearch)}
                          className="px-4 py-2 rounded-xl bg-[#141824] hover:bg-[#1E2638] text-xs font-semibold text-white border border-[#263248] transition-colors inline-flex items-center gap-1.5"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Retry</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : files.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-14 text-center text-slate-500">
                      No files or folders found in &ldquo;{currentFolder.name}&rdquo;.
                    </td>
                  </tr>
                ) : (
                  files.map((item) => {
                    const isFolder = item.mimeType === 'application/vnd.google-apps.folder';
                    const isVideo = item.mimeType?.startsWith('video/') || item.name?.endsWith('.webm') || item.name?.endsWith('.mp4');

                    return (
                      <tr
                        key={item.id}
                        className="hover:bg-[#121622]/60 transition-colors group cursor-pointer"
                        onClick={() => {
                          if (isFolder) handleOpenFolder(item);
                          else if (item.webViewLink) window.open(item.webViewLink, '_blank');
                        }}
                      >
                        {/* Name Column */}
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-3 min-w-0">
                            {isFolder ? (
                              <Folder className="w-4 h-4 text-amber-400 shrink-0" />
                            ) : isVideo ? (
                              <Film className="w-4 h-4 text-rose-400 shrink-0" />
                            ) : (
                              <File className="w-4 h-4 text-slate-400 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <span className="font-medium text-slate-200 group-hover:text-white truncate block">
                                {item.name}
                              </span>
                              {item.id === status.defaultFolderId && (
                                <span className="inline-block mt-0.5 text-[9px] font-mono px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                  Default Upload Folder
                                </span>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Size Column */}
                        <td className="py-3 px-4 font-mono text-slate-400">
                          {isFolder ? '--' : formatBytes(item.size)}
                        </td>

                        {/* Modified Column */}
                        <td className="py-3 px-4 text-slate-400">
                          {formatDate(item.modifiedTime)}
                        </td>

                        {/* Actions Column */}
                        <td className="py-3 px-5 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            {item.webViewLink && (
                              <a
                                href={item.webViewLink}
                                target="_blank"
                                rel="noreferrer"
                                className="p-1.5 rounded-lg hover:bg-[#1C2230] text-slate-400 hover:text-white transition-colors"
                                title="Open in Google Drive"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}

                            <button
                              onClick={() => handleOpenShare(item)}
                              className="p-1.5 rounded-lg hover:bg-[#1C2230] text-slate-400 hover:text-[#F59E0B] transition-colors"
                              title="Create Shareable Link"
                            >
                              <Share2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => {
                                setTargetItemToRename(item);
                                setRenamedName(item.name);
                                setRenameModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg hover:bg-[#1C2230] text-slate-400 hover:text-white transition-colors"
                              title="Rename"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => {
                                setTargetItemToMove(item);
                                setMoveModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg hover:bg-[#1C2230] text-slate-400 hover:text-white transition-colors"
                              title="Move"
                            >
                              <FolderInput className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => {
                                setTargetItemToDelete(item);
                                setDeleteConfirmOpen(true);
                              }}
                              className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
                              title="Delete"
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

          {/* Pagination / Load More */}
          {nextPageToken && (
            <div className="p-4 border-t border-[#161B26] bg-[#090C12] text-center">
              <button
                onClick={() => fetchFiles(currentFolder.id, nextPageToken, activeSearch)}
                disabled={filesLoading}
                className="px-4 py-2 rounded-xl bg-[#141824] hover:bg-[#1E2638] text-xs font-semibold text-slate-300 hover:text-white transition-colors border border-[#263248]"
              >
                {filesLoading ? 'Loading more...' : 'Load More Files'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Recordings Tab Content */}
      {status?.connected && activeView === 'recordings' && (
        <div className="bg-[#0D1017] border border-[#161B26] rounded-2xl overflow-hidden shadow-lg">
          <div className="p-4 bg-[#111520] border-b border-[#161B26] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Film className="w-4 h-4 text-[#F59E0B]" />
              <h2 className="text-sm font-bold text-white">Stored Screen Recordings</h2>
              <span className="text-xs text-slate-400">({recordings.length} total)</span>
            </div>

            <button
              onClick={fetchRecordings}
              className="p-1.5 rounded-xl bg-[#161B26] hover:bg-[#202738] border border-[#263248] text-slate-400 hover:text-white transition-colors"
              title="Refresh recordings"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${recordingsLoading ? 'animate-spin text-[#F59E0B]' : ''}`} />
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#161B26] text-[11px] font-semibold text-slate-400 uppercase tracking-wider bg-[#090C12]">
                  <th className="py-3 px-5">Recording</th>
                  <th className="py-3 px-4">Device</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Size</th>
                  <th className="py-3 px-4">Recorded At</th>
                  <th className="py-3 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#141824] text-xs">
                {recordingsLoading && recordings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-14 text-center text-slate-500">
                      <Loader2 className="w-6 h-6 animate-spin text-[#F59E0B] mx-auto mb-2" />
                      <span>Loading test recordings...</span>
                    </td>
                  </tr>
                ) : recordings.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-14 text-center text-slate-500">
                      No screen recordings found. Record a session in Screen Mirror and save to Google Drive!
                    </td>
                  </tr>
                ) : (
                  recordings.map((rec) => (
                    <tr key={rec.id} className="hover:bg-[#121622]/60 transition-colors">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-3">
                          <Film className="w-4 h-4 text-[#F59E0B] shrink-0" />
                          <div className="min-w-0">
                            <span className="font-semibold text-white truncate block">
                              {rec.filename || rec.recording_id}
                            </span>
                            {rec.upload_status && (
                              <span
                                className={`text-[9px] uppercase font-mono px-1.5 py-0.2 rounded border ${
                                  rec.upload_status === 'COMPLETED'
                                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                    : rec.upload_status === 'FAILED'
                                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                                    : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                                }`}
                              >
                                {rec.upload_status}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-slate-300">
                        <div className="flex items-center gap-1.5">
                          <Smartphone className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                          <span className="truncate">{rec.device_name || rec.device_serial || '--'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono text-emerald-400">
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-emerald-500" />
                          <span>{rec.duration_sec ? `${rec.duration_sec}s` : '--'}</span>
                        </div>
                      </td>

                      <td className="py-3 px-4 font-mono text-slate-400">
                        {formatBytes(rec.size_bytes)}
                      </td>

                      <td className="py-3 px-4 text-slate-400">
                        {formatDate(rec.created_at)}
                      </td>

                      <td className="py-3 px-5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {rec.google_drive_web_view_link && (
                            <a
                              href={rec.google_drive_web_view_link}
                              target="_blank"
                              rel="noreferrer"
                              className="px-2.5 py-1 rounded-lg bg-[#141824] hover:bg-[#1E2638] text-[11px] font-medium text-slate-300 hover:text-white border border-[#263248] flex items-center gap-1 transition-colors"
                            >
                              <ExternalLink className="w-3 h-3" />
                              <span>View in Drive</span>
                            </a>
                          )}

                          <button
                            onClick={() => {
                              setDeleteRecordingTarget(rec);
                              setDeleteRecordingFromDrive(true);
                            }}
                            className="p-1.5 rounded-lg hover:bg-rose-500/10 text-slate-400 hover:text-rose-400 transition-colors"
                            title="Delete recording record"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- Modals --- */}

      {/* New Folder Modal */}
      {newFolderModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md bg-[#0D111A] border border-[#1E2638] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-[#F59E0B]" />
                <span>Create New Folder</span>
              </h3>
              <button
                onClick={() => setNewFolderModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[#1E2638] text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-2.5 rounded-xl bg-[#090C12] border border-[#1E2638] space-y-1">
              <span className="text-[10px] uppercase font-mono text-slate-500 block">Parent Destination</span>
              <div className="text-xs text-amber-400 font-medium flex items-center gap-1.5 truncate">
                <Folder className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                <span className="truncate">
                  {breadcrumbs.length > 0 ? breadcrumbs.map((b) => b.name).join(' > ') : currentFolder.name}
                </span>
              </div>
            </div>

            <form onSubmit={handleCreateFolder} className="space-y-4">
              <input
                type="text"
                autoFocus
                placeholder="Folder name"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="w-full bg-[#090C12] border border-[#263248] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
              />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setNewFolderModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newFolderName.trim() || newFolderLoading}
                  className="px-4 py-2 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-black font-bold text-xs shadow transition-colors flex items-center gap-1.5"
                >
                  {newFolderLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Create</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Modal */}
      {renameModalOpen && targetItemToRename && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md bg-[#0D111A] border border-[#1E2638] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-[#F59E0B]" />
                <span>Rename Item</span>
              </h3>
              <button
                onClick={() => setRenameModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[#1E2638] text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleRenameSubmit} className="space-y-4">
              <input
                type="text"
                autoFocus
                placeholder="New name"
                value={renamedName}
                onChange={(e) => setRenamedName(e.target.value)}
                className="w-full bg-[#090C12] border border-[#263248] rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
              />

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenameModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!renamedName.trim() || renameLoading}
                  className="px-4 py-2 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-black font-bold text-xs shadow transition-colors flex items-center gap-1.5"
                >
                  {renameLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Item Confirmation Modal */}
      {deleteConfirmOpen && targetItemToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md bg-[#0D111A] border border-rose-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete Google Drive Item?</h3>
                <p className="text-xs text-slate-400 truncate max-w-[260px]">{targetItemToDelete.name}</p>
              </div>
            </div>

            <p className="text-xs text-slate-400">
              Are you sure you want to delete this item? It will be removed from your Google Drive.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteConfirmOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleteLoading}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs shadow transition-colors flex items-center gap-1.5"
              >
                {deleteLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Modal (Explicit Permissions Warning) */}
      {shareModalOpen && targetItemToShare && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-lg bg-[#0D111A] border border-[#1E2638] rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-[#F59E0B]">
                  <Share2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Share File</h3>
                  <p className="text-xs text-slate-400 truncate max-w-[280px]">{targetItemToShare.name}</p>
                </div>
              </div>
              <button
                onClick={() => setShareModalOpen(false)}
                className="p-1 rounded-lg hover:bg-[#1E2638] text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Explicit Privacy Notice */}
            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-2.5 text-xs text-amber-200">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <span className="font-semibold block">Public Link Visibility</span>
                <p className="text-[11px] text-amber-200/90 leading-relaxed">
                  Generating a shareable link grants read-only view access to anyone with the link.
                  This should only be done for QA screen recordings and test assets intended for collaboration.
                </p>
              </div>
            </div>

            {!shareResult ? (
              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={() => setShareModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-slate-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleGenerateShareLink}
                  disabled={shareLoading}
                  className="px-4 py-2 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-black font-bold text-xs shadow transition-colors flex items-center gap-1.5"
                >
                  {shareLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>Generate Shareable Link</span>
                </button>
              </div>
            ) : (
              <div className="space-y-3 pt-2">
                <label className="text-[11px] font-semibold text-slate-400 block">Shareable Link</label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={shareResult.shareLink || ''}
                    className="flex-1 bg-[#090C12] border border-[#263248] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none"
                  />
                  <button
                    onClick={handleCopyShareLink}
                    className="px-3.5 py-2 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-black font-bold text-xs flex items-center gap-1.5 transition-colors shrink-0"
                  >
                    {shareCopied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{shareCopied ? 'Copied!' : 'Copy'}</span>
                  </button>
                </div>
                <div className="flex justify-end pt-2">
                  <button
                    onClick={() => setShareModalOpen(false)}
                    className="px-4 py-1.5 rounded-xl bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-white transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Disconnect Google Drive Modal */}
      {disconnectConfirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md bg-[#0D111A] border border-rose-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <LogOut className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Disconnect Google Drive?</h3>
                <p className="text-xs text-slate-400">{status.email}</p>
              </div>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Disconnecting will revoke QA Platform&apos;s access and purge stored OAuth tokens for your account.
              Your existing files in Google Drive will remain untouched.
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDisconnectConfirmOpen(false)}
                className="px-4 py-2 rounded-xl bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs shadow transition-colors flex items-center gap-1.5"
              >
                {disconnecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Disconnect</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Recording Confirmation Modal */}
      {deleteRecordingTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-md bg-[#0D111A] border border-rose-500/30 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white">Delete Screen Recording?</h3>
                <p className="text-xs text-slate-400 truncate max-w-[260px]">
                  {deleteRecordingTarget.filename || deleteRecordingTarget.recording_id}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-xs text-slate-400">
                Remove this recording from the QA platform history.
              </p>

              {deleteRecordingTarget.google_drive_file_id && (
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer p-2.5 rounded-xl bg-[#090C12] border border-[#1E2638]">
                  <input
                    type="checkbox"
                    checked={deleteRecordingFromDrive}
                    onChange={(e) => setDeleteRecordingFromDrive(e.target.checked)}
                    className="accent-[#F59E0B] rounded"
                  />
                  <span>Also permanently delete file from Google Drive</span>
                </label>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setDeleteRecordingTarget(null)}
                className="px-4 py-2 rounded-xl bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-slate-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteRecordingConfirm}
                disabled={deleteRecordingLoading}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white font-bold text-xs shadow transition-colors flex items-center gap-1.5"
              >
                {deleteRecordingLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>Delete</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Move File Folder Selector Modal */}
      <DriveFolderSelectorModal
        isOpen={moveModalOpen}
        onClose={() => {
          setMoveModalOpen(false);
          setTargetItemToMove(null);
        }}
        onSelectFolder={handleMoveConfirm}
        title={`Move "${targetItemToMove?.name || 'Item'}" to Folder`}
      />

      {/* Change Default Folder Picker Modal */}
      <DriveFolderSelectorModal
        isOpen={defaultFolderPickerOpen}
        onClose={() => setDefaultFolderPickerOpen(false)}
        onSelectFolder={handleSetPickerAsDefault}
        title="Set Default Screen Recording Folder"
      />
    </div>
  );
}
