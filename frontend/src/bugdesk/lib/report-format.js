export function buildHeading(report) {
  if (!report) return "";
  const roundPart = report.round && typeof report.round === "string" && report.round.trim()
    ? ` (${report.round.trim()})`
    : "";
  return `${report.project || ""} ${report.module || ""}${roundPart} : ${report.title || ""}`.trim();
}

/** Steps formatted as "1. Step text" */
function buildStepsLines(steps = []) {
  return steps.map((step, i) => `${i + 1}. ${step}`);
}

/**
 * Formats user-entered notes into lines prefixed with "Note: ".
 * Returns an empty array if notes is empty or whitespace.
 * Avoids duplicate "Note: Note: " prefixes if user already typed it.
 */
export function getNoteLines(notes) {
  if (!notes || typeof notes !== "string" || !notes.trim()) return [];
  const rawLines = notes.trim().split(/\r?\n/);
  while (rawLines.length > 0 && !rawLines[0].trim()) rawLines.shift();
  while (rawLines.length > 0 && !rawLines[rawLines.length - 1].trim()) rawLines.pop();
  if (rawLines.length === 0) return [];

  const first = rawLines[0].trim();
  const firstPrefixed = /^note:\s*/i.test(first)
    ? `Note: ${first.replace(/^note:\s*/i, "").trim()}`
    : `Note: ${first}`;

  return [firstPrefixed, ...rawLines.slice(1).map((l) => l.trim())];
}

export function formatNoteDisplay(notes) {
  if (!notes || typeof notes !== "string" || !notes.trim()) return "";
  const lines = getNoteLines(notes);
  return lines.join("\n");
}

/**
 * Full report body (everything after the heading line).
 * Respects report.includeResults to conditionally include Actual/Expected sections.
 */
export function buildBodyLines(report) {
  const lines = [];

  lines.push("Follow the following steps & generate the issue.");
  lines.push("");
  lines.push(...buildStepsLines(report?.steps || []));

  if (report?.includeResults) {
    lines.push("");
    lines.push("Actual Result");
    lines.push(report.actualResult || "Analysing by given steps");
    lines.push("");
    lines.push("Expected Result");
    lines.push(report.expectedResult || "Analysing by given steps");
  }

  if (report?.attachmentUrl) {
    lines.push("");
    lines.push(report.attachmentUrl);
  }

  const noteLines = getNoteLines(report?.notes !== undefined ? report?.notes : report?.note);
  if (noteLines.length > 0) {
    lines.push("");
    lines.push(...noteLines);
  }

  lines.push("");
  lines.push("QA Suggestion:");
  lines.push(report?.qaSuggestion || "-");
  lines.push("");
  lines.push("Note for Developer: Check all options after applying the solution.");
  lines.push("");
  lines.push(`Is it generated every time? => ${report?.generatedEveryTime ? "Yes" : "No"}`);
  lines.push(`is it generated in Live version? => ${report?.generatedInLive ? "Yes" : "No"}`);
  lines.push(`Did you attach a Image/Video of the issue? => ${report?.hasAttachment ? "Yes" : "No"}`);

  return lines;
}

export function buildBodyText(report) {
  const noteLines = getNoteLines(report?.notes !== undefined ? report?.notes : report?.note);
  const noteLinesSet = new Set(noteLines.filter(Boolean));
  return buildBodyLines(report)
    .map((line) => (line !== "" && isBoldLine(line, noteLinesSet) ? `*${line}*` : line))
    .join("\n");
}

export function buildPMSReportText(report) {
  return `${buildHeading(report)}\n\n${buildBodyText(report)}`;
}

const BOLD_LINES = new Set([
  "Follow the following steps & generate the issue.",
  "Actual Result",
  "Expected Result",
  "QA Suggestion:",
  "Note for Developer: Check all options after applying the solution.",
]);

export function isBoldLine(line, noteLinesSet = null) {
  if (!line || typeof line !== "string") return false;
  if (noteLinesSet && noteLinesSet.has(line)) return true;
  return (
    BOLD_LINES.has(line) ||
    line.startsWith("Note:") ||
    line.startsWith("Is it generated every time? =>") ||
    line.startsWith("is it generated in Live version? =>") ||
    line.startsWith("Did you attach a Image/Video of the issue? =>")
  );
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function linkifyHtml(safeText) {
  return safeText.replace(/(https?:\/\/[^\s<>"'`]+)/g, (matched) => {
    let url = matched;
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
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" style="color: #7c6cf6; text-decoration: underline;">${url}</a>${trailing}`;
  });
}

export function buildPMSReportHTML(report) {
  const noteLines = getNoteLines(report?.notes !== undefined ? report?.notes : report?.note);
  const noteLinesSet = new Set(noteLines.filter(Boolean));
  const allLines = [buildHeading(report), "", ...buildBodyLines(report)];
  const htmlLines = allLines.map((line) => {
    if (line === "") return "<div>&nbsp;</div>";
    const safe = escapeHtml(line);
    const linkified = linkifyHtml(safe);
    return isBoldLine(line, noteLinesSet) ? `<div><b>${linkified}</b></div>` : `<div>${linkified}</div>`;
  });
  return `<div style="font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; white-space: pre-wrap;">${htmlLines.join("")}</div>`;
}

function copyTextFallback(text) {
  if (typeof document === "undefined") {
    throw new Error("Clipboard copy failed.");
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "absolute";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  const successful = document.execCommand("copy");
  document.body.removeChild(textarea);

  if (!successful) {
    throw new Error("Clipboard copy failed.");
  }
}

export async function copyPlainText(text) {
  if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // fallback below
    }
  }
  copyTextFallback(text);
}

export async function copyRichText(html, plain) {
  if (typeof window !== "undefined" && "ClipboardItem" in window && navigator.clipboard && navigator.clipboard.write) {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // fall through to plain text fallback
    }
  }
  await copyPlainText(plain);
}
