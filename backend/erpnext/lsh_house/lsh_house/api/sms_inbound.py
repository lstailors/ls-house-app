import base64
import hashlib
import hmac
import re

import frappe
from frappe.utils import cstr, now_datetime
from werkzeug.wrappers import Response

from lsh_house.sms import get_twilio_auth_token, latest_thread_for_phone, normalize_e164


RAVEN_CHANNEL_ID = "L&S Tailors-sofia-live"
RAVEN_BOT_EMAIL = "concierge@lstailors.com"
EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'


def _empty_twiml_response():
    frappe.local.response["http_status_code"] = 200
    return Response(EMPTY_TWIML, status=200, mimetype="text/xml")


def _last_10(phone):
    digits = re.sub(r"\D", "", cstr(phone))
    return digits[-10:] if len(digits) >= 10 else None


def _signature_bypass_enabled(settings):
    return bool(
        getattr(settings, "bypass_twilio_signature_validation", 0)
        or getattr(settings, "disable_twilio_signature_validation", 0)
        or getattr(settings, "allow_insecure_twilio_webhook", 0)
    )


def _request_header(header_name):
    try:
        return frappe.get_request_header(header_name)
    except Exception:
        return frappe.local.request.headers.get(header_name)


def _first_header_value(value):
    return cstr(value).split(",", 1)[0].strip()


def _request_urls(settings=None):
    request = frappe.local.request
    urls = [request.url]

    configured_url = cstr(getattr(settings, "twilio_webhook_url", "")).strip() if settings else ""
    if configured_url:
        urls.append(configured_url)

    forwarded_proto = _first_header_value(_request_header("X-Forwarded-Proto"))
    forwarded_host = _first_header_value(_request_header("X-Forwarded-Host")) or _first_header_value(
        _request_header("Host")
    )
    if forwarded_proto and forwarded_host:
        forwarded_url = f"{forwarded_proto}://{forwarded_host}{request.full_path}"
        forwarded_url = forwarded_url[:-1] if forwarded_url.endswith("?") else forwarded_url
        urls.append(forwarded_url)

    return list(dict.fromkeys(urls))


def _post_params():
    params = {}
    for key, value in frappe.form_dict.items():
        if key == "cmd":
            continue
        if isinstance(value, (list, tuple)):
            params[key] = value[0] if value else ""
        else:
            params[key] = value
    return params


def _compute_twilio_signature(auth_token, url, params):
    signature_base = cstr(url)
    for key in sorted(params):
        signature_base += key + cstr(params[key])

    digest = hmac.new(
        cstr(auth_token).encode("utf-8"),
        signature_base.encode("utf-8"),
        hashlib.sha1,
    ).digest()
    return base64.b64encode(digest).decode("utf-8")


def _twilio_signature_is_valid(settings):
    if _signature_bypass_enabled(settings):
        return True

    signature = cstr(_request_header("X-Twilio-Signature")).strip()
    if not signature:
        return False

    params = _post_params()
    return any(
        hmac.compare_digest(
            signature,
            _compute_twilio_signature(get_twilio_auth_token(settings), url, params),
        )
        for url in _request_urls(settings)
    )


def _customer_fields():
    meta = frappe.get_meta("Customer")
    fields = ["name", "customer_name"]
    for fieldname in ("mobile_no", "phone", "phone_number", "contact_mobile", "contact_phone"):
        if meta.has_field(fieldname):
            fields.append(fieldname)
    return fields


def _contact_fields():
    meta = frappe.get_meta("Contact")
    fields = ["name", "first_name", "last_name", "full_name"]
    for fieldname in ("mobile_no", "phone"):
        field = meta.get_field(fieldname)
        if field and field.fieldtype != "Table":
            fields.append(fieldname)
    return fields


def _customer_name(customer):
    if not customer:
        return None
    return cstr(customer.get("customer_name") or customer.get("name")).strip() or None


def _contact_name(contact):
    if not contact:
        return None
    full_name = cstr(contact.get("full_name")).strip()
    if full_name:
        return full_name
    return f"{cstr(contact.get('first_name')).strip()} {cstr(contact.get('last_name')).strip()}".strip() or None


