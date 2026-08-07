# -*- coding: utf-8 -*-
"""
escpos_tm.py  --  L&S Custom Tailors thermal print engine

Epson TM-M30ii ESC/POS, stdlib only (socket).

Rack hierarchy (matches classic purple slip):
    00061
    Friday
    6:00 PM
    Aug 4
    ----------------
    Customer Name
    phone
    work lines / QR

Body = double-height Font A; ticket / day / time / name = double W+H.
"""

import re
import socket
from datetime import datetime

# ---------------------------------------------------------------------------
# Low-level ESC/POS
# ---------------------------------------------------------------------------

ESC = b"\x1b"
GS = b"\x1d"

INIT = ESC + b"@"
# GS V m n — m=65 full cut w/ feed, m=66 partial (tear) w/ feed. n = feed dots.
CUT_FULL = GS + b"V\x41\x18"      # receipts — clean separate sheet
CUT_PARTIAL = GS + b"V\x42\x18"   # hang tags — tear point
CUT = CUT_PARTIAL                 # back-compat alias
FONT_A = ESC + b"M\x00"

ALIGN_LEFT = ESC + b"a\x00"
ALIGN_CENTER = ESC + b"a\x01"
ALIGN_RIGHT = ESC + b"a\x02"

BOLD_ON = ESC + b"E\x01"
BOLD_OFF = ESC + b"E\x00"

SIZE_NORMAL = GS + b"!\x00"
SIZE_2H = GS + b"!\x01"
SIZE_2W = GS + b"!\x10"
SIZE_2WH = GS + b"!\x11"

LINE_WIDTH = 48
LINE_WIDTH_2W = 24

# Shop ready-by when due_date is date-only (no appointment clock)
DEFAULT_READY_TIME = "6:00 PM"

BRAND = "L&S CUSTOM TAILORS"
BRAND_HOUSE = "L & S HOUSE"
SUB = "Bespoke since 1974"
ADDR_NYC = "138 East 61st Street, Ste 201, NYC"
PHONE = "(212) 838-7372"
WEB = "lstailors.com"

# Client-facing reprint banner (ASCII only — CP437 safe).
REPRINT_MARK = "DUPLICATE - REPRINT"

# Draft A pickup terms (C-approved design review). No "warranty". Static copy.
# Placed on customer receipt ABOVE the phone/web footer.
PICKUP_TERMS = (
    "Show this ticket at pickup.",
    "Alterations balance is due at pickup.",
    "Visa · Mastercard · Amex · Discover · Apple Pay · Check",
)


def _enc(text):
    if text is None:
        text = ""
    if not isinstance(text, str):
        text = str(text)
    return text.encode("cp437", "replace")


def line(text="", *, bold=False, size=None, align=None):
    out = b""
    if align is not None:
        out += align
    if size is not None:
        out += size
    if bold:
        out += BOLD_ON
    out += _enc(text)
    if bold:
        out += BOLD_OFF
    if size is not None:
        out += SIZE_NORMAL
    if align is not None:
        out += ALIGN_LEFT
    return out + b"\n"


def rule(char="-", *, heavy=False):
    if heavy:
        return BOLD_ON + _enc("=" * LINE_WIDTH) + BOLD_OFF + b"\n"
    return _enc(char * LINE_WIDTH) + b"\n"


def feed(n=1):
    return b"\n" * n


def two_col(left, right, width=LINE_WIDTH, *, bold=False, size=None):
    left = "" if left is None else str(left)
    right = "" if right is None else str(right)
    if size in (SIZE_2W, SIZE_2WH):
        width = min(width, LINE_WIDTH_2W)
    space = width - len(left) - len(right)
    if space < 1:
        left = left[: max(0, width - len(right) - 1)]
        space = max(width - len(left) - len(right), 1)
    text = left + (" " * space) + right
    out = b""
    if size is not None:
        out += size
    if bold:
        out += BOLD_ON
    out += _enc(text)
    if bold:
        out += BOLD_OFF
    if size is not None:
        out += SIZE_NORMAL
    return out + b"\n"


def qr(data, module_size=7, ec="M"):
    data_bytes = data.encode("utf-8")
    ec_map = {"L": 48, "M": 49, "Q": 50, "H": 51}
    ec_byte = ec_map.get(ec.upper(), 49)
    out = b""
    out += GS + b"(k\x04\x00\x31\x41\x32\x00"
    out += GS + b"(k\x03\x00\x31\x43" + bytes([max(1, min(16, module_size))])
    out += GS + b"(k\x03\x00\x31\x45" + bytes([ec_byte])
    store_len = len(data_bytes) + 3
    pl = store_len & 0xFF
    ph = (store_len >> 8) & 0xFF
    out += GS + b"(k" + bytes([pl, ph]) + b"\x31\x50\x30" + data_bytes
    out += GS + b"(k\x03\x00\x31\x51\x30"
    return out


