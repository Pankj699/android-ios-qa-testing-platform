import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function SwitchModuleDialog({ open, onOpenChange, initial, onSave }) {
  const [project, setProject] = React.useState(initial?.project ?? "");
  const [module, setModule] = React.useState(initial?.module ?? "");
  const [round, setRound] = React.useState(initial?.round ?? "");

  React.useEffect(() => {
    if (open) {
      setProject(initial?.project ?? "");
      setModule(initial?.module ?? "");
      setRound(initial?.round ?? "");
    }
  }, [open, initial]);

  function handleSubmit(e) {
    e.preventDefault();
    if (!project.trim() || !module.trim()) return;
    onSave({ project: project.trim(), module: module.trim(), round: round ? round.trim() : "" });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch Module</DialogTitle>
          <DialogDescription>
            These values are used automatically on every bug report you generate.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label htmlFor="modal-project" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Project Name &amp; Version
            </label>
            <Input
              id="modal-project"
              placeholder="Flyer Maker (V 187.0.187)"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              required
              className="h-10 text-[13.5px]"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="modal-module" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Module Name
            </label>
            <Input
              id="modal-module"
              placeholder="Flyer Maker: Add Credit Module in AI Video and AI Flyers"
              value={module}
              onChange={(e) => setModule(e.target.value)}
              required
              className="h-10 text-[13.5px]"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="modal-round" className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">
              Current Round <span className="text-slate-500 dark:text-[#8F97A6] font-normal">(Optional)</span>
            </label>
            <Input
              id="modal-round"
              placeholder="R-1 (Optional)"
              value={round}
              onChange={(e) => setRound(e.target.value)}
              className="h-10 text-[13.5px]"
            />
          </div>
          <DialogFooter className="pt-3 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="h-10 text-[13.5px] rounded-pill border-[var(--line)] text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-[#1A2234] font-semibold"
            >
              Cancel
            </Button>
            <Button type="submit" className="h-10 text-[13.5px] btn-magic text-white font-bold rounded-pill shadow-md">
              Save &amp; Use
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default SwitchModuleDialog;