def _match_customer_by_phone(phone):
    last_10 = _last_10(phone)
    if not last_10:
        return None, None

    for customer in frappe.get_all("Customer", fields=_customer_fields(), limit_page_length=0):
        for fieldname, value in customer.items():
            if fieldname in ("name", "customer_name"):
                continue
            if _last_10(value) == last_10:
                return customer.get("name"), _customer_name(customer)

    contact_fields = _contact_fields()
    for contact in frappe.get_all("Contact", fields=contact_fields, limit_page_length=0):
        for fieldname, value in contact.items():
            if fieldname in ("name", "first_name", "last_name", "full_name"):
                continue
            if _last_10(value) != last_10:
                continue

            dynamic_links = frappe.get_all(
                "Dynamic Link",
                filters={
                    "parenttype": "Contact",
                    "parent": contact.get("name"),
                    "link_doctype": "Customer",
                },
                fields=["link_name"],
                limit=1,
            )
            if dynamic_links:
                customer_name = dynamic_links[0].get("link_name")
                customer_display_name = frappe.db.get_value("Customer", customer_name, "customer_name")
                return customer_name, customer_display_name or _contact_name(contact)

            return None, _contact_name(contact)

    if frappe.db.exists("DocType", "Contact Phone"):
        for contact_phone in frappe.get_all(
            "Contact Phone",
            fields=["parent", "phone"],
            limit_page_length=0,
        ):
            if _last_10(contact_phone.get("phone")) != last_10:
                continue

            dynamic_links = frappe.get_all(
                "Dynamic Link",
                filters={
                    "parenttype": "Contact",
                    "parent": contact_phone.get("parent"),
                    "link_doctype": "Customer",
                },
                fields=["link_name"],
                limit=1,
            )
            if dynamic_links:
                customer_name = dynamic_links[0].get("link_name")
                customer_display_name = frappe.db.get_value("Customer", customer_name, "customer_name")
                return customer_name, customer_display_name

    return None, None


def _resolve_context(phone):
    thread = latest_thread_for_phone(phone)
    if thread:
        customer = thread.get("customer")
        client_name = thread.get("client_name")
        if customer and not client_name:
            client_name = frappe.db.get_value("Customer", customer, "customer_name")
        return {
            "customer": customer,
            "client_name": client_name,
            "reference_doctype": thread.get("reference_doctype"),
            "reference_name": thread.get("reference_name"),
            "context_tag": thread.get("context_tag"),
        }

    customer, client_name = _match_customer_by_phone(phone)
    return {
        "customer": customer,
        "client_name": client_name,
        "reference_doctype": None,
        "reference_name": None,
        "context_tag": None,
    }


def _insert_inbound_message(*, phone, raw_from, body, message_sid, context):
    sms_message = frappe.get_doc(
        {
            "doctype": "LSH SMS Message",
            "client_phone": phone,
            "client_name": context.get("client_name"),
            "direction": "inbound",
            "content": body,
            "body": body,
            "sender": raw_from,
            "timestamp": now_datetime(),
            "twilio_sid": message_sid,
            "status": "received",
            "customer": context.get("customer"),
            "reference_doctype": context.get("reference_doctype"),
            "reference_name": context.get("reference_name"),
            "context_tag": context.get("context_tag"),
        }
    )
    sms_message.insert(ignore_permissions=True)
    return sms_message


def _raven_card(sms_message, num_media=None):
    client = sms_message.get("client_name") or sms_message.get("client_phone")
    lines = [
        f"Inbound SMS - {client}",
        cstr(sms_message.get("body") or sms_message.get("content")),
    ]

    if cstr(num_media).strip() not in ("", "0"):
        lines.append(f"media attachments: {num_media}")

    reference_name = sms_message.get("reference_name")
    context_tag = sms_message.get("context_tag")
    if reference_name:
        context = f" ({context_tag})" if context_tag else ""
        lines.append(f"re: {reference_name}{context}")

    if sms_message.get("customer"):
        lines.append(f"customer: {sms_message.get('customer')}")

    return "\n".join(lines)


def _post_to_raven(sms_message, num_media=None):
    try:
        bot_name = None
        raven_bot_meta = frappe.get_meta("Raven Bot")
        for fieldname in ("bot_email", "email", "user", "owner"):
            if raven_bot_meta.has_field(fieldname) or fieldname == "owner":
                bot_name = frappe.db.get_value("Raven Bot", {fieldname: RAVEN_BOT_EMAIL}, "name")
                if bot_name:
                    break
        if not bot_name:
            bot_name = RAVEN_BOT_EMAIL

        bot = frappe.get_doc("Raven Bot", bot_name)
        bot.send_message(channel_id=RAVEN_CHANNEL_ID, text=_raven_card(sms_message, num_media=num_media))
    except Exception:
        frappe.log_error(frappe.get_traceback(), "LSH inbound SMS Raven mirror failed")


@frappe.whitelist(allow_guest=True)
def receive():
    settings = frappe.get_single("LSH SMS Settings")

    if not _twilio_signature_is_valid(settings):
        frappe.log_error(
            f"Rejected inbound SMS with invalid Twilio signature from {frappe.form_dict.get('From')}",
            "LSH inbound SMS signature validation failed",
        )
        return _empty_twiml_response()

    raw_from = cstr(frappe.form_dict.get("From")).strip()
    body = cstr(frappe.form_dict.get("Body"))
    message_sid = cstr(frappe.form_dict.get("MessageSid")).strip()
    num_media = cstr(frappe.form_dict.get("NumMedia")).strip()

    phone = normalize_e164(raw_from) or raw_from
    context = _resolve_context(phone)

    sms_message = _insert_inbound_message(
        phone=phone,
        raw_from=raw_from,
        body=body,
        message_sid=message_sid,
        context=context,
    )
    _post_to_raven(sms_message, num_media=num_media)

    return _empty_twiml_response()
