"""Add Mobile Device ID on Square Integration Settings for handheld readers."""

import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	if not frappe.db.exists("DocType", "Square Integration Settings"):
		return

	create_custom_fields(
		{
			"Square Integration Settings": [
				{
					"fieldname": "mobile_device_id",
					"label": "Mobile Device ID",
					"fieldtype": "Data",
					"insert_after": "device_id",
					"description": (
						"Square Terminal API device id for the handheld / mobile reader. "
						"Used when checkout is sent with device=mobile."
					),
				}
			]
		},
		ignore_validate=True,
		update=True,
	)
	frappe.clear_cache(doctype="Square Integration Settings")
