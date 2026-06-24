import frappe
from frappe.utils import cstr, format_datetime, now_datetime

from lsh_house.sms import already_notified, first_name, send_and_log


DELIVERY_DISPATCHED_CONTEXT = "delivery_dispatched"
DELIVERY_DELIVERED_CONTEXT = "delivery_delivered"


def _enqueue_delivery_sms(doc, *, message, context_tag, customer_name, phone):
    frappe.enqueue(
        send_and_log,
        queue="short",
        phone=phone,
        message=message,
        customer=getattr(doc, "customer", None),
        reference_doctype="LSH Delivery",
        reference_name=doc.name,
        context_tag=context_tag,
        client_name=customer_name,
    )
    doc.db_set("lsh_customer_notified_at", now_datetime(), update_modified=False)


def _eta_text(doc):
    eta = getattr(doc, "lsh_eta", None)
    return f" with ETA {format_datetime(eta)}" if eta else ""


def _garment_text(doc):
    garment_summary = cstr(getattr(doc, "lsh_garment_summary", None)).strip()
    return f" ({garment_summary})" if garment_summary else ""


def on_delivery_update(doc, method):
    phone = getattr(doc, "lsh_notify_phone", None) or getattr(doc, "customer_phone", None)
    if not phone:
        return

    status = getattr(doc, "lsh_status", None)
    customer_name = getattr(doc, "customer_name", None)

    if status == "Out for Delivery":
        if already_notified("LSH Delivery", doc.name, DELIVERY_DISPATCHED_CONTEXT):
            return

        message = (
            f"Hi {first_name(customer_name)}, your L&S garments{_garment_text(doc)} are "
            f"out for delivery{_eta_text(doc)}. Reply here if you need to adjust timing. - L&S"
        )
        _enqueue_delivery_sms(
            doc,
            message=message,
            context_tag=DELIVERY_DISPATCHED_CONTEXT,
            customer_name=customer_name,
            phone=phone,
        )
        return

    if status == "Delivered":
        if already_notified("LSH Delivery", doc.name, DELIVERY_DELIVERED_CONTEXT):
            return

        message = (
            f"Hi {first_name(customer_name)}, your L&S delivery has arrived. "
            "Thank you for being part of L&S Custom Tailors. - L&S"
        )
        _enqueue_delivery_sms(
            doc,
            message=message,
            context_tag=DELIVERY_DELIVERED_CONTEXT,
            customer_name=customer_name,
            phone=phone,
        )
