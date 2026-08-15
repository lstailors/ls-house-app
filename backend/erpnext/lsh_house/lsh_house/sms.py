import os
import re

import frappe
import requests
from frappe.utils import cstr, now_datetime


TWILIO_MESSAGES_URL = "https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"

# LSH SMS Message.status is a Select limited to these values.
ALLOWED_LOG_STATUSES = {"received", "sent", "failed"}

# Twilio create-message statuses that mean the message was accepted and is in flight.
TWILIO_ACCEPTED_STATUSES = {"queued", "accepted", "scheduled", "sending", "sent", "delivered"}


def normalize_log_status(status):
    value = cstr(status).strip().lower()
    if value in ALLOWED_LOG_STATUSES:
        return value
    if value in TWILIO_ACCEPTED_STATUSES:
        return "sent"
    return "failed"


def _ops_mode():
    raw = cstr(os.environ.get("OPS_MODE") or os.environ.get("LST_OPS_MODE") or "").strip().lower()
    if raw in ("test", "dev", "development"):
        return "test"
    return "live"


def _phone_key(phone):
    digits = re.sub(r"\D", "", cstr(phone))
    if len(digits) == 11 and digits.startswith("1"):
        return digits[1:]
    return digits[-10:] if len(digits) > 10 else digits


def _sms_allowlisted(phone):
    extra = cstr(os.environ.get("SMS_ALLOWLIST") or "")
    owner = cstr(os.environ.get("OWNER_MOBILE") or "+16319260917")
    allow = { _phone_key(p) for p in (extra.split(",") + [owner, "+16319260917"]) if p.strip() }
    return _phone_key(phone) in allow


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


