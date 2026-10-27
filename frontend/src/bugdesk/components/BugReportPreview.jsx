import * as React from "react";
import { ClipboardCopy, ClipboardList, Copy, ExternalLink, FileDown, FileText, Check, ChevronDown, Search, User, AlertCircle, Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Input } from "./ui/input";
import {
  buildBodyText,
  buildHeading,
  buildPMSReportHTML,
  buildPMSReportText,
  copyPlainText,
  copyRichText,
  formatNoteDisplay,
} from "../lib/report-format";
import { exportReportToPDF } from "../lib/pdf-export";
import { exportReportToTXT } from "../lib/txt-export";
import { buildPMSIssueUrl, detectPlatformFromContext } from "../lib/pms-integration";
import { useAuth } from "../context/auth-context";
import { getPMSUrls, getPmsApiKey, getSelectedPlatform, saveSelectedPlatform, updateBugReport } from "../lib/scoped-storage";
import { STORAGE_KEYS } from "../lib/constants";
import { api } from "../../services/api";

function resolveAttachmentHref(url = "") {
  if (!url) return "#";
  const trimmed = String(url).trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function renderTextWithLinks(text) {
  if (typeof text !== "string" || !text) {
    return text;
  }

  // Regex to match http:// and https:// URLs
  const urlPattern = /(https?:\/\/[^\s<>"'`]+)/g;
  const tokens = [];
  let lastIndex = 0;
  let match;

  while ((match = urlPattern.exec(text)) !== null) {
    const rawMatch = match[0];
    const matchIndex = match.index;

    // Preceding text before this URL
    if (matchIndex > lastIndex) {
      tokens.push({ type: "text", value: text.slice(lastIndex, matchIndex) });
    }

    // Separate URL from any trailing punctuation (.,;:!? or unbalanced closing parenthesis)
    let url = rawMatch;
    let trailing = "";
    while (url.length > 0 && /[.,;:!?)]$/.test(url)) {
      if (url.endsWith(")")) {
        const openCount = (url.match(/\(/g) || []).length;
        const closeCount = (url.match(/\)/g) || []).length;
        if (closeCount > openCount) {
          trailing = url.slice(-1) + trailing;
          url = url.slice(0, -1);
          continue;
        }
        break;
      }
      trailing = url.slice(-1) + trailing;
      url = url.slice(0, -1);
    }

    tokens.push({ type: "url", value: url });
    if (trailing) {
      tokens.push({ type: "text", value: trailing });
    }

    lastIndex = matchIndex + rawMatch.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", value: text.slice(lastIndex) });
  }

  // Fast path: if no URLs found and no backticks found, return text directly
  if (tokens.length === 1 && tokens[0].type === "text" && !tokens[0].value.includes("`")) {
    return text;
  }

  // Render tokens to React elements
  const elements = [];
  tokens.forEach((token, idx) => {
    if (token.type === "url") {
      elements.push(
        <a
          key={`link-${idx}`}
          href={token.value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#7c6cf6] hover:text-[#6b5be2] dark:text-[#38bdf8] dark:hover:text-[#60a5fa] hover:underline underline cursor-pointer break-all transition-colors"
          onClick={(e) => e.stopPropagation()}
        >
          {token.value}
        </a>
      );
    } else {
      // Check if text has inline technical code wrapped in `...`
      const str = token.value;
      if (str.includes("`")) {
        const parts = str.split(/(`[^`]+`)/g);
        parts.forEach((p, pIdx) => {
          if (p.startsWith("`") && p.endsWith("`") && p.length >= 2) {
            elements.push(
              <code
                key={`code-${idx}-${pIdx}`}
                className="font-mono text-[12px] bg-slate-100 dark:bg-slate-800/80 px-1 py-0.5 rounded text-violet-700 dark:text-violet-300 border border-slate-200 dark:border-slate-700/60"
              >
                {p.slice(1, -1)}
              </code>
            );
          } else if (p) {
            elements.push(p);
          }
        });
      } else {
        elements.push(str);
      }
    }
  });

  return elements;
}

function CheckRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] py-0.5">
      <span className="text-slate-600 dark:text-[#8F97A6]">{label}</span>
      <Badge variant={value ? "success" : "outline"} className="text-[12px] font-semibold">
        {value ? "Yes" : "No"}
      </Badge>
    </div>
  );
}

function resolvePlatform({ userId, initialPlatform, reportContext }) {
  // 1. Authenticated user's saved platform preference
  if (userId) {
    const saved = getSelectedPlatform(userId);
    if (saved === "android" || saved === "ios") {
      return saved;
    }
  }

  // 2. Explicit initialPlatform prop if valid (when no saved preference exists)
  if (initialPlatform === "android" || initialPlatform === "ios") {
    return initialPlatform;
  }

  // 3. Existing context detection behavior
  const detected = detectPlatformFromContext(reportContext);
  if (detected === "android" || detected === "ios") {
    return detected;
  }

  // 4. Default fallback placeholder
  return "";
}

export const InlineEditableText = React.forwardRef(function InlineEditableText(
  {
    value = "",
    onSave,
    multiline = false,
    ariaLabel = "",
    onEnterNext,
    onRemoveEmpty,
    className = "",
  },
  forwardedRef
) {
  const internalRef = React.useRef(null);
  const isEditingRef = React.useRef(false);
  const isCancelledRef = React.useRef(false);
  const originalTextRef = React.useRef(value || "");

  const setRef = React.useCallback(
    (el) => {
      internalRef.current = el;
      if (typeof forwardedRef === "function") {
        forwardedRef(el);
      } else if (forwardedRef) {
        forwardedRef.current = el;
      }
    },
    [forwardedRef]
  );

  React.useEffect(() => {
    if (!isEditingRef.current) {
      originalTextRef.current = value || "";
    }
  }, [value]);

  const handleFocus = (e) => {
    isEditingRef.current = true;
    isCancelledRef.current = false;
    originalTextRef.current = e.currentTarget.innerText;
  };

  const handleBlur = (e) => {
    isEditingRef.current = false;
    if (isCancelledRef.current) {
      isCancelledRef.current = false;
      return;
    }
    const current = (internalRef.current ? internalRef.current.innerText : "").replace(/\r\n/g, "\n");
    if (current !== originalTextRef.current) {
      originalTextRef.current = current;
      onSave?.(current);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      isCancelledRef.current = true;
      if (internalRef.current) {
        internalRef.current.innerText = originalTextRef.current;
        internalRef.current.blur();
      }
      return;
    }

    if (e.key === "Enter") {
      if (multiline) {
        // Natural newline without triggering form submission or global shortcuts
        e.stopPropagation();
      } else {
        // In Reproduction Steps: save current step and add next step
        e.preventDefault();
        e.stopPropagation();
        const current = (internalRef.current ? internalRef.current.innerText : "").replace(/\r\n/g, "\n");
        if (current !== originalTextRef.current) {
          originalTextRef.current = current;
          onSave?.(current);
        }
        onEnterNext?.();
      }
      return;
    }

    if (e.key === "Backspace" && !multiline) {
      const text = (internalRef.current ? internalRef.current.innerText : "").replace(/[\r\n\u200B]/g, "").trim();
      if (!text && onRemoveEmpty) {
        e.preventDefault();
        e.stopPropagation();
        onRemoveEmpty();
      }
    }
  };

  const handlePaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
    if (!text) return;
    if (document.queryCommandSupported && document.queryCommandSupported("insertText")) {
      document.execCommand("insertText", false, text);
    } else {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const range = selection.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  return (
    <span
      ref={setRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-multiline={multiline}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      className={cn(
        "outline-none rounded px-1 -mx-1 text-slate-700 dark:text-slate-300 break-words whitespace-pre-wrap transition-colors duration-150 cursor-text hover:bg-slate-500/[0.04] dark:hover:bg-slate-400/[0.05] focus:ring-1 focus:ring-amber-400/50 dark:focus:ring-violet-400/40 focus:bg-amber-500/[0.05] dark:focus:bg-violet-500/[0.07]",
        multiline ? "w-full block min-h-[22px]" : "inline-block min-h-[22px] min-w-[20px]",
        className
      )}
    >
      {renderTextWithLinks(value)}
    </span>
  );
});

export function BugReportPreview({
  report,
  initialPlatform = null,
  pmsOptions = null,
  onPmsOptionsChange = null,
  onNavigate = null,
  onReportChange = null,
  className = "",
}) {
  const { session } = useAuth();
  const currentUserId = session?.userId || null;
  const lastUserIdRef = React.useRef(currentUserId);
  const isManualSelectionRef = React.useRef(false);

  // Managed report state (supports both controlled onReportChange and internal state)
  const [internalReport, setInternalReport] = React.useState(report);

  React.useEffect(() => {
    setInternalReport(report);
  }, [report]);

  const activeReport = onReportChange ? (report || internalReport) : internalReport;

  const stepRefs = React.useRef([]);
  const focusStepIndexRef = React.useRef(null);

  const updateReport = React.useCallback(
    (updater) => {
      const current = activeReport;
      const next = typeof updater === "function" ? updater(current) : updater;
      if (!onReportChange) {
        setInternalReport(next);
      }
      if (onReportChange) {
        onReportChange(next);
      }
      if (currentUserId && next?.id) {
        updateBugReport(currentUserId, next);
      }
    },
    [activeReport, onReportChange, currentUserId]
  );

  const handleUpdateStep = React.useCallback(
    (index, newText) => {
      updateReport((prev) => {
        const nextSteps = [...(prev.steps || [])];
        nextSteps[index] = newText;
        return { ...prev, steps: nextSteps };
      });
    },
    [updateReport]
  );

  const handleEnterNextStep = React.useCallback(
    (index) => {
      const currentSteps = activeReport?.steps || [];
      const nextSteps = [...currentSteps];
      nextSteps.splice(index + 1, 0, "");
      focusStepIndexRef.current = index + 1;
      updateReport((prev) => ({ ...prev, steps: nextSteps }));
    },
    [activeReport?.steps, updateReport]
  );

  const handleRemoveEmptyStep = React.useCallback(
    (index) => {
      const currentSteps = activeReport?.steps || [];
      if (currentSteps.length <= 1) return;
      const nextSteps = currentSteps.filter((_, i) => i !== index);
      focusStepIndexRef.current = Math.max(0, index - 1);
      updateReport((prev) => ({ ...prev, steps: nextSteps }));
    },
    [activeReport?.steps, updateReport]
  );

  const handleUpdateActualResult = React.useCallback(
    (newText) => {
      updateReport((prev) => ({ ...prev, actualResult: newText }));
    },
    [updateReport]
  );

  const handleUpdateExpectedResult = React.useCallback(
    (newText) => {
      updateReport((prev) => ({ ...prev, expectedResult: newText }));
    },
    [updateReport]
  );

  React.useEffect(() => {
    if (focusStepIndexRef.current !== null) {
      const targetIdx = focusStepIndexRef.current;
      focusStepIndexRef.current = null;
      const el = stepRefs.current[targetIdx];
      if (el) {
        el.focus();
        try {
          const range = document.createRange();
          const sel = window.getSelection();
          range.selectNodeContents(el);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        } catch {}
      }
    }
  }, [activeReport?.steps]);

  const [platform, setPlatform] = React.useState(() => {
    return resolvePlatform({
      userId: currentUserId,
      initialPlatform,
      reportContext: { project: report?.project, module: report?.module },
    });
  });

  const isOpeningRef = React.useRef(false);

  // PMS Options & Metadata
  const [pmsMeta, setPmsMeta] = React.useState({
    statuses: [
      { id: 1, name: "New" },
      { id: 2, name: "In Progress" },
      { id: 7, name: "Ready for testing (Resolved)" },
      { id: 3, name: "Resolved" },
      { id: 4, name: "Feedback" },
    ],
    defaultStatusId: 1,
    priorities: [
      { id: 1, name: "Low" },
      { id: 2, name: "Normal", is_default: true },
      { id: 3, name: "High" },
      { id: 4, name: "Urgent" },
      { id: 5, name: "Immediate" },
    ],
    defaultPriorityId: 2,
    assignees: [{ id: "", name: "Unassigned" }],
    requiresApiKey: false,
    assigneeError: null,
  });
  const [loadingPmsMeta, setLoadingPmsMeta] = React.useState(false);

  // Internal state when not fully controlled
  const [localStatusId, setLocalStatusId] = React.useState(() => {
    return pmsOptions?.statusId !== undefined ? pmsOptions.statusId : 1;
  });
  const [localPriorityId, setLocalPriorityId] = React.useState(() => {
    return pmsOptions?.priorityId !== undefined ? pmsOptions.priorityId : 2;
  });
  const [localAssigneeId, setLocalAssigneeId] = React.useState(() => {
    return pmsOptions?.assignedToId !== undefined ? pmsOptions.assignedToId : "";
  });

  const selectedStatusId = pmsOptions?.statusId !== undefined ? pmsOptions.statusId : localStatusId;
  const selectedPriorityId = pmsOptions?.priorityId !== undefined ? pmsOptions.priorityId : localPriorityId;
  const selectedAssigneeId = pmsOptions?.assignedToId !== undefined ? pmsOptions.assignedToId : localAssigneeId;

  // Search filter for assignees dropdown
  const [assigneeSearch, setAssigneeSearch] = React.useState("");
  const [assigneeDropdownOpen, setAssigneeDropdownOpen] = React.useState(false);
  const assigneeDropdownRef = React.useRef(null);

  // Close assignee dropdown on outside click
  React.useEffect(() => {
    function handleClickOutside(event) {
      if (assigneeDropdownRef.current && !assigneeDropdownRef.current.contains(event.target)) {
        setAssigneeDropdownOpen(false);
      }
    }
    if (assigneeDropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [assigneeDropdownOpen]);

  // More Actions dropdown state & refs
  const [moreActionsOpen, setMoreActionsOpen] = React.useState(false);
  const moreActionsRef = React.useRef(null);
  const moreActionsButtonRef = React.useRef(null);
  const menuItemsRef = React.useRef([]);

  // Close more actions dropdown on outside click or Escape
  React.useEffect(() => {
    function handleClickOutside(event) {
      if (moreActionsRef.current && !moreActionsRef.current.contains(event.target)) {
        setMoreActionsOpen(false);
      }
    }

    function handleGlobalKeyDown(event) {
      if (event.key === "Escape" && moreActionsOpen) {
        setMoreActionsOpen(false);
        moreActionsButtonRef.current?.focus();
      }
    }

    if (moreActionsOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleGlobalKeyDown);
      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleGlobalKeyDown);
      };
    }
  }, [moreActionsOpen]);

  // Focus first menu item when opened
  React.useEffect(() => {
    if (moreActionsOpen) {
      const timer = setTimeout(() => {
        menuItemsRef.current[0]?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [moreActionsOpen]);

  const handleMenuKeyDown = (e) => {
    const items = menuItemsRef.current.filter(Boolean);
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement);

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
      items[nextIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
      items[prevIndex]?.focus();
    } else if (e.key === "Home") {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === "End") {
      e.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  const executeAction = React.useCallback((actionFn) => {
    setMoreActionsOpen(false);
    moreActionsButtonRef.current?.focus();
    actionFn();
  }, []);

  const updateOption = React.useCallback(
    (key, val) => {
      const next = {
        statusId: key === "statusId" ? val : selectedStatusId,
        priorityId: key === "priorityId" ? val : selectedPriorityId,
        assignedToId: key === "assignedToId" ? val : selectedAssigneeId,
      };
      if (key === "statusId") setLocalStatusId(val);
      if (key === "priorityId") setLocalPriorityId(val);
      if (key === "assignedToId") setLocalAssigneeId(val);

      if (onPmsOptionsChange) {
        onPmsOptionsChange(next);
      }
    },
    [selectedStatusId, selectedPriorityId, selectedAssigneeId, onPmsOptionsChange]
  );

  // Synchronize platform on auth user switch or context change
  React.useEffect(() => {
    // 1. Handle user switching
    if (currentUserId !== lastUserIdRef.current) {
      lastUserIdRef.current = currentUserId;
      isManualSelectionRef.current = false;
      const nextPlatform = resolvePlatform({
        userId: currentUserId,
        initialPlatform,
        reportContext: { project: report?.project, module: report?.module },
      });
      setPlatform(nextPlatform);
      return;
    }

    // 2. If caller passes a new valid initialPlatform and user has not manually overridden
    if (!isManualSelectionRef.current && (initialPlatform === "android" || initialPlatform === "ios")) {
      const saved = currentUserId ? getSelectedPlatform(currentUserId) : null;
      if (!saved) {
        setPlatform(initialPlatform);
        return;
      }
    }

    // 3. Context changes: NEVER override if user has manually selected or saved a preference
    const saved = currentUserId ? getSelectedPlatform(currentUserId) : null;
    if (isManualSelectionRef.current || saved === "android" || saved === "ios") {
      return;
    }

    // 4. Fallback: only if no explicit or saved selection exists, apply context detection
    const detected = detectPlatformFromContext({ project: report?.project, module: report?.module });
    setPlatform(detected || "");
  }, [currentUserId, initialPlatform, report?.project, report?.module]);

  // Listen for storage events and cross-component updates
  React.useEffect(() => {
    function handlePlatformUpdated(e) {
      const { userId, platform: newPlatform } = e.detail || {};
      if (userId && currentUserId && userId === currentUserId) {
        if (newPlatform === "android" || newPlatform === "ios") {
          isManualSelectionRef.current = true;
          setPlatform(newPlatform);
        }
      }
    }

    function handleStorage(e) {
      if (!currentUserId) return;
      const targetKey = STORAGE_KEYS.scoped(currentUserId, "selected-platform");
      if (e.key === targetKey) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed === "android" || parsed === "ios") {
            isManualSelectionRef.current = true;
            setPlatform(parsed);
          }
        } catch {}
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("bugdesk:platform-updated", handlePlatformUpdated);
      window.addEventListener("storage", handleStorage);
      return () => {
        window.removeEventListener("bugdesk:platform-updated", handlePlatformUpdated);
        window.removeEventListener("storage", handleStorage);
      };
    }
  }, [currentUserId]);

  // Fetch PMS options whenever platform or user changes
  React.useEffect(() => {
    let isCancelled = false;

    async function fetchPmsMetadata() {
      if (!platform || (platform !== "android" && platform !== "ios")) return;

      setLoadingPmsMeta(true);
      try {
        const customUrls = currentUserId ? getPMSUrls(currentUserId) : null;
        const targetCustomUrl = customUrls ? customUrls[platform] : null;
        const apiKey = currentUserId ? getPmsApiKey(currentUserId) : null;

        const res = await api.getBugDeskPmsOptions(platform, targetCustomUrl, apiKey);
        if (!isCancelled && res) {
          setPmsMeta({
            statuses: res.statuses || [],
            defaultStatusId: res.defaultStatusId || 1,
            priorities: res.priorities || [],
            defaultPriorityId: res.defaultPriorityId || 2,
            assignees: res.assignees || [{ id: "", name: "Unassigned" }],
            requiresApiKey: Boolean(res.requiresApiKey),
            assigneeError: res.assigneeError || null,
          });

          // Reset assignee if not valid in the newly fetched project's assignees
          if (selectedAssigneeId) {
            const hasAssignee = (res.assignees || []).some(
              (a) => String(a.id) === String(selectedAssigneeId)
            );
            if (!hasAssignee) {
              updateOption("assignedToId", "");
            }
          }
        }
      } catch (err) {
        console.warn("[BugReportPreview] Error fetching PMS options:", err);
      } finally {
        if (!isCancelled) {
          setLoadingPmsMeta(false);
        }
      }
    }

    fetchPmsMetadata();

    return () => {
      isCancelled = true;
    };
  }, [platform, currentUserId]);

  const handlePlatformChange = React.useCallback((val) => {
    if (val !== "android" && val !== "ios") return;
    isManualSelectionRef.current = true;
    setPlatform(val);
    if (currentUserId) {
      saveSelectedPlatform(currentUserId, val);
    }
  }, [currentUserId]);

  async function handleCreatePMSIssue() {
    if (isOpeningRef.current) return;

    if (!activeReport) {
      toast.error("No generated report to submit. Please generate a bug report first.");
      return;
    }

    if (!platform || (platform !== "android" && platform !== "ios")) {
      toast.error("Please select a target platform (Android or iOS) before opening Redmine.");
      return;
    }

    const subject = buildHeading(activeReport);
    const description = buildBodyText(activeReport);

    try {
      isOpeningRef.current = true;
      const customUrls = session?.userId ? getPMSUrls(session.userId) : null;
      const options = {
        statusId: selectedStatusId,
        priorityId: selectedPriorityId,
        assignedToId: selectedAssigneeId,
      };
      const targetUrl = buildPMSIssueUrl(platform, { subject, description }, customUrls, options);

      // Fallback assistance: also copy report to clipboard so user can paste if Redmine instance doesn't populate
      await copyRichText(buildPMSReportHTML(activeReport), buildPMSReportText(activeReport)).catch(() => {});

      const newWin = window.open(targetUrl, "_blank");
      if (!newWin || newWin.closed || typeof newWin.closed === "undefined") {
        toast.warning(
          "Popup was blocked by your browser. Please allow popups for this site, or open Redmine manually.",
          {
            action: {
              label: "Open Link",
              onClick: () => window.open(targetUrl, "_blank"),
            },
          }
        );
      } else {
        toast.success(
          `Opening Redmine ${platform === "android" ? "Android" : "iOS"} project with prefilled issue (Status, Priority & Assignee). Report details copied to clipboard!`
        );
      }
    } catch (err) {
      toast.error(err.message || "Failed to prepare Redmine issue.");
    } finally {
      setTimeout(() => {
        isOpeningRef.current = false;
      }, 1200);
    }
  }

  async function handleCopyPMS() {
    try {
      await copyRichText(buildPMSReportHTML(activeReport), buildPMSReportText(activeReport));
      toast.success("Bug report copied successfully.");
    } catch {
      toast.error("Couldn't copy to clipboard. Check browser clipboard permissions.");
    }
  }

  async function handleCopyTitle() {
    try {
      await copyPlainText(buildHeading(activeReport));
      toast.success("Bug report title copied.");
    } catch {
      toast.error("Couldn't copy title to clipboard.");
    }
  }

  async function handleCopySteps() {
    try {
      await copyPlainText(buildBodyText(activeReport));
      toast.success("Bug report steps copied.");
    } catch {
      toast.error("Couldn't copy steps to clipboard.");
    }
  }

  const filteredAssignees = React.useMemo(() => {
    const q = assigneeSearch.trim().toLowerCase();
    if (!q) return pmsMeta.assignees;
    return pmsMeta.assignees.filter((a) => (a.name || "").toLowerCase().includes(q));
  }, [pmsMeta.assignees, assigneeSearch]);

  const selectedAssigneeObj = React.useMemo(() => {
    if (!selectedAssigneeId) return { id: "", name: "Unassigned" };
    return (
      pmsMeta.assignees.find((a) => String(a.id) === String(selectedAssigneeId)) || {
        id: selectedAssigneeId,
        name: `User #${selectedAssigneeId}`,
      }
    );
  }, [pmsMeta.assignees, selectedAssigneeId]);

  return (
    <Card className={cn("rounded-xl border border-slate-200 bg-white dark:border-[#1A2234] dark:bg-[#0E131F] shadow-sm dark:shadow-lg flex flex-col", className)}>
      <CardContent className="space-y-4 p-6 flex flex-col flex-1 min-h-0 overflow-hidden">
        {/* Redmine Issue Configuration (Status, Priority, Assignee) */}
        <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-[#1A2234] dark:bg-[#0A0E18] p-3.5 space-y-3 shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[12px] font-semibold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                <ExternalLink className="w-3.5 h-3.5 text-purple-600 dark:text-amber-400" />
                Redmine Issue Options
              </span>
              {loadingPmsMeta && (
                <span className="text-[11.5px] text-slate-500 dark:text-[#8F97A6] flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin text-purple-600 dark:text-amber-400" />
                  Updating...
                </span>
              )}
            </div>

            {pmsMeta.requiresApiKey && (
              <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 dark:text-amber-400/90 dark:bg-amber-500/10 dark:border-amber-500/20 px-2 py-0.5 rounded flex items-center gap-1">
                <AlertCircle className="w-3 h-3 shrink-0" />
                <span>API key needed in Settings for full assignee list</span>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
            {/* Status Select */}
            <div className="space-y-1.5 min-w-0">
              <label className="text-[12px] font-medium text-slate-600 dark:text-[#8F97A6] block truncate">Status</label>
              <Select
                value={String(selectedStatusId || "1")}
                onValueChange={(val) => updateOption("statusId", Number(val) || val)}
              >
                <SelectTrigger className="h-9 w-full bg-white border border-slate-200 text-slate-800 text-[13px] rounded-lg focus:ring-1 focus:ring-purple-500/70 focus:border-purple-500/70 hover:border-slate-300 dark:bg-[#080B12] dark:border-[#1E2638] dark:text-slate-200 dark:focus:ring-violet-500/70 dark:focus:border-violet-500/70 dark:hover:border-[#263248] transition-colors">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200 text-slate-800 dark:bg-[#0E131F] dark:border-[#1E2638] dark:text-slate-200 max-h-56 shadow-xl">
                  {pmsMeta.statuses.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Priority Select */}
            <div className="space-y-1.5 min-w-0">
              <label className="text-[12px] font-medium text-slate-600 dark:text-[#8F97A6] block truncate">Priority</label>
              <Select
                value={String(selectedPriorityId || "2")}
                onValueChange={(val) => updateOption("priorityId", Number(val) || val)}
              >
                <SelectTrigger className="h-9 w-full bg-white border border-slate-200 text-slate-800 text-[13px] rounded-lg focus:ring-1 focus:ring-purple-500/70 focus:border-purple-500/70 hover:border-slate-300 dark:bg-[#080B12] dark:border-[#1E2638] dark:text-slate-200 dark:focus:ring-violet-500/70 dark:focus:border-violet-500/70 dark:hover:border-[#263248] transition-colors">
                  <SelectValue placeholder="Priority" />
                </SelectTrigger>
                <SelectContent className="bg-white border-slate-200 text-slate-800 dark:bg-[#0E131F] dark:border-[#1E2638] dark:text-slate-200 max-h-56 shadow-xl">
                  {pmsMeta.priorities.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Assignee Searchable Dropdown */}
            <div className="space-y-1.5 min-w-0 relative" ref={assigneeDropdownRef}>
              <label className="text-[12px] font-medium text-slate-600 dark:text-[#8F97A6] block truncate">Assignee</label>
              <button
                type="button"
                onClick={() => setAssigneeDropdownOpen(!assigneeDropdownOpen)}
                title={selectedAssigneeObj.name}
                className="w-full h-9 px-3 rounded-lg border border-slate-200 bg-white text-left text-[13px] text-slate-800 flex items-center justify-between gap-2 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-purple-500/70 focus:border-purple-500/70 dark:border-[#1E2638] dark:bg-[#080B12] dark:text-slate-200 dark:hover:border-[#263248] dark:focus:ring-amber-500/70 dark:focus:border-amber-500/70 transition-colors cursor-pointer min-w-0"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <User className="w-4 h-4 text-purple-600 dark:text-amber-400/90 shrink-0" />
                  <span className="truncate font-medium text-slate-800 dark:text-slate-200">
                    {selectedAssigneeObj.name}
                  </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-slate-400 dark:text-[#8F97A6] transition-transform shrink-0 ${assigneeDropdownOpen ? "rotate-180" : ""}`} />
              </button>

              {assigneeDropdownOpen && (
                <div className="absolute z-40 left-0 right-0 mt-1 rounded-lg border border-slate-200 bg-white dark:border-[#1E2638] dark:bg-[#0E131F] shadow-2xl p-2 space-y-1.5 max-h-64 flex flex-col min-w-[240px] sm:min-w-0">
                  {/* Search box */}
                  <div className="relative shrink-0">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 dark:text-[#8F97A6]" />
                    <Input
                      placeholder="Search member..."
                      value={assigneeSearch}
                      onChange={(e) => setAssigneeSearch(e.target.value)}
                      className="h-8 pl-8 bg-slate-50 border-slate-200 text-[12.5px] text-slate-900 focus:border-purple-500 dark:bg-[#080B12] dark:border-[#1E2638] dark:text-white dark:focus:border-[#F59E0B] rounded-md"
                      autoFocus
                    />
                  </div>

                  {/* Members list */}
                  <div className="overflow-y-auto space-y-0.5 flex-1 pr-0.5 max-h-44">
                    {filteredAssignees.length === 0 ? (
                      <div className="p-3 text-center text-[12px] text-slate-500 dark:text-[#8F97A6]">
                        No assignable members found.
                      </div>
                    ) : (
                      filteredAssignees.map((a) => {
                        const isSelected = String(selectedAssigneeId) === String(a.id);
                        return (
                          <button
                            key={a.id || "unassigned"}
                            type="button"
                            onClick={() => {
                              updateOption("assignedToId", a.id ? String(a.id) : "");
                              setAssigneeDropdownOpen(false);
                            }}
                            title={a.name}
                            className={`w-full px-2.5 py-1.5 rounded-md text-left text-[12.5px] flex items-center justify-between gap-2 transition-colors cursor-pointer min-w-0 ${
                              isSelected
                                ? "bg-purple-50 text-purple-700 font-semibold dark:bg-amber-500/15 dark:text-amber-400"
                                : "text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-[#141B28]"
                            }`}
                          >
                            <span className="truncate flex items-center gap-2 min-w-0 flex-1">
                              <User className="w-3.5 h-3.5 text-purple-600 dark:text-amber-400/70 shrink-0" />
                              <span className="truncate">{a.name}</span>
                            </span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-purple-600 dark:text-amber-400 shrink-0 ml-1.5" />}
                          </button>
                        );
                      })
                    )}
                  </div>

                  {pmsMeta.requiresApiKey && (
                    <div className="pt-2 border-t border-slate-200 dark:border-[#1E2638] text-[11.5px] text-slate-500 dark:text-[#8F97A6] flex items-center justify-between gap-2 shrink-0">
                      <span className="truncate">Default: Unassigned</span>
                      {onNavigate ? (
                        <button
                          type="button"
                          onClick={() => {
                            setAssigneeDropdownOpen(false);
                            onNavigate("settings");
                          }}
                          className="text-purple-600 hover:text-purple-700 dark:text-amber-400 dark:hover:underline cursor-pointer font-medium shrink-0"
                        >
                          Add Key in Settings &rarr;
                        </button>
                      ) : (
                        <span className="text-purple-600 dark:text-amber-400/80 shrink-0">Configure in Settings</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons toolbar: Platform Selector, Create PMS Issue, More Actions */}
        <div className="flex flex-wrap items-center justify-between gap-2.5 pt-0.5 shrink-0">
          {/* Primary Action Group: Platform Selector immediately before Create PMS Issue */}
          <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
            {/* 1. Platform Selector (Android / iOS) */}
            <Select value={platform} onValueChange={handlePlatformChange}>
              <SelectTrigger className="w-[145px] h-9 px-3.5 py-2 bg-white border border-slate-200 text-slate-800 text-[13px] font-medium rounded-lg focus:ring-1 focus:ring-purple-500/70 focus:border-purple-500/70 hover:border-slate-300 dark:bg-[#080B12] dark:border-[#1E2638] dark:text-slate-200 dark:focus:ring-amber-500/70 dark:focus:border-amber-500/70 dark:hover:border-[#263248] transition-colors shrink-0 [&>svg]:text-slate-400 dark:[&>svg]:text-[#8F97A6] [&>svg]:opacity-100 hover:[&>svg]:text-slate-700 dark:hover:[&>svg]:text-slate-200">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent className="bg-white border-slate-200 text-slate-800 dark:bg-[#0E131F] dark:border-[#1E2638] dark:text-slate-200 min-w-[145px] shadow-xl">
                <SelectItem value="android">Android</SelectItem>
                <SelectItem value="ios">iOS</SelectItem>
              </SelectContent>
            </Select>

            {/* 2. Create PMS Issue Button */}
            <Button
              onClick={handleCreatePMSIssue}
              className="btn-primary-gradient text-white font-bold text-[13px] h-9 px-4 py-2 border border-transparent rounded-lg shadow-sm flex items-center gap-2 cursor-pointer shrink-0 transition-all hover:shadow-md active:scale-[0.99]"
            >
              <ExternalLink className="h-4 w-4 text-white" />
              <span>Create PMS Issue</span>
            </Button>
          </div>

          {/* 3. Secondary Actions: More Actions Dropdown (aligned right) */}
          <div className="relative shrink-0 ml-auto sm:ml-0" ref={moreActionsRef}>
            <Button
              ref={moreActionsButtonRef}
              id="more-actions-button"
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setMoreActionsOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={moreActionsOpen}
              aria-label="More report actions"
              className={`border-slate-200 text-slate-700 hover:bg-slate-100 hover:text-slate-900 dark:border-[#1E2638] dark:text-slate-200 dark:hover:bg-[#141B28] dark:hover:text-white text-[13px] h-9 px-3 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors shrink-0 group ${
                moreActionsOpen ? "bg-slate-100 border-purple-300 text-slate-900 dark:bg-[#141B28] dark:border-amber-500/50 dark:text-white" : ""
              }`}
            >
              <MoreHorizontal className="h-4 w-4 text-slate-500 group-hover:text-purple-600 dark:text-[#8F97A6] dark:group-hover:text-amber-400 transition-colors" />
              <span>More Actions</span>
              <ChevronDown className={`h-3.5 w-3.5 text-slate-500 group-hover:text-purple-600 dark:text-[#8F97A6] transition-transform duration-200 ${moreActionsOpen ? "rotate-180 text-purple-600 dark:text-amber-400" : ""}`} />
            </Button>

            {moreActionsOpen && (
              <div
                role="menu"
                aria-orientation="vertical"
                aria-labelledby="more-actions-button"
                className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-slate-200 bg-white dark:border-[#1E2638] dark:bg-[#0E131F] shadow-2xl p-1.5 z-50 animate-fadeIn space-y-0.5 focus:outline-none"
                tabIndex={-1}
                onKeyDown={handleMenuKeyDown}
              >
                {/* 1. Copy PMS Report */}
                <button
                  ref={(el) => (menuItemsRef.current[0] = el)}
                  type="button"
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => executeAction(handleCopyPMS)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] text-slate-700 hover:text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:text-slate-900 focus:outline-none focus:ring-1 focus:ring-purple-500/50 dark:text-slate-200 dark:hover:text-white dark:hover:bg-[#141B28] dark:focus:bg-[#141B28] dark:focus:text-white dark:focus:ring-amber-500/50 transition-colors group cursor-pointer"
                >
                  <ClipboardCopy className="w-4 h-4 text-purple-600 dark:text-amber-400 shrink-0" />
                  <span className="font-medium">Copy PMS Report</span>
                </button>

                {/* 2. Copy Title */}
                <button
                  ref={(el) => (menuItemsRef.current[1] = el)}
                  type="button"
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => executeAction(handleCopyTitle)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] text-slate-700 hover:text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:text-slate-900 focus:outline-none focus:ring-1 focus:ring-purple-500/50 dark:text-slate-200 dark:hover:text-white dark:hover:bg-[#141B28] dark:focus:bg-[#141B28] dark:focus:text-white dark:focus:ring-amber-500/50 transition-colors group cursor-pointer"
                >
                  <Copy className="w-4 h-4 text-slate-500 group-hover:text-slate-700 dark:text-[#8F97A6] dark:group-hover:text-slate-200 group-focus:text-slate-900 dark:group-focus:text-slate-200 shrink-0 transition-colors" />
                  <span>Copy Title</span>
                </button>

                {/* 3. Copy Steps */}
                <button
                  ref={(el) => (menuItemsRef.current[2] = el)}
                  type="button"
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => executeAction(handleCopySteps)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] text-slate-700 hover:text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:text-slate-900 focus:outline-none focus:ring-1 focus:ring-purple-500/50 dark:text-slate-200 dark:hover:text-white dark:hover:bg-[#141B28] dark:focus:bg-[#141B28] dark:focus:text-white dark:focus:ring-amber-500/50 transition-colors group cursor-pointer"
                >
                  <ClipboardList className="w-4 h-4 text-slate-500 group-hover:text-slate-700 dark:text-[#8F97A6] dark:group-hover:text-slate-200 group-focus:text-slate-900 dark:group-focus:text-slate-200 shrink-0 transition-colors" />
                  <span>Copy Steps</span>
                </button>

                {/* Subtle Divider */}
                <div className="my-1 border-t border-slate-200 dark:border-[#1E2638]" role="separator" />

                {/* 4. Export TXT */}
                <button
                  ref={(el) => (menuItemsRef.current[3] = el)}
                  type="button"
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => executeAction(() => exportReportToTXT(activeReport))}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] text-slate-700 hover:text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:text-slate-900 focus:outline-none focus:ring-1 focus:ring-purple-500/50 dark:text-slate-200 dark:hover:text-white dark:hover:bg-[#141B28] dark:focus:bg-[#141B28] dark:focus:text-white dark:focus:ring-amber-500/50 transition-colors group cursor-pointer"
                >
                  <FileText className="w-4 h-4 text-slate-500 group-hover:text-slate-700 dark:text-[#8F97A6] dark:group-hover:text-slate-200 group-focus:text-slate-900 dark:group-focus:text-slate-200 shrink-0 transition-colors" />
                  <span>Export TXT</span>
                </button>

                {/* 5. Export PDF */}
                <button
                  ref={(el) => (menuItemsRef.current[4] = el)}
                  type="button"
                  role="menuitem"
                  tabIndex={0}
                  onClick={() => executeAction(() => exportReportToPDF(activeReport))}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left text-[13px] text-slate-700 hover:text-slate-900 hover:bg-slate-100 focus:bg-slate-100 focus:text-slate-900 focus:outline-none focus:ring-1 focus:ring-purple-500/50 dark:text-slate-200 dark:hover:text-white dark:hover:bg-[#141B28] dark:focus:bg-[#141B28] dark:focus:text-white dark:focus:ring-amber-500/50 transition-colors group cursor-pointer"
                >
                  <FileDown className="w-4 h-4 text-slate-500 group-hover:text-slate-700 dark:text-[#8F97A6] dark:group-hover:text-slate-200 group-focus:text-slate-900 dark:group-focus:text-slate-200 shrink-0 transition-colors" />
                  <span>Export PDF</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <Separator className="bg-slate-200 dark:bg-[#1A2234] shrink-0" />

        {/* Report preview */}
        <div className="rounded-lg border border-amber-200/80 bg-[#FFFDF8] dark:border-[#1A2234] dark:bg-[#080B12] p-5 font-sans text-[13.5px] leading-relaxed space-y-4 text-slate-800 dark:text-slate-200 shadow-xs flex-1 min-h-0 overflow-y-auto">
          {/* Heading */}
          <p className="font-bold text-[#D97706] dark:text-[#F59E0B] break-words text-[15px]">{renderTextWithLinks(buildHeading(activeReport))}</p>

          {/* Steps */}
          <div className="group/steps">
            <p className="font-semibold text-slate-900 dark:text-white mb-2">Follow the following steps &amp; generate the issue.</p>
            <ol className="space-y-1.5 list-none pl-0">
              {(activeReport?.steps || []).map((step, i) => (
                <li key={i} className="flex gap-2.5 items-baseline">
                  <span className="text-[#D97706] dark:text-[#F59E0B] font-bold shrink-0 select-none">{i + 1}.</span>
                  <InlineEditableText
                    ref={(el) => (stepRefs.current[i] = el)}
                    value={step}
                    multiline={false}
                    ariaLabel={`Reproduction step ${i + 1}`}
                    onSave={(text) => handleUpdateStep(i, text)}
                    onEnterNext={() => handleEnterNextStep(i)}
                    onRemoveEmpty={() => handleRemoveEmptyStep(i)}
                    className="flex-1"
                  />
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => handleEnterNextStep((activeReport?.steps || []).length - 1)}
              className="opacity-0 group-hover/steps:opacity-100 focus:opacity-100 text-[12px] font-medium text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-1 mt-1.5 transition-opacity cursor-pointer select-none"
              tabIndex={0}
              aria-label="Add reproduction step"
            >
              + Add step
            </button>
          </div>

          {/* Actual / Expected — only shown when toggle is on */}
          {activeReport?.includeResults && (
            <>
              <div className="pt-1">
                <p className="font-semibold text-slate-900 dark:text-white mb-1">Actual Result</p>
                <InlineEditableText
                  value={activeReport.actualResult || (activeReport.actualResult === "" ? "" : "Analysing by given steps")}
                  multiline={true}
                  ariaLabel="Actual Result"
                  onSave={handleUpdateActualResult}
                  className="w-full block"
                />
              </div>
              <div className="pt-1">
                <p className="font-semibold text-slate-900 dark:text-white mb-1">Expected Result</p>
                <InlineEditableText
                  value={activeReport.expectedResult || (activeReport.expectedResult === "" ? "" : "Analysing by given steps")}
                  multiline={true}
                  ariaLabel="Expected Result"
                  onSave={handleUpdateExpectedResult}
                  className="w-full block"
                />
              </div>
            </>
          )}

          {/* Attachment */}
          {activeReport?.attachmentUrl && (
            <p className="break-all">
              <a
                href={resolveAttachmentHref(activeReport.attachmentUrl)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#7c6cf6] hover:text-[#6b5be2] dark:text-[#38bdf8] dark:hover:text-[#60a5fa] hover:underline underline cursor-pointer break-all transition-colors inline-block"
                onClick={(e) => e.stopPropagation()}
              >
                {activeReport.attachmentUrl}
              </a>
            </p>
          )}

          {/* Note (omitted if empty) */}
          {Boolean(
            (activeReport?.notes || activeReport?.note) &&
            typeof (activeReport?.notes || activeReport?.note) === "string" &&
            (activeReport?.notes || activeReport?.note).trim()
          ) && (
            <div className="pt-1">
              <p className="font-bold text-slate-900 dark:text-white break-words whitespace-pre-wrap">
                {renderTextWithLinks(formatNoteDisplay(activeReport.notes || activeReport.note))}
              </p>
            </div>
          )}

          {/* QA Suggestion */}
          <div className="pt-1">
            <p className="font-semibold text-slate-900 dark:text-white mb-1">QA Suggestion:</p>
            <p className="text-slate-700 dark:text-slate-300 break-words whitespace-pre-wrap">{renderTextWithLinks(activeReport?.qaSuggestion || "-")}</p>
          </div>

          {/* Developer note */}
          <div className="space-y-2 pt-3 border-t border-slate-200 dark:border-[#1A2234]">
            <p className="font-semibold text-slate-900 dark:text-white">
              Note for Developer: Check all options after applying the solution.
            </p>
            {activeReport?.developerNote && (
              <p className="text-slate-700 dark:text-slate-300 break-words whitespace-pre-wrap">{renderTextWithLinks(activeReport.developerNote)}</p>
            )}
            <CheckRow label="Is it generated every time? =>" value={activeReport?.generatedEveryTime} />
            <CheckRow label="is it generated in Live version? =>" value={activeReport?.generatedInLive} />
            <CheckRow label="Did you attach a Image/Video of the issue? =>" value={activeReport?.hasAttachment} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default BugReportPreview;
