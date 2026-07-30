"""
L&S Unified QR Scanner — resolver and action handlers.

Whitelisted entry point: ls_alterations.api.scanner.resolve_qr
All public methods decorated with @frappe.whitelist().

Return contract:
  Success: {"ok": True, "type": <str>, "doctype": <str>, "name": <str>,
            "title": <str>, "subtitle": <str>, "state": <str>,
            "actions": [<str>, ...], "meta": {…}}
  Failure: {"ok": False, "reason": <str>, "raw": <str>}
"""

from __future__ import annotations

import re
import traceback
from urllib.parse import urlparse, parse_qs

import frappe


# ── Constants ──────────────────────────────────────────────────────────────────

SQUARE_DOMAINS = {"squareup.com", "square.link", "checkout.square.site"}
DASHBOARD_DOMAINS = {"dashboard.lstailors.com", "delivered.lstailors.com"}
MY_DOMAIN = "my.lstailors.com"
ALTS_DOMAINS = {"alts.lstailors.com"}
APP_DOMAINS = {"app.lstailors.com", "my.lstailors.com"}

# Ordered prefix→type map (most-specific first)
PREFIX_TYPE_MAP = [
    (("SINV-", "ACC-SINV-", "ACC-SI-"), "sales_invoice", "Sales Invoice"),
    (("ALT-", "LS-ALT-"), "alteration_ticket", "Alteration Ticket"),
    (("DN-NYC-", "DN-HOU-", "DN-TX-"), "lsh_delivery", "LSH Delivery"),
    (("LST-",), "custom_order", "LSH Custom Order"),
    (("TAG-",), "garment_tag", None),
    (("CUST-",), "customer", "Customer"),
]


# ── Normalize ──────────────────────────────────────────────────────────────────

def normalize_token(raw: str) -> dict:
    """
    Strip URL wrappers and return a canonical token dict:
      {"token": str, "hint_type": str|None, "hint_name": str|None,
       "original_url": str|None}

    Handles:
      • dashboard.lstailors.com/scan/{token}          (path-style — prime bug)
      • dashboard.lstailors.com/scan?token={token}    (query-style)
      • delivered.lstailors.com/…                     (legacy)
      • my.lstailors.com/i/{name}?t={token}           (invoice URL)
      • squareup.com/…  square.link/…                 (Square pay link)
      • Bare token / doc name (no stripping needed)
    """
    raw = (raw or "").strip().rstrip("?&#")

    # Not a URL — return as-is
    if not raw.startswith(("http://", "https://")):
        return {"token": raw, "hint_type": None, "hint_name": None, "original_url": None}

    original_url = raw
    try:
        parsed = urlparse(raw)
        domain = parsed.netloc.lower().lstrip("www.")
        path = parsed.path.rstrip("/")
        qs = parse_qs(parsed.query)

        # Square pay URL → keep full URL for reverse-lookup
        if any(domain == d or domain.endswith("." + d) for d in SQUARE_DOMAINS):
            return {"token": raw, "hint_type": "payment_link", "hint_name": None,
                    "original_url": raw}

        # my.lstailors.com/i/{name}?t={token}
        if domain == MY_DOMAIN:
            m = re.match(r"^/i/([^/]+)$", path)
            if m:
                inv_name = m.group(1)
                t_vals = qs.get("t", [])
                tok = t_vals[0] if t_vals else inv_name
                return {"token": tok, "hint_type": "sales_invoice",
                        "hint_name": inv_name, "original_url": original_url}

        # alts.lstailors.com/g/{ticket}/{garmentId} — printed garment tags
        if any(domain == d or domain.endswith("." + d) for d in ALTS_DOMAINS):
            m = re.match(r"^/g/([^/]+)/([^/]+)$", path)
            if m:
                return {
                    "token": f"GPATH:{m.group(1)}/{m.group(2)}",
                    "hint_type": "garment_path",
                    "hint_name": None,
                    "original_url": original_url,
                    "ticket": m.group(1),
                    "garment_id": m.group(2),
                }
            m = re.match(r"^/pay/([^/]+)$", path)
            if m:
                return {"token": m.group(1), "hint_type": "sales_invoice",
                        "hint_name": m.group(1), "original_url": original_url}
            m = re.match(r"^/orders/alterations/([^/]+)$", path)
            if m:
                return {"token": m.group(1), "hint_type": "alteration_ticket",
                        "hint_name": m.group(1), "original_url": original_url}
            # Thermal / e-ticket QR: /t/{ALT-…} · /e-ticket/{ALT-…}
            m = re.match(r"^/(?:t|e-ticket)/([^/]+)$", path)
            if m:
                return {"token": m.group(1), "hint_type": "alteration_ticket",
                        "hint_name": m.group(1), "original_url": original_url}

        # app.lstailors.com/customers/{id} · /pay/{invoice}
        if any(domain == d or domain.endswith("." + d) for d in APP_DOMAINS):
            m = re.match(r"^/customers/([^/]+)$", path)
            if m and m.group(1).lower() != "new":
                return {"token": m.group(1), "hint_type": "customer",
                        "hint_name": m.group(1), "original_url": original_url}
            m = re.match(r"^/pay/([^/]+)$", path)
            if m:
                return {"token": m.group(1), "hint_type": "sales_invoice",
                        "hint_name": m.group(1), "original_url": original_url}

        # dashboard.lstailors.com or delivered.lstailors.com
        if any(domain == d or domain.endswith("." + d) for d in DASHBOARD_DOMAINS):
            # Path-style: /scan/{token}
            m = re.match(r"^(?:.*/)?scan/([^/?#]+)$", path)
            if m:
                return {"token": m.group(1), "hint_type": None, "hint_name": None,
                        "original_url": original_url}
            # Query-style: ?token= or ?t=
            for key in ("token", "t"):
                vals = qs.get(key, [])
                if vals:
                    return {"token": vals[0], "hint_type": None, "hint_name": None,
                            "original_url": original_url}

        # Generic fallback: try to pull a token from common query params
        for key in ("token", "t", "qr", "code"):
            vals = qs.get(key, [])
            if vals:
                return {"token": vals[0], "hint_type": None, "hint_name": None,
                        "original_url": original_url}

        # Last resort: use last path segment
        last = path.split("/")[-1] if path else ""
        if last:
            return {"token": last, "hint_type": None, "hint_name": None,
                    "original_url": original_url}

    except Exception:
        pass

    return {"token": raw, "hint_type": None, "hint_name": None, "original_url": original_url}


