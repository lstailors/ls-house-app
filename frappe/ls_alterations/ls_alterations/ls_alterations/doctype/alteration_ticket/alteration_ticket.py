# Copyright (c) 2026, L&S Custom Tailors and contributors
# For license information, please see license.txt

import frappe
import requests
from frappe.model.document import Document


# Origin -> Company mapping. Two separate LLCs per state for clean revenue
# recognition; using the user's default company would book HOU revenue under
# the NY entity.
ORIGIN_COMPANY = {
	"NYC": "L&S Tailors NY LLC",
	"HOU": "L&S Tailors TX, LLC",
}


class AlterationTicket(Document):
	pass


def set_naming_series(doc, method=None):
	if doc.origin_location == "NYC":
		doc.naming_series = "ALT-NYC-.YYYY.-"
	elif doc.origin_location == "HOU":
		doc.naming_series = "ALT-HOU-.YYYY.-"
	for i, g in enumerate(doc.garments or [], start=1):
		if not g.garment_id:
			g.garment_id = f"G{i}"


def ensure_rush_surcharge(doc, method=None):
	RUSH_PRICE = 25.0
	# Match both the new canonical description and the preset description
	def _is_rush_line(l):
		desc = (l.description or "").lower()
		return "rush surcharge" in desc or "rush surcharge (24hr)" in desc

	has_rush_line = any(_is_rush_line(l) for l in (doc.lines or []))
	if doc.is_rush and not has_rush_line:
		garment_ref = (doc.garments[0].garment_id if doc.garments else "G1")
		doc.append("lines", {
			"garment_ref": garment_ref,
			"description": "Rush Surcharge",
			"price": RUSH_PRICE,
		})
	elif not doc.is_rush:
		# Remove all rush lines (both naming variants) — idempotent
		doc.lines = [l for l in (doc.lines or []) if not _is_rush_line(l)]


def set_payment_status_na(doc, method=None):
	"""Set payment_status=N/A for Warranty/Included tickets so they never show as Unpaid."""
	if doc.billing_status in ("Warranty", "Included in Custom Order"):
		if doc.payment_status not in ("N/A",):
			doc.payment_status = "N/A"


def compute_totals(doc, method=None):
	garment_totals = {}
	for line in doc.lines or []:
		garment_totals[line.garment_ref] = garment_totals.get(line.garment_ref, 0) + (line.price or 0)
	for g in doc.garments or []:
		g.garment_total = garment_totals.get(g.garment_id, 0)
	doc.ticket_total = sum(garment_totals.values())

	# Auto-flip billing_status when a cost is entered on an "included" ticket.
	# Staff flipping included_in_custom off manually is also respected — we
	# only auto-set when the checkbox is on and total crosses the $0 boundary.
	if doc.included_in_custom:
		if (doc.ticket_total or 0) > 0:
			doc.billing_status = "Billable"
		else:
			doc.billing_status = "Included in Custom Order"


def rollup_line_to_garment(doc, method=None):
	"""Cascade line_status -> garment_status on save (validate hook).

	Rules per garment:
	  - All lines Done                       -> Ready
	  - Any line In Progress / mixed Done    -> In Progress (partial)
	  - All Pending (or no lines)            -> Received
	  - Never demote a garment at Picked Up (terminal, set by close-out)

	Lines with empty line_status default to Pending.

	The ticket-level cascade lives in cascade_ticket_workflow_state (on_update),
	not here — Frappe's workflow validator rejects direct workflow_state
	assignment during validate, and using frappe.db.set_value here would race
	with the in-flight save. on_update is the right hook for it.
	"""
	if not doc.garments:
		return

	statuses_by_garment = {}
	for line in doc.lines or []:
		if not line.line_status:
			line.line_status = "Pending"
		statuses_by_garment.setdefault(line.garment_ref, []).append(line.line_status)

	for g in doc.garments:
		if g.garment_status == "Picked Up":
			continue
		statuses = statuses_by_garment.get(g.garment_id, [])
		if not statuses:
			if not g.garment_status:
				g.garment_status = "Received"
			continue
		if all(s == "Done" for s in statuses):
			g.garment_status = "Ready"
		elif any(s == "In Progress" for s in statuses) or any(s == "Done" for s in statuses):
			g.garment_status = "In Progress"
		else:
			g.garment_status = "Received"


