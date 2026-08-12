#!/usr/bin/env python3
"""
Link Customer masters: Current BMS + Body Profile + measure cache + photo fields.

Makes Customer the hub so staff/portal open one record and follow:
  Customer
    ├─ lsh_current_bms      → Body Measurement Set (status=Current)  [SoT tape]
    ├─ lsh_body_profile     → Customer Body Profile                  [posture + photo URLs]
    ├─ image / lsh_headshot / lsh_photo_*                            [portal photos]
    └─ lsh_chest/seat/back/outseam                                   [FOH cache only]

  MTMPro Order.body_measurement_set → same BMS used on that order
  Sales Order.mtmpro_order → MTMPro

Usage:
  python3 link_customer_masters.py --dry-run
  python3 link_customer_masters.py --write
  python3 link_customer_masters.py --write --customer "Lorenzo Brook"
  python3 link_customer_masters.py --write --all-with-data
"""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Any

ENV_PATH = Path.home() / "ls-mcp" / ".env"
UA = "Mozilla/5.0 (compatible; LSH-Simone-MasterLink/1.0)"

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
            raise RuntimeError(f"{method} {path} → {e.code}: {e.read().decode()[:700]}") from e

    def list_all(self, doctype: str, fields: list[str], filters=None) -> list[dict]:
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


