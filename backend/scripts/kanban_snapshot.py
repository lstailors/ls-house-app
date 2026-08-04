#!/usr/bin/env python3
"""Read Hermes kanban.db → optional Supabase upsert to lsh.kanban_snapshot.

Source of truth (read-only): ~/.hermes/kanban.db
Vercel Edge cannot open this file — Mission Control Board reads the snapshot.

Usage:
  python3 kanban_snapshot.py              # dry-run counts by status
  python3 kanban_snapshot.py --json
  python3 kanban_snapshot.py --apply      # upsert (needs service key)
  python3 kanban_snapshot.py --apply --quiet-ok
"""
from __future__ import annotations

import argparse
import json
import os
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote

HERMES_HOME_ENV = os.environ.get("HERMES_HOME", "")
SUPABASE_URL_SERVICE = "openclaw-supabase-url"
SUPABASE_KEY_SERVICE = "openclaw-supabase-service-key"
SUPABASE_KEY_FALLBACKS = ("openclaw-supabase-key",)

# Keep recently-done cards for History/Board "Done" column (7 days)
DONE_RETENTION_SECONDS = 7 * 24 * 3600


def hermes_root() -> Path:
    candidates: list[Path] = []
    if HERMES_HOME_ENV:
        candidates.append(Path(HERMES_HOME_ENV).expanduser())
    candidates.append(Path.home() / ".hermes")
    for raw in candidates:
        p = raw.resolve()
        parts = list(p.parts)
        if ".hermes" in parts:
            i = parts.index(".hermes")
            return Path(*parts[: i + 1])
        if p.name == ".hermes":
            return p
        if p.parent.name == "profiles" and (p.parent.parent / "kanban.db").exists():
            return p.parent.parent
    return Path.home() / ".hermes"


def kanban_db_path() -> Path:
    env = os.environ.get("HERMES_KANBAN_DB")
    if env:
        return Path(env).expanduser()
    return hermes_root() / "kanban.db"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _ts_to_iso(ts: Any) -> str | None:
    if ts is None or ts == "":
        return None
    try:
        v = float(ts)
    except (TypeError, ValueError):
        return None
    if v > 1e12:
        v /= 1000.0
    return datetime.fromtimestamp(v, tz=timezone.utc).isoformat()


def _keychain(service: str, account: str = "openclaw") -> str:
    r = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return ""
    return (r.stdout or "").strip()


def supabase_client() -> tuple[str, str]:
    url = _keychain(SUPABASE_URL_SERVICE) or os.environ.get("SUPABASE_URL", "")
    key = _keychain(SUPABASE_KEY_SERVICE)
    if not key:
        for fb in SUPABASE_KEY_FALLBACKS:
            key = _keychain(fb)
            if key:
                break
    if not url:
        url = "https://eusjiygcqzsmqonhuxlq.supabase.co"
    return url.rstrip("/"), key


