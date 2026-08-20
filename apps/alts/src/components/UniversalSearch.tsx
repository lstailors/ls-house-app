import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import LuxuryLayer from "@alts/components/LuxuryLayer";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "@ls/api-client";
import { readCollection } from "@alts/offline/db";
import { isShopOffline } from "@alts/offline/status";
import { matchesCustomer } from "@alts/offline/map";
import { cn } from "@ls/design/utils";
import { Search, X, Loader2, CornerDownLeft, Command } from "lucide-react";
import { kioskFromSearch } from "@alts/lib/kiosk";
import { ALTS_SEARCH_PLACEHOLDER } from "@alts/components/AltsSearchField";
import { formatMoney } from "@alts/lib/money";

export type SearchHit = {
  type: string;
  id: string;
  title: string;
  subtitle?: string | null;
  meta?: string | null;
  amount?: number | null;
  outstanding?: number | null;
  href: string;
};

const TYPE_LABEL: Record<string, string> = {
  alteration: "Ticket",
  customer: "Customer",
  delivery: "Delivery",
  invoice: "Invoice",
  sales_order: "Order",
  fabric: "Fabric",
  intelligence: "Note",
  sms: "SMS",
  task: "Task",
};

const TYPE_TONE: Record<string, string> = {
  alteration: "bg-brass/20 text-brass-light border-brass/35",
  customer: "bg-signal-emerald/15 text-signal-emerald border-signal-emerald/30",
  delivery: "bg-sky-500/15 text-sky-300 border-sky-400/30",
  invoice: "bg-amber-500/15 text-amber-200 border-amber-400/30",
  sales_order: "bg-violet-500/15 text-violet-300 border-violet-400/30",
  fabric: "bg-white/5 text-cream-muted border-white/10",
  intelligence: "bg-white/5 text-cream-muted border-white/10",
  sms: "bg-white/5 text-cream-muted border-white/10",
};

function money(n?: number | null) {
  if (n == null || Number.isNaN(Number(n))) return "";
  return formatMoney(n);
}

function useDebounced<T>(value: T, ms = 220): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function shouldHide(pathname: string, search = ""): boolean {
  if (kioskFromSearch(search)) return true;
  if (/^\/(login)(\/|$)/i.test(pathname)) return true;
  if (/^\/(e-ticket|t)\//i.test(pathname)) return true;
  if (/^\/pay\//i.test(pathname)) return true;
  if (/\/(tags|thermal|receipt|label)(\/|$)/i.test(pathname)) return true;
  if (/^\/qc(\/|$)/i.test(pathname)) return true;
  if (/^\/admin(\/|$)/i.test(pathname)) return true;
  return false;
}

function isExternalHref(href: string) {
  return /^https?:\/\//i.test(href);
}

/** Inline compact search for page headers (home, shell). */
export function UniversalSearchInline({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "flex items-center gap-2 min-h-[44px] min-w-0 flex-1 max-w-xl",
          "rounded-full border border-brass/25 bg-black/30 px-3.5 sm:px-4",
          "text-left text-cream-dim hover:border-brass/45 hover:text-cream transition-colors",
          className,
        )}
        aria-label="Universal search"
      >
        <Search className="h-4 w-4 text-brass-light shrink-0" />
        <span className="truncate text-[12.5px] sm:text-[13px]">
          {ALTS_SEARCH_PLACEHOLDER}
        </span>
        <kbd className="hidden sm:inline-flex ml-auto items-center gap-0.5 rounded-md border border-brass/20 bg-black/30 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-cream-dim">
          <Command className="h-3 w-3" />K
        </kbd>
      </button>
      <UniversalSearchPalette open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * Global host — ⌘K / Ctrl+K anywhere, plus a fixed top pill on pages
 * that don't embed UniversalSearchInline (most FOH routes outside shell home).
 */
export default function UniversalSearchHost() {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (shouldHide(pathname, search)) return;
      const isModK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (isModK) {
        e.preventDefault();
        setOpen(true);
        return;
      }
      // "/" opens search when not typing in an input
      if (
        e.key === "/" &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !(e.target instanceof HTMLElement &&
          (e.target.tagName === "INPUT" ||
            e.target.tagName === "TEXTAREA" ||
            e.target.isContentEditable))
      ) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathname, search]);

  // Close palette on navigate
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (shouldHide(pathname, search)) return null;

  // Home + shell already show inline search in their headers — only ⌘K host needed there.
  // Still show a thin fixed trigger on dense pages without the inline control.
  const showFixedTrigger =
    pathname !== "/" &&
    !pathname.startsWith("/customers") &&
    !pathname.startsWith("/invoices") &&
    !pathname.startsWith("/deliveries") &&
    !pathname.startsWith("/orders/alterations") &&
    !pathname.startsWith("/reports") &&
    !pathname.startsWith("/shop-floor") &&
    !pathname.startsWith("/production") &&
    !pathname.startsWith("/pickup") &&
    !pathname.startsWith("/intake") &&
    !pathname.startsWith("/lookup") &&
    !pathname.startsWith("/quote") &&
    !pathname.startsWith("/dispatch") &&
    !pathname.startsWith("/transfers") &&
    !pathname.startsWith("/parked") &&
    !pathname.startsWith("/floor-performance") &&
    !pathname.startsWith("/appointments") &&
    !pathname.startsWith("/tasks") &&
    !pathname.startsWith("/messages") &&
    !pathname.startsWith("/house");

  return (
    <>
      {showFixedTrigger && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn(
            "fixed z-[58] left-1/2 -translate-x-1/2",
            "top-[max(0.5rem,env(safe-area-inset-top))]",
            "flex items-center gap-2 h-10 px-4 max-w-[min(420px,calc(100vw-7rem))]",
            "rounded-full border border-brass/35 bg-forest-deep/92 text-cream-dim",
            "shadow-[0_8px_28px_rgba(0,0,0,0.4)] backdrop-blur-xl",
            "hover:border-brass/55 hover:text-cream transition-colors",
            "text-[12px] font-medium",
          )}
          aria-label="Open universal search"
        >
          <Search className="h-3.5 w-3.5 text-brass-light shrink-0" />
          <span className="truncate">Search anything</span>
          <kbd className="hidden md:inline text-[10px] opacity-70 ml-1">⌘K</kbd>
        </button>
      )}
      <UniversalSearchPalette open={open} onOpenChange={setOpen} />
    </>
  );
}

function UniversalSearchPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const debounced = useDebounced(q.trim(), 200);

  const search = useQuery({
    queryKey: ["universal-search", debounced],
    enabled: open && debounced.length >= 1,
    staleTime: 15_000,
    queryFn: async () => {
      const fromCache = async (): Promise<SearchHit[]> => {
        const s = debounced.toLowerCase();
        const tickets = await readCollection("tickets");
        const customers = await readCollection("customers");
        const ticketHits = tickets
          .filter((t) => {
            const blob = [t.name, t.customer_name, t.customer_phone].filter(Boolean).join(" ").toLowerCase();
            return blob.includes(s);
          })
          .slice(0, 12)
          .map((t) => ({
            type: "alteration",
            id: String(t.name ?? ""),
            title: String(t.customer_name ?? t.name ?? ""),
            subtitle: String(t.name ?? ""),
            href: `/orders/alterations/${encodeURIComponent(String(t.name ?? ""))}`,
          }));
        const customerHits = customers
          .filter((c) => matchesCustomer(c, debounced))
          .slice(0, 8)
          .map((c) => ({
            type: "customer",
            id: String(c.name ?? ""),
            title: String(c.customer_name ?? c.name ?? ""),
            subtitle: String(c.mobile_no ?? ""),
            href: `/customers/${encodeURIComponent(String(c.name ?? ""))}`,
          }));
        return [...ticketHits, ...customerHits];
      };
      if (isShopOffline()) return fromCache();
      try {
        const res = await api.get<{ results?: SearchHit[]; query?: string }>(
          `/api/search?q=${encodeURIComponent(debounced)}`,
        );
        return (res?.results ?? []) as SearchHit[];
      } catch {
        return fromCache();
      }
    },
  });

  const hits = search.data ?? [];

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      // next tick so portal is mounted
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [debounced, hits.length]);

  const go = useCallback(
    (hit: SearchHit) => {
      onOpenChange(false);
      if (isExternalHref(hit.href)) {
        window.open(hit.href, "_blank", "noopener,noreferrer");
        return;
      }
      // Instant jump for bare ALT ids even if href missing
      if (hit.type === "alteration" && hit.id) {
        nav(`/orders/alterations/${encodeURIComponent(hit.id)}`);
        return;
      }
      nav(hit.href || "/lookup");
    },
    [nav, onOpenChange],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onOpenChange(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(0, hits.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) go(hit);
      else if (/^ALT-/i.test(q.trim())) {
        onOpenChange(false);
        nav(`/orders/alterations/${encodeURIComponent(q.trim().toUpperCase())}`);
      } else if (q.trim().length >= 2) {
        onOpenChange(false);
        nav(`/lookup?q=${encodeURIComponent(q.trim())}`);
      }
    }
  };

  // Keep active row visible
  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const el = root.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const grouped = useMemo(() => {
    const order = [
      "alteration",
      "customer",
      "delivery",
      "invoice",
      "sales_order",
      "fabric",
      "sms",
      "intelligence",
      "task",
    ];
    const map = new Map<string, SearchHit[]>();
    for (const h of hits) {
      const k = h.type || "other";
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(h);
    }
    return order.filter((k) => map.has(k)).map((k) => ({ type: k, items: map.get(k)! }));
  }, [hits]);

  // Flat index map for keyboard
  const flatIndex = useMemo(() => {
    const m = new Map<string, number>();
    hits.forEach((h, i) => m.set(`${h.type}:${h.id}`, i));
    return m;
  }, [hits]);

  return (
    <LuxuryLayer
      open={open}
      onClose={() => onOpenChange(false)}
      variant="search"
      label="Universal search"
      z={80}
    >
      <div
        className={cn(
          "rounded-2xl border border-brass/30 overflow-hidden",
          "shadow-[0_32px_80px_rgba(0,0,0,0.55)]",
          "bg-gradient-to-b from-[#152A1E] to-[#0D1A10]",
        )}
      >
        <div className="flex items-center gap-2.5 px-4 border-b border-brass/20">
          <Search className="h-5 w-5 text-brass-light shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={ALTS_SEARCH_PLACEHOLDER}
            className="flex-1 h-14 bg-transparent text-[16px] text-cream outline-none placeholder:text-cream-dim"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          {search.isFetching && <Loader2 className="h-4 w-4 animate-spin text-brass-light" />}
          {q && (
            <button
              type="button"
              onClick={() => setQ("")}
              className="p-2 rounded-lg text-cream-dim hover:text-cream hover:bg-white/5"
              aria-label="Clear"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="hidden sm:inline text-[10px] font-bold tracking-widest uppercase text-cream-dim border border-brass/20 rounded-md px-2 py-1"
          >
            Esc
          </button>
        </div>

        <div ref={listRef} className="max-h-[min(58vh,480px)] overflow-y-auto overscroll-contain">
          {!debounced && (
            <div className="px-5 py-8 text-center text-cream-dim text-sm space-y-3">
              <p className="display text-2xl italic text-cream-muted">Find anything</p>
              <p className="text-[12.5px] leading-relaxed max-w-sm mx-auto">
                Type a name, phone, <span className="text-brass-light font-mono">ALT-…</span>, invoice,
                delivery, or sales order. Tap a row to jump.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {["ALT-", "Ready", "SINV", "DELIV"].map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => setQ(chip)}
                    className="px-3 py-1.5 rounded-full border border-brass/25 text-[11px] font-bold tracking-wide uppercase text-cream-dim hover:border-brass/50 hover:text-cream"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {debounced && search.isError && (
            <div className="px-5 py-6 text-sm text-signal-rose">
              Search failed — check connection and try again.
            </div>
          )}

          {debounced && !search.isFetching && !hits.length && !search.isError && (
            <div className="px-5 py-8 text-center text-cream-dim text-sm">
              No matches for <span className="text-cream font-medium">“{debounced}”</span>
              <div className="mt-3">
                <button
                  type="button"
                  className="text-brass-light text-xs font-bold tracking-widest uppercase"
                  onClick={() => {
                    onOpenChange(false);
                    nav(`/lookup?q=${encodeURIComponent(debounced)}`);
                  }}
                >
                  Open full lookup →
                </button>
              </div>
            </div>
          )}

          {grouped.map((g) => (
            <div key={g.type} className="py-2">
              <div className="px-4 py-1.5 text-[10px] font-bold tracking-[0.16em] uppercase text-brass-light/90">
                {TYPE_LABEL[g.type] || g.type}
                <span className="text-cream-dim font-semibold normal-case tracking-normal ml-1.5">
                  {g.items.length}
                </span>
              </div>
              {g.items.map((hit) => {
                const idx = flatIndex.get(`${hit.type}:${hit.id}`) ?? 0;
                const sel = idx === active;
                return (
                  <button
                    key={`${hit.type}:${hit.id}`}
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => go(hit)}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors",
                      sel ? "bg-brass/15" : "hover:bg-white/[0.04]",
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 text-[9px] font-bold tracking-[0.12em] uppercase px-2 py-1 rounded-md border",
                        TYPE_TONE[hit.type] || TYPE_TONE.fabric,
                      )}
                    >
                      {TYPE_LABEL[hit.type] || hit.type}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-[13.5px] text-cream truncate">
                        {hit.title}
                      </span>
                      {(hit.subtitle || hit.meta) && (
                        <span className="block text-[11.5px] text-cream-dim truncate mt-0.5">
                          {[hit.subtitle, hit.meta].filter(Boolean).join(" · ")}
                        </span>
                      )}
                    </span>
                    {(hit.amount != null || hit.outstanding != null) && (
                      <span className="shrink-0 text-right">
                        {hit.amount != null && (
                          <span className="block text-sm text-brass-light font-semibold tabular-nums">
                            {money(hit.amount)}
                          </span>
                        )}
                        {hit.outstanding != null && hit.outstanding > 0 && (
                          <span className="block text-[10px] text-amber-300/90 tabular-nums">
                            due {money(hit.outstanding)}
                          </span>
                        )}
                      </span>
                    )}
                    {sel && <CornerDownLeft className="h-3.5 w-3.5 text-brass-light shrink-0 opacity-80" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 px-4 py-2.5 border-t border-brass/15 text-[10.5px] text-cream-dim bg-black/25">
          <span>
            <kbd className="font-mono text-cream-muted">↑↓</kbd> move
          </span>
          <span>
            <kbd className="font-mono text-cream-muted">↵</kbd> open
          </span>
          <span>
            <kbd className="font-mono text-cream-muted">esc</kbd> close
          </span>
          <span className="ml-auto hidden sm:inline">alts · ERPNext live</span>
        </div>
      </div>
    </LuxuryLayer>
  );
}