def ensure_custom_alteration_item():
	if frappe.db.exists("Item", "ALT-CUSTOM-ALTERATION"):
		return
	from ls_alterations.ls_alterations.doctype.alteration_preset.alteration_preset import ensure_item_group

	ensure_item_group()
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


def create_sales_invoice(doc, method=None):
	"""after_insert hook: create draft Sales Invoice mirroring ticket lines.

	Skipped when the ticket is included in a custom order AND the total is $0
	(staff warranty / complimentary work). If staff later adds a charge the
	billing_status flips to Billable, but the invoice must be created manually
	or via a future save-triggered path — we never auto-create a $0 invoice.
	"""
	if doc.sales_invoice:
		return

	# Skip invoice creation for non-billable tickets
	if doc.billing_status in ("Warranty", "Included in Custom Order"):
		# Set payment_status to "N/A" so it doesn't show as Unpaid forever
		frappe.db.set_value("Alteration Ticket", doc.name, "payment_status", "N/A", update_modified=False)
		return
	if doc.billing_status == "Billable" and not (doc.ticket_total or 0) > 0:
		return  # Billable but $0 — don't create invoice yet

	from ls_alterations.ls_alterations.doctype.alteration_preset.alteration_preset import item_code_for

	items = []
	for line in doc.lines or []:
		if line.preset:
			item_code = item_code_for(line.preset)
			# Auto-create the Service Item if a new preset slipped past the hook
			if not frappe.db.exists("Item", item_code):
				preset_doc = frappe.get_cached_doc("Alteration Preset", line.preset)
				from ls_alterations.ls_alterations.doctype.alteration_preset.alteration_preset import (
					create_service_item,
				)

				create_service_item(preset_doc.preset_name, preset_doc.default_price, preset_doc.garment_type)
		else:
			item_code = "ALT-CUSTOM-ALTERATION"
			ensure_custom_alteration_item()

		items.append(
			{
				"item_code": item_code,
				"item_name": (line.description or "")[:140],
				"description": line.description,
				"qty": 1,
				"rate": line.price or 0,
				"amount": line.price or 0,
				"uom": "Nos",
			}
		)

	if not items:
		return

	company = ORIGIN_COMPANY.get(doc.origin_location) or frappe.defaults.get_user_default("Company")

	invoice = frappe.get_doc(
		{
			"doctype": "Sales Invoice",
			"customer": doc.customer,
			"posting_date": doc.ticket_date,
			"due_date": doc.due_date,
			"company": company,
			"currency": "USD",
			"items": items,
			# Alteration services are non-taxable — explicitly clear the default
			# tax template so ERPNext never auto-applies NYC 8.875% or TX 8.25%.
			# Custom-made (Sales Orders) keep their tax templates unchanged.
			"taxes_and_charges": "",
			"taxes": [],
			"remarks": f"Auto-generated from Alteration Ticket {doc.name}. "
			f"Internal notes: {doc.internal_notes or '(none)'}",
			"alteration_ticket_ref": doc.name,
		}
	).insert(ignore_permissions=True)

	doc.db_set("sales_invoice", invoice.name, update_modified=False)


def handle_workflow_state_change(doc, method=None):
	"""on_update hook: sync ticket workflow state to Sales Invoice docstatus."""
	if not doc.has_value_changed("workflow_state"):
		return
	if not doc.sales_invoice:
		return

	invoice = frappe.get_doc("Sales Invoice", doc.sales_invoice)

	if doc.workflow_state == "Picked Up" and invoice.docstatus == 0:
		invoice.submit()
	elif doc.workflow_state == "Cancelled" and invoice.docstatus == 0:
		invoice.cancel()
	elif doc.workflow_state == "Cancelled" and invoice.docstatus == 1:
		frappe.log_error(
			f"Ticket {doc.name} cancelled but Sales Invoice {invoice.name} is already submitted. "
			"Manual credit note required.",
			"Alteration Ticket Cancel",
		)


