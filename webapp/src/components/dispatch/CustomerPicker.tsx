import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Search, MessageSquare, User } from "lucide-react";
import { api } from "@/lib/api";
import { GlassCard } from "@/components/glass/GlassCard";
import { cn } from "@/lib/utils";
import type { DispatchCustomer, DispatchRecentThread } from "../../../../backend/src/types";

export interface DispatchSelection {
  customerId: string | null;
  phone: string | null;
  name: string;
}

function timeAgo(iso: string | null) {
  if (!iso) return "";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function selectionKey(sel: { customerId: string | null; phone: string | null }): string {
  return sel.customerId ?? sel.phone ?? "";
}

interface Props {
  selected: DispatchSelection | null;
  onSelect: (sel: DispatchSelection) => void;
  /** Batch mode: onSelect toggles membership; checkmarks shown for batchKeys. */
  batchMode?: boolean;
  batchKeys?: Set<string>;
}

export function CustomerPicker({ selected, onSelect, batchMode = false, batchKeys }: Props) {
  const [query, setQuery] = useState<string>("");
  const [debounced, setDebounced] = useState<string>("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data: results = [], isFetching: searching } = useQuery({
    queryKey: ["dispatch-customers", debounced],
    queryFn: () => api.get<DispatchCustomer[]>(`/api/dispatch/customers?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });

  const { data: recent = [] } = useQuery({
    queryKey: ["dispatch-recent"],
    queryFn: () => api.get<DispatchRecentThread[]>("/api/dispatch/recent"),
    refetchOnWindowFocus: true,
  });

  return (
    <GlassCard className="p-4 flex flex-col gap-4 h-full min-h-0">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cream-dim" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search customers by name or phone…"
          className="w-full rounded-xl border border-brass/20 bg-forest-raised/40 pl-9 pr-3 py-2.5 text-sm text-cream placeholder:text-cream-dim focus:outline-none focus:border-brass/50 transition-colors"
        />
      </div>

      {debounced.length >= 2 ? (
        <div className="space-y-1">
          <div className="ui-label text-[10px] mb-1">{searching ? "Searching…" : `Results (${results.length})`}</div>
          {results.length === 0 && !searching ? (
            <p className="text-xs text-cream-dim px-1 py-2">No customers match "{debounced}".</p>
          ) : null}
          {results.map((r) => {
            const inBatch = batchKeys?.has(r.id) ?? false;
            const active = batchMode ? inBatch : selected?.customerId === r.id;
            return (
              <button
                key={r.id}
                onClick={() => onSelect({ customerId: r.id, phone: r.phone, name: r.name })}
                className={cn(
                  "w-full text-left flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-all",
                  active ? "border-brass/40 bg-brass/10" : "border-transparent hover:border-brass/20 hover:bg-brass/5",
                )}
              >
                <div
                  className={cn(
                    "h-8 w-8 rounded-full border flex items-center justify-center shrink-0",
                    inBatch ? "bg-brass border-brass" : "bg-brass/15 border-brass/25",
                  )}
                >
                  {inBatch ? <Check className="h-4 w-4 text-forest-deep" /> : <User className="h-3.5 w-3.5 text-brass-light" />}
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-cream truncate">{r.name}</div>
                  <div className="text-[11px] text-cream-dim">{r.phone ? r.phone : "No phone on file"}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-1">
        <div className="ui-label text-[10px] mb-1 flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3" /> Recent conversations
        </div>
        {recent.map((t) => {
          const key = t.customerId ?? t.phone;
          const inBatch = batchKeys?.has(key) ?? false;
          const active = batchMode
            ? inBatch
            : selected && (selected.customerId === t.customerId || selected.phone === t.phone);
          return (
            <button
              key={t.phone}
              onClick={() => onSelect({ customerId: t.customerId, phone: t.phone, name: t.name })}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2.5 border transition-all",
                active ? "border-brass/40 bg-brass/10" : "border-transparent hover:border-brass/20 hover:bg-brass/5",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-cream truncate flex items-center gap-1.5">
                  {inBatch ? <Check className="h-3.5 w-3.5 text-brass-light shrink-0" /> : null}
                  {t.name}
                </span>
                <span className="text-[10px] text-cream-dim shrink-0">{timeAgo(t.lastTimestamp)}</span>
              </div>
              <div className="text-[11px] text-cream-dim truncate mt-0.5">
                {t.lastDirection === "inbound" ? "← " : "→ "}
                {t.lastMessage}
              </div>
            </button>
          );
        })}
        {recent.length === 0 ? <p className="text-xs text-cream-dim px-1 py-2">No conversations yet.</p> : null}
      </div>
    </GlassCard>
  );
}
