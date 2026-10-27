import * as React from "react";
import { FilePlus2, FileStack, FolderKanban, Layers, RotateCw, ArrowRight, Inbox } from "lucide-react";
import { PageHeader } from "../components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { useAuth } from "../context/auth-context";
import { useModuleSettings } from "../hooks/use-module-settings";
import { getBugHistory } from "../lib/scoped-storage";
import { buildHeading } from "../lib/report-format";

function StatCard({ icon: Icon, label, value }) {
  return (
    <Card className="rounded-card border border-[var(--line)] glass shadow-sm hover:border-violet-500/30 transition-all">
      <CardContent className="flex items-center gap-3.5 p-5">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-violet-500/15 to-pink-500/15 border border-violet-500/25 text-violet-600 dark:text-violet-400 shadow-sm">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-[13px] text-slate-500 dark:text-slate-400 font-semibold">{label}</p>
          <p className="truncate font-display text-[19px] font-extrabold text-slate-900 dark:text-white mt-0.5">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export function BugDeskDashboard({ onNavigate }) {
  const { session } = useAuth();
  const { settings } = useModuleSettings();
  const [history, setHistory] = React.useState([]);

  React.useEffect(() => {
    if (session?.userId) setHistory(getBugHistory(session.userId));
  }, [session?.userId]);

  const recent = history.slice(0, 5);

  return (
    <div className="w-full">
      <PageHeader
        title={`Welcome back${session?.name ? `, ${session.name.split(" ")[0]}` : ""}`}
        description="Here's what's happening in your QA workspace."
        actions={
          <Button
            onClick={() => onNavigate && onNavigate("new-bug")}
            className="btn-magic text-white font-bold text-[13.5px] h-10 px-4 rounded-pill shadow-md cursor-pointer"
          >
            <FilePlus2 className="h-4 w-4 mr-1.5" /> New bug report
          </Button>
        }
      />

      <div className="space-y-6 px-8 pb-8">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={FileStack} label="Total bugs generated" value={String(history.length)} />
          <StatCard icon={FolderKanban} label="Current project" value={settings?.project ?? "—"} />
          <StatCard icon={Layers} label="Current module" value={settings?.module ?? "—"} />
          <StatCard icon={RotateCw} label="Current round" value={settings?.round && settings.round.trim() ? settings.round.trim() : "—"} />
        </div>

        <Card className="rounded-card border border-[var(--line)] glass shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between gap-2 border-b border-[var(--line)] pb-4 px-6 pt-5">
            <CardTitle className="text-[16.5px] font-extrabold text-slate-900 dark:text-white">Recent bug reports</CardTitle>
            {history.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onNavigate && onNavigate("history")}
                className="text-violet-600 hover:text-violet-700 hover:bg-violet-50 dark:text-amber-400 dark:hover:text-amber-300 dark:hover:bg-amber-500/10 text-[13px] font-semibold rounded-pill"
              >
                View all <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            )}
          </CardHeader>
          <CardContent className="pt-4 px-6 pb-6">
            {recent.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-violet-500/10 to-pink-500/10 border border-violet-500/20 text-violet-500">
                  <Inbox className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[14px] font-bold text-slate-900 dark:text-white">No bug reports yet</p>
                  <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">Generate your first one from rough QA notes.</p>
                </div>
                <Button
                  size="sm"
                  onClick={() => onNavigate && onNavigate("new-bug")}
                  className="btn-magic text-white font-bold text-[13.5px] h-9 px-4 rounded-pill mt-2 cursor-pointer shadow-md"
                >
                  <FilePlus2 className="h-4 w-4 mr-1.5" /> New bug report
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {recent.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-4 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold text-slate-900 dark:text-white">{buildHeading(r)}</p>
                      <p className="mt-1 text-[12.5px] text-slate-500 dark:text-slate-400">
                        {new Date(r.createdAt).toLocaleString()}
                      </p>
                    </div>
                    {r.round && r.round.trim() ? (
                      <Badge variant="outline" className="shrink-0 font-mono text-[11.5px] border border-violet-500/25 text-violet-700 dark:text-violet-300 bg-violet-500/10 rounded-pill px-2.5 py-0.5">
                        {r.round.trim()}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default BugDeskDashboard;