# ── Type detection ─────────────────────────────────────────────────────────────

def detect_type(token: str, hint_type: str | None) -> tuple[str | None, str | None]:
    """
    Returns (qr_type, doctype_name) or (None, None).
    Ordered: hint → prefix → fallback.
    """
    if hint_type:
        if hint_type == "garment_path":
            return "garment_path", None
        if hint_type == "customer":
            return "customer", "Customer"
        for prefixes, qtype, dt in PREFIX_TYPE_MAP:
            if hint_type == qtype:
                return qtype, dt
        if hint_type == "payment_link":
            return "payment_link", "Sales Invoice"

    upper = token.upper()
    for prefixes, qtype, dt in PREFIX_TYPE_MAP:
        if any(upper.startswith(p.upper()) for p in prefixes):
            return qtype, dt

    return None, None


# ── Field helpers ──────────────────────────────────────────────────────────────

def fmt_currency(amount, currency="USD") -> str:
    try:
        return f"${float(amount):,.2f}"
    except (TypeError, ValueError):
        return str(amount or "")


# ── Per-type resolvers ─────────────────────────────────────────────────────────

def _resolve_sales_invoice(name: str) -> dict:
    frappe.has_permission("Sales Invoice", doc=name, throw=True)
    doc = frappe.get_doc("Sales Invoice", name)
    outstanding = float(doc.outstanding_amount or 0)
    grand = float(doc.grand_total or 0)
    state = doc.status or "Draft"
    actions = ["open"]
    if outstanding > 0:
        actions += ["mark_paid", "open_payment_link"]

    return {
        "ok": True,
        "type": "sales_invoice",
        "doctype": "Sales Invoice",
        "name": doc.name,
        "title": f"{doc.customer_name or doc.customer} — {fmt_currency(grand)}",
        "subtitle": f"Balance due {fmt_currency(outstanding)}" if outstanding > 0 else "Paid in full",
        "state": state,
        "actions": actions,
        "meta": {
            "customer": doc.customer,
            "customer_name": doc.customer_name,
            "grand_total": grand,
            "outstanding_amount": outstanding,
            "currency": doc.currency or "USD",
            "due_date": str(doc.due_date or ""),
            "square_payment_link": getattr(doc, "lsh_square_payment_link", None) or "",
            "invoice_web_url": getattr(doc, "lsh_invoice_web_url", None) or "",
            "alteration_ticket_ref": getattr(doc, "alteration_ticket_ref", None) or "",
        },
    }


