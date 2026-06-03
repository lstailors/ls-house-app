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
