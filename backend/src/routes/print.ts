import { Hono } from "hono";
import { getAuthedUser, canAccessSuperAdminPortal } from "../lib/scope";
import { erpGet, erpUpdate } from "../lib/erp";
import {
  friendlyThermalPrintError,
  isMissingErpPrintModule,
  THERMAL_PRINT_METHODS,
} from "../lib/thermal-print";

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
//   POST /api/print/ticket        -> ls_alterations.api.print_ticket (fallback: ls_thermal.api)
//   POST /api/print/tags          -> print_ticket (what=tags)
//   POST /api/print/receipt       -> print_ticket (what=receipts) | print_payment_receipt
//   POST /api/print/payment-link  -> ls_alterations.api.print_pay_link
//   GET  /api/print/status        -> ls_alterations.api.test_printer
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
  methods: readonly string[] | string,
  kwargs: Record<string, unknown>,
): Promise<ErpPrintResult> {
  const key = process.env.ERPNEXT_API_KEY ?? "";
  const secret = process.env.ERPNEXT_API_SECRET ?? "";
  if (!key || !secret) throw new Error("ERPNext API credentials are not configured");

  const base = (process.env.ERPNEXT_BASE_URL ?? ERP_BASE).replace(/\/$/, "");
  const list = (Array.isArray(methods) ? methods : [methods]).filter(Boolean);
  let lastErr = "ERPNext print failed";

  for (const method of list) {
    const res = await fetch(`${base}/api/method/${method}`, {
      method: "POST",
      headers: {
        Authorization: `token ${key}:${secret}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        // Same UA as erp.ts — CF tunnel returns 1010 without a browser UA.
        "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)",
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
      lastErr = String(msg).slice(0, 300);
      if (isMissingErpPrintModule(lastErr) && list.length > 1) continue;
      throw new Error(lastErr);
    }
    return (json?.message ?? json) as ErpPrintResult;
  }

  throw new Error(lastErr);
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

const ALTS_PUBLIC = (process.env.ALTS_URL || "https://alts.lstailors.com").replace(/\/$/, "");

function effectiveAppBaseUrl(raw: unknown): string {
  const u = String(raw ?? "").trim();
  if (!u || u.includes("app.lstailors.com")) return ALTS_PUBLIC;
  return u.replace(/\/$/, "");
}

// GET /api/print/config — read-only printer config for the Settings screen.
printRouter.get("/config", async (c) => {
  // D13 (HER-22): auth required — do not leak LAN printer IP/port publicly.
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const row = await erpGet<Record<string, unknown>>("LSH Print Settings", "LSH Print Settings");
    if (!row) throw new Error("LSH Print Settings not found in ERPNext");
    const raw = String(row.app_base_url ?? "").trim();
    return c.json({
      enabled: Boolean(Number(row.enabled ?? 0)),
      printer_ip: String(row.thermal_printer_ip ?? ""),
      printer_port: Number(row.thermal_printer_port ?? 9100),
      timeout: Number(row.thermal_timeout ?? 5),
      app_base_url: effectiveAppBaseUrl(raw),
      // Raw ERP value (admins only) — shows whether Part A (settings flip) landed.
      ...(canAccessSuperAdminPortal(user.role) ? { erp_app_base_url: raw || null } : {}),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Could not load print config";
    return c.json({ ok: false, error });
  }
});

// POST /api/print/config/app-base-url — flip ERP Print Settings to alts (super_admin).
// Uses Vercel ERPNEXT_* credentials; no Mac Studio SSH required once API is deployed.
printRouter.post("/config/app-base-url", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  if (!canAccessSuperAdminPortal(user.role)) {
    return c.json({ error: { message: "Super admin required" } }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as { url?: string } | null;
  const target = (body?.url?.trim() || ALTS_PUBLIC).replace(/\/$/, "");
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}/i.test(target)) {
    return c.json({ ok: false, error: "url must be an https origin" }, 400);
  }

  try {
    const before = await erpGet<Record<string, unknown>>("LSH Print Settings", "LSH Print Settings");
    const prev = String(before?.app_base_url ?? "").trim();
    if (prev.replace(/\/$/, "") === target) {
      return c.json({ ok: true, app_base_url: target, unchanged: true });
    }

    const updated = await erpUpdate<Record<string, unknown>>("LSH Print Settings", "LSH Print Settings", {
      app_base_url: target,
    });
    if (!updated) throw new Error("ERP update returned empty (check ERPNEXT_* credentials)");

    const after = String(updated.app_base_url ?? "").trim().replace(/\/$/, "");
    if (after !== target) {
      // Some singles ignore unknown keys on PUT — try set_value via method.
      const key = process.env.ERPNEXT_API_KEY ?? "";
      const secret = process.env.ERPNEXT_API_SECRET ?? "";
      const base = (process.env.ERPNEXT_BASE_URL ?? "https://erp.lstailors.com").replace(/\/$/, "");
      const setRes = await fetch(`${base}/api/method/frappe.client.set_value`, {
        method: "POST",
        headers: {
          Authorization: `token ${key}:${secret}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; L&S-House-App/1.0; +https://app.lstailors.com)",
        },
        body: JSON.stringify({
          doctype: "LSH Print Settings",
          name: "LSH Print Settings",
          fieldname: "app_base_url",
          value: target,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!setRes.ok) {
        throw new Error(`set_value failed HTTP ${setRes.status}`);
      }
    }

    return c.json({
      ok: true,
      app_base_url: target,
      previous: prev || null,
      by: user.email,
    });
  } catch (e) {
    return c.json({
      ok: false,
      error: e instanceof Error ? e.message : "Could not update app_base_url",
    }, 500);
  }
});

// GET /api/print/status — fire a small diagnostic slip from the bench.
printRouter.get("/status", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);
  try {
    const out = await printViaErp(THERMAL_PRINT_METHODS.test_printer, {});
    return c.json(toClientResult(out));
  } catch (e) {
    return c.json({ ok: false, error: friendlyThermalPrintError(e) });
  }
});

