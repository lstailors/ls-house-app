# Backend scripts

| Script | Purpose |
|---|---|
| `verify-production-config.ts` | Pre-deploy check: env vars, ERPNext, Supabase buckets/tables/edge functions |
| `migrate-deliveries-to-erp.ts` | One-off migration Supabase deliveries → ERPNext (requires both creds) |

Run with `bun run verify:production` from `backend/`.

**Removed (June 2026):** `seed.ts` and `verify-scope.ts` referenced deleted Prisma/auth modules and were non-functional after the ERPNext auth migration.
