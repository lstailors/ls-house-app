# Backend scripts

| Script | Purpose |
|---|---|
| `verify-erpnext-setup.ts` | Verify all `lsh_house` DocTypes exist on ERPNext (`bun run verify:erpnext`) |
| `seed-erpnext-lsh.ts` | Seed baseline LSH Location + Agent rows (`bun run seed:erpnext`) |
| `migrate-deliveries-to-erp.ts` | One-off migration Supabase deliveries → ERPNext (historical) |

Run from `backend/` with ERPNext credentials loaded.