def _resolve_alteration_ticket(name: str) -> dict:
    frappe.has_permission("Alteration Ticket", doc=name, throw=True)
    doc = frappe.get_doc("Alteration Ticket", name)
    state = doc.workflow_state or getattr(doc, "status", None) or "Draft"

    lifecycle_map = {
        "Received":    ["mark_in_progress"],
        "In Progress": ["mark_ready"],
        "Ready":       ["mark_picked_up"],
        "Picked Up":   [],
        "Cancelled":   [],
    }
    lifecycle_actions = lifecycle_map.get(state, [])
    actions = ["open", "print_tag"] + lifecycle_actions

    garments = []
    for g in (doc.garments or []):
        garments.append({
            "garment_type": g.garment_type,
            "description": getattr(g, "garment_description", ""),
        })

    return {
        "ok": True,
        "type": "alteration_ticket",
        "doctype": "Alteration Ticket",
        "name": doc.name,
        "title": f"Alteration — {doc.name}",
        "subtitle": f"{doc.customer_name or doc.customer} · {state}",
        "state": state,
        "actions": actions,
        "meta": {
            "customer": doc.customer,
            "customer_name": doc.customer_name or "",
            "customer_phone": getattr(doc, "customer_phone", "") or "",
            "due_date": str(doc.due_date or ""),
            "garments": garments,
            "workflow_state": state,
        },
    }


def _resolve_lsh_delivery(name_or_token: str) -> dict:
    """Resolve by doc name (DN-*) or by lsh_qr_token."""
    doc = None
    upper = name_or_token.upper()
    if upper.startswith("DN-NYC-") or upper.startswith("DN-HOU-") or upper.startswith("DN-TX-"):
        try:
            frappe.has_permission("LSH Delivery", doc=name_or_token, throw=True)
            doc = frappe.get_doc("LSH Delivery", name_or_token)
        except frappe.DoesNotExistError:
            pass

    if not doc:
        rows = frappe.get_list(
            "LSH Delivery",
            filters={"lsh_qr_token": name_or_token},
            fields=["name"],
            limit=1,
        )
        if not rows:
            return {"ok": False, "reason": "Delivery not found for this token.", "raw": name_or_token}
        frappe.has_permission("LSH Delivery", doc=rows[0].name, throw=True)
        doc = frappe.get_doc("LSH Delivery", rows[0].name)

    status = doc.lsh_status or "Queued"
    actions = ["open"]
    if status not in ("Delivered", "Cancelled"):
        actions.append("mark_delivered")
    actions.append("send_sms")

    address_parts = [
        doc.lsh_delivery_address or "",
        getattr(doc, "lsh_delivery_apt", "") or "",
        doc.lsh_delivery_city or "",
    ]
    address = ", ".join(p for p in address_parts if p)

    return {
        "ok": True,
        "type": "lsh_delivery",
        "doctype": "LSH Delivery",
        "name": doc.name,
        "title": f"Delivery — {doc.name}",
        "subtitle": f"{doc.customer_name or doc.customer or ''} · {status}",
        "state": status,
        "actions": actions,
        "meta": {
            "customer": doc.customer,
            "customer_name": doc.customer_name or "",
            "customer_phone": doc.customer_phone or "",
            "address": address,
            "garment_summary": doc.lsh_garment_summary or "",
            "garment_count": doc.lsh_garment_count or 0,
            "qr_token": doc.lsh_qr_token or "",
        },
    }


