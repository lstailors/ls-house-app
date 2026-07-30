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


def _open_checkout(invoice, kind):
    """
    HER-63 P0-3: at most one open Checkout per invoice+kind.
    Prefer newest Created row that still has a usable id/url.
    """
    rows = frappe.get_all(
        "Square Checkout",
        filters={"invoice": invoice, "kind": kind, "status": "Created"},
        fields=[
            "name",
            "amount",
            "url",
            "checkout_id",
            "order_id",
            "payment_link_id",
            "creation",
        ],
        order_by="creation desc",
        limit_page_length=20,
    )
    if not rows:
        return None
    if kind == "Payment Link":
        for r in rows:
            if r.get("url"):
                return r
        return rows[0]
    # Terminal: need a checkout_id still in flight
    for r in rows:
        if r.get("checkout_id"):
            return r
    return rows[0]


def _resolve_invoice(code=None, invoice=None, ticket=None):
    if invoice:
        return invoice
    if ticket:
        inv_name = frappe.db.get_value("Alteration Ticket", ticket, "sales_invoice")
        if not inv_name:
            frappe.throw("Ticket {} has no Sales Invoice yet".format(ticket))
        return inv_name
    return _invoice_from_code(code)


def _ensure_invoice_submitted(inv):
    """Submit draft SI so Terminal / pay-link can run (legacy alts were draft-until-pickup)."""
    if inv.docstatus == 1:
        return inv
    if inv.docstatus == 2:
        frappe.throw("Invoice {} is cancelled".format(inv.name))
    if flt(inv.grand_total) <= 0:
        frappe.throw("Invoice {} has no amount to charge".format(inv.name))

    # Stale drafts often fail party due-date rules when posting is backdated.
    from frappe.utils import getdate, today

    tod = getdate(today())
    post = getdate(inv.posting_date) if inv.posting_date else tod
    due = getdate(inv.due_date) if inv.due_date else post
    if due < post:
        due = post
    if post < tod or due < tod:
        post = tod
        due = tod
        inv.set_posting_time = 1
    inv.posting_date = post
    inv.due_date = due
    for s in inv.payment_schedule or []:
        s.due_date = due
    inv.flags.ignore_permissions = True
    inv.save()
    inv.submit()
    inv.reload()
    return inv


@frappe.whitelist()
def create_checkout(code=None, invoice=None, ticket=None):
    """
    TERMINAL flow: resolve to an invoice and push a Terminal Checkout for the
    outstanding amount. Pass either `code` (scanned QR text), `invoice`, or
    `ticket`.

    HER-63 P0-3: reuse an open Terminal Square Checkout when present.
    Auto-submits draft alteration invoices so intake can charge immediately.
    """
    inv_name = _resolve_invoice(code=code, invoice=invoice, ticket=ticket)

    inv = frappe.get_doc("Sales Invoice", inv_name)
    inv = _ensure_invoice_submitted(inv)

    outstanding = flt(inv.outstanding_amount)
    if outstanding <= 0:
        return {"ok": False, "status": "already_paid", "invoice": inv_name}

    existing = _open_checkout(inv_name, "Terminal")
    if existing and existing.get("checkout_id"):
        return {
            "ok": True,
            "status": "reused_open_checkout",
            "method": "terminal",
            "invoice": inv_name,
            "amount": flt(existing.get("amount") or outstanding),
            "checkout_id": existing.get("checkout_id"),
            "square_checkout": existing.get("name"),
            "reused": True,
        }

    amount_cents = int(round(outstanding * 100))
    checkout = client.create_terminal_checkout(
        amount_cents=amount_cents,
        reference_id=inv_name,
        note="L&S {} - {}".format(inv_name, inv.customer_name or inv.customer),
    )
    sc = _record(inv_name, "Terminal", outstanding,
                 checkout_id=checkout.get("id"))
    return {
        "ok": True,
        "status": "pushed_to_terminal",
        "method": "terminal",
        "invoice": inv_name,
        "amount": outstanding,
        "checkout_id": checkout.get("id"),
        "checkout_status": checkout.get("status"),
        "square_checkout": sc.name,
        "reused": False,
    }


