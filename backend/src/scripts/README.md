# Backend scripts

| Script | Purpose |
|---|---|
| `verify-erpnext-setup.ts` | Verify all `lsh_house` DocTypes exist (`bun run verify:erpnext`) |
| `seed-erpnext-lsh.ts` | Seed baseline LSH Location + Agent rows (`bun run seed:erpnext`) |

Run from `backend/` with ERPNext credentials loaded.

**Prerequisite:** `bench install-app lsh_house` on the Frappe site — see `backend/erpnext/INSTALL.md`.

Historical one-off migration (requires legacy Supabase creds): `backend/scripts/migrate-deliveries-to-erp.ts`