// POST /api/print/ticket — full alteration ticket: office + customer + tags.
printRouter.post("/ticket", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    ticket_name?: string;
    what?: string;
    reprint?: boolean | number | string;
  } | null;
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

  const reprint = body?.reprint === true || body?.reprint === 1 || body?.reprint === "1" ? 1 : 0;

  try {
    const out = await printViaErp(THERMAL_PRINT_METHODS.print_ticket, {
      ticket,
      what: body?.what ?? "all",
      reprint,
    });
    return c.json(toClientResult(out));
  } catch (e) {
    return c.json({ ok: false, error: friendlyThermalPrintError(e) });
  }
});

// POST /api/print/tags — just the garment tags for a ticket.
printRouter.post("/tags", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    ticket_name?: string;
    reprint?: boolean | number | string;
  } | null;
  const ticket = body?.ticket_name?.trim();
  if (!ticket) return c.json({ ok: false, error: "ticket_name is required" });
  if (!isAlterationTicket(ticket)) {
    return c.json({ ok: false, error: "Garment tags are only available for alteration tickets." });
  }

  const reprint = body?.reprint === true || body?.reprint === 1 || body?.reprint === "1" ? 1 : 0;

  try {
    const out = await printViaErp(THERMAL_PRINT_METHODS.print_ticket, {
      ticket,
      what: "tags",
      reprint,
    });
    return c.json(toClientResult(out));
  } catch (e) {
    return c.json({ ok: false, error: friendlyThermalPrintError(e) });
  }
});

// POST /api/print/receipt — for an alteration ticket, the office + customer
// receipt copies; for a Sales Invoice, the post-payment receipt.
printRouter.post("/receipt", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    invoice?: string;
    ticket_name?: string;
    ticket?: string;
    reprint?: boolean | number | string;
  } | null;
  const id = (body?.invoice ?? body?.ticket_name ?? body?.ticket)?.trim();
  if (!id) return c.json({ ok: false, error: "invoice is required" });

  const reprint = body?.reprint === true || body?.reprint === 1 || body?.reprint === "1" ? 1 : 0;

  try {
    const out = isAlterationTicket(id)
      ? await printViaErp(THERMAL_PRINT_METHODS.print_ticket, {
          ticket: id,
          what: "receipts",
          reprint,
        })
      : await printViaErp(THERMAL_PRINT_METHODS.print_payment_receipt, {
          invoice: id,
          reprint,
        });
    return c.json(toClientResult(out));
  } catch (e) {
    return c.json({ ok: false, error: friendlyThermalPrintError(e) });
  }
});

// POST /api/print/payment-link — print a "scan to pay" QR slip. ls_thermal
// creates the Square link for the invoice/ticket and prints it in one step.
// (The client may still send url/amount/customer_name; ERPNext is the source of
// truth for the printed link, so only the id is needed.)
printRouter.post("/payment-link", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    invoice?: string;
    ticket?: string;
    reprint?: boolean | number | string;
  } | null;
  const id = (body?.ticket ?? body?.invoice)?.trim();
  if (!id) return c.json({ ok: false, error: "invoice is required" });

  const reprint = body?.reprint === true || body?.reprint === 1 || body?.reprint === "1" ? 1 : 0;

  try {
    const kwargs = isAlterationTicket(id)
      ? { ticket: id, reprint }
      : { invoice: id, reprint };
    const out = await printViaErp(THERMAL_PRINT_METHODS.print_pay_link, kwargs);
    return c.json({ ...toClientResult(out), url: out?.url });
  } catch (e) {
    return c.json({ ok: false, error: friendlyThermalPrintError(e) });
  }
});
