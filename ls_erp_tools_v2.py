# -----------------------------------------------------------------------------
# ls-erp MCP — v2 tool additions
# Distilled from an audit of Frappe Assistant Core (AGPL-3.0). This is a
# clean-room reimplementation: same Frappe primitives, our own code. Nothing
# is copied from FAC, so ls-house stays free of AGPL network-copyleft.
#
# Adds five tools that close the real gaps in ls-erp today:
#   erp_search_link       fuzzy link resolution (fixes the "YZ"/"YongZheng" miss)
#   erp_search            global / per-doctype text search
#   erp_run_workflow      native workflow actions w/ self-correcting feedback
#   erp_pending_approvals approval queue for the calling user
#   erp_query             hardened read-only SQL
#
# Each function returns a plain dict {"success": bool, ...}. Wire the THIN
# wrappers at the bottom into your existing MCP registry however erp_* tools
# are registered today. No base class dependency.
# -----------------------------------------------------------------------------

import json
import re
import time
from typing import Any, Dict, List, Optional

import frappe
from frappe import _


# =============================================================================
# Shared helpers
# =============================================================================

def _deny(msg: str, **extra) -> Dict[str, Any]:
    out = {"success": False, "error": msg}
    out.update(extra)
    return out


def _check_read(doctype: str) -> Optional[Dict[str, Any]]:
    """Gate every tool on DocType existence + the caller's read permission.

    LESSON FROM THE AUDIT: permission must be checked against the *session
    user*, and every data fetch below uses frappe.get_list (NOT get_all) with
    ignore_permissions=False so row-level / user-permission rules are applied.
    get_all bypasses permissions entirely and silently leaks records.
    """
    if not frappe.db.exists("DocType", doctype):
        return _deny(f"DocType '{doctype}' not found")
    if not frappe.has_permission(doctype, "read"):
        return _deny(f"No read permission for DocType '{doctype}'")
    return None


# Audit DocType in the lsh_house app (same site as the ERP data the MCP serves).
# Fields: agent_slug (Data), action (Data), detail (Text), metadata (Long Text).
_AUDIT_DOCTYPE = "LSH Audit Log"


def _audit(tool: str, arguments: Dict[str, Any], status: str, error: str = None) -> None:
    """Audit breadcrumb.

    Wired to the LSH Audit Log DocType when present on the site; otherwise it
    falls back to the file logger so these tools still drop in cleanly on a
    bench that doesn't have lsh_house installed. Never raises — an audit
    failure must not break the tool call.
    """
    try:
        if frappe.db.exists("DocType", _AUDIT_DOCTYPE):
            doc = frappe.get_doc(
                {
                    "doctype": _AUDIT_DOCTYPE,
                    "agent_slug": f"ls-erp-mcp:{frappe.session.user}",
                    "action": tool,
                    "detail": (error or status)[:140] if (error or status) else status,
                    "metadata": json.dumps(
                        {"status": status, "error": error, "arguments": arguments},
                        default=str,
                    ),
                }
            )
            doc.insert(ignore_permissions=True)
        else:
            frappe.logger("ls_erp").info(
                {"tool": tool, "user": frappe.session.user, "status": status, "error": error}
            )
    except Exception:
        # Last-resort: never let auditing surface an exception to the caller.
        try:
            frappe.logger("ls_erp").info(
                {"tool": tool, "user": frappe.session.user, "status": status, "error": error}
            )
        except Exception:
            pass


# =============================================================================
# 1. erp_search_link  — fuzzy link-field resolution
# =============================================================================

