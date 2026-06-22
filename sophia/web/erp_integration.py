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

    # Append unified house app context (dossier, Cal.com appts, Geelus orders, SMS history)
    house_ctx = await get_house_app_context(phone)
    if house_ctx:
        memory_block = memory_block + "\n\n" + house_ctx

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


async def send_whatsapp_via_erpnext(
    to: str,
    message: str,
    reply_to_message_id: str = "",
) -> bool:
    """
    Send an outgoing WhatsApp message by creating a 'WhatsApp Message' doc in ERPNext.
    The frappe_whatsapp app delivers it to Meta synchronously on insert
    (WhatsAppMessage.before_insert -> send_outgoing). `to` may be digits or +E.164;
    the app strips the leading '+'. Returns True on a successful create.
    """
    if not settings.ERPNEXT_URL:
        logger.warning("ERPNext not configured — cannot send WhatsApp")
        return False

    doc: dict[str, Any] = {
        "doctype": "WhatsApp Message",
        "type": "Outgoing",
        "to": to,
        "message": message,
        "content_type": "text",
    }
    if reply_to_message_id:
        doc["is_reply"] = 1
        doc["reply_to_message_id"] = reply_to_message_id

    try:
        resp = await erp_post("resource/WhatsApp Message", doc)
        name = resp.get("data", {}).get("name") or resp.get("name")
        logger.info(f"WhatsApp sent via ERPNext to {to} (doc {name})")
        return True
    except httpx.HTTPStatusError as e:
        logger.error(f"WhatsApp send failed: {e.response.status_code} {e.response.text[:200]}")
        return False
    except Exception as e:
        logger.error(f"WhatsApp send error: {e}")
        return False


