# Copyright (c) 2026, L&S Custom Tailors and contributors
"""Client-facing Sales Invoice PDF using the live Liquid Glass print format.

ERP wkhtmltopdf dies on the L&S Sales Invoice CSS (QPainter / network).
We already have the branded Jinja template — render HTML via Frappe, then
Chromium via Gotenberg on the Studio Docker network.
"""

from __future__ import annotations

import json
import os
from urllib import error as urlerror
from urllib import request as urlrequest

import frappe
from frappe.utils.pdf import get_pdf as wkhtml_get_pdf


def _gotenberg_bases() -> tuple[str, ...]:
	# Resolve lazily — module import must not touch frappe.local.
	bases = []
	env = (os.environ.get("LSH_GOTENBERG_URL") or "").strip()
	if env:
		bases.append(env)
	try:
		conf = (frappe.conf.get("lsh_gotenberg_url") or "").strip()
		if conf:
			bases.append(conf)
	except Exception:
		pass
	bases.extend(
		(
			"http://paperless-gotenberg-1:3000",
			"http://gotenberg:3000",
		)
	)
	# de-dupe preserve order
	seen = set()
	out = []
	for b in bases:
		if b and b not in seen:
			seen.add(b)
			out.append(b)
	return tuple(out)

DEFAULT_FORMAT = "L&S Sales Invoice"
FALLBACK_FORMATS = (
	"L&S Sales Invoice",
	"L&S Alteration Invoice",
	"Standard",
)


def _build_print_html(doctype: str, name: str, print_format: str) -> str:
	from frappe.www.printview import get_html_and_style

	# Signature: get_html_and_style(doc, name=..., print_format=...)
	# When name is a string, it loads the doc (preferred — no JSON date issues).
	result = get_html_and_style(
		doctype,
		name=name,
		print_format=print_format,
		no_letterhead=1,
	)
	if not result:
		frappe.throw(f"Could not render print format {print_format}")
	html = result.get("html") or ""
	style = result.get("style") or ""
	if not html.strip():
		frappe.throw(f"Empty HTML for print format {print_format}")

	# Self-contained letter page for Chromium
	return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400;1,500;1,600&family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
@page {{ size: letter; margin: 0; }}
html, body {{ margin: 0; padding: 0; background: #ffffff; }}
{style}
</style>
</head>
<body>
{html}
</body>
</html>
"""


def _gotenberg_pdf(html: str) -> bytes | None:
	boundary = "----LSHFormBoundary7MA4YWxkTrZu0gW"
	body = (
		f"--{boundary}\r\n"
		f'Content-Disposition: form-data; name="files"; filename="index.html"\r\n'
		f"Content-Type: text/html; charset=utf-8\r\n\r\n"
		f"{html}\r\n"
		f"--{boundary}\r\n"
		f'Content-Disposition: form-data; name="marginTop"\r\n\r\n'
		f"0\r\n"
		f"--{boundary}\r\n"
		f'Content-Disposition: form-data; name="marginBottom"\r\n\r\n'
		f"0\r\n"
		f"--{boundary}\r\n"
		f'Content-Disposition: form-data; name="marginLeft"\r\n\r\n'
		f"0\r\n"
		f"--{boundary}\r\n"
		f'Content-Disposition: form-data; name="marginRight"\r\n\r\n'
		f"0\r\n"
		f"--{boundary}\r\n"
		f'Content-Disposition: form-data; name="printBackground"\r\n\r\n'
		f"true\r\n"
		f"--{boundary}\r\n"
		f'Content-Disposition: form-data; name="preferCssPageSize"\r\n\r\n'
		f"true\r\n"
		f"--{boundary}--\r\n"
	).encode("utf-8")

	for base in _gotenberg_bases():
		url = base.rstrip("/") + "/forms/chromium/convert/html"
		req = urlrequest.Request(
			url,
			data=body,
			method="POST",
			headers={
				"Content-Type": f"multipart/form-data; boundary={boundary}",
				"Content-Length": str(len(body)),
				"User-Agent": "L&S-House-ERP-PDF/1.0",
			},
		)
		try:
			with urlrequest.urlopen(req, timeout=90) as resp:
				data = resp.read()
			if data[:5] == b"%PDF-":
				return data
		except Exception as exc:
			frappe.logger("ls_pdf").warning(f"gotenberg fail {url}: {exc}")
			continue
	return None


def _wkhtml_pdf(html: str) -> bytes | None:
	try:
		data = wkhtml_get_pdf(html)
		if data and data[:5] == b"%PDF-":
			return data
	except Exception as exc:
		frappe.logger("ls_pdf").warning(f"wkhtml fail: {exc}")
	return None


def render_sales_invoice_pdf(name: str, print_format: str | None = None) -> bytes:
	"""Return PDF bytes for a Sales Invoice using branded print format."""
	if not name:
		frappe.throw("Invoice name required")
	if not frappe.db.exists("Sales Invoice", name):
		frappe.throw(f"Sales Invoice {name} not found", frappe.DoesNotExistError)

	formats = []
	if print_format:
		formats.append(print_format)
	for f in FALLBACK_FORMATS:
		if f not in formats:
			formats.append(f)

	last_err = None
	for fmt in formats:
		try:
			html = _build_print_html("Sales Invoice", name, fmt)
		except Exception as exc:
			last_err = exc
			continue

		pdf = _gotenberg_pdf(html)
		if pdf:
			return pdf
		pdf = _wkhtml_pdf(html)
		if pdf:
			return pdf

	frappe.throw(
		f"Could not generate PDF for {name}"
		+ (f": {last_err}" if last_err else " (Gotenberg + wkhtmltopdf failed)")
	)


@frappe.whitelist(allow_guest=False)
def download_client_pdf(name: str | None = None, invoice: str | None = None, print_format: str | None = None):
	"""Download branded client PDF for a Sales Invoice.

	House app / public pay page calls this with API token. Uses
	**L&S Sales Invoice** Liquid Glass print format (existing template).
	"""
	invoice_name = (name or invoice or "").strip()
	if not invoice_name:
		frappe.throw("name required")

	# Resolve alteration ticket → SI if needed
	if not frappe.db.exists("Sales Invoice", invoice_name):
		if frappe.db.exists("Alteration Ticket", invoice_name):
			ticket = frappe.db.get_value(
				"Alteration Ticket",
				invoice_name,
				["sales_invoice", "invoice"],
				as_dict=True,
			) or {}
			invoice_name = (ticket.get("sales_invoice") or ticket.get("invoice") or "").strip()
		if not invoice_name or not frappe.db.exists("Sales Invoice", invoice_name):
			frappe.throw("Invoice not found", frappe.DoesNotExistError)

	fmt = (print_format or DEFAULT_FORMAT).strip() or DEFAULT_FORMAT
	pdf = render_sales_invoice_pdf(invoice_name, fmt)

	frappe.local.response.filename = f"{invoice_name}.pdf"
	frappe.local.response.filecontent = pdf
	frappe.local.response.type = "pdf"
	return
