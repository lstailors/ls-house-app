import { useEffect } from "react";
import {
  ExternalLink, Copy, Flame, Truck, Check, ChevronUp, ChevronDown, Ruler,
} from "lucide-react";
import { toast } from "sonner";
import type { YZOrder } from "@ls/types";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@ls/design/ui/sheet";
import { Button } from "@ls/design/ui/button";
import { StatusBadge } from "./StatusBadge";
import { GarmentBreakdown } from "./GarmentIcons";
import {
  formatFullDate, shipTone, shipToneClass, isRush, trackingLink,
} from "@/lib/shopFloor";
import { cn } from "@ls/design/utils";

const ERP_MTMPRO_BASE = "https://erp.lstailors.com/app/mtmpro-order";

interface Props {
  orders: YZOrder[];        // current filtered + sorted list, for prev/next nav
  order: YZOrder | null;    // currently selected order
  onClose: () => void;
  onNavigate: (order: YZOrder) => void;
}

// ── Small building blocks ────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-brass/10 pt-4">
      <div className="ui-label text-xs mb-2.5">{title}</div>
      {children}
    </div>
  );
}

function Field({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-cream-dim">{label}</span>
      <span className={cn("text-base font-medium text-cream text-right", tone)}>{value}</span>
    </div>
  );
}

function CheckFlag({ label, on }: { label: string; on: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm",
        on
          ? "border-brass/30 bg-brass/10 text-brass-light"
          : "border-brass/10 bg-forest-deep/40 text-cream-dim",
      )}
    >
      <span
        className={cn(
          "flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border",
          on ? "border-brass/50 bg-brass/20" : "border-cream-dim/30",
        )}
      >
        {on ? <Check className="h-2.5 w-2.5" /> : null}
      </span>
      {label}
    </div>
  );
}

// ── Drawer ───────────────────────────────────────────────────────────────────