def erp_search_link(
    doctype: str, query: str, filters: Dict[str, Any] = None, limit: int = 20
) -> Dict[str, Any]:
    """Resolve a link value the way the Desk UI does.

    This is the alias fix. frappe.desk.search.search_link matches `query`
    against the DocType's configured search fields (supplier_name, etc.), not
    just the primary key — so "YZ" or "Young Zheng" resolves to the
    "YongZheng" Supplier instead of failing silently the way an exact-match
    erp_list filter does.
    """
    denied = _check_read(doctype)
    if denied:
        _audit("erp_search_link", {"doctype": doctype}, "Permission Denied", denied["error"])
        return denied

    try:
        from frappe.desk.search import search_link as _frappe_search_link

        # search_link writes its hits into frappe.response["results"] and (in
        # most versions) also returns them. We snapshot/restore that key so a
        # mid-request call can't leak into the outer MCP response envelope —
        # a robustness improvement over the upstream implementation.
        prev = frappe.response.get("results")
        try:
            returned = _frappe_search_link(
                doctype=doctype,
                txt=query or "",
                filters=filters or {},
                page_length=limit,
            )
            results = returned if returned else (frappe.response.get("results") or [])
        finally:
            frappe.response["results"] = prev

        _audit("erp_search_link", {"doctype": doctype, "query": query}, "Success")
        return {
            "success": True,
            "doctype": doctype,
            "query": query,
            "count": len(results),
            "results": results,
            "filters_applied": filters or {},
        }
    except Exception as e:
        frappe.log_error(title=_("erp_search_link error"), message=str(e))
        _audit("erp_search_link", {"doctype": doctype}, "Error", str(e))
        return _deny(str(e))


# =============================================================================
# 2. erp_search  — text search across one or many doctypes
# =============================================================================

# Default surface for a no-doctype search. Tune to L&S reality.
_DEFAULT_SEARCH_DOCTYPES = (
    "Customer", "Supplier", "Item", "Contact",
    "Sales Order", "Sales Invoice", "Purchase Order",
)


def erp_search(
    query: str,
    doctype: str = None,
    doctypes: List[str] = None,
    limit: int = 20,
) -> Dict[str, Any]:
    """Text search. One doctype if `doctype` given, else a curated set.

    Per-doctype search derives its fields from meta (title field + Data/Text
    fields) and matches with or_filters, mirroring how Desk search behaves.
    All fetches are permission-aware (get_list).
    """
    targets = [doctype] if doctype else (doctypes or list(_DEFAULT_SEARCH_DOCTYPES))
    all_results: List[Dict[str, Any]] = []
    searched: List[str] = []

    for dt in targets:
        if not frappe.db.exists("DocType", dt) or not frappe.has_permission(dt, "read"):
            continue
        searched.append(dt)
        try:
            meta = frappe.get_meta(dt)
            fields = []
            if meta.title_field:
                fields.append(meta.title_field)
            for f in meta.fields:
                if f.fieldtype in ("Data", "Text", "Small Text") and not f.hidden:
                    fields.append(f.fieldname)
            fields = list(dict.fromkeys(fields))[:5] or ["name"]

            or_filters = [[dt, f, "like", f"%{query}%"] for f in fields]
            rows = frappe.get_list(
                dt,
                or_filters=or_filters,
                fields=["name"] + [f for f in fields if f != "name"],
                limit=limit,
                order_by="modified desc",
                ignore_permissions=False,  # row-level perms enforced
            )
            for r in rows:
                r["doctype"] = dt
            all_results.extend(rows)
        except Exception:
            # Skip a doctype that errors (e.g. odd meta) rather than fail all.
            continue

    out = all_results[: limit if doctype else (limit * 2)]
    _audit("erp_search", {"query": query, "doctype": doctype}, "Success")
    return {
        "success": True,
        "query": query,
        "count": len(out),
        "results": out,
        "searched_doctypes": searched,
    }


# =============================================================================
# 3. erp_run_workflow  — native workflow actions, self-correcting
# =============================================================================