def cache_from_bms(full: dict) -> dict[str, float]:
    out: dict[str, float] = {}
    for row in full.get("measurements") or []:
        code = row.get("measurement_type") or row.get("measurement_type_code") or ""
        # some rows store type name only
        field = CACHE_MAP.get(code)
        if not field:
            continue
        try:
            val = inches(float(row.get("value") or 0), row.get("unit"))
        except (TypeError, ValueError):
            continue
        if val <= 0:
            continue
        # first wins except outseam prefer L then R already ordered by map iterate
        if field not in out:
            out[field] = val
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--customer", action="append", default=[])
    ap.add_argument(
        "--all-with-data",
        action="store_true",
        help="Every customer that has BMS or Body Profile or headshot (default)",
    )
    ap.add_argument("--report", default="")
    args = ap.parse_args()
    write = bool(args.write)
    if not write:
        args.dry_run = True

    env = load_env()
    erp = Erp(env)
    print(f"ERP {erp.base} · mode={'WRITE' if write else 'DRY-RUN'}")

    # Index Current BMS by customer
    bms_rows = erp.list_all(
        "Body Measurement Set",
        ["name", "customer", "status", "version", "captured_date", "mtmpro_source_order"],
    )
    current_by_cust: dict[str, str] = {}
    all_bms_cust: set[str] = set()
    multi_current: list[str] = []
    by_cust_sets: dict[str, list[dict]] = defaultdict(list)
    for r in bms_rows:
        c = r.get("customer")
        if not c:
            continue
        all_bms_cust.add(c)
        by_cust_sets[c].append(r)
    for c, sets in by_cust_sets.items():
        curs = [s for s in sets if s.get("status") == "Current"]
        if len(curs) == 1:
            current_by_cust[c] = curs[0]["name"]
        elif len(curs) > 1:
            multi_current.append(c)
            # pick latest by date
            curs.sort(key=lambda s: (s.get("captured_date") or "", s.get("version") or 0), reverse=True)
            current_by_cust[c] = curs[0]["name"]
        else:
            # no Current — pick Draft or fullest name latest
            drafts = [s for s in sets if s.get("status") == "Draft"]
            pick = drafts or sets
            pick.sort(key=lambda s: (s.get("captured_date") or "", s.get("name") or ""), reverse=True)
            current_by_cust[c] = pick[0]["name"]

    # Body profiles
    profiles = erp.list_all(
        "Customer Body Profile",
        [
            "name",
            "customer",
            "body_photo_front_url",
            "body_photo_back_url",
            "body_photo_right_url",
            "body_photo_left_url",
        ],
    )
    profile_by_cust: dict[str, dict] = {}
    for p in profiles:
        if p.get("customer"):
            # one per customer expected; last wins
            profile_by_cust[p["customer"]] = p

    # Customers with headshot
    photo_custs = {
        r["name"]
        for r in erp.list_all(
            "Customer",
            ["name"],
            filters=[["lsh_headshot", "is", "set"]],
        )
    }

    if args.customer:
        targets = args.customer
    else:
        targets = sorted(all_bms_cust | set(profile_by_cust) | photo_custs)

    print(
        f"targets={len(targets)} · Current BMS map={len(current_by_cust)} · "
        f"profiles={len(profile_by_cust)} · multi-current={len(multi_current)}"
    )
    if multi_current:
        print("  WARN multi Current:", multi_current[:10])

    results = []
    stats: dict[str, int] = defaultdict(int)
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    for customer in targets:
        entry: dict[str, Any] = {"customer": customer, "ok": False}
        try:
            cust = erp.get("Customer", customer)
        except Exception as e:
            entry["error"] = str(e)[:200]
            results.append(entry)
            stats["fail"] += 1
            continue

        patch: dict[str, Any] = {}
        bms_name = current_by_cust.get(customer)
        prof = profile_by_cust.get(customer)

        if bms_name and cust.get("lsh_current_bms") != bms_name:
            patch["lsh_current_bms"] = bms_name
            entry["bms"] = bms_name
        elif bms_name:
            entry["bms"] = bms_name
            entry["bms_already"] = True

        if prof:
            pname = prof["name"]
            if cust.get("lsh_body_profile") != pname:
                patch["lsh_body_profile"] = pname
            entry["body_profile"] = pname

            # photo URLs → customer attach fields if missing
            front = prof.get("body_photo_front_url")
            side = prof.get("body_photo_right_url")
            back = prof.get("body_photo_back_url")
            if front and not cust.get("lsh_photo_front"):
                patch["lsh_photo_front"] = front
            if side and not cust.get("lsh_photo_side"):
                patch["lsh_photo_side"] = side
            if back and not cust.get("lsh_photo_back"):
                patch["lsh_photo_back"] = back
            if front and not cust.get("lsh_headshot"):
                patch["lsh_headshot"] = front
            if front and not cust.get("image"):
                patch["image"] = front
            if cust.get("lsh_portal_show_photos") in (None, 0, "0") and (
                front or cust.get("lsh_headshot")
            ):
                patch["lsh_portal_show_photos"] = 1

        # measure cache from Current BMS
        if bms_name:
            try:
                full = erp.get("Body Measurement Set", bms_name)
                cache = cache_from_bms(full)
                entry["cache"] = cache
                for field, val in cache.items():
                    cur = cust.get(field)
                    try:
                        cur_f = float(cur) if cur not in (None, "") else None
                    except (TypeError, ValueError):
                        cur_f = None
                    if cur_f is None or abs(cur_f - val) > 0.011:
                        patch[field] = val
                # ensure MTMPro still linked to this BMS when source order set
                src = full.get("mtmpro_source_order")
                if src:
                    try:
                        mtm = erp.get("MTMPro Order", src)
                        if mtm.get("body_measurement_set") != bms_name:
                            if write:
                                erp.update(
                                    "MTMPro Order",
                                    src,
                                    {"body_measurement_set": bms_name},
                                )
                            entry["relink_mtmpro"] = src
                            stats["mtmpro_relink"] += 1
                    except Exception as e:
                        entry["mtmpro_err"] = str(e)[:120]
            except Exception as e:
                entry["bms_err"] = str(e)[:200]

        if patch:
            patch["lsh_masters_synced_on"] = now
            entry["patch"] = {k: v for k, v in patch.items() if k != "lsh_masters_synced_on"}
            if write:
                try:
                    erp.update("Customer", customer, patch)
                    entry["ok"] = True
                    stats["updated"] += 1
                    print(f"  [OK] {customer} · {list(entry['patch'].keys())}")
                except Exception as e:
                    entry["error"] = str(e)[:300]
                    stats["fail"] += 1
                    print(f"  [FAIL] {customer} · {e}")
            else:
                entry["ok"] = True
                entry["dry_run"] = True
                stats["ok"] += 1
                print(f"  [DRY] {customer} · {list(entry['patch'].keys())}")
        else:
            entry["ok"] = True
            entry["skipped"] = True
            stats["skipped"] += 1
            print(f"  [SKIP] {customer} already linked")

        results.append(entry)

    report = {
        "mode": "write" if write else "dry_run",
        "stats": dict(stats),
        "targets": len(targets),
        "multi_current": multi_current,
        "results": results,
    }
    out = (
        Path(args.report)
        if args.report
        else Path(__file__).resolve().parent
        / "data"
        / f"master_links_{'write' if write else 'dry'}.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, default=str))
    print("\n=== SUMMARY ===")
    print(dict(stats))
    print(f"report → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
