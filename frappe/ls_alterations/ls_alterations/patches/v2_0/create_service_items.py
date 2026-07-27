import frappe

from ls_alterations.ls_alterations.doctype.alteration_preset.alteration_preset import (
	create_service_item,
	ensure_item_group,
)


def execute():
	"""Create one Service Item per Alteration Preset, plus the generic ALT-CUSTOM-ALTERATION fallback."""
	ensure_item_group()
	presets = frappe.get_all(
		"Alteration Preset",
		fields=["name", "preset_name", "default_price", "garment_type"],
	)
	for p in presets:
		create_service_item(p["preset_name"], p["default_price"], p.get("garment_type"))
	frappe.db.commit()

	if not frappe.db.exists("Item", "ALT-CUSTOM-ALTERATION"):
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": "ALT-CUSTOM-ALTERATION",
				"item_name": "Custom Alteration",
				"item_group": "Alteration Services",
				"stock_uom": "Nos",
				"is_stock_item": 0,
				"standard_rate": 0,
				"description": "Custom alteration not matching standard presets",
			}
		).insert(ignore_permissions=True)
		frappe.db.commit()

	print(f"Service Items created/verified for {len(presets)} presets + custom fallback")
