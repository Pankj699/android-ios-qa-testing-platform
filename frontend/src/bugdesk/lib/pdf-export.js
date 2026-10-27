import { jsPDF } from "jspdf";
import { buildBodyLines, buildHeading, getNoteLines, isBoldLine } from "./report-format";

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
    const clean = (text || "").trim();
    const isUrl = /^https?:\/\/[^\s]+$/i.test(clean);
    if (isUrl) {
      doc.setTextColor(124, 108, 246);
    } else {
      doc.setTextColor(30, 41, 59);
    }
    const wrapped = doc.splitTextToSize(text || " ", maxWidth);
    ensureSpace(wrapped.length);
    if (isUrl) {
      doc.textWithLink(wrapped, marginX, y, { url: clean });
    } else {
      doc.text(wrapped, marginX, y);
    }
    doc.setTextColor(30, 41, 59);
    y += wrapped.length * lineHeight;
  }

  // Heading line
  doc.setFontSize(13);
  writeLine(buildHeading(report), true);
  y += 6;

  doc.setFontSize(11);
  const noteLines = getNoteLines(report?.notes !== undefined ? report?.notes : report?.note);
  const noteLinesSet = new Set(noteLines.filter(Boolean));
  for (const line of buildBodyLines(report)) {
    if (line === "") {
      y += lineHeight * 0.5;
      continue;
    }
    writeLine(line, isBoldLine(line, noteLinesSet));
  }

  doc.save(`${(report.title || "bug-report").slice(0, 60).replace(/[^a-z0-9]+/gi, "-") || "bug-report"}.pdf`);
}
