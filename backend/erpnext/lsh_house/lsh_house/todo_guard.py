"""Idempotent HD / Assignment Rule ToDos.

ERPNext Assignment Rule inserts a ToDo titled "Automatic Assignment" on every
assign. Keep one Open ToDo per (ticket, assignee); cancel the extra insert.
"""

from __future__ import annotations

import frappe


def _is_auto(doc) -> bool:
    desc = (doc.description or "") + " " + (getattr(doc, "description", "") or "")
    return "automatic assignment" in desc.lower()


def todo_after_insert(doc, method=None):
    if not _is_auto(doc):
        return
    if not (doc.reference_type and doc.reference_name and doc.allocated_to):
        return
    others = frappe.get_all(
        "ToDo",
        filters={
            "status": "Open",
            "reference_type": doc.reference_type,
            "reference_name": doc.reference_name,
            "allocated_to": doc.allocated_to,
            "name": ["!=", doc.name],
        },
        pluck="name",
        limit=5,
    )
    if not others:
        return
    frappe.db.set_value("ToDo", doc.name, "status", "Cancelled", update_modified=False)
    frappe.logger("lsh_house.todo_guard").info(
        "Cancelled duplicate Automatic Assignment %s (kept %s)",
        doc.name,
        others[0],
    )
