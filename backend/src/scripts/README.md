# Backend scripts

| Script | Purpose |
|---|---|
| `verify-erpnext-setup.ts` | Verify all `lsh_house` DocTypes exist (`bun run verify:erpnext`) |
| `seed-erpnext-lsh.ts` | Seed baseline LSH Location + Agent rows (`bun run seed:erpnext`) |
| `scan-customer-pci.ts` | Dry-run scan of Customer name/email/phone/notes for magstripe / PAN / garbage names (`bun run scan:customer-pci`). Rewrite confirmed hits with `--apply` (`bun run scan:customer-pci:apply`). Never prints a full card number. |
| `cleanup-auto-assignment-todos.ts` | Dry-run close duplicate "Automatic Assignment" ToDos (`bun run cleanup:auto-todos`). Apply with `--apply`. |

Run from `backend/` with ERPNext credentials loaded.

**Prerequisite:** `bench install-app lsh_house` on the Frappe site — see `backend/erpnext/INSTALL.md`.

Historical one-off migration (requires legacy Supabase creds): `backend/scripts/migrate-deliveries-to-erp.ts`
