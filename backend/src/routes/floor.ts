import { Hono } from "hono";
import { z } from "zod";
import { erpGet, erpList, erpUpdate } from "../lib/erp";
import { completionPatches, destinationFor, parseFloorScan, presentTicket, rackPatch, type RawTicket } from "../lib/floor";
import { walkTicketWorkflow } from "../lib/erpnext/alteration-workflow";

export const floorRouter = new Hono();
const fail = (c: any, e: unknown, status = 400) => c.json({ error: { message: e instanceof Error ? e.message : String(e) } }, status);
const timestamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

async function loadTicket(name: string, garment?: string) {
  const ticket = await erpGet<RawTicket>("Alteration Ticket", name);
  if (!ticket) throw new Error(`Ticket ${name} not found`);
  const shown = presentTicket(ticket, garment);
  if (garment && !shown.garments.some((g) => g.garmentId === garment || g.rowName === garment || g.qrToken === garment)) {
    throw new Error(`Garment ${garment} not found on ${name}`);
  }
  return { ticket, shown };
}

floorRouter.get("/queue", async (c) => {
  try {
    const tickets = await erpList<RawTicket>("Alteration Ticket", {
      filters: [["workflow_state", "in", ["Received", "In Progress", "Ready"]]],
      fields: ["name", "customer_name", "due_date", "due_time", "workflow_state", "is_rush"],
      order_by: "due_date asc",
      limit: 24,
      throwOnError: true,
    });
    return c.json({ data: tickets });
  } catch (e) { return fail(c, e, 502); }
});

floorRouter.get("/tailors", async (c) => {
  try {
    const rows = await erpList<any>("Employee", {
      filters: [["status", "=", "Active"]],
      fields: ["name", "employee_name"],
      order_by: "employee_name asc",
      limit: 100,
      throwOnError: true,
    });
    return c.json({ data: rows.map((x) => ({ id: x.name, name: x.employee_name || x.name })) });
  } catch (e) { return fail(c, e, 502); }
});

floorRouter.get("/scan", async (c) => {
  try {
    const parsed = parseFloorScan(c.req.query("value") || "");
    if (parsed.kind === "ticket") return c.json({ data: (await loadTicket(parsed.ticket)).shown });
    if (parsed.kind === "garment") return c.json({ data: (await loadTicket(parsed.ticket, parsed.garment)).shown });
    if (parsed.kind === "invoice") {
      const invoice = await erpGet<any>("Sales Invoice", parsed.invoice);
      const ticketName = String(invoice?.alteration_ticket_ref || "").trim();
      if (!ticketName) throw new Error(`Invoice ${parsed.invoice} has no alteration ticket`);
      return c.json({ data: (await loadTicket(ticketName)).shown });
    }
    const rows = await erpList<any>("Alteration Ticket Garment", {
      parent: "Alteration Ticket",
      filters: [["qr_token", "=", parsed.token]],
      fields: ["name", "parent", "garment_id", "qr_token"],
      limit: 2,
      throwOnError: true,
    });
    let row = rows[0];
    if (!row) row = await erpGet<any>("Alteration Ticket Garment", parsed.token);
    if (!row?.parent) throw new Error("Garment tag not found");
    return c.json({ data: (await loadTicket(String(row.parent), String(row.garment_id || row.name))).shown });
  } catch (e) { return fail(c, e, 404); }
});

floorRouter.post("/tickets/:ticket/garments/:garment/transfer", async (c) => {
  try {
    const body = z.object({ destination: z.enum(["Stella", "Hugo", "Munro", "Floor"]) }).parse(await c.req.json());
    const { ticket, shown } = await loadTicket(c.req.param("ticket"), c.req.param("garment"));
    const garment = shown.garments.find((g) => g.garmentId === c.req.param("garment") || g.rowName === c.req.param("garment"));
    if (!garment) throw new Error("Garment not found");
    const dest = destinationFor(body.destination);
    await erpUpdate("Alteration Ticket Garment", garment.rowName, {
      current_location: dest.warehouse,
      assigned_tailor: dest.employee,
      garment_status: body.destination === "Floor" ? "In Progress" : "In Progress",
    });
    if (ticket.workflow_state === "Received") await walkTicketWorkflow(ticket.name, "In Progress");
    return c.json({ data: (await loadTicket(ticket.name, garment.garmentId)).shown });
  } catch (e) { return fail(c, e); }
});

floorRouter.post("/tickets/:ticket/garments/:garment/complete", async (c) => {
  try {
    const body = z.object({ tailor: z.string().min(1), minutes: z.number().int(), note: z.string().max(1000).optional().default("") }).parse(await c.req.json());
    const { ticket } = await loadTicket(c.req.param("ticket"), c.req.param("garment"));
    const patches = completionPatches(ticket, c.req.param("garment"), body.tailor, body.minutes, body.note, timestamp());
    await erpUpdate("Alteration Ticket Garment", patches.garmentName, patches.garment);
    await Promise.all(patches.lines.map((line) => erpUpdate("Alteration Ticket Line", line.name, line.patch)));
    if (ticket.workflow_state === "Received") await walkTicketWorkflow(ticket.name, "In Progress");
    return c.json({ data: (await loadTicket(ticket.name, c.req.param("garment"))).shown });
  } catch (e) { return fail(c, e); }
});

floorRouter.post("/tickets/:ticket/rack", async (c) => {
  try {
    const body = z.object({ rackNumber: z.string().min(1), rackLocation: z.string().min(1) }).parse(await c.req.json());
    const { ticket, shown } = await loadTicket(c.req.param("ticket"));
    if (!shown.allDone) throw new Error("Complete every garment before sending the ticket to rack");
    const patch = rackPatch(body.rackNumber, body.rackLocation);
    await walkTicketWorkflow(ticket.name, "Ready");
    await erpUpdate("Alteration Ticket", ticket.name, { lsh_rack_number: patch.lsh_rack_number, lsh_rack_location: patch.lsh_rack_location });
    return c.json({ data: (await loadTicket(ticket.name)).shown });
  } catch (e) { return fail(c, e); }
});
