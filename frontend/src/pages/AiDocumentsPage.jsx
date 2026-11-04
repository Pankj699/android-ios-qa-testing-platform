import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FileText,
  UploadCloud,
  RefreshCw,
  Search,
  Download,
  Eye,
  Trash2,
  Plus,
  FolderPlus,
  History,
  AlertCircle,
  CheckCircle2,
  X,
  FileCode,
  FileSpreadsheet,
  Layers,
  Copy,
  Check,
  Clock,
  ChevronDown,
  ExternalLink,
  ShieldAlert,
  Loader2,
  Sparkles,
  AlertTriangle,
  SlidersHorizontal
} from 'lucide-react';
import { api } from '../services/api';
import Tooltip from '../components/ui/Tooltip';
import { toast } from '../utils/toast';

const ALLOWED_EXTENSIONS = ['pdf', 'docx', 'xlsx', 'csv', 'txt'];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB

function formatBytes(bytes) {
  if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
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

function getFormatBadge(type) {
  const t = (type || '').toUpperCase();
  switch (t) {
    case 'PDF':
      return {
        bg: 'bg-rose-500/10 text-rose-500 dark:bg-rose-500/20 dark:text-rose-400 border-rose-500/20',
        label: 'PDF',
        icon: FileText
      };
    case 'DOCX':
      return {
        bg: 'bg-blue-500/10 text-blue-500 dark:bg-blue-500/20 dark:text-blue-400 border-blue-500/20',
        label: 'DOCX',
        icon: FileText
      };
    case 'XLSX':
      return {
        bg: 'bg-emerald-500/10 text-emerald-500 dark:bg-emerald-500/20 dark:text-emerald-400 border-emerald-500/20',
        label: 'XLSX',
        icon: FileSpreadsheet
      };
    case 'CSV':
      return {
        bg: 'bg-teal-500/10 text-teal-500 dark:bg-teal-500/20 dark:text-teal-400 border-teal-500/20',
        label: 'CSV',
        icon: FileSpreadsheet
      };
    case 'TXT':
    default:
      return {
        bg: 'bg-slate-500/10 text-slate-600 dark:bg-slate-500/20 dark:text-slate-300 border-slate-500/20',
        label: t || 'TXT',
        icon: FileCode
      };
  }
}

export default function AiDocumentsPage({ currentUser }) {
  // State: Projects
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    return localStorage.getItem('qa_ai_active_project_id') || '';
  });
  const [projectsLoading, setProjectsLoading] = useState(true);

  // State: Documents
  const [documents, setDocuments] = useState([]);
  const [documentsLoading, setDocumentsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState('ALL');

  // State: Create Project Modal
  const [createProjectModalOpen, setCreateProjectModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectSlug, setNewProjectSlug] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);

  // State: Upload Document Modal / Drag & Drop
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef(null);

  // State: Version History Modal
  const [versionModalOpen, setVersionModalOpen] = useState(false);
  const [activeDocForVersions, setActiveDocForVersions] = useState(null);
  const [activatingVersionId, setActivatingVersionId] = useState(null);

  // State: Upload New Version Modal
  const [newVersionModalOpen, setNewVersionModalOpen] = useState(false);
  const [targetDocForNewVersion, setTargetDocForNewVersion] = useState(null);
  const [newVersionFile, setNewVersionFile] = useState(null);
  const [newVersionSummary, setNewVersionSummary] = useState('');
  const [uploadingVersion, setUploadingVersion] = useState(false);
  const versionFileInputRef = useRef(null);

  // State: Preview Modal
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState(null);
  const [previewTextContent, setPreviewTextContent] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copiedHash, setCopiedHash] = useState(null);

  // State: Delete Document Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // State: Extracted Content Viewer Modal
  const [extractionModalOpen, setExtractionModalOpen] = useState(false);
  const [activeDocForExtraction, setActiveDocForExtraction] = useState(null);
  const [activeVersionForExtraction, setActiveVersionForExtraction] = useState(null);
  const [extractedUnits, setExtractedUnits] = useState([]);
  const [unitsLoading, setUnitsLoading] = useState(false);
  const [unitsPagination, setUnitsPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 });
  const [unitsSearch, setUnitsSearch] = useState('');
  const [unitsSourceType, setUnitsSourceType] = useState('ALL');
  const [activeExtractionDetails, setActiveExtractionDetails] = useState(null);
  const [reprocessingId, setReprocessingId] = useState(null);
  const [copiedUnitId, setCopiedUnitId] = useState(null);

  // State: Modal 8 Chunks & Embeddings Viewer
  const [chunksModalOpen, setChunksModalOpen] = useState(false);
  const [activeDocForChunks, setActiveDocForChunks] = useState(null);
  const [activeVersionForChunks, setActiveVersionForChunks] = useState(null);
  const [chunksList, setChunksList] = useState([]);
  const [chunksLoading, setChunksLoading] = useState(false);
  const [chunksSearch, setChunksSearch] = useState('');
  const [chunksTotalCount, setChunksTotalCount] = useState(0);
  const [selectedChunkId, setSelectedChunkId] = useState(null);
  const [selectedChunkDetail, setSelectedChunkDetail] = useState(null);
  const [chunkDetailLoading, setChunkDetailLoading] = useState(false);
  const [indexingInFlightId, setIndexingInFlightId] = useState(null);
  const [copiedChunkId, setCopiedChunkId] = useState(null);
  const [activeIndexingDetails, setActiveIndexingDetails] = useState(null);

  // State: Modal 9 Knowledge Retrieval Playground (Phase 2.6)
  const [retrievalModalOpen, setRetrievalModalOpen] = useState(false);
  const [retrievalQuery, setRetrievalQuery] = useState('');
  const [retrievalMode, setRetrievalMode] = useState('HYBRID');
  const [retrievalLimit, setRetrievalLimit] = useState(10);
  const [retrievalCandidateLimit, setRetrievalCandidateLimit] = useState(50);
  const [retrievalDocFilter, setRetrievalDocFilter] = useState('');
  const [retrievalSemanticWeight, setRetrievalSemanticWeight] = useState(1.0);
  const [retrievalKeywordWeight, setRetrievalKeywordWeight] = useState(1.0);
  const [retrievalRrfK, setRetrievalRrfK] = useState(60);
  const [retrievalFallback, setRetrievalFallback] = useState(true);
  const [retrievalResults, setRetrievalResults] = useState([]);
  const [retrievalDiagnostics, setRetrievalDiagnostics] = useState(null);
  const [retrievalLoading, setRetrievalLoading] = useState(false);
  const [selectedRetrievalItem, setSelectedRetrievalItem] = useState(null);
  const [showAdvancedTuning, setShowAdvancedTuning] = useState(false);
  const [copiedCitationId, setCopiedCitationId] = useState(null);

  // 1. Load Projects on Mount
  const loadProjects = useCallback(async () => {
    try {
      setProjectsLoading(true);
      const res = await api.getAiProjects();
      const list = res.data || [];
      setProjects(list);

      // Auto-select stored project or fallback to first project
      if (list.length > 0) {
        const stored = localStorage.getItem('qa_ai_active_project_id');
        const match = list.find((p) => p.id === stored);
        if (match) {
          setSelectedProjectId(match.id);
        } else {
          setSelectedProjectId(list[0].id);
          localStorage.setItem('qa_ai_active_project_id', list[0].id);
        }
      } else {
        setSelectedProjectId('');
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load AI projects.');
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // 2. Load Documents when selectedProjectId changes
  const loadDocuments = useCallback(async () => {
    if (!selectedProjectId) {
      setDocuments([]);
      return;
    }
    try {
      setDocumentsLoading(true);
      const res = await api.getAiDocuments(selectedProjectId);
      setDocuments(res.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load project documents.');
    } finally {
      setDocumentsLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId) {
      loadDocuments();
    }
  }, [selectedProjectId, loadDocuments]);

  // Handle Project Change
  const handleSelectProject = (projectId) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('qa_ai_active_project_id', projectId);
  };

  // Handle Create Project
  const handleCreateProject = async (e) => {
    e.preventDefault();
    if (!newProjectName.trim()) {
      toast.error('Project name is required.');
      return;
    }
    const slug = newProjectSlug.trim() || newProjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    try {
      setCreatingProject(true);
      const res = await api.createAiProject({
        name: newProjectName.trim(),
        slug,
        description: newProjectDesc.trim() || undefined
      });
      toast.success(`Project "${res.data.name}" created successfully.`);
      setCreateProjectModalOpen(false);
      setNewProjectName('');
      setNewProjectSlug('');
      setNewProjectDesc('');
      await loadProjects();
      setSelectedProjectId(res.data.id);
      localStorage.setItem('qa_ai_active_project_id', res.data.id);
    } catch (err) {
      toast.error(err.message || 'Failed to create project.');
    } finally {
      setCreatingProject(false);
    }
  };

  // Handle File Selection for Upload
  const handleFileChange = (file) => {
    if (!file) return;

    const ext = file.name.split('.').pop().toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      toast.error(`Unsupported format ".${ext}". Allowed: PDF, DOCX, XLSX, CSV, TXT.`);
      return;
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(`File size (${(file.size / (1024 * 1024)).toFixed(2)} MB) exceeds 25 MB limit.`);
      return;
    }

    setUploadFile(file);
    if (!uploadTitle.trim()) {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
      setUploadTitle(cleanName);
    }
  };

  // Handle Upload Submission
  const handleUploadSubmit = async (e) => {
    e.preventDefault();
    if (!uploadFile) {
      toast.error('Please choose a file to upload.');
      return;
    }
    if (!selectedProjectId) {
      toast.error('Please select an active project first.');
      return;
    }

    const formData = new FormData();
    formData.append('file', uploadFile);
    if (uploadTitle.trim()) {
      formData.append('title', uploadTitle.trim());
    }

    try {
      setUploading(true);
      const res = await api.uploadAiDocument(selectedProjectId, formData);
      toast.success(`Document "${res.data.title}" uploaded successfully.`);
      setUploadModalOpen(false);
      setUploadFile(null);
      setUploadTitle('');
      if (fileInputRef.current) fileInputRef.current.value = '';
      await loadDocuments();
    } catch (err) {
      if (err.code === 'DUPLICATE_DOCUMENT' || err.status === 409) {
        toast.error('A document with identical content already exists in this project.');
      } else {
        toast.error(err.message || 'Failed to upload document.');
      }
    } finally {
      setUploading(false);
    }
  };

  // Handle Upload New Version
  const handleUploadVersionSubmit = async (e) => {
    e.preventDefault();
    if (!newVersionFile || !targetDocForNewVersion) {
      toast.error('Please select an updated file.');
      return;
    }

    const formData = new FormData();
    formData.append('file', newVersionFile);
    if (newVersionSummary.trim()) {
      formData.append('changeSummary', newVersionSummary.trim());
    }

    try {
      setUploadingVersion(true);
      await api.uploadAiDocumentVersion(selectedProjectId, targetDocForNewVersion.id, formData);
      toast.success(`Version ${targetDocForNewVersion.version_number + 1} uploaded and activated.`);
      setNewVersionModalOpen(false);
      setNewVersionFile(null);
      setNewVersionSummary('');
      setTargetDocForNewVersion(null);
      await loadDocuments();
    } catch (err) {
      if (err.code === 'DUPLICATE_DOCUMENT' || err.status === 409) {
        toast.error('This exact file content is already uploaded in this project.');
      } else {
        toast.error(err.message || 'Failed to upload document version.');
      }
    } finally {
      setUploadingVersion(false);
    }
  };

  // Handle Version History Open
  const handleOpenVersions = async (doc) => {
    try {
      const fullDoc = await api.getAiDocument(selectedProjectId, doc.id);
      setActiveDocForVersions(fullDoc.data);
      setVersionModalOpen(true);
    } catch (err) {
      toast.error(err.message || 'Failed to fetch document versions.');
    }
  };

  // Handle Activate Specific Version
  const handleActivateVersion = async (versionId) => {
    if (!activeDocForVersions) return;
    try {
      setActivatingVersionId(versionId);
      await api.activateAiDocumentVersion(selectedProjectId, activeDocForVersions.id, versionId);
      toast.success('Active document version updated.');
      const updated = await api.getAiDocument(selectedProjectId, activeDocForVersions.id);
      setActiveDocForVersions(updated.data);
      await loadDocuments();
    } catch (err) {
      toast.error(err.message || 'Failed to activate version.');
    } finally {
      setActivatingVersionId(null);
    }
  };

  // Handle Preview Document
  const handlePreview = async (doc) => {
    setPreviewDoc(doc);
    setPreviewTextContent('');
    setPreviewModalOpen(true);

    const type = (doc.document_type || '').toUpperCase();
    if (type === 'TXT' || type === 'CSV') {
      try {
        setPreviewLoading(true);
        const previewUrl = api.getAiDocumentPreviewUrl(selectedProjectId, doc.id);
        const res = await fetch(previewUrl, { credentials: 'include' });
        if (!res.ok) {
          throw new Error('Failed to load document preview stream.');
        }
        const text = await res.text();
        setPreviewTextContent(text);
      } catch (err) {
        toast.error(err.message || 'Error loading preview text.');
      } finally {
        setPreviewLoading(false);
      }
    }
  };

  // Handle Delete Document
  const handleDeleteConfirm = async () => {
    if (!docToDelete) return;
    try {
      setDeleting(true);
      await api.deleteAiDocument(selectedProjectId, docToDelete.id);
      toast.success(`Document "${docToDelete.title}" deleted.`);
      setDeleteModalOpen(false);
      setDocToDelete(null);
      await loadDocuments();
    } catch (err) {
      toast.error(err.message || 'Failed to delete document.');
    } finally {
      setDeleting(false);
    }
  };

  // Copy hash helper
  const handleCopyHash = (hash) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Copy unit text helper
  const handleCopyUnitText = (unitId, text) => {
    navigator.clipboard.writeText(text);
    setCopiedUnitId(unitId);
    setTimeout(() => setCopiedUnitId(null), 2000);
  };

  // Fetch paginated extracted units
  const fetchUnitsData = async (docId, versionId, page = 1, search = '', sourceType = 'ALL') => {
    try {
      setUnitsLoading(true);
      const params = {
        page,
        pageSize: 25,
        search: search.trim() || undefined,
        sourceType: sourceType !== 'ALL' ? sourceType : undefined
      };
      const res = await api.getAiDocumentExtractedUnits(selectedProjectId, docId, versionId, params);
      const data = res.data || {};
      setExtractedUnits(data.units || []);
      setUnitsPagination(data.pagination || { page: 1, pageSize: 25, total: 0, totalPages: 0 });
      if (data.extraction) {
        setActiveExtractionDetails(data.extraction);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load extracted units.');
    } finally {
      setUnitsLoading(false);
    }
  };

  // Open Extraction Viewer Modal
  const handleOpenExtractionViewer = async (doc, versionId = null) => {
    const effectiveVersionId = versionId || doc.active_version_id;
    setActiveDocForExtraction(doc);
    setActiveVersionForExtraction(effectiveVersionId);
    setUnitsSearch('');
    setUnitsSourceType('ALL');
    setExtractionModalOpen(true);

    try {
      // Also fetch extraction summary status
      const statusRes = await api.getAiDocumentExtraction(selectedProjectId, doc.id, effectiveVersionId);
      setActiveExtractionDetails(statusRes.data || null);
    } catch (_) {}

    await fetchUnitsData(doc.id, effectiveVersionId, 1, '', 'ALL');
  };

  // Handle Reprocess Extraction
  const handleReprocessExtraction = async (doc, versionId = null) => {
    const targetVersionId = versionId || doc.active_version_id;
    try {
      setReprocessingId(targetVersionId);
      await api.reprocessAiDocumentExtraction(selectedProjectId, doc.id, targetVersionId);
      toast.success('Reprocessing started in background. Existing units remain active until complete.');
      await loadDocuments();
      if (activeDocForVersions && activeDocForVersions.id === doc.id) {
        const updated = await api.getAiDocument(selectedProjectId, doc.id);
        setActiveDocForVersions(updated.data);
      }
      if (extractionModalOpen && activeVersionForExtraction === targetVersionId) {
        // Refresh extraction details
        const statusRes = await api.getAiDocumentExtraction(selectedProjectId, doc.id, targetVersionId);
        setActiveExtractionDetails(statusRes.data || null);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to start reprocessing.');
    } finally {
      setReprocessingId(null);
    }
  };

  // Handle Retry Extraction (for failed extractions)
  const handleRetryExtraction = async (doc, versionId = null) => {
    const targetVersionId = versionId || doc.active_version_id;
    try {
      await api.extractAiDocumentVersion(selectedProjectId, doc.id, targetVersionId);
      toast.success('Extraction retry started.');
      await loadDocuments();
    } catch (err) {
      toast.error(err.message || 'Failed to trigger extraction retry.');
    }
  };

  // Fetch Chunks Data for Modal 8
  const fetchChunksData = async (docId, versionId, search = '') => {
    try {
      setChunksLoading(true);
      const res = await api.getAiDocumentChunks(selectedProjectId, docId, versionId, {
        search,
        limit: 100,
        offset: 0
      });
      const data = res.data || {};
      const list = data.chunks || [];
      setChunksList(list);
      setChunksTotalCount(data.totalCount || 0);

      // Select first chunk by default if list not empty
      if (list.length > 0) {
        fetchChunkDetail(docId, versionId, list[0].id);
      } else {
        setSelectedChunkDetail(null);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load document chunks.');
    } finally {
      setChunksLoading(false);
    }
  };

  // Fetch Chunk Detail (Content + Vector Preview)
  const fetchChunkDetail = async (docId, versionId, chunkId) => {
    try {
      setSelectedChunkId(chunkId);
      setChunkDetailLoading(true);
      const res = await api.getAiDocumentChunkDetails(selectedProjectId, docId, versionId, chunkId);
      setSelectedChunkDetail(res.data || null);
    } catch (err) {
      console.error('Failed to load chunk detail:', err);
    } finally {
      setChunkDetailLoading(false);
    }
  };

  // Open Chunks & Embeddings Modal
  const handleOpenChunksViewer = async (doc, versionId = null) => {
    const effectiveVersionId = versionId || doc.active_version_id;
    setActiveDocForChunks(doc);
    setActiveVersionForChunks(effectiveVersionId);
    setChunksSearch('');
    setSelectedChunkDetail(null);
    setChunksModalOpen(true);

    try {
      const statusRes = await api.getAiDocumentIndexingStatus(selectedProjectId, doc.id, effectiveVersionId);
      setActiveIndexingDetails(statusRes.data || null);
    } catch (_) {}

    await fetchChunksData(doc.id, effectiveVersionId, '');
  };

  // Handle Trigger Indexing (Generate Embeddings)
  const handleTriggerIndexing = async (doc, versionId = null) => {
    const targetVersionId = versionId || doc.active_version_id;
    try {
      setIndexingInFlightId(targetVersionId);
      await api.triggerAiDocumentIndexing(selectedProjectId, doc.id, targetVersionId);
      toast.success('Indexing started in background.');
      await loadDocuments();
    } catch (err) {
      toast.error(err.message || 'Failed to trigger document indexing.');
    } finally {
      setIndexingInFlightId(null);
    }
  };

  // Handle Re-index Document
  const handleReindexDocument = async (doc, versionId = null) => {
    const targetVersionId = versionId || doc.active_version_id;
    try {
      setIndexingInFlightId(targetVersionId);
      await api.reindexAiDocument(selectedProjectId, doc.id, targetVersionId);
      toast.success('Re-indexing started in background. Existing chunks remain active until complete.');
      await loadDocuments();
      if (chunksModalOpen && activeVersionForChunks === targetVersionId) {
        const statusRes = await api.getAiDocumentIndexingStatus(selectedProjectId, doc.id, targetVersionId);
        setActiveIndexingDetails(statusRes.data || null);
        await fetchChunksData(doc.id, targetVersionId, chunksSearch);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to trigger re-indexing.');
    } finally {
      setIndexingInFlightId(null);
    }
  };

  const handleCopyChunkText = (id, text) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedChunkId(id);
    setTimeout(() => setCopiedChunkId(null), 2000);
  };

  // Execute Knowledge Retrieval (Phase 2.6)
  const handleExecuteRetrieval = async () => {
    if (!retrievalQuery.trim()) {
      toast.error('Please enter a search query.');
      return;
    }
    if (!selectedProjectId) {
      toast.error('Please select a project first.');
      return;
    }

    try {
      setRetrievalLoading(true);
      const params = {
        query: retrievalQuery.trim(),
        mode: retrievalMode,
        limit: parseInt(retrievalLimit, 10) || 10,
        candidateLimit: parseInt(retrievalCandidateLimit, 10) || 50,
        documentId: retrievalDocFilter || undefined,
        weights: {
          semantic: parseFloat(retrievalSemanticWeight) || 1.0,
          keyword: parseFloat(retrievalKeywordWeight) || 1.0,
          rrf_k: parseInt(retrievalRrfK, 10) || 60
        },
        fallbackOnSemanticFailure: retrievalFallback
      };

      const res = await api.searchKnowledgeBase(selectedProjectId, params);
      const data = res.data || {};
      setRetrievalResults(data.results || []);
      setRetrievalDiagnostics(data.diagnostics || null);
      if (data.results && data.results.length > 0) {
        setSelectedRetrievalItem(data.results[0]);
      } else {
        setSelectedRetrievalItem(null);
      }
      if (data.mode === 'HYBRID_DEGRADED') {
        toast.warning('Ollama embedding service unreachable. Automatically degraded to keyword retrieval.');
      }
    } catch (err) {
      toast.error(err.message || 'Retrieval search failed.');
    } finally {
      setRetrievalLoading(false);
    }
  };

  const handleCopyCitationContent = (id, content) => {
    if (!content) return;
    navigator.clipboard.writeText(content);
    setCopiedCitationId(id);
    setTimeout(() => setCopiedCitationId(null), 2000);
  };

  // Filtered Documents
  const filteredDocuments = documents.filter((doc) => {
    const matchesSearch =
      (doc.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.original_filename || '').toLowerCase().includes(searchQuery.toLowerCase());
    const matchesType = filterType === 'ALL' || (doc.document_type || '').toUpperCase() === filterType;
    return matchesSearch && matchesType;
  });

  const activeProject = projects.find((p) => p.id === selectedProjectId);

  return (
    <div className="space-y-6 fade-in pb-12">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1f2544] dark:text-white tracking-tight font-sans">
              AI Documents &amp; <span className="text-heading-gradient">Knowledge Base</span>
            </h1>
            <p className="text-xs sm:text-[13px] text-[#6b7194] dark:text-[#94A3B8] mt-1">
              Project-isolated document upload, metadata persistence, and version control for AI test case synthesis.
            </p>
          </div>
        </div>

        {/* Project Selector & New Project Button */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <select
              value={selectedProjectId}
              onChange={(e) => handleSelectProject(e.target.value)}
              disabled={projectsLoading || projects.length === 0}
              className="w-full appearance-none bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] text-xs font-semibold text-[#1f2544] dark:text-white px-3.5 py-2.5 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer shadow-xs disabled:opacity-50"
            >
              {projects.length === 0 ? (
                <option value="">No projects available</option>
              ) : (
                projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.name} ({proj.slug})
                  </option>
                ))
              )}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
          </div>

          <Tooltip content="Create new project" side="bottom">
            <button
              onClick={() => setCreateProjectModalOpen(true)}
              className="p-2.5 bg-white dark:bg-[#0D121F] hover:bg-slate-50 dark:hover:bg-[#161B26] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-xl text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
            >
              <FolderPlus className="w-4 h-4" />
            </button>
          </Tooltip>

          <button
            onClick={() => setUploadModalOpen(true)}
            disabled={!selectedProjectId}
            className="btn-magic text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-magic flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UploadCloud className="w-4 h-4 text-white" />
            <span>Upload Document</span>
          </button>

          <Tooltip content="Knowledge Base Hybrid Retrieval Playground (Phase 2.6)" side="bottom">
            <button
              onClick={() => {
                setRetrievalModalOpen(true);
                if (retrievalResults.length === 0 && retrievalQuery) {
                  handleExecuteRetrieval();
                }
              }}
              disabled={!selectedProjectId}
              className="px-3.5 py-2.5 rounded-xl bg-violet-600/10 hover:bg-violet-600/20 text-violet-700 dark:text-violet-300 border border-violet-500/30 text-xs font-bold flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-colors shadow-xs"
            >
              <Search className="w-4 h-4 text-violet-600 dark:text-violet-400" />
              <span className="hidden md:inline">Knowledge Retrieval</span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Selected Project Status Banner */}
      {activeProject && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-200/50 dark:border-indigo-900/30 text-xs">
          <div className="flex items-center gap-2 text-indigo-900 dark:text-indigo-200">
            <span className="font-bold">Active Project:</span>
            <span className="font-semibold">{activeProject.name}</span>
            <span className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
              {activeProject.slug}
            </span>
            {activeProject.description && (
              <span className="text-slate-500 dark:text-slate-400 border-l border-indigo-200 dark:border-indigo-800 pl-2">
                {activeProject.description}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400">Total Documents:</span>
            <span className="font-bold text-indigo-600 dark:text-indigo-400">{documents.length}</span>
          </div>
        </div>
      )}

      {/* Upload Zone (Quick Drag & Drop) */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileChange(e.dataTransfer.files[0]);
            setUploadModalOpen(true);
          }
        }}
        className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer ${
          isDragOver
            ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-950/20 scale-[0.99]'
            : 'border-slate-300 dark:border-[#222938] hover:border-indigo-400 dark:hover:border-indigo-600 bg-white/40 dark:bg-[#090C12]/40'
        }`}
        onClick={() => {
          if (selectedProjectId) {
            setUploadModalOpen(true);
          } else {
            toast.error('Please create or select a project first.');
          }
        }}
      >
        <div className="brand-mark w-12 h-12 rounded-2xl mx-auto flex items-center justify-center mb-3">
          <UploadCloud className="w-6 h-6 text-white" />
        </div>
        <h3 className="text-sm font-bold text-[#1f2544] dark:text-white">
          Drop your test requirement documents here, or <span className="text-indigo-600 dark:text-indigo-400">browse</span>
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md mx-auto">
          Strictly validated formats with 25 MB max size. Stored project-isolated in PostgreSQL 16 <code className="text-xs font-mono">qa_ai_platform</code>.
        </p>

        {/* Supported Format Badges */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
          {ALLOWED_EXTENSIONS.map((ext) => {
            const badge = getFormatBadge(ext);
            return (
              <span
                key={ext}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-lg border uppercase tracking-wider ${badge.bg}`}
              >
                {ext}
              </span>
            );
          })}
        </div>
      </div>

      {/* Search, Filter & Refresh Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-2 w-full sm:w-auto flex-1 max-w-xl">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by title or filename..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] text-xs text-[#1f2544] dark:text-white pl-9 pr-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 placeholder-slate-400 shadow-xs"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
          {/* Format Filter */}
          <div className="flex items-center gap-1 bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] p-1 rounded-xl shadow-xs">
            {['ALL', 'PDF', 'DOCX', 'XLSX', 'CSV', 'TXT'].map((type) => (
              <button
                key={type}
                onClick={() => setFilterType(type)}
                className={`text-[11px] font-bold px-2.5 py-1 rounded-lg transition-colors cursor-pointer ${
                  filterType === type
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          <Tooltip content="Refresh list" side="top">
            <button
              onClick={loadDocuments}
              disabled={documentsLoading}
              className="p-2.5 bg-white dark:bg-[#0D121F] hover:bg-slate-50 dark:hover:bg-[#161B26] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-xl text-slate-600 dark:text-slate-300 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${documentsLoading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Documents Table */}
      <div className="bg-white/80 dark:bg-[#090C12]/80 backdrop-blur-md rounded-2xl border border-[rgba(99,102,241,0.14)] dark:border-[#161B26] shadow-glass overflow-hidden">
        {documentsLoading ? (
          <div className="p-12 text-center text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-500 mb-3" />
            <p className="text-xs">Loading documents...</p>
          </div>
        ) : filteredDocuments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-[#161B26] bg-slate-50/50 dark:bg-[#0D121F]/50 text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold text-[10px]">
                  <th className="py-3 px-4">Document Title &amp; Filename</th>
                  <th className="py-3 px-3">Type</th>
                  <th className="py-3 px-3">Active Version</th>
                  <th className="py-3 px-3">Size</th>
                  <th className="py-3 px-3">Updated</th>
                  <th className="py-3 px-3">Extraction Status</th>
                  <th className="py-3 px-3">Indexing &amp; Embeddings</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-[#161B26]/60">
                {filteredDocuments.map((doc) => {
                  const badge = getFormatBadge(doc.document_type);
                  const Icon = badge.icon;
                  return (
                    <tr
                      key={doc.id}
                      className="hover:bg-slate-50/50 dark:hover:bg-[#111726]/40 transition-colors"
                    >
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3">
                          <div className={`p-2 rounded-xl border ${badge.bg}`}>
                            <Icon className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="font-bold text-[#1f2544] dark:text-white text-xs">
                              {doc.title || doc.original_filename}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                              {doc.original_filename}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3.5 px-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${badge.bg}`}>
                          {doc.document_type}
                        </span>
                      </td>
                      <td className="py-3.5 px-3">
                        <button
                          onClick={() => handleOpenVersions(doc)}
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 font-mono text-[11px] font-semibold transition-colors cursor-pointer"
                        >
                          <History className="w-3 h-3" />
                          <span>v{doc.version_number}</span>
                        </button>
                      </td>
                      <td className="py-3.5 px-3 text-slate-600 dark:text-slate-300 font-mono">
                        {formatBytes(doc.file_size_bytes)}
                      </td>
                      <td className="py-3.5 px-3 text-slate-500 dark:text-slate-400">
                        {formatDate(doc.updated_at || doc.created_at)}
                      </td>
                      <td className="py-3.5 px-3">
                        {doc.extraction_status === 'PROCESSING' ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Extracting...</span>
                          </span>
                        ) : doc.extraction_status === 'COMPLETED' ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                              <CheckCircle2 className="w-3 h-3" />
                              <span>{doc.extraction_total_units || 0} units</span>
                            </span>
                            {doc.extraction_warning_count > 0 && (
                              <Tooltip content={`${doc.extraction_warning_count} warning(s) detected during extraction`}>
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  <span>{doc.extraction_warning_count}</span>
                                </span>
                              </Tooltip>
                            )}
                          </div>
                        ) : doc.extraction_status === 'FAILED' ? (
                          <div className="flex items-center gap-1">
                            <Tooltip content={doc.extraction_error_message || 'Extraction failed'}>
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400">
                                <AlertCircle className="w-3 h-3" />
                                <span>Failed</span>
                              </span>
                            </Tooltip>
                            <Tooltip content="Retry Extraction">
                              <button
                                onClick={() => handleRetryExtraction(doc, doc.active_version_id)}
                                className="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>
                            </Tooltip>
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border border-slate-400/20 bg-slate-500/10 text-slate-500 dark:text-slate-400">
                            <Clock className="w-3 h-3" />
                            <span>Pending</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-3">
                        {indexingInFlightId === doc.active_version_id || doc.indexing_status === 'PROCESSING' ? (
                          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-cyan-500/20 bg-cyan-500/10 text-cyan-600 dark:text-cyan-400">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            <span>Indexing...</span>
                          </span>
                        ) : doc.indexing_status === 'COMPLETED' || (doc.indexing_total_chunks && doc.indexing_total_chunks > 0) ? (
                          <button
                            onClick={() => handleOpenChunksViewer(doc, doc.active_version_id)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20 cursor-pointer transition-colors"
                            title="View Chunks & Embeddings"
                          >
                            <Layers className="w-3 h-3" />
                            <span>{doc.indexing_total_chunks || 0} chunks</span>
                          </button>
                        ) : doc.indexing_status === 'FAILED' ? (
                          <div className="flex items-center gap-1">
                            <Tooltip content={doc.indexing_error || 'Indexing failed'}>
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-400">
                                <AlertCircle className="w-3 h-3" />
                                <span>Failed</span>
                              </span>
                            </Tooltip>
                            <Tooltip content="Retry Indexing">
                              <button
                                onClick={() => handleTriggerIndexing(doc, doc.active_version_id)}
                                className="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer"
                              >
                                <RefreshCw className="w-3 h-3" />
                              </button>
                            </Tooltip>
                          </div>
                        ) : doc.extraction_status === 'COMPLETED' ? (
                          <button
                            onClick={() => handleTriggerIndexing(doc, doc.active_version_id)}
                            className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-lg border border-indigo-500/30 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer transition-colors"
                            title="Generate Local Embeddings"
                          >
                            <Sparkles className="w-3 h-3" />
                            <span>Ready to Index</span>
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded border border-slate-400/20 bg-slate-500/10 text-slate-500 dark:text-slate-400">
                            <Clock className="w-3 h-3" />
                            <span>Extracting...</span>
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Tooltip content="View Chunks & Embeddings" side="top">
                            <button
                              onClick={() => handleOpenChunksViewer(doc, doc.active_version_id)}
                              className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                            >
                              <Layers className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>

                          <Tooltip content="View Extracted Content & Provenance" side="top">
                            <button
                              onClick={() => handleOpenExtractionViewer(doc, doc.active_version_id)}
                              className="p-1.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                            >
                              <FileCode className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>

                          <Tooltip content="Preview Document" side="top">
                            <button
                              onClick={() => handlePreview(doc)}
                              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1C2230] text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 transition-colors cursor-pointer"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>

                          <Tooltip content="Download File" side="top">
                            <a
                              href={api.getAiDocumentDownloadUrl(selectedProjectId, doc.id)}
                              download={doc.original_filename}
                              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1C2230] text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400 transition-colors cursor-pointer inline-flex items-center"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </Tooltip>

                          <Tooltip content="Upload New Version" side="top">
                            <button
                              onClick={() => {
                                setTargetDocForNewVersion(doc);
                                setNewVersionModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-[#1C2230] text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 transition-colors cursor-pointer"
                            >
                              <Plus className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>

                          <Tooltip content="Delete Document" side="top">
                            <button
                              onClick={() => {
                                setDocToDelete(doc);
                                setDeleteModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 transition-colors cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-12 text-center space-y-3">
            <div className="brand-mark w-12 h-12 rounded-2xl mx-auto flex items-center justify-center">
              <FileText className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-sm font-bold text-[#1f2544] dark:text-white">No documents found</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchQuery || filterType !== 'ALL'
                ? 'No documents match the current search filters.'
                : 'Upload specifications, test matrices, or requirements to build your AI knowledge base.'}
            </p>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* MODAL 1: Upload Document                                          */}
      {/* ================================================================= */}
      {uploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-2xl p-6 max-w-lg w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#1E2538]">
              <div className="flex items-center gap-2.5">
                <div className="brand-mark w-7 h-7 rounded-lg flex items-center justify-center text-white">
                  <UploadCloud className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-sm font-extrabold text-[#1f2544] dark:text-white">Upload New Document</h3>
              </div>
              <button
                onClick={() => setUploadModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Target Project
                </label>
                <input
                  type="text"
                  disabled
                  value={activeProject ? `${activeProject.name} (${activeProject.slug})` : 'No project selected'}
                  className="w-full bg-slate-50 dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] rounded-xl px-3 py-2 text-slate-500 font-medium"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Document Title (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Authentication Specification v2.1"
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className="w-full bg-white dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Select File (PDF, DOCX, XLSX, CSV, TXT &le; 25 MB)
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.xlsx,.csv,.txt"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      handleFileChange(e.target.files[0]);
                    }
                  }}
                  className="w-full text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-600 dark:file:bg-indigo-950/60 dark:file:text-indigo-400 hover:file:bg-indigo-100 cursor-pointer"
                />
              </div>

              {uploadFile && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] space-y-1">
                  <div className="flex justify-between font-semibold text-slate-700 dark:text-slate-300">
                    <span>{uploadFile.name}</span>
                    <span className="font-mono">{formatBytes(uploadFile.size)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    Signature and ZIP archive validation will be executed prior to storage.
                  </p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#1E2538]">
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#222938] text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-[#161B26]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading || !uploadFile}
                  className="btn-magic px-5 py-2 rounded-xl text-white font-bold shadow-magic flex items-center gap-2 disabled:opacity-50"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Validating &amp; Uploading...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Confirm Upload</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 2: Create Project                                           */}
      {/* ================================================================= */}
      {createProjectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#1E2538]">
              <div className="flex items-center gap-2.5">
                <div className="brand-mark w-7 h-7 rounded-lg flex items-center justify-center text-white">
                  <FolderPlus className="w-4 h-4 text-white" />
                </div>
                <h3 className="text-sm font-extrabold text-[#1f2544] dark:text-white">Create AI Project</h3>
              </div>
              <button
                onClick={() => setCreateProjectModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateProject} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Project Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Mobile Banking QA"
                  value={newProjectName}
                  onChange={(e) => {
                    setNewProjectName(e.target.value);
                    if (!newProjectSlug || newProjectSlug === newProjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')) {
                      setNewProjectSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''));
                    }
                  }}
                  className="w-full bg-white dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Project Slug (URL safe)
                </label>
                <input
                  type="text"
                  placeholder="e.g. mobile-banking-qa"
                  value={newProjectSlug}
                  onChange={(e) => setNewProjectSlug(e.target.value)}
                  className="w-full bg-white dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Project purpose, application scope or testing domain..."
                  value={newProjectDesc}
                  onChange={(e) => setNewProjectDesc(e.target.value)}
                  className="w-full bg-white dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#1E2538]">
                <button
                  type="button"
                  onClick={() => setCreateProjectModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#222938] text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-[#161B26]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={creatingProject || !newProjectName.trim()}
                  className="btn-magic px-5 py-2 rounded-xl text-white font-bold shadow-magic flex items-center gap-2 disabled:opacity-50"
                >
                  {creatingProject ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <>
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>Create Project</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 3: Version History Drawer / Modal                           */}
      {/* ================================================================= */}
      {versionModalOpen && activeDocForVersions && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#1E2538]">
              <div className="flex items-center gap-2.5">
                <div className="brand-mark w-7 h-7 rounded-lg flex items-center justify-center text-white">
                  <History className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-[#1f2544] dark:text-white">
                    Version History — {activeDocForVersions.title}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Switch active version or review cryptographic content checksums.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setVersionModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {(activeDocForVersions.versions || []).map((ver) => {
                const isActive = ver.id === activeDocForVersions.active_version_id;
                return (
                  <div
                    key={ver.id}
                    className={`p-3.5 rounded-xl border transition-all text-xs ${
                      isActive
                        ? 'border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20'
                        : 'border-slate-200 dark:border-[#1E2538] bg-slate-50/50 dark:bg-[#141926]/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                          v{ver.version_number}
                        </span>
                        {isActive && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            ACTIVE
                          </span>
                        )}
                        <span className="text-slate-600 dark:text-slate-300 font-medium">
                          {ver.original_filename}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {/* Version Extraction Status Badge */}
                        {ver.extraction_status === 'PROCESSING' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            <span>Extracting</span>
                          </span>
                        ) : ver.extraction_status === 'COMPLETED' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                            <CheckCircle2 className="w-2.5 h-2.5" />
                            <span>{ver.extraction_total_units || 0} units</span>
                          </span>
                        ) : ver.extraction_status === 'FAILED' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
                            <AlertCircle className="w-2.5 h-2.5" />
                            <span>Failed</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-slate-500/10 text-slate-500 dark:text-slate-400 border border-slate-500/20">
                            <Clock className="w-2.5 h-2.5" />
                            <span>Pending</span>
                          </span>
                        )}

                        {/* View Units button */}
                        <button
                          onClick={() => {
                            setVersionModalOpen(false);
                            handleOpenExtractionViewer(activeDocForVersions, ver.id);
                          }}
                          className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 dark:bg-[#1E2538] dark:hover:bg-[#252E46] text-slate-700 dark:text-slate-200 font-semibold text-[10px] flex items-center gap-1 cursor-pointer"
                        >
                          <FileCode className="w-3 h-3" />
                          <span>View Units</span>
                        </button>

                        {/* Reprocess button */}
                        <button
                          onClick={() => handleReprocessExtraction(activeDocForVersions, ver.id)}
                          disabled={reprocessingId === ver.id}
                          className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-semibold text-[10px] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                        >
                          <RefreshCw className={`w-3 h-3 ${reprocessingId === ver.id ? 'animate-spin' : ''}`} />
                          <span>{reprocessingId === ver.id ? 'Starting...' : 'Reprocess'}</span>
                        </button>

                        <span className="font-mono text-slate-400 text-[11px] ml-1">
                          {formatBytes(ver.file_size_bytes)}
                        </span>
                        {!isActive && (
                          <button
                            onClick={() => handleActivateVersion(ver.id)}
                            disabled={activatingVersionId === ver.id}
                            className="px-2.5 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50 ml-1"
                          >
                            {activatingVersionId === ver.id ? 'Activating...' : 'Activate'}
                          </button>
                        )}
                      </div>
                    </div>

                    {ver.change_summary && (
                      <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-2 italic">
                        "{ver.change_summary}"
                      </p>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-200/50 dark:border-[#1E2538]/60 text-[10px] text-slate-400">
                      <div className="flex items-center gap-1.5 font-mono">
                        <span>SHA-256:</span>
                        <span className="text-slate-600 dark:text-slate-300">{ver.sha256_hash.slice(0, 16)}...</span>
                        <button
                          type="button"
                          onClick={() => handleCopyHash(ver.sha256_hash)}
                          className="hover:text-indigo-500 ml-1"
                        >
                          {copiedHash === ver.sha256_hash ? (
                            <Check className="w-3 h-3 text-emerald-500" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                      <div>Uploaded: {formatDate(ver.created_at)}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-[#1E2538]">
              <button
                type="button"
                onClick={() => {
                  setVersionModalOpen(false);
                  setTargetDocForNewVersion(activeDocForVersions);
                  setNewVersionModalOpen(true);
                }}
                className="btn-magic px-3.5 py-1.5 rounded-xl text-white font-bold text-xs shadow-magic flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Upload Next Version</span>
              </button>

              <button
                type="button"
                onClick={() => setVersionModalOpen(false)}
                className="px-4 py-1.5 rounded-xl border border-slate-200 dark:border-[#222938] text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-[#161B26] text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 4: Upload New Version                                       */}
      {/* ================================================================= */}
      {newVersionModalOpen && targetDocForNewVersion && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#1E2538]">
              <div className="flex items-center gap-2.5">
                <div className="brand-mark w-7 h-7 rounded-lg flex items-center justify-center text-white">
                  <Plus className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-[#1f2544] dark:text-white">
                    Upload New Version
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    For: {targetDocForNewVersion.title}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setNewVersionModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUploadVersionSubmit} className="space-y-3.5 text-xs">
              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Change Summary / Changelog
                </label>
                <input
                  type="text"
                  placeholder="e.g. Updated Section 3 with new biometric flow"
                  value={newVersionSummary}
                  onChange={(e) => setNewVersionSummary(e.target.value)}
                  className="w-full bg-white dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div>
                <label className="block text-slate-600 dark:text-slate-300 font-semibold mb-1">
                  Select Updated File
                </label>
                <input
                  ref={versionFileInputRef}
                  type="file"
                  accept=".pdf,.docx,.xlsx,.csv,.txt"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      const f = e.target.files[0];
                      const ext = f.name.split('.').pop().toLowerCase();
                      if (!ALLOWED_EXTENSIONS.includes(ext)) {
                        toast.error(`Unsupported format ".${ext}".`);
                        return;
                      }
                      setNewVersionFile(f);
                    }
                  }}
                  className="w-full text-slate-500 file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-indigo-50 file:text-indigo-600 dark:file:bg-indigo-950/60 dark:file:text-indigo-400 hover:file:bg-indigo-100 cursor-pointer"
                />
              </div>

              {newVersionFile && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] text-[11px] text-slate-400">
                  Selected: <span className="text-slate-700 dark:text-slate-300 font-semibold">{newVersionFile.name}</span> ({formatBytes(newVersionFile.size)})
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#1E2538]">
                <button
                  type="button"
                  onClick={() => setNewVersionModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#222938] text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-[#161B26]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadingVersion || !newVersionFile}
                  className="btn-magic px-5 py-2 rounded-xl text-white font-bold shadow-magic flex items-center gap-2 disabled:opacity-50"
                >
                  {uploadingVersion ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving Version...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Upload Version</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 5: Preview Modal                                            */}
      {/* ================================================================= */}
      {previewModalOpen && previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-2xl p-6 max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#1E2538]">
              <div className="flex items-center gap-2.5">
                <div className="brand-mark w-7 h-7 rounded-lg flex items-center justify-center text-white">
                  <Eye className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-[#1f2544] dark:text-white">
                    Preview: {previewDoc.title || previewDoc.original_filename}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Format: {previewDoc.document_type} &bull; v{previewDoc.version_number} &bull; {formatBytes(previewDoc.file_size_bytes)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPreviewModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-[400px] overflow-hidden flex flex-col rounded-xl border border-slate-200 dark:border-[#1E2538] bg-slate-50 dark:bg-[#080B10]">
              {previewDoc.document_type === 'PDF' ? (
                <iframe
                  src={api.getAiDocumentPreviewUrl(selectedProjectId, previewDoc.id)}
                  title="PDF Document Preview"
                  className="w-full h-full min-h-[500px] rounded-xl border-0"
                />
              ) : previewDoc.document_type === 'TXT' || previewDoc.document_type === 'CSV' ? (
                previewLoading ? (
                  <div className="flex-1 flex items-center justify-center p-8">
                    <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
                  </div>
                ) : (
                  <pre className="p-4 font-mono text-xs overflow-auto flex-1 text-slate-800 dark:text-slate-200 whitespace-pre-wrap select-text">
                    {previewTextContent || 'Empty content'}
                  </pre>
                )
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                  <div className="brand-mark w-12 h-12 rounded-2xl flex items-center justify-center">
                    <FileSpreadsheet className="w-6 h-6 text-white" />
                  </div>
                  <h4 className="text-sm font-bold text-[#1f2544] dark:text-white">
                    In-Browser Preview Not Supported for {previewDoc.document_type}
                  </h4>
                  <p className="text-xs text-slate-400 max-w-sm">
                    In-browser inline preview is supported for PDF, CSV, and TXT files. For Word (.docx) and Excel (.xlsx) files, please download the file directly.
                  </p>
                  <a
                    href={api.getAiDocumentDownloadUrl(selectedProjectId, previewDoc.id)}
                    download={previewDoc.original_filename}
                    className="btn-magic px-5 py-2 rounded-xl text-white font-bold text-xs shadow-magic inline-flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download {previewDoc.original_filename}</span>
                  </a>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#1E2538]">
              <a
                href={api.getAiDocumentDownloadUrl(selectedProjectId, previewDoc.id)}
                download={previewDoc.original_filename}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#222938] text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-[#161B26] text-xs inline-flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download</span>
              </a>
              <button
                type="button"
                onClick={() => setPreviewModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-[#1E2538] text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-200 dark:hover:bg-[#252E46] text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 6: Delete Confirmation                                      */}
      {/* ================================================================= */}
      {deleteModalOpen && docToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0D121F] border border-rose-500/30 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-rose-500">
              <div className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20">
                <ShieldAlert className="w-6 h-6 text-rose-500" />
              </div>
              <div>
                <h3 className="text-sm font-extrabold text-[#1f2544] dark:text-white">Delete Document</h3>
                <p className="text-[11px] text-slate-400">This action cannot be undone.</p>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300">
              Are you sure you want to permanently delete{' '}
              <span className="font-bold text-slate-900 dark:text-white">
                "{docToDelete.title || docToDelete.original_filename}"
              </span>
              ? All versions and associated files on disk will be unlinked and purged immediately.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-[#1E2538]">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                disabled={deleting}
                className="px-4 py-2 rounded-xl border border-slate-200 dark:border-[#222938] text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-[#161B26] text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                disabled={deleting}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-lg shadow-rose-600/20 flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete Permanently</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 7: Extracted Content & Provenance Viewer                     */}
      {/* ================================================================= */}
      {extractionModalOpen && activeDocForExtraction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-2xl p-6 max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#1E2538]">
              <div className="flex items-center gap-3">
                <div className="brand-mark w-8 h-8 rounded-xl flex items-center justify-center text-white">
                  <FileCode className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-[#1f2544] dark:text-white flex items-center gap-2">
                    <span>Extracted Content &amp; Provenance</span>
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                      {activeDocForExtraction.title || activeDocForExtraction.original_filename}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Format: <span className="font-semibold text-slate-700 dark:text-slate-300">{activeDocForExtraction.document_type}</span> &bull; Total Units: <span className="font-semibold text-slate-700 dark:text-slate-300">{activeExtractionDetails?.total_units || activeExtractionDetails?.totalUnits || unitsPagination.total || 0}</span> &bull; Status: <span className="font-bold text-emerald-600 dark:text-emerald-400">{activeExtractionDetails?.status || 'COMPLETED'}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setExtractionModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Warnings Alert Banner (if any warnings detected during extraction) */}
            {activeExtractionDetails?.warnings && activeExtractionDetails.warnings.length > 0 && (
              <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                <div className="flex items-center gap-2 font-bold">
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                  <span>Extraction Warnings Detected ({activeExtractionDetails.warnings.length})</span>
                </div>
                <ul className="list-disc list-inside text-[11px] space-y-0.5 pl-6 text-amber-800 dark:text-amber-200">
                  {activeExtractionDetails.warnings.map((w, idx) => (
                    <li key={idx}>{typeof w === 'string' ? w : JSON.stringify(w)}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Search & Source Type Filter Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
              <div className="relative w-full sm:w-80">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Filter extracted text or location..."
                  value={unitsSearch}
                  onChange={(e) => {
                    const val = e.target.value;
                    setUnitsSearch(val);
                    fetchUnitsData(activeDocForExtraction.id, activeVersionForExtraction, 1, val, unitsSourceType);
                  }}
                  className="w-full bg-slate-50 dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] text-xs text-slate-800 dark:text-slate-200 pl-8 pr-3 py-1.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              {/* Source Type Filter Chips */}
              <div className="flex flex-wrap items-center gap-1">
                {['ALL', 'PAGE', 'HEADING', 'PARAGRAPH', 'TABLE', 'SHEET_ROW', 'CSV_ROW', 'LINE'].map((st) => (
                  <button
                    key={st}
                    onClick={() => {
                      setUnitsSourceType(st);
                      fetchUnitsData(activeDocForExtraction.id, activeVersionForExtraction, 1, unitsSearch, st);
                    }}
                    className={`text-[10px] font-bold px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                      unitsSourceType === st
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-[#161B26] text-slate-600 dark:text-slate-400 hover:text-indigo-600'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>
            </div>

            {/* Extracted Content Units List */}
            <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 min-h-[350px] max-h-[55vh]">
              {unitsLoading ? (
                <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
                  <p className="text-xs">Loading structured units...</p>
                </div>
              ) : extractedUnits.length > 0 ? (
                extractedUnits.map((unit) => (
                  <div
                    key={unit.id || unit.sequence_number}
                    className="p-3 rounded-xl border border-slate-200 dark:border-[#1A2234] bg-slate-50/60 dark:bg-[#0D121F]/70 text-xs space-y-1.5 hover:border-indigo-400/50 transition-colors"
                  >
                    {/* Unit Meta Header */}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                          #{unit.sequence_number}
                        </span>
                        <span className="font-bold text-slate-800 dark:text-slate-200">
                          {unit.source_location_display}
                        </span>
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.2 rounded border uppercase border-slate-300 dark:border-[#2A344C] text-slate-500 dark:text-slate-400">
                          {unit.source_type}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopyUnitText(unit.id, unit.extracted_text)}
                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-1 rounded transition-colors cursor-pointer"
                        title="Copy text"
                      >
                        {copiedUnitId === unit.id ? (
                          <Check className="w-3.5 h-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>

                    {/* Unit Warnings (if any) */}
                    {unit.unit_warnings && unit.unit_warnings.length > 0 && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400 italic">
                        Warning: {unit.unit_warnings.join(' • ')}
                      </div>
                    )}

                    {/* Unit Text Body */}
                    <div className="bg-white dark:bg-[#080B10] p-2.5 rounded-lg border border-slate-200/60 dark:border-[#141A28] font-mono text-[11px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap select-text leading-relaxed">
                      {unit.extracted_text || <span className="text-slate-400 italic">Empty text</span>}
                    </div>
                  </div>
                ))
              ) : (
                <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
                  <FileText className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    No extracted units found
                  </p>
                  <p className="text-[11px]">
                    {unitsSearch || unitsSourceType !== 'ALL'
                      ? 'No units match your filter criteria.'
                      : 'This document has not been extracted yet or produced 0 units.'}
                  </p>
                </div>
              )}
            </div>

            {/* Pagination & Actions Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#1E2538] text-xs">
              <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                Showing page <span className="font-bold text-slate-700 dark:text-slate-200">{unitsPagination.page}</span> of{' '}
                <span className="font-bold text-slate-700 dark:text-slate-200">{unitsPagination.totalPages || 1}</span>{' '}
                ({unitsPagination.total} total units)
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={unitsPagination.page <= 1 || unitsLoading}
                  onClick={() => fetchUnitsData(activeDocForExtraction.id, activeVersionForExtraction, unitsPagination.page - 1, unitsSearch, unitsSourceType)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#222938] text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-[#161B26] disabled:opacity-40 cursor-pointer"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={unitsPagination.page >= unitsPagination.totalPages || unitsLoading}
                  onClick={() => fetchUnitsData(activeDocForExtraction.id, activeVersionForExtraction, unitsPagination.page + 1, unitsSearch, unitsSourceType)}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-[#222938] text-slate-600 dark:text-slate-300 font-semibold hover:bg-slate-50 dark:hover:bg-[#161B26] disabled:opacity-40 cursor-pointer"
                >
                  Next
                </button>

                <button
                  type="button"
                  disabled={reprocessingId === activeVersionForExtraction}
                  onClick={() => handleReprocessExtraction(activeDocForExtraction, activeVersionForExtraction)}
                  className="px-3.5 py-1.5 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ml-2"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${reprocessingId === activeVersionForExtraction ? 'animate-spin' : ''}`} />
                  <span>{reprocessingId === activeVersionForExtraction ? 'Reprocessing...' : 'Reprocess Version'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setExtractionModalOpen(false)}
                  className="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-[#1E2538] text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-200 dark:hover:bg-[#252E46] text-xs cursor-pointer ml-1"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================= */}
      {/* MODAL 8: Chunks & Dense Vector Embeddings Viewer (Phase 2.5)       */}
      {/* ================================================================= */}
      {chunksModalOpen && activeDocForChunks && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-2xl p-6 max-w-6xl w-full max-h-[92vh] flex flex-col shadow-2xl space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-[#1E2538]">
              <div className="flex items-center gap-3">
                <div className="brand-mark w-8 h-8 rounded-xl flex items-center justify-center text-white">
                  <Layers className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-extrabold text-[#1f2544] dark:text-white flex items-center gap-2">
                    <span>Document Chunks &amp; Local Embeddings</span>
                    <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                      {activeDocForChunks.title || activeDocForChunks.original_filename}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Model: <span className="font-semibold text-indigo-600 dark:text-indigo-400">nomic-embed-text (768-dim)</span> &bull; Total Chunks: <span className="font-semibold text-slate-700 dark:text-slate-300">{chunksTotalCount}</span> &bull; Status: <span className="font-bold text-emerald-600 dark:text-emerald-400">{activeIndexingDetails?.indexingStatus || 'COMPLETED'}</span>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setChunksModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Plain-Text Search Filter Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
              <div className="relative w-full sm:w-96">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Substring search in chunk content..."
                  value={chunksSearch}
                  onChange={(e) => {
                    const val = e.target.value;
                    setChunksSearch(val);
                    fetchChunksData(activeDocForChunks.id, activeVersionForChunks, val);
                  }}
                  className="w-full bg-slate-50 dark:bg-[#141926] border border-slate-200 dark:border-[#1F2637] text-xs text-slate-800 dark:text-slate-200 pl-8 pr-3 py-1.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
              </div>

              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Token estimation: <span className="font-mono text-indigo-600 dark:text-indigo-400 font-semibold">word_punctuation_heuristic_v1 (approximate)</span>
              </div>
            </div>

            {/* Dual Pane: Left Chunks List | Right Selected Chunk & Embedding */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 overflow-hidden min-h-[420px] max-h-[58vh]">
              {/* Left Pane: Chunks List (5 cols) */}
              <div className="md:col-span-5 overflow-y-auto space-y-2 pr-1 border-r border-slate-100 dark:border-[#161B26]">
                {chunksLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
                    <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
                    <p className="text-xs">Loading chunks...</p>
                  </div>
                ) : chunksList.length > 0 ? (
                  chunksList.map((chunk) => {
                    const isSelected = selectedChunkId === chunk.id;
                    return (
                      <div
                        key={chunk.id}
                        onClick={() => fetchChunkDetail(activeDocForChunks.id, activeVersionForChunks, chunk.id)}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition-all space-y-1.5 ${
                          isSelected
                            ? 'bg-indigo-50/80 dark:bg-indigo-950/40 border-indigo-500/50 shadow-xs'
                            : 'border-slate-200/80 dark:border-[#1A2234] bg-slate-50/40 dark:bg-[#0D121F]/50 hover:border-slate-300 dark:hover:border-[#2A344C]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300">
                            Chunk #{chunk.chunkIndex}
                          </span>
                          <span className="text-[10px] font-mono font-semibold text-slate-500 dark:text-slate-400">
                            ~{chunk.tokenCount} tokens (est.)
                          </span>
                        </div>

                        {chunk.sectionHeading && (
                          <div className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                            {chunk.sectionHeading}
                          </div>
                        )}

                        <div className="text-[11px] text-slate-600 dark:text-slate-400 line-clamp-2 font-mono">
                          {chunk.content}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
                    <Layers className="w-7 h-7 text-slate-300 dark:text-slate-600" />
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">No chunks found</p>
                    <p className="text-[11px] text-center px-4">
                      {chunksSearch ? 'No chunks match search criteria.' : 'Document has not been indexed yet.'}
                    </p>
                  </div>
                )}
              </div>

              {/* Right Pane: Chunk Text & Dense Vector Embedding (7 cols) */}
              <div className="md:col-span-7 overflow-y-auto space-y-3 pl-1 pr-1">
                {chunkDetailLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
                    <Loader2 className="w-7 h-7 animate-spin text-indigo-500" />
                    <p className="text-xs">Loading chunk detail &amp; vector...</p>
                  </div>
                ) : selectedChunkDetail ? (
                  <div className="space-y-3">
                    {/* Header with Provenance */}
                    <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-[#141926] border border-slate-200 dark:border-[#1E2538]">
                      <div>
                        <div className="font-bold text-xs text-slate-800 dark:text-white flex items-center gap-2">
                          <span>Chunk #{selectedChunkDetail.chunkIndex}</span>
                          {selectedChunkDetail.pageNumber && (
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                              Page {selectedChunkDetail.pageNumber}
                            </span>
                          )}
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                            ~{selectedChunkDetail.tokenCount} tokens (est.)
                          </span>
                        </div>
                        {selectedChunkDetail.sectionHeading && (
                          <div className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
                            {selectedChunkDetail.sectionHeading}
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopyChunkText(selectedChunkDetail.id, selectedChunkDetail.content)}
                        className="text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 p-1 rounded transition-colors cursor-pointer"
                        title="Copy chunk text"
                      >
                        {copiedChunkId === selectedChunkDetail.id ? (
                          <Check className="w-4 h-4 text-emerald-500" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    {/* Chunk Full Content */}
                    <div className="space-y-1">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Chunk Text Content
                      </div>
                      <div className="bg-white dark:bg-[#080B10] p-3 rounded-xl border border-slate-200 dark:border-[#141A28] font-mono text-[11px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap select-text leading-relaxed max-h-[220px] overflow-y-auto">
                        {selectedChunkDetail.content}
                      </div>
                    </div>

                    {/* Embedding Vector Section */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <span>Dense Vector Embedding Preview</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-mono">
                          pgvector 768 Dimensions (cosine metric)
                        </span>
                      </div>

                      {selectedChunkDetail.embedding && selectedChunkDetail.embedding.preview ? (
                        <div className="bg-slate-50 dark:bg-[#0A0E17] p-3 rounded-xl border border-slate-200 dark:border-[#1E2538] text-[10px] font-mono space-y-1.5">
                          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
                            <span>Model: <strong className="text-indigo-600 dark:text-indigo-400">{selectedChunkDetail.embedding.modelName || 'nomic-embed-text'}</strong></span>
                            <span>Dimensions: <strong className="text-emerald-600 dark:text-emerald-400">{selectedChunkDetail.embedding.dimensions}</strong></span>
                          </div>
                          <div className="p-2 rounded bg-white dark:bg-[#05080E] border border-slate-200/60 dark:border-[#121722] text-slate-500 dark:text-slate-400 overflow-x-auto whitespace-pre">
                            [{selectedChunkDetail.embedding.preview.sample.map(v => typeof v === 'number' ? v.toFixed(6) : v).join(', ')}, ... 768 dimensions total]
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300">
                          Embedding not found or pending generation.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
                    <Eye className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                    <p className="text-xs">Select a chunk on the left to view details and embedding vector preview.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-[#1E2538] text-xs">
              <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                Showing <span className="font-bold text-slate-700 dark:text-slate-200">{chunksList.length}</span> of{' '}
                <span className="font-bold text-slate-700 dark:text-slate-200">{chunksTotalCount}</span> total chunks
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={indexingInFlightId === activeVersionForChunks}
                  onClick={() => handleReindexDocument(activeDocForChunks, activeVersionForChunks)}
                  className="px-3.5 py-1.5 rounded-xl bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/20 font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${indexingInFlightId === activeVersionForChunks ? 'animate-spin' : ''}`} />
                  <span>{indexingInFlightId === activeVersionForChunks ? 'Re-indexing...' : 'Re-index Version'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setChunksModalOpen(false)}
                  className="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-[#1E2538] text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-200 dark:hover:bg-[#252E46] text-xs cursor-pointer ml-1"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 9: Knowledge Base Hybrid Retrieval Playground (Phase 2.6)       */}
      {/* ===================================================================== */}
      {retrievalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-[#0D121F] border border-slate-200 dark:border-[#222938] rounded-2xl w-full max-w-6xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-[#1E2538]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-500/10 dark:bg-violet-500/20 text-violet-600 dark:text-violet-400 flex items-center justify-center font-bold">
                  <Search className="w-5 h-5 text-violet-600 dark:text-violet-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-extrabold text-base text-slate-800 dark:text-white">
                      Knowledge Retrieval Playground
                    </h3>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950/60 text-violet-700 dark:text-violet-300 font-bold border border-violet-200 dark:border-violet-800">
                      Phase 2.6
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Hybrid Reciprocal Rank Fusion (pgvector 768 cosine similarity + PostgreSQL full-text search)
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setRetrievalModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-[#1E2538] transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Query Input & Toolbar */}
            <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-[#1E2538] bg-slate-50/60 dark:bg-[#0A0E17]/60 space-y-3">
              {/* Search Box */}
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3 pointer-events-none" />
                  <input
                    type="text"
                    value={retrievalQuery}
                    onChange={(e) => setRetrievalQuery(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !retrievalLoading && handleExecuteRetrieval()}
                    placeholder="Search requirements, error codes (e.g. ERR_AUTH_401), OAuth2, API specifications..."
                    className="w-full bg-white dark:bg-[#0D121F] border border-slate-200 dark:border-[#222938] text-xs font-medium text-slate-800 dark:text-white pl-10 pr-10 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-violet-500/30 placeholder-slate-400 shadow-xs"
                  />
                  {retrievalQuery && (
                    <button
                      type="button"
                      onClick={() => setRetrievalQuery('')}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  disabled={retrievalLoading || !retrievalQuery.trim()}
                  onClick={handleExecuteRetrieval}
                  className="px-5 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold shadow-magic flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-all shrink-0"
                >
                  {retrievalLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4 text-white" />
                  )}
                  <span>{retrievalLoading ? 'Searching...' : 'Search'}</span>
                </button>
              </div>

              {/* Mode Selector & Quick Filters */}
              <div className="flex flex-wrap items-center justify-between gap-2.5 pt-1 text-xs">
                {/* Search Mode Tabs */}
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-200/60 dark:bg-[#141A28] border border-slate-200/80 dark:border-[#1E2538]">
                  <button
                    type="button"
                    onClick={() => setRetrievalMode('HYBRID')}
                    className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer flex items-center gap-1.5 ${
                      retrievalMode === 'HYBRID'
                        ? 'bg-white dark:bg-[#0D121F] text-violet-600 dark:text-violet-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>Hybrid (RRF)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRetrievalMode('SEMANTIC')}
                    className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer flex items-center gap-1.5 ${
                      retrievalMode === 'SEMANTIC'
                        ? 'bg-white dark:bg-[#0D121F] text-indigo-600 dark:text-indigo-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Layers className="w-3 h-3" />
                    <span>Semantic (Dense)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setRetrievalMode('KEYWORD')}
                    className={`px-3 py-1.5 rounded-lg font-bold text-[11px] transition-all cursor-pointer flex items-center gap-1.5 ${
                      retrievalMode === 'KEYWORD'
                        ? 'bg-white dark:bg-[#0D121F] text-teal-600 dark:text-teal-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <FileCode className="w-3 h-3" />
                    <span>Keyword (FTS)</span>
                  </button>
                </div>

                {/* Filters: Doc Scope, Limits, Tuning Toggle */}
                <div className="flex flex-wrap items-center gap-2">
                  {/* Document Filter */}
                  <select
                    value={retrievalDocFilter}
                    onChange={(e) => setRetrievalDocFilter(e.target.value)}
                    className="bg-white dark:bg-[#0D121F] border border-slate-200 dark:border-[#222938] text-[11px] text-slate-700 dark:text-slate-300 font-medium px-2.5 py-1.5 rounded-lg focus:outline-none cursor-pointer"
                  >
                    <option value="">All Documents in Project</option>
                    {documents.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.title} ({d.original_filename})
                      </option>
                    ))}
                  </select>

                  {/* Limit */}
                  <select
                    value={retrievalLimit}
                    onChange={(e) => setRetrievalLimit(e.target.value)}
                    className="bg-white dark:bg-[#0D121F] border border-slate-200 dark:border-[#222938] text-[11px] text-slate-700 dark:text-slate-300 font-medium px-2 py-1.5 rounded-lg focus:outline-none cursor-pointer"
                    title="Result limit"
                  >
                    <option value="5">Top 5</option>
                    <option value="10">Top 10</option>
                    <option value="20">Top 20</option>
                    <option value="50">Top 50</option>
                  </select>

                  {/* Tuning Drawer Toggle */}
                  <button
                    type="button"
                    onClick={() => setShowAdvancedTuning(!showAdvancedTuning)}
                    className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                      showAdvancedTuning
                        ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/30'
                        : 'bg-white dark:bg-[#0D121F] text-slate-600 dark:text-slate-300 border-slate-200 dark:border-[#222938]'
                    }`}
                  >
                    <SlidersHorizontal className="w-3 h-3" />
                    <span>Tuning</span>
                  </button>
                </div>
              </div>

              {/* Advanced Tuning Panel */}
              {showAdvancedTuning && (
                <div className="p-3 rounded-xl bg-white dark:bg-[#0D121F] border border-slate-200 dark:border-[#1E2538] grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                      Semantic Weight ({retrievalSemanticWeight})
                    </label>
                    <input
                      type="range"
                      min="0.0"
                      max="3.0"
                      step="0.1"
                      value={retrievalSemanticWeight}
                      onChange={(e) => setRetrievalSemanticWeight(parseFloat(e.target.value))}
                      className="w-full accent-violet-600 cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                      Keyword Weight ({retrievalKeywordWeight})
                    </label>
                    <input
                      type="range"
                      min="0.0"
                      max="3.0"
                      step="0.1"
                      value={retrievalKeywordWeight}
                      onChange={(e) => setRetrievalKeywordWeight(parseFloat(e.target.value))}
                      className="w-full accent-violet-600 cursor-pointer"
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block mb-1">
                      RRF Constant k ({retrievalRrfK})
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      step="1"
                      value={retrievalRrfK}
                      onChange={(e) => setRetrievalRrfK(parseInt(e.target.value, 10))}
                      className="w-full accent-violet-600 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-3">
                    <input
                      type="checkbox"
                      id="retrievalFallbackCb"
                      checked={retrievalFallback}
                      onChange={(e) => setRetrievalFallback(e.target.checked)}
                      className="rounded accent-violet-600 cursor-pointer"
                    />
                    <label htmlFor="retrievalFallbackCb" className="text-[11px] text-slate-700 dark:text-slate-300 font-medium cursor-pointer">
                      Degrade to Keyword on Ollama offline
                    </label>
                  </div>
                </div>
              )}

              {/* Diagnostics Strip */}
              {retrievalDiagnostics && (
                <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-slate-100 dark:bg-[#141A28] border border-slate-200/60 dark:border-[#1E2538] text-[11px] font-mono">
                  <div className="flex items-center gap-3">
                    <span className="text-slate-500 dark:text-slate-400">
                      Total Latency: <strong className="text-emerald-600 dark:text-emerald-400">{retrievalDiagnostics.totalDurationMs}ms</strong>
                    </span>
                    <span className="text-slate-400 border-l border-slate-300 dark:border-slate-700 pl-2">
                      Embedding: <strong className="text-indigo-600 dark:text-indigo-400">{retrievalDiagnostics.embeddingLatencyMs}ms</strong>
                    </span>
                    <span className="text-slate-400 border-l border-slate-300 dark:border-slate-700 pl-2">
                      DB Execution: <strong className="text-violet-600 dark:text-violet-400">{retrievalDiagnostics.dbLatencyMs}ms</strong>
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {retrievalDiagnostics.degraded && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-[10px]">
                        DEGRADED (KEYWORD ONLY)
                      </span>
                    )}
                    <span className="text-slate-600 dark:text-slate-300">
                      <strong>{retrievalResults.length}</strong> hits from candidate pool ({retrievalDiagnostics.candidateLimit})
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Results Body: Split List & Detail */}
            <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-12 divide-y md:divide-y-0 md:divide-x divide-slate-100 dark:divide-[#1E2538] min-h-[380px]">
              {/* Left Column: Results List */}
              <div className="md:col-span-5 p-3 overflow-y-auto max-h-[520px] space-y-2">
                {retrievalLoading ? (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
                    <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
                    <p className="text-xs font-semibold">Running hybrid search &amp; RRF ranking...</p>
                  </div>
                ) : retrievalResults.length > 0 ? (
                  retrievalResults.map((item, idx) => {
                    const isSelected = selectedRetrievalItem?.chunkId === item.chunkId;
                    const isDualHit = item.scores.matchTypes.includes('SEMANTIC') && item.scores.matchTypes.includes('KEYWORD');
                    const badge = getFormatBadge(item.provenance.documentType);

                    return (
                      <div
                        key={item.chunkId}
                        onClick={() => setSelectedRetrievalItem(item)}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition-all space-y-2 ${
                          isSelected
                            ? 'bg-violet-50/70 dark:bg-violet-950/20 border-violet-500/40 shadow-xs'
                            : 'bg-white dark:bg-[#0D121F] border-slate-200/80 dark:border-[#1E2538] hover:border-violet-300 dark:hover:border-violet-900/50'
                        }`}
                      >
                        {/* Top Meta Row */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 overflow-hidden">
                            <span className="font-mono text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300">
                              #{idx + 1}
                            </span>
                            <div className="font-bold text-slate-800 dark:text-white truncate text-[11px]" title={item.provenance.documentTitle}>
                              {item.provenance.documentTitle}
                            </div>
                          </div>

                          <span className={`text-[10px] font-mono font-bold px-1.5 py-0.2 rounded border shrink-0 ${badge.bg}`}>
                            {badge.label}
                          </span>
                        </div>

                        {/* Location & Match Badges Row */}
                        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                          <span className="font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-[#141A28] text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-[#1E2538]">
                            {item.provenance.sourceLocationDisplay}
                          </span>

                          {isDualHit && (
                            <span className="font-bold px-1.5 py-0.5 rounded bg-gradient-to-r from-violet-500 to-indigo-600 text-white shadow-xs">
                              DUAL HIT
                            </span>
                          )}

                          {item.scores.semantic && (
                            <span className="font-mono px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-900/40">
                              Sem: {(item.scores.semantic.similarity * 100).toFixed(1)}%
                            </span>
                          )}

                          {item.scores.keyword && (
                            <span className="font-mono px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 border border-teal-200/60 dark:border-teal-900/40">
                              Key: {item.scores.keyword.score.toFixed(3)}
                            </span>
                          )}

                          {item.scores.rrfScore > 0 && (
                            <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 border border-purple-200/60 dark:border-purple-900/40 ml-auto">
                              RRF: {item.scores.rrfScore.toFixed(4)}
                            </span>
                          )}
                        </div>

                        {/* Snippet Preview */}
                        <p className="text-slate-600 dark:text-slate-300 text-[11px] line-clamp-2 leading-relaxed font-sans">
                          {item.content}
                        </p>
                      </div>
                    );
                  })
                ) : (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
                    <Search className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                    <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                      No search results yet
                    </p>
                    <p className="text-[11px] text-center max-w-xs">
                      Enter a query above to search your indexed documents across semantic and keyword channels.
                    </p>
                  </div>
                )}
              </div>

              {/* Right Column: Selected Result Provenance & Full Chunk */}
              <div className="md:col-span-7 p-4 overflow-y-auto max-h-[520px]">
                {selectedRetrievalItem ? (
                  <div className="space-y-4">
                    {/* Header Card */}
                    <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-[#141926] border border-slate-200 dark:border-[#1E2538] space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-bold text-sm text-slate-900 dark:text-white">
                            {selectedRetrievalItem.provenance.documentTitle}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            File: <strong className="font-mono text-slate-700 dark:text-slate-200">{selectedRetrievalItem.provenance.originalFilename}</strong>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleCopyCitationContent(selectedRetrievalItem.chunkId, selectedRetrievalItem.content)}
                          className="p-1.5 rounded-lg border border-slate-200 dark:border-[#222938] text-slate-500 hover:text-violet-600 dark:hover:text-violet-400 hover:bg-white dark:hover:bg-[#0D121F] transition-colors cursor-pointer"
                          title="Copy chunk content"
                        >
                          {copiedCitationId === selectedRetrievalItem.chunkId ? (
                            <Check className="w-4 h-4 text-emerald-500" />
                          ) : (
                            <Copy className="w-4 h-4" />
                          )}
                        </button>
                      </div>

                      {/* Source Provenance Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200/60 dark:border-[#1E2538] text-[10px] font-mono">
                        <div>
                          <span className="text-slate-400 block">Location:</span>
                          <span className="font-bold text-slate-700 dark:text-slate-200">{selectedRetrievalItem.provenance.sourceLocationDisplay}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Version:</span>
                          <span className="font-bold text-slate-700 dark:text-slate-200">v{selectedRetrievalItem.provenance.versionNumber}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Chunk Index:</span>
                          <span className="font-bold text-slate-700 dark:text-slate-200">#{selectedRetrievalItem.chunkIndex}</span>
                        </div>
                        <div>
                          <span className="text-slate-400 block">Tokens (est.):</span>
                          <span className="font-bold text-slate-700 dark:text-slate-200">~{selectedRetrievalItem.tokenCount}</span>
                        </div>
                      </div>
                    </div>

                    {/* Ranking & Score Breakdown Card */}
                    <div className="p-3.5 rounded-xl bg-violet-50/50 dark:bg-violet-950/20 border border-violet-200/60 dark:border-violet-900/30 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-violet-900 dark:text-violet-200 text-xs">
                          Reciprocal Rank Fusion Breakdown
                        </span>
                        <span className="font-mono font-extrabold text-sm text-violet-600 dark:text-violet-400">
                          RRF Score: {selectedRetrievalItem.scores.rrfScore.toFixed(5)}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono pt-1">
                        <div className="p-2 rounded-lg bg-white dark:bg-[#0D121F] border border-violet-200/60 dark:border-violet-900/40 space-y-1">
                          <div className="flex items-center justify-between text-indigo-600 dark:text-indigo-400 font-bold">
                            <span>Dense Vector Leg</span>
                            <span>{selectedRetrievalItem.scores.semantic ? `Rank #${selectedRetrievalItem.scores.semantic.rank}` : 'No Match'}</span>
                          </div>
                          {selectedRetrievalItem.scores.semantic && (
                            <div className="text-[10px] text-slate-600 dark:text-slate-300">
                              Cosine Similarity: <strong>{(selectedRetrievalItem.scores.semantic.similarity * 100).toFixed(2)}%</strong>
                            </div>
                          )}
                        </div>

                        <div className="p-2 rounded-lg bg-white dark:bg-[#0D121F] border border-violet-200/60 dark:border-violet-900/40 space-y-1">
                          <div className="flex items-center justify-between text-teal-600 dark:text-teal-400 font-bold">
                            <span>Full-Text Search Leg</span>
                            <span>{selectedRetrievalItem.scores.keyword ? `Rank #${selectedRetrievalItem.scores.keyword.rank}` : 'No Match'}</span>
                          </div>
                          {selectedRetrievalItem.scores.keyword && (
                            <div className="text-[10px] text-slate-600 dark:text-slate-300">
                              Rank Score: <strong>{selectedRetrievalItem.scores.keyword.score.toFixed(4)}</strong> ({selectedRetrievalItem.scores.matchLevel})
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Chunk Full Content */}
                    <div className="space-y-1.5">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        Full Extracted Chunk Content
                      </div>
                      <div className="bg-white dark:bg-[#080B10] p-3.5 rounded-xl border border-slate-200 dark:border-[#141A28] font-mono text-[11px] text-slate-800 dark:text-slate-200 whitespace-pre-wrap select-text leading-relaxed max-h-[220px] overflow-y-auto">
                        {selectedRetrievalItem.content}
                      </div>
                    </div>

                    {/* Metadata Section */}
                    {selectedRetrievalItem.provenance.metadata && Object.keys(selectedRetrievalItem.provenance.metadata).length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          Structured Provenance Metadata
                        </div>
                        <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-[#0D121F] border border-slate-200/60 dark:border-[#1E2538] font-mono text-[10px] text-slate-600 dark:text-slate-400 overflow-x-auto">
                          {JSON.stringify(selectedRetrievalItem.provenance.metadata, null, 2)}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="h-64 flex flex-col items-center justify-center text-slate-400 space-y-2">
                    <Eye className="w-8 h-8 text-slate-300 dark:text-slate-600" />
                    <p className="text-xs">Select a result on the left to inspect its citation provenance and RRF score.</p>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between p-3.5 sm:px-5 border-t border-slate-100 dark:border-[#1E2538] text-xs">
              <div className="text-slate-500 dark:text-slate-400 text-[11px]">
                Active Project: <strong className="text-slate-800 dark:text-white">{activeProject?.name || 'Selected Project'}</strong>
              </div>

              <button
                type="button"
                onClick={() => setRetrievalModalOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-[#1E2538] text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-200 dark:hover:bg-[#252E46] text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