def _resolve_custom_order(name: str) -> dict:
    frappe.has_permission("LSH Custom Order", doc=name, throw=True)
    doc = frappe.get_doc("LSH Custom Order", name)
    state = doc.status or "Draft"

    garments = []
    for g in (doc.garments or []):
        garments.append({
            "garment_type": g.garment_type,
            "status": getattr(g, "garment_status", ""),
        })

    return {
        "ok": True,
        "type": "custom_order",
        "doctype": "LSH Custom Order",
        "name": doc.name,
        "title": f"Custom Order — {doc.name}",
        "subtitle": f"{doc.customer or ''} · {state}",
        "state": state,
        "actions": ["open", "print_tags"],
        "meta": {
            "customer": doc.customer,
            "order_total": float(doc.order_total or 0),
            "deposit_amount": float(doc.deposit_amount or 0),
            "garments": garments,
            "erp_sales_order": doc.erp_sales_order or "",
        },
    }


def _resolve_tailor_transfer(name: str) -> dict:
    """
    Resolve a Tailor Transfer by doc name.

    The qr_code child field on Tailor Transfer items stores the alteration
    ticket ID (e.g. ALT-NYC-2026-00042). When a garment tag is scanned and
    the ALT- detector fires, that path is taken instead. This resolver is
    reached when someone explicitly scans the Tailor Transfer doc name itself.
    """
    try:
        frappe.has_permission("Tailor Transfer", doc=name, throw=True)
        doc = frappe.get_doc("Tailor Transfer", name)
    except frappe.DoesNotExistError:
        return {"ok": False, "reason": "Transfer not found.", "raw": name}

    status = "Submitted" if doc.docstatus == 1 else "Draft"
    actions = ["open"]
    if doc.docstatus == 1 and doc.direction == "Out":
        actions.append("confirm_receipt")

    return {
        "ok": True,
        "type": "tailor_transfer",
        "doctype": "Tailor Transfer",
        "name": doc.name,
        "title": f"Transfer — {doc.name}",
        "subtitle": f"{doc.tailor_name or doc.tailor} · {doc.direction} · {status}",
        "state": status,
        "actions": actions,
        "meta": {
            "tailor": doc.tailor,
            "tailor_name": doc.tailor_name or "",
            "direction": doc.direction,
            "item_count": doc.item_count or 0,
            "transfer_date": str(doc.transfer_date or ""),
        },
    }


def _resolve_payment_link(url: str) -> dict:
    """Reverse-lookup invoice by lsh_square_payment_link field."""
    rows = frappe.get_list(
        "Sales Invoice",
        filters={"lsh_square_payment_link": url},
        fields=["name"],
        limit=1,
    )
    if not rows:
        return {"ok": False, "reason": "No invoice found for this payment link.", "raw": url}
    return _resolve_sales_invoice(rows[0].name)


def _resolve_garment_tag(token: str) -> dict:
    """TAG-* tokens or raw UUID/hash garment tokens."""
    rows = frappe.get_list(
        "LSH Delivery",
        filters={"lsh_qr_token": token},
        fields=["name"],
        limit=1,
    )
    if rows:
        return _resolve_lsh_delivery(rows[0].name)

    return {"ok": False, "reason": "Garment tag not found in any active document.", "raw": token}


def _resolve_garment_path(ticket: str, garment_id: str) -> dict:
    """alts.lstailors.com/g/{ticket}/{garmentId} printed tags."""
    ticket = (ticket or "").strip()
    garment_id = (garment_id or "").strip()
    if not ticket or not garment_id:
        return {"ok": False, "reason": "Incomplete garment path.", "raw": f"{ticket}/{garment_id}"}

    # Prefer live ticket when it exists; still return path so the app can open /g/.
    state = ""
    customer_name = ""
    if frappe.db.exists("Alteration Ticket", ticket):
        try:
            frappe.has_permission("Alteration Ticket", doc=ticket, throw=True)
            doc = frappe.get_doc("Alteration Ticket", ticket)
            state = doc.workflow_state or getattr(doc, "status", None) or ""
            customer_name = doc.customer_name or doc.customer or ""
        except frappe.PermissionError:
            return {"ok": False, "reason": "You do not have permission to view this ticket.", "raw": ticket}

    return {
        "ok": True,
        "type": "garment_tag",
        "doctype": "Alteration Ticket",
        "name": ticket,
        "title": f"Garment {garment_id} · {ticket}",
        "subtitle": f"{customer_name} · {state}".strip(" ·"),
        "state": state or "Scan",
        "actions": ["open"],
        "meta": {
            "ticket": ticket,
            "alteration_ticket": ticket,
            "garment_id": garment_id,
            "garment": garment_id,
            "customer_name": customer_name,
        },
    }


