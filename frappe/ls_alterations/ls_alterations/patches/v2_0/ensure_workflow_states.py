import frappe


def execute():
    """Ensure all Alteration Ticket workflow states + actions exist.

    Idempotent — safe to run multiple times.
    """
    STATES = [
        ("Received", "Info"),
        ("In Progress", "Warning"),
        ("Ready", "Success"),
        ("Picked Up", "Success"),
        ("Cancelled", "Danger"),
    ]
    for name, style in STATES:
        if not frappe.db.exists("Workflow State", name):
            frappe.get_doc({
                "doctype": "Workflow State",
                "workflow_state_name": name,
                "style": style,
            }).insert(ignore_permissions=True)

    ACTIONS = ["Start Work", "Mark Ready", "Mark Picked Up", "Cancel", "Reopen"]
    for action in ACTIONS:
        if not frappe.db.exists("Workflow Action Master", action):
            frappe.get_doc({
                "doctype": "Workflow Action Master",
                "workflow_action_name": action,
            }).insert(ignore_permissions=True)

    frappe.db.commit()
    print("Workflow states and actions verified")
