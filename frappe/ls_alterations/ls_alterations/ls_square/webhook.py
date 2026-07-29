# -*- coding: utf-8 -*-
"""
ls_square/webhook.py  --  Square -> ERPNext payment webhook.

Flow:
  1. Verify HMAC signature against the raw body (reject if bad).
  2. Record the event idempotently. The doctype's name IS the Square
     event_id, so a duplicate delivery hits a unique-key collision and
     is acknowledged without re-processing -> duplicate payments blocked.
  3. Resolve the Sales Invoice from the checkout reference_id / payment.
  4. Validate (exists, submitted, not already paid, amount sane).
  5. Post a Payment Entry against the invoice (Mode of Payment = Square,
     reference_no = Square payment_id -> second-line duplicate guard).
  6. Reconcile the Alteration Ticket (payment_status, square ids, paid_at).
  7. Print a payment receipt to the TM-M30ii.
  8. Log everything to "Square Webhook Event".

Return codes: 200 for any handled outcome (processed/duplicate/ignored/
validation-failed) so Square stops retrying; 500 only on genuinely transient
errors so Square's own retry kicks in.
"""

import json

import frappe
from frappe.utils import now_datetime, nowdate, flt

from . import client

HANDLED_EVENTS = ("payment.updated", "payment.created",
                  "terminal.checkout.updated")


def _resp(status_code, body):
    frappe.local.response["http_status_code"] = status_code
    return body


@frappe.whitelist(allow_guest=True)
def receive():
    """Public endpoint Square POSTs to. Registered as the notification URL."""
    raw = frappe.request.get_data() if frappe.request else b""
    sig = frappe.get_request_header("x-square-hmacsha256-signature")

    if not client.verify_signature(raw, sig):
        return _resp(401, {"ok": False, "error": "bad signature"})

    try:
        body = json.loads(raw.decode("utf-8") if isinstance(raw, bytes) else raw)
    except Exception:
        return _resp(400, {"ok": False, "error": "bad json"})

    event_id = body.get("event_id") or frappe.generate_hash(length=24)
    event_type = body.get("type", "")

    # --- idempotent record (DB-level duplicate block) -------------------
    try:
        ev = frappe.get_doc({
            "doctype": "Square Webhook Event",
            "event_id": event_id,
            "event_type": event_type,
            "status": "Received",
            "attempts": 1,
            "payload": json.dumps(body, indent=2)[:90000],
        })
        ev.insert(ignore_permissions=True)
        frappe.db.commit()
    except frappe.DuplicateEntryError:
        return _resp(200, {"ok": True, "status": "duplicate", "event_id": event_id})
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Square event record failed")
        # transient -> let Square retry
        return _resp(500, {"ok": False, "error": "record failed"})

    if event_type not in HANDLED_EVENTS:
        _finish(ev, "Ignored", detail="unhandled type {}".format(event_type))
        return _resp(200, {"ok": True, "status": "ignored"})

    try:
        outcome = _process(ev, body)
        return _resp(200, {"ok": True, "status": outcome, "event_id": event_id})
    except _Transient as ex:
        _finish(ev, "Failed", detail="transient: {}".format(ex), bump=True)
        _alert_failed(ev, "transient: {}".format(ex))
        return _resp(500, {"ok": False, "error": "transient"})
    except Exception as ex:
        _finish(ev, "Failed", detail="{}: {}".format(type(ex).__name__, ex), bump=True)
        frappe.log_error(frappe.get_traceback(), "Square webhook processing failed")
        _alert_failed(ev, "{}: {}".format(type(ex).__name__, ex))
        return _resp(200, {"ok": False, "status": "failed"})


class _Transient(Exception):
    """Raise for errors worth a Square retry (DB lock, printer-independent)."""


# ---------------------------------------------------------------------------
# Processing
# ---------------------------------------------------------------------------

