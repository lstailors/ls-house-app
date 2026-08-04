#!/usr/bin/env python3
"""Apply pending lsh.kanban_commands to Hermes kanban CLI."""
from __future__ import annotations

import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = "Mozilla/5.0 (compatible; L&S-MC-KanbanApply/1.0)"


def kc(service: str, account: str | None = None) -> str:
    cmd = ["security", "find-generic-password", "-s", service, "-w"]
    if account:
        cmd = ["security", "find-generic-password", "-s", service, "-a", account, "-w"]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def supabase():
    url = (os.environ.get("SUPABASE_URL") or kc("openclaw-supabase-url") or "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or kc("openclaw-supabase-service-key")
        or kc("openclaw-supabase-key")
        or ""
    )
    if not url or len(key) < 80:
        raise SystemExit("supabase creds missing")
    return url, key


def sb(path: str, method="GET", body=None):
    url, key = supabase()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": "lsh",
        "Content-Profile": "lsh",
        "User-Agent": UA,
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:400]


def hermes_kanban(*args: str) -> tuple[int, str]:
    env = os.environ.copy()
    # ensure fleet-level kanban.db
    home = Path.home() / ".hermes"
    env["HERMES_HOME"] = str(home)
    r = subprocess.run(
        ["hermes", "kanban", *args],
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
    )
    out = (r.stdout or "") + (r.stderr or "")
    return r.returncode, out[-800:]


def apply_one(cmd: dict) -> tuple[bool, str]:
    tid = cmd["task_id"]
    action = cmd["action"]
    payload = cmd.get("payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}

    if action in ("cron_enable", "cron_disable"):
        # Hermes cron pause/resume — id is profile:job_id
        if ":" not in tid:
            return False, "bad cron id"
        profile, job_id = tid.split(":", 1)
        sub = "resume" if action == "cron_enable" else "pause"
        r = subprocess.run(
            ["hermes", "-p", profile, "cron", sub, job_id],
            capture_output=True,
            text=True,
            timeout=60,
        )
        out = (r.stdout or "") + (r.stderr or "")
        return r.returncode == 0, out[-400:]

    if action == "promote":
        code, out = hermes_kanban("promote", tid)
    elif action == "block":
        reason = str(payload.get("reason") or "blocked from Mission Control")
        code, out = hermes_kanban("block", tid, "--reason", reason)
    elif action == "unblock":
        code, out = hermes_kanban("unblock", tid)
    elif action == "complete":
        code, out = hermes_kanban("complete", tid, "--summary", str(payload.get("summary") or "Completed from Mission Control"))
    elif action == "archive":
        code, out = hermes_kanban("archive", tid)
    elif action == "schedule":
        code, out = hermes_kanban("schedule", tid)
    elif action == "assign" and payload.get("assignee"):
        code, out = hermes_kanban("assign", tid, str(payload["assignee"]))
    elif action == "comment" and payload.get("comment"):
        code, out = hermes_kanban("comment", tid, str(payload["comment"]))
    else:
        return False, f"unsupported action {action}"
    return code == 0, out


def main():
    status, rows = sb(
        "kanban_commands?status=eq.pending&order=created_at.asc&limit=30",
    )
    if status >= 300 or not isinstance(rows, list):
        print("fetch pending", status, rows)
        return 1 if status >= 400 else 0
    print(f"pending={len(rows)}")
    for cmd in rows:
        ok, detail = apply_one(cmd)
        patch = {
            "status": "applied" if ok else "failed",
            "error": None if ok else detail[:500],
            "applied_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        }
        st, _ = sb(
            f"kanban_commands?id=eq.{cmd['id']}",
            method="PATCH",
            body=patch,
        )
        print(cmd["id"], cmd["action"], cmd["task_id"], "ok" if ok else "FAIL", st, detail[:120].replace("\n", " "))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
