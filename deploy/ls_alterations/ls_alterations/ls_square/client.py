# -*- coding: utf-8 -*-
"""
ls_square/client.py  --  Square API client + webhook signature verification.

Keeps all Square HTTP and crypto in one place. Credentials come from the
"Square Integration Settings" single doctype (Password fields decrypted via
get_password). Outbound calls retry on transient errors.
"""

import base64
import hashlib
import hmac
import json
import time

import frappe
import requests

SQUARE_VERSION = "2025-01-23"
_BASES = {
    "Sandbox": "https://connect.squareupsandbox.com",
    "Production": "https://connect.squareup.com",
}


def get_settings():
    s = frappe.get_cached_doc("Square Integration Settings")
    return s


def _base_url(s):
    return _BASES.get(s.environment or "Production", _BASES["Production"])


def _headers(s):
    token = s.get_password("access_token")
    return {
        "Square-Version": SQUARE_VERSION,
        "Authorization": "Bearer {}".format(token),
        "Content-Type": "application/json",
    }


# ---------------------------------------------------------------------------
# Webhook signature verification
# ---------------------------------------------------------------------------

def verify_signature(raw_body, signature_header):
    """
    Square signs webhooks as:
        base64( HMAC_SHA256( signature_key, notification_url + raw_body ) )
    The notification_url must EXACTLY match what's registered in Square and
    stored in settings. Returns True/False; never raises.
    """
    try:
        s = get_settings()
        key = s.get_password("webhook_signature_key")
        url = (s.notification_url or "").strip()
        if not key or not url or not signature_header:
            return False
        if isinstance(raw_body, bytes):
            body = raw_body
        else:
            body = (raw_body or "").encode("utf-8")
        payload = url.encode("utf-8") + body
        digest = hmac.new(key.encode("utf-8"), payload, hashlib.sha256).digest()
        expected = base64.b64encode(digest).decode("utf-8")
        return hmac.compare_digest(expected, signature_header)
    except Exception:
        frappe.log_error(frappe.get_traceback(), "Square signature verify error")
        return False


# ---------------------------------------------------------------------------
# Outbound API (with simple retry/backoff on transient failures)
# ---------------------------------------------------------------------------

def _request(method, path, body=None, retries=3, timeout=15):
    s = get_settings()
    url = _base_url(s) + path
    headers = _headers(s)
    last = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.request(
                method, url, headers=headers,
                data=json.dumps(body) if body is not None else None,
                timeout=timeout)
            if resp.status_code in (429, 500, 502, 503, 504):
                last = "HTTP {}: {}".format(resp.status_code, resp.text[:300])
                time.sleep(min(2 ** attempt, 8))
                continue
            data = resp.json() if resp.content else {}
            if resp.status_code >= 400:
                errs = data.get("errors") if isinstance(data, dict) else None
                raise frappe.ValidationError(
                    "Square {} {} -> {}".format(method, path, errs or resp.text[:300]))
            return data
        except requests.RequestException as ex:
            last = "{}: {}".format(type(ex).__name__, ex)
            time.sleep(min(2 ** attempt, 8))
    raise frappe.ValidationError("Square request failed after {} tries: {}".format(
        retries, last))


def create_terminal_checkout(amount_cents, reference_id, note=None,
                             idempotency_key=None):
    """
    Push a checkout to the Square Terminal device. The customer taps their
    card on the terminal. reference_id carries our Sales Invoice name so the
    resulting webhook can be reconciled back.
    """
    s = get_settings()
    if not s.device_id:
        raise frappe.ValidationError("No Square Terminal device_id configured")
    body = {
        "idempotency_key": idempotency_key or frappe.generate_hash(length=24),
        "checkout": {
            "amount_money": {"amount": int(amount_cents), "currency": "USD"},
            "reference_id": (reference_id or "")[:40],
            "device_options": {"device_id": s.device_id},
        },
    }
    if note:
        body["checkout"]["note"] = note[:500]
    data = _request("POST", "/v2/terminals/checkouts", body)
    return data.get("checkout", {})


def get_terminal_checkout(checkout_id):
    data = _request("GET", "/v2/terminals/checkouts/{}".format(checkout_id))
    return data.get("checkout", {})


def get_payment(payment_id):
    data = _request("GET", "/v2/payments/{}".format(payment_id))
    return data.get("payment", {})


def create_payment_link(amount_cents, reference_id, name, note=None,
                        idempotency_key=None):
    """
    Square-hosted checkout link (customer pays on their own phone by scanning
    a QR of the returned URL). Returns the payment_link object which includes
    `url`, `long_url`, `id`, and `order_id`. We persist order_id -> invoice so
    the webhook can reconcile (quick_pay orders don't carry our reference).
    """
    s = get_settings()
    if not s.location_id:
        raise frappe.ValidationError("No Square location_id configured")
    body = {
        "idempotency_key": idempotency_key or frappe.generate_hash(length=24),
        "quick_pay": {
            "name": (name or "L&S Payment")[:255],
            "price_money": {"amount": int(amount_cents), "currency": "USD"},
            "location_id": s.location_id,
        },
    }
    if note:
        body["description"] = note[:300]
    data = _request("POST", "/v2/online-checkout/payment-links", body)
    return data.get("payment_link", {})
