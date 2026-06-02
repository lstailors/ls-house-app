import { Hono } from "hono"
import { getAuthedUser } from "../lib/scope"
import { erpCreate, erpUpdate, erpSubmit, erpList, erpGet } from "../lib/erp"

export const transfersRouter = new Hono()

const TAILORS = [
  { id: "HR-EMP-00020", name: "Stella" },
  { id: "HR-EMP-00021", name: "Hugo" },
  { id: "HR-EMP-00004", name: "Altammhaddou Abderrahmane" },
  { id: "HR-EMP-00011", name: "Gklantiola Papa" },
]

// GET /api/transfers/tailors
transfersRouter.get("/tailors", async (c) => {
  const user = await getAuthedUser(c)
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401)
  return c.json({ data: TAILORS })
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

    // Update each alteration ticket
    for (const item of body.items) {
      if (body.direction === "Out") {
        await erpUpdate("Alteration Ticket", item.ticketId, {
          assigned_tailor: body.tailor,
          workflow_state: "In Progress",
        })
      } else {
        await erpUpdate("Alteration Ticket", item.ticketId, {
          assigned_tailor: "",
          workflow_state: "Ready",
        })
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