def get_twilio_auth_token(settings):
    try:
        return cstr(settings.get_password("twilio_auth_token"))
    except Exception:
        return cstr(settings.twilio_auth_token)


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
            "status": normalize_log_status(status),
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

        if _ops_mode() == "test" and not _sms_allowlisted(phone):
            frappe.logger("lsh_house.sms").info(
                "TEST mode held SMS to non-allowlisted number (source=%s)",
                context_tag or "lsh_house.sms.send_and_log",
            )
            return _log_sms_message(
                phone=cstr(phone),
                message=message,
                status="failed",
                customer=customer,
                reference_doctype=reference_doctype,
                reference_name=reference_name,
                context_tag=f"held:{context_tag or 'send_and_log'}",
                client_name=client_name,
                sender=from_number,
                twilio_sid=f"held_{frappe.utils.now_datetime().strftime('%Y%m%d%H%M%S')}",
                error_message="TEST mode — not allowlisted; not sent",
            )

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
        auth_token = get_twilio_auth_token(settings)

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

        payload = {"From": from_number, "To": normalized_phone, "Body": message}

        # Per-message delivery receipts.
        #
        # These messages go out with From=<number>, not through the Messaging
        # Service, so the Messaging Service's own StatusCallback never fires for
        # them. Without this, `status` stays at whatever Twilio returned at
        # submit time ("queued"/"accepted") and a message that silently failed
        # to deliver is indistinguishable from one the client read.
        #
        # Blank setting = no callback, same behaviour as before.
        status_callback = cstr(
            getattr(settings, "twilio_status_callback_url", "") or ""
        ).strip()
        if status_callback:
            payload["StatusCallback"] = status_callback

        response = requests.post(
            TWILIO_MESSAGES_URL.format(account_sid=account_sid),
            auth=(account_sid, auth_token),
            data=payload,
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


@frappe.whitelist()
def send_customer_sms(
    phone,
    message,
    customer=None,
    reference_doctype=None,
    reference_name=None,
    context_tag="sofia",
    client_name=None,
):
    sms_message = send_and_log(
        phone=phone,
        message=message,
        customer=customer,
        reference_doctype=reference_doctype,
        reference_name=reference_name,
        context_tag=context_tag or "sofia",
        client_name=client_name,
    )

    if not sms_message:
        return {
            "ok": False,
            "status": "not_sent",
            "error_message": "SMS was not sent. Check LSH SMS Settings and server logs.",
        }

    status = sms_message.get("status")
    return {
        "ok": status != "failed",
        "name": sms_message.name,
        "client_phone": sms_message.get("client_phone"),
        "customer": sms_message.get("customer"),
        "reference_doctype": sms_message.get("reference_doctype"),
        "reference_name": sms_message.get("reference_name"),
        "context_tag": sms_message.get("context_tag"),
        "twilio_sid": sms_message.get("twilio_sid"),
        "status": status,
        "error_message": sms_message.get("error_message"),
    }


@frappe.whitelist()
def sofia_reply(phone, message, customer=None, reference_doctype=None, reference_name=None):
    return send_and_log(
        phone=phone,
        message=message,
        customer=customer,
        reference_doctype=reference_doctype,
        reference_name=reference_name,
        context_tag="sofia_reply",
    )


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


@frappe.whitelist()
def list_threads(limit=500, start=0, search=None):
	"""Every SMS conversation with its latest message, newest activity first.

	The ops console previously built this list by loading the most recent 500
	messages and grouping them in Node. With 3,000+ messages that meant only
	the threads active inside that window were visible — 93 of 321. Every
	older conversation was silently absent from the console, which made it
	look like Sofia had spoken to far fewer people than she had.

	Grouping in SQL instead returns every thread regardless of age, in one
	query (~15ms), and pages properly.

	Phones are grouped on their last 10 digits: the same person appears as
	'+1646...' and '646...' across older rows, which split two threads in two.
	"""
	limit = min(int(limit or 500), 1000)
	start = int(start or 0)

	where = "WHERE IFNULL(client_phone,'') != ''"
	params = {"limit": limit, "start": start}
	if search:
		where += " AND (client_phone LIKE %(q)s OR IFNULL(client_name,'') LIKE %(q)s)"
		params["q"] = f"%{search}%"

	rows = frappe.db.sql(
		f"""
		SELECT a.pkey, a.msg_count, a.last_at, a.inbound_count,
		       m.name, m.client_phone, m.client_name, m.customer, m.direction,
		       m.content, m.body, m.context_tag, m.status, m.delivery_status
		FROM (
			SELECT RIGHT(REGEXP_REPLACE(client_phone,'[^0-9]',''),10) AS pkey,
			       COUNT(*) AS msg_count,
			       MAX(creation) AS last_at,
			       SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) AS inbound_count
			FROM `tabLSH SMS Message`
			{where}
			GROUP BY pkey
		) a
		JOIN `tabLSH SMS Message` m
		  ON RIGHT(REGEXP_REPLACE(m.client_phone,'[^0-9]',''),10) = a.pkey
		 AND m.creation = a.last_at
		GROUP BY a.pkey
		ORDER BY a.last_at DESC
		LIMIT %(limit)s OFFSET %(start)s
		""",
		params,
		as_dict=True,
	)

	total = frappe.db.sql(
		f"""SELECT COUNT(DISTINCT RIGHT(REGEXP_REPLACE(client_phone,'[^0-9]',''),10))
		    FROM `tabLSH SMS Message` {where}""",
		params,
	)[0][0]

	threads = []
	for r in rows:
		threads.append({
			"phone": r.client_phone,
			"clientName": r.client_name,
			"customer": r.customer,
			"messageCount": r.msg_count,
			"inboundCount": r.inbound_count,
			# The console treats a thread whose last word came from the client
			# as needing attention.
			"unread": r.direction == "inbound",
			"context_tag": r.context_tag,
			"lastMessage": {
				"body": r.content or r.body,
				"direction": r.direction,
				"created_at": str(r.last_at),
				"timestamp": str(r.last_at),
				"status": r.status,
				"delivery_status": r.delivery_status,
			},
		})

	return {"threads": threads, "total": total, "start": start, "limit": limit}