def _resolve_customer(name: str) -> dict:
    """Customer by name (CUST-*) or exact Customer doc name."""
    name = (name or "").strip()
    if not name:
        return {"ok": False, "reason": "Empty customer id.", "raw": name}
    try:
        frappe.has_permission("Customer", doc=name, throw=True)
        doc = frappe.get_doc("Customer", name)
    except frappe.DoesNotExistError:
        return {"ok": False, "reason": f"Customer {name} not found.", "raw": name}
    except frappe.PermissionError:
        return {"ok": False, "reason": "You do not have permission to view this customer.", "raw": name}

    phone = ""
    try:
        phone = doc.mobile_no or doc.phone or ""
    except Exception:
        phone = getattr(doc, "mobile_no", "") or ""

    return {
        "ok": True,
        "type": "customer",
        "doctype": "Customer",
        "name": doc.name,
        "title": doc.customer_name or doc.name,
        "subtitle": phone or doc.customer_group or "Client",
        "state": doc.disabled and "Disabled" or "Active",
        "actions": ["open"],
        "meta": {
            "customer": doc.name,
            "customer_name": doc.customer_name or "",
            "customer_phone": phone,
        },
    }


# ── Scan log ──────────────────────────────────────────────────────────────────

def _write_scan_log(raw: str, token: str, resolved_type: str | None,
                    resolved_name: str | None, outcome: str,
                    error_detail: str = "") -> None:
    try:
        log = frappe.new_doc("LSH Scan Log")
        log.scanned_at = frappe.utils.now_datetime()
        log.scanned_by = frappe.session.user
        log.raw_input = (raw or "")[:500]
        log.normalized_token = (token or "")[:500]
        log.resolved_type = resolved_type or ""
        log.resolved_name = resolved_name or ""
        log.outcome = outcome
        log.error_detail = (error_detail or "")[:1000]
        log.flags.ignore_permissions = True
        log.insert(ignore_permissions=True)
    except Exception:
        frappe.log_error(title="LSH Scan Log write failed",
                         message=traceback.format_exc())


# ── Main entry point ──────────────────────────────────────────────────────────

@frappe.whitelist()
def resolve_qr(token: str) -> dict:
    """
    Resolve any L&S QR code to a structured action result.

    Accepts: raw doc name, path-style URL, query-style URL, Square pay URL,
    invoice URL (my.lstailors.com), garment token, or any mix thereof.

    Never raises to the client — all failures return {"ok": False, ...}.
    """
    raw = (token or "").strip()
    if not raw:
        return {"ok": False, "reason": "Empty input.", "raw": raw}

    try:
        norm = normalize_token(raw)
        tok = norm["token"].strip().rstrip("?&#")
        hint_type = norm["hint_type"]
        hint_name = norm.get("hint_name")

        if not tok:
            _write_scan_log(raw, "", None, None, "Error", "Empty after normalization")
            return {"ok": False, "reason": "Could not extract a token from this input.", "raw": raw}

        qr_type, doctype_name = detect_type(tok, hint_type)

        result: dict

        if qr_type == "payment_link":
            result = _resolve_payment_link(tok)

        elif qr_type == "garment_path":
            ticket = norm.get("ticket") or ""
            garment_id = norm.get("garment_id") or ""
            # Also accept GPATH:ticket/garment packed token
            if not ticket and tok.startswith("GPATH:"):
                rest = tok[len("GPATH:"):]
                parts = rest.split("/", 1)
                if len(parts) == 2:
                    ticket, garment_id = parts[0], parts[1]
            result = _resolve_garment_path(ticket, garment_id)

        elif qr_type == "customer":
            name = hint_name or tok
            result = _resolve_customer(name)

        elif qr_type == "sales_invoice":
            name = hint_name or tok
            try:
                result = _resolve_sales_invoice(name)
            except frappe.DoesNotExistError:
                result = {"ok": False, "reason": f"Invoice {name} not found.", "raw": raw}
            except frappe.PermissionError:
                result = {"ok": False, "reason": "You do not have permission to view this invoice.", "raw": raw}

        elif qr_type == "alteration_ticket":
            try:
                result = _resolve_alteration_ticket(tok)
            except frappe.DoesNotExistError:
                result = {"ok": False, "reason": f"Alteration ticket {tok} not found.", "raw": raw}
            except frappe.PermissionError:
                result = {"ok": False, "reason": "You do not have permission to view this ticket.", "raw": raw}

        elif qr_type == "lsh_delivery":
            result = _resolve_lsh_delivery(tok)

        elif qr_type == "custom_order":
            try:
                result = _resolve_custom_order(tok)
            except frappe.DoesNotExistError:
                result = {"ok": False, "reason": f"Custom order {tok} not found.", "raw": raw}
            except frappe.PermissionError:
                result = {"ok": False, "reason": "You do not have permission to view this order.", "raw": raw}

        elif qr_type == "garment_tag":
            result = _resolve_garment_tag(tok)

        else:
            result = _fallback_lookup(tok, raw)

        outcome = "Resolved" if result.get("ok") else "Unknown"
        _write_scan_log(
            raw, tok,
            result.get("type") or qr_type,
            result.get("name"),
            outcome,
            result.get("reason", ""),
        )
        return result

    except Exception:
        err = traceback.format_exc()
        frappe.log_error(title="resolve_qr unhandled error", message=err)
        _write_scan_log(raw, raw, None, None, "Error", err[:1000])
        return {"ok": False, "reason": "An unexpected server error occurred. Please try again.", "raw": raw}


