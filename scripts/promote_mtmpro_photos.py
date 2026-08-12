#!/usr/bin/env python3
"""
Promote MTMPro order (and Photos) PDFs → Customer portal photos + headshot.

Sources:
  1) File attached to MTMPro Order (order form PDFs)
  2) File *Photos*.pdf (ERP + ~/Downloads) matched by customer name
  3) Existing Customer.image / attachments (sync into new fields)

Writes Customer:
  - image + lsh_headshot          (profile pic)
  - lsh_photo_front/side/back     (fit views)
  - lsh_photos                    (JSON gallery)
  - lsh_portal_show_photos = 1
  - lsh_photo_source              (audit)
  - attachments on Customer
  - Customer Body Profile photo URLs

Usage:
  python3 promote_mtmpro_photos.py --dry-run
  python3 promote_mtmpro_photos.py --write
  python3 promote_mtmpro_photos.py --write --customer "Lorenzo Brook"
  python3 promote_mtmpro_photos.py --write --sync-only   # map existing files → new fields
"""

from __future__ import annotations

import argparse
import io
import json
import re
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from pathlib import Path
from typing import Any

import fitz
from PIL import Image

ENV_PATH = Path.home() / "ls-mcp" / ".env"
DOWNLOADS = Path.home() / "Downloads"
PUBLIC_BASE = "https://erp.lstailors.com"
UA = "Mozilla/5.0 (compatible; LSH-Simone-MTMPhotos/1.0)"


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
    s = (s or "").lower().replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def name_from_photo_filename(fn: str) -> str:
    base = Path(fn).stem
    base = re.sub(r"_?\d+$", "", base)
    base = re.sub(r"_Photos_.*$", "", base, flags=re.I)
    base = base.replace("__", " ").replace("_", " ")
    return re.sub(r"\s+", " ", base).strip()


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", norm_name(name)).strip("_")


def score_match(customer: str, photo_label: str) -> float:
    a_tokens = norm_name(customer).split()
    b_tokens = norm_name(photo_label).split()
    a, b = set(a_tokens), set(b_tokens)
    if not a or not b:
        return 0.0
    if a == b:
        return 100.0
    if a_tokens[-1] != b_tokens[-1]:
        return 0.0
    firsts_a, firsts_b = set(a_tokens[:-1]), set(b_tokens[:-1])
    if firsts_a and firsts_b and not (firsts_a & firsts_b):
        initials_ok = any(
            fa[0] == fb[0] and (len(fa) == 1 or len(fb) == 1)
            for fa in firsts_a
            for fb in firsts_b
        )
        if not initials_ok:
            return 0.0
    inter = len(a & b)
    if inter == 0:
        return 0.0
    return inter / max(len(a), len(b)) * 50 + inter * 10


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
            with urllib.request.urlopen(req, timeout=180) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"{method} {path} → {e.code}: {e.read().decode()[:800]}") from e

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

    def update(self, doctype: str, name: str, values: dict) -> dict:
        return self._req(
            f"/api/resource/{urllib.parse.quote(doctype)}/{urllib.parse.quote(name)}",
            "PUT",
            values,
        )["data"]

    def create(self, doctype: str, doc: dict) -> dict:
        return self._req(
            f"/api/resource/{urllib.parse.quote(doctype)}",
            "POST",
            {**doc, "doctype": doctype},
        )["data"]

    def download_file(self, file_url: str) -> bytes:
        url = file_url if file_url.startswith("http") else self.base + file_url
        req = urllib.request.Request(url)
        req.add_header("Authorization", self._auth())
        req.add_header("User-Agent", UA)
        with urllib.request.urlopen(req, timeout=180) as r:
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
        boundary = "----LshMtmPhotosBoundary"
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
            raise RuntimeError(f"upload {filename} → {e.code}: {e.read().decode()[:600]}") from e
        msg = payload.get("message")
        if isinstance(msg, dict):
            return msg
        if isinstance(msg, str) and msg.startswith("/"):
            return {"file_url": msg, "file_name": filename}
        if payload.get("file_url"):
            return payload
        raise RuntimeError(f"unexpected upload: {str(payload)[:300]}")


