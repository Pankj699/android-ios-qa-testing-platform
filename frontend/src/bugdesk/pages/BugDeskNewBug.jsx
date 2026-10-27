import * as React from "react";
import { Loader2, Sparkles, KeyRound, RotateCcw, Smartphone, ChevronDown, Check, X, Search, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import { Badge } from "../components/ui/badge";
import { BugReportPreview } from "../components/BugReportPreview";
import { useAuth } from "../context/auth-context";
import { useModuleSettings } from "../hooks/use-module-settings";
import {
  getAISettings,
  saveBugReport,
  updateBugReport,
  getNewBugDraft,
  saveNewBugDraft,
  clearNewBugDraft,
} from "../lib/scoped-storage";
import { generateId } from "../lib/crypto";
import BugDeskVideoUpload from "../components/BugDeskVideoUpload";
import { applyAttachmentUrlToReport } from "../lib/video-upload-utils";
import { api } from "../../services/api";
import { formatDeviceSuffix, stripDeviceSuffix, applyDeviceSuffix } from "../lib/device-suffix";
import { isModalDialogOpen, isGenerateShortcut } from "../../utils/shortcutUtils";

export function BugDeskNewBug({ onNavigate, isActive = true }) {
  const { session } = useAuth();
  const { settings } = useModuleSettings();

  // Form fields
  const [rawNotes, setRawNotes] = React.useState("");
  const [attachmentUrl, setAttachmentUrl] = React.useState("");
  const [showVideoUpload, setShowVideoUpload] = React.useState(false);
  const [videoUploadState, setVideoUploadState] = React.useState(null);
  const [notes, setNotes] = React.useState("");
  const [showNotes, setShowNotes] = React.useState(false);
  const [qaSuggestion, setQaSuggestion] = React.useState("");
  const [includeResults, setIncludeResults] = React.useState(true);
  const [generatedEveryTime, setGeneratedEveryTime] = React.useState(true);
  const [generatedInLive, setGeneratedInLive] = React.useState(false);
  const [hasAttachment, setHasAttachment] = React.useState(false);

  // Shared Device & OS selection
  const [selectedDevice, setSelectedDevice] = React.useState(null);
  const [sharedDevices, setSharedDevices] = React.useState([]);
  const [devicesLoading, setDevicesLoading] = React.useState(false);
  const [deviceSelectorOpen, setDeviceSelectorOpen] = React.useState(false);
  const [deviceSearchQuery, setDeviceSearchQuery] = React.useState("");

  // State
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [report, setReport] = React.useState(null);
  const [hasApiKey, setHasApiKey] = React.useState(true);

  // Redmine / PMS Issue Options (Status, Priority, Assignee)
  const [pmsOptions, setPmsOptions] = React.useState({
    statusId: 1,
    priorityId: 2,
    assignedToId: "",
  });

  // Layout height synchronization between Left Form and Right Preview
  const leftCardRef = React.useRef(null);
  const [formHeight, setFormHeight] = React.useState(null);
  const [isLgScreen, setIsLgScreen] = React.useState(
    () => typeof window !== "undefined" && window.innerWidth >= 1024
  );

  React.useEffect(() => {
    function handleResize() {
      setIsLgScreen(window.innerWidth >= 1024);
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  React.useEffect(() => {
    const el = leftCardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;

    const updateHeight = () => {
      const h = el.offsetHeight;
      if (h > 0) setFormHeight(h);
    };

    updateHeight();

    const ro = new ResizeObserver(() => {
      updateHeight();
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Draft persistence tracking
  const isHydratedRef = React.useRef(false);
  const lastLoadedUserIdRef = React.useRef(null);

  // Keep a ref of current values for synchronous cleanup on unmount or beforeunload
  const stateRef = React.useRef({
    rawNotes,
    attachmentUrl,
    notes,
    qaSuggestion,
    includeResults,
    generatedEveryTime,
    generatedInLive,
    hasAttachment,
    selectedDevice,
    report,
    pmsOptions,
  });
  stateRef.current = {
    rawNotes,
    attachmentUrl,
    notes,
    qaSuggestion,
    includeResults,
    generatedEveryTime,
    generatedInLive,
    hasAttachment,
    selectedDevice,
    report,
    pmsOptions,
  };

  // Load shared device catalog from backend
  const loadSharedDevices = React.useCallback(async () => {
    setDevicesLoading(true);
    try {
      const res = await api.getBugDeskDevices();
      if (res?.success) {
        setSharedDevices(res.devices || []);
      }
    } catch (e) {
      console.warn("Failed to load shared devices:", e);
    } finally {
      setDevicesLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSharedDevices();
  }, [loadSharedDevices]);

  // Filter devices in selector with stale device support
  const filteredSelectorDevices = React.useMemo(() => {
    const q = deviceSearchQuery.trim().toLowerCase();
    let list = [...sharedDevices];
    if (
      selectedDevice &&
      !list.some(
        (d) =>
          d.id === selectedDevice.id ||
          (d.name === selectedDevice.name && d.os === selectedDevice.os)
      )
    ) {
      list.unshift({ ...selectedDevice, isStale: true });
    }
    if (!q) return list;
    return list.filter((d) => {
      const n = (d.name || "").toLowerCase();
      const o = (d.os || "").toLowerCase();
      const m = (d.manufacturer || "").toLowerCase();
      return n.includes(q) || o.includes(q) || m.includes(q);
    });
  }, [sharedDevices, selectedDevice, deviceSearchQuery]);

  // Hydrate draft from scoped storage on mount or when user changes
  React.useEffect(() => {
    if (!session?.userId) {
      isHydratedRef.current = false;
      lastLoadedUserIdRef.current = null;
      return;
    }

    if (lastLoadedUserIdRef.current === session.userId) return;

    try {
      const draft = getNewBugDraft(session.userId);
      if (draft && typeof draft === "object") {
        if (typeof draft.rawNotes === "string") setRawNotes(draft.rawNotes);
        if (typeof draft.attachmentUrl === "string") setAttachmentUrl(draft.attachmentUrl);
        if (typeof draft.notes === "string") {
          setNotes(draft.notes);
          if (draft.notes.trim()) setShowNotes(true);
        }
        if (typeof draft.qaSuggestion === "string") setQaSuggestion(draft.qaSuggestion);
        if (typeof draft.includeResults === "boolean") setIncludeResults(draft.includeResults);
        if (typeof draft.generatedEveryTime === "boolean") setGeneratedEveryTime(draft.generatedEveryTime);
        if (typeof draft.generatedInLive === "boolean") setGeneratedInLive(draft.generatedInLive);
        if (typeof draft.hasAttachment === "boolean") setHasAttachment(draft.hasAttachment);
        if (draft.selectedDevice && typeof draft.selectedDevice === "object") {
          setSelectedDevice(draft.selectedDevice);
        }
        if (draft.report && typeof draft.report === "object") {
          setReport(draft.report);
          if (draft.report.notes && String(draft.report.notes).trim()) {
            setShowNotes(true);
          }
        }
        if (draft.pmsOptions && typeof draft.pmsOptions === "object") {
          setPmsOptions({
            statusId: draft.pmsOptions.statusId !== undefined ? draft.pmsOptions.statusId : 1,
            priorityId: draft.pmsOptions.priorityId !== undefined ? draft.pmsOptions.priorityId : 2,
            assignedToId: draft.pmsOptions.assignedToId || "",
          });
        }
      }
    } catch (e) {
      console.warn("Failed to restore BugDesk draft:", e);
    }

    isHydratedRef.current = true;
    lastLoadedUserIdRef.current = session.userId;
  }, [session?.userId]);

  // Auto-save in-progress draft to scoped storage (debounced)
  React.useEffect(() => {
    if (!isHydratedRef.current || !session?.userId || lastLoadedUserIdRef.current !== session.userId) {
      return;
    }

    const timer = setTimeout(() => {
      const hasContent = Boolean(
        rawNotes ||
        attachmentUrl ||
        notes ||
        qaSuggestion ||
        selectedDevice ||
        report ||
        !includeResults ||
        !generatedEveryTime ||
        generatedInLive ||
        hasAttachment
      );

      if (hasContent) {
        saveNewBugDraft(session.userId, {
          rawNotes,
          attachmentUrl,
          notes,
          qaSuggestion,
          includeResults,
          generatedEveryTime,
          generatedInLive,
          hasAttachment,
          selectedDeviceId: selectedDevice?.id || null,
          selectedDevice,
          report,
          pmsOptions,
          projectContext: {
            project: settings?.project || "",
            module: settings?.module || "",
            round: settings?.round || "",
          },
          updatedAt: Date.now(),
        });
      } else {
        clearNewBugDraft(session.userId);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [
    session?.userId,
    rawNotes,
    attachmentUrl,
    notes,
    qaSuggestion,
    includeResults,
    generatedEveryTime,
    generatedInLive,
    hasAttachment,
    selectedDevice,
    report,
    pmsOptions,
    settings,
  ]);

  // Synchronous flush on unmount
  React.useEffect(() => {
    return () => {
      if (isHydratedRef.current && session?.userId) {
        const cur = stateRef.current;
        const hasContent = Boolean(
          cur.rawNotes ||
          cur.attachmentUrl ||
          cur.notes ||
          cur.qaSuggestion ||
          cur.selectedDevice ||
          cur.report ||
          !cur.includeResults ||
          !cur.generatedEveryTime ||
          cur.generatedInLive ||
          cur.hasAttachment
        );
        if (hasContent) {
          saveNewBugDraft(session.userId, {
            ...cur,
            selectedDeviceId: cur.selectedDevice?.id || null,
            pmsOptions: cur.pmsOptions,
            projectContext: {
              project: settings?.project || "",
              module: settings?.module || "",
              round: settings?.round || "",
            },
            updatedAt: Date.now(),
          });
        }
      }
    };
  }, [session?.userId, settings]);

  function handleSelectDevice(dev) {
    setSelectedDevice(dev);
    setDeviceSelectorOpen(false);

    if (report) {
      const base = report.baseTitle || stripDeviceSuffix(report.title);
      const updatedTitle = applyDeviceSuffix(base, dev);
      const updatedReport = {
        ...report,
        baseTitle: base,
        title: updatedTitle,
        device: dev
          ? {
              id: dev.id,
              name: dev.name,
              os: dev.os,
              manufacturer: dev.manufacturer || "",
              model: dev.model || "",
            }
          : null,
      };
      setReport(updatedReport);
      if (session?.userId) {
        saveNewBugDraft(session.userId, {
          ...stateRef.current,
          report: updatedReport,
          selectedDeviceId: dev?.id || null,
          selectedDevice: dev,
          projectContext: {
            project: settings?.project || "",
            module: settings?.module || "",
            round: settings?.round || "",
          },
          updatedAt: Date.now(),
        });
      }
    }
  }

  // Monitor API key state and refresh when focus or AI settings update
  React.useEffect(() => {
    function checkApiKey() {
      if (!session?.userId) return;
      const ai = getAISettings(session.userId);
      setHasApiKey(Boolean(ai.apiKey));
    }
    checkApiKey();
    window.addEventListener("focus", checkApiKey);
    window.addEventListener("bugdesk:ai-settings-updated", checkApiKey);
    return () => {
      window.removeEventListener("focus", checkApiKey);
      window.removeEventListener("bugdesk:ai-settings-updated", checkApiKey);
    };
  }, [session?.userId]);

  // Auto-populate attachmentUrl when a screen recording is published to Google Drive
  React.useEffect(() => {
    function handleAttachmentReady(e) {
      const newUrl = e.detail?.url;
      if (!newUrl) return;

      if (attachmentUrl && attachmentUrl.trim() && attachmentUrl.trim() !== newUrl.trim()) {
        const confirmOverwrite = window.confirm(
          `A newly recorded screen video has been published to Google Drive:\n\n${newUrl}\n\nWould you like to replace your current attachment URL with this recording link?`
        );
        if (confirmOverwrite) {
          setAttachmentUrl(newUrl);
          setHasAttachment(true);
        }
      } else {
        setAttachmentUrl(newUrl);
        setHasAttachment(true);
      }
    }

    window.addEventListener("bugdesk:attachment-ready", handleAttachmentReady);
    return () => window.removeEventListener("bugdesk:attachment-ready", handleAttachmentReady);
  }, [attachmentUrl]);

  // Handle direct Google Drive video upload success with mandatory auto-replacement
  const handleVideoUploadSuccess = React.useCallback(
    (newPublishedUrl) => {
      if (!newPublishedUrl) return;
      const cleanUrl = String(newPublishedUrl).trim();

      // 1. Mandatory replacement of Attachment URL (replaces entire previous value)
      setAttachmentUrl(cleanUrl);
      setHasAttachment(true);

      // 2. Immediately update existing report and preview state if already generated
      setReport((prev) => {
        if (!prev) return null;
        const updated = applyAttachmentUrlToReport(prev, cleanUrl);
        if (session?.userId && updated) {
          saveBugReport(session.userId, updated);
        }
        return updated;
      });

      // 3. Update in-progress draft in scoped storage without overwriting unrelated fields
      if (session?.userId) {
        saveNewBugDraft(session.userId, {
          rawNotes,
          attachmentUrl: cleanUrl,
          notes: notes.trim(),
          qaSuggestion: qaSuggestion.trim(),
          includeResults,
          generatedEveryTime,
          generatedInLive,
          hasAttachment: true,
          selectedDeviceId: selectedDevice?.id || null,
          selectedDevice,
          report: report ? applyAttachmentUrlToReport(report, cleanUrl) : null,
          projectContext: {
            project: settings?.project || "",
            module: settings?.module || "",
            round: settings?.round ? settings.round.trim() : "",
          },
          updatedAt: Date.now(),
        });
      }

      toast.success("Video uploaded to Google Drive & Attachment URL updated!");
    },
    [session?.userId, rawNotes, notes, qaSuggestion, includeResults, generatedEveryTime, generatedInLive, selectedDevice, report, settings]
  );

  async function handleGenerate(e) {
    if (e && e.preventDefault) e.preventDefault();
    if (!session?.userId || !settings) return;
    if (loading) return;
    setError(null);

    const ai = getAISettings(session.userId);
    if (!ai.apiKey) {
      setError("Add your Gemini API key in Settings before generating a report.");
      return;
    }
    if (!rawNotes.trim()) {
      setError("Raw QA notes are required.");
      return;
    }

    setLoading(true);
    setReport(null);
    try {
      const res = await fetch("/api/rewrite-bug", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rawNotes, apiKey: ai.apiKey, model: ai.model }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate bug report.");

      const { title, steps, actualResult, expectedResult } = data;
      const baseTitle = title;
      const finalTitle = applyDeviceSuffix(baseTitle, selectedDevice);

      const newReport = {
        id: generateId(),
        createdAt: Date.now(),
        project: settings?.project || "",
        module: settings?.module || "",
        round: settings?.round ? settings.round.trim() : "",
        title: finalTitle,
        baseTitle,
        device: selectedDevice
          ? {
              id: selectedDevice.id,
              name: selectedDevice.name,
              os: selectedDevice.os,
              manufacturer: selectedDevice.manufacturer || "",
              model: selectedDevice.model || "",
            }
          : null,
        steps,
        actualResult,
        expectedResult,
        includeResults,
        attachmentUrl: attachmentUrl.trim(),
        notes: notes.trim(),
        qaSuggestion: qaSuggestion.trim(),
        generatedEveryTime,
        generatedInLive,
        hasAttachment,
        rawNotes,
      };

      saveBugReport(session.userId, newReport);
      setReport(newReport);
      // Immediately save complete report and form state into draft
      saveNewBugDraft(session.userId, {
        rawNotes,
        attachmentUrl: attachmentUrl.trim(),
        notes: notes.trim(),
        qaSuggestion: qaSuggestion.trim(),
        includeResults,
        generatedEveryTime,
        generatedInLive,
        hasAttachment,
        selectedDeviceId: selectedDevice?.id || null,
        selectedDevice,
        report: newReport,
        pmsOptions,
        projectContext: {
          project: settings?.project || "",
          module: settings?.module || "",
          round: settings?.round ? settings.round.trim() : "",
        },
        updatedAt: Date.now(),
      });
      toast.success("Bug report generated.");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Something went wrong. Please try again.";
      setError(errMsg);
      toast.error(errMsg);
    } finally {
      setLoading(false);
    }
  }

  const handleReportChange = React.useCallback(
    (updated) => {
      if (!updated) return;
      setReport(updated);
      if (session?.userId) {
        if (updated.id) {
          updateBugReport(session.userId, updated);
        }
        saveNewBugDraft(session.userId, {
          rawNotes,
          attachmentUrl: attachmentUrl.trim(),
          notes: notes.trim(),
          qaSuggestion: qaSuggestion.trim(),
          includeResults,
          generatedEveryTime,
          generatedInLive,
          hasAttachment,
          selectedDeviceId: selectedDevice?.id || null,
          selectedDevice,
          report: updated,
          pmsOptions,
          projectContext: {
            project: settings?.project || "",
            module: settings?.module || "",
            round: settings?.round ? settings.round.trim() : "",
          },
          updatedAt: Date.now(),
        });
      }
    },
    [
      session?.userId,
      rawNotes,
      attachmentUrl,
      notes,
      qaSuggestion,
      includeResults,
      generatedEveryTime,
      generatedInLive,
      hasAttachment,
      selectedDevice,
      pmsOptions,
      settings?.project,
      settings?.module,
      settings?.round,
    ]
  );

  const handleGenerateRef = React.useRef(handleGenerate);
  handleGenerateRef.current = handleGenerate;
  const formRef = React.useRef(null);
  const isMac = typeof window !== "undefined" && /Mac|iPod|iPhone|iPad/.test(window.navigator?.userAgent || "");
  const shortcutLabel = isMac ? "⌘ + Enter" : "Ctrl + Enter";

  // Keyboard shortcut: Ctrl + Enter (Cmd + Enter on macOS) to generate bug report
  React.useEffect(() => {
    if (!isActive) return;

    function handleKeyDown(e) {
      if (isGenerateShortcut(e)) {
        // Do not trigger underlying page shortcut when a modal or confirmation dialog owns interaction
        if (isModalDialogOpen()) return;

        // Prevent newline insertion in textarea and prevent standard form submit
        e.preventDefault();
        e.stopPropagation();

        // Prevent duplicate submissions and repeated calls while loading
        if (loading) return;

        if (handleGenerateRef.current) {
          handleGenerateRef.current(e);
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [isActive, loading]);

  // Clear in-progress draft and reset form cleanly
  function handleClearDraft() {
    const hasReportOrSubstantialNotes = Boolean(report || (rawNotes && rawNotes.trim().length > 10));
    if (hasReportOrSubstantialNotes) {
      const confirmed = window.confirm(
        "Are you sure you want to clear this in-progress bug report and start fresh?"
      );
      if (!confirmed) return;
    }

    setRawNotes("");
    setAttachmentUrl("");
    setShowVideoUpload(false);
    setVideoUploadState(null);
    setNotes("");
    setShowNotes(false);
    setQaSuggestion("");
    setSelectedDevice(null);
    setDeviceSelectorOpen(false);
    setIncludeResults(true);
    setGeneratedEveryTime(true);
    setGeneratedInLive(false);
    setHasAttachment(false);
    setReport(null);
    setError(null);
    setPmsOptions({ statusId: 1, priorityId: 2, assignedToId: "" });

    if (session?.userId) {
      clearNewBugDraft(session.userId);
    }
    toast.success("Form cleared. Ready for a new bug report.");
  }

  const hasDraftOrReport = Boolean(
    rawNotes ||
    attachmentUrl ||
    notes ||
    qaSuggestion ||
    selectedDevice ||
    report ||
    !includeResults ||
    !generatedEveryTime ||
    generatedInLive ||
    hasAttachment
  );


  // Build the context subtitle matching Screenshot 1
  const contextSubtitle = React.useMemo(() => {
    if (!settings) return "Configure project & module in Settings";
    const parts = [];
    if (settings?.project) parts.push(settings?.project);
    if (settings?.module) parts.push(settings?.module);
    if (settings?.round && settings.round.trim()) parts.push(`(${settings.round.trim()})`);
    return `For ${parts.join(" - ")}`;
  }, [settings]);

  return (
    <div className="w-full">
      {/* Page Title & Subtitle matching Screenshot 1 */}
      <PageHeader
        title="New bug report"
        description="Paste your rough QA notes — BugDesk handles the formatting."
        actions={
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-50 border border-purple-200 text-purple-700 text-xs font-semibold shadow-xs dark:bg-purple-950/40 dark:border-purple-800/50 dark:text-purple-300">
            <Sparkles className="w-3.5 h-3.5 text-purple-500" />
            <span>Report bugs with AI</span>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 px-8 pb-8 lg:grid-cols-2 items-stretch">
        {/* ── Left Column: Bug details form ─────────────────────────── */}
        <div ref={leftCardRef} className="glass rounded-card border border-[var(--line)] p-6 shadow-sm flex flex-col">
          <div>
            {/* Header */}
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[17px] font-extrabold text-slate-900 dark:text-white tracking-tight">Bug details</h2>
                <p className="text-[13.5px] text-slate-500 dark:text-[#8F97A6] mt-0.5 truncate">
                  {contextSubtitle}
                </p>
              </div>
              {hasDraftOrReport && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClearDraft}
                  className="h-8 px-3 text-[12px] font-semibold rounded-pill border-[var(--line)] bg-white/80 dark:bg-slate-900/80 hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 flex items-center gap-1.5 cursor-pointer shrink-0 shadow-sm transition-all"
                  title="Clear in-progress draft and reset form"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                  <span>New Report</span>
                </Button>
              )}
            </div>

            {/* Optional subtle API key hint if missing */}
            {!hasApiKey && (
              <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-700 dark:text-amber-300 shadow-sm">
                <KeyRound className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
                <span>
                  You haven&apos;t added a Gemini API key yet.{" "}
                  <button
                    type="button"
                    onClick={() => onNavigate && onNavigate("settings")}
                    className="font-bold underline text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer"
                  >
                    Add it in Settings
                  </button>{" "}
                  to generate reports.
                </span>
              </div>
            )}

            <form ref={formRef} onSubmit={handleGenerate} className="space-y-4">
              {/* Device & OS Selector (Optional) */}
              <div className="space-y-1.5 relative">
                <div className="flex items-center justify-between">
                  <label className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                    <Smartphone className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                    Device &amp; OS (optional)
                  </label>
                  {selectedDevice && (
                    <button
                      type="button"
                      onClick={() => handleSelectDevice(null)}
                      className="text-[11.5px] text-slate-500 hover:text-rose-600 dark:text-[#8F97A6] dark:hover:text-rose-400 flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      <X className="w-3 h-3" /> Clear selection
                    </button>
                  )}
                </div>

                <div className="relative">
                  <button
                    type="button"
                    onClick={() => {
                      setDeviceSelectorOpen((prev) => !prev);
                      loadSharedDevices();
                    }}
                    className="w-full h-10 px-3.5 bg-white/80 dark:bg-slate-950/60 border border-[var(--line)] hover:border-violet-500/40 focus:border-violet-500 text-slate-800 rounded-xl text-left flex items-center justify-between text-[13.5px] dark:text-white transition-all cursor-pointer shadow-sm"
                  >
                    {selectedDevice ? (
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-semibold text-slate-900 dark:text-white">{selectedDevice.name}</span>
                        <Badge variant="outline" className="border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300 text-[11px] font-mono py-0 px-2 rounded-pill">
                          {selectedDevice.os}
                        </Badge>
                        {selectedDevice.manufacturer && (
                          <span className="text-slate-500 dark:text-[#8F97A6] text-[12px] truncate">
                            ({selectedDevice.manufacturer})
                          </span>
                        )}
                        {selectedDevice.isStale && (
                          <span className="text-amber-600 dark:text-amber-500/80 text-[11px] italic">
                            (unlisted)
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-slate-500 dark:text-[#8F97A6]">
                        {devicesLoading ? "Loading devices..." : "No device selected (Click to choose)"}
                      </span>
                    )}
                    <ChevronDown className={`w-4 h-4 text-slate-400 dark:text-[#8F97A6] transition-transform shrink-0 ${deviceSelectorOpen ? "rotate-180" : ""}`} />
                  </button>

                  {/* Dropdown Menu */}
                  {deviceSelectorOpen && (
                    <div className="absolute z-30 left-0 right-0 mt-1 rounded-lg border border-slate-200 bg-white dark:border-[#1E2638] dark:bg-[#0E131F] shadow-2xl p-2 space-y-1.5 max-h-64 flex flex-col">
                      {/* Search Filter */}
                      <div className="relative shrink-0">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-[#8F97A6]" />
                        <Input
                          placeholder="Search devices or OS..."
                          value={deviceSearchQuery}
                          onChange={(e) => setDeviceSearchQuery(e.target.value)}
                          className="h-8 pl-8 bg-slate-50 border-slate-200 text-[12.5px] text-slate-900 dark:bg-[#080B12] dark:border-[#1E2638] dark:text-white rounded"
                          autoFocus
                        />
                      </div>

                      {/* Options list */}
                      <div className="overflow-y-auto space-y-1 flex-1 pr-1">
                        {/* None Option */}
                        <button
                          type="button"
                          onClick={() => handleSelectDevice(null)}
                          className={`w-full px-2.5 py-1.5 rounded text-left text-[13px] flex items-center justify-between transition-colors cursor-pointer ${
                            !selectedDevice
                              ? "bg-purple-50 text-purple-700 font-semibold dark:bg-amber-500/10 dark:text-amber-400"
                              : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-[#141B28]"
                          }`}
                        >
                          <span>None (No device selected)</span>
                          {!selectedDevice && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-amber-400" />}
                        </button>

                        {filteredSelectorDevices.length === 0 ? (
                          <div className="p-3 text-center text-[12px] text-slate-500 dark:text-[#8F97A6]">
                            {sharedDevices.length === 0 ? (
                              <div>
                                <p>No devices in shared catalog yet.</p>
                                {onNavigate && (
                                  <button
                                    type="button"
                                    onClick={() => onNavigate("settings")}
                                    className="text-purple-600 dark:text-amber-400 underline font-semibold mt-1 cursor-pointer"
                                  >
                                    Add devices in Settings
                                  </button>
                                )}
                              </div>
                            ) : (
                              "No matching devices found."
                            )}
                          </div>
                        ) : (
                          filteredSelectorDevices.map((dev) => {
                            const isSelected = selectedDevice?.id === dev.id || (selectedDevice?.name === dev.name && selectedDevice?.os === dev.os);
                            return (
                              <button
                                key={dev.id || `${dev.name}-${dev.os}`}
                                type="button"
                                onClick={() => handleSelectDevice(dev)}
                                className={`w-full px-2.5 py-1.5 rounded text-left text-[13px] flex items-center justify-between transition-colors cursor-pointer ${
                                  isSelected
                                    ? "bg-purple-50 text-purple-700 font-semibold dark:bg-violet-500/15 dark:text-violet-300"
                                    : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#141B28]"
                                }`}
                              >
                                <span className="flex items-center gap-2 truncate">
                                  <span className="font-medium">{dev.name}</span>
                                  <Badge variant="outline" className="border-purple-200 text-purple-700 dark:border-violet-500/30 dark:text-violet-400 text-[10.5px] font-mono py-0 px-1.5">
                                    {dev.os}
                                  </Badge>
                                  {dev.manufacturer && (
                                    <span className="text-slate-500 dark:text-[#8F97A6] text-[11.5px] truncate">
                                      {dev.manufacturer}
                                    </span>
                                  )}
                                  {dev.isStale && (
                                    <span className="text-amber-600 dark:text-amber-500/80 text-[10.5px] italic">
                                      (unlisted)
                                    </span>
                                  )}
                                </span>
                                {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-violet-400 shrink-0 ml-2" />}
                              </button>
                            );
                          })
                        )}
                      </div>

                      {/* Footer link to Settings */}
                      <div className="pt-1.5 border-t border-slate-200 dark:border-[#1E2638] flex items-center justify-between text-[11.5px] text-slate-500 dark:text-[#8F97A6] shrink-0">
                        <span>Shared team catalog</span>
                        {onNavigate && (
                          <button
                            type="button"
                            onClick={() => onNavigate("settings")}
                            className="text-purple-600 hover:text-purple-700 dark:text-violet-400 dark:hover:underline cursor-pointer font-medium"
                          >
                            Manage in Settings &rarr;
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Raw QA notes */}
              <div className="space-y-1.5">
                <label htmlFor="rawNotes" className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200">
                  Raw QA notes
                </label>
                <Textarea
                  id="rawNotes"
                  rows={7}
                  placeholder={
                    "Generate AI Flyer as free user.\nTap Generate Custom Flyer.\nPurchase plan inside editor.\nReturn to result screen.\nCoin icon not visible.\nRegenerate button disabled."
                  }
                  value={rawNotes}
                  onChange={(e) => setRawNotes(e.target.value)}
                  required
                  className="bg-white/80 dark:bg-slate-950/60 border border-[var(--line)] focus:border-violet-500 text-slate-900 placeholder:text-slate-400 dark:text-white text-[13.5px] font-mono leading-relaxed p-3.5 dark:placeholder:text-[#525A6C] rounded-xl shadow-inner transition-all"
                />
              </div>

              {/* Attachment URL & Google Drive Video Upload */}
              <div className="space-y-2">
                <label htmlFor="attachmentUrl" className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200">
                  Attachment URL (optional)
                </label>
                <Input
                  id="attachmentUrl"
                  placeholder="https://.."
                  value={attachmentUrl}
                  onChange={(e) => {
                    const val = e.target.value;
                    setAttachmentUrl(val);
                    if (val.trim()) {
                      setHasAttachment(true);
                      if (report) {
                        setReport((prev) => (prev ? { ...prev, attachmentUrl: val.trim(), hasAttachment: true } : null));
                      }
                    }
                  }}
                  className="bg-white/80 dark:bg-slate-950/60 border border-[var(--line)] focus:border-violet-500 text-slate-900 placeholder:text-slate-400 dark:text-white text-[13.5px] h-10 px-3.5 dark:placeholder:text-[#525A6C] rounded-xl shadow-inner transition-all"
                />

                {/* Collapsible Video Upload Control */}
                <div className="flex items-center justify-between pt-0.5">
                  <button
                    type="button"
                    onClick={() => setShowVideoUpload((prev) => !prev)}
                    className="text-xs font-medium text-purple-600 hover:text-purple-700 dark:text-violet-400 dark:hover:underline cursor-pointer flex items-center gap-1.5 transition-colors"
                  >
                    <span>{showVideoUpload ? "− Hide video attachment" : "+ Add video attachment (optional)"}</span>
                  </button>
                  {videoUploadState?.isUploading && (
                    <span className="text-[11.5px] font-medium text-purple-600 dark:text-[#F59E0B] flex items-center gap-1.5 animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Uploading video... {videoUploadState.uploadProgress || 0}%</span>
                    </span>
                  )}
                  {!videoUploadState?.isUploading && videoUploadState?.uploadStatus === "success" && !showVideoUpload && (
                    <span className="text-[11.5px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Video uploaded to Drive</span>
                    </span>
                  )}
                  {!videoUploadState?.isUploading && videoUploadState?.uploadStatus === "error" && !showVideoUpload && (
                    <span className="text-[11.5px] font-medium text-rose-500 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      <span>Upload failed (click to retry)</span>
                    </span>
                  )}
                </div>

                {/* Direct Google Drive Video Upload Dropzone (kept mounted to preserve in-flight uploads and selections) */}
                <div className={showVideoUpload ? "pt-1" : "hidden"}>
                  <BugDeskVideoUpload
                    onUploadSuccess={handleVideoUploadSuccess}
                    onStatusChange={setVideoUploadState}
                    disabled={loading}
                    currentAttachmentUrl={attachmentUrl}
                  />
                </div>
              </div>

              {/* Notes (Collapsible) */}
              <div className="space-y-1.5 pt-0.5">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowNotes((prev) => !prev)}
                    className="text-xs font-medium text-purple-600 hover:text-purple-700 dark:text-violet-400 dark:hover:underline cursor-pointer flex items-center gap-1.5 transition-colors"
                  >
                    <span>{showNotes ? "− Hide Notes" : "+ Add Notes (optional)"}</span>
                  </button>
                  {!showNotes && notes.trim() && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[260px] font-mono">
                      Note added
                    </span>
                  )}
                </div>

                <div className={showNotes ? "space-y-1.5 pt-1" : "hidden"}>
                  <label htmlFor="notes" className="text-[13.5px] font-semibold text-slate-700 dark:text-slate-200 block">
                    Notes (optional)
                  </label>
                  <Textarea
                    id="notes"
                    rows={2}
                    placeholder="Optional suggestion for the developer"
                    value={notes}
                    onChange={(e) => {
                      const val = e.target.value;
                      setNotes(val);
                      if (report) {
                        setReport((prev) => (prev ? { ...prev, notes: val.trim() } : null));
                      }
                    }}
                    className="bg-white/80 dark:bg-slate-950/60 border border-[var(--line)] focus:border-violet-500 text-slate-900 placeholder:text-slate-400 dark:text-white text-[13.5px] leading-relaxed p-3 dark:placeholder:text-[#525A6C] rounded-xl shadow-inner transition-all"
                  />
                </div>
              </div>

              {/* Additional Information box */}
              <div className="rounded-2xl border border-[var(--line)] bg-slate-50/60 dark:bg-slate-950/40 p-4 space-y-3">
                <p className="text-[12.5px] font-bold text-slate-700 dark:text-slate-300">
                  Additional Information
                </p>

                {/* Results toggle */}
                <label className="flex items-center gap-3 text-[13.5px] text-slate-700 dark:text-slate-200 cursor-pointer">
                  <Checkbox
                    checked={includeResults}
                    onCheckedChange={(v) => setIncludeResults(Boolean(v))}
                  />
                  <span>
                    Include <strong className="font-bold text-slate-900 dark:text-white">Actual &amp; Expected Result</strong> in report
                  </span>
                </label>

                <div className="space-y-2.5 pt-1">
                  <label className="flex items-center gap-3 text-[13.5px] text-slate-700 dark:text-slate-200 cursor-pointer">
                    <Checkbox
                      checked={generatedEveryTime}
                      onCheckedChange={(v) => setGeneratedEveryTime(Boolean(v))}
                    />
                    <span>Generated every time</span>
                  </label>
                  <label className="flex items-center gap-3 text-[13.5px] text-slate-700 dark:text-slate-200 cursor-pointer">
                    <Checkbox
                      checked={generatedInLive}
                      onCheckedChange={(v) => setGeneratedInLive(Boolean(v))}
                    />
                    <span>Generated in live version</span>
                  </label>
                  <label className="flex items-center gap-3 text-[13.5px] text-slate-700 dark:text-slate-200 cursor-pointer">
                    <Checkbox
                      checked={hasAttachment}
                      onCheckedChange={(v) => setHasAttachment(Boolean(v))}
                    />
                    <span>Image/Video attached</span>
                  </label>
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-2xl bg-rose-500/10 border border-rose-500/20 px-3.5 py-2 text-[13px] text-rose-600 dark:text-rose-400 font-medium">
                  {error}
                </p>
              )}

              {/* Generate button */}
              <Button
                type="submit"
                className="w-full btn-magic text-white font-bold text-[14px] h-11 rounded-pill flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer mt-4"
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin text-white" /> : <Sparkles className="h-4 w-4 text-white" />}
                <span>{loading ? "Rewriting with Gemini AI..." : "Generate bug report"}</span>
                {!loading && (
                  <kbd className="ml-1.5 px-1.5 py-0.5 text-[11px] font-mono font-semibold bg-white/20 text-white rounded border border-white/30 backdrop-blur-xs">
                    {shortcutLabel}
                  </kbd>
                )}
              </Button>
            </form>
          </div>
        </div>

        {/* ── Right Column: Generated report preview ───────────────── */}
        <div
          className="flex flex-col h-full min-h-0"
          style={isLgScreen && formHeight ? { maxHeight: `${formHeight}px` } : undefined}
        >
          {loading ? (
            <div
              data-testid="bugdesk-generating-loader"
              role="status"
              aria-live="polite"
              aria-busy="true"
              className="h-full rounded-card border border-[var(--line)] glass p-8 flex flex-col items-center justify-center text-center shadow-sm"
            >
              <div className="flex flex-col items-center gap-4 max-w-sm w-full">
                {/* Subtle animated icon container with glow */}
                <div className="relative flex items-center justify-center">
                  <div
                    aria-hidden="true"
                    className="absolute -inset-2 rounded-2xl bg-gradient-to-r from-violet-500/20 via-fuchsia-500/20 to-pink-500/20 blur-md motion-safe:animate-pulse motion-reduce:hidden"
                  />
                  <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-500/15 to-pink-500/15 border border-violet-500/30 dark:border-violet-400/30 flex items-center justify-center text-violet-600 dark:text-violet-400 shadow-sm">
                    <Sparkles className="h-7 w-7 text-violet-500 dark:text-violet-400 motion-safe:animate-pulse motion-reduce:animate-none" />
                  </div>
                </div>

                {/* Heading and supporting message */}
                <div className="space-y-1.5">
                  <h3 className="text-[17px] font-extrabold text-slate-900 dark:text-white tracking-tight">
                    Generating your bug report
                  </h3>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed max-w-[280px] mx-auto">
                    Analyzing QA notes and preparing reproduction steps...
                  </p>
                </div>

                {/* Smooth animated gradient indeterminate progress bar */}
                <div
                  aria-hidden="true"
                  className="w-56 max-w-full h-1.5 bg-slate-200/80 dark:bg-slate-800/80 rounded-full overflow-hidden relative mt-1 border border-black/5 dark:border-white/5"
                >
                  <div className="bugdesk-progress-bar absolute inset-y-0 bg-gradient-to-r from-violet-500 via-fuchsia-500 to-pink-500 rounded-full" />
                </div>
              </div>
            </div>
          ) : report ? (
            <div className="flex flex-col h-full min-h-0 space-y-3">
              <BugReportPreview
                report={report}
                pmsOptions={pmsOptions}
                onPmsOptionsChange={setPmsOptions}
                onNavigate={onNavigate}
                onReportChange={handleReportChange}
                className="flex-1 min-h-0 flex flex-col"
              />
              <div className="flex items-center justify-between pt-1 shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearDraft}
                  className="text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-800/40 text-[13px] rounded-pill flex items-center gap-1.5 cursor-pointer font-semibold"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                  <span>Start another report</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate && onNavigate("history")}
                  className="text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:text-violet-400 dark:hover:text-violet-300 dark:hover:bg-violet-500/10 text-[13px] font-semibold rounded-pill"
                >
                  View in history &rarr;
                </Button>
              </div>
            </div>
          ) : (
            <div className="h-full rounded-card border border-[var(--line)] glass p-8 flex flex-col items-center justify-center text-center shadow-sm">
              <div className="flex flex-col items-center gap-3 max-w-sm">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-violet-500/15 to-pink-500/15 border border-violet-500/25 flex items-center justify-center text-violet-600 dark:text-violet-400 shadow-sm">
                  <Sparkles className="h-7 w-7 text-violet-500" />
                </div>
                <h3 className="text-[17px] font-extrabold text-slate-900 dark:text-white tracking-tight">Your generated report will appear here</h3>
                <p className="text-[13px] text-slate-500 dark:text-slate-400 leading-relaxed">
                  Fill in your raw QA notes and click Generate bug report.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default BugDeskNewBug;
