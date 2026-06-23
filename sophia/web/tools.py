"""
Sophia Tool Implementations — wired to ERPNext + Twilio.
Each function maps to a tool defined in web/config/tools.json.
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Any

import httpx
from twilio.rest import Client as TwilioClient

from web.config import settings
from web.erp_integration import (
    check_alteration_eligibility,
    erp_create_appointment,
    erp_ensure_customer,
    erp_get,
    erp_get_available_slots,
    erp_list_agents,
    erp_method,
    erp_post,
    erp_put,
    create_communication_log,
    find_customer_by_phone,
    NYC,
)

logger = logging.getLogger("sophia.tools")

TOOL_REGISTRY: dict[str, Any] = {}


def prep_note(service_type: str) -> str:
    """A friendly 'what to bring' line tailored to the appointment type.
    Used in both the booking confirmation and the day-before reminder."""
    s = (service_type or "").lower()
    if "fitting" in s:
        return ("Please bring the shoes you plan to wear with this garment so we can "
                "perfect the length — and any shirt or accessories you'd like to pair.")
    if "alteration" in s:
        return ("Please bring the garment(s) for your appointment, along with the shoes "
                "you'll wear with them.")
    if "pickup" in s:
        return "Just bring yourself — your garment will be ready and pressed."
    # Initial Consultation / Bespoke / Made-to-Measure / default
    return ("Feel free to bring any inspiration photos or a garment whose fit you love. "
            "If you have the dress shoes you'd wear with the suit, bring them so we can set "
            "the trouser break — but no need if not.")


def tool(name: str):
    def decorator(fn):
        TOOL_REGISTRY[name] = fn
        return fn
    return decorator


async def execute_tool(
    tool_name: str,
    args: dict,
    caller: str = "",
    mode: str = "customer",
    log_collector: list = None,  # pass a list to accumulate tool_call dicts for the comm log
) -> dict:
    fn = TOOL_REGISTRY.get(tool_name)
    if not fn:
        logger.warning(f"Unknown tool: {tool_name}")
        return {"error": f"Tool '{tool_name}' is not available."}

    ts = datetime.now(NYC).strftime("%Y-%m-%d %H:%M:%S")
    try:
        result = await fn(**args, _caller=caller, _mode=mode)
        if log_collector is not None:
            log_collector.append({
                "tool_name": tool_name,
                "input_params": args,
                "output_result": result,
                "timestamp": ts,
            })
        return result
    except Exception as e:
        logger.exception(f"Tool error [{tool_name}]: {e}")
        err = {"error": f"Problem running {tool_name} — logged for staff review."}
        if log_collector is not None:
            log_collector.append({
                "tool_name": tool_name,
                "input_params": args,
                "output_result": err,
                "timestamp": ts,
            })
        return err


# ─── Booking tools ────────────────────────────────────────────────────────────

@tool("list_agents")
async def list_agents(_caller: str = "", _mode: str = "customer") -> dict:
    """Return the active booking agents so Sophia can ask for a preference."""
    agents = await erp_list_agents()
    names = [a.get("display_name") or a.get("name") for a in agents]
    return {"agents": names}


@tool("get_available_slots")
async def get_available_slots(
    date_from: str,
    date_to: str,
    service_type: str = "Initial Consultation",
    agent_name: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """Fetch open appointment slots for a given service type and date range."""
    slots = await erp_get_available_slots(date_from, date_to, agent_name or None, service_type)
    if not slots:
        return {
            "message": "I don't see any open slots in that range. Would you like to try a different week, or would you prefer to leave your number and have us call you back?",
            "slots": [],
        }
    formatted = []
    for s in slots[:10]:
        formatted.append({
            "display": s.get("slot_datetime_display", s["slot_datetime"]),
            "slot_datetime": s["slot_datetime"],
            "duration_minutes": s["duration_minutes"],
        })
    return {"slots": formatted}


@tool("check_alteration_eligibility")
async def check_alteration_eligibility_tool(
    customer_name: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """
    Check if this caller is eligible for alteration services.
    Policy: customer must have placed an order with L&S in the past 12 months.
    Call this before offering alteration appointments.
    """
    result = await check_alteration_eligibility(_caller, customer_name)
    msg = result.get("message")
    if msg == "eligible":
        return {
            "eligible": True,
            "last_order_date": result["last_order_date"],
            "message": f"Eligible — last order on {result['last_order_date']}.",
        }
    elif msg == "no_recent_order":
        return {
            "eligible": False,
            "last_order_date": None,
            "message": (
                "This customer has no order with L&S in the past 12 months. "
                "Per our policy as of July 1, 2026, alteration services are reserved for "
                "active custom clients. Sofia should politely let them know and offer "
                "an Initial Consultation instead."
            ),
        }
    else:
        # unknown or error — let staff decide, don't block
        return {
            "eligible": None,
            "message": "Could not verify order history — please confirm with the team.",
        }


@tool("book_appointment")
async def book_appointment(
    customer_name: str,
    slot_datetime: str,
    customer_phone: str = "",
    preferred_agent: str = "",
    customer_email: str = "",
    service_type: str = "Consultation",
    notes: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """Book the appointment in ERPNext, create Customer if new, send SMS confirmation."""
    from datetime import datetime as dt
    phone = customer_phone or _caller

    try:
        result = await erp_create_appointment(
            customer_name=customer_name,
            customer_email=customer_email,
            customer_phone=phone,
            agent_name=preferred_agent,
            slot_datetime=slot_datetime,
            service_type=service_type,
            notes=notes,
        )
        appt_name = result.get("appointment_name") or result.get("name", "")

        # ── Build display strings (always succeeds) ───────────────────────────
        from datetime import timezone
        from urllib.parse import quote
        cal_link = ""
        appt_display = slot_datetime
        tailor = preferred_agent.split()[0] if preferred_agent else "one of our master tailors"
        try:
            appt_dt = dt.strptime(slot_datetime[:16], "%Y-%m-%d %H:%M").replace(tzinfo=NYC)
            appt_display = appt_dt.strftime("%A, %B %-d at %-I:%M %p")
            start_utc = appt_dt.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            event_title = quote(f"{service_type} — L&S Custom Tailors")
            cal_link = (
                f"{settings.BASE_URL.rstrip('/')}/cal"
                f"?title={event_title}&start={start_utc}&minutes=70"
            )
        except Exception:
            pass

        # ── Success response — built before any secondary operations ──────────
        success_response = {
            "booked": True,
            "appointment": appt_name,
            "message": (
                f"You are all set, {customer_name}. Your {service_type} is confirmed for "
                f"{appt_display} with {tailor}. I've sent a confirmation to your phone. "
                f"We look forward to seeing you at 138 East 61st Street, Suite 201."
            ),
        }

        # ── Secondary operations — none of these can affect the return value ──
        try:
            await erp_ensure_customer(customer_name, phone, customer_email)
        except Exception as e:
            logger.warning(f"erp_ensure_customer failed: {e}")

        # SMS confirmation (only for real phone numbers, not email addresses)
        if phone and phone != "unknown" and "@" not in phone:
            try:
                twilio_client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
                sms_body = (
                    f"L&S Custom Tailors — your {service_type} is confirmed for "
                    f"{appt_display} with {tailor}. "
                    f"We're at 138 E 61st St, Suite 201, New York. "
                    + prep_note(service_type)
                    + f"\nQuestions? Reply or call (212) 752-1638."
                )
                twilio_client.messages.create(
                    body=sms_body,
                    from_=settings.TWILIO_PHONE_NUMBER,
                    to=phone,
                )
                await create_communication_log(
                    communication_type="SMS",
                    direction="Outbound",
                    caller_phone=phone,
                    content=sms_body,
                    mode="system",
                    appointment_name=appt_name,
                )
                # Second message: calendar link on its own so iOS/Android renders it as a tap
                if cal_link:
                    import asyncio as _aio
                    await _aio.sleep(1.5)
                    twilio_client.messages.create(
                        body=f"📅 Add to calendar: {cal_link}",
                        from_=settings.TWILIO_PHONE_NUMBER,
                        to=phone,
                    )
                logger.info(f"Booking confirmation SMS sent to {phone}")
            except Exception as sms_err:
                logger.warning(f"SMS confirmation failed: {sms_err}")

        # Email confirmation
        if customer_email:
            try:
                email_body = (
                    f"Dear {customer_name},<br><br>"
                    f"Your <strong>{service_type}</strong> at L&S Custom Tailors is confirmed.<br><br>"
                    f"<strong>Date &amp; Time:</strong> {appt_display}<br>"
                    f"<strong>Location:</strong> 138 East 61st Street, Suite 201, New York, NY 10065<br>"
                    f"<strong>Tailor:</strong> {tailor}<br><br>"
                    + (f'<a href="{cal_link}" style="display:inline-block;padding:10px 18px;'
                       f'background:#1a1a1a;color:#fff;text-decoration:none;border-radius:4px;">'
                       f'Add to calendar</a><br><br>' if cal_link else "")
                    + f"{prep_note(service_type)}<br><br>"
                    + f"Please arrive 5 minutes early. If you need to reschedule, reply to this email "
                    f"or call us at (212) 752-1638.<br><br>"
                    f"We look forward to seeing you.<br><br>"
                    f"Warmly,<br>"
                    f"Sofia — L&S Custom Tailors"
                )
                await erp_post("resource/Communication", {
                    "doctype": "Communication",
                    "communication_type": "Communication",
                    "communication_medium": "Email",
                    "sent_or_received": "Sent",
                    "subject": f"Appointment Confirmed — {appt_display} — L&S Custom Tailors",
                    "content": email_body,
                    "sender": "concierge@lstailors.com",
                    "sender_full_name": "Sofia — L&S Custom Tailors",
                    "recipients": customer_email,
                    "reference_doctype": "Appointment",
                    "reference_name": appt_name,
                    "status": "Linked",
                })
                logger.info(f"Booking confirmation email sent to {customer_email}")
            except Exception as email_err:
                logger.warning(f"Email confirmation failed: {email_err}")

        # Communication log
        try:
            await create_communication_log(
                communication_type="Call",
                direction="Inbound",
                caller_phone=phone,
                content=f"Appointment booked: {service_type} on {appt_display} with {tailor}",
                mode=_mode,
                appointment_name=appt_name,
            )
        except Exception as e:
            logger.warning(f"Communication log failed: {e}")

        return success_response
    except httpx.HTTPStatusError as e:
        logger.error(f"book_appointment ERPNext error: {e.response.status_code} {e.response.text[:300]}")
        return {
            "booked": False,
            "message": "I wasn't able to confirm that slot — it may have just been taken. Let me find you the next available time, or I can have our team call you back to confirm.",
        }
    except Exception as e:
        logger.error(f"book_appointment error: {e}")
        return {"booked": False, "message": "I had a problem completing that booking. Our team will follow up with you shortly."}


# ─── Order & appointment lookup ───────────────────────────────────────────────

@tool("check_order_status")
async def check_order_status(
    order_number: str = "",
    customer_phone: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    if not settings.ERPNEXT_URL:
        return {"error": "Order lookup is not available right now. Please call the store directly."}
    try:
        filters = []
        if order_number:
            filters.append(["name", "=", order_number])
        else:
            phone = customer_phone or _caller
            customer = await find_customer_by_phone(phone)
            if not customer:
                return {"message": "I couldn't find an account with that phone number. Do you have your order number?"}
            filters.append(["customer", "=", customer])

        resp = await erp_get(
            "resource/Sales Order",
            params={
                "filters": json.dumps(filters),
                "fields": '["name","status","delivery_date","custom_tailor","custom_notes","grand_total","customer_name"]',
                "limit": 5,
                "order_by": "creation desc",
            },
        )
        orders = resp.get("data", [])
        if not orders:
            return {"message": "I don't see any orders matching that information. Could you double-check your order number?"}
        o = orders[0]
        return {
            "order_number": o.get("name"),
            "customer": o.get("customer_name"),
            "status": o.get("status"),
            "ready_date": o.get("delivery_date"),
            "tailor": o.get("custom_tailor", "being assigned"),
            "notes": o.get("custom_notes", ""),
            "total": o.get("grand_total"),
        }
    except httpx.HTTPError as e:
        logger.error(f"check_order_status: {e}")
        return {"error": "I'm having trouble reaching our order system. Please call the store or try again shortly."}


@tool("check_appointment")
async def check_appointment(
    customer_phone: str = "",
    customer_name: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    if not settings.ERPNEXT_URL:
        return {"message": "Please call us at the store to check your appointment."}
    try:
        phone = customer_phone or _caller
        resp = await erp_get(
            "resource/Appointment",
            params={
                "filters": json.dumps([["customer_phone_number", "like", f"%{phone[-10:]}%"]]),
                "fields": '["name","scheduled_time","status","appointment_type","customer_name"]',
                "order_by": "scheduled_time asc",
                "limit": 3,
            },
        )
        appts = resp.get("data", [])
        if not appts:
            return {"message": "I don't see any upcoming appointments. Would you like to schedule one?"}
        return {"appointments": appts}
    except Exception as e:
        logger.error(f"check_appointment: {e}")
        return {"error": "I couldn't access our scheduling system right now."}


# ─── Store info & general ─────────────────────────────────────────────────────

@tool("get_store_info")
async def get_store_info(
    topic: str = "hours",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    from datetime import datetime as dt
    now = dt.now(NYC)
    month = now.month

    if month in (7, 8):
        # Summer schedule
        hours_text = (
            "Our summer hours, for July and August, are Monday through Friday, "
            "9 AM to 5 PM, and we're closed on weekends. "
            "We also close for our annual vacation the first two weeks of August. "
            "Everything is by appointment."
        )
    else:
        # Regular season
        hours_text = (
            "We're open by appointment Tuesday through Friday, 9 AM to 5 PM, "
            "and Saturday, 9 AM to 3 PM. We're closed Sundays and Mondays."
        )

    info = {
        "hours": hours_text,
        "location": (
            "138 East 61st Street, Suite 201, New York, NY 10065 — "
            "between Park and Lexington Avenues on the Upper East Side. "
            "Nearest subway: 4/5/6 at 59th Street or N/R/W at Lexington/60th."
        ),
        "phone": (
            "Main shop: (212) 752-1638. Text concierge: (212) 308-4431."
        ),
        "services": (
            "Bespoke suits from $3,695 — live drape construction, pattern stored permanently in our archives, "
            "100% hand-finished, 2 to 3 fittings. "
            "Made-to-Measure from $2,695 — fully canvassed, one fitting, ready in 4 to 6 weeks. "
            "Made-to-Order from $1,295. "
            "Custom shirts from $349, monogramming included. "
            "Alterations for existing custom clients and their immediate family only."
        ),
        "pricing": (
            "Bespoke from $3,695. Made-to-Measure from $2,695. Made-to-Order from $1,295. "
            "Custom shirts from $349. Full details at lstailors.com."
        ),
        "fabrics": (
            "We carry Loro Piana from Italy, Scabal from Belgium, Holland and Sherry from England, "
            "and Vitale Barberis Canonico from Italy. Range spans Super 100s to Super 180s. "
            "The only way to truly experience the cloth is to feel it in person — "
            "I would love to book you a fabric consultation."
        ),
        "team": (
            "Our four master tailors are Calogero Cristiano — co-owner and second generation — "
            "Salvatore Cristiano who founded the house in 1974, Kelvin, and Christopher Korey. "
            "All four handle the full range of our services."
        ),
        "alterations": (
            "Alterations are available exclusively for existing custom clients and their immediate family — "
            "up to five family members. We do not take outside alteration work. "
            "We have made a deliberate shift to focus entirely on our custom clients. "
            "I would be happy to tell you about what a custom consultation looks like."
        ),
        "about": (
            "L&S Custom Tailors has been dressing New York's finest since 1974. "
            "Founded by master tailor Salvatore Cristiano, now led by his son Calogero. "
            "Over fifty years at the same address on the Upper East Side, same uncompromising standards. "
            "An initial consultation is approximately 70 minutes. "
            "Full details at lstailors.com."
        ),
    }
    topic_lower = topic.lower()
    for key, value in info.items():
        if key in topic_lower or topic_lower in key:
            return {"topic": key, "information": value}
    return {"topic": "general", "information": info["about"]}


@tool("check_fabric_availability")
async def check_fabric_availability(
    fabric_name: str = "",
    color: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    return {
        "message": (
            f"For '{fabric_name or 'that fabric'}', I'd love to have one of our consultants "
            f"walk you through the selection in person — we carry over 4,000 cloths from the world's finest mills. "
            f"Can I help you schedule a fabric consultation?"
        ),
        "suggest_appointment": True,
    }


@tool("check_square_payment")
async def check_square_payment(
    order_number: str = "",
    customer_name: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    if not settings.SQUARE_ACCESS_TOKEN:
        return {"error": "Payment lookup is not configured."}
    try:
        env_url = (
            "https://connect.squareup.com"
            if settings.SQUARE_ENVIRONMENT == "production"
            else "https://connect.squareupsandbox.com"
        )
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{env_url}/v2/payments",
                headers={"Authorization": f"Bearer {settings.SQUARE_ACCESS_TOKEN}"},
                params={"reference_id": order_number, "limit": 5},
            )
        data = resp.json()
        payments = data.get("payments", [])
        if not payments:
            return {"message": f"No payment records found for order {order_number}."}
        p = payments[0]
        return {
            "status": p.get("status"),
            "amount": (p.get("amount_money", {}).get("amount", 0) or 0) / 100,
            "currency": p.get("amount_money", {}).get("currency", "USD"),
            "created_at": p.get("created_at"),
        }
    except Exception as e:
        logger.error(f"Square lookup failed: {e}")
        return {"error": "Payment information is temporarily unavailable."}


@tool("forward_call")
async def forward_call(
    reason: str = "customer requested to speak with staff",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    logger.info(f"Call forward requested from {_caller}: {reason}")
    return {
        "forwarding": True,
        "message": "I'm connecting you to one of our tailors right now — please hold just one moment.",
        "forward_to": settings.FORWARD_TO_NUMBER,
    }


# ─── Staff assistant query tools (internal mode) ──────────────────────────────

async def _appointments_for_date(date_str: str) -> list[dict]:
    """Open appointments on a given YYYY-MM-DD, ordered by time."""
    resp = await erp_get(
        "resource/Appointment",
        params={
            "filters": json.dumps([
                ["scheduled_time", ">=", f"{date_str} 00:00:00"],
                ["scheduled_time", "<=", f"{date_str} 23:59:59"],
                ["status", "=", "Open"],
            ]),
            "fields": '["name","scheduled_time","customer_name","customer_phone_number","customer_details","party"]',
            "order_by": "scheduled_time asc",
            "limit": 100,
        },
    )
    return resp.get("data", [])


@tool("staff_daily_schedule")
async def staff_daily_schedule(
    date: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """List appointments for a given day (default today). Internal staff only."""
    if _mode != "internal":
        return {"error": "Staff only."}
    from datetime import datetime as dt
    target = date.strip() or dt.now(NYC).strftime("%Y-%m-%d")
    try:
        appts = await _appointments_for_date(target)
    except Exception as e:
        logger.error(f"staff_daily_schedule: {e}")
        return {"error": "Couldn't reach the schedule."}
    items = []
    for a in appts:
        try:
            t = dt.strptime(a.get("scheduled_time", "")[:16], "%Y-%m-%d %H:%M").strftime("%-I:%M %p")
        except Exception:
            t = a.get("scheduled_time", "")
        items.append({
            "time": t,
            "customer": a.get("customer_name", ""),
            "phone": a.get("customer_phone_number", ""),
            "tailor": (a.get("party") or "").split()[0] if a.get("party") else "",
        })
    return {"date": target, "count": len(items), "appointments": items}


@tool("staff_overdue_orders")
async def staff_overdue_orders(
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """Sales Orders past their delivery date and not yet completed. Internal staff only."""
    if _mode != "internal":
        return {"error": "Staff only."}
    from datetime import datetime as dt
    today = dt.now(NYC).strftime("%Y-%m-%d")
    try:
        resp = await erp_get(
            "resource/Sales Order",
            params={
                "filters": json.dumps([
                    ["delivery_date", "<", today],
                    ["status", "in", ["To Deliver and Bill", "To Deliver", "To Bill"]],
                    ["docstatus", "=", 1],
                ]),
                "fields": '["name","customer_name","delivery_date","status","grand_total"]',
                "order_by": "delivery_date asc",
                "limit": 50,
            },
        )
    except Exception as e:
        logger.error(f"staff_overdue_orders: {e}")
        return {"error": "Couldn't reach the order system."}
    orders = resp.get("data", [])
    return {"count": len(orders), "orders": [
        {"order": o.get("name"), "customer": o.get("customer_name"),
         "due": o.get("delivery_date"), "status": o.get("status")}
        for o in orders
    ]}


@tool("staff_ready_for_pickup")
async def staff_ready_for_pickup(
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """Deliveries currently marked Ready for Pickup. Internal staff only."""
    if _mode != "internal":
        return {"error": "Staff only."}
    try:
        resp = await erp_get(
            "resource/LSH Delivery",
            params={
                "filters": json.dumps([["lsh_status", "=", "Ready for Pickup"]]),
                "fields": '["name","customer_name","customer_phone","lsh_garment_summary"]',
                "limit": 50,
            },
        )
    except Exception as e:
        logger.error(f"staff_ready_for_pickup: {e}")
        return {"error": "Couldn't reach the delivery system."}
    rows = resp.get("data", [])
    return {"count": len(rows), "deliveries": [
        {"customer": r.get("customer_name"), "phone": r.get("customer_phone"),
         "garments": r.get("lsh_garment_summary", "")}
        for r in rows
    ]}


# ─── Internal staff tools ─────────────────────────────────────────────────────

@tool("send_internal_sms")
async def send_internal_sms(
    recipient_name: str,
    message: str,
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    if _mode != "internal":
        return {"error": "Internal messaging is only available to staff."}
    staff_dir = settings.staff_directory
    recipient_number = staff_dir.get(recipient_name)
    if not recipient_number:
        return {"error": f"No number found for {recipient_name}. Available: {', '.join(staff_dir.keys())}"}
    try:
        client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        msg = client.messages.create(
            body=f"[SOPHIA] From {_caller}:\n{message}",
            from_=settings.TWILIO_PHONE_NUMBER,
            to=recipient_number,
        )
        await create_communication_log(
            communication_type="SMS",
            direction="Outbound",
            caller_phone=recipient_number,
            content=message,
            mode="internal",
        )
        return {"sent": True, "to": recipient_name, "sid": msg.sid}
    except Exception as e:
        logger.error(f"send_internal_sms: {e}")
        return {"error": "Failed to send the message."}


@tool("send_customer_sms")
async def send_customer_sms(
    customer_phone: str,
    message: str,
    customer_name: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """Staff-only: send a free-form SMS to any customer phone number."""
    if _mode != "internal":
        return {"error": "Sending customer SMS is only available to staff."}
    if not customer_phone:
        return {"error": "customer_phone is required."}
    # Normalize to E.164
    digits = "".join(c for c in customer_phone if c.isdigit())
    if len(digits) == 10:
        to_number = f"+1{digits}"
    elif len(digits) == 11 and digits.startswith("1"):
        to_number = f"+{digits}"
    else:
        to_number = customer_phone
    try:
        client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        msg = client.messages.create(
            body=message,
            from_=settings.TWILIO_PHONE_NUMBER,
            to=to_number,
        )
        await create_communication_log(
            communication_type="SMS",
            direction="Outbound",
            caller_phone=to_number,
            content=message,
            mode="internal",
        )
        return {"sent": True, "to": to_number, "name": customer_name, "sid": msg.sid}
    except Exception as e:
        logger.error(f"send_customer_sms: {e}")
        return {"error": "Failed to send the SMS."}


@tool("create_follow_up")
async def create_follow_up(
    customer_name: str,
    note: str,
    customer_phone: str = "",
    due_date: str = "",
    assigned_to: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    phone = customer_phone or _caller
    content = (
        f"FOLLOW-UP: {customer_name} ({phone})\n"
        f"Note: {note}\nDue: {due_date or 'ASAP'}\nAssigned: {assigned_to or 'unassigned'}"
    )
    await create_communication_log(
        communication_type="Internal Note",
        direction="Inbound",
        caller_phone=_caller,
        content=content,
        mode="internal",
    )
    # Alert assigned staff
    if assigned_to:
        staff_dir = settings.staff_directory
        num = staff_dir.get(assigned_to)
        if num:
            try:
                client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
                client.messages.create(
                    body=f"📝 SOPHIA task:\n{content}",
                    from_=settings.TWILIO_PHONE_NUMBER,
                    to=num,
                )
            except Exception:
                pass
    return {"created": True, "message": f"Follow-up noted for {customer_name}."}


@tool("cancel_appointment")
async def cancel_appointment(
    appointment_name: str = "",
    customer_phone: str = "",
    reason: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """Cancel an existing appointment in ERPNext."""
    if not settings.ERPNEXT_URL:
        return {"error": "Scheduling system is not available right now."}
    # If no appointment name given, look it up by phone
    if not appointment_name:
        phone = customer_phone or _caller
        try:
            resp = await erp_get(
                "resource/Appointment",
                params={
                    "filters": json.dumps([
                        ["customer_phone_number", "like", f"%{phone[-10:]}%"],
                        ["status", "=", "Open"],
                    ]),
                    "fields": '["name","scheduled_time","customer_name","customer_details"]',
                    "order_by": "scheduled_time asc",
                    "limit": 1,
                },
            )
            appts = resp.get("data", [])
            if not appts:
                return {"cancelled": False, "message": "I don't see any upcoming appointments to cancel. Would you like to schedule a new one?"}
            appointment_name = appts[0]["name"]
        except Exception as e:
            logger.error(f"cancel_appointment lookup: {e}")
            return {"error": "I couldn't reach the scheduling system right now."}
    try:
        await erp_put(f"resource/Appointment/{appointment_name}", {
            "status": "Closed",
            "notes": f"Cancelled by client via Sofia. Reason: {reason or 'Not specified'}.",
        })
        await create_communication_log(
            communication_type="SMS" if _mode != "customer" else "Call",
            direction="Inbound",
            caller_phone=_caller,
            content=f"Appointment {appointment_name} cancelled. Reason: {reason or 'Not specified'}.",
            mode=_mode,
        )
        logger.info(f"Appointment {appointment_name} cancelled.")
        return {
            "cancelled": True,
            "appointment": appointment_name,
            "message": "Done — your appointment has been cancelled. We hope to see you again soon. Is there anything else I can help you with?",
        }
    except Exception as e:
        logger.error(f"cancel_appointment: {e}")
        return {"cancelled": False, "message": "I had trouble cancelling that appointment. Please call us at (212) 752-1638 and we'll sort it out right away."}


@tool("send_payment_link")
async def send_payment_link(
    order_number: str = "",
    customer_name: str = "",
    customer_phone: str = "",
    amount_cents: int = 0,
    note: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """Create a Square checkout payment link and text it to the customer. Staff only."""
    if _mode != "internal":
        return {"error": "Payment links can only be sent by staff."}
    if not settings.SQUARE_ACCESS_TOKEN:
        return {"error": "Square is not configured."}
    phone = customer_phone or _caller
    if not phone:
        return {"error": "A customer phone number is required to send a payment link."}
    try:
        import uuid
        env_url = (
            "https://connect.squareup.com"
            if settings.SQUARE_ENVIRONMENT == "production"
            else "https://connect.squareupsandbox.com"
        )
        payload: dict = {
            "idempotency_key": str(uuid.uuid4()),
            "quick_pay": {
                "name": note or (f"L&S Order {order_number}" if order_number else "L&S Custom Tailors"),
                "price_money": {
                    "amount": amount_cents,
                    "currency": "USD",
                },
                "location_id": settings.SQUARE_LOCATION_ID,
            },
        }
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{env_url}/v2/online-checkout/payment-links",
                headers={
                    "Authorization": f"Bearer {settings.SQUARE_ACCESS_TOKEN}",
                    "Content-Type": "application/json",
                    "Square-Version": "2024-01-18",
                },
                json=payload,
            )
        resp.raise_for_status()
        link_url = resp.json().get("payment_link", {}).get("url", "")
        if not link_url:
            return {"error": "Square returned no link URL."}

        # Text the link to the customer
        twilio_client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)
        amount_str = f"${amount_cents / 100:.2f}" if amount_cents else ""
        sms_body = (
            f"L&S Custom Tailors — {f'your balance for {order_number} is {amount_str}. ' if order_number else ''}"
            f"Secure payment link: {link_url}"
        )
        twilio_client.messages.create(
            body=sms_body,
            from_=settings.TWILIO_PHONE_NUMBER,
            to=phone,
        )
        await create_communication_log(
            communication_type="SMS",
            direction="Outbound",
            caller_phone=phone,
            content=sms_body,
            mode="internal",
        )
        logger.info(f"Payment link sent to {phone}: {link_url}")
        return {
            "sent": True,
            "link": link_url,
            "to": phone,
            "message": f"Payment link sent to {customer_name or phone}.",
        }
    except httpx.HTTPStatusError as e:
        logger.error(f"send_payment_link Square error: {e.response.status_code} {e.response.text[:200]}")
        return {"error": "Square couldn't create the link. Please try from the Square dashboard."}
    except Exception as e:
        logger.error(f"send_payment_link: {e}")
        return {"error": "Couldn't send the payment link right now."}


@tool("check_alteration_ticket")
async def check_alteration_ticket(
    customer_phone: str = "",
    ticket_name: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """Look up Alteration Ticket(s) by phone number or ticket name."""
    phone = customer_phone or _caller
    try:
        if ticket_name:
            resp = await erp_get(f"resource/Alteration Ticket/{ticket_name}")
            t = (resp.get("data") or resp)
            if not t or not t.get("name"):
                return {"message": "I couldn't find that ticket. Could you read me the number again?"}
            due = t.get("due_date", "")
            try:
                from datetime import datetime as dt
                due = dt.strptime(due, "%Y-%m-%d").strftime("%B %-d")
            except Exception:
                pass
            total = float(t.get("ticket_total") or 0)
            return {
                "ticket": t.get("name"),
                "status": t.get("workflow_state"),
                "due": due,
                "total": total,
                "payment_status": t.get("payment_status", ""),
                "message": (
                    f"Ticket {t.get('name')} is currently {t.get('workflow_state')}, "
                    f"ready by {due}. Total ${total:.2f} ({t.get('payment_status') or 'Unpaid'})."
                ),
            }
        elif phone:
            customer = await find_customer_by_phone(phone)
            if not customer:
                return {"message": "I couldn't find an account with that phone number. Do you have your ticket number?"}
            resp = await erp_get(
                "resource/Alteration Ticket",
                params={
                    "filters": json.dumps([["customer", "=", customer]]),
                    "fields": '["name","workflow_state","due_date","ticket_total","payment_status"]',
                    "order_by": "creation desc",
                    "limit": 5,
                },
            )
            tickets = resp.get("data", [])
            if not tickets:
                return {"message": "I don't see any alteration tickets on your account. Would you like to schedule an alteration appointment?"}
            lines = []
            for t in tickets:
                try:
                    from datetime import datetime as dt
                    due = dt.strptime(t.get("due_date", ""), "%Y-%m-%d").strftime("%b %-d")
                except Exception:
                    due = t.get("due_date", "")
                total = float(t.get("ticket_total") or 0)
                lines.append(f"{t['name']} (${total:.2f}, {t['workflow_state']}, {t.get('payment_status','Unpaid')}, due {due})")
            summary = (
                f"You have one ticket: {lines[0]}." if len(lines) == 1
                else f"You have {len(lines)} recent tickets: {'; '.join(lines)}."
            )
            return {"tickets": tickets, "message": summary + " Anything I can help with?"}
        else:
            return {"message": "Please provide your phone number or ticket number."}
    except Exception as e:
        logger.error(f"check_alteration_ticket: {e}")
        return {"error": "I couldn't reach our ticket system right now. Please call the store or try again shortly."}


@tool("create_todo")
async def create_todo(
    title: str,
    description: str = "",
    priority: str = "Medium",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    """Create a todo/task in ERPNext assigned to the team. Internal staff only."""
    if _mode != "internal":
        return {"error": "Todo creation is for staff only."}
    if not settings.ERPNEXT_URL:
        return {"error": "ERPNext is not configured."}
    try:
        resp = await erp_post("resource/ToDo", {
            "doctype": "ToDo",
            "description": title + (f"\n\n{description}" if description else ""),
            "priority": priority,
            "allocated_to": "carl@lstailors.com",
            "custom_lsh_agent": "Sofia",
        })
        name = (resp.get("data") or resp).get("name", "")
        logger.info(f"Todo created: {name} — {title}")
        return {"created": True, "todo": name, "message": f"Done — I've created a task: \"{title}\"."}
    except Exception as e:
        logger.error(f"create_todo: {e}")
        return {"error": "I wasn't able to create that task. Please add it manually in ERPNext."}


@tool("update_order_notes")
async def update_order_notes(
    order_number: str,
    notes: str,
    new_status: str = "",
    _caller: str = "",
    _mode: str = "customer",
) -> dict:
    if _mode != "internal":
        return {"error": "Order updates are restricted to internal staff."}
    if not settings.ERPNEXT_URL:
        return {"error": "ERPNext is not configured."}
    try:
        data = {"custom_notes": notes}
        if new_status:
            data["custom_status"] = new_status
        await erp_put(f"resource/Sales Order/{order_number}", data)
        return {"updated": True, "order": order_number}
    except Exception as e:
        logger.error(f"update_order_notes: {e}")
        return {"error": f"Could not update order {order_number}."}