def extract_images(pdf_bytes: bytes, *, min_side: int = 120, max_n: int = 4) -> list[bytes]:
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    out: list[bytes] = []
    try:
        for page in doc:
            for img in page.get_images(full=True):
                xref = img[0]
                try:
                    pix = fitz.Pixmap(doc, xref)
                    if pix.n - pix.alpha >= 4:
                        pix = fitz.Pixmap(fitz.csRGB, pix)
                    if pix.width < min_side or pix.height < min_side:
                        continue
                    mode = "RGBA" if pix.alpha else "RGB"
                    im = Image.frombytes(mode, (pix.width, pix.height), pix.samples)
                    if im.mode == "RGBA":
                        im = im.convert("RGB")
                    # Skip near-square tiny logos already filtered; skip very flat banners
                    w, h = im.size
                    ratio = w / max(h, 1)
                    if ratio > 4 or ratio < 0.25:
                        continue
                    max_side = 1600
                    if max(im.size) > max_side:
                        resample = getattr(Image, "Resampling", Image).LANCZOS
                        im.thumbnail((max_side, max_side), resample)
                    bio = io.BytesIO()
                    im.save(bio, format="JPEG", quality=85, optimize=True)
                    out.append(bio.getvalue())
                except Exception:
                    continue
    finally:
        doc.close()
    # unique by size+head
    seen = set()
    uniq: list[bytes] = []
    for b in out:
        k = (len(b), b[:48])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(b)
    uniq.sort(key=len, reverse=True)
    return uniq[:max_n]


def label_views(imgs: list[bytes]) -> list[tuple[str, bytes]]:
    views = ["front", "side", "back", "other"]
    return [(views[i] if i < len(views) else f"other{i}", b) for i, b in enumerate(imgs)]


def abs_url(path: str | None) -> str | None:
    if not path:
        return None
    if path.startswith("http"):
        return path
    return PUBLIC_BASE + path


def upsert_body_profile(erp: Erp, customer: str, urls: dict[str, str], write: bool) -> str | None:
    existing = erp.list_all(
        "Customer Body Profile",
        ["name"],
        filters=[["customer", "=", customer]],
    )
    fields = {
        "body_photo_front_url": urls.get("front") or urls.get("headshot"),
        "body_photo_right_url": urls.get("side"),
        "body_photo_back_url": urls.get("back"),
    }
    fields = {k: v for k, v in fields.items() if v}
    if not fields:
        return None
    if existing:
        if write:
            erp.update("Customer Body Profile", existing[0]["name"], fields)
        return existing[0]["name"]
    if write:
        created = erp.create(
            "Customer Body Profile",
            {
                "customer": customer,
                "established_at": f"{date.today()} 12:00:00",
                "established_by_tailor": "Simone MTM photo promote",
                **fields,
            },
        )
        return created["name"]
    return "(new)"


