#!/usr/bin/env python3
"""Generate Frappe DocType JSON files for the lsh_house app."""
from __future__ import annotations

import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent / "lsh_house" / "lsh_house" / "lsh_house" / "doctype"
FIXTURES_DIR = Path(__file__).resolve().parent / "lsh_house" / "lsh_house" / "lsh_house" / "fixtures"

SM_PERM = [{
    "role": "System Manager",
    "read": 1, "write": 1, "create": 1, "delete": 1,
    "email": 1, "export": 1, "print": 1, "share": 1,
}]
LST_PERM = [{
    "role": "LST Super Admin",
    "read": 1, "write": 1, "create": 1, "delete": 1,
    "email": 1, "export": 1, "print": 1, "share": 1,
}]


def f(name: str, ftype: str, label: str, **kw) -> dict:
    row = {"fieldname": name, "fieldtype": ftype, "label": label}
    row.update(kw)
    return row


def doctype(name: str, fields: list, **extra) -> dict:
    doc = {
        "actions": [],
        "allow_rename": 1,
        "autoname": extra.get("autoname", "hash"),
        "creation": "2026-01-01 00:00:00.000000",
        "doctype": "DocType",
        "engine": "InnoDB",
        "field_order": [x["fieldname"] for x in fields],
        "fields": fields,
        "index_web_pages_for_search": 1,
        "links": [],
        "modified": "2026-01-01 00:00:00.000000",
        "modified_by": "Administrator",
        "module": "LSH House",
        "name": name,
        "owner": "Administrator",
        "permissions": extra.get("permissions", SM_PERM + LST_PERM),
        "sort_field": "modified",
        "sort_order": "DESC",
        "states": [],
        "track_changes": 1,
    }
    if extra.get("istable"):
        doc["istable"] = 1
        doc["permissions"] = []
    doc.update({k: v for k, v in extra.items() if k not in ("autoname", "permissions", "istable")})
    return doc


