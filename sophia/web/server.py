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
    get_sms_history,
    update_communication_log,
    NYC,
)
from web.tools import execute_tool, TOOL_REGISTRY

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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Sophia is online. ERPNext: %s", settings.ERPNEXT_URL or "not configured")
    await check_voice_endpoint()
    yield
    logger.info("Sophia shutting down.")


app = FastAPI(title="Sophia Agent", lifespan=lifespan)
twilio_client = TwilioClient(settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN)


# ─── Health ───────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    return {"status": "ok", "agent": "sophia", "erp": bool(settings.ERPNEXT_URL)}


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
    from datetime import datetime as _dt, timedelta, timezone as _tz

    try:
        dt_start = _dt.strptime(start, "%Y%m%dT%H%M%SZ").replace(tzinfo=_tz.utc)
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
        "METHOD:PUBLISH",
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{fmt(datetime.now(NYC).astimezone(_tz.utc))}",
        f"DTSTART:{fmt(dt_start)}",
        f"DTEND:{fmt(dt_end)}",
        f"SUMMARY:{esc(title)}",
        f"LOCATION:{esc(location)}",
        "DESCRIPTION:We look forward to seeing you. Questions? Call (212) 752-1638.",
        "END:VEVENT",
        "END:VCALENDAR",
        "",
    ])
    return Response(
        content=ics,
        media_type="text/calendar",
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

    resp = MessagingResponse()
    resp.message(reply)
    return Response(content=str(resp), media_type="application/xml")


async def _grok_text_response(
    user_message: str,
    from_number: str,
    mode: str,
    history: list[dict],
    tool_call_log: list[dict],
) -> str:
    system_prompt = await build_session_prompt(mode, from_number)
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
