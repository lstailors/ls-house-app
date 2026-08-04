#!/usr/bin/env python3
"""
Promote MTMPro Order measurements → Body Measurement Set (customer master).

Source of truth on orders today:
  - MTMPro Order.fit_notes  (SKIN / FINISHED / TROUSER sections)
  - MTMPro Order.design_notes FULL FIELD MAP (fallback)

Master model:
  - Body Measurement Set (status Current/Draft/Superseded) + Body Measurement Detail
  - MTMPro Order.body_measurement_set links the set used
  - Optional Customer lsh_* cache for FOH chips

Usage:
  python3 promote_mtmpro_bms.py --dry-run
  python3 promote_mtmpro_bms.py --dry-run --limit 10
  python3 promote_mtmpro_bms.py --write --status Draft          # safe default
  python3 promote_mtmpro_bms.py --write --status Current --order LST-122512-1
  python3 promote_mtmpro_bms.py --write --status Draft --all

Env: ~/ls-mcp/.env  (ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET)
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path
from typing import Any

ENV_PATH = Path.home() / "ls-mcp" / ".env"
ALIAS_PATH = Path(__file__).resolve().parent / "data" / "measurement_type_aliases.json"
UA = "Mozilla/5.0 (compatible; LSH-Simone-BMS/1.0)"

SECTION_RE = re.compile(
    r"^(SKIN|FINISHED(?:\s*\([^)]*\))?|TROUSER|SHIRT|VEST|JACKET|COAT|BODY|PATTERN|JACKET FINISHED)\s*:?\s*$",
    re.I,
)
SECTION_INLINE_RE = re.compile(
    r"^(SKIN|FINISHED(?:\s*\([^)]*\))?|TROUSER|SHIRT|VEST|JACKET|COAT|JACKET FINISHED)\s*:\s*(.+)$",
    re.I,
)
# "  Chest: 41" or "Chest = 41" or "Chest: 112.5-2.5 = 110"
LINE_RE = re.compile(
    r"^\s*([A-Za-z0-9][A-Za-z0-9 /().'+%-]*?)\s*[:=]\s*(.+?)\s*$"
)
# "Neck 16.25" / "Coat back length 30.25" / "Chest 120.1-7.6 = 112.5"
LABEL_NUM_RE = re.compile(
    r"^\s*([A-Za-z][A-Za-z /().'+%-]*?)\s+("
    r"[0-9]+(?:\s+[0-9]+/[0-9]+)?(?:\.[0-9]+)?"
    r"(?:\s*[-+]\s*[0-9]+(?:\.[0-9]+)?)?"
    r"(?:\s*/\s*[0-9]+(?:\.[0-9]+)?)?"  # 66.3 / 66.3
    r"(?:\s*=\s*[0-9]+(?:\.[0-9]+)?)?"
    r")\s*$"
)
# Tabular: "Wrist Left                7"
TAB_PAIR_RE = re.compile(
    r"([A-Za-z][A-Za-z0-9 /().'+%-]{1,40}?)\s{2,}([0-9]+(?:\.[0-9]+)?(?:\s+[0-9]+/[0-9]+)?)"
)
FMAP_RE = re.compile(r"^([^=\n]+?)\s*=\s*([^\n]+)$", re.M)
# fractions, decimals, expressions ending with = result
FRAC_RE = re.compile(
    r"(?:(\d+)\s+)?(\d+)\s*/\s*(\d+)|(\d+\.\d+)|(\d+)"
)
EXPR_EQ_RE = re.compile(r"=\s*([0-9]+(?:\.[0-9]+)?)\s*$")
# skip non-measure style junk
SKIP_LABEL_RE = re.compile(
    r"^(notes?|fabric|make|canvas|button|lapel|pocket|vent|lining|monogram|"
    r"pleat|adjustor|surcharge|cmt|description|supplier|composition|"
    r"shoulder pad|prev order|try-?on size|fit style|posture|weight|"
    r"new customer|basted)\b",
    re.I,
)


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    if not ENV_PATH.exists():
        raise SystemExit(f"Missing {ENV_PATH}")
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


class Erp:
    def __init__(self, env: dict[str, str]):
        self.base = (env.get("ERPNEXT_URL") or env.get("FRAPPE_URL") or "http://localhost:8080").rstrip("/")
        self.key = env.get("ERPNEXT_API_KEY") or env.get("FRAPPE_API_KEY") or ""
        self.secret = env.get("ERPNEXT_API_SECRET") or env.get("FRAPPE_API_SECRET") or ""
        if not self.key or not self.secret:
            raise SystemExit("ERP API key/secret missing in ls-mcp/.env")

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
            err = e.read().decode()
            raise RuntimeError(f"{method} {path} → {e.code}: {err[:800]}") from e

    def list(self, doctype: str, fields: list[str], filters: list | None = None,
             limit: int = 100, start: int = 0, order_by: str | None = None) -> list[dict]:
        q: dict[str, Any] = {
            "fields": json.dumps(fields),
            "limit_page_length": limit,
            "limit_start": start,
        }
        if filters is not None:
            q["filters"] = json.dumps(filters)
        if order_by:
            q["order_by"] = order_by
        enc = urllib.parse.urlencode(q)
        path = f"/api/resource/{urllib.parse.quote(doctype)}?{enc}"
        return self._req(path).get("data") or []

    def list_all(self, doctype: str, fields: list[str], filters: list | None = None,
                 order_by: str | None = None, page: int = 100) -> list[dict]:
        out: list[dict] = []
        start = 0
        while True:
            batch = self.list(doctype, fields, filters, limit=page, start=start, order_by=order_by)
            out.extend(batch)
            if len(batch) < page:
                break
            start += page
        return out

    def get(self, doctype: str, name: str) -> dict:
        path = f"/api/resource/{urllib.parse.quote(doctype)}/{urllib.parse.quote(name)}"
        return self._req(path)["data"]

    def create(self, doctype: str, doc: dict) -> dict:
        doc = {**doc, "doctype": doctype}
        return self._req(f"/api/resource/{urllib.parse.quote(doctype)}", "POST", doc)["data"]

    def update(self, doctype: str, name: str, values: dict) -> dict:
        path = f"/api/resource/{urllib.parse.quote(doctype)}/{urllib.parse.quote(name)}"
        return self._req(path, "PUT", values)["data"]

    def set_value(self, doctype: str, name: str, field: str, value: Any) -> Any:
        return self._req(
            "/api/method/frappe.client.set_value",
            "POST",
            {"doctype": doctype, "name": name, "fieldname": field, "value": value},
        )


def parse_number(raw: str) -> float | None:
    """Parse '41', '22 1/8', '30 1/5', '112.5-2.5 = 110', '40.0'."""
    s = (raw or "").strip()
    if not s:
        return None
    # prefer trailing "= result"
    m = EXPR_EQ_RE.search(s)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            pass
    # strip trailing junk words
    s = re.split(r"\s{2,}|\t", s)[0].strip()
    # expression without equals: take first number-ish token chain
    # mixed number: 22 1/8
    m = re.match(r"^(\d+)\s+(\d+)\s*/\s*(\d+)\s*$", s)
    if m:
        whole, num, den = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if den:
            return whole + num / den
    m = re.match(r"^(\d+)\s*/\s*(\d+)\s*$", s)
    if m:
        num, den = int(m.group(1)), int(m.group(2))
        if den:
            return num / den
    m = re.match(r"^(\d+\.\d+|\d+)\s*$", s)
    if m:
        return float(m.group(1))
    # "30 1/5" already handled; try find first fraction/decimal in string
    m = re.search(r"(\d+)\s+(\d+)\s*/\s*(\d+)", s)
    if m:
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))
    m = re.search(r"(\d+\.\d+|\d+)", s)
    if m:
        return float(m.group(1))
    return None


def normalize_label(lab: str) -> str:
    lab = re.sub(r"\s+", " ", (lab or "").strip())
    lab = lab.rstrip(":")
    return lab


def _norm_section(s: str) -> str:
    s = re.sub(r"\s*\([^)]*\)", "", s or "").strip().upper().replace(" ", "_")
    if s.startswith("FINISHED"):
        return "FINISHED"
    if s == "JACKET_FINISHED":
        return "FINISHED"
    return s


def _emit_pair(rows: list[dict], section: str, lab: str, val_raw: str, source: str = "fit_notes") -> None:
    lab = normalize_label(lab)
    val_raw = (val_raw or "").strip()
    if not lab or not val_raw:
        return
    if SKIP_LABEL_RE.search(lab):
        return
    if len(lab) > 48:
        return
    if not re.search(r"\d", val_raw):
        return
    # drop pure style leftovers
    if re.search(r"\b(yes|no|none|default|side vents|match)\b", val_raw, re.I) and not re.search(
        r"\d", val_raw
    ):
        return
    num = parse_number(val_raw)
    if num is None or num <= 0 or num > 300:
        return
    rows.append(
        {
            "section": section,
            "label": lab,
            "value_raw": val_raw,
            "value": num,
            "source": source,
        }
    )


def _parse_chunk_pairs(chunk: str, section: str, rows: list[dict]) -> None:
    """Parse 'Neck 16.25; Chest 42' or 'Neck 41.3 | Chest 112.5' or colon lines."""
    if not chunk or not chunk.strip():
        return
    # split on ; or | or commas between measures ("Neck 16, Chest 46, Overarm 54.5")
    # Avoid splitting decimal commas — we use US decimals with dots.
    parts = re.split(r"[;|]", chunk)
    if len(parts) == 1 and chunk.count(",") >= 1:
        # Only comma-split when pattern looks like "Label num, Label num"
        if re.search(r"[A-Za-z].*\d\s*,\s*[A-Za-z]", chunk):
            parts = re.split(r"\s*,\s*", chunk)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # strip trailing parenthetical notes: "54.5 (PDF showed 545 — treated as 54.5)"
        part_core = re.sub(r"\s*\([^)]*\)\s*$", "", part).strip()
        # Prefer "Label number[=result]" before colon/equals split —
        # otherwise "Chest 120.1-7.6 = 112.5" becomes label "Chest 120.1-7.6".
        m = LABEL_NUM_RE.match(part_core)
        if m:
            _emit_pair(rows, section, m.group(1), m.group(2))
            continue
        m = LINE_RE.match(part_core)
        if m:
            lab = m.group(1)
            # reject labels that still look like they swallowed a number
            if re.search(r"\d", lab):
                m2 = LABEL_NUM_RE.match(part_core.replace("=", " = "))
                if m2:
                    _emit_pair(rows, section, m2.group(1), m2.group(2))
                    continue
            _emit_pair(rows, section, lab, m.group(2))
            continue
        # last resort: tabular pairs inside part
        for tm in TAB_PAIR_RE.finditer(part_core):
            _emit_pair(rows, section, tm.group(1), tm.group(2))


def parse_fit_notes(text: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    section = "UNKNOWN"
    if not text:
        return rows
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        # "SKIN: Neck 16.25; Chest 42; ..."
        im = SECTION_INLINE_RE.match(line)
        if im:
            section = _norm_section(im.group(1))
            _parse_chunk_pairs(im.group(2), section, rows)
            continue
        # section headers may be "SKIN:" or "FINISHED (cm as on PDF)" or "JACKET FINISHED"
        sm = SECTION_RE.match(line.rstrip(":"))
        if sm:
            section = _norm_section(sm.group(1))
            continue
        # bare section words mid-garbage
        if line.upper() in {"SKIN", "FINISHED", "TROUSER", "JACKET", "SHIRT"}:
            section = line.upper()
            continue
        # pipe/semicolon multi-measure lines without section prefix
        if ";" in line or (line.count("|") >= 1 and re.search(r"\d", line)):
            _parse_chunk_pairs(line, section, rows)
            continue
        m = LINE_RE.match(line)
        if m:
            _emit_pair(rows, section, m.group(1), m.group(2))
            continue
        m = LABEL_NUM_RE.match(line)
        if m:
            _emit_pair(rows, section, m.group(1), m.group(2))
            continue
        # wide tabular rows: multiple "Label    value" pairs
        pairs = list(TAB_PAIR_RE.finditer(line))
        if len(pairs) >= 1 and re.search(r"\d", line):
            for tm in pairs:
                lab = tm.group(1).strip()
                # filter noise headers
                if lab.lower() in {"measurements", "make type", "model", "new customer"}:
                    continue
                _emit_pair(rows, section, lab, tm.group(2))
    return rows


def parse_field_map(design_notes: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not design_notes or "FULL FIELD MAP" not in design_notes:
        return rows
    part = design_notes.split("FULL FIELD MAP", 1)[1]
    for m in FMAP_RE.finditer(part):
        lab = normalize_label(m.group(1))
        val_raw = m.group(2).strip()
        if SKIP_LABEL_RE.search(lab):
            continue
        if not re.search(r"\d", val_raw):
            continue
        num = parse_number(val_raw)
        if num is None or num <= 0 or num > 300:
            continue
        # Field map mixes style + measures; only keep known measure-ish labels later
        rows.append(
            {
                "section": "FMAP",
                "label": lab,
                "value_raw": val_raw,
                "value": num,
                "source": "field_map",
            }
        )
    return rows


def detect_unit(values: list[float], labels: list[str]) -> str:
    """Girths > ~55 almost always cm for men; coat back ~28-32 in."""
    girth_keys = {"chest", "hips", "hip", "seat", "waist", "overarm", "neck", "thigh"}
    girths = []
    for v, lab in zip(values, labels):
        l = lab.lower()
        if any(g in l for g in girth_keys):
            girths.append(v)
    if girths:
        over = sum(1 for g in girths if g > 55)
        if over >= max(1, len(girths) // 2):
            return "cm"
    return "inches"


def resolve_type(
    label: str,
    section: str,
    aliases: dict,
    known_types: set[str],
) -> str | None:
    sec = section.upper()
    by_sec = aliases.get("by_section", {}).get(sec, {})
    if label in by_sec:
        code = by_sec[label]
        return code if code in known_types else code
    glob = aliases.get("global", {})
    if label in glob:
        return glob[label]
    # case-insensitive
    low = {k.lower(): v for k, v in glob.items()}
    if label.lower() in low:
        return low[label.lower()]
    for k, v in by_sec.items():
        if k.lower() == label.lower():
            return v
    return None


def load_type_meta(erp: Erp) -> dict[str, dict]:
    rows = erp.list_all(
        "Measurement Type",
        ["name", "measurement_name", "bucket", "garment_class", "default_unit", "is_body_master", "is_active", "aliases"],
    )
    return {r["name"]: r for r in rows}


def patch_aliases_on_types(erp: Erp, aliases: dict, dry: bool) -> int:
    """Write alias strings onto Measurement Type docs (best-effort)."""
    # invert map
    inv: dict[str, set[str]] = defaultdict(set)
    for lab, code in aliases.get("global", {}).items():
        inv[code].add(lab)
    for sec, m in aliases.get("by_section", {}).items():
        for lab, code in m.items():
            inv[code].add(lab)
    updated = 0
    meta = load_type_meta(erp)
    for code, labs in inv.items():
        if code not in meta:
            continue
        existing = meta[code].get("aliases") or ""
        merged = sorted(set(x.strip() for x in re.split(r"[\n,;]+", existing) if x.strip()) | labs)
        new_val = "\n".join(merged)
        if new_val.strip() == (existing or "").strip():
            continue
        if dry:
            updated += 1
            continue
        try:
            erp.update("Measurement Type", code, {"aliases": new_val})
            updated += 1
        except Exception as e:
            print(f"  warn alias {code}: {e}", file=sys.stderr)
    return updated


def build_measurements(
    parsed: list[dict],
    aliases: dict,
    type_meta: dict[str, dict],
    body_only: bool,
) -> tuple[list[dict], list[dict], str]:
    """Return (master_rows, order_rows, unit)."""
    known = set(type_meta)
    body_codes = set(aliases.get("body_master_codes") or [])
    # Prefer fit_notes over fmap for same type+section
    chosen: dict[tuple[str, str], dict] = {}
    unmapped: list[dict] = []

    # Prefer fit_notes first
    ordered = sorted(parsed, key=lambda r: 0 if r["source"] == "fit_notes" else 1)

    for r in ordered:
        code = resolve_type(r["label"], r["section"], aliases, known)
        if not code:
            # FMAP only keep if maps
            unmapped.append(r)
            continue
        if code not in known:
            unmapped.append({**r, "unmapped_code": code})
            continue
        key = (code, r["section"])
        if key in chosen and chosen[key]["source"] == "fit_notes":
            continue
        if key not in chosen:
            chosen[key] = {**r, "code": code}

    unit = detect_unit(
        [c["value"] for c in chosen.values()],
        [c["label"] for c in chosen.values()],
    )

    master_rows: list[dict] = []
    order_rows: list[dict] = []
    seen_master: set[str] = set()

    for (code, section), r in chosen.items():
        meta = type_meta.get(code, {})
        bucket = meta.get("bucket") or (
            "Skin" if section in {"SKIN", "JACKET", "BODY"} else
            "Trouser" if section == "TROUSER" else
            "Finished" if section in {"FINISHED", "FMAP"} else
            "Other"
        )
        garment = meta.get("garment_class") or "Universal"
        row = {
            "measurement_type": code,
            "bucket": bucket,
            "garment_class": garment,
            "value": round(float(r["value"]), 3),
            "unit": meta.get("default_unit") or unit,
            "notes": f"{r['section']}|{r['label']}={r['value_raw']} ({r['source']})",
        }
        # Unit: if detected cm and type default inches, prefer detected for skin girths
        if unit == "cm" and (meta.get("default_unit") or "inches") == "inches":
            if bucket in {"Skin", "Body Shape"} or code in body_codes:
                row["unit"] = "cm"

        is_master = bool(meta.get("is_body_master")) or code in body_codes
        # Skin-ish sections preferred for master; finished never auto-master unless flagged
        if section in {"FINISHED"} and code not in {
            "POINT_TO_POINT", "COAT_BACK_LEN", "SLEEVE_OUT_L", "SLEEVE_OUT_R", "FRONT_LEN"
        }:
            # finished garment numbers stay order-scoped unless body_master
            if not meta.get("is_body_master"):
                is_master = False

        if body_only:
            if is_master and code not in seen_master:
                # prefer SKIN section over others for same code
                master_rows.append(row)
                seen_master.add(code)
            else:
                order_rows.append(row)
        else:
            order_rows.append(row)
            if is_master and code not in seen_master and section in {
                "SKIN", "JACKET", "BODY", "TROUSER", "UNKNOWN", "FMAP"
            }:
                # For TROUSER/FMAP only take skin-coded types
                if section == "TROUSER" and "FIN" in code and code not in {"FRONT_RISE", "BACK_RISE"}:
                    pass
                else:
                    master_rows.append(row)
                    seen_master.add(code)

    # Dedupe master by type: prefer SKIN section notes
    return master_rows, order_rows, unit


def next_version(erp: Erp, customer: str) -> int:
    rows = erp.list(
        "Body Measurement Set",
        ["name", "version"],
        filters=[["customer", "=", customer]],
        limit=50,
        order_by="version desc",
    )
    if not rows:
        return 1
    try:
        return int(rows[0].get("version") or 0) + 1
    except Exception:
        return len(rows) + 1


def supersede_current(erp: Erp, customer: str, dry: bool) -> list[str]:
    cur = erp.list(
        "Body Measurement Set",
        ["name", "status"],
        filters=[["customer", "=", customer], ["status", "=", "Current"]],
        limit=20,
    )
    names = [c["name"] for c in cur]
    if dry:
        return names
    for n in names:
        erp.update("Body Measurement Set", n, {"status": "Superseded"})
    return names


def promote_order(
    erp: Erp,
    order: dict,
    aliases: dict,
    type_meta: dict[str, dict],
    *,
    status: str,
    write: bool,
    update_customer_cache: bool,
    skip_if_linked: bool,
) -> dict[str, Any]:
    name = order["name"]
    customer = order.get("customer")
    result: dict[str, Any] = {
        "order": name,
        "customer": customer,
        "ok": False,
        "skipped": False,
    }

    if not customer:
        result["error"] = "no customer"
        return result

    if skip_if_linked and order.get("body_measurement_set"):
        result["skipped"] = True
        result["reason"] = f"already linked {order['body_measurement_set']}"
        return result

    parsed = parse_fit_notes(order.get("fit_notes") or "")
    fmap = parse_field_map(order.get("design_notes") or "")
    # Only use fmap labels that resolve
    master_rows, order_rows, unit = build_measurements(
        parsed + fmap, aliases, type_meta, body_only=False
    )

    # Rebuild master: prefer explicit body_master_codes + Skin/Body Shape buckets.
    # Do NOT pull pure Finished garment specs (½ knee, yoke fin, etc.) into customer master.
    master_by_code: dict[str, dict] = {}
    body_codes = set(aliases.get("body_master_codes") or [])
    skin_pref = ("SKIN|", "JACKET|", "BODY|", "TROUSER|")

    def _is_master_row(r: dict) -> bool:
        code = r["measurement_type"]
        meta = type_meta.get(code, {})
        bucket = (r.get("bucket") or meta.get("bucket") or "").lower()
        notes = r.get("notes") or ""
        if code in body_codes:
            return True
        if bucket in {"skin", "body shape"} and meta.get("is_body_master"):
            return True
        # Trouser skin-ish from TROUSER section
        if notes.startswith("TROUSER|") and code in {
            "SEAT_SKIN", "THIGH_SKIN", "PANT_WAIST", "FRONT_RISE", "BACK_RISE",
            "TROUSER_OUT_L", "TROUSER_OUT_R", "TROUSER_IN_L", "TROUSER_IN_R",
        }:
            return True
        return False

    for r in master_rows + order_rows:
        if not _is_master_row(r):
            continue
        code = r["measurement_type"]
        prev = master_by_code.get(code)
        score = 0
        notes = r.get("notes") or ""
        if notes.startswith("SKIN|"):
            score += 3
        elif any(notes.startswith(p) for p in skin_pref):
            score += 2
        if (r.get("bucket") or "").lower() == "skin":
            score += 1
        prev_score = 0
        if prev:
            pn = prev.get("notes") or ""
            if pn.startswith("SKIN|"):
                prev_score += 3
            elif any(pn.startswith(p) for p in skin_pref):
                prev_score += 2
        if not prev or score >= prev_score:
            master_by_code[code] = r
    master_final = list(master_by_code.values())

    result["parsed_fit"] = len(parsed)
    result["parsed_fmap"] = len(fmap)
    result["master_count"] = len(master_final)
    result["order_meas_count"] = len(order_rows)
    result["unit"] = unit
    result["master_types"] = [m["measurement_type"] for m in master_final]

    if not master_final:
        result["error"] = "no master measurements resolved"
        result["sample_labels"] = [p["label"] for p in parsed[:12]]
        return result

    ver = next_version(erp, customer) if write else 1
    captured = order.get("order_date") or str(date.today())
    doc = {
        "customer": customer,
        "version": ver if write else next_version(erp, customer),
        "status": status,
        "captured_date": captured,
        "reason_for_capture": "Initial Body Block" if status in {"Current", "Draft"} else "Reorder Check",
        "mtmpro_source_order": name,
        "general_notes": (
            f"Promoted from MTMPro {name} ({order.get('order_type') or ''}). "
            f"Unit detect={unit}. Master rows={len(master_final)}. "
            f"Order still holds finished measures in fit_notes."
        ),
        "measurements": master_final,
    }
    result["version"] = doc["version"]
    result["payload_preview"] = {
        "customer": customer,
        "status": status,
        "measurements": [
            {"type": m["measurement_type"], "value": m["value"], "unit": m["unit"], "bucket": m["bucket"]}
            for m in master_final
        ],
    }

    if not write:
        result["ok"] = True
        result["dry_run"] = True
        return result

    # write path
    superseded = supersede_current(erp, customer, dry=False) if status == "Current" else []
    if superseded:
        doc["supersedes"] = superseded[0]
    created = erp.create("Body Measurement Set", doc)
    bms_name = created["name"]
    result["bms"] = bms_name
    result["superseded"] = superseded

    # link order
    try:
        erp.update("MTMPro Order", name, {"body_measurement_set": bms_name})
        result["linked_order"] = True
    except Exception as e:
        result["linked_order"] = False
        result["link_error"] = str(e)[:300]

    # customer cache
    if update_customer_cache and status == "Current":
        cache_map = aliases.get("customer_cache") or {}
        cache_doc = {}
        for m in master_final:
            field = cache_map.get(m["measurement_type"])
            if not field:
                continue
            val = m["value"]
            # cache fields are labeled inches — convert cm → in
            if m.get("unit") == "cm":
                val = round(val / 2.54, 2)
            cache_doc[field] = val
        if cache_doc:
            try:
                erp.update("Customer", customer, cache_doc)
                result["customer_cache"] = cache_doc
            except Exception as e:
                result["customer_cache_error"] = str(e)[:300]

    result["ok"] = True
    return result


def main() -> int:
    ap = argparse.ArgumentParser(description="Promote MTMPro measures → Body Measurement Set")
    ap.add_argument("--dry-run", action="store_true", help="Parse only, no writes (default if no --write)")
    ap.add_argument("--write", action="store_true", help="Create BMS + link orders")
    ap.add_argument("--status", default="Draft", choices=["Draft", "Current"], help="BMS status on write")
    ap.add_argument("--order", action="append", default=[], help="Specific MTMPro Order name(s)")
    ap.add_argument("--all", action="store_true", help="All orders with fit_notes set")
    ap.add_argument("--limit", type=int, default=0, help="Cap orders processed")
    ap.add_argument("--include-linked", action="store_true", help="Also process orders already linked")
    ap.add_argument("--no-customer-cache", action="store_true", help="Do not write Customer lsh_* fields")
    ap.add_argument("--patch-aliases", action="store_true", help="Write alias list onto Measurement Type docs")
    ap.add_argument("--report", default="", help="Write JSON report path")
    args = ap.parse_args()

    write = bool(args.write)
    if not write:
        args.dry_run = True

    env = load_env()
    erp = Erp(env)
    aliases = json.loads(ALIAS_PATH.read_text())
    type_meta = load_type_meta(erp)
    print(f"ERP {erp.base} · Measurement Types={len(type_meta)} · mode={'WRITE' if write else 'DRY-RUN'} · status={args.status}")

    if args.patch_aliases:
        n = patch_aliases_on_types(erp, aliases, dry=not write)
        print(f"aliases {'would update' if not write else 'updated'}: {n}")

    fields = [
        "name", "customer", "order_date", "order_type", "fit_notes",
        "design_notes", "body_measurement_set", "order_status",
    ]

    if args.order:
        orders = []
        for n in args.order:
            try:
                orders.append(erp.get("MTMPro Order", n))
            except Exception as e:
                print(f"fail get {n}: {e}", file=sys.stderr)
    else:
        # default: all with fit_notes
        orders = erp.list_all(
            "MTMPro Order",
            fields,
            filters=[["fit_notes", "is", "set"]],
            order_by="order_date desc",
        )
        if not args.all and not args.order and not args.limit:
            # default dry-run processes all; write requires --all or --order
            if write:
                raise SystemExit("Refusing write without --order or --all")

    if args.limit and args.limit > 0:
        orders = orders[: args.limit]

    print(f"orders to process: {len(orders)}")

    results = []
    stats = Counter()
    unmapped_labels = Counter()

    for o in orders:
        # ensure fields
        if "fit_notes" not in o or (args.order and "design_notes" not in o):
            o = erp.get("MTMPro Order", o["name"])
        r = promote_order(
            erp,
            o,
            aliases,
            type_meta,
            status=args.status,
            write=write,
            update_customer_cache=not args.no_customer_cache,
            skip_if_linked=not args.include_linked,
        )
        results.append(r)
        if r.get("skipped"):
            stats["skipped"] += 1
        elif r.get("ok"):
            stats["ok"] += 1
            stats["master_rows"] += r.get("master_count") or 0
        else:
            stats["fail"] += 1
            for lab in r.get("sample_labels") or []:
                unmapped_labels[lab] += 1

        flag = "SKIP" if r.get("skipped") else ("OK" if r.get("ok") else "FAIL")
        extra = r.get("bms") or r.get("reason") or r.get("error") or f"master={r.get('master_count')}"
        print(f"  [{flag}] {r.get('order')} · {r.get('customer')} · {extra} · types={r.get('master_types')}")

    print("\n=== SUMMARY ===")
    print(dict(stats))
    if unmapped_labels:
        print("sample fail labels:", unmapped_labels.most_common(15))

    # coverage
    ok_results = [r for r in results if r.get("ok")]
    if ok_results:
        avg = sum(r["master_count"] for r in ok_results) / len(ok_results)
        print(f"avg master rows/order: {avg:.1f}")
        type_c = Counter()
        for r in ok_results:
            type_c.update(r.get("master_types") or [])
        print("top master types:", type_c.most_common(15))

    report = {
        "mode": "write" if write else "dry_run",
        "status": args.status,
        "stats": dict(stats),
        "results": results,
    }
    out = Path(args.report) if args.report else Path(__file__).resolve().parent / "data" / f"bms_promote_{'write' if write else 'dry'}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, default=str))
    print(f"report → {out}")
    return 0 if stats["fail"] == 0 or stats["ok"] > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