SCHEMAS: dict[str, dict] = {
    "LSH Location": doctype("LSH Location", [
        f("location_code", "Data", "Location Code", reqd=1, unique=1, in_list_view=1),
        f("location_name", "Data", "Location Name", reqd=1, in_list_view=1),
        f("short_name", "Data", "Short Name"),
        f("address", "Small Text", "Address"),
        f("city", "Data", "City"),
        f("state", "Data", "State"),
        f("postal_code", "Data", "Postal Code"),
        f("phone", "Data", "Phone"),
        f("twilio_number", "Data", "Twilio Number"),
        f("timezone", "Data", "Timezone", default="America/New_York"),
        f("erpnext_company", "Link", "ERPNext Company", options="Company"),
        f("erpnext_warehouse", "Link", "Warehouse", options="Warehouse"),
        f("erp_ar_account", "Data", "AR Account"),
        f("erp_square_account", "Data", "Square Account"),
        f("square_location_id", "Data", "Square Location ID"),
        f("default_deposit_pct", "Int", "Default Deposit %", default="50"),
        f("cal_com_calendar_id", "Data", "Cal.com Calendar ID"),
        f("is_active", "Check", "Active", default="1"),
        f("sort_order", "Int", "Sort Order", default="0"),
        f("opened_on", "Date", "Opened On"),
    ], autoname="field:location_code", naming_rule="By fieldname"),

    "LSH Fabric Pricing": doctype("LSH Fabric Pricing", [
        f("fabric_name", "Data", "Fabric Name", reqd=1, in_list_view=1),
        f("mill", "Data", "Mill", in_list_view=1),
        f("composition", "Data", "Composition"),
        f("weight", "Data", "Weight"),
        f("season", "Data", "Season"),
        f("tier", "Data", "Tier"),
        f("price", "Currency", "Price", in_list_view=1),
        f("is_active", "Check", "Active", default="1"),
    ]),

    "LSH Style Library": doctype("LSH Style Library", [
        f("category", "Data", "Category", reqd=1, in_list_view=1),
        f("style_name", "Data", "Style Name", reqd=1, in_list_view=1),
        f("description", "Text", "Description"),
        f("image_url", "Data", "Image URL"),
        f("is_active", "Check", "Active", default="1"),
    ]),

    "LSH Parked Cart": doctype("LSH Parked Cart", [
        f("location", "Data", "Location", reqd=1, in_list_view=1),
        f("created_by", "Data", "Created By", in_list_view=1),
        f("label", "Data", "Label", in_list_view=1),
        f("customer_ref", "Link", "Customer Ref", options="Customer"),
        f("customer_snapshot", "Long Text", "Customer Snapshot JSON"),
        f("cart_json", "Long Text", "Cart JSON", reqd=1),
        f("status", "Select", "Status", options="Parked\nCommitted\nAbandoned", default="Parked", in_list_view=1),
        f("committed_ticket", "Link", "Committed Ticket", options="Alteration Ticket"),
    ]),

    "LSH Customer Dossier": doctype("LSH Customer Dossier", [
        f("customer", "Link", "Customer", options="Customer", reqd=1, unique=1, in_list_view=1),
        f("dossier_json", "Long Text", "Dossier JSON"),
        f("last_significant_update", "Datetime", "Last Significant Update"),
        f("style_preferences", "Long Text", "Style Preferences"),
        f("fit_notes_structured", "Long Text", "Fit Notes Structured"),
        f("preferences_likes", "Long Text", "Preferences Likes"),
        f("preferences_dislikes", "Long Text", "Preferences Dislikes"),
        f("fabric_interests", "Long Text", "Fabric Interests"),
        f("life_events", "Long Text", "Life Events"),
        f("important_dates", "Long Text", "Important Dates"),
        f("family_context", "Long Text", "Family Context"),
        f("travel_context", "Long Text", "Travel Context"),
        f("professional_context", "Long Text", "Professional Context"),
        f("tone_preferences", "Long Text", "Tone Preferences"),
        f("communication_style", "Long Text", "Communication Style"),
        f("open_action_items", "Long Text", "Open Action Items"),
        f("notable_quotes", "Long Text", "Notable Quotes"),
    ], autoname="field:customer", naming_rule="By fieldname"),

    "LSH Custom Order Garment": doctype("LSH Custom Order Garment", [
        f("garment_type", "Data", "Garment Type", in_list_view=1),
        f("construction", "Data", "Construction"),
        f("garment_status", "Data", "Status", in_list_view=1),
        f("price", "Currency", "Price"),
    ], istable=1),

    "LSH Custom Order": doctype("LSH Custom Order", [
        f("customer", "Link", "Customer", options="Customer", reqd=1, in_list_view=1),
        f("customer_name", "Data", "Customer Name", in_list_view=1),
        f("origin_location", "Data", "Origin Location", reqd=1, in_list_view=1),
        f("status", "Select", "Status", options="\n".join([
            "Submitted", "Consultation", "Ordered", "Pattern", "Cutting", "Sewing",
            "First Fitting", "Alterations", "Second Fitting", "Final QC",
            "In Transit", "Arrived", "Complete", "Delivered", "Cancelled",
        ]), default="Submitted", in_list_view=1),
        f("order_total", "Currency", "Order Total"),
        f("deposit_amount", "Currency", "Deposit Amount"),
        f("special_instructions", "Text", "Special Instructions"),
        f("sales_rep", "Data", "Sales Rep"),
        f("garment_type", "Data", "Garment Type"),
        f("source_channel", "Data", "Source Channel"),
        f("yz_order_number", "Data", "YZ Order Number"),
        f("erp_sales_order", "Link", "ERP Sales Order", options="Sales Order"),
        f("garments", "Table", "Garments", options="LSH Custom Order Garment"),
    ]),

    "LSH Agent": doctype("LSH Agent", [
        f("slug", "Data", "Slug", reqd=1, unique=1, in_list_view=1),
        f("agent_name", "Data", "Name", reqd=1, in_list_view=1),
        f("role", "Data", "Role", in_list_view=1),
        f("description", "Text", "Description"),
        f("status", "Select", "Status", options="active\nidle\nerror\noffline\npaused", default="offline", in_list_view=1),
        f("model", "Data", "Model"),
        f("platform", "Data", "Platform"),
        f("color", "Data", "Color", default="brass"),
        f("icon", "Data", "Icon", default="Bot"),
        f("current_task", "Small Text", "Current Task"),
        f("current_task_since", "Datetime", "Current Task Since"),
        f("last_action_at", "Datetime", "Last Action At"),
        f("last_action_summary", "Small Text", "Last Action Summary"),
        f("last_heartbeat_at", "Datetime", "Last Heartbeat At"),
        f("health_score", "Int", "Health Score", default="100"),
        f("settings", "Long Text", "Settings JSON"),
        f("stats", "Long Text", "Stats JSON"),
        f("enabled", "Check", "Enabled", default="1"),
    ], autoname="field:slug", naming_rule="By fieldname"),

    "LSH Agent Task": doctype("LSH Agent Task", [
        f("assigned_to", "Data", "Assigned To", reqd=1, in_list_view=1),
        f("assigned_by", "Data", "Assigned By", default="c"),
        f("title", "Data", "Title", reqd=1, in_list_view=1),
        f("description", "Text", "Description"),
        f("priority", "Select", "Priority", options="low\nmedium\nhigh\nurgent", default="medium"),
        f("status", "Select", "Status", options="pending\nin_progress\ncompleted\nblocked\ncancelled", default="pending", in_list_view=1),
        f("due_at", "Datetime", "Due At"),
        f("started_at", "Datetime", "Started At"),
        f("completed_at", "Datetime", "Completed At"),
        f("result", "Text", "Result"),
        f("result_metadata", "Long Text", "Result Metadata JSON"),
        f("linked_approval_id", "Data", "Linked Approval ID"),
    ]),

    "LSH Agent Event": doctype("LSH Agent Event", [
        f("agent_slug", "Data", "Agent Slug", reqd=1, in_list_view=1),
        f("event_type", "Data", "Event Type", in_list_view=1),
        f("title", "Data", "Title", reqd=1, in_list_view=1),
        f("body", "Text", "Body"),
        f("severity", "Select", "Severity", options="info\nwarning\nerror\ncritical", default="info"),
        f("task_id", "Data", "Task ID"),
        f("metadata", "Long Text", "Metadata JSON"),
    ]),

    "LSH Agent Brief": doctype("LSH Agent Brief", [
        f("agent_slug", "Data", "Agent Slug", in_list_view=1),
        f("period", "Data", "Period", in_list_view=1),
        f("source", "Data", "Source"),
        f("type", "Data", "Type"),
        f("title", "Data", "Title", in_list_view=1),
        f("body", "Long Text", "Body"),
        f("metadata", "Long Text", "Metadata JSON"),
    ]),

    "LSH Agent Cost": doctype("LSH Agent Cost", [
        f("agent_slug", "Data", "Agent Slug", in_list_view=1),
        f("model", "Data", "Model"),
        f("input_tokens", "Int", "Input Tokens"),
        f("output_tokens", "Int", "Output Tokens"),
        f("cost_usd", "Float", "Cost USD"),
        f("day", "Date", "Day", in_list_view=1),
    ]),

    "LSH Agent Message": doctype("LSH Agent Message", [
        f("agent_slug", "Data", "Agent Slug", in_list_view=1),
        f("role", "Data", "Role", in_list_view=1),
        f("content", "Long Text", "Content"),
    ]),

    "LSH Approval Queue": doctype("LSH Approval Queue", [
        f("title", "Data", "Title", reqd=1, in_list_view=1),
        f("category", "Data", "Category", in_list_view=1),
        f("priority", "Select", "Priority", options="low\nmedium\nhigh\nurgent", default="medium"),
        f("status", "Select", "Status", options="pending\nawaiting_second\napproved\ndenied", default="pending", in_list_view=1),
        f("agent_slug", "Data", "Agent Slug"),
        f("payload", "Long Text", "Payload JSON"),
        f("requested_by", "Data", "Requested By"),
    ]),

    "LSH Approval Decision": doctype("LSH Approval Decision", [
        f("queue_item", "Link", "Queue Item", options="LSH Approval Queue"),
        f("decision", "Select", "Decision", options="approved\ndenied"),
        f("decided_by", "Data", "Decided By"),
        f("notes", "Text", "Notes"),
    ]),

    "LSH SMS Message": doctype("LSH SMS Message", [
        f("client_phone", "Data", "Client Phone", in_list_view=1),
        f("client_name", "Data", "Client Name"),
        f("direction", "Select", "Direction", options="inbound\noutbound", in_list_view=1),
        f("content", "Long Text", "Content"),
        f("body", "Long Text", "Body"),
        f("sender", "Data", "Sender"),
        f("timestamp", "Datetime", "Timestamp", in_list_view=1),
        f("twilio_sid", "Data", "Twilio SID"),
        f("status", "Data", "Status"),
    ]),

    "LSH Call Log": doctype("LSH Call Log", [
        f("external_id", "Data", "External ID", unique=1),
        f("time", "Datetime", "Time", in_list_view=1),
        f("from", "Data", "From", in_list_view=1),
        f("from_caller_name", "Data", "From Caller Name"),
        f("to", "Data", "To"),
        f("direction", "Data", "Direction"),
        f("duration", "Int", "Duration"),
        f("status", "Data", "Status", in_list_view=1),
        f("transcript_raw", "Long Text", "Transcript Raw"),
        f("transcript_whisper", "Long Text", "Transcript Summary"),
        f("recording", "Data", "Recording URL"),
    ]),

    "LSH Brain Entry": doctype("LSH Brain Entry", [
        f("agent_slug", "Data", "Agent Slug"),
        f("entry_type", "Data", "Entry Type", in_list_view=1),
        f("summary", "Text", "Summary", in_list_view=1),
        f("content", "Long Text", "Content"),
        f("metadata", "Long Text", "Metadata JSON"),
        f("flagged", "Check", "Flagged"),
    ]),

    "LSH Pending Email Draft": doctype("LSH Pending Email Draft", [
        f("inbox", "Data", "Inbox"),
        f("status", "Data", "Status", in_list_view=1),
        f("to_email", "Data", "To Email"),
        f("subject", "Data", "Subject", in_list_view=1),
        f("body", "Long Text", "Body"),
        f("metadata", "Long Text", "Metadata JSON"),
    ]),

    "LSH Audit Log": doctype("LSH Audit Log", [
        f("agent_slug", "Data", "Agent Slug", in_list_view=1),
        f("action", "Data", "Action", in_list_view=1),
        f("detail", "Text", "Detail"),
        f("metadata", "Long Text", "Metadata JSON"),
    ]),

    "LSH Cron Job": doctype("LSH Cron Job", [
        f("job_name", "Data", "Job Name", reqd=1, in_list_view=1),
        f("agent_slug", "Data", "Agent Slug"),
        f("schedule", "Data", "Schedule"),
        f("enabled", "Check", "Enabled", default="1"),
        f("last_run_at", "Datetime", "Last Run At"),
    ]),

    "LSH Escalation": doctype("LSH Escalation", [
        f("client_phone", "Data", "Client Phone", in_list_view=1),
        f("client_name", "Data", "Client Name"),
        f("reason", "Text", "Reason"),
        f("status", "Data", "Status", in_list_view=1),
        f("resolved_at", "Datetime", "Resolved At"),
    ]),

    "LSH Task": doctype("LSH Task", [
        f("title", "Data", "Title", reqd=1, in_list_view=1),
        f("description", "Text", "Description"),
        f("status", "Data", "Status", in_list_view=1),
        f("priority", "Data", "Priority"),
        f("assigned_to", "Data", "Assigned To"),
        f("due_date", "Date", "Due Date"),
    ]),

    "LSH Task Item": doctype("LSH Task Item", [
        f("task", "Link", "Task", options="LSH Task"),
        f("label", "Data", "Label", in_list_view=1),
        f("done", "Check", "Done"),
    ], istable=1),

    "LSH Conversation Handoff": doctype("LSH Conversation Handoff", [
        f("client_phone", "Data", "Client Phone", in_list_view=1),
        f("handoff_to", "Data", "Handoff To"),
        f("reason", "Text", "Reason"),
        f("context", "Long Text", "Context JSON"),
    ]),

    "LSH Sofia Activity Log": doctype("LSH Sofia Activity Log", [
        f("activity_type", "Data", "Activity Type", in_list_view=1),
        f("client_phone", "Data", "Client Phone"),
        f("detail", "Text", "Detail"),
        f("metadata", "Long Text", "Metadata JSON"),
    ]),

    "LSH Order Request": doctype("LSH Order Request", [
        f("customer", "Link", "Customer", options="Customer"),
        f("transaction_id", "Data", "Transaction ID"),
        f("request_type", "Data", "Request Type"),
        f("details", "Text", "Details"),
        f("status", "Data", "Status", in_list_view=1),
        f("source_phone", "Data", "Source Phone"),
    ]),

    "LSH Mfg Order": doctype("LSH Mfg Order", [
        f("order_number", "Data", "Order Number", in_list_view=1),
        f("customer_name", "Data", "Customer Name"),
        f("status", "Data", "Status", in_list_view=1),
        f("metadata", "Long Text", "Metadata JSON"),
    ]),

    "LSH MMS Template": doctype("LSH MMS Template", [
        f("template_key", "Data", "Template Key", reqd=1, unique=1, in_list_view=1),
        f("body", "Long Text", "Body"),
        f("media_url", "Data", "Media URL"),
        f("is_active", "Check", "Active", default="1"),
    ]),

    "LSH Email Message Log": doctype("LSH Email Message Log", [
        f("to_email", "Data", "To Email", in_list_view=1),
        f("subject", "Data", "Subject"),
        f("body", "Long Text", "Body"),
        f("status", "Data", "Status"),
    ]),

    "LSH Plaud Capture": doctype("LSH Plaud Capture", [
        f("recorded_at", "Datetime", "Recorded At", in_list_view=1),
        f("title", "Data", "Title"),
        f("transcript", "Long Text", "Transcript"),
        f("summary", "Text", "Summary"),
    ]),

    "LSH Voice Approval Request": doctype("LSH Voice Approval Request", [
        f("request_text", "Text", "Request Text"),
        f("status", "Data", "Status", in_list_view=1),
        f("caller_phone", "Data", "Caller Phone"),
    ]),

    "LSH Geelus Transaction": doctype("LSH Geelus Transaction", [
        f("transaction_id", "Data", "Transaction ID", in_list_view=1),
        f("amount", "Currency", "Amount"),
        f("metadata", "Long Text", "Metadata JSON"),
    ]),

    "LSH Customer Meeting": doctype("LSH Customer Meeting", [
        f("customer", "Link", "Customer", options="Customer"),
        f("meeting_at", "Datetime", "Meeting At", in_list_view=1),
        f("notes", "Text", "Notes"),
    ]),

    "LSH Dossier Observation": doctype("LSH Dossier Observation", [
        f("customer", "Link", "Customer", options="Customer"),
        f("observation", "Text", "Observation", in_list_view=1),
    ]),

    "LSH Customer Communication": doctype("LSH Customer Communication", [
        f("customer", "Link", "Customer", options="Customer"),
        f("channel", "Data", "Channel"),
        f("content", "Long Text", "Content"),
    ]),
}


