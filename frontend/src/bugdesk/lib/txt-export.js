import { buildPMSReportText } from "./report-format";

export function exportReportToTXT(report) {
  const text = buildPMSReportText(report);
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(report.title || "bug-report").slice(0, 60).replace(/[^a-z0-9]+/gi, "-") || "bug-report"}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
