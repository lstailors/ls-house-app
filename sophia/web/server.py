"""
Sophia — AI Voice & SMS Agent for L&S Custom Tailors
FastAPI server. All state goes to ERPNext — no local database.

Handles:
  - Twilio voice calls via Media Streams → xAI Grok Realtime WebSocket
  - Twilio SMS webhooks → Grok text completion → reply
  - Post-call: fetch Twilio transcript and store in LSH Communication Log
  - xAI ephemeral token for browser voice path
"""

import asyncio
import json
import logging
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import httpx
import websockets
from fastapi import FastAPI, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from twilio.rest import Client as TwilioClient
from twilio.twiml.messaging_response import MessagingResponse
from twilio.twiml.voice_response import Connect, VoiceResponse

from web.config import settings
from web.erp_integration import (
    create_communication_log,
    erp_get,
    get_caller_context,
    get_house_app_summary,
    get_sms_history,
    send_whatsapp_via_erpnext,
    post_raven_message,
    update_communication_log,
    NYC,
)
from web.tools import (
    execute_tool,
    TOOL_REGISTRY,
    prep_note,
    staff_daily_schedule,
    staff_overdue_orders,
    staff_ready_for_pickup,
)

logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("sophia")

CONFIG_DIR = Path(__file__).parent / "config"


def load_system_prompt(mode: str = "customer") -> str:
    """Hot-reloadable — reads from disk on every call."""
    path = CONFIG_DIR / f"system_prompt_{mode}.txt"
    if not path.exists():
        path = CONFIG_DIR / "system_prompt_customer.txt"
    return path.read_text(encoding="utf-8")


def load_tools() -> list[dict]:
    """Hot-reloadable tool definitions. Respects ENABLED_TOOLS env var."""
    path = CONFIG_DIR / "tools.json"
    tools = json.loads(path.read_text(encoding="utf-8"))
    enabled = settings.enabled_tools
    if enabled:
        tools = [t for t in tools if t.get("function", {}).get("name") in enabled]
    return tools


async def build_session_prompt(mode: str, caller_phone: str) -> str:
    """
    Load the base prompt and prepend full caller memory:
    identity, appointment history, and complete interaction log.
    Staff callers skip customer memory — they get the base internal prompt.
    """
    base = load_system_prompt(mode)
    if mode == "internal":
        return base

    ctx = await get_caller_context(caller_phone)
    memory = ctx.get("memory_block", "")

    if memory:
        return (
            "## CALLER MEMORY (loaded from ERPNext — use this to personalize the conversation)\n\n"
            + memory
            + "\n\n---\n\n"
            + base
        )
    return base


def is_staff_caller(phone: str) -> bool:
    staff = [n.strip() for n in settings.STAFF_PHONE_NUMBERS.split(",") if n.strip()]
    return phone in staff


def check_bridge_key(request: Request) -> bool:
    """
    Shared-secret gate for ERPNext-fed webhooks (e.g. the WhatsApp bridge). The
    Frappe Webhook is configured to send `X-Sofia-Bridge-Key: <SOFIA_BRIDGE_KEY>`.
    Open when SOFIA_BRIDGE_KEY is unset (dev).
    """
    expected = settings.SOFIA_BRIDGE_KEY
    if not expected:
        return True
    return request.headers.get("x-sofia-bridge-key", "") == expected


async def check_voice_endpoint() -> None:
    """
    On startup, mint a throwaway xAI Realtime session token to confirm the
    API key has the Voice endpoint enabled. Voice failures are otherwise
    silent (the call connects but no audio plays), so surface it loudly here.
    """
    if not settings.XAI_API_KEY:
        logger.error("❌ VOICE: XAI_API_KEY is not set — voice calls will be silent.")
        return
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.x.ai/v1/realtime/client_secrets",
                headers={"Authorization": f"Bearer {settings.XAI_API_KEY}"},
                json={"expires_after": {"seconds": 60}},
            )
        if resp.status_code == 200:
            logger.info("✅ VOICE: xAI Grok Realtime endpoint OK — key accepted, voice is live.")
        elif resp.status_code in (401, 403):
            logger.error(
                "❌ VOICE: xAI rejected the key (HTTP %s). The Voice endpoint is likely "
                "NOT enabled for this API key. Enable it at console.x.ai → API Keys. "
                "Response: %s",
                resp.status_code, resp.text[:300],
            )
        else:
            logger.error(
                "❌ VOICE: unexpected response from xAI Realtime (HTTP %s): %s",
                resp.status_code, resp.text[:300],
            )
    except Exception as e:
        logger.error("❌ VOICE: could not reach xAI Realtime endpoint: %s", e)


def _parse_service(customer_details: str) -> str:
    """Pull the service type out of an Appointment's customer_details string,
    which is stored as 'Service: <type>. Notes: ...'."""
    if not customer_details or "Service:" not in customer_details:
        return "appointment"
    after = customer_details.split("Service:", 1)[1].strip()
    return after.split(".")[0].strip() or "appointment"