def get_invoice_pdf_url(invoice_name):
	if not invoice_name:
		return None
	base = frappe.utils.get_url()
	return (
		f"{base}/api/method/frappe.utils.print_format.download_pdf"
		f"?doctype=Sales%20Invoice&name={invoice_name}&format=L%26S%20Alteration%20Invoice"
	)


def _post_json(url, payload, error_title):
	"""POST JSON to a webhook, serializing via frappe.as_json so dates/datetimes
	convert to strings cleanly. Errors are logged, never raised — webhooks must
	not break the caller (whether that's a hook chain or a background worker)
	over a webhook hiccup."""
	try:
		requests.post(
			url,
			data=frappe.as_json(payload),
			headers={"Content-Type": "application/json"},
			timeout=5,
		)
	except Exception as e:
		frappe.log_error(f"{error_title}: {e}", error_title)


def notify_n8n(doc, method=None):
	webhook = frappe.conf.get("n8n_alteration_webhook_url")
	if not webhook:
		return
	# Refresh to pick up sales_invoice set by create_sales_invoice
	doc.reload()
	payload = {
		"event": "alteration_ticket.created",
		"ticket": doc.as_dict(convert_dates_to_str=True),
		"sales_invoice": doc.sales_invoice,
		"invoice_pdf_url": get_invoice_pdf_url(doc.sales_invoice),
		"square_payment_url": frappe.conf.get("square_payment_url"),
		"customer_email": frappe.db.get_value("Customer", doc.customer, "email_id"),
	}
	# Defer the POST until after the parent transaction commits. Otherwise
	# n8n's callback into ERPNext races the commit and sees the just-created
	# Sales Invoice as DoesNotExist. after_commit runs in this same process
	# right after the SQL COMMIT, so no background worker is required.
	frappe.db.after_commit.add(
		lambda: _post_json(webhook, payload, "Alteration Ticket Webhook")
	)


def notify_n8n_on_state_change(doc, method=None):
	if not doc.has_value_changed("workflow_state"):
		return

	# Defensive guard (belt-and-suspenders alongside the n8n SMS node mute):
	# when mark_ready_and_notify completes, the dedicated notify-ready workflow
	# has ALREADY fired for the Ready transition. If any future code path
	# triggers an on_update where workflow_state ends up at Ready and
	# notified_ready_at is already set, this state-changed workflow must NOT
	# also fire — it would post a duplicate webhook (and even though the n8n
	# Build/Twilio Ready SMS nodes in EHmcgvHooNiYoUkH are disabled, the
	# defensive Switch node belt-and-suspenders adds another layer). Skip
	# entirely in that case. All other transitions (In Progress, Picked Up,
	# Cancelled, etc.) fall through to the normal post.
	if doc.workflow_state == "Ready" and doc.notified_ready_at:
		return

	# Run the invoice docstatus sync first, then notify n8n with the up-to-date state
	handle_workflow_state_change(doc, method)

	webhook = frappe.conf.get("n8n_alteration_webhook_url")
	if not webhook:
		return
	payload = {
		"event": "alteration_ticket.state_changed",
		"new_state": doc.workflow_state,
		"ticket_name": doc.name,
		"customer": doc.customer,
		"sales_invoice": doc.sales_invoice,
		"invoice_pdf_url": get_invoice_pdf_url(doc.sales_invoice),
		"square_payment_url": frappe.conf.get("square_payment_url"),
		"ticket": doc.as_dict(convert_dates_to_str=True),
	}
	frappe.db.after_commit.add(
		lambda: _post_json(webhook, payload, "Alteration Ticket Webhook")
	)


