import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope";
import { erpCreate, erpGet } from "../lib/erp";

export const printRouter = new Hono();

type PrintType = "Ticket" | "Receipt" | "PaymentLink" | "Tags";

interface PrintConfig {
  enabled: boolean;
  printer_ip: string;
  printer_port: number;
  timeout: number;
  app_base_url: string;
}

let cachedConfig: { value: PrintConfig; expiresAt: number } | null = null;

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function col(left: string, right: string, width = 42): string {
  const l = left.slice(0, Math.max(0, width - right.length - 1));
  const pad = width - l.length - right.length;
  return l + " ".repeat(Math.max(pad, 1)) + right;
}

function money(n: unknown): string {
  const value = Number(n ?? 0);
  return `$${value.toFixed(2)}`;
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

async function getPrintConfig(): Promise<PrintConfig> {
  const now = Date.now();
  if (cachedConfig && cachedConfig.expiresAt > now) return cachedConfig.value;

  const row = await erpGet<any>("LSH Print Settings", "LSH Print Settings");
  if (!row) throw new Error("LSH Print Settings not found in ERPNext");

  const value: PrintConfig = {
    enabled: Boolean(Number(row.enabled ?? 0)),
    printer_ip: String(row.thermal_printer_ip ?? ""),
    printer_port: Number(row.thermal_printer_port ?? 9100),
    timeout: Number(row.thermal_timeout ?? 5),
    app_base_url: String(row.app_base_url ?? process.env.APP_URL ?? "https://app.lstailors.com"),
  };
  cachedConfig = { value, expiresAt: now + 60_000 };
  return value;
}

async function logPrint(input: {
  ticket?: string | null;
  invoice?: string | null;
  print_type: PrintType;
  status: "Success" | "Failed";
  bytes_sent: number;
  error?: string;
  printer_ip?: string;
}) {
  try {
    await erpCreate("LSH Print Log", {
      ticket: input.ticket ?? null,
      invoice: input.invoice ?? null,
      print_type: input.print_type,
      status: input.status,
      printed_at: new Date().toISOString(),
      bytes_sent: input.bytes_sent,
      error: input.error ?? "",
      printer_ip: input.printer_ip ?? "",
    });
  } catch (e) {
    console.error("[print] failed to write LSH Print Log:", e);
  }
}

async function sendXml(xml: string, config: PrintConfig): Promise<number> {
  if (!config.enabled) throw new Error("Thermal printing is disabled in ERPNext");
  if (!config.printer_ip) throw new Error("Thermal printer IP is not configured in ERPNext");

  const bytes = new TextEncoder().encode(xml).byteLength;
  const res = await fetch(`http://${config.printer_ip}/cgi-bin/epos/service.cgi`, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: '""',
    },
    body: xml,
    signal: AbortSignal.timeout(Math.max(1, config.timeout) * 1000),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Printer returned HTTP ${res.status}`);
  if (text.includes('success="false"')) {
    const code = text.match(/code="([^"]+)"/)?.[1] ?? "unknown";
    throw new Error(`Printer error: ${code}`);
  }
  return bytes;
}

function lineItemsForGarment(ticket: any, garment: any) {
  const ref = garment.name ?? garment.garment_id;
  const garmentId = garment.garment_id ?? garment.name;
  return (ticket.lines ?? []).filter((line: any) =>
    line.garment_ref === ref || line.garment_ref === garmentId,
  );
}

function buildTicketXml(ticket: any): string {
  const p: string[] = [];
  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`);
  p.push(`<text align="center" font="font_a" width="2" height="2">L&amp;S Custom Tailors&#10;</text>`);
  p.push(`<text align="center">${esc(ticket.origin_location ?? "")} ALTERATION TICKET&#10;</text>`);
  p.push(`<text>--------------------------------&#10;</text>`);
  p.push(`<text>${esc(col("Ticket:", ticket.name))}&#10;</text>`);
  p.push(`<text>${esc(col("Customer:", ticket.customer_name))}&#10;</text>`);
  if (ticket.customer_mobile || ticket.customer_phone) {
    p.push(`<text>${esc(col("Phone:", ticket.customer_mobile ?? ticket.customer_phone))}&#10;</text>`);
  }
  p.push(`<text>${esc(col("Date:", formatDate(ticket.ticket_date)))}&#10;</text>`);
  p.push(`<text>${esc(col("Due:", `${formatDate(ticket.due_date)}${Number(ticket.is_rush) ? " RUSH" : ""}`))}&#10;</text>`);
  p.push(`<text>${esc(col("Status:", ticket.workflow_state ?? ""))}&#10;</text>`);
  p.push(`<text>--------------------------------&#10;</text>`);

  for (const garment of ticket.garments ?? []) {
    const label = `${garment.garment_type ?? "Garment"}${garment.color ? ` - ${garment.color}` : ""} (${garment.garment_id ?? garment.name})`;
    p.push(`<text bold="true">${esc(label)}&#10;</text>`);
    for (const line of lineItemsForGarment(ticket, garment)) {
      p.push(`<text>${esc(col(`  ${line.description ?? ""}`, money(line.price)))}&#10;</text>`);
    }
  }

  p.push(`<text>--------------------------------&#10;</text>`);
  p.push(`<text width="1" height="2" bold="true">${esc(col("TOTAL", money(ticket.ticket_total)))}&#10;</text>`);
  p.push(`<text>${esc(col("Payment:", ticket.payment_status ?? ""))}&#10;</text>`);
  if (ticket.customer_notes) {
    p.push(`<text>--------------------------------&#10;</text>`);
    p.push(`<text>${esc(ticket.customer_notes)}&#10;</text>`);
  }
  p.push(`<feed line="3"/>`);
  p.push(`<cut type="feed"/>`);
  p.push(`</epos-print>`);
  return p.join("\n");
}

