#!/usr/bin/env python3
"""Sync Hermes/ERP activity into lsh.* so Mission Control (Vercel Edge) can read it."""
from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERMES_HOME_RAW = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser().resolve()
# If HERMES_HOME points at a profile dir (…/profiles/simone), climb to fleet root.
if HERMES_HOME_RAW.name != ".hermes" and (HERMES_HOME_RAW.parent.name == "profiles" or (HERMES_HOME_RAW / "state.db").exists()):
    if HERMES_HOME_RAW.parent.name == "profiles":
        HERMES_HOME = HERMES_HOME_RAW.parent.parent
    else:
        HERMES_HOME = HERMES_HOME_RAW
else:
    HERMES_HOME = HERMES_HOME_RAW
if not (HERMES_HOME / "profiles").is_dir() and (Path.home() / ".hermes" / "profiles").is_dir():
    HERMES_HOME = Path.home() / ".hermes"
PROFILES_DIR = HERMES_HOME / "profiles"
APPLY = "--apply" in sys.argv
UA = "Mozilla/5.0 (compatible; L&S-MC-Snapshot/1.0)"

MODEL_RATES = {
    "default": (3.0, 15.0),
    "grok": (3.0, 15.0),
    "claude": (3.0, 15.0),
    "gpt": (2.5, 10.0),
}

FLEET_META = {
    "maestro": ("Maestro", "Orchestrator", True),
    "simone": ("Simone", "Dev / Full-stack", True),
    "lucia": ("Lucia", "UI / Design", True),
    "coder": ("Coder", "Implementation worker", True),
    "sofia": ("Sofia", "Client Concierge", False),
    "sofia-sms": ("Sofia SMS", "SMS channel", False),
    "mia": ("Mia", "Scheduling & Dossiers", True),
    "rocco": ("Rocco", "Production & Delivery", True),
    "melena": ("Melena", "Accounting & Books", True),
    "melana": ("Melena", "Accounting & Books", True),
    "filo": ("Filo", "Ingestion & Intelligence", True),
    "marco": ("Marco", "Logistics", True),
    "lapenna": ("La Penna", "Analytics & Writing", True),
    "pasquale": ("Pasquale", "Ops", True),
    "giada": ("Giada", "Agent", True),
    "giovanna": ("Giovanna", "Agent", True),
    "gemma": ("Gemma", "Agent", True),
}


def kc(service: str, account: str | None = None) -> str:
    cmd = ["security", "find-generic-password", "-s", service, "-w"]
    if account:
        cmd = ["security", "find-generic-password", "-s", service, "-a", account, "-w"]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def env_or_kc(env_key: str, *services: str) -> str:
    v = (os.environ.get(env_key) or "").strip()
    if v:
        return v
    for s in services:
        for acct in (None, "openclaw"):
            v = kc(s, acct) if acct else kc(s)
            if v:
                return v
    return ""


def supabase():
    url = env_or_kc("SUPABASE_URL", "openclaw-supabase-url").rstrip("/")
    key = env_or_kc(
        "SUPABASE_SERVICE_ROLE_KEY",
        "openclaw-supabase-service-key",
        "openclaw-supabase-key",
    )
    if not url or len(key) < 80:
        raise SystemExit("supabase creds missing")
    return url, key


def erp_creds():
    base = (os.environ.get("ERPNEXT_BASE_URL") or "").strip()
    key = (os.environ.get("ERPNEXT_API_KEY") or "").strip()
    secret = (os.environ.get("ERPNEXT_API_SECRET") or "").strip()
    env_path = Path.home() / "ls-mcp" / ".env"
    if env_path.is_file():
        for line in env_path.read_text().splitlines():
            if "=" not in line or line.strip().startswith("#"):
                continue
            k, v = line.split("=", 1)
            k, v = k.strip(), v.strip().strip('"').strip("'")
            if k in ("ERPNEXT_URL", "FRAPPE_URL", "ERP_URL", "ERPNEXT_BASE_URL") and not base:
                base = v
            if k in ("ERPNEXT_API_KEY", "FRAPPE_API_KEY", "API_KEY") and not key:
                key = v
            if k in ("ERPNEXT_API_SECRET", "FRAPPE_API_SECRET", "API_SECRET") and not secret:
                secret = v
    return (base or "http://localhost:8080").rstrip("/"), key, secret


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def erp_list(doctype: str, fields: list[str], filters=None, limit=200, order_by="modified desc"):
    base, key, secret = erp_creds()
    if not key or not secret:
        print("erp: missing key/secret", file=sys.stderr)
        return []
    params = {
        "fields": json.dumps(fields),
        "limit_page_length": str(limit),
        "order_by": order_by,
    }
    if filters is not None:
        params["filters"] = json.dumps(filters)
    url = f"{base}/api/resource/{urllib.parse.quote(doctype)}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"token {key}:{secret}",
            "Accept": "application/json",
            "User-Agent": UA,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode())
            return data.get("data") or []
    except Exception as e:
        print(f"erp_list {doctype}: {e}", file=sys.stderr)
        return []