def _process(ev, body):
    obj = (body.get("data") or {}).get("object") or {}

    payment_id = None
    checkout_id = None
    order_id = None
    reference_id = None
    amount_cents = None
    completed = False

    if "payment" in obj:
        p = obj["payment"]
        payment_id = p.get("id")
        order_id = p.get("order_id")
        reference_id = p.get("reference_id")
        completed = (p.get("status") == "COMPLETED")
        amount_cents = (p.get("amount_money") or {}).get("amount")
    elif "checkout" in obj:
        c = obj["checkout"]
        checkout_id = c.get("id")
        reference_id = c.get("reference_id")
        completed = (c.get("status") == "COMPLETED")
        amount_cents = (c.get("amount_money") or {}).get("amount")
        pmt_ids = c.get("payment_ids") or []
        payment_id = pmt_ids[0] if pmt_ids else None

    ev.db_set("payment_id", payment_id, update_modified=False)
    ev.db_set("checkout_id", checkout_id, update_modified=False)
    ev.db_set("order_id", order_id, update_modified=False)
    if amount_cents is not None:
        ev.db_set("amount", flt(amount_cents) / 100.0, update_modified=False)

    if not completed:
        _finish(ev, "Ignored", detail="status not COMPLETED")
        return "ignored"

    # resolve invoice: reference_id (terminal) -> mapping -> prior event
    invoice = _resolve_invoice(reference_id, payment_id, order_id, checkout_id)
    if not invoice:
        # HER-63 policy: Register/POS tenders outside our mint path have no
        # Square Checkout map and can never auto-resolve. Do NOT count those
        # as Failed bugs — park as Ignored for the daily manual reconcile sweep.
        # True fails = we *had* a reference/map hint and still couldn't resolve.
        detail = "no invoice for ref={} order={} pay={}".format(
            reference_id, order_id, payment_id)
        if not reference_id and not order_id and not checkout_id:
            _finish(ev, "Ignored", detail="unmapped_outside_mint_path: " + detail)
            return "ignored_unmapped"
        if not reference_id:
            # payment-link / POS with order but no SC map — same policy bucket
            mapped = False
            if order_id and frappe.db.exists("Square Checkout", {"order_id": order_id}):
                mapped = True
            if checkout_id and frappe.db.exists("Square Checkout", {"checkout_id": checkout_id}):
                mapped = True
            if not mapped:
                _finish(ev, "Ignored", detail="unmapped_outside_mint_path: " + detail)
                return "ignored_unmapped"
        _finish(ev, "Failed", detail=detail)
        _alert_failed(ev, detail)
        return "failed"
    ev.db_set("invoice", invoice, update_modified=False)

    # mark the mapping completed (best-effort)
    _close_mapping(invoice, order_id, checkout_id, payment_id)

    amount = flt(amount_cents) / 100.0 if amount_cents is not None else None
    result = _apply_payment(ev, invoice, payment_id, amount)
    return result


def _resolve_invoice(reference_id, payment_id, order_id=None, checkout_id=None):
    # 1) terminal checkout carries our invoice name as reference_id
    if reference_id and frappe.db.exists("Sales Invoice", reference_id):
        return reference_id
    # 2) Square Checkout mapping (covers payment-link / phone QR flow)
    for field, val in (("order_id", order_id), ("checkout_id", checkout_id)):
        if val:
            inv = frappe.db.get_value("Square Checkout", {field: val}, "invoice")
            if inv:
                return inv
    # 3) a prior event for this payment already mapped the invoice
    if payment_id:
        inv = frappe.db.get_value(
            "Square Webhook Event", {"payment_id": payment_id, "invoice": ["!=", ""]},
            "invoice")
        if inv:
            return inv
    return None


def _close_mapping(invoice, order_id, checkout_id, payment_id):
    try:
        name = None
        for field, val in (("order_id", order_id), ("checkout_id", checkout_id)):
            if val:
                name = frappe.db.get_value("Square Checkout", {field: val}, "name")
                if name:
                    break
        if not name:
            name = frappe.db.get_value(
                "Square Checkout", {"invoice": invoice, "status": "Created"}, "name")
        if name:
            frappe.db.set_value("Square Checkout", name, {
                "status": "Completed", "payment_id": payment_id}, update_modified=True)
            frappe.db.commit()
    except Exception:
        pass  # mapping is convenience, never block the payment


