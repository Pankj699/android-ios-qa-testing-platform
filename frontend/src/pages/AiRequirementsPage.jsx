import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ListChecks,
  Plus,
  RefreshCw,
  Search,
  Filter,
  FileText,
  AlertCircle,
  CheckCircle2,
  Clock,
  Sparkles,
  Layers,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Trash2,
  Check,
  AlertTriangle,
  FileCode,
  Tag,
  ArrowRight,
  Paperclip,
  UploadCloud,
  X,
  FileSpreadsheet,
  Brain,
  Database
} from 'lucide-react';
import { api } from '../services/api';
import Tooltip from '../components/ui/Tooltip';
import { toast } from '../utils/toast';

const ALLOWED_ATTACHMENTS = ['pdf', 'docx', 'xlsx', 'csv', 'txt'];
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024; // 10 MB

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

function getStageInfo(stage, status, errorMessage) {
  if (status === 'FAILED') {
    return {
      title: 'Requirement Analysis Failed',
      description: errorMessage || 'An unexpected error occurred during execution.',
      color: 'red',
      isQueued: false
    };
  }
  if (status === 'COMPLETED') {
    return {
      title: 'Requirement Analysis Completed',
      description: 'Requirements, gap analysis, and citations generated and saved.',
      color: 'emerald',
      isQueued: false
    };
  }

  switch (stage) {
    case 'QUEUED':
    case 'CLAIMED':
    case 'QUEUED_FOR_INFERENCE':
    case 'ACQUIRING_LOCK':
      return {
        title: 'Queued — Waiting for Inference Lock',
        description: 'Another AI inference job is currently running on the server. Your job is safely queued and will begin inference as soon as the lock is freed.',
        color: 'amber',
        isQueued: true
      };
    case 'PARSING_ATTACHMENT':
      return {
        title: 'Parsing Task Inputs & Attachments',
        description: 'Extracting task description, requirements, and document attachment text...',
        color: 'indigo',
        isQueued: false
      };
    case 'RETRIEVING_KNOWLEDGE':
      return {
        title: 'Retrieving Knowledge Base Evidence',
        description: 'Querying project knowledge base via hybrid semantic embedding and keyword retrieval...',
        color: 'blue',
        isQueued: false
      };
    case 'GENERATING_ANALYSIS':
      return {
        title: 'Generating Requirements (AI Inference)',
        description: 'Inference lock acquired. Ollama is generating structured requirements with qwen2.5:3b-instruct...',
        color: 'purple',
        isQueued: false
      };
    case 'VALIDATING_SCHEMA':
      return {
        title: 'Validating Schema & Screening Citations',
        description: 'Verifying JSON schema against strict Ajv rules and screening evidence citations...',
        color: 'cyan',
        isQueued: false
      };
    case 'PERSISTING_REQUIREMENTS':
      return {
        title: 'Persisting Requirements & Traceability',
        description: 'Saving module requirements, workflows, and RTM links in database...',
        color: 'emerald',
        isQueued: false
      };
    default:
      return {
        title: `Processing Stage: ${stage || 'IN_PROGRESS'}`,
        description: 'Analysis workflow is running in the background...',
        color: 'indigo',
        isQueued: false
      };
  }
}