def _money(v):
    try:
        return "${:,.2f}".format(float(v or 0))
    except (TypeError, ValueError):
        return "$0.00"


def _wrap(text, width):
    words = str(text).split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) <= width:
            cur = (cur + " " + w) if cur else w
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines or [""]


def short_ticket_no(ticket):
    """ALT-NYC-2026-00061 → A00061 (classic A14937 style)."""
    s = str(ticket or "")
    m = re.search(r"(\d{3,})$", s)
    if m:
        return "A" + m.group(1)
    parts = s.split("-")
    return parts[-1] if parts else s


def parse_due(due_date, default_time=DEFAULT_READY_TIME):
    """
    Friday / 6:00 PM / Aug 4 from a due value.
    Date-only ERP fields → default_time (shop EOD ready-by).
    """
    if not due_date:
        return None
    raw = str(due_date).strip()
    dt = None
    for fmt in (
        "%Y-%m-%d %H:%M:%S.%f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%dT%H:%M",
        "%Y-%m-%d",
        "%m/%d/%Y %I:%M %p",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y",
    ):
        try:
            dt = datetime.strptime(raw.replace("Z", "")[:26], fmt)
            break
        except ValueError:
            continue
    if dt is None:
        return {"weekday": raw, "time": default_time, "date_short": raw}

    weekday = dt.strftime("%A")  # Friday
    date_short = dt.strftime("%b ") + str(dt.day)  # Aug 4

    # Date-only (YYYY-MM-DD) → no real clock
    if len(raw) <= 10 or (dt.hour == 0 and dt.minute == 0 and "T" not in raw and len(raw) <= 10):
        time_s = default_time
    elif dt.hour == 0 and dt.minute == 0 and len(raw) <= 10:
        time_s = default_time
    else:
        # 4:00 PM style (strip leading zero on hour)
        time_s = dt.strftime("%I:%M %p").lstrip("0")
        if len(raw) <= 10:
            time_s = default_time

    # Cleaner: if only date portion
    if re.match(r"^\d{4}-\d{2}-\d{2}$", raw):
        time_s = default_time

    return {"weekday": weekday, "time": time_s, "date_short": date_short}


