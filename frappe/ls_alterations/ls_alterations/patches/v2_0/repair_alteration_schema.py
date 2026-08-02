"""Repair the Alts intake/payment schema contract on existing sites."""

import frappe

LINE_FIELD_TYPES = {
	"estimated_minutes": "Int",
	"client_line_key": "Data",
	"line_photos": "Long Text",
}
PAYMENT_METHOD = "Card on File"


def _reload_alteration_doctypes():
	# Force import from the versioned JSON even when a site's DocType metadata
	# predates the fields. This also creates the missing child-table columns.
	frappe.reload_doc("ls_alterations", "doctype", "alteration_ticket_line", force=True)
	frappe.reload_doc("ls_alterations", "doctype", "alteration_ticket", force=True)
	frappe.clear_cache(doctype="Alteration Ticket Line")
	frappe.clear_cache(doctype="Alteration Ticket")


def _validate_schema():
	line_meta = frappe.get_meta("Alteration Ticket Line", cached=False)
	missing = []
	for fieldname, expected_type in LINE_FIELD_TYPES.items():
		field = line_meta.get_field(fieldname)
		if not field:
			missing.append(fieldname)
		elif field.fieldtype != expected_type:
			frappe.throw(
				f"Alteration Ticket Line.{fieldname} is {field.fieldtype}; expected {expected_type}"
			)

	if missing:
		frappe.throw(f"Alteration Ticket Line schema repair failed; missing: {', '.join(missing)}")

	payment_field = frappe.get_meta("Alteration Ticket", cached=False).get_field(
		"square_payment_method"
	)
	options = (payment_field.options or "").splitlines() if payment_field else []
	if PAYMENT_METHOD not in options:
		frappe.throw(
			f"Alteration Ticket.square_payment_method is missing {PAYMENT_METHOD!r}"
		)


def execute():
	"""Synchronize and verify intake persistence fields plus COF provenance."""
	_reload_alteration_doctypes()
	_validate_schema()