def _fallback_lookup(tok: str, raw: str) -> dict:
    """
    Last-resort ordered DB search when prefix detection fails.
    """
    # 1. LSH Delivery by lsh_qr_token
    rows = frappe.get_list("LSH Delivery", filters={"lsh_qr_token": tok},
                            fields=["name"], limit=1)
    if rows:
        return _resolve_lsh_delivery(rows[0].name)

    # 2. Alteration Ticket by name
    if frappe.db.exists("Alteration Ticket", tok):
        try:
            return _resolve_alteration_ticket(tok)
        except frappe.PermissionError:
            return {"ok": False, "reason": "Not permitted.", "raw": raw}

    # 3. Sales Invoice by name
    if frappe.db.exists("Sales Invoice", tok):
        try:
            return _resolve_sales_invoice(tok)
        except frappe.PermissionError:
            return {"ok": False, "reason": "Not permitted.", "raw": raw}

    # 4. LSH Custom Order by name
    if frappe.db.exists("LSH Custom Order", tok):
        try:
            return _resolve_custom_order(tok)
        except frappe.PermissionError:
            return {"ok": False, "reason": "Not permitted.", "raw": raw}

    # 5. Tailor Transfer by name
    if frappe.db.exists("Tailor Transfer", tok):
        return _resolve_tailor_transfer(tok)

    # 6. Customer by name
    if frappe.db.exists("Customer", tok):
        return _resolve_customer(tok)

    return {
        "ok": False,
        "reason": "Not an L&S code, or no longer active.",
        "raw": raw,
    }


# ── Action handlers ────────────────────────────────────────────────────────────

@frappe.whitelist()
def mark_delivered(delivery_name: str) -> dict:
    """Mark an LSH Delivery as Delivered. Idempotent."""
    try:
        frappe.has_permission("LSH Delivery", "write", doc=delivery_name, throw=True)
        doc = frappe.get_doc("LSH Delivery", delivery_name)
        if doc.lsh_status == "Delivered":
            return {"ok": True, "message": "Already marked as delivered.", "idempotent": True}
        doc.lsh_status = "Delivered"
        doc.lsh_delivered_at = frappe.utils.now_datetime()
        doc.save(ignore_permissions=False)
        frappe.db.commit()
        _trigger_pod_notification(doc)
        return {"ok": True, "message": f"Delivery {delivery_name} marked as delivered."}
    except frappe.PermissionError:
        return {"ok": False, "message": "You do not have permission to update this delivery."}
    except Exception:
        frappe.log_error(title="mark_delivered error", message=traceback.format_exc())
        return {"ok": False, "message": "Could not update delivery. Please try again."}


