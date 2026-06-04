import frappe
from frappe import _


@frappe.whitelist(allow_guest=False)
def record_square_payment(invoice_id: str, square_payment_id: str, amount: float):
    """
    Called by the square-capture-payment Edge Function after Square confirms payment.
    Creates a Payment Entry against the Sales Invoice and submits it.

    Args:
        invoice_id: ERPNext Sales Invoice name, e.g. ACC-SINV-2026-00045
        square_payment_id: Square payment ID for audit trail
        amount: Payment amount as float, e.g. 125.00
    """
    invoice = frappe.get_doc("Sales Invoice", invoice_id)

    if invoice.docstatus != 1:
        frappe.throw(
            _(f"Invoice {invoice_id} is not submitted (docstatus={invoice.docstatus}). Cannot record payment."),
            frappe.ValidationError,
        )

    if invoice.outstanding_amount <= 0:
        frappe.throw(
            _(f"Invoice {invoice_id} already has no outstanding amount."),
            frappe.ValidationError,
        )

    mode_of_payment = "Square"
    if not frappe.db.exists("Mode of Payment", mode_of_payment):
        frappe.throw(
            _(f"Mode of Payment 'Square' does not exist in ERPNext. Please create it first."),
            frappe.DoesNotExistError,
        )

    mop_account = frappe.db.get_value(
        "Mode of Payment Account",
        {"parent": mode_of_payment, "company": invoice.company},
        "default_account",
    )

    if not mop_account:
        frappe.throw(
            _(f"No account configured for Mode of Payment 'Square' in company '{invoice.company}'."),
            frappe.ValidationError,
        )

    pe = frappe.new_doc("Payment Entry")
    pe.payment_type = "Receive"
    pe.posting_date = frappe.utils.today()
    pe.company = invoice.company
    pe.mode_of_payment = mode_of_payment
    pe.party_type = "Customer"
    pe.party = invoice.customer
    pe.paid_from = invoice.debit_to
    pe.paid_to = mop_account
    pe.paid_amount = amount
    pe.received_amount = amount
    pe.reference_no = square_payment_id
    pe.reference_date = frappe.utils.today()
    pe.remarks = f"Square payment {square_payment_id} for {invoice_id}"

    pe.append(
        "references",
        {
            "reference_doctype": "Sales Invoice",
            "reference_name": invoice_id,
            "allocated_amount": amount,
        },
    )

    pe.insert(ignore_permissions=True)
    pe.submit()

    frappe.logger().info(
        f"[square_integration] Payment Entry {pe.name} created for {invoice_id} — Square ID: {square_payment_id}"
    )

    return {
        "status": "success",
        "payment_entry": pe.name,
        "invoice_id": invoice_id,
        "square_payment_id": square_payment_id,
    }


@frappe.whitelist()
def send_payment_request_email(invoice_id: str):
    """
    Sends a payment request email for a Sales Invoice with a Pay Now link
    pointing to https://app.lstailors.com/pay/{invoice_id}.

    Call from the ERPNext UI via:
        frappe.call('square_integration.api.send_payment_request_email', { invoice_id: 'ACC-SINV-2026-00045' })

    Or trigger automatically via the 'Payment Request - Sales Invoice' Notification.
    """
    invoice = frappe.get_doc("Sales Invoice", invoice_id)

    if invoice.docstatus != 1:
        frappe.throw(_(f"Invoice {invoice_id} must be submitted before sending a payment request."))

    if invoice.outstanding_amount <= 0:
        frappe.throw(_(f"Invoice {invoice_id} has no outstanding amount."))

    pay_url = f"https://app.lstailors.com/pay/{invoice_id}"

    recipient_email = frappe.db.get_value("Customer", invoice.customer, "email_id")
    if not recipient_email:
        frappe.throw(_(f"No email address on file for customer '{invoice.customer}'."))

    subject = (
        f"Invoice {invoice_id} — "
        f"${invoice.outstanding_amount:.2f} due"
        + (f" {frappe.utils.formatdate(invoice.due_date)}" if invoice.due_date else "")
    )

    template_path = frappe.get_app_path(
        "square_integration", "templates", "emails", "payment_request.html"
    )
    with open(template_path, "r") as f:
        html_template = f.read()

    message = frappe.render_template(
        html_template,
        {"doc": invoice, "pay_url": pay_url},
    )

    frappe.sendmail(
        recipients=[recipient_email],
        subject=subject,
        message=message,
        reference_doctype="Sales Invoice",
        reference_name=invoice_id,
        now=True,
    )

    frappe.logger().info(
        f"[square_integration] Payment request email sent for {invoice_id} to {recipient_email}"
    )

    return {"status": "sent", "recipient": recipient_email, "pay_url": pay_url}
