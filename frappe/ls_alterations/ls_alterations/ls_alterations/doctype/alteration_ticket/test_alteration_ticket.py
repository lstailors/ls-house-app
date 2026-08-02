# Copyright (c) 2026, L&S Custom Tailors and contributors
# See license.txt

import datetime
import unittest
from unittest.mock import MagicMock, patch

import frappe


def _today():
	return datetime.date.today().isoformat()


def _due(days=14):
	return (datetime.date.today() + datetime.timedelta(days=days)).isoformat()


def _ensure_customer(name="Test Alteration Customer"):
	existing = frappe.db.exists("Customer", name)
	if existing:
		return existing
	doc = frappe.get_doc(
		{
			"doctype": "Customer",
			"customer_name": name,
			"customer_type": "Individual",
			"mobile_no": "+15555550000",
		}
	).insert(ignore_permissions=True)
	return doc.name


def _ensure_preset(name="Test Hem Trouser", price=25.00):
	if frappe.db.exists("Alteration Preset", name):
		return name
	frappe.get_doc(
		{
			"doctype": "Alteration Preset",
			"preset_name": name,
			"garment_type": "Trouser",
			"alteration_category": "Hem",
			"default_price": price,
			"estimated_minutes": 30,
			"is_active": 1,
		}
	).insert(ignore_permissions=True)
	return name