function buildTagsXml(ticket: any, appBaseUrl: string): string {
  const p: string[] = [];
  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`);
  for (const garment of ticket.garments ?? []) {
    const garmentId = garment.garment_id ?? garment.name;
    const tagUrl = `${appBaseUrl}/garments/${encodeURIComponent(ticket.name)}/${encodeURIComponent(garmentId)}`;
    if (Number(ticket.is_rush)) {
      p.push(`<text align="center" width="2" height="2" bold="true">** RUSH **&#10;</text>`);
    }
    p.push(`<text align="center">${esc(ticket.name)}&#10;</text>`);
    p.push(`<text align="center" width="1" height="2" bold="true">${esc(ticket.customer_name)}&#10;</text>`);
    p.push(`<text align="center">${esc(garment.garment_type ?? "Garment")} ${esc(garment.color ?? "")}&#10;</text>`);
    p.push(`<text align="center">ID: ${esc(garmentId)}&#10;</text>`);
    p.push(`<symbol align="center" type="qrcode_model_2" level="level_m" width="6" height="6" size="0">${esc(tagUrl)}</symbol>`);
    p.push(`<text>&#10;</text>`);
    for (const line of lineItemsForGarment(ticket, garment)) {
      p.push(`<text>${esc(`  ${line.description ?? ""}`)}&#10;</text>`);
    }
    p.push(`<text align="center">Due: ${esc(formatDate(ticket.due_date))} | ${esc(ticket.origin_location ?? "")}&#10;</text>`);
    p.push(`<feed line="2"/>`);
    p.push(`<cut type="feed"/>`);
  }
  p.push(`</epos-print>`);
  return p.join("\n");
}

function buildInvoiceReceiptXml(invoice: any, paymentEntry?: string): string {
  const p: string[] = [];
  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`);
  p.push(`<text align="center" font="font_a" width="2" height="2">L&amp;S Custom Tailors&#10;</text>`);
  p.push(`<text align="center">PAYMENT RECEIPT&#10;</text>`);
  p.push(`<text>--------------------------------&#10;</text>`);
  p.push(`<text>${esc(col("Invoice:", invoice.name))}&#10;</text>`);
  p.push(`<text>${esc(col("Customer:", invoice.customer_name ?? invoice.customer ?? ""))}&#10;</text>`);
  p.push(`<text>${esc(col("Date:", formatDate(invoice.posting_date ?? invoice.creation)))}&#10;</text>`);
  if (paymentEntry) p.push(`<text>${esc(col("Payment:", paymentEntry))}&#10;</text>`);
  p.push(`<text>--------------------------------&#10;</text>`);
  for (const item of invoice.items ?? []) {
    p.push(`<text>${esc(col(item.item_name ?? item.item_code ?? "Item", money(item.amount ?? item.net_amount)))}&#10;</text>`);
  }
  p.push(`<text>--------------------------------&#10;</text>`);
  p.push(`<text width="1" height="2" bold="true">${esc(col("TOTAL", money(invoice.grand_total)))}&#10;</text>`);
  p.push(`<text>${esc(col("Outstanding:", money(invoice.outstanding_amount)))}&#10;</text>`);
  p.push(`<text align="center">Thank you!&#10;</text>`);
  p.push(`<feed line="3"/>`);
  p.push(`<cut type="feed"/>`);
  p.push(`</epos-print>`);
  return p.join("\n");
}