CUSTOM_FIELDS = [
    {"dt": "Customer", "fieldname": "custom_lst_division", "label": "LST Division", "fieldtype": "Data", "insert_after": "customer_group"},
    {"dt": "Customer", "fieldname": "custom_vip_tier", "label": "VIP Tier", "fieldtype": "Data", "insert_after": "custom_lst_division", "default": "Standard"},
    {"dt": "Customer", "fieldname": "custom_status", "label": "LST Status", "fieldtype": "Data", "insert_after": "custom_vip_tier", "default": "Active"},
    {"dt": "Customer", "fieldname": "custom_client_notes", "label": "Client Notes", "fieldtype": "Text", "insert_after": "custom_status"},
    {"dt": "Customer", "fieldname": "custom_style_preferences", "label": "Style Preferences", "fieldtype": "Text", "insert_after": "custom_client_notes"},
    {"dt": "Customer", "fieldname": "custom_fit_notes", "label": "Fit Notes", "fieldtype": "Text", "insert_after": "custom_style_preferences"},
    {"dt": "Customer", "fieldname": "custom_company", "label": "Company Name", "fieldtype": "Data", "insert_after": "custom_fit_notes"},
    {"dt": "Customer", "fieldname": "custom_title_role", "label": "Title / Role", "fieldtype": "Data", "insert_after": "custom_company"},
    {"dt": "Customer", "fieldname": "custom_source_channel", "label": "Source Channel", "fieldtype": "Data", "insert_after": "custom_title_role"},
    {"dt": "Customer", "fieldname": "custom_birthday", "label": "Birthday", "fieldtype": "Date", "insert_after": "custom_source_channel"},
    {"dt": "Customer", "fieldname": "custom_anniversary", "label": "Anniversary", "fieldtype": "Date", "insert_after": "custom_birthday"},
    {"dt": "Customer", "fieldname": "custom_communication_pref", "label": "Communication Pref", "fieldtype": "Data", "insert_after": "custom_anniversary"},
    {"dt": "Customer", "fieldname": "custom_preferred_contact", "label": "Preferred Contact", "fieldtype": "Data", "insert_after": "custom_communication_pref", "default": "email"},
    {"dt": "Customer", "fieldname": "custom_sms_opted_out", "label": "SMS Opted Out", "fieldtype": "Check", "insert_after": "custom_preferred_contact"},
    {"dt": "Customer", "fieldname": "custom_payment_preference", "label": "Payment Preference", "fieldtype": "Data", "insert_after": "custom_sms_opted_out"},
    {"dt": "Customer", "fieldname": "custom_credit_terms", "label": "Credit Terms", "fieldtype": "Data", "insert_after": "custom_payment_preference"},
    {"dt": "Customer", "fieldname": "custom_referral_code", "label": "Referral Code", "fieldtype": "Data", "insert_after": "custom_credit_terms"},
    {"dt": "Customer", "fieldname": "custom_referral_credits", "label": "Referral Credits", "fieldtype": "Currency", "insert_after": "custom_referral_code"},
    {"dt": "Customer", "fieldname": "custom_casa_tier", "label": "Casa Tier", "fieldtype": "Data", "insert_after": "custom_referral_credits"},
    {"dt": "User", "fieldname": "lst_location", "label": "LST Location", "fieldtype": "Data", "insert_after": "email"},
]


