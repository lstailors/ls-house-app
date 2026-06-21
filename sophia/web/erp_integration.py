"""
ERPNext integration layer for Sophia.
All persistent state — conversations, logs, tool calls — is written here,
to the LSH Communication Log DocType and linked ERPNext records.
No SQLite. ERPNext is the single source of truth.
"""

import json
import logging
from datetime import datetime, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

import httpx

NYC = ZoneInfo("America/New_York")

from web.config import settings

logger = logging.getLogger("sophia.erp")


# ─── HTTP helpers ─────────────────────────────────────────────────────────────

def _headers() -> dict:
    return {
        "Authorization": f"token {settings.ERPNEXT_API_KEY}:{settings.ERPNEXT_API_SECRET}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


async def erp_get(endpoint: str, params: dict = None) -> dict:
    url = f"{settings.ERPNEXT_URL}/api/{endpoint}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url, headers=_headers(), params=params or {})
    resp.raise_for_status()
    return resp.json()


async def erp_post(endpoint: str, data: dict) -> dict:
    url = f"{settings.ERPNEXT_URL}/api/{endpoint}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(url, headers=_headers(), json=data)
    resp.raise_for_status()
    return resp.json()


async def erp_put(endpoint: str, data: dict) -> dict:
    url = f"{settings.ERPNEXT_URL}/api/{endpoint}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.put(url, headers=_headers(), json=data)
    resp.raise_for_status()
    return resp.json()


async def erp_method(method: str, params: dict = None) -> dict:
    """Call a whitelisted Frappe server-side method."""
    url = f"{settings.ERPNEXT_URL}/api/method/{method}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.get(url, headers=_headers(), params=params or {})
    resp.raise_for_status()
    return resp.json()


async def erp_method_post(method: str, data: dict = None) -> dict:
    """POST to a whitelisted Frappe server-side method."""
    url = f"{settings.ERPNEXT_URL}/api/method/{method}"
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(url, headers=_headers(), json=data or {})
    resp.raise_for_status()
    return resp.json()


# ─── Customer lookup ──────────────────────────────────────────────────────────

async def find_customer_by_phone(phone: str) -> Optional[str]:
    """Return ERPNext Customer docname for this phone number, or None."""
    if not phone or not settings.ERPNEXT_URL:
        return None
    normalized = phone[-10:]
    try:
        resp = await erp_get(
            "resource/Customer",
            params={
                "filters": json.dumps([["mobile_no", "like", f"%{normalized}%"]]),
                "fields": '["name"]',
                "limit": 1,
            },
        )
        customers = resp.get("data", [])
        return customers[0]["name"] if customers else None
    except Exception as e:
        logger.warning(f"Customer lookup failed for {phone}: {e}")
        return None


def _fmt_nyc(ts_str: str) -> str:
    """Convert a stored timestamp string to a readable NYC local time."""
    if not ts_str:
        return ""
    try:
        # ERPNext stores as "YYYY-MM-DD HH:MM:SS" — treat as NYC (that's how we store it)
        dt = datetime.strptime(ts_str[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=NYC)
        return dt.strftime("%a %b %-d, %Y at %-I:%M %p ET")
    except Exception:
        return ts_str[:16]


async def get_caller_context(phone: str) -> dict:
    """
    Build full caller memory for session prompt injection.
    Returns: {customer_name: str|None, memory_block: str}

    Fetches:
    - Customer name and record from ERPNext Customers
    - Complete interaction history (all calls + SMS, oldest first)
    - Upcoming and past appointments
    """
    if not phone or not settings.ERPNEXT_URL:
        return {"customer_name": None, "memory_block": ""}

    normalized = phone[-10:]

    # Run all lookups concurrently
    import asyncio
    customer_task = asyncio.create_task(find_customer_by_phone(phone))

    async def _fetch_communications():
        try:
            resp = await erp_get(
                "resource/LSH Communication Log",
                params={
                    "filters": json.dumps([
                        ["caller_phone", "like", f"%{normalized}%"],
                    ]),
                    "fields": '["name","timestamp","communication_type","direction","content","transcript","appointment_booked"]',
                    "order_by": "timestamp asc",
                    "limit": 100,  # full history
                },
            )
            return resp.get("data", [])
        except Exception as e:
            logger.warning(f"Could not fetch communications for {phone}: {e}")
            return []

    async def _fetch_appointments(cust_name: Optional[str]):
        if not cust_name:
            return []
        try:
            resp = await erp_get(
                "resource/Appointment",
                params={
                    "filters": json.dumps([["customer", "=", cust_name]]),
                    "fields": '["name","scheduled_time","status","appointment_with","notes"]',
                    "order_by": "scheduled_time desc",
                    "limit": 10,
                },
            )
            return resp.get("data", [])
        except Exception as e:
            logger.warning(f"Could not fetch appointments for {cust_name}: {e}")
            return []

    comms, customer_name = await asyncio.gather(_fetch_communications(), customer_task)
    appointments = await _fetch_appointments(customer_name)

    sections: list[str] = []

    # ── Customer identity ─────────────────────────────────────────────────────
    if customer_name:
        sections.append(f"KNOWN CUSTOMER: {customer_name}")
    else:
        sections.append("NEW CALLER: No existing customer record in ERPNext.")

    # ── Appointment history ───────────────────────────────────────────────────
    if appointments:
        now_nyc = datetime.now(NYC)
        upcoming = [a for a in appointments if a.get("scheduled_time", "") > now_nyc.strftime("%Y-%m-%d %H:%M:%S")]
        past = [a for a in appointments if a not in upcoming]

        if upcoming:
            lines = []
            for a in sorted(upcoming, key=lambda x: x.get("scheduled_time", "")):
                with_who = a.get("appointment_with") or "—"
                ts = _fmt_nyc(a.get("scheduled_time", ""))
                lines.append(f"  • {ts} with {with_who} [{a.get('status','')}]")
            sections.append("UPCOMING APPOINTMENTS:\n" + "\n".join(lines))

        if past:
            lines = []
            for a in past[:5]:  # last 5 past appointments
                with_who = a.get("appointment_with") or "—"
                ts = _fmt_nyc(a.get("scheduled_time", ""))
                status = a.get("status", "")
                notes = a.get("notes", "").strip()
                entry = f"  • {ts} with {with_who} [{status}]"
                if notes:
                    entry += f"\n    Notes: {notes[:200]}"
                lines.append(entry)
            sections.append("PAST APPOINTMENTS (most recent first):\n" + "\n".join(lines))

    # ── Full communication history ────────────────────────────────────────────
    if comms:
        lines = []
        for r in comms:
            ts = _fmt_nyc(r.get("timestamp", ""))
            ctype = r.get("communication_type", "")
            direction = r.get("direction", "")
            appt = r.get("appointment_booked")

            if ctype == "Call":
                transcript = (r.get("transcript") or "").strip()
                if transcript:
                    lines.append(f"[{ts}] CALL ({direction}):\n{transcript}\n")
                else:
                    lines.append(f"[{ts}] CALL ({direction}): no transcript recorded")
            else:
                content = (r.get("content") or "").strip()
                if content:
                    lines.append(f"[{ts}] {ctype} ({direction}): {content}")

            if appt:
                lines.append(f"  → Appointment booked: {appt}")

        sections.append("FULL INTERACTION HISTORY (oldest first):\n" + "\n".join(lines))
    else:
        sections.append("INTERACTION HISTORY: No previous interactions on record.")

    # ── Current NYC time ──────────────────────────────────────────────────────
    now_str = datetime.now(NYC).strftime("%A, %B %-d, %Y at %-I:%M %p ET")
    sections.append(f"CURRENT DATE/TIME (New York): {now_str}")

    memory_block = "\n\n".join(sections)
    return {"customer_name": customer_name, "memory_block": memory_block}


# ─── LSH Communication Log ────────────────────────────────────────────────────

async def create_communication_log(
    communication_type: str,        # "Call" | "SMS" | "Internal Note"
    direction: str,                  # "Inbound" | "Outbound"
    caller_phone: str,
    content: str,
    mode: str = "customer",
    session_id: str = "",
    duration_seconds: int = 0,
    transcript: str = "",
    appointment_name: str = "",
    tool_calls: list[dict] = None,
) -> Optional[str]:
    """
    Create an LSH Communication Log record in ERPNext.
    Returns the new doc name (e.g. "LSH-COM-00042"), or None if ERPNext is down.
    """
    if not settings.ERPNEXT_URL:
        logger.warning("ERPNext not configured — skipping communication log")
        return None

    customer_name = await find_customer_by_phone(caller_phone)

    doc: dict[str, Any] = {
        "doctype": "LSH Communication Log",
        "communication_type": communication_type,
        "direction": direction,
        "caller_phone": caller_phone,
        "content": content,
        "mode": mode,
        "session_id": session_id,
        "duration_seconds": duration_seconds,
        "transcript": transcript,
        "timestamp": datetime.now(NYC).strftime("%Y-%m-%d %H:%M:%S"),
    }
    if customer_name:
        doc["customer"] = customer_name
    if appointment_name:
        doc["appointment_booked"] = appointment_name

    if tool_calls:
        doc["tool_calls"] = [
            {
                "tool_name": tc.get("tool_name", ""),
                "input_params": json.dumps(tc.get("input_params", {})),
                "output_result": json.dumps(tc.get("output_result", {})),
                "call_timestamp": tc.get("timestamp", ""),
            }
            for tc in tool_calls
        ]

    try:
        resp = await erp_post("resource/LSH Communication Log", doc)
        name = resp.get("data", {}).get("name") or resp.get("name")
        logger.info(f"Communication log created: {name} ({communication_type} {direction} from {caller_phone})")
        return name
    except httpx.HTTPStatusError as e:
        # If doctype doesn't exist yet, log and continue gracefully
        logger.error(f"Failed to create communication log: {e.response.status_code} {e.response.text[:200]}")
        return None
    except Exception as e:
        logger.error(f"Communication log error: {e}")
        return None


async def update_communication_log(
    doc_name: str,
    transcript: str = "",
    duration_seconds: int = 0,
    tool_calls: list[dict] = None,
    appointment_name: str = "",
):
    """Update an existing communication log after a call ends."""
    if not settings.ERPNEXT_URL or not doc_name:
        return

    update: dict[str, Any] = {}
    if transcript:
        update["transcript"] = transcript
    if duration_seconds:
        update["duration_seconds"] = duration_seconds
    if appointment_name:
        update["appointment_booked"] = appointment_name
    if tool_calls:
        update["tool_calls"] = [
            {
                "tool_name": tc.get("tool_name", ""),
                "input_params": json.dumps(tc.get("input_params", {})),
                "output_result": json.dumps(tc.get("output_result", {})),
                "call_timestamp": tc.get("timestamp", ""),
            }
            for tc in tool_calls
        ]

    try:
        await erp_put(f"resource/LSH Communication Log/{doc_name}", update)
    except Exception as e:
        logger.error(f"Failed to update communication log {doc_name}: {e}")


async def get_sms_history(caller_phone: str, limit: int = 10) -> list[dict]:
    """
    Retrieve recent SMS history for a caller from ERPNext.
    Returns list of {direction, content} dicts, oldest first.
    """
    if not settings.ERPNEXT_URL:
        return []
    try:
        resp = await erp_get(
            "resource/LSH Communication Log",
            params={
                "filters": json.dumps([
                    ["caller_phone", "like", f"%{caller_phone[-10:]}%"],
                    ["communication_type", "=", "SMS"],
                ]),
                "fields": '["direction","content","timestamp"]',
                "order_by": "timestamp desc",
                "limit": limit,
            },
        )
        rows = resp.get("data", [])
        # Return oldest-first so they read as a natural conversation
        return [{"direction": r["direction"].lower(), "content": r["content"]} for r in reversed(rows)]
    except Exception as e:
        logger.warning(f"Could not fetch SMS history: {e}")
        return []


# ─── Booking API wrappers (Session 1 endpoints) ───────────────────────────────

async def erp_list_agents() -> list[dict]:
    """
    Fetch active booking agents from ERPNext.
    Calls the whitelisted endpoint from Session 1.
    Falls back to hardcoded names if ERPNext is down.
    """
    if not settings.ERPNEXT_URL:
        return _fallback_agents()
    try:
        resp = await erp_method("frappe.client.get_list", params={
            "doctype": "LSH Booking Agent",
            "filters": json.dumps([["active", "=", 1]]),
            "fields": '["name","agent_display_name","specialization"]',
        })
        agents = resp.get("message", [])
        if agents:
            return agents
        return _fallback_agents()
    except Exception as e:
        logger.warning(f"list_agents fallback: {e}")
        return _fallback_agents()


def _fallback_agents() -> list[dict]:
    return [
        {"name": "calogero", "agent_display_name": "Calogero"},
        {"name": "salvatore", "agent_display_name": "Salvatore"},
        {"name": "kelvin", "agent_display_name": "Kelvin"},
        {"name": "christopher", "agent_display_name": "Christopher"},
    ]


async def erp_get_available_slots(
    date_from: str,
    date_to: str,
    agent_name: str = None,
) -> list[dict]:
    """
    Call the Session 1 availability resolver for open appointment slots.
    Returns list of {slot_datetime, agent, duration_minutes}.
    """
    if not settings.ERPNEXT_URL:
        return []
    try:
        params = {"date_from": date_from, "date_to": date_to}
        if agent_name:
            params["agent_name"] = agent_name
        resp = await erp_method("lsh_bookings.api.get_available_slots", params=params)
        return resp.get("message", [])
    except Exception as e:
        logger.warning(f"get_available_slots error: {e}")
        return []


async def erp_create_appointment(
    customer_name: str,
    customer_email: str,
    customer_phone: str,
    agent_name: str,
    slot_datetime: str,
    service_type: str = "Consultation",
    notes: str = "",
) -> dict:
    """
    Book an appointment via the Session 1 create_appointment endpoint.
    Returns the created Appointment doc name on success.
    """
    resp = await erp_method_post("lsh_bookings.api.create_appointment", {
        "customer_name": customer_name,
        "customer_email": customer_email,
        "customer_phone": customer_phone,
        "agent_name": agent_name,
        "slot_datetime": slot_datetime,
        "service_type": service_type,
        "notes": notes,
    })
    return resp.get("message", {})


# ─── Dashboard data helpers ───────────────────────────────────────────────────

async def get_recent_activity(limit: int = 50) -> list[dict]:
    if not settings.ERPNEXT_URL:
        return []
    try:
        resp = await erp_get(
            "resource/LSH Communication Log",
            params={
                "fields": '["name","timestamp","communication_type","direction","caller_phone","content","mode","transcript","customer"]',
                "order_by": "timestamp desc",
                "limit": limit,
            },
        )
        return resp.get("data", [])
    except Exception as e:
        logger.error(f"get_recent_activity: {e}")
        return []


async def search_communications(query: str, limit: int = 100) -> list[dict]:
    if not settings.ERPNEXT_URL:
        return []
    try:
        resp = await erp_get(
            "resource/LSH Communication Log",
            params={
                "filters": json.dumps([
                    ["caller_phone", "like", f"%{query}%"],
                ]),
                "fields": '["name","timestamp","communication_type","direction","caller_phone","content","mode","transcript","customer"]',
                "order_by": "timestamp desc",
                "limit": limit,
            },
        )
        rows = resp.get("data", [])
        # Also search content via OR-style separate call
        try:
            resp2 = await erp_get(
                "resource/LSH Communication Log",
                params={
                    "filters": json.dumps([["content", "like", f"%{query}%"]]),
                    "fields": '["name","timestamp","communication_type","direction","caller_phone","content","mode","transcript","customer"]',
                    "order_by": "timestamp desc",
                    "limit": limit,
                },
            )
            rows += [r for r in resp2.get("data", []) if r["name"] not in {x["name"] for x in rows}]
        except Exception:
            pass
        return rows
    except Exception as e:
        logger.error(f"search_communications: {e}")
        return []


async def get_stats() -> dict:
    if not settings.ERPNEXT_URL:
        return {"today_total": 0, "today_calls": 0, "today_sms": 0, "total_all_time": 0}
    today = datetime.now(NYC).date().isoformat()
    try:
        async def count(extra_filters: list) -> int:
            resp = await erp_get(
                "resource/LSH Communication Log",
                params={
                    "filters": json.dumps(extra_filters),
                    "fields": '["name"]',
                    "limit": 9999,
                },
            )
            return len(resp.get("data", []))

        today_total = await count([["timestamp", "like", f"{today}%"], ["direction", "=", "Inbound"]])
        today_calls = await count([["timestamp", "like", f"{today}%"], ["communication_type", "=", "Call"], ["direction", "=", "Inbound"]])
        today_sms = await count([["timestamp", "like", f"{today}%"], ["communication_type", "=", "SMS"], ["direction", "=", "Inbound"]])
        total_all = await count([["direction", "=", "Inbound"]])
        return {
            "today_total": today_total,
            "today_calls": today_calls,
            "today_sms": today_sms,
            "total_all_time": total_all,
        }
    except Exception as e:
        logger.error(f"get_stats: {e}")
        return {"today_total": 0, "today_calls": 0, "today_sms": 0, "total_all_time": 0}
