# DEPLOY — hand this folder to Claude Code on the Mac Studio

These two packages are tested and ready. Place them, commit them, deploy them.
Do NOT regenerate the code and do NOT touch live DocTypes (already created in
ERPNext via MCP).

## 1. Place the packages

Copy into the running app at the app's python root:

    apps/ls_alterations/ls_alterations/ls_thermal/   (__init__.py, escpos_tm.py, api.py)
    apps/ls_alterations/ls_alterations/ls_square/    (__init__.py, client.py, webhook.py, pos.py)

The dotted import paths the live Client Scripts already call:
    ls_alterations.ls_thermal.api.print_ticket
    ls_alterations.ls_thermal.api.print_payment_receipt
    ls_alterations.ls_thermal.api.print_pay_link
    ls_alterations.ls_square.pos.create_checkout
    ls_alterations.ls_square.pos.create_payment_link
    ls_alterations.ls_square.webhook.receive
    ls_alterations.ls_square.webhook.reprocess

If the app's python root differs, adjust the `METHOD` strings in the two
Client Scripts ("Alteration Ticket - Thermal Print", "Alteration Ticket -
Square Pay") to match.

## 2. Commit to the ls_alterations repo, then deploy

    git add ls_alterations/ls_thermal ls_alterations/ls_square && git commit -m "Add thermal print + Square POS integration"
    bench --site erp.lstailors.com clear-cache
    bench restart

(No DB migration needed — DocTypes already exist as custom records.)

## 3. Configure (one-time)

- LSH Print Settings: printer IP (set a DHCP reservation), port 9100, app base URL
- Square Integration Settings: access token, signature key, location_id,
  device_id, environment, and the EXACT Webhook Notification URL
- Square Dashboard → Webhooks: subscribe that URL to
  payment.created, payment.updated, terminal.checkout.updated

## 4. Verify and report back

1. Printer reachability from inside the Frappe container:
       docker exec -it <frappe_backend> python3 -c "import socket;s=socket.socket();s.settimeout(3);s.connect(('PRINTER_IP',9100));print('reachable');s.close()"
   If it hangs/refuses, run ls_print_bridge.py on the Mac host and set
   print_bridge_url in LSH Print Settings (see INSTALL_thermal.md).
2. bench console:
       import ls_alterations.ls_thermal.api as p; p.test_printer()
3. Square: sandbox first. pos.create_payment_link(invoice="...") and
   pos.create_checkout(invoice="...") then watch Square Webhook Event flip to
   Processed and the invoice go to Paid.

Report what works and what doesn't. The MCP allowlist (LS_MCP_ALLOWED_METHODS)
should include the method paths above if you want to trigger them remotely.
