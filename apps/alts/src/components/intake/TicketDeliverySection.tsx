/**
 * Ticket details — change Pickup / Hand delivery / Ship (FedEx)
 * without going back through checkout.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@ls/api-client";
import { useMe } from "@ls/auth";
import { Loader2 } from "lucide-react";
import DeliveryBlock, { type DeliverySelection } from "./DeliveryBlock";
import { deliveryFromTicket, type TicketDeliveryFields } from "./ticketDelivery";

type Props = {
  ticket: TicketDeliveryFields & {
    name: string;
    included_in_custom?: number | boolean | null;
    billing_status?: string | null;
    linked_sales_order?: string | null;
    linked_delivery?: string | null;
  };
  ticketName: string;
};

export default function TicketDeliverySection({ ticket, ticketName }: Props) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [delivery, setDelivery] = useState<DeliverySelection>(() => deliveryFromTicket(ticket));

  useEffect(() => {
    setDelivery(deliveryFromTicket(ticket));
  }, [
    ticket.name,
    ticket.delivery_method,
    ticket.delivery_address,
    ticket.delivery_zip,
    ticket.delivery_requested_date,
    ticket.due_date,
  ]);

  const freeCustom = Boolean(
    ticket.included_in_custom ||
      ticket.billing_status === "Included in Custom Order" ||
      ticket.linked_sales_order,
  );

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.patch<{
        ok: true;
        delivery_method: string;
        linked_delivery: string | null;
        warning?: string | null;
      }>(`/api/intake-alterations/tickets/${encodeURIComponent(ticketName)}/delivery`, {
        delivery_method: delivery.delivery_method,
        delivery_address: delivery.delivery_address || null,
        delivery_apt: delivery.delivery_apt || null,
        delivery_city: delivery.delivery_city || null,
        delivery_state: delivery.delivery_state || null,
        delivery_zip: delivery.delivery_zip || null,
        delivery_notes: delivery.delivery_notes || null,
        delivery_requested_date: delivery.delivery_requested_date || ticket.due_date || null,
        delivery_time_window: delivery.delivery_time_window || null,
        delivery_fee: delivery.delivery_fee ?? 0,
        delivery_fee_override: Boolean(delivery.delivery_fee_override),
        delivery_fee_override_reason: delivery.delivery_fee_override_reason || null,
      });
      return res;
    },
    onSuccess: (data) => {
      if (data?.warning) toast.message(data.warning);
      else if (delivery.delivery_method === "Pickup") toast.success("Set to shop pickup");
      else if (delivery.delivery_method === "Ship (FedEx)") toast.success("Set to FedEx ship");
      else toast.success("Set to hand delivery");
      queryClient.invalidateQueries({ queryKey: ["ticket", ticketName] });
    },
    onError: (e: Error) => toast.error(e.message || "Could not save how it leaves"),
  });

  return (
    <section className="space-y-3">
      <DeliveryBlock
        value={delivery}
        onChange={setDelivery}
        dueDate={ticket.due_date || undefined}
        showScheduleHint={false}
        freeCustom={freeCustom}
        canOverrideFee={me?.role === "super_admin" || me?.role === "store_manager"}
      />
      {delivery.delivery_method !== "Pickup" ? (
        <label className="block px-0.5">
          <span className="caps text-[9px] text-cream-dim">Delivery / ship date</span>
          <input
            type="date"
            className="mt-1 w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm text-cream"
            value={(delivery.delivery_requested_date || ticket.due_date || "").slice(0, 10)}
            onChange={(e) =>
              setDelivery({
                ...delivery,
                delivery_requested_date: e.target.value || undefined,
                delivery_scheduled: true,
              })
            }
          />
        </label>
      ) : null}
      <div className="flex items-center justify-between gap-3 px-0.5">
        <p className="text-[11px] text-cream-dim">
          {ticket.linked_delivery
            ? `On the board: ${ticket.linked_delivery}`
            : delivery.delivery_method === "Pickup"
              ? "Client collects at the shop."
              : "Save to queue this on the delivery board."}
        </p>
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="min-h-11 px-4 rounded-md text-sm font-semibold border border-brass/50 bg-brass/20 text-brass hover:bg-brass/30 disabled:opacity-60 inline-flex items-center gap-1.5"
        >
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {save.isPending ? "Saving…" : "Save how it leaves"}
        </button>
      </div>
    </section>
  );
}
