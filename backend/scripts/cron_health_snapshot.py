#!/usr/bin/env python3
"""Scan Hermes cron registries → compute green/amber/red → optional Supabase upsert.

Source of truth (read-only):
  ~/.hermes/cron/jobs.json              → profile slug "maestro"
  ~/.hermes/profiles/<slug>/cron/jobs.json

Does NOT walk state-snapshots or other archives.

Health rules (brief Phase 2):
  green  — enabled, last_status ok, last_run within 2× schedule period, no hard error
  amber  — enabled but stale / paused / disabled / model_snapshot drift / delivery error only
  red    — last_status error / last_error present

Usage:
  python3 cron_health_snapshot.py              # dry-run (default): print counts + table
  python3 cron_health_snapshot.py --dry-run
  python3 cron_health_snapshot.py --apply      # upsert lsh.cron_health (needs service key)

Hermes no_agent cron (every 15m): empty stdout when healthy + applied/dry ok;
prints a one-line alert only when reds > 0 or apply fails.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

HERMES_HOME_ENV = os.environ.get("HERMES_HOME", "")
SUPABASE_URL_SERVICE = "openclaw-supabase-url"
SUPABASE_KEY_SERVICE = "openclaw-supabase-service-key"
# Fallbacks tried if primary missing
SUPABASE_KEY_FALLBACKS = ("openclaw-supabase-key",)

# Minimum period floor so */1-style jobs don't go red within seconds of jitter
MIN_PERIOD_SECONDS = 60
# Default when schedule cannot be parsed
DEFAULT_PERIOD_SECONDS = 24 * 3600


def hermes_root() -> Path:
    """Resolve fleet root even when HERMES_HOME is profile-scoped (simone/mia/…)."""
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
        # HERMES_HOME=.../profiles/<slug>
        if p.parent.name == "profiles" and (p.parent.parent / "cron").exists():
            return p.parent.parent
    return Path.home() / ".hermes"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        # seconds or ms
        ts = float(value)
        if ts > 1e12:
            ts /= 1000.0
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    # 2026-08-04T10:00:15.283371-04:00
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _keychain(service: str, account: str = "openclaw") -> str:
    r = subprocess.run(
        ["security", "find-generic-password", "-s", service, "-a", account, "-w"],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        return ""
    return (r.stdout or "").strip()


def discover_registries() -> list[tuple[str, Path]]:
    """Return [(profile_slug, path), ...] — root first as maestro, then profiles/*."""
    root_home = hermes_root()
    out: list[tuple[str, Path]] = []
    root = root_home / "cron" / "jobs.json"
    if root.is_file():
        out.append(("maestro", root))
    profiles = root_home / "profiles"
    if profiles.is_dir():
        for p in sorted(profiles.iterdir()):
            jobs = p / "cron" / "jobs.json"
            if p.is_dir() and jobs.is_file():
                out.append((p.name, jobs))
    return out


def estimate_period_seconds(schedule: Any) -> int:
    """Best-effort period for stale tolerance (2× this)."""
    if not isinstance(schedule, dict):
        return DEFAULT_PERIOD_SECONDS
    kind = (schedule.get("kind") or "").lower()
    if kind == "interval":
        minutes = schedule.get("minutes")
        if minutes is None and schedule.get("seconds") is not None:
            return max(MIN_PERIOD_SECONDS, int(schedule["seconds"]))
        try:
            m = float(minutes if minutes is not None else 60)
        except (TypeError, ValueError):
            m = 60.0
        return max(MIN_PERIOD_SECONDS, int(m * 60))

    expr = schedule.get("expr") or schedule.get("display") or ""
    expr = str(expr).strip()
    # every Nm / every N h display leftovers
    m = re.match(r"every\s+(\d+)\s*m", expr, re.I)
    if m:
        return max(MIN_PERIOD_SECONDS, int(m.group(1)) * 60)
    m = re.match(r"every\s+(\d+)\s*h", expr, re.I)
    if m:
        return max(MIN_PERIOD_SECONDS, int(m.group(1)) * 3600)

    # classic 5-field cron
    parts = expr.split()
    if len(parts) >= 5:
        minute, hour, dom, mon, dow = parts[:5]
        # */N minutes
        m = re.match(r"\*/(\d+)$", minute)
        if m and hour == "*" and dom == "*" and mon == "*":
            return max(MIN_PERIOD_SECONDS, int(m.group(1)) * 60)
        # N minutes past every hour: "15 * * * *"
        if re.match(r"^\d+$", minute) and hour == "*" and dom == "*" and mon == "*":
            return 3600
        # several hours: "0 10,14,18 * * *"
        if re.match(r"^[\d,]+$", hour) and dom == "*" and mon == "*" and dow == "*":
            hours = [int(x) for x in hour.split(",") if x.isdigit()]
            if len(hours) >= 2:
                hours = sorted(set(hours))
                gaps = [(hours[i + 1] - hours[i]) % 24 for i in range(len(hours) - 1)]
                gaps.append((hours[0] + 24 - hours[-1]) % 24)
                gap = min(g for g in gaps if g > 0) if any(g > 0 for g in gaps) else 24
                return max(MIN_PERIOD_SECONDS, gap * 3600)
            if len(hours) == 1:
                return 24 * 3600
        # daily at H:M
        if re.match(r"^\d+$", minute) and re.match(r"^\d+$", hour) and dom == "*" and mon == "*":
            if dow == "*":
                return 24 * 3600
            # weekly dow list
            return 7 * 24 * 3600
        # hourly-ish fallback when minute is */N already handled
        if minute != "*" and hour == "*":
            return 3600
    return DEFAULT_PERIOD_SECONDS


