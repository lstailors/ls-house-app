#!/usr/bin/env python3
"""Apply MC snapshot migrations to prod Supabase via psql."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from shlex import quote


def kc(service: str, account: str = "postgres") -> str:
    r = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
        capture_output=True,
        text=True,
    )
    return (r.stdout or "").strip()


def main() -> int:
    pw = kc("supabase-db-password", "postgres")
    if len(pw) < 8:
        for acct in ("openclaw", "supabase", "postgres"):
            pw2 = kc("supabase-db-password", acct)
            print(f"try account={acct} len={len(pw2)}")
            if len(pw2) >= 8:
                pw = pw2
                break
    print(f"pw_len={len(pw)}")
    if len(pw) < 8:
        print("FAIL: no usable supabase-db-password in keychain")
        return 1

    root = Path(__file__).resolve().parents[1] / "supabase"
    # also accept worktree path via argv
    if len(sys.argv) > 1:
        root = Path(sys.argv[1])

    files = [
        root / "migration_007_cron_health.sql",
        root / "migration_008_kanban_snapshot.sql",
        root / "migration_009_mc_commands.sql",
    ]
    conn = (
        f"PGPASSWORD={quote(pw)} /opt/homebrew/bin/psql "
        f'"host=aws-0-us-west-2.pooler.supabase.com port=5432 dbname=postgres '
        f'user=postgres.eusjiygcqzsmqonhuxlq sslmode=require"'
    )
    for f in files:
        if not f.is_file():
            print(f"MISSING {f}")
            return 1
        cmd = f"{conn} -v ON_ERROR_STOP=1 -f {quote(str(f))}"
        print(f"APPLY {f.name}")
        r = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        print("exit", r.returncode)
        if r.stdout:
            print(r.stdout[-800:])
        if r.stderr:
            print(r.stderr[-800:])
        if r.returncode != 0:
            return r.returncode
    print("OK both migrations")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
