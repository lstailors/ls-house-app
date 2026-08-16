# Copyright (c) 2026, L&S Custom Tailors and contributors
# For license information, please see license.txt

import json

import frappe

from ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket import (
	get_invoice_pdf_url,
)


@frappe.whitelist()
def create_ticket(payload):
	"""Atomic ticket creation from dashboard /intake.

	payload schema:
	{
	  "customer": "CUST-001" or null,
	  "new_customer": {"customer_name": "...", "mobile_no": "..."} or null,
	  "origin_location": "NYC" | "HOU",
	  "ticket_date": "2026-05-27",
	  "due_date": "2026-06-03",
	  "is_rush": false,
	  "idempotency_key": "uuid" (optional — duplicate submit returns same ticket),
	  "billing_status": "Billable" | "Warranty" | "Included in Custom Order",
	  "included_in_custom": 0 | 1,
	  "linked_sales_order": "SO-..." or null,
	  "garments": [
	    {"garment_type": "Jacket", "garment_description": "Navy 2-btn", "color": "Navy"},
	    ...
	  ],
	  "lines": [
	    {"garment_ref": "G1", "preset": "Shorten sleeve - jacket",
	     "description": "...", "price": 35.00, "tailor": null},
	    ...
	  ],
	  "internal_notes": "..."
	}

	Returns:
	{
	  "name": "ALT-NYC-2026-00001",
	  "ticket_total": 95.00,
	  "sales_invoice": "ACC-SINV-..." or null,
	  "invoice_pdf_url": "https://erp.lstailors.com/api/method/...",
	  "square_payment_url": "https://square.link/u/NyvWei4e",
	  "idempotent": true  # only when replayed via idempotency_key
	}
	"""
	if isinstance(payload, str):
		payload = json.loads(payload)

	idem_key = (payload.get("idempotency_key") or payload.get("idempotencyKey") or "").strip()
	if idem_key:
		# Field may not exist until ls_alterations is migrated — fail open (no dedupe) rather than 500.
		try:
			has_field = frappe.get_meta("Alteration Ticket").has_field("idempotency_key")
		except Exception:
			has_field = False
		if has_field:
			existing = frappe.db.get_value(
				"Alteration Ticket",
				{"idempotency_key": idem_key},
				["name", "ticket_total", "sales_invoice"],
				as_dict=True,
			)
			if existing:
				return {
					"name": existing.name,
					"ticket_total": existing.ticket_total,
					"sales_invoice": existing.sales_invoice,
					"invoice_pdf_url": get_invoice_pdf_url(existing.sales_invoice),
					"square_payment_url": frappe.conf.get("square_payment_url"),
					"idempotent": True,
				}
		else:
			idem_key = ""  # don't attempt to write unknown field

	customer = payload.get("customer")
	if not customer and payload.get("new_customer"):
		nc = payload["new_customer"]
		customer_doc = frappe.get_doc(
			{
				"doctype": "Customer",
				"customer_name": nc["customer_name"],
				"customer_type": "Individual",
				"mobile_no": nc.get("mobile_no"),
			}
		).insert(ignore_permissions=False)
		customer = customer_doc.name

	if not customer:
		frappe.throw("Customer or new_customer required")

	ticket_dict = {
		"doctype": "Alteration Ticket",
		"customer": customer,
		"origin_location": payload["origin_location"],
		"ticket_date": payload["ticket_date"],
		"due_date": payload["due_date"],
		"promised_date": payload.get("promised_date"),
		"is_rush": payload.get("is_rush", False),
		"workflow_state": "Received",
		"garments": payload["garments"],
		"lines": payload["lines"],
		"internal_notes": payload.get("internal_notes"),
		"customer_notes": payload.get("customer_notes"),
		# Billing intent — skip SI for Warranty / Included (create_sales_invoice checks these)
		"billing_status": payload.get("billing_status") or "Billable",
		"included_in_custom": 1 if payload.get("included_in_custom") else 0,
		"linked_sales_order": payload.get("linked_sales_order"),
	}
	if idem_key:
		ticket_dict["idempotency_key"] = idem_key

	ticket = frappe.get_doc(ticket_dict).insert()

	# Pick up sales_invoice that create_sales_invoice set via db_set
	ticket.reload()

	return {
		"name": ticket.name,
		"ticket_total": ticket.ticket_total,
		"sales_invoice": ticket.sales_invoice,
		"invoice_pdf_url": get_invoice_pdf_url(ticket.sales_invoice),
		"square_payment_url": frappe.conf.get("square_payment_url"),
	}


