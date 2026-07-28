# -*- coding: utf-8 -*-
"""
api.py  --  Frappe glue for L&S thermal printing.

Whitelisted entry points called by the Alteration Ticket form button
(client script) and/or the MCP server. Reads printer config from the
"LSH Print Settings" single doctype, builds the ESC/POS job with
escpos_tm, ships it to the TM-M30ii on :9100, and writes an
"LSH Print Log" row for every attempt (success or failure).

Recommended location:
    <your_app>/<your_app>/ls_thermal/__init__.py   (empty)
    <your_app>/<your_app>/ls_thermal/escpos_tm.py
    <your_app>/<your_app>/ls_thermal/api.py
Whitelisted dotted path then looks like:
    <your_app>.ls_thermal.api.print_ticket
"""

import frappe
from frappe import _

try:
    from . import escpos_tm
except ImportError:  # allows flat placement / direct import during testing
    import escpos_tm


# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------

def _settings():
    """Return printer config with safe fallbacks if the single isn't filled."""
    try:
        s = frappe.get_cached_doc("LSH Print Settings")
    except Exception:
        s = None
    return {
        "enabled": (s.enabled if s else 1),
        "host": (s.thermal_printer_ip if s and s.thermal_printer_ip else None),
        "port": int(s.thermal_printer_port) if s and s.thermal_printer_port else 9100,
        "timeout": float(s.thermal_timeout) if s and s.thermal_timeout else 5.0,
        "base_url": (s.app_base_url if s and s.app_base_url
                     else "https://app.lstailors.com").rstrip("/"),
        # Optional: if the Frappe container can't reach the printer's LAN IP,
        # add a "print_bridge_url" Data field to LSH Print Settings pointing at
        # the Mac host bridge (e.g. http://host.docker.internal:8088/print).
        # When set, jobs POST there instead of opening a raw socket.
        "bridge_url": (getattr(s, "print_bridge_url", None) if s else None),
    }


def _transport(cfg, payload):
    """Send bytes either via the host bridge (if configured) or raw socket."""
    if cfg.get("bridge_url"):
        import urllib.request
        req = urllib.request.Request(
            cfg["bridge_url"], data=payload,
            headers={"Content-Type": "application/octet-stream"})
        with urllib.request.urlopen(req, timeout=cfg["timeout"]) as resp:
            resp.read()
        return len(payload)
    return escpos_tm.send(cfg["host"], payload, port=cfg["port"],
                          timeout=cfg["timeout"])


def _log(ticket, copy_type, target, status, detail=""):
    try:
        frappe.get_doc({
            "doctype": "LSH Print Log",
            "ticket": ticket,
            "copy_type": copy_type,
            "target": target,
            "status": status,
            "detail": (detail or "")[:1000],
            "printed_by": frappe.session.user,
        }).insert(ignore_permissions=True)
        frappe.db.commit()
    except Exception:
        # never let logging failure mask the real outcome
        frappe.log_error(frappe.get_traceback(), "LSH Print Log insert failed")


def _ticket_payload_context(doc, cfg):
    """Build print payload. Attach alteration lines under each garment so tags
    and office copies show the actual work — not just 'Jacket'."""
    base = cfg["base_url"]
    # Index lines by garment_ref (G1 / garment_id)
    by_ref = {}
    for ln in (doc.lines or []):
        ref = (ln.get("garment_ref") or "").strip()
        if not ref:
            continue
        by_ref.setdefault(ref, []).append({
            "description": ln.get("description") or "",
            "price": ln.get("price") or 0,
        })

    garments = []
    for g in (doc.garments or []):
        gid = g.get("garment_id") or ""
        work = list(by_ref.get(gid) or [])
        # Also match if line.ref used child row name
        gname = g.get("name") or ""
        if gname and gname in by_ref:
            work = work or list(by_ref[gname])
        garments.append({
            "garment_id": gid,
            "garment_type": g.get("garment_type"),
            "color": g.get("color"),
            "garment_description": g.get("garment_description"),
            "garment_total": g.get("garment_total"),
            "lines": work,
        })
    return base, garments


