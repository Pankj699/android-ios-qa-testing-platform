import * as React from "react";
import { Loader2, Sparkles, KeyRound, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import { BugReportPreview } from "../components/BugReportPreview";
import { useAuth } from "../context/auth-context";
import { useModuleSettings } from "../hooks/use-module-settings";
import {
  getAISettings,
  saveBugReport,
  getNewBugDraft,
  saveNewBugDraft,
  clearNewBugDraft,
} from "../lib/scoped-storage";
import { generateId } from "../lib/crypto";

export function BugDeskNewBug({ onNavigate }) {
  const { session } = useAuth();
  const { settings } = useModuleSettings();

  // Form fields
  const [rawNotes, setRawNotes] = React.useState("");
  const [attachmentUrl, setAttachmentUrl] = React.useState("");
  const [qaSuggestion, setQaSuggestion] = React.useState("");
  const [includeResults, setIncludeResults] = React.useState(true);
  const [generatedEveryTime, setGeneratedEveryTime] = React.useState(true);
  const [generatedInLive, setGeneratedInLive] = React.useState(false);
  const [hasAttachment, setHasAttachment] = React.useState(false);

  // State
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [report, setReport] = React.useState(null);
  const [hasApiKey, setHasApiKey] = React.useState(true);

  // Draft persistence tracking
  const isHydratedRef = React.useRef(false);
  const lastLoadedUserIdRef = React.useRef(null);

  // Keep a ref of current values for synchronous cleanup on unmount or beforeunload
  const stateRef = React.useRef({
    rawNotes,
    attachmentUrl,
    qaSuggestion,
    includeResults,
    generatedEveryTime,
    generatedInLive,
    hasAttachment,
    report,
  });
  stateRef.current = {
    rawNotes,
    attachmentUrl,
    qaSuggestion,
    includeResults,
    generatedEveryTime,
    generatedInLive,
    hasAttachment,
    report,
  };

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
        if (typeof draft.qaSuggestion === "string") setQaSuggestion(draft.qaSuggestion);
        if (typeof draft.includeResults === "boolean") setIncludeResults(draft.includeResults);
        if (typeof draft.generatedEveryTime === "boolean") setGeneratedEveryTime(draft.generatedEveryTime);
        if (typeof draft.generatedInLive === "boolean") setGeneratedInLive(draft.generatedInLive);
        if (typeof draft.hasAttachment === "boolean") setHasAttachment(draft.hasAttachment);
        if (draft.report && typeof draft.report === "object") setReport(draft.report);
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
        qaSuggestion ||
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
          qaSuggestion,
          includeResults,
          generatedEveryTime,
          generatedInLive,
          hasAttachment,
          report,
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
    qaSuggestion,
    includeResults,
    generatedEveryTime,
    generatedInLive,
    hasAttachment,
    report,
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
          cur.qaSuggestion ||
          cur.report ||
          !cur.includeResults ||
          !cur.generatedEveryTime ||
          cur.generatedInLive ||
          cur.hasAttachment
        );
        if (hasContent) {
          saveNewBugDraft(session.userId, {
            ...cur,
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

  async function handleGenerate(e) {
    e.preventDefault();
    if (!session?.userId || !settings) return;
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

      const newReport = {
        id: generateId(),
        createdAt: Date.now(),
        project: settings.project,
        module: settings.module,
        round: settings.round ? settings.round.trim() : "",
        title,
        steps,
        actualResult,
        expectedResult,
        includeResults,
        attachmentUrl: attachmentUrl.trim(),
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
        qaSuggestion: qaSuggestion.trim(),
        includeResults,
        generatedEveryTime,
        generatedInLive,
        hasAttachment,
        report: newReport,
        projectContext: {
          project: settings.project || "",
          module: settings.module || "",
          round: settings.round ? settings.round.trim() : "",
        },
        updatedAt: Date.now(),
      });
      toast.success("Bug report generated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

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
    setQaSuggestion("");
    setIncludeResults(true);
    setGeneratedEveryTime(true);
    setGeneratedInLive(false);
    setHasAttachment(false);
    setReport(null);
    setError(null);

    if (session?.userId) {
      clearNewBugDraft(session.userId);
    }
    toast.success("Form cleared. Ready for a new bug report.");
  }

  const hasDraftOrReport = Boolean(
    rawNotes ||
    attachmentUrl ||
    qaSuggestion ||
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
    if (settings.project) parts.push(settings.project);
    if (settings.module) parts.push(settings.module);
    if (settings.round && settings.round.trim()) parts.push(`(${settings.round.trim()})`);
    return `For ${parts.join(" - ")}`;
  }, [settings]);

  return (
    <div className="w-full">
      {/* Page Title & Subtitle matching Screenshot 1 */}
      <PageHeader
        title="New bug report"
        description="Paste your rough QA notes — BugDesk handles the formatting."
      />

      <div className="grid grid-cols-1 gap-6 px-8 pb-8 lg:grid-cols-2 items-stretch">
        {/* ── Left Column: Bug details form ─────────────────────────── */}
        <div className="rounded-xl border border-[#1A2234] bg-[#0E131F] p-6 shadow-lg flex flex-col justify-between">
          <div>
            {/* Header */}
            <div className="mb-5 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-[16px] font-bold text-white tracking-tight">Bug details</h2>
                <p className="text-[13.5px] text-[#8F97A6] mt-0.5 truncate">
                  {contextSubtitle}
                </p>
              </div>
              {hasDraftOrReport && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleClearDraft}
                  className="h-8 px-2.5 text-[12px] font-medium border-[#1E2638] bg-[#080B12] hover:bg-[#151C2C] text-slate-300 hover:text-white flex items-center gap-1.5 cursor-pointer shrink-0"
                  title="Clear in-progress draft and reset form"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                  <span>New Report</span>
                </Button>
              )}
            </div>

            {/* Optional subtle API key hint if missing */}
            {!hasApiKey && (
              <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-[13px] text-amber-300">
                <KeyRound className="h-4 w-4 shrink-0 text-amber-400" />
                <span>
                  You haven&apos;t added a Gemini API key yet.{" "}
                  <button
                    type="button"
                    onClick={() => onNavigate && onNavigate("settings")}
                    className="font-bold underline text-amber-400 hover:text-amber-300 cursor-pointer"
                  >
                    Add it in Settings
                  </button>{" "}
                  to generate reports.
                </span>
              </div>
            )}

            <form onSubmit={handleGenerate} className="space-y-4">
              {/* Raw QA notes */}
              <div className="space-y-1.5">
                <label htmlFor="rawNotes" className="text-[13.5px] font-medium text-slate-200">
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
                  className="bg-[#080B12] border-[#1E2638] focus:border-[#F59E0B] text-[13.5px] font-mono leading-relaxed p-3.5 placeholder:text-[#525A6C] rounded-lg"
                />
              </div>

              {/* Attachment URL */}
              <div className="space-y-1.5">
                <label htmlFor="attachmentUrl" className="text-[13.5px] font-medium text-slate-200">
                  Attachment URL (optional)
                </label>
                <Input
                  id="attachmentUrl"
                  placeholder="https://.."
                  value={attachmentUrl}
                  onChange={(e) => setAttachmentUrl(e.target.value)}
                  className="bg-[#080B12] border-[#1E2638] focus:border-[#F59E0B] text-[13.5px] h-10 px-3.5 placeholder:text-[#525A6C] rounded-lg"
                />
              </div>

              {/* QA suggestion */}
              <div className="space-y-1.5">
                <label htmlFor="qaSuggestion" className="text-[13.5px] font-medium text-slate-200">
                  QA suggestion (optional)
                </label>
                <Textarea
                  id="qaSuggestion"
                  rows={2}
                  placeholder="Optional suggestion for the developer"
                  value={qaSuggestion}
                  onChange={(e) => setQaSuggestion(e.target.value)}
                  className="bg-[#080B12] border-[#1E2638] focus:border-[#F59E0B] text-[13.5px] leading-relaxed p-3 placeholder:text-[#525A6C] rounded-lg"
                />
              </div>

              {/* Additional Information box */}
              <div className="rounded-lg border border-[#1A2234] bg-[#090D16] p-4 space-y-3">
                <p className="text-[12.5px] font-semibold text-[#8F97A6]">
                  Additional Information
                </p>

                {/* Results toggle */}
                <label className="flex items-center gap-3 text-[13.5px] text-slate-200 cursor-pointer">
                  <Checkbox
                    checked={includeResults}
                    onCheckedChange={(v) => setIncludeResults(Boolean(v))}
                  />
                  <span>
                    Include <strong className="font-semibold text-white">Actual &amp; Expected Result</strong> in report
                  </span>
                </label>

                <div className="space-y-2.5 pt-1">
                  <label className="flex items-center gap-3 text-[13.5px] text-slate-200 cursor-pointer">
                    <Checkbox
                      checked={generatedEveryTime}
                      onCheckedChange={(v) => setGeneratedEveryTime(Boolean(v))}
                    />
                    <span>Generated every time</span>
                  </label>
                  <label className="flex items-center gap-3 text-[13.5px] text-slate-200 cursor-pointer">
                    <Checkbox
                      checked={generatedInLive}
                      onCheckedChange={(v) => setGeneratedInLive(Boolean(v))}
                    />
                    <span>Generated in live version</span>
                  </label>
                  <label className="flex items-center gap-3 text-[13.5px] text-slate-200 cursor-pointer">
                    <Checkbox
                      checked={hasAttachment}
                      onCheckedChange={(v) => setHasAttachment(Boolean(v))}
                    />
                    <span>Image/Video attached</span>
                  </label>
                </div>
              </div>

              {error && (
                <p role="alert" className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3.5 py-2 text-[13px] text-rose-400">
                  {error}
                </p>
              )}

              {/* Generate button */}
              <Button
                type="submit"
                className="w-full bg-[#F59E0B] hover:bg-[#E58E00] text-[#0A0D14] font-bold text-[14px] h-11 rounded-lg flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer mt-4"
                disabled={loading}
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4 text-[#0A0D14]" />}
                <span>{loading ? "Rewriting with Gemini AI..." : "Generate bug report"}</span>
              </Button>
            </form>
          </div>
        </div>

        {/* ── Right Column: Generated report preview ───────────────── */}
        <div className="flex flex-col">
          {report ? (
            <div className="space-y-3">
              <BugReportPreview report={report} />
              <div className="flex items-center justify-between pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearDraft}
                  className="text-slate-400 hover:text-white hover:bg-slate-800/40 text-[13px] flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5 text-slate-400" />
                  <span>Start another report</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onNavigate && onNavigate("history")}
                  className="text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 text-[13px]"
                >
                  View in history &rarr;
                </Button>
              </div>
            </div>
          ) : (
            <div className="h-full min-h-[580px] rounded-xl border border-[#1A2234] bg-[#0E131F] p-8 flex flex-col items-center justify-center text-center shadow-lg">
              <div className="flex flex-col items-center gap-3 max-w-sm">
                <Sparkles className="h-8 w-8 text-[#F59E0B]" />
                <h3 className="text-[16px] font-semibold text-white tracking-tight">Your generated report will appear here</h3>
                <p className="text-[13px] text-[#8F97A6] leading-relaxed">
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