async def send_day_before_reminders() -> None:
    """Text every customer with an Open appointment scheduled for tomorrow."""
    if not settings.ERPNEXT_URL:
        return
    tomorrow = (datetime.now(NYC) + timedelta(days=1)).strftime("%Y-%m-%d")
    try:
        resp = await erp_get(
            "resource/Appointment",
            params={
                "filters": json.dumps([
                    ["scheduled_time", ">=", f"{tomorrow} 00:00:00"],
                    ["scheduled_time", "<=", f"{tomorrow} 23:59:59"],
                    ["status", "=", "Open"],
                ]),
                "fields": '["name","scheduled_time","customer_name","customer_phone_number","customer_details","party"]',
                "limit": 200,
            },
        )
    except Exception as e:
        logger.error(f"Reminder query failed: {e}")
        return

    appts = resp.get("data", [])
    logger.info(f"Day-before reminders: {len(appts)} appointment(s) for {tomorrow}")

    for a in appts:
        phone = a.get("customer_phone_number", "")
        if not phone or phone == "unknown":
            continue
        try:
            sched = a.get("scheduled_time", "")
            appt_dt = datetime.strptime(sched[:16], "%Y-%m-%d %H:%M").replace(tzinfo=NYC)
            when = appt_dt.strftime("%A, %B %-d at %-I:%M %p")
        except Exception:
            when = a.get("scheduled_time", "")
        service = _parse_service(a.get("customer_details", ""))
        tailor = (a.get("party") or "").split()[0] if a.get("party") else "our team"
        first_name = (a.get("customer_name") or "").split()[0]

        body = (
            f"Hi{' ' + first_name if first_name else ''}, a reminder from L&S Custom Tailors — "
            f"your {service} is tomorrow, {when}, with {tailor} at 138 E 61st St, Suite 201. "
            f"{prep_note(service)} "
            f"Need to reschedule? Reply here or call (212) 752-1638. See you then!"
        )
        try:
            twilio_client.messages.create(
                body=body, from_=settings.TWILIO_PHONE_NUMBER, to=phone,
            )
            await create_communication_log(
                communication_type="SMS",
                direction="Outbound",
                caller_phone=phone,
                content=body,
                mode="system",
                appointment_name=a.get("name", ""),
            )
            logger.info(f"Reminder sent to {phone} for {a.get('name')}")
        except Exception as e:
            logger.warning(f"Reminder SMS failed for {phone}: {e}")


async def reminder_scheduler() -> None:
    """Fire send_day_before_reminders once daily at 10:00 AM NYC."""
    while True:
        now = datetime.now(NYC)
        target = now.replace(hour=10, minute=0, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        sleep_secs = (target - now).total_seconds()
        logger.info(f"Next appointment reminders at {target:%Y-%m-%d %H:%M %Z} ({sleep_secs/3600:.1f}h)")
        await asyncio.sleep(sleep_secs)
        try:
            await send_day_before_reminders()
        except Exception as e:
            logger.error(f"Reminder run errored: {e}")


def _staff_numbers() -> list[str]:
    return [n.strip() for n in settings.STAFF_PHONE_NUMBERS.split(",") if n.strip()]


async def compose_ops_briefing(when: str = "morning") -> str:
    """Build the staff ops briefing text from live ERPNext data."""
    today = datetime.now(NYC)
    date_label = today.strftime("%A, %B %-d")

    sched = await staff_daily_schedule(_mode="internal")
    ready = await staff_ready_for_pickup(_mode="internal")
    overdue = await staff_overdue_orders(_mode="internal")

    appts = sched.get("appointments", []) if isinstance(sched, dict) else []
    header = "☀️ L&S morning briefing" if when == "morning" else "🕐 L&S midday check-in"
    lines = [f"{header} — {date_label}", ""]

    if appts:
        lines.append(f"Appointments today ({len(appts)}):")
        for a in appts:
            who = a.get("customer", "")
            tailor = f" — {a['tailor']}" if a.get("tailor") else ""
            lines.append(f" • {a.get('time','')} — {who}{tailor}")
    else:
        lines.append("No appointments scheduled today.")

    ready_list = ready.get("deliveries", []) if isinstance(ready, dict) else []
    if ready_list:
        names = ", ".join(d.get("customer", "") for d in ready_list[:8])
        lines.append("")
        lines.append(f"Ready for pickup ({len(ready_list)}): {names}")

    overdue_list = overdue.get("orders", []) if isinstance(overdue, dict) else []
    if overdue_list:
        lines.append("")
        lines.append(f"⚠️ Overdue orders ({len(overdue_list)}):")
        for o in overdue_list[:8]:
            lines.append(f" • {o.get('order','')} — {o.get('customer','')} (due {o.get('due','')})")

    # House app ops summary (Supabase appointments, Geelus alterations, deliveries, unanswered SMS)
    house_summary = await get_house_app_summary()
    if house_summary:
        lines.append("")
        lines.append(house_summary)

    lines.append("")
    lines.append("Reply here to ask me anything — schedules, orders, or to send a customer a note.")
    return "\n".join(lines)


async def send_ops_briefing(when: str = "morning") -> None:
    """Text the ops briefing to every staff number."""
    numbers = _staff_numbers()
    if not numbers:
        logger.warning("Ops briefing: no STAFF_PHONE_NUMBERS configured.")
        return
    try:
        body = await compose_ops_briefing(when)
    except Exception as e:
        logger.error(f"compose_ops_briefing failed: {e}")
        return
    for num in numbers:
        try:
            twilio_client.messages.create(
                body=body, from_=settings.TWILIO_PHONE_NUMBER, to=num,
            )
            logger.info(f"{when} briefing sent to {num}")
        except Exception as e:
            logger.warning(f"Briefing SMS failed for {num}: {e}")


async def briefing_scheduler() -> None:
    """Send a morning briefing at 7:30 AM and a midday check-in at 1:00 PM NYC."""
    SLOTS = [(7, 30, "morning"), (13, 0, "midday")]
    while True:
        now = datetime.now(NYC)
        # Find the next upcoming slot today or tomorrow
        candidates = []
        for h, m, label in SLOTS:
            t = now.replace(hour=h, minute=m, second=0, microsecond=0)
            if t <= now:
                t += timedelta(days=1)
            candidates.append((t, label))
        target, label = min(candidates, key=lambda x: x[0])
        sleep_secs = (target - now).total_seconds()
        logger.info(f"Next staff briefing ({label}) at {target:%Y-%m-%d %H:%M %Z} ({sleep_secs/3600:.1f}h)")
        await asyncio.sleep(sleep_secs)
        try:
            await send_ops_briefing(label)
        except Exception as e:
            logger.error(f"Briefing run errored: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Sophia is online. ERPNext: %s", settings.ERPNEXT_URL or "not configured")
    await check_voice_endpoint()
    reminder_task = asyncio.create_task(reminder_scheduler())
    briefing_task = asyncio.create_task(briefing_scheduler())
    yield
    reminder_task.cancel()
    briefing_task.cancel()
    logger.info("Sophia shutting down.")


app = FastAPI(title="Sophia Agent", lifespan=lifespan)
twilio_client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "agent": "sophia", "erp": bool(settings.ERPNEXT_URL)}


