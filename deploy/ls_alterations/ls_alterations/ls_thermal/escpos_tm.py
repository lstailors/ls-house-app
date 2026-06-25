# -*- coding: utf-8 -*-
"""
escpos_tm.py  --  L&S Custom Tailors thermal print engine

Pure standard-library ESC/POS builder + raw socket sender for the
Epson TM-M30ii (80mm thermal, ESC/POS, native QR). NO external
dependencies -- only `socket` from stdlib -- so nothing to pip-pin
inside the Frappe bench and nothing to drift.

This module is intentionally frappe-free so it can be unit-tested
offline. The Frappe glue lives in thermal.py.

Three document builders:
    build_garment_tag(...)      -> one small tag per garment, with QR
    build_customer_receipt(...) -> master receipt, customer copy, with QR
    build_office_receipt(...)   -> master receipt, L&S filing copy, with QR

All builders return raw bytes (a full ESC/POS job ending in a cut).
send(host, port, payload, timeout) ships bytes to the printer on :9100.
"""

import socket

# ---------------------------------------------------------------------------
# Low-level ESC/POS primitives
# ---------------------------------------------------------------------------

ESC = b"\x1b"
GS = b"\x1d"

INIT = ESC + b"@"                       # initialize printer
CUT = GS + b"V\x42\x10"                 # partial cut, feed 16 dots first

ALIGN_LEFT = ESC + b"a\x00"
ALIGN_CENTER = ESC + b"a\x01"
ALIGN_RIGHT = ESC + b"a\x02"

BOLD_ON = ESC + b"E\x01"
BOLD_OFF = ESC + b"E\x00"

# GS ! n  -- character size. high nibble = height mult, low nibble = width mult
SIZE_NORMAL = GS + b"!\x00"
SIZE_2H = GS + b"!\x01"                  # double height
SIZE_2W = GS + b"!\x10"                  # double width
SIZE_2WH = GS + b"!\x11"                 # double width + height

# 80mm printable area is ~48 chars at Font A. We wrap/pad to that.
LINE_WIDTH = 48


def _enc(text):
    """Encode to the printer's code page; fall back gracefully."""
    if text is None:
        text = ""
    if not isinstance(text, str):
        text = str(text)
    # CP437 covers the accented Sicilian/Italian glyphs we care about;
    # anything stray gets a '?' rather than blowing up the whole job.
    return text.encode("cp437", "replace")


def line(text="", *, bold=False, size=None, align=None):
    """One left-to-default line of text + newline, with optional styling."""
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


def rule(char="-"):
    return _enc(char * LINE_WIDTH) + b"\n"


def feed(n=1):
    return b"\n" * n


def two_col(left, right, width=LINE_WIDTH):
    """Left text + right text padded to the full line (e.g. item ..... $40)."""
    left = "" if left is None else str(left)
    right = "" if right is None else str(right)
    space = width - len(left) - len(right)
    if space < 1:
        # truncate the left side so the right (price) always survives
        left = left[: max(0, width - len(right) - 1)]
        space = width - len(left) - len(right)
        space = max(space, 1)
    return _enc(left + (" " * space) + right) + b"\n"


def qr(data, module_size=6, ec="M"):
    """
    Native ESC/POS QR (model 2) for the TM-M30ii via GS ( k.
    module_size 1-16 (6 is a good scan-from-a-phone size on 80mm).
    ec in {L,M,Q,H}.
    """
    data_bytes = data.encode("utf-8")
    ec_map = {"L": 48, "M": 49, "Q": 50, "H": 51}
    ec_byte = ec_map.get(ec.upper(), 49)

    out = b""
    # Function 165: select model 2
    out += GS + b"(k\x04\x00\x31\x41\x32\x00"
    # Function 167: module size
    out += GS + b"(k\x03\x00\x31\x43" + bytes([max(1, min(16, module_size))])
    # Function 169: error correction level
    out += GS + b"(k\x03\x00\x31\x45" + bytes([ec_byte])
    # Function 180: store data in symbol storage area
    store_len = len(data_bytes) + 3
    pl = store_len & 0xFF
    ph = (store_len >> 8) & 0xFF
    out += GS + b"(k" + bytes([pl, ph]) + b"\x31\x50\x30" + data_bytes
    # Function 181: print the symbol
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


def build_garment_tag(*, ticket, garment, qr_url, due_date=None,
                      is_rush=False, location=None, idx=None, total=None):
    """
    One garment tag. `garment` is a dict-like with keys:
    garment_id, garment_type, color, garment_description.
    qr_url should resolve in the L&S House app to this garment.
    """
    g = garment
    out = INIT
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += feed(1)

    seq = ""
    if idx is not None and total is not None:
        seq = "  ({} of {})".format(idx, total)
    out += line("GARMENT TAG" + seq, bold=True, align=ALIGN_CENTER)
    if is_rush:
        out += line("*** RUSH ***", bold=True, align=ALIGN_CENTER, size=SIZE_2W)
    out += rule()

    out += line("Ticket:  " + str(ticket), bold=True)
    if location:
        out += line("Store:   " + str(location))
    out += line("Garment: " + str(g.get("garment_id") or ""), bold=True, size=SIZE_2H)

    gtype = g.get("garment_type") or ""
    color = g.get("color") or ""
    head = " / ".join([p for p in (gtype, color) if p])
    if head:
        out += line(head)
    desc = g.get("garment_description") or ""
    if desc:
        for chunk in _wrap(desc, LINE_WIDTH):
            out += line(chunk)
    if due_date:
        out += line("Due:     " + str(due_date), bold=True)

    out += feed(1)
    out += ALIGN_CENTER + qr(qr_url, module_size=6) + ALIGN_LEFT
    out += line(str(g.get("garment_id") or ""), align=ALIGN_CENTER)
    out += feed(1)
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