@frappe.whitelist()
def get_active_presets(origin_location=None):
	"""Return all active presets, optionally with HOU pricing as display_price."""
	presets = frappe.get_all(
		"Alteration Preset",
		filters={"is_active": 1},
		fields=[
			"name",
			"preset_name",
			"garment_type",
			"alteration_category",
			"default_price",
			"default_price_hou",
			"estimated_minutes",
		],
		order_by="garment_type, alteration_category, preset_name",
	)
	if origin_location == "HOU":
		for p in presets:
			p["display_price"] = p.get("default_price_hou") or p.get("default_price")
	else:
		for p in presets:
			p["display_price"] = p.get("default_price")
	return presets


@frappe.whitelist()
def search_customers(query, limit=10):
	"""Customer search for intake autocomplete. Matches name, mobile, email."""
	if not query or len(query) < 2:
		return []
	return frappe.db.sql(
		"""
		SELECT name, customer_name, mobile_no, email_id
		FROM `tabCustomer`
		WHERE customer_name LIKE %(q)s
		   OR mobile_no LIKE %(q)s
		   OR email_id LIKE %(q)s
		LIMIT %(limit)s
		""",
		{"q": f"%{query}%", "limit": int(limit)},
		as_dict=True,
	)


@frappe.whitelist()
def mark_ready_and_notify(ticket_name):
	"""Called by the 'Mark Ticket Complete & Notify Customer' button on the
	master ticket scan. The single explicit gate that promotes a ticket from
	Received/In Progress to Ready AND fires the customer SMS in one atomic
	action.

	Preconditions checked in order; first failure short-circuits:
	  1. notified_ready_at must NOT be set already (idempotency / anti-double-fire)
	     -> returns {"ok": False, "error": "already_notified", "notified_at": <ts>}
	  2. ALL garments must have garment_status == "Ready" (staff verified the
	     physical work matches what the line-level Done flags say)
	     -> returns {"ok": False, "error": "outstanding_garments",
	                 "outstanding": ["G2", "G3"]}

	On success:
	  - Sets notified_ready_at = now() via db_set (skips validate, no recursive
	    rollup)
	  - Flips workflow_state to Ready via raw SQL (bypasses Frappe's workflow
	    validator — staff verification IS the transition, not a workflow_action)
	  - Fires the dedicated wf-alteration-ticket-notify-ready n8n workflow via
	    frappe.db.after_commit so the payload sees the saved row
	  - Returns {"ok": True, "notified_at": <ts>, "webhook_configured": bool}
	"""
	from ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket import (
		_post_json,
	)

	ticket = frappe.get_doc("Alteration Ticket", ticket_name)

	if ticket.notified_ready_at:
		return {
			"ok": False,
			"error": "already_notified",
			"notified_at": str(ticket.notified_ready_at),
		}

	outstanding = [
		g.garment_id
		for g in (ticket.garments or [])
		if g.garment_status != "Ready"
	]
	if outstanding:
		return {
			"ok": False,
			"error": "outstanding_garments",
			"outstanding": outstanding,
		}

	now = frappe.utils.now()
	ticket.db_set("notified_ready_at", now, update_modified=True)
	# Raw SQL flip to bypass Frappe's workflow validator. The cascade hook that
	# used to auto-promote was removed in Batch C-revised; workflow_state now
	# changes ONLY via this explicit staff-button path (or Picked Up close-out,
	# or Cancelled).
	if ticket.workflow_state != "Ready":
		frappe.db.sql(
			"UPDATE `tabAlteration Ticket` SET workflow_state = %s WHERE name = %s",
			("Ready", ticket.name),
		)

	webhook = frappe.conf.get("n8n_notify_ready_webhook_url")
	if webhook:
		payload = {
			"event": "notify_ready",
			"ticket_name": ticket.name,
			"customer": ticket.customer,
			"customer_name": ticket.customer_name,
			"customer_phone": frappe.db.get_value("Customer", ticket.customer, "mobile_no"),
			"customer_email": frappe.db.get_value("Customer", ticket.customer, "email_id"),
			"origin_location": ticket.origin_location,
			"garment_count": len(ticket.garments or []),
			"is_rush": bool(ticket.is_rush),
			"sales_invoice": ticket.sales_invoice,
			"invoice_pdf_url": get_invoice_pdf_url(ticket.sales_invoice),
			"due_date": str(ticket.due_date) if ticket.due_date else None,
			"notified_at": now,
		}
		frappe.db.after_commit.add(
			lambda: _post_json(webhook, payload, "Alteration Ticket Notify Ready")
		)

	return {
		"ok": True,
		"notified_at": now,
		"webhook_configured": bool(webhook),
	}


