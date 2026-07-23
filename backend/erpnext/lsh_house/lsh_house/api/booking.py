"""
L&S public booking availability engine.

Keystone endpoint for book.lstailors.com:
  store hours ∩ per-tailor schedule → open slots
  per appointment-type duration
  2 fitting-room capacity for room-consuming types

Guest-whitelisted methods (also called from ls-house-app Hono proxy):
  lsh_house.api.booking.get_available_slots
  lsh_house.api.booking.get_agents
  lsh_house.api.booking.get_appointment_types
"""

from __future__ import annotations

import json
from typing import Any

import frappe
from frappe.utils import add_days, getdate


# ── Spec defaults (overridden by DocType fields when present) ─────────────────

# Canonical public types → duration minutes (spec Jul 2026)
DEFAULT_DURATIONS: dict[str, int] = {
	"Initial Consultation": 60,
	"Bespoke Consultation": 60,
	"Consultation": 60,
	"Fitting Appointment": 30,
	"Fitting": 30,
	"Alterations Appointment": 15,
	"Alterations": 15,
	"Alterations Fitting": 15,
	# Non-room / ancillary — keep bookable with sensible defaults
	"New Client Phone Consultation": 30,
	"Virtual Consultation": 30,
	"Customer Exchange": 15,
	"Final Pickup": 15,
	"Pickups and Deliveries": 15,
}

# Spec public picker (NYC floor). Kelvin is HOU — excluded from default public pool.
PUBLIC_AGENT_USERS = {
	"carl@lstailors.com",
	"sal@lstailors.com",
	"chris@ckcny.com",
}

DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

# Room-consuming categories per spec: Consultation / Fitting / Alterations
ROOM_TYPE_ALIASES = {
	"Initial Consultation",
	"Bespoke Consultation",
	"Consultation",
	"Fitting Appointment",
	"Fitting",
	"Alterations Appointment",
	"Alterations",
	"Alterations Fitting",
}


def _t2m(t: Any) -> int:
	parts = str(t).split(":")
	return int(parts[0]) * 60 + int(parts[1])


def _m2t(m: int) -> str:
	return f"{m // 60:02d}:{m % 60:02d}:00"


def _norm(s: Any) -> str:
	return str(s)[:19]


def _add_mins(dt_str: str, mins: int) -> str:
	parts = _norm(dt_str).split(" ")
	d_part = parts[0]
	t_part = parts[1] if len(parts) > 1 else "00:00:00"
	total = _t2m(t_part) + mins
	extra_days = total // 1440
	rem = total % 1440
	if extra_days:
		d_part = str(add_days(d_part, extra_days))
	return f"{d_part} {_m2t(rem)}"