def erp_run_workflow(
    doctype: str, name: str, action: str, workflow: str = None
) -> Dict[str, Any]:
    """Apply a workflow action via Frappe's native engine.

    Uses apply_workflow so every side effect — docstatus change, role checks,
    conditions, notifications — is honored. The key UX win borrowed from the
    audit: when `action` is not valid for the current state, we return the
    list of actions that ARE available, so the caller (LLM or human) can
    retry correctly instead of guessing. Maps directly onto your invoice
    finalize states (Draft -> Manual Review -> Finalized).
    """
    if not frappe.db.exists(doctype, name):
        return _deny(f"Document {doctype} '{name}' not found")

    try:
        from frappe.model.workflow import (
            apply_workflow,
            get_transitions,
            get_workflow_name,
        )

        doc = frappe.get_doc(doctype, name)
        original_state = getattr(doc, "workflow_state", None)

        wf = workflow or get_workflow_name(doctype)
        if not wf:
            return _deny(
                f"No workflow configured for {doctype}",
                suggestion="Use erp_update for a direct field change instead.",
            )

        available = [t.get("action") for t in get_transitions(doc)]
        if action not in available:
            _audit("erp_run_workflow", {"doctype": doctype, "name": name, "action": action}, "Error")
            return _deny(
                f"Action '{action}' not available from state '{original_state}'",
                current_state=original_state,
                available_actions=available,
                suggestion=(
                    f"Try one of: {', '.join(available)}" if available else "No actions available to you."
                ),
            )

        before_status = doc.docstatus
        updated = apply_workflow(doc, action)
        new_state = getattr(updated, "workflow_state", None)

        changes = []
        if original_state != new_state:
            changes.append(f"State: {original_state} -> {new_state}")
        if before_status != updated.docstatus:
            names = {0: "Draft", 1: "Submitted", 2: "Cancelled"}
            changes.append(
                f"Status: {names.get(before_status, before_status)} -> "
                f"{names.get(updated.docstatus, updated.docstatus)}"
            )

        _audit("erp_run_workflow", {"doctype": doctype, "name": name, "action": action}, "Success")
        return {
            "success": True,
            "message": f"Workflow action '{action}' executed",
            "changes": changes,
            "document": {
                "doctype": doctype,
                "name": name,
                "previous_state": original_state,
                "current_state": new_state,
                "docstatus": updated.docstatus,
            },
            "workflow": wf,
            "next_available_actions": [t.get("action") for t in get_transitions(updated)],
        }

    except frappe.PermissionError as e:
        return _deny(str(e), error_type="PermissionError",
                     help="You lack permission for this workflow action.")
    except Exception as e:
        frappe.log_error(title=_("erp_run_workflow error"), message=str(e))
        _audit("erp_run_workflow", {"doctype": doctype, "name": name}, "Error", str(e))
        return _deny(f"Workflow execution failed: {str(e)}")


# =============================================================================
# 4. erp_pending_approvals  — approval queue for the caller
# =============================================================================

_MAX_TRANSITION_DOCS = 20


