export function buildHeading(report) {
  const roundPart = report.round && typeof report.round === "string" && report.round.trim()
    ? ` (${report.round.trim()})`
    : "";
  return `${report.project} ${report.module}${roundPart} : ${report.title}`;
}

/** Steps formatted as "1. Step text" */
function buildStepsLines(steps = []) {
  return steps.map((step, i) => `${i + 1}. ${step}`);
}

/**
 * Full report body (everything after the heading line).
 * Respects report.includeResults to conditionally include Actual/Expected sections.
 */
export function buildBodyLines(report) {
  const lines = [];

  lines.push("Follow the following steps & generate the issue.");
  lines.push("");
  lines.push(...buildStepsLines(report.steps || []));

  if (report.includeResults) {
    lines.push("");
    lines.push("Actual Result");
    lines.push(report.actualResult || "Analysing by given steps");
    lines.push("");
    lines.push("Expected Result");
    lines.push(report.expectedResult || "Analysing by given steps");
  }

  if (report.attachmentUrl) {
    lines.push("");
    lines.push(report.attachmentUrl);
  }

  lines.push("");
  lines.push("QA Suggestion:");
  lines.push(report.qaSuggestion || "-");
  lines.push("");
  lines.push("Note for Developer: Check all options after applying the solution.");
  lines.push("");
  lines.push(`Is it generated every time? => ${report.generatedEveryTime ? "Yes" : "No"}`);
  lines.push(`is it generated in Live version? => ${report.generatedInLive ? "Yes" : "No"}`);
  lines.push(`Did you attach a Image/Video of the issue? => ${report.hasAttachment ? "Yes" : "No"}`);

  return lines;
}

export function buildBodyText(report) {
  return buildBodyLines(report).map((line) => (isBoldLine(line) ? `*${line}*` : line)).join("\n");
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

function isBoldLine(line) {
  return (
    BOLD_LINES.has(line) ||
    line.startsWith("Is it generated every time? =>") ||
    line.startsWith("is it generated in Live version? =>") ||
    line.startsWith("Did you attach a Image/Video of the issue? =>")
  );
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildPMSReportHTML(report) {
  const allLines = [buildHeading(report), "", ...buildBodyLines(report)];
  const htmlLines = allLines.map((line) => {
    if (line === "") return "<div>&nbsp;</div>";
    const safe = escapeHtml(line);
    return isBoldLine(line) ? `<div><b>${safe}</b></div>` : `<div>${safe}</div>`;
  });
  return `<div style="font-family: ui-monospace, monospace; white-space: pre-wrap;">${htmlLines.join("")}</div>`;
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