def _overlaps(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
	return not (a_end <= b_start or a_start >= b_end)


def _get_settings() -> dict[str, Any]:
	"""Store-wide booking settings (CRM Appointment Booking Settings)."""
	duration = 30
	rooms = 2
	holiday = None
	advance_days = 60
	try:
		rows = frappe.get_all(
			"Singles",
			filters={"doctype": "Appointment Booking Settings"},
			fields=["field", "value"],
		)
		kv = {r.field: r.value for r in rows}
		duration = int(kv.get("appointment_duration") or duration)
		rooms = int(kv.get("fitting_room_count") or rooms)
		holiday = kv.get("holiday_list") or None
		advance_days = int(kv.get("advance_booking_days") or advance_days)
	except Exception:
		pass

	store_hours: dict[str, list[tuple[int, int]]] = {}
	try:
		for slot in frappe.get_all(
			"Appointment Booking Slots",
			fields=["day_of_week", "from_time", "to_time"],
			order_by="idx asc",
		):
			day = slot.day_of_week
			store_hours.setdefault(day, []).append((_t2m(slot.from_time), _t2m(slot.to_time)))
	except Exception:
		# Fallback: Tue–Fri 9–17, Sat 9–15 (L&S shop hours v2)
		for d in ("Tuesday", "Wednesday", "Thursday", "Friday"):
			store_hours[d] = [(9 * 60, 17 * 60)]
		store_hours["Saturday"] = [(9 * 60, 15 * 60)]

	return {
		"default_duration": duration,
		"fitting_room_count": rooms,
		"holiday_list": holiday,
		"advance_booking_days": advance_days,
		"store_hours": store_hours,
	}


def _type_config(appt_type: str) -> dict[str, Any]:
	row = frappe.db.get_value(
		"LSH Appointment Type",
		appt_type,
		["name", "appointment_type", "category", "needs_room", "publicly_bookable", "duration_minutes"],
		as_dict=True,
	)
	if not row:
		# Allow bare aliases from the public UI before full type rename
		alias_map = {
			"Consultation": "Initial Consultation",
			"Fitting": "Fitting Appointment",
			"Alterations": "Alterations Appointment",
			"Alterations Fitting": "Alterations Appointment",
		}
		mapped = alias_map.get(appt_type)
		if mapped:
			return _type_config(mapped)
		frappe.throw(f"Unknown appointment type: {appt_type}")

	if not row.publicly_bookable:
		frappe.throw("This appointment type is not publicly bookable")

	duration = None
	if row.get("duration_minutes"):
		try:
			duration = int(row.duration_minutes)
		except (TypeError, ValueError):
			duration = None
	if not duration:
		duration = DEFAULT_DURATIONS.get(row.name) or DEFAULT_DURATIONS.get(row.appointment_type) or 30

	# Spec: Consultation / Fitting / Alterations consume a room even if legacy flag wrong
	needs_room = bool(row.needs_room) or row.name in ROOM_TYPE_ALIASES or row.appointment_type in ROOM_TYPE_ALIASES

	return {
		"name": row.name,
		"category": row.category,
		"needs_room": needs_room,
		"duration": duration,
	}


def _parse_agent_schedule(raw: Any) -> list[dict[str, Any]] | None:
	"""
	weekly_schedule JSON on LSH Booking Agent:
	  [{"day":"Tuesday","from":"09:00","to":"17:00"}, ...]
	None / empty → use full store hours for that agent.
	"""
	if not raw:
		return None
	if isinstance(raw, str):
		raw = raw.strip()
		if not raw:
			return None
		try:
			raw = json.loads(raw)
		except Exception:
			return None
	if not isinstance(raw, list) or not raw:
		return None
	out = []
	for row in raw:
		try:
			day = row.get("day") or row.get("day_of_week")
			frm = row.get("from") or row.get("from_time")
			to = row.get("to") or row.get("to_time")
			if not day or frm is None or to is None:
				continue
			out.append({"day": day, "from_m": _t2m(frm), "to_m": _t2m(to)})
		except Exception:
			continue
	return out or None


def _agent_hours_for_day(
	day_name: str,
	store_hours: dict[str, list[tuple[int, int]]],
	agent_schedule: list[dict[str, Any]] | None,
) -> list[tuple[int, int]]:
	"""Intersect agent personal schedule with store hours. Empty agent schedule → store hours."""
	store = store_hours.get(day_name, [])
	if not store:
		return []
	if not agent_schedule:
		return list(store)

	personal = [(r["from_m"], r["to_m"]) for r in agent_schedule if r["day"] == day_name]
	if not personal:
		# Agent has a schedule defined but is off this day
		return []

	# Intersect each personal window with each store window
	result: list[tuple[int, int]] = []
	for pf, pt in personal:
		for sf, st in store:
			start = max(pf, sf)
			end = min(pt, st)
			if start < end:
				result.append((start, end))
	return result


def _load_public_agents(agent_user: str | None = None) -> list[dict[str, Any]]:
	filters: dict[str, Any] = {"active": 1}
	if agent_user:
		filters["agent_user"] = agent_user

	fields = ["name", "agent_user", "display_name", "tag_aliases"]
	# optional columns may not exist yet on older sites
	meta = frappe.get_meta("LSH Booking Agent")
	fieldnames = {f.fieldname for f in meta.fields}
	if "weekly_schedule" in fieldnames:
		fields.append("weekly_schedule")
	if "public_bookable" in fieldnames:
		fields.append("public_bookable")

	agents = frappe.get_all(
		"LSH Booking Agent",
		filters=filters,
		fields=fields,
		order_by="display_name asc",
	)

	out = []
	for a in agents:
		# Prefer explicit public_bookable flag; else PUBLIC_AGENT_USERS allowlist
		if "public_bookable" in a:
			if not a.public_bookable and a.agent_user not in PUBLIC_AGENT_USERS:
				continue
			if a.public_bookable == 0:
				continue
		elif a.agent_user not in PUBLIC_AGENT_USERS:
			continue
		out.append(
			{
				"name": a.name,
				"agent_user": a.agent_user,
				"display_name": a.display_name,
				"tag_aliases": a.tag_aliases or "",
				"schedule": _parse_agent_schedule(a.get("weekly_schedule")),
			}
		)
	return out


def _holiday_dates(holiday_list: str | None, date_from: str, date_to: str) -> set[str]:
	if not holiday_list:
		return set()
	rows = frappe.get_all(
		"Holiday",
		filters={"parent": holiday_list, "holiday_date": ["between", [date_from, date_to]]},
		fields=["holiday_date"],
	)
	return {str(r.holiday_date) for r in rows}


def _build_tag_map(all_agents: list[dict[str, Any]]) -> dict[str, str]:
	tag_map: dict[str, str] = {}
	for a in all_agents:
		if not a.get("tag_aliases"):
			continue
		for alias in a["tag_aliases"].split(","):
			key = alias.strip().rstrip(":").lower()
			if key:
				tag_map[key] = a["agent_user"]
	return tag_map


def _busy_intervals(
	agent_users: list[str],
	date_from: str,
	date_to: str,
	duration: int,
	tag_map: dict[str, str],
) -> dict[str, list[tuple[str, str]]]:
	busy: dict[str, list[tuple[str, str]]] = {au: [] for au in agent_users}
	if not agent_users:
		return busy

	appts = frappe.get_all(
		"Appointment",
		filters=[
			["scheduled_time", ">=", f"{date_from} 00:00:00"],
			["scheduled_time", "<=", f"{date_to} 23:59:59"],
			["status", "!=", "Closed"],
			["assigned_agent", "in", agent_users],
		],
		fields=["scheduled_time", "assigned_agent", "custom_appointment_type"],
	)
	for appt in appts:
		au = appt.get("assigned_agent")
		if au not in busy:
			continue
		# Prefer type-specific duration for the booked appt when known
		appt_dur = duration
		atype = appt.get("custom_appointment_type")
		if atype:
			appt_dur = DEFAULT_DURATIONS.get(atype) or duration
			try:
				dm = frappe.db.get_value("LSH Appointment Type", atype, "duration_minutes")
				if dm:
					appt_dur = int(dm)
			except Exception:
				pass
		s = _norm(appt.scheduled_time)
		busy[au].append((s, _add_mins(s, appt_dur)))

	# Calendar blocks on L&S Appointments (Google-synced Events)
	cal_events = frappe.get_all(
		"Event",
		filters=[
			["google_calendar", "=", "L&S Appointments"],
			["starts_on", "<=", f"{date_to} 23:59:59"],
			["ends_on", ">=", f"{date_from} 00:00:00"],
			["status", "!=", "Cancelled"],
		],
		fields=["subject", "starts_on", "ends_on"],
	)
	for ev in cal_events:
		subj = (ev.subject or "").strip()
		es = _norm(ev.starts_on)
		ee = _norm(ev.ends_on) if ev.ends_on else _add_mins(es, 60)
		block_all = False
		matched = None
		if ":" in subj:
			prefix = subj.split(":")[0].strip().lower()
			if prefix == "all":
				block_all = True
			else:
				matched = tag_map.get(prefix)
		else:
			# Untagged public events block everyone (conservative)
			block_all = True
		if block_all:
			targets = agent_users
		elif matched and matched in busy:
			targets = [matched]
		else:
			targets = []
		for au in targets:
			busy[au].append((es, ee))

	return busy


def _room_intervals(date_from: str, date_to: str, default_duration: int) -> list[tuple[str, str]]:
	room_types = [
		r.name
		for r in frappe.get_all("LSH Appointment Type", filters={"needs_room": 1}, fields=["name"])
	]
	# Always include spec room types even if needs_room flag lagging
	for t in ROOM_TYPE_ALIASES:
		if t not in room_types and frappe.db.exists("LSH Appointment Type", t):
			room_types.append(t)
	if not room_types:
		return []

	room_appts = frappe.get_all(
		"Appointment",
		filters=[
			["scheduled_time", ">=", f"{date_from} 00:00:00"],
			["scheduled_time", "<=", f"{date_to} 23:59:59"],
			["status", "!=", "Closed"],
			["custom_appointment_type", "in", room_types],
		],
		fields=["scheduled_time", "custom_appointment_type"],
	)
	intervals = []
	for ra in room_appts:
		s = _norm(ra.scheduled_time)
		dur = DEFAULT_DURATIONS.get(ra.custom_appointment_type or "", default_duration)
		try:
			dm = frappe.db.get_value("LSH Appointment Type", ra.custom_appointment_type, "duration_minutes")
			if dm:
				dur = int(dm)
		except Exception:
			pass
		intervals.append((s, _add_mins(s, dur)))
	return intervals


@frappe.whitelist(allow_guest=True)
def get_appointment_types():
	"""Public list of bookable types with durations (for the book UI)."""
	meta = frappe.get_meta("LSH Appointment Type")
	fields = ["name", "appointment_type", "category", "needs_room", "publicly_bookable"]
	if any(f.fieldname == "duration_minutes" for f in meta.fields):
		fields.append("duration_minutes")

	rows = frappe.get_all(
		"LSH Appointment Type",
		filters={"publicly_bookable": 1},
		fields=fields,
		order_by="name asc",
	)
	out = []
	for r in rows:
		dur = None
		if r.get("duration_minutes"):
			try:
				dur = int(r.duration_minutes)
			except (TypeError, ValueError):
				dur = None
		dur = dur or DEFAULT_DURATIONS.get(r.name) or DEFAULT_DURATIONS.get(r.appointment_type) or 30
		needs_room = bool(r.needs_room) or r.name in ROOM_TYPE_ALIASES
		out.append(
			{
				"name": r.name,
				"label": r.appointment_type or r.name,
				"category": r.category,
				"needs_room": needs_room,
				"duration_minutes": dur,
			}
		)
	frappe.response["data"] = out
	return out


@frappe.whitelist(allow_guest=True)
def get_agents(appointment_type: str | None = None):
	"""Public tailor picker: Sal, Carl, Christopher (+ schedules metadata)."""
	agents = _load_public_agents()
	# appointment_type reserved for future type_rules filtering
	_ = appointment_type
	frappe.response["data"] = [
		{
			"agent_user": a["agent_user"],
			"display_name": a["display_name"],
			"has_custom_schedule": bool(a["schedule"]),
		}
		for a in agents
	]
	return frappe.response["data"]


@frappe.whitelist(allow_guest=True)
def get_available_slots(
	date_from: str | None = None,
	date_to: str | None = None,
	appointment_type: str | None = None,
	agent_user: str | None = None,
):
	"""
	Generate open slots.

	Params:
	  date_from, date_to: YYYY-MM-DD
	  appointment_type: LSH Appointment Type name (or alias Consultation/Fitting/Alterations)
	  agent_user: optional email; omit / empty = No preference (any free public agent)

	Returns list of:
	  {datetime, date, time, duration_minutes, free_agents:[{agent_user, display_name}]}
	"""
	d = frappe.form_dict
	date_from = date_from or d.get("date_from")
	date_to = date_to or d.get("date_to")
	appointment_type = appointment_type or d.get("appointment_type")
	agent_user = agent_user or d.get("agent_user") or None
	if agent_user in ("", "null", "undefined", "any", "none"):
		agent_user = None

	if not date_from or not date_to:
		frappe.throw("date_from and date_to are required")
	if not appointment_type:
		frappe.throw("appointment_type is required")

	settings = _get_settings()
	type_cfg = _type_config(appointment_type)
	duration = int(type_cfg["duration"])
	needs_room = bool(type_cfg["needs_room"])
	rooms = int(settings["fitting_room_count"] or 2)

	agents = _load_public_agents(agent_user=agent_user)
	if agent_user and not agents:
		frappe.throw("Agent not found or not publicly bookable")
	if not agents:
		frappe.throw("No publicly bookable agents configured")

	# Also load all agents for tag map (blocks may reference Kelvin etc.)
	all_for_tags = frappe.get_all(
		"LSH Booking Agent",
		filters={"active": 1},
		fields=["agent_user", "tag_aliases"],
	)
	tag_map = _build_tag_map(
		[{"agent_user": a.agent_user, "tag_aliases": a.tag_aliases or ""} for a in all_for_tags]
	)

	agent_users = [a["agent_user"] for a in agents]
	busy = _busy_intervals(agent_users, date_from, date_to, duration, tag_map)
	room_iv = _room_intervals(date_from, date_to, duration) if needs_room else []
	holidays = _holiday_dates(settings["holiday_list"], date_from, date_to)
	store_hours = settings["store_hours"]

	result: list[dict[str, Any]] = []
	cur = date_from
	while cur <= date_to:
		if cur not in holidays:
			dow = getdate(cur).weekday()
			day_name = DAY_NAMES[dow]

			# Candidate windows = union of each agent's hours for the day
			# We'll evaluate per-slot across agents.
			# Build a fine grid from the earliest store open to latest close, stepping by duration.
			day_store = store_hours.get(day_name, [])
			if day_store:
				grid_start = min(w[0] for w in day_store)
				grid_end = max(w[1] for w in day_store)
				cs_m = grid_start
				while cs_m + duration <= grid_end:
					slot_start = f"{cur} {_m2t(cs_m)}"
					slot_end = f"{cur} {_m2t(cs_m + duration)}"

					# Room capacity
					if needs_room:
						room_count = sum(
							1 for rs, re in room_iv if _overlaps(slot_start, slot_end, rs, re)
						)
						if room_count >= rooms:
							cs_m += duration
							continue

					free = []
					for ag in agents:
						# Must be within this agent's hours (store ∩ personal)
						windows = _agent_hours_for_day(day_name, store_hours, ag["schedule"])
						in_hours = any(w0 <= cs_m and cs_m + duration <= w1 for w0, w1 in windows)
						if not in_hours:
							continue
						occupied = any(
							_overlaps(slot_start, slot_end, bs, be) for bs, be in busy.get(ag["agent_user"], [])
						)
						if not occupied:
							free.append(
								{"agent_user": ag["agent_user"], "display_name": ag["display_name"]}
							)

					if free:
						result.append(
							{
								"datetime": slot_start,
								"date": cur,
								"time": _m2t(cs_m)[:5],
								"duration_minutes": duration,
								"free_agents": free,
							}
						)

					cs_m += duration
		cur = str(add_days(cur, 1))

	frappe.response["data"] = result
	return result
