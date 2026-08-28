import { useEffect, useMemo, useRef, useState } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { localFirstTickets } from "@alts/offline/localFirst";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";
import { BrandSeal } from "@alts/components/BrandSeal";

type Ticket = {
  name: string;
  customer_name?: string;
  workflow_state?: string;
  origin_location?: string;
  assigned_tailor?: string;
  due_date?: string;
  garments?: Array<{ garment_id: string; garment_type?: string; garment_description?: string }>;
};

type Tailor = { name: string; full_name: string };

type ManifestRow = {
  key: string;
  ticket: string;
  garmentId: string;
  customer?: string;
  label: string;
};

/** Parse scanner / HID / pasted QR into ticket + optional garment. */
function parseScan(raw: string): { ticket: string; garmentId?: string } | null {
  const s = raw.trim();
  if (!s) return null;
  // https://alts.../g/ALT-NYC-2026-00048/G1
  const path = s.match(/\/g\/([^/?#\s]+)\/([^/?#\s]+)/i);
  if (path) return { ticket: decodeURIComponent(path[1]), garmentId: decodeURIComponent(path[2]) };
  // ALT-NYC-2026-00048/G1 or ALT-…:G1
  const slash = s.match(/^(ALT-[A-Z0-9-]+)[/:]?(G\d+)$/i);
  if (slash) return { ticket: slash[1], garmentId: slash[2].toUpperCase() };
  // bare ticket
  if (/^ALT-[A-Z0-9-]+$/i.test(s)) {
    return { ticket: s.replace(/^alt-/i, "ALT-") };
  }
  // G-TICKET-INDEX style tokens sometimes used
  const gtok = s.match(/^G-(ALT-[A-Z0-9-]+)-(\d+)$/i);
  if (gtok) return { ticket: gtok[1], garmentId: `G${gtok[2]}` };
  return null;
}

export default function Transfers() {
  const nav = useNavigate();
  const [searchParams] = useSearchParams();
  const qc = useQueryClient();
  const scanRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(searchParams.get("ticket"));
  const [dest, setDest] = useState<"NYC" | "Home">("Home");
  const [tailorId, setTailorId] = useState("");
  const [scan, setScan] = useState("");
  const [manifest, setManifest] = useState<ManifestRow[]>([]);
  const [tab, setTab] = useState<"send" | "home">("send");

  const tickets = useQuery({
    queryKey: ["xfer-tickets"],
    queryFn: () =>
      localFirstTickets(() => api.get<Ticket[]>("/api/intake-alterations/tickets?limit=500")),
  });

  useEffect(() => {
    const t = searchParams.get("ticket");
    if (t) setSelected(t);
  }, [searchParams]);

  useEffect(() => {
    if (tab === "send") {
      const id = window.setTimeout(() => scanRef.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
  }, [tab]);

  const tailors = useQuery({
    queryKey: ["tailors"],
    queryFn: () => api.get<Tailor[]>("/api/intake-alterations/tailors"),
  });

  const list = useMemo(() => {
    let rows = (tickets.data ?? []).filter(
      (t) => t.workflow_state !== "Picked Up" && t.workflow_state !== "Cancelled",
    );
    if (q.trim()) {
      const s = q.toLowerCase();
      rows = rows.filter(
        (t) => t.name.toLowerCase().includes(s) || t.customer_name?.toLowerCase().includes(s),
      );
    }
    return rows;
  }, [tickets.data, q]);

  const atHome = list.filter((t) => !!t.assigned_tailor);

  async function addFromScan(raw: string) {
    const parsed = parseScan(raw);
    if (!parsed) {
      toast.error("Could not read tag — scan garment QR or type ALT-…/G1");
      return;
    }
    let ticket = (tickets.data ?? []).find(
      (t) => t.name.toLowerCase() === parsed.ticket.toLowerCase(),
    );
    if (!ticket) {
      try {
        ticket = await api.get<Ticket>(
          `/api/intake-alterations/tickets/${encodeURIComponent(parsed.ticket)}`,
        );
      } catch {
        toast.error(`Ticket ${parsed.ticket} not found`);
        return;
      }
    }
    setSelected(ticket.name);

    let garmentId = parsed.garmentId;
    let label = garmentId || "Ticket";
    if (!garmentId) {
      // load garments if missing on list payload
      try {
        const full = await api.get<Ticket>(
          `/api/intake-alterations/tickets/${encodeURIComponent(ticket.name)}`,
        );
        const gs = full.garments ?? [];
        if (gs.length === 1) {
          garmentId = gs[0].garment_id;
          label = gs[0].garment_description || gs[0].garment_type || garmentId;
        } else if (gs.length > 1) {
          toast.message("Ticket has multiple garments — scan a garment QR or pick below");
          setSelected(ticket.name);
          return;
        } else {
          garmentId = "G1";
          label = "Piece";
        }
      } catch {
        garmentId = "G1";
      }
    } else {
      try {
        const full = await api.get<Ticket>(
          `/api/intake-alterations/tickets/${encodeURIComponent(ticket.name)}`,
        );
        const g = (full.garments ?? []).find(
          (x) => x.garment_id.toUpperCase() === garmentId!.toUpperCase(),
        );
        if (g) label = g.garment_description || g.garment_type || garmentId;
      } catch {
        /* keep id */
      }
    }

    const key = `${ticket.name}::${garmentId}`;
    setManifest((prev) => {
      if (prev.some((r) => r.key === key)) {
        toast.message("Already on manifest");
        return prev;
      }
      toast.success(`Added ${garmentId} · ${ticket!.name}`);
      return [
        ...prev,
        {
          key,
          ticket: ticket!.name,
          garmentId: garmentId!,
          customer: ticket!.customer_name,
          label,
        },
      ];
    });
  }

  const transfer = useMutation({
    mutationFn: async () => {
      const names = manifest.length
        ? [...new Set(manifest.map((m) => m.ticket))]
        : selected
          ? [selected]
          : [];
      if (!names.length) throw new Error("Scan tags or pick a ticket");
      if (dest === "Home" && !tailorId) throw new Error("Pick an at-home tailor");
      for (const name of names) {
        await api.patch(`/api/intake-alterations/tickets/${encodeURIComponent(name)}/transfer`, {
          location: dest,
          tailorId: dest === "Home" ? tailorId : tailorId || null,
        });
      }
      return names.length;
    },
    onSuccess: (n) => {
      toast.success(
        dest === "Home"
          ? `Sent ${n} ticket${n === 1 ? "" : "s"} to at-home tailor`
          : `Moved ${n} ticket${n === 1 ? "" : "s"} to ${dest}`,
      );
      qc.invalidateQueries({ queryKey: ["xfer-tickets"] });
      setSelected(null);
      setTailorId("");
      setManifest([]);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sel = list.find((t) => t.name === selected);

  return (
    <div className="alts-root min-h-dvh flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <BrandSeal />
        <div>
          <div className="display text-xl">Transfers</div>
          <div className="caps">Shop · at-home · scan-to-manifest</div>
        </div>
        <div className="flex-1" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find ticket…"
          className="hidden md:block h-11 rounded-full bg-black/30 border border-brass/25 px-4 text-sm text-cream outline-none min-w-[220px]"
        />
      </header>

      <div className="flex gap-2 px-5 py-3 border-b border-brass/10">
        {(
          [
            ["send", "Send out"],
            ["home", "At home now"],
          ] as const
        ).map(([k, lab]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={cn(
              "px-4 h-11 rounded-full text-xs font-bold uppercase tracking-wide border",
              tab === k ? "bg-brass text-forest-deep border-brass" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
          </button>
        ))}
      </div>

      {tickets.isError && (
        <QueryErrorPanel
          title="Could not load tickets"
          onRetry={() => tickets.refetch()}
          className="mx-5 mt-3"
        />
      )}

      {tab === "send" && (
        <div className="flex-1 grid lg:grid-cols-[1fr_360px] min-h-0 phone-stack">
          <div className="overflow-y-auto p-4 space-y-3">
            <div className="xfer-panel card-glass p-3">
              <div className="caps mb-2">Scan garment tags</div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = scan;
                  setScan("");
                  void addFromScan(v);
                  scanRef.current?.focus();
                }}
              >
                <input
                  ref={scanRef}
                  value={scan}
                  onChange={(e) => setScan(e.target.value)}
                  placeholder="Scan QR / type ALT-…/G1 — Enter"
                  className="w-full h-12 rounded-xl bg-black/30 border border-brass/40 px-4 text-sm text-cream outline-none focus:border-brass"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </form>
              <p className="text-[12px] text-cream-dim mt-2">
                Fastest path — HID wedge stays focused here. Every piece leaving is logged on the
                manifest.
              </p>
            </div>

            {manifest.length > 0 && (
              <div className="xfer-panel card-glass p-3 space-y-2">
                <div className="caps">Going out · {manifest.length}</div>
                {manifest.map((m) => (
                  <div
                    key={m.key}
                    className="flex items-center gap-2 border border-brass/20 rounded-lg px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold truncate">
                        {m.garmentId} · {m.label}
                      </div>
                      <div className="text-[12px] text-cream-dim truncate">
                        {m.ticket}
                        {m.customer ? ` · ${m.customer}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="h-11 w-11 text-cream-dim hover:text-cream"
                      onClick={() => setManifest((p) => p.filter((x) => x.key !== m.key))}
                      aria-label="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="caps px-1 mb-1">Open tickets · tap to add · {list.length}</div>
            {list.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => {
                  setSelected(t.name);
                  void addFromScan(t.name);
                }}
                className={cn(
                  "w-full text-left card-glass p-3.5",
                  selected === t.name && "border-brass ring-1 ring-brass/40",
                  manifest.some((m) => m.ticket === t.name) && "border-brass/50",
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[12px] text-brass-light">{t.name}</span>
                  <span className="chip">{t.workflow_state}</span>
                  <span className="ml-auto text-xs text-cream-dim">{t.origin_location || "NYC"}</span>
                </div>
                <div className="font-semibold mt-1">{t.customer_name}</div>
                {t.assigned_tailor && (
                  <div className="text-xs text-cream-dim mt-1">Tailor: {t.assigned_tailor}</div>
                )}
              </button>
            ))}
          </div>

          <aside className="border-l border-brass/15 p-5 overflow-y-auto">
            <div className="caps mb-3">Send to</div>
            {!selected && !manifest.length && (
              <p className="text-cream-dim text-sm">Scan a tag or select a ticket.</p>
            )}
            {(selected || manifest.length > 0) && (
              <>
                {sel && (
                  <>
                    <div className="display text-2xl mb-1">{sel.customer_name}</div>
                    <div className="font-mono text-xs text-brass-light mb-4">{sel.name}</div>
                  </>
                )}
                {manifest.length > 0 && (
                  <div className="text-sm text-cream-dim mb-3">
                    Manifest: {manifest.length} piece{manifest.length === 1 ? "" : "s"} ·{" "}
                    {[...new Set(manifest.map((m) => m.ticket))].length} ticket
                    {[...new Set(manifest.map((m) => m.ticket))].length === 1 ? "" : "s"}
                  </div>
                )}
                <div className="flex flex-col gap-2 mb-4">
                  {(["NYC", "Home"] as const).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDest(d)}
                      className={cn(
                        "h-12 rounded-xl border text-sm font-bold tracking-wide uppercase",
                        dest === d
                          ? "bg-brass text-forest-deep border-brass"
                          : "border-brass/30 text-cream-dim",
                      )}
                    >
                      {d === "Home" ? "At-home employee" : "NYC Store"}
                    </button>
                  ))}
                </div>
                {dest === "Home" && (
                  <label className="block mb-4">
                    <span className="caps">Assign tailor</span>
                    <select
                      value={tailorId}
                      onChange={(e) => setTailorId(e.target.value)}
                      className="mt-2 w-full h-12 rounded-xl bg-black/30 border border-brass/25 px-3 text-cream"
                    >
                      <option value="">— pick tailor —</option>
                      {(tailors.data ?? []).map((t) => (
                        <option key={t.name} value={t.name}>
                          {t.full_name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  disabled={transfer.isPending}
                  onClick={() => transfer.mutate()}
                  className="btn-brass w-full h-14 text-[12px]"
                >
                  {transfer.isPending
                    ? "Saving…"
                    : manifest.length
                      ? `Send ${manifest.length} piece${manifest.length === 1 ? "" : "s"} out`
                      : "Confirm transfer"}
                </button>
                {selected && (
                  <button
                    type="button"
                    onClick={() => nav(`/orders/alterations/${selected}`)}
                    className="btn-ghost w-full h-11 mt-2 text-[12px]"
                  >
                    Open ticket
                  </button>
                )}
              </>
            )}
          </aside>
        </div>
      )}

      {tab === "home" && (
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          <div className="caps mb-2">At home now · {atHome.length}</div>
          {atHome.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => {
                setSelected(t.name);
                setTab("send");
              }}
              className="xfer-row w-full text-left text-sm card-glass px-3 py-3 min-h-11"
            >
              <span className="font-mono text-[12px] text-brass-light">{t.name}</span>
              <div className="font-semibold">{t.customer_name}</div>
              <div className="text-[12px] text-cream-dim">{t.assigned_tailor}</div>
            </button>
          ))}
          {!atHome.length && <p className="text-cream-dim text-xs italic">None flagged home</p>}
        </div>
      )}
    </div>
  );
}
