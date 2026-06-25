import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpGet } from "../lib/erp";

export const printRouter = new Hono();

// ───────────────────────────────────────────────────────────────────────────
// All thermal printing is routed THROUGH ERPNext — never directly to the
// printer.
//
// Why: the Epson TM-M30ii lives on the shop LAN (e.g. 10.0.1.41:9100) and is
// only reachable from inside the shop. This backend runs on Vercel, and the
// browser may be anywhere — neither can reach that LAN address. The
// `ls_thermal` Python package is deployed on the ERPNext bench, which DOES have
// LAN access to the printer. So we proxy every print job to its whitelisted
// methods; ERPNext builds the ESC/POS job, opens the raw socket to the printer,
// and writes the LSH Print Log row itself (we do not double-log here).
//
//   POST /api/print/ticket        -> ls_alterations.ls_thermal.api.print_ticket
//   POST /api/print/tags          -> ls_alterations.ls_thermal.api.print_ticket (what=tags)
//   POST /api/print/receipt       -> print_ticket (what=receipts) | print_payment_receipt
//   POST /api/print/payment-link  -> ls_alterations.ls_thermal.api.print_pay_link
//   GET  /api/print/status        -> ls_alterations.ls_thermal.api.test_printer
//   GET  /api/print/config        -> reads LSH Print Settings (display only)
// ───────────────────────────────────────────────────────────────────────────

const ERP_BASE = process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com";

// Alteration Ticket names look like ALT-NYC-2026-00048; Sales Invoices do not.
const isAlterationTicket = (name: string) => /^ALT/i.test(name);

interface ErpPrintResult {
  ok?: boolean;
  error?: string;
  url?: string;
  jobs?: Array<{ ok?: boolean; target?: string; bytes?: number; error?: string }>;
  [k: string]: unknown;
}

async function printViaErp(
  method: string,
  kwargs: Record<string, unknown>,
): Promise<ErpPrintResult> {
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const secret = process.env.ERPNEXT_API_SECRET ?? "";
  if (!key || !secret) throw new Error("ERPNext API credentials are not configured");

  const res = await fetch(`${ERP_BASE}/api/method/${method}`, {
    method: "POST",
    headers: {
      Authorization: `token ${key}:${secret}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(kwargs),
    signal: AbortSignal.timeout(15_000),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const serverMessages = json?._server_messages;
    const msg =
      (Array.isArray(serverMessages) && serverMessages.join(" ")) ||
      (typeof json?.exception === "string" && json.exception) ||
      (typeof json?.message === "string" && json.message) ||
      `ERPNext print failed (HTTP ${res.status})`;
    throw new Error(String(msg).slice(0, 300));
  }
  // Frappe wraps a whitelisted method's return value in { message: ... }.
  return (json?.message ?? json) as ErpPrintResult;
}

// Collapse an ERP print result into the { ok, error? } shape the frontend uses.
// ls_thermal methods return either { ok, jobs:[{ok,error}] } (print_ticket /
// receipt / pay_link) or a bare { ok, error } (test_printer).
function toClientResult(out: ErpPrintResult): { ok: boolean; error?: string } {
  if (out?.ok) return { ok: true };
  const failedJob = (out?.jobs ?? []).find((j) => j && j.ok === false && j.error);
  const error =
    (typeof out?.error === "string" && out.error) ||
    failedJob?.error ||
    "Print failed";
  return { ok: false, error };
}

// GET /api/print/config — read-only printer config for the Settings screen.
printRouter.get("/config", async (c) => {
  try {
    const row = await erpGet<Record<string, unknown>>("LSH Print Settings", "LSH Print Settings");
    if (!row) throw new Error("LSH Print Settings not found in ERPNext");
    return c.json({
      enabled: Boolean(Number(row.enabled ?? 0)),
      printer_ip: String(row.thermal_printer_ip ?? ""),
      printer_port: Number(row.thermal_printer_port ?? 9100),
      timeout: Number(row.thermal_timeout ?? 5),
      app_base_url: String(row.app_base_url ?? process.env.APP_URL ?? "https://app.lstailors.com"),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Could not load print config";
    return c.json({ ok: false, error });
  }
});

// GET /api/print/status — fire a small diagnostic slip from the bench.
printRouter.get("/status", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const out = await printViaErp("ls_alterations.ls_thermal.api.test_printer", {});
    return c.json(toClientResult(out));
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Printer test failed" });
  }
});

// POST /api/print/ticket — full alteration ticket: office + customer + tags.
printRouter.post("/ticket", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as { ticket_name?: string; what?: string } | null;
  const ticket = body?.ticket_name?.trim();
  if (!ticket) return c.json({ ok: false, error: "ticket_name is required" });

  // ls_thermal prints Alteration Tickets. Custom orders (Sales Orders) have no
  // thermal print method yet — fail clearly instead of with an ERPNext stack.
  if (!isAlterationTicket(ticket)) {
    return c.json({
      ok: false,
      error: "Thermal ticket printing is only available for alteration tickets right now.",
    });
  }

  try {
    const out = await printViaErp("ls_alterations.ls_thermal.api.print_ticket", {
      ticket,
      what: body?.what ?? "all",
    });
    return c.json(toClientResult(out));
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Print failed" });
  }
});

// POST /api/print/tags — just the garment tags for a ticket.
printRouter.post("/tags", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as { ticket_name?: string } | null;
  const ticket = body?.ticket_name?.trim();
  if (!ticket) return c.json({ ok: false, error: "ticket_name is required" });
  if (!isAlterationTicket(ticket)) {
    return c.json({ ok: false, error: "Garment tags are only available for alteration tickets." });
  }

  try {
    const out = await printViaErp("ls_alterations.ls_thermal.api.print_ticket", {
      ticket,
      what: "tags",
    });
    return c.json(toClientResult(out));
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Tag print failed" });
  }
});

// POST /api/print/receipt — for an alteration ticket, the office + customer
// receipt copies; for a Sales Invoice, the post-payment receipt.
printRouter.post("/receipt", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as { invoice?: string } | null;
  const id = body?.invoice?.trim();
  if (!id) return c.json({ ok: false, error: "invoice is required" });

  try {
    const out = isAlterationTicket(id)
      ? await printViaErp("ls_alterations.ls_thermal.api.print_ticket", { ticket: id, what: "receipts" })
      : await printViaErp("ls_alterations.ls_thermal.api.print_payment_receipt", { invoice: id });
    return c.json(toClientResult(out));
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "Receipt print failed" });
  }
});

// POST /api/print/payment-link — print a "scan to pay" QR slip. ls_thermal
// creates the Square link for the invoice/ticket and prints it in one step.
// (The client may still send url/amount/customer_name; ERPNext is the source of
// truth for the printed link, so only the id is needed.)
printRouter.post("/payment-link", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as { invoice?: string; ticket?: string } | null;
  const id = (body?.ticket ?? body?.invoice)?.trim();
  if (!id) return c.json({ ok: false, error: "invoice is required" });

  try {
    const kwargs = isAlterationTicket(id) ? { ticket: id } : { invoice: id };
    const out = await printViaErp("ls_alterations.ls_thermal.api.print_pay_link", kwargs);
    return c.json({ ...toClientResult(out), url: out?.url });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : "QR slip print failed" });
  }
});
