import re

import frappe
import requests
from frappe.utils import cstr, now_datetime


TWILIO_MESSAGES_URL = "https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"


def normalize_e164(phone):
    raw_phone = cstr(phone).strip()
    if not raw_phone:
        return None

    digits = re.sub(r"\D", "", raw_phone)
    if raw_phone.startswith("+"):
        return f"+{digits}" if digits else None

    if len(digits) == 10:
        return f"+1{digits}"

    if len(digits) == 11 and digits.startswith("1"):
        return f"+{digits}"

    return None


def first_name(full_name):
    name = cstr(full_name).strip()
    return name.split()[0] if name else "there"


def _log_sms_message(
    *,
    phone,
    message,
    status,
    customer=None,
    reference_doctype=None,
    reference_name=None,
    context_tag=None,
    client_name=None,
    sender=None,
    twilio_sid=None,
    error_message=None,
):
    sms_message = frappe.get_doc(
        {
            "doctype": "LSH SMS Message",
            "client_phone": phone,
            "client_name": client_name,
            "direction": "outbound",
            "content": message,
            "body": message,
            "sender": sender,
            "timestamp": now_datetime(),
            "twilio_sid": twilio_sid,
            "status": status,
            "customer": customer,
            "reference_doctype": reference_doctype,
            "reference_name": reference_name,
            "context_tag": context_tag,
            "error_message": error_message,
        }
    )
    sms_message.insert(ignore_permissions=True)
    return sms_message


def _log_failed_message(
    *,
    phone,
    message,
    error_message,
    customer=None,
    reference_doctype=None,
    reference_name=None,
    context_tag=None,
    client_name=None,
    sender=None,
):
    sms_message = _log_sms_message(
        phone=phone,
        message=message,
        status="failed",
        customer=customer,
        reference_doctype=reference_doctype,
        reference_name=reference_name,
        context_tag=context_tag,
        client_name=client_name,
        sender=sender,
        error_message=error_message,
    )
    frappe.log_error(error_message, "LSH SMS send failed")
    return sms_message


def send_and_log(
    phone,
    message,
    customer=None,
    reference_doctype=None,
    reference_name=None,
    context_tag=None,
    client_name=None,
):
    from_number = None

    try:
        settings = frappe.get_single("LSH SMS Settings")
        from_number = cstr(settings.twilio_from_number).strip()

        if not settings.sms_enabled:
            frappe.logger("lsh_house.sms").info("Customer SMS is disabled in LSH SMS Settings")
            return None

        normalized_phone = normalize_e164(phone)
        if not normalized_phone:
            return _log_failed_message(
                phone=cstr(phone),
                message=message,
                customer=customer,
                reference_doctype=reference_doctype,
                reference_name=reference_name,
                context_tag=context_tag,
                client_name=client_name,
                sender=from_number,
                error_message=f"Invalid SMS phone number: {phone}",
            )

        account_sid = cstr(settings.twilio_account_sid).strip()
        auth_token = cstr(settings.twilio_auth_token)

        if not account_sid or not auth_token or not from_number:
            return _log_failed_message(
                phone=normalized_phone,
                message=message,
                customer=customer,
                reference_doctype=reference_doctype,
                reference_name=reference_name,
                context_tag=context_tag,
                client_name=client_name,
                sender=from_number,
                error_message="LSH SMS Settings is missing Twilio credentials or from number.",
            )

        response = requests.post(
            TWILIO_MESSAGES_URL.format(account_sid=account_sid),
            auth=(account_sid, auth_token),
            data={"From": from_number, "To": normalized_phone, "Body": message},
            timeout=15,
        )

        try:
            response_data = response.json()
        except ValueError:
            response_data = {}

        twilio_sid = response_data.get("sid")
        status = response_data.get("status") or ("sent" if response.ok else "failed")

        if not response.ok:
            error_message = response_data.get("message") or response.text or response.reason
            return _log_failed_message(
                phone=normalized_phone,
                message=message,
                customer=customer,
                reference_doctype=reference_doctype,
                reference_name=reference_name,
                context_tag=context_tag,
                client_name=client_name,
                sender=from_number,
                error_message=f"Twilio HTTP {response.status_code}: {error_message}",
            )

        return _log_sms_message(
            phone=normalized_phone,
            message=message,
            status=status,
            customer=customer,
            reference_doctype=reference_doctype,
            reference_name=reference_name,
            context_tag=context_tag,
            client_name=client_name,
            sender=from_number,
            twilio_sid=twilio_sid,
        )

    except Exception:
        error_message = frappe.get_traceback()
        try:
            return _log_failed_message(
                phone=normalize_e164(phone) or cstr(phone),
                message=message,
                customer=customer,
                reference_doctype=reference_doctype,
                reference_name=reference_name,
                context_tag=context_tag,
                client_name=client_name,
                sender=from_number,
                error_message=error_message,
            )
        except Exception:
            frappe.log_error(frappe.get_traceback(), "LSH SMS failure log failed")
            return None


def already_notified(reference_doctype, reference_name, context_tag):
    return (
        frappe.db.exists(
            "LSH SMS Message",
            {
                "reference_doctype": reference_doctype,
                "reference_name": reference_name,
                "context_tag": context_tag,
                "direction": "outbound",
            },
        )
        is not None
    )


def latest_thread_for_phone(phone):
    normalized_phone = normalize_e164(phone)
    if not normalized_phone:
        return None

    records = frappe.get_all(
        "LSH SMS Message",
        filters={"client_phone": normalized_phone, "direction": "outbound"},
        fields=[
            "name",
            "client_phone",
            "client_name",
            "customer",
            "reference_doctype",
            "reference_name",
            "context_tag",
            "content",
            "body",
            "sender",
            "timestamp",
            "twilio_sid",
            "status",
        ],
        order_by="timestamp desc, creation desc",
        limit=1,
    )

    return records[0] if records else None
