# UniFi Talk webhook payload fixtures

Sanitized raw request bodies used by `backend/src/routes/webhooks.test.ts` to exercise every configured UniFi Talk webhook type. Phone numbers, IDs, names, transcripts, and recording URLs are reserved test data; no production customer data is committed.

These fixtures intentionally retain the native `to` and `direction` fields so a future parser follow-up can preserve the called line and call direction. This PR does not change `parseUnifiPayload()` or the n8n forwarding contract.
