import { Hono } from "hono"
import { getAuthedUser } from "../lib/scope"
import { erpCreate, erpUpdate, erpSubmit, erpList, erpGet, erpRunMethod } from "../lib/erp"

export const transfersRouter = new Hono()

// Frappe Workflow: direct writes to workflow_state are reverted by the engine.
// Named actions must match live "Alteration Ticket Workflow" transitions.
const WF_FORWARD = ["Received", "In Progress", "Ready", "Picked Up"] as const
const WF_DIRECT: Record<string, Record<string, string>> = {
  Received: { "In Progress": "Start Work", Cancelled: "Cancel" },
  "In Progress": { Ready: "Mark Ready", Cancelled: "Cancel" },
  Ready: { "Picked Up": "Mark Picked Up", Cancelled: "Cancel" },
  Cancelled: { Received: "Reopen" },
}

function workflowActionPath(from: string, to: string): string[] | null {
  if (from === to) return []
  const direct = WF_DIRECT[from]?.[to]
  if (direct) return [direct]
  const fi = WF_FORWARD.indexOf(from as (typeof WF_FORWARD)[number])
  const ti = WF_FORWARD.indexOf(to as (typeof WF_FORWARD)[number])
  if (fi >= 0 && ti > fi) {
    const path: string[] = []
    for (let i = fi; i < ti; i++) {
      const cur = WF_FORWARD[i]
      const next = WF_FORWARD[i + 1]
      if (!cur || !next) return null
      const a = WF_DIRECT[cur]?.[next]
      if (!a) return null
      path.push(a)
    }
    return path
  }
  return null
}

async function walkTicketWorkflow(ticketId: string, targetState: string): Promise<void> {
  const ticket = await erpGet<{ workflow_state: string }>("Alteration Ticket", ticketId)
  if (!ticket) throw new Error(`Alteration Ticket ${ticketId} not found`)
  const path = workflowActionPath(ticket.workflow_state, targetState)
  if (path === null) {
    throw new Error(
      `No workflow path from "${ticket.workflow_state}" to "${targetState}" on ${ticketId}`,
    )
  }
  for (const action of path) {
    await erpRunMethod("frappe.model.workflow.apply_workflow", {
      doc: JSON.stringify({ doctype: "Alteration Ticket", name: ticketId }),
      action,
    })
  }
}

/** Canonical tailor roster = ERPNext Employee (Active + Tailor / Master Tailor). HER-16. */
async function listActiveTailors(): Promise<Array<{ id: string; name: string; designation?: string }>> {
  const rows = await erpList<{ name: string; employee_name: string; designation?: string }>("Employee", {
    filters: [
      ["status", "=", "Active"],
      ["designation", "in", ["Tailor", "Master Tailor"]],
    ],
    fields: ["name", "employee_name", "designation"],
    limit: 200,
    order_by: "employee_name asc",
  })
  return rows.map((r) => ({
    id: r.name,
    name: r.employee_name || r.name,
    designation: r.designation,
  }))
}

// GET /api/transfers/tailors
transfersRouter.get("/tailors", async (c) => {
  const user = await getAuthedUser(c)
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401)
  const tailors = await listActiveTailors()
  return c.json({ data: tailors })
})

// GET /api/transfers
transfersRouter.get("/", async (c) => {
  const user = await getAuthedUser(c)
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401)

  const transfers = await erpList("Tailor Transfer", {
    fields: ["name", "tailor", "tailor_name", "direction", "transfer_date", "item_count", "check_amount", "docstatus"],
    limit: 100,
    order_by: "creation desc",
  })

  return c.json({ data: transfers })
})

// POST /api/transfers
transfersRouter.post("/", async (c) => {
  const user = await getAuthedUser(c)
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401)

  const body = await c.req.json() as {
    direction: "Out" | "Return"
    tailor: string
    tailorName: string
    items: Array<{
      ticketId: string
      customerName: string
      garmentType: string
      qrCode?: string
    }>
    checkAmount?: number
    checkNumber?: string
    paymentNotes?: string
  }

  const today = new Date().toISOString().slice(0, 10)

  try {
    const transfer = await erpCreate("Tailor Transfer", {
      tailor: body.tailor,
      tailor_name: body.tailorName,
      direction: body.direction,
      transfer_date: today,
      item_count: body.items.length,
      check_amount: body.checkAmount ?? 0,
      check_number: body.checkNumber ?? "",
      payment_notes: body.paymentNotes ?? "",
      items: body.items.map(i => ({
        alteration_ticket: i.ticketId,
        customer_name: i.customerName,
        garment_type: i.garmentType,
        qr_code: i.qrCode ?? "",
      })),
    })

    const transferName = (transfer as any)?.name
    await erpSubmit("Tailor Transfer", transferName)

    // Update each alteration ticket via workflow engine (HER-14 / D4).
    // Never write workflow_state directly — engine reverts raw field writes.
    for (const item of body.items) {
      if (body.direction === "Out") {
        await erpUpdate("Alteration Ticket", item.ticketId, {
          assigned_tailor: body.tailor,
        })
        await walkTicketWorkflow(item.ticketId, "In Progress")
      } else {
        await erpUpdate("Alteration Ticket", item.ticketId, {
          assigned_tailor: "",
        })
        await walkTicketWorkflow(item.ticketId, "Ready")
      }
    }

    // If Return with payment, create Journal Entry
    let jeName: string | null = null
    if (body.direction === "Return" && (body.checkAmount ?? 0) > 0) {
      const je = await erpCreate("Journal Entry", {
        voucher_type: "Journal Entry",
        posting_date: today,
        user_remark: `Tailor payment — ${body.tailorName} — ${transferName} — ${body.items.length} pieces`,
        accounts: [
          {
            account: "Subcontractor Expense - LSTNY",
            debit_in_account_currency: body.checkAmount,
            credit_in_account_currency: 0,
            party_type: "Employee",
            party: body.tailor,
          },
          {
            account: "Cash - LSTNY",
            debit_in_account_currency: 0,
            credit_in_account_currency: body.checkAmount,
          },
        ],
        cheque_no: body.checkNumber ?? "",
        cheque_date: today,
      })
      jeName = (je as any)?.name ?? null
      if (jeName) {
        await erpSubmit("Journal Entry", jeName)
        await erpUpdate("Tailor Transfer", transferName, { journal_entry: jeName })
      }
    }

    return c.json({ data: { transferName, journalEntry: jeName, itemCount: body.items.length } })
  } catch (err: any) {
    return c.json({ error: { message: err.message ?? "Transfer failed" } }, 502)
  }
})