@frappe.whitelist()
def create_payment_link(code=None, invoice=None, ticket=None):
    """
    PAY-BY-SQUARE flow: create a Square-hosted checkout link for the
    outstanding amount. The returned `url` is rendered as a QR the customer
    scans with their phone (or printed via ls_thermal.api.print_pay_link).

    HER-63 P0-3: reuse the newest open Payment Link for this invoice instead
    of minting a new Square idempotency key every call.

    Auto-submits draft invoices (legacy alts created SI as draft until pickup)
    so pay links work the moment a billable ticket exists.
    """
    inv_name = _resolve_invoice(code=code, invoice=invoice, ticket=ticket)

    inv = frappe.get_doc("Sales Invoice", inv_name)
    inv = _ensure_invoice_submitted(inv)

    outstanding = flt(inv.outstanding_amount)
    if outstanding <= 0:
        return {"ok": False, "status": "already_paid", "invoice": inv_name}

    # Prefer link already on the SI
    prior = (getattr(inv, "lsh_square_payment_link", None) or "").strip()
    if prior.startswith("http"):
        return {
            "ok": True,
            "status": "reused_si_field",
            "method": "qr",
            "invoice": inv_name,
            "amount": outstanding,
            "url": prior,
            "reused": True,
        }

    existing = _open_checkout(inv_name, "Payment Link")
    if existing and existing.get("url"):
        # Keep SI field in sync with the open mapped link
        try:
            if hasattr(inv, "lsh_square_payment_link"):
                if inv.lsh_square_payment_link != existing.get("url"):
                    frappe.db.set_value(
                        "Sales Invoice",
                        inv_name,
                        "lsh_square_payment_link",
                        existing.get("url"),
                        update_modified=False,
                    )
                    frappe.db.commit()
        except Exception:
            pass
        return {
            "ok": True,
            "status": "reused_open_link",
            "method": "qr",
            "invoice": inv_name,
            "amount": flt(existing.get("amount") or outstanding),
            "url": existing.get("url"),
            "payment_link_id": existing.get("payment_link_id"),
            "order_id": existing.get("order_id"),
            "square_checkout": existing.get("name"),
            "reused": True,
        }

    amount_cents = int(round(outstanding * 100))
    link = client.create_payment_link(
        amount_cents=amount_cents,
        reference_id=inv_name,
        name="L&S Invoice {}".format(inv_name),
        note="{} - {}".format(inv_name, inv.customer_name or inv.customer),
    )
    url = link.get("url") or link.get("long_url")
    sc = _record(inv_name, "Payment Link", outstanding,
                 order_id=link.get("order_id"),
                 payment_link_id=link.get("id"), url=url)
    try:
        if hasattr(inv, "lsh_square_payment_link") and url:
            frappe.db.set_value(
                "Sales Invoice",
                inv_name,
                "lsh_square_payment_link",
                url,
                update_modified=False,
            )
            frappe.db.commit()
    except Exception:
        pass
    return {
        "ok": True,
        "status": "link_created",
        "method": "qr",
        "invoice": inv_name,
        "amount": outstanding,
        "url": url,
        "payment_link_id": link.get("id"),
        "order_id": link.get("order_id"),
        "square_checkout": sc.name,
        "reused": False,
    }


@frappe.whitelist()
def checkout_status(checkout_id):
    """Poll a terminal checkout (e.g. to show progress on the iPad)."""
    c = client.get_terminal_checkout(checkout_id)
    return {"status": c.get("status"), "payment_ids": c.get("payment_ids") or []}


# ---------------------------------------------------------------------------
# Card on file (HER-79) — staff-confirm only, never auto-bill
# ---------------------------------------------------------------------------

def _erp_customer_for_invoice(inv):
    return inv.customer


def _resolve_square_customer_id(erp_customer):
    """Return Square customer id for an ERP Customer, linking if we can."""
    if not erp_customer:
        return None
    row = frappe.db.get_value(
        "Customer", erp_customer,
        ["square_customer_id", "mobile_no", "email_id", "customer_name"],
        as_dict=True,
    )
    if not row:
        return None
    sid = (row.get("square_customer_id") or "").strip()
    if sid:
        return sid

    # Try phone match against Square vault
    phone = row.get("mobile_no") or ""
    if not phone:
        # primary contact mobile
        contact = frappe.db.get_value("Customer", erp_customer, "customer_primary_contact")
        if contact:
            phone = frappe.db.get_value("Contact", contact, "mobile_no") or ""
    matches = client.search_customers_by_phone(phone) if phone else []
    if not matches:
        return None
    sid = matches[0].get("id")
    if sid:
        try:
            frappe.db.set_value("Customer", erp_customer, {
                "square_customer_id": sid,
                "last_square_sync_at": frappe.utils.now_datetime(),
            }, update_modified=False)
            frappe.db.commit()
        except Exception:
            pass
    return sid


def _sync_has_stored_card(erp_customer, cards):
    try:
        flag = 1 if cards else 0
        frappe.db.set_value(
            "Customer", erp_customer,
            {
                "has_stored_card": flag,
                "last_square_sync_at": frappe.utils.now_datetime(),
            },
            update_modified=False,
        )
        frappe.db.commit()
    except Exception:
        pass


def _card_expired(c):
    """Square leaves expired cards enabled=true; end of exp month is last valid."""
    try:
        m = int(c.get("exp_month") or 0)
        y = int(c.get("exp_year") or 0)
    except (TypeError, ValueError):
        return False
    if m < 1 or m > 12 or y < 1:
        return False
    today = frappe.utils.getdate()
    return y < today.year or (y == today.year and m < today.month)


def _card_public(c):
    expired = _card_expired(c)
    return {
        "id": c.get("id"),
        "brand": c.get("card_brand") or c.get("card_type") or "CARD",
        "last4": c.get("last_4") or "",
        "exp_month": c.get("exp_month"),
        "exp_year": c.get("exp_year"),
        "enabled": bool(c.get("enabled", True)),
        "expired": expired,
        "cardholder_name": c.get("cardholder_name") or "",
    }


