# ls-erp v2 tools — integration & audit notes

Staging + review for the five new `erp_*` tools in `ls_erp_tools_v2.py`.
Read this before wiring them into the live MCP server.

## ⚠️ Scope reality (read first)

`ls_erp_tools_v2.py` is staged in **`lstailors/ls-house-app`**, but the running
`ls-erp` MCP server's source code is **not in this repo**. The live server is a
separate deployed service:

```
# backend/src/routes/intake-alterations.ts:12
const MCP_BASE = process.env.ERPNEXT_MCP_URL ?? 'https://erp-mcp.lstailors.com';
// calls JSON-RPC: { method: 'tools/call', params: { name: 'erp_list', arguments } }
// parses result.content[0].text -> JSON { documents: [...] }
```

The existing `erp_*` tools (`erp_list`, `erp_get`, `erp_run_method`, `erp_run_report`,
`erp_submit`, `erp_cancel`, `erp_count`, `erp_create`, `erp_update`, `erp_doctype_fields`,
`erp_list_doctypes`, `erp_ping`) are served from there. Because that source isn't present
and this session's GitHub scope is `lstailors/ls-house-app` only, I could **not**:

- read the existing `erp_*` registration/dispatch to match its *exact* file layout;
- run the server's own test/lint suite;
- call the live `tools/list` to confirm the new tools register.

What I **did** verify here: the module compiles clean (`python3 -m py_compile`), and it
exposes `TOOL_SCHEMAS` (JSON-Schema, MCP `inputSchema` shape) + `TOOL_HANDLERS`
(name → callable), which is the standard shape an MCP `tools/list` / `tools/call`
dispatcher consumes. Final wiring is a one-liner in the **ls-erp repo** (below).

## Wiring (do this in the ls-erp server repo, not here)

The server already has a registry that turns tool definitions into `tools/list` entries and
routes `tools/call` by name. Add these five to it:

```python
from ls_erp_tools_v2 import TOOL_SCHEMAS, TOOL_HANDLERS

# wherever the existing erp_* tools are collected:
ALL_TOOL_SCHEMAS.extend(TOOL_SCHEMAS)     # -> appears in tools/list
ALL_TOOL_HANDLERS.update(TOOL_HANDLERS)   # -> dispatched on tools/call
```

If the existing tools are registered with a decorator or a class instead of plain
dict/maps, adapt: keep each function body intact and register `TOOL_SCHEMAS[i]` +
`TOOL_HANDLERS[name]` through that mechanism. The handler contract is
`fn(**arguments) -> dict`; wrap the returned dict as the server already wraps
`erp_list`'s result (`content[0].text = json.dumps(result)`).

## Required behaviors — confirmed intact

The three behaviors called out as must-keep are present and unmodified:

- **`erp_search` uses `frappe.get_list(..., ignore_permissions=False)`** — row-level /
  user permissions enforced (not `get_all`). `erp_search_link` gates on
  `frappe.has_permission(read)` and delegates to Desk `search_link`, which is itself
  permission-aware.
- **`erp_run_workflow` self-correcting feedback** — when `action` isn't valid for the
  current state it returns `available_actions` + a `suggestion` instead of erroring blind.
- **`erp_query` savepoint-rollback guard** — every SELECT runs inside
  `frappe.db.savepoint("erp_query_ro")` and is **always** rolled back in `finally`, on top
  of the System-Manager gate, SELECT/WITH-only static check, single-statement check, and
  auto-LIMIT.

## `_audit()` — WIRED (not stubbed)

The original `_audit()` was a file-logger stub. This repo has an **`LSH Audit Log`**
DocType (`backend/erpnext/lsh_house/.../doctype/lsh_audit_log/`, fields `agent_slug`,
`action`, `detail`, `metadata`). `_audit()` now inserts into it
(`ignore_permissions=True`, since audit rows must always persist), guarded by
`frappe.db.exists("DocType", "LSH Audit Log")` with a fallback to `frappe.logger("ls_erp")`
when lsh_house isn't installed on the bench. It never raises.

> Caveat to confirm at deploy: this assumes the ls-erp MCP server runs on the **same
> Frappe site** as `lsh_house` (true if it shares the bench/DB that `erp_list` already
> reads). If the MCP server points at a different site without `lsh_house`, `_audit()`
> auto-falls back to the logger — no breakage, but no DocType rows either.

## Safety audit — `frappe.get_all` / `frappe.db.get_all` (whole repo)

