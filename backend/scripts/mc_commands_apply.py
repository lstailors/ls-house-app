#!/usr/bin/env python3
"""Apply pending lsh.mc_commands via Hermes primitives (SPEC 066).

Claims with lsh.mc_commands_claim (FOR UPDATE SKIP LOCKED), then dispatches:
  kanban_task  — hermes kanban CLI
  cron_job     — hermes -p <profile> cron pause|resume
  fleet_agent  — gateway restart / config set model / fallback
  chat_run     — hermes -p <profile> -z <prompt> (oneshot)
  approval     — best-effort approval_queue status (CONFLICT #2 still open)

Quiet-ok: empty stdout when nothing pending / all applied.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

UA = "Mozilla/5.0 (compatible; L&S-MC-CommandsApply/1.0)"
MAX_ERROR = 400
LEASE_SECONDS = 90
BATCH = 30
RETRY_CAP = 3

# Resolve fleet root even if HERMES_HOME points at a profile dir
_HERMES_RAW = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes")).expanduser().resolve()
if _HERMES_RAW.parent.name == "profiles":
    HERMES_HOME = _HERMES_RAW.parent.parent
elif (_HERMES_RAW / "profiles").is_dir():
    HERMES_HOME = _HERMES_RAW
else:
    HERMES_HOME = Path.home() / ".hermes"

WORKER_ID = os.environ.get("MC_WORKER_ID") or f"{os.getpid()}@{socket.gethostname()}"


def kc(service: str, account: str | None = None) -> str:
    cmd = ["security", "find-generic-password", "-s", service, "-w"]
    if account:
        cmd = ["security", "find-generic-password", "-s", service, "-a", account, "-w"]
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()


def supabase() -> tuple[str, str]:
    url = (os.environ.get("SUPABASE_URL") or kc("openclaw-supabase-url") or "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or kc("openclaw-supabase-service-key", "openclaw")
        or kc("openclaw-supabase-service-key")
        or kc("openclaw-supabase-key")
        or ""
    )
    if not url or len(key) < 80:
        raise SystemExit("supabase creds missing")
    return url, key


def sb(path: str, method: str = "GET", body=None, prefer: str | None = None):
    url, key = supabase()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Accept-Profile": "lsh",
        "Content-Profile": "lsh",
        "User-Agent": UA,
    }
    if prefer:
        headers["Prefer"] = prefer
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
        return e.code, e.read().decode()[:MAX_ERROR]


def sb_rpc(fn: str, args: dict):
    """Call a PostgREST RPC in the lsh schema."""
    url, key = supabase()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Profile": "lsh",
        "Content-Type": "application/json",
        "User-Agent": UA,
    }
    # Prefer schema-qualified via Accept-Profile + /rpc/
    headers["Accept-Profile"] = "lsh"
    req = urllib.request.Request(
        f"{url}/rest/v1/rpc/{fn}",
        data=json.dumps(args).encode(),
        method="POST",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            raw = resp.read().decode()
            return resp.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:800]


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def hermes_env() -> dict:
    env = os.environ.copy()
    env["HERMES_HOME"] = str(HERMES_HOME)
    # avoid interactive prompts
    env.setdefault("HERMES_ACCEPT_HOOKS", "1")
    return env


def run_cmd(argv: list[str], timeout: int = 120) -> tuple[int, str]:
    r = subprocess.run(argv, capture_output=True, text=True, env=hermes_env(), timeout=timeout)
    out = ((r.stdout or "") + (r.stderr or "")).strip()
    return r.returncode, out[-800:]


def hermes_kanban(*args: str) -> tuple[int, str]:
    return run_cmd(["hermes", "kanban", *args], timeout=120)


def parse_payload(cmd: dict) -> dict:
    payload = cmd.get("payload") or {}
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except Exception:
            payload = {}
    return payload if isinstance(payload, dict) else {}


def apply_kanban(cmd: dict, payload: dict) -> tuple[bool, str]:
    tid = cmd["target_id"]
    action = cmd["action"]
    if action == "promote":
        code, out = hermes_kanban("promote", tid)
    elif action == "block":
        reason = str(payload.get("reason") or "blocked from Mission Control")
        code, out = hermes_kanban("block", tid, "--reason", reason)
    elif action == "unblock":
        code, out = hermes_kanban("unblock", tid)
    elif action == "complete":
        code, out = hermes_kanban(
            "complete",
            tid,
            "--summary",
            str(payload.get("summary") or "Completed from Mission Control"),
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
        return False, f"unsupported kanban action {action}"
    return code == 0, out


def apply_cron(cmd: dict, payload: dict) -> tuple[bool, str]:
    tid = cmd["target_id"]
    action = cmd["action"]
    # target_id is profile:job_id (preferred); payload.job may mirror
    job_ref = tid if ":" in tid else str(payload.get("job") or "")
    if ":" not in job_ref:
        return False, "bad cron id (want profile:job_id)"
    profile, job_id = job_ref.split(":", 1)
    if action == "cron_enable":
        sub = "resume"
    elif action == "cron_disable":
        sub = "pause"
    else:
        return False, f"unsupported cron action {action}"
    code, out = run_cmd(["hermes", "-p", profile, "cron", sub, job_id], timeout=60)
    return code == 0, out


def apply_fleet(cmd: dict, payload: dict) -> tuple[bool, str]:
    profile = cmd["target_id"].strip()
    action = cmd["action"]
    if not profile:
        return False, "empty fleet profile"
    if action == "restart":
        # Preferred: hermes gateway restart for the profile.
        # Fallback: launchctl kickstart the ai.hermes.gateway-<profile> agent.
        code, out = run_cmd(["hermes", "-p", profile, "gateway", "restart"], timeout=90)
        if code == 0:
            return True, out or "gateway restart ok"
        # Workaround: unload/load LaunchAgent if CLI restart flaked
        label = f"ai.hermes.gateway-{profile}"
        plist = Path.home() / "Library/LaunchAgents" / f"{label}.plist"
        if plist.is_file():
            c2, o2 = run_cmd(["launchctl", "kickstart", "-k", f"gui/{os.getuid()}/{label}"], timeout=60)
            if c2 != 0:
                # bootout + bootstrap
                run_cmd(["launchctl", "bootout", f"gui/{os.getuid()}", str(plist)], timeout=30)
                time.sleep(1)
                c3, o3 = run_cmd(
                    ["launchctl", "bootstrap", f"gui/{os.getuid()}", str(plist)],
                    timeout=30,
                )
                return c3 == 0, (out + "\n" + o2 + "\n" + o3)[-MAX_ERROR:]
            return True, (out + "\n" + o2)[-MAX_ERROR:]
        return False, out or "gateway restart failed (no launchagent)"
    if action == "set_model":
        model = str(payload.get("model") or "").strip()
        if not model:
            return False, "payload.model required"
        # nested key via hermes config set
        code, out = run_cmd(["hermes", "-p", profile, "config", "set", "model.default", model], timeout=60)
        if code != 0:
            # alternate key shape
            code, out = run_cmd(["hermes", "-p", profile, "config", "set", "model", model], timeout=60)
        return code == 0, out
    if action == "set_fallback_model":
        model = str(payload.get("model") or "").strip()
        provider = str(payload.get("provider") or "").strip()
        if not model:
            return False, "payload.model required for set_fallback_model"
        # Non-interactive: write fallback_providers[0] via python yaml if CLI is interactive
        cfg_path = HERMES_HOME / "profiles" / profile / "config.yaml"
        if not cfg_path.is_file():
            return False, f"no config for profile {profile}"
        try:
            import yaml  # type: ignore
        except ImportError:
            yaml = None
        if yaml is None:
            return False, "pyyaml missing for set_fallback_model"
        data = yaml.safe_load(cfg_path.read_text()) or {}
        entry: dict = {"model": model}
        if provider:
            entry["provider"] = provider
        # payload.fallback true (SPEC) means write fallback chain; false could mean primary — already handled by set_model
        fb = data.get("fallback_providers")
        if not isinstance(fb, list):
            fb = []
        if fb:
            fb[0] = {**(fb[0] if isinstance(fb[0], dict) else {}), **entry}
        else:
            fb = [entry]
        data["fallback_providers"] = fb
        cfg_path.write_text(yaml.safe_dump(data, default_flow_style=False, sort_keys=False))
        return True, f"fallback_providers[0]={entry}"
    return False, f"unsupported fleet action {action}"


def apply_chat(cmd: dict, payload: dict) -> tuple[bool, str, dict | None]:
    profile = cmd["target_id"].strip()
    prompt = str(payload.get("prompt") or "").strip()
    if not profile or not prompt:
        return False, "chat_run needs target_id=profile and payload.prompt", None
    # oneshot -z; quiet-ish. Long timeout — agent runs can take minutes; lease is 90s so
    # overlapping ticks skip this row via SKIP LOCKED until we finish and mark applied.
    code, out = run_cmd(["hermes", "-p", profile, "-z", prompt], timeout=600)
    result = {"result": out[-2000:] if out else "", "exit_code": code}
    return code == 0, out[-MAX_ERROR:], result


def apply_approval(cmd: dict, payload: dict) -> tuple[bool, str]:
    """Best-effort until SPEC 065 CONFLICT #2 (approval SoT) is resolved."""
    action = cmd["action"]
    target = cmd["target_id"]
    note = str(payload.get("note") or "")
    if action not in ("approve", "reject", "edit"):
        return False, f"unsupported approval action {action}"
    # Try lsh.approval_queue then public.approval_queue
    status_map = {"approve": "approved", "reject": "rejected", "edit": "edited"}
    new_status = status_map[action]
    body = {"status": new_status, "decision_note": note or None, "decided_at": now_iso()}
    # strip Nones
    body = {k: v for k, v in body.items() if v is not None}
    st, resp = sb(f"approval_queue?id=eq.{urllib.parse.quote(str(target))}", method="PATCH", body=body)
    if st < 300:
        return True, f"lsh.approval_queue → {new_status}"
    # public schema
    url, key = supabase()
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
        "User-Agent": UA,
    }
    req = urllib.request.Request(
        f"{url}/rest/v1/approval_queue?id=eq.{urllib.parse.quote(str(target))}",
        data=json.dumps(body).encode(),
        method="PATCH",
        headers=headers,
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return True, f"public.approval_queue → {new_status} ({r.status})"
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:200]
        return (
            False,
            f"approval SoT unresolved (CONFLICT #2); lsh={st}/{resp}; public={e.code}/{err}",
        )