def collect(db_path: Path | None = None) -> list[dict[str, Any]]:
    path = db_path or kanban_db_path()
    if not path.is_file():
        raise FileNotFoundError(f"kanban.db not found: {path}")

    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    try:
        now = _now()
        cutoff = now.timestamp() - DONE_RETENTION_SECONDS

        tasks = conn.execute(
            """
            SELECT id, title, body, assignee, status, priority, created_by,
                   created_at, started_at, completed_at,
                   consecutive_failures, last_failure_error, block_kind, result
            FROM tasks
            WHERE status != 'archived'
              AND NOT (status = 'done' AND completed_at IS NOT NULL AND completed_at < ?)
            ORDER BY priority DESC, created_at ASC
            """,
            (cutoff,),
        ).fetchall()

        parents: dict[str, list[str]] = {}
        children: dict[str, list[str]] = {}
        for row in conn.execute("SELECT parent_id, child_id FROM task_links"):
            parents.setdefault(row["child_id"], []).append(row["parent_id"])
            children.setdefault(row["parent_id"], []).append(row["child_id"])

        comment_meta: dict[str, tuple[int, Any, str, str]] = {}
        for row in conn.execute(
            """
            SELECT c.task_id,
                   COUNT(*) AS cnt,
                   MAX(c.created_at) AS latest_at
            FROM task_comments c
            GROUP BY c.task_id
            """
        ):
            comment_meta[row["task_id"]] = (int(row["cnt"] or 0), row["latest_at"], "", "")

        # latest comment body/author
        for task_id, (cnt, latest_at, _, _) in list(comment_meta.items()):
            if not latest_at:
                continue
            latest = conn.execute(
                """
                SELECT author, body FROM task_comments
                WHERE task_id = ? AND created_at = ?
                ORDER BY id DESC LIMIT 1
                """,
                (task_id, latest_at),
            ).fetchone()
            if latest:
                comment_meta[task_id] = (
                    cnt,
                    latest_at,
                    latest["author"] or "",
                    (latest["body"] or "")[:500],
                )

        snap_at = now.isoformat()
        out: list[dict[str, Any]] = []
        for t in tasks:
            tid = t["id"]
            cnt, latest_at, author, body = comment_meta.get(tid, (0, None, "", ""))
            out.append(
                {
                    "task_id": tid,
                    "title": t["title"] or "",
                    "body": t["body"],
                    "assignee": t["assignee"],
                    "status": t["status"] or "todo",
                    "priority": int(t["priority"] or 0),
                    "created_by": t["created_by"],
                    "created_at": _ts_to_iso(t["created_at"]),
                    "started_at": _ts_to_iso(t["started_at"]),
                    "completed_at": _ts_to_iso(t["completed_at"]),
                    "consecutive_failures": int(t["consecutive_failures"] or 0),
                    "last_failure_error": t["last_failure_error"],
                    "block_kind": t["block_kind"] if "block_kind" in t.keys() else None,
                    "result_summary": (t["result"] or "")[:2000] if t["result"] else None,
                    "parent_ids": parents.get(tid, []),
                    "child_ids": children.get(tid, []),
                    "comment_count": cnt,
                    "latest_comment_at": _ts_to_iso(latest_at),
                    "latest_comment_author": author or None,
                    "latest_comment_body": body or None,
                    "board_slug": "default",
                    "snapshot_at": snap_at,
                }
            )
        return out
    finally:
        conn.close()


def apply_rows(rows: list[dict[str, Any]]) -> tuple[int, str | None]:
    url, key = supabase_client()
    if not key or len(key) < 80:
        return 0, "missing/truncated supabase service key in keychain"
    endpoint = f"{url}/rest/v1/kanban_snapshot?on_conflict=task_id"
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=body,
        method="POST",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
            "Accept-Profile": "lsh",
            "Content-Profile": "lsh",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            _ = resp.read()
            status = resp.status
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")[:500]
        return 0, f"HTTP {e.code}: {detail}"
    except Exception as e:
        return 0, f"{type(e).__name__}: {e}"

    if status not in (200, 201, 204):
        return 0, f"unexpected status {status}"

    snap = rows[0]["snapshot_at"] if rows else None
    if snap:
        del_url = f"{url}/rest/v1/kanban_snapshot?snapshot_at=lt.{quote(snap, safe='')}"
        dreq = urllib.request.Request(
            del_url,
            method="DELETE",
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Accept-Profile": "lsh",
                "Content-Profile": "lsh",
                "Prefer": "return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(dreq, timeout=30) as resp:
                _ = resp.read()
        except Exception:
            pass

    return len(rows), None


def print_dry_run(rows: list[dict[str, Any]]) -> None:
    counts = Counter(r["status"] for r in rows)
    fails = sum(1 for r in rows if int(r.get("consecutive_failures") or 0) > 0 or r.get("last_failure_error"))
    print(
        f"kanban_snapshot dry-run: total={len(rows)} "
        f"by_status={dict(counts)} failing={fails} db={kanban_db_path()}"
    )
    for r in rows[:12]:
        fail = " FAIL" if (r.get("consecutive_failures") or r.get("last_failure_error")) else ""
        print(
            f"  {r['status']:10} {r.get('assignee') or '-':12} {r['task_id']}  "
            f"{(r['title'] or '')[:60]}{fail}"
        )
    if len(rows) > 12:
        print(f"  … +{len(rows) - 12} more")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Hermes kanban board snapshot")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--quiet-ok", action="store_true")
    args = ap.parse_args(argv)

    try:
        rows = collect()
    except Exception as e:
        print(f"kanban_snapshot FAILED: {type(e).__name__}: {e}")
        return 1

    counts = Counter(r["status"] for r in rows)

    if args.json and not args.apply:
        print(json.dumps({"counts": dict(counts), "rows": rows}, indent=2))
        return 0

    if args.apply and not args.dry_run:
        n, err = apply_rows(rows)
        if err:
            print(f"kanban_snapshot APPLY FAILED: {err}")
            print(f"counts {dict(counts)} total={len(rows)}")
            return 1
        if not args.quiet_ok:
            print(f"kanban_snapshot: upserted={n} {dict(counts)}")
        return 0

    if args.quiet_ok:
        return 0
    print_dry_run(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
