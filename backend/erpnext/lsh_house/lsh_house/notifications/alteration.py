import frappe
from frappe.utils import now_datetime

from lsh_house.sms import already_notified, first_name, send_and_log


ALTERATION_READY_CONTEXT = "alteration_ready"


def on_alteration_update(doc, method):
    if getattr(doc, "workflow_state", None) != "Ready":
        return

    if already_notified("Alteration Ticket", doc.name, ALTERATION_READY_CONTEXT):
        return

    phone = getattr(doc, "customer_phone", None)
    if not phone:
        return

    customer_name = getattr(doc, "customer_name", None)
    message = (
        f"Hi {first_name(customer_name)}, your alterations at L&S Custom Tailors are ready "
        "for pickup at 138 East 61st St, Suite 201. Reply here with any questions. - L&S"
    )

    frappe.enqueue(
        send_and_log,
        queue="short",
        phone=phone,
        message=message,
        customer=getattr(doc, "customer", None),
        reference_doctype="Alteration Ticket",
        reference_name=doc.name,
        context_tag=ALTERATION_READY_CONTEXT,
        client_name=customer_name,
    )

    doc.db_set("notified_ready_at", now_datetime(), update_modified=False)