def erp_pending_approvals(
    doctype: str = None, limit: int = 50, include_actions: bool = True
) -> Dict[str, Any]:
    """List open Workflow Actions awaiting the current user.

    Resolved by role (Workflow Action Permitted Role overlapping the user's
    roles) OR direct user assignment. Administrator sees all. Transition
    lookups are capped to avoid an N+1 fan-out on large queues.
    """
    from frappe.query_builder import Order

    limit = min(limit or 50, 200)
    user = frappe.session.user
    roles = frappe.get_roles(user)

    WA = frappe.qb.DocType("Workflow Action")
    WAPR = frappe.qb.DocType("Workflow Action Permitted Role")

    role_subq = (
        frappe.qb.from_(WA).join(WAPR).on(WA.name == WAPR.parent)
        .select(WA.name).where(WAPR.role.isin(roles))
    )
    q = (
        frappe.qb.from_(WA)
        .select(WA.name, WA.reference_doctype, WA.reference_name,
                WA.workflow_state, WA.user, WA.creation)
        .where(WA.status == "Open")
        .orderby(WA.creation, order=Order.desc)
        .limit(limit)
    )
    if user != "Administrator":
        q = q.where(WA.name.isin(role_subq) | (WA.user == user))
    if doctype:
        q = q.where(WA.reference_doctype == doctype)

    try:
        pending = q.run(as_dict=True)
    except Exception as e:
        frappe.log_error(title=_("erp_pending_approvals error"), message=str(e))
        return _deny(str(e))

    if not pending:
        return {"success": True, "total_pending": 0, "pending_approvals": {},
                "message": "No documents pending your approval"}

    grouped: Dict[str, list] = {}
    transitions_cache: Dict[tuple, list] = {}
    seen = set()
    for a in pending:
        key = (a.reference_doctype, a.reference_name)
        entry = {
            "document_name": a.reference_name,
            "workflow_state": a.workflow_state,
            "creation": str(a.creation),
        }
        if include_actions and key not in transitions_cache and len(seen) <= _MAX_TRANSITION_DOCS:
            seen.add(key)
            try:
                from frappe.model.workflow import get_transitions
                tdoc = frappe.get_doc(a.reference_doctype, a.reference_name)
                transitions_cache[key] = [
                    {"action": t.get("action"), "next_state": t.get("next_state")}
                    for t in get_transitions(tdoc)
                ]
            except Exception:
                transitions_cache[key] = []
        if include_actions and key in transitions_cache:
            entry["available_actions"] = transitions_cache[key]
        grouped.setdefault(a.reference_doctype, []).append(entry)

    return {
        "success": True,
        "total_pending": len(pending),
        "doctypes_with_pending": list(grouped.keys()),
        "pending_approvals": grouped,
        "message": f"{len(pending)} document(s) pending across {len(grouped)} type(s)",
    }


# =============================================================================
# 5. erp_query  — hardened read-only SQL
# =============================================================================

# Whole-word DML/DDL blocklist. \b boundaries avoid false positives on column
# names like `update_time` or `set_warehouse` (the upstream space-padding
# check could misfire on those).
_FORBIDDEN = re.compile(
    r"\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|REPLACE|GRANT|REVOKE"
    r"|EXEC|EXECUTE|CALL|MERGE|LOCK|UNLOCK|INTO\s+OUTFILE|LOAD_FILE)\b",
    re.IGNORECASE,
)


def _validate_select(query: str) -> Optional[str]:
    q = re.sub(r"--.*?$|/\*.*?\*/", "", query, flags=re.DOTALL | re.MULTILINE)
    q = re.sub(r"\s+", " ", q).strip().rstrip(";")
    if not q:
        return "Empty query."
    head = q.upper()
    if not (head.startswith("SELECT") or head.startswith("WITH")):
        return "Only SELECT (or WITH ... SELECT) queries are allowed."
    if ";" in q:
        return "Multiple statements are not allowed; run one query at a time."
    m = _FORBIDDEN.search(q)
    if m:
        return f"Forbidden keyword '{m.group(0)}'. Read-only queries only."
    return None


def erp_query(query: str, limit: int = 200) -> Dict[str, Any]:
    """Run a read-only SELECT against the ERPNext DB.

    Defense in depth, strongest first:
      1. Role gate     — System Manager only.
      2. Static check  — must be SELECT/WITH, single statement, no DML/DDL.
      3. Auto-LIMIT    — injected if absent, hard-capped.
      4. Savepoint     — wrapped and ALWAYS rolled back, so anything that
                         slipped past (2) cannot persist. This is the layer
                         the upstream tool lacks.
    """
    if "System Manager" not in frappe.get_roles():
        return _deny("System Manager role required for erp_query.")

    err = _validate_select(query)
    if err:
        _audit("erp_query", {"query": query[:200]}, "Blocked", err)
        return _deny(err, security_violation=True)

    limit = min(limit or 200, 1000)
    q = query.strip().rstrip(";")
    if "LIMIT" not in q.upper():
        q = f"{q} LIMIT {limit}"

    sp = "erp_query_ro"
    started = time.time()
    try:
        frappe.db.savepoint(sp)
        rows = frappe.db.sql(q, as_dict=True)
        return {
            "success": True,
            "query_executed": q,
            "rows_returned": len(rows),
            "execution_time_ms": round((time.time() - started) * 1000, 2),
            "data": rows,
        }
    except Exception as e:
        return _deny(f"Query failed: {str(e)}")
    finally:
        # SELECT writes nothing; rolling back the savepoint guarantees no
        # side effects regardless of what executed.
        try:
            frappe.db.rollback(save_point=sp)
        except Exception:
            pass
        _audit("erp_query", {"query": q[:200]}, "Success")


