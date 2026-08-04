#!/usr/bin/env python3
"""Apply pending lsh.mc_commands (SPEC 066) — kanban, cron, chat_run.

chat_run uses Hermes one-shot `-z` dispatch (ls-house-agent-fleet S7):
  - probe alias first is the caller's job for cold starts
  - NO double-backgrounding (no trailing shell `&` with tracked sessions)
  - capture pid into payload; write result back on completion
  - honor cancelled status mid-flight when possible
"""
from __future__ import annotations

import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

UA = "Mozilla/5.0 (compatible; L&S-MC-CommandsApply/1.0)"
WORKER_ID = f"mc-apply@{os.getpid()}"
LEASE_SECONDS = 90
CHAT_TIMEOUT_S = int(os.environ.get("MC_CHAT_TIMEOUT_S", "180"))
MAX_RETRIES = 3

# Profile slugs that have a hermes alias / -p profile on Studio
HERMES_PROFILES = {
    "maestro",
    "simone",
    "sofia",
    "mia",
    "melena",
    "marco",
    "filo",
    "rocco",
    "lucia",
    "la-penna",
    "paperclip",
}


def kc(service: str, account: str | None = None) -> str:
    cmd = ["security", "find-generic-password", "-s", service, "-w"]
    if account:
        cmd = ["security", "find-generic-password", "-s", service, "-a", account, "-w"]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def supabase():
    url = (os.environ.get("SUPABASE_URL") or kc("openclaw-supabase-url") or "").rstrip("/").replace("\\n", "").strip()
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or kc("openclaw-supabase-service-key")
        or kc("openclaw-supabase-key")
        or ""
    ).replace("\\n", "").strip()
    if not url or len(key) < 80:
        raise SystemExit("supabase creds missing")
    return url, key


def sb(path: str, method="GET", body=None, extra_headers=None):
    url, key = supabase()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": "lsh",
        "Content-Profile": "lsh",
        "User-Agent": UA,
    }
    if extra_headers:
        headers.update(extra_headers)
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(f"{url}/rest/v1/{path}", data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:600]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def parse_payload(raw) -> dict:
    if isinstance(raw, dict):
        return dict(raw)
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return {}
    return {}


def hermes_kanban(*args: str) -> tuple[int, str]:
    env = os.environ.copy()
    env["HERMES_HOME"] = str(Path.home() / ".hermes")
    r = subprocess.run(
        ["hermes", "kanban", *args],
        capture_output=True,
        text=True,
        env=env,
        timeout=120,
    )
    out = (r.stdout or "") + (r.stderr or "")
    return r.returncode, out[-800:]


def is_cancelled(cmd_id: str) -> bool:
    st, rows = sb(f"mc_commands?id=eq.{cmd_id}&select=status")
    if st >= 300 or not isinstance(rows, list) or not rows:
        return False
    return rows[0].get("status") == "cancelled"


def patch_cmd(cmd_id: str, body: dict) -> None:
    sb(f"mc_commands?id=eq.{cmd_id}", method="PATCH", body=body)


def claim_batch(limit: int = 30) -> list[dict]:
    """Best-effort claim without RPC: select pending rows, then PATCH lease."""
    st, rows = sb(f"mc_commands?status=eq.pending&order=created_at.asc&limit={limit}")
    if st == 404:
        print("mc_commands table missing (404) — apply migration_009_mc_commands.sql")
        return []
    if st >= 300 or not isinstance(rows, list):
        print("fetch pending", st, rows)
        return []

    claimed: list[dict] = []
    lease_exp = datetime.fromtimestamp(
        time.time() + LEASE_SECONDS, tz=timezone.utc
    ).isoformat().replace("+00:00", "Z")
    body = {
        "status": "leased",
        "leased_by": WORKER_ID,
        "leased_at": now_iso(),
        "lease_expires_at": lease_exp,
    }
    for row in rows:
        cid = row["id"]
        patch_cmd(cid, body)
        st3, got = sb(f"mc_commands?id=eq.{cid}&select=*")
        if st3 < 300 and isinstance(got, list) and got and got[0].get("leased_by") == WORKER_ID:
            claimed.append(got[0])
    return claimed


def apply_kanban_or_cron(cmd: dict) -> tuple[bool, str, dict]:
    action = cmd["action"]
    tid = cmd["target_id"]
    payload = parse_payload(cmd.get("payload"))

    if action in ("cron_enable", "cron_disable"):
        if ":" not in tid:
            return False, "bad cron id", payload
        profile, job_id = tid.split(":", 1)
        sub = "resume" if action == "cron_enable" else "pause"
        r = subprocess.run(
            ["hermes", "-p", profile, "cron", sub, job_id],
            capture_output=True,
            text=True,
            timeout=60,
        )
        out = (r.stdout or "") + (r.stderr or "")
        return r.returncode == 0, out[-400:], payload

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
        return False, f"unsupported action {action}", payload
    return code == 0, out, payload


