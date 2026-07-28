# Copyright (c) 2026, L&S Custom Tailors and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


ITEM_GROUP = "Alteration Services"
ITEM_GROUP_PARENT = "Services"


def item_code_for(preset_name: str) -> str:
	return f"ALT-{frappe.scrub(preset_name).upper()[:50]}"


def ensure_item_group():
	if frappe.db.exists("Item Group", ITEM_GROUP):
		return
	frappe.get_doc(
		{
			"doctype": "Item Group",
			"item_group_name": ITEM_GROUP,
			"parent_item_group": ITEM_GROUP_PARENT,
			"is_group": 0,
		}
	).insert(ignore_permissions=True)


def create_service_item(preset_name: str, default_price: float, garment_type: str | None = None):
	"""Create a Service Item for a preset if it doesn't exist. Returns the item_code.

	If the item already exists but was disabled, re-enable it — ticket SI creation
	fails hard with 'Item X is disabled' and every preset was bulk-disabled once.
	"""
	item_code = item_code_for(preset_name)
	if frappe.db.exists("Item", item_code):
		if frappe.db.get_value("Item", item_code, "disabled"):
			frappe.db.set_value("Item", item_code, "disabled", 0, update_modified=False)
		return item_code
	ensure_item_group()
	desc = f"{garment_type} alteration: {preset_name}" if garment_type else preset_name
	frappe.get_doc(
		{
			"doctype": "Item",
			"item_code": item_code,
			"item_name": preset_name,
			"item_group": ITEM_GROUP,
			"stock_uom": "Nos",
			"is_stock_item": 0,
			"standard_rate": default_price or 0,
			"description": desc,
			"is_sales_item": 1,
		}
	).insert(ignore_permissions=True)
	return item_code


class AlterationPreset(Document):
	def get_item_code(self) -> str:
		return item_code_for(self.preset_name)


def create_matching_service_item(doc, method=None):
	"""after_insert hook on Alteration Preset — auto-creates the paired Service Item."""
	create_service_item(doc.preset_name, doc.default_price, doc.garment_type)
