import os

import frappe


PRINT_FORMAT_NAME = "L&S Alteration Invoice"
SLUG = "l_s_alteration_invoice"


def _read_source(filename: str) -> str:
	app_path = frappe.get_app_path("ls_alterations")
	path = os.path.join(app_path, "ls_alterations", "print_format", SLUG, filename)
	with open(path) as f:
		return f.read()


def execute():
	"""Install or refresh the L&S Alteration Invoice print format from disk."""
	html = _read_source(f"{SLUG}.html")
	css = _read_source(f"{SLUG}.css")

	if frappe.db.exists("Print Format", PRINT_FORMAT_NAME):
		doc = frappe.get_doc("Print Format", PRINT_FORMAT_NAME)
		doc.html = html
		doc.css = css
		doc.disabled = 0
		doc.print_format_type = "Jinja"
		doc.standard = "Yes"
		doc.module = "LS Alterations"
		doc.doc_type = "Sales Invoice"
		doc.save(ignore_permissions=True)
		action = "updated"
	else:
		frappe.get_doc(
			{
				"doctype": "Print Format",
				"name": PRINT_FORMAT_NAME,
				"doc_type": "Sales Invoice",
				"print_format_type": "Jinja",
				"standard": "Yes",
				"module": "LS Alterations",
				"disabled": 0,
				"html": html,
				"css": css,
			}
		).insert(ignore_permissions=True)
		action = "created"

	frappe.db.commit()
	print(f"Print Format '{PRINT_FORMAT_NAME}' {action}")