def _apply_payment(ev, invoice, payment_id, amount):
    s = client.get_settings()
    tol = flt(s.amount_tolerance or 0.02)

    # payment-level duplicate guard
    if payment_id and frappe.db.exists(
            "Payment Entry", {"reference_no": payment_id, "docstatus": 1}):
        _finish(ev, "Duplicate", detail="payment_id already posted")
        return "duplicate"

    inv = frappe.get_doc("Sales Invoice", invoice)
    if inv.docstatus != 1:
        _finish(ev, "Failed", detail="invoice not submitted (docstatus={})".format(
            inv.docstatus))
        return "failed"

    outstanding = flt(inv.outstanding_amount)
    if outstanding <= tol:
        _finish(ev, "Ignored", detail="invoice already settled")
        return "ignored"

    if amount is None:
        amount = outstanding
    if amount - outstanding > tol:
        _finish(ev, "Failed", detail="overpayment: paid {} vs outstanding {}".format(
            amount, outstanding))
        return "failed"

    try:
        pe = _make_payment_entry(s, inv, payment_id, amount)
    except Exception as ex:
        msg = str(ex)
        if "Deadlock" in msg or "Lock wait" in msg or "try restarting" in msg:
            raise _Transient(msg)
        raise

    ev.db_set("payment_entry", pe.name, update_modified=False)
    _reconcile_ticket(invoice, payment_id, amount)

    # receipt print (never let a down printer fail the payment)
    if s.auto_print_receipt:
        try:
            import ls_alterations.ls_thermal.api as thermal_api
            thermal_api.print_payment_receipt(invoice)
        except Exception as ex:
            frappe.log_error(frappe.get_traceback(), "Square receipt print failed")
            ev.db_set("error", "receipt print: {}".format(ex)[:1000],
                      update_modified=False)

    _finish(ev, "Processed")
    return "processed"


def _make_payment_entry(s, inv, payment_id, amount):
    from erpnext.accounts.doctype.payment_entry.payment_entry import get_payment_entry
    pe = get_payment_entry("Sales Invoice", inv.name)
    pe.mode_of_payment = s.mode_of_payment or "Square"
    # force the Square ledger account for this company
    paid_to = frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": pe.mode_of_payment, "company": pe.company},
        "default_account")
    if paid_to:
        pe.paid_to = paid_to
    pe.reference_no = payment_id or "SQUARE"
    pe.reference_date = nowdate()
    # allocate exactly the amount Square captured
    pe.paid_amount = amount
    pe.received_amount = amount
    if pe.references:
        pe.references[0].allocated_amount = amount
    pe.flags.ignore_permissions = True
    pe.insert()
    pe.submit()
    frappe.db.commit()
    return pe


def _reconcile_ticket(invoice, payment_id, amount):
    tickets = frappe.get_all("Alteration Ticket",
                             filters={"sales_invoice": invoice}, pluck="name")
    for tname in tickets:
        outstanding = flt(frappe.db.get_value(
            "Sales Invoice", invoice, "outstanding_amount"))
        status = "Paid" if outstanding <= 0.02 else "Partially Paid"
        frappe.db.set_value("Alteration Ticket", tname, {
            "payment_status": status,
            "square_transaction_id": payment_id,
            "square_payment_method": "Card Present",
            "paid_at": now_datetime() if status == "Paid" else None,
        }, update_modified=True)
    frappe.db.commit()


def _finish(ev, status, detail=None, bump=False):
    vals = {"status": status, "processed_at": now_datetime()}
    if detail:
        vals["error"] = (detail or "")[:1000]
    if bump:
        vals["attempts"] = (ev.attempts or 1) + 1
    for k, v in vals.items():
        ev.db_set(k, v, update_modified=False)
    frappe.db.commit()


