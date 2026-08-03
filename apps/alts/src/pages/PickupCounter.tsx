import { useEffect, useMemo, useState } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { billingStatusLabel } from "@alts/lib/billingLabels";
import { ChargeCardOnFileButton } from "@alts/components/payments/ChargeCardOnFileButton";
import { ChargeTerminalButton } from "@alts/components/payments/ChargeTerminalButton";
import "@alts/styles/alts-pos.css";

type Ticket = {
  name: string;
  customer?: string;
  customer_name?: string;
  customer_mobile?: string;
  customer_phone?: string;
  workflow_state?: string;
  due_date?: string;
  ticket_total?: number;
  payment_status?: string;
  billing_status?: string;
  delivery_method?: string;
  garments?: Array<{
    name?: string;
    garment_id?: string;
    garment_type?: string;
    color?: string;
    garment_total?: number;
  }>;
  lines?: Array<{ description?: string; price?: number; garment?: string }>;
  sales_invoice?: string;
};

type InvoiceRow = {
  id: string;
  customer?: { id: string; name: string } | null;
  customerName?: string | null;
  status: string;
  kind?: "alteration" | "custom" | "other";
  grandTotal: number;
  outstandingAmount: number;
  postingDate?: string | null;
  alterationTicketRef?: string | null;
  salesOrder?: string | null;
};

type BoardDelivery = {
  id: string;
  status?: string;
  method?: string | null;
  courierName?: string | null;
  deliveredAt?: string | null;
};

type QueueKind = "ticket" | "invoice";

type QueueItem = {
  key: string;
  kind: QueueKind;
  id: string;
  customerId?: string;
  customerName: string;
  phone?: string;
  total: number;
  /** Amount still due at counter */
  outstanding: number;
  paymentLabel: string;
  unpaid: boolean;
  /** ticket fields */
  billingStatus?: string;
  salesInvoice?: string;
  garmentCount?: number;
  /** invoice fields */
  invoiceKind?: "alteration" | "custom" | "other";
  ticketRef?: string | null;
  salesOrder?: string | null;
};

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function ticketKey(name: string) {
  return `t:${name}`;
}
function invoiceKey(id: string) {
  return `i:${id}`;
}

function customerMatchKey(item: QueueItem) {
  return (item.customerId || item.customerName || "").trim().toLowerCase();
}