def sb_request(path: str, method: str = "GET", body: bytes | None = None, prefer: str | None = None):
    url, key = supabase()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": "lsh",
        "Content-Profile": "lsh",
        "User-Agent": UA,
    }
    if body is not None:
        headers["Content-Type"] = "application/json"
    if prefer:
        headers["Prefer"] = prefer
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:500]
        print(f"sb {method} {path}: {e.code} {msg}", file=sys.stderr)
        return e.code, None


def sb_upsert(table: str, rows: list[dict], on_conflict: str) -> int:
    if not rows:
        return 0
    status, _ = sb_request(
        f"{table}?on_conflict={urllib.parse.quote(on_conflict)}",
        method="POST",
        body=json.dumps(rows).encode(),
        prefer="resolution=merge-duplicates,return=minimal",
    )
    return status


def sb_select(table: str, query: str):
    status, data = sb_request(f"{table}?{query}")
    return data if status and status < 300 and isinstance(data, list) else []


def rate_for_model(model: str):
    m = (model or "").lower()
    for k, v in MODEL_RATES.items():
        if k != "default" and k in m:
            return v
    return MODEL_RATES["default"]


def sync_agents_from_profiles_and_erp():
    erp_agents = erp_list(
        "LSH Agent",
        [
            "name", "slug", "agent_name", "role", "description", "status", "model", "platform",
            "color", "icon", "current_task", "current_task_since", "last_action_at",
            "last_action_summary", "last_heartbeat_at", "health_score", "settings", "stats", "enabled",
        ],
        limit=50,
    )
    by_slug = {}
    for a in erp_agents:
        slug = a.get("slug") or a.get("name")
        if slug == "hermes":
            slug = "maestro"
        by_slug[slug] = a

    profiles = []
    if PROFILES_DIR.is_dir():
        profiles = sorted(p.name for p in PROFILES_DIR.iterdir() if p.is_dir() and not p.name.startswith("."))

    rows = []
    now = iso_now()
    seen = set()
    for slug in sorted(set(list(by_slug.keys()) + profiles + list(FLEET_META.keys()))):
        if slug in ("default",):
            continue
        meta = FLEET_META.get(slug)
        erp = by_slug.get(slug) or {}
        name = erp.get("agent_name") or (meta[0] if meta else slug.title())
        role = erp.get("role") or (meta[1] if meta else "Agent")
        local = meta[2] if meta else True
        hb = erp.get("last_heartbeat_at") or erp.get("last_action_at")
        settings = erp.get("settings") or {}
        if isinstance(settings, str):
            try:
                settings = json.loads(settings)
            except Exception:
                settings = {}
        if not isinstance(settings, dict):
            settings = {}
        settings["local"] = local
        settings["hermes_profile"] = "simone" if slug == "maestro" and "simone" in profiles else slug

        display_slug = "melena" if slug == "melana" else slug
        if display_slug in seen:
            continue
        seen.add(display_slug)

        stats = erp.get("stats") if isinstance(erp.get("stats"), dict) else {}
        rows.append(
            {
                "slug": display_slug,
                "name": "Melena" if display_slug == "melena" else name,
                "role": role,
                "description": erp.get("description") or "",
                "status": erp.get("status") or "idle",
                "model": erp.get("model") or "",
                "platform": erp.get("platform") or ("hermes" if local else "cloud"),
                "color": erp.get("color") or "#B08D57",
                "icon": erp.get("icon") or "bot",
                "current_task": erp.get("current_task"),
                "current_task_since": erp.get("current_task_since"),
                "last_action_at": erp.get("last_action_at") or hb,
                "last_action_summary": erp.get("last_action_summary"),
                "last_heartbeat_at": hb,
                "health_score": erp.get("health_score") if erp.get("health_score") is not None else 70,
                "settings": settings,
                "stats": stats,
                "enabled": bool(erp.get("enabled", 1)),
                "updated_at": now,
            }
        )
    print(f"agents rows={len(rows)}")
    if APPLY:
        print("agents upsert", sb_upsert("agents", rows, "slug"))
    return rows


