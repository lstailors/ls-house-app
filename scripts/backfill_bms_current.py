#!/usr/bin/env python3
"""
Backfill Body Measurement Set → one Current master per customer + Customer lsh_* cache.

Steps:
  1) Optionally re-promote unlinked MTMPro orders (calls promote_mtmpro_bms logic)
  2) For each customer with BMS rows, pick fullest (then newest) set → status=Current
  3) Supersede other non-Cancelled sets for that customer
  4) Mirror key skin values onto Customer lsh_chest / lsh_seat / lsh_back_length / lsh_outseam

Usage:
  python3 backfill_bms_current.py --dry-run
  python3 backfill_bms_current.py --write
  python3 backfill_bms_current.py --write --promote-unlinked
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path
from typing import Any

ENV_PATH = Path.home() / "ls-mcp" / ".env"
UA = "Mozilla/5.0 (compatible; LSH-Simone-BMS-Backfill/1.0)"

# Master type → Customer float field (values stored as inches on Customer)
CACHE_MAP = {
    "CHEST_SKIN": "lsh_chest",
    "SEAT_SKIN": "lsh_seat",
    "COAT_BACK_LEN": "lsh_back_length",
    "TROUSER_OUT_L": "lsh_outseam",
    "TROUSER_OUT_R": "lsh_outseam",
}


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
            raise RuntimeError(f"{method} {path} → {e.code}: {e.read().decode()[:600]}") from e

    def list_all(self, doctype: str, fields: list[str], filters: list | None = None) -> list[dict]:
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

    def update(self, doctype: str, name: str, values: dict) -> dict:
        return self._req(
            f"/api/resource/{urllib.parse.quote(doctype)}/{urllib.parse.quote(name)}",
            "PUT",
            values,
        )["data"]


def inches(value: float, unit: str | None) -> float:
    if (unit or "inches").lower().startswith("cm"):
        return round(float(value) / 2.54, 2)
    return round(float(value), 2)


def score_set(full: dict) -> tuple:
    """Higher is better: row count, then captured_date, then version, then name."""
    rows = full.get("measurements") or []
    n = len(rows)
    # Prefer sets with real skin girths
    skin = sum(1 for r in rows if (r.get("bucket") or "").lower() == "skin")
    date = full.get("captured_date") or full.get("creation") or ""
    ver = int(full.get("version") or 0)
    return (n, skin, date, ver, full.get("name") or "")


def cache_from_bms(full: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for r in full.get("measurements") or []:
        field = CACHE_MAP.get(r.get("measurement_type") or "")
        if not field:
            continue
        try:
            val = inches(float(r["value"]), r.get("unit"))
        except Exception:
            continue
        # Prefer first / left outseam; don't overwrite chest with empty
        if field in out and field == "lsh_outseam" and r.get("measurement_type") == "TROUSER_OUT_R":
            continue
        out[field] = val
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--promote-unlinked", action="store_true", help="Run promote on unlinked MTMPro first")
    ap.add_argument("--skip-cache", action="store_true")
    ap.add_argument("--customer", action="append", default=[], help="Limit to these Customer names")
    ap.add_argument("--report", default="")
    args = ap.parse_args()
    write = bool(args.write)
    if not write:
        args.dry_run = True

    env = load_env()
    erp = Erp(env)
    print(f"ERP {erp.base} · mode={'WRITE' if write else 'DRY-RUN'}")

    if args.promote_unlinked:
        # Import sibling promote module
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        import promote_mtmpro_bms as prom  # type: ignore

        aliases = json.loads((Path(__file__).parent / "data" / "measurement_type_aliases.json").read_text())
        type_meta = prom.load_type_meta(erp)  # type: ignore[attr-defined]
        # erp adapter: promote expects its own Erp — use subprocess for safety
        import subprocess

        cmd = [
            sys.executable,
            str(Path(__file__).parent / "promote_mtmpro_bms.py"),
            "--all",
            "--status",
            "Draft",
        ]
        if write:
            cmd.append("--write")
            cmd.append("--no-customer-cache")
        else:
            cmd.append("--dry-run")
        print("running", " ".join(cmd))
        subprocess.check_call(cmd)

    sets = erp.list_all(
        "Body Measurement Set",
        ["name", "customer", "status", "version", "mtmpro_source_order", "captured_date", "creation"],
        filters=[["customer", "not in", ["_Test BMS Customer"]]],
    )
    by_cust: dict[str, list[dict]] = defaultdict(list)
    for s in sets:
        by_cust[s["customer"]].append(s)

    only = set(args.customer) if args.customer else None
    if only:
        by_cust = {k: v for k, v in by_cust.items() if k in only}

    report = {"customers": [], "cache_updates": 0, "promoted_current": 0, "superseded": 0}
    print(f"customers with BMS: {len(by_cust)} · total sets: {len(sets)}")

    for customer, rows in sorted(by_cust.items(), key=lambda x: x[0].lower()):
        # Load full docs for scoring
        fulls = []
        for r in rows:
            try:
                fulls.append(erp.get("Body Measurement Set", r["name"]))
            except Exception as e:
                print(f"  skip get {r['name']}: {e}")
        if not fulls:
            continue
        fulls.sort(key=score_set, reverse=True)
        winner = fulls[0]
        losers = fulls[1:]

        entry = {
            "customer": customer,
            "winner": winner["name"],
            "winner_rows": len(winner.get("measurements") or []),
            "winner_was": winner.get("status"),
            "supersede": [x["name"] for x in losers if x.get("status") != "Superseded"],
            "cache": cache_from_bms(winner),
        }

        # Promote winner to Current if needed
        if winner.get("status") != "Current":
            entry["action_current"] = True
            if write:
                erp.update(
                    "Body Measurement Set",
                    winner["name"],
                    {"status": "Current"},
                )
            report["promoted_current"] += 1
        else:
            entry["action_current"] = False

        # Supersede others still Draft/Current
        for x in losers:
            if x.get("status") == "Superseded":
                continue
            if write:
                erp.update("Body Measurement Set", x["name"], {"status": "Superseded"})
            report["superseded"] += 1

        # Customer cache
        cache = entry["cache"]
        if cache and not args.skip_cache:
            # Only write if missing or differs
            try:
                cust = erp.get("Customer", customer)
            except Exception as e:
                entry["cache_error"] = str(e)[:200]
                report["customers"].append(entry)
                continue
            patch = {}
            for field, val in cache.items():
                cur = cust.get(field)
                try:
                    cur_f = float(cur) if cur not in (None, "") else None
                except Exception:
                    cur_f = None
                if cur_f is None or abs(cur_f - val) > 0.05:
                    patch[field] = val
            entry["cache_patch"] = patch
            if patch:
                if write:
                    erp.update("Customer", customer, patch)
                report["cache_updates"] += 1

        report["customers"].append(entry)
        flag = "WIN" if entry["action_current"] or entry.get("cache_patch") else "ok"
        print(
            f"  [{flag}] {customer} · {winner['name']} rows={entry['winner_rows']} "
            f"was={winner.get('status')} cache={entry.get('cache_patch') or entry.get('cache')}"
        )

    out = (
        Path(args.report)
        if args.report
        else Path(__file__).parent / "data" / f"bms_current_{'write' if write else 'dry'}.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    summary = {
        "mode": "write" if write else "dry_run",
        "customers": len(report["customers"]),
        "promoted_current": report["promoted_current"],
        "superseded": report["superseded"],
        "cache_updates": report["cache_updates"],
    }
    out.write_text(json.dumps({"summary": summary, **report}, indent=2, default=str))
    print("\n=== SUMMARY ===")
    print(summary)
    print(f"report → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
