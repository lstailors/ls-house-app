import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QueryErrorPanel from "@alts/components/QueryErrorPanel";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { cn } from "@ls/design/utils";
import { billingStatusLabel } from "@alts/lib/billingLabels";
import { ChargeCardOnFileButton } from "@alts/components/payments/ChargeCardOnFileButton";
import { ChargeTerminalButton } from "@alts/components/payments/ChargeTerminalButton";
import { parsePickupScanTarget } from "@alts/lib/scanRoutes";
import {
  addPickupBagKey,
  clearPickupBag,
  invoiceBagKey,
  readPickupBagKeys,
  shouldRestorePickupBag,
  ticketBagKey,
  writePickupBagKeys,
} from "@alts/lib/pickupBag";
import { formatMoney } from "@alts/lib/money";
import { ConfirmDialog } from "@alts/components/ConfirmDialog";
import { ListSkeleton } from "@alts/components/skeletons";
import { AltsSearchField } from "@alts/components/AltsSearchField";
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
  return formatMoney(n);
}

function ticketKey(name: string) {
  return ticketBagKey(name);
}
function invoiceKey(id: string) {
  return invoiceBagKey(id);
}

function customerMatchKey(item: QueueItem) {
  return (item.customerId || item.customerName || "").trim().toLowerCase();
}

function ticketToQueueItem(t: Ticket): QueueItem {
  const total = Number(t.ticket_total) || 0;
  const unpaid =
    t.payment_status !== "Paid" &&
    t.payment_status !== "N/A" &&
    total > 0 &&
    t.billing_status !== "Warranty" &&
    t.billing_status !== "Included in Custom Order";
  return {
    key: ticketKey(t.name),
    kind: "ticket",
    id: t.name,
    customerId: t.customer,
    customerName: t.customer_name || "—",
    phone: t.customer_mobile || t.customer_phone || "",
    total,
    outstanding: unpaid ? total : 0,
    paymentLabel: t.payment_status || t.workflow_state || "—",
    unpaid,
    billingStatus: t.billing_status,
    salesInvoice: t.sales_invoice,
    garmentCount: t.garments?.length,
  };
}

function invoiceToQueueItem(inv: InvoiceRow): QueueItem {
  const outstanding = Number(inv.outstandingAmount) || 0;
  return {
    key: invoiceKey(inv.id),
    kind: "invoice",
    id: inv.id,
    customerId: inv.customer?.id,
    customerName: inv.customerName || inv.customer?.name || "—",
    phone: "",
    total: Number(inv.grandTotal) || outstanding,
    outstanding: Math.max(0, outstanding),
    paymentLabel: inv.status || "open",
    unpaid: outstanding > 0.005,
    invoiceKind: inv.kind,
    ticketRef: inv.alterationTicketRef,
    salesOrder: inv.salesOrder,
  };
}