export default function PickupCounter() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const preTicket = params.get("ticket");
  const preInvoice = params.get("invoice");

  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (preTicket) s.add(ticketKey(preTicket));
    if (preInvoice) s.add(invoiceKey(preInvoice));
    return s;
  });
  /** Last tapped row — drives detail / charge focus */
  const [focusKey, setFocusKey] = useState<string | null>(
    preTicket ? ticketKey(preTicket) : preInvoice ? invoiceKey(preInvoice) : null,
  );
  const [confirmWho, setConfirmWho] = useState(true);
  const [collector, setCollector] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "tickets" | "invoices" | "paid" | "unpaid">("all");

  useEffect(() => {
    if (preTicket) {
      setSelected((prev) => new Set(prev).add(ticketKey(preTicket)));
      setFocusKey(ticketKey(preTicket));
    }
  }, [preTicket]);
  useEffect(() => {
    if (preInvoice) {
      setSelected((prev) => new Set(prev).add(invoiceKey(preInvoice)));
      setFocusKey(invoiceKey(preInvoice));
    }
  }, [preInvoice]);

  const ready = useQuery({
    queryKey: ["pickup-ready"],
    queryFn: () => api.get<Ticket[]>("/api/intake-alterations/tickets?status=Ready&limit=100"),
    refetchInterval: 30_000,
  });

  const openInvoices = useQuery({
    queryKey: ["pickup-open-invoices"],
    queryFn: async () => {
      const res = await api.raw("/api/invoices?status=open&limit=300");
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error?.message || `Invoices failed (${res.status})`);
      return (Array.isArray(json?.data) ? json.data : []) as InvoiceRow[];
    },
    refetchInterval: 45_000,
  });

  const queue = useMemo(() => {
    const tickets = ready.data ?? [];
    const invoices = openInvoices.data ?? [];

    // Ready ticket SI names — avoid double-listing open alt invoices already on the Ready board
    const readySi = new Set(
      tickets.map((t) => (t.sales_invoice || "").trim()).filter(Boolean),
    );
    const readyTicketNames = new Set(tickets.map((t) => t.name));

    const items: QueueItem[] = [];

    for (const t of tickets) {
      const total = Number(t.ticket_total) || 0;
      const unpaid =
        t.payment_status !== "Paid" &&
        t.payment_status !== "N/A" &&
        total > 0 &&
        t.billing_status !== "Warranty" &&
        t.billing_status !== "Included in Custom Order";
      items.push({
        key: ticketKey(t.name),
        kind: "ticket",
        id: t.name,
        customerId: t.customer,
        customerName: t.customer_name || "—",
        phone: t.customer_mobile || t.customer_phone || "",
        total,
        outstanding: unpaid ? total : 0,
        paymentLabel: t.payment_status || "—",
        unpaid,
        billingStatus: t.billing_status,
        salesInvoice: t.sales_invoice,
        garmentCount: t.garments?.length,
      });
    }

    for (const inv of invoices) {
      const id = inv.id;
      if (!id) continue;
      // Skip open SI already shown via its Ready alt ticket
      if (readySi.has(id)) continue;
      const altRef = (inv.alterationTicketRef || "").trim();
      if (altRef && readyTicketNames.has(altRef)) continue;

      const outstanding = Number(inv.outstandingAmount) || 0;
      if (outstanding <= 0.005) continue;

      items.push({
        key: invoiceKey(id),
        kind: "invoice",
        id,
        customerId: inv.customer?.id,
        customerName: inv.customerName || inv.customer?.name || "—",
        phone: "",
        total: Number(inv.grandTotal) || outstanding,
        outstanding,
        paymentLabel: inv.status || "open",
        unpaid: true,
        invoiceKind: inv.kind,
        ticketRef: inv.alterationTicketRef,
        salesOrder: inv.salesOrder,
      });
    }

    // Stable sort: customer name, then tickets before invoices, then id
    items.sort((a, b) => {
      const c = a.customerName.localeCompare(b.customerName);
      if (c) return c;
      if (a.kind !== b.kind) return a.kind === "ticket" ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

    return items;
  }, [ready.data, openInvoices.data]);

  const list = useMemo(() => {
    let rows = queue;
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      rows = rows.filter(
        (r) =>
          r.id.toLowerCase().includes(s) ||
          r.customerName.toLowerCase().includes(s) ||
          (r.phone || "").includes(s) ||
          (r.salesInvoice || "").toLowerCase().includes(s) ||
          (r.ticketRef || "").toLowerCase().includes(s) ||
          (r.salesOrder || "").toLowerCase().includes(s),
      );
    }
    if (filter === "tickets") rows = rows.filter((r) => r.kind === "ticket");
    if (filter === "invoices") rows = rows.filter((r) => r.kind === "invoice");
    if (filter === "paid") rows = rows.filter((r) => !r.unpaid);
    if (filter === "unpaid") rows = rows.filter((r) => r.unpaid);
    return rows;
  }, [queue, q, filter]);

  const selectedItems = useMemo(
    () => queue.filter((r) => selected.has(r.key)),
    [queue, selected],
  );

  const focusItem =
    selectedItems.find((r) => r.key === focusKey) || selectedItems[0] || null;

  // Detail for focused ticket
  const detail = useQuery({
    queryKey: ["pickup-ticket", focusItem?.kind === "ticket" ? focusItem.id : null],
    enabled: focusItem?.kind === "ticket",
    queryFn: () => api.get<Ticket>(`/api/intake-alterations/tickets/${focusItem!.id}`),
  });

  const board = useQuery({
    queryKey: ["pickup-board", focusItem?.kind === "ticket" ? focusItem.id : null],
    enabled: focusItem?.kind === "ticket",
    queryFn: () =>
      api.get<BoardDelivery[]>(
        `/api/deliveries?alterationTicket=${encodeURIComponent(focusItem!.id)}`,
      ),
    staleTime: 15_000,
  });

  const t = detail.data;
  const boardRow = (board.data ?? [])[0] ?? null;

  const bagTotal = selectedItems.reduce((s, i) => s + i.total, 0);
  const bagOutstanding = selectedItems.reduce((s, i) => s + i.outstanding, 0);
  const bagTickets = selectedItems.filter((i) => i.kind === "ticket");
  const bagInvoices = selectedItems.filter((i) => i.kind === "invoice");
  const bagUnpaid = selectedItems.filter((i) => i.unpaid);

  const sameCustomerOthers = useMemo(() => {
    if (!focusItem) return [] as QueueItem[];
    const ck = customerMatchKey(focusItem);
    if (!ck) return [];
    return queue.filter(
      (r) => customerMatchKey(r) === ck && !selected.has(r.key),
    );
  }, [focusItem, queue, selected]);

  function toggleKey(key: string, row?: QueueItem) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
    setFocusKey(key);
    if (row) {
      setConfirmWho(true);
      if (!collector.trim()) setCollector(row.customerName || "");
    }
  }

  function selectOnly(key: string, row: QueueItem) {
    setSelected(new Set([key]));
    setFocusKey(key);
    setConfirmWho(true);
    setCollector(row.customerName || "");
  }

  function selectAllForCustomer(row: QueueItem) {
    const ck = customerMatchKey(row);
    const keys = queue.filter((r) => customerMatchKey(r) === ck).map((r) => r.key);
    setSelected(new Set(keys));
    setFocusKey(row.key);
    setConfirmWho(true);
    setCollector(row.customerName || "");
    toast.success(`Selected ${keys.length} for ${row.customerName}`);
  }

  function clearSelection() {
    setSelected(new Set());
    setFocusKey(null);
  }

  const methodLabel = (m?: string | null) => {
    if (m === "Hand Delivery") return "Hand delivery";
    if (m === "Courier") return "Ship direct";
    if (m === "Pickup") return "Counter pickup";
    return m || "Not set";
  };

  const release = useMutation({
    mutationFn: async () => {
      if (!bagTickets.length) throw new Error("No Ready tickets selected to release");
      if (!confirmWho) throw new Error("Confirm who’s collecting");
      const errors: string[] = [];
      let ok = 0;
      let sms = 0;
      for (const item of bagTickets) {
        try {
          const data = await api.patch<{ unpaid_release_sms?: { sent?: boolean } }>(
            `/api/intake-alterations/tickets/${encodeURIComponent(item.id)}/status`,
            { status: "Picked Up", collected_by: collector.trim() || undefined },
          );
          ok += 1;
          if (data?.unpaid_release_sms?.sent) sms += 1;
        } catch (e: any) {
          errors.push(`${item.id}: ${e?.message || "failed"}`);
        }
      }
      return { ok, sms, errors, invoiceLeft: bagInvoices.length };
    },
    onSuccess: (data) => {
      if (data.ok) toast.success(`Released ${data.ok} ticket${data.ok === 1 ? "" : "s"}`);
      if (data.sms) toast.success(`Unpaid balance SMS ×${data.sms}`);
      if (data.invoiceLeft) {
        toast.message(
          `${data.invoiceLeft} invoice${data.invoiceLeft === 1 ? "" : "s"} still in bag — charge or open to clear`,
        );
      }
      for (const e of data.errors) toast.error(e);
      qc.invalidateQueries({ queryKey: ["pickup-ready"] });
      qc.invalidateQueries({ queryKey: ["pickup-board"] });
      qc.invalidateQueries({ queryKey: ["pickup-open-invoices"] });
      // Drop released tickets from selection; keep invoices
      setSelected((prev) => {
        const next = new Set(prev);
        for (const t of bagTickets) {
          if (!data.errors.some((e) => e.startsWith(t.id))) next.delete(t.key);
        }
        return next;
      });
      if (!data.invoiceLeft && !data.errors.length) {
        setCollector("");
        setFocusKey(null);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const payLink = useMutation({
    mutationFn: async (invoiceOrTicket: string) => {
      const res = await api.raw("/api/payments/link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoice: invoiceOrTicket }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "Link failed");
      return json as { url?: string; payment_url?: string; data?: { url?: string } };
    },
    onSuccess: async (json) => {
      const url =
        json?.url ||
        json?.payment_url ||
        json?.data?.url ||
        (typeof json === "object" && json && "link" in json ? String((json as any).link) : "");
      if (url && typeof url === "string" && url.startsWith("http")) {
        try {
          await navigator.clipboard?.writeText(url);
          toast.success("Pay link created — copied", { description: url });
        } catch {
          toast.success("Pay link created", { description: url });
        }
      } else {
        toast.success("Pay link created");
      }
      qc.invalidateQueries({ queryKey: ["pickup-ticket"] });
      qc.invalidateQueries({ queryKey: ["pickup-open-invoices"] });
      qc.invalidateQueries({ queryKey: ["pickup-ready"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const smsUnpaid = useMutation({
    mutationFn: async (ticketId: string) =>
      api.post(`/api/intake-alterations/tickets/${encodeURIComponent(ticketId)}/notify-unpaid-release`, {}),
    onSuccess: () => toast.success("Unpaid SMS sent"),
    onError: () => toast.error("SMS failed"),
  });

  const ticketCount = queue.filter((r) => r.kind === "ticket").length;
  const invoiceCount = queue.filter((r) => r.kind === "invoice").length;
  const unpaidCount = queue.filter((r) => r.unpaid).length;
  const loadError = ready.isError || openInvoices.isError;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["pickup-ready"] });
    qc.invalidateQueries({ queryKey: ["pickup-open-invoices"] });
    qc.invalidateQueries({ queryKey: ["pickup-ticket"] });
    qc.invalidateQueries({ queryKey: ["pickup-board"] });
  };

  // Charge target for focused unpaid row
  const chargeInvoiceId =
    focusItem?.kind === "invoice"
      ? focusItem.id
      : focusItem?.salesInvoice || (t?.sales_invoice ?? undefined);
  const chargeTicketId = focusItem?.kind === "ticket" ? focusItem.id : focusItem?.ticketRef || undefined;
  const chargeAmount =
    focusItem?.unpaid
      ? focusItem.outstanding || focusItem.total
      : bagUnpaid.length === 1
        ? bagUnpaid[0].outstanding || bagUnpaid[0].total
        : 0;
  const chargeTarget = focusItem?.unpaid
    ? focusItem
    : bagUnpaid.length === 1
      ? bagUnpaid[0]
      : null;

  return (
    <div className="alts-root flex flex-col min-h-dvh">
      {loadError && (
        <QueryErrorPanel
          title="Could not load pickup queue"
          onRetry={() => {
            void ready.refetch();
            void openInvoices.refetch();
          }}
          className="mx-4 mt-3"
        />
      )}
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20 flex-wrap">
        <Link to="/" className="text-cream-dim hover:text-cream p-2 text-lg min-h-11 min-w-11 grid place-items-center">
          ←
        </Link>
        <div>
          <h1 className="display text-2xl leading-none">Pickup</h1>
          <div className="caps mt-0.5">
            Ready alts · open invoices · multi-select
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2 rounded-full border border-brass/20 bg-black/30 px-3 h-11 min-w-[160px] flex-1 sm:flex-none sm:min-w-[220px]">
          <span className="text-cream-dim">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, ticket, SI, phone…"
            className="bg-transparent outline-none text-sm flex-1 text-cream placeholder:text-cream-dim"
          />
        </div>
        <Link
          to="/invoices"
          className="hidden sm:inline-flex items-center gap-2 h-11 px-4 rounded-full border border-brass/30 text-sm font-semibold text-brass-light hover:border-brass/50"
        >
          All invoices
        </Link>
        <Link
          to="/scanner"
          className="flex items-center gap-2 h-11 px-4 rounded-full border border-brass/30 text-sm font-semibold text-brass-light hover:border-brass/50"
        >
          ⌗ Scan
        </Link>
      </header>

      <div className="flex gap-2 px-5 py-3 border-b border-brass/10 flex-wrap">
        {(
          [
            ["all", `All · ${queue.length}`],
            ["tickets", `Ready alts · ${ticketCount}`],
            ["invoices", `Open invoices · ${invoiceCount}`],
            ["unpaid", `Unpaid · ${unpaidCount}`],
            ["paid", "Paid / N/A"],
          ] as const
        ).map(([k, lab]) => (
          <button
            key={k}
            type="button"
            onClick={() => setFilter(k)}
            className={cn(
              "px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border min-h-11",
              filter === k ? "bg-brass/20 border-brass text-cream" : "border-brass/25 text-cream-dim",
            )}
          >
            {lab}
          </button>
        ))}
        {selected.size > 0 && (
          <button
            type="button"
            onClick={clearSelection}
            className="ml-auto px-4 py-2 rounded-full text-xs font-bold uppercase tracking-wide border border-brass/40 text-brass min-h-11"
          >
            Clear bag · {selected.size}
          </button>
        )}
      </div>

      <div className="flex-1 grid lg:grid-cols-[360px_1fr] min-h-0 phone-stack">
        <aside className="border-r border-brass/15 overflow-y-auto p-3 space-y-2">
          <div className="caps px-2 py-2 flex justify-between gap-2">
            <span>
              Queue · {list.length}
            </span>
            {selected.size > 0 && (
              <span className="text-brass normal-case tracking-normal font-semibold">
                Bag {selected.size}
              </span>
            )}
          </div>
          <p className="text-[11px] text-cream-dim px-2 pb-1 leading-snug">
            Tap checkbox to multi-select. Same client can hold several tickets + invoices.
          </p>
          {list.map((row) => {
            const on = selected.has(row.key);
            const focused = focusKey === row.key;
            return (
              <div
                key={row.key}
                className={cn(
                  "w-full text-left card-glass p-3 flex gap-2 items-start",
                  on && "border-brass ring-1 ring-brass/40",
                  focused && on && "bg-brass/10",
                  row.unpaid && "border-l-2 border-l-signal-amber",
                )}
              >
                <button
                  type="button"
                  aria-label={on ? "Deselect" : "Add to bag"}
                  onClick={() => toggleKey(row.key, row)}
                  className={cn(
                    "mt-0.5 w-11 h-11 shrink-0 rounded-xl border-2 grid place-items-center text-sm font-bold",
                    on
                      ? "bg-brass border-brass text-forest-deep"
                      : "border-brass/40 text-cream-dim",
                  )}
                >
                  {on ? "✓" : ""}
                </button>
                <button
                  type="button"
                  className="flex-1 min-w-0 text-left"
                  onClick={() => {
                    // Focus + ensure in bag (single tap body doesn't wipe multi)
                    setSelected((prev) => {
                      const next = new Set(prev);
                      next.add(row.key);
                      return next;
                    });
                    setFocusKey(row.key);
                    setConfirmWho(true);
                    if (!collector.trim()) setCollector(row.customerName || "");
                  }}
                  onDoubleClick={() => selectOnly(row.key, row)}
                >
                  <div className="flex flex-wrap gap-1.5 items-center">
                    <span
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border",
                        row.kind === "ticket"
                          ? "border-emerald-500/40 text-emerald-300 bg-emerald-900/20"
                          : "border-brass/40 text-brass bg-brass/10",
                      )}
                    >
                      {row.kind === "ticket" ? "Alt ticket" : row.invoiceKind === "custom" ? "Custom SI" : "Invoice"}
                    </span>
                    <span className="text-[12px] font-mono text-brass-light truncate">{row.id}</span>
                  </div>
                  <div className="font-semibold mt-0.5 truncate">{row.customerName}</div>
                  <div className="flex justify-between text-xs mt-1 gap-2">
                    <span className={cn(row.unpaid ? "text-signal-amber" : "text-signal-emerald")}>
                      {row.paymentLabel}
                    </span>
                    <span className="text-brass-light shrink-0">
                      {row.unpaid && row.outstanding !== row.total
                        ? `${money(row.outstanding)} due`
                        : money(row.total)}
                    </span>
                  </div>
                </button>
              </div>
            );
          })}
          {!list.length && !ready.isLoading && !openInvoices.isLoading && !loadError && (
            <p className="text-cream-dim text-sm p-4 italic">Nothing in this filter</p>
          )}
          {(ready.isLoading || openInvoices.isLoading) && (
            <p className="text-cream-dim text-sm p-4">Loading queue…</p>
          )}
        </aside>

        <main className="overflow-y-auto p-5">
          {!selected.size && (
            <div className="h-full grid place-items-center text-cream-dim min-h-[40vh]">
              <div className="text-center max-w-md px-4">
                <div className="display text-3xl mb-2">Select tickets & invoices</div>
                <p className="text-sm">
                  Ready alteration tickets and open sales invoices. Multi-select for the same client —
                  release or charge the bag together.
                </p>
              </div>
            </div>
          )}

          {selected.size > 0 && (
            <div className="grid lg:grid-cols-[1fr_320px] gap-6 max-w-5xl">
              <div className="space-y-5">
                {/* Bag summary */}
                <div className="card-glass p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="caps">Pickup bag · {selected.size}</div>
                      <div className="display text-2xl mt-1">
                        {selectedItems[0]?.customerName}
                        {selectedItems.some(
                          (i) => customerMatchKey(i) !== customerMatchKey(selectedItems[0]),
                        )
                          ? " +"
                          : ""}
                      </div>
                      <div className="text-xs text-cream-dim mt-1">
                        {bagTickets.length} ticket{bagTickets.length === 1 ? "" : "s"}
                        {" · "}
                        {bagInvoices.length} invoice{bagInvoices.length === 1 ? "" : "s"}
                        {bagUnpaid.length ? ` · ${bagUnpaid.length} unpaid` : ""}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-cream-dim">Bag total</div>
                      <div className="display text-3xl text-brass-light">{money(bagTotal)}</div>
                      {bagOutstanding > 0 && (
                        <div className="text-sm text-signal-amber font-semibold">
                          {money(bagOutstanding)} due
                        </div>
                      )}
                    </div>
                  </div>

                  {sameCustomerOthers.length > 0 && focusItem && (
                    <button
                      type="button"
                      onClick={() => selectAllForCustomer(focusItem)}
                      className="w-full min-h-11 rounded-xl border border-brass/50 bg-brass/15 text-brass text-sm font-semibold"
                    >
                      + Add all {sameCustomerOthers.length} more for {focusItem.customerName}
                    </button>
                  )}

                  <ul className="space-y-2">
                    {selectedItems.map((item) => (
                      <li
                        key={item.key}
                        className={cn(
                          "flex items-center gap-2 rounded-xl border px-3 py-2.5 min-h-11",
                          focusKey === item.key
                            ? "border-brass bg-brass/10"
                            : "border-brass/20 bg-black/20",
                        )}
                      >
                        <button
                          type="button"
                          className="flex-1 text-left min-w-0"
                          onClick={() => setFocusKey(item.key)}
                        >
                          <div className="flex flex-wrap gap-1.5 items-center">
                            <span className="text-[10px] font-bold uppercase text-cream-dim">
                              {item.kind === "ticket" ? "Ticket" : "Invoice"}
                            </span>
                            <span className="font-mono text-xs text-brass-light truncate">{item.id}</span>
                            {item.unpaid && (
                              <span className="text-[10px] text-signal-amber font-bold">UNPAID</span>
                            )}
                          </div>
                          <div className="text-xs text-cream-dim truncate">{item.customerName}</div>
                        </button>
                        <span className="text-sm tabular-nums text-brass-light shrink-0">
                          {money(item.unpaid ? item.outstanding || item.total : item.total)}
                        </span>
                        <button
                          type="button"
                          aria-label="Remove from bag"
                          onClick={() => toggleKey(item.key)}
                          className="w-11 h-11 shrink-0 rounded-lg text-cream-dim hover:text-signal-rose text-lg"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Confirm collector */}
                <div className="card-glass p-4 space-y-3">
                  <button
                    type="button"
                    onClick={() => setConfirmWho((v) => !v)}
                    className="w-full flex items-center gap-3 text-left min-h-11"
                  >
                    <span className="text-2xl opacity-80">👤</span>
                    <span className="flex-1">
                      <span className="block font-semibold">Confirm who’s collecting</span>
                      <span className="text-xs text-cream-dim">
                        Client or authorised person — ask before releasing.
                      </span>
                    </span>
                    <span
                      className={cn(
                        "w-8 h-8 rounded-full border-2 grid place-items-center",
                        confirmWho
                          ? "bg-signal-emerald border-signal-emerald text-forest-deep"
                          : "border-brass/40",
                      )}
                    >
                      {confirmWho ? "✓" : ""}
                    </span>
                  </button>
                  <input
                    value={collector}
                    onChange={(e) => setCollector(e.target.value)}
                    placeholder="Name on the bag / collector"
                    className="w-full h-11 rounded-xl bg-black/35 border border-brass/25 px-3 text-sm text-cream outline-none focus:border-brass"
                  />
                </div>

                {/* Focused ticket garments */}
                {focusItem?.kind === "ticket" && (
                  <div>
                    {detail.isError && (
                      <QueryErrorPanel
                        className="mb-4"
                        title="Could not load ticket"
                        onRetry={() => detail.refetch()}
                      />
                    )}
                    {t && (
                      <>
                        <div className="caps mb-2">
                          {t.name} · {t.garments?.length ?? 0} garments
                          {t.billing_status && t.billing_status !== "Billable" && (
                            <span className="ml-2 normal-case tracking-normal text-[var(--vi,#9B8BC4)]">
                              {billingStatusLabel(t.billing_status)}
                            </span>
                          )}
                        </div>
                        <div className="space-y-3">
                          {(t.garments ?? []).map((g, i) => (
                            <div key={g.name || i} className="card-glass p-4">
                              <div className="flex items-center gap-2">
                                <span className="chip">{g.garment_id || `G${i + 1}`}</span>
                                <span className="font-semibold">
                                  {g.garment_type}
                                  {g.color ? ` · ${g.color}` : ""}
                                </span>
                                <span className="ml-auto text-brass-light">
                                  {money(Number(g.garment_total) || 0)}
                                </span>
                              </div>
                            </div>
                          ))}
                          {!t.garments?.length && (
                            <p className="text-cream-dim text-sm">Open full ticket for garment lines.</p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => nav(`/orders/alterations/${encodeURIComponent(focusItem.id)}`)}
                          className="mt-4 text-[12px] font-bold tracking-widest uppercase text-brass-light min-h-11"
                        >
                          Open full ticket →
                        </button>
                      </>
                    )}
                    {detail.isLoading && <div className="text-cream-dim">Loading ticket…</div>}
                  </div>
                )}

                {focusItem?.kind === "invoice" && (
                  <div className="card-glass p-4 space-y-3">
                    <div className="caps">Focused invoice</div>
                    <div className="font-mono text-brass-light">{focusItem.id}</div>
                    <div className="text-sm text-cream-dim">
                      {focusItem.invoiceKind === "custom"
                        ? "Custom / MTM invoice"
                        : focusItem.invoiceKind === "alteration"
                          ? "Alteration invoice"
                          : "Sales invoice"}
                      {focusItem.ticketRef ? ` · ${focusItem.ticketRef}` : ""}
                      {focusItem.salesOrder ? ` · ${focusItem.salesOrder}` : ""}
                    </div>
                    <div className="display text-3xl text-brass-light">
                      {money(focusItem.outstanding)} due
                    </div>
                    <button
                      type="button"
                      onClick={() => nav(`/invoices/${encodeURIComponent(focusItem.id)}`)}
                      className="btn-ghost w-full h-12 text-[12px]"
                    >
                      Open invoice detail →
                    </button>
                  </div>
                )}
              </div>

              <aside className="card-glass p-5 h-fit sticky top-4 space-y-4">
                <div>
                  <div className="caps">Bag total</div>
                  <div className="display text-4xl text-brass-light my-2">{money(bagTotal)}</div>
                  {bagOutstanding > 0 ? (
                    <div className="text-sm text-signal-amber font-semibold mb-1">
                      Collect {money(bagOutstanding)}
                    </div>
                  ) : (
                    <div className="text-xs text-signal-emerald mb-1">Nothing due on selection</div>
                  )}
                  <p className="text-[12px] text-cream-dim">
                    Charge focuses the highlighted unpaid row
                    {chargeTarget ? ` · ${chargeTarget.id}` : ""}.
                  </p>
                </div>

                {chargeTarget && chargeAmount > 0 && (
                  <div className="space-y-2">
                    <div className="caps text-signal-amber">
                      Charge · {chargeTarget.id}
                    </div>
                    <ChargeCardOnFileButton
                      fullWidth
                      ticketId={
                        chargeTarget.kind === "ticket"
                          ? chargeTarget.id
                          : chargeTicketId || undefined
                      }
                      invoiceId={
                        chargeTarget.kind === "invoice"
                          ? chargeTarget.id
                          : chargeInvoiceId || undefined
                      }
                      amountDollars={chargeAmount}
                      amountDisplay={money(chargeAmount)}
                      customerLabel={chargeTarget.customerName}
                      onSuccess={() => {
                        toast.success("Card on file charged — refreshing…");
                        refreshAll();
                      }}
                      onRefresh={refreshAll}
                      onError={(msg) => toast.error(msg)}
                    />
                    <ChargeTerminalButton
                      invoiceId={
                        chargeTarget.kind === "invoice"
                          ? chargeTarget.id
                          : chargeInvoiceId || chargeTarget.id
                      }
                      ticketId={
                        chargeTarget.kind === "ticket" ? chargeTarget.id : undefined
                      }
                      amountCents={Math.round(chargeAmount * 100)}
                      amountDisplay={money(chargeAmount)}
                      onSuccess={() => {
                        toast.success("Payment captured — refreshing…");
                        refreshAll();
                      }}
                      onError={(msg) => toast.error(msg)}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        payLink.mutate(
                          chargeTarget.kind === "invoice"
                            ? chargeTarget.id
                            : chargeInvoiceId || chargeTarget.id,
                        )
                      }
                      className="btn-brass w-full h-12 text-[12px]"
                    >
                      {payLink.isPending ? "…" : "Create pay link"}
                    </button>
                    {bagUnpaid.length > 1 && (
                      <p className="text-[11px] text-cream-dim leading-snug">
                        {bagUnpaid.length} unpaid in bag — charge one at a time (tap row to focus),
                        then release tickets.
                      </p>
                    )}
                  </div>
                )}

                {focusItem?.kind === "ticket" && t && (
                  <div className="rounded-2xl border border-[rgba(155,139,196,0.35)] bg-[rgba(155,139,196,0.08)] p-3 space-y-2">
                    <div className="caps text-[#C4B5E0]">Exit path · focused ticket</div>
                    <div className="text-xs text-cream-dim">
                      Method:{" "}
                      <span className="text-cream font-semibold">
                        {methodLabel(t.delivery_method)}
                      </span>
                    </div>
                    {boardRow ? (
                      <div className="text-xs space-y-1">
                        <div>
                          On board ·{" "}
                          <span className="font-mono text-brass-light">{boardRow.id}</span>
                        </div>
                        <a
                          href={`https://app.lstailors.com/deliveries/${boardRow.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex text-[12px] font-bold tracking-widest uppercase text-[#C4B5E0] pt-1"
                        >
                          Open on dispatch board ↗
                        </a>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          nav(`/dispatch?ticket=${encodeURIComponent(focusItem.id)}`)
                        }
                        className="w-full h-12 rounded-xl border border-[rgba(155,139,196,0.5)] bg-[rgba(155,139,196,0.18)] text-[12px] font-bold tracking-widest uppercase text-[#EDE6FF]"
                      >
                        Queue hand delivery / ship
                      </button>
                    )}
                    {t.payment_status !== "Paid" && t.payment_status !== "N/A" && (
                      <button
                        type="button"
                        onClick={() => smsUnpaid.mutate(focusItem.id)}
                        className="btn-ghost w-full h-11 text-[12px] text-signal-amber border-signal-amber/30"
                      >
                        SMS unpaid balance
                      </button>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  disabled={
                    release.isPending ||
                    !confirmWho ||
                    !bagTickets.length ||
                    (bagTickets.length === 1 &&
                      focusItem?.kind === "ticket" &&
                      focusItem.id === bagTickets[0].id &&
                      !!boardRow)
                  }
                  onClick={() => {
                    if (bagOutstanding > 0) {
                      const ok = window.confirm(
                        `Release ${bagTickets.length} ticket${bagTickets.length === 1 ? "" : "s"}` +
                          (bagOutstanding > 0
                            ? ` with ${money(bagOutstanding)} still due on the bag?`
                            : "?") +
                          "\n\nUnpaid SMS may send per ticket. Invoices stay open until paid.",
                      );
                      if (!ok) return;
                    }
                    release.mutate();
                  }}
                  className={cn(
                    "w-full h-14 rounded-2xl font-bold tracking-widest uppercase text-sm",
                    bagOutstanding > 0
                      ? "bg-signal-amber/90 text-forest-deep"
                      : "bg-signal-emerald text-forest-deep",
                    "disabled:opacity-40",
                  )}
                >
                  {release.isPending
                    ? "…"
                    : !bagTickets.length
                      ? bagInvoices.length
                        ? "Charge invoices · no ticket release"
                        : "Nothing to release"
                      : bagOutstanding > 0
                        ? `Release ${bagTickets.length} unpaid · counter`
                        : `Release ${bagTickets.length} · counter pickup`}
                </button>
                <p className="text-[12px] text-cream-dim text-center leading-snug">
                  Release marks Ready <strong className="text-cream font-semibold">tickets</strong>{" "}
                  Picked Up. Open invoices are charged here or on the invoice page — not auto-closed.
                </p>
              </aside>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
