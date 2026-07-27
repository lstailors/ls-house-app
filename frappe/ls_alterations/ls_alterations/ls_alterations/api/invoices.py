# Copyright (c) 2026, L&S Custom Tailors and contributors
# Client invoice communications — same rails for SI desk + alterations.

import frappe
from frappe.utils import flt, nowdate


@frappe.whitelist()
def mark_invoice_paid(invoice_name, square_payment_id="", payment_method="Card"):
    inv = frappe.get_doc("Sales Invoice", invoice_name)
    if inv.docstatus != 1:
        return {"success": False, "error": "Invoice must be submitted first"}
    if inv.outstanding_amount <= 0:
        return {"success": False, "error": "Invoice already fully paid"}
    try:
        from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

        pe = get_payment_entry("Sales Invoice", invoice_name)
        pe.reference_no = square_payment_id or ("SQ-" + nowdate())
        pe.reference_date = nowdate()
        pe.remarks = "Paid via " + payment_method + (
            " — Square " + square_payment_id if square_payment_id else ""
        )
        pe.insert(ignore_permissions=True)
        pe.submit()
        if square_payment_id:
            frappe.db.set_value(
                "Sales Invoice", invoice_name, "lsh_square_payment_id", square_payment_id
            )
        frappe.db.commit()
        return {"success": True, "payment_entry": pe.name}
    except Exception as e:
        frappe.db.rollback()
        return {"success": False, "error": str(e)[:300]}


@frappe.whitelist()
def collect_deposit(sales_order, amount, square_payment_id="", payment_method="Card"):
    so = frappe.get_doc("Sales Order", sales_order)
    if so.docstatus != 1:
        return {"success": False, "error": "Sales Order must be submitted"}
    try:
        from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry

        pe = get_payment_entry("Sales Order", sales_order, party_amount=float(amount))
        pe.reference_no = square_payment_id or ("DEP-" + nowdate())
        pe.reference_date = nowdate()
        pe.remarks = "Deposit via " + payment_method + (
            " — Square " + square_payment_id if square_payment_id else ""
        )
        pe.insert(ignore_permissions=True)
        pe.submit()
        if square_payment_id:
            frappe.db.set_value(
                "Sales Order", sales_order, "lsh_square_payment_id", square_payment_id
            )
        frappe.db.commit()
        return {"success": True, "payment_entry": pe.name, "amount": float(amount)}
    except Exception as e:
        frappe.db.rollback()
        return {"success": False, "error": str(e)[:300]}


def ensure_invoice_ready_for_pay(invoice_name):
    """Submit SI if draft, mint Square payment link, set app pay URL.

    Returns the Sales Invoice doc (reloaded) or raises.
    """
    inv = frappe.get_doc("Sales Invoice", invoice_name)
    if inv.docstatus == 2:
        frappe.throw("Invoice {0} is cancelled".format(invoice_name))

    if inv.docstatus == 0:
        from frappe.utils import getdate, today

        # Stale alteration drafts often fail party due-date rules when posting is
        # backdated and due is in the past relative to "today". Normalize.
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
        inv = frappe.get_doc("Sales Invoice", invoice_name)

    app_pay = "https://app.lstailors.com/pay/{0}".format(inv.name)
    if not inv.get("lsh_invoice_web_url"):
        try:
            frappe.db.set_value(
                "Sales Invoice",
                inv.name,
                "lsh_invoice_web_url",
                app_pay,
                update_modified=False,
            )
        except Exception:
            pass

    pay_url = (inv.get("lsh_square_payment_link") or "").strip()
    if not pay_url and flt(inv.outstanding_amount) > 0:
        try:
            from ls_alterations.ls_square.pos import create_payment_link

            result = create_payment_link(invoice=inv.name)
            pay_url = (result or {}).get("url") or ""
            if pay_url:
                frappe.db.set_value(
                    "Sales Invoice",
                    inv.name,
                    "lsh_square_payment_link",
                    pay_url,
                    update_modified=False,
                )
        except Exception:
            frappe.log_error(
                frappe.get_traceback(), "ensure_invoice_ready_for_pay square link"
            )

    frappe.db.commit()
    return frappe.get_doc("Sales Invoice", invoice_name)


def _customer_email(customer):
    if not customer:
        return None
    email = frappe.db.get_value("Customer", customer, "email_id")
    if email:
        return email
    # Primary contact
    contact = frappe.db.get_value(
        "Dynamic Link",
        {"link_doctype": "Customer", "link_name": customer, "parenttype": "Contact"},
        "parent",
    )
    if contact:
        return frappe.db.get_value("Contact", contact, "email_id")
    return None


def _customer_phone(customer, fallback=None):
    if fallback:
        return fallback
    if not customer:
        return None
    phone = frappe.db.get_value("Customer", customer, "mobile_no") or frappe.db.get_value(
        "Customer", customer, "phone"
    )
    return phone


def _render_invoice_email(inv):
    """Render locked L&S Invoice Email V4 against the SI doc dict."""
    from frappe.email.doctype.email_template.email_template import get_email_template

    doc = inv.as_dict()
    # Harden context (same as Desk Client Script)
    doc["outstanding_amount"] = flt(inv.outstanding_amount)
    doc["grand_total"] = flt(inv.grand_total)
    doc["status"] = inv.status or ""
    doc["lsh_square_payment_link"] = inv.get("lsh_square_payment_link") or ""
    doc["lsh_invoice_web_url"] = inv.get("lsh_invoice_web_url") or (
        "https://app.lstailors.com/pay/{0}".format(inv.name)
    )
    rendered = get_email_template("L&S Invoice Email", doc, sender="concierge@lstailors.com")
    return rendered.get("subject"), rendered.get("message")