@app.post("/api/briefing")
async def trigger_briefing(request: Request):
    """Compose the ops briefing now. ?send=1 also texts it to all staff."""
    when = request.query_params.get("when", "morning")
    text = await compose_ops_briefing(when)
    if request.query_params.get("send") == "1":
        await send_ops_briefing(when)
    return {"briefing": text}


# ─── Smart calendar redirect ──────────────────────────────────────────────────
# /cal?start=...&title=...&minutes=...
# iOS (Apple Calendar) → serves .ics directly → "Add to Calendar" dialog
# Android / everything else → redirects to Google Calendar one-tap URL

@app.get("/cal")
async def calendar_smart_redirect(
    request: Request,
    title: str = "Appointment — L&S Custom Tailors",
    start: str = "",
    minutes: int = 70,
    location: str = "138 East 61st Street, Suite 201, New York, NY 10065",
):
    from urllib.parse import quote
    from datetime import timezone as _tz
    from fastapi.responses import RedirectResponse

    ua = request.headers.get("user-agent", "").lower()
    is_apple = any(k in ua for k in ("iphone", "ipad", "macintosh", "darwin", "apple"))

    if is_apple:
        # Serve .ics — iOS pops "Add to Calendar" natively
        params = f"?title={quote(title)}&start={start}&minutes={minutes}"
        return RedirectResponse(url=f"/appt.ics{params}", status_code=302)
    else:
        # Google Calendar one-tap
        try:
            dt_start = datetime.strptime(start, "%Y%m%dT%H%M%SZ").replace(tzinfo=_tz.utc)
            dt_end = dt_start + timedelta(minutes=minutes or 70)
            fmt = lambda d: d.strftime("%Y%m%dT%H%M%SZ")
            google_url = (
                f"https://calendar.google.com/calendar/render?action=TEMPLATE"
                f"&text={quote(title)}"
                f"&dates={fmt(dt_start)}/{fmt(dt_end)}"
                f"&location={quote(location)}"
                f"&details={quote('L&S Custom Tailors · 138 E 61st St, Suite 201, New York · Questions? Call (212) 752-1638')}"
            )
        except Exception:
            google_url = "https://calendar.google.com"
        return RedirectResponse(url=google_url, status_code=302)


# ─── Calendar (.ics) link for SMS/email confirmations ─────────────────────────

