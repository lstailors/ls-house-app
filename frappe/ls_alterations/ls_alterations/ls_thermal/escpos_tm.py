# -*- coding: utf-8 -*-
"""
escpos_tm.py  --  L&S Custom Tailors thermal print engine

Pure standard-library ESC/POS builder + raw socket sender for the
Epson TM-M30ii (80mm thermal, ESC/POS, native QR). NO external
dependencies -- only `socket` from stdlib -- so nothing to pip-pin
inside the Frappe bench and nothing to drift.

Legibility pass (2026-07): shop purple stock + distant rack reading.
Body text is double-height Font A; key IDs double-width+height.
Never use Font B. Luxury = hierarchy + space, not tiny caps.
"""

import socket

# ---------------------------------------------------------------------------
# Low-level ESC/POS primitives
# ---------------------------------------------------------------------------

ESC = b"\x1b"
GS = b"\x1d"

INIT = ESC + b"@"                       # initialize printer
CUT = GS + b"V\x42\x10"                 # partial cut, feed 16 dots first
FONT_A = ESC + b"M\x00"                 # Font A (12×24) — always

ALIGN_LEFT = ESC + b"a\x00"
ALIGN_CENTER = ESC + b"a\x01"
ALIGN_RIGHT = ESC + b"a\x02"

BOLD_ON = ESC + b"E\x01"
BOLD_OFF = ESC + b"E\x00"

# GS ! n  -- character size. high nibble = height mult, low nibble = width mult
SIZE_NORMAL = GS + b"!\x00"
SIZE_2H = GS + b"!\x01"                  # double height (body default)
SIZE_2W = GS + b"!\x10"                  # double width
SIZE_2WH = GS + b"!\x11"                 # double width + height (ticket / total)

# 80mm printable ~48 cols Font A normal; ~24 cols when double-width
LINE_WIDTH = 48
LINE_WIDTH_2W = 24


def _enc(text):
    """Encode to the printer's code page; fall back gracefully."""
    if text is None:
        text = ""
    if not isinstance(text, str):
        text = str(text)
    return text.encode("cp437", "replace")


def line(text="", *, bold=False, size=None, align=None):
    """One line of text + newline, with optional styling."""
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
    """Left text + right text padded to full line (e.g. item ..... $40)."""
    left = "" if left is None else str(left)
    right = "" if right is None else str(right)
    # Double-width text only fits half the columns
    if size in (SIZE_2W, SIZE_2WH):
        width = min(width, LINE_WIDTH_2W)
    space = width - len(left) - len(right)
    if space < 1:
        left = left[: max(0, width - len(right) - 1)]
        space = width - len(left) - len(right)
        space = max(space, 1)
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


def qr(data, module_size=8, ec="M"):
    """
    Native ESC/POS QR (model 2) for the TM-M30ii via GS ( k.
    module_size 1-16 (8 = easy phone scan on 80mm / hang-tag distance).
    """
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


# ---------------------------------------------------------------------------
# Document builders
# ---------------------------------------------------------------------------

BRAND = "L&S CUSTOM TAILORS"
SUB = "Bespoke since 1974"
ADDR_NYC = "138 East 61st Street, Ste 201, NYC"
PHONE = "(212) 838-7372"
WEB = "lstailors.com"