Grepped `ls-house-app` for `frappe.get_all` and `frappe.db.get_all`. **Zero LLM-facing
hits.** Every call site is internal SMS/webhook plumbing, not data returned to an LLM:

| File:line | Call | LLM-facing? | Verdict |
|---|---|---|---|
| `backend/erpnext/lsh_house/lsh_house/sms.py:290` | `get_all("LSH SMS Message")` | No — `latest_thread_for_phone()` | Fine (system/webhook context) |
| `backend/erpnext/lsh_house/lsh_house/api/sms_inbound.py:167` | `get_all("Customer")` | No — inbound-SMS phone→customer match (`allow_guest`) | Fine; runs as system, no user to scope to |
| `…/sms_inbound.py:175,182,200,208` | `get_all("Contact"/"Dynamic Link"/"Contact Phone")` | No — same phone-matching path | Fine |
| `frappe/ls_alterations/ls_alterations/api/scanner.py:235,352,365,488` | `frappe.get_list(...)` | Scanner page | Already permission-aware ✓ |

**Conclusion:** the permission hole described in the task (an LLM-facing `get_all`) is **not
in this repo** — it would live in the ls-erp server's `erp_list` handler, which isn't here.
Switching the SMS `get_all` calls to `get_list` would actually break phone-matching (no
session user in a Twilio webhook), so I did **not** change them. `erp_list` itself must be
audited in the ls-erp repo: confirm it calls `frappe.get_list(ignore_permissions=False)` and
not `get_all`. **No load-bearing file in this repo was changed.**

## Code review — verify before/at deploy

Nothing was reshaped (logic kept intact per instruction), but flag these against the target
Frappe version:

1. **FIXED — `frappe.qb.desc` in `erp_pending_approvals`.** Was
   `.orderby(WA.creation, order=frappe.qb.desc)`, which raises `AttributeError` on Frappe
   versions that don't expose `frappe.qb.desc`. Now uses the portable canonical form
   (`from frappe.query_builder import Order` → `order=Order.desc`), valid across modern
   Frappe. No action needed.
2. **MED — `search_link` signature.** `erp_search_link` calls
   `frappe.desk.search.search_link(doctype=, txt=, filters=, page_length=)`. Arg names have
   drifted across Frappe versions (`query=` vs `txt=`, return value vs
   `frappe.response["results"]`). The code already handles both return paths; confirm the
   kwargs match your version, else it lands in the `except` and returns `{success: False}`.
3. **LOW — `erp_search` field selection** caps at 5 text fields per doctype and `like
   %query%` (no index use on leading wildcard). Fine for operator search; not for hot paths.
4. **LOW — `erp_query` `LIMIT` detection** is a substring check on `.upper()`; a query
   whose only `LIMIT` is inside a string literal would skip the auto-LIMIT. Harmless given
   the 1000-row hard cap + rollback, but note it.

## Deploy — run these in the **ls-erp app's bench** (I did NOT deploy)

No new DocType is introduced by these tools (`LSH Audit Log` already exists via lsh_house),
so no `migrate` is needed for the tools themselves. After landing `ls_erp_tools_v2.py` in
the ls-erp app and adding the two registry lines:

```bash
# in the ls-erp server repo: commit the file + the 2 registry lines, then on the bench host:
cd /path/to/frappe-bench
bench --site erp.lstailors.com clear-cache
bench restart                      # or: sudo supervisorctl restart all
#   (restart the specific MCP/gunicorn + worker processes if not using the umbrella restart)

# confirm the five tools registered:
curl -s -X POST https://erp-mcp.lstailors.com/mcp \
  -H "Authorization: Bearer $ERPNEXT_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  | python3 -c 'import sys,json; n=[t["name"] for t in json.load(sys.stdin)["result"]["tools"]]; print("\n".join(n)); print("\nNEW PRESENT:", all(x in n for x in ["erp_search_link","erp_search","erp_run_workflow","erp_pending_approvals","erp_query"]))'

# smoke-test one (permission-aware):
curl -s -X POST https://erp-mcp.lstailors.com/mcp -H "Authorization: Bearer $ERPNEXT_MCP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"erp_search_link","arguments":{"doctype":"Supplier","query":"YZ"}}}'
```

If `migrate` *is* run for an unrelated reason, use `bench --site erp.lstailors.com migrate`
(prod) — not `prisma`; this is the Frappe side.