@app.get("/appt.ics")
async def appointment_ics(
    title: str = "Appointment — L&S Custom Tailors",
    start: str = "",
    minutes: int = 70,
    location: str = "138 East 61st Street, Suite 201, New York, NY 10065",
):
    """
    Generate a tap-to-add calendar file so the confirmation SMS/email can carry
    an 'Add to calendar' link. `start` is UTC, formatted YYYYMMDDTHHMMSSZ.
    """
    from datetime import timezone as _tz

    try:
        dt_start = datetime.strptime(start, "%Y%m%dT%H%M%SZ").replace(tzinfo=_tz.utc)
    except (ValueError, TypeError):
        dt_start = datetime.now(NYC).astimezone(_tz.utc)
    dt_end = dt_start + timedelta(minutes=minutes or 70)

    def fmt(d):
        return d.strftime("%Y%m%dT%H%M%SZ")

    def esc(s: str) -> str:
        return s.replace("\\", "\\\\").replace(",", "\\,").replace(";", "\\;")

    uid = f"{fmt(dt_start)}-{abs(hash(title + start)) % 10**8}@lstailors.com"
    ics = "\r\n".join([
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//L&S Custom Tailors//Sofia//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",  # PUBLISH = single event add, not a subscription
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{fmt(datetime.now(NYC).astimezone(_tz.utc))}",
        f"DTSTART:{fmt(dt_start)}",
        f"DTEND:{fmt(dt_end)}",
        f"SUMMARY:{esc(title)}",
        f"LOCATION:{esc(location)}",
        "DESCRIPTION:We look forward to seeing you. Questions? Call (212) 752-1638.",
        "STATUS:CONFIRMED",
        "TRANSP:OPAQUE",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ])
    return Response(
        content=ics,
        media_type="text/calendar",
        # attachment triggers a save/import dialog — iOS opens it as a one-time event add
        headers={"Content-Disposition": 'attachment; filename="appointment.ics"'},
    )


# ─── xAI Ephemeral Token ──────────────────────────────────────────────────────

@app.post("/api/token")
async def get_ephemeral_token(request: Request):
    # Mint a short-lived xAI session token so the browser /sofia page can
    # connect to Grok Realtime without ever seeing the raw API key.
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            "https://api.x.ai/v1/realtime/client_secrets",
            headers={"Authorization": f"Bearer {settings.XAI_API_KEY}"},
            json={"expires_after": {"seconds": 300}},
        )
    resp.raise_for_status()
    return resp.json()


# ─── Twilio Voice Webhook ─────────────────────────────────────────────────────

@app.post("/voice/incoming", response_class=HTMLResponse)
async def voice_incoming(request: Request):
    form = await request.form()
    caller = form.get("From", "unknown")
    call_sid = form.get("CallSid", "")
    mode = "internal" if is_staff_caller(caller) else "customer"
    logger.info(f"Incoming call from {caller} (mode={mode}, sid={call_sid})")

    # Create an initial ERPNext communication log — will be updated after call ends
    asyncio.create_task(
        create_communication_log(
            communication_type="Call",
            direction="Inbound",
            caller_phone=caller,
            content="[call started]",
            mode=mode,
            session_id=call_sid,
        )
    )

    from urllib.parse import quote
    ws_base = settings.BASE_URL.replace("https://", "wss://").replace("http://", "ws://")
    ws_url = f"{ws_base}/voice/stream?caller={quote(caller, safe='')}&mode={mode}&sid={call_sid}"

    response = VoiceResponse()
    connect = Connect()
    connect.stream(url=ws_url)
    response.append(connect)
    return HTMLResponse(content=str(response), media_type="application/xml")


@app.post("/voice/status", response_class=HTMLResponse)
async def voice_status(request: Request):
    """
    Twilio calls this status callback when a call completes.
    We use it to fetch the recording/transcript and update the ERPNext log.
    """
    form = await request.form()
    call_sid = form.get("CallSid", "")
    caller = form.get("From", "unknown")
    duration = int(form.get("CallDuration", 0))
    call_status = form.get("CallStatus", "")
    logger.info(f"Call status callback: {call_sid} status={call_status} duration={duration}s")

    if call_status in ("completed", "no-answer", "busy", "failed"):
        asyncio.create_task(_finalize_call_log(call_sid, caller, duration))

    return HTMLResponse(content="<Response/>", media_type="application/xml")


async def _finalize_call_log(call_sid: str, caller: str, duration: int):
    """
    After a call ends, poll Twilio for a transcript and update the ERPNext log.
    Twilio transcription can take up to 60 seconds.
    """
    transcript_text = ""
    # Wait up to 90 seconds for transcription
    for attempt in range(9):
        await asyncio.sleep(10)
        try:
            recordings = twilio_client.recordings.list(call_sid=call_sid, limit=1)
            if not recordings:
                continue
            rec_sid = recordings[0].sid
            transcriptions = twilio_client.transcriptions.list(recording_sid=rec_sid, limit=1)
            if not transcriptions:
                continue
            t = transcriptions[0]
            if t.status == "completed":
                transcript_text = t.transcription_text or ""
                break
            elif t.status == "failed":
                logger.warning(f"Twilio transcription failed for {call_sid}")
                break
        except Exception as e:
            logger.warning(f"Transcript poll attempt {attempt+1} failed: {e}")

    if transcript_text:
        logger.info(f"Got Twilio transcript for {call_sid} ({len(transcript_text)} chars)")

    # Find the initial comm log for this session_id and update it
    try:
        from web.erp_integration import erp_get
        resp = await erp_get(
            "resource/LSH Communication Log",
            params={
                "filters": json.dumps([["session_id", "=", call_sid]]),
                "fields": '["name"]',
                "limit": 1,
            },
        )
        rows = resp.get("data", [])
        if rows:
            await update_communication_log(
                doc_name=rows[0]["name"],
                transcript=transcript_text,
                duration_seconds=duration,
            )
    except Exception as e:
        logger.error(f"Could not update call log for {call_sid}: {e}")


