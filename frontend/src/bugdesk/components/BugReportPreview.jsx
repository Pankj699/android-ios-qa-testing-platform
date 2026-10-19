import * as React from "react";
import { ClipboardCopy, ClipboardList, Copy, ExternalLink, FileDown, FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Separator } from "./ui/separator";
import { Badge } from "./ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import {
  buildBodyText,
  buildHeading,
  buildPMSReportHTML,
  buildPMSReportText,
  copyPlainText,
  copyRichText,
} from "../lib/report-format";
import { exportReportToPDF } from "../lib/pdf-export";
import { exportReportToTXT } from "../lib/txt-export";
import { buildPMSIssueUrl, detectPlatformFromContext } from "../lib/pms-integration";
import { useAuth } from "../context/auth-context";
import { getPMSUrls } from "../lib/scoped-storage";

function CheckRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] py-0.5">
      <span className="text-[#8F97A6]">{label}</span>
      <Badge variant={value ? "success" : "outline"} className="text-[12px] font-mono">
        {value ? "Yes" : "No"}
      </Badge>
    </div>
  );
}

export function BugReportPreview({ report, initialPlatform = null }) {
  const { session } = useAuth();
  const [platform, setPlatform] = React.useState(() => {
    if (initialPlatform) return initialPlatform;
    return detectPlatformFromContext({ project: report?.project, module: report?.module }) || "";
  });

  const isOpeningRef = React.useRef(false);

  React.useEffect(() => {
    if (initialPlatform) {
      setPlatform(initialPlatform);
    } else {
      const detected = detectPlatformFromContext({ project: report?.project, module: report?.module });
      if (detected) {
        setPlatform(detected);
      }
    }
  }, [report?.project, report?.module, initialPlatform]);

  async function handleCreatePMSIssue() {
    if (isOpeningRef.current) return;

    if (!report) {
      toast.error("No generated report to submit. Please generate a bug report first.");
      return;
    }

    if (!platform || (platform !== "android" && platform !== "ios")) {
      toast.error("Please select a target platform (Android or iOS) before opening Redmine.");
      return;
    }

    const subject = buildHeading(report);
    const description = buildBodyText(report);

    try {
      isOpeningRef.current = true;
      const customUrls = session?.userId ? getPMSUrls(session.userId) : null;
      const targetUrl = buildPMSIssueUrl(platform, { subject, description }, customUrls);

      // Fallback assistance: also copy report to clipboard so user can paste if Redmine instance doesn't populate
      await copyRichText(buildPMSReportHTML(report), buildPMSReportText(report)).catch(() => {});

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
          `Opening Redmine ${platform === "android" ? "Android" : "iOS"} project with prefilled issue. Report details copied to clipboard!`
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
      await copyRichText(buildPMSReportHTML(report), buildPMSReportText(report));
      toast.success("Bug report copied successfully.");
    } catch {
      toast.error("Couldn't copy to clipboard. Check browser clipboard permissions.");
    }
  }

  async function handleCopyTitle() {
    try {
      await copyPlainText(buildHeading(report));
      toast.success("Bug report title copied.");
    } catch {
      toast.error("Couldn't copy title to clipboard.");
    }
  }

  async function handleCopySteps() {
    try {
      await copyPlainText(buildBodyText(report));
      toast.success("Bug report steps copied.");
    } catch {
      toast.error("Couldn't copy steps to clipboard.");
    }
  }

  return (
    <Card className="rounded-xl border border-[#1A2234] bg-[#0E131F] shadow-lg">
      <CardContent className="space-y-4 p-6">
        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Create PMS Issue & Platform Selector Group */}
          <div className="flex items-center gap-2">
            <Select value={platform} onValueChange={(val) => setPlatform(val)}>
              <SelectTrigger className="w-[115px] h-9 bg-[#080B12] border-[#1E2638] text-slate-200 text-[13px] rounded-lg focus:ring-amber-500">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent className="bg-[#0E131F] border-[#1E2638] text-slate-200">
                <SelectItem value="android">Android</SelectItem>
                <SelectItem value="ios">iOS</SelectItem>
              </SelectContent>
            </Select>

            <Button
              onClick={handleCreatePMSIssue}
              className="bg-[#F59E0B] hover:bg-[#E58E00] text-[#0A0D14] font-bold text-[13px] h-9 px-3.5 rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer"
            >
              <ExternalLink className="h-4 w-4 text-[#0A0D14]" />
              Create PMS Issue
            </Button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyPMS}
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/10 text-[13px] h-9 px-3 rounded-lg font-medium"
          >
            <ClipboardCopy className="h-4 w-4" /> Copy PMS Report
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopyTitle}
            className="border-[#1E2638] text-slate-200 hover:bg-[#141B28] text-[13px] h-9 px-3 rounded-lg"
          >
            <Copy className="h-3.5 w-3.5" /> Copy Title
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopySteps}
            className="border-[#1E2638] text-slate-200 hover:bg-[#141B28] text-[13px] h-9 px-3 rounded-lg"
          >
            <ClipboardList className="h-3.5 w-3.5" /> Copy Steps
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportReportToTXT(report)}
            className="border-[#1E2638] text-slate-200 hover:bg-[#141B28] text-[13px] h-9 px-3 rounded-lg"
          >
            <FileText className="h-3.5 w-3.5" /> Export TXT
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportReportToPDF(report)}
            className="border-[#1E2638] text-slate-200 hover:bg-[#141B28] text-[13px] h-9 px-3 rounded-lg"
          >
            <FileDown className="h-3.5 w-3.5" /> Export PDF
          </Button>
        </div>

        <Separator className="bg-[#1A2234]" />

        {/* Report preview */}
        <div className="rounded-lg border border-[#1A2234] bg-[#080B12] p-5 font-mono text-[13.5px] leading-relaxed space-y-4 text-slate-200">
          {/* Heading */}
          <p className="font-bold text-[#F59E0B] break-words text-[15px]">{buildHeading(report)}</p>

          {/* Steps */}
          <div>
            <p className="font-semibold text-white mb-2">Follow the following steps &amp; generate the issue.</p>
            <ol className="space-y-1.5 list-none pl-0">
              {(report.steps || []).map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="text-[#F59E0B] font-bold shrink-0">{i + 1}.</span>
                  <span className="text-slate-300">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Actual / Expected — only shown when toggle is on */}
          {report.includeResults && (
            <>
              <div className="pt-1">
                <p className="font-semibold text-white mb-1">Actual Result</p>
                <p className="text-slate-300">{report.actualResult || "Analysing by given steps"}</p>
              </div>
              <div className="pt-1">
                <p className="font-semibold text-white mb-1">Expected Result</p>
                <p className="text-slate-300">{report.expectedResult || "Analysing by given steps"}</p>
              </div>
            </>
          )}

          {/* Attachment */}
          {report.attachmentUrl && (
            <p className="break-all text-teal-400 underline">{report.attachmentUrl}</p>
          )}

          {/* QA Suggestion */}
          <div className="pt-1">
            <p className="font-semibold text-white mb-1">QA Suggestion:</p>
            <p className="text-slate-300">{report.qaSuggestion || "-"}</p>
          </div>

          {/* Developer note */}
          <div className="space-y-2 pt-3 border-t border-[#1A2234]">
            <p className="font-semibold text-white">
              Note for Developer: Check all options after applying the solution.
            </p>
            <CheckRow label="Is it generated every time? =>" value={report.generatedEveryTime} />
            <CheckRow label="is it generated in Live version? =>" value={report.generatedInLive} />
            <CheckRow label="Did you attach a Image/Video of the issue? =>" value={report.hasAttachment} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default BugReportPreview;