export default function PickupCounter() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const preTicket = params.get("ticket") || params.get("addTicket");
  const preInvoice = params.get("invoice") || params.get("addInvoice");
  const scanRef = useRef<HTMLInputElement>(null);
  const [scanBuf, setScanBuf] = useState("");
  const [scanBusy, setScanBusy] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(() => {
    const s = new Set<string>();
    if (shouldRestorePickupBag(params)) {
      for (const k of readPickupBagKeys()) s.add(k);
    } else {
      clearPickupBag();
    }
    if (preTicket) s.add(ticketKey(preTicket));
    if (preInvoice) s.add(invoiceKey(preInvoice));
    return s;
  });
  const [multiClientOk, setMultiClientOk] = useState(false);
  const [pendingAdd, setPendingAdd] = useState<QueueItem | null>(null);
  const [chargeIntent, setChargeIntent] = useState<"card" | "terminal" | "link" | null>(null);
  const [chargeArmed, setChargeArmed] = useState<"card" | "terminal" | "link" | null>(null);
  const [receipt, setReceipt] = useState<{
    client: string;
    invoices: string[];
    amount: number;
    method: string;
  } | null>(null);
  /** Last tapped row — drives detail / charge focus */
  const [focusKey, setFocusKey] = useState<string | null>(
    preTicket ? ticketKey(preTicket) : preInvoice ? invoiceKey(preInvoice) : null,
  );
  /** Tickets/invoices added by scan that aren't on the Ready/open list yet */
  const [extras, setExtras] = useState<QueueItem[]>([]);
  const [confirmWho, setConfirmWho] = useState(true);
  const [collector, setCollector] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "tickets" | "invoices" | "paid" | "unpaid">("all");

  // Persist bag for camera scanner round-trip
  useEffect(() => {
    writePickupBagKeys(Array.from(selected));
  }, [selected]);

  // Keep scan field focused for gun / HID wedge (when not typing in other inputs)
  useEffect(() => {
    const id = window.setTimeout(() => scanRef.current?.focus(), 80);
    return () => window.clearTimeout(id);
  }, [selected.size, focusKey]);

  useEffect(() => {
    if (preTicket) {
      setSelected((prev) => new Set(prev).add(ticketKey(preTicket)));
      setFocusKey(ticketKey(preTicket));
      addPickupBagKey(ticketKey(preTicket));
    }
  }, [preTicket]);
  useEffect(() => {
    if (preInvoice) {
      setSelected((prev) => new Set(prev).add(invoiceKey(preInvoice)));
      setFocusKey(invoiceKey(preInvoice));
      addPickupBagKey(invoiceKey(preInvoice));
    }
  }, [preInvoice]);

  // Strip one-shot add* query params after consume so refresh doesn't re-toast
  useEffect(() => {
    if (!params.get("addTicket") && !params.get("addInvoice") && !params.get("scanned")) return;
    const next = new URLSearchParams(params);
    next.delete("addTicket");
    next.delete("addInvoice");
    next.delete("scanned");
    setParams(next, { replace: true });
  }, [params, setParams]);

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
      items.push(ticketToQueueItem(t));
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

      items.push(invoiceToQueueItem(inv));
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

  // When bag has keys not in Ready/open lists (camera scan), hydrate via API
  useEffect(() => {
    const keys = Array.from(selected);
    if (!keys.length) return;
    let cancelled = false;
    void (async () => {
      for (const key of keys) {
        if (cancelled) return;
        if (queue.some((q) => q.key === key)) continue;
        // skip if already hydrating into extras — check inside setState race via key
        if (key.startsWith("t:")) {
          const id = key.slice(2);
          try {
            const t = await api.get<Ticket>(
              `/api/intake-alterations/tickets/${encodeURIComponent(id)}`,
            );
            if (cancelled) return;
            const item = ticketToQueueItem(t);
            setExtras((prev) => (prev.some((p) => p.key === item.key) ? prev : [...prev, item]));
          } catch {
            /* leave orphan key; staff can clear bag */
          }
        } else if (key.startsWith("i:")) {
          const id = key.slice(2);
          try {
            const res = await api.raw(`/api/invoices/${encodeURIComponent(id)}`);
            const json = await res.json().catch(() => ({}));
            if (!res.ok || cancelled) continue;
            const inv = (json?.data ?? json) as any;
            const row: InvoiceRow = {
              id: inv.id || inv.name || id,
              customer: inv.customer ?? null,
              customerName: inv.customerName || inv.customer_name || inv.customer?.name || "—",
              status: inv.status || "open",
              kind: inv.kind,
              grandTotal: Number(inv.grandTotal ?? inv.grand_total ?? 0),
              outstandingAmount: Number(inv.outstandingAmount ?? inv.outstanding_amount ?? 0),
              alterationTicketRef: inv.alterationTicketRef ?? inv.alteration_ticket_ref,
              salesOrder: inv.salesOrder,
            };
            const item = invoiceToQueueItem(row);
            setExtras((prev) => (prev.some((p) => p.key === item.key) ? prev : [...prev, item]));
          } catch {
            /* ignore */
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selected, queue]);

  const catalog = useMemo(() => {
    const map = new Map<string, QueueItem>();
    for (const r of queue) map.set(r.key, r);
    for (const e of extras) {
      if (!map.has(e.key)) map.set(e.key, e);
    }
    return map;
  }, [queue, extras]);

  const list = useMemo(() => {
    let rows = queue;
    // Always surface bag extras even if not Ready/open — staff scanned them
    const extraOnly = extras.filter((e) => !queue.some((q) => q.key === e.key));
    if (extraOnly.length) {
      rows = [...extraOnly, ...rows];
    }
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
  }, [queue, extras, q, filter]);

  const selectedItems = useMemo(() => {
    const out: QueueItem[] = [];
    for (const key of selected) {
      const item = catalog.get(key);
      if (item) out.push(item);
    }
    return out;
  }, [catalog, selected]);

  const addFromScan = useCallback(
    async (raw: string) => {
      const target = parsePickupScanTarget(raw);
      if (!target) {
        toast.error("Could not read tag — scan garment QR, ticket, or invoice");
        return;
      }

      setScanBusy(true);
      try {
        if (target.kind === "ticket") {
          const key = ticketKey(target.id);
          let item = catalog.get(key);
          if (!item) {
            try {
              const t = await api.get<Ticket>(
                `/api/intake-alterations/tickets/${encodeURIComponent(target.id)}`,
              );
              item = ticketToQueueItem(t);
              setExtras((prev) => (prev.some((p) => p.key === key) ? prev : [...prev, item!]));
              if (t.workflow_state && t.workflow_state !== "Ready") {
                toast.message(`${t.name} is ${t.workflow_state} — still added to bag`);
              }
            } catch {
              toast.error(`Ticket ${target.id} not found`);
              return;
            }
          }
          const { added } = addPickupBagKey(key);
          setSelected((prev) => new Set(prev).add(key));
          setFocusKey(key);
          setConfirmWho(true);
          if (!collector.trim()) setCollector(item.customerName || "");
          toast.success(added ? `Added ${item.id}` : `Already in bag · ${item.id}`, {
            description: item.customerName,
          });
          return;
        }

        // invoice
        const key = invoiceKey(target.id);
        let item = catalog.get(key);
        if (!item) {
          try {
            const res = await api.raw(`/api/invoices/${encodeURIComponent(target.id)}`);
            const json = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(json?.error?.message || "Invoice not found");
            const inv = (json?.data ?? json) as InvoiceRow & {
              id?: string;
              name?: string;
              customer_name?: string;
              grand_total?: number;
              outstanding_amount?: number;
              alteration_ticket_ref?: string;
            };
            const row: InvoiceRow = {
              id: inv.id || inv.name || target.id,
              customer: inv.customer ?? null,
              customerName: inv.customerName || inv.customer_name || inv.customer?.name || "—",
              status: inv.status || "open",
              kind: inv.kind,
              grandTotal: Number(inv.grandTotal ?? inv.grand_total ?? 0),
              outstandingAmount: Number(inv.outstandingAmount ?? inv.outstanding_amount ?? 0),
              alterationTicketRef: inv.alterationTicketRef ?? inv.alteration_ticket_ref,
              salesOrder: inv.salesOrder,
            };
            // Prefer linked Ready ticket if present
            const altRef = (row.alterationTicketRef || "").trim();
            if (altRef) {
              const tKey = ticketKey(altRef);
              let tItem = catalog.get(tKey);
              if (!tItem) {
                const t = await api.get<Ticket>(
                  `/api/intake-alterations/tickets/${encodeURIComponent(altRef)}`,
                );
                tItem = ticketToQueueItem(t);
                setExtras((prev) =>
                  prev.some((p) => p.key === tKey) ? prev : [...prev, tItem!],
                );
              }
              const { added } = addPickupBagKey(tKey);
              setSelected((prev) => new Set(prev).add(tKey));
              setFocusKey(tKey);
              setConfirmWho(true);
              if (!collector.trim()) setCollector(tItem.customerName || "");
              toast.success(
                added ? `Added ticket ${tItem.id} (from invoice)` : `Already in bag · ${tItem.id}`,
                { description: tItem.customerName },
              );
              return;
            }
            item = invoiceToQueueItem(row);
            setExtras((prev) => (prev.some((p) => p.key === item!.key) ? prev : [...prev, item!]));
          } catch (e: any) {
            toast.error(e?.message || `Invoice ${target.id} not found`);
            return;
          }
        }
        const { added } = addPickupBagKey(key);
        setSelected((prev) => new Set(prev).add(key));
        setFocusKey(key);
        setConfirmWho(true);
        if (!collector.trim()) setCollector(item.customerName || "");
        toast.success(added ? `Added invoice ${item.id}` : `Already in bag · ${item.id}`, {
          description: item.customerName,
        });
      } finally {
        setScanBusy(false);
        setScanBuf("");
        window.setTimeout(() => scanRef.current?.focus(), 30);
      }
    },
    [catalog, collector],
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

  function addToBag(row: QueueItem) {
    setSelected((prev) => new Set(prev).add(row.key));
    setFocusKey(row.key);
    setConfirmWho(true);
    if (!collector.trim()) setCollector(row.customerName || "");
  }

  function toggleKey(key: string, row?: QueueItem) {
    if (selected.has(key)) {
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    const incoming = row || catalog.get(key);
    if (incoming) {
      const existingClients = new Set(
        selectedItems.map((i) => customerMatchKey(i)).filter(Boolean),
      );
      const nextClient = customerMatchKey(incoming);
      if (existingClients.size > 0 && nextClient && !existingClients.has(nextClient) && !multiClientOk) {
        setPendingAdd(incoming);
        return;
      }
      addToBag(incoming);
      return;
    }
    setSelected((prev) => new Set(prev).add(key));
    setFocusKey(key);
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
    setExtras([]);
    clearPickupBag();
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

  const textReceipt = useMutation({
    mutationFn: (invoiceId: string) =>
      api.post<{ sent: boolean; phone: string | null }>(
        `/api/invoices/${encodeURIComponent(invoiceId)}/text-receipt`,
        {},
      ),
    onSuccess: (d) => toast.success(d?.sent ? `Receipt texted${d.phone ? ` · ${d.phone}` : ""}` : "Queued"),
    onError: (e: Error) => toast.error(e.message || "Could not text receipt"),
  });

  const chargeInvoiceIds = bagInvoices.map((i) => i.id);
  if (chargeTarget?.kind === "invoice" && !chargeInvoiceIds.includes(chargeTarget.id)) {
    chargeInvoiceIds.push(chargeTarget.id);
  }

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
            Scan to bag · Ready alts · invoices · multi
          </div>
        </div>
        <div className="flex-1" />
        <form
          className="flex items-center gap-2 rounded-full border border-brass/40 bg-brass/10 px-3 h-11 min-w-[180px] flex-1 sm:flex-none sm:min-w-[260px]"
          onSubmit={(e) => {
            e.preventDefault();
            const v = scanBuf.trim();
            if (!v || scanBusy) return;
            void addFromScan(v);
          }}
        >
          <span className="text-brass shrink-0" aria-hidden>
            ⌗
          </span>
          <input
            ref={scanRef}
            value={scanBuf}
            onChange={(e) => setScanBuf(e.target.value)}
            placeholder={scanBusy ? "Adding…" : "Scan tag / gun / paste ALT…"}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={scanBusy}
            className="bg-transparent outline-none text-sm flex-1 text-cream placeholder:text-cream-dim min-w-0"
            aria-label="Scan to add to pickup bag"
          />
        </form>
        <AltsSearchField
          value={q}
          onChange={setQ}
          scope="this bag"
          className="hidden md:block w-[220px]"
        />
        <Link
          to="/invoices"
          className="hidden sm:inline-flex items-center gap-2 h-11 px-4 rounded-full border border-brass/30 text-sm font-semibold text-brass-light hover:border-brass/50"
        >
          All invoices
        </Link>
        <Link
          to="/scanner?mode=pickup"
          className="flex items-center gap-2 h-11 px-4 rounded-full border border-brass/50 bg-brass/20 text-sm font-semibold text-brass hover:bg-brass/30"
        >
          ⌗ Camera
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
            Scan garment/ticket QR into the bag, or tap checkboxes. Same client can hold several.
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
          {(ready.isLoading || openInvoices.isLoading) && <ListSkeleton rows={5} />}
        </aside>

        <main className="overflow-y-auto p-5">
          {!selected.size && (
            <div className="h-full grid place-items-center text-cream-dim min-h-[40vh]">
              <div className="text-center max-w-md px-4">
                <div className="display text-3xl mb-2">Scan or select</div>
                <p className="text-sm">
                  Point the gun at a hang tag / thermal ticket, use Camera, or multi-select from the
                  queue. Bag holds Ready alts + open invoices together.
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
                        {new Set(selectedItems.map((i) => customerMatchKey(i)).filter(Boolean)).size > 1
                          ? " · multi-client bag"
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
                  {(() => {
                    const groups = new Map<string, { name: string; due: number }>();
                    for (const item of selectedItems) {
                      const k = customerMatchKey(item) || item.customerName;
                      const cur = groups.get(k) || { name: item.customerName, due: 0 };
                      cur.due += item.unpaid ? item.outstanding || item.total : 0;
                      groups.set(k, cur);
                    }
                    if (groups.size < 2) return null;
                    return (
                      <div className="rounded-xl border border-brass/20 bg-black/20 px-3 py-2 space-y-1">
                        <div className="caps">Per-client due</div>
                        {[...groups.values()].map((g) => (
                          <div key={g.name} className="flex justify-between text-sm">
                            <span className="truncate">{g.name}</span>
                            <span className="tabular-nums text-brass-light">{money(g.due)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
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

                {receipt && (
                  <div className="rounded-2xl border border-signal-emerald/40 bg-signal-emerald/10 p-4 space-y-3">
                    <div className="caps text-signal-emerald">Receipt</div>
                    <div className="display text-2xl">{receipt.client}</div>
                    <div className="text-sm text-cream-dim">
                      {receipt.invoices.length ? receipt.invoices.join(" · ") : "Counter charge"}
                    </div>
                    <div className="display text-3xl text-brass-light">{money(receipt.amount)}</div>
                    <div className="text-xs uppercase tracking-widest text-cream-dim">{receipt.method}</div>
                    <button
                      type="button"
                      disabled={textReceipt.isPending || !receipt.invoices[0]}
                      onClick={() => receipt.invoices[0] && textReceipt.mutate(receipt.invoices[0])}
                      className="btn-brass w-full h-12 text-[12px]"
                    >
                      {textReceipt.isPending ? "Sending…" : "Text receipt"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReceipt(null)}
                      className="btn-ghost w-full h-11 text-[12px]"
                    >
                      New charge
                    </button>
                  </div>
                )}

                {chargeTarget && chargeAmount > 0 && !receipt && (
                  <div className="space-y-2">
                    <div className="caps text-signal-amber">
                      Charge · {chargeTarget.id}
                    </div>
                    {!chargeArmed && (
                      <>
                        <button
                          type="button"
                          onClick={() => setChargeIntent("card")}
                          className="btn-brass w-full h-12 text-[12px]"
                        >
                          Charge card on file · {money(chargeAmount)}
                        </button>
                        <button
                          type="button"
                          onClick={() => setChargeIntent("terminal")}
                          className="w-full h-12 rounded-xl border border-brass/40 text-[12px] font-bold uppercase tracking-widest"
                        >
                          Charge terminal · {money(chargeAmount)}
                        </button>
                        <button
                          type="button"
                          onClick={() => setChargeIntent("link")}
                          className="btn-ghost w-full h-12 text-[12px]"
                        >
                          Create pay link
                        </button>
                      </>
                    )}
                    {chargeArmed === "card" && (
                    <ChargeCardOnFileButton
                      fullWidth
                      autoStart
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
                        setReceipt({
                          client: chargeTarget.customerName,
                          invoices: bagInvoices.map((i) => i.id).concat(
                            chargeTarget.kind === "invoice" ? [chargeTarget.id] : [],
                          ).filter((v, i, a) => a.indexOf(v) === i),
                          amount: chargeAmount,
                          method: "Card on file",
                        });
                        setChargeArmed(null);
                        refreshAll();
                      }}
                      onRefresh={refreshAll}
                      onError={(msg) => toast.error(msg)}
                    />
                    )}
                    {chargeArmed === "terminal" && (
                    <ChargeTerminalButton
                      autoStart
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
                        setReceipt({
                          client: chargeTarget.customerName,
                          invoices: bagInvoices.map((i) => i.id),
                          amount: chargeAmount,
                          method: "Terminal",
                        });
                        setChargeArmed(null);
                        refreshAll();
                      }}
                      onError={(msg) => toast.error(msg)}
                    />
                    )}
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

      <ConfirmDialog
        open={!!pendingAdd}
        onClose={() => setPendingAdd(null)}
        title="Multi-client bag?"
        tone="amber"
        confirmLabel="Make multi-client"
        body={
          <p>
            This bag is for one client. Add{" "}
            <strong className="text-cream">{pendingAdd?.customerName}</strong> as a second client?
            Per-client subtotals will show.
          </p>
        }
        onConfirm={() => {
          if (!pendingAdd) return;
          setMultiClientOk(true);
          addToBag(pendingAdd);
          setPendingAdd(null);
        }}
      />

      <ConfirmDialog
        open={!!chargeIntent}
        onClose={() => setChargeIntent(null)}
        title="Confirm charge"
        tone="brass"
        confirmLabel={
          chargeIntent === "card"
            ? "Charge card"
            : chargeIntent === "terminal"
              ? "Send to terminal"
              : "Create link"
        }
        body={
          <div className="space-y-1.5">
            <p>
              <span className="text-cream-dim">Client · </span>
              {chargeTarget?.customerName || selectedItems[0]?.customerName || "—"}
            </p>
            <p>
              <span className="text-cream-dim">Invoices · </span>
              {chargeInvoiceIds.length ? chargeInvoiceIds.join(", ") : chargeTarget?.id || "—"}
            </p>
            <p>
              <span className="text-cream-dim">Amount · </span>
              {money(chargeAmount)}
            </p>
            <p>
              <span className="text-cream-dim">Method · </span>
              {chargeIntent === "card"
                ? "Card on file"
                : chargeIntent === "terminal"
                  ? "Square Terminal"
                  : "Pay link"}
            </p>
          </div>
        }
        onConfirm={() => {
          const method = chargeIntent;
          setChargeIntent(null);
          if (method === "link" && chargeTarget) {
            payLink.mutate(
              chargeTarget.kind === "invoice"
                ? chargeTarget.id
                : chargeInvoiceId || chargeTarget.id,
            );
            return;
          }
          setChargeArmed(method);
        }}
      />
    </div>
  );
}