def apply_one(cmd: dict) -> tuple[bool, str, dict | None]:
    kind = cmd.get("kind") or ""
    payload = parse_payload(cmd)
    # Back-compat: old kanban_commands rows had no kind — infer
    if not kind:
        action = cmd.get("action") or ""
        if action in ("cron_enable", "cron_disable"):
            kind = "cron_job"
        else:
            kind = "kanban_task"
        # also accept task_id column if present
        if not cmd.get("target_id") and cmd.get("task_id"):
            cmd = {**cmd, "target_id": cmd["task_id"]}

    if kind == "kanban_task":
        ok, detail = apply_kanban(cmd, payload)
        return ok, detail, None
    if kind == "cron_job":
        ok, detail = apply_cron(cmd, payload)
        return ok, detail, None
    if kind == "fleet_agent":
        ok, detail = apply_fleet(cmd, payload)
        return ok, detail, None
    if kind == "chat_run":
        return apply_chat(cmd, payload)
    if kind == "approval":
        ok, detail = apply_approval(cmd, payload)
        return ok, detail, None
    return False, f"unknown kind {kind}", None


def mark_done(cmd_id: str, ok: bool, detail: str, extra_payload: dict | None = None, cmd: dict | None = None):
    patch: dict = {
        "status": "applied" if ok else "failed",
        "error": None if ok else (detail or "failed")[:MAX_ERROR],
        "applied_at": now_iso() if ok else None,
        "leased_by": WORKER_ID if ok else cmd.get("leased_by") if cmd else WORKER_ID,
    }
    if ok:
        patch["lease_expires_at"] = None
    if extra_payload and cmd is not None:
        # merge result into payload for chat_run
        base = parse_payload(cmd)
        base.update(extra_payload)
        patch["payload"] = base
    st, resp = sb(f"mc_commands?id=eq.{cmd_id}", method="PATCH", body=patch)
    return st, resp