def model_drift(job: dict) -> bool:
    model = job.get("model")
    snap = job.get("model_snapshot")
    if model and snap and str(model).strip() and str(snap).strip():
        return str(model).strip() != str(snap).strip()
    return False


def classify(job: dict, now: datetime) -> tuple[str, list[str], int, bool, bool]:
    """Return (color, reasons, period_seconds, stale, drift)."""
    reasons: list[str] = []
    enabled = bool(job.get("enabled", True))
    last_status = job.get("last_status")
    last_error = (job.get("last_error") or "").strip() or None
    last_delivery = (job.get("last_delivery_error") or "").strip() or None
    paused_at = job.get("paused_at")
    last_run = _parse_dt(job.get("last_run_at"))
    period = estimate_period_seconds(job.get("schedule"))
    drift = model_drift(job)

    stale = False
    if enabled and not paused_at:
        if last_run is None:
            stale = True
            reasons.append("never_run")
        else:
            age = (now - last_run).total_seconds()
            if age > 2 * period:
                stale = True
                reasons.append(f"stale_age={int(age)}s>2x{period}s")

    # RED first
    if last_status and str(last_status).lower() not in ("ok", "success", "succeeded"):
        reasons.append(f"last_status={last_status}")
        return "red", reasons, period, stale, drift
    if last_error:
        reasons.append("last_error")
        return "red", reasons, period, stale, drift

    # AMBER
    if paused_at:
        reasons.append("paused")
    if not enabled:
        reasons.append("disabled")
    if drift:
        reasons.append("model_drift")
    if last_delivery:
        reasons.append("delivery_error")
    if stale:
        if "never_run" not in reasons and not any(r.startswith("stale_age=") for r in reasons):
            reasons.append("stale")

    if reasons:
        return "amber", reasons, period, stale, drift

    return "green", [], period, False, False


def load_jobs(profile: str, path: Path) -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        print(f"cron_health: failed to read {path}: {e}", file=sys.stderr)
        return []
    if isinstance(data, dict):
        jobs = data.get("jobs", [])
    elif isinstance(data, list):
        jobs = data
    else:
        jobs = []
    rows = []
    for j in jobs:
        if not isinstance(j, dict) or not j.get("id"):
            continue
        rows.append(j)
    return rows


def row_from_job(profile: str, path: Path, job: dict, now: datetime) -> dict[str, Any]:
    color, reasons, period, stale, drift = classify(job, now)
    raw_sch = job.get("schedule")
    sch: dict[str, Any] = raw_sch if isinstance(raw_sch, dict) else {}
    skills = job.get("skills") or []
    if job.get("skill") and job["skill"] not in skills:
        skills = list(skills) + [job["skill"]]
    last_run = _parse_dt(job.get("last_run_at"))
    next_run = _parse_dt(job.get("next_run_at"))
    paused = _parse_dt(job.get("paused_at"))

    def iso(dt: datetime | None) -> str | None:
        return dt.isoformat() if dt else None

    sch_kind = sch.get("kind")
    sch_expr = sch.get("expr")
    if not sch_expr and sch_kind == "interval" and sch.get("minutes") is not None:
        sch_expr = f"every {sch.get('minutes')}m"

    return {
        "profile": profile,
        "job_id": str(job["id"]),
        "job_name": str(job.get("name") or ""),
        "enabled": bool(job.get("enabled", True)),
        "health_color": color,
        "health_reasons": reasons,
        "last_status": job.get("last_status"),
        "last_run_at": iso(last_run),
        "next_run_at": iso(next_run),
        "last_error": (job.get("last_error") or None),
        "last_delivery_error": (job.get("last_delivery_error") or None),
        "schedule_kind": sch_kind,
        "schedule_display": sch.get("display") or job.get("schedule_display"),
        "schedule_expr": sch_expr,
        "period_seconds": period,
        "stale": stale,
        "model": job.get("model"),
        "model_snapshot": job.get("model_snapshot"),
        "model_drift": drift,
        "provider": job.get("provider"),
        "provider_snapshot": job.get("provider_snapshot"),
        "paused_at": iso(paused),
        "paused_reason": job.get("paused_reason"),
        "no_agent": bool(job.get("no_agent", False)),
        "skills": skills if isinstance(skills, list) else [],
        "source_path": str(path),
        "snapshot_at": now.isoformat(),
    }