def get_so_dashboard_data(data):
	"""Inject Alteration Ticket into the Sales Order connections panel.

	Called via override_doctype_dashboards in hooks.py. Frappe passes the
	current dashboard data dict; we append our transaction group so every SO
	shows its linked alteration history in the Connections section.
	"""
	data["transactions"].append(
		{"label": "Alteration", "items": ["Alteration Ticket"]}
	)
	return data


@frappe.whitelist()
def pull_from_sales_order(so_name):
	"""Return summary data from a Sales Order so the client can populate the
	ticket form. The caller (alteration_ticket.js) sets linked_sales_order,
	included_in_custom, billing_status, and may update garment notes.

	Returns a dict with:
	  - customer: SO customer (for client-side mismatch warning)
	  - items: list of {item_code, item_name, qty, rate, description}
	  - grand_total
	  - transaction_date
	"""
	so = frappe.get_doc("Sales Order", so_name)
	frappe.has_permission("Sales Order", doc=so, throw=True)

	items = [
		{
			"item_code": row.item_code,
			"item_name": row.item_name,
			"qty": row.qty,
			"rate": row.rate,
			"description": row.description or "",
		}
		for row in so.items
	]

	return {
		"customer": so.customer,
		"customer_name": so.customer_name,
		"items": items,
		"grand_total": so.grand_total,
		"transaction_date": str(so.transaction_date),
	}


def auto_notify_when_all_ready(doc, method=None):
	"""on_update: enqueue advance_and_notify when all garments flip to Ready.

	Guards:
	  - ticket must be In Progress (not already Ready or terminal)
	  - every garment row must be status Ready
	  - notified_ready_at must be null (never double-fire)

	Uses enqueue_after_commit so garment rows are fully persisted before the
	background worker reads them, and to avoid a re-entrant save fighting the
	workflow engine.
	"""
	if doc.workflow_state != "In Progress":
		return
	if not doc.garments:
		return
	if not all(g.garment_status == "Ready" for g in doc.garments):
		return
	if doc.notified_ready_at:
		return

	frappe.enqueue(
		"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket.advance_and_notify",
		queue="short",
		enqueue_after_commit=True,
		ticket=doc.name,
	)


def advance_and_notify(ticket):
	"""Background worker: advance ticket to Ready and fire the notify webhook."""
	doc = frappe.get_doc("Alteration Ticket", ticket)

	# Re-check on fresh doc in case state changed while queued.
	if doc.workflow_state != "In Progress":
		return
	if not (doc.garments and all(g.garment_status == "Ready" for g in doc.garments)):
		return
	if doc.notified_ready_at:
		return

	from frappe.model.workflow import apply_workflow
	apply_workflow(doc, "Mark Ready")

	# Stamp notify time so auto_notify_when_all_ready never re-fires.
	frappe.db.set_value(
		"Alteration Ticket", doc.name, "notified_ready_at", frappe.utils.now()
	)

	notify_ready(doc.name)


def notify_ready(ticket):
	"""POST the ticket to n8n; n8n routes to Sofia/Twilio for the SMS."""
	import requests

	url = frappe.conf.get("n8n_ready_webhook")
	if not url:
		frappe.log_error(
			"n8n_ready_webhook not set in site_config.json",
			"Alteration auto-complete",
		)
		return

	doc = frappe.get_doc("Alteration Ticket", ticket)
	payload = {
		"event": "alteration_ticket.ready",
		"ticket": doc.name,
		"customer": doc.customer,
		"customer_name": doc.customer_name,
		"customer_phone": doc.customer_phone,
		"origin_location": doc.origin_location,
		"garment_count": len(doc.garments),
		"ticket_total": doc.ticket_total,
		"promised_date": str(doc.promised_date or ""),
		"delivery_method": doc.delivery_method,
	}
	try:
		requests.post(url, json=payload, timeout=10)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Alteration ready webhook failed")