def _send_email(inv, subject, html, recipients):
    if not recipients or not html:
        return {"ok": False, "error": "missing recipients or html"}
    if isinstance(recipients, (list, tuple)):
        recipients = ", ".join([r for r in recipients if r])
    try:
        from frappe.core.doctype.communication.email import make

        result = make(
            doctype="Sales Invoice",
            name=inv.name,
            content=html,
            subject=subject,
            sender="concierge@lstailors.com",
            recipients=recipients,
            send_email=1,
            print_format=None,
            read_receipt=0,
            send_me_a_copy=0,
        )
        return {"ok": True, "communication": (result or {}).get("name")}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "send_client_invoice_comms email")
        return {"ok": False, "error": str(e)[:300]}


def _send_sms_v5(inv, phone, client_name=None):
    """Three-bubble SMS matching SI desk path (iOS link cards)."""
    if not phone:
        return {"ok": False, "error": "no phone", "sids": []}

    from lsh_house.sms import already_notified, send_customer_sms

    # Idempotent: skip if intro already sent for this invoice
    if already_notified("Sales Invoice", inv.name, "invoice_pay_link"):
        return {"ok": True, "skipped": True, "reason": "already_sent", "sids": []}

    first = (client_name or inv.customer_name or "there").strip().split()[0]
    amt = flt(inv.outstanding_amount or inv.grand_total)
    amt_s = "{0:.2f}".format(amt)
    app_pay = inv.get("lsh_invoice_web_url") or "https://app.lstailors.com/pay/{0}".format(
        inv.name
    )
    square = (inv.get("lsh_square_payment_link") or "").strip() or app_pay

    bubbles = [
        (
            "Hi {first}, Sofia from L&S Custom Tailors. Your invoice {inv} for ${amt} is ready.".format(
                first=first, inv=inv.name, amt=amt_s
            ),
            "invoice_pay_link",
        ),
        (app_pay, "invoice_view_link"),
        (square, "invoice_square_pay"),
    ]
    sids = []
    errors = []
    for body, tag in bubbles:
        res = send_customer_sms(
            phone=phone,
            message=body,
            customer=inv.customer,
            reference_doctype="Sales Invoice",
            reference_name=inv.name,
            context_tag=tag,
            client_name=client_name or inv.customer_name,
        )
        if res and res.get("twilio_sid"):
            sids.append(res.get("twilio_sid"))
        if res and not res.get("ok"):
            errors.append(res.get("error_message") or tag)
    return {"ok": not errors or bool(sids), "sids": sids, "errors": errors}


@frappe.whitelist()
def send_client_invoice_comms(
    invoice=None,
    ticket=None,
    email=None,
    phone=None,
    send_email=1,
    send_sms=1,
):
    """Same client treatment as SI desk path: V4 email + SMS v5 multi-bubble.

    Accepts Sales Invoice name and/or Alteration Ticket name.
    Ensures SI is submitted and has a Square pay link before sending.
    """
    send_email = int(send_email or 0)
    send_sms = int(send_sms or 0)

    inv_name = invoice
    ticket_phone = None
    ticket_name = ticket
    if ticket and not inv_name:
        inv_name = frappe.db.get_value("Alteration Ticket", ticket, "sales_invoice")
        ticket_phone = frappe.db.get_value("Alteration Ticket", ticket, "customer_phone")
    if not inv_name:
        frappe.throw("invoice or ticket with linked Sales Invoice is required")

    inv = ensure_invoice_ready_for_pay(inv_name)

    # Skip non-receivable
    if flt(inv.outstanding_amount) <= 0 and inv.status == "Paid":
        return {
            "ok": True,
            "skipped": True,
            "reason": "already_paid",
            "invoice": inv.name,
        }

    recipients = email or _customer_email(inv.customer)
    sms_phone = phone or ticket_phone or _customer_phone(inv.customer)

    out = {
        "ok": True,
        "invoice": inv.name,
        "square_payment_link": inv.get("lsh_square_payment_link"),
        "app_pay_url": inv.get("lsh_invoice_web_url")
        or "https://app.lstailors.com/pay/{0}".format(inv.name),
        "email": None,
        "sms": None,
    }

    if send_email and recipients:
        subject, html = _render_invoice_email(inv)
        out["email"] = _send_email(inv, subject, html, recipients)
        out["email_to"] = recipients
    elif send_email:
        out["email"] = {"ok": False, "error": "no_email"}

    if send_sms and sms_phone:
        out["sms"] = _send_sms_v5(inv, sms_phone, client_name=inv.customer_name)
        out["sms_to"] = sms_phone
    elif send_sms:
        out["sms"] = {"ok": False, "error": "no_phone"}

    # Stamp ticket if provided
    if ticket_name and out.get("square_payment_link"):
        # no dedicated field on ticket — payment lives on SI
        pass

    return out


@frappe.whitelist()
def prepare_alteration_invoice(ticket):
    """Submit linked SI + mint Square link for an alteration ticket. No send."""
    inv_name = frappe.db.get_value("Alteration Ticket", ticket, "sales_invoice")
    if not inv_name:
        frappe.throw("Ticket {0} has no Sales Invoice".format(ticket))
    inv = ensure_invoice_ready_for_pay(inv_name)
    return {
        "ok": True,
        "invoice": inv.name,
        "status": inv.status,
        "outstanding_amount": flt(inv.outstanding_amount),
        "square_payment_link": inv.get("lsh_square_payment_link"),
        "app_pay_url": inv.get("lsh_invoice_web_url")
        or "https://app.lstailors.com/pay/{0}".format(inv.name),
    }