def claim_batch() -> list[dict]:
    st, rows = sb_rpc(
        "mc_commands_claim",
        {"p_worker": WORKER_ID, "p_limit": BATCH, "p_lease_seconds": LEASE_SECONDS},
    )
    if st >= 300:
        # Fallback without RPC: sequential pending fetch + optimistic lease patch
        # (race-prone — only if RPC missing during rollout)
        print(f"claim_rpc_fail {st} {rows}", file=sys.stderr)
        st2, pending = sb(
            "mc_commands?or=(status.eq.pending,and(status.eq.leased,lease_expires_at.lt."
            + urllib.parse.quote(now_iso())
            + "))&order=created_at.asc&limit=30"
        )
        if st2 >= 300 or not isinstance(pending, list):
            print(f"claim_fallback_fail {st2} {pending}", file=sys.stderr)
            return []
        claimed = []
        for row in pending:
            if int(row.get("retry_count") or 0) > RETRY_CAP:
                continue
            lease_body = {
                "status": "leased",
                "leased_by": WORKER_ID,
                "leased_at": now_iso(),
                "lease_expires_at": datetime.fromtimestamp(
                    time.time() + LEASE_SECONDS, tz=timezone.utc
                ).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3]
                + "Z",
            }
            st3, _ = sb(f"mc_commands?id=eq.{row['id']}&status=eq.{row['status']}", method="PATCH", body=lease_body)
            if st3 < 300:
                claimed.append({**row, **lease_body})
        return claimed
    if not rows:
        return []
    if isinstance(rows, dict):
        return [rows]
    return rows if isinstance(rows, list) else []


def main() -> int:
    quiet = "--quiet-ok" in sys.argv
    try:
        rows = claim_batch()
    except SystemExit:
        raise
    except Exception as e:
        print(f"claim_error {e}", file=sys.stderr)
        return 1

    if not rows:
        if not quiet:
            print("pending=0")
        return 0

    if not quiet:
        print(f"claimed={len(rows)} worker={WORKER_ID}")

    failed = 0
    for cmd in rows:
        cid = cmd["id"]
        try:
            ok, detail, extra = apply_one(cmd)
        except subprocess.TimeoutExpired:
            ok, detail, extra = False, "timeout", None
        except Exception as e:
            ok, detail, extra = False, f"exc: {e}"[:MAX_ERROR], None
        st, _ = mark_done(cid, ok, detail, extra, cmd)
        line = (
            f"{cid} {cmd.get('kind')} {cmd.get('action')} {cmd.get('target_id')} "
            f"{'ok' if ok else 'FAIL'} patch={st} {(detail or '')[:120].replace(chr(10), ' ')}"
        )
        print(line)
        if not ok:
            failed += 1

    return 0 if failed == 0 else 0  # don't fail cron on command failures — they're row-level


if __name__ == "__main__":
    raise SystemExit(main())
