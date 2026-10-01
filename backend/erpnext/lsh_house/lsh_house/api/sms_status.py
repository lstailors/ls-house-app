"""Twilio delivery receipts for LSH SMS Message.

Guest method:
  POST /api/method/lsh_house.api.sms_status.receive

The live default in sms.send_and_log points at the house app instead
(https://app.lstailors.com/api/sofia/sms/status), which validates the
Twilio signature behind the same proxy the inbound webhook already uses.
This method is the bench-side twin if LSH SMS Settings overrides that URL.
"""

import frappe
from frappe.utils import cstr

from lsh_house.api.sms_inbound import _empty_twiml_response, _twilio_signature_is_valid
from lsh_house.sms import apply_delivery_receipt


def _form():
    try:
        return frappe.local.request.form
    except Exception:
        return frappe.form_dict


@frappe.whitelist(allow_guest=True)
def receive():
    frappe.set_user("Administrator")
    try:
        settings = frappe.get_single("LSH SMS Settings")
        if not _twilio_signature_is_valid(settings):
            frappe.local.response["http_status_code"] = 403
            return {"ok": False}
    except Exception:
        # Missing settings should not accept an unsigned carrier callback.
        frappe.local.response["http_status_code"] = 403
        return {"ok": False}

    form = _form()
    sid = cstr(form.get("MessageSid") or form.get("SmsSid")).strip()
    message_status = cstr(form.get("MessageStatus") or form.get("SmsStatus")).strip()
    if sid and message_status:
        try:
            apply_delivery_receipt(
                sid,
                message_status,
                error_code=form.get("ErrorCode"),
                error_message=form.get("ErrorMessage"),
            )
        except Exception:
            frappe.log_error(frappe.get_traceback(), "LSH SMS status callback failed")
    return _empty_twiml_response()
