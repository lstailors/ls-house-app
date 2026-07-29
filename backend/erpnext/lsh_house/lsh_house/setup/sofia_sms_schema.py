"""Schema for the Hermes `sofia-sms` build (2026-07-29).

Idempotent. Recreates everything that was applied by hand to erp.lstailors.com
during Phase 1 of SOFIA-SMS-HERMES-FULL-BUILD-SPEC.md:

  1. Custom Fields on `LSH Escalation` — the shipped doctype had only
     client_phone / client_name / reason / status / resolved_at, while the old
     Node handler wrote seven fields that did not exist. Those writes were
     silently dropped and the escalation answer loop never reached the client.
  2. `status` on `LSH Escalation` promoted Data -> Select via Property Setter.
  3. `LSH SMS Thread Control` — the human-takeover flag. Nothing like it existed
     before: the console hard-coded `sofiaActive: true` and the message handler
     never consulted any store.
  4. `LSH SMS Staff` — Carl-editable roster for the Phase 9 staff lane, so
     names and numbers change without a deploy.

Both new doctypes are created with `custom=1`, so they live in the database and
`bench migrate` will not touch them. This file is the reproducible record.

Run:
    bench --site erp.lstailors.com execute \
        lsh_house.lsh_house.setup.sofia_sms_schema.execute
"""

import frappe

ESCALATION_FIELDS = [
	{"fieldname": "customer", "label": "Customer", "fieldtype": "Link",
	 "options": "Customer", "insert_after": "client_name"},
	{"fieldname": "summary", "label": "Summary (Client Question)",
	 "fieldtype": "Small Text", "insert_after": "reason"},
	{"fieldname": "severity", "label": "Severity", "fieldtype": "Select",
	 "options": "normal\nemergency", "default": "normal", "insert_after": "reason"},
	{"fieldname": "source_channel", "label": "Source Channel", "fieldtype": "Select",
	 "options": "sms\nvoice\napp", "default": "sms", "insert_after": "reason"},
	{"fieldname": "c_reply_raw", "label": "Carl Reply (Raw)", "fieldtype": "Text",
	 "insert_after": "status"},
	{"fieldname": "sofia_rewritten", "label": "Sofia Rewritten", "fieldtype": "Text",
	 "insert_after": "status"},
	{"fieldname": "opened_at", "label": "Opened At", "fieldtype": "Datetime",
	 "insert_after": "status"},
	{"fieldname": "expires_at", "label": "Expires At", "fieldtype": "Datetime",
	 "insert_after": "status"},
	{"fieldname": "carl_replied_at", "label": "Carl Replied At", "fieldtype": "Datetime",
	 "insert_after": "status"},
	# Set by the sweeper so the ~12-minute nudge goes out exactly once.
	{"fieldname": "repinged_at", "label": "Re-pinged At", "fieldtype": "Datetime",
	 "insert_after": "status"},
	{"fieldname": "voice_call_sid", "label": "Voice Call SID", "fieldtype": "Data",
	 "insert_after": "status"},
]

# pending -> waiting_carl -> answered, or cancelled / expired.
ESCALATION_STATUSES = "pending\nwaiting_carl\nanswered\ncancelled\nexpired"

THREAD_CONTROL_FIELDS = [
	{"fieldname": "client_phone", "label": "Client Phone", "fieldtype": "Data",
	 "reqd": 1, "unique": 1, "in_list_view": 1},
	{"fieldname": "ai_enabled", "label": "AI Enabled", "fieldtype": "Check",
	 "default": "1", "in_list_view": 1},
	{"fieldname": "taken_over_by", "label": "Taken Over By", "fieldtype": "Link",
	 "options": "User", "in_list_view": 1},
	{"fieldname": "taken_over_at", "label": "Taken Over At", "fieldtype": "Datetime"},
	{"fieldname": "released_at", "label": "Released At", "fieldtype": "Datetime"},
	{"fieldname": "note", "label": "Note", "fieldtype": "Small Text"},
]

STAFF_FIELDS = [
	{"fieldname": "phone", "label": "Phone (E.164)", "fieldtype": "Data",
	 "reqd": 1, "unique": 1, "in_list_view": 1},
	{"fieldname": "staff_name", "label": "Staff Name", "fieldtype": "Data",
	 "reqd": 1, "in_list_view": 1},
	{"fieldname": "role", "label": "Role", "fieldtype": "Data", "in_list_view": 1},
	{"fieldname": "active", "label": "Active", "fieldtype": "Check",
	 "default": "1", "in_list_view": 1},
]

ROLES = ("System Manager", "LST Super Admin")


def _add_custom_fields():
	for spec in ESCALATION_FIELDS:
		name = f"LSH Escalation-{spec['fieldname']}"
		if frappe.db.exists("Custom Field", name):
			continue
		frappe.get_doc(dict(doctype="Custom Field", dt="LSH Escalation", **spec)).insert()
		print(f"  + Custom Field {name}")


def _set_status_select():
	for prop, value, ptype in (
		("fieldtype", "Select", "Data"),
		("options", ESCALATION_STATUSES, "Text"),
	):
		name = f"LSH Escalation-status-{prop}"
		if frappe.db.exists("Property Setter", name):
			continue
		frappe.get_doc({
			"doctype": "Property Setter",
			"doctype_or_field": "DocField",
			"doc_type": "LSH Escalation",
			"field_name": "status",
			"property": prop,
			"value": value,
			"property_type": ptype,
		}).insert()
		print(f"  + Property Setter {name}")


def _create_doctype(name, autoname_field, fields):
	if frappe.db.exists("DocType", name):
		return
	frappe.get_doc({
		"doctype": "DocType",
		"name": name,
		"module": "LSH House",
		# custom=1 keeps this in the database; `bench migrate` will not touch it.
		"custom": 1,
		"naming_rule": "By fieldname",
		"autoname": f"field:{autoname_field}",
		"track_changes": 1,
		"fields": fields,
		"permissions": [
			{"role": r, "read": 1, "write": 1, "create": 1, "delete": 1} for r in ROLES
		],
	}).insert()
	print(f"  + DocType {name}")


def execute():
	_add_custom_fields()
	_set_status_select()
	# One row per phone: autoname on the phone makes the takeover check a
	# single primary-key read, and makes a duplicate row impossible.
	_create_doctype("LSH SMS Thread Control", "client_phone", THREAD_CONTROL_FIELDS)
	_create_doctype("LSH SMS Staff", "phone", STAFF_FIELDS)
	frappe.db.commit()
	print("sofia_sms_schema: done")