def build_garment_tag(*, ticket, garment, qr_url, due_date=None,
                      is_rush=False, location=None, idx=None, total=None,
                      lines=None):
    """
    One garment hang tag. Large IDs for rack distance; QR to alts /g/.
    `lines` optional list of work descriptions for this garment.
    """
    g = garment
    out = INIT + FONT_A
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)

    seq = ""
    if idx is not None and total is not None:
        seq = "  ({}/{})".format(idx, total)
    out += line("GARMENT TAG" + seq, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    if is_rush:
        out += line("*** RUSH ***", bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += rule(heavy=True)

    out += line(str(ticket), bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    if location:
        out += line(str(location), bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)

    gid = str(g.get("garment_id") or "")
    out += line(gid, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)

    gtype = g.get("garment_type") or ""
    color = g.get("color") or ""
    head = " / ".join([p for p in (gtype, color) if p])
    if head:
        out += line(head, bold=True, align=ALIGN_CENTER, size=SIZE_2H)

    desc = g.get("garment_description") or ""
    if desc and desc.strip().lower() != (gtype or "").strip().lower():
        for chunk in _wrap(desc, LINE_WIDTH):
            out += line(chunk, align=ALIGN_CENTER, size=SIZE_2H)

    # Work lines (what to do) — critical on the rack
    work = lines or g.get("lines") or []
    if work:
        out += feed(1)
        out += line("WORK", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
        for w in work[:6]:
            text = w if isinstance(w, str) else (w.get("description") or "")
            if not text:
                continue
            for chunk in _wrap(text, LINE_WIDTH):
                out += line(chunk, bold=True, size=SIZE_2H)

    if due_date:
        out += feed(1)
        out += line("DUE  " + str(due_date), bold=True, align=ALIGN_CENTER, size=SIZE_2WH)

    out += feed(1)
    out += ALIGN_CENTER + qr(qr_url, module_size=8) + ALIGN_LEFT
    out += line(gid or str(ticket), bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(2)
    out += CUT
    return out


def build_customer_receipt(*, ticket, customer_name, customer_phone,
                          garments, ticket_total, qr_url, ticket_date=None,
                          due_date=None, promised_date=None, is_rush=False,
                          location=None, customer_notes=None):
    """Master receipt -- the copy the customer takes."""
    return _master(
        ticket=ticket, customer_name=customer_name,
        customer_phone=customer_phone, garments=garments,
        ticket_total=ticket_total, qr_url=qr_url, ticket_date=ticket_date,
        due_date=due_date, promised_date=promised_date, is_rush=is_rush,
        location=location, notes=customer_notes, office=False,
    )


def build_office_receipt(*, ticket, customer_name, customer_phone,
                        garments, ticket_total, qr_url, ticket_date=None,
                        due_date=None, promised_date=None, is_rush=False,
                        location=None, internal_notes=None):
    """Master receipt -- the L&S filing copy (attach to the order)."""
    return _master(
        ticket=ticket, customer_name=customer_name,
        customer_phone=customer_phone, garments=garments,
        ticket_total=ticket_total, qr_url=qr_url, ticket_date=ticket_date,
        due_date=due_date, promised_date=promised_date, is_rush=is_rush,
        location=location, notes=internal_notes, office=True,
    )


def _kv(label, value, *, bold_value=True, size=SIZE_2H):
    """Label left / value right — double-height body."""
    label = (label or "").upper()
    value = "" if value is None else str(value)
    # Keep label short so value stays large and readable
    left = (label + ":") if not label.endswith(":") else label
    return two_col(left, value, bold=bold_value, size=size)


def _master(*, ticket, customer_name, customer_phone, garments, ticket_total,
            qr_url, ticket_date, due_date, promised_date, is_rush, location,
            notes, office):
    out = INIT + FONT_A
    # Brand block
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += line(SUB, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += line(ADDR_NYC, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)

    if office:
        out += line("L&S OFFICE COPY", bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    else:
        out += line("CUSTOMER RECEIPT", bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    if is_rush:
        out += line("*** RUSH ORDER ***", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += rule(heavy=True)

    # Ticket ID is the most scanned field at the counter
    out += line(str(ticket), bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += feed(1)

    if location:
        out += _kv("Store", location)
    if ticket_date:
        out += _kv("Date", ticket_date)
    out += _kv("Customer", customer_name or "")
    if customer_phone:
        out += _kv("Phone", customer_phone)
    if promised_date:
        out += _kv("Promised", promised_date)
    elif due_date:
        out += _kv("Due", due_date)
    out += rule(heavy=True)

    out += line("GARMENTS", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)

    for g in garments or []:
        gid = g.get("garment_id") or ""
        gtype = g.get("garment_type") or ""
        color = g.get("color") or ""
        label = " ".join([p for p in (gtype, color) if p]) or "Garment"
        head = "{}  [{}]".format(label, gid) if gid else label
        out += two_col(head, _money(g.get("garment_total")), bold=True, size=SIZE_2H)

        desc = g.get("garment_description") or ""
        if desc and desc.strip().lower() not in (
            (gtype or "").strip().lower(),
            label.strip().lower(),
        ):
            for chunk in _wrap(desc, LINE_WIDTH):
                out += line("  " + chunk, size=SIZE_2H)

        # Alteration lines under each garment (office especially)
        work = g.get("lines") or []
        for w in work:
            text = w if isinstance(w, str) else (w.get("description") or "")
            price = None if isinstance(w, str) else w.get("price")
            if not text:
                continue
            if price is not None and float(price or 0) != 0:
                out += two_col("  · " + text, _money(price), size=SIZE_2H)
            else:
                for chunk in _wrap("· " + text, LINE_WIDTH - 2):
                    out += line("  " + chunk, size=SIZE_2H)
        out += feed(1)

    out += rule(heavy=True)
    out += two_col("TOTAL", _money(ticket_total), bold=True, size=SIZE_2WH)
    out += rule(heavy=True)

    if notes:
        label = "INTERNAL NOTES" if office else "NOTES"
        out += line(label, bold=True, size=SIZE_2H)
        for chunk in _wrap(str(notes), LINE_WIDTH):
            out += line(chunk, size=SIZE_2H)
        out += feed(1)

    out += feed(1)
    out += ALIGN_CENTER + qr(qr_url, module_size=8) + ALIGN_LEFT
    out += line("Scan to view your order", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += line(str(ticket), bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)

    if not office:
        out += line("Thank you for choosing L&S.", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
        out += line(PHONE + "  |  " + WEB, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(2)
    out += CUT
    return out


def _wrap(text, width):
    """Tiny word-wrapper (avoids importing textwrap for one call)."""
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


def build_payment_receipt(*, invoice, customer_name, amount_paid, total,
                          outstanding, payment_ref=None, method="Card",
                          paid_on=None, qr_url=None, ticket=None):
    """Payment receipt printed after Square confirms a payment."""
    out = INIT + FONT_A
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += line(SUB, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)
    out += line("PAYMENT RECEIPT", bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
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
    paid_full = (outstanding is not None and float(outstanding or 0) <= 0.02)
    out += line("PAID IN FULL" if paid_full else "PARTIAL PAYMENT",
                bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += line("Thank you for choosing L&S.", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += line(PHONE + "  |  " + WEB, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(2)
    out += CUT
    return out


def build_pay_qr(*, invoice, customer_name, amount, url, ticket=None):
    """Scan-to-pay slip via Square hosted checkout."""
    out = INIT + FONT_A
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += feed(1)
    out += line("SCAN TO PAY", bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
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
    out += feed(2)
    out += CUT
    return out


# ---------------------------------------------------------------------------
# Network sender
# ---------------------------------------------------------------------------

def send(host, payload, port=9100, timeout=5.0):
    """
    Ship raw ESC/POS bytes to the printer over TCP :9100.
    Raises socket.timeout or OSError on failure -- caller logs it.
    Returns the number of bytes sent.
    """
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