async def get_sms_history(caller_phone: str, limit: int = 10, channel: str = "SMS") -> list[dict]:
    """
    Retrieve recent message history for a caller on a single channel from ERPNext.
    `channel` matches communication_type ("SMS" or "WhatsApp") — each is a
    separate thread (WhatsApp does not mirror SMS, even on the same number).
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
                    ["communication_type", "=", channel],
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


# ─── Booking ──────────────────────────────────────────────────────────────────

# Business hours in NYC time.
# Saturdays off July and August; first two weeks of August fully closed.

# Appointment type durations (minutes)
APPT_DURATIONS: dict[str, int] = {
    "Initial Consultation": 60,
    "Consultation":         60,
    "Fitting":              15,
    "Alteration":           5,
    "Alteration Pickup":    5,
}
_DEFAULT_DURATION_MINS = 60
_SLOT_BUFFER_MINS      = 15   # buffer between appointments
LOCATION_SEATS         = 2    # physical seats at 138 E 61st St


def _business_hours(date: "datetime") -> Optional[tuple[int, int, int, int]]:
    """
    Return (open_h, open_m, close_h, close_m) for a given NYC date,
    or None if the shop is closed that day.
    """
    month, day, weekday = date.month, date.day, date.weekday()  # 0=Mon ... 6=Sun

    # First two weeks of August: fully closed (annual vacation)
    if month == 8 and day <= 14:
        return None

    # Summer (July & August): Monday–Friday 9am–5pm, NO weekends.
    if month in (7, 8):
        if weekday >= 5:  # Saturday or Sunday
            return None
        return (9, 0, 17, 0)

    # Regular season (September–June): closed Sunday and Monday.
    if weekday in (6, 0):  # Sunday, Monday
        return None

    # Saturday: 9am–3pm
    if weekday == 5:
        return (9, 0, 15, 0)

    # Tuesday–Friday: 9am–5pm
    return (9, 0, 17, 0)


def _generate_slots_for_day(date: "datetime", service_type: str = "Initial Consultation") -> list[dict]:
    """Generate all possible slot start times for a single day (no conflict check).
    Uses per-service duration. Slots are time-based, not agent-based — availability
    is determined by LOCATION_SEATS (2 physical chairs), checked at query time.
    """
    hours = _business_hours(date)
    if not hours:
        return []
    open_h, open_m, close_h, close_m = hours
    from datetime import timedelta
    duration = APPT_DURATIONS.get(service_type, _DEFAULT_DURATION_MINS)
    step = duration + _SLOT_BUFFER_MINS
    slots = []
    current = date.replace(hour=open_h, minute=open_m, second=0, microsecond=0)
    close_dt = date.replace(hour=close_h, minute=close_m, second=0, microsecond=0)
    while True:
        end = current + timedelta(minutes=duration)
        if end > close_dt:
            break
        slots.append({
            "slot_datetime": current.strftime("%Y-%m-%d %H:%M"),
            "slot_datetime_display": current.strftime("%A, %B %-d at %-I:%M %p"),
            "duration_minutes": duration,
        })
        current += timedelta(minutes=step)
    return slots


async def erp_list_agents() -> list[dict]:
    """Fetch active booking agents from ERPNext LSH Booking Agent doctype."""
    if not settings.ERPNEXT_URL:
        return _fallback_agents()
    try:
        resp = await erp_get(
            "resource/LSH Booking Agent",
            params={
                "filters": json.dumps([["active", "=", 1]]),
                "fields": '["name","display_name"]',
                "limit": 20,
            },
        )
        agents = resp.get("data", [])
        if agents:
            return [{"name": a["name"], "display_name": a["display_name"]} for a in agents]
        return _fallback_agents()
    except Exception as e:
        logger.warning(f"list_agents fallback: {e}")
        return _fallback_agents()


def _fallback_agents() -> list[dict]:
    return [
        {"name": "Calogero Cristiano", "display_name": "Calogero"},
        {"name": "Salvatore Cristiano", "display_name": "Salvatore"},
        {"name": "Kelvin", "display_name": "Kelvin"},
        {"name": "Christopher Korey", "display_name": "Christopher"},
    ]


async def erp_get_available_slots(
    date_from: str,
    date_to: str,
    agent_name: str = None,
    service_type: str = "Initial Consultation",
) -> list[dict]:
    """
    Generate available appointment slots using a 2-seat capacity model.
    A slot is available if fewer than LOCATION_SEATS (2) appointments are
    already booked at that time. Duration varies by service_type.
    Returns list of {slot_datetime, slot_datetime_display, duration_minutes}.
    """
    from datetime import timedelta

    try:
        start = datetime.strptime(date_from, "%Y-%m-%d").replace(tzinfo=NYC)
        end   = datetime.strptime(date_to,   "%Y-%m-%d").replace(tzinfo=NYC)
    except ValueError:
        logger.warning(f"Invalid date range: {date_from} – {date_to}")
        return []

    # Generate all candidate slots for the date range
    candidate_slots = []
    current = start
    while current <= end:
        for slot in _generate_slots_for_day(current, service_type):
            candidate_slots.append(slot)
        current += timedelta(days=1)

    if not candidate_slots or not settings.ERPNEXT_URL:
        return candidate_slots

    # Fetch existing appointments in range to count seat usage
    try:
        resp = await erp_get(
            "resource/Appointment",
            params={
                "filters": json.dumps([
                    ["scheduled_time", ">=", f"{date_from} 00:00:00"],
                    ["scheduled_time", "<=", f"{date_to} 23:59:59"],
                    ["status", "!=", "Closed"],
                ]),
                "fields": '["scheduled_time"]',
                "limit": 500,
            },
        )
        booked = resp.get("data", [])
    except Exception as e:
        logger.warning(f"Could not fetch existing appointments: {e}")
        booked = []

    # Count how many appointments are at each time slot
    from collections import Counter
    booked_counts: Counter = Counter()
    for b in booked:
        ts = b.get("scheduled_time", "")[:16]  # "YYYY-MM-DD HH:MM"
        if ts:
            booked_counts[ts] += 1

    # A slot is open if fewer than LOCATION_SEATS bookings exist at that time
    available = [
        s for s in candidate_slots
        if booked_counts[s["slot_datetime"]] < LOCATION_SEATS
    ]

    return available[:20]


async def check_alteration_eligibility(phone: str, customer_name: str = "") -> dict:
    """
    Check if a customer is eligible for alterations.
    Policy: must have a completed Sales Invoice within the past 12 months
    (i.e. they commissioned something with L&S in that period).
    Returns {eligible: bool, last_order_date: str|None, customer_name: str|None}.
    """
    from datetime import timedelta
    cutoff = (datetime.now(NYC) - timedelta(days=365)).strftime("%Y-%m-%d")

    # Try to find customer by phone first
    customer = await find_customer_by_phone(phone)
    cust_name = (customer.get("customer_name") if isinstance(customer, dict) else None) or customer_name

    if not cust_name:
        return {"eligible": None, "last_order_date": None, "customer_name": None,
                "message": "unknown"}

    try:
        resp = await erp_get(
            "resource/Sales Invoice",
            params={
                "filters": json.dumps([
                    ["customer_name", "like", f"%{cust_name.split()[0]}%"],
                    ["posting_date", ">=", cutoff],
                    ["docstatus", "=", 1],
                ]),
                "fields": '["name","customer_name","posting_date"]',
                "order_by": "posting_date desc",
                "limit": 1,
            },
        )
        invoices = resp.get("data", [])
        if invoices:
            return {
                "eligible": True,
                "last_order_date": invoices[0]["posting_date"],
                "customer_name": invoices[0]["customer_name"],
                "message": "eligible",
            }
        else:
            return {
                "eligible": False,
                "last_order_date": None,
                "customer_name": cust_name,
                "message": "no_recent_order",
            }
    except Exception as e:
        logger.warning(f"Alteration eligibility check failed: {e}")
        return {"eligible": None, "last_order_date": None, "customer_name": cust_name,
                "message": "error"}


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
    Create an Appointment in ERPNext and a linked Google Calendar Event.
    Returns {appointment_name, event_name}.
    """
    from datetime import timedelta

    # Normalise slot_datetime to "YYYY-MM-DD HH:MM:SS"
    # Handles: "2026-06-24 14:00", "2026-06-24 14:00:00", "2026-06-24 2:00 PM", "2026-06-24 11:30 AM"
    _formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d %I:%M %p",
        "%Y-%m-%d %I:%M:%S %p",
    ]
    dt = None
    for fmt in _formats:
        try:
            dt = datetime.strptime(slot_datetime.strip(), fmt).replace(tzinfo=NYC)
            break
        except ValueError:
            continue
    if dt is None:
        raise ValueError(f"Invalid slot_datetime: {slot_datetime!r}")

    end_dt = dt + timedelta(minutes=APPT_DURATIONS.get(service_type, _DEFAULT_DURATION_MINS))
    slot_str = dt.strftime("%Y-%m-%d %H:%M:%S")
    end_str  = end_dt.strftime("%Y-%m-%d %H:%M:%S")

    # 1. Create the Appointment
    appt_doc = {
        "doctype": "Appointment",
        "scheduled_time": slot_str,
        "status": "Open",
        "customer_name": customer_name,
        "customer_phone_number": customer_phone,
        "customer_email": customer_email or "noemail@lstailors.com",
        "customer_details": f"Service: {service_type}." + (f" Notes: {notes}" if notes else ""),
        "appointment_with": "LSH Booking Agent",
        "party": agent_name,
    }
    appt_resp = await erp_post("resource/Appointment", appt_doc)
    appt_name = (appt_resp.get("data") or appt_resp).get("name", "")

    # 2. Create Google Calendar Event linked to the appointment
    agent_display = agent_name.split()[0] if agent_name else "our team"
    event_doc = {
        "doctype": "Event",
        "subject": f"L&S — {customer_name} — {service_type} with {agent_display}",
        "starts_on": slot_str,
        "ends_on": end_str,
        "event_type": "Private",
        "sync_with_google_calendar": 1,
        "google_calendar": "L&S Appointments",
        "description": (
            f"Customer: {customer_name}\n"
            f"Phone: {customer_phone}\n"
            f"Email: {customer_email}\n"
            f"Service: {service_type}\n"
            f"Tailor: {agent_name}\n"
            + (f"Notes: {notes}" if notes else "")
        ),
    }
    try:
        event_resp = await erp_post("resource/Event", event_doc)
        event_name = (event_resp.get("data") or event_resp).get("name", "")
        # Link event back to appointment
        if appt_name and event_name:
            await erp_put(f"resource/Appointment/{appt_name}", {"calendar_event": event_name})
    except Exception as e:
        logger.warning(f"Google Calendar event creation failed: {e}")
        event_name = ""

    logger.info(f"Appointment created: {appt_name} | Event: {event_name}")
    return {"appointment_name": appt_name, "event_name": event_name, "name": appt_name}