def _master_qr(doc, base):
    """
    Master receipt QR. If the ticket already has a finalized Sales Invoice,
    embed it as a pay URL (/pay/{invoice}) so the same QR drives the Square
    terminal checkout. Otherwise fall back to the ticket lookup (/t/{ticket}).
    """
    if getattr(doc, "sales_invoice", None):
        return "{}/pay/{}".format(base, doc.sales_invoice)
    return "{}/t/{}".format(base, doc.name)


def _send(cfg, ticket, copy_type, target, payload):
    """Send one job, log the result, return a per-job result dict."""
    if not cfg["host"] and not cfg.get("bridge_url"):
        _log(ticket, copy_type, target, "Failed", "No printer IP / bridge configured")
        return {"ok": False, "target": target,
                "error": "No printer IP / bridge configured"}
    try:
        n = _transport(cfg, payload)
        _log(ticket, copy_type, target, "Printed", "{} bytes".format(n))
        return {"ok": True, "target": target, "bytes": n}
    except Exception as ex:
        msg = "{}: {}".format(type(ex).__name__, ex)
        _log(ticket, copy_type, target, "Failed", msg)
        return {"ok": False, "target": target, "error": msg}


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def print_ticket(ticket, what="all"):
    """
    what:
      all      -> office copy + customer copy + one tag per garment
      receipts -> office copy + customer copy
      customer -> customer copy only
      office   -> office copy only
      tags     -> one tag per garment
    """
    cfg = _settings()
    if not cfg["enabled"]:
        frappe.throw(_("Thermal printing is disabled in LSH Print Settings."))

    doc = frappe.get_doc("Alteration Ticket", ticket)
    base, garments = _ticket_payload_context(doc, cfg)
    results = []

    def office():
        payload = escpos_tm.build_office_receipt(
            ticket=doc.name, customer_name=doc.customer_name,
            customer_phone=doc.customer_phone, garments=garments,
            ticket_total=doc.ticket_total,
            qr_url=_master_qr(doc, base),
            ticket_date=doc.ticket_date, due_date=doc.due_date,
            promised_date=doc.promised_date, is_rush=doc.is_rush,
            location=doc.origin_location, internal_notes=doc.internal_notes)
        results.append(_send(cfg, doc.name, "office", doc.name, payload))

    def customer():
        payload = escpos_tm.build_customer_receipt(
            ticket=doc.name, customer_name=doc.customer_name,
            customer_phone=doc.customer_phone, garments=garments,
            ticket_total=doc.ticket_total,
            qr_url=_master_qr(doc, base),
            ticket_date=doc.ticket_date, due_date=doc.due_date,
            promised_date=doc.promised_date, is_rush=doc.is_rush,
            location=doc.origin_location, customer_notes=doc.customer_notes)
        results.append(_send(cfg, doc.name, "customer", doc.name, payload))

    def tags():
        total = len(garments)
        for i, g in enumerate(garments, start=1):
            payload = escpos_tm.build_garment_tag(
                ticket=doc.name, garment=g,
                qr_url="{}/g/{}/{}".format(base, doc.name, g.get("garment_id")),
                due_date=doc.promised_date or doc.due_date, is_rush=doc.is_rush,
                location=doc.origin_location, idx=i, total=total,
                lines=g.get("lines") or [])
            results.append(_send(cfg, doc.name, "garment",
                                 g.get("garment_id"), payload))

    if what == "all":
        office(); customer(); tags()
    elif what == "receipts":
        office(); customer()
    elif what == "customer":
        customer()
    elif what == "office":
        office()
    elif what == "tags":
        tags()
    else:
        frappe.throw(_("Unknown print target: {0}").format(what))

    ok = all(r["ok"] for r in results) if results else False
    return {"ok": ok, "ticket": doc.name, "jobs": results}


