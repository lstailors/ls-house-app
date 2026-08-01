import { erpGet, erpRunMethod } from "../erp";

/** Frappe Workflow: direct writes to workflow_state are reverted by the engine. */
const WF_FORWARD = ["Received", "In Progress", "Ready", "Picked Up"] as const;
const WF_DIRECT: Record<string, Record<string, string>> = {
  Received: { "In Progress": "Start Work", Cancelled: "Cancel" },
  "In Progress": { Ready: "Mark Ready", Cancelled: "Cancel" },
  Ready: { "Picked Up": "Mark Picked Up", Cancelled: "Cancel" },
  Cancelled: { Received: "Reopen" },
};

export function workflowActionPath(from: string, to: string): string[] | null {
  if (from === to) return [];
  const direct = WF_DIRECT[from]?.[to];
  if (direct) return [direct];
  const fi = WF_FORWARD.indexOf(from as (typeof WF_FORWARD)[number]);
  const ti = WF_FORWARD.indexOf(to as (typeof WF_FORWARD)[number]);
  if (fi >= 0 && ti > fi) {
    const path: string[] = [];
    for (let i = fi; i < ti; i++) {
      const cur = WF_FORWARD[i];
      const next = WF_FORWARD[i + 1];
      if (!cur || !next) return null;
      const a = WF_DIRECT[cur]?.[next];
      if (!a) return null;
      path.push(a);
    }
    return path;
  }
  return null;
}

/** Advance an Alteration Ticket via named workflow actions. No-op if already at target. */
export async function walkTicketWorkflow(ticketId: string, targetState: string): Promise<void> {
  const ticket = await erpGet<{ workflow_state: string }>("Alteration Ticket", ticketId);
  if (!ticket) throw new Error(`Alteration Ticket ${ticketId} not found`);
  const path = workflowActionPath(ticket.workflow_state, targetState);
  if (path === null) {
    throw new Error(
      `No workflow path from "${ticket.workflow_state}" to "${targetState}" on ${ticketId}`,
    );
  }
  for (const action of path) {
    await erpRunMethod("frappe.model.workflow.apply_workflow", {
      doc: JSON.stringify({ doctype: "Alteration Ticket", name: ticketId }),
      action,
    });
  }
}

/**
 * When a linked delivery is Delivered, close the alteration ticket as Picked Up.
 * Non-fatal: logs and continues if workflow fails (delivery already updated).
 */
export async function closeAlterationTicketOnDelivery(
  alterationTicket: string | null | undefined,
): Promise<void> {
  const name = (alterationTicket || "").trim();
  if (!name) return;
  try {
    await walkTicketWorkflow(name, "Picked Up");
  } catch (err) {
    console.warn(
      `[deliveries] could not advance ${name} to Picked Up:`,
      err instanceof Error ? err.message : err,
    );
  }
}
