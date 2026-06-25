# L&S Thermal Print — Epson TM-M30ii (ESC/POS over IP)

ESC/POS print handler for the TM-M30ii. Three formats, all with QR codes
matching the garment tracking system (`garment_id` per garment, ticket name
for master):

- **Garment tag** — one per garment, QR → `/g/{ticket}/{garment_id}`
- **Customer receipt** — master copy, priced garment lines + total, QR → `/t/{ticket}`
- **Office copy** — L&S filing copy (internal notes), QR → `/t/{ticket}`

Pure stdlib (only `socket`). No pip dependency to pin or drift.

---

## What's already live in ERPNext (done via MCP)

- **LSH Print Settings** (Single) — printer IP, port, timeout, app base URL
- **LSH Print Log** — one row per print attempt (Printed / Failed + detail)
- **Client Script "Alteration Ticket - Thermal Print"** — adds a **Print** button
  group on the Alteration Ticket form: *Tags + Receipts*, *Customer Receipt*,
  *Office Copy*, *Garment Tags*

## What you install on the bench (this folder)

Drop the `ls_thermal` package into your **ls_alterations** app:

```
apps/ls_alterations/ls_alterations/ls_thermal/
    __init__.py
    escpos_tm.py      # ESC/POS builder + raw socket sender (frappe-free)
    api.py            # whitelisted endpoints, reads settings, writes log
```

The whitelisted path is therefore `ls_alterations.ls_thermal.api.print_ticket`
— which is exactly what the Client Script calls. If you place the folder
elsewhere, update `METHOD` in the Client Script to match.

```bash
# from the bench directory
cp -r ls_thermal apps/ls_alterations/ls_alterations/
bench --site erp.lstailors.com clear-cache
bench restart      # or: bench --site erp.lstailors.com migrate (no schema change needed)
```

## Configure

1. Open **LSH Print Settings**, set **Printer IP Address** to the TM-M30ii's
   static LAN IP (set a DHCP reservation for it so it never moves), Port `9100`,
   Timeout `5`, App Base URL `https://app.lstailors.com`.
2. Find the printer's IP: hold the printer's feed button on power-up to print a
   self-test/status slip, or check it in EpsonNet Config / your router's DHCP
   table.

## Test (in order)

1. **Reachability from the container** (the one Docker gotcha):
   ```bash
   docker exec -it <frappe_backend_container> \
     python3 -c "import socket; s=socket.socket(); s.settimeout(3); \
     s.connect(('PRINTER_IP',9100)); print('reachable'); s.close()"
   ```
   - Prints `reachable` → you're done, direct socket works.
   - Hangs / refused → use the **bridge fallback** below.

2. **Diagnostic slip:** run the bench console:
   ```bash
   bench --site erp.lstailors.com console
   >>> import ls_alterations.ls_thermal.api as p
   >>> p.test_printer()
   ```
   A small "L&S PRINTER TEST" slip with a QR should print and cut.

3. **Real ticket:** open any Alteration Ticket → **Print → Tags + Receipts**.
   Check **LSH Print Log** for the rows.

---

## Bridge fallback (only if step 1 failed)

ERPNext runs in Docker; depending on network mode the container may not reach a
LAN printer IP. If so, run the tiny host bridge **on the Mac Studio** (outside
Docker) and let ERPNext POST to it.

```bash
# on the Mac host
PRINTER_IP=192.168.1.50 python3 ls_print_bridge.py
# health check: curl http://localhost:8088/health  -> "bridge up"
```

Then in **LSH Print Settings** add a Data field `print_bridge_url` (Customize
Form → add field) and set it to `http://host.docker.internal:8088/print`.
`api.py` auto-detects it and routes jobs through the bridge — no code change.

To keep the bridge running across reboots, wrap it in a launchd agent
(`~/Library/LaunchAgents/com.lstailors.printbridge.plist`) calling the script
with `PRINTER_IP` set.

---

## Notes

- 80mm paper = 48 chars/line (Font A). Tags are compact; receipts itemize each
  garment with its `garment_total` and the ticket total.
- The master QR is reused for the Square-terminal payment lookup (phase 2) — it
  already encodes the ticket, and the Square flow will resolve ticket → Sales
  Invoice server-side.
- To fire prints from the MCP (or from me, for testing), add to the MCP server's
  `LS_MCP_ALLOWED_METHODS`:
  `ls_alterations.ls_thermal.api.print_ticket`,
  `ls_alterations.ls_thermal.api.print_garment`,
  `ls_alterations.ls_thermal.api.test_printer`