@frappe.whitelist()
def print_garment(ticket, garment_id):
    """Reprint a single garment tag by its garment_id."""
    cfg = _settings()
    if not cfg["enabled"]:
        frappe.throw(_("Thermal printing is disabled in LSH Print Settings."))
    doc = frappe.get_doc("Alteration Ticket", ticket)
    base, garments = _ticket_payload_context(doc, cfg)
    match = next((g for g in garments if g.get("garment_id") == garment_id), None)
    if not match:
        frappe.throw(_("Garment {0} not found on {1}").format(garment_id, ticket))
    payload = escpos_tm.build_garment_tag(
        ticket=doc.name, garment=match,
        qr_url="{}/g/{}/{}".format(base, doc.name, garment_id),
        due_date=doc.promised_date or doc.due_date, is_rush=doc.is_rush,
        location=doc.origin_location, lines=match.get("lines") or [])
    res = _send(cfg, doc.name, "garment", garment_id, payload)
    return {"ok": res["ok"], "ticket": doc.name, "jobs": [res]}


@frappe.whitelist()
def test_printer():
    """Fire a tiny diagnostic slip to confirm connectivity + cut."""
    cfg = _settings()
    payload = escpos_tm.INIT
    payload += escpos_tm.line("L&S PRINTER TEST", bold=True,
                              align=escpos_tm.ALIGN_CENTER, size=escpos_tm.SIZE_2H)
    payload += escpos_tm.line(frappe.utils.now(), align=escpos_tm.ALIGN_CENTER)
    payload += escpos_tm.ALIGN_CENTER + escpos_tm.qr(
        cfg["base_url"], module_size=6) + escpos_tm.ALIGN_LEFT
    payload += escpos_tm.feed(1) + escpos_tm.CUT
    return _send(cfg, "—", "test", cfg["host"] or "unset", payload)


@frappe.whitelist()
def print_payment_receipt(invoice):
    """Print a payment receipt for a Sales Invoice (called after Square pays)."""
    cfg = _settings()
    inv = frappe.get_doc("Sales Invoice", invoice)
    ticket = frappe.db.get_value(
        "Alteration Ticket", {"sales_invoice": invoice}, "name")
    pay_ref = None
    if ticket:
        pay_ref = frappe.db.get_value(
            "Alteration Ticket", ticket, "square_transaction_id")
    total = inv.grand_total
    outstanding = inv.outstanding_amount
    amount_paid = (total or 0) - (outstanding or 0)
    qr_url = ("{}/t/{}".format(cfg["base_url"], ticket) if ticket
              else "{}/inv/{}".format(cfg["base_url"], invoice))
    payload = escpos_tm.build_payment_receipt(
        invoice=invoice, customer_name=inv.customer_name or inv.customer,
        amount_paid=amount_paid, total=total, outstanding=outstanding,
        payment_ref=pay_ref, method="Card", paid_on=frappe.utils.nowdate(),
        qr_url=qr_url, ticket=ticket)
    res = _send(cfg, ticket or invoice, "payment", invoice, payload)
    return {"ok": res["ok"], "invoice": invoice, "jobs": [res]}


@frappe.whitelist()
def print_pay_link(invoice=None, ticket=None):
    """Create a Square payment link and print a 'Scan to Pay' slip for it."""
    cfg = _settings()
    import ls_alterations.ls_square.pos as pos
    res = pos.create_payment_link(invoice=invoice, ticket=ticket)
    if not res.get("ok"):
        return res
    inv_name = res["invoice"]
    inv = frappe.get_doc("Sales Invoice", inv_name)
    tname = ticket or frappe.db.get_value(
        "Alteration Ticket", {"sales_invoice": inv_name}, "name")
    payload = escpos_tm.build_pay_qr(
        invoice=inv_name, customer_name=inv.customer_name or inv.customer,
        amount=res["amount"], url=res["url"], ticket=tname)
    out = _send(cfg, tname or inv_name, "payment", inv_name, payload)
    return {"ok": out["ok"], "invoice": inv_name, "url": res["url"], "jobs": [out]}
