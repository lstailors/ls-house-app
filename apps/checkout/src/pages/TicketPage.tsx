import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type CheckoutCard } from "@checkout/lib/api";
import { bagAdd, bagFromCard } from "@checkout/lib/bag";
import { usd } from "@checkout/lib/money";
import { Chrome, MoneyDue, PrimaryButton, SectionLabel } from "@checkout/components/Chrome";

function TicketBody({ card, kind }: { card: CheckoutCard; kind: "ticket" | "invoice" }) {
  const nav = useNavigate();
  const ticketId = kind === "ticket" ? card.id : card.ticketId || undefined;
  const invoiceId = kind === "invoice" ? card.id : card.invoiceId || undefined;
  const due = Number(card.outstanding) || 0;
  const paid = due <= 0.005;

  return (
    <div className="checkout-shell">
      <Chrome title={card.customer || "Ticket"} sub={card.id} backTo="/" />

      <div className="glass mx-4 flex items-center justify-between gap-3 p-4">
        <div>
          <div className="text-sm font-semibold">{card.customer}</div>
          <div className="mt-1 text-xs text-[var(--cm)]">
            {card.workflowState || card.paymentStatus || "—"}
            {invoiceId ? ` · ${invoiceId}` : ""}
          </div>
          <div className="mt-1 text-xs text-[var(--cd)]">
            {(card.garments || []).length
              ? `${card.garments!.length} garment${card.garments!.length === 1 ? "" : "s"}`
              : `${(card.lines || []).length} line(s)`}
          </div>
        </div>
        <MoneyDue amount={due} label={paid ? "Paid" : "Due"} />
      </div>

      <SectionLabel>Work</SectionLabel>
      <div className="max-h-40 space-y-2 overflow-y-auto px-4">
        {(card.lines || []).map((l, i) => (
          <div key={i} className="glass flex justify-between gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 truncate text-[var(--cm)]">{l.description}</span>
            <span className="shrink-0 text-[var(--cr)]">{usd(l.price ?? l.amount)}</span>
          </div>
        ))}
        {!(card.lines || []).length ? <div className="text-center text-xs text-[var(--cd)]">No lines</div> : null}
      </div>

      <div className="mt-auto space-y-2 px-4 pb-8 pt-4">
        {!paid ? (
          <PrimaryButton
            onClick={() => {
              bagFromCard(card);
              nav(
                `/pay?${new URLSearchParams({
                  ...(ticketId ? { ticket: ticketId } : {}),
                  ...(invoiceId ? { invoice: invoiceId } : {}),
                }).toString()}`,
              );
            }}
            label={`Pay · ${usd(due)}`}
          />
        ) : (
          <PrimaryButton
            onClick={() =>
              nav(
                `/out?${new URLSearchParams({
                  ...(ticketId ? { ticket: ticketId } : {}),
                  ...(invoiceId ? { invoice: invoiceId } : {}),
                }).toString()}`,
              )
            }
            label="Mark out"
          />
        )}
        <button
          type="button"
          className="btn-ghost w-full min-h-[48px] text-xs font-bold uppercase tracking-wider"
          onClick={() => {
            bagAdd(card);
            nav(
              `/bag/add?${new URLSearchParams({
                customer: card.customerId || "",
                name: card.customer || "",
              }).toString()}`,
            );
          }}
        >
          Add to bag
        </button>
        {paid ? null : (
          <button
            type="button"
            className="btn-ghost w-full min-h-[48px] text-xs font-bold uppercase tracking-wider"
            onClick={() =>
              nav(
                `/out?${new URLSearchParams({
                  ...(ticketId ? { ticket: ticketId } : {}),
                  ...(invoiceId ? { invoice: invoiceId } : {}),
                }).toString()}`,
              )
            }
          >
            Out without pay
          </button>
        )}
        <Link to="/" className="block py-2 text-center text-xs font-semibold uppercase tracking-wider text-[var(--cd)]">
          Cancel
        </Link>
      </div>
    </div>
  );
}

export function TicketPage() {
  const { name = "" } = useParams();
  const q = useQuery({
    queryKey: ["checkout-ticket", name],
    queryFn: () => api.ticket(name),
    enabled: !!name,
  });
  if (q.isLoading) return <div className="checkout-shell grid place-items-center text-[var(--cd)]">Loading…</div>;
  if (q.error || !q.data)
    return (
      <div className="checkout-shell p-6 text-center text-red-300">
        {(q.error as Error)?.message || "Not found"}
        <div className="mt-4">
          <Link to="/" className="text-[var(--bl)]">
            Home
          </Link>
        </div>
      </div>
    );
  return <TicketBody card={q.data} kind="ticket" />;
}

export function InvoicePage() {
  const { name = "" } = useParams();
  const q = useQuery({
    queryKey: ["checkout-invoice", name],
    queryFn: () => api.invoice(name),
    enabled: !!name,
  });
  if (q.isLoading) return <div className="checkout-shell grid place-items-center text-[var(--cd)]">Loading…</div>;
  if (q.error || !q.data)
    return (
      <div className="checkout-shell p-6 text-center text-red-300">
        {(q.error as Error)?.message || "Not found"}
      </div>
    );
  return <TicketBody card={q.data} kind="invoice" />;
}