@app.post("/voice/forward", response_class=HTMLResponse)
async def voice_forward(request: Request):
    response = VoiceResponse()
    response.say("One moment please, I'm connecting you now.", voice="Polly.Joanna")
    response.dial(settings.FORWARD_TO_NUMBER)
    return HTMLResponse(content=str(response), media_type="application/xml")


# ─── Twilio Media Stream WebSocket ────────────────────────────────────────────

@app.websocket("/voice/stream")
async def voice_stream(
    websocket: WebSocket,
    caller: str = "unknown",
    mode: str = "customer",
    sid: str = "",
):
    """
    Bridges Twilio µ-law 8 kHz Media Stream ↔ xAI Grok Realtime.
    Accumulates transcript and tool calls; writes them to ERPNext on call end.
    """
    await websocket.accept()
    logger.info(f"Stream connected: caller={caller} mode={mode} sid={sid}")

    system_prompt = await build_session_prompt(mode, caller)
    tools = load_tools()
    transcript_parts: list[str] = []
    tool_call_log: list[dict] = []  # accumulated tool calls for this session
    call_start = time.monotonic()

    try:
        async with websockets.connect(
            "wss://api.x.ai/v1/realtime?model=grok-voice-latest",
            extra_headers={
                "Authorization": f"Bearer {settings.XAI_API_KEY}",
            },
        ) as grok_ws:

            # xAI Grok Realtime session config.
            # audio/pcmu = G.711 µ-law 8 kHz — Twilio's native phone format,
            # so audio passes through both directions with no resampling.
            await grok_ws.send(json.dumps({
                "type": "session.update",
                "session": {
                    "instructions": system_prompt,
                    "tools": tools,
                    "voice": "ara",
                    "turn_detection": {
                        "type": "server_vad",
                        "threshold": 0.5,
                        "silence_duration_ms": 800,
                    },
                    "input_audio_transcription": {"model": "grok-2-audio"},
                    "audio": {
                        "input": {"format": {"type": "audio/pcmu", "rate": 8000}},
                        "output": {"format": {"type": "audio/pcmu", "rate": 8000}},
                    },
                },
            }))

            stream_sid = None
            greeting_sent = False

            async def twilio_to_grok():
                nonlocal stream_sid, greeting_sent
                async for raw in websocket.iter_text():
                    msg = json.loads(raw)
                    event = msg.get("event")
                    if event == "start":
                        stream_sid = msg["start"]["streamSid"]
                        # Now we have stream_sid — safe to trigger Sofia's greeting
                        if not greeting_sent:
                            greeting_sent = True
                            await grok_ws.send(json.dumps({
                                "type": "conversation.item.create",
                                "item": {
                                    "type": "message",
                                    "role": "user",
                                    "content": [{"type": "input_text", "text": "[call connected — greet the caller]"}],
                                },
                            }))
                            await grok_ws.send(json.dumps({"type": "response.create"}))
                    elif event == "media":
                        await grok_ws.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": msg["media"]["payload"],
                        }))
                    elif event == "stop":
                        break

            async def grok_to_twilio():
                async for raw in grok_ws:
                    msg = json.loads(raw)
                    t = msg.get("type", "")

                    if t == "response.output_audio.delta" and stream_sid:
                        await websocket.send_json({
                            "event": "media",
                            "streamSid": stream_sid,
                            "media": {"payload": msg.get("delta", "")},
                        })

                    elif t == "input_audio_buffer.speech_started" and stream_sid:
                        # Caller barged in — stop Sofia's current audio and cancel the response
                        await websocket.send_json({"event": "clear", "streamSid": stream_sid})
                        await grok_ws.send(json.dumps({"type": "response.cancel"}))

                    elif t == "response.output_audio_transcript.done":
                        text = msg.get("transcript", "")
                        if text:
                            transcript_parts.append(f"Sophia: {text}")

                    elif t == "conversation.item.input_audio_transcription.completed":
                        text = msg.get("transcript", "")
                        if text:
                            transcript_parts.append(f"Caller: {text}")

                    elif t == "response.function_call_arguments.done":
                        tool_name = msg.get("name", "")
                        call_id = msg.get("call_id", "")
                        try:
                            args = json.loads(msg.get("arguments", "{}"))
                        except json.JSONDecodeError:
                            args = {}

                        logger.info(f"Tool call: {tool_name}({args})")
                        result = await execute_tool(
                            tool_name, args,
                            caller=caller,
                            mode=mode,
                            log_collector=tool_call_log,
                        )

                        if tool_name == "forward_call" and stream_sid:
                            await websocket.send_json({
                                "event": "redirect",
                                "streamSid": stream_sid,
                                "redirect": {"url": f"{settings.BASE_URL}/voice/forward"},
                            })

                        await grok_ws.send(json.dumps({
                            "type": "conversation.item.create",
                            "item": {
                                "type": "function_call_output",
                                "call_id": call_id,
                                "output": json.dumps(result),
                            },
                        }))
                        await grok_ws.send(json.dumps({"type": "response.create"}))

                    elif t == "error":
                        logger.error(f"Grok error: {msg}")

            await asyncio.gather(twilio_to_grok(), grok_to_twilio())

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for {caller}")
    except Exception as e:
        logger.exception(f"Stream error for {caller}: {e}")
    finally:
        duration = int(time.monotonic() - call_start)
        full_transcript = "\n".join(transcript_parts)

        # Update the ERPNext communication log with transcript and tool calls
        try:
            from web.erp_integration import erp_get
            resp = await erp_get(
                "resource/LSH Communication Log",
                params={
                    "filters": json.dumps([["session_id", "=", sid]]),
                    "fields": '["name"]',
                    "limit": 1,
                },
            )
            rows = resp.get("data", [])
            if rows:
                await update_communication_log(
                    doc_name=rows[0]["name"],
                    transcript=full_transcript,
                    duration_seconds=duration,
                    tool_calls=tool_call_log if tool_call_log else None,
                )
        except Exception as e:
            logger.error(f"Could not persist call data for {sid}: {e}")

        logger.info(f"Call ended for {caller} (duration={duration}s, tools={len(tool_call_log)})")


