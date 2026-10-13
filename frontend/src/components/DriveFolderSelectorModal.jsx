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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
      <div className="relative w-full max-w-lg bg-[#0D111A] border border-[#1E2638] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#1E2638] bg-[#131924] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-[#F59E0B]">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-[#FFFFFF]">{title}</h3>
              <p className="text-[11px] text-[#94A3B8]">Browse and choose destination folder</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#1E2638] text-[#94A3B8] hover:text-[#FFFFFF] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Breadcrumb Navigation Bar */}
        <div className="px-6 py-3 bg-[#0A0D14] border-b border-[#1E2638] flex items-center justify-between gap-2 overflow-x-auto text-xs">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-x-auto no-scrollbar">
            {breadcrumbs.length > 1 && (
              <button
                onClick={handleNavigateUp}
                className="p-1 rounded hover:bg-[#1E2638] text-[#94A3B8] hover:text-[#FFFFFF] shrink-0 mr-1"
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
                    className={`shrink-0 hover:underline transition-colors ${
                      isLast ? 'font-bold text-[#F59E0B]' : 'text-[#94A3B8] hover:text-white'
                    }`}
                  >
                    {crumb.name}
                  </button>
                  {!isLast && <ChevronRight className="w-3.5 h-3.5 text-[#475569] shrink-0" />}
                </React.Fragment>
              );
            })}
          </div>

          {!isCreatingFolder && (
            <button
              onClick={() => setIsCreatingFolder(true)}
              className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#161B26] hover:bg-[#1E2638] text-[#CBD5E1] hover:text-[#F59E0B] border border-[#263248] text-xs font-medium transition-colors shrink-0"
              title="Create new subfolder here"
            >
              <FolderPlus className="w-3.5 h-3.5" />
              <span>New Folder</span>
            </button>
          )}
        </div>

        {/* Inline Create Folder Input */}
        {isCreatingFolder && (
          <form onSubmit={handleCreateFolder} className="px-6 py-3 bg-[#131924]/60 border-b border-[#1E2638] flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                autoFocus
                placeholder="Folder name..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                className="flex-1 bg-[#090C12] border border-[#263248] rounded-lg px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#F59E0B]"
              />
              <button
                type="submit"
                disabled={!newFolderName.trim() || createLoading}
                className="px-3 py-1.5 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-black font-semibold text-xs transition-colors flex items-center gap-1"
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
                className="p-1.5 rounded-lg hover:bg-[#1E2638] text-[#94A3B8] hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            {createError && (
              <div className="text-[11px] text-rose-400 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" />
                <span>{createError}</span>
              </div>
            )}
          </form>
        )}

        {/* Folder List Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-1 min-h-[220px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin text-[#F59E0B] mb-2" />
              <span className="text-xs">Loading Google Drive folders...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-10 text-rose-400 px-4 text-center">
              <AlertCircle className="w-6 h-6 mb-2" />
              <span className="text-xs">{error}</span>
              <button
                onClick={() => fetchFolders(currentFolder.id)}
                className="mt-3 px-3 py-1 bg-[#1E2638] hover:bg-[#263248] text-white text-xs rounded-md transition-colors"
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
                    ? 'bg-amber-500/15 border-amber-500/40 text-[#F59E0B]'
                    : 'bg-[#090C12]/50 hover:bg-[#131924] border-transparent text-[#94A3B8]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Folder className="w-4 h-4 text-[#F59E0B] shrink-0" />
                  <span className="text-xs font-semibold truncate">
                    Current: {currentFolder.name} (Save directly here)
                  </span>
                </div>
                {selectedFolder?.id === currentFolder.id && (
                  <Check className="w-4 h-4 text-[#F59E0B] shrink-0" />
                )}
              </div>

              {/* Subfolders list */}
              {folders.length === 0 ? (
                <div className="text-center py-8 text-slate-500 text-xs">
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
                          ? 'bg-amber-500/15 border-amber-500/40 text-[#F59E0B]'
                          : 'bg-[#0E121B] hover:bg-[#161B26] border-[#1C2230] text-[#CBD5E1]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <Folder className={`w-4 h-4 shrink-0 ${isSelected ? 'text-[#F59E0B]' : 'text-amber-400/70'}`} />
                        <span className="text-xs font-medium truncate">{folder.name}</span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleNavigateDown(folder);
                          }}
                          className="px-2 py-1 rounded text-[11px] bg-[#1E2638] hover:bg-[#263248] text-slate-300 hover:text-white transition-colors"
                          title="Open folder"
                        >
                          Open &rarr;
                        </button>
                        {isSelected && <Check className="w-4 h-4 text-[#F59E0B]" />}
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#131924] border-t border-[#1E2638] flex items-center justify-between gap-3">
          <div className="text-xs text-slate-400 min-w-0 flex-1 mr-2">
            <span className="text-[10px] text-slate-500 block uppercase font-mono">Selected Destination:</span>
            <span className="font-semibold text-white truncate block text-xs">
              {selectedFolder?.path || selectedFolder?.name || 'My Drive'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-[#1E2638] hover:bg-[#263248] text-xs font-semibold text-[#94A3B8] hover:text-[#FFFFFF] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedFolder}
              className="px-4 py-2 rounded-lg bg-[#F59E0B] hover:bg-[#D97706] disabled:opacity-50 text-xs font-bold text-[#000000] shadow transition-colors"
            >
              Select Folder
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