async def erp_ensure_customer(
    customer_name: str,
    phone: str,
    email: str = "",
) -> Optional[str]:
    """
    Look up or create an ERPNext Customer record for a new caller.
    Returns the Customer docname.
    """
    if not settings.ERPNEXT_URL or not customer_name or not phone:
        return None

    # Check if already exists
    existing = await find_customer_by_phone(phone)
    if existing:
        return existing

    try:
        resp = await erp_post("resource/Customer", {
            "doctype": "Customer",
            "customer_name": customer_name,
            "customer_type": "Individual",
            "customer_group": "Individual",
            "territory": "United States",
            "mobile_no": phone,
            "email_id": email or "",
        })
        name = (resp.get("data") or resp).get("name", "")
        logger.info(f"New Customer created: {name} ({phone})")
        return name
    except Exception as e:
        logger.warning(f"Could not create Customer for {customer_name}: {e}")
        return None


# ─── House app bridge ─────────────────────────────────────────────────────────

def _bridge_headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if settings.SOFIA_BRIDGE_KEY:
        headers["x-sofia-bridge-key"] = settings.SOFIA_BRIDGE_KEY
    return headers


async def get_house_app_context(phone: str) -> str:
    """
    Fetch unified customer context from the house app bridge.
    Returns a formatted text block to inject into the caller memory, or "" on failure.
    """
    if not settings.HOUSE_APP_URL or not phone:
        return ""
    try:
        url = f"{settings.HOUSE_APP_URL.rstrip('/')}/api/sofia-bridge/context"
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(url, headers=_bridge_headers(), params={"phone": phone})
        if resp.status_code != 200:
            logger.warning(f"House app context {resp.status_code} for {phone}")
            return ""
        data = resp.json().get("data", {})
        return data.get("context_block", "")
    except Exception as e:
        logger.warning(f"House app context fetch failed: {e}")
        return ""


async def get_house_app_summary() -> str:
    """
    Fetch the ops summary from the house app bridge (appointments, alterations, deliveries, SMS).
    Returns formatted text block or "" on failure.
    """
    if not settings.HOUSE_APP_URL:
        return ""
    try:
        url = f"{settings.HOUSE_APP_URL.rstrip('/')}/api/sofia-bridge/summary"
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, headers=_bridge_headers())
        if resp.status_code != 200:
            logger.warning(f"House app summary {resp.status_code}")
            return ""
        data = resp.json().get("data", {})
        return data.get("summary_text", "")
    except Exception as e:
        logger.warning(f"House app summary fetch failed: {e}")
        return ""


async def post_house_app_event(event_type: str, phone: str, customer_name: str = "", data: dict = None) -> None:
    """Fire-and-forget event to the house app so it stays in sync with voice actions."""
    if not settings.HOUSE_APP_URL:
        return
    try:
        url = f"{settings.HOUSE_APP_URL.rstrip('/')}/api/sofia-bridge/event"
        payload = {"event_type": event_type, "phone": phone, "customer_name": customer_name, "data": data or {}}
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(url, headers=_bridge_headers(), json=payload)
    except Exception as e:
        logger.debug(f"House app event post failed (non-critical): {e}")


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