def collect() -> list[dict[str, Any]]:
    now = _now()
    rows: list[dict[str, Any]] = []
    for profile, path in discover_registries():
        for job in load_jobs(profile, path):
            rows.append(row_from_job(profile, path, job, now))
    rows.sort(key=lambda r: (r["health_color"] != "red", r["health_color"] != "amber", r["profile"], r["job_name"]))
    return rows


def print_dry_run(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(r["health_color"] for r in rows)
    # Always print counts for operator dry-run; cron path uses main() silence rules
    print(f"cron_health dry-run: total={len(rows)} green={counts.get('green', 0)} "
          f"amber={counts.get('amber', 0)} red={counts.get('red', 0)} "
          f"profiles={len({r['profile'] for r in rows})}")
    # Compact table
    for r in rows:
        err = ""
        if r["last_error"]:
            err = " err=" + str(r["last_error"]).replace("\n", " ")[:60]
        elif r["last_delivery_error"]:
            err = " deliv=" + str(r["last_delivery_error"]).replace("\n", " ")[:50]
        reasons = ",".join(r["health_reasons"]) if r["health_reasons"] else "-"
        print(
            f"  {r['health_color']:5}  {r['profile']:12}  {r['job_name'][:42]:42}  "
            f"{reasons}{err}"
        )
    return dict(counts)


def supabase_client() -> tuple[str, str]:
    url = _keychain(SUPABASE_URL_SERVICE) or os.environ.get("SUPABASE_URL", "")
    key = _keychain(SUPABASE_KEY_SERVICE)
    if not key or len(key) < 80:
        for s in SUPABASE_KEY_FALLBACKS:
            key = _keychain(s)
            if key and len(key) >= 80:
                break
    if not url:
        url = "https://eusjiygcqzsmqonhuxlq.supabase.co"
    return url.rstrip("/"), key


def apply_rows(rows: list[dict[str, Any]]) -> tuple[int, str | None]:
    url, key = supabase_client()
    if not key or len(key) < 80:
        return 0, "missing/truncated supabase service key in keychain"
    endpoint = f"{url}/rest/v1/cron_health?on_conflict=profile,job_id"
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

    # Prune orphans (jobs removed from registries): older snapshot_at than this run
    snap = rows[0]["snapshot_at"] if rows else None
    if snap:
        from urllib.parse import quote

        del_url = f"{url}/rest/v1/cron_health?snapshot_at=lt.{quote(snap, safe='')}"
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
            # prune is best-effort; upsert already succeeded
            pass

    return len(rows), None


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Hermes cron fleet health snapshot")
    ap.add_argument(
        "--apply",
        action="store_true",
        help="Upsert rows to Supabase lsh.cron_health (default is dry-run)",
    )
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Force dry-run (default when --apply not set)",
    )
    ap.add_argument(
        "--json",
        action="store_true",
        help="Emit full JSON rows to stdout (dry-run)",
    )
    ap.add_argument(
        "--quiet-ok",
        action="store_true",
        help="Silence stdout when no reds (for hermes no_agent cron)",
    )
    args = ap.parse_args(argv)

    rows = collect()
    counts = Counter(r["health_color"] for r in rows)
    reds = counts.get("red", 0)

    if args.json and not args.apply:
        print(json.dumps({"counts": dict(counts), "rows": rows}, indent=2))
        return 0

    if args.apply and not args.dry_run:
        n, err = apply_rows(rows)
        if err:
            print(f"cron_health APPLY FAILED: {err}")
            print(
                f"counts green={counts.get('green', 0)} "
                f"amber={counts.get('amber', 0)} red={reds} total={len(rows)}"
            )
            return 1
        if reds > 0 or not args.quiet_ok:
            # With quiet_ok: only speak on reds
            if reds > 0:
                bad = [r for r in rows if r["health_color"] == "red"]
                names = ", ".join(f"{r['profile']}/{r['job_name']}" for r in bad[:8])
                print(
                    f"cron_health: upserted={n} red={reds} "
                    f"amber={counts.get('amber', 0)} green={counts.get('green', 0)} — {names}"
                )
            elif not args.quiet_ok:
                print(
                    f"cron_health: upserted={n} green={counts.get('green', 0)} "
                    f"amber={counts.get('amber', 0)} red=0"
                )
        return 0

    # dry-run
    if args.quiet_ok and reds == 0:
        # still exit 0 silently — but task asks to prove dry-run counts, so
        # callers without --quiet-ok always see counts
        return 0
    print_dry_run(rows)
    return 0 if reds == 0 else 0  # dry-run never fails the process on reds


if __name__ == "__main__":
    raise SystemExit(main())
