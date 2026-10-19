import { jsPDF } from "jspdf";
import { buildBodyLines, buildHeading } from "./report-format";

const BOLD_LINES = new Set([
  "Follow the following steps & generate the issue.",
  "Actual Result",
  "Expected Result",
  "Note for Developer: Check all options after applying the solution.",
]);

export function exportReportToPDF(report) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const marginX = 48;
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - marginX * 2;
  let y = 56;

  const lineHeight = 16;

  function ensureSpace(linesNeeded) {
    if (y + linesNeeded * lineHeight > pageHeight - 48) {
      doc.addPage();
      y = 56;
    }
  }

  function writeLine(text, bold) {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const wrapped = doc.splitTextToSize(text || " ", maxWidth);
    ensureSpace(wrapped.length);
    doc.text(wrapped, marginX, y);
    y += wrapped.length * lineHeight;
  }

  // Heading line
  doc.setFontSize(13);
  writeLine(buildHeading(report), true);
  y += 6;

  doc.setFontSize(11);
  for (const line of buildBodyLines(report)) {
    if (line === "") {
      y += lineHeight * 0.5;
      continue;
    }
    writeLine(line, BOLD_LINES.has(line));
  }

  doc.save(`${(report.title || "bug-report").slice(0, 60).replace(/[^a-z0-9]+/gi, "-") || "bug-report"}.pdf`);
}
