import frappe


def execute():
    if not frappe.db.exists("DocType", "LSH SMS Settings"):
        return

    frappe.db.set_value(
        "DocField",
        {
            "parent": "LSH SMS Settings",
            "fieldname": "twilio_auth_token",
        },
        "fieldtype",
        "Password",
        update_modified=False,
    )

    frappe.clear_cache(doctype="LSH SMS Settings")