# ─── Twilio SMS Webhook ───────────────────────────────────────────────────────

@app.post("/sms/incoming")
async def sms_incoming(request: Request):
    form = await request.form()
    from_number = form.get("From", "unknown")
    body = form.get("Body", "").strip()
    mode = "internal" if is_staff_caller(from_number) else "customer"
    logger.info(f"SMS from {from_number} ({mode}): {body[:80]}")

    # Log inbound SMS to ERPNext
    asyncio.create_task(
        create_communication_log(
            communication_type="SMS",
            direction="Inbound",
            caller_phone=from_number,
            content=body,
            mode=mode,
        )
    )

    history = await get_sms_history(from_number, limit=10)
    tool_call_log: list[dict] = []

    reply = await _grok_text_response(
        user_message=body,
        from_number=from_number,
        mode=mode,
        history=history,
        tool_call_log=tool_call_log,
    )

    # Log outbound reply + any tool calls
    asyncio.create_task(
        create_communication_log(
            communication_type="SMS",
            direction="Outbound",
            caller_phone=from_number,
            content=reply,
            mode=mode,
            tool_calls=tool_call_log if tool_call_log else None,
        )
    )

    # Human-like typing delay: ~50 chars/sec, capped 2–6s
    import random
    typing_delay = max(2.0, min(6.0, len(reply) / 50))
    typing_delay += random.uniform(0.5, 1.5)
    await asyncio.sleep(typing_delay)

    resp = MessagingResponse()
    resp.message(reply)
    return Response(content=str(resp), media_type="application/xml")


async def _grok_text_response(
    user_message: str,
    from_number: str,
    mode: str,
    history: list[dict],
    tool_call_log: list[dict],
    channel: str = "SMS",
) -> str:
    system_prompt = await build_session_prompt(mode, from_number)
    if channel == "WhatsApp":
        system_prompt = (
            "## CHANNEL: WhatsApp\n"
            "You are replying over WhatsApp (not SMS). Keep the warm, concise tone. "
            "Emoji are fine in moderation. Media and interactive buttons are not yet "
            "available, so describe options in plain text.\n\n---\n\n"
        ) + system_prompt
    tools = load_tools()

    messages = [{"role": "system", "content": system_prompt}]
    for h in history:
        role = "assistant" if h["direction"] == "outbound" else "user"
        messages.append({"role": role, "content": h["content"]})
    messages.append({"role": "user", "content": user_message})

    for _ in range(5):
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                "https://api.x.ai/v1/chat/completions",
                headers={"Authorization": f"Bearer {settings.XAI_API_KEY}"},
                json={
                    "model": "grok-4.3",
                    "messages": messages,
                    "tools": tools,
                    "tool_choice": "auto",
                    "max_tokens": 500,
                },
            )
        resp.raise_for_status()
        data = resp.json()
        choice = data["choices"][0]
        msg = choice["message"]

        if choice["finish_reason"] == "tool_calls":
            messages.append(msg)
            for tc in msg.get("tool_calls", []):
                tool_name = tc["function"]["name"]
                try:
                    args = json.loads(tc["function"]["arguments"])
                except json.JSONDecodeError:
                    args = {}
                result = await execute_tool(
                    tool_name, args,
                    caller=from_number,
                    mode=mode,
                    log_collector=tool_call_log,
                )
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc["id"],
                    "content": json.dumps(result),
                })
            continue

        return msg.get("content", "I'm sorry, I wasn't able to process that request right now.")

    return "I'm handling multiple requests — please text again in just a moment."


