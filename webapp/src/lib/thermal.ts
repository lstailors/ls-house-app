// Epson TM-M30II thermal printer — client-side ePOS-Print XML
//
// Uses HTTPS to the printer to avoid iOS mixed-content blocking.
// The TM-M30II has a built-in HTTPS endpoint with a self-signed cert.
// One-time setup: visit https://PRINTER_IP in Safari and tap "Visit Website"
// to trust the self-signed cert. After that, fetch() to https://PRINTER_IP works.

export const PRINTER_IP_KEY = "lst_printer_ip"

export function getPrinterIp(): string {
  return localStorage.getItem(PRINTER_IP_KEY) ?? "10.0.1.41"
}

export function setPrinterIp(ip: string): void {
  localStorage.setItem(PRINTER_IP_KEY, ip.trim())
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function col(left: string, right: string, width = 42): string {
  const l = left.slice(0, width - right.length - 1)
  const pad = width - l.length - right.length
  return l + " ".repeat(Math.max(pad, 1)) + right
}

// ── Send raw XML to printer ───────────────────────────────────────────────

export async function sendToEpson(xml: string, ip?: string): Promise<void> {
  const printerIp = ip ?? getPrinterIp()
  if (!printerIp) throw new Error("No printer IP set. Add it in Settings.")

  // Use HTTPS — the TM-M30II has a built-in HTTPS endpoint.
  // User must visit https://PRINTER_IP once in Safari to trust the self-signed cert.
  const url = `https://${printerIp}/cgi-bin/epos/service.cgi`

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "SOAPAction": '""',
    },
    body: xml,
    signal: AbortSignal.timeout(8000),
  })

  if (!res.ok) throw new Error(`Printer returned HTTP ${res.status}. Make sure you've trusted the certificate at https://${printerIp} in Safari.`)
}

// ── Receipt XML ───────────────────────────────────────────────────────────

export interface ReceiptData {
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

export function buildReceiptXml(data: ReceiptData): string {
  const lines: string[] = []
  const p = (s: string) => lines.push(s)

  p(`<?xml version="1.0" encoding="utf-8"?>`)
  p(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`)

  p(`<text align="center" font="font_a" width="2" height="2">L&amp;S Custom Tailors&#10;</text>`)
  p(`<text align="center" font="font_a" width="1" height="1">${esc(data.location)}&#10;</text>`)
  p(`<text>--------------------------------&#10;</text>`)

  p(`<text align="left">`)
  p(`${esc(col("Ticket:", data.ticketName))}&#10;`)
  p(`${esc(col("Customer:", data.customerName))}&#10;`)
  if (data.customerPhone) p(`${esc(col("Phone:", data.customerPhone))}&#10;`)
  p(`${esc(col("Date:", data.ticketDate))}&#10;`)
  p(`${esc(col("Due:", data.dueDate + (data.isRush ? " ** RUSH **" : "")))}&#10;`)
  if (data.deliveryMethod) p(`${esc(col("Delivery:", data.deliveryMethod))}&#10;`)
  p(`</text>`)
  p(`<text>--------------------------------&#10;</text>`)

  for (const g of data.garments) {
    p(`<text bold="true">${esc(g.type)}${g.color ? " - " + esc(g.color) : ""} (${esc(g.id)})&#10;</text>`)
    for (const l of g.lines) {
      p(`<text>${esc(col("  " + l.description, "$" + l.price.toFixed(2)))}&#10;</text>`)
    }
  }

  p(`<text>--------------------------------&#10;</text>`)
  p(`<text font="font_a" width="1" height="2" bold="true">${esc(col("TOTAL", "$" + data.total.toFixed(2)))}&#10;</text>`)
  p(`<text width="1" height="1">${esc(col("Payment:", data.paymentStatus))}&#10;</text>`)

  if (data.customerNotes) {
    p(`<text>--------------------------------&#10;</text>`)
    p(`<text>${esc(data.customerNotes)}&#10;</text>`)
  }

  p(`<text>--------------------------------&#10;</text>`)
  p(`<text align="center">Thank you for choosing&#10;L&amp;S Custom Tailors&#10;</text>`)
  p(`<feed line="3"/>`)
  p(`<cut type="feed"/>`)
  p(`</epos-print>`)

  return lines.join("\n")
}

// ── Tags XML ─────────────────────────────────────────────────────────────

export interface TagsData {
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

export function buildTagsXml(data: TagsData): string {
  const lines: string[] = []
  const p = (s: string) => lines.push(s)

  p(`<?xml version="1.0" encoding="utf-8"?>`)
  p(`<epos-print xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print">`)

  for (const g of data.garments) {
    const tagUrl = `${data.appBaseUrl}/garments/${data.ticketName}/${g.id}`

    if (data.isRush) {
      p(`<text align="center" width="2" height="2" bold="true">** RUSH **&#10;</text>`)
    }
    p(`<text align="center">${esc(data.ticketName)}&#10;</text>`)
    p(`<text align="center" width="1" height="2" bold="true">${esc(data.customerName)}&#10;</text>`)
    p(`<text align="center" width="1" height="1">${esc(g.type)}${g.color ? " - " + esc(g.color) : ""}&#10;</text>`)
    p(`<text align="center">ID: ${esc(g.id)}&#10;</text>`)
    p(`<text>&#10;</text>`)
    p(`<symbol align="center" type="qrcode_model_2" level="level_m" width="6" height="6" size="0">${esc(tagUrl)}</symbol>`)
    p(`<text>&#10;</text>`)

    if (g.lines.length > 0) {
      p(`<text align="left">`)
      for (const l of g.lines) p(`${esc("  " + l.description)}&#10;`)
      p(`</text>`)
    }

    p(`<text align="center">Due: ${esc(g.dueDate)} | ${esc(data.location)}&#10;</text>`)
    p(`<feed line="2"/>`)
    p(`<cut type="feed"/>`)
  }

  p(`</epos-print>`)
  return lines.join("\n")
}
