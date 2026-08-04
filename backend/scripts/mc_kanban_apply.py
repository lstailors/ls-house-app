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

    # SPEC 069 chat_run — one-shot agent command. target = Hermes profile slug.
    if action in ("chat_send", "send") and (
        payload.get("kind") == "chat_run" or action == "chat_send"
    ):
        return apply_chat_send(cmd, payload)

    if action == "promote":
        code, out = hermes_kanban("promote", tid)
    elif action == "block":
        reason = str(payload.get("reason") or "blocked from Mission Control")
        code, out = hermes_kanban("block", tid, "--reason", reason)
    elif action == "unblock":
        code, out = hermes_kanban("unblock", tid)
    elif action == "complete":
        code, out = hermes_kanban(
            "complete", tid, "--summary", str(payload.get("summary") or "Completed from Mission Control")
        )
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


def apply_chat_send(cmd: dict, payload: dict) -> tuple[bool, str]:
    """Run a one-shot hermes chat against the target profile; write result into payload."""
    slug = str(payload.get("agent_slug") or cmd.get("task_id") or "").strip()
    prompt = str(payload.get("prompt") or payload.get("command") or "").strip()
    if not slug or not prompt:
        return False, "chat_send missing agent_slug/prompt"

    # Honour user cancel before we start
    if payload.get("cancelled_by_user"):
        return False, "cancelled before start"

    timeout_s = int(payload.get("timeout_s") or 180)
    timeout_s = max(30, min(timeout_s, 600))

    # Flip to leased/running with session/pid placeholders so the UI run card lights up
    started = __import__("datetime").datetime.utcnow().isoformat() + "Z"
    running_payload = {
        **payload,
        "started_at": started,
        "session_id": payload.get("session_id") or f"sess_{cmd['id'][:8]}",
        "pid": os.getpid(),
    }
    sb(
        f"kanban_commands?id=eq.{cmd['id']}",
        method="PATCH",
        body={"status": "leased", "payload": running_payload},
    )

    # Re-check cancel
    st, rows = sb(f"kanban_commands?id=eq.{cmd['id']}&select=status,payload")
    if st < 300 and isinstance(rows, list) and rows:
        cur = rows[0]
        if cur.get("status") == "cancelled":
            return False, "cancelled"
        p2 = cur.get("payload") or {}
        if isinstance(p2, str):
            try:
                p2 = json.loads(p2)
            except Exception:
                p2 = {}
        if p2.get("cancelled_by_user"):
            return False, "cancelled"

    env = os.environ.copy()
    home = Path.home() / ".hermes"
    env["HERMES_HOME"] = str(home)
    try:
        r = subprocess.run(
            ["hermes", "-p", slug, "chat", "-q", prompt],
            capture_output=True,
            text=True,
            env=env,
            timeout=timeout_s,
        )
        out = ((r.stdout or "") + (r.stderr or "")).strip()
        # Truncate huge agent dumps for the UI result pane
        if len(out) > 12000:
            out = out[:12000] + "\n…[truncated]"
        ok = r.returncode == 0
        final_payload = {
            **running_payload,
            "result": out or ("(ok)" if ok else "(no output)"),
            "format": "code" if ("\n" in out or len(out) > 400) else "prose",
            "finished_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
            "pid": os.getpid(),
        }
        # Write result onto payload; main() will set status applied/failed
        sb(
            f"kanban_commands?id=eq.{cmd['id']}",
            method="PATCH",
            body={"payload": final_payload},
        )
        return ok, out[-400:] if out else ("ok" if ok else "empty")
    except subprocess.TimeoutExpired:
        final_payload = {
            **running_payload,
            "result": None,
            "error": f"timed out after {timeout_s}s",
            "ui_timeout": True,
            "finished_at": __import__("datetime").datetime.utcnow().isoformat() + "Z",
        }
        sb(
            f"kanban_commands?id=eq.{cmd['id']}",
            method="PATCH",
            body={"payload": final_payload, "status": "failed", "error": f"timed out after {timeout_s}s"},
        )
        return False, f"timed out after {timeout_s}s"
    except Exception as e:
        return False, str(e)[:400]


def main():
    status, rows = sb(
        "kanban_commands?status=in.(pending)&order=created_at.asc&limit=30",
    )
    if status >= 300 or not isinstance(rows, list):
        print("fetch pending", status, rows)
        return 1 if status >= 400 else 0
    print(f"pending={len(rows)}")
    for cmd in rows:
        # Skip if already cancelled mid-queue
        if cmd.get("status") == "cancelled":
            continue
        ok, detail = apply_one(cmd)
        # If apply_chat_send already terminalized timeout, don't overwrite
        st_check, cur_rows = sb(f"kanban_commands?id=eq.{cmd['id']}&select=status,payload")
        cur_status = None
        cur_payload = {}
        if st_check < 300 and isinstance(cur_rows, list) and cur_rows:
            cur_status = cur_rows[0].get("status")
            cur_payload = cur_rows[0].get("payload") or {}
            if isinstance(cur_payload, str):
                try:
                    cur_payload = json.loads(cur_payload)
                except Exception:
                    cur_payload = {}
        if cur_status == "cancelled" or cur_payload.get("cancelled_by_user"):
            print(cmd["id"], cmd["action"], cmd["task_id"], "cancelled")
            continue
        if cur_payload.get("ui_timeout") and cur_status == "failed":
            print(cmd["id"], cmd["action"], cmd["task_id"], "timeout")
            continue

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
        print(
            cmd["id"],
            cmd["action"],
            cmd["task_id"],
            "ok" if ok else "FAIL",
            st,
            detail[:120].replace("\n", " "),
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