# ─── WhatsApp (ERPNext / Meta Cloud API via frappe_whatsapp) ──────────────────
# WhatsApp is Meta-direct through ERPNext: Meta → ERPNext webhook → an incoming
# "WhatsApp Message" doc → a Frappe Webhook POSTs it here. Sofia (same Grok brain)
# replies by creating an Outgoing "WhatsApp Message" doc, which frappe_whatsapp
# delivers to Meta. Both sides are logged to LSH Communication Log (own WhatsApp
# thread, separate from SMS) so they surface on the /sofia page.

async def _process_whatsapp_inbound(
    phone: str, to_number: str, body: str, mode: str, reply_to_message_id: str
) -> None:
    """Generate Sofia's reply and send it back via ERPNext. Runs in the background
    so the Frappe Webhook call returns immediately (Grok + tools can take seconds)."""
    asyncio.create_task(
        create_communication_log(
            communication_type="WhatsApp", direction="Inbound",
            caller_phone=phone, content=body, mode=mode,
        )
    )

    history = await get_sms_history(phone, limit=10, channel="WhatsApp")
    tool_call_log: list[dict] = []
    reply = await _grok_text_response(
        user_message=body, from_number=phone, mode=mode,
        history=history, tool_call_log=tool_call_log, channel="WhatsApp",
    )

    await send_whatsapp_via_erpnext(to=to_number, message=reply,
                                    reply_to_message_id=reply_to_message_id)

    asyncio.create_task(
        create_communication_log(
            communication_type="WhatsApp", direction="Outbound",
            caller_phone=phone, content=reply, mode=mode,
            tool_calls=tool_call_log if tool_call_log else None,
        )
    )


@app.post("/whatsapp/incoming")
async def whatsapp_incoming(request: Request):
    """Fed by a Frappe Webhook on incoming WhatsApp Message docs.
    JSON body: {from, message, message_id, ...}. Acks fast; replies in background."""
    if not check_bridge_key(request):
        logger.warning("Rejected WhatsApp inbound — bad bridge key")
        return Response(content='{"error":"unauthorized"}', media_type="application/json", status_code=401)

    try:
        payload = await request.json()
    except Exception:
        return Response(content='{"error":"invalid json"}', media_type="application/json", status_code=400)

    raw_from = str(payload.get("from") or "").strip()
    body = str(payload.get("message") or "").strip()
    if not raw_from or not body:
        return Response(content='{"ok":true,"skipped":"empty"}', media_type="application/json")

    # frappe_whatsapp stores `from` as digits (no +). Normalize to +E.164 for
    # caller lookup/logging; keep the raw form for the outgoing `to` field.
    phone = raw_from if raw_from.startswith("+") else "+" + raw_from
    mode = "internal" if is_staff_caller(phone) else "customer"
    logger.info(f"WhatsApp from {phone} ({mode}): {body[:80]}")

    asyncio.create_task(
        _process_whatsapp_inbound(phone, raw_from, body, mode, str(payload.get("message_id") or ""))
    )
    return Response(content='{"ok":true,"queued":true}', media_type="application/json")


# ─── Manual SMS (dashboard) ───────────────────────────────────────────────────

class ManualSMSPayload(BaseModel):
    to: str
    message: str


@app.post("/api/send-sms")
async def send_sms_manual(payload: ManualSMSPayload):
    msg = twilio_client.messages.create(
        body=payload.message,
        from_=settings.TWILIO_PHONE_NUMBER,
        to=payload.to,
    )
    asyncio.create_task(
        create_communication_log(
            communication_type="SMS",
            direction="Outbound",
            caller_phone=payload.to,
            content=payload.message,
            mode="manual",
        )
    )
    return {"sid": msg.sid, "status": msg.status}


# ─── Raven Webhook (staff → Sofia bot messages) ───────────────────────────────

@app.post("/api/raven-webhook")
async def raven_webhook(request: Request):
    """
    Receive messages sent to the Sofia bot in Raven.
    Accepts raw JSON so we're not brittle to Raven's payload shape.
    Runs the same Grok text-completion brain used for staff SMS,
    then posts the reply back to the originating Raven channel.
    """
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "error": "invalid JSON"}

    # Log full payload so we can see what Raven actually sends
    logger.info(f"Raven webhook raw payload: {body}")

    # Raven outgoing webhook payload shape (may vary by version):
    # { "message": { "text": "...", "channel_id": "...", "owner": "user@..." }, ... }
    # or flat: { "text": "...", "channel_id": "...", "sender": "..." }
    msg = body.get("message", body)
    text = (msg.get("text") or msg.get("content") or "").strip()
    channel_id = (msg.get("channel_id") or body.get("channel_id") or "").strip()
    sender = (msg.get("owner") or msg.get("sender") or body.get("sender") or "").strip()
    is_bot = bool(body.get("is_bot_message") or msg.get("is_bot_message"))

    # Skip messages sent by Sofia herself or any bot (avoid reply loops)
    if is_bot or sender in ("concierge@lstailors.com", "Administrator"):
        return {"ok": True, "skipped": "bot or own message"}