def rack_due_block(due_date, default_time=DEFAULT_READY_TIME):
    """Huge weekday + huge time + date short — centered."""
    parts = parse_due(due_date, default_time=default_time)
    if not parts:
        return b""
    out = b""
    out += line(parts["weekday"], bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += line(parts["time"], bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    if parts.get("date_short"):
        out += line(parts["date_short"], bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    return out


def _kv(label, value, *, bold_value=True, size=SIZE_2H):
    label = (label or "").upper()
    value = "" if value is None else str(value)
    left = (label + ":") if not label.endswith(":") else label
    return two_col(left, value, bold=bold_value, size=size)


def _truthy(v):
    if v is True:
        return True
    if v in (1, "1", "true", "True", "yes", "Yes"):
        return True
    return False


def _garment_line_total(g):
    """Prefer garment_total; else sum child line prices. Never invent $0 when lines have $."""
    try:
        gt = float(g.get("garment_total") or 0)
    except (TypeError, ValueError):
        gt = 0.0
    if gt:
        return gt
    total = 0.0
    for w in g.get("lines") or []:
        if isinstance(w, dict):
            try:
                total += float(w.get("price") or 0)
            except (TypeError, ValueError):
                pass
    return total


def _reprint_banner(reprint):
    if not _truthy(reprint):
        return b""
    out = b""
    out += line(REPRINT_MARK, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)
    return out


def _pickup_terms_block():
    """Customer receipt only — above phone/web footer. Static Draft A."""
    out = b""
    out += rule(heavy=True)
    for row in PICKUP_TERMS:
        for chunk in _wrap(row, LINE_WIDTH):
            out += line(chunk, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += rule(heavy=True)
    return out


# ---------------------------------------------------------------------------
# Document builders
# ---------------------------------------------------------------------------

def build_garment_tag(*, ticket, garment, qr_url, due_date=None,
                      is_rush=False, location=None, idx=None, total=None,
                      lines=None, customer_name=None, customer_phone=None,
                      reprint=False):
    """
    Rack tag (partial cut / tear):
      [DUPLICATE - REPRINT]
      A00061
      Friday
      6:00 PM
      Aug 4
      ========
      Customer Name
      Coat / G1
      -work lines
      QR
    No RUSH ink. No pickup terms. is_rush accepted but ignored.
    """
    _ = is_rush  # retired on tags (C) — keep kwarg so callers don't break
    g = garment or {}
    out = INIT + FONT_A

    short = short_ticket_no(ticket)
    out += line(short, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += _reprint_banner(reprint)

    if due_date:
        out += feed(1)
        out += rack_due_block(due_date)

    out += rule(heavy=True)

    cname = (customer_name or "").strip()
    if cname:
        display = cname if any(c.islower() for c in cname) else cname.title()
        for chunk in _wrap(display, LINE_WIDTH_2W):
            out += line(chunk, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    if customer_phone:
        out += line(str(customer_phone), bold=True, align=ALIGN_CENTER, size=SIZE_2H)

    out += feed(1)
    if location:
        out += line(str(location), bold=True, align=ALIGN_CENTER, size=SIZE_2H)

    gid = str(g.get("garment_id") or "")
    gtype = g.get("garment_type") or ""
    color = g.get("color") or ""
    head = " / ".join([p for p in (gtype, color, gid) if p])
    if head:
        out += line(head, bold=True, align=ALIGN_CENTER, size=SIZE_2H)

    desc = g.get("garment_description") or ""
    if desc and desc.strip().lower() != (gtype or "").strip().lower():
        for chunk in _wrap(desc, LINE_WIDTH):
            out += line(chunk, align=ALIGN_CENTER, size=SIZE_2H)

    work = lines or g.get("lines") or []
    if work:
        out += feed(1)
        for w in work[:8]:
            text = w if isinstance(w, str) else (w.get("description") or "")
            if not text:
                continue
            if not text.startswith("-") and not text.startswith("*"):
                text = "-" + text
            for chunk in _wrap(text, LINE_WIDTH):
                out += line(chunk, bold=True, size=SIZE_2H)

    out += feed(1)
    out += ALIGN_CENTER + qr(qr_url, module_size=7) + ALIGN_LEFT
    out += line(gid or short, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(3)
    out += CUT_PARTIAL
    return out


def _exit_label(delivery_method=None, delivery_zone=None, delivery_fee=None):
    """Compact EXIT line: HAND DELIVERY · ZONE-1 · $40"""
    method = (delivery_method or "").strip()
    if not method:
        return None
    label = method.upper()
    if method == "Pickup":
        return "PICKUP AT SHOP"
    if method == "Hand Delivery":
        label = "HAND DELIVERY"
    elif method == "Ship (FedEx)":
        label = "SHIP FEDEX"
    elif method == "Courier":
        label = "COURIER"
    bits = [label]
    zone = (delivery_zone or "").strip()
    if zone:
        bits.append(zone.upper() if not zone.upper().startswith("ZONE") else zone.upper())
    try:
        fee = float(delivery_fee) if delivery_fee is not None and delivery_fee != "" else None
    except (TypeError, ValueError):
        fee = None
    if fee is not None and method != "Pickup":
        if fee <= 0:
            bits.append("INCL")
        else:
            bits.append("${0:.0f}".format(fee))
    return " · ".join(bits)


def _format_delivery_to(address=None, apt=None, city=None, state=None, zip_code=None):
    street = " ".join(p for p in [(address or "").strip(), (apt or "").strip()] if p)
    locality = ", ".join(
        p for p in [
            (city or "").strip(),
            " ".join(x for x in [(state or "").strip(), (zip_code or "").strip()] if x),
        ] if p
    )
    if street and locality:
        return "{}, {}".format(street, locality)
    return street or locality or None


def build_customer_receipt(*, ticket, customer_name, customer_phone,
                          garments, ticket_total, qr_url, ticket_date=None,
                          due_date=None, promised_date=None, is_rush=False,
                          location=None, customer_notes=None, reprint=False,
                          payment_status=None, delivery_method=None,
                          delivery_zone=None, delivery_fee=None,
                          delivery_address=None, delivery_apt=None,
                          delivery_city=None, delivery_state=None,
                          delivery_zip=None):
    return _master(
        ticket=ticket, customer_name=customer_name,
        customer_phone=customer_phone, garments=garments,
        ticket_total=ticket_total, qr_url=qr_url, ticket_date=ticket_date,
        due_date=due_date, promised_date=promised_date, is_rush=is_rush,
        location=location, notes=customer_notes, office=False,
        reprint=reprint, payment_status=payment_status,
        delivery_method=delivery_method, delivery_zone=delivery_zone,
        delivery_fee=delivery_fee, delivery_address=delivery_address,
        delivery_apt=delivery_apt, delivery_city=delivery_city,
        delivery_state=delivery_state, delivery_zip=delivery_zip,
    )


def build_office_receipt(*, ticket, customer_name, customer_phone,
                        garments, ticket_total, qr_url, ticket_date=None,
                        due_date=None, promised_date=None, is_rush=False,
                        location=None, internal_notes=None, reprint=False,
                        payment_status=None, delivery_method=None,
                        sales_invoice=None, workflow_state=None,
                        delivery_zone=None, delivery_fee=None,
                        delivery_address=None, delivery_apt=None,
                        delivery_city=None, delivery_state=None,
                        delivery_zip=None):
    return _master(
        ticket=ticket, customer_name=customer_name,
        customer_phone=customer_phone, garments=garments,
        ticket_total=ticket_total, qr_url=qr_url, ticket_date=ticket_date,
        due_date=due_date, promised_date=promised_date, is_rush=is_rush,
        location=location, notes=internal_notes, office=True,
        reprint=reprint, payment_status=payment_status,
        delivery_method=delivery_method, sales_invoice=sales_invoice,
        workflow_state=workflow_state, delivery_zone=delivery_zone,
        delivery_fee=delivery_fee, delivery_address=delivery_address,
        delivery_apt=delivery_apt, delivery_city=delivery_city,
        delivery_state=delivery_state, delivery_zip=delivery_zip,
    )


def _master(*, ticket, customer_name, customer_phone, garments, ticket_total,
            qr_url, ticket_date, due_date, promised_date, is_rush, location,
            notes, office, reprint=False, payment_status=None,
            delivery_method=None, sales_invoice=None, workflow_state=None,
            delivery_zone=None, delivery_fee=None, delivery_address=None,
            delivery_apt=None, delivery_city=None, delivery_state=None,
            delivery_zip=None):
    _ = is_rush  # no RUSH ink on receipts (C retired rush on print)
    out = INIT + FONT_A

    if office:
        out += line("STORE MASTER", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    else:
        out += line(BRAND_HOUSE, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += _reprint_banner(reprint)

    # Rack header
    short = short_ticket_no(ticket)
    out += line(short, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)

    due_show = promised_date or due_date
    if due_show:
        out += feed(1)
        out += rack_due_block(due_show)

    out += rule(heavy=True)

    cname = (customer_name or "").strip()
    if cname:
        display = cname if any(c.islower() for c in cname) else cname.title()
        for chunk in _wrap(display, LINE_WIDTH_2W):
            out += line(chunk, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    if customer_phone:
        out += line(str(customer_phone), bold=True, align=ALIGN_CENTER, size=SIZE_2H)

    out += feed(1)
    if office:
        out += line("L&S OFFICE COPY", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    else:
        out += line("CUSTOMER RECEIPT", bold=True, align=ALIGN_CENTER, size=SIZE_2H)

    out += line(str(ticket), bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    if location:
        out += _kv("Store", location)
    if ticket_date:
        out += _kv("Date", ticket_date)
    exit_line = _exit_label(delivery_method, delivery_zone, delivery_fee)
    if exit_line:
        out += _kv("Exit", exit_line)
    if office and workflow_state:
        out += _kv("State", str(workflow_state).upper())
    # Address only on non-pickup (FOH needs street on master; client sees method+fee)
    to_line = None
    method = (delivery_method or "").strip()
    if method and method != "Pickup":
        to_line = _format_delivery_to(
            delivery_address, delivery_apt, delivery_city, delivery_state, delivery_zip,
        )
    if to_line and office:
        for i, chunk in enumerate(_wrap(to_line, LINE_WIDTH - 8)):
            out += _kv("To" if i == 0 else "", chunk)
    out += rule(heavy=True)

    out += line("GARMENTS", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)

    for g in garments or []:
        gid = g.get("garment_id") or ""
        gtype = g.get("garment_type") or ""
        color = g.get("color") or ""
        label = " ".join([p for p in (gtype, color) if p]) or "Garment"
        head = "{}  [{}]".format(label, gid) if gid else label
        gtot = _garment_line_total(g)
        # Omit header $ when zero and no lines — never print a false $0.00 next to priced lines
        if gtot:
            out += two_col(head, _money(gtot), bold=True, size=SIZE_2H)
        else:
            out += line(head, bold=True, size=SIZE_2H)

        desc = g.get("garment_description") or ""
        if desc and desc.strip().lower() not in (
            (gtype or "").strip().lower(),
            label.strip().lower(),
        ):
            for chunk in _wrap(desc, LINE_WIDTH):
                out += line("  " + chunk, size=SIZE_2H)

        for w in g.get("lines") or []:
            text = w if isinstance(w, str) else (w.get("description") or "")
            price = None if isinstance(w, str) else w.get("price")
            if not text:
                continue
            if not text.startswith("-"):
                text = "-" + text
            if price is not None and float(price or 0) != 0:
                out += two_col("  " + text, _money(price), size=SIZE_2H)
            else:
                for chunk in _wrap(text, LINE_WIDTH - 2):
                    out += line("  " + chunk, size=SIZE_2H)
        out += feed(1)

    out += rule(heavy=True)
    out += two_col("TOTAL", _money(ticket_total), bold=True, size=SIZE_2WH)
    if payment_status:
        out += _kv("Status", str(payment_status).upper())
    if office and sales_invoice:
        out += _kv("Invoice", sales_invoice)
    out += rule(heavy=True)

    if notes:
        label = "INTERNAL NOTES" if office else "NOTES"
        out += line(label, bold=True, size=SIZE_2H)
        for chunk in _wrap(str(notes), LINE_WIDTH):
            out += line(chunk, size=SIZE_2H)
        out += feed(1)

    out += feed(1)
    out += ALIGN_CENTER + qr(qr_url, module_size=8) + ALIGN_LEFT
    if office:
        out += line("Scan to open in alts", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    else:
        # Pay URL uses /pay/; ticket lookup uses /t/
        qhint = "Scan to pay" if (qr_url and "/pay/" in str(qr_url)) else "Scan e-ticket"
        out += line(qhint, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += line(str(ticket), bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)

    if not office:
        out += _pickup_terms_block()
        out += feed(1)
        out += line("WITH OUR THANKS", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
        out += line(BRAND_HOUSE, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
        out += line(PHONE + "  |  " + WEB, align=ALIGN_CENTER, size=SIZE_2H)

    out += feed(4)
    out += CUT_FULL
    return out


def build_payment_receipt(*, invoice, customer_name, amount_paid, total,
                          outstanding, payment_ref=None, method="Card",
                          paid_on=None, qr_url=None, ticket=None, reprint=False):
    out = INIT + FONT_A
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += line(SUB, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)
    out += line("PAYMENT RECEIPT", bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += _reprint_banner(reprint)
    out += rule(heavy=True)
    out += _kv("Invoice", invoice)
    if ticket:
        out += _kv("Ticket", ticket)
    out += _kv("Customer", customer_name or "")
    if paid_on:
        out += _kv("Paid", paid_on)
    out += _kv("Method", str(method) + " (Square)")
    if payment_ref:
        out += _kv("Ref", payment_ref)
    out += rule(heavy=True)
    out += two_col("Invoice Total", _money(total), size=SIZE_2H)
    out += two_col("Amount Paid", _money(amount_paid), bold=True, size=SIZE_2H)
    out += two_col("Balance Due", _money(outstanding), bold=True, size=SIZE_2WH)
    out += rule(heavy=True)
    if qr_url:
        out += feed(1)
        out += ALIGN_CENTER + qr(qr_url, module_size=8) + ALIGN_LEFT
    out += feed(1)
    paid_full = outstanding is not None and float(outstanding or 0) <= 0.02
    out += line("PAID IN FULL" if paid_full else "PARTIAL PAYMENT",
                bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += line("Thank you for choosing L&S.", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += line(PHONE + "  |  " + WEB, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(4)
    out += CUT_FULL
    return out


def build_pay_qr(*, invoice, customer_name, amount, url, ticket=None, reprint=False):
    out = INIT + FONT_A
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += feed(1)
    out += line("SCAN TO PAY", bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += _reprint_banner(reprint)
    out += rule(heavy=True)
    out += _kv("Invoice", invoice)
    if ticket:
        out += _kv("Ticket", ticket)
    out += _kv("Customer", customer_name or "")
    out += two_col("Amount Due", _money(amount), bold=True, size=SIZE_2WH)
    out += rule(heavy=True)
    out += feed(1)
    out += ALIGN_CENTER + qr(url, module_size=9) + ALIGN_LEFT
    out += feed(1)
    out += line("Scan with your phone camera", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += line("to pay securely via Square.", align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(4)
    out += CUT_FULL
    return out


def send(host, payload, port=9100, timeout=5.0):
    if not host:
        raise ValueError("No printer host/IP configured")
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(float(timeout))
    try:
        s.connect((host, int(port)))
        s.sendall(payload)
    finally:
        try:
            s.close()
        except OSError:
            pass
    return len(payload)
