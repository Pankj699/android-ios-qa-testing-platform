import * as React from "react";
import { ClipboardCopy, Eye, Inbox, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import { BugReportPreview } from "../components/BugReportPreview";
import { useAuth } from "../context/auth-context";
import { deleteBugReport, getBugHistory } from "../lib/scoped-storage";
import { buildHeading, buildPMSReportHTML, buildPMSReportText, copyRichText } from "../lib/report-format";

export function BugDeskHistory({ onNavigate }) {
  const { session } = useAuth();
  const [history, setHistory] = React.useState([]);
  const [query, setQuery] = React.useState("");
  const [viewing, setViewing] = React.useState(null);
  const [deleting, setDeleting] = React.useState(null);

  const refresh = React.useCallback(() => {
    if (session?.userId) setHistory(getBugHistory(session.userId));
  }, [session?.userId]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const filtered = history.filter((r) => {
    const haystack = `${buildHeading(r)} ${r.rawNotes || ""}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

  async function handleQuickCopy(report) {
    try {
      await copyRichText(buildPMSReportHTML(report), buildPMSReportText(report));
      toast.success("Bug report copied successfully.");
    } catch {
      toast.error("Couldn't copy to clipboard. Check browser clipboard permissions.");
    }
  }

  function handleDelete() {
    if (!session?.userId || !deleting) return;
    deleteBugReport(session.userId, deleting.id);
    setDeleting(null);
    refresh();
    toast.success("Bug report deleted.");
  }

  return (
    <div className="w-full">
      <PageHeader
        title="Bug history"
        description="Every report you've generated, scoped securely to your account."
        actions={
          <div className="relative">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-[#8F97A6]" />
            <Input
              placeholder="Search reports..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-64 pl-9.5 bg-white/80 dark:bg-slate-950/60 border-[var(--line)] text-[13.5px] text-slate-900 dark:text-white h-10 rounded-pill placeholder:text-slate-400 dark:placeholder:text-[#525A6C] shadow-inner focus:border-violet-500 transition-all"
            />
          </div>
        }
      />

      <div className="px-8 pb-8">
        {filtered.length === 0 ? (
          <Card className="rounded-card border border-[var(--line)] glass shadow-sm">
            <CardContent className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-violet-500/10 to-pink-500/10 border border-violet-500/20 text-violet-500">
                <Inbox className="h-6 w-6" />
              </div>
              <p className="text-[14.5px] font-bold text-slate-900 dark:text-white">{history.length === 0 ? "No bug reports yet" : "No matches found"}</p>
              <p className="text-[13px] text-slate-500 dark:text-slate-400">
                {history.length === 0 ? "Generated reports will appear here." : "Try searching with a different keyword."}
              </p>
              {history.length === 0 && onNavigate && (
                <Button
                  size="sm"
                  onClick={() => onNavigate("new-bug")}
                  className="btn-magic text-white font-bold text-[13.5px] h-9 px-4 rounded-pill mt-2 shadow-md cursor-pointer"
                >
                  Create First Bug Report
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((r) => (
              <Card key={r.id} className="rounded-2xl border border-[var(--line)] glass hover:border-violet-500/30 transition-all shadow-sm">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-slate-900 dark:text-white">{buildHeading(r)}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      {r.round && r.round.trim() ? (
                        <Badge variant="outline" className="font-mono text-[11px] border border-violet-500/25 text-violet-700 dark:text-violet-300 bg-violet-500/10 rounded-pill px-2.5 py-0.5">
                          {r.round.trim()}
                        </Badge>
                      ) : null}
                      <span className="text-[12.5px] text-slate-500 dark:text-slate-400">{new Date(r.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setViewing(r)}
                      className="border-[var(--line)] bg-white/80 dark:bg-slate-900/80 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 text-[13px] h-8.5 rounded-pill px-3 shadow-sm font-semibold transition-all"
                    >
                      <Eye className="h-3.5 w-3.5 mr-1 text-violet-500" /> View
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickCopy(r)}
                      className="border-[var(--line)] bg-white/80 dark:bg-slate-900/80 text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-slate-800 text-[13px] h-8.5 rounded-pill px-3 shadow-sm font-semibold transition-all"
                    >
                      <ClipboardCopy className="h-3.5 w-3.5 mr-1 text-violet-500" /> Copy
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-600 h-8.5 w-8.5 rounded-full p-0 transition-colors"
                      onClick={() => setDeleting(r)}
                      title="Delete Bug Report"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* View Bug Report Dialog */}
      <Dialog open={Boolean(viewing)} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto border border-[var(--line)] glass dark:bg-slate-900/95 bg-white/95 rounded-card p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-[18px] font-extrabold text-slate-900 dark:text-white tracking-tight">Bug Report Details</DialogTitle>
            <DialogDescription className="text-[13px] text-slate-500 dark:text-slate-400">
              {viewing && new Date(viewing.createdAt).toLocaleString()}
            </DialogDescription>
          </DialogHeader>
          {viewing && <BugReportPreview report={viewing} />}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="border border-[var(--line)] glass dark:bg-slate-900/95 bg-white/95 rounded-card p-6 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-[18px] font-extrabold text-slate-900 dark:text-white tracking-tight">Delete this bug report?</DialogTitle>
            <DialogDescription className="text-[13px] text-slate-500 dark:text-slate-400">
              Are you sure you want to delete this bug report? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2.5 pt-4">
            <Button
              variant="outline"
              onClick={() => setDeleting(null)}
              className="border-[var(--line)] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#141B28] text-[13px] h-9 rounded-pill font-semibold"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-[13px] h-9 rounded-pill shadow-sm"
            >
              Delete Report
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default BugDeskHistory;
