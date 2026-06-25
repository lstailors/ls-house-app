# -*- coding: utf-8 -*-
"""
ls_square/pos.py  --  Scan-to-pay: resolve a scanned master QR to a Sales
Invoice and push a Terminal Checkout to the Square device.

IMPORTANT (how the scan actually works): the Square Terminal's own camera
does not call back into ERPNext for arbitrary QR codes. The scan is done by
the iPad / L&S House app (or any scanner pointed at a lookup page), which
calls create_checkout() here. ERPNext then drives the terminal via the
Square Terminal Checkout API, and the customer taps their card. The webhook
(webhook.py) closes the loop. reference_id on the checkout = the invoice name,
so the webhook can reconcile it.
"""

import frappe
from frappe.utils import flt

from . import client


def _invoice_from_code(code):
    """
    Accepts: a Sales Invoice name, an Alteration Ticket name, or a URL whose
    last path segment is one of those (e.g. https://app.lstailors.com/pay/INV
    or /t/ALT-NYC-2026-00417). Returns a submitted Sales Invoice name.
    """
    code = (code or "").strip().rstrip("/")
    token = code.split("/")[-1] if "/" in code else code

    # direct invoice
    if frappe.db.exists("Sales Invoice", token):
        return token
    # ticket -> its linked invoice
    if frappe.db.exists("Alteration Ticket", token):
        inv = frappe.db.get_value("Alteration Ticket", token, "sales_invoice")
        if not inv:
            frappe.throw("Ticket {} has no Sales Invoice yet".format(token))
        return inv
    frappe.throw("Could not resolve scanned code: {}".format(token))


def _ticket_for_invoice(invoice):
    return frappe.db.get_value("Alteration Ticket", {"sales_invoice": invoice}, "name")


def _record(invoice, kind, amount, **ids):
    """Persist a Square Checkout mapping so the webhook can reconcile."""
    doc = frappe.get_doc({
        "doctype": "Square Checkout",
        "invoice": invoice,
        "ticket": _ticket_for_invoice(invoice),
        "kind": kind,
        "amount": amount,
        "status": "Created",
        "checkout_id": ids.get("checkout_id"),
        "order_id": ids.get("order_id"),
        "payment_link_id": ids.get("payment_link_id"),
        "url": ids.get("url"),
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return doc


@frappe.whitelist()
def create_checkout(code=None, invoice=None, ticket=None):
    """
    TERMINAL flow: resolve to an invoice and push a Terminal Checkout for the
    outstanding amount. Pass either `code` (scanned QR text), `invoice`, or
    `ticket`.
    """
    if invoice:
        inv_name = invoice
    elif ticket:
        inv_name = frappe.db.get_value("Alteration Ticket", ticket, "sales_invoice")
        if not inv_name:
            frappe.throw("Ticket {} has no Sales Invoice yet".format(ticket))
    else:
        inv_name = _invoice_from_code(code)

    inv = frappe.get_doc("Sales Invoice", inv_name)
    if inv.docstatus != 1:
        frappe.throw("Invoice {} is not submitted/finalized yet".format(inv_name))

    outstanding = flt(inv.outstanding_amount)
    if outstanding <= 0:
        return {"ok": False, "status": "already_paid", "invoice": inv_name}

    amount_cents = int(round(outstanding * 100))
    checkout = client.create_terminal_checkout(
        amount_cents=amount_cents,
        reference_id=inv_name,
        note="L&S {} - {}".format(inv_name, inv.customer_name or inv.customer),
    )
    _record(inv_name, "Terminal", outstanding,
            checkout_id=checkout.get("id"))
    return {
        "ok": True,
        "status": "pushed_to_terminal",
        "method": "terminal",
        "invoice": inv_name,
        "amount": outstanding,
        "checkout_id": checkout.get("id"),
        "checkout_status": checkout.get("status"),
    }


@frappe.whitelist()
def create_payment_link(code=None, invoice=None, ticket=None):
    """
    PAY-BY-SQUARE flow: create a Square-hosted checkout link for the
    outstanding amount. The returned `url` is rendered as a QR the customer
    scans with their phone (or printed via ls_thermal.api.print_pay_link).
    """
    if invoice:
        inv_name = invoice
    elif ticket:
        inv_name = frappe.db.get_value("Alteration Ticket", ticket, "sales_invoice")
        if not inv_name:
            frappe.throw("Ticket {} has no Sales Invoice yet".format(ticket))
    else:
        inv_name = _invoice_from_code(code)

    inv = frappe.get_doc("Sales Invoice", inv_name)
    if inv.docstatus != 1:
        frappe.throw("Invoice {} is not submitted/finalized yet".format(inv_name))

    outstanding = flt(inv.outstanding_amount)
    if outstanding <= 0:
        return {"ok": False, "status": "already_paid", "invoice": inv_name}

    amount_cents = int(round(outstanding * 100))
    link = client.create_payment_link(
        amount_cents=amount_cents,
        reference_id=inv_name,
        name="L&S Invoice {}".format(inv_name),
        note="{} - {}".format(inv_name, inv.customer_name or inv.customer),
    )
    url = link.get("url") or link.get("long_url")
    _record(inv_name, "Payment Link", outstanding,
            order_id=link.get("order_id"),
            payment_link_id=link.get("id"), url=url)
    return {
        "ok": True,
        "status": "link_created",
        "method": "qr",
        "invoice": inv_name,
        "amount": outstanding,
        "url": url,
        "payment_link_id": link.get("id"),
        "order_id": link.get("order_id"),
    }


@frappe.whitelist()
def checkout_status(checkout_id):
    """Poll a terminal checkout (e.g. to show progress on the iPad)."""
    c = client.get_terminal_checkout(checkout_id)
    return {"status": c.get("status"), "payment_ids": c.get("payment_ids") or []}