function buildCustomOrderXml(order: any): string {
  const p: string[] = [];
  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`);
  p.push(`<text align="center" font="font_a" width="2" height="2">L&amp;S Custom Tailors&#10;</text>`);
  p.push(`<text align="center">CUSTOM ORDER TICKET&#10;</text>`);
  p.push(`<text>--------------------------------&#10;</text>`);
  p.push(`<text>${esc(col("Order:", order.name))}&#10;</text>`);
  p.push(`<text>${esc(col("Customer:", order.customer_name ?? order.customer ?? ""))}&#10;</text>`);
  p.push(`<text>${esc(col("Date:", formatDate(order.transaction_date ?? order.creation)))}&#10;</text>`);
  p.push(`<text>${esc(col("Delivery:", formatDate(order.delivery_date)))}&#10;</text>`);
  p.push(`<text>${esc(col("Status:", order.status ?? ""))}&#10;</text>`);
  p.push(`<text>--------------------------------&#10;</text>`);
  for (const item of order.items ?? []) {
    p.push(`<text bold="true">${esc(item.item_name ?? item.item_code ?? "Custom Item")}&#10;</text>`);
    p.push(`<text>${esc(col("  Qty", String(item.qty ?? 1)))}&#10;</text>`);
    p.push(`<text>${esc(col("  Amount", money(item.amount ?? item.net_amount ?? item.rate)))}&#10;</text>`);
  }
  p.push(`<text>--------------------------------&#10;</text>`);
  p.push(`<text width="1" height="2" bold="true">${esc(col("TOTAL", money(order.grand_total)))}&#10;</text>`);
  p.push(`<text>${esc(col("Advance:", money(order.advance_paid)))}&#10;</text>`);
  p.push(`<text>${esc(col("Balance:", money(Number(order.grand_total ?? 0) - Number(order.advance_paid ?? 0))))}&#10;</text>`);
  p.push(`<feed line="3"/>`);
  p.push(`<cut type="feed"/>`);
  p.push(`</epos-print>`);
  return p.join("\n");
}

function buildPaymentLinkXml(input: { url: string; invoice: string; amount: number; customer_name: string }): string {
  const p: string[] = [];
  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`);
  p.push(`<text align="center" font="font_a" width="2" height="2">L&amp;S Tailors&#10;</text>`);
  p.push(`<text align="center">PAYMENT LINK&#10;</text>`);
  p.push(`<text>--------------------------------&#10;</text>`);
  p.push(`<text>${esc(col("Invoice:", input.invoice))}&#10;</text>`);
  p.push(`<text>${esc(col("Customer:", input.customer_name))}&#10;</text>`);
  p.push(`<text>${esc(col("Amount:", money(input.amount)))}&#10;</text>`);
  p.push(`<text>&#10;</text>`);
  p.push(`<symbol align="center" type="qrcode_model_2" level="level_m" width="7" height="7" size="0">${esc(input.url)}</symbol>`);
  p.push(`<text>&#10;</text>`);
  p.push(`<text align="center">Scan to pay securely&#10;</text>`);
  p.push(`<text align="center">${esc(input.url)}&#10;</text>`);
  p.push(`<feed line="3"/>`);
  p.push(`<cut type="feed"/>`);
  p.push(`</epos-print>`);
  return p.join("\n");
}