export default function AiRequirementsPage({ currentUser }) {
  // State: Projects
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    return localStorage.getItem('qa_ai_active_project_id') || '';
  });
  const [projectsLoading, setProjectsLoading] = useState(true);

  // State: Analyses
  const [analyses, setAnalyses] = useState([]);
  const [analysesLoading, setAnalysesLoading] = useState(false);
  const [selectedAnalysisId, setSelectedAnalysisId] = useState(null);
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  const [analysisDetailLoading, setAnalysisDetailLoading] = useState(false);

  // State: Requirements Filter
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [classificationFilter, setClassificationFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // State: Active Async Job Polling
  const [activeJob, setActiveJob] = useState(() => {
    try {
      const stored = localStorage.getItem('qa_ai_active_job');
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      return null;
    }
  });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!activeJob || !['PENDING', 'PROCESSING'].includes(activeJob.status)) {
      return;
    }
    const startMs = activeJob.submittedAt || (activeJob.createdAt ? new Date(activeJob.createdAt).getTime() : Date.now());
    setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));

    const interval = setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }, 1000);

    return () => clearInterval(interval);
  }, [activeJob?.jobId, activeJob?.status, activeJob?.submittedAt, activeJob?.createdAt]);

  const [pollingTimer, setPollingTimer] = useState(null);

  useEffect(() => {
    if (activeJob && ['PENDING', 'PROCESSING'].includes(activeJob.status)) {
      try {
        localStorage.setItem('qa_ai_active_job', JSON.stringify(activeJob));
      } catch (e) {}
    } else {
      try {
        localStorage.removeItem('qa_ai_active_job');
      } catch (e) {}
    }
  }, [activeJob]);

  // State: Submit Analysis Modal
  const [submitModalOpen, setSubmitModalOpen] = useState(false);
  const [ticketId, setTicketId] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDescription, setTaskDescription] = useState('');
  const [taskRawText, setTaskRawText] = useState('');
  const [attachmentFile, setAttachmentFile] = useState(null);
  const [saveToKb, setSaveToKb] = useState(false);
  const [retrievalMode, setRetrievalMode] = useState('HYBRID');
  const [candidateLimit, setCandidateLimit] = useState(10);
  const [submittingJob, setSubmittingJob] = useState(false);
  const fileInputRef = useRef(null);

  // State: Citation Drawer
  const [citationDrawerOpen, setCitationDrawerOpen] = useState(false);
  const [selectedCitation, setSelectedCitation] = useState(null);

  // State: Delete Analysis Modal
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [analysisToDelete, setAnalysisToDelete] = useState(null);
  const [deletingAnalysis, setDeletingAnalysis] = useState(false);

  // State: Approve Modal
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [reqToApprove, setReqToApprove] = useState(null);
  const [approvalNotes, setApprovalNotes] = useState('');
  const [approving, setApproving] = useState(false);

  // 1. Load Projects
  const loadProjects = useCallback(async () => {
    try {
      setProjectsLoading(true);
      const res = await api.getAiProjects();
      const list = res.data || [];
      setProjects(list);

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
      toast.error(err.message || 'Failed to load projects.');
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Handle Project Change
  const handleProjectSelect = (projectId) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('qa_ai_active_project_id', projectId);
    setSelectedAnalysisId(null);
    setCurrentAnalysis(null);
  };

  // 2. Load Analyses for Selected Project
  const loadAnalyses = useCallback(async (projectId) => {
    if (!projectId) {
      setAnalyses([]);
      return;
    }
    try {
      setAnalysesLoading(true);
      const res = await api.listRequirementAnalyses(projectId, { limit: 50 });
      const list = res.data?.analyses || [];
      setAnalyses(list);

      // Auto-select latest if none selected
      if (list.length > 0 && !selectedAnalysisId) {
        setSelectedAnalysisId(list[0].id);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to load requirement analyses.');
    } finally {
      setAnalysesLoading(false);
    }
  }, [selectedAnalysisId]);

  useEffect(() => {
    if (selectedProjectId) {
      loadAnalyses(selectedProjectId);
    }
  }, [selectedProjectId, loadAnalyses]);

  // 3. Load Selected Analysis Details
  const loadAnalysisDetails = useCallback(async (projectId, analysisId) => {
    if (!projectId || !analysisId) return;
    try {
      setAnalysisDetailLoading(true);
      const res = await api.getRequirementAnalysis(projectId, analysisId);
      setCurrentAnalysis(res.data);
    } catch (err) {
      toast.error(err.message || 'Failed to fetch analysis details.');
    } finally {
      setAnalysisDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId && selectedAnalysisId) {
      loadAnalysisDetails(selectedProjectId, selectedAnalysisId);
    }
  }, [selectedProjectId, selectedAnalysisId, loadAnalysisDetails]);

  // 4. Job Polling Effect
  useEffect(() => {
    if (!activeJob || !activeJob.jobId) return;

    const timer = setInterval(async () => {
      try {
        const res = await api.getRequirementJobStatus(activeJob.projectId, activeJob.jobId);
        const job = res.data;

        if (job) {
          setActiveJob(prev => ({
            ...prev,
            status: job.status,
            currentStage: job.current_stage,
            progressPercent: job.progress_percent,
            errorMessage: job.error_message,
            resultReference: job.result_reference,
            createdAt: job.created_at || prev?.createdAt,
            startedAt: job.started_at || prev?.startedAt,
            submittedAt: prev?.submittedAt || Date.now()
          }));

          if (job.status === 'COMPLETED') {
            clearInterval(timer);
            toast.success('Requirement analysis completed successfully!');
            const completedAnalysisId = job.result_reference?.analysisId;
            loadAnalyses(activeJob.projectId);
            if (completedAnalysisId) {
              setSelectedAnalysisId(completedAnalysisId);
            }
            setTimeout(() => setActiveJob(null), 5000);
          } else if (job.status === 'FAILED') {
            clearInterval(timer);
            toast.error(`Requirement analysis failed: ${job.error_message || 'Execution error'}`);
          }
        }
      } catch (err) {
        console.error('Job polling error:', err);
      }
    }, 1500);

    return () => clearInterval(timer);
  }, [activeJob, loadAnalyses]);

  // Submit Handler
  const handleSubmitAnalysis = async (e) => {
    e.preventDefault();
    if (!selectedProjectId) {
      toast.error('Please select an active project first.');
      return;
    }
    if (!taskTitle.trim()) {
      toast.error('Task title is required.');
      return;
    }

    try {
      setSubmittingJob(true);
      let res;

      if (attachmentFile) {
        const formData = new FormData();
        formData.append('title', taskTitle.trim());
        if (ticketId) formData.append('ticketId', ticketId.trim());
        if (taskDescription) formData.append('description', taskDescription.trim());
        if (taskRawText) formData.append('rawText', taskRawText.trim());
        formData.append('saveAttachmentToKb', saveToKb);
        formData.append('retrievalMode', retrievalMode);
        formData.append('candidateLimit', candidateLimit);
        formData.append('file', attachmentFile);

        res = await api.analyzeRequirements(selectedProjectId, formData);
      } else {
        res = await api.analyzeRequirementsJson(selectedProjectId, {
          title: taskTitle.trim(),
          ticketId: ticketId.trim(),
          description: taskDescription.trim(),
          rawText: taskRawText.trim(),
          saveAttachmentToKb: saveToKb,
          retrievalMode,
          candidateLimit
        });
      }

      const jobData = res.data;
      setSubmitModalOpen(false);
      resetSubmitForm();

      if (jobData && jobData.status === 'COMPLETED') {
        toast.info('Identical analysis already completed. Loaded cached result.');
        loadAnalyses(selectedProjectId);
        if (jobData.resultReference?.analysisId) {
          setSelectedAnalysisId(jobData.resultReference.analysisId);
        }
      } else {
        toast.success('Analysis job accepted! Processing in background...');
        setActiveJob({
          jobId: jobData.jobId,
          projectId: selectedProjectId,
          status: jobData.status,
          currentStage: jobData.currentStage,
          progressPercent: jobData.progressPercent || 5,
          submittedAt: Date.now()
        });
      }
    } catch (err) {
      toast.error(err.message || 'Failed to submit requirement analysis.');
    } finally {
      setSubmittingJob(false);
    }
  };

  const resetSubmitForm = () => {
    setTicketId('');
    setTaskTitle('');
    setTaskDescription('');
    setTaskRawText('');
    setAttachmentFile(null);
    setSaveToKb(false);
    setRetrievalMode('HYBRID');
    setCandidateLimit(10);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Safe Delete Handler
  const handleDeleteAnalysis = async () => {
    if (!analysisToDelete) return;
    try {
      setDeletingAnalysis(true);
      await api.deleteRequirementAnalysis(selectedProjectId, analysisToDelete.id);
      toast.success('Analysis session deleted. Active requirements and traceability links preserved.');
      setDeleteModalOpen(false);
      setAnalysisToDelete(null);
      if (selectedAnalysisId === analysisToDelete.id) {
        setSelectedAnalysisId(null);
        setCurrentAnalysis(null);
      }
      loadAnalyses(selectedProjectId);
    } catch (err) {
      toast.error(err.message || 'Failed to delete requirement analysis.');
    } finally {
      setDeletingAnalysis(false);
    }
  };

  // Explicit Human Approval Handler
  const handleApproveRequirement = async () => {
    if (!reqToApprove) return;
    try {
      setApproving(true);
      const res = await api.approveRequirement(selectedProjectId, reqToApprove.id, approvalNotes);
      toast.success(`Requirement ${reqToApprove.req_key} approved & promoted to ACTIVE.`);
      setApproveModalOpen(false);
      setReqToApprove(null);
      setApprovalNotes('');
      // Reload current analysis
      if (selectedAnalysisId) {
        loadAnalysisDetails(selectedProjectId, selectedAnalysisId);
      }
    } catch (err) {
      toast.error(err.message || 'Failed to approve requirement.');
    } finally {
      setApproving(false);
    }
  };

  // Filter requirements
  const filteredRequirements = (currentAnalysis?.requirements || []).filter(req => {
    if (statusFilter !== 'ALL' && req.status !== statusFilter) return false;
    if (categoryFilter !== 'ALL' && req.category !== categoryFilter) return false;
    if (classificationFilter !== 'ALL' && req.source_classification !== classificationFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchKey = (req.req_key || '').toLowerCase().includes(q);
      const matchTitle = (req.title || '').toLowerCase().includes(q);
      const matchDesc = (req.description || '').toLowerCase().includes(q);
      if (!matchKey && !matchTitle && !matchDesc) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6 fade-in pb-12 w-full">
      {/* Top Header & Project Context */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <ListChecks className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1f2544] dark:text-white tracking-tight font-sans">
                Requirement Analysis &amp; <span className="text-heading-gradient">Knowledge RAG</span>
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                Phase 2.7
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-[#6b7194] dark:text-[#94A3B8] mt-1">
              Transform development tickets into verified, knowledge-grounded testable requirements.
            </p>
          </div>
        </div>

        {/* Project Selector & Actions */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <select
              value={selectedProjectId}
              onChange={(e) => handleProjectSelect(e.target.value)}
              disabled={projectsLoading || projects.length === 0}
              className="w-full appearance-none bg-white dark:bg-[#0D121F] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] text-xs font-semibold text-[#1f2544] dark:text-white px-3.5 py-2.5 pr-8 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/30 cursor-pointer shadow-xs disabled:opacity-50"
            >
              {projects.length === 0 ? (
                <option value="">No projects available</option>
              ) : (
                projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              )}
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-3 pointer-events-none" />
          </div>

          <button
            onClick={() => setSubmitModalOpen(true)}
            disabled={!selectedProjectId}
            className="btn-magic text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-magic flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Plus className="w-4 h-4 text-white" />
            <span>Analyze Task</span>
          </button>
        </div>
      </div>

      {/* Active Job Progress Banner */}
      {activeJob && (() => {
        const stageInfo = getStageInfo(activeJob.currentStage, activeJob.status, activeJob.errorMessage);
        const formatElapsed = (sec) => {
          if (!sec || sec < 0) return '0s';
          const mins = Math.floor(sec / 60);
          const remSec = sec % 60;
          return mins > 0 ? `${mins}m ${remSec}s` : `${remSec}s`;
        };

        const colorStyles = {
          amber: {
            border: 'border-amber-500/30',
            bg: 'bg-amber-500/5 dark:bg-amber-950/20',
            text: 'text-amber-600 dark:text-amber-400',
            barBg: 'bg-amber-200/40 dark:bg-amber-900/40',
            bar: 'bg-amber-500'
          },
          blue: {
            border: 'border-blue-500/30',
            bg: 'bg-blue-500/5 dark:bg-blue-950/20',
            text: 'text-blue-600 dark:text-blue-400',
            barBg: 'bg-blue-200/40 dark:bg-blue-900/40',
            bar: 'bg-blue-600'
          },
          purple: {
            border: 'border-purple-500/30',
            bg: 'bg-purple-500/5 dark:bg-purple-950/20',
            text: 'text-purple-600 dark:text-purple-400',
            barBg: 'bg-purple-200/40 dark:bg-purple-900/40',
            bar: 'bg-purple-600'
          },
          cyan: {
            border: 'border-cyan-500/30',
            bg: 'bg-cyan-500/5 dark:bg-cyan-950/20',
            text: 'text-cyan-600 dark:text-cyan-400',
            barBg: 'bg-cyan-200/40 dark:bg-cyan-900/40',
            bar: 'bg-cyan-600'
          },
          emerald: {
            border: 'border-emerald-500/30',
            bg: 'bg-emerald-500/5 dark:bg-emerald-950/20',
            text: 'text-emerald-600 dark:text-emerald-400',
            barBg: 'bg-emerald-200/40 dark:bg-emerald-900/40',
            bar: 'bg-emerald-600'
          },
          red: {
            border: 'border-red-500/30',
            bg: 'bg-red-500/5 dark:bg-red-950/20',
            text: 'text-red-600 dark:text-red-400',
            barBg: 'bg-red-200/40 dark:bg-red-900/40',
            bar: 'bg-red-600'
          },
          indigo: {
            border: 'border-indigo-500/30',
            bg: 'bg-indigo-500/5 dark:bg-indigo-950/20',
            text: 'text-indigo-600 dark:text-indigo-400',
            barBg: 'bg-indigo-200/40 dark:bg-indigo-900/40',
            bar: 'bg-indigo-600'
          }
        };

        const theme = colorStyles[stageInfo.color] || colorStyles.indigo;

        return (
          <div className={`p-4 rounded-xl border ${theme.border} ${theme.bg} flex flex-col gap-2.5 transition-all`}>
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2.5 font-bold">
                {activeJob.status === 'FAILED' ? (
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                ) : activeJob.status === 'COMPLETED' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                ) : stageInfo.isQueued ? (
                  <Clock className="w-4 h-4 text-amber-500 animate-pulse flex-shrink-0" />
                ) : (
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-500 flex-shrink-0" />
                )}
                <span className={theme.text}>
                  {stageInfo.title}
                </span>
                {stageInfo.isQueued && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/20 text-amber-600 dark:text-amber-300 animate-pulse">
                    WAITING IN LINE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3 inline" />
                  Elapsed: <strong className="text-slate-700 dark:text-slate-200">{formatElapsed(elapsedSeconds)}</strong>
                </span>
                {activeJob.status !== 'FAILED' && (
                  <span className={`font-mono font-bold ${theme.text}`}>
                    {activeJob.progressPercent || 0}%
                  </span>
                )}
                {activeJob.status === 'FAILED' && (
                  <button
                    onClick={() => setActiveJob(null)}
                    className="p-1 rounded hover:bg-red-500/20 text-red-500 transition-colors"
                    title="Dismiss error"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Progress Bar */}
            {activeJob.status !== 'FAILED' && (
              <div className={`w-full ${theme.barBg} h-2 rounded-full overflow-hidden`}>
                <div
                  className={`${theme.bar} h-full rounded-full transition-all duration-300 ease-out`}
                  style={{ width: `${Math.max(5, activeJob.progressPercent || 5)}%` }}
                />
              </div>
            )}

            {/* Description / Meaningful Error */}
            <div className="flex items-center justify-between text-[11px]">
              <p className={activeJob.status === 'FAILED' ? 'text-red-600 dark:text-red-400 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                {stageInfo.description}
              </p>
              {stageInfo.isQueued && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400 italic">
                  Single-thread CPU inference lock active
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* Main Grid: Analyses List + Selected Analysis Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Analyses Sessions */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Analysis Sessions ({analyses.length})
            </h2>
            <button
              onClick={() => selectedProjectId && loadAnalyses(selectedProjectId)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-white"
              title="Refresh analyses"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${analysesLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-2 max-h-[750px] overflow-y-auto pr-1">
            {analysesLoading && analyses.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Loading sessions...</div>
            ) : analyses.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 border border-dashed rounded-xl border-slate-300 dark:border-slate-800">
                No analyses yet. Click "Analyze Task" to begin.
              </div>
            ) : (
              analyses.map((a) => {
                const isSelected = a.id === selectedAnalysisId;
                return (
                  <div
                    key={a.id}
                    onClick={() => setSelectedAnalysisId(a.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer relative group ${
                      isSelected
                        ? 'bg-indigo-50/80 dark:bg-indigo-950/30 border-indigo-500/40 shadow-xs'
                        : 'bg-white/60 dark:bg-[#141824]/60 border-slate-200/80 dark:border-[#22283a] hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {a.task_reference && (
                          <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 mb-1">
                            {a.task_reference}
                          </span>
                        )}
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {a.task_title || 'Untitled Task'}
                        </h4>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setAnalysisToDelete(a);
                          setDeleteModalOpen(true);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-rose-500/10 text-rose-500 transition-opacity"
                        title="Delete Session"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mt-2">
                      <span>{formatDate(a.created_at)}</span>
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                        a.grounding_mode === 'GROUNDED'
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                      }`}>
                        {a.grounding_mode || 'GROUNDED'}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Analysis Detailed Workspace */}
        <div className="lg:col-span-9 space-y-6">
          {analysisDetailLoading ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <p className="text-xs font-semibold">Loading requirement analysis details...</p>
            </div>
          ) : !currentAnalysis ? (
            <div className="p-12 text-center text-slate-400 glass border border-[rgba(99,102,241,0.12)] rounded-2xl">
              <ListChecks className="w-12 h-12 text-slate-400 mx-auto mb-3 opacity-40" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">No Analysis Selected</h3>
              <p className="text-xs text-slate-500 mt-1">Select an analysis session from the list or create a new one.</p>
            </div>
          ) : (
            <>
              {/* Executive Summary & Metadata Card */}
              <div className="glass p-5 rounded-2xl border border-[rgba(99,102,241,0.12)] space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 dark:border-slate-800 pb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {currentAnalysis.task_reference && (
                        <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                          {currentAnalysis.task_reference}
                        </span>
                      )}
                      <h2 className="text-base font-bold text-slate-900 dark:text-white">
                        {currentAnalysis.task_title}
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Model: <span className="font-mono text-slate-700 dark:text-slate-300">{currentAnalysis.model_name || 'qwen2.5:3b-instruct'}</span> • 
                      Grounding: <span className="font-semibold text-emerald-600 dark:text-emerald-400">{currentAnalysis.grounding_mode}</span> • 
                      Created: {formatDate(currentAnalysis.created_at)}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2.5 py-1 rounded-full font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                      {(currentAnalysis.requirements || []).length} Requirements
                    </span>
                  </div>
                </div>

                {/* Summary Text */}
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Scope & Objectives</h4>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed bg-slate-50/50 dark:bg-slate-900/40 p-3 rounded-xl border border-slate-200/40 dark:border-slate-800">
                    {currentAnalysis.analysis_summary}
                  </p>
                </div>

                {/* Gap Analysis Accordion / Alert */}
                {currentAnalysis.gap_analysis && (
                  <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 dark:bg-amber-950/20 space-y-3">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="w-4 h-4 text-amber-600" />
                      <span>Knowledge Gap & Ambiguity Analysis</span>
                    </div>

                    {/* Ambiguities */}
                    {(currentAnalysis.gap_analysis.ambiguities || []).length > 0 && (
                      <div className="text-xs">
                        <strong className="text-slate-800 dark:text-slate-200">Ambiguities Identified:</strong>
                        <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-1 space-y-0.5">
                          {currentAnalysis.gap_analysis.ambiguities.map((item, idx) => (
                            <li key={idx}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Conflicting Info */}
                    {(currentAnalysis.gap_analysis.conflicting_information || []).length > 0 && (
                      <div className="text-xs">
                        <strong className="text-rose-700 dark:text-rose-400">Conflicting Information:</strong>
                        <div className="mt-1 space-y-1">
                          {currentAnalysis.gap_analysis.conflicting_information.map((c, idx) => (
                            <div key={idx} className="p-2 rounded bg-rose-500/10 border border-rose-500/20 text-slate-700 dark:text-slate-300">
                              <span className="font-bold">{c.topic}:</span> {c.conflict_summary}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Open Questions */}
                    {(currentAnalysis.gap_analysis.open_questions || []).length > 0 && (
                      <div className="text-xs">
                        <strong className="text-slate-800 dark:text-slate-200">Open Questions:</strong>
                        <ul className="list-disc list-inside text-slate-600 dark:text-slate-400 mt-1 space-y-0.5">
                          {currentAnalysis.gap_analysis.open_questions.map((q, idx) => (
                            <li key={idx}>{q}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Requirements List & Filter Bar */}
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Status Tabs */}
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-semibold">
                      {['ALL', 'DRAFT', 'ACTIVE'].map((st) => (
                        <button
                          key={st}
                          onClick={() => setStatusFilter(st)}
                          className={`px-3 py-1 rounded-lg transition-all ${
                            statusFilter === st
                              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs font-bold'
                              : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                          }`}
                        >
                          {st}
                        </button>
                      ))}
                    </div>

                    {/* Category Filter */}
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="bg-white/80 dark:bg-[#141824] border border-slate-200 dark:border-slate-800 text-xs rounded-xl px-2.5 py-1.5 text-slate-700 dark:text-slate-300"
                    >
                      <option value="ALL">All Categories</option>
                      <option value="FUNCTIONAL">Functional</option>
                      <option value="PERFORMANCE">Performance</option>
                      <option value="SECURITY">Security</option>
                      <option value="RELIABILITY">Reliability</option>
                      <option value="COMPLIANCE">Compliance</option>
                    </select>

                    {/* Classification Filter */}
                    <select
                      value={classificationFilter}
                      onChange={(e) => setClassificationFilter(e.target.value)}
                      className="bg-white/80 dark:bg-[#141824] border border-slate-200 dark:border-slate-800 text-xs rounded-xl px-2.5 py-1.5 text-slate-700 dark:text-slate-300"
                    >
                      <option value="ALL">All Classifications</option>
                      <option value="DIRECT">Direct (from Task)</option>
                      <option value="GROUNDED_INFERENCE">Grounded Inference</option>
                      <option value="ASSUMPTION">Assumption</option>
                    </select>
                  </div>

                  {/* Search Input */}
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      placeholder="Search requirements..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 pr-3 py-1.5 text-xs bg-white/80 dark:bg-[#141824] border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-hidden focus:ring-1 focus:ring-indigo-500 text-slate-800 dark:text-white w-full sm:w-48"
                    />
                  </div>
                </div>

                {/* Requirements Cards */}
                <div className="space-y-4">
                  {filteredRequirements.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 border border-dashed rounded-xl border-slate-300 dark:border-slate-800">
                      No requirements match the active filter criteria.
                    </div>
                  ) : (
                    filteredRequirements.map((req) => {
                      const isActive = req.status === 'ACTIVE';
                      const citations = Array.isArray(req.evidence_citations) ? req.evidence_citations : [];

                      return (
                        <div
                          key={req.id}
                          className={`p-4 rounded-xl border transition-all space-y-3 ${
                            isActive
                              ? 'bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-500/30'
                              : 'bg-white/70 dark:bg-[#141824]/80 border-slate-200/80 dark:border-[#22283a]'
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded border border-indigo-500/20">
                                  {req.req_key}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  isActive
                                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 flex items-center gap-1'
                                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30'
                                }`}>
                                  {isActive && <ShieldCheck className="w-3 h-3" />}
                                  {req.status}
                                </span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                  {req.category}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  req.priority === 'CRITICAL' ? 'bg-rose-500/15 text-rose-600' :
                                  req.priority === 'HIGH' ? 'bg-orange-500/15 text-orange-600' :
                                  req.priority === 'MEDIUM' ? 'bg-blue-500/15 text-blue-600' :
                                  'bg-slate-500/15 text-slate-600'
                                }`}>
                                  {req.priority}
                                </span>
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                  req.source_classification === 'DIRECT' ? 'bg-indigo-500/10 text-indigo-600' :
                                  req.source_classification === 'GROUNDED_INFERENCE' ? 'bg-emerald-500/10 text-emerald-600' :
                                  'bg-amber-500/10 text-amber-600'
                                }`}>
                                  {req.source_classification}
                                </span>
                              </div>
                              <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-1.5">
                                {req.title}
                              </h3>
                            </div>

                            {/* Action: Approve Button or Immutable Locked Badge */}
                            <div className="shrink-0">
                              {isActive ? (
                                <Tooltip text="ACTIVE requirement is permanently immutable (protected against unauthorized edits/downgrades).">
                                  <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20 cursor-default">
                                    <ShieldCheck className="w-3.5 h-3.5" />
                                    <span>Locked (Active)</span>
                                  </div>
                                </Tooltip>
                              ) : (
                                <button
                                  onClick={() => {
                                    setReqToApprove(req);
                                    setApproveModalOpen(true);
                                  }}
                                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-xs"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Approve Requirement</span>
                                </button>
                              )}
                            </div>
                          </div>

                          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                            {req.description}
                          </p>

                          {/* Business Rules & Validations */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs pt-1">
                            {Array.isArray(req.business_rules) && req.business_rules.length > 0 && (
                              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200/50 dark:border-slate-800">
                                <span className="font-bold text-slate-600 dark:text-slate-400 block mb-1">Business Rules:</span>
                                <ul className="list-disc list-inside space-y-0.5 text-slate-700 dark:text-slate-300">
                                  {req.business_rules.map((rule, idx) => (
                                    <li key={idx}>{rule}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {Array.isArray(req.acceptance_criteria) && req.acceptance_criteria.length > 0 && (
                              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200/50 dark:border-slate-800">
                                <span className="font-bold text-slate-600 dark:text-slate-400 block mb-1">Acceptance Criteria:</span>
                                <ul className="list-disc list-inside space-y-0.5 text-slate-700 dark:text-slate-300">
                                  {req.acceptance_criteria.map((ac, idx) => (
                                    <li key={idx}>{ac}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          {/* Citations Row */}
                          {citations.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-slate-200/40 dark:border-slate-800/60">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Knowledge Evidence:</span>
                              {citations.map((c, cIdx) => (
                                <button
                                  key={cIdx}
                                  onClick={() => {
                                    setSelectedCitation(c);
                                    setCitationDrawerOpen(true);
                                  }}
                                  className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 border transition-all cursor-pointer ${
                                    c.evidenceStatus === 'PLAUSIBLE_SUPPORT'
                                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                                      : c.evidenceStatus === 'TOPICAL_AMBIGUOUS'
                                      ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20 hover:bg-amber-500/20'
                                      : 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20 hover:bg-slate-500/20'
                                  }`}
                                >
                                  <span>{c.evidenceKey || `E-${cIdx+1}`}</span>
                                  <span className="text-[9px] opacity-75">({c.evidenceStatus || 'EVIDENCE'})</span>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* MODAL 1: Submit Analysis */}
      {submitModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#141824] border border-[rgba(99,102,241,0.2)] rounded-2xl max-w-xl w-full p-6 space-y-4 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-500" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  New Requirement Analysis
                </h3>
              </div>
              <button
                onClick={() => setSubmitModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitAnalysis} className="space-y-4 text-xs">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-1">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Ticket ID (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. PAY-101"
                    value={ticketId}
                    onChange={(e) => setTicketId(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-slate-900 dark:text-white"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Task Title <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Add 2FA for high value transactions"
                    value={taskTitle}
                    onChange={(e) => setTaskTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-medium"
                  />
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Description / User Story
                </label>
                <textarea
                  rows={3}
                  placeholder="Paste task description, business context, or JIRA story..."
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Pasted Requirements / Acceptance Criteria
                </label>
                <textarea
                  rows={3}
                  placeholder="Optional pasted requirements text or technical specs..."
                  value={taskRawText}
                  onChange={(e) => setTaskRawText(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
                />
              </div>

              {/* Attachment Drag & Drop */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Attach Document (PDF, DOCX, XLSX, CSV, TXT - max 10MB)
                </label>
                <div
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  className="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-xl p-4 text-center hover:border-indigo-500 cursor-pointer transition-colors"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) {
                        if (file.size > MAX_ATTACHMENT_SIZE) {
                          toast.error('File size exceeds the 10 MB limit.');
                          return;
                        }
                        setAttachmentFile(file);
                      }
                    }}
                    accept=".pdf,.docx,.xlsx,.csv,.txt"
                    className="hidden"
                  />
                  {attachmentFile ? (
                    <div className="flex items-center justify-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold">
                      <Paperclip className="w-4 h-4" />
                      <span>{attachmentFile.name} ({formatBytes(attachmentFile.size)})</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-slate-500">
                      <UploadCloud className="w-6 h-6 text-slate-400" />
                      <span>Click or drag attachment here</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Retrieval Settings */}
              <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Knowledge Retrieval Mode
                  </label>
                  <select
                    value={retrievalMode}
                    onChange={(e) => setRetrievalMode(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-white"
                  >
                    <option value="HYBRID">Hybrid (Semantic + Keyword RRF)</option>
                    <option value="SEMANTIC">Semantic Only</option>
                    <option value="KEYWORD">Keyword Only</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 dark:text-slate-400 mb-1">
                    Max Evidence Chunks
                  </label>
                  <input
                    type="number"
                    min="3"
                    max="30"
                    value={candidateLimit}
                    onChange={(e) => setCandidateLimit(e.target.value)}
                    className="w-full px-2.5 py-1.5 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-800 dark:text-white"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSubmitModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingJob}
                  className="px-5 py-2 rounded-xl btn-magic text-white font-bold flex items-center gap-2 cursor-pointer shadow-sm"
                >
                  {submittingJob ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  <span>Start Analysis (HTTP 202)</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Citation Drawer */}
      {citationDrawerOpen && selectedCitation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#141824] border border-[rgba(99,102,241,0.2)] rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-500" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Evidence Citation: {selectedCitation.evidenceKey || 'Evidence'}
                </h3>
              </div>
              <button
                onClick={() => setCitationDrawerOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Screening Status:</span>
                <span className={`px-2 py-0.5 rounded font-bold ${
                  selectedCitation.evidenceStatus === 'PLAUSIBLE_SUPPORT'
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : selectedCitation.evidenceStatus === 'TOPICAL_AMBIGUOUS'
                    ? 'bg-amber-500/10 text-amber-600'
                    : 'bg-rose-500/10 text-rose-600'
                }`}>
                  {selectedCitation.evidenceStatus}
                </span>
              </div>

              {selectedCitation.documentTitle && (
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Source Document:</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-200">{selectedCitation.documentTitle}</span>
                </div>
              )}

              {selectedCitation.matchedEntities && selectedCitation.matchedEntities.length > 0 && (
                <div>
                  <span className="text-slate-500 block mb-1">Matched Technical Entities:</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedCitation.matchedEntities.map((ent, idx) => (
                      <span key={idx} className="font-mono text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                        {ent}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <span className="text-slate-500 block mb-1">Retrieved Chunk Snippet:</span>
                <div className="p-3 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 font-mono text-[11px] text-slate-700 dark:text-slate-300 max-h-48 overflow-y-auto">
                  {selectedCitation.snippet || 'No snippet available.'}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setCitationDrawerOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Human Approval */}
      {approveModalOpen && reqToApprove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#141824] border border-emerald-500/30 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
              <h3 className="text-base font-bold">Approve Requirement</h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Promoting <strong>{reqToApprove.req_key}</strong> from <span className="text-amber-500 font-bold">DRAFT</span> to <span className="text-emerald-500 font-bold">ACTIVE</span> will lock the requirement. Once ACTIVE, all 13 fields become permanently immutable to preserve test integrity.
            </p>

            <div className="text-xs">
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Optional Approval Notes / Signoff ID:
              </label>
              <input
                type="text"
                placeholder="e.g. Signed off by Lead QA"
                value={approvalNotes}
                onChange={(e) => setApprovalNotes(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setApproveModalOpen(false)}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleApproveRequirement}
                disabled={approving}
                className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-sm"
              >
                {approving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                <span>Confirm & Activate</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Safe Delete Session */}
      {deleteModalOpen && analysisToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-[#141824] border border-rose-500/30 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Trash2 className="w-5 h-5" />
              <h3 className="text-base font-bold">Delete Analysis Session</h3>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Are you sure you want to delete session <strong>"{analysisToDelete.task_title}"</strong>?
            </p>

            <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-[11px] text-emerald-700 dark:text-emerald-400 leading-relaxed">
              <strong>Safe Deletion Guarantee:</strong> Thanks to composite foreign key isolation, any requirements created from this session will remain completely intact in your project with their RTM traceability links preserved.
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={() => setDeleteModalOpen(false)}
                className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 font-bold text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteAnalysis}
                disabled={deletingAnalysis}
                className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center gap-2 cursor-pointer shadow-sm"
              >
                {deletingAnalysis ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                <span>Delete Session</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
