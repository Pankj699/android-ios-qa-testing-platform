import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Plus,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Layers,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  Check,
  X,
  FileText,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  Edit3,
  ArrowRight,
  Tag,
  BookOpen,
  HelpCircle,
  Send,
  Eye,
  CheckSquare,
  Square,
  UserCheck
} from 'lucide-react';
import { api } from '../services/api';
import Tooltip from '../components/ui/Tooltip';
import { toast } from '../utils/toast';

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

export default function AiTestWriterPage({ currentUser }) {
  // State: Projects
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    return localStorage.getItem('qa_ai_active_project_id') || '';
  });
  const [projectsLoading, setProjectsLoading] = useState(true);

  // State: Suites
  const [suites, setSuites] = useState([]);
  const [suitesLoading, setSuitesLoading] = useState(false);
  const [selectedSuiteId, setSelectedSuiteId] = useState(null);
  const [currentSuiteDetails, setCurrentSuiteDetails] = useState(null);
  const [suiteDetailLoading, setSuiteDetailLoading] = useState(false);

  // State: Active Job Polling
  const [activeJob, setActiveJob] = useState(() => {
    try {
      const stored = localStorage.getItem('qa_ai_tc_active_job');
      return stored ? JSON.parse(stored) : null;
    } catch (e) {
      return null;
    }
  });

  useEffect(() => {
    if (activeJob && ['PENDING', 'PROCESSING'].includes(activeJob.status)) {
      try {
        localStorage.setItem('qa_ai_tc_active_job', JSON.stringify(activeJob));
      } catch (e) {}
    } else {
      try {
        localStorage.removeItem('qa_ai_tc_active_job');
      } catch (e) {}
    }
  }, [activeJob]);

  // State: Generate Modal
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [activeRequirements, setActiveRequirements] = useState([]);
  const [reqsLoading, setReqsLoading] = useState(false);
  const [selectedReqIds, setSelectedReqIds] = useState([]);
  const [suiteTitle, setSuiteTitle] = useState('');
  const [targetModule, setTargetModule] = useState('Core');
  const [userContext, setUserContext] = useState('');
  const [submittingJob, setSubmittingJob] = useState(false);

  // State: Review Case Modal (Modify)
  const [editCaseModalOpen, setEditCaseModalOpen] = useState(false);
  const [caseToEdit, setCaseToEdit] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [editPriority, setEditPriority] = useState('MEDIUM');
  const [editPreconditions, setEditPreconditions] = useState('');
  const [editStepsText, setEditStepsText] = useState('');
  const [editExpectedResult, setEditExpectedResult] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [submittingReview, setSubmittingReview] = useState(false);

  // State: Approve Suite Modal
  const [approveSuiteModalOpen, setApproveSuiteModalOpen] = useState(false);
  const [suiteApprovalNotes, setSuiteApprovalNotes] = useState('');
  const [submittingSuiteApproval, setSubmittingSuiteApproval] = useState(false);

  // State: Active Sub-tab in Suite Detail ('cases', 'proposals', 'reviews')
  const [activeDetailTab, setActiveDetailTab] = useState('cases');

  // State: Collapsed scenarios
  const [collapsedScenarios, setCollapsedScenarios] = useState({});

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

  const handleProjectSelect = (projectId) => {
    setSelectedProjectId(projectId);
    localStorage.setItem('qa_ai_active_project_id', projectId);
    setSelectedSuiteId(null);
    setCurrentSuiteDetails(null);
  };

  // 2. Load Suites for Selected Project
  const loadSuites = useCallback(async (projectId) => {
    if (!projectId) {
      setSuites([]);
      return;
    }
    try {
      setSuitesLoading(true);
      const res = await api.listTestSuites(projectId);
      setSuites(res.data || []);
    } catch (err) {
      toast.error(err.message || 'Failed to load test suites.');
    } finally {
      setSuitesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId) {
      loadSuites(selectedProjectId);
    }
  }, [selectedProjectId, loadSuites]);

  // 3. Load Suite Details
  const loadSuiteDetails = useCallback(async (projectId, suiteId) => {
    if (!projectId || !suiteId) {
      setCurrentSuiteDetails(null);
      return;
    }
    try {
      setSuiteDetailLoading(true);
      const res = await api.getTestSuiteDetails(projectId, suiteId);
      setCurrentSuiteDetails(res.data);
    } catch (err) {
      toast.error(err.message || 'Failed to load suite details.');
    } finally {
      setSuiteDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProjectId && selectedSuiteId) {
      loadSuiteDetails(selectedProjectId, selectedSuiteId);
    }
  }, [selectedProjectId, selectedSuiteId, loadSuiteDetails]);

  // 4. Job Polling Effect
  useEffect(() => {
    if (!activeJob || !['PENDING', 'PROCESSING'].includes(activeJob.status)) return;

    const interval = setInterval(async () => {
      try {
        const pId = activeJob.project_id || activeJob.projectId || selectedProjectId;
        const jId = activeJob.job_id || activeJob.jobId || activeJob.id;
        if (!pId || !jId) return;

        const res = await api.getTestCaseJobStatus(pId, jId);
        const job = res.data;
        setActiveJob(job);

        if (job.status === 'COMPLETED') {
          toast.success('Test Case Generation completed successfully!');
          clearInterval(interval);
          loadSuites(pId);
          const sId = job.suite_id || job.result_reference?.suite_id;
          if (sId) {
            setSelectedSuiteId(sId);
          }
        } else if (job.status === 'FAILED') {
          toast.error(job.error_message || 'Test case generation failed.');
          clearInterval(interval);
        }
      } catch (e) {
        console.error('Job polling error:', e);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJob, selectedProjectId, loadSuites]);

  // 5. Open Generate Modal & Fetch Active Requirements
  const handleOpenGenerateModal = async () => {
    if (!selectedProjectId) {
      toast.error('Please select a project first.');
      return;
    }
    setGenerateModalOpen(true);
    setSuiteTitle('');
    setUserContext('');
    setSelectedReqIds([]);
    try {
      setReqsLoading(true);
      const res = await api.listRequirements(selectedProjectId, { status: 'ACTIVE' });
      const rawData = res?.data;
      const reqs = Array.isArray(rawData)
        ? rawData
        : (Array.isArray(rawData?.requirements) ? rawData.requirements : []);
      setActiveRequirements(reqs);
      // Auto-select all by default
      setSelectedReqIds(reqs.map(r => r.id));
    } catch (err) {
      setActiveRequirements([]);
      setSelectedReqIds([]);
      toast.error(err.message || 'Failed to load active requirements.');
    } finally {
      setReqsLoading(false);
    }
  };

  const toggleReqSelect = (id) => {
    setSelectedReqIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const handleSelectAllReqs = () => {
    const list = Array.isArray(activeRequirements) ? activeRequirements : [];
    if (selectedReqIds.length === list.length && list.length > 0) {
      setSelectedReqIds([]);
    } else {
      setSelectedReqIds(list.map(r => r.id));
    }
  };

  // Submit Generation Job
  const handleSubmitGeneration = async (e) => {
    e.preventDefault();
    if (!selectedProjectId) return;
    if (selectedReqIds.length === 0) {
      toast.error('Please select at least one active requirement.');
      return;
    }

    try {
      setSubmittingJob(true);
      const payload = {
        requirementIds: selectedReqIds,
        requirement_ids: selectedReqIds,
        moduleName: targetModule.trim() || suiteTitle.trim() || 'Core',
        target_module: targetModule.trim() || 'Core',
        suite_title: suiteTitle.trim() || undefined,
        user_context: userContext.trim() || undefined
      };

      const res = await api.generateTestCases(selectedProjectId, payload);
      const job = res.data;
      setActiveJob(job);
      setGenerateModalOpen(false);
      toast.info('Generation job submitted and queued.');
    } catch (err) {
      toast.error(err.message || 'Failed to submit generation job.');
    } finally {
      setSubmittingJob(false);
    }
  };

  // 6. Case Review Actions
  const handleApproveCase = async (tc) => {
    if (!selectedProjectId || !selectedSuiteId) return;
    try {
      await api.reviewTestCase(selectedProjectId, selectedSuiteId, tc.id, {
        action: 'APPROVED',
        notes: 'Approved via 1-click review'
      });
      toast.success(`Test case ${tc.test_case_key} approved.`);
      loadSuiteDetails(selectedProjectId, selectedSuiteId);
    } catch (err) {
      toast.error(err.message || 'Failed to approve test case.');
    }
  };

  const handleRejectCase = async (tc) => {
    if (!selectedProjectId || !selectedSuiteId) return;
    try {
      await api.reviewTestCase(selectedProjectId, selectedSuiteId, tc.id, {
        action: 'REJECTED',
        notes: 'Rejected by reviewer'
      });
      toast.success(`Test case ${tc.test_case_key} marked as rejected.`);
      loadSuiteDetails(selectedProjectId, selectedSuiteId);
    } catch (err) {
      toast.error(err.message || 'Failed to reject test case.');
    }
  };

  const handleOpenEditCase = (tc) => {
    setCaseToEdit(tc);
    setEditTitle(tc.title);
    setEditPriority(tc.priority);
    setEditPreconditions(tc.preconditions || '');
    setEditStepsText(
      Array.isArray(tc.test_steps) ? tc.test_steps.join('\n') : String(tc.test_steps || '')
    );
    setEditExpectedResult(tc.expected_result);
    setEditNotes('');
    setEditCaseModalOpen(true);
  };

  const handleSubmitCaseEdit = async (e) => {
    e.preventDefault();
    if (!caseToEdit || !selectedProjectId || !selectedSuiteId) return;

    const stepsArray = editStepsText
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    try {
      setSubmittingReview(true);
      await api.reviewTestCase(selectedProjectId, selectedSuiteId, caseToEdit.id, {
        action: 'MODIFIED',
        notes: editNotes.trim() || undefined,
        modifications: {
          title: editTitle.trim(),
          priority: editPriority,
          preconditions: editPreconditions.trim() || null,
          test_steps: stepsArray,
          expected_result: editExpectedResult.trim()
        }
      });
      toast.success(`Test case ${caseToEdit.test_case_key} modified & reviewed.`);
      setEditCaseModalOpen(false);
      loadSuiteDetails(selectedProjectId, selectedSuiteId);
    } catch (err) {
      toast.error(err.message || 'Failed to submit modifications.');
    } finally {
      setSubmittingReview(false);
    }
  };

  // 7. Suite Approval Actions
  const handleApproveSuite = async () => {
    if (!selectedProjectId || !selectedSuiteId) return;
    try {
      setSubmittingSuiteApproval(true);
      await api.reviewTestSuite(selectedProjectId, selectedSuiteId, {
        action: 'APPROVED',
        notes: suiteApprovalNotes.trim() || undefined
      });
      toast.success('Test Suite approved successfully!');
      setApproveSuiteModalOpen(false);
      loadSuiteDetails(selectedProjectId, selectedSuiteId);
      loadSuites(selectedProjectId);
    } catch (err) {
      toast.error(err.message || 'Failed to approve suite.');
    } finally {
      setSubmittingSuiteApproval(false);
    }
  };

  // 8. Proposal Actions
  const handleConvertProposal = async (proposalId, targetScenarioId) => {
    if (!selectedProjectId || !selectedSuiteId) return;
    try {
      await api.convertTestCaseProposal(selectedProjectId, selectedSuiteId, proposalId, {
        targetScenarioId
      });
      toast.success('Proposal converted to test case successfully!');
      loadSuiteDetails(selectedProjectId, selectedSuiteId);
    } catch (err) {
      toast.error(err.message || 'Failed to convert proposal.');
    }
  };

  const handleRejectProposal = async (proposalId) => {
    if (!selectedProjectId || !selectedSuiteId) return;
    try {
      await api.rejectTestCaseProposal(selectedProjectId, selectedSuiteId, proposalId);
      toast.success('Proposal rejected.');
      loadSuiteDetails(selectedProjectId, selectedSuiteId);
    } catch (err) {
      toast.error(err.message || 'Failed to reject proposal.');
    }
  };

  const toggleScenarioCollapse = (scenId) => {
    setCollapsedScenarios(prev => ({
      ...prev,
      [scenId]: !prev[scenId]
    }));
  };

  const activeProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="space-y-6 fade-in pb-12 w-full">
      {/* Top Header & Project Context */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[rgba(99,102,241,0.14)] dark:border-[#1C2230]">
        <div className="flex items-center gap-3.5">
          <div className="brand-mark w-10 h-10 rounded-2xl flex items-center justify-center text-white font-bold shrink-0 shadow-brand">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl sm:text-[26px] font-extrabold text-[#1f2544] dark:text-white tracking-tight font-sans">
                Test Case <span className="text-heading-gradient">Generation</span>
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20">
                Phase 2.8
              </span>
            </div>
            <p className="text-xs sm:text-[13px] text-[#6b7194] dark:text-[#94A3B8] mt-1">
              Knowledge-grounded test scenarios, Ajv validated test cases, and auditable human reviews.
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

          <Tooltip content="Refresh suites" side="bottom">
            <button
              onClick={() => {
                if (selectedProjectId) {
                  loadSuites(selectedProjectId);
                  if (selectedSuiteId) loadSuiteDetails(selectedProjectId, selectedSuiteId);
                }
              }}
              className="p-2.5 bg-white dark:bg-[#0D121F] hover:bg-slate-50 dark:hover:bg-[#161B26] border border-[rgba(99,102,241,0.2)] dark:border-[#222938] rounded-xl text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${suitesLoading || suiteDetailLoading ? 'animate-spin' : ''}`} />
            </button>
          </Tooltip>

          <button
            onClick={handleOpenGenerateModal}
            disabled={!selectedProjectId}
            className="btn-magic text-white text-xs font-bold px-4 py-2.5 rounded-xl shadow-magic flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
          >
            <Sparkles className="w-4 h-4 text-white" />
            <span>Generate Test Cases</span>
          </button>
        </div>
      </div>

      {/* Active Polling Progress Bar */}
      {activeJob && ['PENDING', 'PROCESSING'].includes(activeJob.status) && (
        <div className="p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5 dark:bg-indigo-950/20 flex flex-col gap-2">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2 font-bold text-indigo-600 dark:text-indigo-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Generating Test Cases: <strong>{activeJob.step_description || 'Synthesizing test scenarios...'}</strong></span>
            </div>
            <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">
              {activeJob.progress_percentage || 25}%
            </span>
          </div>
          <div className="w-full bg-indigo-200/40 dark:bg-indigo-900/40 h-2 rounded-full overflow-hidden">
            <div
              className="bg-indigo-600 h-full rounded-full transition-all duration-300 ease-out"
              style={{ width: `${Math.max(5, activeJob.progress_percentage || 25)}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Corpus verified &amp; pinned • Dual-connection inference lock active
          </p>
        </div>
      )}

      {/* Main Grid: Suites List (25%) + Selected Suite Workspace (75%) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Test Suites List */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Test Suites ({suites.length})
            </h2>
            <button
              onClick={() => selectedProjectId && loadSuites(selectedProjectId)}
              className="p-1 rounded-md text-slate-400 hover:text-slate-600 dark:hover:text-white cursor-pointer"
              title="Refresh suites"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${suitesLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          <div className="space-y-2 max-h-[750px] overflow-y-auto pr-1">
            {suitesLoading && suites.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400">Loading suites...</div>
            ) : suites.length === 0 ? (
              <div className="p-8 text-center text-slate-400 border border-dashed rounded-xl border-slate-300 dark:border-slate-800">
                <Layers className="w-8 h-8 mx-auto mb-2 opacity-40" />
                <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">No test suites found</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Click "Generate Test Cases" to create one.
                </p>
              </div>
            ) : (
              suites.map((s) => {
                const isSelected = s.id === selectedSuiteId;
                return (
                  <div
                    key={s.id}
                    onClick={() => setSelectedSuiteId(s.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer relative group ${
                      isSelected
                        ? 'bg-indigo-50/80 dark:bg-indigo-950/30 border-indigo-500/40 shadow-xs'
                        : 'bg-white/60 dark:bg-[#141824]/60 border-slate-200/80 dark:border-[#22283a] hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-mono font-bold text-indigo-600 dark:text-indigo-400">
                        {s.suite_key}
                      </span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          s.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                            : s.status === 'REVIEW_PENDING'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <h3 className="text-xs font-bold text-slate-900 dark:text-white mt-1.5 line-clamp-1">
                      {s.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Module: <strong className="text-slate-700 dark:text-slate-300 font-medium">{s.target_module}</strong></span>
                      <span>•</span>
                      <span>{s.test_case_count || 0} cases</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Suite Details */}
        <div className="lg:col-span-9 space-y-6">
          {!selectedSuiteId ? (
            <div className="p-12 text-center text-slate-400 glass border border-[rgba(99,102,241,0.12)] rounded-2xl">
              <Layers className="w-12 h-12 text-slate-400 mx-auto mb-3 opacity-40" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300">
                No Suite Selected
              </h3>
              <p className="text-xs text-slate-500 max-w-sm mt-1 mx-auto">
                Select a test suite from the left sidebar or click "Generate Test Cases" to run AI test generation.
              </p>
            </div>
          ) : suiteDetailLoading ? (
            <div className="p-12 text-center text-slate-400 flex flex-col items-center gap-3 glass border border-[rgba(99,102,241,0.12)] rounded-2xl">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <span className="text-xs font-medium">Loading suite details &amp; scenarios...</span>
            </div>
          ) : !currentSuiteDetails ? (
            <div className="p-8 text-center text-rose-500 glass border border-rose-500/20 rounded-2xl">
              Failed to load suite details.
            </div>
          ) : (
            <div className="space-y-6">
              {/* Suite Overview Header Card */}
              <div className="glass p-5 rounded-2xl border border-[rgba(99,102,241,0.14)] dark:border-[#1E2638] shadow-glass">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-600 dark:text-slate-300">
                        {currentSuiteDetails.suite.suite_key}
                      </span>
                      <span
                        className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                          currentSuiteDetails.suite.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                            : currentSuiteDetails.suite.status === 'REVIEW_PENDING'
                            ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {currentSuiteDetails.suite.status}
                      </span>
                    </div>
                    <h2 className="text-base font-extrabold text-slate-900 dark:text-white mt-1.5">
                      {currentSuiteDetails.suite.title}
                    </h2>
                    {currentSuiteDetails.suite.objective && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-3xl leading-relaxed">
                        {currentSuiteDetails.suite.objective}
                      </p>
                    )}
                  </div>

                  {/* Suite Action Buttons */}
                  <div className="flex items-center gap-2">
                    {currentSuiteDetails.suite.status !== 'APPROVED' && (
                      <button
                        onClick={() => setApproveSuiteModalOpen(true)}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow-sm transition-all cursor-pointer"
                      >
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>Approve Suite</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Statistics Row */}
                <div className="grid grid-cols-5 gap-3 mt-4 pt-4 border-t border-slate-100 dark:border-slate-800/60 text-center">
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Scenarios</span>
                    <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                      {currentSuiteDetails.statistics.total_scenarios}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Test Cases</span>
                    <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                      {currentSuiteDetails.statistics.total_test_cases}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Proposals</span>
                    <p className="text-sm font-extrabold text-slate-800 dark:text-slate-200 mt-0.5">
                      {currentSuiteDetails.statistics.total_proposals}
                    </p>
                  </div>
                  <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Approved</span>
                    <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {currentSuiteDetails.statistics.approved_cases}
                    </p>
                  </div>
                  <div className={`p-2 rounded-lg ${
                    currentSuiteDetails.statistics.unresolved_behavior_cases > 0
                      ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50'
                      : 'bg-slate-50 dark:bg-slate-900/40'
                  }`}>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Clarifications</span>
                    <p className={`text-sm font-extrabold mt-0.5 ${
                      currentSuiteDetails.statistics.unresolved_behavior_cases > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-slate-800 dark:text-slate-200'
                    }`}>
                      {currentSuiteDetails.statistics.unresolved_behavior_cases}
                    </p>
                  </div>
                </div>

                {/* Clarification Gating Warning Alert */}
                {currentSuiteDetails.statistics.unresolved_behavior_cases > 0 && (
                  <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 rounded-lg flex items-start gap-3">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs">
                      <span className="font-bold text-amber-800 dark:text-amber-300">
                        Unresolved Behavior Warning (Approval Gated):
                      </span>
                      <p className="text-amber-700 dark:text-amber-400 mt-0.5">
                        {currentSuiteDetails.statistics.unresolved_behavior_cases} test case(s) contain{' '}
                        <code className="font-mono bg-amber-100 dark:bg-amber-900/40 px-1 py-0.5 rounded">
                          [NEEDS_CLARIFICATION]
                        </code>{' '}
                        expected behavior. The suite cannot be approved until each case is reviewed and either approved or modified by an engineer.
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Detail Navigation Tabs */}
              <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
                <button
                  onClick={() => setActiveDetailTab('cases')}
                  className={`px-4 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                    activeDetailTab === 'cases'
                      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  Scenarios & Test Cases ({currentSuiteDetails.statistics.total_test_cases})
                </button>
                <button
                  onClick={() => setActiveDetailTab('proposals')}
                  className={`px-4 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeDetailTab === 'proposals'
                      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <span>Proposals</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-[10px]">
                    {currentSuiteDetails.proposals.length}
                  </span>
                </button>
                <button
                  onClick={() => setActiveDetailTab('reviews')}
                  className={`px-4 py-2 text-xs font-bold border-b-2 transition-all cursor-pointer flex items-center gap-1.5 ${
                    activeDetailTab === 'reviews'
                      ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                      : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <span>Human Review Audit</span>
                  <span className="px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 text-[10px]">
                    {currentSuiteDetails.reviews.length}
                  </span>
                </button>
              </div>

              {/* Sub-Tab 1: Scenarios & Test Cases */}
              {activeDetailTab === 'cases' && (
                <div className="space-y-4">
                  {currentSuiteDetails.scenarios.map((scen) => {
                    const isCollapsed = collapsedScenarios[scen.id];
                    return (
                      <div
                        key={scen.id}
                        className="bg-white dark:bg-[#0A0D14] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs"
                      >
                        {/* Scenario Header */}
                        <div
                          onClick={() => toggleScenarioCollapse(scen.id)}
                          className="px-4 py-3 bg-slate-50/70 dark:bg-slate-900/50 flex items-center justify-between cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-900/80 transition-colors"
                        >
                          <div className="flex items-center gap-2.5">
                            {isCollapsed ? (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            ) : (
                              <ChevronDown className="w-4 h-4 text-slate-400" />
                            )}
                            <span className="text-xs font-mono font-bold text-slate-500">
                              {scen.scenario_key}
                            </span>
                            <span className="text-xs font-extrabold text-slate-900 dark:text-white">
                              {scen.title}
                            </span>
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-400">
                              {scen.scenario_type}
                            </span>
                          </div>
                          <span className="text-xs text-slate-400">
                            {scen.test_cases?.length || 0} cases
                          </span>
                        </div>

                        {/* Scenario Test Cases */}
                        {!isCollapsed && (
                          <div className="p-4 space-y-3 divide-y divide-slate-100 dark:divide-slate-800/60">
                            {scen.test_cases?.map((tc, idx) => {
                              const hasClarification = (tc.expected_result || '').includes('NEEDS_CLARIFICATION');
                              const isUnreviewed = hasClarification && !['ACCEPTED', 'MODIFIED', 'APPROVED'].includes(tc.review_status);

                              return (
                                <div key={tc.id} className={`${idx > 0 ? 'pt-3' : ''}`}>
                                  {/* Case Header */}
                                  <div className="flex items-start justify-between gap-4">
                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono font-bold text-slate-700 dark:text-slate-300">
                                          {tc.test_case_key}
                                        </span>
                                        <span className="text-xs font-bold text-slate-900 dark:text-white">
                                          {tc.title}
                                        </span>
                                        <span
                                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                            tc.priority === 'CRITICAL'
                                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                                              : tc.priority === 'HIGH'
                                              ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/60 dark:text-orange-400'
                                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                          }`}
                                        >
                                          {tc.priority}
                                        </span>
                                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400">
                                          {tc.source_classification}
                                        </span>
                                        <span
                                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                            ['ACCEPTED', 'APPROVED'].includes(tc.review_status)
                                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                                              : tc.review_status === 'MODIFIED'
                                              ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400'
                                              : tc.review_status === 'REJECTED'
                                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                                              : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                                          }`}
                                        >
                                          {tc.review_status}
                                        </span>
                                      </div>

                                      {/* Preconditions */}
                                      {tc.preconditions && (
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                          <span className="font-semibold text-slate-600 dark:text-slate-300">Preconditions:</span>{' '}
                                          {tc.preconditions}
                                        </p>
                                      )}
                                    </div>

                                    {/* Action Buttons */}
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <button
                                        onClick={() => handleApproveCase(tc)}
                                        className="p-1.5 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 rounded transition-colors"
                                        title="Approve Test Case"
                                      >
                                        <Check className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => handleOpenEditCase(tc)}
                                        className="p-1.5 text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded transition-colors"
                                        title="Modify / Edit Test Case"
                                      >
                                        <Edit3 className="w-4 h-4" />
                                      </button>
                                      <button
                                        onClick={() => handleRejectCase(tc)}
                                        className="p-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded transition-colors"
                                        title="Reject Test Case"
                                      >
                                        <X className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>

                                  {/* Steps & Expected Results Box */}
                                  <div className="mt-2.5 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/50 text-xs space-y-2">
                                    <div>
                                      <span className="font-bold text-slate-600 dark:text-slate-300">Test Steps:</span>
                                      <ol className="list-decimal list-inside mt-1 space-y-0.5 text-slate-700 dark:text-slate-300">
                                        {Array.isArray(tc.test_steps) ? (
                                          tc.test_steps.map((st, sIdx) => <li key={sIdx}>{st}</li>)
                                        ) : (
                                          <li>{String(tc.test_steps)}</li>
                                        )}
                                      </ol>
                                    </div>

                                    <div>
                                      <span className="font-bold text-slate-600 dark:text-slate-300">Expected Result:</span>
                                      <div className="mt-1 whitespace-pre-line text-slate-700 dark:text-slate-300 leading-relaxed font-sans">
                                        {tc.expected_result}
                                      </div>
                                    </div>

                                    {/* Clarification Alert Pill */}
                                    {isUnreviewed && (
                                      <div className="p-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded flex items-center gap-2 text-[11px] text-amber-800 dark:text-amber-300 font-semibold">
                                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                                        <span>Gating Warning: Contains unreviewed clarification behavior. Requires review.</span>
                                      </div>
                                    )}

                                    {/* Traceability Tags */}
                                    {tc.traceability && tc.traceability.length > 0 && (
                                      <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                                        <span className="text-[10px] font-bold text-slate-400">Traces To:</span>
                                        {tc.traceability.map((tr, tIdx) => (
                                          <span
                                            key={tIdx}
                                            className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60"
                                            title={tr.requirement_title}
                                          >
                                            {tr.requirement_key} ({tr.trace_type || 'DIRECT'})
                                          </span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Sub-Tab 2: Proposals */}
              {activeDetailTab === 'proposals' && (
                <div className="space-y-3">
                  {currentSuiteDetails.proposals.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 bg-white dark:bg-[#0A0D14] border border-slate-200 dark:border-slate-800 rounded-xl">
                      <HelpCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                      <p className="text-xs font-medium">No exploratory proposals in this suite.</p>
                    </div>
                  ) : (
                    currentSuiteDetails.proposals.map((prop) => (
                      <div
                        key={prop.id}
                        className="p-4 bg-white dark:bg-[#0A0D14] border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs space-y-2"
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-bold text-slate-500">
                                {prop.proposal_key}
                              </span>
                              <span className="text-xs font-bold text-slate-900 dark:text-white">
                                {prop.title}
                              </span>
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  prop.status === 'CONVERTED'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                                    : prop.status === 'REJECTED'
                                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                                    : prop.status === 'TARGET_DELETED'
                                    ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-400'
                                }`}
                              >
                                {prop.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">
                              Target Scenario: <span className="font-semibold text-slate-700 dark:text-slate-300">{prop.scenario_name}</span>
                            </p>
                          </div>

                          {prop.status === 'PROPOSED' && (
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleConvertProposal(prop.id)}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-all cursor-pointer"
                              >
                                <CheckSquare className="w-3.5 h-3.5" />
                                <span>Convert to Test Case</span>
                              </button>
                              <button
                                onClick={() => handleRejectProposal(prop.id)}
                                className="p-1.5 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                                title="Reject Proposal"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          )}
                        </div>

                        {prop.description && (
                          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                            {prop.description}
                          </p>
                        )}

                        {prop.converted_test_case_key_snapshot && (
                          <div className="p-2 bg-slate-50 dark:bg-slate-900/40 rounded text-[11px] text-slate-500 font-mono">
                            Linked Formal Case Snapshot: {prop.converted_test_case_key_snapshot} (Status: {prop.status})
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* Sub-Tab 3: Human Review Audit */}
              {activeDetailTab === 'reviews' && (
                <div className="bg-white dark:bg-[#0A0D14] border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
                  <div className="p-3 bg-slate-50/70 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-500 uppercase">
                    Audit Trail Records ({currentSuiteDetails.reviews.length})
                  </div>
                  {currentSuiteDetails.reviews.length === 0 ? (
                    <div className="p-8 text-center text-slate-400 text-xs">
                      No reviews recorded yet for this suite.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {currentSuiteDetails.reviews.map((rev) => (
                        <div key={rev.id} className="p-4 text-xs space-y-1.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                                  rev.review_action === 'APPROVED'
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400'
                                    : rev.review_action === 'MODIFIED'
                                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-400'
                                    : 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-400'
                                }`}
                              >
                                {rev.review_action}
                              </span>
                              <span className="font-mono font-semibold text-slate-600 dark:text-slate-300">
                                Target: {rev.test_case_key_snapshot || rev.suite_key_snapshot || 'Suite'}
                              </span>
                            </div>
                            <span className="text-slate-400 text-[11px]">
                              {formatDate(rev.created_at)}
                            </span>
                          </div>

                          {rev.reviewer_notes && (
                            <p className="text-slate-600 dark:text-slate-300 italic">
                              "{rev.reviewer_notes}"
                            </p>
                          )}

                          <div className="text-[11px] text-slate-400 font-mono">
                            Snapshot Suite: {rev.suite_key_snapshot} • Case: {rev.test_case_key_snapshot || 'N/A'}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Generate Modal */}
      {generateModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0E131F] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Generate Test Cases with AI
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Pins active knowledge corpus & synthesizes validated test scenarios
                  </p>
                </div>
              </div>
              <button
                onClick={() => setGenerateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitGeneration} className="flex-1 overflow-y-auto p-6 space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Suite Title (Optional)
                </label>
                <input
                  type="text"
                  value={suiteTitle}
                  onChange={(e) => setSuiteTitle(e.target.value)}
                  placeholder="e.g. Authentication & Token Lifecycle Test Suite"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-indigo-500 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Target Module
                </label>
                <input
                  type="text"
                  value={targetModule}
                  onChange={(e) => setTargetModule(e.target.value)}
                  placeholder="e.g. Auth, Billing, Core"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-indigo-500 dark:text-white"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Active Requirements ({selectedReqIds.length} / {activeRequirements.length} selected)
                  </label>
                  <button
                    type="button"
                    onClick={handleSelectAllReqs}
                    disabled={activeRequirements.length === 0}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {selectedReqIds.length === activeRequirements.length && activeRequirements.length > 0 ? 'Deselect All' : 'Select All'}
                  </button>
                </div>

                <div className="border border-slate-200 dark:border-slate-800 rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
                  {reqsLoading ? (
                    <div className="p-4 text-center text-xs text-slate-400">Loading requirements...</div>
                  ) : activeRequirements.length === 0 ? (
                    <div className="p-4 text-center text-xs text-slate-400">
                      No ACTIVE requirements found. Please approve requirements in Requirements Analysis first.
                    </div>
                  ) : (
                    activeRequirements.map((r) => {
                      const isChecked = selectedReqIds.includes(r.id);
                      return (
                        <div
                          key={r.id}
                          onClick={() => toggleReqSelect(r.id)}
                          className="px-3 py-2 flex items-center gap-3 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/60"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {}}
                            className="rounded text-indigo-600 focus:ring-0 cursor-pointer"
                          />
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-mono font-bold text-indigo-600 dark:text-indigo-400 mr-2">
                              {r.req_key}
                            </span>
                            <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                              {r.title}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  User Context / Specific QA Directives (Optional)
                </label>
                <textarea
                  value={userContext}
                  onChange={(e) => setUserContext(e.target.value)}
                  rows={3}
                  placeholder="e.g. Focus on edge cases with expired refresh tokens and rate limit headers."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-indigo-500 dark:text-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setGenerateModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingJob || selectedReqIds.length === 0}
                  className="flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white text-xs font-bold rounded-lg shadow-sm disabled:opacity-50 transition-all cursor-pointer"
                >
                  {submittingJob ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Submitting Job...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Start Generation</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Test Case Modal */}
      {editCaseModalOpen && caseToEdit && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0E131F] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Modify & Review Test Case: {caseToEdit.test_case_key}
              </h3>
              <button onClick={() => setEditCaseModalOpen(false)}>
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>

            <form onSubmit={handleSubmitCaseEdit} className="p-6 overflow-y-auto space-y-3 flex-1">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-indigo-500 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Priority
                </label>
                <select
                  value={editPriority}
                  onChange={(e) => setEditPriority(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-indigo-500 dark:text-white"
                >
                  <option value="LOW">LOW</option>
                  <option value="MEDIUM">MEDIUM</option>
                  <option value="HIGH">HIGH</option>
                  <option value="CRITICAL">CRITICAL</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Preconditions
                </label>
                <input
                  type="text"
                  value={editPreconditions}
                  onChange={(e) => setEditPreconditions(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-indigo-500 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Test Steps (One step per line)
                </label>
                <textarea
                  value={editStepsText}
                  onChange={(e) => setEditStepsText(e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-indigo-500 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Expected Result
                </label>
                <textarea
                  value={editExpectedResult}
                  onChange={(e) => setEditExpectedResult(e.target.value)}
                  rows={4}
                  required
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-indigo-500 dark:text-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Reviewer Notes / Rationale (Audit Record)
                </label>
                <input
                  type="text"
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="e.g. Corrected expected token revocation behavior per security guidelines"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-indigo-500 dark:text-white"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditCaseModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingReview}
                  className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm"
                >
                  {submittingReview ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>Save Modifications</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve Suite Modal */}
      {approveSuiteModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#0E131F] border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full shadow-2xl p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Approve Test Suite
                </h3>
                <p className="text-xs text-slate-500">
                  Promote suite to APPROVED status
                </p>
              </div>
            </div>

            {currentSuiteDetails?.statistics.unresolved_behavior_cases > 0 ? (
              <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 rounded-lg text-xs text-amber-800 dark:text-amber-300">
                <span className="font-bold">Cannot proceed:</span> There are still{' '}
                {currentSuiteDetails.statistics.unresolved_behavior_cases} unreviewed clarification cases. Please review and resolve them first.
              </div>
            ) : (
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Approval Notes (Optional)
                </label>
                <textarea
                  value={suiteApprovalNotes}
                  onChange={(e) => setSuiteApprovalNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. All scenarios reviewed and verified against Phase 2.8 requirements."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 focus:outline-none focus:border-emerald-500 dark:text-white"
                />
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setApproveSuiteModalOpen(false)}
                className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingSuiteApproval || currentSuiteDetails?.statistics.unresolved_behavior_cases > 0}
                onClick={handleApproveSuite}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white text-xs font-bold rounded-lg shadow-sm disabled:opacity-50 cursor-pointer"
              >
                {submittingSuiteApproval ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                <span>Confirm Approval</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