def apply_chat_run(cmd: dict) -> tuple[bool, str, dict, bool]:
    """Returns (ok, detail, payload, timed_out)."""
    slug = cmd["target_id"]
    payload = parse_payload(cmd.get("payload"))
    prompt = str(payload.get("prompt") or "").strip()
    if not prompt:
        return False, "missing prompt", payload, False
    if slug not in HERMES_PROFILES:
        # still try — profile may exist even if not listed
        pass

    if is_cancelled(cmd["id"]):
        return False, "cancelled", payload, False

    # Pass prompt as argv (no shell, no double-bg, no $(cat) login-shell trap)
    argv = ["hermes", "-p", slug, "--yolo", "-z", prompt]
    env = os.environ.copy()
    env["HERMES_HOME"] = str(Path.home() / ".hermes")

    log_path = Path(tempfile.gettempdir()) / f"mc_chat_{cmd['id']}.log"
    log_f = open(log_path, "w", encoding="utf-8")
    # Single background mechanism: Popen only (no shell &)
    proc = subprocess.Popen(
        argv,
        stdout=log_f,
        stderr=subprocess.STDOUT,
        text=True,
        env=env,
        start_new_session=True,  # own process group for cancel
    )
    payload["pid"] = proc.pid
    payload["session_id"] = payload.get("session_id") or f"run_{cmd['id'][:8]}"
    payload["started_at"] = now_iso()
    payload["log_path"] = str(log_path)
    patch_cmd(cmd["id"], {"payload": payload})

    deadline = time.time() + CHAT_TIMEOUT_S
    timed_out = False
    while True:
        if is_cancelled(cmd["id"]):
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
            try:
                proc.wait(timeout=5)
            except Exception:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except Exception:
                    pass
            log_f.close()
            return False, "cancelled", payload, False

        rc = proc.poll()
        if rc is not None:
            break
        if time.time() >= deadline:
            timed_out = True
            try:
                os.killpg(proc.pid, signal.SIGTERM)
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
            try:
                proc.wait(timeout=8)
            except Exception:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except Exception:
                    pass
            break
        time.sleep(1.0)

    log_f.close()
    try:
        result_text = log_path.read_text(encoding="utf-8", errors="replace")[-12000:]
    except Exception:
        result_text = ""

    payload["finished_at"] = now_iso()
    if timed_out:
        payload["timed_out"] = True
        payload["result"] = result_text.strip() or None
        return False, f"No response after {CHAT_TIMEOUT_S}s", payload, True

    rc = proc.returncode if proc.returncode is not None else 1
    payload["exit_code"] = rc
    payload["result"] = result_text.strip()
    # Heuristic format hint
    body = result_text.strip()
    if body.startswith("{") or body.startswith("[") or "\n  " in body or "error:" in body.lower():
        payload["format"] = "code"
    else:
        payload["format"] = "text" if len(body) < 400 and "\n" not in body[:80] else "code"

    if rc != 0 and not body:
        return False, f"hermes exit {rc}", payload, False
    return True, body[-400:] if body else "ok", payload, False


def apply_one(cmd: dict) -> None:
    cid = cmd["id"]
    kind = cmd.get("kind") or ""
    action = cmd.get("action") or ""
    retries = int(cmd.get("retry_count") or 0)

    if cmd.get("status") == "cancelled" or is_cancelled(cid):
        print(cid, "already cancelled")
        return

    ok = False
    detail = ""
    payload = parse_payload(cmd.get("payload"))
    timed_out = False

    try:
        if kind == "chat_run" and action == "send":
            ok, detail, payload, timed_out = apply_chat_run(cmd)
            if detail == "cancelled" or is_cancelled(cid):
                patch_cmd(cid, {"status": "cancelled", "payload": payload, "error": None})
                print(cid, "chat_run cancelled")
                return
        elif kind in ("kanban_task", "cron_job") or action in (
            "promote",
            "block",
            "unblock",
            "complete",
            "archive",
            "schedule",
            "assign",
            "comment",
            "cron_enable",
            "cron_disable",
        ):
            ok, detail, payload = apply_kanban_or_cron(cmd)
        else:
            ok, detail = False, f"unsupported kind/action {kind}/{action}"
    except subprocess.TimeoutExpired:
        ok, detail, timed_out = False, "subprocess timeout", True
    except Exception as e:
        ok, detail = False, str(e)[:400]

    if ok:
        patch_cmd(
            cid,
            {
                "status": "applied",
                "error": None,
                "applied_at": now_iso(),
                "payload": payload,
                "leased_by": WORKER_ID,
            },
        )
        print(cid, kind, action, "ok")
        return

    # failed / timeout
    err = (detail or "failed")[:400]
    if timed_out:
        payload["timed_out"] = True
    new_retry = retries  # only bump on explicit UI retry (status reset to pending)
    patch_cmd(
        cid,
        {
            "status": "failed",
            "error": err,
            "applied_at": now_iso(),
            "payload": payload,
            "retry_count": new_retry,
        },
    )
    print(cid, kind, action, "FAIL", err[:120].replace("\n", " "))


def main() -> int:
    claimed = claim_batch(20)
    print(f"claimed={len(claimed)} worker={WORKER_ID}")
    for cmd in claimed:
        apply_one(cmd)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