<<<<<<< HEAD
@app.post("/api/raven-webhook")
async def raven_webhook(request: Request):
    """
    Receive messages sent to the Sofia bot in Raven.
    Accepts raw JSON so we're not brittle to Raven's payload shape.
    Runs the same Grok text-completion brain used for staff SMS,
    then posts the reply back to the originating Raven channel.
    """
    text = payload.text.strip()
    sender = payload.sender.strip()
    channel_id = payload.channel_id.strip()
>>>>>>> 0c4ddca (feat: integrate Raven messenger for Sofia activity notifications and staff bot)

    if not text:
        return {"ok": True, "skipped": "empty message"}

    logger.info(f"Raven webhook from {sender}: {text[:80]}")

    # Use the staff phone number as a stand-in identifier for history lookup.
    # Fall back to sender email if no phone is known.
    from_number = sender  # not a real phone — history will be empty, that's fine

    tool_call_log: list[dict] = []
    try:
        reply = await _grok_text_response(
            user_message=text,
            from_number=from_number,
            mode="internal",
            history=[],
            tool_call_log=tool_call_log,
        )
    except Exception as e:
        logger.error(f"Raven webhook Grok error: {e}")
        reply = "Sorry, I ran into an error processing that request."

    # Post the reply back to the originating Raven channel — fire-and-forget
    if channel_id:
        asyncio.create_task(post_raven_message(reply, channel_id=channel_id))
    else:
        asyncio.create_task(post_raven_message(reply))

    return {"ok": True}


# ─── Communications API (for app.lstailors.com /sofia page) ──────────────────

@app.get("/api/communications")
async def list_communications(limit: int = 200):
    """
    Return all SMS and Call threads grouped by phone number.
    Shape matches SofiaChat.tsx Conversation interface.
    """
    try:
        resp = await erp_get(
            "resource/LSH Communication Log",
            params={
                "fields": '["name","caller_phone","communication_type","direction","content","transcript","timestamp","customer","mode"]',
                "order_by": "timestamp desc",
                "limit": limit,
            },
        )
        rows = resp.get("data", [])
    except Exception as e:
        logger.error(f"list_communications: {e}")
        return {"data": []}

    # Group by caller_phone into thread summaries
    thread_map: dict[str, dict] = {}
    for row in rows:
        phone = row.get("caller_phone", "")
        if not phone:
            continue
        ts = row.get("timestamp", "")
        existing = thread_map.get(phone)
        if not existing:
            thread_map[phone] = {
                "phone": phone,
                "clientName": row.get("customer") or None,
                "lastMessage": {
                    "body": row.get("content") or (row.get("transcript") or "")[:120] or "(call)",
                    "direction": row.get("direction", "Inbound").lower(),
                    "created_at": ts,
                },
                "messageCount": 1,
                "sofiaActive": True,
                "unread": False,
            }
        else:
            existing["messageCount"] += 1
            if not existing["clientName"] and row.get("customer"):
                existing["clientName"] = row["customer"]
            # Keep the most recent timestamp as lastMessage
            if ts > existing["lastMessage"].get("created_at", ""):
                existing["lastMessage"] = {
                    "body": row.get("content") or (row.get("transcript") or "")[:120] or "(call)",
                    "direction": row.get("direction", "Inbound").lower(),
                    "created_at": ts,
                }

    threads = sorted(
        thread_map.values(),
        key=lambda t: t["lastMessage"].get("created_at", ""),
        reverse=True,
    )
    return {"data": threads}


@app.get("/api/communications/{phone}")
async def get_communication_thread(phone: str, limit: int = 200):
    """
    Return full message history for a phone number.
    Shape matches SofiaChat.tsx Message interface.
    """
    from urllib.parse import unquote
    phone = unquote(phone)
    normalized = phone[-10:] if len(phone) >= 10 else phone

    try:
        resp = await erp_get(
            "resource/LSH Communication Log",
            params={
                "filters": json.dumps([["caller_phone", "like", f"%{normalized}%"]]),
                "fields": '["name","caller_phone","communication_type","direction","content","transcript","timestamp","customer","mode","appointment_booked"]',
                "order_by": "timestamp asc",
                "limit": limit,
            },
        )
        rows = resp.get("data", [])
    except Exception as e:
        logger.error(f"get_communication_thread: {e}")
        return {"data": []}

    messages = []
    for row in rows:
        ctype = row.get("communication_type", "SMS")
        direction = row.get("direction", "Inbound").lower()
        # For calls, body is the transcript; for SMS, it's the content
        if ctype == "Call":
            body = row.get("transcript") or "(voice call — no transcript)"
            sender = "Sofia (voice)"
        else:
            body = row.get("content") or ""
            sender = "Sofia" if direction == "outbound" else row.get("customer") or phone

        appt = row.get("appointment_booked")
        if appt:
            body = body + f"\n[Appointment booked: {appt}]"

        messages.append({
            "id": row["name"],
            "client_phone": row.get("caller_phone", phone),
            "direction": "inbound" if direction == "inbound" else "outbound",
            "body": body,
            "created_at": row.get("timestamp", ""),
            "sender": sender,
            "type": ctype,
        })

    return {"data": messages}
