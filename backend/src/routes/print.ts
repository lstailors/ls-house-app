// Thermal printer proxy — forwards ePOS-Print XML to an Epson TM-M30II
// on the local network. Avoids browser CORS/mixed-content blocks.
//
// Set EPSON_PRINTER_IP in environment (e.g. 192.168.1.50).
// The printer must be on the same network as this server OR reachable via IP.

import { Hono } from "hono";
import { getAuthedUser } from "../lib/scope.js";

export const printRouter = new Hono();

// ── Helpers ───────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

// Pad a string to fixed width (for receipt column alignment)
function col(left: string, right: string, width = 42): string {
  const l = left.slice(0, width - right.length - 1)
  const pad = width - l.length - right.length
  return l + " ".repeat(Math.max(pad, 1)) + right
}

function centerLine(text: string, width = 42): string {
  const pad = Math.max(0, Math.floor((width - text.length) / 2))
  return " ".repeat(pad) + text
}

// Build ePOS-Print XML for a customer receipt
function buildReceiptXml(data: ReceiptData): string {
  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`<?xml version="1.0" encoding="utf-8"?>`)
  push(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`)

  // Header
  push(`<text align="center" font="font_a" width="2" height="2">L&amp;S Custom Tailors&#10;</text>`)
  push(`<text align="center" font="font_a" width="1" height="1">${esc(data.location)}&#10;</text>`)
  push(`<text>--------------------------------&#10;</text>`)

  // Ticket info
  push(`<text align="left">`)
  push(`${esc(col("Ticket:", data.ticketName))}&#10;`)
  push(`${esc(col("Customer:", data.customerName))}&#10;`)
  if (data.customerPhone) push(`${esc(col("Phone:", data.customerPhone))}&#10;`)
  push(`${esc(col("Date:", data.ticketDate))}&#10;`)
  push(`${esc(col("Due:", data.dueDate + (data.isRush ? " ** RUSH **" : "")))}&#10;`)
  if (data.deliveryMethod) push(`${esc(col("Delivery:", data.deliveryMethod))}&#10;`)
  push(`</text>`)
  push(`<text>--------------------------------&#10;</text>`)

  // Line items grouped by garment
  for (const g of data.garments) {
    push(`<text font="font_a" bold="true">${esc(g.type)}${g.color ? " - " + esc(g.color) : ""} (${esc(g.id)})&#10;</text>`)
    for (const l of g.lines) {
      const lineText = col("  " + l.description, "$" + l.price.toFixed(2))
      push(`<text>${esc(lineText)}&#10;</text>`)
    }
  }

  push(`<text>--------------------------------&#10;</text>`)

  // Total
  push(`<text font="font_a" width="1" height="2" bold="true">${esc(col("TOTAL", "$" + data.total.toFixed(2)))}&#10;</text>`)
  push(`<text width="1" height="1">${esc(col("Payment:", data.paymentStatus))}&#10;</text>`)

  // Notes
  if (data.customerNotes) {
    push(`<text>--------------------------------&#10;</text>`)
    push(`<text>${esc(data.customerNotes)}&#10;</text>`)
  }

  push(`<text>--------------------------------&#10;</text>`)
  push(`<text align="center">Thank you for choosing&#10;L&amp;S Custom Tailors&#10;</text>`)
  push(`<feed line="3"/>`)
  push(`<cut type="feed"/>`)
  push(`</epos-print>`)

  return lines.join("\n")
}