def _trigger_pod_notification(doc) -> None:
    try:
        from lsh_house.notifications.delivery import send_delivery_notification
        send_delivery_notification(doc)
    except Exception:
        pass


@frappe.whitelist()
def mark_paid(invoice_name: str) -> dict:
    """Mark a Sales Invoice as paid (creates a Payment Entry). Idempotent."""
    try:
        frappe.has_permission("Sales Invoice", "write", doc=invoice_name, throw=True)
        doc = frappe.get_doc("Sales Invoice", invoice_name)
        if float(doc.outstanding_amount or 0) == 0:
            return {"ok": True, "message": "Invoice is already fully paid.", "idempotent": True}

        pe = frappe.new_doc("Payment Entry")
        pe.payment_type = "Receive"
        pe.party_type = "Customer"
        pe.party = doc.customer
        pe.paid_amount = doc.outstanding_amount
        pe.received_amount = doc.outstanding_amount
        pe.paid_from = frappe.db.get_value("Company", doc.company, "default_receivable_account")
        pe.paid_to = frappe.db.get_value("Company", doc.company, "default_cash_account")
        pe.reference_no = f"SCAN-{frappe.utils.today()}"
        pe.reference_date = frappe.utils.today()
        pe.append("references", {
            "reference_doctype": "Sales Invoice",
            "reference_name": invoice_name,
            "allocated_amount": doc.outstanding_amount,
        })
        pe.insert(ignore_permissions=False)
        pe.submit()
        frappe.db.commit()
        return {"ok": True, "message": f"Invoice {invoice_name} marked as paid."}
    except frappe.PermissionError:
        return {"ok": False, "message": "You do not have permission to update this invoice."}
    except Exception:
        frappe.log_error(title="mark_paid error", message=traceback.format_exc())
        return {"ok": False, "message": "Could not mark invoice paid. Please try again."}


@frappe.whitelist()
def advance_alteration_status(ticket_name: str, to_state: str) -> dict:
    """Advance an Alteration Ticket workflow state. Idempotent."""
    VALID_TRANSITIONS = {
        "Received":    ["In Progress"],
        "In Progress": ["Ready"],
        "Ready":       ["Picked Up"],
    }
    try:
        frappe.has_permission("Alteration Ticket", "write", doc=ticket_name, throw=True)
        doc = frappe.get_doc("Alteration Ticket", ticket_name)
        current = doc.workflow_state or getattr(doc, "status", "") or ""
        allowed = VALID_TRANSITIONS.get(current, [])

        if doc.workflow_state == to_state or getattr(doc, "status", None) == to_state:
            return {"ok": True, "message": f"Ticket is already {to_state}.", "idempotent": True}

        if to_state not in allowed:
            return {
                "ok": False,
                "message": f"Cannot transition from '{current}' to '{to_state}'. "
                           f"Allowed: {', '.join(allowed) or 'none'}."
            }

        frappe.db.set_value("Alteration Ticket", ticket_name, "workflow_state", to_state)
        frappe.db.commit()
        return {"ok": True, "message": f"Ticket {ticket_name} advanced to {to_state}."}
    except frappe.PermissionError:
        return {"ok": False, "message": "You do not have permission to update this ticket."}
    except Exception:
        frappe.log_error(title="advance_alteration_status error", message=traceback.format_exc())
        return {"ok": False, "message": "Could not update ticket status. Please try again."}


@frappe.whitelist()
def confirm_transfer(transfer_name: str) -> dict:
    """Mark a Tailor Transfer as received. Idempotent."""
    try:
        frappe.has_permission("Tailor Transfer", "write", doc=transfer_name, throw=True)
        doc = frappe.get_doc("Tailor Transfer", transfer_name)
        if doc.docstatus == 1:
            return {"ok": True, "message": "Transfer already confirmed.", "idempotent": True}
        doc.submit()
        frappe.db.commit()
        return {"ok": True, "message": f"Transfer {transfer_name} confirmed and submitted."}
    except frappe.PermissionError:
        return {"ok": False, "message": "You do not have permission to confirm this transfer."}
    except Exception:
        frappe.log_error(title="confirm_transfer error", message=traceback.format_exc())
        return {"ok": False, "message": "Could not confirm transfer. Please try again."}
