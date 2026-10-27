import React, { useState, useEffect, useCallback } from 'react';
import {
  Folder,
  FolderPlus,
  ChevronRight,
  ArrowLeft,
  Check,
  X,
  Loader2,
  AlertCircle,
  HardDrive
} from 'lucide-react';
import { api } from '../services/api';

export default function DriveFolderSelectorModal({
  isOpen,
  onClose,
  onSelectFolder,
  initialFolderId = 'root',
  initialFolderName = 'My Drive',
  title = 'Select Google Drive Folder'
}) {
  const [currentFolder, setCurrentFolder] = useState({ id: initialFolderId || 'root', name: initialFolderName || 'My Drive' });
  const [breadcrumbs, setBreadcrumbs] = useState([{ id: initialFolderId || 'root', name: initialFolderName || 'My Drive' }]);
  const [folders, setFolders] = useState([]);
  const [selectedFolder, setSelectedFolder] = useState({ id: initialFolderId || 'root', name: initialFolderName || 'My Drive' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // New folder creation state
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState(null);

  // Reset when modal opens
  useEffect(() => {
    if (isOpen) {
      setError(null);
      setIsCreatingFolder(false);
      setNewFolderName('');
      const defaultRoot = { id: 'root', name: 'My Drive', path: 'My Drive' };

      if (initialFolderId && initialFolderId !== 'root') {
        api.getDriveFolderBreadcrumbs(initialFolderId)
          .then((res) => {
            if (res?.success && res.breadcrumbs?.length > 0) {
              const crumbs = res.breadcrumbs;
              const current = crumbs[crumbs.length - 1];
              const fullPath = crumbs.map((b) => b.name).join(' > ');
              setCurrentFolder(current);
              setBreadcrumbs(crumbs);
              setSelectedFolder({ ...current, path: fullPath });
            } else {
              const fallback = { id: initialFolderId, name: initialFolderName || 'Folder', path: initialFolderName || 'Folder' };
              setCurrentFolder(fallback);
              setBreadcrumbs([defaultRoot, fallback]);
              setSelectedFolder(fallback);
            }
          })
          .catch(() => {
            setCurrentFolder(defaultRoot);
            setBreadcrumbs([defaultRoot]);
            setSelectedFolder(defaultRoot);
          });
      } else {
        setCurrentFolder(defaultRoot);
        setBreadcrumbs([defaultRoot]);
        setSelectedFolder(defaultRoot);
      }
    }
  }, [isOpen, initialFolderId, initialFolderName]);

  const fetchFolders = useCallback(async (folderId) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listDriveFiles({
        folderId: folderId || 'root',
        fileType: 'folder',
        pageSize: 100
      });
      if (res?.success) {
        setFolders(res.files || []);
      } else {
        throw new Error(res?.error || 'Failed to list folders');
      }
    } catch (err) {
      console.error('[DriveFolderSelector] Load folders error:', err);
      setError(err.message || 'Could not load folders from Google Drive');
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && currentFolder?.id) {
      fetchFolders(currentFolder.id);
    }
  }, [isOpen, currentFolder, fetchFolders]);

  const handleNavigateDown = (folder) => {
    const nextItem = { id: folder.id, name: folder.name };
    const nextBreadcrumbs = [...breadcrumbs, nextItem];
    const fullPath = nextBreadcrumbs.map((b) => b.name).join(' > ');
    setCurrentFolder(nextItem);
    setSelectedFolder({ ...nextItem, path: fullPath });
    setBreadcrumbs(nextBreadcrumbs);
  };

  const handleNavigateBreadcrumb = (index) => {
    if (index === breadcrumbs.length - 1) return;
    const nextBreadcrumbs = breadcrumbs.slice(0, index + 1);
    const target = nextBreadcrumbs[nextBreadcrumbs.length - 1];
    const fullPath = nextBreadcrumbs.map((b) => b.name).join(' > ');
    setBreadcrumbs(nextBreadcrumbs);
    setCurrentFolder(target);
    setSelectedFolder({ ...target, path: fullPath });
  };

  const handleNavigateUp = () => {
    if (breadcrumbs.length <= 1) return;
    handleNavigateBreadcrumb(breadcrumbs.length - 2);
  };

  const handleCreateFolder = async (e) => {
    e.preventDefault();
    const trimmed = newFolderName.trim();
    if (!trimmed) return;

    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await api.createDriveFolder(trimmed, currentFolder.id === 'root' ? undefined : currentFolder.id);
      if (res?.success && res.folder) {
        setNewFolderName('');
        setIsCreatingFolder(false);
        // Refresh folder list
        await fetchFolders(currentFolder.id);
        // Select the newly created folder with full path
        const fullPath = `${breadcrumbs.map((b) => b.name).join(' > ')} > ${res.folder.name}`;
        setSelectedFolder({ id: res.folder.id, name: res.folder.name, path: fullPath });
      } else {
        throw new Error(res?.error || 'Failed to create folder');
      }
    } catch (err) {
      setCreateError(err.message || 'Failed to create folder');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleConfirm = () => {
    if (onSelectFolder && selectedFolder) {
      onSelectFolder(selectedFolder);
    }
    if (onClose) onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fadeIn">
      <div className="relative w-full max-w-lg glass border border-[var(--line)] rounded-card shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[var(--line)] bg-white/40 dark:bg-[#131924] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl brand-mark flex items-center justify-center text-white shadow-sm shrink-0">
              <HardDrive className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="font-extrabold text-sm text-[#1F2544] dark:text-[#FFFFFF] font-sans">{title}</h3>
              <p className="text-[11px] text-[#6B7194] dark:text-[#94A3B8]">Browse and choose destination folder</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#6B7194] hover:text-[#1F2544] dark:text-[#94A3B8] dark:hover:text-[#FFFFFF] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Breadcrumb Navigation Bar */}
        <div className="px-6 py-3 bg-white/30 dark:bg-[#0A0D14] border-b border-[var(--line)] flex items-center justify-between gap-2 overflow-x-auto text-xs">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
            {breadcrumbs.length > 1 && (
              <button
                onClick={handleNavigateUp}
                className="p-1 rounded-btn btn-soft text-[#6B7194] hover:text-[#1F2544] dark:text-[#94A3B8] dark:hover:text-[#FFFFFF] shrink-0 mr-1 cursor-pointer"
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
                    onClick={() => handleNavigateBreadcrumb(idx)}
                    className={`shrink-0 hover:underline transition-colors cursor-pointer ${
                      isLast ? 'font-bold text-[#7c6cf6] dark:text-violet-400' : 'text-[#6B7194] hover:text-[#1F2544] dark:text-[#94A3B8] dark:hover:text-white font-medium'
                    }`}
                  >
                    {crumb.name}
                  </button>
                  {!isLast && <ChevronRight className="w-3.5 h-3.5 text-[#6B7194]/60 shrink-0" />}
                </React.Fragment>
              );
            })}
          </div>

          {!isCreatingFolder && (
            <button
              onClick={() => setIsCreatingFolder(true)}
              className="flex items-center gap-1 px-3 py-1.5 rounded-btn btn-soft text-[#1F2544] hover:text-[#7c6cf6] dark:text-[#CBD5E1] dark:hover:text-violet-400 text-xs font-bold transition-colors shrink-0 cursor-pointer"
              title="Create new subfolder here"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#7c6cf6]" />
              <span>New Folder</span>
            </button>
          )}
        </div>

        {/* Inline Create Folder Input */}
        {isCreatingFolder && (
          <form onSubmit={handleCreateFolder} className="px-6 py-3 bg-white/50 dark:bg-[#131924]/60 border-b border-[var(--line)] flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                placeholder="Folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="flex-1 bg-white/70 dark:bg-[#090C12] border border-[var(--line)] rounded-xl px-3.5 py-1.5 text-xs text-[#1F2544] dark:text-white placeholder-[#6B7194] focus:outline-none focus:border-[#7c6cf6] shadow-xs"
              />
              <button
                type="submit"
                disabled={!newFolderName.trim() || createLoading}
                className="btn-magic px-3.5 py-1.5 rounded-btn disabled:opacity-50 text-white font-bold text-xs shadow-magic transition-all flex items-center gap-1 cursor-pointer"
              >
                {createLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Create</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsCreatingFolder(false);
                  setNewFolderName('');
                  setCreateError(null);
                }}
                className="p-1.5 rounded-lg text-[#6B7194] hover:text-[#1F2544] dark:text-[#94A3B8] dark:hover:text-white cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {createError && (
              <div className="text-[11px] text-rose-500 font-medium flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                <span>{createError}</span>
              </div>
            )}
          </form>
        )}

        {/* Folder List Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-1.5 min-h-[220px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#6B7194]">
              <Loader2 className="w-6 h-6 animate-spin text-[#7c6cf6] dark:text-violet-400 mb-2" />
              <span className="text-xs font-medium">Loading Google Drive folders...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-10 text-rose-500 px-4 text-center">
              <AlertCircle className="w-6 h-6 mb-2" />
              <span className="text-xs font-medium">{error}</span>
              <button
                onClick={() => fetchFolders(currentFolder.id)}
                className="mt-3 px-3.5 py-1.5 rounded-btn btn-soft text-xs font-bold transition-colors cursor-pointer"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Option to select current folder itself */}
              <div
                onClick={() => {
                  const fullPath = breadcrumbs.map((b) => b.name).join(' > ');
                  setSelectedFolder({ id: currentFolder.id, name: currentFolder.name, path: fullPath });
                }}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all border ${
                  selectedFolder?.id === currentFolder.id
                    ? 'bg-[#7c6cf6]/10 border-[#7c6cf6]/40 text-[#7c6cf6] dark:bg-violet-500/15 dark:border-violet-500/40 dark:text-violet-300'
                    : 'bg-white/40 hover:bg-white/70 border-transparent text-[#1F2544] dark:bg-[#090C12]/50 dark:hover:bg-[#131924] dark:text-[#94A3B8]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Folder className="w-4 h-4 text-[#7c6cf6] dark:text-violet-400 shrink-0" />
                  <span className="text-xs font-bold truncate">
                    Current: {currentFolder.name} (Save directly here)
                  </span>
                </div>
                {selectedFolder?.id === currentFolder.id && (
                  <Check className="w-4 h-4 text-[#7c6cf6] dark:text-violet-400 shrink-0" />
                )}
              </div>

              {/* Subfolders list */}
              {folders.length === 0 ? (
                <div className="text-center py-8 text-[#6B7194] text-xs font-medium">
                  No subfolders found inside &ldquo;{currentFolder.name}&rdquo;.
                </div>
              ) : (
                folders.map((folder) => {
                  const isSelected = selectedFolder?.id === folder.id;
                  const folderPath = `${breadcrumbs.map((b) => b.name).join(' > ')} > ${folder.name}`;
                  return (
                    <div
                      key={folder.id}
                      onClick={() => setSelectedFolder({ id: folder.id, name: folder.name, path: folderPath })}
                      onDoubleClick={() => handleNavigateDown(folder)}
                      className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl cursor-pointer transition-all border group ${
                        isSelected
                          ? 'bg-[#7c6cf6]/10 border-[#7c6cf6]/40 text-[#7c6cf6] dark:bg-violet-500/15 dark:border-violet-500/40 dark:text-violet-300'
                          : 'bg-white/60 hover:bg-white border-[var(--line)] text-[#1F2544] dark:bg-[#0E121B] dark:hover:bg-[#161B26] dark:border-[#1C2230] dark:text-[#CBD5E1]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <Folder className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#7c6cf6] dark:text-violet-400' : 'text-violet-400/70'}`} />
                        <span className="text-xs font-semibold truncate">{folder.name}</span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNavigateDown(folder);
                          }}
                          className="px-2.5 py-1 rounded-btn btn-soft text-[11px] font-bold text-[#1F2544] dark:text-slate-300 transition-colors cursor-pointer"
                          title="Open folder"
                        >
                          Open &rarr;
                        </button>
                        {isSelected && <Check className="w-4 h-4 text-[#7c6cf6] dark:text-violet-400" />}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-white/50 dark:bg-[#131924] border-t border-[var(--line)] flex items-center justify-between gap-3">
          <div className="text-xs text-[#6B7194] min-w-0 flex-1 mr-2">
            <span className="text-[10px] text-[#6B7194] block uppercase font-bold tracking-wider">Selected Destination:</span>
            <span className="font-extrabold text-[#1F2544] dark:text-white truncate block text-xs">
              {selectedFolder?.path || selectedFolder?.name || 'My Drive'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-btn btn-soft text-xs font-bold text-[#6B7194] hover:text-[#1F2544] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedFolder}
              className="btn-magic px-5 py-2 rounded-btn disabled:opacity-50 text-xs font-bold text-white shadow-magic transition-all cursor-pointer"
            >
              Select Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
