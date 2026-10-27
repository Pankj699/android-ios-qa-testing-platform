import * as React from "react";
import { ClipboardList, Sparkles } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { useModuleSettings } from "../hooks/use-module-settings";

export function BugDeskOnboarding({ onComplete }) {
  const { update } = useModuleSettings();
  const [project, setProject] = React.useState("");
  const [module, setModule] = React.useState("");
  const [round, setRound] = React.useState("");

  function handleSubmit(e) {
    e.preventDefault();
    if (!project.trim() || !module.trim()) return;
    update({ project: project.trim(), module: module.trim(), round: round ? round.trim() : "" });
    if (onComplete) {
      onComplete();
    }
  }

  return (
    <div className="flex min-h-[75vh] items-center justify-center p-6">
      <Card className="w-full max-w-lg glass rounded-card border border-[var(--line)] shadow-2xl">
        <CardHeader className="border-b border-[var(--line)] pb-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-violet-500/15 to-pink-500/15 border border-violet-500/25 text-violet-600 dark:text-violet-400 mb-2 shadow-sm">
            <ClipboardList className="h-6 w-6" />
          </div>
          <CardTitle className="text-[20px] font-extrabold text-slate-900 dark:text-white tracking-tight">Set up your QA Workspace</CardTitle>
          <CardDescription className="text-slate-500 dark:text-[#8F97A6] text-[13px] leading-relaxed">
            Tell Bug Desk what project and module you are currently testing. These details will be automatically formatted into every bug report until you switch modules.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="project" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Project Name &amp; Version
              </label>
              <Input
                id="project"
                placeholder="Flyer Maker (V 187.0.187)"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                required
                className="h-10 text-[13.5px] rounded-xl bg-white/80 dark:bg-slate-950/60 border-[var(--line)] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#525A6C]"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="module" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Module Name
              </label>
              <Input
                id="module"
                placeholder="Flyer Maker: Add Credit Module in AI Video and AI Flyers"
                value={module}
                onChange={(e) => setModule(e.target.value)}
                required
                className="h-10 text-[13.5px] rounded-xl bg-white/80 dark:bg-slate-950/60 border-[var(--line)] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#525A6C]"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="round" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
                Current Test Round <span className="text-slate-400 dark:text-[#8F97A6] font-normal">(Optional)</span>
              </label>
              <Input
                id="round"
                placeholder="R-1 (Optional)"
                value={round}
                onChange={(e) => setRound(e.target.value)}
                className="h-10 text-[13.5px] rounded-xl bg-white/80 dark:bg-slate-950/60 border-[var(--line)] text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-[#525A6C]"
              />
            </div>
            <Button
              type="submit"
              className="w-full h-11 btn-magic rounded-pill text-white font-bold text-[14px] mt-2 shadow-md cursor-pointer"
            >
              <Sparkles className="w-4 h-4 mr-2" /> Continue to Bug Desk Dashboard
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default BugDeskOnboarding;