def slug(name: str) -> str:
    return name.lower().replace(" ", "_").replace("&", "and")


def write_doctype(name: str, doc: dict) -> None:
    s = slug(name)
    d = ROOT / s
    d.mkdir(parents=True, exist_ok=True)
    (d / "__init__.py").write_text("")
    (d / f"{s}.json").write_text(json.dumps(doc, indent=1) + "\n")
    (d / f"{s}.py").write_text(
        f"import frappe\n\n\nclass {''.join(w.capitalize() for w in s.split('_'))}(frappe.model.document.Document):\n\tpass\n"
    )


def main() -> None:
    for name, doc in SCHEMAS.items():
        write_doctype(name, doc)
        print(f"  wrote {name}")

    fixtures_dir = FIXTURES_DIR
    fixtures_dir.mkdir(parents=True, exist_ok=True)

    cf_docs = []
    for cf in CUSTOM_FIELDS:
        cf_docs.append({
            "doctype": "Custom Field",
            "module": "LSH House",
            "name": f"Customer-{cf['fieldname']}" if cf["dt"] == "Customer" else f"User-{cf['fieldname']}",
            **cf,
        })
    (fixtures_dir / "custom_field.json").write_text(json.dumps(cf_docs, indent=1) + "\n")

    locations = [
        {"doctype": "LSH Location", "location_code": "NYC", "location_name": "New York", "short_name": "NYC", "is_active": 1, "sort_order": 1, "timezone": "America/New_York"},
        {"doctype": "LSH Location", "location_code": "HOU", "location_name": "Houston", "short_name": "HOU", "is_active": 1, "sort_order": 2, "timezone": "America/Chicago"},
    ]
    agents = [
        {"doctype": "LSH Agent", "slug": "maestro", "agent_name": "Maestro", "role": "Orchestrator", "status": "offline", "model": "claude-sonnet-4", "platform": "Hermes · Mac Studio", "color": "brass", "icon": "Crown", "enabled": 1},
        {"doctype": "LSH Agent", "slug": "sofia", "agent_name": "Sofia", "role": "Client Concierge", "status": "offline", "model": "grok-3", "platform": "n8n Cloud · Twilio", "color": "emerald", "icon": "Phone", "enabled": 1},
        {"doctype": "LSH Agent", "slug": "mia", "agent_name": "Mia", "role": "Scheduling & Dossiers", "status": "offline", "model": "claude-haiku-3-5", "platform": "Mac Studio · Cal.com", "color": "blue", "icon": "Calendar", "enabled": 1},
        {"doctype": "LSH Agent", "slug": "rocco", "agent_name": "Rocco", "role": "Production & Delivery", "status": "offline", "model": "claude-sonnet-4", "platform": "Mac Studio · MTMPro · ERPNext", "color": "amber", "icon": "Factory", "enabled": 1},
        {"doctype": "LSH Agent", "slug": "melena", "agent_name": "Melena", "role": "Accounting & Books", "status": "offline", "model": "claude-sonnet-4", "platform": "Mac Studio · ERPNext · Square", "color": "rose", "icon": "DollarSign", "enabled": 1},
        {"doctype": "LSH Agent", "slug": "filo", "agent_name": "Filo", "role": "Ingestion & Intelligence", "status": "offline", "model": "llama3:8b (local)", "platform": "Mac Studio · Ollama · IMAP", "color": "purple", "icon": "Brain", "enabled": 1},
    ]
    (fixtures_dir / "lsh_location.json").write_text(json.dumps(locations, indent=1) + "\n")
    (fixtures_dir / "lsh_agent.json").write_text(json.dumps(agents, indent=1) + "\n")
    print("  wrote fixtures")


if __name__ == "__main__":
    print("Generating LSH House DocTypes...")
    main()
    print("Done.")
