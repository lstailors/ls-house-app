import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_field


def execute():
    if not frappe.db.exists("DocType", "LSH SMS Settings"):
        return

    if frappe.db.exists("Custom Field", "LSH SMS Settings-bypass_twilio_signature_validation"):
        return

    create_custom_field(
        "LSH SMS Settings",
        {
            "fieldname": "bypass_twilio_signature_validation",
            "label": "Bypass Twilio Signature Validation",
            "fieldtype": "Check",
            "default": "0",
            "description": "Development only. Leave disabled in production.",
            "insert_after": "twilio_from_number",
        },
        ignore_validate=True,
    )
    frappe.clear_cache(doctype="LSH SMS Settings")
