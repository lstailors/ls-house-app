from frappe import _


def get_data():
    return [
        {
            "module_name": "Square Integration",
            "category": "Modules",
            "label": _("Square Integration"),
            "color": "#B08D57",
            "icon": "octicon octicon-credit-card",
            "type": "module",
            "description": "Square payment capture for ERPNext Sales Invoices",
        }
    ]