def pick_photos_pdf(customer: str, candidates: list[dict]) -> dict | None:
    scored = []
    for c in candidates:
        s = score_match(customer, c["label"])
        if s >= 20:
            scored.append((s, c.get("creation") or "", c))
    if not scored:
        return None
    scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return scored[0][2]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--customer", action="append", default=[])
    ap.add_argument("--sync-only", action="store_true", help="Only map existing Customer files into new fields")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--report", default="")
    args = ap.parse_args()
    write = bool(args.write)
    if not write:
        args.dry_run = True

    env = load_env()
    erp = Erp(env)
    print(f"ERP {erp.base} · mode={'WRITE' if write else 'DRY-RUN'}")

    # Targets: customers with MTMPro orders (or explicit)
    if args.customer:
        targets = args.customer
    else:
        orders = erp.list_all(
            "MTMPro Order",
            ["name", "customer", "mtmpro_source_pdf", "order_date"],
            order_by="order_date desc",
        )
        targets = sorted({o["customer"] for o in orders if o.get("customer")})
    print(f"targets: {len(targets)}")

    # MTMPro attached PDFs
    mtm_files = erp.list_all(
        "File",
        ["name", "file_name", "file_url", "attached_to_name", "creation", "file_size"],
        filters=[["attached_to_doctype", "=", "MTMPro Order"]],
        order_by="creation desc",
    )
    # order → customer map
    order_customer: dict[str, str] = {}
    for o in erp.list_all("MTMPro Order", ["name", "customer", "mtmpro_source_pdf"]):
        if o.get("customer"):
            order_customer[o["name"]] = o["customer"]

    mtm_by_customer: dict[str, list[dict]] = defaultdict(list)
    for f in mtm_files:
        order = f.get("attached_to_name")
        cust = order_customer.get(order or "")
        if not cust:
            continue
        fn = (f.get("file_name") or "").lower()
        if not fn.endswith(".pdf"):
            continue
        mtm_by_customer[cust].append(f)

    # Photos PDFs
    photo_files = erp.list_all(
        "File",
        ["name", "file_name", "file_url", "creation"],
        filters=[["file_name", "like", "%Photos%"]],
        order_by="creation desc",
    )
    photo_candidates: list[dict] = []
    seen = set()
    for f in photo_files:
        fn = f.get("file_name") or ""
        if not fn.lower().endswith(".pdf"):
            continue
        url = f.get("file_url") or ""
        if url in seen:
            continue
        seen.add(url)
        photo_candidates.append(
            {
                "label": name_from_photo_filename(fn),
                "file_name": fn,
                "file_url": url,
                "source": "erp_photos",
                "creation": f.get("creation") or "",
            }
        )
    for p in sorted(DOWNLOADS.glob("*[Pp]hoto*.pdf")):
        key = f"local:{p.name}"
        if key in seen:
            continue
        seen.add(key)
        photo_candidates.append(
            {
                "label": name_from_photo_filename(p.name),
                "file_name": p.name,
                "file_url": str(p),
                "source": "downloads",
                "creation": str(p.stat().st_mtime),
                "path": p,
            }
        )

    print(f"MTMPro PDF attachments: {len(mtm_files)} · Photos PDFs: {len(photo_candidates)}")

    results = []
    stats: dict[str, int] = defaultdict(int)

    for customer in targets:
        entry: dict[str, Any] = {"customer": customer, "ok": False}
        try:
            cust = erp.get("Customer", customer)
        except Exception as e:
            entry["error"] = str(e)[:200]
            results.append(entry)
            stats["fail"] += 1
            continue

        # Sync-only path: existing image → new fields
        if args.sync_only or (
            cust.get("image")
            and cust.get("lsh_headshot")
            and cust.get("lsh_photo_front")
            and not args.force
        ):
            if args.sync_only or (
                cust.get("image") and not cust.get("lsh_headshot") and not args.force
            ):
                patch = {}
                if cust.get("image") and not cust.get("lsh_headshot"):
                    patch["lsh_headshot"] = cust["image"]
                # parse lsh_photos JSON for views
                try:
                    gallery = json.loads(cust.get("lsh_photos") or "{}")
                    for v in gallery.get("views") or []:
                        view = v.get("view")
                        url = v.get("file_url")
                        if view == "front" and url and not cust.get("lsh_photo_front"):
                            patch["lsh_photo_front"] = url
                        if view == "side" and url and not cust.get("lsh_photo_side"):
                            patch["lsh_photo_side"] = url
                        if view == "back" and url and not cust.get("lsh_photo_back"):
                            patch["lsh_photo_back"] = url
                except Exception:
                    pass
                if not cust.get("lsh_portal_show_photos"):
                    patch["lsh_portal_show_photos"] = 1
                if patch:
                    entry["sync_patch"] = list(patch.keys())
                    if write:
                        erp.update("Customer", customer, patch)
                        entry["ok"] = True
                        stats["synced"] += 1
                        print(f"  [SYNC] {customer} · {list(patch.keys())}")
                    else:
                        entry["ok"] = True
                        entry["dry_run"] = True
                        stats["ok"] += 1
                        print(f"  [DRY SYNC] {customer} · {list(patch.keys())}")
                else:
                    entry["skipped"] = True
                    stats["skipped"] += 1
                results.append(entry)
                if args.sync_only or not args.force:
                    continue
            elif not args.force and cust.get("lsh_headshot") and cust.get("lsh_photo_front"):
                entry["skipped"] = True
                entry["reason"] = "already complete"
                stats["skipped"] += 1
                results.append(entry)
                print(f"  [SKIP] {customer} complete")
                continue

        # Prefer Photos PDF; else latest MTMPro PDFs
        photos_pdf = pick_photos_pdf(customer, photo_candidates)
        mtm_pdfs = mtm_by_customer.get(customer) or []
        # also mtmpro_source_pdf field
        for o in erp.list_all(
            "MTMPro Order",
            ["name", "mtmpro_source_pdf"],
            filters=[["customer", "=", customer]],
        ):
            url = o.get("mtmpro_source_pdf")
            if url and not any(x.get("file_url") == url for x in mtm_pdfs):
                mtm_pdfs.append(
                    {
                        "file_name": Path(url).name,
                        "file_url": url,
                        "attached_to_name": o["name"],
                        "creation": "",
                    }
                )

        sources: list[tuple[str, dict]] = []
        if photos_pdf:
            sources.append(("photos", photos_pdf))
        # MTMPro attachments named *Photos* act as fitting packs
        mtm_photo_pack = [
            f
            for f in mtm_pdfs
            if re.search(r"photos?", (f.get("file_name") or ""), re.I)
        ]
        mtm_order_only = [f for f in mtm_pdfs if f not in mtm_photo_pack]
        for f in mtm_photo_pack[:3]:
            sources.append(("photos", {**f, "source": "mtmpro_photos"}))
        for f in mtm_order_only[:5]:
            sources.append(("mtmpro", f))

        if not sources:
            entry["error"] = "no PDF sources"
            results.append(entry)
            stats["no_source"] += 1
            print(f"  [NO SRC] {customer}")
            continue

        labeled: list[tuple[str, bytes]] = []
        source_note = []

        for kind, src in sources:
            try:
                if src.get("source") == "downloads" or (
                    isinstance(src.get("file_url"), str)
                    and not str(src["file_url"]).startswith("/")
                    and Path(str(src["file_url"])).exists()
                ):
                    pdf_bytes = Path(src["file_url"]).read_bytes()
                else:
                    pdf_bytes = erp.download_file(src["file_url"])
            except Exception as e:
                entry.setdefault("download_errors", []).append(f"{src.get('file_name')}: {e}")
                continue

            imgs = extract_images(
                pdf_bytes,
                min_side=120 if kind == "photos" else 160,
                max_n=4 if kind == "photos" else 2,
            )
            if not imgs:
                continue
            source_note.append(f"{kind}:{src.get('file_name')}:{len(imgs)}")
            if kind == "photos":
                labeled = label_views(imgs)
                entry["photos_pdf"] = src.get("file_name")
                break
            if kind == "mtmpro" and not labeled:
                labeled = label_views(imgs[:1])
                entry["mtmpro_pdf"] = src.get("file_name")
                entry["mtmpro_order"] = src.get("attached_to_name")
                # keep scanning for a photos pack later in list
                continue

        if not labeled:
            entry["error"] = "no extractable images"
            results.append(entry)
            stats["fail"] += 1
            print(f"  [FAIL] {customer} no images · tried {source_note}")
            continue

        entry["source_note"] = source_note
        entry["views"] = [v for v, _ in labeled]

        if not write:
            entry["ok"] = True
            entry["dry_run"] = True
            results.append(entry)
            stats["ok"] += 1
            print(f"  [DRY] {customer} · views={entry['views']} · {source_note[:2]}")
            continue

        day = date.today().isoformat()
        slug = slugify(customer)
        uploaded: list[dict] = []
        view_urls: dict[str, str] = {}

        for view, jpeg in labeled:
            fname = f"{slug}_fitting_{day}_{view}.jpg"
            try:
                up = erp.upload_file(fname, jpeg, doctype="Customer", docname=customer, is_private=0)
                url = up.get("file_url")
                uploaded.append({"view": view, "file_name": fname, "file_url": url})
                if url:
                    view_urls[view] = url
            except Exception as e:
                entry.setdefault("upload_errors", []).append(f"{view}: {e}")

        # Attach source PDF(s) to customer
        for kind, src in sources[:2]:
            try:
                fn = src.get("file_name") or "source.pdf"
                existing = erp.list_all(
                    "File",
                    ["name"],
                    filters=[
                        ["attached_to_doctype", "=", "Customer"],
                        ["attached_to_name", "=", customer],
                        ["file_name", "=", fn],
                    ],
                )
                if existing:
                    continue
                if src.get("source") == "downloads" or (
                    isinstance(src.get("file_url"), str)
                    and Path(str(src.get("file_url", ""))).exists()
                ):
                    pdf_bytes = Path(src["file_url"]).read_bytes()
                else:
                    pdf_bytes = erp.download_file(src["file_url"])
                erp.upload_file(fn, pdf_bytes, doctype="Customer", docname=customer, is_private=0)
            except Exception as e:
                entry.setdefault("pdf_attach_errors", []).append(str(e)[:120])

        front = view_urls.get("front") or (uploaded[0]["file_url"] if uploaded else None)
        headshot = front
        patch: dict[str, Any] = {
            "lsh_portal_show_photos": 1,
            "lsh_photo_source": "; ".join(source_note)[:140],
            "lsh_photos": json.dumps(
                {
                    "source": source_note,
                    "updated": day,
                    "views": uploaded,
                    "public_base": PUBLIC_BASE,
                },
                indent=2,
            ),
        }
        if headshot and (args.force or not cust.get("image") or not cust.get("lsh_headshot")):
            patch["image"] = headshot
            patch["lsh_headshot"] = headshot
        elif headshot and not cust.get("lsh_headshot"):
            patch["lsh_headshot"] = headshot
            if not cust.get("image"):
                patch["image"] = headshot

        if view_urls.get("front"):
            patch["lsh_photo_front"] = view_urls["front"]
        if view_urls.get("side"):
            patch["lsh_photo_side"] = view_urls["side"]
        if view_urls.get("back"):
            patch["lsh_photo_back"] = view_urls["back"]

        try:
            erp.update("Customer", customer, patch)
            entry["patched"] = list(patch.keys())
        except Exception as e:
            entry["patch_error"] = str(e)[:300]

        try:
            bp_urls = dict(view_urls)
            if headshot:
                bp_urls["headshot"] = headshot
            entry["body_profile"] = upsert_body_profile(erp, customer, bp_urls, write=True)
        except Exception as e:
            entry["body_profile_error"] = str(e)[:200]

        entry["ok"] = bool(uploaded)
        entry["uploaded"] = uploaded
        entry["headshot"] = headshot
        results.append(entry)
        stats["ok" if entry["ok"] else "fail"] += 1
        print(
            f"  [{'OK' if entry['ok'] else 'FAIL'}] {customer} · headshot={headshot} · "
            f"views={list(view_urls)} · {source_note[:2]}"
        )

    report = {
        "mode": "write" if write else "dry_run",
        "stats": dict(stats),
        "targets": len(targets),
        "results": results,
    }
    out = (
        Path(args.report)
        if args.report
        else Path(__file__).resolve().parent
        / "data"
        / f"mtmpro_photos_{'write' if write else 'dry'}.json"
    )
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2, default=str))
    print("\n=== SUMMARY ===")
    print(dict(stats))
    print(f"report → {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
