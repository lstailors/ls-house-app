"""
One-shot setup for booking scaffold:
  - duration_minutes on LSH Appointment Type
  - weekly_schedule + public_bookable on LSH Booking Agent
  - seed durations per Jul 2026 spec
  - seed public flags + Sal part-time scaffold schedule

Run:
  bench --site erp.lstailors.com execute lsh_house.api.booking_setup.ensure_booking_schema
"""

from __future__ import annotations

import json

import frappe


def _ensure_custom_field(dt: str, fieldname: str, df: dict):
	existing = frappe.db.exists("Custom Field", {"dt": dt, "fieldname": fieldname})
	if existing:
		return existing
	doc = frappe.get_doc(
		{
			"doctype": "Custom Field",
			"dt": dt,
			"module": "LS House",
			"fieldname": fieldname,
			**df,
		}
	)
	doc.insert(ignore_permissions=True)
	return doc.name


def ensure_booking_schema():
	"""Idempotent schema + seed for availability engine."""
	# ── Type: duration_minutes ────────────────────────────────────────────
	_ensure_custom_field(
		"LSH Appointment Type",
		"duration_minutes",
		{
			"label": "Duration (minutes)",
			"fieldtype": "Int",
			"insert_after": "needs_room",
			"description": "Slot length for this visit type. Consultation=60, Fitting=30, Alterations=15.",
		},
	)

	# ── Agent: public_bookable + weekly_schedule ──────────────────────────
	_ensure_custom_field(
		"LSH Booking Agent",
		"public_bookable",
		{
			"label": "Publicly Bookable",
			"fieldtype": "Check",
			"default": "0",
			"insert_after": "active",
			"description": "Show on book.lstailors.com tailor picker.",
		},
	)
	_ensure_custom_field(
		"LSH Booking Agent",
		"weekly_schedule",
		{
			"label": "Weekly Schedule (JSON)",
			"fieldtype": "Long Text",
			"insert_after": "public_bookable",
			"description": (
				'JSON array of {day, from, to}. Empty = full store hours. '
				'Example: [{"day":"Tuesday","from":"10:00","to":"15:00"}]'
			),
		},
	)

	frappe.clear_cache(doctype="LSH Appointment Type")
	frappe.clear_cache(doctype="LSH Booking Agent")
	frappe.db.commit()

	# ── Seed durations ────────────────────────────────────────────────────
	duration_seed = {
		"Initial Consultation": 60,
		"Bespoke Consultation": 60,
		"Fitting Appointment": 30,
		"Alterations Appointment": 15,
		"New Client Phone Consultation": 30,
		"Virtual Consultation": 30,
		"Customer Exchange": 15,
		"Final Pickup": 15,
		"Pickups and Deliveries": 15,
	}
	for name, mins in duration_seed.items():
		if frappe.db.exists("LSH Appointment Type", name):
			frappe.db.set_value("LSH Appointment Type", name, "duration_minutes", mins, update_modified=False)

	# Ensure needs_room on the three room types
	for name in ("Initial Consultation", "Bespoke Consultation", "Fitting Appointment", "Alterations Appointment"):
		if frappe.db.exists("LSH Appointment Type", name):
			frappe.db.set_value("LSH Appointment Type", name, "needs_room", 1, update_modified=False)

	# ── Seed public agents + schedules ────────────────────────────────────
	# Store hours reference (from Appointment Booking Slots): Mon–Fri 9–17, Sat 9–15
	# Spec public picker: Carl, Sal, Christopher. Kelvin = HOU (not public NYC).
	full_week = [
		{"day": "Monday", "from": "09:00", "to": "17:00"},
		{"day": "Tuesday", "from": "09:00", "to": "17:00"},
		{"day": "Wednesday", "from": "09:00", "to": "17:00"},
		{"day": "Thursday", "from": "09:00", "to": "17:00"},
		{"day": "Friday", "from": "09:00", "to": "17:00"},
		{"day": "Saturday", "from": "09:00", "to": "15:00"},
	]
	# Sal part-time scaffold — CONFIRM with C. Tue/Thu/Fri 10–15 until real hours land.
	sal_part_time = [
		{"day": "Tuesday", "from": "10:00", "to": "15:00"},
		{"day": "Thursday", "from": "10:00", "to": "15:00"},
		{"day": "Friday", "from": "10:00", "to": "15:00"},
	]

	agent_seed = {
		"carl@lstailors.com": {"public": 1, "schedule": full_week},
		"chris@ckcny.com": {"public": 1, "schedule": full_week},
		"sal@lstailors.com": {"public": 1, "schedule": sal_part_time},
		"kelvin@lstailors.com": {"public": 0, "schedule": None},
	}

	for email, cfg in agent_seed.items():
		name = frappe.db.get_value("LSH Booking Agent", {"agent_user": email}, "name")
		if not name:
			continue
		frappe.db.set_value("LSH Booking Agent", name, "public_bookable", cfg["public"], update_modified=False)
		if cfg["schedule"] is not None:
			frappe.db.set_value(
				"LSH Booking Agent",
				name,
				"weekly_schedule",
				json.dumps(cfg["schedule"]),
				update_modified=False,
			)

	frappe.db.commit()
	return {
		"ok": True,
		"duration_seed": duration_seed,
		"sal_schedule_note": "Scaffold Tue/Thu/Fri 10–15 — replace with Sal's real part-time hours",
	}