@frappe.whitelist()
def record_payment(ticket_name, amount, payment_method, square_transaction_id=None):
	"""
	Creates and submits a Payment Entry against the ticket's linked Sales Invoice,
	then stamps the ticket with square_transaction_id, paid_at, paid_by_employee.

	payment_method: one of 'Card Present', 'Card Not Present', 'Card on File',
	'Cash', 'Other'
	"""
	ticket = frappe.get_doc("Alteration Ticket", ticket_name)
	if not ticket.sales_invoice:
		frappe.throw("No invoice linked to this ticket")
	if ticket.billing_status in ("Warranty", "Included in Custom Order"):
		frappe.throw("This ticket is not billable")

	inv = frappe.get_doc("Sales Invoice", ticket.sales_invoice)
	company = inv.company

	# Find a Payment Account for Square or fall back to default cash account
	payment_account = frappe.db.get_value(
		"Account",
		{"account_name": ["like", "%Square%"], "company": company, "account_type": "Bank"},
		"name",
	) or frappe.db.get_value(
		"Account",
		{"account_type": "Cash", "company": company},
		"name",
	)

	pe = frappe.get_doc(
		{
			"doctype": "Payment Entry",
			"payment_type": "Receive",
			"party_type": "Customer",
			"party": ticket.customer,
			"paid_to": payment_account,
			"paid_amount": float(amount),
			"received_amount": float(amount),
			"company": company,
			"references": [
				{
					"reference_doctype": "Sales Invoice",
					"reference_name": ticket.sales_invoice,
					"allocated_amount": float(amount),
				}
			],
			"mode_of_payment": "Cash",
			"remarks": f"Payment for Alteration Ticket {ticket_name} via {payment_method}",
		}
	)
	pe.insert(ignore_permissions=True)
	pe.submit()

	# Stamp ticket with payment metadata
	frappe.db.set_value(
		"Alteration Ticket",
		ticket_name,
		{
			"square_transaction_id": square_transaction_id or "",
			"square_payment_method": payment_method,
			"paid_at": frappe.utils.now(),
			"paid_by_employee": frappe.db.get_value(
				"Employee", {"user_id": frappe.session.user}, "name"
			),
			"payment_status": "Paid",
		},
	)

	return {"payment_entry": pe.name}


def sync_payment_to_ticket(doc, method=None):
	"""Payment Entry on_submit hook: update payment_status on linked Alteration Ticket."""
	if doc.payment_type != "Receive":
		return
	for ref in doc.references or []:
		if ref.reference_doctype != "Sales Invoice":
			continue
		ticket_name = frappe.db.get_value(
			"Alteration Ticket", {"sales_invoice": ref.reference_name}, "name"
		)
		if not ticket_name:
			continue
		invoice = frappe.get_doc("Sales Invoice", ref.reference_name)
		if invoice.outstanding_amount <= 0:
			new_status = "Paid"
		elif invoice.outstanding_amount < invoice.grand_total:
			new_status = "Partially Paid"
		else:
			new_status = "Unpaid"
		frappe.db.set_value("Alteration Ticket", ticket_name, "payment_status", new_status)


# ── Thermal print (Epson TM-M30ii) ──────────────────────────────────────────
# Templates live in ls_thermal/. Frappe calls /api/method/<dotted.path>; some
# benches fail to import ls_alterations.ls_thermal as a package. These wrappers
# sit on ls_alterations.api (same module as create_ticket) so print stays wired.


def _thermal_api():
	"""Load escpos print helpers — try the package paths used on this bench."""
	import importlib

	errors = []
	for mod in (
		"ls_alterations.ls_thermal.api",
		"ls_alterations.ls_alterations.ls_thermal.api",
	):
		try:
			return importlib.import_module(mod)
		except ModuleNotFoundError as e:
			errors.append("{}: {}".format(mod, e))
	try:
		from . import ls_thermal as pkg
		return importlib.import_module(pkg.__name__ + ".api")
	except Exception as e:
		errors.append("relative: {}".format(e))
	frappe.throw(
		"Thermal print module is not importable on this bench. Tried: "
		+ "; ".join(errors)
	)


@frappe.whitelist()
def print_ticket(ticket, what="all", reprint=0):
	return _thermal_api().print_ticket(ticket, what=what, reprint=reprint)


@frappe.whitelist()
def print_payment_receipt(invoice, reprint=0):
	return _thermal_api().print_payment_receipt(invoice, reprint=reprint)


@frappe.whitelist()
def print_pay_link(ticket=None, invoice=None, reprint=0):
	return _thermal_api().print_pay_link(ticket=ticket, invoice=invoice, reprint=reprint)


@frappe.whitelist()
def test_printer():
	return _thermal_api().test_printer()