# =============================================================================
# MCP tool schemas  — register these with your erp_* registry
# =============================================================================

TOOL_SCHEMAS = [
    {
        "name": "erp_search_link",
        "description": (
            "Resolve a link value by fuzzy text the way the Desk UI does. Use this "
            "instead of erp_list when the caller gives a name/alias that may not match "
            "the record ID exactly (e.g. supplier 'YZ' -> 'YongZheng'). Returns ranked "
            "matches from the DocType's search fields."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "doctype": {"type": "string", "description": "Target DocType, e.g. 'Supplier'"},
                "query": {"type": "string", "description": "Text / alias to resolve"},
                "filters": {"type": "object", "default": {}, "description": "Optional extra filters"},
                "limit": {"type": "integer", "default": 20, "maximum": 50},
            },
            "required": ["doctype", "query"],
        },
    },
    {
        "name": "erp_search",
        "description": (
            "Text search across one DocType (pass `doctype`) or a curated default set. "
            "Matches the record's title and text fields. Permission-aware."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "doctype": {"type": "string", "description": "Optional single DocType to scope to"},
                "doctypes": {"type": "array", "items": {"type": "string"},
                             "description": "Optional explicit list to search"},
                "limit": {"type": "integer", "default": 20, "maximum": 50},
            },
            "required": ["query"],
        },
    },
    {
        "name": "erp_run_workflow",
        "description": (
            "Execute a workflow action (Submit, Approve, Reject, Submit for Review, etc.) "
            "on a document using Frappe's native workflow engine, honoring permissions, "
            "conditions, and notifications. Use this for state transitions, NOT erp_update. "
            "If the action is invalid for the current state, the tool returns the list of "
            "actions that ARE available so you can retry."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "doctype": {"type": "string"},
                "name": {"type": "string", "description": "Document ID"},
                "action": {"type": "string", "description": "Exact workflow action name (case-sensitive)"},
                "workflow": {"type": "string", "description": "Optional; auto-detected if omitted"},
            },
            "required": ["doctype", "name", "action"],
        },
    },
    {
        "name": "erp_pending_approvals",
        "description": (
            "List documents pending the current user's workflow approval, grouped by type "
            "with each document's available actions. Queries the Workflow Action system."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "doctype": {"type": "string", "description": "Optional filter to one DocType"},
                "limit": {"type": "integer", "default": 50, "maximum": 200},
                "include_actions": {"type": "boolean", "default": True},
            },
            "required": [],
        },
    },
    {
        "name": "erp_query",
        "description": (
            "Run a read-only SQL SELECT against the ERPNext database for analytics that "
            "erp_run_report / erp_list cannot express. System Manager only. SELECT/WITH "
            "only; single statement; auto-limited; executed inside a rolled-back savepoint."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "A single SELECT statement"},
                "limit": {"type": "integer", "default": 200, "maximum": 1000},
            },
            "required": ["query"],
        },
    },
]

# Map tool name -> callable, for whatever dispatch your MCP server uses.
TOOL_HANDLERS = {
    "erp_search_link": erp_search_link,
    "erp_search": erp_search,
    "erp_run_workflow": erp_run_workflow,
    "erp_pending_approvals": erp_pending_approvals,
    "erp_query": erp_query,
}
