#!/usr/bin/env python3
"""
Auto-promote pipeline when MTMPro orders land (or stay unlinked).

Runs on a schedule (Hermes cron every 15m). For each candidate order:

  1) promote_mtmpro_bms.py   — fit_notes → BMS + MTMPro.body_measurement_set
  2) backfill_bms_current.py — one Current per customer + lsh_* cache
  3) promote_mtmpro_photos.py — PDFs → headshot + fit views (if missing)
  4) link_customer_masters.py — Customer.lsh_current_bms + lsh_body_profile

Candidates (default):
  - MTMPro with fit_notes set AND body_measurement_set empty
  - OR created/modified in last --lookback-hours (re-check photos/links)

Usage:
  python3 auto_promote_mtmpro_masters.py --dry-run
  python3 auto_promote_mtmpro_masters.py --write
  python3 auto_promote_mtmpro_masters.py --write --order LST-122512-1
  python3 auto_promote_mtmpro_masters.py --write --lookback-hours 48
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

ENV_PATH = Path.home() / "ls-mcp" / ".env"
SCRIPTS = Path(__file__).resolve().parent
DATA = SCRIPTS / "data"
STATE_PATH = DATA / "auto_promote_state.json"
UA = "Mozilla/5.0 (compatible; LSH-Simone-AutoPromote/1.0)"


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Erp:
    def __init__(self, env: dict[str, str]):
        self.base = (env.get("ERPNEXT_URL") or "http://localhost:8080").rstrip("/")
        self.key = env["ERPNEXT_API_KEY"]
        self.secret = env["ERPNEXT_API_SECRET"]

    def _req(self, path: str, method: str = "GET", data: Any = None) -> Any:
        body = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(self.base + path, data=body, method=method)
        req.add_header("Authorization", f"token {self.key}:{self.secret}")
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", UA)
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} → {e.code}: {e.read().decode()[:500]}") from e

    def list_all(self, doctype: str, fields: list[str], filters=None, order_by=None) -> list[dict]:
        out: list[dict] = []
        start = 0
        while True:
            q: dict[str, Any] = {
                "fields": json.dumps(fields),
                "limit_page_length": 100,
                "limit_start": start,
            }
            if filters is not None:
                q["filters"] = json.dumps(filters)
            if order_by:
                q["order_by"] = order_by
            enc = urllib.parse.urlencode(q)
            batch = self._req(f"/api/resource/{urllib.parse.quote(doctype)}?{enc}").get("data") or []
            out.extend(batch)
            if len(batch) < 100:
                break
            start += 100
        return out

    def get(self, doctype: str, name: str) -> dict:
        return self._req(
            f"/api/resource/{urllib.parse.quote(doctype)}/{urllib.parse.quote(name)}"
        )["data"]


def run_cmd(args: list[str], *, dry: bool) -> tuple[int, str]:
    print("  $", " ".join(args))
    p = subprocess.run(args, capture_output=True, text=True)
    out = (p.stdout or "") + (p.stderr or "")
    # keep tail for logs
    tail = "\n".join(out.splitlines()[-40:])
    if p.returncode != 0:
        print(f"  !! exit {p.returncode}\n{tail}")
    else:
        for line in out.splitlines()[-12:]:
            print("   ", line)
    # Treat promote "no measurements" as soft-fail (exit 0 for orchestrator)
    if "no master measurements" in out or "[FAIL]" in out and "promote_mtmpro_bms" in " ".join(args):
        # still non-zero from child — normalize to ok for cron when only unparseable
        if p.returncode != 0 and "no master measurements resolved" in out:
            return 0, tail
    return p.returncode, tail


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    s = s.replace("T", " ")
    for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(s[:26], fmt)
        except ValueError:
            continue
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--order", action="append", default=[])
    ap.add_argument("--lookback-hours", type=float, default=36.0)
    ap.add_argument("--limit", type=int, default=25)
    ap.add_argument("--skip-photos", action="store_true")
    ap.add_argument("--quiet-ok", action="store_true", help="No output if nothing to do")
    args = ap.parse_args()
    write = bool(args.write)
    if not write:
        args.dry_run = True

    env = load_env()
    erp = Erp(env)
    py = sys.executable
    DATA.mkdir(parents=True, exist_ok=True)

    mode = "WRITE" if write else "DRY-RUN"
    started = datetime.now().isoformat(timespec="seconds")

    # Find candidates
    candidates: list[dict] = []
    if args.order:
        for name in args.order:
            try:
                candidates.append(erp.get("MTMPro Order", name))
            except Exception as e:
                print(f"order {name}: {e}")
    else:
        # Unlinked with fit_notes (primary)
        all_fn = erp.list_all(
            "MTMPro Order",
            [
                "name",
                "customer",
                "fit_notes",
                "body_measurement_set",
                "modified",
                "creation",
                "order_date",
            ],
            filters=[["fit_notes", "is", "set"]],
            order_by="modified desc",
        )
        unlinked = [o for o in all_fn if not o.get("body_measurement_set")]
        candidates.extend(unlinked)

        # Recent modified — only if customer hub incomplete
        cutoff = datetime.now() - timedelta(hours=args.lookback_hours)
        recent = erp.list_all(
            "MTMPro Order",
            [
                "name",
                "customer",
                "fit_notes",
                "body_measurement_set",
                "modified",
                "creation",
            ],
            filters=[["modified", ">=", cutoff.strftime("%Y-%m-%d %H:%M:%S")]],
            order_by="modified desc",
        )
        seen = {c["name"] for c in candidates}
        for o in recent:
            if o["name"] in seen:
                continue
            cust_name = o.get("customer")
            if not cust_name:
                continue
            try:
                cust = erp.get("Customer", cust_name)
            except Exception:
                continue
            needs_hub = not cust.get("lsh_current_bms")
            needs_photo = not (cust.get("lsh_headshot") or cust.get("image"))
            needs_order_link = not o.get("body_measurement_set") and bool(o.get("fit_notes"))
            if needs_hub or needs_photo or needs_order_link:
                candidates.append(o)
                seen.add(o["name"])

    # Dedup + limit
    by_name = {c["name"]: c for c in candidates}
    candidates = list(by_name.values())[: args.limit]

    if not candidates:
        if not args.quiet_ok:
            print(f"[{started}] auto-promote {mode}: nothing to do")
        # still write heartbeat state
        STATE_PATH.write_text(
            json.dumps(
                {
                    "last_run": started,
                    "mode": mode.lower(),
                    "candidates": 0,
                    "ok": True,
                },
                indent=2,
            )
        )
        return 0

    print(f"[{started}] auto-promote {mode} · candidates={len(candidates)}")
    for c in candidates:
        print(
            f"  · {c['name']} · {c.get('customer')} · "
            f"bms={c.get('body_measurement_set') or '—'} · "
            f"fit_notes={'yes' if c.get('fit_notes') else 'no'}"
        )

    results = []
    customers_touched: set[str] = set()

    # --- Pass 1: promote each order needing BMS ---
    for o in candidates:
        entry: dict[str, Any] = {"order": o["name"], "customer": o.get("customer"), "steps": {}}
        needs_promote = not o.get("body_measurement_set") and bool(o.get("fit_notes"))
        if needs_promote:
            cmd = [
                py,
                str(SCRIPTS / "promote_mtmpro_bms.py"),
                "--order",
                o["name"],
                "--status",
                "Draft",
                "--no-customer-cache",
            ]
            cmd.append("--write" if write else "--dry-run")
            code, tail = run_cmd(cmd, dry=not write)
            entry["steps"]["promote"] = {"code": code, "tail": tail[-500:]}
            if code == 0 and o.get("customer"):
                customers_touched.add(o["customer"])
        else:
            entry["steps"]["promote"] = {"skipped": True}
            if o.get("customer"):
                customers_touched.add(o["customer"])
        results.append(entry)

    # Refresh customers from any promote
    for o in candidates:
        if o.get("customer"):
            customers_touched.add(o["customer"])

    # --- Pass 2: Current collapse per customer ---
    for customer in sorted(customers_touched):
        cmd = [
            py,
            str(SCRIPTS / "backfill_bms_current.py"),
            "--customer",
            customer,
        ]
        cmd.append("--write" if write else "--dry-run")
        code, tail = run_cmd(cmd, dry=not write)
        for r in results:
            if r.get("customer") == customer:
                r["steps"]["current"] = {"code": code}

    # --- Pass 3: photos ---
    if not args.skip_photos:
        for customer in sorted(customers_touched):
            cmd = [
                py,
                str(SCRIPTS / "promote_mtmpro_photos.py"),
                "--customer",
                customer,
            ]
            cmd.append("--write" if write else "--dry-run")
            code, tail = run_cmd(cmd, dry=not write)
            for r in results:
                if r.get("customer") == customer:
                    r["steps"]["photos"] = {"code": code}

    # --- Pass 4: hub links ---
    for customer in sorted(customers_touched):
        cmd = [
            py,
            str(SCRIPTS / "link_customer_masters.py"),
            "--customer",
            customer,
        ]
        cmd.append("--write" if write else "--dry-run")
        code, tail = run_cmd(cmd, dry=not write)
        for r in results:
            if r.get("customer") == customer:
                r["steps"]["link"] = {"code": code}

    report = {
        "started": started,
        "finished": datetime.now().isoformat(timespec="seconds"),
        "mode": mode.lower(),
        "candidates": [c["name"] for c in candidates],
        "customers": sorted(customers_touched),
        "results": results,
    }
    out = DATA / f"auto_promote_{'write' if write else 'dry'}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    out.write_text(json.dumps(report, indent=2, default=str))
    STATE_PATH.write_text(
        json.dumps(
            {
                "last_run": started,
                "mode": mode.lower(),
                "candidates": len(candidates),
                "customers": sorted(customers_touched),
                "report": str(out),
                "ok": True,
            },
            indent=2,
        )
    )
    print(f"\n=== AUTO PROMOTE DONE · {len(candidates)} orders · {len(customers_touched)} customers ===")
    print(f"report → {out}")

    # Concise human summary for cron delivery
    print("\nSUMMARY")
    print(f"orders: {', '.join(c['name'] for c in candidates)}")
    print(f"customers: {', '.join(sorted(customers_touched))}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