def sync_activity_feed():
    now = iso_now()
    feed = []

    events = erp_list(
        "LSH Agent Event",
        ["name", "agent_slug", "event_type", "title", "body", "severity", "creation"],
        limit=500,
        order_by="creation desc",
    )
    for r in events:
        slug = r.get("agent_slug") or "unknown"
        if slug == "hermes":
            slug = "maestro"
        feed.append(
            {
                "source": "erp_event",
                "agent_slug": slug,
                "kind": r.get("event_type") or "event",
                "title": r.get("title") or r.get("event_type") or "event",
                "body": r.get("body"),
                "severity": r.get("severity") or "info",
                "ref": r.get("name"),
                "metadata": {},
                "occurred_at": r.get("creation"),
                "snapshot_at": now,
            }
        )

    cards = sb_select(
        "kanban_snapshot",
        "select=task_id,title,assignee,status,last_failure_error,result_summary,completed_at,updated_at,snapshot_at&limit=200",
    )
    for c in cards:
        ts = c.get("completed_at") or c.get("updated_at") or c.get("snapshot_at") or now
        feed.append(
            {
                "source": "kanban",
                "agent_slug": c.get("assignee"),
                "kind": "kanban_done" if c.get("status") == "done" else f"kanban_{c.get('status')}",
                "title": c.get("title") or c.get("task_id"),
                "body": c.get("result_summary") or c.get("last_failure_error"),
                "severity": "error" if c.get("last_failure_error") else "info",
                "ref": c.get("task_id"),
                "metadata": {"status": c.get("status")},
                "occurred_at": ts,
                "snapshot_at": now,
            }
        )

    crons = sb_select(
        "cron_health",
        "select=profile,job_id,job_name,health_color,last_status,last_error,last_run_at,snapshot_at&or=(health_color.eq.red,health_color.eq.amber)&limit=120",
    )
    for j in crons:
        feed.append(
            {
                "source": "cron_health",
                "agent_slug": j.get("profile"),
                "kind": "cron_" + (j.get("health_color") or "amber"),
                "title": j.get("job_name") or j.get("job_id"),
                "body": j.get("last_error") or j.get("last_status"),
                "severity": "error" if j.get("health_color") == "red" else "warning",
                "ref": f"{j.get('profile')}:{j.get('job_id')}",
                "metadata": {"health": j.get("health_color"), "last_status": j.get("last_status")},
                "occurred_at": j.get("last_run_at") or j.get("snapshot_at") or now,
                "snapshot_at": now,
            }
        )

    # drop null refs
    feed = [f for f in feed if f.get("ref") and f.get("occurred_at")]
    print(f"activity_feed rows={len(feed)}")
    if APPLY and feed:
        print("activity_feed upsert", sb_upsert("activity_feed", feed, "source,ref"))
    return feed


def sync_costs_from_hermes(days=14):
    if not PROFILES_DIR.is_dir():
        return []
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    buckets: dict[tuple[str, str, str], dict] = {}
    for profile in sorted(p.name for p in PROFILES_DIR.iterdir() if p.is_dir()):
        db = PROFILES_DIR / profile / "state.db"
        if not db.is_file():
            continue
        slug = "melena" if profile == "melana" else profile
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            con.row_factory = sqlite3.Row
            rows = con.execute(
                """
                select s.model as model,
                       date(m.timestamp, 'unixepoch') as day,
                       sum(case when ifnull(m.token_count,0)>0 then m.token_count
                                else cast(length(ifnull(m.content,''))/4 as int) end) as tokens,
                       sum(case when m.role='assistant' then
                                case when ifnull(m.token_count,0)>0 then m.token_count
                                     else cast(length(ifnull(m.content,''))/4 as int) end
                           else 0 end) as out_tok,
                       sum(case when m.role!='assistant' then
                                case when ifnull(m.token_count,0)>0 then m.token_count
                                     else cast(length(ifnull(m.content,''))/4 as int) end
                           else 0 end) as in_tok
                from messages m
                join sessions s on s.id = m.session_id
                where m.timestamp >= ?
                group by 1,2
                """,
                (cutoff.timestamp(),),
            ).fetchall()
            con.close()
        except Exception as e:
            print(f"cost {profile}: {e}")
            continue
        for r in rows:
            model = r["model"] or "unknown"
            day = r["day"]
            if not day:
                continue
            in_t = int(r["in_tok"] or 0)
            out_t = int(r["out_tok"] or 0)
            if in_t + out_t == 0 and r["tokens"]:
                total = int(r["tokens"])
                in_t, out_t = int(total * 0.4), int(total * 0.6)
            ri, ro = rate_for_model(model)
            cost = (in_t / 1_000_000.0) * ri + (out_t / 1_000_000.0) * ro
            key = (slug, day, model)
            b = buckets.get(key) or {
                "agent_slug": slug,
                "day": day,
                "model": model,
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0.0,
            }
            b["input_tokens"] += in_t
            b["output_tokens"] += out_t
            b["cost_usd"] = float(b["cost_usd"]) + cost
            buckets[key] = b
    out = list(buckets.values())
    for o in out:
        o["cost_usd"] = round(float(o["cost_usd"]), 6)
    print(f"cost rows={len(out)}")
    if APPLY and out:
        print("costs upsert", sb_upsert("agent_costs", out, "agent_slug,day,model"))
    return out


def main():
    print("APPLY" if APPLY else "DRY-RUN", "hermes_home", HERMES_HOME)
    agents = sync_agents_from_profiles_and_erp()
    feed = sync_activity_feed()
    costs = sync_costs_from_hermes()
    print(
        json.dumps(
            {
                "agents": len(agents),
                "activity": len(feed),
                "costs": len(costs),
                "sample_agents": [a["slug"] for a in agents[:20]],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