def _alert_failed(ev, detail):
    """
    HER-63 P0-1: surface reconciliation failures immediately.
    - Always Error Log with a greppable title
    - Optional Slack incoming webhook via site_config square_failed_slack_webhook
      or env SQUARE_FAILED_SLACK_WEBHOOK
    Never raises — alert must not break the webhook response path.
    """
    try:
        title = "SQUARE RECON FAILED event={0} type={1}".format(
            getattr(ev, "name", None) or getattr(ev, "event_id", "?"),
            getattr(ev, "event_type", "") or "",
        )
        body = (
            "status=Failed\n"
            "event_id={event_id}\n"
            "payment_id={payment_id}\n"
            "checkout_id={checkout_id}\n"
            "order_id={order_id}\n"
            "invoice={invoice}\n"
            "amount={amount}\n"
            "detail={detail}\n"
            "reprocess: ls_alterations.ls_square.webhook.reprocess "
            "with event_id={event_id}\n"
        ).format(
            event_id=getattr(ev, "event_id", None) or getattr(ev, "name", ""),
            payment_id=getattr(ev, "payment_id", "") or "",
            checkout_id=getattr(ev, "checkout_id", "") or "",
            order_id=getattr(ev, "order_id", "") or "",
            invoice=getattr(ev, "invoice", "") or "",
            amount=getattr(ev, "amount", "") or "",
            detail=(detail or "")[:500],
        )
        frappe.log_error(body, title)

        import os
        webhook = None
        try:
            webhook = frappe.conf.get("square_failed_slack_webhook")
        except Exception:
            webhook = None
        if not webhook:
            webhook = os.environ.get("SQUARE_FAILED_SLACK_WEBHOOK") or os.environ.get(
                "SLACK_WEBHOOK_URL"
            )
        if webhook:
            try:
                import urllib.request
                payload = json.dumps({
                    "text": ":rotating_light: *{0}*\n```{1}```".format(title, body[:1800]),
                }).encode("utf-8")
                req = urllib.request.Request(
                    webhook,
                    data=payload,
                    headers={"Content-Type": "application/json"},
                    method="POST",
                )
                urllib.request.urlopen(req, timeout=5).read()
            except Exception:
                pass
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Manual reprocess (for Failed events, callable from the form / MCP)
# ---------------------------------------------------------------------------

@frappe.whitelist()
def reprocess(event_id):
    """Re-run processing for a Failed/Received event after fixing the cause."""
    ev = frappe.get_doc("Square Webhook Event", event_id)
    if ev.status in ("Processed", "Duplicate"):
        return {"ok": True, "status": ev.status.lower(), "note": "already final"}
    body = json.loads(ev.payload or "{}")
    try:
        outcome = _process(ev, body)
        return {"ok": outcome in ("processed", "duplicate", "ignored", "ignored_unmapped"),
                "status": outcome}
    except Exception as ex:
        _finish(ev, "Failed", detail="{}: {}".format(type(ex).__name__, ex), bump=True)
        _alert_failed(ev, str(ex))
        return {"ok": False, "status": "failed", "error": str(ex)}


@frappe.whitelist()
def reprocess_failed(limit=25):
    """
    HER-63 P0-1 batch reprocess path.
    Replays recent Failed Square Webhook Events (oldest first).
    Does NOT invent invoices — only retries resolution + PE post.
    """
    limit = int(limit or 25)
    names = frappe.get_all(
        "Square Webhook Event",
        filters={"status": "Failed"},
        pluck="name",
        order_by="creation asc",
        limit_page_length=limit,
    )
    results = []
    for name in names:
        try:
            results.append({"event": name, **reprocess(name)})
        except Exception as ex:
            results.append({"event": name, "ok": False, "error": str(ex)})
    ok_n = sum(1 for r in results if r.get("ok"))
    return {"ok": True, "attempted": len(results), "succeeded": ok_n, "results": results}


@frappe.whitelist()
def list_unmapped_for_manual_sweep(limit=50):
    """
    Daily reconcile sweep feed: Ignored events tagged unmapped_outside_mint_path
    plus legacy Failed 'no invoice' rows (pre-policy). Manual booking only.
    """
    limit = int(limit or 50)
    rows = frappe.get_all(
        "Square Webhook Event",
        filters={"status": ["in", ["Ignored", "Failed"]]},
        fields=[
            "name", "event_id", "event_type", "status", "payment_id",
            "order_id", "checkout_id", "amount", "error", "creation",
        ],
        order_by="creation desc",
        limit_page_length=200,
    )
    out = []
    for r in rows:
        err = (r.get("error") or "")
        if "unmapped_outside_mint_path" in err or err.startswith("no invoice for ref="):
            out.append(r)
        if len(out) >= limit:
            break
    return {"ok": True, "count": len(out), "events": out}
