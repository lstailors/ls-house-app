#!/usr/bin/env python3
"""
Match customer Photos PDFs → Customer image + attachments + lsh_photos.

Sources (in order):
  1) ERP File records with file_name like %Photos%
  2) ~/Downloads/*Photos*.pdf
  3) Already-attached Customer fitting jpgs

For each Current BMS customer (or --all-customers):
  - Resolve best Photos PDF by name match
  - Extract embedded images (pymupdf) as front/side/back jpgs
  - Upload public File attached to Customer
  - Set Customer.image = front
  - Set Customer.lsh_photos = JSON list of {view,url,file_name}
  - Upsert Customer Body Profile photo URL fields when present
  - Attach PDF to Customer if not already

Usage:
  python3 match_customer_photos.py --dry-run
  python3 match_customer_photos.py --write
  python3 match_customer_photos.py --write --customer "Lorenzo Brook"
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import fitz  # pymupdf
from PIL import Image

ENV_PATH = Path.home() / "ls-mcp" / ".env"
DOWNLOADS = Path.home() / "Downloads"
WORK = Path("/tmp/lsh-customer-photos")
UA = "Mozilla/5.0 (compatible; LSH-Simone-Photos/1.0)"

VIEW_ORDER = ("front", "side", "back", "other")


def load_env() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def norm_name(s: str) -> str:
    s = (s or "").lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def name_from_photo_filename(fn: str) -> str:
    """Lorenzo__Brook_Photos_07-29-26.pdf → Lorenzo Brook"""
    base = Path(fn).stem
    base = re.sub(r"_?\d+$", "", base)  # trailing _1
    base = re.sub(r"_Photos_.*$", "", base, flags=re.I)
    base = re.sub(r"_Photo_.*$", "", base, flags=re.I)
    base = base.replace("__", " ").replace("_", " ")
    base = re.sub(r"\s+", " ", base).strip()
    return base


class Erp:
    def __init__(self, env: dict[str, str]):
        self.base = (env.get("ERPNEXT_URL") or "http://localhost:8080").rstrip("/")
        self.key = env["ERPNEXT_API_KEY"]
        self.secret = env["ERPNEXT_API_SECRET"]

    def _auth(self) -> str:
        return f"token {self.key}:{self.secret}"

    def _req(self, path: str, method: str = "GET", data: Any = None) -> Any:
        body = None if data is None else json.dumps(data).encode()
        req = urllib.request.Request(self.base + path, data=body, method=method)
        req.add_header("Authorization", self._auth())
        req.add_header("Content-Type", "application/json")
        req.add_header("User-Agent", UA)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} → {e.code}: {e.read().decode()[:700]}") from e

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

    def create(self, doctype: str, doc: dict) -> dict:
        doc = {**doc, "doctype": doctype}
        return self._req(f"/api/resource/{urllib.parse.quote(doctype)}", "POST", doc)["data"]

    def download_file(self, file_url: str) -> bytes:
        # file_url like /private/files/x.pdf or /files/x.pdf
        url = file_url if file_url.startswith("http") else self.base + file_url
        req = urllib.request.Request(url)
        req.add_header("Authorization", self._auth())
        req.add_header("User-Agent", UA)
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()

    def upload_file(
        self,
        filename: str,
        content: bytes,
        *,
        doctype: str,
        docname: str,
        is_private: int = 0,
    ) -> dict:
        """POST /api/method/upload_file multipart."""
        boundary = "----LshBoundary7MA4YWxkTrZu0gW"
        parts: list[bytes] = []

        def add(name: str, value: str):
            parts.append(
                (
                    f"--{boundary}\r\n"
                    f'Content-Disposition: form-data; name="{name}"\r\n\r\n'
                    f"{value}\r\n"
                ).encode()
            )

        add("is_private", str(is_private))
        add("folder", "Home/Attachments")
        add("doctype", doctype)
        add("docname", docname)
        add("decode_response", "true")
        parts.append(
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                f"Content-Type: application/octet-stream\r\n\r\n"
            ).encode()
            + content
            + b"\r\n"
        )
        parts.append(f"--{boundary}--\r\n".encode())
        body = b"".join(parts)
        req = urllib.request.Request(self.base + "/api/method/upload_file", data=body, method="POST")
        req.add_header("Authorization", self._auth())
        req.add_header("User-Agent", UA)
        req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                payload = json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"upload_file {filename} → {e.code}: {e.read().decode()[:700]}") from e
        # shape: {message: {file_url, name, ...}} or {message: "..."}
        msg = payload.get("message")
        if isinstance(msg, dict):
            return msg
        if isinstance(msg, str) and msg.startswith("/"):
            return {"file_url": msg, "file_name": filename}
        # some versions nest under data
        if payload.get("file_url"):
            return payload
        raise RuntimeError(f"unexpected upload response: {str(payload)[:400]}")


def extract_images_from_pdf(pdf_bytes: bytes, slug: str) -> list[tuple[str, bytes]]:
    """Return [(view, jpeg_bytes), ...] ordered front/side/back/other."""
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    raw_imgs: list[bytes] = []
    try:
        for page in doc:
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    pix = fitz.Pixmap(doc, xref)
                    if pix.n - pix.alpha >= 4:  # CMYK
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    # skip tiny icons
                    if pix.width < 80 or pix.height < 80:
                        continue
                    bio = io.BytesIO()
                    # Pixmap to PIL
                    mode = "RGBA" if pix.alpha else "RGB"
                    im = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
                    if im.mode == "RGBA":
                        im = im.convert("RGB")
                    # downscale huge
                    max_side = 1600
                    if max(im.size) > max_side:
                        im.thumbnail((max_side, max_side), Image.LANCZOS)
                    im.save(bio, format="JPEG", quality=85, optimize=True)
                    raw_imgs.append(bio.getvalue())
                except Exception:
                    continue
    finally:
        doc.close()

    # Dedup by size
    seen = set()
    unique: list[bytes] = []
    for b in raw_imgs:
        key = (len(b), b[:64])
        if key in seen:
            continue
        seen.add(key)
        unique.append(b)

    labeled: list[tuple[str, bytes]] = []
    # Prefer largest images first (real photos > logos)
    unique.sort(key=len, reverse=True)
    unique = unique[:4]
    views = ["front", "side", "back"]
    for i, b in enumerate(unique):
        view = views[i] if i < len(views) else f"other{i - 2}"
        labeled.append((view, b))
    return labeled


def score_match(customer: str, photo_label: str) -> float:
    a_tokens = norm_name(customer).split()
    b_tokens = norm_name(photo_label).split()
    a, b = set(a_tokens), set(b_tokens)
    if not a or not b:
        return 0.0
    if a == b:
        return 100.0
    lasts_a = a_tokens[-1]
    lasts_b = b_tokens[-1]
    if lasts_a != lasts_b:
        return 0.0
    firsts_a = set(a_tokens[:-1])
    firsts_b = set(b_tokens[:-1])
    # Different first names with same last name → not a match (Sid vs Siddhartha)
    if firsts_a and firsts_b and not (firsts_a & firsts_b):
        # allow initial match: "NS" / "N"
        initials_ok = False
        for fa in firsts_a:
            for fb in firsts_b:
                if fa[0] == fb[0] and (len(fa) == 1 or len(fb) == 1):
                    initials_ok = True
        if not initials_ok:
            return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / max(len(a), len(b)) * 50 + inter * 10


def pick_best_pdf(
    customer: str, candidates: list[dict]
) -> dict | None:
    scored = []
    for c in candidates:
        s = score_match(customer, c["label"])
        if s >= 20:
            scored.append((s, c.get("creation") or "", c))
    if not scored:
        return None
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return scored[0][2]


def upsert_body_profile(erp: Erp, customer: str, urls: dict[str, str], write: bool) -> str | None:
    existing = erp.list_all(
        "Customer Body Profile",
        ["name"],
        filters=[["customer", "=", customer]],
    )
    fields = {
        "body_photo_front_url": urls.get("front"),
        "body_photo_right_url": urls.get("side") or urls.get("right"),
        "body_photo_back_url": urls.get("back"),
        "body_photo_left_url": urls.get("left"),
    }
    fields = {k: v for k, v in fields.items() if v}
    if not fields:
        return None
    if existing:
        if write:
            erp.update("Customer Body Profile", existing[0]["name"], fields)
        return existing[0]["name"]
    doc = {
        "customer": customer,
        "established_at": f"{date.today()} 12:00:00",
        "established_by_tailor": "Simone photo backfill",
        **fields,
    }
    if write:
        created = erp.create("Customer Body Profile", doc)
        return created["name"]
    return "(new)"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--customer", action="append", default=[])
    ap.add_argument("--all-customers", action="store_true", help="All active customers, not just BMS Current")
    ap.add_argument("--force", action="store_true", help="Re-extract even if Customer.image set")
    ap.add_argument("--report", default="")
    args = ap.parse_args()
    write = bool(args.write)
    if not write:
        args.dry_run = True

    env = load_env()
    erp = Erp(env)
    WORK.mkdir(parents=True, exist_ok=True)
    print(f"ERP {erp.base} · mode={'WRITE' if write else 'DRY-RUN'}")

    # Target customers
    if args.customer:
        targets = args.customer
    elif args.all_customers:
        rows = erp.list_all(
            "Customer",
            ["name"],
            filters=[["disabled", "=", 0]],
        )
        targets = [r["name"] for r in rows]
    else:
        rows = erp.list_all(
            "Body Measurement Set",
            ["customer"],
            filters=[["status", "=", "Current"]],
        )
        targets = sorted({r["customer"] for r in rows})
    print(f"targets: {len(targets)}")

    # Photo PDF candidates from ERP
    files = erp.list_all(
        "File",
        ["name", "file_name", "file_url", "is_private", "creation", "attached_to_doctype", "attached_to_name"],
        filters=[["file_name", "like", "%Photos%"]],
    )
    candidates: list[dict] = []
    seen_urls = set()
    for f in files:
        fn = f.get("file_name") or ""
        if not re.search(r"photos?", fn, re.I):
            continue
        if not fn.lower().endswith(".pdf"):
            continue
        label = name_from_photo_filename(fn)
        url = f.get("file_url") or ""
        if url in seen_urls:
            continue
        seen_urls.add(url)
        candidates.append(
            {
                "label": label,
                "file_name": fn,
                "file_url": url,
                "source": "erp",
                "creation": f.get("creation") or "",
                "file_doc": f.get("name"),
            }
        )

    # Downloads fallback
    for p in sorted(DOWNLOADS.glob("*[Pp]hoto*.pdf")):
        label = name_from_photo_filename(p.name)
        key = f"local:{p.name}"
        if key in seen_urls:
            continue
        seen_urls.add(key)
        candidates.append(
            {
                "label": label,
                "file_name": p.name,
                "file_url": str(p),
                "source": "downloads",
                "creation": str(p.stat().st_mtime),
                "path": p,
            }
        )

    print(f"photo PDF candidates: {len(candidates)}")

    results = []
    stats = defaultdict(int)

    for customer in targets:
        entry: dict[str, Any] = {"customer": customer, "ok": False}
        try:
            cust = erp.get("Customer", customer)
        except Exception as e:
            entry["error"] = f"get customer: {e}"
            results.append(entry)
            stats["fail"] += 1
            continue

        if cust.get("image") and not args.force:
            # still try to fill lsh_photos if empty
            if cust.get("lsh_photos") and not args.force:
                entry["skipped"] = True
                entry["reason"] = f"already has image {cust.get('image')}"
                results.append(entry)
                stats["skipped"] += 1
                print(f"  [SKIP] {customer} · has image")
                continue

        pdf = pick_best_pdf(customer, candidates)
        if not pdf:
            entry["error"] = "no photo PDF match"
            results.append(entry)
            stats["no_match"] += 1
            print(f"  [NO MATCH] {customer}")
            continue

        entry["pdf"] = pdf["file_name"]
        entry["pdf_source"] = pdf["source"]
        entry["match_label"] = pdf["label"]

        # load bytes
        try:
            if pdf["source"] == "downloads":
                pdf_bytes = Path(pdf["file_url"]).read_bytes()
            else:
                pdf_bytes = erp.download_file(pdf["file_url"])
        except Exception as e:
            entry["error"] = f"download pdf: {e}"
            results.append(entry)
            stats["fail"] += 1
            print(f"  [FAIL] {customer} download {e}")
            continue

        images = extract_images_from_pdf(pdf_bytes, norm_name(customer).replace(" ", "_"))
        entry["extracted"] = len(images)
        if not images:
            entry["error"] = "no images in PDF"
            results.append(entry)
            stats["fail"] += 1
            print(f"  [FAIL] {customer} no images in {pdf['file_name']}")
            continue

        slug = re.sub(r"[^a-z0-9]+", "_", norm_name(customer)).strip("_")
        day = date.today().isoformat()
        uploaded: list[dict] = []
        view_urls: dict[str, str] = {}

        if not write:
            entry["ok"] = True
            entry["dry_run"] = True
            entry["would_upload"] = [
                f"{slug}_fitting_{day}_{view}.jpg ({len(b)}b)" for view, b in images
            ]
            results.append(entry)
            stats["ok"] += 1
            print(
                f"  [DRY] {customer} ← {pdf['file_name']} · {len(images)} imgs · views={[v for v,_ in images]}"
            )
            continue

        # Upload images
        for view, jpeg in images:
            fname = f"{slug}_fitting_{day}_{view}.jpg"
            try:
                up = erp.upload_file(
                    fname,
                    jpeg,
                    doctype="Customer",
                    docname=customer,
                    is_private=0,
                )
                url = up.get("file_url") or up.get("name")
                uploaded.append({"view": view, "file_name": fname, "file_url": url, "file": up.get("name")})
                view_urls[view] = url
            except Exception as e:
                entry.setdefault("upload_errors", []).append(f"{view}: {e}")

        # Attach PDF to customer if from erp or local
        try:
            pdf_name = pdf["file_name"]
            # avoid re-upload if same name already on customer
            existing_files = erp.list_all(
                "File",
                ["name", "file_name"],
                filters=[
                    ["attached_to_doctype", "=", "Customer"],
                    ["attached_to_name", "=", customer],
                    ["file_name", "=", pdf_name],
                ],
            )
            if not existing_files:
                erp.upload_file(
                    pdf_name,
                    pdf_bytes,
                    doctype="Customer",
                    docname=customer,
                    is_private=0,
                )
                entry["pdf_attached"] = True
            else:
                entry["pdf_attached"] = "already"
        except Exception as e:
            entry["pdf_attach_error"] = str(e)[:200]

        front = view_urls.get("front") or (uploaded[0]["file_url"] if uploaded else None)
        patch: dict[str, Any] = {}
        if front and (args.force or not cust.get("image")):
            patch["image"] = front
        # lsh_photos JSON
        photo_doc = {
            "source_pdf": pdf["file_name"],
            "matched_label": pdf["label"],
            "updated": day,
            "views": uploaded,
        }
        patch["lsh_photos"] = json.dumps(photo_doc, indent=2)

        if patch:
            try:
                erp.update("Customer", customer, patch)
                entry["customer_patch"] = {k: (v if k != "lsh_photos" else "json") for k, v in patch.items()}
            except Exception as e:
                entry["customer_patch_error"] = str(e)[:300]

        try:
            bp = upsert_body_profile(erp, customer, view_urls, write=True)
            entry["body_profile"] = bp
        except Exception as e:
            entry["body_profile_error"] = str(e)[:300]

        entry["ok"] = bool(uploaded)
        entry["uploaded"] = uploaded
        results.append(entry)
        stats["ok" if entry["ok"] else "fail"] += 1
        print(
            f"  [{'OK' if entry['ok'] else 'FAIL'}] {customer} · {pdf['file_name']} · "
            f"{len(uploaded)} files · image={front}"
        )

    report = {
        "mode": "write" if write else "dry_run",
        "stats": dict(stats),
        "targets": len(targets),
        "candidates": len(candidates),
        "results": results,
    }
    out = (
        Path(args.report)
        if args.report
        else Path(__file__).resolve().parent
        / "data"
        / f"customer_photos_{'write' if write else 'dry'}.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, default=str))
    print("\n=== SUMMARY ===")
    print(dict(stats))
    print(f"report → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