@frappe.whitelist()
def list_cards(invoice=None, ticket=None, customer=None):
    """
    List vaulted Square cards for the customer on an invoice/ticket.
    Never charges. Staff picks a card in the UI, then calls charge_card_on_file.
    Does NOT require SI to be submitted — customer comes from ticket.
    """
    erp_customer = customer
    inv_name = None
    if not erp_customer and ticket:
        row = frappe.db.get_value(
            "Alteration Ticket", ticket,
            ["customer", "customer_name", "sales_invoice"], as_dict=True,
        )
        if not row:
            frappe.throw("Ticket {} not found".format(ticket))
        erp_customer = row.get("customer")
        inv_name = row.get("sales_invoice")
    if not erp_customer and invoice:
        inv_name = invoice
        erp_customer = frappe.db.get_value("Sales Invoice", invoice, "customer")
    if not erp_customer:
        return {"ok": False, "error": "no_customer", "cards": []}

    sq_id = _resolve_square_customer_id(erp_customer)
    if not sq_id:
        return {
            "ok": True,
            "customer": erp_customer,
            "square_customer_id": None,
            "invoice": inv_name,
            "cards": [],
            "message": "No Square customer linked for this client. Save a card in Square POS first, or match phone.",
        }

    cards = client.list_cards(sq_id)
    enabled = [c for c in cards if c.get("enabled", True)]
    public = [_card_public(c) for c in enabled]
    usable = [c for c in enabled if not _card_expired(c)]
    _sync_has_stored_card(erp_customer, usable)
    return {
        "ok": True,
        "customer": erp_customer,
        "square_customer_id": sq_id,
        "invoice": inv_name,
        "cards": public,
        "usable_count": len(usable),
        "expired_count": len(enabled) - len(usable),
        "message": (
            "Cards on file are expired. Update the card in Square POS, or use Terminal / Pay Link."
            if enabled and not usable
            else None
        ),
    }


@frappe.whitelist()
def charge_card_on_file(card_id, invoice=None, ticket=None, amount=None,
                        idempotency_key=None):
    """
    Staff-confirmed charge of a vaulted card against SI outstanding.
    NEVER called automatically from ticket create/submit.
    Amount defaults to full outstanding; partial allowed if amount provided.
    Draft SI is submitted on charge (same moment staff takes payment).
    """
    if not card_id:
        frappe.throw("card_id required")

    inv_name = _resolve_invoice(invoice=invoice, ticket=ticket)
    inv = frappe.get_doc("Sales Invoice", inv_name)
    if inv.docstatus == 0:
        inv.submit()
        inv.reload()
    if inv.docstatus != 1:
        frappe.throw("Invoice {} is not submitted".format(inv_name))

    outstanding = flt(inv.outstanding_amount)
    if outstanding <= 0:
        return {"ok": False, "status": "already_paid", "invoice": inv_name}

    charge_amt = flt(amount) if amount is not None else outstanding
    if charge_amt <= 0:
        frappe.throw("amount must be positive")
    if charge_amt - outstanding > 0.02:
        frappe.throw("amount {} exceeds outstanding {}".format(charge_amt, outstanding))

    erp_customer = inv.customer
    sq_id = _resolve_square_customer_id(erp_customer)
    if not sq_id:
        frappe.throw("Customer has no Square account linked")

    # Verify the card belongs to this Square customer
    cards = client.list_cards(sq_id)
    match = next((c for c in cards if c.get("id") == card_id and c.get("enabled", True)), None)
    if not match:
        frappe.throw("Card not found on customer's Square vault")
    if _card_expired(match):
        exp_m = match.get("exp_month")
        exp_y = match.get("exp_year")
        exp = "{:02d}/{}".format(int(exp_m or 0), str(exp_y or "")[-2:])
        frappe.throw(
            "Card ····{} expired {}. Update card in Square POS, or use Terminal / Pay Link.".format(
                match.get("last_4") or "", exp
            )
        )

    amount_cents = int(round(charge_amt * 100))
    key = idempotency_key or "cof-{}-{}-{}".format(
        inv_name, card_id[-8:], amount_cents)

    payment = client.create_card_payment(
        amount_cents=amount_cents,
        source_card_id=card_id,
        customer_id=sq_id,
        reference_id=inv_name,
        note="L&S COF {} - {}".format(inv_name, inv.customer_name or inv.customer),
        idempotency_key=key,
    )

    status = (payment.get("status") or "").upper()
    payment_id = payment.get("id")

    # Best-effort ticket method label (webhook will set payment_status)
    try:
        tname = _ticket_for_invoice(inv_name)
        if tname and payment_id:
            frappe.db.set_value(
                "Alteration Ticket", tname,
                {
                    "square_transaction_id": payment_id,
                    "square_payment_method": "Card on File",
                },
                update_modified=False,
            )
            frappe.db.commit()
    except Exception:
        pass

    return {
        "ok": status in ("COMPLETED", "APPROVED"),
        "status": status or "UNKNOWN",
        "method": "card_on_file",
        "invoice": inv_name,
        "amount": charge_amt,
        "payment_id": payment_id,
        "card": _card_public(match),
        "receipt_url": payment.get("receipt_url"),
    }