async function printXml(
  config: PrintConfig,
  xml: string,
  meta: { ticket?: string | null; invoice?: string | null; print_type: PrintType },
) {
  let bytes = 0;
  try {
    bytes = await sendXml(xml, config);
    await logPrint({ ...meta, status: "Success", bytes_sent: bytes, printer_ip: config.printer_ip });
    return { ok: true, bytes };
  } catch (e) {
    const error = e instanceof Error ? e.message : "Print failed";
    await logPrint({ ...meta, status: "Failed", bytes_sent: bytes, error, printer_ip: config.printer_ip });
    return { ok: false, error };
  }
}

printRouter.get("/config", async (c) => {
  try {
    return c.json(await getPrintConfig());
  } catch (e) {
    const error = e instanceof Error ? e.message : "Could not load print config";
    return c.json({ ok: false, error });
  }
});

printRouter.post("/ticket", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as { ticket_name?: string } | null;
  if (!body?.ticket_name) return c.json({ ok: false, error: "ticket_name is required" });

  try {
    const config = await getPrintConfig();
    const ticket = await erpGet<any>("Alteration Ticket", body.ticket_name);
    if (ticket) {
      return c.json(await printXml(config, buildTicketXml(ticket), {
        ticket: body.ticket_name,
        print_type: "Ticket",
      }));
    }

    const customOrder = await erpGet<any>("Sales Order", body.ticket_name);
    if (!customOrder) {
      await logPrint({
        ticket: body.ticket_name,
        print_type: "Ticket",
        status: "Failed",
        bytes_sent: 0,
        error: "Ticket not found",
        printer_ip: config.printer_ip,
      });
      return c.json({ ok: false, error: "Ticket not found" });
    }

    return c.json(await printXml(config, buildCustomOrderXml(customOrder), {
      invoice: body.ticket_name,
      print_type: "Ticket",
    }));
  } catch (e) {
    const error = e instanceof Error ? e.message : "Print failed";
    return c.json({ ok: false, error });
  }
});

printRouter.post("/receipt", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    invoice?: string;
    payment_entry?: string;
  } | null;
  if (!body?.invoice) return c.json({ ok: false, error: "invoice is required" });

  try {
    const config = await getPrintConfig();
    const invoice = await erpGet<any>("Sales Invoice", body.invoice);
    if (!invoice) {
      await logPrint({
        invoice: body.invoice,
        print_type: "Receipt",
        status: "Failed",
        bytes_sent: 0,
        error: "Invoice not found",
        printer_ip: config.printer_ip,
      });
      return c.json({ ok: false, error: "Invoice not found" });
    }

    return c.json(await printXml(config, buildInvoiceReceiptXml(invoice, body.payment_entry), {
      invoice: body.invoice,
      print_type: "Receipt",
    }));
  } catch (e) {
    const error = e instanceof Error ? e.message : "Receipt print failed";
    return c.json({ ok: false, error });
  }
});

printRouter.post("/payment-link", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as {
    url?: string;
    invoice?: string;
    amount?: number;
    customer_name?: string;
  } | null;
  if (!body?.url || !body.invoice) {
    return c.json({ ok: false, error: "url and invoice are required" });
  }

  try {
    const config = await getPrintConfig();
    return c.json(await printXml(
      config,
      buildPaymentLinkXml({
        url: body.url,
        invoice: body.invoice,
        amount: Number(body.amount ?? 0),
        customer_name: body.customer_name ?? "",
      }),
      { invoice: body.invoice, print_type: "PaymentLink" },
    ));
  } catch (e) {
    const error = e instanceof Error ? e.message : "Payment link print failed";
    return c.json({ ok: false, error });
  }
});

// Backward-compatible tag printing endpoint used by the garment tag page.
printRouter.post("/tags", async (c) => {
  const user = await getAuthedUser(c);
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401);

  const body = (await c.req.json().catch(() => null)) as { ticket_name?: string } | null;
  if (!body?.ticket_name) return c.json({ ok: false, error: "ticket_name is required" });

  try {
    const config = await getPrintConfig();
    const ticket = await erpGet<any>("Alteration Ticket", body.ticket_name);
    if (!ticket) return c.json({ ok: false, error: "Ticket not found" });

    return c.json(await printXml(config, buildTagsXml(ticket, config.app_base_url), {
      ticket: body.ticket_name,
      print_type: "Tags",
    }));
  } catch (e) {
    const error = e instanceof Error ? e.message : "Tag print failed";
    return c.json({ ok: false, error });
  }
});