class TestAlterationTicket(unittest.TestCase):
	def setUp(self):
		self.customer = _ensure_customer()
		self.preset = _ensure_preset()

	def tearDown(self):
		frappe.db.rollback()

	def test_live_schema_supports_intake_persistence_and_card_on_file(self):
		line_meta = frappe.get_meta("Alteration Ticket Line", cached=False)
		expected_fields = {
			"estimated_minutes": "Int",
			"client_line_key": "Data",
			"line_photos": "Long Text",
		}
		for fieldname, expected_type in expected_fields.items():
			field = line_meta.get_field(fieldname)
			self.assertIsNotNone(field, f"Missing Alteration Ticket Line.{fieldname}")
			self.assertEqual(field.fieldtype, expected_type)

		payment_field = frappe.get_meta("Alteration Ticket", cached=False).get_field(
			"square_payment_method"
		)
		self.assertIsNotNone(payment_field)
		self.assertIn("Card on File", (payment_field.options or "").splitlines())

	def _create_ticket(self, origin="NYC", garments=None, lines=None):
		"""Helper: insert a ticket with sane defaults. Returns the saved doc."""
		garments = garments or [{"garment_type": "Jacket", "garment_description": "test"}]
		lines = lines or [
			{
				"garment_ref": "G1",
				"preset": self.preset,
				"description": "Test Hem Trouser",
				"price": 25.00,
			}
		]
		ticket = frappe.get_doc(
			{
				"doctype": "Alteration Ticket",
				"customer": self.customer,
				"origin_location": origin,
				"ticket_date": _today(),
				"due_date": _due(),
				"workflow_state": "Received",
				"garments": garments,
				"lines": lines,
			}
		).insert(ignore_permissions=True)
		ticket.reload()
		return ticket

	# ----- v1 tests (preserved) ----------------------------------------------

	def test_totals_computed_per_garment_and_ticket(self):
		ticket = self._create_ticket(
			garments=[
				{"garment_type": "Jacket", "garment_description": "Navy blazer"},
				{"garment_type": "Trouser", "garment_description": "Grey wool"},
			],
			lines=[
				{"garment_ref": "G1", "description": "Sleeve shorten", "price": 45.00},
				{"garment_ref": "G1", "description": "Waist", "price": 55.00},
				{"garment_ref": "G2", "description": "Hem", "price": 25.00},
			],
		)
		self.assertEqual(ticket.ticket_total, 125.00)
		self.assertEqual(ticket.garments[0].garment_total, 100.00)
		self.assertEqual(ticket.garments[1].garment_total, 25.00)

	def test_naming_series_by_origin(self):
		nyc = self._create_ticket(origin="NYC")
		self.assertTrue(nyc.name.startswith("ALT-NYC-"))
		hou = self._create_ticket(origin="HOU")
		self.assertTrue(hou.name.startswith("ALT-HOU-"))

	def test_state_change_triggers_webhook(self):
		# notify_n8n_on_state_change defers the POST via
		# frappe.db.after_commit.add(lambda: _post_json(...)) so the callback
		# only fires after a real commit — which tests skip via rollback.
		# Capture the registered lambda by patching CallbackManager.add at the
		# class level (instance attr is __slots__-protected), filter to the
		# after_commit manager, then invoke the lambda with _post_json mocked.
		frappe.local.conf["n8n_alteration_webhook_url"] = "http://127.0.0.1:9999/test"
		try:
			ticket = self._create_ticket()
			after_commit_mgr = frappe.db.after_commit
			registered = []

			def fake_add(self, cb):
				registered.append((self, cb))

			with patch("frappe.utils.CallbackManager.add", new=fake_add):
				ticket.workflow_state = "In Progress"
				ticket.save(ignore_permissions=True)

			# Filter to the webhook lambda — frappe's own clear_document_cache
			# also registers after_commit callbacks during save().
			webhook_callbacks = [
				cb for mgr, cb in registered
				if mgr is after_commit_mgr
				and "notify_n8n_on_state_change" in getattr(cb, "__qualname__", "")
			]
			self.assertEqual(len(webhook_callbacks), 1)

			with patch(
				"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket._post_json"
			) as m_post:
				webhook_callbacks[0]()
			m_post.assert_called_once()
			args = m_post.call_args.args
			self.assertEqual(args[0], "http://127.0.0.1:9999/test")
			self.assertEqual(args[1]["event"], "alteration_ticket.state_changed")
			self.assertEqual(args[1]["new_state"], "In Progress")
		finally:
			frappe.local.conf.pop("n8n_alteration_webhook_url", None)

	def test_create_ticket_api_with_new_customer(self):
		from ls_alterations.api import create_ticket

		payload = {
			"new_customer": {
				"customer_name": f"Smoke Test {frappe.generate_hash(length=6)}",
				"mobile_no": "+155****1111",
			},
			"origin_location": "NYC",
			"ticket_date": _today(),
			"due_date": _due(),
			"is_rush": False,
			"garments": [{"garment_type": "Jacket", "garment_description": "Test"}],
			"lines": [
				{
					"garment_ref": "G1",
					"preset": self.preset,
					"description": "Test Hem Trouser",
					"price": 45.00,
				}
			],
		}
		result = create_ticket(payload)
		self.assertTrue(result["name"].startswith("ALT-NYC-"))
		self.assertEqual(result["ticket_total"], 45.00)
		# v2 additions
		self.assertIsNotNone(result["sales_invoice"])
		self.assertIsNotNone(result["invoice_pdf_url"])

	# ----- v2 tests ----------------------------------------------------------

	def test_sales_invoice_auto_created(self):
		ticket = self._create_ticket(
			origin="NYC",
			garments=[{"garment_type": "Jacket"}],
			lines=[
				{
					"garment_ref": "G1",
					"preset": self.preset,
					"description": "Test Hem Trouser",
					"price": 45.00,
				}
			],
		)
		self.assertIsNotNone(ticket.sales_invoice)
		invoice = frappe.get_doc("Sales Invoice", ticket.sales_invoice)
		self.assertEqual(invoice.docstatus, 0)
		self.assertEqual(len(invoice.items), 1)
		self.assertEqual(float(invoice.items[0].rate), 45.00)
		self.assertEqual(float(invoice.grand_total), 45.00)
		self.assertEqual(invoice.alteration_ticket_ref, ticket.name)
		# NYC ticket → NY LLC company
		self.assertEqual(invoice.company, "L&S Tailors NY LLC")

	def test_invoice_submits_on_pickup(self):
		ticket = self._create_ticket()
		invoice_name = ticket.sales_invoice
		self.assertIsNotNone(invoice_name)
		# Step through workflow states to Picked Up
		for state in ["In Progress", "Ready", "Picked Up"]:
			ticket.workflow_state = state
			ticket.save(ignore_permissions=True)
		invoice = frappe.get_doc("Sales Invoice", invoice_name)
		self.assertEqual(invoice.docstatus, 1)

	def test_custom_line_uses_generic_item(self):
		ticket = self._create_ticket(
			lines=[
				{
					"garment_ref": "G1",
					"description": "Custom: button replacement x4",
					"price": 20.00,
				}
			],
		)
		invoice = frappe.get_doc("Sales Invoice", ticket.sales_invoice)
		self.assertEqual(invoice.items[0].item_code, "ALT-CUSTOM-ALTERATION")
		self.assertEqual(float(invoice.items[0].rate), 20.00)

	def test_payment_entry_updates_ticket_status(self):
		ticket = self._create_ticket()
		# Move to Picked Up so invoice submits
		for state in ["In Progress", "Ready", "Picked Up"]:
			ticket.workflow_state = state
			ticket.save(ignore_permissions=True)
		ticket.reload()
		self.assertEqual(ticket.payment_status, "Unpaid")

		invoice = frappe.get_doc("Sales Invoice", ticket.sales_invoice)
		self.assertEqual(invoice.docstatus, 1)

		# Fetch company defaults for the payment accounts
		company = frappe.get_doc("Company", invoice.company)
		receivable = company.default_receivable_account or frappe.db.get_value(
			"Account",
			{"company": invoice.company, "account_type": "Receivable", "is_group": 0},
			"name",
		)
		paid_to = company.default_cash_account or frappe.db.get_value(
			"Account",
			{"company": invoice.company, "account_type": "Cash", "is_group": 0},
			"name",
		) or frappe.db.get_value(
			"Account",
			{"company": invoice.company, "account_type": "Bank", "is_group": 0},
			"name",
		)
		if not (receivable and paid_to):
			self.skipTest(
				f"Company {invoice.company} missing receivable/cash accounts — "
				"set company defaults to enable payment entry test."
			)

		pe = frappe.get_doc(
			{
				"doctype": "Payment Entry",
				"payment_type": "Receive",
				"company": invoice.company,
				"party_type": "Customer",
				"party": ticket.customer,
				"paid_amount": invoice.grand_total,
				"received_amount": invoice.grand_total,
				"source_exchange_rate": 1,
				"target_exchange_rate": 1,
				"paid_from": receivable,
				"paid_to": paid_to,
				"references": [
					{
						"reference_doctype": "Sales Invoice",
						"reference_name": invoice.name,
						"total_amount": invoice.grand_total,
						"outstanding_amount": invoice.outstanding_amount,
						"allocated_amount": invoice.grand_total,
					}
				],
			}
		)
		pe.insert(ignore_permissions=True)
		pe.submit()

		ticket.reload()
		self.assertEqual(ticket.payment_status, "Paid")

	# ----- Batch A rollup tests ---------------------------------------------

	def test_rollup_all_lines_done_marks_garment_ready(self):
		ticket = self._create_ticket(
			garments=[{"garment_type": "Jacket"}],
			lines=[
				{"garment_ref": "G1", "description": "Sleeve", "price": 45.00, "line_status": "Done"},
				{"garment_ref": "G1", "description": "Waist", "price": 55.00, "line_status": "Done"},
			],
		)
		self.assertEqual(ticket.garments[0].garment_status, "Ready")

	def test_rollup_partial_marks_garment_in_progress(self):
		ticket = self._create_ticket(
			garments=[{"garment_type": "Jacket"}],
			lines=[
				{"garment_ref": "G1", "description": "Sleeve", "price": 45.00, "line_status": "Done"},
				{"garment_ref": "G1", "description": "Waist", "price": 55.00, "line_status": "Pending"},
			],
		)
		self.assertEqual(ticket.garments[0].garment_status, "In Progress")

	def test_rollup_two_garments_independent(self):
		ticket = self._create_ticket(
			garments=[
				{"garment_type": "Jacket"},
				{"garment_type": "Trouser"},
			],
			lines=[
				{"garment_ref": "G1", "description": "Sleeve", "price": 45.00, "line_status": "Done"},
				{"garment_ref": "G2", "description": "Hem", "price": 25.00, "line_status": "In Progress"},
			],
		)
		self.assertEqual(ticket.garments[0].garment_status, "Ready")
		self.assertEqual(ticket.garments[1].garment_status, "In Progress")

	def test_rollup_does_not_demote_picked_up(self):
		# Picked Up is terminal — even if lines are reset to Pending, the garment stays Picked Up.
		ticket = self._create_ticket()
		ticket.garments[0].garment_status = "Picked Up"
		ticket.lines[0].line_status = "Pending"
		ticket.save(ignore_permissions=True)
		ticket.reload()
		self.assertEqual(ticket.garments[0].garment_status, "Picked Up")

	# ----- Batch C-revised: explicit gate (no auto-cascade) -----------------

	def test_garment_status_ready_does_not_promote_ticket_workflow_state(self):
		# DESIGN: workflow_state changes ONLY via the explicit master scan button
		# (mark_ready_and_notify) or the explicit close-out actions. Garment status
		# cascading from line saves must NOT auto-promote the ticket.
		ticket = self._create_ticket(
			garments=[{"garment_type": "Jacket"}, {"garment_type": "Trouser"}],
			lines=[
				{"garment_ref": "G1", "description": "Sleeve", "price": 45.00, "line_status": "Done"},
				{"garment_ref": "G2", "description": "Hem", "price": 25.00, "line_status": "Done"},
			],
		)
		# Both garments roll up to Ready via the line->garment cascade…
		self.assertEqual(ticket.garments[0].garment_status, "Ready")
		self.assertEqual(ticket.garments[1].garment_status, "Ready")
		# …but the ticket workflow_state stays at Received. The master ticket
		# UI surfaces a yellow callout in this state; staff explicitly hits the
		# Mark Complete & Notify button to atomically advance + notify.
		self.assertEqual(ticket.workflow_state, "Received")
		self.assertFalse(ticket.notified_ready_at)

	def test_mark_ready_and_notify_happy_path_flips_state_and_sets_timestamp(self):
		from ls_alterations.api import mark_ready_and_notify

		ticket = self._create_ticket(
			garments=[{"garment_type": "Jacket"}],
			lines=[
				{"garment_ref": "G1", "description": "Sleeve", "price": 45.00, "line_status": "Done"},
			],
		)
		# Sanity: garment Ready, ticket still Received (cascade is gone)
		self.assertEqual(ticket.garments[0].garment_status, "Ready")
		self.assertEqual(ticket.workflow_state, "Received")
		self.assertFalse(ticket.notified_ready_at)

		result = mark_ready_and_notify(ticket.name)
		self.assertTrue(result["ok"])
		self.assertIn("notified_at", result)

		ticket.reload()
		# Endpoint atomically flips workflow_state AND sets notified_ready_at
		self.assertEqual(ticket.workflow_state, "Ready")
		self.assertTrue(ticket.notified_ready_at)

	def test_mark_ready_and_notify_rejects_outstanding_garments(self):
		from ls_alterations.api import mark_ready_and_notify

		ticket = self._create_ticket(
			garments=[{"garment_type": "Jacket"}, {"garment_type": "Trouser"}],
			lines=[
				{"garment_ref": "G1", "description": "Sleeve", "price": 45.00, "line_status": "Done"},
				{"garment_ref": "G2", "description": "Hem", "price": 25.00, "line_status": "Pending"},
			],
		)
		# G1 Ready, G2 Received -> outstanding
		result = mark_ready_and_notify(ticket.name)
		self.assertFalse(result["ok"])
		self.assertEqual(result["error"], "outstanding_garments")
		self.assertEqual(result["outstanding"], ["G2"])

		# Side-effect check: ticket must not have been promoted or timestamped
		ticket.reload()
		self.assertEqual(ticket.workflow_state, "Received")
		self.assertFalse(ticket.notified_ready_at)

	def test_mark_ready_and_notify_already_notified_returns_idempotent_error(self):
		from ls_alterations.api import mark_ready_and_notify

		ticket = self._create_ticket(
			garments=[{"garment_type": "Jacket"}],
			lines=[
				{"garment_ref": "G1", "description": "Sleeve", "price": 45.00, "line_status": "Done"},
			],
		)
		# First call wins
		first = mark_ready_and_notify(ticket.name)
		self.assertTrue(first["ok"])

		# Second call returns the anti-double-fire shape
		second = mark_ready_and_notify(ticket.name)
		self.assertFalse(second["ok"])
		self.assertEqual(second["error"], "already_notified")
		self.assertIn("notified_at", second)

	def test_ready_transition_skipped_when_notified_ready_at_set(self):
		# Defensive guard in notify_n8n_on_state_change: if a state-change save
		# lands a ticket at workflow_state='Ready' AND notified_ready_at is
		# already set, the existing state-changed webhook must NOT fire (the
		# dedicated notify-ready workflow already covered that transition via
		# mark_ready_and_notify). Same patch pattern as
		# test_state_change_triggers_webhook — capture CallbackManager.add at
		# class level and filter to our after_commit manager + our function.
		from frappe.utils import now

		frappe.local.conf["n8n_alteration_webhook_url"] = "http://127.0.0.1:9999/test"
		try:
			ticket = self._create_ticket()
			# Step through Received -> In Progress (allowed transition; direct
			# Received -> Ready is rejected by the Frappe workflow validator).
			ticket.workflow_state = "In Progress"
			ticket.save(ignore_permissions=True)
			ticket.reload()

			# Pre-set notified_ready_at to simulate post-mark_ready_and_notify state
			frappe.db.sql(
				"UPDATE `tabAlteration Ticket` SET notified_ready_at = %s WHERE name = %s",
				(now(), ticket.name),
			)
			ticket.reload()
			self.assertTrue(ticket.notified_ready_at)

			after_commit_mgr = frappe.db.after_commit
			registered = []

			def fake_add(self, cb):
				registered.append((self, cb))

			# Now transition In Progress -> Ready. The state-changed hook fires
			# (workflow_state changed) — but the guard should short-circuit
			# because notified_ready_at is already set.
			with patch("frappe.utils.CallbackManager.add", new=fake_add):
				ticket.workflow_state = "Ready"
				ticket.save(ignore_permissions=True)

			webhook_callbacks = [
				cb for mgr, cb in registered
				if mgr is after_commit_mgr
				and "notify_n8n_on_state_change" in getattr(cb, "__qualname__", "")
			]
			# Guard fired -> no webhook callback registered for the Ready transition
			self.assertEqual(len(webhook_callbacks), 0)
		finally:
			frappe.local.conf.pop("n8n_alteration_webhook_url", None)

	def test_other_transitions_still_fire_state_changed_webhook(self):
		# Negative case for the guard: when notified_ready_at is NOT set, the
		# state-changed webhook fires normally. Confirms the guard doesn't
		# break the existing flow for In Progress / Picked Up / Cancelled.
		frappe.local.conf["n8n_alteration_webhook_url"] = "http://127.0.0.1:9999/test"
		try:
			ticket = self._create_ticket()
			# notified_ready_at is unset here.
			after_commit_mgr = frappe.db.after_commit
			registered = []

			def fake_add(self, cb):
				registered.append((self, cb))

			with patch("frappe.utils.CallbackManager.add", new=fake_add):
				ticket.workflow_state = "In Progress"
				ticket.save(ignore_permissions=True)

			webhook_callbacks = [
				cb for mgr, cb in registered
				if mgr is after_commit_mgr
				and "notify_n8n_on_state_change" in getattr(cb, "__qualname__", "")
			]
			self.assertEqual(len(webhook_callbacks), 1)

			with patch(
				"ls_alterations.ls_alterations.doctype.alteration_ticket.alteration_ticket._post_json"
			) as m_post:
				webhook_callbacks[0]()
			m_post.assert_called_once()
			args = m_post.call_args.args
			self.assertEqual(args[1]["event"], "alteration_ticket.state_changed")
			self.assertEqual(args[1]["new_state"], "In Progress")
		finally:
			frappe.local.conf.pop("n8n_alteration_webhook_url", None)

	# ----- HER-62 billing matrix (Billable / Warranty / Included+prices) -----

	def test_billing_billable_with_prices_mints_si(self):
		ticket = self._create_ticket(
			garments=[{"garment_type": "Jacket"}],
			lines=[
				{"garment_ref": "G1", "description": "Sleeve", "price": 45.00},
			],
		)
		# Default billing_status is Billable
		self.assertEqual(ticket.billing_status, "Billable")
		self.assertEqual(ticket.ticket_total, 45.00)
		self.assertIsNotNone(ticket.sales_invoice)

	def test_billing_warranty_with_prices_keeps_dollars_no_si(self):
		"""Re-do / Warranty: full line $ kept; billing_status gates SI only."""
		ticket = frappe.get_doc(
			{
				"doctype": "Alteration Ticket",
				"customer": self.customer,
				"origin_location": "NYC",
				"ticket_date": _today(),
				"due_date": _due(),
				"workflow_state": "Received",
				"billing_status": "Warranty",
				"included_in_custom": 0,
				"garments": [{"garment_type": "Jacket", "garment_description": "redo"}],
				"lines": [
					{"garment_ref": "G1", "description": "Re-do sleeve", "price": 45.00},
				],
			}
		).insert(ignore_permissions=True)
		ticket.reload()
		self.assertEqual(ticket.billing_status, "Warranty")
		self.assertEqual(ticket.ticket_total, 45.00)
		self.assertFalse(ticket.sales_invoice)
		self.assertEqual(ticket.payment_status, "N/A")
		# Line dollars still on the doc (never zeroed)
		self.assertEqual(float(ticket.lines[0].price), 45.00)

	def test_billing_included_with_prices_no_auto_flip_no_si(self):
		"""Included-in-Custom + prices must NOT flip to Billable and must mint no SI."""
		ticket = frappe.get_doc(
			{
				"doctype": "Alteration Ticket",
				"customer": self.customer,
				"origin_location": "NYC",
				"ticket_date": _today(),
				"due_date": _due(),
				"workflow_state": "Received",
				"billing_status": "Included in Custom Order",
				"included_in_custom": 1,
				"garments": [{"garment_type": "Trouser", "garment_description": "on order"}],
				"lines": [
					{"garment_ref": "G1", "description": "Hem", "price": 25.00},
					{"garment_ref": "G1", "description": "Waist", "price": 55.00},
				],
			}
		).insert(ignore_permissions=True)
		ticket.reload()
		# Staff-set status preserved despite ticket_total > 0 (auto-flip removed)
		self.assertEqual(ticket.billing_status, "Included in Custom Order")
		self.assertEqual(ticket.ticket_total, 80.00)
		self.assertFalse(ticket.sales_invoice)
		self.assertEqual(ticket.payment_status, "N/A")
		# Re-save after compute_totals still must not flip
		ticket.save(ignore_permissions=True)
		ticket.reload()
		self.assertEqual(ticket.billing_status, "Included in Custom Order")
		self.assertFalse(ticket.sales_invoice)

	def test_rush_surcharge_no_longer_auto_added(self):
		"""C removed rush — is_rush must not mint a $25 Rush Surcharge line."""
		ticket = frappe.get_doc(
			{
				"doctype": "Alteration Ticket",
				"customer": self.customer,
				"origin_location": "NYC",
				"ticket_date": _today(),
				"due_date": _due(),
				"workflow_state": "Received",
				"is_rush": 1,
				"billing_status": "Billable",
				"garments": [{"garment_type": "Jacket"}],
				"lines": [
					{"garment_ref": "G1", "description": "Sleeve", "price": 45.00},
				],
			}
		).insert(ignore_permissions=True)
		ticket.reload()
		descs = [(l.description or "").lower() for l in (ticket.lines or [])]
		self.assertTrue(all("rush" not in d for d in descs))
		self.assertEqual(ticket.ticket_total, 45.00)

	def test_create_ticket_idempotency_key_returns_same_ticket(self):
		from ls_alterations.api import create_ticket

		meta = frappe.get_meta("Alteration Ticket")
		if not meta.has_field("idempotency_key"):
			self.skipTest("idempotency_key field not migrated yet")

		key = f"test-idemp-{frappe.generate_hash(length=10)}"
		payload = {
			"customer": self.customer,
			"origin_location": "NYC",
			"ticket_date": _today(),
			"due_date": _due(),
			"is_rush": False,
			"billing_status": "Billable",
			"idempotency_key": key,
			"garments": [{"garment_type": "Jacket", "garment_description": "Test"}],
			"lines": [
				{
					"garment_ref": "G1",
					"preset": self.preset,
					"description": "Test Hem Trouser",
					"price": 25.00,
				}
			],
		}
		first = create_ticket(payload)
		second = create_ticket(payload)
		self.assertEqual(first["name"], second["name"])
		self.assertTrue(second.get("idempotent"))

