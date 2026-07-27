import frappe

from ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket import (
	create_sales_invoice,
)


def execute():
	"""Backfill Sales Invoices for any Alteration Ticket created before v2 (no sales_invoice link).

	Idempotent: create_sales_invoice short-circuits if doc.sales_invoice is already set.
	"""
	tickets = frappe.get_all(
		"Alteration Ticket",
		filters={"sales_invoice": ["in", ["", None]]},
		fields=["name"],
		order_by="creation",
	)
	count = 0
	for t in tickets:
		doc = frappe.get_doc("Alteration Ticket", t["name"])
		try:
			create_sales_invoice(doc)
			count += 1
		except Exception as e:
			frappe.log_error(
				f"Backfill failed for ticket {t['name']}: {e}",
				"Alteration Ticket v2 Backfill",
			)
	frappe.db.commit()
	print(f"Backfilled invoices for {count} of {len(tickets)} tickets")
