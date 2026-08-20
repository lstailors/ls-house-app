import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { cn } from "@ls/design/utils";
import { pepeApi } from "./pepeApi";

export default function PepeTodos() {
  const qc = useQueryClient();
  const { data: todos = [], isLoading, isError } = useQuery({
    queryKey: ["pepe", "todos"],
    queryFn: () => pepeApi.todos(),
  });

  const close = useMutation({
    mutationFn: (id: string) => pepeApi.closeTodo(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pepe", "todos"] }),
  });

  if (isLoading) {
    return <p className="px-4 py-6 text-sm text-cream-dim">Loading your list…</p>;
  }
  if (isError) {
    return <p className="px-4 py-6 text-sm text-red-300">Couldn’t load ToDos.</p>;
  }
  if (!todos.length) {
    return <p className="px-4 py-6 text-sm text-cream-dim">Nothing allocated to you right now.</p>;
  }

  return (
    <ul className="flex flex-col gap-2 px-3 py-3">
      {todos.map((t) => (
        <li
          key={t.name}
          className="rounded-xl border border-brass/20 bg-forest-deep/50 px-3 py-3"
        >
          <div className="flex items-start gap-3">
            <button
              type="button"
              aria-label="Mark complete"
              disabled={close.isPending}
              onClick={() => close.mutate(t.name)}
              className={cn(
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-brass/40",
                "text-brass hover:bg-brass/15 disabled:opacity-50",
              )}
            >
              <Check size={14} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-cream whitespace-pre-wrap">
                {stripHtml(t.description) || t.name}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.16em] text-cream-dim">
                {t.priority}
                {t.date ? ` · ${t.date}` : ""}
                {t.reference_name ? ` · ${t.reference_name}` : ""}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function stripHtml(html: string): string {
  return (html ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