def _master(*, ticket, customer_name, customer_phone, garments, ticket_total,
            qr_url, ticket_date, due_date, promised_date, is_rush, location,
            notes, office):
    out = INIT
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += line(SUB, align=ALIGN_CENTER)
    out += line("138 East 61st Street, Ste 201, NYC", align=ALIGN_CENTER)
    out += feed(1)

    if office:
        out += line("=== L&S OFFICE COPY ===", bold=True, align=ALIGN_CENTER,
                    size=SIZE_2H)
    else:
        out += line("CUSTOMER RECEIPT", bold=True, align=ALIGN_CENTER)
    if is_rush:
        out += line("*** RUSH ORDER ***", bold=True, align=ALIGN_CENTER)
    out += rule()

    out += line("Ticket:   " + str(ticket), bold=True)
    if location:
        out += line("Store:    " + str(location))
    if ticket_date:
        out += line("Date:     " + str(ticket_date))
    out += line("Customer: " + str(customer_name or ""))
    if customer_phone:
        out += line("Phone:    " + str(customer_phone))
    if promised_date:
        out += line("Promised: " + str(promised_date), bold=True)
    elif due_date:
        out += line("Due:      " + str(due_date), bold=True)
    out += rule()

    # Garment lines with pricing
    out += line("GARMENTS", bold=True)
    for g in garments:
        gid = g.get("garment_id") or ""
        gtype = g.get("garment_type") or ""
        color = g.get("color") or ""
        label = " ".join([p for p in (gtype, color) if p]) or "Garment"
        out += two_col(label + "  [" + str(gid) + "]",
                       _money(g.get("garment_total")))
        desc = g.get("garment_description") or ""
        if desc:
            for chunk in _wrap(desc, LINE_WIDTH - 2):
                out += line("  " + chunk)
    out += rule()
    out += two_col("TOTAL", _money(ticket_total))
    out += rule()

    if notes:
        label = "Notes (internal):" if office else "Notes:"
        out += line(label, bold=True)
        for chunk in _wrap(str(notes), LINE_WIDTH):
            out += line(chunk)
        out += feed(1)

    # QR -- master ticket lookup (app scan; reused for Square in phase 2)
    out += feed(1)
    out += ALIGN_CENTER + qr(qr_url, module_size=6) + ALIGN_LEFT
    out += line("Scan to view your order", align=ALIGN_CENTER)
    out += line(str(ticket), align=ALIGN_CENTER, bold=True)
    out += feed(1)

    if not office:
        out += line("Thank you for choosing L&S.", align=ALIGN_CENTER)
        out += line("(212) 838-7372  |  lstailors.com", align=ALIGN_CENTER)
    out += feed(1)
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
    out = INIT
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += line(SUB, align=ALIGN_CENTER)
    out += feed(1)
    out += line("PAYMENT RECEIPT", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += rule()
    out += line("Invoice:  " + str(invoice), bold=True)
    if ticket:
        out += line("Ticket:   " + str(ticket))
    out += line("Customer: " + str(customer_name or ""))
    if paid_on:
        out += line("Paid:     " + str(paid_on))
    out += line("Method:   " + str(method) + " (Square)")
    if payment_ref:
        out += line("Ref:      " + str(payment_ref))
    out += rule()
    out += two_col("Invoice Total", _money(total))
    out += two_col("Amount Paid", _money(amount_paid))
    out += BOLD_ON + two_col("Balance Due", _money(outstanding)) + BOLD_OFF
    out += rule()
    if qr_url:
        out += feed(1)
        out += ALIGN_CENTER + qr(qr_url, module_size=6) + ALIGN_LEFT
    out += feed(1)
    paid_full = (outstanding is not None and float(outstanding or 0) <= 0.02)
    out += line("PAID IN FULL" if paid_full else "PARTIAL PAYMENT",
                bold=True, align=ALIGN_CENTER)
    out += line("Thank you for choosing L&S.", align=ALIGN_CENTER)
    out += line("(212) 838-7372  |  lstailors.com", align=ALIGN_CENTER)
    out += feed(1)
    out += CUT
    return out


def build_pay_qr(*, invoice, customer_name, amount, url, ticket=None):
    """A 'Scan to Pay' slip: customer scans the QR with their phone to pay
    via Square's hosted checkout (the `url` from a Square payment link)."""
    out = INIT
    out += line(BRAND, bold=True, align=ALIGN_CENTER, size=SIZE_2WH)
    out += feed(1)
    out += line("SCAN TO PAY", bold=True, align=ALIGN_CENTER, size=SIZE_2H)
    out += rule()
    out += line("Invoice:  " + str(invoice), bold=True)
    if ticket:
        out += line("Ticket:   " + str(ticket))
    out += line("Customer: " + str(customer_name or ""))
    out += two_col("Amount Due", _money(amount))
    out += rule()
    out += feed(1)
    out += ALIGN_CENTER + qr(url, module_size=7) + ALIGN_LEFT
    out += feed(1)
    out += line("Scan with your phone camera", align=ALIGN_CENTER)
    out += line("to pay securely via Square.", align=ALIGN_CENTER)
    out += feed(1)
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
