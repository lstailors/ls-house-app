import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface QuickCreateFABProps {
  userEmail: string;
}

export function QuickCreateFAB({ userEmail }: QuickCreateFABProps) {
  const location = useLocation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"High" | "Medium" | "Low">("Medium");

  // Hide on the tasks page itself
  if (location.pathname === "/tasks") return null;

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post("/api/tasks", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task created");
      setDescription("");
      setPriority("Medium");
      setOpen(false);
    },
    onError: (e: Error) => toast.error(e.message || "Could not create task"),
  });

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (!description.trim()) return;
    create.mutate({
      description: description.trim(),
      priority,
      allocated_to: userEmail,
    });
  }

  return (
    <>
      {/* Quick-create popover */}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end sm:items-end justify-end pointer-events-none">
          <div
            className="absolute inset-0 pointer-events-auto"
            onClick={() => setOpen(false)}
          />
          <div className="relative pointer-events-auto mb-20 mr-4 sm:mr-6 w-72 bg-[#0a120e] border border-brass/25 rounded-2xl shadow-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] uppercase tracking-widest text-cream-dim">Quick Task</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-cream-dim hover:text-cream transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                required
                autoFocus
                placeholder="What needs to be done?"
                className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream-dim/50 focus:outline-none focus:border-brass/50 resize-none"
              />
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as "High" | "Medium" | "Low")}
                className="w-full bg-forest-deep/60 border border-brass/20 rounded-lg px-3 py-2 text-sm text-cream focus:outline-none focus:border-brass/50"
              >
                <option value="High">High Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="Low">Low Priority</option>
              </select>
              <Button
                type="submit"
                disabled={create.isPending || !description.trim()}
                className="w-full bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e] font-medium h-9 text-sm"
              >
                {create.isPending ? "Creating…" : "Create Task"}
              </Button>
            </form>
          </div>
        </div>
      ) : null}

      {/* FAB button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Quick create task"
        className={cn(
          "fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full shadow-2xl",
          "bg-[#c9a84c] hover:bg-[#b8963c] text-[#0a120e]",
          "flex items-center justify-center transition-all",
          "border border-[#b8963c]/50",
          open && "rotate-45",
        )}
      >
        <Plus className="h-5 w-5" />
      </button>
    </>
  );
}