export function OrderDrawer({ orders, order, onClose, onNavigate }: Props) {
  const index = order ? orders.findIndex((o) => o.name === order.name) : -1;
  const prev = index > 0 ? orders[index - 1] : null;
  const next = index >= 0 && index < orders.length - 1 ? orders[index + 1] : null;

  // Arrow keys navigate between orders while the drawer is open.
  useEffect(() => {
    if (!order) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
      if ((e.key === "ArrowDown" || e.key === "ArrowRight") && next) {
        e.preventDefault();
        onNavigate(next);
      } else if ((e.key === "ArrowUp" || e.key === "ArrowLeft") && prev) {
        e.preventDefault();
        onNavigate(prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [order, prev, next, onNavigate]);

  const copyOrderNo = async () => {
    if (!order) return;
    try {
      await navigator.clipboard.writeText(order.order_no);
      toast.success("Order number copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const track = order ? trackingLink(order.tracking_no) : null;
  const tone = order ? shipTone(order) : "none";
  const rush = order ? isRush(order) : false;

  return (
    <Sheet open={!!order} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full border-l border-brass/20 bg-forest-raised/97 p-0 backdrop-blur-xl sm:max-w-[400px]"
      >
        {order ? (
          <div className="flex h-full flex-col">
            {/* Header */}
            <SheetHeader className="space-y-0 border-b border-brass/12 px-5 pb-4 pt-5 text-left">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-brass-light">{order.order_no}</span>
                <div className="flex items-center gap-1.5 pr-8">
                  {prev ? (
                    <button
                      onClick={() => onNavigate(prev)}
                      className="rounded-md border border-brass/20 p-1 text-cream-dim transition-colors hover:text-cream"
                      aria-label="Previous order"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {next ? (
                    <button
                      onClick={() => onNavigate(next)}
                      className="rounded-md border border-brass/20 p-1 text-cream-dim transition-colors hover:text-cream"
                      aria-label="Next order"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                </div>
              </div>
              <SheetTitle asChild>
                <div className="pt-1 font-display text-4xl italic text-cream">
                  {order.customer_name ?? "Unnamed customer"}
                </div>
              </SheetTitle>
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <StatusBadge status={order.production_status} />
                {rush ? (
                  <span className="flex items-center gap-1 rounded-full bg-[#FF5722]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#FF8A65]">
                    <Flame className="h-3 w-3" />
                    Rush{order.rush_days > 0 ? ` · ${order.rush_days}d` : ""}
                  </span>
                ) : null}
              </div>
              {order.mtmpro_order ? (
                <a
                  href={`${ERP_MTMPRO_BASE}/${encodeURIComponent(order.mtmpro_order)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-sm text-cream-muted transition-colors hover:text-brass-light"
                >
                  MTMPro {order.mtmpro_order}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
            </SheetHeader>

            {/* Body */}
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {/* Garments */}
              <div>
                <div className="ui-label text-xs mb-2.5">Garments</div>
                <GarmentBreakdown order={order} />
                <div className="mt-3 space-y-0.5">
                  <Field label="Total Pieces" value={order.total_pieces || "—"} />
                  <Field label="Process" value={order.process_category ?? "—"} />
                  {order.garment_summary ? (
                    <Field label="Summary" value={order.garment_summary} />
                  ) : null}
                </div>
              </div>

              {/* Fabric & Construction */}
              <Section title="Fabric & Construction">
                <Field label="Fabric Number" value={order.fabric_number ?? "—"} />
                <div className="mt-2 flex flex-wrap gap-2">
                  <CheckFlag label="Solid" on={order.solid_fabric} />
                  <CheckFlag label="Fully Lined" on={order.fully_lined} />
                  <CheckFlag label="Half Canvas" on={order.half_canvas} />
                </div>
                {order.basted_note ? (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-brass/12 bg-forest-deep/40 p-2.5">
                    <Ruler className="mt-0.5 h-4 w-4 shrink-0 text-brass-light/70" />
                    <p className="text-sm leading-relaxed text-cream-muted">{order.basted_note}</p>
                  </div>
                ) : null}
              </Section>

              {/* Dates */}
              <Section title="Dates">
                <Field label="Order Received" value={formatFullDate(order.date_received)} />
                <Field label="Order Placed" value={formatFullDate(order.date_placed)} />
                <Field
                  label="Planned Ship Date"
                  value={formatFullDate(order.ship_date_planned, "Not set")}
                  tone={shipToneClass(tone)}
                />
                {order.rush_days > 0 ? (
                  <Field label="Rush Days" value={`${order.rush_days} days`} tone="text-signal-amber" />
                ) : null}
              </Section>

              {/* Embroidery */}
              {order.embroidery_name ? (
                <Section title="Embroidery">
                  <Field label="Name" value={order.embroidery_name} />
                  {order.embroidery_qty > 0 ? (
                    <Field label="Pieces" value={order.embroidery_qty} />
                  ) : null}
                </Section>
              ) : null}

              {/* Delivery */}
              <Section title="Delivery">
                <Field label="Delivery Manner" value={order.delivery_manner ?? "—"} />
                <div className="flex items-baseline justify-between gap-3 py-1.5">
                  <span className="text-sm text-cream-dim">Tracking</span>
                  {track ? (
                    <a
                      href={track.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-base font-medium text-signal-emerald hover:underline"
                    >
                      <Truck className="h-3.5 w-3.5" />
                      {track.carrier} · {order.tracking_no}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : (
                    <span className="text-base text-cream">—</span>
                  )}
                </div>
                {order.customs_flag ? (
                  <Field label="Customs" value={order.customs_flag} />
                ) : null}
              </Section>

              {/* Notes */}
              {order.comment || order.remarks ? (
                <Section title="Notes">
                  {order.comment ? (
                    <div className="mb-2">
                      <div className="mb-1 text-xs uppercase tracking-wide text-cream-dim">Comment</div>
                      <p className="text-sm leading-relaxed text-cream-muted">{order.comment}</p>
                    </div>
                  ) : null}
                  {order.remarks ? (
                    <div>
                      <div className="mb-1 text-xs uppercase tracking-wide text-cream-dim">Remarks</div>
                      <p className="text-sm leading-relaxed text-cream-muted">{order.remarks}</p>
                    </div>
                  ) : null}
                </Section>
              ) : null}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 border-t border-brass/12 px-5 py-3.5">
              <Button
                asChild
                size="sm"
                className="flex-1 bg-brass font-medium text-forest-deep hover:bg-brass-light"
              >
                <a href={order.erpUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Open in ERPNext
                </a>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={copyOrderNo}
                className="border border-brass/20 text-cream-dim hover:text-cream"
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
