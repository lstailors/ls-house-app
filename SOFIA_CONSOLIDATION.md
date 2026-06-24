# Sofia consolidation

This repository is the source of truth for Sofia.

## Canonical runtime paths

- SMS conversation UI: `backend/src/routes/sofia.ts`
- SMS outbound logging: `backend/erpnext/lsh_house/lsh_house/sms.py`
- SMS inbound logging: `backend/erpnext/lsh_house/lsh_house/api/sms_inbound.py`
- Voice / realtime worker: `sophia/web/server.py`

The house backend no longer proxies Sofia conversation data to `sofia.lstailors.com`.
Conversation list and thread APIs read local ERPNext data (`LSH SMS Message` plus
`LSH Call Log`) so the web app, ERPNext hooks, and Sofia share the same thread
view.

## Why the Python worker remains

Twilio voice media streams and Grok realtime voice require long-lived WebSocket
connections. Those are not safe to run in a short-lived serverless request. Keep
the `sophia/` worker deployed as the always-on voice component, but treat this
repo as its codebase and the house backend as the UI/API source of truth.

## Retired split points

- `SOFIA_URL` / `https://sofia.lstailors.com` is no longer used by the house
  backend for conversations.
- Sofia alteration-ticket tools now query ERPNext directly instead of calling
  the n8n `sofia-erpnext-tools` webhook.

## Deploy notes

- Twilio SMS should point to exactly one ingress. For async ERPNext logging use
  `/api/method/lsh_house.api.sms_inbound.receive`; for the Node AI brain use
  `/api/sofia/sms`. Do not enable both as active reply paths.
- `/api/sofia/sms` validates `X-Twilio-Signature` unless
  `SOFIA_SKIP_TWILIO_SIGNATURE=1` is set for development.
- The voice worker can be hosted under the same public product domain with a
  reverse-proxy path, but it still needs an always-on runtime.