// Build ePOS-Print XML for garment tags (one per garment, with QR code)
function buildTagsXml(data: TagsData): string {
  const lines: string[] = []
  const push = (s: string) => lines.push(s)

  push(`<?xml version="1.0" encoding="utf-8"?>`)
  push(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`)

  for (const g of data.garments) {
    const tagUrl = `${data.appBaseUrl}/garments/${data.ticketName}/${g.id}`

    if (data.isRush) {
      push(`<text align="center" font="font_a" width="2" height="2" bold="true">** RUSH **&#10;</text>`)
    }

    push(`<text align="center" font="font_a" width="1" height="1">${esc(data.ticketName)}&#10;</text>`)
    push(`<text align="center" font="font_a" width="1" height="2" bold="true">${esc(data.customerName)}&#10;</text>`)
    push(`<text align="center" width="1" height="1">${esc(g.type)}${g.color ? " - " + esc(g.color) : ""}&#10;</text>`)
    push(`<text align="center">ID: ${esc(g.id)}&#10;</text>`)
    push(`<text>&#10;</text>`)

    // QR code
    push(`<symbol align="center" type="qrcode_model_2" level="level_m" width="6" height="6" size="0">${esc(tagUrl)}</symbol>`)
    push(`<text>&#10;</text>`)

    // Alteration lines
    if (g.lines.length > 0) {
      push(`<text align="left">`)
      for (const l of g.lines) {
        push(`${esc("  " + l.description)}&#10;`)
      }
      push(`</text>`)
    }

    push(`<text align="center">Due: ${esc(g.dueDate)} | ${esc(data.location)}&#10;</text>`)
    push(`<feed line="2"/>`)
    push(`<cut type="feed"/>`)
  }

  push(`</epos-print>`)
  return lines.join("\n")
}

// ── Types ─────────────────────────────────────────────────────────────────

interface ReceiptData {
  ticketName: string
  customerName: string
  customerPhone?: string
  location: string
  ticketDate: string
  dueDate: string
  isRush: boolean
  deliveryMethod?: string
  paymentStatus: string
  customerNotes?: string
  total: number
  garments: Array<{
    id: string
    type: string
    color?: string
    lines: Array<{ description: string; price: number }>
  }>
}

interface TagsData {
  ticketName: string
  customerName: string
  location: string
  isRush: boolean
  appBaseUrl: string
  garments: Array<{
    id: string
    type: string
    color?: string
    dueDate: string
    lines: Array<{ description: string }>
  }>
}

// ── Send to printer ───────────────────────────────────────────────────────

async function sendToEpson(xml: string): Promise<void> {
  const ip = process.env.EPSON_PRINTER_IP
  if (!ip) throw new Error("EPSON_PRINTER_IP not configured")

  const url = `http://${ip}/cgi-bin/epos/service.cgi`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": '""',
    },
    body: xml,
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) throw new Error(`Printer returned HTTP ${res.status}`)
  const body = await res.text()
  if (body.includes('success="false"')) {
    const code = body.match(/code="([^"]+)"/)?.[1] ?? "unknown"
    throw new Error(`Printer error: ${code}`)
  }
}

// ── Routes ────────────────────────────────────────────────────────────────

// GET /api/print/status — check if printer IP is configured and reachable
printRouter.get("/status", async (c) => {
  const user = await getAuthedUser(c)
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401)

  const ip = process.env.EPSON_PRINTER_IP
  if (!ip) return c.json({ data: { configured: false, reachable: false } })

  try {
    const res = await fetch(`http://${ip}/cgi-bin/epos/service.cgi`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    })
    return c.json({ data: { configured: true, reachable: res.status < 500, ip } })
  } catch {
    return c.json({ data: { configured: true, reachable: false, ip } })
  }
})

// POST /api/print/receipt
printRouter.post("/receipt", async (c) => {
  const user = await getAuthedUser(c)
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401)

  const data = await c.req.json() as ReceiptData

  try {
    const xml = buildReceiptXml(data)
    await sendToEpson(xml)
    return c.json({ data: { printed: true } })
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502)
  }
})

// POST /api/print/tags
printRouter.post("/tags", async (c) => {
  const user = await getAuthedUser(c)
  if (!user) return c.json({ error: { message: "Unauthorized" } }, 401)

  const data = await c.req.json() as TagsData

  try {
    const xml = buildTagsXml(data)
    await sendToEpson(xml)
    return c.json({ data: { printed: true, count: data.garments.length } })
  } catch (e: any) {
    return c.json({ error: { message: e.message } }, 502)
  }
})
